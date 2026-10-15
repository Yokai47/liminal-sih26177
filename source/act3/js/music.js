/* LIMINAL: generative background score.
 * Everything is synthesised with the Web Audio API: no samples, no audio files, no AudioWorklet.
 *
 *   import { createMusic } from './music.js';
 *   const music = createMusic('workshop');          // or 'swarm'
 *   soundButton.onclick = () => music.toggle();     // first start() must come from a user gesture
 *
 * createMusic(mood, { ctx, seed, parts } = {})
 *   mood   'workshop'  Act 3: one drone on the bench. D lydian, 72 BPM, Dmaj9 | Bm11 | Gmaj7(#11) | A6/9, 2 bars each
 *          'swarm'     Act 5: the swarm lab. Eb pentatonic over Eb lydian, 60 BPM, Ebmaj7 | Cm9 | Abmaj7(#11) | Bbsus2(add6), 4 bars each
 *   ctx    optional AudioContext or OfflineAudioContext to play into. It is never suspended or closed by this module.
 *   seed   optional integer: same seed, same performance (handy for tests)
 *   parts  optional array of layer names to solo, for level checks
 *          ('pad' 'bass' 'bell' 'tick' in workshop; 'pad' 'drone' 'pluck' in swarm)
 *
 * returns { start(), stop(), toggle(), setVolume(v), on, destroy(), renderAhead(seconds) }
 *   start()     creates (or resumes) the AudioContext, fades in over 2.5 s, runs a lookahead scheduler
 *               (100 ms timer, 0.3 s ahead on the audio clock). Safe to call repeatedly.
 *   stop()      fades out over 1.5 s, then releases every voice and suspends the context it created.
 *   toggle()    start or stop; returns the new `on` state.
 *   setVolume() 0..1 on a perceptual (squared) curve; 1 = the calibrated level (peaks < -6 dBFS, RMS about -22 dBFS).
 *   on          true while playing or fading in (false once stop() was called).
 *   destroy()   stops at once (60 ms fade) and closes the context it created.
 *   renderAhead(s)  schedules s seconds from now in one go. With an OfflineAudioContext, start() already
 *               schedules the whole render length, so start() + startRendering() is enough.
 */

const MAX_VOICES = 12;   // simultaneous enveloped notes (each pad note, bell, pluck, tick, the drone)
const STEAL = 0.09;      // fade time for a stolen voice
const LOOKAHEAD = 0.3;   // seconds scheduled ahead on the audio clock
const TICK_MS = 100;     // scheduler wake-up interval
const FADE_IN = 2.5;
const FADE_OUT = 1.5;
const OUT_TRIM = 0.76;   // after the limiter, so its ~-5.5 dBFS ceiling lands near -8 dBFS
const WET = 1.4;         // reverb return

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midi(name) {
  const r = /^([A-G])(#|b)?(\d)$/.exec(name);
  return 12 * (Number(r[3]) + 1) + PC[r[1]] + (r[2] === '#' ? 1 : r[2] === 'b' ? -1 : 0);
}
const notes = (s) => s.trim().split(/\s+/).map(midi);
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Envelopes. Every note starts and ends at exactly 0, so nothing clicks. */
function envAR(p, t, attack, peak, relAt, end) {     // pads: concave swell, hold, exponential release
  peak = Math.max(peak, 1e-5);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak * 0.55, t + attack * 0.3);   // quick bloom keeps crossfades full
  p.linearRampToValueAtTime(peak, t + attack);
  if (relAt > t + attack) p.setValueAtTime(peak, relAt);
  p.exponentialRampToValueAtTime(peak * 0.001, end - 0.03);
  p.linearRampToValueAtTime(0, end);
}
function envPerc(p, t, attack, peak, end) {          // plucked / struck: short ramp, exponential decay
  peak = Math.max(peak, 1e-5);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(peak * 0.001, end - 0.02);
  p.linearRampToValueAtTime(0, end);
}

/* Procedural stereo room: decorrelated noise per channel, -60 dB after 3.5 s, and a tail that darkens
   as it decays (time-varying one-pole low-pass, energy-compensated so the decay time stays honest). */
function makeImpulse(ac, rand) {
  const sr = ac.sampleRate, len = Math.ceil(sr * 3.6);
  const buf = ac.createBuffer(2, len, sr);
  const decay = Math.exp(-6.9078 / (3.5 * sr));
  const rise = Math.floor(sr * 0.012), tail = Math.floor(sr * 0.08);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let env = 1, y = 0, a = 1, norm = 1;
    for (let i = 0; i < len; i++) {
      if ((i & 63) === 0) {
        const fc = 1300 + 9000 * Math.exp(-(i / sr) / 0.45);
        a = 1 - Math.exp(-2 * Math.PI * fc / sr);
        norm = Math.sqrt((2 - a) / a);
      }
      y += a * (rand() * 2 - 1 - y);
      let w = env;
      if (i < rise) w *= i / rise;
      if (i > len - tail) w *= (len - i) / tail;
      d[i] = y * norm * w;
      env *= decay;
    }
  }
  return buf;
}

/* ------------------------------------------------------------------------------------------------
 * Act 3, the workshop: one drone taken apart. Precise, curious, warm.
 * D lydian, 72 BPM, eighth-note grid. Warm pad, sparse FM-bell arpeggio that mutates slowly,
 * sub bass on each bar, and a barely-there clockwork tick on beats 2 and 4.
 * ------------------------------------------------------------------------------------------------ */
function workshopScore(E) {
  const { rand } = E;
  const STEP = 60 / 72 / 2, BAR = STEP * 8, CHORD = BAR * 2;
  const L = { padTri: 0.034, padSaw: 0.028, bass: 0.042, bell: 0.088, tick: 0.019 };
  const CHORDS = [
    { root: midi('D2'), fifth: midi('A2'),  arp: notes('A4 C#5 D5 E5 F#5 A5'),                       // Dmaj9
      pads: [notes('F#3 A3 C#4 E4'), notes('A3 C#4 E4 F#4'), notes('F#3 A3 C#4 G#4')] },
    { root: midi('B1'), fifth: midi('F#2'), arp: notes('B4 C#5 D5 E5 F#5 A5'),                       // Bm11
      pads: [notes('F#3 A3 D4 E4'), notes('A3 D4 E4 F#4')] },
    { root: midi('G1'), fifth: midi('D2'),  arp: notes('B4 C#5 D5 F#5 G5 B5'),                       // Gmaj7(#11)
      pads: [notes('F#3 B3 D4 C#5'), notes('B3 D4 F#4 C#5')] },
    { root: midi('A1'), fifth: midi('E2'),  arp: notes('A4 B4 C#5 E5 F#5 A5'),                       // A6/9
      pads: [notes('F#3 B3 C#4 E4'), notes('C#4 E4 F#4 B4')] },
  ];

  // A 16-step (two-bar) motif of on/off + scale degree. It mutates a little at every chord change,
  // so the arpeggio sounds like the same instrument ticking over, never like a fixed tune.
  const motif = [];
  let d = 2;
  for (let k = 0; k < 16; k++) {
    d = clamp(d + [-1, 1, 1, -1, 2, -2, 0][(rand() * 7) | 0], 0, 5);
    motif.push({ on: rand() < (k % 4 === 0 ? 0.6 : k % 2 === 0 ? 0.5 : 0.33), deg: d });
  }
  function mutate() {
    for (const s of motif) {
      if (rand() < 0.12) s.on = !s.on;
      if (rand() < 0.15) s.deg = clamp(s.deg + (rand() < 0.5 ? -1 : 1), 0, 5);
    }
    let on = motif.filter((s) => s.on).length;
    while (on > 10) { const s = motif[(rand() * 16) | 0]; if (s.on) { s.on = false; on--; } }
    while (on < 5) { const s = motif[(rand() * 16) | 0]; if (!s.on) { s.on = true; on++; } }
  }

  let sec = null;
  function step(i, t, j) {
    const k = i % 16, ch = CHORDS[Math.floor(i / 16) % 4];
    if (k === 0) {
      if (j > 0) mutate();
      const alt = rand() < 0.3 ? 1 + ((rand() * (ch.pads.length - 1)) | 0) : 0;
      const voicing = ch.pads[alt];
      sec = { ticks: rand() < 0.8, thin: j < 16 ? 0.55 : rand() < 0.3 ? 0.3 : 0 };
      E.at(t, (tt) => pad(tt, voicing, CHORD - (tt - t)), 'pad', true);
    }
    if (k % 8 === 0) {
      const r = rand();
      const n = k === 0 || r < 0.72 ? ch.root : r < 0.9 ? ch.fifth : 0;
      if (n) E.at(t, (tt) => bass(tt, n, BAR - (tt - t)), 'bass', true);
    }
    if ((k % 8 === 2 || k % 8 === 6) && sec.ticks && rand() < 0.9) {
      const tock = k % 8 === 6;
      E.at(t + 0.003, (tt) => tick(tt, tock), 'tick');
    }
    const s = motif[k];
    if (s.on && rand() >= sec.thin && !(k >= 14 && rand() < 0.5)) {
      let n = ch.arp[s.deg];
      if (rand() < 0.09) n += n >= 79 ? -12 : 12;                 // occasional octave displacement
      const vel = (0.6 + 0.4 * rand()) * (k % 4 === 0 ? 1 : k % 2 === 0 ? 0.88 : 0.75);
      E.at(t + rand() * 0.012, (tt) => bell(tt, n, vel), 'bell');
    }
  }

  function pad(t, ns, dur) {
    const attack = 1.5, release = 2.4, relAt = t + dur, end = relAt + release;
    ns.forEach((n, j) => {
      const t0 = t + j * 0.05;
      const v = E.voice(t0, end, 3, relAt, E.G.bus.room);
      if (!v) return;
      const f = hz(n);
      const tri = E.osc(v, 'triangle', f, -4 + rand() * 2);
      const saw = E.osc(v, 'sawtooth', f, 5 + rand() * 2);
      const lp = E.filter(v, 'lowpass', 400, 2);
      const lo = 360 + rand() * 120, hi = 1000 + rand() * 800;
      lp.frequency.setValueAtTime(lo, t0);
      lp.frequency.linearRampToValueAtTime(hi, t0 + dur * (0.35 + 0.3 * rand()));
      lp.frequency.linearRampToValueAtTime(lo * 1.3, end);
      const tg = E.gain(v, L.padTri), sg = E.gain(v, L.padSaw), env = E.gain(v, 0);
      envAR(env.gain, t0, attack, 1, relAt, end);
      const p = E.panner(v, (j % 2 ? 1 : -1) * (0.2 + 0.2 * rand()));
      tri.connect(tg); tg.connect(env);
      saw.connect(lp); lp.connect(sg); sg.connect(env);
      env.connect(p); p.connect(v.steal);
      E.commit(v);
    });
  }

  function bass(t, n, dur) {
    const end = t + dur - 0.02, relAt = end - 0.75;
    const v = E.voice(t, end, 3, relAt, E.G.bus.close);
    if (!v) return;
    const f = hz(n), peak = L.bass * (n < midi('A1') ? 1.1 : 1);
    const s1 = E.osc(v, 'sine', f), s2 = E.osc(v, 'sine', 2 * f, 3);
    const g2 = E.gain(v, 0.35), env = E.gain(v, 0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.09);
    env.gain.linearRampToValueAtTime(peak * 0.72, relAt);
    env.gain.exponentialRampToValueAtTime(peak * 0.001, end - 0.02);
    env.gain.linearRampToValueAtTime(0, end);
    s1.connect(env); s2.connect(g2); g2.connect(env);
    env.connect(v.steal);
    E.commit(v);
  }

  function bell(t, n, vel) {
    const f = hz(n), dur = n < 76 ? 2.2 : 1.7;
    const v = E.voice(t, t + dur, 1, t + 0.01, E.G.bus.room);
    if (!v) return;
    const car = E.osc(v, 'sine', f), mod = E.osc(v, 'sine', f * 3.5);
    const depth = E.gain(v, 0), amp = E.gain(v, 0);
    const I0 = f * 3.5 * 0.55 * vel;                                // FM index ~0.5, gone within half a second
    depth.gain.setValueAtTime(I0, t);
    depth.gain.exponentialRampToValueAtTime(I0 * 0.04, t + 0.45);
    envPerc(amp.gain, t, 0.008, L.bell * vel, t + dur);
    const p = E.panner(v, clamp((n - 74) / 30 + (rand() - 0.5) * 0.3, -0.55, 0.55));
    mod.connect(depth); depth.connect(car.frequency);
    car.connect(amp); amp.connect(p); p.connect(v.steal);
    E.commit(v);
  }

  function tick(t, tock) {
    const v = E.voice(t, t + 0.09, 0, t, E.G.bus.close);
    if (!v) return;
    const src = E.noise(v, rand() * 0.8);
    const bp = E.filter(v, 'bandpass', tock ? 2500 : 3300, 2.5);
    const env = E.gain(v, 0);
    envPerc(env.gain, t, 0.0025, L.tick * (0.8 + 0.2 * rand()), t + 0.085);
    const p = E.panner(v, tock ? -0.15 : 0.15);
    src.connect(bp); bp.connect(env); env.connect(p); p.connect(v.steal);
    E.commit(v);
  }

  return { stepDur: STEP, stepsPerChord: 16, step };
}

/* ------------------------------------------------------------------------------------------------
 * Act 5, the swarm lab: emergence, wonder, flocking.
 * Eb major pentatonic over Eb lydian colour, 60 BPM, four-bar chords. A slow-swelling pad, a deep
 * breathing drone, and 'murmuration' flurries: 6-14 soft plucks whose stereo positions move together
 * like a flock turning, every 3-9 s, sometimes answered from the other side.
 * ------------------------------------------------------------------------------------------------ */
function swarmScore(E) {
  const { rand } = E;
  const STEP = 1, CHORD = 16;
  const L = { padTri: 0.028, padSaw: 0.0225, drone: 0.0375, pluck: 0.078 };
  const PC_A = 9, PC_D = 2;
  const CHORDS = [
    { pads: [notes('Eb3 Bb3 D4 G4'), notes('G3 Bb3 D4 F4')], colors: [PC_A, PC_D] },   // Ebmaj7 (+A = lydian)
    { pads: [notes('C3 G3 D4 Eb4'), notes('C3 Bb3 D4 G4')], colors: [PC_D] },          // Cm9
    { pads: [notes('Ab2 G3 C4 D4'), notes('Ab2 Eb3 G3 D4')], colors: [PC_D] },          // Abmaj7(#11)
    { pads: [notes('Bb2 F3 C4 G4'), notes('Bb2 G3 C4 F4')], colors: [] },               // Bbsus2(add6)
  ];
  const PENTA = notes('G4 Bb4 C5 Eb5 F5 G5 Bb5 C6 Eb6');
  let nextFlurry = 0;

  function begin(t) {
    E.at(t, (tt) => drone(tt), 'drone', true);
    nextFlurry = t + 3.5 + rand() * 2.5;
  }

  function step(i, t) {
    if (i % 16) return;
    const ch = CHORDS[Math.floor(i / 16) % 4];
    const voicing = ch.pads[rand() < 0.65 ? 0 : 1];
    E.at(t, (tt) => pad(tt, voicing, CHORD - (tt - t)), 'pad', true);
  }

  const chordAt = (t) => Math.floor(E.stepAt(t) / 16) % 4;

  function extra(tEnd) {
    const now = E.ac.currentTime;
    if (nextFlurry < now) nextFlurry = now + 0.5 + rand();       // the page was asleep: do not burst
    while (nextFlurry < tEnd) {
      const T = nextFlurry;
      const a = flurry(T, {});
      let next = T + 3 + rand() * 6;
      if (rand() < 0.35) {                                         // an answer from the other side
        const A = T + a.dur * 0.6 + 0.4 + rand() * 1.1;
        const b = flurry(A, { side: -a.side, n: 6 + ((rand() * 4) | 0), level: 0.75,
          shift: rand() < 0.4 ? -12 : 0, idx: (rand() * 4) | 0 });
        next = Math.max(next, A + b.dur + 1.5);
      }
      nextFlurry = next;
    }
  }

  function flurry(T, o) {
    const n = o.n || 6 + ((rand() * 9) | 0);                      // 6..14 notes
    const D = n * (0.15 + rand() * 0.09);                          // ~1-3.4 s
    const side = o.side || (rand() < 0.5 ? -1 : 1);
    const p0 = side * (0.45 + rand() * 0.4), p1 = -side * (0.15 + rand() * 0.55);
    const curl = (rand() - 0.5) * 0.7;
    // the flock's path across the stereo field: ease across, bulge (curl) like a turning murmuration
    const traj = (tt) => {
      const u = clamp((tt - T) / D, 0, 1.4);
      const s = u >= 1 ? 1 + (u - 1) * 0.25 : u * u * (3 - 2 * u);
      return clamp(p0 + (p1 - p0) * s + curl * Math.sin(Math.PI * Math.min(u, 1)), -0.92, 0.92);
    };
    const shape = ['arch', 'arch', 'valley', 'rise', 'fall'][(rand() * 5) | 0];
    const colors = CHORDS[chordAt(T)].colors;
    let idx = o.idx != null ? o.idx : 1 + ((rand() * 4) | 0);
    for (let k = 0; k < n; k++) {
      const u = n > 1 ? k / (n - 1) : 0;
      // sparse at the edges, dense in the middle: notes bunch up as the flock turns
      const tk = T + D * (u + 0.65 * Math.sin(2 * Math.PI * u) / (2 * Math.PI)) + (k ? rand() * 0.03 : 0);
      if (k) {
        const dir = shape === 'arch' ? (u < 0.55 ? 1 : -1) : shape === 'valley' ? (u < 0.55 ? -1 : 1)
          : shape === 'rise' ? 1 : -1;
        const r = rand();
        idx += r < 0.12 ? -dir : r < 0.72 ? dir : r < 0.9 ? 2 * dir : 0;
        if (idx < 0) idx = 1;
        if (idx >= PENTA.length) idx = PENTA.length - 2;
      }
      let note = PENTA[idx] + (o.shift || 0);
      if (colors.length && rand() < 0.1) {                         // a lydian / major-7th glint
        const pc = colors[(rand() * colors.length) | 0];
        note = note - (((note % 12) - pc + 12) % 12);
        if (note < PENTA[0] + (o.shift || 0)) note += 12;
      }
      const amp = L.pluck * (o.level || 1) * (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * (0.08 + 0.84 * u)), 0.8))
        * (0.8 + 0.4 * rand());
      const off = (k % 2 ? 1 : -1) * (0.05 + rand() * 0.1);
      E.at(tk, (tt) => pluck(tt, note, amp, traj, off), 'pluck');
    }
    return { dur: D, side };
  }

  function pluck(t, n, amp, traj, off) {
    const f = hz(n), dur = 1.0 + clamp((84 - n) * 0.025, 0, 0.6);
    const v = E.voice(t, t + dur, 1, t + 0.01, E.G.bus.far);
    if (!v) return;
    const o = E.osc(v, 'triangle', f, (rand() - 0.5) * 6);
    const lp = E.filter(v, 'lowpass', 1000, 1);
    lp.frequency.setValueAtTime(Math.min(f * 6, 6500), t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.35);
    const g = E.gain(v, 0);
    envPerc(g.gain, t, 0.005, amp, t + dur);
    const p = E.panner(v, 0);
    if (p.pan) {                                                    // ride the flock's path while ringing
      p.pan.setValueAtTime(clamp(traj(t) + off, -1, 1), t);
      for (let q = 1; q <= 4; q++) {
        const tq = t + (dur * q) / 4;
        p.pan.linearRampToValueAtTime(clamp(traj(tq) + off, -1, 1), tq);
      }
    }
    o.connect(lp); lp.connect(g); g.connect(p); p.connect(v.steal);
    E.commit(v);
  }

  function pad(t, ns, dur) {
    const attack = 5, release = 5.5, relAt = t + dur, end = relAt + release;
    ns.forEach((n, j) => {
      const t0 = t + j * 0.4;                                       // notes bloom one after another
      const v = E.voice(t0, end, 3, relAt, E.G.bus.room);
      if (!v) return;
      const f = hz(n);
      const tri = E.osc(v, 'triangle', f, -3 + rand() * 2);
      const saw = E.osc(v, 'sawtooth', f, 4 + rand() * 2);
      const lp = E.filter(v, 'lowpass', 300, 1);
      const lo = 220 + rand() * 80, hi = 750 + rand() * 550;
      lp.frequency.setValueAtTime(lo, t0);
      lp.frequency.linearRampToValueAtTime(hi, t0 + attack + rand() * 5);
      lp.frequency.linearRampToValueAtTime(lo, end);
      const tg = E.gain(v, L.padTri), sg = E.gain(v, L.padSaw), env = E.gain(v, 0);
      envAR(env.gain, t0, attack, 1, relAt, end);
      const p = E.panner(v, (j % 2 ? 1 : -1) * (0.25 + 0.2 * rand()));
      tri.connect(tg); tg.connect(env);
      saw.connect(lp); lp.connect(sg); sg.connect(env);
      env.connect(p); p.connect(v.steal);
      E.commit(v);
    });
  }

  function drone(t) {
    const v = E.voice(t, Infinity, 5, Infinity, E.G.bus.room);     // priority 5: never stolen
    if (!v) return;
    const f = hz(midi('Eb2'));
    const o1 = E.osc(v, 'sine', f), o2 = E.osc(v, 'triangle', f, 5), o3 = E.osc(v, 'sine', f * 1.5, -3);
    const lp = E.filter(v, 'lowpass', 300, 0);
    const g1 = E.gain(v, L.drone), g2 = E.gain(v, L.drone * 0.55), g3 = E.gain(v, L.drone * 0.14);
    const breath = E.gain(v, 0.7), env = E.gain(v, 0);
    const lfo = E.osc(v, 'sine', 1 / 13), lfoAmt = E.gain(v, 0.3);        // slow breathing, 13 s
    const lfo2 = E.osc(v, 'sine', 1 / 21), lfo2Amt = E.gain(v, 110);      // and a slower colour drift
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 6);
    o1.connect(g1); g1.connect(breath);
    o2.connect(lp); lp.connect(g2); g2.connect(breath);
    o3.connect(g3); g3.connect(breath);
    lfo.connect(lfoAmt); lfoAmt.connect(breath.gain);
    lfo2.connect(lfo2Amt); lfo2Amt.connect(lp.frequency);
    breath.connect(env); env.connect(v.steal);
    E.commit(v);
  }

  return { stepDur: STEP, stepsPerChord: 16, step, begin, extra };
}

const SCORES = { workshop: workshopScore, swarm: swarmScore };
const MOOD_LEVEL = { workshop: 1.37, swarm: 1.7 };

export function createMusic(mood, { ctx, seed, parts } = {}) {
  if (!SCORES[mood]) throw new Error(`createMusic: unknown mood "${mood}" (use 'workshop' or 'swarm')`);
  const owns = !ctx;
  let ac = ctx || null;
  let G = null;                // the audio graph (built once, reused)
  let state = 'off';           // 'off' | 'on' | 'stopping' | 'destroyed'
  let running = false;         // scheduler active
  let timer = 0, stopTimer = 0, lastWake = 0;
  let volume = 1;
  let fadeSeg = { t0: 0, v0: 0, t1: 0, v1: 0 };
  const rand = mulberry32(seed == null ? (Math.random() * 4294967296) >>> 0 : seed);
  const solo = Array.isArray(parts) && parts.length ? new Set(parts) : null;
  const live = new Set();      // voices whose nodes still exist
  let voices = [];             // voice book-keeping on the audio clock (for the voice cap)
  let queue = [];              // pending note events, realised in time order
  let clock = 0;               // audio time of the event being realised
  let score = null, song = null;

  const isOffline = () => typeof ac.startRendering === 'function';

  /* ---- graph: busses -> dry + shared reverb -> low-pass -> soft limiter -> fade -> volume ---- */
  function build() {
    const all = [];
    const add = (n) => (all.push(n), n);
    const gain = (v) => { const g = add(ac.createGain()); g.gain.value = v; return g; };
    const biquad = (type, f, q) => { const b = add(ac.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const out = gain(volume * volume), fade = gain(0), trim = gain(OUT_TRIM);
    const comp = add(ac.createDynamicsCompressor());
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 10;
    comp.attack.value = 0.004; comp.release.value = 0.25;
    const lp = biquad('lowpass', 6000, -3);
    const mix = gain(MOOD_LEVEL[mood]), dry = gain(1), send = gain(1), wet = gain(WET);
    const rvHP = biquad('highpass', 200, -3), rvLP = biquad('lowpass', 4500, -3);
    const pre = add(ac.createDelay(0.1)); pre.delayTime.value = 0.028;
    const conv = add(ac.createConvolver());
    conv.buffer = makeImpulse(ac, mulberry32(0x11a71a1));
    send.connect(rvHP); rvHP.connect(pre); pre.connect(conv); conv.connect(rvLP); rvLP.connect(wet); wet.connect(mix);
    dry.connect(mix);
    mix.connect(lp); lp.connect(comp); comp.connect(trim); trim.connect(fade); fade.connect(out);
    out.connect(ac.destination);
    const bus = (d, s) => { const b = gain(1), bd = gain(d), bs = gain(s); b.connect(bd); bd.connect(dry); b.connect(bs); bs.connect(send); return b; };
    const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const nr = mulberry32(0x7e57), nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = nr() * 2 - 1;
    return { all, out, fade, noise, bus: { close: bus(1, 0.1), room: bus(0.85, 0.38), far: bus(0.55, 0.85) } };
  }

  /* ---- voices ---- */
  // Events are realised in time order (`clock`), so `voices` holds everything that may still sound.
  // A note starting at t counts every voice that has not ended by t (even ones that start later).
  // When full, the lowest-priority, oldest note is faded out so that it ends exactly at t:
  // the count never exceeds MAX_VOICES at any instant.
  function allocate(t, prio) {
    voices = voices.filter((v) => v.end > clock);
    let count = 0;
    for (const v of voices) if (v.end > t) count++;
    if (count < MAX_VOICES) return true;
    let best = null, bestEff = Infinity;
    for (const v of voices) {
      if (v.prio >= 5 || v.end <= t || v.start > t - 0.12) continue;
      const eff = t >= v.relAt ? v.prio - 1.5 : v.prio;     // releasing notes are cheaper to steal
      if (eff > prio) continue;
      if (eff < bestEff || (eff === bestEff && v.start < best.start)) { best = v; bestEff = eff; }
    }
    if (!best) return false;
    const st = Math.max(t - STEAL, best.start + 0.01, isOffline() ? 0 : ac.currentTime);
    best.steal.gain.setValueAtTime(1, st);
    best.steal.gain.linearRampToValueAtTime(0, st + STEAL - 0.01);
    best.end = st + STEAL;
    for (const s of best.sources) { try { s.stop(best.end); } catch (e) { /* already stopping */ } }
    voices = voices.filter((v) => v !== best);
    return true;
  }
  function voice(t, end, prio, relAt, dest) {
    if (!allocate(t, prio)) return null;
    const steal = ac.createGain();
    steal.connect(dest);
    const v = { start: t, end, prio, relAt, steal, sources: [], nodes: [steal], offsets: new Map(), done: false };
    voices.push(v);
    live.add(v);
    return v;
  }
  function commit(v) {
    for (const s of v.sources) {
      if (v.offsets.has(s)) s.start(v.start, v.offsets.get(s)); else s.start(v.start);
      if (Number.isFinite(v.end)) s.stop(v.end);
    }
    if (v.sources.length) v.sources[0].onended = () => release(v);
  }
  function release(v) {
    if (v.done) return;
    v.done = true;
    for (const n of v.nodes) { try { n.disconnect(); } catch (e) { /* fine */ } }
    live.delete(v);
  }
  function kill(v) {
    for (const s of v.sources) { s.onended = null; try { s.stop(); } catch (e) { /* not started */ } }
    release(v);
  }
  const E = {
    rand,
    get ac() { return ac; },
    get G() { return G; },
    stepAt(t) { return Math.max(0, song.base + Math.floor((t - song.t0) / score.stepDur + 1e-6)); },
    at(t, fn, part, keepLate = false) { if (!solo || solo.has(part)) queue.push({ t, fn, keepLate }); },
    voice, commit,
    osc(v, type, f, detune = 0) {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = f; if (detune) o.detune.value = detune;
      v.nodes.push(o); v.sources.push(o); return o;
    },
    gain(v, val) { const g = ac.createGain(); g.gain.value = val; v.nodes.push(g); return g; },
    // slow sweeps only: k-rate (once per 128 frames) avoids per-sample filter coefficient maths
    filter(v, type, f, q) {
      const b = ac.createBiquadFilter(); b.type = type;
      try { b.frequency.automationRate = 'k-rate'; } catch (e) { /* older engines: a-rate */ }
      b.frequency.value = f; b.Q.value = q; v.nodes.push(b); return b;
    },
    panner(v, pan) {
      const p = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
      if (p.pan) { try { p.pan.automationRate = 'k-rate'; } catch (e) { /* fine */ } p.pan.value = pan; }
      v.nodes.push(p); return p;
    },
    noise(v, offset) {
      const s = ac.createBufferSource(); s.buffer = G.noise;
      v.nodes.push(s); v.sources.push(s); v.offsets.set(s, offset); return s;
    },
  };

  /* ---- scheduler ---- */
  function beginStream(t) {
    if (!score) score = SCORES[mood](E);
    if (!song) song = { step: 0 };
    else song.step = Math.ceil(song.step / score.stepsPerChord) * score.stepsPerChord;  // resume on a chord
    song.base = song.step; song.t0 = t; song.nextT = t;
    queue = [];
    if (score.begin) score.begin(t);
  }
  function scheduleUntil(tEnd) {
    while (song.nextT < tEnd) {
      score.step(song.step, song.nextT, song.step - song.base);
      song.step++;
      song.nextT = song.t0 + (song.step - song.base) * score.stepDur;
    }
    if (score.extra) score.extra(tEnd);
    const now = ac.currentTime;
    for (;;) {
      queue.sort((a, b) => a.t - b.t);
      let n = 0;
      while (n < queue.length && queue[n].t < tEnd) n++;
      if (!n) break;
      for (const e of queue.splice(0, n)) {
        let t = e.t;
        if (t < now + 0.005) {                               // late (main thread was busy)
          if (!e.keepLate && now - t > 0.06) continue;      // short notes: drop
          t = now + 0.01;                                    // pads, bass, drone: start a touch late instead
        }
        clock = Math.max(clock, t);
        e.fn(t);
      }
    }
  }
  function wake() {
    timer = 0;
    if (!running) return;
    const wall = performance.now();
    const gap = lastWake ? (wall - lastWake) / 1000 : 0;
    lastWake = wall;
    const now = ac.currentTime;
    if (song.nextT < now - 1) {                              // fell far behind: rejoin at a chord boundary
      song.step = Math.ceil(song.step / score.stepsPerChord) * score.stepsPerChord;
      song.base = song.step; song.t0 = now + 0.1; song.nextT = song.t0;
    }
    scheduleUntil(now + clamp(gap + 0.2, LOOKAHEAD, 3));    // look further ahead if timers are throttled
    timer = setTimeout(wake, TICK_MS);
  }
  function halt() {
    running = false;
    if (timer) { clearTimeout(timer); timer = 0; }
    for (const v of [...live]) kill(v);
    voices = []; queue = []; clock = 0;
  }

  /* ---- master fade (tracked analytically so a fade can reverse smoothly mid-way) ---- */
  function fadeValueAt(t) {
    const f = fadeSeg;
    if (t >= f.t1) return f.v1;
    if (t <= f.t0) return f.v0;
    return f.v0 + ((f.v1 - f.v0) * (t - f.t0)) / (f.t1 - f.t0);
  }
  function fadeTo(target, dur) {
    const g = G.fade.gain, now = ac.currentTime, v0 = fadeValueAt(now);
    const d = Math.max(0.05, dur * Math.abs(target - v0));
    g.cancelScheduledValues(now);
    g.setValueAtTime(v0, now);
    g.linearRampToValueAtTime(target, now + d);
    fadeSeg = { t0: now, v0, t1: now + d, v1: target };
    return now + d;
  }

  /* ---- public API ---- */
  function start() {
    if (state === 'destroyed') return;
    if (!ac) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      try { ac = new AC({ latencyHint: 'playback' }); } catch (e) { ac = new AC(); }
    }
    if (!G) G = build();
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = 0; }
    if (!isOffline() && ac.state !== 'running' && ac.state !== 'closed') {
      const p = ac.resume();
      if (p && p.catch) p.catch(() => {});
    }
    if (state === 'on') return;
    state = 'on';
    fadeTo(1, FADE_IN);
    if (!running) {
      running = true;
      beginStream(ac.currentTime + 0.06);
      if (isOffline()) scheduleUntil(ac.length / ac.sampleRate);
      else { lastWake = 0; wake(); }
    }
  }
  function stop() {
    if (!ac || state !== 'on') return;
    state = 'stopping';
    const end = fadeTo(0, FADE_OUT);
    if (isOffline()) { state = 'off'; return; }
    const finish = () => {
      stopTimer = 0;
      if (state !== 'stopping') return;
      if (ac.state === 'running' && ac.currentTime < end - 0.01) {
        stopTimer = setTimeout(finish, (end - ac.currentTime) * 1000 + 30);
        return;
      }
      halt();
      state = 'off';
      if (owns && ac.state === 'running') ac.suspend().catch(() => {});
    };
    stopTimer = setTimeout(finish, FADE_OUT * 1000 + 60);
  }
  function destroy() {
    if (state === 'destroyed') return;
    const audible = G && state !== 'off' && !isOffline() && ac.state === 'running';
    state = 'destroyed';
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = 0; }
    const finish = () => {
      halt();
      if (G) for (const n of G.all) { try { n.disconnect(); } catch (e) { /* fine */ } }
      if (owns && ac && ac.state !== 'closed') ac.close().catch(() => {});
    };
    if (audible) { fadeTo(0, 0.06); setTimeout(finish, 90); } else finish();
  }

  return {
    start,
    stop,
    toggle() { if (state === 'on') stop(); else start(); return state === 'on'; },
    setVolume(v) {
      volume = clamp(Number(v) || 0, 0, 1);
      if (G) G.out.gain.setTargetAtTime(volume * volume, ac.currentTime, 0.06);
    },
    get on() { return state === 'on'; },
    destroy,
    renderAhead(seconds) {
      if (state === 'destroyed') return;
      if (state !== 'on') start();
      if (running) scheduleUntil(ac.currentTime + Math.max(0, Number(seconds) || 0));
    },
  };
}

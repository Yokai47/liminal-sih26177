/* LIMINAL · Act 2 · audio.js — the acoustic scene of a collapsed floor, and what the drone's microphone pipeline makes of it.
   (Acoustic sensing is a planned payload in the deck; this models the intended pipeline.)
     sources   3 human (calling, moaning, tapping) + 6 non-human (burst pipe, arcing panel, fire, creaks/debris, siren outside, rotor ego-noise)
     channel   level at the mic = L₁ₘ − 20·log10(r) − ~8 dB per wall crossed (high frequencies lose more)
     pipeline  4-mic array → ego-noise suppression (rotor harmonics + spectral subtraction) → class mask (separation)
               → classifier → GCC-PHAT direction of arrival (DoA, σ grows as SNR falls) → bearings from several hover
               positions → least-squares triangulation → an estimate the planner can use.
   The numbers come from the model below (so they work with sound off); the speakers play the same events when enabled. */
import * as THREE from 'three';

export const CLASSES = [
  { k: 'VOICE', human: true, c: '#c9a0ff', label: 'voice · calling' },
  { k: 'MOAN', human: true, c: '#ff9ad5', label: 'moan' },
  { k: 'TAP', human: true, c: '#ffd36b', label: 'tapping · metal' },
  { k: 'WATER', human: false, c: '#5fc9ff', label: 'water · flow' },
  { k: 'ELEC', human: false, c: '#9cff6b', label: 'electrical arc · 50 Hz' },
  { k: 'FIRE', human: false, c: '#ff7a3a', label: 'fire · crackle' },
  { k: 'CREAK', human: false, c: '#b8a68a', label: 'structure · creak/debris' },
  { k: 'SIREN', human: false, c: '#7f9cff', label: 'siren · outside' },
  { k: 'ROTOR', human: false, c: '#8a96a6', label: 'rotor ego-noise' },
];
const CI = Object.fromEntries(CLASSES.map((c, i) => [c.k, i]));
const NB = 64, FMIN = 60, FMAX = 8000;
const binF = b => FMIN * Math.pow(FMAX / FMIN, b / (NB - 1));

export function createAcoustic(W, { tier } = {}) {
  const N = W.named, bvh = W.bvh;
  const SRC = [
    { k: 'VOICE', tg: 'P1', pos: new THREE.Vector3(N.P1.pos.x + .7, .4, N.P1.pos.z), L: 88, next: 3, ev: true },
    { k: 'MOAN', tg: 'P2', pos: new THREE.Vector3(N.P2.pos.x, .35, N.P2.pos.z), L: 70, next: 5, ev: true },
    { k: 'TAP', tg: 'P3', pos: new THREE.Vector3(37.25, .9, -17.35), L: 79, next: 4, ev: true },
    { k: 'WATER', pos: new THREE.Vector3(28.6, 1.6, -15.5), L: 71, cont: true },
    { k: 'ELEC', pos: new THREE.Vector3(39.5, 1.3, -11.5), L: 63, cont: true, next: 6, ev: true },
    { k: 'FIRE', pos: new THREE.Vector3(28.2, .6, -13.7), L: 66, cont: true },
    { k: 'CREAK', pos: new THREE.Vector3(29.5, 2.5, -6.5), L: 72, next: 14, ev: true, roam: [[29.5, -6.5], [26, -6], [37.3, -18.1], [9, -20.5], [17, -32], [13.2, -25.8]] },
    { k: 'SIREN', pos: new THREE.Vector3(6, 1.5, 34), L: 88, cont: true },
  ];
  const A = {
    on: true, events: [], lvl: new Float32Array(CLASSES.length), p: new Float32Array(CLASSES.length), snr: new Float32Array(CLASSES.length),
    tracks: CLASSES.filter(c => c.human).map(c => ({ cls: c.k, human: true, src: SRC.find(s => s.k === c.k).tg, bearings: [], last: null, est: null, open: true, n: 0, conf: 0, firstT: null })),
    noise: 0, raw: [], clean: [], specRaw: new Float32Array(NB), specClean: new Float32Array(NB), lastDoA: null, doaHist: [], newBearings: [], walls: new Float32Array(SRC.length), dist: new Float32Array(SRC.length), wallT: 0,
    egoRes: 42, egoRaw: 78, rate: 16000, frameMs: 32,
  };
  const ray = new THREE.Ray();
  const gauss = () => { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2832 * Math.random()); };

  function wallsBetween(x0, y0, z0, x1, y1, z1) { // count surfaces crossed (each wall has two faces)
    const d = Math.hypot(x1 - x0, y1 - y0, z1 - z0); ray.origin.set(x0, y0, z0); ray.direction.set((x1 - x0) / d, (y1 - y0) / d, (z1 - z0) / d);
    let n = 0, t0 = 0; for (let k = 0; k < 8; k++) { const h = bvh.raycastFirst(ray, THREE.DoubleSide, t0 + .02, d - .3); if (!h) break; n++; t0 = h.distance; } return n / 2; }

  function reset() { for (const t of A.tracks) { Object.assign(t, { bearings: [], last: null, est: null, open: true, n: 0, conf: 0, firstT: null, investigated: false }); t.ll.fill(0); t.P.fill(0); } A.events = []; A.doaHist = []; A.newBearings = []; SRC.forEach(s => { if (s.ev) s.next = s.k === 'VOICE' ? 3 : s.k === 'MOAN' ? 5 : s.k === 'TAP' ? 4 : 10; }); }

  function update(dt, ctx) {
    // ctx: { t, x,y,z,yaw (true mic pose), e:[ex,ez] (estimate error), enabled (acoustic on), moving, closeTrack(cls) }
    const t = ctx.t;
    // geometry refresh (2 Hz)
    A.wallT -= dt;
    if (A.wallT <= 0) { A.wallT = .5; SRC.forEach((s, i) => { A.dist[i] = Math.hypot(s.pos.x - ctx.x, s.pos.z - ctx.z, s.pos.y - ctx.y); A.walls[i] = s.k === 'SIREN' ? 2 : wallsBetween(ctx.x, ctx.y, ctx.z, s.pos.x, s.pos.y, s.pos.z); }); }
    // events
    for (const s of SRC) if (s.ev && t >= s.next) {
      if (s.k === 'VOICE') { const scream = Math.random() < .3; A.events.push({ k: 'VOICE', s, t0: t, dur: scream ? 1.3 : .9, f0: scream ? 410 : 225, scream, word: scream ? 'aaah!' : Math.random() < .5 ? 'help!' : 'help… here!' }); s.next = t + 6.5 + Math.random() * 3.5; }
      else if (s.k === 'MOAN') { A.events.push({ k: 'MOAN', s, t0: t, dur: 1.9, f0: 112 }); s.next = t + 6 + Math.random() * 3; }
      else if (s.k === 'TAP') { const n = 3; A.events.push({ k: 'TAP', s, t0: t, dur: .85, n }); s.next = t + 5.5 + Math.random() * 1.5; }
      else if (s.k === 'ELEC') { A.events.push({ k: 'ELEC', s, t0: t, dur: .35, zap: true }); s.next = t + 4 + Math.random() * 6; ctx.onZap && ctx.onZap(); }
      else if (s.k === 'CREAK') { const r = s.roam[(Math.random() * s.roam.length) | 0]; s.pos.set(r[0], 2.4, r[1]); A.wallT = 0; A.events.push({ k: 'CREAK', s, t0: t, dur: 1.6 }); s.next = t + 12 + Math.random() * 10; }
    }
    A.events = A.events.filter(e => t - e.t0 < e.dur + .1);
    // received levels per class (dB at the mic)
    const Lr = new Float32Array(CLASSES.length).fill(-99);
    SRC.forEach((s, i) => { const r = Math.max(.6, A.dist[i]); let L = s.L - 20 * Math.log10(r) - 8 * A.walls[i];
      if (s.ev && !s.cont) { const e = A.events.find(e => e.s === s); if (!e) return; const ph = (t - e.t0) / e.dur; L += e.k === 'VOICE' && e.scream ? 5 : 0; L += env(e.k, ph) ; }
      else if (s.k === 'ELEC') { const e = A.events.find(e => e.s === s); if (e) L += 18; L += 3 * Math.sin(t * 7) * Math.random(); }
      else if (s.k === 'WATER') L += 1.5 * Math.sin(t * 1.3) + gauss() * .8;
      else if (s.k === 'FIRE') L += 4 * Math.random();
      const c = CI[s.k]; Lr[c] = Math.max(Lr[c], L); });
    Lr[CI.ROTOR] = ctx.rotor ? A.egoRaw + gauss() * .6 : -99;
    // in-band noise for the human classes after ego-noise suppression
    const pw = db => Math.pow(10, db / 10);
    let envP = pw(30); for (const c of ['WATER', 'ELEC', 'FIRE', 'CREAK', 'SIREN']) envP += pw(Lr[CI[c]]) * (c === 'WATER' ? 1 : .6);
    const egoRes = ctx.rotor ? A.egoRes : 20; A.noise = 10 * Math.log10(envP + pw(egoRes));
    const G = { VOICE: 8, MOAN: 6, TAP: 12 };
    for (let c = 0; c < CLASSES.length; c++) { const k = CLASSES[c].k; A.lvl[c] = Lr[c];
      const snr = CLASSES[c].human ? Lr[c] - A.noise + G[k] : Lr[c] - 40; A.snr[c] = snr;
      const want = ctx.enabled ? 1 / (1 + Math.exp(-(snr - 3) / 2)) : 0; A.p[c] += (want - A.p[c]) * Math.min(1, dt * (want > A.p[c] ? 8 : 1.5)); }
    // detections → DoA bearings (one per human event, measured mid-event)
    A.newBearings.length = 0;
    if (ctx.enabled) for (const e of A.events) { const c = CLASSES[CI[e.k]]; if (!c.human || e.measured) continue; if (t - e.t0 < e.dur * .5) continue; e.measured = true;
      const snr = A.snr[CI[e.k]]; if (snr < 3) { e.missed = true; continue; }
      const trueB = Math.atan2(e.s.pos.x - ctx.x, e.s.pos.z - ctx.z), sig = (4 + 28 * Math.exp(-(snr - 3) / 5)) * Math.PI / 180 * (ctx.moving ? 1.35 : 1);
      const b = trueB + gauss() * sig, ex = ctx.x + ctx.e[0], ez = ctx.z + ctx.e[1];
      const tr = A.tracks.find(k => k.cls === e.k); if (!tr.open) continue;
      const m = { x: ex, z: ez, b, s: sig, t, snr }; tr.n++; if (tr.firstT == null) tr.firstT = t;
      tr.conf = Math.min(.98, 1 / (1 + Math.exp(-(snr - 3) / 2)));
      // a bearing from (almost) the same spot adds no range information: it only refines the last one
      const prev = tr.bearings.find(p => Math.hypot(p.x - ex, p.z - ez) < 1.5);
      if (prev) { const w = (1 / (prev.s * prev.s)) / (1 / (prev.s * prev.s) + 1 / (sig * sig)); const db = Math.atan2(Math.sin(b - prev.b), Math.cos(b - prev.b));
        prev.b = prev.b + (1 - w) * db; prev.s = Math.sqrt(1 / (1 / (prev.s * prev.s) + 1 / (sig * sig))); prev.t = t; m.merged = true; tr.last = prev; rebuild(tr); }
      else { tr.bearings.push(m); if (tr.bearings.length > 30) tr.bearings.shift(); tr.last = m; triangulate(tr); } A.newBearings.push({ tr, m }); A.lastDoA = { cls: e.k, b, s: sig, t, snr, rel: b - Math.atan2(-Math.sin(ctx.yaw), -Math.cos(ctx.yaw)) };
      A.doaHist.push({ cls: e.k, b, s: sig, t }); if (A.doaHist.length > 24) A.doaHist.shift(); }
    // spectrogram columns (model spectra: what RAW and CLEAN contain right now)
    spectra(t, Lr, ctx);
  }
  function env(k, ph) { if (ph < 0 || ph > 1) return -60; if (k === 'VOICE') return -20 * Math.pow(Math.abs(ph - .45) / .55, 2); if (k === 'MOAN') return -14 * Math.pow(Math.abs(ph - .5) / .5, 2); if (k === 'TAP') { const f = (ph * 3) % 1; return f < .12 ? 0 : -30; } if (k === 'CREAK') return -6 - 10 * Math.abs(ph - .4); return 0; }

  // bearing-only localisation: a posterior over 1 m cells, one per acoustic class (robust to outliers)
  const PG = { x0: -2, z0: -36, nx: 44, nz: 38 };
  for (const tr of A.tracks) { tr.ll = new Float32Array(PG.nx * PG.nz); tr.P = new Float32Array(PG.nx * PG.nz); tr.PG = PG;
    tr.massNear = (x, z, r) => { let m = 0; const i0 = Math.max(0, Math.floor(x - r - PG.x0)), i1 = Math.min(PG.nx - 1, Math.floor(x + r - PG.x0)), j0 = Math.max(0, Math.floor(z - r - PG.z0)), j1 = Math.min(PG.nz - 1, Math.floor(z + r - PG.z0));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const cx = PG.x0 + i + .5, cz = PG.z0 + j + .5; if ((cx - x) ** 2 + (cz - z) ** 2 <= r * r) m += tr.P[j * PG.nx + i]; } return m; }; }
  function rebuild(tr) { tr.ll.fill(0); const keep = tr.bearings; for (const m of keep) addBearing(tr, m); normalise(tr); }
  function addBearing(tr, m) { const ll = tr.ll;
    for (let j = 0; j < PG.nz; j++) for (let i = 0; i < PG.nx; i++) { const k = j * PG.nx + i, cx = PG.x0 + i + .5, cz = PG.z0 + j + .5, dx = cx - m.x, dz = cz - m.z, r = Math.hypot(dx, dz);
      const da = Math.atan2(Math.sin(Math.atan2(dx, dz) - m.b), Math.cos(Math.atan2(dx, dz) - m.b)), s = m.s + .5 / Math.max(2, r);
      ll[k] += Math.log(.9 * Math.exp(-da * da / (2 * s * s)) + .1 * .16) - (r < 1.5 ? 2 : 0); } }
  function triangulate(tr) { addBearing(tr, tr.last); normalise(tr); }
  function normalise(tr) {
    const ll = tr.ll, P = tr.P; let mx = -1e9; for (let k = 0; k < ll.length; k++) if (ll[k] > mx) mx = ll[k];
    let sum = 0; for (let k = 0; k < ll.length; k++) { P[k] = Math.exp(ll[k] - mx); sum += P[k]; }
    let ex = 0, ez = 0, pk = 0; for (let k = 0; k < P.length; k++) { P[k] /= sum; const cx = PG.x0 + (k % PG.nx) + .5, cz = PG.z0 + ((k / PG.nx) | 0) + .5; ex += P[k] * cx; ez += P[k] * cz; if (P[k] > pk) pk = P[k]; }
    let sxx = 0, sxz = 0, szz = 0; for (let k = 0; k < P.length; k++) { const dx = PG.x0 + (k % PG.nx) + .5 - ex, dz = PG.z0 + ((k / PG.nx) | 0) + .5 - ez; sxx += P[k] * dx * dx; sxz += P[k] * dx * dz; szz += P[k] * dz * dz; }
    const tr2 = (sxx + szz) / 2, dd = Math.sqrt(Math.max(0, tr2 * tr2 - (sxx * szz - sxz * sxz))), l1 = tr2 + dd, l2 = Math.max(1e-6, tr2 - dd);
    let base = 0; for (const a of tr.bearings) for (const b of tr.bearings) base = Math.max(base, Math.hypot(a.x - b.x, a.z - b.z));
    tr.est = tr.n >= 2 ? { x: ex, z: ez, s: Math.sqrt(l1), s2: Math.sqrt(l2), ang: .5 * Math.atan2(2 * sxz, sxx - szz), n: tr.bearings.length, base, peak: pk } : null;
  }

  // ----- model spectra for the RAW / CLEAN spectrograms -----
  const lin = db => Math.pow(10, (db - 30) / 20);
  function spectra(t, Lr, ctx) {
    const R = A.specRaw, C = A.specClean; R.fill(0); C.fill(0);
    const add = (arr, b, v) => { if (b >= 0 && b < NB) arr[b] += v; };
    const fb = f => Math.round((NB - 1) * Math.log(f / FMIN) / Math.log(FMAX / FMIN));
    const band = (arr, f0, f1, v, tilt = 0) => { for (let b = fb(f0); b <= fb(f1); b++) add(arr, b, v * (1 + tilt * (b / NB - .5)) * (.75 + .5 * Math.random())); };
    const harm = (arr, f0, v, formants, n = 24) => { for (let k = 1; k <= n; k++) { const f = f0 * k; if (f > FMAX) break; let g = 0; for (const [F, bw] of formants) g += Math.exp(-Math.pow((f - F) / bw, 2)); add(arr, fb(f), v * (.15 + g)); } };
    const both = (fn, keep) => { fn(R); if (keep) fn(C); };
    // rotor: harmonics of the blade-pass frequency + broadband; the clean path removes it
    if (ctx.rotor) { const v = lin(Lr[CI.ROTOR]); for (let k = 1; k < 30; k++) add(R, fb(92 * k), v * 1.6 / Math.sqrt(k)); band(R, 60, 1800, v * .55, -1.2); band(C, 60, 1800, v * .025, -1.2); }
    const mask = (k) => CLASSES[CI[k]].human ? 1 : .06; // separation mask
    const sv = k => lin(Lr[CI[k]]);
    if (Lr[CI.WATER] > 0) { const v = sv('WATER'); band(R, 250, 7000, v * .5); band(C, 250, 7000, v * .5 * mask('WATER')); if (Math.random() < .25) { const f = 1200 + Math.random() * 1500; add(R, fb(f), v * 2); } }
    if (Lr[CI.ELEC] > 0) { const v = sv('ELEC'); for (let k = 1; k < 14; k++) { add(R, fb(50 * k), v * 1.3 / k); add(C, fb(50 * k), v * 1.3 / k * mask('ELEC')); } if (Math.random() < .3) band(R, 2000, 8000, v * .7); }
    if (Lr[CI.FIRE] > 0 && Math.random() < .5) { const v = sv('FIRE'); band(R, 400, 8000, v * .6); band(C, 400, 8000, v * .6 * mask('FIRE')); }
    if (Lr[CI.CREAK] > 0) { const v = sv('CREAK'), f = 150 + 120 * Math.sin(t * 2.3); for (let k = 1; k < 5; k++) { add(R, fb(f * k), v / k); add(C, fb(f * k), v / k * mask('CREAK')); } band(R, 60, 300, v * .4); }
    if (Lr[CI.SIREN] > 0) { const v = sv('SIREN'), f = 875 + 225 * Math.sin(t * 1.6); add(R, fb(f), v * 2); add(R, fb(2 * f), v * .7); add(C, fb(f), v * 2 * mask('SIREN')); }
    for (const e of A.events) { const c = CLASSES[CI[e.k]]; if (!c.human) continue; const v = sv(e.k) * (ctx.enabled ? 1 : 1); if (Lr[CI[e.k]] < 0) continue;
      const ph = (t - e.t0) / e.dur;
      if (e.k === 'VOICE') { const f0 = e.f0 * (1 + .12 * Math.sin(ph * 3.1) - .1 * ph); const fm = e.scream ? [[850, 220], [1250, 260], [2900, 400]] : ph < .55 ? [[600, 130], [1900, 220], [2600, 300]] : [[360, 100], [1300, 200], [2500, 300]]; for (const arr of [R, C]) harm(arr, f0, v * 1.4, fm); if (ph < .1) band(R, 1500, 6000, v * .3); }
      if (e.k === 'MOAN') { for (const arr of [R, C]) harm(arr, e.f0 * (1 - .08 * ph), v * 1.5, [[480, 120], [880, 180], [2400, 400]]); }
      if (e.k === 'TAP') { const f = (ph * 3) % 1; if (f < .14) for (const arr of [R, C]) { band(arr, 300, 8000, v * .5); add(arr, fb(2200), v * 3); add(arr, fb(3400), v * 2); add(arr, fb(5100), v * 1.2); } }
    }
    A.colRaw = R.slice(); A.colClean = C.slice();
  }

  // ======================================================================
  // WebAudio: the same scene, audible. Off until the viewer enables it.
  // ======================================================================
  const S = { ctx: null, mode: 'off', master: null, raw: null, clean: null, nodes: {}, noise: null, started: false };
  function ensure() {
    if (S.ctx) return true;
    try { S.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return false; }
    const a = S.ctx;
    S.master = a.createGain(); S.master.gain.value = 0; S.master.connect(a.destination);
    S.rawBus = a.createGain(); S.cleanBus = a.createGain(); S.rawSel = a.createGain(); S.cleanSel = a.createGain();
    S.rawBus.connect(S.rawSel); S.cleanBus.connect(S.cleanSel); S.rawSel.connect(S.master); S.cleanSel.connect(S.master);
    // clean bus = voice band, rotor removed
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220; const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    S.cleanIn = a.createGain(); S.cleanIn.connect(hp); hp.connect(lp); lp.connect(S.cleanBus);
    // noise buffer
    const len = a.sampleRate * 2, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0); let b0 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; d[i] = w; } S.noise = buf;
    const pink = a.createBuffer(1, len, a.sampleRate), pd = pink.getChannelData(0); let p0 = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; p0 = .99765 * p0 + w * .099046; p1 = .963 * p1 + w * .2965164; p2 = .57 * p2 + w * 1.0526913; pd[i] = (p0 + p1 + p2 + w * .1848) * .2; } S.pink = pink;
    // continuous sources
    S.nodes.rotor = rotorNode(a); S.nodes.water = waterNode(a); S.nodes.elec = elecNode(a); S.nodes.fire = fireNode(a); S.nodes.siren = sirenNode(a);
    return true;
  }
  function chain(a, src, cleanGain) { // src → [gain] → lowpass (walls) → panner → raw bus (+ clean bus at cleanGain)
    const g = a.createGain(); g.gain.value = 0; const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 8000; const pan = a.createStereoPanner ? a.createStereoPanner() : a.createGain();
    src.connect(g); g.connect(lp); lp.connect(pan); pan.connect(S.rawBus); const cg = a.createGain(); cg.gain.value = cleanGain; pan.connect(cg); cg.connect(S.cleanIn);
    return { g, lp, pan }; }
  function loop(a, buf, rate = 1) { const s = a.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(); return s; }
  function rotorNode(a) { const o1 = a.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 92; const o2 = a.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 97;
    const n = loop(a, S.pink); const bp = a.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 1400; const mix = a.createGain(); mix.gain.value = 1;
    const og = a.createGain(); og.gain.value = .25; o1.connect(og); o2.connect(og); og.connect(bp); n.connect(bp); bp.connect(mix); o1.start(); o2.start();
    const g = a.createGain(); g.gain.value = 0; mix.connect(g); g.connect(S.rawBus); const cg = a.createGain(); cg.gain.value = .02; g.connect(cg); cg.connect(S.cleanIn); return { g, o1, o2 }; }
  function waterNode(a) { const n = loop(a, S.noise); const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = .5; const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
    n.connect(bp); bp.connect(hp); const lfo = a.createOscillator(); lfo.frequency.value = .7; const lg = a.createGain(); lg.gain.value = 260; lfo.connect(lg); lg.connect(bp.frequency); lfo.start(); return chain(a, hp, .06); }
  function elecNode(a) { const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 50; const ws = a.createWaveShaper(); const cur = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; cur[i] = Math.tanh(x * 4); } ws.curve = cur;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = .7; o.connect(ws); ws.connect(bp); o.start(); return chain(a, bp, .05); }
  function fireNode(a) { const n = loop(a, S.pink, .6); const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; n.connect(lp); return chain(a, lp, .05); }
  function sirenNode(a) { const o = a.createOscillator(); o.type = 'triangle'; o.frequency.value = 875; const l = a.createOscillator(); l.frequency.value = .26; const lg = a.createGain(); lg.gain.value = 225; l.connect(lg); lg.connect(o.frequency); l.start(); o.start(); return chain(a, o, .04); }

  function playEvent(e, gainLin, pan, cut) {
    const a = S.ctx, t = a.currentTime; const out = a.createGain(); out.gain.value = gainLin; const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut; const p = a.createStereoPanner ? a.createStereoPanner() : a.createGain(); if (p.pan) p.pan.value = pan;
    out.connect(lp); lp.connect(p); p.connect(S.rawBus); const cg = a.createGain(); cg.gain.value = CLASSES[CI[e.k]].human ? 2.2 : .05; p.connect(cg); cg.connect(S.cleanIn);
    const stopAt = t + e.dur + .3;
    if (e.k === 'VOICE' || e.k === 'MOAN') {
      const o = a.createOscillator(); o.type = 'sawtooth'; const f0 = e.f0; o.frequency.setValueAtTime(f0, t);
      if (e.k === 'VOICE') { o.frequency.linearRampToValueAtTime(f0 * 1.14, t + e.dur * .35); o.frequency.linearRampToValueAtTime(f0 * .86, t + e.dur); } else o.frequency.linearRampToValueAtTime(f0 * .9, t + e.dur);
      const vib = a.createOscillator(); vib.frequency.value = 5.5; const vg = a.createGain(); vg.gain.value = f0 * .025; vib.connect(vg); vg.connect(o.frequency); vib.start(t); vib.stop(stopAt);
      const fm = e.k === 'MOAN' ? [[480, 6], [880, 7], [2400, 9]] : e.scream ? [[850, 5], [1250, 6], [2900, 8]] : [[600, 6], [1900, 9], [2600, 10]];
      const env = a.createGain(); env.gain.setValueAtTime(0, t);
      if (e.k === 'VOICE' && !e.scream) { // "hel-p": h (noise) → e → l → p burst
        const nn = a.createBufferSource(); nn.buffer = S.noise; const nh = a.createBiquadFilter(); nh.type = 'bandpass'; nh.frequency.value = 1800; nh.Q.value = .8; const ng = a.createGain(); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(.35, t + .04); ng.gain.linearRampToValueAtTime(0, t + .12);
        nn.connect(nh); nh.connect(ng); ng.connect(out); nn.start(t); nn.stop(t + .2);
        env.gain.linearRampToValueAtTime(.9, t + .1); env.gain.setValueAtTime(.9, t + e.dur * .5); env.gain.linearRampToValueAtTime(.55, t + e.dur * .7); env.gain.linearRampToValueAtTime(0, t + e.dur * .85);
        const pb = a.createBufferSource(); pb.buffer = S.noise; const pg = a.createGain(); pg.gain.setValueAtTime(0, t + e.dur * .9); pg.gain.linearRampToValueAtTime(.5, t + e.dur * .91); pg.gain.exponentialRampToValueAtTime(.001, t + e.dur * .98);
        const ph = a.createBiquadFilter(); ph.type = 'highpass'; ph.frequency.value = 1500; pb.connect(ph); ph.connect(pg); pg.connect(out); pb.start(t); pb.stop(stopAt);
      } else { env.gain.linearRampToValueAtTime(e.k === 'MOAN' ? .8 : 1, t + e.dur * .3); env.gain.linearRampToValueAtTime(e.k === 'MOAN' ? .6 : .8, t + e.dur * .7); env.gain.linearRampToValueAtTime(0, t + e.dur); }
      const fs = fm.map(([f, q]) => { const b = a.createBiquadFilter(); b.type = 'bandpass'; b.frequency.setValueAtTime(f, t); b.Q.value = q; return b; });
      if (e.k === 'VOICE' && !e.scream) { fs[0].frequency.linearRampToValueAtTime(360, t + e.dur * .7); fs[1].frequency.linearRampToValueAtTime(1300, t + e.dur * .7); }
      const sum = a.createGain(); sum.gain.value = 1; for (const b of fs) { o.connect(b); b.connect(sum); }
      sum.connect(env); env.connect(out); o.start(t); o.stop(stopAt);
    } else if (e.k === 'TAP') {
      for (let k = 0; k < e.n; k++) { const tt = t + k * .28; for (const [f, q, gg] of [[2200, 30, 1], [3400, 30, .6], [5100, 25, .35]]) { const n = a.createBufferSource(); n.buffer = S.noise; const b = a.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; const g = a.createGain(); g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(gg * 6, tt + .002); g.gain.exponentialRampToValueAtTime(.001, tt + .28); n.connect(b); b.connect(g); g.connect(out); n.start(tt); n.stop(tt + .32); } }
    } else if (e.k === 'ELEC') {
      const n = a.createBufferSource(); n.buffer = S.noise; const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900; const g = a.createGain(); g.gain.setValueAtTime(0, t);
      for (let k = 0; k < 7; k++) { const tt = t + Math.random() * e.dur; g.gain.setValueAtTime(.9, tt); g.gain.setValueAtTime(.05, tt + .015 + Math.random() * .03); } g.gain.setValueAtTime(0, t + e.dur);
      n.connect(hp); hp.connect(g); g.connect(out); n.start(t); n.stop(stopAt);
    } else if (e.k === 'CREAK') {
      const n = a.createBufferSource(); n.buffer = S.pink; const b = a.createBiquadFilter(); b.type = 'bandpass'; b.Q.value = 18; b.frequency.setValueAtTime(260, t); b.frequency.linearRampToValueAtTime(140, t + e.dur);
      const g = a.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(3, t + .3); g.gain.linearRampToValueAtTime(0, t + e.dur); n.connect(b); b.connect(g); g.connect(out); n.start(t); n.stop(stopAt);
      for (let k = 0; k < 6; k++) { const tt = t + .6 + Math.random() * .9, c = a.createBufferSource(); c.buffer = S.noise; const cg2 = a.createGain(); cg2.gain.setValueAtTime(.5, tt); cg2.gain.exponentialRampToValueAtTime(.001, tt + .05); const cb = a.createBiquadFilter(); cb.type = 'bandpass'; cb.frequency.value = 600 + Math.random() * 1500; c.connect(cb); cb.connect(cg2); cg2.connect(out); c.start(tt); c.stop(tt + .08); }
    }
  }
  function audible(ctx) { // per-frame: gains/pans for continuous sources, trigger new events
    if (!S.ctx || S.mode === 'off') return;
    const a = S.ctx, now = a.currentTime;
    const dbg = db => Math.min(1.5, Math.pow(10, (db - 70) / 20));
    const geo = (s, i) => { const L = s.L - 20 * Math.log10(Math.max(.6, A.dist[i])) - 8 * A.walls[i]; const b = Math.atan2(s.pos.x - ctx.x, s.pos.z - ctx.z), fwd = Math.atan2(-Math.sin(ctx.yaw), -Math.cos(ctx.yaw));
      const rel = Math.atan2(Math.sin(b - fwd), Math.cos(b - fwd)); return { g: dbg(L), pan: Math.max(-1, Math.min(1, Math.sin(rel))), cut: 8000 / (1 + A.walls[i] * 2.5) }; };
    SRC.forEach((s, i) => { const key = s.k === 'WATER' ? 'water' : s.k === 'ELEC' ? 'elec' : s.k === 'FIRE' ? 'fire' : s.k === 'SIREN' ? 'siren' : null; if (!key) return; const n = S.nodes[key], q = geo(s, i);
      n.g.gain.setTargetAtTime(q.g * (key === 'siren' ? .8 : key === 'elec' ? .5 : .55), now, .08); n.lp.frequency.setTargetAtTime(q.cut, now, .1); if (n.pan.pan) n.pan.pan.setTargetAtTime(q.pan, now, .1); });
    S.nodes.rotor.g.gain.setTargetAtTime(ctx.rotor ? .16 : 0, now, .2);
    for (const e of A.events) { if (e.played) continue; e.played = true; const i = SRC.indexOf(e.s); const q = geo(e.s, i); playEvent(e, q.g * (e.k === 'TAP' ? .3 : e.k === 'ELEC' ? .7 : .5), q.pan, q.cut); }
  }
  function setMode(m) { if (m !== 'off' && !ensure()) return 'off'; S.mode = m; if (!S.ctx) return m; if (S.ctx.state === 'suspended') S.ctx.resume();
    const now = S.ctx.currentTime; S.muted = false; S.master.gain.setTargetAtTime(m === 'off' ? 0 : .9, now, .05); S.rawSel.gain.setTargetAtTime(m === 'raw' ? 1 : 0, now, .05); S.cleanSel.gain.setTargetAtTime(m === 'clean' ? 1 : 0, now, .05); return m; }
  function close() { try { S.ctx && S.ctx.close(); } catch (e) {} }
  function mute(m) { if (!S.ctx || S.muted === m) return; S.muted = m; S.master.gain.setTargetAtTime(m || S.mode === 'off' ? 0 : .9, S.ctx.currentTime, .05); }

  return { A, SRC, update, reset, audible, setMode, close, mute, CLASSES, NB, binF };
}

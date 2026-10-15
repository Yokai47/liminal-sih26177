// LIMINAL Act 1 — all sound is synthesised in WebAudio (no files): taps from under the rubble (spatialised),
// a night-to-dawn bed, rotor hum that scales with how many drones are in view, gossip blips, dawn birds, UI ticks.
export function createSound() {
  let ctx = null, on = false, master, comp, verb, wet, bed = {}, hum = {}, tapBus, tapPan, birdsT = 0, gossipT = 0;
  const st = { dawn: 0, drones: 0, swarm: 0, muffle: 1, level: 1 };

  function ir(sec, decay) {
    const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
  function noiseBuf(sec) {
    const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let p = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; p = .97 * p + .03 * w; d[i] = w * .35 + p * 2.2; }
    return b;
  }
  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    master = ctx.createGain(); master.gain.value = 0; master.connect(comp); comp.connect(ctx.destination);
    verb = ctx.createConvolver(); verb.buffer = ir(3.2, 2.6); wet = ctx.createGain(); wet.gain.value = .32; verb.connect(wet); wet.connect(master);
    // --- bed: low hum + wind, a dawn chord that fades in, everything through one filter that opens with the light
    bed.f = ctx.createBiquadFilter(); bed.f.type = 'lowpass'; bed.f.frequency.value = 380; bed.f.Q.value = .4;
    bed.g = ctx.createGain(); bed.g.gain.value = .5; bed.f.connect(bed.g); bed.g.connect(master); bed.g.connect(verb);
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55; const g1 = ctx.createGain(); g1.gain.value = .16; o1.connect(g1); g1.connect(bed.f); o1.start();
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 82.6; const g2 = ctx.createGain(); g2.gain.value = .05; o2.connect(g2); g2.connect(bed.f); o2.start();
    const nz = ctx.createBufferSource(); nz.buffer = noiseBuf(6); nz.loop = true; const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 300; nf.Q.value = .6;
    const ng = ctx.createGain(); ng.gain.value = .12; nz.connect(nf); nf.connect(ng); ng.connect(bed.f); nz.start(); bed.wind = nf;
    const lfo = ctx.createOscillator(); lfo.frequency.value = .07; const lg = ctx.createGain(); lg.gain.value = 140; lfo.connect(lg); lg.connect(nf.frequency); lfo.start();
    bed.chord = ctx.createGain(); bed.chord.gain.value = 0; bed.chord.connect(master); bed.chord.connect(verb);
    [220, 329.6, 493.9, 554.4, 659.3].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = (i % 2 ? 4 : -4);
      const g = ctx.createGain(); g.gain.value = [.09, .06, .035, .03, .02][i]; o.connect(g); g.connect(bed.chord); o.start();
    });
    // --- rotor hum: several detuned saws through a band-pass with a fast tremolo
    hum.g = ctx.createGain(); hum.g.gain.value = 0; hum.f = ctx.createBiquadFilter(); hum.f.type = 'bandpass'; hum.f.frequency.value = 900; hum.f.Q.value = .9;
    hum.f.connect(hum.g); hum.g.connect(master); hum.g.connect(verb);
    hum.o = [196, 201.5, 207, 213.8, 189.2].map((f, i) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = i ? 0 : .05; o.connect(g); g.connect(hum.f); o.start(); return g; });
    const tr = ctx.createOscillator(); tr.frequency.value = 37; const tg = ctx.createGain(); tg.gain.value = .25; tr.connect(tg); tg.connect(hum.g.gain); tr.start();
    // --- taps: a bus with a muffling low-pass (they come from under concrete) and an HRTF panner
    tapBus = ctx.createBiquadFilter(); tapBus.type = 'lowpass'; tapBus.frequency.value = 2400;
    tapPan = ctx.createPanner(); tapPan.panningModel = 'HRTF'; tapPan.distanceModel = 'inverse'; tapPan.refDistance = 4; tapPan.rolloffFactor = .6;
    const tg2 = ctx.createGain(); tg2.gain.value = 1.4; tapBus.connect(tapPan); tapPan.connect(tg2); tg2.connect(master); tg2.connect(verb);
  }
  function env(g, t, a, peak, d) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(1e-4, t + a + d); }
  // one knock: knuckle on concrete + the faint ring of a pipe it's touching
  function tap(strength = 1) {
    if (!ctx || !on) return; const t = ctx.currentTime + .005;
    const n = ctx.createBufferSource(); n.buffer = noiseBuf(.25); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 3.5;
    const ng = ctx.createGain(); n.connect(bp); bp.connect(ng); ng.connect(tapBus); env(ng, t, .002, .9 * strength, .09); n.start(t); n.stop(t + .3);
    const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.setValueAtTime(170, t); b.frequency.exponentialRampToValueAtTime(85, t + .08);
    const bg = ctx.createGain(); b.connect(bg); bg.connect(tapBus); env(bg, t, .003, .8 * strength, .14); b.start(t); b.stop(t + .3);
    [1180, 2953, 4310].forEach((f, i) => {
      const o = ctx.createOscillator(); o.frequency.value = f * (1 + (Math.random() - .5) * .004); const g = ctx.createGain(); o.connect(g); g.connect(tapBus);
      env(g, t, .001, [.06, .025, .012][i] * strength, [.9, .5, .3][i]); o.start(t); o.stop(t + 1.2);
    });
  }
  function blip(f = 1800, v = .03, d = .05) {
    if (!ctx || !on) return; const t = ctx.currentTime + .003, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f; o.connect(g); g.connect(master); g.connect(verb); env(g, t, .004, v, d); o.start(t); o.stop(t + d + .05);
  }
  function bird() {
    const t = ctx.currentTime + .01, o = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain(), p = ctx.createStereoPanner();
    const base = 2600 + Math.random() * 1600, n = 2 + (Math.random() * 4 | 0);
    o.frequency.value = base; m.frequency.value = 18 + Math.random() * 30; mg.gain.value = 300 + Math.random() * 500; m.connect(mg); mg.connect(o.frequency);
    p.pan.value = Math.random() * 1.6 - .8; o.connect(g); g.connect(p); p.connect(master); p.connect(verb);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) { const s = t + i * .13; g.gain.linearRampToValueAtTime(.018 * st.dawn, s + .02); g.gain.linearRampToValueAtTime(0, s + .09); o.frequency.setValueAtTime(base * (1 + i * .06), s); o.frequency.exponentialRampToValueAtTime(base * (1.25 + i * .05), s + .08); }
    o.start(t); m.start(t); o.stop(t + n * .13 + .2); m.stop(t + n * .13 + .2);
  }
  function update(dt) {
    if (!ctx || !on) return; const t = ctx.currentTime;
    bed.f.frequency.setTargetAtTime(380 + st.dawn * 2200, t, .4);
    bed.chord.gain.setTargetAtTime(st.dawn * .55, t, 1.2);
    const h = Math.min(1, st.drones);
    hum.g.gain.setTargetAtTime(h * .55, t, .25);
    hum.o.forEach((g, i) => g.gain.setTargetAtTime(i === 0 ? .05 : .045 * Math.min(1, st.swarm * 1.2), t, .4));
    hum.f.frequency.setTargetAtTime(700 + st.swarm * 600, t, .4);
    tapBus.frequency.setTargetAtTime(900 + (1 - st.muffle) * 3000, t, .2);
    if (st.dawn > .35 && (birdsT -= dt) < 0) { birdsT = 1.2 + Math.random() * 3.5 / st.dawn; bird(); }
    if (st.swarm > .3 && (gossipT -= dt) < 0) { gossipT = .12 + Math.random() * .5 / st.swarm; blip(2200 + Math.random() * 1800, .006 * st.swarm, .03); }
  }
  // place the knocking in 3-D relative to the listener (camera)
  function place(src, cam) {
    if (!ctx) return; const t = ctx.currentTime, L = ctx.listener;
    const p = src.clone().applyMatrix4(cam.matrixWorldInverse);
    if (tapPan.positionX) { tapPan.positionX.setTargetAtTime(p.x, t, .05); tapPan.positionY.setTargetAtTime(p.y, t, .05); tapPan.positionZ.setTargetAtTime(p.z, t, .05); }
    else tapPan.setPosition(p.x, p.y, p.z);
    if (L.forwardX) { L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  }
  function setEnabled(v) {
    if (v) init();
    on = v; if (!ctx) return;
    if (v && ctx.state === 'suspended') ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(v ? .9 * st.level : 0, ctx.currentTime, v ? .6 : .15);
  }
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else if (on) ctx.resume(); });
  return { st, tap, blip, update, place, setEnabled, get on() { return on; }, get ctx() { return ctx; } };
}

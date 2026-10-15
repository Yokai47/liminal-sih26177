// Why a drone cannot fly itself: a quad on its own behaves like a broom balanced on a palm. Any tilt turns part of
// the thrust sideways and the tilt grows exponentially (about a second from level to upside down). Only a fast
// stream of corrections keeps it up; too few corrections per second and the corrections themselves arrive too late.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, plot, clamp, gauss } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const LAM = 4.5, TM = 0.02, WN = 15, KP = LAM * LAM + WN * WN, KD = 2 * 0.7 * WN, G = 9.81, H = 0.0002, DEG = 180 / Math.PI;
  const WIN = 4;   // seconds of history in the chart

  let ctrlOn = true, rate = 400;
  const rnd = kit.rng(5);
  // ---------------------------------------------------------------- how fast does a wobble grow at this rate?
  // exact one-period map of the linearised loop [tilt, spin, motor, held command], spectral radius by repeated squaring
  const M = [new Float64Array(4), new Float64Array(4), new Float64Array(4), new Float64Array(4)];
  function growthRate() {
    if (!ctrlOn) return LAM;
    const T = 1 / rate, n = Math.max(4, Math.ceil(T / 0.0002)), h = T / n;
    for (let j = 0; j < 4; j++) {
      let th = j === 0 ? 1 : 0, om = j === 1 ? 1 : 0, um = j === 2 ? 1 : 0; const u = j === 3 ? 1 : 0, th0 = th, om0 = om;
      for (let i = 0; i < n; i++) { um += (u - um) * h / TM; om += (LAM * LAM * th + um) * h; th += om * h; }
      M[0][j] = th; M[1][j] = om; M[2][j] = um; M[3][j] = -KP * th0 - KD * om0;
    }
    let A = M.map((r) => Array.from(r)), lg = 0, p = 1;
    for (let k = 0; k < 11; k++) {
      const B = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]; let nrm = 0;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let q = 0; q < 4; q++) s += A[i][q] * A[q][j]; B[i][j] = s; nrm += s * s; }
      nrm = Math.sqrt(nrm) || 1e-300; lg = lg * 2 + Math.log(nrm); p *= 2; A = B.map((r) => r.map((v) => v / nrm));
    }
    return (lg / p) / T;   // per second; > 0 means the wobble grows
  }
  let sigma = growthRate();

  // ---------------------------------------------------------------- controls and readouts
  const toR = (v) => { const r = 5 * Math.pow(200, v / 1000); return r < 20 ? Math.round(r) : r < 100 ? Math.round(r / 5) * 5 : Math.round(r / 10) * 10; };
  kit.toggle(controls, { label: 'Controller', options: [{ v: 0, label: 'Off' }, { v: 1, label: 'On' }], value: 1, onChange: (v) => { ctrlOn = !!v; sigma = growthRate(); if (!ctrlOn && phase === 'fly' && Math.abs(th) < .004) th = .006 * (rnd() < .5 ? -1 : 1); } });
  kit.slider(controls, { label: 'Corrections per second', min: 0, max: 1000, step: 1, value: Math.round(1000 * Math.log(80) / Math.log(200)), fmt: (v) => toR(v) + ' Hz', onInput: (v) => { rate = toR(v); sigma = growthRate(); } });
  let pushDir = 1;
  kit.button(controls, { label: 'Push it', kind: 'primary', onClick: () => { if (phase === 'fly') { om += 1.1 * pushDir; pushDir = -pushDir; pushT = T; } } });
  const rTilt = kit.readout(readouts, { label: 'tilt', tone: 'heat' });
  const rFlip = kit.readout(readouts, { label: 'time to flip', tone: 'teal' });
  const rRate = kit.readout(readouts, { label: 'corrections per second', tone: 'ink' });
  const tones = new Map(), tone = (r, tn) => { if (tones.get(r) !== tn) { tones.set(r, tn); r.tone(tn); } };

  // ---------------------------------------------------------------- state
  let th, om, um, uc, pend, acc, x, vx, z, vz, phase, tPhase, T = 0, dist = 0, pushT = -9, lastFlip = null, tStart;
  const NH = 480, hT = new Float32Array(NH), hA = new Float32Array(NH); let hHead = 0, hNext = 0;   // tilt history
  const NC = 64, cT = new Float32Array(NC); let cHead = 0;                                       // recent correction times (for sparse rates)
  function spawn() {
    th = ctrlOn ? 0 : .006 * (rnd() < .5 ? -1 : 1); om = 0; um = 0; uc = 0; pend = 0; acc = 0; x = 0; vx = 0; z = 0; vz = 0;
    phase = 'fly'; tPhase = T; tStart = T;
  }
  spawn();

  function step(h) {
    T += h;
    if (phase === 'fall') {
      vz -= G * h; z += vz * h; x += vx * h; vx *= 1 - h * 2; th += om * h;
      const tg = (2 * Math.round((th / Math.PI - 1) / 2) + 1) * Math.PI; th += (tg - th) * Math.min(1, h * 6); om *= 1 - h * 4;
      if (z < -floorDrop) { z = -floorDrop; phase = 'down'; tPhase = T; }
      return;
    }
    if (phase === 'down') { const tg = (2 * Math.round((th / Math.PI - 1) / 2) + 1) * Math.PI; th += (tg - th) * Math.min(1, h * 14); if (T - tPhase > 1.3) spawn(); return; }
    // corrections: sampled at the chosen rate, applied one sample later (compute time), held in between
    if (ctrlOn) {
      acc += h;
      if (acc >= 1 / rate) {
        acc -= 1 / rate; uc = pend;
        const aWant = clamp(-(1.2 * x + 1.8 * vx), -1.4, 1.4), thRef = Math.atan(aWant / G);
        pend = -KP * (th - thRef) - KD * om;
        cT[cHead] = T; cHead = (cHead + 1) % NC;
      }
    } else { uc = 0; pend = 0; }
    dist += (gauss(rnd) * 6 - dist) * Math.min(1, h * 30);
    um += (uc - um) * h / TM;
    om += (LAM * LAM * Math.sin(th) + clamp(um, -400, 400) + dist) * h; th += om * h;
    const tc = clamp(th, -1.4, 1.4);
    vx += (G * Math.tan(tc) * .9 - .4 * vx) * h; x += vx * h;
    if (Math.abs(th) > Math.PI / 2) { phase = 'fall'; tPhase = T; lastFlip = T - Math.max(tStart, pushT > tStart ? pushT : tStart); vz = 0; }
  }
  let floorDrop = 1;   // metres from hover height to the floor (set by layout)

  function record() {
    if (T < hNext) return; hNext = T + WIN / NH * 1.0;
    hT[hHead] = T; hA[hHead] = phase === 'fly' ? th * DEG : (th > 0 ? 200 : -200); hHead = (hHead + 1) % NH;
  }

  // ---------------------------------------------------------------- drawing
  function drone(cx, cy, ang, s) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang); ctx.lineCap = 'round';
    ctx.strokeStyle = C.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke();
    ctx.fillStyle = C.ink; roundRect(ctx, -s * .26, -s * .15, s * .52, s * .3, 4); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(243,238,242,.6)';
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(k * s, 0); ctx.lineTo(k * s, -s * .2); ctx.stroke(); ctx.beginPath(); ctx.ellipse(k * s, -s * .24, s * .44, s * .06, 0, 0, 7); ctx.stroke(); }
    ctx.restore();
  }
  function arrow(x0, y0, x1, y1, col, lw) {
    const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0); if (L < 3) return;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - Math.cos(a) * 6, y1 - Math.sin(a) * 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - Math.cos(a - .45) * 9, y1 - Math.sin(a - .45) * 9); ctx.lineTo(x1 - Math.cos(a + .45) * 9, y1 - Math.sin(a + .45) * 9); ctx.closePath(); ctx.fill();
  }
  function broom(px, py, ang, L, phone) {
    // palm
    ctx.fillStyle = 'rgba(246,210,177,.85)'; ctx.beginPath(); ctx.ellipse(px, py + 5, phone ? 11 : 15, phone ? 5 : 6, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(246,210,177,.85)'; ctx.lineWidth = phone ? 5 : 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(px + (phone ? 6 : 9), py + 9); ctx.lineTo(px + (phone ? 16 : 22), py + (phone ? 22 : 28)); ctx.stroke();
    // stick and head, tilting with the drone
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    ctx.strokeStyle = C.apricot; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -L); ctx.stroke();
    ctx.fillStyle = 'rgba(255,195,107,.75)'; ctx.beginPath(); ctx.moveTo(-3, -L); ctx.lineTo(3, -L); ctx.lineTo(9, -L - (phone ? 12 : 16)); ctx.lineTo(-9, -L - (phone ? 12 : 16)); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function draw() {
    const w = cv.w, h = cv.h, phone = w < 600; cv.clear();
    const m = phone ? 14 : 24;
    const chartH = phone ? Math.max(92, h * .3) : Math.max(140, h * .3);
    const sceneB = h - chartH - (phone ? 12 : 22);           // floor line
    const cx = phone ? w * .48 : w * .46, s = phone ? 34 : 62;
    const cy = phone ? Math.max(118, sceneB * .5) : Math.max(230, sceneB * .5);
    const ppm = phone ? 90 : 150;
    floorDrop = (sceneB - cy - s * .3) / ppm;
    const dx = cx + clamp(x * ppm, -w * .17, w * .17), dy = cy - z * ppm;
    // floor
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(m, sceneB); ctx.lineTo(w - m, sceneB); ctx.stroke();
    ctx.strokeStyle = C.grid; for (let xx = m + 10; xx < w - m; xx += 26) { ctx.beginPath(); ctx.moveTo(xx, sceneB); ctx.lineTo(xx - 6, sceneB + 6); ctx.stroke(); }
    // upright reference and tilt arc
    if (phase === 'fly') {
      ctx.setLineDash([3, 5]); ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(dx, dy - s * 1.9); ctx.lineTo(dx, dy + s * .7); ctx.stroke(); ctx.setLineDash([]);
      if (Math.abs(th) > .02) { ctx.strokeStyle = C.heat; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(dx, dy, s * 1.5, -Math.PI / 2, -Math.PI / 2 + th, th < 0); ctx.stroke(); }
      // thrust and its sideways part
      const L = s * 1.55, tx = dx + Math.sin(th) * L, ty = dy - Math.cos(th) * L;
      arrow(dx, dy - 4, tx, ty, C.teal, 2.5);
      text(ctx, 'thrust', tx + (th >= 0 ? 8 : -8), ty, { size: 11, color: C.teal, align: th >= 0 ? 'left' : 'right' });
      const side = Math.sin(th) * L;
      if (Math.abs(side) > 2) {
        arrow(dx, dy + s * .55, dx + side * 1.6, dy + s * .55, C.rose, 2.2);
        if (Math.abs(th) > .035) text(ctx, 'sideways push', dx + side * .8, dy + s * .55 + 18, { size: 11, color: C.rose, align: 'center' });
      }
    }
    drone(dx, phase === 'down' ? sceneB - s * (.14 + .16 * (1 - Math.cos(th)) / 2) : dy, th, s);
    // status words near the drone (left-aligned on a phone so they stay clear of the 3-D inset)
    let msg, col;
    if (phase !== 'fly') { msg = lastFlip !== null ? `flipped after ${lastFlip.toFixed(1)} s` : 'flipped'; col = C.danger; }
    else if (!ctrlOn) { msg = phone ? 'no corrections: tilt feeds itself' : 'no corrections: the tilt feeds itself'; col = C.rose; }
    else if (sigma > 0) { msg = phone ? 'corrections too late: overshoot' : 'corrections arrive too late: each one overshoots'; col = C.rose; }
    else if (sigma > -2.5) { msg = phone ? 'just enough: it wobbles' : 'just enough corrections: it wobbles'; col = C.apricot; }
    else { msg = phone ? `${rate} corrections/s: it stays up` : `${rate} small corrections a second: it stays up`; col = C.teal; }
    if (phone) text(ctx, msg, m, 26, { size: 12, color: col, weight: 500 });
    else text(ctx, msg, cx, Math.max(30, cy - s * 2.2), { size: 13, color: col, align: 'center', weight: 500 });

    // broom on a palm, tilting with the drone
    const bx = phone ? m + 40 : m + 80, by = sceneB - (phone ? 30 : 40);
    const bAng = phase === 'fly' ? clamp(th, -.95, .95) : (th > 0 ? .95 : -.95);
    broom(bx, by, bAng, phone ? 40 : 80, phone);
    if (phone) { text(ctx, 'like a broom', bx + 30, by - 20, { size: 11, color: C.faint }); text(ctx, 'on your palm', bx + 30, by - 6, { size: 11, color: C.faint }); }
    else {
      text(ctx, 'A broom on your palm does not want to stay up.', bx + 96, by - 30, { size: 12, color: C.muted });
      text(ctx, 'It stays up only because you keep correcting.', bx + 96, by - 12, { size: 12, color: C.muted });
    }

    // tilt chart with the correction ticks underneath
    const ch = { x: m - 4, y: h - chartH - 4, w: w - 2 * m + 8, h: chartH };
    const P = plot(ctx, ch, [], { xMin: T - WIN, xMax: T, yMin: -30, yMax: 30, yLabel: 'tilt, last 4 s (±30°)', xLabel: 'now', zero: true });
    ctx.save(); ctx.beginPath(); ctx.rect(ch.x + 14, ch.y + 10, ch.w - 28, ch.h - 30); ctx.clip();
    ctx.strokeStyle = C.heat; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath(); let first = true;
    for (let k = 0; k < NH; k++) { const i = (hHead + k) % NH; if (hT[i] <= T - WIN || hT[i] <= 0) continue; const X = P.px(hT[i]), Y = P.py(clamp(hA[i], -40, 40)); if (first) { ctx.moveTo(X, Y); first = false; } else ctx.lineTo(X, Y); }
    ctx.stroke(); ctx.restore();
    // correction ticks
    const yT = ch.y + ch.h - 22, x0 = ch.x + 14, x1 = ch.x + ch.w - 14;
    if (ctrlOn && phase === 'fly') {
      const spacing = (x1 - x0) / (rate * WIN);
      ctx.strokeStyle = 'rgba(127,212,207,.75)'; ctx.lineWidth = 1;
      if (spacing < 3) { ctx.fillStyle = 'rgba(127,212,207,.45)'; ctx.fillRect(x0, yT - 6, x1 - x0, 6); }
      else { ctx.beginPath(); const t0 = Math.ceil((T - WIN) * rate) / rate; for (let tt = t0; tt <= T; tt += 1 / rate) { const xx = P.px(tt); ctx.moveTo(xx, yT); ctx.lineTo(xx, yT - 6); } ctx.stroke(); }
      text(ctx, spacing < 3 ? 'corrections (too many to draw apart)' : 'each tick = one correction', x0 + 6, yT - 9, { size: 11, color: 'rgba(127,212,207,.8)' });
    }
    if (T - pushT < WIN) { const xx = P.px(pushT); ctx.strokeStyle = 'rgba(246,210,177,.6)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(xx, ch.y + 12); ctx.lineTo(xx, yT); ctx.stroke(); ctx.setLineDash([]); text(ctx, 'push', xx + 4, ch.y + 30, { size: 11, color: C.apricot }); }
  }

  const loop = kit.loop((dt) => {
    const n = Math.round(dt / H); for (let i = 0; i < n; i++) { step(H); record(); }
    draw();
    rTilt.set(phase === 'fly' ? (Math.abs(th * DEG) < .05 ? '0.0' : (th * DEG).toFixed(1)) + '°' : 'flipped'); tone(rTilt, phase === 'fly' ? 'heat' : 'danger');
    if (phase !== 'fly') { rFlip.set(lastFlip !== null ? lastFlip.toFixed(1) + ' s' : '—'); tone(rFlip, 'danger'); }
    else if (sigma <= 0) { rFlip.set('stable'); tone(rFlip, 'teal'); }
    else {
      let amp = Math.abs(th); for (let k = 1; k <= 30; k++) { const i = (hHead - k + NH) % NH; if (hT[i] > T - .35) amp = Math.max(amp, Math.abs(hA[i]) / DEG); }
      const tf = Math.log((Math.PI / 2) / Math.max(amp, .004)) / sigma;
      rFlip.set('≈ ' + Math.max(0, tf).toFixed(1) + ' s'); tone(rFlip, 'danger');
    }
    rRate.set(ctrlOn ? rate + ' Hz' : 'none'); tone(rRate, ctrlOn ? (sigma > 0 ? 'rose' : 'ink') : 'rose');
  });
  draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

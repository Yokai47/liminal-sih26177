// Vibration and the notch filter (ported from the team's Layer 1 sim, same physics). The IMU cannot tell airframe
// vibration from real motion. Propeller vibration sits at RPM / 60 (plus a 2nd harmonic), amplified by the frame's
// resonance, and that frequency moves with throttle. A static notch misses it once the throttle changes; an
// RPM-tracking notch follows it because bidirectional DShot reports each motor's RPM.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const FS = 1000, N = 256, NQ = 3, SHOW = 500, FMAX = 400, KMAX = Math.floor(FMAX / (FS / N));

  let rpm = 5400, Q = 6, mode = 'off', staticF = 90;
  kit.slider(controls, { label: 'Throttle → RPM', min: 3000, max: 9000, step: 60, value: rpm, fmt: (v) => v + ' rpm', onInput: (v) => { rpm = v; } });
  kit.slider(controls, { label: 'Frame resonance Q', min: 1, max: 14, step: .5, value: Q, fmt: (v) => v.toFixed(1), onInput: (v) => { Q = v; } });
  kit.toggle(controls, { label: 'Filter', options: [{ v: 'off', label: 'None' }, { v: 'static', label: 'Static notch' }, { v: 'track', label: 'RPM-tracking' }], value: 'off',
    onChange: (v) => { mode = v; z1 = z2 = 0; if (v === 'static') staticF = rpm / 60; } });
  kit.hint(controls, 'Pick <b>Static notch</b>, then sweep the throttle: the peak slides out of the notch. <b>RPM-tracking</b> follows it, because bidirectional DShot reports each motor’s RPM.');
  const rNoise = kit.readout(readouts, { label: 'IMU noise power', tone: 'rose' });
  const rRed = kit.readout(readouts, { label: 'reduction vs none', tone: 'teal' });
  const rFp = kit.readout(readouts, { label: 'prop frequency', tone: 'heat' });

  // ring buffers (allocated once)
  const R = 1024, bT = new Float32Array(R), bU = new Float32Array(R), bO = new Float32Array(R); let head = 0, count = 0;
  let n = 0, ph1 = 0, ph2 = 0, z1 = 0, z2 = 0, frame = 0;
  // DFT tables: twiddles, Hann window, outputs
  const cosT = new Float32Array(N), sinT = new Float32Array(N), win = new Float32Array(N), xs = new Float32Array(N);
  for (let i = 0; i < N; i++) { cosT[i] = Math.cos(2 * Math.PI * i / N); sinT[i] = Math.sin(2 * Math.PI * i / N); win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (N - 1)); }
  const magO = new Float32Array(KMAX + 1), magU = new Float32Array(KMAX + 1);
  let yMax = 2, pO = 0, pU = 0;

  // biquad notch (same form as the team's): coefficients for centre f0, quality NQ
  let b0 = 1, b1 = 0, b2 = 1, a1 = 0, a2 = 0;
  function coeffs(f0) { const w0 = 2 * Math.PI * f0 / FS, al = Math.sin(w0) / (2 * NQ), c = Math.cos(w0), a0 = 1 + al; b0 = 1 / a0; b1 = -2 * c / a0; b2 = 1 / a0; a1 = -2 * c / a0; a2 = (1 - al) / a0; }

  function generate(count0) {
    const fp = rpm / 60, amp = Q / 6;
    if (mode !== 'off') coeffs(mode === 'static' ? staticF : fp);
    for (let i = 0; i < count0; i++) {
      const truth = 2.2 * Math.sin(2 * Math.PI * .7 * n / FS);                   // the real, slow motion
      ph1 += 2 * Math.PI * fp / FS; ph2 += 2 * Math.PI * 2 * fp / FS; if (ph1 > 6.283185) ph1 -= 6.283185; if (ph2 > 6.283185) ph2 -= 6.283185;
      const raw = truth + amp * 1.7 * Math.sin(ph1) + amp * .85 * Math.sin(ph2 + 1.1) + (Math.random() - .5) * .5;
      let out = raw;
      if (mode !== 'off') { out = b0 * raw + z1; z1 = b1 * raw - a1 * out + z2; z2 = b2 * raw - a2 * out; }
      bT[head] = truth; bU[head] = raw; bO[head] = out; head = (head + 1) % R; if (count < R) count++; n++;
    }
  }
  function spectrum() {
    for (const [src, dst] of [[bO, magO], [bU, magU]]) {
      for (let i = 0; i < N; i++) xs[i] = src[(head - N + i + R) % R] * win[i];
      for (let k = 1; k <= KMAX; k++) { let re = 0, im = 0; for (let i = 0; i < N; i++) { const j = (k * i) & (N - 1); re += xs[i] * cosT[j]; im -= xs[i] * sinT[j]; } dst[k] = Math.sqrt(re * re + im * im) * 4 / N; }
    }
    let pk = 0; for (let k = 3; k <= KMAX; k++) if (magU[k] > pk) pk = magU[k];
    // fixed scale steps with hysteresis, so the axis only changes when the peak really outgrows it
    const LV = [1, 2, 3, 5]; let i = LV.indexOf(yMax); if (i < 0) i = 1;
    while (i < LV.length - 1 && pk > LV[i] * .97) i++;
    while (i > 0 && pk * 1.15 < LV[i - 1] * .9) i--;
    yMax = LV[i];
  }
  function power() {
    let so = 0, su = 0; const m = Math.min(200, count);
    for (let i = 1; i <= m; i++) { const j = (head - i + R) % R, t = bT[j], dO = bO[j] - t, dU = bU[j] - t; so += dO * dO; su += dU * dU; }
    pO = so / m; pU = su / m;
  }

  function panel(x, y, w, h) { ctx.fillStyle = C.panel; roundRect(ctx, x, y, w, h, 10); ctx.fill(); }
  function vline(x, y0, y1, col, dash, lw) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.setLineDash([]); }
  function tag(s, x, y, col, align, minX, maxX) {
    ctx.font = `500 11px ${F.sans}`; const tw = ctx.measureText(s).width; let lx = align === 'right' ? x - tw : x; lx = clamp(lx, minX, maxX - tw);
    ctx.fillStyle = 'rgba(36,40,77,.9)'; roundRect(ctx, lx - 4, y - 11, tw + 8, 16, 5); ctx.fill(); text(ctx, s, lx, y, { size: 11, color: col, weight: 500 });
  }

  function draw() {
    const w = cv.w, h = cv.h, phone = w < 600; cv.clear();
    const m = phone ? 12 : 24;
    // --- time series (top, kept left of the 3-D inset)
    const tp = { x: m, y: phone ? 10 : 20, w: w - m - (phone ? 142 : 272), h: phone ? 96 : Math.min(176, h * .3) };
    panel(tp.x, tp.y, tp.w, tp.h);
    const mid = tp.y + tp.h / 2 + 6, ys = (tp.h / 2 - 16) / 6.5, x0 = tp.x + 10, xw = tp.w - 20;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, mid); ctx.lineTo(x0 + xw, mid); ctx.stroke();
    const nShow = Math.min(SHOW, count);
    ctx.save(); ctx.beginPath(); ctx.rect(tp.x, tp.y + 18, tp.w, tp.h - 20); ctx.clip(); ctx.lineJoin = 'round';
    for (const [buf, col, lw] of [[bO, C.rose, phone ? 1 : 1.2], [bT, C.teal, 2.2]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
      for (let i = 0; i < nShow; i++) { const j = (head - nShow + i + R) % R, X = x0 + i / (SHOW - 1) * xw, Y = mid - buf[j] * ys; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.stroke();
    }
    ctx.restore();
    text(ctx, mode === 'off' ? 'what the IMU reports' : (phone ? 'after the filter' : 'what the controller sees (after the filter)'), tp.x + 10, tp.y + 15, { size: 11, color: C.rose });
    ctx.font = `400 11px ${F.sans}`; const tl = phone ? 'real motion' : 'the motion the drone really made', twl = ctx.measureText(tl).width;
    text(ctx, tl, tp.x + tp.w - 10 - twl, tp.y + 15, { size: 11, color: C.teal });
    if (!phone) text(ctx, '0.5 s', tp.x + tp.w - 10, tp.y + tp.h - 6, { size: 11, color: C.faint, align: 'right' });

    // --- spectrum (bottom, full width)
    const sp = { x: m, y: tp.y + tp.h + (phone ? 10 : 18), w: w - 2 * m, h: 0 }; sp.h = h - sp.y - (phone ? 8 : 18);
    panel(sp.x, sp.y, sp.w, sp.h);
    const fx0 = sp.x + (phone ? 12 : 44), fx1 = sp.x + sp.w - (phone ? 12 : 20), base = sp.y + sp.h - 26, top = sp.y + (phone ? 40 : 46);
    const fx = (f) => fx0 + f / FMAX * (fx1 - fx0), my = (a) => base - Math.min(1.04, a / yMax) * (base - top);
    // axes, gridlines
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(fx0, base); ctx.lineTo(fx1, base); ctx.stroke();
    for (let f = 0; f <= FMAX; f += 100) { const X = fx(f); ctx.beginPath(); ctx.moveTo(X, base); ctx.lineTo(X, base + 5); ctx.stroke(); text(ctx, f + ' Hz', X, base + 18, { size: 11, color: C.faint, align: f === 0 ? 'left' : f === FMAX ? 'right' : 'center', font: F.mono }); }
    const gs = yMax <= 1 ? .25 : yMax <= 2 ? .5 : 1;
    for (let a = gs; a <= yMax + 1e-6; a += gs) { const Y = my(a); ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(fx0, Y); ctx.lineTo(fx1, Y); ctx.stroke(); if (!phone) text(ctx, a.toFixed(1), fx0 - 8, Y + 4, { size: 11, color: C.faint, align: 'right', font: F.mono }); }
    // unfiltered ghost (what it would be with no filter)
    ctx.strokeStyle = 'rgba(243,238,242,.35)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]); ctx.beginPath();
    for (let k = 1; k <= KMAX; k++) { const X = fx(k * FS / N), Y = my(magU[k]); k > 1 ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); } ctx.stroke(); ctx.setLineDash([]);
    // filtered spectrum: filled
    ctx.beginPath(); ctx.moveTo(fx(FS / N), base);
    for (let k = 1; k <= KMAX; k++) ctx.lineTo(fx(k * FS / N), my(magO[k]));
    ctx.lineTo(fx(KMAX * FS / N), base); ctx.closePath(); ctx.fillStyle = 'rgba(239,177,180,.28)'; ctx.fill();
    ctx.strokeStyle = C.rose; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let k = 1; k <= KMAX; k++) { const X = fx(k * FS / N), Y = my(magO[k]); k > 1 ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); } ctx.stroke();
    // prop peak and harmonic markers
    const fp = rpm / 60, xp = fx(fp), x2 = fx(2 * fp), minX = sp.x + 8, maxX = sp.x + sp.w - 8;
    vline(xp, top - 18, base, 'rgba(255,195,107,.75)', [3, 3], 1.2);
    tag(`prop ${fp.toFixed(0)} Hz`, xp + 5, top - 22, C.heat, 'left', minX, maxX);
    if (2 * fp < FMAX) { vline(x2, top + 2, base, 'rgba(246,210,177,.4)', [2, 4], 1); tag(phone ? '2nd harmonic' : '2nd harmonic', x2 + 5, top + 38, C.apricot, 'left', minX, maxX); }
    if (mode !== 'off') {
      const nf = mode === 'static' ? staticF : fp, xn = fx(nf);
      ctx.fillStyle = 'rgba(127,212,207,.10)'; ctx.fillRect(xn - fx(nf / NQ / 2) + fx0, top - 6, 2 * (fx(nf / NQ / 2) - fx0), base - top + 6);   // the notch's width (-3 dB band)
      vline(xn, top - 6, base, C.teal, [6, 3], 1.8);
      const right = Math.abs(nf - fp) < 4 ? true : nf > fp;
      tag(`${mode === 'static' ? 'static notch' : 'tracking notch'} ${nf.toFixed(0)} Hz`, right ? xn + 5 : xn - 5, top - 2 + (Math.abs(nf - fp) < 30 ? 16 : 0), C.teal, right ? 'left' : 'right', minX, maxX);
      if (mode === 'static' && Math.abs(nf - fp) > 8) tag('peak escaped the notch', xp + (fp > nf ? 5 : -5), my(magO[Math.round(fp / (FS / N))]) - 8 < top + 30 ? top + 48 : my(magO[Math.round(fp / (FS / N))]) - 10, C.danger, fp > nf ? 'left' : 'right', minX, maxX);
    }
    if (!phone) {
      text(ctx, 'frequency spectrum', sp.x + 12, sp.y + 18, { size: 11, color: C.faint });
      text(ctx, '— — without a filter', sp.x + sp.w - 16, sp.y + 18, { size: 11, color: C.faint, align: 'right' });
      tag('slow real motion', fx(6), Math.max(top + 60, my(magO[1]) - 10), C.teal, 'left', minX, maxX);
    } else text(ctx, '- - no filter', sp.x + sp.w - 12, base - (base - top) * .55, { size: 11, color: C.faint, align: 'right' });
  }

  const loop = kit.loop((dt) => {
    generate(Math.max(1, Math.round(FS * dt * .5)));    // half speed, as in the original (8 samples a frame)
    if (++frame % 4 === 0 && count >= N) spectrum();
    power(); draw();
    rNoise.set(pO.toFixed(3));
    const red = mode === 'off' ? 0 : 10 * Math.log10(pU / Math.max(pO, 1e-9));
    rRed.set(mode === 'off' ? '0.0 dB' : (red > 0.05 ? '−' + red.toFixed(1) : '0.0') + ' dB');
    rFp.set((rpm / 60).toFixed(0) + ' Hz');
  });
  generate(N + 8); spectrum(); power(); draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

// Sensor fusion (ported from the team's Layer 1 sim, same physics): the gyroscope is precise short-term but its bias
// integrates into drift; the accelerometer never drifts but is noisy. A complementary filter blends them with a
// fixed weight alpha. The side panel shows what a Kalman filter adds: it computes the weight itself, every cycle,
// from how unsure it is (P, grows while no measurement arrives) and how noisy the measurement is (R): K = P / (P + R).
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const DT = 0.02, NH = 520, FOG = 3, YR = 70;

  let bias = .6, an = 4, alpha = .98;
  kit.slider(controls, { label: 'Gyro bias', min: 0, max: 2, step: .05, value: bias, fmt: (v) => v.toFixed(2) + ' °/s', onInput: (v) => { bias = v; gyroA = truthNow; } });
  kit.slider(controls, { label: 'Accel noise', min: 0, max: 12, step: .5, value: an, fmt: (v) => '±' + v.toFixed(1) + '°', onInput: (v) => { an = v; } });
  kit.slider(controls, { label: 'Filter gain α', min: .9, max: .999, step: .001, value: alpha, fmt: (v) => v.toFixed(3), onInput: (v) => { alpha = v; } });
  kit.button(controls, { label: 'Fog: no accel for 3 s', onClick: () => { fogUntil = t + FOG; } });
  kit.button(controls, { label: 'Reset', onClick: () => reset() });
  const rG = kit.readout(readouts, { label: 'gyro-only error', tone: 'danger' });
  const rF = kit.readout(readouts, { label: 'fused error', tone: 'teal' });

  // history ring buffers
  const hTr = new Float32Array(NH), hGy = new Float32Array(NH), hAc = new Float32Array(NH), hFu = new Float32Array(NH), hFog = new Uint8Array(NH);
  let head = 0, count = 0, t = 0, gyroA = 0, fused = 0, truthNow = 0, fogUntil = -1, acc = 0;
  // Kalman bookkeeping (scalar, for the panel): P = uncertainty (deg^2), R = measurement noise (deg^2)
  let Plast = .1, tau = 0, P = .1, K = .02;
  function reset() { t = 0; gyroA = 0; fused = 0; head = 0; count = 0; fogUntil = -1; Plast = .1; tau = 0; P = .1; K = .02; }
  reset();

  function step() {
    const truth = 25 * Math.sin(t * .35) + 12 * Math.sin(t * .11);
    const rate = 25 * .35 * Math.cos(t * .35) + 12 * .11 * Math.cos(t * .11);
    gyroA += (rate + bias) * DT;                                 // gyro only: the bias integrates
    const fog = t < fogUntil;
    const accA = truth + (Math.random() - .5) * an * 2;          // accel only: noisy, never drifts
    // complementary filter (fixed weight); in the fog there is no accel, so it can only integrate the gyro
    fused = fog ? fused + (rate + bias) * DT : alpha * (fused + (rate + bias) * DT) + (1 - alpha) * accA;
    // Kalman view of the same moment: uncertainty grows with time since the last sign; a sign shrinks it
    const qp = Math.pow(.046 * (.4 + bias), 2), sb = .1 + bias, R = Math.max(an * an / 3, .01);
    tau += DT; P = Plast + qp * (tau / DT) + (sb * tau) * (sb * tau);   // before the sign: how unsure am I now?
    K = P / (P + R);                                                    // how much I would trust a sign right now
    if (!fog) { Plast = (1 - K) * P; tau = 0; }                         // a sign arrived: uncertainty shrinks
    hTr[head] = truth; hGy[head] = gyroA; hAc[head] = accA; hFu[head] = fused; hFog[head] = fog ? 1 : 0;
    head = (head + 1) % NH; if (count < NH) count++;
    truthNow = truth; t += DT;
  }

  // ---------------------------------------------------------------- drawing
  let Lc = null;
  function layout() {
    const w = cv.w, h = cv.h, phone = w < 600;
    if (phone) {
      const m = 12;
      Lc = { phone, m, ch: { x: m, y: 116, w: w - 2 * m, h: h - 116 - 124 }, kp: { x: m, y: h - 116, w: w - 2 * m, h: 108 }, lg: { x: m, y: 10, w: w - 142 - m, h: 94 } };
    } else {
      const m = 24, pw = 248;
      Lc = { phone, m, ch: { x: m, y: 20, w: w - 2 * m - pw - 26, h: h - 40 }, kp: { x: w - m - pw, y: 214, w: pw, h: Math.min(h - 234, 318) } };
    }
  }
  cv.onResize(layout); layout();

  const SERIES = [
    { buf: hAc, col: 'rgba(143,140,196,.55)', lw: 1, label: 'accel only (noisy)', lc: '#B4B1E0' },
    { buf: hGy, col: C.danger, lw: 1.7, label: 'gyro only (drifts)', lc: C.danger },
    { buf: hTr, col: C.ink, lw: 2.4, label: 'true attitude', lc: C.ink },
    { buf: hFu, col: C.teal, lw: 2.1, label: 'fused', lc: C.teal },
  ];
  const labY = new Float32Array(4);

  function bar(x, y, w, frac, col, label, val, phone) {
    text(ctx, label, x, y, { size: phone ? 11 : 12, color: C.muted });
    text(ctx, val, x + w, y, { size: phone ? 11 : 12, color: col, align: 'right', font: F.mono });
    ctx.fillStyle = 'rgba(220,214,236,.1)'; roundRect(ctx, x, y + 6, w, 8, 4); ctx.fill();
    ctx.fillStyle = col; roundRect(ctx, x, y + 6, Math.max(4, w * clamp(frac, 0, 1)), 8, 4); ctx.fill();
  }

  function draw() {
    const { phone, ch, kp, lg } = Lc; cv.clear();
    // --- chart
    ctx.fillStyle = C.panel; roundRect(ctx, ch.x, ch.y, ch.w, ch.h, 10); ctx.fill();
    const x0 = ch.x + (phone ? 34 : 46), x1 = ch.x + ch.w - (phone ? 10 : 132), y0 = ch.y + 14, y1 = ch.y + ch.h - 14, ym = (y0 + y1) / 2;
    const py = (v) => ym - clamp(v, -YR, YR) / YR * (y1 - y0) / 2, px = (i) => x0 + i / (NH - 1) * (x1 - x0);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (const v of [-60, -30, 0, 30, 60]) { const Y = py(v); ctx.beginPath(); ctx.moveTo(x0, Y); ctx.lineTo(x1, Y); ctx.stroke(); text(ctx, (v > 0 ? '+' : '') + v + '°', x0 - 6, Y + 4, { size: 11, color: C.faint, align: 'right', font: F.mono }); }
    // fog bands
    const off = NH - count;
    ctx.fillStyle = 'rgba(143,140,196,.13)';
    let fs = -1;
    for (let i = 0; i <= count; i++) {
      const on = i < count && hFog[(head - count + i + NH) % NH];
      if (on && fs < 0) fs = i; else if (!on && fs >= 0) { const a = px(off + fs), b = px(off + i - 1); ctx.fillRect(a, y0, Math.max(2, b - a), y1 - y0); if (b - a > 50) text(ctx, 'fog: no accel', a + 6, y0 + 14, { size: 11, color: '#B4B1E0' }); fs = -1; }
    }
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0 - 2, x1 - x0, y1 - y0 + 4); ctx.clip(); ctx.lineJoin = 'round';
    for (const s of SERIES) {
      ctx.strokeStyle = s.col; ctx.lineWidth = s.lw; ctx.beginPath(); let pen = false;
      for (let i = 0; i < count; i++) {
        const j = (head - count + i + NH) % NH;
        if (s.buf === hAc && hFog[j]) { pen = false; continue; }   // no accel reading in the fog
        const X = px(off + i), Y = py(s.buf[j]); if (pen) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); pen = true; }
      }
      ctx.stroke();
    }
    ctx.restore();
    // direct labels at the right end (desktop), spread so they do not overlap
    if (count > 2) {
      const j = (head - 1 + NH) % NH;
      if (!phone) {
        for (let k = 0; k < 4; k++) labY[k] = py(SERIES[k].buf[j]) + 4;
        const order = [0, 1, 2, 3].sort((a, b) => labY[a] - labY[b]);
        for (let pass = 0; pass < 3; pass++) for (let q = 1; q < 4; q++) { const a = order[q - 1], b = order[q]; if (labY[b] - labY[a] < 15) { const mid = (labY[a] + labY[b]) / 2; labY[a] = mid - 7.5; labY[b] = mid + 7.5; } }
        for (let k = 0; k < 4; k++) text(ctx, SERIES[k].label, x1 + 8, clamp(labY[k], y0 + 8, y1), { size: 11, color: SERIES[k].lc });
        if (Math.abs(hGy[j]) > YR) text(ctx, 'off the chart', x1 + 8, clamp(labY[1], y0 + 8, y1) + 13, { size: 11, color: C.faint });
      }
      text(ctx, 'attitude, last 10 s', x0 + 4, y1 - 4, { size: 11, color: C.faint });
    }
    // phone legend in the free strip left of the 3-D inset
    if (phone && lg) {
      SERIES.forEach((s, k) => { const cx = lg.x + (k % 2) * (lg.w / 2), cy = lg.y + 18 + Math.floor(k / 2) * 22; ctx.strokeStyle = s.lc; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx, cy - 4); ctx.lineTo(cx + 14, cy - 4); ctx.stroke(); text(ctx, s.label.replace(' (noisy)', '').replace(' (drifts)', ''), cx + 20, cy, { size: 11, color: C.muted }); });
      text(ctx, 'Drag α: 0.999 drifts, 0.90 is noisy.', lg.x, lg.y + 80, { size: 11, color: C.faint });
    }

    // --- Kalman gain panel
    ctx.fillStyle = C.panel; roundRect(ctx, kp.x, kp.y, kp.w, kp.h, 10); ctx.fill();
    const R = Math.max(an * an / 3, .01), sP = Math.sqrt(P), sR = Math.sqrt(R), SC = 7;
    const fog = t < fogUntil, ix = kp.x + 14, iw = kp.w - 28;
    if (!phone) {
      let y = kp.y + 24;
      text(ctx, 'What a Kalman filter adds', ix, y, { size: 13, color: C.ink, weight: 600 }); y += 18;
      text(ctx, 'it picks the trust itself, every cycle', ix, y, { size: 11, color: C.faint }); y += 28;
      bar(ix, y, iw, sP / SC, C.apricot, fog ? 'how unsure I am (growing)' : 'how unsure I am', '±' + sP.toFixed(1) + '°'); y += 38;
      bar(ix, y, iw, sR / SC, C.rose, 'how noisy the sign is', '±' + sR.toFixed(1) + '°'); y += 44;
      text(ctx, fog ? 'K if a sign came now' : 'K = P / (P + R)', ix, y, { size: 12, color: C.muted, font: fog ? F.sans : F.mono });
      text(ctx, K.toFixed(2), ix + iw, y, { size: 12, color: C.teal, align: 'right', font: F.mono }); y += 12;
      // gauge: 0..1, needle = Kalman gain, tick = the complementary filter's fixed 1 - alpha
      const gy = y + 10; ctx.fillStyle = 'rgba(220,214,236,.1)'; roundRect(ctx, ix, gy, iw, 12, 6); ctx.fill();
      const kx = ix + iw * clamp(K, 0, 1);
      ctx.fillStyle = 'rgba(127,212,207,.55)'; roundRect(ctx, ix, gy, Math.max(6, kx - ix), 12, 6); ctx.fill(); ctx.strokeStyle = C.teal; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(kx, gy - 5); ctx.lineTo(kx, gy + 17); ctx.stroke();
      const cx = ix + iw * (1 - alpha); ctx.strokeStyle = '#B4B1E0'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(cx, gy - 4); ctx.lineTo(cx, gy + 16); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, 'ignore the sign', ix, gy + 30, { size: 11, color: C.faint }); text(ctx, 'trust it fully', ix + iw, gy + 30, { size: 11, color: C.faint, align: 'right' });
      text(ctx, `your fixed filter: 1−α = ${(1 - alpha).toFixed(3)}`, ix, gy + 48, { size: 11, color: '#B4B1E0' });
      y = gy + 74;
      ctx.font = `400 11.5px ${F.sans}`; let line = '';
      const words = (fog ? 'In the fog, no signs arrive: I get less sure every moment, so the next sign will count for more.' : 'Foggy road: the longer since the last signpost, and the clearer the sign, the more you trust it. Press Fog.').split(' ');
      for (const wd of words) { const tl = line ? line + ' ' + wd : wd; if (ctx.measureText(tl).width > iw && line) { text(ctx, line, ix, y, { size: 11.5, color: C.muted }); y += 16; line = wd; } else line = tl; }
      if (line && y < kp.y + kp.h - 4) text(ctx, line, ix, y, { size: 11.5, color: C.muted });
    } else {
      // compact: two bars side by side, gauge, one caption line
      const hw = (iw - 14) / 2; let y = kp.y + 18;
      bar(ix, y, hw, sP / SC, C.apricot, 'how unsure I am', '±' + sP.toFixed(1) + '°', true);
      bar(ix + hw + 14, y, hw, sR / SC, C.rose, 'how noisy the sign', '±' + sR.toFixed(1) + '°', true); y += 36;
      text(ctx, fog ? 'K if a sign came now' : 'Kalman gain K = P/(P+R)', ix, y, { size: 11, color: C.muted, font: fog ? F.sans : F.mono });
      text(ctx, K.toFixed(2), ix + iw, y, { size: 11, color: C.teal, align: 'right', font: F.mono });
      const gy = y + 7; ctx.fillStyle = 'rgba(220,214,236,.1)'; roundRect(ctx, ix, gy, iw, 10, 5); ctx.fill();
      { const kx = ix + iw * clamp(K, 0, 1); ctx.fillStyle = 'rgba(127,212,207,.55)'; roundRect(ctx, ix, gy, Math.max(5, kx - ix), 10, 5); ctx.fill(); ctx.strokeStyle = C.teal; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(kx, gy - 4); ctx.lineTo(kx, gy + 14); ctx.stroke(); }
      const cx = ix + iw * (1 - alpha); ctx.strokeStyle = '#B4B1E0'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(cx, gy - 3); ctx.lineTo(cx, gy + 13); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, 'Unsure + clear sign → trust the sign. Try Fog.', ix, gy + 30, { size: 11, color: C.faint });
    }
  }

  const loop = kit.loop((dt) => {
    acc += dt * 60; let n = 0; while (acc >= 1 && n < 6) { step(); acc -= 1; n++; }
    draw();
    const j = (head - 1 + NH) % NH;
    rG.set(Math.abs(hGy[j] - hTr[j]).toFixed(1) + '°'); rF.set(Math.abs(hFu[j] - hTr[j]).toFixed(1) + '°');
  });
  step(); draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

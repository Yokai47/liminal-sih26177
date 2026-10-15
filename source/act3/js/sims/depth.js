// Depth completion. One row of the camera image: the true depth along that row (ink), the neural network's dense
// guess (Depth Anything V2: right shape, wrong scale and offset; rose) and a few LiDAR hits (teal dots, exact).
// "Fit scale" solves the least-squares scale and offset that map the network onto the laser points, and applies
// them to every pixel: dense depth with real metres, even where the laser got nothing back (the dark surface).
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, lerp, clamp, roundRect } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const TAU = Math.PI * 2;
  const M = 320, DMAX = 10, HC = 1.2, HCEIL = 2.7;           // columns, plot range (m), camera and ceiling height (m)

  // ------------------------------------------------------------ the scene, column by column
  const sm = (a) => a * a * (3 - 2 * a);
  const back = new Float32Array(M), dTrue = new Float32Array(M), objH = new Float32Array(M), mat = new Uint8Array(M);
  const DARK0 = .60, DARK1 = .75;
  for (let c = 0; c < M; c++) {
    const u = (c + .5) / M; let d;
    if (u < .30) d = lerp(1.3, 5.6, sm(u / .30) * .6 + u / .30 * .4);         // left wall receding
    else if (u < .45) d = 5.6;                                                  // back wall
    else if (u < .57) d = 8.6;                                                  // doorway into the next room
    else if (u < .78) d = 5.6;
    else d = lerp(5.6, 1.5, sm((u - .78) / .22) * .5 + (u - .78) / .22 * .5);   // right wall coming closer
    back[c] = d; dTrue[c] = d; mat[c] = u >= .45 && u < .57 ? 2 : 0;
    if (u > .15 && u < .28) { const k = (u - .15) / .13; dTrue[c] = 2.4 - .25 * Math.sin(Math.PI * k); objH[c] = 1.45 + .25 * Math.sin(Math.PI * k); mat[c] = 1; }   // a slumped figure / debris
    if (u > DARK0 && u < DARK1) { const k = (u - DARK0) / (DARK1 - DARK0); dTrue[c] = 3.3 - .18 * Math.sin(Math.PI * k); objH[c] = 1.5; mat[c] = 3; }               // the dark object
  }
  // the network: relative depth with the right shape (soft at edges, slightly warped) but an arbitrary scale and offset
  const rel = new Float32Array(M), shown = new Float32Array(M);
  {
    const tmp = new Float32Array(M);
    for (let c = 0; c < M; c++) { let s = 0, n = 0; for (let k = -2; k <= 2; k++) { const j = clamp(c + k, 0, M - 1); s += dTrue[j]; n++; } tmp[c] = s / n; }
    for (let c = 0; c < M; c++) { const u = (c + .5) / M, d = tmp[c]; rel[c] = .36 * (d + .06 * Math.sqrt(d) * Math.sin(5.3 * u + .4) - .008 * d * d) + .95; }
  }

  // ------------------------------------------------------------ LiDAR samples and the fit
  let nPts = 18, sigma = .03, dark = false, fitted = false, fitT = 0, T = 0;
  const MAXP = 60, pc = new Int16Array(MAXP), pg = new Float32Array(MAXP), pz = new Float32Array(MAXP), pon = new Uint8Array(MAXP);
  const r = kit.rng(17);
  function placePoints() {
    for (let i = 0; i < nPts; i++) { const u = .02 + (i + .15 + r() * .7) / nPts * .96; pc[i] = clamp(Math.floor(u * M), 0, M - 1); pg[i] = kit.gauss(r); }
    measure();
  }
  let fa = 1, fb = 0, nUsed = 0, errBefore = 0, errAfter = 0;
  function measure() {
    nUsed = 0;
    for (let i = 0; i < nPts; i++) {
      const u = (pc[i] + .5) / M; pon[i] = dark && u > DARK0 && u < DARK1 ? 0 : 1;
      pz[i] = dTrue[pc[i]] + sigma * pg[i]; if (pon[i]) nUsed++;
    }
    // least squares: depth ≈ a · network + b over the laser points we actually have
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < nPts; i++) if (pon[i]) { const x = rel[pc[i]], y = pz[i]; n++; sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const den = n * sxx - sx * sx;
    if (n >= 2 && Math.abs(den) > 1e-9) { fa = (n * sxy - sx * sy) / den; fb = (sy - fa * sx) / n; } else if (n >= 1) { fa = sy / sx; fb = 0; } else { fa = 1; fb = 0; }
    let e0 = 0, e1 = 0;
    for (let c = 0; c < M; c++) { e0 += (rel[c] - dTrue[c]) ** 2; e1 += (fa * rel[c] + fb - dTrue[c]) ** 2; }
    errBefore = Math.sqrt(e0 / M); errAfter = Math.sqrt(e1 / M);
  }

  // ------------------------------------------------------------ controls and readouts
  kit.slider(controls, { label: 'LiDAR points', min: 2, max: 60, step: 1, value: nPts, fmt: (v) => String(v), onInput: (v) => { nPts = v; placePoints(); } });
  kit.slider(controls, { label: 'LiDAR noise', min: 0, max: .3, step: .01, value: sigma, fmt: (v) => '±' + Math.round(v * 100) + ' cm', onInput: (v) => { sigma = v; measure(); } });
  kit.toggle(controls, { label: 'Dark surface', options: [{ v: 0, label: 'Off' }, { v: 1, label: 'On: no laser returns' }], value: 0, onChange: (v) => { dark = !!v; measure(); stripDirty = true; } });
  kit.button(controls, { label: 'Fit scale', kind: 'primary', onClick: () => { fitted = true; fitT = 0; } });
  const rBefore = kit.readout(readouts, { label: 'error before fit (RMS)', tone: 'rose' });
  const rAfter = kit.readout(readouts, { label: 'error after fit (RMS)', tone: 'teal' });
  const rScale = kit.readout(readouts, { label: 'scale found', tone: 'heat' });

  // ------------------------------------------------------------ layout
  let G = null, strip = null, stripDirty = true;
  function layout() {
    const w = cv.w, h = cv.h, phone = w < 640;
    if (phone) {
      const x0 = 16 + 26, x1 = w - 16;
      G = { phone, x0, x1, sy: 108, sh: 52, py0: 172, py1: h - 22, textX: 16, textY: 22, textW: w - 150, sc: null };
    } else {
      const x0 = 24 + 30, x1 = w >= 860 ? w - 268 : w - 24;
      G = { phone, x0, x1, sy: 22, sh: Math.min(120, h * .2), py0: 22 + Math.min(120, h * .2) + 26, py1: h - 30, textX: w - 238, textY: 0, textW: 214,
        sc: w >= 860 ? { x: w - 238, y: 212, w: 214, h: Math.min(214, h - 380) } : null };
      if (G.sc && G.sc.h < 150) G.sc = null;
    }
    stripDirty = true;
  }
  cv.onResize(layout); layout();
  const XU = (c) => G.x0 + (c + .5) / M * (G.x1 - G.x0);
  const YD = (d) => G.py1 - d / DMAX * (G.py1 - G.py0);

  // the camera image, drawn once (and again if the dark surface changes): a simple perspective from the depths
  function renderStrip() {
    const W = Math.max(10, Math.round(G.x1 - G.x0)), H = Math.round(G.sh), dpr = Math.min(window.devicePixelRatio || 1, 2);
    strip = strip || document.createElement('canvas'); strip.width = Math.round(W * dpr); strip.height = Math.round(H * dpr);
    const s = strip.getContext('2d'); s.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hy = H * .5, f = H * .5;
    const g1 = s.createLinearGradient(0, 0, 0, H); g1.addColorStop(0, '#191b36'); g1.addColorStop(.5, '#2a2c55'); g1.addColorStop(1, '#3a3760');
    s.fillStyle = g1; s.fillRect(0, 0, W, H);
    const cw = W / M;
    for (let c = 0; c < M; c++) {
      const x = c * cw, d = back[c], b = clamp(1.18 - d / 9.5, .22, 1);
      const top = hy - f * (HCEIL - HC) / d, bot = hy + f * HC / d;
      const base = mat[c] === 2 ? [110, 108, 160] : [150, 146, 200];
      s.fillStyle = `rgb(${base[0] * b | 0},${base[1] * b | 0},${base[2] * b | 0})`; s.fillRect(x, top, cw + .6, bot - top);
    }
    for (let c = 0; c < M; c++) {
      const x = c * cw;
      if (objH[c] > 0) {
        const od = dTrue[c], ob = clamp(1.2 - od / 9, .25, 1), ot = hy - f * (objH[c] - HC) / od, obt = hy + f * HC / od;
        const oc = mat[c] === 1 ? [246, 200, 160] : dark ? [34, 32, 50] : [176, 150, 186];
        s.fillStyle = `rgb(${oc[0] * ob | 0},${oc[1] * ob | 0},${oc[2] * ob | 0})`; s.fillRect(x, ot, cw + .6, obt - ot);
      }
      if (c > 0 && Math.abs(dTrue[c] - dTrue[c - 1]) > .6) { s.fillStyle = 'rgba(16,17,36,.55)'; s.fillRect(x - .5, 0, 1.2, H); }
    }
    stripDirty = false;
  }

  const wrapCache = new Map();
  function wrapped(str, maxW, size) {
    const key = str + '|' + Math.round(maxW) + '|' + size; let v = wrapCache.get(key); if (v) return v;
    ctx.font = `400 ${size}px ${F.sans}`; v = []; let line = '';
    for (const word of str.split(' ')) { const t = line ? line + ' ' + word : word; if (ctx.measureText(t).width > maxW && line) { v.push(line); line = word; } else line = t; }
    if (line) v.push(line); if (wrapCache.size > 200) wrapCache.clear(); wrapCache.set(key, v); return v;
  }

  // ------------------------------------------------------------ drawing
  const ease = (a) => a < .5 ? 4 * a * a * a : 1 - (-2 * a + 2) ** 3 / 2;
  function draw() {
    const w = cv.w, h = cv.h; cv.clear();
    if (stripDirty) renderStrip();
    const { x0, x1, sy, sh, py0, py1 } = G, fs = G.phone ? 10.5 : 11.5;
    const a = fitted ? ease(Math.min(1, fitT / .9)) : 0;
    // camera strip
    ctx.save(); roundRect(ctx, x0, sy, x1 - x0, sh, 8); ctx.clip(); ctx.drawImage(strip, x0, sy, x1 - x0, sh); ctx.restore();
    const hy = sy + sh * .5;
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(243,238,242,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, hy); ctx.lineTo(x1, hy); ctx.stroke(); ctx.setLineDash([]);
    for (let i = 0; i < nPts; i++) if (pon[i]) { ctx.fillStyle = C.teal; ctx.beginPath(); ctx.arc(XU(pc[i]), hy, 2.2, 0, TAU); ctx.fill(); }
    { const lab = G.phone ? 'camera image · dashed row is plotted' : 'camera image · the dashed row is plotted below'; ctx.font = `400 ${fs}px ${F.sans}`; const tw = ctx.measureText(lab).width;
      ctx.fillStyle = 'rgba(27,30,61,.78)'; roundRect(ctx, x0 + 6, sy + 5, tw + 12, fs + 8, 6); ctx.fill(); text(ctx, lab, x0 + 12, sy + 9 + fs * .82, { size: fs, color: C.ink }); }

    // plot frame and depth ticks
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, py0 - 4); ctx.lineTo(x0, py1); ctx.lineTo(x1, py1); ctx.stroke();
    ctx.strokeStyle = C.grid; ctx.beginPath();
    for (let d = 2; d <= DMAX; d += 2) { ctx.moveTo(x0, YD(d)); ctx.lineTo(x1, YD(d)); }
    ctx.stroke();
    for (let d = 0; d <= DMAX; d += 2) text(ctx, d + (d === DMAX ? ' m' : ''), x0 - 6, YD(d) + 4, { size: 10, color: C.faint, font: F.mono, align: 'right' });
    text(ctx, 'depth', x0 + 6, py0 + 6, { size: fs, color: C.faint });
    text(ctx, 'image column →', x1, py1 + 16, { size: fs, color: C.faint, align: 'right' });
    // dark surface band
    if (dark) {
      const bx0 = G.x0 + DARK0 * (x1 - x0), bx1 = G.x0 + DARK1 * (x1 - x0);
      ctx.fillStyle = 'rgba(240,138,126,.07)'; ctx.fillRect(bx0, py0, bx1 - bx0, py1 - py0);
      text(ctx, G.phone ? 'dark: no returns' : 'dark surface: no laser returns', (bx0 + bx1) / 2, py0 + 8, { size: fs, color: C.danger, align: 'center' });
    }
    // true depth
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let c = 0; c < M; c++) { const X = XU(c), Y = YD(dTrue[c]); c ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    ctx.stroke();
    // network: raw (rose) morphing into fitted (teal)
    for (let c = 0; c < M; c++) shown[c] = lerp(rel[c], fa * rel[c] + fb, a);
    if (a > 0) { ctx.strokeStyle = 'rgba(239,177,180,.35)'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 4]); ctx.beginPath(); for (let c = 0; c < M; c++) { const X = XU(c), Y = YD(rel[c]); c ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); } ctx.stroke(); ctx.setLineDash([]); }
    ctx.strokeStyle = a > .5 ? C.teal : C.rose; ctx.lineWidth = 2.4; ctx.beginPath();
    for (let c = 0; c < M; c++) { const X = XU(c), Y = YD(shown[c]); c ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    ctx.stroke();
    // laser points, with the gap to the network at the same pixel
    for (let i = 0; i < nPts; i++) {
      const X = XU(pc[i]), Y = YD(pz[i]);
      if (!pon[i]) { ctx.strokeStyle = 'rgba(240,138,126,.6)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(X - 3, Y - 3); ctx.lineTo(X + 3, Y + 3); ctx.moveTo(X + 3, Y - 3); ctx.lineTo(X - 3, Y + 3); ctx.stroke(); continue; }
      ctx.strokeStyle = 'rgba(127,212,207,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X, YD(shown[pc[i]])); ctx.stroke();
      ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(X, Y, 4.4, 0, TAU); ctx.fill();
      ctx.fillStyle = C.teal; ctx.beginPath(); ctx.arc(X, Y, 3.2, 0, TAU); ctx.fill();
    }
    // direct labels
    const cDoor = Math.round(.51 * M), lx = XU(Math.round(.315 * M)), lh = G.phone ? 13 : 15;
    text(ctx, 'true depth', XU(cDoor), YD(dTrue[cDoor]) - 9, { size: fs, color: C.ink, align: 'center' });
    if (G.phone) {
      if (a < .5) text(ctx, 'network guess (wrong scale)', XU(M / 2), YD(.9), { size: fs, color: C.rose, align: 'center' });
      else text(ctx, 'network, rescaled', XU(M / 2), YD(.9), { size: fs, color: C.teal, align: 'center' });
    } else if (a < .5) {
      const y0 = YD(rel[Math.round(.38 * M)]) + 18;
      text(ctx, 'network guess:', lx, y0, { size: fs, color: C.rose }); text(ctx, 'right shape,', lx, y0 + lh, { size: fs, color: C.rose }); text(ctx, 'wrong scale & offset', lx, y0 + 2 * lh, { size: fs, color: C.rose });
    } else {
      const y0 = YD(shown[Math.round(.38 * M)]) - 2 * lh - 8;
      text(ctx, 'network × scale', lx, y0, { size: fs, color: C.teal }); text(ctx, '+ offset', lx, y0 + lh, { size: fs, color: C.teal });
    }
    let li = -1, best = 1e9; for (let i = 0; i < nPts; i++) if (pon[i] && Math.abs(pc[i] - .1 * M) < best) { best = Math.abs(pc[i] - .1 * M); li = i; }
    if (li >= 0 && !G.phone && pc[li] < .13 * M) {
      const X = XU(pc[li]), Y = YD(pz[li]), Ly = YD(5.2);
      ctx.strokeStyle = 'rgba(127,212,207,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X, Y - 6); ctx.lineTo(X, Ly + 6); ctx.stroke();
      text(ctx, 'LiDAR: exact, but sparse', X - 6, Ly, { size: fs, color: C.teal });
    }

    // scatter: network value against laser depth; the fitted line's slope is the scale
    if (G.sc) {
      const S = G.sc, xmin = .9, xmax = 4.4;
      const { px: sx, py: syy } = kit.plot(ctx, S, [], { xMin: xmin, xMax: xmax, yMin: 0, yMax: DMAX, yLabel: 'laser depth (m)', xLabel: 'network value' });
      ctx.save(); ctx.beginPath(); ctx.rect(S.x + 14, S.y + 10, S.w - 28, S.h - 30); ctx.clip();
      if (nUsed >= 2) { ctx.strokeStyle = fitted ? C.heat : 'rgba(255,195,107,.35)'; ctx.lineWidth = 1.8; ctx.setLineDash(fitted ? [] : [4, 4]); ctx.beginPath(); ctx.moveTo(sx(xmin), syy(fa * xmin + fb)); ctx.lineTo(sx(xmax), syy(fa * xmax + fb)); ctx.stroke(); ctx.setLineDash([]); }
      for (let i = 0; i < nPts; i++) if (pon[i]) { ctx.fillStyle = C.teal; ctx.beginPath(); ctx.arc(sx(rel[pc[i]]), syy(pz[i]), 2.6, 0, TAU); ctx.fill(); }
      ctx.restore();
      if (nUsed >= 2) text(ctx, `slope = scale ${fa.toFixed(2)}`, S.x + 20, S.y + 32, { size: 11, color: fitted ? C.heat : C.faint, font: F.mono });
      if (nUsed >= 2) text(ctx, `offset ${fb >= 0 ? '+' : '−'}${Math.abs(fb).toFixed(2)} m`, S.x + 20, S.y + 47, { size: 11, color: fitted ? C.heat : C.faint, font: F.mono });
    }
    // status
    let s1, s2, col;
    if (nUsed < 2) { s1 = 'Not enough laser points.'; s2 = 'Two exact distances are the minimum to pin down a scale and an offset.'; col = C.danger; }
    else if (!fitted) { s1 = 'Raw network output.'; s2 = `Dense but unscaled: it cannot know metres from one photo. ${nUsed} laser points give exact rulers. Press Fit scale.`; col = C.rose; }
    else { s1 = 'Fitted: dense depth in real metres.'; s2 = `depth = ${fa.toFixed(2)} × network ${fb >= 0 ? '+' : '−'} ${Math.abs(fb).toFixed(2)} m, from ${nUsed} laser points, applied to all ${M} pixels${dark ? ', including the dark surface' : ''}.`; col = C.teal; }
    const tx = G.textX, ty = G.phone ? G.textY : (G.sc ? G.sc.y + G.sc.h + 26 : 220), tw = G.textW;
    if (G.phone || G.sc || w >= 860) {
      text(ctx, s1, tx, ty, { size: G.phone ? 12.5 : 13, color: col, weight: 500 });
      const lines = wrapped(s2, tw, G.phone ? 11 : 12);
      for (let k = 0; k < lines.length && k < (G.phone ? 3 : 5); k++) text(ctx, lines[k], tx, ty + 17 + k * (G.phone ? 14 : 16), { size: G.phone ? 11 : 12, color: C.muted });
    }
  }

  // ------------------------------------------------------------ loop
  placePoints();
  let dirty = true, lastSig = '';
  cv.onResize(() => { dirty = true; });
  const loop = kit.loop((dt) => {
    T += dt; if (fitted) fitT += dt;
    const sig = nPts + '|' + sigma + '|' + dark + '|' + fitted + '|' + (fitted && fitT < 1 ? fitT : 1);
    if (sig !== lastSig || dirty) { lastSig = sig; dirty = false; draw(); }
    rBefore.set(errBefore.toFixed(2) + ' m');
    rAfter.set(fitted && nUsed >= 2 ? Math.round(errAfter * 100) + ' cm' : '…');
    rScale.set(fitted && nUsed >= 2 ? '× ' + fa.toFixed(2) : '…');
  });
  draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

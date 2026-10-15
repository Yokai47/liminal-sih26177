// GPS-optional handover (ported from the team's Layer 1 sim, tab 4). The drone flies a 100 m transect with two
// stretches of tree canopy. EKF3 fuses every position source it has, weighted by its covariance: under canopy the GPS
// variance rises, so GPS loses weight and SLAM gains it, continuously, with no mode switch. SLAM drifts more when the
// scene has few features. Same model as the team's: GPS variance 0.8 + 160 x density^2, SLAM variance 3 + 70 x (1 - feature
// quality), read here in m^2, and inverse-variance fusion. GPS-optional, not GPS-denied.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp, gauss } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const A = { teal: '127,212,207', rose: '239,177,180', haze: '143,140,196', heat: '255,195,107', ink: '243,238,242', danger: '240,138,126' };
  const rgba = (k, a) => `rgba(${A[k]},${a})`;

  let canopy = 0.55, fq = 0.75;
  kit.slider(controls, { label: 'Canopy density', min: 0, max: 1, step: 0.02, value: canopy, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => { canopy = v; } });
  kit.slider(controls, { label: 'SLAM feature quality', min: 0.1, max: 1, step: 0.02, value: fq, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => { fq = v; } });
  const rG = kit.readout(readouts, { label: 'GPS weight', tone: 'rose' });
  const rS = kit.readout(readouts, { label: 'SLAM weight', tone: 'haze' });
  const rE = kit.readout(readouts, { label: 'position error (fused)', tone: 'teal' });

  // ------------------------------------------------------------------ model
  const LEN = 100, AMP = 12, LAP = 14, DT = 1 / 60, NS = Math.round(LAP / DT) + 2;
  const ZONES = [[0.30, 0.46], [0.60, 0.80]];
  // tree cover thickens over a few metres at each edge of a canopy stretch, so the GPS degrades progressively
  const RAMP = 0.05, sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  function cover(u) { let p = 0; for (const [a, b] of ZONES) p = Math.max(p, Math.min(sm((u - a + RAMP) / (2 * RAMP)), sm((b + RAMP - u) / (2 * RAMP)))); return p; }
  const lapA = { ex: new Float32Array(NS), ey: new Float32Array(NS), wg: new Float32Array(NS), n: 0 };
  const lapB = { ex: new Float32Array(NS), ey: new Float32Array(NS), wg: new Float32Array(NS), n: 0 };
  let cur = lapA, prev = lapB;
  const truthX = new Float32Array(NS), truthY = new Float32Array(NS);
  for (let i = 0; i < NS; i++) { const u = Math.min(1, i * DT / LAP); truthX[i] = u * LEN; truthY[i] = AMP * Math.sin(u * Math.PI * 3); }
  const NF = 24, fixX = new Float32Array(NF), fixY = new Float32Array(NF); let fixN = 0, fixI = 0;
  let u = 0, acc = 0, k = 0, zx = 0, zy = 0, gex = 0, gey = 0, dx = 0, dy = 0, err = 0, wg = 0.9, gvar = 1, svar = 1, tx = 0, ty = 0, gx = 0, gy = 0, sx = 0, sy = 0, ex = 0, ey = 0;
  const TAU = 1.5;                                   // GPS errors wander (multipath) rather than jumping as white noise
  function step() {
    u += DT / LAP;
    if (u >= 1) { u -= 1; const t = prev; prev = cur; cur = t; cur.n = 0; dx = dy = 0; }
    tx = u * LEN; ty = AMP * Math.sin(u * Math.PI * 3);
    const dense = canopy * (0.12 + 0.88 * cover(u));
    gvar = 0.8 + dense * dense * 160;                // GPS covariance grows under canopy
    const a = Math.exp(-DT / TAU), b = Math.sqrt(1 - a * a), sg = Math.sqrt(gvar);
    zx = a * zx + b * gauss(); zy = a * zy + b * gauss();   // unit wander, scaled so the error always matches the stated covariance
    gex = sg * zx; gey = sg * zy;
    dx += gauss() * 0.13 * (1.15 - fq); dy += gauss() * 0.13 * (1.15 - fq);   // SLAM drifts, worse with poor features
    svar = 3 + (1 - fq) * 70;
    wg = (1 / gvar) / ((1 / gvar) + (1 / svar));       // inverse-variance fusion: this IS the handover, no switch
    gx = tx + gex; gy = ty + gey; sx = tx + dx; sy = ty + dy;
    ex = wg * gx + (1 - wg) * sx; ey = wg * gy + (1 - wg) * sy;
    if (cur.n < NS) { cur.ex[cur.n] = ex; cur.ey[cur.n] = ey; cur.wg[cur.n] = wg; cur.n++; }
    err += (Math.hypot(ex - tx, ey - ty) - err) * (1 - Math.exp(-DT / 0.5));
    if (++k % 12 === 0) { fixX[fixI] = gx; fixY[fixI] = gy; fixI = (fixI + 1) % NF; fixN = Math.min(NF, fixN + 1); }   // 5 Hz GPS fixes
  }
  // warm up one lap so the previous-lap traces exist from the first frame
  for (let i = 0; i < NS - 2; i++) step();

  // tree canopy blobs, fixed positions; more of them show as density rises
  const R = kit.rng(7), TREES = [];
  for (const [a, b] of ZONES) for (let i = 0; i < 52; i++) TREES.push({ x: (a - RAMP + R() * (b - a + 2 * RAMP)) * LEN, y: (R() * 2 - 1) * 19, r: 1.6 + R() * 2.4, th: R(), cv: 0 });
  for (const t of TREES) t.cv = cover(t.x / LEN);

  // ------------------------------------------------------------------ layout
  const bg = document.createElement('canvas'), bctx = bg.getContext('2d'); let bgKey = '';
  let L;
  function layout() {
    const w = cv.w, h = cv.h, nar = w < 640, pad = nar ? 10 : 20;
    const map = { x: pad, y: nar ? 8 : 16, w: w - 2 * pad, h: nar ? Math.min(220, h * .56) : Math.max(220, h * .6) };
    const ch = { x: pad, y: map.y + map.h + (nar ? 8 : 12), w: w - 2 * pad, h: 0 }; ch.h = h - ch.y - (nar ? 8 : 16);
    const gl = nar ? 14 : 34, gr = nar ? 14 : 30;   // plot gutters, shared by map and chart so x lines up
    const s = Math.min((map.w - gl - gr) / LEN, (map.h - 24) / 38);
    const x0 = map.x + gl + ((map.w - gl - gr) - s * LEN) / 2, cy = map.y + map.h / 2 + (nar ? 4 : 6);
    L = { nar, map, ch, s, x0, cy, X: (m) => x0 + m * s, Y: (m) => cy + m * s };
    bgKey = '';
  }
  cv.onResize(layout); layout();

  // ------------------------------------------------------------------ drawing
  // the static layer (panels, canopy, trees, true path, axes) is drawn once per canopy value or size, then blitted
  function polyline(g, xs, ys, from, to, every) { g.beginPath(); for (let i = from; i < to; i += (i + every < to ? every : 1)) { const px = L.X(xs[i]), py = L.Y(ys[i]); i === from ? g.moveTo(px, py) : g.lineTo(px, py); } g.stroke(); }
  function chartY(v) { const ch = L.ch, top = ch.y + (L.nar ? 20 : 30), bot = ch.y + ch.h - (L.nar ? 10 : 16); return bot - v * (bot - top); }
  function drawStatic(g) {
    const { nar, map, ch, X, Y, s } = L;
    g.fillStyle = C.bg; g.fillRect(0, 0, cv.w, cv.h);
    g.fillStyle = C.panel; roundRect(g, map.x, map.y, map.w, map.h, 12); g.fill();
    g.save(); roundRect(g, map.x, map.y, map.w, map.h, 12); g.clip();
    const band = g.createLinearGradient(X(0), 0, X(LEN), 0), clear = 'rgba(127,212,207,0)', full = 'rgba(127,212,207,1)';
    band.addColorStop(0, clear); for (const [a, b] of ZONES) { band.addColorStop(a - RAMP, clear); band.addColorStop(a + RAMP, full); band.addColorStop(b - RAMP, full); band.addColorStop(b + RAMP, clear); } band.addColorStop(1, clear);
    g.globalAlpha = 0.03 + canopy * 0.1; g.fillStyle = band; g.fillRect(X(0), map.y, LEN * s, map.h); g.globalAlpha = 1;
    g.fillStyle = rgba('teal', 0.12);
    for (const t of TREES) if (t.th < canopy * t.cv) { g.beginPath(); g.arc(X(t.x), Y(t.y), t.r * s, 0, 7); g.fill(); }
    for (let m = 0; m <= LEN; m += 25) text(g, m + ' m', X(m), map.y + map.h - (nar ? 6 : 9), { size: nar ? 9.5 : 10.5, color: C.faint, font: F.mono, align: m === 0 ? 'left' : m === LEN ? 'right' : 'center' });
    for (const [a, b] of ZONES) text(g, 'canopy', X((a + b) / 2 * LEN), map.y + map.h - (nar ? 18 : 24), { size: nar ? 10 : 11.5, color: rgba('teal', .55 + canopy * .4), align: 'center' });
    g.strokeStyle = rgba('ink', .85); g.lineWidth = 2.2; g.lineJoin = 'round'; polyline(g, truthX, truthY, 0, NS - 1, 3);
    if (!nar) text(g, 'true path', X(LEN / 6), Y(AMP) + 30, { size: 11.5, color: C.ink, align: 'center' });
    g.restore();
    text(g, nar ? 'GPS-optional, not GPS-denied' : 'GPS-optional, not GPS-denied: GPS is used whenever it can be trusted, and never required.', map.x + (nar ? 10 : 16), map.y + (nar ? 15 : 22), { size: nar ? 10.5 : 12.5, color: C.muted, weight: 500 });
    g.fillStyle = C.panel; roundRect(g, ch.x, ch.y, ch.w, ch.h, 10); g.fill();
    g.save(); roundRect(g, ch.x, ch.y, ch.w, ch.h, 10); g.clip();
    g.globalAlpha = 0.03 + canopy * 0.1; g.fillStyle = band; g.fillRect(X(0), ch.y, LEN * s, ch.h); g.globalAlpha = 1;
    g.strokeStyle = C.line; g.lineWidth = 1; g.beginPath(); g.moveTo(X(0), chartY(0)); g.lineTo(X(LEN), chartY(0)); g.stroke();
    g.strokeStyle = C.grid; g.beginPath(); g.moveTo(X(0), chartY(1)); g.lineTo(X(LEN), chartY(1)); g.moveTo(X(0), chartY(.5)); g.lineTo(X(LEN), chartY(.5)); g.stroke();
    if (!nar) { text(g, '100%', X(0) - 6, chartY(1), { size: 10, color: C.faint, font: F.mono, align: 'right', base: 'middle' }); text(g, '0', X(0) - 6, chartY(0), { size: 10, color: C.faint, font: F.mono, align: 'right', base: 'middle' }); }
    g.restore();
    text(g, nar ? 'source weights: they slide, no switch' : 'weight of each source in the fused estimate: the handover is continuous, there is no switch', ch.x + (nar ? 10 : 16), ch.y + (nar ? 14 : 19), { size: nar ? 10 : 11.5, color: C.faint });
  }
  function ensureBg() {
    const key = cv.w + 'x' + cv.h + '@' + cv.dpr + '|' + canopy;
    if (key === bgKey) return; bgKey = key;
    bg.width = Math.round(cv.w * cv.dpr); bg.height = Math.round(cv.h * cv.dpr); bctx.setTransform(cv.dpr, 0, 0, cv.dpr, 0, 0);
    drawStatic(bctx);
  }
  function lapLine(lap, from, to, col, lw, alpha, every) {
    if (to - from < 2) return;
    ctx.strokeStyle = col; ctx.globalAlpha = alpha; ctx.lineWidth = lw; ctx.lineJoin = 'round'; polyline(ctx, lap.ex, lap.ey, from, to, every); ctx.globalAlpha = 1;
  }
  function draw() {
    const w = cv.w, { nar, map, ch, X, Y, s } = L;
    ensureBg(); ctx.drawImage(bg, 0, 0, cv.w, cv.h);
    ctx.save(); roundRect(ctx, map.x, map.y, map.w, map.h, 12); ctx.clip();
    // last lap's estimate ahead of the drone (faint), this lap's estimate
    const n = cur.n;
    lapLine(prev, n, prev.n, C.teal, 1.5, 0.22, 2);
    lapLine(cur, 0, n, C.teal, 2, 1, 1);
    // GPS fixes and their covariance, SLAM, the estimate, the drone
    ctx.fillStyle = rgba('rose', .75);
    for (let i = 0; i < fixN; i++) { const j = (fixI - 1 - i + NF) % NF; ctx.globalAlpha = 1 - i / NF; ctx.beginPath(); ctx.arc(X(fixX[j]), Y(fixY[j]), nar ? 1.8 : 2.4, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    const sg = Math.sqrt(gvar), lgx = X(fixX[(fixI - 1 + NF) % NF]), lgy = Y(fixY[(fixI - 1 + NF) % NF]);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = rgba('rose', .7); ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(lgx, lgy, sg * s, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    const DX = X(tx), DY = Y(ty), EX = X(ex), EY = Y(ey), SX = X(sx), SY = Y(sy);
    ctx.fillStyle = C.haze; ctx.beginPath(); ctx.arc(SX, SY, nar ? 2.6 : 3.4, 0, 7); ctx.fill();
    ctx.strokeStyle = rgba('danger', .8); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(DX, DY); ctx.lineTo(EX, EY); ctx.stroke();
    ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(DX, DY, nar ? 3.5 : 5, 0, 7); ctx.fill();
    ctx.fillStyle = C.teal; ctx.beginPath(); ctx.arc(EX, EY, nar ? 3 : 4, 0, 7); ctx.fill();
    const fs = nar ? 10 : 11.5;
    // labels: GPS above its circle, SLAM to the left of its dot, fused to the right of its dot; nudge apart if they collide
    ctx.font = `500 ${fs}px ${F.sans}`;
    const gl = `GPS ±${sg.toFixed(1)} m`, gw = ctx.measureText(gl).width + 4, fl = nar ? 'fused' : 'fused estimate', fw = ctx.measureText(fl).width, slw = ctx.measureText('SLAM').width, lh = fs + 3;
    const boxes = [
      { t: gl, x: clamp(lgx - gw / 2, map.x + 8, map.x + map.w - gw - 8), y: clamp(lgy - sg * s - 8, map.y + (nar ? 32 : 44), map.y + map.h - 34), w: gw, c: C.rose },
      { t: 'SLAM', x: SX - 10 - slw, y: SY + 4, w: slw, c: C.haze },
      { t: fl, x: EX + 10, y: EY + 4, w: fw, c: C.teal },
    ];
    for (let i = 1; i < 3; i++) for (let j = 0; j < i; j++) {
      const a2 = boxes[i], b2 = boxes[j];
      if (a2.x < b2.x + b2.w && b2.x < a2.x + a2.w && Math.abs(a2.y - b2.y) < lh) a2.y = b2.y + (a2.y >= b2.y ? lh : -lh);
    }
    const iw = nar ? 140 : 252, ih = nar ? 112 : 200;   // keep labels out from under the 3-D view in the top-right corner
    for (const bx of boxes) if (bx.x + bx.w > w - iw && bx.y - lh < ih) bx.y = ih + lh;
    for (const bx of boxes) text(ctx, bx.t, bx.x, bx.y, { size: fs, color: bx.c, weight: 500, font: bx.c === C.rose ? F.mono : F.sans });
    ctx.restore();
    // weight chart, x aligned with the map
    ctx.save(); roundRect(ctx, ch.x, ch.y, ch.w, ch.h, 10); ctx.clip();
    const wline = (lap, from, to, gps, col, lw, al, every) => {
      if (to - from < 2) return; ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.globalAlpha = al; ctx.beginPath();
      for (let i = from; i < to; i += (i + every < to ? every : 1)) { const v = gps ? lap.wg[i] : 1 - lap.wg[i], px = X(truthX[i]), py = chartY(v); i === from ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke(); ctx.globalAlpha = 1;
    };
    wline(prev, n, prev.n, true, C.rose, 1.4, .25, 3); wline(prev, n, prev.n, false, C.haze, 1.4, .3, 3);
    wline(cur, 0, n, true, C.rose, 2.2, 1, 2); wline(cur, 0, n, false, C.haze, 2.2, 1, 2);
    const nx = X(tx), top = chartY(1), bot = chartY(0);
    ctx.strokeStyle = rgba('heat', .5); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(nx, top - 6); ctx.lineTo(nx, bot); ctx.stroke();
    const yg = chartY(wg), ys = chartY(1 - wg), sep = Math.abs(yg - ys) < 14 ? (yg < ys ? -7 : 7) : 0;
    const right = nx > ch.x + ch.w - 90;
    text(ctx, `GPS ${Math.round(wg * 100)}%`, nx + (right ? -8 : 8), yg + sep, { size: fs, color: C.rose, font: F.mono, align: right ? 'right' : 'left', base: 'middle' });
    text(ctx, `SLAM ${Math.round((1 - wg) * 100)}%`, nx + (right ? -8 : 8), ys - sep, { size: fs, color: C.haze, font: F.mono, align: right ? 'right' : 'left', base: 'middle' });
    ctx.restore();
  }

  const loop = kit.loop((dt) => {
    acc += dt; let i = 0; while (acc >= DT && i < 6) { step(); acc -= DT; i++; } if (i === 6) acc = 0;
    draw();
    rG.set(Math.round(wg * 100) + '%'); rS.set(Math.round((1 - wg) * 100) + '%');
    rE.set(err.toFixed(1) + ' m'); const tone = err > 3 ? 'danger' : 'teal'; if (tone !== eTone) { eTone = tone; rE.tone(tone); }
  });
  let eTone = 'teal';
  draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

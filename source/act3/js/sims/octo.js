// OctoMap: three states and log-odds. A 2-D slice of the map (the plane of the 2-D LiDAR) as a 64 x 64 grid of
// 15 cm cells. Every cell starts UNKNOWN. Each laser ray adds evidence: the cell it ends in gets +0.85 (a hit),
// every cell it passes through gets -0.4 (a miss), clamped to [-2, +3.5], stored as log-odds l = log(p / (1 - p)).
// Dust makes single false hits that fade as later rays pass through. The quadtree view shows how OctoMap stores
// big uniform regions as one block and only subdivides where there is detail.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const TAU = Math.PI * 2;
  const N = 64, CELL_M = .15, RANGE = 12 / CELL_M;       // RPLidar A1M8: 12 m
  const HIT = .85, MISS = -.4, LMIN = -2, LMAX = 3.5;      // OctoMap defaults (p_hit 0.7, p_miss 0.4, clamping 0.12 / 0.97)
  const pOf = (l) => 1 / (1 + Math.exp(-l));

  // ------------------------------------------------------------ the real building slice (what the laser can hit)
  const truth = new Uint8Array(N * N);
  const fill = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < N && y < N) truth[y * N + x] = 1; };
  fill(1, 1, 62, 1); fill(1, 62, 62, 62); fill(1, 1, 1, 62); fill(62, 1, 62, 62);   // outer walls
  fill(38, 1, 38, 26); fill(38, 34, 38, 62);                                           // wall with a doorway (1 m)
  fill(39, 20, 47, 20); fill(54, 20, 62, 20);                                          // second room, another doorway
  fill(18, 13, 21, 16);                                                                // pillar
  fill(7, 45, 17, 46);                                                                 // desk
  { const r = kit.rng(21);                                                             // a debris pile: the detailed corner
    for (let k = 0; k < 26; k++) { const x = 25 + Math.floor(r() * 12), y = 49 + Math.floor(r() * 12), s = r() < .35 ? 1 : 0; fill(x, y, x + s, y + (r() < .5 ? 0 : 1)); }
    for (let k = 0; k < 8; k++) { const x = 44 + Math.floor(r() * 16), y = 44 + Math.floor(r() * 16); fill(x, y, x + 1, y); } }

  // ------------------------------------------------------------ the map the drone builds
  const L = new Float32Array(N * N), known = new Uint8Array(N * N);
  let dust = .08, showTree = false, T = 0, sweep = 0, tPath = 0;
  const WAY = [[9, 26], [22, 27], [31, 30], [27, 40], [14, 37], [9, 26]];
  const WLEN = []; let WTOT = 0; for (let i = 1; i < WAY.length; i++) { const d = Math.hypot(WAY[i][0] - WAY[i - 1][0], WAY[i][1] - WAY[i - 1][1]); WLEN.push(d); WTOT += d; }
  const drone = { x: WAY[0][0], y: WAY[0][1] };
  function placeDrone() {
    let s = (tPath * 1.4) % WTOT;
    for (let i = 0; i < WLEN.length; i++) { if (s <= WLEN[i]) { const f = s / WLEN[i]; drone.x = WAY[i][0] + (WAY[i + 1][0] - WAY[i][0]) * f + .5; drone.y = WAY[i][1] + (WAY[i + 1][1] - WAY[i][1]) * f + .5; return; } s -= WLEN[i]; }
  }
  function rescan() { L.fill(0); known.fill(0); tPath = 0; sweep = 0; placeDrone(); rayN = 0; dustN = 0; treeDirty = true; }

  // recent rays and dust hits (fixed-size rings, no per-frame allocation)
  const RAYKEEP = 36, rayX = new Float32Array(RAYKEEP), rayY = new Float32Array(RAYKEEP), rayDust = new Uint8Array(RAYKEEP); let rayN = 0;
  const DKEEP = 40, dX = new Float32Array(DKEEP), dY = new Float32Array(DKEEP), dAge = new Float32Array(DKEEP).fill(99); let dustN = 0;
  const rnd = kit.rng(9); let lastDust = -1;
  function castRay(a) {
    const dx = Math.cos(a), dy = Math.sin(a), px = drone.x, py = drone.y;
    let cx = Math.floor(px), cy = Math.floor(py);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? Math.abs(1 / dx) : 1e9, tdy = Math.abs(dy) > 1e-9 ? Math.abs(1 / dy) : 1e9;
    let tmx = Math.abs(dx) > 1e-9 ? (dx > 0 ? cx + 1 - px : px - cx) * tdx : 1e9, tmy = Math.abs(dy) > 1e-9 ? (dy > 0 ? cy + 1 - py : py - cy) * tdy : 1e9;
    // a dust return: with probability "dust" this ray stops on a speck somewhere before the wall
    const isDust = rnd() < dust, dustT = isDust ? 1.2 + rnd() * 30 : 1e9;
    let t = 0, end = 0;
    for (let guard = 0; guard < 200; guard++) {
      if (tmx < tmy) { cx += sx; t = tmx; tmx += tdx; } else { cy += sy; t = tmy; tmy += tdy; }
      if (cx < 0 || cy < 0 || cx >= N || cy >= N || t > RANGE) { end = 0; break; }
      const i = cy * N + cx;
      if (truth[i]) { L[i] = Math.min(LMAX, L[i] + HIT); known[i] = 1; end = 1; break; }
      if (t >= dustT) {
        if (T - lastHoverT > 4 && T - lastAuto > 4.5) {          // the inspector jumps to this fresh dust hit, keeping the moment before it
          sel = prevSel = i; lastAuto = T; hCount = 0; hist[hHead] = known[i] ? L[i] : NaN; hHead = (hHead + 1) % HN; hCount = 1;
        }
        L[i] = Math.min(LMAX, L[i] + HIT); known[i] = 1; end = 2; break;
      }
      L[i] = Math.max(LMIN, L[i] + MISS); known[i] = 1;
    }
    const k = rayN++ % RAYKEEP; rayX[k] = px + dx * t; rayY[k] = py + dy * t; rayDust[k] = end === 2 ? 1 : 0;
    if (end === 2) { const j = dustN++ % DKEEP; dX[j] = px + dx * t; dY[j] = py + dy * t; dAge[j] = 0; lastDust = cy * N + cx; }
  }

  // ------------------------------------------------------------ quadtree over the three states
  const LV = []; for (let s = N; s >= 1; s >>= 1) LV.push(new Uint8Array(s * s));   // LV[0] = cells, LV[6] = root
  const QMAX = N * N, qx = new Int16Array(QMAX), qy = new Int16Array(QMAX), qs = new Int16Array(QMAX), qst = new Uint8Array(QMAX);
  let qn = 0, qInner = 0, qKnownLeaves = 0, treeDirty = true;
  function buildTree() {
    const c0 = LV[0];
    for (let i = 0; i < N * N; i++) c0[i] = !known[i] ? 0 : L[i] > 0 ? 2 : 1;
    for (let lv = 1; lv < LV.length; lv++) {
      const s = N >> lv, src = LV[lv - 1], dst = LV[lv], ss = s * 2;
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const a = src[(2 * y) * ss + 2 * x], b = src[(2 * y) * ss + 2 * x + 1], c = src[(2 * y + 1) * ss + 2 * x], d = src[(2 * y + 1) * ss + 2 * x + 1];
        dst[y * s + x] = (a === b && a === c && a === d && a !== 3) ? a : 3;
      }
    }
    qn = 0; qInner = 0; qKnownLeaves = 0;
    const walk = (lv, x, y) => {
      const s = N >> lv, v = LV[lv][y * s + x];
      if (v !== 3 || lv === 0) { qx[qn] = x << lv; qy[qn] = y << lv; qs[qn] = 1 << lv; qst[qn] = v; qn++; if (v !== 0) qKnownLeaves++; return; }
      qInner++;
      walk(lv - 1, 2 * x, 2 * y); walk(lv - 1, 2 * x + 1, 2 * y); walk(lv - 1, 2 * x, 2 * y + 1); walk(lv - 1, 2 * x + 1, 2 * y + 1);
    };
    walk(LV.length - 1, 0, 0);
    treeDirty = false;
  }

  // ------------------------------------------------------------ colours: one lookup table from log-odds to a shade
  const LUT = new Uint8Array(256 * 3);
  const mix = (a, b, t) => a + (b - a) * t;
  const FREE_SURE = [40, 66, 88], FREE_UNSURE = [92, 96, 124], OCC_WEAK = [140, 132, 186], OCC_SURE = [238, 232, 244];
  for (let k = 0; k < 256; k++) {
    const l = LMIN + (LMAX - LMIN) * k / 255; let c;
    if (l <= 0) { const t = Math.pow((l - LMIN) / -LMIN, 1.4); c = FREE_SURE.map((v, j) => mix(v, FREE_UNSURE[j], t)); }
    else { const t = l / LMAX; c = OCC_WEAK.map((v, j) => mix(v, OCC_SURE[j], t)); }
    LUT[k * 3] = c[0]; LUT[k * 3 + 1] = c[1]; LUT[k * 3 + 2] = c[2];
  }
  const lutIdx = (l) => Math.max(0, Math.min(255, Math.round((l - LMIN) / (LMAX - LMIN) * 255)));
  const off = document.createElement('canvas'); off.width = N; off.height = N;
  const octx = off.getContext('2d'), img = octx.createImageData(N, N), px8 = img.data;
  let nFree = 0, nOcc = 0, nUnk = 0;
  function paintCells() {
    nFree = nOcc = nUnk = 0;
    for (let i = 0; i < N * N; i++) {
      const o = i * 4;
      if (!known[i]) { px8[o + 3] = 0; nUnk++; continue; }
      const k = lutIdx(L[i]) * 3; px8[o] = LUT[k]; px8[o + 1] = LUT[k + 1]; px8[o + 2] = LUT[k + 2]; px8[o + 3] = 255;
      if (L[i] > 0) nOcc++; else nFree++;
    }
    octx.putImageData(img, 0, 0);
  }

  // ------------------------------------------------------------ controls and readouts
  kit.slider(controls, { label: 'Dust (false hits)', min: 0, max: 30, step: 1, value: dust * 100, fmt: (v) => v + ' % of rays', onInput: (v) => { dust = v / 100; } });
  kit.toggle(controls, { label: 'Show octree', options: [{ v: 0, label: 'Grid' }, { v: 1, label: 'Octree (quadtree slice)' }], value: 0, onChange: (v) => { showTree = !!v; } });
  kit.button(controls, { label: 'Rescan', kind: 'primary', onClick: () => rescan() });
  const rCells = kit.readout(readouts, { label: 'cells: free · occupied · unknown', tone: 'ink' });
  const rMem = kit.readout(readouts, { label: 'stored: full grid → octree', tone: 'teal' });
  const rCell = kit.readout(readouts, { label: 'inspected cell: p · l', tone: 'heat' });

  // ------------------------------------------------------------ pointer: inspect a cell
  // by default the inspector follows the latest dust hit, so you can watch one false reading fade
  let hover = -1, sel = 24 * N + 38, lastHoverT = -99, lastAuto = -99, prevSel = -1;
  const HN = 300, hist = new Float32Array(HN); let hHead = 0, hCount = 0;
  const toCell = (e) => { const r = cv.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; const gx = Math.floor((x - G.gx) / G.cell), gy = Math.floor((y - G.gy) / G.cell); return gx >= 0 && gy >= 0 && gx < N && gy < N ? gy * N + gx : -1; };
  const onMove = (e) => { hover = toCell(e); if (hover >= 0) { sel = hover; lastHoverT = T; } };
  const onLeave = () => { hover = -1; };
  cv.cv.addEventListener('pointermove', onMove); cv.cv.addEventListener('pointerdown', onMove); cv.cv.addEventListener('pointerleave', onLeave);

  // ------------------------------------------------------------ layout
  let G = null, hatch = null;
  function layout() {
    const w = cv.w, h = cv.h, phone = w < 640;
    if (phone) {
      const cell = Math.max(3, Math.floor(Math.min(w - 32 - 96, h - 128) / N)), gs = cell * N;
      G = { phone, cell, gs, gx: 16, gy: h - 14 - gs, rx: 16 + gs + 14, rw: w - 16 - (16 + gs + 14), topW: w - 150 };
    } else {
      const cell = Math.max(4, Math.floor(Math.min(w - 48 - 330, h - 24 - 62) / N)), gs = cell * N;
      const rx = 24 + gs + 34;
      G = { phone, cell, gs, gx: 24, gy: 22, rx, rw: w - 24 - rx, legW: Math.min(w - 24 - rx, w - 252 - rx) };
    }
    // the hatched "unknown" layer, drawn once per size
    hatch = document.createElement('canvas'); const d = Math.min(window.devicePixelRatio || 1, 2);
    hatch.width = Math.round(G.gs * d); hatch.height = Math.round(G.gs * d);
    const hx = hatch.getContext('2d'); hx.scale(d, d);
    hx.fillStyle = '#34366a'; hx.fillRect(0, 0, G.gs, G.gs);
    hx.strokeStyle = 'rgba(160,156,214,.22)'; hx.lineWidth = 1; hx.beginPath();
    for (let k = -G.gs; k < G.gs; k += 7) { hx.moveTo(k, G.gs); hx.lineTo(k + G.gs, 0); }
    hx.stroke();
  }
  cv.onResize(layout); layout();

  // ------------------------------------------------------------ drawing
  function draw() {
    const w = cv.w, h = cv.h, { cell, gs, gx, gy } = G; cv.clear();
    const X = (c) => gx + c * cell, Y = (c) => gy + c * cell;
    ctx.drawImage(hatch, gx, gy, gs, gs);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(off, gx, gy, gs, gs); ctx.imageSmoothingEnabled = true;
    // cell grid (faint) or the quadtree
    if (!showTree && cell >= 6) {
      ctx.strokeStyle = 'rgba(27,30,61,.55)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 1; k < N; k++) { ctx.moveTo(gx + k * cell + .5, gy); ctx.lineTo(gx + k * cell + .5, gy + gs); ctx.moveTo(gx, gy + k * cell + .5); ctx.lineTo(gx + gs, gy + k * cell + .5); }
      ctx.stroke();
    }
    if (showTree) {
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,195,107,.75)'; ctx.beginPath();
      for (let i = 0; i < qn; i++) if (qs[i] >= 2) ctx.rect(X(qx[i]) + .5, Y(qy[i]) + .5, qs[i] * cell - 1, qs[i] * cell - 1);
      ctx.stroke();
      if (cell >= 4) { ctx.strokeStyle = 'rgba(255,195,107,.28)'; ctx.beginPath(); for (let i = 0; i < qn; i++) if (qs[i] === 1) ctx.rect(X(qx[i]) + .5, Y(qy[i]) + .5, cell - 1, cell - 1); ctx.stroke(); }
    }
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(gx - .5, gy - .5, gs + 1, gs + 1);
    // rays of the current sweep
    const dxp = X(drone.x), dyp = Y(drone.y), shown = Math.min(rayN, RAYKEEP);
    ctx.strokeStyle = 'rgba(127,212,207,.22)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 0; k < shown; k++) { ctx.moveTo(dxp, dyp); ctx.lineTo(X(rayX[k]), Y(rayY[k])); }
    ctx.stroke();
    // dust hits, fading
    for (let j = 0; j < DKEEP; j++) {
      if (dAge[j] > 1.2) continue; const al = 1 - dAge[j] / 1.2;
      ctx.fillStyle = `rgba(246,210,177,${(al * .95).toFixed(3)})`; ctx.beginPath(); ctx.arc(X(dX[j]), Y(dY[j]), 1.5 + 2.5 * al, 0, TAU); ctx.fill();
    }
    // drone
    ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(dxp, dyp, Math.max(4, cell * .7), 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,195,107,.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(dxp, dyp, Math.max(8, cell * 1.4), 0, TAU); ctx.stroke();
    // inspected cell
    if (sel >= 0) {
      const sx = sel % N, sy = (sel / N) | 0;
      ctx.strokeStyle = C.heat; ctx.lineWidth = 2; ctx.strokeRect(X(sx) - 1.5, Y(sy) - 1.5, cell + 3, cell + 3);
    }
    const fs = G.phone ? 10.5 : 11.5;
    if (G.phone) drawPhoneSide(fs); else drawSide(fs);
  }

  function swatch(x, y, s, kind) {
    if (kind === 0) { ctx.save(); roundRect(ctx, x, y, s, s, 3); ctx.clip(); ctx.drawImage(hatch, 0, 0, s * 2, s * 2, x, y, s, s); ctx.restore(); ctx.strokeStyle = 'rgba(160,156,214,.5)'; ctx.lineWidth = 1; roundRect(ctx, x + .5, y + .5, s - 1, s - 1, 3); ctx.stroke(); return; }
    const c = kind === 1 ? FREE_SURE : OCC_SURE; ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; roundRect(ctx, x, y, s, s, 3); ctx.fill();
  }

  function drawSide(fs) {
    const { rx, rw, legW } = G, h = cv.h;
    // the three states
    const rows = [[2, 'occupied', 'a laser ray ended here'], [1, 'free', 'rays passed through: safe to fly'], [0, 'unknown', 'never seen: could be anything']];
    rows.forEach(([k, name, desc], i) => {
      const y = 26 + i * 50; swatch(rx, y, 16, k);
      text(ctx, name, rx + 26, y + 12, { size: 13, color: C.ink, weight: 500 });
      text(ctx, desc, rx + 26, y + 30, { size: fs, color: C.muted });
    });
    // log-odds scale
    let y = 222; const bw = Math.min(rw, 420);
    text(ctx, 'each cell stores log-odds  l = log( p / (1 − p) )', rx, y, { size: 12.5, color: C.ink });
    y += 18; const by = y, bh = 14;
    for (let k = 0; k < 64; k++) { const l = LMIN + (LMAX - LMIN) * k / 63, c = lutIdx(l) * 3; ctx.fillStyle = `rgb(${LUT[c]},${LUT[c + 1]},${LUT[c + 2]})`; ctx.fillRect(rx + k * bw / 64, by, bw / 64 + .6, bh); }
    const lx = (l) => rx + (l - LMIN) / (LMAX - LMIN) * bw;
    ctx.strokeStyle = 'rgba(27,30,61,.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(lx(0), by - 3); ctx.lineTo(lx(0), by + bh + 3); ctx.stroke();
    text(ctx, '−2  (p 0.12)', rx, by + bh + 15, { size: 10.5, color: C.faint, font: F.mono });
    text(ctx, '0  (p 0.5)', lx(0), by + bh + 15, { size: 10.5, color: C.faint, font: F.mono, align: 'center' });
    text(ctx, '+3.5  (p 0.97)', rx + bw, by + bh + 15, { size: 10.5, color: C.faint, font: F.mono, align: 'right' });
    if (sel >= 0) {
      const l = known[sel] ? L[sel] : 0, mx = lx(l);
      ctx.fillStyle = known[sel] ? C.heat : 'rgba(255,195,107,.4)'; ctx.beginPath(); ctx.moveTo(mx, by - 2); ctx.lineTo(mx - 5, by - 10); ctx.lineTo(mx + 5, by - 10); ctx.closePath(); ctx.fill();
    }
    y = by + bh + 38;
    text(ctx, 'a hit adds +0.85, a pass-through adds −0.4.', rx, y, { size: fs, color: C.muted });
    text(ctx, 'One dust speck cannot outvote ten clean rays.', rx, y + 17, { size: fs, color: C.muted });
    // memory: full grid vs octree
    y += 46;
    if (y + 70 < h) {
      text(ctx, 'memory for this slice', rx, y, { size: 12.5, color: C.ink }); y += 12;
      const full = N * N, tree = qInner + qKnownLeaves, mw = Math.min(rw, 420);
      ctx.fillStyle = 'rgba(220,214,236,.22)'; roundRect(ctx, rx, y, mw, 10, 5); ctx.fill();
      text(ctx, `full grid: ${full} cells, always`, rx, y + 26, { size: fs, color: C.muted });
      ctx.fillStyle = C.teal; roundRect(ctx, rx, y + 36, Math.max(6, mw * tree / full), 10, 5); ctx.fill();
      text(ctx, `octree: ${tree} nodes (unknown costs nothing)`, rx, y + 62, { size: fs, color: C.teal });
      y += 84;
    }
    // the inspected cell's log-odds over time: +0.85 jumps, −0.4 steps, clamped
    if (y + 120 < h) {
      const ch = { x: rx, y, w: Math.min(rw, 420), h: Math.min(150, h - y - 30) };
      const { px: hx, py: hy } = kit.plot(ctx, ch, [], { xMin: 0, xMax: HN - 1, yMin: LMIN - .3, yMax: LMAX + .3, yLabel: 'inspected cell: l over the last 5 s', xLabel: 'now', zero: true });
      ctx.save(); ctx.beginPath(); ctx.rect(ch.x + 14, ch.y + 10, ch.w - 28, ch.h - 30); ctx.clip();
      ctx.strokeStyle = C.heat; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.beginPath(); let pen = false;
      for (let k = 0; k < hCount; k++) {
        const v = hist[(hHead - hCount + k + HN) % HN], xx = hx(HN - hCount + k);
        if (Number.isNaN(v)) { pen = false; continue; }
        if (pen) ctx.lineTo(xx, hy(v)); else { ctx.moveTo(xx, hy(v)); pen = true; }
      }
      ctx.stroke(); ctx.restore();
      text(ctx, 'occupied', ch.x + ch.w - 16, hy(0) - 6, { size: 10.5, color: C.faint, align: 'right' });
      text(ctx, 'free', ch.x + ch.w - 16, hy(0) + 14, { size: 10.5, color: C.faint, align: 'right' });
      if (T - lastHoverT > 4) text(ctx, 'following the latest dust hit · hover a cell to inspect it', ch.x, ch.y + ch.h + 15, { size: 10.5, color: C.faint });
    }
    // caption under the grid
    const cy = G.gy + G.gs + 24;
    if (cy < h - 22) {
      text(ctx, '"Unknown" is the state that makes exploration possible:', G.gx, cy, { size: 12.5, color: C.ink });
      text(ctx, 'the drone flies to where the known meets the unknown.', G.gx, cy + 17, { size: 12.5, color: C.muted });
    }
  }

  function drawPhoneSide(fs) {
    const { rx, rw, topW } = G;
    text(ctx, '"Unknown" is what makes', 16, 22, { size: 12, color: C.ink, weight: 500 });
    text(ctx, 'exploration possible.', 16, 38, { size: 12, color: C.ink, weight: 500 });
    text(ctx, 'hit +0.85 · pass −0.4 (log-odds)', 16, 58, { size: 11, color: C.muted });
    if (rw > 60) {
      const rows = [[2, 'occupied'], [1, 'free'], [0, 'unknown']];
      rows.forEach(([k, name], i) => { const y = G.gy + 4 + i * 34; swatch(rx, y, 13, k); text(ctx, name, rx, y + 28, { size: fs, color: C.muted }); });
    }
    void topW;
  }

  // ------------------------------------------------------------ loop
  let frame = 0;
  rescan();
  const loop = kit.loop((dt) => {
    T += dt; tPath += dt; frame++;
    placeDrone();
    const RPF = 3, STEP = TAU / 240;                // 240 rays per revolution, slowed down to watch (the real one spins 5.5 times a second)
    for (let k = 0; k < RPF; k++) { castRay(sweep); sweep += STEP; }
    for (let j = 0; j < DKEEP; j++) dAge[j] += dt;
    if (sel !== prevSel) { prevSel = sel; hCount = 0; }
    hist[hHead] = sel >= 0 && known[sel] ? L[sel] : NaN; hHead = (hHead + 1) % HN; hCount = Math.min(HN, hCount + 1);
    paintCells();
    if (frame % 8 === 0 || treeDirty) buildTree();
    draw();
    rCells.set(`${nFree} · ${nOcc} · ${nUnk}`);
    rMem.set(`${N * N} → ${qInner + qKnownLeaves}`);
    if (sel >= 0) rCell.set(known[sel] ? `p ${pOf(L[sel]).toFixed(2)} · l ${L[sel] >= 0 ? '+' : '−'}${Math.abs(L[sel]).toFixed(2)}` : 'unknown');
  });
  paintCells(); buildTree(); draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.cv.removeEventListener('pointermove', onMove); cv.cv.removeEventListener('pointerdown', onMove); cv.cv.removeEventListener('pointerleave', onLeave); cv.destroy(); } };
}

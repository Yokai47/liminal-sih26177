// Frontier exploration (ported from the team's Layer 1 sim, tab 3) with battery-aware return.
// A building of rooms and doorways, all unknown at first. A frontier is a FREE cell touching an UNKNOWN cell: the
// edge of what has been seen. The drone keeps flying to the nearest reachable frontier; nobody gives it waypoints.
// Added: the battery drains with distance flown, and the drone keeps computing the length of the shortest known path
// home. When the charge left above a reserve would only just cover that path, it turns back.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const TAU = Math.PI * 2;
  const GW = 72, GH = 44, NC = GW * GH, CELL_M = .25;          // 18 m x 11 m, 25 cm cells
  const U = 0, FR = 1, W = 2;
  const SPEED = 20;                                             // cells per second of sim time (5 m/s: sped up to watch)
  const RESERVE = 15, DRAIN = 100 / 80;                         // % kept in reserve; % per metre (pack scaled so a full charge covers 80 m)
  const g = new Uint8Array(NC), truth = new Uint8Array(NC), reach = new Uint8Array(NC), trav = new Uint8Array(NC), isF = new Uint8Array(NC);
  let SR = 10, paused = false, reachN = 1;
  const drone = { x: 0, y: 0, th: 0 }, home = { x: 0, y: 0 };
  let mode = 'explore', battery = 100, flown = 0, homeDist = 0, landedT = 0, target = -1, frontierN = 0, covered = 0, returnSample = -1;

  // ------------------------------------------------------------ the building (the team's generator, plus one cross wall)
  const R = Math.random;
  function room() {
    truth.fill(0);
    for (let x = 0; x < GW; x++) { truth[x] = 1; truth[(GH - 1) * GW + x] = 1; }
    for (let y = 0; y < GH; y++) { truth[y * GW] = 1; truth[y * GW + GW - 1] = 1; }
    const doors = [];
    const px = Math.floor(GW * .36), gp = 5 + Math.floor(R() * (GH - 14));
    for (let y = 1; y < GH - 1; y++) if (y < gp || y > gp + 5) truth[y * GW + px] = 1;
    doors.push([px, gp + 2.5]);
    const px2 = Math.floor(GW * .68), gp2 = 5 + Math.floor(R() * (GH - 14));
    for (let y = 1; y < GH - 1; y++) if (y < gp2 || y > gp2 + 5) truth[y * GW + px2] = 1;
    doors.push([px2, gp2 + 2.5]);
    // a cross wall in the right-hand section, with its own doorway
    const hy = 12 + Math.floor(R() * (GH - 24)), hx = px2 + 4 + Math.floor(R() * (GW - px2 - 14));
    for (let x = px2 + 1; x < GW - 1; x++) if (x < hx || x > hx + 5) truth[hy * GW + x] = 1;
    doors.push([hx + 2.5, hy]);
    // furniture and debris, kept clear of doorways and of home
    for (let i = 0, tries = 0; i < 5 && tries < 200; tries++) {
      const w = 3 + Math.floor(R() * 4), h = 3 + Math.floor(R() * 4), x0 = 5 + Math.floor(R() * (GW - 10 - w)), y0 = 5 + Math.floor(R() * (GH - 10 - h));
      if (doors.some(([dx, dy]) => dx > x0 - 5 && dx < x0 + w + 5 && dy > y0 - 5 && dy < y0 + h + 5)) continue;
      if (x0 < home.x + 5 && x0 + w > home.x - 5 && y0 < home.y + 5 && y0 + h > home.y - 5) continue;
      let near = false;                                          // no slivers too narrow to fly into
      for (let y = Math.max(0, y0 - 4); y < Math.min(GH, y0 + h + 4) && !near; y++) for (let x = Math.max(0, x0 - 4); x < Math.min(GW, x0 + w + 4); x++) if (truth[y * GW + x]) { near = true; break; }
      if (near) continue;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) truth[y * GW + x] = 1;
      i++;
    }
  }
  function reset() {
    home.x = 3.5 + Math.floor(R() * 3); home.y = 6.5 + Math.floor(R() * (GH - 14));
    room();
    for (let y = Math.floor(home.y) - 1; y <= Math.floor(home.y) + 1; y++) for (let x = Math.floor(home.x) - 1; x <= Math.floor(home.x) + 1; x++) truth[y * GW + x] = 0;
    // which free cells can be reached at all (for an honest coverage number)
    reach.fill(0); const q = new Int32Array(NC); let qh = 0, qt = 0; const h0 = Math.floor(home.y) * GW + Math.floor(home.x); reach[h0] = 1; q[qt++] = h0;
    while (qh < qt) { const i = q[qh++], x = i % GW; for (const j of [i - 1, i + 1, i - GW, i + GW]) { if (j < 0 || j >= NC || reach[j] || truth[j]) continue; if ((j === i - 1 && x === 0) || (j === i + 1 && x === GW - 1)) continue; reach[j] = 1; q[qt++] = j; } }
    reachN = qt;
    g.fill(U); drone.x = home.x; drone.y = home.y; drone.th = 0;
    mode = 'explore'; battery = 100; flown = 0; target = -1; pathLen = 0; pathPos = 0; landedT = 0; returnSample = -1;
    hN = 0; frame = 0; lastSenseX = -99; sense(); afterScan();
  }

  // ------------------------------------------------------------ sensing: every cell within range with a clear line of sight (team's method)
  let lastSenseX = -99, lastSenseY = -99;
  function sense() {
    const r = SR;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const gx = Math.floor(drone.x + dx), gy = Math.floor(drone.y + dy);
      if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
      const st = Math.max(Math.abs(dx), Math.abs(dy)); let blocked = false;
      for (let s = 1; s <= st; s++) {
        const ix = Math.floor(drone.x + dx * s / st), iy = Math.floor(drone.y + dy * s / st);
        if (ix < 0 || iy < 0 || ix >= GW || iy >= GH) { blocked = true; break; }
        if (truth[iy * GW + ix] === 1 && s < st) { blocked = true; break; }
      }
      if (blocked) continue;
      g[gy * GW + gx] = truth[gy * GW + gx] === 1 ? W : FR;
    }
    lastSenseX = drone.x; lastSenseY = drone.y;
  }

  // ------------------------------------------------------------ map bookkeeping: traversable cells, frontiers, coverage
  function afterScan() {
    let cov = 0;
    for (let i = 0; i < NC; i++) {
      trav[i] = 0; isF[i] = 0;
      if (g[i] !== FR) continue;
      if (reach[i]) cov++;
      const x = i % GW, y = (i / GW) | 0;
      if (x === 0 || y === 0 || x === GW - 1 || y === GH - 1) continue;
      if (g[i - 1] === U || g[i + 1] === U || g[i - GW] === U || g[i + GW] === U) isF[i] = 1;
      // keep a cell of clearance from known walls (the drone is about 70 cm across)
      let ok = 1; for (let yy = -1; yy <= 1 && ok; yy++) for (let xx = -1; xx <= 1; xx++) if (g[i + yy * GW + xx] === W) { ok = 0; break; }
      trav[i] = ok;
    }
    covered = cov;
    // like real explorers (explore_lite's min_frontier_size), ignore frontier specks smaller than 3 cells
    lab.fill(0); let n = 0;
    for (let i = 0; i < NC; i++) {
      if (!isF[i] || lab[i]) continue;
      let qh = 0, qt = 0; cq[qt++] = i; lab[i] = 1;
      while (qh < qt) { const c = cq[qh++], x = c % GW; for (let oy = -GW; oy <= GW; oy += GW) for (let ox = -1; ox <= 1; ox++) { if ((ox === -1 && x === 0) || (ox === 1 && x === GW - 1)) continue; const j = c + oy + ox; if (j >= 0 && j < NC && isF[j] && !lab[j]) { lab[j] = 1; cq[qt++] = j; } } }
      if (qt < 3) for (let k = 0; k < qt; k++) isF[cq[k]] = 0; else n += qt;
    }
    frontierN = n;
    dijkstra(cellOf(home.x, home.y), dHome, pHome);
    const dc = cellOf(drone.x, drone.y); homeDist = bestNear(dHome, dc) * CELL_M;
  }
  const lab = new Uint8Array(NC), cq = new Int32Array(NC);
  const cellOf = (x, y) => clamp(Math.floor(y), 0, GH - 1) * GW + clamp(Math.floor(x), 0, GW - 1);
  function bestNear(dist, c) { if (dist[c] < Infinity) return dist[c]; let b = Infinity; for (const o of [-1, 1, -GW, GW, -GW - 1, -GW + 1, GW - 1, GW + 1]) { const j = c + o; if (j >= 0 && j < NC && dist[j] + 1 < b) b = dist[j] + 1; } return b; }

  // ------------------------------------------------------------ shortest paths on known, traversable cells (Dijkstra, octile steps)
  const dHome = new Float32Array(NC), pHome = new Int32Array(NC), dDrone = new Float32Array(NC), pDrone = new Int32Array(NC);
  const HCAP = NC * 9, hI = new Int32Array(HCAP), hK = new Float32Array(HCAP);
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  function dijkstra(src, dist, par) {
    dist.fill(Infinity); par.fill(-1);
    let n = 0;
    const push = (i, k) => { let c = n++; hI[c] = i; hK[c] = k; while (c > 0) { const p = (c - 1) >> 1; if (hK[p] <= hK[c]) break; const ti = hI[p], tk = hK[p]; hI[p] = hI[c]; hK[p] = hK[c]; hI[c] = ti; hK[c] = tk; c = p; } };
    const pop = () => { const top = hI[0]; n--; if (n > 0) { hI[0] = hI[n]; hK[0] = hK[n]; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < n && hK[l] < hK[m]) m = l; if (r < n && hK[r] < hK[m]) m = r; if (m === c) break; const ti = hI[m], tk = hK[m]; hI[m] = hI[c]; hK[m] = hK[c]; hI[c] = ti; hK[c] = tk; c = m; } } return top; };
    dist[src] = 0; push(src, 0);
    while (n > 0 && n < HCAP - 8) {
      const k = hK[0], i = pop(); if (k > dist[i]) continue;
      const x = i % GW, y = (i / GW) | 0;
      for (const [ox, oy, cost] of NB) {
        const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const j = ny * GW + nx; if (!trav[j]) continue;
        if (ox && oy && (!trav[y * GW + nx] || !trav[ny * GW + x])) continue;   // no cutting corners
        const nd = k + cost; if (nd < dist[j]) { dist[j] = nd; par[j] = i; push(j, nd); }
      }
    }
  }

  // ------------------------------------------------------------ planning
  const path = new Int32Array(NC); let pathLen = 0, pathPos = 0;
  function planToFrontier() {
    const dc = cellOf(drone.x, drone.y), was = trav[dc]; trav[dc] = 1;
    dijkstra(dc, dDrone, pDrone); trav[dc] = was;
    let best = -1, bd = Infinity, near = -1, nd = Infinity;
    for (let i = 0; i < NC; i++) {
      if (!isF[i] || !trav[i] || dDrone[i] === Infinity) continue;
      const d = dDrone[i]; if (d < nd) { nd = d; near = i; }
      if (d >= 3 && d < bd) { bd = d; best = i; }                 // the team's rule: skip frontiers right underfoot
    }
    if (best < 0) best = near;
    target = best;
    if (best < 0) { pathLen = 0; return false; }
    let n = 0; for (let c = best; c !== -1 && n < NC; c = pDrone[c]) path[n++] = c;
    for (let a = 0, b = n - 1; a < b; a++, b--) { const t = path[a]; path[a] = path[b]; path[b] = t; }
    pathLen = n; pathPos = Math.min(1, n - 1); return true;
  }
  function planHome() {
    let c = cellOf(drone.x, drone.y), n = 0; target = -1;
    if (dHome[c] === Infinity) { for (const o of [-1, 1, -GW, GW, -GW - 1, -GW + 1, GW - 1, GW + 1]) { const j = c + o; if (j >= 0 && j < NC && dHome[j] < dHome[c]) c = j; } }
    path[n++] = c;
    for (let guard = 0; guard < NC && dHome[c] > 0; guard++) { const p = pHome[c]; if (p < 0) break; path[n++] = p; c = p; }
    pathLen = n; pathPos = Math.min(1, n - 1);
  }

  // ------------------------------------------------------------ controls and readouts
  kit.slider(controls, { label: 'Sensor range', min: 1.5, max: 6, step: .25, value: SR * CELL_M, fmt: (v) => v.toFixed(2).replace(/0$/, '') + ' m', onInput: (v) => { SR = Math.round(v / CELL_M); } });
  kit.button(controls, { label: 'New building', kind: 'primary', onClick: () => reset() });
  const bPause = kit.button(controls, { label: 'Pause', onClick: () => { paused = !paused; bPause.textContent = paused ? 'Resume' : 'Pause'; } });
  const rFr = kit.readout(readouts, { label: 'frontier cells', tone: 'rose' });
  const rCov = kit.readout(readouts, { label: 'coverage', tone: 'teal' });
  const rBat = kit.readout(readouts, { label: 'battery · path home', tone: 'heat' });

  // ------------------------------------------------------------ history for the chart
  const HN = 420, hF = new Float32Array(HN), hB = new Float32Array(HN); let hN = 0, frame = 0;

  // ------------------------------------------------------------ one simulation step
  function step(dt) {
    frame++;
    if (mode === 'landed') { landedT += dt; if (landedT > 6) reset(); return; }
    // the battery rule: compare what is left above the reserve with the shortest known path home
    const rangeLeft = Math.max(0, battery - RESERVE) / DRAIN;
    if (mode === 'explore' && rangeLeft <= homeDist + .4) { mode = 'return'; returnSample = hN; planHome(); }
    if (mode === 'explore' && (pathLen === 0 || pathPos >= pathLen || (target >= 0 && !isF[target]) || (pathPos < pathLen && !trav[path[pathPos]] && frame % 3 === 0))) {
      if (!planToFrontier()) { mode = 'done'; returnSample = hN; planHome(); }
    }
    if ((mode === 'return' || mode === 'done') && frame % 6 === 0) planHome();
    // fly along the path
    let move = SPEED * dt;
    while (move > 0 && pathPos < pathLen) {
      const c = path[pathPos], tx = c % GW + .5, ty = ((c / GW) | 0) + .5, dx = tx - drone.x, dy = ty - drone.y, d = Math.hypot(dx, dy);
      if (d < 1e-6) { pathPos++; continue; }
      const s = Math.min(move, d); drone.x += dx / d * s; drone.y += dy / d * s; move -= s; flown += s * CELL_M; battery = Math.max(0, battery - s * CELL_M * DRAIN);
      let want = Math.atan2(dy, dx), dth = Math.atan2(Math.sin(want - drone.th), Math.cos(want - drone.th)); drone.th += clamp(dth, -.25, .25);
      if (s >= d - 1e-6) pathPos++;
    }
    if ((mode === 'return' || mode === 'done') && Math.hypot(drone.x - home.x, drone.y - home.y) < .7 && pathPos >= pathLen) { mode = 'landed'; landedT = 0; }
    // scan again once it has moved a little; the frontier bookkeeping runs every few frames, not every frame
    if (Math.hypot(drone.x - lastSenseX, drone.y - lastSenseY) > .6) sense();
    if (frame % 3 === 0) afterScan();
    else { const dc = cellOf(drone.x, drone.y); homeDist = bestNear(dHome, dc) * CELL_M; }
    if (frame % 5 === 0) {
      if (hN >= HN) { hF.copyWithin(0, 1); hB.copyWithin(0, 1); hN = HN - 1; if (returnSample > 0) returnSample--; }
      hF[hN] = frontierN; hB[hN] = battery; hN++;
    }
  }

  // ------------------------------------------------------------ layout and the cell image
  const off = document.createElement('canvas'); off.width = GW; off.height = GH;
  const octx = off.getContext('2d'), img = octx.createImageData(GW, GH), px = img.data;
  const COL = { [U]: [44, 46, 88], [FR]: [40, 66, 88], [W]: [168, 164, 214] }, FRC = [239, 177, 180];
  function paint() {
    for (let i = 0; i < NC; i++) {
      const c = isF[i] ? FRC : COL[g[i]], o = i * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
  }
  let G = null;
  function layout() {
    const w = cv.w, h = cv.h, phone = w < 640;
    if (phone) {
      const cell = (w - 32) / GW, mw = cell * GW, mh = cell * GH;
      G = { phone, cell, mx: 16, my: h - 14 - mh, mw, mh, side: { x: 16, y: 20, w: Math.min(230, w - 152) }, chart: null };
    } else {
      const cell = Math.max(4, Math.floor(Math.min((w - 48 - 250) / GW, (h - 40 - 130) / GH))), mw = cell * GW, mh = cell * GH;
      G = { phone, cell, mx: 24, my: 22, mw, mh, side: { x: w - 236, y: 214, w: 212 }, chart: { x: 24, y: 22 + mh + 16, w: mw, h: Math.max(80, Math.min(190, h - mh - 22 - 16 - 12)) } };
    }
  }
  cv.onResize(layout); layout();

  // ------------------------------------------------------------ drawing
  function draw() {
    const w = cv.w, h = cv.h, { cell, mx, my, mw, mh } = G; cv.clear();
    const X = (x) => mx + x * cell, Y = (y) => my + y * cell;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(off, mx, my, mw, mh); ctx.imageSmoothingEnabled = true;
    if (cell >= 7) {
      ctx.strokeStyle = 'rgba(27,30,61,.5)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 1; x < GW; x++) { ctx.moveTo(X(x) + .5, my); ctx.lineTo(X(x) + .5, my + mh); }
      for (let y = 1; y < GH; y++) { ctx.moveTo(mx, Y(y) + .5); ctx.lineTo(mx + mw, Y(y) + .5); }
      ctx.stroke();
    }
    // sensor range
    ctx.save(); ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip();
    ctx.strokeStyle = 'rgba(127,212,207,.4)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(X(drone.x), Y(drone.y), SR * cell, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    // planned path
    if (pathPos < pathLen) {
      const ret = mode !== 'explore';
      ctx.strokeStyle = ret ? C.heat : 'rgba(243,238,242,.7)'; ctx.lineWidth = ret ? 2 : 1.4; ctx.setLineDash(ret ? [] : [4, 4]); ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(X(drone.x), Y(drone.y));
      for (let k = pathPos; k < pathLen; k++) { const c = path[k]; ctx.lineTo(X(c % GW + .5), Y(((c / GW) | 0) + .5)); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (target >= 0 && mode === 'explore') { ctx.strokeStyle = C.rose; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(target % GW + .5), Y(((target / GW) | 0) + .5), Math.max(5, cell * .9), 0, TAU); ctx.stroke(); }
    // home
    ctx.strokeStyle = C.heat; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(X(home.x), Y(home.y), Math.max(6, cell * 1.1), 0, TAU); ctx.stroke();
    text(ctx, 'H', X(home.x), Y(home.y) + 4, { size: G.phone ? 9 : 11, color: C.heat, weight: 600, align: 'center' });
    // drone
    const ds = G.phone ? 6 : 8;
    ctx.save(); ctx.translate(X(drone.x), Y(drone.y)); ctx.rotate(drone.th);
    ctx.fillStyle = C.heat; ctx.beginPath(); ctx.moveTo(ds, 0); ctx.lineTo(-ds * .65, ds * .65); ctx.lineTo(-ds * .3, 0); ctx.lineTo(-ds * .65, -ds * .65); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(mx - .5, my - .5, mw + 1, mh + 1);

    // ---- side: status, battery bar with the "needed to get home" mark, legend
    const S = G.side, fs = G.phone ? 10.5 : 11.5;
    let st, sub, col;
    if (paused) { st = 'Paused'; sub = 'press Resume'; col = C.muted; }
    else if (mode === 'explore') { st = 'Exploring'; sub = 'heading for the nearest frontier'; col = C.ink; }
    else if (mode === 'return') { st = 'Returning'; sub = 'just enough to get home'; col = C.heat; }
    else if (mode === 'done') { st = 'Mapped'; sub = 'no reachable frontiers left: going home'; col = C.teal; }
    else { st = 'Home'; sub = `landed with ${battery.toFixed(0)}% (reserve ${RESERVE}%)`; col = C.teal; }
    let y = S.y;
    text(ctx, st, S.x, y, { size: G.phone ? 12.5 : 14, color: col, weight: 500 });
    text(ctx, sub, S.x + (G.phone ? 0 : 0), y + (G.phone ? 15 : 18), { size: G.phone ? 11 : 12, color: mode === 'return' ? C.heat : C.muted });
    y += G.phone ? 26 : 34;
    const bw = S.w, bh = G.phone ? 9 : 12, need = Math.min(100, RESERVE + homeDist * DRAIN);
    ctx.fillStyle = 'rgba(220,214,236,.12)'; roundRect(ctx, S.x, y, bw, bh, bh / 2); ctx.fill();
    const fillC = battery - need < 8 ? C.danger : battery < 45 ? C.heat : C.teal;
    ctx.fillStyle = fillC; roundRect(ctx, S.x, y, Math.max(bh, bw * battery / 100), bh, bh / 2); ctx.fill();
    ctx.fillStyle = 'rgba(27,30,61,.55)'; ctx.fillRect(S.x + 1, y + 1, bw * RESERVE / 100, bh - 2);          // the reserve
    const nx = S.x + bw * need / 100;                                                                       // what the trip home needs
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(nx, y - 4); ctx.lineTo(nx, y + bh + 4); ctx.stroke();
    y += bh + (G.phone ? 13 : 17);
    text(ctx, `battery ${battery.toFixed(0)}%`, S.x, y, { size: fs, color: fillC, font: F.mono });
    text(ctx, `home needs ${need.toFixed(0)}%`, S.x + bw, y, { size: fs, color: C.ink, font: F.mono, align: 'right' });
    if (!G.phone) {
      y += 20;
      text(ctx, `shortest known path home ${homeDist.toFixed(1)} m`, S.x, y, { size: fs, color: C.muted });
      y += 16; text(ctx, `flown ${flown.toFixed(0)} m · reserve ${RESERVE}%`, S.x, y, { size: fs, color: C.muted });
      y += 30;
      const leg = [[FRC, 'frontier: free, touching unknown'], [COL[FR], 'free (seen)'], [COL[U], 'unknown'], [COL[W], 'wall']];
      for (const [c, name] of leg) { ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; roundRect(ctx, S.x, y - 10, 12, 12, 3); ctx.fill(); if (c === COL[U]) { ctx.strokeStyle = 'rgba(160,156,214,.5)'; ctx.lineWidth = 1; roundRect(ctx, S.x + .5, y - 9.5, 11, 11, 3); ctx.stroke(); } text(ctx, name, S.x + 20, y, { size: fs, color: C.muted }); y += 19; }
      y += 10;
      text(ctx, 'It turns back on distance home,', S.x, y, { size: fs, color: C.faint }); y += 15;
      text(ctx, 'not on a fixed "20% left" rule.', S.x, y, { size: fs, color: C.faint }); y += 15;
      text(ctx, '(pack scaled down for the demo)', S.x, y, { size: fs, color: C.faint });
    }

    // ---- chart: frontier count and battery over time
    if (G.chart) {
      const ch = G.chart; let mxF = 10; for (let i = 0; i < hN; i++) if (hF[i] > mxF) mxF = hF[i];
      const { px: cx, py: cy } = kit.plot(ctx, ch, [], { xMin: 0, xMax: HN - 1, yMin: 0, yMax: 1, yLabel: G.chart.w > 560 ? 'frontier cells over time: rise as rooms open, fall to zero when mapped' : 'frontier cells over time', xLabel: '' });
      if (returnSample >= 0) { ctx.strokeStyle = 'rgba(255,195,107,.5)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(cx(returnSample), ch.y + 18); ctx.lineTo(cx(returnSample), ch.y + ch.h - 22); ctx.stroke(); ctx.setLineDash([]); text(ctx, mode === 'done' ? 'mapped' : 'turn back', cx(returnSample) + 4, ch.y + 30, { size: 10.5, color: C.heat }); }
      if (hN > 1) {
        ctx.save(); ctx.beginPath(); ctx.rect(ch.x + 14, ch.y + 10, ch.w - 28, ch.h - 30); ctx.clip();
        ctx.strokeStyle = 'rgba(255,195,107,.55)'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]); ctx.beginPath();
        for (let i = 0; i < hN; i++) { const X2 = cx(i), Y2 = cy(hB[i] / 100); i ? ctx.lineTo(X2, Y2) : ctx.moveTo(X2, Y2); }
        ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = C.rose; ctx.lineWidth = 2; ctx.beginPath();
        for (let i = 0; i < hN; i++) { const X2 = cx(i), Y2 = cy(hF[i] / mxF * .92); i ? ctx.lineTo(X2, Y2) : ctx.moveTo(X2, Y2); }
        ctx.stroke(); ctx.restore();
        text(ctx, String(hF[hN - 1] | 0), Math.min(cx(hN - 1) + 6, ch.x + ch.w - 40), cy(hF[hN - 1] / mxF * .92) - 6, { size: 10.5, color: C.rose, font: F.mono });
      }
      text(ctx, `peak ${mxF | 0} cells · dashed: battery`, ch.x + ch.w - 14, ch.y + 14, { size: 10.5, color: C.faint, align: 'right' });
    }
  }

  // ------------------------------------------------------------ loop
  reset();
  const loop = kit.loop((dt) => {
    if (!paused) { step(dt / 2); step(dt / 2); }
    paint(); draw();
    rFr.set(String(frontierN));
    rCov.set((100 * covered / reachN).toFixed(0) + '%');
    rBat.set(`${battery.toFixed(0)}% · ${homeDist.toFixed(1)} m`);
  });
  paint(); draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

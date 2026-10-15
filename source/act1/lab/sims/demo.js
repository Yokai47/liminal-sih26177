// How we will prove it: the demonstration rig (spec §20). One full Layer 1 drone and ten micro-drones in an indoor
// arena, a mock collapsed room. Micro-drones cannot carry LiDAR, so four ceiling cameras (motion capture) tell each one
// where it is. A local sensing emulator then hands each drone ONLY what its own sensors could have seen from there:
// neighbours within the sensing radius r and walls in its line of sight (the walls come from the Layer 1 drone's map).
// Each drone runs the swarm rules itself on that: spread away from the neighbours it sees, keep off the walls it sees,
// head for floor it has not searched itself. 'Cheating' instead feeds every drone the global map, everyone's position
// and the whole search record, and a planner flies them: one lane each, in lockstep. It looks perfect, which is exactly
// what gives it away. Localisation from outside is legitimate; decisions from outside are not.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  cv.cv.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- the arena (metres, y down), boxes on a 0.2 m grid
  const AW = 8, AH = 5, CELL = .2, GW = 40, GH = 25, NC = GW * GH;
  const BOXES = [[0, 1.8, 1.2, .2], [1.8, .6, .6, .6], [1.8, 2.8, 1, .8], [3.2, 1.8, 2.2, .2], [4, .4, .4, .4], [6, .6, .8, .6],
    [6.2, 2.6, .6, 1], [4.2, 3, .4, .4], [7.2, 2, .8, .2], [3, 0, .2, .6]];
  const NB = BOXES.length, BX = new Float64Array(NB * 4);
  BOXES.forEach((b, i) => { BX[i * 4] = b[0]; BX[i * 4 + 1] = b[1]; BX[i * 4 + 2] = b[0] + b[2]; BX[i * 4 + 3] = b[1] + b[3]; });
  const inBox = (x, y, pad) => { for (let b = 0; b < NB; b++) if (x > BX[b * 4] - pad && x < BX[b * 4 + 2] + pad && y > BX[b * 4 + 1] - pad && y < BX[b * 4 + 3] + pad) return true; return false; };
  const blocked = new Uint8Array(NC), plannable = new Uint8Array(NC), countable = new Uint8Array(NC);
  for (let c = 0; c < NC; c++) { const x = (c % GW + .5) * CELL, y = ((c / GW | 0) + .5) * CELL; blocked[c] = inBox(x, y, 0) ? 1 : 0; plannable[c] = inBox(x, y, .09) ? 0 : 1; }
  const ND = 10, PADY = 4.5, padX = (i) => .8 * i + .3;
  const cellOf = (x, y) => clamp(Math.floor(y / CELL), 0, GH - 1) * GW + clamp(Math.floor(x / CELL), 0, GW - 1);
  // what can be searched: free cells reachable from the pads
  const bq = new Int32Array(NC), bpar = new Int32Array(NC), bvis = new Int32Array(NC); let bstamp = 0;
  let freeN = 0;
  { bstamp++; let qh = 0, qt = 0; const s0 = cellOf(padX(0), PADY); bq[qt++] = s0; bvis[s0] = bstamp;
    while (qh < qt) { const c = bq[qh++], x = c % GW; for (const o of [1, -1, GW, -GW]) { const j = c + o; if (j < 0 || j >= NC || bvis[j] === bstamp || blocked[j]) continue; if ((o === 1 && x === GW - 1) || (o === -1 && x === 0)) continue; bvis[j] = bstamp; bq[qt++] = j; } }
    for (let i = 0; i < qt; i++) { countable[bq[i]] = 1; freeN++; } }

  // ray against the arena walls and the boxes; sets hitId (box index, or 100+ for the arena walls)
  let hitId = -1;
  function ray(x, y, dx, dy, maxD) {
    let t = maxD; hitId = -1;
    if (dx > 1e-9) { const q = (AW - x) / dx; if (q < t) { t = q; hitId = 100; } } else if (dx < -1e-9) { const q = -x / dx; if (q < t) { t = q; hitId = 101; } }
    if (dy > 1e-9) { const q = (AH - y) / dy; if (q < t) { t = q; hitId = 102; } } else if (dy < -1e-9) { const q = -y / dy; if (q < t) { t = q; hitId = 103; } }
    for (let b = 0; b < NB; b++) {
      const x0 = BX[b * 4], y0 = BX[b * 4 + 1], x1 = BX[b * 4 + 2], y1 = BX[b * 4 + 3];
      let t0 = 0, t1 = t;
      if (Math.abs(dx) < 1e-9) { if (x <= x0 || x >= x1) continue; } else { let a = (x0 - x) / dx, c = (x1 - x) / dx; if (a > c) { const s = a; a = c; c = s; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) continue; }
      if (Math.abs(dy) < 1e-9) { if (y <= y0 || y >= y1) continue; } else { let a = (y0 - y) / dy, c = (y1 - y) / dy; if (a > c) { const s = a; a = c; c = s; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) continue; }
      if (t0 < t) { t = t0; hitId = b; }
    }
    return t;
  }
  const los = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy); if (d < 1e-6) return true; return ray(x1, y1, dx / d, dy / d, d) >= d - 1e-6; };

  // breadth-first path on the planning grid (8-connected, no corner cutting); returns the path length in cells into pth
  const pth = new Int32Array(NC);
  function bfs(from, goalFn) {
    bstamp++; let qh = 0, qt = 0; bq[qt++] = from; bvis[from] = bstamp; bpar[from] = -1; let goal = -1;
    while (qh < qt) {
      const c = bq[qh++]; if (c !== from && goalFn(c)) { goal = c; break; }
      const x = c % GW, y = (c / GW) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue; const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const j = ny * GW + nx; if (bvis[j] === bstamp || !plannable[j]) continue;
        if (ox && oy && (!plannable[y * GW + nx] || !plannable[ny * GW + x])) continue;
        bvis[j] = bstamp; bpar[j] = c; bq[qt++] = j;
      }
    }
    if (goal < 0) return 0;
    let n = 0; for (let c = goal; c !== -1; c = bpar[c]) pth[n++] = c;
    for (let i = 0, j = n - 1; i < j; i++, j--) { const t = pth[i]; pth[i] = pth[j]; pth[j] = t; }
    return n;
  }

  // ---------------------------------------------------------------- the Layer 1 drone: flies its own mapping loop
  const L1 = { x: 0, y: 0, th: 0, s: 0, pts: [], len: [], total: 0, scan: 0 };
  {
    const W = [[.9, .9], [2.9, 1.3], [5.7, 1.5], [7.4, 1.1], [7.4, 3.2], [5.3, 3.9], [3.4, 2.5], [1.2, 3.1]];
    const pts = [];
    for (let k = 0; k < W.length; k++) {
      const a = W[k], b = W[(k + 1) % W.length], ga = cellOf(a[0], a[1]), gb = cellOf(b[0], b[1]);
      const n = bfs(ga, (c) => c === gb);
      for (let i = 0; i < n - 1; i++) pts.push([(pth[i] % GW + .5) * CELL, ((pth[i] / GW | 0) + .5) * CELL]);
    }
    // pull the string: keep only corners that are needed for a clear line of sight (with clearance)
    const clear = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(d / .05); for (let i = 0; i <= n; i++) { const t = i / n; if (inBox(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, .22)) return false; } return true; };
    const out = [pts[0]]; let i = 0;
    while (i < pts.length - 1) { let j = Math.min(pts.length - 1, i + 1); for (let k = pts.length - 1; k > i + 1; k--) if (clear(pts[i], pts[k])) { j = k; break; } out.push(pts[j]); i = j; }
    L1.pts = out; let tot = 0; for (let k = 0; k < out.length; k++) { L1.len.push(tot); const b = out[(k + 1) % out.length]; tot += Math.hypot(b[0] - out[k][0], b[1] - out[k][1]); } L1.total = tot;
  }
  function placeL1(dt) {
    L1.s = (L1.s + .3 * dt) % L1.total;
    let k = 0; while (k < L1.pts.length - 1 && L1.len[k + 1] <= L1.s) k++;
    const a = L1.pts[k], b = L1.pts[(k + 1) % L1.pts.length], seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, t = (L1.s - L1.len[k]) / seg;
    L1.x = a[0] + (b[0] - a[0]) * t; L1.y = a[1] + (b[1] - a[1]) * t;
    const want = Math.atan2(b[1] - a[1], b[0] - a[0]); L1.th += Math.atan2(Math.sin(want - L1.th), Math.cos(want - L1.th)) * Math.min(1, dt * 3);
  }
  const SCANN = 140, scanX = new Float32Array(SCANN), scanY = new Float32Array(SCANN), scanT = new Float32Array(SCANN).fill(-99); let scanK = 0;

  // ---------------------------------------------------------------- micro-drones
  const V = .4, TURN = 4, RAD = .07, FOOT = .25, NR = 24, NB_MAX = 12;
  const x = new Float64Array(ND), y = new Float64Array(ND), th = new Float64Array(ND), want = new Float64Array(ND), dec = new Float64Array(ND);
  const mem = Array.from({ length: ND }, () => new Uint8Array(NC)), wallMem = Array.from({ length: ND }, () => new Uint8Array(NC));
  const rays = new Float32Array(ND * NR), rayHit = new Int16Array(ND * NR), nbs = new Int16Array(ND * NB_MAX), nbN = new Uint8Array(ND), wallN = new Uint8Array(ND);
  const strip = new Int8Array(ND), tgt = new Int32Array(ND).fill(-1), searched = new Uint8Array(NC), ftgt = new Int32Array(ND).fill(-1), ftT = new Float64Array(ND);
  let searchedN = 0, rSense = 1, cheat = 0, commands = 0, T = 0, state = 'run', holdT = 0, rnd = kit.rng(7), runNo = 0;
  const history = [];
  function restart() {
    rnd = kit.rng(7 + runNo * 31); runNo++;
    searched.fill(0); searchedN = 0; commands = 0; T = 0; state = 'run'; holdT = 0;
    for (let i = 0; i < ND; i++) { x[i] = padX(i); y[i] = PADY; th[i] = want[i] = -Math.PI / 2 + (rnd() - .5) * .3; dec[i] = rnd() * .1; mem[i].fill(0); wallMem[i].fill(0); strip[i] = i; tgt[i] = -1; ftgt[i] = -1; ftT[i] = 0; }
    L1.s = 0; placeL1(0);
  }

  // the local sensing emulator: from the true positions (cameras) and the Layer 1 map, compute what drone i could sense
  const seenIds = new Uint8Array(110);
  function emulate(i) {
    let n = 0; const r = rSense;
    for (let j = -1; j < ND; j++) {
      if (j === i) continue; const ox = j < 0 ? L1.x : x[j], oy = j < 0 ? L1.y : y[j], d = Math.hypot(ox - x[i], oy - y[i]);
      if (d <= r && n < NB_MAX && los(x[i], y[i], ox, oy)) nbs[i * NB_MAX + n++] = j;
    }
    nbN[i] = n; seenIds.fill(0); let w = 0;
    for (let k = 0; k < NR; k++) {
      const a = k / NR * TAU, d = ray(x[i], y[i], Math.cos(a), Math.sin(a), r);
      rays[i * NR + k] = d; rayHit[i * NR + k] = hitId;
      if (hitId >= 0) { if (!seenIds[hitId]) { seenIds[hitId] = 1; w++; } wallMem[i][cellOf(x[i] + Math.cos(a) * (d + .05), y[i] + Math.sin(a) * (d + .05))] = 1; }
    }
    wallN[i] = w;
  }
  // honest: the swarm rules, run by the drone on what it was given (its own position, nbs, rays) and its own memory
  function decideHonest(i) {
    const r = rSense, base = i * NR;
    let best = -1e9, bestA = th[i], gain = 0;
    for (let a = 0; a < 16; a++) {
      const ang = a / 16 * TAU, k = Math.round(a / 16 * NR) % NR, free = rays[base + k];
      if (free < Math.min(r, .3) - 1e-6) continue;                     // a wall right there
      const cx = Math.cos(ang), cy = Math.sin(ang); let sc = 0;
      for (let s = 1; s <= 8; s++) {
        const px = x[i] + cx * .2 * s, py = y[i] + cy * .2 * s; if (px < 0 || py < 0 || px >= AW || py >= AH) break;
        if (s * .2 > free + .05 && free < r - 1e-6) break;                // seen to be blocked beyond here
        const c = cellOf(px, py); if (wallMem[i][c]) break;
        if (!mem[i][c]) sc += 1 / (1 + .3 * s);
      }
      const tot = sc + .7 * Math.cos(ang - th[i]) + .08 * rnd();
      if (tot > best) { best = tot; bestA = ang; gain = sc; }
    }
    if (gain < .05) {                                                   // nothing new nearby: head for the nearest floor it has not searched
      const M = mem[i], Wm = wallMem[i];                                //   (its own memory; it gives up on a spot it cannot reach)
      if (ftgt[i] >= 0 && (M[ftgt[i]] || T - ftT[i] > 5)) { if (!M[ftgt[i]]) Wm[ftgt[i]] = 1; ftgt[i] = -1; }
      if (ftgt[i] < 0) {
        let bd = 1e9; for (let c = 0; c < NC; c++) { if (M[c] || Wm[c]) continue; const dx = (c % GW + .5) * CELL - x[i], dy = ((c / GW | 0) + .5) * CELL - y[i], d = dx * dx + dy * dy; if (d < bd) { bd = d; ftgt[i] = c; } }
        ftT[i] = T;
      }
      bestA = ftgt[i] >= 0 ? Math.atan2(((ftgt[i] / GW | 0) + .5) * CELL - y[i], (ftgt[i] % GW + .5) * CELL - x[i]) : th[i] + (rnd() - .5) * 1.6;
    } else ftgt[i] = -1;
    let vx = Math.cos(bestA), vy = Math.sin(bestA);
    for (let n = 0; n < nbN[i]; n++) {                                  // spread away from the neighbours it sees
      const j = nbs[i * NB_MAX + n], ox = j < 0 ? L1.x : x[j], oy = j < 0 ? L1.y : y[j], dx = x[i] - ox, dy = y[i] - oy, d = Math.hypot(dx, dy) || 1e-3;
      const wgt = (j < 0 ? 2.4 : 1.6) * (1 - d / (r + .05)); vx += dx / d * wgt; vy += dy / d * wgt;
    }
    const wr = Math.min(r, .3);
    for (let k = 0; k < NR; k++) {                                      // keep off the walls it sees (close in: it still has to search along them)
      const d = rays[base + k]; if (d >= wr) continue; const a = k / NR * TAU, q = 1 - d / wr, wgt = 2 * q * q; vx -= Math.cos(a) * wgt; vy -= Math.sin(a) * wgt;
    }
    want[i] = Math.atan2(vy, vx);
  }
  // cheating: a central planner with the global map, everyone's position and the whole search record
  const ORDER = [];                                                     // per strip: lane up, lane down, then clean-up
  for (let s = 0; s < ND; s++) {
    const o = [], col = (k) => 4 * s + k;
    for (let yy = GH - 1; yy >= 0; yy--) o.push(yy * GW + col(1));
    for (let yy = 0; yy < GH; yy++) o.push(yy * GW + col(3));
    for (let yy = GH - 1; yy >= 0; yy--) o.push(yy * GW + col(0));
    for (let yy = 0; yy < GH; yy++) o.push(yy * GW + col(2));
    ORDER.push(o.filter((c) => countable[c]));
  }
  const claimed = new Uint8Array(NC);
  function decideCheat(i) {
    commands++;                                                         // this decision was made from outside information
    claimed.fill(0); for (let j = 0; j < ND; j++) if (j !== i && tgt[j] >= 0) claimed[tgt[j]] = 1;
    let goal = -1;
    for (const c of ORDER[strip[i]]) if (!searched[c]) { goal = c; break; }
    const from = cellOf(x[i], y[i]);
    let n;
    if (goal >= 0) n = bfs(from, (c) => c === goal || (goal >= 0 && !plannable[goal] && Math.abs(c % GW - goal % GW) <= 1 && Math.abs((c / GW | 0) - (goal / GW | 0)) <= 1));
    else n = bfs(from, (c) => countable[c] && !searched[c] && !claimed[c]);   // own lane done: help where nobody is
    if (n < 2) { tgt[i] = -1; want[i] = th[i]; return; }
    tgt[i] = pth[n - 1];
    const k = Math.min(n - 1, 2), c = pth[k];
    want[i] = Math.atan2(((c / GW | 0) + .5) * CELL - y[i], (c % GW + .5) * CELL - x[i]);
  }
  function mark(i) {
    const c0x = Math.floor(x[i] / CELL), c0y = Math.floor(y[i] / CELL);
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const gx = c0x + ox, gy = c0y + oy; if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
      const c = gy * GW + gx; if (!countable[c]) continue;
      if (Math.hypot((gx + .5) * CELL - x[i], (gy + .5) * CELL - y[i]) > FOOT) continue;
      mem[i][c] = 1; if (!searched[c]) { searched[c] = 1; searchedN++; }
    }
  }
  const okAt = (px, py) => px > RAD && py > RAD && px < AW - RAD && py < AH - RAD && !inBox(px, py, RAD);
  function step(dt) {
    if (state === 'hold') { holdT += dt; if (holdT > 3.2) restart(); return; }
    T += dt; placeL1(dt);
    L1.scan += dt * 4.5;
    for (let k = 0; k < 2; k++) { const a = L1.scan + k * Math.PI, d = ray(L1.x, L1.y, Math.cos(a), Math.sin(a), 2.6); if (d < 2.6) { scanX[scanK] = L1.x + Math.cos(a) * d; scanY[scanK] = L1.y + Math.sin(a) * d; scanT[scanK] = T; scanK = (scanK + 1) % SCANN; } }
    for (let i = 0; i < ND; i++) {
      emulate(i);                                                        // what it is allowed to know, every step
      dec[i] -= dt; if (dec[i] <= 0) { dec[i] += .1; if (cheat) decideCheat(i); else decideHonest(i); }
      const d = Math.atan2(Math.sin(want[i] - th[i]), Math.cos(want[i] - th[i]));
      th[i] += clamp(d, -TURN * dt * (cheat ? 2 : 1), TURN * dt * (cheat ? 2 : 1));
      const sp = cheat ? (tgt[i] >= 0 ? V : 0) : V * (Math.abs(d) > 1.6 ? .35 : 1);
      const nx = x[i] + Math.cos(th[i]) * sp * dt, ny = y[i] + Math.sin(th[i]) * sp * dt;
      if (okAt(nx, ny)) { x[i] = nx; y[i] = ny; }
      else if (okAt(nx, y[i])) x[i] = nx;
      else if (okAt(x[i], ny)) y[i] = ny;
      else if (!cheat) { th[i] += Math.PI * (.6 + .8 * rnd()); want[i] = th[i]; }
      mark(i);
    }
    // hard floor on spacing (physical: drones do not pass through each other)
    for (let i = 0; i < ND; i++) for (let j = i + 1; j < ND; j++) {
      const dx = x[j] - x[i], dy = y[j] - y[i], d = Math.hypot(dx, dy); if (d >= .16 || d < 1e-6) continue;
      const push = (.16 - d) / 2, ux = dx / d, uy = dy / d;
      if (okAt(x[i] - ux * push, y[i] - uy * push)) { x[i] -= ux * push; y[i] -= uy * push; }
      if (okAt(x[j] + ux * push, y[j] + uy * push)) { x[j] += ux * push; y[j] += uy * push; }
    }
    const f = searchedN / freeN;
    if (f >= .99 || T >= 90) { history.unshift({ cheat, f, t: T, done: f >= .99 }); if (history.length > 3) history.pop(); state = 'hold'; holdT = 0; }
  }

  // ---------------------------------------------------------------- controls and readouts
  kit.toggle(controls, { label: 'Rule', options: [{ v: 0, label: 'Honest' }, { v: 1, label: 'Cheating' }], value: 0, onChange: (v) => { cheat = v; restart(); } });
  kit.slider(controls, { label: 'Sensing radius', min: .3, max: 2, step: .1, value: rSense, fmt: (v) => v.toFixed(1) + ' m', onInput: (v) => { rSense = v; } });
  kit.button(controls, { label: 'Restart', onClick: () => restart() });
  kit.hint(controls, 'Hover or tap a drone to see exactly what the emulator lets it know.');
  const rSees = kit.readout(readouts, { label: 'What one drone sees', tone: 'ink' });
  const rCmd = kit.readout(readouts, { label: 'Commands from outside', tone: 'heat' });
  const rRoom = kit.readout(readouts, { label: 'Room searched', tone: 'teal' });

  // ---------------------------------------------------------------- pointer: hover or tap picks the drone whose view is shown
  let focus = 3, hover = -1;
  const toWorld = (px, py) => [(px - G.ax) / G.sc, (py - G.ay) / G.sc];
  function pick(px, py) {
    const [wx, wy] = toWorld(px, py); let best = -1, bd = (G.phone ? 26 : 22) / G.sc;
    for (let i = 0; i < ND; i++) { const d = Math.hypot(x[i] - wx, y[i] - wy); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  const onMove = (e) => { if (e.pointerType === 'mouse') hover = pick(e.offsetX, e.offsetY); };
  const onDown = (e) => { const i = pick(e.offsetX, e.offsetY); if (i >= 0) { focus = i; hover = -1; } };
  const onLeave = () => { hover = -1; };
  cv.cv.addEventListener('pointermove', onMove); cv.cv.addEventListener('pointerdown', onDown); cv.cv.addEventListener('pointerleave', onLeave);

  // ---------------------------------------------------------------- layout
  let G = null;
  function layout() {
    const w = cv.w, h = cv.h, phone = w < 640;
    if (!phone) {
      const m = 22, colW = clamp(w * .25, 186, 236), stripH = 84, ay = 44;
      const sc = Math.min((w - 2 * m - colW - 24) / AW, (h - ay - 24 - stripH - 14) / AH), aw = AW * sc, ah = AH * sc, ax = m;
      G = { phone, sc, ax, ay, aw, ah, col: { x: ax + aw + 26, y: ay, w: w - m - (ax + aw + 26), h: ah }, strip: { x: m, y: ay + ah + 24, w: w - 2 * m, h: stripH } };
    } else {
      const m = 18, sc = (w - 2 * m) / AW, aw = AW * sc, ah = AH * sc, ax = m, ay = 30;
      G = { phone, sc, ax, ay, aw, ah, col: null, strip: { x: m, y: ay + ah + 18, w: w - 2 * m, h: 92 }, foot: ay + ah + 18 + 104 };
    }
  }
  cv.onResize(layout); layout();

  // ---------------------------------------------------------------- the floor image (searched cells), one pixel per cell
  const floorC = document.createElement('canvas'); floorC.width = GW; floorC.height = GH;
  const floorX = floorC.getContext('2d'), floorImg = floorX.createImageData(GW, GH), floorPx = new Uint32Array(floorImg.data.buffer);
  const pack = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const P_FLOOR = pack(36, 39, 76), P_SEEN = pack(49, 94, 110), P_BLOCK = pack(36, 39, 76);
  function paintFloor() {
    for (let c = 0; c < NC; c++) floorPx[c] = blocked[c] ? P_BLOCK : searched[c] ? P_SEEN : P_FLOOR;
    floorX.putImageData(floorImg, 0, 0);
  }

  // ---------------------------------------------------------------- drawing
  const SX = (wx) => G.ax + wx * G.sc, SY = (wy) => G.ay + wy * G.sc;
  function tag(str, px, py, col, size = 10.5, align = 'left') {
    ctx.font = `400 ${size}px ${F.sans}`; const tw = ctx.measureText(str).width;
    let x0 = align === 'center' ? px - tw / 2 : align === 'right' ? px - tw : px;
    x0 = clamp(x0, 20, cv.w - 20 - tw);
    ctx.fillStyle = 'rgba(27,30,61,.86)'; roundRect(ctx, x0 - 5, py - 8.5, tw + 10, 17, 6); ctx.fill();
    text(ctx, str, x0, py + .5, { size, color: col, base: 'middle' });
  }
  const VR = 120, vpx = new Float32Array(VR), vpy = new Float32Array(VR), vph = new Int16Array(VR);
  function drawArena(fi) {
    const { ax, ay, aw, ah, sc, phone } = G;
    paintFloor();
    ctx.save(); roundRect(ctx, ax, ay, aw, ah, 6); ctx.clip();
    ctx.imageSmoothingEnabled = false; ctx.drawImage(floorC, ax, ay, aw, ah); ctx.imageSmoothingEnabled = true;
    // a faint metre grid
    ctx.strokeStyle = 'rgba(220,214,236,.06)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let m = 1; m < AW; m++) { ctx.moveTo(SX(m) + .5, ay); ctx.lineTo(SX(m) + .5, ay + ah); }
    for (let m = 1; m < AH; m++) { ctx.moveTo(ax, SY(m) + .5); ctx.lineTo(ax + aw, SY(m) + .5); }
    ctx.stroke();
    // camera view cones from the four ceiling corners
    const CAMS = [[0, 0], [AW, 0], [0, AH], [AW, AH]];
    for (const [cx, cy] of CAMS) {
      const a0 = Math.atan2(AH / 2 - cy, AW / 2 - cx), R = Math.hypot(AW, AH) * .78 * sc;
      ctx.fillStyle = 'rgba(143,140,196,.06)'; ctx.beginPath(); ctx.moveTo(SX(cx), SY(cy)); ctx.arc(SX(cx), SY(cy), R, a0 - .62, a0 + .62); ctx.closePath(); ctx.fill();
    }
    // pads
    ctx.strokeStyle = 'rgba(220,214,236,.12)'; ctx.setLineDash([2, 3]); ctx.beginPath();
    for (let i = 0; i < ND; i++) { ctx.moveTo(SX(padX(i)) + .16 * sc, SY(PADY)); ctx.arc(SX(padX(i)), SY(PADY), .16 * sc, 0, TAU); }
    ctx.stroke(); ctx.setLineDash([]);
    // the focus drone's view: what the emulator hands it
    const fx = SX(x[fi]), fy = SY(y[fi]);
    if (!cheat) {
      for (let k = 0; k < VR; k++) { const a = k / VR * TAU, d = ray(x[fi], y[fi], Math.cos(a), Math.sin(a), rSense); vpx[k] = SX(x[fi] + Math.cos(a) * d); vpy[k] = SY(y[fi] + Math.sin(a) * d); vph[k] = hitId; }
      ctx.beginPath(); for (let k = 0; k < VR; k++) k ? ctx.lineTo(vpx[k], vpy[k]) : ctx.moveTo(vpx[k], vpy[k]); ctx.closePath();
      ctx.fillStyle = 'rgba(127,212,207,.13)'; ctx.fill(); ctx.strokeStyle = 'rgba(127,212,207,.5)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.strokeStyle = '#B9A6F2'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.beginPath();     // the walls it can see
      for (let k = 0; k < VR; k++) { const k2 = (k + 1) % VR; if (vph[k] >= 0 && vph[k2] === vph[k]) { ctx.moveTo(vpx[k], vpy[k]); ctx.lineTo(vpx[k2], vpy[k2]); } }
      ctx.stroke();
    }
    ctx.restore();
    // boxes (structure), with a lighter top edge so they read as objects
    for (let b = 0; b < NB; b++) {
      const x0 = SX(BX[b * 4]), y0 = SY(BX[b * 4 + 1]), bw = (BX[b * 4 + 2] - BX[b * 4]) * sc, bh = (BX[b * 4 + 3] - BX[b * 4 + 1]) * sc;
      ctx.fillStyle = 'rgba(10,12,32,.35)'; ctx.fillRect(x0 + 2, y0 + 3, bw, bh);
      ctx.fillStyle = '#6E6BA6'; ctx.fillRect(x0, y0, bw, bh);
      ctx.fillStyle = '#8F8CC4'; ctx.fillRect(x0, y0, bw, Math.min(3, bh * .3));
    }
    ctx.strokeStyle = cheat ? 'rgba(240,138,126,.65)' : C.line; ctx.lineWidth = cheat ? 1.6 : 1; roundRect(ctx, ax - .5, ay - .5, aw + 1, ah + 1, 6); ctx.stroke();
    // cameras: a small body in each corner, rays to the drone being looked at (its position comes from them)
    for (const [cx, cy] of CAMS) {
      const px = SX(cx), py = SY(cy);
      ctx.strokeStyle = 'rgba(143,140,196,.32)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(fx, fy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#2c2f5c'; ctx.strokeStyle = '#B4B1E0'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(px, py, phone ? 4.5 : 6, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#B4B1E0'; ctx.beginPath(); ctx.arc(px, py, phone ? 1.6 : 2.2, 0, TAU); ctx.fill();
    }
    // the Layer 1 drone's LiDAR returns
    ctx.fillStyle = C.heat;
    for (let k = 0; k < SCANN; k++) { const age = T - scanT[k]; if (age < 0 || age > .45) continue; ctx.globalAlpha = .8 * (1 - age / .45); ctx.beginPath(); ctx.arc(SX(scanX[k]), SY(scanY[k]), 1.5, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    // links: honest = the neighbours it is allowed to see; cheating = everyone, anywhere
    if (!cheat) {
      ctx.strokeStyle = 'rgba(127,212,207,.75)'; ctx.lineWidth = 1.3; ctx.beginPath();
      for (let n = 0; n < nbN[fi]; n++) { const j = nbs[fi * NB_MAX + n], ox = j < 0 ? L1.x : x[j], oy = j < 0 ? L1.y : y[j]; ctx.moveTo(fx, fy); ctx.lineTo(SX(ox), SY(oy)); }
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(240,138,126,.32)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let j = -1; j < ND; j++) { if (j === fi) continue; ctx.moveTo(fx, fy); ctx.lineTo(SX(j < 0 ? L1.x : x[j]), SY(j < 0 ? L1.y : y[j])); }
      ctx.stroke();
    }
    // Layer 1 drone (bigger, heat), with its scan beam
    {
      const px = SX(L1.x), py = SY(L1.y), a = (phone ? 7 : 10);
      ctx.strokeStyle = 'rgba(255,195,107,.3)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 0; k < 2; k++) { const sa = L1.scan + k * Math.PI, d = ray(L1.x, L1.y, Math.cos(sa), Math.sin(sa), 2.6); ctx.moveTo(px, py); ctx.lineTo(SX(L1.x + Math.cos(sa) * d), SY(L1.y + Math.sin(sa) * d)); }
      ctx.stroke();
      ctx.save(); ctx.translate(px, py); ctx.rotate(L1.th + Math.PI / 4);
      ctx.strokeStyle = C.heat; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-a, -a); ctx.lineTo(a, a); ctx.moveTo(a, -a); ctx.lineTo(-a, a); ctx.stroke();
      ctx.lineWidth = 1.4; ctx.beginPath(); for (const [ux, uy] of [[-1, -1], [1, 1], [1, -1], [-1, 1]]) { ctx.moveTo(ux * a + a * .42, uy * a); ctx.arc(ux * a, uy * a, a * .42, 0, TAU); } ctx.stroke();
      ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(0, 0, a * .32, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // micro-drones: small teal X frames, batched
    const a = phone ? 3.4 : 4.6, p = new Path2D(), ro = new Path2D();
    for (let i = 0; i < ND; i++) {
      const px = SX(x[i]), py = SY(y[i]), c = Math.cos(th[i] + Math.PI / 4) * a, s = Math.sin(th[i] + Math.PI / 4) * a;
      p.moveTo(px - c, py - s); p.lineTo(px + c, py + s); p.moveTo(px + s, py - c); p.lineTo(px - s, py + c);
      for (const [ux, uy] of [[c, s], [-c, -s], [s, -c], [-s, c]]) { ro.moveTo(px + ux + a * .38, py + uy); ro.arc(px + ux, py + uy, a * .38, 0, TAU); }
    }
    ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(27,30,61,.9)'; ctx.lineWidth = 4; ctx.stroke(p);
    ctx.strokeStyle = C.teal; ctx.lineWidth = 1.8; ctx.stroke(p); ctx.lineWidth = 1.1; ctx.stroke(ro);
    // the focus drone: apricot ring and name
    ctx.strokeStyle = C.apricot; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(fx, fy, a * 2.3, 0, TAU); ctx.stroke();
    return { fx, fy };
  }
  function drawArenaLabels(fi, fx, fy) {
    const { ax, ay, aw, ah, phone, sc } = G;
    const hs = phone ? 11 : 12; ctx.font = `400 ${hs}px ${F.sans}`;
    let head = 'The test arena from above (8 × 5 m), a mock collapsed room';
    if (phone || ctx.measureText(head).width > aw - 50) head = 'The test arena from above, 8 × 5 m';
    text(ctx, head, ax, ay - 12, { size: hs, color: C.muted });
    const mm = Math.floor(T / 60), ss = Math.floor(T % 60);
    text(ctx, `${mm}:${String(ss).padStart(2, '0')}`, ax + aw, ay - 12, { size: phone ? 10.5 : 11, color: C.faint, font: F.mono, align: 'right' });
    if (!phone) {
      tag('ceiling camera', SX(AW) - 14, SY(0) + 16, '#B4B1E0', 10.5, 'right');
      tag('Layer 1 drone: maps the walls', SX(L1.x) + 16, SY(L1.y) + (L1.y > AH - .7 ? -16 : 18), C.heat, 10.5);
    }
    tag(`drone ${fi + 1}`, fx + 12, fy - 12 < ay + 10 ? fy + 16 : fy - 12, C.apricot, phone ? 10 : 10.5);
    if (cheat) tag(phone ? 'too perfect: lanes in lockstep' : 'too perfect: one lane each, in lockstep, no overlaps', ax + aw / 2, ay + ah - 16, C.danger, phone ? 10 : 11, 'center');
    // a metre scale
    if (!phone) { const y0 = ay + ah + 13, x0 = ax + aw - sc; ctx.strokeStyle = C.faint; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y0 - 3); ctx.lineTo(x0, y0); ctx.lineTo(x0 + sc, y0); ctx.lineTo(x0 + sc, y0 - 3); ctx.stroke(); text(ctx, '1 m', x0 - 6, y0 + 1, { size: 10.5, color: C.faint, font: F.mono, align: 'right', base: 'middle' }); }
    if (state === 'hold' && history[0]) {
      const e = history[0], s = e.done ? `searched in ${Math.round(e.t)} s` : `${Math.floor(e.f * 100)}% in ${Math.round(e.t)} s`;
      ctx.font = `500 ${phone ? 12 : 13}px ${F.sans}`; const tw = ctx.measureText(s).width + 26, bh = phone ? 24 : 28;
      ctx.fillStyle = 'rgba(27,30,61,.9)'; roundRect(ctx, ax + aw / 2 - tw / 2, ay + ah / 2 - bh / 2, tw, bh, bh / 2); ctx.fill();
      text(ctx, s, ax + aw / 2, ay + ah / 2 + 1, { size: phone ? 12 : 13, color: e.cheat ? C.danger : C.teal, weight: 500, align: 'center', base: 'middle' });
    }
  }
  function arrow(x0, y0, x1, y1, col, width, dash, head = true) {
    ctx.strokeStyle = col; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
    if (head) { const a = Math.atan2(y1 - y0, x1 - x0), L = 6; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - L * Math.cos(a - .45), y1 - L * Math.sin(a - .45)); ctx.lineTo(x1 - L * Math.cos(a + .45), y1 - L * Math.sin(a + .45)); ctx.closePath(); ctx.fill(); }
  }
  function box(bx, by, bw, bh, title, sub, col, subCol, phone) {
    ctx.fillStyle = C.panel; roundRect(ctx, bx, by, bw, bh, 9); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
    text(ctx, title, bx + bw / 2, by + (phone ? 14 : 18), { size: phone ? 10.5 : 12.5, color: C.ink, weight: 500, align: 'center' });
    if (sub) text(ctx, sub, bx + bw / 2, by + (phone ? 28 : 34), { size: phone ? 9.5 : 10.5, color: subCol || C.faint, align: 'center' });
  }
  function drawStrip(fi) {
    const S = G.strip, ph = G.phone, bh = ph ? 36 : 44, y0 = S.y;
    const n = nbN[fi], seesTxt = `${n} neighbour${n === 1 ? '' : 's'}, ${wallN[fi]} wall${wallN[fi] === 1 ? '' : 's'}`;
    let b1, b2, b3;
    if (!ph) {
      const w1 = Math.min(170, S.w * .2), w2 = Math.min(200, S.w * .24), w3 = Math.min(178, S.w * .21), gapT = S.w - w1 - w2 - w3, g1 = gapT * .45, g2 = gapT - g1;
      b1 = [S.x, w1]; b2 = [S.x + w1 + g1, w2]; b3 = [S.x + w1 + g1 + w2 + g2, w3];
    } else {
      const w1 = 86, w3 = 86, w2 = S.w - w1 - w3 - 2 * 26;
      b1 = [S.x, w1]; b2 = [S.x + w1 + 26, w2]; b3 = [S.x + S.w - w3, w3];
    }
    const t = performance.now() / 1000;
    // arrows: cameras -> emulator (positions), emulator -> drone (only what it could sense)
    const ay = y0 + bh / 2, live = 'rgba(127,212,207,.85)';
    arrow(b1[0] + b1[1] + 4, ay, b2[0] - 5, ay, live, 1.4);
    arrow(b2[0] + b2[1] + 4, ay, b3[0] - 5, ay, cheat ? 'rgba(127,212,207,.25)' : live, 1.4, cheat ? [3, 4] : null);
    // data flowing along them
    ctx.fillStyle = C.teal;
    for (let k = 0; k < 3; k++) {
      const f = (t * .8 + k / 3) % 1;
      ctx.beginPath(); ctx.arc(b1[0] + b1[1] + 6 + (b2[0] - b1[0] - b1[1] - 14) * f, ay, 2, 0, TAU); ctx.fill();
      if (!cheat) { ctx.beginPath(); ctx.arc(b2[0] + b2[1] + 6 + (b3[0] - b2[0] - b2[1] - 14) * f, ay, 2, 0, TAU); ctx.fill(); }
    }
    if (!ph) {
      const g1 = b2[0] - b1[0] - b1[1] - 10, g2 = b3[0] - b2[0] - b2[1] - 10;
      const fitT = (opts, maxW, size) => { ctx.font = `400 ${size}px ${F.sans}`; for (const o of opts) if (ctx.measureText(o).width <= maxW) return o; return ''; };
      text(ctx, 'positions', (b1[0] + b1[1] + b2[0]) / 2, ay - 8, { size: 11, color: C.teal, align: 'center' });
      text(ctx, fitT(['localisation: legitimate', 'legitimate'], g1, 10), (b1[0] + b1[1] + b2[0]) / 2, ay + 15, { size: 10, color: C.faint, align: 'center' });
      text(ctx, cheat ? 'bypassed' : fitT([seesTxt, `${n} nbrs, ${wallN[fi]} walls`], g2, 11), (b2[0] + b2[1] + b3[0]) / 2, ay - 8, { size: 11, color: cheat ? C.faint : C.teal, align: 'center' });
      if (!cheat) text(ctx, fitT(['only what it could sense', 'nothing more'], g2, 10), (b2[0] + b2[1] + b3[0]) / 2, ay + 15, { size: 10, color: C.faint, align: 'center' });
    }
    box(b1[0], y0, b1[1], bh, ph ? '4 cameras' : '4 ceiling cameras', ph ? 'positions' : 'where each drone is', '#8F8CC4', ph ? C.teal : null, ph);
    box(b2[0], y0, b2[1], bh, ph ? 'sensing emulator' : 'local sensing emulator', ph ? (cheat ? 'bypassed' : seesTxt) : `radius ${rSense.toFixed(1)} m + line of sight`, '#8F8CC4', ph && !cheat ? C.teal : null, ph);
    box(b3[0], y0, b3[1], bh, ph ? `drone ${fi + 1}` : `drone ${fi + 1}: its own rules`, cheat ? (ph ? 'obeys outside' : 'obeys the outside') : (ph ? 'own rules' : 'decides alone, then flies'), cheat ? C.danger : C.teal, cheat ? C.danger : null, ph);
    // the forbidden path: outside -> decision, under the strip
    const fy = y0 + bh + (ph ? 14 : 18), xa = b1[0] + b1[1] * .5, xb = b3[0] + b3[1] * .5;
    ctx.save();
    if (cheat) { ctx.shadowColor = 'rgba(240,138,126,.85)'; ctx.shadowBlur = 8 + 4 * Math.sin(t * 5); }
    const col = cheat ? C.danger : 'rgba(243,238,242,.25)';
    ctx.strokeStyle = col; ctx.lineWidth = cheat ? 2 : 1.2; ctx.setLineDash(cheat ? [] : [4, 5]); ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(xa, y0 + bh + 2); ctx.lineTo(xa, fy - 6); ctx.quadraticCurveTo(xa, fy, xa + 6, fy); ctx.lineTo(xb - 6, fy); ctx.quadraticCurveTo(xb, fy, xb, fy - 6); ctx.lineTo(xb, y0 + bh + 9); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(xb, y0 + bh + 2); ctx.lineTo(xb - 4.5, y0 + bh + 9); ctx.lineTo(xb + 4.5, y0 + bh + 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (cheat) { ctx.fillStyle = C.danger; for (let k = 0; k < 4; k++) { const f = (t * .9 + k / 4) % 1; ctx.beginPath(); ctx.arc(xa + 6 + (xb - xa - 12) * f, fy, 2.2, 0, TAU); ctx.fill(); } }
    const mx = (xa + xb) / 2;
    if (cheat) tag('decisions from outside: not allowed', mx, fy + (ph ? 12 : 14), C.danger, ph ? 10.5 : 12, 'center');
    else {
      ctx.strokeStyle = 'rgba(243,238,242,.45)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(mx - 4, fy - 4); ctx.lineTo(mx + 4, fy + 4); ctx.moveTo(mx + 4, fy - 4); ctx.lineTo(mx - 4, fy + 4); ctx.stroke();
      text(ctx, 'outside → decision: blocked', mx, fy + (ph ? 14 : 16), { size: ph ? 10 : 10.5, color: C.faint, align: 'center' });
    }
  }
  function drawColumn(fi) {
    const K = G.col; if (!K) return;
    let yy = K.y + 12;
    text(ctx, `What drone ${fi + 1} is told`, K.x, yy, { size: 13, color: C.ink, weight: 500 }); yy += 24;
    const n = nbN[fi], items = cheat
      ? [['its position, from the cameras', C.teal, C.muted], [`all ${ND} other drones, anywhere`, C.danger, C.rose], ['the whole map', C.danger, C.rose], ['where everyone has searched', C.danger, C.rose]]
      : [['its position, from the cameras', C.teal, C.muted], [`${n} neighbour${n === 1 ? '' : 's'} within ${rSense.toFixed(1)} m`, C.teal, C.ink], [`${wallN[fi]} wall${wallN[fi] === 1 ? '' : 's'} in line of sight`, '#B9A6F2', C.ink], ['nothing else', null, C.faint]];
    for (const [s, dot, col] of items) {
      if (dot) { ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(K.x + 4, yy - 4, 3, 0, TAU); ctx.fill(); }
      text(ctx, s, K.x + 14, yy, { size: 12, color: col }); yy += 19;
    }
    yy += 10;
    const para = cheat ? 'A planner outside flies them: one lane each, in lockstep. It looks perfect, and a reviewer spots the puppet show in seconds.'
      : 'Each drone runs the rules itself: spread from the neighbours it sees, keep off the walls it sees, go where it has not been.';
    const lines = wrapCached(para, K.w, 11.5);
    for (const l of lines) { text(ctx, l, K.x, yy, { size: 11.5, color: cheat ? C.rose : C.muted }); yy += 16; }
    // the rule, and the last runs, at the bottom of the column
    const q = wrapCached('“Localisation from outside is legitimate. Decisions from outside are not.”', K.w, 14, F.serif);
    let by = K.y + K.h - 4 - (history.length ? history.length * 16 + 22 : 0) - q.length * 18;
    if (by < yy + 8) by = yy + 8;
    for (const l of q) { text(ctx, l, K.x, by, { size: 14, color: C.ink, font: F.serif }); by += 18; }
    if (history.length) {
      by += 8; text(ctx, 'last runs', K.x, by, { size: 10.5, color: C.faint }); by += 16;
      for (const e of history) { text(ctx, `${e.cheat ? 'cheating' : 'honest'}  ${Math.floor(e.f * 100)}% in ${Math.round(e.t)} s`, K.x, by, { size: 11, color: e.cheat ? C.rose : C.teal, font: F.mono }); by += 16; }
    }
  }
  const wcache = new Map();
  function wrapCached(str, maxW, size, font = F.sans) {
    const key = str + '|' + maxW + '|' + size; let v = wcache.get(key); if (v) return v;
    ctx.font = `400 ${size}px ${font}`; v = []; let cur = '';
    for (const w of str.split(' ')) { const t = cur ? cur + ' ' + w : w; if (cur && ctx.measureText(t).width > maxW) { v.push(cur); cur = w; } else cur = t; }
    if (cur) v.push(cur); if (wcache.size > 40) wcache.clear(); wcache.set(key, v); return v;
  }
  function drawFoot(fi) {
    if (!G.phone) return;
    const y0 = G.foot, w = cv.w;
    const s = cheat ? 'Decisions from outside: a puppet show.' : 'Localisation from outside is legitimate; decisions are not.';
    text(ctx, s, w / 2, y0 + 14, { size: 11, color: cheat ? C.rose : C.muted, align: 'center' });
    if (history.length) { const e = history[0]; text(ctx, `last run: ${e.cheat ? 'cheating' : 'honest'} ${Math.floor(e.f * 100)}% in ${Math.round(e.t)} s`, w / 2, y0 + 32, { size: 10.5, color: C.faint, align: 'center', font: F.mono }); }
  }
  function draw() {
    cv.clear();
    const fi = hover >= 0 ? hover : focus;
    const { fx, fy } = drawArena(fi);
    drawArenaLabels(fi, fx, fy);
    drawStrip(fi);
    drawColumn(fi);
    drawFoot(fi);
    return fi;
  }

  // ---------------------------------------------------------------- loop
  restart();
  const loop = kit.loop((dt) => {
    step(dt / 2); step(dt / 2);
    const fi = draw();
    const n = nbN[fi];
    rSees.set(cheat ? `all ${ND} + map` : `${n} neighbour${n === 1 ? '' : 's'}`);
    rCmd.set(commands.toLocaleString('en-US'));
    rRoom.set(Math.min(100, Math.floor(searchedN / freeN * 100)) + '%');
  });
  draw();
  return {
    start: loop.start, stop: loop.stop,
    destroy() { loop.stop(); cv.cv.removeEventListener('pointermove', onMove); cv.cv.removeEventListener('pointerdown', onDown); cv.cv.removeEventListener('pointerleave', onLeave); cv.destroy(); },
  };
}

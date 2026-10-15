// One complete cycle: the eight stages from the briefing (Sense, Convert, Localise, Map, Recognise, Decide, Command,
// Fly) as a loop. In the centre a small top-down map of a building nobody has seen grows each lap, and the drone flies to
// the frontier it chose. The decision in Decide depends on cells that only appeared in Map, in the same lap.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const A = { teal: '127,212,207', heat: '255,195,107', apricot: '246,210,177', haze: '143,140,196', dusk: '74,75,134', danger: '240,138,126' };
  const rgba = (k, a) => `rgba(${A[k]},${a})`;

  const ST = [
    { n: 'Sense', d: 'LiDAR tilts through a full sweep · camera captures frames · IMU reports motion continuously', u: 'RPLidar A1M8 on its tilt servo · AR0234 camera · IMU' },
    { n: 'Convert', d: 'Range + scan angle + tilt angle → 3-D points.', u: 'Raspberry Pi 5' },
    { n: 'Localise', d: 'SLAM compares what it sees to the map → “I am here”.', u: 'SLAM on the Pi' },
    { n: 'Map', d: 'Place the 3-D points using that position → update OctoMap.', u: 'OctoMap on the Pi' },
    { n: 'Recognise', d: 'YOLO on the Hailo finds objects · PointPainting gives them 3-D positions.', u: 'Hailo-8 accelerator (26 TOPS)' },
    { n: 'Decide', d: 'Find frontiers, score them, pick the best.', u: 'frontier picker on the Pi' },
    { n: 'Command', d: 'Navigation plans a safe path → setpoint → MAVROS2 → flight controller.', u: 'Nav2 → MAVROS2 → MAVLink' },
    { n: 'Fly', d: 'EKF3 estimates state · cascaded PID drives the motors · drone arrives.', u: 'CUAV V6X flight controller' },
  ];
  const DUR = [1.5, 0.9, 1.0, 1.1, 1.0, 1.3, 1.0, 1];

  // ------------------------------------------------------------------ the hidden building (1 cell = 0.5 m)
  const GW = 26, GH = 26, CELL_M = 0.5, RANGE = 6;
  const truth = new Uint8Array(GW * GH), m = new Uint8Array(GW * GH), fresh = new Uint8Array(GW * GH);
  const id = (x, y) => y * GW + x;
  (function build() {
    const wall = (x, y) => { truth[id(x, y)] = 1; };
    for (let i = 0; i < GW; i++) { wall(i, 0); wall(i, GH - 1); wall(0, i); wall(GW - 1, i); }
    for (let y = 1; y < GH - 1; y++) { if (y !== 5 && y !== 6 && y !== 19 && y !== 20) wall(9, y); if (y !== 11 && y !== 12) wall(17, y); }
    for (let x = 1; x < 9; x++) if (x !== 4 && x !== 5) wall(x, 13);
    for (let x = 18; x < GW - 1; x++) if (x !== 21 && x !== 22) wall(x, 9);
    for (let x = 10; x < 17; x++) if (x !== 12 && x !== 13) wall(x, 17);
    [[3, 20], [4, 20], [3, 21], [4, 21], [13, 5], [14, 5], [13, 6], [21, 17], [22, 17], [21, 18]].forEach(([x, y]) => wall(x, y));
  })();
  let floorCells = 0; for (let i = 0; i < truth.length; i++) if (!truth[i]) floorCells++;
  const PEOPLE = [[6, 3], [22, 22]];
  const found = [false, false]; let foundNow = -1;
  const HOME = [13, 21];

  // ------------------------------------------------------------------ state
  let si = 0, p = 0, cycle = 1, playing = true, speed = 1, home = false, doneT = 0, newCells = 0, nFront = 0, pickDist = 0;
  const drone = { x: HOME[0] + .5, y: HOME[1] + .5 };
  const NR = 120, rayD = new Float32Array(NR);
  const dist = new Int16Array(GW * GH), par = new Int16Array(GW * GH), q = new Int16Array(GW * GH);
  const front = new Int16Array(GW * GH); let target = -1;
  const path = new Float32Array(2 * 80); let pathN = 0, pathLen = 0;
  const raw = new Int16Array(GW * GH);

  const isFree = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && m[id(x, y)] === 1;
  function castRays() {
    for (let k = 0; k < NR; k++) {
      const a = k / NR * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a); let r = 0;
      for (r = 0.2; r < RANGE; r += 0.2) { const cx = Math.floor(drone.x + dx * r), cy = Math.floor(drone.y + dy * r); if (truth[id(cx, cy)]) break; }
      rayD[k] = Math.min(r, RANGE);
    }
  }
  function reveal() {
    fresh.fill(0); newCells = 0;
    for (let k = 0; k < NR; k++) {
      const a = k / NR * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      for (let r = 0; r <= rayD[k] + 0.01; r += 0.2) {
        const cx = Math.floor(drone.x + dx * r), cy = Math.floor(drone.y + dy * r), i = id(cx, cy);
        const v = truth[i] ? 2 : 1;
        if (m[i] !== v) { if (!m[i]) newCells++; m[i] = v; fresh[i] = 1; }
        if (truth[i]) break;
      }
    }
  }
  function bfs(sx, sy) {
    dist.fill(-1); let h = 0, t = 0; const s = id(sx, sy); dist[s] = 0; par[s] = -1; q[t++] = s;
    while (h < t) {
      const c = q[h++], x = c % GW, y = (c / GW) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!isFree(nx, ny)) continue; const n = id(nx, ny); if (dist[n] >= 0) continue;
        dist[n] = dist[c] + 1; par[n] = c; q[t++] = n;
      }
    }
  }
  function decide() {
    nFront = 0;
    for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
      const i = id(x, y); if (m[i] !== 1) continue;
      if (!m[i - 1] || !m[i + 1] || !m[i - GW] || !m[i + GW]) front[nFront++] = i;
    }
    bfs(Math.floor(drone.x), Math.floor(drone.y));
    let best = -1, bs = -1e9;
    for (let pass = 0; pass < 2 && best < 0; pass++) for (let k = 0; k < nFront; k++) {
      const i = front[k], d = dist[i]; if (d < 0 || (pass === 0 && d < 3)) continue;
      const x = i % GW, y = (i / GW) | 0; let gain = 0;
      for (let yy = y - 3; yy <= y + 3; yy++) for (let xx = x - 3; xx <= x + 3; xx++) if (xx >= 0 && yy >= 0 && xx < GW && yy < GH && !m[id(xx, yy)]) gain++;
      const sc = gain - 1.1 * d;                       // new space it would reveal, against the distance to fly there
      if (sc > bs) { bs = sc; best = i; }
    }
    if (best < 0) { home = true; best = id(HOME[0], HOME[1]); }
    target = best; pickDist = Math.max(0, dist[best]) * CELL_M;
  }
  function seeLine(x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.2);
    for (let k = 0; k <= n; k++) {
      const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n;
      for (const ox of [-0.3, 0.3]) for (const oy of [-0.3, 0.3]) if (!isFree(Math.floor(x + ox), Math.floor(y + oy))) return false;
    }
    return true;
  }
  function plan() {
    let n = 0, c = target; while (c >= 0 && n < raw.length) { raw[n++] = c; c = par[c]; }
    pathN = 0; pathLen = 0;
    let px = drone.x, py = drone.y; path[0] = px; path[1] = py; pathN = 1;
    let i = n - 1;                                     // raw[n-1] is the drone's own cell
    while (i > 0 && pathN < 80) {
      let j = 0;
      for (j = 0; j < i; j++) { const cx = raw[j] % GW + .5, cy = ((raw[j] / GW) | 0) + .5; if (seeLine(px, py, cx, cy)) break; }
      if (j === i) j = i - 1;
      const nx = raw[j] % GW + .5, ny = ((raw[j] / GW) | 0) + .5;
      pathLen += Math.hypot(nx - px, ny - py); path[2 * pathN] = nx; path[2 * pathN + 1] = ny; pathN++; px = nx; py = ny; i = j;
    }
    DUR[7] = Math.max(0.9, pathLen / 4.5);
  }
  function posOnPath(f) {
    let d = f * pathLen;
    for (let k = 1; k < pathN; k++) {
      const ax = path[2 * k - 2], ay = path[2 * k - 1], bx = path[2 * k], by = path[2 * k + 1], s = Math.hypot(bx - ax, by - ay);
      if (d <= s || k === pathN - 1) { const u = s ? clamp(d / s, 0, 1) : 1; drone.x = ax + (bx - ax) * u; drone.y = ay + (by - ay) * u; return; }
      d -= s;
    }
  }
  let T = 0, enterT = 0;
  function enter(k) {
    si = k; p = 0; enterT = T;
    if (k === 0) castRays();
    else if (k === 3) reveal();
    else if (k === 4) { foundNow = -1; PEOPLE.forEach(([x, y], j) => { if (!found[j] && m[id(x, y)]) { found[j] = true; foundNow = j; } }); }
    else if (k === 5) decide();
    else if (k === 6) plan();
  }
  function finish(k) { if (k === 7 && pathN > 0) posOnPath(1); }
  function advance() {
    finish(si);
    if (si === 7 && home) { doneT = 2.6; return; }
    const nx = (si + 1) % 8; if (nx === 0) cycle++;
    enter(nx);
  }
  function reset() {
    m.fill(0); fresh.fill(0); found[0] = found[1] = false; home = false; cycle = 1; doneT = 0; drone.x = HOME[0] + .5; drone.y = HOME[1] + .5; pathN = 0; target = -1; enter(0);
  }
  reset();

  // ------------------------------------------------------------------ controls
  const bPlay = kit.button(controls, { label: 'Pause', onClick: () => { playing = !playing; bPlay.textContent = playing ? 'Pause' : 'Play'; } });
  kit.slider(controls, { label: 'Speed', min: 0.25, max: 3, step: 0.25, value: 1, fmt: (v) => v.toFixed(2).replace(/\.?0+$/, '') + '×', onInput: (v) => { speed = v; } });
  kit.button(controls, { label: 'Step to next stage', kind: 'primary', onClick: () => { playing = false; bPlay.textContent = 'Play'; if (doneT > 0) { reset(); return; } advance(); } });
  const rCycle = kit.readout(readouts, { label: 'cycle', tone: 'ink' });
  const rCov = kit.readout(readouts, { label: 'map coverage', tone: 'teal' });
  const rStage = kit.readout(readouts, { label: 'current stage', tone: 'heat' });

  // ------------------------------------------------------------------ layout
  let L;
  function layout() {
    const w = cv.w, h = cv.h, nar = w < 640;
    const o = { nar };
    if (!nar) {
      o.nr = 21; o.R = Math.max(120, Math.min(228, (h - 84) / 2 - o.nr, (w - 300) / 2 - o.nr - 100));
      o.cx = 24 + o.R + o.nr + 102; o.cy = h / 2 + 2;
      o.side = { x: Math.max(o.cx + o.R + o.nr + 120, w - 270), y: 210, w: 0, h: h - 230 }; o.side.w = w - 20 - o.side.x;
    } else {
      o.nr = 12; o.R = Math.max(70, Math.min(98, w / 2 - 92, (h - 120) / 2 - o.nr));
      o.cx = w / 2 - 6; o.cy = o.R + o.nr + 88;
      o.descY = o.cy + o.R + o.nr + 30;
    }
    const ri = o.R - o.nr - 8; o.ms = ri * Math.SQRT2; o.mx = o.cx - o.ms / 2; o.my = o.cy - o.ms / 2; o.cs = o.ms / GW;
    o.th = []; for (let i = 0; i < 8; i++) o.th.push(-Math.PI / 2 + i * Math.PI / 4);
    L = o;
  }
  cv.onResize(layout); layout();

  // ------------------------------------------------------------------ drawing
  const wrapCache = new Map();
  function wrap(s, maxW, font) {
    const key = s + '|' + Math.round(maxW) + '|' + font; let v = wrapCache.get(key); if (v) return v;
    if (wrapCache.size > 120) wrapCache.clear();
    ctx.font = font; const out = []; let cur = '';
    for (const wd of s.split(' ')) { const t = cur ? cur + ' ' + wd : wd; if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = wd; } else cur = t; }
    if (cur) out.push(cur); wrapCache.set(key, out); return out;
  }
  function drawMap(T) {
    const { mx, my, cs, ms, nar } = L;
    ctx.fillStyle = rgba('dusk', .5); roundRect(ctx, mx - 4, my - 4, ms + 8, ms + 8, 8); ctx.fill();
    ctx.fillStyle = rgba('teal', .17);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (m[id(x, y)] === 1) ctx.fillRect(mx + x * cs, my + y * cs, cs + .3, cs + .3);
    ctx.fillStyle = C.haze;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (m[id(x, y)] === 2) ctx.fillRect(mx + x * cs + .4, my + y * cs + .4, cs - .5, cs - .5);
    if (si === 3 || si === 4) {                        // the cells this lap added, glowing as they are written in
      const a = si === 3 ? .55 * (1 - p * .6) : .22 * (1 - p);
      ctx.fillStyle = rgba('teal', a);
      for (let i = 0; i < m.length; i++) if (fresh[i] && m[i] === 1) ctx.fillRect(mx + (i % GW) * cs, my + ((i / GW) | 0) * cs, cs + .3, cs + .3);
    }
    if (si === 5 || si === 6) {                        // frontiers: free cells touching unknown ones
      ctx.fillStyle = rgba('apricot', si === 5 ? .55 + .3 * Math.sin(T * 9) : .4);
      for (let k = 0; k < nFront; k++) { const i = front[k]; ctx.fillRect(mx + (i % GW) * cs + .5, my + ((i / GW) | 0) * cs + .5, cs - 1, cs - 1); }
    }
    PEOPLE.forEach(([x, y], j) => {
      if (!found[j]) return;
      const X = mx + (x + .5) * cs, Y = my + (y + .5) * cs, pulse = (si === 4 && foundNow === j) ? 1 + .5 * Math.sin(p * 20) : 1;
      ctx.strokeStyle = C.heat; ctx.lineWidth = 1.6; ctx.strokeRect(X - cs * 1.1 * pulse, Y - cs * 1.1 * pulse, cs * 2.2 * pulse, cs * 2.2 * pulse);
      ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(X, Y, Math.max(2, cs * .32), 0, 7); ctx.fill();
      if (!nar) text(ctx, 'person', X, Y - cs * 1.4 - 3, { size: 10.5, color: C.heat, align: 'center' });
    });
    const DX = mx + drone.x * cs, DY = my + drone.y * cs;
    if (si === 0 || si === 1) {                        // the laser fan sweeping round, then the points it produced
      const n = si === 0 ? Math.floor(p * NR) : NR;
      ctx.strokeStyle = rgba('apricot', .2); ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 0; k < n; k += 2) { const a = k / NR * Math.PI * 2; ctx.moveTo(DX, DY); ctx.lineTo(DX + Math.cos(a) * rayD[k] * cs, DY + Math.sin(a) * rayD[k] * cs); }
      ctx.stroke();
      if (si === 0) { const a = p * Math.PI * 2; ctx.strokeStyle = C.apricot; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(DX, DY); ctx.lineTo(DX + Math.cos(a) * RANGE * cs, DY + Math.sin(a) * RANGE * cs); ctx.stroke(); }
    }
    if (si >= 1 && si <= 3) {
      const n = si === 1 ? Math.floor(p * NR) : NR, al = si === 3 ? 1 - p : 1;
      ctx.fillStyle = rgba('apricot', .9 * al);
      for (let k = 0; k < n; k++) { if (rayD[k] >= RANGE) continue; const a = k / NR * Math.PI * 2; ctx.fillRect(DX + Math.cos(a) * rayD[k] * cs - 1.2, DY + Math.sin(a) * rayD[k] * cs - 1.2, 2.4, 2.4); }
    }
    if (si === 2) {
      const r = cs * (3.5 - 2.6 * Math.min(1, p * 1.4));
      ctx.strokeStyle = C.teal; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(DX, DY, r, 0, 7); ctx.stroke();
      if (!nar) text(ctx, 'I am here', DX + r + 6, DY - r - 2, { size: 11, color: C.teal });
    }
    if (target >= 0 && si >= 5) {
      const X = mx + (target % GW + .5) * cs, Y = my + (((target / GW) | 0) + .5) * cs;
      if (si > 5 || p > .45) {
        ctx.strokeStyle = C.heat; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(X, Y, cs * 1.3, 0, 7); ctx.stroke();
        if (!nar && si === 5) text(ctx, home ? 'home' : 'best frontier', X, Y + cs * 1.3 + 13, { size: 10.5, color: C.heat, align: 'center' });
      }
      if (si >= 6 && pathN > 1) {
        const f = si === 6 ? Math.min(1, p * 1.5) : 1;
        ctx.strokeStyle = rgba('teal', .9); ctx.lineWidth = 1.8; ctx.setLineDash([4, 4]); ctx.beginPath();
        let left = f * pathLen; ctx.moveTo(mx + path[0] * cs, my + path[1] * cs);
        for (let k = 1; k < pathN && left > 0; k++) {
          const ax = path[2 * k - 2], ay = path[2 * k - 1], bx = path[2 * k], by = path[2 * k + 1], s = Math.hypot(bx - ax, by - ay), u = Math.min(1, left / s);
          ctx.lineTo(mx + (ax + (bx - ax) * u) * cs, my + (ay + (by - ay) * u) * cs); left -= s;
        }
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // the drone
    const r = Math.max(3.5, cs * .55);
    ctx.strokeStyle = C.heat; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(DX - r, DY - r); ctx.lineTo(DX + r, DY + r); ctx.moveTo(DX + r, DY - r); ctx.lineTo(DX - r, DY + r); ctx.stroke();
    ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(DX, DY, Math.max(2, r * .45), 0, 7); ctx.fill();
  }
  function drawRing() {
    const { cx, cy, R, nr, th, nar } = L;
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    // the highlight travels from the previous stage to this one at the start of each stage
    const k = Math.min(1, (T - enterT) / 0.35), e = k * k * (3 - 2 * k), prev = th[si] - Math.PI / 4;
    const ah = doneT > 0 ? th[0] + Math.PI * 2 : (si === 0 ? th[0] - Math.PI / 4 * (1 - e) : prev + Math.PI / 4 * e);
    if (ah > th[0]) { ctx.strokeStyle = C.teal; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(cx, cy, R, th[0], ah); ctx.stroke(); }
    for (let i = 0; i < 8; i++) {
      const x = cx + Math.cos(th[i]) * R, y = cy + Math.sin(th[i]) * R;
      const act = i === si && doneT <= 0, done = i < si || doneT > 0;
      ctx.fillStyle = act ? '#4a3f45' : C.bg; ctx.beginPath(); ctx.arc(x, y, act ? nr + 2 : nr, 0, 7); ctx.fill();
      ctx.strokeStyle = act ? C.heat : done ? C.teal : 'rgba(220,214,236,.3)'; ctx.lineWidth = act ? 2.2 : 1.4; ctx.stroke();
      text(ctx, String(i + 1), x, y + .5, { size: nar ? 11 : 14, color: act ? C.heat : done ? C.teal : C.faint, font: F.mono, weight: 600, align: 'center', base: 'middle' });
      const c = Math.cos(th[i]), s = Math.sin(th[i]), lr = R + nr + (nar ? 6 : 10);
      const lx = cx + c * lr, ly = cy + s * lr + (Math.abs(s) > .9 ? s * (nar ? 6 : 8) : 0);
      const al = Math.abs(c) < .2 ? 'center' : c > 0 ? 'left' : 'right';
      text(ctx, ST[i].n, lx, ly, { size: nar ? 10.5 : 13.5, color: act ? C.heat : done ? C.ink : C.muted, weight: act ? 600 : 500, align: al, base: 'middle' });
    }
    const hx = cx + Math.cos(ah) * R, hy = cy + Math.sin(ah) * R;
    ctx.fillStyle = rgba('heat', .25); ctx.beginPath(); ctx.arc(hx, hy, 9, 0, 7); ctx.fill();
    ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(hx, hy, 4, 0, 7); ctx.fill();
  }
  function detail() {
    if (doneT > 0) return 'No frontiers left: the building is mapped. Home.';
    if (si === 3) return `+${newCells} cells added to the map this lap`;
    if (si === 4) return foundNow >= 0 ? 'Person detected and placed on the map' : 'Nothing new in view';
    if (si === 5) return home ? 'No frontiers left: building mapped, going home' : `${nFront} frontier cells · picked one ${pickDist.toFixed(1)} m away`;
    if (si === 6) return home ? 'Path home planned' : 'Path planned around the walls it has seen';
    if (si === 7) return home ? 'Flying home' : `Flying ${(pathLen * CELL_M).toFixed(1)} m to the frontier`;
    return '';
  }
  function draw(T) {
    const w = cv.w, h = cv.h; cv.clear();
    drawMap(T); drawRing();
    const S = ST[si], nar = L.nar;
    if (!nar) {
      const sd = L.side, x = sd.x;
      text(ctx, doneT > 0 ? 'MAP COMPLETE' : `STAGE ${si + 1} OF 8`, x, sd.y + 4, { size: 11, color: C.faint, weight: 600 });
      text(ctx, doneT > 0 ? 'Home' : S.n, x, sd.y + 38, { size: 30, color: C.heat, font: F.serif, weight: 500 });
      let y = sd.y + 68;
      const dl = wrap(doneT > 0 ? 'Every frontier visited, so the drone flew back and the run ends.' : S.d, sd.w, `400 13.5px ${F.sans}`);
      dl.forEach((ln) => { text(ctx, ln, x, y, { size: 13.5, color: C.ink }); y += 20; });
      y += 6;
      if (doneT <= 0) { const ul = wrap('runs on: ' + S.u, sd.w, `400 11.5px ${F.sans}`); ul.forEach((ln) => { text(ctx, ln, x, y, { size: 11.5, color: C.faint }); y += 16; }); }
      const dt2 = detail();
      if (dt2) { y += 10; wrap(dt2, sd.w, `500 12.5px ${F.sans}`).forEach((ln) => { text(ctx, ln, x, y, { size: 12.5, color: C.teal, weight: 500 }); y += 18; }); }
      const cap = wrap('No human made any decision in that loop. Nobody wrote a waypoint list.', sd.w, `500 13px ${F.sans}`);
      let cy = sd.y + sd.h - (cap.length - 1) * 19;
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, cy - 24); ctx.lineTo(x + sd.w, cy - 24); ctx.stroke();
      cap.forEach((ln) => { text(ctx, ln, x, cy, { size: 13, color: C.muted, weight: 500 }); cy += 19; });
    } else {
      text(ctx, 'No human made any decision in this loop.', 10, 18, { size: 11, color: C.muted, weight: 500 });
      const s = doneT > 0 ? 'Map complete: every frontier visited, the drone is home.' : `${si + 1} · ${S.n}: ${S.d}`;
      const ls = wrap(s, w - 20, `400 11.5px ${F.sans}`);
      let y = Math.min(L.descY, h - 8 - (ls.length - 1) * 15);
      ls.forEach((ln, i) => { text(ctx, ln, 10, y, { size: 11.5, color: i === 0 ? C.ink : C.muted }); y += 15; });
    }
  }

  const loop = kit.loop((dt) => {
    T += dt;
    if (playing) {
      if (doneT > 0) { doneT -= dt * speed; if (doneT <= 0) reset(); }
      else {
        p += dt * speed / DUR[si];
        if (si === 7 && pathN > 0) posOnPath(clamp(p, 0, 1));
        if (p >= 1) advance();
      }
    }
    draw(T);
    let known = 0; for (let i = 0; i < m.length; i++) if (m[i] === 1) known++;
    rCycle.set(String(cycle)); rCov.set(Math.round(100 * known / floorCells) + '%');
    rStage.set(doneT > 0 ? 'done' : `${si + 1} · ${ST[si].n}`);
  });
  draw(0);
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

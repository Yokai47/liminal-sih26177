// Proving nothing was missed (de Silva & Ghrist sensor coverage; Betti numbers and persistence).
// A room with one pillar and 22 drones, each sensing a disc of radius r. Two numbers certify the coverage:
//   β₀ = pieces of the covered region (union-find over discs that overlap),
//   β₁ = holes: uncovered regions completely ringed by coverage (rasterise at 4-unit cells, flood the uncovered
//        space from the room walls; every uncovered component the flood cannot reach is a hole). The pillar counts as
//        uncovered, so a ring of drones around it with a gap behind it is a hole too: the pocket behind the pillar.
// The barcode is exact on that raster: β₀ bars come from Kruskal merge distances, β₁ bars from a union-find over the
// cells in decreasing distance (the elder rule), which is the persistence of the holes as r grows.

// ------------------------------------------------------------------ the pure topology core (no DOM)
export function topoCore({ RW, RH, pillar: P, cell: CELL, rmax: RLIM = 90 }) {
  const GX = Math.round(RW / CELL), GY = Math.round(RH / CELL), NCELL = GX * GY;
  const isP = new Uint8Array(NCELL), dist = new Float32Array(NCELL), lab = new Int32Array(NCELL), q = new Int32Array(NCELL);
  const inPil = (x, y) => x > P.x && x < P.x + P.w && y > P.y && y < P.y + P.h;
  let freeN = 0;
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) { const c = j * GX + i; isP[c] = inPil((i + .5) * CELL, (j + .5) * CELL) ? 1 : 0; if (!isP[c]) freeN++; }

  // dist: distance from each cell centre to the nearest drone (capped a little beyond the slider's range).
  // eff: the radius from which the cell counts as covered when we ask "is this uncovered space connected?". A plain
  // centre test gets necks thinner than a cell wrong (two discs that almost touch look joined, and the tip of the gap
  // beside a thin overlap gets cut off as a fake one-cell hole). So connectivity uses a conservative raster: a cell is
  // covered only when it lies wholly inside one disc (dist + half a cell diagonal), plus the segment joining two
  // overlapping discs, which always lies inside their union (the 1-skeleton of the Čech complex, a 4-connected digital
  // line). By the nerve theorem that has the same holes as the union of discs. A component then counts as a hole only
  // if one of its free cells has its centre truly uncovered (dist > r), so slivers and seams never count.
  const eff = new Float32Array(NCELL), d2 = new Float32Array(NCELL), CAP = RLIM + 12, HD = CELL * Math.SQRT1_2;
  function field(xs, ys, n) {
    d2.fill(CAP * CAP);
    const span = Math.ceil(CAP / CELL);
    for (let k = 0; k < n; k++) {
      const xk = xs[k], yk = ys[k], ci = Math.floor(xk / CELL), cj = Math.floor(yk / CELL);
      const i0 = Math.max(0, ci - span), i1 = Math.min(GX - 1, ci + span), j0 = Math.max(0, cj - span), j1 = Math.min(GY - 1, cj + span);
      for (let j = j0; j <= j1; j++) {
        const dy = (j + .5) * CELL - yk, dy2 = dy * dy, row = j * GX;
        for (let i = i0; i <= i1; i++) { const dx = (i + .5) * CELL - xk, v = dx * dx + dy2; if (v < d2[row + i]) d2[row + i] = v; }
      }
    }
    for (let c = 0; c < NCELL; c++) { const d = Math.sqrt(d2[c]); dist[c] = d; eff[c] = d + HD; }
    pairs(xs, ys, n);
    for (let e = 0; e < np; e++) {
      const lr = pr[e]; if (lr > CAP) continue;
      const a = pa[e], b = pb[e], ax = xs[a], ay = ys[a], dx = xs[b] - ax, dy = ys[b] - ay, d = Math.sqrt(dx * dx + dy * dy); if (d < 1e-6) continue;
      const ux = dx / d, uy = dy / d, thick = (Math.abs(ux) + Math.abs(uy)) * CELL / 2;
      // only the middle of the segment can matter: a cell at distance t along it with |offset| <= thick already has
      // eff <= dist + HD <= min(t, d - t) + thick + HD, which is <= d/2 <= lr unless |t - d/2| < thick + HD
      const wv = thick + HD + .5, t0 = Math.max(0, d / 2 - wv), t1 = Math.min(d, d / 2 + wv);
      const xa = ax + ux * t0, xb = ax + ux * t1, ya = ay + uy * t0, yb = ay + uy * t1;
      const i0 = Math.max(0, Math.floor(Math.min(xa, xb) / CELL) - 1), i1 = Math.min(GX - 1, Math.floor(Math.max(xa, xb) / CELL) + 1);
      const j0 = Math.max(0, Math.floor(Math.min(ya, yb) / CELL) - 1), j1 = Math.min(GY - 1, Math.floor(Math.max(ya, yb) / CELL) + 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = (i + .5) * CELL - ax, py = (j + .5) * CELL - ay, t = px * ux + py * uy, o = py * ux - px * uy;
        if (t >= 0 && t <= d && o <= thick && o >= -thick) { const c = j * GX + i; if (eff[c] > lr) eff[c] = lr; }
      }
    }
  }

  // holes at radius r: label 0 = covered, 1 = uncovered and reachable from the walls, 2.. = enclosed components
  const holeList = [];
  let R0 = 0;
  function holes(r) {
    let covered = 0; R0 = r;
    for (let c = 0; c < NCELL; c++) { lab[c] = isP[c] || eff[c] > r ? -1 : 0; if (!isP[c] && dist[c] <= r) covered++; }
    const flood = (seed, L) => {
      let qh = 0, qt = 0; q[qt++] = seed; lab[seed] = L;
      let free = 0, pil = 0, deep = -1, dd = -1;
      while (qh < qt) {
        const c = q[qh++], i = c % GX, j = (c / GX) | 0;
        if (isP[c]) pil = 1; else if (dist[c] > R0) { free++; if (dist[c] > dd) { dd = dist[c]; deep = c; } }
        for (let dj = -1; dj <= 1; dj++) {                // 8-connected: the covered barriers are 4-connected
          const jj = j + dj; if (jj < 0 || jj >= GY) continue;
          for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= GX) continue; const v = jj * GX + ii; if (lab[v] === -1) { lab[v] = L; q[qt++] = v; } }
        }
      }
      return { free, pil, deep, dd, n: qt };
    };
    // the uncovered space the walls can reach is not a hole; remember its deepest point for a label
    let wall = { x: 0, y: 0, depth: -1 };
    const seed = (c) => { if (lab[c] !== -1) return; const h = flood(c, 1); if (h.deep >= 0 && h.dd - r > wall.depth) wall = { x: (h.deep % GX + .5) * CELL, y: (((h.deep / GX) | 0) + .5) * CELL, depth: h.dd - r }; };
    for (let i = 0; i < GX; i++) { seed(i); seed((GY - 1) * GX + i); }
    for (let j = 0; j < GY; j++) { seed(j * GX); seed(j * GX + GX - 1); }
    holeList.length = 0; let L = 2;
    for (let c = 0; c < NCELL; c++) {
      if (lab[c] !== -1) continue;
      const h = flood(c, L);
      if (h.free > 0)                                     // a pillar, sliver or seam with no uncovered free centre is not a gap
        holeList.push({ label: L, free: h.free, pillar: h.pil, depth: h.dd - r, x: (h.deep % GX + .5) * CELL, y: (((h.deep / GX) | 0) + .5) * CELL });
      else for (let k = 0; k < h.n; k++) lab[q[k]] = 0;   // not a hole: label it like coverage
      L++;
    }
    return { holes: holeList, covered, freeN, wall };
  }

  // β₀: two discs are linked when they overlap somewhere that is not inside the solid pillar
  function lensOutside(ax, ay, bx, by, r) {
    const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy); if (d >= 2 * r) return false;
    const ux = dx / d, uy = dy / d, a = Math.acos(Math.min(1, d / (2 * r)));
    for (let s = 0; s <= 8; s++) {                     // sample both arcs of the lens boundary (it is convex, so is the pillar)
      const t = -a + 2 * a * s / 8, ct = Math.cos(t), st = Math.sin(t);
      const x1 = ax + r * (ux * ct - uy * st), y1 = ay + r * (uy * ct + ux * st);
      const x2 = bx - r * (ux * ct - uy * st), y2 = by - r * (uy * ct + ux * st);
      if (!inPil(x1, y1) || !inPil(x2, y2)) return true;
    }
    return false;
  }
  function linkR(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay);
    if (!inPil((ax + bx) / 2, (ay + by) / 2)) return d / 2;
    let lo = d / 2, hi = d / 2 + 400;                  // the overlap starts inside the pillar: find where it first pokes out
    for (let it = 0; it < 24; it++) { const m = (lo + hi) / 2; if (lensOutside(ax, ay, bx, by, m)) hi = m; else lo = m; }
    return hi;
  }
  const PMAX = 64 * 63 / 2, pr = new Float32Array(PMAX), pa = new Uint8Array(PMAX), pb = new Uint8Array(PMAX), pidx = new Uint16Array(PMAX);
  let np = 0;
  function pairs(xs, ys, n) {
    np = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { pr[np] = linkR(xs[i], ys[i], xs[j], ys[j]); pa[np] = i; pb[np] = j; np++; }
  }
  const uf = new Int32Array(64);
  const find = (p, i) => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
  function beta0(n, r) {
    for (let i = 0; i < n; i++) uf[i] = i;
    let k = n;
    for (let e = 0; e < np; e++) if (pr[e] < r) { const a = find(uf, pa[e]), b = find(uf, pb[e]); if (a !== b) { uf[a] = b; k--; } }
    return k;
  }
  // exact β₀ barcode: every merge in Kruskal order kills one piece
  function bars0(n) {
    for (let e = 0; e < np; e++) pidx[e] = e;
    const idx = pidx.subarray(0, np).sort((a, b) => pr[a] - pr[b]);
    for (let i = 0; i < n; i++) uf[i] = i;
    const deaths = [];
    for (let k = 0; k < idx.length; k++) { const e = idx[k], a = find(uf, pa[e]), b = find(uf, pb[e]); if (a !== b) { uf[a] = b; deaths.push(pr[e]); } }
    return deaths;                                     // n − 1 finite bars [0, death) plus one bar that never dies
  }

  // exact β₁ barcode on the raster: add cells in decreasing eff (pillar first, it is never covered) and union them
  // (8-connected) with a virtual "outside" node that every wall cell touches. A component's age is the largest
  // distance of a free cell in it; when two meet, the younger one dies here, which in growing-r time is the birth of a
  // hole that lasts until its last free centre is covered: bar [merge r, largest distance).
  const order = new Uint32Array(NCELL), key = new Float32Array(NCELL), par = new Int32Array(NCELL + 1), mxd = new Float32Array(NCELL + 1), hp = new Uint8Array(NCELL + 1), added = new Uint8Array(NCELL);
  function bars1() {
    for (let c = 0; c < NCELL; c++) { order[c] = c; key[c] = isP[c] ? 1e9 : eff[c]; }
    order.sort((a, b) => key[b] - key[a]);
    const O = NCELL; par[O] = O; mxd[O] = 1e12; hp[O] = 0; added.fill(0);
    const out = [];
    const fnd = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const join = (a, b, lvl) => {
      const ra = fnd(a), rb = fnd(b); if (ra === rb) return;
      let el = ra, yo = rb; if (mxd[rb] > mxd[ra]) { el = rb; yo = ra; }
      if (mxd[yo] > lvl) out.push({ b: lvl, d: mxd[yo], pillar: hp[yo] });
      par[yo] = el; hp[el] |= hp[yo];
    };
    for (let k = 0; k < NCELL; k++) {
      const c = order[k], lvl = key[c], i = c % GX, j = (c / GX) | 0;
      added[c] = 1; par[c] = c; mxd[c] = isP[c] ? -1 : Math.min(dist[c], eff[c]); hp[c] = isP[c];
      if (i === 0 || j === 0 || i === GX - 1 || j === GY - 1) join(c, O, lvl);
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj; if (jj < 0 || jj >= GY) continue;
        for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= GX || (!di && !dj)) continue; const v = jj * GX + ii; if (added[v]) join(c, v, lvl); }
      }
    }
    return out;
  }
  const alive = (bars, r) => { let k = 0; for (const b of bars) if (b.b <= r && r < b.d) k++; return k; };

  return { GX, GY, NCELL, CELL, isP, dist, eff, lab, freeN, field, holes, pairs, beta0, bars0, bars1, alive, linkR, inPil, get np() { return np; }, pr, pa, pb };
}

// ------------------------------------------------------------------ the simulation page
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const TAU = Math.PI * 2, LAV = '#B9A6F2';
  const RW = 600, RH = 420, UNIT_M = .025;                       // room 15 m x 10.5 m in model units of 2.5 cm
  const PIL = { x: 340, y: 168, w: 64, h: 64 };                  // aligned to the 4-unit raster
  const N = 22, RMIN = 20, RMAX = 90, XMAX = 90;
  const core = topoCore({ RW, RH, pillar: PIL, cell: 4, rmax: RMAX });
  const { GX, GY, NCELL, CELL } = core;
  const xs = new Float32Array(N), ys = new Float32Array(N);

  // a hand-made start: at the default range the room is one piece (β₀ = 1) and the only hole is the pocket behind the
  // pillar, ringed by eight drones. Its bar runs from r = 47 to 98 (past the slider's end); every other bar is shorter
  // than 6. Pulling one of the nearer ring drones into the pocket closes it.
  const START = [[246, 236], [324, 278], [373, 304], [456, 261], [448, 198], [416, 119], [361, 53], [279, 99],
    [157, 207], [280, 364], [220, 58], [509, 95], [83, 152], [193, 353], [218, 139], [533, 219], [93, 359], [576, 41],
    [533, 323], [62, 63], [463, 31], [410, 396]];
  function placeStart() { for (let i = 0; i < N; i++) { xs[i] = START[i][0]; ys[i] = START[i][1]; } }
  function scatter() {
    for (let i = 0; i < N; i++) {
      let best = null, bd = -1;
      for (let t = 0; t < 30; t++) {                                // best-candidate darts: random but not clumped
        const x = 18 + Math.random() * (RW - 36), y = 18 + Math.random() * (RH - 36);
        if (x > PIL.x - 14 && x < PIL.x + PIL.w + 14 && y > PIL.y - 14 && y < PIL.y + PIL.h + 14) continue;
        let m = 1e9; for (let k = 0; k < i; k++) m = Math.min(m, Math.hypot(x - xs[k], y - ys[k]));
        m *= .6 + .8 * Math.random();
        if (m > bd) { bd = m; best = [x, y]; }
      }
      xs[i] = best[0]; ys[i] = best[1];
    }
  }

  // ---------------------------------------------------------------- controls and readouts
  let r = 58, links = 1;
  kit.slider(controls, { label: 'Sensor range', min: RMIN, max: RMAX, step: 1, value: r, fmt: (v) => (v * UNIT_M).toFixed(2) + ' m', onInput: (v) => { r = v; liveDirty = true; } });
  kit.button(controls, { label: 'Scatter', onClick: () => { scatter(); posDirty = true; persistDirty = true; } });
  kit.toggle(controls, { label: 'Links', options: [{ v: 0, label: 'Off' }, { v: 1, label: 'On' }], value: 1, onChange: (v) => { links = v; } });
  kit.hint(controls, 'Drag a drone to close a gap (on a phone: tap a drone, then tap where it should go).');
  const rB0 = kit.readout(readouts, { label: 'Pieces β₀', tone: 'teal' });
  const rB1 = kit.readout(readouts, { label: 'Holes β₁', tone: 'rose' });
  const rCov = kit.readout(readouts, { label: 'Covered', tone: 'ink' });

  // ---------------------------------------------------------------- live topology at the current r
  let posDirty = true, liveDirty = true, persistDirty = true;
  let b0 = 1, nHoles = 0, covPct = 0, holes = [];
  const segCov = [], segHole = [];                                   // contour segments in model units
  let pathCov = null, pathHole = null;
  const fval = new Float32Array(NCELL);
  const off = document.createElement('canvas'); off.width = GX; off.height = GY;
  const octx = off.getContext('2d'), img = octx.createImageData(GX, GY), px = img.data;

  // marching squares over the cell centres of a scalar field (positive inside); smooth thanks to interpolation
  function contour(f, out) {
    out.length = 0;
    const P = (i, j, t, horiz) => horiz ? [(i + .5 + t) * CELL, (j + .5) * CELL] : [(i + .5) * CELL, (j + .5 + t) * CELL];
    for (let j = 0; j < GY - 1; j++) for (let i = 0; i < GX - 1; i++) {
      const c = j * GX + i, a = f[c], b = f[c + 1], d = f[c + GX], e = f[c + GX + 1];
      const k = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (e > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const top = () => P(i, j, a / (a - b), true), bot = () => P(i, j + 1, d / (d - e), true);
      const lef = () => P(i, j, a / (a - d), false), rig = () => P(i + 1, j, b / (b - e), false);
      const seg = (p, q2) => out.push(p[0], p[1], q2[0], q2[1]);
      switch (k) {
        case 1: case 14: seg(top(), lef()); break;
        case 2: case 13: seg(top(), rig()); break;
        case 3: case 12: seg(lef(), rig()); break;
        case 4: case 11: seg(rig(), bot()); break;
        case 6: case 9: seg(top(), bot()); break;
        case 7: case 8: seg(lef(), bot()); break;
        case 5: case 10: {
          const mid = (a + b + d + e) / 4;
          if ((k === 5) === (mid > 0)) { seg(top(), rig()); seg(lef(), bot()); } else { seg(top(), lef()); seg(rig(), bot()); }
          break;
        }
      }
    }
    const p = new Path2D(); for (let s = 0; s < out.length; s += 4) { p.moveTo(out[s], out[s + 1]); p.lineTo(out[s + 2], out[s + 3]); }
    return p;
  }

  let wall = { x: 0, y: 0, depth: -1 };
  const isHole = new Uint8Array(4096);
  function updateLive() {
    if (posDirty) { core.field(xs, ys, N); posDirty = false; liveDirty = true; }
    if (!liveDirty) return;
    liveDirty = false;
    b0 = core.beta0(N, r);
    const res = core.holes(r);
    holes = res.holes.map((h) => ({ ...h })); wall = res.wall;
    holes.sort((a, b) => (b.pillar - a.pillar) || (a.x - b.x));
    nHoles = holes.length; covPct = 100 * res.covered / res.freeN;
    const lab = core.lab, dist = core.dist; isHole.fill(0); for (const h of holes) if (h.label < isHole.length) isHole[h.label] = 1;
    for (let c = 0; c < NCELL; c++) fval[c] = r - dist[c];
    pathCov = contour(fval, segCov);
    for (let c = 0; c < NCELL; c++) {
      const inH = lab[c] > 1 && lab[c] < isHole.length && isHole[lab[c]] === 1 && !core.isP[c];
      fval[c] = inH ? dist[c] - r + 1.4 : Math.min(dist[c] - r, -.6);
      const o = c * 4; px[o] = 185; px[o + 1] = 166; px[o + 2] = 242; px[o + 3] = inH && fval[c] > 0 ? 64 : 0;
    }
    pathHole = nHoles ? contour(fval, segHole) : null;
    octx.putImageData(img, 0, 0);
  }

  // ---------------------------------------------------------------- persistence for the current positions (on drag end)
  const CS = 240, curve0 = new Int16Array(CS + 1), curve1 = new Int16Array(CS + 1);
  let deaths0 = [], bars1 = [], b1max = 1;
  function updatePersist() {
    if (posDirty) updateLive();
    deaths0 = core.bars0(N).sort((a, b) => b - a);
    bars1 = core.bars1().filter((b) => b.d - b.b > .01);
    bars1.sort((a, b) => (b.d - b.b) - (a.d - a.b));
    b1max = 1;
    for (let k = 0; k <= CS; k++) {
      const v = k * XMAX / CS; let m = 0; for (const d of deaths0) if (d <= v) m++;
      curve0[k] = N - m; curve1[k] = core.alive(bars1, v); if (curve1[k] > b1max) b1max = curve1[k];
    }
    persistDirty = false;
  }

  // ---------------------------------------------------------------- input: drag, or tap a drone then tap its new place
  let G = null, drag = -1, sel = -1, selT = 0, hover = -1, moved = false, downX = 0, downY = 0;
  const toModel = (x, y) => [(x - G.rx) / G.s, (y - G.ry) / G.s];
  function pick(x, y, touch) {
    const [mx, my] = toModel(x, y), hr = (touch ? 26 : 18) / G.s; let b = -1, bd = hr * hr;
    for (let i = 0; i < N; i++) { const d = (xs[i] - mx) ** 2 + (ys[i] - my) ** 2; if (d < bd) { bd = d; b = i; } }
    return b;
  }
  function placeDrone(i, x, y) {
    let [mx, my] = toModel(x, y);
    mx = clamp(mx, 8, RW - 8); my = clamp(my, 8, RH - 8);
    const m = 7;                                                       // keep out of the solid pillar
    if (mx > PIL.x - m && mx < PIL.x + PIL.w + m && my > PIL.y - m && my < PIL.y + PIL.h + m) {
      const dl = mx - (PIL.x - m), dr = PIL.x + PIL.w + m - mx, dt = my - (PIL.y - m), db = PIL.y + PIL.h + m - my, mn = Math.min(dl, dr, dt, db);
      if (mn === dl) mx = PIL.x - m; else if (mn === dr) mx = PIL.x + PIL.w + m; else if (mn === dt) my = PIL.y - m; else my = PIL.y + PIL.h + m;
    }
    xs[i] = mx; ys[i] = my; posDirty = true;
  }
  const el = cv.cv; el.style.touchAction = 'pan-y';
  const onDown = (e) => {
    const touch = e.pointerType !== 'mouse', i = pick(e.offsetX, e.offsetY, touch);
    if (i >= 0) { drag = i; moved = false; downX = e.offsetX; downY = e.offsetY; try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } el.style.cursor = 'grabbing'; return; }
    if (sel >= 0) {
      const [mx, my] = toModel(e.offsetX, e.offsetY);
      if (mx >= 0 && my >= 0 && mx <= RW && my <= RH) { placeDrone(sel, e.offsetX, e.offsetY); sel = -1; persistDirty = true; }
    }
  };
  const onMove = (e) => {
    if (drag >= 0) {
      if (!moved && Math.hypot(e.offsetX - downX, e.offsetY - downY) < 4) return;
      moved = true; placeDrone(drag, e.offsetX, e.offsetY); return;
    }
    if (e.pointerType === 'mouse') { hover = pick(e.offsetX, e.offsetY, false); el.style.cursor = hover >= 0 ? 'grab' : (sel >= 0 ? 'crosshair' : 'default'); }
  };
  const onUp = () => {
    if (drag < 0) return;
    if (moved) { sel = -1; persistDirty = true; } else { sel = sel === drag ? -1 : drag; selT = 0; }
    drag = -1; el.style.cursor = hover >= 0 ? 'grab' : 'default';
  };
  const onCancel = () => { if (drag < 0) return; if (moved) persistDirty = true; drag = -1; };   // e.g. the page took over to scroll
  const onLeave = () => { hover = -1; if (drag < 0) el.style.cursor = 'default'; };
  el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onCancel); el.addEventListener('pointerleave', onLeave);

  // ---------------------------------------------------------------- layout
  function layout() {
    const w = cv.w, h = cv.h, phone = w < 640;
    if (phone) {
      const s = (w - 32) / RW, rw = RW * s, rh = RH * s, top = 16;
      const py = top + rh + 14, ph = Math.max(90, h - py - 12), gw = (w - 32 - 10) / 2;
      G = { phone, s, rx: 16, ry: top, rw, rh, strip0: { x: 16, y: py, w: gw, h: ph }, strip1: { x: 16 + gw + 10, y: py, w: gw, h: ph }, bar: null, vy: 0 };
    } else {
      const side = clamp(w * .28, 220, 272), aw = w - 44 - side - 24, ah = h - 40 - 30;
      const s = Math.min(aw / RW, ah / RH), rw = RW * s, rh = RH * s, rx = 22, by = Math.max(20, (h - rh - 30) / 2);
      const sx = w - 22 - side, top = 20, avail = h - 40;
      const h0 = Math.round(clamp(avail * .21, 84, 120)), h1 = Math.round(clamp(avail * .18, 72, 104)), gap = 10;
      const bty = top + h0 + gap + h1 + gap;
      G = { phone, s, rx, ry: by + 30, rw, rh, vy: by + 12, strip0: { x: sx, y: top, w: side, h: h0 }, strip1: { x: sx, y: top + h0 + gap, w: side, h: h1 }, bar: { x: sx, y: bty, w: side, h: h - 20 - bty } };
    }
  }
  cv.onResize(layout); layout();

  // ---------------------------------------------------------------- drawing
  const LAVA = (a) => `rgba(185,166,242,${a})`, TEALA = (a) => `rgba(127,212,207,${a})`;
  const PL = 30, PR = 14;                                              // plot margins shared by the strips and the barcode
  function drone(x, y, sz, col) {
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - sz, y - sz); ctx.lineTo(x + sz, y + sz); ctx.moveTo(x + sz, y - sz); ctx.lineTo(x - sz, y + sz); ctx.stroke();
    ctx.beginPath(); for (const [ox, oy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(x + ox * sz + 2.2, y + oy * sz); ctx.arc(x + ox * sz, y + oy * sz, 2.2, 0, TAU); } ctx.stroke();
  }
  function label(s2, x, y, col, align = 'left', size = 11) {          // text on a soft backdrop so it reads over links
    ctx.font = `400 ${size}px ${F.sans}`; const tw = ctx.measureText(s2).width;
    const x0 = clamp(align === 'left' ? x : x - tw, G.rx + 10, G.rx + G.rw - 10 - tw); x = align === 'left' ? x0 : x0 + tw;
    y = clamp(y, G.ry + 14, G.ry + G.rh - 14);
    const bx = x0 - 5, by = y - size * .5 - 4, bw = tw + 10, bh = size + 8;
    for (let k = 0; k < nRect; k += 4) if (bx < rects[k] + rects[k + 2] && rects[k] < bx + bw && by < rects[k + 1] + rects[k + 3] && rects[k + 1] < by + bh) return false;
    if (nRect < rects.length) { rects[nRect++] = bx; rects[nRect++] = by; rects[nRect++] = bw; rects[nRect++] = bh; }
    ctx.fillStyle = 'rgba(27,30,61,.78)'; roundRect(ctx, bx, by, bw, bh, 6); ctx.fill();
    text(ctx, s2, x, y + .5, { size, color: col, align, base: 'middle' });
    return true;
  }
  const rects = new Float32Array(4 * 64); let nRect = 0;                 // label boxes drawn this frame (no overlaps)
  function marker(X, y0, y1) {
    const mx = X(r);
    ctx.strokeStyle = 'rgba(246,210,177,.8)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(mx, y0); ctx.lineTo(mx, y1); ctx.stroke(); ctx.setLineDash([]);
    return mx;
  }
  function stripPlot(R, which) {
    const { x, y, w, h } = R, fs = G.phone ? 10.5 : 11, curve = which === 0 ? curve0 : curve1, col = which === 0 ? C.teal : LAV;
    ctx.fillStyle = C.panel; roundRect(ctx, x, y, w, h, 10); ctx.fill();
    const yMax = which === 0 ? N : Math.max(2, b1max), top = y + 26, bot = y + h - 20;
    const X = (v) => x + PL + v / XMAX * (w - PL - PR), Y = (v) => bot - v / yMax * (bot - top);
    ctx.fillStyle = 'rgba(220,214,236,.035)'; ctx.fillRect(X(0), top - 4, X(RMIN) - X(0), bot - top + 4);   // out of the slider's reach
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath();
    for (const k of (which === 0 ? [1, N] : Array.from({ length: yMax }, (_, i) => i + 1))) { ctx.moveTo(X(0), Y(k)); ctx.lineTo(X(XMAX), Y(k)); }
    ctx.stroke();
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(X(0), top - 4); ctx.lineTo(X(0), bot); ctx.lineTo(X(XMAX), bot); ctx.stroke();
    for (const k of (which === 0 ? [0, N] : [0, yMax])) text(ctx, String(k), X(0) - 6, Y(k), { size: 9.5, color: C.faint, font: F.mono, align: 'right', base: 'middle' });
    ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let k = 0; k <= CS; k++) { const xx = X(k * XMAX / CS); if (!k) ctx.moveTo(xx, Y(curve[0])); else { if (curve[k] !== curve[k - 1]) ctx.lineTo(xx, Y(curve[k - 1])); ctx.lineTo(xx, Y(curve[k])); } }
    ctx.stroke();
    const mx = marker(X, top - 4, bot), cur = which === 0 ? b0 : nHoles;
    ctx.fillStyle = C.apricot; ctx.beginPath(); ctx.arc(mx, Y(cur), 3.2, 0, TAU); ctx.fill();
    text(ctx, which === 0 ? 'pieces β₀' : 'holes β₁', x + 12, y + 16, { size: fs, color: col });
    if (drag >= 0 && moved) text(ctx, G.phone ? 'on release' : 'updates on release', x + w - 12, y + 16, { size: 10, color: C.apricot, align: 'right' });
    else text(ctx, 'now ' + cur, x + w - 12, y + 16, { size: fs, color: C.apricot, font: F.mono, align: 'right' });
    if (!G.phone) text(ctx, 'sensor range →', X(XMAX), y + h - 6, { size: 10, color: C.faint, align: 'right' });
    else text(ctx, 'range →', X(XMAX), y + h - 6, { size: 9.5, color: C.faint, align: 'right' });
  }
  function barcode(R) {
    const { x, y, w, h } = R, X = (v) => x + PL + Math.min(v, XMAX) / XMAX * (w - PL - PR);
    ctx.fillStyle = C.panel; roundRect(ctx, x, y, w, h, 10); ctx.fill();
    text(ctx, 'barcode', x + 12, y + 16, { size: 11, color: C.muted });
    ctx.font = `400 10px ${F.sans}`;
    if (ctx.measureText('one bar per gap: opens → closes').width < w - 80) text(ctx, 'one bar per gap: opens → closes', x + w - 12, y + 16, { size: 10, color: C.faint, align: 'right' });
    ctx.font = `400 11px ${F.sans}`;
    const cap = 'long bars are real gaps, short ones are noise', capLines = ctx.measureText(cap).width > w - 24 ? 2 : 1;
    const top = y + 30, bottom = y + h - 28 - capLines * 14;
    const n1 = Math.min(bars1.length, h < 260 ? 4 : 6), p1 = 7, blk1 = n1 ? 10 + n1 * p1 : 18;
    const p0 = clamp((bottom - top - blk1 - 10) / N, 1.6, 5);
    // β₀ bars, longest first; the first never dies
    ctx.strokeStyle = TEALA(.78); ctx.lineWidth = Math.max(1, p0 - 1.3); ctx.lineCap = 'butt'; ctx.beginPath();
    ctx.moveTo(X(0), top + p0 / 2); ctx.lineTo(X(XMAX), top + p0 / 2);
    for (let k = 0; k < deaths0.length; k++) { const yy = top + (k + 1.5) * p0; ctx.moveTo(X(0), yy); ctx.lineTo(Math.max(X(deaths0[k]), X(0) + 1.5), yy); }
    ctx.stroke();
    const ar = X(XMAX); ctx.fillStyle = C.teal; ctx.beginPath(); ctx.moveTo(ar + 5, top + p0 / 2); ctx.lineTo(ar - 1, top + p0 / 2 - 3.2); ctx.lineTo(ar - 1, top + p0 / 2 + 3.2); ctx.fill();
    text(ctx, 'β₀', x + 12, top + N * p0 / 2, { size: 11, color: C.teal, base: 'middle' });
    // β₁ bars
    let yy = top + N * p0 + 8 + 9;
    const y1lab = yy + (n1 ? (n1 - 1) * p1 / 2 : 0); text(ctx, 'β₁', x + 12, y1lab, { size: 11, color: LAV, base: 'middle' });
    if (!n1) text(ctx, 'no holes at any range', X(0) + 4, yy, { size: 10.5, color: C.faint, base: 'middle' });
    ctx.lineCap = 'round';
    let pillarBar = null; for (const b of bars1) if (b.pillar && (!pillarBar || b.d > pillarBar.d)) pillarBar = b;
    for (let k = 0; k < n1; k++, yy += p1) {
      const b = bars1[k], x0 = X(b.b), x1 = X(b.d);
      ctx.strokeStyle = LAV; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(Math.max(x1, x0 + .5), yy); ctx.stroke();
      if (b.d > XMAX) { ctx.fillStyle = LAV; ctx.beginPath(); ctx.moveTo(x1 + 6, yy); ctx.lineTo(x1 + 1, yy - 3.4); ctx.lineTo(x1 + 1, yy + 3.4); ctx.fill(); }
      if (b === pillarBar) { if (x0 - X(0) > 44) text(ctx, 'pillar', x0 - 6, yy, { size: 10, color: LAV, align: 'right', base: 'middle' }); else if (b.d < XMAX * .8) text(ctx, 'pillar', x1 + 6, yy, { size: 10, color: LAV, base: 'middle' }); }
    }
    if (bars1.length > n1) text(ctx, '+' + (bars1.length - n1), x + 12, y1lab + 13, { size: 9.5, color: C.faint, font: F.mono, base: 'middle' });
    // marker and the shared range axis, in metres
    marker(X, top - 4, bottom);
    const ay = bottom + 4; ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(0), ay); ctx.lineTo(X(XMAX), ay); ctx.stroke();
    for (let m = 0; m <= 2; m += .5) text(ctx, m === 0 ? '0' : m.toFixed(1), X(m / UNIT_M), ay + 12, { size: 9.5, color: C.faint, font: F.mono, align: 'center' });
    text(ctx, 'm', X(XMAX) + 4, ay + 12, { size: 9.5, color: C.faint, font: F.mono, align: 'left' });
    if (capLines === 1) text(ctx, cap, x + 12, y + h - 12, { size: 11, color: C.muted });
    else { text(ctx, 'long bars are real gaps,', x + 12, y + h - 26, { size: 11, color: C.muted }); text(ctx, 'short ones are noise', x + 12, y + h - 12, { size: 11, color: C.muted }); }
  }

  function draw() {
    const { s, rx, ry, rw, rh } = G; cv.clear();
    const X = (v) => rx + v * s, Y = (v) => ry + v * s;
    // floor (unknown space) and coverage
    ctx.fillStyle = 'rgba(74,75,134,.34)'; roundRect(ctx, rx, ry, rw, rh, 10); ctx.fill();
    ctx.save(); roundRect(ctx, rx, ry, rw, rh, 10); ctx.clip();
    ctx.fillStyle = TEALA(.17); ctx.beginPath();
    for (let i = 0; i < N; i++) { ctx.moveTo(X(xs[i]) + r * s, Y(ys[i])); ctx.arc(X(xs[i]), Y(ys[i]), r * s, 0, TAU); }
    ctx.fill();
    ctx.save(); ctx.translate(rx, ry); ctx.scale(s, s);
    if (pathCov) { ctx.strokeStyle = TEALA(.42); ctx.lineWidth = 1.1 / s; ctx.stroke(pathCov); }
    ctx.restore();
    // holes: soft fill + outline
    if (nHoles) {
      ctx.imageSmoothingEnabled = true; ctx.drawImage(off, rx, ry, rw, rh);
      ctx.save(); ctx.translate(rx, ry); ctx.scale(s, s); ctx.strokeStyle = LAV; ctx.lineWidth = 1.5 / s; ctx.lineCap = 'round'; ctx.stroke(pathHole); ctx.restore();
    }
    // links between overlapping discs
    if (links) {
      ctx.strokeStyle = TEALA(.5); ctx.lineWidth = 1; ctx.beginPath();
      for (let e = 0; e < core.np; e++) if (core.pr[e] < r) { const a = core.pa[e], b = core.pb[e]; ctx.moveTo(X(xs[a]), Y(ys[a])); ctx.lineTo(X(xs[b]), Y(ys[b])); }
      ctx.stroke();
    }
    ctx.restore();
    // the pillar
    ctx.fillStyle = 'rgba(143,140,196,.92)'; roundRect(ctx, X(PIL.x), Y(PIL.y), PIL.w * s, PIL.h * s, 5); ctx.fill();
    text(ctx, 'pillar', X(PIL.x + PIL.w / 2), Y(PIL.y + PIL.h / 2), { size: G.phone ? 9.5 : 11, color: C.bg, align: 'center', base: 'middle', weight: 500 });
    ctx.strokeStyle = 'rgba(143,140,196,.55)'; ctx.lineWidth = 1.4; roundRect(ctx, rx, ry, rw, rh, 10); ctx.stroke();
    // drones
    const sz = G.phone ? 3.6 : 4.6;
    for (let i = 0; i < N; i++) {
      const hot = i === drag || i === sel || i === hover;
      if (hot) { ctx.fillStyle = 'rgba(246,210,177,.2)'; ctx.beginPath(); ctx.arc(X(xs[i]), Y(ys[i]), 14, 0, TAU); ctx.fill(); }
      drone(X(xs[i]), Y(ys[i]), sz, hot ? C.apricot : C.teal);
    }
    // labels: the holes (the story's numbered pocket dots), then the uncovered space open to the walls (not a hole)
    const fs = G.phone ? 10 : 11; nRect = 0;
    const box = (x0, y0, bw, bh) => { if (nRect < rects.length) { rects[nRect++] = x0; rects[nRect++] = y0; rects[nRect++] = bw; rects[nRect++] = bh; } };
    box(X(PIL.x + PIL.w / 2) - 17, Y(PIL.y + PIL.h / 2) - 7, 34, 14);                      // keep the word "pillar" readable
    holes.forEach((hh) => box(X(hh.x) - 10, Y(hh.y) - 10, 20, 20));
    holes.forEach((hh, k) => {
      const hx = X(hh.x), hy = Y(hh.y), n = k + 1;
      ctx.fillStyle = LAVA(.25); ctx.beginPath(); ctx.arc(hx, hy, 11, 0, TAU); ctx.fill();
      ctx.fillStyle = LAV; ctx.beginPath(); ctx.arc(hx, hy, 7.5, 0, TAU); ctx.fill();
      text(ctx, String(n), hx, hy + .5, { size: 10, color: '#1E2140', weight: 600, align: 'center', base: 'middle' });
      const lbl = hh.pillar ? 'pocket behind the pillar' : 'hole ' + n, right = hx < rx + rw - 170;
      if (!label(lbl, hx + (right ? 17 : -17), hy, LAV, right ? 'left' : 'right', fs)) label(lbl, hx + (right ? -17 : 17), hy, LAV, right ? 'right' : 'left', fs);
    });
    if (!G.phone && wall.depth > 16 && covPct > 55) {
      for (let i = 0; i < N; i++) box(X(xs[i]) - 8, Y(ys[i]) - 8, 16, 16);
      const right = X(wall.x) < rx + rw * .6;
      label('open to the wall: not a hole', X(wall.x) + (right ? 6 : -6), Y(wall.y), C.muted, right ? 'left' : 'right', 10.5);
    }
    if (sel >= 0 && drag < 0) label('tap where it should go', X(xs[sel]) - 60, Y(ys[sel]) - 22, C.apricot, 'left', fs);
    // the verdict, above the room
    if (!G.phone) {
      let msg, col;
      if (b0 > 1) { msg = `${b0} separate pieces: the space between them was never searched`; col = C.rose; }
      else if (nHoles) { msg = `${nHoles === 1 ? 'One gap' : nHoles + ' gaps'} ringed by searched space: nobody looked inside`; col = LAV; }
      else { msg = covPct > 99.5 ? 'One piece, no holes: nothing was missed' : 'One piece, no holes. What is left is open to the walls'; col = C.teal; }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(rx + 5, G.vy - 4, 4, 0, TAU); ctx.fill();
      text(ctx, msg, rx + 16, G.vy, { size: 13, color: C.ink });
    }
    stripPlot(G.strip0, 0); stripPlot(G.strip1, 1);
    if (G.bar) barcode(G.bar);
  }

  // ---------------------------------------------------------------- loop
  placeStart();
  updateLive(); updatePersist();
  let tone0 = 'teal', tone1 = 'rose';
  const loop = kit.loop((dt) => {
    if (sel >= 0 && drag < 0) { selT += dt; if (selT > 8) sel = -1; }
    if (persistDirty && drag < 0) updatePersist();
    updateLive(); draw();
    rB0.set(String(b0)); const t0 = b0 === 1 ? 'teal' : 'rose'; if (t0 !== tone0) rB0.tone(tone0 = t0);
    rB1.set(String(nHoles)); const t1 = nHoles > 0 ? 'rose' : 'teal'; if (t1 !== tone1) rB1.tone(tone1 = t1);
    rCov.set(covPct.toFixed(covPct > 99.5 && covPct < 100 ? 1 : 0) + '%');
  });
  draw();
  return {
    start: loop.start, stop: loop.stop,
    destroy() { loop.stop(); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onCancel); el.removeEventListener('pointerleave', onLeave); cv.destroy(); },
  };
}

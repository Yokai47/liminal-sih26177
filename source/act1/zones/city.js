// A city block after an earthquake (Turkey-Syria, 6 Feb 2023). A top-down district of mid-rise apartment blocks; about
// half have collapsed into rubble that spills into the streets. 24 drones and 3 ground robots (UGVs) search it with no
// assignments:
//  - outdoors the drones sweep streets, yards and rubble surfaces by frontier exploration (2.5-D grid, 2 m cells,
//    thermal first): each heads for the nearest unsearched patch that no neighbour has already claimed;
//  - the UGVs drive the clear streets and park at collapsed buildings. They command nothing; being distinguishable they
//    break the swarm's symmetry: a building with a UGV parked at it rates higher for nearby drones, so the fleet splits
//    into one sub-swarm per building without anyone handing out jobs;
//  - inside the rubble a drone switches to indoor mode (3-D voxels at 5 cm, LiDAR, no GPS) and crawls void to void.
//    Each collapsed building counts its unsearched pockets down to zero (β₀ of the unknown space inside it);
//  - radio is weak under slabs: a drone out of range keeps mapping alone and its map merges when it reconnects
//    (a union of searched places merges in any order);
//  - the mission ends when β₀ of everything unsearched in the district is 0. Then a summary, a fade, a new district.
export default function mount({ stage, controls, readouts, kit }) {
  let B0S = null;   // calm display of the β₀ counter
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx, el = cv.cv;
  el.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- the model (metres, seconds of mission time)
  const TL = 15;                               // time-lapse: mission seconds per wall second
  const ND = 24, NU = 3;                       // drones, ground robots
  const BW = 64, BH = 56, SW = 14, PX = BW + SW, PY = BH + SW;   // block size and street width
  const CELL = 2, CC = 8;                      // outdoor coverage cell; coarse cell for frontier choice and β₀
  const V_OUT = 2.6, V_IN = .32, V_UGV = 2.4;     // m/s: search flight outdoors, crawl through rubble, UGV on rubble streets
  const R_TH = 9, R_OUT = 110, R_IN = 22;      // thermal footprint radius; radio range in the open / when under rubble
  const DWELL = 26;                            // s to scan one pocket (LiDAR + thermal + camera)

  const rB = kit.readout(readouts, { label: 'Buildings cleared', tone: 'teal' });
  const rP = kit.readout(readouts, { label: 'People found', tone: 'heat' });
  const rD = kit.readout(readouts, { label: 'Drones', tone: 'ink' });

  // ---------------------------------------------------------------- small helpers
  const hash = (x, y, s) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s, o = 4) { let a = 0, amp = .5, f = 1, n = 0; for (let i = 0; i < o; i++) { a += amp * vnoise(x * f, y * f, s + i * 31); n += amp; f *= 2.03; amp *= .5; } return a / n; }
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rgbOf = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const shade = (h, k, a = 1) => { const c = rgbOf(h).map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  const inPoly = (p, x, y) => { let ins = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  function sprite(r, g, b, a0, size = 64) {
    const c = mk(size, size), x = c.getContext('2d'), gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, `rgba(${r},${g},${b},${a0})`); gr.addColorStop(.3, `rgba(${r},${g},${b},${a0 * .5})`); gr.addColorStop(.65, `rgba(${r},${g},${b},${a0 * .14})`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, size, size); return c;
  }
  const SPR_TEAL = sprite(127, 212, 207, 1), SPR_HEAT = sprite(255, 195, 107, 1), SPR_DUST = sprite(222, 204, 200, 1, 96), SPR_APRI = sprite(246, 210, 177, 1);
  const GRAIN = (() => { const c = mk(128, 128), g = c.getContext('2d'), im = g.createImageData(128, 128), d = im.data, r = kit.rng(77);
    for (let i = 0; i < 128 * 128; i++) { const v = 128 + (r() - .5) * 120; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0); return c; })();

  // ---------------------------------------------------------------- palette: dusk family, muted city tones
  const P = {
    asphalt: '#2a2b49', walk: '#3a3a5c', curb: 'rgba(200,196,226,.2)', lot: '#33334f', garden: '#3c4a50', grass: '#465a52',
    tree: '#5d7a6c', treeHi: '#9db8a0', rubble: '#67607e', slab: '#aaa4be', mark: 'rgba(220,228,238,.11)',
  };
  const ROOFS = ['#c4b0b6', '#cdbcae', '#a9a5c2', '#b6bccd', '#9f9bb6', '#c6b7c3', '#b3a6b8', '#d1c3bb', '#a8b1c4'];
  const RUB = ['#8e88a3', '#a6a0b8', '#7a7494', '#b8b1c6', '#ad8580', '#be9790', '#6c6787', '#cbc0c6'];
  const CARS = ['#b9a7c4', '#8f8cc4', '#c7a8a6', '#d3c9d6', '#6f72a0', '#a6b3c9', '#c9b6a0', '#9c9ab2'];
  const LETTERS = 'ABCDEFGH';

  // ---------------------------------------------------------------- the district
  const sxOf = (i) => i * PX + SW / 2, syOf = (j) => j * PY + SW / 2;     // street centrelines
  function lotBuildings(bi, bj, r, two = true) {                         // 1 or 2 apartment blocks on a lot
    const rf = (a, b) => a + r() * (b - a);
    const x0 = bi * PX + SW + 3, y0 = bj * PY + SW + 3, lw = BW - 6, lh = BH - 6, out = [];
    if (r() < .34 && two) {
      const g = rf(4, 7), w1 = rf(20, 27), w2 = Math.min(lw - g - w1 - rf(1, 4), rf(18, 26)), h1 = rf(24, lh - 5), h2 = rf(22, lh - 5);
      const xa = x0 + rf(1, 3);
      out.push({ x: xa, y: y0 + rf(1, lh - h1 - 1), w: w1, h: h1 }, { x: xa + w1 + g, y: y0 + rf(1, lh - h2 - 1), w: w2, h: h2 });
    } else {
      const w = rf(30, lw - 9), h = rf(23, lh - 9);
      out.push({ x: x0 + rf(2, lw - w - 2), y: y0 + rf(2, lh - h - 2), w, h });
    }
    for (const b of out) { b.floors = 4 + Math.floor(r() * 6); b.col = ROOFS[Math.floor(r() * ROOFS.length)]; b.cx = b.x + b.w / 2; b.cy = b.y + b.h / 2; b.dmg = r() < .5; b.seed = Math.floor(r() * 1e9); b.bi = bi; b.bj = bj; }
    return out;
  }
  function makeSpill(b, r, fall, spillD) {                               // rubble outline: footprint + spill toward the fall side
    const NS = 64, p = new Float32Array(NS * 2), hw = b.w / 2, hh = b.h / 2, thF = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][fall], sd = r() * 100;
    const th2 = thF + (r() < .5 ? -1 : 1) * Math.PI / 2, sp2 = spillD * (.2 + r() * .3);
    for (let k = 0; k < NS; k++) {
      const th = k / NS * TAU, c = Math.cos(th), s = Math.sin(th);
      const rr = Math.min(Math.abs(c) > 1e-6 ? hw / Math.abs(c) : 1e9, Math.abs(s) > 1e-6 ? hh / Math.abs(s) : 1e9);
      const ex = .8 + 3.4 * fbm(c * 1.7 + sd, s * 1.7 + sd, 11, 3) + spillD * Math.pow(Math.max(0, Math.cos(th - thF)), 3) + sp2 * Math.pow(Math.max(0, Math.cos(th - th2)), 4);
      p[k * 2] = b.cx + c * (rr + ex); p[k * 2 + 1] = b.cy + s * (rr + ex);
    }
    return p;
  }

  let M = null;
  function genMission(seed, NX, side) {
    const r = kit.rng(seed), rf = (a, b) => a + r() * (b - a), ri = (a, b) => a + Math.floor(r() * (b - a + 1));
    const NY = 3, WD = NX * PX + SW, HD = NY * PY + SW, NN = (NX + 1) * (NY + 1);
    const m = { seed, NX, NY, WD, HD, NN, blds: [], coll: [], piles: [], park: ri(0, NX * NY - 1),
      hB: new Uint8Array((NX) * (NY + 1)), vB: new Uint8Array((NX + 1) * NY) };
    const maxB = NX * NY > 9 ? 14 : 11;                                   // 8 to 14 buildings
    for (let k = 0, left = NX * NY - 1; k < NX * NY; k++) { if (k === m.park) continue; left--; for (const b of lotBuildings(k % NX, (k / NX) | 0, r, m.blds.length + 2 + left <= maxB)) m.blds.push(b); }
    // staging: the outer street away from the card (right on desktop, left on a phone)
    const sj = ri(1, NY - 1); m.stN = sj * (NX + 1) + (side === 'right' ? NX : 0);
    m.stX = sxOf(m.stN % (NX + 1)); m.stY = syOf(sj);
    // choose the collapsed ones, spread out
    const nC = NX >= 4 ? 6 : 5, order = m.blds.map((_, i) => i).sort(() => r() - .5), pick = [];
    for (const minD of [55, 40, 0]) for (const i of order) {
      if (pick.length >= nC || pick.includes(i)) continue;
      const b = m.blds[i]; if (dist(b.cx, b.cy, m.stX, m.stY) < 30) continue;
      if (pick.every((j) => dist(m.blds[j].cx, m.blds[j].cy, b.cx, b.cy) >= minD)) pick.push(i);
    }
    pick.sort((a, b) => (m.blds[a].cy - m.blds[b].cy) || (m.blds[a].cx - m.blds[b].cx));
    const segOf = (b, side4) => {                                        // the street segment next to one side of a block
      if (side4 === 0) return { t: 'h', i: b.bi, j: b.bj }; if (side4 === 2) return { t: 'h', i: b.bi, j: b.bj + 1 };
      if (side4 === 3) return { t: 'v', i: b.bi, j: b.bj }; return { t: 'v', i: b.bi + 1, j: b.bj };
    };
    const segIdx = (sg) => sg.t === 'h' ? sg.j * NX + sg.i : sg.j * (NX + 1) + sg.i;
    const blocked = (sg) => (sg.t === 'h' ? m.hB : m.vB)[segIdx(sg)];
    const setBlk = (sg, v) => { (sg.t === 'h' ? m.hB : m.vB)[segIdx(sg)] = v; };
    pick.forEach((i, k) => {
      const b = m.blds[i]; b.col_ = true; b.letter = LETTERS[k]; m.coll.push(b);
      const bx0 = b.bi * PX + SW, by0 = b.bj * PY + SW;
      b.gap = [b.y - by0, bx0 + BW - (b.x + b.w), by0 + BH - (b.y + b.h), b.x - bx0];
      b.fall = ri(0, 3); b.spillD = rf(9, 15); b.spill = makeSpill(b, r, b.fall, b.spillD);
      if (b.spillD + 2 - b.gap[b.fall] > 5) { const sg = segOf(b, b.fall); setBlk(sg, 1); b.blocks = sg; }
    });
    // facade chunks in one or two more streets
    for (let n = ri(1, 2), t = 0; n > 0 && t < 20; t++) {
      const sg = r() < .5 ? { t: 'h', i: ri(0, NX - 1), j: ri(0, NY) } : { t: 'v', i: ri(0, NX), j: ri(0, NY - 1) };
      if (blocked(sg)) continue;
      const along = rf(.3, .7), x = sg.t === 'h' ? sg.i * PX + SW + along * BW : sxOf(sg.i), y = sg.t === 'h' ? syOf(sg.j) : sg.j * PY + SW + along * BH;
      if (dist(x, y, m.stX, m.stY) < 40) continue;
      setBlk(sg, 2); m.piles.push({ x, y, r: rf(4.5, 6.5), sg, seed: Math.floor(r() * 1e9) }); n--;
    }
    // each collapsed building gets an entry on a side whose street is open, a park spot for a UGV, pockets, crawl paths
    for (const b of m.coll) {
      let sides = [0, 1, 2, 3].filter((s) => s !== b.fall && !blocked(segOf(b, s)));
      if (!sides.length) { const s = [0, 1, 2, 3].filter((q) => q !== b.fall)[ri(0, 2)]; setBlk(segOf(b, s), 0); m.piles = m.piles.filter((p) => segIdx(p.sg) !== segIdx(segOf(b, s)) || p.sg.t !== segOf(b, s).t); sides = [s]; }
      sides.sort((a, c) => b.gap[a] - b.gap[c]);
      const es = sides[r() < .7 ? 0 : ri(0, sides.length - 1)], t = rf(.3, .7), sg = segOf(b, es);
      let ex, ey, px, py;
      if (es === 0 || es === 2) { ex = b.x + t * b.w; ey = es === 0 ? b.y : b.y + b.h; px = clamp(ex, sg.i * PX + SW + 4, sg.i * PX + SW + BW - 4); py = syOf(sg.j) + (es === 0 ? 2.6 : -2.6); }
      else { ey = b.y + t * b.h; ex = es === 3 ? b.x : b.x + b.w; py = clamp(ey, sg.j * PY + SW + 4, sg.j * PY + SW + BH - 4); px = sxOf(sg.i) + (es === 3 ? 2.6 : -2.6); }
      const nrm = [[0, -1], [1, 0], [0, 1], [-1, 0]][es];
      b.es = es; b.seg = { ...sg, a: sg.t === 'h' ? sg.j * (NX + 1) + sg.i : sg.j * (NX + 1) + sg.i, b: sg.t === 'h' ? sg.j * (NX + 1) + sg.i + 1 : (sg.j + 1) * (NX + 1) + sg.i };
      b.park = { x: px, y: py }; b.door = { x: ex + nrm[0] * 4.5, y: ey + nrm[1] * 4.5 };    // where drones dive in
      const nodes = [{ x: ex - nrm[0] * 1.5, y: ey - nrm[1] * 1.5 }], K = ri(3, 5);
      for (let tr = 0; tr < 400 && nodes.length < K + 1; tr++) {
        const x = b.x + 3.2 + r() * (b.w - 6.4), y = b.y + 3.2 + r() * (b.h - 6.4);
        if (nodes.every((q, qi) => dist(q.x, q.y, x, y) > (qi ? 7 : 6))) nodes.push({ x, y });
      }
      const n = nodes.length, inT = new Uint8Array(n), par = new Int8Array(n).fill(-1), best = new Float32Array(n), from = new Int8Array(n);
      inT[0] = 1; for (let i = 1; i < n; i++) best[i] = dist(nodes[0].x, nodes[0].y, nodes[i].x, nodes[i].y);
      for (let it = 1; it < n; it++) {                                     // crawl paths: a minimum spanning tree from the entry
        let k = -1, bd = 1e9; for (let i = 1; i < n; i++) if (!inT[i] && best[i] < bd) { bd = best[i]; k = i; }
        inT[k] = 1; par[k] = from[k];
        for (let i = 1; i < n; i++) if (!inT[i]) { const d = dist(nodes[k].x, nodes[k].y, nodes[i].x, nodes[i].y); if (d < best[i]) { best[i] = d; from[i] = k; } }
      }
      b.nodes = nodes; b.par = par; b.edges = [null];
      for (let i = 1; i < n; i++) {
        const a = nodes[par[i]], c = nodes[i], dx = c.x - a.x, dy = c.y - a.y, L0 = Math.hypot(dx, dy), nx = -dy / L0, ny = dx / L0;
        const j1 = rf(-1.6, 1.6), j2 = rf(-1.6, 1.6), pts = [a.x, a.y, a.x + dx * .34 + nx * j1, a.y + dy * .34 + ny * j1, a.x + dx * .68 + nx * j2, a.y + dy * .68 + ny * j2, c.x, c.y];
        let len = 0; for (let k = 2; k < pts.length; k += 2) len += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
        b.edges.push({ pts, len, st: 0 });
      }
      b.pk = [];
      for (let i = 1; i < n; i++) {
        const rr = rf(1.7, 2.9), sh = new Float32Array(18); for (let k = 0; k < 9; k++) { const a = k / 9 * TAU, q = rr * rf(.7, 1.15); sh[k * 2] = Math.cos(a) * q * 1.15; sh[k * 2 + 1] = Math.sin(a) * q * .9; }
        b.pk.push({ node: i, x: nodes[i].x, y: nodes[i].y, sh, people: 0, st: 0, by: -1, claim: -1, found: 0 });
      }
      b.entered = false; b.cleared = false; b.ugv = -1; b.dust = [rf(0, 40), rf(0, 40), rf(0, 40)];
    }
    // survivors: 3 to 6 people in voids
    const all = []; for (const b of m.coll) for (const p of b.pk) all.push(p);
    all.sort(() => r() - .5);
    let want = ri(3, 6);
    for (const p of all) { if (want <= 0) break; const k = Math.min(want, r() < .35 ? 2 : 1); p.people = k; want -= k; }
    m.peopleTotal = all.reduce((a, p) => a + p.people, 0);
    // every park spot must be reachable from staging: reopen piles, then rubble streets, until it is
    for (let guard = 0; guard < 30; guard++) {
      const D = dijkstra(m, m.stN, true).d;
      const bad = m.coll.find((b) => D[b.seg.a] > 1e8 && D[b.seg.b] > 1e8);
      if (!bad) break;
      const pi = m.piles.findIndex(() => true);
      if (pi >= 0) { setBlk(m.piles[pi].sg, 0); m.piles.splice(pi, 1); continue; }
      const cb = m.coll.find((b) => b.blocks && blocked(b.blocks)); if (cb) { setBlk(cb.blocks, 0); cb.spillD = Math.min(cb.spillD, cb.gap[cb.fall] + 2); cb.spill = makeSpill(cb, r, cb.fall, cb.spillD); cb.blocks = null; }
    }
    return m;
  }
  // street graph: nodes are crossings, edges are street segments (blocked by rubble or not)
  const nodeXY = (m, n) => [sxOf(n % (m.NX + 1)), syOf((n / (m.NX + 1)) | 0)];
  function nbrs(m, n, useB, out) {
    const NX = m.NX, i = n % (NX + 1), j = (n / (NX + 1)) | 0; out.length = 0;
    if (i < NX && !(useB && m.hB[j * NX + i])) out.push(n + 1, PX);
    if (i > 0 && !(useB && m.hB[j * NX + i - 1])) out.push(n - 1, PX);
    if (j < m.NY && !(useB && m.vB[j * (NX + 1) + i])) out.push(n + NX + 1, PY);
    if (j > 0 && !(useB && m.vB[(j - 1) * (NX + 1) + i])) out.push(n - NX - 1, PY);
    return out;
  }
  const NB = [];
  function dijkstra(m, src, useB) {
    const d = new Float64Array(m.NN).fill(1e9), pv = new Int16Array(m.NN).fill(-1), done = new Uint8Array(m.NN); d[src] = 0;
    for (;;) {
      let u = -1, bd = 1e9; for (let i = 0; i < m.NN; i++) if (!done[i] && d[i] < bd) { bd = d[i]; u = i; }
      if (u < 0) break; done[u] = 1;
      nbrs(m, u, useB, NB); for (let k = 0; k < NB.length; k += 2) { const v = NB[k], w = d[u] + NB[k + 1]; if (w < d[v]) { d[v] = w; pv[v] = u; } }
    }
    return { d, pv };
  }

  // ---------------------------------------------------------------- layout and the pre-rendered terrain
  let L = null, terr = null, gen = 0;
  function frame() {
    const W = cv.w, H = cv.h, phone = W < 640, left = phone ? 0 : (parseFloat(stage.dataset.left) || 0);
    const ax0 = left > 0 ? left * W + 20 : 16, ax1 = Math.max(ax0 + 120, W - (phone ? 16 : 24)), ay0 = phone ? 116 : 128, ay1 = Math.max(ay0 + 120, H - (phone ? 56 : 48));
    return { W, H, phone, left, ax0, ax1, ay0, ay1 };
  }
  function layout() {
    const f = frame(), s = Math.max(.3, Math.min((f.ax1 - f.ax0) / M.WD, (f.ay1 - f.ay0) / M.HD));
    L = { ...f, s, ox: f.ax0 + ((f.ax1 - f.ax0) - M.WD * s) / 2, oy: f.ay0 + ((f.ay1 - f.ay0) - M.HD * s) / 2, dpr: cv.dpr };
    renderTerrain(); notes.forEach((n) => { n.placed = false; });
    // β₀ bubbles: placed once per layout (above the building, or below when that collides), so callouts can avoid them
    const fsB = L.phone ? 10.5 : 11.5, placed = [[0, 0, L.W, L.phone ? 116 : 122]];
    ctx.font = `400 ${fsB}px ${F.sans}`; const wl = L.phone ? 0 : ctx.measureText('unsearched pockets').width;
    for (const b of M.coll) {
      const bw = L.phone ? 40 : 18 + 6 + wl + 6 + 10 + 10, bh = L.phone ? 22 : 34, cx = clamp(X(b.cx) - bw / 2, L.ax0, L.ax1 - bw);
      const up = Y(b.y - b.floors * .3) - bh - 8, dn = Y(b.y + b.h) + 8;
      const hit = (y) => placed.some((o) => cx < o[0] + o[2] && o[0] < cx + bw && y < o[1] + o[3] && o[1] < y + bh);
      const below = hit(up) && !hit(dn); b.bub = { x: cx, y: below ? dn : up, w: bw, h: bh, below }; placed.push([cx, b.bub.y, bw, bh]);
    }
  }
  const X = (x) => L.ox + x * L.s, Y = (y) => L.oy + y * L.s;

  function polyPath(g, p, close = true) { g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); if (close) g.closePath(); }
  function rubble(g, poly, cx, cy, rad, r, scale, spacing) {         // a scatter of broken concrete and brick, batched by colour
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < poly.length; i += 2) { x0 = Math.min(x0, poly[i]); x1 = Math.max(x1, poly[i]); y0 = Math.min(y0, poly[i + 1]); y1 = Math.max(y1, poly[i + 1]); }
    const paths = RUB.map(() => new Path2D()), dark = new Path2D(), sh = new Path2D();
    for (let y = y0; y < y1; y += spacing) for (let x = x0; x < x1; x += spacing) {
      const px = x + (r() - .5) * spacing, py = y + (r() - .5) * spacing; if (!inPoly(poly, px, py)) continue;
      const hgt = clamp(1 - dist(px, py, cx, cy) / rad, 0, 1), sz = scale * (.32 + r() * .75) * (.65 + .6 * hgt), nv = 4 + ((r() * 3) | 0), rot = r() * TAU;
      let ci = r() < .2 ? 4 + ((r() * 2) | 0) : (hgt > .55 ? (r() < .5 ? 3 : 1) : hgt > .25 ? (r() < .5 ? 0 : 1) : (r() < .5 ? 2 : 6));
      if (r() < .05) ci = 7;
      const tgt = r() < .09 ? dark : paths[ci];
      for (let k = 0; k < nv; k++) {
        const a = rot + k / nv * TAU, q = sz * (.6 + r() * .5), vx = px + Math.cos(a) * q, vy = py + Math.sin(a) * q * .8;
        if (k) { tgt.lineTo(vx, vy); sh.lineTo(vx + .28, vy + .36); } else { tgt.moveTo(vx, vy); sh.moveTo(vx + .28, vy + .36); }
      }
      tgt.closePath(); sh.closePath();
    }
    g.fillStyle = 'rgba(16,17,40,.55)'; g.fill(sh);
    paths.forEach((p, i) => { g.fillStyle = RUB[i]; g.fill(p); });
    g.fillStyle = 'rgba(22,22,46,.8)'; g.fill(dark);
  }
  function drawCollapsed(g, b, full) {
    const r = kit.rng(b.seed ^ 0x5bd1e995);
    const rf = (a, c) => a + r() * (c - a);
    g.save();
    g.fillStyle = 'rgba(14,15,36,.42)'; g.beginPath(); g.save(); g.translate(1.2, 1.6); polyPath(g, b.spill); g.restore(); g.fill();
    g.fillStyle = P.rubble; g.beginPath(); polyPath(g, b.spill); g.fill();
    g.save(); g.beginPath(); polyPath(g, b.spill); g.clip();
    g.globalAlpha = .1; g.fillStyle = 'rgba(243,238,242,1)'; g.beginPath(); polyPath(g, b.spill); g.lineWidth = 2.5; g.strokeStyle = 'rgba(214,200,206,.5)'; g.stroke(); g.globalAlpha = 1;
    rubble(g, b.spill, b.cx, b.cy, Math.max(b.w, b.h) * .5 + b.spillD * .6, r, 1, 1.15);
    // fallen facade lying in the spill, windows still in it
    const thF = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][b.fall], along = b.fall % 2 === 0 ? b.w : b.h, half = (b.fall % 2 === 0 ? b.h : b.w) / 2;
    const fl = along * rf(.45, .7), fd = rf(3.6, 5.2), fx = b.cx + Math.cos(thF) * (half + fd * .5 + rf(.5, 2.5)), fy = b.cy + Math.sin(thF) * (half + fd * .5 + rf(.5, 2.5));
    g.save(); g.translate(fx + rf(-4, 4) * Math.abs(Math.sin(thF)), fy + rf(-4, 4) * Math.abs(Math.cos(thF))); g.rotate(thF + Math.PI / 2 + rf(-.14, .14));
    g.fillStyle = 'rgba(14,15,36,.45)'; g.fillRect(-fl / 2 + .5, -fd / 2 + .7, fl, fd);
    g.fillStyle = shade(b.col, -.18); g.fillRect(-fl / 2, -fd / 2, fl, fd);
    g.fillStyle = 'rgba(30,30,58,.75)'; for (let wx = -fl / 2 + 1; wx < fl / 2 - 1.4; wx += 2.7) for (let wy = -fd / 2 + .7; wy < fd / 2 - .8; wy += 1.7) if (r() < .85) g.fillRect(wx, wy, 1.3, .9);
    g.strokeStyle = 'rgba(30,30,58,.6)'; g.lineWidth = .18; g.beginPath(); g.moveTo(-fl / 2 + rf(0, fl), -fd / 2); g.lineTo(rf(-fl / 2, fl / 2), fd / 2); g.stroke();
    g.restore();
    // pancaked floor slabs over the footprint, some missing
    const nx = b.w > 30 ? 3 : 2, ny = 2;
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
      if (r() < .22) continue;
      const cw = b.w / nx, ch = b.h / ny, cx = b.x + (ix + .5) * cw + rf(-1.5, 1.5), cy = b.y + (iy + .5) * ch + rf(-1.5, 1.5), a = rf(-.22, .22), sw = cw * rf(.62, .92), shh = ch * rf(.6, .9);
      const q = []; for (const [ux, uy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) q.push(ux * sw / 2 + rf(-.9, .9), uy * shh / 2 + rf(-.9, .9));
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.fillStyle = 'rgba(14,15,36,.5)'; g.beginPath(); g.save(); g.translate(.8, 1.1); polyPath(g, q); g.restore(); g.fill();
      const lum = rf(-.12, .06); g.fillStyle = shade(P.slab, lum); g.beginPath(); polyPath(g, q); g.fill();
      if (r() < .45) { g.fillStyle = shade(b.col, -.05, .55); g.beginPath(); polyPath(g, q); g.fill(); }   // roof membrane still on top
      g.strokeStyle = 'rgba(243,238,242,.22)'; g.lineWidth = .25; g.beginPath(); g.moveTo(q[6], q[7]); g.lineTo(q[0], q[1]); g.lineTo(q[2], q[3]); g.stroke();
      g.strokeStyle = 'rgba(28,28,56,.55)'; g.lineWidth = .3; g.beginPath(); g.moveTo(q[2], q[3]); g.lineTo(q[4], q[5]); g.lineTo(q[6], q[7]); g.stroke();
      g.lineWidth = .16; g.strokeStyle = 'rgba(28,28,56,.6)'; g.beginPath();
      for (let k = 0; k < 3; k++) { let px = rf(-sw / 2, sw / 2), py = rf(-shh / 2, shh / 2); g.moveTo(px, py); for (let s = 0; s < 4; s++) { px += rf(-1.8, 1.8); py += rf(-1.8, 1.8); g.lineTo(px, py); } }
      g.stroke();
      g.strokeStyle = 'rgba(64,62,98,.95)'; g.lineWidth = .14; g.beginPath();
      for (let k = 0; k < 5; k++) { const e = (r() * 4) | 0, t = r(), x1 = q[e * 2] + (q[((e + 1) % 4) * 2] - q[e * 2]) * t, y1 = q[e * 2 + 1] + (q[((e + 1) % 4) * 2 + 1] - q[e * 2 + 1]) * t, aa = r() * TAU; g.moveTo(x1, y1); g.lineTo(x1 + Math.cos(aa) * rf(.8, 1.8), y1 + Math.sin(aa) * rf(.8, 1.8)); }
      g.stroke();
      if (r() < .5) { const tx = rf(-sw / 3, sw / 3), ty = rf(-shh / 3, shh / 3); g.fillStyle = 'rgba(14,15,36,.4)'; g.beginPath(); g.ellipse(tx + .3, ty + .4, 1.1, .7, rf(0, 3), 0, TAU); g.fill(); g.fillStyle = '#cfcadb'; g.beginPath(); g.ellipse(tx, ty, 1.1, .7, rf(0, 3), 0, TAU); g.fill(); }
      g.restore();
    }
    g.restore();
    if (full) { g.fillStyle = 'rgba(16,16,36,.85)'; g.beginPath(); g.ellipse(b.nodes[0].x, b.nodes[0].y, 1.5, 1.1, 0, 0, TAU); g.fill(); }
    g.restore();
  }
  function drawStanding(g, b) {
    const r = kit.rng(b.seed), rf = (a, c) => a + r() * (c - a), ri = (a, c) => a + Math.floor(r() * (c - a + 1));
    const e = b.floors * 3 * .085, { x, y, w, h } = b, ry = y - e;
    g.fillStyle = shade(b.col, -.42); g.fillRect(x, y + h - e, w, e);                      // the south face, seen slightly from the side
    g.fillStyle = 'rgba(28,30,62,.6)'; for (let wx = x + 1.1; wx < x + w - 1.5; wx += 2.5) g.fillRect(wx, y + h - e * .78, 1.15, e * .46);
    g.fillStyle = b.col; g.fillRect(x, ry, w, h);
    g.globalAlpha = .08; g.fillStyle = g.createPattern(GRAIN, 'repeat'); g.fillRect(x, ry, w, h); g.globalAlpha = 1;
    g.strokeStyle = 'rgba(28,30,62,.3)'; g.lineWidth = .35; g.strokeRect(x + .8, ry + .8, w - 1.6, h - 1.6);
    g.strokeStyle = 'rgba(243,238,242,.28)'; g.lineWidth = .3; g.beginPath(); g.moveTo(x + .15, ry + h); g.lineTo(x + .15, ry + .15); g.lineTo(x + w, ry + .15); g.stroke();
    g.strokeStyle = 'rgba(22,24,52,.35)'; g.beginPath(); g.moveTo(x + w - .15, ry); g.lineTo(x + w - .15, ry + h - .15); g.lineTo(x, ry + h - .15); g.stroke();
    // stair housing, water tanks, solar water heaters, small units
    const hw = rf(3, 4.6), hh = rf(3.2, 5), hx = x + rf(2, w - hw - 2), hy = ry + rf(2, h - hh - 2);
    g.fillStyle = 'rgba(16,18,42,.32)'; g.fillRect(hx + .7, hy + .9, hw, hh); g.fillStyle = shade(b.col, .12); g.fillRect(hx, hy, hw, hh);
    g.strokeStyle = 'rgba(243,238,242,.25)'; g.lineWidth = .2; g.strokeRect(hx + .1, hy + .1, hw - .2, hh - .2);
    const nT = ri(2, 6), tx0 = x + rf(2, w * .5), ty0 = ry + rf(2, h - 4);
    for (let k = 0; k < nT; k++) {
      const cx = clamp(tx0 + (k % 3) * 1.7, x + 1.2, x + w - 1.2), cy = clamp(ty0 + ((k / 3) | 0) * 1.7, ry + 1.2, ry + h - 1.2);
      g.fillStyle = 'rgba(16,18,42,.35)'; g.beginPath(); g.arc(cx + .35, cy + .45, .7, 0, TAU); g.fill();
      g.fillStyle = '#d6d2e0'; g.beginPath(); g.arc(cx, cy, .7, 0, TAU); g.fill();
      g.fillStyle = 'rgba(30,32,64,.25)'; g.beginPath(); g.arc(cx, cy, .35, 0, TAU); g.fill();
    }
    const nS = ri(0, 4), sx0 = x + rf(2, w - 9), sy0 = ry + rf(2, h - 4);
    for (let k = 0; k < nS; k++) { const px = sx0 + k * 2.3; if (px + 2 > x + w - 1) break; g.fillStyle = '#3e4a7c'; g.fillRect(px, sy0, 2, 1.1); g.strokeStyle = 'rgba(220,228,238,.45)'; g.lineWidth = .14; g.strokeRect(px, sy0, 2, 1.1); }
    for (let k = ri(1, 4); k > 0; k--) { const px = x + rf(1.5, w - 2.5), py = ry + rf(1.5, h - 2.5); g.fillStyle = 'rgba(220,214,236,.5)'; g.fillRect(px, py, .9, .7); }
    if (b.dmg) {                                                          // cracks across damaged roofs
      g.strokeStyle = 'rgba(26,26,54,.55)'; g.lineWidth = .22; g.beginPath();
      for (let k = ri(1, 3); k > 0; k--) { let px = x + rf(0, w), py = r() < .5 ? ry : ry + rf(0, h); g.moveTo(px, py); for (let s = 0; s < 7; s++) { px += rf(-1.5, 3); py += rf(.4, 2.6); if (px > x + w || py > ry + h) break; g.lineTo(px, py); } }
      g.stroke();
    }
  }
  function blockArt(g, bi, bj, blds, isPark, r, cars, trees) {
    const x0 = bi * PX + SW, y0 = bj * PY + SW, rf = (a, c) => a + r() * (c - a);
    g.fillStyle = P.walk; roundRect(g, x0, y0, BW, BH, 2.5); g.fill();
    g.strokeStyle = P.curb; g.lineWidth = .35; roundRect(g, x0 + .2, y0 + .2, BW - .4, BH - .4, 2.4); g.stroke();
    g.fillStyle = isPark ? P.grass : P.lot; roundRect(g, x0 + 3, y0 + 3, BW - 6, BH - 6, 1.5); g.fill();
    if (isPark) {
      g.strokeStyle = 'rgba(214,206,214,.28)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x0 + 3, y0 + BH * .3); g.quadraticCurveTo(x0 + BW * .5, y0 + BH * .7, x0 + BW - 3, y0 + BH * .55); g.moveTo(x0 + BW * .45, y0 + 3); g.quadraticCurveTo(x0 + BW * .55, y0 + BH * .5, x0 + BW * .4, y0 + BH - 3); g.stroke();
      const fx = x0 + BW * .5, fy = y0 + BH * .52; g.fillStyle = 'rgba(200,196,214,.4)'; g.beginPath(); g.arc(fx, fy, 4.4, 0, TAU); g.fill(); g.fillStyle = '#5E7FB0'; g.beginPath(); g.arc(fx, fy, 3.4, 0, TAU); g.fill(); g.fillStyle = 'rgba(143,183,208,.5)'; g.beginPath(); g.arc(fx - .8, fy - .8, 1.6, 0, TAU); g.fill();
      for (let k = 0; k < 26; k++) { const tx = x0 + rf(5, BW - 5), ty = y0 + rf(5, BH - 5); if (dist(tx, ty, fx, fy) < 7) continue; trees.push(tx, ty, rf(2, 3.6)); }
      return;
    }
    for (let k = 0; k < 3; k++) { g.fillStyle = 'rgba(52,69,89,.7)'; g.beginPath(); g.ellipse(x0 + rf(8, BW - 8), y0 + rf(8, BH - 8), rf(4, 9), rf(3, 7), rf(0, 3), 0, TAU); g.fill(); }
    for (let k = 0; k < 14; k++) {
      const tx = x0 + rf(4.5, BW - 4.5), ty = y0 + rf(4.5, BH - 4.5);
      if (blds.some((b) => tx > b.x - 2.6 && tx < b.x + b.w + 2.6 && ty > b.y - 2.6 - b.floors * .26 && ty < b.y + b.h + 2.6)) continue;
      trees.push(tx, ty, rf(1.7, 3));
    }
    // parked cars along the curbs, in the street
    for (let side = 0; side < 4; side++) {
      const horiz = side % 2 === 0, len = horiz ? BW : BH;
      for (let t = 4; t < len - 5; t += 6.2) {
        if (r() < .42) continue;
        const along = t + rf(-.6, .6), cx = horiz ? x0 + along : (side === 1 ? x0 + BW + 1.6 : x0 - 1.6), cy = horiz ? (side === 0 ? y0 - 1.6 : y0 + BH + 1.6) : y0 + along;
        cars.push(cx, cy, horiz ? 0 : 1, (r() * CARS.length) | 0, rf(-.06, .06));
      }
    }
  }
  function drawCars(g, cars) {
    for (let k = 0; k < cars.length; k += 5) {
      const cx = cars[k], cy = cars[k + 1], v = cars[k + 2], col = CARS[cars[k + 3]], a = cars[k + 4] + (v ? Math.PI / 2 : 0);
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.fillStyle = 'rgba(12,13,32,.45)'; roundRect(g, -2.1, -.8, 4.5, 1.95, .55); g.fill();
      g.fillStyle = col; roundRect(g, -2.25, -.95, 4.5, 1.9, .55); g.fill();
      g.fillStyle = 'rgba(32,34,66,.7)'; g.fillRect(.55, -.75, .9, 1.5); g.fillRect(-1.6, -.72, .6, 1.44);
      g.restore();
    }
  }
  function drawTrees(g, t) {
    const sh = new Path2D(), cr = new Path2D(), hi = new Path2D();
    for (let k = 0; k < t.length; k += 3) { const x = t[k], y = t[k + 1], r = t[k + 2]; sh.moveTo(x + r * .5 + r, y + r * .6); sh.arc(x + r * .5, y + r * .6, r, 0, TAU); cr.moveTo(x + r, y); cr.arc(x, y, r, 0, TAU); hi.moveTo(x - r * .28 + r * .5, y - r * .3); hi.arc(x - r * .28, y - r * .3, r * .5, 0, TAU); }
    g.fillStyle = 'rgba(12,13,32,.42)'; g.fill(sh); g.fillStyle = P.tree; g.fill(cr); g.globalAlpha = .55; g.fillStyle = P.treeHi; g.fill(hi); g.globalAlpha = 1;
  }
  function shadowOf(g, b) {
    const k = b.floors * 3, dx = k * .22, dy = k * .3, e = k * .085;
    g.moveTo(b.x, b.y - e); g.lineTo(b.x + b.w, b.y - e); g.lineTo(b.x + b.w + dx, b.y - e + dy); g.lineTo(b.x + b.w + dx, b.y + b.h + dy); g.lineTo(b.x + dx, b.y + b.h + dy); g.lineTo(b.x, b.y + b.h); g.closePath();
  }
  function renderTerrain() {
    const { W, H, s, ox, oy } = L, dpr = cv.dpr;
    if (!terr) terr = mk(1, 1);
    terr.width = Math.round(W * dpr); terr.height = Math.round(H * dpr);
    const g = terr.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = P.asphalt; g.fillRect(0, 0, W, H);
    g.globalAlpha = .07; g.globalCompositeOperation = 'overlay'; g.fillStyle = g.createPattern(GRAIN, 'repeat'); g.fillRect(0, 0, W, H); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    const wx0 = -ox / s, wx1 = (W - ox) / s, wy0 = -oy / s, wy1 = (H - oy) / s;
    const i0 = Math.floor(wx0 / PX) - 1, i1 = Math.ceil(wx1 / PX) + 1, j0 = Math.floor(wy0 / PY) - 1, j1 = Math.ceil(wy1 / PY) + 1;
    // asphalt patches and road markings
    for (let k = 0; k < 60; k++) { const r = hash(k, 3, M.seed); g.fillStyle = `rgba(${r < .5 ? '48,51,92' : '32,34,68'},.35)`; g.beginPath(); g.ellipse(wx0 + hash(k, 1, M.seed) * (wx1 - wx0), wy0 + hash(k, 2, M.seed) * (wy1 - wy0), 4 + r * 10, 2 + r * 5, r * 3, 0, TAU); g.fill(); }
    g.strokeStyle = P.mark; g.lineWidth = .28; g.setLineDash([3, 3.5]); g.beginPath();
    for (let i = i0; i <= i1; i++) { g.moveTo(sxOf(i), wy0); g.lineTo(sxOf(i), wy1); }
    for (let j = j0; j <= j1; j++) { g.moveTo(wx0, syOf(j)); g.lineTo(wx1, syOf(j)); }
    g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(220,228,238,.09)';
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const cx = sxOf(i), cy = syOf(j);
      for (let k = -2; k <= 2; k++) { g.fillRect(cx + k * 1.6 - .35, cy - SW / 2 - 3.4, .7, 2.6); g.fillRect(cx + k * 1.6 - .35, cy + SW / 2 + .8, .7, 2.6); g.fillRect(cx - SW / 2 - 3.4, cy + k * 1.6 - .35, 2.6, .7); g.fillRect(cx + SW / 2 + .8, cy + k * 1.6 - .35, 2.6, .7); }
    }
    // blocks: inside the district from the mission, outside from a hash of the block index
    const cars = [], trees = [], std = [], col = [];
    for (let bj = j0; bj <= j1; bj++) for (let bi = i0; bi <= i1; bi++) {
      const inside = bi >= 0 && bj >= 0 && bi < M.NX && bj < M.NY;
      let blds, isPark = false, r;
      if (inside) { blds = M.blds.filter((b) => b.bi === bi && b.bj === bj); isPark = bj * M.NX + bi === M.park; r = kit.rng(hash(bi, bj, M.seed + 9) * 4294967296); }
      else {
        r = kit.rng(hash(bi, bj, M.seed) * 4294967296); isPark = r() < .07; blds = isPark ? [] : lotBuildings(bi, bj, r);
        for (const b of blds) if (r() < .28) { b.col_ = true; b.fall = (r() * 4) | 0; b.spillD = 5 + r() * 8; b.spill = makeSpill(b, r, b.fall, b.spillD); }
      }
      blockArt(g, bi, bj, blds, isPark, r, cars, trees);
      for (const b of blds) (b.col_ ? col : std).push(b);
    }
    drawCars(g, cars); drawTrees(g, trees);
    g.fillStyle = 'rgba(12,13,32,.46)'; g.beginPath(); for (const b of std) shadowOf(g, b); g.fill();
    for (const b of col) drawCollapsed(g, b, !!b.nodes);
    for (const p of M.piles) { const r = kit.rng(p.seed), poly = new Float32Array(40); for (let k = 0; k < 20; k++) { const a = k / 20 * TAU, q = p.r * (.7 + .5 * vnoise(Math.cos(a) * 2 + 5, Math.sin(a) * 2, p.seed & 255)); poly[k * 2] = p.x + Math.cos(a) * q * (p.sg.t === 'h' ? 1.3 : .8); poly[k * 2 + 1] = p.y + Math.sin(a) * q * (p.sg.t === 'h' ? .8 : 1.3); } g.fillStyle = P.rubble; g.beginPath(); polyPath(g, poly); g.fill(); rubble(g, poly, p.x, p.y, p.r, r, .9, 1.1); }
    for (const b of std) drawStanding(g, b);
    // the staging pad
    g.fillStyle = 'rgba(246,210,177,.1)'; roundRect(g, M.stX - 9, M.stY - 9, 18, 18, 2.5); g.fill();
    g.strokeStyle = 'rgba(246,210,177,.45)'; g.lineWidth = .35; g.setLineDash([1.4, 1.2]); roundRect(g, M.stX - 9, M.stY - 9, 18, 18, 2.5); g.stroke(); g.setLineDash([]);
    // outside the search area: desaturated and darker, feathered at the edge
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dx0 = ox, dy0 = oy, dw = M.WD * s, dh = M.HD * s;
    const outside = (pad) => { g.beginPath(); g.rect(0, 0, W, H); g.rect(dx0 - pad, dy0 - pad, dw + 2 * pad, dh + 2 * pad); };
    g.globalCompositeOperation = 'saturation'; g.fillStyle = 'rgba(128,128,128,.85)'; outside(0); g.fill('evenodd');
    g.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(22,23,50,${(k === 0 ? .58 : .05).toFixed(3)})`; outside(-k * 2.5); g.fill('evenodd'); }
    g.strokeStyle = 'rgba(220,214,236,.26)'; g.lineWidth = 1; g.setLineDash([5, 5]); g.strokeRect(dx0 - .5, dy0 - .5, dw + 1, dh + 1); g.setLineDash([]);
    // dusk light: warm from the upper left, darker corners
    const lg = g.createLinearGradient(0, 0, W, H); lg.addColorStop(0, 'rgba(246,210,177,.07)'); lg.addColorStop(.5, 'rgba(246,210,177,0)'); lg.addColorStop(1, 'rgba(18,20,48,.18)');
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(dx0 + dw / 2, dy0 + dh / 2, Math.min(W, H) * .35, dx0 + dw / 2, dy0 + dh / 2, Math.max(W, H) * .85);
    vg.addColorStop(0, 'rgba(14,15,34,0)'); vg.addColorStop(1, 'rgba(14,15,34,.5)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------- coverage (outdoor, 2 m cells) and the fog of war
  let GW = 1, GH = 1, NCELL = 1, cov = null, fresh = null, fogCv = null, fogX = null, fogIm = null, fogPx = null, satCv = null, satX = null, satIm = null, satPx = null;
  let CW = 1, CH = 1, NCC = 1, uC = null, lab = null, outComp = 0;
  const pack = (r, g, b, a) => ((Math.round(a) << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
  const LUT = new Uint32Array(32 * 16 * 2), LUTS = new Uint32Array(32);
  for (let q = 0; q < 32; q++) {
    const c = q / 31, sv = smooth(.03, .36, c), fa0 = .7 * (1 - sv);
    LUTS[q] = pack(128, 128, 128, 255 * .9 * (1 - sv));
    for (let f = 0; f < 16; f++) for (let hz = 0; hz < 2; hz++) {
      const fa = fa0 * (hz ? .8 : 1), ga = .17 * (f / 15) * Math.min(1, c * 1.5), a = ga + fa * (1 - ga);
      const mix = (t, u) => a > 0 ? (t * ga + u * fa * (1 - ga)) / a : 0;
      LUT[(q * 16 + f) * 2 + hz] = pack(mix(127, 22), mix(212, 23), mix(207, 50), 255 * a);
    }
  }
  function allocGrid() {
    GW = Math.ceil(M.WD / CELL); GH = Math.ceil(M.HD / CELL); NCELL = GW * GH;
    cov = new Float32Array(NCELL); fresh = new Float32Array(NCELL);
    fogCv = mk(GW, GH); fogX = fogCv.getContext('2d'); fogIm = fogX.createImageData(GW, GH); fogPx = new Uint32Array(fogIm.data.buffer);
    satCv = mk(GW, GH); satX = satCv.getContext('2d'); satIm = satX.createImageData(GW, GH); satPx = new Uint32Array(satIm.data.buffer);
    CW = Math.ceil(M.WD / CC); CH = Math.ceil(M.HD / CC); NCC = CW * CH; uC = new Float32Array(NCC); lab = new Int32Array(NCELL); if (QBUF.length < NCELL) QBUF = new Int32Array(NCELL);
  }
  function brush(x, y, R, fr) {
    const c0 = Math.max(0, Math.floor((x - R) / CELL)), c1 = Math.min(GW - 1, Math.floor((x + R) / CELL)), r0 = Math.max(0, Math.floor((y - R) / CELL)), r1 = Math.min(GH - 1, Math.floor((y + R) / CELL)), R2 = R * R;
    for (let j = r0; j <= r1; j++) { const dy = (j + .5) * CELL - y; for (let i = c0; i <= c1; i++) {
      const dx = (i + .5) * CELL - x, d2 = dx * dx + dy * dy; if (d2 >= R2) continue;
      const q = d2 / R2, w = 1 - q * q, k = j * GW + i; if (w > cov[k]) { if (fr && w > cov[k] + .015) fresh[k] = 1; cov[k] = w; }
    } }
  }
  // unsearched = coverage below the level where the fog has fully lifted, so the count and the picture agree
  const SEEN = .36;
  function coarse() {                                                     // unsearched fraction per 8 m cell, and β₀ outdoors
    const k = CC / CELL;
    for (let cj = 0; cj < CH; cj++) for (let ci = 0; ci < CW; ci++) {
      let n = 0, u = 0;
      for (let j = cj * k; j < Math.min(GH, cj * k + k); j++) for (let i = ci * k; i < Math.min(GW, ci * k + k); i++) { n++; if (cov[j * GW + i] < SEEN) u++; }
      uC[cj * CW + ci] = n ? u / n : 0;
    }
    // β₀ on the 2 m grid: 4-connected pieces of unsearched ground; specks under 12 m² are sensor noise, not regions
    lab.fill(-1); let comp = 0; const q = QBUF;
    for (let c = 0; c < NCELL; c++) {
      if (lab[c] !== -1 || cov[c] >= SEEN) continue;
      let qh = 0, qt = 0; q[qt++] = c; lab[c] = comp;
      while (qh < qt) { const v = q[qh++], vi = v % GW, vj = (v / GW) | 0;
        if (vi > 0 && lab[v - 1] === -1 && cov[v - 1] < SEEN) { lab[v - 1] = comp; q[qt++] = v - 1; }
        if (vi < GW - 1 && lab[v + 1] === -1 && cov[v + 1] < SEEN) { lab[v + 1] = comp; q[qt++] = v + 1; }
        if (vj > 0 && lab[v - GW] === -1 && cov[v - GW] < SEEN) { lab[v - GW] = comp; q[qt++] = v - GW; }
        if (vj < GH - 1 && lab[v + GW] === -1 && cov[v + GW] < SEEN) { lab[v + GW] = comp; q[qt++] = v + GW; }
      }
      if (qt >= 3) comp++;
    }
    outComp = comp;
  }
  let QBUF = new Int32Array(1);
  function paintFog(dtw, doSat) {
    const k = Math.exp(-dtw / .6);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const c = j * GW + i; let f = fresh[c]; if (f > .004) fresh[c] = f *= k; else f = fresh[c] = 0;
      const cq = (Math.min(1, cov[c]) * 31 + .5) | 0;
      fogPx[c] = LUT[(cq * 16 + ((f * 15 + .5) | 0)) * 2 + (((i + j) & 3) < 2 ? 1 : 0)];
      if (doSat) satPx[c] = LUTS[cq];
    }
    fogX.putImageData(fogIm, 0, 0); if (doSat) satX.putImageData(satIm, 0, 0);
  }

  // ---------------------------------------------------------------- agents
  const drones = [], ugvs = [];
  for (let i = 0; i < ND; i++) drones.push({ id: i, x: 0, y: 0, vx: 0, vy: 0, hd: 0, st: 'pad', tx: 0, ty: 0, b: null, pk: null, path: null, cum: null, ps: 0, node: 0, edges: null, dwell: 0, decide: 0, confT: 0, launch: 0, alt: 0, linked: true, inside: false, pend: [], exiting: false, trail: new Float32Array(20), tn: 0, th: 0, padX: 0, padY: 0, hx: 0, hy: 0 });
  for (let i = 0; i < NU; i++) ugvs.push({ id: i, x: 0, y: 0, hd: 0, st: 'pad', b: null, pts: null, cum: null, ps: 0, seg: null, node: 0, depart: 0, pulse: 0 });
  let simT = 0, wallT = 0, phase = 'run', phaseT = 0, seedN = 1, nFound = 0, nCleared = 0, endT = 0, cdT = 0, notesDone = {}, splitShown = false, fadeA = 1;

  function newMission(fresh0) {
    if (fresh0) seedN = (seedN * 7919 + 104729) % 1000003 + 1;
    const f = frame(), aspect = (f.ax1 - f.ax0) / (f.ay1 - f.ay0);
    M = genMission(seedN * 2654435761 >>> 0, !f.phone && aspect > 1.12 ? 4 : 3, f.phone || f.left === 0 ? 'left' : 'right');
    allocGrid(); layout();
    simT = 0; wallT = 0; phase = 'run'; phaseT = 0; nFound = 0; nCleared = 0; endT = 0; notes.length = 0; notesDone = {}; splitShown = false;
    brush(M.stX, M.stY, 16, false);
    drones.forEach((d, i) => {
      const gx = i % 6, gy = (i / 6) | 0; d.padX = M.stX - 7.5 + gx * 3; d.padY = M.stY - 4.5 + gy * 3;
      Object.assign(d, { x: d.padX, y: d.padY, vx: 0, vy: 0, hd: -Math.PI / 2, st: 'pad', b: null, pk: null, path: null, dwell: 0, decide: 0, alt: 0, linked: true, inside: false, exiting: false, tn: 0, th: 0, launch: (.25 + i * .16) * TL });
      d.pend.length = 0;
    });
    ugvs.forEach((u, i) => Object.assign(u, { x: M.stX + (i - 1) * 4.5, y: M.stY + 6.5, hd: 0, st: 'pad', b: null, pts: null, seg: null, node: M.stN, depart: (.6 + i * .9) * TL, pulse: 0 }));
    coarse(); paintFog(0, true);
    cdT = 0;
  }

  // ---------------------------------------------------------------- building helpers
  function route(b, a, c) {                                               // node a to node c through the crawl tree
    const up = []; for (let n = a; n >= 0; n = b.par[n]) up.push(n);
    let lca = c; while (!up.includes(lca)) lca = b.par[lca];
    const pts = [b.nodes[a].x, b.nodes[a].y], edges = [];
    for (let n = a; n !== lca; n = b.par[n]) { const e = b.edges[n]; edges.push(n); for (let k = e.pts.length - 4; k >= 0; k -= 2) pts.push(e.pts[k], e.pts[k + 1]); }
    const down = []; for (let n = c; n !== lca; n = b.par[n]) down.push(n); down.reverse();
    for (const n of down) { const e = b.edges[n]; edges.push(n); for (let k = 2; k < e.pts.length; k += 2) pts.push(e.pts[k], e.pts[k + 1]); }
    return { pts, edges };
  }
  function setPath(o, pts) { o.path = pts; const n = pts.length / 2, cum = new Float32Array(n); for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]); o.cum = cum; o.ps = 0; }
  function along(o, out) {
    const cum = o.cum, n = cum.length; let k = 1;
    if (n < 2) { out[0] = o.path[0]; out[1] = o.path[1]; return out; } while (k < n - 1 && cum[k] < o.ps) k++;
    const seg = Math.max(1e-6, cum[k] - cum[k - 1]), t = clamp((o.ps - cum[k - 1]) / seg, 0, 1);
    out[0] = o.path[k * 2 - 2] + (o.path[k * 2] - o.path[k * 2 - 2]) * t; out[1] = o.path[k * 2 - 1] + (o.path[k * 2 + 1] - o.path[k * 2 - 1]) * t;
    out[2] = Math.atan2(o.path[k * 2 + 1] - o.path[k * 2 - 1], o.path[k * 2] - o.path[k * 2 - 2]);
    return out;
  }
  const AL = [0, 0, 0];
  const remaining = (b) => { let n = 0; for (const p of b.pk) if (p.st < 2) n++; return n; };
  const free = (b) => { let n = 0; for (const p of b.pk) if (p.st < 2 && p.claim < 0) n++; return n; };
  function occ(b) { let n = 0; for (const d of drones) if ((d.st === 'go' || d.st === 'in') && d.b === b) n++; return n; }

  // ---------------------------------------------------------------- drone decisions: no assignment, only local scores
  function frontier(d) {
    let best = -1, bs = 0;
    for (let c = 0; c < NCC; c++) {
      const u = uC[c]; if (u < .04) continue;
      const x = (c % CW + .5) * CC, y = (((c / CW) | 0) + .5) * CC, dd = dist(d.x, d.y, x, y);
      let sc = Math.min(1, u * 1.5 + .12) * 70 / (dd + 70);
      for (const o of drones) { if (o === d || o.st !== 'out') continue; if ((o.tx - x) ** 2 + (o.ty - y) ** 2 < 900) sc *= .3; else if ((o.x - x) ** 2 + (o.y - y) ** 2 < 400) sc *= .65; }
      if (sc > bs) { bs = sc; best = c; }
    }
    return [best, bs * 2];
  }
  function bldScore(d, b) {
    if (b.cleared) return 0;
    const rem = b.entered ? free(b) : 3, o = occ(b) - (d.b === b ? 1 : 0); if (rem <= 0 || o >= Math.max(2, rem + 1)) return 0;
    const u = ugvs.find((q) => q.b === b), base = u ? (u.st === 'park' ? 3.2 : 1.3) : .5;
    return base * Math.min(rem, 3) / (1 + o) / (1 + dist(d.x, d.y, b.door.x, b.door.y) / 120);
  }
  function decide(d) {
    d.decide = 3 * TL;
    if (phase !== 'run') { d.st = 'home'; d.b = null; return; }
    const [c, so] = frontier(d);
    let bb = null, sb = 0; for (const b of M.coll) { const v = bldScore(d, b); if (v > sb) { sb = v; bb = b; } }
    if (bb && sb > so && sb > .35) { d.st = 'go'; d.b = bb; d.tx = bb.door.x; d.ty = bb.door.y; return; }
    d.b = null;
    if (c >= 0) { d.st = 'out'; d.tx = (c % CW + .5) * CC + (Math.random() - .5) * 4; d.ty = (((c / CW) | 0) + .5) * CC + (Math.random() - .5) * 4; return; }
    // nothing outdoors and no building wants more help: hold near the nearest unfinished building
    let nb = null, nd = 1e9; for (const b of M.coll) if (!b.cleared) { const q = dist(d.x, d.y, b.door.x, b.door.y); if (q < nd) { nd = q; nb = b; } }
    d.st = 'out';
    if (nb) { const a = d.id * 2.39996; d.tx = nb.cx + Math.cos(a) * (nb.w * .5 + 9); d.ty = nb.cy + Math.sin(a) * (nb.h * .5 + 9); d.decide = 1.2 * TL; }
    else { d.tx = d.x; d.ty = d.y; d.decide = .8 * TL; }
  }
  function choosePocket(d) {
    const b = d.b; let best = null, bl = 1e9, br = null;
    for (const p of b.pk) {
      if (p.st === 2 || (p.st === 1 && (p.by === d.id || drones[p.by].comp === d.comp)) || (p.claim >= 0 && p.claim !== d.id)) continue;
      const rt = route(b, d.node, p.node); let len = 0; for (let k = 2; k < rt.pts.length; k += 2) len += Math.hypot(rt.pts[k] - rt.pts[k - 2], rt.pts[k + 1] - rt.pts[k - 1]);
      if (len < bl) { bl = len; best = p; br = rt; }
    }
    if (best) { best.claim = d.id; d.pk = best; d.exiting = false; setPath(d, br.pts); d.edges = br.edges; return; }
    d.pk = null;
    if (d.node !== 0) { const rt = route(b, d.node, 0); rt.pts.push(b.door.x, b.door.y); setPath(d, rt.pts); d.edges = rt.edges; d.exiting = true; return; }
    leave(d);
  }
  function leave(d) { d.inside = false; d.exiting = false; d.st = 'out'; d.vx = d.vy = 0; d.b = null; decide(d); }
  function mapEdges(d, list) { for (const n of list) { const e = d.b.edges[n]; if (d.linked) e.st = 2; else if (e.st < 1) { e.st = 1; d.pend.push(e); } } }
  function merge(d) {
    for (const it of d.pend) { if (it.pts) it.st = 2; else if (it.st === 1) { it.st = 2; onMerged(it, d); } }
    d.pend.length = 0;
  }
  function onMerged(p, d) {
    const b = M.coll.find((q) => q.pk.includes(p));
    if (p.people && !p.found) {
      p.found = 1; nFound += p.people;
      // the nearest drones outside converge on it to confirm with thermal and camera, then go back to searching
      const cand = drones.filter((o) => (o.st === 'out' || o.st === 'go') && dist(o.x, o.y, p.x, p.y) < 110).sort((a, c) => dist(a.x, a.y, p.x, p.y) - dist(c.x, c.y, p.x, p.y)).slice(0, 3);
      cand.forEach((o, k) => { o.st = 'conf'; o.b = null; o.confT = 1.9 * TL; o.hx = p.x + Math.cos(k * 2.1 + .5) * 9; o.hy = p.y + Math.sin(k * 2.1 + .5) * 9; o.tx = o.hx; o.ty = o.hy; });
      say(`pocket found: ${p.people} ${p.people > 1 ? 'people' : 'person'}`, p.x, p.y, C.heat, 4.6, `${cand.length + 1} drones confirm: thermal + camera agree`, 'found');
    }
    if (remaining(b) === 0 && !b.cleared) {
      b.cleared = true; nCleared++;
      const next = M.coll.find((q) => !q.cleared && q !== b);
      say(`building ${b.letter} cleared`, b.cx, b.cy, C.teal, 3.6, next ? 'its drones drift to the next one still unfinished' : 'every collapsed building is searched');
      for (const o of drones) if (o.st === 'out' && dist(o.x, o.y, b.cx, b.cy) < 80) o.decide = Math.min(o.decide, .3 * TL);
    }
  }

  // ---------------------------------------------------------------- UGVs: drive clear streets, park, move on
  function ugvTarget(u) {
    const taken = new Set(ugvs.filter((q) => q !== u && q.b).map((q) => q.b));
    let best = null, bc = 1e9, bpts = null;
    const starts = u.seg ? [u.seg.a, u.seg.b] : [u.node];
    for (const b of M.coll) {
      if (b.cleared || taken.has(b)) continue;
      for (const n0 of starts) {
        const D = dijkstra(M, n0, true), [n0x, n0y] = nodeXY(M, n0), c0 = dist(u.x, u.y, n0x, n0y);
        for (const n1 of [b.seg.a, b.seg.b]) {
          const [n1x, n1y] = nodeXY(M, n1), c = c0 + D.d[n1] + dist(n1x, n1y, b.park.x, b.park.y);
          if (c < bc) { bc = c; best = b; const nodes = []; for (let v = n1; v >= 0; v = D.pv[v]) nodes.push(v); nodes.reverse(); bpts = [u.x, u.y]; for (const v of nodes) bpts.push(...nodeXY(M, v)); bpts.push(b.park.x, b.park.y); }
        }
      }
    }
    if (!best) return false;
    const pathFree = (() => { const D0 = dijkstra(M, starts[0], false); return D0; })();
    u.b = best; setPath(u, bpts); u.st = 'drive';
    if (!notesDone.reroute) {
      const direct = Math.min(pathFree.d[best.seg.a], pathFree.d[best.seg.b]) + PX;
      if (bc > direct + PX * .9 && u.seg === null) { notesDone.reroute = 1; say(`rubble blocks a street: UGV ${u.id + 1} takes the long way`, u.x, u.y, C.apricot, 3.6); }
    }
    return true;
  }
  function ugvHome(u) {
    const starts = u.seg ? [u.seg.a, u.seg.b] : [u.node]; let bc = 1e9, bpts = null;
    for (const n0 of starts) { const D = dijkstra(M, M.stN, true); if (D.d[n0] < 1e8) { const [x0, y0] = nodeXY(M, n0), c = D.d[n0] + dist(u.x, u.y, x0, y0); if (c < bc) { bc = c; const nodes = []; for (let v = n0; v >= 0; v = D.pv[v]) nodes.push(v); bpts = [u.x, u.y]; for (const v of nodes) bpts.push(...nodeXY(M, v)); bpts.push(M.stX + (u.id - 1) * 4.5, M.stY + 6.5); } } }
    if (bpts) { setPath(u, bpts); u.st = 'home'; u.b = null; }
  }

  // ---------------------------------------------------------------- mesh: who hears whom
  const NM = ND + NU + 1, mx = new Float32Array(NM), my = new Float32Array(NM), mIn = new Uint8Array(NM), mOn = new Uint8Array(NM), uf = new Int32Array(NM), gab = new Int16Array(NM * NM);
  let nGab = 0;
  const csz = new Int16Array(NM), cout = new Uint8Array(NM);
  const find = (i) => { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; };
  function mesh(doGab) {
    mx[0] = M.stX; my[0] = M.stY; mIn[0] = 0; mOn[0] = 1;
    ugvs.forEach((u, i) => { mx[1 + i] = u.x; my[1 + i] = u.y; mIn[1 + i] = 0; mOn[1 + i] = 1; });
    drones.forEach((d, i) => { const k = 1 + NU + i; mx[k] = d.x; my[k] = d.y; mIn[k] = d.inside ? 1 : 0; mOn[k] = d.st !== 'pad' && d.alt > .3 ? 1 : 0; });
    for (let i = 0; i < NM; i++) uf[i] = i;
    for (let i = 0; i < NM; i++) if (mOn[i]) for (let j = i + 1; j < NM; j++) {
      if (!mOn[j]) continue; const R = mIn[i] || mIn[j] ? R_IN : R_OUT;
      if ((mx[i] - mx[j]) ** 2 + (my[i] - my[j]) ** 2 < R * R) { const a = find(i), b = find(j); if (a !== b) uf[a] = b; }
    }
    // leaderless: a drone's map is shared when its radio component holds someone outdoors (a drone, a UGV, the pad);
    // a drone alone in the open, or a chain under the slabs with nobody outside, is out of range
    csz.fill(0); cout.fill(0);
    for (let i = 0; i < NM; i++) if (mOn[i]) { const rt = find(i); csz[rt]++; if (!mIn[i]) cout[rt] = 1; }
    drones.forEach((d, i) => { const k = 1 + NU + i, was = d.linked, rt = find(k); d.comp = rt; d.linked = !mOn[k] || (d.inside ? cout[rt] === 1 : csz[rt] > 1);
      if (d.linked && !was && d.pend.length) { const n = d.pend.some((q) => !q.pts); merge(d); if (n && (notesDone.mc || 0) < 2) { notesDone.mc = (notesDone.mc || 0) + 1; say(`drone ${d.id + 1} back in range: its map merges`, d.x, d.y, C.teal, 3.4, 'order does not matter: a union of searched places'); } }
      else if (d.linked && d.pend.length) merge(d);
      if (!d.linked && was && d.inside && !notesDone.lost) { notesDone.lost = 1; say(`drone ${d.id + 1} out of range under the slabs`, d.x, d.y, C.muted, 3.6, 'it keeps mapping alone and merges later'); }
    });
    if (!doGab) return;
    nGab = 0;                                                            // the links we draw: a Gabriel graph of the radio links
    for (let i = 0; i < NM; i++) if (mOn[i]) for (let j = i + 1; j < NM; j++) {
      if (!mOn[j]) continue; const R = mIn[i] || mIn[j] ? R_IN : R_OUT, d2 = (mx[i] - mx[j]) ** 2 + (my[i] - my[j]) ** 2; if (d2 > R * R) continue;
      const cx = (mx[i] + mx[j]) / 2, cy = (my[i] + my[j]) / 2, r2 = d2 / 4; let ok = true;
      for (let k = 0; k < NM && ok; k++) if (k !== i && k !== j && mOn[k] && (mx[k] - cx) ** 2 + (my[k] - cy) ** 2 < r2) ok = false;
      if (ok) { gab[nGab++] = i; gab[nGab++] = j; }
    }
  }

  // ---------------------------------------------------------------- the step
  function step(ds) {
    simT += ds;
    for (const u of ugvs) {
      if (u.st === 'pad') { if (phase === 'run' && simT >= u.depart) { if (!notesDone.ugv) { notesDone.ugv = 1; say('3 UGVs drive the clear streets', M.stX, M.stY + 8, C.apricot, 3.6, 'they command nothing: they are just different'); } if (!ugvTarget(u)) u.depart = simT + 2 * TL; } continue; }
      if (u.st === 'drive' || u.st === 'home') {
        u.ps += V_UGV * ds; along(u, AL); u.x = AL[0]; u.y = AL[1]; u.hd = AL[2];
        if (u.ps >= u.cum[u.cum.length - 1]) {
          if (u.st === 'home') { u.st = 'pad'; u.seg = null; u.node = M.stN; u.depart = 1e9; continue; }
          u.st = 'park'; u.seg = u.b.seg; u.b.ugv = u.id; u.pulse = 0;
          if ((notesDone.park || 0) < 2) { notesDone.park = (notesDone.park || 0) + 1; say(`UGV ${u.id + 1} parks at building ${u.b.letter}`, u.x, u.y, C.apricot, 3.8, 'drones nearby rate it higher and gather: no assignment'); }
          for (const d of drones) if (d.st === 'out' && dist(d.x, d.y, u.x, u.y) < 120) d.decide = Math.min(d.decide, Math.random() * .8 * TL);
        }
        continue;
      }
      if (u.st === 'park') {
        u.pulse += ds / TL;
        if (phase !== 'run') { if (u.b) u.b.ugv = -1; u.b = null; ugvHome(u); }
        else if (u.b.cleared) { u.b.ugv = -1; u.b = null; if (!ugvTarget(u)) u.st = 'idle'; }
      }
      if (u.st === 'idle') { if (phase !== 'run') ugvHome(u); else if (Math.random() < .02) ugvTarget(u); }
    }
    for (const d of drones) {
      if (d.st === 'pad') {
        if (phase === 'run' && simT >= d.launch) { d.st = 'out'; decide(d); if (!notesDone.launch) { notesDone.launch = 1; say(`${ND} drones take off`, M.stX, M.stY, C.teal, 5.4, 'outdoor mode: thermal sweep of streets and rubble'); } }
        else continue;
      }
      if (d.alt < 1 && d.st !== 'land') d.alt = Math.min(1, d.alt + ds / (.7 * TL));
      if (d.st === 'in') {
        if (d.dwell > 0) { d.dwell -= ds; if (d.dwell <= 0) { const p = d.pk; p.claim = -1; if (d.linked) { p.st = 2; p.by = d.id; onMerged(p, d); } else if (p.st < 2) { if (p.st === 0) { p.st = 1; p.by = d.id; } d.pend.push(p); } d.pk = null; choosePocket(d); } continue; }
        d.ps += V_IN * ds; along(d, AL); d.x = AL[0]; d.y = AL[1]; d.hd = AL[2];
        if (d.ps >= d.cum[d.cum.length - 1]) {
          mapEdges(d, d.edges);
          if (d.exiting) { d.node = 0; leave(d); continue; }
          d.node = d.pk.node; d.dwell = DWELL;
        }
        continue;
      }
      // airborne outside: steer toward the target, keep apart from neighbours
      let tx = d.tx, ty = d.ty, v = d.st === 'home' ? 6 : V_OUT;          // transit home is faster than search flight
      if (d.st === 'conf') { d.confT -= ds; const a = simT * .05 + d.id; tx = d.hx + Math.cos(a) * 1.5; ty = d.hy + Math.sin(a) * 1.5; if (d.confT <= 0) { d.st = 'out'; decide(d); } }
      if (d.st === 'home' || d.st === 'land') { tx = d.padX; ty = d.padY; }
      let ax = tx - d.x, ay = ty - d.y; const dd = Math.hypot(ax, ay);
      if (d.st === 'land' || (d.st === 'home' && dd < 1.5)) { d.st = 'land'; d.alt = Math.max(0, d.alt - ds / (.6 * TL)); d.x += ax * .2; d.y += ay * .2; continue; }
      const sp = Math.min(v, dd * .6 + .2); ax = dd > 1e-3 ? ax / dd * sp : 0; ay = dd > 1e-3 ? ay / dd * sp : 0;
      if (d.st !== 'home') for (const o of drones) { if (o === d || o.inside || o.st === 'pad' || o.st === 'land') continue; const ex = d.x - o.x, ey = d.y - o.y, e2 = ex * ex + ey * ey; if (e2 < 144 && e2 > 1e-4) { const f = (12 - Math.sqrt(e2)) / 12 * 1.6; ax += ex / Math.sqrt(e2) * f; ay += ey / Math.sqrt(e2) * f; } }
      const kk = Math.min(1, ds * 1.4); d.vx += (ax - d.vx) * kk; d.vy += (ay - d.vy) * kk;
      d.x = clamp(d.x + d.vx * ds, -6, M.WD + 6); d.y = clamp(d.y + d.vy * ds, -6, M.HD + 6);
      if (d.vx * d.vx + d.vy * d.vy > .04) d.hd = Math.atan2(d.vy, d.vx);
      if (d.alt > .5 && d.st !== 'home') brush(d.x, d.y, R_TH, true);
      if (d.st === 'out') {
        d.decide -= ds;
        const ci = clamp(Math.floor(d.tx / CC), 0, CW - 1) + clamp(Math.floor(d.ty / CC), 0, CH - 1) * CW;
        if (d.decide <= 0 || dd < 4 || (uC[ci] < .02 && dd < 40)) decide(d);
      } else if (d.st === 'go') {
        if (d.b.cleared || (d.b.entered && free(d.b) === 0)) decide(d);
        else if (dd < 2.5) {
          const b = d.b; d.st = 'in'; d.inside = true; d.node = 0; d.dwell = 0;
          if (!b.entered) { b.entered = true; if ((notesDone.enter || 0) < 2) { notesDone.enter = (notesDone.enter || 0) + 1; say(`drone ${d.id + 1} enters building ${b.letter}`, b.door.x, b.door.y, C.teal, 3.8, `indoor mode: LiDAR, 3-D voxels at 5 cm · ${b.pk.length} pockets to search`); } }
          choosePocket(d);
          if (d.st === 'in' && d.path) setPath(d, [d.x, d.y, ...d.path]);
        }
      }
    }
    if (!notesDone.front && simT > 5.6 * TL) { const d = drones.find((q) => q.st === 'out' && q.alt > .9 && dist(q.x, q.y, M.WD / 2, M.HD / 2) < M.WD * .35); if (d) { notesDone.front = 1; say(`drone ${d.id + 1} heads for the nearest unsearched patch`, d.x, d.y, C.teal, 4, 'one that no neighbour has claimed: even spacing, no orders'); } }
    // sub-swarms
    const inB = (b) => { let n = 0; for (const d of drones) if (d.inside && d.b === b) n++; return n; };
    if (!splitShown) { const k = M.coll.filter((b) => inB(b) >= 2).length; if (k >= 3) { splitShown = true; const b = M.coll.find((q) => inB(q) >= 2); say(`the fleet has split into ${k} sub-swarms`, b.cx, b.cy, C.ink, 3.8, 'one per collapsed building, nobody assigned them'); } }
  }
  function checkEnd() {
    if (phase !== 'run') return;
    const pockets = M.coll.every((b) => b.cleared), pend = drones.some((d) => d.pend.length);
    if ((pockets && !pend && outComp === 0) || wallT > 95) {
      phase = 'done'; phaseT = 0; endT = simT;
      say('nothing left unsearched: β₀ = 0', M.WD / 2, M.HD / 2, C.teal, 3, 'the swarm flies home', 'end');
      for (const d of drones) if (d.st !== 'pad') { d.st = 'home'; d.inside = false; d.b = null; }
      for (const u of ugvs) if (u.st === 'park' || u.st === 'idle') { u.seg = u.seg || (u.b && u.b.seg); ugvHome(u); }
    }
  }
  function beta0() { let n = outComp; for (const b of M.coll) n += b.entered ? remaining(b) : 1; return n; }

  // ---------------------------------------------------------------- callouts (event labels that appear and fade)
  const notes = [];
  function say(s, x, y, col, life = 3.6, s2 = '', kind = '') {
    notes.push({ s, s2, x, y, col, t: wallT, life, kind, placed: false, ox: 0, oy: 0, al: 'left' });
    while (notes.length > (L && L.phone ? 2 : 4)) { const i = notes.findIndex((n) => n.kind !== 'found'); notes.splice(i >= 0 ? i : 0, 1); }
  }
  const occR = []; let nOcc = 0;
  const addOcc = (x, y, w, h) => { occR[nOcc++] = [x, y, w, h]; };
  const overlap = (x, y, w, h) => { let a = 0; for (let k = 0; k < nOcc; k++) { const o = occR[k], ix = Math.min(x + w, o[0] + o[2]) - Math.max(x, o[0]), iy = Math.min(y + h, o[1] + o[3]) - Math.max(y, o[1]); if (ix > 0 && iy > 0) a += ix * iy; } return a; };
  function pill(x, y, w, h, a = .86) { ctx.fillStyle = `rgba(27,30,61,${a})`; roundRect(ctx, x, y, w, h, h / 2 > 11 ? 9 : h / 2); ctx.fill(); ctx.strokeStyle = 'rgba(220,214,236,.13)'; ctx.lineWidth = 1; ctx.stroke(); }
  function drawNotes() {
    const ph = L.phone, fs = ph ? 11 : 12, fs2 = ph ? 10.5 : 11;
    for (const n of notes) {
      const age = wallT - n.t; if (age > n.life) continue;
      const a = Math.min(1, age / .3) * Math.min(1, (n.life - age) / .7) * (phase === 'sum' ? Math.max(0, 1 - phaseT / .4) : phase === 'fade' ? 0 : 1);
      if (a <= 0) continue;
      ctx.font = `500 ${fs}px ${F.sans}`; let w = ctx.measureText(n.s).width;
      if (n.s2) { ctx.font = `400 ${fs2}px ${F.sans}`; w = Math.max(w, ctx.measureText(n.s2).width); }
      const bw = w + 18, bh = n.s2 ? (ph ? 36 : 40) : 24, axp = X(n.x), ayp = Y(n.y);
      if (!n.placed) {
        for (const m2 of notes) addOcc(X(m2.x) - 14, Y(m2.y) - 14, 28, 28);
        for (const b of M.coll) for (const p of b.pk) if (p.found) addOcc(X(p.x) - 20, Y(p.y) - 20, 40, 40);
        const cands = [[16, -bh - 14], [-16 - bw, -bh - 14], [16, 14], [-16 - bw, 14], [22, -bh / 2], [-22 - bw, -bh / 2], [-bw / 2, -bh - 26], [-bw / 2, 26], [16, -2 * bh - 22], [-16 - bw, -2 * bh - 22], [16, bh + 24], [-16 - bw, bh + 24], [-bw / 2, -2 * bh - 34], [-bw / 2, bh + 36]];
        let ok = null, bestO = 1e9;
        for (const [dx, dy] of cands) {
          const bx = clamp(axp + dx, L.ax0, L.ax1 - bw), by = clamp(ayp + dy, 74, L.H - bh - (L.phone ? 40 : 8)), o = overlap(bx, by, bw, bh);
          if (o < bestO) { bestO = o; ok = [bx - axp, by - ayp]; if (o === 0) break; }
        }
        n.ox = ok[0]; n.oy = ok[1]; n.placed = true;
      }
      const bx = axp + n.ox, by = ayp + n.oy; addOcc(bx, by, bw, bh);
      ctx.globalAlpha = a;
      const cx = clamp(axp, bx + 8, bx + bw - 8), cy = by + bh / 2 > ayp ? by : by + bh;
      ctx.strokeStyle = 'rgba(220,214,236,.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(axp, ayp); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.fillStyle = n.col; ctx.beginPath(); ctx.arc(axp, ayp, 2.4, 0, TAU); ctx.fill();
      pill(bx, by, bw, bh);
      text(ctx, n.s, bx + 9, by + (n.s2 ? 16 : 16), { size: fs, color: n.col, weight: 500 });
      if (n.s2) text(ctx, n.s2, bx + 9, by + (ph ? 30 : 32), { size: fs2, color: C.muted });
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- drawing
  const fmtClock = (t) => { t = Math.floor(t); const h = (t / 3600) | 0, mm = ((t % 3600) / 60) | 0, ss = t % 60; return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; };
  const fmtDur = (t) => { t = Math.round(t); const mm = (t / 60) | 0, ss = t % 60; return `${mm} min ${String(ss).padStart(2, '0')} s`; };
  function droneGlyph(p, x, y, hd, a) {
    const c = Math.cos(hd + Math.PI / 4) * a, s = Math.sin(hd + Math.PI / 4) * a;
    p.moveTo(x - c, y - s); p.lineTo(x + c, y + s); p.moveTo(x + s, y - c); p.lineTo(x - s, y + c);
  }
  function rotors(p, x, y, hd, a, rr) {
    const c = Math.cos(hd + Math.PI / 4) * a, s = Math.sin(hd + Math.PI / 4) * a;
    for (const [qx, qy] of [[x - c, y - s], [x + c, y + s], [x + s, y - c], [x - s, y + c]]) { p.moveTo(qx + rr, qy); p.arc(qx, qy, rr, 0, TAU); }
  }
  let hover = null, hoverT = 0;
  function draw() {
    const { W, H, s, phone } = L;
    nOcc = 0;
    ctx.drawImage(terr, 0, 0, W, H);
    // fog of war over the district
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const fw = GW * CELL * s, fh = GH * CELL * s;
    ctx.globalCompositeOperation = 'saturation'; ctx.drawImage(satCv, L.ox, L.oy, fw, fh);
    ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(fogCv, L.ox, L.oy, fw, fh);
    // dust over the rubble
    for (const b of M.coll) for (let k = 0; k < 3; k++) {
      const ph = ((b.dust[k] + simT * .35) % 40) / 40, rad = (24 + k * 6) * s, x = X(b.cx - 14 + ph * 34 + k * 3), y = Y(b.cy + (k - 1) * 6 - ph * 6);
      ctx.globalAlpha = .2 * Math.sin(ph * Math.PI); ctx.drawImage(SPR_DUST, x - rad, y - rad, rad * 2, rad * 2);
    }
    ctx.globalAlpha = 1;
    // what the swarm knows inside the rubble: walls of the indoor map, crawl paths, pockets
    for (const b of M.coll) {
      if (!b.entered) continue;
      ctx.strokeStyle = b.cleared ? 'rgba(127,212,207,.4)' : 'rgba(127,212,207,.3)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.strokeRect(X(b.x), Y(b.y), b.w * s, b.h * s); ctx.setLineDash([]);
      for (let st = 1; st <= 2; st++) {
        ctx.strokeStyle = st === 2 ? 'rgba(127,212,207,.85)' : 'rgba(127,212,207,.4)'; ctx.lineWidth = 1.5; ctx.setLineDash([2.5, 2.5]); ctx.beginPath();
        for (let n = 1; n < b.edges.length; n++) { const e = b.edges[n]; if (e.st !== st) continue; ctx.moveTo(X(e.pts[0]), Y(e.pts[1])); for (let k = 2; k < e.pts.length; k += 2) ctx.lineTo(X(e.pts[k]), Y(e.pts[k + 1])); }
        ctx.stroke(); ctx.setLineDash([]);
      }
      for (const p of b.pk) {
        if (p.st === 0) continue;
        ctx.beginPath(); for (let k = 0; k < 9; k++) { const x = X(p.x + p.sh[k * 2]), y = Y(p.y + p.sh[k * 2 + 1]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath();
        ctx.fillStyle = p.st === 2 ? 'rgba(18,19,44,.9)' : 'rgba(18,19,44,.45)'; ctx.fill();
        ctx.strokeStyle = p.st === 2 ? 'rgba(127,212,207,.9)' : 'rgba(127,212,207,.45)'; ctx.lineWidth = 1.3; if (p.st === 1) ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // UGVs: soft rings while parked (the symmetry breaker), the robot, its headlights
    for (const u of ugvs) {
      if (u.st === 'park') for (let k = 0; k < 2; k++) { const f = ((u.pulse * .5 + k * .5) % 1 + 1) % 1, rr = Math.max(1, (6 + f * 40) * s); ctx.strokeStyle = `rgba(246,210,177,${(.36 * (1 - f)).toFixed(3)})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(X(u.x), Y(u.y), rr, 0, TAU); ctx.stroke(); }
      if ((u.st === 'drive' || u.st === 'home') && u.cum) { ctx.strokeStyle = 'rgba(246,210,177,.22)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(X(u.x), Y(u.y)); let k = 1; while (k < u.cum.length - 1 && u.cum[k] < u.ps) k++; for (; k < u.cum.length; k++) ctx.lineTo(X(u.path[k * 2]), Y(u.path[k * 2 + 1])); ctx.stroke(); ctx.setLineDash([]); }
    }
    for (const u of ugvs) {
      const x = X(u.x), y = Y(u.y), L0 = Math.max(phone ? 11 : 14, 4.4 * s), W0 = Math.max(phone ? 7 : 9, 2.8 * s), gg = L0 * 3;
      ctx.globalAlpha = .45; ctx.drawImage(SPR_APRI, x - gg / 2, y - gg / 2, gg, gg); ctx.globalAlpha = 1;
      ctx.save(); ctx.translate(x, y); ctx.rotate(u.hd);
      if (u.st === 'drive' || u.st === 'home') { const gr = ctx.createLinearGradient(L0 / 2, 0, L0 / 2 + 26, 0); gr.addColorStop(0, 'rgba(246,210,177,.3)'); gr.addColorStop(1, 'rgba(246,210,177,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(L0 / 2, -W0 * .3); ctx.lineTo(L0 / 2 + 26, -W0 * 1.1); ctx.lineTo(L0 / 2 + 26, W0 * 1.1); ctx.lineTo(L0 / 2, W0 * .3); ctx.fill(); }
      ctx.fillStyle = 'rgba(12,13,30,.5)'; roundRect(ctx, -L0 / 2 + 1.5, -W0 / 2 + 2, L0, W0, 2); ctx.fill();
      ctx.fillStyle = '#3a3a62'; ctx.fillRect(-L0 * .38, -W0 / 2 - 1.2, L0 * .26, W0 + 2.4); ctx.fillRect(L0 * .12, -W0 / 2 - 1.2, L0 * .26, W0 + 2.4);
      ctx.fillStyle = C.apricot; roundRect(ctx, -L0 / 2, -W0 / 2, L0, W0, 2); ctx.fill(); ctx.strokeStyle = 'rgba(40,34,52,.6)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(30,33,64,.55)'; ctx.fillRect(L0 * .1, -W0 * .32, L0 * .22, W0 * .64);
      ctx.fillStyle = '#F3EEF2'; ctx.beginPath(); ctx.arc(-L0 * .18, 0, 1.4, 0, TAU); ctx.fill();
      ctx.restore();
      if (Math.sin(wallT * 7 + u.id * 2) > .55) { ctx.globalAlpha = .8; ctx.drawImage(SPR_APRI, x - 7, y - 7, 14, 14); ctx.globalAlpha = 1; }   // a beacon
    }
    // mesh links
    ctx.strokeStyle = 'rgba(127,212,207,.3)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath();
    for (let k = 0; k < nGab; k += 2) { const i = gab[k], j = gab[k + 1]; ctx.moveTo(X(mx[i]), Y(my[i])); ctx.lineTo(X(mx[j]), Y(my[j])); }
    ctx.stroke(); ctx.setLineDash([]);
    // drones: shadow, trail, glow, frame
    const A = phone ? 3.6 : 5, RR = phone ? 1.45 : 1.9;
    ctx.fillStyle = 'rgba(10,11,28,.3)'; ctx.beginPath();
    for (const d of drones) { if (d.inside || d.alt < .05) continue; const o = 2 + 4 * d.alt; ctx.moveTo(X(d.x) + o + 2.6, Y(d.y) + o * 1.2); ctx.arc(X(d.x) + o, Y(d.y) + o * 1.2, 2.6, 0, TAU); }
    ctx.fill();
    ctx.lineCap = 'round';
    for (let k = 1; k < 9; k++) {
      ctx.strokeStyle = `rgba(127,212,207,${(.34 * (1 - k / 9)).toFixed(3)})`; ctx.lineWidth = 1.6 - k * .1; ctx.beginPath();
      for (const d of drones) { if (d.inside || d.tn <= k + 1) continue; const a0 = ((d.th - k + 10) % 10) * 2, a1 = ((d.th - k - 1 + 10) % 10) * 2; ctx.moveTo(X(d.trail[a0]), Y(d.trail[a0 + 1])); ctx.lineTo(X(d.trail[a1]), Y(d.trail[a1 + 1])); }
      ctx.stroke();
    }
    for (const d of drones) {
      if (d.alt <= 0) continue;
      const x = X(d.x), y = Y(d.y), g = (d.inside ? 18 : phone ? 24 : 30) * (.5 + .5 * d.alt);
      ctx.globalAlpha = (d.linked ? .42 : .16) * (d.inside ? .8 : 1); ctx.drawImage(SPR_TEAL, x - g / 2, y - g / 2, g, g);
    }
    ctx.globalAlpha = 1;
    for (let pass = 0; pass < 3; pass++) {                                // linked outdoors, inside the rubble, out of range
      const pa = new Path2D(), pr = new Path2D();
      for (const d of drones) {
        const cls = !d.linked ? 2 : d.inside ? 1 : 0; if (cls !== pass) continue;
        const sc = (d.inside ? .78 : 1) * (.6 + .4 * d.alt), x = X(d.x), y = Y(d.y);
        droneGlyph(pa, x, y, d.hd, A * sc); rotors(pr, x, y, d.hd, A * sc, RR * sc);
      }
      const col = pass === 2 ? 'rgba(127,212,207,.42)' : pass === 1 ? 'rgba(127,212,207,.8)' : C.teal;
      ctx.strokeStyle = 'rgba(16,18,40,.7)'; ctx.lineWidth = 3; ctx.stroke(pa);
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(pa); ctx.fillStyle = pass === 0 ? 'rgba(127,212,207,.35)' : 'rgba(127,212,207,.15)'; ctx.fill(pr); ctx.lineWidth = 1.1; ctx.stroke(pr);
    }
    // people found: warm glow and tiny figures in the void
    for (const b of M.coll) for (const p of b.pk) {
      if (!p.found) continue;
      const x = X(p.x), y = Y(p.y), pulse = 1 + .12 * Math.sin(wallT * 3 + p.x), g = (phone ? 38 : 54) * pulse;
      ctx.globalAlpha = .75; ctx.drawImage(SPR_HEAT, x - g / 2, y - g / 2, g, g); ctx.globalAlpha = 1;
      ctx.fillStyle = C.heat;
      for (let k = 0; k < p.people; k++) { const qx = x + (k - (p.people - 1) / 2) * 5, qy = y + (k ? 1.5 : -1); ctx.save(); ctx.translate(qx, qy); ctx.rotate(.6 + k * 1.1); roundRect(ctx, -1.3, -3.4, 2.6, 6.8, 1.3); ctx.fill(); ctx.beginPath(); ctx.arc(0, -4.4, 1.5, 0, TAU); ctx.fill(); ctx.restore(); }
    }
    // HUD (top of the action area), on soft backdrops so it reads over roofs
    const fsH = phone ? 11 : 12;
    const tg = ctx.createLinearGradient(0, 0, 0, phone ? 124 : 134); tg.addColorStop(0, 'rgba(27,30,61,.72)'); tg.addColorStop(.6, 'rgba(27,30,61,.55)'); tg.addColorStop(1, 'rgba(27,30,61,0)');
    ctx.fillStyle = tg; ctx.fillRect(0, 0, W, phone ? 124 : 134);
    const bg2 = ctx.createLinearGradient(0, L.H - (phone ? 70 : 52), 0, L.H); bg2.addColorStop(0, 'rgba(27,30,61,0)'); bg2.addColorStop(1, 'rgba(27,30,61,.72)');
    ctx.fillStyle = bg2; ctx.fillRect(0, L.H - (phone ? 70 : 52), W, phone ? 70 : 52);
    ctx.font = `500 ${fsH}px ${F.mono}`; const cl = fmtClock(phase === 'run' ? simT : endT), cw = ctx.measureText(cl).width;
    text(ctx, cl, L.ax0, phone ? 88 : 92, { size: fsH, color: C.ink, font: F.mono, weight: 500 });
    text(ctx, ` · time-lapse ×${TL}`, L.ax0 + cw, phone ? 88 : 92, { size: fsH, color: C.muted });
    text(ctx, 'indoor mode inside each building · outdoor between them', L.ax0, phone ? 104 : 110, { size: phone ? 10.5 : 11.5, color: C.muted });
    addOcc(L.ax0 - 4, 74, phone ? 330 : 360, 44);
    const b0 = phase === 'run' ? beta0() : 0, bs = (B0S || (B0S = kit.stableCount())).update(b0, phase === 'run' ? simT : 0);
    ctx.font = `600 ${phone ? 13 : 15}px ${F.mono}`; const bw0 = ctx.measureText(bs).width;
    text(ctx, bs, L.ax1, phone ? 88 : 93, { size: phone ? 13 : 15, color: bs === '0' ? C.teal : bs === '…' ? C.muted : C.ink, font: F.mono, weight: 600, align: 'right' });
    text(ctx, phone ? 'unsearched β₀' : 'unsearched regions β₀', L.ax1 - bw0 - 8, phone ? 88 : 92, { size: phone ? 10.5 : 11.5, color: C.muted, align: 'right' });
    addOcc(L.ax1 - 190, 74, 190, 28);
    // scale bar and grid note
    const sbm = phone ? 25 : 50, sbx = L.ax0, sby = L.H - (phone ? 40 : 20);
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(sbx, sby - 4); ctx.lineTo(sbx, sby); ctx.lineTo(sbx + sbm * s, sby); ctx.lineTo(sbx + sbm * s, sby - 4); ctx.stroke();
    text(ctx, `${sbm} m`, sbx + sbm * s + 6, sby + 1, { size: 11, color: C.muted, font: F.mono });
    if (!phone) text(ctx, 'outdoor: 2.5-D grid, 2 m cells, thermal first · indoor: 3-D voxels at 5 cm, LiDAR, no GPS', sbx + sbm * s + 44, sby + 1, { size: 11, color: C.muted });
    addOcc(sbx - 4, sby - 14, phone ? 120 : 560, 20);
    addOcc(L.W - 200, L.H - 70, 200, 70); addOcc(0, 0, L.W, 70); if (L.left > 0) addOcc(0, 0, L.left * L.W, L.H);
    // the staging label
    { const rt = M.stX > M.WD / 2; text(ctx, 'staging', X(M.stX) + (rt ? -11 : 11) * s, Y(M.stY) + 11 * s + 12, { size: 11, color: 'rgba(246,210,177,.75)', align: rt ? 'right' : 'left' }); }
    // a β₀ bubble per collapsed building
    const fsB = phone ? 10.5 : 11.5;
    if (phase === 'run' || phase === 'done') for (const b of M.coll) addOcc(b.bub.x, b.bub.y, b.bub.w, b.bub.h);
    ctx.globalAlpha = phase === 'sum' ? Math.max(0, 1 - phaseT / .5) : phase === 'fade' ? 0 : 1;
    for (const b of M.coll) {
      if (ctx.globalAlpha <= 0) break;
      const rem = remaining(b), inside = drones.reduce((n, d) => n + (d.inside && d.b === b ? 1 : 0), 0);
      const lab1 = phone ? '' : b.cleared ? 'cleared' : 'unsearched pockets', num = b.cleared ? '✓' : b.entered ? String(rem) : '?';
      const lab2 = !phone && !b.cleared && inside ? `${inside} drone${inside > 1 ? 's' : ''} inside` : '';
      ctx.font = `400 ${fsB}px ${F.sans}`; const w1 = lab1 ? ctx.measureText(lab1).width : -6; ctx.font = `500 ${fsB}px ${F.mono}`; const w2 = ctx.measureText(num).width;
      const bw = 18 + 6 + w1 + 6 + w2 + 10, bh = lab2 ? 34 : 22, below = b.bub.below;
      const bx = clamp(b.bub.x + (b.bub.w - bw) / 2, L.ax0, L.ax1 - bw), by = below ? b.bub.y : b.bub.y + b.bub.h - bh;
      pill(bx, by, bw, bh, .82);
      ctx.strokeStyle = 'rgba(220,214,236,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(b.cx), below ? by : by + bh); ctx.lineTo(X(b.cx), below ? Y(b.y + b.h) + 2 : Y(b.y) - 2); ctx.stroke();
      const cx = bx + 11, cy = by + 11;
      ctx.fillStyle = b.cleared ? C.teal : 'rgba(143,140,196,.9)'; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, TAU); ctx.fill();
      text(ctx, b.letter, cx, cy + .5, { size: 10, color: '#1E2140', weight: 600, align: 'center', base: 'middle' });
      text(ctx, lab1, cx + 13, cy + .5, { size: fsB, color: b.cleared ? C.teal : C.muted, base: 'middle' });
      text(ctx, num, cx + 13 + w1 + 6, cy + .5, { size: fsB, color: b.cleared ? C.teal : C.ink, font: F.mono, weight: 500, base: 'middle' });
      if (lab2) text(ctx, lab2, cx + 13, cy + 15, { size: 11, color: C.faint, base: 'middle' });
    }
    ctx.globalAlpha = 1;
    drawNotes();
    // hover tooltip
    if (hover && wallT < hoverT) {
      let best = null, bd = (phone ? 22 : 16) ** 2;
      for (const d of drones) { if (d.st === 'pad' && d.alt <= 0) continue; const q = (X(d.x) - hover[0]) ** 2 + (Y(d.y) - hover[1]) ** 2; if (q < bd) { bd = q; best = d; } }
      if (best) {
        const d = best, far = Math.round(dist(d.x, d.y, d.tx, d.ty));
        let s0 = d.st === 'out' ? `frontier, ${far} m` : d.st === 'go' ? `to building ${d.b.letter}, ${far} m` : d.st === 'conf' ? 'confirming: thermal + camera' : d.st === 'in' ? (d.dwell > 0 ? `scanning a pocket in ${d.b.letter}` : d.exiting ? `leaving ${d.b.letter}` : `crawling in ${d.b.letter}, ${Math.round(d.cum[d.cum.length - 1] - d.ps)} m`) : d.st === 'home' || d.st === 'land' ? 'returning' : 'on the pad';
        if (!d.linked) s0 += ', out of range';
        const s1 = `drone ${d.id + 1}: ${s0}`; ctx.font = `400 11.5px ${F.sans}`; const tw = ctx.measureText(s1).width + 16;
        const tx = clamp(X(d.x) + 12, 8, L.W - tw - 8), ty = clamp(Y(d.y) - 30, 72, L.H - 30);
        pill(tx, ty, tw, 22, .92); text(ctx, s1, tx + 8, ty + 15, { size: 11.5, color: C.ink });
      }
    }
    // summary
    if (phase === 'sum' || phase === 'fade') {
      const a = phase === 'sum' ? Math.min(1, phaseT / .5) : 1;
      const pw = Math.min(380, L.ax1 - L.ax0 - 20), ph2 = phone ? 168 : 186, px = (L.ax0 + L.ax1) / 2 - pw / 2, py = clamp(Y(M.HD / 2) - ph2 / 2, 120, L.H - ph2 - 60);
      ctx.globalAlpha = a; pill(px, py, pw, ph2, .92);
      text(ctx, 'Nothing left unsearched', px + 20, py + 34, { size: phone ? 18 : 21, color: C.ink, font: F.serif });
      text(ctx, 'β₀ of the unsearched space = 0', px + 20, py + 56, { size: 12, color: C.teal });
      const rows = [['Buildings cleared', `${nCleared} of ${M.coll.length}`], ['People found', `${nFound}`], ['Drones · UGVs', `${ND} · ${NU}`], ['Mission time', fmtDur(endT)], ['Area', `${(M.WD * M.HD / 1e6).toFixed(3)} km²`]];
      rows.forEach(([k, v], i) => { const yy = py + 84 + i * (phone ? 15 : 17.5); text(ctx, k, px + 20, yy, { size: 12, color: C.muted }); text(ctx, v, px + pw - 20, yy, { size: 12, color: i === 1 ? C.heat : C.ink, font: F.mono, align: 'right' }); });
      ctx.globalAlpha = 1;
    }
    if (fadeA > 0) { ctx.fillStyle = `rgba(27,30,61,${fadeA.toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  }

  // ---------------------------------------------------------------- the loop
  let frameN = 0, lastLeft = stage.dataset.left;
  function tick(dt) {
    wallT += dt; phaseT += dt;
    if (phase === 'run' || phase === 'done') {
      const ds = dt * TL, n = Math.max(1, Math.ceil(ds / .4));
      for (let k = 0; k < n; k++) step(ds / n);
      cdT -= dt; if (cdT <= 0) { coarse(); cdT = .2; }
      mesh(false);
      checkEnd();
      if (phase === 'done' && phaseT > 2.2) { phase = 'sum'; phaseT = 0; }
    } else if (phase === 'sum') { step(dt * TL); if (phaseT > 5.2) { phase = 'fade'; phaseT = 0; } }
    else if (phase === 'fade') { fadeA = Math.min(1, phaseT / .9); if (phaseT > 1) { newMission(true); fadeA = 1; phase = 'run'; } }
    if (phase !== 'fade' && fadeA > 0) fadeA = Math.max(0, fadeA - dt / .9);
    for (const d of drones) { d.trail[d.th * 2] = d.x; d.trail[d.th * 2 + 1] = d.y; d.th = (d.th + 1) % 10; if (d.tn < 10) d.tn++; if (d.inside || d.st === 'pad') d.tn = 0; }
  }
  newMission(false); fadeA = 0;
  const loop = kit.loop((dt) => {
    dt = clamp(dt, 0, .05);
    tick(dt);
    if (++frameN % 2 === 0 || nGab === 0) mesh(true);
    if (stage.dataset.left !== lastLeft) { lastLeft = stage.dataset.left; layout(); }
    paintFog(dt, frameN % 3 === 0);
    draw(); reads();
  });
  function reads() { rB.set(`${nCleared} of ${M.coll.length}`); rP.set(String(nFound)); rD.set(String(drones.reduce((n, d) => n + (d.st !== 'pad' || d.alt > 0 ? 1 : 0), 0))); }
  cv.onResize(() => { if (M) layout(); });

  // pointer: hover (or tap) a drone for a tiny tooltip
  const onMove = (e) => { hover = [e.offsetX, e.offsetY]; hoverT = wallT + (e.pointerType === 'mouse' ? 1e9 : 2.5); };
  const onLeave = () => { hover = null; };
  el.addEventListener('pointermove', onMove); el.addEventListener('pointerdown', onMove); el.addEventListener('pointerleave', onLeave);
  draw();
  return {
    start: loop.start, stop: loop.stop,
    destroy() { loop.stop(); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onMove); el.removeEventListener('pointerleave', onLeave); cv.destroy(); },
    bench(n = 60) { let t0 = performance.now(); for (let k = 0; k < n; k++) { tick(1 / 60); if (k % 2 === 0) mesh(true); paintFog(1 / 60, k % 3 === 0); } const a = (performance.now() - t0) / n; t0 = performance.now(); for (let k = 0; k < 10; k++) draw(); return { simMs: +a.toFixed(3), drawMs: +((performance.now() - t0) / 10).toFixed(2) }; },
    warp(sec) { const n = Math.round(sec / .05); for (let k = 0; k < n; k++) { tick(.05); paintFog(.05, false); } mesh(true); paintFog(.05, true); draw(); reads(); },
    pick() { const d = drones.find((q) => q.st === 'out' && q.alt > .9) || drones[0]; return [X(d.x), Y(d.y)]; },
    info() { return { phase, wallT: +wallT.toFixed(1), simT: Math.round(simT), cleared: nCleared, of: M.coll.length, found: nFound, total: M.peopleTotal, beta0: beta0(), outComp }; },
  };
}

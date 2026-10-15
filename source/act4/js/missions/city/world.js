// LIMINAL · Act 4 · mission "city": a city block after an earthquake, at blue hour (inspired by Kahramanmaraş and
// Antakya, February 2023). A district of mid-rise apartment blocks on a 3 x 2 street grid. In every district five blocks
// are damaged, each in its own way, and each has real floors with rooms that the drones search floor by floor:
//   soft    : soft-storey collapse. The ground storey is crushed into a crawl space (a 'void' layer), the floors above
//             dropped onto it and tilted a little.
//   lean    : the whole block leans 5 degrees toward its street; the front of the ground floor is crushed.
//   partial : one end has collapsed into a heap; the standing part is cut open like a doll's house, slabs hang down.
//   pancake : five floors pancaked into a 3.7 m stack; the crawl space between the bottom slabs is the 'void' layer and
//             holds a sealed air pocket (anchors.pocket, the beta-2 beat).
//   facade  : the street facade peeled off and lies across the road, windows still in it; the rooms are open.
// Letters A..E are given by distance from the staging square (A nearest). The other blocks stand, with windows,
// balconies, shops and rooftop tanks. Rubble spills into the streets (instanced chunks on soft mounds), cars, trees,
// street lights, a downed live wire, a burst water main, dust haze, and a blue-hour context city fading into fog.
//
// Contract: act4/ACT4_SPEC.md section 5.2. Notes on this world's fields:
//   layers: 'ground' (outdoor, 2 m cells) and one per searchable floor of each damaged block ('B0'..'B4', 'A0' void,
//     'D0' void ...; 0.5 m cells). y = floor surface (mean, world), band = [lowest floor y, highest + clear height]
//     (absolute world y), kind = 'outdoor' | 'floor' | 'void', building, floor, ceiling (clear height), yAt(x, z),
//     entries [{ pos (outside, world), in (inside), i, k }] = openings a drone can fly through from outside.
//   grid values: 0 open, 1 obstacle (walls, debris, trunks, buildings), 2 outside the search, 3 water, 4 hazard
//     (live wire, unsupported slab edge).
//   anchors.portals: stairs between floors { a, b, pos, posB }. anchors.buildings: per block id, type, layers, park
//     spot for a UGV, cut rect. anchors.pocket: { pos, size, volume, layer, building, cells }.
//   cutaway(level, building): level = world y (number) or a layer id ('B2' cuts 1.6 m above that floor, 'D0' 0.35 m);
//     building = 'A'..'E' or an array (default: every damaged block); cutaway(null) restores. Cut solids show a rose
//     poche; floor surfaces above the cut are hidden, shadows follow the cut.
export function buildWorld(THREE, { seed = 1, quality = 'high', props = null } = {}) {
  const T_START = (typeof performance !== 'undefined' ? performance : Date).now();
  const LOW = quality === 'low';
  const TAU = Math.PI * 2, HALF = Math.PI / 2;
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rngOf = (s) => { let a = (s >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const R = rngOf(Math.imul(seed | 0, 9301) + 49297), RJ = rngOf(Math.imul(seed | 0, 31) + 7);
  const rf = (a, b) => a + R() * (b - a), ri = (a, b) => a + Math.floor(R() * (b - a + 1)), chance = (p) => R() < p, pick = (a) => a[Math.floor(R() * a.length)];
  const jf = (a, b) => a + RJ() * (b - a);
  const snap = (x, s = .5) => Math.round(x / s) * s;
  const hash = (x, y, s) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const vnoise = (x, y, s) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  const fbm = (x, y, s, o = 3) => { let a = 0, amp = .5, f = 1, n = 0; for (let i = 0; i < o; i++) { a += amp * vnoise(x * f, y * f, s + i * 31); n += amp; f *= 2.03; amp *= .5; } return a / n; };
  const ccache = new Map(); const cc = (h) => { let c = ccache.get(h); if (!c) { c = new THREE.Color(h); ccache.set(h, c); } return c; };
  const mT = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z), mRx = (a) => new THREE.Matrix4().makeRotationX(a), mRy = (a) => new THREE.Matrix4().makeRotationY(a), mRz = (a) => new THREE.Matrix4().makeRotationZ(a);
  const mS = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
  const mm = (...a) => { const m = new THREE.Matrix4(); for (const b of a) m.multiply(b); return m; };
  const xf = (M, u, y, v) => V(u, y, v).applyMatrix4(M);
  const SEED = seed | 0;

  // ---------------------------------------------------------------- palette (sRGB; soft clay at blue hour)
  const PAL = {
    asphalt: '#4C4B73', walk: '#9C98B7', curb: '#B9B4CE', yard: '#827D9E', ctxYard: '#87839F', garden: '#6F8579', grass: '#7A8F80', path: '#B5ADBF', plaza: '#A7A2BE', plazaLine: '#B9B4CC',
    slab: '#C6BFCD', slabEdge: '#B3ABBF', plaster: '#EEE6E8', roof: '#B9B2C6', band: '#E6E0EA', tile: '#B98A86', debris: '#A49DB4',
    glass: '#4A5090', frame: '#E9E3EC', trunk: '#5E5266', pole: '#6E6B91', lampHead: '#DCD6E8', dark: '#3E3A60', tank: '#E2DEEA', solar: '#41497A',
    water: '#6F8FC0', van: '#ECE7EE', apricot: '#F6D2B1', danger: '#F08A7E', paper: '#F3EEF2', rescuer: '#5C5A86', mountain: '#5A5A94',
  };
  const FACADES = ['#E6DADB', '#DAD3E6', '#E9DCCD', '#D5D9E6', '#DFD1D9', '#E7DFD3', '#D8D0DE', '#E4D4D0', '#DCDCE4'];
  const CTX = ['#B4B0D2', '#B9B5D5', '#AFACCF', '#B6B2D1'];
  const TINTS = ['#EED7D5', '#DAE1EA', '#EBDFCB', '#D9E0D4', '#E5D9EB', '#EFE5DC', '#E1DDEA'];
  const FLOORC = { parquet: '#CBAA93', parquet2: '#C2A08E', tile: '#D2CEDA', terrazzo: '#DDD5CF', carpet: '#BBA9C2', bath: '#CAD8DF', concrete: '#BCB4C4' };
  const RUB = ['#A39DB8', '#B8B2C8', '#9089A8', '#C9C2D5', '#BC9894', '#CBA8A1', '#837E9C', '#D9D0D6', '#B0A9C1'];
  const CARS = ['#BBA9C6', '#9592C8', '#C9AAA8', '#D6CCD9', '#7477A6', '#A8B5CB', '#CCB9A3', '#9E9CB5', '#E3DEE6'];
  const FABRIC = ['#A3ACCB', '#C9A6AB', '#B7C4B5', '#D1BFA6', '#B3A6C9'];
  const WOOD = ['#C4A88F', '#B89A86', '#D1BBA2'];

  // ---------------------------------------------------------------- geometry builder: flat-shaded triangles + vertex colours
  function Builder(cap0 = 1 << 11) {
    let cap = cap0, n = 0, P = new Float32Array(cap * 3), N = new Float32Array(cap * 3), Cc = new Float32Array(cap * 3);
    let cr = 1, cg = 1, cb = 1;
    const B = { M: null, ao: null, jit: .045 };
    function grow(k) { if (n + k <= cap) return; while (n + k > cap) cap *= 2; const p = new Float32Array(cap * 3), q = new Float32Array(cap * 3), c = new Float32Array(cap * 3); p.set(P); q.set(N); c.set(Cc); P = p; N = q; Cc = c; }
    function put(x, y, z, nx, ny, nz) {
      const k = B.ao ? B.ao(x, y, z) : 1, M = B.M;
      if (M) { const e = M.elements; const X = e[0] * x + e[4] * y + e[8] * z + e[12], Y = e[1] * x + e[5] * y + e[9] * z + e[13], Z = e[2] * x + e[6] * y + e[10] * z + e[14]; const a = e[0] * nx + e[4] * ny + e[8] * nz, b = e[1] * nx + e[5] * ny + e[9] * nz, c = e[2] * nx + e[6] * ny + e[10] * nz; x = X; y = Y; z = Z; nx = a; ny = b; nz = c; }
      const i = n * 3; P[i] = x; P[i + 1] = y; P[i + 2] = z; N[i] = nx; N[i + 1] = ny; N[i + 2] = nz; Cc[i] = cr * k; Cc[i + 1] = cg * k; Cc[i + 2] = cb * k; n++;
    }
    B.color = (c, jit = B.jit) => { const j = 1 + (RJ() - .5) * 2 * jit; cr = c.r * j; cg = c.g * j; cb = c.b * j; return B; };
    B.tri = (ax, ay, az, bx, by, bz, qx, qy, qz) => {
      grow(3);
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = qx - ax, vy = qy - ay, vz = qz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      put(ax, ay, az, nx, ny, nz); put(bx, by, bz, nx, ny, nz); put(qx, qy, qz, nx, ny, nz);
    };
    B.quad = (ax, ay, az, bx, by, bz, qx, qy, qz, dx, dy, dz) => { B.tri(ax, ay, az, bx, by, bz, qx, qy, qz); B.tri(ax, ay, az, qx, qy, qz, dx, dy, dz); };
    // axis-aligned box in the current frame; mask bits: 1 +x, 2 -x, 4 +y, 8 -y, 16 +z, 32 -z; side = colour of the vertical faces
    B.box = (x0, y0, z0, x1, y1, z1, col, mask = 63, side = null) => {
      if (col) B.color(col);
      const tr = cr, tg = cg, tb = cb;
      if (mask & 4) B.quad(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0);
      if (mask & 8) B.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1);
      if (side) B.color(side);
      if (mask & 1) B.quad(x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1);
      if (mask & 2) B.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0);
      if (mask & 16) B.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1);
      if (mask & 32) B.quad(x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0);
      cr = tr; cg = tg; cb = tb;
    };
    // vertical frustum (cylinder / cone) around y; caps: 1 bottom, 2 top
    B.frustum = (cx, y0, cz, r0, r1, h, seg, col, caps = 3) => {
      if (col) B.color(col);
      for (let k = 0; k < seg; k++) {
        const a0 = k / seg * TAU, a1 = (k + 1) / seg * TAU, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        if (r1 > 1e-4) B.quad(cx + c0 * r0, y0, cz + s0 * r0, cx + c0 * r1, y0 + h, cz + s0 * r1, cx + c1 * r1, y0 + h, cz + s1 * r1, cx + c1 * r0, y0, cz + s1 * r0);
        else B.tri(cx + c0 * r0, y0, cz + s0 * r0, cx, y0 + h, cz, cx + c1 * r0, y0, cz + s1 * r0);
        if (caps & 2 && r1 > 1e-4) B.tri(cx, y0 + h, cz, cx + c1 * r1, y0 + h, cz + s1 * r1, cx + c0 * r1, y0 + h, cz + s0 * r1);
        if (caps & 1) B.tri(cx, y0, cz, cx + c0 * r0, y0, cz + s0 * r0, cx + c1 * r0, y0, cz + s1 * r0);
      }
    };
    // convex polygon [[x, z], ...] extruded from y0 to y1
    B.prism = (pts, y0, y1, col, side = null) => {
      let ar = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; ar += a[0] * b[1] - b[0] * a[1]; }
      const p = ar < 0 ? pts.slice().reverse() : pts;
      if (col) B.color(col);
      for (let i = 1; i + 1 < p.length; i++) { B.tri(p[0][0], y1, p[0][1], p[i + 1][0], y1, p[i + 1][1], p[i][0], y1, p[i][1]); B.tri(p[0][0], y0, p[0][1], p[i][0], y0, p[i][1], p[i + 1][0], y0, p[i + 1][1]); }
      if (side) B.color(side);
      for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; B.quad(a[0], y0, a[1], a[0], y1, a[1], b[0], y1, b[1], b[0], y0, b[1]); }
    };
    B.vtx = (x, y, z, nx, ny, nz, r, g, b) => { grow(1); const i = n * 3; P[i] = x; P[i + 1] = y; P[i + 2] = z; N[i] = nx; N[i + 1] = ny; N[i + 2] = nz; Cc[i] = r; Cc[i + 1] = g; Cc[i + 2] = b; n++; };
    B.count = () => n;
    B.geometry = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P.slice(0, n * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(N.slice(0, n * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(Cc.slice(0, n * 3), 3));
      g.computeBoundingSphere();
      return g;
    };
    return B;
  }
  const withM = (g, M, fn) => { const o = g.M; g.M = M; fn(); g.M = o; };
  function beam(g, x0, y0, z0, x1, y1, z1, w, col) {                   // a square bar between two world points
    const p0 = new THREE.Vector3(x0, y0, z0), p1 = new THREE.Vector3(x1, y1, z1), L = p0.distanceTo(p1); if (L < 1e-4) return;
    const dy = (y1 - y0) / L, M = new THREE.Matrix4().lookAt(p0, p1, Math.abs(dy) > .99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)); M.setPosition(p0);
    withM(g, M, () => g.box(-w / 2, -w / 2, -L, w / 2, w / 2, 0, col));
  }

  // ---------------------------------------------------------------- the district: 3 x 2 lots on a street grid, staging square to the west
  const H = 3, SLAB = .25, CEIL = H - SLAB, CELL = .5, GCELL = 2;
  const LX = 44, LZ = 34, RD = 9, SWK = 2.5, NXL = 3, NZL = 2;
  const DW = NXL * LX + (NXL + 1) * RD, DD = NZL * LZ + (NZL + 1) * RD, X0 = -DW / 2, Z0 = -DD / 2, X1 = X0 + DW, Z1 = Z0 + DD;
  const lotX = (i) => X0 + RD + i * (LX + RD), lotZ = (j) => Z0 + RD + j * (LZ + RD);
  const roadX = (i) => X0 + RD / 2 + i * (LX + RD), roadZ = (j) => Z0 + RD / 2 + j * (LZ + RD);
  const CI0 = -3, CI1 = 5, CJ0 = -3, CJ1 = 4;
  const PLAZA = { x0: lotX(-1), x1: X0, z0: lotZ(0), z1: lotZ(1) + LZ };
  const isPlazaLot = (i, j) => i === -1 && (j === 0 || j === 1);
  const inDistrict = (i, j) => i >= 0 && i < NXL && j >= 0 && j < NZL;
  function groundY(x, z) {
    if (x >= PLAZA.x0 && x <= PLAZA.x1 && z >= PLAZA.z0 && z <= PLAZA.z1) return .12;
    const i = Math.floor((x - X0 - RD) / (LX + RD)), j = Math.floor((z - Z0 - RD) / (LZ + RD));
    if (i < CI0 || i > CI1 || j < CJ0 || j > CJ1) return 0;
    const lx = x - lotX(i), lz = z - lotZ(j);
    return lx >= 0 && lx <= LX && lz >= 0 && lz <= LZ ? .15 : 0;
  }
  const MZ = roadZ(1);
  const PLZ = { x0: PLAZA.x0 + 13, x1: PLAZA.x1, z0: MZ - 21, z1: MZ + 21 };          // the paved staging area; lawns with trees around it
  const PLAZA_BEDS = [{ x0: PLAZA.x0 + 2, z0: PLAZA.z0 + 2, x1: PLAZA.x1 - 5, z1: PLZ.z0 - 2 }, { x0: PLAZA.x0 + 2, z0: PLZ.z1 + 2, x1: PLAZA.x1 - 5, z1: PLAZA.z1 - 2 }, { x0: PLAZA.x0 + 2, z0: PLZ.z0, x1: PLZ.x0 - 2, z1: PLZ.z1 }];                                       // the middle street, which leads out of the square
  const VANP = { x: X0 - 14, z: MZ - 5.2 };                  // the responders' van, facing the district (+x)
  const BASE = V(X0 - 12, .12, MZ + 7.5);                    // launch mat (drones lift off here)

  // ---------------------------------------------------------------- the blocks
  const jp = chance(.5) ? 0 : 1;                             // the small park sits in lot (0, jp), next to the square
  const tW = chance(.5) ? 'lean' : 'facade', tM = tW === 'lean' ? 'facade' : 'lean';
  const midT = chance(.5) ? ['soft', tM] : [tM, 'soft'], eastT = chance(.5) ? ['partial', 'pancake'] : ['pancake', 'partial'];
  const lotPlan = [{ i: 0, j: 1 - jp, dmg: tW }, { i: 1, j: 0, dmg: midT[0] }, { i: 1, j: 1, dmg: midT[1] }, { i: 2, j: 0, dmg: eastT[0] }, { i: 2, j: 1, dmg: eastT[1] }];
  const blds = [];
  const PSI = { '-z': 0, '+z': Math.PI, '-x': HALF, '+x': -HALF };
  for (const L of lotPlan) {
    const bx0 = lotX(L.i) + SWK + 1.5, bx1 = lotX(L.i) + LX - SWK - 1.5, bz0 = lotZ(L.j) + SWK + 1.5, bz1 = lotZ(L.j) + LZ - SWK - 1.5;
    const variant = pick(['a', 'a', 'c', 'b']), slots = [], di = chance(.5) ? 0 : 1;
    for (const s of [0, 1]) {
      // a partial collapse must open its broken end away from its neighbour: in side-by-side lots the end points out of the lot
      if (variant === 'a') { const W = snap(rf(15, 17.5)), D = snap(rf(11, 13)), front = s === di && L.dmg === 'partial' ? (s ? '-z' : '+z') : chance(.5) ? '-z' : '+z'; const xa = s ? bx1 - 17.5 : bx0; slots.push({ x0: snap(xa + rf(0, 17.5 - W)), z0: front === '-z' ? snap(bz0 + rf(0, 1)) : snap(bz1 - D - rf(0, 1)), xs: W, zs: D, W, D, front }); }
      else if (variant === 'c') { const W = snap(rf(17, 21)), D = snap(rf(11, 13)), front = s ? '+x' : '-x'; slots.push({ x0: s ? snap(bx1 - D - rf(0, 1)) : snap(bx0 + rf(0, 1)), z0: snap(bz0 + rf(0, 26 - W)), xs: D, zs: W, W, D, front }); }
      else { const W = snap(rf(18, 23)), D = snap(rf(11, 12)), front = s ? '+z' : '-z'; slots.push({ x0: snap(bx0 + rf(0, 36 - W)), z0: s ? snap(bz1 - D) : bz0, xs: W, zs: D, W, D, front }); }
    }
    slots.forEach((s, k) => {
      const type = k === di ? L.dmg : 'standing', psi = PSI[s.front], cx = s.x0 + s.xs / 2, cz = s.z0 + s.zs / 2;
      const M = mm(mT(cx, 0, cz), mRy(psi), mT(-s.W / 2, 0, -s.D / 2));
      const nF = { standing: ri(3, 5), soft: 4, lean: 5, partial: 5, pancake: 5, facade: 4 }[type];
      const col0 = pick(FACADES), col = type === 'standing' ? col0 : '#' + new THREE.Color(col0).lerp(new THREE.Color('#B9B2C5'), .45).getHexString();
      blds.push({ type, lot: L, x0: s.x0, z0: s.z0, x1: s.x0 + s.xs, z1: s.z0 + s.zs, W: s.W, D: s.D, nu: Math.round(s.W / CELL), nv: Math.round(s.D / CELL), front: s.front, psi, cx, cz, M, nF, col, floors: [], seed: ri(1, 1e9) });
    });
  }
  const dmg = blds.filter((b) => b.type !== 'standing').sort((a, b) => Math.hypot(a.cx - BASE.x, a.cz - BASE.z) - Math.hypot(b.cx - BASE.x, b.cz - BASE.z));
  dmg.forEach((b, k) => { b.id = 'ABCDE'[k]; b.name = 'building ' + b.id; });
  blds.filter((b) => b.type === 'standing').forEach((b, k) => { b.id = 'S' + (k + 1); });
  const byType = (t) => dmg.find((b) => b.type === t);
  const frontDir = (b) => V(-Math.sin(b.psi), 0, -Math.cos(b.psi));      // outward normal of the plan's front (v = 0)
  const uDir = (b) => V(Math.cos(b.psi), 0, -Math.sin(b.psi));            // the plan's u axis in the world

  // ---------------------------------------------------------------- floor plans: a corridor along the long axis, rooms both sides, a stair
  function makePlan(nu, nv) {
    const N = nu * nv, cells = new Uint8Array(N), rid = new Int16Array(N).fill(-1), walls = [], rooms = [];
    const cr = Math.floor(nv / 2) - 2, cn = cr + 4;
    const W = (o, at, a, b, ext, face) => { const w = { o, at, a, b, ext: !!ext, face, gaps: [], tint: pick(TINTS) }; walls.push(w); return w; };
    const wF = W('h', 0, 0, nu - 1, 1, 'front'), wB = W('h', nv - 1, 0, nu - 1, 1, 'back'), wL = W('v', 0, 1, nv - 2, 1, 'left'), wR = W('v', nu - 1, 1, nv - 2, 1, 'right');
    const wCs = W('h', cr, 1, nu - 2), wCn = W('h', cn, 1, nu - 2);
    rooms.push({ id: 0, kind: 'corridor', c0: 1, c1: nu - 2, r0: cr + 1, r1: cn - 1, side: 'c' });
    const sides = [{ side: 's', r0: 1, r1: cr - 1, cw: wCs, ew: wF }, { side: 'n', r0: cn + 1, r1: nv - 2, cw: wCn, ew: wB }];
    for (const S of sides) {
      const cuts = []; let c = 0;
      for (;;) { const nx = c + ri(7, 10); if (nx > nu - 8) break; cuts.push(nx); c = nx; }
      const xs = [0, ...cuts, nu - 1];
      for (let k = 0; k + 1 < xs.length; k++) rooms.push({ id: rooms.length, kind: 'room', c0: xs[k] + 1, c1: xs[k + 1] - 1, r0: S.r0, r1: S.r1, side: S.side, cw: S.cw, ew: S.ew, left: k === 0, right: k + 2 === xs.length });
      S.parts = cuts.map((cx) => W('v', cx, S.r0, S.r1));
    }
    let stair = null, bd = 1e9;
    for (const r of rooms) if (r.side === 'n' && r.c1 - r.c0 + 1 >= 5) { const d = Math.abs((r.c0 + r.c1) / 2 - nu / 2); if (d < bd) { bd = d; stair = r; } }
    if (stair) stair.kind = 'stair';
    for (const r of rooms) {
      if (r.kind === 'corridor') continue;
      const w = r.c1 - r.c0 + 1, h = r.r1 - r.r0 + 1;
      if (r.kind === 'stair') { const a = r.c0 + Math.max(0, Math.floor((w - 4) / 2)); r.cw.gaps.push({ a, b: a + Math.min(3, w - 1), kind: 'wide' }); }
      else { const d = ri(r.c0 + 1, Math.max(r.c0 + 1, r.c1 - 2)); r.cw.gaps.push({ a: d, b: d + 1, kind: 'door' }); r.door = d; }
      const nw = r.kind === 'stair' ? 1 : (w >= 11 ? 2 : 1), ww = r.kind === 'stair' ? 2 : 3;
      for (let k = 0; k < nw; k++) { const a = clamp(Math.round(r.c0 + w * (k + .5) / nw - ww / 2), r.c0, r.c1 - ww + 1); r.ew.gaps.push({ a, b: a + ww - 1, kind: 'window' }); }
      const sa = clamp(Math.round(r.r0 + h / 2 - 1.5), r.r0, r.r1 - 2);
      if (r.left && r.kind !== 'stair' && chance(.6)) wL.gaps.push({ a: sa, b: sa + 2, kind: 'window' });
      if (r.right && r.kind !== 'stair' && chance(.6)) wR.gaps.push({ a: sa, b: sa + 2, kind: 'window' });
    }
    wL.gaps.push({ a: cr + 1, b: cr + 3, kind: 'window' }); wR.gaps.push({ a: cr + 1, b: cr + 3, kind: 'window' });
    for (const S of sides) for (const w of S.parts) if (chance(.4)) { const a = ri(S.r0 + 1, Math.max(S.r0 + 1, S.r1 - 2)); w.gaps.push({ a, b: a + 1, kind: 'door' }); }
    const at = (w, t) => (w.o === 'h' ? w.at * nu + t : t * nu + w.at);
    for (const w of walls) for (let t = w.a; t <= w.b; t++) cells[at(w, t)] = 1;
    for (const w of walls) for (const q of w.gaps) for (let t = q.a; t <= q.b; t++) cells[at(w, t)] = 0;
    for (const r of rooms) for (let rr = r.r0; rr <= r.r1; rr++) for (let c = r.c0; c <= r.c1; c++) rid[rr * nu + c] = r.id;
    return { nu, nv, cells, rid, rooms, walls, cr, cn, stair };
  }
  const clonePlan = (p) => ({ ...p, cells: p.cells.slice(), rooms: p.rooms.map((r) => ({ ...r })), walls: p.walls.map((w) => ({ ...w, gaps: w.gaps.slice() })) });
  function assignRooms(plan) {
    for (const r of plan.rooms) {
      if (r.kind === 'corridor' || r.kind === 'stair') { r.use = r.kind; r.floor = 'terrazzo'; continue; }
      const area = (r.c1 - r.c0 + 1) * (r.r1 - r.r0 + 1) * CELL * CELL;
      r.use = area < 10 ? (chance(.5) ? 'bath' : 'kitchen') : pick(['bed', 'bed', 'living', 'kitchen']);
      r.floor = r.use === 'bath' ? 'bath' : r.use === 'kitchen' ? 'tile' : chance(.25) ? 'carpet' : chance(.5) ? 'parquet' : 'parquet2';
      r.tint = pick(TINTS); r.fab = pick(FABRIC); r.wood = pick(WOOD);
    }
  }

  // ---------------------------------------------------------------- crawl spaces in crushed storeys: chambers joined by narrow voids (+ a sealed pocket)
  function makeVoid(nu, nv, { pocket = false, sides = ['front', 'left'], K = 6 } = {}) {
    const N = nu * nv, cells = new Uint8Array(N).fill(1), res = new Uint8Array(N);
    let pk = null;
    if (pocket) {
      for (let t = 0; t < 300 && !pk; t++) { const c = ri(5, nu - 8), r = ri(5, nv - 7); if (Math.abs(c + 1 - nu / 2) < nu * .38) pk = { c0: c, r0: r, c1: c + 2, r1: r + 1 }; }
      if (!pk) pk = { c0: (nu >> 1) - 1, r0: (nv >> 1) - 1, c1: (nu >> 1) + 1, r1: nv >> 1 };
      for (let r = pk.r0 - 2; r <= pk.r1 + 2; r++) for (let c = pk.c0 - 2; c <= pk.c1 + 2; c++) res[r * nu + c] = 1;
    }
    const nodes = [];
    for (let t = 0; t < 600 && nodes.length < K; t++) { const c = ri(3, nu - 4), r = ri(3, nv - 4); if (res[r * nu + c]) continue; if (nodes.every((q) => Math.abs(q.c - c) + Math.abs(q.r - r) > 8)) nodes.push({ c, r }); }
    const entries = [];
    for (const s of sides) {
      for (let t = 0; t < 50; t++) {
        let c, r;
        if (s === 'front') { r = 0; c = ri(3, nu - 4); } else if (s === 'back') { r = nv - 1; c = ri(3, nu - 4); } else if (s === 'left') { c = 0; r = ri(3, nv - 4); } else { c = nu - 1; r = ri(3, nv - 4); }
        let bad = false; for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) { const rr = r + dr, c2 = c + dc; if (rr >= 0 && rr < nv && c2 >= 0 && c2 < nu && res[rr * nu + c2]) bad = true; }
        if (!bad) { entries.push({ c, r, side: s }); break; }
      }
    }
    const border = (c, r) => c === 0 || r === 0 || c === nu - 1 || r === nv - 1;
    const cost = new Float32Array(N); for (let i = 0; i < N; i++) cost[i] = 1 + 3 * hash(i % nu, (i / nu) | 0, SEED + nu);
    const d = new Float32Array(N), pv = new Int32Array(N), done = new Uint8Array(N), heap = [];
    const hpush = (v) => { heap.push(v); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (d[heap[p]] <= d[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const hpop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && d[heap[l]] < d[heap[m]]) m = l; if (r < heap.length && d[heap[r]] < d[heap[m]]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    function path(a, b) {                                                 // Dijkstra on noisy costs, avoiding the pocket's shell and the rim
      const s = a.r * nu + a.c, e = b.r * nu + b.c; d.fill(1e9); pv.fill(-1); done.fill(0); heap.length = 0; d[s] = 0; hpush(s);
      for (;;) {
        if (!heap.length) break; const u = hpop(); if (done[u]) continue;
        if (u === e) break; done[u] = 1;
        const uc = u % nu, ur = (u / nu) | 0;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c = uc + dc, r = ur + dr; if (c < 0 || r < 0 || c >= nu || r >= nv) continue; const v = r * nu + c;
          if (res[v] || (border(c, r) && v !== e)) continue;
          const w = d[u] + cost[v]; if (w < d[v]) { d[v] = w; pv[v] = u; hpush(v); }
        }
      }
      const out = []; for (let v = e; v >= 0; v = pv[v]) { out.push(v); if (v === s) break; } return out;
    }
    const carve = (v) => { if (!res[v]) cells[v] = 0; };
    for (const q of nodes) { const rad = 1 + RJ() * 1.6; for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) { const c = q.c + dc, r = q.r + dr; if (border(c, r) || c < 1 || r < 1 || c > nu - 2 || r > nv - 2) continue; if (dc * dc * .8 + dr * dr * 1.2 <= rad * rad + RJ()) carve(r * nu + c); } }
    const all = nodes.concat(entries), inT = new Uint8Array(all.length); inT[0] = 1;
    for (let it = 1; it < all.length; it++) {                            // spanning tree, nearest pair first
      let best = null, bd2 = 1e9;
      for (let i = 0; i < all.length; i++) if (inT[i]) for (let j = 0; j < all.length; j++) if (!inT[j]) { const d = Math.abs(all[i].c - all[j].c) + Math.abs(all[i].r - all[j].r); if (d < bd2) { bd2 = d; best = [i, j]; } }
      if (!best) break; inT[best[1]] = 1;
      for (const v of path(all[best[0]], all[best[1]])) { carve(v); const c = v % nu, r = (v / nu) | 0; if (RJ() < .35 && !border(c, r)) { const w = RJ() < .5 ? v + 1 : v + nu; const c2 = w % nu, r2 = (w / nu) | 0; if (r2 < nv - 1 && c2 < nu - 1 && !border(c2, r2)) carve(w); } }
    }
    for (const e of entries) cells[e.r * nu + e.c] = 0;
    if (pk) for (let r = pk.r0; r <= pk.r1; r++) for (let c = pk.c0; c <= pk.c1; c++) cells[r * nu + c] = 0;
    return { nu, nv, cells, rid: new Int16Array(N).fill(-1), rooms: [], walls: [], entries, pocket: pk, nodes };
  }

  // ---------------------------------------------------------------- per-type floors (plans, frames, modifications)
  const SOFT_DROP = -2.15, SOFT_TILT = 2.1 * Math.PI / 180, SOFT_SLIDE = -.75;
  for (const b of dmg) {
    const base = makePlan(b.nu, b.nv);
    b.basePlan = base;
    const F = (f, kind, plan, FM, yF, ceil) => { const fl = { id: b.id + f, b, f, kind, plan, FM, yF, ceil, mods: [] }; b.floors.push(fl); return fl; };
    if (b.type === 'soft') {
      b.Mu = mm(b.M, mT(0, SOFT_DROP, SOFT_SLIDE), mRz(SOFT_TILT));
      b.slabBottom = (u) => 3 + SOFT_DROP + u * Math.sin(SOFT_TILT);
      const vp = makeVoid(b.nu, b.nv, { sides: ['front', chance(.5) ? 'left' : 'right', 'back'], K: 5 });
      F(0, 'void', vp, b.M, SLAB, b.slabBottom(0) - SLAB);
      for (let f = 1; f < b.nF; f++) { const p = clonePlan(base); assignRooms(p); F(f, 'floor', p, b.Mu, f * H + SLAB, CEIL); }
      b.roof = { FM: b.Mu, y: b.nF * H };
    } else if (b.type === 'lean') {
      b.lean = rf(5.6, 6.8) * Math.PI / 180;
      b.Mb = mm(b.M, mT(0, 0, b.D / 2), mRx(-b.lean), mT(0, 0, -b.D / 2));
      for (let f = 0; f < b.nF; f++) { const p = clonePlan(base); assignRooms(p); const fl = F(f, 'floor', p, b.Mb, f * H + SLAB, CEIL); if (f === 0) fl.mods.push({ t: 'crush', c0: 1, c1: b.nu - 2, r0: 1, r1: 3 }); }
      b.roof = { FM: b.Mb, y: b.nF * H };
    } else if (b.type === 'partial') {
      b.cutCol = clamp(Math.round(b.nu * rf(.55, .64)), 13, b.nu - 9);
      b.uCut = (b.cutCol + 1) * CELL;
      for (let f = 0; f < b.nF; f++) {
        const p = clonePlan(base); assignRooms(p);
        for (let r = 0; r < b.nv; r++) for (let c = b.cutCol; c < b.nu; c++) p.cells[r * b.nu + c] = c === b.cutCol ? 4 : 2;
        F(f, 'floor', p, b.M, f * H + SLAB, CEIL);
      }
      b.roof = { FM: b.M, y: b.nF * H, uMax: b.uCut };
    } else if (b.type === 'pancake') {
      const vp = makeVoid(b.nu, b.nv, { pocket: true, sides: ['front', 'back', chance(.5) ? 'left' : 'right'], K: 7 });
      b.slabBottom = () => .85;
      F(0, 'void', vp, b.M, SLAB, .85 - SLAB);
    } else if (b.type === 'facade') {
      for (let f = 0; f < b.nF; f++) {
        const p = clonePlan(base); assignRooms(p);
        if (f > 0) for (let c = 1; c < b.nu - 1; c++) p.cells[c] = 4;
        F(f, 'floor', p, b.M, f * H + SLAB, CEIL);
      }
      b.roof = { FM: b.M, y: b.nF * H, noFront: true };
    }
    // fallen ceiling pieces (the voids next to them are where people survive)
    for (const fl of b.floors) {
      if (fl.kind !== 'floor') continue;
      const p = fl.plan, want = b.type === 'lean' ? (fl.f > 0 ? ri(0, 1) : 0) : ri(0, 2);
      const cand = p.rooms.filter((r) => r.kind === 'room' && r.c1 - r.c0 >= 6 && r.r1 - r.r0 >= 6 && p.cells[r.r0 * p.nu + r.c0] !== 2 && p.cells[r.r0 * p.nu + r.c1] !== 2 && p.cells[r.r0 * p.nu + r.c1 + 1] !== 4);
      for (let k = 0; k < want && cand.length; k++) {
        const r = cand.splice(Math.floor(R() * cand.length), 1)[0];
        const w = ri(3, Math.min(5, r.c1 - r.c0 - 2)), h = ri(3, Math.min(5, r.r1 - r.r0 - 2));
        const c0 = chance(.5) ? r.c0 + 1 : r.c1 - w, r0 = r.side === 's' ? r.r0 : r.r1 - h + 1;
        fl.mods.push({ t: 'fallen', c0, c1: c0 + w - 1, r0, r1: r0 + h - 1, hi: rf(.9, 1.6), dir: chance(.5) ? 1 : -1, room: r });
      }
      for (const m of fl.mods) for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) { const i = r * p.nu + c; if (p.cells[i] === 0) p.cells[i] = 1; }
    }
  }

  // ---------------------------------------------------------------- rubble outdoors: spills around the damaged blocks + piles in the streets
  const worldRect = (M, u0, v0, u1, v1, ys = [0]) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const y of ys) for (const [u, v] of [[u0, v0], [u1, v0], [u0, v1], [u1, v1]]) { const p = xf(M, u, y, v); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); } return { x0, z0, x1, z1 }; };
  const masks = [], spills = [], blockers = [];
  for (const b of blds) {
    if (b.type === 'partial') masks.push(worldRect(b.M, 0, 0, b.uCut + .7, b.D));
    else masks.push({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 });
    const fr = frontDir(b), ud = uDir(b), thF = Math.atan2(fr.z, fr.x), thU = Math.atan2(ud.z, ud.x);
    const S = (o) => { const s = { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, seed: ri(1, 9999), notch: [], hole: [], b, ...o }; spills.push(s); return s; };
    if (b.type === 'soft') b.spill = S({ h0: .62, base: 3, lobe: 2.5, dir: thF });
    else if (b.type === 'lean') b.spill = S({ h0: 1.25, base: 2.6, lobe: 4.5, dir: thF });
    else if (b.type === 'pancake') b.spill = S({ h0: 1.55, base: 4.2, lobe: 3.5, dir: rf(-Math.PI, Math.PI) });
    else if (b.type === 'facade') b.spill = S({ h0: .75, base: 2.4, lobe: 3.5, dir: thF });
    else if (b.type === 'partial') { const r = worldRect(b.M, b.uCut + .7, 0, b.W, b.D); b.heapPeak = rf(.4, .48) * b.nF * H; b.spill = S({ ...r, h0: 2.3, base: 3.8, lobe: rf(6, 8.5), dir: thU, heap: { peak: b.heapPeak, M: b.M, u0: b.uCut + .7, len: b.W - b.uCut } }); }
  }
  // facade chunks fallen into one or two more streets (never on the street out of the square)
  for (let n = ri(1, 2), t = 0; n > 0 && t < 30; t++) {
    const horiz = chance(.5), i = horiz ? ri(0, NXL - 1) : ri(0, NXL), j = horiz ? ri(0, NZL) : ri(0, NZL - 1);
    if (horiz && j === 1 && i === 0) continue;
    const along = rf(.3, .7), x = horiz ? lotX(i) + along * LX : roadX(i), z = horiz ? roadZ(j) : lotZ(j) + along * LZ;
    if (spills.some((s) => s.pile && Math.hypot(s.cx - x, s.cz - z) < 30)) continue;
    const off = rf(-2.5, 2.5);
    spills.push({ pile: true, cx: horiz ? x : x + off, cz: horiz ? z + off : z, x0: x, z0: z, x1: x, z1: z, h0: rf(1.1, 1.5), base: rf(3.5, 5), lobe: 2, dir: horiz ? 0 : HALF, seed: ri(1, 9999), notch: [], hole: [] }); n--;
  }
  let spillScale = 1;
  function spillH(s, x, z) {
    for (const h of s.hole) if (x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1) return 0;
    const dx = Math.max(s.x0 - x, 0, x - s.x1), dz = Math.max(s.z0 - z, 0, z - s.z1);
    const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2, th = Math.atan2(z - cz, x - cx);
    const n1 = fbm(x * .11 + s.seed * .01, z * .11, s.seed, 3), n2 = fbm(x * .37, z * .37, s.seed + 7, 3);
    let h;
    if (dx === 0 && dz === 0) {
      if (!s.heap) return 0;
      const L = new THREE.Vector3(x, 0, z).applyMatrix4(s.heap.inv), a = clamp((L.x - s.heap.u0) / s.heap.len, 0, 1);
      const e = Math.min(x - s.x0, s.x1 - x, z - s.z0, s.z1 - z);
      h = s.h0 + (s.heap.peak - s.h0) * smooth(0, 4.5, e) * (1 - .5 * a) * (.85 + .3 * n2) + Math.max(0, 1 - (L.x - s.heap.u0) / 3) * s.heap.peak * .18;
    } else {
      const d = Math.hypot(dx, dz), reach = (s.base * (.7 + .6 * n1) + s.lobe * Math.pow(Math.max(0, Math.cos(th - s.dir)), 3)) * spillScale;
      if (d >= reach) return 0;
      h = s.h0 * Math.pow(1 - d / reach, 1.5) * (.72 + .56 * n2);
    }
    for (const q of s.notch) { const dd = Math.hypot(x - q.x, z - q.z); if (dd < q.r) h *= smooth(q.r * .3, q.r, dd); }
    return h;
  }
  for (const s of spills) {
    if (s.heap) s.heap.inv = s.heap.M.clone().invert();
    const m = s.base * 1.3 + s.lobe + 1; s.bx0 = s.x0 - m; s.bx1 = s.x1 + m; s.bz0 = s.z0 - m; s.bz1 = s.z1 + m;
  }
  function rubbleRaw(x, z) {
    for (const m of masks) if (x > m.x0 && x < m.x1 && z > m.z0 && z < m.z1) return 0;
    let h = 0; for (const s of spills) { if (x < s.bx0 || x > s.bx1 || z < s.bz0 || z > s.bz1) continue; const v = spillH(s, x, z); if (v > h) h = v; }
    return h;
  }
  // notches where the crawl spaces open to the outside, so a drone can get in
  for (const b of dmg) for (const fl of b.floors) if (fl.kind === 'void') for (const e of fl.plan.entries) {
    const u = (e.c + .5) * CELL + (e.side === 'left' ? -1.2 : e.side === 'right' ? 1.2 : 0), v = (e.r + .5) * CELL + (e.side === 'front' ? -1.2 : e.side === 'back' ? 1.2 : 0);
    const p = xf(fl.FM, u, 0, v); b.spill.notch.push({ x: p.x, z: p.z, r: 2.8 });
  }

  // ---------------------------------------------------------------- the fallen facade of the 'facade' block (lies across its street)
  const E = byType('facade');
  if (E) {
    E.kick = rf(.8, 1.6); E.panels = [];
    const cuts = [0, snap(E.W * rf(.3, .42)), snap(E.W * rf(.6, .72)), E.W];
    for (let k = 0; k < 3; k++) {
      const ua = cuts[k] + (k ? rf(.25, .6) : 0), ub = cuts[k + 1] - (k < 2 ? rf(.2, .5) : 0);
      const PM = mm(E.M, mT(0, .16 + k * .04, -E.kick - rf(0, .9)), mRy(rf(-.05, .05)), mRz(rf(-.025, .025)), mRx(-HALF));
      const Hp = (E.nF - 1) * H, r = worldRect(PM, ua, 0, ub, Hp, [0, .3]);
      E.panels.push({ ua, ub, PM, Hp, rect: r }); blockers.push({ ...r, h: .6 });
      E.spill.hole.push({ x0: r.x0 + .3, z0: r.z0 + .3, x1: r.x1 - .3, z1: r.z1 - .3 });
    }
  }

  // ---------------------------------------------------------------- hazards: a downed utility pole with a live wire, a burst water main
  const hazard = { poles: [], wire: null, pool: null };
  {
    const cand = [];
    for (let i = 0; i < NXL; i++) for (const j of [0, NZL]) cand.push({ horiz: true, i, j });
    for (const i of [NXL]) for (let j = 0; j < NZL; j++) cand.push({ horiz: false, i, j });
    const s = pick(cand), n = 4, sideOff = s.horiz ? (s.j === 0 ? 1 : -1) : -1;
    for (let k = 0; k < n; k++) {
      const t = (k + .5) / n, x = s.horiz ? lotX(s.i) + t * LX : roadX(s.i) - sideOff * (RD / 2 + .6), z = s.horiz ? roadZ(s.j) + sideOff * (RD / 2 + .6) : lotZ(s.j) + t * LZ;
      hazard.poles.push({ x, z });
    }
    const fk = ri(1, 2), fp = hazard.poles[fk];
    fp.fallen = true;
    // the pole falls across the street; its top lies on the far lane
    const L = 8.5;
    fp.top = { x: fp.x + (s.horiz ? rf(-1.5, 1.5) : -sideOff * L * .92), z: fp.z + (s.horiz ? -sideOff * L * .92 : rf(-1.5, 1.5)) };
    hazard.wire = { x: fp.top.x, z: fp.top.z, seg: s };
    hazard.seg = s;
  }
  {
    // the water main bursts at a crossing, away from the rubble and the square
    const nodes = []; for (let j = 0; j <= NZL; j++) for (let i = 1; i <= NXL; i++) nodes.push({ x: roadX(i), z: roadZ(j) });
    for (let t = 0; t < 20; t++) { const q = pick(nodes), x = q.x + rf(-3, 3), z = q.z + rf(-3, 3); if (rubbleRaw(x, z) > 0 || rubbleRaw(x + 4, z) > 0 || rubbleRaw(x - 4, z) > 0 || Math.hypot(x - hazard.wire.x, z - hazard.wire.z) < 25) continue; hazard.pool = { x, z, r: rf(3.2, 4.6), seed: ri(1, 999) }; break; }
  }
  const inPool = (x, z) => { const p = hazard.pool; if (!p) return false; const a = Math.atan2(z - p.z, x - p.x), rr = p.r * (.75 + .5 * vnoise(Math.cos(a) * 2 + 3, Math.sin(a) * 2, p.seed)); return Math.hypot(x - p.x, z - p.z) < rr; };
  const onWire = (x, z) => { const w = hazard.wire, fp = hazard.poles.find((p) => p.fallen); if (!w) return false; if (Math.hypot(x - w.x, z - w.z) < 3.2) return true; const ax = fp.x, az = fp.z, bx = w.x, bz = w.z, l2 = (bx - ax) ** 2 + (bz - az) ** 2, t = clamp(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2, 0, 1); return Math.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t)) < 1.4; };

  // ---------------------------------------------------------------- street graph and the UGV routes (re-planned with smaller spills if needed)
  const HXN = Math.ceil(DW + 24), HZN = Math.ceil(DD + 24), HX0 = X0 - 12, HZ0 = Z0 - 12;
  let HF = null;
  function sampleHF() { HF = new Float32Array((HXN + 1) * (HZN + 1)); for (let k = 0; k <= HZN; k++) for (let i = 0; i <= HXN; i++) HF[k * (HXN + 1) + i] = rubbleRaw(HX0 + i, HZ0 + k); }
  function rubbleH(x, z) {
    const fx = x - HX0, fz = z - HZ0; if (fx < 0 || fz < 0 || fx >= HXN || fz >= HZN) return 0;
    const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k, W1 = HXN + 1;
    const a = HF[k * W1 + i], b = HF[k * W1 + i + 1], c = HF[(k + 1) * W1 + i], d = HF[(k + 1) * W1 + i + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  const obstacleAt = (x, z) => { let h = rubbleH(x, z); for (const q of blockers) if (x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1) h = Math.max(h, q.h); if (onWire(x, z)) h = 9; return h; };
  function clearRun(ax, az, bx, bz) {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L)), ux = (bx - ax) / L, uz = (bz - az) / L, px = -uz, pz = ux;
    for (let k = 0; k <= n; k++) { const t = Math.min(L, k), x = ax + ux * t, z = az + uz * t; let run = 0, best = 0; for (let o = -3.75; o <= 3.75; o += .5) { if (obstacleAt(x + px * o, z + pz * o) < .45) { run++; best = Math.max(best, run); } else run = 0; } if (best < 6) return false; }
    return true;
  }
  const NN = (NXL + 1) * (NZL + 1), nodeXZ = (n) => [roadX(n % (NXL + 1)), roadZ((n / (NXL + 1)) | 0)];
  const startNode = 1 * (NXL + 1) + 0, START = V(X0 - 3, 0, MZ);
  let routes = [], routeTargets = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    sampleHF();
    const open = new Map();
    const edgeOK = (a, b) => { const k = a < b ? a + ',' + b : b + ',' + a; if (!open.has(k)) { const [ax, az] = nodeXZ(a), [bx, bz] = nodeXZ(b); open.set(k, clearRun(ax, az, bx, bz)); } return open.get(k); };
    const D = new Float64Array(NN).fill(1e9), PV = new Int16Array(NN).fill(-1), done = new Uint8Array(NN); D[startNode] = 0;
    for (;;) {
      let u = -1, bd = 1e9; for (let i = 0; i < NN; i++) if (!done[i] && D[i] < bd) { bd = D[i]; u = i; } if (u < 0) break; done[u] = 1;
      const i = u % (NXL + 1), j = (u / (NXL + 1)) | 0;
      for (const [di2, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const i2 = i + di2, j2 = j + dj; if (i2 < 0 || j2 < 0 || i2 > NXL || j2 > NZL) continue; const v = j2 * (NXL + 1) + i2; if (!edgeOK(u, v)) continue; const w = D[u] + (dj ? LZ + RD : LX + RD); if (w < D[v]) { D[v] = w; PV[v] = u; } }
    }
    routes = []; routeTargets = [];
    const targets = ['pancake', 'partial', 'soft'].map(byType).filter(Boolean);
    let ok = true;
    for (const b of targets) {
      const li = b.lot.i, lj = b.lot.j, cand = [];
      const segs = [{ a: lj * (NXL + 1) + li, c: lj * (NXL + 1) + li + 1, side: 'n' }, { a: (lj + 1) * (NXL + 1) + li, c: (lj + 1) * (NXL + 1) + li + 1, side: 's' }, { a: lj * (NXL + 1) + li, c: (lj + 1) * (NXL + 1) + li, side: 'w' }, { a: lj * (NXL + 1) + li + 1, c: (lj + 1) * (NXL + 1) + li + 1, side: 'e' }];
      for (const s of segs) {
        const [ax, az] = nodeXZ(s.a), [cx2, cz2] = nodeXZ(s.c), horiz = az === cz2;
        const t = horiz ? clamp(b.cx, Math.min(ax, cx2) + 7, Math.max(ax, cx2) - 7) : clamp(b.cz, Math.min(az, cz2) + 7, Math.max(az, cz2) - 7);
        const off = 2.3 * (s.side === 'n' ? 1 : s.side === 's' ? -1 : s.side === 'w' ? 1 : -1);
        const px = horiz ? t : ax + off, pz = horiz ? az + off : t;
        if (obstacleAt(px, pz) > .3) continue;
        for (const end of [s.a, s.c]) { if (D[end] > 1e8) continue; const [ex, ez] = nodeXZ(end); if (!clearRun(ex, ez, horiz ? px : ex, horiz ? ez : pz)) continue; cand.push({ end, px, pz, score: D[end] + Math.hypot(px - ex, pz - ez) + Math.hypot(px - b.cx, pz - b.cz) * 6 }); }
      }
      if (!cand.length) { ok = false; break; }
      cand.sort((p, q) => p.score - q.score);
      const c0 = cand[0], pts = [V(VANP.x + 5, 0, VANP.z + 2.5), START.clone()];
      const chain = []; for (let v = c0.end; v >= 0; v = PV[v]) { chain.push(v); if (v === startNode) break; }
      chain.reverse().forEach((v) => { const [x, z] = nodeXZ(v); pts.push(V(x, 0, z)); });
      const [ex, ez] = nodeXZ(c0.end), horizEnd = Math.abs(c0.pz - ez) < 3.5;
      pts.push(V(horizEnd ? c0.px : ex, 0, horizEnd ? ez : c0.pz)); pts.push(V(c0.px, 0, c0.pz));
      b.park = V(c0.px, groundY(c0.px, c0.pz), c0.pz); for (const q of pts) q.y = groundY(q.x, q.z); routes.push(pts); routeTargets.push(b.id);
    }
    if (ok && routes.length >= 2) break;
    spillScale *= .8;
  }

  // ---------------------------------------------------------------- searchable layers
  const layers = [], layerById = {};
  function raster(fl) {
    const { plan, FM, yF } = fl, nu = plan.nu, nv = plan.nv, e = FM.elements;
    const ax = e[0], az = e[2], bx = e[8], bz = e[10], ox = e[4] * yF + e[12], oy = e[5] * yF + e[13], oz = e[6] * yF + e[14];
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9, ymin = 1e9, ymax = -1e9;
    for (const [u, v] of [[0, 0], [nu * CELL, 0], [0, nv * CELL], [nu * CELL, nv * CELL]]) { const x = ox + ax * u + bx * v, z = oz + az * u + bz * v, y = oy + e[1] * u + e[9] * v; minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
    const x0 = Math.floor(minx / CELL + 1e-6) * CELL - CELL, z0 = Math.floor(minz / CELL + 1e-6) * CELL - CELL;
    const nx = Math.ceil((maxx - x0) / CELL - 1e-6) + 1, nz = Math.ceil((maxz - z0) / CELL - 1e-6) + 1;
    const grid = new Uint8Array(nx * nz).fill(2), det = ax * bz - bx * az;
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const x = x0 + (i + .5) * CELL - ox, z = z0 + (k + .5) * CELL - oz, u = (x * bz - bx * z) / det, v = (ax * z - az * x) / det;
      const cu = Math.floor(u / CELL), cv = Math.floor(v / CELL);
      if (cu >= 0 && cu < nu && cv >= 0 && cv < nv) grid[k * nx + i] = plan.cells[cv * nu + cu];
    }
    const yAt = (x, z) => { const dx = x - ox, dz = z - oz, u = (dx * bz - bx * dz) / det, v = (ax * dz - az * dx) / det; return oy + e[1] * u + e[9] * v; };
    const L = { id: fl.id, kind: fl.kind, building: fl.b.id, floor: fl.f, y: (ymin + ymax) / 2, yMin: ymin, yMax: ymax, band: [ymin, ymax + fl.ceil], ceiling: fl.ceil, cell: CELL, x0, z0, nx, nz, grid, yAt, entries: [] };
    fl.layer = L; layers.push(L); layerById[L.id] = L;
    return L;
  }
  // outdoor layer
  const GX0 = X0 - 38, GZ0 = Z0 - 6, GNX = Math.ceil((DW + 46) / GCELL), GNZ = Math.ceil((DD + 12) / GCELL);
  const ground = { id: 'ground', kind: 'outdoor', y: 0, band: [-1, 8], ceiling: 60, cell: GCELL, x0: GX0, z0: GZ0, nx: GNX, nz: GNZ, grid: new Uint8Array(GNX * GNZ), yAt: (x, z) => groundY(x, z) + rubbleH(x, z), entries: [] };
  layers.push(ground); layerById.ground = ground;
  for (const b of dmg) for (const fl of b.floors) raster(fl);

  // openings to the outside (windows, open edges, crawl-space mouths) that are not buried under rubble
  function computeEntries(L) {
    const { nx, nz, grid } = L, seen = new Uint8Array(nx * nz), isOpen = (v) => v === 0 || v === 4;
    const out = (i, k) => { let ox = 0, oz = 0; if (i > 0 && grid[k * nx + i - 1] === 2) ox -= 1; if (i < nx - 1 && grid[k * nx + i + 1] === 2) ox += 1; if (k > 0 && grid[(k - 1) * nx + i] === 2) oz -= 1; if (k < nz - 1 && grid[(k + 1) * nx + i] === 2) oz += 1; return [ox, oz]; };
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const c = k * nx + i; if (seen[c] || !isOpen(grid[c])) continue; const [ox0, oz0] = out(i, k); if (!ox0 && !oz0) continue;
      const cl = [], st = [c]; seen[c] = 1;
      while (st.length) { const v = st.pop(), vi = v % nx, vk = (v / nx) | 0; cl.push(v); for (const w of [v - 1, v + 1, v - nx, v + nx]) { const wi = w % nx, wk = (w / nx) | 0; if (w < 0 || w >= nx * nz || Math.abs(wi - vi) + Math.abs(wk - vk) !== 1 || seen[w] || !isOpen(grid[w])) continue; const [a, bq] = out(wi, wk); if (!a && !bq) continue; seen[w] = 1; st.push(w); } }
      for (let s = 0; s < cl.length; s += 6) {                          // long open edges: one entry every 3 m
        const part = cl.slice(s, s + 6), m = part[part.length >> 1], mi = m % nx, mk = (m / nx) | 0, [ox, oz] = out(mi, mk), l = Math.hypot(ox, oz) || 1;
        const x = L.x0 + (mi + .5) * CELL, z = L.z0 + (mk + .5) * CELL, y = L.yAt(x, z), dy = L.kind === 'void' ? .3 : 1.2;
        const pos = V(x + ox / l * 1.4, y + dy, z + oz / l * 1.4), inn = V(x, y + dy, z);
        if (groundY(pos.x, pos.z) + rubbleH(pos.x, pos.z) > y + (L.kind === 'void' ? .35 : .55)) { for (const v of part) grid[v] = 1; continue; }
        L.entries.push({ pos, in: inn, i: mi, k: mk });
      }
    }
  }
  for (const L of layers) if (L !== ground) computeEntries(L);

  // ---------------------------------------------------------------- trees (needed for the outdoor grid)
  const trees = [];                                                     // { x, z, y, s, kind: 'round'|'cypress', fallen, ctx }
  const hitsBld = (x, z, m) => blds.some((b) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m);
  for (let j = 0; j < NZL; j++) for (let i = 0; i < NXL; i++) {
    const lx = lotX(i), lz = lotZ(j), park = i === 0 && j === jp;
    // street trees on the sidewalks
    for (const side of [0, 1, 2, 3]) {
      const horiz = side < 2, len = horiz ? LX : LZ;
      for (let t = 5; t < len - 4; t += rf(8, 12)) {
        if (!chance(park ? .9 : .55)) continue;
        const x = horiz ? lx + t : side === 2 ? lx + 1.25 : lx + LX - 1.25, z = horiz ? (side === 0 ? lz + 1.25 : lz + LZ - 1.25) : lz + t;
        if (hitsBld(x, z, 1.2) || hazard.poles.some((p) => Math.hypot(p.x - x, p.z - z) < 3)) continue;
        trees.push({ x, z, s: rf(.85, 1.15), kind: chance(.18) ? 'cypress' : 'round' });
      }
    }
    const n = park ? (LOW ? 16 : 26) : ri(4, 9);
    for (let k = 0, t = 0; k < n && t < 200; t++) {
      const x = lx + rf(4.5, LX - 4.5), z = lz + rf(4.5, LZ - 4.5);
      if (hitsBld(x, z, 2.4) || trees.some((q) => Math.hypot(q.x - x, q.z - z) < (park ? 3.6 : 4.2))) continue;
      if (park && Math.hypot(x - (lx + LX / 2), z - (lz + LZ / 2)) < 6.5) continue;
      trees.push({ x, z, s: rf(.8, 1.3), kind: chance(park ? .3 : .22) ? 'cypress' : 'round' }); k++;
    }
  }
  for (const tr of trees) { const h = rubbleH(tr.x, tr.z); tr.y = groundY(tr.x, tr.z); if (h > .3) { tr.fallen = chance(.6); tr.y += h * .5; tr.dir = rf(0, TAU); } }
  // the square: a few trees along its north and south edges
  for (const q of PLAZA_BEDS) for (let k = 0, t = 0; k < 7 && t < 80; t++) { const x = rf(q.x0 + 2, q.x1 - 2), z = rf(q.z0 + 2, q.z1 - 2); if (trees.some((o) => Math.hypot(o.x - x, o.z - z) < 4.5)) continue; trees.push({ x, z, y: .24, s: rf(.9, 1.25), kind: chance(.35) ? 'cypress' : 'round' }); k++; }

  // ---------------------------------------------------------------- the outdoor grid (2 m cells)
  {
    const g = ground.grid, bR = blds.filter((b) => b.type !== 'pancake').map((b) => b.type === 'partial' ? masks[blds.indexOf(b)] : b.type === 'lean' ? worldRect(b.Mb, 0, 0, b.W, b.D, [0, b.nF * H]) : { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 });
    for (let k = 0; k < GNZ; k++) for (let i = 0; i < GNX; i++) {
      const x0 = GX0 + i * GCELL, z0 = GZ0 + k * GCELL, x = x0 + 1, z = z0 + 1, c = k * GNX + i;
      if (x < X0 || x > X1 || z < Z0 || z > Z1) { g[c] = 2; continue; }
      let v = 0;
      for (const r of bR) {                                            // (the pancake's top is searched from the air)
        const ox = Math.max(0, Math.min(x0 + GCELL, r.x1) - Math.max(x0, r.x0)), oz = Math.max(0, Math.min(z0 + GCELL, r.z1) - Math.max(z0, r.z0));
        if (ox * oz > GCELL * GCELL * .4) { v = 1; break; }
      }
      if (!v && inPool(x, z)) v = 3;
      if (!v && onWire(x, z)) v = 4;
      g[c] = v;
    }
    for (const tr of trees) { if (tr.fallen) continue; const i = Math.floor((tr.x - GX0) / GCELL), k = Math.floor((tr.z - GZ0) / GCELL); if (i >= 0 && k >= 0 && i < GNX && k < GNZ && g[k * GNX + i] === 0) g[k * GNX + i] = 1; }
  }

  // ---------------------------------------------------------------- survivors, false alarms
  function reach(L) {                                                    // BFS from the entries over open cells
    const d = new Int32Array(L.nx * L.nz).fill(-1), q = [];
    for (const e of L.entries) { const c = e.k * L.nx + e.i; if (d[c] < 0) { d[c] = 0; q.push(c); } }
    for (let h = 0; h < q.length; h++) { const v = q[h], vi = v % L.nx; for (const w of [vi > 0 ? v - 1 : -1, vi < L.nx - 1 ? v + 1 : -1, v - L.nx, v + L.nx]) { if (w < 0 || w >= d.length || d[w] >= 0) continue; const g = L.grid[w]; if (g !== 0 && g !== 4) continue; d[w] = d[v] + 1; q.push(w); } }
    return d;
  }
  function pickCell(L, { far = 1, nearObst = 3, filter = null } = {}) {
    const d = reach(L); let best = -1, bs = -1e9;
    for (let k = 1; k < L.nz - 1; k++) for (let i = 1; i < L.nx - 1; i++) {
      const c = k * L.nx + i; if (d[c] < 0 || L.grid[c] !== 0) continue; if (filter && !filter(i, k)) continue;
      let ob = 0; for (const w of [c - 1, c + 1, c - L.nx, c + L.nx]) if (L.grid[w] === 1) ob++;
      const s = Math.min(d[c], 40) * far * .25 + ob * nearObst + R() * 6; if (s > bs) { bs = s; best = c; }
    }
    if (best < 0) return null;
    const i = best % L.nx, k = (best / L.nx) | 0, x = L.x0 + (i + .5) * L.cell, z = L.z0 + (k + .5) * L.cell;
    return { i, k, x, z, y: L.yAt(x, z) };
  }
  const people = [];
  const addPerson = (L, opts) => { const c = L && pickCell(L, opts); if (!c) return; people.push({ id: 'p' + (people.length + 1), pos: V(c.x, c.y + .18, c.z), layer: L.id, building: L.building || null, hidden: true, yaw: rf(0, TAU), pose: L.kind === 'void' ? 'curled' : 'lying' }); };
  {
    const P = byType('pancake'), S = byType('soft'), C = byType('partial'), B = byType('lean'), Fc = byType('facade');
    const wantN = ri(4, 6), order = [];
    if (P) order.push(() => addPerson(layerById[P.id + '0'], { far: 1.4 }));
    if (S) order.push(() => addPerson(layerById[S.id + '0'], { far: 1.2 }));
    if (C) order.push(() => { const L = layerById[C.id + ri(1, 2)]; const ux = C.uCut; addPerson(L, { filter: (i, k) => { const x = L.x0 + (i + .5) * CELL, z = L.z0 + (k + .5) * CELL; const loc = V(x, 0, z).applyMatrix4(C.M.clone().invert()); return loc.x > ux - 5.5 && loc.x < ux - 1; } }); });
    order.push(() => {                                                   // someone half-buried at the edge of a spill, outdoors
      let best = null; for (let t = 0; t < 400 && !best; t++) { const s = pick(spills.filter((q) => !q.pile)); const x = rf(s.bx0, s.bx1), z = rf(s.bz0, s.bz1), h = rubbleH(x, z); const gi = Math.floor((x - GX0) / GCELL), gk = Math.floor((z - GZ0) / GCELL); if (h > .35 && h < 1.4 && x > X0 + 2 && x < X1 - 2 && z > Z0 + 2 && z < Z1 - 2 && ground.grid[gk * GNX + gi] === 0 && !masks.some((m) => x > m.x0 - 1 && x < m.x1 + 1 && z > m.z0 - 1 && z < m.z1 + 1)) best = { x, z, h }; }
      if (best) people.push({ id: 'p' + (people.length + 1), pos: V(best.x, groundY(best.x, best.z) + best.h * .55, best.z), layer: 'ground', building: null, hidden: true, yaw: rf(0, TAU), pose: 'buried' });
    });
    if (B) order.push(() => addPerson(layerById[B.id + ri(1, 3)], {}));
    if (Fc) order.push(() => addPerson(layerById[Fc.id + ri(2, Fc.nF - 1)], { far: 1.3 }));
    for (const fn of order) { if (people.length >= wantN) break; fn(); }
  }
  // false alarms: a radiator still warm by a window, a kitchen stove
  const decoys = [];
  {
    const host = byType('lean') || byType('partial'), fl = host && host.floors.find((f) => f.f === 2);
    if (fl) {
      const p = fl.plan, cand = [];
      for (const r of p.rooms) if (r.kind === 'room' && r.use !== 'bath') for (const q of r.ew.gaps) if (q.kind === 'window' && q.a >= r.c0 && q.b <= r.c1) { const row = r.side === 's' ? 1 : p.nv - 2; if (p.cells[row * p.nu + q.a + 1] === 0 && p.cells[row * p.nu + q.a] !== 2) cand.push({ r, q, row }); }
      if (cand.length) { const c = pick(cand); fl.radiator = c; const u = (c.q.a + 1.5) * CELL, v = (c.row + .5) * CELL; const P0 = xf(fl.FM, u, fl.yF + .45, v); decoys.push({ id: 'radiator', kind: 'radiator', text: 'a warm radiator', pos: P0, layer: fl.id, building: host.id }); }
    }
    const kh = byType('facade') || byType('soft'), kf = kh && kh.floors.find((f) => f.kind === 'floor' && f.f >= 1);
    if (kf) {
      const free = (q) => !kf.mods.some((m) => m.room === q) && q.c1 - q.c0 >= 5 && kf.plan.cells[q.r0 * kf.plan.nu + q.c0] !== 2;
      const r = kf.plan.rooms.find((q) => q.kind === 'room' && q.side === 'n' && free(q)) || kf.plan.rooms.find((q) => q.kind === 'room' && free(q));
      if (r) {
        r.use = 'kitchen'; r.floor = 'tile'; kf.kitchen = r;
        const ua = r.c0 * CELL, ub = (r.c1 + 1) * CELL, L = Math.min(ub - ua - .5, 3), sgn = r.side === 's' ? 1 : -1, ext = r.side === 's' ? r.r0 * CELL : (r.r1 + 1) * CELL;
        const u = (ua + ub) / 2 + (sgn > 0 ? 1 : -1) * (L / 2 - .38), v = ext + sgn * .32;
        decoys.push({ id: 'kitchen', kind: 'kitchen', text: 'a kitchen stove, still warm', pos: xf(kf.FM, u, kf.yF + .95, v), layer: kf.id, building: kh.id });
      }
    }
  }

  // ================================================================ geometry
  const gCut = Builder(1 << 18), gS = Builder(1 << 17), gG = Builder(1 << 15), gMk = Builder(1 << 14), gTop = Builder(256);
  gMk.jit = .02; gG.jit = .015;
  const chunkS = [], chunkB = [];                                       // rubble instances: x, y, z, rx, ry, rz, sx, sy, sz, colour
  const addChunk = (list, x, y, z, s, flat = 1, col = null) => { list.push(x, y, z, jf(0, TAU), jf(0, TAU), jf(0, TAU), s * jf(.75, 1.25), s * jf(.6, 1) * flat, s * jf(.75, 1.25), col || cc(RUB[Math.floor(RJ() * RUB.length)])); };
  const addChunkL = (FM, u, y, v, s, flat = 1, col = null, list = chunkS) => { const p = xf(FM, u, y, v); addChunk(list, p.x, p.y, p.z, s, flat, col); };

  // ---------------------------------------------------------------- walls of a damaged floor (built from the same wall lines as the grid)
  function emitWalls(fl) {
    // Each wall line is cut into runs of one kind (solid, window, door, wide opening) and four height bands shared by all
    // runs, so neighbouring faces meet edge to edge (no cracks) and a cut shows one clean poche.
    const { b, plan, yF } = fl, g = gCut, nu = plan.nu, nv = plan.nv, top = yF + CEIL, cells = plan.cells, fac = cc(b.col), pla = cc(PAL.plaster);
    const BAND = [yF + .005, yF + .9, yF + 2.1, yF + 2.3, top], SOL = { solid: [1, 1, 1, 1], window: [1, 0, 0, 1], door: [0, 0, 1, 1], wide: [0, 0, 0, 1] };
    const atC = (w, t) => (w.o === 'h' ? w.at * nu + t : t * nu + w.at);
    const gapOf = (w, t) => { for (const q of w.gaps) if (t >= q.a && t <= q.b) return q; return null; };
    const kindOf = (w, t) => { const v = cells[atC(w, t)]; if (v === 2 || v === 4) return null; const q = gapOf(w, t); return q ? q.kind : 'solid'; };
    for (const w of plan.walls) {
      const runs = [];
      for (let t = w.a; t <= w.b;) { const k = kindOf(w, t); if (!k) { t++; continue; } const q = gapOf(w, t); let t2 = t; while (t2 + 1 <= w.b && kindOf(w, t2 + 1) === k && gapOf(w, t2 + 1) === q) t2++; runs.push({ t, t2, k }); t = t2 + 1; }
      let a0, a1, outer = 0, col = pla, lo = false;
      if (w.ext) { lo = w.face === 'front' || w.face === 'left'; const edge = lo ? 0 : (w.face === 'back' ? nv : nu) * CELL; if (lo) { a0 = edge + .05; a1 = edge + .4; } else { a0 = edge - .4; a1 = edge - .05; } outer = w.o === 'h' ? (lo ? 32 : 16) : (lo ? 2 : 1); }
      else { const c = (w.at + .5) * CELL; a0 = c - .06; a1 = c + .06; col = cc(w.tint); }
      const LONG = w.o === 'h' ? 16 | 32 : 1 | 2, END0 = w.o === 'h' ? 2 : 32, END1 = w.o === 'h' ? 1 : 16, len = (w.o === 'h' ? nu : nv) * CELL;
      runs.forEach((r, i) => {
        let s0 = r.t * CELL, s1 = (r.t2 + 1) * CELL, cap0 = true, cap1 = true;
        if (r.t === w.a) { if (w.ext && w.o === 'h') s0 = .05; else if (w.ext) { s0 = .4; cap0 = false; } else { s0 = (r.t - .5) * CELL; cap0 = false; } }
        if (r.t2 === w.b) { if (w.ext && w.o === 'h') s1 = len - .05; else if (w.ext) { s1 = len - .4; cap1 = false; } else { s1 = (r.t2 + 1.5) * CELL; cap1 = false; } }
        const S = SOL[r.k], P = i > 0 && runs[i - 1].t2 === r.t - 1 ? SOL[runs[i - 1].k] : null, N = i + 1 < runs.length && runs[i + 1].t === r.t2 + 1 ? SOL[runs[i + 1].k] : null;
        for (let k = 0; k < 4; k++) {
          if (!S[k]) continue;
          let m = LONG;
          if (cap0 && !(P && P[k])) m |= END0; if (cap1 && !(N && N[k])) m |= END1;
          if (k < 3 && !S[k + 1]) m |= 4; if (k === 0 || !S[k - 1]) m |= 8;
          const y0 = BAND[k], y1 = BAND[k + 1];
          if (w.o === 'h') { g.box(s0, y0, a0, s1, y1, a1, col, m & ~outer); if (outer) g.box(s0, y0, a0, s1, y1, a1, fac, outer); }
          else { g.box(a0, y0, s0, a1, y1, s1, col, m & ~outer); if (outer) g.box(a0, y0, s0, a1, y1, s1, fac, outer); }
        }
        if (r.k === 'window' && w.ext) {                               // a pale sill outside
          const edge = lo ? 0 : len === nu * CELL && w.o === 'h' ? nv * CELL : (w.o === 'h' ? nv : nu) * CELL, sa = lo ? edge - .06 : edge - .05, sb = lo ? edge + .05 : edge + .06;
          if (w.o === 'h') g.box(s0 - .08, yF + .84, sa, s1 + .08, yF + .92, sb, cc(PAL.frame)); else g.box(sa, yF + .84, s0 - .08, sb, yF + .92, s1 + .08, cc(PAL.frame));
        }
      });
    }
  }
  // ---------------------------------------------------------------- furniture: simple clay pieces, a little disorder
  function item(fl, u, v, yaw, fn, tilt = 0) { withM(gCut, mm(fl.FM, mT(u, fl.yF, v), mRy(yaw), tilt ? mRz(tilt) : new THREE.Matrix4()), fn); }
  const F = {
    bed: (r) => { const g = gCut; g.box(-1, 0, -.75, 1, .3, .75, cc(r.wood)); g.box(-.96, .3, -.71, .96, .5, .71, cc('#EFEAF0')); g.box(-.35, .5, -.73, .97, .57, .73, cc(r.fab)); g.box(-.94, .5, -.55, -.62, .62, .55, cc('#F4F0F4')); g.box(-1.06, 0, -.75, -.98, .95, .75, cc(r.wood)); },
    wardrobe: (r, fallen) => { const g = gCut; if (fallen) g.box(-.6, 0, -1, .6, .6, 1, cc(r.wood)); else { g.box(-.6, 0, -.3, .6, 2.05, .3, cc(r.wood)); g.box(-.02, .1, .3, .02, 1.95, .31, cc('#9F8878')); } },
    sofa: (r) => { const g = gCut, c = cc(r.fab); g.box(-1.1, 0, -.45, 1.1, .42, .45, c); g.box(-1.1, .42, .22, 1.1, .86, .45, c); g.box(-1.1, .42, -.45, -.9, .64, .22, c); g.box(.9, .42, -.45, 1.1, .64, .22, c); },
    table: (r) => { const g = gCut, c = cc(r.wood); g.box(-.62, .72, -.42, .62, .78, .42, c); for (const [x, z] of [[-.55, -.35], [.55, -.35], [-.55, .35], [.55, .35]]) g.box(x - .03, 0, z - .03, x + .03, .72, z + .03, c); },
    chair: (r) => { const g = gCut, c = cc(r.wood); g.box(-.22, .42, -.22, .22, .46, .22, c); g.box(-.22, .46, .18, .22, .9, .22, c); g.box(-.2, 0, -.2, -.16, .42, -.16, c); g.box(.16, 0, .16, .2, .42, .2, c); g.box(.16, 0, -.2, .2, .42, -.16, c); g.box(-.2, 0, .16, -.16, .42, .2, c); },
    rug: (r) => { gCut.box(-1.2, 0, -.8, 1.2, .035, .8, cc(r.fab), 4 | 1 | 2 | 16 | 32); },
    counter: (r, L) => { const g = gCut; g.box(-L / 2, 0, -.3, L / 2, .88, .3, cc('#E4DDD6')); g.box(-L / 2 - .01, .88, -.31, L / 2 + .01, .93, .31, cc('#B9B0C4')); g.box(L / 2 - .68, .93, -.27, L / 2 - .08, .96, .27, cc('#5D5A7A')); },
    fridge: () => { gCut.box(-.34, 0, -.33, .34, 1.8, .33, cc('#EEEBF2')); },
    tub: () => { const g = gCut; g.box(-.85, 0, -.38, .85, .55, .38, cc('#F1EEF4')); g.box(-.7, .45, -.26, .7, .56, .26, cc('#C9D3DE')); },
    shelf: (r) => { gCut.box(-.8, 0, -.2, .8, .55, .2, cc(r.wood)); gCut.box(-.4, .55, -.05, .4, 1.0, .02, cc('#4A4868')); },
    radiator: () => { const g = gCut; for (let k = 0; k < 9; k++) g.box(-.5 + k * .115, .15, -.05, -.5 + k * .115 + .08, .75, .05, cc('#ECE8F0'), 63, null); },
  };
  function furnish(fl) {
    const { b, plan } = fl, mess = b.type === 'lean' ? .35 : b.type === 'soft' ? .25 : .12;
    for (const r of plan.rooms) {
      if (r.kind !== 'room' || plan.cells[r.r0 * plan.nu + r.c0] === 2) continue;
      if (b.type === 'partial' && r.c1 >= b.cutCol - 1) { if (r.c0 >= b.cutCol - 2) continue; }
      if (b.type === 'facade' && fl.f > 0 && r.side === 's' && chance(.4)) continue;   // rooms that lost their facade lost their things
      const ua = r.c0 * CELL, ub = Math.min(r.c1 + 1, b.type === 'partial' ? b.cutCol : r.c1 + 1) * CELL, va = r.r0 * CELL, vb = (r.r1 + 1) * CELL;
      const um = (ua + ub) / 2, vm = (va + vb) / 2, ext = r.side === 's' ? va : vb, sgn = r.side === 's' ? 1 : -1, J = () => jf(-mess, mess);
      if (ub - ua < 1.8) continue;
      const occupied = fl.mods.filter((m) => m.room === r).length > 0;
      if (r.use === 'bed') {
        const atLo = r.door === undefined || (r.door * CELL > um);
        item(fl, atLo ? ua + .85 : ub - .85, ext + sgn * 1.12, (sgn > 0 ? -HALF : HALF) + J(), () => F.bed(r));
        if (!occupied) item(fl, atLo ? ub - .4 : ua + .4, vm + J(), HALF + J(), () => F.wardrobe(r, chance(.3)));
        item(fl, um, vm, J(), () => F.rug(r));
      } else if (r.use === 'living') {
        item(fl, ua + .55, vm, -HALF + J(), () => F.sofa(r)); item(fl, um + .3, vm + J(), J() * 2, () => F.table(r));
        if (chance(.6)) item(fl, um + .3 + J(), vm + .75, J() * 4, () => F.chair(r), chance(.4) ? HALF : 0);
        item(fl, um, vm, J(), () => F.rug(r)); if (!occupied) item(fl, ub - .3, vm, HALF, () => F.shelf(r));
      } else if (r.use === 'kitchen') {
        const L = Math.min(ub - ua - .5, 3); item(fl, um, ext + sgn * .32, sgn > 0 ? 0 : Math.PI, () => F.counter(r, L));
        item(fl, ua + .45, ext + sgn * 1.1, J(), () => F.fridge()); if (vb - va > 3.2) item(fl, um + .2, vm + sgn * .6, J() * 2, () => F.table(r));
      } else if (r.use === 'bath') { item(fl, um, ext + sgn * .42, J() * .5, () => F.tub()); }
      // dust and plaster on the floor
      for (let k = ri(0, 3); k > 0; k--) addChunkL(fl.FM, jf(ua + .3, ub - .3), fl.yF + .04, jf(va + .3, vb - .3), jf(.1, .26), .55);
    }
    if (fl.radiator) { const c = fl.radiator, u = (c.q.a + 1.5) * CELL, v = c.row === 1 ? .52 : plan.nv * CELL - .52; item(fl, u, v, 0, () => F.radiator()); }
  }
  function emitStairs(fl) {
    const r = fl.plan.stair; if (!r || fl.plan.cells[r.r0 * fl.plan.nu + r.c0] === 2) return;
    const g = gCut, u0 = r.c0 * CELL + .1, u1 = u0 + 1.15, va = r.r0 * CELL + .15, vb = (r.r1 + 1) * CELL - .15, n = 14, run = (vb - va - .9) / n, rise = H / (n + 1);
    withM(g, fl.FM, () => {
      for (let k = 0; k < n; k++) g.box(u0, fl.yF, va + .9 + k * run, u1, fl.yF + (k + 1) * rise, va + .9 + (k + 1) * run, cc('#D3CCD8'));
      g.box(u1, fl.yF, va + .9, u1 + .08, fl.yF + 1, vb, cc('#B9B1C4'));
    });
  }
  function emitMods(fl) {
    const g = gCut;
    for (const m of fl.mods) {
      if (m.t === 'fallen') {                                           // a piece of the ceiling slab, one edge down, one propped up
        const Lu = (m.c1 + 1 - m.c0) * CELL, beta = Math.atan2(m.hi, Lu), len = Math.hypot(Lu, m.hi), v0 = m.r0 * CELL + .05, v1 = (m.r1 + 1) * CELL - .05;
        const base = m.dir > 0 ? mm(fl.FM, mT(m.c0 * CELL, fl.yF + .02, 0), mRz(beta)) : mm(fl.FM, mT((m.c1 + 1) * CELL, fl.yF + .02, 0), mRz(Math.PI - beta), mRx(Math.PI));
        withM(g, base, () => g.box(0, 0, m.dir > 0 ? v0 : -v1, len, .2, m.dir > 0 ? v1 : -v0, cc(PAL.slab), 63, cc(PAL.slabEdge)));
        for (let k = 0; k < 6; k++) addChunkL(fl.FM, jf(m.c0, m.c1 + 1) * CELL, fl.yF + .08, jf(m.r0, m.r1 + 1) * CELL, jf(.12, .3), .7);
      } else if (m.t === 'crush') {                                     // crushed front of a ground floor
        withM(g, fl.FM, () => { for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1;) { const w = ri(2, 5), c2 = Math.min(m.c1, c + w - 1); g.box(c * CELL, fl.yF, r * CELL, (c2 + 1) * CELL, fl.yF + jf(.55, 1.35), (r + 1) * CELL, cc(pick(RUB))); c = c2 + 1; } });
        for (let k = 0; k < 30; k++) addChunkL(fl.FM, jf(m.c0, m.c1 + 1) * CELL, fl.yF + jf(.6, 1.3), jf(m.r0, m.r1 + 1) * CELL, jf(.2, .45));
      }
    }
  }
  function emitBalconies(fl, opts = {}) {
    const { b, plan } = fl, g = gCut, fac = cc(b.col);
    const w = plan.walls.find((q) => q.face === 'front'); if (!w) return;
    for (const q of w.gaps) {
      if (q.kind !== 'window' || !chance(opts.p ?? .5)) continue;
      if (plan.cells[q.a] === 2 || plan.cells[q.b] === 2 || plan.cells[q.b + 1] === 4 || plan.cells[q.a] === 4) continue;
      const u0 = q.a * CELL - .45, u1 = (q.b + 1) * CELL + .45, yH = fl.yF - SLAB, hang = opts.hang && chance(opts.hang) ? rf(.4, 1.1) : 0;
      withM(g, mm(fl.FM, mT(0, yH, 0), mRx(-hang), mT(0, -yH, 0)), () => {
        g.box(u0, yH, -1.25, u1, yH + .15, 0, cc(PAL.slab), 63, cc(PAL.slabEdge));
        g.box(u0, yH + .15, -1.25, u1, yH + 1.05, -1.13, fac); g.box(u0, yH + .15, -1.13, u0 + .1, yH + 1.05, 0, fac); g.box(u1 - .1, yH + .15, -1.13, u1, yH + 1.05, 0, fac);
      });
    }
  }
  function emitRoof(b) {
    const rf0 = b.roof; if (!rf0) return;
    const g = gCut, W = rf0.uMax || b.W, D = b.D, y = rf0.y, fac = cc(b.col);
    withM(g, rf0.FM, () => {
      g.box(0, y, 0, W, y + SLAB, D, cc(PAL.roof), 63, cc(PAL.slabEdge));
      const py = y + SLAB, ph = .8;
      if (!rf0.noFront) g.box(0, py, 0, W, py + ph, .2, fac); else { g.box(0, py, 0, .9, py + ph, .2, fac); g.box(W - 1.4, py, 0, W, py + ph * .6, .2, fac); }
      g.box(0, py, D - .2, W, py + ph, D, fac); g.box(0, py, .2, .2, py + ph, D - .2, fac);
      if (!rf0.uMax) g.box(W - .2, py, .2, W, py + ph, D - .2, fac);
      const st = b.basePlan.stair; if (st) g.box(st.c0 * CELL, py, st.r0 * CELL, st.c0 * CELL + 3, py + 2.4, (st.r1 + 1) * CELL, fac);
      for (let k = ri(1, 3); k > 0; k--) { const u = jf(1.5, W - 2.5), v = jf(1.5, D - 2.5); if (st && u > st.c0 * CELL - 1 && u < st.c0 * CELL + 4 && v > st.r0 * CELL - 1) continue; g.frustum(u, py, v, .55, .55, 1.15, 10, cc(PAL.tank)); }
    });
  }
  // ---------------------------------------------------------------- crawl spaces: crushed infill wherever the grid says obstacle
  function emitVoid(fl) {
    const { b, plan, FM } = fl, g = gCut, nu = plan.nu, nv = plan.nv, cells = plan.cells;
    // crushed infill as one solid: tops + only the faces that border a void or the outside (a clean poche when cut)
    const DEB = ['#A39CB4', '#B5AEC4', '#C9C0CC', '#AE8E8B', '#948DA9', '#BDB5C8'].map(cc), solid = (c, r) => c >= 0 && r >= 0 && c < nu && r < nv && cells[r * nu + c] === 1;
    const colAt = (c, r) => DEB[Math.floor(hash(c >> 1, r >> 1, b.seed) * DEB.length)];
    withM(g, FM, () => {
      g.box(0, 0, 0, b.W, SLAB, b.D, cc(PAL.slab), 63 & ~4, cc(PAL.slabEdge));
      const y0 = SLAB, yt = (u) => b.slabBottom(u) - .015;
      for (let r = 0; r < nv; r++) for (let c = 0; c < nu;) {
        if (!solid(c, r)) { c++; continue; }
        let c2 = c; const col = colAt(c, r); while (c2 + 1 < nu && solid(c2 + 1, r) && colAt(c2 + 1, r) === col) c2++;
        const u0 = c * CELL, u1 = (c2 + 1) * CELL, v0 = r * CELL, v1 = v0 + CELL;
        g.color(col); g.quad(u0, yt(u0), v0, u0, yt(u0), v1, u1, yt(u1), v1, u1, yt(u1), v0); g.quad(u0, y0 + .004, v0, u1, y0 + .004, v0, u1, y0 + .004, v1, u0, y0 + .004, v1);
        c = c2 + 1;
      }
      for (let r = 0; r < nv; r++) for (let c = 0; c < nu; c++) {
        if (!solid(c, r)) continue;
        const u0 = c * CELL, u1 = u0 + CELL, v0 = r * CELL, v1 = v0 + CELL, a = yt(u0), bq = yt(u1); g.color(colAt(c, r));
        if (!solid(c + 1, r)) g.quad(u1, y0, v0, u1, bq, v0, u1, bq, v1, u1, y0, v1);
        if (!solid(c - 1, r)) g.quad(u0, y0, v0, u0, y0, v1, u0, a, v1, u0, a, v0);
        if (!solid(c, r + 1)) g.quad(u0, y0, v1, u1, y0, v1, u1, bq, v1, u0, a, v1);
        if (!solid(c, r - 1)) g.quad(u0, y0, v0, u0, a, v0, u1, bq, v0, u1, y0, v0);
      }
    });
    // softer rubble lining the voids
    for (let r = 1; r < nv - 1; r++) for (let c = 1; c < nu - 1; c++) {
      if (cells[r * nu + c] !== 0 || (plan.pocket && c >= plan.pocket.c0 && c <= plan.pocket.c1 && r >= plan.pocket.r0 && r <= plan.pocket.r1)) continue;
      const nb = [cells[r * nu + c - 1], cells[r * nu + c + 1], cells[(r - 1) * nu + c], cells[(r + 1) * nu + c]];
      if (!nb.includes(1) || RJ() > .35) continue;
      addChunkL(FM, (c + .5) * CELL + jf(-.12, .12), SLAB + .03, (r + .5) * CELL + jf(-.12, .12), jf(.08, .16), .6);
    }
    // a few human traces in the chambers: a mattress, a chair, a cushion
    for (const q of plan.nodes.slice(0, 4)) { if (cells[q.r * nu + q.c] !== 0) continue; withM(g, mm(FM, mT((q.c + .5) * CELL, SLAB, (q.r + .5) * CELL), mRy(jf(0, TAU))), () => g.box(-.35, 0, -.25, .35, jf(.06, .14), .25, cc(pick(FABRIC)))); }
  }
  // ---------------------------------------------------------------- a floor surface: rows of cells, one tint per room (this is what the overlay paints)
  function emitSurface(fl) {
    const gF = Builder(); gF.jit = .012;
    const { plan, FM, yF } = fl, nu = plan.nu, nv = plan.nv;
    const keyOf = (c) => { if (fl.kind === 'void') return 'concrete'; const id = plan.rid[c]; if (id < 0) return 'terrazzo'; return plan.rooms[id].floor || 'terrazzo'; };
    gF.M = FM;
    for (let r = 0; r < nv; r++) for (let c = 0; c < nu;) {
      const skip = (v) => v === 2 || (fl.kind === 'void' && v === 1);  // under crushed infill there is no floor to see
      const v = plan.cells[r * nu + c]; if (skip(v)) { c++; continue; }
      const k = keyOf(r * nu + c), id = plan.rid[r * nu + c]; let c2 = c;
      while (c2 + 1 < nu && !skip(plan.cells[r * nu + c2 + 1]) && keyOf(r * nu + c2 + 1) === k && plan.rid[r * nu + c2 + 1] === id) c2++;
      gF.color(cc(FLOORC[k]), id >= 0 ? .02 : .005);
      gF.quad(c * CELL, yF, r * CELL, c * CELL, yF, (r + 1) * CELL, (c2 + 1) * CELL, yF, (r + 1) * CELL, (c2 + 1) * CELL, yF, r * CELL);
      c = c2 + 1;
    }
    return gF.geometry();
  }

  // ---------------------------------------------------------------- the five damaged blocks
  for (const b of dmg) {
    const g = gCut;
    for (const fl of b.floors) {
      if (fl.kind === 'void') { emitVoid(fl); continue; }
      const uMax = b.type === 'partial' ? b.uCut : b.W;
      g.M = fl.FM; g.ao = null;
      g.box(0, fl.yF - SLAB, 0, uMax, fl.yF, b.D, cc(PAL.slab), 63 & ~4, cc(PAL.slabEdge));
      g.ao = (x, y) => .8 + .2 * smooth(fl.yF, fl.yF + 2.2, y);
      emitWalls(fl); g.ao = null; g.M = null;
      emitStairs(fl); emitMods(fl); furnish(fl);
      if (fl.f > 0 && b.type !== 'facade') emitBalconies(fl, { p: b.type === 'partial' ? .45 : .5, hang: b.type === 'lean' ? .45 : b.type === 'soft' ? .25 : .15 });
    }
    g.M = null;
    if (b.type === 'soft') {
      // the upper block's floor 1 slab rests on the crushed storey; broken columns poke out at the facade line
      for (let u = .4; u < b.W - .3; u += jf(3.2, 4.2)) for (const [v, sg] of [[.1, -1], [b.D - .1, 1]]) {   // crushed columns, kicked out at the base
        const kick = sg * jf(.35, .9), base = mm(b.M, mT(u, SLAB, v), mRx(kick), mRz(jf(-.3, .3)));
        withM(g, base, () => { g.box(-.2, 0, -.2, .2, jf(.5, .8), .2, cc('#C2BBCC')); for (let q = 0; q < 3; q++) g.box(-.012 + jf(-.12, .12), .5, -.012, .012 + jf(-.12, .12), jf(.8, 1.2), .012, cc('#5E5874')); });
      }
      for (let k = 0; k < 110; k++) { const side = RJ() < .6, u = side ? jf(0, b.W) : (RJ() < .5 ? jf(-.9, -.1) : b.W + jf(.1, .9)), v = side ? (RJ() < .5 ? jf(-.9, -.1) : b.D + jf(.1, .9)) : jf(0, b.D), p = xf(b.M, u, 0, v); if (b.spill.notch.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 2.4)) continue; addChunkL(b.M, u, jf(.1, .6), v, jf(.2, .45), 1, null, RJ() < .25 ? chunkB : chunkS); }
    }
    if (b.type === 'pancake') {
      // the stack: slabs fallen one on another, offset and broken, crushed infill set back between them
      const lv = []; for (let k = 0; k < b.nF; k++) lv.push([.85 + k * .66, 1.1 + k * .66]);
      const INF = ['#A9A2B9', '#BEB6C8', '#C9C0CC', '#AF908C', '#9A93AE', '#B6ADC2'];
      let ox = 0, oz = 0, topM = null, topY = 0;
      lv.forEach(([y0, y1], li) => {
        if (li > 0) { ox += jf(-.5, .5); oz += jf(-.45, .45); }
        const top = li === lv.length - 1, nP = li === 0 ? 2 : ri(2, 3), cuts = [li ? -jf(0, .5) : 0];
        for (let k = 1; k < nP; k++) cuts.push(snap(b.W * k / nP + jf(-1.5, 1.5)));
        cuts.push(b.W + (li ? jf(0, .5) : 0));
        for (let pi = 0; pi < nP; pi++) {
          const slump = li >= 2 && RJ() < .35, u0 = cuts[pi] + (pi ? (li ? jf(.06, .3) : .05) : 0), u1 = cuts[pi + 1], tz = li === 0 ? 0 : slump ? (RJ() < .5 ? 1 : -1) * jf(.09, .16) : jf(-1, 1) * (.02 + li * .012), tx = li === 0 ? 0 : jf(-1, 1) * (.015 + li * .01);
          const M = mm(b.M, mT(ox + (u0 + u1) / 2, y0 + (li ? jf(-.05, .08) : 0), oz + b.D / 2), mRz(tz), mRx(tx));
          const hw = (u1 - u0) / 2, d0 = b.D / 2 + (li ? jf(-.25, .35) : 0), d1 = b.D / 2 + (li ? jf(-.25, .35) : 0);
          withM(g, M, () => g.box(-hw, 0, -d0, hw, y1 - y0, d1, cc(top ? PAL.roof : PAL.slab), top ? 63 & ~4 : 63, cc(PAL.slabEdge)));
          if (top) { topM = M; topY = y1; withM(gTop, M, () => { gTop.color(cc(PAL.roof), .01); gTop.quad(-hw, y1 - y0, -d0, -hw, y1 - y0, d1, hw, y1 - y0, d1, hw, y1 - y0, -d0); }); withM(g, M, () => { if (RJ() < .7) g.box(-hw, y1 - y0, -d0, -hw + jf(1.5, 4), y1 - y0 + .6, -d0 + .2, cc(b.col)); if (RJ() < .5) g.box(hw - .2, y1 - y0, -d0 + jf(1, 3), hw, y1 - y0 + .6, d1 - jf(1, 3), cc(b.col)); }); }
          // rebar and a carpet or a mattress hanging out of the gap under this slab
          if (li > 0) for (let q = 0; q < 3; q++) { const side = RJ() < .5 ? -d0 : d1; withM(g, mm(M, mT(jf(-hw, hw), -.05, side), mRx(side > 0 ? jf(.2, .9) : -jf(.2, .9))), () => g.box(-.015, -.015, 0, .015, .015, (side > 0 ? 1 : -1) * jf(.3, .7), cc('#5E5874'))); }
        }
        if (li < lv.length - 1) {                                       // crushed infill between this slab and the next, set back from the edges
          const y2 = lv[li + 1][0];
          withM(g, mm(b.M, mT(ox, 0, oz)), () => {
            for (let u = 0; u < b.W - .5; u += 2) for (let v = 0; v < b.D - .5; v += 2) {
              const edge = u < 2 || v < 2 || u > b.W - 2.6 || v > b.D - 2.6; if (edge && RJ() < .4) continue;
              const ins = edge ? jf(.25, .8) : 0, x0 = u + (u < 2 ? ins : 0), z0 = v + (v < 2 ? ins : 0), x1 = Math.min(b.W, u + 2) - (u > b.W - 2.6 ? ins : 0), z1 = Math.min(b.D, v + 2) - (v > b.D - 2.6 ? ins : 0);
              g.box(x0, y1 - .05, z0, x1, y2 - .02, z1, cc(INF[(RJ() * INF.length) | 0]));
              if (edge && RJ() < .12) { const fab = cc(pick(FABRIC)); g.box(x0 - .4, y1 + .02, z0 + .2, x0 + 1.2, y1 + .14, z1 - .2, fab); }
            }
          });
        }
      });
      // broken slab ends sliding off the stack to the ground
      for (let k = ri(1, 2); k > 0; k--) {
        const end = RJ() < .5, v0 = jf(0, b.D * .5), v1 = Math.min(b.D, v0 + jf(3, 6)), y = jf(1.6, topY - .3), a = jf(.45, .75), L = (y - .2) / Math.sin(a);
        const M = end ? mm(b.M, mT(b.W + .1, y, 0), mRz(-a)) : mm(b.M, mT(-.1, y, 0), mRz(Math.PI + a), mRx(Math.PI));
        withM(g, M, () => g.box(0, -.25, end ? v0 : -v1, L, 0, end ? v1 : -v0, cc(PAL.slab), 63, cc(PAL.slabEdge)));
      }
      // on top: a toppled water tank, a solar heater wreck, an antenna
      if (topM) {
        withM(g, mm(topM, mT(jf(-3, 3), topY - lv[lv.length - 1][0] + .5, jf(-2, 2)), mRz(HALF), mRy(jf(0, 3))), () => g.frustum(0, -.6, 0, .55, .55, 1.2, 10, cc(PAL.tank)));
        withM(g, mm(topM, mT(jf(-4, 4), topY - lv[lv.length - 1][0] + .1, jf(-3, 3)), mRy(jf(0, 3)), mRx(-.35)), () => g.box(-.9, 0, -.8, .9, .06, .8, cc(PAL.solar)));
        withM(g, mm(topM, mT(jf(-4, 4), topY - lv[lv.length - 1][0], jf(-3, 3)), mRz(jf(.6, 1.2))), () => g.frustum(0, 0, 0, .04, .03, 3, 4, cc(PAL.pole)));
      }
      for (let k = 0; k < (LOW ? 80 : 160); k++) { const e = RJ() * 4 | 0, u = e < 2 ? jf(-.3, b.W + .3) : (e === 2 ? jf(-.9, .1) : b.W + jf(-.1, .9)), v = e >= 2 ? jf(-.3, b.D + .3) : (e === 0 ? jf(-.9, .1) : b.D + jf(-.1, .9)); const y = jf(.2, 1) * jf(.2, 1) * 3.4, p = xf(b.M, u, 0, v); if (y < 1.3 && b.spill.notch.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 2.6)) continue; addChunkL(b.M, u, y, v, jf(.22, .55), 1, null, RJ() < .3 ? chunkB : chunkS); }
      b.topY = topY;
    }
    if (b.type === 'partial') {
      // slabs of the collapsed end hang from the break, rebar out of every broken edge
      const heapAt = (u, v) => { const p = xf(b.M, u, 0, v); return rubbleH(p.x, p.z); };
      const hangF = []; for (let f = 1; f <= b.nF; f++) if (f * H >= b.heapPeak * .85) hangF.push(f);
      const chosen = new Set(); if (hangF.length) { chosen.add(hangF[ri(0, hangF.length - 1)]); if (hangF.length > 2 && chance(.6)) chosen.add(hangF[ri(0, hangF.length - 1)]); }
      for (let f = 1; f <= b.nF; f++) {
        const yT = f * H + (f === b.nF ? SLAB : 0);
        if (yT < b.heapPeak * .85) continue;                            // the lower slabs are buried in the heap
        const n = ri(2, 3), cuts = [0]; for (let k = 1; k < n; k++) cuts.push(snap(b.D * k / n + jf(-1, 1))); cuts.push(b.D);
        const pickK = ri(0, n - 1);
        for (let k = 0; k < n; k++) {
          if (!chosen.has(f) || k !== pickK) continue;
          const v0 = cuts[k] + (k ? jf(.1, .3) : 0), v1 = cuts[k + 1] - (k < n - 1 ? jf(.1, .3) : 0), a = jf(.85, 1.38);
          const end = heapAt(b.uCut + 1.5, (v0 + v1) / 2), L = clamp((yT - Math.max(end, .4)) / Math.sin(a), 1.2, Math.min(3.6, (b.W - b.uCut) * .7));
          const M = mm(b.M, mT(b.uCut, yT, 0), mRz(-a));
          withM(g, M, () => g.box(0, -SLAB, v0, L, 0, v1, cc(PAL.slab), 63, cc(PAL.slabEdge)));
          if (chance(.5)) withM(g, mm(M, mT(L, 0, 0), mRz(-jf(.2, .5))), () => g.box(0, -SLAB, v0 + .2, jf(.8, 1.6), 0, v1 - .2, cc(PAL.slab), 63, cc(PAL.slabEdge)));
          for (let q = 0; q < 3; q++) withM(g, mm(M, mT(L, -.1, jf(v0, v1)), mRy(jf(-.5, .5)), mRz(jf(-.4, .6))), () => g.box(0, -.015, -.015, jf(.3, .7), .015, .015, cc('#5E5874')));
        }
        for (let k = 0; k < (LOW ? 6 : 12); k++) { const v = jf(.3, b.D - .3); withM(g, mm(b.M, mT(b.uCut, yT - .12, v), mRy(jf(-.4, .4)), mRz(-jf(.1, 1.2))), () => g.box(0, -.015, -.015, jf(.3, .9), .015, .015, cc('#5E5874'))); }
        for (let k = 0; k < 8; k++) addChunkL(b.M, b.uCut + jf(-.3, .2), yT + .05, jf(.3, b.D - .3), jf(.15, .35));
      }
    }
    if (b.type === 'facade' && b.panels) {
      // the facade on the street, inner face up, windows still in it
      const wF = b.basePlan.walls.find((w) => w.face === 'front');
      for (const P of b.panels) {
        withM(g, P.PM, () => {
          for (let s = 0; s < b.nF - 1; s++) {
            const y0 = s * H, edges = [P.ua];
            const ws = wF.gaps.filter((q) => q.kind === 'window').map((q) => [q.a * CELL, (q.b + 1) * CELL]).filter(([a, c]) => a > P.ua + .2 && c < P.ub - .2);
            let u = P.ua;
            for (const [a, c] of ws) { g.box(u, y0, 0, a, y0 + H, .3, cc(b.col)); g.box(a, y0, 0, c, y0 + SLAB + .9, .3, cc(b.col)); g.box(a, y0 + SLAB + 2.3, 0, c, y0 + H, .3, cc(b.col)); u = c; }
            g.box(u, y0, 0, P.ub, y0 + H, .3, cc(b.col));
            void edges;
          }
        });
        for (let k = 0; k < 26; k++) { const p = xf(P.PM, jf(P.ua, P.ub), jf(0, P.Hp), jf(-.2, .4)); addChunk(chunkS, p.x, groundY(p.x, p.z) + jf(.05, .25), p.z, jf(.2, .45)); }
      }
    }
    emitRoof(b);
  }
  // per-floor surfaces
  const floorMeshes = [];

  // ---------------------------------------------------------------- the standing blocks: shells with windows, balconies, shops and rooftop life
  const winInst = [], doorInst = [], balInst = [];
  for (const b of blds) {
    if (b.type !== 'standing') continue;
    const g = gS, W = b.W, D = b.D, nF = b.nF, Ht = nF * H, fac = cc(b.col), hip = chance(.38);
    g.M = b.M; g.ao = (x, y) => .74 + .26 * smooth(0, 7, y);
    g.box(0, 0, 0, W, Ht + .3, D, cc(PAL.roof), 63 & ~8, fac);
    g.box(-.04, 0, -.04, W + .04, .95, D + .04, cc(PAL.band), 63 & ~8, cc(b.col).clone().multiplyScalar(.92));
    for (let f = 1; f <= nF; f++) g.box(-.06, f * H - .1, -.06, W + .06, f * H + .08, D + .06, cc(PAL.band), 63 & ~8);
    g.ao = null;
    const roadFront = b.front === '-z' || b.front === '+z' || b.front === '-x' || b.front === '+x';
    b.shop = roadFront && chance(.6);
    const faces = [{ f: 'front', len: W, at: (t) => [t, 0], rot: Math.PI }, { f: 'back', len: W, at: (t) => [t, D], rot: 0 }, { f: 'left', len: D, at: (t) => [0, t], rot: -HALF }, { f: 'right', len: D, at: (t) => [W, t], rot: HALF }];
    const shopCol = pick(['#B9B3CB', '#C9B6AE', '#A9AFC6', '#D8C2B0']);
    for (const F0 of faces) {
      const nb = Math.max(1, Math.floor((F0.len - 1.2) / 3)), sp = F0.len / nb;
      for (let f = 0; f < nF; f++) for (let k = 0; k < nb; k++) {
        const t = (k + .5) * sp, [u, v] = F0.at(t), M = mm(b.M, mT(u, f * H, v), mRy(F0.rot));
        if (f === 0 && F0.f === 'front' && b.shop) {                    // shutters and a sign band on the street side
          withM(g, M, () => { g.box(-sp / 2 + .3, .05, 0, sp / 2 - .3, 2.6, .07, cc(shopCol)); for (let q = 1; q < 6; q++) g.box(-sp / 2 + .3, q * .45, .07, sp / 2 - .3, q * .45 + .04, .09, cc(shopCol).clone().multiplyScalar(.9)); g.box(-sp / 2, 2.7, 0, sp / 2, 3.0, .12, cc('#E8DFD9')); });
          continue;
        }
        if (f === 0 && F0.f === (b.shop ? 'back' : 'front') && k === nb >> 1) { withM(g, M, () => { g.box(-.75, 0, 0, .75, 2.3, .06, cc('#4A4670')); g.box(-1.1, 2.45, 0, 1.1, 2.6, 1.0, cc(PAL.band)); }); continue; }
        const balcony = f > 0 && (F0.f === 'front' || F0.f === 'back') && (k % 2 === (b.seed & 1)) && nb > 2;
        if (balcony) { doorInst.push(mm(M, mT(0, .2, 0))); balInst.push(M); }
        else winInst.push(mm(M, mT(0, .92, 0)));
      }
      // a few air conditioners and, on cracked blocks, diagonal shear cracks between the ground floor windows
      for (let k = ri(0, 3); k > 0; k--) { const f = ri(1, nF - 1), [u, v] = F0.at(jf(1, F0.len - 1)); withM(g, mm(b.M, mT(u, f * H + 2.35, v), mRy(F0.rot)), () => g.box(-.4, 0, 0, .4, .5, .3, cc('#E1DDE8'))); }
    }
    if (chance(.45)) for (const F0 of faces.slice(0, 2)) for (let k = ri(1, 2); k > 0; k--) { const [u, v] = F0.at(jf(1.5, F0.len - 1.5)); withM(g, mm(b.M, mT(u, jf(1, 2), v), mRy(F0.rot), mRz(jf(-.9, -.6) * (RJ() < .5 ? 1 : -1))), () => g.box(-1.1, -.03, -.01, 1.1, .03, .02, cc('#5E5878'))); }
    // roof
    withM(g, b.M, () => {
      const y = Ht + .3;
      if (hip) {                                                        // a low hipped roof in dusty terracotta
        const o = .45, u0 = -o, u1 = W + o, v0 = -o, v1 = D + o, h = Math.min(W, D) * .3, hd = (v1 - v0) / 2, vm = (v0 + v1) / 2, ru0 = Math.min(u0 + hd, (u0 + u1) / 2), ru1 = Math.max(u1 - hd, (u0 + u1) / 2);
        g.color(cc(PAL.tile), .03);
        g.quad(u0, y, v0, ru0, y + h, vm, ru1, y + h, vm, u1, y, v0); g.quad(u1, y, v1, ru1, y + h, vm, ru0, y + h, vm, u0, y, v1);
        g.tri(u1, y, v0, ru1, y + h, vm, u1, y, v1); g.tri(u0, y, v1, ru0, y + h, vm, u0, y, v0);
        g.color(cc('#9D8EA6')); g.quad(u0, y, v0, u1, y, v0, u1, y, v1, u0, y, v1);
      } else {
        g.box(0, y, 0, W, y + .7, .2, fac); g.box(0, y, D - .2, W, y + .7, D, fac); g.box(0, y, .2, .2, y + .7, D - .2, fac); g.box(W - .2, y, .2, W, y + .7, D - .2, fac);
        const sx = jf(2, W - 5), sz = jf(2, D - 5); g.box(sx, y, sz, sx + 3, y + 2.4, sz + 2.6, fac);
        for (let k = ri(2, 5), u = jf(1.5, 3); k > 0 && u < W - 1.5; k--, u += 1.4) { if (u > sx - 1 && u < sx + 4) continue; g.box(u - .45, y, D - 2.2, u + .45, y + .3, D - 1.3, cc('#A9A2B8')); g.frustum(u, y + .3, D - 1.75, .5, .5, 1.1, 10, cc(PAL.tank)); }
        for (let k = ri(0, 3), u = jf(1.5, 4); k > 0 && u < W - 2; k--, u += 2.4) {
          if (u > sx - 2.2 && u < sx + 4) continue;
          withM(g, mm(b.M, mT(u, y + .45, 1.6), mRx(-.6)), () => g.box(-.9, -.03, -.8, .9, .03, .8, cc(PAL.solar)));
          withM(g, mm(b.M, mT(u - .95, y + 1.05, 1.0), mRz(HALF)), () => g.frustum(0, 0, 0, .24, .24, 1.9, 8, cc(PAL.tank)));
        }
        g.frustum(jf(1, W - 1), y, jf(1, D - 1), .04, .04, 2.6, 4, cc(PAL.pole));
      }
    });
    g.M = null;
  }

  // ---------------------------------------------------------------- the ground: streets, sidewalks, yards, the park, the square, rubble mounds
  {
    const g = gG;
    g.color(cc(PAL.asphalt), 0); g.quad(-900, 0, -900, -900, 0, 900, 900, 0, 900, 900, 0, -900);
    for (let j = CJ0; j <= CJ1; j++) for (let i = CI0; i <= CI1; i++) {
      if (isPlazaLot(i, j)) continue;
      const lx = lotX(i), lz = lotZ(j), dist = inDistrict(i, j), walk = cc(dist ? PAL.walk : '#938FAE'), curb = cc(PAL.curb), y = .15;
      g.box(lx, 0, lz, lx + LX, y, lz + SWK, walk, 4 | 1 | 2 | 32, curb); g.box(lx, 0, lz + LZ - SWK, lx + LX, y, lz + LZ, walk, 4 | 1 | 2 | 16, curb);
      g.box(lx, 0, lz + SWK, lx + SWK, y, lz + LZ - SWK, walk, 4 | 2, curb); g.box(lx + LX - SWK, 0, lz + SWK, lx + LX, y, lz + LZ - SWK, walk, 4 | 1, curb);
      const park = dist && i === 0 && j === jp;
      g.box(lx + SWK, 0, lz + SWK, lx + LX - SWK, y, lz + LZ - SWK, cc(park ? PAL.grass : dist ? PAL.yard : PAL.ctxYard), 4);
      if (dist && !park) {                                              // garden beds in the yards
        for (let k = 0; k < 4; k++) { const w = jf(3, 7), d = jf(2.5, 5), x = lx + jf(4, LX - 4 - w), z = lz + jf(4, LZ - 4 - d); if (hitsBld(x + w / 2, z + d / 2, Math.max(w, d) / 2 + .6)) continue; g.box(x, y, z, x + w, y + .1, z + d, cc(PAL.garden), 4 | 1 | 2 | 16 | 32, cc('#8F8AA8')); }
      }
      if (park) {                                                       // paths, a fountain, benches
        const cx = lx + LX / 2, cz = lz + LZ / 2;
        g.box(lx + SWK, y, cz - 1.1, lx + LX - SWK, y + .05, cz + 1.1, cc(PAL.path), 4 | 16 | 32); g.box(cx - 1.1, y, lz + SWK, cx + 1.1, y + .05, lz + LZ - SWK, cc(PAL.path), 4 | 1 | 2);
        g.frustum(cx, y, cz, 5.6, 5.6, .06, 24, cc(PAL.path)); g.frustum(cx, y, cz, 3.4, 3.4, .55, 24, cc('#C9C2D3')); g.frustum(cx, y + .06, cz, 3.1, 3.1, .44, 24, cc(PAL.water)); g.frustum(cx, y, cz, .35, .3, 1.5, 10, cc('#C9C2D3'));
        for (const [bx, bz, r] of [[cx - 4.5, cz + 2.2, 0], [cx + 4.5, cz - 2.2, Math.PI], [cx + 2.2, cz + 4.5, HALF], [cx - 2.2, cz - 4.5, -HALF]]) withM(g, mm(mT(bx, y, bz), mRy(r)), () => { g.box(-.9, .42, -.22, .9, .48, .22, cc(WOOD[0])); g.box(-.9, .48, .18, .9, .85, .22, cc(WOOD[0])); g.box(-.8, 0, -.18, -.7, .42, .18, cc(PAL.dark)); g.box(.7, 0, -.18, .8, .42, .18, cc(PAL.dark)); });
      }
    }
    const P = PLAZA;
    g.box(P.x0, 0, P.z0, P.x1, .12, P.z1, cc(PAL.plaza), 4 | 1 | 2 | 16 | 32, cc(PAL.curb));
    gMk.color(cc(PAL.plazaLine), .02);
    for (let x = PLZ.x0 + 3; x < P.x1 - 1; x += 3) gMk.quad(x - .04, .135, PLZ.z0 + .5, x - .04, .135, PLZ.z1 - .5, x + .04, .135, PLZ.z1 - .5, x + .04, .135, PLZ.z0 + .5);
    for (const q of PLAZA_BEDS) { g.box(q.x0, .12, q.z0, q.x1, .24, q.z1, cc(PAL.grass), 4 | 1 | 2 | 16 | 32, cc(PAL.curb)); }
    // rubble mounds (smooth soft clay) from the height field
    const W1 = HXN + 1, hv = (i, k) => (i < 0 || k < 0 || i > HXN || k > HZN ? 0 : HF[k * W1 + i]);
    const vy = (i, k) => { const h = hv(i, k), x = HX0 + i, z = HZ0 + k; return h > .02 ? groundY(x, z) + h + .02 : groundY(x, z) - .06; };
    // per-vertex arrays once (heights, normals, colours), then the quads that touch rubble
    const NV = W1 * (HZN + 1), VY = new Float32Array(NV), VN = new Float32Array(NV * 3), VC = new Float32Array(NV * 3), need = new Uint8Array(NV);
    for (let k = 0; k < HZN; k++) for (let i = 0; i < HXN; i++) if (hv(i, k) > .02 || hv(i + 1, k) > .02 || hv(i, k + 1) > .02 || hv(i + 1, k + 1) > .02) { need[k * W1 + i] = need[k * W1 + i + 1] = need[(k + 1) * W1 + i] = need[(k + 1) * W1 + i + 1] = 1; }
    const cA = cc('#B3ACC2'), cB = cc('#BBA3A2');
    for (let k = 0; k <= HZN; k++) for (let i = 0; i <= HXN; i++) {
      const v = k * W1 + i; if (!need[v]) continue;
      const x = HX0 + i, z = HZ0 + k, h = hv(i, k), nx = hv(i - 1, k) - hv(i + 1, k), nz = hv(i, k - 1) - hv(i, k + 1), l = Math.hypot(nx, 2, nz);
      VY[v] = vy(i, k); VN[v * 3] = nx / l; VN[v * 3 + 1] = 2 / l; VN[v * 3 + 2] = nz / l;
      const c = vnoise(x * .15 + 9, z * .15, 33) > .76 ? cB : cA, sh = .84 + .28 * fbm(x * .23, z * .23, 77, 3) + .05 * Math.min(h, 3);
      VC[v * 3] = c.r * sh; VC[v * 3 + 1] = c.g * sh; VC[v * 3 + 2] = c.b * sh;
    }
    const emitV = (i, k) => { const v = k * W1 + i; g.vtx(HX0 + i, VY[v], HZ0 + k, VN[v * 3], VN[v * 3 + 1], VN[v * 3 + 2], VC[v * 3], VC[v * 3 + 1], VC[v * 3 + 2]); };
    for (let k = 0; k < HZN; k++) for (let i = 0; i < HXN; i++) {
      if (hv(i, k) <= .02 && hv(i + 1, k) <= .02 && hv(i, k + 1) <= .02 && hv(i + 1, k + 1) <= .02) continue;
      emitV(i, k); emitV(i, k + 1); emitV(i + 1, k + 1); emitV(i, k); emitV(i + 1, k + 1); emitV(i + 1, k);
    }
  }
  // chunks scattered on the mounds (small ones everywhere, big broken slabs and rebar here and there)
  {
    const sp = LOW ? 1.05 : .75;
    for (let z = HZ0; z < HZ0 + HZN; z += sp) for (let x = HX0; x < HX0 + HXN; x += sp) {
      const px = x + jf(0, sp), pz = z + jf(0, sp), h = rubbleH(px, pz); if (h < .06) continue;
      if (RJ() > Math.min(1, .55 + h * .7)) continue;
      const y = groundY(px, pz) + h;
      if (RJ() < (h > 2 ? .09 : .05) && h > .3) {
        const L = jf(1.2, h > 2 ? 3.4 : 2.6), M = mm(mT(px, y - .1, pz), mRy(jf(0, TAU)), mRz(jf(-.5, .5)), mRx(jf(-.4, .4)));
        withM(gCut, M, () => { gCut.box(-L / 2, -.11, -jf(.4, .8), L / 2, .11, jf(.4, .8), cc(pick(['#C3BCCB', '#B7AFC3', '#CFC7D3'])), 63, cc(PAL.slabEdge)); if (RJ() < .5) for (let k = 0; k < 4; k++) withM(gCut, mm(M, mT(L / 2, 0, jf(-.4, .4)), mRy(jf(-.5, .5)), mRz(jf(-.6, .6))), () => gCut.box(0, -.015, -.015, jf(.3, .8), .015, .015, cc('#5E5874'))); });
        continue;
      }
      const s = jf(.18, .42) * (.75 + Math.min(h, 4) * .25);
      if (s > .45 && RJ() < .6) addChunk(chunkB, px, y - s * .2, pz, s * 1.1, .6); else addChunk(chunkS, px, y - s * .25, pz, s);
      if (RJ() < .035) { const fab = cc(pick(FABRIC.concat(FACADES))); addChunk(chunkS, px, y, pz, jf(.3, .5), .35, fab); }   // painted plaster, a cushion
    }
  }

  // ---------------------------------------------------------------- road markings, crossings, cracks
  {
    const g = gMk, Y = .035, col = cc('#C7C2DA');
    const dash = (ax, az, bx, bz, w = .14, on = 2.4, off = 3.2) => { const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, px = -uz * w / 2, pz = ux * w / 2; g.color(col, .03); for (let t = 0; t + on <= L; t += on + off) { const x0 = ax + ux * t, z0 = az + uz * t, x1 = x0 + ux * on, z1 = z0 + uz * on; if (obstacleAt((x0 + x1) / 2, (z0 + z1) / 2) > .25) continue; g.quad(x0 - px, Y, z0 - pz, x0 + px, Y, z0 + pz, x1 + px, Y, z1 + pz, x1 - px, Y, z1 - pz); } };
    for (let j = CJ0; j <= CJ1 + 1; j++) for (let i = CI0; i <= CI1; i++) { const z = Z0 + RD / 2 + j * (LZ + RD), x0 = lotX(i), near = Math.abs(z) < 140 && Math.abs(x0) < 200; if (near) dash(x0 + 1, z, x0 + LX - 1, z); }
    for (let i = CI0; i <= CI1 + 1; i++) for (let j = CJ0; j <= CJ1; j++) { const x = X0 + RD / 2 + i * (LX + RD), z0 = lotZ(j), near = Math.abs(x) < 200 && Math.abs(z0) < 140; if (near && !(x < X0 && z0 > PLAZA.z0 - 1 && z0 < PLAZA.z1)) dash(x, z0 + 1, x, z0 + LZ - 1); }
    // zebra crossings on each arm of the district's crossings
    for (let j = 0; j <= NZL; j++) for (let i = 0; i <= NXL; i++) {
      const cx = roadX(i), cz = roadZ(j);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ox = cx + dx * (RD / 2 + 2), oz = cz + dz * (RD / 2 + 2); if (obstacleAt(ox, oz) > .25) continue;
        g.color(col, .03);
        for (let s = -3.6; s <= 3.6; s += 1.0) { if (dx) g.quad(ox - 1.4, Y, oz + s - .22, ox - 1.4, Y, oz + s + .22, ox + 1.4, Y, oz + s + .22, ox + 1.4, Y, oz + s - .22); else g.quad(ox + s - .22, Y, oz - 1.4, ox + s - .22, Y, oz + 1.4, ox + s + .22, Y, oz + 1.4, ox + s + .22, Y, oz - 1.4); }
      }
    }
    // the ground split open: jagged cracks across the asphalt and the yards
    for (let k = 0; k < (LOW ? 6 : 11); k++) {
      let x = jf(X0 + 8, X1 - 8), z = jf(Z0 + 8, Z1 - 8), a = jf(0, TAU); const w0 = jf(.05, .14);
      g.color(cc('#38355E'), .05);
      for (let s = 0; s < ri(10, 22); s++) { const L = jf(.6, 1.6), x2 = x + Math.cos(a) * L, z2 = z + Math.sin(a) * L, w = w0 * jf(.5, 1.2), px = -Math.sin(a) * w, pz = Math.cos(a) * w, y = Math.max(groundY(x, z), groundY(x2, z2)) + Y; if (!hitsBld(x, z, .3)) g.quad(x - px, y, z - pz, x + px, y, z + pz, x2 + px, y, z2 + pz, x2 - px, y, z2 - pz); x = x2; z = z2; a += jf(-.8, .8); if (x < X0 || x > X1 || z < Z0 || z > Z1) break; }
    }
    // patched asphalt
    for (let k = 0; k < 14; k++) { const horiz = RJ() < .5, x = horiz ? jf(X0, X1) : roadX(RJ() * (NXL + 1) | 0) + jf(-2.5, 2.5), z = horiz ? roadZ(RJ() * (NZL + 1) | 0) + jf(-2.5, 2.5) : jf(Z0, Z1), w = jf(1.5, 4), d = jf(1, 2.5); g.color(cc('#45446A'), .03); g.quad(x - w, .02, z - d, x - w, .02, z + d, x + w, .02, z + d, x + w, .02, z - d); }
  }

  // ---------------------------------------------------------------- the context city (outside the search): clay massing fading into the fog
  {
    const g = gS;
    for (let j = CJ0; j <= CJ1; j++) for (let i = CI0; i <= CI1; i++) {
      if (inDistrict(i, j) || isPlazaLot(i, j)) continue;
      if (LOW && Math.max(i < 0 ? -i : i >= NXL ? i - NXL + 1 : 0, j < 0 ? -j : j >= NZL ? j - NZL + 1 : 0) > 2) continue;
      const r = rngOf(Math.floor(hash(i + 50, j + 50, SEED) * 4e9)), rr = (a, b) => a + r() * (b - a);
      const lx = lotX(i), lz = lotZ(j), ring = Math.max(i < 0 ? -i : i >= NXL ? i - NXL + 1 : 0, j < 0 ? -j : j >= NZL ? j - NZL + 1 : 0);
      if (ring === 1 && r() < .22) { for (let k = 0; k < 4; k++) trees.push({ x: lx + rr(5, LX - 5), z: lz + rr(5, LZ - 5), y: .15, s: rr(.8, 1.2), kind: 'round', ctx: true }); continue; }
      if (r() < .1) { for (let k = 0; k < 10; k++) trees.push({ x: lx + rr(5, LX - 5), z: lz + rr(5, LZ - 5), y: .15, s: rr(.8, 1.2), kind: r() < .3 ? 'cypress' : 'round', ctx: true }); continue; }
      const nb = r() < .55 ? 2 : 1;
      for (let k = 0; k < nb; k++) {
        const w = nb === 2 ? rr(14, 18) : rr(18, 30), d = rr(10, 14), x0 = nb === 2 ? lx + 4 + k * (LX - 8 - w) : lx + rr(4, LX - 4 - w), z0 = lz + rr(4, LZ - 4 - d), fl = Math.floor(ring === 1 ? rr(2, 3.99) : ring === 2 ? rr(2, 5.99) : rr(3, 7.99)), h = fl * H + .3, col = cc(CTX[Math.floor(r() * CTX.length)]);
        if (r() < .2) {                                                 // collapsed: a low heap with slabs
          const cx = x0 + w / 2, cz = z0 + d / 2, hh = rr(1.6, 3.2), rx = w / 2 + 3, rz = d / 2 + 3, sd = Math.floor(r() * 999);
          dome(g, cx, cz, rx, rz, hh, sd);
          for (let q = 0; q < 4; q++) withM(g, mm(mT(cx + rr(-w / 3, w / 3), hh * rr(.5, .9), cz + rr(-d / 3, d / 3)), mRy(rr(0, 3)), mRz(rr(-.45, .45)), mRx(rr(-.3, .3))), () => g.box(-rr(1.5, 3), -.12, -rr(1, 2), rr(1.5, 3), .12, rr(1, 2), cc(PAL.slab), 63, cc(PAL.slabEdge)));
          for (let q = 0; q < 25; q++) { const a = rr(0, TAU), t = Math.sqrt(r()); addChunk(chunkS, cx + Math.cos(a) * t * (w / 2 + 1.5), .15 + hh * (1 - t * t) * .9, cz + Math.sin(a) * t * (d / 2 + 1.5), rr(.3, .7)); }
          continue;
        }
        g.box(x0, .15, z0, x0 + w, h, z0 + d, cc(PAL.roof), 63 & ~8, col);
        for (let f = 1; f < fl; f++) g.box(x0 - .05, f * H - .08, z0 - .05, x0 + w + .05, f * H + .08, z0 + d + .05, cc(PAL.band), 63 & ~8 & ~4);
        if (r() < .14) { const o = .4, hh = Math.min(w, d) * .3, u0 = x0 - o, u1 = x0 + w + o, v0 = z0 - o, v1 = z0 + d + o, hd = (v1 - v0) / 2, vm = (v0 + v1) / 2, ru0 = u0 + hd, ru1 = u1 - hd; g.color(cc('#BCA6B2'), .04); g.quad(u0, h, v0, ru0, h + hh, vm, ru1, h + hh, vm, u1, h, v0); g.quad(u1, h, v1, ru1, h + hh, vm, ru0, h + hh, vm, u0, h, v1); g.tri(u1, h, v0, ru1, h + hh, vm, u1, h, v1); g.tri(u0, h, v1, ru0, h + hh, vm, u0, h, v0); }
        else { g.box(x0, h, z0, x0 + w, h + .6, z0 + .2, col); g.box(x0, h, z0 + d - .2, x0 + w, h + .6, z0 + d, col); g.box(x0 + rr(2, w - 5), h, z0 + rr(2, d - 4), x0 + rr(5, w - 2), h + 2.2, z0 + rr(4.5, d - 1.5), col); }
      }
      if (r() < .6) for (let k = 0; k < 3; k++) { const x = lx + rr(4, LX - 4), z = lz + rr(4, LZ - 4); trees.push({ x, z, y: .15, s: rr(.8, 1.1), kind: r() < .25 ? 'cypress' : 'round', ctx: true }); }
    }
    // mountains far away, as in Antakya: a soft ridge in the fog
    const mg = gS;
    for (let k = 0; k < 96; k++) {
      const a0 = k / 96 * TAU, a1 = (k + 1) / 96 * TAU, rad = 560, h0 = 45 + 120 * fbm(Math.cos(a0) * 2 + 9, Math.sin(a0) * 2, 5, 4), h1 = 45 + 120 * fbm(Math.cos(a1) * 2 + 9, Math.sin(a1) * 2, 5, 4);
      mg.color(cc(PAL.mountain), 0);
      mg.quad(Math.cos(a0) * rad, -2, Math.sin(a0) * rad, Math.cos(a0) * (rad + 60), h0, Math.sin(a0) * (rad + 60), Math.cos(a1) * (rad + 60), h1, Math.sin(a1) * (rad + 60), Math.cos(a1) * rad, -2, Math.sin(a1) * rad);
    }
  }

  // ---------------------------------------------------------------- parked cars (crushed where the rubble reached them), street lights, the utility poles
  const carInst = [];                                                   // { M, col }
  {
    for (let j = CJ0; j <= CJ1; j++) for (let i = CI0; i <= CI1; i++) {
      const dist = inDistrict(i, j); if (isPlazaLot(i, j)) continue;
      const far = Math.hypot(lotX(i) + LX / 2, lotZ(j) + LZ / 2); if (far > 175) continue;
      const lx = lotX(i), lz = lotZ(j), dens = dist ? .5 : LOW ? .08 : .2;
      for (let side = 0; side < 4; side++) {
        const horiz = side < 2, len = horiz ? LX : LZ;
        for (let t = 4; t < len - 4; t += 6.2) {
          if (R() > dens) continue;
          const along = t + jf(-.5, .5), x = horiz ? lx + along : (side === 2 ? lx - 1.15 : lx + LX + 1.15), z = horiz ? (side === 0 ? lz - 1.15 : lz + LZ + 1.15) : lz + along;
          if (x > PLAZA.x0 - 2 && x < PLAZA.x1 + 2 && z > PLAZA.z0 - 2 && z < PLAZA.z1 + 2) continue;
          if (hazard.poles.some((p) => Math.hypot(p.x - x, p.z - z) < 4) || onWire(x, z) || inPool(x, z)) continue;
          const h = rubbleH(x, z); let blocked = false, under = false; for (const q of blockers) { if (x > q.x0 - 1.2 && x < q.x1 + 1.2 && z > q.z0 - 1.2 && z < q.z1 + 1.2) blocked = true; if (x > q.x0 + .6 && x < q.x1 - .6 && z > q.z0 + .6 && z < q.z1 - .6) under = true; } if (under) continue;
          const yaw = (horiz ? 0 : HALF) + (R() < .5 ? 0 : Math.PI) + jf(-.05, .05);
          let M;
          if (h > 1.5) continue;
          else if (h > .45 || blocked) M = mm(mT(x, Math.max(0, h * .45), z), mRy(yaw + jf(-.3, .3)), mRz(jf(-.15, .15)), mRx(jf(-.12, .12)), mS(1, blocked ? .38 : .55, 1));
          else M = mm(mT(x, 0, z), mRy(yaw));
          carInst.push({ M, col: cc(pick(CARS)) });
        }
      }
    }
    // abandoned at odd angles in the district's streets
    for (let k = 0; k < 4; k++) { const horiz = R() < .5, x = horiz ? jf(X0 + 12, X1 - 12) : roadX(ri(1, NXL - 1)) + jf(-2, 2), z = horiz ? roadZ(ri(0, NZL)) + jf(-2, 2) : jf(Z0 + 12, Z1 - 12); if (obstacleAt(x, z) > .2 || inPool(x, z) || Math.abs(z - MZ) < 5 && x < roadX(1) || carInst.some((c) => Math.hypot(c.M.elements[12] - x, c.M.elements[14] - z) < 5.5)) continue; carInst.push({ M: mm(mT(x, 0, z), mRy((horiz ? 0 : HALF) + jf(-.6, .6))), col: cc(pick(CARS)) }); }
  }
  const lightInst = [];
  for (let j = 0; j < NZL; j++) for (let i = 0; i < NXL; i++) {
    const lx = lotX(i), lz = lotZ(j);
    for (let side = 0; side < 4; side++) {
      const horiz = side < 2, len = horiz ? LX : LZ;
      for (let t = 8; t < len - 4; t += 22) {
        const x = horiz ? lx + t : (side === 2 ? lx + .45 : lx + LX - .45), z = horiz ? (side === 0 ? lz + .45 : lz + LZ - .45) : lz + t;
        if (hitsBld(x, z, .5) || hazard.poles.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
        const yaw = horiz ? (side === 0 ? HALF : -HALF) : (side === 2 ? Math.PI : 0), h = rubbleH(x, z);
        lightInst.push(mm(mT(x, .15, z), mRy(yaw), h > .4 ? mm(mRz(jf(-.25, .25)), mRx(jf(-.2, .2))) : new THREE.Matrix4()));
      }
    }
  }
  {
    // the utility poles with three wires; the middle one lies across the street, its wire live on the road
    const g = gS, P = hazard.poles, top = 8.2;
    const heads = P.map((p) => (p.fallen ? V(p.top.x, .35, p.top.z) : V(p.x, top, p.z)));
    for (const p of P) {
      if (p.fallen) { const dx = p.top.x - p.x, dz = p.top.z - p.z, L = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx); withM(g, mm(mT(p.x, .2, p.z), mRy(yaw), mRz(-HALF + Math.atan2(.3, L))), () => { g.frustum(0, 0, 0, .16, .12, Math.hypot(L, .3), 7, cc('#7A7091')); g.box(-.9, Math.hypot(L, .3) - .5, -.06, .9, Math.hypot(L, .3) - .38, .06, cc('#6A6284')); }); g.frustum(p.x, 0, p.z, .2, .2, .5, 7, cc('#7A7091')); }
      else { g.frustum(p.x, 0, p.z, .17, .12, top, 7, cc('#7A7091')); withM(g, mm(mT(p.x, top - .45, p.z), mRy(hazard.seg.horiz ? HALF : 0)), () => g.box(-.9, 0, -.06, .9, .12, .06, cc('#6A6284'))); }
    }
    for (let k = 0; k + 1 < P.length; k++) for (const off of [-.75, 0, .75]) {
      const a = heads[k], b2 = heads[k + 1], sag = P[k].fallen || P[k + 1].fallen ? 0 : .8, n = 10;
      const offV = hazard.seg.horiz ? V(0, 0, off) : V(off, 0, 0);
      for (let s = 0; s < n; s++) {
        const t0 = s / n, t1 = (s + 1) / n, p0 = a.clone().lerp(b2, t0).add(offV).setY(a.y + (b2.y - a.y) * t0 - Math.sin(t0 * Math.PI) * sag), p1 = a.clone().lerp(b2, t1).add(offV).setY(a.y + (b2.y - a.y) * t1 - Math.sin(t1 * Math.PI) * sag);
        beam(g, p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, .05, cc('#3A3858'));
      }
    }
  }

  // ---------------------------------------------------------------- the staging square: van, tether station, tent, floodlights, launch mat, rescuers, cordon
  const emissive = [];                                                  // { mesh, base, kind }
  const anchorsExtra = {};
  let vanObj = null, stationTop = null;
  {
    const g = gS, vx = VANP.x, vz = VANP.z, VM = mm(mT(vx, .12, vz));
    const pv = prop('van');
    if (pv) {
      vanObj = pv.clone(true); vanObj.position.set(vx, .12, vz); vanObj.rotation.y = 0; vanObj.userData.shared = true; vanObj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.shared = true; } });
      vanObj.updateMatrixWorld(true);
      const rm = vanObj.getObjectByName('roof_mount'); const rmp = rm ? rm.getWorldPosition(V()) : V(vx - .4, 2.6, vz);
      const ps = prop('tether_station');
      if (ps) { const st = ps.clone(true); st.position.copy(rmp); st.userData.shared = true; st.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.shared = true; } }); st.updateMatrixWorld(true); anchorsExtra.stationObj = st; const co = st.getObjectByName('cable_out'); stationTop = co ? co.getWorldPosition(V()) : rmp.clone().add(V(0, .9, 0)); }
      else { withM(g, mT(rmp.x, rmp.y, rmp.z), () => { g.box(-.45, 0, -.35, .45, .4, .35, cc('#D9D3E2')); withM(g, mm(mT(rmp.x, rmp.y + .62, rmp.z), mRx(HALF)), () => g.frustum(0, -.3, 0, .24, .24, .6, 12, cc(PAL.apricot))); }); stationTop = rmp.clone().add(V(0, .9, 0)); }
    } else {
      vanGeo(g, VM, PAL.apricot);
      withM(g, VM, () => g.box(-.45, 2.62, -.35, .45, 3.0, .35, cc('#D9D3E2')));
      withM(g, mm(VM, mT(0, 3.22, 0), mRx(HALF)), () => g.frustum(0, -.32, 0, .24, .24, .64, 12, cc(PAL.apricot)));
      stationTop = V(vx, .12 + 3.48, vz);
      // light bar: apricot and rose, blinking slowly
      for (const [k, col] of [[0, PAL.apricot], [1, PAL.danger]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(.32, .14, .9), new THREE.MeshBasicMaterial({ color: cc(col).clone().multiplyScalar(1.6), toneMapped: false })); m.position.set(vx + 1.45 + k * .34, .12 + 2.58, vz); emissive.push({ mesh: m, base: cc(col).clone().multiplyScalar(1.6), kind: 'bar', phase: k }); }
    }
    // tent with a table and a stretcher
    const tx = X0 - 26, tz = MZ + 9;
    withM(g, mm(mT(tx, .12, tz), mRy(.08)), () => {
      for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) g.box(x - .04, 0, z - .04, x + .04, 2.2, z + .04, cc('#8E89A8'));
      g.color(cc(PAL.apricot), .02); const y0 = 2.2, y1 = 3.1;
      g.tri(-2.1, y0, -2.1, 0, y1, 0, 2.1, y0, -2.1); g.tri(2.1, y0, -2.1, 0, y1, 0, 2.1, y0, 2.1); g.tri(2.1, y0, 2.1, 0, y1, 0, -2.1, y0, 2.1); g.tri(-2.1, y0, 2.1, 0, y1, 0, -2.1, y0, -2.1);
      g.box(-2.1, y0 - .3, -2.12, 2.1, y0, -2.08, cc(PAL.apricot)); g.box(-2.1, y0 - .3, 2.08, 2.1, y0, 2.12, cc(PAL.apricot));
      g.box(-1.2, .72, -.5, 1.2, .78, .5, cc('#E2DCE6')); g.box(-1.1, 0, -.45, -1.0, .72, .45, cc(PAL.dark)); g.box(1.0, 0, -.45, 1.1, .72, .45, cc(PAL.dark));
      g.box(-.9, .45, 1.1, 1.1, .55, 1.65, cc(PAL.paper)); g.box(-.9, 0, 1.15, -.85, .45, 1.6, cc(PAL.dark)); g.box(1.05, 0, 1.15, 1.1, .45, 1.6, cc(PAL.dark));
    });
    // a second vehicle, a generator and a water tank
    const pv2 = prop('van');
    if (pv2) { const o = pv2.clone(true); o.position.set(X0 - 31, .12, MZ - 9); o.rotation.y = .5; o.userData.shared = true; o.traverse((q) => { if (q.isMesh) { q.castShadow = true; q.userData.shared = true; } }); (anchorsExtra.propObjs ||= []).push(o); }
    else vanGeo(g, mm(mT(X0 - 31, .12, MZ - 9), mRy(.5)), PAL.danger);
    withM(g, mm(mT(X0 - 21, .12, MZ - 15.5), mRy(.1)), () => { g.box(-1.1, 0, -.6, 1.1, 1.1, .6, cc('#C9B9A6')); g.box(-1.0, .2, .6, .4, .9, .62, cc('#6C6890')); g.box(-1.2, 0, -.7, 1.2, .12, .7, cc('#5C5880')); g.frustum(.7, 1.1, -.2, .07, .07, .5, 6, cc(PAL.dark)); });
    withM(g, mm(mT(X0 - 30, .97, MZ + 14), mRy(.3), mRz(HALF)), () => g.frustum(0, -1.4, 0, .85, .85, 2.8, 12, cc('#D6D0DE')));
    // launch mat with open drone cases
    withM(g, mT(BASE.x, .12, BASE.z), () => {
      g.box(-3.2, 0, -3.2, 3.2, .04, 3.2, cc('#DCD6E2'), 4 | 1 | 2 | 16 | 32); g.box(-3, .04, -3, 3, .05, 3, cc('#E9E4EC'), 4);
      for (const [x, z] of [[-4.2, -1.6], [-4.2, .2], [-4.2, 2.0], [4.1, -2.2]]) { g.box(x - .55, 0, z - .8, x + .55, .42, z + .8, cc('#4D4A70')); withM(g, mm(mT(BASE.x + x + .55, .12 + .42, BASE.z + z), mRz(-1.9)), () => g.box(0, 0, -.8, 1.1, .08, .8, cc('#5A5780'))); }
    });
    // floodlights on tripods, lamps facing the district
    for (const [fx, fz, yaw] of [[X0 - 4.5, MZ - 13, .3], [X0 - 24, MZ + 17, -.4]]) {
      const d = V(Math.cos(yaw), 0, -Math.sin(yaw)), top = V(fx, 2.25, fz), head = V(fx, 5.45, fz);
      for (let k = 0; k < 3; k++) { const a = yaw + .6 + k * TAU / 3; beam(g, fx + Math.cos(a) * 1.05, .12, fz + Math.sin(a) * 1.05, top.x, top.y, top.z, .07, cc('#6E6B91')); }
      g.frustum(fx, 2.0, fz, .06, .05, 3.2, 6, cc('#6E6B91'));
      withM(g, mm(mT(head.x, head.y, head.z), mRy(yaw)), () => { g.box(-.28, -.32, -.6, .26, .32, .6, cc('#8B86A6')); g.box(-.05, -.5, -.05, .05, -.32, .05, cc('#6E6B91')); });
      const lamp = new THREE.Mesh(new THREE.PlaneGeometry(1.1, .55), new THREE.MeshBasicMaterial({ color: cc('#FFE9D2').clone().multiplyScalar(2.2), toneMapped: false }));
      lamp.position.copy(head).addScaledVector(d, .275); lamp.lookAt(lamp.position.clone().add(d)); emissive.push({ mesh: lamp, base: lamp.material.color.clone(), kind: 'lamp' });
      anchorsExtra.lamps = (anchorsExtra.lamps || []).concat([{ pos: lamp.position.clone(), dir: d }]);
    }
    // rescuers in helmets and apricot vests
    const pr = prop('rescuer');
    const spots = [[X0 - 7.5, MZ + 1.5, -HALF + .3], [X0 - 9, MZ - 1.2, -HALF], [X0 - 24.5, MZ + 8, .4], [X0 - 27.2, MZ + 9.5, -.6], [X0 - 16, MZ - 9.5, 2.6], [X0 - 4, MZ + 10.5, -HALF + .1]];
    anchorsExtra.rescuers = [];
    for (const [x, z, yaw] of spots) {
      anchorsExtra.rescuers.push(V(x, .12, z));
      if (pr) { const o = pr.clone(true); o.position.set(x, .12, z); o.rotation.y = yaw; o.userData.shared = true; o.traverse((q) => { if (q.isMesh) { q.castShadow = true; q.userData.shared = true; } }); anchorsExtra[`r${x}`] = o; (anchorsExtra.propObjs ||= []).push(o); continue; }
      withM(g, mm(mT(x, .12, z), mRy(yaw)), () => {
        g.box(-.17, 0, -.11, -.03, .85, .11, cc('#4C4A72')); g.box(.03, 0, -.11, .17, .85, .11, cc('#4C4A72'));
        g.box(-.22, .85, -.14, .22, 1.45, .14, cc(PAL.apricot)); g.box(-.3, .95, -.08, -.22, 1.42, .08, cc(PAL.rescuer)); g.box(.22, .95, -.08, .3, 1.42, .08, cc(PAL.rescuer));
        g.frustum(0, 1.45, 0, .11, .11, .22, 8, cc('#E3C3AE')); g.frustum(0, 1.62, 0, .15, .08, .14, 8, cc(PAL.paper));
      });
    }
    // cordon: posts and tape around the square's open side, with a gap where the street leaves
    const posts = [];
    for (let z = PLAZA.z0 + 14; z <= PLAZA.z1 - 14; z += 4) if (Math.abs(z - MZ) > 5.5) posts.push(V(X0 - 1.2, .12, z));
    for (const p of posts) g.frustum(p.x, p.y, p.z, .05, .05, 1.05, 6, cc('#E7E1EA'));
    for (let k = 0; k + 1 < posts.length; k++) {
      const a = posts[k], b2 = posts[k + 1]; if (Math.abs(b2.z - a.z) > 4.5) continue;
      for (let s = 0; s < 6; s++) {
        const t0 = s / 6, t1 = (s + 1) / 6, y0 = 1.0 - Math.sin(t0 * Math.PI) * .12, y1 = 1.0 - Math.sin(t1 * Math.PI) * .12;
        const p0 = a.clone().lerp(b2, t0), p1 = a.clone().lerp(b2, t1);
        g.color(cc(s % 2 ? PAL.paper : PAL.danger), .02); g.quad(p0.x, p0.y + y0 - .05, p0.z, p1.x, p1.y + y1 - .05, p1.z, p1.x, p1.y + y1 + .05, p1.z, p0.x, p0.y + y0 + .05, p0.z); g.quad(p0.x, p0.y + y0 - .05, p0.z, p0.x, p0.y + y0 + .05, p0.z, p1.x, p1.y + y1 + .05, p1.z, p1.x, p1.y + y1 - .05, p1.z);
      }
    }
    for (const [x, z] of [[X0 - .8, MZ - 4.2], [X0 - .8, MZ + 4.2], [X0 - 6, MZ - 8], [X0 + 1, MZ - 6.8]]) { g.frustum(x, .12, z, .22, .02, .7, 8, cc(PAL.danger), 1); g.box(x - .25, .12, z - .25, x + .25, .16, z + .25, cc(PAL.danger)); }
    // crates of shoring timber
    withM(g, mm(mT(X0 - 18, .12, MZ - 11), mRy(.2)), () => { for (let k = 0; k < 5; k++) g.box(-2, k * .16, -.6 + (k % 2) * .05, 2, k * .16 + .15, .6, cc(WOOD[k % 3])); });
  }
  function vanGeo(g, VM, stripe) {                                     // a responders' van, nose toward local +x
    withM(g, VM, () => {
      g.box(-2.9, .45, -1.05, 1.9, 2.5, 1.05, cc(PAL.van));
      g.box(1.9, .45, -1.05, 2.95, 1.45, 1.05, cc(PAL.van));
      g.quad(1.9, 2.5, -1.0, 1.9, 2.5, 1.0, 2.7, 1.45, 1.0, 2.7, 1.45, -1.0);
      g.color(cc(PAL.glass)); g.quad(1.92, 2.46, -.95, 1.92, 2.46, .95, 2.66, 1.5, .95, 2.66, 1.5, -.95);
      g.box(-2.92, 1.12, -1.07, 2.97, 1.38, 1.07, cc(stripe), 1 | 2 | 16 | 32);
      g.box(-1.6, 1.6, -1.07, 1.7, 2.2, -1.05, cc(PAL.glass), 32); g.box(-1.6, 1.6, 1.05, 1.7, 2.2, 1.07, cc(PAL.glass), 16);
      g.box(-2.95, .3, -1.0, 2.98, .5, 1.0, cc('#6C6890'));
      for (const [x, z] of [[-1.9, -.95], [-1.9, .95], [1.95, -.95], [1.95, .95]]) g.box(x - .38, .0, z - .14, x + .38, .76, z + .14, cc('#2E2C48'), 63 & ~8);
      for (const x of [-2.4, -1.2, .1, 1.2]) g.box(x, 2.5, -.95, x + .08, 2.62, .95, cc('#A9A3BC'));
    });
  }
  function dome(g, cx, cz, rx, rz, hh, sd) {                           // a soft rubble mound (smooth normals) for the context city
    const n = 10, n1 = n + 1, Y = new Float32Array(n1 * n1), col = cc('#9E97AF');
    for (let k = 0; k <= n; k++) for (let i = 0; i <= n; i++) { const a = i / n * 2 - 1, b = k / n * 2 - 1, d = Math.hypot(a, b); Y[k * n1 + i] = d >= 1 ? 0 : hh * Math.pow(1 - d * d, 1.3) * (.75 + .5 * fbm(a * 2 + sd, b * 2, sd, 2)); }
    const yv = (i, k) => Y[clamp(k, 0, n) * n1 + clamp(i, 0, n)];
    const vtx = (i, k) => { const y = yv(i, k), nx = (yv(i - 1, k) - yv(i + 1, k)) / (4 * rx / n), nz = (yv(i, k - 1) - yv(i, k + 1)) / (4 * rz / n), l = Math.hypot(nx, 1, nz), sh = .85 + .25 * Math.min(1, y / hh); g.vtx(cx + (i / n * 2 - 1) * rx, .15 + (y > .01 ? y : -.2), cz + (k / n * 2 - 1) * rz, nx / l, 1 / l, nz / l, col.r * sh, col.g * sh, col.b * sh); };
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
      if (yv(i, k) < .01 && yv(i + 1, k) < .01 && yv(i, k + 1) < .01 && yv(i + 1, k + 1) < .01) continue;
      vtx(i, k); vtx(i, k + 1); vtx(i + 1, k + 1); vtx(i, k); vtx(i + 1, k + 1); vtx(i + 1, k);
    }
  }
  function prop(name) { try { const root = props && (props.isObject3D ? props : props.scene); return root ? root.getObjectByName(name) || null : null; } catch (e) { return null; } }

  // ================================================================ materials and meshes
  const group = new THREE.Group(); group.name = 'city';
  const cutU = { cutR: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0)) }, cutY: { value: new Float32Array(6).fill(1e5) }, poche: { value: cc('#94707F').clone() } };
  function patchCut(m) {
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, cutU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCutW;').replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 cw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cw = instanceMatrix * cw;
          #endif
          vCutW = (modelMatrix * cw).xyz; }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vCutW; uniform vec4 cutR[6]; uniform float cutY[6]; uniform vec3 poche;
        bool cutAway() { for (int i = 0; i < 6; i++) { vec4 r = cutR[i]; if (vCutW.y > cutY[i] && vCutW.x > r.x && vCutW.x < r.z && vCutW.z > r.y && vCutW.z < r.w) return true; } return false; }`)
        .replace('void main() {', 'void main() {\n  if (cutAway()) discard;')
        .replace('#include <opaque_fragment>', 'if (!gl_FrontFacing) outgoingLight = poche;\n#include <opaque_fragment>');
    };
    m.customProgramCacheKey = () => 'liminal-city-cut';
    return m;
  }
  const depthCut = patchCut(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  const MAT = {
    cut: patchCut(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0, side: THREE.DoubleSide, shadowSide: THREE.BackSide })),
    stat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: 0 }),
    mark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    win: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: 0 }),
    rub: patchCut(new THREE.MeshStandardMaterial({ roughness: .95, metalness: 0, side: THREE.DoubleSide, shadowSide: THREE.BackSide })),
    crown: new THREE.MeshStandardMaterial({ roughness: .88, metalness: 0 }),
    trunk: new THREE.MeshStandardMaterial({ color: cc(PAL.trunk), roughness: .95, metalness: 0 }),
    car: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7, metalness: 0 }),
  };
  const surfMat = (opts = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, metalness: 0, ...opts });
  const addMesh = (geo, mat, { cast = true, recv = true, name = '', cut = false } = {}) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; m.name = name; if (cut) m.customDepthMaterial = depthCut; group.add(m); return m; };
  addMesh(gCut.geometry(), MAT.cut, { name: 'damaged blocks', cut: true });
  addMesh(gS.geometry(), MAT.stat, { name: 'city' });
  addMesh(gMk.geometry(), MAT.mark, { cast: false, name: 'markings' });
  const surfaces = [];
  const groundMesh = addMesh(gG.geometry(), surfMat(), { cast: false, name: 'ground' }); groundMesh.userData.layer = 'ground'; surfaces.push(groundMesh);
  const topD = byType('pancake');
  if (gTop.count()) { const m = addMesh(gTop.geometry(), surfMat(), { cast: true, name: 'pile top' }); m.userData.layer = 'ground'; surfaces.push(m); if (topD) topD.topMesh = m; }
  for (const b of dmg) for (const fl of b.floors) { const m = addMesh(emitSurface(fl), surfMat(), { cast: false, name: 'floor ' + fl.id }); m.userData.layer = fl.id; fl.mesh = m; surfaces.push(m); floorMeshes.push(m); }
  // water from the burst main
  if (hazard.pool) {
    const p = hazard.pool, pts = []; for (let k = 0; k < 28; k++) { const a = k / 28 * TAU, rr = p.r * (.75 + .5 * vnoise(Math.cos(a) * 2 + 3, Math.sin(a) * 2, p.seed)); pts.push([p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr]); }
    const shp = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))), geo = new THREE.ShapeGeometry(shp, 2).rotateX(-HALF);
    const posA = geo.getAttribute('position'); for (let i = 0; i < posA.count; i++) posA.setY(i, .045);
    const col = new Float32Array(posA.count * 3); const wc = cc(PAL.water); for (let i = 0; i < posA.count; i++) { col[i * 3] = wc.r; col[i * 3 + 1] = wc.g; col[i * 3 + 2] = wc.b; } geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = addMesh(geo, surfMat({ roughness: .18, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), { cast: false, name: 'water main' }); m.userData.layer = 'ground'; surfaces.push(m);
  }
  // ---------------------------------------------------------------- instanced things
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
  function instanced(geo, mat, mats, cols = null, { cast = true, recv = true, name = '', cut = false } = {}) {
    if (!mats.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, mats.length); im.name = name;
    mats.forEach((m, i) => im.setMatrixAt(i, m)); if (cols) cols.forEach((c, i) => im.setColorAt(i, c));
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = cast; im.receiveShadow = recv; if (cut) im.customDepthMaterial = depthCut;
    im.computeBoundingSphere(); group.add(im); return im;
  }
  const chunkMats = (list) => { const mats = [], cols = []; for (let i = 0; i < list.length; i += 10) { tmpP.set(list[i], list[i + 1], list[i + 2]); tmpQ.setFromEuler(tmpE.set(list[i + 3], list[i + 4], list[i + 5])); tmpS.set(list[i + 6], list[i + 7], list[i + 8]); mats.push(new THREE.Matrix4().compose(tmpP, tmpQ, tmpS)); cols.push(list[i + 9]); } return { mats, cols }; };
  function rockGeo(kind, s) {
    const g = kind === 'ico' ? new THREE.IcosahedronGeometry(.5, 0) : new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), h = hash(Math.round(x * 100), Math.round(y * 100) + Math.round(z * 37), s); const k = kind === 'ico' ? .78 + .45 * h : 1; p.setXYZ(i, x * k + (kind === 'box' ? (h - .5) * .22 : 0), y * k, z * k + (kind === 'box' ? (hash(Math.round(z * 100), Math.round(x * 100), s + 1) - .5) * .22 : 0)); }
    g.deleteAttribute('uv'); g.computeVertexNormals(); return g;
  }
  {
    const A = chunkMats(chunkS), B = chunkMats(chunkB);
    instanced(rockGeo('ico', 3), MAT.rub, A.mats, A.cols, { name: 'rubble', cut: true });
    const rp = [0, 1, 2, 3, 4, 5].map((k) => prop('rubble_' + k)).filter(Boolean);
    if (rp.length) {
      const per = rp.map(() => ({ mats: [], cols: [] })); B.mats.forEach((m, i) => { const k = i % rp.length; per[k].mats.push(m); per[k].cols.push(B.cols[i]); });
      rp.forEach((node, k) => { for (const part of propParts(node)) instanced(part.geo, MAT.rub, per[k].mats, per[k].cols, { name: 'rubble prop', cut: true }); });
    } else instanced(rockGeo('box', 5), MAT.rub, B.mats, B.cols, { name: 'rubble blocks', cut: true });
  }
  function floatGeom(src) {
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal']) { const a = src.getAttribute(k); if (!a) continue; const arr = new Float32Array(a.count * 3); for (let i = 0; i < a.count; i++) { arr[i * 3] = a.getX(i); arr[i * 3 + 1] = a.getY(i); arr[i * 3 + 2] = a.getZ(i); } g.setAttribute(k, new THREE.BufferAttribute(arr, 3)); }
    if (src.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index.array), 1));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    return g;
  }
  function propParts(node) {
    node.updateMatrixWorld(true);
    const inv = node.matrixWorld.clone().invert(), parts = [];
    node.traverse((o) => { if (o.isMesh) { const g = floatGeom(o.geometry); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); parts.push({ geo: g, mat: o.material }); } });
    return parts;
  }
  const propTris = (node) => { let n = 0; node.traverse((o) => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3; }); return n; };
  // windows, balcony doors, balconies (standing blocks)
  {
    const g = Builder(); g.jit = 0;
    g.color(cc(PAL.glass), 0); g.quad(-.66, 0, .02, .66, 0, .02, .66, 1.4, .02, -.66, 1.4, .02);
    g.box(-.82, -.08, 0, .82, 0, .2, cc(PAL.frame)); g.box(-.76, 1.4, 0, .76, 1.52, .08, cc(PAL.frame)); g.box(-.76, 0, 0, -.66, 1.4, .07, cc(PAL.frame)); g.box(.66, 0, 0, .76, 1.4, .07, cc(PAL.frame));
    const wgeo = g.geometry();
    instanced(wgeo, MAT.win, winInst, null, { cast: false, name: 'windows' });
    instanced(wgeo, MAT.win, doorInst.map((M) => mm(M, mS(1, 1.6, 1))), null, { cast: false, name: 'balcony doors' });
    const gb = Builder(); gb.jit = 0;
    gb.box(-1.45, -.15, 0, 1.45, 0, 1.3, cc(PAL.slab), 63, cc(PAL.slabEdge)); gb.box(-1.45, 0, 1.2, 1.45, .95, 1.3, cc(PAL.band)); gb.box(-1.45, 0, 0, -1.37, .95, 1.2, cc(PAL.band)); gb.box(1.37, 0, 0, 1.45, .95, 1.2, cc(PAL.band));
    instanced(gb.geometry(), MAT.stat, balInst, null, { name: 'balconies' });
  }
  // trees: round crowns and cypresses (or props.glb trees when they are light enough)
  {
    const live = trees.filter((t) => !t.fallen), fallen = trees.filter((t) => t.fallen);
    const tm = [], cm = [], cols = [], ccol = ['#7E9D8A', '#8BA894', '#73927F', '#95AF9C', '#7A9886'];
    for (const t of live) {
      const s = t.s, th = (t.kind === 'cypress' ? 2.2 : 2.6) * s;
      tm.push(new THREE.Matrix4().compose(V(t.x, t.y, t.z), tmpQ.identity(), V(.18 * s, th, .18 * s)));
      if (t.kind === 'cypress') { cm.push(new THREE.Matrix4().compose(V(t.x, t.y + th + 2.6 * s, t.z), tmpQ.setFromEuler(tmpE.set(0, jf(0, 3), 0)), V(.95 * s, 3.4 * s, .95 * s))); cols.push(cc('#6A8B78')); }
      else { const n = LOW || t.ctx ? 1 : 2 + (RJ() * 2 | 0); for (let k = 0; k < n; k++) { const r = (1.55 + jf(-.2, .3)) * s * (k ? .78 : 1); cm.push(new THREE.Matrix4().compose(V(t.x + (k ? jf(-1, 1) * s : 0), t.y + th + r * .55 + (k ? jf(-.3, .6) : 0), t.z + (k ? jf(-1, 1) * s : 0)), tmpQ.setFromEuler(tmpE.set(jf(0, 3), jf(0, 3), 0)), V(r, r * .86, r))); cols.push(cc(pick(ccol))); } }
    }
    for (const t of fallen) {                                            // toppled by the rubble
      const s = t.s, q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.dir, 1.35)), up = V(0, 1, 0).applyQuaternion(q);
      tm.push(new THREE.Matrix4().compose(V(t.x, t.y, t.z), q, V(.18 * s, 2.6 * s, .18 * s)));
      const c = V(t.x, t.y, t.z).addScaledVector(up, 2.6 * s + 1.4 * s); cm.push(new THREE.Matrix4().compose(c, q, V(1.5 * s, 1.3 * s, 1.5 * s))); cols.push(cc('#7A8E80'));
    }
    const ptb = prop('tree_broad');
    instanced(new THREE.CylinderGeometry(.6, 1, 1, 6, 1).translate(0, .5, 0), MAT.trunk, tm, null, { name: 'trunks' });
    if (ptb && propTris(ptb) * cm.length < 70000) {
      const mats = live.map((t) => new THREE.Matrix4().compose(V(t.x, t.y, t.z), tmpQ.setFromEuler(tmpE.set(0, jf(0, TAU), 0)), V(t.s, t.s, t.s)));
      for (const part of propParts(ptb)) instanced(part.geo, part.mat, mats, null, { name: 'tree prop' });
    } else instanced(new THREE.IcosahedronGeometry(1, 1), MAT.crown, cm, cols, { name: 'crowns' });
  }
  // cars
  {
    const g = Builder(); g.jit = 0;
    g.box(-2.15, .3, -.86, 2.15, .92, .86, cc('#FFFFFF'));
    const b0 = [-1.25, .92, -.8], b1 = [1.0, .92, -.8], b2 = [1.0, .92, .8], b3 = [-1.25, .92, .8], t0 = [-1.0, 1.46, -.7], t1 = [.45, 1.46, -.7], t2 = [.45, 1.46, .7], t3 = [-1.0, 1.46, .7];
    g.color(cc('#3B3E68'), 0); g.quad(...b1, ...t1, ...t2, ...b2); g.quad(...b0, ...b3, ...t3, ...t0); g.quad(...b0, ...t0, ...t1, ...b1); g.quad(...b3, ...b2, ...t2, ...t3);
    g.color(cc('#FFFFFF'), 0); g.quad(...t0, ...t3, ...t2, ...t1);
    for (const [x, z] of [[-1.35, -.8], [-1.35, .8], [1.35, -.8], [1.35, .8]]) g.box(x - .32, 0, z - .13, x + .32, .62, z + .13, cc('#2A2A40'), 63 & ~8);
    const cgeo = g.geometry();
    instanced(cgeo, MAT.car, carInst.map((c) => c.M), carInst.map((c) => c.col), { name: 'cars' });
  }
  // street lights (dark: the power is out)
  {
    const g = Builder(); g.jit = 0;
    g.frustum(0, 0, 0, .1, .07, 7, 6, cc(PAL.pole)); g.box(0, 6.82, -.04, 1.5, 6.9, .04, cc(PAL.pole)); g.box(1.25, 6.7, -.16, 2.0, 6.86, .16, cc(PAL.lampHead));
    instanced(g.geometry(), MAT.stat, lightInst, null, { name: 'street lights' });
  }
  // emissive bits + glows (the live wire's sparks, the van's light bar, floodlights)
  const glowTex = (() => { if (typeof document === 'undefined') return null; const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  for (const e of emissive) group.add(e.mesh);
  let spark = null, sparkGlow = null;
  if (hazard.wire) {
    spark = new THREE.Mesh(new THREE.IcosahedronGeometry(.09, 0), new THREE.MeshBasicMaterial({ color: cc('#FFE7D6').clone().multiplyScalar(2.5), toneMapped: false })); spark.position.set(hazard.wire.x, .4, hazard.wire.z); group.add(spark);
    if (glowTex) { sparkGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: cc(PAL.danger), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .9 })); sparkGlow.position.copy(spark.position); sparkGlow.scale.setScalar(2.4); group.add(sparkGlow); }
  }
  if (glowTex) {
    for (const L of anchorsExtra.lamps || []) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: cc('#FFE2C4'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .8 })); sp.position.copy(L.pos); sp.scale.setScalar(3.2); group.add(sp);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-HALF), new THREE.MeshBasicMaterial({ map: glowTex, color: cc('#F6D2B1'), transparent: true, opacity: .22, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
      pool.position.copy(L.pos).addScaledVector(L.dir, 9).setY(.2); pool.scale.set(16, 1, 16); group.add(pool);
    }
    for (const e of emissive.filter((q) => q.kind === 'bar')) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: e.base.clone().multiplyScalar(.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .7 })); sp.position.copy(e.mesh.position); sp.scale.setScalar(1.6); group.add(sp); e.glow = sp; }
  }
  if (vanObj) group.add(vanObj);
  if (anchorsExtra.stationObj) group.add(anchorsExtra.stationObj);
  for (const o of anchorsExtra.propObjs || []) group.add(o);
  // dust haze over the collapses: soft billboards drifting slowly
  let dust = null;
  {
    const src = []; for (const s of spills) { const n = s.pile ? 3 : s.b && s.b.type === 'pancake' || s.heap ? 9 : 6; for (let k = 0; k < n * (LOW ? .5 : 1); k++) src.push([jf(s.bx0 + 3, s.bx1 - 3), jf(2, s.heap ? 12 : 8), jf(s.bz0 + 3, s.bz1 - 3), jf(9, 20), jf(.12, .26)]); }
    for (let k = 0; k < 10; k++) src.push([jf(X0, X1), jf(4, 14), jf(Z0, Z1), jf(18, 34), jf(.03, .06)]);
    for (const b of dmg) if (b.type === 'partial' || b.type === 'pancake') { const c = b.type === 'partial' ? xf(b.M, (b.uCut + b.W) / 2 + 3, 0, b.D / 2) : V(b.cx, 0, b.cz); for (const [y, sz, a] of [[5, 14, .16], [10, 19, .11], [16, 26, .07], [23, 32, .045]]) src.push([c.x + jf(-2, 2), y, c.z + jf(-2, 2), sz, a]); }
    const n = src.length, geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); geo.setIndex([0, 1, 2, 0, 2, 3]);
    const aD = new Float32Array(n * 4), aR = new Float32Array(n * 2); src.forEach((q, i) => { aD.set([q[0], q[1], q[2], q[3]], i * 4); aR.set([RJ(), q[4]], i * 2); });
    geo.setAttribute('aD', new THREE.InstancedBufferAttribute(aD, 4)); geo.setAttribute('aR', new THREE.InstancedBufferAttribute(aR, 2)); geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uCol: { value: cc('#E4D8DE').clone() } }]), transparent: true, depthWrite: false, fog: true,
      vertexShader: `#include <common>
        #include <fog_pars_vertex>
        attribute vec4 aD; attribute vec2 aR; uniform float uTime; varying vec2 vUv; varying float vA;
        void main() {
          vec3 c = aD.xyz + vec3(sin(uTime * .05 + aR.x * 6.283) * 2.2, sin(uTime * .04 + aR.x * 17.) * .6, cos(uTime * .037 + aR.x * 11.) * 2.2);
          vec4 mvPosition = modelViewMatrix * vec4(c, 1.0); mvPosition.xy += position.xy * aD.w;
          gl_Position = projectionMatrix * mvPosition; vUv = uv; vA = aR.y * (.75 + .25 * sin(uTime * .21 + aR.x * 20.));
          #include <fog_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <fog_pars_fragment>
        uniform vec3 uCol; varying vec2 vUv; varying float vA;
        void main() { float d = length(vUv - .5) * 2.; float a = pow(max(0., 1. - d), 2.2) * vA; gl_FragColor = vec4(uCol, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }` });
    dust = new THREE.Mesh(geo, mat); dust.frustumCulled = false; dust.renderOrder = 4; dust.name = 'dust'; group.add(dust);
  }

  // ================================================================ anchors, cameras, cutaway
  const pocketA = (() => {
    const P = byType('pancake'); if (!P) return null; const fl = P.floors[0], pk = fl.plan.pocket, L = fl.layer; if (!pk) return null;
    const cu = (pk.c0 + pk.c1 + 1) / 2 * CELL, cv = (pk.r0 + pk.r1 + 1) / 2 * CELL, c = xf(P.M, cu, SLAB + .3, cv), cells = [];
    for (let k = 0; k < L.nz; k++) for (let i = 0; i < L.nx; i++) { const x = L.x0 + (i + .5) * CELL, z = L.z0 + (k + .5) * CELL, loc = V(x, 0, z).applyMatrix4(P.M.clone().invert()), cc2 = Math.floor(loc.x / CELL), rr = Math.floor(loc.z / CELL); if (cc2 >= pk.c0 && cc2 <= pk.c1 && rr >= pk.r0 && rr <= pk.r1) cells.push(k * L.nx + i); }
    const w = (pk.c1 - pk.c0 + 1) * CELL, d = (pk.r1 - pk.r0 + 1) * CELL, h = .85 - SLAB - .05;
    return { pos: c, size: V(w, h, d), volume: +(w * d * h).toFixed(2), layer: L.id, building: P.id, cells, sealed: true };
  })();
  const portals = [];
  for (const b of dmg) { const fls = b.floors.filter((f) => f.kind === 'floor'); for (let k = 0; k + 1 < fls.length; k++) { const st = fls[k].plan.stair; if (!st || fls[k].plan.cells[st.r0 * fls[k].plan.nu + st.c0] === 2) continue; const u = (st.c0 + st.c1 + 1) / 2 * CELL, v = (st.r0 + st.r1 + 1) / 2 * CELL; portals.push({ a: fls[k].id, b: fls[k + 1].id, building: b.id, pos: xf(fls[k].FM, u, fls[k].yF + 1.2, v), posB: xf(fls[k + 1].FM, u, fls[k + 1].yF + 1.2, v) }); } }
  for (const b of dmg) {
    const all = [b.M, b.Mb, b.Mu].filter(Boolean); let r = { x0: 1e9, z0: 1e9, x1: -1e9, z1: -1e9 };
    for (const M of all) { const q = worldRect(M, 0, 0, b.W, b.D, [0, b.nF * H + 1]); r = { x0: Math.min(r.x0, q.x0), z0: Math.min(r.z0, q.z0), x1: Math.max(r.x1, q.x1), z1: Math.max(r.z1, q.z1) }; }
    b.cutRect = [r.x0 - 1.4, r.z0 - 1.4, r.x1 + 1.4, r.z1 + 1.4];
    b.topWorld = b.type === 'pancake' ? (b.topY || 3.1) : (b.roof ? xf(b.roof.FM, b.W / 2, b.roof.y + 1, b.D / 2).y : b.nF * H);
  }
  const center = V((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const stationPos = stationTop || V(VANP.x, 3.6, VANP.z);
  const hover = stationPos.clone().add(V(6, 30, 2));
  const pois = { 'the van': V(VANP.x, 1.4, VANP.z), 'the base': BASE.clone(), 'the square': V((PLAZA.x0 + PLAZA.x1) / 2, .12, MZ), 'the tether': hover.clone(), 'the park': V(lotX(0) + LX / 2, .15, lotZ(jp) + LZ / 2) };
  for (const b of dmg) pois[b.name] = V(b.cx, b.topWorld, b.cz);
  if (pocketA) pois['the pocket'] = pocketA.pos.clone();
  if (hazard.wire) pois['the live wire'] = V(hazard.wire.x, .3, hazard.wire.z);
  if (hazard.pool) pois['the water main'] = V(hazard.pool.x, .05, hazard.pool.z);
  if (E && E.panels) { const p = E.panels[1].rect; pois['the fallen facade'] = V((p.x0 + p.x1) / 2, .4, (p.z0 + p.z1) / 2); }
  const C0 = byType('partial'); if (C0) pois['the collapse'] = xf(C0.M, C0.uCut + 2, 4, C0.D / 2);
  const camera = {
    wide: { pos: center.clone().add(V(-108, 128, 140)), target: center.clone().add(V(-14, 0, 0)) },
    wide_phone: { pos: center.clone().add(V(-14, 0, 0)).add(V(-94, 128, 140).multiplyScalar(1.3)), target: center.clone().add(V(-14, 0, 0)) },
    wide_east: { pos: center.clone().add(V(150, 105, 120)), target: center.clone().add(V(10, 0, -4)) },
    top: { pos: center.clone().add(V(-22, 250, .5)), target: center.clone().add(V(-22, 0, 0)) },
    street: { pos: V(X0 - 2, 2.4, MZ + 2.2), target: V(roadX(2), 4, MZ - 1) },
    base: { pos: V(X0 - 34, 12, MZ + 24), target: V(X0 - 12, 1.5, MZ) },
    van: { pos: V(VANP.x - 9, 4.5, VANP.z + 9), target: V(VANP.x, 2, VANP.z) },
    tether: { pos: hover.clone().add(V(-22, 8, 26)), target: center.clone().add(V(10, 0, 0)) },
  };
  // camera hints around a block: try directions in order of preference and keep the first whose view is not blocked
  // by another building (the block itself is cut away for the inside views)
  const boxes = blds.map((b) => ({ b, x0: b.x0 - .5, z0: b.z0 - .5, x1: b.x1 + .5, z1: b.z1 + .5, y1: (b.type === 'standing' ? b.nF * H + 3 : b.topWorld || b.nF * H) + 1 }));
  const blocked = (from, to, self) => { for (let k = 1; k < 24; k++) { const t = k / 24, x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t; for (const q of boxes) if (q.b !== self && x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1 && y < q.y1) return true; } return false; };
  const ring = (pref) => { const out = [pref.clone().normalize()]; const a0 = Math.atan2(pref.z, pref.x); for (const d of [.5, -.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) out.push(V(Math.cos(a0 + d), 0, Math.sin(a0 + d))); return out; };
  const aim = (b, tgt, pref, dist, elev, extra = {}) => {
    for (const el of [elev, elev + .2, elev + .4]) for (const d of ring(pref)) { const pos = tgt.clone().addScaledVector(d, dist * Math.cos(el)).add(V(0, dist * Math.sin(el), 0)); if (!blocked(pos, tgt, b)) return { pos, target: tgt, ...extra }; }
    return { pos: tgt.clone().add(V(0, dist, .5)), target: tgt, ...extra };
  };
  const hintFor = (b, layerId, dist = 26, elev = .9) => {
    const L = layerById[layerId], tgt = V(b.cx, L ? L.y + .6 : b.topWorld * .5, b.cz);
    let dir = b.type === 'facade' ? frontDir(b) : b.type === 'partial' ? frontDir(b).add(uDir(b).multiplyScalar(.6)) : V(-.62, 0, .78);
    if (b.type === 'lean' || b.type === 'soft') { const f = frontDir(b); dir = f.dot(V(-.62, 0, .78)) > -.2 ? f.clone().add(V(-.62, 0, .78)) : V(-.62, 0, .78); }
    return aim(b, tgt, dir, dist, elev, { cut: { level: layerId, building: b.id } });
  };
  for (const b of dmg) {
    const fls = b.floors.filter((f) => f.kind === 'floor');
    const mid = b.type === 'pancake' || b.type === 'soft' ? b.floors[0] : fls[Math.min(fls.length - 1, 1)];
    camera['inside_' + b.id] = hintFor(b, mid.id);
    if (b.type === 'soft') camera['upper_' + b.id] = hintFor(b, fls[1].id);
    const f = b.type === 'facade' || b.type === 'lean' ? frontDir(b) : b.type === 'partial' ? uDir(b).add(frontDir(b).multiplyScalar(.5)) : V(-.62, 0, .78);
    camera['building_' + b.id] = aim(b, V(b.cx, b.topWorld * .4, b.cz), f, 32, .5);
  }
  if (pocketA) { const P = byType('pancake'); camera.pocket = aim(P, pocketA.pos.clone(), V(-.62, 0, .78), 19, .95, { cut: { level: P.id + '0', building: P.id } }); }
  if (C0) { const t = xf(C0.M, C0.uCut, 6.5, C0.D / 2); camera.collapse = aim(C0, t, uDir(C0).add(frontDir(C0).multiplyScalar(.55)), 26, .38); }
  if (E && E.panels) { const f = frontDir(E), t = pois['the fallen facade'].clone().add(V(0, 1, 0)); camera.facade = aim(null, t, uDir(E).add(f.clone().multiplyScalar(.45)), 26, .5); }
  if (hazard.wire) camera.wire = aim(null, pois['the live wire'].clone(), V(-.6, 0, .8), 16, .55);

  const anchors = {
    base: BASE.clone(),
    tether: { station: stationPos.clone(), hover, cable: Math.ceil(hover.distanceTo(stationPos) + 4) },
    ugvStart: V(VANP.x + 5, 0, VANP.z + 2.5),
    ugvRoutes: routes, ugvTargets: routeTargets,
    boats: [],
    people, decoys, pois, portals,
    pocket: pocketA,
    buildings: blds.map((b) => ({ id: b.id, name: b.name || null, type: b.type, center: V(b.cx, 0, b.cz), rect: [b.x0, b.z0, b.x1, b.z1], floors: b.nF, layers: b.floors.map((f) => f.id), park: b.park || null, cutRect: b.cutRect || null, top: b.topWorld || b.nF * H })),
    hazards: [hazard.wire && { kind: 'live wire', pos: pois['the live wire'] }, hazard.pool && { kind: 'water main', pos: pois['the water main'], r: hazard.pool.r }].filter(Boolean),
    rescuers: anchorsExtra.rescuers || [],
    lamps: anchorsExtra.lamps || [],
    dustSources: spills.filter((s) => !s.pile).map((s) => V((s.x0 + s.x1) / 2, 2, (s.z0 + s.z1) / 2)),
    aftershock: center.clone(),
  };

  let cutState = null;
  function cutaway(level, which) {
    let y = null, only = which;
    if (level === null || level === undefined || level === false || level === Infinity) y = null;
    else if (typeof level === 'string') { const L = layerById[level]; if (L && L.kind !== 'outdoor') { y = L.kind === 'void' ? L.y + .35 : L.y + 1.6; only = only || L.building; } }
    else if (typeof level === 'object' && level) { return cutaway(level.level, level.building); }
    else y = +level;
    const ids = only ? (Array.isArray(only) ? only : [only]) : dmg.map((b) => b.id);
    dmg.forEach((b, k) => {
      const on = y !== null && ids.includes(b.id);
      cutU.cutY.value[k] = on ? y : 1e5; const r = b.cutRect; cutU.cutR.value[k].set(r[0], r[1], r[2], r[3]);
      for (const fl of b.floors) if (fl.mesh) fl.mesh.visible = !(on && fl.layer.yMin > y - .05);
      if (b.topMesh) b.topMesh.visible = !(on && b.topY > y);
    });
    cutState = y === null ? null : { y, buildings: ids };
    return cutState;
  }
  cutaway(null);

  let tAcc = 0;
  function update(t, dt) {
    tAcc = t;
    if (dust) dust.material.uniforms.uTime.value = t;
    for (const e of emissive) if (e.kind === 'bar') { const on = (Math.floor(t * 1.6) + e.phase) % 2 === 0 ? 1 : .22; e.mesh.material.color.copy(e.base).multiplyScalar(on); if (e.glow) e.glow.material.opacity = .7 * on; }
    if (spark) { const f = Math.max(0, Math.sin(t * 23) * Math.sin(t * 7.3 + 1) * Math.sin(t * 2.1)); const k = f > .25 ? 1 : .15; spark.scale.setScalar(.6 + 1.2 * k * f); if (sparkGlow) { sparkGlow.material.opacity = .25 + .75 * k * f; sparkGlow.scale.setScalar(1.6 + 2.4 * k * f); } }
  }
  function dispose() {
    group.traverse((o) => {
      if (o.userData && o.userData.shared) return;
      if (o.geometry) o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) { if (m.map && m.map !== glowTex) m.map.dispose(); m.dispose(); }
    });
    depthCut.dispose(); if (glowTex) glowTex.dispose();
    group.clear();
  }

  // stats for the viewer / tests
  let tris = 0; group.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry, n = (g.index ? g.index.count : g.getAttribute('position').count) / 3; tris += n * (o.isInstancedMesh ? o.count : (g.isInstancedBufferGeometry ? g.instanceCount : 1)); } });
  const buildMs = (typeof performance !== 'undefined' ? performance : Date).now() - T_START;

  return {
    group,
    sky: { top: '#1F2352', horizon: '#7F7AB3', fog: '#7F7AB3', fogDensity: .0021, sun: { dir: V(-.7, .34, -.62).normalize(), color: '#FFC3AA', intensity: 1.65 }, hemi: { sky: '#9C98D4', ground: '#3A3566', intensity: .95 } },
    layers, surfaces, anchors,
    bounds: new THREE.Box3(V(PLAZA.x0, -1, Z0 - 2), V(X1 + 2, 20, Z1 + 2)),
    camera, cutaway, update, dispose,
    stats: { buildMs, tris: Math.round(tris), layers: layers.length, people: people.length, routes: routes.length, seed: SEED },
    get cut() { return cutState; },
  };
}

// LIMINAL · Act 4 · mission "cave": A flooded cave (after Tham Luang, Thailand, 2018). World builder.
//
// A block of karst mountain (840 x 516 m) shown as a museum cut-away model. The left end keeps its cliff, the cave
// mouth and a small staging area in the valley. Over the rest of the block the rock is removed down to a sculpted
// section surface that dips to about mid-height of every passage, so the whole branching cave (about 2 km of
// passage) is seen from the side and from above: an entrance hall, chambers, a dry upper bypass, dead ends, passages
// flooded to different levels, sumps where the roof dips under the water (cut in section they show solid water:
// divers only) and, deep inside, a high rock shelf in an air pocket where 13 people wait. Jungle and monsoon rain on
// top. cutaway(level) lowers a section plane from the summit (0: the mountain closed) to the sculpted section (1).
//
// How it is made: the cave is a signed-distance field (ellipsoids stamped along a jittered passage graph, flat
// sediment floors, rocky noise, bedding ridges) on a 2 m voxel grid, polygonised with surface nets. Near the mouth
// the same field also holds the terrain, so the portal is a real arch. The cave mesh is split at the section surface:
// the part below it is the overlay surface (layer 'cave'); the part above it (the roof) is drawn only while the
// mountain is (partly) closed. Water surfaces are contours of the field at each basin's level.
//
// Layer 'cave' is 2.5-D (plan view, 2 m cells, voxel columns): besides grid it carries per-cell heights floorY,
// ceilY, waterY (NaN when dry) and flyY (where a drone hovers), plus sump (1 = flooded to the roof). No two passages
// overlap in plan, so one layer is enough. Grid classes: 0 dry passage, 3 flooded with air above (fly over the
// water), 1 rock / too low / sump (anchors.sumps label them 'divers only'), 2 outside the search (air bells behind
// sumps, the valley); the apron in front of the mouth (where the base is) is 0. The floor runs from -17 to +27 m, so a
// simulator must take heights per cell (flyY) rather than the layer's single fly.
//
// World space: the model is built mirrored and group.scale.z = -1 puts it right (entrance on the left seen from the
// front, +z). Everything exported (layers, anchors, camera, bounds, helpers) is in world coordinates.
// Extras beyond the contract: objects { people (hidden), pocket (lavender outline, hidden), roof, section, water,
// rain, stalactites }, flyAt(x, z), floorAt(x, z), isAir(x, y, z), los(a, b) (radio line of sight through air),
// setWaterRise(dy) (the water-rise event: surfaces and solid-water sections move up), cutaway(level | { y }),
// camera hints carry cut (suggested cutaway level) and radius (what the shot must contain), sky.shadow (sun bias).
// The cut is done in shaders; the overlay surfaces (cave floor/walls below the section, water) are plain
// MeshStandardMaterials that are never cut, so the engine can patch them freely.
// Debug URL flags: cells=1 (every search cell at its height), lights=1 (lamps in the cave), bias=1 (shadow bias for
// bare viewers), people=1 (show the 13 people and the pocket outline), cut=<0..1>, log=1 (build stats).
export function buildWorld(THREE, { seed = 1, quality = 'high', props = null, debug = null } = {}) {
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const T0 = clock(), timing = {};
  const lap = (k) => { timing[k] = Math.round(clock() - T0); };
  const HI = quality !== 'low';
  let qs; try { qs = new URLSearchParams(globalThis.location ? globalThis.location.search : ''); } catch (e) { qs = new URLSearchParams(''); }
  const DBG = { cells: debug?.cells ?? qs.get('cells') === '1', bias: debug?.bias ?? (qs.get('bias') === '1' || qs.get('lights') === '1'), lights: debug?.lights ?? qs.get('lights') === '1', people: debug?.people ?? qs.get('people') === '1', log: debug?.log ?? qs.get('log') === '1' };
  const TAU = Math.PI * 2;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const COL = (h) => new THREE.Color(h);
  const lin = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rng = (s) => { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const hash = (x, y, z, s) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1442695041) + Math.imul(s, 2246822519)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  function vn2(x, z, s) {
    const ix = Math.floor(x), iz = Math.floor(z); let fx = x - ix, fz = z - iz; fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz, 0, s), b = hash(ix + 1, iz, 0, s), c = hash(ix, iz + 1, 0, s), d = hash(ix + 1, iz + 1, 0, s);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  function fbm2(x, z, s, o) { let t = 0, a = .5, n = 0; for (let i = 0; i < o; i++) { t += a * vn2(x, z, s + i * 131); n += a; a *= .5; x *= 2.03; z *= 2.03; } return t / n; }
  function vn3(x, y, z, s) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z); let fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iy, iz, s), b = hash(ix + 1, iy, iz, s), c = hash(ix, iy + 1, iz, s), d = hash(ix + 1, iy + 1, iz, s);
    const e = hash(ix, iy, iz + 1, s), f = hash(ix + 1, iy, iz + 1, s), g = hash(ix, iy + 1, iz + 1, s), h = hash(ix + 1, iy + 1, iz + 1, s);
    const x1 = a + (b - a) * fx, x2 = c + (d - c) * fx, x3 = e + (f - e) * fx, x4 = g + (h - g) * fx, y1 = x1 + (x2 - x1) * fy, y2 = x3 + (x4 - x3) * fy;
    return y1 + (y2 - y1) * fz;
  }
  const run = (f) => f();                                                  // hot loops live in their own small functions (so V8 optimises them)
  const sd = (k) => (seed * 977 + k * 131) & 0xffff;                       // a noise seed per purpose

  // ================================================================== 1. the cave plan (a template, jittered per seed)
  // nodes: x, z (plan), f floor, c ceiling, w size (chamber) or width, pw passage width at the node, ch chamber
  const R = rng(seed * 7717 + 3), rr = (a, b) => a + (b - a) * R();
  const N = {};
  const nd = (k, x, z, f, c, w, o = {}) => { const j = o.j || 0, ws = o.ch ? 1.15 : k.startsWith('E0') ? 1.1 : 1.35; N[k] = { k, x: x + (j ? rr(-j, j) : 0), z: z + (j ? rr(-j, j) : 0), f, c, w: w * ws, pw: (o.pw || Math.min(w, 14)) * (k.startsWith('E0') ? 1.1 : 1.35), ch: !!o.ch, deg: 0 }; };
  nd('E0o', -346, -16, .4, 14, 24, { pw: 24 });                            // outside the cliff: the terrain cuts the tube
  nd('E0', -318, -14, .6, 15, 22, { pw: 22 });                              // the portal
  nd('E1', -262, -6, 0, 17, 36, { ch: true, pw: 16 });                      // entrance hall
  nd('A', -186, 16, .8, 10, 16, { j: 5 });                                  // junction 1
  nd('AB', -132, -8, -5.5, 4.5, 12, { j: 6 });                              // a dip: the first water
  nd('B', -74, -26, .6, 9, 16, { j: 5 });                                   // junction 2
  nd('BC', -18, -10, -.2, 8, 12, { j: 6 });
  nd('C', 50, 10, .2, 19, 46, { ch: true, pw: 14, j: 4 });                  // chamber 3, junction 3
  nd('CD', 106, -6, -.6, 9, 12, { j: 6 });
  nd('D', 156, -16, -1.6, 10, 18, { j: 4 });                                // junction 4
  nd('F1', 206, -56, -14, -5.4, 12, { j: 5 });                              // the flooded trunk (sumps)
  nd('F2', 272, -48, -17, -8, 12, { j: 6 });
  nd('F3', 326, -62, -13, -5.6, 12, { j: 4 });
  nd('S1', 362, -30, -11, 13, 48, { ch: true, pw: 12 });                    // the last chamber: the shelf, the air pocket
  nd('P1', 176, 60, 4, 12, 11, { j: 6 });                                   // the dry bypass
  nd('P2', 244, 90, 9.5, 21, 26, { ch: true, pw: 12, j: 5 });               // junction 5 (upper chamber)
  nd('P3', 314, 68, 6, 15, 13, { j: 5 });                                   // junction 6
  nd('P4', 350, 18, -8, -.5, 10);                                           // the low passage: a few metres of air
  nd('A1', -160, 82, 3, 11, 10, { j: 8 });
  nd('A2', -182, 136, 4, 18, 28, { ch: true, pw: 10, j: 8 });               // dry dead end
  nd('B1', -44, -92, -7, 3, 10, { j: 6 });
  nd('B2', -74, -150, -12, -6, 9, { j: 6 });                                // ends in a sump
  nd('C1', 82, 78, 2.5, 10, 10, { j: 8 });
  nd('C2', 54, 140, 3, 15, 26, { ch: true, pw: 10, j: 8 });                 // dry dead end
  nd('K1', 34, -66, 1.5, 9, 9, { j: 6 });
  nd('K2', 70, -116, 2.5, 13, 22, { ch: true, pw: 9, j: 6 });                // dry dead end (the south gallery)
  nd('Q1', 262, 152, 14, 22, 9, { j: 6 });
  nd('Q2', 230, 190, 15, 27, 24, { ch: true, pw: 9, j: 6 });                // dry dead end (high)
  nd('R1', 362, 112, 7, 13, 8, { j: 6 });                                   // a choke
  const EDGES = [['E0o', 'E0'], ['E0', 'E1'], ['E1', 'A'], ['A', 'AB'], ['AB', 'B'], ['B', 'BC'], ['BC', 'C'], ['C', 'CD'], ['CD', 'D'],
    ['D', 'F1'], ['F1', 'F2'], ['F2', 'F3'], ['F3', 'S1'], ['D', 'P1'], ['P1', 'P2'], ['P2', 'P3'], ['P3', 'P4'], ['P4', 'S1'],
    ['A', 'A1'], ['A1', 'A2'], ['B', 'B1'], ['B1', 'B2'], ['C', 'C1'], ['C1', 'C2'], ['C', 'K1'], ['K1', 'K2'], ['P2', 'Q1'], ['Q1', 'Q2'], ['P3', 'R1']];
  for (const [a, b] of EDGES) { N[a].deg++; N[b].deg++; }
  // samples: ellipsoids along every passage (kind 0), chambers and their lumps (1), pools (2)
  const SX = [], SY = [], SZ = [], SR = [], SU = [], SDN = [], SF = [], SC = [], SG = [], SK = [];
  const addS = (x, z, f, c, r, seg, kind, yc) => { const y = yc ?? f + .42 * (c - f); SX.push(x); SZ.push(z); SY.push(y); SR.push(r); SU.push(Math.max(1, c - y)); SDN.push(y - f + 2); SF.push(f); SC.push(c); SG.push(seg); SK.push(kind); };
  const segs = [];
  EDGES.forEach(([a, b], si) => {
    const A = N[a], B = N[b], ca = A.ch ? Math.min(A.c, A.f + 10) : A.c, cb = B.ch ? Math.min(B.c, B.f + 10) : B.c;
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz), n = Math.max(3, Math.ceil(L / 2.4)), px = -dz / L, pz = dx / L;
    const amp = a.startsWith('E0') ? 0 : Math.min(L * .2, 15), i0 = SX.length;
    let len = 0, lx = A.x, ly = A.f, lz = A.z;
    for (let k = 0; k <= n; k++) {
      const t = k / n, st = sstep(0, 1, t), w = (fbm2(si * 3.7 + t * L / 55, 1.3, sd(1), 2) - .5) * 2 * amp * Math.sin(Math.PI * t);
      const x = A.x + dx * t + px * w, z = A.z + dz * t + pz * w, f = lerp(A.f, B.f, st);
      const c = lerp(ca, cb, st) + (fbm2(t * L / 30, si * 1.7, sd(2), 2) - .5) * 2.4 * Math.sin(Math.PI * t) * sstep(7, 11, lerp(ca, cb, st) - f);
      const r = lerp(A.pw, B.pw, st) / 2 * (.86 + .28 * fbm2(x / 40, z / 40, sd(3), 2));
      addS(x, z, f, c, r, si, 0);
      if (k) len += Math.hypot(x - lx, f - ly, z - lz);
      lx = x; ly = f; lz = z;
    }
    segs.push({ a, b, i0, i1: SX.length, len, name: '' });
  });
  for (const k in N) {
    const n = N[k]; if (!n.ch) continue;
    addS(n.x, n.z, n.f, n.c, n.w / 2, -1, 1);
    for (let m = 0; m < 5; m++) { const a = rr(0, TAU), q = n.w * rr(.16, .3); addS(n.x + Math.cos(a) * q, n.z + Math.sin(a) * q, n.f + rr(-.2, .8), n.f + (n.c - n.f) * rr(.55, .85), n.w / 2 * rr(.42, .6), -1, 1); }
  }
  const POOLS = [{ k: 'E1', dx: -4, dz: 5, r: 9, f: -1.3, level: -.3, name: 'the entrance pool' }, { k: 'P2', dx: 6, dz: 6, r: 7, f: 7.4, level: 9, name: 'the upper pool' }];
  for (const p of POOLS) { p.x = N[p.k].x + p.dx; p.z = N[p.k].z + p.dz; addS(p.x, p.z, p.f, p.level + 1.6, p.r, -1, 2, p.level - .2); }
  const NS = SX.length;
  // the shelf: a block of rock on the far side of the last chamber, standing 6 m out of the water
  const S1 = N.S1, SH = { x: S1.x + S1.w / 2 - 9, z: S1.z + 2, bx: 11, bz: 11.5, top: 1.5, bot: -17, rad: 2.6 };

  // ================================================================== 2. the mountain surface
  const BX0 = -420, BZ0 = -205, TC = 4, TNX = 211, TNZ = 130, BX1 = BX0 + (TNX - 1) * TC, BZ1 = BZ0 + (TNZ - 1) * TC, BOT = -44;
  const cliffX = (z) => -326 + 7 * (fbm2(z * .013, 3.7, sd(22), 2) - .5) * 2 - 9 * Math.exp(-(((z - N.E0.z) / 34) ** 2));
  const STREAM = [[-322, -12], [-336, -2], [-352, 8], [-374, 16], [-398, 21], [-426, 28]];
  const TRACK = [[-414, -209], [-404, -150], [-392, -104], [-380, -70], [-368, -46]];
  const segDist = (x, z, P) => { if (!P.bb) { P.bb = [1e9, 1e9, -1e9, -1e9]; for (const [px, pz] of P) { P.bb[0] = Math.min(P.bb[0], px - 14); P.bb[1] = Math.min(P.bb[1], pz - 14); P.bb[2] = Math.max(P.bb[2], px + 14); P.bb[3] = Math.max(P.bb[3], pz + 14); } } if (x < P.bb[0] || z < P.bb[1] || x > P.bb[2] || z > P.bb[3]) return 1e9; let best = 1e9; for (let i = 0; i < P.length - 1; i++) { const [ax, az] = P[i], [bx, bz] = P[i + 1], dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1), q = Math.hypot(x - ax - dx * t, z - az - dz * t); if (q < best) best = q; } return best; };
  const CAMP = { x: N.E0.x - 46, z: N.E0.z - 30 };
  const TOWERS = [];
  { const RT = rng(seed * 313 + 9); let tries = 0;
    while (TOWERS.length < 19 && tries++ < 500) {
      const x = -250 + RT() * 660, z = -175 + RT() * 480, back = sstep(-40, 240, z), r = 30 + RT() * 36 + back * 14, hh = 24 + RT() * 30 + back * (28 + RT() * 42);
      if (TOWERS.some((t) => Math.hypot(t.x - x, t.z - z) < (t.r + r) * .6)) continue;
      TOWERS.push({ x, z, r, h: hh, r2: r * r * 1.45, s: RT() * 99 });
    } }
  function Hf(x, z) {
    const d = x - cliffX(z), ds = segDist(x, z, STREAM);
    let hv = .3 + .7 * (fbm2(x * .035, z * .035, sd(23), 2) - .5) - 1.1 * Math.exp(-((ds / 4) ** 2));
    hv = lerp(hv, .35, sstep(40, 24, Math.hypot(x - CAMP.x, z - CAMP.z)));
    hv += 3.4 * sstep(-18, 0, d) * (.55 + .45 * vn2(z * .09, x * .05, sd(24))) * (1 - Math.exp(-((ds / 7) ** 2)));
    if (d < -18) return hv;
    const plat = 33 + 8 * (fbm2(x * .02, z * .02, sd(25), 3) - .5) * 2;
    let hgt = lerp(hv, plat, sstep(-1.5, 6, d));
    const m = sstep(16, 160, d);
    if (m <= 0) return hgt;
    hgt += m * (18 + 24 * fbm2(x * .007, z * .007, sd(26), 3));
    for (const t of TOWERS) { const dx = x - t.x, dz = z - t.z, q = dx * dx + dz * dz; if (q > t.r2) continue; const dd = Math.sqrt(q) / t.r * (.85 + .3 * vn2(dx * .05 + t.s, dz * .05, sd(27))); if (dd < 1) hgt += t.h * Math.pow(sstep(1, 0, dd), .5) * m; }
    return hgt;
  }
  const TH = new Float32Array(TNX * TNZ);
  run(() => { for (let k = 0; k < TNZ; k++) for (let i = 0; i < TNX; i++) TH[k * TNX + i] = Hf(BX0 + i * TC, BZ0 + k * TC); });
  const TNRM = new Float32Array(TNX * TNZ * 3);
  run(() => { for (let k = 0; k < TNZ; k++) for (let i = 0; i < TNX; i++) {
    const a = TH[k * TNX + Math.max(0, i - 1)], b = TH[k * TNX + Math.min(TNX - 1, i + 1)], c = TH[Math.max(0, k - 1) * TNX + i], d = TH[Math.min(TNZ - 1, k + 1) * TNX + i];
    let nx = -(b - a) / ((Math.min(TNX - 1, i + 1) - Math.max(0, i - 1)) * TC), nz = -(d - c) / ((Math.min(TNZ - 1, k + 1) - Math.max(0, k - 1)) * TC), l = Math.hypot(nx, 1, nz);
    TNRM[(k * TNX + i) * 3] = nx / l; TNRM[(k * TNX + i) * 3 + 1] = 1 / l; TNRM[(k * TNX + i) * 3 + 2] = nz / l;
  } });
  const thAt = (x, z) => { const u = clamp((x - BX0) / TC, 0, TNX - 1.0001), v = clamp((z - BZ0) / TC, 0, TNZ - 1.0001), i = u | 0, k = v | 0, fu = u - i, fv = v - k, o = k * TNX + i;
    return (TH[o] * (1 - fu) + TH[o + 1] * fu) * (1 - fv) + (TH[o + TNX] * (1 - fu) + TH[o + TNX + 1] * fu) * fv; };
  const tnAt = (x, z, out) => { const u = clamp((x - BX0) / TC, 0, TNX - 1.0001), v = clamp((z - BZ0) / TC, 0, TNZ - 1.0001), i = u | 0, k = v | 0, fu = u - i, fv = v - k;
    let nx = 0, ny = 0, nz = 0; const W = [(1 - fu) * (1 - fv), fu * (1 - fv), (1 - fu) * fv, fu * fv], O = [k * TNX + i, k * TNX + i + 1, (k + 1) * TNX + i, (k + 1) * TNX + i + 1];
    for (let q = 0; q < 4; q++) { nx += TNRM[O[q] * 3] * W[q]; ny += TNRM[O[q] * 3 + 1] * W[q]; nz += TNRM[O[q] * 3 + 2] * W[q]; }
    const l = Math.hypot(nx, ny, nz) || 1; out[0] = nx / l; out[1] = ny / l; out[2] = nz / l; return out; };
  lap('terrain');

  // ================================================================== 3. the signed-distance field (void < 0 < rock)
  const VX = 2, GY0 = -26, GNY = 38, GTOP = GY0 + (GNY - 1) * VX;
  let xmn = 1e9, xmx = -1e9, zmn = 1e9, zmx = -1e9;
  for (let s = 0; s < NS; s++) { xmn = Math.min(xmn, SX[s] - SR[s]); xmx = Math.max(xmx, SX[s] + SR[s]); zmn = Math.min(zmn, SZ[s] - SR[s]); zmx = Math.max(zmx, SZ[s] + SR[s]); }
  const LX0 = Math.min(-382, Math.floor((xmn - 10) / VX) * VX), LX1 = Math.min(BX1 - 6, Math.ceil((xmx + 10) / VX) * VX);
  const LZ0 = Math.max(BZ0 + 6, Math.floor((zmn - 10) / VX) * VX), LZ1 = Math.min(BZ1 - 6, Math.ceil((zmx + 10) / VX) * VX);
  const GNX = (LX1 - LX0) / VX, GNZ = (LZ1 - LZ0) / VX, GX0 = LX0 + VX / 2, GZ0 = LZ0 + VX / 2, SYS = GNX, SZS = GNX * GNY, NT = GNX * GNY * GNZ;
  const G = new Float32Array(NT).fill(6), SID = new Int16Array(NT).fill(-1);
  run(() => { for (let s = 0; s < NS; s++) {
    const x = SX[s], y = SY[s], z = SZ[s], r = SR[s], up = SU[s], dn = SDN[s], fl = SF[s], M = 4.5, ir = 1 / r;
    const i0 = Math.max(0, Math.floor((x - r - M - GX0) / VX)), i1 = Math.min(GNX - 1, Math.ceil((x + r + M - GX0) / VX));
    const j0 = Math.max(0, Math.floor((fl - 1.6 - GY0) / VX)), j1 = Math.min(GNY - 1, Math.ceil((y + up + M - GY0) / VX));
    const k0 = Math.max(0, Math.floor((z - r - M - GZ0) / VX)), k1 = Math.min(GNZ - 1, Math.ceil((z + r + M - GZ0) / VX));
    for (let k = k0; k <= k1; k++) {
      const pz = (GZ0 + k * VX - z) * ir;
      for (let j = j0; j <= j1; j++) {
        const wy = GY0 + j * VX, dy = wy - y, ry = dy > 0 ? up : dn, py = dy / ry, fy = fl - wy, iry2 = 1 / (ry * ry);
        let idx = i0 + j * SYS + k * SZS;
        for (let i = i0; i <= i1; i++, idx++) {
          const px = (GX0 + i * VX - x) * ir, hz = px * px + pz * pz, k0v = Math.sqrt(hz + py * py), k1v = Math.sqrt(hz * ir * ir + py * py * iry2);
          let d = k1v > 1e-6 ? k0v * (k0v - 1) / k1v : -Math.min(r, ry);
          const hh = Math.max(1.2 - Math.abs(d - fy), 0) / 1.2; d = Math.max(d, fy) + hh * hh * .3;
          if (d < G[idx]) { G[idx] = d; SID[idx] = s; }
        }
      }
    }
  } });
  run(() => { // the shelf: subtract a rounded block of rock from the chamber
    const yc = (SH.top + SH.bot) / 2, hy = (SH.top - SH.bot) / 2, M = 4;
    const i0 = Math.max(0, Math.floor((SH.x - SH.bx - M - GX0) / VX)), i1 = Math.min(GNX - 1, Math.ceil((SH.x + SH.bx + M - GX0) / VX));
    const j0 = Math.max(0, Math.floor((SH.bot - M - GY0) / VX)), j1 = Math.min(GNY - 1, Math.ceil((SH.top + M - GY0) / VX));
    const k0 = Math.max(0, Math.floor((SH.z - SH.bz - M - GZ0) / VX)), k1 = Math.min(GNZ - 1, Math.ceil((SH.z + SH.bz + M - GZ0) / VX));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = GX0 + i * VX, y = GY0 + j * VX, z = GZ0 + k * VX;
      const qx = Math.abs(x - SH.x) - SH.bx + SH.rad, qy = Math.abs(y - yc) - hy + SH.rad, qz = Math.abs(z - SH.z) - SH.bz + SH.rad;
      const dr = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - SH.rad;
      const idx = i + j * SYS + k * SZS, a = G[idx], b = -dr, hh = Math.max(1.5 - Math.abs(a - b), 0) / 1.5;
      G[idx] = Math.max(a, b) + hh * hh * .375;
    }
  });
  // rock texture: two scales of lumps, bedding ridges; quieter on floors and in low passages
  run(() => { for (let idx = 0; idx < NT; idx++) {
    const g = G[idx]; if (g > 3.6 || g < -3.6) continue;
    const i = idx % GNX, j = ((idx / GNX) | 0) % GNY, k = (idx / SZS) | 0, x = GX0 + i * VX, y = GY0 + j * VX, z = GZ0 + k * VX, s = SID[idx];
    const fl = s >= 0 ? SF[s] : -99, ht = s >= 0 ? SC[s] - SF[s] : 10, kind = s >= 0 ? SK[s] : 0;
    let d = (vn3(x * .1, y * .14, z * .1, sd(4)) * .66 + vn3(x * .2, y * .28, z * .2, sd(5)) * .34 - .5) * 3.2 + (vn3(x * .34, y * .42, z * .34, sd(6)) - .5) * 1.1 + .32 * Math.sin(y * 1.9 + 3 * vn3(x * .05, y * .06, z * .05, sd(7)));
    d *= clamp(ht / 12, .45, 1) * (kind === 2 ? .3 : 1) * (.35 + .65 * sstep(.3, 3.2, y - fl));
    G[idx] = g + d;
  } });
  // the terrain: air above the mountain surface wherever the surface dips into the grid (the valley, the cliff, the mouth)
  const HC = new Float32Array(GNX * GNZ);
  run(() => { for (let k = 0; k < GNZ; k++) for (let i = 0; i < GNX; i++) {
    const x = GX0 + i * VX, z = GZ0 + k * VX, est = thAt(x, z);
    const H = est > GTOP + 16 ? est : Hf(x, z); HC[k * GNX + i] = H;
    if (H > GTOP + 6) continue;
    for (let j = 0; j < GNY; j++) { const v = H - (GY0 + j * VX); if (v >= 6) continue; const idx = i + j * SYS + k * SZS; if (v < G[idx]) G[idx] = v; }
  } });
  const hcAt = (x, z) => { const u = clamp((x - GX0) / VX, 0, GNX - 1.0001), v = clamp((z - GZ0) / VX, 0, GNZ - 1.0001), i = u | 0, k = v | 0, fu = u - i, fv = v - k, o = k * GNX + i;
    return (HC[o] * (1 - fu) + HC[o + 1] * fu) * (1 - fv) + (HC[o + GNX] * (1 - fu) + HC[o + GNX + 1] * fu) * fv; };
  const gAt = (x, y, z) => {
    const fx = clamp((x - GX0) / VX, 0, GNX - 1.0001), fy = clamp((y - GY0) / VX, 0, GNY - 1.0001), fz = clamp((z - GZ0) / VX, 0, GNZ - 1.0001);
    const i = fx | 0, j = fy | 0, k = fz | 0, tx = fx - i, ty = fy - j, tz = fz - k, o = i + j * SYS + k * SZS;
    const c00 = G[o] + (G[o + 1] - G[o]) * tx, c10 = G[o + SYS] + (G[o + SYS + 1] - G[o + SYS]) * tx, c01 = G[o + SZS] + (G[o + SZS + 1] - G[o + SZS]) * tx, c11 = G[o + SYS + SZS] + (G[o + SYS + SZS + 1] - G[o + SYS + SZS]) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty; return c0 + (c1 - c0) * tz;
  };
  const vIdx = (x, y, z) => { const i = Math.round((x - GX0) / VX), j = Math.round((y - GY0) / VX), k = Math.round((z - GZ0) / VX); return i < 0 || j < 0 || k < 0 || i >= GNX || j >= GNY || k >= GNZ ? -1 : i + j * SYS + k * SZS; };
  lap('sdf');

  // ================================================================== 4. water: one level per basin (flood fill below it)
  const BAS = new Uint8Array(NT);
  const basins = [
    { name: POOLS[0].name, x: POOLS[0].x, z: POOLS[0].z, level: POOLS[0].level },
    { name: 'the first dip', x: N.AB.x, z: N.AB.z, level: -2 },
    { name: 'the front branch', x: N.B1.x, z: N.B1.z, level: -3.5 },
    { name: 'the deep water', x: N.F2.x, z: N.F2.z, level: -4.5 },
    { name: POOLS[1].name, x: POOLS[1].x, z: POOLS[1].z, level: POOLS[1].level },
  ];
  basins.forEach((B, bi) => {
    B.id = bi + 1; B.voxels = 0; B.i0 = 1e9; B.i1 = -1; B.k0 = 1e9; B.k1 = -1;
    const ci = Math.round((B.x - GX0) / VX), ck = Math.round((B.z - GZ0) / VX); let seedI = -1;
    for (let rad = 0; rad < 6 && seedI < 0; rad++) for (let dk = -rad; dk <= rad && seedI < 0; dk++) for (let di = -rad; di <= rad && seedI < 0; di++) {
      const i = ci + di, k = ck + dk; if (i < 0 || k < 0 || i >= GNX || k >= GNZ) continue;
      for (let j = 0; j < GNY && GY0 + j * VX < B.level; j++) { const idx = i + j * SYS + k * SZS; if (G[idx] < 0 && !BAS[idx]) { seedI = idx; break; } }
    }
    if (seedI < 0) return;
    const q = [seedI]; BAS[seedI] = B.id;
    for (let h = 0; h < q.length; h++) {
      const idx = q[h], i = idx % GNX, j = ((idx / GNX) | 0) % GNY, k = (idx / SZS) | 0;
      B.voxels++; if (i < B.i0) B.i0 = i; if (i > B.i1) B.i1 = i; if (k < B.k0) B.k0 = k; if (k > B.k1) B.k1 = k;
      const nb = [i > 0 ? idx - 1 : -1, i < GNX - 1 ? idx + 1 : -1, j > 0 ? idx - SYS : -1, j < GNY - 1 && GY0 + (j + 1) * VX < B.level ? idx + SYS : -1, k > 0 ? idx - SZS : -1, k < GNZ - 1 ? idx + SZS : -1];
      for (const n of nb) if (n >= 0 && !BAS[n] && G[n] < 0) { BAS[n] = B.id; q.push(n); }
    }
    if (B.voxels > 250000) console.warn('[cave] basin leak', B.name, B.voxels);
  });
  lap('water');

  // ================================================================== 5. the 2.5-D search layer (voxel columns)
  const LNX = GNX, LNZ = GNZ, LN = LNX * LNZ;
  const LG = new Uint8Array(LN).fill(1), FLO = new Float32Array(LN).fill(NaN), CEI = new Float32Array(LN).fill(NaN), WAT = new Float32Array(LN).fill(NaN), FLY = new Float32Array(LN).fill(NaN);
  const SUMP = new Uint8Array(LN), LBAS = new Uint8Array(LN), LSID = new Int16Array(LN).fill(-1);
  const portalX = cliffX(N.E0.z);
  run(() => { for (let k = 0; k < LNZ; k++) for (let i = 0; i < LNX; i++) {
    const c = k * LNX + i; let bAir = -1e9, bYb = 0, bYt = 0, bBid = 0, bMid = 0, sky = false, sYb = 0;
    for (let j = 0; j < GNY;) {
      if (G[i + j * SYS + k * SZS] >= 0) { j++; continue; }
      const j0 = j; while (j < GNY && G[i + j * SYS + k * SZS] < 0) j++;
      const j1 = j - 1, ia = i + j0 * SYS + k * SZS, ib = i + j1 * SYS + k * SZS;
      const yb = j0 > 0 ? GY0 + (j0 - 1) * VX + VX * G[ia - SYS] / (G[ia - SYS] - G[ia]) : GY0 - VX;
      const yt = j1 < GNY - 1 ? GY0 + j1 * VX + VX * G[ib] / (G[ib] - G[ib + SYS]) : 1e3;
      if (yt > 900) { sky = true; sYb = yb; continue; }
      let bid = 0; for (let jj = j0; jj <= j1 && !bid; jj++) bid = BAS[i + jj * SYS + k * SZS];
      const air = yt - (bid ? Math.max(yb, basins[bid - 1].level) : yb);
      if (air > bAir) { bAir = air; bYb = yb; bYt = yt; bBid = bid; bMid = i + ((j0 + j1) >> 1) * SYS + k * SZS; }
    }
    if (bAir === -1e9) {
      if (!sky) continue;
      const x = GX0 + i * VX, z = GZ0 + k * VX, dm = Math.hypot(x - (portalX - 10), (z - N.E0.z) * 1.15);
      FLO[c] = sYb; CEI[c] = sYb + 16; FLY[c] = sYb + 4; LG[c] = dm < 30 && x < portalX + 4 ? 0 : 2;
      continue;
    }
    const wl = bBid ? basins[bBid - 1].level : NaN, base = bBid ? Math.max(bYb, wl) : bYb;
    FLO[c] = bYb; CEI[c] = bYt; LSID[c] = SID[bMid];
    if (bBid) { WAT[c] = wl; LBAS[c] = bBid; }
    FLY[c] = base + clamp(.45 * bAir, .8, 3.6);
    if (bAir < 1.2) { LG[c] = 1; if (bBid) SUMP[c] = 1; } else LG[c] = bBid ? 3 : 0;
  } });
  // a passage next to another one at a different height (no way through in 3-D): block the lower cell
  let steps = 0;
  run(() => { for (let k = 0; k < LNZ; k++) for (let i = 0; i < LNX - 1; i++) for (let dd = 0; dd < 2; dd++) {
    const di = 1 - dd, dk = dd; if (k + dk >= LNZ) continue; const a = k * LNX + i, b = (k + dk) * LNX + i + di;
    if ((LG[a] !== 0 && LG[a] !== 3) || (LG[b] !== 0 && LG[b] !== 3)) continue;
    const lo = Math.max(Math.max(FLO[a], WAT[a] || -1e9), Math.max(FLO[b], WAT[b] || -1e9)), hi = Math.min(CEI[a], CEI[b]);
    if (hi - lo < 1) { LG[FLY[a] < FLY[b] ? a : b] = 1; steps++; }
  } });
  // base: on the apron in front of the mouth
  const cellOf = (x, z) => { const i = Math.floor((x - LX0) / VX), k = Math.floor((z - LZ0) / VX); return i < 0 || k < 0 || i >= LNX || k >= LNZ ? -1 : k * LNX + i; };
  const nearestOpen = (x, z, ok = (c) => LG[c] === 0) => { const c0 = cellOf(x, z); if (c0 >= 0 && ok(c0)) return c0; let best = -1, bd = 1e18; for (let c = 0; c < LN; c++) { if (!ok(c)) continue; const d = (LX0 + ((c % LNX) + .5) * VX - x) ** 2 + (LZ0 + (((c / LNX) | 0) + .5) * VX - z) ** 2; if (d < bd) { bd = d; best = c; } } return best; };
  const cX = (c) => LX0 + ((c % LNX) + .5) * VX, cZ = (c) => LZ0 + (((c / LNX) | 0) + .5) * VX;
  const baseCell = nearestOpen(portalX - 22, N.E0.z + 2);
  // reachability from the base: open cells nobody can reach by air (air bells behind sumps) are not part of the search
  const REACH = new Uint8Array(LN), bq = [baseCell]; REACH[baseCell] = 1;
  run(() => { for (let h = 0; h < bq.length; h++) { const c = bq[h], i = c % LNX; for (const n of [i > 0 ? c - 1 : -1, i < LNX - 1 ? c + 1 : -1, c - LNX, c + LNX]) if (n >= 0 && n < LN && !REACH[n] && (LG[n] === 0 || LG[n] === 3)) { REACH[n] = 1; bq.push(n); } } });
  let unreach = 0;
  run(() => { for (let c = 0; c < LN; c++) if ((LG[c] === 0 || LG[c] === 3) && !REACH[c]) { LG[c] = 2; unreach++; } });
  // the cave layer
  let flySum = 0, flyN = 0; for (let c = 0; c < LN; c++) if (LG[c] === 0 || LG[c] === 3) { flySum += FLY[c]; flyN++; }
  const caveLayer = {
    id: 'cave', name: 'the cave', kind: '2.5d', outdoor: false, y: 0, band: [-20, 30], fly: flyN ? flySum / flyN : 3, cell: VX, x0: LX0, z0: LZ0, nx: LNX, nz: LNZ, grid: LG,
    floorY: FLO, ceilY: CEI, waterY: WAT, flyY: FLY, sump: SUMP,
  };
  const flyAt = (x, z) => { const c = cellOf(x, z); return c >= 0 && Number.isFinite(FLY[c]) ? FLY[c] : thAt(x, z) + 3; };
  lap('layer');

  // ================================================================== 6. the section surface (where the mountain is cut)
  const RNX = 210, RNZ = 129, RC = 4, WX0 = -276, WZ1 = 272, WZB = 62;
  const winF = (x, z) => sstep(WX0, WX0 + 14, x) * clamp((WZ1 - z) / WZB, 0, 1);
  const terrace = (t) => { const q = t * 3, i = Math.min(2, Math.floor(q)), f = q - i; return (i + sstep(.45, .9, f)) / 3; };
  const SCUT = new Float32Array(NS), SSIG = new Float32Array(NS).fill(1 / 256);
  for (let s = 0; s < NS; s++) {
    const vi = vIdx(SX[s], SF[s] + .8, SZ[s]), b = vi >= 0 ? BAS[vi] : 0, wl = b ? basins[b - 1].level : -1e9, base = Math.max(SF[s], wl), air = SC[s] - base;
    SCUT[s] = Math.min(b && air < 1.6 ? SF[s] + .5 * (SC[s] - SF[s]) : base + (SK[s] === 1 ? .5 : .55) * air, SC[s] - 1.2);
    if (b && air < 1.6) SSIG[s] = 1 / 64;
  }
  const BK = 30, BKNX = Math.ceil((BX1 - BX0) / BK) + 1, BKNZ = Math.ceil((BZ1 - BZ0) / BK) + 1, buckets = Array.from({ length: BKNX * BKNZ }, () => []);
  for (let s = 0; s < NS; s++) if (SK[s] !== 2) { const bi = clamp(Math.floor((SX[s] - BX0) / BK), 0, BKNX - 1), bk = clamp(Math.floor((SZ[s] - BZ0) / BK), 0, BKNZ - 1); buckets[bk * BKNX + bi].push(s); }
  const REL = new Float32Array(RNX * RNZ), REL16 = new Uint16Array(RNX * RNZ);
  let relMin = 1e9, relHi = [];
  run(() => { for (let k = 0; k < RNZ; k++) for (let i = 0; i < RNX; i++) {
    const x = BX0 + (i + .5) * RC, z = BZ0 + (k + .5) * RC, wf = winF(x, z), o = k * RNX + i;
    if (wf <= 0) { REL[o] = 1000; continue; }
    let sw = 1e-4, sc = 6e-4, dmin = 1e9;
    const bi = Math.floor((x - BX0) / BK), bk = Math.floor((z - BZ0) / BK);
    for (let qk = bk - 2; qk <= bk + 2; qk++) for (let qi = bi - 2; qi <= bi + 2; qi++) {
      if (qi < 0 || qk < 0 || qi >= BKNX || qk >= BKNZ) continue;
      for (const s of buckets[qk * BKNX + qi]) { const ex = x - SX[s], ez = z - SZ[s], d2 = ex * ex + ez * ez; if (d2 > 3600) continue; const d = Math.sqrt(d2); const de = Math.max(0, d - SR[s] * .8), w = Math.exp(-(de * de) * SSIG[s]); sw += w; sc += w * SCUT[s]; if (d - SR[s] < dmin) dmin = d - SR[s]; }
    }
    let rel = sc / sw + 4.5 * sstep(3, 34, dmin) + 1.6 * (fbm2(x * .04, z * .04, sd(31), 2) - .5) * sstep(4, 18, dmin);
    if (wf < 1) rel = lerp(rel, thAt(x, z) + 12, terrace(1 - wf));
    REL[o] = rel; if (rel < relMin) relMin = rel; if (wf >= 1) relHi.push(rel);
  } });
  run(() => { for (let o = 0; o < REL.length; o++) { REL16[o] = THREE.DataUtils.toHalfFloat(REL[o]); REL[o] = THREE.DataUtils.fromHalfFloat(REL16[o]); } });
  relHi.sort((a, b) => a - b); const REL_HI = relHi.length ? relHi[Math.floor(relHi.length * .97)] + 2 : 30; relHi = null;
  const relAt = (x, z) => { const u = clamp((x - BX0) / RC - .5, 0, RNX - 1.0001), v = clamp((z - BZ0) / RC - .5, 0, RNZ - 1.0001), i = u | 0, k = v | 0, fu = u - i, fv = v - k, o = k * RNX + i;
    return (REL[o] * (1 - fu) + REL[o + 1] * fu) * (1 - fv) + (REL[o + RNX] * (1 - fu) + REL[o + RNX + 1] * fu) * fv; };
  let YTOP = 0; for (let o = 0; o < TH.length; o++) if (TH[o] > YTOP) YTOP = TH[o];
  lap('relief');

  // ================================================================== 7. surface nets: the cave (and the rock round the mouth)
  const cellV = new Int32Array(NT).fill(-1), VP = [], ACT = [];
  const EA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3], EB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
  const CX = [0, 1, 0, 1, 0, 1, 0, 1], CY = [0, 0, 1, 1, 0, 0, 1, 1], CZ = [0, 0, 0, 0, 1, 1, 1, 1];
  const cv = new Float32Array(8), OFF = [0, 1, SYS, SYS + 1, SZS, SZS + 1, SYS + SZS, SYS + SZS + 1];
  const MARK = new Uint8Array(NT);
  run(() => { for (let k = 0; k < GNZ; k++) for (let j = 0; j < GNY; j++) {
    let idx = j * SYS + k * SZS;
    for (let i = 0; i < GNX; i++, idx++) {
      if (G[idx] >= 0) continue;
      for (let dk = 0; dk < 2; dk++) { const kk = k - dk; if (kk < 0 || kk >= GNZ - 1) continue; for (let dj = 0; dj < 2; dj++) { const jj = j - dj; if (jj < 0 || jj >= GNY - 1) continue; const o = jj * SYS + kk * SZS; if (i < GNX - 1) MARK[o + i] = 1; if (i > 0) MARK[o + i - 1] = 1; } }
    }
  } });
  run(() => { for (let k = 0; k < GNZ - 1; k++) for (let j = 0; j < GNY - 1; j++) {
    let idx = j * SYS + k * SZS;
    for (let i = 0; i < GNX - 1; i++, idx++) {
      if (!MARK[idx]) continue;
      let m = 0;
      for (let q = 0; q < 8; q++) { const v = G[idx + OFF[q]]; cv[q] = v; if (v < 0) m |= 1 << q; }
      if (m === 0 || m === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let e = 0; e < 12; e++) {
        const a = EA[e], b = EB[e], va = cv[a], vb = cv[b]; if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb); sx += CX[a] + (CX[b] - CX[a]) * t; sy += CY[a] + (CY[b] - CY[a]) * t; sz += CZ[a] + (CZ[b] - CZ[a]) * t; n++;
      }
      cellV[idx] = VP.length / 3; ACT.push(idx);
      VP.push(GX0 + (i + sx / n) * VX, GY0 + (j + sy / n) * VX, GZ0 + (k + sz / n) * VX);
    }
  } });
  const TRI = [];
  const quad = (a, b, c, d, ex, ey, ez) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const ux = VP[c * 3] - VP[a * 3], uy = VP[c * 3 + 1] - VP[a * 3 + 1], uz = VP[c * 3 + 2] - VP[a * 3 + 2], wx = VP[d * 3] - VP[b * 3], wy = VP[d * 3 + 1] - VP[b * 3 + 1], wz = VP[d * 3 + 2] - VP[b * 3 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    if (nx * ex + ny * ey + nz * ez < 0) TRI.push(a, d, c, a, c, b); else TRI.push(a, b, c, a, c, d);
  };
  run(() => { for (const idx of ACT) {
    const i = idx % GNX, j = ((idx / GNX) | 0) % GNY, k = (idx / SZS) | 0, g0 = G[idx], s0 = g0 < 0 ? -1 : 1;
    if (j > 0 && k > 0 && (g0 < 0) !== (G[idx + 1] < 0)) quad(cellV[idx], cellV[idx - SYS], cellV[idx - SYS - SZS], cellV[idx - SZS], s0, 0, 0);
    if (i > 0 && k > 0 && (g0 < 0) !== (G[idx + SYS] < 0)) quad(cellV[idx], cellV[idx - 1], cellV[idx - 1 - SZS], cellV[idx - SZS], 0, s0, 0);
    if (i > 0 && j > 0 && (g0 < 0) !== (G[idx + SZS] < 0)) quad(cellV[idx], cellV[idx - 1], cellV[idx - 1 - SYS], cellV[idx - SYS], 0, 0, s0);
  } });
  const NV0 = VP.length / 3;
  // per vertex: normal (from the field), terrain or cave, colour
  const VN = new Array(NV0 * 3), VC = new Array(NV0 * 3), VT = new Uint8Array(NV0), tn = [0, 0, 0];
  const cWall = lin('#6F6999'), cWall2 = lin('#5F5A8A'), cCeil = lin('#4A4673'), cSilt = lin('#B3A2AA'), cFlow = lin('#BDB4DA'), cWet = lin('#45436D'), cSub = lin('#335478'), cShelf = lin('#C2B2BE'), cMouth = lin('#7A76A2');
  const cRock = lin('#7E80AC'), cRock2 = lin('#676A97'), cMoss = lin('#56705F'), cMoss2 = lin('#486257'), cMud = lin('#6F6478'), cGrass = lin('#5C735F'), cTrack = lin('#8A7A88'), cBed = lin('#45476C');
  const mix3 = (o, c, t) => { o[0] += (c[0] - o[0]) * t; o[1] += (c[1] - o[1]) * t; o[2] += (c[2] - o[2]) * t; };
  function terrCol(x, y, z, nx, ny, nz, o) {
    const n1 = fbm2(x * .02, z * .02, sd(51), 2), st = sstep(.25, .75, vn2(x * .45 + z * .45, y * .03, sd(53)) * .7 + vn2(x * .09 + z * .09, y * .02, sd(56)) * .3);
    o[0] = lerp(cRock[0], cRock2[0], st); o[1] = lerp(cRock[1], cRock2[1], st); o[2] = lerp(cRock[2], cRock2[2], st);
    const band = .94 + .08 * Math.sin(y * .7 + n1 * 5); o[0] *= band; o[1] *= band; o[2] *= band;
    const veg = [lerp(cMoss[0], cMoss2[0], n1), lerp(cMoss[1], cMoss2[1], n1), lerp(cMoss[2], cMoss2[2], n1)];
    mix3(o, veg, sstep(.6, .8, ny) * (.75 + .25 * vn2(x * .08, z * .08, sd(54))));
    if (y < 4.5 && x < portalX + 2) mix3(o, vn2(x * .05, z * .05, sd(55)) > .5 ? cGrass : cMud, sstep(.75, .9, ny) * .85);
    const dt = segDist(x, z, TRACK), dc = Math.hypot(x - CAMP.x, z - CAMP.z), ds = segDist(x, z, STREAM);
    if (dt < 4) mix3(o, cTrack, (1 - sstep(2, 4, dt)) * .8);
    if (dc < 34) mix3(o, cMud, (1 - sstep(20, 34, dc)) * .8);
    if (ds < 6 && y < 3) mix3(o, cBed, (1 - sstep(2, 6, ds)) * .8);
  }
  function caveCol(x, y, z, nx, ny, nz, wl, s, o) {
    const n1 = vn3(x * .08, y * .1, z * .08, sd(41)), n2 = vn3(x * .3, y * .35, z * .3, sd(42)), band = .5 + .5 * Math.sin(y * .9 + n1 * 4);
    o[0] = lerp(cWall[0], cWall2[0], band); o[1] = lerp(cWall[1], cWall2[1], band); o[2] = lerp(cWall[2], cWall2[2], band);
    if (ny < -.35) mix3(o, cCeil, sstep(-.35, -.8, ny));
    if (ny > .5) mix3(o, cSilt, sstep(.5, .85, ny));
    if (s >= 0 && SK[s] === 1 && n1 > .58 && Math.abs(ny) < .75) mix3(o, cFlow, sstep(.58, .7, n1) * .75);
    const mot = .86 + .26 * n2; o[0] *= mot; o[1] *= mot; o[2] *= mot;
    if (Number.isFinite(wl)) { const dw = y - wl; if (dw < 1.4 && dw > -.2) mix3(o, cWet, (1 - sstep(.1, 1.4, dw)) * .7); if (dw <= -.05) mix3(o, cSub, sstep(-.05, -1.6, dw)); }
    if (Math.abs(x - SH.x) < SH.bx + 1 && Math.abs(z - SH.z) < SH.bz + 1 && y > SH.top - 2 && ny > .35) mix3(o, cShelf, .85);
    if (x < -246) mix3(o, cMouth, sstep(-246, -322, x) * .6);
  }
  const ctmp = [0, 0, 0];
  run(() => { for (let v = 0; v < NV0; v++) {
    const x = VP[v * 3], y = VP[v * 3 + 1], z = VP[v * 3 + 2];
    const terr = Math.abs(hcAt(x, z) - y) < 1.1 && y > -4;
    VT[v] = terr ? 1 : 0;
    let nx, ny, nz;
    if (terr) { tnAt(x, z, tn); nx = tn[0]; ny = tn[1]; nz = tn[2]; }
    else { const e = .9; nx = gAt(x - e, y, z) - gAt(x + e, y, z); ny = gAt(x, y - e, z) - gAt(x, y + e, z); nz = gAt(x, y, z - e) - gAt(x, y, z + e); const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; }
    VN[v * 3] = nx; VN[v * 3 + 1] = ny; VN[v * 3 + 2] = nz;
    if (terr) terrCol(x, y, z, nx, ny, nz, ctmp);
    else { const c = cellOf(x, z), vi = vIdx(x, y, z); caveCol(x, y, z, nx, ny, nz, c >= 0 ? WAT[c] : NaN, vi >= 0 ? SID[vi] : -1, ctmp); }
    VC[v * 3] = ctmp[0]; VC[v * 3 + 1] = ctmp[1]; VC[v * 3 + 2] = ctmp[2];
  } });
  // split the cave at the section surface: below (always drawn, the overlay surface) and roof (drawn while closed)
  const SV = new Array(NV0); run(() => { for (let v = 0; v < NV0; v++) SV[v] = VP[v * 3 + 1] - relAt(VP[v * 3], VP[v * 3 + 2]); });
  // the roof reaches 0.6 m below the section so the two meshes overlap (different shaders never meet exactly)
  const SV2 = SV.map((v) => v + .6), IB = [], IR = [], IT = [];
  const mkMid = (S, keys) => (a, b) => {
    const key = a < b ? a * 1048576 + b : b * 1048576 + a; let v = keys.get(key); if (v !== undefined) return v;
    const t = S[a] / (S[a] - S[b]); v = VP.length / 3;
    for (let q = 0; q < 3; q++) { VP.push(VP[a * 3 + q] + (VP[b * 3 + q] - VP[a * 3 + q]) * t); VN.push(VN[a * 3 + q] + (VN[b * 3 + q] - VN[a * 3 + q]) * t); VC.push(VC[a * 3 + q] + (VC[b * 3 + q] - VC[a * 3 + q]) * t); }
    SV.push(SV[a] + (SV[b] - SV[a]) * t); SV2.push(SV2[a] + (SV2[b] - SV2[a]) * t); keys.set(key, v); return v;
  };
  const midB = mkMid(SV, new Map()), midR = mkMid(SV2, new Map());
  const poly = [], T3 = [0, 0, 0], clipInto = (a, b, c, S, sign, mid, out) => {
    poly.length = 0; T3[0] = a; T3[1] = b; T3[2] = c;
    for (let e = 0; e < 3; e++) { const p = T3[e], q = T3[(e + 1) % 3], sp = sign * S[p], sq = sign * S[q]; if (sp <= 0) poly.push(p); if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) poly.push(mid(p, q)); }
    for (let e = 1; e + 1 < poly.length; e++) out.push(poly[0], poly[e], poly[e + 1]);
  };
  run(() => { for (let t = 0; t < TRI.length; t += 3) {
    const a = TRI[t], b = TRI[t + 1], c = TRI[t + 2];
    if (VT[a] + VT[b] + VT[c] >= 2) { IT.push(a, b, c); continue; }
    const hi = Math.max(SV[a], SV[b], SV[c]), lo = Math.min(SV[a], SV[b], SV[c]), hi2 = hi + .6, lo2 = lo + .6;
    if (hi <= 0) IB.push(a, b, c); else if (lo < 0) clipInto(a, b, c, SV, 1, midB, IB);
    if (lo2 >= 0) IR.push(a, b, c); else if (hi2 > 0) clipInto(a, b, c, SV2, -1, midR, IR);
  } });
  run(() => { for (let v = NV0; v < VP.length / 3; v++) { const l = Math.hypot(VN[v * 3], VN[v * 3 + 1], VN[v * 3 + 2]) || 1; VN[v * 3] /= l; VN[v * 3 + 1] /= l; VN[v * 3 + 2] /= l; } });
  const isoPos = new THREE.BufferAttribute(new Float32Array(VP), 3), isoNrm = new THREE.BufferAttribute(new Float32Array(VN), 3), isoCol = new THREE.BufferAttribute(new Float32Array(VC), 3);
  const isoGeo = (I) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', isoPos); g.setAttribute('normal', isoNrm); g.setAttribute('color', isoCol); g.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };
  lap('mesh');

  // ================================================================== 8. textures and materials
  const relTex = new THREE.DataTexture(REL16, RNX, RNZ, THREE.RedFormat, THREE.HalfFloatType);
  relTex.magFilter = relTex.minFilter = THREE.LinearFilter; relTex.needsUpdate = true;
  const SDF8 = new Uint8Array(NT); run(() => { for (let idx = 0; idx < NT; idx++) { const v = (128.5 + G[idx] * 24) | 0; SDF8[idx] = v < 0 ? 0 : v > 255 ? 255 : v; } });
  const sdfTex = new THREE.Data3DTexture(SDF8, GNX, GNY, GNZ);
  sdfTex.format = THREE.RedFormat; sdfTex.type = THREE.UnsignedByteType; sdfTex.magFilter = sdfTex.minFilter = THREE.LinearFilter; sdfTex.unpackAlignment = 1; sdfTex.needsUpdate = true;
  const WAT16 = new Uint16Array(LN), writeWat = (rise) => { for (let c = 0; c < LN; c++) WAT16[c] = THREE.DataUtils.toHalfFloat(Number.isFinite(WAT[c]) ? WAT[c] + rise : -1000); };
  writeWat(0);
  const watTex = new THREE.DataTexture(WAT16, LNX, LNZ, THREE.RedFormat, THREE.HalfFloatType); watTex.magFilter = watTex.minFilter = THREE.NearestFilter; watTex.needsUpdate = true;
  const U = {
    uRelief: { value: relTex }, uRelO: { value: new THREE.Vector4(BX0, -BZ0, 1 / (RNX * RC), -1 / (RNZ * RC)) }, uCutP: { value: -999 }, uTime: { value: 0 },
    uSdf: { value: sdfTex }, uSdfO: { value: V3(GX0 - VX / 2, GY0 - VX / 2, -(GZ0 - VX / 2)) }, uSdfS: { value: V3(1 / (GNX * VX), 1 / (GNY * VX), -1 / (GNZ * VX)) },
    uWat: { value: watTex }, uWatO: { value: new THREE.Vector4(LX0, -LZ0, 1 / (LNX * VX), -1 / (LNZ * VX)) },
    uCapA: { value: COL('#EBD5D6') }, uCapB: { value: COL('#DDC4CC') }, uCapC: { value: COL('#F3E5E3') }, uCapLine: { value: COL('#A68AA6') }, uWaterSec: { value: COL('#4F97B0') },
  };
  const GLSL_NOISE = `
    float cvH(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float cvN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(cvH(i), cvH(i + vec2(1., 0.)), f.x), mix(cvH(i + vec2(0., 1.)), cvH(i + vec2(1., 1.)), f.x), f.y); }
    uniform vec3 uCapA, uCapB, uCapC, uCapLine;
    vec3 caveStrata(vec3 p){
      float w = cvN(p.xz * .017) * 2.4 + cvN(p.xz * .07 + 3.1) * .8;
      float b = (p.y + w) / 3.2, id = floor(b), f = fract(b), hb = cvH(vec2(id, 7.31));
      vec3 c = mix(uCapA, uCapB, hb);
      c = mix(c, uCapC, step(.78, hb) * .7);
      c = mix(c, uCapLine, (1. - smoothstep(.0, .07, f)) * step(.35, cvH(vec2(id, 3.17))) * .75);
      c = mix(c, uCapLine, smoothstep(.93, 1., f) * .25);
      c *= .8 + .2 * smoothstep(-14., 30., p.y);
      c = mix(c, c * vec3(.72, .84, 1.08), smoothstep(-2.5, -6.5, p.y));            // below the water table: saturated rock
      return c * (.9 + .14 * cvN(p.xz * .33 + p.y * .21));
    }\n`;
  const GLSL_CUT = `uniform highp sampler2D uRelief; uniform vec4 uRelO; uniform float uCutP;
    float cutAt(vec2 xz){ vec2 uv = clamp((xz - uRelO.xy) * uRelO.zw, 0., 1.); return max(texture2D(uRelief, uv).r, uCutP); }\n`;
  // modes: cut (discard above the section), section (cut faces: strata colour + cut), collapse (instances vanish when the
  // ground under them is cut away), cap (the sculpted section surface itself, with holes over the cave)
  function patch(mat, mode) {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      let vs = 'varying vec3 vCutW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 cwp = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
          cwp = instanceMatrix * cwp;
        #endif
          vCutW = (modelMatrix * cwp).xyz; }`);
      let fs = 'varying vec3 vCutW;\n' + sh.fragmentShader;
      if (mode === 'cut' || mode === 'section') fs = GLSL_CUT + fs.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (vCutW.y > cutAt(vCutW.xz)) discard;');
      if (mode === 'section') fs = GLSL_NOISE + fs.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = caveStrata(vCutW);');
      if (mode === 'collapse') vs = 'attribute float aBase;\n' + GLSL_CUT + vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n { vec4 ip = modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.); if (aBase > cutAt(ip.xz) + .3) transformed = vec3(0.); }');
      if (mode === 'cap') {
        vs = 'attribute float aRel; attribute float aTer; attribute vec3 aNRel; uniform float uCutP;\n' + vs
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n objectNormal = uCutP > aRel ? vec3(0., 1., 0.) : aNRel;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y = min(max(aRel, uCutP), aTer);');
        fs = GLSL_NOISE + 'uniform highp sampler3D uSdf; uniform vec3 uSdfO, uSdfS; uniform highp sampler2D uWat; uniform vec4 uWatO; uniform float uTime; uniform vec3 uWaterSec;\n' + fs
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
            vec3 cuvw = (vCutW - uSdfO) * uSdfS; float csd = 9.;
            if (all(greaterThan(cuvw, vec3(0.))) && all(lessThan(cuvw, vec3(1.)))) csd = (texture(uSdf, cuvw).r * 255. - 128.) / 24.;
            float cwl = -1e4; vec2 cwv = (vCutW.xz - uWatO.xy) * uWatO.zw;
            if (all(greaterThan(cwv, vec2(0.))) && all(lessThan(cwv, vec2(1.)))) cwl = texture2D(uWat, cwv).r;
            float cwet = 0.;
            if (csd < -.3) { if (vCutW.y < cwl - .02) cwet = 1.; else discard; }`)
          .replace('#include <color_fragment>', `#include <color_fragment>
            diffuseColor.rgb = mix(mix(caveStrata(vCutW) * (1. + .1 * (1. - smoothstep(.5, 2.2, csd))), uCapLine * .55, 1. - smoothstep(-.3, .45, csd)), uWaterSec * (.86 + .2 * cvN(vCutW.xz * .25 + vec2(uTime * .35, uTime * .2))), cwet);`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, .38, cwet);')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += uWaterSec * .22 * cwet;');
      }
      sh.vertexShader = vs; sh.fragmentShader = fs;
    };
    mat.customProgramCacheKey = () => 'cave4-' + mode + (mat.isMeshDepthMaterial ? '-d' : '');
    return mat;
  }
  const depthOf = (mode) => patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), mode);
  const owned = [];                                                          // materials, geometries, textures to free
  const own = (x) => { owned.push(x); return x; };
  const std = (o) => own(new THREE.MeshStandardMaterial({ roughness: .92, metalness: 0, ...o }));
  const group = new THREE.Group(); group.name = 'cave-world';
  const add = (o, parent = group) => { parent.add(o); return o; };
  const meshOf = (geo, mat, { cast = true, receive = true, name = '', depth = null } = {}) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = receive; m.name = name; if (depth) m.customDepthMaterial = own(depth); own(geo); return m; };

  // ================================================================== 9. meshes: cave, terrain, block, cap
  const matCave = std({ vertexColors: true, roughness: .95 });
  const caveBelow = add(meshOf(isoGeo(IB), matCave, { name: 'cave' }));
  caveBelow.userData.layer = 'cave';
  const matCaveBack = own(new THREE.MeshBasicMaterial({ color: COL('#25264A'), side: THREE.BackSide }));
  add(new THREE.Mesh(caveBelow.geometry, matCaveBack)).name = 'cave-back';
  const matRoof = patch(std({ vertexColors: true, roughness: .95 }), 'cut');
  const caveRoof = add(meshOf(isoGeo(IR), matRoof, { name: 'cave-roof', depth: depthOf('cut') }));
  const matTerr = patch(std({ vertexColors: true, roughness: .96 }), 'cut'); matTerr.shadowSide = THREE.FrontSide;
  if (IT.length) add(meshOf(isoGeo(IT), matTerr, { name: 'terrain-mouth', depth: depthOf('cut') }));
  let terrInner;
  run(() => { // the heightfield: everywhere except where the voxel field already holds the surface
    const n = TNX * TNZ, P = new Float32Array(n * 3), Nn = new Float32Array(n * 3), Cc = new Float32Array(n * 3), idx = [];
    const inGrid = (x, z) => x > GX0 + 2 && x < GX0 + (GNX - 1) * VX - 2 && z > GZ0 + 2 && z < GZ0 + (GNZ - 1) * VX - 2;
    const covered = new Uint8Array(n);
    for (let k = 0; k < TNZ; k++) for (let i = 0; i < TNX; i++) {
      const o = k * TNX + i, x = BX0 + i * TC, z = BZ0 + k * TC, h0 = TH[o], cov = inGrid(x, z) && h0 < GTOP - 2;
      covered[o] = cov ? 1 : 0;
      P[o * 3] = x; P[o * 3 + 1] = inGrid(x, z) && h0 < GTOP + 2 ? h0 - .25 : h0; P[o * 3 + 2] = z;
      Nn[o * 3] = TNRM[o * 3]; Nn[o * 3 + 1] = TNRM[o * 3 + 1]; Nn[o * 3 + 2] = TNRM[o * 3 + 2];
      terrCol(x, h0, z, TNRM[o * 3], TNRM[o * 3 + 1], TNRM[o * 3 + 2], ctmp); Cc[o * 3] = ctmp[0]; Cc[o * 3 + 1] = ctmp[1]; Cc[o * 3 + 2] = ctmp[2];
    }
    // inner: wholly inside the cut window and above the section (gone once the mountain is open), outer: the rest
    const inner = new Uint8Array(n), idxI = [];
    for (let k = 0; k < TNZ; k++) for (let i = 0; i < TNX; i++) { const x = BX0 + i * TC, z = BZ0 + k * TC; inner[k * TNX + i] = winF(x, z) > .999 && TH[k * TNX + i] > relAt(x, z) + 1 ? 1 : 0; }
    for (let k = 0; k < TNZ - 1; k++) for (let i = 0; i < TNX - 1; i++) {
      const a = k * TNX + i, b = a + 1, c = a + TNX, d = c + 1;
      if (!(covered[a] && covered[b] && covered[c])) (inner[a] && inner[b] && inner[c] ? idxI : idx).push(a, c, b);
      if (!(covered[b] && covered[c] && covered[d])) (inner[b] && inner[c] && inner[d] ? idxI : idx).push(b, c, d);
    }
    const pa = new THREE.BufferAttribute(P, 3), na = new THREE.BufferAttribute(Nn, 3), ca = new THREE.BufferAttribute(Cc, 3);
    const tg = (I) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', pa); g.setAttribute('normal', na); g.setAttribute('color', ca); g.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1)); g.computeBoundingSphere(); return g; };
    add(meshOf(tg(idx), matTerr, { name: 'terrain', depth: depthOf('cut') }));
    terrInner = add(meshOf(tg(idxI), matTerr, { name: 'terrain-inner', depth: depthOf('cut') }));
    // the four cut sides of the block, strata coloured in the shader
    const SP = [], SN = [], SI = [];
    const side = (pts, nx, nz) => { const b0 = SP.length / 3; for (const [x, z, h] of pts) { SP.push(x, BOT, z, x, h, z); SN.push(nx, 0, nz, nx, 0, nz); } for (let q = 0; q < pts.length - 1; q++) { const a = b0 + q * 2; if (nz > 0 || nx < 0) SI.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); else SI.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } };
    const row = (k) => Array.from({ length: TNX }, (_, i) => [BX0 + i * TC, BZ0 + k * TC, TH[k * TNX + i]]), colm = (i) => Array.from({ length: TNZ }, (_, k) => [BX0 + i * TC, BZ0 + k * TC, TH[k * TNX + i]]);
    side(row(0), 0, -1); side(row(TNZ - 1), 0, 1); side(colm(0), -1, 0); side(colm(TNX - 1), 1, 0);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(SP, 3)); sg.setAttribute('normal', new THREE.Float32BufferAttribute(SN, 3)); sg.setIndex(SI); sg.computeBoundingSphere();
    const matSide = patch(std({ color: 0xffffff, roughness: .9 }), 'section');
    add(meshOf(sg, matSide, { name: 'block-sides', depth: depthOf('cut') }));
    const plinth = add(meshOf(new THREE.BoxGeometry(BX1 - BX0 + 16, 8, BZ1 - BZ0 + 16), std({ color: COL('#23264A'), roughness: .85 }), { name: 'plinth', cast: false }));
    plinth.position.set((BX0 + BX1) / 2, BOT - 4, (BZ0 + BZ1) / 2);
  });
  let cap;
  run(() => { // the section surface: a grid over the window whose height comes from the relief and the cut plane (GPU)
    const i0 = Math.max(0, Math.floor((WX0 - BX0) / TC) - 1), k1 = Math.min(TNZ - 1, Math.ceil((WZ1 - BZ0) / TC) + 1), nx = TNX - i0, nz = k1 + 1;
    const P = new Float32Array(nx * nz * 3), Nn = new Float32Array(nx * nz * 3), AR = new Float32Array(nx * nz), AT = new Float32Array(nx * nz), AN = new Float32Array(nx * nz * 3), I = [];
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const o = k * nx + i, x = BX0 + (i0 + i) * TC, z = BZ0 + k * TC;
      P[o * 3] = x; P[o * 3 + 2] = z; Nn[o * 3 + 1] = 1;
      AR[o] = relAt(x, z); AT[o] = TH[k * TNX + i0 + i] - .45;
      let gx = (relAt(x + 1.5, z) - relAt(x - 1.5, z)) / 3, gz = (relAt(x, z + 1.5) - relAt(x, z - 1.5)) / 3; const l = Math.hypot(gx, 1, gz);
      AN[o * 3] = -gx / l; AN[o * 3 + 1] = 1 / l; AN[o * 3 + 2] = -gz / l;
    }
    for (let k = 0; k < nz - 1; k++) for (let i = 0; i < nx - 1; i++) { const a = k * nx + i, b = a + 1, c = a + nx, d = c + 1; I.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
    g.setAttribute('aRel', new THREE.BufferAttribute(AR, 1)); g.setAttribute('aTer', new THREE.BufferAttribute(AT, 1)); g.setAttribute('aNRel', new THREE.BufferAttribute(AN, 3)); g.setIndex(I);
    g.boundingSphere = new THREE.Sphere(V3((BX0 + i0 * TC + BX1) / 2, 60, (BZ0 + BZ0 + k1 * TC) / 2), 600);
    const matCap = patch(std({ color: 0xffffff, roughness: .88 }), 'cap'); matCap.shadowSide = THREE.FrontSide;
    cap = add(meshOf(g, matCap, { name: 'section', depth: depthOf('cap') }));
  });
  lap('meshes');

  // ================================================================== 10. water (contours of the field at each level)
  const normTex = (() => {
    const S = 128, hgt = new Float32Array(S * S), data = new Uint8Array(S * S * 4), RW = rng(seed + 77), waves = [];
    for (let q = 0; q < 12; q++) waves.push(((RW() * 9) | 0) - 4, ((RW() * 9) | 0) - 4, RW() * TAU, .3 + RW());
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let v = 0; for (let q = 0; q < waves.length; q += 4) v += waves[q + 3] * Math.sin(TAU * (waves[q] * x + waves[q + 1] * y) / S + waves[q + 2]); hgt[y * S + x] = v; }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x + S - 1) % S)], dy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x], l = Math.hypot(dx * .35, dy * .35, 1), o = (y * S + x) * 4;
      data[o] = (-dx * .35 / l * .5 + .5) * 255; data[o + 1] = (-dy * .35 / l * .5 + .5) * 255; data[o + 2] = (1 / l * .5 + .5) * 255; data[o + 3] = 255;
    }
    const t = new THREE.DataTexture(data, S, S); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return own(t);
  })();
  const matWater = std({ color: COL('#4A8BA6'), roughness: .3, transparent: true, opacity: .88, emissive: COL('#143E4C'), emissiveIntensity: 1, normalMap: normTex, normalScale: new THREE.Vector2(.45, .45) });
  const sliceF = new Float32Array(LN), sliceM = new Uint8Array(LN);
  function waterGeo(rise) {
    const P = [], UV = [], seg = [];
    for (const B of basins) {
      if (!B.voxels) continue;
      const lv = B.level + rise, jy = (lv - GY0) / VX, j0 = Math.floor(jy), tj = jy - j0; if (j0 < 0 || j0 >= GNY - 1) continue;
      const mg = 3 + Math.ceil(rise * 4), i0 = Math.max(0, B.i0 - mg), i1 = Math.min(LNX - 1, B.i1 + mg), k0 = Math.max(0, B.k0 - mg), k1 = Math.min(LNZ - 1, B.k1 + mg);
      const q = [];
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
        const c = k * LNX + i, a = G[i + j0 * SYS + k * SZS], b = G[i + (j0 + 1) * SYS + k * SZS]; sliceF[c] = a + (b - a) * tj; sliceM[c] = 0;
        if (LBAS[c] === B.id && sliceF[c] < 0) { sliceM[c] = 1; q.push(c); }
      }
      for (let h = 0; h < q.length; h++) { const c = q[h], i = c % LNX, k = (c / LNX) | 0; for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, kk = k + dk; if (ii < i0 || ii > i1 || kk < k0 || kk > k1) continue; const n = kk * LNX + ii; if (!sliceM[n] && sliceF[n] < 0) { sliceM[n] = 1; q.push(n); } } }
      const fv = (i, k) => { const c = k * LNX + i; let f = sliceF[c]; if (!sliceM[c] && f < .3) f = .3; const x = GX0 + i * VX, z = GZ0 + k * VX; if (relAt(x, z) < lv + .05 && f < .3) f = .3; return f; };
      const F = new Float32Array(4), PX = [0, 1, 1, 0], PZ = [0, 0, 1, 1], pts = [];
      for (let k = k0; k < k1; k++) for (let i = i0; i < i1; i++) {
        let neg = 0; for (let q2 = 0; q2 < 4; q2++) { F[q2] = fv(i + PX[q2], k + PZ[q2]); if (F[q2] < 0) neg++; }
        if (!neg) continue;
        pts.length = 0; const ends = [];
        for (let e = 0; e < 4; e++) {
          const a = e, b = (e + 1) & 3, fa = F[a], fb = F[b];
          if (fa < 0) pts.push(PX[a], PZ[a]);
          if ((fa < 0) !== (fb < 0)) { const t = fa / (fa - fb), px = PX[a] + (PX[b] - PX[a]) * t, pz = PZ[a] + (PZ[b] - PZ[a]) * t; pts.push(px, pz); ends.push(px, pz); }
        }
        const ox = GX0 + i * VX, oz = GZ0 + k * VX;
        for (let e = 1; e + 1 < pts.length / 2; e++) for (const v of [0, e + 1, e]) { const x = ox + pts[v * 2] * VX, z = oz + pts[v * 2 + 1] * VX; P.push(x, lv, z); UV.push(x / 22, z / 22); }
        if (B.name === 'the deep water' && ends.length === 4) seg.push(ox + ends[0] * VX, lv, oz + ends[1] * VX, ox + ends[2] * VX, lv, oz + ends[3] * VX);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    const nrm = new Float32Array(P.length); for (let q = 1; q < nrm.length; q += 3) nrm[q] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.computeBoundingSphere();
    g.userData.shore = seg; return g;
  }
  const water = add(new THREE.Mesh(waterGeo(0), matWater)); water.name = 'water'; water.receiveShadow = true; water.userData.layer = 'cave'; water.renderOrder = 1;
  let waterRise = 0;
  // the stream that runs out of the mouth across the valley
  { const P = [], UV = [], I = []; const pts = STREAM.slice(); pts[0] = [portalX + 2, N.E0.z + 1];
    let n = 0; for (let q = 0; q < pts.length - 1; q++) for (let s = 0; s < 6; s++) {
      const t = s / 6, x = lerp(pts[q][0], pts[q + 1][0], t), z = lerp(pts[q][1], pts[q + 1][1], t), dx = pts[q + 1][0] - pts[q][0], dz = pts[q + 1][1] - pts[q][1], l = Math.hypot(dx, dz), w = 2.2 + .8 * Math.sin(n * .7);
      for (const sgn of [-1, 1]) { const px = x + (-dz / l) * w * sgn, pz = z + (dx / l) * w * sgn; P.push(px, Math.max(Hf(px, pz), Hf(x, z)) + .32, pz); UV.push(px / 22, pz / 22); }
      if (n) I.push((n - 1) * 2, n * 2, (n - 1) * 2 + 1, (n - 1) * 2 + 1, n * 2, n * 2 + 1); n++;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I); g.computeVertexNormals();
    for (let q = 0; q < g.attributes.normal.count; q++) if (g.attributes.normal.getY(q) < 0) g.attributes.normal.setXYZ(q, 0, 1, 0);
    const st = add(meshOf(g, own(matWater.clone()), { cast: false, name: 'stream' })); st.renderOrder = 1; }
  lap('water-mesh');

  // ================================================================== 11. speleothems, boulders
  const M4 = new THREE.Matrix4(), QQ = new THREE.Quaternion(), EE = new THREE.Euler(), PP = V3(0, 0, 0), SS = V3(1, 1, 1), UPV = V3(0, 1, 0);
  const RS = rng(seed * 991 + 5);
  const lumpy = (geo, amt, s0) => { const p = geo.attributes.position; for (let q = 0; q < p.count; q++) { const x = p.getX(q), y = p.getY(q), z = p.getZ(q), f = 1 + (vn3(x * 3.1 + s0, y * 3.1, z * 3.1, sd(61)) - .5) * amt; p.setXYZ(q, x * f, y * (1 + (f - 1) * .5), z * f); } geo.computeVertexNormals(); return geo; };
  const weld = (geo) => { const src = geo.index ? geo.toNonIndexed() : geo, p = src.attributes.position, map = new Map(), pos = [], idx = []; for (let q = 0; q < p.count; q++) { const k = `${p.getX(q).toFixed(4)},${p.getY(q).toFixed(4)},${p.getZ(q).toFixed(4)}`; let v = map.get(k); if (v === undefined) { v = pos.length / 3; map.set(k, v); pos.push(p.getX(q), p.getY(q), p.getZ(q)); } idx.push(v); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  const geoStal = (() => { const g = new THREE.LatheGeometry([[1, 0], [.62, -.32], [.26, -.72], [0, -1]].map(([r, y]) => new THREE.Vector2(r, y)), 6); return lumpy(g, .35, 1); })();   // hangs down from y = 0
  const geoMite = (() => { const g = new THREE.LatheGeometry([new THREE.Vector2(1, 0), new THREE.Vector2(.72, .45), new THREE.Vector2(.3, .88), new THREE.Vector2(0, 1)], 6); return lumpy(g, .3, 2); })();
  const geoRock = lumpy(weld(new THREE.IcosahedronGeometry(1, 1)), .55, 3);
  const stal = [], mite = [], rocks = [];
  const nearPeople = (x, z) => Math.hypot(x - (SH.x - 3), z - SH.z) < 11;
  run(() => { for (let v = 0; v < NV0; v++) {
    if (VT[v]) continue;
    const x = VP[v * 3], y = VP[v * 3 + 1], z = VP[v * 3 + 2], ny = VN[v * 3 + 1], c = cellOf(x, z); if (c < 0 || x < portalX + 6) continue;
    const vi = vIdx(x, y, z), s = vi >= 0 ? SID[vi] : -1, chamber = s >= 0 && SK[s] === 1, air = Number.isFinite(CEI[c]) ? CEI[c] - Math.max(FLO[c], Number.isFinite(WAT[c]) ? WAT[c] : -1e9) : 0, r = RS();
    if (ny < -.82 && air > 3 && r < (chamber ? .16 : .05) * (HI ? 1 : .5)) stal.push([x, y + .35, z, .45 + RS() * .6, Math.min(air * .34, 1.2 + RS() * (chamber ? 3.6 : 2))]);
    else if (ny > .86 && air > 3 && !(y < (WAT[c] || -1e9) + .3) && !nearPeople(x, z) && r < (chamber ? .07 : .018) * (HI ? 1 : .5)) mite.push([x, y - .25, z, .35 + RS() * .55, Math.min(air * .3, .8 + RS() * (chamber ? 3.2 : 1.6))]);
    else if (ny > .74 && !nearPeople(x, z) && !(y < (WAT[c] || -1e9) - .2) && r < (chamber ? .07 : .022) * (HI ? 1 : .5)) rocks.push([x, y, z, (chamber ? .8 : .5) + RS() * (chamber ? 2.6 : 1.4)]);
  } });
  const matStal = patch(std({ color: COL('#A69FCB'), roughness: .8 }), 'cut'), matMite = patch(std({ color: COL('#9C94C2'), roughness: .85 }), 'cut'), matRock = patch(std({ color: COL('#6C6794'), roughness: .95 }), 'cut');
  const inst = (geo, mat, list, setM, name, depthMode = 'cut') => {
    const im = new THREE.InstancedMesh(own(geo), mat, Math.max(1, list.length)); im.count = list.length; im.name = name; im.castShadow = true; im.receiveShadow = true;
    list.forEach((it, q) => { setM(it, q); im.setMatrixAt(q, M4); }); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    if (depthMode) im.customDepthMaterial = own(depthOf(depthMode)); return add(im);
  };
  const stalIM = inst(geoStal, matStal, stal, (s) => { EE.set(RS() * .12 - .06, RS() * TAU, RS() * .12 - .06); QQ.setFromEuler(EE); PP.set(s[0], s[1], s[2]); SS.set(s[3], s[4], s[3]); M4.compose(PP, QQ, SS); }, 'stalactites');
  inst(geoMite, matMite, mite, (s) => { EE.set(0, RS() * TAU, 0); QQ.setFromEuler(EE); PP.set(s[0], s[1], s[2]); SS.set(s[3], s[4], s[3]); M4.compose(PP, QQ, SS); }, 'stalagmites');
  inst(geoRock, matRock, rocks, (s) => { EE.set(RS() * TAU, RS() * TAU, RS() * TAU); QQ.setFromEuler(EE); PP.set(s[0], s[1] + s[3] * .2, s[2]); SS.set(s[3] * 1.2, s[3] * .62, s[3]); M4.compose(PP, QQ, SS); }, 'boulders');
  lap('speleothems');

  // ================================================================== 12. jungle, staging area
  const RJ = rng(seed * 1237 + 11);
  const geoCanopy = lumpy(weld(new THREE.IcosahedronGeometry(1, 1)), .42, 4), geoTrunk = new THREE.CylinderGeometry(.35, .6, 1, 6, 1, true).translate(0, .5, 0);
  const trees = [], NTREE = HI ? 980 : 500;
  run(() => { for (let t = 0; t < NTREE * 5 && trees.length < NTREE; t++) {
    const x = BX0 + 5 + RJ() * (BX1 - BX0 - 10), z = BZ0 + 5 + RJ() * (BZ1 - BZ0 - 10), hgt = thAt(x, z); tnAt(x, z, tn);
    if (Math.hypot(x - CAMP.x, z - CAMP.z) < 34 || segDist(x, z, STREAM) < 6 || segDist(x, z, TRACK) < 5) continue;
    if (x < portalX + 4 && Math.abs(z - N.E0.z) < 26) continue;                     // keep the mouth clear
    const dens = sstep(.5, .78, tn[1]) * (.45 + .55 * fbm2(x * .012, z * .012, sd(71), 2)) * (hgt < 4 ? .55 : 1);
    if (RJ() > dens) continue;
    const big = hgt < 4 ? .9 : 1, r = (4.6 + RJ() * 4.4) * big, ht = (3 + RJ() * 4.5) * big;
    trees.push({ x, z, y: hgt - .4, r, ht, c: RJ() });
  } });
  const leafC = ['#3D5C55', '#486A5E', '#56786A', '#34514C', '#5E7C66'].map(COL);
  const matTrunk = patch(std({ color: COL('#5A4E66'), roughness: .95 }), 'collapse'), matLeaf = patch(std({ color: 0xffffff, roughness: .9 }), 'collapse');
  const baseAttr = (geo, list) => { const a = new Float32Array(Math.max(1, list.length)); list.forEach((t, q) => { a[q] = t.y; }); geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(a, 1)); return geo; };
  const forest = (list, tag) => {                         // trunks + canopies; the inner set stands on rock the cut removes
    inst(baseAttr(geoTrunk.clone(), list), matTrunk, list, (t) => { QQ.identity(); PP.set(t.x, t.y, t.z); SS.set(t.r * .16 + .35, t.ht + t.r * .5, t.r * .16 + .35); M4.compose(PP, QQ, SS); }, 'trunks' + tag, 'collapse');
    const leafIM = inst(baseAttr(geoCanopy.clone(), list), matLeaf, list, (t) => { EE.set(0, t.c * TAU, 0); QQ.setFromEuler(EE); PP.set(t.x, t.y + t.ht + t.r * .55, t.z); SS.set(t.r, t.r * (.78 + t.c * .3), t.r * (.85 + t.c * .3)); M4.compose(PP, QQ, SS); }, 'canopy' + tag, 'collapse');
    list.forEach((t, q) => leafIM.setColorAt(q, leafC[(t.c * leafC.length) | 0])); if (leafIM.instanceColor) leafIM.instanceColor.needsUpdate = true;
    return [leafIM, group.children[group.children.length - 2]];
  };
  const isInner = (t) => winF(t.x, t.z) > .999 && t.y > relAt(t.x, t.z) + 1;
  forest(trees.filter((t) => !isInner(t)), '');
  const treesInner = forest(trees.filter(isInner), '-inner');
  // staging: tents, a gazebo, crates, light masts, the tether pad; rescuers and relay beacons from props.glb if there
  const tmpM = new THREE.Matrix4();
  const propParts = (name) => {
    const o = props && props.getObjectByName ? props.getObjectByName(name) : null; if (!o) return null;
    o.updateWorldMatrix(true, true); const inv = new THREE.Matrix4().copy(o.matrixWorld).invert(), parts = [];
    o.traverse((m) => { if (m.isMesh) parts.push({ geometry: m.geometry, material: m.material, matrix: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld) }); });
    return parts.length ? parts : null;
  };
  const placeProp = (name, list, fallback, tint = null) => {         // list: [x, y, z, rotY, scale]
    const parts = propParts(name), g = new THREE.Group(); g.name = name;
    const mats = list.map(([x, y, z, ry, s]) => { EE.set(0, ry || 0, 0); QQ.setFromEuler(EE); return new THREE.Matrix4().compose(V3(x, y, z), QQ.clone(), V3(s || 1, s || 1, s || 1)); });
    if (parts) for (const p of parts) { let mt = p.material; if (tint && mt && /foliage|leaf|leaves/i.test(mt.name || '')) { mt = own(mt.clone()); mt.color = COL(tint); } const im = new THREE.InstancedMesh(p.geometry, mt, mats.length); mats.forEach((m, q) => im.setMatrixAt(q, tmpM.multiplyMatrices(m, p.matrix))); im.castShadow = im.receiveShadow = true; im.userData.shared = true; im.computeBoundingSphere(); g.add(im); }
    else { const { geo, mat } = fallback(); const im = new THREE.InstancedMesh(own(geo), mat, mats.length); mats.forEach((m, q) => im.setMatrixAt(q, m)); im.castShadow = im.receiveShadow = true; im.computeBoundingSphere(); g.add(im); }
    return add(g);
  };
  const merged = (items) => {                            // [{ geo, m: Matrix4, c: hex }] -> one vertex-coloured geometry
    const P = [], Nn = [], Cc = [];
    for (const it of items) { const g = it.geo.index ? it.geo.toNonIndexed() : it.geo; g.applyMatrix4(it.m); const c = lin(it.c), p = g.attributes.position, n = g.attributes.normal; for (let q = 0; q < p.count; q++) { P.push(p.getX(q), p.getY(q), p.getZ(q)); Nn.push(n.getX(q), n.getY(q), n.getZ(q)); Cc.push(c[0], c[1], c[2]); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.computeBoundingSphere(); return g;
  };
  const at = (x, z, dy = 0, ry = 0, s = [1, 1, 1]) => { EE.set(0, ry, 0); QQ.setFromEuler(EE); return new THREE.Matrix4().compose(V3(x, Hf(x, z) + dy, z), QQ.clone(), V3(...s)); };
  const BASE = V3(cX(baseCell), FLO[baseCell] + .3, cZ(baseCell));
  const STATION = V3(portalX - 14, Hf(portalX - 14, N.E0.z - 9) + .25, N.E0.z - 9);
  const HOVER = V3(portalX + 9, 9.5, N.E0.z + 1);
  { const items = [], ap = '#F6D2B1', ap2 = '#E7AE86', grey = '#A49BB6', dark = '#5B5878';
    const tent = (x, z, ry, c) => { const g = new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2); items.push({ geo: g, m: at(x, z, 0, ry, [1.7, 1.25, 1.35]), c }); };
    tent(CAMP.x - 12, CAMP.z - 6, .3, ap); tent(CAMP.x - 16, CAMP.z + 4, -.2, ap2); tent(CAMP.x - 6, CAMP.z - 14, .8, ap);
    const gz = [CAMP.x + 4, CAMP.z + 2];                                                           // gazebo (command post)
    for (const [dx, dz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) items.push({ geo: new THREE.CylinderGeometry(.06, .06, 2.4, 5), m: at(gz[0] + dx, gz[1] + dz, 1.2), c: dark });
    items.push({ geo: new THREE.ConeGeometry(3.4, 1.2, 4), m: at(gz[0], gz[1], 2.95, Math.PI / 4), c: ap2 });
    items.push({ geo: new THREE.BoxGeometry(2.4, .08, 1), m: at(gz[0], gz[1], .85), c: grey });
    for (let q = 0; q < 7; q++) { const x = CAMP.x + 10 + (q % 3) * 1.4, z = CAMP.z - 8 + ((q / 3) | 0) * 1.3; items.push({ geo: new THREE.BoxGeometry(1.1, .7, .8), m: at(x, z, .35 + (q === 6 ? .7 : 0), q * .2), c: q % 2 ? grey : '#8A85A3' }); }
    items.push({ geo: new THREE.BoxGeometry(1.8, 1.2, 1.1), m: at(CAMP.x + 16, CAMP.z + 6, .6), c: '#6E6A8E' });  // generator
    items.push({ geo: new THREE.BoxGeometry(3.4, .18, 3.4), m: at(STATION.x, STATION.z, .09), c: ap });             // tether pad
    items.push({ geo: new THREE.BoxGeometry(3, .2, 3), m: at(BASE.x, BASE.z, .1), c: '#9C93AE' });                   // drone pad
    const masts = [[portalX - 12, N.E0.z - 22], [portalX - 13, N.E0.z + 16]];
    for (const [x, z] of masts) items.push({ geo: new THREE.CylinderGeometry(.09, .12, 7, 6), m: at(x, z, 3.5), c: dark });
    const sg = merged(items), stg = add(meshOf(sg, std({ vertexColors: true, roughness: .85 }), { name: 'staging' }));
    const heads = merged(masts.map(([x, z]) => ({ geo: new THREE.BoxGeometry(.7, .4, .5), m: at(x, z, 7.1, Math.atan2(-(N.E0.z - z), portalX + 10 - x)), c: '#FFE6C8' })));
    add(meshOf(heads, own(new THREE.MeshBasicMaterial({ color: COL('#FFE6C8') })), { cast: false, name: 'lamps' }));
    void stg;
    const resc = [[CAMP.x + 3, CAMP.z + 1, 1.2], [CAMP.x + 5.5, CAMP.z + 3, -2], [CAMP.x + 12, CAMP.z - 5, .4], [STATION.x - 2, STATION.z - 2, .9], [portalX - 8, N.E0.z - 3, 1.6], [portalX - 9, N.E0.z + 2, 1.4], [CAMP.x - 8, CAMP.z - 1, 2.6]];
    placeProp('rescuer', resc.map(([x, z, ry]) => [x, Hf(x, z), z, ry, 1]), () => {
      const g = merged([{ geo: new THREE.CapsuleGeometry(.24, .9, 3, 8), m: new THREE.Matrix4().makeTranslation(0, .75, 0), c: '#8F8CC4' }, { geo: new THREE.SphereGeometry(.15, 8, 6), m: new THREE.Matrix4().makeTranslation(0, 1.55, 0), c: '#E9C9B0' }, { geo: new THREE.SphereGeometry(.18, 8, 4, 0, TAU, 0, Math.PI / 2), m: new THREE.Matrix4().makeTranslation(0, 1.6, 0), c: '#F6D2B1' }]);
      return { geo: g, mat: std({ vertexColors: true }) };
    });
    placeProp('relay_beacon', Array.from({ length: 8 }, (_, q) => { const x = CAMP.x + 10 + (q % 4) * .32, z = CAMP.z - 8 + ((q / 4) | 0) * .4; return [x, Hf(x, z) + 1.4, z, 0, 1]; }), () => {
      const g = merged([{ geo: new THREE.CylinderGeometry(.09, .11, .22, 8), m: new THREE.Matrix4().makeTranslation(0, .11, 0), c: '#5B5878' }, { geo: new THREE.SphereGeometry(.06, 8, 4), m: new THREE.Matrix4().makeTranslation(0, .24, 0), c: '#7FD4CF' }]);
      return { geo: g, mat: std({ vertexColors: true, emissive: COL('#2C5F5C') }) };
    });
    const palms = [], broad = [], bushes = [];
    for (let q = 0; q < 40 && palms.length + broad.length < 9; q++) { const a = RJ() * TAU, d = 30 + RJ() * 22, x = CAMP.x + Math.cos(a) * d, z = CAMP.z + Math.sin(a) * d; if (x > portalX - 4 || segDist(x, z, STREAM) < 5 || segDist(x, z, TRACK) < 4 || x < BX0 + 3 || z < BZ0 + 3) continue; (RJ() < .5 ? palms : broad).push([x, Hf(x, z) - .1, z, RJ() * TAU, .9 + RJ() * .5]); }
    for (let q = 0; q < 30 && bushes.length < 8; q++) { const a = RJ() * TAU, d = 20 + RJ() * 16, x = CAMP.x + Math.cos(a) * d, z = CAMP.z + Math.sin(a) * d; if (x > portalX - 3 || segDist(x, z, STREAM) < 3 || segDist(x, z, TRACK) < 3 || x < BX0 + 2) continue; bushes.push([x, Hf(x, z) - .05, z, RJ() * TAU, 1 + RJ()]); }
    const blob = (c, sy = 1) => () => ({ geo: (() => { const g = geoCanopy.clone(); g.scale(4, 3.2 * sy, 4); g.translate(0, 7 * sy, 0); return g; })(), mat: std({ color: COL(c) }) });
    placeProp('tree_palm', palms, blob('#4E7062'), '#55776A');
    placeProp('tree_broad', broad, blob('#41625A'), '#46665C');
    placeProp('bush', bushes, () => ({ geo: (() => { const g = geoCanopy.clone(); g.scale(1.2, .8, 1.2); g.translate(0, .5, 0); return g; })(), mat: std({ color: COL('#4F6E60') }) }), '#4F6E60');
  }
  lap('jungle');

  // ================================================================== 13. rain
  const NRAIN = HI ? 2600 : 1200, rainG = new THREE.BufferGeometry();
  { const P = new Float32Array(NRAIN * 6), SE = new Float32Array(NRAIN * 8), FL = new Float32Array(NRAIN * 4), EN = new Float32Array(NRAIN * 2), RR2 = rng(seed * 4447 + 1);
    for (let q = 0; q < NRAIN; q++) {
      const x = BX0 + RR2() * (BX1 - BX0), z = BZ0 + RR2() * (BZ1 - BZ0), ph = RR2(), sp = 34 + RR2() * 22, tf = thAt(x, z), rf = relAt(x, z);
      for (let e = 0; e < 2; e++) { const o = q * 2 + e; SE.set([x, z, ph, sp], o * 4); FL.set([tf, rf], o * 2); EN[o] = e; }
    }
    rainG.setAttribute('position', new THREE.BufferAttribute(P, 3)); rainG.setAttribute('aSeed', new THREE.BufferAttribute(SE, 4)); rainG.setAttribute('aFl', new THREE.BufferAttribute(FL, 2)); rainG.setAttribute('aEnd', new THREE.BufferAttribute(EN, 1)); }
  const rainMat = own(new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uCol: { value: COL('#C9D3E6') }, uTop: { value: YTOP + 40 } }]),
    vertexShader: `attribute vec4 aSeed; attribute vec2 aFl; attribute float aEnd; uniform float uTime, uCutP, uTop; varying float vA;
      #include <fog_pars_vertex>
      void main(){ float fl = min(aFl.x, max(aFl.y, uCutP)); float span = uTop - fl;
        float y = uTop - mod(aSeed.z * (span + 40.) + uTime * aSeed.w, span + 40.);
        vA = step(fl, y) * (1. - aEnd * .8); float yy = y + aEnd * 5.5;
        vec4 mvPosition = modelViewMatrix * vec4(aSeed.x + (uTop - yy) * .08, yy, aSeed.y, 1.);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform vec3 uCol; varying float vA;
      #include <fog_pars_fragment>
      void main(){ if (vA < .01) discard; gl_FragColor = vec4(uCol, .3 * vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, fog: true,
  }));
  rainMat.uniforms.uTime = U.uTime; rainMat.uniforms.uCutP = U.uCutP;
  const rain = add(new THREE.LineSegments(own(rainG), rainMat)); rain.frustumCulled = false; rain.name = 'rain'; rain.renderOrder = 3;
  lap('rain');

  // soft cloud wisps round the back peaks (one instanced billboard draw)
  const clouds = (() => {
    const RC2 = rng(seed * 811 + 3), list = [];
    for (let q = 0; q < 40 && list.length < (HI ? 16 : 8); q++) { const x = BX0 + 60 + RC2() * (BX1 - BX0 - 120), z = 200 + RC2() * 120, h = thAt(x, Math.min(z, BZ1)); if (h < 60) continue; list.push([x, h * (.7 + RC2() * .35) + 10, z, 50 + RC2() * 60]); }
    const g = new THREE.PlaneGeometry(1, 1), m = own(new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uCol: { value: COL('#8F8CC4') } }]), transparent: true, depthWrite: false, fog: true,
      vertexShader: `varying vec2 vUv; varying float vS;
        #include <fog_pars_vertex>
        void main(){ vUv = uv; vec4 c = modelViewMatrix * instanceMatrix * vec4(0., 0., 0., 1.); float s = length(instanceMatrix[0].xyz); vS = fract(instanceMatrix[3].x * .013);
          vec4 mvPosition = c + vec4(position.x * s * 1.8, position.y * s * .55, 0., 0.); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform vec3 uCol; varying vec2 vUv; varying float vS;
        #include <fog_pars_fragment>
        void main(){ vec2 p = vUv - .5; float r = length(p * vec2(1., 1.6)); float a = smoothstep(.5, .05, r) * (.55 + .45 * sin(vUv.x * 9. + vS * 20.) * sin(vUv.y * 5. + vS * 7.));
          gl_FragColor = vec4(uCol, a * .22);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }` }));
    const im = new THREE.InstancedMesh(own(g), m, Math.max(1, list.length)); im.count = list.length;
    list.forEach(([x, y, z, sc], q) => { M4.makeScale(sc, sc, sc).setPosition(x, y, z); im.setMatrixAt(q, M4); });
    im.frustumCulled = false; im.renderOrder = 4; im.name = 'clouds'; return add(im);
  })();
  void clouds;

  // ================================================================== 14. the people, the air pocket
  const peoplePos = [];
  { const RP = rng(seed * 59 + 13), cx = SH.x - 3, cz = SH.z;
    for (let t = 0; t < 400 && peoplePos.length < 13; t++) {
      const x = cx + (RP() - .5) * 9, z = cz + (RP() - .5) * 12, c = cellOf(x, z);
      if (c < 0 || LG[c] !== 0 || !(FLO[c] > SH.top - 1.5) || peoplePos.some((p) => Math.hypot(p.x - x, p.z - z) < 1.1)) continue;
      peoplePos.push(V3(x, FLO[c], z));
    } }
  const peopleG = new THREE.Group(); peopleG.name = 'people'; peopleG.visible = DBG.people; add(peopleG);
  { const sit = merged([{ geo: new THREE.SphereGeometry(.24, 8, 6), m: new THREE.Matrix4().compose(V3(0, .42, 0), new THREE.Quaternion(), V3(1, 1.45, .8)), c: '#B88F86' }, { geo: new THREE.SphereGeometry(.13, 8, 6), m: new THREE.Matrix4().makeTranslation(0, .86, .02), c: '#E9C2A0' }, { geo: new THREE.SphereGeometry(.16, 7, 5), m: new THREE.Matrix4().compose(V3(0, .2, .26), new THREE.Quaternion(), V3(1.2, .8, 1.6)), c: '#8F7F9A' }]);
    const im = new THREE.InstancedMesh(own(sit), std({ vertexColors: true, emissive: COL('#3A2414') }), peoplePos.length);
    peoplePos.forEach((p, q) => { EE.set(0, Math.atan2(N.P4.x - p.x, N.P4.z - p.z) + (q % 5 - 2) * .4, 0); QQ.setFromEuler(EE); M4.compose(p, QQ, SS.set(1, q === 0 ? 1.25 : 1, 1)); im.setMatrixAt(q, M4); });
    im.castShadow = true; im.computeBoundingSphere(); peopleG.add(im); }
  // the air pocket: the last chamber's air above the water (sealed when the water rises to the low passage's roof)
  const PK = { x: S1.x, z: S1.z, r: S1.w / 2 + 8, level: basins[3].level };
  let pkVol = 0, pkTop = -1e9, pkMin = V3(1e9, 1e9, 1e9), pkMax = V3(-1e9, -1e9, -1e9);
  run(() => { for (let k = 0; k < GNZ; k++) for (let i = 0; i < GNX; i++) {
    const x = GX0 + i * VX, z = GZ0 + k * VX; if (Math.hypot(x - PK.x, z - PK.z) > PK.r) continue;
    for (let j = 0; j < GNY; j++) { const y = GY0 + j * VX; if (y <= PK.level || G[i + j * SYS + k * SZS] >= 0) continue; pkVol += VX * VX * VX; pkTop = Math.max(pkTop, y); pkMin.min(V3(x, y, z)); pkMax.max(V3(x, y, z)); }
  } });
  let sealY = 1e9; segs.forEach((S, si) => { if (!((S.a === 'P3' && S.b === 'P4') || (S.a === 'P4' && S.b === 'S1'))) return; for (let s = S.i0; s < S.i1; s++) { const c = cellOf(SX[s], SZ[s]); if (c >= 0 && Number.isFinite(WAT[c]) && Number.isFinite(CEI[c]) && Math.hypot(SX[s] - PK.x, SZ[s] - PK.z) > S1.w / 2 - 2) sealY = Math.min(sealY, CEI[c]); } void si; });
  // outline (lavender): the waterline of the chamber and a vertical section of its air, as line segments
  const pocketLines = [];
  { const shore = water.geometry.userData.shore; for (let q = 0; q < shore.length; q += 6) if (Math.hypot(shore[q] - PK.x, shore[q + 2] - PK.z) < PK.r - 4) pocketLines.push(shore[q], shore[q + 1] + .05, shore[q + 2], shore[q + 3], shore[q + 4] + .05, shore[q + 5]);
    const kz = Math.round((S1.z - GZ0) / VX), ia = Math.max(0, Math.round((PK.x - PK.r - GX0) / VX)), ib = Math.min(GNX - 2, Math.round((PK.x + PK.r - GX0) / VX)), zc = GZ0 + kz * VX;
    const f = (i, j) => { const y = GY0 + j * VX; return Math.max(G[i + j * SYS + kz * SZS], PK.level - y); };
    for (let j = 0; j < GNY - 1; j++) for (let i = ia; i < ib; i++) {
      const F4 = [f(i, j), f(i + 1, j), f(i + 1, j + 1), f(i, j + 1)], X4 = [0, 1, 1, 0], Y4 = [0, 0, 1, 1], e = [];
      for (let q = 0; q < 4; q++) { const a = F4[q], b = F4[(q + 1) & 3]; if ((a < 0) !== (b < 0)) { const t = a / (a - b); e.push(GX0 + (i + X4[q] + (X4[(q + 1) & 3] - X4[q]) * t) * VX, GY0 + (j + Y4[q] + (Y4[(q + 1) & 3] - Y4[q]) * t) * VX); } }
      if (e.length === 4) pocketLines.push(e[0], e[1], zc, e[2], e[3], zc);
    } }
  const pocketObj = new THREE.LineSegments(own(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pocketLines, 3))), own(new THREE.LineBasicMaterial({ color: COL('#B9A6F2'), transparent: true, opacity: .95, depthTest: false })));
  pocketObj.name = 'pocket-outline'; pocketObj.visible = DBG.people; pocketObj.renderOrder = 6; add(pocketObj);
  lap('people');

  // ================================================================== 15. anchors
  const cellFly = (x, z) => { const c = cellOf(x, z); return c >= 0 && Number.isFinite(FLY[c]) ? FLY[c] : null; };
  const nodeFly = (k) => { const n = N[k], y = cellFly(n.x, n.z); return V3(n.x, y ?? n.f + 2, n.z); };
  // distance along passages from the mouth (Dijkstra over the node graph)
  const adj = {}; segs.forEach((S) => { (adj[S.a] = adj[S.a] || []).push([S.b, S.len]); (adj[S.b] = adj[S.b] || []).push([S.a, S.len]); });
  const dist = { E0o: 0 }, todo = new Set(Object.keys(N));
  while (todo.size) { let best = null; for (const k of todo) if (dist[k] != null && (best == null || dist[k] < dist[best])) best = k; if (best == null) break; todo.delete(best); for (const [b, l] of adj[best] || []) if (dist[b] == null || dist[best] + l < dist[b]) dist[b] = dist[best] + l; }
  const juncKeys = Object.keys(N).filter((k) => N[k].deg >= 3).sort((a, b) => dist[a] - dist[b]);
  const junctions = juncKeys.map((k, q) => ({ name: `junction ${q + 1}`, node: k, pos: nodeFly(k), branches: N[k].deg, cell: cellOf(N[k].x, N[k].z), along: Math.round(dist[k]) }));
  const deadKeys = Object.keys(N).filter((k) => N[k].deg === 1 && k !== 'E0o').sort((a, b) => dist[a] - dist[b]);
  // sumps: groups of flooded-to-the-roof cells; one anchor per mouth (where a drone has to stop)
  const sumps = [];
  { const comp = new Int32Array(LN).fill(-1); let nc = 0;
    for (let c0 = 0; c0 < LN; c0++) {
      if (!SUMP[c0] || comp[c0] >= 0) continue;
      const cells = [c0]; comp[c0] = nc;
      for (let h = 0; h < cells.length; h++) { const c = cells[h], i = c % LNX; for (const n of [i > 0 ? c - 1 : -1, i < LNX - 1 ? c + 1 : -1, c - LNX, c + LNX]) if (n >= 0 && n < LN && SUMP[n] && comp[n] < 0) { comp[n] = nc; cells.push(n); } }
      if (cells.length < 10) { nc++; continue; }
      const mouths = cells.filter((c) => { const i = c % LNX; return [i > 0 ? c - 1 : -1, i < LNX - 1 ? c + 1 : -1, c - LNX, c + LNX].some((n) => n >= 0 && n < LN && REACH[n] && LG[n] !== 1 && LG[n] !== 2); });
      const used = new Uint8Array(mouths.length);
      for (let m = 0; m < mouths.length; m++) {
        if (used[m]) continue; const grp = [mouths[m]]; used[m] = 1;
        for (let h = 0; h < grp.length; h++) for (let q = 0; q < mouths.length; q++) if (!used[q] && Math.abs(cX(mouths[q]) - cX(grp[h])) <= 6 && Math.abs(cZ(mouths[q]) - cZ(grp[h])) <= 6) { used[q] = 1; grp.push(mouths[q]); }
        let sx = 0, sz = 0; for (const c of grp) { sx += cX(c); sz += cZ(c); }
        const x = sx / grp.length, z = sz / grp.length, c = grp[0];
        sumps.push({ pos: V3(x, WAT[c], z), level: WAT[c], cells: grp.length, zone: nc, zoneCells: cells.length, label: 'divers only', kind: 'sump' });
      }
      nc++;
    }
    sumps.sort((a, b) => a.pos.x - b.pos.x).forEach((s, q) => { s.name = `sump ${q + 1}`; }); }
  const polyline = (keys, yFn) => { const pts = []; for (let q = 0; q < keys.length - 1; q++) { const si = segs.findIndex((S) => (S.a === keys[q] && S.b === keys[q + 1]) || (S.b === keys[q] && S.a === keys[q + 1])); if (si < 0) continue; const S = segs[si], fwd = S.a === keys[q], ids = []; for (let s = S.i0; s < S.i1; s += 3) ids.push(s); if (!fwd) ids.reverse(); for (const s of ids) pts.push(V3(SX[s], yFn(s), SZ[s])); } return pts; };
  const flyS = (s) => cellFly(SX[s], SZ[s]) ?? SY[s];
  const ROUTE = ['E0o', 'E0', 'E1', 'A', 'AB', 'B', 'BC', 'C', 'CD', 'D', 'P1', 'P2', 'P3', 'P4', 'S1'];
  const route = polyline(ROUTE, flyS), flooded = polyline(['D', 'F1', 'F2', 'F3', 'S1'], (s) => SY[s]);
  const SEGNAME = { 'E0o-E0': 'the mouth', 'E0-E1': 'the mouth', 'E1-A': 'the entrance passage', 'A-AB': 'the first dip', 'AB-B': 'the first dip', 'B-BC': 'the trunk', 'BC-C': 'the trunk', 'C-CD': 'the trunk', 'CD-D': 'the trunk',
    'D-F1': 'the flooded trunk', 'F1-F2': 'the flooded trunk', 'F2-F3': 'the flooded trunk', 'F3-S1': 'the flooded trunk', 'D-P1': 'the dry bypass', 'P1-P2': 'the dry bypass', 'P2-P3': 'the dry bypass', 'P3-P4': 'the low passage', 'P4-S1': 'the low passage',
    'A-A1': 'the north gallery', 'A1-A2': 'the north gallery', 'B-B1': 'the front branch', 'B1-B2': 'the front branch', 'C-C1': 'the side passage', 'C1-C2': 'the side passage', 'C-K1': 'the south gallery', 'K1-K2': 'the south gallery', 'P2-Q1': 'the high gallery', 'Q1-Q2': 'the high gallery', 'P3-R1': 'the choke' };
  let totalLen = 0; const passages = segs.map((S) => { totalLen += S.len; S.name = SEGNAME[S.a + '-' + S.b] || 'a passage'; const pts = []; for (let s = S.i0; s < S.i1; s += 4) pts.push(V3(SX[s], flyS(s), SZ[s])); return { name: S.name, from: S.a, to: S.b, length: Math.round(S.len), points: pts }; });
  let routeLen = 0; for (let q = 1; q < route.length; q++) routeLen += route[q].distanceTo(route[q - 1]);
  const shelfPos = peoplePos.length ? peoplePos.reduce((a, p) => a.add(p), V3(0, 0, 0)).multiplyScalar(1 / peoplePos.length) : V3(SH.x, SH.top, SH.z);
  const pocket = { name: 'the air pocket', center: V3(PK.x, (PK.level + pkTop) / 2, PK.z), box: new THREE.Box3(pkMin, pkMax), volume: Math.round(pkVol), waterY: PK.level, sealY: Math.round(sealY * 10) / 10, sealRise: Math.round((sealY - PK.level) * 10) / 10, lines: new Float32Array(pocketLines), people: peoplePos.length };
  const lights = [
    { name: 'tether lamp', kind: 'tether', pos: HOVER.clone(), dir: V3(1, -.3, .05).normalize(), color: '#FFE6C8', range: 70 },
    { name: 'staging lamp 1', kind: 'staging', pos: V3(portalX - 12, Hf(portalX - 12, N.E0.z - 22) + 7.1, N.E0.z - 22), dir: V3(.8, -.3, .5).normalize(), color: '#FFE6C8', range: 40 },
    { name: 'staging lamp 2', kind: 'staging', pos: V3(portalX - 13, Hf(portalX - 13, N.E0.z + 16) + 7.1, N.E0.z + 16), dir: V3(.8, -.3, -.5).normalize(), color: '#FFE6C8', range: 40 },
    ...junctions.map((J) => ({ name: J.name, kind: 'junction', pos: J.pos.clone().add(V3(0, 1.5, 0)), color: '#9FE3DD', range: 26 })),
    ...Object.keys(N).filter((k) => N[k].ch).map((k) => ({ name: k === 'S1' ? 'the shelf' : k === 'E1' ? 'the entrance hall' : k === 'C' ? 'chamber 3' : 'a chamber', kind: 'chamber', pos: V3(N[k].x, Math.min(N[k].c - 3, (cellFly(N[k].x, N[k].z) ?? N[k].f) + 4), N[k].z), color: '#DCE4EE', range: N[k].w * 1.1 })),
  ];
  const pois = { 'the entrance': V3(portalX + 2, 6, N.E0.z), 'the staging area': BASE.clone(), 'the entrance hall': nodeFly('E1'), 'chamber 3': nodeFly('C'), 'the dry bypass': nodeFly('P1'), 'the low passage': nodeFly('P4'), 'the shelf': shelfPos.clone(), 'the air pocket': pocket.center.clone(), 'the flooded trunk': V3(N.F2.x, basins[3].level, N.F2.z) };
  junctions.forEach((J) => { pois[J.name] = J.pos.clone(); });
  sumps.forEach((S) => { pois[S.name] = S.pos.clone(); });
  const deadEnds = deadKeys.map((k, q) => { const p = nodeFly(k), d = { name: `dead end ${q + 1}`, node: k, pos: p, kind: k === 'B2' ? 'sump' : 'dry', along: Math.round(dist[k]) }; pois[d.name] = p.clone(); return d; });
  const people = peoplePos.map((p, q) => ({ pos: p.clone(), layer: 'cave', hidden: true, count: 1, note: q === 0 ? 'the coach' : '' }));
  const anchors = {
    base: BASE, tether: { station: STATION, hover: HOVER, cable: Math.round(STATION.distanceTo(HOVER) * 1.3) },
    ugvRoutes: [], boats: [], decoys: [], people, pocket, pois, junctions, sumps, deadEnds, lights, passages, route, flooded,
    entrance: V3(portalX + 2, 1, N.E0.z), shelf: { pos: shelfPos.clone(), top: SH.top, aboveWater: Math.round((SH.top - PK.level) * 10) / 10 },
    water: basins.filter((B) => B.voxels).map((B) => ({ name: B.name, level: B.level, pos: V3(B.x, B.level, B.z) })),
    lengths: { total: Math.round(totalLen), route: Math.round(routeLen), shelf: Math.round(dist.S1) },
  };

  // ================================================================== 16. cameras, sky, bounds
  const Cn = N.C, Pn = N.P2;
  const camera = {
    wide: { pos: V3(-250, 450, -640), target: V3(30, -20, 40), cut: 1 , radius: 430 },
    top: { pos: V3(20, 980, -30), target: V3(20, 0, 10), cut: 1 , radius: 450 },
    section: { pos: V3(40, 270, -560), target: V3(40, -10, 20), cut: 1 , radius: 380 },
    mountain: { pos: V3(-780, 330, -620), target: V3(-60, 40, 50), cut: 0 , radius: 470 },
    entrance: { pos: V3(portalX - 110, 46, N.E0.z - 92), target: V3(portalX + 12, 6, N.E0.z + 4), cut: 1 , radius: 90 },
    junction: { pos: V3(Cn.x - 60, 90, Cn.z - 120), target: V3(Cn.x, 2, Cn.z), cut: 1 , radius: 70 },
    bypass: { pos: V3(Pn.x - 70, 110, Pn.z - 150), target: V3(Pn.x, 8, Pn.z - 10), cut: 1 , radius: 90 },
    shelf: { pos: V3(shelfPos.x - 46, 40, shelfPos.z - 58), target: V3(shelfPos.x - 6, shelfPos.y - 1, shelfPos.z), cut: 1 , radius: 40 },
    sump: sumps.length ? { pos: V3(sumps[0].pos.x - 50, 70, sumps[0].pos.z - 90), target: sumps[0].pos.clone(), cut: 1, radius: 60 } : undefined,
    inside: { pos: V3(N.E1.x - 34, 7, N.E1.z - 2), target: V3(N.A.x, 4, N.A.z), cut: 0 , radius: 40 },
  };
  if (!camera.sump) delete camera.sump;
  const sky = {
    top: '#1A1C3A', horizon: '#34376B', fog: '#30336A', fogDensity: .00048,
    sun: { dir: V3(-.55, .8, -.3).normalize(), color: '#DCCBEA', intensity: 1.35 },
    hemi: { sky: '#8E8AC8', ground: '#2C2F5C', intensity: .62 },
    shadow: { bias: -.0004, normalBias: .6 },                                // metres-scale world: the sun needs a normal bias
  };
  const bounds = new THREE.Box3(V3(BX0, BOT - 8, BZ0), V3(BX1, YTOP + 10, BZ1));

  // ================================================================== 17. debug light rig (lights=1): lamps in the cave
  if (DBG.lights) {
    const rig = new THREE.Group(); rig.name = 'debug-lights';
    for (const L of lights) {
      if (L.kind === 'staging') continue;
      const pl = new THREE.PointLight(COL(L.color), L.kind === 'tether' ? 700 : L.kind === 'chamber' ? 450 : 220, L.range * 1.6, 1.6); pl.position.copy(L.pos); rig.add(pl);
    }
    add(rig);
  }

  if (DBG.cells) {                                         // debug: every cell of the search layer at its own height
    const list = []; for (let c = 0; c < LN; c++) { const t = LG[c]; if (t === 0 || t === 3 || SUMP[c]) list.push(c); }
    const im = new THREE.InstancedMesh(own(new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2)), own(new THREE.MeshBasicMaterial({ transparent: true, opacity: .8, depthWrite: false })), list.length);
    const C0 = COL('#7FD4CF'), C3 = COL('#8FB7D0'), CS = COL('#F08A7E'), CA = COL('#F6D2B1');
    list.forEach((c, q) => { const y = (Number.isFinite(WAT[c]) ? Math.max(WAT[c], FLO[c]) : FLO[c]) + .3; M4.makeTranslation(cX(c), y, cZ(c)); im.setMatrixAt(q, M4); im.setColorAt(q, SUMP[c] ? CS : LG[c] === 3 ? C3 : cX(c) < portalX ? CA : C0); });
    im.renderOrder = 5; im.name = 'debug-cells'; add(im);
  }
  if (DBG.bias) {                                          // debug viewers without a shadow bias: borrow ours
    let fixed = false; const hook = new THREE.Mesh(own(new THREE.BufferGeometry()), own(new THREE.MeshBasicMaterial())); hook.frustumCulled = false; hook.name = 'debug-bias';
    hook.onBeforeRender = (r, scene) => { if (fixed) return; fixed = true; scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) { o.shadow.bias = sky.shadow.bias; o.shadow.normalBias = sky.shadow.normalBias; } }); };
    add(hook);
  }

  // ================================================================== 18. the API
  let cutLevel = 1;
  function cutaway(level) {
    if (level && typeof level === 'object') { if (Number.isFinite(level.y)) { U.uCutP.value = level.y; cutLevel = .5; caveRoof.visible = stalIM.visible = terrInner.visible = true; cap.visible = true; for (const o of treesInner) o.visible = true; } return cutLevel; }
    cutLevel = clamp(+level || 0, 0, 1);
    U.uCutP.value = cutLevel <= 0 ? 1e4 : cutLevel >= 1 ? -999 : cutLevel <= .6 ? lerp(YTOP + 2, REL_HI, cutLevel / .6) : lerp(REL_HI, relMin - 1, (cutLevel - .6) / .4);
    caveRoof.visible = stalIM.visible = terrInner.visible = cutLevel < 1; cap.visible = cutLevel > 0;
    for (const o of treesInner) o.visible = cutLevel < .6;
    return cutLevel;
  }
  function setWaterRise(dy) {
    dy = Math.max(0, +dy || 0); if (Math.abs(dy - waterRise) < .05) return; waterRise = dy;
    const old = water.geometry; water.geometry = waterGeo(dy); old.dispose(); writeWat(dy); watTex.needsUpdate = true;
  }
  cutaway(1);
  if (typeof globalThis !== 'undefined' && qs.get('cut') != null) cutaway(+qs.get('cut'));
  // runtime cap for local clipping is not needed (the cut is done in the shaders)
  let tris = 0, calls = 0;
  group.traverse((o) => { if (!o.isMesh && !o.isLineSegments) return; calls++; if (!o.isMesh) return; const g = o.geometry, n = g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0; tris += (n / 3) * (o.isInstancedMesh ? o.count : 1); });
  lap('done');
  const stats = { buildMs: Math.round(clock() - T0), timing, tris: Math.round(tris), meshes: calls, voxels: NT, isoVerts: VP.length / 3, isoTris: (IB.length + IR.length + IT.length) / 3, below: IB.length / 3, roof: IR.length / 3, trees: trees.length, stal: stal.length, mite: mite.length, rocks: rocks.length,
    searchable: LG.reduce((a, v) => a + (v === 0 || v === 3 ? 1 : 0), 0), water: LG.reduce((a, v) => a + (v === 3 ? 1 : 0), 0), sumpCells: SUMP.reduce((a, v) => a + v, 0), unreachable: unreach, steps, lengths: anchors.lengths, pocket: { volume: pocket.volume, sealRise: pocket.sealRise }, shelfReachable: peoplePos.length ? !!REACH[cellOf(peoplePos[0].x, peoplePos[0].z)] : false };
  if (DBG.log) console.log('[cave] world', JSON.stringify(stats));
  // free the build-time fields that nobody needs any more (keep the 8-bit field for los/isAir)
  const sdfLookup = (x, y, z) => { const fx = (x - GX0) / VX, fy = (y - GY0) / VX, fz = (z - GZ0) / VX; if (fx < 0 || fy < 0 || fz < 0 || fx > GNX - 1.001 || fy > GNY - 1.001 || fz > GNZ - 1.001) return y > thAt(x, z) ? -5 : 5;
    const i = fx | 0, j = fy | 0, k = fz | 0, tx = fx - i, ty = fy - j, tz = fz - k, o = i + j * SYS + k * SZS, s = (q) => (SDF8[q] - 128) / 24;
    const c00 = s(o) + (s(o + 1) - s(o)) * tx, c10 = s(o + SYS) + (s(o + SYS + 1) - s(o + SYS)) * tx, c01 = s(o + SZS) + (s(o + SZS + 1) - s(o + SZS)) * tx, c11 = s(o + SYS + SZS) + (s(o + SYS + SZS + 1) - s(o + SYS + SZS)) * tx;
    return (c00 + (c10 - c00) * ty) * (1 - tz) + (c01 + (c11 - c01) * ty) * tz; };

  // ================================================================== 19. world space: the model is built mirrored, the group un-mirrors it
  // (scale.z = -1, so the entrance is on the left seen from the front); everything exported below is in world space
  group.scale.set(1, 1, -1); group.updateMatrixWorld(true);
  const flipAll = (o, seen = new Set()) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return; seen.add(o);
    if (o.isVector3) { o.z = -o.z; return; }
    if (o.isBox3) { const a = -o.max.z, b = -o.min.z; o.min.z = a; o.max.z = b; return; }
    if (o instanceof Float32Array) { for (let q = 2; q < o.length; q += 3) o[q] = -o[q]; return; }
    if (ArrayBuffer.isView(o) || typeof o === 'function') return;
    for (const k in o) flipAll(o[k], seen);
  };
  flipAll(anchors); flipAll(camera); flipAll(bounds); flipAll(sky);
  const flipRows = (A) => { const B = new A.constructor(A.length); for (let k = 0; k < LNZ; k++) B.set(A.subarray(k * LNX, (k + 1) * LNX), (LNZ - 1 - k) * LNX); return B; };
  const layerW = { ...caveLayer, z0: -(LZ0 + LNZ * VX), grid: flipRows(LG), floorY: flipRows(FLO), ceilY: flipRows(CEI), waterY: flipRows(WAT), flyY: flipRows(FLY), sump: flipRows(SUMP) };
  stats.lengths = anchors.lengths;
  for (const J of anchors.junctions) if (J.cell >= 0) J.cell = (LNZ - 1 - ((J.cell / LNX) | 0)) * LNX + (J.cell % LNX);

  // relay hints: walking the route from the mouth, where a new beacon is needed to keep line of sight (and < 60 m)
  const losW = (a, b) => { const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.max(2, Math.ceil(d / .9)); for (let q = 1; q < n; q++) { const t = q / n; if (sdfLookup(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, -(a.z + (b.z - a.z) * t)) > .25) return false; } return true; };
  anchors.relayHints = [];
  { let last = anchors.tether.hover, prev = null; for (const p of anchors.route) { if (prev && (!losW(last, p) || last.distanceTo(p) > 60)) { anchors.relayHints.push(prev.clone()); last = prev; } prev = p; } }

  return {
    group, sky, layers: [layerW], surfaces: [caveBelow, water], anchors, bounds, camera, stats,
    objects: { people: peopleG, pocket: pocketObj, roof: caveRoof, section: cap, water, rain, stalactites: stalIM },
    cutaway, get cut() { return cutLevel; }, setWaterRise, get waterRise() { return waterRise; },
    // helpers in world coordinates: hover height, floor (or water) height, rock test, radio line of sight through air
    flyAt: (x, z) => flyAt(x, -z),
    floorAt: (x, z) => { const c = cellOf(x, -z); return c >= 0 && Number.isFinite(FLO[c]) ? Math.max(FLO[c], Number.isFinite(WAT[c]) ? WAT[c] + waterRise : -1e9) : thAt(x, -z); },
    isAir: (x, y, z) => sdfLookup(x, y, -z) < 0,
    los: losW,
    update(t) {
      U.uTime.value = t;
      normTex.offset.set((t * .011) % 1, (t * .007) % 1);
    },
    dispose() {
      group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.userData && o.userData.shared) return; if (o.geometry && !owned.includes(o.geometry)) o.geometry.dispose(); });
      for (const x of owned) if (x && x.dispose) x.dispose();
      relTex.dispose(); sdfTex.dispose(); watTex.dispose(); water.geometry.dispose();
      if (group.parent) group.parent.remove(group);
    },
  };
}

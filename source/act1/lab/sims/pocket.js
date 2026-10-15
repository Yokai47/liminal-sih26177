// Finding the air pocket (β₂ and cubical homology on the voxel map).
// The world is a voxel grid (OctoMap-like, 25 cm voxels). The drones' map starts all unknown; every scan step each drone
// casts rays (3-D DDA through the voxels): voxels a ray passes through are marked free, the voxel it hits is marked
// occupied. Rays never pass through rubble, so a sealed void is never seen: it stays unknown. Topology of the map, by
// union-find over the voxels (6-connected faces, the cubical complex of the map):
//   β₂ = enclosed pockets: components of the non-occupied voxels (free ∪ unknown) that do not reach the open sides or the
//        top of the grid, i.e. completely wrapped in voxels the swarm has SEEN to be occupied. Components smaller than
//        0.2 m³ are ignored (rubble interiors and cracks: too small for a person), the persistence filter of the briefing.
//   β₀ = unexplored pieces: connected pieces of unknown voxels that are still open to the outside, i.e. places a drone
//        could still go and look (same 0.2 m³ floor: smaller crumbs left between rays cannot hide a person). When β₀ = 0
//        nothing left unseen could hide a person, except what is sealed inside the rubble: the search is complete.
// The generator builds a pile of slabs, beams and rubble with 1-3 sealed pockets and 1-2 open voids, then checks the
// result: the voids a full scan would find enclosed are exactly the designed pockets (else it tries another seed).

export const G = { NX: 28, NY: 28, NZ: 18, VOX: .25 };
const { NX, NY, NZ } = G, N = NX * NY * NZ, NXY = NX * NY;
export const VMIN = 13;                                            // voxels: 13 × (0.25 m)³ ≈ 0.2 m³
export const idx = (x, y, z) => x + NX * (y + NY * z);

// ------------------------------------------------------------------ the pure core: truth, map, rays, topology (no DOM)
export function pocketCore() {
  const truth = new Uint8Array(N);                                 // 0 air, 1 slab, 2 debris, 3 beam
  const map = new Uint8Array(N);                                   // 0 unknown, 1 free, 2 occupied
  const X = new Uint8Array(N), Y = new Uint8Array(N), Z = new Uint8Array(N), side = new Uint8Array(N);
  for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const i = idx(x, y, z); X[i] = x; Y[i] = y; Z[i] = z; side[i] = (x === 0 || y === 0 || x === NX - 1 || y === NY - 1 || z === NZ - 1) ? 1 : 0;
  }
  const NB = [1, -1, NX, -NX, NXY, -NXY];
  const nb = (i, k) => {                                           // face neighbour k of voxel i, or -1 outside the grid (z < 0 is the ground)
    switch (k) {
      case 0: return X[i] < NX - 1 ? i + 1 : -1; case 1: return X[i] > 0 ? i - 1 : -1;
      case 2: return Y[i] < NY - 1 ? i + NX : -1; case 3: return Y[i] > 0 ? i - NX : -1;
      case 4: return Z[i] < NZ - 1 ? i + NXY : -1; default: return Z[i] > 0 ? i - NXY : -1;
    }
  };

  // ---- union-find labelling: A = non-occupied voxels of a state array (6-connected), U = unknown voxels
  const pa = new Int32Array(N), pu = new Int32Array(N), q = new Int32Array(N);
  const find = (p, i) => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
  const unite = (p, a, b) => { a = find(p, a); b = find(p, b); if (a !== b) { if (a < b) p[b] = a; else p[a] = b; } };
  const open = new Uint8Array(N), cntU = new Int32Array(N), cntF = new Int32Array(N), cntP = new Int32Array(N);
  // st: the map (0 unknown, 1 free, 2 occupied). Returns { b0, b2, pockets: [{ root, n, cx, cy, cz }], small, unknown, known }
  function analyse(st = map) {
    for (let i = 0; i < N; i++) {
      if (st[i] === 2) { pa[i] = -1; pu[i] = -1; continue; }
      pa[i] = i; pu[i] = st[i] === 0 ? i : -1;
      const x = X[i], y = Y[i], z = Z[i];
      if (x > 0 && st[i - 1] !== 2) { unite(pa, i, i - 1); if (pu[i] >= 0 && st[i - 1] === 0) unite(pu, i, i - 1); }
      if (y > 0 && st[i - NX] !== 2) { unite(pa, i, i - NX); if (pu[i] >= 0 && st[i - NX] === 0) unite(pu, i, i - NX); }
      if (z > 0 && st[i - NXY] !== 2) { unite(pa, i, i - NXY); if (pu[i] >= 0 && st[i - NXY] === 0) unite(pu, i, i - NXY); }
    }
    open.fill(0); cntU.fill(0); cntF.fill(0); cntP.fill(0);
    let unknown = 0;
    for (let i = 0; i < N; i++) {
      if (pa[i] < 0) continue;
      const r = find(pa, i); if (side[i]) open[r] = 1;
      if (st[i] === 0) { cntU[r]++; unknown++; cntP[find(pu, i)]++; } else cntF[r]++;
    }
    // β₂: enclosed components (big enough); β₀: pieces of unknown voxels inside open components
    const pockets = []; let small = 0, b0 = 0, crumbs = 0;
    for (let i = 0; i < N; i++) {
      if (pa[i] < 0) continue;
      if (pa[i] === i && !open[i]) { if (cntU[i] + cntF[i] >= VMIN) pockets.push({ root: i, n: cntU[i] + cntF[i], free: cntF[i], cx: 0, cy: 0, cz: 0, lo: 99, hi: -1 }); else small++; }
      if (st[i] === 0 && pu[i] === i && open[find(pa, i)]) { if (cntP[i] >= VMIN) b0++; else crumbs++; }
    }
    if (pockets.length) {
      const at = new Map(pockets.map((p, k) => [p.root, k]));
      for (let i = 0; i < N; i++) {
        if (pa[i] < 0) continue; const k = at.get(find(pa, i)); if (k === undefined) continue;
        const p = pockets[k]; p.cx += X[i] + .5; p.cy += Y[i] + .5; p.cz += Z[i] + .5; if (Z[i] < p.lo) p.lo = Z[i]; if (Z[i] > p.hi) p.hi = Z[i];
      }
      for (const p of pockets) { p.cx /= p.n; p.cy /= p.n; p.cz /= p.n; }
    }
    return { b0, b2: pockets.length, pockets, small, crumbs, unknown, known: N - unknown };
  }
  const rootOf = (i) => (pa[i] < 0 ? -1 : find(pa, i));            // after analyse(): the component of voxel i

  // ---- rays: Amanatides & Woo through the voxels from (ox, oy, oz) (voxel units) along a unit direction, up to range R.
  // Marks free / occupied in the map from the truth; returns the hit voxel (or -1) and the end point in rayEnd.
  const rayEnd = new Float64Array(3); let changed = 0;
  function cast(ox, oy, oz, dx, dy, dz, R) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) return -1;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(1 / (dx || 1e-12)), tdy = Math.abs(1 / (dy || 1e-12)), tdz = Math.abs(1 / (dz || 1e-12));
    let tx = (dx > 0 ? x + 1 - ox : ox - x) * tdx, ty = (dy > 0 ? y + 1 - oy : oy - y) * tdy, tz = (dz > 0 ? z + 1 - oz : oz - z) * tdz, t = 0;
    for (let s = 0; s < 64; s++) {
      const i = idx(x, y, z);
      if (truth[i]) { if (map[i] !== 2) { map[i] = 2; changed++; } rayEnd[0] = ox + dx * t; rayEnd[1] = oy + dy * t; rayEnd[2] = oz + dz * t; return i; }
      if (map[i] !== 1) { map[i] = 1; changed++; }
      if (tx < ty && tx < tz) { t = tx; tx += tdx; x += sx; } else if (ty < tz) { t = ty; ty += tdy; y += sy; } else { t = tz; tz += tdz; z += sz; }
      if (t > R || x < 0 || y < 0 || x >= NX || y >= NY || z >= NZ) break;
      if (z < 0) { rayEnd[0] = ox + dx * t; rayEnd[1] = oy + dy * t; rayEnd[2] = 0; return -2; }   // the ground
    }
    const tt = Math.min(t, R); rayEnd[0] = ox + dx * tt; rayEnd[1] = oy + dy * tt; rayEnd[2] = oz + dz * tt; return -1;
  }

  // ---- what a complete scan can know: outside air (6-connected to the open sides / top) and every rubble voxel with a
  // face on it. Everything else stays unknown forever. Used to check a generated pile, and by the tests.
  const fin = new Uint8Array(N);
  function finalMap() {
    fin.fill(0);
    let h = 0, t = 0;
    for (let i = 0; i < N; i++) if (side[i] && !truth[i]) { fin[i] = 1; q[t++] = i; }
    while (h < t) { const i = q[h++]; for (let k = 0; k < 6; k++) { const j = nb(i, k); if (j >= 0 && !truth[j] && fin[j] !== 1) { fin[j] = 1; q[t++] = j; } } }
    for (let i = 0; i < N; i++) if (truth[i]) for (let k = 0; k < 6; k++) { const j = nb(i, k); if (j >= 0 && fin[j] === 1 && !truth[j]) { fin[i] = 2; break; } }
    return fin;
  }

  // ---- the rubble pile
  function generate(seed) {
    let s = seed >>> 0;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    truth.fill(0);
    const inb = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < NX && y < NY && z < NZ;
    const put = (x, y, z, m) => { if (inb(x, y, z)) truth[idx(x, y, z)] = m; };
    const cx = 13.5 + (rnd() - .5) * 2, cy = 13.5 + (rnd() - .5) * 2;
    const top = (x, y) => { for (let z = NZ - 1; z >= 0; z--) if (truth[idx(x, y, z)]) return z; return -1; };
    // a low mound of ground rubble
    for (let y = 3; y < NY - 3; y++) for (let x = 3; x < NX - 3; x++) {
      const r = Math.hypot((x + .5 - cx) / 10, (y + .5 - cy) / 9);
      if (r < 1 && rnd() < .55 * (1 - r)) { const hgt = rnd() < .35 * (1 - r) ? 2 : 1; for (let z = 0; z < hgt; z++) put(x, y, z, 2); }
    }
    // pancaked floor slabs, tilted, cracked, propped up on debris
    const nS = 3 + (rnd() < .45 ? 1 : 0), slabs = [];
    for (let k = 0; k < nS; k++) {
      const w = ri(9, 14), d = ri(8, 12), x0 = Math.round(cx - w / 2 + (rnd() - .5) * 5), y0 = Math.round(cy - d / 2 + (rnd() - .5) * 5);
      const h = 2.3 + k * 2.6 + rnd() * .8, tx = (rnd() - .5) * .34, ty = (rnd() - .5) * .34;
      const ca = rnd() * Math.PI, cn = [Math.cos(ca), Math.sin(ca)], cc = rnd() < .6 ? (rnd() - .5) * 4 : 99, drop = 1 + (rnd() < .4 ? 1 : 0);
      for (let y = y0; y < y0 + d; y++) for (let x = x0; x < x0 + w; x++) {
        const edge = Math.min(x - x0, x0 + w - 1 - x, y - y0, y0 + d - 1 - y);
        if (edge === 0 && rnd() < .35) continue;                   // ragged edges
        if (rnd() < .03) continue;                                 // small holes
        let z = Math.round(h + (x - x0 - w / 2) * tx + (y - y0 - d / 2) * ty);
        const side2 = (x - cx) * cn[0] + (y - cy) * cn[1] - cc; if (side2 > 0 && side2 < .9) continue;   // the crack
        if (side2 > 0) z -= drop;                                  // the broken half sags
        put(x, y, Math.max(1, z), 1);
      }
      slabs.push({ x0, y0, w, d, h });
      // props: short debris columns under the slab
      for (let p = 0; p < 6; p++) {
        const px = ri(x0 + 1, x0 + w - 2), py = ri(y0 + 1, y0 + d - 2);
        let zt = -1; for (let z = NZ - 1; z >= 1; z--) if (truth[idx(px, py, z)] === 1) { zt = z; break; }
        if (zt < 1) continue;
        for (let z = zt - 1; z >= 0 && !truth[idx(px, py, z)]; z--) { put(px, py, z, 2); if (rnd() < .5) put(px + (rnd() < .5 ? 1 : -1), py, z, 2); }
      }
    }
    // broken beams lying across the pile
    const nB = ri(3, 5);
    for (let k = 0; k < nB; k++) {
      const a = rnd() * Math.PI * 2, L = ri(8, 15), x1 = cx + (rnd() - .5) * 10, y1 = cy + (rnd() - .5) * 10;
      const x2 = x1 + Math.cos(a) * L, y2 = y1 + Math.sin(a) * L;
      const zb = Math.max(top(Math.round(x1), Math.round(y1)), 0) + 1, ze = Math.max(top(Math.round(x2), Math.round(y2)), -1) + 1;
      const n = Math.ceil(L * 1.8);
      let px = -1, py = -1, pz = -1;
      for (let t = 0; t <= n; t++) {                               // a 6-connected line of voxels
        const x = Math.round(x1 + (x2 - x1) * t / n), y = Math.round(y1 + (y2 - y1) * t / n), z = Math.round(zb + (ze - zb) * t / n);
        if (px >= 0) { if (x !== px && y !== py) put(x, py, pz, 3); if ((x !== px || y !== py) && z !== pz) put(x, y, pz, 3); }
        put(x, y, z, 3); px = x; py = y; pz = z;
      }
    }
    // rubble dropped on top: it falls until it rests on something
    for (let k = 0; k < 150; k++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 9, x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r * .9);
      if (x < 2 || y < 2 || x > NX - 3 || y > NY - 3) continue;
      const z = top(x, y) + 1; if (z >= NZ - 3) continue;
      put(x, y, z, 2); if (rnd() < .4) put(x + 1, y, z, 2); if (rnd() < .3) put(x, y + 1, z, 2);
    }
    // the voids: boxes cleared inside the pile with a one-voxel shell of rubble; pockets stay sealed, open voids get a
    // doorway and a tunnel out to the side
    const nP = 1 + (rnd() < .55 ? 1 : 0) + (rnd() < .25 ? 1 : 0), nV = 1 + (rnd() < .4 ? 1 : 0);
    const boxes = [];
    const M = 4, clash = (b) => boxes.some((o) => b.x - M < o.x + o.w && o.x - M < b.x + b.w && b.y - M < o.y + o.d && o.y - M < b.y + b.d && b.z - M < o.z + o.h && o.z - M < b.z + b.h);
    for (let k = 0; k < nP + nV; k++) {
      let b = null;
      for (let t = 0; t < 80 && !b; t++) {
        const w = ri(4, 5), d = ri(3, 4), h = ri(2, 3), x = Math.round(cx + (rnd() - .5) * 10 - w / 2), y = Math.round(cy + (rnd() - .5) * 10 - d / 2), z = ri(0, 5);
        const c = { x, y, z, w, d, h, pocket: k < nP };
        if (x < 4 || y < 4 || x + w > NX - 4 || y + d > NY - 4 || z + h > NZ - 5 || clash(c)) continue;
        b = c;
      }
      if (b) boxes.push(b);
    }
    for (const b of boxes) {
      for (let z = b.z - 1; z <= b.z + b.h; z++) for (let y = b.y - 1; y <= b.y + b.d; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
        const inside = x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.d && z >= b.z && z < b.z + b.h;
        if (!inb(x, y, z)) continue;
        if (inside) truth[idx(x, y, z)] = 0; else if (!truth[idx(x, y, z)]) truth[idx(x, y, z)] = z === b.z + b.h ? 1 : 2;
      }
    }
    // pocket shells are protected: a tunnel must never cut into one
    const guard = (x, y, z) => boxes.some((o) => o.pocket && x >= o.x - 1 && x <= o.x + o.w && y >= o.y - 1 && y <= o.y + o.d && z >= o.z - 1 && z <= o.z + o.h);
    for (const b of boxes) {
      if (b.pocket) continue;
      // doorway on the side facing away from the centre, then a tunnel straight out
      const mx = b.x + b.w / 2 - cx, my = b.y + b.d / 2 - cy, ax = Math.abs(mx) > Math.abs(my);
      const dir = ax ? (mx > 0 ? 1 : -1) : (my > 0 ? 1 : -1);
      for (let dz = 0; dz < Math.min(2, b.h); dz++) for (let dw = 0; dw < 2; dw++) {
        let x = ax ? (dir > 0 ? b.x + b.w : b.x - 1) : b.x + 1 + dw, y = ax ? b.y + 1 + dw : (dir > 0 ? b.y + b.d : b.y - 1);
        const z = b.z + dz;
        for (let s2 = 0; s2 < 16; s2++) {
          if (!inb(x, y, z) || guard(x, y, z)) break;
          truth[idx(x, y, z)] = 0;
          if (ax) x += dir; else y += dir;
        }
      }
    }
    // nothing floats in the top rows (the drones' ceiling)
    for (let i = idx(0, 0, NZ - 3); i < N; i++) truth[i] = 0;
    return boxes;
  }

  // a full scan of this pile would find enclosed exactly the designed pockets, each well above the size floor
  function check(boxes) {
    finalMap();
    const r = analyse(fin);
    const want = boxes.filter((b) => b.pocket);
    if (r.b2 !== want.length || !want.length || want.length === boxes.length) return false;   // 1-3 pockets and at least one open void
    for (const b of want) {
      const root = rootOf(idx(b.x, b.y, b.z)); if (root < 0) return false;
      const p = r.pockets.find((pp) => pp.root === root); if (!p) return false;
      if (p.n > b.w * b.d * b.h * 2.2) return false;              // not swollen much by buried rubble around it
    }
    for (const b of boxes) if (!b.pocket && rootOf(idx(b.x, b.y, b.z)) >= 0 && !open[rootOf(idx(b.x, b.y, b.z))]) return false;
    return r;
  }
  function build(seed) {
    for (let t = 0; t < 60; t++) {
      const boxes = generate(seed + t * 7919);
      const ok = check(boxes);
      if (ok) { map.fill(0); return { seed: seed + t * 7919, boxes, final: ok }; }
    }
    return null;
  }

  return { truth, map, X, Y, Z, side, nb, NB, analyse, rootOf, cast, finalMap, generate, check, build, get changed() { return changed; }, set changed(v) { changed = v; }, rayEnd, open, pa };
}

// ------------------------------------------------------------------ the swarm: frontier exploration + ray casting (no DOM)
// Each drone flies through voxels the map already knows are free (6-connected moves), to the nearest frontier (a free
// voxel next to unknown space) that no other drone is heading for, and casts K rays per step in random directions.
export function makeSwarm(core, nD) {
  const { map, X, Y, Z, nb } = core;
  let s = 12345;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pos = new Int32Array(nD), prev = new Int32Array(nD), tgt = new Int32Array(nD), plen = new Int32Array(nD), phead = new Int32Array(nD);
  const paths = Array.from({ length: nD }, () => new Int32Array(256)), idle = new Uint8Array(nD);
  const dist = new Int32Array(N), par = new Int32Array(N), qq = new Int32Array(N);
  const RAYS = 6, rays = new Float32Array(nD * RAYS * 4);         // per drone, the last few rays for drawing: end x, y, z, hit
  let ri = 0;
  const isFront = (i) => { if (map[i] !== 1) return false; for (let k = 0; k < 6; k++) { const j = nb(i, k); if (j >= 0 && map[j] === 0) return true; } return false; };
  function reset(seed) {
    s = seed >>> 0;
    const spots = [[1, 1], [NX - 2, NY - 2], [NX - 2, 1], [1, NY - 2], [Math.floor(NX / 2), 1], [Math.floor(NX / 2), NY - 2], [1, Math.floor(NY / 2)], [NX - 2, Math.floor(NY / 2)]];
    for (let d = 0; d < nD; d++) { const [x, y] = spots[d % spots.length]; pos[d] = prev[d] = idx(x, y, NZ - 1); map[pos[d]] = 1; tgt[d] = -1; plen[d] = phead[d] = 0; idle[d] = 0; }
    rays.fill(0);
  }
  function plan(d) {
    const src = pos[d]; dist.fill(-1); dist[src] = 0; par[src] = -1;
    let h = 0, t = 0; qq[t++] = src; let best = -1, nCand = 0;
    while (h < t) {
      const i = qq[h++];
      if (i !== src && isFront(i)) {
        let taken = false;
        for (let e = 0; e < nD; e++) if (e !== d && tgt[e] >= 0 && Math.abs(X[tgt[e]] - X[i]) + Math.abs(Y[tgt[e]] - Y[i]) + Math.abs(Z[tgt[e]] - Z[i]) < 5) { taken = true; break; }
        if (!taken) { nCand++; if (best < 0 || rnd() < 1 / nCand) best = i; if (nCand >= 3) break; }
      }
      if (dist[i] > 250) continue;
      for (let k = 0; k < 6; k++) { const j = nb(i, k); if (j >= 0 && map[j] === 1 && dist[j] < 0) { dist[j] = dist[i] + 1; par[j] = i; qq[t++] = j; } }
    }
    if (best < 0) { tgt[d] = -1; plen[d] = 0; idle[d] = 1; return; }
    idle[d] = 0; tgt[d] = best;
    let n = 0; for (let i = best; i !== src && i >= 0 && n < 256; i = par[i]) paths[d][n++] = i;
    plen[d] = n; phead[d] = n - 1;                                   // the path is stored backwards
  }
  function step(K, R) {
    for (let d = 0; d < nD; d++) {
      prev[d] = pos[d];
      if (idle[d] && (ri + d) % 10) continue;                       // nothing left to explore: look again now and then
      if (tgt[d] < 0 || !isFront(tgt[d]) || phead[d] < 0) plan(d);
      if (phead[d] >= 0 && plen[d]) { const nx = paths[d][phead[d]]; if (map[nx] === 1) { pos[d] = nx; phead[d]--; } else plan(d); }
      const ox = X[pos[d]] + .5, oy = Y[pos[d]] + .5, oz = Z[pos[d]] + .5;
      for (let k = 0; k < K; k++) {
        const u = 2 * rnd() - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
        const hit = core.cast(ox, oy, oz, r * Math.cos(a), r * Math.sin(a), u, R);
        if (k < RAYS) { const o = (d * RAYS + ((k + ri) % RAYS)) * 4; rays[o] = core.rayEnd[0]; rays[o + 1] = core.rayEnd[1]; rays[o + 2] = core.rayEnd[2]; rays[o + 3] = hit >= 0 ? 1 : hit === -2 ? 2 : 0; }
      }
    }
    ri++;
  }
  const active = () => { for (let d = 0; d < nD; d++) if (!idle[d]) return true; return false; };
  return { nD, pos, prev, tgt, idle, rays, RAYS, reset, step, active };
}

// ------------------------------------------------------------------ the page
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx, el = cv.cv;
  el.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2, LAV = '#B9A6F2', VOL = G.VOX ** 3, ELEV = 33 * Math.PI / 180, SE = Math.sin(ELEV), CE = Math.cos(ELEV);
  const ND = 8, K_RAYS = 36, RANGE = 8, STEP_T = 1 / 6;            // 8 drones × 36 rays per step, 2 m sensor range, 6 scan steps per second
  const core = pocketCore(), sw = makeSwarm(core, ND);
  const { map, X, Y, Z } = core;

  // ---------------------------------------------------------------- state
  let seed = 7, info = null, res = null, tSince = 0, acc = 0, doneT = -1;
  const hist = [];                                                 // [t, β₀, β₂, scanned] a few times per second
  function newPile() {
    seed = (seed * 48271 + 11) % 2147483647;
    info = core.build(seed) || core.build(seed + 1);
    sw.reset(seed); res = core.analyse(); tSince = 0; acc = 0; doneT = -1; hist.length = 0; confirmed.length = 0; flash = 0;
    dirty = 3;
  }
  const confirmed = [];                                            // pockets in order of confirmation: { root, t }
  let flash = 0;

  // ---------------------------------------------------------------- controls and readouts
  let cut = 0, showU = 1;
  kit.slider(controls, { label: 'Cut-away', min: 0, max: 100, step: 1, value: 0, fmt: (v) => v + ' %', onInput: (v) => { cut = v; dirty |= 1; } });
  kit.button(controls, { label: 'New rubble pile', onClick: () => newPile() });
  kit.toggle(controls, { label: 'Show unknown', options: [{ v: 0, label: 'Off' }, { v: 1, label: 'On' }], value: 1, onChange: (v) => { showU = v; dirty |= 1; } });
  kit.hint(controls, 'Drag sideways on the pile to turn it. Slide Cut-away to look inside.');
  const rB2 = kit.readout(readouts, { label: 'Enclosed pockets β₂', tone: 'heat' });
  const rB0 = kit.readout(readouts, { label: 'Unexplored pieces β₀', tone: 'ink' });
  const rSc = kit.readout(readouts, { label: 'Voxels scanned', tone: 'ink' });
  let tone0 = 'ink';

  // ---------------------------------------------------------------- view: orthographic, yaw ψ around the vertical, fixed elevation
  let yaw = Math.PI / 4, yawFrom = yaw, yawTo = yaw, turnT = -1, holdT = 0, userT = 0;
  let V = null;                                                    // layout + projection
  const HS = .5, GS = 1 / 6;                                       // the haze is drawn at half resolution (it is fog), the glow at a sixth
  function layout() {
    const W = cv.w, H = cv.h, phone = W < 600;
    const panel = phone ? 0 : Math.round(clamp(W * .24, 180, 230));
    const top = phone ? 40 : 16, bot = phone ? 10 : 14;            // the status text sits in the empty corner beside the pile
    const aw = W - 32, ah = H - top - bot;
    // frame the pile (the middle 22 × 22 × 14 voxels, at any turn); the empty air around it may run off the stage
    const ext = 44 * Math.SQRT1_2, hc = ext * SE + 14 * CE;
    const s = Math.min(aw / (ext + 1), ah / (hc + 1));
    const oy = top + (ah - hc * s) / 2 + (ext / 2 * SE + 14 * CE) * s;
    V = { W, H, phone, s, ox: 16 + aw / 2 - (panel ? panel * .18 : 0), oy, panel: panel ? { x: W - 16 - panel, y: 16, w: panel, h: 118 } : null, top };
    const d = cv.dpr;
    SC.cv.width = Math.round(W * d); SC.cv.height = Math.round(H * d);
    HZ.cv.width = Math.ceil(W * HS); HZ.cv.height = Math.ceil(H * HS);
    GL.cv.width = Math.ceil(W * GS); GL.cv.height = Math.ceil(H * GS);
    sprKey = ''; dirty |= 1;
  }
  const mk = () => { const c2 = document.createElement('canvas'); return { cv: c2, ctx: c2.getContext('2d') }; };
  const SC = mk(), HZ = mk(), GL = mk();                           // the rendered scene, the fog, the glow
  let cY = 1, sY = 0;                                              // cos/sin of the yaw in use
  const proj = (x, y, z, out) => {                                 // world (voxel units) → screen (CSS px)
    const px = x - NX / 2, py = y - NY / 2, rx = px * cY - py * sY, ry = px * sY + py * cY;
    out[0] = V.ox + V.s * rx; out[1] = V.oy + V.s * (ry * SE - z * CE); out[2] = ry * CE + z * SE;
  };
  const P = new Float64Array(3);

  // ---------------------------------------------------------------- cube sprites for the current yaw and scale (rebuilt only when those change)
  // three face tones per material (top, the side turned to the light, the side turned away), darkened by ambient occlusion
  const MAT = [null, [182, 180, 208], [148, 145, 182], [206, 186, 182]];
  const AO = [1, .86, .72];
  const pool = []; let poolN = 0, sprKey = '';
  const SPR = { solid: [], haze: null, pocket: null, glow: null, ox: 0, oy: 0, w: 0, h: 0 };
  function cubeFaces() {                                           // projected corners of the camera-facing faces, with their tone
    const s = V.s, c = (x, y, z) => { const rx = x * cY - y * sY, ry = x * sY + y * cY; return [s * rx, s * (ry * SE - z * CE)]; };
    const out = [{ pts: [c(-.5, -.5, .5), c(.5, -.5, .5), c(.5, .5, .5), c(-.5, .5, .5)], tone: 1, top: true }];
    for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ry = nx * sY + ny * cY; if (ry < .02) continue;
      const rx = nx * cY - ny * sY, tone = .66 - .14 * rx;
      const a = nx ? [nx * .5, -.5] : [-.5, ny * .5], b = nx ? [nx * .5, .5] : [.5, ny * .5];
      out.push({ pts: [c(a[0], a[1], .5), c(b[0], b[1], .5), c(b[0], b[1], -.5), c(a[0], a[1], -.5)], tone, top: false });
    }
    return out;
  }
  function sprite(faces, k, fill, edge) {                          // k: device pixels per CSS px for this sprite
    if (poolN >= pool.length) pool.push(document.createElement('canvas'));
    const c2 = pool[poolN++], w = Math.ceil(SPR.w * k), h = Math.ceil(SPR.h * k);
    if (c2.width !== w || c2.height !== h) { c2.width = w; c2.height = h; }
    const g = c2.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.setTransform(k, 0, 0, k, SPR.ox * k, SPR.oy * k); g.lineJoin = 'round';
    for (const f of faces) {
      g.beginPath(); f.pts.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
      g.fillStyle = fill(f); g.fill();
      if (edge) { g.strokeStyle = edge(f); g.lineWidth = Math.max(.5, V.s * .05); g.stroke(); }
    }
    return c2;
  }
  const rgb = (c, k, a = 1) => `rgba(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)},${a})`;
  const mixT = (c, t) => [c[0] + (220 - c[0]) * t, c[1] + (228 - c[1]) * t, c[2] + (238 - c[2]) * t];
  function makeSprites() {
    const key = yaw.toFixed(4) + '|' + V.s.toFixed(3) + '|' + cv.dpr;
    if (key === sprKey) return;
    sprKey = key; poolN = 0;
    const faces = cubeFaces();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const f of faces) for (const [x, y] of f.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    SPR.ox = -x0 + 1; SPR.oy = -y0 + 1; SPR.w = x1 - x0 + 2; SPR.h = y1 - y0 + 2;
    const d = cv.dpr;
    for (let m = 1; m <= 3; m++) {
      SPR.solid[m] = [];
      for (let a = 0; a < 3; a++) {
        SPR.solid[m][a] = [false, true].map((cutTop) => sprite(faces, d,
          (f) => f.top ? (cutTop ? rgb([214, 208, 238], AO[a]) : rgb(mixT(MAT[m], .12), AO[a])) : rgb(MAT[m], f.tone * AO[a]),
          (f) => rgb(MAT[m], .5 * (f.top ? 1 : f.tone + .2), .9)));
      }
    }
    SPR.haze = sprite(faces, HS, (f) => f.top ? 'rgb(112,114,186)' : rgb([92, 94, 166], .86 + .2 * (f.tone - .66)), null);
    SPR.pocket = sprite(faces, d, (f) => f.top ? 'rgb(214,202,252)' : rgb([185, 166, 242], f.tone + .2), () => 'rgba(250,246,255,.75)');
    SPR.glow = sprite(faces, GS * 1.6, () => 'rgb(185,166,242)', null);
  }

  // ---------------------------------------------------------------- draw lists: only voxels with a camera-facing face that is not covered
  const listS = new Int32Array(N), listH = new Int32Array(N), listP = new Int32Array(N), keyA = new Int32Array(N), order = new Int32Array(N), cnt = new Int32Array(1024);
  let nS = 0, nH = 0, nP = 0, zc = NZ;
  const pocketMark = new Uint8Array(N);
  function depthKey(i) { const px = X[i] + .5 - NX / 2, py = Y[i] + .5 - NY / 2, ry = px * sY + py * cY; return Math.round((ry * CE + (Z[i] + .5) * SE + 30) * 12); }
  function sortList(list, n) {                                     // counting sort by depth, far to near
    cnt.fill(0);
    for (let k = 0; k < n; k++) { const kk = clamp(depthKey(list[k]), 0, 1023); keyA[k] = kk; cnt[kk]++; }
    for (let b = 1; b < 1024; b++) cnt[b] += cnt[b - 1];
    for (let k = n - 1; k >= 0; k--) order[--cnt[keyA[k]]] = list[k];
    for (let k = 0; k < n; k++) list[k] = order[k];
  }
  function buildLists() {
    zc = cut > 0 ? Math.round(14 - cut / 100 * 13) : NZ;             // the cut sweeps the height of the pile (1 to 14 voxels)
    const sx = sY > .02 ? 1 : sY < -.02 ? -1 : 0, sy = cY > .02 ? 1 : cY < -.02 ? -1 : 0;
    const vis = (j, st) => j >= 0 && map[j] === st && Z[j] < zc;
    const nbx = (i) => (sx > 0 ? (X[i] < NX - 1 ? i + 1 : -1) : sx < 0 ? (X[i] > 0 ? i - 1 : -1) : -2);
    const nby = (i) => (sy > 0 ? (Y[i] < NY - 1 ? i + NX : -1) : sy < 0 ? (Y[i] > 0 ? i - NX : -1) : -2);
    nS = 0; nH = 0; nP = 0;
    for (let i = 0; i < N; i++) {
      const st = map[i]; if (st === 1 || Z[i] >= zc) continue;
      if (st === 0 && !showU && !pocketMark[i]) continue;
      const up = Z[i] < NZ - 1 ? i + NXY : -1, ax = nbx(i), ay = nby(i);
      if (st === 2) { if (!vis(up, 2) || (ax !== -2 && !vis(ax, 2)) || (ay !== -2 && !vis(ay, 2))) listS[nS++] = i; }
      else {
        if (showU && (!vis(up, 0) || (ax !== -2 && !vis(ax, 0)) || (ay !== -2 && !vis(ay, 0)))) listH[nH++] = i;
        if (pocketMark[i]) { const pu = up >= 0 && pocketMark[up] && Z[up] < zc, px = ax >= 0 && pocketMark[ax], py = ay >= 0 && pocketMark[ay]; if (!pu || (ax !== -2 && !px) || (ay !== -2 && !py)) listP[nP++] = i; }
      }
    }
    sortList(listS, nS); sortList(listH, nH); sortList(listP, nP);
  }
  function aoLevel(i) {                                            // how crowded the voxel is by scanned rubble around and above it
    let c = 0; const x = X[i], y = Y[i], z = Z[i];
    for (let dz = 0; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy && !dz) continue; const xx = x + dx, yy = y + dy, zz = z + dz;
      if (xx < 0 || yy < 0 || zz < 0 || xx >= NX || yy >= NY || zz >= NZ || zz >= zc) continue;
      if (map[idx(xx, yy, zz)] === 2) c++;
    }
    return c >= 10 ? 2 : c >= 6 ? 1 : 0;
  }
  function drawFloor(g) {
    const c = [[0, 0], [NX, 0], [NX, NY], [0, NY]].map(([x, y]) => { proj(x, y, 0, P); return [P[0], P[1]]; });
    g.fillStyle = 'rgba(36,40,77,.85)'; g.beginPath(); c.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(220,214,236,.07)'; g.lineWidth = 1; g.beginPath();
    for (let k = 4; k < NX; k += 4) { proj(k, 0, 0, P); g.moveTo(P[0], P[1]); proj(k, NY, 0, P); g.lineTo(P[0], P[1]); }
    for (let k = 4; k < NY; k += 4) { proj(0, k, 0, P); g.moveTo(P[0], P[1]); proj(NX, k, 0, P); g.lineTo(P[0], P[1]); }
    g.stroke();
    g.strokeStyle = 'rgba(143,140,196,.35)'; g.beginPath(); c.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
  }
  // one scene image: floor, the fog of unknown space (behind what has been scanned), the scanned rubble far to near,
  // then the sealed pockets on top (x-ray) with a soft glow. Sprites are blitted at whole device pixels, unscaled.
  function renderScene() {
    makeSprites(); buildLists();
    const W = V.W, H = V.H, d = cv.dpr;
    let g = HZ.ctx; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, HZ.cv.width, HZ.cv.height);
    if (showU) for (let k = 0; k < nH; k++) { const i = listH[k]; proj(X[i] + .5, Y[i] + .5, Z[i] + .5, P); g.drawImage(SPR.haze, Math.round((P[0] - SPR.ox) * HS), Math.round((P[1] - SPR.oy) * HS)); }
    g = SC.ctx; g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H); drawFloor(g);
    if (showU && nH) { g.globalAlpha = .42; g.imageSmoothingEnabled = true; g.drawImage(HZ.cv, 0, 0, W, H); g.globalAlpha = 1; }
    // scanned rubble and sealed pockets in one painter's order: a pocket shows as itself only where nothing is in front
    // of it (cut the pile away to see it), and as a glow through the rubble everywhere else
    g.setTransform(1, 0, 0, 1, 0, 0);
    let a = 0, b = 0;
    while (a < nS || b < nP) {
      const ia = a < nS ? listS[a] : -1, ib = b < nP ? listP[b] : -1;
      const takeS = ib < 0 || (ia >= 0 && depthKey(ia) <= depthKey(ib));
      const i = takeS ? ia : ib; if (takeS) a++; else b++;
      proj(X[i] + .5, Y[i] + .5, Z[i] + .5, P);
      const px = Math.round((P[0] - SPR.ox) * d), py = Math.round((P[1] - SPR.oy) * d);
      if (takeS) { const cutTop = Z[i] === zc - 1 && Z[i] < NZ - 1 && map[i + NXY] === 2 ? 1 : 0; g.drawImage(SPR.solid[core.truth[i] || 2][aoLevel(i)][cutTop], px, py); }
      else g.drawImage(SPR.pocket, px, py);
    }
    if (nP) {
      const gg = GL.ctx; gg.setTransform(1, 0, 0, 1, 0, 0); gg.clearRect(0, 0, GL.cv.width, GL.cv.height);
      for (let k = 0; k < nP; k++) { const i = listP[k]; proj(X[i] + .5, Y[i] + .5, Z[i] + .5, P); gg.drawImage(SPR.glow, (P[0] - SPR.ox * 1.6) * GS, (P[1] - SPR.oy * 1.6) * GS); }
      g.setTransform(d, 0, 0, d, 0, 0); g.imageSmoothingEnabled = true;
      g.globalAlpha = .5; g.drawImage(GL.cv, -V.s * .3, -V.s * .3, W + V.s * .6, H + V.s * .6); g.globalAlpha = .28; g.drawImage(GL.cv, 0, 0, W, H);
      g.globalAlpha = 1;
    }
    g.setTransform(d, 0, 0, d, 0, 0);
  }

  // ---------------------------------------------------------------- input: drag sideways to turn the pile
  let drag = null;
  const onDown = (e) => { drag = { x: e.offsetX, yaw0: yaw, moved: false, id: e.pointerId }; };
  const onMove = (e) => {
    if (!drag) return; const dx = e.offsetX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return;
    if (!drag.moved) { drag.moved = true; try { el.setPointerCapture(drag.id); } catch (_) { /* ignore */ } }
    yaw = drag.yaw0 + dx * .012; turnT = -1; userT = 0; dirty |= 1; el.style.cursor = 'grabbing';
  };
  const onUp = () => { if (drag && drag.moved) { yawTo = yaw; holdT = 0; } drag = null; el.style.cursor = 'grab'; };
  el.style.cursor = 'grab';
  el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);

  // ---------------------------------------------------------------- the scan
  function scanStep() {
    sw.step(K_RAYS, RANGE);
    res = core.analyse();
    pocketMark.fill(0);
    for (const p of res.pockets) {
      if (!confirmed.some((c2) => c2.root === p.root)) { confirmed.push({ root: p.root, t: tSince }); flash = 1; }
    }
    if (res.pockets.length) for (let i = 0; i < N; i++) { const r = core.rootOf(i); if (r >= 0 && res.pockets.some((p) => p.root === r)) pocketMark[i] = 1; }
    if (res.b0 === 0 && doneT < 0) doneT = tSince;
    dirty |= 2;
  }

  // ---------------------------------------------------------------- drawing per frame
  let dirty = 3, lastRender = 0, frameN = 0;
  function halo(str, x, y, o) {
    ctx.font = `${o.weight || 400} ${o.size || 12}px ${o.font || F.sans}`; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(27,30,61,.9)'; ctx.strokeText(str, x, y); ctx.fillStyle = o.color; ctx.fillText(str, x, y);
  }
  const tw = (str, size, weight = 400) => { ctx.font = `${weight} ${size}px ${F.sans}`; return ctx.measureText(str).width; };
  const dronePos = new Float64Array(ND * 3);
  function droneDraw(alpha) {
    const s = V.s;
    // rays from this step: faint teal lines to where they ended (a ring where they hit rubble)
    ctx.lineWidth = 1; ctx.lineCap = 'round';
    const pr = new Path2D(), ph = new Path2D();
    for (let d = 0; d < ND; d++) {
      const x = dronePos[d * 3], y = dronePos[d * 3 + 1], z = dronePos[d * 3 + 2];
      if (sw.idle[d]) continue;
      proj(x, y, z, P); const sx = P[0], sy = P[1];
      for (let k = 0; k < sw.RAYS; k++) {
        const o = (d * sw.RAYS + k) * 4; if (!sw.rays[o] && !sw.rays[o + 1]) continue;
        if (sw.rays[o + 2] >= zc) continue;
        proj(sw.rays[o], sw.rays[o + 1], sw.rays[o + 2], P);
        pr.moveTo(sx, sy); pr.lineTo(P[0], P[1]);
        if (sw.rays[o + 3] === 1) { ph.moveTo(P[0] + 1.6, P[1]); ph.arc(P[0], P[1], 1.6, 0, TAU); }
      }
    }
    ctx.strokeStyle = `rgba(127,212,207,${(.22 * alpha).toFixed(3)})`; ctx.stroke(pr);
    ctx.fillStyle = `rgba(127,212,207,${(.75 * alpha).toFixed(3)})`; ctx.fill(ph);
    // the drones: an X frame with four rotors; seen through rubble they are drawn faint
    const sz = clamp(s * .42, 3, 6);
    for (let d = 0; d < ND; d++) {
      const x = dronePos[d * 3], y = dronePos[d * 3 + 1], z = dronePos[d * 3 + 2];
      let occ = false;
      for (let t = .8; t < 40; t += .5) {
        const qx = Math.floor(x + sY * CE * t), qy = Math.floor(y + cY * CE * t), qz = Math.floor(z + SE * t);
        if (qx < 0 || qy < 0 || qx >= NX || qy >= NY || qz >= NZ) break;
        if (qz >= 0 && qz < zc && map[idx(qx, qy, qz)] === 2) { occ = true; break; }
      }
      // shadow on whatever is below
      let zg = 0; for (let zz = Math.floor(z) - 1; zz >= 0; zz--) { const j = idx(Math.floor(x), Math.floor(y), zz); if (map[j] === 2 && zz < zc) { zg = zz + 1; break; } }
      proj(x, y, zg, P); ctx.fillStyle = 'rgba(14,16,36,.35)'; ctx.beginPath(); ctx.ellipse(P[0], P[1], sz * .9, sz * .45, 0, 0, TAU); ctx.fill();
      proj(x, y, z, P); const px = P[0], py = P[1];
      const col = occ ? 'rgba(127,212,207,.4)' : C.teal;
      if (!occ) { ctx.fillStyle = 'rgba(127,212,207,.14)'; ctx.beginPath(); ctx.arc(px, py, sz * 1.9, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px - sz, py - sz * .55); ctx.lineTo(px + sz, py + sz * .55); ctx.moveTo(px + sz, py - sz * .55); ctx.lineTo(px - sz, py + sz * .55); ctx.stroke();
      ctx.beginPath(); for (const [ox2, oy2] of [[-1, -.55], [1, -.55], [1, .55], [-1, .55]]) { const rx = px + ox2 * sz, ry = py + oy2 * sz; ctx.moveTo(rx + 2, ry); ctx.ellipse(rx, ry, 2, 1.1, 0, 0, TAU); } ctx.stroke();
    }
  }

  function draw(alpha) {
    cv.clear();
    ctx.drawImage(SC.cv, 0, 0, V.W, V.H);
    droneDraw(alpha);
    drawLabels();
    if (V.panel) drawPanel();
  }

  // labels: the status line, the pockets, the open voids once the drones have been inside
  const rects = []; let nR = 0;
  function label(str, x, y, col, o = {}) {                         // a soft-backed label; skipped if it would cover another
    const size = o.size || (V.phone ? 10.5 : 11.5), w = tw(str, size, o.weight || 400), al = o.align || 'left';
    let x0 = al === 'left' ? x : al === 'right' ? x - w : x - w / 2;
    x0 = clamp(x0, 14, V.W - (V.panel && y < V.panel.y + V.panel.h + 10 ? V.panel.w + 30 : 14) - w);
    const y0 = clamp(y, V.top + 6, V.H - 10);
    const bx = x0 - 6, by = y0 - size + 1 - 4, bw = w + 12, bh = size + 9;
    for (let k = 0; k < nR; k++) { const r = rects[k]; if (bx < r[0] + r[2] && r[0] < bx + bw && by < r[1] + r[3] && r[1] < by + bh) return null; }
    rects[nR++] = [bx, by, bw, bh];
    ctx.fillStyle = 'rgba(27,30,61,.82)'; roundRect(ctx, bx, by, bw, bh, 7); ctx.fill();
    if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = 1; roundRect(ctx, bx + .5, by + .5, bw - 1, bh - 1, 7); ctx.stroke(); }
    text(ctx, str, x0, y0, { size, color: col, weight: o.weight || 400 });
    return [bx, by, bw, bh];
  }
  function drawLabels() {
    // the status box first (top left, beside the pile), so no other label lands on it
    const fs = V.phone ? 12 : 13, ss = V.phone ? 10.5 : 11, x0 = V.phone ? 16 : 22, y0 = V.phone ? 22 : 28;
    let msg;
    if (res.b0 > 0) msg = `Scanning: ${res.b0} unexplored piece${res.b0 === 1 ? '' : 's'} left`;
    else if (res.b2 > 0) msg = V.phone ? `Search complete: ${res.b2} sealed pocket${res.b2 === 1 ? '' : 's'}` : `Search complete: nothing left to explore, ${res.b2} sealed pocket${res.b2 === 1 ? '' : 's'} found`;
    else msg = 'Search complete: no sealed pockets';
    const haze = showU ? 'haze: not seen yet' : 'unknown space hidden';
    const sub = res.b0 > 0 ? (V.phone ? haze : haze + ' · teal lines: the drones’ rays marking free and occupied voxels')
      : (V.phone ? 'what is left unknown is sealed in rubble' : 'every voxel still unknown is sealed inside rubble: no ray can reach it');
    const bw = Math.min(Math.max(tw(msg, fs, 500), tw(sub, ss)) + 34, V.W - 2 * x0 + 16), bh = (V.phone ? 38 : 44) + (cut > 0 ? 16 : 0);
    nR = 0; rects[nR++] = [x0 - 8, y0 - 17, bw, bh];
    // pockets (most recent first), each with a leader to its centre
    for (let k = confirmed.length - 1; k >= 0; k--) {
      const p = res.pockets.find((pp) => pp.root === confirmed[k].root); if (!p) continue;
      if (p.lo >= zc) continue;
      proj(p.cx, p.cy, Math.min(p.cz, zc - .5), P); const px = P[0], py = P[1];
      const vol = (p.n * VOL).toFixed(1), first = k === confirmed.length - 1;
      const str = first ? (V.phone ? `pocket: ${vol} m³, enclosed` : `pocket: ${vol} m³, enclosed: a person could survive here`) : `pocket: ${vol} m³`;
      const lx = px < V.ox ? px - 26 : px + 26, ly = py - (V.phone ? 34 : 48) - k * 4;
      const r = label(str, lx, ly, LAV, { align: px < V.ox ? 'right' : 'left', weight: 500, border: `rgba(185,166,242,${(.45 + (first ? .5 * flash : 0)).toFixed(2)})` })
        || label(str, lx, py + (V.phone ? 34 : 48), LAV, { align: px < V.ox ? 'right' : 'left', weight: 500, border: 'rgba(185,166,242,.45)' });
      if (r) {
        const ex = clamp(px, r[0], r[0] + r[2]), ey = r[1] > py ? r[1] : r[1] + r[3];
        ctx.strokeStyle = 'rgba(185,166,242,.7)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(px, py); ctx.stroke();
        ctx.fillStyle = LAV; ctx.beginPath(); ctx.arc(px, py, 3, 0, TAU); ctx.fill();
        if (V.phone && first) label('a person could survive here', r[0] + 6, r[1] > py ? r[1] + r[3] + 13 : r[1] - 6, 'rgba(185,166,242,.85)', { size: 10 });
      }
    }
    // open voids: once the drones have seen inside, say why they do not count
    if (info) for (const b of info.boxes) {
      if (b.pocket) continue;
      let seen = 0, tot = 0;
      for (let z = b.z; z < b.z + b.h; z++) for (let y = b.y; y < b.y + b.d; y++) for (let x = b.x; x < b.x + b.w; x++) { tot++; if (map[idx(x, y, z)] === 1) seen++; }
      if (seen < tot * .7 || b.z >= zc) continue;
      proj(b.x + b.w / 2, b.y + b.d / 2, b.z + b.h / 2, P);
      const r = label(V.phone ? 'open void: not a pocket' : 'open void: the drones flew in, not a pocket', P[0], P[1] + (V.phone ? 30 : 40), 'rgba(243,238,242,.75)', { align: 'center' });
      if (r) { ctx.strokeStyle = 'rgba(243,238,242,.35)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(clamp(P[0], r[0], r[0] + r[2]), r[1]); ctx.stroke(); ctx.setLineDash([]); }
    }
    // the status itself
    ctx.fillStyle = 'rgba(27,30,61,.72)'; roundRect(ctx, x0 - 8, y0 - 17, bw, bh, 10); ctx.fill();
    ctx.fillStyle = res.b0 > 0 ? C.teal : res.b2 > 0 ? LAV : C.teal; ctx.beginPath(); ctx.arc(x0 + 4, y0 - 4.5, 4, 0, TAU); ctx.fill();
    halo(msg, x0 + 14, y0, { size: fs, color: C.ink, weight: 500 });
    halo(sub, x0 + 14, y0 + (V.phone ? 15 : 18), { size: ss, color: C.faint });
    if (cut > 0) halo(`cut at ${(zc * G.VOX).toFixed(2)} m`, x0 + 14, y0 + (V.phone ? 30 : 36), { size: 10.5, color: C.apricot });
  }

  // the story over time: unexplored pieces fall to zero while sealed pockets appear
  function drawPanel() {
    const R = V.panel;
    ctx.fillStyle = C.panel; roundRect(ctx, R.x, R.y, R.w, R.h, 10); ctx.fill();
    const l = R.x + 26, r = R.x + R.w - 12, top = R.y + 40, bot = R.y + R.h - 20;
    const tMax = Math.max(30, Math.ceil((hist.length ? hist[hist.length - 1][0] : 0) / 10) * 10);
    let yMax = 3; for (const h of hist) yMax = Math.max(yMax, h[1], h[2]);
    const px = (t) => l + t / tMax * (r - l), py = (v) => bot - v / yMax * (bot - top);
    text(ctx, 'unexplored β₀', R.x + 12, R.y + 18, { size: 11, color: C.teal });
    text(ctx, 'pockets β₂', R.x + R.w - 12, R.y + 18, { size: 11, color: C.heat, align: 'right' });
    text(ctx, 'scanned', R.x + 12, R.y + 31, { size: 10, color: C.faint });
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); for (let v = 1; v <= yMax; v++) { ctx.moveTo(l, py(v)); ctx.lineTo(r, py(v)); } ctx.stroke();
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(l, top - 4); ctx.lineTo(l, bot); ctx.lineTo(r, bot); ctx.stroke();
    text(ctx, String(yMax), l - 5, py(yMax) + 3.5, { size: 9.5, color: C.faint, font: F.mono, align: 'right' });
    text(ctx, '0', l - 5, bot + 3.5, { size: 9.5, color: C.faint, font: F.mono, align: 'right' });
    text(ctx, `${tMax} s`, r, R.y + R.h - 6, { size: 9.5, color: C.faint, font: F.mono, align: 'right' });
    if (hist.length > 1) {
      ctx.fillStyle = 'rgba(243,238,242,.06)'; ctx.beginPath(); ctx.moveTo(px(hist[0][0]), bot);
      for (const h of hist) ctx.lineTo(px(h[0]), bot - h[3] * (bot - top)); ctx.lineTo(px(hist[hist.length - 1][0]), bot); ctx.closePath(); ctx.fill();
      const stepLine = (k, col) => { ctx.strokeStyle = col; ctx.lineWidth = 1.7; ctx.lineJoin = 'round'; ctx.beginPath(); hist.forEach((h, n) => { const x = px(h[0]), y = py(h[k]); if (!n) ctx.moveTo(x, y); else { ctx.lineTo(x, py(hist[n - 1][k])); ctx.lineTo(x, y); } }); ctx.stroke(); };
      stepLine(1, C.teal); stepLine(2, C.heat);
    }
  }

  // ---------------------------------------------------------------- loop
  cv.onResize(() => layout());
  layout();
  newPile();
  const loop = kit.loop((dt) => {
    dt = Math.max(0, Math.min(.05, dt || 0));
    tSince += dt; flash = Math.max(0, flash - dt * .6);
    // scan steps at a fixed rate
    acc += dt; let n = 0;
    while (acc >= STEP_T && n < 2) { acc -= STEP_T; scanStep(); n++; }
    const stepped = n > 0;                                           // a scan step this frame: the re-render waits for the next
    const alpha = clamp(acc / STEP_T, 0, 1);
    for (let d = 0; d < ND; d++) {
      const a = sw.prev[d], b = sw.pos[d], bob = Math.sin(tSince * 3 + d * 1.7) * .08;
      dronePos[d * 3] = X[a] + .5 + (X[b] - X[a]) * alpha; dronePos[d * 3 + 1] = Y[a] + .5 + (Y[b] - Y[a]) * alpha; dronePos[d * 3 + 2] = Z[a] + .5 + (Z[b] - Z[a]) * alpha + bob;
    }
    if (!hist.length || tSince - hist[hist.length - 1][0] > .25) { hist.push([tSince, res.b0, res.b2, res.known / N]); if (hist.length > 600) hist.splice(0, 300); }
    // the turntable: hold, then a quarter turn; a drag takes over for a while
    userT += dt;
    if (!drag && userT > 5) {
      if (turnT < 0) { holdT += dt; if (holdT > 7) { turnT = 0; yawFrom = yaw; yawTo = Math.round((yaw - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4 + Math.PI / 2; } }
      else { turnT += dt / 1.8; const e = turnT >= 1 ? 1 : turnT * turnT * (3 - 2 * turnT); yaw = yawFrom + (yawTo - yawFrom) * e; dirty |= 1; if (turnT >= 1) { turnT = -1; holdT = 0; } }
    }
    if (doneT >= 0 && tSince - doneT > 45) newPile();
    if (!loop.running) return;
    // while the pile turns, the scene is re-rendered every other frame (30 Hz); drones use the yaw of the scene on screen
    const now = performance.now(), turning = turnT >= 0 || (drag && drag.moved);
    frameN++;
    if (((dirty & 1) && (!turning || !(frameN & 1))) || (!(dirty & 1) && (dirty & 2) && now - lastRender > 240 && !stepped)) {
      cY = Math.cos(yaw); sY = Math.sin(yaw); renderScene(); dirty = 0; lastRender = now;
    }
    draw(1);
    rB2.set(String(res.b2));
    rB0.set(String(res.b0)); const t0 = res.b0 === 0 ? 'teal' : 'ink'; if (t0 !== tone0) rB0.tone(tone0 = t0);
    rSc.set(Math.floor(res.known / N * 100) + '%');                  // floor: 100% only when nothing at all is unknown
  });
  cY = Math.cos(yaw); sY = Math.sin(yaw); renderScene(); draw(1);
  return {
    start: loop.start, stop: loop.stop,
    destroy() { loop.stop(); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp); cv.destroy(); },
  };
}

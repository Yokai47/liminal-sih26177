// Placeholder world for the city mission (used until, or if, world.js is missing or broken). Follows the world
// contract in ACT4_SPEC 5.2: a street grid of mid-rise blocks after an earthquake, two of them collapsed into
// pancaked slabs over crawlable voids (one indoor layer each), a responders' van at the cordon.
import { makeKit, PAL } from '../placekit.js';

export function buildWorld(THREE, { seed = 1, quality = 'high', props = null } = {}) {
  const K = makeKit(THREE, seed * 7 + 1);
  const { r, rf, mat, instanced, layer, setRect, box, plane, V } = K;
  const group = new THREE.Group(); group.name = 'city';
  const BX = [-62, 0, 62], BZ = [-32, 32], HW = 24, HD = 25;   // blocks: centres, half sizes
  // ------------------------------------------------------------------ the outdoor layer (2 m cells; outside the cordon = 2)
  const G = layer('ground', -116, -70, 103, 70, 2, 0, 0, { name: 'Streets and yards', outdoor: true, band: [-1, 3] });
  setRect(G, -116, -70, -90, 70, 2);
  // buildings: one per block (two in some); collapsed: block (0,-32) "B" and (62,32) "F"
  const blocks = []; const names = 'ABCDEF';
  let n = 0;
  for (const bz of BZ) for (const bx of BX) {
    const id = names[n++];
    const collapsed = (bx === 0 && bz === -32) || (bx === 62 && bz === 32);
    const w = collapsed ? 32 : rf(26, 34), d = collapsed ? 36 : rf(26, 36);
    const ox = rf(-HW + w / 2 + 3, HW - w / 2 - 3) * .5, oz = rf(-HD + d / 2 + 3, HD - d / 2 - 3) * .5;
    blocks.push({ id, cx: bx, cz: bz, bx: bx + ox, bz: bz + oz, w, d, collapsed, floors: collapsed ? 6 : 4 + ((r() * 5) | 0) });
  }
  for (const b of blocks) setRect(G, b.bx - b.w / 2 + (b.collapsed ? 1.2 : 0), b.bz - b.d / 2 + (b.collapsed ? 1.2 : 0), b.bx + b.w / 2 - (b.collapsed ? 1.2 : 0), b.bz + b.d / 2 - (b.collapsed ? 1.2 : 0), 1);
  // ------------------------------------------------------------------ collapsed buildings: rubble voids (1 m cells)
  const layers = [G], surfaces = [], people = [], pockets = [];
  const upper = new THREE.Group(); upper.name = 'upper'; group.add(upper);
  const chunks = [], slabs = [], spill = [];
  for (const b of blocks.filter((q) => q.collapsed)) {
    const nx = Math.round(b.w), nz = Math.round(b.d), x0 = b.bx - nx / 2, z0 = b.bz - nz / 2;
    const L = layer('b' + b.id, x0 - 1, z0 - 1, nx + 2, nz + 2, 1, 0, 2, { name: `Block ${b.id} (collapsed)`, outdoor: false, band: [0, 2.4] });
    const g = L.grid, NX = L.nx, NZ = L.nz;
    // cave-like voids under the slabs: noise + cellular automata
    for (let k = 1; k < NZ - 1; k++) for (let i = 1; i < NX - 1; i++) g[k * NX + i] = (K.fbm(i * .21, k * .21, seed + b.cx) + r() * .28) > .62 ? 0 : 1;
    for (let it = 0; it < 4; it++) { const c2 = g.slice(); for (let k = 1; k < NZ - 1; k++) for (let i = 1; i < NX - 1; i++) { let w = 0; for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) if (g[(k + dk) * NX + i + di] === 1 || g[(k + dk) * NX + i + di] === 2) w++; c2[k * NX + i] = w >= 5 ? 1 : 0; } g.set(c2); }
    // crawl corridors from three openings toward the middle (where the stairwell held)
    const mid = [(NX / 2) | 0, (NZ / 2) | 0];
    const openings = [[1, (NZ * .3) | 0], [NX - 2, (NZ * .65) | 0], [(NX * .45) | 0, NZ - 2], [(NX * .6) | 0, 1]];
    for (const [oi, ok] of openings) { let i = oi, k = ok; for (let s = 0; s < 220; s++) { g[k * NX + i] = 0; if (r() < .35 && i + 1 < NX - 1) g[k * NX + i + 1] = 0; if (Math.abs(i - mid[0]) + Math.abs(k - mid[1]) < 2) break; if (r() < .62) i += Math.sign(mid[0] - i); else k += Math.sign(mid[1] - k); if (r() < .18) { i += r() < .5 ? 1 : -1; i = Math.max(1, Math.min(NX - 2, i)); } } }
    // connect every void pocket of 5+ cells to the main web; fill the smaller ones (rubble)
    const lab = new Int32Array(NX * NZ).fill(-1); const comps = [];
    for (let c = 0; c < NX * NZ; c++) { if (g[c] !== 0 || lab[c] >= 0) continue; const q = [c]; lab[c] = comps.length; for (let a = 0; a < q.length; a++) { const u = q[a], i = u % NX, k = (u / NX) | 0; for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = (k + dk) * NX + i + di; if (i + di < 0 || k + dk < 0 || i + di >= NX || k + dk >= NZ) continue; if (g[v] === 0 && lab[v] < 0) { lab[v] = comps.length; q.push(v); } } } comps.push(q); }
    const main = comps.reduce((a, q, i) => (q.length > comps[a].length ? i : a), 0);
    for (let ci = 0; ci < comps.length; ci++) {
      if (ci === main) continue; const q = comps[ci];
      if (q.length < 5) { for (const u of q) g[u] = 1; continue; }
      let best = null, bd = 1e9; const s0 = q[0]; for (const u of comps[main]) { const d = Math.abs((u % NX) - (s0 % NX)) + Math.abs(((u / NX) | 0) - ((s0 / NX) | 0)); if (d < bd) { bd = d; best = u; } }
      let i = s0 % NX, k = (s0 / NX) | 0; const ti = best % NX, tk = (best / NX) | 0; while (i !== ti || k !== tk) { g[k * NX + i] = 0; if (i !== ti) i += Math.sign(ti - i); else k += Math.sign(tk - k); }
    }
    // one sealed void deep in the pile in block F: β2 (the swarm maps its walls all round but can never enter)
    if (b.id === 'F') {
      let pc = -1; for (let t = 0; t < 400 && pc < 0; t++) { const i = 3 + ((r() * (NX - 7)) | 0), k = 3 + ((r() * (NZ - 7)) | 0); let ok = true; for (let dk = -2; dk <= 3; dk++) for (let di = -2; di <= 3; di++) if (g[(k + dk) * NX + i + di] !== 1) ok = false; if (ok) pc = k * NX + i; }
      if (pc >= 0) { for (const [di, dk] of [[0, 0], [1, 0], [0, 1], [1, 1]]) g[pc + dk * NX + di] = 0; const c = K.cellC(L, pc); pockets.push({ pos: V(c.x + .5, .6, c.z + .5), layer: L.id }); }
    }
    // the outer ring of the footprint stays rubble except at the openings
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) { const edge = i === 0 || k === 0 || i === NX - 1 || k === NZ - 1; if (edge) g[k * NX + i] = 2; }
    for (const [oi, ok] of openings) { const ii = oi <= 1 ? 1 : oi >= NX - 2 ? NX - 2 : oi, kk = ok <= 1 ? 1 : ok >= NZ - 2 ? NZ - 2 : ok; g[kk * NX + ii] = 0; }
    layers.push(L);
    // the person under this pile: the reachable void farthest from the openings
    { const dist = new Int32Array(NX * NZ).fill(-1), q = []; for (const [oi, ok] of openings) { const ii = oi <= 1 ? 1 : oi >= NX - 2 ? NX - 2 : oi, kk = ok <= 1 ? 1 : ok >= NZ - 2 ? NZ - 2 : ok; const c = kk * NX + ii; dist[c] = 0; q.push(c); }
      for (let a = 0; a < q.length; a++) { const u = q[a], i = u % NX, k = (u / NX) | 0; for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = (k + dk) * NX + i + di; if (g[v] === 0 && dist[v] < 0) { dist[v] = dist[u] + 1; q.push(v); } } }
      let far = q[q.length - 1]; const c = K.cellC(L, q[Math.floor(q.length * (b.id === 'B' ? .93 : .8))] ?? far); people.push({ pos: V(c.x, .3, c.z), layer: L.id, hidden: true, count: b.id === 'B' ? 2 : 1, note: b.id === 'B' ? 'two people in a void under the third-floor slab' : 'one person by the stairwell' }); }
    // 3-D: rubble chunks on every rubble cell, pancaked slabs above, a few wall stubs; a dark floor under the voids
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
      const c = k * NX + i, t = g[c]; if (t !== 1) continue; const wx = L.x0 + i + .5, wz = L.z0 + k + .5;
      const h = rf(1.6, 2.9); chunks.push({ x: wx + rf(-.15, .15), y: h / 2, z: wz + rf(-.15, .15), sx: rf(.95, 1.35), sy: h, sz: rf(.95, 1.35), ry: rf(-.4, .4), rx: rf(-.12, .12), c: r() < .5 ? '#A79DB6' : r() < .5 ? '#B8AEC0' : '#958CA8' });
    }
    const floor = plane(NX - 2, NZ - 2, '#4B4668', .2, L.x0 + NX / 2, L.z0 + NZ / 2); floor.userData.layer = L.id; group.add(floor); surfaces.push(floor);
    for (let fl = 0; fl < 4; fl++) {
      const y0 = 2.6 + fl * 1.15;
      for (let s = 0; s < 7; s++) {
        const w = rf(7, 13), d2 = rf(6, 12), sx = b.bx + rf(-b.w / 2 + w / 2, b.w / 2 - w / 2) * .95, sz = b.bz + rf(-b.d / 2 + d2 / 2, b.d / 2 - d2 / 2) * .95;
        if (r() < .15 * fl) continue;
        slabs.push({ x: sx, y: y0 + rf(-.3, .4), z: sz, sx: w, sy: .38, sz: d2, rx: rf(-.18, .18), rz: rf(-.2, .2), ry: rf(-.12, .12), c: fl % 2 ? '#C7BDCB' : '#B4A9BE' });
      }
    }
    for (let s = 0; s < 3; s++) { const side = s % 4, wx = b.bx + (side === 0 ? -b.w / 2 : b.w / 2) * .96, wz = b.bz + rf(-b.d / 2, b.d / 2) * .8, h = rf(5, 11); upper.add(box(.5, h, rf(4, 9), '#C2B8C8', wx, h / 2, wz, { ry: rf(-.1, .1) })); }
    // debris spilled into the street on one side
    for (let s = 0; s < 120; s++) { const a = rf(0, Math.PI * 2), rr = Math.max(b.w, b.d) * .5 + rf(0, 9); const wx = b.bx + Math.cos(a) * rr * .9, wz = b.bz + Math.sin(a) * rr * .9; const sz = rf(.3, 1.4); spill.push({ x: wx, y: sz * .3, z: wz, sx: sz, sy: sz * .6, sz: sz * rf(.6, 1.4), ry: rf(0, 3), rx: rf(-.4, .4), c: r() < .5 ? '#A79DB6' : '#BDB2C2' }); }
  }
  // ------------------------------------------------------------------ ground, streets, blocks
  const base = plane(700, 700, '#4F4B6F', -.02, 0, 0); group.add(base);
  const street = plane(206, 140, '#5E5A7E', 0, -13, 0); street.userData.layer = 'ground'; group.add(street); surfaces.push(street);
  for (const b of blocks) {
    const lot = box(HW * 2 - 2, .12, HD * 2 - 2, '#8D87A6', b.cx, .06, b.cz, { cast: false }); group.add(lot);
    const yard = plane(HW * 2 - 4, HD * 2 - 4, '#7D8E86', .13, b.cx, b.cz); yard.userData.layer = 'ground'; group.add(yard); surfaces.push(yard);
  }
  // standing buildings, windows
  const wins = [], roofs = [];
  for (const b of blocks.filter((q) => !q.collapsed)) {
    const h = b.floors * 3.2, col = ['#D8CCD6', '#CFC2CF', '#E2D3CB', '#C8C3D8', '#D9C9C4'][(r() * 5) | 0];
    group.add(box(b.w, h, b.d, col, b.bx, h / 2, b.bz));
    roofs.push({ x: b.bx, y: h + .25, z: b.bz, sx: b.w - 1.2, sy: .5, sz: b.d - 1.2, c: '#B9AEC2' });
    for (let f = 0; f < b.floors; f++) for (const side of [0, 1, 2, 3]) {
      const len = side % 2 ? b.d : b.w, nwin = Math.floor(len / 3.4);
      for (let w = 0; w < nwin; w++) { const t = (w + .5) / nwin - .5, y = f * 3.2 + 1.7;
        if (side === 0) wins.push({ x: b.bx + t * len, y, z: b.bz - b.d / 2 - .02, sx: 1.4, sy: 1.6, sz: .1 }); else if (side === 2) wins.push({ x: b.bx + t * len, y, z: b.bz + b.d / 2 + .02, sx: 1.4, sy: 1.6, sz: .1 });
        else if (side === 1) wins.push({ x: b.bx + b.w / 2 + .02, y, z: b.bz + t * len, sx: .1, sy: 1.6, sz: 1.4 }); else wins.push({ x: b.bx - b.w / 2 - .02, y, z: b.bz + t * len, sx: .1, sy: 1.6, sz: 1.4 }); }
    }
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  group.add(instanced(unit, mat('#3F3B62', { rough: .6 }), wins, { shadow: false }));
  group.add(instanced(unit, mat('#ffffff'), roofs));
  group.add(instanced(unit, mat('#ffffff', { flat: true }), chunks));
  group.add(instanced(unit, mat('#ffffff'), spill));
  const slabMesh = instanced(unit, mat('#ffffff'), slabs); upper.add(slabMesh);
  // trees and cars
  const trees = [], trunks = [], cars = [];
  for (const b of blocks) for (let t = 0; t < 6; t++) { const x = b.cx + rf(-HW + 3, HW - 3), z = b.cz + rf(-HD + 3, HD - 3); if (Math.abs(x - b.bx) < b.w / 2 + 3 && Math.abs(z - b.bz) < b.d / 2 + 3) continue; const s = rf(2.2, 3.6); trees.push({ x, y: 3 + s * .6, z, sx: s, sy: s * 1.1, sz: s, c: r() < .5 ? '#8FA79A' : '#7E9A8B' }); trunks.push({ x, y: 1.6, z, sx: .35, sy: 3.2, sz: .35, c: '#6F6687' }); setRect(G, x - 1, z - 1, x + 1, z + 1, 1, [0]); }
  for (let c = 0; c < 22; c++) { const horiz = r() < .5; const x = horiz ? rf(-88, 88) : [-31, 31][(r() * 2) | 0] + rf(-4, 4), z = horiz ? rf(-4, 4) : rf(-60, 60); cars.push({ x, y: .75, z, sx: horiz ? 4.3 : 1.9, sy: 1.3, sz: horiz ? 1.9 : 4.3, ry: rf(-.15, .15), c: ['#B9A7C4', '#8F8CC4', '#C7A8A6', '#D3C9D6', '#6F72A0', '#A6B3C9'][(r() * 6) | 0] }); }
  group.add(instanced(new THREE.IcosahedronGeometry(1, 1), mat('#ffffff', { flat: true }), trees));
  group.add(instanced(new THREE.CylinderGeometry(.5, .6, 1, 6), mat('#ffffff'), trunks));
  group.add(instanced(unit, mat('#ffffff', { rough: .7 }), cars));
  // the responders' van at the cordon and a line of barrier tape
  const van = new THREE.Group(); van.position.set(-100, 0, 4); van.rotation.y = Math.PI / 2;
  van.add(box(2.2, 2.3, 5.4, '#E9DDE0', 0, 1.55, 0), box(2.1, 1.5, 1.6, '#E9DDE0', 0, 1.15, 3.3), box(1.6, .22, .5, '#F08A7E', 0, 2.82, 2.1, { material: mat('#F08A7E', { emissive: '#F08A7E', ei: 1.5 }) }));
  for (const [x, z] of [[-1.05, -1.6], [1.05, -1.6], [-1.05, 1.9], [1.05, 1.9]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, .35, 12), mat('#3A3656')); w.rotation.z = Math.PI / 2; w.position.set(x, .45, z); van.add(w); }
  const apr = box(5.8, .08, 2.6, PAL.apricot, 0, 2.72, -.4, { cast: false }); van.add(apr);
  group.add(van);
  for (let k = -6; k <= 6; k++) group.add(box(.12, 1, .12, '#F6D2B1', -93, .5, k * 6, { cast: false }));
  // ------------------------------------------------------------------ anchors
  const coll = blocks.filter((b) => b.collapsed);
  const anchors = {
    base: V(-97, .2, 0),
    tether: { station: V(-100, 2.9, 3), hover: V(-90, 34, 4), cable: 40 },
    ugvRoutes: [
      [V(-94, 0, -2.5), V(-31, 0, -2.5), V(coll[0].bx - 8, 0, -3.2)],
      [V(-94, 0, 2.5), V(31, 0, 2.5), V(coll[1].bx - 4, 0, 4)],
    ],
    people: [...people, { pos: V(blocks[0].cx + 17, .2, blocks[0].cz + 19), layer: 'ground', hidden: true, count: 1, note: 'one person under a fallen balcony in the yard' }],
    decoys: [{ pos: V(blocks[2].cx - 15, .3, blocks[2].cz - 18), layer: 'ground', kind: 'radiator', label: 'a warm boiler' }],
    pockets,
    pois: { 'Block B': V(coll[0].bx, 2, coll[0].bz), 'Block F': V(coll[1].bx, 2, coll[1].bz), van: V(-100, 2, 4), centre: V(0, 0, 0) },
    blocks: blocks.map((b) => ({ id: b.id, pos: V(b.bx, 0, b.bz), w: b.w, d: b.d, collapsed: b.collapsed })),
  };
  const sky = { top: '#2E3166', horizon: '#B79AB7', fog: '#7E72A0', fogDensity: .0042, sun: { dir: V(-.75, .42, .35).normalize(), color: '#FFC9B0', intensity: 1.55 }, hemi: { sky: '#A8A2DA', ground: '#3E3762', intensity: .95 } };
  const bounds = new THREE.Box3(V(-118, 0, -72), V(92, 30, 72));
  const camera = { wide: { pos: V(-150, 105, 150), target: V(-8, 0, 0) }, top: { pos: V(-8, 250, 1), target: V(-8, 0, 0) }, van: { pos: V(-128, 22, 30), target: V(-100, 6, 4) } };
  return {
    group, sky, layers, surfaces, anchors, bounds, camera,
    cutaway(level) { upper.visible = level == null || level === false; },
    update() {},
    dispose() { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); },
  };
}

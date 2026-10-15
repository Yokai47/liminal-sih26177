// Placeholder world for the cave mission (used only if world.js is missing or broken). Contract: ACT4_SPEC 5.2.
// A block of rock seen from above with a branching passage system carved by random walks, pools, a sump, the mouth
// on the left and a dry shelf deep inside where the group waits.
import { makeKit } from '../placekit.js';

export function buildWorld(THREE, { seed = 1 } = {}) {
  const K = makeKit(THREE, seed * 29 + 5);
  const { r, rf, mat, instanced, layer, V } = K;
  const group = new THREE.Group(); group.name = 'cave';
  const W = 360, D = 200, CELL = 2, NX = W / CELL, NZ = D / CELL;
  const L = layer('cave', -W / 2, -D / 2, NX, NZ, CELL, 0, 1, { name: 'The cave', kind: '2.5d', outdoor: false, band: [0, 4] });
  const g = L.grid, open = (i, k, rad = 2, v = 0) => { for (let dk = -rad; dk <= rad; dk++) for (let di = -rad; di <= rad; di++) { const ii = i + di, kk = k + dk; if (ii > 0 && kk > 0 && ii < NX - 1 && kk < NZ - 1 && di * di + dk * dk <= rad * rad + 1) g[kk * NX + ii] = v; } };
  // main trunk from the mouth to the shelf, branches off it
  const trunk = []; let i = 3, k = NZ >> 1;
  while (i < NX - 12) { trunk.push([i, k]); open(i, k, 2); i++; k += Math.round((K.vnoise(i * .05, 3, seed) - .5) * 2); k = Math.max(12, Math.min(NZ - 12, k)); }
  for (let b = 0; b < 7; b++) { const s = trunk[Math.floor(rf(.1, .85) * trunk.length)]; let bi = s[0], bk = s[1], dz = r() < .5 ? -1 : 1; const len = rf(25, 60);
    for (let q = 0; q < len; q++) { open(bi, bk, 1 + (q % 9 < 5 ? 1 : 0)); bk += dz; if (r() < .45) bi += r() < .5 ? 1 : -1; bi = Math.max(3, Math.min(NX - 4, bi)); bk = Math.max(4, Math.min(NZ - 5, bk)); } }
  // pools and a sump (water to the roof: rock for drones)
  for (let q = 0; q < 4; q++) { const t = trunk[Math.floor(rf(.2, .8) * trunk.length)]; for (let dk = -2; dk <= 2; dk++) for (let di = -5; di <= 5; di++) { const c = (t[1] + dk) * NX + t[0] + di; if (g[c] === 0) g[c] = 3; } }
  // a sump across the trunk (water to the roof: rock for drones) and a dry bypass over it
  const si = Math.floor(trunk.length * .55), sm = trunk[si], ta = trunk[si - 10], tb = trunk[si + 10];
  const byRow = Math.max(4, Math.min(ta[1], sm[1], tb[1]) - 8);
  for (let kk = 1; kk < NZ - 1; kk++) for (let di = -1; di <= 1; di++) { const c = kk * NX + sm[0] + di; if ((g[c] === 0 || g[c] === 3) && Math.abs(kk - sm[1]) < 6) g[c] = 1; }
  for (let ii = ta[0]; ii <= tb[0]; ii++) open(ii, byRow, 1);
  for (let kk = byRow; kk <= ta[1]; kk++) open(ta[0], kk, 1);
  for (let kk = byRow; kk <= tb[1]; kk++) open(tb[0], kk, 1);
  const end = trunk[trunk.length - 1]; open(end[0] + 4, end[1], 4); const shelf = V(L.x0 + (end[0] + 4.5) * CELL, .8, L.z0 + (end[1] + .5) * CELL);
  // outside the mountain: the valley at the mouth is open (the base is there)
  for (let kk = 0; kk < NZ; kk++) for (let ii = 0; ii < 3; ii++) g[kk * NX + ii] = ii < 2 ? 2 : g[kk * NX + ii];
  // 3-D: rock as dark instanced columns at the edges of the passages, the passage floor as one surface
  const rock = [];
  for (let kk = 1; kk < NZ - 1; kk++) for (let ii = 1; ii < NX - 1; ii++) { const c = kk * NX + ii; if (g[c] !== 1) continue; const edge = g[c - 1] !== 1 || g[c + 1] !== 1 || g[c - NX] !== 1 || g[c + NX] !== 1; if (!edge) continue; const h = rf(2.6, 4.4); rock.push({ x: L.x0 + (ii + .5) * CELL, y: h / 2, z: L.z0 + (kk + .5) * CELL, sx: CELL * 1.05, sy: h, sz: CELL * 1.05, c: r() < .5 ? '#5B5780' : '#4E4A73' }); }
  group.add(instanced(new THREE.BoxGeometry(1, 1, 1), mat('#ffffff', { flat: true }), rock));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), mat('#3B3A5E')); floor.position.y = .02; floor.receiveShadow = true; floor.userData.layer = 'cave'; group.add(floor);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, D + 40).rotateX(-Math.PI / 2), mat('#2A2948')); top.position.y = -.3; group.add(top);
  const people = []; for (let q = 0; q < 13; q++) people.push({ pos: V(shelf.x + rf(-3, 3), .8, shelf.z + rf(-3, 3)), layer: 'cave', hidden: true, count: 1 });
  const mouth = V(L.x0 + 2 * CELL, .5, L.z0 + (NZ / 2) * CELL);
  const anchors = { base: V(mouth.x - 2, .3, mouth.z + 6), tether: { station: V(mouth.x - 4, .5, mouth.z + 10), hover: V(mouth.x + 4, 7, mouth.z + 4), cable: 14 }, people, decoys: [], ugvRoutes: [], boats: [], water: [{ pos: V(L.x0 + sm[0] * CELL, -1, L.z0 + sm[1] * CELL) }], pois: { 'the shelf': shelf, 'the mouth': mouth } };
  const sky = { top: '#1A1C3A', horizon: '#34376B', fog: '#30336A', fogDensity: .0012, sun: { dir: V(-.5, .8, .3).normalize(), color: '#DCCBEA', intensity: .9 }, hemi: { sky: '#8E8AC8', ground: '#2C2F5C', intensity: .5 } };
  return { group, sky, layers: [L], surfaces: [floor], anchors, bounds: new THREE.Box3(V(-W / 2, -2, -D / 2), V(W / 2, 10, D / 2)),
    camera: { wide: { pos: V(-W * .55, W * .7, D * 1.2), target: V(0, 0, 0) }, top: { pos: V(0, W * 1.4, 1), target: V(0, 0, 0) } }, cutaway() {}, update() {}, dispose() {} };
}

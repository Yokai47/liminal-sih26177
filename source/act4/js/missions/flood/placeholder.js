// Placeholder world for the flood mission (used only if world.js is missing or broken). Contract: ACT4_SPEC 5.2.
// A square of floodwater with drowned houses (roofs poking out), palms, a relief camp on a mound and a mast boat.
import { makeKit } from '../placekit.js';

export function buildWorld(THREE, { seed = 1 } = {}) {
  const K = makeKit(THREE, seed * 13 + 3);
  const { r, rf, mat, instanced, layer, setDisc, box, plane, V } = K;
  const group = new THREE.Group(); group.name = 'flood';
  const H = 380, CELL = 5, N = Math.round(H * 2 / CELL);
  const G = layer('ground', -H, -H, N, N, CELL, 0, 3, { name: 'The flood', outdoor: true, band: [-1, 8] });
  const water = plane(H * 2, H * 2, '#6F8FC0', 0, 0, 0, { rough: .35 }); water.userData.layer = 'ground'; group.add(water); group.add(plane(3000, 3000, '#7F93B5', -.6));
  const camp = { x: H * .72, z: H * .2 };
  setDisc(G, camp.x, camp.z, 40, 0);
  const hill = new THREE.Mesh(new THREE.CylinderGeometry(42, 52, 3, 32), mat('#A9B59E')); hill.position.set(camp.x, .5, camp.z); hill.receiveShadow = true; group.add(hill);
  const roofs = [], walls = [], people = [], trees = [];
  for (let n = 0; n < 70; n++) {
    const x = rf(-H + 30, H - 30), z = rf(-H + 30, H - 30); if (Math.hypot(x - camp.x, z - camp.z) < 70) continue;
    const w = rf(7, 12), d = rf(7, 11), ry = rf(-.4, .4);
    roofs.push({ x, y: 1.3, z, sx: w, sy: 1.2, sz: d, ry, c: r() < .5 ? '#E9B8B5' : '#F2D3B7' }); walls.push({ x, y: .2, z, sx: w * .9, sy: 1.4, sz: d * .9, ry, c: '#E6DDE2' });
    setDisc(G, x, z, Math.max(w, d) * .5, 0);
    if (people.length < 10 && r() < .2) people.push({ pos: V(x, 2.2, z), layer: 'ground', hidden: true, count: 1 + ((r() * 4) | 0), name: `roof ${n}` });
  }
  for (let n = 0; n < 160; n++) { const x = rf(-H, H), z = rf(-H, H); if (Math.hypot(x - camp.x, z - camp.z) < 60) continue; const s = rf(2, 4); trees.push({ x, y: s * .9, z, sx: s, sy: s * .7, sz: s, c: r() < .5 ? '#8FA79A' : '#7E9A8B' }); }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  group.add(instanced(unit, mat('#ffffff'), walls), instanced(new THREE.ConeGeometry(.75, 1, 4), mat('#ffffff', { flat: true }), roofs.map((q) => ({ ...q, ry: q.ry + Math.PI / 4 }))), instanced(new THREE.IcosahedronGeometry(1, 1), mat('#ffffff', { flat: true }), trees));
  // live lines in the water (hazard)
  for (let k = 0; k < 3; k++) { const x = rf(-H * .6, H * .4), z = rf(-H * .6, H * .6); setDisc(G, x, z, 8, 4); group.add(box(.3, 6, .3, '#6E6B91', x, 3, z)); }
  // outside the search: a margin
  for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) if (i < 2 || k < 2 || i >= N - 2 || k >= N - 2) G.grid[k * N + i] = 2;
  const st = V(camp.x - 70, .4, camp.z - 40); const boat = box(4, 1, 2, '#F3E6DA', st.x, .5, st.z); group.add(boat);
  const boats = []; for (let k = 0; k < 4; k++) boats.push(V(camp.x - 52 - k * 6, 0, camp.z + 30 + k * 3));
  const anchors = { base: V(camp.x, 2, camp.z), tether: { station: V(st.x, 1.1, st.z), hover: V(st.x, 40, st.z), cable: 46 }, boats, people, decoys: [], ugvRoutes: [], pois: { camp: V(camp.x, 2, camp.z) } };
  const sky = { top: '#A3ABC6', horizon: '#D3D9E3', fog: '#D3D9E3', fogDensity: .0009, sun: { dir: V(.6, .68, .42).normalize(), color: '#F4E6DE', intensity: 2 }, hemi: { sky: '#DDE4EE', ground: '#77808E', intensity: 1.05 } };
  return { group, sky, layers: [G], surfaces: [water], anchors, bounds: new THREE.Box3(V(-H, -2, -H), V(H, 30, H)),
    camera: { wide: { pos: V(-H * 1.1, H * .8, H * 1.2), target: V(0, 0, 0) }, top: { pos: V(0, H * 2.6, 1), target: V(0, 0, 0) } }, cutaway() {}, update() {}, dispose() {} };
}

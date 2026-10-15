// Placeholder world for the forest mission (used only if world.js is missing or broken). Contract: ACT4_SPEC 5.2.
// Rolling forest: a canopy layer (crown density per cell, gaps) above an understorey layer (trunks as obstacles).
import { makeKit } from '../placekit.js';

export function buildWorld(THREE, { seed = 1 } = {}) {
  const K = makeKit(THREE, seed * 41 + 9);
  const { r, rf, mat, instanced, layer, V } = K;
  const group = new THREE.Group(); group.name = 'forest';
  const H = 220, CU = 4, CL = 2, NU = H * 2 / CU, NL = H * 2 / CL;
  const up = layer('canopy', -H, -H, NU, NU, CU, 26, 0, { name: 'Above the canopy', outdoor: true, band: [6, 18], top: new Float32Array(NU * NU), density: new Uint8Array(NU * NU) });
  const low = layer('understorey', -H, -H, NL, NL, CL, 0, 0, { name: 'Under the canopy', outdoor: false, band: [1.5, 6], ground: new Float32Array(NL * NL) });
  for (let k = 0; k < NU; k++) for (let i = 0; i < NU; i++) { const c = k * NU + i, x = -H + (i + .5) * CU, z = -H + (k + .5) * CU, d = K.fbm(x * .012, z * .012, seed) * 1.5; up.density[c] = Math.max(0, Math.min(255, (d - .35) * 400)); up.top[c] = 18 + d * 6; if (i < 2 || k < 2 || i >= NU - 2 || k >= NU - 2) up.grid[c] = 2; }
  const trees = [], trunks = [];
  for (let n = 0; n < 900; n++) { const x = rf(-H + 4, H - 4), z = rf(-H + 4, H - 4), cu = Math.floor((x + H) / CU) + Math.floor((z + H) / CU) * NU; if (up.density[cu] < 60 && r() < .7) continue;
    const s = rf(4, 7.5), h = up.top[cu] - s * .4; trees.push({ x, y: h, z, sx: s, sy: s * .8, sz: s, c: ['#6F8F7A', '#86A592', '#9DB8A0'][(r() * 3) | 0] }); trunks.push({ x, y: h / 2, z, sx: .7, sy: h, sz: .7, c: '#6E5A66' });
    const i = Math.floor((x + H) / CL), k = Math.floor((z + H) / CL); if (i >= 0 && k >= 0 && i < NL && k < NL) low.grid[k * NL + i] = 1; }
  for (let k = 0; k < NL; k++) for (let i = 0; i < NL; i++) if (i < 2 || k < 2 || i >= NL - 2 || k >= NL - 2) low.grid[k * NL + i] = 2;
  group.add(instanced(new THREE.IcosahedronGeometry(1, 1), mat('#ffffff', { flat: true }), trees), instanced(new THREE.CylinderGeometry(.4, .55, 1, 7), mat('#ffffff'), trunks));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2).rotateX(-Math.PI / 2), mat('#7C8A6E')); floor.receiveShadow = true; floor.userData.layer = 'understorey'; group.add(floor);
  { const out = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), mat('#6B7A60')); out.position.y = -.2; out.receiveShadow = true; group.add(out); }
  const base = V(-H - 20, .2, 0);
  const anchors = { base, tether: { station: V(base.x - 3, .6, 6), hover: V(base.x + 4, 34, 4), cable: 38 }, people: [{ pos: V(rf(40, H - 30), .4, rf(-H + 30, H - 30)), layer: 'understorey', hidden: true, count: 1, name: 'the trekker' }],
    decoys: [{ pos: V(rf(-H + 40, 0), .5, rf(-H + 30, H - 30)), layer: 'understorey', kind: 'deer', label: 'a deer' }], ugvRoutes: [], boats: [], pois: { trailhead: base } };
  const sky = { top: '#9DA2D2', horizon: '#F1CBA8', fog: '#F1CBA8', fogDensity: .0016, sun: { dir: V(-.84, .41, .36).normalize(), color: '#FFC892', intensity: 2.6 }, hemi: { sky: '#C9C4EA', ground: '#5C6450', intensity: 1.15 } };
  return { group, sky, layers: [up, low], surfaces: [floor], anchors, bounds: new THREE.Box3(V(-H - 30, -1, -H), V(H, 30, H)),
    camera: { wide: { pos: V(-H * 1.2, H * .9, H * 1.2), target: V(0, 0, 0) }, top: { pos: V(0, H * 2.6, 1), target: V(0, 0, 0) } }, cutaway() {}, update() {}, dispose() {} };
}

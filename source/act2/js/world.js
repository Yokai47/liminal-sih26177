/* LIMINAL · Act 2 · world.js
   The collapsed floor: ~40 × 34 m, 11 spaces, 4 survivors, 3 decoys, 8 hazards.
   Everything here is GROUND TRUTH. The autonomy (brain.js) never reads it; it only gets sensor returns.
   Builds: textured render meshes (camera layer), thermal materials, one merged BVH of every surface
   (walls, props AND people: LiDAR rays and occlusion tests hit them), and the sampled point set the LiDAR reveals. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { MeshBVH } from 'three-mesh-bvh';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const CEIL = 3.0;
export const HOME = { x: 5, z: -1.6, yaw: 0 };
export const BOUNDS = { x0: -2, x1: 42, z0: -36, z1: 2 };

// ---------- floor plan (metres; x east, z south, so "north" is −z) ----------
export const ROOMS = {
  L: { x0: 0, x1: 10, z0: -8, z1: 0, wall: 'lobby_w', floor: 'checker', ceil: 'ceil' },
  C1: { x0: 10, x1: 40, z0: -8, z1: -5, wall: 'corr_w', floor: 'hex', ceil: 'ceil' },
  O: { x0: 6, x1: 18, z0: -23, z1: -8, wall: 'office_w', floor: 'carpet', ceil: 'ceil' },
  C4: { x0: 3, x1: 6, z0: -23, z1: -8, wall: 'corr_w', floor: 'hex', ceil: 'ceil' },
  C2: { x0: 18, x1: 21, z0: -26, z1: -8, wall: 'corr_w', floor: 'hex', ceil: 'ceil' },
  C3: { x0: 3, x1: 18, z0: -26, z1: -23, wall: 'corr_w', floor: 'hex', ceil: 'ceil' },
  R1: { x0: 21, x1: 30, z0: -15, z1: -8, wall: 'store_w', floor: 'conc', ceil: 'ceil' },
  R2: { x0: 30, x1: 40, z0: -15, z1: -8, wall: 'server_w', floor: 'conc', ceil: 'ceil' },
  W: { x0: 21, x1: 30, z0: -24, z1: -15, wall: 'wash_w', floor: 'wash_f', ceil: 'ceil' },
  S: { x0: 30, x1: 40, z0: -24, z1: -15, wall: 'conc', floor: 'conc', ceil: 'conc' },
  V: { x0: 8, x1: 20, z0: -34, z1: -26, wall: 'void_w', floor: 'gravel', ceil: 'conc' },
};
const OPEN = [['L', 'C1'], ['L', 'C4'], ['C1', 'C2'], ['C4', 'C3'], ['C3', 'C2']];
const DOORS = [ // [roomA, roomB, centre along the shared line, width, breach?]
  ['C1', 'O', 12.5, 1.5], ['C4', 'O', -11.0, 1.5], ['C2', 'O', -19.5, 1.5], ['C1', 'R1', 24.5, 1.5], ['C2', 'R1', -11.5, 1.5],
  ['C2', 'W', -19.5, 1.5], ['W', 'S', -21.0, 1.5], ['S', 'R2', 33.5, 1.6], ['C1', 'R2', 37.0, 1.5], ['C3', 'V', 13.2, 1.7, true]];
const INNER = [ // interior walls: x0,z0,x1,z1,material
  [6, -15.5, 14, -15.5, 'office_w']];

// ---------- materials ----------
// point classes: LiDAR return intensity, colour tint, base thermal value (0 cold … 1 very hot)
export const CLS = {
  plaster: { i: .5, heat: .1 }, tile: { i: .78, heat: .09 }, floor: { i: .42, heat: .085 }, ceiling: { i: .3, heat: .11 }, concrete: { i: .52, heat: .09 },
  rubble: { i: .46, heat: .085 }, metal: { i: .95, heat: .06 }, wood: { i: .62, heat: .1 }, fabric: { i: .28, heat: .12 }, glass: { i: .85, heat: .07 },
  person: { i: .7, heat: .9 }, figure: { i: .8, heat: .13 }, cardboard: { i: .4, heat: .1 }, redmetal: { i: .9, heat: .2 }, plastic: { i: .66, heat: .1 },
  plant: { i: .35, heat: .14 }, water: { i: .2, heat: .03 }, machine: { i: .85, heat: .62 }, electric: { i: .9, heat: .5 }, fire: { i: .9, heat: 1 },
};
export const CLS_ID = Object.fromEntries(Object.keys(CLS).map((k, i) => [k, i]));

const TEXSETS = { // key: [uv metres per tile, class, roughness fallback, tint]
  lobby_w: [2.2, 'plaster'], corr_w: [2.2, 'plaster'], office_w: [2.2, 'plaster'], store_w: [2.4, 'plaster'], server_w: [2.2, 'plaster'], void_w: [2.4, 'plaster'],
  ceil: [2.5, 'ceiling'], conc: [2.6, 'concrete'], checker: [1.6, 'floor'], hex: [1.2, 'floor'], carpet: [1.8, 'fabric'], wash_w: [1.2, 'tile'], wash_f: [.8, 'tile'],
  rubble: [1.4, 'rubble'], gravel: [1.6, 'rubble'], wood: [1.6, 'wood'], planks: [1.8, 'wood'], rust: [1.4, 'metal'], steel: [1.4, 'metal'], fabric: [1.2, 'fabric'],
};

export async function buildWorld({ base = 'assets/', tier = 'laptop', onProgress = () => {}, pts = 0 } = {}) {
  const PH = tier === 'phone';
  const rnd = mulberry(7);
  const texLoader = new THREE.TextureLoader();
  const loadTex = (url, srgb) => new Promise(res => texLoader.load(url, t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, () => res(null)));

  // textures
  const M = {}; // material key -> MeshStandardMaterial
  await Promise.all(Object.keys(TEXSETS).map(async k => {
    const [c, n, r] = await Promise.all([loadTex(`${base}tex/${k}_c.jpg`, true), PH ? null : loadTex(`${base}tex/${k}_n.jpg`), loadTex(`${base}tex/${k}_r.jpg`)]);
    M[k] = new THREE.MeshStandardMaterial({ map: c, normalMap: n, roughnessMap: r, roughness: 1, metalness: k === 'steel' || k === 'rust' ? .35 : 0, color: c ? 0xffffff : 0x8a8a86 });
    if (n) M[k].normalScale.set(.8, .8);
  }));
  onProgress(.2);
  const graffiti = await Promise.all([loadTex(`${base}tex/graffiti_c.jpg`, true), loadTex(`${base}tex/graffiti_o.jpg`)]);

  // glTF props
  const PROPS = ['metal_office_desk', 'SchoolChair_01', 'plastic_monobloc_chair_01', 'cardboard_box_01', 'worn_metal_rack', 'small_lpg_tank', 'WetFloorSign_01', 'power_box_01',
    'korean_fire_extinguisher_01', 'mounted_fluorescent_lights', 'caged_hanging_light', 'concrete_road_barrier_02', 'Barrel_01', 'portable_generator', 'security_camera_01', 'medical_box',
    'modular_industrial_pipes_01', 'trashbag', 'fire_alarm', 'potted_plant_01', 'potted_plant_02', 'wall_clock', 'classic_laptop', 'Television_01', 'television_02', 'metal_jerrycan'];
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const G = {}; let nDone = 0;
  const loadGLB = name => loader.loadAsync(`${base}models/${name}.glb`).then(g => { G[name] = g.scene; g.scene.updateMatrixWorld(true); }).catch(e => console.warn('act2: model', name, e)).finally(() => onProgress(.2 + .55 * (++nDone / (PROPS.length + 4))));
  const humanP = loader.loadAsync(`${base}models/survivor.glb`).catch(() => null).finally(() => onProgress(.2 + .55 * (++nDone / (PROPS.length + 4))));
  const extra = {};
  const extraP = ['figure', 'bust', 'stair'].map(n => loader.loadAsync(`${base}models/${n}.glb`).then(g => { extra[n] = g; }).catch(() => null).finally(() => onProgress(.2 + .55 * (++nDone / (PROPS.length + 4)))));
  await Promise.all([...PROPS.map(loadGLB), humanP, ...extraP]);
  const humanGLTF = await humanP;

  // ---------- registries ----------
  const OBJ = [];                         // object table: { name, cls, heat, tgt }
  const obj = (name, cls, heat = CLS[cls].heat, tgt = -1) => { OBJ.push({ name, cls, heat, tgt }); return OBJ.length - 1; };
  const objByMat = {};
  const matObj = k => objByMat[k] ?? (objByMat[k] = obj('struct:' + k, TEXSETS[k][1]));
  const pieces = [];                      // world-space geometry for BVH + sampling: { g, oid, w }
  const rgbByMat = {};                    // material key -> [geometries] (merged into one mesh each)
  const sceneObjs = [];                   // { object3D, heat, rgbOnly }
  const addStruct = (g, k, w = 1, collide = true) => { worldUV(g, TEXSETS[k][0]); (rgbByMat[k] = rgbByMat[k] || []).push(g); if (collide) pieces.push({ g, oid: matObj(k), w }); };

  // ---------- walls (boxes centred on each line, faces kept only where a space is in front of them) ----------
  const T = .2, EXT = .1;
  const inRoom = (x, z, pad = .16) => { for (const [id, r] of Object.entries(ROOMS)) if (x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad) return id; return null; };
  const roomAt = (x, z) => { for (const [id, r] of Object.entries(ROOMS)) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return id; return null; };
  function wallBox(x0, x1, y0, y1, z0, z1, forceMat) {
    const faces = [
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]]];
    for (const [a, b, c, d, n] of faces) {
      if (n[1] < 0 && y0 < .01) continue;
      const cx = (a[0] + c[0]) / 2 + n[0] * .17, cz = (a[2] + c[2]) / 2 + n[2] * .17;
      const id = n[1] < 0 ? inRoom((x0 + x1) / 2, (z0 + z1) / 2, .3) : inRoom(cx, cz);
      if (!id) continue;
      const k = forceMat || ROOMS[id].wall;
      addStruct(quad(a, b, c, d), k, 1);
    }
  }
  // shared-edge bookkeeping
  const ids = Object.keys(ROOMS);
  const segs = []; // { axis:'x'|'z', at, a, b } solid wall pieces
  const lintels = [];
  const holes = {}; // key line -> [[a,b,breach]]
  const lineKey = (axis, at) => axis + ':' + at;
  const shared = (A, B) => { const a = ROOMS[A], b = ROOMS[B];
    if (a.x1 === b.x0 || a.x0 === b.x1) { const at = a.x1 === b.x0 ? a.x1 : a.x0, lo = Math.max(a.z0, b.z0), hi = Math.min(a.z1, b.z1); if (hi > lo) return { axis: 'x', at, lo, hi }; }
    if (a.z1 === b.z0 || a.z0 === b.z1) { const at = a.z1 === b.z0 ? a.z1 : a.z0, lo = Math.max(a.x0, b.x0), hi = Math.min(a.x1, b.x1); if (hi > lo) return { axis: 'z', at, lo, hi }; }
    return null; };
  for (const [A, B] of OPEN) { const s = shared(A, B); (holes[lineKey(s.axis, s.at)] = holes[lineKey(s.axis, s.at)] || []).push([s.lo, s.hi, 'open']); }
  for (const [A, B, c, wd, breach] of DOORS) { const s = shared(A, B); (holes[lineKey(s.axis, s.at)] = holes[lineKey(s.axis, s.at)] || []).push([c - wd / 2, c + wd / 2, breach ? 'breach' : 'door']); }
  // every distinct edge line, as the union of room edges on it
  const lines = {};
  for (const id of ids) { const r = ROOMS[id];
    for (const [axis, at, lo, hi] of [['z', r.z0, r.x0, r.x1], ['z', r.z1, r.x0, r.x1], ['x', r.x0, r.z0, r.z1], ['x', r.x1, r.z0, r.z1]]) (lines[lineKey(axis, at)] = lines[lineKey(axis, at)] || { axis, at, iv: [] }).iv.push([lo, hi]); }
  for (const [key, L] of Object.entries(lines)) {
    const iv = L.iv.sort((p, q) => p[0] - q[0]); const merged = [];
    for (const [lo, hi] of iv) { const m = merged[merged.length - 1]; if (m && lo <= m[1] + 1e-6) m[1] = Math.max(m[1], hi); else merged.push([lo, hi]); }
    const hs = (holes[key] || []).sort((p, q) => p[0] - q[0]);
    for (const [lo, hi] of merged) {
      let cur = lo, startExt = true;
      for (const [h0, h1, kind] of hs) { if (h1 <= lo || h0 >= hi) continue;
        if (h0 > cur) segs.push({ axis: L.axis, at: L.at, a: cur - (startExt ? EXT : 0), b: h0 });
        if (kind === 'door') lintels.push({ axis: L.axis, at: L.at, a: h0, b: h1, y0: 2.2 });
        if (kind === 'open') lintels.push({ axis: L.axis, at: L.at, a: h0, b: h1, y0: 2.72 });
        if (kind === 'breach') lintels.push({ axis: L.axis, at: L.at, a: h0 - .1, b: h1 + .2, y0: 2.45, breach: true });
        cur = Math.max(cur, h1); startExt = false; }
      if (hi > cur) segs.push({ axis: L.axis, at: L.at, a: cur - (startExt ? EXT : 0), b: hi + EXT });
    }
  }
  for (const s of segs) s.axis === 'z' ? wallBox(s.a, s.b, 0, CEIL, s.at - T / 2, s.at + T / 2) : wallBox(s.at - T / 2, s.at + T / 2, 0, CEIL, s.a, s.b);
  for (const s of lintels) s.axis === 'z' ? wallBox(s.a, s.b, s.y0, CEIL, s.at - T / 2, s.at + T / 2) : wallBox(s.at - T / 2, s.at + T / 2, s.y0, CEIL, s.a, s.b);
  for (const [x0, z0, x1, z1, k] of INNER) { const t = .14; x0 === x1 ? wallBox(x0 - t / 2, x0 + t / 2, 0, CEIL, Math.min(z0, z1), Math.max(z0, z1), k) : wallBox(Math.min(x0, x1), Math.max(x0, x1), 0, CEIL, z0 - t / 2, z0 + t / 2, k); }
  // door jamb strips under each door: floor patch so there is no gap
  // floors & ceilings (tiny per-room offsets so overlapping strips at doorways don't z-fight)
  ids.forEach((id, i) => { const r = ROOMS[id], e = .1, yo = i * .0007;
    const f = quad([r.x0 - e, yo, r.z1 + e], [r.x1 + e, yo, r.z1 + e], [r.x1 + e, yo, r.z0 - e], [r.x0 - e, yo, r.z0 - e]); addStruct(f, r.floor, .55);
    const holesC = id === 'S' ? [[35.6, 38.4, -24, -21.6]] : id === 'V' ? [[14.5, 19.5, -34, -30.5]] : [];
    for (const [x0, x1, z0, z1] of rectMinus([r.x0 - e, r.x1 + e, r.z0 - e, r.z1 + e], holesC)) addStruct(quad([x0, CEIL - yo, z0], [x1, CEIL - yo, z0], [x1, CEIL - yo, z1], [x0, CEIL - yo, z1]), r.ceil, .28);
  });
  // above the ceiling holes: a dark slab one storey up, so rays and views find something
  addStruct(quad([35.6, 5.8, -24], [38.4, 5.8, -24], [38.4, 5.8, -21.6], [35.6, 5.8, -21.6]), 'conc', .1);
  for (const [a, b, c, d] of [[[38.4, 3, -21.6], [35.6, 3, -21.6], [35.6, 5.8, -21.6], [38.4, 5.8, -21.6]], [[35.6, 3, -21.6], [35.6, 3, -24], [35.6, 5.8, -24], [35.6, 5.8, -21.6]],
    [[38.4, 3, -24], [38.4, 3, -21.6], [38.4, 5.8, -21.6], [38.4, 5.8, -24]], [[35.6, 3, -24], [38.4, 3, -24], [38.4, 5.8, -24], [35.6, 5.8, -24]]]) addStruct(quad(a, b, c, d), 'conc', .2);

  // ---------- procedural geometry helpers ----------
  const tf = (g, x, y, z, ry = 0, rx = 0, rz = 0, s = 1) => { const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s)); g.applyMatrix4(m); return g; };
  const boxG = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  const slab = (x, y, z, sx, sy, sz, ry, rx, rz, k = 'conc', w = 1) => addStruct(tf(boxG(sx, sy, sz).toNonIndexed(), x, y, z, ry, rx, rz), k, w);
  const chunk = (s) => { const g = new THREE.IcosahedronGeometry(s, 0); const p = g.attributes.position; const map = new Map();
    for (let i = 0; i < p.count; i++) { const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`; let j = map.get(key); if (!j) { j = [.7 + rnd() * .55, .55 + rnd() * .5, .7 + rnd() * .55]; map.set(key, j); } p.setXYZ(i, p.getX(i) * j[0], p.getY(i) * j[1], p.getZ(i) * j[2]); }
    g.computeVertexNormals(); return g; };
  const rubble = (x, z, n, spread, h = 1, k = 'rubble') => { for (let i = 0; i < n; i++) { const s = (.14 + rnd() * .38) * h, a = rnd() * 6.28, d = Math.sqrt(rnd()) * spread;
      addStruct(tf(chunk(s), x + Math.cos(a) * d, s * .45, z + Math.sin(a) * d, rnd() * 6, rnd() * .6, rnd() * .6), k, 1.3);
      if (rnd() < .18) addStruct(tf(new THREE.CylinderGeometry(.012, .012, .7 + rnd() * .7, 5).toNonIndexed(), x + (rnd() - .5) * spread, .2, z + (rnd() - .5) * spread, rnd() * 3, 1.2 + rnd() * .6, rnd() * .5), 'rust', 1.5); } };
  const heap = (x, z, r, top, n) => { // a mound: chunks stacked in a cone
    for (let i = 0; i < n; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * r, s = .16 + rnd() * .34, y = Math.max(s * .4, top * (1 - d / r) - rnd() * .25);
      addStruct(tf(chunk(s), x + Math.cos(a) * d, y, z + Math.sin(a) * d, rnd() * 6, rnd(), rnd()), 'rubble', 1.3); } };
  const cyl = (x, y, z, r, len, ry, rx, rz, k = 'steel', seg = 10) => addStruct(tf(new THREE.CylinderGeometry(r, r, len, seg).toNonIndexed(), x, y, z, ry, rx, rz), k, 1.4);
  const pipeRun = (x0, z0, x1, z1, y, r = .06, k = 'rust') => { const l = Math.hypot(x1 - x0, z1 - z0); cyl((x0 + x1) / 2, y, (z0 + z1) / 2, r, l, Math.atan2(x1 - x0, z1 - z0), Math.PI / 2, 0, k); };
  const cable = (x, z, len, tilt) => cyl(x, CEIL - len / 2 * Math.cos(tilt), z, .014, len, rnd() * 3, tilt, 0, 'fabric', 5);

  // glTF placement
  const placed = [];
  const _box = new THREE.Box3(), _v = new THREE.Vector3();
  const sizeOf = name => { if (!G[name]) return null; if (!G[name].userData.size) { _box.setFromObject(G[name]); G[name].userData.size = _box.getSize(new THREE.Vector3()); G[name].userData.min = _box.min.clone(); G[name].userData.ctr = _box.getCenter(new THREE.Vector3()); } return G[name].userData; };
  function prop(name, x, z, ry = 0, o = {}) {
    const src = G[name]; if (!src) return null; if (PH && o.lite) return null;
    const info = sizeOf(name); const s = o.fit ? o.fit / Math.max(info.size.x, info.size.y, info.size.z) : (o.s || 1);
    const root = new THREE.Group(); const inner = src.clone(true);
    inner.position.set(-info.ctr.x, -info.min.y, -info.ctr.z); root.add(inner);       // pivot at the base centre
    root.position.set(x, o.y || 0, z); root.rotation.set(o.rx || 0, ry, o.rz || 0, 'YXZ'); root.scale.setScalar(s); root.updateMatrixWorld(true);
    const cls = o.cls || 'metal', heat = o.heat ?? CLS[cls].heat, oid = o.oid ?? obj(name, cls, heat, o.tgt ?? -1);
    root.traverse(m => { if (!m.isMesh) return; if (o.tint) { m.material = m.material.clone(); m.material.color.multiply(new THREE.Color(o.tint)); }
      if (m.material.emissiveMap && !o.glow) m.material.emissive.setHex(0);
      if (o.collide !== false) { const g = new THREE.BufferGeometry(); g.setAttribute('position', posF(m.geometry.attributes.position)); if (m.geometry.index) g.setIndex(m.geometry.index.clone()); g.applyMatrix4(m.matrixWorld); pieces.push({ g, oid, w: o.w ?? 1.6 }); } });
    sceneObjs.push({ o: root, heat }); placed.push({ name, root, oid }); return { root, oid };
  }

  // ---------- people ----------
  const humanGeo = frac => humanGLTF ? bakeSkinned(humanGLTF, frac) : null;
  const skin = humanGLTF ? (() => { let mm; humanGLTF.scene.traverse(o => { if (o.isSkinnedMesh && !mm) mm = o.material; }); return new THREE.MeshStandardMaterial({ map: mm?.map || null, roughness: .85, color: 0xd8cfc4 }); })() : new THREE.MeshStandardMaterial({ color: 0x8c6f5a, roughness: .8 });
  function person(g, mat, x, y, z, ry, rx, rz, oid) {
    const geo = g.clone(); tf(geo, x, y, z, ry, rx, rz); const mesh = new THREE.Mesh(geo, mat); sceneObjs.push({ o: mesh, heat: OBJ[oid].heat });
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', geo.attributes.position.clone()); if (geo.index) pg.setIndex(geo.index.clone()); pieces.push({ g: pg, oid, w: 3.2 });
    return geo; }
  const figureGeo = extra.figure ? normalised(extra.figure.scene, 1.78) : simpleFigure();
  const bustGeo = extra.bust ? normalised(extra.bust.scene, .44) : null;

  // targets & hazards (truth). tgt index = slot in the PointPainting uniforms
  const TG = [];
  const target = (o) => { o.i = TG.length; TG.push(o); return o; };
  const P1 = target({ id: 'P1', kind: 'person', name: 'Survivor', voice: 'voice', pos: new THREE.Vector3(9.5, .3, -21.3), temp: 35.8, note: 'conscious · calling for help' });
  const P2 = target({ id: 'P2', kind: 'person', name: 'Survivor', voice: 'moan', pos: new THREE.Vector3(25.4, .3, -20.7), temp: 34.9, note: 'injured · moaning' });
  const P3 = target({ id: 'P3', kind: 'person', name: 'Survivor', voice: 'tap', pos: new THREE.Vector3(36.6, .62, -17.7), temp: 35.2, note: 'trapped · tapping a pipe' });
  const P4 = target({ id: 'P4', kind: 'person', name: 'Survivor', voice: null, pos: new THREE.Vector3(16.9, .3, -28.6), temp: 33.6, note: 'unconscious · silent' });
  const D1 = target({ id: 'D1', kind: 'mannequin', name: 'Mannequin', pos: new THREE.Vector3(22.4, 1.05, -9.2), temp: 21.0 });
  const D2 = target({ id: 'D2', kind: 'machine', name: 'Generator', pos: new THREE.Vector3(34.6, .35, -6.3), temp: 38.5 });
  const D3 = target({ id: 'D3', kind: 'fire', name: 'Fire', pos: new THREE.Vector3(28.2, .55, -13.7), temp: 420 });
  const HZ = [];
  const hazard = (o) => { o.i = TG.length; o.kind = 'hazard'; TG.push(o); HZ.push(o); return o; };
  const H_FIRE = hazard({ id: 'H1', name: 'FIRE', pos: D3.pos, selfLit: true, link: 'D3' });
  const H_LPG = hazard({ id: 'H2', name: 'LPG CYLINDER', sub: '1.4 m from fire', pos: new THREE.Vector3(29.2, .35, -12.3) });
  const H_FUEL = hazard({ id: 'H3', name: 'FUEL DRUMS', pos: new THREE.Vector3(29.0, .45, -9.4) });
  const H_ELEC = hazard({ id: 'H4', name: 'LIVE ELECTRICAL', sub: 'arcing panel', pos: new THREE.Vector3(39.55, 1.3, -11.5), selfLit: true });
  const H_FLOOD = hazard({ id: 'H5', name: 'FLOODING', sub: 'burst pipe', pos: new THREE.Vector3(27.6, .08, -18.4) });
  const H_CRACK = hazard({ id: 'H6', name: 'STRUCTURAL CRACK', pos: new THREE.Vector3(30.12, 1.7, -17.6) });
  const H_CEIL = hazard({ id: 'H7', name: 'UNSTABLE CEILING', pos: new THREE.Vector3(26.0, 2.25, -6.1) });
  const H_BLOCK = hazard({ id: 'H8', name: 'COLLAPSE', sub: 'corridor blocked', pos: new THREE.Vector3(29.5, 1.0, -6.5) });

  // ---------- LOBBY ----------
  prop('metal_office_desk', 7.6, -3.0, -Math.PI / 2, { cls: 'metal' });
  prop('classic_laptop', 7.5, -3.1, -Math.PI / 2 + .3, { y: .79, cls: 'plastic', lite: true });
  prop('plastic_monobloc_chair_01', 2.0, -2.6, .4, { cls: 'plastic' }); prop('plastic_monobloc_chair_01', 2.9, -2.3, -.3, { cls: 'plastic' });
  prop('plastic_monobloc_chair_01', 1.6, -5.7, 1.1, { cls: 'plastic', rx: Math.PI / 2, y: .3 });
  prop('potted_plant_01', .65, -.7, 0, { cls: 'plant', lite: true }); prop('potted_plant_02', 9.3, -.7, 2, { cls: 'plant', lite: true });
  prop('fire_alarm', .14, -4.0, Math.PI / 2, { y: 1.35, cls: 'redmetal', collide: false });
  prop('security_camera_01', 9.7, -.35, -Math.PI * .75, { y: 2.55, fit: .42, cls: 'plastic', collide: false });
  prop('wall_clock', .12, -6.2, Math.PI / 2, { y: 2.1, cls: 'plastic', collide: false });
  prop('television_02', 6.1, -6.6, 2.6, { cls: 'plastic', rx: -1.35, y: .2 });
  slab(4.2, .55, -4.6, 1.2, .05, 2.4, .5, 0, .45, 'ceil');          // a ceiling tile hanging down
  rubble(1.5, -7.2, 7, .9); rubble(8.4, -5.0, 4, .7, .7);

  // ---------- C1: east-west corridor ----------
  pipeRun(10.1, -5.4, 39.9, -5.4, 2.74, .07); pipeRun(10.1, -5.65, 28.2, -5.65, 2.8, .045, 'steel');
  prop('korean_fire_extinguisher_01', 15.0, -5.25, Math.PI, { cls: 'redmetal' });
  prop('trashbag', 19.4, -5.4, 1, { cls: 'plastic' }); prop('trashbag', 22.6, -7.6, 2, { cls: 'plastic', lite: true });
  // the unstable ceiling: a panel torn half-down, hanging into the flight band
  slab(26.0, 2.38, -5.9, 2.4, .08, 1.7, 0, -.62, .05, 'ceil'); cable(25.2, -6.4, 1.1, .3); cable(26.7, -5.6, .9, -.2);
  // the collapse: a slab and a mound fill the corridor (impassable)
  heap(29.5, -6.5, 1.9, 2.5, PH ? 70 : 120); slab(29.4, 1.25, -6.5, 1.0, .3, 3.4, .1, 0, 1.1, 'conc');
  prop('concrete_road_barrier_02', 28.7, -7.2, .3, { cls: 'concrete', rx: .3, y: .1 }); slab(30.2, 1.6, -5.8, .6, .4, 2.2, 1.3, .7, 0, 'conc');
  // C1 east of the collapse: only reachable through the server room
  const gen = prop('portable_generator', D2.pos.x, D2.pos.z, .4, { cls: 'machine', heat: .62, tgt: D2.i }); if (gen) D2.oid = gen.oid;
  prop('metal_jerrycan', 35.5, -6.7, 1.9, { cls: 'redmetal' }); prop('trashbag', 38.6, -7.4, .2, { cls: 'plastic' });
  prop('caged_hanging_light', 32.8, -6.6, .4, { y: 2.2, rx: .25, cls: 'metal', collide: false, lite: true });

  // ---------- OFFICE ----------
  // cubicle block: spine at z = -11.6, desks both sides, short dividers
  slab(11.5, .75, -11.6, 8.2, 1.5, .07, 0, 0, 0, 'fabric', 1.2);
  for (const x of [7.4, 9.9, 12.4, 14.9]) if (x !== 14.9 || true) slab(x, .75, -11.6, .07, 1.5, 2.4, 0, 0, 0, 'fabric', 1.2);
  for (const [x, side] of [[8.65, 1], [11.15, 1], [13.65, 1], [8.65, -1], [11.15, -1]]) {
    prop('metal_office_desk', x, -11.6 + side * .55, side > 0 ? 0 : Math.PI, { s: .9, cls: 'metal' });
    prop('SchoolChair_01', x + (rnd() - .5) * .4, -11.6 + side * 1.35, side > 0 ? Math.PI + (rnd() - .5) : (rnd() - .5), { cls: 'plastic', lite: side < 0 });
    if (rnd() < .6) prop('classic_laptop', x + .3, -11.6 + side * .5, side > 0 ? Math.PI : 0, { y: .71, cls: 'plastic', s: .9, lite: true }); }
  // tipped desk + chairs where the block meets the falling ceiling
  prop('metal_office_desk', 14.0, -13.5, .5, { s: .9, rz: Math.PI / 2, y: .45, cls: 'metal' });
  prop('SchoolChair_01', 15.6, -12.9, 2.1, { rx: -Math.PI / 2, y: .26, cls: 'plastic' });
  slab(16.4, 1.0, -9.6, 2.3, 1.5, .07, .2, 0, 1.35, 'fabric');               // a divider knocked flat
  for (let i = 0; i < 4; i++) slab(17.6, .66, -9.0 - i * .6, .55, 1.32, .5, 0, 0, 0, 'steel');   // filing cabinets
  prop('Television_01', 17.4, -14.4, -Math.PI / 2, { y: 0, cls: 'plastic', lite: true });
  prop('mounted_fluorescent_lights', 10.2, -14.2, .4, { y: 2.25, rx: .55, cls: 'metal', collide: false });
  prop('trashbag', 6.6, -9.0, 0, { cls: 'plastic', lite: true });
  rubble(15.4, -14.6, 8, 1.1);
  // meeting area (north of the partition): table, chairs, the ceiling slab that came down on P1
  slab(11.6, .74, -19.2, 3.2, .06, 1.3, .08, 0, 0, 'wood'); for (const [dx, dz] of [[-1.45, -.55], [1.45, -.55], [-1.45, .55], [1.45, .55]]) slab(11.6 + dx, .36, -19.2 + dz, .06, .72, .06, .08, 0, 0, 'steel');
  for (const [x, z, ry, down] of [[10.3, -18.2, 3.0, 0], [12.9, -18.1, 3.3, 1], [10.6, -20.3, .2, 0], [13.5, -20.6, -.4, 1], [9.2, -19.4, 1.4, 0]])
    prop('SchoolChair_01', x, z, ry, down ? { rx: Math.PI / 2, y: .28, cls: 'plastic' } : { cls: 'plastic' });
  slab(7.9, .62, -21.4, 2.2, .2, 1.7, .1, .0, .5, 'conc');                  // fallen ceiling slab across P1's legs
  heap(6.9, -21.5, .9, .7, 20); rubble(8.4, -22.3, 6, .6, .7);
  prop('potted_plant_02', 17.3, -22.4, .5, { cls: 'plant', lite: true });
  slab(6.12, 1.5, -18.5, .04, 1.1, 2.4, 0, 0, 0, 'ceil');                     // whiteboard
  prop('wall_clock', 9.0, -15.6, Math.PI, { y: 2.2, cls: 'plastic', collide: false });
  // P1
  if (humanGLTF) person(humanGeo(.62), skin, P1.pos.x, .14, P1.pos.z, -Math.PI / 2, -Math.PI / 2, .25, obj('P1', 'person', .92, P1.i));
  P1.oid = OBJ.length - 1;

  // ---------- C4, C2, C3 ----------
  slab(4.5, .45, -15.2, .5, .9, 1.9, .9, 0, 1.4, 'steel'); rubble(4.2, -19.5, 6, .9); prop('trashbag', 5.4, -21.8, 1, { cls: 'plastic', lite: true });
  pipeRun(18.4, -8.1, 18.4, -25.9, 2.72, .06); pipeRun(20.6, -8.1, 20.6, -25.9, 2.78, .04, 'steel');
  prop('medical_box', 19.6, -16.4, .6, { cls: 'plastic' }); rubble(20.2, -23.4, 6, .8); cable(19.5, -14.2, 1.0, .1);
  prop('mounted_fluorescent_lights', 19.4, -21.6, 1.2, { y: 1.9, rx: 1.1, cls: 'metal', collide: false, lite: true });
  rubble(7.5, -24.4, 7, 1.1); rubble(15.6, -25.2, 6, .8);
  // the breach into the void: torn edges + a mound you fly over
  heap(13.2, -25.6, 1.0, .55, 22); heap(13.2, -26.6, 1.0, .5, 18);
  prop('Barrel_01', 10.6, -24.0, .3, { cls: 'redmetal', rz: Math.PI / 2, y: .29 });

  // ---------- R1: storage (fire, smoke, mannequin) ----------
  for (const x of [22.1, 23.1, 24.1]) prop('worn_metal_rack', x, -14.55, 0, { cls: 'metal' });
  for (const z of [-13.3]) prop('worn_metal_rack', 21.45, z, Math.PI / 2, { cls: 'metal' });
  const boxes = [[22.0, .62, -14.5], [23.2, 1.2, -14.5], [22.2, 1.85, -14.55], [24.1, .62, -14.5], [21.5, 1.2, -13.3], [26.2, 0, -9.0], [24.8, .0, -13.4], [27.2, 0, -8.7]];
  boxes.forEach(([x, y, z], i) => prop('cardboard_box_01', x, z, rnd() * 3, { y, cls: 'cardboard', s: 1.25, lite: i > 3 }));
  prop('small_lpg_tank', H_LPG.pos.x, H_LPG.pos.z, .3, { cls: 'redmetal', tgt: H_LPG.i });
  prop('Barrel_01', 28.8, -9.1, 0, { cls: 'redmetal', tgt: H_FUEL.i }); prop('Barrel_01', 29.4, -9.7, 1, { cls: 'redmetal', tgt: H_FUEL.i });
  prop('metal_jerrycan', 27.5, -14.5, .2, { cls: 'redmetal' });
  rubble(28.4, -13.9, 6, .7, .7);
  // the mannequin (a smooth display figure: person-shaped, room temperature)
  const mqOid = obj('D1', 'figure', CLS.figure.heat, D1.i); D1.oid = mqOid;
  { const g = figureGeo.clone(); tf(g, D1.pos.x, 0, D1.pos.z, Math.PI / 2 + .3, 0, 0); const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xe8e2d8, roughness: .32 }));
    sceneObjs.push({ o: mesh, heat: CLS.figure.heat }); const pg = new THREE.BufferGeometry(); pg.setAttribute('position', g.attributes.position.clone()); if (g.index) pg.setIndex(g.index.clone()); pieces.push({ g: pg, oid: mqOid, w: 3 }); }
  // fire: an invisible collider so rays and the camera's occlusion test treat it as a thing
  { const g = new THREE.SphereGeometry(.42, 10, 8); tf(g, D3.pos.x, .45, D3.pos.z); const pg = new THREE.BufferGeometry(); pg.setAttribute('position', g.attributes.position); pg.setIndex(g.index); pieces.push({ g: pg, oid: obj('D3', 'fire', 1, D3.i), w: .4 }); D3.oid = OBJ.length - 1; }

  // ---------- R2: server / electrical ----------
  const rackMat = new THREE.MeshStandardMaterial({ color: 0x1a1e24, roughness: .5, metalness: .4 });
  const rackOid = obj('server racks', 'metal', .16);
  const rackGeos = [];
  for (const z of [-10.2, -12.6]) for (const x0 of [31.2, 36.2]) for (let k = 0; k < 4; k++) { if (z === -12.6 && x0 === 31.2 && k === 3) continue;
    const g = tf(boxG(.58, 2.0, 1.0).toNonIndexed(), x0 + .3 + k * .6, 1.0, z, 0); rackGeos.push(g); pieces.push({ g: stripAttrs(g), oid: rackOid, w: 1.1 }); }
  { const mm = new THREE.Mesh(mergeGeometries(rackGeos.map(stripAttrsKeepNormal)), rackMat); sceneObjs.push({ o: mm, heat: .16 }); }
  const leds = [];
  for (const g of rackGeos) { g.computeBoundingBox(); const b = g.boundingBox; for (let i = 0; i < 6; i++) leds.push([b.min.x + .08 + rnd() * .42, .4 + rnd() * 1.5, (rnd() < .5 ? b.min.z - .005 : b.max.z + .005)]); }
  prop('power_box_01', 39.75, -11.5, -Math.PI / 2, { y: .35, fit: 1.25, cls: 'electric', heat: .55, tgt: H_ELEC.i });
  for (let i = 0; i < 5; i++) cable(38.6 + rnd() * 1.2, -10.4 - rnd() * 2.2, .9 + rnd() * 1.1, (rnd() - .5) * .7);
  prop('mounted_fluorescent_lights', 34.9, -11.4, .2, { y: .05, rx: Math.PI, cls: 'metal', lite: true });
  prop('classic_laptop', 35.6, -13.9, 2.4, { cls: 'plastic', rz: .4, lite: true }); prop('worn_metal_rack', 39.3, -14.4, 0, { cls: 'metal', lite: true });
  rubble(34.8, -9.0, 5, .7, .7);

  // ---------- W: washroom (flooded) ----------
  const stallMat = 'steel';
  for (const x of [22.6, 24.1, 25.6, 27.1, 28.6]) slab(x, 1.1, -23.2, .05, 1.8, 1.6, 0, 0, 0, stallMat, 1.2);
  slab(23.35, 1.1, -22.4, .65, 1.8, .04, 0, 0, 0, stallMat); slab(26.3, 1.1, -22.0, .7, 1.8, .04, -.6, 0, 0, stallMat); slab(27.85, .2, -21.7, 1.3, .04, 1.9, .3, 0, 0, stallMat); // stall doors (one torn off)
  slab(25.5, .43, -15.38, 5.0, .86, .55, 0, 0, 0, 'conc');                  // vanity counter
  slab(25.5, 1.55, -15.13, 4.6, .9, .02, 0, 0, 0, 'steel');                 // mirror
  prop('WetFloorSign_01', 22.6, -16.4, .5, { cls: 'plastic' }); prop('trashbag', 29.3, -23.3, 0, { cls: 'plastic', lite: true });
  pipeRun(21.2, -15.35, 29.8, -15.35, 2.62, .05);
  cyl(28.6, 2.2, -15.35, .05, .9, 0, .5, .8, 'rust');                     // the burst stub
  rubble(23.0, -18.8, 5, .7, .6);
  if (humanGLTF) person(humanGeo(.15), skin, P2.pos.x, .13, P2.pos.z, Math.PI * .1, -Math.PI / 2, 0, obj('P2', 'person', .9, P2.i));
  P2.oid = OBJ.length - 1;
  slab(24.6, .3, -21.4, 1.6, .05, .5, 1.0, 0, .3, 'steel');                 // stall door across the legs

  // ---------- S: stairwell (stair from glTF, debris, P3 buried to the chest) ----------
  if (extra.stair) {
    const g = normalised(extra.stair.scene, 2.95, 'y'); g.computeBoundingBox(); const b = g.boundingBox;
    // which end is high? rotate so the stair rises toward +x
    const p = g.attributes.position; let hz = 0, hn = 0; for (let i = 0; i < p.count; i++) if (p.getY(i) > b.max.y * .8) { hz += p.getZ(i); hn++; }
    const highZ = hz / hn, ry = highZ > (b.min.z + b.max.z) / 2 ? Math.PI / 2 : -Math.PI / 2;
    tf(g, 0, 0, 0, ry); g.computeBoundingBox(); const b2 = g.boundingBox;
    g.translate(38.3 - b2.max.x, 0, -22.85 - (b2.min.z + b2.max.z) / 2); worldUV(g, 2.4);
    const mm = new THREE.Mesh(g, M.conc); sceneObjs.push({ o: mm, heat: .09 }); pieces.push({ g: stripAttrs(g), oid: matObj('conc'), w: .9 });
  } else for (let i = 0; i < 11; i++) slab(32.2 + i * .52, .135 + i * .27, -22.85, .52, .27, 1.7, 0, 0, 0, 'conc');
  heap(37.3, -18.1, 1.7, 1.1, PH ? 50 : 90); heap(35.4, -16.6, .9, .45, 20);
  slab(38.2, 1.0, -19.6, 2.6, .25, 1.6, .4, .3, .55, 'conc'); slab(36.0, .55, -19.4, 1.9, .2, 1.2, -.5, .2, -.35, 'conc');
  cyl(37.25, CEIL / 2, -17.35, .055, CEIL, 0, 0, 0, 'rust');               // the vertical pipe P3 taps on
  prop('modular_industrial_pipes_01', 39.7, -20.5, -Math.PI / 2, { y: .8, cls: 'metal', lite: true });
  const p3Oid = obj('P3', 'person', .9, P3.i); P3.oid = p3Oid;
  if (bustGeo) { const g = bustGeo.clone(); tf(g, P3.pos.x, .3, P3.pos.z, -Math.PI / 2 - .5, .15, 0); const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb08a72, roughness: .7 }));
    sceneObjs.push({ o: mesh, heat: .9 }); const pg = new THREE.BufferGeometry(); pg.setAttribute('position', g.attributes.position.clone()); if (g.index) pg.setIndex(g.index.clone()); pieces.push({ g: pg, oid: p3Oid, w: 3.5 }); }
  for (let i = 0; i < 16; i++) { const a = rnd() * 6.28, d = .3 + rnd() * .4; addStruct(tf(chunk(.14 + rnd() * .16), P3.pos.x + Math.cos(a) * d, .2 + rnd() * .2, P3.pos.z + Math.sin(a) * d, rnd() * 6, rnd(), rnd()), 'rubble', 1.3); }

  // ---------- V: the void (pancake collapse; P4 silent) ----------
  slab(11.2, 1.5, -29.6, .55, 3, .55, 0, 0, 0, 'conc'); slab(16.6, 1.5, -31.0, .55, 3, .55, 0, 0, 0, 'conc');
  slab(17.0, 1.5, -32.2, 5.2, .3, 3.4, 0, -.7, .05, 'conc');                 // the slab that came down from above
  slab(10.0, 1.1, -32.4, 3.4, .25, 2.2, .2, .45, -.2, 'conc');
  heap(18.6, -33.0, 1.4, 1.1, 34); heap(9.0, -27.4, 1.2, .8, 26); rubble(13.6, -30.2, 10, 2.0); rubble(18.4, -27.2, 6, .9);
  slab(15.0, .9, -28.1, .3, .3, 4.5, 1.05, .25, .1, 'rust');                  // steel beam
  if (humanGLTF) person(humanGeo(.4), skin, P4.pos.x, .16, P4.pos.z, Math.PI * .65, Math.PI / 2, 0, obj('P4', 'person', .86, P4.i));
  P4.oid = OBJ.length - 1;
  slab(17.4, .62, -28.3, 1.9, .16, 1.3, .5, .0, .32, 'conc');                 // slab over the legs

  // decals the camera sees and LiDAR can't
  const decals = [];
  // ---------- merge render meshes ----------
  const meshes = [];
  for (const [k, gs] of Object.entries(rgbByMat)) { const g = mergeGeometries(gs.map(stripAttrsKeepUV)); const m = new THREE.Mesh(g, M[k]); meshes.push({ mesh: m, heat: CLS[TEXSETS[k][1]].heat, k }); }
  onProgress(.82);

  // ---------- one BVH over everything ----------
  const merged = (() => {
    let nV = 0, nI = 0; for (const p of pieces) { nV += p.g.attributes.position.count; nI += p.g.index ? p.g.index.count : p.g.attributes.position.count; }
    const pos = new Float32Array(nV * 3), oid = new Uint16Array(nV), wv = new Float32Array(nV), idx = new Uint32Array(nI);
    let v = 0, ii = 0;
    for (const p of pieces) { const a = p.g.attributes.position, n = a.count;
      for (let i = 0; i < n; i++) { pos[(v + i) * 3] = a.getX(i); pos[(v + i) * 3 + 1] = a.getY(i); pos[(v + i) * 3 + 2] = a.getZ(i); oid[v + i] = p.oid; wv[v + i] = p.w; }
      if (p.g.index) { const ix = p.g.index.array; for (let i = 0; i < ix.length; i++) idx[ii + i] = ix[i] + v; ii += ix.length; } else { for (let i = 0; i < n; i++) idx[ii + i] = v + i; ii += n; }
      v += n; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setAttribute('w', new THREE.BufferAttribute(wv, 1)); return { g, oid };
  })();
  const geo = merged.g;
  const tris = geo.index.count / 3;
  onProgress(.86);

  // ---------- sample the LiDAR point set (before the BVH reorders the index; order doesn't matter to sampling) ----------
  const NPTS = pts || (PH ? 240000 : 1000000);
  const ptPos = new Float32Array(NPTS * 3), ptNor = new Float32Array(NPTS * 3), ptCls = new Float32Array(NPTS), ptTgt = new Float32Array(NPTS), ptRnd = new Float32Array(NPTS);
  { const sampler = new MeshSurfaceSampler(new THREE.Mesh(geo)).setWeightAttribute('w').build();
    const p = new THREE.Vector3(), n = new THREE.Vector3(), ix = geo.index.array, sFace = sampler.sampleFace.bind(sampler);
    // sample faces ourselves so we know which object each point belongs to
    for (let i = 0; i < NPTS; i++) { const f = sampler.sampleFaceIndex(); sFace(f, p, n);
      const o = OBJ[merged.oid[ix[f * 3]]];
      ptPos[i * 3] = p.x; ptPos[i * 3 + 1] = p.y; ptPos[i * 3 + 2] = p.z; ptNor[i * 3] = n.x; ptNor[i * 3 + 1] = n.y; ptNor[i * 3 + 2] = n.z;
      ptCls[i] = CLS_ID[o.cls]; ptTgt[i] = o.tgt + 1; ptRnd[i] = Math.random(); } }
  geo.deleteAttribute('w');
  onProgress(.93);
  const bvh = new MeshBVH(geo, { maxLeafTris: 8 });
  onProgress(1);

  // per-target surface probes for the camera/thermal visibility test (points on that object)
  for (const t of TG) { t.probes = []; }
  for (let i = 0; i < NPTS && TG.some(t => t.probes.length < 14); i += 1) { const k = ptTgt[i] - 1; if (k >= 0 && TG[k].probes.length < 14) TG[k].probes.push(new THREE.Vector3(ptPos[i * 3], ptPos[i * 3 + 1], ptPos[i * 3 + 2])); }
  for (const t of TG) if (!t.probes.length) t.probes.push(t.pos.clone());
  // hazards share probes with their linked target when they have no geometry of their own
  for (const h of HZ) if (h.probes.length === 1 && h.link) h.probes = TG.find(t => t.id === h.link).probes;

  const oidOfFace = f => merged.oid[geo.index.array[f * 3]];
  return {
    M, meshes, sceneObjs, OBJ, oidOfFace, bvh, geo, tris, TG, HZ, ROOMS, roomAt, rackMat, leds, graffiti,
    pts: { n: NPTS, pos: ptPos, nor: ptNor, cls: ptCls, tgt: ptTgt, rnd: ptRnd },
    named: { P1, P2, P3, P4, D1, D2, D3, H_FIRE, H_LPG, H_FUEL, H_ELEC, H_FLOOD, H_CRACK, H_CEIL, H_BLOCK },
  };
}

// ======================================================================================
function posF(a) { // quantized (meshopt / KHR_mesh_quantization) → plain float positions we can transform
  const n = a.count, f = new Float32Array(n * 3); for (let i = 0; i < n; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); } return new THREE.BufferAttribute(f, 3); }
function quad(a, b, c, d) { // two triangles, counter-clockwise seen from the front
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3)); g.computeVertexNormals(); return g; }
function rectMinus([x0, x1, z0, z1], holes) { // split a rectangle around rectangular holes (holes assumed inside, non-overlapping)
  let rects = [[x0, x1, z0, z1]];
  for (const [hx0, hx1, hz0, hz1] of holes) { const out = [];
    for (const [a0, a1, b0, b1] of rects) { if (hx1 <= a0 || hx0 >= a1 || hz1 <= b0 || hz0 >= b1) { out.push([a0, a1, b0, b1]); continue; }
      if (hz0 > b0) out.push([a0, a1, b0, hz0]); if (hz1 < b1) out.push([a0, a1, hz1, b1]);
      const lo = Math.max(b0, hz0), hi = Math.min(b1, hz1); if (hx0 > a0) out.push([a0, hx0, lo, hi]); if (hx1 < a1) out.push([hx1, a1, lo, hi]); }
    rects = out; }
  return rects; }
export function worldUV(g, tile = 2) { // box-projected UVs in metres so textures keep real scale
  if (g.index) { const ng = g.toNonIndexed(); for (const k in ng.attributes) g.setAttribute(k, ng.attributes[k]); g.setIndex(null); }
  const p = g.attributes.position, n = p.count, uv = new Float32Array(n * 2), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const k = 1 / tile;
  for (let i = 0; i < n; i += 3) { a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2); const ax = Math.abs(e1.x), ay = Math.abs(e1.y), az = Math.abs(e1.z);
    for (let j = 0; j < 3; j++) { const v = j === 0 ? a : j === 1 ? b : c;
      let u, w; if (ay >= ax && ay >= az) { u = v.x; w = v.z; } else if (ax >= az) { u = v.z * Math.sign(e1.x || 1); w = v.y; } else { u = v.x * -Math.sign(e1.z || 1); w = v.y; }
      uv[(i + j) * 2] = u * k; uv[(i + j) * 2 + 1] = w * k; } }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g; }
function stripAttrs(g) { const o = new THREE.BufferGeometry(); o.setAttribute('position', g.attributes.position); if (g.index) o.setIndex(g.index); return o; }
function stripAttrsKeepNormal(g) { const o = new THREE.BufferGeometry(); const s = g.index ? g.toNonIndexed() : g; o.setAttribute('position', s.attributes.position); o.setAttribute('normal', s.attributes.normal); return o; }
function stripAttrsKeepUV(g) { const o = new THREE.BufferGeometry(); const s = g.index ? g.toNonIndexed() : g; o.setAttribute('position', s.attributes.position); if (!s.attributes.normal) s.computeVertexNormals(); o.setAttribute('normal', s.attributes.normal); o.setAttribute('uv', s.attributes.uv); return o; }
function normalised(scene, size, axis = 'y') { // merge every mesh of a glTF scene into one geometry, base at y=0, centred, scaled
  scene.updateMatrixWorld(true); const gs = [];
  scene.traverse(o => { if (!o.isMesh) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', posF(o.geometry.attributes.position)); if (o.geometry.index) g.setIndex(o.geometry.index.clone()); g.applyMatrix4(o.matrixWorld); gs.push(g.index ? g : g); });
  const ng = gs.map(g => g.index ? g.toNonIndexed() : g); const g = mergeGeometries(ng); g.computeBoundingBox();
  const s = new THREE.Vector3(); g.boundingBox.getSize(s); const k = size / (axis === 'y' ? s.y : Math.max(s.x, s.y, s.z)); g.scale(k, k, k); g.computeBoundingBox();
  const b = g.boundingBox; g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); g.computeVertexNormals(); return g; }
function bakeSkinned(gltf, frac) { // freeze the walking CesiumMan at one moment of its cycle → a static, lying pose source
  let sk = null; gltf.scene.traverse(o => { if (o.isSkinnedMesh && !sk) sk = o; });
  if (gltf.animations?.length) { const mx = new THREE.AnimationMixer(gltf.scene); mx.clipAction(gltf.animations[0]).play(); mx.setTime(gltf.animations[0].duration * frac); }
  gltf.scene.updateMatrixWorld(true);
  const src = sk.geometry, n = src.attributes.position.count, out = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(src.attributes.position, i); sk.applyBoneTransform(i, v); v.applyMatrix4(sk.matrixWorld); out.set([v.x, v.y, v.z], i * 3); }
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(out, 3)); if (src.attributes.uv) g.setAttribute('uv', src.attributes.uv); if (src.index) g.setIndex(src.index);
  g = g.toNonIndexed(); g.computeBoundingBox(); const s = new THREE.Vector3(); g.boundingBox.getSize(s);
  if (s.z > s.y * 1.3) { g.rotateX(-Math.PI / 2); g.computeBoundingBox(); g.boundingBox.getSize(s); }
  const k = 1.74 / s.y; g.scale(k, k, k); g.computeBoundingBox(); const bb = g.boundingBox; g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  g.computeVertexNormals(); return g; }
function simpleFigure() { const P = []; const cap = (r, l, x, y, z, rz = 0) => { const g = new THREE.CapsuleGeometry(r, l, 4, 10); g.rotateZ(rz); g.translate(x, y, z); g.deleteAttribute('uv'); P.push(g.toNonIndexed()); };
  cap(.14, .45, 0, 1.2, 0); cap(.1, .05, 0, 1.6, 0); cap(.06, .55, -.24, 1.15, 0, .15); cap(.06, .55, .24, 1.15, 0, -.15); cap(.08, .75, -.1, .45, 0); cap(.08, .75, .1, .45, 0);
  const g = mergeGeometries(P); g.computeVertexNormals(); return g; }
export function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Models for the agents. If assets/props.glb has a node with the right name it is used; otherwise a procedural
// clay stand-in is built (so nothing ever blocks on the props file).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const clay = (c, o = {}) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: o.r ?? .85, metalness: 0, emissive: o.e ? new THREE.Color(o.e) : new THREE.Color(0), emissiveIntensity: o.ei ?? 1, vertexColors: !!o.vc, transparent: !!o.t, opacity: o.op ?? 1, depthWrite: o.t ? false : true, side: o.side ?? THREE.FrontSide });
function colored(geo, c) { const g = geo.index ? geo.toNonIndexed() : geo; const col = new THREE.Color(c); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g; }
const at = (g, x, y, z, ry = 0, rx = 0, rz = 0) => { g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1))); return g; };

// merge a prop's meshes into one vertex-coloured geometry (for instancing)
export function propGeometry(obj) {
  const parts = []; obj.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  obj.traverse((o) => { if (!o.isMesh) return; const g = o.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const m = Array.isArray(o.material) ? o.material[0] : o.material; let c = m && m.color ? m.color.clone() : new THREE.Color('#ddd'); if (m && m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() > 0) c = m.emissive.clone().multiplyScalar(1.6);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    parts.push(colored(g, c)); });
  return parts.length ? mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))) : null;
}
// the swarm drone: a small quad with a LiDAR puck, as one vertex-coloured geometry (+ rotor discs separately)
export function droneGeometry() {
  const shell = '#E4DEEA', dark = '#8C86A8', teal = '#7FD4CF';
  const parts = [colored(new THREE.BoxGeometry(.2, .07, .26), shell), colored(at(new THREE.CylinderGeometry(.045, .05, .05, 14), 0, .06, 0), dark), colored(at(new THREE.SphereGeometry(.03, 10, 8), 0, -.02, .13), dark),
    colored(at(new THREE.BoxGeometry(.05, .02, .02), 0, .02, .135), teal)];
  for (const [x, z] of [[.17, .17], [-.17, .17], [.17, -.17], [-.17, -.17]]) {
    const arm = new THREE.BoxGeometry(.03, .025, .24); at(arm, x / 2, 0, z / 2, Math.atan2(x, z)); parts.push(colored(arm, shell));
    parts.push(colored(at(new THREE.CylinderGeometry(.03, .03, .05, 12), x, .02, z), dark));
  }
  return mergeGeometries(parts);
}
export function rotorGeometry() { const g = new THREE.CircleGeometry(.12, 24); g.rotateX(-Math.PI / 2); return g; }
export const ROTORS = [[.17, .05, .17], [-.17, .05, .17], [.17, .05, -.17], [-.17, .05, -.17]];

export function makeTetherDrone(props) {
  const p = props && props.getObjectByName && props.getObjectByName('tether_drone');
  const g = new THREE.Group();
  if (p) { const c = p.clone(); c.position.set(0, 0, 0); g.add(c); const att = c.getObjectByName('tether_attach'); g.userData.attach = att ? att.position.clone() : new THREE.Vector3(0, -.25, 0); }
  else {
    const shell = clay('#EFE7EE'), dark = clay('#7D7798'), apr = clay('#F6D2B1');
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.42, .5, .22, 6), shell); g.add(body);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), apr); dome.position.y = .1; g.add(dome);
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; const arm = new THREE.Mesh(new THREE.BoxGeometry(1.0, .06, .09), shell); arm.position.set(Math.cos(a) * .7, 0, Math.sin(a) * .7); arm.rotation.y = -a; g.add(arm);
      const mot = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, .12, 12), dark); mot.position.set(Math.cos(a) * 1.18, .05, Math.sin(a) * 1.18); g.add(mot);
      const rot = new THREE.Mesh(new THREE.CircleGeometry(.36, 28), clay('#D8D2EA', { t: true, op: .22, side: THREE.DoubleSide })); rot.rotation.x = -Math.PI / 2; rot.position.set(Math.cos(a) * 1.18, .13, Math.sin(a) * 1.18); g.add(rot); }
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(.16, .2, .1, 16), clay('#FFF1D8', { e: '#FFE3B8', ei: 2.4 })); lamp.position.y = -.16; g.add(lamp);
    const legs = new THREE.Mesh(new THREE.TorusGeometry(.42, .025, 6, 24), dark); legs.rotation.x = Math.PI / 2; legs.position.y = -.32; g.add(legs);
    g.userData.attach = new THREE.Vector3(0, -.3, 0);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}
export function makeStation(props) {
  const p = props && props.getObjectByName && props.getObjectByName('tether_station');
  const g = new THREE.Group();
  if (p) { const c = p.clone(); c.position.set(0, 0, 0); g.add(c); const o = c.getObjectByName('cable_out'); g.userData.out = o ? o.position.clone() : new THREE.Vector3(0, .5, 0); }
  else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(.9, .5, .7), clay('#D9CFDC')); box.position.y = .25; g.add(box);
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(.24, .24, .5, 18), clay('#F6D2B1')); spool.rotation.x = Math.PI / 2; spool.position.y = .62; g.add(spool);
    g.userData.out = new THREE.Vector3(0, .82, 0);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
export function makeUgv(props) {
  const p = props && props.getObjectByName && props.getObjectByName('ugv');
  const g = new THREE.Group();
  if (p) { const c = p.clone(); c.position.set(0, 0, 0); g.add(c); }
  else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, .5, .95), clay('#F3E3D3')); body.position.y = .62; g.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(.9, .22, .8), clay('#F6D2B1')); top.position.set(-.1, .98, 0); g.add(top);
    const dark = clay('#4C4769');
    for (const x of [-.55, 0, .55]) for (const z of [-.55, .55]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.26, .26, .18, 14), dark); w.rotation.x = Math.PI / 2; w.position.set(x, .27, z); g.add(w); }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, 1.1, 8), clay('#CFC6D6')); mast.position.set(.45, 1.5, 0); g.add(mast);
    const head = new THREE.Mesh(new THREE.BoxGeometry(.22, .14, .3), clay('#8C86A8')); head.position.set(.45, 2.0, 0); g.add(head);
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.12, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFC36B').multiplyScalar(2.2) })); beacon.position.set(.45, 2.22, 0); g.add(beacon); g.userData.beacon = beacon;
  g.traverse((o) => { if (o.isMesh && o !== beacon) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
export function makeBoat(props) {
  const p = props && props.getObjectByName && props.getObjectByName('boat');
  const g = new THREE.Group();
  if (p) { const c = p.clone(); c.position.set(0, 0, 0); g.add(c); }
  else {
    const sh = new THREE.Shape(); sh.moveTo(-2.2, -.9); sh.lineTo(1.4, -.9); sh.quadraticCurveTo(2.6, 0, 1.4, .9); sh.lineTo(-2.2, .9); sh.lineTo(-2.2, -.9);
    const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: .7, bevelEnabled: true, bevelSize: .12, bevelThickness: .12, bevelSegments: 2 }), clay('#F3E6DA')); hull.rotation.x = Math.PI / 2; hull.position.y = .75; g.add(hull);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(3.6, .12, 1.9), clay('#F6D2B1')); rim.position.set(-.3, .8, 0); g.add(rim);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.0, .7, 1.0), clay('#E8DDE4')); cab.position.set(-.9, 1.15, 0); g.add(cab);
    const mot = new THREE.Mesh(new THREE.BoxGeometry(.4, .6, .4), clay('#5E5878')); mot.position.set(-2.35, .7, 0); g.add(mot);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
export function makeSurvivor(props) {
  const p = props && props.getObjectByName && props.getObjectByName('survivor');
  const g = new THREE.Group();
  if (p) { const c = p.clone(); c.position.set(0, 0, 0); g.add(c); }
  else {
    const m = clay('#F6D2B1', { e: '#FFB070', ei: .25 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.2, .55, 4, 10), m); torso.rotation.z = Math.PI / 2; torso.position.set(0, .22, 0); g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.13, 12, 8), m); head.position.set(.52, .25, .02); g.add(head);
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .5, 4, 8), m); legs.rotation.set(0, .5, Math.PI / 2); legs.position.set(-.55, .16, .15); g.add(legs);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function makeBeacon(props) {
  const p = props && props.getObjectByName && props.getObjectByName('relay_beacon');
  if (p) return propGeometry(p);
  return mergeGeometries([colored(new THREE.CylinderGeometry(.12, .16, .3, 10), '#E7DFEA'), colored(at(new THREE.CylinderGeometry(.015, .015, .4, 6), 0, .35, 0), '#8C86A8')].map((g) => g.index ? g.toNonIndexed() : g));
}
export { clay };

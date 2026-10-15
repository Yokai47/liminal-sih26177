// Everything that moves, read back from the tape at a fractional tick: instanced drones with glows and trails, the
// mesh (links with packets), the tethered drone on its sagging cable, ground robots, boats, marks, beacons, finds,
// sealed pockets, team lines and halos. update() rewrites preallocated buffers; nothing is allocated per frame.
import * as THREE from 'three';
import { createLines, createGlows } from './lines.js';
import { droneGeometry, rotorGeometry, ROTORS, propGeometry, makeTetherDrone, makeStation, makeUgv, makeBoat, makeSurvivor, makeBeacon, clay } from './models.js';
import { droneAt, auxAt, ST, FLAG } from '../sim/tape.js';

const lin = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const TEAL = lin('#7FD4CF'), ROSE = lin('#EFB1B4'), HEAT = lin('#FFC36B'), HAZE = lin('#8F8CC4'), LAV = lin('#B9A6F2'), APR = lin('#F6D2B1'), MIST = lin('#DCE4EE'), UVC = lin('#A78BFF'), DANGER = lin('#F08A7E');
const TAU = Math.PI * 2;

export function createSwarmView(scene, { props = null, phone = false } = {}) {
  const root = new THREE.Group(); root.name = 'swarm'; scene.add(root);
  const MAXN = 40;
  // drones
  let dGeo = null; const dp = props && props.getObjectByName && props.getObjectByName('swarm_drone'); if (dp) dGeo = propGeometry(dp);
  if (!dGeo) dGeo = droneGeometry();
  const dMat = clay('#ffffff', { vc: true, r: .6 }); dMat.emissive = new THREE.Color('#1b2a33'); dMat.emissiveIntensity = .5;
  const drones = new THREE.InstancedMesh(dGeo, dMat, MAXN); drones.castShadow = true; drones.frustumCulled = false; root.add(drones);
  const rotors = new THREE.InstancedMesh(rotorGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color('#D8D2EA'), transparent: true, opacity: .28, depthWrite: false, side: THREE.DoubleSide }), MAXN * 4); rotors.frustumCulled = false; root.add(rotors);
  const glows = createGlows(800, { minPx: phone ? 4 : 5 }); root.add(glows.mesh);
  const dots = createGlows(128, { dot: true, minPx: phone ? 5 : 6 }); dots.mesh.renderOrder = 5; root.add(dots.mesh);
  const trails = createLines(MAXN * 48, { width: 1.25, nearFade: [1.5, 6] }); root.add(trails.mesh);
  const links = createLines(1200, { width: 1.1, dash: 3.2, packets: true, nearFade: [8, 40] }); root.add(links.mesh);
  const extra = createLines(1600, { width: 1.3, nearFade: [2, 10] }); root.add(extra.mesh);           // team lines, outlines, rings drawn as polylines
  const cable = createLines(64, { width: 1.6, additive: false }); root.add(cable.mesh);
  // tethered drone, station
  const tdrone = makeTetherDrone(props); root.add(tdrone);
  const station = makeStation(props); root.add(station);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 32, 1, true), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: { a: { value: .5 }, col: { value: new THREE.Color('#FFE6C4') } },
    vertexShader: 'varying float vY; varying vec3 vN, vV; void main(){ vY = position.y + .5; vec4 mv = modelViewMatrix * vec4(position, 1.); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float a; uniform vec3 col; varying float vY; varying vec3 vN, vV; void main(){ float e = pow(abs(dot(vN, vV)), 1.5); gl_FragColor = vec4(col * e * pow(vY, 1.6) * a * .16, 1.); }' }));
  root.add(cone);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: { a: { value: .4 }, col: { value: new THREE.Color('#FFE2BC') } },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform float a; uniform vec3 col; varying vec2 vU; void main(){ float d = length(vU - .5) * 2.; gl_FragColor = vec4(col * pow(max(0., 1. - d), 1.8) * a, 1.); }' }));
  pool.renderOrder = 3; root.add(pool);
  // flat rings (halos, finds, ranges): one instanced additive ring material
  const ringMat = new THREE.ShaderMaterial({ extensions: { derivatives: true }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    vertexShader: 'attribute vec4 rc; varying vec4 vC; varying vec2 vU; void main(){ vC = rc; vU = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.); }',
    fragmentShader: 'varying vec4 vC; varying vec2 vU; void main(){ float d = length(vU - .5) * 2.; float f = step(1.5, vC.a); float al = vC.a - f * 2.; float w = fwidth(d) * 1.2 + .006; float ring = smoothstep(w, 0., abs(d - .96)); float fill = (smoothstep(1., .55, d) * .14 + smoothstep(.96, .8, d) * .1) * f; gl_FragColor = vec4(vC.rgb * (ring * .9 + fill) * al, 1.); }' });
  const ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const RC = new Float32Array(64 * 4); ringGeo.setAttribute('rc', new THREE.InstancedBufferAttribute(RC, 4));
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, 64); rings.frustumCulled = false; rings.renderOrder = 4; root.add(rings);
  // footprints (thermal swath under outdoor drones)
  const fpMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { a: { value: .1 }, col: { value: new THREE.Color('#7FD4CF') } },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform float a; uniform vec3 col; varying vec2 vU; void main(){ float d = length(vU - .5) * 2.; float e = smoothstep(1., .82, d) * (.35 + .65 * smoothstep(.6, 1., d)); gl_FragColor = vec4(col * e * a, 1.); }' });
  const foot = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), fpMat, MAXN); foot.frustumCulled = false; foot.renderOrder = 3; root.add(foot);
  const follow = new THREE.PointLight(0xd8fff9, 0, 14, 1.6); root.add(follow);
  let ugvs = [], boats = [], survivors = [], beaconMesh = null;
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
  const tmp = { x: 0, y: 0, z: 0, h: 0 }, tmp2 = { x: 0, y: 0, z: 0, h: 0 }, A = [], meanH = new Float32Array(MAXN), devs = new Float32Array(MAXN);
  for (let i = 0; i < MAXN; i++) A.push({ x: 0, y: 0, z: 0, h: 0, state: 0, bat: 1, layer: 0, team: -1, flags: 0, own: 0 });
  let tape = null, scale = 2.2, auxIdx = { ugv: [], boat: [], tether: -1, station: -1 }, layerIndoor = [];
  const state = { labels: [] };

  function setTape(t, world) {
    tape = t;
    const b = world.bounds || new THREE.Box3().setFromObject(world.group); const sz = b.getSize(new THREE.Vector3());
    scale = THREE.MathUtils.clamp(Math.max(sz.x, sz.z) / 220, 1.05, 1.8); glows.U.minPx.value = (phone ? 4 : 5) + (scale - 1) * 3.5; dots.U.minPx.value = (phone ? 5 : 6) + (scale - 1) * 2;
    for (const u of ugvs) root.remove(u); for (const bt of boats) root.remove(bt); for (const s of survivors) root.remove(s.obj);
    ugvs = []; boats = []; survivors = []; auxIdx = { ugv: [], boat: [], tether: -1, station: -1 };
    // per-candidate lookups done once, not every frame
    for (const c of t.candidates) { const r = t.events.find((e) => e.type === 'reject' && e.cand === c.id); c._rejT = r ? r.t : -1; c._L = t.layers.find((l) => l.id === c.layer) || null; }
    for (const p of t.pockets) p._L = t.layers.find((l) => l.id === p.layer) || null;
    t.aux.list.forEach((a, k) => { if (a.kind === 'ugv') auxIdx.ugv.push(k); else if (a.kind === 'boat') auxIdx.boat.push(k); else if (a.kind === 'tether') auxIdx.tether = k; else if (a.kind === 'station') auxIdx.station = k; });
    for (const k of auxIdx.ugv) { const u = makeUgv(props); u.scale.setScalar(Math.max(1.2, scale * .6)); root.add(u); ugvs.push(u); }
    for (const k of auxIdx.boat) { const bt = makeBoat(props); bt.scale.setScalar(Math.max(1, scale * .45)); root.add(bt); boats.push(bt); }
    tdrone.scale.setScalar(Math.max(1.2, scale * .7)); station.scale.setScalar(Math.max(1, scale * .55));
    // a world that models its own people shows them itself; otherwise a clay survivor appears where a find is confirmed
    if (!(world.peopleGroup || world.objects?.people)) for (const c of t.candidates) if (c.kind === 'person') { const s = makeSurvivor(props); s.position.set(c.pos[0], c.pos[1] - .2, c.pos[2]); s.rotation.y = (c.id * 1.7) % TAU; s.scale.setScalar(Math.max(1, scale * .5)); s.visible = false; root.add(s); survivors.push({ obj: s, c }); }
    if (beaconMesh) { root.remove(beaconMesh); beaconMesh.dispose(); beaconMesh = null; }
    if (t.beacons.length) { beaconMesh = new THREE.InstancedMesh(makeBeacon(props), clay('#ffffff', { vc: true }), t.beacons.length); beaconMesh.castShadow = true; root.add(beaconMesh); }
    layerIndoor = t.layers.map((L) => !L.outdoor);
    // station sits where the tape says (van roof, boat deck, trailhead, cave mouth)
  }

  // tf: fractional tick; W: lens weights; B: beat weights; sel: followed drone; time: wall seconds
  function update(tf, W, B, sel, time, cam, res) {
    if (!tape) return;
    const N = tape.N, k = Math.round(Math.max(0, Math.min(tape.T - 1, tf)));
    trails.U.res.value.copy(res); links.U.res.value.copy(res); extra.U.res.value.copy(res); cable.U.res.value.copy(res);
    trails.U.time.value = links.U.time.value = extra.U.time.value = time;
    glows.U.hh.value = res.y; glows.U.px.value = 1; dots.U.hh.value = res.y;
    for (let i = 0; i < N; i++) droneAt(tape, tf, i, A[i]);
    // local mean heading among nearby airborne drones (alignment tint)
    for (let i = 0; i < N; i++) {
      let sx = 0, sz = 0; const a = A[i];
      for (let j = 0; j < N; j++) { const b = A[j]; if (b.state === ST.IDLE || b.state === ST.LANDED || b.state === ST.DEAD) continue; if ((b.x - a.x) ** 2 + (b.z - a.z) ** 2 < 400) { sx += Math.cos(b.h); sz += Math.sin(b.h); } }
      meanH[i] = Math.atan2(sz, sx); let d = a.h - meanH[i]; d = Math.atan2(Math.sin(d), Math.cos(d)); devs[i] = Math.abs(d);
    }
    const alignW = Math.max(W.physics, B.vicsek || 0, B.slowing || 0);
    const meshW = Math.max(W.mesh, B.crdt || 0);
    // ---------------- drones
    glows.begin(); dots.begin(); trails.begin(); links.begin(); extra.begin(); cable.begin();
    let nf = 0;
    for (let i = 0; i < N; i++) {
      const a = A[i], st = a.state;
      const air = !(st === ST.IDLE || st === ST.LANDED);
      const bob = air && st !== ST.DEAD ? Math.sin(time * 2.3 + i * 1.7) * .08 : 0;
      const yaw = -a.h + Math.PI / 2;
      const tilt = air && (st === ST.TRANSIT || st === ST.SEARCH || st === ST.FRONT) ? .12 : 0;
      E.set(tilt, yaw, st === ST.DEAD ? .9 : 0, 'YXZ'); Q.setFromEuler(E); P.set(a.x, a.y + bob, a.z); S.setScalar(scale);
      M4.compose(P, Q, S); drones.setMatrixAt(i, M4);
      // rotor discs
      for (let r = 0; r < 4; r++) { const o = ROTORS[r]; P.set(o[0], o[1], o[2]).applyQuaternion(Q).multiplyScalar(scale).add(tmpV.set(a.x, a.y + bob, a.z)); M4.compose(P, Q, tmpS.setScalar(air && st !== ST.DEAD ? scale : .001)); rotors.setMatrixAt(i * 4 + r, M4); }
      if (!air && st !== ST.LANDED && st !== ST.IDLE) continue;
      // glow colour
      let c = TEAL, al = st === ST.IDLE || st === ST.LANDED ? .35 : 1, sz = scale * (layerIndoor[a.layer] ? .7 : 1.25);
      let r0 = c[0], g0 = c[1], b0 = c[2];
      if (alignW > .01 && (st === ST.TRANSIT || st === ST.FRONT || st === ST.SEARCH || st === ST.EVADE)) { const t = THREE.MathUtils.smoothstep(devs[i], .35, 1.3) * alignW; r0 += (ROSE[0] - r0) * t; g0 += (ROSE[1] - g0) * t; b0 += (ROSE[2] - b0) * t; }
      if (a.flags & FLAG.CONV) { const t = .85; r0 += (HEAT[0] - r0) * t; g0 += (HEAT[1] - g0) * t; b0 += (HEAT[2] - b0) * t; sz *= 1.2; }
      if ((a.flags & FLAG.OUT) && air) { const t = .4 + .5 * meshW; r0 += (HAZE[0] - r0) * t; g0 += (HAZE[1] - g0) * t; b0 += (HAZE[2] - b0) * t; al *= 1 - .55 * Math.max(.35, meshW); }
      if (st === ST.DEAD) { r0 = DANGER[0]; g0 = DANGER[1]; b0 = DANGER[2]; al = .5 + .3 * Math.sin(time * 5); sz *= .6; }
      if (st === ST.RELAY) { sz *= 1.2; }
      if (i === sel) sz *= 1.35;
      glows.add(a.x, a.y + bob, a.z, r0 * 1.5, g0 * 1.5, b0 * 1.5, al, sz);
      if (air) dots.add(a.x, a.y + bob, a.z, r0, g0, b0, st === ST.DEAD ? .6 : al, scale * .9);
      // merge flash: the moment a drone back in range swallows what the others learned
      if (a.flags & FLAG.MERGE) glows.add(a.x, a.y + bob, a.z, 1.4, 1.5, 1.45, .9, sz * 4);
      // trail
      if (st !== ST.DEAD && air) {
        const K = 40; let px = a.x, py = a.y + bob, pz = a.z;
        const tw = .5 * (1 - .5 * W.proof);
        for (let s = 1; s < K; s++) {
          const tt = Math.floor(tf) - (s - 1) * 1; if (tt < 0) break;
          const o = (tt * N + i) * tape.DR, D = tape.drones; const sst = D[o + 4]; if (sst === ST.IDLE || sst === ST.LANDED) break;
          const qx = D[o], qy = D[o + 1], qz = D[o + 2];
          const f0 = Math.pow(1 - (s - 1) / K, 1.6), f1 = Math.pow(1 - s / K, 1.6);
          trails.seg(px, py, pz, qx, qy, qz, r0, g0, b0, f0 * tw * al, f1 * tw * al);
          px = qx; py = qy; pz = qz;
        }
      }
      // thermal footprint under outdoor drones that are searching
      if (!layerIndoor[a.layer] && (st === ST.SEARCH || st === ST.FRONT || st === ST.CONVERGE || st === ST.CONFIRM) && nf < MAXN) {
        const L = tape.layers[a.layer]; const rr = Math.max(2, (a.y - L.y) * .72);
        M4.compose(P.set(a.x, L.y + .35, a.z), Q.identity(), tmpS.set(rr, 1, rr)); foot.setMatrixAt(nf++, M4);
      }
    }
    if (sel != null && A[sel] && A[sel].state !== ST.IDLE && A[sel].state !== ST.LANDED && A[sel].state !== ST.DEAD) { const a = A[sel]; follow.position.set(a.x, a.y - .3, a.z); follow.intensity = layerIndoor[a.layer] ? 2.2 : .8; follow.distance = layerIndoor[a.layer] ? 8 : 14; } else follow.intensity = 0;
    drones.count = N; drones.instanceMatrix.needsUpdate = true; rotors.count = N * 4; rotors.instanceMatrix.needsUpdate = true;
    foot.count = nf; foot.instanceMatrix.needsUpdate = true; fpMat.uniforms.a.value = .05 + .14 * W.map + .03 * (1 - W.uv);
    // ---------------- aux: tether, station, ugvs, boats
    let teth = null;
    if (auxIdx.tether >= 0) {
      auxAt(tape, tf, auxIdx.tether, tmp); auxAt(tape, tf, auxIdx.station, tmp2);
      teth = { x: tmp.x, y: tmp.y, z: tmp.z };
      tdrone.position.set(tmp.x, tmp.y + Math.sin(time * 1.3) * .1, tmp.z); tdrone.rotation.y = tmp.h;
      station.position.set(tmp2.x, tmp2.y - .05, tmp2.z);
      // the cable: a shallow catenary (parabola) from the spool to the drone's attach point
      const ax = tmp2.x, ay = tmp2.y + station.userData.out.y * station.scale.y, az = tmp2.z;
      const bx = tdrone.position.x, by = tdrone.position.y + tdrone.userData.attach.y * tdrone.scale.y, bz = tdrone.position.z;
      const chord = Math.hypot(bx - ax, by - ay, bz - az), Lc = Math.max(chord * 1.02, tape.tether.cable || chord * 1.1);
      const sag = Math.sqrt(Math.max(0, 3 * chord * (Lc - chord) / 8)) * Math.min(1, chord / 6);
      let lx = ax, ly = ay, lz = az; const NS = 36;
      for (let s = 1; s <= NS; s++) { const u = s / NS, x = ax + (bx - ax) * u, z = az + (bz - az) * u, y = ay + (by - ay) * u - sag * 4 * u * (1 - u) * (1 + .03 * Math.sin(time * 1.1 + u * 6));
        cable.seg(lx, ly, lz, x, y, z, .16, .15, .26, .95, .95); lx = x; ly = y; lz = z; }
      const up = tmp.state > 0;
      cone.visible = up; pool.visible = up;
      if (up) { const h = Math.max(3, tdrone.position.y - (tape.layers[tape.mainLayer]?.y ?? 0)); const rad = h * .38; cone.scale.set(rad, h, rad); cone.position.set(tdrone.position.x, tdrone.position.y - h / 2 - .3, tdrone.position.z); cone.material.uniforms.a.value = .6 * (1 - .6 * W.uv);
        pool.scale.setScalar(rad * 1.1); pool.position.set(tdrone.position.x, (tape.layers[tape.mainLayer]?.y ?? 0) + .3, tdrone.position.z); pool.material.uniforms.a.value = .45 * (1 - .5 * W.uv); }
      glows.add(tdrone.position.x, tdrone.position.y - .4 * tdrone.scale.y, tdrone.position.z, 1.6, 1.4, 1.1, .9, scale * .9);
      glows.add(tdrone.position.x, tdrone.position.y + .3 * tdrone.scale.y, tdrone.position.z, 1.4, .7, .7, .5 + .5 * Math.sin(time * 3), scale * .35);
    }
    let nr = 0;
    const ringAt = (x, y, z, r, col, a, fill = 0) => { if (nr >= 64) return; M4.compose(P.set(x, y, z), Q.identity(), tmpS.set(r, 1, r)); rings.setMatrixAt(nr, M4); RC[nr * 4] = col[0]; RC[nr * 4 + 1] = col[1]; RC[nr * 4 + 2] = col[2]; RC[nr * 4 + 3] = Math.min(1, Math.max(0, a)) + (fill ? 2 : 0); nr++; };
    const symW = Math.max(W.physics, B.symmetry || 0);
    auxIdx.ugv.forEach((ak, q) => {
      auxAt(tape, tf, ak, tmp); const u = ugvs[q]; u.position.set(tmp.x, tmp.y, tmp.z); u.rotation.y = -tmp.h;
      const bl = .55 + .45 * Math.sin(time * 4 + q); u.userData.beacon.material.color.setRGB(HEAT[0] * 2.2 * bl, HEAT[1] * 2.2 * bl, HEAT[2] * 2.2 * bl);
      glows.add(tmp.x, tmp.y + 2.3 * u.scale.y, tmp.z, HEAT[0] * 1.3, HEAT[1] * 1.3, HEAT[2] * 1.2, .35 + .4 * bl, scale * .5);
      if (tmp.state >= 2 && symW > .01) {
        // the robot's halo: how far its presence biases the drones (no message, just being there)
        ringAt(tmp.x, (tape.layers[tape.mainLayer]?.y ?? 0) + .4, tmp.z, 30, APR, .45 * symW, 1);
        ringAt(tmp.x, (tape.layers[tape.mainLayer]?.y ?? 0) + .4, tmp.z, 30 * (.15 + .85 * ((time * .2 + q * .5) % 1)), APR, .3 * symW * (1 - ((time * .2 + q * .5) % 1)), 0);
        for (let i = 0; i < N; i++) { const a = A[i]; if (a.team !== q || a.state === ST.DEAD || a.state === ST.LANDED || a.state === ST.IDLE) continue;
          extra.seg(a.x, a.y, a.z, tmp.x, tmp.y + 2.3 * u.scale.y, tmp.z, APR[0] * .8, APR[1] * .8, APR[2] * .8, .32 * symW, .05 * symW); }
      }
    });
    auxIdx.boat.forEach((ak, q) => { auxAt(tape, tf, ak, tmp); const bt = boats[q]; bt.position.set(tmp.x, tmp.y + Math.sin(time * 1.6 + q) * .08, tmp.z); bt.rotation.y = -tmp.h; bt.rotation.z = Math.sin(time * 1.3 + q) * .03;
      if (tmp.state === 1 || tmp.state === 3) { const bh = tmp.h + Math.PI; for (let s = 0; s < 2; s++) { const sd = s ? 1 : -1; extra.seg(tmp.x - Math.cos(tmp.h) * 2.4 * bt.scale.x, tmp.y + .15, tmp.z - Math.sin(tmp.h) * 2.4 * bt.scale.x, tmp.x + Math.cos(bh + sd * .35) * 14, tmp.y + .15, tmp.z + Math.sin(bh + sd * .35) * 14, .9, .95, 1, .35, 0); } } });
    // ---------------- links (the mesh)
    if (meshW > .01 || W.world > .01) {
      const la = tape.linkOff[k], lb = tape.linkOff[k + 1];
      const aBase = .05 + .6 * meshW;
      for (let q = la; q < lb; q++) {
        const na = tape.links[q * 2], nb = tape.links[q * 2 + 1];
        const pa = nodePos(na, teth), pb = nodePos(nb, teth); if (!pa || !pb) continue;
        const cells = tape.linkCells[q];
        const len = Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
        links.seg(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, TEAL[0], TEAL[1], TEAL[2], aBase * .9, aBase * .9, 0, len, meshW > .2 ? Math.min(1, cells / 25) * meshW : 0);
      }
    }
    // tether range (the mast's reach) in the mesh lens
    if (teth && meshW > .05) ringAt(teth.x, (tape.layers[tape.mainLayer]?.y ?? 0) + .5, teth.z, Math.min(400, tapeRadio(tape)), TEAL, .35 * meshW, 0);
    // ---------------- candidates, finds, survivors
    for (const c of tape.candidates) {
      if (tf < c.detT) continue;
      const age = (tf - c.detT) * tape.dt;
      const conf = c.confT >= 0 && tf >= c.confT, rej = c.kind !== 'person' && c._rejT >= 0 && tf >= c._rejT;
      const y = c.pos[1] + .3;
      if (c.kind === 'person') {
        const conv = c.tipT >= 0 && tf >= c.tipT;
        const k2 = conf ? 1 : conv ? .8 : .5;
        glows.add(c.pos[0], y + .4, c.pos[2], HEAT[0] * 2, HEAT[1] * 2, HEAT[2] * 1.6, (.45 + .35 * Math.sin(time * 3)) * k2, scale * (conf ? 1.3 : .9));
        const ph = (time * .6) % 1;
        const Lc = c._L, rs = Lc && !Lc.outdoor ? .45 : 1;
        ringAt(c.pos[0], y, c.pos[2], ((conv ? 5 : 3) + ph * (conv ? 9 : 5)) * rs, HEAT, (1 - ph) * .85 * k2 * (1 + (B.phase || 0)), 0);
        if (conf) ringAt(c.pos[0], y, c.pos[2], 3.6 * rs, HEAT, .85, 1);
      } else {
        const fade = rej ? Math.max(0, 1 - (tf - c._rejT) * tape.dt / 40) : 1;
        if (fade <= 0) continue;
        const ph = (time * .6) % 1, col = rej ? HAZE : HEAT;
        glows.add(c.pos[0], y + .3, c.pos[2], col[0] * 1.6, col[1] * 1.6, col[2] * 1.6, .45 * fade, scale * .7);
        const Lc = c._L, rs = Lc && !Lc.outdoor ? .45 : 1;
        ringAt(c.pos[0], y, c.pos[2], (2.5 + ph * 4) * rs, col, (1 - ph) * .7 * fade, 0);
      }
    }
    for (const s of survivors) s.obj.visible = s.c.confT >= 0 && tf >= s.c.confT;
    // ---------------- marks (stigmergy) and beacons
    const uvW = Math.max(W.uv, (B.stigmergy || 0) * .8);
    for (const m of tape.marks) {
      if (m.t > tf) continue;
      const a = .25 + .75 * uvW, fresh = Math.max(0, 1 - (tf - m.t) * tape.dt / 8);
      const col = m.kind === 'rfid' ? APR : UVC;
      glows.add(m.x, m.y, m.z, col[0] * (1.6 + 1.4 * uvW), col[1] * (1.4 + 1.2 * uvW), col[2] * (1.8 + 1.6 * uvW), Math.min(1, a * (.6 + .4 * Math.sin(time * 2 + m.x)) + fresh), scale * (.35 + 1.6 * uvW + fresh));
    }
    if (beaconMesh) {
      let nb = 0;
      for (const b of tape.beacons) { if (b.t > tf) continue; M4.compose(P.set(b.pos[0], b.pos[1] - .3, b.pos[2]), Q.identity(), tmpS.setScalar(Math.max(1.2, scale * .7))); beaconMesh.setMatrixAt(nb++, M4);
        const bl = Math.sin(time * 5 + nb * 1.3) > .2 ? 1 : .25; glows.add(b.pos[0], b.pos[1] + .2 * scale, b.pos[2], APR[0] * 1.8, APR[1] * 1.6, APR[2] * 1.4, bl * (.6 + .4 * meshW), scale * .45); }
      beaconMesh.count = nb; beaconMesh.instanceMatrix.needsUpdate = true;
    }
    // ---------------- sealed pockets (β2): lavender outline once proven
    const pkW = Math.max(W.proof, B.pocket || 0);
    for (const p of tape.pockets) {
      if (p.t < 0 || tf < p.t) continue; const L = p._L; if (!L) continue;
      const a = .35 + .65 * pkW, y = L.y + .5, set = new Set(p.cells);
      for (const c of p.cells) { const i = c % L.nx, kk = (c / L.nx) | 0; const x0 = L.x0 + i * L.cell, z0 = L.z0 + kk * L.cell, x1 = x0 + L.cell, z1 = z0 + L.cell;
        if (!set.has(c - 1)) extra.seg(x0, y, z0, x0, y, z1, LAV[0], LAV[1], LAV[2], a, a); if (!set.has(c + 1)) extra.seg(x1, y, z0, x1, y, z1, LAV[0], LAV[1], LAV[2], a, a);
        if (!set.has(c - L.nx)) extra.seg(x0, y, z0, x1, y, z0, LAV[0], LAV[1], LAV[2], a, a); if (!set.has(c + L.nx)) extra.seg(x0, y, z1, x1, y, z1, LAV[0], LAV[1], LAV[2], a, a); }
      glows.add(p.pos[0], L.y + .8, p.pos[2], LAV[0] * 1.6, LAV[1] * 1.6, LAV[2] * 1.8, .5 * a + .3 * Math.sin(time * 2) * a, scale * 1.4);
    }
    for (let q = nr; q < 64; q++) { M4.makeScale(0, 0, 0); rings.setMatrixAt(q, M4); }
    rings.count = nr; rings.instanceMatrix.needsUpdate = true; rings.geometry.attributes.rc.needsUpdate = true;
    glows.end(); dots.end(); trails.end(); links.end(); extra.end(); cable.end();
    links.U.op.value = 1;
  }
  const tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(1, 1, 1);
  const nodeTmp = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]; let nodeFlip = 0;
  function nodePos(n, teth) {
    const N = tape.N;
    if (n < N) return A[n];
    if (n === tape.nodes.TETHER) return teth;
    if (n === tape.nodes.BASE) return tape.base;
    const b = tape.beacons[n - tape.nodes.B0]; if (!b) return null; const o = nodeTmp[nodeFlip ^= 1]; o.x = b.pos[0]; o.y = b.pos[1] + .3; o.z = b.pos[2]; return o;
  }
  const tapeRadio = (t) => (t.radio && t.radio.tether) || 180;
  function droneState(i) { return A[i]; }
  // the drone's own camera must not see its footprint disc, and the follow light is softer there
  let saved = 0, savedHh = 800;
  function pipBegin(h = 160) { foot.visible = false; dots.mesh.visible = false; saved = follow.intensity; follow.intensity *= .35; savedHh = glows.U.hh.value; glows.U.hh.value = h; glows.U.maxPx.value = Math.max(10, h * .14); glows.U.minPx.value *= .6; }
  function pipEnd() { foot.visible = true; dots.mesh.visible = true; follow.intensity = saved; glows.U.hh.value = savedHh; glows.U.maxPx.value = 4096; glows.U.minPx.value /= .6; }
  return {
    root, setTape, update, droneState, pipBegin, pipEnd, get scale() { return scale; }, tdrone, ugvs: () => ugvs, boats: () => boats,
    dispose() { scene.remove(root); root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose && m.dispose()); }); },
  };
}

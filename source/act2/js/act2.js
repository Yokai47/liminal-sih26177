/* LIMINAL · Act 2 — "You are the drone." (v2)
   A collapsed floor, 4 survivors, 3 decoys, 8 hazards. The drone explores it on its own (GUIDED: frontier exploration,
   stop-and-scan, log-odds map, EKF3 + LiDAR-inertial odometry, YOLO + thermal fusion, acoustic DoA), or the viewer flies
   it (LOITER: any stick input takes over; the autonomy keeps mapping and advising).
   Usage:  const act = await createAct2(hostDiv, { tier: 'laptop'|'phone', base: 'assets/', onEvent })
   API:    act.setSensor(k, on) · act.setMode('AUTO'|'MANUAL') · act.setSpeed(1|2|4) · act.begin(mode) · act.restart(mode) · act.pause() · act.resume() · act.destroy() */
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildWorld, HOME, CEIL, CLS, mulberry } from './world.js';
import { createNav } from './nav.js';
import { createBrain } from './brain.js';
import { createPercept } from './percept.js';
import { createAcoustic, CLASSES } from './audio.js';
import { createHUD, SENSORS, spark } from './hud.js';
import { createTour, createHistory, nudge } from './tour.js';

const THERMAL_GLSL = `vec3 thermal(float x){ x=clamp(x,0.,1.);
  vec3 a=vec3(.04,.03,.12),b=vec3(.169,.102,.369),c=vec3(.482,.165,.549),d=vec3(.839,.2,.424),e=vec3(1.,.478,.102),f=vec3(1.,.824,.247),g=vec3(1.,.957,.839);
  if(x<.12) return mix(a,b,x/.12); if(x<.3) return mix(b,c,(x-.12)/.18); if(x<.5) return mix(c,d,(x-.3)/.2); if(x<.68) return mix(d,e,(x-.5)/.18); if(x<.85) return mix(e,f,(x-.68)/.17); return mix(f,g,(x-.85)/.15); }`;

export async function createAct2(host, opts = {}) {
  const tier = opts.tier || (matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 700 ? 'phone' : 'laptop');
  const PH = tier === 'phone';
  const Q = PH ? { rays: 110, dpr: 1.25, size: 4.4, pip: .3, beam: 40 } : { rays: 260, dpr: 1.5, size: 3.2, pip: .22, beam: 90 };
  const onEvent = opts.onEvent || (() => {});
  const exitAct = () => { onEvent('exit'); if (opts.onExit) opts.onExit(); else location.href = opts.backHref || '../'; };
  const TH = Object.assign({ bg: 0x030d22, lo: [.08, .3, .72], hi: [.78, .95, 1], flash: [.4, .9, 1], beam: 0x60c8ff, drone: 0x9fdcff }, opts.theme || {});
  const sensors = Object.assign({ lidar: true, camera: true, thermal: true, acoustic: true, flow: true }, opts.sensors || {});
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const ui = createHUD(host, { PH, CLASSES });
  const W = await buildWorld({ base: opts.base || 'assets/', tier, pts: opts.pts || 0, onProgress: p => { ui.bar.style.width = (p * 100).toFixed(0) + '%'; } });
  const R1 = W.ROOMS.R1, WR = W.ROOMS.W;
  const smokeAt = (x, z) => x > R1.x0 + .1 && x < R1.x1 - .1 && z > R1.z0 + .1 && z < R1.z1 - .1;
  const floodAt = (x, z) => x > WR.x0 && x < WR.x1 && z > WR.z0 && z < WR.z1;

  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.dpr)); renderer.setClearColor(TH.bg, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  ui.fpv.appendChild(renderer.domElement);
  const el = renderer.domElement; el.tabIndex = 0;
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(TH.bg, .055);
  const camera = new THREE.PerspectiveCamera(74, 1, .05, 90), thCam = new THREE.PerspectiveCamera(52, 4 / 3, .05, 40);

  // ---------- camera layer (RGB) + thermal materials ----------
  const thCache = new Map();
  const U = { uTime: { value: 0 } };
  const thMat = heat => { const k = heat.toFixed(3); if (thCache.has(k)) return thCache.get(k);
    const m = new THREE.ShaderMaterial({ uniforms: { uHeat: { value: heat }, uTime: U.uTime, uArc: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform float uHeat,uTime,uArc; varying vec3 vN; varying vec3 vW; ${THERMAL_GLSL}
        float hash(vec3 p){ return fract(sin(dot(floor(p*6.),vec3(12.9898,78.233,37.719)))*43758.5453); }
        void main(){ float h=uHeat+.03*vN.y+.022*hash(vW)+.015*sin(vW.y*2.);
          float df=length(vW.xz-vec2(28.2,-13.7)); h+=.3*exp(-df*.42)+.07*smoothstep(1.5,3.,vW.y)*step(abs(vW.x-25.5),4.5)*step(abs(vW.z+11.5),3.5);
          float de=length(vW-vec3(39.6,1.3,-11.5)); h+=(.25+.5*uArc)*exp(-de*1.6);
          if(uHeat>.6) h+=.05*sin(uTime*2.4+vW.y*3.);
          gl_FragColor=vec4(thermal(h),1.); }` });
    thCache.set(k, m); return m; };
  const rgbList = [];  // { mesh, rgb, th }
  const addRGB = (obj, heat) => { obj.traverse(m => { if (!m.isMesh) return; rgbList.push({ mesh: m, rgb: m.material, th: thMat(heat) }); }); scene.add(obj); };
  for (const m of W.meshes) addRGB(m.mesh, m.heat);
  for (const s of W.sceneObjs) addRGB(s.o, s.heat);
  const rgbMats = new Set(rgbList.map(r => r.rgb).flat());
  const rgbOnly = []; // things only the camera sees (light sources, decals, particles)

  // ---------- the LiDAR point layer ----------
  const NP = W.pts.n, pos = W.pts.pos, nor = W.pts.nor;
  const reveal = new Float32Array(NP).fill(-1), off = new Float32Array(NP * 3);
  const CS = .5, OX = -2.5, OY = -1, OZ = -36.5, GX = 90, GY = 16, GZ = 78;
  const cellStart = new Int32Array(GX * GY * GZ + 1), cellIdx = new Int32Array(NP);
  { const cnt = new Int32Array(GX * GY * GZ), cid = new Int32Array(NP);
    for (let i = 0; i < NP; i++) { const ix = Math.floor((pos[i * 3] - OX) / CS), iy = Math.floor((pos[i * 3 + 1] - OY) / CS), iz = Math.floor((pos[i * 3 + 2] - OZ) / CS);
      const c = (ix < 0 || iy < 0 || iz < 0 || ix >= GX || iy >= GY || iz >= GZ) ? -1 : (iz * GY + iy) * GX + ix; cid[i] = c; if (c >= 0) cnt[c]++; }
    for (let c = 0; c < cnt.length; c++) cellStart[c + 1] = cellStart[c] + cnt[c];
    const fill = cellStart.slice(0, -1); for (let i = 0; i < NP; i++) if (cid[i] >= 0) cellIdx[fill[cid[i]]++] = i; }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const aReveal = new THREE.BufferAttribute(reveal, 1).setUsage(THREE.DynamicDrawUsage), aOff = new THREE.BufferAttribute(off, 3).setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('aReveal', aReveal); geom.setAttribute('aOff', aOff);
  geom.setAttribute('aCls', new THREE.BufferAttribute(W.pts.cls, 1)); geom.setAttribute('aTgt', new THREE.BufferAttribute(W.pts.tgt, 1)); geom.setAttribute('aRand', new THREE.BufferAttribute(W.pts.rnd, 1));
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(20, 1.5, -17), 60);
  const NT = W.TG.length;
  Object.assign(U, { uLo: { value: new THREE.Color().fromArray(TH.lo) }, uHi: { value: new THREE.Color().fromArray(TH.hi) }, uFlash: { value: new THREE.Color().fromArray(TH.flash) },
    uSize: { value: Q.size }, uPix: { value: 1 }, uAlpha: { value: 1 }, uBoost: { value: 1 }, uDrone: { value: new THREE.Vector3() }, uOffK: { value: 1 }, uHideCeil: { value: 0 }, uFar: { value: 16 },
    uInt: { value: Object.values(CLS).map(c => c.i) }, uPaint: { value: new Array(16).fill(0) }, uPCol: { value: Array.from({ length: 16 }, () => new THREE.Color(1, .7, .3)) },
    uTh: { value: new Array(16).fill(0) }, uHeatT: { value: W.TG.map(t => t.kind === 'person' ? .93 : t.kind === 'machine' ? .62 : t.kind === 'fire' ? 1 : .15).concat(new Array(16 - NT).fill(0)) } });
  const pointMat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aReveal,aCls,aTgt,aRand; attribute vec3 aOff;
      uniform float uTime,uSize,uPix,uAlpha,uBoost,uOffK,uHideCeil,uFar; uniform vec3 uDrone,uLo,uHi,uFlash; uniform float uInt[20]; uniform float uPaint[16]; uniform vec3 uPCol[16]; uniform float uTh[16]; uniform float uHeatT[16];
      varying vec3 vC; varying float vA; ${THERMAL_GLSL}
      void main(){
        if(aReveal<0.||(uHideCeil>.5&&position.y>2.7)){ gl_Position=vec4(2.,2.,2.,1.); gl_PointSize=0.; return; }
        vec3 p=position+aOff*uOffK; vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
        float age=uTime-aReveal, flash=exp(-age*2.4), h=clamp(position.y/3.,0.,1.);
        int ci=int(aCls+.5); float inten=uInt[ci];
        vec3 c=mix(uLo,uHi,inten)*(.74+.34*h)*(.82+.36*aRand);
        if(ci==6) c=mix(c,vec3(.85,.97,1.),.25);
        c=mix(c,uFlash,min(1.,flash*1.3));
        float d=length(position-uDrone), a=clamp(1.25-d/uFar,.2,1.)*(.8+.2*flash)*uAlpha;
        int ti=int(aTgt+.5)-1;
        if(ti>=0){ float pp=uPaint[ti]; c=mix(c,uPCol[ti]*(.8+.4*aRand),pp*.9); a=mix(a,1.,pp*.6);
          float th=uTh[ti]; if(th>0.){ float t=uHeatT[ti]*(.8+.2*sin(uTime*2.6+aRand*6.28)); c=mix(c,thermal(t*(.6+.4*aRand)),th*.85); a=mix(a,1.,th); } }
        vC=c*uBoost; vA=a;
        float z=max(-mv.z,.3), ps=(1.5+uSize*(.6+.4*uBoost)/z)*uPix*(1.+.7*flash)*(ti>=0?1.+.6*uPaint[ti]:1.);
        gl_PointSize=min(ps,9.*uPix); }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 q=gl_PointCoord-.5; float r=dot(q,q); if(r>.25) discard; gl_FragColor=vec4(vC,vA*smoothstep(.25,.0,r)); }` });
  const points = new THREE.Points(geom, pointMat); points.frustumCulled = false; points.renderOrder = 2; scene.add(points);

  // ---------- light, effects ----------
  const hemi = new THREE.HemisphereLight(0x2c4a72, 0x07090c, .2); scene.add(hemi);
  const lamp = new THREE.SpotLight(0xe8f0ff, 26, 17, .78, .55, 1.5); scene.add(lamp); scene.add(lamp.target);
  const N = W.named;
  const tex = canvasTextures();
  const fireLight = new THREE.PointLight(0xff7a2a, 14, 10, 1.6); fireLight.position.set(N.D3.pos.x, .8, N.D3.pos.z); scene.add(fireLight); rgbOnly.push(fireLight);
  const flames = particles(PH ? 90 : 200, 0xff8a2a, .17, true); scene.add(flames.obj); rgbOnly.push(flames.obj);
  const fireCore = new THREE.Mesh(new THREE.SphereGeometry(.5, 16, 12), thMat(1.0)); fireCore.position.set(N.D3.pos.x, .5, N.D3.pos.z); fireCore.visible = false; scene.add(fireCore);
  const smoke = particles(PH ? 160 : 340, 0x8d949a, 1.7, false, tex.soft); smoke.mat.opacity = .15; scene.add(smoke.obj); rgbOnly.push(smoke.obj);
  const sparks = particles(PH ? 50 : 120, 0xfff2a0, .05, true); scene.add(sparks.obj); rgbOnly.push(sparks.obj);
  const arcLight = new THREE.PointLight(0x9fd8ff, 0, 8, 1.4); arcLight.position.set(39.2, 1.4, -11.5); scene.add(arcLight); rgbOnly.push(arcLight);
  let arcT = -9;
  const stream = particles(PH ? 60 : 140, 0x9fc4d6, .05, false); scene.add(stream.obj); rgbOnly.push(stream.obj);
  const drips = particles(30, 0x9fc4d6, .035, false); scene.add(drips.obj); rgbOnly.push(drips.obj);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WR.x1 - WR.x0 - .2, WR.z1 - WR.z0 - .2), new THREE.MeshStandardMaterial({ color: 0x3d6a80, roughness: .08, metalness: .35, transparent: true, opacity: .5 }));
  water.rotation.x = -Math.PI / 2; water.position.set((WR.x0 + WR.x1) / 2, .035, (WR.z0 + WR.z1) / 2); scene.add(water); rgbOnly.push(water);
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(.8, 24), water.material); puddle.rotation.x = -Math.PI / 2; puddle.position.set(19.6, .012, -17.2); puddle.scale.set(1.3, 1, 1); scene.add(puddle); rgbOnly.push(puddle);
  const strobes = (PH ? [[5, -4.2]] : [[5, -4.2], [11, -24.5], [33, -21]]).map(([x, z], i) => { const L = new THREE.PointLight(0xff2a3a, 0, 7, 1.7); L.position.set(x, 2.6, z); scene.add(L);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x551018 })); dome.rotation.x = Math.PI; dome.position.set(x, CEIL - .01, z); scene.add(dome); rgbOnly.push(dome, L);
    return { L, dome, ph: i * 1.3 }; });
  const flick = new THREE.PointLight(0xdfe8ff, 0, 9, 1.5); flick.position.set(10.2, 2.4, -14.2); if (!PH) { scene.add(flick); rgbOnly.push(flick); }
  const decal = (map, w, h, x, y, z, ry, opacity = 1) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, transparent: true, opacity, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); rgbOnly.push(m); return m; };
  decal(tex.crack, 1.6, 2.4, 30.105, 1.55, -17.6, Math.PI / 2); decal(tex.crack, 1.3, 1.8, 25.6, 2.2, -5.12, Math.PI);
  for (const [x, y, z, ry] of [[9.88, 1.6, -3.2, -Math.PI / 2], [17.88, 1.7, -17.0, -Math.PI / 2], [21.12, 1.6, -13.4, Math.PI / 2], [29.88, 1.6, -18.6, -Math.PI / 2], [12.0, 1.6, -25.88, 0]]) decal(tex.spray, 1.0, 1.0, x, y, z, ry);
  if (W.graffiti[0]) { const gm = new THREE.MeshStandardMaterial({ map: W.graffiti[0], alphaMap: W.graffiti[1], transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const [x, y, z, ry, s] of [[16, 1.5, -5.12, Math.PI, 2.2], [3.12, 1.4, -17, Math.PI / 2, 1.8], [34, 1.6, -23.88, 0, 2.4]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), gm); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); rgbOnly.push(m); } }
  const exitMat = new THREE.MeshBasicMaterial({ map: tex.exit });
  for (const [x, y, z, ry] of [[5, 2.55, -.12, Math.PI], [10.12, 2.45, -6.5, Math.PI / 2], [19.5, 2.5, -8.0 + .12, Math.PI], [4.5, 2.5, -8.12, 0], [32.5, 2.5, -14.88, 0]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(.6, .22), exitMat); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); rgbOnly.push(m); }
  const tapeMat = new THREE.MeshStandardMaterial({ map: tex.tape, roughness: .6, side: THREE.DoubleSide });
  for (const [y, rz] of [[1.0, .06], [1.9, -.1]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(3, .09), tapeMat); m.position.set(27.6, y, -6.5); m.rotation.set(0, Math.PI / 2, rz); scene.add(m); rgbOnly.push(m); }
  { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(W.leds.flat(), 3)); const cols = new Float32Array(W.leds.length * 3); W.leds.forEach((_, i) => { const c = [[.2, 1, .4], [.3, .7, 1], [1, .7, .2]][i % 3]; cols.set(c, i * 3); });
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); const leds = new THREE.Points(g, new THREE.PointsMaterial({ size: .03, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); scene.add(leds); rgbOnly.push(leds); var ledObj = leds; }

  // live LiDAR beam
  const beamPos = new Float32Array(Q.beam * 6), beamGeo = new THREE.BufferGeometry(); beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPos, 3).setUsage(THREE.DynamicDrawUsage));
  const beam = new THREE.LineSegments(beamGeo, new THREE.LineBasicMaterial({ color: TH.beam, transparent: true, opacity: .13, blending: THREE.AdditiveBlending, depthWrite: false })); beam.frustumCulled = false; beam.renderOrder = 3; scene.add(beam);
  // the drone itself (point-sampled), seen in the pull-back
  const drone = new THREE.Group(); drone.visible = false; scene.add(drone);
  const droneMat = new THREE.PointsMaterial({ color: TH.drone, size: .025, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  { const ps = [new THREE.BoxGeometry(.2, .07, .26)]; for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const arm = new THREE.BoxGeometry(.03, .02, .36); arm.rotateY(Math.atan2(sx, sz)); arm.translate(sx * .12, 0, sz * .12); ps.push(arm); const ring = new THREE.TorusGeometry(.12, .006, 4, 40); ring.rotateX(Math.PI / 2); ring.translate(sx * .24, .03, sz * .24); ps.push(ring); }
    const lg = new THREE.CylinderGeometry(.045, .045, .05, 24); lg.translate(0, .07, 0); ps.push(lg);
    const s = new MeshSurfaceSampler(new THREE.Mesh(mergeGeometries(ps.map(p => { const g = p.toNonIndexed(); g.deleteAttribute('uv'); return g; })))).build(); const _p = new THREE.Vector3();
    const n = PH ? 3000 : 8000, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { s.sample(_p); a.set([_p.x, _p.y, _p.z], i * 3); }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(a, 3)); drone.add(new THREE.Points(dg, droneMat)); drone.scale.setScalar(2.2); }

  // ---------- the systems ----------
  const nav = createNav({ roomAt: W.roomAt, smokeAt, floodAt });
  const brain = createBrain();
  const percept = createPercept(W);
  const acoustic = createAcoustic(W, { tier });
  const EN = (x, z) => `(${(x - HOME.x).toFixed(1)}, ${(-(z - HOME.z)).toFixed(1)})`;
  const say = (tag, text, cls = '') => { brain.B.log.push({ t: st.t, tag, text, cls }); if (brain.B.log.length > 4000) brain.B.log.shift(); };

  const st = { t: 0, mt: 0, phase: 'intro', mode: 'AUTO', speed: PH ? 2 : 2, x: HOME.x, y: 1.4, z: HOME.z, yaw: 0, pitch: -.1, vx: 0, vz: 0, ax: 0, az: 0, alt: 0,
    keys: {}, held: false, drag: null, servo: 0, ae: 1, scatterN: 0, retN: 0, smokeLog: -99, theta: 0, revealed: 0, hitsT: new Int32Array(NT), collisions: 0, lastBump: -9, shake: 0, wh: 0, dist: 0, trail: [], trailT: 0,
    snap: 0, endT: 0, pull: 0, orbit: 0, dragOrbit: false, running: true, cpu: 40, landed: false, failsafe: null, lastLioLog: -9, focusIdx: -1, arc: null, rtlReq: false, monitor: 'off' };
  const BAT_WH = 77, RESERVE_WH = 8; let lastLogN = 0, killNudge = null;
  const inside = (x, z) => !!W.roomAt(x, z);
  let roomCells = 0; { const g = brain.grid; for (let j = 0; j < g.NZ; j++) for (let i = 0; i < g.NX; i++) if (inside(g.X0 + (i + .5) * g.RES, g.Z0 + (j + .5) * g.RES)) roomCells++; }

  // ---------- input ----------
  el.addEventListener('pointerdown', e => { if (e.isPrimary && st.phase === 'end') { st.dragOrbit = { x: e.clientX, o: st.orbit }; el.setPointerCapture(e.pointerId); return; } });
  el.addEventListener('pointermove', e => { if (st.dragOrbit && st.phase === 'end') st.orbit = st.dragOrbit.o - (e.clientX - st.dragOrbit.x) / 220; });
  el.addEventListener('pointerup', () => { st.dragOrbit = false; });
  el.addEventListener('pointerdown', e => { if (!e.isPrimary || e.button !== 0 || st.phase !== 'fly' || st.frozen) return; st.held = true; st.drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, type: e.pointerType };
    el.setPointerCapture(e.pointerId); el.focus({ preventScroll: true }); el.style.cursor = 'grabbing'; pilotInput(); });
  el.addEventListener('pointermove', e => { if (!e.isPrimary) return; const r = el.getBoundingClientRect();
    if (e.pointerType === 'mouse') { st.mx = ((e.clientX - r.left) / r.width) * 2 - 1; st.my = ((e.clientY - r.top) / r.height) * 2 - 1; st.mouseIn = true; }
    if (st.held && st.drag) { st.drag.dx = (e.clientX - st.drag.x) / r.width; st.drag.dy = (e.clientY - st.drag.y) / r.height; } });
  el.addEventListener('pointerleave', () => { st.mouseIn = false; });
  const up = e => { if (e && !e.isPrimary) return; st.held = false; st.drag = null; el.style.cursor = 'grab'; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  const KEYS = ['w', 'a', 's', 'd', 'q', 'e', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  const kd = e => { const k = e.key.toLowerCase(); if (st.frozen) return; if (KEYS.includes(k) && st.phase === 'fly') { st.keys[k] = true; e.preventDefault(); pilotInput(); } };
  const ku = e => { st.keys[e.key.toLowerCase()] = false; };
  const clearKeys = () => { st.keys = {}; st.held = false; };
  el.addEventListener('keydown', kd); el.addEventListener('keyup', ku); el.addEventListener('blur', clearKeys); addEventListener('blur', clearKeys);
  function pilotInput() { if (st.mode !== 'MANUAL' && st.phase === 'fly' && !brain.B.done) { setMode('MANUAL'); toast('Stick input → LOITER. Pilot override always wins. Press AUTO to hand back.', '#ffb35c'); } }

  ui.intro.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) begin(b.dataset.go); if (e.target.closest('[data-back]')) exitAct(); });
  // end the run whenever you like: straight to the mission report
  ui.end.addEventListener('click', () => {
    if (st.phase !== 'fly') return;
    if (tour.active) tour.end(true);
    st.frozen = false; brain.B.reason = brain.B.reason || 'stopped early by the operator'; brain.B.done = true; st.landed = true;
    toast('Simulation ended. Here is what it found so far.', '#ff9fb0'); endMission();
  });
  // scrolling up on the intro or the report takes you back to the story
  let wheelUp = 0, wheelT = 0, touchY = null;
  const backGesture = (dy) => { if (st.phase !== 'end' && st.phase !== 'intro') return; if (hist.open) return; const now = performance.now(); if (now - wheelT > 1500) wheelUp = 0; wheelT = now; wheelUp += dy; if (wheelUp < -220) { wheelUp = 0; exitAct(); } };
  const onWheel = e => { if (e.deltaY < 0 && ui.root.isConnected) backGesture(e.deltaY); };
  addEventListener('wheel', onWheel, { passive: true });
  ui.root.addEventListener('touchstart', e => { touchY = e.touches[0].clientY; }, { passive: true });
  ui.root.addEventListener('touchend', e => { if (touchY == null) return; const d = e.changedTouches[0].clientY - touchY; touchY = null; if (d > 140) backGesture(-300); }, { passive: true });
  ui.sens.addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (!b) return; setSensor(b.dataset.s, !sensors[b.dataset.s]); el.focus({ preventScroll: true }); });
  ui.mode.addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) { setMode(b.dataset.mode); el.focus({ preventScroll: true }); } });
  ui.end.hidden = false;
  ui.rtl.addEventListener('click', () => { if (st.phase !== 'fly' || brain.B.done) return; if (st.mode === 'MANUAL') setMode('AUTO'); st.rtlReq = true; toast('Return to launch: plan home on the map, then land.', '#9fdcff'); el.focus({ preventScroll: true }); });
  ui.spd.addEventListener('click', e => { const b = e.target.closest('[data-spd]'); if (b) setSpeed(+b.dataset.spd); });
  ui.mon.addEventListener('click', e => { const b = e.target.closest('[data-mon]'); if (!b) return; st.monitor = acoustic.setMode(b.dataset.mon); ui.mon.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.mon === st.monitor));
    if (st.monitor === 'raw') toast('RAW: what the microphones hear, rotors included.', '#b49cff'); if (st.monitor === 'clean') toast('CLEAN: rotor noise subtracted, non-human classes masked.', '#b49cff'); });
  function setSensor(k, on) {
    if (!(k in sensors)) return; sensors[k] = !!on; paintSens();
    const S = SENSORS.find(s => s.k === k); toast(`${S.name} ${on ? 'on' : 'off'} · ${on ? S.on : S.off}`, on ? S.c : '#8A8A86');
    say('SENSOR', `${S.name} ${on ? 'enabled' : 'disabled'}`, on ? 'good' : 'bad'); onEvent('sensor', { k, on });
  }
  function paintSens() { ui.sens.querySelectorAll('[data-s]').forEach(b => b.classList.toggle('off', !sensors[b.dataset.s])); }
  function setMode(m) { if (m === st.mode) return; st.mode = m; ui.mode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); ui.help.hidden = m !== 'MANUAL'; if (m === 'MANUAL') setSpeed(1, true); paintSpeed(); onEvent('mode', m); }
  function setSpeed(s, force) { if (st.mode === 'MANUAL' && !force && s !== 1) { toast('Time-lapse is for watching the autonomy. Flying is in real time.', '#8fb6d8'); return; } st.speed = s; paintSpeed(); }
  function paintSpeed() { ui.spd.querySelectorAll('button').forEach(b => { b.classList.toggle('on', +b.dataset.spd === st.speed); b.disabled = st.mode === 'MANUAL' && +b.dataset.spd !== 1; b.style.opacity = b.disabled ? .35 : 1; }); }
  paintSens(); ui.mode.querySelector('[data-mode=AUTO]').classList.add('on'); paintSpeed();

  // map hover
  let hover = null; ui.map.addEventListener('pointermove', e => { const r = ui.map.getBoundingClientRect(); hover = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; });
  ui.map.addEventListener('pointerleave', () => { hover = null; });

  // ---------- frame & layout ----------
  let w = 1, h = 1; const pip = { x: 0, y: 0, w: 0, h: 0 };
  function resize() { const r = ui.fpv.getBoundingClientRect(); w = Math.max(1, r.width); h = Math.max(1, r.height); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    U.uPix.value = Math.max(.8, h / 800) * renderer.getPixelRatio();
    const sideW = PH ? 0 : ui.side.getBoundingClientRect().width;
    const pw = Math.round(Math.min((w - sideW) * Q.pip, PH ? 150 : 300)), ph = Math.round(pw * .75); pip.w = pw; pip.h = ph;
    pip.x = PH ? w - pw - 8 : 12; pip.y = PH ? 100 : h - ph - 12; Object.assign(ui.pip.style, { left: pip.x + 'px', top: pip.y + 'px', width: pw + 'px', height: ph + 'px', bottom: 'auto', right: 'auto' });
    sizeCanvas(ui.map); sizeCanvas(ui.doa); }
  function sizeCanvas(c) { const r = c.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); c.width = Math.max(10, Math.round(r.width * d)); c.height = Math.max(10, Math.round(r.height * d)); }
  ui.raw.width = ui.clean.width = 320; ui.raw.height = ui.clean.height = 64;
  const ro = new ResizeObserver(() => resize()); ro.observe(host); ro.observe(ui.map); resize();
  let onScreen = true; const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => { onScreen = es[0].isIntersecting; if (!onScreen) clearKeys(); }) : null; if (io) io.observe(host);

  // ---------- start / restart ----------
  function resetAll() {
    reveal.fill(-1); off.fill(0); aReveal.needsUpdate = true; aOff.needsUpdate = true; st.hitsT.fill(0);
    Object.assign(st, { t: 0, mt: 0, x: HOME.x, y: .15, z: HOME.z, yaw: HOME.yaw, pitch: -.1, vx: 0, vz: 0, ax: 0, az: 0, revealed: 0, collisions: 0, wh: 0, dist: 0, trail: [], snap: 0, pull: 0, landed: false, failsafe: null, rtlReq: false, arc: null, focusIdx: -1 });
    nav.reset(); brain.reset(HOME); percept.reset(); acoustic.reset();
    U.uOffK.value = 1; U.uHideCeil.value = 0; U.uFar.value = 16; for (let i = 0; i < 16; i++) { U.uPaint.value[i] = 0; U.uTh.value[i] = 0; }
    drone.visible = false; droneMat.opacity = 0; ui.score.hidden = true; ui.hud.classList.remove('ending'); lastLogN = 0; st.frozen = false; hist.close(); hist.reset(); if (killNudge) { killNudge(); killNudge = null; }
  }
  // ---------- guide (first time), reasoning history ----------
  const GUIDE_KEY = 'liminal.act2.guide.v1';
  const seenGuide = () => { try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch (e) { return false; } };
  const tour = createTour(ui, { PH, getMode: () => st.mode, onDone: skipped => { st.frozen = false; brain.B.stuckRef = null; try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) {} el.focus({ preventScroll: true }); onEvent('guide', skipped ? 'skipped' : 'done'); } });
  const hist = createHistory(ui, { getLog: () => brain.B.log, fmt: s => fmt(s), esc: s => esc(s) });
  ui.exp.addEventListener('click', () => hist.show());
  ui.guide.addEventListener('click', () => { if (st.phase !== 'fly' || tour.active) return; hist.close(); st.frozen = true; clearKeys(); tour.start(); });
  function preroll(sec) { const k = Math.round(sec * 30); for (let i = 0; i < k; i++) { beamN = 0; step(1 / 30); } }
  function begin(mode = 'AUTO') { resetAll(); ui.intro.hidden = true; ui.hud.hidden = false; ui.root.classList.add('flying'); resize(); st.phase = 'fly'; st.mode = null; setMode(mode); if (mode === 'AUTO') setSpeed(2);
    const guide = opts.guide === true || (opts.guide !== false && !opts.autoStart && !seenGuide());
    if (guide) { preroll(mode === 'AUTO' ? 3.85 : 3.6); st.frozen = true; clearKeys(); requestAnimationFrame(() => requestAnimationFrame(() => { paintOSD(); drawMap(); paintWhy(); paintClasses(); paintRing(); tour.start(); })); }
    el.focus({ preventScroll: true }); onEvent('start', mode); }
  function restart(mode) { begin(mode || st.mode); }
  ui.load.hidden = true; ui.intro.hidden = false;

  // ---------- simulation step ----------
  const ray = new THREE.Ray(), cp = {}, _v = new THREE.Vector3();
  const RANGE = 12, RR = .36, RR2 = RR * RR;
  let dirty = false, dirtyOff = false, beamN = 0;
  function revealAround(hx, hy, hz, ox, oy, oz, ex, ez) {
    const ix0 = Math.floor((hx - RR - OX) / CS), ix1 = Math.floor((hx + RR - OX) / CS), iy0 = Math.floor((hy - RR - OY) / CS), iy1 = Math.floor((hy + RR - OY) / CS), iz0 = Math.floor((hz - RR - OZ) / CS), iz1 = Math.floor((hz + RR - OZ) / CS);
    const drifting = ex * ex + ez * ez > 4e-4;
    for (let iz = iz0; iz <= iz1; iz++) for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) { if (ix < 0 || iy < 0 || iz < 0 || ix >= GX || iy >= GY || iz >= GZ) continue;
      const c = (iz * GY + iy) * GX + ix;
      for (let k = cellStart[c]; k < cellStart[c + 1]; k++) { const i = cellIdx[k]; if (reveal[i] >= 0) continue;
        const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2], dx = px - hx, dy = py - hy, dz = pz - hz; if (dx * dx + dy * dy + dz * dz > RR2) continue;
        if ((ox - px) * nor[i * 3] + (oy - py) * nor[i * 3 + 1] + (oz - pz) * nor[i * 3 + 2] < 0) continue;
        reveal[i] = st.t; st.revealed++; dirty = true; const tg = W.pts.tgt[i]; if (tg > 0) st.hitsT[tg - 1]++;
        if (drifting) { off[i * 3] = ex; off[i * 3 + 2] = ez; dirtyOff = true; } } } }

  function lidar(dt, sweep) {
    const n = Math.max(12, Math.round(Q.rays / Math.sqrt(st.speed)));
    const ox = st.x, oy = st.y + .07, oz = st.z, e = nav.S.e;
    const th0 = st.theta, th1 = st.theta + 5.5 * Math.PI * 2 * dt; st.theta = th1;
    const sv1 = sweep ? .61 * Math.sin((brain.B.scanT / (brain.B.scanDur || 3.2)) * Math.PI * 2 * 1.5) : 0, sv0 = st.servo; st.servo = sv1;
    const smokeHere = smokeAt(ox, oz), range = smokeHere ? 3.2 : RANGE;
    for (let r = 0; r < n; r++) {
      const th = th0 + (th1 - th0) * (r + Math.random()) / n, phi = sv0 + (sv1 - sv0) * (r + Math.random()) / n + (sweep ? 0 : (Math.random() - .5) * .02);
      const c = Math.cos(phi), dx = c * Math.sin(th), dy = Math.sin(phi), dz = c * Math.cos(th);
      let t = -1, scatter = false;
      if (smokeHere && Math.random() < .35) { t = .4 + Math.random() * 2.2; scatter = true; } // smoke backscatter: weak, short, non-persistent returns
      else { ray.origin.set(ox, oy, oz); ray.direction.set(dx, dy, dz); const hit = W.bvh.raycastFirst(ray, THREE.DoubleSide, 0, range); if (hit) t = hit.distance; }
      if (t > 0) { const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t; if (!scatter) revealAround(hx, hy, hz, ox, oy, oz, e[0], e[1]);
        if (beamN < Q.beam && r % 3 === 0) { beamPos.set([ox, oy - .05, oz, hx, hy, hz], beamN * 6); beamN++; } }
      if (scatter) { st.scatterN++; continue; }   // rejected by the intensity gate: never inserted into the map
      st.retN++; brain.insertRay(ox + e[0], oy, oz + e[1], dx, dy, dz, t, range);   // sweep: whole tilt sweep; level: one 2-D revolution
    }
    if (!sweep && Math.floor(th1 / 6.2832) !== Math.floor(th0 / 6.2832)) brain.commit();
  }

  function step(dt) {
    st.t += dt; U.uTime.value = st.t;
    const flying = st.phase === 'fly' && !st.landed;
    if (st.phase === 'fly') st.mt += dt;
    // ---- autonomy / pilot → velocity command
    const estX = st.x + nav.S.e[0], estZ = st.z + nav.S.e[1];
    let cmd = null;
    if (st.phase === 'fly') {
      if (st.rtlReq) { st.rtlReq = false; brain.B.rtlWhy = 'operator request'; brain.B.state = 'SELECT'; brain.B.forceHome = true; }
      cmd = brain.tick(dt, { t: st.t, mode: st.mode, pose: { x: estX, z: estZ, yaw: st.yaw }, vel: [st.vx, st.vz], sensors, lio: nav.S.lio, failsafe: nav.S.failsafe,
        candidates: percept.P.cands, tracks: acoustic.A.tracks, energy: { remainWh: BAT_WH - st.wh, whPerM: (240 / 1.2) / 3600, reserveWh: RESERVE_WH } });
    }
    let vdx = 0, vdz = 0, yawRate = 0, pitchWant = -.1;
    if (st.phase === 'fly' && st.mode === 'MANUAL' && !brain.B.done) {
      const K = st.keys, dzn = v => Math.sign(v) * Math.max(0, Math.abs(v) - .18) / .82, mouse = st.drag ? st.drag.type === 'mouse' : (st.mouseIn && !PH);
      let thrust = (st.held ? 1 : 0) + (K.w || K.arrowup || K[' '] ? 1 : 0) - (K.s || K.arrowdown ? 1 : 0), strafe = (K.e ? 1 : 0) - (K.q ? 1 : 0);
      let turn = (st.held && st.drag && st.drag.type !== 'mouse' ? -st.drag.dx * 3.2 : (st.mouseIn && !PH ? -dzn(st.mx) * 1.1 : 0)) + (K.a || K.arrowleft ? 1 : 0) - (K.d || K.arrowright ? 1 : 0);
      pitchWant = st.held && st.drag && st.drag.type !== 'mouse' ? -st.drag.dy * .9 - .1 : (st.mouseIn && !PH ? -dzn(st.my) * .4 - .08 : -.1);
      const fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw), rx = Math.cos(st.yaw), rz = -Math.sin(st.yaw);
      vdx = (fx * thrust + rx * strafe) * 1.8; vdz = (fz * thrust + rz * strafe) * 1.8; yawRate = turn * 1.5;
    } else if (cmd && !cmd.land && cmd.sp) {
      const ex = cmd.sp.x - estX, ez = cmd.sp.z - estZ; let k = 1.5; vdx = ex * k; vdz = ez * k; const m = Math.hypot(vdx, vdz), vm = cmd.vmax || 1.2; if (m > vm) { vdx *= vm / m; vdz *= vm / m; }
      if (cmd.yawRate) yawRate = cmd.yawRate; else if (cmd.yawT != null) { let da = cmd.yawT - st.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); yawRate = Math.max(-1.8, Math.min(1.8, da * 2.5)); }
      const B = brain.B; if (B.state === 'INVESTIGATE' && B.inv && B.goal) { const dd = Math.hypot(B.goal.tx - st.x, B.goal.tz - st.z); pitchWant = Math.max(-.6, Math.atan2(.35 - 1.4, dd)); }
    }
    if (nav.S.failsafe && !st.failsafe) { st.failsafe = nav.S.failsafe; }
    // ---- multicopter dynamics: velocity follows the command with a lag; tilt = acceleration / g
    const tau = .35, avx = (vdx - st.vx) / tau, avz = (vdz - st.vz) / tau; st.ax = avx; st.az = avz; st.vx += avx * dt; st.vz += avz * dt;
    if (!sensors.flow && !sensors.lidar && flying) { st.vx += (Math.random() - .5) * .9 * dt; st.vz += (Math.random() - .5) * .9 * dt; }
    else if (!sensors.flow && flying) { st.vx += (Math.random() - .5) * .25 * dt; st.vz += (Math.random() - .5) * .25 * dt; }
    st.yaw += yawRate * dt; st.pitch += (pitchWant - st.pitch) * Math.min(1, dt * 4);
    // proximity avoidance (LiDAR) + collision
    if (flying) {
      _v.set(st.x, st.y, st.z);
      if (sensors.lidar) { const R0 = st.mode === 'MANUAL' ? .85 : .5; const hit = W.bvh.closestPointToPoint(_v, cp, 0, R0); if (hit && hit.distance < R0) { const dx = st.x - cp.point.x, dz = st.z - cp.point.z, d = Math.hypot(dx, dz) || 1e-3, k = (R0 - hit.distance) * 4 * dt; st.vx += dx / d * k; st.vz += dz / d * k; } }
      st.x += st.vx * dt; st.z += st.vz * dt;
      _v.set(st.x, st.y, st.z); const hit = W.bvh.closestPointToPoint(_v, cp, 0, .3);
      if (hit && hit.distance < .3) { const dx = st.x - cp.point.x, dz = st.z - cp.point.z, d = Math.hypot(dx, dz) || 1e-3; const vn = (st.vx * dx + st.vz * dz) / d;
        st.x = cp.point.x + dx / d * .3; st.z = cp.point.z + dz / d * .3; if (vn < 0) { st.vx -= vn * dx / d * 1.5; st.vz -= vn * dz / d * 1.5; }
        if (vn < -.5 && st.t - st.lastBump > .8) { st.collisions++; st.lastBump = st.t; st.shake = .25; if (!sensors.lidar) toast('Bump. No LiDAR → no proximity sensing.', '#ff6b6b'); const nm = W.OBJ[W.oidOfFace(hit.faceIndex)].name.replace('struct:', '').replace(/_/g, ' ');
          say('CONTACT', `collision at ${Math.abs(vn).toFixed(1)} m/s with ${nm}${sensors.lidar ? '' : ' (no proximity avoidance without LiDAR)'}`, 'bad'); } }
    }
    // altitude
    const landing = cmd && cmd.land, wantY = st.phase !== 'fly' ? st.y : landing ? .14 : 1.4;
    st.y += (wantY - st.y) * Math.min(1, dt * (landing ? 1.1 : 1.6)); if (flying) st.y += Math.sin(st.t * 1.7) * .0006 * (sensors.flow ? 1 : 3);
    if (brain.B.done && !st.landed) { st.landed = true; st.vx = st.vz = 0; endMission(); }
    // energy
    const sp = Math.hypot(st.vx, st.vz); st.dist += sp * dt; if (st.phase === 'fly' && !st.landed) st.wh += (205 + 35 * sp) * dt / 3600;
    // ---- state estimation
    if (st.phase === 'fly') nav.update(dt, { x: st.x, z: st.z, vx: st.vx, vz: st.vz }, sensors, st.t);
    // ---- LiDAR
    const sweeping = !!(cmd && cmd.sweep) && sensors.lidar;
    if (sensors.lidar && st.phase === 'fly' && st.y > .8) lidar(dt, sweeping); else st.servo = 0;
    // ---- perception
    if (st.phase === 'fly') percept.update(dt, { t: st.t, cam: { x: st.x, y: st.y, z: st.z, yaw: st.yaw, pitch: st.pitch }, sensors, e: nav.S.e, inSmoke: smokeAt, lidarHits: st.hitsT, tracks: acoustic.A.tracks, lidarOn: sensors.lidar });
    // ---- acoustic
    if (st.phase === 'fly') acoustic.update(dt, { t: st.t, x: st.x, y: st.y, z: st.z, yaw: st.yaw, e: nav.S.e, enabled: sensors.acoustic, rotor: !st.landed && st.y > .3, moving: sp > .3, onZap: () => { arcT = st.t; } });
    if (smokeAt(st.x, st.z) && sensors.lidar && st.t - st.smokeLog > 12 && st.retN + st.scatterN > 200) { st.smokeLog = st.t;
      say('LIDAR', `smoke: ${(st.scatterN / (st.scatterN + st.retN) * 100).toFixed(0)} % of returns are weak, short and non-persistent → rejected as particulate scatter (intensity gate) · usable range ~3 m`, 'bad'); }
    if (!smokeAt(st.x, st.z)) { st.scatterN = 0; st.retN = 0; }
    processEvents();
    // trail
    if ((st.trailT += dt) > .3) { st.trailT = 0; st.trail.push([estX, estZ]); if (st.trail.length > 3000) st.trail.shift(); }
    // loop-closure snap animation
    if (st.snap > 0) { st.snap = Math.max(0, st.snap - dt / .8); U.uOffK.value = st.snap; if (st.snap === 0) { off.fill(0); aOff.needsUpdate = true; U.uOffK.value = 1; } }
    // effects
    effects(dt);
  }

  // ---------- events → trace, toasts ----------
  const cmp = b => ((180 - b * 57.2958) % 360 + 360) % 360;
  function processEvents() {
    for (const ev of nav.S.events.splice(0)) {
      if (ev.k === 'lio' && st.t - st.lastLioLog > 3) { st.lastLioLog = st.t;
        const why = ev.to === 'DEGENERATE' ? 'scan geometry constrains only the cross-corridor axis' : ev.to === 'DEGRADED' ? 'smoke: returns scattered, match fitness falls' : ev.to === 'LOST' ? 'no LiDAR returns' : 'well-constrained scan geometry';
        say('SLAM', `LIO ${ev.from} → ${ev.to} · ${why}${ev.to === 'DEGENERATE' ? (sensors.flow ? ' · optical flow holds velocity along it' : ' · flow is off: position slides along the corridor') : ''}`, ev.to === 'TRACKING' ? 'good' : 'bad'); }
      if (ev.k === 'loop') { say('LOOP', `loop closure: keyframe #${ev.kf} (${ev.age.toFixed(0)} s ago) re-observed · ICP fitness ${ev.fit.toFixed(2)} · ${(ev.corr * 100).toFixed(0)} cm of drift removed · pose graph re-optimised (${ev.n} keyframes) → map re-anchored`, 'good');
        st.snap = 1; toast(`Loop closure: ${(ev.corr * 100).toFixed(0)} cm of drift removed, the map snaps back.`, '#5ef2b5'); }
      if (ev.k === 'failsafe') { toast('EKF failsafe: no LiDAR and no optical flow → position unobservable → LAND.', '#ff6b6b'); }
    }
    for (const ev of percept.P.events.splice(0)) {
      const tg = ev.tg; const cls = ev.k === 'confirmed' ? 'good' : ev.k === 'false' ? 'bad' : ev.k === 'hazard' ? 'haz' : ev.k === 'rejected' ? 'dim' : 'per';
      const name = tg.kind === 'person' ? `SURVIVOR ${tg.id.slice(1)}` : tg.kind === 'hazard' ? 'HAZARD' : tg.name.toUpperCase();
      if (ev.k === 'cand') say('DETECT', `${ev.text} at ~${EN(tg.pos.x + nav.S.e[0], tg.pos.z + nav.S.e[1])} → candidate for inspection`, 'per');
      else say(ev.k === 'hazard' ? 'HAZARD' : ev.k === 'rejected' ? 'REJECT' : ev.k === 'false' ? 'FALSE+' : ev.k === 'likely' ? 'LIKELY' : 'PERSON', `${name} · ${ev.text}`, cls);
      if (ev.k === 'confirmed') { toast(`Survivor ${tg.id.slice(1)} confirmed: camera + thermal agree.`, '#ffd23f'); onEvent('found', tg.id); closeTrack(tg); }
      if (ev.k === 'unverified') { toast(`Survivor ${tg.id.slice(1)} reported unverified: only one sensor could check.`, '#ff9a3d'); closeTrack(tg); }
      if (ev.k === 'false') toast('False alarm: ' + ev.text.replace('FALSE ALARM · ', ''), '#ff6b6b');
      if (ev.k === 'rejected') toast(`Rejected: ${tg.name.toLowerCase()} (${tg.temp.toFixed(0)} °C).`, '#8A8A86');
    }
    for (const { tr, m } of acoustic.A.newBearings) {
      const c = CLASSES.find(k => k.k === tr.cls), snr = m.snr.toFixed(1), b = cmp(m.b).toFixed(0).padStart(3, '0'), s = (m.s * 57.3).toFixed(0);
      if (tr.n === 1) { say('ACOUSTIC', `${tr.cls} detected (${c.label}) · SNR ${snr} dB after ego-noise suppression · p ${tr.conf.toFixed(2)} · DoA ${b}° ±${s}°`, 'ac'); toast(`Acoustic: ${c.label} detected · ${b}°`, '#b49cff'); onEvent('heard', tr.cls); }
      else say('DoA', `${tr.cls} bearing #${tr.n} from ${EN(m.x, m.z)}: ${b}° ±${s}° · SNR ${snr} dB`, 'ac');
      const occ = brain.B.rayFirstOcc(m.x, m.z, m.b, 24);
      if (occ && (!tr.occLogT || st.t - tr.occLogT > 14)) { tr.occLogT = st.t; say('OCCLUDED', `DoA ray meets occupied cells at ${occ.d.toFixed(1)} m (ℓ = +${occ.L.toFixed(2)}) → no line of sight: the source is beyond that boundary · frontiers near this bearing get the acoustic prior`, 'ac'); }
      if (tr.est && (!tr.estLogN || tr.n - tr.estLogN >= 2)) { tr.estLogN = tr.n; say('LOCATE', `${tr.cls}: ${tr.est.n} bearings fused (bearing-only posterior, 1 m cells) · baseline ${tr.est.base.toFixed(1)} m → mean ${EN(tr.est.x, tr.est.z)} · 1σ ${tr.est.s.toFixed(1)} × ${tr.est.s2.toFixed(1)} m${tr.est.s < 2 ? ' → precise enough to inspect' : ' → still a ridge along the bearing: needs a different viewpoint'}`, 'ac'); }
      st.arc = { t: st.t, b: m.b, cls: tr.cls, s: m.s };
    }
    for (const e of acoustic.A.events) if (CLASSES.find(c => c.k === e.k).human && e.missed && !e.logged) { e.logged = true; const tr = acoustic.A.tracks.find(k => k.cls === e.k); if (tr && (!tr.open || (tr.missLog && st.t - tr.missLog < 25))) continue; if (tr) tr.missLog = st.t; if (sensors.acoustic && acoustic.A.snr[CLASSES.findIndex(c => c.k === e.k)] > -6) say('ACOUSTIC', `${e.k} energy below detection: SNR ${acoustic.A.snr[CLASSES.findIndex(c => c.k === e.k)].toFixed(1)} dB < 3 dB (masked by ${maskedBy()})`, 'dim'); }
  }
  function maskedBy() { const A = acoustic.A; const nh = CLASSES.map((c, i) => [c, A.lvl[i]]).filter(([c]) => !c.human && c.k !== 'ROTOR').sort((a, b) => b[1] - a[1]); return nh[0] && nh[0][1] > 40 ? nh[0][0].label : 'rotor ego-noise residual'; }
  function closeTrack(tg) { for (const tr of acoustic.A.tracks) if (tr.src === tg.id && tr.open) { tr.open = false; const est = tr.est ? ` (${Math.hypot(tr.est.x - tg.pos.x, tr.est.z - tg.pos.z).toFixed(1)} m from the acoustic estimate)` : '';
      say('TRACK', `${tr.cls} track associated with SURVIVOR ${tg.id.slice(1)}${est} → closed`, 'good'); } }

  function effects(dt) {
    const fl = .75 + .25 * Math.sin(st.t * 17) * Math.sin(st.t * 7.3) + .1 * Math.random(); fireLight.intensity = 13 * fl;
    const F = N.D3.pos;
    flames.update(dt, (p, i, v) => { p[i] = F.x + (Math.random() - .5) * .8; p[i + 1] = .05; p[i + 2] = F.z + (Math.random() - .5) * .8; v[i] = (Math.random() - .5) * .2; v[i + 1] = .8 + Math.random() * .9; v[i + 2] = (Math.random() - .5) * .2; }, 1.1);
    smoke.update(dt, (p, i, v) => { p[i] = R1.x0 + .3 + Math.random() * (R1.x1 - R1.x0 - .6); p[i + 1] = .4 + Math.random() * 2.4; p[i + 2] = R1.z0 + .3 + Math.random() * (R1.z1 - R1.z0 - .6); v[i] = (Math.random() - .5) * .08; v[i + 1] = .03 + Math.random() * .05; v[i + 2] = (Math.random() - .5) * .08; }, 18);
    stream.update(dt, (p, i, v) => { p[i] = 28.6 + (Math.random() - .5) * .08; p[i + 1] = 2.25; p[i + 2] = -15.55; v[i] = (Math.random() - .5) * .3; v[i + 1] = -2.5 - Math.random(); v[i + 2] = -.4 - Math.random() * .3; }, .75);
    drips.update(dt, (p, i, v) => { p[i] = 19.6 + (Math.random() - .5) * .2; p[i + 1] = 2.7; p[i + 2] = -17.2; v[i] = 0; v[i + 1] = -3 - Math.random(); v[i + 2] = 0; }, .9);
    const arc = Math.max(0, 1 - (st.t - arcT) / .25) * (Math.random() < .7 ? 1 : .2), crackle = Math.random() < .04 ? .5 : 0;
    arcLight.intensity = 22 * Math.max(arc, crackle);
    sparks.update(dt, (p, i, v, first) => { if (!first && arc < .1 && Math.random() > .02) { p[i + 1] = -10; v[i] = v[i + 1] = v[i + 2] = 0; return; } p[i] = 39.45; p[i + 1] = 1.3 + (Math.random() - .5) * .3; p[i + 2] = -11.5 + (Math.random() - .5) * .4; v[i] = -.6 - Math.random() * 1.2; v[i + 1] = Math.random() * 1.5 - .2; v[i + 2] = (Math.random() - .5) * 1.4; }, .5, -4);
    for (const m of thCache.values()) m.uniforms.uArc.value = Math.max(arc, .15);
    for (const sb of strobes) { const ph = (st.t * 1.6 + sb.ph) % 1, on = ph < .08 || (ph > .16 && ph < .24); sb.L.intensity = on ? 9 : 0; sb.dome.material.color.setHex(on ? 0xff3344 : 0x551018); }
    flick.intensity = Math.random() < .08 ? 0 : (Math.sin(st.t * 37) > .3 ? 6 : 1.2);
    if (ledObj) ledObj.material.opacity = .6 + .4 * Math.sin(st.t * 9);
  }

  // ---------- mission end ----------
  function endMission() { st.phase = 'pull'; st.pull = 0; st.endT = st.t; drone.visible = true; ui.hud.classList.add('ending'); onEvent('landed', brain.B.reason); say('END', `mission time ${fmt(st.mt)} · ${st.dist.toFixed(0)} m flown · ${st.wh.toFixed(1)} Wh`, 'mode'); }

  // ---------- render ----------
  const eye = new THREE.Vector3(), look = new THREE.Vector3(), proj = new THREE.Vector3();
  let last = performance.now(), raf = 0, uiT = 0, mapT = 0, osdT = 0; const perf = { acc: 0, n: 0 };
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!st.running || !onScreen || document.hidden) { last = now; acoustic.mute(true); return; }
    acoustic.mute(!sensors.acoustic || st.phase !== 'fly');
    const dt = Math.max(0, Math.min(.05, (now - last) / 1000)); last = now;
    if (st.frozen) { // guide on screen: the world keeps breathing (sound, sparks, fire), the mission clock and the autonomy wait
      st.t += dt; U.uTime.value = st.t; beamN = 0;
      acoustic.update(dt, { t: st.t, x: st.x, y: st.y, z: st.z, yaw: st.yaw, e: nav.S.e, enabled: sensors.acoustic, rotor: true, moving: false, onZap: () => { arcT = st.t; } });
      effects(dt); draw(dt); return; }
    const t0 = performance.now();
    beamN = 0;
    const n = st.phase === 'fly' ? st.speed : 1; for (let i = 0; i < n; i++) step(dt);
    st.cpu += ((performance.now() - t0) / 16.7 * 100 * .6 + 28 - st.cpu) * .05;
    draw(dt);
    // adaptive resolution: if frames are slow for 2 s, render fewer pixels
    perf.acc += dt; perf.n++; if (perf.acc > 2) { const fps = perf.n / perf.acc; perf.acc = 0; perf.n = 0;
      const pr = renderer.getPixelRatio(); if (fps < 34 && pr > .76) { renderer.setPixelRatio(Math.max(.75, pr - .25)); resize(); } else if (fps > 56 && pr < Math.min(devicePixelRatio || 1, Q.dpr) - .01) { renderer.setPixelRatio(Math.min(Math.min(devicePixelRatio || 1, Q.dpr), pr + .25)); resize(); } }
  }
  function draw(dt) {
    if (dirty) { aReveal.needsUpdate = true; dirty = false; } if (dirtyOff) { aOff.needsUpdate = true; dirtyOff = false; }
    beamGeo.setDrawRange(0, beamN * 2); beamGeo.attributes.position.needsUpdate = true; beam.visible = beamN > 0 && st.phase === 'fly';
    U.uDrone.value.set(st.x, st.y, st.z);
    // camera pose
    eye.set(st.x, st.y, st.z); look.set(-Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), -Math.cos(st.yaw) * Math.cos(st.pitch));
    if (st.phase === 'pull' || st.phase === 'end') {
      st.pull = Math.min(1, st.pull + dt / 4.5); const e = st.pull < .5 ? 4 * st.pull ** 3 : 1 - Math.pow(-2 * st.pull + 2, 3) / 2;
      // oblique bird's-eye over the whole floor; drag to orbit. On laptops the projection is shifted so the building sits right of the report.
      if (st.phase === 'end' && !st.dragOrbit) st.orbit += dt * .03;
      const R = PH ? 46 : 42, ang = st.orbit, ctr = new THREE.Vector3(20, 0, -16.5);
      const top = new THREE.Vector3(ctr.x + Math.sin(ang) * R * .5, PH ? 40 : 39, ctr.z + Math.cos(ang) * R * .5), tgt = ctr;
      const repW = Math.min(520, w - 48), shift = PH || (st.phase === 'end' && (ui.score.hidden || ui.score.classList.contains('min'))) || w < 700 ? 0 : (24 + repW) / 2 * e;
      if (shift > 1) camera.setViewOffset(w, h, -shift, 0, w, h); else camera.clearViewOffset();
      camera.position.copy(eye).lerp(top, e); const lk = eye.clone().add(look); camera.up.set(0, 1, 0); camera.lookAt(lk.lerp(tgt, e));
      U.uHideCeil.value = e > .2 ? 1 : 0; U.uFar.value = 16 + 60 * e; droneMat.opacity = Math.min(1, e * 2); drone.position.set(st.x, st.y + .05, st.z); drone.rotation.y = st.yaw;
      if (st.pull >= 1 && st.phase === 'pull') { st.phase = 'end'; showScore(); onEvent('end'); }
    } else { if (camera.view && camera.view.enabled) camera.clearViewOffset(); const sh = st.shake > 0 ? (st.shake -= dt, .03 * Math.sin(st.t * 90)) : 0; camera.position.copy(eye); camera.position.y += sh; camera.lookAt(eye.clone().add(look)); }
    // paint uniforms from perception
    W.TG.forEach((t, i) => { const E = percept.P.ev[i]; const painted = sensors.lidar || st.phase !== 'fly' ? (E.C >= 1 && E.L > 5 ? 1 : E.st === 'unverified' && E.L > 5 ? .7 : 0) : 0;
      U.uPaint.value[i] += (painted - U.uPaint.value[i]) * Math.min(1, dt * 3);
      const col = E.st === 'rejected' ? [.45, .5, .56] : E.st === 'false' ? [1, .3, .3] : t.kind === 'hazard' || t.kind === 'fire' ? [1, .85, .2] : E.st === 'confirmed' ? [1, .62, .25] : [1, .55, .7];
      U.uPCol.value[i].setRGB(...col); U.uTh.value[i] += ((sensors.thermal && E.thSees && st.phase === 'fly' ? 1 : 0) - U.uTh.value[i]) * Math.min(1, dt * 2.5); });
    const camOn = sensors.camera && (st.phase === 'fly' || st.phase === 'intro');
    const fogD = smokeAt(st.x, st.z) && st.phase === 'fly' ? .45 : st.phase === 'pull' || st.phase === 'end' ? 0 : .05; scene.fog.density += (fogD - scene.fog.density) * Math.min(1, dt * 2);
    for (const m of rgbList) { m.mesh.material = m.rgb; m.mesh.visible = camOn; }
    for (const o of rgbOnly) o.visible = camOn; water.visible = camOn;
    U.uAlpha.value = camOn ? .9 : 1; U.uBoost.value = camOn ? 1 : 1.45; points.visible = true; fireCore.visible = false;
    lamp.position.copy(camera.position).addScaledVector(look, -.6); lamp.target.position.copy(camera.position).add(look);
    { _v.copy(camera.position).addScaledVector(look, .25); const h2 = W.bvh.closestPointToPoint(_v, cp, 0, 2.5); const dn = h2 && h2.distance < 2.5 ? h2.distance : 2.5; st.ae += ((st.phase === 'fly' ? Math.max(.32, Math.min(1, (dn + .15) / 1.6)) : 1) - st.ae) * Math.min(1, dt * 4); renderer.toneMappingExposure = st.ae; }
    renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h); renderer.render(scene, camera);
    // thermal picture-in-picture
    ui.pip.hidden = !(sensors.thermal && st.phase === 'fly');
    if (!ui.pip.hidden) {
      for (const m of rgbList) { m.mesh.material = m.th; m.mesh.visible = true; }
      points.visible = beam.visible = false; for (const o of rgbOnly) o.visible = false; fireCore.visible = true;
      const fog = scene.fog; scene.fog = null; thCam.position.copy(camera.position); thCam.quaternion.copy(camera.quaternion); thCam.aspect = pip.w / pip.h; thCam.updateProjectionMatrix();
      const y = h - pip.y - pip.h; renderer.setScissorTest(true); renderer.setScissor(pip.x, y, pip.w, pip.h); renderer.setViewport(pip.x, y, pip.w, pip.h); renderer.render(scene, thCam); renderer.setScissorTest(false); scene.fog = fog;
      for (const m of rgbList) { m.mesh.material = m.rgb; m.mesh.visible = camOn; }
    }
    // HUD
    if (st.phase !== 'intro') {
      if ((uiT += dt) > .1) { uiT = 0; paintRing(); paintWhy(); paintClasses(); }
      if ((osdT += dt) > .2) { osdT = 0; paintOSD(); }
      if ((mapT += dt) > .12) { mapT = 0; drawMap(); drawDoA(); }
      drawSpectro(); paintLabels(); paintArc();
      acoustic.audible({ x: st.x, z: st.z, yaw: st.yaw, rotor: !st.landed && st.phase === 'fly' });
    }
  }

  // ---------- HUD painters ----------
  const fmt = s => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const f1 = v => v.toFixed(1), f2 = v => v.toFixed(2);
  function paintOSD() {
    const S = nav.S, B = brain.B, A = acoustic.A, R = ui.osdRows;
    ui.clock.textContent = 'MISSION ' + fmt(st.mt);
    const tilt = [Math.atan2(-(st.ax * -Math.sin(st.yaw) + st.az * -Math.cos(st.yaw)), 9.81) * 57.3, Math.atan2(st.ax * Math.cos(st.yaw) - st.az * Math.sin(st.yaw), 9.81) * 57.3];
    const mode = st.landed ? 'DISARMED' : st.mode === 'MANUAL' ? 'LOITER' : B.state === 'RTL' ? 'RTL' : B.state === 'LAND' ? 'LAND' : 'GUIDED';
    R.FC.t.innerHTML = `V6X · ArduPilot <i class="${mode === 'GUIDED' ? 'ok' : 'w'}">${mode}</i> · 400 Hz · pitch ${tilt[0].toFixed(0)}° roll ${tilt[1].toFixed(0)}°`; spark(R.FC, Math.hypot(st.vx, st.vz), 2, '#9fdcff');
    const sg = Math.max(S.sig[0], S.sig[1]);
    const g2 = v => v.toFixed(2).replace(/^0/, ''); R.EKF3.t.innerHTML = `lanes <i class="ok">●●●</i> · σ <i class="${sg > .5 ? 'bad' : sg > .15 ? 'w' : ''}">${f2(S.sig[0])}/${f2(S.sig[1])} m</i> · innov v ${g2(S.innov.vel)} p ${g2(S.innov.pos)} h ${g2(S.innov.hgt)}`; spark(R.EKF3, sg, .5, sg > .15 ? '#ffb35c' : '#9fdcff');
    R.SLAM.t.innerHTML = `LIO <i class="${S.lio === 'TRACKING' ? 'ok' : S.lio === 'LOST' ? 'bad' : 'w'}">${S.lio}</i> · fit ${f2(S.lioFit)} · ${S.lioHz} Hz · kf ${S.keyframes.length} · loops ${S.lcCount}`; spark(R.SLAM, S.lioFit, 1, '#60c8ff');
    R.FLOW.t.innerHTML = sensors.flow ? `quality <i class="${S.flowQ < 90 ? 'bad' : ''}">${S.flowQ.toFixed(0)}</i>/255 · 80 Hz · ToF ${f2(st.y)} m${floodAt(st.x, st.z) ? ' · <i class="w">specular water</i>' : smokeAt(st.x, st.z) ? ' · <i class="w">smoke</i>' : ''}` : '<i class="bad">OFF</i> · EKF3 has no velocity aiding'; spark(R.FLOW, S.flowQ, 255, '#5ef2b5');
    const cov = (B.stats.free / roomCells * 100);
    R.MAP.t.innerHTML = `occ ${B.stats.occ.toLocaleString()} · free ${B.stats.free.toLocaleString()} cells · ${B.clusters.length} frontiers · <i>${Math.min(100, cov).toFixed(0)} %</i>`; spark(R.MAP, B.stats.frontiers, 0, '#ff4fd8');
    R.NPU.t.innerHTML = sensors.camera ? `Hailo-8 · YOLOv8n ${percept.P.yoloFps.toFixed(0)} fps · ${percept.P.yoloMs.toFixed(0)} ms · ${percept.P.dets} det` : '<i class="bad">camera off</i> · no detections'; spark(R.NPU, percept.P.dets, 3, '#f4f4f2');
    const hi = CLASSES.map((c, i) => [c, A.p[i], A.snr[i]]).filter(x => x[0].human).sort((a, b) => b[1] - a[1])[0];
    R.MIC.t.innerHTML = sensors.acoustic ? `noise ${A.noise.toFixed(0)} dB · ${hi[1] > .2 ? `<i>${hi[0].k} p ${f2(hi[1])}</i> SNR ${f1(hi[2])} dB` : 'no human class > 3 dB'} · ${A.tracks.filter(t => t.n).length} tracks` : '<i class="bad">OFF</i> · no acoustic prior'; spark(R.MIC, hi[1], 1, '#b49cff');
    R['PI 5'].t.innerHTML = `CPU ${Math.min(99, st.cpu).toFixed(0)} % · ${(52 + st.cpu * .18).toFixed(0)} °C · ROS 2 · Nav2 · MAVROS2`; spark(R['PI 5'], st.cpu, 100, '#c8d6e4');
    const pct = Math.max(0, 1 - st.wh / BAT_WH) * 100, need = B.energy ? B.energy.need : 0;
    R.PWR.t.innerHTML = `<i class="${pct < 30 ? 'bad' : ''}">${pct.toFixed(0)} %</i> · ${(16.6 - (1 - pct / 100) * 2.2).toFixed(1)} V · ${(205 + 35 * Math.hypot(st.vx, st.vz)).toFixed(0)} W · ${f1(st.wh)} Wh used · home needs ${f1(need)} Wh`; spark(R.PWR, 205 + 35 * Math.hypot(st.vx, st.vz), 300, '#ffd36b');
  }
  function paintWhy() {
    const B = brain.B; ui.st.textContent = (st.mode === 'MANUAL' ? 'PILOT · LOITER' : B.state) + (st.speed > 1 && st.mode === 'AUTO' ? ` · ×${st.speed}` : '') + ' · ' + fmt(st.mt);
    ui.why.innerHTML = (B.why || []).slice(0, 3).map(([k, v]) => `<div><b>${k}</b><span>${esc(v)}</span></div>`).join('');
    if (B.log.length !== lastLogN || B.log.length && B.log[B.log.length - 1] !== ui.log._last) { lastLogN = B.log.length; ui.log._last = B.log[B.log.length - 1];
      ui.log.innerHTML = B.log.slice(-34).map(l => `<p class="${l.cls}"><t>${fmt(l.t)}</t>${l.tag ? `<g>${l.tag}</g>` : '<g></g>'}${esc(l.text)}</p>`).join(''); }
    if (hist.open) hist.paint();
  }
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function paintClasses() { const A = acoustic.A; ui.cls.querySelectorAll('[data-c]').forEach(d => { const i = +d.dataset.c; d.querySelector('u').style.width = (A.p[i] * 100).toFixed(0) + '%'; d.querySelector('em').textContent = A.lvl[i] > 0 ? A.lvl[i].toFixed(0) + ' dB' : '—'; });
    const tr = A.tracks.filter(t => t.n > 0);
    ui.audNote.innerHTML = !sensors.acoustic ? 'Acoustic off: no classes, no bearings, no prior.' : tr.length ? tr.map(t => `<b style="color:${CLASSES.find(c => c.k === t.cls).c}">${t.cls}</b> ${t.open ? '' : '✓ '}${t.est ? `${EN(t.est.x, t.est.z)} ±${f1(t.est.s)} m` : `${t.n} bearing${t.n > 1 ? 's' : ''} · need baseline`}`).join(' · ') : 'Listening. Human classes need SNR > 3 dB after the rotor noise is removed.'; }
  function paintRing() {
    const P = percept.P; let i = P.focus >= 0 && st.t - P.focusT < 5 ? P.focus : -1;
    if (i < 0) { const tr = acoustic.A.tracks.filter(t => t.open && t.n).sort((a, b) => b.conf - a.conf)[0]; if (tr) i = W.TG.findIndex(t => t.id === tr.src); }
    const t = i >= 0 ? W.TG[i] : null, E = t ? P.ev[i] : null;
    const vals = { acoustic: E ? E.A : 0, thermal: E ? E.T : 0, camera: E ? E.C : 0, lidar: E ? Math.min(1, E.L / 60) : 0 };
    ui.ring.querySelectorAll('[data-seg]').forEach(p => { const k = p.dataset.seg; p.style.strokeDashoffset = String(100 - vals[k] * 100); p.parentNode.classList.toggle('off', !sensors[k]); });
    let L = st.mode === 'MANUAL' ? 'PILOT' : brain.B.state === 'SCAN' ? 'SCANNING' : brain.B.state === 'INVESTIGATE' ? 'INSPECTING' : brain.B.state === 'RTL' ? 'RETURNING' : 'EXPLORING', S = 'frontier exploration', cls = '';
    if (brain.B.state === 'HOLD') { L = 'HOLD'; S = 'SLAM lost'; cls = 'bad'; }
    if (t && E) { if (t.kind === 'person') {
        if (E.st === 'confirmed') { L = 'CONFIRMED'; S = 'camera + thermal agree · LiDAR pins it'; cls = 'hot'; }
        else if (E.st === 'unverified') { L = 'UNVERIFIED'; S = 'only one sensor checked'; cls = 'warn'; }
        else if ((E.C >= 1) + (E.T >= 1) + (E.A > .4) >= 2) { L = 'LIKELY'; S = 'two sensors agree'; cls = 'warn'; }
        else if (E.C > 0 || E.T > 0) { L = 'POSSIBLE'; S = 'one sensor so far'; cls = 'violet'; }
        else if (E.A > 0) { L = 'HEARD'; S = 'acoustic only · searching'; cls = 'violet'; } }
      else if (t.kind === 'mannequin') { if (E.st === 'rejected') { L = 'REJECTED'; S = 'person-shaped, 21 °C'; cls = 'dim'; } else if (E.st === 'false') { L = 'FALSE ALARM'; S = 'no heat check'; cls = 'bad'; } else if (E.C > 0) { L = 'CHECKING'; S = 'camera: person?'; cls = 'violet'; } }
      else if (t.kind === 'machine') { if (E.st === 'rejected') { L = 'REJECTED'; S = 'warm machine, not a person'; cls = 'dim'; } else if (E.st === 'false') { L = 'FALSE ALARM'; S = 'heat only, no shape check'; cls = 'bad'; } else if (E.T > 0) { L = 'CHECKING'; S = 'warm blob 38 °C'; cls = 'violet'; } }
      else if (t.kind === 'fire') { L = 'HAZARD'; S = 'fire: hot, not a person'; cls = 'dim'; } }
    ui.ringL.textContent = L; ui.ringS.textContent = S; ui.ring.className = 'a2ring ' + cls;
  }
  const labelEls = {};
  function paintLabels() {
    const items = [], P = percept.P, endView = st.phase === 'pull' || st.phase === 'end';
    W.TG.forEach((t, i) => { const E = P.ev[i]; let text = null, cls = '';
      if (t.kind === 'person') { if (E.st === 'confirmed') { text = `SURVIVOR ${t.id.slice(1)} · ${t.temp.toFixed(1)} °C`; cls = 'ok'; } else if (E.st === 'unverified') { text = `PERSON? · unverified`; cls = 'hot'; }
        else if (!endView && (E.C > 0 || E.T > 0)) { text = E.C >= 1 ? `person ${(.84).toFixed(2)}` : E.T >= 1 ? `warm · ${t.temp.toFixed(0)} °C` : 'checking…'; cls = E.T > 0 ? 'hot' : ''; } }
      else if (t.kind === 'mannequin') { if (E.st === 'rejected') { text = 'mannequin · 21 °C'; cls = 'dim'; } else if (E.st === 'false') { text = 'PERSON? · reported'; cls = 'bad'; } else if (!endView && E.C > 0) text = E.C >= 1 ? 'person 0.71' : 'checking…'; }
      else if (t.kind === 'machine') { if (E.st === 'rejected') { text = 'generator · 38 °C'; cls = 'dim'; } else if (E.st === 'false') { text = 'PERSON? · heat only'; cls = 'bad'; } else if (!endView && E.T > 0) { text = 'warm · 38 °C'; cls = 'hot'; } }
      else if (t.kind === 'hazard' && E.st === 'hazard' && !(PH && endView)) { text = t.name; cls = 'haz'; }
      if (text && (endView || st.t - E.lastSeen < 1.2)) items.push(['t' + i, t.pos, text, cls]); });
    if (!endView) for (const tr of acoustic.A.tracks) if (tr.open && tr.est && tr.est.s < 3) items.push(['a' + tr.cls, new THREE.Vector3(tr.est.x - nav.S.e[0], .8, tr.est.z - nav.S.e[1]), `${tr.cls} · acoustic ±${f1(tr.est.s)} m`, 'ac']);
    const seen = new Set();
    for (const [k, p, text, cls] of items) {
      proj.copy(p).project(camera); const on = proj.z < 1 && Math.abs(proj.x) < 1.05 && Math.abs(proj.y) < 1.05;
      let e = labelEls[k]; if (!e) { e = labelEls[k] = document.createElement('div'); e.className = 'a2lab'; e.innerHTML = '<i></i><span></span>'; ui.labels.appendChild(e); }
      seen.add(k); e.style.display = on ? '' : 'none'; if (!on) continue;
      e.style.transform = `translate(${Math.min(w - 180, Math.max(30, (proj.x * .5 + .5) * w))}px,${Math.min(h - 30, Math.max(40, (-proj.y * .5 + .5) * h))}px)`; e.className = 'a2lab ' + cls;
      const s = e.lastChild; if (s.textContent !== text) s.textContent = text; }
    for (const k in labelEls) if (!seen.has(k)) labelEls[k].style.display = 'none';
  }
  function paintArc() { const a = st.arc && st.t - st.arc.t < 2.2 / Math.max(1, st.speed * .6) && st.phase === 'fly' ? st.arc : null; ui.arc.style.opacity = a ? String(1 - (st.t - a.t) / 2.5) : '0';
    if (a) { const fwd = Math.atan2(-Math.sin(st.yaw), -Math.cos(st.yaw)); const rel = Math.atan2(Math.sin(a.b - fwd), Math.cos(a.b - fwd)); ui.arc.style.transform = `translate(-50%,-50%) rotate(${-rel}rad)`;
      ui.arcT.textContent = `${a.cls} ${cmp(a.b).toFixed(0).padStart(3, '0')}° ±${(a.s * 57.3).toFixed(0)}°`; ui.arcT.style.transform = `translateX(-50%) rotate(${rel}rad)`; const c = CLASSES.find(k => k.k === a.cls).c; ui.arc.querySelector('path').style.stroke = c; } }

  // spectrograms
  const lut = (stops) => { const L = []; for (let i = 0; i < 256; i++) { const x = i / 255 * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(x)), f = x - k; L.push(stops[k].map((v, j) => Math.round(v + (stops[k + 1][j] - v) * f))); } return L; };
  const LUT_R = lut([[4, 6, 16], [40, 14, 70], [120, 28, 110], [210, 70, 60], [252, 170, 40], [252, 252, 200]]), LUT_C = lut([[4, 6, 16], [26, 18, 70], [90, 50, 170], [180, 140, 255], [240, 230, 255]]);
  const spx = [ui.raw.getContext('2d'), ui.clean.getContext('2d')]; spx.forEach(x => { x.fillStyle = '#04060f'; x.fillRect(0, 0, 320, 64); });
  function drawSpectro() { const A = acoustic.A; if (!A.colRaw || st.phase !== 'fly') return;
    [[spx[0], A.colRaw, LUT_R], [spx[1], A.colClean, LUT_C]].forEach(([x, col, L]) => { x.drawImage(x.canvas, -1, 0); const img = x.createImageData(1, 64);
      for (let b = 0; b < 64; b++) { const v = sensors.acoustic ? col[b] : 0, db = 20 * Math.log10(v + 1e-3), n = Math.max(0, Math.min(255, ((db + 26) / 48) * 255)) | 0, c = L[n], o = (63 - b) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; }
      x.putImageData(img, 319, 0); }); }
  function drawDoA() {
    const c = ui.doa, x = c.getContext('2d'), Wd = c.width, Hd = c.height, cx = Wd / 2, cy = Hd / 2, r = Math.min(Wd, Hd) / 2 - 8 * (Wd / 104); x.clearRect(0, 0, Wd, Hd);
    x.strokeStyle = 'rgba(140,170,200,.25)'; x.lineWidth = 1; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke(); x.beginPath(); x.arc(cx, cy, r * .55, 0, 7); x.stroke();
    const sc = Wd / 104; x.font = `${9 * sc}px ui-monospace,monospace`; x.fillStyle = '#6f8aa6'; x.textAlign = 'center'; x.fillText('N', cx, cy - r - 1 * sc);
    const toS = b => { const a = (cmp(b) - 90) * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; };
    // heading
    const hb = Math.atan2(-Math.sin(st.yaw), -Math.cos(st.yaw)), [hx, hy] = toS(hb); x.strokeStyle = '#e9eef4'; x.lineWidth = 1.5 * sc; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + hx * r * .45, cy + hy * r * .45); x.stroke();
    for (const d of acoustic.A.doaHist) { const age = st.t - d.t; if (age > 12) continue; const col = CLASSES.find(k => k.k === d.cls).c; const a = (cmp(d.b) - 90) * Math.PI / 180;
      x.globalAlpha = Math.max(.1, 1 - age / 12); x.fillStyle = col; x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, r, a - d.s, a + d.s); x.closePath(); x.globalAlpha *= .45; x.fill(); x.globalAlpha = Math.max(.15, 1 - age / 12); x.strokeStyle = col; x.lineWidth = 1.5 * sc; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); x.stroke(); }
    x.globalAlpha = 1; const ld = acoustic.A.lastDoA; x.fillStyle = '#d9ccff'; x.fillText(ld && st.t - ld.t < 10 ? `${cmp(ld.b).toFixed(0).padStart(3, '0')}°` : 'DoA', cx, cy + r + 0 * sc + 8 * sc > Hd ? Hd - 2 : cy + 3 * sc);
  }

  // the map
  const mapOff = document.createElement('canvas'); mapOff.width = brain.grid.NX; mapOff.height = brain.grid.NZ; const mctx = mapOff.getContext('2d'); const mimg = mctx.createImageData(brain.grid.NX, brain.grid.NZ);
  const view = { x0: -2, x1: 22, z0: -16, z1: 2 };
  function drawMap() {
    const G = brain.grid, B = brain.B, c = ui.map, x = c.getContext('2d'), Wm = c.width, Hm = c.height, sc = Wm / 352;
    // cells → pixels
    const d = mimg.data; let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
    for (let j = 0; j < G.NZ; j++) for (let i = 0; i < G.NX; i++) { const cI = j * G.NX + i, o = cI * 4; let r, g, b;
      if (!G.seen[cI]) { const k = (i + j) & 1; r = 7 + k * 2; g = 20 + k * 2; b = 40 + k * 3; }
      else { const Lv = G.L[cI]; if (bx0 > i) bx0 = i; if (bx1 < i) bx1 = i; if (bz0 > j) bz0 = j; if (bz1 < j) bz1 = j;
        if (Lv > 0) { const t = Lv / 3.48; r = 150 + 105 * t; g = 105 + 131 * t; b = 60 + 130 * t; } else { const t = -Lv / 1.99; r = 18 + 25 * t; g = 50 + 77 * t; b = 88 + 92 * t; }
        if (G.fr[cI]) { r = 255; g = 79; b = 216; }
        const age = st.t - G.touched[cI]; if (age < .5 && age >= 0) { const k = (1 - age / .5) * 60; r += k; g += k; b += k; } }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255; }
    mctx.putImageData(mimg, 0, 0);
    // view box: explored extent + margin, aspect of the canvas
    let vx0 = -2, vx1 = 22, vz0 = -16, vz1 = 2;
    if (bx1 > bx0) { vx0 = G.X0 + bx0 * G.RES - 2; vx1 = G.X0 + (bx1 + 1) * G.RES + 2; vz0 = G.Z0 + bz0 * G.RES - 2; vz1 = G.Z0 + (bz1 + 1) * G.RES + 2; }
    if (st.phase !== 'fly' || PH) { /* whole extent */ }
    const asp = Wm / Hm; let ww = Math.max(18, vx1 - vx0), hh = Math.max(14, vz1 - vz0); if (ww / hh > asp) hh = ww / asp; else ww = hh * asp;
    const cxm = (vx0 + vx1) / 2, czm = (vz0 + vz1) / 2; const tgt = { x0: cxm - ww / 2, x1: cxm + ww / 2, z0: czm - hh / 2, z1: czm + hh / 2 };
    for (const k of ['x0', 'x1', 'z0', 'z1']) view[k] += (tgt[k] - view[k]) * .15;
    const S = Wm / (view.x1 - view.x0), X = wx => (wx - view.x0) * S, Z = wz => (wz - view.z0) * S;
    x.imageSmoothingEnabled = false; x.fillStyle = '#04112a'; x.fillRect(0, 0, Wm, Hm);
    x.drawImage(mapOff, (view.x0 - G.X0) / G.RES, (view.z0 - G.Z0) / G.RES, (view.x1 - view.x0) / G.RES, (view.z1 - view.z0) / G.RES, 0, 0, Wm, Hm);
    x.lineCap = 'round'; x.lineJoin = 'round';
    // trail
    x.strokeStyle = 'rgba(96,200,255,.45)'; x.lineWidth = 1.2 * sc; x.beginPath(); st.trail.forEach(([a, b], i) => i ? x.lineTo(X(a), Z(b)) : x.moveTo(X(a), Z(b))); x.stroke();
    // frontier clusters
    x.font = `${9.5 * sc}px ui-monospace,monospace`; x.textAlign = 'left';
    const ranked = B.clusters.filter(f => isFinite(f.J)).sort((a, b) => a.J - b.J);
    for (const f of B.clusters) { if (!f.reach) { x.fillStyle = 'rgba(255,79,216,.4)'; x.fillText('×', X(f.cx) - 3 * sc, Z(f.cz) + 3 * sc); } }
    ranked.slice(0, 5).forEach((f, k) => { const chosen = B.goal && B.goal.kind === 'frontier' && B.goal.f === f.id && B.state === 'TRANSIT' || f.chosen && st.mode === 'MANUAL';
      x.fillStyle = chosen ? '#fff' : 'rgba(255,170,240,.9)'; x.beginPath(); x.arc(X(f.gx), Z(f.gz), (chosen ? 4 : 2.6) * sc, 0, 7); x.fill();
      x.fillStyle = 'rgba(4,17,42,.75)'; const txt = `F${f.id} ${f.J.toFixed(1)}`; const tw = x.measureText(txt).width; x.fillRect(X(f.gx) + 5 * sc, Z(f.gz) - 8 * sc, tw + 4 * sc, 11 * sc);
      x.fillStyle = chosen ? '#fff' : '#ffb8f0'; x.fillText(txt, X(f.gx) + 7 * sc, Z(f.gz) + 1 * sc); });
    // acoustic: bearings and estimates
    if (sensors.acoustic) for (const tr of acoustic.A.tracks) { if (!tr.n) continue; const col = CLASSES.find(k => k.k === tr.cls).c;
      for (const m of tr.bearings.slice(-3)) { const L = 16, age = st.t - m.t; if (age > 40 && tr.est) continue; x.globalAlpha = tr.open ? Math.max(.25, 1 - age / 40) : .15;
        const occ = brain.B.rayFirstOcc(m.x, m.z, m.b, L), dOcc = occ ? occ.d : L;
        x.fillStyle = col; x.globalAlpha *= .18; x.beginPath(); x.moveTo(X(m.x), Z(m.z)); x.lineTo(X(m.x + Math.sin(m.b - m.s) * L), Z(m.z + Math.cos(m.b - m.s) * L)); x.lineTo(X(m.x + Math.sin(m.b + m.s) * L), Z(m.z + Math.cos(m.b + m.s) * L)); x.closePath(); x.fill();
        x.globalAlpha = tr.open ? Math.max(.35, 1 - age / 40) : .2; x.strokeStyle = col; x.lineWidth = 1.4 * sc; x.setLineDash([]); x.beginPath(); x.moveTo(X(m.x), Z(m.z)); x.lineTo(X(m.x + Math.sin(m.b) * dOcc), Z(m.z + Math.cos(m.b) * dOcc)); x.stroke();
        x.setLineDash([3 * sc, 3 * sc]); x.beginPath(); x.moveTo(X(m.x + Math.sin(m.b) * dOcc), Z(m.z + Math.cos(m.b) * dOcc)); x.lineTo(X(m.x + Math.sin(m.b) * L), Z(m.z + Math.cos(m.b) * L)); x.stroke(); x.setLineDash([]);
        if (occ) { x.fillStyle = col; x.fillRect(X(occ.x) - 2 * sc, Z(occ.z) - 2 * sc, 4 * sc, 4 * sc); } }
      x.globalAlpha = 1;
      if (tr.est && tr.open) { const PG = tr.PG, P = tr.P; let pm = 0; for (let k = 0; k < P.length; k++) if (P[k] > pm) pm = P[k];
        x.fillStyle = col; for (let k = 0; k < P.length; k++) { const v = P[k] / pm; if (v < .06) continue; x.globalAlpha = Math.min(.55, v * .55); const cx = PG.x0 + (k % PG.nx), cz = PG.z0 + ((k / PG.nx) | 0); x.fillRect(X(cx), Z(cz), S + .5, S + .5); }
        x.globalAlpha = 1; const e = tr.est; x.save(); x.translate(X(e.x), Z(e.z)); x.rotate(e.ang); x.strokeStyle = col; x.lineWidth = 1.5 * sc; x.beginPath(); x.ellipse(0, 0, Math.max(3, 2 * e.s * S), Math.max(3, 2 * e.s2 * S), 0, 0, 7); x.stroke(); x.restore();
        x.fillStyle = col; x.fillText(tr.cls, X(e.x) + 6 * sc, Z(e.z) - 6 * sc); }
      x.globalAlpha = 1; }
    // path + setpoint
    if (B.path && B.path.length > 1 && (B.state === 'TRANSIT' || B.state === 'INVESTIGATE' || B.state === 'RTL')) { x.strokeStyle = '#fff'; x.lineWidth = 1.6 * sc; x.setLineDash([5 * sc, 3 * sc]); x.beginPath();
      x.moveTo(X(st.x + nav.S.e[0]), Z(st.z + nav.S.e[1])); for (const p of B.path.slice(1)) x.lineTo(X(p[0]), Z(p[1])); x.stroke(); x.setLineDash([]);
      if (B.setpoint) { x.strokeStyle = '#ffd36b'; x.lineWidth = 1.5 * sc; const sx = X(B.setpoint.x), sz = Z(B.setpoint.z); x.beginPath(); x.moveTo(sx - 4 * sc, sz); x.lineTo(sx + 4 * sc, sz); x.moveTo(sx, sz - 4 * sc); x.lineTo(sx, sz + 4 * sc); x.stroke(); } }
    if (st.mode === 'MANUAL' && B.advisory) { const a = B.advisory; x.strokeStyle = '#ff4fd8'; x.lineWidth = 1.5 * sc; x.setLineDash([4 * sc, 4 * sc]); x.beginPath(); x.moveTo(X(st.x + nav.S.e[0]), Z(st.z + nav.S.e[1])); x.lineTo(X(a.gx), Z(a.gz)); x.stroke(); x.setLineDash([]); }
    // reports & hazards
    W.TG.forEach((t, i) => { const E = percept.P.ev[i]; if (E.st === 'none') return; const p = E.pos || { x: t.pos.x + nav.S.e[0], z: t.pos.z + nav.S.e[1] }; const px = X(p.x), pz = Z(p.z);
      if (t.kind === 'person') { x.fillStyle = E.st === 'confirmed' ? '#ffd23f' : '#ff9a3d'; x.beginPath(); x.arc(px, pz, 5.5 * sc, 0, 7); x.fill(); x.fillStyle = '#030d22'; x.textAlign = 'center'; x.font = `bold ${8 * sc}px ui-monospace,monospace`; x.fillText(t.id.slice(1), px, pz + 3 * sc); x.textAlign = 'left'; x.font = `${9.5 * sc}px ui-monospace,monospace`; }
      else if (t.kind === 'hazard' || t.kind === 'fire') { if (t.kind === 'fire' && E.st !== 'hazard') return; x.fillStyle = '#ffd23f'; x.beginPath(); x.moveTo(px, pz - 5 * sc); x.lineTo(px + 4.5 * sc, pz + 3.5 * sc); x.lineTo(px - 4.5 * sc, pz + 3.5 * sc); x.closePath(); x.fill(); }
      else { x.strokeStyle = E.st === 'false' ? '#ff6b6b' : '#8A8A86'; x.lineWidth = 1.6 * sc; x.beginPath(); x.moveTo(px - 4 * sc, pz - 4 * sc); x.lineTo(px + 4 * sc, pz + 4 * sc); x.moveTo(px + 4 * sc, pz - 4 * sc); x.lineTo(px - 4 * sc, pz + 4 * sc); x.stroke(); } });
    // home
    x.strokeStyle = '#9fdcff'; x.lineWidth = 1.2 * sc; x.strokeRect(X(HOME.x) - 4 * sc, Z(HOME.z) - 4 * sc, 8 * sc, 8 * sc); x.fillStyle = '#9fdcff'; x.fillText('H', X(HOME.x) + 6 * sc, Z(HOME.z) + 3 * sc);
    // drone: estimate + 2σ ellipse (+ truth when they differ)
    const ex = st.x + nav.S.e[0], ez = st.z + nav.S.e[1], err = Math.hypot(nav.S.e[0], nav.S.e[1]);
    if (err > .15) { x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = 1 * sc; x.beginPath(); x.arc(X(st.x), Z(st.z), 3 * sc, 0, 7); x.stroke(); x.beginPath(); x.moveTo(X(st.x), Z(st.z)); x.lineTo(X(ex), Z(ez)); x.stroke(); x.fillStyle = 'rgba(255,255,255,.6)'; x.fillText('truth', X(st.x) + 5 * sc, Z(st.z) + 10 * sc); }
    x.strokeStyle = 'rgba(255,211,107,.85)'; x.lineWidth = 1.2 * sc; x.beginPath(); x.ellipse(X(ex), Z(ez), Math.max(2 * sc, 2 * nav.S.sig[0] * S), Math.max(2 * sc, 2 * nav.S.sig[1] * S), 0, 0, 7); x.stroke();
    x.save(); x.translate(X(ex), Z(ez)); x.rotate(-st.yaw); x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(0, -7 * sc); x.lineTo(4.5 * sc, 5 * sc); x.lineTo(0, 2.5 * sc); x.lineTo(-4.5 * sc, 5 * sc); x.closePath(); x.fill(); x.restore();
    // scale bar
    x.fillStyle = '#6f8aa6'; x.fillRect(8 * sc, Hm - 10 * sc, 5 * S, 2 * sc); x.fillText('5 m', 8 * sc + 5 * S + 4 * sc, Hm - 6 * sc);
    // hover readout
    if (hover) { const wx = view.x0 + hover.x * (view.x1 - view.x0), wz = view.z0 + hover.y * (view.z1 - view.z0), i = Math.floor((wx - G.X0) / G.RES), j = Math.floor((wz - G.Z0) / G.RES);
      if (i >= 0 && j >= 0 && i < G.NX && j < G.NZ) { const cI = j * G.NX + i, Lv = G.L[cI], p = 1 / (1 + Math.exp(-Lv));
        x.strokeStyle = '#fff'; x.lineWidth = 1; x.strokeRect(X(G.X0 + i * G.RES), Z(G.Z0 + j * G.RES), G.RES * S, G.RES * S);
        ui.mapRd.textContent = !G.seen[cI] ? `cell ${EN(wx, wz)} · UNKNOWN · never observed` : `cell ${EN(wx, wz)} · ℓ = ${Lv >= 0 ? '+' : ''}${f2(Lv)} · p = ${f2(p)} · ${G.nHit[cI]} hits / ${G.nMiss[cI]} misses · ${Lv > 0 ? 'OCCUPIED' : G.fr[cI] ? 'FREE · FRONTIER' : 'FREE'}`; } }
    else ui.mapRd.textContent = `${B.stats.sweeps} sweeps · ${B.stats.rays.toLocaleString()} rays inserted · hover a cell for its ℓ`;
  }

  // ---------- toast, score ----------
  let toastT = 0;
  function toast(text, color) { ui.toast.textContent = text; ui.toast.style.borderColor = color || '#60c8ff'; ui.toast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => ui.toast.classList.remove('on'), 3800); }
  function showScore() {
    const P = percept.P, persons = W.TG.filter(t => t.kind === 'person');
    const st2 = persons.map(t => { const r = P.reports.find(r => r.tg === t); return { t, r }; });
    const nConf = st2.filter(x => x.r && x.r.how === 'confirmed').length, nUn = st2.filter(x => x.r && x.r.how === 'unverified').length;
    const off = SENSORS.filter(s => !sensors[s.k]).map(s => s.name);
    const cov = Math.min(100, brain.B.stats.free / roomCells * 100);
    const title = st.failsafe ? 'Landed in place: EKF failsafe.' : `${nConf + nUn} of 4 survivors found${nUn ? ` · ${nUn} unverified` : ''}.`;
    let tip = off.length ? `Sensors off: ${off.join(', ')}. ` : 'All sensors on. ';
    tip += off.length ? 'Run it again with everything on and compare the report.' : 'Now switch thermal off (watch the mannequin), or acoustic off (watch the search order change), or fly it yourself.';
    ui.score.innerHTML = `<button class="a2hide" title="hide the report to look at the map">hide ▾</button><div class="a2k">MISSION REPORT · ${st.mode === 'MANUAL' ? 'YOU FLEW IT' : 'AUTONOMOUS'}</div><h3>${title}</h3>
      <div class="a2sv">${st2.map(({ t, r }) => `<div class="${r ? r.how === 'confirmed' ? 'ok' : 'un' : 'no'}"><b>Survivor ${t.id.slice(1)}</b>${r ? `${r.how} · ${fmt(r.t)}` : 'not found'}<span class="nt"><br>${t.note}</span></div>`).join('')}</div>
      <div class="a2grid">
        <div><b>${fmt(st.mt)}</b><span>mission time</span></div>
        <div><b class="${P.falseAlarms.length ? 'bad' : ''}">${P.falseAlarms.length}</b><span>false alarms</span></div>
        <div><b>${P.hazards.length}/8</b><span>hazards on the map</span></div>
        <div><b>${cov.toFixed(0)} %</b><span>floor mapped</span></div>
        <div><b>${st.dist.toFixed(0)} m</b><span>flown</span></div>
        <div><b>${st.wh.toFixed(1)}</b><span>Wh used of ${BAT_WH}</span></div>
        <div><b>${nav.S.lcCount}</b><span>loop closures</span></div>
        <div><b class="${st.collisions ? 'bad' : ''}">${st.collisions}</b><span>collisions</span></div>
      </div>
      ${P.falseAlarms.length ? `<ul class="a2fa">${P.falseAlarms.map(x => `<li>${x.why}</li>`).join('')}</ul>` : ''}
      <p class="a2how">${brain.B.reason ? 'Ended: ' + esc(brain.B.reason) + '. ' : ''}Every “confirmed” needed two independent sensors; positions come from LiDAR points inside the camera’s box (PointPainting).</p>
      <p class="a2tip">${tip}</p>
      <div class="a2btns"><button class="a2btn" data-act="auto">Run it again</button><button class="a2btn ghost" data-act="manual">Fly it yourself</button><button class="a2btn ghost" data-act="hist">⤢ How it decided</button><button class="a2btn ghost" data-act="cont">Back to the story</button></div><p class="a2scrollhint">or scroll up</p>`;
    ui.score.hidden = false; ui.score.classList.remove('min'); ui.hud.classList.add('ending');
    ui.score.querySelector('.a2hide').onclick = () => { const m = ui.score.classList.toggle('min'); ui.score.querySelector('.a2hide').textContent = m ? 'report ▴' : 'hide ▾'; };
    ui.score.querySelector('[data-act=auto]').onclick = () => begin('AUTO'); ui.score.querySelector('[data-act=manual]').onclick = () => begin('MANUAL'); ui.score.querySelector('[data-act=cont]').onclick = () => { onEvent('continue'); exitAct(); };
    ui.score.querySelector('[data-act=hist]').onclick = () => { if (killNudge) { killNudge(); killNudge = null; } hist.show(); };
    setTimeout(() => { if (st.phase !== 'end' || hist.open) return; const tgt = PH ? ui.score.querySelector('[data-act=hist]') : ui.exp;
      killNudge = nudge(ui, tgt, `<b>How did it decide?</b> Every choice it made in this flight, with the numbers behind it, is in the reasoning history.`, { side: PH ? 'above' : 'left', xMax: PH ? Infinity : ui.side.getBoundingClientRect().left - ui.root.getBoundingClientRect().left - 24 }); }, 1600);
    onEvent('score', { found: nConf + nUn, confirmed: nConf, falseAlarms: P.falseAlarms.length, hazards: P.hazards.length, time: st.mt });
  }

  if (opts.autoStart) begin(opts.autoStart === true ? 'AUTO' : opts.autoStart);
  raf = requestAnimationFrame(tick);
  return {
    state: st, sensors, brain, nav, percept, acoustic, world: W, _dbg: { scene, renderer, camera, U },
    _sim(sec, frameDt = 1 / 30) { const n = Math.round(sec / frameDt); for (let i = 0; i < n; i++) { beamN = 0; const k = st.phase === 'fly' ? st.speed : 1; for (let j = 0; j < k; j++) step(frameDt); if (st.phase !== 'fly') draw(frameDt); } draw(frameDt); paintOSD(); drawMap(); paintWhy(); },
    setSensor, setMode, setSpeed, begin, restart, rtl() { st.rtlReq = true; },
    focus() { el.focus({ preventScroll: true }); },
    pause() { st.running = false; clearKeys(); }, resume() { st.running = true; last = performance.now(); },
    destroy() { removeEventListener('wheel', onWheel); cancelAnimationFrame(raf); ro.disconnect(); if (io) io.disconnect(); removeEventListener('blur', clearKeys); acoustic.close(); renderer.dispose(); ui.root.remove(); }
  };
}

// ======================================================================================
function particles(n, color, size, additive, map) {
  const p = new Float32Array(n * 3), v = new Float32Array(n * 3), life = new Float32Array(n);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({ color, size, map: map || null, transparent: true, opacity: additive ? .85 : .7, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true });
  const obj = new THREE.Points(g, mat); obj.frustumCulled = false; let init = false;
  return { obj, mat, update(dt, spawn, maxLife, grav = 0) {
    if (!init) { for (let i = 0; i < n; i++) { spawn(p, i * 3, v, true); life[i] = Math.random() * maxLife; } init = true; }
    for (let i = 0; i < n; i++) { life[i] -= dt; const j = i * 3; if (life[i] <= 0) { spawn(p, j, v, false); life[i] = maxLife * (.5 + Math.random() * .5); }
      v[j + 1] += grav * dt; p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt; if (p[j + 1] < .02 && grav) { p[j + 1] = .02; v[j] *= .5; v[j + 2] *= .5; v[j + 1] = 0; } }
    g.attributes.position.needsUpdate = true; } };
}
function canvasTextures() {
  const mk = (size, draw) => { const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'); draw(x, size); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const R = mulberry(5);
  const crack = mk(256, (x, s) => { x.clearRect(0, 0, s, s); x.strokeStyle = 'rgba(12,10,9,.92)'; x.lineCap = 'round';
    const br = (px, py, a, len, wd, d) => { if (d > 5 || len < 6) return; const nx = px + Math.cos(a) * len, ny = py + Math.sin(a) * len; x.lineWidth = wd; x.beginPath(); x.moveTo(px, py); x.lineTo(nx, ny); x.stroke();
      br(nx, ny, a + (R() - .5) * .9, len * .8, wd * .75, d + 1); if (R() < .45) br(nx, ny, a + (R() < .5 ? -1 : 1) * (.6 + R() * .6), len * .55, wd * .6, d + 1); };
    br(s * .5, 4, Math.PI / 2 + .1, 40, 5, 0); });
  const exit = mk(128, (x, s) => { x.fillStyle = '#0d7a3a'; x.fillRect(0, 0, s, s); x.fillStyle = '#d9ffe6'; x.font = 'bold 40px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('EXIT', s / 2, s / 2 + 2); });
  const tape = mk(256, (x, s) => { x.fillStyle = '#ffd400'; x.fillRect(0, 0, s, s); x.fillStyle = '#111'; for (let i = -s; i < s * 2; i += 40) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 20, 0); x.lineTo(i + 20 - s, s); x.lineTo(i - s, s); x.fill(); } }); tape.repeat.set(5, 1);
  const spray = mk(256, (x, s) => { x.clearRect(0, 0, s, s); x.strokeStyle = 'rgba(255,110,20,.9)'; x.lineWidth = 9; x.lineCap = 'round'; const j = () => (R() - .5) * 6;
    x.beginPath(); x.moveTo(40 + j(), 40 + j()); x.lineTo(216 + j(), 216 + j()); x.moveTo(216 + j(), 40 + j()); x.lineTo(40 + j(), 216 + j()); x.stroke();
    x.fillStyle = 'rgba(255,110,20,.9)'; x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.fillText('13/10', 128, 34); x.fillText('USAR-2', 128, 252); x.fillText(R() < .5 ? '0' : '1', 30, 140); x.fillText('?', 226, 140); });
  const soft = mk(64, (x, s) => { const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, s, s); });
  soft.wrapS = soft.wrapT = THREE.ClampToEdgeWrapping;
  return { crack, exit, tape, spray, soft };
}

// LIMINAL Act 3: inside one drone. A guided tour of Layer 1, one idea per step, each with a live simulation or the
// 3-D drone. Navigation is explicit (Next/Back, arrow keys, one wheel notch, a swipe, or the contents list), and only
// the active step runs. createAct3(host, { base, onExit, onEvent }) mounts it into any element.
import { createMusic } from './music.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { STEPS, PARTS as PARTDEFS } from './steps.js';
import { PARTS, FC_PARTS, GROUPS } from './parts.js';
import { makeAccel, makeGyro, makeBaro, makeMag } from './mems.js';
import kit from './simkit.js';
import { KIT_CSS } from './kitcss.js';
import { CSS } from './style.js';

const SIMS = {
  brains: () => import('./sims/brains.js'), balance: () => import('./sims/balance.js'), vibration: () => import('./sims/vibration.js'),
  fusion: () => import('./sims/fusion.js'), flow: () => import('./sims/flow.js'), pid: () => import('./sims/pid.js'),
  lidar: () => import('./sims/lidar.js'), tilt: () => import('./sims/tilt.js'), shutter: () => import('./sims/shutter.js'),
  calib: () => import('./sims/calib.js'), slam: () => import('./sims/slam.js'), octo: () => import('./sims/octo.js'),
  paint: () => import('./sims/paint.js'), depth: () => import('./sims/depth.js'), frontier: () => import('./sims/frontier.js'),
  frames: () => import('./sims/frames.js'), cycle: () => import('./sims/cycle.js'), failsafe: () => import('./sims/failsafe.js'),
  gps: () => import('./sims/gps.js'),
};
// vertical dissection, millimetres (Blender z -> three y); the camera and flow sensor also slide forward
const EXPLODE = { battery: 360, deck: 300, hat: 200, cooler: 145, pi: 100, fc: 62, fcdamp: 36, rx: 30, tplate: 20, cam: 45,
  motor0: 32, motor1: 32, motor2: 32, motor3: 32, prop0: 72, prop1: 72, prop2: 72, prop3: 72, arms: 0,
  esc: -24, bplate: -46, flow: -66, yoke: -100, servo: -100, tilt: -160, gear: -250 };
const FORWARD = { cam: 70, flow: 34 };
const FC_EX = { fc_lid: 96, fc_core: 38, chip_h753: 38, chip_f103: 38, chip_mag: 38, chip_baro1: 38, chip_baro2: 38, fc_can: 26,
  fc_imu: 13, chip_bmi088: 13, chip_42688: 13, chip_20649: 13, fc_heat: 13, fc_foam: 5, fc_base: 0, fc_bottom: -16 };
const GCOL = { sense: 0x7FD4CF, think: 0xa9a5e6, fly: 0xF6D2B1 };
const ICON = {
  grid: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="9.5" y="1.5" width="5" height="5" rx="1"/><rect x="1.5" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/></svg>',
  back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 3 5 8l5 5"/></svg>',
  next: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  note: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12V3.5l7-1.5v8.5"/><circle cx="4.3" cy="12" r="1.7"/><circle cx="11.3" cy="10.5" r="1.7"/></svg>',
  hand: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v8M6 6v5M12 5v5M3.5 9v2.5a5.5 5.5 0 0 0 11 0V6"/></svg>',
};

export async function createAct3(host, opts = {}) {
  const base = opts.base || 'assets/';
  const onEvent = opts.onEvent || (() => {});
  const exitAct = () => { onEvent('exit'); if (opts.onExit) opts.onExit(); else location.href = opts.backHref || '../'; };
  for (const [id, css] of [['a3css', CSS], ['a3kitcss', KIT_CSS]]) if (!document.getElementById(id)) { const st = document.createElement('style'); st.id = id; st.textContent = css; document.head.appendChild(st); }
  const PH = matchMedia('(max-width: 760px)').matches;
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // ------------------------------------------------------------------ DOM
  const root = h('div', 'a3'); root.tabIndex = -1; root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Act 3: inside one drone');
  const top = h('header', 'a3top', `<div class="a3brand">LIMINAL <i>Act 3 · Inside one drone</i></div><span class="sp"></span>
    <div class="a3tour k-seg" role="radiogroup" aria-label="Tour length"><button type="button" role="radio" data-tour="full">Full tour</button><button type="button" role="radio" data-tour="quick">Quick tour</button></div>
    <button class="a3pill a3mus" type="button" data-a="music" aria-pressed="false" title="Music">${ICON.note}<span class="hideS">Music</span></button>
    <button class="a3pill" type="button" data-a="menu">${ICON.grid}<span>All steps</span></button>
    <button class="a3pill" type="button" data-a="exit">${ICON.back}<span class="hideS">Back to the story</span><span style="display:none" class="showS">Back</span></button>`);
  const text = h('aside', 'a3text'); text.setAttribute('aria-live', 'polite'); const textInner = h('div', 'a3inner'); text.appendChild(textInner);
  const stage = h('section', 'a3stage');
  const view = h('div', 'a3view'), cap = h('div', 'cap'); const canvas = h('canvas'); view.append(canvas, cap);
  const sims = h('div', 'a3sims'), labels = h('div', 'a3labels'); const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); labels.appendChild(svg);
  const legend = h('div', 'a3legend', Object.entries(GROUPS).map(([g, n]) => `<span><i class="g-${g}"></i>${n}</span>`).join(''));
  const drag = h('div', 'a3drag', 'Drag to turn');
  const memscap = h('div', 'a3memscap');
  const card = h('div', 'a3card'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Part details');
  const load = h('div', 'a3load', '<div><s></s></div><p>Loading the drone</p>');
  const mtitle = h('div', 'a3mt');
  stage.append(view, sims, labels, legend, drag, memscap, card, mtitle);
  const dock = h('div', 'a3dock');
  const nav = h('footer', 'a3nav', `<button class="a3prev" type="button">${ICON.back}<span class="t">Back</span></button>
    <div class="a3prog"><div class="meta"><span class="where"></span><span class="k a3keys"><kbd>←</kbd> <kbd>→</kbd> or scroll</span></div><div class="a3segs"></div></div>
    <button class="a3next pulse" type="button"><span class="t"></span><span class="arr">${ICON.next}</span></button>`);
  const menu = h('div', 'a3menu');
  root.append(top, text, stage, dock, nav, menu, load);
  if (PH) text.insertBefore(dock, textInner);          // phones: controls scroll together with the explanation
  host.appendChild(root);
  const prevB = nav.querySelector('.a3prev'), nextB = nav.querySelector('.a3next'), segs = nav.querySelector('.a3segs'), where = nav.querySelector('.where');
  STEPS.forEach((s, i) => { const b = h('button'); b.type = 'button'; b.title = `${i + 1}. ${s.title}`; b.setAttribute('aria-label', `Step ${i + 1}: ${s.title}`);
    if (i > 0 && STEPS[i - 1].part !== s.part) b.classList.add('gap'); b.addEventListener('click', () => goTo(i)); segs.appendChild(b); });
  menu.innerHTML = `<h3>All steps</h3><div class="cols">${PARTDEFS.map((p) => `<div><h4>${esc(p.name)}</h4><ol>${STEPS.map((s, i) => s.part === p.id ? `<li><button type="button" data-i="${i}"><i>${String(i + 1).padStart(2, '0')}</i>${esc(s.title)}</button></li>` : '').join('')}</ol></div>`).join('')}</div>`;
  menu.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) { toggleMenu(false); goTo(+b.dataset.i); } });
  top.querySelector('[data-a="menu"]').addEventListener('click', () => toggleMenu());
  top.querySelector('[data-a="exit"]').addEventListener('click', exitAct);
  // music: generative and quiet; on when the story's sound is on, switchable here
  const music = createMusic('workshop'), musB = top.querySelector('[data-a="music"]');
  const paintMus = () => { musB.classList.toggle('on', music.on); musB.setAttribute('aria-pressed', String(music.on)); const t = musB.querySelector('span'); if (t) t.textContent = music.on ? 'Music on' : 'Music off'; };
  musB.addEventListener('click', () => { music.on ? music.stop() : music.start(); paintMus(); });
  if (opts.music) music.start(); paintMus();
  top.querySelectorAll('[data-tour]').forEach((b) => b.addEventListener('click', () => setTour(b.dataset.tour === 'quick')));
  prevB.addEventListener('click', () => go(-1)); nextB.addEventListener('click', () => { const q = seq(); if (cur === q[q.length - 1]) exitAct(); else go(1); });
  function toggleMenu(on) { const v = on ?? !menu.classList.contains('on'); menu.classList.toggle('on', v); if (v) { menu.querySelectorAll('li button').forEach((b) => b.classList.toggle('on', +b.dataset.i === cur)); menu.scrollTop = 0; } }

  // ------------------------------------------------------------------ 3-D: renderer, light, models
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
  let DPR = Math.min(devicePixelRatio || 1, 1.5); renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(28, 1, .005, 40);
  const env = studioEnv(renderer); scene.environment = env;
  const key = new THREE.DirectionalLight(0xfff0e6, 2.2); key.position.set(-1.6, 2.6, 1.8); scene.add(key);
  const rim = new THREE.DirectionalLight(0xc9c6ff, 2.4); rim.position.set(1.8, 1.0, -2.2); scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffd9e4, 1.2); rim2.position.set(-2, .4, -1.5); scene.add(rim2);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: radialTex(), transparent: true, depthWrite: false, opacity: .55, color: 0x0d0f24 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = -.168; scene.add(blob);
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); let got = 0;
  const prog = (p) => { load.querySelector('s').style.width = (Math.min(1, p) * 100).toFixed(0) + '%'; };
  const get = (u) => new Promise((res, rej) => loader.load(base + u, (g) => { got++; prog(got / 2); res(g); }, (e) => { if (e.total) prog((got + e.loaded / e.total) / 2); }, rej));
  const [dg, fg] = await Promise.all([get('drone.glb'), get('fc.glb')]);
  const rig = new THREE.Group(); scene.add(rig);
  const drone = dg.scene; rig.add(drone);
  const fcRoot = fg.scene; scene.add(fcRoot); fcRoot.visible = false;
  const N = {}, F = {};
  drone.children.forEach((o) => { N[o.name] = o; }); fcRoot.children.forEach((o) => { F[o.name] = o; });
  // every material is transparent from the start, so fading never recompiles a shader
  const mats = new Map();
  const prep = (node) => { const list = []; node.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.envMapIntensity = 1.1; list.push(o.material); } }); mats.set(node, list); node.userData.op = 1; node.userData.glow = 0; };
  for (const n of drone.children) prep(n); for (const n of fcRoot.children) prep(n);
  const base0 = new Map(); for (const n of [...drone.children, ...fcRoot.children]) base0.set(n, n.position.clone());
  const setOp = (node, a) => { if (Math.abs(node.userData.op - a) < .002) return; node.userData.op = a; node.visible = a > .01; for (const m of mats.get(node)) { m.opacity = a; m.depthWrite = a > .5; } };
  const setGlow = (node, col, k) => { const key2 = col * 10 + k; if (node.userData.glow === key2) return; node.userData.glow = key2; for (const m of mats.get(node)) if (m.emissive) { m.emissive.setHex(col); m.emissiveIntensity = k; } };
  // bounding boxes in each node's own frame (for label anchors)
  rig.rotation.y = Math.PI; scene.updateMatrixWorld(true);
  const lbox = new Map();
  for (const n of [...drone.children, ...fcRoot.children]) { const b = new THREE.Box3(), inv = n.matrixWorld.clone().invert();
    n.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv)); } }); lbox.set(n, b); }
  const nodePart = new Map(); for (const p of PARTS) for (const n of p.nodes) nodePart.set(n, p);

  // MEMS stage (its own scene and camera)
  const mScene = new THREE.Scene(); mScene.environment = env;
  const mKey = new THREE.DirectionalLight(0xffffff, 1.5); mKey.position.set(-1, 2, 3); mScene.add(mKey);
  const mCam = new THREE.PerspectiveCamera(30, 1, .05, 30);
  const DEMOS = { accel: makeAccel(), gyro: makeGyro(), baro: makeBaro(), mag: makeMag() };
  for (const d of Object.values(DEMOS)) { mScene.add(d.group); d.kit.setOpacity(1); d.group.visible = false; }
  const memsInp = { x: 0, y: 0, active: true, touch: false };

  // ------------------------------------------------------------------ labels with leader lines (explode + fc)
  const LAB = [];
  function addLabel(set, nodes, title, sub, g, onClick) {
    const el = h('button', 'a3lab', `${g ? `<i class="g-${g}"></i>` : ''}<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`); el.type = 'button'; el.style.opacity = 0; el.style.pointerEvents = 'none';
    if (onClick) el.addEventListener('click', onClick); else el.style.cursor = 'default';
    el.addEventListener('mouseenter', () => { hoverKey = set === 'parts' ? title : null; dirty = true; }); el.addEventListener('mouseleave', () => { hoverKey = null; dirty = true; });
    labels.appendChild(el);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'), dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('r', '3'); svg.append(path, dot);
    LAB.push({ set, nodes, el, path, dot, title, part: null });
    return LAB[LAB.length - 1];
  }
  for (const p of PARTS) addLabel('parts', p.nodes.map((n) => N[n]).filter(Boolean), PH ? p.short : p.name, p.model, p.g, () => openCard(p)).part = p;
  for (const p of FC_PARTS) addLabel('fc', [F[p.key]].filter(Boolean), p.name, p.note, null, null);
  let hoverKey = null, cardPart = null, labelSet = null;
  const CORN = [...Array(8)].map(() => new THREE.Vector3()), v3 = new THREE.Vector3();
  function layoutLabels() {
    const W = stageW, H = stageH;
    const list = [];
    for (const L of LAB) {
      const on = L.set === labelSet && !cardPart;
      if (!on) { if (L.shown) { L.el.style.opacity = 0; L.el.style.pointerEvents = 'none'; L.path.setAttribute('d', ''); L.dot.style.opacity = 0; L.shown = false; } continue; }
      let best = null;
      for (const n of L.nodes) { const lb = lbox.get(n); if (!lb || lb.isEmpty() || !n.visible) continue;
        let mx = -1e9, sy = 0, cnt = 0;
        for (let q = 0; q < 8; q++) { CORN[q].set(q & 1 ? lb.max.x : lb.min.x, q & 2 ? lb.max.y : lb.min.y, q & 4 ? lb.max.z : lb.min.z); n.localToWorld(CORN[q]).project(camera); mx = Math.max(mx, (CORN[q].x + 1) / 2 * W); sy += (1 - CORN[q].y) / 2 * H; cnt++; }
        const c = lb.getCenter(v3); n.localToWorld(c).project(camera); const cx = (c.x + 1) / 2 * W, cy = (1 - c.y) / 2 * H;
        const ax = Math.min(mx + 4, cx + 46);
        if (!best || ax > best.x) best = { x: ax, y: cy };
      }
      if (best) { L.ax = best.x; L.ay = best.y; list.push(L); }
    }
    // the column sits right of everything the model covers
    let maxX = 0; for (const L of list) maxX = Math.max(maxX, L.ax);
    const colX = PH ? W - 112 : Math.min(W - 250, Math.max(W * .62, maxX + 40));
    list.sort((a, b) => a.ay - b.ay);
    const gap = PH ? 24 : 36, t = 24, btm = H - (PH ? 24 : 44);
    list.forEach((L) => { L.y = Math.max(t, Math.min(btm, L.ay)); });
    for (let it = 0; it < 40; it++) { for (let i = 1; i < list.length; i++) { const d = list[i].y - list[i - 1].y; if (d < gap) { const m = (gap - d) / 2; list[i].y += m; list[i - 1].y -= m; } } for (const L of list) L.y = Math.max(t, Math.min(btm, L.y)); }
    for (const L of list) {
      L.shown = true; L.el.style.opacity = 1; L.el.style.pointerEvents = L.part ? 'auto' : 'none';
      L.el.style.transform = `translate(${colX}px, ${(L.y - 10).toFixed(1)}px)`;
      const x1 = colX - 16, elbow = Math.max(L.ax + 10, x1 - 46);
      L.path.setAttribute('d', `M${L.ax.toFixed(1)},${L.ay.toFixed(1)} L${elbow.toFixed(1)},${L.y.toFixed(1)} L${x1},${L.y.toFixed(1)}`);
      L.dot.setAttribute('cx', L.ax.toFixed(1)); L.dot.setAttribute('cy', L.ay.toFixed(1)); L.dot.style.opacity = 1;
    }
  }
  function openCard(p) {
    cardPart = p; const nums = p.nums.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('');
    card.innerHTML = `<button class="a3x" type="button" aria-label="Close">×</button><p class="grp"><i class="g-${p.g}"></i>${GROUPS[p.g]}</p><h3>${esc(p.name)}</h3><p class="mdl">${esc(p.model)}</p><p>${esc(p.what)}</p><dl>${nums}</dl><h4>In LIMINAL</h4><p>${esc(p.why)}</p>`;
    card.classList.add('on'); card.querySelector('.a3x').addEventListener('click', closeCard); dirty = true; layoutLabels(); onEvent('part', p.key);
  }
  function closeCard() { if (!cardPart) return; card.classList.remove('on'); cardPart = null; dirty = true; layoutLabels(); }

  // ------------------------------------------------------------------ view state, poses and per-frame update
  const POSE = {
    hero: { az: -34, el: 13, dist: 1.62, ty: -.005, sx: 0 },
    explode: { az: -26, el: 9, dist: 2.75, ty: .03, sx: -.07 },
    inset: { az: -40, el: 24, dist: 1.85, ty: -.01, sx: 0 },
    fc: { az: -32, el: 28, dist: .37, ty: .05, sx: -.1 },
  };
  let mode = 'hero', focus = null, focusQ = null, explodeT = 0, explodeE = 0, fcT = 0, fcE = 0, autoYaw = 0, userYaw = 0, userPitch = 0, yawV = 0;
  const camNow = { ...POSE.hero }, camTo = { ...POSE.hero };
  let dirty = true, camMoving = true, stageW = 1, stageH = 1, vw = 1, vh = 1; const tgt = new THREE.Vector3(), tgtNow = new THREE.Vector3();
  function setMode(m, step) {
    mode = m; const inset = m === 'sim';
    view.classList.toggle('inset', inset);
    Object.assign(camTo, POSE[inset ? 'inset' : m] || POSE.hero); camMoving = true;
    explodeT = m === 'explode' ? 1 : 0; fcT = m === 'fc' ? 1 : 0;
    labelSet = m === 'explode' ? 'parts' : m === 'fc' ? 'fc' : null;
    if (m !== 'explode') closeCard();
    legend.style.display = m === 'explode' ? '' : 'none'; drag.style.display = (m === 'hero' || m === 'explode' || m === 'fc') ? '' : 'none';
    for (const [k, d] of Object.entries(DEMOS)) d.group.visible = m === 'mems' && step.view.mems === k;
    memscap.style.display = m === 'mems' ? '' : 'none';
    focus = step.view.focus || null;
    // the locator frames the part it is about, from the side it is best seen
    tgt.set(0, 0, 0);
    if (inset && focus) { rig.rotation.y = Math.PI; drone.updateMatrixWorld(true); const b = new THREE.Box3();
      for (const nm of focus) { const n = N[nm]; const lb = n && lbox.get(n); if (lb && !lb.isEmpty()) b.union(lb.clone().applyMatrix4(n.matrixWorld)); }
      if (!b.isEmpty()) { b.getCenter(tgt); const sz = b.getSize(v3).length(); camTo.dist = Math.max(.42, Math.min(1.7, sz * 2.4 + .25)); camTo.ty = tgt.y; camTo.el = tgt.y < -.03 ? 4 : 22; } }
    const fp = focus && PARTS.find((p) => p.nodes.includes(focus[0]));
    cap.innerHTML = fp ? `${esc(fp.name)}<span>${esc(fp.model)}</span>` : '';
    sizeView(); dirty = true; layoutLabels();
  }
  function sizeView() {
    const r = stage.getBoundingClientRect(); stageW = r.width; stageH = r.height;
    const vr = view.getBoundingClientRect(); vw = Math.max(10, vr.width); vh = Math.max(10, vr.height);
    renderer.setSize(vw, vh, false); camera.aspect = mCam.aspect = vw / vh; camera.updateProjectionMatrix(); mCam.updateProjectionMatrix(); dirty = true;
  }
  const ro = new ResizeObserver(() => { sizeView(); layoutLabels(); }); ro.observe(stage);
  const ease = (x) => x * x * (3 - 2 * x); const v0 = new THREE.Vector3();
  const lerpAng = (a, b, t) => a + (((b - a) % 360 + 540) % 360 - 180) * t;

  let raf = 0, last = performance.now(), clock = 0, running = true, frameN = 0, slowFrames = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame); if (!running || document.hidden) { last = now; return; }
    const dtRaw = (now - last) / 1000, dt = Math.min(.05, dtRaw); last = now; clock += dt; frameN++;
    const visible3D = true;
    if (!visible3D) return;
    // adaptive resolution: if frames are slow for a second, render fewer pixels
    if (dt > .028 && DPR > 1) { if (++slowFrames > 40) { DPR = 1; renderer.setPixelRatio(DPR); sizeView(); slowFrames = 0; } } else slowFrames = Math.max(0, slowFrames - 1);
    const k = 1 - Math.exp(-Math.min(.25, dtRaw) * (RM ? 30 : 4.2));   // tweens follow wall time, even on a slow machine
    // camera tween
    let moving = false;
    for (const key2 of ['az', 'el', 'dist', 'ty', 'sx']) { const a = camNow[key2], b = camTo[key2]; const n = key2 === 'az' ? lerpAng(a, b, k) : a + (b - a) * k; if (Math.abs(n - b) > 1e-4) moving = true; camNow[key2] = Math.abs(n - b) < 1e-4 ? b : n; }
    explodeE += (explodeT - explodeE) * k; if (Math.abs(explodeT - explodeE) < 1e-3) explodeE = explodeT; else moving = true;
    fcE += (fcT - fcE) * k; if (Math.abs(fcT - fcE) < 1e-3) fcE = fcT; else moving = true;
    // user drag: yaw with inertia; it eases home in the locator
    userYaw += yawV; yawV *= Math.pow(.03, dt); if (Math.abs(yawV) > 1e-4) moving = true;
    if (mode === 'sim' || mode === 'mems') { userYaw *= Math.pow(.2, dt); userPitch *= Math.pow(.2, dt); }
    const spin = mode === 'hero'; if (spin && !RM) autoYaw += dt * .12; if (mode === 'sim') autoYaw += (0 - autoYaw) * k;
    tgtNow.lerp(mode === 'sim' ? tgt : v0, k); if (tgtNow.distanceToSquared(mode === 'sim' ? tgt : v0) > 1e-8) moving = true;
    if (mode === 'mems') drawMems(dt);
    else if (moving || spin || dirty || explodeE > .001 || mode === 'hero') draw3D(dt, moving || spin || dirty);
    dirty = false;
  }
  function draw3D(dt, needLabels) {
    rig.rotation.y = Math.PI + autoYaw + userYaw;
    // parts: explode offsets
    const e = ease(explodeE);
    for (const [name, dy] of Object.entries(EXPLODE)) { const n = N[name]; if (!n) continue; const b = base0.get(n); n.position.set(b.x, b.y + dy / 1000 * e, b.z - (FORWARD[name] || 0) / 1000 * e); }
    for (let i = 0; i < 4; i++) { const p = N['prop' + i]; if (!p) continue; if (e < .02) p.rotation.y += dt * 2.4 * (i % 2 ? 1 : -1); else p.rotation.y += ((0 - p.rotation.y) % Math.PI) * .1; }
    if (mode === 'hero') { if (N.lidarhead) N.lidarhead.rotation.y += dt * 9; if (N.tilt) N.tilt.rotation.x = Math.sin(clock * .8) * .3; } else if (N.tilt) N.tilt.rotation.x *= .9;
    // opacity and glow: the locator / the questions / the card highlight their parts
    const f = (cardPart && cardPart.nodes) || (focusQ) || (mode === 'sim' ? focus : null);
    const fcShow = ease(fcE);
    for (const n of drone.children) {
      let a = 1;
      if (f) a = f.includes(n.name) ? 1 : (mode === 'sim' ? .1 : .1);
      if (n.name === 'cables') a *= 1 - e;
      if (n.name.startsWith('guard')) a *= 1 - .8 * e;
      a *= Math.max(0, 1 - fcShow * 1.8);
      setOp(n, a);
      const p = nodePart.get(n.name), hot = (f && f.includes(n.name)) || (hoverKey && p && (PH ? p.short : p.name) === hoverKey);
      setGlow(n, hot && p ? GCOL[p.g] : 0, hot ? (mode === 'sim' ? .7 : .32) : 0);
    }
    fcRoot.visible = fcShow > .01;
    if (fcRoot.visible) { for (const n of fcRoot.children) { const b = base0.get(n); n.position.set(b.x, b.y + (FC_EX[n.name] || 0) / 1000 * fcShow, b.z); setOp(n, fcShow); }
      fcRoot.rotation.y = autoYaw * 0 + userYaw + .5; }
    blob.material.opacity = .55 * (1 - fcShow) * (1 - e * .7);
    // camera
    const az = (camNow.az) * Math.PI / 180, el = Math.max(-.2, Math.min(1.2, camNow.el * Math.PI / 180 + userPitch));
    camera.position.set(tgtNow.x + Math.sin(az) * Math.cos(el) * camNow.dist, camNow.ty + Math.sin(el) * camNow.dist, tgtNow.z + Math.cos(az) * Math.cos(el) * camNow.dist);
    camera.lookAt(tgtNow.x, camNow.ty, tgtNow.z); camera.near = Math.max(.003, camNow.dist * .02); camera.far = camNow.dist * 8 + 2;
    camera.setViewOffset(vw, vh, -camNow.sx * vw, 0, vw, vh); camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    if (labelSet && needLabels) layoutLabels();
  }
  function drawMems(dt) {
    const step = STEPS[cur]; const d = DEMOS[step.view.mems]; if (!d) return;
    d.update(dt, memsInp);
    mCam.position.set(...d.cam.pos); mCam.lookAt(...d.cam.tgt); mCam.fov = PH ? 38 : 30;
    mCam.setViewOffset(vw, vh, 0, 0, vw, vh); mCam.updateProjectionMatrix();
    renderer.render(mScene, mCam);
    if (memsRead) memsRead(d.read());
  }

  // ------------------------------------------------------------------ MEMS docks (sliders drive the chips)
  let memsRead = null;
  const memsDock = {};
  function buildMemsDock(kind) {
    const pane = h('div', 'a3dockpane'), controls = h('div', 'controls'), readouts = h('div', 'readouts'); pane.append(controls, readouts); dock.appendChild(pane);
    const R = {};
    if (kind === 'accel') {
      memsInp.x = .35;
      kit.slider(controls, { label: 'Tilt the chip', min: -35, max: 35, step: 1, value: 12, fmt: (v) => v + '°', onInput: (v) => { memsInp.x = v / 57.3 / .62; } });
      let bias = .02; kit.slider(controls, { label: 'Accelerometer bias', min: 0, max: .05, step: .001, value: bias, fmt: (v) => v.toFixed(3) + ' m/s²', onInput: (v) => { bias = v; } });
      R.a = kit.readout(readouts, { label: 'acceleration along the chip', tone: 'heat' });
      R.c = kit.readout(readouts, { label: 'capacitance, left : right', tone: 'ink' });
      R.e = kit.readout(readouts, { label: 'position error after 10 s', tone: 'danger' });
      R.f = kit.readout(readouts, { label: 'after 60 s', tone: 'danger' });
      memsDock.accel = { pane, read: (r) => { R.a.set((r.a >= 0 ? '+' : '−') + Math.abs(r.a).toFixed(2) + ' m/s²'); R.c.set(r.cB.toFixed(2) + ' : ' + r.cA.toFixed(2)); R.e.set((.5 * bias * 100).toFixed(2) + ' m'); R.f.set((.5 * bias * 3600).toFixed(0) + ' m'); } };
    }
    if (kind === 'gyro') {
      kit.slider(controls, { label: 'Turn rate', min: -80, max: 80, step: 1, value: 40, fmt: (v) => v + '°/s', onInput: (v) => { memsInp.x = v / 57.3 / 1.4; } }); memsInp.x = 40 / 57.3 / 1.4;
      let bias = .01; kit.slider(controls, { label: 'Gyro bias while still', min: 0, max: .05, step: .001, value: bias, fmt: (v) => v.toFixed(3) + '°/s', onInput: (v) => { bias = v; } });
      R.r = kit.readout(readouts, { label: 'rate of turn (shown slowed)', tone: 'heat' });
      R.m = kit.readout(readouts, { label: 'heading error after 1 min', tone: 'rose' });
      R.t = kit.readout(readouts, { label: 'after 10 min', tone: 'danger' });
      memsDock.gyro = { pane, read: (r) => { R.r.set((r.rate >= 0 ? '+' : '−') + Math.abs(r.rate).toFixed(0) + '°/s'); R.m.set((bias * 60).toFixed(1) + '°'); R.t.set((bias * 600).toFixed(0) + '°'); } };
    }
    if (kind === 'baro') {
      memsInp.y = 0;
      kit.slider(controls, { label: 'Altitude', min: 0, max: 30, step: .5, value: 15, fmt: (v) => v.toFixed(1) + ' m', onInput: (v) => { memsInp.y = v / 30 * 2 - 1; } });
      let wash = 0; kit.toggle(controls, { label: 'Near the floor', options: [{ v: 0, label: 'Still air' }, { v: 1, label: 'Prop downwash' }], value: 0, onChange: (v) => { wash = v; } });
      R.p = kit.readout(readouts, { label: 'pressure', tone: 'heat' });
      R.g = kit.readout(readouts, { label: 'gap under the membrane', tone: 'ink' });
      R.e = kit.readout(readouts, { label: 'height error from downwash', tone: 'danger' });
      memsDock.baro = { pane, read: (r) => { R.p.set((r.p / 1000).toFixed(2) + ' kPa'); R.g.set(r.gapPct.toFixed(0) + '%'); R.e.set(wash ? '±' + (0.6 + .25 * Math.sin(clock * 3)).toFixed(1) + ' m' : '±0.1 m'); } };
    }
    if (kind === 'mag') {
      memsInp.x = 0;
      kit.slider(controls, { label: 'Rebar distance', min: 0, max: 100, step: 1, value: 50, fmt: (v) => (v < 15 ? 'far' : v > 80 ? 'touching' : (1.6 - v / 100 * 1.4).toFixed(1) + ' m'), onInput: (v) => { memsInp.x = v / 100 * 2 - 1; } });
      R.e = kit.readout(readouts, { label: 'compass error', tone: 'danger' });
      R.t = kit.readout(readouts, { label: 'trust in the compass', tone: 'teal' });
      memsDock.mag = { pane, read: (r) => { R.e.set((r.err >= 0 ? '+' : '−') + Math.abs(r.err).toFixed(0) + '°'); R.t.set(Math.abs(r.err) > 15 ? 'low' : Math.abs(r.err) > 5 ? 'medium' : 'high'); } };
    }
    return memsDock[kind];
  }

  // ------------------------------------------------------------------ simulations (lazy, one running at a time)
  const simInst = {};
  async function enterSim(name) {
    let s = simInst[name];
    if (!s) {
      const st = h('div', 'a3sim'), pane = h('div', 'a3dockpane'), controls = h('div', 'controls'), readouts = h('div', 'readouts');
      pane.append(controls, readouts); sims.appendChild(st); dock.appendChild(pane);
      st.classList.add('on'); pane.classList.add('on');
      s = simInst[name] = { st, pane, api: null };
      try { const mod = await SIMS[name](); s.api = mod.default({ stage: st, controls, readouts, kit }); const lp = kit.takeLastLoop(); if (lp && lp.prime) { try { lp.prime(6); } catch (e) { console.warn(e); } } }
      catch (e) { console.error(e); st.innerHTML = '<p style="padding:24px;color:#F6B3AA">This simulation could not start.</p>'; }
    }
    if (STEPS[cur].view.sim !== name) return;   // the visitor already moved on
    s.st.classList.add('on'); s.pane.classList.add('on'); if (s.api) s.api.start();
  }
  function leaveAll() {
    for (const s of Object.values(simInst)) { s.st.classList.remove('on'); s.pane.classList.remove('on'); if (s.api) s.api.stop(); }
    for (const d of Object.values(memsDock)) d.pane.classList.remove('on');
    memsRead = null;
  }

  // ------------------------------------------------------------------ steps
  let cur = -1, visited = new Set();
  function renderText(s, i) {
    const part = PARTDEFS.find((p) => p.id === s.part);
    let html = `<div class="a3num"><b>${String(i + 1).padStart(2, '0')}</b><span>of ${STEPS.length}</span></div><p class="a3part">${esc(part.name)}</p><h2>${esc(s.title)}</h2>`;
    if (s.lede) html += `<p class="lede">${esc(s.lede)}</p>`;
    if (s.id === 'intro') html += `<div class="a3cta" style="margin:4px 0 18px"><button class="pri" type="button" data-tour2="full">Full tour · 27 steps</button><button class="sec" type="button" data-tour2="quick">Quick tour for judges · 10 steps</button></div>`;
    for (const p of s.body || []) html += `<p>${esc(p)}</p>`;
    if (s.questions) html += `<div class="a3qs">${s.questions.map((q, k) => `<button class="a3q" type="button" data-q="${k}"><b>${k + 1}</b><span>${esc(q.q)}</span><small>${esc(q.a)}</small></button>`).join('')}</div>`;
    if (s.five) html += `<ol class="a3five">${s.five.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>`;
    if (s.analogy) html += `<blockquote class="a3analogy">${esc(s.analogy)}</blockquote>`;
    if (s.liminal) html += `<div class="a3lim"><h4>In LIMINAL</h4><p>${esc(s.liminal)}</p></div>`;
    if (s.tryit) html += `<p class="a3try">${ICON.hand}<span>${esc(s.tryit)}</span></p>`;
    if (s.id === 'outro') html += `<div class="a3cta"><button class="pri" type="button" data-a="exit">Back to the story</button><a class="sec" href="https://github.com/Yokai47/liminal-sih26177" target="_blank" rel="noopener">Read the code</a></div>`;
    textInner.innerHTML = html; text.scrollTop = 0;
    textInner.querySelectorAll('.a3q').forEach((b) => { const q = s.questions[+b.dataset.q];
      const on = () => { focusQ = q.focus; dirty = true; }, off = () => { focusQ = null; dirty = true; };
      b.addEventListener('mouseenter', on); b.addEventListener('mouseleave', off); b.addEventListener('focus', on); b.addEventListener('blur', off); b.addEventListener('click', () => { focusQ = focusQ === q.focus ? null : q.focus; dirty = true; }); });
    const ex = textInner.querySelector('[data-a="exit"]'); if (ex) ex.addEventListener('click', exitAct);
    textInner.querySelectorAll('[data-tour2]').forEach((b) => b.addEventListener('click', () => { setTour(b.dataset.tour2 === 'quick'); go(1); }));
  }
  function updateNav() {
    const q = seq(), k = q.indexOf(cur); prevB.disabled = k <= 0 && cur === q[0];
    const n = k >= 0 && k < q.length - 1 ? STEPS[q[k + 1]] : (k < 0 ? STEPS[q.find((i) => i > cur)] : null);
    nextB.querySelector('.t').innerHTML = n ? (PH ? 'Next' : `<small>Next</small>${esc(n.title)}`) : 'Back to the story';
    nextB.classList.toggle('pulse', cur === 0 && visited.size < 2);
    [...segs.children].forEach((b, i) => { b.classList.toggle('on', i === cur); b.classList.toggle('done', visited.has(i) && i !== cur); });
    const part = PARTDEFS.find((p) => p.id === STEPS[cur].part);
    where.innerHTML = quick ? (k < 0 ? `<b>Step ${cur + 1}</b> · outside the quick tour · ${esc(part.name)}` : `<b>${k + 1} / ${q.length}</b> · Quick tour · ${esc(part.name)}`) : `<b>${cur + 1} / ${STEPS.length}</b> · ${esc(part.name)}`;
    mtitle.innerHTML = `<b>${String(cur + 1).padStart(2, '0')}</b> ${esc(STEPS[cur].title)}`;
  }
  function goTo(i) {
    i = Math.max(0, Math.min(STEPS.length - 1, i)); if (i === cur) return;
    const s = STEPS[i]; leaveAll(); focusQ = null; cur = i; visited.add(i);
    renderText(s, i); updateNav();
    // stage: a quick fade so a change of mode never jumps
    stage.classList.add('a3fade'); view.style.opacity = 0;
    const m = s.view.mode;
    setTimeout(() => {
      if (cur !== i) return;
      setMode(m, s);
      if (m === 'sim') enterSim(s.view.sim);
      if (m === 'mems') { const d = memsDock[s.view.mems] || buildMemsDock(s.view.mems); d.pane.classList.add('on'); memsRead = d.read; memscap.textContent = s.view.mems === 'baro' ? 'Inside an ICP-20100, cut in half (motion exaggerated)' : s.view.mems === 'mag' ? 'Inside the RM3100 (field lines drawn in the chip plane)' : 'Inside the ICM-42688-P (motion exaggerated about a million times)'; }
      view.style.opacity = 1; stage.classList.remove('a3fade');
    }, 140);
    onEvent('step', s.id);
  }
  let quick = !!opts.quick;
  const seq = () => STEPS.map((s, i) => i).filter((i) => !quick || STEPS[i].quick);
  function go(d) { const q = seq(); let k = q.indexOf(cur); if (k < 0) { k = q.findIndex((i) => i > cur); k = d > 0 ? k : k - 1; if (k < 0) k = 0; goTo(q[Math.min(q.length - 1, k)]); return; } goTo(q[Math.max(0, Math.min(q.length - 1, k + d))]); }
  function setTour(on) { quick = on; top.querySelectorAll('[data-tour]').forEach((b) => { const v = (b.dataset.tour === 'quick') === quick; b.classList.toggle('on', v); b.setAttribute('aria-checked', v); });
    [...segs.children].forEach((b, i) => { b.style.display = quick && !STEPS[i].quick ? 'none' : ''; }); if (cur >= 0) { renderText(STEPS[cur], cur); updateNav(); } onEvent('tour', quick ? 'quick' : 'full'); }

  // ------------------------------------------------------------------ input: keys, wheel, swipe, drag
  const typing = (t) => t && (t.closest('input, textarea, select') || t.isContentEditable);
  const onKey = (e) => {
    if (e.key === 'Escape') { if (menu.classList.contains('on')) toggleMenu(false); else if (cardPart) closeCard(); return; }
    if (typing(e.target) || e.altKey || e.ctrlKey || e.metaKey || (e.target.closest && e.target.closest('.k-seg, .a3menu'))) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key)) { e.preventDefault(); go(1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); go(-1); }
    else if (e.key === 'Home') goTo(0); else if (e.key === 'End') goTo(STEPS.length - 1);
  };
  addEventListener('keydown', onKey);
  let wAcc = 0, wLast = 0, wLock = 0, wHard = 0;
  const canScroll = (el, dy) => el && el.scrollHeight > el.clientHeight + 2 && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 2 : el.scrollTop > 2);
  const onWheel = (e) => {
    const t = e.target;
    if (menu.classList.contains('on')) return;
    const sc = t.closest && (t.closest('.a3text') || t.closest('.a3card'));
    if (sc && canScroll(sc, e.deltaY)) return;           // let long text scroll first
    e.preventDefault();
    const now = performance.now();
    if (now < wLock) { wLock = now + 250; return; }                  // swallow a gesture's inertia until 250 ms of quiet
    if (now - wLast > 350) wAcc = 0; wLast = now;
    wAcc += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(wAcc) > 50) { go(wAcc > 0 ? 1 : -1); wAcc = 0; wLock = now + 420; }
  };
  root.addEventListener('wheel', onWheel, { passive: false });
  let tx0 = 0, ty0 = 0, tOn = false;
  root.addEventListener('touchstart', (e) => { const t = e.target; if (t.closest('input, .a3card, .a3menu, .a3dock')) { tOn = false; return; } tOn = true; tx0 = e.touches[0].clientX; ty0 = e.touches[0].clientY; }, { passive: true });
  root.addEventListener('touchend', (e) => { if (!tOn) return; tOn = false; const dx = e.changedTouches[0].clientX - tx0, dy = e.changedTouches[0].clientY - ty0;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(dx < 0 ? 1 : -1); }, { passive: true });
  // drag to turn the model (hero, explode, fc); a click on a part opens its card
  let dragging = false, lx = 0, ly = 0, moved = 0;
  const ndc = new THREE.Vector2(), ray = new THREE.Raycaster();
  canvas.addEventListener('pointerdown', (e) => { if (mode === 'sim' || mode === 'mems') return; dragging = true; lx = e.clientX; ly = e.clientY; moved = 0; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) { const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy); yawV = dx * .006; userPitch = Math.max(-.5, Math.min(.6, userPitch + dy * .004)); dirty = true; return; }
    if (mode !== 'explode') return;
    const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const p = pickPart(); const k2 = p ? (PH ? p.short : p.name) : null; if (k2 !== hoverKey) { hoverKey = k2; dirty = true; } canvas.style.cursor = p ? 'pointer' : 'grab';
  });
  canvas.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; if (moved < 6 && mode === 'explode') { const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); const p = pickPart(); if (p) openCard(p); else closeCard(); } });
  function pickPart() {
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(drone.children.filter((n) => n.visible && n.userData.op > .5), true);
    for (const hh of hits) { let n = hh.object; while (n && !nodePart.get(n.name)) n = n.parent; if (n) return nodePart.get(n.name); }
    return null;
  }

  // ------------------------------------------------------------------ go
  sizeView();
  setTour(quick);
  goTo(opts.start ? Math.max(0, STEPS.findIndex((s) => s.id === opts.start)) : 0);
  raf = requestAnimationFrame(frame);
  setTimeout(() => { load.style.opacity = 0; setTimeout(() => load.remove(), 520); onEvent('ready'); }, 200);
  root.focus({ preventScroll: true });
  return {
    root, goTo, next: () => go(1), prev: () => go(-1), get step() { return STEPS[cur].id; }, get index() { return cur; }, steps: STEPS.map((s) => s.id),
    openCard: (k) => openCard(PARTS.find((p) => p.key === k)), closeCard,
    _dbg: { scene, camera, renderer, N, F, DEMOS, simInst, memsInp },
    pause() { running = false; for (const s of Object.values(simInst)) if (s.api) s.api.stop(); },
    resume() { running = true; last = performance.now(); const s = STEPS[cur]; if (s.view.mode === 'sim' && simInst[s.view.sim]?.api) simInst[s.view.sim].api.start(); },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('keydown', onKey); try { music.destroy(); } catch (e) { /* ignore */ }
      for (const s of Object.values(simInst)) if (s.api) { try { s.api.destroy(); } catch (e) { /* ignore */ } }
      renderer.dispose(); env.dispose(); root.remove(); },
  };
}

// ====================================================================== helpers
function studioEnv(renderer) {
  // a dusk studio: dark dome, a big warm key softbox, cool rim strips, a floor bounce
  const s = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec3 vP; void main(){ float y = vP.y; vec3 top = vec3(.42,.42,.62); vec3 hor = vec3(.2,.2,.36); vec3 bot = vec3(.07,.07,.14);
      vec3 c = y > 0. ? mix(hor, top, pow(y, .8)) : mix(hor, bot, pow(-y, .6)); gl_FragColor = vec4(c, 1.); }` }));
  s.add(dome);
  const panel = (w, hh, pos, col, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m); };
  panel(5, 3.5, [-4.5, 6, 4], 0xfff1e8, 5.5);
  panel(1.2, 6, [6, 2.5, -4], 0xcfccff, 4.2);
  panel(1.0, 5, [-6.5, 1.5, -2], 0xffd6e2, 2.6);
  panel(6, 2, [3, 1.2, 6], 0xffffff, 1.0);
  panel(10, 10, [0, -6, 0], 0x5d58a0, .6);
  const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromScene(s, .02); pm.dispose();
  return rt.texture;
}
function radialTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.45, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

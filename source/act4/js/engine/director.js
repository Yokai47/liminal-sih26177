// The director: a small shot library and an automatic camera with critically damped moves; grabbing the view
// (drag, wheel, pinch) hands it to the user until they press "Director".
//  shots: wide (establishing orbit) · top (map) · focus (dolly to a point) · chase (follow a drone) · flock (frame a
//  group) · cutaway (focus with the world's upper parts hidden) · pov (the drone's own eye)
import * as THREE from 'three';
import { ST } from '../sim/tape.js';

export function createDirector(camera, dom, { phone = false, onTake = () => {} } = {}) {
  const pos = new THREE.Vector3(0, 80, 120), tgt = new THREE.Vector3(), vPos = new THREE.Vector3(), vTgt = new THREE.Vector3();
  const wantPos = new THREE.Vector3(), wantTgt = new THREE.Vector3();
  let shot = { kind: 'wide' }, shotT = 0, world = null, tape = null, center = new THREE.Vector3(), radius = 120, user = false, omega = 1.5, snap = true, cutLevel = null, cutVal = null;
  const uS = { az: 0, el: .5, dist: 100, tgt: new THREE.Vector3() };
  let fov = phone ? 46 : 36, viewOffset = 0, viewOffsetY = 0, defaultCut = null;
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  function setWorld(w, t) {
    world = w; tape = t; cutLevel = null; cutVal = null;
    const b = w.bounds || new THREE.Box3().setFromObject(w.group); b.getCenter(center); center.y = Math.max(0, center.y * .2);
    const sz = b.getSize(new THREE.Vector3()); radius = Math.max(sz.x, sz.z) * .5;
    snap = true;
  }
  const sph = (target, az, el, dist, out) => out.set(target.x + Math.cos(el) * Math.sin(az) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(el) * Math.cos(az) * dist);
  const hintOf = (name) => (world && world.camera && world.camera[name]) || null;
  function setShot(s, { cut = false } = {}) {
    if (!s) return; if (shot === s && !cut) return;
    shot = s; shotT = 0; if (cut) snap = true;
    omega = s.omega ?? (s.kind === 'chase' ? 2.0 : 1.15);
    // cutaway: a number (world y), a layer id, or the world's { level, building }
    // (a world with its own default cut, such as a section through a mountain, keeps it for layer-id cutaways)
    let lvl = s.kind === 'cutaway' ? (defaultCut != null && (s.level == null || typeof s.level === 'string') ? defaultCut : (s.level ?? 2.8)) : null;
    if (s.kind === 'hint') { const h = hintOf(s.name); lvl = h && h.cut != null ? h.cut : (s.level ?? null); }
    if (lvl == null) lvl = defaultCut;
    const key = lvl == null ? null : typeof lvl === 'object' ? JSON.stringify(lvl) : String(lvl);
    if (key !== cutLevel && world) { cutLevel = key; cutVal = lvl; try { world.cutaway && world.cutaway(lvl); } catch (e) { /* the world may not support it */ } }
  }
  const A = { x: 0, y: 0, z: 0, h: 0, state: 0 };
  function target(dt, ctx) {
    const s = shot, t = shotT;
    const drift = (s.drift ?? .012) * t;
    const vec = (p) => (p ? tmpA.set(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]) : tmpA.copy(center));
    switch (s.kind) {
      case 'top': { const tg = vec(s.target); wantTgt.copy(tg); sph(tg, (s.az ?? 0) + drift * .3, s.el ?? 1.38, (s.dist ?? radius * 2.25), wantPos); break; }
      case 'focus': case 'cutaway': {
        let tg; if (s.chase != null) { ctx.droneAt(s.chase, A); tg = tmpA.set(A.x, A.y, A.z); } else tg = vec(s.target);
        wantTgt.copy(tg); sph(tg, (s.az ?? .7) + drift, s.el ?? .55, s.dist ?? 40, wantPos); break; }
      case 'chase': {
        ctx.droneAt(s.drone ?? 0, A); const air = A.state !== ST.IDLE && A.state !== ST.LANDED;
        wantTgt.set(A.x, A.y + (air ? .6 : 1), A.z);
        const back = A.h + Math.PI + (s.side ?? .5), d = s.dist ?? 16, el = s.el ?? .42;
        wantPos.set(A.x + Math.cos(back) * Math.cos(el) * d, A.y + Math.sin(el) * d, A.z + Math.sin(back) * Math.cos(el) * d); break;
      }
      case 'flock': {
        // frame every drone matching the filter (or the given list)
        let n = 0, mx = 0, my = 0, mz = 0; const pts = [];
        for (let i = 0; i < ctx.N; i++) { ctx.droneAt(i, A); if (A.state === ST.IDLE || A.state === ST.LANDED || A.state === ST.DEAD) continue; if (s.team != null && A.team !== s.team) continue; if (s.states && !s.states.includes(A.state)) continue; mx += A.x; my += A.y; mz += A.z; n++; pts.push(A.x, A.z); }
        if (n) { mx /= n; my /= n; mz /= n; let sp = 0; for (let q = 0; q < pts.length; q += 2) sp = Math.max(sp, Math.hypot(pts[q] - mx, pts[q + 1] - mz)); wantTgt.set(mx, my * .6, mz); sph(wantTgt, (s.az ?? .8) + drift, s.el ?? .5, Math.max(s.min ?? 30, sp * (s.k ?? 2.6) + 18), wantPos); }
        else { wantTgt.copy(center); sph(center, .8 + drift, .6, radius * 1.6, wantPos); }
        break;
      }
      case 'hint': {
        // one of the world's own camera hints, drifting slowly around its target
        const hh = hintOf(s.name) || hintOf('wide');
        if (!hh) { wantTgt.copy(center); sph(center, .8 + drift, .6, radius * 1.9, wantPos); break; }
        const d = tmpA.copy(hh.pos).sub(hh.target); const dist = d.length() * (s.zoom ?? 1), el = Math.asin(THREE.MathUtils.clamp(d.y / Math.max(1e-6, d.length()), -1, 1)), az = Math.atan2(d.x, d.z);
        wantTgt.copy(hh.target); sph(hh.target, az + drift, el + (s.lift ?? 0), dist, wantPos); break;
      }
      case 'pov': {
        ctx.droneAt(s.drone ?? 0, A); wantPos.set(A.x, A.y + .2, A.z); wantTgt.set(A.x + Math.cos(A.h) * 10, A.y - 2.2, A.z + Math.sin(A.h) * 10); break;
      }
      default: { const tg = vec(s.target); wantTgt.copy(tg); sph(tg, (s.az ?? .78) + drift, s.el ?? .62, s.dist ?? radius * 1.9, wantPos); }
    }
  }
  function spring(x, v, goal, dt, w) {
    // critically damped: x'' = w² (goal − x) − 2 w x'
    const ax = w * w * (goal.x - x.x) - 2 * w * v.x, ay = w * w * (goal.y - x.y) - 2 * w * v.y, az = w * w * (goal.z - x.z) - 2 * w * v.z;
    v.x += ax * dt; v.y += ay * dt; v.z += az * dt; x.x += v.x * dt; x.y += v.y * dt; x.z += v.z * dt;
  }
  function update(dt, ctx) {
    shotT += dt;
    if (!user) {
      target(dt, ctx);
      if (snap) { pos.copy(wantPos); tgt.copy(wantTgt); vPos.set(0, 0, 0); vTgt.set(0, 0, 0); snap = false; }
      else { const steps = Math.max(1, Math.ceil(dt / .016)); const h = dt / steps; for (let s = 0; s < steps; s++) { spring(pos, vPos, wantPos, h, omega); spring(tgt, vTgt, wantTgt, h, omega * 1.25); } }
    } else {
      // user orbit with inertia
      uS.az += uVel.az; uS.el = THREE.MathUtils.clamp(uS.el + uVel.el, .06, 1.52); uVel.az *= Math.pow(.02, dt); uVel.el *= Math.pow(.02, dt);
      tgt.lerp(uS.tgt, 1 - Math.exp(-dt * 10)); sph(tgt, uS.az, uS.el, uS.dist, tmpB); pos.lerp(tmpB, 1 - Math.exp(-dt * 12));
    }
    // a cutaway that follows a drone re-cuts when its drone changes floor or goes outside
    if (shot.kind === 'cutaway' && shot.chase != null && ctx.layerOf && world && defaultCut == null) { const id = ctx.layerOf(shot.chase); const key = id == null ? null : String(id); if (key !== cutLevel) { cutLevel = key; cutVal = id; try { world.cutaway && world.cutaway(id); } catch (e) { /* ignore */ } } }
    // keep the camera above whatever ground there is (no clipping under the floor)
    if (pos.y < tgt.y + 1.2 && shot.kind !== 'pov') pos.y = tgt.y + 1.2;
    // ... and above the terrain itself (a target in a valley must not put the camera inside the hill beside it)
    if (world && typeof world.heightAt === 'function' && shot.kind !== 'pov') { const hg = world.heightAt(pos.x, pos.z); if (Number.isFinite(hg) && pos.y < hg + 4) pos.y = hg + 4; }
    camera.position.copy(pos);
    if (ctx.shake > .001) { const t = performance.now() * .001, k = ctx.shake * Math.min(2.5, pos.distanceTo(tgt) * .012); camera.position.x += Math.sin(t * 37.1) * k; camera.position.y += Math.sin(t * 41.7 + 1) * k * .6; camera.position.z += Math.sin(t * 29.3 + 2) * k; }
    camera.lookAt(tgt);
    const near = Math.max(.15, Math.min(2, pos.distanceTo(tgt) * .01)); camera.near = shot.kind === 'pov' ? .1 : near; camera.far = Math.max(1500, radius * 12);
    camera.fov = shot.kind === 'pov' ? 62 : fov;
    applyOffset();
  }
  let fullW = 1, fullH = 1;
  function applyOffset() { if (viewOffset || viewOffsetY) camera.setViewOffset(fullW, fullH, viewOffset, viewOffsetY, fullW, fullH); else camera.clearViewOffset(); camera.updateProjectionMatrix(); }
  function setFrame(w, h, offsetX, offsetY = 0) { fullW = w; fullH = h; viewOffset = offsetX; viewOffsetY = offsetY; camera.aspect = w / h; applyOffset(); }
  // ------------------------------------------------------------------ user takeover
  const uVel = { az: 0, el: 0 };
  const take = () => {
    if (user) return; user = true;
    const d = tmpA.copy(pos).sub(tgt); uS.dist = d.length(); uS.el = Math.asin(THREE.MathUtils.clamp(d.y / Math.max(1e-6, uS.dist), -1, 1)); uS.az = Math.atan2(d.x, d.z); uS.tgt.copy(tgt);
    onTake(true);
  };
  const ptrs = new Map(); let lastPinch = 0, lastMid = null, btn = 0;
  const onDown = (e) => { if (e.button === 1) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); btn = e.button; dom.setPointerCapture && dom.setPointerCapture(e.pointerId); lastPinch = 0; lastMid = null; moved = 0; };
  let moved = 0;
  const onMove = (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if (moved < 4) return;
    take();
    if (ptrs.size === 1 && btn === 0 && !e.shiftKey) { uVel.az = -dx * .005; uVel.el = dy * .004; }
    else if (ptrs.size === 1) pan(dx, dy);
    else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (lastPinch) uS.dist = THREE.MathUtils.clamp(uS.dist * lastPinch / d, 3, radius * 6);
      if (lastMid) pan(mid.x - lastMid.x, mid.y - lastMid.y);
      lastPinch = d; lastMid = mid;
    }
  };
  const pan = (dx, dy) => {
    const k = uS.dist * .0016; const right = tmpA.set(Math.cos(uS.az), 0, -Math.sin(uS.az)), fwd = tmpB.set(Math.sin(uS.az), 0, Math.cos(uS.az));
    uS.tgt.addScaledVector(right, -dx * k).addScaledVector(fwd, -dy * k);
  };
  const onUp = (e) => { ptrs.delete(e.pointerId); lastPinch = 0; lastMid = null; };
  const onWheel = (e) => { e.preventDefault(); take(); uS.dist = THREE.MathUtils.clamp(uS.dist * Math.exp(e.deltaY * .0012), 3, radius * 6); };
  const onCtx = (e) => e.preventDefault();
  dom.addEventListener('pointerdown', onDown); dom.addEventListener('pointermove', onMove); dom.addEventListener('pointerup', onUp); dom.addEventListener('pointercancel', onUp);
  dom.addEventListener('wheel', onWheel, { passive: false }); dom.addEventListener('contextmenu', onCtx);
  return {
    setWorld, setShot, update, setFrame, setDefaultCut(v) { defaultCut = v ?? null; },
    get shot() { return shot; }, get cutValue() { return cutVal; }, get user() { return user; }, get radius() { return radius; }, get center() { return center; },
    giveBack() { if (!user) return; user = false; vPos.set(0, 0, 0); vTgt.set(0, 0, 0); omega = 1.1; onTake(false); },
    take, snapNow() { snap = true; }, pos, tgt,
    dispose() { dom.removeEventListener('pointerdown', onDown); dom.removeEventListener('pointermove', onMove); dom.removeEventListener('pointerup', onUp); dom.removeEventListener('pointercancel', onUp); dom.removeEventListener('wheel', onWheel); dom.removeEventListener('contextmenu', onCtx); },
  };
}

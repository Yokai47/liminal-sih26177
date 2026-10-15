/* LIMINAL · Act 2 · percept.js — camera (YOLOv8n on Hailo-8), thermal, PointPainting, evidence fusion.
   Rule from the deck: a person needs TWO INDEPENDENT evidences (RGB detection + body-temperature thermal blob).
   One sensor alone → reported UNVERIFIED (and that is how the mannequin and the warm generator become false alarms). */
import * as THREE from 'three';

const YOLO = { person: 'person', mannequin: 'person', fire: 'fire', H1: 'fire', H2: 'gas cylinder', H3: 'fuel drum', H4: 'electrical arc', H5: 'water', H6: 'crack', H7: 'collapse', H8: 'collapse' };

export function createPercept(W) {
  const TG = W.TG, bvh = W.bvh;
  const ray = new THREE.Ray(), v = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const P = { ev: TG.map(() => ({ wait: 0, C: 0, T: 0, A: 0, L: 0, vis: 0, camSees: false, thSees: false, st: 'none', hold: 0, conf: 0, lastSeen: -9, pos: null })),
    cands: [], reports: [], falseAlarms: [], hazards: [], focus: -1, focusT: -9, timer: 0, yoloMs: 0, yoloFps: 0, dets: 0, events: [] };
  const confFor = t => t.kind === 'person' ? .84 : t.kind === 'mannequin' ? .71 : t.kind === 'fire' ? .93 : t.kind === 'machine' ? 0 : .78;

  function reset() { P.ev = TG.map(() => ({ wait: 0, C: 0, T: 0, A: 0, L: 0, vis: 0, camSees: false, thSees: false, st: 'none', hold: 0, conf: 0, lastSeen: -9, pos: null })); P.cands = []; P.reports = []; P.falseAlarms = []; P.hazards = []; P.focus = -1; P.events = []; }

  function visibleFrac(t, cx, cy, cz, d) {
    let ok = 0, n = 0; const pr = t.probes;
    for (let k = 0; k < 5; k++) { const p = pr[(Math.random() * pr.length) | 0]; v.set(p.x - cx, p.y - cy, p.z - cz); const dd = v.length(); v.multiplyScalar(1 / dd);
      ray.origin.set(cx, cy, cz); ray.direction.copy(v); const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, dd + .05); n++;
      if (!hit || hit.distance > dd - .18) { ok++; continue; }
      if (t.oid !== undefined && W.oidOfFace(hit.faceIndex) === t.oid) ok++; }
    return ok / n; }

  function update(dt, ctx) {
    // ctx: { t, cam: {x,y,z,yaw,pitch}, sensors, e:[ex,ez], inSmoke(x,z), lidarHits: Int32Array per target, tracks, lidarOn }
    P.timer += dt; P.yoloFps = ctx.sensors.camera ? 14 + Math.random() * 2 : 0; P.yoloMs = ctx.sensors.camera ? 38 + Math.random() * 8 : 0;
    const step = P.timer >= .12; if (step) P.timer = 0;
    const { x: cx, y: cy, z: cz, yaw, pitch } = ctx.cam;
    fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)); right.set(Math.cos(yaw), 0, -Math.sin(yaw)); up.crossVectors(right, fwd);
    const camSmoke = ctx.inSmoke(cx, cz);
    let dets = 0;
    TG.forEach((t, i) => {
      const E = P.ev[i]; const dx = t.pos.x - cx, dy = t.pos.y - cy, dz = t.pos.z - cz, d = Math.hypot(dx, dy, dz);
      E.L = ctx.lidarHits[i];
      if (step) {
        E.camSees = E.thSees = false;
        if (d < 13) {
          const fx = (dx * fwd.x + dy * fwd.y + dz * fwd.z), hx = Math.atan2(dx * right.x + dz * right.z, fx), vy = Math.atan2(dx * up.x + dy * up.y + dz * up.z, fx);
          const inCam = fx > 0 && Math.abs(hx) < .78 && Math.abs(vy) < .55, inTh = fx > 0 && Math.abs(hx) < .5 && Math.abs(vy) < .38;
          if (inCam || inTh) {
            E.vis = visibleFrac(t, cx, cy, cz, d);
            const smokeLim = camSmoke || ctx.inSmoke(t.pos.x, t.pos.z) ? 3.4 : 99;
            const camRange = Math.min(t.selfLit || t.kind === 'fire' ? 12 : t.kind === 'hazard' ? 9 : 7.5, smokeLim);
            E.camSees = ctx.sensors.camera && inCam && E.vis > .3 && d < camRange;
            E.thSees = ctx.sensors.thermal && inTh && E.vis > .3 && d < 11.5 && t.kind !== 'hazard' || (ctx.sensors.thermal && inTh && E.vis > .3 && d < 11.5 && (t.id === 'H4' || t.id === 'H1'));
          }
        }
      }
      if (E.camSees) { E.C = Math.min(1, E.C + dt / .8); dets++; } if (E.thSees) E.T = Math.min(1, E.T + dt / .6);
      if (E.camSees || E.thSees) E.lastSeen = ctx.t;
      decide(t, i, E, dt, ctx);
    });
    P.dets = dets;
    // acoustic evidence on persons: an open human track whose estimate lies near them
    for (const t of TG) if (t.kind === 'person') { const E = P.ev[t.i]; E.A = 0;
      for (const tr of ctx.tracks || []) if (tr.human && tr.src === t.id && tr.n > 0) E.A = Math.max(E.A, Math.min(1, tr.conf || .5)); }
  }

  const estPos = (t, ctx, s = .05) => ({ x: t.pos.x + ctx.e[0] + (Math.random() - .5) * s, y: t.pos.y, z: t.pos.z + ctx.e[1] + (Math.random() - .5) * s });
  function cand(t, ctx, label) { let c = P.cands.find(k => k.key === t.id); if (!c) { const p = estPos(t, ctx, .3); c = { key: t.id, x: p.x, y: p.y, z: p.z, open: true, label, result: null, tries: 0 }; P.cands.push(c); P.events.push({ k: 'cand', t: ctx.t, tg: t, text: label }); } return c; }
  function close(t, result) { const c = P.cands.find(k => k.key === t.id); if (c) { c.open = false; c.result = result; } }
  function focus(i, t) { P.focus = i; P.focusT = t; }

  function decide(t, i, E, dt, ctx) {
    if (E.st === 'confirmed' || E.st === 'rejected' || E.st === 'false' || E.st === 'hazard' || E.st === 'unverified') return;
    const C = E.C >= 1, T = E.T >= 1, S = ctx.sensors;
    if (t.kind === 'person') {
      if (E.C > .25 || E.T > .25) { cand(t, ctx, E.C > .25 ? 'person?' : 'warm blob'); focus(i, ctx.t); }
      if (C && T) { if (ctx.lidarOn && E.L < 25 && E.wait < 4) { E.wait = (E.wait || 0) + dt; if (!E.waitLog) { E.waitLog = 1; P.events.push({ k: 'likely', t: ctx.t, tg: t, text: 'camera + thermal agree · waiting for LiDAR points inside the box (PointPainting) to fix its 3-D position' }); } } else report(t, i, E, 'confirmed', ctx); }
      else if ((C && !S.thermal) || (T && !S.camera)) { E.hold += dt; if (E.hold > 1.5) report(t, i, E, 'unverified', ctx); }
    } else if (t.kind === 'mannequin') {
      if (E.C > .25) { cand(t, ctx, 'person?'); focus(i, ctx.t); }
      if (C && T) { E.st = 'rejected'; close(t, 'rejected: person-shaped, 21 °C'); P.events.push({ k: 'rejected', t: ctx.t, tg: t, text: `YOLO "person" ${confFor(t).toFixed(2)} but thermal reads ${t.temp.toFixed(0)} °C (ambient) → not a person (mannequin)` }); }
      else if (C && !S.thermal) { E.hold += dt; if (E.hold > 1.5) falseAlarm(t, E, ctx, 'a mannequin, reported as a person: thermal was off, so no heat check'); }
    } else if (t.kind === 'machine') {
      if (E.T > .25) { cand(t, ctx, 'warm blob'); focus(i, ctx.t); }
      if (T && C) { E.st = 'rejected'; close(t, 'rejected: 38 °C machine'); P.events.push({ k: 'rejected', t: ctx.t, tg: t, text: `thermal blob ${t.temp.toFixed(1)} °C, but YOLO finds no person in that box → warm machine, not a person` }); }
      else if (T && !S.camera) { E.hold += dt; if (E.hold > 1.5) falseAlarm(t, E, ctx, 'a warm generator, reported as a person: camera was off, so nothing checked the shape'); }
    } else if (t.kind === 'fire') {
      if (C || T) { E.st = 'hazard'; focus(i, ctx.t); }
    } else if (t.kind === 'hazard') {
      const by = C ? 'camera' : (T && (t.id === 'H4' || t.id === 'H1')) ? 'thermal' : null;
      if (by || (t.link && P.ev[TG.findIndex(k => k.id === t.link)].st === 'hazard')) { E.st = 'hazard'; P.hazards.push(t); P.events.push({ k: 'hazard', t: ctx.t, tg: t, text: `${t.name}${t.sub ? ' · ' + t.sub : ''} (${by === 'thermal' ? 'thermal hot-spot' : 'YOLO "' + YOLO[t.id] + '"'})` }); }
    }
  }
  function report(t, i, E, how, ctx) {
    E.st = how; const painted = ctx.lidarOn && E.L >= 25;
    const p = estPos(t, ctx, painted ? .08 : .6); E.pos = p; E.sigma = painted ? .1 : .8;
    close(t, how === 'confirmed' ? 'confirmed person' : 'unverified person');
    const r = { tg: t, how, t: ctx.t, pos: p, sigma: E.sigma, painted, n: E.L, temp: t.temp, conf: confFor(t) }; P.reports.push(r);
    P.events.push({ k: how, t: ctx.t, tg: t, r, text: how === 'confirmed'
      ? `YOLO "person" ${r.conf.toFixed(2)} + thermal ${t.temp.toFixed(1)} °C agree → CONFIRMED · ${painted ? `PointPainting: ${E.L} LiDAR points in the box → (${(p.x - 5).toFixed(1)}, ${(-(p.z + 1.6)).toFixed(1)}, ${p.y.toFixed(1)}) ±0.1 m` : 'no LiDAR points: position from bearing only ±0.8 m'}`
      : `${E.C >= 1 ? 'camera' : 'thermal'} only → UNVERIFIED report (one evidence)` });
    focus(i, ctx.t);
  }
  function falseAlarm(t, E, ctx, why) { E.st = 'false'; close(t, 'reported (false alarm)'); P.falseAlarms.push({ tg: t, why }); P.events.push({ k: 'false', t: ctx.t, tg: t, text: 'FALSE ALARM · ' + why }); }

  return { P, update, reset, YOLO };
}

// Calibration, teaching the sensors to agree: the camera's view of a room (a doorway, a box, markers on the wall)
// with LiDAR points drawn into it through the pinhole model and the LiDAR-to-camera transform. If the bracket between
// the two sensors flexes, every point lands in the wrong pixel and nothing reports it. "Solve PnP" re-estimates the
// transform from the markers (3-D position from the LiDAR, pixel from the camera) and the points snap back.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  // AR0234: 1920 x 1200 pixels. Intrinsics as found by checkerboard calibration (principal point not quite central).
  const IW = 1920, IH = 1200, FXP = 1150, FYP = 1150, CXP = 974, CYP = 591;
  const S = { rot: 2, off: 15, solving: false, shown: 0, st: 0 };
  const sRot = kit.slider(controls, { label: 'Bracket rotation error', min: 0, max: 4, step: .05, value: S.rot, fmt: (v) => v.toFixed(2) + '°', onInput: (v) => { S.rot = v; S.solving = false; } });
  const sOff = kit.slider(controls, { label: 'Bracket offset', min: 0, max: 30, step: .5, value: S.off, fmt: (v) => v.toFixed(1) + ' mm', onInput: (v) => { S.off = v; S.solving = false; } });
  kit.button(controls, { label: 'Solve PnP', kind: 'primary', onClick: () => { S.solving = true; S.shown = 0; S.st = 0; } });
  const rPx = kit.readout(readouts, { label: 'mean reprojection error', tone: 'danger' });
  const rCm = kit.readout(readouts, { label: 'how far off that is at 3 m', tone: 'rose' });

  // ---------------------------------------------------------------- the room, in camera coordinates (X right, Y down, Z forward)
  const FLOOR = .9, WALL = 3.4, CEIL = -1.5, FAR = 5.6;
  const DOOR = { x0: -1.3, x1: -.4, y0: -1.15 };
  const BOX = { x0: .45, x1: 1.1, y0: .35, z0: 2.0, z1: 2.5 };
  const MARK = [[-2.1, -.65, WALL], [.15, -.85, WALL], [1.6, -.7, WALL], [2.0, .2, WALL], [.05, .12, WALL], [.78, .58, BOX.z0]];
  const LO = [0, .08, 0];                                                       // LiDAR origin, just under the camera

  // LiDAR points: ten tilted slices, rays cast against floor, wall (with the doorway), the room behind and the box
  const pts = [];
  function castRay(dx, dy, dz) {
    let best = Infinity;
    const tryT = (t, ok) => { if (t > 0 && t < best && ok(t)) best = t; };
    if (dy > 0) tryT((FLOOR - LO[1]) / dy, () => true);                     // occlusion is handled by taking the nearest hit
    if (dz > 0) tryT((WALL - LO[2]) / dz, (t) => { const x = dx * t, y = LO[1] + dy * t; return !(x > DOOR.x0 && x < DOOR.x1 && y > DOOR.y0) && y < FLOOR && y > CEIL; });
    if (dz > 0) tryT((FAR - LO[2]) / dz, (t) => { const y = LO[1] + dy * t; return y < FLOOR && y > CEIL; });
    // box: three visible faces
    if (dz > 0) tryT((BOX.z0 - LO[2]) / dz, (t) => { const x = dx * t, y = LO[1] + dy * t; return x > BOX.x0 && x < BOX.x1 && y > BOX.y0 && y < FLOOR; });
    if (dy > 0) tryT((BOX.y0 - LO[1]) / dy, (t) => { const x = dx * t, z = dz * t; return x > BOX.x0 && x < BOX.x1 && z > BOX.z0 && z < BOX.z1; });
    if (dx > 0) tryT((BOX.x0 - LO[0]) / dx, (t) => { const y = LO[1] + dy * t, z = dz * t; return y > BOX.y0 && y < FLOOR && z > BOX.z0 && z < BOX.z1; });
    return best;
  }
  const rnd = kit.rng(3);
  for (const ph of [-26, -21, -16, -11, -6, -1, 4, 9, 14, 19]) {
    const p = ph * Math.PI / 180;
    for (let th = -46; th <= 46; th += 1) {
      const t = th * Math.PI / 180, dx = Math.cos(p) * Math.sin(t), dy = -Math.sin(p), dz = Math.cos(p) * Math.cos(t);
      const r = castRay(dx, dy, dz); if (!(r < 12)) continue;
      const rr = r + kit.gauss(rnd) * .008;
      pts.push([LO[0] + dx * rr, LO[1] + dy * rr, LO[2] + dz * rr]);
    }
  }
  const NP = pts.length;
  const PX = new Float32Array(NP), PY = new Float32Array(NP), PZ = new Float32Array(NP), BK = new Uint8Array(NP);
  pts.forEach(([x, y, z], i) => { PX[i] = x; PY[i] = y; PZ[i] = z; BK[i] = clamp(Math.floor((Math.hypot(x, y, z) - 1.6) / (5.9 - 1.6) * 8), 0, 7); });
  const pal = ['#FFC36B', '#FBCB8E', '#F6D2B1', '#C9D5C4', '#9DD6CB', '#7FD4CF', '#86B0CA', '#8F8CC4'];

  // the bracket error: a small rotation about a fixed, mostly vertical axis, and a small shift
  const AX = (() => { const a = [.35, 1, .25], l = Math.hypot(...a); return a.map((v) => v / l); })();
  const OD = (() => { const a = [1, -.6, .2], l = Math.hypot(...a); return a.map((v) => v / l); })();
  const M = new Float64Array(9); let TX = 0, TY = 0, TZ = 0;
  function setError(rotDeg, offMm) {
    // P_est = R^T (P - LO - t) + LO  (Rodrigues rotation, transposed)
    const a = -rotDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), k = 1 - c, [x, y, z] = AX;
    M[0] = c + x * x * k; M[1] = x * y * k - z * s; M[2] = x * z * k + y * s;
    M[3] = y * x * k + z * s; M[4] = c + y * y * k; M[5] = y * z * k - x * s;
    M[6] = z * x * k - y * s; M[7] = z * y * k + x * s; M[8] = c + z * z * k;
    const o = offMm / 1000; TX = OD[0] * o; TY = OD[1] * o; TZ = OD[2] * o;
  }
  // project a camera-frame point to sensor pixels, or apply the error first
  let pu = 0, pv = 0;
  const proj = (x, y, z) => { pu = FXP * x / z + CXP; pv = FYP * y / z + CYP; };
  const projEst = (x, y, z) => {
    const qx = x - LO[0] - TX, qy = y - LO[1] - TY, qz = z - LO[2] - TZ;
    proj(M[0] * qx + M[1] * qy + M[2] * qz + LO[0], M[3] * qx + M[4] * qy + M[5] * qz + LO[1], M[6] * qx + M[7] * qy + M[8] * qz + LO[2]);
  };
  const TU = new Float32Array(NP), TV = new Float32Array(NP);
  for (let i = 0; i < NP; i++) { proj(PX[i], PY[i], PZ[i]); TU[i] = pu; TV[i] = pv; }

  // ---------------------------------------------------------------- layout
  let L = null;
  function layout() {
    const w = cv.w, h = cv.h, wide = w > 640, g = wide ? 20 : 10;
    let vw, vx, vy;
    if (wide) { vw = Math.min(w - 2 * g - 270, (h - 2 * g - 74) * IW / IH); vx = g; vy = g; }
    else { vw = Math.min(w - 2 * g, (h - 126 - 30) * IW / IH); vx = (w - vw) / 2; vy = 120; }
    const vh = vw * IH / IW;
    L = { w, h, wide, g, vx, vy, vw, vh, k: vw / IW };
  }
  cv.onResize(layout); layout();
  const SX = (u) => L.vx + u * L.k, SY = (v) => L.vy + v * L.k;

  function poly(list, fill, stroke) {
    ctx.beginPath();
    list.forEach(([x, y, z], i) => { proj(x, y, z); i ? ctx.lineTo(SX(pu), SY(pv)) : ctx.moveTo(SX(pu), SY(pv)); });
    ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); }
  }

  function drawScene() {
    ctx.save(); kit.roundRect(ctx, L.vx, L.vy, L.vw, L.vh, 10); ctx.clip();
    ctx.fillStyle = '#20234a'; ctx.fillRect(L.vx, L.vy, L.vw, L.vh);
    const W = 6;
    poly([[-W, CEIL, WALL], [W, CEIL, WALL], [W, FLOOR, WALL], [-W, FLOOR, WALL]], '#30346a');                     // back wall
    poly([[-W, FLOOR, 1.2], [W, FLOOR, 1.2], [W, FLOOR, WALL], [-W, FLOOR, WALL]], '#262a55');                       // floor
    poly([[-W, CEIL, 1.2], [W, CEIL, 1.2], [W, CEIL, WALL], [-W, CEIL, WALL]], '#1d2044');                          // ceiling
    // doorway: the dark room behind
    poly([[DOOR.x0, DOOR.y0, WALL], [DOOR.x1, DOOR.y0, WALL], [DOOR.x1, FLOOR, WALL], [DOOR.x0, FLOOR, WALL]], '#171936');
    poly([[DOOR.x0, FLOOR, WALL], [DOOR.x1, FLOOR, WALL], [DOOR.x1 * 1.25, FLOOR, FAR], [DOOR.x0 * 1.1, FLOOR, FAR]], '#1c1f40');
    ctx.lineWidth = 3; poly([[DOOR.x0, FLOOR, WALL], [DOOR.x0, DOOR.y0, WALL], [DOOR.x1, DOOR.y0, WALL], [DOOR.x1, FLOOR, WALL]], null, null);
    ctx.strokeStyle = 'rgba(143,140,196,.8)'; ctx.lineWidth = 3; ctx.stroke();
    // the box: left face, top face, front face
    poly([[BOX.x0, BOX.y0, BOX.z0], [BOX.x0, BOX.y0, BOX.z1], [BOX.x0, FLOOR, BOX.z1], [BOX.x0, FLOOR, BOX.z0]], '#4a4b86', 'rgba(143,140,196,.7)');
    poly([[BOX.x0, BOX.y0, BOX.z0], [BOX.x1, BOX.y0, BOX.z0], [BOX.x1, BOX.y0, BOX.z1], [BOX.x0, BOX.y0, BOX.z1]], '#5d5e9e', 'rgba(143,140,196,.7)');
    poly([[BOX.x0, BOX.y0, BOX.z0], [BOX.x1, BOX.y0, BOX.z0], [BOX.x1, FLOOR, BOX.z0], [BOX.x0, FLOOR, BOX.z0]], '#55568f', 'rgba(143,140,196,.7)');
    // markers: square tags with a simple pattern
    for (const [x, y, z] of MARK) {
      const hs = .09;
      poly([[x - hs, y - hs, z], [x + hs, y - hs, z], [x + hs, y + hs, z], [x - hs, y + hs, z]], '#DCE4EE');
      const c = .035; poly([[x - c * 1.6, y - c * 1.6, z], [x + c * .2, y - c * 1.6, z], [x + c * .2, y + c * .2, z], [x - c * 1.6, y + c * .2, z]], '#2a2d58');
      poly([[x + c * .5, y + c * .5, z], [x + c * 1.6, y + c * .5, z], [x + c * 1.6, y + c * 1.6, z], [x + c * .5, y + c * 1.6, z]], '#2a2d58');
    }
    ctx.restore();
  }

  const paths = []; for (let i = 0; i < 8; i++) paths.push(null);
  let meanPx = 0;
  function drawPoints() {
    ctx.save(); kit.roundRect(ctx, L.vx, L.vy, L.vw, L.vh, 10); ctx.clip();
    for (let i = 0; i < 8; i++) paths[i] = new Path2D();
    const d = L.wide ? 3.2 : 2.4, hd = d / 2; let sum = 0, cnt = 0;
    for (let i = 0; i < NP; i++) {
      projEst(PX[i], PY[i], PZ[i]);
      if (TU[i] >= 0 && TU[i] <= IW && TV[i] >= 0 && TV[i] <= IH) { sum += Math.hypot(pu - TU[i], pv - TV[i]); cnt++; }
      if (pu < -10 || pu > IW + 10 || pv < -10 || pv > IH + 10) continue;
      paths[BK[i]].rect(SX(pu) - hd, SY(pv) - hd, d, d);
    }
    meanPx = cnt ? sum / cnt : 0;
    for (let i = 7; i >= 0; i--) { ctx.fillStyle = pal[i]; ctx.fill(paths[i]); }
    // matched marker pairs while solving: 3-D marker (as the LiDAR measured it, projected) -> pixel the camera found
    if (S.shown > 0) {
      const a = Math.min(1, S.shown);
      for (const [x, y, z] of MARK) {
        proj(x, y, z); const tu = SX(pu), tv = SY(pv); projEst(x, y, z); const eu = SX(pu), ev = SY(pv);
        const R = L.wide ? 9 : 6;
        ctx.strokeStyle = `rgba(127,212,207,${a})`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(tu - R, tv); ctx.lineTo(tu + R, tv); ctx.moveTo(tu, tv - R); ctx.lineTo(tu, tv + R); ctx.stroke();
        ctx.strokeStyle = `rgba(243,238,242,${.85 * a})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(eu, ev); ctx.lineTo(tu, tv); ctx.stroke();
        ctx.fillStyle = `rgba(27,30,61,${.35 * a})`; ctx.strokeStyle = `rgba(255,195,107,${a})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(eu, ev, R, 0, 7); ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; kit.roundRect(ctx, L.vx, L.vy, L.vw, L.vh, 10); ctx.stroke();
  }

  function drawLabels() {
    const wide = L.wide, sz = wide ? 11.5 : 10;
    // in-view tags
    const tag = (s, x, y, col = C.muted, al = 'left') => {
      ctx.font = `${sz}px ${F.sans}`; const tw = ctx.measureText(s).width, bx = al === 'right' ? x - tw - 6 : x - 4;
      ctx.fillStyle = 'rgba(27,30,61,.78)'; kit.roundRect(ctx, bx, y - sz - 2, tw + 10, sz + 8, 6); ctx.fill();
      text(ctx, s, al === 'right' ? x - 1 : x + 1, y + 1, { size: sz, color: col });
    };
    tag('camera image + LiDAR points', L.vx + 12, L.vy + 22, C.ink);
    if (S.shown > 0) {
      const done = !S.solving;
      tag(done ? 'solved: the transform matches the bracket again' : 'solvePnP: ' + MARK.length + ' markers, 3-D point → pixel', L.vx + 12, L.vy + 44, done ? C.teal : C.heat);
      if (wide) { tag('○ LiDAR says the marker is here   + camera sees it here', L.vx + 12, L.vy + L.vh - 14, C.muted); }
    }
    // colour key for point depth
    const kx = wide ? L.vx : L.vx, ky = L.vy + L.vh + (wide ? 22 : 18), kw = wide ? 140 : 96;
    const grd = ctx.createLinearGradient(kx, 0, kx + kw, 0); pal.forEach((c, i) => grd.addColorStop(i / 7, c));
    ctx.fillStyle = grd; ctx.fillRect(kx, ky - 4, kw, 4);
    text(ctx, 'near', kx, ky + 12, { size: sz - .5, color: C.faint });
    text(ctx, 'far', kx + kw, ky + 12, { size: sz - .5, color: C.faint, align: 'right' });
    text(ctx, 'dot colour = LiDAR distance', kx + kw + 12, ky, { size: sz, color: C.faint });
    if (wide) text(ctx, 'We calibrate after final assembly and re-check after any hard landing.', L.vx, ky + 40, { size: 12, color: C.muted });
  }

  function drawSide() {
    const wide = L.wide;
    const lines = [['Nothing in the software', C.ink], ['reports this error.', C.ink], ['The points just land in the', C.muted], ['wrong pixels, and everything', C.muted], ['downstream is quietly', C.muted], ['corrupted.', C.muted]];
    if (wide) {
      const x = L.w - 246, y0 = Math.max(236, L.vy + 216);
      text(ctx, 'the bracket (flex drawn ×8)', x, y0, { size: 11.5, color: C.faint });
      const cx = x + 64, cy = y0 + 36;
      ctx.fillStyle = C.mist; kit.roundRect(ctx, cx - 18, cy - 12, 36, 24, 4); ctx.fill();
      ctx.fillStyle = '#2a2d58'; ctx.beginPath(); ctx.arc(cx + 18, cy, 6, 0, 7); ctx.fill(); ctx.strokeStyle = C.mist; ctx.lineWidth = 2; ctx.stroke();
      text(ctx, 'camera', cx - 24, cy + 4, { size: 11, color: C.muted, align: 'right' });
      // where the calibration thinks the LiDAR points, and where the flexed bracket really points it
      const ly = cy + 39;
      ctx.strokeStyle = 'rgba(243,238,242,.3)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx + 18, ly); ctx.lineTo(cx + 92, ly); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, 'calibrated', cx + 98, ly + 14, { size: 10.5, color: C.faint });
      const a = S.rot * 8 * Math.PI / 180, off = S.off * .25;
      ctx.save(); ctx.translate(cx, cy + 12); ctx.rotate(-a);
      ctx.strokeStyle = 'rgba(143,140,196,.9)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 22 + off); ctx.stroke();
      ctx.fillStyle = C.heat; kit.roundRect(ctx, -16, 22 + off, 32, 10, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(255,195,107,.75)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(16, 27 + off); ctx.lineTo(80, 27 + off); ctx.stroke();
      ctx.restore();
      const ex = cx + Math.cos(-a) * 80 - Math.sin(-a) * (39 + off), ey = cy + 12 + Math.sin(-a) * 80 + Math.cos(-a) * (27 + off);
      text(ctx, 'actual', ex + 6, ey - 4, { size: 10.5, color: C.heat });
      text(ctx, 'LiDAR', cx - 24, ly + 4, { size: 11, color: C.heat, align: 'right' });
      lines.forEach(([t, c], i) => text(ctx, t, x, y0 + 116 + i * 18 + (i > 1 ? 8 : 0), { size: 12.5, color: c }));
    } else {
      text(ctx, 'Nothing in the software reports this error:', L.g + 2, 24, { size: 11, color: C.ink });
      text(ctx, 'a flexed bracket silently corrupts', L.g + 2, 41, { size: 11, color: C.muted });
      text(ctx, 'everything downstream.', L.g + 2, 56, { size: 11, color: C.muted });
      text(ctx, 'Press Solve PnP to re-calibrate.', L.g + 2, 80, { size: 10.5, color: C.faint });
    }
  }

  const loop = kit.loop((dt) => {
    if (S.solving) {
      S.shown = Math.min(1.5, S.shown + dt * 3); S.st += dt;
      const f = S.st < .7 ? 1 : Math.exp(-dt * 2.6);                         // first match the markers, then converge
      S.rot *= f; S.off *= f;
      if (S.rot < .015 && S.off < .25) { S.rot = .01; S.off = .2; S.solving = false; S.shown = 2.5; }
      sRot.set(S.rot); sOff.set(S.off);
    } else if (S.shown > 0) S.shown = Math.max(0, S.shown - dt);
    setError(S.rot, S.off);
    cv.clear(); drawScene(); drawPoints(); drawLabels(); drawSide();
    const cm = meanPx / FXP * 300;
    rPx.set(meanPx.toFixed(1) + ' px'); rPx.tone(meanPx > 2 ? 'danger' : 'teal');
    rCm.set(cm.toFixed(1) + ' cm'); rCm.tone(cm > 1 ? 'rose' : 'teal');
  });
  setError(S.rot, S.off); cv.clear(); drawScene(); drawPoints(); drawLabels(); drawSide();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

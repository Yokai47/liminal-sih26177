// YOLO and PointPainting: the camera finds "person 0.91" as a box of pixels; LiDAR points projected into the same
// image through the calibration land inside the box and are painted "person"; those painted points have real 3-D
// positions, so they become one marker on the map. A slow detector leaves the box behind as the drone sways, and a
// bad calibration paints the wrong points: either way the marker moves off the person.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const IW = 1920, IH = 1200, FXP = 1500, CXP = 960, CYP = 600, SPEED = 1;
  const S = { hz: 30, cal: 0, box: 1 };
  kit.slider(controls, { label: 'Inference rate', min: 2, max: 30, step: 1, value: S.hz, fmt: (v) => v + ' Hz', onInput: (v) => { S.hz = v; } });
  kit.slider(controls, { label: 'Calibration error', min: 0, max: 5, step: .1, value: S.cal, fmt: (v) => v.toFixed(1) + '°', onInput: (v) => { S.cal = v; } });
  kit.toggle(controls, { label: 'YOLO box', options: [{ v: 1, label: 'On' }, { v: 0, label: 'Off' }], value: 1, onChange: (v) => { S.box = v; } });
  const rHz = kit.readout(readouts, { label: 'detections per second', tone: 'heat' });
  const rBlind = kit.readout(readouts, { label: 'flown blind between them (1 m/s)', tone: 'teal' });
  const rErr = kit.readout(readouts, { label: 'marker position error', tone: 'teal' });

  // ---------------------------------------------------------------- world (X right, Y down, Z forward; camera 1 m above the floor)
  const FLOOR = 1.0, WALL = 5.2, PER = { x: .25, z: 2.8, r: .2, top: -.47, hy: -.6, hr: .115 };
  const RUB = { z: 2.1, x0: -.95, x1: 1.65, top: [[-.95, .45], [-.6, .3], [-.3, .36], [.0, .24], [.3, .27], [.55, .2], [.85, .3], [1.15, .26], [1.4, .38], [1.65, .5]] };
  const PIL = { x0: -1.55, x1: -1.15, z0: 3.9, z1: 4.3 };
  const rubTop = (x) => { const t = RUB.top; for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { const a = (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0]); return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * a; } return t[t.length - 1][1]; };
  const LO = [0, .08, 0];

  // LiDAR points (world frame), and which object each hit: 0 floor, 1 wall, 2 pillar, 3 rubble, 4 person
  const pts = [];
  function cast(dx, dy, dz) {
    let best = Infinity, kind = -1;
    const hit = (t, k) => { if (t > 1e-4 && t < best) { best = t; kind = k; } };
    if (dy > 0) hit((FLOOR - LO[1]) / dy, 0);
    if (dz > 0) hit((WALL - LO[2]) / dz, 1);
    if (dz > 0) { const t = (RUB.z - LO[2]) / dz, x = LO[0] + dx * t, y = LO[1] + dy * t; if (x > RUB.x0 && x < RUB.x1 && y > rubTop(x)) hit(t, 3); }
    if (dz > 0) { const t = (PIL.z0 - LO[2]) / dz, x = dx * t; if (x > PIL.x0 && x < PIL.x1) hit(t, 2); }
    if (dx < 0) { const t = (PIL.x1 - LO[0]) / dx, z = dz * t; if (z > PIL.z0 && z < PIL.z1) hit(t, 2); }
    // person: a vertical cylinder (torso) and a sphere (head)
    { const ox = LO[0] - PER.x, oz = LO[2] - PER.z, a = dx * dx + dz * dz, b = ox * dx + oz * dz, c = ox * ox + oz * oz - PER.r * PER.r, dd = b * b - a * c;
      if (dd > 0) { const t = (-b - Math.sqrt(dd)) / a, y = LO[1] + dy * t; if (y > PER.top && y < FLOOR) hit(t, 4); } }
    { const ox = LO[0] - PER.x, oy = LO[1] - PER.hy, oz = LO[2] - PER.z, b = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - PER.hr * PER.hr, dd = b * b - c;
      if (dd > 0) hit(-b - Math.sqrt(dd), 4); }
    return [best, kind];
  }
  const rnd = kit.rng(9);
  for (let ph = 14; ph >= -22; ph -= 4) {
    const p = ph * Math.PI / 180;
    for (let th = -48; th <= 48; th += .8) {
      const t = th * Math.PI / 180, dx = Math.cos(p) * Math.sin(t), dy = -Math.sin(p), dz = Math.cos(p) * Math.cos(t);
      const [r, k] = cast(dx, dy, dz); if (!(r < 12)) continue;
      const rr = r + kit.gauss(rnd) * .01;
      pts.push([LO[0] + dx * rr, LO[1] + dy * rr, LO[2] + dz * rr, k]);
    }
  }
  const NP = pts.length;
  const WX = new Float32Array(NP), WY = new Float32Array(NP), WZ = new Float32Array(NP), KD = new Uint8Array(NP);
  pts.forEach(([x, y, z, k], i) => { WX[i] = x; WY[i] = y; WZ[i] = z; KD[i] = k; });
  const PU = new Float32Array(NP), PV = new Float32Array(NP), PAINT = new Uint8Array(NP), DEP = new Float32Array(NP), IDX = new Int32Array(NP), SORT = new Float32Array(NP);

  // ---------------------------------------------------------------- camera pose and projection
  let psi = 0, pu = 0, pv = 0, pz = 0;
  const proj = (x, y, z) => { const c = Math.cos(psi), s = Math.sin(psi), xc = c * x - s * z, zc = s * x + c * z; pz = zc; pu = FXP * xc / zc + CXP; pv = FXP * y / zc + CYP; };
  const ER = new Float64Array(9);
  function setCal(deg) {
    const AX = [.18, 1, .12], l = Math.hypot(...AX), [x, y, z] = AX.map((v) => v / l), a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), k = 1 - c;
    ER[0] = c + x * x * k; ER[1] = x * y * k - z * s; ER[2] = x * z * k + y * s; ER[3] = y * x * k + z * s; ER[4] = c + y * y * k; ER[5] = y * z * k - x * s; ER[6] = z * x * k - y * s; ER[7] = z * y * k + x * s; ER[8] = c + z * z * k;
  }
  // a LiDAR point as the software places it in the image: through a calibration that may be off
  const projLidar = (x, y, z) => { const c = Math.cos(psi), s = Math.sin(psi), xc = c * x - s * z, zc = s * x + c * z, yc = y - LO[1];
    const ex = ER[0] * xc + ER[1] * yc + ER[2] * zc, ey = ER[3] * xc + ER[4] * yc + ER[5] * zc + LO[1], ez = ER[6] * xc + ER[7] * yc + ER[8] * zc;
    pz = ez; pu = FXP * ex / ez + CXP; pv = FXP * ey / ez + CYP; };

  // the true person box in the image right now (what a perfect, instant detector would return)
  const PBOX = [[-.24, PER.hy - PER.hr - .02], [.24, PER.hy - PER.hr - .02], [-.27, .1], [.27, .1]];
  function trueBox(out) {
    let u0 = 1e9, u1 = -1e9, v0 = 1e9;
    for (const [dx, y] of PBOX) { proj(PER.x + dx, y, PER.z - .1); u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); }
    // bottom of the box: where the rubble hides the person
    proj(PER.x, rubTop(PER.x) + .02, RUB.z); const v1 = pv;
    out[0] = u0; out[1] = v0; out[2] = u1; out[3] = v1;
  }
  const box = new Float32Array(4), tb = new Float32Array(4);
  let lastDet = -1, T = 0, flash = 0;
  const DET = new Float32Array(64); let detHead = 0;
  let marker = null, mErr = 0, nPaint = 0, nCluster = 0;

  function paint() {
    nPaint = 0; nCluster = 0; marker = null;
    for (let i = 0; i < NP; i++) {
      projLidar(WX[i], WY[i], WZ[i]); PU[i] = pu; PV[i] = pv; PAINT[i] = 0;
      if (S.box && pz > 0 && pu > box[0] && pu < box[2] && pv > box[1] && pv < box[3]) { PAINT[i] = 1; DEP[nPaint] = Math.hypot(WX[i], WZ[i]); IDX[nPaint++] = i; }
    }
    if (nPaint < 3) return;
    // the painted points include some background inside the box: keep the cluster around the median distance
    const so = SORT.subarray(0, nPaint); for (let j = 0; j < nPaint; j++) so[j] = DEP[j]; so.sort();
    const med = so[nPaint >> 1]; let sx = 0, sz = 0;
    for (let j = 0; j < nPaint; j++) if (Math.abs(DEP[j] - med) < .35) { const i = IDX[j]; PAINT[i] = 2; sx += WX[i]; sz += WZ[i]; nCluster++; }
    if (nCluster) { marker = [sx / nCluster, sz / nCluster]; mErr = Math.hypot(marker[0] - PER.x, marker[1] - PER.z); }
  }

  // ---------------------------------------------------------------- layout
  let L = null;
  function layout() {
    const w = cv.w, h = cv.h, wide = w > 640, g = wide ? 20 : 10;
    let cam, map, fwdUp;
    if (wide) {
      const cw = Math.min(w * .6, (h - 2 * g - 150) * IW / IH);
      cam = { x: g, y: g, w: cw, h: cw * IH / IW };
      map = { x: g + cw + 28, y: Math.max(206, g), w: w - g - (g + cw + 28), h: h - g - Math.max(206, g) };
      fwdUp = true;
    } else {
      const cw = Math.min(w - 2 * g - 130, (h * .42) * IW / IH);
      cam = { x: g, y: g, w: cw, h: cw * IH / IW };
      const my = cam.y + cam.h + 12;
      map = { x: g, y: my, w: w - 2 * g, h: h - my - 26 };
      fwdUp = false;
    }
    // map scale: forward range -0.4..5.6 m, sideways -1.9..1.9 m
    const F0 = -.4, F1 = 5.6, S0 = -1.9, S1 = 1.9;
    const sc = fwdUp ? Math.min((map.w - 20) / (S1 - S0), (map.h - 30) / (F1 - F0)) : Math.min((map.w - 20) / (F1 - F0), (map.h - 20) / (S1 - S0));
    L = { w, h, wide, g, cam, map, fwdUp, sc, F0, F1, S0, S1, k: cam.w / IW };
  }
  cv.onResize(layout); layout();
  const CX = (u) => L.cam.x + u * L.k, CY = (v) => L.cam.y + v * L.k;
  // map: world (x sideways, z forward) to screen
  function MP(x, z) {
    const m = L.map, s = L.sc;
    if (L.fwdUp) return [m.x + m.w / 2 + x * s, m.y + m.h - 18 - (z - L.F0) * s];
    return [m.x + 10 + (z - L.F0) * s, m.y + m.h / 2 + x * s];
  }

  function poly(list, fill, stroke, lw = 1.2) {
    ctx.beginPath(); list.forEach(([x, y, z], i) => { proj(x, y, z); i ? ctx.lineTo(CX(pu), CY(pv)) : ctx.moveTo(CX(pu), CY(pv)); }); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }

  // a person silhouette from a few projected joints, drawn with smooth curves
  function drawPerson() {
    const p = PER, zz = p.z - .12, P = (dx, y) => { proj(p.x + dx, y, zz); return [CX(pu), CY(pv)]; };
    const sL = P(-.2, -.43), sR = P(.2, -.43), nL = P(-.055, -.49), nR = P(.055, -.49), aL = P(-.25, -.3), aR = P(.25, -.3);
    const eL = P(-.27, -.02), eR = P(.29, -.05), hL = P(-.24, .3), hR = P(.3, .25), wL = P(-.17, .5), wR = P(.17, .5), cL = P(-.16, -.05), cR = P(.16, -.05);
    ctx.beginPath(); ctx.moveTo(...nL);
    ctx.quadraticCurveTo(sL[0], nL[1] + (sL[1] - nL[1]) * .2, ...sL); ctx.quadraticCurveTo(aL[0] - 1, sL[1], ...aL);
    ctx.lineTo(...eL); ctx.lineTo(...hL); ctx.lineTo(hL[0] + (cL[0] - hL[0]) * .35, hL[1]); ctx.lineTo(...cL); ctx.lineTo(...wL); ctx.lineTo(...wR); ctx.lineTo(...cR);
    ctx.lineTo(hR[0] + (cR[0] - hR[0]) * .35, hR[1]); ctx.lineTo(...hR); ctx.lineTo(...eR); ctx.lineTo(...aR);
    ctx.quadraticCurveTo(aR[0] + 1, sR[1], ...sR); ctx.quadraticCurveTo(sR[0], nR[1] + (sR[1] - nR[1]) * .2, ...nR); ctx.closePath();
    ctx.fillStyle = '#8c86b8'; ctx.fill(); ctx.strokeStyle = 'rgba(220,214,236,.55)'; ctx.lineWidth = 1.2; ctx.stroke();
    proj(p.x, p.hy, zz); const hr = FXP * p.hr / pz * L.k;
    ctx.beginPath(); ctx.ellipse(CX(pu), CY(pv), hr * .9, hr, 0, 0, 7); ctx.fill(); ctx.stroke();
  }

  function drawCamera() {
    const c = L.cam;
    ctx.save(); kit.roundRect(ctx, c.x, c.y, c.w, c.h, 10); ctx.clip();
    ctx.fillStyle = '#1d2044'; ctx.fillRect(c.x, c.y, c.w, c.h);
    const W = 8;
    poly([[-W, -2.2, WALL], [W, -2.2, WALL], [W, FLOOR, WALL], [-W, FLOOR, WALL]], '#2e3266');
    poly([[-W, FLOOR, .6], [W, FLOOR, .6], [W, FLOOR, WALL], [-W, FLOOR, WALL]], '#252852');
    // a crack and a hanging slab for texture
    poly([[1.9, -1.6, WALL], [3.2, -1.1, WALL], [3.15, -.95, WALL], [1.9, -1.45, WALL]], '#3c407a');
    poly([[PIL.x0, -2.2, PIL.z0], [PIL.x1, -2.2, PIL.z0], [PIL.x1, FLOOR, PIL.z0], [PIL.x0, FLOOR, PIL.z0]], '#3d4078', 'rgba(143,140,196,.5)');
    // the person, half behind the rubble
    drawPerson();
    // rubble in front
    const top = RUB.top.map(([x, y]) => [x, y, RUB.z]);
    poly([...top, [RUB.x1, 1.6, RUB.z], [RUB.x0, 1.6, RUB.z]], '#4b4c88', 'rgba(143,140,196,.65)');
    poly([[-.4, .42, RUB.z - .01], [.1, .36, RUB.z - .01], [.3, .62, RUB.z - .01], [-.2, .7, RUB.z - .01]], '#5a5b98');
    poly([[.7, .45, RUB.z - .01], [1.25, .4, RUB.z - .01], [1.3, .7, RUB.z - .01], [.8, .78, RUB.z - .01]], '#55568f');
    // LiDAR points as the calibration places them
    const d = L.wide ? 3 : 2.2, dp = L.wide ? 4.6 : 3.4;
    const p0 = new Path2D(), p1 = new Path2D(), p2 = new Path2D();
    for (let i = 0; i < NP; i++) {
      if (PU[i] < 0 || PU[i] > IW || PV[i] < 0 || PV[i] > IH) continue;
      const x = CX(PU[i]), y = CY(PV[i]);
      if (PAINT[i] === 2) p2.rect(x - dp / 2, y - dp / 2, dp, dp); else if (PAINT[i] === 1) p1.rect(x - d / 2, y - d / 2, d, d); else p0.rect(x - d / 2, y - d / 2, d, d);
    }
    ctx.fillStyle = 'rgba(127,212,207,.75)'; ctx.fill(p0);
    ctx.fillStyle = 'rgba(246,210,177,.85)'; ctx.fill(p1);
    ctx.fillStyle = C.heat; ctx.fill(p2); ctx.strokeStyle = 'rgba(27,30,61,.7)'; ctx.lineWidth = .8; ctx.stroke(p2);
    // YOLO's box
    if (S.box && lastDet >= 0) {
      const x0 = CX(box[0]), y0 = CY(box[1]), x1 = CX(box[2]), y1 = CY(box[3]);
      ctx.strokeStyle = `rgba(255,195,107,${.75 + .25 * flash})`; ctx.lineWidth = 1.6 + flash * 1.2; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      const sz = L.wide ? 12 : 10, lab = 'person 0.91'; ctx.font = `500 ${sz}px ${F.sans}`; const tw = ctx.measureText(lab).width;
      ctx.fillStyle = C.heat; ctx.fillRect(x0 - .8, y0 - sz - 7, tw + 10, sz + 7);
      text(ctx, lab, x0 + 4, y0 - 4, { size: sz, color: '#1E2140', weight: 500 });
    }
    ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; kit.roundRect(ctx, c.x, c.y, c.w, c.h, 10); ctx.stroke();
  }

  function drawMap() {
    const m = L.map, s = L.sc, sz = L.wide ? 11.5 : 10;
    ctx.fillStyle = C.panel; kit.roundRect(ctx, m.x, m.y, m.w, m.h, 10); ctx.fill();
    ctx.save(); kit.roundRect(ctx, m.x, m.y, m.w, m.h, 10); ctx.clip();
    // 1 m grid
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath();
    for (let z = 0; z <= 5; z++) { const [a, b] = MP(L.S0, z), [c2, d2] = MP(L.S1, z); ctx.moveTo(a, b); ctx.lineTo(c2, d2); }
    for (let x = -1; x <= 1; x++) { const [a, b] = MP(x, L.F0), [c2, d2] = MP(x, L.F1); ctx.moveTo(a, b); ctx.lineTo(c2, d2); }
    ctx.stroke();
    // camera field of view
    const [ox, oy] = MP(0, 0), half = Math.atan(CXP / FXP), Rv = 5.4;
    ctx.fillStyle = 'rgba(255,195,107,.06)'; ctx.beginPath(); ctx.moveTo(ox, oy);
    for (const a of [-half, half]) { const ang = psi + a; const [x, y] = MP(Math.sin(ang) * Rv, Math.cos(ang) * Rv); ctx.lineTo(x, y); }
    ctx.closePath(); ctx.fill();
    // all LiDAR points (top-down), then the painted ones
    const p0 = new Path2D(), p1 = new Path2D(), p2 = new Path2D(), d = L.wide ? 2.4 : 2;
    for (let i = 0; i < NP; i++) {
      if (KD[i] === 0) continue;                                                // floor points removed from the map
      const [x, y] = MP(WX[i], WZ[i]);
      if (PAINT[i] === 2) p2.rect(x - 2, y - 2, 4, 4); else if (PAINT[i] === 1) p1.rect(x - d / 2, y - d / 2, d, d); else p0.rect(x - d / 2, y - d / 2, d, d);
    }
    ctx.fillStyle = 'rgba(127,212,207,.45)'; ctx.fill(p0); ctx.fillStyle = 'rgba(246,210,177,.8)'; ctx.fill(p1); ctx.fillStyle = C.heat; ctx.fill(p2);
    // true position (faint)
    const [tx, ty] = MP(PER.x, PER.z);
    ctx.strokeStyle = 'rgba(243,238,242,.35)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(tx, ty, PER.r * s, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    // the drone
    ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(ox, oy, 5, 0, 7); ctx.fill();
    text(ctx, 'drone', ox + (L.fwdUp ? 9 : 0), oy + (L.fwdUp ? 4 : 16), { size: sz, color: C.heat, align: L.fwdUp ? 'left' : 'center' });
    // the marker
    if (marker) {
      const [mx, my] = MP(marker[0], marker[1]);
      ctx.strokeStyle = C.heat; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx, my, 9, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx - 14, my); ctx.lineTo(mx - 5, my); ctx.moveTo(mx + 5, my); ctx.lineTo(mx + 14, my); ctx.moveTo(mx, my - 14); ctx.lineTo(mx, my - 5); ctx.moveTo(mx, my + 5); ctx.lineTo(mx, my + 14); ctx.stroke();
      const lab = `person at (${marker[0].toFixed(2)}, ${marker[1].toFixed(2)}) m`; ctx.font = `500 ${sz + .5}px ${F.sans}`; const tw = ctx.measureText(lab).width;
      const lx = clamp(mx + 16, m.x + 6, m.x + m.w - tw - 12), ly = L.fwdUp ? my - 16 : my - 18;
      ctx.fillStyle = 'rgba(27,30,61,.85)'; kit.roundRect(ctx, lx - 5, ly - sz - 3, tw + 10, sz + 9, 6); ctx.fill();
      text(ctx, lab, lx, ly + 1, { size: sz + .5, color: C.heat, weight: 500 });
    } else {
      const [a, b] = MP(0, 3.2);
      text(ctx, S.box ? 'no person points' : 'no box: just points, no person', a, b, { size: sz + .5, color: C.muted, align: 'center' });
    }
    ctx.restore();
    text(ctx, 'map, from above', m.x + 12, m.y + 18, { size: sz, color: C.muted });
    if (L.wide) text(ctx, 'dashed ring: where the person really is · floor points hidden', m.x + 12, m.y + m.h - 10, { size: 10.5, color: C.faint });
  }

  function drawBelow() {
    const c = L.cam, sz = L.wide ? 11.5 : 10;
    if (L.wide) {
      // detection timeline: last 2 s
      const x0 = c.x, x1 = c.x + c.w, y = c.y + c.h + 34;
      text(ctx, 'YOLO detections, last 2 s' + (S.hz >= 26 ? ' (Hailo-8 speed)' : S.hz <= 3 ? ' (Raspberry Pi CPU alone)' : ''), x0, y - 12, { size: sz, color: C.faint });
      text(ctx, 'now', x1, y - 12, { size: sz, color: C.faint, align: 'right' });
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.strokeStyle = C.heat; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i < 64; i++) { const t = DET[i]; if (!t || T - t > 2) continue; const x = x1 - (T - t) / 2 * (x1 - x0); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); }
      ctx.stroke();
      text(ctx, `between ticks the drone flies ${(SPEED / S.hz * 100).toFixed(0)} cm with no idea what it is looking at`, x0, y + 24, { size: sz, color: S.hz < 8 ? C.rose : C.muted });
      text(ctx, 'A box in a picture is not actionable.', x0, y + 60, { size: 14, color: C.muted, font: F.serif });
      text(ctx, 'A position on a map is.', x0, y + 82, { size: 14, color: C.ink, font: F.serif });
    } else {
      text(ctx, 'A box in a picture is not actionable. A position on a map is.', L.g, L.h - 8, { size: 10.5, color: C.muted });
    }
  }

  const loop = kit.loop((dt) => {
    T += dt; flash = Math.max(0, flash - dt * 5);
    // the drone sways a little while it hovers: the person drifts across the image
    psi = .085 * Math.sin(T * 1.25) + .03 * Math.sin(T * 2.9 + 1);
    setCal(S.cal);
    if (T - lastDet >= 1 / S.hz || lastDet < 0) {
      lastDet = T; flash = 1; trueBox(tb);
      const j = 6; box[0] = tb[0] + (rnd() - .5) * j; box[1] = tb[1] + (rnd() - .5) * j; box[2] = tb[2] + (rnd() - .5) * j; box[3] = tb[3] + (rnd() - .5) * j;
      DET[detHead] = T; detHead = (detHead + 1) % 64;
    }
    paint();
    cv.clear(); drawCamera(); drawMap(); drawBelow();
    rHz.set(S.hz + ' Hz');
    const blind = SPEED / S.hz; rBlind.set(blind >= 1 ? blind.toFixed(1) + ' m' : (blind * 100).toFixed(0) + ' cm'); rBlind.tone(blind > .2 ? 'rose' : 'teal');
    if (marker) { const cm = mErr * 100; rErr.set(cm.toFixed(0) + ' cm'); rErr.tone(cm > 30 ? 'danger' : 'teal'); } else { rErr.set('no marker'); rErr.tone('ink'); }
  });
  setCal(0); trueBox(box); lastDet = 0; paint(); cv.clear(); drawCamera(); drawMap(); drawBelow();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

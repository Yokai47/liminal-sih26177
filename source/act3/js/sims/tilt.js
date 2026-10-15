// Making 3-D from a 2-D scanner: a side view of the drone with the RPLidar under it on a tilt servo. Each LiDAR turn at
// one tilt angle phi is one slice; a sweep nods down and back up and stacks the slices into a point cloud. If the
// drone keeps flying during the sweep, slices taken from different places are combined as if from one place: the wall
// smears and the obstacle doubles. A servo that is off by a degree or two puts points off the true surfaces.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const HZ = 5.5, TS = 1 / HZ, H = 1.35, D = 4.6, BOX = { x0: 2.1, x1: 2.7, y: .45, top: .55 }, V = .2;
  const STEPS = 16, PHI0 = 8, PHI1 = -56, NS = STEPS * 2, NTH = 41, TH = 40;
  const SCHED = []; for (let k = 0; k < NS; k++) { const j = k < STEPS ? k : NS - 1 - k; SCHED.push(PHI0 + (PHI1 - PHI0) * j / (STEPS - 1)); }
  const S = { moving: 0, err: 0 };
  kit.toggle(controls, { label: 'During the sweep', options: [{ v: 0, label: 'Stop-and-scan' }, { v: 1, label: 'Scan while moving' }], value: 0, onChange: (v) => { S.moving = v; reset(); } });
  kit.slider(controls, { label: 'Servo angle error', min: 0, max: 3, step: .1, value: 0, fmt: (v) => '±' + v.toFixed(1) + '°', onInput: (v) => { S.err = v; } });
  kit.button(controls, { label: 'New sweep', kind: 'primary', onClick: () => reset() });
  const rTime = kit.readout(readouts, { label: 'one sweep (' + NS + ' turns)', tone: 'ink' });
  const rPhi = kit.readout(readouts, { label: 'tilt angle now', tone: 'heat' });
  const rBlur = kit.readout(readouts, { label: 'map blur (avg. off the true surface)', tone: 'teal' });

  // point cloud, in the map frame (which assumes everything was measured from the sweep's starting pose)
  const CAP = NS * NTH + 8;
  const mx = new Float32Array(CAP), mz = new Float32Array(CAP), tk = new Uint8Array(CAP), off = new Float32Array(CAP);
  let n = 0, tau = 0, done = 0, blur = 0, lastPhi = SCHED[0], phiTrue = SCHED[0], flash = 0;
  const errs = new Float32Array(NS);
  const rnd = kit.rng(5);
  function reset() { n = 0; tau = 0; done = 0; blur = 0; flash = 0; for (let k = 0; k < NS; k++) errs[k] = 2 * rnd() - 1; }
  reset();
  const droneX = (t) => (S.moving ? V * Math.min(t, NS * TS) : 0);

  // one ray from (ox, 0, 0) along the true direction: returns range and which surface (0 floor, 1 wall, 2 box face)
  let hitT = 0, hitS = 0, hitF = 0;
  function cast(ox, dx, dy, dz) {
    hitT = Infinity; hitS = -1;
    if (dz < 0) { const t = -H / dz; if (t < hitT) { hitT = t; hitS = 0; } }
    if (dx > 0) { const t = (D - ox) / dx; if (t < hitT) { hitT = t; hitS = 1; } }
    // box: slab test
    let t0 = 0, t1 = Infinity, face = -1;
    const sl = (o, d, a, b, f) => { if (Math.abs(d) < 1e-9) return o >= a && o <= b; let u = (a - o) / d, v = (b - o) / d, fa = f; if (u > v) { const w = u; u = v; v = w; fa = f + 1; } if (u > t0) { t0 = u; face = fa; } t1 = Math.min(t1, v); return t0 <= t1; };
    if (sl(ox, dx, BOX.x0, BOX.x1, 0) && sl(0, dy, -BOX.y, BOX.y, 2) && sl(0, dz, -H, -H + BOX.top, 4) && t0 > 0 && t0 < hitT) { hitT = t0; hitS = 2; hitF = face; }
  }

  function addSlice(k) {
    const t = k * TS, xd = droneX(t), cmd = SCHED[k], tru = cmd + errs[k] * S.err;
    const cc = Math.cos(cmd * Math.PI / 180), sc = Math.sin(cmd * Math.PI / 180), ct = Math.cos(tru * Math.PI / 180), st = Math.sin(tru * Math.PI / 180);
    for (let j = 0; j < NTH; j++) {
      const th = (-TH + 2 * TH * j / (NTH - 1)) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
      cast(xd, ct * c, ct * s, st);
      if (!(hitT < 12) || n >= CAP) continue;
      const r = hitT + kit.gauss(rnd) * .01;
      const px = r * cc * c, py = r * cc * s, pz = r * sc;                        // x = r cos(phi) cos(theta), z = r sin(phi)
      mx[n] = px; mz[n] = pz; tk[n] = k;                                          // map frame: drone start at x = 0
      let o;
      if (hitS === 0) o = pz + H; else if (hitS === 1) o = px - D;
      else o = hitF <= 1 ? px - (hitF === 0 ? BOX.x0 : BOX.x1) : hitF <= 3 ? Math.abs(py) - BOX.y : pz - (hitF === 4 ? -H : -H + BOX.top);
      off[n] = o; n++;
    }
    let sum = 0; for (let i = 0; i < n; i++) sum += off[i] * off[i];
    blur = n ? Math.sqrt(sum / n) : 0;
  }

  // ---------------------------------------------------------------- layout
  const WX0 = -1.25, WX1 = 5.15, WZ0 = -1.55, WZ1 = 1.3;
  let L = null;
  function layout() {
    const w = cv.w, h = cv.h, wide = w > 640;
    const band = wide ? 150 : 96, g = wide ? 20 : 12;
    const s = Math.min((w - 2 * g) / (WX1 - WX0), (h - g * 2 - band) / (WZ1 - WZ0));
    const ox = g + ((w - 2 * g) - s * (WX1 - WX0)) / 2 - s * WX0, oz = h - g - s * (0 - WZ0);
    L = { w, h, wide, s, ox, oz, g, top: h - g - s * (WZ1 - WZ0) };
  }
  cv.onResize(layout); layout();
  const X = (x) => L.ox + x * L.s, Z = (z) => L.oz - z * L.s;
  const COLS = []; for (let i = 0; i < 8; i++) { const a = i / 7; COLS.push(`rgb(${Math.round(127 + (246 - 127) * a)},${Math.round(212 + (210 - 212) * a)},${Math.round(207 + (177 - 207) * a)})`); }

  function drawScene() {
    const s = L.s, sz = L.wide ? 11.5 : 10;
    // floor
    ctx.fillStyle = 'rgba(143,140,196,.07)'; ctx.fillRect(X(WX0), Z(-H), (WX1 - WX0) * s, (H + WZ0) * -s);
    ctx.strokeStyle = 'rgba(143,140,196,.45)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(X(WX0), Z(-H)); ctx.lineTo(X(D), Z(-H)); ctx.stroke();
    // wall
    ctx.fillStyle = 'rgba(143,140,196,.13)'; ctx.fillRect(X(D), Z(WZ1), (WX1 - D) * s, (WZ1 - WZ0) * s);
    ctx.beginPath(); ctx.moveTo(X(D), Z(WZ1)); ctx.lineTo(X(D), Z(-H)); ctx.stroke();
    // obstacle (rubble block)
    ctx.fillStyle = 'rgba(143,140,196,.16)'; ctx.fillRect(X(BOX.x0), Z(-H + BOX.top), (BOX.x1 - BOX.x0) * s, BOX.top * s);
    ctx.strokeRect(X(BOX.x0), Z(-H + BOX.top), (BOX.x1 - BOX.x0) * s, BOX.top * s);
    text(ctx, 'wall', X(D) + 8, Z(-.25), { size: sz, color: C.faint });
    text(ctx, 'obstacle', X((BOX.x0 + BOX.x1) / 2), Z(-H + BOX.top) - 8, { size: sz, color: C.faint, align: 'center' });
    text(ctx, 'floor', X(WX0) + 4, Z(-H) + 14, { size: sz, color: C.faint });
  }

  function drawCloud() {
    const d = L.wide ? 3 : 2.2, hd = d / 2;
    for (let b = 0; b < 8; b++) {
      ctx.fillStyle = COLS[b]; ctx.beginPath();
      for (let i = 0; i < n; i++) { if ((tk[i] * 8 / NS | 0) !== b) continue; ctx.rect(X(mx[i]) - hd, Z(mz[i]) - hd, d, d); }
      ctx.fill();
    }
  }

  function drawDrone(x, phi, ghost) {
    const k = clamp(L.s / 150, .5, 1), cx = X(x), cy = Z(0);
    ctx.save(); ctx.translate(cx, cy);
    ctx.globalAlpha = ghost ? .35 : 1;
    if (ghost) ctx.setLineDash([3, 3]);
    // body and arms above the LiDAR
    const by = -26 * k;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-44 * k, by); ctx.lineTo(44 * k, by); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(243,238,242,.5)';
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sx * 44 * k, by - 7 * k, 20 * k, 2.6 * k, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (ghost) ctx.strokeRect(-12 * k, by - 6 * k, 24 * k, 12 * k); else { ctx.fillStyle = C.ink; ctx.fillRect(-12 * k, by - 6 * k, 24 * k, 12 * k); }
    // servo bracket and the LiDAR puck, tilted by phi
    ctx.strokeStyle = 'rgba(243,238,242,.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, by + 6 * k); ctx.lineTo(0, -2 * k); ctx.stroke();
    ctx.rotate(-phi * Math.PI / 180);
    ctx.fillStyle = ghost ? 'transparent' : C.heat; ctx.strokeStyle = C.heat; ctx.lineWidth = 1.5;
    kit.roundRect(ctx, -11 * k, -4 * k, 22 * k, 8 * k, 3 * k); if (!ghost) ctx.fill(); ctx.stroke();
    ctx.restore(); ctx.setLineDash([]);
  }

  function draw() {
    cv.clear();
    const sz = L.wide ? 11.5 : 10, k = Math.min(done, NS - 1), sweeping = done < NS;
    drawScene();
    const xd = droneX(tau);
    // map frame origin (moving mode): the map assumes every point was taken from here
    if (S.moving) {
      drawDrone(0, SCHED[0], true);
      text(ctx, L.wide ? 'the map assumes every point was taken from here' : 'map assumes: taken from here', X(0), Z(0) + 30 * clamp(L.s / 150, .5, 1) + 10, { size: sz, color: C.faint, align: 'center' });
    }
    ctx.save(); ctx.beginPath(); ctx.rect(X(WX0), Z(WZ1), (WX1 - WX0) * L.s, (WZ1 - WZ0) * L.s); ctx.clip(); drawCloud(); ctx.restore();
    // the current slice: the forward ray (theta = 0) at the true tilt
    const pr = phiTrue * Math.PI / 180;
    cast(xd, Math.cos(pr), 0, Math.sin(pr));
    const hx = xd + Math.cos(pr) * hitT, hz = Math.sin(pr) * hitT;
    ctx.strokeStyle = `rgba(255,195,107,${.35 + .5 * flash})`; ctx.lineWidth = 1.5 + flash;
    ctx.beginPath(); ctx.moveTo(X(xd), Z(0)); ctx.lineTo(X(hx), Z(hz)); ctx.stroke();
    ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(X(hx), Z(hz), 3, 0, Math.PI * 2); ctx.fill();
    // tilt arc
    const R = 46 * clamp(L.s / 150, .6, 1);
    ctx.strokeStyle = 'rgba(243,238,242,.25)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(X(xd), Z(0)); ctx.lineTo(X(xd) + R * 1.5, Z(0)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = C.heat; ctx.beginPath(); ctx.arc(X(xd), Z(0), R, Math.min(0, -pr), Math.max(0, -pr)); ctx.stroke();
    text(ctx, 'φ ' + Math.round(phiTrue) + '°', X(xd) + R + 8, Z(0) + (phiTrue < 0 ? 16 : -6), { size: sz, color: C.heat, font: F.mono });
    drawDrone(xd, phiTrue, false);
    if (S.moving && xd > .3) text(ctx, 'drone now', X(xd), Z(0) - 46 * clamp(L.s / 150, .5, 1), { size: sz, color: C.ink, align: 'center' });

    // the top band: formula and what one slice is
    const tx = L.g + 4, ty = L.wide ? 34 : 22;
    text(ctx, 'x = r · cos φ · cos θ', tx, ty, { size: L.wide ? 15 : 12.5, color: C.ink, font: F.mono });
    text(ctx, 'z = r · sin φ', tx, ty + (L.wide ? 24 : 19), { size: L.wide ? 15 : 12.5, color: C.ink, font: F.mono });
    text(ctx, 'r, θ from the LiDAR · φ from the servo', tx, ty + (L.wide ? 48 : 37), { size: sz, color: C.faint });
    if (L.wide) text(ctx, 'One LiDAR turn at one tilt = one slice. ' + STEPS + ' slices down, ' + STEPS + ' back up = one sweep.', tx, ty + 70, { size: 12, color: C.muted });
    // colour key: when each point was measured
    const kx = L.g + 4, ky = L.wide ? ty + 90 : ty + 56, kw = L.wide ? 120 : 92;
    const grd = ctx.createLinearGradient(kx, 0, kx + kw, 0); grd.addColorStop(0, COLS[0]); grd.addColorStop(1, COLS[7]);
    ctx.fillStyle = grd; ctx.fillRect(kx, ky, kw, 4);
    text(ctx, 'dot colour: start → end of sweep', kx, ky + 16, { size: sz - .5, color: C.faint });
    if (!sweeping) text(ctx, 'sweep done', X(-.9), Z(.75), { size: sz, color: C.teal });
    else text(ctx, 'slice ' + (k + 1) + ' / ' + NS, X(-.9), Z(.75), { size: sz, color: C.muted, font: F.mono });
  }

  const HOLD = 1.8;
  const loop = kit.loop((dt) => {
    tau += dt; flash = Math.max(0, flash - dt * 4);
    while (done < NS && tau >= (done + 1) * TS) { addSlice(done); done++; flash = 1; }
    if (done >= NS && tau > NS * TS + HOLD) reset();
    // servo: swings to the next commanded angle in the first quarter of each turn, then holds while the LiDAR spins
    const k = Math.min(done, NS - 1), f = clamp((tau - done * TS) / (TS * .25), 0, 1);
    const prev = done > 0 ? SCHED[done - 1] + errs[done - 1] * S.err : SCHED[0], next = SCHED[k] + errs[k] * S.err;
    phiTrue = done >= NS ? prev : prev + (next - prev) * (f * f * (3 - 2 * f));
    lastPhi = SCHED[k];
    draw();
    rTime.set((NS * TS).toFixed(1) + ' s'); rPhi.set(Math.round(phiTrue) + '°');
    const cm = blur * 100; rBlur.set(n ? (cm < 10 ? cm.toFixed(1) : cm.toFixed(0)) + ' cm' : '…'); rBlur.tone(cm > 3 ? 'danger' : 'teal');
  });
  draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

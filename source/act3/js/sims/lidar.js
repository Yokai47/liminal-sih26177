// LiDAR, the ruler: a top-down view of a small collapsed room with the drone in the middle. The RPLidar A1M8 takes
// 8000 range samples a second while it spins; each sample is a ray cast to the first surface (2-D ray casting against
// line segments) and leaves a dot. Spin faster and the same 8000 samples are spread over more turns, so each ring is
// sparser. Dark surfaces swallow the laser; a mirror bounces it and the reading comes back too long.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const RATE = 8000, RMIN = .15, RMAX = 12, TAU = Math.PI * 2;
  const S = { hz: 5.5, mode: 0, noise: 1 };
  kit.slider(controls, { label: 'Turns per second', min: 2, max: 10, step: .5, value: S.hz, fmt: (v) => v.toFixed(1) + ' Hz', onInput: (v) => { S.hz = v; } });
  kit.toggle(controls, { label: 'Surfaces', options: [{ v: 0, label: 'Normal' }, { v: 1, label: 'Dark & mirrored' }], value: 0, onChange: (v) => { S.mode = v; } });
  kit.slider(controls, { label: 'Range noise', min: 0, max: 5, step: .5, value: S.noise, fmt: (v) => v.toFixed(1) + ' cm', onInput: (v) => { S.noise = v; } });
  const rSps = kit.readout(readouts, { label: 'samples per second', tone: 'ink' });
  const rPpt = kit.readout(readouts, { label: 'points per turn', tone: 'heat' });
  const rAng = kit.readout(readouts, { label: 'angle between points', tone: 'teal' });

  // ---------------------------------------------------------------- the room (metres, drone at 0,0, y down)
  // kind: 0 plain surface, 1 soot-black (swallows the laser in "dark" mode), 2 mirror (bounces it in "dark" mode)
  const segs = [];
  const seg = (a, b, c, d, k = 0) => segs.push([a, b, c, d, k]);
  const boxes = [];
  const box = (cx, cy, w, h, ang, name) => {
    const c = Math.cos(ang), s = Math.sin(ang), p = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
    for (let i = 0; i < 4; i++) seg(p[i][0], p[i][1], p[(i + 1) % 4][0], p[(i + 1) % 4][1]);
    boxes.push({ p, name, cx, cy });
  };
  const RX = 3.4, RY = 2.3, DOOR = [-1.9, -.9];
  seg(-RX, -RY, -.7, -RY); seg(-.7, -RY, 1.0, -RY, 1); seg(1.0, -RY, RX, -RY);          // top wall, middle part soot-black
  seg(RX, -RY, RX, RY);                                                                // right wall
  seg(RX, RY, DOOR[1], RY); seg(DOOR[0], RY, -RX, RY);                                 // bottom wall with the doorway
  seg(-RX, RY, -RX, -RY);                                                              // left wall
  const MIR = [-1.6, .62, -2.1, 1.28]; seg(...MIR, 2);                                 // a fallen mirror
  seg(-3.3, 3.25, .7, 3.25);                                                           // corridor wall seen through the door
  box(-1.8, -1.25, 2.1, .24, .43, 'fallen slab');
  box(3.03, -.1, .56, 1.15, .14, 'cabinet');
  const P = { x: .2, y: 1.55, r: .23 };                                                // a person-sized blob
  const B = { x0: -3.75, x1: 3.75, y0: -2.62, y1: 3.45 };                              // what the view shows

  // ---------------------------------------------------------------- ray casting (no allocation per ray)
  let hT = 0, hK = 0, hI = -1;
  function cast(ox, oy, dx, dy, skip) {
    hT = Infinity; hK = -1; hI = -1;
    for (let i = 0; i < segs.length; i++) {
      if (i === skip) continue;
      const s = segs[i], ex = s[2] - s[0], ey = s[3] - s[1], den = dx * ey - dy * ex;
      if (den > -1e-12 && den < 1e-12) continue;
      const qx = s[0] - ox, qy = s[1] - oy, t = (qx * ey - qy * ex) / den, u = (qx * dy - qy * dx) / den;
      if (t > 1e-6 && u >= 0 && u <= 1 && t < hT) { hT = t; hK = s[4]; hI = i; }
    }
    const px = ox - P.x, py = oy - P.y, b = dx * px + dy * py, disc = b * b - (px * px + py * py - P.r * P.r);
    if (disc > 0) { const t = -b - Math.sqrt(disc); if (t > 1e-6 && t < hT) { hT = t; hK = 3; hI = -2; } }
  }

  // ---------------------------------------------------------------- samples: a ring buffer of the last few turns
  const N = 16000;
  const ux = new Float32Array(N), uy = new Float32Array(N), rr = new Float32Array(N), nz = new Float32Array(N), rv = new Int32Array(N), kd = new Uint8Array(N);
  let head = 0, filled = 0, phase = -Math.PI / 2, acc = 0, curRev = 0, onPerson = 0, onPersonLast = 0;
  let beamDx = 0, beamDy = -1, beamR = 1;
  const rnd = kit.rng(11);
  function sample() {
    const dx = Math.cos(phase), dy = Math.sin(phase);
    cast(0, 0, dx, dy, -1);
    let r = hT, kind = hK === 3 ? 1 : 0;                                                 // 0 surface, 1 person, 2 phantom
    if (S.mode) {
      if (hK === 1 && rnd() < .93) r = Infinity;                                         // black soot: the pulse never comes back
      else if (hK === 2) {
        if (rnd() < .82) {                                                               // mirror: bounce, read the whole path
          const s = segs[hI], ex = s[2] - s[0], ey = s[3] - s[1], l = Math.hypot(ex, ey), nx = -ey / l, ny = ex / l, d = dx * nx + dy * ny;
          const r0 = r; cast(dx * r0, dy * r0, dx - 2 * d * nx, dy - 2 * d * ny, hI); r = r0 + hT; kind = 2;
        } else r = Infinity;
      }
    }
    beamDx = dx; beamDy = dy; beamR = r <= RMAX ? r : 6;
    const rev = Math.floor((phase + Math.PI / 2) / TAU);
    if (rev !== curRev) { onPersonLast = onPerson; onPerson = 0; curRev = rev; }
    if (!(r >= RMIN && r <= RMAX)) return;
    if (kind === 1) onPerson++;
    ux[head] = dx; uy[head] = dy; rr[head] = r; nz[head] = kit.gauss(rnd) * S.noise / 100 * (S.mode && hK === 1 ? 3 : 1); rv[head] = rev; kd[head] = kind;
    head = (head + 1) % N; if (filled < N) filled++;
  }

  // ---------------------------------------------------------------- layout
  let L = null;
  function layout() {
    const w = cv.w, h = cv.h, wide = w > 640;
    const rx = wide ? 20 : 10, ry = wide ? 20 : 10, rw = wide ? w - 300 : w - 20, rh = wide ? h - 40 : h - 48;
    const s = Math.min(rw / (B.x1 - B.x0), rh / (B.y1 - B.y0));
    const ox = rx + (rw - s * (B.x1 - B.x0)) / 2 - s * B.x0, oy = ry + (rh - s * (B.y1 - B.y0)) / 2 - s * B.y0;
    const lens = wide ? { x: w - 150, y: Math.min(h - 210, Math.max(300, h * .5)), r: 84, X: 4 } : { x: w - 56, y: ry + rh - 50, r: 44, X: 6 };
    const d = Math.hypot(P.x, P.y); lens.cx = P.x - P.x / d * P.r * .55; lens.cy = P.y - P.y / d * P.r * .55;
    L = { w, h, wide, s, ox, oy, lens, clip: [rx - 6, ry - 6, rw + 12, rh + 12], dot: wide ? 2.2 : 1.7 };
  }
  cv.onResize(layout); layout();
  const X = (x) => L.ox + x * L.s, Y = (y) => L.oy + y * L.s;

  function drawRoom() {
    const s = L.s;
    // floor of the room
    ctx.fillStyle = 'rgba(143,140,196,.05)'; ctx.fillRect(X(-RX), Y(-RY), 2 * RX * s, 2 * RY * s);
    ctx.fillStyle = 'rgba(143,140,196,.03)'; ctx.fillRect(X(-3.3), Y(RY), 4.0 * s, .95 * s);
    // boxes (slab, cabinet)
    for (const b of boxes) {
      ctx.beginPath(); b.p.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.closePath();
      ctx.fillStyle = 'rgba(143,140,196,.16)'; ctx.fill(); ctx.strokeStyle = 'rgba(143,140,196,.55)'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    // walls
    ctx.lineCap = 'round';
    for (const g of segs) {
      const dark = S.mode && g[4] === 1, mir = S.mode && g[4] === 2;
      ctx.strokeStyle = dark ? 'rgba(74,75,134,.9)' : mir ? 'rgba(220,228,238,.75)' : 'rgba(143,140,196,.5)';
      ctx.lineWidth = dark || mir ? 4 : g[4] === 2 ? 3 : 1.6; ctx.setLineDash(g[1] === 3.25 ? [3, 5] : []);
      ctx.beginPath(); ctx.moveTo(X(g[0]), Y(g[1])); ctx.lineTo(X(g[2]), Y(g[3])); ctx.stroke();
    }
    ctx.setLineDash([]);
    // the person: we know it is a person; the LiDAR does not
    ctx.beginPath(); ctx.arc(X(P.x), Y(P.y), P.r * s, 0, TAU);
    ctx.fillStyle = 'rgba(255,195,107,.16)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,195,107,.75)'; ctx.lineWidth = 1.4; ctx.stroke();
  }

  function drawLabels() {
    const sz = L.wide ? 11.5 : 10, s = L.s;
    const lab = (t, x, y, o = {}) => text(ctx, t, X(x), Y(y), { size: sz, color: C.faint, align: 'center', base: 'middle', ...o });
    lab('fallen slab', -1.8, -.72);
    lab('cabinet', 2.62, -.1, { align: 'right' });
    lab('doorway', (DOOR[0] + DOOR[1]) / 2, RY + .32);
    lab('person', P.x + (L.wide ? .58 : .75), P.y + .02, { color: 'rgba(255,195,107,.85)' });
    if (L.wide) lab('the LiDAR only gets "something at ' + Math.hypot(P.x, P.y).toFixed(1) + ' m"', P.x, P.y - P.r - .25, { color: C.faint, size: 11 });
    if (S.mode) {
      lab('soot-black wall: no return', .15, -RY + (L.wide ? .24 : .36), { color: C.muted });
      lab('mirror', -1.5, 1.32, { color: C.muted });
      text(ctx, L.wide ? 'phantom: the bounce reads too far' : 'phantom', X(-2.85), Y(1.95), { size: sz, color: C.rose, base: 'middle' });
    }
    if (S.noise > 0) {
      if (L.wide) text(ctx, 'range noise drawn ×' + L.lens.X, X(B.x0) + 4, Y(-RY) - 2, { size: sz, color: C.faint, base: 'bottom' });
      else text(ctx, 'noise drawn ×' + L.lens.X, X(-3.65), Y(2.8), { size: sz, color: C.faint, base: 'middle' });
    }
    text(ctx, 'drone + LiDAR', X(0), Y(0) + 26 * Math.max(.7, s / 85), { size: sz, color: C.heat, align: 'center', base: 'top' });
  }

  function drawDrone() {
    const k = Math.max(.62, L.s / 85), x = X(0), y = Y(0);
    ctx.strokeStyle = 'rgba(255,195,107,.85)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (const a of [.785, 2.356, 3.927, 5.498]) {
      const ex = x + Math.cos(a) * 17 * k, ey = y + Math.sin(a) * 17 * k;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath(); ctx.arc(ex, ey, 7.5 * k, 0, TAU); ctx.strokeStyle = 'rgba(255,195,107,.45)'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.strokeStyle = 'rgba(255,195,107,.85)'; ctx.lineWidth = 2;
    }
    ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(x, y, 6 * k, 0, TAU); ctx.fill();
    ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(x, y, 4.2 * k, 0, TAU); ctx.fill();
  }

  // dots, grouped by how old the turn is and whether the reading is a phantom
  function drawDots(paths) {
    const d = L.dot, h = d / 2, ex = L.lens.X;
    for (let j = 0; j < filled; j++) {
      const i = (head - 1 - j + N) % N, age = curRev - rv[i];
      if (age > 2) break;                                           // newest first: everything older is older still
      const r = rr[i] + nz[i] * ex, px = L.ox + ux[i] * r * L.s, py = L.oy + uy[i] * r * L.s;
      paths[age * 2 + (kd[i] === 2 ? 1 : 0)].rect(px - h, py - h, d, d);
    }
    const cols = ['rgba(127,212,207,.95)', 'rgba(239,177,180,.95)', 'rgba(127,212,207,.42)', 'rgba(239,177,180,.42)', 'rgba(127,212,207,.16)', 'rgba(239,177,180,.16)'];
    for (let k = 5; k >= 0; k--) { ctx.fillStyle = cols[k]; ctx.fill(paths[k]); }
  }

  function drawBeam(prev) {
    const x = X(0), y = Y(0), R = 4.2 * L.s;
    let a0 = prev, a1 = phase; if (a1 - a0 > TAU) a0 = a1 - TAU;
    ctx.fillStyle = 'rgba(255,195,107,.05)'; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, R, a0, a1); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,195,107,.8)'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + beamDx * beamR * L.s, y + beamDy * beamR * L.s); ctx.stroke();
  }

  function drawLens() {
    const ln = L.lens, sL = L.s * ln.X, R = ln.r;
    const toX = (x) => ln.x + (x - ln.cx) * sL, toY = (y) => ln.y + (y - ln.cy) * sL;
    // connector from the person to the lens
    const ang = Math.atan2(Y(P.y) - ln.y, X(P.x) - ln.x);
    ctx.strokeStyle = 'rgba(255,195,107,.3)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(ln.x + Math.cos(ang) * R, ln.y + Math.sin(ang) * R); ctx.lineTo(X(P.x) - Math.cos(ang) * P.r * L.s * 1.1, Y(P.y) - Math.sin(ang) * P.r * L.s * 1.1); ctx.stroke(); ctx.setLineDash([]);
    ctx.save(); ctx.beginPath(); ctx.arc(ln.x, ln.y, R, 0, TAU); ctx.fillStyle = C.panel; ctx.fill(); ctx.clip();
    ctx.beginPath(); ctx.arc(toX(P.x), toY(P.y), P.r * sL, 0, TAU);
    ctx.fillStyle = 'rgba(255,195,107,.13)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,195,107,.55)'; ctx.lineWidth = 1.2; ctx.stroke();
    const d = L.wide ? 3.2 : 2.6, lim = R / sL + .05, pNew = new Path2D(), pOld = new Path2D();
    for (let j = 0; j < filled; j++) {
      const i = (head - 1 - j + N) % N, age = curRev - rv[i];
      if (age > 1) break;
      const r = rr[i] + nz[i], wx = ux[i] * r, wy = uy[i] * r;
      if (Math.abs(wx - ln.cx) > lim || Math.abs(wy - ln.cy) > lim) continue;
      (age ? pOld : pNew).rect(toX(wx) - d / 2, toY(wy) - d / 2, d, d);
    }
    ctx.fillStyle = 'rgba(127,212,207,.3)'; ctx.fill(pOld); ctx.fillStyle = C.teal; ctx.fill(pNew);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,195,107,.45)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(ln.x, ln.y, R, 0, TAU); ctx.stroke();
    const sz = L.wide ? 11.5 : 10;
    if (L.wide) {
      text(ctx, 'zoom ×' + ln.X + ' on the person', ln.x, ln.y - R - 12, { size: sz, color: C.muted, align: 'center' });
      text(ctx, onPersonLast + ' dots per turn land on the person', ln.x, ln.y + R + 20, { size: sz, color: C.heat, align: 'center' });
    } else {
      const t = 'person ×' + ln.X + ': ' + onPersonLast + ' dots'; ctx.font = sz + 'px ' + F.sans; const tw = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(27,30,61,.85)'; kit.roundRect(ctx, ln.x + R - tw - 8, ln.y - R - 20, tw + 10, 16, 8); ctx.fill();
      text(ctx, t, ln.x + R - 3, ln.y - R - 8, { size: sz, color: C.heat, align: 'right' });
    }
  }

  function drawCaption() {
    if (L.wide) {
      const x = L.w - 268, y0 = L.lens.y + L.lens.r + 58;
      const lines = [['Measures distance directly:', C.ink], ['a real ruler, not a guess.', C.muted], ['Works in the dark: it brings', C.ink], ['its own light.', C.muted], ['Cannot tell a wall from a person.', C.rose]];
      lines.forEach(([t, c], i) => text(ctx, t, x, y0 + i * 18 + (i > 1 ? 8 : 0) + (i > 3 ? 8 : 0), { size: 12.5, color: c }));
    } else {
      text(ctx, 'Measures distance and works in the dark,', 12, L.h - 26, { size: 11, color: C.muted });
      text(ctx, 'but cannot tell a wall from a person.', 12, L.h - 11, { size: 11, color: C.rose });
    }
  }

  let prevPhase = phase;
  function draw() {
    cv.clear();
    ctx.save(); ctx.beginPath(); ctx.rect(...L.clip); ctx.clip();
    drawRoom(); drawBeam(prevPhase);
    const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    drawDots(paths); drawDrone(); drawLabels();
    ctx.restore();
    drawLens(); drawCaption();
  }

  const loop = kit.loop((dt) => {
    prevPhase = phase;
    const dphi = TAU * S.hz / RATE;
    acc += dt * RATE;
    while (acc >= 1) { acc -= 1; phase += dphi; sample(); }
    draw();
    const ppt = RATE / S.hz;
    rSps.set('8000'); rPpt.set(Math.round(ppt).toString()); rAng.set((360 / ppt).toFixed(2) + '°');
  });
  // pre-fill one turn so the first frame is not empty
  for (let i = 0; i < RATE / S.hz * 1.2; i++) { phase += TAU * S.hz / RATE; sample(); }
  prevPhase = phase; draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

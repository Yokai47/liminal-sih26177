// Optical flow: position is unobservable from an IMU alone. Top-down view of the drone hovering over a floor patch.
// IMU-only: a tiny accelerometer bias integrated twice gives an error of 1/2 b t^2 (metres within a minute).
// IMU + optical flow: the PMW3901 measures how fast the floor texture slides past, the VL53L0X gives the height,
// together a velocity in m/s, so drift stays small. Bad texture makes flow noisy; above 2 m the rangefinder loses
// the floor and the flow loses its scale.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, plot, clamp, gauss } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const SPEED = 3, EP = 60, DT = 0.005, FLOW_DT = 0.05, HALF_FOV = 21 * Math.PI / 180, TOF_MAX = 2.0;
  const BIAS = 0.003, BANG = 0.6, QA = 1e-7, QB = 1e-11;   // accelerometer bias 0.003 m/s^2 (about 0.3 milli-g); filter process noise

  let flowOn = true, q = 0.7, hgt = 1.0;
  const texWord = (v) => v < 15 ? 'bare dusty concrete' : v < 40 ? 'dusty concrete' : v < 70 ? 'some texture' : v < 90 ? 'patterned floor' : 'rich texture';
  kit.toggle(controls, { label: 'Optical flow', options: [{ v: 0, label: 'Off' }, { v: 1, label: 'On' }], value: 1, onChange: (v) => { flowOn = !!v; } });
  kit.slider(controls, { label: 'Floor texture', min: 0, max: 100, step: 1, value: 70, fmt: texWord, onInput: (v) => { q = v / 100; buildTile(); } });
  kit.slider(controls, { label: 'Height', min: .3, max: 2.5, step: .05, value: 1, fmt: (v) => v.toFixed(2) + ' m', onInput: (v) => { hgt = v; } });
  kit.button(controls, { label: 'Take off again', onClick: () => reset() });
  const rI = kit.readout(readouts, { label: 'position error, IMU only', tone: 'danger' });
  const rF = kit.readout(readouts, { label: 'position error, with flow', tone: 'teal' });
  const rH = kit.readout(readouts, { label: 'measured height (ToF)', tone: 'ink' });
  const tones = new Map(), tone = (r, tn) => { if (tones.get(r) !== tn) { tones.set(r, tn); r.tone(tn); } };

  // ---------------------------------------------------------------- truth: a gentle hover wander (a real drone is never still)
  const PX = (t) => .14 * Math.sin(.7 * t) + .05 * Math.sin(1.9 * t + 1), PY = (t) => .11 * Math.sin(.53 * t + 2) + .04 * Math.sin(1.6 * t);
  const VX = (t) => .098 * Math.cos(.7 * t) + .095 * Math.cos(1.9 * t + 1), VY = (t) => .0583 * Math.cos(.53 * t + 2) + .064 * Math.cos(1.6 * t);
  const AX = (t) => -.0686 * Math.sin(.7 * t) - .1805 * Math.sin(1.9 * t + 1), AY = (t) => -.0309 * Math.sin(.53 * t + 2) - .1024 * Math.sin(1.6 * t);
  const bx = BIAS * Math.cos(BANG), by = BIAS * Math.sin(BANG);

  const rnd = kit.rng(3);
  let t, tf, hold, ivx, ivy, ipx, ipy, fvx, fvy, fpx, fpy, bhx, bhy, valid, measH, vmx, vmy, Pvv, Pvb, Pbb, accEma;
  const NH = 260, hT = new Float32Array(NH), hI = new Float32Array(NH), hF = new Float32Array(NH); let nH = 0, hNext = 0, yTop = 1;
  const NA = 36, arN = new Float32Array(NA * 2);   // per-arrow noise, refreshed at the flow rate
  function reset() {
    t = 0; tf = 0; hold = 0; ipx = fpx = PX(0); ipy = fpy = PY(0); ivx = fvx = VX(0); ivy = fvy = VY(0); bhx = bhy = 0;
    valid = false; measH = hgt; vmx = vmy = 0; nH = 0; hNext = 0; yTop = 1; Pvv = 1e-4; Pvb = 0; Pbb = 2.5e-5; accEma = 1;
  }
  reset();

  function flowUpdate() {
    measH = hgt <= TOF_MAX ? hgt + gauss(rnd) * .008 : NaN;
    const sig = (0.015 + 0.25 * (1 - q) * (1 - q)) * hgt, rej = 0.9 * Math.pow(1 - q, 3);
    const good = rnd() > rej;
    vmx = VX(t) + gauss(rnd) * sig; vmy = VY(t) + gauss(rnd) * sig;
    for (let i = 0; i < NA * 2; i++) arN[i] = gauss(rnd) * (good ? sig : sig * 2.5);
    accEma += ((good ? 1 : 0) - accEma) * .12;
    valid = flowOn && good && hgt <= TOF_MAX;
    if (valid) {   // Kalman update on [velocity, accelerometer bias]: trust the flow by how noisy it is vs how unsure we are
      const R = sig * sig, S = Pvv + R, Kv = Pvv / S, Kb = Pvb / S, ix = vmx - fvx, iy = vmy - fvy;
      fvx += Kv * ix; fvy += Kv * iy; bhx += Kb * ix; bhy += Kb * iy;
      const pvb = Pvb; Pbb -= Kb * pvb; Pvb = (1 - Kv) * pvb; Pvv = (1 - Kv) * Pvv;
    }
  }
  function advance(dtSim) {
    const tEnd = Math.min(EP, t + dtSim);
    while (t < tEnd) {
      const axm = AX(t) + bx + gauss(rnd) * .02, aym = AY(t) + by + gauss(rnd) * .02;
      ivx += axm * DT; ivy += aym * DT; ipx += ivx * DT; ipy += ivy * DT;                 // IMU only: integrate twice
      fvx += (axm - bhx) * DT; fvy += (aym - bhy) * DT; fpx += fvx * DT; fpy += fvy * DT;  // fused: same, minus the bias it has learned
      Pvv += -2 * DT * Pvb + DT * DT * Pbb + QA; Pvb -= DT * Pbb; Pbb += QB;
      t += DT; tf += DT;
      if (tf >= FLOW_DT) { tf -= FLOW_DT; flowUpdate(); }
      if (t >= hNext && nH < NH) { hNext += EP / 240; hT[nH] = t; hI[nH] = errI(); hF[nH] = errF(); nH++; }
    }
  }
  const errI = () => Math.hypot(ipx - PX(t), ipy - PY(t)), errF = () => Math.hypot(fpx - PX(t), fpy - PY(t));
  const fmtE = (e) => e < 1 ? Math.round(e * 100) + ' cm' : e.toFixed(2) + ' m';

  // ---------------------------------------------------------------- floor texture tile (1 m square), rebuilt on slider/resize
  const tile = document.createElement('canvas'), tctx = tile.getContext('2d');
  let ppm = 150, tilePx = 150;
  function buildTile() {
    const dpr = cv.dpr || 1; tilePx = Math.max(40, Math.round(ppm));
    tile.width = Math.round(tilePx * dpr); tile.height = tile.width; tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.fillStyle = '#2a2e57'; tctx.fillRect(0, 0, tilePx, tilePx);
    const r = kit.rng(91), n = Math.round(30 + 520 * q), S = tilePx;
    const cols = ['220,214,236', '246,210,177', '143,140,196', '255,195,107'];
    const dot = (x, y, rad, col) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { const X = x + ox, Y = y + oy; if (X < -rad || Y < -rad || X > S + rad || Y > S + rad) continue; tctx.fillStyle = col; tctx.beginPath(); tctx.arc(X, Y, rad, 0, 7); tctx.fill(); } };
    // dust: faint and fine, always there
    for (let i = 0; i < 160; i++) dot(r() * S, r() * S, .4 + r() * .9, `rgba(220,214,236,${(.04 + .05 * r()).toFixed(3)})`);
    // texture: contrast and size grow with the slider
    for (let i = 0; i < n; i++) {
      const a = (0.06 + 0.5 * q * r()).toFixed(3), col = cols[(r() * (1 + q * 3)) | 0];
      dot(r() * S, r() * S, (.6 + r() * (1 + 3.5 * q)) * S / 150, `rgba(${col},${a})`);
    }
    if (q > .45) {   // cracks and seams on a rich floor
      tctx.lineCap = 'round';
      for (let i = 0; i < Math.round(12 * q); i++) {
        let x = r() * S, y = r() * S; tctx.strokeStyle = `rgba(220,214,236,${(.1 + .25 * q * r()).toFixed(3)})`; tctx.lineWidth = .8 + r();
        tctx.beginPath(); tctx.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - .5) * S * .25; y += (r() - .5) * S * .25; tctx.lineTo(x, y); } tctx.stroke();
      }
    }
  }

  // ---------------------------------------------------------------- layout (cached on resize)
  let L = {};
  function layout() {
    const w = cv.w, h = cv.h, phone = w < 600;
    if (phone) {
      const m = 12, S = Math.min(w - 142 - m, h * .6);
      L = { phone, m, fv: { x: m, y: 10, w: S, h: S }, side: { x: m + S + 10, y: 116, w: w - m - S - 10 - m, h: S + 10 - 116 }, ch: { x: m - 2, y: S + 18, w: w - 2 * m + 4, h: h - S - 24 } };
    } else {
      const m = 24, S = Math.min(h - 40, w * .54);
      const rx = m + S + 22, rw = w - rx - m;
      L = { phone, m, fv: { x: m, y: 20, w: S, h: S }, side: { x: rx, y: 20, w: Math.max(120, w - 266 - rx), h: 180 }, ch: { x: rx, y: 214, w: rw, h: Math.min(h - 234, 330) } };
    }
    ppm = L.fv.w / (phone ? 2.9 : 3.4); buildTile();
  }
  cv.onResize(layout); layout();

  function arrow(x0, y0, dx, dy, col, lw) {
    const L2 = Math.hypot(dx, dy); if (L2 < 1.5) { ctx.fillStyle = col; ctx.fillRect(x0 - 1, y0 - 1, 2, 2); return; }
    const ux = dx / L2, uy = dy / L2, x1 = x0 + dx, y1 = y0 + dy, hs = Math.min(5, L2 * .5);
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.moveTo(x1 - ux * hs - uy * hs * .6, y1 - uy * hs + ux * hs * .6); ctx.lineTo(x1, y1); ctx.lineTo(x1 - ux * hs + uy * hs * .6, y1 - uy * hs - ux * hs * .6); ctx.stroke();
  }
  function droneTop(cx, cy, s) {
    ctx.strokeStyle = C.heat; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s); ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s); ctx.stroke();
    ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,195,107,.75)';
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.beginPath(); ctx.arc(cx + a * s, cy + b * s, s * .62, 0, 7); ctx.stroke(); }
    ctx.fillStyle = C.heat; roundRect(ctx, cx - s * .38, cy - s * .38, s * .76, s * .76, 3); ctx.fill();
  }
  function marker(fv, cx, cy, ex, ey, col, label, labelBelow, avoid) {
    // ex, ey: estimate offset from truth in metres; clamp to the view edge with an arrow if it has left
    let X = cx + ex * ppm, Y = cy + ey * ppm; const pad = 16, inside = X > fv.x + pad && X < fv.x + fv.w - pad && Y > fv.y + pad && Y < fv.y + fv.h - pad;
    if (!inside) { const k = Math.min(Math.abs((fv.w / 2 - pad) / (X - cx || 1e-6)), Math.abs((fv.h / 2 - pad) / (Y - cy || 1e-6))); X = cx + (X - cx) * k; Y = cy + (Y - cy) * k; }
    ctx.setLineDash([4, 4]); ctx.strokeStyle = col; ctx.globalAlpha = .7; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(X, Y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (inside) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, Y, 8, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(X - 3, Y); ctx.lineTo(X + 3, Y); ctx.moveTo(X, Y - 3); ctx.lineTo(X, Y + 3); ctx.stroke(); }
    else { const a = Math.atan2(Y - cy, X - cx); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(X + Math.cos(a) * 9, Y + Math.sin(a) * 9); ctx.lineTo(X + Math.cos(a + 2.4) * 8, Y + Math.sin(a + 2.4) * 8); ctx.lineTo(X + Math.cos(a - 2.4) * 8, Y + Math.sin(a - 2.4) * 8); ctx.closePath(); ctx.fill(); }
    ctx.font = `500 11px ${F.sans}`; const tw = ctx.measureText(label).width;
    let lx = clamp(X - tw / 2, fv.x + 6, fv.x + fv.w - tw - 6), ly = labelBelow ? Y + 24 : Y - 14; ly = clamp(ly, fv.y + 16, fv.y + fv.h - 8);
    if (avoid && lx < avoid[0] + avoid[2] + 4 && lx + tw > avoid[0] - 4 && Math.abs(ly - avoid[1]) < 19) ly = avoid[1] + (ly >= avoid[1] && avoid[1] + 19 < fv.y + fv.h - 8 ? 19 : -19);
    ctx.fillStyle = 'rgba(27,30,61,.82)'; roundRect(ctx, lx - 5, ly - 12, tw + 10, 17, 6); ctx.fill();
    text(ctx, label, lx, ly, { size: 11, color: col, weight: 500 });
    return [lx, ly, tw];
  }

  function draw() {
    const w = cv.w, h = cv.h, { phone, fv, side, ch } = L; cv.clear();
    const tx = PX(t), ty = PY(t);
    // --- the floor patch, sliding under a drone that stays centred
    ctx.save(); roundRect(ctx, fv.x, fv.y, fv.w, fv.h, 12); ctx.clip();
    const ox = ((-tx * ppm) % tilePx + tilePx) % tilePx, oy = ((-ty * ppm) % tilePx + tilePx) % tilePx;
    for (let yy = fv.y - tilePx + oy; yy < fv.y + fv.h; yy += tilePx) for (let xx = fv.x - tilePx + ox; xx < fv.x + fv.w; xx += tilePx) ctx.drawImage(tile, xx, yy, tilePx, tilePx);
    const cx = fv.x + fv.w / 2, cy = fv.y + fv.h / 2;
    // sensor footprint: 42 degree view, side = 2 h tan 21; the floor outside it is dimmed
    const inRange = hgt <= TOF_MAX, half = Math.min(hgt * Math.tan(HALF_FOV) * ppm, fv.w / 2 - 6);
    ctx.fillStyle = 'rgba(27,30,61,.5)'; ctx.beginPath(); ctx.rect(fv.x, fv.y, fv.w, fv.h); ctx.rect(cx - half, cy - half, half * 2, half * 2); ctx.fill('evenodd');
    ctx.fillStyle = inRange ? 'rgba(127,212,207,.07)' : 'rgba(240,138,126,.06)'; ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
    ctx.strokeStyle = inRange ? (flowOn ? 'rgba(127,212,207,.7)' : 'rgba(243,238,242,.3)') : 'rgba(240,138,126,.65)'; ctx.lineWidth = 1.3; ctx.setLineDash(inRange ? [] : [5, 4]);
    ctx.strokeRect(cx - half, cy - half, half * 2, half * 2); ctx.setLineDash([]);
    // flow vectors: the floor appears to move opposite to the drone
    const poor = accEma < .6, n = phone ? 4 : 6, gain = (phone ? 90 : 130) * (ppm / 150), arCol = !flowOn ? 'rgba(243,238,242,.28)' : !inRange ? 'rgba(143,140,196,.7)' : poor ? 'rgba(239,177,180,.75)' : q < .45 ? C.apricot : C.teal;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const k = (i * n + j) % NA, ax = cx - half + (i + .5) * half * 2 / n, ay = cy - half + (j + .5) * half * 2 / n;
      const dx = clamp(-(vmx + arN[2 * k]) * gain, -half / n * 1.6, half / n * 1.6), dy = clamp(-(vmy + arN[2 * k + 1]) * gain, -half / n * 1.6, half / n * 1.6);
      arrow(ax - dx / 2, ay - dy / 2, dx, dy, arCol, 1.4);
    }
    ctx.restore();
    // footprint label
    const fl = !inRange ? (phone ? 'no floor in range: flow has no scale' : 'rangefinder cannot see the floor: flow has no scale') : !flowOn ? 'flow sensor ignored' : !poor ? (q < .45 ? 'faint texture: noisy flow' : '42° flow sensor view') : 'texture too poor: most frames rejected';
    ctx.font = `500 11px ${F.sans}`; const flw = ctx.measureText(fl).width, fly = Math.max(fv.y + 18, cy - half - 8), flx = clamp(cx - flw / 2, fv.x + 8, fv.x + fv.w - flw - 8);
    ctx.fillStyle = 'rgba(27,30,61,.82)'; roundRect(ctx, flx - 5, fly - 12, flw + 10, 17, 6); ctx.fill();
    text(ctx, fl, flx, fly, { size: 11, color: !inRange || (flowOn && (poor || q < .45)) ? C.rose : C.teal, weight: 500 });
    // drone and the two estimates
    droneTop(cx, cy, phone ? 9 : 12);
    if (Math.hypot(ipx - fpx, ipy - fpy) * ppm < 22) marker(fv, cx, cy, ipx - tx, ipy - ty, C.danger, phone ? 'both estimates' : 'both estimates: no usable flow', false);
    else {
      const lr = marker(fv, cx, cy, ipx - tx, ipy - ty, C.danger, phone ? 'IMU only' : 'IMU only thinks it is here', false);
      marker(fv, cx, cy, fpx - tx, fpy - ty, C.teal, flowOn ? 'IMU + flow' : 'estimate (flow off)', true, lr);
    }
    text(ctx, 'top view · 1 m', fv.x + 12, fv.y + fv.h - 12, { size: 11, color: C.faint });
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(fv.x + 12, fv.y + fv.h - 26); ctx.lineTo(fv.x + 12 + ppm, fv.y + fv.h - 26); ctx.stroke();

    // --- side view: height, 42 degree cone, rangefinder beam (max 2 m)
    if (side.w > 60 && side.h > 70) {
      const s = side; ctx.fillStyle = C.panel; roundRect(ctx, s.x, s.y, s.w, s.h, 10); ctx.fill();
      const floorY = s.y + s.h - 14, zp = (s.h - 40) / 2.6, dX = s.x + s.w * .5, dY = floorY - hgt * zp;
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s.x + 8, floorY); ctx.lineTo(s.x + s.w - 8, floorY); ctx.stroke();
      const maxY = floorY - (hgt - TOF_MAX) * zp;   // where the 2 m beam ends
      ctx.strokeStyle = 'rgba(127,212,207,.35)'; ctx.setLineDash([3, 3]);
      const spread = Math.tan(HALF_FOV) * hgt * zp; ctx.beginPath(); ctx.moveTo(dX, dY); ctx.lineTo(dX - spread, floorY); ctx.moveTo(dX, dY); ctx.lineTo(dX + spread, floorY); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = inRange ? C.teal : C.danger; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(dX, dY + 4); ctx.lineTo(dX, inRange ? floorY : maxY); ctx.stroke();
      if (!inRange) { ctx.beginPath(); ctx.moveTo(dX - 5, maxY); ctx.lineTo(dX + 5, maxY); ctx.stroke(); }
      ctx.strokeStyle = C.heat; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(dX - 16, dY); ctx.lineTo(dX + 16, dY); ctx.stroke();
      ctx.fillStyle = C.heat; ctx.fillRect(dX - 5, dY - 3, 10, 6);
      const lim = floorY - TOF_MAX * zp; ctx.strokeStyle = 'rgba(240,138,126,.45)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(s.x + 8, lim); ctx.lineTo(s.x + s.w - 8, lim); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, phone ? '2 m limit' : 'ToF limit 2 m', s.x + 8, hgt < TOF_MAX - .25 || hgt > TOF_MAX + .3 ? (hgt > TOF_MAX ? lim + 13 : lim - 4) : lim + 13, { size: 11, color: 'rgba(239,177,180,.8)' });
      text(ctx, 'side view', s.x + 8, s.y + 15, { size: 11, color: C.faint });
      text(ctx, inRange ? hgt.toFixed(1) + ' m' : '> 2 m', dX + 8, (dY + (inRange ? floorY : maxY)) / 2 + 4, { size: 11, color: inRange ? C.teal : C.danger, font: F.mono });
    }

    // --- chart: error vs time since take-off
    const top = Math.max(.5, yTop);
    const P = plot(ctx, ch, [], { xMin: 0, xMax: EP, yMin: 0, yMax: top, yLabel: phone ? 'position error' : 'position error since take-off', xLabel: (phone ? '' : 'time, ') + '60 s (shown 3× faster)' });
    const step = top > 4 ? 2 : top > 2 ? 1 : top > 1 ? .5 : .25;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let v = step; v < top; v += step) { const Y = P.py(v); ctx.beginPath(); ctx.moveTo(ch.x + 14, Y); ctx.lineTo(ch.x + ch.w - 14, Y); ctx.stroke(); text(ctx, (v < 1 ? v * 100 + ' cm' : v + ' m'), ch.x + ch.w - 16, Y - 3, { size: 11, color: C.faint, align: 'right', font: F.mono }); }
    ctx.save(); ctx.beginPath(); ctx.rect(ch.x + 14, ch.y + 10, ch.w - 28, ch.h - 30); ctx.clip(); ctx.lineJoin = 'round';
    for (const [arr, col] of [[hI, C.danger], [hF, C.teal]]) {
      ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.beginPath();
      for (let i = 0; i < nH; i++) { const X = P.px(hT[i]), Y = P.py(arr[i]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.stroke();
    }
    ctx.restore();
    if (nH > 4) {
      const li = nH - 1, xI = P.px(hT[li]); let yI = Math.max(ch.y + 28, P.py(hI[li]) - 6), yF = Math.min(P.py(hF[li]) - 6, ch.y + ch.h - 30);
      if (Math.abs(yI - yF) < 14) { const mid = (yI + yF) / 2, up = hI[li] >= hF[li]; yI = mid + (up ? -7 : 7); yF = mid + (up ? 7 : -7); }
      const right = xI < ch.x + ch.w - 120;
      text(ctx, 'IMU only (½ b t²)', right ? xI + 6 : xI - 6, yI, { size: 11, color: C.danger, align: right ? 'left' : 'right' });
      text(ctx, flowOn ? 'with flow' : 'flow off', right ? xI + 6 : xI - 6, yF, { size: 11, color: C.teal, align: right ? 'left' : 'right' });
    }
    if (t >= EP) text(ctx, 'one minute: restarting…', ch.x + 20, ch.y + 44, { size: 12, color: C.muted });
  }

  const loop = kit.loop((dt) => {
    if (t >= EP) { hold += dt; if (hold > 2.2) reset(); }
    else advance(dt * SPEED);
    const eI = errI(), eF = errF(); yTop = Math.max(yTop * .999, eI * 1.15, eF * 1.15, .5);
    draw();
    rI.set(fmtE(eI)); rF.set(fmtE(eF)); tone(rF, eF > .25 ? 'danger' : eF > .1 ? 'apricot' : 'teal');
    rH.set(Number.isNaN(measH) ? 'out of range' : measH.toFixed(2) + ' m'); tone(rH, Number.isNaN(measH) ? 'danger' : 'ink');
  });
  draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

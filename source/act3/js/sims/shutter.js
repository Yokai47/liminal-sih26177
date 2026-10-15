// Global vs rolling shutter: two cameras film the same moment, a spinning propeller in front of a wall with poles,
// while the drone yaws. The rolling sensor reads its rows one after another, so each row sees a slightly later
// instant: the blades bend and the poles lean. The global-shutter AR0234 reads every row at once. Frames are rendered
// pixel by pixel into small 200 x 150 images (at most 30 per second) and scaled up crisply. A small pinhole diagram
// shows the other limit of a camera: dividing by depth throws depth away.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const IW = 200, IH = 150, FX = 173, CX = 100, HOR = 104;                 // FX: about a 60 degree field of view
  const S = { rpm: 1200, T: 20, yaw: 120 };
  kit.slider(controls, { label: 'Prop speed', min: 0, max: 6000, step: 100, value: S.rpm, fmt: (v) => v + ' rpm', onInput: (v) => { S.rpm = v; dirty = true; } });
  kit.slider(controls, { label: 'Rolling readout time', min: 0, max: 33, step: 1, value: S.T, fmt: (v) => v + ' ms', onInput: (v) => { S.T = v; dirty = true; } });
  kit.slider(controls, { label: 'Drone turn rate', min: 0, max: 360, step: 10, value: S.yaw, fmt: (v) => v + '°/s', onInput: (v) => { S.yaw = v; dirty = true; } });
  const rRoll = kit.readout(readouts, { label: 'pole lean, rolling shutter', tone: 'rose' });
  const rGlob = kit.readout(readouts, { label: 'pole lean, global shutter', tone: 'teal' });
  const rGap = kit.readout(readouts, { label: 'top row to bottom row', tone: 'heat' });

  // ---------------------------------------------------------------- offscreen frames, allocated once
  const mk = () => { const c = document.createElement('canvas'); c.width = IW; c.height = IH; const g = c.getContext('2d'); const im = g.createImageData(IW, IH); return { c, g, im, px: new Uint32Array(im.data.buffer) }; };
  const FR = [mk(), mk()];                                                     // 0 rolling, 1 global
  const rgb = (h, a = 255) => { const n = parseInt(h.slice(1), 16); return ((a << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | (n >> 16)) >>> 0; };
  const mix = (a, b, t) => { const p = parseInt(a.slice(1), 16), q = parseInt(b.slice(1), 16); const ch = (s) => Math.round(((p >> s) & 255) * (1 - t) + ((q >> s) & 255) * t); return ((255 << 24) | (ch(0) << 16) | (ch(8) << 8) | ch(16)) >>> 0; };
  const WALL = [], FLOOR = [];
  for (let v = 0; v < IH; v++) { WALL.push(mix('#3a3e70', '#2c2f5c', v / HOR)); FLOOR.push(mix('#22254a', '#30335f', (v - HOR) / (IH - HOR))); }
  const POLE = rgb('#F6D2B1'), POLE_SH = rgb('#d9ae8c'), DOOR = rgb('#191b38'), FRAMEC = rgb('#6d6aa8'), BLADE = rgb('#DCE4EE'), HUB = rgb('#FFC36B');
  // the propeller: hub position, radius, and per-pixel polar coordinates (precomputed)
  const HX = 64, HY = 92, PR = 54, BX0 = HX - PR, BY0 = HY - PR, BW = PR * 2 + 1, BH = Math.min(IH - BY0, PR * 2 + 1);
  const pa = new Float32Array(BW * BH), pr = new Float32Array(BW * BH), hw = new Float32Array(BW * BH);
  for (let j = 0; j < BH; j++) for (let i = 0; i < BW; i++) {
    const dx = BX0 + i + .5 - HX, dy = BY0 + j + .5 - HY, r = Math.hypot(dx, dy), k = j * BW + i;
    pr[k] = r; pa[k] = Math.atan2(dy, dx);
    const width = r < 14 ? 3 + r * .25 : 6.5 - (r - 14) * .045;                  // a blade a little wider near the root
    hw[k] = Math.atan(width / Math.max(r, 1));
  }

  let psi0 = 0, prop0 = 0, frameT = 0, dirty = true, cur = null;
  // anti-aliased painting: blend packed colours, paint a fractional span [a, b) of one row
  function blend(p, q, t) {
    const r1 = p & 255, g1 = (p >>> 8) & 255, b1 = (p >>> 16) & 255, r2 = q & 255, g2 = (q >>> 8) & 255, b2 = (q >>> 16) & 255;
    return ((255 << 24) | (((b1 + (b2 - b1) * t) | 0) << 16) | (((g1 + (g2 - g1) * t) | 0) << 8) | ((r1 + (r2 - r1) * t) | 0)) >>> 0;
  }
  function span(row, a, b, col) {
    if (b <= 0 || a >= IW) return;
    const ia = Math.floor(a), ib = Math.floor(b);
    if (ia === ib) { if (ia >= 0) cur[row + ia] = blend(cur[row + ia], col, b - a); return; }
    if (ia >= 0) cur[row + ia] = blend(cur[row + ia], col, 1 - (a - ia));
    for (let u = Math.max(0, ia + 1), e = Math.min(IW, ib); u < e; u++) cur[row + u] = col;
    if (ib < IW && b > ib) cur[row + ib] = blend(cur[row + ib], col, b - ib);
  }
  function render(f, rolling) {
    const px = f.px, T = rolling ? S.T / 1000 : 0, w = S.yaw * Math.PI / 180, om = S.rpm * Math.PI / 30;
    const Q = Math.PI / 2; cur = px;
    for (let v = 0; v < IH; v++) {
      const tv = T * v / (IH - 1), psi = psi0 + w * tv, row = v * IW;
      const bg = v < HOR ? WALL[v] : FLOOR[v];
      for (let u = 0; u < IW; u++) px[row + u] = bg;
      // vertical features at fixed azimuths: a pole every 90 degrees, a doorway between them
      const kA = Math.floor((psi - CX / FX) / Q) - 1, kB = Math.ceil((psi + (IW - CX) / FX) / Q) + 1;
      for (let k = kA; k <= kB; k++) {
        const uc = CX + (k * Q - psi) * FX, ud = uc + Q * FX / 2;
        if (v > 18 && v < HOR + 2) { span(row, ud - 17, ud + 17, FRAMEC); if (v > 22) span(row, ud - 14, ud + 14, DOOR); }
        span(row, uc - 4, uc + 1, POLE); span(row, uc + 1, uc + 4, POLE_SH);
      }
      // propeller
      const j = v - BY0;
      if (j >= 0 && j < BH) {
        const a = prop0 + om * tv;
        for (let i = 0; i < BW; i++) {
          const u = BX0 + i; if (u < 0 || u >= IW) continue;
          const k = j * BW + i, r = pr[k]; if (r > PR + .5) continue;
          if (r < 5) { px[row + u] = HUB; continue; }
          let d = pa[k] - a; d -= Math.PI * Math.round(d / Math.PI); if (d < 0) d = -d;
          const e = (hw[k] - d) * r + .5;
          if (e <= 0) continue;
          const cov = Math.min(1, e) * Math.min(1, PR + .5 - r);
          px[row + u] = cov >= 1 ? BLADE : blend(px[row + u], BLADE, cov);
        }
      }
    }
    f.g.putImageData(f.im, 0, 0);
  }

  // ---------------------------------------------------------------- layout
  let L = null;
  function layout() {
    const w = cv.w, h = cv.h, wide = w > 640, g = wide ? 20 : 10;
    let fw, fy, fx0, gap, tb;
    if (wide) { tb = 46; gap = 28; const band = 196; fw = Math.min((w - 2 * g - gap - tb) / 2, (h - band - 64) * IW / IH); fy = band; fx0 = g + tb + ((w - 2 * g - gap - tb) - 2 * fw) / 2; }
    else { tb = 0; gap = 10; fw = (w - 2 * g - gap) / 2; fy = 140; fx0 = g; }
    const fh = fw * IH / IW;
    L = { w, h, wide, g, fw, fh, fy, gap, fr: [fx0, fx0 + fw + gap], tb };
  }
  cv.onResize(layout); layout();

  function poleLeanPx() { return FX * (S.yaw * Math.PI / 180) * (S.T / 1000); }

  function drawFrame(i) {
    const x = L.fr[i], y = L.fy, fw = L.fw, fh = L.fh, sc = fw / IW, sz = L.wide ? 12 : 10.5;
    ctx.save(); kit.roundRect(ctx, x, y, fw, fh, 8); ctx.clip();
    ctx.imageSmoothingEnabled = sc < 1; ctx.drawImage(FR[i].c, x, y, fw, fh); ctx.imageSmoothingEnabled = true;
    // dashed truth line through the bottom of the pole nearest the middle: a straight pole would follow it
    const T = i === 0 ? S.T / 1000 : 0, w = S.yaw * Math.PI / 180, Q = Math.PI / 2, psiB = psi0 + w * T;
    const k = Math.round((psiB - (60 - CX) / FX) / Q), ub = CX + (k * Q - psiB) * FX + .5;
    if (ub > 6 && ub < IW - 6) {
      ctx.strokeStyle = 'rgba(243,238,242,.55)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x + ub * sc, y + 2); ctx.lineTo(x + ub * sc, y + fh - 2); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    ctx.strokeStyle = i === 0 ? 'rgba(239,177,180,.55)' : 'rgba(127,212,207,.55)'; ctx.lineWidth = 1.2; kit.roundRect(ctx, x, y, fw, fh, 8); ctx.stroke();
    // titles
    const t1 = i === 0 ? 'Rolling shutter' : 'Global shutter (AR0234)', t2 = i === 0 ? 'rows read one after another' : 'every row at the same instant';
    text(ctx, t1, x, y - (L.wide ? 26 : 20), { size: L.wide ? 13.5 : 11.5, color: i === 0 ? C.rose : C.teal, weight: 500 });
    text(ctx, t2, x, y - (L.wide ? 9 : 6), { size: sz - .5, color: C.faint });
    // under the frame: what the bent pole means
    const lean = i === 0 ? Math.atan(poleLeanPx() / IH) * 180 / Math.PI : 0;
    const t3 = i === 0 ? (L.wide ? `pole leans ${lean.toFixed(1)}°, blades bend: the image mixes ${S.T} ms of motion` : `pole leans ${lean.toFixed(1)}°`) : (L.wide ? 'pole straight, blades straight: one instant, one position' : 'straight: one instant');
    text(ctx, t3, x, y + fh + (L.wide ? 20 : 15), { size: sz, color: i === 0 ? C.rose : C.teal });
  }

  function drawTimeBar() {
    const x = L.fr[0] - 18, y0 = L.fy + 2, y1 = L.fy + L.fh - 2;
    ctx.strokeStyle = 'rgba(255,195,107,.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 4, y1 - 7); ctx.lineTo(x, y1); ctx.lineTo(x + 4, y1 - 7); ctx.stroke();
    for (const [yy, s] of [[y0, '0'], [y1, String(S.T)]]) { ctx.beginPath(); ctx.moveTo(x - 4, yy); ctx.lineTo(x + 4, yy); ctx.stroke(); text(ctx, s, x - 8, yy + 4, { size: 11, color: C.heat, font: F.mono, align: 'right' }); }
    text(ctx, 'ms', x - 8, y1 + 18, { size: 10.5, color: C.faint, align: 'right' });
    ctx.save(); ctx.translate(x - 12, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2); text(ctx, 'when each row is read', 0, 0, { size: 11, color: C.faint, align: 'center' }); ctx.restore();
  }

  // the pinhole: u = fx * X / Z + cx. A small near object and a large far one land on the same pixel.
  function drawPinhole() {
    const wide = L.wide, g = L.g;
    const fs = wide ? 15 : 12;
    text(ctx, 'u = fx · X / Z + cx', g + 4, wide ? 38 : 24, { size: fs, color: C.ink, font: F.mono });
    const ls = wide ? 12.5 : 10.5, lh = wide ? 18 : 15, ly = wide ? 64 : 44;
    text(ctx, 'Dividing by Z throws away depth:', g + 4, ly, { size: ls, color: C.muted });
    text(ctx, wide ? 'a small near object and a large far one' : 'small and near, large and far:', g + 4, ly + lh, { size: ls, color: C.muted });
    text(ctx, wide ? 'land on the same pixel.' : 'the same pixel.', g + 4, ly + 2 * lh, { size: ls, color: C.muted });
    // diagram box
    const x0 = wide ? g + 300 : g + 4, x1 = wide ? Math.min(L.w - 290, x0 + 470) : L.w - g - 4;
    const top = wide ? 30 : L.fy + L.fh + 30, yA = wide ? 120 : Math.min(L.h - 26, top + 64);
    const ip = x0 + 6, ph = x0 + (wide ? 46 : 26), zN = ph + (x1 - ph) * .36, zF = x1 - 6, hN = (yA - top) * .3, hF = hN * (zF - ph) / (zN - ph);
    const hit = yA + (ph - ip) * hN / (zN - ph);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(243,238,242,.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ip - 2, yA); ctx.lineTo(x1, yA); ctx.stroke();
    // image plane and pinhole
    ctx.strokeStyle = 'rgba(143,140,196,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ip, yA - hN * .9); ctx.lineTo(ip, yA + hN * 1.2); ctx.stroke();
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(ph, yA, 2.5, 0, 7); ctx.fill();
    // rays from both tops through the pinhole to one pixel
    ctx.strokeStyle = 'rgba(255,195,107,.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(zF, yA - hF); ctx.lineTo(ip, hit); ctx.stroke();
    // objects
    const arrow = (x, hgt, col) => { ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(x, yA); ctx.lineTo(x, yA - hgt); ctx.stroke(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, yA - hgt, 3, 0, 7); ctx.fill(); };
    arrow(zN, hN, C.teal); arrow(zF, hF, C.apricot);
    ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(ip, hit, 3.2, 0, 7); ctx.fill();
    const sz = wide ? 11.5 : 9.5;
    text(ctx, 'small, near', zN, yA + (wide ? 15 : 12), { size: sz, color: C.teal, align: 'center' });
    text(ctx, 'large, far', zF, yA + (wide ? 15 : 12), { size: sz, color: C.apricot, align: 'right' });
    text(ctx, 'same pixel', ip + 6, hit + (wide ? 14 : 12), { size: sz, color: C.heat });
    if (wide) text(ctx, 'pinhole', ph, yA - 8, { size: 10.5, color: C.faint, align: 'center' });
  }

  function draw() {
    cv.clear();
    drawPinhole();
    drawFrame(0); drawFrame(1);
    if (L.wide) drawTimeBar();
  }

  const loop = kit.loop((dt) => {
    frameT += dt;
    if (frameT < 1 / 30 && !dirty) return;                                     // camera frames at 30 per second
    const step = Math.min(frameT, .1); frameT = 0; dirty = false;
    psi0 += S.yaw * Math.PI / 180 * step;
    if (S.rpm > 0) prop0 += .07;                                               // stroboscopic: show a slow apparent turn between frames
    render(FR[0], true); render(FR[1], false);
    draw();
    const lean = Math.atan(poleLeanPx() / IH) * 180 / Math.PI;
    rRoll.set(lean.toFixed(1) + '°'); rGlob.set('0.0°'); rGap.set(S.T + ' ms');
  });
  render(FR[0], true); render(FR[1], false); draw();
  cv.onResize(() => draw());
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

// Patterns nobody drew: Gray-Scott reaction-diffusion (Turing 1952), ported from the team's Layer 2 sim (tab 2):
// same diffusion rates (Du 0.16, Dv 0.08, dt 1) and the same F/k presets, here on a periodic grid with a 9-point Laplacian.
//   du/dt = Du ∇²u − u v² + F (1 − u)        v = the activator: u + 2v → 3v, it makes more of itself
//   dv/dt = Dv ∇²v + u v² − (F + k) v        u = the chemical it feeds on, which spreads twice as fast and limits it
// Nothing in the equations says where a spot goes, yet spots appear at a characteristic spacing (∝ sqrt(D)).
// 24 drones climb the gradient of a Gaussian-blurred v and push each other away at short range: they settle one per
// spot, at the pattern's own spacing. Nobody assigns a position.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F: FONT, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  cv.cv.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------ chemistry (team's parameters)
  const PRESET = { spots: { f: .030, k: .062 }, worms: { f: .038, k: .061 }, coral: { f: .078, k: .061 } };
  const DU = .16, DV = .08, ITER = 8;                  // 8 Euler steps (dt = 1) per frame
  let preset = 'spots', feed = PRESET.spots.f, kill = PRESET.spots.k, scale = 1;
  let GW = 0, GH = 0, W = 0, NP = 0, sx = 4.5, sy = 4.5;
  let U = null, V = null, cur = 0, off = null, octx = null, img = null, img32 = null;
  const R = Math.random;

  function alloc() {
    const w = cv.w, h = cv.h, cell = clamp(w / 200, 3.4, 6);
    const gw = Math.max(40, Math.round(w / cell)), gh = Math.max(30, Math.round(h / cell));
    sx = w / gw; sy = h / gh;
    if (gw === GW && gh === GH) return false;
    GW = gw; GH = gh; W = GW + 2; NP = W * (GH + 2);   // one ghost cell all round for the periodic wrap
    U = [new Float32Array(NP), new Float32Array(NP)]; V = [new Float32Array(NP), new Float32Array(NP)]; cur = 0;
    off = document.createElement('canvas'); off.width = GW; off.height = GH;
    octx = off.getContext('2d'); img = octx.createImageData(GW, GH); img32 = new Uint32Array(img.data.buffer);
    return true;
  }
  function blob(cx, cy, r) {
    const u = U[cur], v = V[cur];
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r + 1) continue;
      const px = ((Math.round(cx) + x) % GW + GW) % GW, py = ((Math.round(cy) + y) % GH + GH) % GH, i = (py + 1) * W + px + 1;
      u[i] = .5; v[i] = .25 + R() * .05;
    }
  }
  function seed() {
    U[cur].fill(1); V[cur].fill(0);
    const big = preset === 'coral', n = Math.round(GW * GH / (big ? 420 : 156));
    for (let s = 0; s < n; s++) blob(R() * GW, R() * GH, big ? 5 : 2 + (R() * 2 | 0));
    flatN = 0;
  }
  function wrap(a) {
    for (let y = 1; y <= GH; y++) { const r = y * W; a[r] = a[r + GW]; a[r + GW + 1] = a[r + 1]; }
    a.copyWithin(0, GH * W, GH * W + W); a.copyWithin((GH + 1) * W, W, 2 * W);
  }
  function react(n) {
    const du = DU * scale / 6, dv = DV * scale / 6, f = feed, fk = feed + kill;   // the /6 belongs to the 9-point stencil
    for (let it = 0; it < n; it++) {
      const u = U[cur], v = V[cur], u2 = U[cur ^ 1], v2 = V[cur ^ 1];
      wrap(u); wrap(v);
      for (let y = 1; y <= GH; y++) {
        let i = y * W + 1; const e = i + GW;
        for (; i < e; i++) {
          const uc = u[i], vc = v[i];
          const lu = 4 * (u[i - 1] + u[i + 1] + u[i - W] + u[i + W]) + (u[i - W - 1] + u[i - W + 1] + u[i + W - 1] + u[i + W + 1]) - 20 * uc;
          const lv = 4 * (v[i - 1] + v[i + 1] + v[i - W] + v[i + W]) + (v[i - W - 1] + v[i - W + 1] + v[i + W - 1] + v[i + W + 1]) - 20 * vc;
          const uvv = uc * vc * vc;
          u2[i] = uc + du * lu - uvv + f * (1 - uc);
          v2[i] = vc + dv * lv + uvv - fk * vc;
        }
      }
      cur ^= 1;
    }
  }
  // set the cells within r cells of (cx, cy) back to the plain state u = 1, v = 0
  function wipe(cx, cy, r) {
    const u = U[cur], v = V[cur], r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const ddx = x + .5 - cx, ddy = y + .5 - cy; if (ddx * ddx + ddy * ddy > r2) continue;
      const px = (x % GW + GW) % GW, py = (y % GH + GH) % GH, i = (py + 1) * W + px + 1; u[i] = 1; v[i] = 0;
    }
  }

  // ------------------------------------------------------------ colour ramp: bg -> dusk -> teal -> mist
  const LUT = new Uint32Array(256), VMAX = .46;
  {
    const stops = [[0, [27, 30, 61]], [.3, [74, 75, 134]], [.68, [127, 212, 207]], [1, [220, 228, 238]]];
    for (let i = 0; i < 256; i++) {
      const t = i / 255; let a = stops[0], b = stops[1];
      for (let s = 1; s < stops.length; s++) { if (t <= stops[s][0]) { a = stops[s - 1]; b = stops[s]; break; } }
      const q = (t - a[0]) / (b[0] - a[0] || 1), e = q * q * (3 - 2 * q);
      const r = Math.round(a[1][0] + (b[1][0] - a[1][0]) * e), g = Math.round(a[1][1] + (b[1][1] - a[1][1]) * e), bl = Math.round(a[1][2] + (b[1][2] - a[1][2]) * e);
      LUT[i] = ((255 << 24) | (bl << 16) | (g << 8) | r) >>> 0;
    }
  }
  function paint() {
    const v = V[cur], k255 = 255 / VMAX; let k = 0;
    for (let y = 1; y <= GH; y++) {
      let i = y * W + 1;
      for (let x = 0; x < GW; x++, i++) { let t = (v[i] * k255) | 0; if (t > 255) t = 255; else if (t < 0) t = 0; img32[k++] = LUT[t]; }
    }
    octx.putImageData(img, 0, 0);
  }

  // ------------------------------------------------------------ drones: gradient ascent on blurred v + short-range repulsion
  // Each drone only senses the field around it and the drones near it. Rules: climb toward more v; keep REP cells from
  // other drones; and if there is no spot under you, drift away from the crowd (that is where the free spots are).
  const ND = 24, SIG = 1.6, KW = 5, K2 = 1 / (2 * SIG * SIG), GN = 1 / (TAU * SIG * SIG * SIG * SIG), BN = 1 / (TAU * SIG * SIG);
  const REP = 9, KREP = 500, KG = 900, DAMP = 3.2, VMAXD = 18;            // cells, cells/s², cells/s
  const CROWD = 22, KC = 60, BTH = .07, NOISE = 40, GFLAT = .02;          // "no spot under me": give way within CROWD cells
  const px = new Float32Array(ND), py = new Float32Array(ND), pvx = new Float32Array(ND), pvy = new Float32Array(ND);
  const fx = new Float32Array(ND), fy = new Float32Array(ND), lone = new Float32Array(ND), wx = new Float32Array(2 * KW + 1), wy = new Float32Array(2 * KW + 1);
  const nn = new Float32Array(ND);
  let dronesOn = 1;
  function release() {
    for (let i = 0; i < ND; i++) {
      const a = R() * TAU, r = R() * 2.5; px[i] = GW / 2 + Math.cos(a) * r; py[i] = GH / 2 + Math.sin(a) * r;
      pvx[i] = Math.cos(a) * 4; pvy[i] = Math.sin(a) * 4;
    }
  }
  // the Gaussian-blurred field B at a drone and its exact gradient: grad B = sum v_c (c - p) G(p - c) / sigma²
  function sense(i) {
    const v = V[cur], x = px[i], y = py[i], x0 = Math.floor(x), y0 = Math.floor(y);
    for (let j = -KW; j <= KW; j++) { const rx = x0 + j + .5 - x, ry = y0 + j + .5 - y; wx[j + KW] = Math.exp(-rx * rx * K2); wy[j + KW] = Math.exp(-ry * ry * K2); }
    let gx = 0, gy = 0, b = 0;
    for (let j = -KW; j <= KW; j++) {
      let yy = y0 + j; if (yy < 0) yy += GH; else if (yy >= GH) yy -= GH;
      const row = (yy + 1) * W + 1, ry = y0 + j + .5 - y, wyj = wy[j + KW];
      for (let k = -KW; k <= KW; k++) {
        let xx = x0 + k; if (xx < 0) xx += GW; else if (xx >= GW) xx -= GW;
        const g = wx[k + KW] * wyj * v[row + xx];
        gx += (x0 + k + .5 - x) * g; gy += ry * g; b += g;
      }
    }
    fx[i] = gx * GN; fy[i] = gy * GN; lone[i] = clamp(1 - b * BN / BTH, 0, 1);
  }
  function moveDrones(dt) {
    const m = 3;
    for (let i = 0; i < ND; i++) {
      sense(i);
      const g = Math.hypot(fx[i], fy[i]), flat = 1 - clamp(g / GFLAT, 0, 1);
      fx[i] = fx[i] * KG + flat * NOISE * kit.gauss(R); fy[i] = fy[i] * KG + flat * NOISE * kit.gauss(R);   // jiggle only where v is flat
      if (px[i] < m) fx[i] += 40 * (m - px[i]); else if (px[i] > GW - m) fx[i] -= 40 * (px[i] - GW + m);
      if (py[i] < m) fy[i] += 40 * (m - py[i]); else if (py[i] > GH - m) fy[i] -= 40 * (py[i] - GH + m);
    }
    for (let i = 0; i < ND; i++) for (let j = i + 1; j < ND; j++) {      // 24 drones: 276 pairs, cheaper than a hash
      let ddx = px[i] - px[j], ddy = py[i] - py[j]; const d2 = ddx * ddx + ddy * ddy;
      if (d2 >= CROWD * CROWD) continue;
      let d = Math.sqrt(d2); if (d < 1e-3) { ddx = R() - .5; ddy = R() - .5; d = Math.hypot(ddx, ddy); }
      const ux = ddx / d, uy = ddy / d, c = KC * (1 - d / CROWD);
      let fi = c * lone[i], fj = c * lone[j];                             // only a drone with no spot under it gives way
      if (d < REP) { const r = KREP * (1 - d / REP); fi += r; fj += r; }
      fx[i] += ux * fi; fy[i] += uy * fi; fx[j] -= ux * fj; fy[j] -= uy * fj;
    }
    const damp = Math.exp(-DAMP * dt);
    for (let i = 0; i < ND; i++) {
      pvx[i] = (pvx[i] + fx[i] * dt) * damp; pvy[i] = (pvy[i] + fy[i] * dt) * damp;
      const s = Math.hypot(pvx[i], pvy[i]); if (s > VMAXD) { pvx[i] *= VMAXD / s; pvy[i] *= VMAXD / s; }
      px[i] = clamp(px[i] + pvx[i] * dt, 1, GW - 1); py[i] = clamp(py[i] + pvy[i] * dt, 1, GH - 1);
    }
  }
  let spacingMean = 0, spacingCV = 0;
  function measure() {
    let s = 0, s2 = 0;
    for (let i = 0; i < ND; i++) {
      let b = Infinity;
      for (let j = 0; j < ND; j++) { if (j === i) continue; const d = (px[i] - px[j]) ** 2 + (py[i] - py[j]) ** 2; if (d < b) b = d; }
      nn[i] = Math.sqrt(b); s += nn[i];
    }
    const mean = s / ND; for (let i = 0; i < ND; i++) s2 += (nn[i] - mean) ** 2;
    spacingMean = mean; spacingCV = mean > 0 ? Math.sqrt(s2 / ND) / mean : 0;
  }

  // ------------------------------------------------------------ controls and readouts
  kit.toggle(controls, { label: 'Pattern', options: [{ v: 'spots', label: 'Spots' }, { v: 'worms', label: 'Worms' }, { v: 'coral', label: 'Coral' }], value: 'spots',
    onChange: (v) => { preset = v; feed = PRESET[v].f; kill = PRESET[v].k; seed(); release(); } });
  kit.slider(controls, { label: 'Spacing', min: .7, max: 1.4, step: .05, value: 1, fmt: (v) => v.toFixed(2) + '×',
    onInput: (v) => { scale = v; respaceIn = .45; } });
  kit.toggle(controls, { label: 'Drones', options: [{ v: 0, label: 'Off' }, { v: 1, label: 'On' }], value: 1, onChange: (v) => { dronesOn = v; if (v) release(); } });
  kit.button(controls, { label: 'Re-seed', onClick: () => { seed(); release(); } });
  kit.hint(controls, 'Spacing scales how fast both chemicals spread. Drag across the pattern to wipe it.');
  const rSp = kit.readout(readouts, { label: 'Spot spacing', tone: 'teal' });
  const rCv = kit.readout(readouts, { label: 'Spacing spread', tone: 'haze' });
  const rAs = kit.readout(readouts, { label: 'Positions assigned', tone: 'heat' });

  // ------------------------------------------------------------ pointer: drag (or tap) to wipe
  let hx = 0, hy = 0, hoverOn = false, tapT = 0, down = false, lx = 0, ly = 0, healX = 0, healY = 0, healT = 0;
  const BRUSH = 22;
  function wipePx(x, y) { wipe(x / sx, y / sy, BRUSH / ((sx + sy) / 2)); healX = x; healY = y; healT = 2.6; }
  const onDown = (e) => {
    down = true; hx = lx = e.offsetX; hy = ly = e.offsetY; hoverOn = true; wipePx(hx, hy);
    try { cv.cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };
  const onMove = (e) => {
    hx = e.offsetX; hy = e.offsetY; hoverOn = true;
    if (!down) return;
    const d = Math.hypot(hx - lx, hy - ly), n = Math.max(1, Math.ceil(d / (BRUSH * .5)));
    for (let k = 1; k <= n; k++) wipePx(lx + (hx - lx) * k / n, ly + (hy - ly) * k / n);
    lx = hx; ly = hy;
  };
  const onUp = (e) => { down = false; if (e.pointerType !== 'mouse') { tapT = 1.5; hoverOn = false; } };
  const onLeave = (e) => { if (e.pointerType === 'mouse') hoverOn = false; down = false; };
  cv.cv.addEventListener('pointerdown', onDown); cv.cv.addEventListener('pointermove', onMove);
  cv.cv.addEventListener('pointerup', onUp); cv.cv.addEventListener('pointercancel', onUp); cv.cv.addEventListener('pointerleave', onLeave);

  // ------------------------------------------------------------ drawing
  const glow = document.createElement('canvas'); glow.width = glow.height = 40;
  { const g = glow.getContext('2d'), rg = g.createRadialGradient(20, 20, 0, 20, 20, 20);
    rg.addColorStop(0, 'rgba(127,212,207,.42)'); rg.addColorStop(.5, 'rgba(127,212,207,.12)'); rg.addColorStop(1, 'rgba(127,212,207,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 40, 40); }
  // a label on a dark pill so it reads over the pattern; returns its box
  function pillBox(s, x, y, size, align) {
    ctx.font = `400 ${size}px ${FONT.sans}`; const tw = ctx.measureText(s).width, ph = size + 11;
    const x0 = align === 'center' ? x - tw / 2 - 10 : align === 'right' ? x - tw - 20 : x;
    return { x: x0, y: y - ph / 2, w: tw + 20, h: ph };
  }
  function pill(s, x, y, { color = C.muted, size = 12, align = 'center' } = {}) {
    const b = pillBox(s, x, y, size, align);
    ctx.fillStyle = 'rgba(27,30,61,.8)'; roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2); ctx.fill();
    text(ctx, s, b.x + 10, y + .5, { size, color, base: 'middle' });
    return b;
  }
  const hit = (a, b) => a.x < b.x + b.w + 6 && b.x < a.x + a.w + 6 && a.y < b.y + b.h + 4 && b.y < a.y + a.h + 4;
  function draw() {
    const w = cv.w, h = cv.h, phone = w < 560, fsC = phone ? 11 : 12;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, w, h);
    const capS = phone ? 'bright: v, the activator' : 'bright: v, the activator (it makes more of itself)';
    const capB = pillBox(capS, 18, 32, fsC, 'left');
    let capOn = true, dragOn = true;
    const showDrag = !hoverOn && tapT <= 0 && healT <= 0, dragS = phone ? 'drag to wipe' : 'drag across it to wipe a patch';
    const dragB = pillBox(dragS, 18, h - 30, fsC, 'left');
    // drones: a soft glow, a dark footprint so they read on a bright spot, then the teal X frame with its rotors
    if (dronesOn) {
      const a = phone ? 4.6 : 5.6, rr = phone ? 2 : 2.4, d = a * .7071;
      for (let i = 0; i < ND; i++) ctx.drawImage(glow, px[i] * sx - 20, py[i] * sy - 20, 40, 40);
      ctx.fillStyle = 'rgba(27,30,61,.55)'; ctx.beginPath();
      for (let i = 0; i < ND; i++) { const X = px[i] * sx, Y = py[i] * sy; ctx.moveTo(X + a + 3, Y); ctx.arc(X, Y, a + 3, 0, TAU); }
      ctx.fill();
      const arms = new Path2D(), rot = new Path2D();
      for (let i = 0; i < ND; i++) {
        const X = px[i] * sx, Y = py[i] * sy;
        arms.moveTo(X - d, Y - d); arms.lineTo(X + d, Y + d); arms.moveTo(X - d, Y + d); arms.lineTo(X + d, Y - d);
        rot.moveTo(X - d + rr, Y - d); rot.arc(X - d, Y - d, rr, 0, TAU); rot.moveTo(X + d + rr, Y - d); rot.arc(X + d, Y - d, rr, 0, TAU);
        rot.moveTo(X + d + rr, Y + d); rot.arc(X + d, Y + d, rr, 0, TAU); rot.moveTo(X - d + rr, Y + d); rot.arc(X - d, Y + d, rr, 0, TAU);
      }
      ctx.lineCap = 'round'; ctx.strokeStyle = C.teal; ctx.lineWidth = 1.8; ctx.stroke(arms);
      ctx.lineWidth = 1.2; ctx.stroke(rot);
      // the label goes above the group, or below it, wherever it does not collide with the captions
      let y0 = Infinity, y1 = -Infinity, cx = 0;
      for (let i = 0; i < ND; i++) { const Y = py[i] * sy; y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); cx += px[i] * sx; }
      cx /= ND;
      const lab = 'nobody told them where to stand', fs = phone ? 11.5 : 12.5, tw = pillBox(lab, 0, 0, fs, 'left').w;
      const lx = clamp(cx, 18 + tw / 2, w - 18 - tw / 2);
      const cands = [y0 - 22, y1 + 24, y0 - 22 - 34, y1 + 24 + 34];
      let ly = null;
      for (const c of cands) {
        if (c < 30 || c > h - 30) continue;
        const b = pillBox(lab, lx, c, fs, 'center');
        if (hit(b, capB) || (showDrag && hit(b, dragB))) continue;
        ly = c; break;
      }
      if (ly === null) { ly = clamp(y0 - 22, 30, h - 30); const b = pillBox(lab, lx, ly, fs, 'center'); if (hit(b, capB)) capOn = false; if (hit(b, dragB)) dragOn = false; }
      pill(lab, lx, ly, { color: C.teal, size: fs });
    }
    // healing note at the last wipe
    if (healT > 0 && !down) {
      ctx.globalAlpha = Math.min(1, healT / .8);
      pill('it grows back', clamp(healX, 70, w - 70), clamp(healY + BRUSH + 18, 30, h - 30), { color: C.apricot, size: 11.5 });
      ctx.globalAlpha = 1;
    }
    // brush ring (mouse hover, finger drag, or 1.5 s after a tap)
    if (hoverOn || tapT > 0) {
      ctx.globalAlpha = hoverOn ? 1 : Math.min(1, tapT / .5);
      ctx.strokeStyle = C.apricot; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(hx, hy, BRUSH, 0, TAU); ctx.stroke();
      if (down) { ctx.fillStyle = 'rgba(246,210,177,.12)'; ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    if (capOn) pill(capS, 18, 32, { color: C.muted, size: fsC, align: 'left' });
    if (showDrag && dragOn) pill(dragS, 18, h - 30, { color: C.faint, size: fsC, align: 'left' });
  }

  // ------------------------------------------------------------ loop
  let flatN = 0, respaceIn = 0, mT = 0, frame = 0;
  function layout() { if (alloc()) { seed(); release(); } }
  cv.onResize(layout); layout();
  const loop = kit.loop((dt) => {
    frame++;
    // a new spacing: spots re-form on their own; labyrinths freeze, so they are re-seeded. The drones take off again
    // from the middle and find their own places at the new spacing.
    if (respaceIn > 0 && (respaceIn -= dt) <= 0) { if (preset !== 'spots') seed(); release(); }
    react(ITER);
    if (frame % 20 === 0) {                     // went flat (or blew up)? start again
      const v = V[cur]; let mx = 0; for (let i = 0; i < NP; i += 3) if (v[i] > mx) mx = v[i];
      if (!(mx < 2)) seed(); else if (mx < .05) { if (++flatN > 2) seed(); } else flatN = 0;
    }
    if (down) wipePx(hx, hy);                   // holding still keeps the hole open; let go and it grows back
    if (dronesOn) { moveDrones(dt / 2); moveDrones(dt / 2); }
    if (tapT > 0) tapT -= dt; if (healT > 0) healT -= dt;
    paint(); draw();
    if ((mT -= dt) <= 0) {
      mT = .25;
      if (dronesOn) { measure(); rSp.set(spacingMean.toFixed(1) + ' cells'); rCv.set((spacingCV * 100).toFixed(0) + ' %'); }
      else { rSp.set('—'); rCv.set('—'); }
      rAs.set('0');
    }
  });
  paint(); draw();
  return {
    start: loop.start, stop: loop.stop,
    destroy() {
      loop.stop();
      cv.cv.removeEventListener('pointerdown', onDown); cv.cv.removeEventListener('pointermove', onMove);
      cv.cv.removeEventListener('pointerup', onUp); cv.cv.removeEventListener('pointercancel', onUp); cv.cv.removeEventListener('pointerleave', onLeave);
      cv.destroy();
    },
  };
}

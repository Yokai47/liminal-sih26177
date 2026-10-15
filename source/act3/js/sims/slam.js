// SLAM and loop closure. Top-down: a corridor loop around a solid block. The drone flies the loop; its estimate
// picks up a small heading error with every metre, so the map it builds from that estimate (walls and landmarks)
// slowly bends, and the start corridor gets mapped twice, a metre apart. Back at the start it recognises the place:
// loop closure spreads the accumulated error back along the whole trajectory and the map snaps straight.
// Visual SLAM (ORB-SLAM3) needs texture: on the bare wall and in dust it loses features and dead-reckons on the IMU.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, lerp, plot } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------ world (metres, y down like the screen)
  const WX = 20, WY = 12;
  const SEG = [[0, 0, 20, 0], [20, 0, 20, 12], [20, 12, 0, 12], [0, 12, 0, 0], [3, 3, 17, 3], [17, 3, 17, 9], [17, 9, 3, 9], [3, 9, 3, 3]];
  const DUST = { x0: 17, x1: 20, y0: 3.4, y1: 8.6 };          // a dust cloud filling the right corridor
  const BARE = { x0: 4.5, x1: 15.5 };                          // bare painted walls along the top corridor
  const inBare = (x, y) => (Math.abs(y) < .01 || Math.abs(y - 3) < .01) && x > BARE.x0 && x < BARE.x1;
  const inDust = (x, y) => x > DUST.x0 - .2 && x < DUST.x1 && y > DUST.y0 && y < DUST.y1;
  const S0x = 6, S0y = 10.5;

  // ------------------------------------------------------------ the true path: a rounded loop along the corridors
  const R = 1.4, X0 = 1.5, X1 = 18.5, Y0 = 1.5, Y1 = 10.5;
  const pieces = [];
  const ln = (ax, ay, bx, by) => pieces.push({ arc: 0, ax, ay, bx, by, len: Math.hypot(bx - ax, by - ay) });
  const ar = (cx, cy, a0, a1) => pieces.push({ arc: 1, cx, cy, a0, a1, len: Math.abs(a1 - a0) * R });
  ln(S0x, Y1, X1 - R, Y1); ar(X1 - R, Y1 - R, Math.PI / 2, 0); ln(X1, Y1 - R, X1, Y0 + R); ar(X1 - R, Y0 + R, 0, -Math.PI / 2);
  ln(X1 - R, Y0, X0 + R, Y0); ar(X0 + R, Y0 + R, -Math.PI / 2, -Math.PI); ln(X0, Y0 + R, X0, Y1 - R); ar(X0 + R, Y1 - R, -Math.PI, -1.5 * Math.PI); ln(X0 + R, Y1, S0x, Y1);
  const LEN = pieces.reduce((a, p) => a + p.len, 0);
  const N = Math.round(LEN / .1) + 1, DS = LEN / (N - 1);
  const tx = new Float64Array(N), ty = new Float64Array(N), th = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let s = i * DS;
    for (const p of pieces) {
      if (s <= p.len + 1e-9 || p === pieces[pieces.length - 1]) {
        const f = Math.min(1, s / p.len);
        if (!p.arc) { tx[i] = lerp(p.ax, p.bx, f); ty[i] = lerp(p.ay, p.by, f); } else { const a = lerp(p.a0, p.a1, f); tx[i] = p.cx + R * Math.cos(a); ty[i] = p.cy + R * Math.sin(a); }
        break;
      }
      s -= p.len;
    }
  }
  const heads = () => { for (let i = 0; i < N - 1; i++) th[i] = Math.atan2(ty[i + 1] - ty[i], tx[i + 1] - tx[i]); th[N - 1] = th[N - 2]; };
  heads();
  for (let i = 0; i < N; i++) {           // a gentle weave, zero at both ends so the loop really closes
    const s = i * DS, win = Math.sin(Math.PI * s / LEN), n = win * (.16 * Math.sin(TAU * s / 11) + .06 * Math.sin(TAU * s / 4.3 + 1.3));
    tx[i] += -Math.sin(th[i]) * n; ty[i] += Math.cos(th[i]) * n;
  }
  heads();

  // ------------------------------------------------------------ landmarks (textured spots on the walls) and what the camera sees
  const lr = kit.rng(11), LM = [];
  for (let k = 0; k < SEG.length; k++) {
    const [ax, ay, bx, by] = SEG[k], len = Math.hypot(bx - ax, by - ay);
    for (let d = .6 + lr() * .5; d < len - .3; d += .9 + lr() * .9) {
      const x = ax + (bx - ax) * d / len, y = ay + (by - ay) * d / len;
      if (inBare(x, y)) continue;
      LM.push({ x, y, nf: 9 + Math.floor(lr() * 13) });
    }
  }
  const crossesInner = (x0, y0, x1, y1) => {
    for (let k = 4; k < 8; k++) {
      const [ax, ay, bx, by] = SEG[k], dx = x1 - x0, dy = y1 - y0, ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - x0) * ey - (ay - y0) * ex) / den, u = ((ax - x0) * dy - (ay - y0) * dx) / den;
      if (t > .001 && t < .985 && u >= 0 && u <= 1) return true;
    }
    return false;
  };
  const FEAT_MIN = 45;                                  // below this ORB-SLAM3 cannot hold its track
  const feats = new Float32Array(N), lost = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let n = 0;
    for (const m of LM) {
      const dx = m.x - tx[i], dy = m.y - ty[i], d = Math.hypot(dx, dy);
      if (d > 5.5 || d < .2) continue;
      let a = Math.atan2(dy, dx) - th[i]; a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) > .9) continue;                   // about a 100 degree field of view
      if (crossesInner(tx[i], ty[i], m.x, m.y)) continue;
      n += m.nf * (inDust(tx[i], ty[i]) || inDust(m.x, m.y) ? .12 : 1);
    }
    feats[i] = n; lost[i] = n < FEAT_MIN ? 1 : 0;
  }

  // ------------------------------------------------------------ which pose placed each wall point and landmark into the map
  const nearestIdx = (x, y, from, to) => { let b = from, bd = 1e9; for (let i = from; i <= to; i++) { const d = (tx[i] - x) ** 2 + (ty[i] - y) ** 2; if (d < bd) { bd = d; b = i; } } return b; };
  const LATE = N - 1 - 75;                              // the last 7.5 m: back in the start corridor
  const nearStart = (x, y) => Math.hypot(x - S0x, y - S0y) < 4.6;
  const WP = [];                                        // wall samples, in order along each wall
  for (let k = 0; k < SEG.length; k++) {
    const [ax, ay, bx, by] = SEG[k], len = Math.hypot(bx - ax, by - ay), n = Math.round(len / .25);
    for (let j = 0; j <= n; j++) {
      const x = ax + (bx - ax) * j / n, y = ay + (by - ay) * j / n, st = nearStart(x, y);
      WP.push({ k, x, y, a: st ? 0 : nearestIdx(x, y, 0, N - 1), b: st ? nearestIdx(x, y, LATE, N - 1) : -1 });
    }
  }
  for (const m of LM) { const st = nearStart(m.x, m.y); m.a = st ? 0 : nearestIdx(m.x, m.y, 0, N - 1); m.b = st ? nearestIdx(m.x, m.y, LATE, N - 1) : -1; }

  // ------------------------------------------------------------ the estimate: heading drift integrated along the path
  const ex = new Float64Array(N), ey = new Float64Array(N), eth = new Float64Array(N), U = new Float64Array(N);
  const cx = new Float64Array(N), cy = new Float64Array(N), cth = new Float64Array(N);
  const noise = new Float32Array(N);
  let drift = 1.8, mode = 'visual', sign = 1, seed = 3, closeNoiseX = 0, closeNoiseY = 0;
  let errBefore = 0, errAfter = 0, maxErr = 1;
  function integrate(k, useNoise) {
    ex[0] = tx[0]; ey[0] = ty[0]; eth[0] = 0; U[0] = 0;
    for (let i = 1; i < N; i++) {
      const m = mode === 'visual' && lost[i] ? 6 : 1, c = Math.cos(eth[i - 1]), s = Math.sin(eth[i - 1]);
      const dx = tx[i] - tx[i - 1], dy = ty[i] - ty[i - 1];
      ex[i] = ex[i - 1] + c * dx - s * dy; ey[i] = ey[i - 1] + s * dx + c * dy;
      eth[i] = eth[i - 1] + k * m * DS + (useNoise ? Math.abs(k) * .9 * m * Math.sqrt(DS) * noise[i] : 0);
      U[i] = U[i - 1] + m * DS;                        // how much uncertainty this stretch added
    }
  }
  integrate(1e-4, false);                               // calibrate: "x % per metre" = end error / distance for a pure bias
  const K_PER_PCT = (.01 * LEN) * 1e-4 / Math.max(1e-6, Math.hypot(ex[N - 1] - tx[N - 1], ey[N - 1] - ty[N - 1]));
  function newFlight() {
    const r = kit.rng(seed++ * 7919);
    for (let i = 0; i < N; i++) noise[i] = kit.gauss(r);
    sign = r() < .5 ? -1 : 1; closeNoiseX = kit.gauss(r) * .015; closeNoiseY = kit.gauss(r) * .015;
  }
  function recompute() {
    integrate(sign * drift * K_PER_PCT, true);
    // loop closure as a pose-graph optimiser would do it: spread the heading error back in proportion to the
    // uncertainty each stretch added, re-chain the poses, then spread the leftover offset the same way
    const UN = U[N - 1] || 1, thN = eth[N - 1];
    for (let i = 0; i < N; i++) cth[i] = eth[i] - thN * U[i] / UN;
    cx[0] = tx[0]; cy[0] = ty[0];
    for (let i = 1; i < N; i++) { const c = Math.cos(cth[i - 1]), s = Math.sin(cth[i - 1]), dx = tx[i] - tx[i - 1], dy = ty[i] - ty[i - 1]; cx[i] = cx[i - 1] + c * dx - s * dy; cy[i] = cy[i - 1] + s * dx + c * dy; }
    const rx = tx[N - 1] - cx[N - 1] + closeNoiseX, ry = ty[N - 1] - cy[N - 1] + closeNoiseY;
    let ss = 0; maxErr = 0;
    for (let i = 0; i < N; i++) {
      const w = U[i] / UN; cx[i] += rx * w; cy[i] += ry * w;
      ss += (cx[i] - tx[i]) ** 2 + (cy[i] - ty[i]) ** 2;
      const e = Math.hypot(ex[i] - tx[i], ey[i] - ty[i]); if (e > maxErr) maxErr = e;
    }
    errAfter = Math.sqrt(ss / N); errBefore = Math.hypot(ex[N - 1] - tx[N - 1], ey[N - 1] - ty[N - 1]);
  }

  // ------------------------------------------------------------ controls and readouts
  kit.slider(controls, { label: 'Drift per metre', min: 0, max: 3, step: .1, value: drift, fmt: (v) => v.toFixed(1) + ' %', onInput: (v) => { drift = v; recompute(); } });
  kit.toggle(controls, { label: 'SLAM type', options: [{ v: 'visual', label: 'Visual (ORB-SLAM3)' }, { v: 'lidar', label: '2-D LiDAR (slam_toolbox)' }], value: mode, onChange: (v) => { mode = v; recompute(); featLabel.textContent = v === 'visual' ? 'features tracked' : 'laser points per scan'; } });
  kit.button(controls, { label: 'Fly again', kind: 'primary', onClick: () => restart() });
  const rBefore = kit.readout(readouts, { label: 'accumulated error before closure', tone: 'rose' });
  const rAfter = kit.readout(readouts, { label: 'error after closure (RMS)', tone: 'teal' });
  const rFeat = kit.readout(readouts, { label: 'features tracked', tone: 'heat' });
  const featLabel = rFeat.el.querySelector('span');
  let featTone = 'heat'; const setTone = (t) => { if (t !== featTone) { featTone = t; rFeat.tone(t); } };

  // ------------------------------------------------------------ animation state
  const SPEED = 3.3;                                    // m/s
  let phase = 'fly', pos = 0, tPh = 0, T = 0;
  function restart() { newFlight(); recompute(); phase = 'fly'; pos = 0; tPh = 0; }
  newFlight(); recompute();

  // dust particles (fixed count, drift slowly)
  const dr = kit.rng(5), DP = 46, dpx = new Float32Array(DP), dpy = new Float32Array(DP), dps = new Float32Array(DP);
  for (let i = 0; i < DP; i++) { dpx[i] = DUST.x0 + dr() * (DUST.x1 - DUST.x0); dpy[i] = DUST.y0 + dr() * (DUST.y1 - DUST.y0); dps[i] = .3 + dr() * .7; }
  const RAYS = 120, rayD = new Float32Array(RAYS);

  // ------------------------------------------------------------ layout
  let G = null;
  function layout() {
    const w = cv.w, h = cv.h, phone = w < 640;
    if (phone) {
      const sc = Math.min((w - 40) / WX, (h - 150) / WY), mw = WX * sc, mh = WY * sc;
      G = { phone, sc, ox: (w - mw) / 2, oy: h - 26 - mh, mw, mh, textX: 16, textY: 22, textW: Math.max(160, w - 150), chart: null };
    } else {
      const right = w >= 860 ? 250 : 24, top = 84;
      const sc = Math.min((w - 28 - right - 10) / WX, (h - top - 80) / WY), mw = WX * sc, mh = WY * sc;
      G = { phone, sc, ox: 28, oy: top + Math.max(0, (h - top - 90 - mh) / 2), mw, mh, textX: 28, textY: 30, textW: Math.min(w - 300, mw), chart: w >= 860 ? { x: w - 236, y: 212, w: 212, h: Math.min(250, h - 236) } : null };
    }
  }
  cv.onResize(layout); layout();
  const X = (x) => G.ox + x * G.sc, Y = (y) => G.oy + y * G.sc;

  const wrapCache = new Map();
  function wrapped(s, maxW, size) {
    const key = s + '|' + Math.round(maxW) + '|' + size; let v = wrapCache.get(key); if (v) return v;
    ctx.font = `400 ${size}px ${F.sans}`; v = []; let line = '';
    for (const word of s.split(' ')) { const t = line ? line + ' ' + word : word; if (ctx.measureText(t).width > maxW && line) { v.push(line); line = word; } else line = t; }
    if (line) v.push(line); if (wrapCache.size > 200) wrapCache.clear(); wrapCache.set(key, v); return v;
  }

  // ------------------------------------------------------------ drawing
  const ease = (a) => a < .5 ? 4 * a * a * a : 1 - (-2 * a + 2) ** 3 / 2;
  function castRays(px, py) {
    for (let r = 0; r < RAYS; r++) {
      const a = r / RAYS * TAU, dx = Math.cos(a), dy = Math.sin(a); let best = 12;
      for (const [ax, ay, bx, by] of SEG) {
        const ex2 = bx - ax, ey2 = by - ay, den = dx * ey2 - dy * ex2; if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - px) * ey2 - (ay - py) * ex2) / den, u = ((ax - px) * dy - (ay - py) * dx) / den;
        if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
      }
      rayD[r] = best;
    }
  }

  function draw(dt) {
    const w = cv.w, h = cv.h, sc = G.sc; cv.clear();
    const cur = Math.min(N - 1, Math.floor(pos));
    const a = phase === 'close' ? ease(Math.min(1, tPh / 1.0)) : phase === 'done' ? 1 : 0;
    const showTo = phase === 'fly' ? cur : N - 1;
    // floor of the corridors and the solid block
    ctx.fillStyle = 'rgba(220,214,236,.035)'; ctx.fillRect(X(0), Y(0), WX * sc, WY * sc);
    ctx.fillStyle = 'rgba(143,140,196,.10)'; ctx.fillRect(X(3), Y(3), 14 * sc, 6 * sc);
    // dust cloud
    ctx.fillStyle = 'rgba(246,210,177,.06)'; ctx.fillRect(X(DUST.x0), Y(DUST.y0), (DUST.x1 - DUST.x0) * sc, (DUST.y1 - DUST.y0) * sc);
    ctx.fillStyle = 'rgba(246,210,177,.45)';
    for (let i = 0; i < DP; i++) {
      dpy[i] -= dt * .25 * dps[i]; dpx[i] += Math.sin(T * .7 + i) * dt * .1; if (dpy[i] < DUST.y0) dpy[i] = DUST.y1;
      if (dpx[i] < DUST.x0) dpx[i] = DUST.x1 - .05; if (dpx[i] > DUST.x1 - .05) dpx[i] = DUST.x0;
      ctx.beginPath(); ctx.arc(X(dpx[i]), Y(dpy[i]), 1 + dps[i], 0, TAU); ctx.fill();
    }
    // true walls (the real building)
    ctx.strokeStyle = 'rgba(143,140,196,.55)'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath();
    for (const [ax, ay, bx, by] of SEG) { ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(X(bx), Y(by)); }
    ctx.stroke();
    // bare-wall stretch
    ctx.strokeStyle = 'rgba(220,228,238,.28)'; ctx.lineWidth = 4; ctx.beginPath();
    ctx.moveTo(X(BARE.x0), Y(0)); ctx.lineTo(X(BARE.x1), Y(0)); ctx.moveTo(X(BARE.x0), Y(3)); ctx.lineTo(X(BARE.x1), Y(3)); ctx.stroke();
    const fs = G.phone ? 10.5 : 11.5;
    text(ctx, 'bare painted walls: no texture', X((BARE.x0 + BARE.x1) / 2), Y(0) - 8, { size: fs, color: C.faint, align: 'center' });
    text(ctx, 'dust', X(19.75), Y(DUST.y0) + 15, { size: fs, color: 'rgba(246,210,177,.75)', align: 'right' });

    // the drone's true pose right now
    const px = phase === 'fly' ? lerp(tx[cur], tx[Math.min(N - 1, cur + 1)], pos - cur) : tx[N - 1];
    const py = phase === 'fly' ? lerp(ty[cur], ty[Math.min(N - 1, cur + 1)], pos - cur) : ty[N - 1];
    const ph = th[phase === 'fly' ? cur : N - 1];
    // its sensor
    if (mode === 'lidar') {
      castRays(px, py);
      ctx.strokeStyle = 'rgba(127,212,207,.13)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let r = 0; r < RAYS; r++) { const an = r / RAYS * TAU; ctx.moveTo(X(px), Y(py)); ctx.lineTo(X(px + Math.cos(an) * rayD[r]), Y(py + Math.sin(an) * rayD[r])); }
      ctx.stroke(); ctx.fillStyle = 'rgba(127,212,207,.75)';
      for (let r = 0; r < RAYS; r += 2) { const an = r / RAYS * TAU; ctx.fillRect(X(px + Math.cos(an) * rayD[r]) - 1, Y(py + Math.sin(an) * rayD[r]) - 1, 2, 2); }
    } else {
      ctx.save(); ctx.beginPath(); ctx.rect(X(0), Y(0), WX * sc, WY * sc); ctx.rect(X(3), Y(3), 14 * sc, 6 * sc); ctx.clip('evenodd');
      ctx.fillStyle = lost[cur] ? 'rgba(239,177,180,.09)' : 'rgba(127,212,207,.09)'; ctx.beginPath(); ctx.moveTo(X(px), Y(py));
      ctx.arc(X(px), Y(py), 5.5 * sc, ph - .9, ph + .9); ctx.closePath(); ctx.fill(); ctx.restore();
    }

    // ---- the map the drone has built, placed from the pose it was at (estimate, or corrected after closure)
    const herr = (i) => lerp(eth[i], cth[i], a), qx = (i) => lerp(ex[i], cx[i], a), qy = (i) => lerp(ey[i], cy[i], a);
    const place = (x, y, i, out) => { const e = herr(i), c = Math.cos(e), s = Math.sin(e), dx = x - tx[i], dy = y - ty[i]; out[0] = qx(i) + c * dx - s * dy; out[1] = qy(i) + s * dx + c * dy; };
    const o = place.o || (place.o = [0, 0]);
    const drawWalls = (useB) => {
      ctx.beginPath(); let prevK = -1, prevI = -1, open = false;
      for (const p of WP) {
        const i = useB ? p.b : p.a;
        if (i < 0 || i > showTo) { open = false; continue; }
        place(p.x, p.y, i, o);
        if (open && p.k === prevK && Math.abs(i - prevI) < 60) ctx.lineTo(X(o[0]), Y(o[1])); else ctx.moveTo(X(o[0]), Y(o[1]));
        open = true; prevK = p.k; prevI = i;
      }
      ctx.stroke();
    };
    ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(127,212,207,.62)'; drawWalls(false);
    ctx.strokeStyle = 'rgba(127,212,207,.62)'; drawWalls(true);
    // landmarks
    for (const m of LM) {
      for (let pass = 0; pass < 2; pass++) {
        const i = pass ? m.b : m.a; if (i < 0 || i > showTo) continue;
        place(m.x, m.y, i, o); ctx.fillStyle = 'rgba(246,210,177,.85)'; ctx.beginPath(); ctx.arc(X(o[0]), Y(o[1]), 2.1, 0, TAU); ctx.fill();
      }
    }
    // the doubled start corridor before closure
    if (phase !== 'done' && (phase !== 'close' || a < .6) && showTo > LATE + 30 && errBefore > .25) {
      const p = WP.find((q) => q.b > 0 && q.k === 2 && q.x < 4.5 && q.x > 3.5);
      if (p && p.b <= showTo) {
        place(p.x, p.y, p.b, o); const gx = X(o[0]), gy = Y(o[1]);
        const ly2 = G.phone ? cv.h - 8 : Math.min(cv.h - 10, gy + 28), lx2 = G.phone ? G.ox + 40 : Math.min(cv.w - 150, gx + 10);
        ctx.strokeStyle = 'rgba(243,238,242,.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(lx2 - 2, ly2 - 10); ctx.stroke();
        text(ctx, 'same wall, mapped twice', lx2, ly2, { size: fs, color: C.muted });
      }
    }

    // ---- paths: true (ink, dashed) and estimate (teal; rose where visual tracking is lost)
    ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(243,238,242,.55)'; ctx.lineWidth = 1.4; ctx.beginPath();
    for (let i = 0; i <= showTo; i += 2) { const xx = X(tx[i]), yy = Y(ty[i]); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
    if (phase === 'fly') ctx.lineTo(X(px), Y(py)); ctx.stroke(); ctx.setLineDash([]);
    ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
    let run = -1;
    for (let i = 0; i <= showTo; i++) {
      const lostHere = mode === 'visual' && lost[i] ? 1 : 0;
      if (lostHere !== run) { if (run >= 0) { ctx.lineTo(X(qx(i)), Y(qy(i))); ctx.stroke(); } ctx.strokeStyle = lostHere ? C.rose : C.teal; ctx.beginPath(); ctx.moveTo(X(qx(i)), Y(qy(i))); run = lostHere; }
      else ctx.lineTo(X(qx(i)), Y(qy(i)));
    }
    ctx.stroke();
    // start marker
    ctx.strokeStyle = C.heat; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(S0x), Y(S0y), 6, 0, TAU); ctx.stroke();
    text(ctx, 'start', X(S0x), Y(S0y) + 22, { size: fs, color: C.heat, align: 'center' });
    if (phase === 'recog' || (phase === 'close' && a < 1)) {
      const pr = 10 + 26 * ((T * 1.4) % 1); ctx.strokeStyle = `rgba(255,195,107,${(1 - (T * 1.4) % 1) * .8})`; ctx.beginPath(); ctx.arc(X(S0x), Y(S0y), pr, 0, TAU); ctx.stroke();
    }
    // labels on the paths
    const li = Math.min(showTo, 34);
    if (showTo > 20) text(ctx, 'true path', X(tx[li]) + 4, Y(ty[li]) + (G.phone ? 15 : 18), { size: fs, color: C.muted });
    // estimated pose and the error vector
    const qi = phase === 'fly' ? cur : N - 1;
    const exn = qx(qi), eyn = qy(qi);
    const err = Math.hypot(exn - px, eyn - py);
    if (err > .05) { ctx.strokeStyle = 'rgba(240,138,126,.85)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(X(px), Y(py)); ctx.lineTo(X(exn), Y(eyn)); ctx.stroke(); }
    ctx.strokeStyle = C.teal; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(exn), Y(eyn), 6.5, 0, TAU); ctx.stroke();
    // drone (true)
    ctx.save(); ctx.translate(X(px), Y(py)); ctx.rotate(ph);
    ctx.fillStyle = C.heat; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, 5); ctx.lineTo(-2.5, 0); ctx.lineTo(-5, -5); ctx.closePath(); ctx.fill();
    ctx.restore();
    // label the estimate next to its ring, on the side away from the drone
    const lx = X(exn) + (exn >= px ? 11 : -11), ly = Y(eyn) + (eyn >= py ? 15 : -9);
    text(ctx, 'estimate', lx, ly, { size: fs, color: C.teal, align: exn >= px ? 'left' : 'right' });

    // ---- status
    let s1, s2 = '', col = C.ink;
    const eNow = Math.hypot(ex[cur] - tx[cur], ey[cur] - ty[cur]);
    if (phase === 'fly') {
      if (mode === 'visual' && lost[cur]) { s1 = 'Tracking lost: ' + (inDust(px, py) ? 'dust hides the features.' : 'a bare wall has no features.'); s2 = 'Dead-reckoning on the IMU alone, so the error grows fast.'; col = C.rose; }
      else { s1 = 'Flying the loop.'; s2 = 'Every metre adds a little heading error, so the map it builds bends.'; }
    } else if (phase === 'recog') { s1 = 'Place recognised: "I have been here before."'; s2 = `But the estimate says the start is ${errBefore.toFixed(2)} m away. That gap is the accumulated error.`; col = C.heat; }
    else if (phase === 'close') { s1 = 'Loop closure.'; s2 = 'The error is spread back along the whole path, not just the last pose.'; col = C.heat; }
    else { s1 = 'The map snaps straight.'; s2 = `Remaining error ${(errAfter * 100).toFixed(0)} cm RMS, down from ${errBefore.toFixed(2)} m.`; col = C.teal; }
    const l1 = wrapped(s1, G.textW, G.phone ? 12.5 : 14), lh1 = G.phone ? 16 : 18;
    for (let k = 0; k < l1.length && k < 2; k++) text(ctx, l1[k], G.textX, G.textY + k * lh1, { size: G.phone ? 12.5 : 14, color: col, weight: 500 });
    const lines = wrapped(s2, G.textW, G.phone ? 11.5 : 12.5), y2 = G.textY + (Math.min(2, l1.length) - 1) * lh1 + (G.phone ? 17 : 20);
    for (let k = 0; k < lines.length && k < 3; k++) text(ctx, lines[k], G.textX, y2 + k * (G.phone ? 15 : 17), { size: G.phone ? 11.5 : 12.5, color: C.muted });

    // ---- chart: error along the path, before and after closure
    if (G.chart) {
      const ch = G.chart, yMax = Math.max(.5, Math.ceil(maxErr * 1.15 * 2) / 2);
      const { px: cxp, py: cyp } = plot(ctx, ch, [], { xMin: 0, xMax: LEN, yMin: 0, yMax, yLabel: 'position error', xLabel: 'metres flown' });
      ctx.save(); ctx.beginPath(); ctx.rect(ch.x + 14, ch.y + 10, ch.w - 28, ch.h - 30); ctx.clip();
      ctx.strokeStyle = C.rose; ctx.lineWidth = 1.8; ctx.beginPath();
      for (let i = 0; i <= showTo; i += 2) { const e = Math.hypot(ex[i] - tx[i], ey[i] - ty[i]), xx = cxp(i * DS), yy = cyp(e); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
      ctx.stroke();
      if (a > 0) {
        ctx.strokeStyle = C.teal; ctx.lineWidth = 2; ctx.beginPath();
        for (let i = 0; i < N; i += 2) { const e = Math.hypot(qx(i) - tx[i], qy(i) - ty[i]), xx = cxp(i * DS), yy = cyp(e); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath();
      for (let v = .5; v <= yMax + 1e-6; v += .5) { ctx.moveTo(ch.x + 14, cyp(v)); ctx.lineTo(ch.x + ch.w - 14, cyp(v)); }
      ctx.stroke();
      for (let v = .5; v <= yMax + 1e-6; v += .5) if (cyp(v) > ch.y + 26) text(ctx, v.toFixed(1) + ' m', ch.x + 20, cyp(v) - 3, { size: 10, color: C.faint, font: F.mono });
      text(ctx, 'drifting', ch.x + ch.w - 18, Math.max(ch.y + 30, cyp(Math.min(yMax, eNow)) - 8), { size: 11, color: C.rose, align: 'right' });
      if (a > 0) text(ctx, 'after closure', ch.x + ch.w - 18, cyp(0) - 8, { size: 11, color: C.teal, align: 'right' });
      if (mode === 'visual' && ch.h > 150) text(ctx, 'rose path = no features, IMU only', ch.x, ch.y + ch.h + 18, { size: 11, color: C.faint });
    }
  }

  // ------------------------------------------------------------ loop
  const loop = kit.loop((dt) => {
    T += dt; tPh += dt;
    if (phase === 'fly') { pos += SPEED * dt / DS; if (pos >= N - 1) { pos = N - 1; phase = 'recog'; tPh = 0; } }
    else if (phase === 'recog' && tPh > 1.1) { phase = 'close'; tPh = 0; }
    else if (phase === 'close' && tPh > 1.0) { phase = 'done'; tPh = 0; }
    else if (phase === 'done' && tPh > 6) restart();
    draw(dt);
    const cur = Math.min(N - 1, Math.floor(pos));
    rBefore.set((phase === 'fly' ? Math.hypot(ex[cur] - tx[cur], ey[cur] - ty[cur]) : errBefore).toFixed(2) + ' m');
    rAfter.set(phase === 'close' || phase === 'done' ? (errAfter * 100).toFixed(0) + ' cm' : '…');
    if (mode === 'visual') {
      const f = phase === 'fly' ? feats[cur] : feats[N - 1], n = Math.max(0, Math.round(f * (1 + .04 * Math.sin(T * 9))));
      rFeat.set(String(n)); setTone(f < FEAT_MIN ? 'danger' : 'heat');
    } else { rFeat.set('≈1450'); setTone('heat'); }
  });
  draw(0);
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

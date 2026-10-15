// Steering without giving orders: symmetry breaking with a UGV.
// A Vicsek flock (periodic box) held in the ordered phase. Every common heading is equally good, so with nothing to
// break the tie its heading wanders. The UGV sends nothing: agents inside its field add a few percent of their own
// alignment sum in the UGV's heading, and that weak, local bias picks the direction for the whole flock.
//   θi(t+1) = arg( Σ_{|rj − ri| < R} e^{iθj} + p · ni · e^{iθU} · [|ri − rU| < RU] ) + η · U(−½, ½)
// Positions also get a soft short-range push (collision avoidance) so the flock stays spread over the floor.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  cv.cv.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2, PI = Math.PI;

  // ------------------------------------------------------------ model constants (world unit = interaction radius R)
  const RHO = 3;          // agents per R²
  const ETA = 1.2;        // noise amplitude: ordered (Φ ≈ 0.9) but its common heading still drifts
  const V0 = .016;        // speed, R per step
  const SPS = 120;        // Vicsek steps per second
  const RR = .5, KR = .05;// soft repulsion radius and strength (positions only)
  const FIELD = .15;      // the field covers 15 % of the floor (about 150 px across a desktop stage)
  const N = cv.w * cv.h > 250000 ? 260 : 200;
  const AREA = N / RHO, RH = Math.sqrt(FIELD * AREA / PI);

  const x = new Float64Array(N), y = new Float64Array(N), th = new Float64Array(N), nt = new Float64Array(N);
  const cs = new Float64Array(N), sn = new Float64Array(N), px = new Float64Array(N), py = new Float64Array(N);
  const nxt = new Int32Array(N), cell = new Int32Array(N);
  let head = new Int32Array(1), gx = 1, gy = 1, cw = 1, ch = 1;
  let Lx = 1, Ly = 1, S = 1;

  // UGV state (world units)
  let ugvOn = 1, pull = .03, ux = 0, uy = 0, uth = -.35, thT = -.35, tgt = null, drag = false, hover = false;
  let mvx = 0, mvy = 0, lastPX = 0, lastPY = 0, tapT = 0, touched = false, cueA = 1;

  function geometry() {
    const asp = clamp(cv.w / Math.max(1, cv.h), .4, 4);
    const nLx = Math.sqrt(AREA * asp), nLy = AREA / nLx;
    if (Lx > 1) { const fx = nLx / Lx, fy = nLy / Ly; for (let i = 0; i < N; i++) { x[i] *= fx; y[i] *= fy; } ux *= fx; uy *= fy; if (tgt) { tgt.x *= fx; tgt.y *= fy; } }
    Lx = nLx; Ly = nLy; S = cv.w / Lx;
    gx = Math.max(3, Math.floor(Lx)); gy = Math.max(3, Math.floor(Ly)); cw = Lx / gx; ch = Ly / gy;
    head = new Int32Array(gx * gy);
    clampUgv();
  }
  const ugvLen = () => clamp(S * .46, 22, 36);
  function clampUgv() {
    const m = (ugvLen() * .9 + 18) / S;
    ux = clamp(ux, m, Lx - m); uy = clamp(uy, m, Ly - m);
  }

  function seed(base) {
    for (let i = 0; i < N; i++) { x[i] = Math.random() * Lx; y[i] = Math.random() * Ly; th[i] = base + (Math.random() - .5) * .5; }
  }
  function scramble() { for (let i = 0; i < N; i++) th[i] = (Math.random() - .5) * TAU; }

  geometry();
  ux = Lx * .54; uy = Ly * .6; clampUgv();
  seed(uth + 1.9);
  cv.onResize(geometry);

  // ------------------------------------------------------------ controls and readouts (labels fixed by the brief)
  kit.toggle(controls, { label: 'UGV', options: [{ v: 0, label: 'Off' }, { v: 1, label: 'On' }], value: 1, onChange: (v) => { ugvOn = v; } });
  kit.slider(controls, { label: 'UGV pull', min: 0, max: 10, step: 1, value: 3, fmt: (v) => v + ' %', onInput: (v) => { pull = v / 100; } });
  kit.button(controls, { label: 'Scramble headings', onClick: scramble });
  const rAl = kit.readout(readouts, { label: 'Aligned with UGV', tone: 'teal' });
  const rFelt = kit.readout(readouts, { label: 'Felt the field', tone: 'haze' });
  const rCmd = kit.readout(readouts, { label: 'Commands sent', tone: 'heat', value: '0' });

  // ------------------------------------------------------------ one Vicsek step
  let feltN = 0;
  function step() {
    head.fill(-1);
    for (let i = 0; i < N; i++) {
      cs[i] = Math.cos(th[i]); sn[i] = Math.sin(th[i]);
      let cx = (x[i] / cw) | 0, cy = (y[i] / ch) | 0; if (cx >= gx) cx = gx - 1; if (cy >= gy) cy = gy - 1;
      const c = cy * gx + cx; cell[i] = c; nxt[i] = head[c]; head[c] = i;
    }
    const hx = Lx / 2, hy = Ly / 2, rr2 = RR * RR, rh2 = RH * RH;
    const bx = Math.cos(uth), by = Math.sin(uth), p = ugvOn ? pull : 0;
    let f = 0;
    for (let i = 0; i < N; i++) {
      const xi = x[i], yi = y[i], c = cell[i], cx = c % gx, cy = (c / gx) | 0;
      let sx = 0, sy = 0, n = 0, rx = 0, ry = 0;
      for (let oy = -1; oy <= 1; oy++) {
        let yy = cy + oy; if (yy < 0) yy += gy; else if (yy >= gy) yy -= gy;
        for (let ox = -1; ox <= 1; ox++) {
          let xx = cx + ox; if (xx < 0) xx += gx; else if (xx >= gx) xx -= gx;
          for (let j = head[yy * gx + xx]; j >= 0; j = nxt[j]) {
            let dx = x[j] - xi, dy = y[j] - yi;
            if (dx > hx) dx -= Lx; else if (dx < -hx) dx += Lx;
            if (dy > hy) dy -= Ly; else if (dy < -hy) dy += Ly;
            const d2 = dx * dx + dy * dy;
            if (d2 < 1) {
              sx += cs[j]; sy += sn[j]; n++;
              if (d2 < rr2 && j !== i) { const d = Math.sqrt(d2) + 1e-6, k = (RR - d) / (RR * d); rx -= dx * k; ry -= dy * k; }
            }
          }
        }
      }
      if (ugvOn) { const dx = xi - ux, dy = yi - uy; if (dx * dx + dy * dy < rh2) { sx += p * n * bx; sy += p * n * by; f++; } }
      nt[i] = Math.atan2(sy, sx) + ETA * (Math.random() - .5);
      px[i] = rx * KR; py[i] = ry * KR;
    }
    for (let i = 0; i < N; i++) {
      let t = nt[i]; if (t > PI) t -= TAU; else if (t < -PI) t += TAU; th[i] = t;
      let X = x[i] + V0 * Math.cos(t) + px[i], Y = y[i] + V0 * Math.sin(t) + py[i];
      if (X < 0) X += Lx; else if (X >= Lx) X -= Lx; if (Y < 0) Y += Ly; else if (Y >= Ly) Y -= Ly;
      if (!(X >= 0 && X < Lx)) X = Math.random() * Lx; if (!(Y >= 0 && Y < Ly)) Y = Math.random() * Ly;   // NaN / overshoot guard
      x[i] = X; y[i] = Y;
    }
    feltN = f;
  }

  // ------------------------------------------------------------ the UGV drives (to a tapped point) or is dragged
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function moveUgv(dt) {
    if (!drag && tgt) {
      const dx = tgt.x - ux, dy = tgt.y - uy, d = Math.hypot(dx, dy);
      if (d < .03) tgt = null;
      else {
        thT = Math.atan2(dy, dx);
        const err = Math.abs(wrapA(thT - uth)), sp = 3.2 * dt * Math.max(.12, Math.cos(Math.min(err, PI / 2)));   // turn first, then drive
        const s = Math.min(d, sp); ux += dx / d * s; uy += dy / d * s;
      }
    }
    const d = wrapA(thT - uth), mx = (drag ? 10 : 6) * dt;
    uth = wrapA(uth + clamp(d, -mx, mx));
    clampUgv();
  }
  function onDown(e) {
    touched = true;
    const X = e.offsetX, Y = e.offsetY, d = Math.hypot(X - ux * S, Y - uy * S);
    if (d < Math.max(34, ugvLen() * 1.2)) {
      drag = true; tgt = null; mvx = mvy = 0; lastPX = X; lastPY = Y;
      try { cv.cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    } else {
      tgt = { x: X / S, y: Y / S }; tapT = 1.5;
      const m = (ugvLen() * .9 + 18) / S; tgt.x = clamp(tgt.x, m, Lx - m); tgt.y = clamp(tgt.y, m, Ly - m);
    }
  }
  function onMove(e) {
    const X = e.offsetX, Y = e.offsetY;
    if (drag) {
      const dx = X - lastPX, dy = Y - lastPY; lastPX = X; lastPY = Y;
      mvx = mvx * .7 + dx * .3; mvy = mvy * .7 + dy * .3;
      if (mvx * mvx + mvy * mvy > .6) thT = Math.atan2(mvy, mvx);
      ux = X / S; uy = Y / S; clampUgv();
    } else if (e.pointerType === 'mouse') {
      const h = Math.hypot(X - ux * S, Y - uy * S) < Math.max(34, ugvLen() * 1.2);
      if (h !== hover) { hover = h; cv.cv.style.cursor = h ? 'grab' : 'pointer'; }
    }
  }
  function onUp() { drag = false; }
  function onLeave() { if (!drag && hover) { hover = false; cv.cv.style.cursor = ''; } }
  cv.cv.style.cursor = 'pointer';
  cv.cv.addEventListener('pointerdown', onDown);
  cv.cv.addEventListener('pointermove', onMove);
  cv.cv.addEventListener('pointerup', onUp);
  cv.cv.addEventListener('pointercancel', onUp);
  cv.cv.addEventListener('pointerleave', onLeave);

  // ------------------------------------------------------------ measurements
  let acc = 0, alS = 0, feltS = 0, phi = 0, mth = 0, trailT = 0, trailI = 0, trailN = 0, primed = false;
  const TRAIL = 70, trA = new Float32Array(TRAIL), trP = new Float32Array(TRAIL);
  function measure(dt) {
    let al = 0, mx = 0, my = 0;
    for (let i = 0; i < N; i++) {
      mx += Math.cos(th[i]); my += Math.sin(th[i]);
      let d = th[i] - uth; if (d > PI) d -= TAU; else if (d < -PI) d += TAU;
      if (d < PI / 6 && d > -PI / 6) al++;
    }
    phi = Math.hypot(mx, my) / N; mth = Math.atan2(my, mx);
    const k = primed ? 1 - Math.exp(-dt / .25) : 1;
    alS += (al / N - alS) * k; feltS += ((ugvOn ? feltN : 0) / N - feltS) * k;
    trailT += dt; if (trailT > .12) { trailT = 0; trA[trailI] = mth; trP[trailI] = phi; trailI = (trailI + 1) % TRAIL; trailN = Math.min(TRAIL, trailN + 1); }
  }

  // ------------------------------------------------------------ drawing
  const TEAL_A = C.teal, MIST_A = 'rgba(220,228,238,.5)';
  function drawAgents() {
    const L = clamp(S * .12, 6, 9.5), W = L * .32;
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        let d = th[i] - uth; if (d > PI) d -= TAU; else if (d < -PI) d += TAU;
        const aligned = d < PI / 6 && d > -PI / 6;
        if (aligned !== (pass === 1)) continue;
        const X = x[i] * S, Y = y[i] * S, c = Math.cos(th[i]), s = Math.sin(th[i]);
        const bx = X - c * L * .45, by = Y - s * L * .45;
        ctx.moveTo(X + c * L * .55, Y + s * L * .55); ctx.lineTo(bx - s * W, by + c * W); ctx.lineTo(bx + s * W, by - c * W); ctx.closePath();
      }
      ctx.fillStyle = pass ? TEAL_A : MIST_A; ctx.fill();
    }
  }
  function drawUgv(X, Y, a, on) {
    const Lb = ugvLen(), Wb = Lb * .64;
    ctx.save(); ctx.translate(X, Y); ctx.rotate(a); ctx.globalAlpha = on ? 1 : .42;
    // shadow so it reads above the flock
    ctx.fillStyle = 'rgba(27,30,61,.65)'; roundRect(ctx, -Lb / 2 - 4, -Wb / 2 - 6, Lb + 8, Wb + 12, Wb * .42); ctx.fill();
    ctx.fillStyle = C.haze;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { roundRect(ctx, sx * Lb * .29 - Lb * .15, sy * Wb * .5 - Lb * .08, Lb * .3, Lb * .16, Lb * .06); ctx.fill(); }
    ctx.fillStyle = C.apricot; roundRect(ctx, -Lb / 2, -Wb / 2, Lb, Wb, Wb * .3); ctx.fill();
    ctx.fillStyle = 'rgba(27,30,61,.28)'; roundRect(ctx, -Lb * .32, -Wb * .24, Lb * .34, Wb * .48, 3); ctx.fill();
    ctx.fillStyle = C.bg; ctx.beginPath(); ctx.moveTo(Lb / 2 + 1, -Wb * .24); ctx.lineTo(Lb / 2 - Lb * .2, 0); ctx.lineTo(Lb / 2 + 1, Wb * .24); ctx.closePath(); ctx.fill();
    if (on) {
      const a0 = Lb / 2 + 6, a1 = a0 + Lb * 1.05;
      ctx.strokeStyle = C.apricot; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(a0, 0); ctx.lineTo(a1, 0); ctx.moveTo(a1 - 7, -5); ctx.lineTo(a1, 0); ctx.lineTo(a1 - 7, 5); ctx.stroke();
    }
    ctx.restore();
  }
  function drawHud(w, h, t) {
    const small = w < 520, rc = small ? 18 : 23, pad = small ? 9 : 11, fs = small ? 12 : 12.5, fs2 = small ? 11 : 11.5;
    const l1 = ugvOn ? 'One weak bias breaks the tie' : 'No UGV: every direction is equally good';
    const l2 = 'teal: heading within 30° of the UGV’s';
    ctx.font = `500 ${fs}px ${F.sans}`; const w1 = ctx.measureText(l1).width;
    ctx.font = `400 ${fs2}px ${F.sans}`; const w2 = ctx.measureText(l2).width;
    const bw = pad * 2 + rc * 2 + 12 + Math.max(w1, w2), bh = pad * 2 + rc * 2, X0 = 18, Y0 = 18;
    ctx.fillStyle = 'rgba(27,30,61,.82)'; roundRect(ctx, X0, Y0, bw, bh, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(220,214,236,.1)'; ctx.lineWidth = 1; ctx.stroke();
    const cx = X0 + pad + rc, cy = Y0 + pad + rc;
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.arc(cx, cy, rc, 0, TAU); ctx.stroke();
    // where the flock's heading has been (last ~8 s): it wanders when nothing breaks the tie
    for (let b = 0; b < 4; b++) {            // four fading buckets, one fill each
      ctx.beginPath();
      for (let k = Math.floor(b * TRAIL / 4); k < Math.min(trailN, Math.floor((b + 1) * TRAIL / 4)); k++) {
        const idx = (trailI - 1 - k + TRAIL) % TRAIL, r = rc * trP[idx], s = 1.7 - b * .35, X = cx + Math.cos(trA[idx]) * r, Y = cy + Math.sin(trA[idx]) * r;
        ctx.moveTo(X + s, Y); ctx.arc(X, Y, s, 0, TAU);
      }
      ctx.fillStyle = `rgba(127,212,207,${(.6 - b * .14).toFixed(2)})`; ctx.fill();
    }
    // UGV heading (apricot) and flock heading (teal, length = order Φ)
    const arrow = (a, len, col, dash) => {
      const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len;
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
      const hx = Math.cos(a), hy = Math.sin(a);
      ctx.beginPath(); ctx.moveTo(ex - hx * 6 - hy * 4, ey - hy * 6 + hx * 4); ctx.lineTo(ex, ey); ctx.lineTo(ex - hx * 6 + hy * 4, ey - hy * 6 - hx * 4); ctx.stroke();
    };
    arrow(uth, rc - 1, ugvOn ? C.apricot : 'rgba(246,210,177,.4)', ugvOn ? [] : [2, 3]);
    arrow(mth, Math.max(4, rc * phi), C.teal, []);
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(cx, cy, 1.8, 0, TAU); ctx.fill();
    const tx = cx + rc + 12;
    text(ctx, l1, tx, cy - 3, { size: fs, color: C.ink, weight: 500 });
    text(ctx, l2, tx, cy + fs2 + 3, { size: fs2, color: C.muted });
  }
  // a canvas label on a soft backing so it stays legible over the moving flock
  function label(str, X, Y, size, color, weight, a) {
    ctx.font = `${weight} ${size}px ${F.sans}`; const tw = ctx.measureText(str).width;
    X = clamp(X, 18 + tw / 2, cv.w - 18 - tw / 2);
    ctx.fillStyle = `rgba(27,30,61,${(.72 * a).toFixed(3)})`; roundRect(ctx, X - tw / 2 - 6, Y - size + 1, tw + 12, size + 6, 7); ctx.fill();
    text(ctx, str, X, Y, { size, color, weight, align: 'center' });
  }
  function draw(t) {
    const w = cv.w, h = cv.h; cv.clear();
    // the floor
    ctx.strokeStyle = 'rgba(220,214,236,.045)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 1; k < Lx; k++) { const X = Math.round(k * S) + .5; ctx.moveTo(X, 0); ctx.lineTo(X, h); }
    for (let k = 1; k < Ly; k++) { const Y = Math.round(k * S) + .5; ctx.moveTo(0, Y); ctx.lineTo(w, Y); }
    ctx.stroke();
    const UX = ux * S, UY = uy * S, RP = RH * S;
    // the field: weak, local, felt like a magnet
    if (ugvOn) {
      const k = .35 + .65 * pull / .1;
      const g = ctx.createRadialGradient(UX, UY, 0, UX, UY, RP);
      g.addColorStop(0, `rgba(246,210,177,${(.2 * k).toFixed(3)})`); g.addColorStop(.7, `rgba(246,210,177,${(.075 * k).toFixed(3)})`); g.addColorStop(1, 'rgba(246,210,177,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(UX, UY, RP, 0, TAU); ctx.fill();
      ctx.setLineDash([3, 6]); ctx.strokeStyle = 'rgba(246,210,177,.38)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(UX, UY, RP, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    // a tapped destination (the tap equivalent of dragging), shown while the UGV drives there
    if (tgt && tapT > 0) {
      ctx.strokeStyle = `rgba(246,210,177,${(.55 * Math.min(1, tapT)).toFixed(3)})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(tgt.x * S, tgt.y * S, 9, 0, TAU); ctx.stroke();
    }
    drawAgents();
    if (drag || hover) { ctx.strokeStyle = 'rgba(246,210,177,.45)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(UX, UY, ugvLen() * .95, 0, TAU); ctx.stroke(); }
    drawUgv(UX, UY, uth, ugvOn);
    // direct labels (the cue under the UGV fades once someone has moved it)
    const ul = ugvLen() * .95, below = UY + ul + 34 < h - 18;
    const ly0 = below ? UY + ul + 14 : UY - ul - 22;
    label(ugvOn ? 'UGV' : 'UGV off', UX, ly0, 12, ugvOn ? C.apricot : 'rgba(246,210,177,.6)', 500, 1);
    if (cueA > .01) label('drag it, or tap where it should drive', UX, ly0 + 16, 11, `rgba(246,210,177,${(.75 * cueA).toFixed(3)})`, 400, cueA);
    if (ugvOn) {
      const lab = 'only drones in here feel it', lt = UY - RP + 22, lb = UY + RP - 14;
      if (lt > 22 && lt < UY - ul - 18) label(lab, UX, lt, 11, 'rgba(246,210,177,.8)', 400, 1);
      else if (lb < h - 18 && lb > ly0 + (cueA > .01 ? 34 : 20)) label(lab, UX, lb, 11, 'rgba(246,210,177,.8)', 400, 1);
    }
    drawHud(w, h, t);
  }

  // ------------------------------------------------------------ loop
  const loop = kit.loop((dt, t) => {
    moveUgv(dt);
    if (tapT > 0) tapT -= dt;
    if (touched && cueA > 0) cueA = Math.max(0, cueA - dt / .8);
    acc += dt * SPS; let n = 0;
    while (acc >= 1 && n < 8) { step(); acc -= 1; n++; }
    if (acc > 1) acc = 0;
    measure(dt); primed = true;
    draw(t);
    rAl.set(Math.round(alS * 100) + ' %');
    rFelt.set(Math.round(feltS * 100) + ' %');
    rCmd.set('0');
  });
  draw(0);
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

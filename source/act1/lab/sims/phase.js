// A new mission is a change of phase: attractors, a saddle-node bifurcation and hysteresis.
// Left, the decision landscape V(x) = x⁴/4 − x²/2 − h·x with a marble obeying ẍ = −V'(x) − γẋ + noise. While
// |h| < 2/(3√3) ≈ 0.385 there are two valleys (attractors); past that one valley vanishes (saddle-node bifurcation) and
// the marble rolls into the other. Pulling h back a little brings the old valley back, but the marble is no longer in
// it: hysteresis, so a noisy signal cannot make the swarm flip-flop.
// Right, ~90 agents blended by m = smoothstep(marble x): m = 0 search (mutual repulsion + wander = even spread),
// m = 1 converge (orbit the survivor at a safe radius, keeping spacing). No agent is ever sent a mode.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp, lerp, plot, gauss } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  cv.cv.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2;
  const HC = 2 / (3 * Math.sqrt(3));          // ≈ 0.385, the two tipping points are h = ±HC
  const GAM = 1.2, SIG = .07, TS = 5;       // marble damping, marble noise, landscape time units per second
  const HN_SIG = .1, HN_TAU = .35;            // 'Noisy': Ornstein-Uhlenbeck jitter added to h
  const H0 = -.2;
  const V = (x, h) => x * x * x * x / 4 - x * x / 2 - h * x;
  const dV = (x, h) => x * x * x - x - h;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // real roots of V'(x) = x³ − x − h = 0, ascending, into R3; returns how many (3: valley, hilltop, valley; 1: a valley)
  const R3 = new Float64Array(3);
  function roots(h) {
    if (Math.abs(h) < HC) {
      const m = 2 / Math.sqrt(3), ph = Math.acos(clamp(h / HC, -1, 1)) / 3;
      R3[2] = m * Math.cos(ph); R3[1] = m * Math.cos(ph - TAU / 3); R3[0] = m * Math.cos(ph - 2 * TAU / 3);
      if (R3[0] > R3[1]) { const t = R3[0]; R3[0] = R3[1]; R3[1] = t; }
      return 3;
    }
    const s = Math.sqrt(h * h / 4 - 1 / 27);
    R3[0] = Math.cbrt(h / 2 + s) + Math.cbrt(h / 2 - s); return 1;
  }
  const leftValley = (h) => { roots(h); return R3[0]; };

  // ------------------------------------------------------------ state
  let h = H0, noisy = 0, hn = 0, he = H0;
  let mx = leftValley(H0), mvel = 0, mode = 0, switches = 0, m = 0;
  let plain = 0, plainAbove = false, plainT = 0;
  const TR = 160, trH = new Float32Array(TR), trX = new Float32Array(TR); let trI = 0, trN = 0, trT = 0;

  // ------------------------------------------------------------ controls and readouts (labels fixed by the brief)
  const fmtH = (v) => (v < -.004 ? '−' : v > .004 ? '+' : '') + Math.abs(v).toFixed(2);
  const sH = kit.slider(controls, { label: 'Survivor signal', min: -.6, max: .6, step: .01, value: H0, fmt: fmtH, onInput: (v) => { h = v; } });
  kit.toggle(controls, { label: 'Signal', options: [{ v: 0, label: 'Clean' }, { v: 1, label: 'Noisy' }], value: 0,
    onChange: (v) => { noisy = v; hn = 0; plain = 0; plainT = 0; plainAbove = h > HC; } });
  kit.button(controls, { label: 'Reset to search', onClick: reset });
  const rMode = kit.readout(readouts, { label: 'Mode', tone: 'heat' });
  const rVal = kit.readout(readouts, { label: 'Valleys', tone: 'haze' });
  const rSw = kit.readout(readouts, { label: 'Mode switches', tone: 'ink' });
  function reset() {
    h = H0; sH.set(H0); hn = 0; he = H0; mx = leftValley(H0); mvel = 0; mode = 0; switches = 0;
    plain = 0; plainT = 0; plainAbove = false; trN = 0;
  }

  // ------------------------------------------------------------ the marble
  function marbleStep(dt) {
    if (noisy) { hn += -hn / HN_TAU * dt + HN_SIG * Math.sqrt(2 * dt / HN_TAU) * gauss(); hn = clamp(hn, -.4, .4); } else hn = 0;
    he = h + hn;
    const T = dt * TS, n = Math.max(1, Math.ceil(T / .02)), ds = T / n, sq = SIG * Math.sqrt(ds);
    for (let i = 0; i < n; i++) {
      const a = -dV(mx, he) - GAM * mvel;
      mvel += a * ds + sq * gauss(); mx += mvel * ds;
    }
    if (!Number.isFinite(mx) || !Number.isFinite(mvel)) { mx = leftValley(Math.min(he, HC * .9)); mvel = 0; }
    mx = clamp(mx, -2.2, 2.2);
    // which basin the marble has committed to (a small dead band so a wobble on the hilltop is not a switch)
    if (mode === 0 && mx > .3) { mode = 1; switches++; } else if (mode === 1 && mx < -.3) { mode = 0; switches++; }
    m = smooth(-.45, .45, mx);
    // a plain on/off threshold at the same tipping point, sampled 10 times a second, for comparison
    if (noisy) { plainT += dt; while (plainT >= .1) { plainT -= .1; const ab = he > HC; if (ab !== plainAbove) { plain++; plainAbove = ab; } } }
    trT += dt; if (trT >= .05) { trT = 0; trH[trI] = he; trX[trI] = mx; trI = (trI + 1) % TR; trN = Math.min(TR, trN + 1); }
  }

  // ------------------------------------------------------------ layout (all from cv.w / cv.h)
  const Lp = { x: 0, y: 0, w: 1, h: 1 }, Rp = { x: 0, y: 0, w: 1, h: 1 }, room = { x: 0, y: 0, w: 1, h: 1 };
  const SV = { x: .7, y: .4 };                // survivor, as a fraction of the room
  let side = true, titleY = 30, y0 = 60, y1 = 300, fillB = 320, diag = null, small = false, band = 42, vTop = 1;
  function layout() {
    const w = cv.w, hh = cv.h;
    side = w >= 560 && w / hh > 1.15; small = w < 520 || hh < 380;
    if (side) { const half = Math.round(w / 2); Object.assign(Lp, { x: 0, y: 0, w: half, h: hh }); Object.assign(Rp, { x: half, y: 0, w: w - half, h: hh }); }
    else { const top = Math.round(hh * .56); Object.assign(Lp, { x: 0, y: 0, w, h: top }); Object.assign(Rp, { x: 0, y: top, w, h: hh - top }); }
    titleY = side ? 34 : 28;
    y0 = Lp.y + titleY + (side ? 34 : 26);
    band = side ? 42 : 30; vTop = side ? 1 : .8;
    diag = null;
    if (side && Lp.h >= 400) {
      const dh = Math.round(clamp(Lp.h * .34, 130, 190));
      diag = { x: Lp.x + 20, y: Lp.y + Lp.h - 20 - dh, w: Lp.w - 40, h: dh };
      y1 = diag.y - 16; fillB = diag.y - 8;
    } else { y1 = Lp.y + Lp.h - (side ? 22 : 10); fillB = Lp.y + Lp.h; }
    SV.x = .7; SV.y = side ? .4 : .5;
    const rt = Rp.y + titleY + (side ? 16 : 12), rb = Rp.y + Rp.h - (side ? 42 : 32);
    const nw = Rp.w - 44, nh = Math.max(60, rb - rt);
    if (Math.abs(nw - room.w) > .5 || Math.abs(nh - room.h) > .5) { rescaleAgents(room.w, room.h, nw, nh); }
    Object.assign(room, { x: Rp.x + 22, y: rt, w: nw, h: nh });
  }

  // ------------------------------------------------------------ the swarm (room-local px)
  const NA = 90;
  const ax = new Float64Array(NA), ay = new Float64Array(NA), vx = new Float64Array(NA), vy = new Float64Array(NA), wa = new Float64Array(NA);
  const nxt = new Int32Array(NA); let head = new Int32Array(1), gw = 1, gh = 1, cell = 1;
  let agentsReady = false;
  function rescaleAgents(ow, oh, nw, nh) {
    if (!agentsReady) return;
    const fx = nw / ow, fy = nh / oh;
    for (let i = 0; i < NA; i++) { ax[i] *= fx; ay[i] *= fy; }
  }
  function seedAgents() {
    const W = room.w, H = room.h, cols = Math.max(1, Math.round(Math.sqrt(NA * W / H))), rows = Math.ceil(NA / cols);
    for (let i = 0; i < NA; i++) {
      const c = i % cols, r = (i / cols) | 0;
      ax[i] = (c + .5 + (Math.random() - .5) * .6) / cols * W; ay[i] = (r + .5 + (Math.random() - .5) * .6) / rows * H;
      vx[i] = vy[i] = 0; wa[i] = Math.random() * TAU;
    }
    agentsReady = true;
  }
  function orbitRadius(d0) {
    const sx = SV.x * room.w, sy = SV.y * room.h, wall = Math.min(sx, sy, room.w - sx, room.h - sy);
    return clamp(1.45 * d0, 14, Math.max(14, wall - 1.1 * d0));
  }
  function swarmStep(dt) {
    const W = room.w, H = room.h, d0 = Math.sqrt(W * H / NA);
    const sx = SV.x * W, sy = SV.y * H, r0 = orbitRadius(d0), sc = .27 * d0;
    const rRep = lerp(1.15 * d0, sc, m), kRep = lerp(1.7, 2.6, m) * d0;
    const vmax = 3 * d0, wr = .5 * d0, relax = 1 - Math.exp(-5 * dt), wanderS = .55 * d0, orbit = .8 * d0;
    // spatial hash (cells as large as the current repulsion range)
    cell = Math.max(rRep, 4); gw = Math.max(1, Math.ceil(W / cell)); gh = Math.max(1, Math.ceil(H / cell));
    if (head.length < gw * gh) head = new Int32Array(gw * gh);
    head.fill(-1, 0, gw * gh);
    for (let i = 0; i < NA; i++) { const c = clamp((ay[i] / cell) | 0, 0, gh - 1) * gw + clamp((ax[i] / cell) | 0, 0, gw - 1); nxt[i] = head[c]; head[c] = i; }
    const sdt = Math.sqrt(dt), r2 = rRep * rRep;
    for (let i = 0; i < NA; i++) {
      const xi = ax[i], yi = ay[i];
      let fx = 0, fy = 0;
      const cx = clamp((xi / cell) | 0, 0, gw - 1), cy = clamp((yi / cell) | 0, 0, gh - 1);
      for (let yy = Math.max(0, cy - 1); yy <= Math.min(gh - 1, cy + 1); yy++) for (let xx = Math.max(0, cx - 1); xx <= Math.min(gw - 1, cx + 1); xx++) {
        for (let j = head[yy * gw + xx]; j >= 0; j = nxt[j]) {
          if (j === i) continue;
          const dx = xi - ax[j], dy = yi - ay[j], d2 = dx * dx + dy * dy;
          if (d2 < r2 && d2 > 1e-6) { const d = Math.sqrt(d2), k = (1 - d / rRep) * kRep / d; fx += dx * k; fy += dy * k; }
        }
      }
      // search: a slow random wander
      wa[i] += gauss() * 1.8 * sdt;
      const wx = Math.cos(wa[i]) * wanderS, wy = Math.sin(wa[i]) * wanderS;
      // converge: settle on the safe radius around the survivor and circulate
      const dx = xi - sx, dy = yi - sy, r = Math.hypot(dx, dy) || 1e-3, ux = dx / r, uy = dy / r;
      const vr = clamp(2.2 * (r0 - r), -vmax, vmax), vt = orbit * clamp(1 - Math.abs(r - r0) / (3 * d0), 0, 1);
      const cxv = ux * vr - uy * vt, cyv = uy * vr + ux * vt;
      // walls push back
      if (xi < wr) fx += (wr - xi) / wr * 2 * d0; else if (xi > W - wr) fx -= (xi - W + wr) / wr * 2 * d0;
      if (yi < wr) fy += (wr - yi) / wr * 2 * d0; else if (yi > H - wr) fy -= (yi - H + wr) / wr * 2 * d0;
      let tx = (1 - m) * wx + m * cxv + fx, ty = (1 - m) * wy + m * cyv + fy;
      vx[i] += (tx - vx[i]) * relax; vy[i] += (ty - vy[i]) * relax;
      const sp = Math.hypot(vx[i], vy[i]); if (sp > vmax) { vx[i] *= vmax / sp; vy[i] *= vmax / sp; }
    }
    for (let i = 0; i < NA; i++) {
      let X = ax[i] + vx[i] * dt, Y = ay[i] + vy[i] * dt;
      if (!Number.isFinite(X) || !Number.isFinite(Y)) { X = Math.random() * W; Y = Math.random() * H; vx[i] = vy[i] = 0; }
      ax[i] = clamp(X, 2, W - 2); ay[i] = clamp(Y, 2, H - 2);
    }
  }

  // ------------------------------------------------------------ drawing: the decision landscape
  const XL = 1.75, VB = -1.15;
  let X0 = 0, X1 = 1;
  const PX = (x) => X0 + (x + XL) / (2 * XL) * (X1 - X0);
  const PY = (v) => (y1 - band) - (v - VB) / (vTop - VB) * ((y1 - band) - y0);
  function curvePath(hv, xa, xb, n) {
    ctx.beginPath();
    for (let k = 0; k <= n; k++) { const x = xa + (xb - xa) * k / n, X = PX(x), Y = PY(V(x, hv)); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
  }
  // the two valley labels sit on one baseline under the valleys; shrink and push apart so they never collide
  const LBL = [{ name: 'search:', rest: 'spread out' }, { name: 'converge:', rest: 'gather at the survivor' }];
  function valleyLabels(xs, on, gone) {
    const sizes = small ? [11.5, 10.5] : [12.5, 11.5];
    let fs = sizes[0];
    for (const f of sizes) {
      fs = f;
      for (let k = 0; k < 2; k++) {
        const L = LBL[k];
        ctx.font = `600 ${f}px ${F.sans}`; L.w1 = ctx.measureText(L.name + ' ').width;
        ctx.font = `400 ${f}px ${F.sans}`; L.tw = L.w1 + ctx.measureText(L.rest).width;
        L.xl = clamp(PX(xs[k]) - L.tw / 2, X0, X1 - L.tw);
      }
      const A = LBL[0], B = LBL[1];
      let ov = A.xl + A.tw + 16 - B.xl;
      if (ov > 0) { A.xl = clamp(A.xl - ov / 2, X0, X1 - A.tw); B.xl = clamp(B.xl + ov / 2, X0, X1 - B.tw); ov = A.xl + A.tw + 16 - B.xl; }
      if (ov > 0) { A.xl = Math.max(X0, B.xl - 16 - A.tw); }
      if (A.xl + A.tw + 16 <= B.xl + .5) break;
    }
    for (let k = 0; k < 2; k++) {
      const L = LBL[k], g = gone[k], Y = y1 - (g ? 24 : 12);
      const c1 = g ? C.faint : on[k] ? C.ink : C.muted, c2 = g ? C.faint : on[k] ? C.muted : C.faint;
      text(ctx, L.name, L.xl, Y, { size: fs, color: c1, weight: 600 });
      text(ctx, L.rest, L.xl + L.w1, Y, { size: fs, color: c2 });
      if (g) text(ctx, 'this valley is gone', L.xl + L.tw / 2, Y + 15, { size: 11, color: 'rgba(180,177,224,.9)', align: 'center' });
    }
  }
  function drawLandscape(t) {
    X0 = Lp.x + 22; X1 = Lp.x + Lp.w - 22;
    text(ctx, 'The decision landscape', Lp.x + 22, Lp.y + titleY, { size: small ? 12.5 : 13.5, color: C.ink, weight: 500 });
    // current signal (with its jitter when noisy)
    const hs = fmtH(he);
    ctx.font = `500 ${small ? 12 : 13}px ${F.mono}`; const hw = ctx.measureText(hs).width;
    text(ctx, hs, Lp.x + Lp.w - 22, Lp.y + titleY, { size: small ? 12 : 13, color: C.heat, font: F.mono, weight: 500, align: 'right' });
    text(ctx, 'signal h', Lp.x + Lp.w - 22 - hw - 8, Lp.y + titleY, { size: small ? 11 : 11.5, color: C.muted, align: 'right' });
    if (noisy) text(ctx, small ? `plain switch at +0.385: ${plain} flip${plain === 1 ? '' : 's'}` : `a plain on/off switch at +0.385 would have flipped ${plain} time${plain === 1 ? '' : 's'}`, Lp.x + Lp.w / 2, Lp.y + titleY + (side ? 22 : 17), { size: 11, color: C.rose, align: 'center' });

    const nv = roots(he), r0 = R3[0], r1 = R3[1], r2 = R3[2];
    ctx.save(); ctx.beginPath(); ctx.rect(Lp.x + 4, y0 - 8, Lp.w - 8, fillB - y0 + 8); ctx.clip();
    // ghost of a vanished valley: the landscape before the signal tilted it, dashed
    let ghostSide = 0;
    if (nv === 1) {
      ghostSide = he > 0 ? -1 : 1;
      ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(143,140,196,.6)'; ctx.lineWidth = 1.5;
      curvePath(0, ghostSide < 0 ? -XL : .05, ghostSide < 0 ? -.05 : XL, 60); ctx.stroke(); ctx.setLineDash([]);
    }
    // the landscape, softly filled below
    curvePath(he, -XL, XL, 140);
    ctx.lineTo(X1, fillB); ctx.lineTo(X0, fillB); ctx.closePath();
    const g = ctx.createLinearGradient(0, y0, 0, fillB); g.addColorStop(0, 'rgba(143,140,196,.22)'); g.addColorStop(.75, 'rgba(143,140,196,.07)'); g.addColorStop(1, 'rgba(143,140,196,0)');
    ctx.fillStyle = g; ctx.fill();
    curvePath(he, -XL, XL, 140); ctx.strokeStyle = C.mist; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    // valley labels (under each valley floor) and the ghost's label
    const lx = nv === 3 ? r0 : (r0 < 0 ? r0 : null), rx = nv === 3 ? r2 : (r0 > 0 ? r0 : null);
    valleyLabels([lx === null ? -1 : lx, rx === null ? 1 : rx], [mode === 0, mode === 1], [lx === null, rx === null]);
    // hilltop between the valleys
    if (nv === 3) { ctx.fillStyle = 'rgba(220,228,238,.55)'; ctx.beginPath(); ctx.arc(PX(r1), PY(V(r1, he)), 2.2, 0, TAU); ctx.fill(); }
    // the marble, resting on the curve
    const mr = small ? 7 : 9, ky = ((y1 - band) - y0) / (vTop - VB), kx = (X1 - X0) / (2 * XL);
    const sl = dV(mx, he), nx = -sl * ky, ny = -kx, nl = Math.hypot(nx, ny);
    const MX = PX(mx) + nx / nl * mr, MY = PY(V(mx, he)) + ny / nl * mr;
    const gl = ctx.createRadialGradient(MX, MY, 0, MX, MY, mr * 3.2); gl.addColorStop(0, 'rgba(255,195,107,.35)'); gl.addColorStop(1, 'rgba(255,195,107,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(MX, MY, mr * 3.2, 0, TAU); ctx.fill();
    ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(MX, MY, mr, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,215,.75)'; ctx.beginPath(); ctx.arc(MX - mr * .32, MY - mr * .35, mr * .3, 0, TAU); ctx.fill();
    ctx.restore();
    if (diag) drawDiagram();
  }

  // the same story as a bifurcation diagram: resting places x* against the signal h (static branches, built once)
  const BR = { lo: [], mid: [], hi: [] };
  for (let k = 0; k <= 60; k++) {
    const hl = -.6 + (HC - .0005 + .6) * k / 60; roots(hl); BR.lo.push([hl, R3[0]]);
    const hm = -HC + .0005 + (2 * HC - .001) * k / 60; roots(hm); BR.mid.push([hm, R3[1]]);
    const hu = -HC + .0005 + (.6 + HC - .0005) * k / 60; roots(hu); BR.hi.push([hu, roots(hu) === 3 ? R3[2] : R3[0]]);
  }
  const trailPool = Array.from({ length: TR }, () => [0, 0]), trail = [];
  function drawDiagram() {
    trail.length = 0;
    for (let k = trN - 1; k >= 0; k--) { const i = (trI - 1 - k + TR) % TR, p = trailPool[k]; p[0] = trH[i]; p[1] = trX[i]; trail.push(p); }
    const D = diag;
    const { px, py } = plot(ctx, D, [
      { pts: BR.lo, color: 'rgba(220,228,238,.75)', width: 2 },
      { pts: BR.hi, color: 'rgba(220,228,238,.75)', width: 2 },
      { pts: BR.mid, color: 'rgba(220,228,238,.3)', width: 1.5, dash: [3, 4] },
      { pts: trail, color: 'rgba(255,195,107,.5)', width: 1.5 },
    ], { xMin: -.6, xMax: .6, yMin: -1.5, yMax: 1.5, yLabel: 'where the marble can rest' });
    text(ctx, 'signal h \u2192', D.x + D.w - 16, py(-1.5) - 7, { size: 11, color: C.faint, align: 'right' });
    // tipping points
    ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(143,140,196,.55)'; ctx.lineWidth = 1;
    for (const s of [-1, 1]) { const X = px(s * HC); ctx.beginPath(); ctx.moveTo(X, D.y + 26); ctx.lineTo(X, D.y + D.h - 22); ctx.stroke(); }
    ctx.setLineDash([]);
    text(ctx, '−0.385', px(-HC), D.y + D.h - 7, { size: 10.5, color: 'rgba(180,177,224,.85)', font: F.mono, align: 'center' });
    text(ctx, '+0.385', px(HC), D.y + D.h - 7, { size: 10.5, color: 'rgba(180,177,224,.85)', font: F.mono, align: 'center' });
    text(ctx, 'tipping points', (px(-HC) + px(HC)) / 2, D.y + D.h - 7, { size: 10.5, color: 'rgba(180,177,224,.85)', align: 'center' });
    text(ctx, 'search', px(-.44), py(-1.13) - 9, { size: 11, color: C.muted, align: 'center' });
    text(ctx, 'converge', px(.44), py(1.13) + 17, { size: 11, color: C.muted, align: 'center' });
    // where the marble is now
    const X = px(clamp(he, -.6, .6)), Y = py(clamp(mx, -1.5, 1.5));
    ctx.fillStyle = 'rgba(255,195,107,.25)'; ctx.beginPath(); ctx.arc(X, Y, 8, 0, TAU); ctx.fill();
    ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(X, Y, 4, 0, TAU); ctx.fill();
  }

  // ------------------------------------------------------------ drawing: the swarm
  function drawSwarm(t) {
    text(ctx, 'The swarm', Rp.x + 22, Rp.y + titleY, { size: small ? 12.5 : 13.5, color: C.ink, weight: 500 });
    const ms = m.toFixed(2);
    ctx.font = `500 ${small ? 12 : 13}px ${F.mono}`; const mw = ctx.measureText(ms).width;
    text(ctx, ms, Rp.x + Rp.w - 22, Rp.y + titleY, { size: small ? 12 : 13, color: C.heat, font: F.mono, weight: 500, align: 'right' });
    text(ctx, 'mode m', Rp.x + Rp.w - 22 - mw - 8, Rp.y + titleY, { size: small ? 11 : 11.5, color: C.muted, align: 'right' });
    const { x: RX, y: RY, w: RW, h: RH } = room;
    ctx.fillStyle = 'rgba(36,40,77,.55)'; roundRect(ctx, RX, RY, RW, RH, 10); ctx.fill();
    ctx.save(); roundRect(ctx, RX, RY, RW, RH, 10); ctx.clip();
    const d0 = Math.sqrt(RW * RH / NA), SX = RX + SV.x * RW, SY = RY + SV.y * RH, s = clamp((he + .6) / 1.2, 0, 1);
    // the survivor's signal: a soft glow and slow pulses, stronger as h grows
    const gr = d0 * (1.2 + 2.2 * s);
    const g = ctx.createRadialGradient(SX, SY, 0, SX, SY, gr); g.addColorStop(0, `rgba(255,195,107,${(.1 + .32 * s).toFixed(3)})`); g.addColorStop(1, 'rgba(255,195,107,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(SX, SY, gr, 0, TAU); ctx.fill();
    for (let k = 0; k < 2; k++) {
      const ph = ((t / 1.8) + k * .5) % 1, rr = 6 + ph * gr * 1.1;
      ctx.strokeStyle = `rgba(255,195,107,${((1 - ph) * .45 * s).toFixed(3)})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(SX, SY, rr, 0, TAU); ctx.stroke();
    }
    // the safe radius the converged swarm keeps
    if (m > .02) {
      ctx.setLineDash([2, 5]); ctx.strokeStyle = `rgba(255,195,107,${(.4 * m).toFixed(3)})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(SX, SY, orbitRadius(d0), 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(143,140,196,.7)'; ctx.lineWidth = 1.8; roundRect(ctx, RX, RY, RW, RH, 10); ctx.stroke();
    // agents: a faint motion tail and a dot (two batched paths)
    const dr = small ? 2.3 : 2.8;
    ctx.beginPath();
    for (let i = 0; i < NA; i++) {
      const X = RX + ax[i], Y = RY + ay[i], sp = Math.hypot(vx[i], vy[i]); if (sp < 1) continue;
      const L = Math.min(9, sp * .12); ctx.moveTo(X - vx[i] / sp * L, Y - vy[i] / sp * L); ctx.lineTo(X, Y);
    }
    ctx.strokeStyle = 'rgba(127,212,207,.4)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < NA; i++) { const X = RX + ax[i], Y = RY + ay[i]; ctx.moveTo(X + dr, Y); ctx.arc(X, Y, dr, 0, TAU); }
    ctx.fillStyle = C.teal; ctx.fill();
    // the survivor marker on top
    ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(SX, SY, small ? 4 : 5, 0, TAU); ctx.fill();
    ctx.strokeStyle = C.bg; ctx.lineWidth = 1.5; ctx.stroke();
    const la = small ? .9 * (1 - m) : .9;   // on a phone the converged ring is too tight for the label: let it fade
    if (la > .02) text(ctx, 'survivor', SX, SY + (small ? 17 : 20), { size: 11, color: `rgba(255,195,107,${la.toFixed(3)})`, align: 'center' });
    text(ctx, 'no mode is sent: every drone reads the same signal', RX + 2, Rp.y + Rp.h - 18, { size: 11, color: C.faint });
  }

  function draw(t) {
    cv.clear();
    // divider between the two panels
    ctx.strokeStyle = 'rgba(220,214,236,.1)'; ctx.lineWidth = 1; ctx.beginPath();
    if (side) { ctx.moveTo(Rp.x + .5, 24); ctx.lineTo(Rp.x + .5, cv.h - 24); } else { ctx.moveTo(18, Rp.y + .5); ctx.lineTo(cv.w - 18, Rp.y + .5); }
    ctx.stroke();
    drawLandscape(t);
    drawSwarm(t);
  }

  // ------------------------------------------------------------ loop
  layout(); seedAgents();
  const loop = kit.loop((dt, t) => {
    marbleStep(dt);
    layout();
    const n = dt > .025 ? 2 : 1; for (let i = 0; i < n; i++) swarmStep(dt / n);
    draw(t);
    rMode.set(mode ? 'Converge' : 'Search');
    rVal.set(Math.abs(he) < HC ? '2' : '1');
    rSw.set(String(switches));
  });
  draw(0);
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

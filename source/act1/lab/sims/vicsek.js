// The edge between order and chaos (Vicsek et al. 1995). Pure Vicsek: N agents at constant speed v0 in a wrap-around
// box. Each step every agent takes the average heading of everyone within radius R (itself included) and adds noise:
//   θi(t+1) = arg( Σ_{|rj − ri| < R} e^{iθj} ) + η·U(−½, ½)
// Order Φ = |Σ e^{iθ}| / N. Susceptibility χ = N·(⟨Φ²⟩ − ⟨Φ⟩²) over a running window. Below a critical noise the
// flock moves as one; above it order collapses; χ peaks at the threshold, which is where LIMINAL takes its name from.
// Units: R = 1, density ρ = 3 agents per R², v0 = 0.05 R per step, 50 steps per second.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  cv.cv.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2;
  const RHO = 3, V0 = .05, RATE = 50, TWIN_RATE = 450, SWEEP_T = 14, WIN = 3;

  // noise lookup: angle -> (cos, sin), so a step needs no trigonometry
  const TN = 4096, CT = new Float64Array(TN + 1), ST = new Float64Array(TN + 1);
  for (let i = 0; i <= TN; i++) { const a = (i / TN - .5) * TAU; CT[i] = Math.cos(a); ST[i] = Math.sin(a); }

  // ------------------------------------------------------------ one Vicsek flock (cell-sorted half-shell neighbour search)
  function makeFlock(N, aspect, seed) {
    let s = seed >>> 0;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const A = N / RHO, f = { N, Lx: 1, Ly: 1, phi: 0, mx: 1, my: 0 };
    const x = new Float64Array(N), y = new Float64Array(N), ux = new Float64Array(N), uy = new Float64Array(N);
    const sx = new Float64Array(N), sy = new Float64Array(N), sux = new Float64Array(N), suy = new Float64Array(N);
    const ax = new Float64Array(N), ay = new Float64Array(N), sidx = new Int32Array(N), cell = new Int32Array(N);
    let ncx = 3, ncy = 3, csx = 1, csy = 1, NC = 9, start = new Int32Array(10), cnt = new Int32Array(9);
    let nbC = new Int32Array(36), nbX = new Float64Array(36), nbY = new Float64Array(36);
    const FW = [[1, 0], [-1, 1], [0, 1], [1, 1]];
    function setAspect(a) {
      const Lx = Math.sqrt(A * a), Ly = A / Lx, kx = Lx / f.Lx, ky = Ly / f.Ly;
      for (let i = 0; i < N; i++) { x[i] = Math.min(Lx * .999999, x[i] * kx); y[i] = Math.min(Ly * .999999, y[i] * ky); }
      f.Lx = Lx; f.Ly = Ly;
      ncx = Math.max(3, Math.floor(Lx)); ncy = Math.max(3, Math.floor(Ly)); csx = Lx / ncx; csy = Ly / ncy; NC = ncx * ncy;
      start = new Int32Array(NC + 1); cnt = new Int32Array(NC); nbC = new Int32Array(NC * 4); nbX = new Float64Array(NC * 4); nbY = new Float64Array(NC * 4);
      for (let cy = 0; cy < ncy; cy++) for (let cx = 0; cx < ncx; cx++) {
        let k = (cy * ncx + cx) * 4;
        for (const [dx, dy] of FW) {
          let gx = cx + dx, gy = cy + dy, ox = 0, oy = 0;
          if (gx < 0) { gx += ncx; ox = -Lx; } else if (gx >= ncx) { gx -= ncx; ox = Lx; }
          if (gy >= ncy) { gy -= ncy; oy = Ly; }
          nbC[k] = gy * ncx + gx; nbX[k] = ox; nbY[k] = oy; k++;
        }
      }
    }
    function randomize(ordered) {
      const h0 = rnd() * TAU;
      for (let i = 0; i < N; i++) { x[i] = rnd() * f.Lx; y[i] = rnd() * f.Ly; const a = ordered ? h0 : rnd() * TAU; ux[i] = Math.cos(a); uy[i] = Math.sin(a); }
      f.phi = ordered ? 1 : 0; f.mx = Math.cos(h0); f.my = Math.sin(h0);
    }
    function step(eta) {
      const Lx = f.Lx, Ly = f.Ly;
      cnt.fill(0);
      for (let i = 0; i < N; i++) {
        let cx = (x[i] / csx) | 0, cy = (y[i] / csy) | 0; if (cx >= ncx) cx = ncx - 1; if (cy >= ncy) cy = ncy - 1; if (cx < 0) cx = 0; if (cy < 0) cy = 0;
        const c = cy * ncx + cx; cell[i] = c; cnt[c]++;
      }
      start[0] = 0; for (let c = 0; c < NC; c++) { start[c + 1] = start[c] + cnt[c]; cnt[c] = start[c]; }
      for (let i = 0; i < N; i++) { const p = cnt[cell[i]]++; sx[p] = x[i]; sy[p] = y[i]; sux[p] = ux[i]; suy[p] = uy[i]; sidx[p] = i; ax[p] = ux[i]; ay[p] = uy[i]; }
      for (let c = 0; c < NC; c++) {
        const a0 = start[c], a1 = start[c + 1]; if (a0 === a1) continue;
        for (let i = a0; i < a1; i++) {                           // pairs inside the cell
          const xi = sx[i], yi = sy[i];
          for (let j = i + 1; j < a1; j++) { const dx = sx[j] - xi, dy = sy[j] - yi; if (dx * dx + dy * dy < 1) { ax[i] += sux[j]; ay[i] += suy[j]; ax[j] += sux[i]; ay[j] += suy[i]; } }
        }
        for (let k = c * 4, ke = k + 4; k < ke; k++) {             // pairs with the four forward neighbour cells (wrapping)
          const g = nbC[k], b0 = start[g], b1 = start[g + 1]; if (b0 === b1) continue; const ox = nbX[k], oy = nbY[k];
          for (let i = a0; i < a1; i++) {
            const xi = sx[i] - ox, yi = sy[i] - oy, uxi = sux[i], uyi = suy[i]; let accx = 0, accy = 0;
            for (let j = b0; j < b1; j++) { const dx = sx[j] - xi, dy = sy[j] - yi; if (dx * dx + dy * dy < 1) { accx += sux[j]; accy += suy[j]; ax[j] += uxi; ay[j] += uyi; } }
            ax[i] += accx; ay[i] += accy;
          }
        }
      }
      const kk = eta / TAU * TN; let px = 0, py = 0;
      for (let p = 0; p < N; p++) {
        let mx = ax[p], my = ay[p], m = Math.sqrt(mx * mx + my * my); if (!(m > 1e-9)) { mx = sux[p]; my = suy[p]; m = 1; } mx /= m; my /= m;
        const ti = (TN / 2 + (rnd() - .5) * kk) | 0, cr = CT[ti], sr = ST[ti];
        const nx = mx * cr - my * sr, ny = mx * sr + my * cr; px += nx; py += ny;
        const i = sidx[p]; ux[i] = nx; uy[i] = ny;
        let a = sx[p] + V0 * nx, b = sy[p] + V0 * ny; if (a < 0) a += Lx; else if (a >= Lx) a -= Lx; if (b < 0) b += Ly; else if (b >= Ly) b -= Ly;
        x[i] = a; y[i] = b;
      }
      const mm = Math.sqrt(px * px + py * py); f.phi = mm / N; if (mm > 1e-9) { f.mx = px / mm; f.my = py / mm; }
      return f.phi;
    }
    Object.assign(f, { x, y, ux, uy, step, setAspect, randomize });
    setAspect(aspect);
    return f;
  }

  // ------------------------------------------------------------ layout
  let L = null;
  function layout() {
    const W = cv.w, H = cv.h, phone = W < 600;
    if (phone) {
      const fh = Math.round((H - 44) * .54);
      L = { phone, F: { x: 16, y: 16, w: W - 32, h: fh }, P: { x: 16, y: 16 + fh + 12, w: W - 32, h: H - fh - 44 } };
    } else {
      const fw = Math.round((W - 58) * .6);
      L = { phone, F: { x: 20, y: 20, w: fw, h: H - 40 }, P: { x: 20 + fw + 18, y: 20, w: W - fw - 58, h: H - 40 } };
    }
  }
  layout();

  // ------------------------------------------------------------ the visible flock (+ display-only interpolation and smoothed headings)
  const NV = cv.w < 600 ? 300 : 400;
  let seedN = 11;
  const flock = makeFlock(NV, L.F.w / L.F.h, seedN);
  flock.randomize(true);
  const ox = new Float64Array(NV), oy = new Float64Array(NV), ex = new Float64Array(NV), ey = new Float64Array(NV);
  for (let i = 0; i < NV; i++) { ox[i] = flock.x[i]; oy[i] = flock.y[i]; ex[i] = flock.ux[i]; ey[i] = flock.uy[i]; }
  cv.onResize(() => { layout(); flock.setAspect(L.F.w / L.F.h); for (let i = 0; i < NV; i++) { ox[i] = flock.x[i]; oy[i] = flock.y[i]; } layoutLabels(); });

  // running window for the live χ (3 s of steps)
  const WN = WIN * RATE, wbuf = new Float64Array(WN); let wn = 0, wi = 0, wsum = 0, wsum2 = 0;
  function pushPhi(p) {
    if (wn === WN) { const o = wbuf[wi]; wsum -= o; wsum2 -= o * o; } else wn++;
    wbuf[wi] = p; wsum += p; wsum2 += p * p; wi = (wi + 1) % WN;
  }
  function liveChi() { if (wn < 10) return 0; const m = wsum / wn; return Math.max(0, NV * (wsum2 / wn - m * m)); }
  function resetWindow() { wn = 0; wi = 0; wsum = 0; wsum2 = 0; }

  // ------------------------------------------------------------ smoothing and the χ peak (centroid of the top of a kernel-smoothed χ)
  const SM = 158, smE = new Float64Array(SM), smC = new Float64Array(SM), smP = new Float64Array(SM);
  for (let k = 0; k < SM; k++) smE[k] = k / (SM - 1) * TAU;
  const med = new Float64Array(64);
  function analyse(pts, n, bw, frac) {                                  // pts: flat [eta, phi, chi]*n -> {peak, lo, hi, max}, fills smC/smP
    for (let q = 0; q < n; q++) {                                 // median of 3 neighbours: one noisy segment cannot move the peak
      const a = pts[Math.max(0, q - 1) * 3 + 2], b = pts[q * 3 + 2], c = pts[Math.min(n - 1, q + 1) * 3 + 2];
      med[q] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    }
    let best = 0, bi = 0;
    for (let k = 0; k < SM; k++) {
      let sw = 0, sc = 0, sp = 0; const e = smE[k];
      for (let q = 0; q < n; q++) { const d = pts[q * 3] - e, w = Math.exp(-d * d / (2 * bw * bw)); sw += w; sc += w * med[q]; sp += w * pts[q * 3 + 1]; }
      smC[k] = sw > 0 ? sc / sw : 0; smP[k] = sw > 0 ? sp / sw : 0; if (smC[k] > best) { best = smC[k]; bi = k; }
    }
    const th = best * frac; let a = bi, b = bi; while (a > 0 && smC[a - 1] >= th) a--; while (b < SM - 1 && smC[b + 1] >= th) b++;
    let s = 0, w = 0; for (let k = a; k <= b; k++) { s += smE[k] * (smC[k] - th); w += smC[k] - th; }
    const peak = w > 0 ? s / w : smE[bi];
    const lo = Math.max(peak - .5, Math.min(peak - .2, smE[a])), hi = Math.min(peak + .5, Math.max(peak + .2, smE[b]));   // 0.2 to 0.5 each side
    return { peak, lo: Math.max(.05, lo), hi: Math.min(TAU - .05, hi), max: best };
  }

  // ------------------------------------------------------------ quick reference curve at mount: 150 agents, same density, η stepped down
  // (η, steps): more steps where the transition lives; each η starts from the previous state; first half discarded
  const REF = [[6.28, 24], [5.4, 24], [4.8, 36], [4.4, 60], [4.1, 72], [3.8, 72], [3.5, 72], [3.2, 72], [2.9, 72], [2.6, 72], [2.3, 60], [2.0, 40], [1.6, 32], [1.0, 24], [.4, 24]];
  const RN = REF.length, ref = new Float64Array(RN * 3), refC = new Float64Array(SM), refP = new Float64Array(SM);
  let refInfo, refN = 150;
  {
    const rf = makeFlock(150, 1, 5); rf.randomize(false);
    REF.forEach(([e, S], q) => {
      let m = 0, m2 = 0, n = 0;
      for (let t = 0; t < S; t++) { const p = rf.step(e); if (t >= S / 2) { m += p; m2 += p * p; n++; } }
      m /= n; m2 /= n; const k = RN - 1 - q; ref[k * 3] = e; ref[k * 3 + 1] = m; ref[k * 3 + 2] = 150 * Math.max(0, m2 - m * m);
    });
    refInfo = analyse(ref, RN, .3, .62); refC.set(smC); refP.set(smP);
  }

  // ------------------------------------------------------------ sweeps: a twin flock (same N, density, speed) while η ramps 0 -> 2π;
  // each segment of the ramp gives one measured point (η, mean Φ, N·var Φ). A small flock's threshold sits at higher noise
  // (finite size), so once the page is on screen a hidden twin of the real flock re-measures the reference in the
  // background (~6 s, a few steps per frame). The user's sweep runs a fresh twin 9x faster than the visible flock.
  let twSeed = 100;
  function newSweep(nSteps, nPts) { const tw = makeFlock(NV, L.F.w / L.F.h, ++twSeed); tw.randomize(true); return { tw, nSteps, nPts, done: 0, n: 0, m: 0, m2: 0, k: 0, e: 0, pts: new Float64Array(nPts * 3) }; }
  function advance(sw, steps) {
    const per = sw.nSteps / sw.nPts;
    for (let i = 0; i < steps && sw.done < sw.nSteps; i++) {
      const e = (sw.done + .5) / sw.nSteps * TAU, p = sw.tw.step(e);
      sw.m += p; sw.m2 += p * p; sw.k++; sw.e += e; sw.done++;
      if (sw.done >= (sw.n + 1) * per - 1e-6 && sw.n < sw.nPts) {
        const m = sw.m / sw.k, m2 = sw.m2 / sw.k, q = sw.n * 3;
        sw.pts[q] = sw.e / sw.k; sw.pts[q + 1] = m; sw.pts[q + 2] = NV * Math.max(0, m2 - m * m); sw.n++;
        sw.m = sw.m2 = sw.k = sw.e = 0;
      }
    }
    return sw.done >= sw.nSteps;
  }
  let calib = newSweep(7200, 36), user = null, swInfo = null, measured = false, twAcc = 0;
  const swC = new Float64Array(SM);
  let band = { peak: refInfo.peak, lo: refInfo.lo, hi: refInfo.hi }, bandTo = { ...band };
  function calibStep() {
    if (!calib) return;
    if (advance(calib, 16)) {
      refInfo = analyse(calib.pts, calib.n, .3, .62); refC.set(smC); refP.set(smP); refN = NV; calib = null;
      if (!measured) bandTo = { peak: refInfo.peak, lo: refInfo.lo, hi: refInfo.hi };
    }
  }
  function startSweep() {
    user = newSweep(Math.round(SWEEP_T * TWIN_RATE), 28); twAcc = 0; measured = false; swInfo = null;
    bSweep.textContent = 'Sweeping…';
  }
  function endSweep(completed) {
    const sw = user; user = null; bSweep.textContent = 'Sweep the noise';
    if (completed && sw && sw.n >= 8) {
      swInfo = analyse(sw.pts, sw.n, .3, .62); swC.set(smC); measured = true; shown = sw;
      bandTo = { peak: swInfo.peak, lo: swInfo.lo, hi: swInfo.hi };
      eta = swInfo.peak; sEta.set(eta);
    }
  }
  let shown = null;                                               // the sweep whose dots are on the plot
  function sweepStep(dt) {
    twAcc += dt * TWIN_RATE; let n = Math.floor(twAcc); twAcc -= n; n = Math.min(n, 40);
    const fin = advance(user, n); shown = user;
    eta = Math.min(TAU, user.done / user.nSteps * TAU); sEta.set(eta);
    if (fin) endSweep(true);
  }

  // ------------------------------------------------------------ controls and readouts
  let eta = 1.6;
  const sEta = kit.slider(controls, { label: 'Noise η', min: 0, max: 6.28, step: .01, value: eta, fmt: (v) => v.toFixed(2), onInput: (v) => { if (user) endSweep(false); eta = v; } });
  const bSweep = kit.button(controls, { label: 'Sweep the noise', kind: 'primary', onClick: () => { if (user) endSweep(false); else startSweep(); } });
  kit.button(controls, { label: 'Reset', onClick: () => {
    if (user) endSweep(false);
    seedN++; flock.randomize(true); for (let i = 0; i < NV; i++) { ox[i] = flock.x[i]; oy[i] = flock.y[i]; ex[i] = flock.ux[i]; ey[i] = flock.uy[i]; }
    eta = 1.6; sEta.set(eta); shown = null; measured = false; swInfo = null; bandTo = { peak: refInfo.peak, lo: refInfo.lo, hi: refInfo.hi };
    resetWindow(); phiS = 1; trailN = 0;
  } });
  const rPhi = kit.readout(readouts, { label: 'Order Φ', tone: 'teal' });
  const rChi = kit.readout(readouts, { label: 'Susceptibility χ', tone: 'heat' });
  const rPhase = kit.readout(readouts, { label: 'Phase', tone: 'ink' });
  // a word, not a number: a touch smaller, and a fixed width so the dock never reflows when the phase changes
  rPhi.el.style.minWidth = '84px'; rChi.el.style.minWidth = '96px';
  { ctx.font = `500 13px ${F.sans}`; bSweep.style.minWidth = Math.ceil(ctx.measureText('Sweep the noise').width + 34) + 'px'; }   // same width while 'Sweeping…'
  const phaseB = rPhase.el.querySelector('b'), pfs = cv.w < 600 ? 18 : 19; phaseB.style.fontSize = pfs + 'px';
  { ctx.font = `500 ${pfs}px ${F.mono}`; rPhase.el.style.minWidth = Math.ceil(ctx.measureText('near critical').width * .98 + 2) + 'px'; }

  // ------------------------------------------------------------ stepping the visible flock at a fixed rate
  let acc = 0, alpha = 0, phiS = flock.phi, aligned = 0, trailN = 0, trailT = 0;
  const TR = 46, trE = new Float64Array(TR), trP = new Float64Array(TR); let trI = 0;
  function visibleStep() {
    for (let i = 0; i < NV; i++) { ox[i] = flock.x[i]; oy[i] = flock.y[i]; }
    const p = flock.step(eta); pushPhi(p);
    for (let i = 0; i < NV; i++) { ex[i] += (flock.ux[i] - ex[i]) * .14; ey[i] += (flock.uy[i] - ey[i]) * .14; }
  }

  // ------------------------------------------------------------ drawing
  function halo(str, X, Y, o) {                                  // text with a soft backing so it reads over moving agents
    ctx.font = `${o.weight || 400} ${o.size || 12}px ${o.font || F.sans}`; ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(30,33,64,.92)'; ctx.strokeText(str, X, Y);
    ctx.fillStyle = o.color; ctx.fillText(str, X, Y);
  }
  let lw = {};
  function layoutLabels() { ctx.font = `500 12px ${F.sans}`; lw.band = ctx.measureText('liminal: the threshold').width; }
  layoutLabels();
  const COS30 = Math.cos(Math.PI / 6);
  function drawFlock() {
    const { F: R, phone } = L, s = R.w / flock.Lx, tick = phone ? 5 : 6.8;
    ctx.fillStyle = 'rgba(36,40,77,.55)'; roundRect(ctx, R.x, R.y, R.w, R.h, 14); ctx.fill();
    ctx.save(); roundRect(ctx, R.x, R.y, R.w, R.h, 14); ctx.clip();
    const mx = flock.mx, my = flock.my, hx = flock.Lx / 2, hy = flock.Ly / 2;
    const pT = new Path2D(), pR = new Path2D(); let nA = 0;
    for (let i = 0; i < NV; i++) {
      let dx = flock.x[i] - ox[i], dy = flock.y[i] - oy[i];
      const wrap = dx > hx || dx < -hx || dy > hy || dy < -hy;
      const X = R.x + (wrap ? flock.x[i] : ox[i] + dx * alpha) * s, Y = R.y + (wrap ? flock.y[i] : oy[i] + dy * alpha) * s;
      const m = Math.sqrt(ex[i] * ex[i] + ey[i] * ey[i]) + 1e-9, hx2 = ex[i] / m, hy2 = ey[i] / m;
      const ok = hx2 * mx + hy2 * my > COS30; if (ok) nA++;
      const p = ok ? pT : pR; p.moveTo(X - hx2 * tick * .55, Y - hy2 * tick * .55); p.lineTo(X + hx2 * tick * .45, Y + hy2 * tick * .45);
    }
    aligned = nA / NV;
    ctx.lineCap = 'round'; ctx.lineWidth = phone ? 1.5 : 1.7;
    ctx.strokeStyle = 'rgba(239,177,180,.9)'; ctx.stroke(pR);
    ctx.strokeStyle = C.teal; ctx.stroke(pT);
    // one agent's neighbourhood: the radius R it listens within
    const i0 = 0, X0 = R.x + flock.x[i0] * s, Y0 = R.y + flock.y[i0] * s;
    ctx.strokeStyle = 'rgba(243,238,242,.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(X0, Y0, s, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    halo('R', X0 + s * .72 + 3, Y0 - s * .72, { size: 11, color: C.muted, font: F.mono });
    ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; roundRect(ctx, R.x + .5, R.y + .5, R.w - 1, R.h - 1, 14); ctx.stroke();
    // direct labels
    const fs = phone ? 11 : 12, pa = Math.round(aligned * 100);
    halo(`aligned ${pa}%`, R.x + 14, R.y + 22, { size: fs, color: C.teal });
    halo(`deviating ${100 - pa}%`, R.x + 14 + (phone ? 82 : 96), R.y + 22, { size: fs, color: C.rose });
    if (!phone) halo('within 30° of the average heading', R.x + 14, R.y + 39, { size: 11, color: C.faint });
    // the average arrow: its length is Φ
    const cr = phone ? 15 : 21, cx = R.x + R.w - cr - (phone ? 14 : 18), cy = R.y + R.h - cr - (phone ? 12 : 16);
    ctx.fillStyle = 'rgba(27,30,61,.7)'; ctx.beginPath(); ctx.arc(cx, cy, cr + 4, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(243,238,242,.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, cr, 0, TAU); ctx.stroke();
    const L2 = cr * flock.phi, tx = cx + mx * L2, ty = cy + my * L2;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
    if (L2 > 5) { const a = Math.atan2(my, mx); ctx.beginPath(); ctx.moveTo(tx - Math.cos(a - .5) * 5, ty - Math.sin(a - .5) * 5); ctx.lineTo(tx, ty); ctx.lineTo(tx - Math.cos(a + .5) * 5, ty - Math.sin(a + .5) * 5); ctx.stroke(); }
    halo(phone ? 'length = Φ' : 'average arrow, length = Φ', cx - cr - 10, cy + 4, { size: phone ? 10.5 : 11, color: C.muted, align: 'right' });
  }

  function drawPlot() {
    const { P: R, phone } = L;
    const yMax = 1.34;
    const { px, py } = kit.plot(ctx, R, [], { xMin: 0, xMax: TAU, yMin: 0, yMax, panel: true });
    const top = R.y + (phone ? 28 : 46), bot = R.y + R.h - 22;     // the band starts below the label rows
    // gridline at Φ = 1
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(R.x + 14, py(1)); ctx.lineTo(R.x + R.w - 14, py(1)); ctx.stroke();
    text(ctx, '1', R.x + 18, py(1) - 4, { size: 10.5, color: C.faint, font: F.mono });
    // the band where χ peaks
    const b0 = px(band.lo), b1 = px(band.hi), bp = px(band.peak);
    ctx.fillStyle = 'rgba(255,195,107,.11)'; ctx.fillRect(b0, top, b1 - b0, bot - top);
    ctx.strokeStyle = 'rgba(255,195,107,.4)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(b0, top); ctx.lineTo(b0, bot); ctx.moveTo(b1, top); ctx.lineTo(b1, bot); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,195,107,.75)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(bp, py(1.1)); ctx.lineTo(bp, bot); ctx.stroke();
    const lx = clamp(bp, R.x + 16 + lw.band / 2, R.x + R.w - 16 - lw.band / 2);
    halo('liminal: the threshold', lx, py(1.15), { size: 12, color: C.heat, weight: 500, align: 'center' });
    // reference curves (faint), clipped to the plot
    ctx.save(); ctx.beginPath(); ctx.rect(R.x + 14, R.y + 10, R.w - 28, R.h - 30); ctx.clip();
    const curve = (arr, scale, col, w, dash) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.beginPath(); for (let k = 0; k < SM; k++) { const X = px(smE[k]), Y = py(arr[k] * scale); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); } ctx.stroke(); ctx.setLineDash([]); };
    const refFaint = measured ? .22 : .5;
    curve(refP, 1, `rgba(127,212,207,${refFaint})`, 1.5, [4, 3]);
    curve(refC, .85 / Math.max(1e-9, refInfo.max), `rgba(255,195,107,${refFaint})`, 1.5, [4, 3]);
    // measured sweep: smoothed χ line once done, dots as they arrive
    // χ is scaled so the (median-filtered) top reaches 0.85: room above for the label, single spikes clipped
    const sp = shown ? shown.pts : null, swN = shown ? shown.n : 0;
    let cmax = 1e-6;
    for (let q = 0; q < swN; q++) { const a = sp[Math.max(0, q - 1) * 3 + 2], b = sp[q * 3 + 2], c = sp[Math.min(swN - 1, q + 1) * 3 + 2]; cmax = Math.max(cmax, Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))); }
    const sc = .85 / cmax;
    if (measured) curve(swC, sc, C.heat, 1.8, []);
    if (swN) {
      const r = phone ? 2.2 : 2.8;
      const pP = new Path2D(), pC = new Path2D();
      for (let q = 0; q < swN; q++) {
        const X = px(sp[q * 3]); let Y = py(sp[q * 3 + 1]); pP.moveTo(X + r, Y); pP.arc(X, Y, r, 0, TAU);
        Y = py(Math.min(1.08, sp[q * 3 + 2] * sc)); pC.moveTo(X + r, Y); pC.arc(X, Y, r, 0, TAU);
      }
      ctx.fillStyle = C.teal; ctx.fill(pP); ctx.fillStyle = C.heat; ctx.fill(pC);
    }
    // the live point (η, smoothed Φ) with a short trail
    for (let k = 1; k < trailN; k++) {
      const a = (trI - trailN + k - 1 + TR) % TR, b = (a + 1) % TR;
      ctx.strokeStyle = `rgba(243,238,242,${(k / trailN * .55).toFixed(3)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px(trE[a]), py(trP[a])); ctx.lineTo(px(trE[b]), py(trP[b])); ctx.stroke();
    }
    ctx.restore();
    const LX = px(eta), LY = py(phiS);
    ctx.fillStyle = 'rgba(243,238,242,.18)'; ctx.beginPath(); ctx.arc(LX, LY, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(LX, LY, 4.2, 0, TAU); ctx.fill();
    ctx.strokeStyle = C.bg; ctx.lineWidth = 1.2; ctx.stroke();
    // labels: the two curves (top row), what the faint/dotted curves are (second row), the two phases, the axis
    const fs = phone ? 10.5 : 11.5;
    ctx.font = `400 ${fs}px ${F.sans}`;
    const t1 = 'order Φ', t2 = phone ? 'χ, scaled' : 'susceptibility χ, scaled', w1 = ctx.measureText(t1).width;
    text(ctx, t1, R.x + 20, R.y + 22, { size: fs, color: C.teal });
    text(ctx, t2, R.x + 20 + w1 + 12, R.y + 22, { size: fs, color: C.heat });
    if (!phone) {
      const cap = user ? 'measuring: a twin flock runs 9× faster' : measured ? 'dots: measured in your sweep' : `faint: reference run, ${refN} agents${calib ? ' (refining…)' : ''}`;
      text(ctx, cap, R.x + 20, R.y + 38, { size: 11, color: C.faint });
    }
    text(ctx, 'ordered', px(0) + 8, py(.2), { size: fs, color: 'rgba(127,212,207,.6)' });
    text(ctx, 'disordered', px(TAU) - 4, py(.2), { size: fs, color: 'rgba(239,177,180,.65)', align: 'right' });
    const yb = R.y + R.h - 7;
    text(ctx, '0', px(0), yb, { size: 10.5, color: C.faint, font: F.mono, align: 'center' });
    text(ctx, 'π', px(Math.PI), yb, { size: 10.5, color: C.faint, font: F.mono, align: 'center' });
    text(ctx, '2π', px(TAU), yb, { size: 10.5, color: C.faint, font: F.mono, align: 'right' });
    text(ctx, 'noise η', px(Math.PI * 1.5), yb, { size: 11, color: C.faint, align: 'center' });
  }

  function phaseOf(e) { return e < band.lo ? 'ordered' : e > band.hi ? 'disordered' : 'near critical'; }

  // ------------------------------------------------------------ loop
  const loop = kit.loop((dt) => {
    dt = Math.max(0, Math.min(.05, dt || 0));
    if (user) sweepStep(dt);
    if (loop.running) calibStep();
    acc += dt * RATE; let n = Math.floor(acc); acc -= n; if (n > 4) n = 4;
    for (let k = 0; k < n; k++) visibleStep();
    alpha = clamp(acc, 0, 1);
    phiS += (flock.phi - phiS) * Math.min(1, dt * 2.5);
    const kb = Math.min(1, dt * 4); band.peak += (bandTo.peak - band.peak) * kb; band.lo += (bandTo.lo - band.lo) * kb; band.hi += (bandTo.hi - band.hi) * kb;
    trailT += dt; if (trailT > .045) { trailT = 0; trE[trI] = eta; trP[trI] = phiS; trI = (trI + 1) % TR; if (trailN < TR) trailN++; }
    if (loop.running) {
      cv.clear(); drawFlock(); drawPlot();
      rPhi.set(phiS.toFixed(2)); rChi.set(liveChi().toFixed(1)); rPhase.set(phaseOf(eta));
    }
  });
  cv.clear(); drawFlock(); drawPlot(); rPhi.set(phiS.toFixed(2)); rChi.set('…'); rPhase.set(phaseOf(eta));
  return { start() { loop.start(); }, stop() { loop.stop(); }, destroy() { loop.stop(); cv.destroy(); } };
}

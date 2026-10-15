// Listening for the threshold (critical slowing down; subsampling).
// The flock is the Vicsek model of vicsek.js: N agents at constant speed v0 in a wrap-around box,
//   θi(t+1) = arg( Σ_{|rj − ri| < R} e^{iθj} ) + η·U(−½, ½),   Φ = |Σ e^{iθ}| / N,   R = 1, ρ = 3, v0 = 0.05 R per step, 50 steps/s.
// A kick turns the headings of a random half of the agents by 135°. (A 90° turn is undone by a single round of
// neighbour averaging at every noise level, so its recovery time says nothing; measured, it is one step everywhere.)
// τ = time until Φ (smoothed over ~3 steps) is back within 10% of its pre-kick mean (2 s window) and stays there for
// 4 steps. If the pre-kick order is less than 4 standard deviations of its own fluctuations there is no stable order
// to knock down, and if Φ is not back within 3 s it did not recover: both count as "did not bounce back".
// Far from the threshold the order snaps back in a few steps; towards it the restoring force fades and τ grows
// (critical slowing down). One drone's view: the order of the agents within 2R of one agent (what it can hear),
// smoothed: biased high (subsampling), but its recovery time follows the flock's (checked offline: the per-noise
// means of the two correlate at 0.97).
// Single kicks scatter more and more near the threshold (the fluctuations grow: many still snap back, a growing share
// takes long or never comes back), so τ is read as an average, a kick that never came back counting as 3 s. The faint
// reference is that average over η (kernel-weighted) for the same measurement on a separate flock: a quick 100-agent
// run at mount, then a twin of the visible flock (same N, density and box) re-measures it in the background while the
// page is on screen. The threshold is where it crosses 1.5 s. The readout τ is the average of the last kicks (up to 7)
// at the current noise, and 'Distance to threshold' compares it with the reference 0.7 and 0.35 before the threshold.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  cv.cv.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2, RHO = 3, V0 = .05, RATE = 50;
  const KICK = Math.PI * .75, CAPN = 150, CAP = CAPN / RATE, HOLD = 4, EMA = .35, EMAL = .15, SNR = 4, BASEN = 100, RL = 2;
  const SETTLEN = 60, AUTO_GAP = 2.4, PRE = 25, YTOP = 3.32, YMAX = 3.62;

  const TN = 4096, CT = new Float64Array(TN + 1), ST = new Float64Array(TN + 1);
  for (let i = 0; i <= TN; i++) { const a = (i / TN - .5) * TAU; CT[i] = Math.cos(a); ST[i] = Math.sin(a); }
  const KC = Math.cos(KICK), KS = Math.sin(KICK);

  // ------------------------------------------------------------ one Vicsek flock (as in vicsek.js) + kick + local order
  function makeFlock(N, aspect, seed) {
    let s = seed >>> 0;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const A = N / RHO, f = { N, Lx: 1, Ly: 1, phi: 0, mx: 1, my: 0 };
    const x = new Float64Array(N), y = new Float64Array(N), ux = new Float64Array(N), uy = new Float64Array(N);
    const sx = new Float64Array(N), sy = new Float64Array(N), sux = new Float64Array(N), suy = new Float64Array(N);
    const ax = new Float64Array(N), ay = new Float64Array(N), sidx = new Int32Array(N), cell = new Int32Array(N), perm = new Int32Array(N);
    const kicked = new Uint8Array(N);
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
    function randomize() {
      const h0 = rnd() * TAU;
      for (let i = 0; i < N; i++) { x[i] = rnd() * f.Lx; y[i] = rnd() * f.Ly; ux[i] = Math.cos(h0); uy[i] = Math.sin(h0); }
      f.phi = 1; f.mx = Math.cos(h0); f.my = Math.sin(h0);
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
        for (let i = a0; i < a1; i++) {
          const xi = sx[i], yi = sy[i];
          for (let j = i + 1; j < a1; j++) { const dx = sx[j] - xi, dy = sy[j] - yi; if (dx * dx + dy * dy < 1) { ax[i] += sux[j]; ay[i] += suy[j]; ax[j] += sux[i]; ay[j] += suy[i]; } }
        }
        for (let k = c * 4, ke = k + 4; k < ke; k++) {
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
    // turn exactly half of the agents (a random half) by 135°; returns Φ right after
    function kick() {
      for (let i = 0; i < N; i++) { perm[i] = i; kicked[i] = 0; }
      for (let i = 0; i < N >> 1; i++) { const j = i + ((rnd() * (N - i)) | 0), t = perm[i]; perm[i] = perm[j]; perm[j] = t; kicked[perm[i]] = 1; }
      let px = 0, py = 0;
      for (let i = 0; i < N; i++) {
        if (kicked[i]) { const a = ux[i], b = uy[i]; ux[i] = a * KC - b * KS; uy[i] = a * KS + b * KC; }
        px += ux[i]; py += uy[i];
      }
      const mm = Math.sqrt(px * px + py * py); f.phi = mm / N; if (mm > 1e-9) { f.mx = px / mm; f.my = py / mm; }
      return f.phi;
    }
    // what agent i can hear: the order of the agents within radius r of it (itself included)
    function local(i, r) {
      const xi = x[i], yi = y[i], Lx = f.Lx, Ly = f.Ly, hx = Lx / 2, hy = Ly / 2, r2 = r * r; let qx = 0, qy = 0, n = 0;
      for (let j = 0; j < N; j++) {
        let dx = x[j] - xi, dy = y[j] - yi; if (dx > hx) dx -= Lx; else if (dx < -hx) dx += Lx; if (dy > hy) dy -= Ly; else if (dy < -hy) dy += Ly;
        if (dx * dx + dy * dy < r2) { qx += ux[j]; qy += uy[j]; n++; }
      }
      f.heard = n; return Math.sqrt(qx * qx + qy * qy) / n;
    }
    Object.assign(f, { x, y, ux, uy, kicked, step, setAspect, randomize, kick, local, heard: 0 });
    setAspect(aspect);
    return f;
  }

  // ------------------------------------------------------------ calibration: the same measurement on a separate flock, η stepped up a grid
  // grid = [[η, kicks]...]; per η: settle, then the kicks (pre-kick window with the noise test, kick, recovery)
  // pts = [η, τ (s; CAP if it did not bounce back), flag (0 recovered, 1 no order to knock down, 2 not back in time)]
  function makeCalib(N, aspect, seed, grid, settle, base) {
    const f = makeFlock(N, aspect, seed); f.randomize();
    // the grid may come in runs of rising η; each run starts from a freshly ordered flock
    const pts = [], done = []; let gi = 0, ph = 0, n = 0, m = 0, m2 = 0, k = 0, s = 0, h = 0, t = 0, m0 = 0, ordered = 0, quietRows = 0;
    const next = () => {
      k++; n = 0; m = m2 = 0; ph = 1;
      if (k < grid[gi][1]) return;
      done.push(grid[gi][0]); k = 0; gi++; ph = 0;
      quietRows = ordered ? 0 : quietRows + 1; ordered = 0;
      if (quietRows >= 2) while (gi < grid.length && grid[gi][0] > grid[gi - 1][0]) gi++;   // two η in a row without order: skip the rest of this run
      if (gi < grid.length && gi > 0 && grid[gi][0] < grid[gi - 1][0]) { f.randomize(); quietRows = 0; }
    };
    function advance(maxSteps) {
      for (let i = 0; i < maxSteps && gi < grid.length; i++) {
        const eta = grid[gi][0], p = f.step(eta);
        if (ph === 0) { if (++n >= settle) { ph = 1; n = 0; m = m2 = 0; } }
        else if (ph === 1) {
          m += p; m2 += p * p; n++;
          if (n >= base) {
            const mu = m / n, sd = Math.sqrt(Math.max(0, m2 / n - mu * mu));
            if (mu < SNR * sd) { pts.push(eta, CAP, 1); next(); }
            else { m0 = mu; f.kick(); ph = 2; t = 0; s = -1; h = 0; ordered = 1; }
          }
        } else {
          t++; s = s < 0 ? p : s + (p - s) * EMA;
          if (s >= .9 * m0) { if (++h >= HOLD) { pts.push(eta, (t - HOLD + 1) / RATE, 0); next(); continue; } } else h = 0;
          if (t >= CAPN) { pts.push(eta, CAP, 2); next(); }
        }
      }
      return gi >= grid.length;
    }
    return { advance, pts, doneList: done, get done() { return gi >= grid.length; } };
  }
  // the reference: a kernel-weighted MEAN of τ over η, where a kick that did not bounce back counts as 3 s (∞ on the
  // chart). The mean carries the growing tail of slow kicks, which is where critical slowing down shows; it reaches the
  // ∞ row where most kicks stop bouncing back. The threshold is where it crosses half of that (1.5 s).
  // Beyond the last measured η the flock has no order (∞). dis: where most kicks find no stable order at all.
  const SM = 160, smE = new Float64Array(SM);
  for (let j = 0; j < SM; j++) smE[j] = j / (SM - 1) * TAU;
  function analyse(pts, bw, out) {
    const nP = pts.length / 3, k2 = 1 / (2 * bw * bw); let lastE = 0, firstE = 99;
    for (let q = 0; q < nP; q++) { lastE = Math.max(lastE, pts[q * 3]); firstE = Math.min(firstE, pts[q * 3]); }
    let dis = TAU, star = -1;
    for (let j = 0; j < SM; j++) {
      const e = Math.max(smE[j], firstE); let sw = 0, sv = 0, sn = 0;  // below the first measured η: its value
      for (let q = 0; q < nP; q++) { const d = pts[q * 3] - e, w = Math.exp(-d * d * k2); sw += w; sv += w * Math.min(CAP, pts[q * 3 + 1]); if (pts[q * 3 + 2] === 1) sn += w; }
      out[j] = smE[j] > lastE + bw || sw < 1e-6 ? CAP : sv / sw;
      if (dis === TAU && (out[j] >= CAP || sn > sw / 2)) dis = smE[j];
      if (star < 0 && out[j] >= CAP / 2) star = j ? smE[j - 1] + (smE[j] - smE[j - 1]) * (CAP / 2 - out[j - 1]) / Math.max(1e-6, out[j] - out[j - 1]) : 0;
    }
    if (star < 0) star = smE[SM - 1];
    for (let j = 1; j < SM; j++) if (smE[j] > star && out[j] < out[j - 1]) out[j] = out[j - 1];   // past the threshold it only rises
    return { star, dis: Math.max(dis, star + .15) };
  }

  // ------------------------------------------------------------ layout
  let L = null;
  function layout() {
    const W = cv.w, H = cv.h, phone = W < 600;
    if (phone) {
      const avail = H - 16 - 12 - 20, fh = Math.round(avail * .40), ph = Math.round((avail - fh) * .58), th = avail - fh - ph;
      L = { phone, F: { x: 16, y: 16, w: W - 32, h: fh } };
      L.P = { x: 16, y: 16 + fh + 10, w: W - 32, h: ph }; L.T = { x: 16, y: L.P.y + ph + 10, w: W - 32, h: th };
    } else {
      const fw = Math.round((W - 58) * .555), cx = 20 + fw + 18, cw = W - fw - 58, ph = Math.round((H - 52) * .58);
      L = { phone, F: { x: 20, y: 20, w: fw, h: H - 40 }, P: { x: cx, y: 20, w: cw, h: ph }, T: { x: cx, y: 20 + ph + 12, w: cw, h: H - 52 - ph } };
    }
  }
  layout();

  // ------------------------------------------------------------ the visible flock
  const NV = 300;
  const flock = makeFlock(NV, L.F.w / L.F.h, 23);
  flock.randomize();
  const ox = new Float64Array(NV), oy = new Float64Array(NV), ex = new Float64Array(NV), ey = new Float64Array(NV);
  for (let i = 0; i < NV; i++) { ox[i] = flock.x[i]; oy[i] = flock.y[i]; ex[i] = flock.ux[i]; ey[i] = flock.uy[i]; }
  cv.onResize(() => { layout(); flock.setAspect(L.F.w / L.F.h); for (let i = 0; i < NV; i++) { ox[i] = flock.x[i]; oy[i] = flock.y[i]; } });

  // ------------------------------------------------------------ reference: quick at mount, then refined in the background
  const refC = new Float64Array(SM), refTo = new Float64Array(SM);
  let refInfo, refN = 100, refining = true, quickPts;
  {                                                                // quick: 100 agents, most kicks around the transition, time-boxed (< 70 ms)
    const q = makeCalib(100, L.F.w / L.F.h, 7, [[1.2, 1], [2, 1], [2.4, 2], [2.8, 2], [3.1, 3], [3.4, 3], [3.7, 2], [4, 2], [4.5, 1]], 15, 30);
    const t0 = performance.now();
    while (!q.done && performance.now() - t0 < 66) q.advance(40);
    quickPts = q.pts; refInfo = analyse(quickPts, .4, refTo); refC.set(refTo);
  }
  // refined: a twin of the visible flock (same N, density, box), the transition region first, 6 kicks per η there;
  // it replaces the quick curve η by η
  const FULL_GRID = [];
  for (let e = 2.5; e <= 4.76; e += .25) FULL_GRID.push([+e.toFixed(2), 6]);
  for (let e = .5; e <= 2.26; e += .25) FULL_GRID.push([+e.toFixed(2), 3]);
  let cal = makeCalib(NV, L.F.w / L.F.h, 101, FULL_GRID, 50, BASEN), calD = 0;
  const merged = [];
  let band = { star: refInfo.star, dis: refInfo.dis }, bandTo = { ...band };
  function calibStep() {                                           // at most ~1.4 ms per frame
    if (!cal) return;
    const t0 = performance.now(); let fin = false;
    for (let k = 0; k < 8 && !fin; k++) { fin = cal.advance(4); if (performance.now() - t0 > 1.4) break; }
    if (fin) { refInfo = analyse(cal.pts, .3, refTo); refN = NV; refining = false; cal = null; }
    else if (cal.doneList.length > calD) {
      calD = cal.doneList.length; merged.length = 0;
      for (let q = 0; q < cal.pts.length; q++) merged.push(cal.pts[q]);
      for (let q = 0; q < quickPts.length; q += 3) {
        let near = false; for (const e of cal.doneList) if (Math.abs(e - quickPts[q]) < .2) near = true;
        if (!near) merged.push(quickPts[q], quickPts[q + 1], quickPts[q + 2]);
      }
      refInfo = analyse(merged, .32, refTo);
    } else return;
    bandTo = { star: refInfo.star, dis: refInfo.dis }; judge();
  }

  // ------------------------------------------------------------ controls and readouts
  let eta = 2.2, auto = 1;
  kit.slider(controls, { label: 'Noise η', min: 0, max: 6.28, step: .01, value: eta, fmt: (v) => v.toFixed(2), onInput: (v) => { if (Math.abs(v - eta) > .004) { eta = v; resettle(); } } });
  kit.button(controls, { label: 'Kick the flock', kind: 'primary', onClick: () => doKick() });
  kit.toggle(controls, { label: 'Auto-kick', options: [{ v: 0, label: 'Off' }, { v: 1, label: 'On' }], value: 1, onChange: (v) => { auto = v; M.since = Math.max(M.since, AUTO_GAP - 1); } });
  kit.hint(controls, 'A kick turns a random half of the drones by 135°. τ is how long the order takes to come back.');
  const rTau = kit.readout(readouts, { label: 'Recovery time τ', tone: 'heat' });
  const rPhi = kit.readout(readouts, { label: 'Order Φ', tone: 'teal' });
  const rDist = kit.readout(readouts, { label: 'Distance to threshold', tone: 'ink' });
  { ctx.font = `500 22px ${F.mono}`; rTau.el.style.minWidth = Math.ceil(ctx.measureText('0.00 s').width + 4) + 'px'; rPhi.el.style.minWidth = '74px'; }
  { ctx.font = `500 22px ${F.mono}`; rDist.el.style.minWidth = Math.ceil(ctx.measureText('past it').width + 4) + 'px'; }

  // ------------------------------------------------------------ the measurement on the visible flock
  // st: 0 settling at a new η, 1 collecting the pre-kick window, 2 recovering after a kick
  const bufG = new Float64Array(BASEN), bufL = new Float64Array(BASEN), hG = new Float64Array(PRE), hL = new Float64Array(PRE);
  const TRN = PRE + CAPN + 1, trG = new Float32Array(TRN), trL = new Float32Array(TRN);
  const M = { st: 0, n: 0, bN: 0, bI: 0, hI: 0, since: AUTO_GAP - 1, t: 0, phi0: 1, sd: 0, loc0: 1, sg: -1, sl: -1, hg: 0, hl: 0, tauG: -1, tauL: -1, flag: 0, open: false };
  const TR = { n: 0, phi0: 1, loc0: 1, tauG: -1, tauL: -1, flag: -1, live: false };   // the trace on screen (last kick)
  const pts = [];                                                  // measured kicks: { e, t, tl, flag }
  let lastRes = null, resAge = 99, kickFx = 9, locS = 1;
  function resettle() { M.open = false; TR.live = false; M.st = 0; M.n = 0; M.bN = 0; M.bI = 0; judge(); }
  function baseline() {
    const n = M.bN; if (n < 8) return null;
    let m = 0, m2 = 0, l = 0; for (let i = 0; i < n; i++) { m += bufG[i]; m2 += bufG[i] * bufG[i]; l += bufL[i]; }
    m /= n; m2 /= n; l /= n; return { m, sd: Math.sqrt(Math.max(0, m2 - m * m)), l };
  }
  function doKick() {
    if (M.st !== 2 || !M.open) {
      const b = baseline();
      if (b) { M.phi0 = b.m; M.sd = b.sd; M.loc0 = b.l; } else { M.phi0 = phiS; M.sd = 0; M.loc0 = locS; }
    }                                                              // a kick during a recovery keeps the window from before the first kick
    M.flag = M.phi0 < SNR * M.sd ? 1 : 0;
    // the trace: the last PRE steps, then the moment of the kick
    for (let k = 0; k < PRE; k++) { const j = (M.hI + k) % PRE; trG[k] = hG[j]; trL[k] = hL[j]; }
    const p = flock.kick();
    for (let i = 0; i < NV; i++) if (flock.kicked[i]) { ex[i] = flock.ux[i]; ey[i] = flock.uy[i]; }
    trG[PRE] = p; trL[PRE] = flock.local(0, RL); TR.n = PRE + 1;
    Object.assign(TR, { phi0: M.phi0, loc0: M.loc0, tauG: -1, tauL: -1, flag: -1, live: true });
    Object.assign(M, { st: 2, open: true, t: 0, sg: -1, sl: -1, hg: 0, hl: 0, tauG: -1, tauL: -1 });
    kickFx = 0;
    if (M.flag === 1) { record(CAP, -1, 1); M.open = false; M.st = 1; M.bN = 0; M.bI = 0; M.since = 0; }
  }
  function record(tauG, tauL, flag) {
    pts.push({ e: eta, t: tauG, tl: tauL, flag }); if (pts.length > 90) pts.shift();
    lastRes = { t: tauG, flag }; resAge = 0;
    TR.tauG = tauG; TR.flag = flag; judge();
  }
  // single kicks scatter (that is the point: fluctuations grow near the threshold), so the readout and the verdict use
  // the average of the last few kicks at this noise, counted the same way as the reference (no bounce-back = 3 s)
  let dist = '…', avgT = -1, avgN = 0, avgNoOrd = false;
  const recT = [];
  // The verdict, from τ alone against the reference: slower than the reference a little before the threshold → 'close',
  // slower than it just before the threshold → 'at it'. Both cuts are kept well above the calm flock's τ, so a flat
  // stretch of the reference cannot turn one slow kick into a verdict.
  const refAt = (e) => refTo[clamp(Math.round(e / TAU * (SM - 1)), 0, SM - 1)];
  function judge() {
    let n = 0, noOrd = 0; recT.length = 0;
    for (let k = pts.length - 1; k >= 0 && n < 7; k--) { if (Math.abs(pts[k].e - eta) > .03) break; recT.push(pts[k].flag ? CAP : pts[k].t); n++; if (pts[k].flag === 1) noOrd++; }
    avgN = n; if (!n) { avgT = -1; dist = '…'; return; }
    avgT = recT.reduce((a, b) => a + b, 0) / n; avgNoOrd = n >= 3 && noOrd >= n - 1 && noOrd >= .85 * n;   // (almost) never any order
    if (n < 3) { dist = '…'; return; }                             // one or two kicks are not enough to judge
    if (avgNoOrd) { dist = 'past it'; return; }
    let lo = CAP; for (let e = .5; e <= 1.8; e += .05) lo = Math.min(lo, refAt(e));   // the calm flock's τ
    const tc = Math.max(refAt(bandTo.star - .7), 3 * lo), ta = Math.max(refAt(bandTo.star - .35), 2 * tc);
    dist = avgT < tc ? 'far' : avgT < ta ? 'close' : 'at it';
  }
  function measureStep(p, lp) {
    hG[M.hI] = p; hL[M.hI] = lp; M.hI = (M.hI + 1) % PRE;
    if (TR.live) { trG[TR.n] = p; trL[TR.n] = lp; if (++TR.n >= TRN) TR.live = false; }   // the trace runs its full 3 s
    if (M.st === 0) { if (++M.n >= SETTLEN) { M.st = 1; M.bN = 0; M.bI = 0; } return; }
    if (M.st === 1) {
      bufG[M.bI] = p; bufL[M.bI] = lp; M.bI = (M.bI + 1) % BASEN; if (M.bN < BASEN) M.bN++;
      M.since += 1 / RATE;
      if (auto && M.bN >= BASEN && M.since >= AUTO_GAP) doKick();
      return;
    }
    M.t++;
    M.sg = M.sg < 0 ? p : M.sg + (p - M.sg) * EMA; M.sl = M.sl < 0 ? lp : M.sl + (lp - M.sl) * EMAL;
    if (M.open && M.flag === 0) {
      if (M.tauG < 0) { if (M.sg >= .9 * M.phi0) { if (++M.hg >= HOLD) { M.tauG = (M.t - HOLD + 1) / RATE; record(M.tauG, -1, 0); } } else M.hg = 0; }
      if (M.tauL < 0) { if (M.sl >= .9 * M.loc0) { if (++M.hl >= HOLD) { M.tauL = (M.t - HOLD + 1) / RATE; TR.tauL = M.tauL; if (pts.length && M.tauG >= 0) pts[pts.length - 1].tl = M.tauL; } } else M.hl = 0; }
    }
    const done = M.t >= CAPN || (M.tauG >= 0 && M.tauL >= 0 && M.t >= Math.max(M.tauG, M.tauL) * RATE + 22);
    if (done) {
      if (M.open && M.tauG < 0) record(CAP, -1, M.flag === 1 ? 1 : 2);
      else if (M.open && M.tauL >= 0 && pts.length) pts[pts.length - 1].tl = M.tauL;
      M.open = false; M.st = 1; M.bN = 0; M.bI = 0; M.since = 0;
    }
  }

  // ------------------------------------------------------------ stepping the visible flock at a fixed rate
  let acc = 0, alpha = 0, phiS = flock.phi, aligned = 1;
  function visibleStep() {
    for (let i = 0; i < NV; i++) { ox[i] = flock.x[i]; oy[i] = flock.y[i]; }
    const p = flock.step(eta), lp = flock.local(0, RL);
    for (let i = 0; i < NV; i++) { ex[i] += (flock.ux[i] - ex[i]) * .3; ey[i] += (flock.uy[i] - ey[i]) * .3; }
    locS += (lp - locS) * .1;
    measureStep(p, lp);
  }

  // ------------------------------------------------------------ drawing
  function halo(str, X, Y, o) {
    ctx.font = `${o.weight || 400} ${o.size || 12}px ${o.font || F.sans}`; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(30,33,64,.92)'; ctx.strokeText(str, X, Y);
    ctx.fillStyle = o.color; ctx.fillText(str, X, Y);
  }
  const tw = (s, size, font = F.sans, weight = 400) => { ctx.font = `${weight} ${size}px ${font}`; return ctx.measureText(s).width; };
  const fmtT = (t) => (t < 1 ? t.toFixed(2) : t.toFixed(1)) + ' s';
  const COS30 = Math.cos(Math.PI / 6);

  function drawFlock() {
    const { F: R, phone } = L, s = R.w / flock.Lx, tick = phone ? 5 : 6.6;
    ctx.fillStyle = 'rgba(36,40,77,.55)'; roundRect(ctx, R.x, R.y, R.w, R.h, 14); ctx.fill();
    ctx.save(); roundRect(ctx, R.x, R.y, R.w, R.h, 14); ctx.clip();
    const mx = flock.mx, my = flock.my, hx = flock.Lx / 2, hy = flock.Ly / 2;
    const pT = new Path2D(), pR = new Path2D(); let nA = 0;
    for (let i = 1; i < NV; i++) {
      const dx = flock.x[i] - ox[i], dy = flock.y[i] - oy[i], wrap = dx > hx || dx < -hx || dy > hy || dy < -hy;
      const X = R.x + (wrap ? flock.x[i] : ox[i] + dx * alpha) * s, Y = R.y + (wrap ? flock.y[i] : oy[i] + dy * alpha) * s;
      const m = Math.sqrt(ex[i] * ex[i] + ey[i] * ey[i]) + 1e-9, ux = ex[i] / m, uy = ey[i] / m;
      const ok = ux * mx + uy * my > COS30; if (ok) nA++;
      const p = ok ? pT : pR; p.moveTo(X - ux * tick * .55, Y - uy * tick * .55); p.lineTo(X + ux * tick * .45, Y + uy * tick * .45);
    }
    aligned = (nA + 1) / NV;
    ctx.lineCap = 'round'; ctx.lineWidth = phone ? 1.5 : 1.7;
    ctx.strokeStyle = 'rgba(239,177,180,.9)'; ctx.stroke(pR);
    ctx.strokeStyle = C.teal; ctx.stroke(pT);
    // one drone and what it can hear (radius 2R, drawn on every wrapped copy that shows)
    const d0x = flock.x[0] - ox[0], d0y = flock.y[0] - oy[0], w0 = d0x > hx || d0x < -hx || d0y > hy || d0y < -hy;
    const X0 = R.x + (w0 ? flock.x[0] : ox[0] + d0x * alpha) * s, Y0 = R.y + (w0 ? flock.y[0] : oy[0] + d0y * alpha) * s, rr = RL * s;
    ctx.fillStyle = 'rgba(220,228,238,.06)'; ctx.strokeStyle = 'rgba(220,228,238,.5)'; ctx.lineWidth = 1.1; ctx.setLineDash([3, 4]);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const cx = X0 + a * R.w, cy = Y0 + b * R.h;
      if (cx + rr < R.x || cx - rr > R.x + R.w || cy + rr < R.y || cy - rr > R.y + R.h) continue;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fill(); ctx.stroke();
    }
    ctx.setLineDash([]);
    const m0 = Math.sqrt(ex[0] * ex[0] + ey[0] * ey[0]) + 1e-9, u0 = ex[0] / m0, v0 = ey[0] / m0;
    ctx.strokeStyle = C.mist; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(X0 - u0 * 5, Y0 - v0 * 5); ctx.lineTo(X0 + u0 * 5, Y0 + v0 * 5); ctx.stroke();
    ctx.fillStyle = C.mist; ctx.beginPath(); ctx.arc(X0, Y0, 2.6, 0, TAU); ctx.fill();
    ctx.restore();
    // the kick: a short glow on the frame
    if (kickFx < .7) { const a = (1 - kickFx / .7) * .7; ctx.strokeStyle = `rgba(255,195,107,${a.toFixed(3)})`; ctx.lineWidth = 1.5 + 2 * (1 - kickFx / .7); roundRect(ctx, R.x + 1, R.y + 1, R.w - 2, R.h - 2, 14); ctx.stroke(); }
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; roundRect(ctx, R.x + .5, R.y + .5, R.w - 1, R.h - 1, 14); ctx.stroke();
    // labels
    const fs = phone ? 11 : 12, pa = Math.round(aligned * 100);
    halo(`aligned ${pa}%`, R.x + 14, R.y + 22, { size: fs, color: C.teal });
    halo(`deviating ${100 - pa}%`, R.x + 14 + tw(`aligned ${pa}%`, fs) + 14, R.y + 22, { size: fs, color: C.rose });
    // the drone's label sits beside its circle, on the side with more room
    const lbl = phone ? `one drone hears ${flock.heard}` : `one drone's view: it hears ${flock.heard} drones`, lw = tw(lbl, 11);
    let ly = Y0 - rr - 7;
    if (ly < R.y + (phone ? 38 : 42)) ly = Y0 + rr + 15;
    if (ly > R.y + R.h - (phone ? 40 : 46)) ly = Y0 - rr - 7 < R.y + 38 ? Y0 + 4 + rr * .5 : Y0 - rr - 7;
    halo(lbl, clamp(X0 - lw / 2, R.x + 12, R.x + R.w - 12 - lw), ly, { size: 11, color: C.mist });
    // status: what just happened, and when the next kick comes
    let msg = '', col = C.muted;
    if (M.st === 2 && M.open && M.tauG < 0) {
      msg = M.flag === 1 ? 'kicked: but there is no order to knock down' : M.t < 12 ? 'kick: a random half turned 135°' : `recovering… ${(M.t / RATE).toFixed(1)} s`; col = C.heat;
    } else if (lastRes && resAge < 3.2) {
      if (lastRes.flag === 0) { msg = `back within 10% in ${fmtT(lastRes.t)}`; col = C.teal; }
      else if (lastRes.flag === 2) { msg = phone ? 'not back after 3 s' : 'not back after 3 s: it stopped bouncing back'; col = C.rose; }
      else { msg = phone ? 'no stable order to knock down' : 'lost in its own fluctuations: no stable order to knock down'; col = C.rose; }
    }
    let sub = '', nx = '';
    if (M.st === 0) nx = 'settling at the new noise…';
    else if (M.st === 1) nx = auto ? (M.bN >= BASEN && M.since >= AUTO_GAP - .05 ? '' : `next kick in ${Math.max(1, Math.ceil(Math.max(AUTO_GAP - M.since, (BASEN - M.bN) / RATE)))} s`) : (phone ? 'auto-kick off' : 'auto-kick is off: kick it yourself');
    const av = avgN >= 2 ? (phone ? `avg of ${avgN}: ` : `average of ${avgN} kicks here: `) + (avgT >= CAP - 1e-6 ? '∞' : fmtT(avgT)) : '';
    sub = av && nx ? av + ' · ' + nx : av || nx;
    const by = R.y + R.h - (phone ? 12 : 16);
    if (msg) halo(msg, R.x + 14, sub ? by - (phone ? 15 : 17) : by, { size: phone ? 11.5 : 12.5, color: col, weight: 500 });
    if (sub) halo(sub, R.x + 14, by, { size: phone ? 10.5 : 11, color: C.faint });
  }

  // the τ(η) plot: points per kick over the reference, the threshold marked where τ blows up
  function drawPlot() {
    const { P: R, phone } = L;
    ctx.fillStyle = C.panel; roundRect(ctx, R.x, R.y, R.w, R.h, 10); ctx.fill();
    const l = R.x + (phone ? 30 : 34), r = R.x + R.w - 14, top = R.y + (phone ? 26 : 44), bot = R.y + R.h - 22;
    const px = (v) => l + v / TAU * (r - l), py = (v) => bot - v / YMAX * (bot - top);
    // disordered side (no order left to kick) and the band around the threshold
    const xd = px(band.dis);
    ctx.fillStyle = 'rgba(239,177,180,.045)'; ctx.fillRect(xd, top - 6, r - xd, bot - top + 6);
    const xs = px(band.star), b0 = px(Math.max(.05, band.star - .22)), b1 = px(band.star + .22);
    ctx.fillStyle = 'rgba(255,195,107,.10)'; ctx.fillRect(b0, top - 6, b1 - b0, bot - top + 6);
    // grid: 1, 2, 3 s and the top row for kicks that never came back
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath();
    for (const v of [1, 2, 3]) { ctx.moveTo(l, py(v)); ctx.lineTo(r, py(v)); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,195,107,.16)'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(l, py(YTOP)); ctx.lineTo(r, py(YTOP)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(l, top - 6); ctx.lineTo(l, bot); ctx.lineTo(r, bot); ctx.stroke();
    for (const v of phone ? [1, 2] : [1, 2, 3]) text(ctx, v + ' s', l - 6, py(v) + 3.5, { size: 10, color: C.faint, font: F.mono, align: 'right' });
    text(ctx, '0', l - 6, bot + 3.5, { size: 10, color: C.faint, font: F.mono, align: 'right' });
    text(ctx, '∞', l - 6, py(YTOP) + 4, { size: 11, color: 'rgba(255,195,107,.7)', font: F.mono, align: 'right' });
    if (!phone) text(ctx, 'never came back (= 3 s)', l + 6, py(YTOP) - 5, { size: 10, color: 'rgba(255,195,107,.6)' });
    // threshold line
    ctx.strokeStyle = 'rgba(255,195,107,.8)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(xs, top - 6); ctx.lineTo(xs, bot); ctx.stroke();
    // the reference: faint, dashed; it rises off the chart at the threshold
    ctx.save(); ctx.beginPath(); ctx.rect(l, top - 8, r - l, bot - top + 8); ctx.clip();
    ctx.strokeStyle = refining ? 'rgba(255,195,107,.38)' : 'rgba(255,195,107,.5)'; ctx.lineWidth = 1.6; ctx.setLineDash([4, 3]); ctx.lineJoin = 'round'; ctx.beginPath();
    let up = false;
    for (let j = 0; j < SM; j++) {
      const v = refC[j], X = px(smE[j]);
      if (v >= CAP * .985) { if (!up) { ctx.lineTo(X, py(YTOP)); up = true; } else ctx.lineTo(X, py(YTOP)); continue; }
      const Y = py(v); j ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); up = false;
    }
    ctx.stroke(); ctx.setLineDash([]);
    // η now
    const xe = px(eta);
    ctx.strokeStyle = 'rgba(246,210,177,.55)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(xe, top - 6); ctx.lineTo(xe, bot); ctx.stroke(); ctx.setLineDash([]);
    // measured kicks: filled = recovered, ring on the ∞ row = did not bounce back; small mist rings = one drone's estimate
    const rad = phone ? 2.5 : 3, pD = new Path2D(), pF = new Path2D(), pN = new Path2D();
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], X = px(p.e);
      if (p.flag) { const Y = py(YTOP); pN.moveTo(X + rad + .6, Y); pN.arc(X, Y, rad + .6, 0, TAU); }
      else { const Y = py(p.t); pF.moveTo(X + rad, Y); pF.arc(X, Y, rad, 0, TAU); }
      if (!p.flag && p.tl >= 0) { const Y = py(Math.min(CAP, p.tl)); pD.moveTo(X + 2.6, Y); pD.arc(X, Y, 2.6, 0, TAU); }
    }
    ctx.strokeStyle = 'rgba(220,228,238,.8)'; ctx.lineWidth = 1.1; ctx.stroke(pD);
    ctx.fillStyle = C.heat; ctx.fill(pF);
    ctx.strokeStyle = C.heat; ctx.lineWidth = 1.4; ctx.stroke(pN);
    if (pts.length && resAge < 2.5) {                               // the newest kick
      const p = pts[pts.length - 1], X = px(p.e), Y = py(p.flag ? YTOP : p.t), a = 1 - resAge / 2.5;
      ctx.strokeStyle = `rgba(243,238,242,${(.85 * a).toFixed(3)})`; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(X, Y, rad + 4 + 3 * (1 - a), 0, TAU); ctx.stroke();
    }
    ctx.restore();
    // the threshold label, centred on the line, kept inside the panel
    const fsL = phone ? 11 : 12, s1 = 'the threshold is where it stops bouncing back', w1 = tw(s1, fsL, F.sans, 500);
    const a1 = 'the threshold is where', a2 = 'it stops bouncing back', wa = Math.max(tw(a1, fsL, F.sans, 500), tw(a2, fsL, F.sans, 500));
    const one = xs - 8 - w1 > l + 4, two = xs - 8 - wa > l + 4, ly = py(phone ? 2.35 : 2.55);
    if (one) halo(s1, xs - 8, ly, { size: fsL, color: C.heat, weight: 500, align: 'right' });
    else {
      const left = two, X = left ? xs - 8 : Math.min(xs + 8, r - 4 - wa), al = left ? 'right' : 'left';
      halo(a1, X, ly - fsL - 2, { size: fsL, color: C.heat, weight: 500, align: al }); halo(a2, X, ly, { size: fsL, color: C.heat, weight: 500, align: al });
    }
    // captions
    const fs = phone ? 10.5 : 11.5;
    text(ctx, 'recovery time τ after a kick', R.x + 14, R.y + (phone ? 17 : 20), { size: fs, color: C.heat });
    if (!phone) {
      let cap = refining ? `faint: reference run, ${refN} drones (refining…)` : `dots: your kicks · rings: one drone's view · faint: reference`;
      if (tw(cap, 10.5) > R.w - 28) cap = refining ? `faint: reference, ${refN} drones (refining…)` : `dots: your kicks · rings: one drone's view`;
      text(ctx, cap, R.x + 14, R.y + 36, { size: 10.5, color: C.faint });
    } else {
      text(ctx, refining ? 'refining…' : `${pts.length} kicks`, R.x + R.w - 12, R.y + 17, { size: 10, color: C.faint, align: 'right' });
    }
    text(ctx, 'ordered', l + 6, bot - 7, { size: fs, color: 'rgba(127,212,207,.6)' });
    if (r - xd > 70) text(ctx, 'disordered', r - 4, bot - 7, { size: fs, color: 'rgba(239,177,180,.65)', align: 'right' });
    const yb = R.y + R.h - 7;
    text(ctx, '0', l, yb, { size: 10.5, color: C.faint, font: F.mono, align: 'center' });
    text(ctx, 'π', px(Math.PI), yb, { size: 10.5, color: C.faint, font: F.mono, align: 'center' });
    text(ctx, '2π', r, yb, { size: 10.5, color: C.faint, font: F.mono, align: 'right' });
    text(ctx, 'noise η', px(Math.PI * 1.5), yb, { size: 11, color: C.faint, align: 'center' });
    // a small marker under the axis: where the slider is
    ctx.fillStyle = C.apricot; ctx.beginPath(); ctx.moveTo(xe, bot + 2); ctx.lineTo(xe - 4, bot + 8); ctx.lineTo(xe + 4, bot + 8); ctx.closePath(); ctx.fill();
  }

  // the last kick: Φ(t) of the whole flock and of one drone's view, with τ marked
  const T0 = -.5, T1 = CAP;
  function drawTrace() {
    const { T: R, phone } = L;
    ctx.fillStyle = C.panel; roundRect(ctx, R.x, R.y, R.w, R.h, 10); ctx.fill();
    const l = R.x + (phone ? 30 : 34), r = R.x + R.w - 14, top = R.y + (phone ? 24 : 30), bot = R.y + R.h - 22;
    const px = (t) => l + (t - T0) / (T1 - T0) * (r - l), py = (v) => bot - v * (bot - top);
    const fs = phone ? 10.5 : 11.5;
    text(ctx, 'the last kick', R.x + 14, R.y + (phone ? 16 : 19), { size: fs, color: C.muted });
    if (TR.flag >= 0) {
      const s2 = TR.flag === 0 ? `τ ${fmtT(TR.tauG)}` : TR.flag === 2 ? 'not back in 3 s' : phone ? 'no stable order' : 'no stable order to knock down';
      text(ctx, s2, R.x + R.w - 12, R.y + (phone ? 16 : 19), { size: phone ? 10.5 : 11.5, color: TR.flag === 0 ? C.heat : C.rose, font: TR.flag === 0 ? F.mono : F.sans, align: 'right' });
    }
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(l, py(1)); ctx.lineTo(r, py(1)); ctx.stroke();
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(l, top - 4); ctx.lineTo(l, bot); ctx.lineTo(r, bot); ctx.stroke();
    text(ctx, 'Φ 1', l - 6, py(1) + 3.5, { size: 10, color: C.faint, font: F.mono, align: 'right' });
    text(ctx, '0', l - 6, bot + 3.5, { size: 10, color: C.faint, font: F.mono, align: 'right' });
    const yb = R.y + R.h - 7;
    for (const t of [0, 1, 2, 3]) text(ctx, t ? t + ' s' : '0', px(t), yb, { size: 10, color: C.faint, font: F.mono, align: t === 3 ? 'right' : 'center' });
    if (!TR.n) { text(ctx, 'waiting for the first kick…', (l + r) / 2, (top + bot) / 2, { size: 11, color: C.faint, align: 'center' }); return; }
    // the 10% band under the pre-kick level
    const yA = py(TR.phi0), yB = py(TR.phi0 * .9);
    ctx.fillStyle = 'rgba(127,212,207,.10)'; ctx.fillRect(l, yA, r - l, yB - yA);
    ctx.strokeStyle = 'rgba(127,212,207,.5)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(l, yB); ctx.lineTo(r, yB); ctx.stroke(); ctx.setLineDash([]);
    text(ctx, '−10%', r - 2, yB + 11 < bot - 4 ? yB + 11 : yA - 4, { size: 9.5, color: 'rgba(127,212,207,.75)', font: F.mono, align: 'right' });
    // kick
    const xk = px(0);
    ctx.strokeStyle = 'rgba(255,195,107,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xk, top - 4); ctx.lineTo(xk, bot); ctx.stroke();
    text(ctx, 'kick', xk - 4, top + 6, { size: 10, color: C.heat, align: 'right' });
    // lines
    const n = TR.n, stepT = 1 / RATE;
    const line = (arr, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.beginPath(); for (let i = 0; i < n; i++) { const X = px((i - PRE) * stepT), Y = py(arr[i]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); } ctx.stroke(); };
    line(trL, 'rgba(220,228,238,.5)', 1.3);
    line(trG, C.teal, 1.9);
    // τ: a bracket from the kick to the recovery
    const yT = bot - 9;
    if (TR.tauG >= 0 && TR.flag === 0) {
      const xt = px(TR.tauG);
      ctx.strokeStyle = C.heat; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(xt, top - 4); ctx.lineTo(xt, bot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xk, yT); ctx.lineTo(xt, yT); ctx.moveTo(xk, yT - 4); ctx.lineTo(xk, yT + 4); ctx.moveTo(xt, yT - 4); ctx.lineTo(xt, yT + 4); ctx.stroke();
      if (!phone) halo('τ', (xk + xt) / 2 < xk + 8 ? xt + 6 : (xk + xt) / 2, yT - 5, { size: 11.5, color: C.heat, font: F.mono, weight: 500, align: (xk + xt) / 2 < xk + 8 ? 'left' : 'center' });
    }
    // the drone's own τ: a small mark on its line
    if (TR.tauL >= 0 && TR.flag === 0) {
      const i = Math.min(n - 1, PRE + Math.round(TR.tauL * RATE)), X = px(TR.tauL), Y = py(trL[i]);
      ctx.strokeStyle = C.mist; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(X, Y, 3, 0, TAU); ctx.stroke();
    }
    // line labels: the drone's view above its line, the whole flock below its line, where the lines leave room
    const sG = 'whole flock', sL = "one drone's view", wG = tw(sG, 11), wL = tw(sL, 11);
    const span = (t0, w, arr, hi) => {                               // max (hi) or min of a line under a label
      const i0 = Math.max(0, PRE + Math.floor(t0 * RATE)), i1 = Math.min(n - 1, PRE + Math.ceil((t0 + w / (r - l) * (T1 - T0)) * RATE));
      let v = hi ? -1 : 2; for (let i = i0; i <= i1; i++) v = hi ? Math.max(v, arr[i]) : Math.min(v, arr[i]); return v;
    };
    const tL = .95, tG = .95 + (phone ? 0 : .1);
    if (n > PRE + (tL + .3) * RATE) {
      const yl = clamp(py(span(tL, wL, trL, true)) - 6, top + 6, bot - 24), yg = clamp(py(Math.min(span(tG, wG, trG, false), TR.phi0 * .9)) + 14, top + 18, bot - 20);
      halo(sL, px(tL), yl, { size: 11, color: C.mist });
      if (yg > yl + 12) halo(sG, px(tG), yg, { size: 11, color: C.teal });
    }
  }

  // ------------------------------------------------------------ loop
  const loop = kit.loop((dt) => {
    dt = Math.max(0, Math.min(.05, dt || 0));
    if (loop.running) calibStep();
    acc += dt * RATE; let n = Math.floor(acc); acc -= n; if (n > 4) n = 4;
    for (let k = 0; k < n; k++) visibleStep();
    alpha = clamp(acc, 0, 1);
    phiS += (flock.phi - phiS) * Math.min(1, dt * 3);
    kickFx += dt; resAge += dt;
    const kb = Math.min(1, dt * 3); band.star += (bandTo.star - band.star) * kb; band.dis += (bandTo.dis - band.dis) * kb;
    for (let j = 0; j < SM; j++) refC[j] += (refTo[j] - refC[j]) * kb;
    if (loop.running) {
      cv.clear(); drawFlock(); drawPlot(); drawTrace();
      rPhi.set(phiS.toFixed(2));
      if (avgN) rTau.set(avgT >= CAP - 1e-6 ? '∞' : fmtT(avgT));
      else rTau.set('…');
      rDist.set(dist);
    }
  });
  cv.clear(); drawFlock(); drawPlot(); drawTrace(); rPhi.set(phiS.toFixed(2)); rTau.set('…'); rDist.set(dist);
  return { start() { loop.start(); }, stop() { loop.stop(); }, destroy() { loop.stop(); cv.destroy(); } };
}

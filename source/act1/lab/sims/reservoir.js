// The swarm as a computer (reservoir computing; the bucket of water). An input u(t), a fresh random number in [-1, 1]
// every tick (0.2 s), is dropped into a physical system. Nothing inside the system is trained. A linear readout of 63
// probes (+ a bias = 64 weights) is fitted by ridge regression to recall u(t - k) for k = 1..20 ticks; R² on held-out
// ticks per delay is the memory curve, and their sum is the memory capacity (Jaeger 2001).
//   Water: a 2-D damped wave equation (leapfrog) on a 48 x 30 tank, drops at the left wall. Coupling κ sets how much of
//     each ripple's motion survives a step: d = 1 - 0.5 (1 - κ). κ < 1 damped, κ = 1 lossless, κ > 1 the tank feeds
//     its own waves (a shaken bucket), bounded by a soft saturation; a little ambient noise is always there.
//   Swarm: 400 drones with turning inertia (Cavagna & Attanasi's inertial spin model, the reason turns run through a
//     starling flock as waves): heading θ, turn rate ω, neighbours within R pull the heading (alignment torque) and a
//     weak pull holds the mission heading. The UGV swerves by u(t) and the drones next to it swerve with it.
//     Coupling κ again sets how much turn rate survives a step: calm swarms damp every turn, κ > 1 over-steers.
// Too calm forgets fast, too chaotic drowns the input in its own motion; memory peaks just on the calm side of κ = 1.
export const KMAX = 20, NPROBE = 63, PX = 9, PY = 7;
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const softclip = (v, S) => { const x = v / S; return x >= 3 ? S : x <= -3 ? -S : S * x * (27 + x * x) / (27 + 9 * x * x); };   // ≈ S tanh(v / S)

// ------------------------------------------------------------------ the water tank
export function waterRes(seed = 1) {
  const NX = 48, NY = 30, NC = NX * NY, C2 = .22, G0 = .5, SAT = 1.2, NOISE = .002, AMP = 1.2, SPT = 4;
  let h = new Float32Array(NC), hp = new Float32Array(NC), hn = new Float32Array(NC);
  const rnd = lcg(seed), NT = 8192, noise = new Float32Array(NT);                 // ambient noise: a table read at a random offset
  for (let i = 0; i < NT; i++) noise[i] = NOISE * (rnd() - .5) * 3.46;
  const ker = [];                                                  // the drop: a small bump at the middle of the left wall
  for (let j = 0; j < NY; j++) for (let i = 0; i < 6; i++) { const w = Math.exp(-((i - 1.5) ** 2 + (j - NY / 2) ** 2) / (2 * 1.6 * 1.6)); if (w > .01) ker.push(j * NX + i, w); }
  const probe = new Int32Array(NPROBE);
  for (let b = 0; b < PY; b++) for (let a = 0; a < PX; a++) probe[b * PX + a] = Math.round((b + .5) * NY / PY - .5) * NX + Math.round((a + .5) * NX / PX - .5);
  let kap = .9;
  const o = {
    kind: 'water', NX, NY, SPT, probe,
    get h() { return h; },
    setK(k) { kap = k; },
    drop(u) { for (let q = 0; q < ker.length; q += 2) h[ker[q]] += AMP * u * ker[q + 1]; },
    step() {
      const d = 1 - G0 * (1 - kap), off = (rnd() * NT) | 0, inv = 1 / SAT, H = h, HP = hp, HN = hn, NZ = noise, M = NT - 1;
      for (let j = 0; j < NY; j++) {
        const row = j * NX, up = (j > 0 ? j - 1 : 0) * NX, dn = (j < NY - 1 ? j + 1 : NY - 1) * NX;
        for (let i = 0; i < NX; i++) {                             // reflecting walls
          const c = row + i, hc = H[c];
          const lap = H[i > 0 ? c - 1 : c] + H[i < NX - 1 ? c + 1 : c] + H[up + i] + H[dn + i] - 4 * hc;
          const x = (hc + d * (hc - HP[c]) + C2 * lap) * inv;     // soft saturation ≈ SAT tanh(v / SAT)
          HN[c] = (x >= 3 ? SAT : x <= -3 ? -SAT : SAT * x * (27 + x * x) / (27 + 9 * x * x)) + NZ[(off + c) & M];
        }
      }
      hp = H; h = HN; hn = HP;
    },
    features(out, at = 0) { for (let q = 0; q < NPROBE; q++) out[at + q] = h[probe[q]]; },
    reset() { h.fill(0); hp.fill(0); },
  };
  return o;
}

// ------------------------------------------------------------------ the swarm (turning waves)
export function swarmRes(seed = 1, N = 400, JIT = .6) {
  const LX = 16, LY = 10, V0 = .05, J = 1.2, KH = .03, G0 = .5, WMAX = 1, KICK = .35, SIG = 1, NOISE = .002, SPT = 3, KR = .08, RR = .5;
  const UX = 3, UY = 5, TAU = Math.PI * 2;
  const rnd = lcg(seed);
  const x = new Float64Array(N), y = new Float64Array(N), th = new Float64Array(N), om = new Float64Array(N);
  const cs = new Float64Array(N), sn = new Float64Array(N), tq = new Float64Array(N), nn = new Float64Array(N), px = new Float64Array(N), py = new Float64Array(N);
  const GXc = LX, GYc = LY, NCELL = GXc * GYc, cnt = new Int32Array(NCELL), start = new Int32Array(NCELL + 1), cell = new Int32Array(N), ord = new Int32Array(N);
  const sx = new Float64Array(N), sy = new Float64Array(N);
  // forward half of the 3 x 3 neighbourhood, with the periodic offsets
  const HN = new Int32Array(NCELL * 4), HX = new Float64Array(NCELL * 4), HY = new Float64Array(NCELL * 4);
  for (let cy = 0; cy < GYc; cy++) for (let cx = 0; cx < GXc; cx++) {
    let k = (cy * GXc + cx) * 4;
    for (const [dx, dy] of [[1, 0], [-1, 1], [0, 1], [1, 1]]) {
      let gx = cx + dx, gy = cy + dy, ox = 0, oy = 0;
      if (gx < 0) { gx += GXc; ox = -LX; } else if (gx >= GXc) { gx -= GXc; ox = LX; }
      if (gy >= GYc) { gy -= GYc; oy = LY; }
      HN[k] = gy * GXc + gx; HX[k] = ox; HY[k] = oy; k++;
    }
  }
  { const nx = Math.round(Math.sqrt(N * LX / LY)), ny = Math.ceil(N / nx);   // a jittered lattice: even density (a fair medium)
    for (let i = 0; i < N; i++) { x[i] = ((i % nx) + .5 + (rnd() - .5) * JIT) * LX / nx; y[i] = (((i / nx) | 0) + .5 + (rnd() - .5) * JIT) * LY / ny; } }
  cs.fill(1);
  let kap = .9, uin = 0, kick = false, swerve = 0;
  const pcnt = new Float64Array(NPROBE), psum = new Float64Array(NPROBE);
  const o = {
    kind: 'swarm', N, LX, LY, SPT, UX, UY, x, y, th, om,
    get swerve() { return swerve; },
    setK(k) { kap = k; },
    drop(u) { uin = u; kick = true; swerve = u; },
    step() {
      for (let i = 0; i < N; i++) { tq[i] = 0; nn[i] = 0; px[i] = 0; py[i] = 0; }   // cs, sn hold cos θ, sin θ
      cnt.fill(0);
      for (let i = 0; i < N; i++) { let cx = x[i] | 0, cy = y[i] | 0; if (cx >= GXc) cx = GXc - 1; if (cy >= GYc) cy = GYc - 1; const c = cy * GXc + cx; cell[i] = c; cnt[c]++; }
      start[0] = 0; for (let c = 0; c < NCELL; c++) { start[c + 1] = start[c] + cnt[c]; cnt[c] = start[c]; }
      for (let i = 0; i < N; i++) { const p = cnt[cell[i]]++; ord[p] = i; sx[p] = x[i]; sy[p] = y[i]; }
      const RR2 = RR * RR;
      // every pair within R once: alignment torque J sin(θj - θi) (opposite for the partner) and a soft push apart
      for (let c = 0; c < NCELL; c++) {
        const a0 = start[c], a1 = start[c + 1]; if (a0 === a1) continue;
        for (let k = c * 4 - 1, ke = c * 4 + 4; k < ke; k++) {
          let b0, b1, ox = 0, oy = 0;
          if (k < c * 4) { b0 = a0; b1 = a1; } else { const g = HN[k]; b0 = start[g]; b1 = start[g + 1]; ox = HX[k]; oy = HY[k]; if (b0 === b1) continue; }
          for (let p = a0; p < a1; p++) {
            const a = ord[p], xa = sx[p] - ox, ya = sy[p] - oy, ca = cs[a], sa = sn[a];
            for (let q = (k < c * 4 ? p + 1 : b0); q < b1; q++) {
              const dx = sx[q] - xa, dy = sy[q] - ya, d2 = dx * dx + dy * dy; if (d2 >= 1) continue;
              const b = ord[q], t = sn[b] * ca - cs[b] * sa;
              tq[a] += t; tq[b] -= t; nn[a]++; nn[b]++;
              if (d2 < RR2) { const d = Math.sqrt(d2) + 1e-6, f = (RR - d) / d * KR; px[a] -= dx * f; py[a] -= dy * f; px[b] += dx * f; py[b] += dy * f; }
            }
          }
        }
      }
      const d = 1 - G0 * (1 - kap), s2 = SIG * SIG;
      for (let i = 0; i < N; i++) {
        let w = d * om[i] + (nn[i] ? J * tq[i] / nn[i] : 0) - KH * sn[i] + NOISE * (rnd() - .5) * 2;
        w = softclip(w, WMAX); om[i] = w;
        let dt = w;
        if (kick) { const dx = x[i] - UX, dy = y[i] - UY, q = (dx * dx + dy * dy) / s2; if (q < 9) dt += KICK * uin * Math.exp(-q); }   // the UGV's swerve
        let t = th[i] + dt; if (t > Math.PI) t -= TAU; else if (t < -Math.PI) t += TAU; th[i] = t;
        // rotate (cos θ, sin θ) by dt with short series (|dt| <= 1.4), then renormalise: no trigonometry per drone
        const d2 = dt * dt, sw = dt * (1 - d2 / 6 * (1 - d2 / 20 * (1 - d2 / 42))), cw = 1 - d2 / 2 * (1 - d2 / 12 * (1 - d2 / 30));
        let c = cs[i] * cw - sn[i] * sw, sn2 = sn[i] * cw + cs[i] * sw; const m = 1 / Math.sqrt(c * c + sn2 * sn2); c *= m; sn2 *= m; cs[i] = c; sn[i] = sn2;
        let a = x[i] + V0 * c + px[i], b = y[i] + V0 * sn2 + py[i];
        if (a < 0) a += LX; else if (a >= LX) a -= LX; if (b < 0) b += LY; else if (b >= LY) b -= LY;
        x[i] = a; y[i] = b;
      }
      kick = false;
    },
    features(out, at = 0) {                                       // mean sin θ of the drones in each of the 9 x 7 probe cells
      pcnt.fill(0); psum.fill(0);
      for (let i = 0; i < N; i++) { let a = (x[i] / LX * PX) | 0, b = (y[i] / LY * PY) | 0; if (a >= PX) a = PX - 1; if (b >= PY) b = PY - 1; const q = b * PX + a; psum[q] += sn[i]; pcnt[q]++; }
      for (let q = 0; q < NPROBE; q++) out[at + q] = pcnt[q] ? psum[q] / pcnt[q] : 0;
    },
    reset() { th.fill(0); om.fill(0); cs.fill(1); sn.fill(0); swerve = 0; },
  };
  return o;
}

// ------------------------------------------------------------------ training: a run of the reservoir, then ridge regression
// A job steps a reservoir through WASH + TRAIN + TEST ticks of a random input (in slices, so no frame waits for it),
// then solves the 64 x 64 normal equations once for all 20 delays.
export const WASH = 30, TRAIN = 360, TEST = 160, TICKS = WASH + TRAIN + TEST, NF = NPROBE + 1;
export function makeJob(res, kap, seed) {
  res.setK(kap); res.reset();
  return { res, kap, seed, rnd: lcg(seed), t: 0, u: new Float32Array(TICKS), F: new Float32Array(TICKS * NPROBE),
    A: new Float64Array(NF * NF), B: new Float64Array(KMAX * NF), f: new Float64Array(NF), done: false, out: null };
}
// one tick at a time, inside a time budget; the normal equations are accumulated as the training ticks arrive
export function advanceJob(job, budgetMs, now = () => performance.now()) {
  const t0 = now(), res = job.res, d = NF, A = job.A, B = job.B, f = job.f;
  while (job.t < TICKS) {
    const t = job.t, u = job.rnd() * 2 - 1; job.u[t] = u; res.drop(u);
    for (let s = 0; s < res.SPT; s++) res.step();
    res.features(job.F, t * NPROBE); job.t++;
    if (t >= WASH && t < WASH + TRAIN) {
      for (let i = 0; i < NPROBE; i++) f[i] = job.F[t * NPROBE + i]; f[NPROBE] = 1;
      for (let i = 0; i < d; i++) { const fi = f[i], r = i * d; for (let j = 0; j <= i; j++) A[r + j] += fi * f[j]; for (let k = 1; k <= KMAX; k++) B[(k - 1) * d + i] += fi * job.u[t - k]; }
    }
    if (now() - t0 > budgetMs) return false;
  }
  job.out = solveReadout(job); job.done = true;
  return true;
}
export function solveReadout(job, lam = 1e-4) {
  const d = NF, A = job.A, B = job.B, F = job.F, u = job.u;
  for (let i = 0; i < d; i++) for (let j = 0; j < i; j++) A[j * d + i] = A[i * d + j];
  let tr = 0; for (let i = 0; i < NPROBE; i++) tr += A[i * d + i]; tr /= NPROBE;
  for (let i = 0; i < NPROBE; i++) A[i * d + i] += lam * tr + 1e-12;           // ridge, relative to the typical feature power
  A[d * d - 1] += 1e-9;
  const L = new Float64Array(d * d);
  for (let i = 0; i < d; i++) for (let j = 0; j <= i; j++) { let s = A[i * d + j]; for (let k = 0; k < j; k++) s -= L[i * d + k] * L[j * d + k]; L[i * d + j] = i === j ? Math.sqrt(Math.max(s, 1e-15)) : s / L[j * d + j]; }
  const W = new Float64Array(KMAX * d), y = new Float64Array(d);
  for (let k = 0; k < KMAX; k++) {
    for (let i = 0; i < d; i++) { let s = B[k * d + i]; for (let q = 0; q < i; q++) s -= L[i * d + q] * y[q]; y[i] = s / L[i * d + i]; }
    for (let i = d - 1; i >= 0; i--) { let s = y[i]; for (let q = i + 1; q < d; q++) s -= L[q * d + i] * W[k * d + q]; W[k * d + i] = s / L[i * d + i]; }
  }
  // held-out ticks: R² (squared correlation) and the normalised mean squared error, per delay
  const R2 = new Float64Array(KMAX), NMSE = new Float64Array(KMAX);
  for (let k = 1; k <= KMAX; k++) {
    let sp = 0, st = 0, spp = 0, stt = 0, spt = 0, se = 0, n = 0; const w = W.subarray((k - 1) * d, k * d);
    for (let t = WASH + TRAIN; t < TICKS; t++) {
      let p = w[NPROBE]; for (let i = 0; i < NPROBE; i++) p += w[i] * F[t * NPROBE + i];
      const g = u[t - k]; sp += p; st += g; spp += p * p; stt += g * g; spt += p * g; se += (p - g) * (p - g); n++;
    }
    const cov = spt / n - sp / n * st / n, vp = spp / n - (sp / n) ** 2, vt = stt / n - (st / n) ** 2;
    R2[k - 1] = vp > 1e-12 ? Math.max(0, Math.min(1, cov * cov / (vp * vt))) : 0;
    NMSE[k - 1] = se / n / Math.max(1e-9, vt);                     // mean squared error / variance of the target
  }
  let mc = 0; for (let k = 0; k < KMAX; k++) mc += R2[k];
  return { W, R2, NMSE, mc };
}

// ------------------------------------------------------------------ the simulation page
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  cv.cv.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2, TICK = .2, HL = 72;                     // a new input every 0.2 s; 14 s of live history
  const SWEEP = [0, .3, .5, .7, .8, .85, .9, .95, 1, 1.1, 1.4];
  const make = (m, seed) => m === 'water' ? waterRes(seed) : swarmRes(seed);

  // ---------------------------------------------------------------- the live reservoirs (only the shown one runs)
  let mode = 'water', kap = .9, ksel = 5;
  const live = { water: make('water', 3), swarm: make('swarm', 4) };
  live.water.setK(kap); live.swarm.setK(kap);
  const urnd = (() => { let s = 77; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  let uH = new Float32Array(HL), fH = new Float32Array(HL * NPROBE), kH = new Float32Array(HL);
  const yH = new Float32Array(HL), hist = { water: null, swarm: null };
  function restore(m) { const h = hist[m]; uH = h.uH; fH = h.fH; kH = h.kH; nT = h.nT; stepIn = 0; recomputeY(); }
  let nT = 0, stepIn = 0, stepAcc = 0, dropT = 9, dropU = 0, settle = 0;
  // display interpolation
  const hPrev = new Float32Array(48 * 30);
  const sxo = new Float64Array(400), syo = new Float64Array(400);
  function liveStep() {
    const r = live[mode];
    if (stepIn === 0) { const u = urnd() * 2 - 1; r.drop(u); uH[nT % HL] = u; dropT = 0; dropU = u; }
    if (r.kind === 'water') hPrev.set(r.h); else { sxo.set(r.x); syo.set(r.y); }
    r.step();
    if (++stepIn === r.SPT) {                                     // the tick is complete: read the probes, run the readout
      stepIn = 0; const at = (nT % HL) * NPROBE; r.features(fH, at); kH[nT % HL] = settle > 0 ? -9 : kap; settle--;
      yH[nT % HL] = readOne(at, kap); nT++;
    }
  }

  // ---------------------------------------------------------------- readouts trained so far, and the work queue
  const result = { water: null, swarm: null };                    // { W, R2, NMSE, mc, kap }
  const sweep = { water: new Float64Array(SWEEP.length).fill(NaN), swarm: new Float64Array(SWEEP.length).fill(NaN) };
  const trained = { water: [], swarm: [] };                       // couplings the user trained at, with their capacity
  let job = null, queue = [], trainSeed = 500, retrainT = -1;
  function readOne(at, k) {
    const res = result[mode]; if (!res || Math.abs(res.kap - k) > .004) return NaN;     // a readout fits only the coupling it was trained at
    const w = res.W, o = (ksel - 1) * NF; let y = w[o + NPROBE];
    for (let i = 0; i < NPROBE; i++) y += w[o + i] * fH[at + i];
    return y;
  }
  function recomputeY() { for (let t = Math.max(0, nT - HL); t < nT; t++) yH[t % HL] = readOne((t % HL) * NPROBE, kH[t % HL]); }
  function queueTrain(fresh) {
    queue = queue.filter((q) => q.type !== 'train');
    if (job && job.type === 'train') job = null;
    queue.unshift({ type: 'train', mode, kap, seed: fresh ? ++trainSeed : trainSeed });
  }
  function queueSweep(m) { for (let i = 0; i < SWEEP.length; i++) if (isNaN(sweep[m][i]) && !queue.some((q) => q.type === 'sweep' && q.mode === m && q.i === i)) queue.push({ type: 'sweep', mode: m, i, kap: SWEEP[i], seed: 900 + i }); }
  function work(budget) {
    const t0 = performance.now();
    while (performance.now() - t0 < budget) {
      if (!job) {                                                 // what is on screen first: its readout, then its sweep
        if (!queue.length) return;
        let qi = queue.findIndex((q) => q.mode === mode && q.type === 'train');
        if (qi < 0) qi = queue.findIndex((q) => q.mode === mode);
        if (qi < 0) qi = 0;
        const q = queue.splice(qi, 1)[0];
        job = Object.assign(makeJob(make(q.mode, q.seed), q.kap, q.seed + 31), { type: q.type, mode: q.mode, i: q.i });
      }
      if (!advanceJob(job, budget - (performance.now() - t0))) return;
      const out = job.out, m = job.mode;
      if (job.type === 'train') {
        result[m] = { W: out.W, R2: out.R2, NMSE: out.NMSE, mc: out.mc, kap: job.kap };
        trained[m] = trained[m].filter((p) => Math.abs(p.kap - job.kap) > .004).concat([{ kap: job.kap, mc: out.mc }]).slice(-6);
        if (m === mode) recomputeY();
        queueSweep(m);
      } else sweep[m][job.i] = out.mc;
      job = null;
      if (!queue.length) { const o = m === 'water' ? 'swarm' : 'water'; if (!result[o]) queue.push({ type: 'train', mode: o, kap, seed: trainSeed }); else queueSweep(o); }
    }
  }
  queueTrain(false);

  // ---------------------------------------------------------------- controls and readouts
  kit.toggle(controls, { label: 'Reservoir', options: [{ v: 'water', label: 'Water' }, { v: 'swarm', label: 'Swarm' }], value: mode, onChange: (v) => {
    hist[mode] = { uH, fH, kH, nT }; mode = v; live[mode].setK(kap);
    if (hist[mode]) restore(mode);
    else { uH = new Float32Array(HL); fH = new Float32Array(HL * NPROBE); kH = new Float32Array(HL); nT = 0; stepIn = 0; for (let k = 0; k < 40 * live[mode].SPT; k++) liveStep(); recomputeY(); }
    if (job && job.mode !== mode && job.type === 'sweep') { queue.push({ type: 'sweep', mode: job.mode, i: job.i, kap: job.kap, seed: job.seed - 31 }); job = null; }
    if (!result[mode] || Math.abs(result[mode].kap - kap) > .004) queueTrain(false); else queueSweep(mode);
  } });
  kit.slider(controls, { label: 'Coupling', min: 0, max: 1.4, step: .01, value: kap, fmt: (v) => v.toFixed(2), onInput: (v) => { kap = v; live.water.setK(v); live.swarm.setK(v); retrainT = .45; settle = 5; } });
  kit.button(controls, { label: 'Train the readout', kind: 'primary', onClick: () => { queueTrain(true); } });
  kit.hint(controls, 'Coupling: how much of each motion survives a step (1 = nothing lost). Tap a bar to watch that delay.');
  const rMC = kit.readout(readouts, { label: 'Memory capacity', tone: 'teal' });
  const rErr = kit.readout(readouts, { label: 'Readout error', tone: 'rose' });
  const rW = kit.readout(readouts, { label: 'Trained weights', tone: 'ink' });
  rMC.el.style.minWidth = '104px'; rErr.el.style.minWidth = '92px';
  const wB = rW.el.querySelector('b'); wB.style.fontSize = '17px'; wB.style.paddingTop = '3px';

  // ---------------------------------------------------------------- layout
  let G = null;
  function layout() {
    const W = cv.w, H = cv.h, phone = W < 600, A = 1.6;
    if (phone) {
      const h1 = Math.round(Math.min(132, (H - 52) * .36)), tw = Math.round(h1 * A), h2 = Math.round((H - 52 - h1) * .54), h3 = H - 52 - h1 - h2;
      G = { phone, T: { x: 16, y: 16, w: tw, h: h1 }, M: { x: 16 + tw + 8, y: 16, w: W - 32 - tw - 8, h: h1 },
        K: { x: 16, y: 16 + h1 + 10, w: W - 32, h: h2 }, R: { x: 16, y: 16 + h1 + 10 + h2 + 10, w: W - 32, h: h3 } };
    } else {
      const lw = Math.round((W - 58) * .56), th = Math.round(Math.min(lw / A, (H - 40) * .62)), tw = Math.round(th * A);
      const rx = 20 + lw + 18, rw = W - rx - 20, hm = Math.round((H - 52) / 2);
      G = { phone, T: { x: 20 + Math.round((lw - tw) / 2), y: 20, w: tw, h: th }, R: { x: 20, y: 20 + th + 12, w: lw, h: H - 52 - th },
        M: { x: rx, y: 20, w: rw, h: hm }, K: { x: rx, y: 20 + hm + 12, w: rw, h: H - 52 - hm } };
    }
  }
  cv.onResize(layout); layout();

  // ---------------------------------------------------------------- input: pick a delay on the memory plot
  let hoverK = 0;
  const kAt = (x, y) => {
    const B = barGeom(); if (!B) return 0;
    if (y < B.top - 8 || y > B.bot + 14 || x < B.x0 - 4 || x > B.x0 + KMAX * B.bw + 4) return 0;
    return clamp(Math.floor((x - B.x0) / B.bw) + 1, 1, KMAX);
  };
  const onMove = (e) => { if (e.pointerType !== 'mouse') return; hoverK = kAt(e.offsetX, e.offsetY); cv.cv.style.cursor = hoverK ? 'pointer' : 'default'; };
  const onDown = (e) => { const k = kAt(e.offsetX, e.offsetY); if (k && k !== ksel) { ksel = k; recomputeY(); } };
  const onLeave = () => { hoverK = 0; cv.cv.style.cursor = 'default'; };
  cv.cv.addEventListener('pointermove', onMove); cv.cv.addEventListener('pointerdown', onDown); cv.cv.addEventListener('pointerleave', onLeave);

  // ---------------------------------------------------------------- drawing
  function fit(variants, w, size, weight = 400) { ctx.font = `${weight} ${size}px ${F.sans}`; for (const v of variants) if (ctx.measureText(v).width <= w) return v; return variants[variants.length - 1]; }
  const tw = (str, size, weight = 400) => { ctx.font = `${weight} ${size}px ${F.sans}`; return ctx.measureText(str).width; };
  function halo(str, X, Y, o) {
    ctx.font = `${o.weight || 400} ${o.size || 12}px ${o.font || F.sans}`; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(27,30,61,.9)'; ctx.strokeText(str, X, Y);
    ctx.fillStyle = o.color; ctx.fillText(str, X, Y);
  }
  // water surface: a small image, coloured by height and lit from the top left, scaled up smoothly
  const off = document.createElement('canvas'); off.width = 96; off.height = 60;
  const octx = off.getContext('2d'), img = octx.createImageData(96, 60), pix = img.data, hv = new Float32Array(48 * 30), shv = new Float32Array(48 * 30);
  const RAMP = [];                                                // height -> colour: trough (deep dusk) .. flat (panel) .. crest (teal, mist)
  for (let q = 0; q <= 256; q++) {
    const v = q / 128 - 1; let r, g, b;
    if (v < 0) { const t = Math.min(1, -v * 1.35); r = 40 + (17 - 40) * t; g = 44 + (19 - 44) * t; b = 86 + (44 - 86) * t; }
    else { const t = Math.min(1, v * 1.5); r = 40 + (127 - 40) * t; g = 44 + (212 - 44) * t; b = 86 + (207 - 86) * t; if (v > .66) { const u = (v - .66) / .34; r += (220 - r) * u * .6; g += (228 - g) * u * .6; b += (238 - b) * u * .6; } }
    RAMP.push([r, g, b]);
  }
  let alpha = 0;
  function drawWater(T) {
    const r = live.water, h = r.h, NX = 48, NY = 30;
    for (let c = 0; c < NX * NY; c++) hv[c] = hPrev[c] + (h[c] - hPrev[c]) * alpha;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {   // light from the top left: the slope of the surface
      const c = j * NX + i, v = hv[c];
      shv[c] = clamp(((i > 0 ? hv[c - 1] : v) - (i < NX - 1 ? hv[c + 1] : v) + (j > 0 ? hv[c - NX] : v) - (j < NY - 1 ? hv[c + NX] : v)) * 3.2, -1, 1);
    }
    for (let y = 0; y < 2 * NY; y++) {                             // twice the grid, bilinear: smooth ripples
      const fy = clamp((y + .5) / 2 - .5, 0, NY - 1.001), j = fy | 0, ty = fy - j;
      for (let x = 0; x < 2 * NX; x++) {
        const fx = clamp((x + .5) / 2 - .5, 0, NX - 1.001), i = fx | 0, tx = fx - i, c = j * NX + i;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const v = hv[c] * w00 + hv[c + 1] * w10 + hv[c + NX] * w01 + hv[c + NX + 1] * w11, sh = shv[c] * w00 + shv[c + 1] * w10 + shv[c + NX] * w01 + shv[c + NX + 1] * w11;
        const vv = v > 0 ? Math.sqrt(v / .8) : -Math.sqrt(-v / .8), col = RAMP[clamp(Math.round((vv + 1) * 128), 0, 256)], o = (y * 2 * NX + x) * 4;
        pix[o] = col[0] + sh * 34; pix[o + 1] = col[1] + sh * 34; pix[o + 2] = col[2] + sh * 30; pix[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.save(); roundRect(ctx, T.x, T.y, T.w, T.h, 12); ctx.clip();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(off, T.x, T.y, T.w, T.h);
    // probes
    const pP = new Path2D(), pr = G.phone ? 1.3 : 1.7;
    for (let q = 0; q < NPROBE; q++) { const c = r.probe[q], X = T.x + ((c % NX) + .5) / NX * T.w, Y = T.y + (((c / NX) | 0) + .5) / NY * T.h; pP.moveTo(X + pr, Y); pP.arc(X, Y, pr, 0, TAU); }
    ctx.fillStyle = 'rgba(243,238,242,.55)'; ctx.fill(pP);
    // the stone, at the left wall
    const sx = T.x + 1.5 / NX * T.w, sy = T.y + .5 * T.h, k = T.w / NX;
    if (dropT < .6) { ctx.strokeStyle = `rgba(246,210,177,${(.7 * (1 - dropT / .6)).toFixed(3)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx, sy, k * (1.5 + dropT * 9), -Math.PI / 2, Math.PI / 2); ctx.stroke(); }
    ctx.restore();
    const sr = 2.5 + Math.abs(dropU) * (G.phone ? 4 : 6), fa = clamp(1 - dropT / 1.2, .35, 1);
    ctx.globalAlpha = fa; ctx.fillStyle = dropU >= 0 ? C.apricot : C.haze; ctx.beginPath(); ctx.arc(T.x + 2, sy, sr, -Math.PI / 2, Math.PI / 2); ctx.fill(); ctx.globalAlpha = 1;
  }
  const TURN = ['#A99BEA', '#93B6E0', C.teal, '#C9DDB8', C.apricot];      // turned right (screen up) .. straight .. turned left
  const foff = document.createElement('canvas'); foff.width = PX; foff.height = PY;
  const fctx = foff.getContext('2d'), fimg = fctx.createImageData(PX, PY), fpx = fimg.data, fval = new Float32Array(NPROBE);
  function drawSwarm(T) {
    const r = live.swarm, sc = T.w / r.LX, L = G.phone ? 3.2 : 4.6;
    ctx.fillStyle = 'rgba(36,40,77,.75)'; roundRect(ctx, T.x, T.y, T.w, T.h, 12); ctx.fill();
    ctx.save(); roundRect(ctx, T.x, T.y, T.w, T.h, 12); ctx.clip();
    r.features(fval, 0);                                          // what the readout sees: the mean turn in each cell
    for (let q = 0; q < NPROBE; q++) {
      const v = clamp(fval[q] / .07, -1, 1), o = q * 4, a = Math.abs(v);
      if (v >= 0) { fpx[o] = 36 + (246 - 36) * a; fpx[o + 1] = 40 + (210 - 40) * a; fpx[o + 2] = 77 + (177 - 77) * a; }
      else { fpx[o] = 36 + (169 - 36) * a; fpx[o + 1] = 40 + (155 - 40) * a; fpx[o + 2] = 77 + (234 - 77) * a; }
      fpx[o + 3] = 255;
    }
    fctx.putImageData(fimg, 0, 0); ctx.globalAlpha = .62; ctx.imageSmoothingEnabled = true; ctx.drawImage(foff, T.x, T.y, T.w, T.h); ctx.globalAlpha = 1;
    const P = [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    for (let i = 0; i < r.N; i++) {
      let x0 = sxo[i], y0 = syo[i], x1 = r.x[i], y1 = r.y[i];
      if (Math.abs(x1 - x0) > 2 || Math.abs(y1 - y0) > 2) { x0 = x1; y0 = y1; }
      const X = T.x + (x0 + (x1 - x0) * alpha) * sc, Y = T.y + (y0 + (y1 - y0) * alpha) * sc, t = r.th[i], a = Math.abs(t);
      const p = P[t < -.12 ? 0 : t < -.04 ? 1 : t <= .04 ? 2 : t <= .12 ? 3 : 4], cx = Math.cos(t), cy = Math.sin(t);
      p.moveTo(X - cx * L * .55, Y - cy * L * .55); p.lineTo(X + cx * L * .45, Y + cy * L * .45);
    }
    ctx.lineCap = 'round'; ctx.lineWidth = G.phone ? 1.3 : 1.6;
    for (let q = 0; q < 5; q++) { ctx.strokeStyle = TURN[q]; ctx.stroke(P[q]); }
    // probe cells
    const pP = new Path2D(), pr = G.phone ? 1.2 : 1.6;
    for (let b = 0; b < PY; b++) for (let a = 0; a < PX; a++) { const X = T.x + (a + .5) / PX * T.w, Y = T.y + (b + .5) / PY * T.h; pP.moveTo(X + pr, Y); pP.arc(X, Y, pr, 0, TAU); }
    ctx.fillStyle = 'rgba(243,238,242,.4)'; ctx.fill(pP);
    // the UGV, swerving with u(t)
    const ux = T.x + r.UX * sc, uy = T.y + r.UY * sc, Lb = clamp(T.w * .055, 13, 24), Wb = Lb * .64, a = dropU * .6 * clamp(1 - dropT / 1.5, .3, 1);
    if (dropT < .6) { ctx.strokeStyle = `rgba(246,210,177,${(.6 * (1 - dropT / .6)).toFixed(3)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ux, uy, sc * (1 + dropT * 2.5), 0, TAU); ctx.stroke(); }
    ctx.save(); ctx.translate(ux, uy); ctx.rotate(a);
    ctx.fillStyle = 'rgba(27,30,61,.6)'; roundRect(ctx, -Lb / 2 - 3, -Wb / 2 - 4, Lb + 6, Wb + 8, Wb * .4); ctx.fill();
    ctx.fillStyle = C.haze; for (const sx of [-1, 1]) for (const sy of [-1, 1]) { roundRect(ctx, sx * Lb * .29 - Lb * .15, sy * Wb * .5 - Lb * .08, Lb * .3, Lb * .16, Lb * .06); ctx.fill(); }
    ctx.fillStyle = C.apricot; roundRect(ctx, -Lb / 2, -Wb / 2, Lb, Wb, Wb * .3); ctx.fill();
    ctx.fillStyle = C.bg; ctx.beginPath(); ctx.moveTo(Lb / 2 + 1, -Wb * .24); ctx.lineTo(Lb / 2 - Lb * .2, 0); ctx.lineTo(Lb / 2 + 1, Wb * .24); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();
  }
  function drawTank() {
    const T = G.T, phone = G.phone;
    if (mode === 'water') drawWater(T); else drawSwarm(T);
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; roundRect(ctx, T.x + .5, T.y + .5, T.w - 1, T.h - 1, 12); ctx.stroke();
    const fs = phone ? 10 : 11.5;
    const wIn = T.w - 32, top = phone ? [mode === 'water' ? 'stone in' : 'UGV swerves'] : mode === 'water' ? ['a stone every 0.2 s, size = u(t)', 'a stone every 0.2 s'] : ['the UGV swerves by u(t) every 0.2 s', 'the UGV swerves by u(t)'];
    halo(fit(top, wIn, fs), T.x + (phone ? 12 : 16), T.y + (phone ? 16 : 22), { size: fs, color: C.apricot });
    if (!phone) {
      const what = mode === 'water' ? ['the readout reads the 63 white dots; the water itself is never trained', 'the readout reads the 63 dots; the water is never trained', 'only the 63 dots are read; nothing is trained in here']
        : ['the readout reads the 63 white cells; the drones themselves are never trained', 'the readout reads the 63 cells; the drones are never trained', 'only the 63 cells are read; no drone is trained'];
      halo(fit(what, wIn, 11), T.x + 16, T.y + T.h - 14, { size: 11, color: C.muted });
    }
  }

  function barGeom() {
    const R = G.M; if (!R) return null; const phone = G.phone;
    const top = R.y + (phone ? 26 : 38), bot = R.y + R.h - (phone ? 18 : 24), x0 = R.x + (phone ? 10 : 30), w = R.w - (phone ? 18 : 44);
    return { top, bot, x0, bw: w / KMAX };
  }
  function drawMemory() {
    const R = G.M, phone = G.phone, res = result[mode], B = barGeom();
    ctx.fillStyle = C.panel; roundRect(ctx, R.x, R.y, R.w, R.h, 10); ctx.fill();
    const fs = phone ? 10 : 11.5;
    const training = job && job.type === 'train' && job.mode === mode, stale = res && Math.abs(res.kap - kap) > .004;
    const right = training ? `training ${Math.round(100 * job.t / TICKS)}%` : res && !phone ? `trained at ${res.kap.toFixed(2)}` : '', rs = phone ? 9.5 : 10.5;
    const rw = right ? tw(right, rs) + 14 : 0;
    text(ctx, fit(phone ? ['memory'] : ['memory: how well it recalls u(t − k)', 'memory: recall of u(t − k)', 'memory'], R.w - 24 - rw, fs), R.x + 12, R.y + (phone ? 15 : 20), { size: fs, color: C.muted });
    if (right) text(ctx, right, R.x + R.w - 10, R.y + (phone ? 15 : 20), { size: rs, color: training ? C.heat : stale ? C.apricot : C.faint, align: 'right' });
    const H = B.bot - B.top;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(B.x0, B.top); ctx.lineTo(B.x0 + KMAX * B.bw, B.top); ctx.moveTo(B.x0, B.top + H / 2); ctx.lineTo(B.x0 + KMAX * B.bw, B.top + H / 2); ctx.stroke();
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(B.x0, B.bot + .5); ctx.lineTo(B.x0 + KMAX * B.bw, B.bot + .5); ctx.stroke();
    if (!phone) { text(ctx, '1', B.x0 - 7, B.top + 4, { size: 9.5, color: C.faint, font: F.mono, align: 'right' }); text(ctx, 'R²', B.x0 - 7, B.top + H / 2 + 4, { size: 9.5, color: C.faint, align: 'right' }); text(ctx, '0', B.x0 - 7, B.bot + 3, { size: 9.5, color: C.faint, font: F.mono, align: 'right' }); }
    if (res) {
      const gap = Math.max(1, B.bw * .22);
      for (let k = 1; k <= KMAX; k++) {
        const v = res.R2[k - 1], x = B.x0 + (k - 1) * B.bw + gap / 2, h = Math.max(1, v * H), on = k === ksel, hv = k === hoverK;
        ctx.fillStyle = on ? C.heat : hv ? 'rgba(127,212,207,1)' : 'rgba(127,212,207,.72)';
        ctx.globalAlpha = stale || training ? .38 : 1; roundRect(ctx, x, B.bot - h, B.bw - gap, h, Math.min(2.5, (B.bw - gap) / 2)); ctx.fill(); ctx.globalAlpha = 1;
      }
      const mc = res.mc.toFixed(1);
      if (!phone) { halo(`capacity ${mc} = the sum of the bars`, B.x0 + KMAX * B.bw, B.top + 14, { size: 11, color: C.teal, align: 'right' }); }
    } else text(ctx, 'training the readout…', B.x0 + 6, B.bot - 10, { size: fs, color: C.faint });
    // delay axis, in ticks
    const yb = R.y + R.h - (phone ? 5 : 8), fa = phone ? 9 : 10;
    for (const k of phone ? [1, 10, 20] : [1, 5, 10, 15, 20]) text(ctx, String(k), B.x0 + (k - .5) * B.bw, yb, { size: fa, color: k === ksel ? C.heat : C.faint, font: F.mono, align: 'center' });
  }

  function drawHump() {
    const R = G.K, phone = G.phone, S = sweep[mode];
    ctx.fillStyle = C.panel; roundRect(ctx, R.x, R.y, R.w, R.h, 10); ctx.fill();
    const fs = phone ? 10 : 11.5;
    text(ctx, phone ? 'memory capacity vs coupling' : 'memory capacity vs coupling', R.x + 12, R.y + (phone ? 15 : 20), { size: fs, color: C.muted });
    let nDone = 0, ymax = 4; for (let i = 0; i < S.length; i++) if (!isNaN(S[i])) { nDone++; ymax = Math.max(ymax, S[i]); }
    for (const p of trained[mode]) ymax = Math.max(ymax, p.mc);
    ymax = Math.ceil(ymax * 1.18 / 2) * 2;
    if (nDone < S.length) text(ctx, `measuring ${nDone} of ${S.length}`, R.x + R.w - 10, R.y + (phone ? 15 : 20), { size: phone ? 9.5 : 10.5, color: C.faint, align: 'right' });
    const x0 = R.x + (phone ? 24 : 34), x1 = R.x + R.w - 14, top = R.y + (phone ? 26 : 34), bot = R.y + R.h - (phone ? 18 : 24);
    const X = (k) => x0 + k / 1.4 * (x1 - x0), Y = (v) => bot - v / ymax * (bot - top);
    // calm and chaotic zones, the threshold
    ctx.fillStyle = 'rgba(127,212,207,.05)'; ctx.fillRect(x0, top, X(.6) - x0, bot - top);
    ctx.fillStyle = 'rgba(240,138,126,.07)'; ctx.fillRect(X(1), top, x1 - X(1), bot - top);
    ctx.strokeStyle = 'rgba(143,140,196,.8)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(X(1), top - 4); ctx.lineTo(X(1), bot); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, top - 4); ctx.lineTo(x0, bot); ctx.lineTo(x1, bot); ctx.stroke();
    text(ctx, String(ymax), x0 - 6, top + 4, { size: 9.5, color: C.faint, font: F.mono, align: 'right' });
    text(ctx, '0', x0 - 6, bot + 3, { size: 9.5, color: C.faint, font: F.mono, align: 'right' });
    // the measured curve
    ctx.strokeStyle = 'rgba(127,212,207,.55)'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.beginPath(); let started = false;
    for (let i = 0; i < S.length; i++) { if (isNaN(S[i])) { started = false; continue; } const px = X(SWEEP[i]), py = Y(S[i]); started ? ctx.lineTo(px, py) : ctx.moveTo(px, py); started = true; }
    ctx.stroke();
    const pD = new Path2D(); let best = -1;
    for (let i = 0; i < S.length; i++) { if (isNaN(S[i])) continue; const px = X(SWEEP[i]), py = Y(S[i]); pD.moveTo(px + 3, py); pD.arc(px, py, 3, 0, TAU); if (best < 0 || S[i] > S[best]) best = i; }
    ctx.fillStyle = C.teal; ctx.fill(pD);
    if (nDone === S.length && best >= 0) halo('best memory', X(SWEEP[best]) - 9, Y(S[best]) - 4, { size: phone ? 10 : 11, color: C.teal, align: 'right', weight: 500 });
    // where you are: the coupling now, and what training there gave
    const xk = X(kap);
    ctx.strokeStyle = 'rgba(246,210,177,.85)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(xk, top - 2); ctx.lineTo(xk, bot); ctx.stroke();
    for (const p of trained[mode]) { const px = X(p.kap), py = Y(p.mc), cur = Math.abs(p.kap - kap) < .004; ctx.strokeStyle = cur ? C.apricot : 'rgba(246,210,177,.45)'; ctx.lineWidth = cur ? 2 : 1.3; ctx.beginPath(); ctx.arc(px, py, cur ? 5.5 : 4, 0, TAU); ctx.stroke(); }
    // zone words and the axis
    const fz = phone ? 9.5 : 10.5, yt = top + (phone ? 8 : 10);
    text(ctx, phone ? 'calm' : 'calm: forgets fast', x0 + 6, yt, { size: fz, color: 'rgba(127,212,207,.8)' });
    text(ctx, 'threshold', X(1) + 4, yt, { size: fz, color: 'rgba(185,182,226,.95)' });
    text(ctx, phone ? 'chaotic' : 'chaotic: noise', x1 - 4, yt + fz + 5, { size: fz, color: 'rgba(239,177,180,.85)', align: 'right' });
    const yb = R.y + R.h - (phone ? 5 : 8);
    for (const k of [0, .5, 1, 1.4]) text(ctx, k.toFixed(k === 1.4 ? 1 : k ? 1 : 0), X(k), yb, { size: phone ? 9 : 10, color: C.faint, font: F.mono, align: k === 1.4 ? 'right' : 'center' });
    if (!phone) text(ctx, 'coupling', X(.75), yb, { size: 10, color: C.faint, align: 'center' });
  }

  function drawTrace() {
    const R = G.R, phone = G.phone, res = result[mode];
    ctx.fillStyle = C.panel; roundRect(ctx, R.x, R.y, R.w, R.h, 10); ctx.fill();
    const fs = phone ? 10 : 11.5;
    const ago = (ksel * TICK).toFixed(1), what = mode === 'water' ? 'the stone' : 'the swerve';
    ctx.font = `400 ${fs}px ${F.sans}`; const wR = ctx.measureText('readout').width, wT = ctx.measureText('target').width;
    const lx2 = R.x + R.w - 12 - wR, lx1 = lx2 - 24 - wT - 20, ly = R.y + (phone ? 11 : 16);
    text(ctx, fit([`recall u(t − ${ksel}): ${what} ${ago} s ago`, `recall u(t − ${ksel}), ${ago} s ago`, `u(t − ${ksel}), ${ago} s ago`], lx1 - R.x - 24, fs), R.x + 12, R.y + (phone ? 15 : 20), { size: fs, color: C.muted });
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(243,238,242,.8)'; ctx.beginPath(); ctx.moveTo(lx1, ly); ctx.lineTo(lx1 + 14, ly); ctx.stroke();
    text(ctx, 'target', lx1 + 19, ly + 4, { size: fs, color: C.muted });
    ctx.strokeStyle = C.teal; ctx.beginPath(); ctx.moveTo(lx2 - 20, ly); ctx.lineTo(lx2 - 6, ly); ctx.stroke();
    text(ctx, 'readout', lx2, ly + 4, { size: fs, color: C.teal });
    const x0 = R.x + 12, x1 = R.x + R.w - 12, top = R.y + (phone ? 22 : 30), bot = R.y + R.h - 10, mid = (top + bot) / 2, A = (bot - top) / 2 / 1.25;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, mid); ctx.lineTo(x1, mid); ctx.stroke();
    const n = Math.min(nT, HL - ksel - 1), span = 36, X = (age) => x1 - (age + (stepIn / live[mode].SPT)) / span * (x1 - x0);
    if (n < 2) return;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, top - 4, x1 - x0, bot - top + 8); ctx.clip();
    // target: the input k ticks before each tick
    ctx.strokeStyle = 'rgba(243,238,242,.8)'; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let a = 0; a < n; a++) { const t = nT - 1 - a; if (t - ksel < 0) break; const px = X(a), py = mid - uH[(t - ksel) % HL] * A; a ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
    let gap = 0;
    ctx.strokeStyle = C.teal; ctx.lineWidth = 2; ctx.beginPath(); let pen = false;
    for (let a = 0; a < n; a++) {
      const v = yH[(nT - 1 - a) % HL]; if (v !== v) { pen = false; if (a < 3) gap++; continue; }
      const px = X(a), py = mid - clamp(v, -1.6, 1.6) * A; pen ? ctx.lineTo(px, py) : ctx.moveTo(px, py); pen = true;
    }
    ctx.stroke();
    ctx.restore();
    if (gap) halo(res ? 'retraining for this coupling…' : 'training…', x1 - 6, bot - 8, { size: phone ? 10 : 11, color: C.heat, align: 'right' });
  }

  function draw() { cv.clear(); drawTank(); drawMemory(); drawHump(); drawTrace(); }
  function setReadouts() {
    const res = result[mode];
    if (!res) { rMC.set('…'); rErr.set('…'); }
    else { rMC.set(res.mc.toFixed(1)); rErr.set(Math.round(100 * Math.min(9.99, res.NMSE[ksel - 1])) + '%'); }
    rW.set(`${NF} + 0 inside`);
  }

  // ---------------------------------------------------------------- loop
  const loop = kit.loop((dt) => {
    dt = Math.max(0, Math.min(.05, dt || 0));
    const r = live[mode];
    stepAcc += dt * r.SPT / TICK; let n = Math.floor(stepAcc); stepAcc -= n; if (n > 6) n = 6;
    for (let k = 0; k < n; k++) liveStep();
    alpha = clamp(stepAcc, 0, 1); dropT += dt;
    if (retrainT >= 0) { retrainT -= dt; if (retrainT < 0) queueTrain(false); }
    work(loop.running ? 2.5 : .6);
    if (loop.running) { draw(); setReadouts(); }
  });
  for (let k = 0; k < HL * live.water.SPT; k++) liveStep();        // 14 s of live history for the trace
  hPrev.set(live.water.h); sxo.set(live.swarm.x); syo.set(live.swarm.y);
  alpha = 1; draw(); setReadouts();
  return {
    start() { loop.start(); }, stop() { loop.stop(); },
    destroy() { loop.stop(); cv.cv.removeEventListener('pointermove', onMove); cv.cv.removeEventListener('pointerdown', onDown); cv.cv.removeEventListener('pointerleave', onLeave); cv.destroy(); },
  };
}

// The swarm as one machine (Koopman 1931; dynamic mode decomposition). A swarm of 150 boids circles a UGV that drives a
// rounded-triangle loop, slowing in the corners: the swarm streams behind it on the straights and curls into a mill in
// the corners. Agent by agent that is strongly nonlinear. Koopman: track the right functions g of the state and the
// evolution becomes linear, K g(x_k) = g(x_{k+1}); DMD learns K from snapshots by least squares.
//   raw observables (7 + 1): centre x, y; mean velocity x, y; order Φ; spin (milling); spread; a constant
//   lifted (22): the raw ones + cos kθ, sin kθ of the centre's bearing θ (k = 1..6) + two products of the centre
// K is fitted on snapshot pairs 0.5 s apart over the last 'Learn from' seconds (ridge-regularised normal equations,
// Cholesky), the forecast is z_{n+1} = K z_n, and the eigenvalues of K come from Hessenberg + shifted QR. All small.
// The error is the distance between the predicted and the real centre, as a fraction of the loop's RMS radius.
export function koopSwarm(N, seed) {
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const W = 100;                                                   // the room is W x W world units
  const P = { R0: 22, A: .3, B: .4, T: 10, RO: 6, VMAX: 30, VMIN: 5, VORB: 12, KS: 3.2, KT: 1.2, KA: .8, NOISE: 10, RS: 2.4, RA: 4.5 };
  const x = new Float64Array(N), y = new Float64Array(N), vx = new Float64Array(N), vy = new Float64Array(N);
  const ax = new Float64Array(N), ay = new Float64Array(N);
  const st = { t: 0, ph: 0, ux: 50, uy: 50, uvx: 0, uvy: 0 };
  // counting-sorted cells of side RA
  const CS = P.RA, G = Math.ceil(W / CS), NCELL = G * G;
  const cnt = new Int32Array(NCELL), start = new Int32Array(NCELL + 1), cell = new Int32Array(N), ord = new Int32Array(N);
  const sx = new Float64Array(N), sy = new Float64Array(N), svx = new Float64Array(N), svy = new Float64Array(N);
  const path = (ph, o) => { const r = P.R0 * (1 + P.A * Math.cos(3 * ph)); o.ux = 50 + r * Math.cos(ph); o.uy = 50 + r * Math.sin(ph); return o; };
  const tmp = { ux: 0, uy: 0 };
  function init() {                                               // a fresh ring of agents around the UGV (takes ~2 laps to settle)
    st.t = 0; st.ph = 0; path(0, st);
    const dt = 1e-3; path(dt * 2 * Math.PI / P.T * (1 - P.B), tmp); const uvx = (tmp.ux - st.ux) / dt, uvy = (tmp.uy - st.uy) / dt;
    for (let i = 0; i < N; i++) { const a = rnd() * 6.2832, d = P.RO * (.55 + .9 * Math.sqrt(rnd())); x[i] = st.ux + Math.cos(a) * d; y[i] = st.uy + Math.sin(a) * d; vx[i] = uvx - Math.sin(a) * P.VORB; vy[i] = uvy + Math.cos(a) * P.VORB; }
  }
  function load(q, ph) {                                          // a settled state (x, y, vx, vy per agent, tenths)
    const a = q.split(',');
    for (let i = 0; i < N; i++) { const k = (i % (a.length >> 2)) * 4; x[i] = a[k] / 10; y[i] = a[k + 1] / 10; vx[i] = a[k + 2] / 10; vy[i] = a[k + 3] / 10; }
    st.t = 0; st.ph = ph; path(ph, st);
  }
  function step(dt) {
    // the UGV: constant loop, slower in the three corners (where the loop bulges out)
    st.t += dt; st.ph += dt * 2 * Math.PI / P.T * (1 - P.B * Math.cos(3 * st.ph));
    path(st.ph, tmp); st.uvx = (tmp.ux - st.ux) / dt; st.uvy = (tmp.uy - st.uy) / dt; st.ux = tmp.ux; st.uy = tmp.uy;
    cnt.fill(0);
    for (let i = 0; i < N; i++) {
      let cx = (x[i] / CS) | 0, cy = (y[i] / CS) | 0; cx = cx < 0 ? 0 : cx >= G ? G - 1 : cx; cy = cy < 0 ? 0 : cy >= G ? G - 1 : cy;
      const c = cy * G + cx; cell[i] = c; cnt[c]++;
    }
    start[0] = 0; for (let c = 0; c < NCELL; c++) { start[c + 1] = start[c] + cnt[c]; cnt[c] = start[c]; }
    for (let i = 0; i < N; i++) { const p = cnt[cell[i]]++; ord[p] = i; sx[p] = x[i]; sy[p] = y[i]; svx[p] = vx[i]; svy[p] = vy[i]; }
    const RA2 = P.RA * P.RA, RS = P.RS, RS2 = RS * RS, ux = st.ux, uy = st.uy, uvx = st.uvx, uvy = st.uvy;
    for (let p = 0; p < N; p++) {
      const xi = sx[p], yi = sy[p], c = cell[ord[p]], cx = c % G, cy = (c / G) | 0;
      let fx = 0, fy = 0, mx = 0, my = 0, na = 0;
      const gx0 = cx > 0 ? cx - 1 : 0, gx1 = cx < G - 1 ? cx + 1 : cx, gy0 = cy > 0 ? cy - 1 : 0, gy1 = cy < G - 1 ? cy + 1 : cy;
      for (let gy = gy0; gy <= gy1; gy++) {
        const a0 = start[gy * G + gx0], a1 = start[gy * G + gx1 + 1];
        for (let q = a0; q < a1; q++) {
          if (q === p) continue;
          const dx = sx[q] - xi, dy = sy[q] - yi, d2 = dx * dx + dy * dy;
          if (d2 > RA2) continue;
          mx += svx[q]; my += svy[q]; na++;
          if (d2 < RS2) { const d = Math.sqrt(d2) + 1e-6, f = (RS - d) / RS / d * 60; fx -= dx * f; fy -= dy * f; }
        }
      }
      const vxi = svx[p], vyi = svy[p];
      if (na) { fx += (mx / na - vxi) * P.KA; fy += (my / na - vyi) * P.KA; }
      // orbit the UGV at radius RO, counter-clockwise, at VORB relative to it
      const dx = xi - ux, dy = yi - uy, d = Math.sqrt(dx * dx + dy * dy) + 1e-6, rx = dx / d, ry = dy / d;
      fx -= rx * (d - P.RO) * P.KS; fy -= ry * (d - P.RO) * P.KS;
      const vt = (vxi - uvx) * -ry + (vyi - uvy) * rx;
      fx -= ry * (P.VORB - vt) * P.KT; fy += rx * (P.VORB - vt) * P.KT;
      if (xi < 6) fx += (6 - xi) * 30; else if (xi > W - 6) fx -= (xi - W + 6) * 30;
      if (yi < 6) fy += (6 - yi) * 30; else if (yi > W - 6) fy -= (yi - W + 6) * 30;
      fx += (rnd() - .5) * P.NOISE; fy += (rnd() - .5) * P.NOISE;
      const i = ord[p]; ax[i] = fx; ay[i] = fy;
    }
    for (let i = 0; i < N; i++) {
      let a = vx[i] + ax[i] * dt, b = vy[i] + ay[i] * dt; const sp = Math.sqrt(a * a + b * b) + 1e-9;
      if (sp > P.VMAX) { a *= P.VMAX / sp; b *= P.VMAX / sp; } else if (sp < P.VMIN) { a *= P.VMIN / sp; b *= P.VMIN / sp; }
      vx[i] = a; vy[i] = b; let X = x[i] + a * dt, Y = y[i] + b * dt;
      x[i] = X < 1 ? 1 : X > W - 1 ? W - 1 : X; y[i] = Y < 1 ? 1 : Y > W - 1 ? W - 1 : Y;
    }
  }
  // the seven raw observables, normalised to order one
  function observe(o, at = 0) {
    let cx = 0, cy = 0, mvx = 0, mvy = 0, hx = 0, hy = 0;
    for (let i = 0; i < N; i++) { cx += x[i]; cy += y[i]; mvx += vx[i]; mvy += vy[i]; const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]) + 1e-9; hx += vx[i] / sp; hy += vy[i] / sp; }
    cx /= N; cy /= N; mvx /= N; mvy /= N;
    let mil = 0, s2 = 0;
    for (let i = 0; i < N; i++) { const dx = x[i] - cx, dy = y[i] - cy, d = Math.sqrt(dx * dx + dy * dy) + 1e-9, sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]) + 1e-9; mil += (dx * vy[i] - dy * vx[i]) / (d * sp); s2 += dx * dx + dy * dy; }
    o[at] = (cx - 50) / 30; o[at + 1] = (cy - 50) / 30; o[at + 2] = mvx / 15; o[at + 3] = mvy / 15;
    o[at + 4] = Math.sqrt(hx * hx + hy * hy) / N; o[at + 5] = mil / N; o[at + 6] = Math.sqrt(s2 / N) / 10;
    return o;
  }
  init();
  return { N, W, P, x, y, vx, vy, st, step, observe, path, load };
}

// the swarm after 40 s of flight (seed 21): starting from here, the very first forecast already sees a settled swarm
export const WARM = { ph: 4.186676, q: '255,200,-16,-243,441,276,-56,14,462,243,49,11,233,124,55,-217,217,241,-20,-207,214,163,0,-235,376,255,52,-62,477,225,49,-10,452,256,-48,-15,236,162,8,-241,368,65,126,-123,407,237,-9,-49,387,138,109,-86,387,223,-107,-49,332,247,-27,-149,245,178,-1,-249,404,247,-57,19,446,194,49,-13,207,142,60,-203,471,154,65,1,441,173,47,-22,490,232,50,4,265,277,-109,-189,500,215,51,-8,409,151,75,-17,382,86,95,-115,374,131,72,-58,400,207,-37,-34,384,285,-80,1,427,86,116,-46,456,112,107,-26,283,283,-103,-191,462,198,51,-8,399,116,118,-57,227,144,36,-235,292,168,-6,-243,457,188,49,-11,386,255,-113,-101,191,212,7,-215,470,216,49,8,450,152,84,-5,322,277,-104,-146,420,167,47,-21,280,242,-53,-236,430,227,-60,8,439,106,103,-52,252,262,-85,-222,269,62,107,-184,427,305,-81,1,386,116,92,-93,418,109,90,-48,344,101,123,-144,327,112,91,-205,181,193,26,-241,246,222,-38,-240,412,229,20,-85,280,198,-25,-227,211,121,70,-209,356,49,140,-100,396,146,88,-40,412,172,42,-27,364,271,-39,-104,285,121,57,-249,454,177,62,-19,455,163,71,-23,389,71,113,-76,241,82,87,-190,422,206,-29,-41,447,213,51,-14,408,126,65,-33,319,70,88,-160,486,169,76,9,267,85,100,-175,421,274,-74,-3,232,233,-53,-220,250,101,75,-200,413,142,81,-44,335,291,-107,-125,266,239,-47,-207,415,193,31,-39,470,176,72,-23,461,209,68,1,277,104,68,-210,410,261,16,-47,290,142,45,-217,474,192,53,-8,211,203,-8,-245,303,252,-81,-201,359,112,78,-133,419,186,43,-25,433,258,-36,35,250,146,27,-248,448,218,-44,-25,397,95,101,-89,482,210,63,-6,197,185,13,-222,232,193,-4,-234,435,187,50,-5,215,185,-10,-232,259,120,73,-229,244,276,-60,-186,395,166,48,-42,409,75,128,-62,432,218,5,-50,470,132,90,-30,341,81,94,-143,438,206,6,-50,434,196,24,-44,303,267,-109,-159,300,55,110,-166,493,192,60,0,295,74,105,-166,403,260,-49,-18,221,216,-11,-223,422,283,-54,-6,295,90,102,-174,427,126,102,-61,358,99,96,-100,363,79,119,-125,200,238,1,-220,341,62,124,-117,406,297,-103,3,431,177,58,-7,286,263,-124,-182,429,150,84,-23,451,136,74,-24,378,105,132,-58,227,256,-39,-212,359,122,93,-171,305,287,-92,-156,246,244,-48,-209,190,163,14,-226,226,101,70,-210,423,248,-56,-25,322,50,94,-133,410,97,115,-90,392,184,-16,-48,435,157,89,-13,392,317,-91,-42,375,297,-127,-10,208,222,-8,-216,484,252,35,36,269,222,-15,-232,325,90,76,-130,436,134,78,-31,265,165,4,-234,268,258,-66,-220,383,266,-99,-25,432,232,-42,34,236,211,-35,-229' };

// the dictionary of observables: raw = 1 + 7, lifted = 22
export const NRAW = 7, HARM = 6;
export function lift(raw, at, lifted, z, zat) {
  let k = zat; z[k++] = 1;
  for (let i = 0; i < NRAW; i++) z[k++] = raw[at + i];
  if (lifted) {
    const cx = raw[at], cy = raw[at + 1], th = Math.atan2(cy, cx);
    for (let h = 1; h <= HARM; h++) { z[k++] = Math.cos(h * th); z[k++] = Math.sin(h * th); }
    z[k++] = cx * cy; z[k++] = cx * cx - cy * cy;
  }
  return k - zat;
}
export const dimOf = (lifted) => lifted ? 1 + NRAW + 2 * HARM + 2 : 1 + NRAW;

// K from snapshot pairs (k, k + lag), k in [a, b - lag): ridge-regularised normal equations, Cholesky. Row 0 keeps the
// constant constant. Z is row-major (snapshot x d); scratch arrays have room for d x d.
export function fitK(Z, d, a, b, lag, lam, K, A, B, L) {
  A.fill(0, 0, d * d); B.fill(0, 0, d * d);
  for (let k = a; k < b - lag; k++) {
    const o = k * d, p = (k + lag) * d;
    for (let i = 0; i < d; i++) { const xi = Z[o + i]; for (let j = 0; j < d; j++) { A[i * d + j] += xi * Z[o + j]; B[i * d + j] += Z[p + i] * Z[o + j]; } }
  }
  const n = Math.max(1, b - a - lag);
  for (let i = 1; i < d; i++) A[i * d + i] += lam * n;
  A[0] += 1e-9;
  for (let i = 0; i < d; i++) for (let j = 0; j <= i; j++) {
    let s = A[i * d + j]; for (let k = 0; k < j; k++) s -= L[i * d + k] * L[j * d + k];
    if (i === j) L[i * d + i] = Math.sqrt(Math.max(s, 1e-12)); else L[i * d + j] = s / L[j * d + j];
  }
  const y = new Float64Array(d);
  for (let r = 0; r < d; r++) {                                   // K A = B, A symmetric: solve A k_r = B_r for each row
    for (let i = 0; i < d; i++) { let s = B[r * d + i]; for (let k = 0; k < i; k++) s -= L[i * d + k] * y[k]; y[i] = s / L[i * d + i]; }
    for (let i = d - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < d; k++) s -= L[k * d + i] * K[r * d + k]; K[r * d + i] = s / L[i * d + i]; }
  }
  for (let j = 0; j < d; j++) K[j] = j === 0 ? 1 : 0;
  return K;
}

// eigenvalues of a real n x n matrix (row-major, overwritten): balance, reduce to Hessenberg form by elimination, then
// the Francis double-shift QR iteration (after Numerical Recipes' balanc, elmhes and hqr). Returns false if it stalls.
export function eigvals(a, n, wr, wi) {
  for (let done = false; !done;) {                               // balance
    done = true;
    for (let i = 0; i < n; i++) {
      let r = 0, c = 0;
      for (let j = 0; j < n; j++) if (j !== i) { c += Math.abs(a[j * n + i]); r += Math.abs(a[i * n + j]); }
      if (c && r) {
        let g = r / 2, f = 1; const s = c + r;
        while (c < g) { f *= 2; c *= 4; }
        g = r * 2;
        while (c > g) { f /= 2; c /= 4; }
        if ((c + r) / f < .95 * s) { done = false; g = 1 / f; for (let j = 0; j < n; j++) a[i * n + j] *= g; for (let j = 0; j < n; j++) a[j * n + i] *= f; }
      }
    }
  }
  for (let m = 1; m < n - 1; m++) {                              // Hessenberg
    let x = 0, i = m;
    for (let j = m; j < n; j++) if (Math.abs(a[j * n + m - 1]) > Math.abs(x)) { x = a[j * n + m - 1]; i = j; }
    if (i !== m) {
      for (let j = m - 1; j < n; j++) { const t = a[i * n + j]; a[i * n + j] = a[m * n + j]; a[m * n + j] = t; }
      for (let j = 0; j < n; j++) { const t = a[j * n + i]; a[j * n + i] = a[j * n + m]; a[j * n + m] = t; }
    }
    if (x) for (i = m + 1; i < n; i++) {
      let y = a[i * n + m - 1];
      if (y) { y /= x; a[i * n + m - 1] = y; for (let j = m; j < n; j++) a[i * n + j] -= y * a[m * n + j]; for (let j = 0; j < n; j++) a[j * n + m] += y * a[j * n + i]; }
    }
  }
  for (let i = 2; i < n; i++) for (let j = 0; j < i - 1; j++) a[i * n + j] = 0;
  let anorm = 0;
  for (let i = 0; i < n; i++) for (let j = Math.max(i - 1, 0); j < n; j++) anorm += Math.abs(a[i * n + j]);
  let nn = n - 1, t = 0, p = 0, q = 0, r = 0, s = 0, w = 0, x = 0, y = 0, z = 0;
  while (nn >= 0) {
    let its = 0, l;
    do {
      for (l = nn; l >= 1; l--) {
        s = Math.abs(a[(l - 1) * n + l - 1]) + Math.abs(a[l * n + l]); if (s === 0) s = anorm;
        if (Math.abs(a[l * n + l - 1]) + s === s) { a[l * n + l - 1] = 0; break; }
      }
      x = a[nn * n + nn];
      if (l === nn) { wr[nn] = x + t; wi[nn--] = 0; }
      else {
        y = a[(nn - 1) * n + nn - 1]; w = a[nn * n + nn - 1] * a[(nn - 1) * n + nn];
        if (l === nn - 1) {
          p = .5 * (y - x); q = p * p + w; z = Math.sqrt(Math.abs(q)); x += t;
          if (q >= 0) { z = p + (p >= 0 ? z : -z); wr[nn - 1] = wr[nn] = x + z; if (z) wr[nn] = x - w / z; wi[nn - 1] = wi[nn] = 0; }
          else { wr[nn - 1] = wr[nn] = x + p; wi[nn - 1] = -(wi[nn] = z); }
          nn -= 2;
        } else {
          if (its === 60) return false;
          if (its === 10 || its === 20) { t += x; for (let i = 0; i <= nn; i++) a[i * n + i] -= x; s = Math.abs(a[nn * n + nn - 1]) + Math.abs(a[(nn - 1) * n + nn - 2]); y = x = .75 * s; w = -.4375 * s * s; }
          ++its;
          let m;
          for (m = nn - 2; m >= l; m--) {
            z = a[m * n + m]; r = x - z; s = y - z;
            p = (r * s - w) / a[(m + 1) * n + m] + a[m * n + m + 1]; q = a[(m + 1) * n + m + 1] - z - r - s; r = a[(m + 2) * n + m + 1];
            s = Math.abs(p) + Math.abs(q) + Math.abs(r); p /= s; q /= s; r /= s;
            if (m === l) break;
            const u = Math.abs(a[m * n + m - 1]) * (Math.abs(q) + Math.abs(r));
            const v = Math.abs(p) * (Math.abs(a[(m - 1) * n + m - 1]) + Math.abs(z) + Math.abs(a[(m + 1) * n + m + 1]));
            if (u + v === v) break;
          }
          for (let i = m + 2; i <= nn; i++) { a[i * n + i - 2] = 0; if (i !== m + 2) a[i * n + i - 3] = 0; }
          for (let k = m; k <= nn - 1; k++) {
            if (k !== m) {
              p = a[k * n + k - 1]; q = a[(k + 1) * n + k - 1]; r = 0;
              if (k !== nn - 1) r = a[(k + 2) * n + k - 1];
              if ((x = Math.abs(p) + Math.abs(q) + Math.abs(r)) !== 0) { p /= x; q /= x; r /= x; }
            }
            const sg = Math.sqrt(p * p + q * q + r * r);
            if ((s = p >= 0 ? sg : -sg) !== 0) {
              if (k === m) { if (l !== m) a[k * n + k - 1] = -a[k * n + k - 1]; } else a[k * n + k - 1] = -s * x;
              p += s; x = p / s; y = q / s; z = r / s; q /= p; r /= p;
              for (let j = k; j <= nn; j++) {
                p = a[k * n + j] + q * a[(k + 1) * n + j];
                if (k !== nn - 1) { p += r * a[(k + 2) * n + j]; a[(k + 2) * n + j] -= p * z; }
                a[(k + 1) * n + j] -= p * y; a[k * n + j] -= p * x;
              }
              const mmin = nn < k + 3 ? nn : k + 3;
              for (let i = l; i <= mmin; i++) {
                p = x * a[i * n + k] + y * a[i * n + k + 1];
                if (k !== nn - 1) { p += z * a[i * n + k + 2]; a[i * n + k + 2] -= p * r; }
                a[i * n + k + 1] -= p * q; a[i * n + k] -= p;
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  return true;
}

// ------------------------------------------------------------------ the simulation page
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  cv.cv.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2;
  const DT = 1 / 30, SUB = 3, SNAP = DT * SUB;                  // physics at 30 Hz, one snapshot of the observables every 0.1 s
  const LAG = 5, LAM = 1e-5, NODES = 20, HOR = NODES * LAG;      // K advances 0.5 s; the forecast is 20 steps = 10 s
  const CAP = 420, N = 150, PRE = 330;                           // 42 s of history; 11 s of flight before the page shows
  const sw = koopSwarm(N, 7);
  sw.load(WARM.q, WARM.ph);

  // ---------------------------------------------------------------- history and the forecast
  const raw = new Float64Array(CAP * NRAW);
  let ns = 0;                                                    // snapshots taken so far (ring buffer of CAP)
  const DMAX = dimOf(true);
  const Z = new Float64Array(CAP * DMAX), Km = new Float64Array(DMAX * DMAX), Am = new Float64Array(DMAX * DMAX), Bm = new Float64Array(DMAX * DMAX), Lm = new Float64Array(DMAX * DMAX), Ke = new Float64Array(DMAX * DMAX);
  const zc = new Float64Array(DMAX), zn = new Float64Array(DMAX);
  const nodes = new Float64Array((NODES + 1) * NRAW), pred = new Float64Array((HOR + 1) * NRAW);
  const ewr = new Float64Array(DMAX), ewi = new Float64Array(DMAX);
  const ox = new Float64Array(N), oy = new Float64Array(N);
  let sub = 0, oux = sw.st.ux, ouy = sw.st.uy;
  let learn = 14, lifted = 1, fc = null, pending = false, shift = 0, nOn = 0, nOut = 0, nIn = 0;
  const at = (k) => (k % CAP) * NRAW;                             // where snapshot k lives
  function snapshot() { sw.observe(raw, at(ns)); ns++; }
  function physics() {
    for (let i = 0; i < N; i++) { ox[i] = sw.x[i]; oy[i] = sw.y[i]; }
    oux = sw.st.ux; ouy = sw.st.uy;
    sw.step(DT);
    if (++sub === SUB) { sub = 0; snapshot(); scoreSnapshot(); }
  }
  snapshot();
  for (let k = 0; k < PRE; k++) physics();
  // the error scale: the RMS radius of the loop the swarm's centre travels (measured on the flight so far)
  let sigC = .95;
  { let mx = 0, my = 0; const n = ns; for (let k = 0; k < n; k++) { mx += raw[at(k)] / n; my += raw[at(k) + 1] / n; }
    let s = 0; for (let k = 0; k < n; k++) s += ((raw[at(k)] - mx) ** 2 + (raw[at(k) + 1] - my) ** 2) / n; sigC = clamp(Math.sqrt(s), .6, 1.3); }

  function forecast() {
    const nL = Math.min(learn * 10, ns - 1);
    if (nL < 3 * LAG) return;
    const d = dimOf(!!lifted), a = ns - 1 - nL, n = ns - a;
    for (let k = a; k < ns; k++) lift(raw, at(k), !!lifted, Z, (k - a) * d);
    fitK(Z, d, 0, n, LAG, LAM, Km, Am, Bm, Lm);
    for (let i = 0; i < d; i++) zc[i] = Z[(n - 1) * d + i];
    for (let i = 0; i < NRAW; i++) nodes[i] = zc[1 + i];
    for (let s = 1; s <= NODES; s++) {                            // the forecast: multiply by K, twenty times
      for (let i = 0; i < d; i++) { let v = 0; const r = i * d; for (let j = 0; j < d; j++) v += Km[r + j] * zc[j]; zn[i] = v; }
      for (let i = 0; i < d; i++) zc[i] = clamp(zn[i], -1e6, 1e6);
      for (let i = 0; i < NRAW; i++) nodes[s * NRAW + i] = zc[1 + i];
    }
    for (let j = 0; j <= HOR; j++) {                              // between the 0.5 s nodes: Catmull-Rom (display and scoring)
      const u = j / LAG, s = Math.min(NODES - 1, Math.floor(u)), f = u - s, f2 = f * f, f3 = f2 * f;
      for (let i = 0; i < NRAW; i++) {
        const p1 = nodes[s * NRAW + i], p2 = nodes[(s + 1) * NRAW + i];
        const p0 = s > 0 ? nodes[(s - 1) * NRAW + i] : 2 * p1 - p2, p3 = s + 2 <= NODES ? nodes[(s + 2) * NRAW + i] : 2 * p2 - p1;
        pred[j * NRAW + i] = .5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (3 * p1 - p0 - 3 * p2 + p3) * f3);
      }
    }
    for (let i = 0; i < d * d; i++) Ke[i] = Km[i];
    const ok = eigvals(Ke, d, ewr, ewi);
    nOn = nOut = nIn = 0;
    if (ok) for (let i = 0; i < d; i++) { const m = Math.hypot(ewr[i], ewi[i]); if (m > 1.02) nOut++; else if (m >= .97) nOn++; else nIn++; }
    if (fc) shift = Math.min(12, (ns - 1 - fc.t0) * SNAP);
    waited = 0;
    fc = { t0: ns - 1, d, lifted, used: nL / 10, worst: 0, ahead: -1, j: 0, done: false, hold: 0, eig: ok };
  }
  function scoreSnapshot() {                                      // how far the forecast is from what really happened
    if (!fc || fc.done) return;
    const j = ns - 1 - fc.t0; if (j < 1 || j > HOR) return;
    const o = at(ns - 1), p = j * NRAW;
    let e = Math.hypot(pred[p] - raw[o], pred[p + 1] - raw[o + 1]) / sigC; if (!(e < 1e4)) e = 1e4;
    fc.j = j; if (e > fc.worst) fc.worst = e;
    if (fc.ahead < 0 && e > .1) fc.ahead = (j - 1) * SNAP;
    if (j === HOR) { fc.done = true; fc.hold = 0; }
  }
  let waited = 0;

  // ---------------------------------------------------------------- controls and readouts
  kit.slider(controls, { label: 'Learn from', min: 2, max: 20, step: 1, value: learn, fmt: (v) => v + ' s', onInput: (v) => { learn = v; pending = true; } });
  kit.toggle(controls, { label: 'Observables', options: [{ v: 0, label: 'Raw' }, { v: 1, label: 'Lifted' }], value: 1, onChange: (v) => { lifted = v; pending = true; } });
  kit.button(controls, { label: 'Predict now', kind: 'primary', onClick: () => { pending = true; } });
  kit.hint(controls, 'Lifted adds 14 functions of the 7 raw averages. Either way, the forecast is one matrix multiply.');
  const rErr = kit.readout(readouts, { label: 'Prediction error', tone: 'rose' });
  const rAhead = kit.readout(readouts, { label: 'Predicts ahead', tone: 'heat' });
  const rSize = kit.readout(readouts, { label: 'Matrix size', tone: 'ink' });
  rErr.el.style.minWidth = '100px'; rAhead.el.style.minWidth = '94px'; rSize.el.style.minWidth = '84px';

  // ---------------------------------------------------------------- layout
  let G = null;
  function layout() {
    const W = cv.w, H = cv.h, phone = W < 600;
    if (phone) {
      const side = Math.round(Math.min((W - 32 - 10) * .58, H * .5));
      G = { phone, A: { x: 16, y: 16, s: side }, PB: { x: 16 + side + 10, y: 16, w: W - 32 - side - 10, h: side }, PA: { x: 16, y: 16 + side + 12, w: W - 32, h: H - side - 44 } };
    } else {
      const side = Math.round(Math.min(H - 40, (W - 58) * .56)), rx = 20 + side + 18, rw = W - rx - 20, ha = Math.round((H - 52) * .64);
      G = { phone, A: { x: 20, y: Math.round((H - side) / 2), s: side }, PA: { x: rx, y: 20, w: rw, h: ha }, PB: { x: rx, y: 20 + ha + 12, w: rw, h: H - 52 - ha } };
    }
  }
  cv.onResize(layout); layout();
  const loopPath = new Path2D();                                  // the UGV's loop, in world units
  { const o = { ux: 0, uy: 0 }; for (let k = 0; k <= 180; k++) { sw.path(k / 180 * TAU, o); k ? loopPath.lineTo(o.ux, o.uy) : loopPath.moveTo(o.ux, o.uy); } }

  // ---------------------------------------------------------------- drawing
  function halo(str, X, Y, o) {                                   // text with a soft backing so it reads over the swarm
    ctx.font = `${o.weight || 400} ${o.size || 12}px ${o.font || F.sans}`; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(30,33,64,.9)'; ctx.strokeText(str, X, Y);
    ctx.fillStyle = o.color; ctx.fillText(str, X, Y);
  }
  let alpha = 0;
  const wx = (v) => 50 + 30 * clamp(v, -400, 400);                // observables -> world units
  function drawArena() {
    const { x: X0, y: Y0, s: S } = G.A, k = S / 100, phone = G.phone;
    const loopLabel = phone ? 'UGV loop' : 'the UGV drives this loop';
    ctx.font = `400 ${phone ? 10.5 : 11.5}px ${F.sans}`; const tLoopW = ctx.measureText(loopLabel).width;
    const X = (v) => X0 + v * k, Y = (v) => Y0 + v * k;
    ctx.fillStyle = 'rgba(36,40,77,.55)'; roundRect(ctx, X0, Y0, S, S, 14); ctx.fill();
    ctx.save(); roundRect(ctx, X0, Y0, S, S, 14); ctx.clip();
    ctx.save(); ctx.translate(X0, Y0); ctx.scale(k, k);
    ctx.strokeStyle = 'rgba(143,140,196,.32)'; ctx.lineWidth = 1.2 / k; ctx.setLineDash([4 / k, 5 / k]); ctx.stroke(loopPath); ctx.setLineDash([]);
    ctx.restore();
    // the centre's real path: faint before the forecast, solid since
    const j0 = fc ? Math.max(ns - CAP, fc.t0 - 60) : ns - 1;
    if (fc) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(243,238,242,.22)'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let q = j0; q <= fc.t0; q++) { const o = at(q), px = X(wx(raw[o])), py = Y(wx(raw[o + 1])); q === j0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke();
      // the forecast, dashed, for the next 10 s
      ctx.strokeStyle = C.heat; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath();
      for (let j = 0; j <= HOR; j++) { const px = X(wx(pred[j * NRAW])), py = Y(wx(pred[j * NRAW + 1])); j ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(243,238,242,.85)'; ctx.lineWidth = 2; ctx.beginPath();
      for (let q = fc.t0; q < ns; q++) { const o = at(q), px = X(wx(raw[o])), py = Y(wx(raw[o + 1])); q === fc.t0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke();
    }
    // agents: short heading ticks, one path
    const L = phone ? 4.4 : 6, pA = new Path2D();
    for (let i = 0; i < N; i++) {
      const px = X(ox[i] + (sw.x[i] - ox[i]) * alpha), py = Y(oy[i] + (sw.y[i] - oy[i]) * alpha);
      const vx = sw.vx[i], vy = sw.vy[i], m = Math.sqrt(vx * vx + vy * vy) + 1e-9, hx = vx / m, hy = vy / m;
      pA.moveTo(px - hx * L * .55, py - hy * L * .55); pA.lineTo(px + hx * L * .45, py + hy * L * .45);
    }
    ctx.strokeStyle = C.teal; ctx.lineWidth = phone ? 1.5 : 1.7; ctx.lineCap = 'round'; ctx.stroke(pA);
    // the UGV
    const ux = X(oux + (sw.st.ux - oux) * alpha), uy = Y(ouy + (sw.st.uy - ouy) * alpha);
    drawUgv(ux, uy, Math.atan2(sw.st.uvy, sw.st.uvx), clamp(S * .052, 15, 25));
    // the centre now, and where the forecast says it is now
    let cxN = 0, cyN = 0, pxN = 0, pyN = 0;
    if (fc) {
      const o = at(ns - 1), j = Math.min(HOR, ns - 1 - fc.t0);
      cxN = X(wx(raw[o])); cyN = Y(wx(raw[o + 1])); pxN = X(wx(pred[j * NRAW])); pyN = Y(wx(pred[j * NRAW + 1]));
      if (Math.hypot(pxN - cxN, pyN - cyN) > 5) { ctx.strokeStyle = C.rose; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cxN, cyN); ctx.lineTo(pxN, pyN); ctx.stroke(); }
      ctx.strokeStyle = C.heat; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pxN, pyN, 7, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(243,238,242,.18)'; ctx.beginPath(); ctx.arc(cxN, cyN, 8.5, 0, TAU); ctx.fill();
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(cxN, cyN, 4, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; roundRect(ctx, X0 + .5, Y0 + .5, S - 1, S - 1, 14); ctx.stroke();
    // direct labels: pushed away from the room's middle so they sit outside the loop
    if (fc) {
      const fs = phone ? 10.5 : 12, mx = X(50), my = Y(50);
      const away = (px, py, d) => { const dx = px - mx, dy = py - my, m = Math.hypot(dx, dy) || 1; return [px + dx / m * d, py + dy / m * d]; };
      const jf = Math.min(HOR, fc.j + 30), fx0 = X(wx(pred[jf * NRAW])), fy0 = Y(wx(pred[jf * NRAW + 1]));
      if (fx0 > X0 && fx0 < X0 + S && fy0 > Y0 && fy0 < Y0 + S) {
        const [lx, ly] = away(fx0, fy0, phone ? 14 : 20);
        ctx.font = `500 ${fs}px ${F.sans}`; const tw = ctx.measureText('forecast').width;
        let left = clamp(lx < mx ? lx - tw : lx, X0 + 12, X0 + S - 12 - tw), base = clamp(ly + 4, Y0 + 22, Y0 + S - 30);
        if (left < X0 + 16 + tLoopW + 8 && base < Y0 + 22 + 16) base = Y0 + 22 + 18;     // keep clear of the loop's label
        halo('forecast', left, base, { size: fs, color: C.heat, weight: 500 });
      }
    }
    halo(loopLabel, X0 + 16, Y0 + 22, { size: phone ? 10.5 : 11.5, color: 'rgba(185,182,226,.85)' });
    // legend for the two markers
    const ls = phone ? 10 : 11, ly = Y0 + S - (phone ? 12 : 16), l1 = phone ? 'centre' : 'centre of the swarm', l2 = phone ? 'forecast of it' : 'where the forecast puts it';
    ctx.font = `400 ${ls}px ${F.sans}`; const w1 = ctx.measureText(l1).width;
    let lx0 = X0 + 16;
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(lx0 + 4, ly - 4, 3.6, 0, TAU); ctx.fill();
    halo(l1, lx0 + 13, ly, { size: ls, color: C.muted });
    lx0 += 13 + w1 + (phone ? 12 : 18);
    ctx.strokeStyle = C.heat; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(lx0 + 5, ly - 4, 5, 0, TAU); ctx.stroke();
    halo(l2, lx0 + 15, ly, { size: ls, color: C.muted });
  }
  function drawUgv(X, Y, a, Lb) {
    const Wb = Lb * .64;
    ctx.save(); ctx.translate(X, Y); ctx.rotate(a);
    ctx.fillStyle = 'rgba(27,30,61,.6)'; roundRect(ctx, -Lb / 2 - 3, -Wb / 2 - 5, Lb + 6, Wb + 10, Wb * .42); ctx.fill();
    ctx.fillStyle = C.haze;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { roundRect(ctx, sx * Lb * .29 - Lb * .15, sy * Wb * .5 - Lb * .08, Lb * .3, Lb * .16, Lb * .06); ctx.fill(); }
    ctx.fillStyle = C.apricot; roundRect(ctx, -Lb / 2, -Wb / 2, Lb, Wb, Wb * .3); ctx.fill();
    ctx.fillStyle = C.bg; ctx.beginPath(); ctx.moveTo(Lb / 2 + 1, -Wb * .24); ctx.lineTo(Lb / 2 - Lb * .2, 0); ctx.lineTo(Lb / 2 + 1, Wb * .24); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  const ROWS = [{ i: 0, name: 'centre x', lo: -1.45, hi: 1.45 }, { i: 1, name: 'centre y', lo: -1.45, hi: 1.45 }, { i: 4, name: 'order Φ', lo: -.05, hi: 1.08 }];
  function drawSeries() {
    const R = G.PA, phone = G.phone;
    ctx.fillStyle = C.panel; roundRect(ctx, R.x, R.y, R.w, R.h, 10); ctx.fill();
    if (!fc) return;
    const PAST = phone ? 6 : 8, tL = -PAST, tR = 10.3, padL = phone ? 58 : 66, padR = 12;
    const top = R.y + (phone ? 26 : 32), bot = R.y + R.h - (phone ? 20 : 24), gap = phone ? 6 : 9, rh = (bot - top - gap * 2) / 3;
    const X = (tau) => R.x + padL + (tau + shift - tL) / (tR - tL) * (R.w - padL - padR);
    const xA = R.x + padL, xB = R.x + R.w - padR, jNow = Math.min(HOR, ns - 1 - fc.t0);
    // header: what is drawn
    const fs = phone ? 10.5 : 11.5;
    text(ctx, phone ? 'observables' : 'three of the observables', R.x + 12, R.y + (phone ? 16 : 20), { size: fs, color: C.muted });
    ctx.font = `400 ${fs}px ${F.sans}`; const wF = ctx.measureText('forecast').width, wR = ctx.measureText('real').width;
    const lx2 = R.x + R.w - 12 - wF, lx1 = lx2 - 26 - wR - 22;
    const ly = R.y + (phone ? 12 : 16);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(243,238,242,.85)'; ctx.beginPath(); ctx.moveTo(lx1, ly); ctx.lineTo(lx1 + 16, ly); ctx.stroke();
    text(ctx, 'real', lx1 + 21, ly + 4, { size: fs, color: C.muted });
    ctx.strokeStyle = C.heat; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(lx2 - 22, ly); ctx.lineTo(lx2 - 5, ly); ctx.stroke(); ctx.setLineDash([]);
    text(ctx, 'forecast', lx2, ly + 4, { size: fs, color: C.heat });
    // the learning window (it may run off the left edge)
    ctx.save(); ctx.beginPath(); ctx.rect(xA, top - 6, xB - xA, bot - top + 6); ctx.clip();
    const lb0 = X(-fc.used), lb1 = X(0);
    ctx.fillStyle = 'rgba(143,140,196,.11)'; ctx.fillRect(lb0, top - 6, lb1 - lb0, bot - top + 6);
    ctx.restore();
    // rows
    for (let r = 0; r < 3; r++) {
      const ro = ROWS[r], y0 = top + r * (rh + gap), y1 = y0 + rh, Y = (v) => y1 - (clamp(v, ro.lo - 9, ro.hi + 9) - ro.lo) / (ro.hi - ro.lo) * rh;
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xA, y1 + .5); ctx.lineTo(xB, y1 + .5); ctx.stroke();
      text(ctx, ro.name, R.x + 12, (y0 + y1) / 2 + 4, { size: phone ? 10.5 : 11.5, color: C.muted });
      ctx.save(); ctx.beginPath(); ctx.rect(xA, y0 - 2, xB - xA, rh + 4); ctx.clip();
      // error band between forecast and reality, up to now
      if (jNow > 0) {
        ctx.fillStyle = 'rgba(239,177,180,.26)'; ctx.beginPath();
        for (let j = 0; j <= jNow; j++) { const px = X(j * SNAP), py = Y(raw[at(fc.t0 + j) + ro.i]); j ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        for (let j = jNow; j >= 0; j--) ctx.lineTo(X(j * SNAP), Y(pred[j * NRAW + ro.i]));
        ctx.closePath(); ctx.fill();
      }
      // forecast
      ctx.strokeStyle = C.heat; ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]); ctx.lineJoin = 'round'; ctx.beginPath();
      for (let j = 0; j <= HOR; j++) { const px = X(j * SNAP), py = Y(pred[j * NRAW + ro.i]); j ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke(); ctx.setLineDash([]);
      // reality, past and as it happens
      const q0 = Math.max(ns - CAP + 1, fc.t0 + Math.floor((tL - shift) / SNAP) - 1);
      ctx.strokeStyle = 'rgba(243,238,242,.85)'; ctx.lineWidth = 1.7; ctx.beginPath();
      for (let q = q0; q < ns; q++) { const px = X((q - fc.t0) * SNAP), py = Y(raw[at(q) + ro.i]); q === q0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke();
      ctx.restore();
    }
    // the moment of the forecast, and now
    const x0 = X(0), xn = X(jNow * SNAP);
    ctx.strokeStyle = 'rgba(243,238,242,.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, top - 6); ctx.lineTo(x0, bot); ctx.stroke();
    ctx.strokeStyle = 'rgba(246,210,177,.75)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(xn, top - 6); ctx.lineTo(xn, bot); ctx.stroke(); ctx.setLineDash([]);
    // time axis
    const yb = R.y + R.h - (phone ? 6 : 8), fa = phone ? 10 : 10.5;
    const lw = `learned from ${fc.used % 1 ? fc.used.toFixed(1) : fc.used} s`;
    ctx.font = `400 ${fa}px ${F.sans}`;
    const bandW = lb1 - Math.max(xA, lb0), lwW = ctx.measureText(lw).width;
    if (bandW > lwW + 16) text(ctx, (lb0 < xA ? '← ' : '') + lw, lb1 - 6, yb, { size: fa, color: 'rgba(185,182,226,.9)', align: 'right' });
    else text(ctx, (lb0 < xA ? '← ' : '') + (fc.used % 1 ? fc.used.toFixed(1) : fc.used) + ' s', lb1 - 5, yb, { size: fa, color: 'rgba(185,182,226,.9)', align: 'right' });
    const xNow = clamp(xn, x0 + 12, xB - 12), showNow = xn - x0 > 6;
    if (!showNow || Math.abs(X(5) - xNow) > 30) text(ctx, '+5 s', X(5), yb, { size: fa, color: C.faint, font: F.mono, align: 'center' });
    if (!showNow || X(10) - xNow > 40) text(ctx, '+10 s', X(10) + 4, yb, { size: fa, color: C.faint, font: F.mono, align: 'right' });
    if (showNow) text(ctx, 'now', xNow, yb, { size: fa, color: C.apricot, align: 'center', weight: 500 });
  }

  function drawEig() {
    const R = G.PB, phone = G.phone, d = fc ? fc.d : 0;
    ctx.fillStyle = C.panel; roundRect(ctx, R.x, R.y, R.w, R.h, 10); ctx.fill();
    const fs = phone ? 10.5 : 11.5;
    text(ctx, phone ? 'eigenvalues of K' : 'eigenvalues of K', R.x + 12, R.y + (phone ? 16 : 20), { size: fs, color: C.muted });
    if (!phone) text(ctx, 'one step = 0.5 s', R.x + R.w - 12, R.y + 20, { size: 10.5, color: C.faint, align: 'right' });
    let rad, cx, cy, capX, capY, capW;
    if (phone) { rad = Math.max(20, Math.min((R.w - 30) / 2.3, (R.h - 86) / 2.3)); cx = R.x + R.w / 2; cy = R.y + 24 + rad * 1.15; capX = R.x + 10; capY = cy + rad * 1.15 + 13; capW = R.w - 20; }
    else { rad = Math.max(24, Math.min((R.h - 44) / 2 / 1.15, R.w * .26)); cx = R.x + 18 + rad * 1.18; cy = R.y + 26 + (R.h - 26) / 2; capX = cx + rad * 1.3 + 14; capY = R.y + 44; capW = R.x + R.w - 12 - capX; }
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - rad * 1.18, cy); ctx.lineTo(cx + rad * 1.18, cy); ctx.moveTo(cx, cy - rad * 1.18); ctx.lineTo(cx, cy + rad * 1.18); ctx.stroke();
    ctx.strokeStyle = 'rgba(143,140,196,.75)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, TAU); ctx.stroke();
    text(ctx, '1', cx + rad + 3, cy - 4, { size: 9.5, color: C.faint, font: F.mono });
    if (fc && fc.eig) {
      const pOn = new Path2D(), pIn = new Path2D(), pOut = new Path2D(), r0 = phone ? 2.8 : 3.4;
      for (let i = 0; i < d; i++) {
        let re = ewr[i], im = ewi[i]; const m = Math.hypot(re, im);
        if (m > 1.16) { re *= 1.16 / m; im *= 1.16 / m; }
        const px = cx + re * rad, py = cy - im * rad, p = m > 1.02 ? pOut : m >= .97 ? pOn : pIn;
        p.moveTo(px + r0, py); p.arc(px, py, r0, 0, TAU);
      }
      ctx.fillStyle = 'rgba(220,228,238,.5)'; ctx.fill(pIn);
      ctx.fillStyle = C.teal; ctx.fill(pOn);
      ctx.fillStyle = C.danger; ctx.fill(pOut);
    }
    // caption (exact words), then the counts
    const cap = ['modes on the circle keep going, inside it they fade'];
    const cs = phone ? 10 : 11.5, lh = cs + (phone ? 3 : 5);
    let yy = capY;
    if (!phone) { ctx.font = `400 ${cs}px ${F.sans}`; }
    const lines = [];
    for (const c of cap) { ctx.font = `400 ${cs}px ${F.sans}`; if (ctx.measureText(c).width <= capW) lines.push(c); else { const w = c.split(' '); let cur = ''; for (const t of w) { const nx = cur ? cur + ' ' + t : t; if (ctx.measureText(nx).width > capW && cur) { lines.push(cur); cur = t; } else cur = nx; } if (cur) lines.push(cur); } }
    for (const l of lines) { text(ctx, l, capX, yy, { size: cs, color: C.muted }); yy += lh; }
    if (fc && fc.eig) {
      yy += phone ? 2 : 6;
      text(ctx, `${nOn} on the circle`, capX, yy, { size: cs, color: C.teal, font: F.sans }); yy += lh;
      if (nOut) text(ctx, `${nOut} outside: they grow`, capX, yy, { size: cs, color: C.danger });
      else if (!phone) text(ctx, `${nIn} inside`, capX, yy, { size: cs, color: 'rgba(220,228,238,.6)' });
    }
  }

  function draw() { cv.clear(); drawArena(); drawSeries(); drawEig(); }
  function setReadouts() {
    if (!fc) return;
    const w = fc.worst * 100;
    rErr.set(w < 10 ? w.toFixed(1) + '%' : w < 1000 ? Math.round(w) + '%' : '>999%');
    rAhead.set(fc.ahead >= 0 ? fc.ahead.toFixed(1) + ' s' : fc.done ? '≥ 10 s' : (fc.j * SNAP).toFixed(1) + ' s');
    rSize.set(`${fc.d} × ${fc.d}`);
  }

  // ---------------------------------------------------------------- loop
  let acc = 0;
  const loop = kit.loop((dt) => {
    dt = Math.max(0, Math.min(.05, dt || 0));
    acc += dt / DT; let n = Math.floor(acc); acc -= n; if (n > 4) n = 4;
    for (let k = 0; k < n; k++) physics();
    alpha = clamp(acc, 0, 1);
    if (pending) { pending = false; forecast(); }
    else if (!fc) { waited += dt; if (ns - 1 >= learn * 10 || waited > 5) forecast(); }
    else if (fc.done) { fc.hold += dt; if (fc.hold > 2.5) forecast(); }
    shift *= Math.exp(-dt * 7); if (shift < .005) shift = 0;
    if (loop.running) { draw(); setReadouts(); }
  });
  alpha = 1; draw(); setReadouts();
  return { start() { loop.start(); }, stop() { loop.stop(); }, destroy() { loop.stop(); cv.destroy(); } };
}

// Fields and measurements used by the simulator and by playback. Pure functions on typed arrays; no DOM, no three.
//  - Gray-Scott reaction-diffusion on a coarse grid (the Turing field the ground robots seed)
//  - order parameters (global Vicsek Φ, local alignment)
//  - β0 of the unsearched region (connected components of unknown searchable cells) and sealed β2 voids
//  - dynamic mode decomposition (method of snapshots) for the Koopman forecast

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

// ------------------------------------------------------------------ Gray-Scott (Turing) on a w x h grid
// du/dt = Du ∇²u − u v² + F (1 − u);  dv/dt = Dv ∇²v + u v² − (F + k) v   (Du .16, Dv .08: the team's parameters)
export function grayScott(w, h, { F = .030, k = .062, Du = .16, Dv = .08, seed = 1 } = {}) {
  const n = w * h, U = new Float32Array(n).fill(1), V = new Float32Array(n), U2 = new Float32Array(n), V2 = new Float32Array(n);
  const r = rng(seed);
  const gs = { w, h, U, V, F, k, src: [] };
  // a few seeds so spots exist before the mission starts
  for (let s = 0; s < Math.max(6, (n / 160) | 0); s++) {
    const cx = (r() * w) | 0, cy = (r() * h) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const x = (cx + dx + w) % w, y = (cy + dy + h) % h; U[y * w + x] = .5; V[y * w + x] = .25 + r() * .05; }
  }
  let A = U, B = V, A2 = U2, B2 = V2;
  gs.step = (iters = 1) => {
    const du = Du / 6, dv = Dv / 6, f = gs.F, fk = gs.F + gs.k;
    for (let it = 0; it < iters; it++) {
      for (let y = 0; y < h; y++) {
        const ym = ((y - 1 + h) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w;
        for (let x = 0; x < w; x++) {
          const xm = (x - 1 + w) % w, xp = (x + 1) % w, i = y0 + x;
          const lu = 4 * (A[y0 + xm] + A[y0 + xp] + A[ym + x] + A[yp + x]) + A[ym + xm] + A[ym + xp] + A[yp + xm] + A[yp + xp] - 20 * A[i];
          const lv = 4 * (B[y0 + xm] + B[y0 + xp] + B[ym + x] + B[yp + x]) + B[ym + xm] + B[ym + xp] + B[yp + xm] + B[yp + xp] - 20 * B[i];
          const u = A[i], v = B[i], uvv = u * v * v;
          A2[i] = u + du * lu - uvv + f * (1 - u);
          B2[i] = v + dv * lv + uvv - fk * v;
        }
      }
      // sources: a ground robot or the tethered drone keeps a spot alive where it stands
      for (const s of gs.src) {
        const R = s.r || 2;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue; const x = s.x + dx, y = s.y + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = y * w + x; B2[i] = Math.max(B2[i], .32 * (s.k ?? 1)); A2[i] = Math.min(A2[i], .45);
        }
      }
      let t = A; A = A2; A2 = t; t = B; B = B2; B2 = t;
    }
    gs.U = A; gs.V = B;
  };
  // blurred activator, sampled bilinearly (drones climb its gradient)
  gs.sample = (fx, fy) => {
    const x = clamp(fx, 0, w - 1.001), y = clamp(fy, 0, h - 1.001), x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0, V = gs.V;
    const a = V[y0 * w + x0], b = V[y0 * w + x0 + 1], c = V[(y0 + 1) * w + x0], d = V[(y0 + 1) * w + x0 + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  gs.snapshot = () => { const o = new Uint8Array(n); const V = gs.V; for (let i = 0; i < n; i++) o[i] = Math.min(255, V[i] * 700) | 0; return o; };
  return gs;
}

// ------------------------------------------------------------------ order
// global Vicsek order of a set of headings: |Σ e^{iθ}| / N
export function orderPhi(heads, idx, n) {
  if (n < 2) return 0; let cx = 0, sy = 0;
  for (let k = 0; k < n; k++) { const a = heads[idx[k]]; cx += Math.cos(a); sy += Math.sin(a); }
  return Math.hypot(cx, sy) / n;
}

// ------------------------------------------------------------------ β0 of the unsearched region on one layer
// cells: grid types (0 open, 1 obstacle, 2 outside, 3 water, 4 hazard); want(c) = unknown & searchable & reachable.
// Components smaller than minCells are ignored (persistence filter: a hole that small is sensor noise).
// Writes labels into lab (Int32Array, -1 none) and returns [{ n, cx, cz (cell coords), cells? }]
export function components(nx, nz, want, lab, minCells = 3, keepCells = false) {
  lab.fill(-1);
  const out = []; const q = components._q && components._q.length >= nx * nz ? components._q : (components._q = new Int32Array(nx * nz));
  let id = 0;
  for (let c = 0; c < nx * nz; c++) {
    if (lab[c] !== -1 || !want(c)) continue;
    let qh = 0, qt = 0; q[qt++] = c; lab[c] = id; let sx = 0, sz = 0;
    while (qh < qt) {
      const u = q[qh++], i = u % nx, k = (u / nx) | 0; sx += i; sz += k;
      if (i > 0) { const v = u - 1; if (lab[v] === -1 && want(v)) { lab[v] = id; q[qt++] = v; } }
      if (i < nx - 1) { const v = u + 1; if (lab[v] === -1 && want(v)) { lab[v] = id; q[qt++] = v; } }
      if (k > 0) { const v = u - nx; if (lab[v] === -1 && want(v)) { lab[v] = id; q[qt++] = v; } }
      if (k < nz - 1) { const v = u + nx; if (lab[v] === -1 && want(v)) { lab[v] = id; q[qt++] = v; } }
    }
    if (qt >= minCells) out.push({ id, n: qt, cx: sx / qt, cz: sz / qt, cells: keepCells ? q.slice(0, qt) : null });
    else for (let j = 0; j < qt; j++) lab[q[j]] = -2;
    id++;
  }
  return out;
}

// ------------------------------------------------------------------ DMD (method of snapshots), rank-truncated
// X, Y: arrays of m snapshot vectors (Float64Array length n), Y[j] = state after X[j]. Returns predict(x, steps).
export function dmd(X, Y, rmax = 8, ridge = 1e-6) {
  const m = X.length, n = X[0].length;
  const G = new Float64Array(m * m);
  for (let i = 0; i < m; i++) for (let j = i; j < m; j++) { let s = 0; const a = X[i], b = X[j]; for (let k = 0; k < n; k++) s += a[k] * b[k]; G[i * m + j] = G[j * m + i] = s; }
  const { vals, vecs } = jacobiEig(G, m);
  const order = [...vals.keys()].sort((a, b) => vals[b] - vals[a]);
  const top = vals[order[0]] || 1;
  const r = Math.max(1, Math.min(rmax, order.filter((i) => vals[i] > top * 1e-7).length));
  // U_r = X V Σ^-1 (n x r)
  const U = [];
  for (let q = 0; q < r; q++) {
    const e = order[q], sg = Math.sqrt(Math.max(vals[e], 1e-12)), u = new Float64Array(n);
    for (let j = 0; j < m; j++) { const w = vecs[j * m + e] / sg; if (w === 0) continue; const a = X[j]; for (let k = 0; k < n; k++) u[k] += a[k] * w; }
    U.push({ u, sg, e });
  }
  // Ã = Uᵀ Y V Σ^-1 (r x r)
  const At = new Float64Array(r * r);
  const UY = new Float64Array(r * m);
  for (let p = 0; p < r; p++) for (let j = 0; j < m; j++) { let s = 0; const u = U[p].u, y = Y[j]; for (let k = 0; k < n; k++) s += u[k] * y[k]; UY[p * m + j] = s; }
  for (let p = 0; p < r; p++) for (let q = 0; q < r; q++) { let s = 0; const e = U[q].e, sg = U[q].sg; for (let j = 0; j < m; j++) s += UY[p * m + j] * vecs[j * m + e]; At[p * r + q] = s / (sg + ridge); }
  return {
    r,
    predict(x, steps) {
      let z = new Float64Array(r); for (let p = 0; p < r; p++) { let s = 0; const u = U[p].u; for (let k = 0; k < n; k++) s += u[k] * x[k]; z[p] = s; }
      for (let s = 0; s < steps; s++) { const z2 = new Float64Array(r); for (let p = 0; p < r; p++) { let a = 0; for (let q = 0; q < r; q++) a += At[p * r + q] * z[q]; z2[p] = a; } z = z2; }
      const out = new Float64Array(n); for (let p = 0; p < r; p++) { const u = U[p].u, zp = z[p]; for (let k = 0; k < n; k++) out[k] += u[k] * zp; }
      return out;
    },
  };
}
function jacobiEig(A0, n) {
  const A = Float64Array.from(A0), V = new Float64Array(n * n); for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 40; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i * n + j] * A[i * n + j];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = A[p * n + q]; if (Math.abs(apq) < 1e-14) continue;
      const th = (A[q * n + q] - A[p * n + p]) / (2 * apq), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k * n + p], akq = A[k * n + q]; A[k * n + p] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p * n + k], aqk = A[q * n + k]; A[p * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k * n + p], vkq = V[k * n + q]; V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq; }
    }
  }
  const vals = new Float64Array(n); for (let i = 0; i < n; i++) vals[i] = A[i * n + i];
  return { vals, vecs: V };
}

// marble landscape of the phase change: V(x) = x⁴/4 − x²/2 − h x  (two valleys while |h| < 2/(3√3))
export const HC = 2 / (3 * Math.sqrt(3));
export const landscape = (x, h) => x * x * x * x / 4 - x * x / 2 - h * x;
export const dLandscape = (x, h) => x * x * x - x - h;

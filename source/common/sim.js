// LIMINAL Act 1 — a real (small) exploration run on the actual maquette geometry, computed once at load:
// drones scan with ray casts against the model's BVH, mark cells free / occupied, pick the nearest unclaimed
// frontier (free cell touching unknown), and fly a BFS path to it. Every cell records the step it was first seen,
// so the page can scrub the whole mission backwards and forwards with the scroll bar.
import * as THREE from 'three';

export const GRID = { x0: -6.4, z0: -4.4, cs: 0.2, nx: 64, nz: 44 };
export const FLOORS = [   // top of the walkable surface, scan height
  { top: 0.04, scan: 1.15 }, { top: 3.32, scan: 4.45 }, { top: 6.52, scan: 7.65 }, { top: 9.72, scan: 10.85 }];
const NC = GRID.nx * GRID.nz, NEVER = 65535;
export const cellOf = (x, z) => { const i = Math.floor((x - GRID.x0) / GRID.cs), k = Math.floor((z - GRID.z0) / GRID.cs); return (i < 0 || k < 0 || i >= GRID.nx || k >= GRID.nz) ? -1 : k * GRID.nx + i; };
export const cx = (c) => GRID.x0 + ((c % GRID.nx) + .5) * GRID.cs, cz = (c) => GRID.z0 + (Math.floor(c / GRID.nx) + .5) * GRID.cs;

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ground truth per floor: 0 free, 1 wall, 2 out of bounds (no floor here / outside the footprint)
export function truthGrids(bvh) {
  const p = new THREE.Vector3(), hit = {};
  return FLOORS.map((F, f) => {
    const g = new Uint8Array(NC);
    for (let c = 0; c < NC; c++) {
      const x = cx(c), z = cz(c);
      if (x < -6.05 || x > 6.2 || z < -4.15 || z > 4.15 || (f > 0 && x > 2.0)) { g[c] = 2; continue; }
      let occ = false;
      for (const dy of [-.35, 0, .45]) { p.set(x, F.scan + dy, z); const r = bvh.closestPointToPoint(p, hit, 0, .2); if (r && r.distance < .16) { occ = true; break; } }
      g[c] = occ ? 1 : 0;
    }
    // free space nobody can reach (a sealed stair core) isn't "unexplored", it's inaccessible: flood from the open front
    const seen = new Uint8Array(NC), q = [];
    for (let c = 0; c < NC; c++) if (g[c] === 0 && cz(c) > 3.4) { seen[c] = 1; q.push(c); }
    for (let qi = 0; qi < q.length; qi++) { const u = q[qi], i = u % GRID.nx, k = (u / GRID.nx) | 0;
      for (const [di, dk] of N4) { const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= GRID.nx || kk >= GRID.nz) continue; const v = kk * GRID.nx + ii; if (!seen[v] && g[v] === 0) { seen[v] = 1; q.push(v); } } }
    for (let c = 0; c < NC; c++) if (g[c] === 0 && !seen[c]) g[c] = 2;
    return g;
  });
}

// inflate walls by r cells for path planning
function inflate(occ, r) {
  const o = new Uint8Array(NC);
  for (let c = 0; c < NC; c++) if (occ[c]) {
    const i = c % GRID.nx, k = (c / GRID.nx) | 0;
    for (let dk = -r; dk <= r; dk++) for (let di = -r; di <= r; di++) { const ii = i + di, kk = k + dk; if (ii >= 0 && kk >= 0 && ii < GRID.nx && kk < GRID.nz && di * di + dk * dk <= r * r + 1) o[kk * GRID.nx + ii] = 1; }
  }
  return o;
}

/**
 * Run a mission. drones: [{floor, x, z}] start poses. Returns per-floor firstFree/firstOcc (Uint16, step index),
 * per-drone tracks, sampled LiDAR hits {pos Float32Array, step Uint16Array}, beta0 per step, and detections.
 */
export function runMission(bvh, truth, drones, { steps = 320, rays = 72, range = 6.5, speed = 0.16, seed = 3, survivor = null, shared = true } = {}) {
  const R = rng(seed);
  const mk = () => ({ free: new Uint16Array(NC).fill(NEVER), occ: new Uint16Array(NC).fill(NEVER), known: new Int8Array(NC).fill(-1) });
  const maps = FLOORS.map(mk);
  const own = shared ? null : drones.map(mk);                 // not sharing: one private map per drone
  const effort = new Float32Array(steps);                       // sum over drones of newly mapped cells (counts repeats)
  const ray = new THREE.Ray(), o = new THREE.Vector3(), d = new THREE.Vector3();
  const hitsPos = [], hitsStep = [], hitsFloor = [];
  const D = drones.map((s, i) => ({ id: i, f: s.floor, x: s.x, z: s.z, path: [], goal: -1, track: new Float32Array(steps * 3), hdg: 0, seen: [] }));
  const plan = FLOORS.map((_, f) => inflate(truth[f].map(v => v === 1 ? 1 : 0), 1));
  const claims = new Map();
  const beta0 = new Uint8Array(steps), unknownArea = new Float32Array(steps);
  const detect = { step: -1, by: -1 };
  for (let s = 0; s < steps; s++) {
    for (const dr of D) {
      const M = shared ? maps[dr.f] : own[dr.id], G = maps[dr.f], T = truth[dr.f], F = FLOORS[dr.f];
      // --- scan
      o.set(dr.x, F.scan, dr.z);
      const rot = R() * Math.PI * 2 / rays;
      for (let r = 0; r < rays; r++) {
        const a = rot + r * Math.PI * 2 / rays; d.set(Math.cos(a), 0, Math.sin(a)); ray.set(o, d);
        const h = bvh.raycastFirst(ray, THREE.DoubleSide);
        const dist = h && h.distance < range ? h.distance : range;
        const n = Math.ceil(dist / (GRID.cs * .5));
        for (let k = 0; k < n; k++) {
          const t = k * GRID.cs * .5; const c = cellOf(o.x + d.x * t, o.z + d.z * t); if (c < 0) break;
          if (T[c] === 2 || T[c] === 1) break;
          if (M.known[c] === -1) { M.known[c] = 0; M.free[c] = s; effort[s]++; if (!shared && G.known[c] === -1) { G.known[c] = 0; G.free[c] = s; } }
        }
        if (h && h.distance < range) {
          const c = cellOf(h.point.x, h.point.z);
          if (c >= 0 && T[c] !== 2 && M.known[c] !== 1) { if (M.known[c] === -1 || T[c] === 1) { if (M.known[c] === -1) effort[s]++; M.known[c] = 1; M.occ[c] = s; if (!shared && G.known[c] !== 1) { G.known[c] = 1; G.occ[c] = Math.min(G.occ[c], s); } } }
          if ((s + r) % 2 === 0) { hitsPos.push(h.point.x, h.point.y, h.point.z); hitsStep.push(s); hitsFloor.push(dr.f); }
        }
      }
      if (survivor && detect.step < 0 && dr.f === 0) {
        const dx = survivor.x - dr.x, dz = survivor.z - dr.z, L = Math.hypot(dx, dz);
        if (L < 2.4) { ray.set(new THREE.Vector3(dr.x, .7, dr.z), new THREE.Vector3(dx / L, (survivor.y - .7) / L, dz / L).normalize()); const h = bvh.raycastFirst(ray, THREE.DoubleSide); if (!h || h.distance > L - .35) { detect.step = s; detect.by = dr.id; } }
      }
      // --- plan: nearest unclaimed frontier by BFS through known-free, non-inflated cells
      if (!dr.path.length) {
        if (dr.goal >= 0) claims.delete(dr.f * NC + dr.goal);
        const start = cellOf(dr.x, dr.z); const prev = new Int32Array(NC).fill(-2); const q = [start]; prev[start] = -1; let goal = -1;
        for (let qi = 0; qi < q.length && goal < 0; qi++) {
          const c = q[qi], i = c % GRID.nx, k = (c / GRID.nx) | 0;
          // frontier test
          if (M.known[c] === 0 && qi > 2) {
            let fr = false; for (const [di, dk] of N4) { const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= GRID.nx || kk >= GRID.nz) continue; const nc = kk * GRID.nx + ii; if (M.known[nc] === -1 && T[nc] !== 2) { fr = true; break; } }
            if (fr && !(shared && claims.has(dr.f * NC + c))) { goal = c; break; }
          }
          for (const [di, dk] of N8) {
            const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= GRID.nx || kk >= GRID.nz) continue; const nc = kk * GRID.nx + ii;
            if (prev[nc] !== -2 || M.known[nc] !== 0 || plan[dr.f][nc]) continue; prev[nc] = c; q.push(nc);
          }
        }
        if (goal >= 0) {
          const path = []; for (let c = goal; c !== -1 && c !== start; c = prev[c]) path.push(c); path.reverse();
          dr.path = path; dr.goal = goal;
          // claim the frontier and its neighbourhood so the next drone picks elsewhere
          if (shared) for (let dk = -6; dk <= 6; dk++) for (let di = -6; di <= 6; di++) { const c = goal + dk * GRID.nx + di; if (c >= 0 && c < NC) claims.set(dr.f * NC + c, dr.id); }
        }
      }
      // --- move
      let budget = speed;
      while (budget > 0 && dr.path.length) {
        const c = dr.path[0], tx = cx(c), tz = cz(c), dx = tx - dr.x, dz = tz - dr.z, L = Math.hypot(dx, dz);
        if (M.known[c] === 1) { dr.path = []; break; }
        if (L <= budget) { dr.x = tx; dr.z = tz; budget -= L; dr.path.shift(); }
        else { dr.x += dx / L * budget; dr.z += dz / L * budget; budget = 0; }
        if (L > 1e-4) dr.hdg = Math.atan2(dz, dx);
      }
      dr.track[s * 3] = dr.x; dr.track[s * 3 + 1] = dr.z; dr.track[s * 3 + 2] = dr.hdg;
    }
    if (shared) {   // merge maps between drones on the same floor is implicit (one map per floor): that's the CRDT union
    }
    // topology of what's left: connected components of unknown, reachable-from-free cells (β₀ of the unexplored set)
    let comps = 0, area = 0;
    for (let f = 0; f < FLOORS.length; f++) {
      const M = maps[f], T = truth[f], seenC = new Uint8Array(NC);
      for (let c = 0; c < NC; c++) {
        if (seenC[c] || M.known[c] !== -1 || T[c] !== 0) continue;
        const q = [c]; seenC[c] = 1; let n = 0;
        for (let qi = 0; qi < q.length; qi++) { const u = q[qi], i = u % GRID.nx, k = (u / GRID.nx) | 0; n++;
          for (const [di, dk] of N4) { const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= GRID.nx || kk >= GRID.nz) continue; const v = kk * GRID.nx + ii; if (!seenC[v] && M.known[v] === -1 && T[v] === 0) { seenC[v] = 1; q.push(v); } } }
        if (n >= 6) comps++; area += n;
      }
    }
    beta0[s] = comps; unknownArea[s] = area * GRID.cs * GRID.cs;
  }
  return { maps, effort, drones: D.map(d => ({ f: d.f, track: d.track })), hits: { pos: new Float32Array(hitsPos), step: new Float32Array(hitsStep), floor: new Float32Array(hitsFloor) }, beta0, unknownArea, detect, steps };
}

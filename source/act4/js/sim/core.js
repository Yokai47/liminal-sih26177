// The shared deterministic swarm simulator. One generic engine, configured per mission; it records a tape.
// simulate(world, cfg) is a generator: it yields { p, label } every ~sliceMs of work so the page stays responsive,
// and returns the tape when the mission is over (β0 of the unsearched region = 0, everyone home).
//
// What each drone does (all local; the mesh carries measurement, never command):
//  - keeps its OWN copy of the searched set (a grow-only set, CRDT); neighbours in radio range exchange deltas each tick
//    with packet loss, the merge is a union, so the maps agree in any order once the radio has caught up;
//  - senses: thermal disc from altitude outdoors, LiDAR rays with occlusion indoors; marks cells in its own set;
//  - explores: frontier-based target choice on its own merged map, penalising targets that neighbours have claimed
//    (claims travel over the mesh), weighted by path cost (BFS over the layer graph, doorways/windows as portals);
//  - physics hooks: Vicsek alignment in transit and on a front (noise held near the threshold), Gray-Scott field
//    climbing (Turing spacing), ground robots biasing choices (symmetry breaking), the marble landscape for a find
//    (phase change with hysteresis), marks on the world (stigmergy), relay beacons, battery, scripted disturbances.
import { rng, clamp, angDiff, grayScott, components, dmd, HC, dLandscape } from './fields.js';
import { ST, FLAG, NEVER } from './tape.js';

const TAU = Math.PI * 2;
const ORD = ['ground', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
const layerName = (L) => (L.kind === 'void' ? `Building ${L.building ?? ''}, crawl space` : L.kind === 'floor' ? `Building ${L.building ?? ''}, ${ORD[L.floor] ?? L.floor} floor` : L.id === 'ground' ? 'Streets and yards' : L.id).replace(/\s+/g, ' ').trim();

export function* simulate(world, cfg) {
  const R = rng(cfg.seed || 1);
  const dt = cfg.dt || .5;
  const N = cfg.drones || 16;
  const sliceMs = cfg.sliceMs || 9, sliceOf = typeof cfg.slice === 'function' ? cfg.slice : () => sliceMs; // (the slice may change while it runs)
  const MAXT = cfg.maxTicks || 4000;
  const A = world.anchors || {};
  const v3 = (p) => (p ? (p.isVector3 ? { x: p.x, y: p.y, z: p.z } : Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : { x: p.x || 0, y: p.y || 0, z: p.z || 0 }) : null);

  // ------------------------------------------------------------------ layers and the global cell index
  const LAY = [];
  let total = 0;
  for (const L0 of world.layers || []) {
    const isOut = L0.outdoor != null ? !!L0.outdoor : L0.kind ? L0.kind === 'outdoor' : /ground|outdoor|air|canopy|water|surface|above/i.test(L0.id);
    let b0 = L0.y, b1 = L0.y + 2.6;
    if (L0.band) { const absolute = L0.band[0] >= L0.y - 1.5; b0 = absolute ? L0.band[0] : L0.y + L0.band[0]; b1 = absolute ? L0.band[1] : L0.y + L0.band[1]; }
    const fly = L0.fly != null ? L0.fly : isOut ? L0.y + (cfg.alt?.outdoor ?? 10) : Math.max(L0.y + .8, b0 + (b1 - b0) * .5);
    const clear = isOut ? (cfg.alt?.outdoor ?? 10) : Math.max(.3, Math.min(1.35, (L0.ceiling ?? (b1 - b0)) * .5));
    LAY.push({ id: L0.id, src: L0, nx: L0.nx, nz: L0.nz, x0: L0.x0, z0: L0.z0, cell: L0.cell, y: L0.y, b0, b1, fly, outdoor: isOut, grid: L0.grid, off: total, name: L0.name || layerName(L0), clear, yAt: typeof L0.yAt === 'function' ? L0.yAt : null, flyY: L0.flyY && L0.flyY.length === L0.nx * L0.nz ? L0.flyY : null,
      topY: L0.top && L0.top.length === L0.nx * L0.nz ? L0.top : null, groundY: L0.ground && L0.ground.length === L0.nx * L0.nz ? L0.ground : null, density: L0.density && L0.density.length === L0.nx * L0.nz ? L0.density : null,
      relClear: L0.band ? (L0.band[0] + L0.band[1]) / 2 : 2, kind: L0.kind || (isOut ? 'outdoor' : 'floor'), building: L0.building ?? null });
    total += L0.nx * L0.nz;
  }
  const NL = LAY.length;
  // flight height on a layer at (x, z): follows the floor (tilted, crushed) or the ground (rubble mounds) when the world says how
  const flyAt = (L, x, z) => {
    if (L.topY || L.groundY) { const i = Math.floor((x - L.x0) / L.cell), k = Math.floor((z - L.z0) / L.cell); if (i >= 0 && k >= 0 && i < L.nx && k < L.nz) { const c = k * L.nx + i, v = L.topY ? L.topY[c] : L.groundY[c]; if (Number.isFinite(v)) return v + L.relClear; } return L.fly; }
    if (L.flyY) { const i = Math.floor((x - L.x0) / L.cell), k = Math.floor((z - L.z0) / L.cell); if (i >= 0 && k >= 0 && i < L.nx && k < L.nz) { const v = L.flyY[k * L.nx + i]; if (Number.isFinite(v)) return v; } return L.fly; }
    if (!L.yAt) return L.fly; let y; try { y = L.yAt(x, z); } catch (e) { y = NaN; } return Number.isFinite(y) ? y + L.clear : L.fly; };
  const layerOf = new Uint8Array(total);
  for (let l = 0; l < NL; l++) layerOf.fill(l, LAY[l].off, LAY[l].off + LAY[l].nx * LAY[l].nz);
  const typ = new Uint8Array(total);
  for (const L of LAY) typ.set(L.grid, L.off);
  const changes = [];                                                           // grid edits during the mission (water rise...)
  const trav = new Uint8Array(total);
  const travOf = (gid) => { const t = typ[gid]; return t === 0 || t === 3 || t === 4 || (t === 2 && LAY[layerOf[gid]].outdoor); };
  for (let g = 0; g < total; g++) trav[g] = travOf(g) ? 1 : 0;
  const cellAt = (L, x, z) => { const i = Math.floor((x - L.x0) / L.cell), k = Math.floor((z - L.z0) / L.cell); return i < 0 || k < 0 || i >= L.nx || k >= L.nz ? -1 : k * L.nx + i; };
  const cx = (gid) => { const L = LAY[layerOf[gid]], c = gid - L.off; return L.x0 + ((c % L.nx) + .5) * L.cell; };
  const cz = (gid) => { const L = LAY[layerOf[gid]], c = gid - L.off; return L.z0 + (((c / L.nx) | 0) + .5) * L.cell; };
  const layerById = (id) => { const i = LAY.findIndex((L) => L.id === id); return i < 0 ? -1 : i; };

  // ------------------------------------------------------------------ portals between layers
  const portal = new Map();
  const addPortal = (a, b) => { if (a < 0 || b < 0 || a === b || !trav[a] || !trav[b]) return; (portal.get(a) || portal.set(a, []).get(a)).push(b); (portal.get(b) || portal.set(b, []).get(b)).push(a); };
  const hasEntries = (world.layers || []).some((L) => Array.isArray(L.entries) && L.entries.length);
  if (hasEntries) {
    const outL = LAY.map((L, i) => i).filter((i) => LAY[i].outdoor);
    (world.layers || []).forEach((L0, lb) => {
      if (!Array.isArray(L0.entries) || LAY[lb].outdoor) return; const B = LAY[lb];
      for (const e of L0.entries) {
        const ci = (e.i != null && e.k != null) ? e.k * B.nx + e.i : cellAt(B, (e.in || e.pos).x, (e.in || e.pos).z); if (ci < 0) continue;
        const po = v3(e.pos); let best = -1, bd = 1e9;
        for (const la of outL) { const O = LAY[la]; const i0 = Math.floor((po.x - O.x0) / O.cell), k0 = Math.floor((po.z - O.z0) / O.cell);
          for (let k = k0 - 2; k <= k0 + 2; k++) for (let i = i0 - 2; i <= i0 + 2; i++) { if (i < 0 || k < 0 || i >= O.nx || k >= O.nz) continue; const g = O.off + k * O.nx + i; if (!trav[g] || O.grid[k * O.nx + i] === 1) continue; const d = (i - i0) ** 2 + (k - k0) ** 2; if (d < bd) { bd = d; best = g; } } }
        if (best >= 0) addPortal(best, B.off + ci);
      }
    });
  }
  if (Array.isArray(A.portals) && A.portals.length) {
    // stairs between floors: the nearest traversable cell on each side (posB is the upper landing when given)
    const near = (l, pos) => { const L = LAY[l]; const c = cellAt(L, pos.x, pos.z); if (c >= 0 && trav[L.off + c]) return L.off + c; let best = -1, bd = 1e9; const r = 4;
      const i0 = Math.floor((pos.x - L.x0) / L.cell), k0 = Math.floor((pos.z - L.z0) / L.cell);
      for (let k = k0 - r; k <= k0 + r; k++) for (let i = i0 - r; i <= i0 + r; i++) { if (i < 0 || k < 0 || i >= L.nx || k >= L.nz) continue; const g = L.off + k * L.nx + i; if (!trav[g]) continue; const d = (i - i0) ** 2 + (k - k0) ** 2; if (d < bd) { bd = d; best = g; } } return best; };
    for (const p of A.portals) {
      const la = layerById(p.a ?? p.from), lb = layerById(p.b ?? p.to), pa = v3(p.pos || p.at); if (la < 0 || lb < 0 || !pa) continue;
      const pb = v3(p.posB || p.pos || p.at);
      addPortal(near(la, pa), near(lb, pb));
    }
  }
  if (!hasEntries && !(Array.isArray(A.portals) && A.portals.length)) {
    // automatic: (1) openings in an indoor layer's perimeter that face open outdoor space; (2) stairwells between
    // overlapping indoor layers (a few cells open on both)
    for (let lb = 0; lb < NL; lb++) {
      const B = LAY[lb]; if (B.outdoor) continue;
      for (let la = 0; la < NL; la++) {
        const Aa = LAY[la]; if (la === lb) continue;
        if (Aa.outdoor) {
          const picks = [];
          for (let k = 0; k < B.nz; k++) for (let i = 0; i < B.nx; i++) {
            const c = k * B.nx + i; if (!trav[B.off + c] || B.grid[c] === 2) continue;
            for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const ii = i + di, kk = k + dk, out = ii < 0 || kk < 0 || ii >= B.nx || kk >= B.nz || B.grid[kk * B.nx + ii] === 2;
              if (!out) continue;
              let hit = false;
              for (const st of [1, 2.2, 3.4]) {
                const wx = B.x0 + (i + .5 + di * st) * B.cell, wz = B.z0 + (k + .5 + dk * st) * B.cell, ca = cellAt(Aa, wx, wz);
                if (ca >= 0 && trav[Aa.off + ca] && Aa.grid[ca] !== 1) { picks.push([Aa.off + ca, B.off + c, wx, wz]); hit = true; break; }
              }
              if (hit) break;
            }
          }
          // thin them: one portal per ~3 m of opening
          const kept = [];
          for (const p of picks) if (kept.every((q) => (q[2] - p[2]) ** 2 + (q[3] - p[3]) ** 2 > 9)) kept.push(p);
          for (const p of kept.slice(0, 60)) addPortal(p[0], p[1]);
        } else if (la < lb) {
          const both = [];
          for (let k = 0; k < B.nz; k += 1) for (let i = 0; i < B.nx; i += 1) {
            const c = k * B.nx + i; if (!trav[B.off + c] || B.grid[c] !== 0) continue;
            const wx = B.x0 + (i + .5) * B.cell, wz = B.z0 + (k + .5) * B.cell, ca = cellAt(Aa, wx, wz);
            if (ca >= 0 && trav[Aa.off + ca] && Aa.grid[ca] === 0) both.push([Aa.off + ca, B.off + c, wx, wz]);
          }
          if (both.length) {
            const rr = rng(lb * 31 + la * 7 + 3), kept = [];
            for (let t = 0; t < 40 && kept.length < 3; t++) { const p = both[(rr() * both.length) | 0]; if (kept.every((q) => (q[2] - p[2]) ** 2 + (q[3] - p[3]) ** 2 > 64)) kept.push(p); }
            for (const p of kept) addPortal(p[0], p[1]);
          }
        }
      }
    }
  }
  for (let la = 0; la < NL; la++) {
    const Aa = LAY[la]; if (!Aa.density) continue;
    for (let lb = 0; lb < NL; lb++) {
      const B = LAY[lb]; if (lb === la || B.outdoor) continue; const kept = [];
      for (let c = 0; c < Aa.nx * Aa.nz; c++) {
        if (!trav[Aa.off + c] || Aa.density[c] > (cfg.gapDensity ?? 70)) continue;
        const x = Aa.x0 + ((c % Aa.nx) + .5) * Aa.cell, z = Aa.z0 + (((c / Aa.nx) | 0) + .5) * Aa.cell, cb = cellAt(B, x, z);
        if (cb < 0 || !trav[B.off + cb] || B.grid[cb] !== 0) continue;
        if (kept.some((q) => (q[0] - x) ** 2 + (q[1] - z) ** 2 < (cfg.gapSpacing ?? 22) ** 2)) continue;
        kept.push([x, z]); addPortal(Aa.off + c, B.off + cb);
      }
    }
  }
  const portalList = []; for (const [a, bs] of portal) for (const b of bs) if (a < b) portalList.push([a, b]);

  // ------------------------------------------------------------------ BFS over the layer graph
  const bDist = new Int32Array(total), bPar = new Int32Array(total), bStamp = new Int32Array(total), Q = new Int32Array(total);
  let stampId = 0;
  const NB8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.41], [1, -1, 1.41], [-1, 1, 1.41], [-1, -1, 1.41]];
  // visit(g, d) returns true to stop. Plain BFS (8-neighbour, no corner cutting) from src.
  function bfs(src, visit, maxPop = total, passable = trav) {
    stampId++; let qh = 0, qt = 0; Q[qt++] = src; bStamp[src] = stampId; bDist[src] = 0; bPar[src] = -1;
    while (qh < qt && qh < maxPop) {
      const g = Q[qh++]; if (visit && visit(g, bDist[g])) return g;
      const L = LAY[layerOf[g]], c = g - L.off, i = c % L.nx, k = (c / L.nx) | 0, d1 = bDist[g] + 1;
      for (let n = 0; n < 8; n++) {
        const ii = i + NB8[n][0], kk = k + NB8[n][1]; if (ii < 0 || kk < 0 || ii >= L.nx || kk >= L.nz) continue;
        const h = L.off + kk * L.nx + ii; if (bStamp[h] === stampId || !passable[h]) continue;
        if (n >= 4 && (!passable[L.off + k * L.nx + ii] || !passable[L.off + kk * L.nx + i])) continue;
        bStamp[h] = stampId; bDist[h] = d1; bPar[h] = g; Q[qt++] = h;
      }
      const ps = portal.get(g);
      if (ps) for (const h of ps) { if (bStamp[h] === stampId || !passable[h]) continue; bStamp[h] = stampId; bDist[h] = d1 + 2; bPar[h] = g; Q[qt++] = h; }
    }
    return -1;
  }
  const pathTo = (g) => { const p = []; while (g >= 0) { p.push(g); g = bPar[g]; } return p.reverse(); };
  // line of sight on one layer's grid (cells of type 1 block)
  function los(L, i0, k0, i1, k1) {
    let dx = Math.abs(i1 - i0), dz = Math.abs(k1 - k0), sx = i0 < i1 ? 1 : -1, sz = k0 < k1 ? 1 : -1, err = dx - dz, i = i0, k = k0;
    for (let s = 0; s < 400; s++) {
      if (i === i1 && k === k0 + 0 && k === k1) return true;
      if (i === i1 && k === k1) return true;
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; i += sx; } if (e2 < dx) { err += dx; k += sz; }
      if (i < 0 || k < 0 || i >= L.nx || k >= L.nz) return true;
      const t = L.grid[k * L.nx + i]; if (t === 1 || typ[L.off + k * L.nx + i] === 1) return i === i1 && k === k1 ? true : false;
    }
    return true;
  }
  function losTrav(L, i0, k0, i1, k1) {          // for path shortcutting: every cell on the line must be traversable
    let dx = Math.abs(i1 - i0), dz = Math.abs(k1 - k0), sx = i0 < i1 ? 1 : -1, sz = k0 < k1 ? 1 : -1, err = dx - dz, i = i0, k = k0;
    for (let s = 0; s < 400; s++) {
      if (!trav[L.off + k * L.nx + i]) return false;
      if (i === i1 && k === k1) return true;
      const e2 = 2 * err;
      if (e2 > -dz && e2 < dx) { if (!trav[L.off + k * L.nx + i + sx] || !trav[L.off + (k + sz) * L.nx + i]) return false; }
      if (e2 > -dz) { err -= dz; i += sx; } if (e2 < dx) { err += dx; k += sz; }
    }
    return true;
  }
  // a gid path -> waypoints (string-pulled inside each layer; portal hops kept)
  function waypoints(p) {
    const out = []; let s = 0;
    while (s < p.length - 1) {
      const ls = layerOf[p[s]]; const L = LAY[ls]; let best = s + 1;
      for (let j = s + 1; j < p.length && j - s <= 18; j++) {
        if (layerOf[p[j]] !== ls) break;
        const a = p[s] - L.off, b = p[j] - L.off;
        if (losTrav(L, a % L.nx, (a / L.nx) | 0, b % L.nx, (b / L.nx) | 0)) best = j;
      }
      if (layerOf[p[best]] !== ls) best = s + 1;
      out.push(p[best]); s = best;
    }
    return out;
  }

  // ------------------------------------------------------------------ anchors: base, tether, reachable, searchable
  const findCell = (pos, preferOutdoor = true, need = trav) => {
    let best = -1, bd = 1e18;
    for (let l = 0; l < NL; l++) {
      const L = LAY[l]; if (preferOutdoor && !L.outdoor && LAY.some((q) => q.outdoor)) continue;
      const i0 = Math.floor((pos.x - L.x0) / L.cell), k0 = Math.floor((pos.z - L.z0) / L.cell);
      for (let r = 0; r < 60; r++) {
        let found = false;
        for (let k = k0 - r; k <= k0 + r; k++) for (let i = i0 - r; i <= i0 + r; i++) {
          if (Math.max(Math.abs(i - i0), Math.abs(k - k0)) !== r || i < 0 || k < 0 || i >= L.nx || k >= L.nz) continue;
          const g = L.off + k * L.nx + i; if (!need[g]) continue;
          const d = (cx(g) - pos.x) ** 2 + (cz(g) - pos.z) ** 2 + (L.y - pos.y) ** 2 * .2; if (d < bd) { bd = d; best = g; } found = true;
        }
        if (found) break;
      }
    }
    return best;
  };
  const basePos = v3(A.base) || { x: LAY[0].x0 + 4, y: 0, z: LAY[0].z0 + 4 };
  const baseG = findCell(basePos);
  const reach = new Uint8Array(total);
  bfs(baseG, (g) => { reach[g] = 1; return false; });
  const srch = new Uint8Array(total);
  let nSearch = 0;
  const nSearchL = new Int32Array(NL);
  for (let g = 0; g < total; g++) { const t = typ[g]; if ((t === 0 || t === 3 || t === 4) && reach[g]) { srch[g] = 1; nSearch++; nSearchL[layerOf[g]]++; } }
  const tetherA = A.tether || {};
  const tStation = v3(tetherA.station) || { x: basePos.x, y: basePos.y + 2.5, z: basePos.z };
  const tHover = v3(tetherA.hover) || { x: tStation.x, y: tStation.y + 30, z: tStation.z };
  const tCable = tetherA.cable || Math.hypot(tHover.x - tStation.x, tHover.y - tStation.y, tHover.z - tStation.z) * 1.15;

  // sealed voids (β2): open cells that cannot be reached, fully enclosed by obstacle on their layer
  const pockets = [];
  {
    const seenP = new Uint8Array(total);
    for (let l = 0; l < NL; l++) {
      const L = LAY[l]; if (L.outdoor) continue;
      for (let c = 0; c < L.nx * L.nz; c++) {
        const g = L.off + c; if (seenP[g] || reach[g] || !(typ[g] === 0 || typ[g] === 3)) continue;
        const q = [g]; seenP[g] = 1; let open = false;
        for (let qi = 0; qi < q.length; qi++) {
          const u = q[qi] - L.off, i = u % L.nx, k = (u / L.nx) | 0;
          for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= L.nx || kk >= L.nz) { open = true; continue; }
            const h = L.off + kk * L.nx + ii, t = typ[h]; if (t === 2) open = true;
            if (!seenP[h] && (t === 0 || t === 3) && !reach[h]) { seenP[h] = 1; q.push(h); }
          }
        }
        if (!open && q.length >= 2 && q.length <= 400) {
          let sx = 0, sz = 0; for (const h of q) { sx += cx(h); sz += cz(h); }
          const ring = new Set(); for (const h of q) { const u = h - L.off, i = u % L.nx, k = (u / L.nx) | 0;
            for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) { const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= L.nx || kk >= L.nz) continue; const hh = L.off + kk * L.nx + ii; if (typ[hh] === 1) ring.add(hh); } }
          pockets.push({ layer: l, cells: q, ring: [...ring], pos: { x: sx / q.length, y: L.y + (L.b1 - L.b0) * .3, z: sz / q.length }, volume: q.length * L.cell * L.cell * Math.max(.4, Math.min(1.2, (L.b1 - L.b0) * .35)), t: -1 });
        }
      }
    }
    pockets.sort((a, b) => b.cells.length - a.cells.length);
    pockets.splice(4);
    // the world may say exactly where its sealed void is: then that one is the β2 beat
    const given = [A.pocket, ...(Array.isArray(A.pockets) ? A.pockets : [])].filter((p) => p && (layerById(p.layer) >= 0 || NL === 1)).map((p) => {
      if (Array.isArray(p.cells) && p.cells.length) return p;
      const l = layerById(p.layer) >= 0 ? layerById(p.layer) : 0, L = LAY[l], b = p.box; if (!b) return null; const cells = [];
      for (let c = 0; c < L.nx * L.nz; c++) { const x = L.x0 + ((c % L.nx) + .5) * L.cell, z = L.z0 + (((c / L.nx) | 0) + .5) * L.cell; if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && (typ[L.off + c] === 0 || typ[L.off + c] === 3)) cells.push(c); }
      return cells.length ? { ...p, layer: L.id, cells, pos: p.pos || p.center } : null; }).filter(Boolean);
    if (given.length) {
      pockets.length = 0;
      for (const p of given) { const l = layerById(p.layer), L = LAY[l]; const pos = v3(p.pos) || { x: cx(L.off + p.cells[0]), y: L.y, z: cz(L.off + p.cells[0]) };
        pockets.push({ layer: l, cells: p.cells.map((c) => L.off + c), ring: [], pos, volume: p.volume ?? p.cells.length * L.cell * L.cell * .6, t: -1, given: true, name: p.name || '' }); }
    }
  }

  // ------------------------------------------------------------------ mesh nodes and their replicas
  const MAXB = cfg.relay?.maxBeacons ?? 24;
  const TETHER = N, BASE = N + 1, B0 = N + 2, NM = N + 2 + MAXB;
  const known = [], logA = [], logN = new Int32Array(NM);
  for (let n = 0; n < N + 2; n++) { known.push(new Uint8Array(total)); logA.push(new Int32Array(total)); }
  const cur = new Int32Array(NM * NM);
  const ownCount = new Int32Array(NM);
  const firstSeen = new Uint16Array(total).fill(NEVER);
  const knownAt = cfg.recordKnownAt === false ? null : Array.from({ length: N }, () => new Uint16Array(total).fill(NEVER));
  let covered = 0, lastCov = -1, lastCovT = 0, unreached = 0;
  const topoDirty = new Uint8Array(LAY.length).fill(1);   // layers with newly searched cells since β0 was last counted
  const unkMask = new Uint8Array(total); for (let g = 0; g < total; g++) unkMask[g] = srch[g];   // searchable and not yet searched
  const ccStamp = new Int32Array(total); let ccId = 0; const ccQ = new Int32Array(Math.max(...LAY.map((L) => L.nx * L.nz)));
  // β0 of one layer's unsearched cells (4-connected; components under minCells are ignored as noise)
  function beta0Of(L, minCells) {
    ccId++; const off = L.off, nx = L.nx, n = nx * L.nz; let count = 0;
    for (let c = 0; c < n; c++) {
      const g0 = off + c; if (!unkMask[g0] || ccStamp[g0] === ccId) continue;
      let qh = 0, qt = 0; ccQ[qt++] = c; ccStamp[g0] = ccId;
      while (qh < qt) {
        const u = ccQ[qh++], i = u % nx;
        if (i > 0) { const g = off + u - 1; if (unkMask[g] && ccStamp[g] !== ccId) { ccStamp[g] = ccId; ccQ[qt++] = u - 1; } }
        if (i < nx - 1) { const g = off + u + 1; if (unkMask[g] && ccStamp[g] !== ccId) { ccStamp[g] = ccId; ccQ[qt++] = u + 1; } }
        if (u >= nx) { const g = off + u - nx; if (unkMask[g] && ccStamp[g] !== ccId) { ccStamp[g] = ccId; ccQ[qt++] = u - nx; } }
        if (u + nx < n) { const g = off + u + nx; if (unkMask[g] && ccStamp[g] !== ccId) { ccStamp[g] = ccId; ccQ[qt++] = u + nx; } }
      }
      if (qt >= minCells) count++;
    }
    return count;
  }
  const coveredL = new Int32Array(NL);
  let tick = 0;
  const learn = (n, g) => {
    const K = known[n]; if (K[g]) return false; K[g] = 1; logA[n][logN[n]++] = g; if (srch[g]) ownCount[n]++;
    if (n < N && knownAt) knownAt[n][g] = tick;
    if (firstSeen[g] === NEVER) { firstSeen[g] = tick; unkMask[g] = 0; if (srch[g]) { covered++; coveredL[layerOf[g]]++; topoDirty[layerOf[g]] = 1; } }
    return true;
  };
  const addBeaconNode = (k) => { while (known.length <= B0 + k) { known.push(new Uint8Array(total)); logA.push(new Int32Array(total)); } };

  // ------------------------------------------------------------------ agents
  const spd = { outdoor: 3.2, indoor: .9, transit: 7, climb: 2.2, ...(cfg.speed || {}) };
  const sens = { outdoor: 9, indoor: 6, camera: 5, ...(cfg.sensor || {}) };
  const radio = { outdoor: 70, indoor: 16, tether: 170, base: 40, loss: .12, ...(cfg.radio || {}) };
  const transitAlt = cfg.alt?.transit ?? 26;
  const D = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU, r = .6 + (i % 3) * .35;
    D.push({ i, x: basePos.x + Math.cos(a) * r, y: basePos.y + .3, z: basePos.z + Math.sin(a) * r, h: a, vx: 0, vz: 0, li: layerOf[baseG], gid: baseG,
      st: ST.IDLE, bat: 1 - R() * .06, team: -1, flags: 0, path: null, wpi: 0, target: -1, claim: null, replanAt: 0, launchAt: Math.round((cfg.launch?.at ?? 6) / dt) + i * (cfg.launch?.every ?? 2),
      conv: null, hold: 0, beacons: cfg.relay?.perDrone ?? 0, lastConn: 0, outSince: -1, recv: 0, readMarks: new Uint8Array(512), evade: null, tlast: 0, lane: 0 });
  }
  if (Array.isArray(cfg.prefer)) { let i = 0; for (const p of cfg.prefer) { const l = layerById(p.layer); for (let n = 0; n < p.n && i < N; n++, i++) D[i].pref = l; } }
  const tether = { x: tStation.x, y: tStation.y, z: tStation.z, h: 0, st: 0, up: 0 };
  const ugvs = (A.ugvRoutes || []).map((route, k) => ({ k, route: route.map(v3), seg: 0, x: v3(route[0]).x, y: v3(route[0]).y, z: v3(route[0]).z, h: 0, st: 0, parked: false,
    start: Math.round(((cfg.ugv?.start ?? 4) + k * (cfg.ugv?.stagger ?? 6)) / dt), speed: cfg.ugv?.speed ?? 1.8, region: null, regionN: 0 }));
  const boats = (A.boats || []).map((b, k) => { const p = v3(b.pos || b.start || (Array.isArray(b) ? b[0] : b)); return { k, x: p.x, y: p.y, z: p.z, h: b.heading || 0, home: p, st: 0, path: null, wpi: 0, job: null, route: b.route ? b.route.map(v3) : null, seg: 0 }; });
  const auxList = [...ugvs.map((u) => ({ kind: 'ugv', name: `ground robot ${u.k + 1}` })), ...boats.map((b) => ({ kind: 'boat', name: `boat ${b.k + 1}` })), { kind: 'tether', name: 'tethered drone' }, { kind: 'station', name: 'tether station' }];
  const NA = auxList.length, AR = 5;
  // UGV regions (where its presence biases the fleet): searchable cells within R of where it parks
  const UGV_R = cfg.ugv?.radius ?? 32;
  if (cfg.ugv?.parkAt != null) for (const u of ugvs) { let len = 0; for (let q = 1; q < u.route.length; q++) len += Math.hypot(u.route[q].x - u.route[q - 1].x, u.route[q].z - u.route[q - 1].z); u.start = Math.max(0, Math.round((cfg.ugv.parkAt - len / u.speed) / dt) + u.k * 2); }
  for (const u of ugvs) {
    const p = u.route[u.route.length - 1], list = [];
    for (let g = 0; g < total; g++) if (srch[g] && (cx(g) - p.x) ** 2 + (cz(g) - p.z) ** 2 < UGV_R * UGV_R) list.push(g);
    u.region = Int32Array.from(list); u.regionN = list.length; u.park = p;
  }
  const inRegion = (u, g) => (cx(g) - u.park.x) ** 2 + (cz(g) - u.park.z) ** 2 < UGV_R * UGV_R;

  // people and decoys
  const cands = [];
  const peopleIn = []; for (const p of A.people || []) { const pp = v3(p.pos || p), g = peopleIn.find((q) => (q.layer ?? null) === (p.layer ?? null) && Math.hypot(v3(q.pos || q).x - pp.x, v3(q.pos || q).z - pp.z) < (cfg.groupR ?? 8)); if (g) { g.count = (g.count || 1) + (p.count || 1); if (p.note && !g.note) g.note = p.note; } else peopleIn.push({ ...p, pos: pp, count: p.count || 1, note: p.note || p.name || '' }); }
  const people = peopleIn.map((p, k) => { const pos = v3(p.pos || p); const l = p.layer != null ? layerById(p.layer) : -1; const L = l >= 0 ? l : nearestLayer(pos);
    return { k, pos, layer: L, gid: snapCell(L, pos), kind: 'person', count: p.count || 1, note: p.note || '', building: p.building ?? null, cand: null }; });
  const decoys = (A.decoys || []).map((p, k) => { const pos = v3(p.pos || p); const l = p.layer != null ? layerById(p.layer) : -1; const L = l >= 0 ? l : nearestLayer(pos);
    return { k, pos, layer: L, gid: snapCell(L, pos), kind: p.kind || 'decoy', label: p.label || p.text || p.name || ({ deer: 'a deer', rock: 'a sun-warmed rock', radiator: 'a warm radiator', stove: 'a warm stove' }[p.kind]) || 'something warm', cand: null }; });
  function nearestLayer(pos) { let best = 0, bd = 1e9; for (let l = 0; l < NL; l++) { const L = LAY[l]; const c = cellAt(L, pos.x, pos.z); if (c < 0) continue; const d = Math.abs(pos.y - L.y) + (typ[L.off + c] === 2 ? 50 : 0); if (d < bd) { bd = d; best = l; } } return best; }
  function snapCell(l, pos) {
    const L = LAY[l]; const i0 = clamp(Math.floor((pos.x - L.x0) / L.cell), 0, L.nx - 1), k0 = clamp(Math.floor((pos.z - L.z0) / L.cell), 0, L.nz - 1);
    let best = L.off + k0 * L.nx + i0, bd = trav[best] ? 0 : 1e9;
    if (bd) for (let k = k0 - 4; k <= k0 + 4; k++) for (let i = i0 - 4; i <= i0 + 4; i++) { if (i < 0 || k < 0 || i >= L.nx || k >= L.nz) continue; const g = L.off + k * L.nx + i; if (!trav[g] || typ[g] === 2) continue; const d = (i - i0) ** 2 + (k - k0) ** 2; if (d < bd) { bd = d; best = g; } }
    return best;
  }

  // ------------------------------------------------------------------ Turing field (front frame) and front sweep
  const FR = cfg.front || null;
  let gsF = null, front = null;
  if (FR) {
    const dir = { x: FR.dir[0], z: FR.dir[1] }; const dl = Math.hypot(dir.x, dir.z); dir.x /= dl; dir.z /= dl;
    const lat = { x: -dir.z, z: dir.x };
    const cellM = FR.fieldCell || 6, w = Math.max(16, Math.round(FR.width / cellM)), h = Math.max(8, Math.round((FR.depth || 60) / cellM));
    gsF = grayScott(w, h, { F: cfg.turing?.F ?? .030, k: cfg.turing?.k ?? .062, seed: (cfg.seed || 1) * 13 + 5 });
    gsF.step(1600);
    front = { dir, lat, s: FR.s0, s0: FR.s0, s1: FR.s1, c: FR.center, w, h, cellM, width: FR.width, depth: FR.depth || 60, on: false, done: false, speed: FR.speed || 1.2 };
  }
  const frameOf = () => {
    // field grid origin: front line at s, lateral centred on the front's centre line
    const o = { x: front.c.x + front.dir.x * (front.s - front.depth * .5) - front.lat.x * front.width * .5, z: front.c.z + front.dir.z * (front.s - front.depth * .5) - front.lat.z * front.width * .5 };
    return { ox: o.x, oz: o.z, ux: front.lat.x, uz: front.lat.z, vx: front.dir.x, vz: front.dir.z, su: front.cellM, sv: front.cellM };
  };

  // ------------------------------------------------------------------ recording buffers
  const DR = 10;
  let cap = 1024;
  let drec = new Float32Array(cap * N * DR), arec = new Float32Array(cap * NA * AR);
  const M = {}; const MK = ['coverage', 'phi', 'phiL', 'eta', 'beta0', 'frontier', 'meshSize', 'identical', 'bytes', 'cv', 'readout', 'h', 'x', 'mode', 'inRange', 'teamA', 'teamB', 'teamC', 'pending', 'airborne', 'fieldOn', 'commands', 'agree'];
  for (const k of MK) M[k] = new Float32Array(cap);
  let b0L = Array.from({ length: NL }, () => new Float32Array(cap));
  const linkOff = [0]; let linkBuf = new Uint16Array(65536), linkCells = new Uint16Array(32768), nLink = 0;
  const marks = [], events = [], finds = [], forecast = [], beacons = [];
  const fieldSnaps = [];
  const grow = () => {
    const nc = cap * 2;
    const d2 = new Float32Array(nc * N * DR); d2.set(drec); drec = d2;
    const a2 = new Float32Array(nc * NA * AR); a2.set(arec); arec = a2;
    for (const k of MK) { const m2 = new Float32Array(nc); m2.set(M[k]); M[k] = m2; }
    b0L = b0L.map((m) => { const m2 = new Float32Array(nc); m2.set(m); return m2; });
    cap = nc;
  };
  const ev = (type, pos, extra = {}) => { events.push({ t: tick, type, pos: pos ? [pos.x, pos.y, pos.z] : null, ...extra }); };

  // ------------------------------------------------------------------ sensing
  const RAYS = 56, rayC = new Float32Array(RAYS), rayS = new Float32Array(RAYS);
  for (let r = 0; r < RAYS; r++) { rayC[r] = Math.cos(r / RAYS * TAU); rayS[r] = Math.sin(r / RAYS * TAU); }
  const discs = new Map();
  const discOf = (r) => { if (discs.has(r)) return discs.get(r); const o = []; for (let k = -r; k <= r; k++) for (let i = -r; i <= r; i++) if (i * i + k * k <= r * r + r * .6) o.push(i, k); const a = Int16Array.from(o); discs.set(r, a); return a; };
  const sensedNow = new Int32Array(total);       // stamp: last tick a cell was sensed by anyone (for detection)
  const sensedBy = new Int16Array(total);
  function sense(d) {
    const L = LAY[d.li]; const c0 = cellAt(L, d.x, d.z); if (c0 < 0) return;
    const i0 = c0 % L.nx, k0 = (c0 / L.nx) | 0;
    if (L.outdoor) {
      const altK = clamp((d.y - L.y) / Math.max(1, L.fly - L.y), .35, 1.4);
      const r = Math.max(1, Math.round(sens.outdoor * altK / L.cell)); const ds = discOf(r);
      for (let q = 0; q < ds.length; q += 2) {
        const i = i0 + ds[q], k = k0 + ds[q + 1]; if (i < 0 || k < 0 || i >= L.nx || k >= L.nz) continue;
        const g = L.off + k * L.nx + i; if (typ[g] === 2 && !srch[g]) { learn(d.i, g); continue; } learn(d.i, g); sensedNow[g] = tick + 1; sensedBy[g] = d.i;
      }
    } else {
      const rc = sens.indoor / L.cell;
      learn(d.i, L.off + c0); sensedNow[L.off + c0] = tick + 1; sensedBy[L.off + c0] = d.i;
      const fx = (d.x - L.x0) / L.cell, fz = (d.z - L.z0) / L.cell;
      for (let r = 0; r < RAYS; r++) {
        let lastC = -1;
        for (let s = .5; s <= rc; s += .5) {
          const i = Math.floor(fx + rayC[r] * s), k = Math.floor(fz + rayS[r] * s); if (i < 0 || k < 0 || i >= L.nx || k >= L.nz) break;
          const c = k * L.nx + i; if (c === lastC) continue; lastC = c; const g = L.off + c;
          learn(d.i, g); if (typ[g] === 1 || typ[g] === 2) break; sensedNow[g] = tick + 1; sensedBy[g] = d.i;
        }
      }
    }
  }

  // ------------------------------------------------------------------ mesh: links, components, delta sync
  const nodePos = (n) => n < N ? D[n] : n === TETHER ? tether : n === BASE ? { x: basePos.x, y: basePos.y + 2, z: basePos.z, li: layerOf[baseG] } : beacons[n - B0];
  const nodeAlive = (n) => n < N ? (D[n].st !== ST.IDLE && D[n].st !== ST.DEAD && D[n].st !== ST.LANDED) || (D[n].st === ST.LANDED) : n === TETHER ? tether.up > .5 : n === BASE ? true : n - B0 < beacons.length;
  const nodeLayer = (n) => (n < N ? D[n].li : n >= B0 ? beacons[n - B0].li : -1);
  const nodeRange = (n) => { if (n === TETHER) return radio.tether; if (n === BASE) return radio.base; const l = nodeLayer(n); return l >= 0 && !LAY[l].outdoor ? radio.indoor : radio.outdoor; };
  const worldLos = typeof world.los === 'function' ? world.los : null;
  function radioLos(a, b) {
    if (worldLos) { const p = nodePos(a), q = nodePos(b); try { return !!worldLos(p, q); } catch (e) { /* fall back to the grid */ } }
    // through rock/rubble there is no radio: check line of sight on each indoor layer involved
    for (const n of [a, b]) {
      const l = nodeLayer(n); if (l < 0 || LAY[l].outdoor) continue;
      const L = LAY[l], p = nodePos(a), q = nodePos(b);
      const i0 = clamp(Math.floor((p.x - L.x0) / L.cell), 0, L.nx - 1), k0 = clamp(Math.floor((p.z - L.z0) / L.cell), 0, L.nz - 1), i1 = clamp(Math.floor((q.x - L.x0) / L.cell), 0, L.nx - 1), k1 = clamp(Math.floor((q.z - L.z0) / L.cell), 0, L.nz - 1);
      if (!los(L, i0, k0, i1, k1)) return false;
    }
    return true;
  }
  const comp = new Int32Array(NM), ufP = new Int32Array(NM);
  const uf = (a) => { while (ufP[a] !== a) { ufP[a] = ufP[ufP[a]]; a = ufP[a]; } return a; };
  let linksNow = [];
  function mesh() {
    linksNow = [];
    const nodes = []; for (let n = 0; n < N + 2 + beacons.length; n++) if (nodeAlive(n) && !(n < N && (D[n].st === ST.LANDED))) nodes.push(n);
    for (let n = 0; n < NM; n++) ufP[n] = n;
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      const na = nodes[a], nb = nodes[b]; if (na === BASE && nb >= B0) continue;
      if ((na === TETHER && nb === BASE) || (na === BASE && nb === TETHER)) { linksNow.push(na, nb); const ra = uf(na), rb = uf(nb); if (ra !== rb) ufP[ra] = rb; continue; }
      const p = nodePos(na), q = nodePos(nb);
      let rr = Math.min(nodeRange(na), nodeRange(nb));
      if (na === TETHER || nb === TETHER) { const o = na === TETHER ? nb : na, l = nodeLayer(o); rr = l >= 0 && !LAY[l].outdoor ? radio.indoor * 1.6 : radio.tether; }
      const d2 = (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2; if (d2 > rr * rr) continue;
      if (!radioLos(na, nb)) continue;
      linksNow.push(na, nb); const ra = uf(na), rb = uf(nb); if (ra !== rb) ufP[ra] = rb;
    }
    for (let n = 0; n < NM; n++) comp[n] = uf(n);
  }
  let bytesTick = 0;
  function sync() {
    bytesTick = 0;
    for (let q = 0; q < linksNow.length; q += 2) {
      const a = linksNow[q], b = linksNow[q + 1]; let moved = 0;
      if (R() < radio.loss) { recLink(a, b, 0); continue; }      // packet lost: the cursor stays, the delta is resent next tick
      for (const [s, t] of [[a, b], [b, a]]) {
        const ci = s * NM + t; let k = cur[ci]; const end = logN[s], Ls = logA[s];
        let lim = Math.min(end, k + (cfg.radio?.perTick ?? 2400));
        for (; k < lim; k++) { if (learn(t, Ls[k])) moved++; }
        cur[ci] = k;
      }
      if (a < N) D[a].recv += moved; if (b < N) D[b].recv += moved;
      bytesTick += 16 + moved * 4;
      recLink(a, b, moved);
    }
  }
  function recLink(a, b, moved) {
    if (nLink * 2 + 2 > linkBuf.length) { const n2 = new Uint16Array(linkBuf.length * 2); n2.set(linkBuf); linkBuf = n2; const c2 = new Uint16Array(linkCells.length * 2); c2.set(linkCells); linkCells = c2; }
    linkBuf[nLink * 2] = a; linkBuf[nLink * 2 + 1] = b; linkCells[nLink] = Math.min(65535, moved); nLink++;
  }

  // ------------------------------------------------------------------ choosing where to go
  const claimR = { outdoor: cfg.claim?.outdoor ?? 16, indoor: cfg.claim?.indoor ?? 4 };
  let repeatsAvoided = 0;
  const candG = new Int32Array(64), candD = new Float32Array(64);
  function plan(d) {
    const me = d.i, K = known[me], myComp = comp[me];
    let nc = 0;
    const start = d.gid;
    bfs(start, (g, dist) => { if (srch[g] && !K[g]) { candG[nc] = g; candD[nc] = dist * LAY[layerOf[g]].cell; nc++; if (nc >= 24) return true; } return false; }, 7000);
    const parSnap = nc ? true : false;
    // the ground robots: their presence (not a message) makes a building rate higher for nearby drones
    let best = -1, bs = 1e18, bestNoMark = -1, bsNoMark = 1e18, bestTeam = -1;
    const teamCount = [0, 0, 0, 0];
    for (const o of D) if (o.i !== me && comp[o.i] === myComp && o.team >= 0 && (o.st === ST.SEARCH || o.st === ST.CONVERGE)) teamCount[o.team]++;
    // symmetry breaking: a free drone joins the team of a parked ground robot (nearest, unless that team is already crowded
    // for the work left there); a team member searches around its robot; a team dissolves when its building is done
    const activeUgv = ugvs.filter((u) => u.parked && (u.unk || 0) > 0);
    if (d.team >= 0 && ugvs[d.team] && (!ugvs[d.team].parked || (ugvs[d.team].unk || 0) === 0)) d.team = -1;
    if (d.team < 0 && activeUgv.length && (cfg.ugv?.teams ?? true)) {
      // a team's fair share grows with the work left around its robot, but sub-linearly (shareExp), so a big building
      // does not swallow the whole fleet
      const ex = cfg.ugv?.shareExp ?? .5, wU = (u) => Math.pow(u.unk, ex);
      const tot = activeUgv.reduce((a, u) => a + wU(u), 0), nAct = D.filter((o) => o.st === ST.SEARCH || o.st === ST.CONVERGE || o.st === ST.CONFIRM).length;
      let bu = null, bsc = 1e18;
      for (const u of activeUgv) { const share = wU(u) / tot, crowd = teamCount[u.k] / Math.max(1, nAct * share * (cfg.ugv?.fill ?? .8)); const sc = Math.hypot(u.park.x - d.x, u.park.z - d.z) * (1 + 3 * Math.max(0, crowd - .6)); if (sc < bsc) { bsc = sc; bu = u; } }
      if (bu && teamCount[bu.k] < nAct * (wU(bu) / tot) * (cfg.ugv?.fill ?? .8) + 1) { d.team = bu.k; if (!d.joined) { d.joined = true; ev('join', d, { drone: d.i, team: bu.k }); } }
    }
    const tU = d.team >= 0 ? ugvs[d.team] : null;
    const pref = d.pref ?? -1, prefLeft = pref >= 0 ? (nSearchL[pref] - coveredL[pref]) > nSearchL[pref] * .004 : false;
    const score = (g, dist, team) => {
      const L = LAY[layerOf[g]], x = cx(g), z = cz(g), cr = L.outdoor ? claimR.outdoor : claimR.indoor;
      let s = dist;
      for (const o of D) {
        if (o.i === me || !o.claim || comp[o.i] !== myComp || o.st === ST.DEAD) continue;
        if (o.claim.li !== layerOf[g]) continue;
        const dd = (o.claim.x - x) ** 2 + (o.claim.z - z) ** 2; if (dd < cr * cr) s += (cfg.claim?.penalty ?? 40) * (1 - Math.sqrt(dd) / cr);
        const dp = (o.x - x) ** 2 + (o.z - z) ** 2; if (dp < cr * cr * .5) s += 10;
      }
      if (tU) s += Math.hypot(x - tU.park.x, z - tU.park.z) * (cfg.ugv?.pull ?? .7);
      if (prefLeft && layerOf[g] !== pref) s += cfg.prefPenalty ?? 400;
      if (gsF && front && !front.done) s -= 0;
      return s;
    };
    const markPen = (g) => {
      if (!marks.length) return 0; const x = cx(g), z = cz(g), l = layerOf[g], mr2 = (cfg.stigmergy?.radius ?? 8) ** 2; let p = 0;
      for (let m = 0; m < marks.length; m++) { const mk = marks[m]; if (!d.readMarks[m & 511] || mk.drone === me || mk.li !== l) continue; const dd = (mk.x - x) ** 2 + (mk.z - z) ** 2; if (dd < mr2 && tick - mk.t < 600) p += cfg.stigmergy?.penalty ?? 30; }
      return p;
    };
    for (let q = 0; q < nc; q++) {
      const s0 = score(candG[q], candD[q], -1), mp = markPen(candG[q]);
      if (s0 + mp < bs) { bs = s0 + mp; best = candG[q]; bestTeam = d.team; }
      if (s0 < bsNoMark) { bsNoMark = s0; bestNoMark = candG[q]; }
    }
    if (best !== bestNoMark && bestNoMark >= 0) repeatsAvoided++;
    // region candidates: go and help at a parked ground robot's building
    for (const u of ugvs) {
      if (!u.parked || u !== tU) continue;
      let rg = -1, rd = 1e18;
      for (let q = 0; q < u.regionN; q++) { const g = u.region[q]; if (K[g]) continue; const dd = (cx(g) - u.park.x) ** 2 + (cz(g) - u.park.z) ** 2; if (dd < rd) { rd = dd; rg = g; } }
      if (rg < 0) continue;
      const est = Math.hypot(cx(rg) - d.x, cz(rg) - d.z) * 1.15;
      const s = est + Math.sqrt(rd) * (cfg.ugv?.pull ?? .7);
      if (s < bs - (nc ? 0 : 0)) { bs = s; best = rg; bestTeam = u.k; }
    }
    if (best < 0 && nc === 0) {
      // nothing unsearched nearby: head for the nearest unsearched place anywhere on my own map
      let bg = -1, bdd = 1e18; const ly = LAY[d.li].y;
      for (let g = 0; g < total; g += 1) { if (!srch[g] || K[g]) continue; const L = LAY[layerOf[g]]; const dd = (cx(g) - d.x) ** 2 + (cz(g) - d.z) ** 2 + ((L.y - ly) * 3) ** 2 + (layerOf[g] !== d.li ? 400 : 0); if (dd < bdd) { bdd = dd; bg = g; } }
      if (bg >= 0) best = bg;
    }
    if (best < 0) return false;
    // path
    let p;
    if (bStamp[best] === stampId) p = pathTo(best);
    else { const hit = bfs(start, (g) => g === best); if (hit < 0) return false; p = pathTo(best); }
    d.path = waypoints(p); d.wpi = 0; d.target = best;
    if (!d.path.length) { if (best === start) learn(me, best); d.path = null; return false; }
    d.claim = { x: cx(best), z: cz(best), li: layerOf[best] };
    // a far target is replanned less often (it is replanned at once anyway if someone else searches it first)
    d.replanAt = tick + Math.max(LAY[d.li].outdoor ? 14 : 20, Math.min(48, Math.floor(p.length * .45)));
    return true;
  }
  function planTo(d, goal) {
    const hit = bfs(d.gid, (g) => g === goal); if (hit < 0) return false;
    d.path = waypoints(pathTo(goal)); d.wpi = 0; d.target = goal; d.claim = { x: cx(goal), z: cz(goal), li: layerOf[goal] }; return true;
  }

  // ------------------------------------------------------------------ moving
  const desiredY = (d) => {
    if (d.path && d.wpi < d.path.length) { const g = d.path[d.wpi], l = layerOf[g]; if (l !== d.li) { const dd = Math.hypot(cx(g) - d.x, cz(g) - d.z); if (dd < 8) return flyAt(LAY[l], cx(g), cz(g)); } }
    const L = LAY[d.li]; return flyAt(L, d.x, d.z) + (L.outdoor ? ((d.i % 5) - 2) * .8 : 0);
  };
  function follow(d, speed) {
    if (!d.path || d.wpi >= d.path.length) return true;
    const g = d.path[d.wpi]; let tx = cx(g), tz = cz(g);
    const dx = tx - d.x, dz = tz - d.z, dist = Math.hypot(dx, dz), step = speed * dt;
    const L = LAY[d.li];
    if (dist <= step) { d.x = tx; d.z = tz; if (layerOf[g] !== d.li) d.li = layerOf[g]; d.gid = g; d.wpi++; d.h = d.h + angDiff(d.h, Math.atan2(dz, dx)) * .5; return d.wpi >= d.path.length; }
    const want = Math.atan2(dz, dx), turn = (L.outdoor ? 1.1 : 2.4) * dt * 2;
    const dh = angDiff(d.h, want); d.h += clamp(dh, -turn, turn);
    let nx = d.x + Math.cos(d.h) * step, nz = d.z + Math.sin(d.h) * step;
    const c = cellAt(L, nx, nz);
    if (c < 0 || !trav[L.off + c] || Math.abs(dh) > 1.2) { nx = d.x + dx / dist * step; nz = d.z + dz / dist * step; }
    d.x = nx; d.z = nz; const c2 = cellAt(L, d.x, d.z); if (c2 >= 0 && trav[L.off + c2]) d.gid = L.off + c2;
    return false;
  }
  const easeY = (d, ty, rate = spd.climb) => { const s = rate * dt; d.y += clamp(ty - d.y, -s, s); };

  // ------------------------------------------------------------------ the phase change around a candidate
  function stepCand(C) {
    // evidence on this tick: thermal (anyone sensing the cell), camera (a drone within camera range with line of sight)
    const thermal = sensedNow[C.gid] === tick + 1;
    let cam = false, camD = -1;
    if (C.state !== 'closed') for (const d of D) {
      if (d.li !== C.layer || d.st === ST.DEAD || d.st === ST.IDLE || d.st === ST.LANDED) continue;
      if (C.kind === 'person' && C.mode !== 1) break;
      if (d.st !== ST.CONFIRM && d.st !== ST.CONVERGE && C.kind === 'person') continue;
      const dd = Math.min(Math.hypot(d.x - C.pos.x, d.z - C.pos.z, (d.y - C.pos.y) * .4) - C.off, Math.hypot(d.x - cx(C.gid), d.z - cz(C.gid), (d.y - C.pos.y) * .4) - LAY[C.layer].cell * .75); if (dd > sens.camera) continue;
      const L = LAY[d.li], ci = C.gid - L.off; const c0 = cellAt(L, d.x, d.z); if (c0 < 0) continue;
      if (los(L, c0 % L.nx, (c0 / L.nx) | 0, ci % L.nx, (ci / L.nx) | 0)) { cam = true; camD = d.i; break; }
    }
    if (thermal) C.therm = Math.min(1, C.therm + .2); else C.therm *= .995;
    if (cam) C.camT++;
    let target;
    if (C.state === 'handed' || C.state === 'closed') target = -.7;
    else if (C.kind === 'person') target = .62 * Math.min(1, C.therm * 1.4) + (C.camT > 0 ? .3 : 0);
    else target = .3 * Math.min(1, C.therm * 1.4) - (C.camT > 3 ? 1.1 : 0);
    C.h += (target - C.h) * .09;
    for (let s = 0; s < 8; s++) { const a = -dLandscape(C.x, C.h) - 1.2 * C.v + (R() - .5) * .25; C.v += a * .12; C.x += C.v * .12; }
    const was = C.mode; C.mode = C.x > 0 ? 1 : 0;
    if (C.mode === 1 && was === 0) { C.tipT = tick; ev('tip', C.pos, { cand: C.id, text: 'the signal tips the landscape' }); }
    if (C.mode === 0 && was === 1) { C.relT = tick; ev('release', C.pos, { cand: C.id }); C.state = 'closed'; }
    if (C.kind === 'person' && C.state === 'signal' && C.camT >= (cfg.phase?.confirm ?? 6) && C.mode === 1) {
      C.state = 'confirmed'; C.confT = tick;
      const f = { t: C.detT, pos: [C.pos.x, C.pos.y, C.pos.z], confirmT: tick, confidence: Math.min(.99, .9 + C.therm * .08), layer: LAY[C.layer].id, count: C.src.count, note: C.src.note, by: camD, cand: C.id };
      finds.push(f); ev('find', C.pos, { cand: C.id, drone: camD, count: C.src.count, layer: LAY[C.layer].id });
      C.handAt = tick + Math.round((cfg.phase?.hold ?? 40) / dt);
    }
    // a tipped signal the camera cannot reach for two minutes: hand it over as a thermal-only find (the rescuers check it)
    if (C.kind === 'person' && C.state === 'signal' && C.mode === 1 && C.tipT != null && tick - C.tipT > Math.round(120 / dt)) {
      C.state = 'confirmed'; C.confT = tick; C.thermalOnly = true;
      const f = { t: C.detT, pos: [C.pos.x, C.pos.y, C.pos.z], confirmT: tick, confidence: .8, layer: LAY[C.layer].id, count: C.src.count, note: (C.src.note ? C.src.note + '; ' : '') + 'thermal only, the camera could not get a clear view', by: camD, cand: C.id, thermalOnly: true };
      finds.push(f); ev('find', C.pos, { cand: C.id, drone: camD, count: C.src.count, layer: LAY[C.layer].id, thermalOnly: true });
      C.handAt = tick + Math.round((cfg.phase?.hold ?? 40) / dt);
    }
    // a signal that never tipped and was never checked for five minutes is closed (nothing holds the search forever)
    if (C.state === 'signal' && C.mode === 0 && tick - C.detT > Math.round(300 / dt)) { C.state = 'closed'; C.relT = tick; }
    if (C.state === 'confirmed' && tick >= C.handAt) { C.state = 'handed'; ev('handover', C.pos, { cand: C.id }); }
    if (C.kind !== 'person' && C.state === 'signal' && C.camT > 3) { C.state = 'closed'; ev('reject', C.pos, { cand: C.id, drone: camD, label: C.src.label }); }
  }
  const canopyL = LAY.findIndex((L) => L.density);
  function detect() {
    if (canopyL >= 0 && tick % 2 === 0) {
      const CL = LAY[canopyL];
      for (const P of [...people, ...decoys]) {
        if (P.cand || P.layer === canopyL) continue; const c = cellAt(CL, P.pos.x, P.pos.z); if (c < 0 || CL.density[c] > (cfg.seeThrough ?? 150)) continue;
        for (const d of D) { if (d.li !== canopyL || (d.st !== ST.SEARCH && d.st !== ST.FRONT)) continue; if ((d.x - P.pos.x) ** 2 + (d.z - P.pos.z) ** 2 < (sens.outdoor * .8) ** 2) { sensedNow[P.gid] = tick + 1; sensedBy[P.gid] = d.i; P.viaGap = true; break; } }
      }
    }
    for (const P of [...people, ...decoys]) {
      if (P.cand || sensedNow[P.gid] !== tick + 1) continue;
      const C = { id: cands.length, kind: P.kind === 'person' ? 'person' : 'decoy', src: P, pos: P.pos, layer: P.layer, gid: P.gid, off: Math.hypot(cx(P.gid) - P.pos.x, cz(P.gid) - P.pos.z), h: 0, x: -1, v: 0, mode: 0, state: 'signal', therm: 0, camT: 0, detT: tick, by: sensedBy[P.gid] };
      P.cand = C; cands.push(C); ev('detect', P.pos, { cand: C.id, drone: C.by, kind: C.kind, label: P.label || '', gap: !!P.viaGap });
    }
  }
  // who converges: searching drones near a tipped candidate (and the closest checks with its camera)
  function convergeLogic() {
    for (const C of cands) {
      const active = C.state !== 'closed' && C.state !== 'handed';
      if (C.kind === 'person' && C.mode === 1 && active) {
        const L = LAY[C.layer], Rc = L.outdoor ? (cfg.phase?.radiusOut ?? 55) : (cfg.phase?.radiusIn ?? 22);
        let n = D.filter((d) => d.conv === C).length;
        for (const d of D) if (d.conv === C && d.st === ST.CONFIRM) d.slot = 0;
        const near = D.filter((d) => (d.st === ST.SEARCH || d.st === ST.FRONT) && !d.conv && Math.hypot(d.x - C.pos.x, d.z - C.pos.z) < Rc && comp[d.i] === comp[C.by >= 0 ? C.by : d.i]).sort((a, b) => Math.hypot(a.x - C.pos.x, a.z - C.pos.z) - Math.hypot(b.x - C.pos.x, b.z - C.pos.z));
        for (const d of near) { if (n >= (cfg.phase?.max ?? 5)) break; d.conv = C; d.st = n === 0 ? ST.CONFIRM : ST.CONVERGE; d.slot = n; n++; d.path = null; d.claim = { x: C.pos.x, z: C.pos.z, li: C.layer }; }
      }
      if (active && C.mode === 0 && (C.kind !== 'person' || C.state === 'signal') && !D.some((d) => d.conv === C)) {
        // a lone check: the nearest searching drone goes to look with its camera; nobody else changes what they do
        let bd = 1e9, who = null; for (const d of D) { if ((d.st !== ST.SEARCH && d.st !== ST.FRONT) || d.conv) continue; const dd = Math.hypot(d.x - C.pos.x, d.z - C.pos.z) * (d.li === C.layer ? 1 : 1.6); if (dd < bd) { bd = dd; who = d; } }
        if (who && bd < 260) { who.conv = C; who.st = ST.CONFIRM; who.slot = 0; who.path = null; who.convT = tick; }
      }
    }
    for (const d of D) {
      if (!d.conv) continue; const C = d.conv;
      if (C.state === 'closed' || (C.state === 'handed' && C.mode === 0) || (C.kind !== 'person' && C.state !== 'signal')) { d.conv = null; d.st = front && front.on && !front.done ? ST.FRONT : ST.SEARCH; d.path = null; d.replanAt = 0; continue; }
      if (C.kind === 'person' && C.mode === 0 && C.state === 'signal' && d.slot === 0 && tick - (d.convT ?? tick) > 400) { d.conv = null; d.st = ST.SEARCH; d.path = null; continue; }
      if (!d.path) {
        const L = LAY[C.layer], ring = d.st === ST.CONFIRM ? 0 : (L.outdoor ? 15 : 3.5);    // the camera drone goes to the reachable cell nearest the signal
        const a = (d.slot / 5) * TAU + C.id;
        const gx = (ring ? C.pos.x : cx(C.gid)) + Math.cos(a) * ring, gz = (ring ? C.pos.z : cz(C.gid)) + Math.sin(a) * ring;
        let goal = -1, gd = 1e9;
        bfs(C.gid, (g, dist) => { if (layerOf[g] !== C.layer) return false; const dd = (cx(g) - gx) ** 2 + (cz(g) - gz) ** 2; if (dd < gd) { gd = dd; goal = g; } return dist > ring / L.cell + 3; }, 3000);
        if (goal === d.gid && d.st === ST.CONFIRM) { d.path = []; continue; }                // already there: hover and look
        if (goal < 0 || !planTo(d, goal)) { d.conv = null; d.st = ST.SEARCH; continue; }
      }
    }
  }

  // ------------------------------------------------------------------ scripted disturbances
  const evq = (cfg.events || []).map((e) => ({ ...e, tick: Math.round((e.t ?? 0) / dt), done: false }));
  let shock = 0, gust = null;
  function disturb() {
    for (const e of evq) {
      if (e.done) continue;
      if (e.after) { const ref = events.find((x) => x.type === e.after); if (!ref) continue; if (tick < ref.t + Math.round((e.delay || 0) / dt)) continue; }
      else if (e.whenCoverage != null) { if (covered / nSearch < e.whenCoverage) continue; }
      else if (tick < e.tick) continue;
      e.done = true;
      if (e.type === 'aftershock') {
        shock = 1; ev('aftershock', e.pos ? v3(e.pos) : { x: basePos.x, y: 0, z: basePos.z }, { text: e.text || 'aftershock', mag: e.mag || 5.1 });
        for (const d of D) {
          if (d.st === ST.IDLE || d.st === ST.DEAD || d.st === ST.LANDED) continue;
          d.h += (R() - .5) * 3.2; d.vx += (R() - .5) * 4; d.vz += (R() - .5) * 4;
          if (!LAY[d.li].outdoor && (d.st === ST.SEARCH || d.st === ST.CONVERGE || d.st === ST.CONFIRM)) {
            // pull out to the street through the nearest opening, wait for the rubble to settle
            let goal = -1; bfs(d.gid, (g) => { if (LAY[layerOf[g]].outdoor) { goal = g; return true; } return false; }, 20000);
            if (goal >= 0 && planTo(d, goal)) { d.st = ST.EVADE; d.hold = tick + Math.round((e.hold ?? 40) / dt); d.conv = null; }
          } else if (d.st === ST.SEARCH || d.st === ST.TRANSIT || d.st === ST.FRONT) { d.st = ST.EVADE; d.path = null; d.hold = tick + Math.round((e.holdOut ?? 12) / dt); }
        }
      } else if (e.type === 'gust') {
        gust = { t0: tick, dir: e.dir ? Math.atan2(e.dir[1], e.dir[0]) : R() * TAU, k: e.strength ?? 6, dur: Math.round((e.dur ?? 14) / dt), layers: e.layers };
        ev('gust', e.pos ? v3(e.pos) : null, { text: e.text || 'a gust' });
      } else if (e.type === 'battery') {
        let d = D[e.drone ?? 6];
        if (!d || d.st === ST.IDLE || d.st === ST.LANDED || d.st === ST.DEAD) d = D.find((o) => o.st === ST.SEARCH) || d;
        if (d) { d.bat = 0; d.st = ST.DEAD; d.conv = null; d.claim = null; d.path = null; ev('battery', d, { drone: d.i, text: `drone ${d.i + 1}'s battery fails`, own: ownCount[d.i] }); }
      } else if (e.type === 'swerve') {
        const tr = D.filter((d) => d.st === ST.TRANSIT || d.st === ST.FRONT); if (tr.length) { const d = tr[(R() * tr.length) | 0]; d.h += 1.1; d.swerve = 3; ev('swerve', d, { drone: d.i }); }
      } else if (e.type === 'water') {
        const cells = e.cells || [];
        for (const g0 of cells) { const g = typeof g0 === 'number' ? g0 : -1; if (g < 0) continue; typ[g] = 1; trav[g] = 0; }
        if (e.region) { const l = layerById(e.region.layer); if (l >= 0) { const L = LAY[l], p = v3(e.region.pos), r = e.region.r || 8;
          for (let c = 0; c < L.nx * L.nz; c++) { const g = L.off + c; if (Math.hypot(cx(g) - p.x, cz(g) - p.z) < r && typ[g] === 3) { typ[g] = 1; trav[g] = 0; changes.push({ t: tick, g }); } } } }
        ev('water_rise', e.region ? v3(e.region.pos) : null, { text: e.text || 'the water rises', rise: e.rise ?? 1, cells: changes.length });
        for (const d of D) if (d.st === ST.SEARCH && d.gid >= 0 && !trav[d.gid]) d.path = null;
      } else if (e.type === 'current') {
        const b = boats[e.boat ?? 0]; if (b) { b.drift = { k: e.strength ?? 2, dir: e.dir ? Math.atan2(e.dir[1], e.dir[0]) : 0, until: tick + Math.round((e.dur ?? 20) / dt) }; ev('current', b, { boat: b.k, text: e.text || 'a current pushes the boat' }); }
      } else ev(e.type, e.pos ? v3(e.pos) : null, { text: e.text || '' });
    }
  }

  // ------------------------------------------------------------------ Koopman: DMD on a coarse coverage picture
  const KP = cfg.koopman === false ? null : { every: 10, window: 18, horizon: 12, ...(cfg.koopman || {}) };
  const mainL = LAY.reduce((b, L, i) => (nSearchL[i] > nSearchL[b] ? i : b), 0);
  const KG = { w: 16, h: 12 };
  const kSnaps = [];
  function kObs() {
    const L = LAY[mainL], gw = KG.w, gh = KG.h, o = new Float64Array(gw * gh + 1), cnt = new Float64Array(gw * gh);
    for (let c = 0; c < L.nx * L.nz; c++) { const g = L.off + c; if (!srch[g]) continue; const i = c % L.nx, k = (c / L.nx) | 0, q = ((k * gh / L.nz) | 0) * gw + ((i * gw / L.nx) | 0); cnt[q]++; if (firstSeen[g] <= tick) o[q]++; }
    for (let q = 0; q < gw * gh; q++) o[q] = cnt[q] ? o[q] / cnt[q] : 1;
    o[gw * gh] = 1; return { o, cnt };
  }
  function koopman() {
    if (!KP || tick % KP.every || covered < nSearch * .03) return;
    const { o, cnt } = kObs(); kSnaps.push(o);
    if (kSnaps.length > KP.window + 1) kSnaps.shift();
    if (kSnaps.length < 6) return;
    const X = kSnaps.slice(0, -1), Y = kSnaps.slice(1);
    try {
      const model = dmd(X, Y, 6);
      const pr = model.predict(o, KP.horizon);
      const grid = new Uint8Array(KG.w * KG.h); let pc = 0, tc = 0;
      for (let q = 0; q < KG.w * KG.h; q++) { const v = clamp(Math.max(o[q], pr[q])); grid[q] = v * 255; pc += v * cnt[q]; tc += cnt[q]; }
      const now = covered / nSearch;
      forecast.push({ t0: tick, horizon: KP.horizon * KP.every, pred: Math.max(now, (pc / Math.max(1, tc)) * (nSearchL[mainL] / nSearch) + (now - coveredL[mainL] / nSearch)), now, grid, gw: KG.w, gh: KG.h, layer: LAY[mainL].id, rank: model.r, actual: null });
    } catch (e) { /* a degenerate window: skip this forecast */ }
  }

  // ------------------------------------------------------------------ β0 bookkeeping
  const labBuf = new Int32Array(Math.max(...LAY.map((L) => L.nx * L.nz)));
  let beta0 = 0, frontierLen = 0; const beta0Layer = new Int32Array(NL);
  let completeT = -1;
  // β0 per layer, recounted only for layers where something new was searched (and big layers every other time)
  function topo() {
    beta0 = 0; frontierLen = 0;
    for (let l = 0; l < NL; l++) {
      const L = LAY[l], off = L.off;
      if (topoDirty[l] && (L.nx * L.nz < 40000 || tick % 4 === 0 || tick < 4 || completeT >= 0)) {
        topoDirty[l] = 0;
        beta0Layer[l] = beta0Of(L, cfg.minPocket ?? 3);
      }
      beta0 += beta0Layer[l];
    }
  }
  // pockets are proven sealed when every obstacle cell around them has been seen
  const skin = new Int32Array(total).fill(-1);
  for (let l = 0; l < NL; l++) { const L = LAY[l]; if (L.outdoor) continue; for (let c = 0; c < L.nx * L.nz; c++) { const g = L.off + c; if (typ[g] !== 1) continue; const i = c % L.nx, k = (c / L.nx) | 0; let ext = false;
    for (let dk = -2; dk <= 2 && !ext; dk++) for (let di = -2; di <= 2; di++) { const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= L.nx || kk >= L.nz || typ[L.off + kk * L.nx + ii] === 2) { ext = true; break; } }
    if (!ext) continue; for (let l2 = 0; l2 < NL; l2++) { const O = LAY[l2]; if (!O.outdoor) continue; const c2 = cellAt(O, cx(g), cz(g)); if (c2 >= 0) { skin[g] = O.off + c2; break; } } } }
  const knownNow = (h) => firstSeen[h] <= tick || (skin[h] >= 0 && firstSeen[skin[h]] <= tick);
  function pocketCheck() {
    if (tick % 4) return;
    for (const P of pockets) {
      if (P.t >= 0) continue;
      const L = LAY[P.layer], q = [P.cells[0]], seenQ = new Set(q); let sealed = true;
      for (let qi = 0; qi < q.length && sealed; qi++) {
        const u = q[qi] - L.off, i = u % L.nx, k = (u / L.nx) | 0;
        for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= L.nx || kk >= L.nz) { sealed = false; break; }
          const h = L.off + kk * L.nx + ii; if (seenQ.has(h) || knownNow(h)) continue;
          if (typ[h] === 2 || reach[h]) { sealed = false; break; }
          seenQ.add(h); q.push(h); if (q.length > 2500) { sealed = false; break; }
        }
      }
      if (sealed) { P.t = tick; P.enclosed = q.length; P.encl = q.slice(); if (!P.given) P.volume = P.cells.length * L.cell * L.cell * Math.max(.4, Math.min(1.2, (L.b1 - L.b0) * .35)); ev('pocket', P.pos, { volume: P.volume, layer: LAY[P.layer].id, void: P.cells.length * L.cell * L.cell }); }
    }
  }

  // ------------------------------------------------------------------ stigmergy marks and relay beacons
  const markable = new Uint8Array(total);
  if (cfg.stigmergy) {
    if (cfg.stigmergy.at === 'portals' || !cfg.stigmergy.at) for (const [a, b] of portalList) { markable[a] = 1; markable[b] = 1; }
    if (cfg.stigmergy.at === 'trunks' || cfg.stigmergy.at === 'junctions') {
      for (let l = 0; l < NL; l++) { const L = LAY[l]; if (cfg.stigmergy.layers && !cfg.stigmergy.layers.includes(L.id)) continue;
        for (let c = 0; c < L.nx * L.nz; c++) { const g = L.off + c; if (!srch[g]) continue; const i = c % L.nx, k = (c / L.nx) | 0;
          if (cfg.stigmergy.at === 'trunks') { let ob = 0; for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, kk = k + dk; if (ii >= 0 && kk >= 0 && ii < L.nx && kk < L.nz && typ[L.off + kk * L.nx + ii] === 1) ob++; } if (ob === 1 && ((i * 7 + k * 13) % 3 === 0)) markable[g] = 1; }
          else { let op = 0; for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, kk = k + dk; if (ii >= 0 && kk >= 0 && ii < L.nx && kk < L.nz && trav[L.off + kk * L.nx + ii]) op++; }
            // junction: open cell whose 5x5 neighbourhood opens in 3+ directions
            if (op >= 3) { let arms = 0; for (const [di, dk] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { const ii = i + di, kk = k + dk; if (ii >= 0 && kk >= 0 && ii < L.nx && kk < L.nz && trav[L.off + kk * L.nx + ii]) arms++; } if (arms >= 3) markable[g] = 1; } } } }
    }
  }
  function stigmergy(d) {
    if (!cfg.stigmergy || d.st !== ST.SEARCH) return;
    const L = LAY[d.li], c = cellAt(L, d.x, d.z); if (c < 0) return; const g = L.off + c;
    if (markable[g]) {
      let near = false; for (const m of marks) if (m.li === d.li && (m.x - d.x) ** 2 + (m.z - d.z) ** 2 < (cfg.stigmergy.spacing ?? 7) ** 2) { near = true; break; }
      if (!near && marks.length < 500) { marks.push({ t: tick, x: cx(g), y: L.outdoor ? L.y + 1.2 : L.y + .9, z: cz(g), li: d.li, layer: L.id, drone: d.i, kind: cfg.stigmergy.kind || 'uv' }); }
    }
    for (let m = 0; m < marks.length; m++) { const mk = marks[m]; if (mk.li === d.li && (mk.x - d.x) ** 2 + (mk.z - d.z) ** 2 < 49) d.readMarks[m & 511] = 1; }
  }
  function relayLogic(d) {
    if (!cfg.relay || d.st !== ST.SEARCH || LAY[d.li].outdoor) return;
    // the link back to the mesh is about to break: drop a beacon (or, with none left, park as a relay)
    if (comp[d.i] !== comp[BASE]) return;
    // the fixed nodes (tether, base, beacons, parked relays) this drone can hear right now
    let nearest = 1e9, anchor = -1; for (let n = 0; n < N + 2 + beacons.length; n++) { if (n === d.i || comp[n] !== comp[BASE] || !nodeAlive(n) || (n < N && D[n].st !== ST.RELAY)) continue; const p = nodePos(n); const dd = Math.hypot(p.x - d.x, p.y - d.y, p.z - d.z); if (dd < nearest && dd < radio.indoor * 1.6 && radioLos(d.i, n)) { nearest = dd; anchor = n; } }
    if (anchor < 0) return;
    // about to lose it: too far, or the next corner will hide it (look ahead along the path)
    let losing = nearest > radio.indoor * (cfg.relay.at ?? .72);
    if (!losing && d.path && d.wpi < d.path.length && worldLos) { const g = d.path[Math.min(d.path.length - 1, d.wpi + 1)], ap = nodePos(anchor); const L2 = LAY[layerOf[g]]; const look = { x: cx(g), y: flyAt(L2, cx(g), cz(g)), z: cz(g) }; try { losing = !worldLos(ap, look) && Math.hypot(look.x - d.x, look.z - d.z) < 14; } catch (e) { /* ignore */ } }
    if (!losing) return;
    for (const b of beacons) if ((b.x - d.x) ** 2 + (b.z - d.z) ** 2 < 64) return;
    if (d.beacons > 0 && beacons.length < MAXB) {
      d.beacons--; const k = beacons.length; addBeaconNode(k);
      const L = LAY[d.li]; let fy = d.y - .7; if (typeof world.floorAt === 'function') { try { const f = world.floorAt(d.x, d.z); if (Number.isFinite(f) && f < d.y - .3) fy = Math.max(f + .25, d.y - 2.2); } catch (e) { /* ignore */ } } const b = { k, x: d.x, y: fy, z: d.z, li: d.li, t: tick, drone: d.i };
      beacons.push(b);
      // the beacon knows what its drone knew; it serves as a relay from now on
      const nb = B0 + k; for (let q = 0; q < logN[d.i]; q++) learn(nb, logA[d.i][q]); cur[d.i * NM + nb] = logN[d.i]; cur[nb * NM + d.i] = logN[nb];
      ev('beacon', b, { drone: d.i, k });
      if (cfg.stigmergy && cfg.stigmergy.kind === 'rfid') marks.push({ t: tick, x: b.x, y: b.y, z: b.z, li: d.li, layer: L.id, drone: d.i, kind: 'rfid' });
    } else if (cfg.relay.park && D.filter((o) => o.st === ST.RELAY).length < (cfg.relay.maxParked ?? 3)) {
      d.st = ST.RELAY; d.path = null; d.claim = null; ev('relay', d, { drone: d.i });
    }
  }

  // ------------------------------------------------------------------ main loop
  ev('start', basePos);
  let completeEv = false, eta = cfg.vicsek?.eta0 ?? .9, readout = 0, phiPrev = 0, prevSpeed = 0, endT = -1;
  const phiTarget = cfg.vicsek?.target ?? .62;
  const transitTo = v3(cfg.transit?.to) || null;
  const heads = new Float32Array(N), idx = new Int32Array(N);
  let tSlice = performance.now();
  let departed = false;
  const goT = Math.max(...D.map((d) => d.launchAt)) + Math.round(Math.max(8, transitAlt / 3) / dt) + 4;
  let lastPhase = 'launch';
  const fieldEvery = 10;
  while (tick < MAXT) {
    // ---------------- environment agents
    // tether: rises on its cable at the start, a small sway, it is a mesh node
    const tRise = Math.round((cfg.tether?.rise ?? 4) / dt), tDur = Math.round((cfg.tether?.riseDur ?? 30) / dt);
    let st0 = tStation;
    if (cfg.tether?.boat != null && boats[cfg.tether.boat]) { const b = boats[cfg.tether.boat]; st0 = { x: b.x, y: b.y + 1.2, z: b.z }; }
    const up = clamp((tick - tRise) / tDur);
    const hov = cfg.tether?.boat != null ? { x: st0.x + (tHover.x - tStation.x), y: tHover.y, z: st0.z + (tHover.z - tStation.z) } : tHover;
    const e = up * up * (3 - 2 * up);
    tether.x = st0.x + (hov.x - st0.x) * e + Math.sin(tick * .05) * .6 * e; tether.y = st0.y + .6 + (hov.y - st0.y - .6) * e + Math.sin(tick * .031) * .3 * e; tether.z = st0.z + (hov.z - st0.z) * e + Math.cos(tick * .043) * .6 * e;
    tether.up = up; tether.h = Math.sin(tick * .01) * .4; tether.st = up >= 1 ? 1 : up > 0 ? .5 : 0;
    if (up > 0 && !tether.evUp) { tether.evUp = 1; ev('tether_rise', tether); }
    if (up >= 1 && !tether.evDone) { tether.evDone = 1; ev('tether_up', tether); }
    tether.sx = st0.x; tether.sy = st0.y; tether.sz = st0.z;
    // UGVs drive their routes and park
    for (const u of ugvs) {
      if (tick < u.start || u.parked) { u.st = u.parked ? 2 : 0; continue; }
      u.st = 1; let step = u.speed * dt;
      while (step > 0 && u.seg < u.route.length - 1) {
        const p = u.route[u.seg + 1], dx = p.x - u.x, dz = p.z - u.z, dd = Math.hypot(dx, dz);
        if (dd < 1e-6) { u.seg++; continue; }
        u.h += angDiff(u.h, Math.atan2(dz, dx)) * .35;
        if (dd <= step) { u.x = p.x; u.z = p.z; u.y = p.y; u.seg++; step -= dd; } else { u.x += dx / dd * step; u.z += dz / dd * step; u.y += (p.y - u.y) * (step / dd); step = 0; }
      }
      if (u.seg >= u.route.length - 1) { u.parked = true; u.st = 2; ev('ugv_park', u, { ugv: u.k }); }
    }
    if (tick % 10 === 0) for (const u of ugvs) { let n = 0; for (let q = 0; q < u.regionN; q++) if (firstSeen[u.region[q]] > tick) n++; u.unk = n; }
    // boats: go to confirmed finds through water the swarm has searched, avoiding hazards
    for (const b of boats) {
      if (b.drift && tick < b.drift.until) { b.x += Math.cos(b.drift.dir) * b.drift.k * dt; b.z += Math.sin(b.drift.dir) * b.drift.k * dt; b.path = b.job ? null : b.path; }
      if (!b.job) {
        const f = finds.find((q) => !q.boat && LAY[layerById(q.layer)]?.outdoor);
        if (f && boats.indexOf(b) !== (cfg.tether?.boat ?? -1)) {
          f.boat = b.k + 1; b.job = f;
          const L = LAY[layerById(f.layer)], passable = new Uint8Array(total);
          for (let c = 0; c < L.nx * L.nz; c++) { const g = L.off + c; passable[g] = (typ[g] === 3 && firstSeen[g] <= tick) ? 1 : 0; }
          for (let c = 0; c < L.nx * L.nz; c++) { const g = L.off + c; if (typ[g] === 4) { const i = c % L.nx, k = (c / L.nx) | 0; for (let dk = -2; dk <= 2; dk++) for (let di = -2; di <= 2; di++) { const ii = i + di, kk = k + dk; if (ii >= 0 && kk >= 0 && ii < L.nx && kk < L.nz) passable[L.off + kk * L.nx + ii] = 0; } } }
          const s = cellAt(L, b.x, b.z); const sg = s >= 0 ? L.off + s : -1; if (sg >= 0) passable[sg] = 1;
          let goal = -1; const fx = f.pos[0], fz = f.pos[2];
          if (sg >= 0) bfs(sg, (g) => { if (Math.hypot(cx(g) - fx, cz(g) - fz) < L.cell * 2.6) { goal = g; return true; } return false; }, total, passable);
          if (goal >= 0) { b.path = waypoints(pathTo(goal)); b.wpi = 0; b.st = 1; ev('boat_go', b, { boat: b.k, find: finds.indexOf(f) }); }
          else { b.job = null; f.boat = 0; f.boatTry = (f.boatTry || 0) + 1; if (f.boatTry > 40) f.boat = -1; }
        }
      }
      if (b.path) {
        const g = b.path[b.wpi]; if (g == null) { b.path = null; }
        else {
          const dx = cx(g) - b.x, dz = cz(g) - b.z, dd = Math.hypot(dx, dz), step = (cfg.boatSpeed ?? 3.5) * dt; b.h += angDiff(b.h, Math.atan2(dz, dx)) * .3;
          if (dd <= step) { b.x = cx(g); b.z = cz(g); b.wpi++; if (b.wpi >= b.path.length) { b.path = null; if (b.job && b.st === 1) { b.st = 2; b.wait = tick + Math.round(20 / dt); ev('pickup', b, { boat: b.k, count: b.job.count || 1, cand: b.job.cand }); } else if (b.st === 3) { b.st = 0; b.job = null; } } }
          else { b.x += dx / dd * step; b.z += dz / dd * step; }
        }
      }
      if (b.st === 2 && tick >= b.wait) { b.st = 3; b.job.picked = true; b.job = { ...b.job, ret: true }; const L = LAY[mainL]; const s = cellAt(L, b.x, b.z), h0 = cellAt(L, b.home.x, b.home.z);
        if (s >= 0 && h0 >= 0) { const passable = new Uint8Array(total); for (let c = 0; c < L.nx * L.nz; c++) { const g = L.off + c; passable[g] = typ[g] === 3 ? 1 : 0; } passable[L.off + s] = 1; passable[L.off + h0] = 1;
          if (bfs(L.off + s, (g) => g === L.off + h0, total, passable) >= 0) { b.path = waypoints(pathTo(L.off + h0)); b.wpi = 0; } else { b.st = 0; b.job = null; } } else { b.st = 0; b.job = null; } }
      if (b.st === 0 && !b.path && cfg.tether?.boat === boats.indexOf(b) && front && front.on && !front.done) {
        // the mast boat keeps pace behind the front so the mesh reaches it
        const want = { x: front.c.x + front.dir.x * (front.s - (cfg.front?.mastBehind ?? 70)), z: front.c.z + front.dir.z * (front.s - (cfg.front?.mastBehind ?? 70)) };
        const L = LAY[mainL]; const c = cellAt(L, want.x, want.z);
        if (c >= 0 && typ[L.off + c] === 3) { const dx = want.x - b.x, dz = want.z - b.z, dd = Math.hypot(dx, dz); if (dd > 1) { const s = Math.min(dd, 2.2 * dt); b.x += dx / dd * s; b.z += dz / dd * s; b.h += angDiff(b.h, Math.atan2(dz, dx)) * .2; } }
      }
    }

    // ---------------- drones
    let nTransit = 0;
    for (const d of D) {
      d.flags = 0; d.recv = 0;
      if (d.st === ST.IDLE) { if (tick >= d.launchAt) { d.st = ST.LAUNCH; if (d.i === 0) ev('launch', d); } else continue; }
      if (d.st === ST.DEAD) { const L = LAY[d.li]; d.y = Math.max(L.y + .2, d.y - 2.2 * dt); continue; }
      if (d.st === ST.LANDED) continue;
      // battery
      d.bat = Math.max(0, d.bat - dt * (cfg.battery?.drain ?? 1 / 2400) * (d.st === ST.RELAY ? .5 : 1));
      const L = LAY[d.li];
      if (d.st === ST.LAUNCH) {
        const ty = transitTo ? Math.max(transitAlt, L.fly) : L.fly; easeY(d, ty, 3);
        if (transitTo && d.y > basePos.y + 4) {
          // wait above the van in a slow loose circle until the last drone is up, then leave together
          const a = Math.atan2(d.z - basePos.z, d.x - basePos.x) + .045, rr = 7 + (d.i % 4) * 2.2;
          const tx = basePos.x + Math.cos(a) * rr, tz = basePos.z + Math.sin(a) * rr; d.h += angDiff(d.h, Math.atan2(tz - d.z, tx - d.x)) * .3;
          d.x += (tx - d.x) * .25; d.z += (tz - d.z) * .25;
        }
        if (Math.abs(d.y - ty) < .5 && (!transitTo || tick >= goT)) { if (transitTo && !departed) { departed = true; ev('depart', d); } if (transitTo) d.st = ST.TRANSIT; else if (front) d.st = ST.FRONT; else d.st = ST.SEARCH; d.replanAt = 0; d.nh = transitTo ? Math.atan2(transitTo.z - d.z, transitTo.x - d.x) : d.h; d.h = d.nh; }
      } else if (d.st === ST.TRANSIT) {
        nTransit++;
        // Vicsek: the mean heading of neighbours within r, a pull to the destination, and noise η held near threshold
        let sx = 0, sz = 0;
        for (const o of D) { if (o.st !== ST.TRANSIT) continue; const dd = (o.x - d.x) ** 2 + (o.z - d.z) ** 2; if (dd < (cfg.vicsek?.r ?? 16) ** 2) { sx += Math.cos(o.h); sz += Math.sin(o.h); } }
        const ga = Math.atan2(transitTo.z - d.z, transitTo.x - d.x), gw = cfg.vicsek?.goal ?? 1.2;
        sx += Math.cos(ga) * gw; sz += Math.sin(ga) * gw;
        let a = Math.atan2(sz, sx) + (R() - .5) * eta;
        if (d.swerve > 0) { a = d.h; d.swerve--; }
        d.nh = a;
        const dist = Math.hypot(transitTo.x - d.x, transitTo.z - d.z);
        if (dist < (cfg.transit?.arrive ?? 30) + (d.i % 5) * 3) { d.st = ST.SEARCH; d.replanAt = 0; if (!events.some((x) => x.type === 'arrive')) ev('arrive', d); }
      } else if (d.st === ST.FRONT) {
        nTransit++;
      } else if (d.st === ST.EVADE) {
        if (d.path) { follow(d, L.outdoor ? spd.outdoor : spd.indoor * 1.6); }
        else { d.x += d.vx * dt; d.z += d.vz * dt; d.vx *= .82; d.vz *= .82; const c = cellAt(L, d.x, d.z); if (c < 0 || !trav[L.off + c]) { d.x -= d.vx * dt * 2; d.z -= d.vz * dt * 2; } }
        easeY(d, desiredY(d));
        if (tick >= d.hold && (!d.path || d.wpi >= d.path.length)) { d.st = ST.SEARCH; d.path = null; d.replanAt = 0; }
      } else if (d.st === ST.SEARCH) {
        if (!d.path || d.wpi >= d.path.length || tick >= d.replanAt || (d.target >= 0 && known[d.i][d.target])) {
          if (!plan(d)) { d.path = null; d.claim = null; d.idle = (d.idle || 0) + 1; d.replanAt = tick + Math.min(12, 2 + d.idle); if (d.idle > 6 && completeT >= 0) { d.st = ST.RETURN; d.path = null; } }
          else d.idle = 0;
        }
        if (d.path) follow(d, L.outdoor ? spd.outdoor : spd.indoor);
        easeY(d, desiredY(d));
      } else if (d.st === ST.CONVERGE || d.st === ST.CONFIRM) {
        d.flags |= FLAG.CONV;
        if (d.path && d.wpi < d.path.length) follow(d, L.outdoor ? spd.outdoor * .8 : spd.indoor);
        else if (d.conv) { const C = d.conv, a = Math.atan2(d.z - C.pos.z, d.x - C.pos.x) + .012 * (d.slot % 2 ? 1 : -1); const r = Math.hypot(d.x - C.pos.x, d.z - C.pos.z); const nx = C.pos.x + Math.cos(a) * r, nz = C.pos.z + Math.sin(a) * r; const c = cellAt(L, nx, nz); if (L.outdoor && c >= 0 && trav[L.off + c]) { d.h = a + Math.PI / 2; d.x = nx; d.z = nz; } else d.h += angDiff(d.h, Math.atan2(C.pos.z - d.z, C.pos.x - d.x)) * .2; }
        easeY(d, d.st === ST.CONFIRM && L.outdoor ? L.y + 3.2 : desiredY(d));
      } else if (d.st === ST.RELAY) {
        easeY(d, L.outdoor ? L.fly : L.y + 1.4); d.h += .01;
      } else if (d.st === ST.RETURN) {
        if (!d.path) { if (!planTo(d, baseG)) { d.path = []; } }
        const done = follow(d, L.outdoor ? spd.transit * .6 : spd.indoor * 1.4);
        const near = Math.hypot(d.x - basePos.x, d.z - basePos.z);
        if (done || near < 3) {
          const a = (d.i / N) * TAU, r = 1 + (d.i % 3) * .5; const tx = basePos.x + Math.cos(a) * r, tz = basePos.z + Math.sin(a) * r;
          d.x += (tx - d.x) * .3; d.z += (tz - d.z) * .3; easeY(d, basePos.y + .3, 2.5);
          if (Math.abs(d.y - basePos.y - .3) < .2) { d.st = ST.LANDED; if (D.every((o) => o.st === ST.LANDED || o.st === ST.DEAD)) { ev('landed', basePos); endT = tick + 10; } }
        } else easeY(d, near < 25 ? Math.max(L.fly, basePos.y + 6) : Math.max(L.fly, L.outdoor ? L.fly + 6 : L.fly));
      }
      if (!LAY[d.li].outdoor) d.flags |= FLAG.INDOOR;
    }
    // transit / front: synchronous heading update, then move
    if (nTransit) {
      for (const d of D) {
        if (d.st === ST.TRANSIT) { if (Number.isFinite(d.nh)) d.h = d.nh; d.x += Math.cos(d.h) * spd.transit * dt; d.z += Math.sin(d.h) * spd.transit * dt; easeY(d, transitAlt + ((d.i % 5) - 2) * 1.2); const c = cellAt(LAY[d.li], d.x, d.z); if (c >= 0 && trav[LAY[d.li].off + c]) d.gid = LAY[d.li].off + c; }
      }
    }
    if (front) stepFront();
    // gusts push drones flying in the open
    if (gust) {
      const a = (tick - gust.t0) / gust.dur; if (a > 1) gust = null;
      else { const k = gust.k * Math.sin(Math.PI * a) * dt; for (const d of D) { if (d.st === ST.IDLE || d.st === ST.DEAD || d.st === ST.LANDED) continue; const L = LAY[d.li]; if (gust.layers && !gust.layers.includes(L.id)) continue; if (!L.outdoor) continue;
        const nx = d.x + Math.cos(gust.dir) * k * (.7 + .6 * ((d.i * 37) % 10) / 10), nz = d.z + Math.sin(gust.dir) * k * (.7 + .6 * ((d.i * 37) % 10) / 10); const c = cellAt(L, nx, nz); if (c >= 0 && trav[L.off + c]) { d.x = nx; d.z = nz; d.gid = L.off + c; } d.h += (R() - .5) * .5 * Math.sin(Math.PI * a); } }
    }
    // separation in the open (no collisions)
    for (let a = 0; a < N; a++) { const p = D[a]; if (!LAY[p.li].outdoor || p.st === ST.IDLE || p.st === ST.LANDED || p.st === ST.DEAD) continue;
      for (let b = a + 1; b < N; b++) { const q = D[b]; if (q.li !== p.li || q.st === ST.IDLE || q.st === ST.LANDED || q.st === ST.DEAD) continue; const dx = q.x - p.x, dz = q.z - p.z, d2 = dx * dx + dz * dz; if (d2 < 9 && d2 > 1e-6) { const d1 = Math.sqrt(d2), push = (3 - d1) * .25; p.x -= dx / d1 * push; p.z -= dz / d1 * push; q.x += dx / d1 * push; q.z += dz / d1 * push; } } }

    // ---------------- sensing, mesh, sync, physics
    for (const d of D) if (d.st === ST.SEARCH || d.st === ST.CONVERGE || d.st === ST.CONFIRM || d.st === ST.EVADE || d.st === ST.FRONT || d.st === ST.RETURN || d.st === ST.RELAY) sense(d);
    detect();
    mesh();
    sync();
    for (const d of D) {
      if (d.st === ST.IDLE || d.st === ST.DEAD || d.st === ST.LANDED) continue;
      const inRoot = comp[d.i] === comp[BASE] || comp[d.i] === comp[TETHER];
      if (!inRoot) { d.flags |= FLAG.OUT; if (d.outSince < 0) d.outSince = tick; }
      else { if (d.outSince >= 0 && tick - d.outSince > 16 && d.recv > 20) { d.flags |= FLAG.MERGE; ev('merge', d, { drone: d.i, cells: d.recv, away: (tick - d.outSince) * dt }); } else if (d.outSince >= 0 && tick - d.outSince > 30 && !events.some((x) => x.type === 'out' && x.drone === d.i && tick - x.t < 200)) {} d.outSince = -1; }
      if (d.outSince >= 0 && tick - d.outSince === 24) ev('out', d, { drone: d.i });
      stigmergy(d); relayLogic(d);
    }
    for (const C of cands) stepCand(C);
    convergeLogic();
    disturb();
    koopman();
    if (tick % 2 === 0 || tick < 4) topo();
    pocketCheck();
    // ---------------- completion
    // a search that has nearly finished but stopped finding anything new for five minutes ends too: what is left is
    // reported as out of the drones' reach (it never happens in a normal run; it keeps a rare world from running forever)
    if (covered !== lastCov) { lastCov = covered; lastCovT = tick; }
    const stalled = covered > nSearch * .96 && tick - lastCovT > Math.round(300 / dt);
    if (completeT < 0 && (beta0 === 0 || stalled) && covered > nSearch * .5 && D.every((d) => d.st !== ST.CONVERGE && d.st !== ST.CONFIRM) && cands.every((C) => C.state !== 'signal' || C.kind !== 'person')) {
      completeT = tick; unreached = beta0 === 0 ? 0 : nSearch - covered; ev('complete', basePos, { coverage: covered / nSearch, unreached });
      for (const d of D) if (d.st !== ST.DEAD && d.st !== ST.IDLE && d.st !== ST.LANDED) { d.st = ST.RETURN; d.path = null; d.conv = null; d.claim = null; }
      for (const b of beacons) b.done = true;
    }

    // ---------------- metrics
    let n = 0, sx = 0, sz = 0;
    for (const d of D) if (d.st === ST.TRANSIT || d.st === ST.FRONT) { idx[n] = d.i; heads[d.i] = d.h; n++; }
    let phi = 0; if (n >= 3) { for (let q = 0; q < n; q++) { sx += Math.cos(D[idx[q]].h); sz += Math.sin(D[idx[q]].h); } phi = Math.hypot(sx, sz) / n; }
    // local alignment of everyone airborne (used for recovery after a disturbance)
    let pl = 0, pn = 0, spdSum = 0;
    for (const d of D) {
      if (d.st === ST.IDLE || d.st === ST.DEAD || d.st === ST.LANDED || d.st === ST.RELAY) continue;
      let ax = 0, az = 0, c = 0; for (const o of D) { if (o.st === ST.IDLE || o.st === ST.DEAD || o.st === ST.LANDED) continue; if ((o.x - d.x) ** 2 + (o.z - d.z) ** 2 < 400) { ax += Math.cos(o.h); az += Math.sin(o.h); c++; } }
      if (c > 1) { pl += Math.hypot(ax, az) / c; pn++; }
      const vv = Math.hypot(d.x - (d.px ?? d.x), d.z - (d.pz ?? d.z)) / dt; spdSum += vv; d.px = d.x; d.pz = d.z;
    }
    const phiL = pn ? pl / pn : 0;
    if (n >= 3) eta = clamp(eta + (phi - phiTarget) * (cfg.vicsek?.gain ?? .12), .2, 3.8);
    // reservoir: a linear readout of the swarm's own motion (no accelerometer data): spikes when something shakes it
    const meanSpd = spdSum / Math.max(1, pn), dS = Math.abs(meanSpd - prevSpeed), dP = Math.abs(phiL - phiPrev);
    readout = readout * .82 + (dS * .55 + dP * 4.2 + (shock > .5 ? .9 : 0)) * .18; shock *= .5; prevSpeed = meanSpd; phiPrev = phiL;
    // spacing CV (front / searching outdoor drones)
    let cv = 0; { const P = D.filter((d) => (d.st === ST.FRONT || d.st === ST.SEARCH) && LAY[d.li].outdoor); if (P.length > 3) { const nn = P.map((p) => { let b = 1e9; for (const q of P) if (q !== p) b = Math.min(b, Math.hypot(q.x - p.x, q.z - p.z)); return b; }); const m = nn.reduce((a, b) => a + b, 0) / nn.length; cv = Math.sqrt(nn.reduce((a, b) => a + (b - m) ** 2, 0) / nn.length) / Math.max(1e-6, m); } }
    // mesh: size of the component holding the base, whether all its maps agree (every link's deltas delivered)
    let meshN = 0, pending = 0, air = 0, inR = 0;
    for (const d of D) { if (d.st === ST.IDLE || d.st === ST.DEAD || d.st === ST.LANDED) continue; air++; if (comp[d.i] === comp[BASE]) { meshN++; inR++; } }
    for (let q = 0; q < linksNow.length; q += 2) { const a = linksNow[q], b = linksNow[q + 1]; if (comp[a] !== comp[BASE]) continue; pending += (logN[a] - cur[a * NM + b]) + (logN[b] - cur[b * NM + a]); }
    const focusC = [...cands].reverse().find((C) => C.state !== 'closed' || tick - (C.relT ?? tick) < 30) || cands[cands.length - 1];
    if (tick >= cap) grow();
    M.coverage[tick] = covered / Math.max(1, nSearch); M.phi[tick] = phi; M.phiL[tick] = phiL; M.eta[tick] = eta; M.beta0[tick] = beta0; M.frontier[tick] = frontierLen;
    { let lo = 1e9, hi = 0; for (const d of D) { if (d.st === ST.IDLE || d.st === ST.DEAD || d.st === ST.LANDED || comp[d.i] !== comp[BASE]) continue; lo = Math.min(lo, ownCount[d.i]); hi = Math.max(hi, ownCount[d.i]); } M.agree[tick] = hi > 0 ? lo / hi : 1; }
    M.meshSize[tick] = meshN; M.identical[tick] = pending === 0 && meshN > 0 ? 1 : 0; M.pending[tick] = pending; M.bytes[tick] = bytesTick / dt / Math.max(1, air); M.cv[tick] = cv; M.readout[tick] = readout;
    M.h[tick] = focusC ? focusC.h : 0; M.x[tick] = focusC ? focusC.x : -1; M.mode[tick] = focusC ? focusC.mode : 0; M.inRange[tick] = air ? inR / air : 1; M.airborne[tick] = air; M.commands[tick] = 0;
    for (let k = 0; k < 3; k++) M[['teamA', 'teamB', 'teamC'][k]][tick] = D.filter((d) => d.team === k && (d.st === ST.SEARCH || d.st === ST.CONVERGE || d.st === ST.CONFIRM)).length;
    for (let l = 0; l < NL; l++) b0L[l][tick] = beta0Layer[l];
    M.fieldOn[tick] = front && front.on && !front.done ? 1 : 0;
    // record agents
    for (const d of D) {
      const o = (tick * N + d.i) * DR;
      drec[o] = d.x; drec[o + 1] = d.y; drec[o + 2] = d.z; drec[o + 3] = d.h; drec[o + 4] = d.st; drec[o + 5] = d.bat; drec[o + 6] = d.li; drec[o + 7] = d.team; drec[o + 8] = d.flags; drec[o + 9] = ownCount[d.i] / Math.max(1, nSearch);
    }
    let ak = 0;
    for (const u of ugvs) { const o = (tick * NA + ak++) * AR; arec[o] = u.x; arec[o + 1] = u.y; arec[o + 2] = u.z; arec[o + 3] = u.h; arec[o + 4] = u.st; }
    for (const b of boats) { const o = (tick * NA + ak++) * AR; arec[o] = b.x; arec[o + 1] = b.y; arec[o + 2] = b.z; arec[o + 3] = b.h; arec[o + 4] = b.st; }
    { const o = (tick * NA + ak++) * AR; arec[o] = tether.x; arec[o + 1] = tether.y; arec[o + 2] = tether.z; arec[o + 3] = tether.h; arec[o + 4] = tether.st; }
    { const o = (tick * NA + ak++) * AR; arec[o] = tether.sx; arec[o + 1] = tether.sy; arec[o + 2] = tether.sz; arec[o + 3] = 0; arec[o + 4] = 0; }
    linkOff.push(nLink);
    if (front && tick % fieldEvery === 0 && front.on) fieldSnaps.push({ t: tick, data: gsF.snapshot(), frame: frameOf() });
    if (cfg.inspect) cfg.inspect(tick, { D, LAY, firstSeen, srch, known, trav, typ, layerOf, cx, cz, portal, beta0Layer, cands, ugvs, reach });
    tick++;
    if (endT >= 0 && tick >= endT) break;
    if (performance.now() - tSlice > sliceOf()) {
      const p = completeT >= 0 ? .85 + .15 * (D.filter((d) => d.st === ST.LANDED || d.st === ST.DEAD).length / N) : Math.min(.85, Math.max(.85 * Math.pow(covered / Math.max(1, nSearch), 1.4), Math.min(.25, tick / 1200)));
      yield { p, tick };
      tSlice = performance.now();
    }
  }

  function stepFront() {
    // the front: drones hold a line that advances across the area; each climbs the Turing field along the line and
    // keeps its neighbours at arm's length, so the line settles into even lanes; headings follow Vicsek alignment
    const F = front;
    const onFront = D.filter((d) => d.st === ST.FRONT);
    if (!F.on && onFront.length >= Math.min(N, 4)) { F.on = true; F.t0 = tick; ev('front', { x: F.c.x + F.dir.x * F.s, y: 0, z: F.c.z + F.dir.z * F.s }); }
    if (!F.on) { for (const d of onFront) { d.h += angDiff(d.h, Math.atan2(F.dir.z, F.dir.x)) * .1; } return; }
    if (!F.done) {
      const lagging = onFront.length ? onFront.reduce((a, d) => a + ((d.x - F.c.x) * F.dir.x + (d.z - F.c.z) * F.dir.z), 0) / onFront.length : F.s;
      F.s += F.speed * dt * clamp(1 - (F.s - lagging - 10) / 30, .2, 1);
      // sources: the boats and the tethered drone keep spots alive where they are (in the front's frame)
      const fr = frameOf(); gsF.src = [];
      for (const b of boats) { const u = ((b.x - fr.ox) * fr.ux + (b.z - fr.oz) * fr.uz) / fr.su, v = ((b.x - fr.ox) * fr.vx + (b.z - fr.oz) * fr.vz) / fr.sv; if (u >= 0 && v >= 0 && u < F.w && v < F.h) gsF.src.push({ x: u | 0, y: v | 0, r: 1 }); }
      gsF.step(2);
      if (F.s >= F.s1) { F.done = true; ev('front_done', { x: F.c.x + F.dir.x * F.s, y: 0, z: F.c.z + F.dir.z * F.s }); for (const d of onFront) { d.st = ST.SEARCH; d.path = null; d.replanAt = 0; } return; }
    }
    const fr = frameOf();
    for (const d of onFront) {
      // Vicsek heading among front drones
      let sx = Math.cos(Math.atan2(F.dir.z, F.dir.x)) * (cfg.vicsek?.goal ?? 1), sz = Math.sin(Math.atan2(F.dir.z, F.dir.x)) * (cfg.vicsek?.goal ?? 1);
      for (const o of onFront) { const dd = (o.x - d.x) ** 2 + (o.z - d.z) ** 2; if (dd < (cfg.vicsek?.r ?? 90) ** 2) { sx += Math.cos(o.h); sz += Math.sin(o.h); } }
      d.nh = Math.atan2(sz, sx) + (R() - .5) * eta;
      if (d.swerve > 0) { d.nh = d.h; d.swerve--; }
    }
    for (const d of onFront) {
      if (Number.isFinite(d.nh)) d.h = d.nh;
      const L = LAY[d.li];
      const u = ((d.x - fr.ox) * fr.ux + (d.z - fr.oz) * fr.uz) / fr.su, along = (d.x - F.c.x) * F.dir.x + (d.z - F.c.z) * F.dir.z;
      const v = clamp((along - (F.s - F.depth * .5)) / fr.sv, 0, F.h - 1);
      const g = (gsF.sample(u + .7, v) - gsF.sample(u - .7, v)) / 1.4;
      // the field pulls a drone onto the nearest spot (gently); neighbours closer than the spacing push it away (firmly),
      // so each spot ends up with one drone and the line spreads to its full width
      let lx = clamp(g * (cfg.turing?.climb ?? 260), -1.3, 1.3), rep = 0;
      for (const o of onFront) { if (o === d) continue; const du = ((o.x - d.x) * F.lat.x + (o.z - d.z) * F.lat.z); const dv = Math.abs((o.x - d.x) * F.dir.x + (o.z - d.z) * F.dir.z); const sp = (cfg.front.spacing ?? 50) * 1.2; if (Math.abs(du) < sp && dv < 60) rep -= Math.sign(du || (d.i - o.i)) * Math.pow((sp - Math.abs(du)) / sp, .7) * 7.5; }
      // stay inside the width
      const latPos = (d.x - F.c.x) * F.lat.x + (d.z - F.c.z) * F.lat.z, half = F.width * .5 - 8;
      if (latPos > half) rep -= (latPos - half) * .4; if (latPos < -half) rep += (-half - latPos) * .4;
      const vAlong = F.speed + (F.s - along) * .12;
      const hv = spd.outdoor * .55;
      const vx = F.dir.x * vAlong + F.lat.x * (lx + rep) + Math.cos(d.h) * hv * .35, vz = F.dir.z * vAlong + F.lat.z * (lx + rep) + Math.sin(d.h) * hv * .35;
      const vm = Math.hypot(vx, vz), cap2 = spd.outdoor * 1.4, sc = vm > cap2 ? cap2 / vm : 1;
      const nx = d.x + vx * sc * dt, nz = d.z + vz * sc * dt; const c = cellAt(L, nx, nz);
      if (c >= 0 && trav[L.off + c]) { d.x = nx; d.z = nz; d.gid = L.off + c; }
      else { const c2 = cellAt(L, d.x + vx * sc * dt, d.z); if (c2 >= 0 && trav[L.off + c2]) d.x += vx * sc * dt; else { const c3 = cellAt(L, d.x, d.z + vz * sc * dt); if (c3 >= 0 && trav[L.off + c3]) d.z += vz * sc * dt; } }
      easeY(d, L.fly + ((d.i % 3) - 1) * .8);
    }
  }

  // ------------------------------------------------------------------ the tape
  const T = tick;
  const fill = (g) => { const L = LAY[layerOf[g]]; return L; };
  for (const f of forecast) { const ta = Math.min(T - 1, f.t0 + f.horizon); f.actual = M.coverage[ta]; f.tA = ta; }
  const layersOut = LAY.map((L, l) => ({ id: L.id, name: L.name, building: L.building, kind: L.kind, nx: L.nx, nz: L.nz, x0: L.x0, z0: L.z0, cell: L.cell, y: L.y, fly: L.fly, b0: L.b0, b1: L.b1, outdoor: L.outdoor, off: L.off,
    grid: typ.slice(L.off, L.off + L.nx * L.nz), srch: srch.slice(L.off, L.off + L.nx * L.nz), firstSeen: firstSeen.slice(L.off, L.off + L.nx * L.nz), nSearch: nSearchL[l] }));
  const trim = (a, n) => a.slice(0, n);
  const metrics = {}; for (const k of MK) metrics[k] = trim(M[k], T);
  const report = {
    simSeconds: T * dt, completeT, unreached, unreachedM2: LAY.reduce((a, L, l) => a + (nSearchL[l] - coveredL[l]) * L.cell * L.cell, 0), areaM2: LAY.reduce((a, L, l) => a + coveredL[l] * L.cell * L.cell, 0), coverage: covered / Math.max(1, nSearch),
    people: finds.reduce((a, f) => a + (f.count || 1), 0), finds: finds.length, rejected: events.filter((e) => e.type === 'reject').length, pockets: pockets.filter((p) => p.t >= 0).length,
    marks: marks.length, repeatsAvoided, beacons: beacons.length, dronesLost: D.filter((d) => d.st === ST.DEAD).length, drones: N,
    bytes: metrics.bytes.reduce((a, b) => a + b, 0) * dt, commands: 0, hazards: LAY.reduce((a, L, l) => { let n = 0; for (let c = 0; c < L.nx * L.nz; c++) if (typ[L.off + c] === 4 && firstSeen[L.off + c] < NEVER) n++; return a + n; }, 0),
  };
  return {
    dt, T, N, DR, AR, drones: drec.slice(0, T * N * DR), aux: { list: auxList, data: arec.slice(0, T * NA * AR) },
    linkOff: Uint32Array.from(linkOff), links: linkBuf.slice(0, nLink * 2), linkCells: linkCells.slice(0, nLink),
    nodes: { TETHER, BASE, B0 }, layers: layersOut, total, knownAt, metrics, beta0L: b0L.map((m) => trim(m, T)),
    field: front ? { w: front.w, h: front.h, snaps: fieldSnaps } : null,
    marks, events, finds, forecast, pockets: pockets.map((p) => ({ t: p.t, pos: [p.pos.x, p.pos.y, p.pos.z], volume: p.volume, name: p.name || '', layer: LAY[p.layer].id, cells: p.cells.map((g) => g - LAY[p.layer].off), encl: (p.encl || []).map((g) => g - LAY[p.layer].off) })),
    beacons: beacons.map((b) => ({ t: b.t, pos: [b.x, b.y, b.z], layer: LAY[b.li].id, drone: b.drone })),
    candidates: cands.map((C) => ({ id: C.id, kind: C.kind, pos: [C.pos.x, C.pos.y, C.pos.z], layer: LAY[C.layer].id, detT: C.detT, tipT: C.tipT ?? -1, confT: C.confT ?? -1, relT: C.relT ?? -1, label: C.src.label || '', what: C.src.kind || '' })),
    people: people.map((p) => ({ pos: [p.pos.x, p.pos.y, p.pos.z], layer: LAY[p.layer].id, count: p.count, found: p.cand ? p.cand.confT ?? -1 : -1 })),
    decoys: decoys.map((p) => ({ pos: [p.pos.x, p.pos.y, p.pos.z], layer: LAY[p.layer].id, kind: p.kind, label: p.label })),
    base: basePos, tether: { station: tStation, hover: tHover, cable: tCable }, radio, ugvParks: ugvs.map((u) => u.park), mainLayer: mainL, nSearch, report, portals: portalList.length,
    changes,
  };
}

// run the generator to completion synchronously (tests)
export function simulateSync(world, cfg) { const g = simulate(world, { ...cfg, sliceMs: 1e9 }); let r; do { r = g.next(); } while (!r.done); return r.value; }

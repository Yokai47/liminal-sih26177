/* LIMINAL · Act 2 · brain.js — the companion computer's autonomy (Raspberry Pi 5), as Layer 1 describes it.
   It sees the world ONLY through what it is given: LiDAR rays from stop-and-scan sweeps, an estimated pose,
   perception candidates and acoustic bearings. It knows nothing about rooms; it reasons about cells.
     map       2.5-D occupancy slice of the flight band (0.8–2.0 m), 0.25 m cells, log-odds (OctoMap defaults):
               hit +0.85 (p 0.7), miss −0.41 (p 0.4), clamped to [−1.99, +3.48] (p 0.12…0.97). Unknown = never observed.
     frontier  a free cell with an unknown 4-neighbour (Yamauchi 1997); clustered (8-connected).
     cost      J = travel − w·gain − acoustic prior (+ claim + swarm terms, both 0 here: a single drone)
     plan      Dijkstra over an inflated costmap → string-pulled path → pure pursuit → position setpoint
     loop      SELECT → TRANSIT → stop-and-scan → SELECT …; INVESTIGATE candidates; RTL when nothing is left or energy says so.  */
export function createBrain() {
  const RES = .25, X0 = -2, Z0 = -36, NX = 176, NZ = 152, N = NX * NZ;
  const LHIT = .85, LMISS = -.41, LMIN = -1.99, LMAX = 3.48, BAND = [.8, 2.0], R_INF = .4;
  const L = new Float32Array(N), seen = new Uint8Array(N), nHit = new Uint16Array(N), nMiss = new Uint16Array(N), touched = new Float32Array(N);
  const dObs = new Float32Array(N), dist = new Float32Array(N), par = new Int32Array(N), fr = new Uint8Array(N), clusterOf = new Int32Array(N);
  const mark = new Uint8Array(N); let markList = [];   // per-sweep marks: 1 = ray passed through, 2 = ray ended here (hit)
  const gx = x => Math.floor((x - X0) / RES), gz = z => Math.floor((z - Z0) / RES), id = (i, j) => j * NX + i;
  const cxOf = i => X0 + (i + .5) * RES, czOf = j => Z0 + (j + .5) * RES;
  const occ = c => seen[c] && L[c] > 0, free = c => seen[c] && L[c] <= 0;

  const B = {
    state: 'IDLE', mode: 'AUTO', t: 0, log: [], why: [], clusters: [], goal: null, path: [], pathLen: 0, sweep: false, scanT: 0, scanDur: 2.5,
    yaw0: 0, home: { x: 0, z: 0 }, lastScan: null, distSinceScan: 0, blacklist: [], replanT: 0, stuckT: 0, stuckRef: null, transitT: 0,
    stats: { occ: 0, free: 0, unk: N, frontiers: 0, cellUpdates: 0, sweeps: 0, rays: 0, plans: 0, lastSweepUpd: 0, lastSweepRays: 0, coverage: 0 },
    inv: null, investigated: new Set(), advisory: null, landT: 0, done: false, reason: '', lastSelectT: -9, holdT: 0, rtlWhy: '', sweepStats: { rays: 0, upd: 0, hit: 0, miss: 0 },
    tracks: [], trackNotes: {}, setpoint: null, yawT: null, yawRate: 0, vmax: 1.2, lastBest: null, energy: null,
  };
  const log = (tag, text, cls = '') => { B.log.push({ t: B.t, tag, text, cls }); if (B.log.length > 4000) B.log.shift(); };
  const f1 = v => v.toFixed(1), f2 = v => v.toFixed(2), deg = r => ((r * 180 / Math.PI) % 360 + 360) % 360;
  const EN = (x, z) => `(${f1(x - B.home.x)}, ${f1(-(z - B.home.z))})`;   // map frame: ENU metres from home

  function reset(home) {
    L.fill(0); seen.fill(0); nHit.fill(0); nMiss.fill(0); touched.fill(-1); mark.fill(0); markList = [];
    Object.assign(B, { state: 'INIT', t: 0, log: [], why: [], clusters: [], goal: null, path: [], sweep: false, scanT: 0, home: { x: home.x, z: home.z }, lastScan: null, distSinceScan: 0,
      blacklist: [], replanT: 0, stuckT: 0, inv: null, investigated: new Set(), advisory: null, landT: 0, done: false, reason: '', holdT: 0, rtlWhy: '', initT: 0, armed: false, visited: [], forceHome: false,
      stats: { occ: 0, free: 0, unk: N, frontiers: 0, cellUpdates: 0, sweeps: 0, rays: 0, plans: 0, lastSweepUpd: 0, lastSweepRays: 0, coverage: 0 }, setpoint: null, yawT: null, lastBest: null, trackNotes: {} });
    log('BOOT', 'ROS 2 graph up · MAVROS2 ↔ V6X link OK · EKF3 origin set (home = map origin)');
  }

  // ---------------- map insertion (called per LiDAR ray during a sweep) ----------------
  function insertRay(ox, oy, oz, dx, dy, dz, tHit, maxR) {
    // Rays are only MARKED here; the sweep is committed once at its end (OctoMap's discretized insert:
    // each cell is updated at most once per scan, and "hit" wins over "passed through" in the same scan).
    const h = Math.hypot(dx, dz); if (h < 1e-4) return;
    let tExit = Infinity; if (dy > 1e-6) tExit = (BAND[1] - oy) / dy; else if (dy < -1e-6) tExit = (BAND[0] - oy) / dy;
    const tEnd = tHit >= 0 ? tHit : maxR, hitIn = tHit >= 0 && tHit <= tExit, tFree = Math.min(tEnd, tExit);
    const sEnd = tFree * h, ux = dx / h, uz = dz / h, sClear = hitIn ? sEnd - .3 : sEnd;   // grazing rays must not erase the wall they end on
    let i = gx(ox), j = gz(oz); const ei = gx(ox + ux * sEnd), ej = gz(oz + uz * sEnd);
    const sx = ux > 0 ? 1 : -1, sz = uz > 0 ? 1 : -1;
    let tMx = ux !== 0 ? ((X0 + (i + (sx > 0 ? 1 : 0)) * RES) - ox) / ux : Infinity, tMz = uz !== 0 ? ((Z0 + (j + (sz > 0 ? 1 : 0)) * RES) - oz) / uz : Infinity;
    const tDx = ux !== 0 ? RES / Math.abs(ux) : Infinity, tDz = uz !== 0 ? RES / Math.abs(uz) : Infinity;
    let guard = 0; B.stats.rays++; B.sweepStats.rays++;
    while (guard++ < 200) {
      if (i < 0 || j < 0 || i >= NX || j >= NZ) return;
      if (i === ei && j === ej) break;
      const c = id(i, j); const sNow = Math.min(tMx, tMz); if (sNow < sClear || !hitIn) { if (!mark[c]) markList.push(c); mark[c] |= 1; }
      if (tMx < tMz) { if (tMx > sEnd) break; tMx += tDx; i += sx; } else { if (tMz > sEnd) break; tMz += tDz; j += sz; }
    }
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return;
    const c = id(i, j); if (!mark[c]) markList.push(c); mark[c] |= hitIn ? 2 : 1;
  }
  function commitSweep() {
    let hit = 0, miss = 0;
    for (const c of markList) { if (mark[c] & 2) { L[c] = Math.min(LMAX, L[c] + LHIT); nHit[c]++; hit++; } else { L[c] = Math.max(LMIN, L[c] + LMISS); nMiss[c]++; miss++; }
      seen[c] = 1; touched[c] = B.t; mark[c] = 0; }
    markList = []; B.sweepStats.hit = hit; B.sweepStats.miss = miss; B.stats.cellUpdates += hit + miss;
  }

  // ---------------- costmap: distance to obstacles (chamfer), inflation ----------------
  function buildCost() {
    const INF = 1e9; for (let c = 0; c < N; c++) dObs[c] = occ(c) ? 0 : INF;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const c = id(i, j); let d = dObs[c];
      if (i > 0) d = Math.min(d, dObs[c - 1] + 1); if (j > 0) { d = Math.min(d, dObs[c - NX] + 1); if (i > 0) d = Math.min(d, dObs[c - NX - 1] + 1.414); if (i < NX - 1) d = Math.min(d, dObs[c - NX + 1] + 1.414); } dObs[c] = d; }
    for (let j = NZ - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) { const c = id(i, j); let d = dObs[c];
      if (i < NX - 1) d = Math.min(d, dObs[c + 1] + 1); if (j < NZ - 1) { d = Math.min(d, dObs[c + NX] + 1); if (i < NX - 1) d = Math.min(d, dObs[c + NX + 1] + 1.414); if (i > 0) d = Math.min(d, dObs[c + NX - 1] + 1.414); } dObs[c] = d; }
  }
  const lethal = c => dObs[c] * RES < R_INF;
  const cellCost = c => { const d = dObs[c] * RES; return d < R_INF ? 25 : 1 + 3.5 * Math.exp(-(d - R_INF) / .35); };
  const passable = c => free(c) && !occ(c);

  // ---------------- Dijkstra from the drone ----------------
  const heap = { k: new Float32Array(N * 4), v: new Int32Array(N * 4), n: 0 };
  const hpush = (k, v) => { let i = heap.n++; heap.k[i] = k; heap.v[i] = v; while (i > 0) { const p = (i - 1) >> 1; if (heap.k[p] <= heap.k[i]) break; [heap.k[p], heap.k[i]] = [heap.k[i], heap.k[p]]; [heap.v[p], heap.v[i]] = [heap.v[i], heap.v[p]]; i = p; } };
  const hpop = () => { const v = heap.v[0]; heap.n--; if (heap.n > 0) { heap.k[0] = heap.k[heap.n]; heap.v[0] = heap.v[heap.n]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.n && heap.k[l] < heap.k[m]) m = l; if (r < heap.n && heap.k[r] < heap.k[m]) m = r; if (m === i) break; [heap.k[m], heap.k[i]] = [heap.k[i], heap.k[m]]; [heap.v[m], heap.v[i]] = [heap.v[i], heap.v[m]]; i = m; } } return v; };
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  function dijkstra(x, z) {
    dist.fill(Infinity); par.fill(-1); heap.n = 0;
    const s = id(Math.max(0, Math.min(NX - 1, gx(x))), Math.max(0, Math.min(NZ - 1, gz(z)))); dist[s] = 0; hpush(0, s);
    while (heap.n) { const c = hpop(), d = dist[c], i = c % NX, j = (c / NX) | 0; const escaping = lethal(c) && d < 14;
      for (const [di, dj, w] of NB) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue; const n = id(ii, jj);
        if (!passable(n)) continue; if (lethal(n) && !escaping) continue; if (di && dj && (!passable(id(i + di, j)) || !passable(id(i, j + dj)))) continue;
        const nd = d + w * RES * cellCost(n); if (nd < dist[n]) { dist[n] = nd; par[n] = c; hpush(nd, n); } } }
    B.stats.plans++;
  }
  function pathTo(c) { const p = []; let k = 0; for (let u = c; u !== -1 && k < 5000; u = par[u], k++) p.unshift([cxOf(u % NX), czOf((u / NX) | 0)]); return p; }
  function losClear(a, b) { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (RES * .5)); for (let k = 1; k < n; k++) { const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n; const c = id(gx(x), gz(z)); if (!passable(c) || lethal(c)) return false; } return true; }
  function smooth(p) { if (p.length < 3) return p; const out = [p[0]]; let i = 0; while (i < p.length - 1) { let j = p.length - 1; while (j > i + 1 && !losClear(p[i], p[j])) j--; out.push(p[j]); i = j; } return out; }
  const plen = p => { let s = 0; for (let k = 1; k < p.length; k++) s += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]); return s; };

  // ---------------- frontiers ----------------
  function frontiers(pose) {
    buildCost(); dijkstra(pose.x, pose.z);
    fr.fill(0); clusterOf.fill(-1); let nf = 0, nocc = 0, nfree = 0;
    for (let j = 1; j < NZ - 1; j++) for (let i = 1; i < NX - 1; i++) { const c = id(i, j); if (!seen[c]) continue; if (L[c] > 0) { nocc++; continue; } nfree++;
      if (!seen[c - 1] || !seen[c + 1] || !seen[c - NX] || !seen[c + NX]) { fr[c] = 1; nf++; } }
    B.stats.occ = nocc; B.stats.free = nfree; B.stats.unk = N - nocc - nfree; B.stats.frontiers = nf;
    const clusters = []; const q = [];
    for (let c0 = 0; c0 < N; c0++) { if (!fr[c0] || clusterOf[c0] >= 0) continue;
      const cl = { cells: [], id: clusters.length }; q.length = 0; q.push(c0); clusterOf[c0] = cl.id;
      while (q.length) { const c = q.pop(); cl.cells.push(c); const i = c % NX, j = (c / NX) | 0;
        for (const [di, dj] of NB) { const n = id(i + di, j + dj); if (fr[n] && clusterOf[n] < 0) { clusterOf[n] = cl.id; q.push(n); } } }
      clusters.push(cl); }
    const out = [];
    for (const cl of clusters) { if (cl.cells.length < 4) continue;
      let sx = 0, sz = 0; for (const c of cl.cells) { sx += cxOf(c % NX); sz += czOf((c / NX) | 0); } const mx = sx / cl.cells.length, mz = sz / cl.cells.length;
      // goal: the reachable cell nearest the centroid, from the cluster or the free cells just behind it
      let best = -1, bd = Infinity;
      const consider = c => { if (!isFinite(dist[c]) || lethal(c)) return; const d = Math.hypot(cxOf(c % NX) - mx, czOf((c / NX) | 0) - mz); if (d < bd) { bd = d; best = c; } };
      for (const c of cl.cells) consider(c);
      if (best < 0) { const ci = gx(mx), cj = gz(mz); for (let dj = -5; dj <= 5; dj++) for (let di = -5; di <= 5; di++) { const ii = ci + di, jj = cj + dj; if (ii > 0 && jj > 0 && ii < NX && jj < NZ) consider(id(ii, jj)); } }
      const f = { id: 0, n: cl.cells.length, cells: cl.cells, cx: mx, cz: mz, goal: best, reach: best >= 0 && bd < 1.4, D: best >= 0 ? dist[best] : Infinity, gain: 0, ac: 0, hyst: 0, J: Infinity };
      if (f.reach) { f.gx = cxOf(best % NX); f.gz = czOf((best / NX) | 0); f.gain = gainAt(f.gx, f.gz); }
      out.push(f); }
    out.sort((a, b) => b.n - a.n); out.forEach((f, k) => f.id = k + 1);
    return out;
  }
  function gainAt(x, z) { // expected information: unknown cells visible from the viewpoint within 4.5 m
    let cnt = 0; const cnt0 = new Set();
    for (let a = 0; a < 36; a++) { const ang = a / 36 * 6.2832, ux = Math.cos(ang), uz = Math.sin(ang);
      for (let s = .25; s < 4.5; s += RES * .8) { const c = id(gx(x + ux * s), gz(z + uz * s)); if (c < 0 || c >= N) break; if (occ(c)) break; if (!seen[c] && !cnt0.has(c)) { cnt0.add(c); cnt++; } } }
    return cnt * RES * RES; }

  // ---------------- acoustic prior: tracks come from the acoustic pipeline ----------------
  function acousticTerm(f, tracks) { // posterior mass of each human-class acoustic track within 3 m of the frontier's viewpoint
    let best = 0, why = null;
    for (const tr of tracks) { if (!tr.open || !tr.human || !tr.n || !tr.massNear) continue;
      let a = tr.massNear(f.gx, f.gz, 3);
      if (tr.est && tr.est.s < 3) { const d = Math.hypot(f.gx - tr.est.x, f.gz - tr.est.z), s = Math.max(3, tr.est.s * 2); a = Math.max(a, Math.exp(-d * d / (2 * s * s))); }
      if (a > best) { best = a; why = tr; } }
    return { v: 9 * best, tr: why, mass: best };
  }

  // ---------------- choose ----------------
  const W_GAIN = .1;
  function score(fs, pose, tracks) {
    for (const f of fs) { if (!f.reach) { f.J = Infinity; continue; }
      if (B.blacklist.some(b => Math.hypot(b.x - f.gx, b.z - f.gz) < 1 && B.t < b.until)) { f.J = Infinity; f.black = true; continue; }
      if (B.visited.some(v => Math.hypot(v.x - f.gx, v.z - f.gz) < 1.1)) { f.J = Infinity; f.seenFrom = true; continue; }
      const ac = acousticTerm(f, tracks); f.ac = ac.v; f.acTr = ac.tr; f.acMass = ac.mass;
      f.hyst = B.goal && B.goal.kind === 'frontier' && B.scanReason !== 'arrived' && Math.hypot(B.goal.x - f.gx, B.goal.z - f.gz) < 1.5 ? 2 : 0;
      f.J = f.D - W_GAIN * f.gain - f.ac - f.hyst;
      if (f.gain < 1.2 || f.n < 4) f.J = Infinity; }
    return fs.filter(f => isFinite(f.J)).sort((a, b) => a.J - b.J);
  }

  // ---------------- energy check (return path, not a voltage) ----------------
  function energyOK(ctx) {
    const e = ctx.energy; if (!e) return true;
    const ret = isFinite(B.homeDist) ? B.homeDist : Math.hypot(ctx.pose.x - B.home.x, ctx.pose.z - B.home.z) * 1.6;
    const need = ret * e.whPerM + e.reserveWh;
    B.energy = { ret, need, have: e.remainWh };
    return e.remainWh > need * 1.15;
  }

  // ---------------- the loop ----------------
  function retarget(pose, why) { // keep going to the same frontier region if it is still open; otherwise re-select
    const fs = frontiers(pose); B.clusters = fs; const g = B.goal;
    const near = g && g.kind === 'frontier' ? fs.filter(f => f.reach && Math.hypot(f.gx - g.x, f.gz - g.z) < 2.2 && !B.visited.some(v => Math.hypot(v.x - f.gx, v.z - f.gz) < 1.1)).sort((a, b) => Math.hypot(a.gx - g.x, a.gz - g.z) - Math.hypot(b.gx - g.x, b.gz - g.z))[0] : null;
    if (near) { setPath(pathTo(near.goal), { kind: 'frontier', x: near.gx, z: near.gz, f: near.id }); B.state = 'TRANSIT'; B.vmax = 1.4;
      log('PLAN', `${why} · frontier F${near.id} still open → continue (${f1(B.pathLen)} m)`, 'plan'); return true; }
    log('FRONTIER', `${why} · the goal region is no longer a reachable frontier → re-select`, 'plan'); B.state = 'SELECT'; return false; }
  function setPath(p, goal) { B.path = smooth(p); B.pathLen = plen(B.path); B.goal = goal; B.transitT = 0; B.stuckT = 0; B.stuckRef = null; B.replanT = 0; }
  function startScan(pose, why, reason = 'arrived') { B.scanReason = reason; if (markList.length) commitSweep(); B.state = 'SCAN'; B.sweep = true; B.scanT = 0; B.yaw0 = pose.yaw; B.sweepStats = { rays: 0, upd: 0, hit: 0, miss: 0 }; B.setpoint = { x: pose.x, z: pose.z };
    log('SCAN', `stop-and-scan ${why ? '(' + why + ') ' : ''}· hover, servo −35°→+35°, yaw 360° for camera/thermal coverage`, 'scan'); }

  function tick(dt, ctx) {
    B.t = ctx.t; B.mode = ctx.mode; B.tracks = ctx.tracks || [];
    const pose = ctx.pose;
    // distance home along the known map (cheap: reuse the last Dijkstra from the drone)
    if (B.lastDijkT === undefined || B.t - B.lastDijkT > 1.5) { B.lastDijkT = B.t; buildCost(); dijkstra(pose.x, pose.z); const hc = id(gx(B.home.x), gz(B.home.z)); B.homeDist = dist[hc]; }
    if (ctx.failsafe && B.state !== 'LAND' && B.state !== 'DONE') { B.state = 'LAND'; B.landT = 0; B.reason = 'EKF failsafe'; log('FAILSAFE', 'EKF3 variance exceeded (no position or velocity aiding) → LAND in place', 'bad'); }

    if (ctx.mode === 'MANUAL') { manual(dt, ctx); return cmd(); }
    if (B.state === 'PILOT') { B.state = 'SELECT'; B.prevMode = 'MANUAL'; log('MODE', 'pilot released the sticks → GUIDED · companion computer resumes setpoints', 'mode'); }

    switch (B.state) {
      case 'INIT': {
        B.initT = (B.initT || 0) + dt; B.setpoint = { x: pose.x, z: pose.z }; B.yawT = null; B.yawRate = 0;
        if (!B.armed) { B.armed = true; log('ARM', 'armed · GUIDED · takeoff to 1.40 m (barometer + ToF), hover', 'mode'); }
        if (B.initT > 1.2) startScan(pose, 'first map');
        break; }
      case 'SCAN': {
        B.scanT += dt; B.setpoint = { x: B.setpoint.x, z: B.setpoint.z }; B.yawT = null; B.yawRate = 6.2832 / B.scanDur;
        if (!ctx.sensors.lidar) { B.sweep = false; markList.forEach(c => mark[c] = 0); markList = []; toHold(ctx, 'LiDAR off: no returns'); break; }
        if (B.scanT >= B.scanDur) {
          B.sweep = false; B.stats.sweeps++; B.lastScan = { x: pose.x, z: pose.z, t: B.t }; B.distSinceScan = 0; commitSweep();
          if (B.goal && B.goal.kind === 'frontier' && B.scanReason === 'arrived') B.visited.push({ x: B.goal.x, z: B.goal.z });
          const s = B.sweepStats; B.stats.lastSweepRays = s.rays; B.stats.lastSweepUpd = s.hit + s.miss;
          log('MAP', `sweep #${B.stats.sweeps}: ${s.rays.toLocaleString()} rays → ${s.hit.toLocaleString()} cells hit (ℓ += 0.85) · ${s.miss.toLocaleString()} cells passed through (ℓ −= 0.41) · once per cell per sweep`, 'map');
          if (B.rtlAgain) { B.rtlAgain = false; goHome(ctx); } else if (B.scanReason === 'midroute') retarget(pose, 'mid-route sweep done'); else B.state = 'SELECT'; }
        break; }
      case 'SELECT': select(ctx); break;
      case 'TRANSIT': transit(dt, ctx); break;
      case 'INVESTIGATE': investigate(dt, ctx); break;
      case 'RTL': transit(dt, ctx); break;
      case 'HOLD': {
        B.setpoint = B.setpoint || { x: pose.x, z: pose.z }; B.yawRate = 0; B.yawT = null; B.holdT += dt;
        if (ctx.sensors.lidar && ctx.lio !== 'LOST') { log('SLAM', 'scan-to-map match succeeded → relocalised · resume exploration', 'good'); B.state = 'SELECT'; break; }
        if (B.holdT > 5 && !B.rtlWhy) { B.rtlWhy = 'SLAM lost'; log('FAILSAFE', 'could not relocalise in 5 s → return home on the last map + EKF3 (flow)', 'bad'); goHome(ctx); }
        break; }
      case 'LAND': {
        B.landT += dt; B.setpoint = { x: pose.x, z: pose.z }; B.yawRate = 0;
        if (B.landT > 2.5 && !B.done) { B.done = true; B.state = 'DONE'; log('LAND', `touchdown · disarmed · ${B.reason}`, 'mode'); }
        break; }
    }
    // why-panel
    B.why = explain(ctx);
    return cmd();
  }
  function cmd() { return { sp: B.setpoint, yawT: B.yawT, yawRate: B.yawRate, sweep: B.sweep, vmax: B.vmax, land: B.state === 'LAND' || B.state === 'DONE', done: B.done }; }

  function toHold(ctx, why) { if (B.state === 'HOLD') return; B.state = 'HOLD'; B.holdT = 0; B.rtlWhy = ''; B.setpoint = { x: ctx.pose.x, z: ctx.pose.z };
    log('SLAM', `${why} → SLAM lost · hold position on the flight controller's own estimate, try to relocalise`, 'bad'); }

  function goHome(ctx) {
    buildCost(); dijkstra(ctx.pose.x, ctx.pose.z); const hc = id(gx(B.home.x), gz(B.home.z));
    let p = isFinite(dist[hc]) ? pathTo(hc) : [[ctx.pose.x, ctx.pose.z], [B.home.x, B.home.z]];
    setPath(p, { kind: 'home', x: B.home.x, z: B.home.z }); B.state = 'RTL'; B.vmax = 1.2;
    log('RTL', `return to launch · ${f1(B.pathLen)} m along known free cells${B.rtlWhy ? ' · reason: ' + B.rtlWhy : ''}`, 'mode');
    log('SETPOINT', setpointText(B.path[Math.min(1, B.path.length - 1)]), 'dim');
  }

  function select(ctx) {
    const pose = ctx.pose;
    if (B.forceHome) { B.forceHome = false; goHome(ctx); return; }
    if (!ctx.sensors.lidar) { toHold(ctx, 'LiDAR off'); return; }
    if (B.stats.sweeps === 0 || (B.lastScan && Math.hypot(pose.x - B.lastScan.x, pose.z - B.lastScan.z) > 3 && B.prevMode === 'MANUAL')) { B.prevMode = null; startScan(pose, 'map around the current position first', 'arrived'); return; }
    if (!energyOK(ctx)) { B.rtlWhy = `energy: ${f1(B.energy.have)} Wh left, return needs ${f1(B.energy.need)} Wh (path ${f1(B.energy.ret)} m + reserve)`; goHome(ctx); return; }
    // 1) open perception candidates (something seen that is not yet classified) → investigate
    const cands = (ctx.candidates || []).filter(c => c.open && !B.investigated.has(c.key) && !(c.tries > 1));
    if (cands.length) { const c = cands.sort((a, b) => Math.hypot(a.x - pose.x, a.z - pose.z) - Math.hypot(b.x - pose.x, b.z - pose.z))[0];
      if (startInvestigate(c, ctx)) return; }
    // 2) acoustic estimates inside mapped free space → investigate the estimate directly
    for (const tr of B.tracks) { if (!tr.open || !tr.human || !tr.est || tr.est.s > 2.0 || (tr.invT && B.t - tr.invT < 40)) continue; tr.invT = B.t;
      if (startInvestigate({ key: 'ac:' + tr.cls + ':' + Math.round(B.t), x: tr.est.x, z: tr.est.z, y: .5, label: tr.cls + ' source estimate', acoustic: tr }, ctx)) return; }
    // 3) frontiers
    const fs = frontiers(pose); const ranked = score(fs, pose, B.tracks); B.clusters = fs; B.stats.coverage = coverage();
    if (!ranked.length) {
      const open = B.tracks.filter(t => t.open && t.human);
      B.rtlWhy = open.length ? `no reachable frontier left; ${open.length} acoustic track(s) unresolved` : 'no reachable frontier left: exploration complete';
      log('FRONTIER', `0 reachable clusters (${fs.length} total, ${fs.filter(f => !f.reach).length} unreachable) → ${B.rtlWhy}`, 'good');
      goHome(ctx); return; }
    const f = ranked[0]; f.chosen = true; B.lastBest = f;
    log('FRONTIER', `${fs.length} clusters · ${B.stats.frontiers} frontier cells · best F${f.id}: J = ${f1(f.D)} m travel − ${f1(W_GAIN * f.gain)} gain(${f1(f.gain)} m²)${f.ac > .05 ? ' − ' + f1(f.ac) + ' acoustic' : ''}${f.hyst ? ' − 2.0 keep-goal' : ''} + 0 claim + 0 swarm = ${f2(f.J)}`, 'plan');
    if (ranked[1]) log('', `runner-up F${ranked[1].id} J = ${f2(ranked[1].J)}${ranked[2] ? ` · F${ranked[2].id} J = ${f2(ranked[2].J)}` : ''}`, 'dim');
    if (f.ac > .5 && f.acTr) log('PRIOR', `F${f.id} is ${f1(Math.hypot(f.gx - (f.acTr.est || f.acTr.last).x, f.gz - (f.acTr.est || f.acTr.last).z))} m from the ${f.acTr.cls} source estimate (posterior weight ${f2(f.acMass)}) → cost lowered by ${f1(f.ac)}`, 'ac');
    const p = pathTo(f.goal); setPath(p, { kind: 'frontier', x: f.gx, z: f.gz, f: f.id });
    B.state = 'TRANSIT'; B.vmax = 1.4;
    log('PLAN', `Dijkstra on inflated costmap (r = ${R_INF} m) → ${p.length} cells → ${B.path.length - 1} segments · ${f1(B.pathLen)} m`, 'plan');
    log('SETPOINT', setpointText(B.path[Math.min(1, B.path.length - 1)]), 'dim');
  }

  function coverage() { let k = 0, n = 0; for (let c = 0; c < N; c++) { if (seen[c]) { k++; if (L[c] <= 0) n++; } } return n * RES * RES; }

  function startInvestigate(c, ctx) {
    const pose = ctx.pose;
    buildCost(); dijkstra(pose.x, pose.z);
    // viewpoint: reachable cell 1.4–2.6 m from the candidate with a clear line on the map
    let best = -1, bd = Infinity; const ci = gx(c.x), cj = gz(c.z);
    for (let dj = -11; dj <= 11; dj++) for (let di = -11; di <= 11; di++) { const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
      const cc = id(ii, jj); if (!isFinite(dist[cc]) || lethal(cc)) continue; const r = Math.hypot(di, dj) * RES; if (r < 1.3 || r > 2.8) continue;
      if (!rayFree(cxOf(ii), czOf(jj), c.x, c.z, .5)) continue;
      const k = dist[cc] + Math.abs(r - 1.9) * 2; if (k < bd) { bd = k; best = cc; } }
    B.investigated.add(c.key); c.tries = (c.tries || 0) + 1;
    if (best < 0) { log('INVEST', `${c.label} at ${EN(c.x, c.z)}: no reachable viewpoint with a clear line yet → keep exploring`, 'dim'); if (c.acoustic) c.acoustic.investigated = true; return false; }
    const p = pathTo(best); setPath(p, { kind: 'inspect', x: cxOf(best % NX), z: czOf((best / NX) | 0), tx: c.x, tz: c.z, key: c.key, label: c.label });
    B.inv = { c, holdT: 0 }; B.state = 'INVESTIGATE'; B.vmax = .8; if (c.acoustic) c.acoustic.investigated = true;
    log('INVEST', `candidate "${c.label}" at ${EN(c.x, c.z)} → viewpoint ${f1(Math.hypot(cxOf(best % NX) - c.x, czOf((best / NX) | 0) - c.z))} m away, ${f1(B.pathLen)} m path, slow approach 0.8 m/s`, 'inv');
    return true;
  }
  function rayFree(x0, z0, x1, z1, stopShort) { const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / (RES * .5)); for (let k = 1; k < n; k++) { if ((d * k / n) > d - stopShort) break; const c = id(gx(x0 + (x1 - x0) * k / n), gz(z0 + (z1 - z0) * k / n)); if (occ(c)) return false; } return true; }
  B.rayFirstOcc = (x0, z0, ang, maxD) => { const ux = Math.sin(ang), uz = Math.cos(ang); for (let s = .3; s < maxD; s += RES * .5) { const c = id(gx(x0 + ux * s), gz(z0 + uz * s)); if (c < 0 || c >= N) return null; if (occ(c)) return { d: s, x: x0 + ux * s, z: z0 + uz * s, L: L[c] }; } return null; };

  function investigate(dt, ctx) {
    const inv = B.inv;
    if (inv.arrived) {
      inv.holdT += dt; B.setpoint = { x: B.goal.x, z: B.goal.z }; B.yawRate = 0; if (!B.sweep && inv.holdT < 3) { B.sweep = true; B.scanT = 0; B.sweepStats = { rays: 0, upd: 0, hit: 0, miss: 0 }; } if (B.sweep) { B.scanT += dt; if (B.scanT > B.scanDur) { B.sweep = false; commitSweep(); B.stats.sweeps++; } }
      B.yawT = Math.atan2(-(B.goal.tx - ctx.pose.x), -(B.goal.tz - ctx.pose.z));
      const c = (ctx.candidates || []).find(k => k.key === inv.c.key);
      const resolved = c ? !c.open : inv.c.acoustic ? !inv.c.acoustic.open : false;
      if (resolved || inv.holdT > 5) {
        log('INVEST', resolved ? `"${inv.c.label}" classified → ${c ? c.result : 'track closed'}` : `"${inv.c.label}": no decision after 5 s hold → report with what we have`, resolved ? 'good' : 'dim');
        if (!resolved && c) c.open = false; if (B.sweep) { B.sweep = false; commitSweep(); B.stats.sweeps++; }
        B.inv = null; B.state = 'SELECT'; B.vmax = 1.2; }
      return; }
    transit(dt, ctx, true);
  }

  function transit(dt, ctx, isInv) {
    const pose = ctx.pose; B.transitT += dt;
    if (B.state !== 'RTL' && !ctx.sensors.lidar) { toHold(ctx, 'LiDAR off'); return; }
    // progress / stuck detection
    if (!B.stuckRef || B.t - B.stuckRef.t > 4) { if (B.stuckRef && Math.hypot(pose.x - B.stuckRef.x, pose.z - B.stuckRef.z) < .25) {
        if (B.state === 'RTL') { log('PLAN', 'no progress in 4 s → hover sweep to refresh the map, then replan home', 'bad'); B.rtlAgain = true; startScan(pose, 'refresh map', 'stuck'); return; }
        log('PLAN', 'no progress in 4 s → blacklist this goal for 30 s, sweep, re-select', 'bad'); B.blacklist.push({ x: B.goal.x, z: B.goal.z, until: B.t + 30 }); B.inv = null; startScan(pose, 'refresh map', 'stuck'); return; }
      B.stuckRef = { x: pose.x, z: pose.z, t: B.t }; }
    // periodic replan on the current map (it only changes at sweeps)
    B.replanT += dt;
    if (B.replanT > 2.5 && B.state !== 'RTL') { B.replanT = 0; const blocked = !pathStillClear(); if (blocked) {
        buildCost(); dijkstra(pose.x, pose.z); const gc = id(gx(B.goal.x), gz(B.goal.z));
        if (isFinite(dist[gc])) { setPath(pathTo(gc), B.goal); log('PLAN', `path crosses an occupied/inflated cell → replanned (${f1(B.pathLen)} m)`, 'plan'); }
        else if (B.state === 'TRANSIT') { B.blacklist.push({ x: B.goal.x, z: B.goal.z, until: B.t + 30 }); retarget(pose, 'goal cell became unreachable (new obstacle cells)'); return; }
        else { log('PLAN', 'viewpoint no longer reachable on the map → re-select', 'bad'); B.state = 'SELECT'; B.inv = null; return; } } }
    // regulated pure pursuit (Nav2): carrot at an arc length ahead on the path; shorter carrot + lower speed near turns and obstacles
    const ci = id(gx(pose.x), gz(pose.z)), clear = dObs[ci] * RES;
    if (clear < R_INF - .05 && !isInv) { // inside the inflation radius: back off to the nearest safe cell first
      const esc = nearestSafe(pose.x, pose.z); if (esc) { B.setpoint = { x: esc[0], z: esc[1] }; B.vmax = .45; B.yawRate = 0; if (!B.escLog || B.t - B.escLog > 6) { B.escLog = B.t; log('PLAN', `inside the inflation radius (${f2(clear)} m from an occupied cell) → back off to the nearest safe cell, then follow the path`, 'dim'); } return; } }
    // project onto the path (first 3 segments), then walk forward
    let bi = 0, bt = 0, bd = Infinity;
    for (let k = 0; k < Math.min(3, B.path.length - 1); k++) { const a = B.path[k], b = B.path[k + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((pose.x - a[0]) * dx + (pose.z - a[1]) * dz) / L2)), d = Math.hypot(a[0] + dx * t - pose.x, a[1] + dz * t - pose.z); if (d < bd) { bd = d; bi = k; bt = t; } }
    if (bi > 0) B.path.splice(0, bi);
    let turn = 0; if (B.path.length > 2) { const a = B.path[0], b = B.path[1], c = B.path[2]; const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]), h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
      turn = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) * Math.max(0, 1 - Math.hypot(b[0] - pose.x, b[1] - pose.z) / 2.2); }
    const look = (isInv ? .45 : .5) + (isInv ? .25 : .75) * Math.max(0, 1 - turn / 1.2) * Math.min(1, Math.max(0, (clear - .35) / .8));
    let rem = look, tgt = null; { const a = B.path[0], b = B.path[1] || a; let px = a[0] + (b[0] - a[0]) * bt, pz = a[1] + (b[1] - a[1]) * bt;
      for (let k = 1; k < B.path.length; k++) { const q = B.path[k], d = Math.hypot(q[0] - px, q[1] - pz); if (d >= rem) { tgt = [px + (q[0] - px) * rem / d, pz + (q[1] - pz) * rem / d]; break; } rem -= d; px = q[0]; pz = q[1]; }
      if (!tgt) tgt = B.path[B.path.length - 1]; }
    const end = B.path[B.path.length - 1], dEnd = Math.hypot(end[0] - pose.x, end[1] - pose.z);
    B.setpoint = { x: tgt[0], z: tgt[1] }; B.yawRate = 0;
    const vx = tgt[0] - pose.x, vz = tgt[1] - pose.z; if (Math.hypot(vx, vz) > .2) B.yawT = Math.atan2(-vx, -vz);
    const base = B.state === 'INVESTIGATE' ? .8 : 1.8; B.vmax = base * Math.max(.3, 1 - turn * .6) * Math.max(.35, Math.min(1, (clear - .3) / .9));
    B.reg = { look, clear, turn };
    B.distSinceScan += Math.hypot(ctx.vel[0], ctx.vel[1]) * dt;
    if (dEnd < (isInv ? .45 : .6)) {
      if (B.state === 'RTL') { B.state = 'LAND'; B.landT = 0; B.reason = B.rtlWhy || 'mission complete'; log('LAND', 'over home · descending', 'mode'); return; }
      if (isInv) { B.inv.arrived = true; log('INVEST', `on viewpoint · yaw toward candidate · tilt sweep so LiDAR points land on it (PointPainting) · holding for camera + thermal`, 'inv'); return; }
      startScan(pose, 'frontier reached', 'arrived'); return; }
    if (!isInv && B.state === 'TRANSIT' && B.distSinceScan > 8 && dEnd > 3 && frontierCellsNear(pose.x, pose.z, 4) > 6) { startScan(pose, `new ground: frontier cells within 4 m, ${f1(B.distSinceScan)} m since the last 3-D sweep`, 'midroute'); return; }
    if (B.transitT > 12 + B.pathLen / .6) { log('PLAN', 'transit timeout → re-select', 'bad'); B.state = 'SELECT'; B.inv = null; }
  }
  function frontierCellsNear(x, z, r) { let n = 0; const i0 = gx(x), j0 = gz(z), k = Math.ceil(r / RES); for (let dj = -k; dj <= k; dj += 2) for (let di = -k; di <= k; di += 2) { const c = id(i0 + di, j0 + dj); if (c >= 0 && c < N && seen[c] && L[c] <= 0 && (!seen[c - 1] || !seen[c + 1] || !seen[c - NX] || !seen[c + NX])) n++; } return n * 4; }
  function nearestSafe(x, z) { const i0 = gx(x), j0 = gz(z); let best = null, bd = Infinity;
    for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) { const c = id(i0 + di, j0 + dj); if (!passable(c) || lethal(c)) continue; const d = Math.hypot(di, dj); if (d < bd) { bd = d; best = [cxOf(i0 + di), czOf(j0 + dj)]; } } return best; }
  function pathStillClear() { for (let k = 1; k < B.path.length; k++) if (!losClearLoose(B.path[k - 1], B.path[k])) return false; return true; }
  function losClearLoose(a, b) { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (RES * .5)); for (let k = 1; k < n; k++) { const c = id(gx(a[0] + (b[0] - a[0]) * k / n), gz(a[1] + (b[1] - a[1]) * k / n)); if (occ(c) || dObs[c] * RES < R_INF * .6) return false; } return true; }
  function circleSeg(px, pz, r, a, b) { // farthest intersection of a circle with segment ab (pure pursuit lookahead)
    const dx = b[0] - a[0], dz = b[1] - a[1], fx = a[0] - px, fz = a[1] - pz; const A = dx * dx + dz * dz, Bq = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - r * r;
    const disc = Bq * Bq - 4 * A * C; if (disc < 0 || A < 1e-9) return null; const s = Math.sqrt(disc), t2 = (-Bq + s) / (2 * A); if (t2 >= 0 && t2 <= 1) return [a[0] + dx * t2, a[1] + dz * t2]; return null; }

  // ---------------- manual (LOITER): the pilot flies; the autonomy keeps mapping and advising ----------------
  function manual(dt, ctx) {
    if (B.state !== 'PILOT') { B.prevState = B.state; B.state = 'PILOT'; B.sweep = false; B.inv = null; log('MODE', 'stick input → LOITER · pilot override always wins · companion setpoints suppressed', 'mode'); }
    B.setpoint = null; B.yawT = null; B.yawRate = 0;
    // stationary → automatic tilt sweep (map insertion happens only while hovering)
    const still = Math.hypot(ctx.vel[0], ctx.vel[1]) < .12;
    B.stillT = still ? (B.stillT || 0) + dt : 0;
    if (!B.sweep && B.stillT > .8 && ctx.sensors.lidar && (!B.lastScan || Math.hypot(ctx.pose.x - B.lastScan.x, ctx.pose.z - B.lastScan.z) > 1.2)) { B.sweep = true; B.scanT = 0; B.sweepStats = { rays: 0, upd: 0, hit: 0, miss: 0 }; log('SCAN', 'hovering still → tilt sweep (map is only updated from hover sweeps)', 'scan'); }
    if (B.sweep) { B.scanT += dt; if (!still || !ctx.sensors.lidar) { B.sweep = false; }
      else if (B.scanT > 2.4) { B.sweep = false; B.stats.sweeps++; B.lastScan = { x: ctx.pose.x, z: ctx.pose.z, t: B.t }; commitSweep(); const s = B.sweepStats; log('MAP', `sweep #${B.stats.sweeps}: ${s.rays.toLocaleString()} rays → ${s.hit.toLocaleString()} cells hit · ${s.miss.toLocaleString()} cells passed through`, 'map'); } }
    B.advT = (B.advT || 0) + dt;
    if (B.advT > 2) { B.advT = 0; const fs = frontiers(ctx.pose); const r = score(fs, ctx.pose, B.tracks); B.clusters = fs; B.stats.coverage = coverage(); B.advisory = r[0] || null; if (r[0]) r[0].chosen = true; }
    B.why = explain(ctx);
  }

  function setpointText(p) { if (!p) return ''; const e = p[0] - B.home.x, n = -(p[1] - B.home.z), u = 1.4;
    return `/mavros/setpoint_position/local ENU (${f1(e)}, ${f1(n)}, ${f1(u)}) → NED (${f1(n)}, ${f1(e)}, ${f1(-u)}) · SET_POSITION_TARGET_LOCAL_NED`; }

  function explain(ctx) {
    const p = ctx.pose, out = [];
    const st = B.state;
    if (st === 'INIT') out.push(['NOW', 'takeoff and hover; nothing is mapped yet: every cell is unknown']);
    if (st === 'SCAN') out.push(['NOW', `stop-and-scan ${Math.min(100, B.scanT / B.scanDur * 100).toFixed(0)}% · ${B.sweepStats.rays.toLocaleString()} rays inserted · yaw ${deg(B.yaw0 + B.scanT * 6.2832 / B.scanDur).toFixed(0)}°`], ['WHY', 'scanning while moving smears the 3-D points (the LiDAR tilts slowly), so the map is only updated while hovering']);
    if (st === 'TRANSIT' && B.goal) { const f = B.lastBest; out.push(['NOW', `flying to frontier F${B.goal.f} · ${f1(Math.hypot(B.goal.x - p.x, B.goal.z - p.z))} m left · path ${f1(B.pathLen)} m`]);
      if (f) out.push(['WHY', `lowest cost: ${f1(f.D)} m travel, ${f1(f.gain)} m² of unknown visible from there${f.ac > .05 ? `, acoustic prior −${f1(f.ac)}` : ''}`]);
      out.push(['NEXT', 'arrive → stop-and-scan → new frontiers appear at the new edge of the map']); }
    if (st === 'INVESTIGATE' && B.inv) { out.push(['NOW', `${B.inv.arrived ? 'holding on viewpoint, facing' : 'approaching'} candidate "${B.inv.c.label}"`]);
      out.push(['WHY', 'one sensor is never enough: a person needs camera AND thermal to agree (two independent evidences)']); }
    if (st === 'RTL') out.push(['NOW', `returning home · ${f1(Math.hypot(B.home.x - p.x, B.home.z - p.z))} m straight-line`], ['WHY', B.rtlWhy || '']);
    if (st === 'HOLD') out.push(['NOW', 'holding position on the flight controller\'s own estimate'], ['WHY', 'without LiDAR there is no SLAM and no new map: the planner has nothing safe to plan on']);
    if (st === 'LAND' || st === 'DONE') out.push(['NOW', st === 'DONE' ? 'landed · disarmed' : 'landing'], ['WHY', B.reason]);
    if (st === 'PILOT') { out.push(['NOW', 'you are flying (LOITER) · the autonomy keeps mapping and scoring frontiers']);
      if (B.advisory) out.push(['ADVICE', `best frontier F${B.advisory.id}: ${f1(B.advisory.D)} m away, J = ${f2(B.advisory.J)} (arrow on the map)`]); }
    return out;
  }

  return { B, reset, insertRay, commit: () => { if (!B.sweep) commitSweep(); }, tick, grid: { L, seen, nHit, nMiss, touched, dObs, fr, RES, X0, Z0, NX, NZ, N }, frontiers: p => frontiers(p) };
}

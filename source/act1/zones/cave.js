// A flooded cave (after Tham Luang, Thailand, 2018). Side cross-section of a limestone mountain in monsoon rain.
// A branching cave runs 2 km in from the entrance. Water fills every low passage to one level; where the roof dips
// below it, the passage is a sump that drones cannot cross (divers only). No GPS, and radio does not pass through rock,
// so the drones drop small relay beacons (with RFID tags at junctions) as they go: each beacon stays in line of sight
// of the last one, and the chain carries the map back to the entrance. Every drone flies to the nearest open lead
// (a gap between mapped and unmapped air) that no closer drone is already heading for; the map grows as a glow of
// the passages they have seen. The open leads ("branches left") count down to zero; the risky last one, a flooded
// passage with a few metres of air, leads to a high shelf where the group is waiting.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp, lerp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx, el = cv.cv;
  el.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2;
  const mk = (w = 2, h = 2) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // ---------------------------------------------------------------- noise
  const hash = (x, y, s) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  function vn(x, y, s) {
    const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function fbm(x, y, s, o) { let t = 0, a = .5, n = 0; for (let i = 0; i < o; i++) { t += a * vn(x, y, s + i * 131); n += a; a *= .5; x *= 2.03; y *= 2.03; } return t / n; }
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ---------------------------------------------------------------- map units
  // u: metres into the mountain from the entrance. v: height above the entrance floor, drawn 4x (VE0) so that the
  // passages are tall enough to see; the display stretches it a little more, and the label says by how much.
  const VE0 = 4, U0 = -80, U1 = 2000, V0 = -280, V1 = 280, CS = 8, SQ = .8;   // SQ: passages are lower than they are long
  const GW = (U1 - U0) / CS, GH = (V1 - V0) / CS, NC = GW * GH;
  const cu = (i) => U0 + ((i % GW) + .5) * CS, cvv = (i) => V1 - (((i / GW) | 0) + .5) * CS;
  const cellAt = (u, v) => { const i = Math.floor((u - U0) / CS), j = Math.floor((V1 - v) / CS); return i < 0 || j < 0 || i >= GW || j >= GH ? -1 : j * GW + i; };
  const TL = 60, SPEED = 114;                        // time-lapse; drone speed in map units per wall second (1.9 m/s)
  const RU = 40, RV = 100;                           // LiDAR reach: 40 m along the passage, 25 m up or down
  const RR = 240, ND = 12, CARRY = 5;                 // radio range (line of sight only); drones; beacons per drone

  const cave = new Uint8Array(NC), water = new Uint8Array(NC), air = new Uint8Array(NC), rev = new Uint8Array(NC), lowAir = new Uint8Array(NC), lowNear = new Uint8Array(NC);
  const lead = new Int16Array(NC), entry = new Int16Array(NC), qq = new Int32Array(NC), dist = new Int32Array(NC), par = new Int32Array(NC), stamp = new Int32Array(NC);
  let stampN = 0;

  const NBX = [-1, 1, 0, 0, -1, 1, -1, 1], NBY = [0, 0, -1, 1, -1, -1, 1, 1];
  const nbr = (c, x, k) => { const xx = x + NBX[k]; if (xx < 0 || xx >= GW) return -1; const n = c + NBY[k] * GW + NBX[k]; return n < 0 || n >= NC ? -1 : n; };
  // ---------------------------------------------------------------- the cave (a template, jittered per mission)
  let Wd = null, seed = 5;
  function genWorld(sd) {
    const r = kit.rng(sd * 7717 + 3), rr = (a, b) => a + (b - a) * r(), j = (p, du, dv) => [p[0] + rr(-du, du), p[1] + rr(-dv, dv), p[2]];
    const w = { sd, s1: (sd * 37 + 11) & 1023, s2: (sd * 53 + 7) & 1023 };
    Wd = w;
    const N = {
      E0: [10, 20, 30], E1: [96, 2, 40], A: j([280, -40, 58], 20, 10), B: j([505, -12, 34], 20, 10), C: j([760, -84, 62], 25, 10), D: j([1030, -40, 40], 20, 8),
      F1: [1170, -132, 30], F2: [1330, -172, 28], F3: [1500, -142, 28],
      P1: j([1130, 52, 28], 15, 12), P2: j([1300, 108, 30], 20, 12), P3: j([1465, 58, 36], 15, 10), P4: [1600, -64, 20],
      S1: [1716, -36, 74], S2: [1818, 0, 70],
      A1: j([336, 70, 24], 12, 10), A2: j([270, 128, 44], 20, 10),
      B1: [590, -140, 22], B2: [665, -222, 30],
      C1: j([860, 6, 22], 15, 8), C2: j([950, 14, 34], 15, 10),
      Q1: [1372, 160, 22], Q2: j([1440, 186, 34], 15, 6),
    };
    w.N = N;
    const E = [['E0', 'E1', 1], ['E1', 'A', 1], ['A', 'B', 1], ['B', 'C', 1], ['C', 'D', 1], ['D', 'F1', 1], ['F1', 'F2', 1], ['F2', 'F3', 1], ['F3', 'S1', 1],
      ['D', 'P1', 1], ['P1', 'P2', 1], ['P2', 'P3', 1], ['P3', 'P4', 1], ['P4', 'S1', 1], ['S1', 'S2', 1],
      ['A', 'A1', 1], ['A1', 'A2', 1], ['B', 'B1', 1], ['B1', 'B2', 1], ['C', 'C1', 1], ['C1', 'C2', 1], ['P2', 'Q1', 1], ['Q1', 'Q2', 1]];
    // samples along every passage: a wobbling centre line with a varying radius; chambers get extra lumps
    const S = []; let total = 0; w.elen = {};
    for (const [a, b] of E) {
      let el = 0;
      const p = N[a], q = N[b], du = q[0] - p[0], dv = q[1] - p[1], L = Math.hypot(du, dv), n = Math.max(2, Math.ceil(L / 4)), nx = -dv / L, ny = du / L;
      let lu = p[0], lv = p[1];
      for (let k = 0; k <= n; k++) {
        const t = k / n, wob = (fbm(p[0] * .01 + t * L / 70, p[1] * .01, w.s1, 2) - .5) * 16 * Math.sin(Math.PI * t);
        const u = p[0] + du * t + nx * wob, v = p[1] + dv * t + ny * wob;
        const rad = lerp(p[2], q[2], sstep(0, 1, t)) * (.86 + .3 * fbm(u / 40, v / 40, w.s2, 2));
        const seg = k ? Math.hypot(u - lu, (v - lv) / VE0) : 0; total += seg; el += seg;
        S.push(u, v, rad, seg); lu = u; lv = v;
      }
      w.elen[a + '-' + b] = el;
    }
    // how far in the shelf is, along the drones' route (entrance, trunk to D, the dry bypass, the low passage)
    w.deep = ['E0-E1', 'E1-A', 'A-B', 'B-C', 'C-D', 'D-P1', 'P1-P2', 'P2-P3', 'P3-P4', 'P4-S1', 'S1-S2'].reduce((t, k) => t + (w.elen[k] || 0), 0);
    for (const k of ['A', 'C', 'S1', 'S2', 'A2', 'C2', 'P3', 'E1']) {
      const p = N[k];
      for (let m = 0; m < 5; m++) { const a = rr(0, TAU), q = p[2] * rr(.35, .6); S.push(p[0] + Math.cos(a) * q * 1.4, p[1] + Math.sin(a) * q * .7, p[2] * rr(.45, .65), 0); }
    }
    w.S = S; w.total = total;
    // rasterise: cave cells; the outside (left of the cliff, above the valley floor) is open air
    cave.fill(0); water.fill(0); air.fill(0); lowAir.fill(0);
    for (let k = 0; k < S.length; k += 4) {
      const u = S[k], v = S[k + 1], rad = S[k + 2];
      const i0 = Math.max(0, Math.floor((u - rad - U0) / CS)), i1 = Math.min(GW - 1, Math.floor((u + rad - U0) / CS));
      const j0 = Math.max(0, Math.floor((V1 - v - rad) / CS)), j1 = Math.min(GH - 1, Math.floor((V1 - v + rad) / CS));
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) { const x = U0 + (ii + .5) * CS - u, y = V1 - (jj + .5) * CS - v; if (x * x + y * y / (SQ * SQ) <= rad * rad) cave[jj * GW + ii] = 1; }
    }
    w.ground = -8;
    for (let i = 0; i < NC; i++) if (cu(i) < 6 && cvv(i) > w.ground) cave[i] = 2;            // 2 = outside air
    // the shelf: a ledge of rock on the far wall of the last chamber, standing out of the water
    const sh = { u0: N.S2[0] - 6, u1: N.S2[0] + 76, top: N.S2[1] - 26 };
    w.shelf = sh;
    for (let i = 0; i < NC; i++) if (cave[i] === 1 && cu(i) > sh.u0 && cu(i) < sh.u1 && cvv(i) < sh.top) { const e = (cu(i) - sh.u0) / (sh.u1 - sh.u0); if (cvv(i) < sh.top - 6 * (1 - e) * (1 - e) * 4) cave[i] = 0; }
    w.people = { u: sh.u0 + (sh.u1 - sh.u0) * .5, v: sh.top + 8 };
    // water: in the monsoon the water table stands at one level; every passage below it is flooded (the phreatic
    // zone). Where a passage's roof dips below that level it is a sump.
    w.table = -60; w.basins = [{ level: w.table }];
    for (let i = 0; i < NC; i++) if (cave[i] === 1 && cvv(i) < w.table) water[i] = 1;
    for (let i = 0; i < NC; i++) air[i] = cave[i] && !water[i] ? 1 : 0;
    // the low-air stretch before the shelf chamber: the swarm sees it is risky and leaves it for last
    for (let i = 0; i < NC; i++) if (air[i] && cu(i) > N.P4[0] - 70 && cu(i) < N.P4[0] + 60 && cvv(i) < N.P4[1] + 34) lowAir[i] = 1;
    lowNear.fill(0);                                                          // close enough to see that it is low and wet
    for (let i = 0; i < NC; i++) if (lowAir[i]) { const x = i % GW, y = (i / GW) | 0; for (let oy = -6; oy <= 6; oy++) for (let ox = -6; ox <= 6; ox++) { const xx = x + ox, yy = y + oy; if (xx >= 0 && yy >= 0 && xx < GW && yy < GH) lowNear[yy * GW + xx] = 1; } }
    // sumps: where a passage's roof dips under the water, along each sampled passage
    w.sumps = [];
    const addSump = (u, v) => { if (!w.sumps.some((p) => Math.abs(p.u - u) < 60 && Math.abs(p.v - v) < 40)) w.sumps.push({ u, v, seen: false, t: 0 }); };
    for (let k = 4; k < S.length; k += 4) {
      if (!S[k + 3]) continue;                                                 // first sample of a passage
      const top0 = S[k - 3] + S[k - 2] * SQ, top1 = S[k + 1] + S[k + 2] * SQ;
      if ((top0 >= w.table) !== (top1 >= w.table)) addSump((S[k - 4] + S[k]) / 2, w.table);
    }
    w.sumps = w.sumps.filter((p) => { const c = cellAt(p.u, p.v + 10); return c >= 0; });
    // junctions (where an RFID tag goes) and the dead-end chambers
    w.junc = ['A', 'B', 'C', 'D', 'P2', 'P3'].map((k) => ({ u: N[k][0], v: N[k][1], k }));
    w.ends = ['A2', 'C2', 'Q2'].map((k) => ({ u: N[k][0], v: N[k][1], done: false }));
    w.base = { u: -52, v: w.ground };
    // the passage samples per cell (for the "passage mapped" length)
    w.head = new Int32Array(NC).fill(-1); w.next = new Int32Array(S.length / 4).fill(-1);
    for (let k = 0; k < S.length; k += 4) { const c = S[k + 3] > 0 ? cellAt(S[k], S[k + 1]) : -1; if (c >= 0) { w.next[k / 4] = w.head[c]; w.head[c] = k / 4; } }
    // highest cave cell per column (the mountain surface must stay above it)
    w.topV = new Float32Array(GW).fill(-1e9);
    for (let i = 0; i < NC; i++) if (cave[i] === 1) { const x = i % GW; if (cvv(i) > w.topV[x]) w.topV[x] = cvv(i); }
    return w;
  }

  // ---------------------------------------------------------------- drones, beacons
  const dr = [];
  for (let i = 0; i < ND; i++) dr.push({ i, id: i + 1, u: 0, v: 0, vu: 0, vv: 0, on: false, tOn: 0, role: 'wait', conn: true, path: new Int32Array(NC > 4096 ? 4096 : NC), pl: 0, pk: 0,
    tgt: -1, tdist: 1e9, decT: 0, spare: -1, carry: CARRY, good: null, last: -1, mine: new Uint8Array(NC), pend: new Int32Array(NC), pn: 0, tr: new Float32Array(20), tn: 0, th: 0, gt: 0, phase: Math.random() * TAU, hu: 0, hv: 0 });
  const beacons = [];
  let leads = [], nLeads = 1, mapped = 0, T = 0, simT = 0, endSim = 0, phase = 'run', phT = 0, leadT = 0, linkT = 0, fadeIn = 1, found = false, foundT = 0, hops = 0, sumpsSeen = 0;
  const story = {}, notes = [];
  const links = []; let nLinks = 0;

  function newMission(sd) {
    seed = sd; genWorld(sd);
    rev.fill(0); mapped = 0; beacons.length = 0; leads = []; nLeads = 1; T = 0; simT = 0; endSim = 0; phase = 'run'; phT = 0; leadT = 0; linkT = 0; fadeIn = 1; found = false; foundT = 0; hops = 0; sumpsSeen = 0;
    for (const k in story) delete story[k];
    notes.length = 0; nLinks = 0;
    for (let i = 0; i < NC; i++) if (cave[i] === 2) rev[i] = 1;                          // outside: already known
    dr.forEach((d, k) => {
      d.u = Wd.base.u + 6 + (k % 4) * 6; d.v = Wd.base.v + 6 + ((k / 4) | 0) * 7; d.vu = d.vv = 0; d.on = false; d.tOn = .3 + k * .32; d.role = 'wait'; d.conn = true;
      d.pl = 0; d.pk = 0; d.tgt = -1; d.tdist = 1e9; d.decT = 0; d.spare = -1; d.carry = CARRY; d.good = null; d.last = -1; d.mine.fill(0); d.pn = 0; d.tn = 0; d.th = 0; d.gt = 0;
    });
    if (L) { renderArt(); buildFog(); }
  }

  // reveal: what the LiDAR sees from (u, v): the air within reach that it can see through air, plus the water
  // surfaces below that air. Drones connected to the entrance write straight into the shared map; the others keep
  // what they saw until the relay chain reaches them again.
  function reveal(d) {
    const c0 = cellAt(d.u, d.v); if (c0 < 0 || c0 === d.last) return; d.last = c0;
    stampN++; let h = 0, t = 0; qq[t++] = c0; stamp[c0] = stampN;
    const cx = c0 % GW, cy = (c0 / GW) | 0, ri = RU / CS, rj = RV / CS;
    while (h < t) {
      const c = qq[h++];
      markSeen(d, c);
      const x = c % GW;
      for (let kk = 0; kk < 4; kk++) {
        const n = nbr(c, x, kk); if (n < 0 || stamp[n] === stampN || !cave[n]) continue;
        const ex = ((n % GW) - cx) / ri, ey = (((n / GW) | 0) - cy) / rj; if (ex * ex + ey * ey > 1) continue;
        stamp[n] = stampN;
        if (water[n]) { seeWater(d, n); continue; }
        qq[t++] = n;
      }
    }
  }
  // the LiDAR sees a water surface but not through it: map the water just under what it sees, a few cells around
  const wq = new Int32Array(512), wst = new Int32Array(NC); let wsN = 0;
  function seeWater(d, n0) {
    if (rev[n0] || d.mine[n0]) return;                                     // seen before, with its surroundings
    wsN++; let h = 0, t = 0; wq[t++] = n0; wst[n0] = wsN; const x0 = n0 % GW, y0 = (n0 / GW) | 0;
    while (h < t) {
      const c = wq[h++]; markSeen(d, c); const x = c % GW;
      for (let kk = 0; kk < 4; kk++) {
        const n = nbr(c, x, kk); if (n < 0 || !water[n] || wst[n] === wsN || t >= wq.length) continue;
        const ex = ((n % GW) - x0) / 6, ey = (((n / GW) | 0) - y0) / 9; if (ex * ex + ey * ey > 1) continue;
        wst[n] = wsN; wq[t++] = n;
      }
    }
  }
  function markSeen(d, c) {
    if (rev[c]) return;
    if (d.conn) setRev(c);
    else if (!d.mine[c]) { d.mine[c] = 1; d.pend[d.pn++] = c; }
  }
  function setRev(c) {
    rev[c] = 1; stampFog(c);
    for (let k = Wd.head[c]; k >= 0; k = Wd.next[k]) mapped += Wd.S[k * 4 + 3];
  }
  function flush(d) { let m = 0; for (let k = 0; k < d.pn; k++) { const c = d.pend[k]; d.mine[c] = 0; if (!rev[c]) { setRev(c); m++; } } d.pn = 0; return m; }

  // open leads: separate stretches of unmapped air that touch mapped air (each one an unexplored branch).
  // Crumbs of a few cells are just corners the LiDAR clipped: they count as seen.
  function findLeads() {
    lead.fill(0); entry.fill(0); const out = []; let id = 0;
    for (let i = 0; i < NC; i++) {
      if (!air[i] || rev[i] || lead[i]) continue;
      // does this component touch mapped air? flood it and collect the mapped air cells on its edge
      id++; let h = 0, t = 0; qq[t++] = i; lead[i] = id; const edge = []; let risky = 0, su = 0, sv = 0;
      while (h < t) {
        const c = qq[h++], x = c % GW; su += cu(c); sv += cvv(c);
        for (let kk = 0; kk < 4; kk++) {
          const n = nbr(c, x, kk); if (n < 0 || !air[n]) continue;
          if (rev[n]) { if (entry[n] !== id) { entry[n] = id; edge.push(n); if (lowNear[n]) risky = 1; } continue; }
          if (!lead[n]) { lead[n] = id; qq[t++] = n; }
        }
      }
      if (!edge.length) continue;                                             // beyond a sump: not reachable by air
      if (t < 6) { for (let k = 0; k < t; k++) setRev(qq[k]); continue; }
      let mu = 0, mv = 0; for (const e of edge) { mu += cu(e); mv += cvv(e); } mu /= edge.length; mv /= edge.length;
      let be = edge[0], bd = 1e18; for (const e of edge) { const q = (cu(e) - mu) ** 2 + (cvv(e) - mv) ** 2; if (q < bd) { bd = q; be = e; } }
      out.push({ id, size: t, edge, risky, u: su / t, v: sv / t, eu: cu(be), ev: cvv(be) });
    }
    return out;
  }

  // planning: breadth-first over the air this drone knows; distance to every open lead
  function plan(d) {
    const c0 = cellAt(d.u, d.v); if (c0 < 0) return;
    stampN++; let h = 0, t = 0; qq[t++] = c0; stamp[c0] = stampN; dist[c0] = 0; par[c0] = -1;
    pbN++;
    while (h < t) {
      const c = qq[h++], x = c % GW;
      const e = entry[c]; if (e && e < 4096 && pbS[e] !== pbN) { pbS[e] = pbN; pbC[e] = c; }
      for (let kk = 0; kk < 8; kk++) {
        const n = nbr(c, x, kk); if (n < 0 || stamp[n] === stampN || !air[n] || !(rev[n] || d.mine[n])) continue;
        const dx = (n % GW) - x, dy = n - c - dx; if (dx && dy && (!air[c + dx] || !air[c + dy])) continue;   // no cutting corners
        stamp[n] = stampN; dist[n] = dist[c] + 1; par[n] = c; qq[t++] = n;
      }
    }
    return true;
  }
  const pbS = new Int32Array(4096), pbC = new Int32Array(4096); let pbN = 0;
  const bestEntry = (id) => (id < 4096 && pbS[id] === pbN ? pbC[id] : -1);
  function pathTo(d, c) {
    let n = 0; for (let k = c; k >= 0 && n < d.path.length; k = par[k]) d.path[n++] = k;
    d.pl = n; d.pk = n - 1;                                                   // the path runs from the end backwards
  }
  function decide(d) {
    d.decT = .55 + Math.random() * .2;
    if (!d.conn) { rejoin(d); return; }
    if (!plan(d)) return;
    let pick = null, ps = 1e18, pc = -1;
    for (const L of leads) {
      const c = bestEntry(L.id); if (c < 0) continue;
      const my = dist[c];
      let closer = 0;
      for (const o of dr) if (o !== d && o.on && o.role === 'explore' && o.tgt === L.id && o.tdist <= my) closer++;   // closer drones already on it
      if (closer >= 2) continue;                                              // two is enough: the spare waits
      const sc = my * CS + closer * 240 + (L.risky ? 6000 : 0);
      if (sc < ps) { ps = sc; pick = L; pc = c; }
    }
    if (!pick) { d.tgt = -1; if (found && !leads.length) goHome(d); else toSpare(d); return; }
    if (pick.risky && !story.risky && leads.length === 1) { story.risky = 1; note(`last lead: a flooded passage with ${Math.round((Wd.N.P4[1] + Wd.N.P4[2] - (-60)) / VE0)} m of air`, pick.eu, pick.ev, C.mist, 6); }
    d.role = 'explore'; d.tgt = pick.id; d.tdist = dist[pc]; pathTo(d, pc);
  }
  function goHome(d) {
    plan(d); const c = cellAt(-30, 10); d.role = 'home';
    if (c >= 0 && stamp[c] === stampN) pathTo(d, c); else d.pl = 0;
  }
  // spare drones follow the chain forward and wait by the newest beacon, ready for the next branch
  // spare drones wait spread along the newest stretch of the chain (three per beacon), ready for the next branch
  function toSpare(d) {
    d.role = 'idle';
    let b = null;
    for (let k = beacons.length - 1; k >= 0 && !b; k--) { let n = 0; for (const o of dr) if (o !== d && o.role === 'idle' && o.spare === k) n++; if (n < 3 && beacons[k].live) b = beacons[k]; }
    if (!b) { if (!d.pl) { d.hu = d.u; d.hv = d.v; } return; }
    d.spare = b.id;
    if (Math.hypot(d.u - b.u, d.v - b.v) < 30) { if (!d.pl) { d.hu = d.u; d.hv = d.v; } return; }
    plan(d); const c = cellAt(b.u, b.v);
    if (c >= 0 && stamp[c] === stampN) pathTo(d, c); else { d.pl = 0; d.hu = d.u; d.hv = d.v; }
  }

  function move(d, dt) {
    let tu = d.u, tv = d.v;
    if ((d.role === 'explore' || d.role === 'home' || d.role === 'rejoin' || d.role === 'idle') && d.pl) {
      while (d.pk > 0) { const c = d.path[d.pk]; if (Math.hypot(cu(c) - d.u, cvv(c) - d.v) < 9) d.pk--; else break; }
      const look = d.path[Math.max(0, d.pk - 1)]; tu = cu(look); tv = cvv(look);
      if (d.pk <= 0) { tu = cu(d.path[0]); tv = cvv(d.path[0]); if (d.role === 'idle' && Math.hypot(tu - d.u, tv - d.v) < 10) { d.pl = 0; d.hu = tu; d.hv = tv; } }
    } else if (d.role === 'gather' || d.role === 'idle') { tu = d.hu; tv = d.hv; }
    let du = tu - d.u, dv = tv - d.v; const L = Math.hypot(du, dv) || 1e-6, v = d.role === 'explore' || d.role === 'home' || d.role === 'rejoin' ? SPEED : Math.min(SPEED, L * 2.5);
    let au = du / L * v, av = dv / L * v;
    for (const o of dr) { if (o === d || !o.on) continue; const eu = d.u - o.u, ev = d.v - o.v, e2 = eu * eu + ev * ev; if (e2 < 144 && e2 > 1e-4) { const e = Math.sqrt(e2), f = (12 - e) / 12 * 30; au += eu / e * f; av += ev / e * f; } }
    av += Math.sin(T * 3 + d.phase) * 6;                                   // hovering bob
    const k = 1 - Math.exp(-dt * 6); d.vu += (au - d.vu) * k; d.vv += (av - d.vv) * k;
    const nu = d.u + d.vu * dt, nv = d.v + d.vv * dt, nc = cellAt(nu, nv);
    if (nc >= 0 && (air[nc] || cave[nc] === 2)) { d.u = nu; d.v = nv; }
    else if (d.pl && d.pk >= 0) {                                             // blocked: slide along the planned cells instead
      const c = d.path[Math.max(0, d.pk - 1)], gu = cu(c) - d.u, gv = cvv(c) - d.v, gl = Math.hypot(gu, gv) || 1, st = Math.min(gl, SPEED * dt);
      d.u += gu / gl * st; d.v += gv / gl * st; d.vu = gu / gl * SPEED * .5; d.vv = gv / gl * SPEED * .5;
    } else { const c1 = cellAt(nu, d.v), c2 = cellAt(d.u, nv); if (c1 >= 0 && air[c1]) d.u = nu; else if (c2 >= 0 && air[c2]) d.v = nv; d.vu *= .5; d.vv *= .5; }
    d.th -= dt; if (d.th <= 0) { d.th = .08; const o = (d.tn % 10) * 2; d.tr[o] = d.u; d.tr[o + 1] = d.v; d.tn++; }
  }

  // radio: line of sight through open cave (air or water), within range
  function los(au, av, bu, bv) {
    const du = bu - au, dv = bv - av, L = Math.hypot(du, dv); if (L > RR) return false;
    const n = Math.ceil(L / 4);
    for (let k = 1; k < n; k++) { const c = cellAt(au + du * k / n, av + dv * k / n); if (c < 0 || !cave[c]) return false; }
    return true;
  }
  const NB = 64, NN = NB + ND + 1, adjM = new Uint8Array(NN * NN), nodeU = new Float32Array(NB + ND + 1), nodeV = new Float32Array(NB + ND + 1), seen = new Uint8Array(NB + ND + 1), hop = new Int16Array(NB + ND + 1), nq = new Int16Array(NB + ND + 1);
  function computeLinks() {
    // nodes: 0 = base, 1..B = beacons, then drones
    const B = beacons.length, n = 1 + B + ND;
    nodeU[0] = Wd.base.u; nodeV[0] = Wd.base.v + 10;
    for (let k = 0; k < B; k++) { nodeU[1 + k] = beacons[k].u; nodeV[1 + k] = beacons[k].v; }
    for (let k = 0; k < ND; k++) { nodeU[1 + B + k] = dr[k].u; nodeV[1 + B + k] = dr[k].v; }
    nLinks = 0; adjM.fill(0);
    for (let a = 0; a < n; a++) {
      if (a > B && !dr[a - 1 - B].on) continue;
      for (let b = a + 1; b < n; b++) {
        if (b > B && !dr[b - 1 - B].on) continue;
        if (a >= 1 && a <= B && b >= 1 && b <= B && !beacons[a - 1].nb.includes(b - 1)) continue;   // beacon pairs: fixed when dropped
        if (!los(nodeU[a], nodeV[a], nodeU[b], nodeV[b])) continue;
        adjM[a * NN + b] = adjM[b * NN + a] = 1; links[nLinks++] = a; links[nLinks++] = b;
      }
    }
    seen.fill(0); let h = 0, t = 0; nq[t++] = 0; seen[0] = 1; hop[0] = 0;
    while (h < t) { const a = nq[h++]; for (let b = 0; b < n; b++) if (adjM[a * NN + b] && !seen[b]) { seen[b] = 1; hop[b] = hop[a] + 1; nq[t++] = b; } }
    for (let k = 0; k < B; k++) { beacons[k].live = !!seen[1 + k]; beacons[k].hop = hop[1 + k]; }
    for (let k = 0; k < ND; k++) {
      const d = dr[k]; if (!d.on) continue;
      const c = !!seen[1 + B + k];
      if (c && !d.conn) { const m = flush(d); if (m > 8 && !story.merge && phase === 'run' && T > 10) { story.merge = 1; note(`drone ${d.id} is back on the chain: what it mapped alone merges in`, d.u, d.v, C.teal, 5); } }
      d.conn = c; d.hop = c ? hop[1 + B + k] : 0;
    }
  }
  // the relay rule: each exploring drone remembers the last spot where it could still see a beacon (or the
  // entrance) well within range. When that is about to be lost, it drops a beacon there. At a junction it drops one
  // too: its RFID tag records which branches the swarm has taken.
  function anchorOK(u, v) {
    if (los(Wd.base.u, Wd.base.v + 10, u, v) && Math.hypot(u - Wd.base.u, v - Wd.base.v - 10) < RR * .75) return true;
    for (const b of beacons) if (Math.hypot(u - b.u, v - b.v) < RR * .75 && los(b.u, b.v, u, v)) return true;
    return false;
  }
  function drop(d, u, v, kind, gap = 40) {
    if (d.carry <= 0 || beacons.length >= NB) return null;
    for (const b of beacons) if (Math.hypot(b.u - u, b.v - v) < gap) return null;
    const nb = []; beacons.forEach((b, k) => { if (Math.hypot(b.u - u, b.v - v) < RR && los(b.u, b.v, u, v)) nb.push(k); });
    const me = { u, v, kind, t: 0, nb: [], id: beacons.length, live: true };
    for (const k of nb) { beacons[k].nb.push(me.id); me.nb.push(k); }
    beacons.push(me); d.carry--;
    if (kind === 'relay' && !story.relay && phase === 'run') { story.relay = 1; note(`drone ${d.id} drops a relay beacon: rock blocks the radio`, u, v, C.teal, 5.5); }
    if (kind === 'tag' && !story.tag && phase === 'run') { story.tag = 1; note('junction: an RFID tag records which branches are done', u, v, C.teal, 5.5); }
    return me;
  }
  function relayRule(d) {
    if (!d.conn || d.role === 'wait') return;
    const ok = anchorOK(d.u, d.v);
    if (ok) for (const jn of Wd.junc) if (Math.hypot(d.u - jn.u, d.v - jn.v) < 24 && !beacons.some((b) => Math.hypot(b.u - jn.u, b.v - jn.v) < 50)) drop(d, d.u, d.v, 'tag');
    if (ok) { d.good = [d.u, d.v]; return; }
    if (d.good) { drop(d, d.good[0], d.good[1], 'relay', 14); d.good = anchorOK(d.u, d.v) ? [d.u, d.v] : null; }
  }
  // a drone that has lost its link flies back toward the nearest beacon until it hears the chain again
  function rejoin(d) {
    let b = Wd.base, bd = 1e18; beacons.forEach((q) => { if (!q.live) return; const e = Math.hypot(q.u - d.u, q.v - d.v); if (e < bd) { bd = e; b = q; } });
    plan(d); let c = cellAt(b.u, b.v + (b === Wd.base ? 10 : 0));
    if (c >= 0 && stamp[c] !== stampN) { let best = -1, bq = 1e18; for (let i = 0; i < NC; i++) if (stamp[i] === stampN) { const q = (cu(i) - b.u) ** 2 + (cvv(i) - b.v) ** 2; if (q < bq) { bq = q; best = i; } } c = best; }
    d.role = 'rejoin'; d.tgt = -1; if (c >= 0) pathTo(d, c); else d.pl = 0;
  }

  function note(txt, u, v, col = C.ink, dur = 5, d = null) { notes.push({ txt, u, v, col, t: 0, dur, d }); if (notes.length > 7) notes.shift(); }

  function step(dt) {
    T += dt;
    if (fadeIn > 0) fadeIn = Math.max(0, fadeIn - dt / .9);
    if (phase === 'fade') { phT += dt; if (phT > 1.3) newMission(seed + 1); return; }
    if (phase === 'run') simT += dt * TL;
    for (const d of dr) if (!d.on && T >= d.tOn) { d.on = true; d.role = 'idle'; d.hu = 14 + d.i * 3; d.hv = 10; d.decT = .3; }
    leadT -= dt; if (leadT <= 0) { leadT = .25; leads = findLeads(); nLeads = leads.length; }
    linkT -= dt; if (linkT <= 0) { linkT = .1; computeLinks(); for (const d of dr) if (d.on) relayRule(d); }
    for (const d of dr) {
      if (!d.on) continue;
      d.decT -= dt;
      if (d.role === 'explore' && d.pk <= 2) d.decT = Math.min(d.decT, .1);  // nearly at the edge of the map: look again soon
      if (d.role === 'rejoin' && d.conn) { d.role = 'idle'; d.decT = 0; }
      if ((d.role === 'explore' || d.role === 'idle' || d.role === 'rejoin' || (d.role === 'home' && nLeads > 0)) && d.decT <= 0 && phase === 'run') decide(d);
      if (d.role === 'gather') { d.gt -= dt; }
      move(d, dt);
      if (phase === 'run' || phase === 'done') reveal(d);
    }
    // events
    for (const s of Wd.sumps) if (!s.seen) { const c = cellAt(s.u, s.v + 10), c2 = cellAt(s.u, s.v - 6); if ((c >= 0 && rev[c]) || (c2 >= 0 && rev[c2])) { s.seen = true; s.t = 0; sumpsSeen++; if (!story.sump) { story.sump = 1; note('sump: the water meets the roof, divers only', s.u, s.v, C.mist, 6); } } }
    for (const s of Wd.sumps) s.t += dt;
    for (const b of beacons) b.t += dt;
    if (!story.water) { for (const d of dr) { if (!d.on || !d.conn) continue; const c = cellAt(d.u, d.v - 30); if (c >= 0 && water[c] && rev[c] && d.u > 200) { story.water = 1; note('flooded passage: the drones fly over the water', d.u, d.v - 20, C.mist, 5); break; } } }
    for (const e of Wd.ends) if (!e.done) { const c = cellAt(e.u, e.v); if (c >= 0 && rev[c] && !leads.some((L) => Math.abs(L.u - e.u) < 80 && Math.abs(L.v - e.v) < 80)) { e.done = true; if (!story.dead) { story.dead = 1; note('dry dead end: nobody here', e.u, e.v, C.muted, 4); } } }
    if (!found) { const c = cellAt(Wd.people.u, Wd.people.v); if (c >= 0 && rev[c]) { found = true; foundT = T; gather(); } }
    if (!story.enter && T > .4) { story.enter = 1; note('12 drones go in: no GPS, no radio through rock', 30, 20, C.ink, 5); }
    if (found && !story.f2 && T > foundT + 1.6) {
      // hops from the shelf to the entrance: the nearest linked drone or beacon by the group
      let hb = 0; const P = Wd.people;
      for (const d of dr) if (d.on && d.conn && d.hop > 0 && Math.hypot(d.u - P.u, d.v - P.v) < 260) hb = hb ? Math.min(hb, d.hop) : d.hop;
      for (const b of beacons) if (b.live && b.hop > 0 && Math.hypot(b.u - P.u, b.v - P.v) < 260) hb = hb ? Math.min(hb, b.hop + 1) : b.hop + 1;
      if (hb) { story.f2 = 1; hops = hb; note(`the beacon chain carries it out: ${hops} hops to the entrance`, P.u - 60, P.v + 40, C.teal, 6); }
    }
    if (phase === 'run' && found && nLeads === 0 && T > foundT + 3 && (story.f2 || T > foundT + 8)) { phase = 'done'; phT = 0; endSim = simT; note('no branch left unexplored', Wd.people.u - 200, Wd.people.v + 80, C.teal, 3); }
    else if (phase === 'run' && T > 85) { phase = 'done'; phT = 0; endSim = simT; }
    if (phase === 'done') { phT += dt; if (phT > 1.6) { phase = 'summary'; phT = 0; for (const d of dr) if (d.on && d.role !== 'gather') goHome(d); } }
    else if (phase === 'summary') { phT += dt; if (phT > 6) { phase = 'fade'; phT = 0; } }
    for (const n of notes) n.t += dt;
    while (notes.length && notes[0].t > notes[0].dur) notes.shift();
  }
  function gather() {
    const P = Wd.people, spots = [];
    for (let i = 0; i < NC && spots.length < 40; i++) if (air[i] && rev[i] && Math.abs(cu(i) - P.u) < 70 && cvv(i) > P.v + 6 && cvv(i) < P.v + 60) spots.push(i);
    const near = dr.filter((d) => d.on).sort((a, b) => Math.hypot(a.u - P.u, a.v - P.v) - Math.hypot(b.u - P.u, b.v - P.v)).slice(0, 3);
    near.forEach((d, k) => { const c = spots.length ? spots[Math.floor((k + .5) / 3 * spots.length)] : cellAt(P.u, P.v + 20); d.role = 'gather'; d.hu = cu(c); d.hv = cvv(c); d.gt = 99; });
    story.deep = Math.round(Wd.deep);
    note(`13 people on a high shelf, ${Math.round((Wd.shelf.top + 60) / VE0)} m above the water`, P.u, P.v, C.heat, 7);
  }
  // ---------------------------------------------------------------- art
  const sky = mk(), art = mk(), fog = mk(), lo = mk(), msk = mk();
  let fctx = null, L = null, lastLeft = null, ridge = new Float32Array(2);
  const dot = mk(32, 32);
  { const x = dot.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(.55, 'rgba(0,0,0,.85)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); }
  const soft = (col) => { const c = mk(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, col(1)); g.addColorStop(.35, col(.45)); g.addColorStop(1, col(0)); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c; };
  const glowT = soft((a) => `rgba(127,212,207,${a * .6})`), glowH = soft((a) => `rgba(255,195,107,${a * .95})`), lamp = soft((a) => `rgba(236,240,220,${a * .42})`);
  const X = (u) => L.ox + u * L.sx, Y = (v) => L.oy - v * L.sy;

  function layout() {
    const W = cv.w, H = cv.h, left = parseFloat(stage.dataset.left || '0') || 0, phone = W < 640;
    const x0 = phone ? 12 : Math.max(16, left * W + 20), x1 = W - (phone ? 12 : 24);
    const sx = (x1 - x0) / (U1 - U0), yB = H - (phone ? 104 : 96), band = phone ? Math.min(H * .52, H - 104 - 140) : H * .56;
    const k = clamp(band / ((V1 - V0) * sx), 1, 3.6), sy = sx * k;
    L = { W, H, phone, x0, x1, sx, sy, k, ox: x0 - U0 * sx, oy: yB + V0 * sy, yB, yT: yB - (V1 - V0) * sy };
    lastLeft = stage.dataset.left;
    renderArt(); buildFog();
  }

  function renderArt() {
    const { W, H, sx, sy } = L, dpr = cv.dpr, pw = Math.max(2, Math.round(W * dpr)), ph = Math.max(2, Math.round(H * dpr)), w = Wd, R = kit.rng(w.sd * 911 + 5);
    sky.width = art.width = pw; sky.height = art.height = ph;
    const s = sky.getContext('2d'); s.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 1. dusk sky in monsoon cloud, two hazy ranges behind
    let g = s.createLinearGradient(0, 0, 0, H * .62); g.addColorStop(0, '#191b37'); g.addColorStop(.55, '#2e3060'); g.addColorStop(1, '#5a5690');
    s.fillStyle = g; s.fillRect(0, 0, W, H);
    g = s.createRadialGradient(W * .3, H * .5, 10, W * .3, H * .5, W * .6); g.addColorStop(0, 'rgba(239,177,180,.18)'); g.addColorStop(1, 'rgba(239,177,180,0)'); s.fillStyle = g; s.fillRect(0, 0, W, H);
    s.globalAlpha = .35;
    for (let k = 0; k < 9; k++) { const cx = R() * W, cy = H * (.08 + R() * .25), rx = W * (.15 + R() * .2); const cg = s.createRadialGradient(cx, cy, 2, cx, cy, rx); cg.addColorStop(0, 'rgba(20,22,46,.55)'); cg.addColorStop(1, 'rgba(20,22,46,0)'); s.fillStyle = cg; s.beginPath(); s.ellipse(cx, cy, rx, rx * .28, 0, 0, TAU); s.fill(); }
    s.globalAlpha = 1;
    const range = (base, amp, sc, col, sd) => { s.fillStyle = col; s.beginPath(); s.moveTo(0, H); for (let x = 0; x <= W; x += 4) s.lineTo(x, base - amp * fbm(x / sc, sd, w.s1 + sd, 4)); s.lineTo(W, H); s.fill(); };
    range(L.yT - 40, H * .28, 260, '#3c3c72', 3); range(L.yT + 10, H * .22, 190, '#34335f', 7);
    // 2. the mountain: surface line (cliff over the entrance, a ridge with jungle), strata, joints
    const a = art.getContext('2d'); a.setTransform(dpr, 0, 0, dpr, 0, 0); a.clearRect(0, 0, W, H);
    const xE = X(8), yG = Y(w.ground);
    ridge = new Float32Array(Math.ceil(W) + 2);
    // karst towers: steep-sided limestone bumps standing on a shoulder just above the cave
    const shoulder = L.yT + (L.phone ? 6 : 14), towers = [];
    for (let x = xE + (L.phone ? 20 : 40); x < W + 80;) { const hw = (L.phone ? 22 : 46) + R() * (L.phone ? 30 : 70); towers.push(x + hw * .6, hw, (L.phone ? .45 : .5) + R() * .5); x += hw * (1.1 + R() * .7); }
    const topY = L.phone ? 96 : Math.max(96, H * .13);
    for (let x = 0; x <= W + 1; x++) {
      let y;
      if (x < xE - 4) y = yG - 4 * fbm(x / 60, 1, w.s1, 2);
      else {
        const u = (x - L.ox) / sx, col = clamp(Math.floor((u - U0) / CS), 0, GW - 1), lim = Y(Math.max(w.topV[col], -100)) - (L.phone ? 14 : 24);
        let prof = shoulder - (L.phone ? 10 : 22) * fbm(x / 90, 2.2, w.s2, 3);
        const ramp = .35 + .65 * sstep(0, 1, (x - xE) / (L.phone ? 90 : 260));   // lower hills by the entrance, towers behind
        for (let k = 0; k < towers.length; k += 3) { const t = (x - towers[k]) / towers[k + 1]; if (t > -1 && t < 1) prof = Math.min(prof, shoulder - (shoulder - topY) * towers[k + 2] * ramp * Math.pow(1 - t * t, .55)); }
        prof -= 7 * (fbm(x / 14, 6.1, w.s1 + 4, 2) - .5) + 5 * Math.max(0, Math.sin(x / 6.5) - .7);
        const rise = sstep(0, 1, (x - xE) / (L.phone ? 40 : 110)) + (fbm(x / 9, 3.3, w.s2, 2) - .5) * .15;
        y = Math.min(lim, lerp(Y(66), prof, rise));
      }
      ridge[x] = y;
    }
    const body = new Path2D(); body.moveTo(0, H); for (let x = 0; x <= W + 1; x++) body.lineTo(x, ridge[x]); body.lineTo(W + 1, H); body.closePath();
    // limestone: dark, faintly banded, mottled, lit from the left, darker with depth; drawn at a third resolution
    const q = 3, lw = Math.ceil(W / q) + 2, lh = Math.ceil(H / q) + 2; lo.width = lw; lo.height = lh;
    const lx = lo.getContext('2d'), im = lx.createImageData(lw, lh), px = im.data;
    for (let jy = 0; jy < lh; jy++) for (let ix = 0; ix < lw; ix++) {
      const x = ix * q, y = jy * q, warp = fbm(x / 160, y / 160, w.s1 + 3, 3) * 60, b = (y + x * .05 + warp) / (L.phone ? 11 : 17), f = b - Math.floor(b);
      const band = 1 + .07 * Math.sin(b * 1.7) * Math.sin(b * .63 + 1) - (f < .07 ? .14 : 0);
      const mott = .84 + .32 * fbm(x / 26, y / 26, w.s2 + 9, 3), depth = 1 - .38 * sstep(L.yT, H, y), lit = 1.1 - .2 * (x / W);
      const v = band * mott * depth * lit, o = (jy * lw + ix) * 4;
      px[o] = 50 * v; px[o + 1] = 49 * v; px[o + 2] = 88 * v; px[o + 3] = 255;
    }
    lx.putImageData(im, 0, 0);
    a.save(); a.clip(body); a.imageSmoothingEnabled = true; a.drawImage(lo, -q / 2, -q / 2, lw * q, lh * q);
    // joints and faults
    a.strokeStyle = 'rgba(24,24,50,.45)'; a.lineWidth = 1;
    for (let k = 0; k < 26; k++) { let x = R() * W, y = H * (.2 + R() * .8); a.beginPath(); a.moveTo(x, y); for (let m = 0; m < 6; m++) { x += (R() - .5) * 10; y += 6 + R() * 10; a.lineTo(x, y); } a.stroke(); }
    a.strokeStyle = 'rgba(20,20,44,.4)'; a.lineWidth = 1.2;
    for (let k = 0; k < 3; k++) { let x = xE + (W - xE) * (.15 + .3 * k + R() * .1), y = ridge[Math.min(W, Math.round(x))] || 0; a.beginPath(); a.moveTo(x, y); while (y < H) { x += 4 + R() * 6; y += 8 + R() * 10; a.lineTo(x + (R() - .5) * 3, y); } a.stroke(); }
    // seepage: faint vertical karst fissures from the surface (the rain gets in)
    a.strokeStyle = 'rgba(94,127,176,.22)'; a.lineWidth = 1.1;
    for (let k = 0; k < 18; k++) { let x = xE + 30 + R() * (W - xE - 40), y = ridge[Math.min(W, Math.round(x))]; a.beginPath(); a.moveTo(x, y); const n = 4 + R() * 8; for (let m = 0; m < n; m++) { x += (R() - .5) * 5; y += 5 + R() * 9; a.lineTo(x, y); } a.stroke(); }
    // the water table: below it the rock is saturated (bluer, darker); a dashed line marks the level
    const yt = Y(w.table);
    g = a.createLinearGradient(0, yt, 0, H); g.addColorStop(0, 'rgba(48,72,118,.22)'); g.addColorStop(1, 'rgba(36,54,96,.45)'); a.fillStyle = g; a.fillRect(0, yt, W, H - yt);
    a.setLineDash([6, 7]); a.strokeStyle = 'rgba(143,183,208,.32)'; a.lineWidth = 1; a.beginPath(); a.moveTo(xE, yt); a.lineTo(W, yt); a.stroke(); a.setLineDash([]);
    a.restore();
    // the surface edge, the jungle on it, the valley floor on the left
    a.strokeStyle = 'rgba(143,140,196,.35)'; a.lineWidth = 1.2; a.beginPath(); for (let x = 0; x <= W; x += 2) x ? a.lineTo(x, ridge[x]) : a.moveTo(x, ridge[x]); a.stroke();
    const tree = (x, y, r0, c1, c2) => { a.fillStyle = c1; a.beginPath(); a.arc(x, y, r0, 0, TAU); a.fill(); a.fillStyle = c2; a.beginPath(); a.arc(x - r0 * .25, y - r0 * .3, r0 * .55, 0, TAU); a.fill(); };
    for (let x = 0; x <= W; x += L.phone ? 3 : 4) {
      const y = ridge[x], r0 = (L.phone ? 2.4 : 3.4) + R() * (L.phone ? 2.4 : 3.6) + (x < xE ? 2 : 0);
      if (R() < .25) continue;
      tree(x + R() * 2, y - r0 * .4, r0, R() < .5 ? '#2a3d3a' : '#31463f', R() < .5 ? 'rgba(111,143,122,.55)' : 'rgba(157,184,160,.35)');
    }
    // the base camp at the entrance: tents, a light
    const bx = X(w.base.u), by = Y(w.base.v);
    for (let k = 0; k < 3; k++) { const tx = bx - 10 + k * 11, ty = by; a.fillStyle = k === 1 ? C.apricot : 'rgba(246,210,177,.75)'; a.beginPath(); a.moveTo(tx - 5, ty); a.lineTo(tx, ty - 7); a.lineTo(tx + 5, ty); a.closePath(); a.fill(); }
    const lgl = a.createRadialGradient(bx + 4, by - 6, 1, bx + 4, by - 6, 30); lgl.addColorStop(0, 'rgba(246,210,177,.35)'); lgl.addColorStop(1, 'rgba(246,210,177,0)'); a.fillStyle = lgl; a.fillRect(bx - 30, by - 40, 70, 70);
    // 3. fog source: the rock as it looks before anything is mapped, kept for the unexplored cave
    buildFogSource();
    // 4. the cave, drawn as it will look once mapped: a teal-rimmed glow, dark air, water, speleothems, the shelf
    const S = w.S, ell = (p, extra, f = 1) => { for (let k = 0; k < S.length; k += 4) { const x = X(S[k]), y = Y(S[k + 1]), rx = S[k + 2] * sx * f + extra, ry = S[k + 2] * SQ * sy * f + extra; if (rx <= 0 || ry <= 0) continue; p.moveTo(x + rx, y); p.ellipse(x, y, rx, ry, 0, 0, TAU); } };
    a.save(); a.clip(body);
    let p = new Path2D(); ell(p, 9); a.fillStyle = 'rgba(127,212,207,.07)'; a.fill(p);
    p = new Path2D(); ell(p, 4); a.fillStyle = 'rgba(127,212,207,.1)'; a.fill(p);
    p = new Path2D(); ell(p, 1.6); a.fillStyle = 'rgba(127,212,207,.6)'; a.fill(p);
    const inner = new Path2D(); ell(inner, 0); a.fillStyle = '#171a36'; a.fill(inner);
    p = new Path2D(); ell(p, -1, .7); a.fillStyle = 'rgba(64,76,130,.22)'; a.fill(p);
    p = new Path2D(); ell(p, -1, .4); a.fillStyle = 'rgba(110,150,170,.08)'; a.fill(p);
    a.save(); a.clip(inner);
    // speleothems from ceilings and on dry floors of the larger rooms
    a.fillStyle = 'rgba(170,166,214,.55)'; a.beginPath();
    for (let i = GW; i < NC - GW; i++) {
      if (cave[i] !== 1 || water[i]) continue;
      const up = !cave[i - GW], down = !cave[i + GW] && !water[i + GW];
      if (!up && !down) continue;
      let hgt = 0; for (let m = i; m < NC && m >= 0 && cave[m] === 1 && hgt < 9; m += up ? GW : -GW) hgt++;
      if (hgt < 6 || R() > .55) continue;
      const x = X(cu(i)) + (R() - .5) * CS * sx, len = (3 + R() * (up ? 9 : 5)) * Math.min(1.4, L.k * .7), wd = 1.2 + R() * 1.6;
      if (up) { const y = Y(cvv(i) + CS / 2) - 1; a.moveTo(x - wd, y); a.lineTo(x + wd, y); a.lineTo(x, y + len); }
      else { const y = Y(cvv(i) - CS / 2) + 1; a.moveTo(x - wd, y); a.lineTo(x + wd, y); a.lineTo(x, y - len * .7); }
    }
    a.fill();
    // water: per basin, every water cell grown by one cell and cut at the level (the clip keeps it inside the
    // passage), so the shores follow the rock and the surface is one flat line
    w.surf = []; w.surfArt = [];
    { const yl = Y(w.table), gw = a.createLinearGradient(0, yl, 0, Math.max(yl + 40, Y(V0))); gw.addColorStop(0, 'rgba(94,127,176,.94)'); gw.addColorStop(.45, 'rgba(58,88,140,.95)'); gw.addColorStop(1, 'rgba(30,48,90,.97)');
      a.fillStyle = gw; a.fillRect(0, yl, W, H - yl);
      const cw = CS * sx, jj = Math.floor((V1 - w.table) / CS);
      for (const row of [jj - 1, jj]) {
        if (row < 0 || row >= GH) continue;
        let run = -1;
        for (let ii = 0; ii <= GW; ii++) {
          const c = row * GW + ii, top = V1 - row * CS, isW = ii < GW && cave[c] === 1 && top - CS < w.table && top >= w.table - CS && (water[c] || water[c + GW]);
          if (isW && run < 0) run = ii;
          if (!isW && run >= 0) { const xa = X(U0 + run * CS), xb = X(U0 + ii * CS); w.surf.push(xa, xb, yl, 0); w.surfArt.push(xa - cw * 1.5, xb + cw * 1.5, yl); run = -1; }
        }
      }
    }
    a.strokeStyle = 'rgba(143,183,208,.9)'; a.lineWidth = 1.2; a.beginPath();
    for (let k = 0; k < w.surfArt.length; k += 3) { a.moveTo(w.surfArt[k], w.surfArt[k + 2]); a.lineTo(w.surfArt[k + 1], w.surfArt[k + 2]); }
    a.stroke();
    a.strokeStyle = 'rgba(143,183,208,.13)'; a.lineWidth = 1; a.beginPath();
    for (let k = 0; k < w.surfArt.length; k += 3) for (let m = 1; m < 5; m++) { const y = w.surfArt[k + 2] + m * 5 * Math.max(1, L.k * .55), x0 = w.surfArt[k] + 6 + m * 5, x1 = w.surfArt[k + 1] - 6 - m * 4; if (x1 > x0) { a.moveTo(x0, y); a.lineTo(x1, y); } }
    a.stroke();
    // the shelf: a ledge of pale rock on the far wall
    const sh = w.shelf;
    const lg = a.createLinearGradient(0, Y(sh.top), 0, Y(-100)); lg.addColorStop(0, '#77729f'); lg.addColorStop(1, '#3f3c66');
    a.fillStyle = lg; a.beginPath(); a.moveTo(X(sh.u0), Y(sh.top)); a.lineTo(X(sh.u1 + 12), Y(sh.top + 3)); a.lineTo(X(sh.u1 + 12), Y(-100)); a.lineTo(X(sh.u0 + 34), Y(-100)); a.quadraticCurveTo(X(sh.u0 + 4), Y(sh.top - 18), X(sh.u0), Y(sh.top)); a.fill();
    a.strokeStyle = 'rgba(232,226,246,.7)'; a.lineWidth = 1.6; a.beginPath(); a.moveTo(X(sh.u0), Y(sh.top)); a.lineTo(X(sh.u1 + 8), Y(sh.top + 3)); a.stroke();
    a.restore(); a.restore();
  }

  // the fog: the plain rock, copied over every cave cell (a little wider), then erased cell by cell as mapped
  function buildFogSource() {
    const { W, H, sx, sy } = L, S = Wd.S;
    fog.width = Math.max(2, Math.round(W)); fog.height = Math.max(2, Math.round(H));
    const f = fog.getContext('2d');
    f.drawImage(art, 0, 0, W, H);
    f.globalCompositeOperation = 'destination-in';
    const p = new Path2D(); for (let k = 0; k < S.length; k += 4) { const x = X(S[k]), y = Y(S[k + 1]), rx = S[k + 2] * sx + 8, ry = S[k + 2] * SQ * sy + 8; p.moveTo(x + rx, y); p.ellipse(x, y, rx, ry, 0, 0, TAU); }
    f.fillStyle = '#000'; f.fill(p);
    f.globalCompositeOperation = 'destination-out'; fctx = f;
  }
  function buildFog() { for (let i = 0; i < NC; i++) if (rev[i]) stampFog(i); }
  function stampFog(c) {
    if (!fctx || !L) return;
    const wet = water[c] ? 1.5 : 1, x = X(cu(c)), y = Y(cvv(c)), rx = (CS * L.sx * 1.9 + 2) * wet, ry = CS * L.sy * 1.9 + 2;
    fctx.drawImage(dot, x - rx, y - ry, 2 * rx, 2 * ry);
  }

  // ---------------------------------------------------------------- drawing
  const rects = []; let nR = 0;
  const free = (x, y, w, h) => { for (let k = 0; k < nR; k += 4) if (x < rects[k] + rects[k + 2] && rects[k] < x + w && y < rects[k + 1] + rects[k + 3] && rects[k + 1] < y + h) return false; return true; };
  const hold = (x, y, w, h) => { rects[nR++] = x; rects[nR++] = y; rects[nR++] = w; rects[nR++] = h; };
  const rain = new Float32Array(120 * 3); for (let k = 0; k < 120; k++) { rain[k * 3] = Math.random(); rain[k * 3 + 1] = Math.random(); rain[k * 3 + 2] = .6 + Math.random() * .8; }
  function drone(x, y, sz, col, lw) {
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(x - sz, y - sz); ctx.lineTo(x + sz, y + sz); ctx.moveTo(x + sz, y - sz); ctx.lineTo(x - sz, y + sz); ctx.stroke();
    const rr = sz * .5; ctx.beginPath();
    for (let k = 0; k < 4; k++) { const px = x + (k & 1 ? sz : -sz), py = y + (k & 2 ? sz : -sz); ctx.moveTo(px + rr, py); ctx.arc(px, py, rr, 0, TAU); }
    ctx.stroke();
  }
  const fmtMin = (sec) => { const m = Math.round(sec / 60); return m >= 60 ? `${(m / 60) | 0} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
  const fmtLen = (m) => m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m';
  let hoverD = null;

  function draw() {
    if (stage.dataset.left !== lastLeft) layout();
    const { W, H, phone } = L;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(sky, 0, 0, W, H);
    // monsoon rain over the sky only
    ctx.strokeStyle = 'rgba(220,228,238,.2)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 0; k < 120; k++) {
      const sp = rain[k * 3 + 2], x = ((rain[k * 3] * W + T * 60 * sp) % (W + 40)) - 20, y = ((rain[k * 3 + 1] * H + T * 520 * sp) % (H * .9));
      const xi = Math.round(clamp(x, 0, W)); if (y + 10 > ridge[xi]) continue;
      ctx.moveTo(x, y); ctx.lineTo(x - 2.2, y + 10 * sp);
    }
    ctx.stroke();
    ctx.drawImage(art, 0, 0, W, H);
    // light on the mapped water surfaces
    ctx.setLineDash([5, 13]); ctx.lineDashOffset = -T * 14; ctx.strokeStyle = 'rgba(220,236,246,.55)'; ctx.lineWidth = 1; ctx.beginPath();
    const sf = Wd.surf; for (let k = 0; k < sf.length; k += 4) { ctx.moveTo(sf[k] + 2, sf[k + 2] + .5); ctx.lineTo(sf[k + 1] - 2, sf[k + 2] + .5); }
    ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    ctx.globalAlpha = .93; ctx.drawImage(fog, 0, 0, W, H); ctx.globalAlpha = 1;   // a faint hint of the cave nobody has seen yet
    // drone lamps
    ctx.globalCompositeOperation = 'lighter';
    for (const d of dr) { if (!d.on) continue; const r = phone ? 16 : 26; ctx.globalAlpha = d.conn ? .55 : .3; ctx.drawImage(lamp, X(d.u) - r, Y(d.v) - r * .85, 2 * r, 1.7 * r); }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // radio links: the beacon chain and the drones on it
    const B = beacons.length;
    ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(127,212,207,.42)'; ctx.beginPath();
    for (let k = 0; k < nLinks; k += 2) { const a = links[k], b = links[k + 1]; if (!seen[a] || !seen[b]) continue; ctx.moveTo(X(nodeU[a]), Y(nodeV[a])); ctx.lineTo(X(nodeU[b]), Y(nodeV[b])); }
    ctx.stroke(); ctx.setLineDash([]);
    // sump markers
    for (const s of Wd.sumps) {
      if (!s.seen) continue;
      const x = X(s.u), y = Y(s.v), a = Math.min(1, s.t / .6);
      ctx.globalAlpha = a; ctx.strokeStyle = '#8FB7D0'; ctx.lineWidth = 1.4; ctx.beginPath();
      for (let m = 0; m < 3; m++) { const yy = y - 6 - m * 4; ctx.moveTo(x - 6, yy); ctx.quadraticCurveTo(x - 3, yy - 2.5, x, yy); ctx.quadraticCurveTo(x + 3, yy + 2.5, x + 6, yy); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    // beacons: small diamonds, junction tags ringed
    for (const b of beacons) {
      const x = X(b.u), y = Y(b.v), s2 = phone ? 3 : 4, pulse = (T * .8 + b.id * .37) % 1;
      ctx.strokeStyle = `rgba(127,212,207,${.5 * (1 - pulse)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, s2 + 2 + pulse * 9, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#15172e'; ctx.beginPath(); ctx.moveTo(x, y - s2 - 1.5); ctx.lineTo(x + s2 + 1.5, y); ctx.lineTo(x, y + s2 + 1.5); ctx.lineTo(x - s2 - 1.5, y); ctx.fill();
      ctx.fillStyle = b.kind === 'tag' ? C.apricot : C.teal; ctx.beginPath(); ctx.moveTo(x, y - s2); ctx.lineTo(x + s2, y); ctx.lineTo(x, y + s2); ctx.lineTo(x - s2, y); ctx.fill();
    }
    // open leads: a small pulsing question mark where mapped air meets unmapped air
    if (phase === 'run') for (const Ld of leads) {
      const x = X(Ld.eu), y = Y(Ld.ev), p2 = .5 + .5 * Math.sin(T * 4 + Ld.id);
      ctx.fillStyle = 'rgba(22,24,50,.75)'; ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(220,228,238,${.45 + .4 * p2})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.stroke();
      text(ctx, '?', x, y + 3.6, { size: 10, color: C.mist, weight: 600, align: 'center' });
    }
    // the people
    if (found) {
      const x = X(Wd.people.u), y = Y(Wd.people.v), a = Math.min(1, (T - foundT) / .8), pu = .5 + .5 * Math.sin(T * 2.6);
      ctx.globalAlpha = a * (.75 + .25 * pu); ctx.drawImage(glowH, x - 34, y - 26, 68, 52); ctx.globalAlpha = a;
      ctx.fillStyle = '#FFE0A8';
      for (let k = 0; k < 13; k++) { const row = k < 7 ? 0 : 1, col = row ? k - 7 : k, px = x - (row ? 12 : 15) + col * 4.6 * (phone ? .7 : 1), py = y + (row ? 2.5 : -1.5); ctx.beginPath(); ctx.arc(px, py, phone ? 1.3 : 1.8, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    // trails and drones
    ctx.lineWidth = 1.2;
    for (let age = 0; age < 9; age++) {
      ctx.beginPath();
      for (const d of dr) { if (!d.on || d.tn < age + 2) continue; const i0 = ((d.tn - 1 - age) % 10) * 2, i1 = ((d.tn - 2 - age) % 10) * 2; ctx.moveTo(X(d.tr[i0]), Y(d.tr[i0 + 1])); ctx.lineTo(X(d.tr[i1]), Y(d.tr[i1 + 1])); }
      ctx.strokeStyle = `rgba(127,212,207,${.4 * (1 - age / 9)})`; ctx.stroke();
    }
    const sz = phone ? 2.6 : 3.6;
    for (const d of dr) { if (!d.on) continue; const x = X(d.u), y = Y(d.v); ctx.globalAlpha = d.conn ? .9 : .45; ctx.drawImage(glowT, x - 13, y - 13, 26, 26); }
    for (const d of dr) { if (!d.on) continue; ctx.globalAlpha = d.conn ? 1 : .5; drone(X(d.u), Y(d.v), sz, d.conn ? C.teal : '#b8b4cc', 1.4); }
    ctx.globalAlpha = 1;
    nR = 0;
    drawHUD(); drawLabels();
    if (phase !== 'summary' && phase !== 'fade') drawNotes();
    if (hoverD) drawTip();
    if (phase === 'summary' || phase === 'fade') drawSummary(phase === 'summary' ? Math.min(1, phT / .5) : Math.max(0, 1 - phT / .6));
    const fa = phase === 'fade' ? Math.min(1, phT / 1.1) : fadeIn;
    if (fa > 0) { ctx.fillStyle = `rgba(27,30,61,${fa})`; ctx.fillRect(0, 0, W, H); }
  }

  function pill(s, x, y, col, fs, bg = 'rgba(22,24,50,.84)') {
    ctx.font = `400 ${fs}px ${F.sans}`; const tw = ctx.measureText(s).width, bw = tw + 14, bh = fs + 9;
    ctx.fillStyle = bg; roundRect(ctx, x, y, bw, bh, bh / 2); ctx.fill();
    text(ctx, s, x + 7, y + bh / 2 + .5, { size: fs, color: col, base: 'middle' });
    return [bw, bh];
  }
  function drawLabels() {
    // permanent labels on the map: sumps (divers only), the entrance
    const fs = 11;
    for (const s of Wd.sumps) {
      if (!s.seen) continue;
      ctx.font = `400 ${fs}px ${F.sans}`; const tw = ctx.measureText('sump: divers only').width + 14, bh = fs + 9, x = X(s.u) - tw / 2, y = Y(s.v) + 8;
      if (!free(x, y, tw, bh)) continue; hold(x, y, tw, bh);
      ctx.globalAlpha = Math.min(1, s.t / .6); pill('sump: divers only', x, y, '#A9CBE0', fs, 'rgba(20,30,56,.82)'); ctx.globalAlpha = 1;
    }
    const ex = X(0), ey = Y(Wd.ground);
    if (!L.phone) text(ctx, 'entrance', ex - 26, ey + 16, { size: 11, color: C.muted, align: 'center' });
    const wl = 'water table', yw = Y(Wd.table);
    ctx.font = `400 ${fs}px ${F.sans}`; const ww = ctx.measureText(wl).width, wx = L.x1 - ww;
    for (const wy of [yw + fs + 4, yw - 6, yw + 2 * fs + 12]) if (free(wx - 4, wy - fs, ww + 8, fs + 6)) { hold(wx - 4, wy - fs, ww + 8, fs + 6); text(ctx, wl, L.x1, wy, { size: fs, color: 'rgba(169,203,224,.8)', align: 'right' }); break; }
  }

  function drawHUD() {
    const { x0, H, phone } = L, fs = 11;
    let y = H - (phone ? 40 : 22);
    text(ctx, `${fmtMin(phase === 'run' ? simT : endSim)} · time-lapse ×${TL}`, x0, y, { size: phone ? 11 : 12, color: C.muted, font: F.mono });
    y -= phone ? 16 : 18;
    text(ctx, phone ? 'indoor mode: 3-D voxels, no GPS, no radio' : 'indoor mode: 3-D voxels, no GPS, no radio: beacons and relays', x0, y, { size: fs, color: C.muted });
    // scale: 100 m along, and how much the heights are stretched
    const len = 100 * L.sx, sy2 = y - (phone ? 20 : 24);
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, sy2 - 4); ctx.lineTo(x0, sy2); ctx.lineTo(x0 + len, sy2); ctx.lineTo(x0 + len, sy2 - 4); ctx.stroke();
    text(ctx, `100 m · heights ×${Math.round(VE0 * L.k)}`, x0 + len + 6, sy2 + 1, { size: 11, color: C.muted, font: F.mono, base: 'middle' });
    // branches left (open leads), top right
    const lab = 'branches left', num = String(nLeads);
    ctx.font = `400 ${fs}px ${F.sans}`; const tw = ctx.measureText(lab).width; ctx.font = `500 14px ${F.mono}`; const nw = ctx.measureText(num).width;
    const bw = tw + nw + 50, bh = 26, bx = L.x1 - bw, by = phone ? 78 : 84;
    ctx.fillStyle = 'rgba(22,24,50,.8)'; roundRect(ctx, bx, by, bw, bh, 13); ctx.fill();
    ctx.strokeStyle = 'rgba(220,228,238,.8)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(bx + 19, by + 13, 6.5, 0, TAU); ctx.stroke();
    text(ctx, '?', bx + 19, by + 16.5, { size: 9.5, color: C.mist, weight: 600, align: 'center' });
    text(ctx, lab, bx + 32, by + 13.5, { size: fs, color: C.muted, base: 'middle' });
    text(ctx, num, bx + bw - 12, by + 14, { size: 14, color: nLeads === 0 ? C.teal : C.ink, font: F.mono, weight: 500, align: 'right', base: 'middle' });
    hold(bx, by, bw, bh);
  }

  function drawNotes() {
    const fs = L.phone ? 11 : 12;
    for (let k = Math.max(0, notes.length - (L.phone ? 2 : 4)); k < notes.length; k++) {
      const n = notes[k], a = Math.max(0, Math.min(1, n.t / .35, (n.dur - n.t) / .7)); if (a <= 0) continue;
      const ax = X(n.d ? n.d.u : n.u), ay = Y(n.d ? n.d.v : n.v);
      ctx.font = `400 ${fs}px ${F.sans}`; const tw = ctx.measureText(n.txt).width, bw = tw + 16, bh = fs + 10;
      let bx = ax + 12, by = ay - 16 - bh;
      if (bx + bw > L.x1) bx = ax - 12 - bw;
      bx = clamp(bx, L.phone ? 8 : L.x0 - 12, L.W - (L.phone ? 8 : 24) - bw); by = clamp(by, 74, L.H - (L.phone ? 96 : 84) - bh);
      // slide away from labels already placed: one direction first, then the other
      const by0 = by, lo = 74, hi = L.H - (L.phone ? 96 : 84) - bh, dir = by > L.H * .55 ? -1 : 1;
      for (let m = 0; m < 10 && !free(bx, by, bw, bh); m++) { by += dir * (bh + 4); if (by < lo || by > hi) { by = by0; break; } }
      for (let m = 0; m < 10 && !free(bx, by, bw, bh); m++) { by -= dir * (bh + 4); if (by < lo || by > hi) { by = clamp(by, lo, hi); break; } }
      hold(bx, by, bw, bh);
      ctx.globalAlpha = a;
      const lx = clamp(ax, bx + 6, bx + bw - 6), ly = by + bh / 2 < ay ? by + bh : by;
      ctx.strokeStyle = 'rgba(243,238,242,.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(lx, ly); ctx.stroke();
      ctx.fillStyle = n.col === C.heat ? 'rgba(52,40,40,.9)' : 'rgba(22,24,50,.88)'; roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
      text(ctx, n.txt, bx + 8, by + bh / 2 + .5, { size: fs, color: n.col, base: 'middle' });
      ctx.globalAlpha = 1;
    }
  }

  function drawTip() {
    const d = hoverD; if (!d.on) { hoverD = null; return; }
    const role = { explore: 'mapping a lead', idle: 'waiting at a junction', gather: 'with the group', home: 'flying out', wait: 'at the entrance' }[d.role] || d.role;
    const s = `drone ${d.id}: ${role}${d.role === 'explore' && d.tdist < 1e8 ? ', ' + Math.round(d.tdist * CS) + ' m to go' : ''}${d.conn ? `, ${d.hop} hops to the entrance` : ', no link'}`;
    const x = X(d.u), y = Y(d.v); ctx.font = `400 11px ${F.sans}`; const bw = ctx.measureText(s).width + 14;
    pill(s, clamp(x + 10, 6, L.W - bw - 6), clamp(y + 12, 74, L.H - 30), C.ink, 11, 'rgba(14,16,36,.94)');
  }

  function drawSummary(a) {
    const { x0, x1, phone, W, H } = L, w = Math.min(phone ? W - 24 : 450, x1 - x0 - 20), cx = phone ? W / 2 : (x0 + x1) / 2, cy = phone ? (L.yT + L.yB) / 2 : H * .42;
    ctx.globalAlpha = a * .55; ctx.fillStyle = '#16182f'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = a;
    const deep = story.deep || 0;
    const lines = phone ? [
      [`${fmtLen(deep)} in, ${Math.round((Wd.shelf.top + 60) / VE0)} m above the water`, C.ink],
      [`${fmtLen(mapped)} mapped in ${fmtMin(endSim)}, 0 branches left`, C.muted],
      [`${sumpsSeen} sumps marked for divers`, '#A9CBE0'],
      [hops ? `${beacons.length} beacons, ${hops} hops to the entrance` : `${beacons.length} beacons dropped`, C.teal],
    ] : [
      [`${fmtLen(deep)} from the entrance, on a shelf ${Math.round((Wd.shelf.top + 60) / VE0)} m above the water`, C.ink],
      [`${fmtLen(mapped)} of passage mapped in ${fmtMin(endSim)}, no branch left unexplored`, C.muted],
      [`${sumpsSeen} sump${sumpsSeen === 1 ? '' : 's'} marked: divers only (the drones found the dry way round)`, '#A9CBE0'],
      [hops ? `${beacons.length} beacons dropped: a relay chain of ${hops} hops to the entrance` : `${beacons.length} beacons dropped along the way`, C.teal],
    ];
    const fs = phone ? 11.5 : 13, lh = phone ? 19 : 22, h = 64 + lines.length * lh + 10, bx = cx - w / 2, by = cy - h / 2;
    ctx.fillStyle = 'rgba(30,33,64,.95)'; roundRect(ctx, bx, by, w, h, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(220,214,236,.14)'; ctx.lineWidth = 1; roundRect(ctx, bx + .5, by + .5, w - 1, h - 1, 16); ctx.stroke();
    ctx.drawImage(glowH, bx + 10, by + 12, 30, 30);
    text(ctx, found ? '13 people found' : 'Search complete', bx + 44, by + 33, { size: phone ? 16 : 19, color: C.heat, font: F.serif });
    let yy = by + 62;
    for (const [s, col] of lines) { text(ctx, s, bx + 20, yy, { size: fs, color: col }); yy += lh; }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- readouts, input, loop
  const rMap = kit.readout(readouts, { label: 'Passage mapped', tone: 'teal' });
  const rBea = kit.readout(readouts, { label: 'Beacons dropped', tone: 'apricot' });
  const rBr = kit.readout(readouts, { label: 'Branches left', tone: 'ink' });

  const onMove = (e) => {
    if (!L) return; const r = el.getBoundingClientRect(), hx = e.clientX - r.left, hy = e.clientY - r.top;
    let best = null, bd = (e.pointerType === 'mouse' ? 14 : 22) ** 2;
    for (const d of dr) { if (!d.on) continue; const q = (X(d.u) - hx) ** 2 + (Y(d.v) - hy) ** 2; if (q < bd) { bd = q; best = d; } }
    hoverD = best;
  };
  const onLeave = () => { hoverD = null; };
  el.addEventListener('pointermove', onMove); el.addEventListener('pointerdown', onMove); el.addEventListener('pointerleave', onLeave);

  newMission(seed);
  cv.onResize(() => layout());
  layout();

  let msS = 0, msD = 0, frames = 0, toneB = 'ink';
  const loop = kit.loop((dt) => {
    dt = dt > 0 ? Math.min(dt, .05) : 0;                     // the first frame after start() can report a negative step
    const t0 = performance.now();
    const n = Math.max(1, Math.ceil(dt / (1 / 40)));
    for (let k = 0; k < n; k++) step(dt / n);
    const t1 = performance.now();
    draw();
    rMap.set(fmtLen(mapped)); rBea.set(String(beacons.length)); rBr.set(String(nLeads));
    const tb = nLeads === 0 ? 'teal' : 'ink'; if (tb !== toneB) rBr.tone(toneB = tb);
    msS += t1 - t0; msD += performance.now() - t1; frames++;
  });
  draw();
  return {
    start: loop.start, stop: loop.stop,
    destroy() { loop.stop(); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onMove); el.removeEventListener('pointerleave', onLeave); cv.destroy(); },
    resetTiming() { msS = msD = frames = 0; },
    warp(sec) { const n = Math.round(sec * 20); for (let k = 0; k < n; k++) step(1 / 20); draw(); },
    warpTo(p) { for (let k = 0; k < 20 * 120; k++) { if (p === 'found' ? found && T > foundT + 2 : phase === p) break; step(1 / 20); } draw(); },
    info() { return { d1: [X(dr[3].u), Y(dr[3].v)], phase, T: +T.toFixed(1), sim: fmtMin(simT), leads: nLeads, found, mapped: fmtLen(mapped), total: fmtLen(Wd.total), beacons: beacons.length, sumps: Wd.sumps.length + '/' + sumpsSeen, seed, stepMs: +(msS / Math.max(1, frames)).toFixed(2), drawMs: +(msD / Math.max(1, frames)).toFixed(2), deep: story.deep || 0, hops, drones: dr.map((d) => `${d.id}:${d.role}:${Math.round(d.u)},${Math.round(d.v)}${d.conn ? '' : '!'} t${d.tgt}/${d.tdist} p${d.pk}/${d.pl}${d.pl ? '>' + Math.round(cu(d.path[0])) + ',' + Math.round(cvv(d.path[0])) : ''}`).join(' | '), leadList: leads.map((q) => `${q.id}@${Math.round(q.eu)},${Math.round(q.ev)} n${q.size} e${q.edge.length}${q.risky ? ' R' : ''}`).join(' ; ') }; },
  };
}

// Under the canopy: a missing trekker in dense forest (no specific event).
// Top-down forest. Ten drones fly ABOVE the canopy (outdoor mode: thermal, wide swath, GPS on), but dense crowns hide
// the ground, so they only see it through gaps. Eight fly BELOW it, between the trunks (indoor mode: LiDAR, a small
// swath that sees everything, GPS weak): a forest is a building with no walls. Above flags warm patches through gaps,
// below goes and confirms with the camera. Coverage is shared over the mesh; a drone out of range keeps searching on
// its own and merges what it saw when it reconnects. Each drone heads for the most useful unsearched ground that no
// closer neighbour is heading for (frontier exploration, even spacing without assignments). The mission ends when
// nothing is left unsearched: β₀ of the unsearched region (the count of separate unsearched pockets) reaches zero.
export default function mount({ stage, controls, readouts, kit }) {
  const B0S = kit.stableCount();   // calm display of the pocket counter
  const { C, F, text, roundRect, clamp, lerp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx, el = cv.cv;
  el.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2;
  const mk = (w = 2, h = 2) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // ---------------------------------------------------------------- noise (seeded value noise + fbm)
  const hash = (x, y, s) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  function vn(x, y, s) {
    const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function fbm(x, y, s, o) { let t = 0, a = .5, n = 0; for (let i = 0; i < o; i++) { t += a * vn(x, y, s + i * 131); n += a; a *= .5; x *= 2.03; y *= 2.03; } return t / n; }
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // polylines in metres with chunked bounding boxes, for fast "how far from the stream / trail" queries
  function mkLine(pts) {
    const n = pts.length >> 1, ch = [];
    for (let i = 0; i < n - 1; i += 10) {
      const j = Math.min(n - 1, i + 10); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let k = i; k <= j; k++) { const x = pts[2 * k], y = pts[2 * k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      ch.push(i, j, x0, y0, x1, y1);
    }
    return { pts, n, ch };
  }
  function lineDist(Ln, x, y, cap) {
    let best = cap * cap; const p = Ln.pts, ch = Ln.ch;
    for (let c = 0; c < ch.length; c += 6) {
      const dx = Math.max(ch[c + 2] - x, 0, x - ch[c + 4]), dy = Math.max(ch[c + 3] - y, 0, y - ch[c + 5]);
      if (dx * dx + dy * dy >= best) continue;
      for (let k = ch[c]; k < ch[c + 1]; k++) {
        const ax = p[2 * k], ay = p[2 * k + 1], bx = p[2 * k + 2] - ax, by = p[2 * k + 3] - ay, l2 = bx * bx + by * by || 1;
        const t = clamp(((x - ax) * bx + (y - ay) * by) / l2, 0, 1), ex = ax + bx * t - x, ey = ay + by * t - y, d2 = ex * ex + ey * ey;
        if (d2 < best) best = d2;
      }
    }
    return Math.sqrt(best);
  }
  function inPoly(P, x, y) {
    let c = false;
    for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) { const xi = P[i], yi = P[i + 1], xj = P[j], yj = P[j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; }
    return c;
  }

  // ---------------------------------------------------------------- constants (metres, seconds)
  const WM = 1150, HM = 820, CELL = 8, GW = Math.ceil(WM / CELL), GH = Math.ceil(HM / CELL), NC = GW * GH;
  const BS = 5, BW = Math.ceil(GW / BS), BH = Math.ceil(GH / BS), NBK = BW * BH;
  const TL = 30;                          // time-lapse: sim seconds per wall second
  const VA = 5, VB = 3.5;                 // flight speed above / below the canopy, m/s
  const RA = 45, RB = 22;                 // thermal footprint radius above; LiDAR + camera radius below
  const DEN_SEE = .52, DEN_FLAG = .62;     // canopy density through which thermal still sees the ground / a warm body
  const R_AA = 900, R_AB = 260, R_BB = 130, R_GA = 1300, R_GB = 210;   // radio ranges (foliage eats the low links)
  const NA = 10, NBD = 8, N = NA + NBD, TRN = 12;

  // ---------------------------------------------------------------- per-mission world
  const inside = new Uint8Array(NC), dens = new Float32Array(NC), densL = new Float32Array(NC), seenA = new Uint8Array(NC), srch = new Uint8Array(NC);
  const blk = new Int16Array(NC), blkA = new Int16Array(NBK), blkB = new Int16Array(NBK), blkD = new Float32Array(NBK), bcx = new Float32Array(NBK), bcy = new Float32Array(NBK);
  const lab = new Int32Array(NC), qq = new Int32Array(NC), srcAt = new Int8Array(NC);
  for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) blk[cy * GW + cx] = ((cy / BS) | 0) * BW + ((cx / BS) | 0);
  for (let b = 0; b < NBK; b++) { bcx[b] = ((b % BW) + .5) * BS * CELL; bcy[b] = (((b / BW) | 0) + .5) * BS * CELL; }
  let Wd = null, insideN = 0, nA = 0, nS = 0, seed = 3;

  function canopy(x, y, lite) {
    const w = Wd;
    let d = .22 + .78 * sstep(.36, .6, fbm(x / 240 + 3.1, y / 240 + 7.7, w.s1, 4));
    d *= .42 + .58 * sstep(.3, .5, fbm(x / 46, y / 46, w.s2, 2));            // gaps between crowns
    for (const c of w.clear) {
      const ex = (x - c.x) / c.rx, ey = (y - c.y) / c.ry, e = ex * ex + ey * ey;
      if (e < 3.4) d *= sstep(.6, 1.6, Math.sqrt(e) + (vn(x / 22, y / 22, w.s3) - .5) * .5);
    }
    if (!lite) {
      d *= .25 + .75 * sstep(6, 34, lineDist(w.stream, x, y, 40));          // the canopy opens over the water
      d *= .62 + .38 * sstep(2, 11, lineDist(w.trail, x, y, 12));
    }
    return d;
  }

  function genWorld(sd) {
    const r = kit.rng(sd * 7919 + 13), rr = (a, b) => a + (b - a) * r();
    const w = { sd, s1: (sd * 31 + 1) & 1023, s2: (sd * 57 + 5) & 1023, s3: (sd * 91 + 9) & 1023, clear: [], stream: null, trail: null };
    Wd = w;
    // the search polygon: a rounded, slightly irregular outline (ridges and a forest road bound it)
    const P = [];
    for (let k = 0; k < 18; k++) {
      const th = (k + rr(-.2, .2)) / 18 * TAU, c = Math.cos(th), s = Math.sin(th), e = 2 / 4.6, j = rr(.92, 1);
      P.push(WM / 2 + Math.sign(c) * Math.pow(Math.abs(c), e) * (WM / 2 - 4) * j, HM / 2 + Math.sign(s) * Math.pow(Math.abs(s), e) * (HM / 2 - 4) * j);
    }
    w.poly = P;
    let cx = 0, cy = 0; for (let i = 0; i < P.length; i += 2) { cx += P[i]; cy += P[i + 1]; } cx /= P.length / 2; cy /= P.length / 2;
    w.polyIn = P.map((v, i) => i & 1 ? cy + (v - cy) * .994 : cx + (v - cx) * .995);
    // the trailhead (base) just outside the left edge
    const by = HM * rr(.6, .74); let lx = WM;
    for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) { const yi = P[i + 1], yj = P[j + 1]; if ((yi > by) !== (yj > by)) { const x = P[i] + (P[j] - P[i]) * (by - yi) / (yj - yi); if (x < lx) lx = x; } }
    w.base = { x: lx - 24, y: by };
    w.clear.push({ x: lx + 30, y: by - 6, rx: 62, ry: 46, home: true });
    for (let k = 0, t = 0; k < 3 && t < 400; t++) {
      const x = rr(.22, .9) * WM, y = rr(.14, .86) * HM;
      if (w.clear.some((c) => Math.hypot(c.x - x, c.y - y) < 250) || !inPoly(P, x, y)) continue;
      w.clear.push({ x, y, rx: rr(34, 62), ry: rr(28, 50) }); k++;
    }
    for (let k = 0; k < 9; k++) { const x = rr(-1100, WM + 1100), y = rr(-800, HM + 800); if (x > -60 && x < WM + 60 && y > -60 && y < HM + 60) continue; w.clear.push({ x, y, rx: rr(40, 100), ry: rr(30, 80) }); }
    // the stream: wanders across the whole view, roughly left to right
    // (a wandering centre line that always crosses the search area, plus meanders bounded to ±45 m around it)
    const st = [], yA = HM * rr(.28, .5), yB = HM * rr(.36, .62), cl = (x) => lerp(yA, yB, clamp((x + 1800) / (WM + 3600), 0, 1)) + (fbm(x / 520, 3.3, w.s3, 3) - .5) * 300;
    for (let x = -1800; x <= WM + 1800; x += 12) {
      const y = cl(x), nx = -(cl(x + 6) - cl(x - 6)) / 12, nl = Math.hypot(nx, 1), m = (fbm(x / 140, 5.9, w.s2 + 7, 2) - .5) * 90;
      st.push(x + nx / nl * m, y + m / nl);
    }
    w.stream = mkLine(st);
    // the trail: from the forest road on the left, through the trailhead, across the search area to the far ridge
    const cps = [[-1900, by + 90], [-900, by + 40], [w.base.x - 120, by + 6], [w.base.x, by], [WM * rr(.2, .3), HM * rr(.5, .62)], [WM * rr(.44, .54), HM * rr(.36, .5)],
      [WM * rr(.68, .78), HM * rr(.2, .34)], [WM * rr(.92, 1), HM * rr(.04, .16)], [WM + 500, -380], [WM + 1500, -900]];
    const tp = [];
    for (let k = 0; k < cps.length - 1; k++) {
      const p0 = cps[Math.max(0, k - 1)], p1 = cps[k], p2 = cps[k + 1], p3 = cps[Math.min(cps.length - 1, k + 2)];
      const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 12));
      for (let i = 0; i < n; i++) {
        const t = i / n, t2 = t * t, t3 = t2 * t;
        const f = (q0, q1, q2, q3) => .5 * (2 * q1 + (-q0 + q2) * t + (2 * q0 - 5 * q1 + 4 * q2 - q3) * t2 + (-q0 + 3 * q1 - 3 * q2 + q3) * t3);
        const px = f(p0[0], p1[0], p2[0], p3[0]), py = f(p0[1], p1[1], p2[1], p3[1]), wob = (fbm(tp.length * .06, 9.1, w.s1, 2) - .5) * 26;
        tp.push(px + wob * .6, py + wob);
      }
    }
    w.trail = mkLine(tp);
    // the grid: inside the polygon, canopy density per 8 m cell
    insideN = 0; blkA.fill(0); blkB.fill(0); blkD.fill(0);
    const bn = new Int16Array(NBK);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const i = gy * GW + gx, px = (gx + .5) * CELL, py = (gy + .5) * CELL;
      inside[i] = inPoly(P, px, py) ? 1 : 0; dens[i] = canopy(px, py, false);
    }
    // what a thermal camera 60 m up sees through: the canopy averaged over ~40 m, not crown by crown
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      let t = 0, n = 0;
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) { const x = gx + ox, y = gy + oy; if (x < 0 || y < 0 || x >= GW || y >= GH) continue; t += dens[y * GW + x]; n++; }
      const i = gy * GW + gx, b = blk[i]; densL[i] = t / n;
      if (inside[i]) { insideN++; blkA[b]++; blkB[b]++; blkD[b] += densL[i]; bn[b]++; }
    }
    for (let b = 0; b < NBK; b++) blkD[b] = bn[b] ? blkD[b] / bn[b] : 0;
    const cellIn = (px, py) => { const gx = Math.floor(px / CELL), gy = Math.floor(py / CELL); return gx >= 0 && gy >= 0 && gx < GW && gy < GH && inside[gy * GW + gx]; };
    const deep = (px, py, m) => cellIn(px - m, py) && cellIn(px + m, py) && cellIn(px, py - m) && cellIn(px, py + m);
    const dB = (px, py) => Math.hypot(px - w.base.x, py - w.base.y);
    // the trekker: by the stream, as far from the trailhead as the stream goes inside the search area
    let best = -1, tk = 1;
    for (let k = 1; k < w.stream.n - 1; k++) { const px = st[2 * k], py = st[2 * k + 1]; if (!deep(px, py, 70)) continue; best = Math.max(best, dB(px, py)); }
    const cand = []; for (let k = 1; k < w.stream.n - 1; k++) { const px = st[2 * k], py = st[2 * k + 1]; if (deep(px, py, 70) && dB(px, py) > best * .72) cand.push(k); }
    if (cand.length) tk = cand[Math.floor(r() * cand.length)];
    const tx = st[2 * tk], tyy = st[2 * tk + 1];
    const ang = Math.atan2(st[2 * tk + 3] - st[2 * tk - 1], st[2 * tk + 2] - st[2 * tk - 2]) + (r() < .5 ? 1 : -1) * Math.PI / 2, off = rr(17, 24);
    const person = { kind: 'person', x: tx + Math.cos(ang) * off, y: tyy + Math.sin(ang) * off };
    if (!deep(person.x, person.y, 20)) { person.x = tx - Math.cos(ang) * off; person.y = tyy - Math.sin(ang) * off; }
    const far = dB(person.x, person.y);
    // two warm things that are not the trekker: a deer in a clearing, a sun-warmed boulder in the open
    const pick = (lo, hi, avoid) => {
      let c = null;
      for (const cl of w.clear) if (!cl.home && deep(cl.x, cl.y, 30) && dB(cl.x, cl.y) > lo * far && dB(cl.x, cl.y) < hi * far && avoid.every((o) => Math.hypot(o.x - cl.x, o.y - cl.y) > 200)) { c = { x: cl.x + rr(-.3, .3) * cl.rx, y: cl.y + rr(-.3, .3) * cl.ry }; break; }
      for (let t = 0; !c && t < 3000; t++) {
        const px = rr(.08, .92) * WM, py = rr(.08, .92) * HM;
        if (!deep(px, py, 30) || canopy(px, py, false) > .36 - t * .00005) continue;
        const d = dB(px, py); if (d < lo * far || d > hi * far || !avoid.every((o) => Math.hypot(o.x - px, o.y - py) > 200)) continue;
        c = { x: px, y: py };
      }
      return c || { x: WM * rr(.3, .6), y: HM * rr(.3, .7) };
    };
    const deer = { kind: 'deer', ...pick(.28, .62, [person]) };
    const rock = { kind: 'rock', ...pick(.4, .86, [person, deer]) };
    w.src = [deer, rock, person];
    srcAt.fill(0);
    w.src.forEach((s, k) => { s.st = 'hidden'; s.t = 0; s.by = null; s.age = 0; const gi = Math.floor(s.y / CELL) * GW + Math.floor(s.x / CELL); s.den = Math.min(canopy(s.x, s.y, false), densL[gi]); srcAt[gi] = k + 1; });
    // rocks for the art: some in clearings and on the stream banks, one big boulder for the warm rock
    w.rocks = [];
    for (let k = 0; k < 70; k++) { const cl = w.clear[k % w.clear.length]; const t = rr(0, TAU), q = Math.sqrt(r()) * 1.1; w.rocks.push(cl.x + Math.cos(t) * cl.rx * q, cl.y + Math.sin(t) * cl.ry * q, rr(1.2, 3.2)); }
    for (let k = 0; k < 90; k++) { const i = Math.floor(rr(0, w.stream.n)); w.rocks.push(st[2 * i] + rr(-9, 9), st[2 * i + 1] + rr(-9, 9), rr(1, 2.4)); }
    w.rocks.push(rock.x + 2, rock.y + 1, 5.5);
    return w;
  }

  // ---------------------------------------------------------------- drones
  const dr = [];
  for (let i = 0; i < N; i++) {
    const above = i < NA;
    dr.push({ i, id: i + 1, above, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, on: false, tOn: 0, role: 'wait', conn: true, outT: 0, src: null, decT: 0, gt: 0, stay: false,
      pend: above ? null : new Int32Array(NC), pn: 0, pb: above ? null : new Int16Array(NBK), mine: above ? null : new Uint8Array(NC),
      tr: new Float32Array(TRN * 2), tn: 0, th: 0, alt: 0, rot: 0, phase: Math.random() * TAU });
  }
  const order = []; for (let k = 0; k < NA; k++) { order.push(k); if (k < NBD) order.push(NA + k); }

  // ---------------------------------------------------------------- mission state
  let T = 0, simT = 0, endSim = 0, phase = 'run', phT = 0, pockets = 1, pocketsT = 0, linkT = 0, relayT = 0, falseN = 0, found = null, fadeIn = 1, belowOn = 0;
  const story = {};
  const notes = [];
  const link = new Int16Array(N * N * 2 + N * 2); let nLink = 0;
  const adj = new Uint8Array((N + 1) * (N + 1)), bq = new Int16Array(N + 1), seenL = new Uint8Array(N + 1);

  function newMission(sd) {
    seed = sd; genWorld(sd);
    seenA.fill(0); srch.fill(0); nA = 0; nS = 0;
    T = 0; simT = 0; endSim = 0; phase = 'run'; phT = 0; pockets = 1; pocketsT = 0; linkT = 0; relayT = 0; falseN = 0; found = null; fadeIn = 1; belowOn = 0;
    for (const k in story) delete story[k];
    notes.length = 0;
    order.forEach((i, k) => {
      const d = dr[i]; d.x = Wd.base.x + 6 + (k % 4) * 3; d.y = Wd.base.y - 4 + ((k / 4) | 0) * 3; d.vx = d.vy = 0; d.tx = d.x; d.ty = d.y;
      d.on = false; d.tOn = .25 + k * .14; d.role = 'wait'; d.conn = true; d.outT = 0; d.src = null; d.decT = 0; d.gt = 0; d.stay = false; d.alt = 0; d.tn = 0; d.th = 0;
      if (d.mine) { d.mine.fill(0); d.pb.fill(0); d.pn = 0; }
    });
    if (L) { renderArt(); buildFog(); }
  }

  // coverage bookkeeping (global = what the base and every drone connected to it share)
  function setS(i) {
    srch[i] = 1; blkB[blk[i]]--; nS++; stampB(i);
    if (!seenA[i]) { seenA[i] = 1; blkA[blk[i]]--; nA++; stampT(i); }
  }
  function senseAbove(d) {
    const r2 = RA * RA, gx0 = Math.max(0, Math.floor((d.x - RA) / CELL)), gx1 = Math.min(GW - 1, Math.floor((d.x + RA) / CELL));
    const gy0 = Math.max(0, Math.floor((d.y - RA) / CELL)), gy1 = Math.min(GH - 1, Math.floor((d.y + RA) / CELL));
    for (let gy = gy0; gy <= gy1; gy++) {
      const dy = (gy + .5) * CELL - d.y;
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = gy * GW + gx; if (!inside[i] || seenA[i]) continue;
        const dx = (gx + .5) * CELL - d.x; if (dx * dx + dy * dy > r2) continue;
        seenA[i] = 1; blkA[blk[i]]--; nA++; stampT(i);
        if (srcAt[i]) { const s = Wd.src[srcAt[i] - 1]; if (s.st === 'hidden' && s.den < DEN_FLAG) flag(s); }
        if (densL[i] < DEN_SEE && !srch[i]) setS(i);              // thermal sees the ground through the open canopy here
      }
    }
  }
  function senseBelow(d) {
    const r2 = RB * RB, gx0 = Math.max(0, Math.floor((d.x - RB) / CELL)), gx1 = Math.min(GW - 1, Math.floor((d.x + RB) / CELL));
    const gy0 = Math.max(0, Math.floor((d.y - RB) / CELL)), gy1 = Math.min(GH - 1, Math.floor((d.y + RB) / CELL));
    for (let gy = gy0; gy <= gy1; gy++) {
      const dy = (gy + .5) * CELL - d.y;
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = gy * GW + gx; if (!inside[i] || srch[i]) continue;
        const dx = (gx + .5) * CELL - d.x; if (dx * dx + dy * dy > r2) continue;
        if (d.conn) setS(i);
        else if (!d.mine[i]) { d.mine[i] = 1; d.pend[d.pn++] = i; d.pb[blk[i]]++; }   // kept on board until it reconnects
        if (srcAt[i]) { const s = Wd.src[srcAt[i] - 1]; if (s.st === 'hidden' || (s.st === 'flagged' && !s.by)) { if (d.role === 'search') { s.st = 'checking'; s.t = 0; s.by = d; d.role = 'check'; d.src = s; } else if (s.st === 'hidden') flag(s); } }
      }
    }
  }
  function flush(d) {
    let m = 0;
    for (let k = 0; k < d.pn; k++) { const i = d.pend[k]; d.mine[i] = 0; if (!srch[i]) { setS(i); m++; } }
    d.pn = 0; d.pb.fill(0); return m;
  }

  // mesh: who hears whom (base = node N); everyone connected to the base shares one coverage map
  function computeLinks() {
    adj.fill(0); nLink = 0;
    for (let i = 0; i < N; i++) {
      const a = dr[i]; if (!a.on) continue;
      for (let j = i + 1; j < N; j++) {
        const b = dr[j]; if (!b.on) continue;
        const R = a.above && b.above ? R_AA : a.above || b.above ? R_AB : R_BB, dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy < R * R) { adj[i * (N + 1) + j] = adj[j * (N + 1) + i] = 1; link[nLink++] = i; link[nLink++] = j; }
      }
      const R = a.above ? R_GA : R_GB, dx = a.x - Wd.base.x, dy = a.y - Wd.base.y;
      if (dx * dx + dy * dy < R * R) { adj[i * (N + 1) + N] = adj[N * (N + 1) + i] = 1; }
    }
    const seen = seenL; seen.fill(0); let h = 0, t = 0; bq[t++] = N; seen[N] = 1;
    while (h < t) { const u = bq[h++]; for (let v = 0; v <= N; v++) if (!seen[v] && adj[u * (N + 1) + v]) { seen[v] = 1; bq[t++] = v; } }
    for (const d of dr) {
      if (!d.on) continue;
      const c = d.above ? true : !!seen[d.i];
      if (!d.above && c !== d.conn) {
        if (!c) { d.outT = 0; if (!story.out && T > 4 && phase === 'run') { story.out = 1; note(`drone ${d.id} is out of radio range: it keeps searching alone`, 0, 0, C.muted, 6, d); } }
        else {
          const m = flush(d);
          if (m > 20 && !story.merge && phase === 'run') { story.merge = 1; const a = m * CELL * CELL; note(`drone ${d.id} is back in range: merges the ${a < 1e4 ? Math.round(a / 100) * 100 + ' m²' : (a / 1e4).toFixed(1) + ' ha'} it searched alone`, 0, 0, C.teal, 6, d); }
          if (d.role === 'rejoin') d.role = 'search';
        }
      }
      d.conn = c;
    }
  }

  // frontier choice: the block with the most unsearched ground per metre of travel that no closer neighbour is
  // heading for; then aim at the nearest unsearched cell in it (so each drone sweeps its own patch tidily)
  function decide(d) {
    d.decT = 1.4 + Math.random() * .5;
    const above = d.above, G = above ? blkA : blkB, rdist = above ? 230 : 110;
    let best = -1, bs = 0;
    for (let b = 0; b < NBK; b++) {
      let g = G[b]; if (!above && d.pn) g -= d.pb[b]; if (g <= 0) continue;
      const bx = bcx[b] - d.x, by = bcy[b] - d.y, d2 = bx * bx + by * by;
      // above: big unseen blocks are worth a detour; below: finish what is near first, so nothing is left behind
      let sc = above ? g / (1 + Math.sqrt(d2) / rdist) : (Math.min(g, 8) + 8) * (.6 + blkD[b]) / (Math.sqrt(d2) + 40);
      for (const o of dr) {
        if (o === d || o.above !== above || !o.on || o.role === 'guard') continue;
        if (!(d.conn && o.conn)) { const ex = o.x - d.x, ey = o.y - d.y; if (ex * ex + ey * ey > R_BB * R_BB) continue; }   // only neighbours it can hear
        const ox = bcx[b] - o.x, oy = bcy[b] - o.y; if (ox * ox + oy * oy < d2 * .55) sc *= .5;
        const tx = bcx[b] - o.tx, ty = bcy[b] - o.ty; if (tx * tx + ty * ty < (above ? 140 * 140 : 60 * 60)) sc *= .22;
      }
      if (sc > bs) { bs = sc; best = b; }
    }
    if (best < 0) {
      if (above) { d.role = 'relay'; if (!story.relay && phase === 'run') { story.relay = 1; note(`thermal sweep done: drone ${d.id} holds above the canopy as a radio relay`, 0, 0, C.teal, 6, d); } }
      else if (!d.conn) d.role = 'rejoin';
      else { d.tx = d.x; d.ty = d.y; }
      return;
    }
    const bx0 = (best % BW) * BS, by0 = ((best / BW) | 0) * BS; let bd = 1e18, tx = bcx[best], ty = bcy[best];
    for (let gy = by0; gy < Math.min(GH, by0 + BS); gy++) for (let gx = bx0; gx < Math.min(GW, bx0 + BS); gx++) {
      const i = gy * GW + gx; if (!inside[i]) continue;
      if (above ? seenA[i] : (srch[i] || (d.pn && d.mine[i]))) continue;
      const px = (gx + .5) * CELL, py = (gy + .5) * CELL, q = (px - d.x) ** 2 + (py - d.y) ** 2;
      if (q < bd) { bd = q; tx = px; ty = py; }
    }
    d.tx = tx; d.ty = ty;
  }

  function nearestConnected(d) {
    let best = null, bd = 1e18;
    for (const o of dr) if (o !== d && o.on && o.conn) { const q = (o.x - d.x) ** 2 + (o.y - d.y) ** 2; if (q < bd) { bd = q; best = o; } }
    return best || Wd.base;
  }

  // above drones whose thermal sweep is done hover over the drones below, so the low links reach the mesh
  function assignRelays() {
    const rel = dr.filter((d) => d.above && d.role === 'relay'), low = dr.filter((d) => !d.above && d.on && d.role !== 'guard');
    const used = new Uint8Array(N), taken = new Uint8Array(N);
    for (let k = 0; k < rel.length; k++) {
      let bi = -1, bj = -1, bd = 1e18;
      for (const a of rel) { if (used[a.i]) continue; for (const b of low) { if (taken[b.i]) continue; const q = (a.x - b.x) ** 2 + (a.y - b.y) ** 2; if (q < bd) { bd = q; bi = a.i; bj = b.i; } } }
      if (bi < 0) break;
      used[bi] = taken[bj] = 1; const a = dr[bi], b = dr[bj]; a.tx = b.x + b.vx * .6; a.ty = b.y + b.vy * .6;
    }
    let k = 0;
    for (const a of rel) if (!used[a.i]) { const t = k++ / Math.max(1, rel.length) * TAU + T * .05; a.tx = WM / 2 + Math.cos(t) * WM * .3; a.ty = HM / 2 + Math.sin(t) * HM * .3; }
  }

  function think(d, dt) {
    d.decT -= dt;
    const near = (r) => (d.tx - d.x) ** 2 + (d.ty - d.y) ** 2 < r * r;
    switch (d.role) {
      case 'search':
        if (d.decT <= 0 || near(d.above ? 26 : 9) || (d.above ? seenA : srch)[Math.floor(d.ty / CELL) * GW + Math.floor(d.tx / CELL)]) decide(d);
        if (!d.above && !d.conn) { d.outT += dt; if (d.outT > 6) d.role = 'rejoin'; }
        break;
      case 'rejoin': { if (d.conn) { d.role = 'search'; break; } const o = nearestConnected(d); d.tx = o.x; d.ty = o.y; break; }
      case 'check': if (d.src) { const s = d.src, a = d.phase; d.tx = s.x + Math.cos(a) * 9; d.ty = s.y + Math.sin(a) * 9; } break;
      case 'gather': d.gt -= dt; if (d.gt <= 0) d.role = d.stay ? 'guard' : (d.above ? 'search' : 'search'); break;
      case 'home': d.tx = Wd.base.x + 10 + (d.i % 5) * 5; d.ty = Wd.base.y - 8 + ((d.i / 5) | 0) * 5; break;
      default: break;
    }
  }
  function move(d, dt) {
    const sp = (d.above ? VA : VB) * TL * (d.role === 'home' ? 1.25 : 1);
    let dx = d.tx - d.x, dy = d.ty - d.y; const dist = Math.hypot(dx, dy) || 1e-6, prec = d.role !== 'search' && d.role !== 'rejoin', v = prec ? Math.min(sp, dist * 2.6) : sp;
    let ux = dx / dist * v, uy = dy / dist * v;
    if (d.role !== 'gather' && d.role !== 'guard' && d.role !== 'check') {
      const R = d.above ? 70 : 26;
      for (const o of dr) {
        if (o === d || !o.on || o.above !== d.above) continue;
        const ex = d.x - o.x, ey = d.y - o.y, e2 = ex * ex + ey * ey;
        if (e2 < R * R && e2 > 1e-4) { const e = Math.sqrt(e2), f = (R - e) / R * sp * .9; ux += ex / e * f; uy += ey / e * f; }
      }
    }
    if (!d.above && v > 1) { const w = Math.sin(T * 2.1 + d.phase) * .38, c = Math.cos(w), s = Math.sin(w); const nx = ux * c - uy * s; uy = ux * s + uy * c; ux = nx; }   // weaving between trunks
    const k = 1 - Math.exp(-dt * (d.above ? 3.2 : 4.5));
    d.vx += (ux - d.vx) * k; d.vy += (uy - d.vy) * k; d.x += d.vx * dt; d.y += d.vy * dt;
    const spd = Math.hypot(d.vx, d.vy); if (spd > 4) d.rot = Math.atan2(d.vy, d.vx);
    d.alt = Math.min(1, d.alt + dt * 1.4);
    d.th -= dt; if (d.th <= 0) { d.th = .07; const o = (d.tn % TRN) * 2; d.tr[o] = d.x; d.tr[o + 1] = d.y; d.tn++; }
  }

  // the warm things: flagged from above (through a gap) or met from below; a camera look settles it
  function updateSources(dt) {
    for (const s of Wd.src) {
      s.age += dt;
      if (s.st === 'hidden') {
        for (const d of dr) {
          if (!d.on || d.role === 'wait') continue;
          const q = (d.x - s.x) ** 2 + (d.y - s.y) ** 2;
          if (d.above && s.den < DEN_FLAG && q < RA * RA) { flag(s); break; }
          if (!d.above && q < (RB + 5) ** 2) { if (d.role === 'search') { s.st = 'checking'; s.t = 0; s.by = d; d.role = 'check'; d.src = s; } else { s.st = 'flagged'; s.t = 0; s.by = null; } break; }
        }
      }
      if (s.st === 'flagged' && s.by && s.by.role !== 'check') s.by = null;
      if (s.st === 'flagged' && !s.by) {
        let best = null, bd = 1e18;
        for (const d of dr) if (!d.above && d.on && d.role === 'search') { const q = (d.x - s.x) ** 2 + (d.y - s.y) ** 2 * (d.conn ? 1 : 4); if (q < bd) { bd = q; best = d; } }
        if (best) { s.by = best; best.role = 'check'; best.src = s; if (!story['chk' + s.kind] && phase === 'run') { story['chk' + s.kind] = 1; note(`drone ${best.id} goes to look from below the canopy`, 0, 0, C.teal, 4.5, best); } }
      }
      if (s.st === 'flagged' && s.by && (s.by.x - s.x) ** 2 + (s.by.y - s.y) ** 2 < 15 * 15) { s.st = 'checking'; s.t = 0; }
      if (s.st === 'checking') {
        s.t += dt;
        if (s.t > 1.3) {
          const d = s.by; d.src = null; d.role = 'search'; d.decT = 0;
          if (s.kind === 'person') { s.st = 'found'; s.age = 0; found = s; gather(s); }
          else {
            s.st = 'rejected'; s.age = 0; falseN++;
            note(s.kind === 'deer' ? 'warm, not a person: camera disagrees (a deer)' : 'sun-warmed boulder: camera disagrees', s.x, s.y, C.rose, 5.5);
          }
        }
      }
    }
  }
  function flag(s) { s.st = 'flagged'; s.t = 0; s.by = null; if (phase === 'run') note(s.kind === 'person' ? 'faint warm patch through a gap by the stream' : 'warm patch through a gap: flagged', s.x, s.y, C.heat, 5); }
  function gather(s) {
    const low = dr.filter((d) => !d.above && d.on && (d.role === 'search' || d.role === 'rejoin' || d.src === s)).sort((a, b) => ((a.x - s.x) ** 2 + (a.y - s.y) ** 2) - ((b.x - s.x) ** 2 + (b.y - s.y) ** 2)).slice(0, 3);
    low.forEach((d, k) => { const a = k / 3 * TAU + .4; d.role = 'gather'; d.gt = 3.6; d.stay = k === 0; d.tx = s.x + Math.cos(a) * 20; d.ty = s.y + Math.sin(a) * 20; d.src = null; });
    let up = null, bd = 1e18; for (const d of dr) if (d.above && d.on) { const q = (d.x - s.x) ** 2 + (d.y - s.y) ** 2; if (q < bd) { bd = q; up = d; } }
    if (up) { up.role = 'gather'; up.gt = 4.2; up.tx = s.x; up.ty = s.y; }
    const km = Math.hypot(s.x - Wd.base.x, s.y - Wd.base.y) / 1000;
    note('person confirmed: thermal and camera agree', s.x, s.y, C.heat, 6);
    story.gatherAt = T; story.km = km; story.guard = low[0] ? low[0].id : 0; story.upId = up ? up.id : 0;
  }

  function countPockets() {
    lab.fill(0); let n = 0;
    for (let i = 0; i < NC; i++) {
      if (!inside[i] || srch[i] || lab[i]) continue;
      n++; let h = 0, t = 0; qq[t++] = i; lab[i] = n;
      while (h < t) {                                                  // 8-connected: diagonal neighbours touch
        const c = qq[h++], x = c % GW, y = (c / GW) | 0;
        for (let oy = -1; oy <= 1; oy++) {
          const yy = y + oy; if (yy < 0 || yy >= GH) continue;
          for (let ox = -1; ox <= 1; ox++) { const xx = x + ox; if (xx < 0 || xx >= GW) continue; const j = yy * GW + xx; if (inside[j] && !srch[j] && !lab[j]) { lab[j] = n; qq[t++] = j; } }
        }
      }
    }
    if (pockets > 1 && n === 1 && !story.last && phase === 'run') { story.last = 1; let k = 0; for (; k < NC; k++) if (lab[k] === 1) break; note('one unsearched pocket left', (k % GW + .5) * CELL, ((k / GW | 0) + .5) * CELL, C.muted, 4.5); }
    pockets = n;
    buildPocketPath();
  }

  // the edges of the unsearched pockets as one soft contour (marching squares on a 3x3-smoothed coverage field)
  const fld = new Float32Array(NC); let pocketPath = null;
  function buildPocketPath() {
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      let t = 0;
      for (let oy = -1; oy <= 1; oy++) { const y = gy + oy; if (y < 0 || y >= GH) continue; for (let ox = -1; ox <= 1; ox++) { const x = gx + ox; if (x < 0 || x >= GW) continue; const j = y * GW + x; if (inside[j] && !srch[j]) t++; } }
      fld[gy * GW + gx] = t / 9 - .5;
    }
    if (!L) return;
    const p = new Path2D(), c = L.s * CELL, ox = L.ox + .5 * c, oy = L.oy + .5 * c;
    const seg = (x1, y1, x2, y2) => { p.moveTo(ox + x1 * c, oy + y1 * c); p.lineTo(ox + x2 * c, oy + y2 * c); };
    for (let j = 0; j < GH - 1; j++) for (let i = 0; i < GW - 1; i++) {
      const q = j * GW + i, a = fld[q], b = fld[q + 1], d = fld[q + GW], e = fld[q + GW + 1];
      const k = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (e > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const tx = i + a / (a - b), bx = i + d / (d - e), ly = j + a / (a - d), ry = j + b / (b - e);
      switch (k) {
        case 1: case 14: seg(tx, j, i, ly); break;
        case 2: case 13: seg(tx, j, i + 1, ry); break;
        case 3: case 12: seg(i, ly, i + 1, ry); break;
        case 4: case 11: seg(i + 1, ry, bx, j + 1); break;
        case 6: case 9: seg(tx, j, bx, j + 1); break;
        case 7: case 8: seg(i, ly, bx, j + 1); break;
        default: { const m = (a + b + d + e) / 4; if ((k === 5) === (m > 0)) { seg(tx, j, i + 1, ry); seg(i, ly, bx, j + 1); } else { seg(tx, j, i, ly); seg(i + 1, ry, bx, j + 1); } }
      }
    }
    pocketPath = p;
  }

  function note(txt, x, y, col = C.ink, dur = 5, d = null) { notes.push({ txt, x, y, col, t: 0, dur, d }); if (notes.length > 7) notes.shift(); }

  function step(dt) {
    T += dt;
    if (fadeIn > 0) fadeIn = Math.max(0, fadeIn - dt / .9);
    if (phase === 'fade') { phT += dt; if (phT > 1.3) newMission(seed + 1); return; }
    if (phase === 'run') simT += dt * TL;
    for (const k of order) { const d = dr[k]; if (!d.on && T >= d.tOn) { d.on = true; d.role = 'search'; d.decT = 0; d.tx = d.x + (d.above ? 40 : 30); d.ty = d.y; } }
    linkT -= dt; if (linkT <= 0) { linkT = .1; computeLinks(); }
    relayT -= dt; if (relayT <= 0) { relayT = .5; assignRelays(); }
    if (phase === 'run') belowOn = 0;
    for (const d of dr) {
      if (!d.on) continue;
      think(d, dt); move(d, dt);
      if (phase === 'run' || phase === 'done') { if (d.above) senseAbove(d); else senseBelow(d); }
      if (phase === 'run' && !d.above && Math.hypot(d.x - Wd.base.x, d.y - Wd.base.y) > 35) belowOn++;
    }
    if (phase === 'run') updateSources(dt);
    for (const s of Wd.src) if (s.st === 'checking' && s.by) { const a = T * 1.6; s.by.tx = s.x + Math.cos(a) * 10; s.by.ty = s.y + Math.sin(a) * 10; }
    pocketsT -= dt; if (pocketsT <= 0) { pocketsT = .25; countPockets(); }
    // the story beats that are not tied to an event
    if (!story.lift && T > .3) { story.lift = 1; note('18 drones lift off at the trailhead', Wd.base.x, Wd.base.y, C.ink, 4); }
    if (!story.below) { const d = dr.find((x) => !x.above && x.on && Math.hypot(x.x - Wd.base.x, x.y - Wd.base.y) > 110); if (d) { story.below = 1; note('8 fly below the canopy, between the trunks', 0, 0, C.teal, 6.5, d); } }
    if (!story.above && T > 3.2) { const d = dr.find((x) => x.above && x.on && Math.hypot(x.x - Wd.base.x, x.y - Wd.base.y) > 240); if (d) { story.above = 1; note('10 stay above it: thermal sees the ground only through gaps', 0, 0, C.teal, 6.5, d); } }
    if (!story.gps && T > 8.5) { const d = dr.find((x) => !x.above && x.role === 'search' && x.conn); if (d) { story.gps = 1; note('under the crowns it is indoor flying: GPS weak, LiDAR holds position', 0, 0, C.muted, 5.5, d); } }
    if (story.gatherAt && !story.g2 && T > story.gatherAt + 1.4) { story.g2 = 1; note(`3 drones gather; drone ${story.upId} relays his position from above`, found.x, found.y, C.ink, 5.5); }
    if (story.gatherAt && !story.g3 && T > story.gatherAt + 4.4) { story.g3 = 1; const d = dr[story.guard - 1]; if (d) note(`drone ${d.id} stays with him: light and radio. The rest search on`, 0, 0, C.muted, 5.5, d); }
    if (story.gatherAt && !story.g4 && T > story.gatherAt + 10 && pockets > 2 && phase === 'run') { story.g4 = 1; let k = 0; for (; k < NC; k++) if (inside[k] && !srch[k]) break; note('the search goes on until no pocket is left: there could be someone else', (k % GW + .5) * CELL, ((k / GW | 0) + .5) * CELL, C.muted, 5.5); }
    if (phase === 'run' && found && found.st === 'found' && pockets === 0) { phase = 'done'; phT = 0; endSim = simT; story.doneAt = +T.toFixed(1); note('nothing left unsearched: β₀ = 0', WM / 2, HM / 2, C.teal, 3); }
    else if (phase === 'run' && T > 88) { phase = 'done'; phT = 0; endSim = simT; }
    if (phase === 'done') { phT += dt; if (phT > 1.8) { phase = 'summary'; phT = 0; for (const d of dr) if (d.on && d.role !== 'guard') d.role = 'home'; } }
    else if (phase === 'summary') { phT += dt; if (phT > 6) { phase = 'fade'; phT = 0; } }
    for (const n of notes) n.t += dt;
    while (notes.length && notes[0].t > notes[0].dur) notes.shift();
  }

  // ---------------------------------------------------------------- art (pre-rendered per mission and per resize)
  const gnd = mk(), art = mk(), lo = mk(), fogT = mk(), fogB = mk();
  let fT = null, fB = null, L = null, lastLeft = null;
  const dot = mk(32, 32);
  { const x = dot.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(.5, 'rgba(0,0,0,.82)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); }
  const soft = (col) => { const c = mk(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, col(1)); g.addColorStop(.35, col(.45)); g.addColorStop(1, col(0)); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c; };
  const glowT = soft((a) => `rgba(127,212,207,${a * .55})`), glowH = soft((a) => `rgba(255,195,107,${a * .9})`), mist = soft((a) => `rgba(220,228,238,${a * .5})`), shade = soft((a) => `rgba(8,14,20,${a * .5})`);
  const lamp = soft((a) => `rgba(150,170,150,${a * .55})`), halo = soft((a) => `rgba(14,18,38,${a * .7})`);

  // tree crowns: a few dozen sprites (lobed broadleaf crowns and star-shaped conifers), lit from the top left
  // palettes: [shadow, body, light], muted sage / moss / olive so the teal swarm stays the brightest thing
  const PALS = [['#2c4239', '#5c7a64', '#90aa8c'], ['#263a32', '#4e6a55', '#7f9b7c'], ['#323d30', '#637256', '#97a47f'], ['#1f312b', '#41594a', '#6c876d'],
    ['#2a3a37', '#506a63', '#80998e'], ['#463f36', '#86775f', '#b5a283'], ['#3d3440', '#7a6672', '#a98f9c']];
  const CON = ['#192a27', '#34504a', '#5d7b72'];
  const SPR = [], SR = 22, SC = 31;
  function crownSprite(pal, conifer, sd) {
    const c = mk(64, 64), x = c.getContext('2d'), r = kit.rng(sd);
    for (let k = 3; k >= 1; k--) { x.fillStyle = 'rgba(8,12,20,.13)'; x.beginPath(); x.ellipse(SC + 4, SC + 6, SR * (.72 + k * .12), SR * (.68 + k * .11), 0, 0, TAU); x.fill(); }
    if (conifer) {
      const n = 10 + Math.floor(r() * 3), pts = [];
      for (let k = 0; k < n * 2; k++) { const a = k / (n * 2) * TAU + r() * .12, q = k & 1 ? SR * (.48 + r() * .12) : SR * (.8 + r() * .2); pts.push(SC + Math.cos(a) * q, SC + Math.sin(a) * q); }
      const star = (dx, dy, f) => { x.beginPath(); for (let k = 0; k < pts.length; k += 2) { const px = SC + (pts[k] - SC) * f + dx, py = SC + (pts[k + 1] - SC) * f + dy; k ? x.lineTo(px, py) : x.moveTo(px, py); } x.closePath(); };
      x.fillStyle = pal[0]; star(0, 0, 1); x.fill();
      x.fillStyle = pal[1]; star(-1.2, -1.5, .82); x.fill();
      x.fillStyle = pal[2]; x.globalAlpha = .55; star(-2.2, -2.6, .42); x.fill(); x.globalAlpha = 1;
      x.strokeStyle = 'rgba(10,22,22,.4)'; x.lineWidth = .9; x.beginPath(); for (let k = 0; k < pts.length; k += 4) { x.moveTo(SC, SC); x.lineTo(SC + (pts[k] - SC) * .85, SC + (pts[k + 1] - SC) * .85); } x.stroke();
    } else {
      // a lobed crown: dark silhouette, the body nudged toward the light, a few soft highlights, leaf-clump flecks
      const n = 6 + Math.floor(r() * 4), lobes = [];
      for (let k = 0; k < n; k++) { const a = k / n * TAU + r() * .6, q = SR * (.36 + r() * .2), rr = SR * (.36 + r() * .16); lobes.push([SC + Math.cos(a) * q, SC + Math.sin(a) * q, rr]); }
      lobes.push([SC, SC, SR * .58]);
      const all = (dx, dy, f) => { x.beginPath(); for (const [lx, ly, lr] of lobes) { x.moveTo(lx + dx + lr * f, ly + dy); x.arc(lx + dx, ly + dy, lr * f, 0, TAU); } };
      x.fillStyle = pal[0]; all(0, 0, 1); x.fill();
      x.fillStyle = pal[1]; all(-1.3, -1.7, .86); x.fill();
      x.globalAlpha = .5; x.fillStyle = pal[2];
      x.beginPath(); for (const [lx, ly, lr] of lobes) { if (lx + ly > 2 * SC + 6) continue; const hx = lx - lr * .32, hy = ly - lr * .36, hr = lr * .42; x.moveTo(hx + hr, hy); x.arc(hx, hy, hr, 0, TAU); } x.fill();
      x.globalAlpha = .28; x.fillStyle = pal[0]; x.beginPath();
      for (let k = 0; k < 16; k++) { const a = r() * TAU, q = SR * .7 * Math.sqrt(r()), fx = SC + Math.cos(a) * q, fy = SC + Math.sin(a) * q, fr = .8 + r() * 1.3; x.moveTo(fx + fr, fy); x.arc(fx, fy, fr, 0, TAU); }
      x.fill(); x.globalAlpha = 1;
    }
    return c;
  }
  for (let p = 0; p < PALS.length; p++) for (let v = 0; v < 3; v++) SPR.push(crownSprite(PALS[p], false, p * 97 + v * 13 + 1));
  const CONI = SPR.length; for (let v = 0; v < 4; v++) SPR.push(crownSprite(CON, true, 500 + v * 7));

  function renderArt() {
    const { W, H, s, ox, oy } = L, dpr = cv.dpr, pw = Math.max(2, Math.round(W * dpr)), ph = Math.max(2, Math.round(H * dpr)), w = Wd;
    gnd.width = pw; gnd.height = ph; art.width = pw; art.height = ph;
    const g = gnd.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = kit.rng(w.sd * 4099 + 7), X = (x) => ox + x * s, Y = (y) => oy + y * s;
    // 1. the forest floor: shade, leaf litter, meadow in the open; a quarter-resolution noise image, smoothed up
    const q = 4, lw = Math.ceil(W / q) + 2, lh = Math.ceil(H / q) + 2; lo.width = lw; lo.height = lh;
    const lx = lo.getContext('2d'), im = lx.createImageData(lw, lh), px = im.data;
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
      const wx = (i * q - ox) / s, wy = (j * q - oy) / s;
      const n1 = fbm(wx / 30, wy / 30, w.s2 + 3, 3), n2 = fbm(wx / 130, wy / 130, w.s3 + 5, 2), open = 1 - canopy(wx, wy, true);
      let r0 = lerp(28, 50, n1), g0 = lerp(40, 60, n1), b0 = lerp(46, 58, n1);
      const lit = sstep(.5, .7, n2) * .6; r0 = lerp(r0, 82, lit); g0 = lerp(g0, 72, lit); b0 = lerp(b0, 62, lit);
      const m = sstep(.32, .88, open); r0 = lerp(r0, lerp(92, 136, n1), m); g0 = lerp(g0, lerp(114, 150, n1), m); b0 = lerp(b0, lerp(100, 120, n1), m);
      const o = (j * lw + i) * 4; px[o] = r0; px[o + 1] = g0; px[o + 2] = b0; px[o + 3] = 255;
    }
    lx.putImageData(im, 0, 0);
    g.imageSmoothingEnabled = true; g.drawImage(lo, -q / 2, -q / 2, lw * q, lh * q);
    // grass tufts in the clearings
    g.strokeStyle = 'rgba(190,206,160,.22)'; g.lineWidth = 1; g.beginPath();
    for (const c of w.clear) for (let k = 0; k < 40; k++) { const a = R() * TAU, qd = Math.sqrt(R()) * .9, x = X(c.x + Math.cos(a) * c.rx * qd), y = Y(c.y + Math.sin(a) * c.ry * qd); g.moveTo(x, y); g.lineTo(x + (R() - .5) * 2, y - 2 - R() * 2); }
    g.stroke();
    // 2. the stream: muddy banks, water, a broken sheen
    const sp = new Path2D(), S = w.stream.pts; for (let k = 0; k < w.stream.n; k++) k ? sp.lineTo(X(S[2 * k]), Y(S[2 * k + 1])) : sp.moveTo(X(S[0]), Y(S[1]));
    const sw = clamp(7.5 * s, 2.6, 6.5);
    g.lineJoin = g.lineCap = 'round';
    g.strokeStyle = 'rgba(122,110,94,.5)'; g.lineWidth = sw + 7; g.stroke(sp);
    g.strokeStyle = 'rgba(70,86,96,.8)'; g.lineWidth = sw + 2.5; g.stroke(sp);
    g.strokeStyle = '#46679a'; g.lineWidth = sw; g.stroke(sp);
    g.strokeStyle = '#5E7FB0'; g.lineWidth = sw * .58; g.stroke(sp);
    g.save(); g.translate(-.4, -.5); g.strokeStyle = 'rgba(143,183,208,.75)'; g.lineWidth = Math.max(.8, sw * .16); g.setLineDash([5, 11]); g.stroke(sp); g.restore();
    // 3. the trail
    const tp = new Path2D(), Tq = w.trail.pts; for (let k = 0; k < w.trail.n; k++) k ? tp.lineTo(X(Tq[2 * k]), Y(Tq[2 * k + 1])) : tp.moveTo(X(Tq[0]), Y(Tq[1]));
    g.strokeStyle = 'rgba(60,52,46,.35)'; g.lineWidth = clamp(4 * s, 2, 3.6); g.stroke(tp);
    g.strokeStyle = 'rgba(201,169,142,.7)'; g.lineWidth = clamp(2.4 * s, 1.1, 2); g.stroke(tp);
    // 4. rocks
    for (let k = 0; k < w.rocks.length; k += 3) {
      const x = X(w.rocks[k]), y = Y(w.rocks[k + 1]), r = Math.max(1, w.rocks[k + 2] * s * 1.1);
      g.fillStyle = 'rgba(14,20,26,.35)'; g.beginPath(); g.ellipse(x + r * .35, y + r * .4, r, r * .8, 0, 0, TAU); g.fill();
      g.fillStyle = '#7d7b98'; g.beginPath(); g.ellipse(x, y, r, r * .8, .3, 0, TAU); g.fill();
      g.fillStyle = 'rgba(220,214,236,.35)'; g.beginPath(); g.ellipse(x - r * .3, y - r * .3, r * .45, r * .3, .3, 0, TAU); g.fill();
    }
    // 5. crowns (screen-space scatter, density from the world's canopy field) and their trunks
    const rb = clamp(12 * s, 5, 12), gs = rb * 1.16, cr = [];
    for (let pass = 0; pass < 2; pass++) for (let gy = -1; gy < H / gs + 1; gy++) for (let gx = -1; gx < W / gs + 1; gx++) {
      const x = (gx + (pass ? .5 : 0) + (R() - .5) * .9) * gs, y = (gy + (pass ? .5 : 0) + (R() - .5) * .9) * gs, wx = (x - ox) / s, wy = (y - oy) / s;
      const d = canopy(wx, wy, false), u = R();
      if (u > (pass ? d * d * .9 : Math.pow(d, .55))) continue;
      const r = rb * (.62 + .62 * R() * R() + .18 * R()) * (.78 + .32 * d) * (pass ? .8 : 1);
      const con = fbm(wx / 320, wy / 320, w.s1 + 77, 2) > .6 && R() < .75;
      let v;
      if (con) v = CONI + Math.floor(R() * 4);
      else { const t = fbm(wx / 260, wy / 260, w.s2 + 41, 2) * 4.4 + R() * 1.2; let p = Math.min(4, Math.floor(t)); if (R() < .03) p = 5; else if (R() < .01) p = 6; v = p * 3 + Math.floor(R() * 3); }
      cr.push(x, y, r, v);
    }
    const idx = []; for (let k = 0; k < cr.length; k += 4) idx.push(k); idx.sort((a, b) => cr[a + 1] - cr[b + 1]);
    g.fillStyle = 'rgba(20,24,26,.9)'; g.beginPath();
    for (const k of idx) { const x = cr[k] + cr[k + 2] * .06, y = cr[k + 1] + cr[k + 2] * .1, r = Math.max(.9, cr[k + 2] * .15); g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }
    g.fill();
    const a = art.getContext('2d'); a.setTransform(1, 0, 0, 1, 0, 0); a.drawImage(gnd, 0, 0); a.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const k of idx) { const r = cr[k + 2], f = r / SR; a.drawImage(SPR[cr[k + 3]], cr[k] - SC * f, cr[k + 1] - SC * f, 64 * f, 64 * f); }
    // 6. light: warm from the top left, dusk in the bottom right, a soft vignette
    let gr = a.createLinearGradient(0, 0, W, H); gr.addColorStop(0, 'rgba(246,210,177,.09)'); gr.addColorStop(.45, 'rgba(246,210,177,0)'); gr.addColorStop(.55, 'rgba(27,30,61,0)'); gr.addColorStop(1, 'rgba(27,30,61,.34)');
    a.fillStyle = gr; a.fillRect(0, 0, W, H);
    gr = a.createRadialGradient(W * .62, H * .5, Math.min(W, H) * .3, W * .62, H * .5, Math.max(W, H) * .8); gr.addColorStop(0, 'rgba(20,22,46,0)'); gr.addColorStop(1, 'rgba(20,22,46,.5)');
    a.fillStyle = gr; a.fillRect(0, 0, W, H);
    // darker bands top and bottom so the labels there read
    gr = a.createLinearGradient(0, 0, 0, 130); gr.addColorStop(0, 'rgba(22,24,50,.78)'); gr.addColorStop(1, 'rgba(22,24,50,0)'); a.fillStyle = gr; a.fillRect(0, 0, W, 130);
    gr = a.createLinearGradient(0, H - 120, 0, H); gr.addColorStop(0, 'rgba(22,24,50,0)'); gr.addColorStop(1, 'rgba(22,24,50,.85)'); a.fillStyle = gr; a.fillRect(0, H - 120, W, 120);
    // 7. outside the search area: dimmer; the boundary as a dashed line
    const pp = new Path2D(); for (let k = 0; k < w.poly.length; k += 2) k ? pp.lineTo(X(w.poly[k]), Y(w.poly[k + 1])) : pp.moveTo(X(w.poly[0]), Y(w.poly[1])); pp.closePath();
    const outside = new Path2D(); outside.rect(0, 0, W, H); outside.addPath(pp);
    a.fillStyle = 'rgba(22,24,50,.36)'; a.fill(outside, 'evenodd');
    a.strokeStyle = 'rgba(243,238,242,.42)'; a.lineWidth = 1.2; a.setLineDash([6, 5]); a.stroke(pp); a.setLineDash([]);
    L.polyPath = pp;
  }

  // fog of war: two soft layers erased cell by cell. Top (hatched, darker): nobody has looked, not even thermal from
  // above. Bottom (dimmer): not yet searched to the ground. Above-canopy thermal clears the top layer everywhere it
  // passes but the bottom one only where the crowns are open; drones below the canopy clear both.
  function buildFog() {
    const { W, H, s, ox, oy } = L, w = Wd;
    const pp = new Path2D(); for (let k = 0; k < w.polyIn.length; k += 2) k ? pp.lineTo(ox + w.polyIn[k] * s, oy + w.polyIn[k + 1] * s) : pp.moveTo(ox + w.polyIn[0] * s, oy + w.polyIn[1] * s); pp.closePath();
    fogT.width = Math.max(2, Math.round(W)); fogT.height = Math.max(2, Math.round(H));
    const t = fogT.getContext('2d');
    t.fillStyle = 'rgba(28,29,62,.42)'; t.fill(pp);
    t.save(); t.clip(pp); t.strokeStyle = 'rgba(176,172,226,.16)'; t.lineWidth = 1; t.beginPath();
    for (let k = -H; k < W; k += 7) { t.moveTo(k, 0); t.lineTo(k + H, H); } t.stroke(); t.restore();
    t.globalCompositeOperation = 'destination-out'; fT = t;
    fogB.width = Math.max(2, Math.ceil(W / 2)); fogB.height = Math.max(2, Math.ceil(H / 2));
    const b = fogB.getContext('2d'); b.setTransform(.5, 0, 0, .5, 0, 0); b.fillStyle = 'rgba(38,39,46,.46)'; b.fill(pp);
    b.globalCompositeOperation = 'destination-out'; fB = b;
    for (let i = 0; i < NC; i++) { if (seenA[i]) stampT(i); if (srch[i]) stampB(i); }
  }
  function stampT(i) {
    if (!fT) return; const r = CELL * L.s * 1.5, x = L.ox + ((i % GW) + .5) * CELL * L.s, y = L.oy + (((i / GW) | 0) + .5) * CELL * L.s;
    fT.drawImage(dot, x - r, y - r, 2 * r, 2 * r);
  }
  function stampB(i) {
    if (!fB) return; const r = CELL * L.s * 1.55, x = L.ox + ((i % GW) + .5) * CELL * L.s, y = L.oy + (((i / GW) | 0) + .5) * CELL * L.s;
    fB.drawImage(dot, x - r, y - r, 2 * r, 2 * r);
  }

  // ---------------------------------------------------------------- layout
  function layout() {
    const W = cv.w, H = cv.h, left = parseFloat(stage.dataset.left || '0') || 0, phone = W < 640;
    const x0 = phone ? 14 : Math.max(16, left * W + 20), x1 = W - (phone ? 14 : 24), y0 = phone ? 108 : 108, y1 = H - (phone ? 100 : 96);
    const s = Math.max(.05, Math.min((x1 - x0) / WM, (y1 - y0) / HM));
    L = { W, H, phone, x0, x1, y0, y1, s, ox: x0 + ((x1 - x0) - WM * s) / 2, oy: y0 + ((y1 - y0) - HM * s) / 2, polyPath: null };
    lastLeft = stage.dataset.left;
    renderArt(); buildFog(); buildPocketPath();
  }

  // ---------------------------------------------------------------- drawing
  const rects = []; let nR = 0;
  const free = (x, y, w, h) => { for (let k = 0; k < nR; k += 4) if (x < rects[k] + rects[k + 2] && rects[k] < x + w && y < rects[k + 1] + rects[k + 3] && rects[k + 1] < y + h) return false; return true; };
  const hold = (x, y, w, h) => { rects[nR++] = x; rects[nR++] = y; rects[nR++] = w; rects[nR++] = h; };
  function pill(s, x, y, col, fs, alpha = 1, bg = 'rgba(22,24,50,.84)') {
    ctx.font = `400 ${fs}px ${F.sans}`; const tw = ctx.measureText(s).width, bw = tw + 16, bh = fs + 10;
    ctx.globalAlpha = alpha; ctx.fillStyle = bg; roundRect(ctx, x, y, bw, bh, bh / 2); ctx.fill();
    text(ctx, s, x + 8, y + bh / 2 + .5, { size: fs, color: col, base: 'middle' }); ctx.globalAlpha = 1;
    return [bw, bh];
  }
  function drone(x, y, sz, rot, col, lw) {
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath();
    const c = Math.cos(rot + Math.PI / 4) * sz, s = Math.sin(rot + Math.PI / 4) * sz;
    ctx.moveTo(x - c, y - s); ctx.lineTo(x + c, y + s); ctx.moveTo(x + s, y - c); ctx.lineTo(x - s, y + c); ctx.stroke();
    const rr = sz * .48; ctx.beginPath();
    ctx.moveTo(x - c + rr, y - s); ctx.arc(x - c, y - s, rr, 0, TAU); ctx.moveTo(x + c + rr, y + s); ctx.arc(x + c, y + s, rr, 0, TAU);
    ctx.moveTo(x + s + rr, y - c); ctx.arc(x + s, y - c, rr, 0, TAU); ctx.moveTo(x - s + rr, y + c); ctx.arc(x - s, y + c, rr, 0, TAU);
    ctx.stroke();
  }
  function deerIcon(x, y, k, col) {
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.3 / k; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.ellipse(0, 0, 5.5, 2.4, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(4.2, -1); ctx.lineTo(6.6, -4.6); ctx.stroke(); ctx.beginPath(); ctx.ellipse(7.4, -5.2, 1.7, 1.1, -.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(6.8, -6); ctx.lineTo(6.2, -8.6); ctx.moveTo(6.4, -7.4); ctx.lineTo(5, -8.2); ctx.moveTo(7.6, -6.1); ctx.lineTo(8.8, -8.4); ctx.stroke();
    ctx.beginPath(); for (const lx of [-4, -2.6, 2.8, 4]) { ctx.moveTo(lx, 1.5); ctx.lineTo(lx + (lx < 0 ? -.4 : .4), 5.6); } ctx.stroke();
    ctx.restore();
  }
  function rockIcon(x, y, k, col) {
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.strokeStyle = col; ctx.lineWidth = 1.4 / k; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-6, 3); ctx.lineTo(-4.5, -2.5); ctx.lineTo(-.5, -4.5); ctx.lineTo(4.5, -2.5); ctx.lineTo(6.5, 2.5); ctx.lineTo(2, 4.2); ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
  function personIcon(x, y, k, col) {
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 1.6 / k; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(-3.4, -.6, 1.7, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-1.6, 0); ctx.lineTo(4.2, .6); ctx.moveTo(.2, -.2); ctx.lineTo(1.2, -2.6); ctx.moveTo(4.2, .6); ctx.lineTo(6.4, -1.4); ctx.moveTo(4.2, .6); ctx.lineTo(6.6, 2.2); ctx.stroke();
    ctx.restore();
  }
  const fmtMin = (sec) => { const m = Math.round(sec / 60); return m >= 60 ? `${(m / 60) | 0} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
  const km2 = (cells) => (cells * CELL * CELL / 1e6).toFixed(2) + ' km²';
  const X = (x) => L.ox + x * L.s, Y = (y) => L.oy + y * L.s;
  let hoverD = null, hx = 0, hy = 0;

  function draw() {
    if (stage.dataset.left !== lastLeft) layout();
    const { W, H, phone } = L, s = L.s;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(art, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    // not searched to the ground: drained of colour (saturation blend) and dimmed; never looked at: hatched dusk on top
    ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = .9; ctx.drawImage(fogB, 0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.drawImage(fogB, 0, 0, W, H);
    ctx.drawImage(fogT, 0, 0, W, H);
    if (pocketPath && (phase === 'run' || phase === 'done')) { ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(196,180,246,.62)'; ctx.stroke(pocketPath); ctx.setLineDash([]); }
    // a little drifting mist over the crowns
    ctx.globalAlpha = .22;
    for (let k = 0; k < 3; k++) { const t = T * .012 + k * 1.7, mx = W * (.5 + .4 * Math.sin(t * 1.3 + k)), my = H * (.5 + .35 * Math.cos(t + k * 2.1)), mr = Math.max(W, H) * (.2 + .06 * k); ctx.drawImage(mist, mx - mr, my - mr * .6, 2 * mr, 1.2 * mr); }
    ctx.globalAlpha = 1;
    const sz = phone ? 3.1 : 4.4, szB = phone ? 2.6 : 3.4, dpr = cv.dpr;
    // the drones below: a window through the crowns onto the forest floor and the trunks they weave between
    const rL = Math.max(phone ? 8 : 11, RB * s * 1.05);
    for (const d of dr) {
      if (!d.on || d.above || d.alt < .05) continue;
      const x = X(d.x), y = Y(d.y), rr = rL * Math.min(1, d.alt * 1.5);
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.clip();
      ctx.drawImage(gnd, (x - rr) * dpr, (y - rr) * dpr, 2 * rr * dpr, 2 * rr * dpr, x - rr, y - rr, 2 * rr, 2 * rr);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = d.conn ? .5 : .3; ctx.drawImage(lamp, x - rr * 1.1, y - rr * 1.1, rr * 2.2, rr * 2.2);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.restore();
      ctx.strokeStyle = d.conn ? 'rgba(127,212,207,.4)' : 'rgba(220,214,236,.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
    }
    // mesh links: thin dashed teal lines
    ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(127,212,207,.34)'; ctx.beginPath();
    for (let k = 0; k < nLink; k += 2) { const a = dr[link[k]], b = dr[link[k + 1]]; if (a.above && b.above && ((a.x - b.x) ** 2 + (a.y - b.y) ** 2) > 330 * 330) continue; ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); }
    ctx.stroke(); ctx.setLineDash([]);
    // trails: batched by age
    for (const above of [false, true]) {
      ctx.lineWidth = above ? 1.6 : 1.2;
      for (let a = 0; a < TRN - 1; a++) {
        ctx.beginPath();
        for (const d of dr) {
          if (!d.on || d.above !== above || d.tn < a + 2) continue;
          const i0 = ((d.tn - 1 - a) % TRN) * 2, i1 = ((d.tn - 2 - a) % TRN) * 2;
          if (a === 0) { ctx.moveTo(X(d.x), Y(d.y)); ctx.lineTo(X(d.tr[i0]), Y(d.tr[i0 + 1])); }
          ctx.moveTo(X(d.tr[i0]), Y(d.tr[i0 + 1])); ctx.lineTo(X(d.tr[i1]), Y(d.tr[i1 + 1]));
        }
        ctx.strokeStyle = above ? `rgba(127,212,207,${.42 * (1 - a / TRN)})` : `rgba(160,220,214,${.3 * (1 - a / TRN)})`; ctx.stroke();
      }
    }
    // below drones (dim), then the warm things, then above drones (bright, with a shadow on the crowns)
    for (const d of dr) { if (!d.on || d.above) continue; ctx.globalAlpha = d.conn ? .78 : .42; drone(X(d.x), Y(d.y), szB, d.rot, d.conn ? '#9fdcd6' : '#b8b4cc', 1.3); }
    ctx.globalAlpha = 1;
    drawSources();
    for (const d of dr) {
      if (!d.on || !d.above) continue;
      const x = X(d.x), y = Y(d.y), off = 7 * d.alt;
      ctx.globalAlpha = .8 * d.alt; ctx.drawImage(shade, x + off - 8, y + off * 1.2 - 8, 16, 16);
      ctx.globalAlpha = 1; ctx.drawImage(halo, x - 11, y - 11, 22, 22); ctx.drawImage(glowT, x - 18, y - 18, 36, 36);
    }
    ctx.globalAlpha = 1;
    for (const d of dr) if (d.on && d.above) drone(X(d.x), Y(d.y), sz * (.6 + .4 * d.alt), d.rot, C.teal, 1.6);
    drawBase();
    nR = 0;
    drawHUD();
    if (phase !== 'summary' && phase !== 'fade') drawNotes();
    if (hoverD) drawTip();
    if (phase === 'summary' || phase === 'fade') drawSummary(phase === 'summary' ? Math.min(1, phT / .5) : Math.max(0, 1 - phT / .6));
    const fa = phase === 'fade' ? Math.min(1, phT / 1.1) : fadeIn;
    if (fa > 0) { ctx.fillStyle = `rgba(27,30,61,${fa})`; ctx.fillRect(0, 0, W, H); }
  }

  function drawSources() {
    const k = L.phone ? .8 : 1;
    for (const s of Wd.src) {
      const x = X(s.x), y = Y(s.y);
      if (s.st === 'flagged' || s.st === 'checking') {
        const p = .5 + .5 * Math.sin(T * 5);
        ctx.globalAlpha = .35 + .25 * p; ctx.drawImage(glowH, x - 16, y - 16, 32, 32); ctx.globalAlpha = 1;
        ctx.strokeStyle = C.heat; ctx.lineWidth = 1.3; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, 12 * k + 2 * p, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        if (s.st === 'checking') { ctx.strokeStyle = C.teal; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, 17 * k, T * 4, T * 4 + 1.3); ctx.stroke(); }
        else text(ctx, '?', x, y + 4, { size: 11, color: C.heat, weight: 600, align: 'center' });
      } else if (s.st === 'rejected') {
        const a = Math.max(.45, 1 - s.age / 14);
        ctx.globalAlpha = a; ctx.fillStyle = 'rgba(22,24,50,.6)'; ctx.beginPath(); ctx.arc(x, y, 11 * k, 0, TAU); ctx.fill();
        if (s.kind === 'deer') deerIcon(x - 1, y + 1, k, C.rose); else rockIcon(x, y, k, C.rose);
        ctx.globalAlpha = 1;
      } else if (s.st === 'found') {
        const p = .5 + .5 * Math.sin(T * 3);
        ctx.globalAlpha = .8 + .2 * p; ctx.drawImage(glowH, x - 26, y - 26, 52, 52); ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,195,107,.6)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 14 + 10 * ((T * .7) % 1), 0, TAU); ctx.globalAlpha = 1 - ((T * .7) % 1); ctx.stroke(); ctx.globalAlpha = 1;
        personIcon(x - 1, y, k * 1.05, '#FFE2B0');
      }
    }
  }

  function drawBase() {
    const x = X(Wd.base.x), y = Y(Wd.base.y), k = L.phone ? .8 : 1;
    ctx.fillStyle = 'rgba(22,24,50,.6)'; roundRect(ctx, x - 9 * k, y - 6 * k, 18 * k, 12 * k, 3); ctx.fill();
    ctx.fillStyle = C.apricot; roundRect(ctx, x - 7 * k, y - 4 * k, 14 * k, 8 * k, 2); ctx.fill();
    ctx.strokeStyle = C.apricot; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + 4 * k, y - 4 * k); ctx.lineTo(x + 4 * k, y - 11 * k); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 4 * k, y - 11 * k, 3.5 * k, -2.4, -.7); ctx.stroke();
    if (!L.phone) text(ctx, 'trailhead', x, y + 20, { size: 11, color: C.muted, align: 'center' });
  }

  function drawHUD() {
    const { x0, H, phone, W } = L, fs = 11;
    let y = H - (phone ? 40 : 22);
    const clock = `${fmtMin(phase === 'run' ? simT : endSim)} · time-lapse ×${TL}`;
    text(ctx, clock, x0, y, { size: phone ? 11 : 12, color: C.muted, font: F.mono });
    y -= phone ? 16 : 18;
    text(ctx, phone ? 'below: indoor mode, LiDAR, 3-D voxels, GPS weak' : 'below the canopy: indoor mode · 3-D voxels, LiDAR, GPS weak', x0, y, { size: fs, color: C.muted });
    y -= 15;
    text(ctx, phone ? 'above: outdoor mode, thermal, 4 m grid, GPS on' : 'above the canopy: outdoor mode · 2.5-D grid, 4 m cells, thermal first, GPS on', x0, y, { size: fs, color: C.muted });
    // scale bar and search-area label above the polygon
    const len = 100 * L.s, sy = L.y0 - 20;
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, sy - 4); ctx.lineTo(x0, sy); ctx.lineTo(x0 + len, sy); ctx.lineTo(x0 + len, sy - 4); ctx.stroke();
    text(ctx, '100 m', x0 + len + 6, sy + 1, { size: 11, color: C.muted, font: F.mono, base: 'middle' });
    if (!phone || W > 360) text(ctx, `search area ${km2(insideN)}`, x0 + len + 52, sy + 1, { size: 11, color: C.muted, base: 'middle' });
    // unsearched pockets (β₀ of the unsearched region), top right of the search area
    const lab2 = 'unsearched pockets', num = B0S.update(pockets, phase === 'run' ? simT : 0);
    ctx.font = `400 ${fs}px ${F.sans}`; const tw = ctx.measureText(lab2).width; ctx.font = `500 14px ${F.mono}`; const nw = ctx.measureText(num).width;
    const bw = tw + nw + 50, bh = 26, bx = L.x1 - bw, by = Math.max(74, sy - 13);
    ctx.fillStyle = 'rgba(22,24,50,.8)'; roundRect(ctx, bx, by, bw, bh, 13); ctx.fill();
    ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(196,180,246,.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(bx + 12, by + 13); ctx.lineTo(bx + 28, by + 13); ctx.stroke(); ctx.setLineDash([]);
    text(ctx, lab2, bx + 34, by + 13.5, { size: fs, color: C.muted, base: 'middle' });
    text(ctx, num, bx + bw - 12, by + 14, { size: 14, color: num === '0' ? C.teal : num === '…' ? C.muted : C.ink, font: F.mono, weight: 500, align: 'right', base: 'middle' });
    hold(bx, by, bw, bh);
  }

  function drawNotes() {
    const fs = L.phone ? 11 : 12;
    for (let k = Math.max(0, notes.length - (L.phone ? 2 : 4)); k < notes.length; k++) {
      const n = notes[k], a = Math.max(0, Math.min(1, n.t / .35, (n.dur - n.t) / .7)); if (a <= 0) continue;
      const ax = X(n.d ? n.d.x : n.x), ay = Y(n.d ? n.d.y : n.y);
      ctx.font = `400 ${fs}px ${F.sans}`; const tw = ctx.measureText(n.txt).width, bw = tw + 16, bh = fs + 10;
      let bx = ax + 14, by = ay - 18 - bh;
      if (bx + bw > L.x1) bx = ax - 14 - bw;
      bx = clamp(bx, L.phone ? 8 : L.x0 - 12, L.W - (L.phone ? 8 : 24) - bw); by = clamp(by, 74, L.H - (L.phone ? 96 : 84) - bh);
      // slide away from labels already placed: one direction first, then the other
      const by0 = by, lo = 74, hi = L.H - (L.phone ? 96 : 84) - bh, dir = by > L.H * .55 ? -1 : 1;
      for (let m = 0; m < 10 && !free(bx, by, bw, bh); m++) { by += dir * (bh + 4); if (by < lo || by > hi) { by = by0; break; } }
      for (let m = 0; m < 10 && !free(bx, by, bw, bh); m++) { by -= dir * (bh + 4); if (by < lo || by > hi) { by = clamp(by, lo, hi); break; } }
      hold(bx, by, bw, bh);
      ctx.globalAlpha = a;
      const lx = clamp(ax, bx + 6, bx + bw - 6), ly = by + bh / 2 < ay ? by + bh : by;
      ctx.strokeStyle = 'rgba(243,238,242,.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(lx, ly); ctx.stroke();
      ctx.fillStyle = n.col === C.heat ? 'rgba(52,40,40,.88)' : 'rgba(22,24,50,.86)'; roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
      text(ctx, n.txt, bx + 8, by + bh / 2 + .5, { size: fs, color: n.col, base: 'middle' });
      ctx.globalAlpha = 1;
    }
  }

  function drawTip() {
    const d = hoverD; if (!d.on) { hoverD = null; return; }
    const roleTxt = { search: 'frontier', check: 'checking a warm patch', gather: 'gathering', guard: 'staying with him', relay: 'radio relay', rejoin: 'heading back into range', home: 'returning' }[d.role] || d.role;
    const dist = Math.round(Math.hypot(d.tx - d.x, d.ty - d.y));
    const s = `drone ${d.id}: ${d.above ? 'above' : 'below'}, ${roleTxt}${d.role === 'search' ? ', ' + dist + ' m' : ''}${!d.above && !d.conn ? ', out of range' : ''}`;
    const x = X(d.x), y = Y(d.y); ctx.font = `400 11px ${F.sans}`; const bw = ctx.measureText(s).width + 16;
    pill(s, clamp(x + 10, 6, L.W - bw - 6), clamp(y + 12, 74, L.H - 30), C.ink, 11, 1, 'rgba(14,16,36,.92)');
  }

  function drawSummary(a) {
    const { x0, x1, y0, y1, phone, W, H } = L, w = Math.min(phone ? W - 28 : 430, x1 - x0 - 20), cx = phone ? W / 2 : (x0 + x1) / 2, cy = (y0 + y1) / 2;
    ctx.globalAlpha = a * .55; ctx.fillStyle = '#16182f'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = a;
    const km = Math.hypot(found ? found.x - Wd.base.x : 0, found ? found.y - Wd.base.y : 0) / 1000;
    const lines = phone ? [
      [`${km2(nS)} in ${fmtMin(endSim)}, nothing left unsearched`, C.ink],
      [found ? `${km.toFixed(1)} km from the trailhead, by the stream` : 'not found in this run', C.muted],
      [`${falseN} warm patch${falseN === 1 ? '' : 'es'} rejected: a deer, a rock`, C.rose],
      ['10 drones above the canopy, 8 below', C.teal],
    ] : [
      [`${km2(nS)} searched in ${fmtMin(endSim)}, nothing left unsearched`, C.ink],
      [found ? `found ${km.toFixed(1)} km from the trailhead, beside the stream` : 'not found in this run', C.muted],
      [`${falseN} warm patch${falseN === 1 ? '' : 'es'} rejected by the camera (a deer, a warm rock)`, C.rose],
      ['10 drones above the canopy, 8 below it, one shared map', C.teal],
    ];
    const fs = phone ? 11.5 : 13, lh = phone ? 19 : 22, h = 64 + lines.length * lh + 10, bx = cx - w / 2, by = cy - h / 2;
    ctx.fillStyle = 'rgba(30,33,64,.94)'; roundRect(ctx, bx, by, w, h, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(220,214,236,.14)'; ctx.lineWidth = 1; roundRect(ctx, bx + .5, by + .5, w - 1, h - 1, 16); ctx.stroke();
    ctx.drawImage(glowH, bx + 10, by + 12, 30, 30);
    text(ctx, found ? 'Trekker found' : 'Search complete', bx + 44, by + 33, { size: phone ? 16 : 19, color: C.heat, font: F.serif });
    let yy = by + 62;
    for (const [s, col] of lines) { text(ctx, s, bx + 20, yy, { size: fs, color: col }); yy += lh; }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- readouts, input, loop
  const rArea = kit.readout(readouts, { label: 'Area searched', tone: 'teal' });
  const rBelow = kit.readout(readouts, { label: 'Drones below canopy', tone: 'haze' });
  const rFalse = kit.readout(readouts, { label: 'False alarms rejected', tone: 'rose' });

  const onMove = (e) => {
    if (!L) return; const r = el.getBoundingClientRect(); hx = e.clientX - r.left; hy = e.clientY - r.top;
    let best = null, bd = (e.pointerType === 'mouse' ? 14 : 22) ** 2;
    for (const d of dr) { if (!d.on) continue; const q = (X(d.x) - hx) ** 2 + (Y(d.y) - hy) ** 2; if (q < bd) { bd = q; best = d; } }
    hoverD = best;
  };
  const onLeave = () => { hoverD = null; };
  el.addEventListener('pointermove', onMove); el.addEventListener('pointerdown', onMove); el.addEventListener('pointerleave', onLeave);

  newMission(seed);
  cv.onResize(() => layout());
  layout();

  let msS = 0, msD = 0, frames = 0;
  const loop = kit.loop((dt) => {
    const t0 = performance.now();
    dt = dt > 0 ? Math.min(dt, .05) : 0;                     // the first frame after start() can report a negative step
    const n = Math.max(1, Math.ceil(dt / (1 / 40)));
    for (let k = 0; k < n; k++) step(dt / n);
    const t1 = performance.now();
    draw();
    rArea.set(km2(nS)); rBelow.set(String(belowOn)); rFalse.set(String(falseN));
    msS += t1 - t0; msD += performance.now() - t1; frames++;
  });
  draw();
  return {
    start: loop.start, stop: loop.stop,
    destroy() { loop.stop(); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onMove); el.removeEventListener('pointerleave', onLeave); cv.destroy(); },
    // debug hooks for screenshots: run the mission ahead (no drawing), read the phase, read the cost per frame
    resetTiming() { msS = msD = frames = 0; },
    warp(sec) { const n = Math.round(sec * 20); for (let k = 0; k < n; k++) step(1 / 20); draw(); },
    warpTo(p) { for (let k = 0; k < 20 * 120; k++) { if (p === 'found' ? !!found && story.gatherAt && T > story.gatherAt + 2 : phase === p) break; step(1 / 20); } draw(); },
    info() { return { d1: [X(dr[12].x), Y(dr[12].y)], phase, T: +T.toFixed(1), sim: fmtMin(simT), pockets, found: !!found, falseN, searched: km2(nS), dense: (() => { let n = 0; for (let i = 0; i < NC; i++) if (inside[i] && densL[i] >= DEN_SEE) n++; return (n / insideN).toFixed(2); })(), stepMs: +(msS / Math.max(1, frames)).toFixed(2), drawMs: +(msD / Math.max(1, frames)).toFixed(2), doneAt: story.doneAt || 0, seed, drones: dr.map((d) => `${d.id}${d.above ? 'A' : 'B'}:${d.role}:${Math.round(d.x)},${Math.round(d.y)}${d.conn ? '' : '!'}`).join(' '), src: Wd.src.map((q) => [q.kind, q.st, Math.round(q.x), Math.round(q.y), +q.den.toFixed(2), srcAt[Math.floor(q.y / CELL) * GW + Math.floor(q.x / CELL)], inside[Math.floor(q.y / CELL) * GW + Math.floor(q.x / CELL)], srch[Math.floor(q.y / CELL) * GW + Math.floor(q.x / CELL)], q.by ? q.by.id + q.by.role : '-']) }; },
  };
}

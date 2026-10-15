// Maps that agree in any order (a CRDT coverage merge; the mesh carries measurement, never command).
// Three drones search a floor on their own. Each keeps its OWN copy of the set of searched cells: a grow-only set
// (G-Set) whose merge is set union, which is commutative, associative and idempotent. Every 0.4 s a drone sends each
// peer the cells it has searched since its last send (delta); packets can be lost, late and shuffled. Every 3 s it
// also sends a digest (one 16-bit hash per 8 x 5 block of the floor); a peer whose block differs answers with all its
// cells in that block (anti-entropy), so whatever was lost is repaired; while two drones find they disagree, they
// compare every 1 s instead of every 3 s. Nothing is ever resolved, because a union cannot conflict (the 'Merge
// conflicts' counter has no code path that could raise it): once the radio has caught up, the three sets are
// identical whatever order the packets came in. The drones fly only on what they themselves know; no packet is a command.

// ------------------------------------------------------------------ the engine (no DOM)
export function crdtEngine({ GW = 32, GH = 20, seed = 7 } = {}) {
  const NC = GW * GH, ND = 3, BW = 8, BH = 5, NB = (GW / BW) * (GH / BH);
  const SPEED = 3.2, SR = 2.3, SEND = .4, DIGEST = 3, HURRY = 1, HEADER = 16, PER_CELL = 4, MAXC = BW * BH;
  let rs = seed >>> 0; const R = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);
  const wall = new Uint8Array(NC), seen = new Uint8Array(NC);
  const H = new Uint16Array(NC);                                       // per-cell 16-bit hash: XOR of a set is order-free
  for (let c = 0; c < NC; c++) { let h = Math.imul(c + 1, 0x9E3779B1); h ^= h >>> 15; h = Math.imul(h, 0x85EBCA77); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE3D); h ^= h >>> 16; H[c] = (h & 0xffff) || 1; }
  const blockOf = new Uint8Array(NC); for (let c = 0; c < NC; c++) blockOf[c] = ((c / GW / BH) | 0) * (GW / BW) + (((c % GW) / BW) | 0);

  // each drone's own replica
  const know = [0, 1, 2].map(() => new Uint8Array(NC)), fresh = [0, 1, 2].map(() => new Float32Array(NC).fill(-9));
  const cnt = new Int32Array(ND), fp = new Uint16Array(ND), bh = [0, 1, 2].map(() => new Uint16Array(NB));
  // what each drone still has to tell each peer (cells it searched itself), as a queue per directed link
  const buf = new Int16Array(ND * ND * NC), bufH = new Int32Array(ND * ND), bufT = new Int32Array(ND * ND);
  const dr = [0, 1, 2].map(() => ({ x: 0, y: 0, th: 0, path: new Int16Array(NC), pl: 0, pp: 0, tgt: -1, replan: 0, sendT: 0, digT: 0, tx: new Float32Array(64), ty: new Float32Array(64), tn: 0, th0: 0 }));

  // packets: a preallocated pool. kind 0 = delta, 1 = digest, 2 = repair; st 0 free, 1 flying, 2 falling (lost)
  const NP = 640;
  const P = Array.from({ length: NP }, () => ({ st: 0, kind: 0, src: 0, dst: 0, t0: 0, t1: 0, tl: 0, lost: false, n: 0, cells: new Int16Array(MAXC), hash: new Uint16Array(NB), block: 0, seq: 0, bytes: 0, fx: 0, fy: 0, fvx: 0, fvy: 0, ft: 0 }));
  const lastArr = new Float64Array(ND * ND), seqOut = new Int32Array(ND * ND), seqIn = new Int32Array(ND * ND).fill(-1);
  const repairFly = new Uint8Array(ND * ND * NB);
  const S = { T: 0, loss: .2, shuffled: true, cut: false, mission: 0, floor: 0, doneT: -1, lost: 0, ooo: 0, dup: 0, merged: 0, conflicts: 0, freeN: 0, bytes: new Float64Array(ND), win: new Float64Array(40), winT: 0 };

  // ---------------------------------------------------------------- the floor: rooms, doorways, a little debris
  function buildFloor() {
    wall.fill(0);
    const x1 = 9 + ((R() * 3) | 0), x2 = 20 + ((R() * 3) | 0);
    const door = (len) => 2 + ((R() * (len - 6)) | 0);
    const d1 = door(GH), d2 = door(GH);
    for (let y = 0; y < GH; y++) { if (y < d1 || y >= d1 + 3) wall[y * GW + x1] = 1; if (y < d2 || y >= d2 + 3) wall[y * GW + x2] = 1; }
    const hy = 7 + ((R() * 6) | 0), hd = x1 + 2 + ((R() * (x2 - x1 - 6)) | 0);
    for (let x = x1 + 1; x < x2; x++) if (x < hd || x >= hd + 3) wall[hy * GW + x] = 1;
    const hy2 = 6 + ((R() * 8) | 0), hd2 = x2 + 2 + ((R() * (GW - x2 - 6)) | 0);
    for (let x = x2 + 1; x < GW; x++) if (x < hd2 || x >= hd2 + 3) wall[hy2 * GW + x] = 1;
    for (let k = 0, tries = 0; k < 3 && tries < 60; tries++) {           // debris: 2 x 2 blocks clear of doors
      const bx = 1 + ((R() * (GW - 3)) | 0), by = 1 + ((R() * (GH - 3)) | 0); let ok = true;
      for (let y = by - 2; y <= by + 3 && ok; y++) for (let x = bx - 2; x <= bx + 3; x++) { if (x < 0 || y < 0 || x >= GW || y >= GH) continue; if (wall[y * GW + x]) { ok = false; break; } }
      if (!ok) continue; wall[by * GW + bx] = wall[by * GW + bx + 1] = wall[(by + 1) * GW + bx] = wall[(by + 1) * GW + bx + 1] = 1; k++;
    }
    // keep only what can be reached from the left room, so 100 % is possible
    const reach = new Uint8Array(NC), q = new Int32Array(NC); let qh = 0, qt = 0, s0 = -1;
    for (let c = 0; c < NC && s0 < 0; c++) if (!wall[c] && c % GW < x1) s0 = c;
    reach[s0] = 1; q[qt++] = s0;
    while (qh < qt) { const c = q[qh++], x = c % GW; for (const o of [-1, 1, -GW, GW]) { const j = c + o; if (j < 0 || j >= NC || reach[j] || wall[j]) continue; if ((o === -1 && x === 0) || (o === 1 && x === GW - 1)) continue; reach[j] = 1; q[qt++] = j; } }
    S.freeN = 0; for (let c = 0; c < NC; c++) { if (!reach[c]) wall[c] = 1; else S.freeN++; }
    return [x1, x2];
  }
  function newMission() {
    const [x1, x2] = buildFloor(); S.floor++;
    seen.fill(0); for (let d = 0; d < ND; d++) { know[d].fill(0); fresh[d].fill(-9); bh[d].fill(0); }
    cnt.fill(0); fp.fill(0); bufH.fill(0); bufT.fill(0); repairFly.fill(0); seqOut.fill(0); seqIn.fill(-1); lastArr.fill(0);
    for (const p of P) p.st = 0;
    const rooms = [[1, x1 - 1], [x1 + 1, x2 - 1], [x2 + 1, GW - 2]];
    dr.forEach((a, d) => {
      let c = -1; for (let t = 0; t < 400 && c < 0; t++) { const x = rooms[d][0] + ((R() * (rooms[d][1] - rooms[d][0] + 1)) | 0), y = 1 + ((R() * (GH - 2)) | 0), k = y * GW + x; if (!wall[k]) c = k; }
      if (c < 0) for (let k = 0; k < NC; k++) if (!wall[k]) { c = k; break; }
      a.x = c % GW + .5; a.y = ((c / GW) | 0) + .5; a.th = R() * 6.28; a.pl = a.pp = 0; a.tgt = -1; a.replan = 0; a.tn = 0; a.th0 = 0;
      a.sendT = S.T + d * .13; a.digT = S.T + 1 + d;
    });
    S.mission = 0; S.doneT = -1; S.lost = 0; S.ooo = 0; S.dup = 0; S.merged = 0;     // the counters are per floor
    for (let d = 0; d < ND; d++) sense(d);
  }

  // ---------------------------------------------------------------- the replicas
  function addCell(d, c, fromPeer) {
    if (know[d][c]) { if (fromPeer) S.dup++; return false; }            // idempotent: a repeat changes nothing
    know[d][c] = 1; cnt[d]++; fp[d] ^= H[c]; bh[d][blockOf[c]] ^= H[c];
    if (fromPeer) { fresh[d][c] = S.T; S.merged++; }
    else for (let p = 0; p < ND; p++) if (p !== d) { const L = d * ND + p; buf[L * NC + bufT[L]++] = c; }
    return true;
  }
  function sense(d) {
    const a = dr[d], r = Math.ceil(SR);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const gx = Math.floor(a.x) + dx, gy = Math.floor(a.y) + dy; if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
      const c = gy * GW + gx; if (wall[c]) continue;
      const cx = gx + .5 - a.x, cy = gy + .5 - a.y; if (cx * cx + cy * cy > SR * SR) continue;
      let blocked = false; const st = 6;                                // line of sight through the walls
      for (let s = 1; s < st && !blocked; s++) { const ix = Math.floor(a.x + cx * s / st), iy = Math.floor(a.y + cy * s / st); if (wall[iy * GW + ix]) blocked = true; }
      if (blocked) continue;
      seen[c] = 1; addCell(d, c, false);
    }
  }

  // ---------------------------------------------------------------- flying: toward the nearest cell this drone has not searched
  const bq = new Int32Array(NC), bpar = new Int32Array(NC), bvis = new Int32Array(NC); let bstamp = 0;
  function plan(d) {
    const a = dr[d], s0 = Math.floor(a.y) * GW + Math.floor(a.x); bstamp++;
    let qh = 0, qt = 0; bq[qt++] = s0; bvis[s0] = bstamp; bpar[s0] = -1; let goal = -1;
    const K = know[d];
    while (qh < qt) {
      const c = bq[qh++]; if (!K[c] && c !== s0) { goal = c; break; }
      const x = c % GW;
      for (const o of [1, -1, GW, -GW]) { const j = c + o; if (j < 0 || j >= NC || wall[j] || bvis[j] === bstamp) continue; if ((o === -1 && x === 0) || (o === 1 && x === GW - 1)) continue; bvis[j] = bstamp; bpar[j] = c; bq[qt++] = j; }
    }
    if (goal < 0) {                                                      // its own map is complete: patrol somewhere far
      if (a.pp < a.pl) return; goal = bq[(qt * (.5 + .5 * R())) | 0];
    }
    let n = 0; for (let c = goal; c !== -1 && n < NC; c = bpar[c]) a.path[n++] = c;
    for (let i = 0, j = n - 1; i < j; i++, j--) { const t = a.path[i]; a.path[i] = a.path[j]; a.path[j] = t; }
    a.pl = n; a.pp = n > 1 ? 1 : 0; a.tgt = goal;
  }
  function fly(d, dt) {
    const a = dr[d];
    a.replan -= dt;
    if (a.pp >= a.pl || a.replan <= 0 || (a.tgt >= 0 && know[d][a.tgt] && a.pp < a.pl)) { plan(d); a.replan = .5; }
    let move = SPEED * dt;
    while (move > 1e-6 && a.pp < a.pl) {
      const c = a.path[a.pp], tx = c % GW + .5, ty = ((c / GW) | 0) + .5, dx = tx - a.x, dy = ty - a.y, dd = Math.hypot(dx, dy);
      if (dd < 1e-4) { a.pp++; continue; }
      const s = Math.min(move, dd); a.x += dx / dd * s; a.y += dy / dd * s; move -= s;
      const want = Math.atan2(dy, dx); a.th += Math.atan2(Math.sin(want - a.th), Math.cos(want - a.th)) * Math.min(1, dt * 8);
      if (s >= dd - 1e-6) a.pp++;
    }
    sense(d);
    a.th0 += dt; if (a.th0 > .12) { a.th0 = 0; const k = a.tn % 64; a.tx[k] = a.x; a.ty[k] = a.y; a.tn++; }
  }

  // ---------------------------------------------------------------- the radio
  const linkUp = (a, b) => !(S.cut && (a === 2 || b === 2));
  const clampV = (v) => Math.max(-4, Math.min(4, v));
  function packet(kind, src, dst) {
    let p = null; for (let i = 0; i < NP; i++) if (P[i].st === 0) { p = P[i]; break; }
    if (!p) return null;
    const L = src * ND + dst;
    p.st = 1; p.kind = kind; p.src = src; p.dst = dst; p.t0 = S.T; p.n = 0; p.seq = seqOut[L]++;
    if (S.shuffled) p.t1 = S.T + .3 + 1.5 * Math.pow(R(), 1.6) + (R() < .12 ? .8 + R() : 0);
    else p.t1 = Math.max(S.T + .55 + .15 * R(), lastArr[L] + .05);
    lastArr[L] = Math.max(lastArr[L], p.t1);
    p.lost = R() < S.loss; p.tl = p.t0 + (p.t1 - p.t0) * (.25 + .5 * R());
    p.fx = dr[src].x; p.fy = dr[src].y; p.fvx = 0; p.fvy = 0;
    return p;
  }
  function sendBytes(p) {
    p.bytes = HEADER + (p.kind === 1 ? 2 * NB : PER_CELL * p.n);
    S.bytes[p.src] += p.bytes; S.win[S.winT % S.win.length] += p.bytes;
  }
  function sendDeltas(d) {
    for (let q = 0; q < ND; q++) {
      if (q === d || !linkUp(d, q)) continue;
      const L = d * ND + q;
      for (let k = 0; k < 3 && bufH[L] < bufT[L]; k++) {                 // a backlog (after a cut) goes out over a few ticks
        const p = packet(0, d, q); if (!p) return;
        while (p.n < MAXC && bufH[L] < bufT[L]) p.cells[p.n++] = buf[L * NC + bufH[L]++];
        sendBytes(p);
      }
    }
  }
  function sendDigest(d) {
    for (let q = 0; q < ND; q++) { if (q === d || !linkUp(d, q)) continue; const p = packet(1, d, q); if (!p) return; p.hash.set(bh[d]); sendBytes(p); }
  }
  const hurry = (d) => { const a = dr[d]; if (a.digT > S.T + HURRY) a.digT = S.T + HURRY; };
  function deliver(p) {
    const L = p.src * ND + p.dst;
    if (p.seq < seqIn[L]) S.ooo++; else seqIn[L] = p.seq;
    if (p.kind === 1) {                                                  // digest: answer every block that differs
      for (let b = 0; b < NB; b++) {
        if (p.hash[b] === bh[p.dst][b]) continue;
        hurry(p.dst);                                                    // we disagree: compare again soon, not in 3 s
        if (repairFly[(p.dst * ND + p.src) * NB + b]) continue;
        const r = packet(2, p.dst, p.src); if (!r) break;
        r.block = b; const K = know[p.dst];
        for (let c = 0; c < NC; c++) if (blockOf[c] === b && K[c]) r.cells[r.n++] = c;
        repairFly[(p.dst * ND + p.src) * NB + b] = 1; sendBytes(r);
      }
      return;
    }
    if (p.kind === 2) repairFly[L * NB + p.block] = 0;
    let added = 0; for (let i = 0; i < p.n; i++) if (addCell(p.dst, p.cells[i], true)) added++;   // merge = union
    if (p.kind === 2 && added) hurry(p.dst);
  }
  function radio(dt) {
    for (const p of P) {
      if (p.st === 1) {
        const A = dr[p.src], B = dr[p.dst], f = Math.min(1, Math.max(0, (S.T - p.t0) / (p.t1 - p.t0)));   // where it is now
        const nx = A.x + (B.x - A.x) * f, ny = A.y + (B.y - A.y) * f; p.fvx = (nx - p.fx) / (dt || 1); p.fvy = (ny - p.fy) / (dt || 1); p.fx = nx; p.fy = ny;
        if (!linkUp(p.src, p.dst)) { p.lost = true; p.tl = S.T; }
        if (p.lost && S.T >= p.tl) { p.st = 2; p.ft = 0; S.lost++; p.fvx = clampV(p.fvx); p.fvy = clampV(p.fvy) - 1.2; if (p.kind === 2) repairFly[(p.src * ND + p.dst) * NB + p.block] = 0; continue; }
        if (S.T >= p.t1) { deliver(p); p.st = 0; }                     // free it only after delivery (a digest allocates repairs)
      } else if (p.st === 2) { p.ft += dt; p.fx += p.fvx * dt; p.fy += p.fvy * dt; p.fvy += 9 * dt; p.fvx *= .97; if (p.ft > 1) p.st = 0; }
    }
    for (let d = 0; d < ND; d++) {
      const a = dr[d];
      if (S.T >= a.sendT) { a.sendT += SEND; sendDeltas(d); }
      if (S.T >= a.digT) { a.digT += DIGEST; sendDigest(d); }
    }
  }

  // ---------------------------------------------------------------- one step
  let lastWin = 0;
  function identical() { for (let c = 0; c < NC; c++) if (know[0][c] !== know[1][c] || know[0][c] !== know[2][c]) return false; return true; }
  function step(dt) {
    S.T += dt; S.mission += dt;
    const wk = Math.floor(S.T / .25); while (lastWin < wk) { lastWin++; S.winT = lastWin; S.win[lastWin % S.win.length] = 0; }
    for (let d = 0; d < ND; d++) fly(d, dt);
    radio(dt);
    const all = cnt[0] === S.freeN && cnt[1] === S.freeN && cnt[2] === S.freeN;
    if (all && S.doneT < 0) S.doneT = S.T;
    if ((S.doneT >= 0 && S.T - S.doneT > 6) || S.mission > 240) newMission();
  }
  function setCut(v) {
    S.cut = v;
    if (!v) for (const a of dr) a.digT = Math.min(a.digT, S.T + .1 + R() * .3);   // on reconnecting, peers compare digests
  }
  // bytes per second per drone, over the last 10 s
  function rate() { let s = 0; for (let i = 0; i < S.win.length; i++) s += S.win[i]; return s / Math.max(1, Math.min(S.T, S.win.length * .25)) / ND; }
  const union = new Uint8Array(NC);
  function lag(d) { let u = 0; for (let c = 0; c < NC; c++) { union[c] = know[0][c] | know[1][c] | know[2][c]; u += union[c]; } return u - cnt[d]; }

  newMission();
  return { GW, GH, NC, ND, NB, BW, BH, SR, wall, seen, know, fresh, cnt, fp, dr, P, S, step, setCut, identical, rate, lag, newMission, linkUp };
}

// ------------------------------------------------------------------ the simulation page
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const TAU = Math.PI * 2;
  const E = crdtEngine({ seed: 14 }), { GW, GH, NC, ND, S } = E;        // seed 14: the drones fan out early
  const COL = [C.teal, C.apricot, '#B4B1E0'], RGB = [[127, 212, 207], [246, 210, 177], [180, 177, 224]], NAME = ['A', 'B', 'C'];

  // ---------------------------------------------------------------- controls and readouts
  kit.slider(controls, { label: 'Packets lost', min: 0, max: 70, step: 1, value: 20, fmt: (v) => v + ' %', onInput: (v) => { S.loss = v / 100; } });
  kit.toggle(controls, { label: 'Delivery', options: [{ v: 0, label: 'In order' }, { v: 1, label: 'Shuffled' }], value: 1, onChange: (v) => { S.shuffled = !!v; } });
  const bCut = kit.button(controls, { label: 'Cut the link', onClick: () => { E.setCut(!S.cut); bCut.textContent = S.cut ? 'Restore the link' : 'Cut the link'; cutT = S.T; } });
  kit.hint(controls, 'Each drone keeps its own copy of the searched cells. Lose, delay or shuffle the packets: the copies still end up identical.');
  const rSame = kit.readout(readouts, { label: 'Maps identical', tone: 'teal' });
  const rData = kit.readout(readouts, { label: 'Data per drone', tone: 'ink' });
  const rConf = kit.readout(readouts, { label: 'Merge conflicts', tone: 'heat' });
  let cutT = -99, sameTone = 'teal';

  // ---------------------------------------------------------------- offscreen cell images (main floor + three replicas)
  const mk = () => { const c = document.createElement('canvas'); c.width = GW; c.height = GH; const x = c.getContext('2d'); return { c, x, img: x.createImageData(GW, GH) }; };
  const floorI = mk(), miniI = [mk(), mk(), mk()];
  function paintFloor() {
    const px = floorI.img.data;
    for (let c = 0; c < NC; c++) {
      const o = c * 4; let r, g, b;
      if (E.wall[c]) { r = 92; g = 90; b = 146; } else if (E.seen[c]) { r = 44; g = 78; b = 98; } else { r = 37; g = 40; b = 78; }
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
    floorI.x.putImageData(floorI.img, 0, 0);
  }
  function paintMini(d) {
    const px = miniI[d].img.data, K = E.know[d], Fr = E.fresh[d];
    for (let c = 0; c < NC; c++) {
      const o = c * 4; let r, g, b;
      if (E.wall[c]) { r = 78; g = 77; b = 128; }
      else if (K[c]) { const f = clamp(1 - (S.T - Fr[c]) / .7, 0, 1); r = 62 + f * 158; g = 128 + f * 100; b = 136 + f * 102; }
      else { r = 33; g = 36; b = 70; }
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
    miniI[d].x.putImageData(miniI[d].img, 0, 0);
  }

  // ---------------------------------------------------------------- layout
  let G = null;
  function layout() {
    const w = cv.w, h = cv.h, phone = w < 640;
    if (phone) {
      const cs = (w - 32) / GW, mw = cs * GW, mh = cs * GH, gap = 8, mwid = (w - 32 - 2 * gap) / 3, mcs = mwid / GW;
      const my = 16, miniY = my + mh + 28;
      G = { phone, cs, mx: 16, my, mw, mh, mcs, minis: [0, 1, 2].map((d) => ({ x: 16 + d * (mwid + gap), y: miniY, w: mwid, h: mcs * GH })), capY: miniY + mcs * GH + 34 };
    } else {
      const side = clamp(w * .24, 170, 232), aw = w - 44 - side - 28, ah = h - 40 - 46;
      const cs = Math.min(aw / GW, ah / GH), mw = cs * GW, mh = cs * GH, mx = 22, my = Math.max(20, (h - mh - 46) / 2);
      const head = 18, foot = 22, gap = Math.max(10, Math.min(22, h * .03));
      const mcs = Math.min(side / GW, (h - 40 - 3 * (head + foot) - 2 * gap) / (3 * GH)), mwid = mcs * GW, mhgt = mcs * GH;
      const total = 3 * (head + mhgt + foot) + 2 * gap, y0 = (h - total) / 2, sx = w - 22 - side + (side - mwid) / 2;
      G = { phone, cs, mx, my, mw, mh, mcs, minis: [0, 1, 2].map((d) => ({ x: sx, y: y0 + head + d * (head + mhgt + foot + gap), w: mwid, h: mhgt })), capY: my + mh + 24 };
    }
  }
  cv.onResize(layout); layout();

  // ---------------------------------------------------------------- drawing
  const rgba = (d, a) => `rgba(${RGB[d][0]},${RGB[d][1]},${RGB[d][2]},${a})`;
  function fit(str, x, y, maxW, size, color, shorter) {                 // shrink a little, else fall back to a shorter line
    let sz = size; ctx.font = `400 ${sz}px ${F.sans}`;
    while (ctx.measureText(str).width > maxW && sz > size - 1.5) { sz -= .5; ctx.font = `400 ${sz}px ${F.sans}`; }
    if (ctx.measureText(str).width > maxW && shorter) { str = shorter; sz = size; }
    else if (ctx.measureText(str).width > maxW) { const words = str.split(' '); let a = ''; for (const w of words) { if (ctx.measureText(a + w + ' …').width > maxW) break; a += w + ' '; } str = a.trim().replace(/[,:]$/, '') + ' …'; }
    text(ctx, str, x, y, { size: sz, color });
  }
  function draw() {
    const { cs, mx, my, mw, mh, phone } = G; cv.clear();
    const X = (x) => mx + x * cs, Y = (y) => my + y * cs;
    paintFloor();
    ctx.save(); roundRect(ctx, mx, my, mw, mh, 8); ctx.clip();
    ctx.imageSmoothingEnabled = false; ctx.drawImage(floorI.c, mx, my, mw, mh); ctx.imageSmoothingEnabled = true;
    if (cs >= 9) {
      ctx.strokeStyle = 'rgba(27,30,61,.45)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 1; x < GW; x++) { ctx.moveTo(X(x) + .5, my); ctx.lineTo(X(x) + .5, my + mh); }
      for (let y = 1; y < GH; y++) { ctx.moveTo(mx, Y(y) + .5); ctx.lineTo(mx + mw, Y(y) + .5); }
      ctx.stroke();
    }
    // sensing discs and trails
    for (let d = 0; d < ND; d++) {
      const a = E.dr[d];
      ctx.fillStyle = rgba(d, .1); ctx.beginPath(); ctx.arc(X(a.x), Y(a.y), E.SR * cs, 0, TAU); ctx.fill();
      const n = Math.min(a.tn, 44); if (n > 1) {
        ctx.strokeStyle = rgba(d, .26); ctx.lineWidth = phone ? 1.1 : 1.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
        for (let i = 0; i < n; i++) { const k = (a.tn - n + i) % 64; i ? ctx.lineTo(X(a.tx[k]), Y(a.ty[k])) : ctx.moveTo(X(a.tx[k]), Y(a.ty[k])); }
        ctx.lineTo(X(a.x), Y(a.y)); ctx.stroke();
      }
    }
    ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; roundRect(ctx, mx - .5, my - .5, mw + 1, mh + 1, 8); ctx.stroke();
    if (!phone && my > 44) {
      text(ctx, 'The floor: what was really searched', mx, my - 10, { size: 11.5, color: C.muted });
      let sn = 0; for (let c = 0; c < NC; c++) sn += E.seen[c];
      text(ctx, `floor ${S.floor} · ${Math.round(100 * sn / S.freeN)}% searched`, mx + mw, my - 10, { size: 11, color: C.faint, align: 'right', font: F.mono });
    }
    // radio links
    for (let a = 0; a < ND; a++) for (let b = a + 1; b < ND; b++) {
      const up = E.linkUp(a, b), A = E.dr[a], B = E.dr[b];
      ctx.strokeStyle = up ? 'rgba(220,214,236,.24)' : 'rgba(239,177,180,.35)'; ctx.lineWidth = 1.1; ctx.setLineDash(up ? [] : [4, 5]);
      ctx.beginPath(); ctx.moveTo(X(A.x), Y(A.y)); ctx.lineTo(X(B.x), Y(B.y)); ctx.stroke(); ctx.setLineDash([]);
      if (!up && !phone) { const lx = (X(A.x) + X(B.x)) / 2, ly = (Y(A.y) + Y(B.y)) / 2; text(ctx, 'cut', lx, ly - 6, { size: 10.5, color: C.rose, align: 'center' }); }
    }
    // packets in flight (sender's colour), digests as rings, lost ones fall away in rose
    const pr = phone ? .8 : 1;
    ctx.save(); ctx.beginPath(); ctx.rect(mx - 6, my - 6, mw + 12, mh + 12); ctx.clip();          // lost packets fall, but stay on the floor
    let dig = null, lost = null;                                         // the newest digest and lost packet get a label
    for (const p of E.P) {
      if (p.st === 0) continue;
      if (p.st === 1 && p.kind === 1 && (!dig || p.t0 > dig.t0)) dig = p;
      if (p.st === 2 && p.ft < .7 && (!lost || p.ft < lost.ft)) lost = p;
      const A = E.dr[p.src], B = E.dr[p.dst];
      if (p.st === 1) {
        const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, off = (p.src < p.dst ? 3 : -3) * pr;
        const x = X(p.fx) - dy / L * off, y = Y(p.fy) + dx / L * off;
        if (p.kind === 1) { ctx.strokeStyle = COL[p.src]; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(x, y, 3.4 * pr, 0, TAU); ctx.stroke(); }
        else { ctx.fillStyle = COL[p.src]; ctx.beginPath(); ctx.arc(x, y, (p.kind === 2 ? 3 : 2.1 + Math.min(1.2, p.n * .06)) * pr, 0, TAU); ctx.fill(); }
      } else {
        const x = X(p.fx), y = Y(p.fy);
        ctx.globalAlpha = clamp(1 - p.ft, 0, 1);
        if (p.kind === 1) { ctx.strokeStyle = C.rose; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 3.2 * pr, 0, TAU); ctx.stroke(); }
        else { ctx.fillStyle = C.rose; ctx.beginPath(); ctx.arc(x, y, 2.4 * pr, 0, TAU); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    if (!phone) {
      const tag = (str, x, y, col) => { ctx.font = `400 10.5px ${F.sans}`; const tw = ctx.measureText(str).width; ctx.fillStyle = 'rgba(27,30,61,.8)'; roundRect(ctx, x - 4, y - 8, tw + 8, 15, 5); ctx.fill(); text(ctx, str, x, y, { size: 10.5, color: col, base: 'middle' }); };
      if (dig) tag('digest', X(dig.fx) + 8, Y(dig.fy) - 11, C.muted);
      if (lost && Y(lost.fy) < my + mh - 8) { ctx.globalAlpha = clamp(1.4 - lost.ft * 1.6, 0, 1); tag('lost', X(lost.fx) + 8, Y(lost.fy) + 4, C.rose); ctx.globalAlpha = 1; }
    }
    // drones: a ring with a letter
    const rr = phone ? 7.5 : 10;
    for (let d = 0; d < ND; d++) {
      const a = E.dr[d], x = X(a.x), y = Y(a.y);
      ctx.fillStyle = 'rgba(27,30,61,.85)'; ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
      ctx.strokeStyle = COL[d]; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a.th) * rr, y + Math.sin(a.th) * rr); ctx.lineTo(x + Math.cos(a.th) * (rr + 4), y + Math.sin(a.th) * (rr + 4)); ctx.stroke();
      text(ctx, NAME[d], x, y + .5, { size: phone ? 9.5 : 11, color: COL[d], weight: 600, align: 'center', base: 'middle' });
    }
    // the three replicas
    const same = E.identical();
    for (let d = 0; d < ND; d++) {
      const M = G.minis[d]; paintMini(d);
      ctx.imageSmoothingEnabled = false; ctx.drawImage(miniI[d].c, M.x, M.y, M.w, M.h); ctx.imageSmoothingEnabled = true;
      ctx.strokeStyle = d === 2 && S.cut ? 'rgba(239,177,180,.55)' : C.line; ctx.lineWidth = 1; ctx.strokeRect(M.x - .5, M.y - .5, M.w + 1, M.h + 1);
      const a = E.dr[d]; ctx.fillStyle = COL[d]; ctx.beginPath(); ctx.arc(M.x + a.x * G.mcs, M.y + a.y * G.mcs, phone ? 2 : 2.6, 0, TAU); ctx.fill();
      const fs = phone ? 10 : 11, lag = E.lag(d);
      text(ctx, phone ? NAME[d] + "'s map" : `${NAME[d]}'s own map`, M.x, M.y - 6, { size: fs, color: COL[d], weight: 500 });
      text(ctx, lag ? (phone ? '−' + lag : `missing ${lag}`) : (phone ? '✓' : 'up to date'), M.x + M.w, M.y - 6, { size: phone ? 9.5 : 10.5, color: lag ? C.rose : C.teal, align: 'right', font: lag ? F.mono : F.sans });
      const hex = E.fp[d].toString(16).toUpperCase().padStart(4, '0'), fy = M.y + M.h + (phone ? 14 : 16), fsz = phone ? 11 : 12.5;
      if (same) {                                                        // matching fingerprints glow
        ctx.font = `500 ${fsz}px ${F.mono}`; const tw = ctx.measureText(hex).width;
        ctx.fillStyle = 'rgba(127,212,207,.16)'; roundRect(ctx, M.x - 5, fy - fsz - 1, tw + 10, fsz + 7, 6); ctx.fill();
        ctx.save(); ctx.shadowColor = 'rgba(127,212,207,.9)'; ctx.shadowBlur = 10;
      }
      text(ctx, hex, M.x, fy, { size: fsz, color: same ? C.teal : C.ink, font: F.mono, weight: 500 });
      if (same) ctx.restore();
      text(ctx, phone ? String(E.cnt[d]) : E.cnt[d] + ' cells', M.x + M.w, M.y + M.h + (phone ? 14 : 16), { size: phone ? 10 : 11, color: C.muted, font: F.mono, align: 'right' });
    }
    // captions: what is happening, and the evidence (all counted from the simulation)
    let msg;
    if (S.doneT >= 0 && same) msg = 'Floor searched. All three maps identical, whatever order the packets came in.';
    else if (S.cut) msg = 'C is cut off: it keeps searching on its own, and its map drifts apart.';
    else if (S.T - cutT < 6 && cutT > 0) msg = 'Link restored: the missing cells flow back. Nothing to resolve, only to add.';
    else if (same) msg = 'Maps identical right now: every searched cell is in all three copies.';
    else msg = 'Each drone sends what it searched. Merge is a union, so order and repeats do not matter.';
    const stats = `${S.lost} lost · ${S.ooo} out of order · ${S.dup} repeats ignored`;
    if (phone) {
      text(ctx, stats, 16, G.capY, { size: 10.5, color: C.faint });
      const short = S.doneT >= 0 && same ? 'Floor searched: all three maps identical.' : S.cut ? 'C is cut off: its map drifts apart.' : (S.T - cutT < 6 && cutT > 0) ? 'Link restored: the missing cells flow back.' : same ? 'Maps identical right now.' : 'Merge is a union: order and repeats do not matter.';
      if (G.capY + 18 < cv.h - 14) text(ctx, short, 16, G.capY + 18, { size: 11, color: C.muted });
    } else {
      const maxW = G.minis[0].x - mx - 20;
      fit(msg, mx, G.capY, maxW, 12.5, C.ink);
      fit(stats + ' · merge = union: A ∪ B = B ∪ A, A ∪ A = A', mx, G.capY + 18, maxW, 11, C.faint, stats);
    }
    return same;
  }

  // ---------------------------------------------------------------- loop
  const loop = kit.loop((dt) => {
    const n = dt > .03 ? 2 : 1; for (let i = 0; i < n; i++) E.step(dt / n);
    const same = draw();
    rSame.set(same ? 'yes' : 'no'); const t = same ? 'teal' : 'rose'; if (t !== sameTone) rSame.tone(sameTone = t);
    rData.set((E.rate() / 1000).toFixed(2) + ' kB/s');
    rConf.set(String(S.conflicts));
  });
  draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

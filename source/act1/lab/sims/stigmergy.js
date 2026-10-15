// Notes left in the building: stigmergy (Grassé 1959; ants; for LIMINAL, UV ink or RFID tags written by the swarm).
// Two copies of the same office floor, the same agents, the same speed, the same start. Left: each agent does a
// correlated random walk and avoids walls. Right: each agent also paints a mark (UV ink) on every cell it has searched
// and steers by the paint it can see: toward the least-marked floor nearby, away from "somebody already looked here"
// (negative stigmergy). Marks fade with a half-life. Nothing is transmitted: the only shared memory is the floor
// itself, so jamming the radio changes nothing.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  cv.cv.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------ the floor plan: corridor + 6-7 rooms with doorways
  const GW = 60, GH = 40, NC = GW * GH, CY0 = 18, CY1 = 21;            // corridor rows 18..21
  const wall = new Uint8Array(NC), reach = new Uint8Array(NC), q = new Int32Array(NC);
  let reachN = 1, entY = 19, roundSeed = 20067;
  function plan(seed) {
    const r = kit.rng(seed), ri = (a, b) => a + Math.floor(r() * (b - a + 1));
    wall.fill(0);
    const box = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) wall[y * GW + x] = 1; };
    const hole = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) wall[y * GW + x] = 0; };
    box(0, 0, GW - 1, 0); box(0, GH - 1, GW - 1, GH - 1); box(0, 0, 0, GH - 1); box(GW - 1, 0, GW - 1, GH - 1);
    box(1, CY0 - 1, GW - 2, CY0 - 1); box(1, CY1 + 1, GW - 2, CY1 + 1);    // corridor walls
    entY = CY0 + 1; hole(0, CY0, 0, CY1);                                  // the entrance: open end of the corridor
    // rooms: 3 above, 3 or 4 below, each with a doorway onto the corridor, some with a door to the next room
    for (const [y0, y1, dy, n] of [[1, CY0 - 2, CY0 - 1, 3], [CY1 + 2, GH - 2, CY1 + 1, r() < .5 ? 3 : 4]]) {
      const cuts = [0]; for (let k = 1; k < n; k++) cuts.push(Math.round(k * GW / n + (r() - .5) * 8));
      cuts.push(GW - 1);
      for (let k = 1; k < n; k++) box(cuts[k], y0, cuts[k], y1);
      for (let k = 0; k < n; k++) {
        const a = cuts[k] + 1, b = cuts[k + 1] - 1, dx = ri(a + 2, b - 4);
        hole(dx, dy, dx + 2, dy);                                          // doorway onto the corridor
        if (k > 0 && r() < .45) { const yy = ri(y0 + 2, y1 - 4); hole(cuts[k], yy, cuts[k], yy + 2); }
        // a desk or two, clear of the walls so nothing gets sealed off
        const nd = ri(1, 2);
        for (let t = 0, made = 0; t < 20 && made < nd; t++) {
          const w = ri(2, 4), h = ri(2, 3), x0 = ri(a + 2, Math.max(a + 2, b - 1 - w)), yy0 = ri(y0 + 2, Math.max(y0 + 2, y1 - 1 - h));
          if (x0 + w > b - 1 || yy0 + h > y1 - 1) continue;
          let clear = true;
          for (let y = yy0 - 2; y <= yy0 + h + 1 && clear; y++) for (let x = x0 - 2; x <= x0 + w + 1; x++) { if (wall[y * GW + x] && !(x < a || x > b || y < y0 || y > y1)) { clear = false; break; } }
          if (Math.abs((y0 > CY1 ? y0 : y1) - (y0 > CY1 ? yy0 : yy0 + h - 1)) < 3 && x0 < dx + 5 && x0 + w > dx - 2) clear = false;   // keep the doorway free
          if (!clear) continue;
          box(x0, yy0, x0 + w - 1, yy0 + h - 1); made++;
        }
      }
    }
    // every free cell the agents can actually reach counts toward coverage; anything sealed off becomes wall
    reach.fill(0); let qh = 0, qt = 0; const s0 = entY * GW + 1; reach[s0] = 1; q[qt++] = s0;
    while (qh < qt) {
      const i = q[qh++], x = i % GW, y = (i / GW) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d * 2], ny = y + DY[d * 2]; if (nx < 1 || ny < 0 || nx >= GW || ny >= GH) continue;
        const j = ny * GW + nx; if (wall[j] || reach[j]) continue; reach[j] = 1; q[qt++] = j;
      }
    }
    for (let i = 0; i < NC; i++) if (!reach[i] && !wall[i] && i % GW !== 0) wall[i] = 1;
    reachN = qt;
  }
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  const free = (x, y) => x >= 1 && y >= 0 && x < GW && y < GH && !wall[y * GW + x];
  function canStep(x, y, d) {
    const nx = x + DX[d], ny = y + DY[d];
    if (!free(nx, ny)) return false;
    return !(DX[d] && DY[d]) || (free(nx, y) && free(x, ny));            // no cutting corners
  }

  // ------------------------------------------------------------ agents
  // Both sides: same speed, same 3x3 view (a cell counts as searched once it has been in view), same take-off.
  const MAXA = 12, SPEED = 11, LAUNCH = .35;                              // cells per second; seconds between take-offs
  let nAg = 6, halfLife = 45, jammed = 0;
  function side(reading, seedOff) {
    return { reading, seedOff, cov: new Uint8Array(NC), mark: new Float32Array(NC), covN: 0,
      x: new Int16Array(MAXA), y: new Int16Array(MAXA), tx: new Int16Array(MAXA), ty: new Int16Array(MAXA),
      prog: new Float32Array(MAXA), len: new Float32Array(MAXA), dir: new Int8Array(MAXA), rng: Math.random,
      hist: new Float32Array(141), histN: 0, floor: null };
  }
  const L = side(false, 101), Rt = side(true, 202), SIDES = [L, Rt];
  const offscreen = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'), img = x.createImageData(w, h); return { c, x, img, px: new Uint32Array(img.data.buffer) }; };
  for (const S of SIDES) S.floor = offscreen(GW * 4, GH * 4);
  const paintLayer = offscreen(GW, GH), wallLayer = offscreen(GW * 4, GH * 4);
  // search the 3x3 cells around (x, y); on the right, also paint them (fresh paint = 1, it then fades with the half-life)
  function look(S, x, y) {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const j = (y + oy) * GW + x + ox; if (!reach[j]) continue;
      if (!S.cov[j]) { S.cov[j] = 1; S.covN++; }
      if (S.reading) S.mark[j] = 1;
    }
  }
  const turn = (a, b) => { const t = Math.abs(a - b) & 7; return t > 4 ? 8 - t : t; };
  // Left, ignoring marks: a correlated random walk. Keep the heading mostly, turn a little sometimes; walls block.
  const TW = [3, .32, .07, .015, .004], SC = new Float32Array(8);
  function walk(S, x, y, h) {
    let tot = 0, best = -1;
    for (let d = 0; d < 8; d++) { SC[d] = canStep(x, y, d) ? TW[turn(d, h)] : 0; tot += SC[d]; }
    let u = S.rng() * tot; for (let d = 0; d < 8; d++) { if (SC[d] <= 0) continue; best = d; u -= SC[d]; if (u <= 0) break; }
    return best;
  }
  // Right, reading marks: look at the floor within VIS steps (walls block the view). Head for the spot where the next
  // look would take in the most unpainted cells, nearer spots first. If everything in view is painted, head for the
  // faintest paint (searched longest ago). Paint below UNM has faded too far to read.
  const VIS = 12, UNM = .25, GAIN = .8, FAINTD = .01;
  const bq = new Int32Array(NC), bdist = new Int8Array(NC), bfirst = new Int8Array(NC), bstamp = new Int32Array(NC);
  let stampN = 0;
  function read(S, x, y, h) {
    stampN++; let qh = 0, qt = 0;
    bstamp[y * GW + x] = stampN;
    for (let t = 0; t < 8; t++) {                                       // straight ahead first, so ties go straight
      const d = (h + (t & 1 ? (t + 1) >> 1 : -(t >> 1)) + 8) & 7;
      if (!canStep(x, y, d)) continue;
      const j = (y + DY[d]) * GW + x + DX[d]; if (bstamp[j] === stampN) continue;
      bstamp[j] = stampN; bdist[j] = 1; bfirst[j] = d; bq[qt++] = j;
    }
    let best = -1, bsc = -Infinity, faint = -1, fsc = Infinity;
    while (qh < qt) {
      const c = bq[qh++], cx = c % GW, cy = (c / GW) | 0;
      let g = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const j = c + oy * GW + ox; if (reach[j] && S.mark[j] < UNM) g++; }
      if (g > 0) { const sc = g - GAIN * bdist[c]; if (sc > bsc) { bsc = sc; best = bfirst[c]; } }
      const f = S.mark[c] + FAINTD * bdist[c]; if (f < fsc) { fsc = f; faint = bfirst[c]; }
      if (bdist[c] >= VIS) continue;
      for (let d = 0; d < 8; d++) {
        if (!canStep(cx, cy, d)) continue;
        const j = (cy + DY[d]) * GW + cx + DX[d]; if (bstamp[j] === stampN) continue;
        bstamp[j] = stampN; bdist[j] = bdist[c] + 1; bfirst[j] = bfirst[c]; bq[qt++] = j;
      }
    }
    return best >= 0 ? best : faint;
  }
  function choose(S, k) {
    const x = S.x[k], y = S.y[k], h = S.dir[k];
    let best = S.reading ? read(S, x, y, h) : walk(S, x, y, h);
    if (best < 0) best = (h + 4) & 7;
    S.dir[k] = best; S.tx[k] = x + DX[best]; S.ty[k] = y + DY[best]; S.len[k] = (DX[best] && DY[best]) ? Math.SQRT2 : 1; S.prog[k] = 0;
    if (!free(S.tx[k], S.ty[k])) { S.tx[k] = x; S.ty[k] = y; S.len[k] = 1; }
  }
  function resetSide(S) {
    S.cov.fill(0); S.mark.fill(0); S.covN = 0; S.histN = 0; S.rng = kit.rng(roundSeed * 977 + S.seedOff);
    for (let k = 0; k < MAXA; k++) { S.x[k] = S.tx[k] = 1; S.y[k] = S.ty[k] = entY + (k % 2); S.prog[k] = 1; S.len[k] = 1; S.dir[k] = 0; }
  }
  function advance(S, dt, T) {
    for (let k = 0; k < nAg; k++) {
      if (T < k * LAUNCH) continue;                                      // they take off one after another
      let move = SPEED * dt;
      for (let guard = 0; move > 0 && guard < 8; guard++) {
        const rem = (1 - S.prog[k]) * S.len[k];
        if (move < rem) { S.prog[k] += move / S.len[k]; move = 0; break; }
        move -= rem; S.x[k] = S.tx[k]; S.y[k] = S.ty[k];
        look(S, S.x[k], S.y[k]); choose(S, k);
      }
    }
  }

  // ------------------------------------------------------------ rounds
  const LIMIT = 70, DONE = .99, history = [];
  let T = 0, state = 'run', holdT = 0, roundNo = 0;
  function newRound(fresh) {
    if (fresh) roundSeed = (roundSeed * 1103 + 12345) % 100003 + 1;
    plan(roundSeed); paintWalls(); T = 0; state = 'run'; holdT = 0; roundNo++;
    for (const S of SIDES) resetSide(S);
  }
  function stepSim(dt) {
    if (state === 'hold') { holdT += dt; if (holdT > 3.2) newRound(true); return; }
    T += dt;
    const dec = Math.pow(2, -dt / halfLife), m = Rt.mark;                 // marks fade with a half-life
    for (let i = 0; i < NC; i++) if (m[i] > 0) { m[i] *= dec; if (m[i] < .02) m[i] = 0; }
    advance(L, dt, T); advance(Rt, dt, T);
    for (const S of SIDES) { const n = Math.min(140, Math.floor(T / .5)); while (S.histN <= n) S.hist[S.histN++] = S.covN / reachN; }
    const fr = Rt.covN / reachN;
    if (fr >= DONE || T >= LIMIT) {
      history.unshift({ n: roundNo, done: fr >= DONE, t: T, right: fr, left: L.covN / reachN });
      if (history.length > 3) history.pop();
      state = 'hold'; holdT = 0;
    }
  }

  // ------------------------------------------------------------ controls and readouts
  kit.toggle(controls, { label: 'Radio', options: [{ v: 0, label: 'On' }, { v: 1, label: 'Jammed' }], value: 0, onChange: (v) => { jammed = v; } });
  kit.slider(controls, { label: 'Marks fade after', min: 10, max: 120, step: 5, value: halfLife, fmt: (v) => v + ' s', onInput: (v) => { halfLife = v; } });
  kit.slider(controls, { label: 'Agents', min: 3, max: 12, step: 1, value: nAg, onInput: (v) => { if (v !== nAg) { nAg = v; newRound(false); } } });
  kit.button(controls, { label: 'Restart', onClick: () => newRound(true) });
  kit.hint(controls, 'Marks fade after: the half-life of the paint. Both sides restart together when the right one is done.');
  const rL = kit.readout(readouts, { label: 'Covered, ignoring marks', tone: 'rose' });
  const rR = kit.readout(readouts, { label: 'Covered, reading marks', tone: 'teal' });
  const rM = kit.readout(readouts, { label: 'Radio messages', tone: 'heat' });

  // ------------------------------------------------------------ colours (packed ABGR for the pixel buffers)
  const pack = (c, a = 255) => ((a << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const cWall = [143, 140, 196], cDusk = [74, 75, 134], cCov = mix(cDusk, [127, 212, 207], .78), cUV = [204, 116, 255];
  const P_WALL = pack(cWall), P_WEDGE = pack(mix(cWall, [27, 30, 61], .22)), P_DUSK = pack(cDusk), P_TILE = pack(mix(cDusk, [27, 30, 61], .18));
  const P_COV = pack(cCov), P_CTILE = pack(mix(cCov, cDusk, .1)), P_UV = new Uint32Array(16);
  for (let i = 0; i < 16; i++) P_UV[i] = pack(cUV, Math.round(150 * i / 15));
  // the floor: each cell 4x4 pixels with a faint tile edge; dusk = not searched yet, teal = searched
  function paintFloor(S) {
    const px = S.floor.px, W4 = GW * 4;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const i = y * GW + x, body = S.cov[i] ? P_COV : P_DUSK, rim = S.cov[i] ? P_CTILE : P_TILE, o = y * 4 * W4 + x * 4;
      for (let sy = 0; sy < 3; sy++) { const r = o + sy * W4; px[r] = px[r + 1] = px[r + 2] = body; px[r + 3] = rim; }
      const r = o + 3 * W4; px[r] = px[r + 1] = px[r + 2] = px[r + 3] = rim;
    }
    S.floor.x.putImageData(S.floor.img, 0, 0);
  }
  // the UV paint: one pixel per cell, drawn smoothed over the floor so it reads as a soft glow; it fades with the marks
  function paintMarks() {
    const px = paintLayer.px, m = Rt.mark;
    for (let i = 0; i < NC; i++) px[i] = m[i] >= UNM ? P_UV[Math.min(15, (m[i] * 15) | 0)] : 0;
    paintLayer.x.putImageData(paintLayer.img, 0, 0);
  }
  // the walls, identical on both sides, drawn crisp on top (redrawn once per floor plan)
  function paintWalls() {
    const px = wallLayer.px, W4 = GW * 4;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const w = wall[y * GW + x], o = y * 4 * W4 + x * 4;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        let c = 0;
        if (w) {   // a slightly darker rim where the wall meets floor, so desks and walls keep their edges
          const ex = sx === 0 ? x - 1 : sx === 3 ? x + 1 : x, ey = sy === 0 ? y - 1 : sy === 3 ? y + 1 : y;
          const nb = (ex !== x && ex >= 0 && ex < GW && !wall[y * GW + ex]) || (ey !== y && ey >= 0 && ey < GH && !wall[ey * GW + x]);
          c = nb ? P_WEDGE : P_WALL;
        }
        px[o + sy * W4 + sx] = c;
      }
    }
    wallLayer.x.putImageData(wallLayer.img, 0, 0);
  }

  // ------------------------------------------------------------ layout
  let G = null;
  function layout() {
    const w = cv.w, h = cv.h, phone = w < 640;
    if (phone) {
      const top = 12, head = 22, foot = 32, gap = 8;
      const cell = Math.max(2.5, Math.min((w - 36) / GW, (h - top - 2 * head - gap - foot) / (2 * GH)));
      const pw = cell * GW, ph = cell * GH, x0 = (w - pw) / 2, y0 = top + head;
      G = { phone, cell, panels: [{ x: x0, y: y0, w: pw, h: ph }, { x: x0, y: y0 + ph + gap + head, w: pw, h: ph }], chart: null, hist: null, foot: { x: w / 2, y: h - 17 } };
    } else {
      const m = 22, gap = 26, head = 34;
      const cell = Math.max(3, Math.min((w - 2 * m - gap) / (2 * GW), (h - 18 - head - 150) / GH));
      const pw = cell * GW, ph = cell * GH, x0 = (w - 2 * pw - gap) / 2, y0 = 18 + head;
      const cy = y0 + ph + 34, ch = Math.max(90, h - cy - 16), histW = w >= 820 ? 300 : 236;
      G = { phone, cell, panels: [{ x: x0, y: y0, w: pw, h: ph }, { x: x0 + pw + gap, y: y0, w: pw, h: ph }],
        chart: { x: x0, y: cy, w: 2 * pw + gap - histW - 18, h: ch }, hist: { x: x0 + 2 * pw + gap - histW, y: cy, w: histW, h: ch }, foot: { x: w / 2, y: y0 + ph + 19 } };
    }
  }
  cv.onResize(layout); layout();

  // ------------------------------------------------------------ drawing
  const pct = (f) => Math.min(100, Math.floor(f * 100 + 1e-9)) + '%';
  function radioIcon(x, y, s) {                                          // a little mast with waves, crossed out
    ctx.save(); ctx.translate(x, y); ctx.lineCap = 'round'; ctx.lineWidth = 1.4; ctx.strokeStyle = C.muted;
    ctx.beginPath(); ctx.moveTo(0, -s * .1); ctx.lineTo(0, s * .55); ctx.moveTo(-s * .25, s * .55); ctx.lineTo(s * .25, s * .55); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -s * .1, s * .28, -2.4, -.74); ctx.stroke(); ctx.beginPath(); ctx.arc(0, -s * .1, s * .5, -2.4, -.74); ctx.stroke();
    ctx.strokeStyle = C.danger; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-s * .55, s * .6); ctx.lineTo(s * .55, -s * .6); ctx.stroke();
    ctx.restore();
  }
  function drawPanel(S, P, title, col, frac) {
    ctx.imageSmoothingEnabled = false; ctx.drawImage(S.floor.c, P.x, P.y, P.w, P.h);
    if (S.reading) { ctx.imageSmoothingEnabled = true; ctx.drawImage(paintLayer.c, P.x, P.y, P.w, P.h); ctx.imageSmoothingEnabled = false; }
    ctx.drawImage(wallLayer.c, P.x, P.y, P.w, P.h); ctx.imageSmoothingEnabled = true;
    ctx.strokeStyle = 'rgba(220,214,236,.16)'; ctx.lineWidth = 1; roundRect(ctx, P.x - .5, P.y - .5, P.w + 1, P.h + 1, 3); ctx.stroke();
    // entrance chevron
    const ex = P.x + G.cell * .5, ey = P.y + (entY + 1) * G.cell;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(ex - G.cell * 1.1, ey - G.cell * .9); ctx.lineTo(ex - G.cell * .2, ey); ctx.lineTo(ex - G.cell * 1.1, ey + G.cell * .9); ctx.stroke();
    // agents: small ink dots with a dark rim
    const r = G.phone ? 2.4 : Math.max(2.6, G.cell * .48), p = new Path2D();
    for (let k = 0; k < nAg; k++) {
      const t = S.prog[k], X = P.x + (S.x[k] + (S.tx[k] - S.x[k]) * t + .5) * G.cell, Y = P.y + (S.y[k] + (S.ty[k] - S.y[k]) * t + .5) * G.cell;
      p.moveTo(X + r, Y); p.arc(X, Y, r, 0, TAU);
    }
    ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(27,30,61,.9)'; ctx.stroke(p); ctx.fillStyle = C.ink; ctx.fill(p);
    // title row: colour chip, name, live coverage
    const ty = P.y - (G.phone ? 9 : 12), fs = G.phone ? 12 : 13;
    ctx.fillStyle = col; roundRect(ctx, P.x, ty - 8, 8, 8, 2); ctx.fill();
    text(ctx, title, P.x + 14, ty, { size: fs, color: C.ink, weight: 500 });
    text(ctx, pct(frac), P.x + P.w, ty, { size: fs, color: col, font: F.mono, align: 'right' });
    if (state === 'hold') {
      const s = S.reading ? (history[0] && history[0].done ? `done in ${Math.round(history[0].t)} s` : `${pct(frac)} in ${LIMIT} s`) : `${pct(frac)} in the same time`;
      ctx.font = `500 ${G.phone ? 12 : 13}px ${F.sans}`; const tw = ctx.measureText(s).width + 24, bh = G.phone ? 24 : 28;
      ctx.fillStyle = 'rgba(27,30,61,.86)'; roundRect(ctx, P.x + P.w / 2 - tw / 2, P.y + P.h / 2 - bh / 2, tw, bh, bh / 2); ctx.fill();
      text(ctx, s, P.x + P.w / 2, P.y + P.h / 2 + 1, { size: G.phone ? 12 : 13, color: col, weight: 500, align: 'center', base: 'middle' });
    }
  }
  const CURVES = [[L, C.rose, 'ignoring'], [Rt, C.teal, 'reading']];
  function drawChart() {
    const R = G.chart;
    const { px: X, py: Y } = kit.plot(ctx, R, [], { xMin: 0, xMax: LIMIT, yMin: 0, yMax: 1, yLabel: 'floor covered, this round', xLabel: `${LIMIT} s` });
    ctx.save(); ctx.beginPath(); ctx.rect(R.x + 14, R.y + 10, R.w - 28, R.h - 30); ctx.clip();
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(220,214,236,.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(0), Y(DONE)); ctx.lineTo(X(LIMIT), Y(DONE)); ctx.stroke(); ctx.setLineDash([]);
    for (const [S, col] of CURVES) {
      if (S.histN < 2) continue;
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
      for (let i = 0; i < S.histN; i++) { const xx = X(i * .5), yy = Y(S.hist[i]); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
      ctx.stroke();
    }
    ctx.restore();
    text(ctx, 'done at 99%', R.x + R.w - 14, Y(DONE) + 13, { size: 10.5, color: C.faint, align: 'right' });
    for (const [S, col, lab] of CURVES) {
      if (S.histN < 2) continue;
      const i = S.histN - 1, xx = X(i * .5), yy = Y(S.hist[i]);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(xx, yy, 3, 0, TAU); ctx.fill();
      const right = xx > R.x + R.w - 90;
      text(ctx, lab, xx + (right ? -8 : 8), yy + (S.reading ? -6 : 14), { size: 11, color: col, align: right ? 'right' : 'left' });
    }
    text(ctx, `${Math.min(LIMIT, T).toFixed(0)} s`, R.x + R.w - 14, R.y + 14, { size: 11, color: C.muted, font: F.mono, align: 'right' });
  }
  function drawHistory() {
    const H = G.hist; let y = H.y + 14;
    text(ctx, 'Finish times', H.x, y, { size: 11, color: C.faint }); y += 22;
    if (!history.length) { text(ctx, 'first round running…', H.x, y, { size: 12, color: C.muted }); return; }
    const big = H.w >= 280;
    for (let k = 0; k < history.length && y < H.y + H.h - 8; k++) {
      const e = history[k], a = k === 0 ? 1 : .6;
      ctx.globalAlpha = a;
      text(ctx, `round ${e.n}`, H.x, y, { size: 10.5, color: C.faint, font: F.mono });
      const l1 = e.done ? `reading marks finished in ${Math.round(e.t)} s,` : `reading marks reached ${pct(e.right)} in ${LIMIT} s,`;
      text(ctx, l1, H.x + (big ? 62 : 56), y, { size: big ? 12 : 11.5, color: C.teal });
      text(ctx, `ignoring marks reached ${pct(e.left)}`, H.x + (big ? 62 : 56), y + 16, { size: big ? 12 : 11.5, color: C.rose });
      ctx.globalAlpha = 1; y += 42;
    }
  }
  function draw() {
    const w = cv.w; cv.clear();
    paintFloor(L); paintFloor(Rt); paintMarks();
    drawPanel(L, G.panels[0], 'Ignoring marks', C.rose, L.covN / reachN);
    drawPanel(Rt, G.panels[1], 'Reading marks', C.teal, Rt.covN / reachN);
    if (G.chart) { drawChart(); drawHistory(); }
    // the footer line: radio jammed, or (on a phone) the last result
    const fx = G.foot.x, fy = G.foot.y;
    if (jammed) {
      let s = 'Radio jammed: nothing changes, the notes are on the walls', fs = G.phone ? 11 : 12.5;
      ctx.font = `400 ${fs}px ${F.sans}`; let tw = ctx.measureText(s).width;
      if (tw + 24 > w - 36) { fs = 10.5; ctx.font = `400 ${fs}px ${F.sans}`; tw = ctx.measureText(s).width; }
      if (tw + 24 > w - 36) { s = 'Radio jammed: nothing changes'; tw = ctx.measureText(s).width; }
      const x0 = clamp(fx - (tw + 24) / 2, 18, w - 18 - tw - 24);
      radioIcon(x0 + 8, fy - 4, G.phone ? 11 : 13);
      text(ctx, s, x0 + 24, fy, { size: fs, color: C.apricot });
    } else if (G.phone && history.length) {
      const e = history[0];
      text(ctx, e.done ? `last round: reading ${Math.round(e.t)} s, ignoring reached ${pct(e.left)}` : `last round: reading ${pct(e.right)}, ignoring ${pct(e.left)}`, fx, fy, { size: 11, color: C.muted, align: 'center' });
    }
  }

  // ------------------------------------------------------------ loop
  newRound(false);
  const loop = kit.loop((dt) => {
    stepSim(dt / 2); stepSim(dt / 2);
    draw();
    rL.set(pct(L.covN / reachN)); rR.set(pct(Rt.covN / reachN)); rM.set('0');
  });
  draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

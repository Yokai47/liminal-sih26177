// A production line, not a chef (why an FPGA: deterministic timing, heterogeneous parallelism).
// Every 2.5 ms (a 400 Hz control loop) each drone runs the swarm maths: the order parameter Φ, a topology update (β),
// a Koopman prediction (K·g) and a reservoir readout (W·x). Top: a CPU does them one after another on one core. Its
// task lengths grow with the swarm (pairwise work ∝ N²) and wobble from cycle to cycle: cache misses, OS interrupts,
// occasional kernel work and, with background load, other processes that hold the core. If a cycle overruns, the next
// one starts late. Bottom: an FPGA gives each task its own region of silicon, a pipeline with a fixed clock count,
// sized once for 256 drones, so it takes exactly the same time every cycle. Right: the Koopman / readout step as a
// systolic array, the standard FPGA shape for a matrix times a vector. Every number on screen comes from this model.

// ------------------------------------------------------------------ the timing model (no DOM)
export const PERIOD = 2.5;                                            // ms (400 Hz)
export const FPGA_MHZ = 100;
export const TASKS = [                                                // FPGA clock counts, sized for 256 drones
  { name: 'order Φ', clk: 4152 },        // 256 x 256 neighbour tests on 16 comparators + adder tree + CORDIC magnitude
  { name: 'topology β', clk: 33024 },    // union-find sweep over the voxel updates of 256 drones, 2 voxels per clock
  { name: 'Koopman K·g', clk: 18520 },   // 4-step prediction, 288 x 288 matrix on a 6 x 6 systolic array, twice per cycle
  { name: 'readout W·x', clk: 3652 },    // 32 outputs x 4096 reservoir states on the same array
];
export function fpgaModel(seed = 11) {
  const MAXS = 40, NR = 64, NS = 1000;
  let rs = seed >>> 0; const R = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);
  const G = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * R()); };
  const EX = (m) => -Math.log(1 - R()) * m;
  const S = { N: 128, load: 0, carry: 0, mt: 0, next: 0, count: 0, done: 0 };
  const cost = new Float64Array(4), fpgaMs = TASKS.map((t) => t.clk / (FPGA_MHZ * 1000));
  // CPU cost of each task in ms on one 1.5 GHz ARM core, as a function of the swarm size N
  function costs(N) {
    cost[0] = (6 + .003 * N * N) / 1000;                                // all pairs: ~3 ns per pair
    cost[1] = (12 + 1.1 * N + .0016 * N * N) / 1000;                    // voxel updates per drone + pair edges
    cost[2] = (4 + .0032 * (32 + N) * (32 + N)) / 1000;                 // 4 x d² multiply-adds, d = 32 + N observables
    cost[3] = (3 + .46 * N) / 1000;                                     // 32 x 16N multiply-adds
  }
  // the last NR cycles in full (for drawing) and the last NS cycles as numbers (for the readouts)
  const tick = new Float64Array(NR), resp = new Float32Array(NR), nseg = new Uint8Array(NR), skip = new Uint8Array(NR);
  const s0 = new Float32Array(NR * MAXS), s1 = new Float32Array(NR * MAXS), sk = new Uint8Array(NR * MAXS);
  const sResp = new Float32Array(NS), sMiss = new Uint8Array(NS), sFpga = new Float32Array(NS);
  let sN = 0, sHead = 0;
  // kinds: 0-3 the tasks, 4 interrupt, 5 another process holds the core, 6 late start (the last cycle overran), 7 kernel work
  function gen() {
    const slot = S.count % NR, o = slot * MAXS; let n = 0;
    const seg = (k, a, b) => { if (b - a <= 0) return; if (n < MAXS) { sk[o + n] = k; s0[o + n] = a; s1[o + n] = b; n++; } else s1[o + n - 1] = b; };
    tick[slot] = S.next; skip[slot] = 0;
    if (S.carry >= PERIOD) {                                            // still busy with an older cycle: this one is dropped
      seg(6, 0, S.carry); resp[slot] = S.carry; skip[slot] = 1; nseg[slot] = n; S.carry -= PERIOD; S.count++; return;
    }
    costs(S.N);
    const L = S.load, sig = (.05 + .18 * S.N / 256) * (L ? 1.2 : 1), base = L ? 1.04 : 1;
    const li = L ? 2.5 : 1.5, lk = L ? .02 : .006, lp = L ? .12 : 0, lam = li + lk + lp;   // events per ms of run time
    let t = S.carry;
    if (t > 0) seg(6, 0, t);
    if (L && R() < .18) { const q = R(), w = 2.8 * q * q; seg(5, t, t + w); t += w; }        // woke up, but the core is taken
    const cyc = 1 + .6 * sig * Math.abs(G());                           // cold cache: the whole cycle runs a little slow
    for (let k = 0; k < 4; k++) {
      let rem = cost[k] * base * cyc * (1 + sig * Math.abs(G()));
      while (rem > 1e-9) {
        const nx = EX(1 / lam);
        if (nx >= rem) { seg(k, t, t + rem); t += rem; break; }
        seg(k, t, t + nx); t += nx; rem -= nx;
        const u = R() * lam; let d, kind;
        if (u < li) { d = (3 + 17 * R()) / 1000 * (L ? 1.3 : 1); kind = 4; }
        else if (u < li + lk) { d = .06 + .7 * R() * R(); kind = 7; }
        else { const q = R(); d = .15 + 2.6 * q * q; kind = 5; }
        seg(kind, t, t + d); t += d;
      }
    }
    resp[slot] = t; nseg[slot] = n; S.carry = Math.max(0, t - PERIOD); S.count++;
  }
  const fpgaDone = Math.max(...fpgaMs);                                 // every lane starts at the tick; same clocks every time
  function finish(slot) {
    sResp[sHead] = skip[slot] ? -1 : resp[slot]; sMiss[sHead] = skip[slot] || resp[slot] > PERIOD ? 1 : 0; sFpga[sHead] = fpgaDone;
    sHead = (sHead + 1) % NS; if (sN < NS) sN++;
  }
  // advance model time by dms milliseconds: start the cycles whose tick has come, file the ones that have finished
  function advance(dms) {
    S.mt += dms;
    while (S.next <= S.mt) {
      gen(); S.next += PERIOD;
      while (S.done < S.count) { const sl = S.done % NR; if (tick[sl] + resp[sl] > S.mt) break; finish(sl); S.done++; }
    }
    while (S.done < S.count) { const sl = S.done % NR; if (tick[sl] + resp[sl] > S.mt) break; finish(sl); S.done++; }
  }
  function stats() {
    let worst = 0, miss = 0, fp = 0;
    for (let i = 0; i < sN; i++) { if (sResp[i] > worst) worst = sResp[i]; miss += sMiss[i]; if (sFpga[i] > fp) fp = sFpga[i]; }
    return { worst, miss, n: sN, fpga: fp };
  }
  return { S, NR, MAXS, tick, resp, nseg, skip, s0, s1, sk, fpgaMs, fpgaDone, advance, stats, costs, cost };
}

// ------------------------------------------------------------------ the simulation page
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  cv.cv.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2, P = PERIOD, TMAX = 3, ROWS = 40, SLOW = 40;
  const M = fpgaModel(11), S = M.S;
  const LAV = '#B9A6F2';
  const TC = [C.teal, LAV, C.heat, C.mist];                             // task colours (CPU segments and FPGA lanes)
  const fmtMs = (v) => v.toFixed(2) + ' ms';
  const SYS_SUB = 'Zoom into one lane: K·g on a 6 × 6 grid of multiply-add cells. K is stored in the cells; g flows down, sums flow right.';
  const SYS_SUB_PH = 'K·g on a 6 × 6 grid of multiply-add cells: g flows down, sums flow right.';
  const SYS_NOTE = 'Every cell multiplies, adds and passes on, on the same clock edge. No instructions to fetch, no cache: the same 11 clocks every time. (One 10 ns clock is shown as 0.3 s.)';
  const CAPTION = 'Model, not a benchmark. CPU: one 1.5 GHz ARM core on Linux; work grows with the swarm (pairwise ∝ N²), ' +
    'plus cache misses and interrupts, plus other processes when loaded. FPGA: 100 MHz fabric sized for 256 drones, ' +
    'fixed clock counts. Timeline slowed 40×.';

  // ---------------------------------------------------------------- controls and readouts
  let dirty = true;                                                    // settings changed: run 1000 cycles ahead at once
  const sN = kit.slider(controls, { label: 'Drones in the swarm', min: 8, max: 256, step: 8, value: 192, fmt: (v) => String(v), onInput: (v) => { S.N = v; dirty = true; } });
  kit.toggle(controls, { label: 'Background load', options: [{ v: 0, label: 'Off' }, { v: 1, label: 'On' }], value: 0, onChange: (v) => { S.load = v; dirty = true; } });
  kit.hint(controls, 'Each row is one 2.5 ms control cycle. Add drones or switch on background load: only the CPU rows change.');
  const rCpu = kit.readout(readouts, { label: 'CPU worst case', tone: 'rose' });
  const rFpga = kit.readout(readouts, { label: 'FPGA every cycle', tone: 'teal' });
  const rMiss = kit.readout(readouts, { label: 'Deadline misses', tone: 'heat' });
  S.N = sN.get();

  // ---------------------------------------------------------------- hatch patterns (made once)
  function hatch(col, bg) {
    const c = document.createElement('canvas'); c.width = c.height = 6; const x = c.getContext('2d');
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, 6, 6); }
    x.strokeStyle = col; x.lineWidth = 1.3; x.beginPath(); x.moveTo(-1, 7); x.lineTo(7, -1); x.moveTo(-1, 1); x.lineTo(1, -1); x.moveTo(5, 7); x.lineTo(7, 5); x.stroke();
    return ctx.createPattern(c, 'repeat');
  }
  const PAT_OTHER = hatch('rgba(180,177,224,.75)', 'rgba(143,140,196,.16)');
  const PAT_LATE = hatch('rgba(240,138,126,.8)', 'rgba(240,138,126,.12)');

  // ---------------------------------------------------------------- the systolic array (its own slow clock)
  const SA = 6, Kw = new Float32Array(SA * SA), gv = new Float32Array(SA), yv = new Float32Array(SA), yOld = new Float32Array(SA);
  const sr = kit.rng(29);
  for (let i = 0; i < SA * SA; i++) Kw[i] = sr() * 2 - 1;
  let tau = -1.3, wave = 0, yMax = 1;
  function newWave() {
    yOld.set(yv); for (let j = 0; j < SA; j++) gv[j] = sr() * 2 - 1;
    yMax = .6; for (let i = 0; i < SA; i++) { let s = 0; for (let j = 0; j < SA; j++) s += Kw[i * SA + j] * gv[j]; yv[i] = s; yMax = Math.max(yMax, Math.abs(s)); }
    tau = -1.3; wave++;
  }
  newWave();
  const CLK_S = .3;                                                    // one 10 ns clock shown as 0.3 s
  const psum = (i, upto) => { let s = 0; for (let j = 0; j < SA && j < upto; j++) s += Kw[i * SA + j] * gv[j]; return s; };

  // ---------------------------------------------------------------- layout
  let G = null;
  function wrap(str, maxW, size) {
    ctx.font = `400 ${size}px ${F.sans}`; const out = []; let cur = '';
    for (const w of str.split(' ')) { const t = cur ? cur + ' ' + w : w; if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t; }
    if (cur) out.push(cur); return out;
  }
  function layout() {
    const w = cv.w, h = cv.h, phone = w < 640;
    if (!phone) {
      const m = 22, sw = clamp(Math.round(w * .3), 206, 290);
      const panel = { x: w - m - sw, y: 18, w: sw, h: h - 36 };
      const x0 = m + 2, x1 = panel.x - 28;
      const capSize = 10.5, cap = wrap(CAPTION, x1 - x0, capSize), capLH = 14;
      const head = 30, cpuT = head + 30, cpuTop = cpuT + 11;
      const capTop = h - 20 - cap.length * capLH;
      const axisH = 36, fT = 32;
      const avail = capTop - 12 - axisH - cpuTop - fT;
      const rowH = clamp(avail * .55 / ROWS, 2, 4.4), lg = clamp(avail * .025, 4, 8);
      const lh = clamp((avail - ROWS * rowH - 3 * lg) / 4, 9, 28);
      const cpuBot = cpuTop + ROWS * rowH, fpgaT = cpuBot + 25, fpgaTop = fpgaT + 10, fpgaBot = fpgaTop + 4 * lh + 3 * lg;
      // the systolic array inside the panel, the whole block centred vertically
      const inner = sw - 40, sub = wrap(SYS_SUB, inner, 11.5), notes = wrap(SYS_NOTE, inner, 11), bw = 44;
      const fixed = 20 + sub.length * 15.5 + 42 + 28 + 20 + notes.length * 15;
      const cs = Math.max(14, Math.min((inner - bw - 18) / SA, (panel.h - 48 - fixed) / SA, 34)), gw = cs * SA;
      const ty = panel.y + Math.max(30, (panel.h - fixed - gw) / 2 + 10), gy = ty + 20 + sub.length * 15.5 + 42;
      const gx = panel.x + (sw - gw - 18 - bw) / 2;
      G = { phone, x0, x1, head, cpuT, cpuTop, cpuBot, rowH, fpgaT, fpgaTop, fpgaBot, lh, lg, axisY: fpgaBot + 12, cap, capTop, capSize, capLH,
        panel, sys: { x: gx, y: gy, cs, titleX: panel.x + 20, titleY: ty, sub, notes, outX: gx + gw + 18, bw, clockY: gy + gw + 28 } };
    } else {
      const m = 18, x0 = m, x1 = w - m;
      const capSize = 10, cap = wrap(CAPTION, x1 - x0, capSize), capLH = 12.5;
      const head = 22, cpuT = head + 24, cpuTop = cpuT + 8;
      const capTop = h - 16 - cap.length * capLH;
      const cs = 11, sysH = cs * SA + 30;
      const axisH = 30, fT = 24;
      const avail = capTop - 10 - sysH - axisH - cpuTop - fT;
      const rowH = clamp(avail * .52 / ROWS, 1.5, 3), lg = 3;
      const lh = clamp((avail - ROWS * rowH - 3 * lg) / 4, 8, 16);
      const cpuBot = cpuTop + ROWS * rowH, fpgaT = cpuBot + 20, fpgaTop = fpgaT + 7, fpgaBot = fpgaTop + 4 * lh + 3 * lg;
      const axisY = fpgaBot + 10, sy = axisY + axisH + 14;
      const tx = x0 + 2 + cs * SA + 50;
      G = { phone, x0, x1, head, cpuT, cpuTop, cpuBot, rowH, fpgaT, fpgaTop, fpgaBot, lh, lg, axisY, cap, capTop, capSize, capLH,
        panel: null, sys: { x: x0 + 2, y: sy, cs, titleX: tx, titleY: sy + 8, sub: wrap(SYS_SUB_PH, x1 - tx, 10), outX: x0 + 2 + cs * SA + 10, bw: 28 } };
    }
  }
  cv.onResize(layout); layout();

  // ---------------------------------------------------------------- drawing
  const X = (t) => G.x0 + t / TMAX * (G.x1 - G.x0);
  function tag(str, x, y, col, size = 10.5) {
    ctx.font = `400 ${size}px ${F.sans}`; const tw = ctx.measureText(str).width;
    if (x + tw + 8 > G.x1) x = G.x1 - tw - 8;
    ctx.fillStyle = 'rgba(27,30,61,.88)'; roundRect(ctx, x - 4, y - 8, tw + 8, 16, 5); ctx.fill();
    text(ctx, str, x, y + .5, { size, color: col, base: 'middle' });
  }
  const tagPick = new Int32Array(8).fill(-1), tagSeg = new Int32Array(8);
  const TAGS = [[5, 'other process', '#B4B1E0'], [6, 'late start', C.danger], [7, 'kernel work', C.rose], [4, 'interrupt', C.rose]];
  const paths = [];
  function drawTimeline() {
    const { rowH, cpuTop, cpuBot } = G, cnt = S.count;
    const newest = cnt - 1, lastTick = M.tick[newest % M.NR], phase = clamp((S.mt - lastTick) / P, 0, 1);
    const gap = rowH >= 3 ? 1 : rowH >= 2 ? .6 : .4, bh = rowH - gap;
    for (let k = 0; k < 10; k++) paths[k] = new Path2D();
    let flash = 0, flashY = 0, flashX = 0, mn = 1e9, mx = 0;
    ctx.save(); ctx.beginPath(); ctx.rect(G.x0 - 4, cpuTop, G.x1 - G.x0 + 8, cpuBot - cpuTop); ctx.clip();
    for (let k = 0; k < ROWS + 1 && k < cnt; k++) {
      const c = newest - k, sl = c % M.NR, t0 = M.tick[sl], vis = S.mt - t0, y = cpuTop + (k + phase) * rowH;
      if (y > cpuBot) break;
      const r = M.resp[sl], o = sl * M.MAXS, miss = M.skip[sl] || r > P;
      if (k < ROWS && vis >= r && !M.skip[sl]) { if (r < mn) mn = r; if (r > mx) mx = r; }
      if (miss && vis >= P) {                                          // a miss flashes for ~0.8 s on screen
        const f = 1 - (vis - P) / (800 / SLOW);
        if (f > 0) { ctx.fillStyle = `rgba(240,138,126,${(.22 * f).toFixed(3)})`; ctx.fillRect(G.x0 - 4, y, G.x1 - G.x0 + 8, rowH); if (f > flash) { flash = f; flashY = y + rowH / 2; flashX = X(Math.min(TMAX, r)); } }
      }
      for (let s = 0; s < M.nseg[sl]; s++) {
        const kind = M.sk[o + s], a = M.s0[o + s], b = Math.min(M.s1[o + s], vis, TMAX);
        if (b <= a) continue;
        let xa = X(a), xb = X(b);
        if (kind === 4 || kind === 7) { if (xb - xa < 1.3) xb = xa + 1.3; paths[4].rect(xa, y, xb - xa, bh); continue; }
        if (kind < 4 && b > P) {                                       // past the deadline: drawn in danger
          const xp = X(Math.max(a, P)); if (a < P) paths[kind].rect(xa, y, xp - xa, bh); paths[8].rect(xp, y, xb - xp, bh); continue;
        }
        paths[kind].rect(xa, y, xb - xa, bh);
      }
      if (vis > TMAX && r > TMAX) paths[9].rect(X(TMAX) + 2, y, 3, bh);    // runs off the chart
    }
    for (let k = 0; k < 4; k++) { ctx.fillStyle = TC[k]; ctx.globalAlpha = .9; ctx.fill(paths[k]); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.rose; ctx.fill(paths[4]);
    ctx.fillStyle = PAT_OTHER; ctx.fill(paths[5]);
    ctx.fillStyle = PAT_LATE; ctx.fill(paths[6]);
    ctx.fillStyle = C.danger; ctx.fill(paths[8]); ctx.fill(paths[9]);
    ctx.restore();

    // labels for what wobbles: one instance per kind, kept while it scrolls through, never two tags on top of each other
    const placed = [];
    const rowY = (k2) => cpuTop + (k2 + phase) * rowH + rowH / 2;
    const ok = (kind, cc, ss) => {
      const k2 = newest - cc; if (k2 < 3 || k2 > ROWS - 6) return false;
      const sl = cc % M.NR, o = sl * M.MAXS; if (ss >= M.nseg[sl] || M.sk[o + ss] !== kind || S.mt - M.tick[sl] < M.s1[o + ss]) return false;
      const y = rowY(k2); for (const py of placed) if (Math.abs(py - y) < 18) return false; return true;
    };
    for (const [kind, label, col] of TAGS) {
      if (placed.length >= 2) break;
      let c = tagPick[kind];
      if (c < 0 || !ok(kind, c, tagSeg[kind])) {
        c = -1;
        for (let k = 6; k < ROWS - 10 && k < cnt && c < 0; k++) {
          const cc = newest - k, sl = cc % M.NR, o = sl * M.MAXS;
          for (let s = 0; s < M.nseg[sl]; s++) if (M.sk[o + s] === kind && M.s1[o + s] < TMAX - .45 && (kind === 4 || M.s1[o + s] - M.s0[o + s] > .08) && ok(kind, cc, s)) { c = cc; tagSeg[kind] = s; break; }
        }
        tagPick[kind] = c;
      }
      if (c < 0) continue;
      const y = rowY(newest - c), sl = c % M.NR, xe = X(Math.min(TMAX, M.s1[sl * M.MAXS + tagSeg[kind]]));
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xe + 1, y); ctx.lineTo(xe + 9, y); ctx.stroke();
      tag(label, xe + 13, y, col); placed.push(y);
    }

    // the FPGA: every lane starts at the tick and takes the same clocks every cycle
    const { lh, lg, fpgaTop } = G;
    for (let k = 0; k < 4; k++) {
      const y = fpgaTop + k * (lh + lg), xe = X(M.fpgaMs[k]);
      ctx.fillStyle = TC[k]; ctx.globalAlpha = .9; ctx.fillRect(X(0), y, xe - X(0), lh); ctx.globalAlpha = 1;
      // a faint line every 5th cycle drifts down: these are 40 stacked cycles, all identical
      ctx.fillStyle = 'rgba(27,30,61,.2)';
      for (let c = newest - ((newest % 5 + 5) % 5), kk = newest - c; kk < ROWS; kk += 5) { const yy = y + (kk + phase) / ROWS * lh; if (yy < y + lh - .5) ctx.fillRect(X(0), yy, xe - X(0), .8); }
      const nm = TASKS[k].name, fs = G.phone ? 10.5 : 11.5;
      text(ctx, nm, xe + 8, y + lh / 2 + .5, { size: fs, color: TC[k], base: 'middle' });
      if (!G.phone || lh >= 10) { ctx.font = `400 ${fs}px ${F.sans}`; const nw = ctx.measureText(nm).width; text(ctx, TASKS[k].clk.toLocaleString('en-US') + ' clocks', xe + 14 + nw, y + lh / 2 + .5, { size: G.phone ? 9.5 : 10.5, color: C.faint, font: F.mono, base: 'middle' }); }
    }

    // deadline line, axis
    const xd = X(P), top = cpuTop - 4, bot = G.fpgaBot + 4;
    const dl = () => { ctx.beginPath(); ctx.moveTo(xd, top); ctx.lineTo(xd, cpuBot + 4); ctx.moveTo(xd, G.fpgaTop - 5); ctx.lineTo(xd, bot); ctx.stroke(); };
    if (flash > 0) { ctx.save(); ctx.shadowColor = 'rgba(240,138,126,.9)'; ctx.shadowBlur = 10 * flash; ctx.strokeStyle = C.danger; ctx.lineWidth = 2; dl(); ctx.restore(); }
    else { ctx.strokeStyle = 'rgba(243,238,242,.5)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]); dl(); ctx.setLineDash([]); }
    if (flash > .05) { ctx.globalAlpha = clamp(flash * 1.5, 0, 1); tag('missed', Math.min(flashX + 8, G.x1 - 50), flashY, C.danger, 11); ctx.globalAlpha = 1; }
    const ay = G.axisY;
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(0), ay); ctx.lineTo(X(TMAX), ay);
    for (let t = 0; t <= TMAX + 1e-6; t += .5) { const x = X(t); ctx.moveTo(x, ay); ctx.lineTo(x, ay + (t % 1 ? 3 : 5)); }
    ctx.stroke();
    const fs = G.phone ? 9.5 : 10.5, dlab = 'deadline 2.5 ms', dfs = G.phone ? 10 : 11;
    ctx.font = `500 ${dfs}px ${F.sans}`; const dw = ctx.measureText(dlab).width, dx = Math.min(xd - dw / 2, X(TMAX) - dw);
    for (let t = 0; t <= TMAX; t++) {
      const s = t === TMAX ? t + ' ms' : String(t), x = X(t); ctx.font = `400 ${fs}px ${F.mono}`; const tw = ctx.measureText(s).width;
      const l = t === 0 ? x : t === TMAX ? x - tw : x - tw / 2; if (l + tw > dx - 6 && l < dx + dw + 6) continue;   // keep clear of the deadline label
      text(ctx, s, x, ay + 17, { size: fs, color: C.faint, font: F.mono, align: t === 0 ? 'left' : t === TMAX ? 'right' : 'center' });
    }
    text(ctx, dlab, dx, ay + 17, { size: dfs, color: flash > 0 ? C.danger : C.ink, weight: 500 });
    return { mn, mx };
  }
  function drawHeads(mn, mx) {
    const ph = G.phone, f1 = ph ? 12 : 13, f2 = ph ? 10.5 : 11.5;
    text(ctx, ph ? 'Each row: one 2.5 ms cycle, newest on top' : 'The last 40 cycles of a 400 Hz control loop, newest on top', G.x0, G.head, { size: ph ? 11 : 12, color: C.muted });
    text(ctx, 'slowed 40×', G.x1, G.head, { size: ph ? 9.5 : 10.5, color: C.faint, font: F.mono, align: 'right' });
    // CPU
    text(ctx, 'CPU', G.x0, G.cpuT, { size: f1, color: C.ink, weight: 600 });
    ctx.font = `600 ${f1}px ${F.sans}`; const cw = ctx.measureText('CPU').width;
    const spread = mx > 0 ? `${mn.toFixed(2)}–${mx.toFixed(2)} ms` : '';
    ctx.font = `400 ${f2}px ${F.mono}`; const sw = ctx.measureText(spread).width;
    const sub = S.load ? 'one chef, one step at a time, sharing the kitchen' : 'one fast chef, one step at a time';
    const room = G.x1 - sw - 16 - (G.x0 + cw + 8);
    ctx.font = `400 ${f2}px ${F.sans}`;
    if (ctx.measureText(sub).width < room) text(ctx, sub, G.x0 + cw + 8, G.cpuT, { size: f2, color: C.muted });
    else if (ctx.measureText('one step at a time').width < room) text(ctx, 'one step at a time', G.x0 + cw + 8, G.cpuT, { size: f2, color: C.muted });
    if (spread) text(ctx, spread, G.x1, G.cpuT, { size: f2, color: C.rose, font: F.mono, align: 'right' });
    // FPGA
    text(ctx, 'FPGA', G.x0, G.fpgaT, { size: f1, color: C.ink, weight: 600 });
    ctx.font = `600 ${f1}px ${F.sans}`; const fw = ctx.measureText('FPGA').width;
    const same = `${M.fpgaDone.toFixed(2)} ms, every cycle`;
    ctx.font = `400 ${f2}px ${F.mono}`; const sw2 = ctx.measureText(same).width;
    const sub2 = 'a production line: every task on its own lane, all at once', room2 = G.x1 - sw2 - 16 - (G.x0 + fw + 8);
    ctx.font = `400 ${f2}px ${F.sans}`;
    if (ctx.measureText(sub2).width < room2) text(ctx, sub2, G.x0 + fw + 8, G.fpgaT, { size: f2, color: C.muted });
    else if (ctx.measureText('a production line').width < room2) text(ctx, 'a production line', G.x0 + fw + 8, G.fpgaT, { size: f2, color: C.muted });
    text(ctx, same, G.x1, G.fpgaT, { size: f2, color: C.teal, font: F.mono, align: 'right' });
    // caption: the model's assumptions
    for (let i = 0; i < G.cap.length; i++) text(ctx, G.cap[i], G.x0, G.capTop + 11 + i * G.capLH, { size: G.capSize, color: C.faint });
  }
  function drawSystolic() {
    const Y = G.sys, cs = Y.cs, gx = Y.x, gy = Y.y, n = SA, ph = G.phone;
    if (G.panel) { const p = G.panel; ctx.fillStyle = C.panel; roundRect(ctx, p.x, p.y, p.w, p.h, 14); ctx.fill(); }
    // title and what it is
    if (!ph) {
      text(ctx, 'the recipe is the wiring', Y.titleX, Y.titleY, { size: 13.5, color: C.ink, weight: 500 });
      for (let i = 0; i < Y.sub.length; i++) text(ctx, Y.sub[i], Y.titleX, Y.titleY + 20 + i * 15.5, { size: 11.5, color: C.muted });
    } else {
      text(ctx, 'the recipe is the wiring', Y.titleX, Y.titleY + 4, { size: 11.5, color: C.ink, weight: 500 });
      for (let i = 0; i < Y.sub.length && i < 4; i++) text(ctx, Y.sub[i], Y.titleX, Y.titleY + 20 + i * 12.5, { size: 10, color: C.muted });
    }
    // wires
    ctx.strokeStyle = 'rgba(220,214,236,.16)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < n; i++) { const yy = gy + (i + .5) * cs; ctx.moveTo(gx - 4, yy); ctx.lineTo(gx + n * cs + 6, yy); }
    for (let j = 0; j < n; j++) { const xx = gx + (j + .5) * cs; ctx.moveTo(xx, gy - cs * .55); ctx.lineTo(xx, gy + n * cs + 2); }
    ctx.stroke();
    // cells: the stored weight as a soft fill; the cell that is working right now glows
    const cw = cs * .7, co = (cs - cw) / 2, rr = Math.min(5, cs * .18);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = gx + j * cs + co, y = gy + i * cs + co, kv = Kw[i * n + j], d = Math.abs(tau - (i + j) - .5);
      ctx.fillStyle = '#1f2246'; roundRect(ctx, x, y, cw, cw, rr); ctx.fill();
      ctx.fillStyle = `rgba(143,140,196,${(.12 + .3 * Math.abs(kv)).toFixed(3)})`; ctx.fill();
      if (d < .6) { ctx.fillStyle = `rgba(255,195,107,${(.55 * (1 - d / .6)).toFixed(3)})`; ctx.fill(); }
      ctx.strokeStyle = d < .6 ? 'rgba(255,195,107,.75)' : 'rgba(220,214,236,.2)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // g values travelling down (teal), partial sums travelling right (heat, growing as they collect products)
    const pr = ph ? 2.2 : 3.2;
    ctx.fillStyle = C.teal;
    for (let j = 0; j < n; j++) {
      const row = Math.max(tau - j, -.75); if (row > n - .5) continue;
      const a = row < -.5 ? .55 : row > n - 1 ? clamp((n - .5 - row) * 2, 0, 1) : 1;
      ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(gx + (j + .5) * cs, gy + (row + .5) * cs, pr, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.fillStyle = C.heat;
    for (let i = 0; i < n; i++) {
      const col = tau - i; if (col < 0 || col > n) continue;
      const v = psum(i, Math.floor(col + .5)), r = (ph ? 1.4 : 2) + (ph ? 2.2 : 3.4) * Math.min(1, Math.abs(v) / yMax);
      ctx.beginPath(); ctx.arc(gx + (col + .5) * cs, gy + (i + .5) * cs, r, 0, TAU); ctx.fill();
    }
    // results leave at the right edge
    const ox = Y.outX, bw = Y.bw;
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(ox + bw / 2, gy + 2); ctx.lineTo(ox + bw / 2, gy + n * cs - 2); ctx.stroke();
    for (let i = 0; i < n; i++) {
      const out = tau - i >= n, v = out ? yv[i] : yOld[i], L = v / yMax * bw / 2, yy = gy + (i + .5) * cs;
      ctx.fillStyle = out ? C.heat : 'rgba(255,195,107,.25)'; ctx.fillRect(Math.min(ox + bw / 2, ox + bw / 2 + L), yy - (ph ? 1.5 : 3), Math.max(1, Math.abs(L)), ph ? 3 : 6);
    }
    const fs = ph ? 9.5 : 11;
    if (!ph) {
      text(ctx, 'g in', gx - 2, gy - cs * .55 - 8, { size: fs, color: C.teal });
      text(ctx, 'K·g out', ox + bw / 2, gy - cs * .55 - 8, { size: fs, color: C.heat, align: 'center' });
      const clk = clamp(Math.floor(tau) + 1, 0, 2 * n - 1), by = Y.clockY;
      text(ctx, `clock ${clk} of ${2 * n - 1}`, Y.titleX, by, { size: 11, color: C.muted, font: F.mono });
      for (let i = 0; i < Y.notes.length; i++) text(ctx, Y.notes[i], Y.titleX, by + 22 + i * 15, { size: 11, color: C.faint });
    } else {
      const clk = clamp(Math.floor(tau) + 1, 0, 2 * n - 1);
      text(ctx, `clock ${clk} of ${2 * n - 1} · the same every time`, Y.titleX, gy + n * cs - 1, { size: 9.5, color: C.faint, font: F.mono });
    }
  }
  function draw() {
    cv.clear();
    const { mn, mx } = drawTimeline();
    drawHeads(mn, mx);
    drawSystolic();
  }

  // ---------------------------------------------------------------- loop
  function settle() { if (!dirty) return; dirty = false; M.advance(1000 * P); }   // 1000 cycles at the new settings, at once
  settle();
  let shown = { w: -1, m: -1 };
  const loop = kit.loop((dt) => {
    settle();
    M.advance(dt * 1000 / SLOW);
    tau += dt / CLK_S; if (tau > 2 * SA + 1.6) newWave();
    draw();
    const st = M.stats();
    if (st.worst !== shown.w) { rCpu.set(fmtMs(st.worst)); shown.w = st.worst; }
    rFpga.set(fmtMs(st.fpga));
    if (st.miss !== shown.m) { rMiss.set(`${st.miss} / ${st.n}`); shown.m = st.miss; }
  });
  draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

// Live concept cards: one per concept that is actively doing work (from the script's beats), at most three, newest on
// top. Each has a small visualisation drawn from the tape at the current tick, a stat line and "See it in the lab".
import { landscape, HC, components } from '../sim/fields.js';
import { ST } from '../sim/tape.js';

const C = { teal: '#7FD4CF', rose: '#EFB1B4', heat: '#FFC36B', haze: '#8F8CC4', apr: '#F6D2B1', paper: '#F3EEF2', faint: 'rgba(243,238,242,.4)', grid: 'rgba(220,214,236,.1)', lav: '#B9A6F2', danger: '#F08A7E', mono: '"Geist Mono", ui-monospace, monospace', sans: 'Geist, ui-sans-serif, system-ui, sans-serif' };
export const CONCEPT = {
  vicsek: { name: 'Order at the edge', lab: 'lab-vicsek', tag: 'Vicsek', line: 'Each drone copies its neighbours’ heading with noise held near the threshold: ordered, yet still responsive.' },
  slowing: { name: 'Critical slowing down', lab: 'lab-slowing', tag: 'recovery', line: 'Near the threshold the swarm recovers slowly from a shock; the recovery time tells it where it sits.' },
  symmetry: { name: 'Symmetry breaking', lab: 'lab-symmetry', tag: 'no commands', line: 'The ground robots only park. Being different is enough: the identical drones split into teams around them.' },
  turing: { name: 'Turing spacing', lab: 'lab-turing', tag: 'Gray-Scott', line: 'Drones climb a reaction-diffusion field and push each other away, so they settle at an even spacing.' },
  phase: { name: 'A phase change', lab: 'lab-phase', tag: 'marble landscape', line: 'A strong signal tilts the landscape until the search valley vanishes; the swarm rolls into converge.' },
  stigmergy: { name: 'Writing on the world', lab: 'lab-stigmergy', tag: 'stigmergy', line: 'Marks left on the world tell later drones where someone already went. Nothing to jam, nothing to send.' },
  crdt: { name: 'Maps that merge', lab: 'lab-crdt', tag: 'CRDT', line: 'Every drone keeps its own searched set; a union merges in any order, so a drone back in range just catches up.' },
  topology: { name: 'Counting the holes', lab: 'lab-topology', tag: 'β₀', line: 'Unsearched space is counted as separate pockets. The search is over only when the count is zero.' },
  pocket: { name: 'A sealed void', lab: 'lab-pocket', tag: 'β₂', line: 'Mapped all round but never entered: an enclosed space that could hold a person, flagged for rescuers.' },
  koopman: { name: 'Forecasting the swarm', lab: 'lab-koopman', tag: 'Koopman', line: 'A linear model learned from the swarm’s own data predicts where the search edge will be. It can be wrong.' },
  reservoir: { name: 'Feeling the shake', lab: 'lab-reservoir', tag: 'reservoir', line: 'A trained linear readout of the swarm’s own motion spikes when something shakes it; no extra sensor.' },
  fpga: { name: 'Same cycles, every tick', lab: 'lab-fpga', tag: 'FPGA', line: 'The collective layer runs as fixed hardware: the same number of cycles every tick, whatever the swarm does.' },
};

export function createCards(el, { onLab = () => {}, phone = false } = {}) {
  const live = new Map();   // concept -> { node, cv, ctx, st, w, h }
  const order = [];
  let tape = null, extra = {};
  // how many cards fit: a strip on phones; on a short desktop window only two stay open
  const cap = () => (phone ? 4 : (el.clientHeight || innerHeight) < 600 || innerHeight < 800 ? 2 : 3);
  function setTape(t, x = {}) { tape = t; extra = x; for (const c of [...live.keys()]) remove(c, true); }
  function add(concept) {
    const def = CONCEPT[concept]; if (!def || live.has(concept)) return;
    const node = document.createElement('article'); node.className = 'a4card enter'; node.setAttribute('aria-label', def.name);
    node.innerHTML = `<header><i></i><h4>${def.name}</h4><span class="tag">${def.tag}</span></header><canvas></canvas><div class="st"><span class="a"></span><span class="b"></span></div><p>${def.line}</p><button class="lab" type="button">See it in the lab</button>`;
    node.querySelector('.lab').addEventListener('click', () => onLab(def.lab));
    el.insertBefore(node, el.firstChild);
    const cv = node.querySelector('canvas'); const o = { node, cv, ctx: cv.getContext('2d'), sa: node.querySelector('.st .a'), sb: node.querySelector('.st .b'), w: 0, h: 0, born: performance.now() };
    live.set(concept, o); order.unshift(concept);
    requestAnimationFrame(() => node.classList.remove('enter'));
    while (order.length > cap()) remove(order[order.length - 1]);
  }
  function remove(concept, now = false) {
    const o = live.get(concept); if (!o) return; live.delete(concept); const i = order.indexOf(concept); if (i >= 0) order.splice(i, 1);
    if (now) { o.node.remove(); return; }
    o.node.classList.add('leave'); setTimeout(() => o.node.remove(), 460);
  }
  // active: array of concept ids (in the order they became active)
  function show(active) {
    const want = active.slice(-cap());
    for (const c of [...live.keys()]) if (!want.includes(c)) remove(c);
    for (const c of want) if (!live.has(c)) add(c);
  }
  let lastDraw = 0;
  function update(tf, force = false) {
    if (!tape) return; const now = performance.now(); if (!force && now - lastDraw < 60) return; lastDraw = now;
    for (const [c, o] of live) {
      const r = o.cv.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (r.width < 4) continue;
      if (Math.abs(r.width - o.w) > .5 || Math.abs(r.height - o.h) > .5) { o.w = r.width; o.h = r.height; o.cv.width = Math.round(r.width * dpr); o.cv.height = Math.round(r.height * dpr); }
      const x = o.ctx; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, o.w, o.h);
      try { const s = DRAW[c](x, o.w, o.h, tape, tf, extra) || ['', '']; o.sa.innerHTML = s[0]; o.sb.innerHTML = s[1]; } catch (e) { console.warn('card', c, e); }
    }
  }
  return { show, update, setTape, clear() { for (const c of [...live.keys()]) remove(c, true); }, get active() { return [...order]; } };
}

// ------------------------------------------------------------------ drawing helpers
const M = (t, k, i) => { const a = t.metrics[k]; return a ? a[Math.max(0, Math.min(t.T - 1, i))] : 0; };
function spark(x, t, key, a, b, X0, Y0, W, H, lo, hi, col, width = 1.6, fill = false) {
  const n = Math.max(1, b - a); x.beginPath();
  for (let i = a; i <= b; i++) { const px = X0 + (i - a) / n * W, v = (M(t, key, i) - lo) / (hi - lo); const py = Y0 + H - Math.max(0, Math.min(1, v)) * H; i === a ? x.moveTo(px, py) : x.lineTo(px, py); }
  if (fill) { x.lineTo(X0 + W, Y0 + H); x.lineTo(X0, Y0 + H); x.closePath(); x.fillStyle = fill; x.fill(); }
  else { x.strokeStyle = col; x.lineWidth = width; x.lineJoin = 'round'; x.stroke(); }
}
const label = (x, s, X, Y, col = C.faint, align = 'left', size = 10.5, font = C.sans) => { x.font = `${size}px ${font}`; x.fillStyle = col; x.textAlign = align; x.textBaseline = 'alphabetic'; x.fillText(s, X, Y); };
const firstEv = (t, type, from = 0) => t.events.find((e) => e.type === type && e.t >= from);
const fmtS = (s) => s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;

const DRAW = {
  vicsek(x, w, h, t, tf) {
    // Φ over the transit (or front), with the band the noise controller holds it in
    const k = Math.floor(tf); let a = k - 90, b = k;
    const dep = firstEv(t, 'depart') || firstEv(t, 'front'); if (dep && k < dep.t + 140) { a = Math.max(0, dep.t - 4); b = Math.max(a + 30, k); }
    a = Math.max(0, a);
    const X0 = 6, Y0 = 8, W = w - 12, H = h - 22;
    x.fillStyle = 'rgba(127,212,207,.08)'; const yb = (v) => Y0 + H - v * H; x.fillRect(X0, yb(.8), W, yb(.48) - yb(.8));
    x.strokeStyle = 'rgba(239,177,180,.45)'; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(X0, yb(.48)); x.lineTo(X0 + W, yb(.48)); x.stroke(); x.setLineDash([]);
    spark(x, t, 'phi', a, b, X0, Y0, W, H, 0, 1, C.teal, 1.8);
    label(x, 'threshold', X0 + W - 2, yb(.48) + 12, 'rgba(239,177,180,.7)', 'right');
    label(x, 'Φ', X0 + 2, Y0 + 10, C.teal);
    const phi = M(t, 'phi', k), eta = M(t, 'eta', k);
    return [`Φ <b>${phi.toFixed(2)}</b>`, `noise η <b>${eta.toFixed(2)}</b> rad`];
  },
  slowing(x, w, h, t, tf) {
    const sh = firstEv(t, 'aftershock') || firstEv(t, 'gust') || firstEv(t, 'current'); const k = Math.floor(tf);
    const t0 = sh ? Math.max(0, sh.t - 30) : Math.max(0, k - 120), t1 = sh ? Math.min(t.T - 1, sh.t + 200) : k;
    const X0 = 6, Y0 = 8, W = w - 12, H = h - 22;
    const base = (() => { let s = 0, n = 0; for (let i = t0; i < (sh ? sh.t : t0 + 10); i++) { s += M(t, 'phiL', i); n++; } return n ? s / n : .7; })();
    // recovery time τ: first tick after the shock where local order is back within 90 % of before
    let tau = -1; if (sh) { let low = 9; for (let i = sh.t; i < t.T; i++) { const v = M(t, 'phiL', i); low = Math.min(low, v); if (i > sh.t + 4 && v > base * .9 && low < base * .9) { tau = (i - sh.t) * t.dt; break; } } }
    x.strokeStyle = 'rgba(220,214,236,.18)'; x.beginPath(); const yb = Y0 + H - base * H; x.moveTo(X0, yb); x.lineTo(X0 + W, yb); x.stroke();
    const kk = Math.min(k, t1); spark(x, t, 'phiL', t0, Math.max(t0 + 1, kk), X0, Y0, W * (Math.max(t0 + 1, kk) - t0) / Math.max(1, t1 - t0), H, 0, 1, C.teal, 1.8);
    if (sh) { const sx = X0 + (sh.t - t0) / (t1 - t0) * W; x.strokeStyle = 'rgba(240,138,126,.7)'; x.beginPath(); x.moveTo(sx, Y0); x.lineTo(sx, Y0 + H); x.stroke(); label(x, sh.type === 'gust' ? 'gust' : sh.type === 'current' ? 'current' : 'aftershock', sx + 4, Y0 + 10, 'rgba(240,138,126,.85)');
      if (tau > 0 && k >= sh.t + tau / t.dt) { const ex = X0 + (sh.t + tau / t.dt - t0) / (t1 - t0) * W; x.strokeStyle = C.heat; x.beginPath(); x.moveTo(sx, Y0 + H - 4); x.lineTo(ex, Y0 + H - 4); x.stroke(); label(x, 'τ', (sx + ex) / 2, Y0 + H - 7, C.heat, 'center', 11); } }
    return [`local order <b>${M(t, 'phiL', k).toFixed(2)}</b>`, tau > 0 && sh && k >= sh.t + tau / t.dt ? `recovered in <b>${fmtS(tau)}</b>` : sh && k >= sh.t ? 'recovering' : 'steady'];
  },
  symmetry(x, w, h, t, tf) {
    const k = Math.floor(tf), a = M(t, 'teamA', k), b = M(t, 'teamB', k), c = M(t, 'teamC', k);
    const teams = [a, b, c].filter((v, i) => i < Math.max(2, t.aux.list.filter((q) => q.kind === 'ugv').length));
    const tot = Math.max(1, t.N);
    const X0 = 10, W = w - 20, rh = Math.min(24, (h - 8) / teams.length), bh = Math.min(10, rh * .45); let y = 4 + (h - 8 - rh * teams.length) / 2;
    teams.forEach((v, i) => {
      const yc = y + rh / 2;
      label(x, `ground robot ${i + 1}`, X0, yc + 4, C.apr, 'left', 10.5);
      const bw = (W - 112) * (v / tot); x.fillStyle = 'rgba(246,210,177,.14)'; x.fillRect(X0 + 92, yc - bh / 2, W - 112, bh); x.fillStyle = C.teal; x.fillRect(X0 + 92, yc - bh / 2, bw, bh);
      for (let q = 0; q < v; q++) { x.fillStyle = 'rgba(30,33,64,.6)'; x.fillRect(X0 + 92 + (q + 1) * (W - 112) / tot - .5, yc - bh / 2, 1, bh); }
      label(x, String(v), X0 + 96 + bw, yc + 4, C.paper, 'left', 10.5, C.mono);
      y += rh;
    });
    return [`teams <b>${teams.join(' · ')}</b>`, `commands sent <b>0</b>`];
  },
  turing(x, w, h, t, tf, ex) {
    const F = t.field; const k = Math.floor(tf); if (!F || !F.snaps.length) { label(x, 'no field yet', w / 2, h / 2, C.faint, 'center'); return ['', '']; }
    let s = F.snaps[0]; for (const q of F.snaps) { if (q.t <= k) s = q; else break; }
    const img = ex.fieldImg || (ex.fieldImg = { c: document.createElement('canvas') }); img.c.width = F.w; img.c.height = F.h; const ic = img.c.getContext('2d'); const id = ic.createImageData(F.w, F.h);
    for (let i = 0; i < F.w * F.h; i++) { const v = s.data[i] / 255; const o = i * 4; id.data[o] = 30 + v * 225; id.data[o + 1] = 33 + v * 162; id.data[o + 2] = 64 + v * 43; id.data[o + 3] = 255; }
    ic.putImageData(id, 0, 0); x.imageSmoothingEnabled = true;
    const X0 = 6, Y0 = 6, W = w - 12, H = h - 12; x.save(); x.beginPath(); x.roundRect(X0, Y0, W, H, 8); x.clip(); x.drawImage(img.c, X0, Y0, W, H);
    // drones on the field
    const fr = s.frame; for (let i = 0; i < t.N; i++) { const o = (k * t.N + i) * t.DR, D = t.drones; if (D[o + 4] !== ST.FRONT) continue; const dx = D[o] - fr.ox, dz = D[o + 2] - fr.oz; const u = (dx * fr.ux + dz * fr.uz) / fr.su / F.w, vv = (dx * fr.vx + dz * fr.vz) / fr.sv / F.h; if (u < 0 || u > 1 || vv < 0 || vv > 1) continue; x.fillStyle = C.teal; x.beginPath(); x.arc(X0 + u * W, Y0 + vv * H, 3, 0, 7); x.fill(); }
    x.restore();
    return [`spacing CV <b>${M(t, 'cv', k).toFixed(2)}</b>`, M(t, 'cv', k) < .3 ? 'even lanes' : 'settling'];
  },
  phase(x, w, h, t, tf) {
    const k = Math.floor(tf), hh = M(t, 'h', k), mx = M(t, 'x', k);
    const X0 = 10, W = w - 20, Y0 = 8, H = h - 24;
    const xs = (v) => X0 + (v + 1.7) / 3.4 * W; let lo = 1e9, hi = -1e9; for (let v = -1.7; v <= 1.7; v += .05) { const y = landscape(v, hh); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    hi = Math.max(hi, lo + .6); const ys = (y) => Y0 + (y - lo) / (hi - lo) * H * .9 + H * .08;
    x.beginPath(); for (let v = -1.7; v <= 1.7; v += .04) { const px = xs(v), py = ys(landscape(v, hh)); v <= -1.69 ? x.moveTo(px, py) : x.lineTo(px, py); }
    x.strokeStyle = 'rgba(220,214,236,.65)'; x.lineWidth = 1.6; x.stroke();
    label(x, 'search', xs(-1), h - 4, C.faint, 'center'); label(x, 'converge', xs(1), h - 4, C.faint, 'center');
    const my = ys(landscape(mx, hh)); x.fillStyle = mx > 0 ? C.heat : C.teal; x.beginPath(); x.arc(xs(mx), my - 5, 5, 0, 7); x.fill();
    const pct = Math.min(1, Math.abs(hh) / HC);
    return [`signal h <b>${hh.toFixed(2)}</b> <span style="opacity:.6">/ tips at ${HC.toFixed(2)}</span>`, mx > 0 ? '<b style="color:#FFC36B">converge</b>' : pct > .7 ? 'tilting' : 'search'];
  },
  stigmergy(x, w, h, t, tf) {
    const k = Math.floor(tf), ms = t.marks.filter((m) => m.t <= k);
    const X0 = 8, W = w - 16, Y0 = 10, H = h - 26;
    // marks dropped over time (a rising staircase), each a small violet tick
    const span = Math.max(1, k); x.strokeStyle = 'rgba(167,139,255,.9)'; x.lineWidth = 1.6; x.beginPath(); x.moveTo(X0, Y0 + H);
    ms.forEach((m, i) => { const px = X0 + m.t / span * W, py = Y0 + H - (i + 1) / Math.max(10, t.marks.length) * H; x.lineTo(px, x.__py ?? Y0 + H); x.lineTo(px, py); x.__py = py; }); x.__py = undefined; x.lineTo(X0 + W, Y0 + H - ms.length / Math.max(10, t.marks.length) * H); x.stroke();
    for (const m of ms.slice(-14)) { const px = X0 + m.t / span * W; x.fillStyle = 'rgba(167,139,255,.9)'; x.fillRect(px - .5, Y0 + H + 3, 1, 5); }
    const rep = t.report.repeatsAvoided || 0, frac = Math.min(1, k / Math.max(1, t.report && t.T));
    const kind = t.marks[0]?.kind; const what = kind === 'rfid' ? 'RFID tags at junctions' : kind === 'uv' ? 'UV, visible to rescuers too' : 'left on the world';
    return [`marks <b>${ms.length}</b>`, rep >= 5 ? `repeats avoided <b>${Math.round(rep * frac)}</b>` : what];
  },
  crdt(x, w, h, t, tf) {
    const k = Math.floor(tf), a = Math.max(0, k - 160);
    const X0 = 6, Y0 = 8, W = w - 12, H = h - 22;
    spark(x, t, 'inRange', a, k, X0, Y0, W, H, 0, 1, null, 1, 'rgba(143,140,196,.22)');
    spark(x, t, 'agree', a, k, X0, Y0, W, H, .5, 1, C.teal, 1.8);
    // reconnect merges as white ticks
    for (const e of t.events) { if (e.type !== 'merge' || e.t < a || e.t > k) continue; const px = X0 + (e.t - a) / Math.max(1, k - a) * W; x.fillStyle = 'rgba(243,238,242,.85)'; x.fillRect(px - .5, Y0, 1, H); }
    label(x, 'maps agree', X0 + 2, Y0 + 10, C.teal); label(x, 'in range', X0 + W - 2, Y0 + H - 3, 'rgba(143,140,196,.9)', 'right');
    const ag = M(t, 'agree', k), kb = M(t, 'bytes', k) / 1000;
    return [`maps agree <b>${(ag * 100).toFixed(1)}%</b>`, `<b>${kb.toFixed(2)}</b> kB/s per drone`];
  },
  topology(x, w, h, t, tf) {
    const k = Math.floor(tf), L = t.layers;
    const X0 = 8, W = w - 16, Y0 = 8, H = h - 22;
    // β0 per layer as small step plots, shared time axis
    // the layers that held the most unsearched pockets over the mission (fixed rows, so nothing jumps), the rest summed
    if (!t.__topo) { const sc = L.map((l, i) => { let s = 0; for (const v of t.beta0L[i]) s += v; return { i, s }; }).filter((r) => r.s > 0).sort((a, b) => b.s - a.s);
      const top = sc.slice(0, sc.length > 4 ? 3 : 4).map((r) => r.i).sort((a, b) => a - b), rest = sc.slice(top.length).map((r) => r.i);
      t.__topo = { top, rest, max: top.map((i) => Math.max(1, ...t.beta0L[i])), restMax: 1 };
      if (rest.length) { let m = 1; for (let q = 0; q < t.T; q++) { let s = 0; for (const i of rest) s += t.beta0L[i][q]; m = Math.max(m, s); } t.__topo.restMax = m; } }
    const TP = t.__topo, kq = Math.max(0, Math.min(t.T - 1, k));
    const rows = TP.top.map((i, j) => ({ l: L[i], m: t.beta0L[i], cur: t.beta0L[i][kq], max: TP.max[j] }));
    if (TP.rest.length) { const m = (q) => { let s = 0; for (const i of TP.rest) s += t.beta0L[i][q]; return s; }; rows.push({ l: { name: `${TP.rest.length} more` }, m: { length: t.T, fn: m }, cur: m(kq), max: TP.restMax }); }
    const rh = H / Math.max(1, rows.length);
    rows.forEach((r, j) => { const y0 = Y0 + j * rh; const m = r.m, get = m.fn || ((q) => m[q]); x.strokeStyle = r.cur ? C.lav : C.teal; x.lineWidth = 1.4; x.beginPath();
      for (let q = 0; q <= k; q += 2) { const px = X0 + 76 + q / Math.max(1, t.T - 1) * (W - 100), py = y0 + rh - 3 - (get(q) / r.max) * (rh - 6); q === 0 ? x.moveTo(px, py) : x.lineTo(px, py); } x.stroke();
      label(x, shortLayer(r.l.name || r.l.id), X0, y0 + rh / 2 + 4, C.faint, 'left', 10.5);
      label(x, String(r.cur), X0 + W, y0 + rh / 2 + 4, r.cur ? C.lav : C.teal, 'right', 11, C.mono); });
    const b = M(t, 'beta0', k);
    return [`β₀ = <b>${b}</b> unsearched pocket${b === 1 ? '' : 's'}`, `searched <b>${(M(t, 'coverage', k) * 100).toFixed(0)}%</b>`];
  },
  pocket(x, w, h, t, tf) {
    const k = Math.floor(tf); const p = t.pockets.find((q) => q.t >= 0 && q.t <= k) || t.pockets.find((q) => q.t >= 0);
    if (!p) { label(x, 'no sealed void yet', w / 2, h / 2, C.faint, 'center'); return ['', '']; }
    const L = t.layers.find((l) => l.id === p.layer); const all = [...(p.encl || []), ...p.cells];
    let i0 = 1e9, i1 = -1e9, k0 = 1e9, k1 = -1e9; for (const c of all) { const i = c % L.nx, kk = (c / L.nx) | 0; i0 = Math.min(i0, i); i1 = Math.max(i1, i); k0 = Math.min(k0, kk); k1 = Math.max(k1, kk); }
    i0 -= 3; k0 -= 3; i1 += 3; k1 += 3; const cs = Math.min((w - 20) / (i1 - i0 + 1), (h - 16) / (k1 - k0 + 1)); const ox = (w - cs * (i1 - i0 + 1)) / 2, oy = (h - cs * (k1 - k0 + 1)) / 2;
    for (let kk = k0; kk <= k1; kk++) for (let i = i0; i <= i1; i++) { if (i < 0 || kk < 0 || i >= L.nx || kk >= L.nz) continue; const c = kk * L.nx + i; const ty = L.grid[c], seen = L.firstSeen[c] <= k;
      x.fillStyle = ty === 1 ? (seen ? 'rgba(239,177,180,.55)' : 'rgba(220,214,236,.12)') : ty === 2 ? 'rgba(0,0,0,0)' : seen ? 'rgba(127,212,207,.5)' : 'rgba(30,33,64,.8)'; x.fillRect(ox + (i - i0) * cs, oy + (kk - k0) * cs, cs - .6, cs - .6); }
    const set = new Set(p.cells); x.strokeStyle = C.lav; x.lineWidth = 1.6;
    for (const c of p.cells) { const i = c % L.nx, kk = (c / L.nx) | 0, X = ox + (i - i0) * cs, Y = oy + (kk - k0) * cs; x.beginPath();
      if (!set.has(c - 1)) { x.moveTo(X, Y); x.lineTo(X, Y + cs); } if (!set.has(c + 1)) { x.moveTo(X + cs, Y); x.lineTo(X + cs, Y + cs); } if (!set.has(c - L.nx)) { x.moveTo(X, Y); x.lineTo(X + cs, Y); } if (!set.has(c + L.nx)) { x.moveTo(X, Y + cs); x.lineTo(X + cs, Y + cs); } x.stroke(); }
    return [`${p.name ? 'air pocket' : 'pocket'} <b>${p.volume >= 100 ? Math.round(p.volume).toLocaleString('en') : p.volume.toFixed(1)} m³</b>, sealed`, `β₂ = <b>${t.pockets.filter((q) => q.t >= 0 && q.t <= k).length}</b>`];
  },
  koopman(x, w, h, t, tf) {
    const k = Math.floor(tf), F = t.forecast; if (!F.length) return ['', ''];
    const X0 = 6, Y0 = 8, W = w - 12, H = h - 22, T = t.T - 1;
    spark(x, t, 'coverage', 0, Math.max(1, k), X0, Y0, W * Math.max(1, k) / T, H, 0, 1, C.teal, 1.8);
    // each forecast: a ghost dot where it said the coverage would be, one horizon later
    let err = null; x.fillStyle = 'rgba(246,210,177,.85)';
    for (const f of F) { if (f.t0 > k) break; const px = X0 + (f.t0 + f.horizon) / T * W, py = Y0 + H - f.pred * H; x.globalAlpha = f.t0 + f.horizon <= k ? .35 : .95; x.beginPath(); x.arc(px, py, 2, 0, 7); x.fill(); if (f.t0 + f.horizon <= k) err = Math.abs(f.pred - f.actual); }
    x.globalAlpha = 1; label(x, 'searched', X0 + 2, Y0 + 10, C.teal); label(x, 'forecast', X0 + W - 2, Y0 + 10, C.apr, 'right');
    const last = [...F].reverse().find((f) => f.t0 <= k);
    return [last ? `in ${fmtS(last.horizon * t.dt)}: <b>${(last.pred * 100).toFixed(0)}%</b>` : 'learning', err != null ? `error <b>${(err * 100).toFixed(0)} pts</b>` : ''];
  },
  reservoir(x, w, h, t, tf) {
    const k = Math.floor(tf), a = Math.max(0, k - 120); const X0 = 6, Y0 = 8, W = w - 12, H = h - 22;
    let mx = .3; for (let i = 0; i < t.T; i += 3) mx = Math.max(mx, M(t, 'readout', i));
    x.strokeStyle = 'rgba(240,138,126,.45)'; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(X0, Y0 + H * .35); x.lineTo(X0 + W, Y0 + H * .35); x.stroke(); x.setLineDash([]);
    spark(x, t, 'readout', a, k, X0, Y0, W, H, 0, mx, C.heat, 1.6);
    const v = M(t, 'readout', k);
    return [`readout <b>${v.toFixed(2)}</b>`, v / mx > .6 ? '<b style="color:#F08A7E">shake sensed</b>' : 'calm'];
  },
  fpga(x, w, h, t, tf) {
    // the collective layer as fixed hardware: identical blocks every tick; a CPU's jittery times for contrast
    const k = Math.floor(tf), X0 = 8, W = w - 16;
    const blocks = [['order Φ', 96, C.teal], ['merge', 640, C.haze], ['β₀', 1024, C.lav], ['DMD', 384, C.apr]], tot = blocks.reduce((a, b) => a + b[1], 0);
    for (let r = 0; r < 3; r++) { let xx = X0; const y = 10 + r * 16; for (const [n, c, col] of blocks) { const bw = c / tot * (W * .62); x.fillStyle = col; x.globalAlpha = .75; x.fillRect(xx, y, bw - 1.5, 11); xx += bw; } x.globalAlpha = 1; label(x, `tick ${k - 2 + r}`, X0 + W * .64, y + 9, C.faint, 'left', 10, C.mono); }
    label(x, 'CPU, same work:', X0, h - 22, C.faint, 'left', 10);
    let xx = X0; for (let r = 0; r < 6; r++) { const j = .7 + .6 * Math.abs(Math.sin((k + r) * 12.9898) * 43758.5 % 1); const bw = j * W / 8; x.fillStyle = 'rgba(220,214,236,.25)'; x.fillRect(xx, h - 16, bw - 2, 8); xx += bw; }
    return [`<b>${tot.toLocaleString('en')}</b> cycles per tick`, 'every tick'];
  },
};
const short = (s) => (s.length > 13 ? s.slice(0, 12) + '…' : s);
// "Building A, second floor" -> "A · 2nd floor"; "Streets and courtyards" -> "Streets"
const FLOOR = { 'ground floor': 'ground', 'first floor': '1st floor', 'second floor': '2nd floor', 'third floor': '3rd floor', 'fourth floor': '4th floor', 'fifth floor': '5th floor', 'crawl space': 'crawl space' };
function shortLayer(s) {
  const m = /^Building\s+(\w+),\s*(.+)$/i.exec(s); if (m) return short(`${m[1]} · ${FLOOR[m[2].toLowerCase()] || m[2]}`);
  const c = s.split(/,| and /)[0].trim(); return short(c.charAt(0).toUpperCase() + c.slice(1));
}

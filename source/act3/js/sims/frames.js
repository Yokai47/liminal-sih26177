// How the two brains talk: MAVROS2. Top: the ROS 2 programs on the Pi pass messages along a chain, and only one thing
// crosses to the flight controller over MAVLink: a setpoint, "go to (x, y, z)". Bottom: what that setpoint does.
// ROS 2 speaks ENU (x East, y North, z Up); ArduPilot speaks NED (x North, y East, z Down). Convert, and the drone goes
// 1 m north and climbs 1 m. Forget, and the same three numbers mean 1 m east and 1 m DOWN.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const A = { teal: '127,212,207', rose: '239,177,180', danger: '240,138,126', heat: '255,195,107', haze: '143,140,196', ink: '243,238,242', apricot: '246,210,177' };
  const rgba = (k, a) => `rgba(${A[k]},${a})`;

  let convert = true;
  kit.toggle(controls, { label: 'MAVROS2 frame conversion', options: [{ v: 1, label: 'Correct (ENU → NED)' }, { v: 0, label: 'Wrong frame (bypassing MAVROS2)' }], value: 1, onChange: (v) => { convert = !!v; send(); } });
  kit.button(controls, { label: 'Send setpoint', kind: 'primary', onClick: () => send() });
  const rWent = kit.readout(readouts, { label: 'where it actually went (m)', tone: 'teal' });
  const rRate = kit.readout(readouts, { label: 'setpoints / s over the link', tone: 'ink' });
  const rAge = kit.readout(readouts, { label: 'setpoint age', tone: 'ink' });

  // ------------------------------------------------------------------ layout (recomputed only on resize)
  const NODES = [
    { a: 'LiDAR driver', b: 'LiDAR', sub: 'laser scans' },
    { a: 'SLAM', b: 'SLAM', sub: '“I am here”' },
    { a: 'OctoMap', b: 'OctoMap', sub: '3-D map' },
    { a: 'Frontier picker', b: 'Frontier', sub: 'next goal' },
    { a: 'Nav2', b: 'Nav2', sub: 'safe path' },
    { a: 'MAVROS2 bridge', b: 'MAVROS2', sub: '' },
  ];
  function poly(arr) {
    const n = arr.length / 2, cum = new Float32Array(n); let len = 0;
    for (let i = 1; i < n; i++) { len += Math.hypot(arr[2 * i] - arr[2 * i - 2], arr[2 * i + 1] - arr[2 * i - 1]); cum[i] = len; }
    return { pts: Float32Array.from(arr), cum, len, n };
  }
  const P = { x: 0, y: 0 };
  function at(pl, s) {
    const d = clamp(s, 0, 1) * pl.len; let i = 1;
    while (i < pl.n - 1 && pl.cum[i] < d) i++;
    const seg = (pl.cum[i] - pl.cum[i - 1]) || 1, u = (d - pl.cum[i - 1]) / seg;
    P.x = pl.pts[2 * i - 2] + (pl.pts[2 * i] - pl.pts[2 * i - 2]) * u; P.y = pl.pts[2 * i - 1] + (pl.pts[2 * i + 1] - pl.pts[2 * i - 1]) * u; return P;
  }
  let L = null;
  function layout() {
    const w = cv.w, h = cv.h, nar = w < 640;
    const insetW = nar ? 140 : 252, pad = nar ? 10 : 20;
    const o = { nar, nodes: [], edges: [] };
    const fs = nar ? 10.5 : 12;
    o.fs = fs;
    if (!nar) {
      const box = { x: pad, y: 16, w: w - insetW - pad - 10, h: 106 };
      o.box = box;
      const nw = Math.min(104, (box.w - 32 - 5 * 30) / 6), nh = 38, gap = (box.w - 32 - 6 * nw) / 5, cy = box.y + 60;
      ctx.font = `500 ${fs}px ${F.sans}`;
      NODES.forEach((nd, i) => {
        const x = box.x + 16 + i * (nw + gap);
        const lines = ctx.measureText(nd.a).width > nw - 12 ? nd.a.split(' ') : [nd.a];
        o.nodes.push({ x, y: cy - nh / 2, w: nw, h: nh, cx: x + nw / 2, cy, lines, sub: nd.sub });
      });
      for (let i = 0; i < 5; i++) { const a = o.nodes[i], b = o.nodes[i + 1]; o.edges.push(poly([a.x + a.w, a.cy, b.x, b.cy])); }
      const mav = o.nodes[5], linkY = Math.max(box.y + box.h + 80, 214);
      o.fc = { x: w - pad - 188, y: linkY - 25, w: 188, h: 50 };
      o.edges.push(poly([mav.cx, mav.y + mav.h, mav.cx, linkY, o.fc.x, linkY]));
      o.linkY = linkY; o.pill = { x: (mav.cx + o.fc.x) / 2, y: linkY };
      const y0 = linkY + 44, bh = h - y0 - 16;
      const s = Math.max(120, Math.min(bh, (w - 2 * pad) * 0.34));
      o.top = { x: pad, y: y0, w: s, h: bh };
      o.hgt = { x: pad + s + 14, y: y0, w: Math.min(124, (w - 2 * pad) * 0.12), h: bh };
      o.frm = { x: o.hgt.x + o.hgt.w + 14, y: y0, w: w - pad - (o.hgt.x + o.hgt.w + 14), h: bh };
    } else {
      const box = { x: pad, y: 8, w: w - insetW - pad - 6, h: 102 };
      o.box = box;
      const nw = (box.w - 16 - 2 * 16) / 3, nh = 22;
      for (let i = 0; i < 6; i++) {
        const r = i < 3 ? 0 : 1, c = i % 3, x = box.x + 8 + c * (nw + 16), cy = box.y + 38 + r * 40;
        o.nodes.push({ x, y: cy - nh / 2, w: nw, h: nh, cx: x + nw / 2, cy, lines: [NODES[i].b], sub: '' });
      }
      const N = o.nodes;
      for (let i = 0; i < 5; i++) {
        const a = N[i], b = N[i + 1];
        if (i === 2) { const my = (a.y + a.h + b.y) / 2; o.edges.push(poly([a.cx, a.y + a.h, a.cx, my, b.cx, my, b.cx, b.y])); }
        else o.edges.push(poly([a.x + a.w, a.cy, b.x, b.cy]));
      }
      const mav = N[5], linkY = box.y + box.h + 26;
      o.fc = { x: w - pad - 86, y: linkY - 17, w: 86, h: 34 };
      o.edges.push(poly([mav.cx, mav.y + mav.h, mav.cx, linkY, o.fc.x, linkY]));
      o.linkY = linkY; o.pill = { x: (mav.cx + o.fc.x) / 2, y: linkY };
      const y0 = linkY + 30, bh = h - y0 - 8;
      const s = Math.min(bh, 150);
      o.top = { x: pad, y: y0, w: s, h: bh };
      o.hgt = { x: pad + s + 8, y: y0, w: 46, h: bh };
      o.frm = { x: o.hgt.x + o.hgt.w + 8, y: y0, w: w - pad - (o.hgt.x + o.hgt.w + 8), h: bh };
    }
    L = o;
  }
  cv.onResize(layout); layout();

  // ------------------------------------------------------------------ messages flowing inside the Pi, setpoints over the link
  const RATE = [7, 5, 2, 1.2, 20];      // packets drawn per second on each Pi edge (scans fastest, goals rarely)
  const DUR = [0.5, 0.5, 0.55, 0.55, 0.32, 0.6]; // seconds to travel each edge; the last is the MAVLink link
  const COL = [C.apricot, C.apricot, C.haze, C.haze, C.heat, C.heat];
  const NP = 80, pk = []; for (let i = 0; i < NP; i++) pk.push({ on: false, e: 0, s: 0 });
  const acc = new Float32Array(5);
  const arrivals = new Float64Array(64); let ai = 0;
  let T = 0, lastArrive = -1;
  function spawn(e) { for (const p of pk) if (!p.on) { p.on = true; p.e = e; p.s = 0; return; } }

  // the one command the judge sends: "go 1 m North and climb 1 m", as an offset from where the drone is
  const ENU = [0, 1, 1];
  const cmd = { on: false, stage: 0, s: 0, hold: 0 };
  // drone state (metres, relative to the start point; u = height above the floor)
  const START_U = 1.5;
  const d = { n: 0, e: 0, u: START_U, vn: 0, ve: 0, vu: 0, tn: 0, te: 0, tu: START_U, arrived: false, sentConvert: true, fade: 1 };
  const TR = 300, trail = new Float32Array(TR * 3); let tn = 0, trailT = 0;
  function send() {
    d.n = d.e = 0; d.u = START_U; d.vn = d.ve = d.vu = 0; d.tn = 0; d.te = 0; d.tu = START_U; d.arrived = false; d.fade = 0;
    d.sentConvert = convert; tn = 0;
    cmd.on = true; cmd.stage = 3; cmd.s = 0; cmd.hold = 0;
  }
  function fcReceives() {
    // the flight controller reads the three numbers as NED: x = North, y = East, z = Down
    const ned = d.sentConvert ? [ENU[1], ENU[0], -ENU[2]] : [ENU[0], ENU[1], ENU[2]];
    d.tn = ned[0]; d.te = ned[1]; d.tu = START_U - ned[2]; d.arrived = true;
  }

  function step(dt) {
    T += dt;
    for (let e = 0; e < 5; e++) { acc[e] += dt * RATE[e]; while (acc[e] >= 1) { acc[e] -= 1; spawn(e); } }
    for (const p of pk) {
      if (!p.on) continue;
      p.s += dt / DUR[p.e];
      if (p.s >= 1) {
        if (p.e === 4) { p.e = 5; p.s = 0; }                     // Nav2's setpoint reaches MAVROS2 and goes out on MAVLink
        else if (p.e === 5) { p.on = false; lastArrive = T; arrivals[ai] = T; ai = (ai + 1) % arrivals.length; }
        else p.on = false;
      }
    }
    if (cmd.on) {
      if (cmd.stage === 3 || cmd.stage === 4) { cmd.s += dt / 0.45; if (cmd.s >= 1) { cmd.s = 0; cmd.stage++; } }
      else if (cmd.stage === 5) { cmd.hold += dt; if (cmd.hold > 0.8) { cmd.stage = 6; cmd.s = 0; } }
      else if (cmd.stage === 6) { cmd.s += dt / 0.9; if (cmd.s >= 1) { cmd.on = false; cmd.flash = T; fcReceives(); } }
    }
    // the flight controller flies to its target with a critically damped response
    const k = 5, c = 2 * Math.sqrt(k);
    d.vn += (k * (d.tn - d.n) - c * d.vn) * dt; d.ve += (k * (d.te - d.e) - c * d.ve) * dt; d.vu += (k * (d.tu - d.u) - c * d.vu) * dt;
    d.n += d.vn * dt; d.e += d.ve * dt; d.u += d.vu * dt;
    d.fade = Math.min(1, d.fade + dt * 4);
    trailT += dt;
    if (d.arrived && trailT > 0.03 && tn < TR) { trailT = 0; trail[tn * 3] = d.n; trail[tn * 3 + 1] = d.e; trail[tn * 3 + 2] = d.u; tn++; }
  }

  // ------------------------------------------------------------------ drawing helpers
  function arrow(x1, y1, x2, y2, col, lw = 2, head = 7) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - head * Math.cos(a - .42), y2 - head * Math.sin(a - .42)); ctx.lineTo(x2 - head * Math.cos(a + .42), y2 - head * Math.sin(a + .42)); ctx.closePath(); ctx.fill();
  }
  function strokePoly(pl) { ctx.beginPath(); for (let i = 0; i < pl.n; i++) i ? ctx.lineTo(pl.pts[2 * i], pl.pts[2 * i + 1]) : ctx.moveTo(pl.pts[0], pl.pts[1]); ctx.stroke(); }
  const wrapCache = new Map();
  function wrap(s, maxW, font) {
    const key = s + '|' + Math.round(maxW) + '|' + font; let v = wrapCache.get(key); if (v) return v;
    if (wrapCache.size > 120) wrapCache.clear();
    ctx.font = font; const out = []; let cur = '';
    for (const wd of s.split(' ')) { const t = cur ? cur + ' ' + wd : wd; if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = wd; } else cur = t; }
    if (cur) out.push(cur); wrapCache.set(key, out); return out;
  }
  function quadTop(x, y, r, col, alpha = 1) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
    ctx.lineWidth = 1.4; for (const sx of [-1, 1]) for (const sy of [-1, 1]) { ctx.beginPath(); ctx.arc(x + sx * r, y + sy * r, r * .55, 0, 7); ctx.stroke(); }
    ctx.fillStyle = col; ctx.fillRect(x - 3, y - 3, 6, 6); ctx.globalAlpha = 1;
  }
  // a small 3-D axis gizmo in an oblique view: East points right, North points into the page (up-right), Up points up
  const DIR = { E: [1, 0], N: [.62, -.52], U: [0, -1], D: [0, 1] };
  const AX = { x: C.rose, y: C.teal, z: C.apricot };
  function gizmo(cx, cy, len, axes, fs) {
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, 7); ctx.fill();
    for (const [name, dir, word] of axes) {
      const [dx, dy] = DIR[dir], ex = cx + dx * len, ey = cy + dy * len;
      arrow(cx, cy, ex, ey, AX[name], 2, 6);
      const lx = ex + dx * 8 + (dir === 'U' || dir === 'D' ? 6 : 0), ly = ey + dy * 8 + (dir === 'D' ? 6 : dir === 'E' ? 4 : 0);
      text(ctx, name, lx, ly, { size: fs + 1, color: AX[name], font: F.mono, weight: 600, align: 'left', base: 'middle' });
      text(ctx, word, lx + fs * .8, ly, { size: fs, color: C.muted, align: 'left', base: 'middle' });
    }
  }
  const fmt = (v) => (v > 0.04 ? '+' : v < -0.04 ? '−' : '') + Math.abs(v).toFixed(0);

  // ------------------------------------------------------------------ draw
  function draw() {
    const w = cv.w, h = cv.h, nar = L.nar, fs = L.fs; cv.clear();
    const box = L.box, N = L.nodes;
    // the Pi
    ctx.fillStyle = 'rgba(36,40,77,.75)'; roundRect(ctx, box.x, box.y, box.w, box.h, 12); ctx.fill();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke();
    text(ctx, nar ? 'Pi 5 · ROS 2 programs · ENU' : 'Raspberry Pi 5 (flight computer) · separate ROS 2 programs · they speak ENU', box.x + (nar ? 8 : 16), box.y + (nar ? 15 : 20), { size: nar ? 10.5 : 11.5, color: C.muted });
    // edges inside the Pi
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < 5; i++) strokePoly(L.edges[i]);
    // the link: MAVROS2 down to MAVLink, across to the flight controller
    const link = L.edges[5];
    ctx.strokeStyle = rgba('heat', .45); ctx.lineWidth = 2; strokePoly(link);
    // packets
    for (const p of pk) {
      if (!p.on) continue; const q = at(L.edges[p.e], p.s);
      ctx.fillStyle = COL[p.e];
      if (p.e === 5) { ctx.fillRect(q.x - 2.5, q.y - 2.5, 5, 5); } else { ctx.beginPath(); ctx.arc(q.x, q.y, 2.2, 0, 7); ctx.fill(); }
    }
    // nodes
    N.forEach((n, i) => {
      const hot = cmd.on && ((cmd.stage === 3 && i === 3) || (cmd.stage === 4 && i === 4) || (cmd.stage === 5 && i === 5));
      ctx.fillStyle = hot ? rgba('heat', .18) : C.bg; roundRect(ctx, n.x, n.y, n.w, n.h, nar ? 6 : 9); ctx.fill();
      ctx.strokeStyle = hot ? C.heat : (i === 5 ? rgba('heat', .6) : 'rgba(220,214,236,.32)'); ctx.lineWidth = hot ? 1.8 : 1.2; ctx.stroke();
      const lh = fs + 2, y0 = n.cy - (n.lines.length - 1) * lh / 2;
      n.lines.forEach((ln, j) => text(ctx, ln, n.cx, y0 + j * lh, { size: fs, color: C.ink, weight: 500, align: 'center', base: 'middle' }));
      if (n.sub) text(ctx, n.sub, n.cx, n.y + n.h + 14, { size: 10.5, color: C.faint, align: 'center' });
    });
    // MAVLink pill on the wire and the flight controller box
    const pw = nar ? 54 : 70, ph = nar ? 18 : 22;
    ctx.fillStyle = C.bg; roundRect(ctx, L.pill.x - pw / 2, L.pill.y - ph / 2, pw, ph, ph / 2); ctx.fill();
    ctx.strokeStyle = rgba('heat', .7); ctx.lineWidth = 1.2; ctx.stroke();
    text(ctx, 'MAVLink', L.pill.x, L.pill.y + .5, { size: nar ? 10 : 11.5, color: C.heat, weight: 500, align: 'center', base: 'middle' });
    const fc = L.fc, fl = cmd.flash !== undefined ? Math.max(0, 1 - (T - cmd.flash) / 0.8) : 0;
    ctx.fillStyle = fl > 0 ? rgba('heat', .12 + .2 * fl) : 'rgba(36,40,77,.85)'; roundRect(ctx, fc.x, fc.y, fc.w, fc.h, nar ? 8 : 12); ctx.fill();
    ctx.strokeStyle = rgba('heat', .55 + .45 * fl); ctx.lineWidth = 1.3; ctx.stroke();
    if (nar) { text(ctx, 'Flight ctrl', fc.x + fc.w / 2, fc.y + 13, { size: 10.5, color: C.ink, weight: 500, align: 'center', base: 'middle' }); text(ctx, 'speaks NED', fc.x + fc.w / 2, fc.y + 25, { size: 9.5, color: C.faint, align: 'center', base: 'middle' }); }
    else { text(ctx, 'Flight controller', fc.x + 14, fc.y + 20, { size: 12.5, color: C.ink, weight: 500 }); text(ctx, 'CUAV V6X · ArduPilot · NED', fc.x + 14, fc.y + 37, { size: 10.5, color: C.faint }); }
    if (!nar) {
      text(ctx, 'SET_POSITION_TARGET_LOCAL_NED', fc.x - 10, L.linkY + 19, { size: 10, color: C.faint, font: F.mono, align: 'right' });
      text(ctx, 'Inside the Pi, programs pass messages to each other many times a second.', box.x + 4, box.y + box.h + 34, { size: 12, color: C.muted });
      text(ctx, 'Only one thing crosses to the flight controller: a setpoint, “go to (x, y, z)”.', box.x + 4, box.y + box.h + 56, { size: 12, color: C.heat });
    } else {
      text(ctx, 'position + setpoint cross →', N[5].cx - 8, L.linkY + 4, { size: 10.5, color: C.heat, align: 'right' });
    }
    // conversion flash at MAVROS2 and the command pill
    if (cmd.on && cmd.stage === 5) {
      const n = N[5], k = cmd.hold / 0.8, col = d.sentConvert ? 'teal' : 'danger';
      ctx.strokeStyle = rgba(col, 1 - k); ctx.lineWidth = 2; roundRect(ctx, n.x - 6 * k - 2, n.y - 6 * k - 2, n.w + 12 * k + 4, n.h + 12 * k + 4, 10); ctx.stroke();
    }
    if (cmd.on) {
      let q;
      if (cmd.stage === 3) q = at(L.edges[3], cmd.s); else if (cmd.stage === 4) q = at(L.edges[4], cmd.s);
      else if (cmd.stage === 5) { P.x = N[5].cx; P.y = N[5].cy; q = P; } else q = at(link, cmd.s);
      const after = cmd.stage >= 6 || (cmd.stage === 5 && cmd.hold > 0.4);
      const lab = !after ? `(${fmt(ENU[0])}, ${fmt(ENU[1])}, ${fmt(ENU[2])}) ENU` : d.sentConvert ? `(${fmt(ENU[1])}, ${fmt(ENU[0])}, ${fmt(-ENU[2])}) NED` : `(${fmt(ENU[0])}, ${fmt(ENU[1])}, ${fmt(ENU[2])}) as NED`;
      const fsz = nar ? 10 : 11.5; ctx.font = `600 ${fsz}px ${F.mono}`;
      const tw = ctx.measureText(lab).width + 14, th = nar ? 17 : 21;
      let px = clamp(q.x, tw / 2 + 4, w - tw / 2 - 4), py = q.y - (nar ? 16 : 22);
      if (cmd.stage === 6 && q.y >= L.linkY - 1) py = L.linkY - (nar ? 16 : 22);
      const bad = after && !d.sentConvert;
      ctx.fillStyle = bad ? C.danger : C.heat; roundRect(ctx, px - tw / 2, py - th / 2, tw, th, th / 2); ctx.fill();
      text(ctx, lab, px, py + .5, { size: fsz, color: '#1E2140', font: F.mono, weight: 600, align: 'center', base: 'middle' });
      ctx.fillStyle = bad ? C.danger : C.heat; ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, 7); ctx.fill();
    }

    drawTop(); drawHeight(); drawFrames();
  }

  function panel(r, title) {
    ctx.fillStyle = C.panel; roundRect(ctx, r.x, r.y, r.w, r.h, 10); ctx.fill();
    if (title) text(ctx, title, r.x + 10, r.y + 16, { size: L.nar ? 10 : 11, color: C.faint });
  }
  function drawTop() {
    const r = L.top, nar = L.nar; panel(r, 'top-down');
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2 + (nar ? 2 : 0), sc = Math.min(r.w, r.h - 24) / (nar ? 3.6 : 3.8); // px per metre
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let m = -1.5; m <= 1.51; m += .5) {
      ctx.beginPath(); ctx.moveTo(cx + m * sc, cy - 1.5 * sc); ctx.lineTo(cx + m * sc, cy + 1.5 * sc); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 1.5 * sc, cy + m * sc); ctx.lineTo(cx + 1.5 * sc, cy + m * sc); ctx.stroke();
    }
    // compass
    arrow(r.x + r.w - 18, r.y + (nar ? 34 : 40), r.x + r.w - 18, r.y + (nar ? 16 : 20), C.muted, 1.4, 5);
    text(ctx, 'N', r.x + r.w - 28, r.y + (nar ? 25 : 30), { size: 10.5, color: C.muted, align: 'right', base: 'middle' });
    text(ctx, '1 m', cx + sc / 2, cy + 1.5 * sc + (nar ? 17 : 22), { size: 10, color: C.faint, font: F.mono, align: 'center' });
    ctx.strokeStyle = C.faint; ctx.beginPath(); ctx.moveTo(cx, cy + 1.5 * sc + 7); ctx.lineTo(cx + sc, cy + 1.5 * sc + 7); ctx.moveTo(cx, cy + 1.5 * sc + 4); ctx.lineTo(cx, cy + 1.5 * sc + 10); ctx.moveTo(cx + sc, cy + 1.5 * sc + 4); ctx.lineTo(cx + sc, cy + 1.5 * sc + 10); ctx.stroke();
    // start, intended target, actual trail and drone
    ctx.strokeStyle = C.faint; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5); ctx.stroke();
    if (!nar) text(ctx, 'start', cx - 8, cy + 14, { size: 10.5, color: C.faint, align: 'right' });
    const ix = cx, iy = cy - 1 * sc;
    ctx.setLineDash([4, 4]); ctx.strokeStyle = C.teal; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ix, iy, nar ? 9 : 13, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    text(ctx, 'intended', ix - (nar ? 13 : 18), iy, { size: nar ? 10 : 11, color: C.teal, align: 'right', base: 'middle' });
    if (tn > 1) {
      ctx.strokeStyle = rgba('heat', .55); ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i < tn; i++) { const x = cx + trail[i * 3 + 1] * sc, y = cy - trail[i * 3] * sc; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    }
    const dx = cx + d.e * sc, dy = cy - d.n * sc;
    quadTop(dx, dy, nar ? 6 : 8, C.heat, d.fade);
    if (d.arrived && !d.sentConvert && Math.hypot(d.e, d.n) > .6) {
      text(ctx, 'actual', dx, dy + (nar ? 18 : 24), { size: nar ? 10 : 11, color: C.danger, align: 'center' });
    }
  }
  function drawHeight() {
    const r = L.hgt, nar = L.nar; panel(r, 'height');
    const top = r.y + (nar ? 30 : 36), bot = r.y + r.h - (nar ? 16 : 22), sc = (bot - top) / 3;
    const yOf = (u) => bot - u * sc, cx = r.x + r.w * (nar ? .6 : .62);
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(r.x + 6, bot); ctx.lineTo(r.x + r.w - 6, bot); ctx.stroke();
    if (!nar) text(ctx, 'floor', r.x + r.w - 8, bot + 14, { size: 10, color: C.faint, align: 'right' });
    for (let m = 0; m <= 3; m++) text(ctx, m + (nar ? '' : ' m'), r.x + 8, yOf(m), { size: 10, color: C.faint, font: F.mono, base: 'middle' });
    ctx.setLineDash([3, 4]); ctx.strokeStyle = C.faint; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(r.x + (nar ? 16 : 34), yOf(START_U)); ctx.lineTo(r.x + r.w - 6, yOf(START_U)); ctx.stroke();
    ctx.strokeStyle = C.teal; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(r.x + (nar ? 16 : 34), yOf(START_U + 1)); ctx.lineTo(r.x + r.w - 6, yOf(START_U + 1)); ctx.stroke(); ctx.setLineDash([]);
    if (!nar) { text(ctx, 'intended', r.x + r.w - 8, yOf(START_U + 1) - 6, { size: 10.5, color: C.teal, align: 'right' }); text(ctx, 'start', r.x + r.w - 8, yOf(START_U) - 6, { size: 10.5, color: C.faint, align: 'right' }); }
    const y = yOf(d.u), s = nar ? 11 : 15;
    ctx.globalAlpha = d.fade; ctx.strokeStyle = C.heat; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - s, y); ctx.lineTo(cx + s, y); ctx.stroke();
    ctx.lineWidth = 1.4; ctx.beginPath(); ctx.ellipse(cx - s, y - 4, s * .45, 1.8, 0, 0, 7); ctx.ellipse(cx + s, y - 4, s * .45, 1.8, 0, 0, 7); ctx.stroke();
    ctx.fillStyle = C.heat; ctx.fillRect(cx - 4, y - 3, 8, 6); ctx.globalAlpha = 1;
    if (d.u < 0.8) text(ctx, nar ? 'low!' : 'near floor!', cx, y + (nar ? 14 : 18), { size: nar ? 10 : 11, color: C.danger, align: 'center' });
  }
  function drawFrames() {
    const r = L.frm, nar = L.nar; panel(r, nar ? '' : 'the two direction conventions');
    const fsz = nar ? 10 : 11.5, len = nar ? 24 : Math.min(54, r.w * .11);
    const conv = convert;
    let gy, g1x, g2x, ty;
    if (!nar) {
      gy = r.y + 64 + len; g1x = r.x + 30; g2x = r.x + r.w * .52;
      text(ctx, 'ROS 2 on the Pi: ENU', g1x - 10, r.y + 40, { size: 12, color: C.ink, weight: 500 });
      text(ctx, 'ArduPilot: NED', g2x - 10, r.y + 40, { size: 12, color: C.ink, weight: 500 });
      gizmo(g1x + 14, gy + 8, len, [['x', 'E', 'East'], ['y', 'N', 'North'], ['z', 'U', 'Up']], fsz);
      gizmo(g2x + 14, gy + 8, len, [['x', 'N', 'North'], ['y', 'E', 'East'], ['z', 'D', 'Down']], fsz);
      ty = gy + len + 52;
    } else {
      g1x = r.x + 12; gy = r.y + 14;
      text(ctx, 'ENU', g1x, gy, { size: 10.5, color: C.ink, weight: 600 });
      gizmo(g1x + 10, gy + 20 + len, len * .9, [['x', 'E', 'E'], ['y', 'N', 'N'], ['z', 'U', 'Up']], 9.5);
      text(ctx, 'NED', r.x + r.w * .54, gy, { size: 10.5, color: C.ink, weight: 600 });
      gizmo(r.x + r.w * .54 + 10, gy + 20 + len, len * .9, [['x', 'N', 'N'], ['y', 'E', 'E'], ['z', 'D', 'Dn']], 9.5);
      ty = gy + 20 + 2 * len + 38;
    }
    // the conversion, with the actual numbers
    const lh = nar ? 15 : 21, x0 = r.x + (nar ? 10 : 18), mono = { size: fsz, font: F.mono };
    if (!nar) {
      text(ctx, 'planner says, in ENU:', x0, ty, { size: 11.5, color: C.muted });
      text(ctx, 'x 0   y +1   z +1', x0 + r.w * .5, ty, { ...mono, color: C.ink });
      text(ctx, conv ? 'MAVROS2 converts:' : 'MAVROS2 passes it on:', x0, ty + lh, { size: 11.5, color: C.muted });
      text(ctx, conv ? 'x ← y   y ← x   z ← −z' : 'unchanged', x0 + r.w * .5, ty + lh, { ...mono, color: conv ? C.teal : C.danger });
      text(ctx, 'flight controller reads, in NED:', x0, ty + 2 * lh, { size: 11.5, color: C.muted });
      text(ctx, conv ? 'x +1   y 0   z −1' : 'x 0   y +1   z +1', x0 + r.w * .5, ty + 2 * lh, { ...mono, color: C.ink });
      text(ctx, conv ? '= 1 m North, 1 m up. As intended.' : '= 1 m East, 1 m DOWN. Wrong way, confidently.', x0, ty + 3 * lh + 2, { size: 12.5, color: conv ? C.teal : C.danger, weight: 500 });
      const cap = wrap('If it moves opposite to what you intended, suspect coordinate frames first, before your control code.', r.w - 36, `400 12px ${F.sans}`);
      const cy0 = r.y + r.h - 14 - (cap.length - 1) * 17;
      cap.forEach((ln, i) => text(ctx, ln, x0, cy0 + i * 17, { size: 12, color: C.muted }));
    } else {
      text(ctx, 'ENU  (0, +1, +1)', x0, ty, { ...mono, color: C.ink });
      text(ctx, conv ? '→ NED (+1, 0, −1)' : '→ NED (0, +1, +1)', x0, ty + lh, { ...mono, color: conv ? C.teal : C.danger });
      text(ctx, conv ? 'N 1 m, up 1 m' : 'E 1 m, DOWN 1 m', x0, ty + 2 * lh, { size: 10.5, color: conv ? C.teal : C.danger, weight: 500 });
      const cap = wrap('Moves the wrong way? Suspect coordinate frames first.', r.w - 20, `400 11px ${F.sans}`);
      cap.forEach((ln, i) => text(ctx, ln, x0, r.y + r.h - 12 - (cap.length - 1 - i) * 14, { size: 11, color: C.muted }));
    }
  }

  function went() {
    if (!d.arrived) return 'at start';
    const parts = [];
    if (Math.abs(d.n) >= .05) parts.push(Math.abs(d.n).toFixed(1) + ' ' + (d.n > 0 ? 'N' : 'S'));
    if (Math.abs(d.e) >= .05) parts.push(Math.abs(d.e).toFixed(1) + ' ' + (d.e > 0 ? 'E' : 'W'));
    const du = d.u - START_U; if (Math.abs(du) >= .05) parts.push(Math.abs(du).toFixed(1) + ' ' + (du > 0 ? 'up' : 'down'));
    return parts.length ? parts.join(', ') : 'at start';
  }
  let autoSent = false, tone = true;
  const loop = kit.loop((dt) => {
    if (!autoSent && T > 0.7) { autoSent = true; send(); }
    step(dt); draw();
    rWent.set(went()); if (tone !== d.sentConvert) { tone = d.sentConvert; rWent.tone(tone ? 'teal' : 'danger'); }
    let cnt = 0, t0 = T, t1 = 0; for (let i = 0; i < arrivals.length; i++) { const a = arrivals[i]; if (a > T - 2) { cnt++; if (a < t0) t0 = a; if (a > t1) t1 = a; } }
    rRate.set(T > 2.5 && cnt > 2 ? Math.round((cnt - 1) / (t1 - t0)) + ' /s' : '…');
    rAge.set(lastArrive < 0 ? '…' : Math.round((T - lastArrive) * 100) * 10 + ' ms');
  });
  draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

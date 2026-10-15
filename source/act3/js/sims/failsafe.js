// When things go wrong: the six failures from the briefing's table (Section 20). Pick one and watch how the drone
// notices it and what it does: a side view of the flight plus the response as a small state machine
// (Flying -> Hover / Attitude hold -> Return home -> Land -> On the ground). When in doubt, go down gently.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const A = { teal: '127,212,207', heat: '255,195,107', apricot: '246,210,177', haze: '143,140,196', danger: '240,138,126', rose: '239,177,180', ink: '243,238,242' };
  const rgba = (k, a) => `rgba(${A[k]},${a})`;

  const FAILS = [
    { k: 'radio', name: 'Radio link lost', short: 'Radio lost', notice: 'No signal received from the pilot’s radio for a set time.', does: 'Hover briefly, then return home or land.' },
    { k: 'pi', name: 'Flight computer crashes', short: 'Pi crashes', notice: 'Setpoints stop arriving at the flight controller.', does: 'Hover, then land. Never continue the last command.' },
    { k: 'slam', name: 'SLAM loses tracking', short: 'SLAM lost', notice: 'The SLAM software reports that it has lost its position.', does: 'Hold position on the flight controller’s own estimate, try to relocalise, return home if it cannot.' },
    { k: 'ekf', name: 'State estimate diverges', short: 'EKF diverges', notice: 'The filter’s health checks fail.', does: 'Drop to simple attitude-hold, then land.' },
    { k: 'batt', name: 'Battery low', short: 'Battery low', notice: 'Voltage and consumed capacity.', does: 'Staged: warn → return home → land immediately.' },
    { k: 'fence', name: 'Leaves the test area', short: 'Leaves area', notice: 'Position compared with the defined boundary.', does: 'Stop at the boundary, return, or land.' },
  ];
  const STATE = { fly: 'Flying', hover: 'Hover', atti: 'Attitude hold', home: 'Return home', land: 'Land', ground: 'On the ground', pilot: 'Pilot in control' };
  const BOUND = 9.5, HOMEX = 0, ALT = 1.8;

  // ------------------------------------------------------------------ simulation state
  let fail = -1, tf = 0, mode = 'fly', modeT = 0, T = 0, action = 'exploring', note = '';
  const d = { x: 4.5, z: ALT, vx: 0.7, vz: 0, dir: 1, ex: 0, ez: 0, wx: 0, batt: 62, lastVx: 0.7 };
  const seen = new Set(), edges = new Set(); let lastEdge = '';
  let hover = -1;
  function go(m, act) {
    if (m !== mode) { edges.add(mode + '>' + m); lastEdge = mode + '>' + m; seen.add(m); }
    mode = m; modeT = 0; if (act) action = act;
  }
  function trigger(i) {
    resetFlight(false);
    fail = i; tf = 0; d.lastVx = d.vx;
    const k = FAILS[i].k;
    action = { radio: 'counting the silence', pi: 'waiting for setpoints', slam: 'tracking lost', ekf: 'health checks failing', batt: 'warning the pilot', fence: 'drifting outward' }[k];
    if (k === 'batt') d.batt = 24;
  }
  function resetFlight(full = true) {
    fail = -1; tf = 0; mode = 'fly'; modeT = 0; action = 'exploring'; note = '';
    seen.clear(); edges.clear(); lastEdge = ''; seen.add('fly');
    d.ex = d.ez = 0; d.wx = 0;
    if (full || d.z < 0.3) { d.x = 4.5; d.z = ALT; d.vx = 0.7; d.vz = 0; d.dir = 1; d.batt = 62; }
  }
  resetFlight();

  kit.button(controls, { label: 'Fly normally again', onClick: () => resetFlight(true) });
  kit.button(controls, { label: 'Pilot takes over', kind: 'warn', onClick: () => {
    if (mode === 'ground') return;
    if (fail >= 0 && FAILS[fail].k === 'radio') { note = 'No radio link, so the pilot cannot take over: the automatic response carries on.'; return; }
    go('pilot', 'pilot has control'); note = 'Manual override always wins, whatever the software is doing.';
  } });
  kit.hint(controls, 'Pick a failure in the picture to see the response.');
  const rState = kit.readout(readouts, { label: 'state', tone: 'heat' });
  const rTime = kit.readout(readouts, { label: 'time since failure', tone: 'ink' });
  const rAct = kit.readout(readouts, { label: 'action', tone: 'teal' });

  function approach(v, target, rate, dt) { return v + clamp(target - v, -rate * dt, rate * dt); }
  function step(dt) {
    T += dt; modeT += dt; if (fail >= 0) tf += dt;
    const k = fail >= 0 ? FAILS[fail].k : '';
    // what each failure makes the autopilot decide
    if (mode === 'fly' || mode === 'hover' || mode === 'atti') {
      if (k === 'radio') { if (mode === 'fly' && tf > 1.5) go('hover', 'holding position'); else if (mode === 'hover' && modeT > 2) go('home', 'flying home'); }
      if (k === 'pi') { if (mode === 'fly' && tf > 1) go('hover', 'holding position'); else if (mode === 'hover' && modeT > 2.2) go('land', 'descending gently'); }
      if (k === 'slam') { if (mode === 'fly' && tf > 0.3) go('hover', 'relocalising…'); else if (mode === 'hover' && modeT > 4) go('home', 'flying home'); }
      if (k === 'ekf') { if (mode === 'fly' && tf > 0.9) go('atti', 'level only, drifting'); else if (mode === 'atti' && modeT > 1.2) go('land', 'descending gently'); }
      if (k === 'batt') { if (mode === 'fly' && d.batt < 20) go('home', 'flying home'); }
      if (k === 'fence') { if (mode === 'fly' && d.x >= BOUND - 0.08) go('hover', 'stopped at the edge'); else if (mode === 'hover' && modeT > 1.5) go('home', 'flying home'); }
    }
    // battery: a slow drain while flying; the low-battery case is time-compressed so the stages are visible
    if (mode !== 'ground') d.batt -= dt * (k === 'batt' ? 1.6 : 0.05);
    if (k === 'batt' && mode === 'home' && d.batt < 12) go('land', 'landing now');
    // how each mode flies
    let wantVx = 0, wantVz = 0;
    if (mode === 'fly') {
      if (k === 'fence') wantVx = 1.2;
      else { if (d.x > 7.5) d.dir = -1; else if (d.x < 2.5) d.dir = 1; wantVx = 0.7 * d.dir; }
      wantVz = (ALT - d.z) * 1.5;
    } else if (mode === 'hover') { wantVx = 0; wantVz = 0; }
    else if (mode === 'home') { wantVx = clamp((HOMEX - d.x) * 1.2, -0.9, 0.9); if (Math.abs(d.x - HOMEX) < 0.04 && Math.abs(d.vx) < 0.05) go('land', 'descending gently'); }
    else if (mode === 'atti') { d.wx += (Math.sin(T * 1.3) * 0.25 - d.wx) * dt; wantVx = d.wx; }
    else if (mode === 'land') { wantVx = k === 'ekf' ? d.wx : 0; wantVz = -0.45; }
    else if (mode === 'pilot') { wantVx = 0; wantVz = modeT > 0.8 ? -0.35 : 0; }
    d.vx = approach(d.vx, wantVx, 1.2, dt); d.vz = approach(d.vz, wantVz, 1.5, dt);
    d.x += d.vx * dt; d.z += d.vz * dt;
    if (k === 'fence' && mode === 'hover') d.x = Math.min(d.x, BOUND);
    if (d.z <= 0 && mode !== 'fly') { d.z = 0; d.vz = 0; d.vx = 0; if (mode !== 'ground') go('ground', 'landed safely'); }
    // the filter's estimate wanders off when it diverges, then is no longer used
    if (k === 'ekf') { d.ex += dt * 0.9 * (mode === 'fly' ? 1 : 0.3); d.ez += dt * 0.25; }
  }

  // ------------------------------------------------------------------ layout
  let L;
  function layout() {
    const w = cv.w, h = cv.h, nar = w < 640, o = { nar, btn: [] };
    if (!nar) {
      const bw = 260, bh = 40, gap = 9, x0 = 20, y0 = 44;
      FAILS.forEach((f, i) => o.btn.push({ x: x0, y: y0 + i * (bh + gap), w: bw, h: bh, i }));
      o.card = { x: x0, y: y0 + 6 * (bh + gap) + 10, w: bw, h: h - (y0 + 6 * (bh + gap) + 10) - 16 };
      const rx = x0 + bw + 30, rw = w - rx - 20;
      o.head = { x: rx, y: 22, w: Math.min(rw, w - 270 - rx) };
      o.scene = { x: rx, y: 202, w: rw, h: Math.max(150, h * .34) };
      o.sm = { x: rx, y: o.scene.y + o.scene.h + 14, w: rw, h: h - (o.scene.y + o.scene.h + 14) - 14 };
    } else {
      const bw = (w - 140 - 10 - 8 - 6) / 2, bh = 26, gap = 6;
      FAILS.forEach((f, i) => o.btn.push({ x: 10 + (i % 2) * (bw + 6), y: 8 + Math.floor(i / 2) * (bh + gap), w: bw, h: bh, i }));
      o.scene = { x: 10, y: 104, w: w - 20, h: 92 };
      o.sm = { x: 10, y: 202, w: w - 20, h: 92 };
      o.txt = { x: 10, y: 312, w: w - 20 };
    }
    // the state machine nodes
    const s = o.sm, nw = nar ? Math.min(64, (s.w - 8) / 5.6) : Math.min(116, s.w / 5.8), nh = nar ? 20 : 32;
    const sp = (s.w - nw) / 4, top = s.y + (nar ? 24 : 46), mid = top + (nar ? 26 : 50), bot = mid + (nar ? 26 : 50);
    const N = (c, y) => ({ x: s.x + c * sp, y: y - nh / 2, w: nw, h: nh, cx: s.x + c * sp + nw / 2, cy: y });
    o.nodes = { fly: N(0, mid), hover: N(1, top), atti: N(1, bot), home: N(2, top), land: N(3, mid), ground: N(4, mid) };
    o.nw = nw; o.nh = nh;
    L = o;
  }
  cv.onResize(layout); layout();

  // canvas buttons for the failures
  function hit(e) { const r = cv.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; for (const b of L.btn) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.i; return -1; }
  cv.cv.addEventListener('pointerdown', (e) => { const i = hit(e); if (i >= 0) trigger(i); });
  cv.cv.addEventListener('pointermove', (e) => { const i = hit(e); if (i !== hover) { hover = i; cv.cv.style.cursor = i >= 0 ? 'pointer' : ''; } });
  cv.cv.addEventListener('pointerleave', () => { hover = -1; cv.cv.style.cursor = ''; });

  // ------------------------------------------------------------------ drawing
  const wrapCache = new Map();
  function wrap(s, maxW, font) {
    const key = s + '|' + Math.round(maxW) + '|' + font; let v = wrapCache.get(key); if (v) return v;
    if (wrapCache.size > 160) wrapCache.clear();
    ctx.font = font; const out = []; let cur = '';
    for (const wd of s.split(' ')) { const t = cur ? cur + ' ' + wd : wd; if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = wd; } else cur = t; }
    if (cur) out.push(cur); wrapCache.set(key, out); return out;
  }
  function para(s, x, y, maxW, size, color, lh, weight = 400) { const ls = wrap(s, maxW, `${weight} ${size}px ${F.sans}`); ls.forEach((ln, i) => text(ctx, ln, x, y + i * lh, { size, color, weight })); return y + ls.length * lh; }
  function arrowHead(x, y, a, col, s = 6) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - s * Math.cos(a - .45), y - s * Math.sin(a - .45)); ctx.lineTo(x - s * Math.cos(a + .45), y - s * Math.sin(a + .45)); ctx.closePath(); ctx.fill(); }

  function drawButtons() {
    const nar = L.nar;
    if (!nar) text(ctx, 'WHAT FAILS', L.btn[0].x, L.btn[0].y - 14, { size: 11, color: C.faint, weight: 600 });
    for (const b of L.btn) {
      const on = b.i === fail, hv = b.i === hover;
      ctx.fillStyle = on ? rgba('danger', .16) : hv ? 'rgba(243,238,242,.06)' : C.panel; roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2); ctx.fill();
      ctx.strokeStyle = on ? C.danger : hv ? 'rgba(243,238,242,.5)' : 'rgba(220,214,236,.22)'; ctx.lineWidth = on ? 1.6 : 1; ctx.stroke();
      const f = FAILS[b.i];
      if (!nar) {
        ctx.fillStyle = on ? C.danger : 'rgba(243,238,242,.3)'; ctx.beginPath(); ctx.arc(b.x + 20, b.y + b.h / 2, 4, 0, 7); ctx.fill();
        text(ctx, f.name, b.x + 34, b.y + b.h / 2 + .5, { size: 13, color: on ? C.ink : C.muted, weight: 500, base: 'middle' });
      } else text(ctx, f.short, b.x + b.w / 2, b.y + b.h / 2 + .5, { size: 11, color: on ? C.ink : C.muted, weight: 500, align: 'center', base: 'middle' });
    }
  }
  function narration() {
    if (mode === 'pilot') return 'The pilot has taken over on the radio and lands it.';
    if (mode === 'ground') return 'On the ground, motors off. A drone on the ground is safe.';
    if (fail < 0) return 'All healthy: exploring. Pick a failure to see how the drone responds.';
    const k = FAILS[fail].k, t = tf.toFixed(1);
    if (mode === 'land') return k === 'batt' ? 'Battery critical on the way: land immediately.' : k === 'pi' ? 'Still no setpoints: land where it is.' : k === 'ekf' ? 'Descend gently on attitude hold alone.' : 'Over home: descend gently.';
    if (mode === 'home') return k === 'batt' ? 'Below the return level: fly home along the known map.' : k === 'slam' ? 'Could not relocalise: return home.' : k === 'fence' ? 'Return from the boundary towards home.' : 'Still no link: return home.';
    if (mode === 'hover') return k === 'radio' ? 'No signal for 1.5 s: hover briefly.' : k === 'pi' ? 'No setpoint for 1 s: hover. The last command is not continued.' : k === 'slam' ? 'Hold position on the flight controller’s own estimate; try to relocalise.' : 'Stopped at the boundary.';
    if (mode === 'atti') return 'Filter health checks failed: stop trusting position, hold attitude only.';
    return k === 'radio' ? `No signal from the pilot for ${t} s…` : k === 'pi' ? `Last setpoint ${t} s ago…` : k === 'slam' ? 'SLAM reports: tracking lost.' : k === 'ekf' ? 'The estimate is drifting away from reality…' : k === 'batt' ? `Battery ${Math.max(0, d.batt).toFixed(0)}%: warn the pilot, keep going.` : 'Heading for the edge of the test area…';
  }
  function drawHead() {
    const hd = L.head; if (!hd) return;
    const title = fail >= 0 ? FAILS[fail].name : mode === 'fly' ? 'Normal flight' : 'Pilot takes over';
    text(ctx, title, hd.x, hd.y + 26, { size: 24, color: fail >= 0 ? C.danger : mode === 'fly' ? C.teal : C.apricot, font: F.serif, weight: 500 });
    para(narration(), hd.x, hd.y + 54, hd.w, 13, C.ink, 19);
    // health strip
    const k = fail >= 0 ? FAILS[fail].k : '';
    const items = [
      ['radio', k === 'radio' ? 2 : 0], ['setpoints', k === 'pi' ? 2 : 0], ['SLAM', k === 'slam' && mode !== 'home' && mode !== 'land' && mode !== 'ground' ? 2 : k === 'slam' ? 2 : 0],
      ['EKF', k === 'ekf' ? 2 : 0], ['battery ' + Math.max(0, d.batt).toFixed(0) + '%', d.batt < 12 ? 2 : d.batt < 25 ? 1 : 0], ['in area', k === 'fence' && d.x > BOUND - 0.3 ? 2 : 0],
    ];
    let x = hd.x; const y = hd.y + 128;
    ctx.font = `500 11.5px ${F.sans}`;
    for (const [lab, st] of items) {
      const tw = ctx.measureText(lab).width + 26; if (x + tw > hd.x + hd.w + 4) break;
      const col = st === 2 ? C.danger : st === 1 ? C.apricot : C.teal;
      ctx.fillStyle = st ? rgba(st === 2 ? 'danger' : 'apricot', .12) : 'rgba(36,40,77,.9)'; roundRect(ctx, x, y - 11, tw, 22, 11); ctx.fill();
      ctx.strokeStyle = st ? col : 'rgba(220,214,236,.18)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + 11, y, 3.5, 0, 7); ctx.fill();
      text(ctx, lab, x + 19, y + .5, { size: 11.5, color: st ? C.ink : C.muted, weight: 500, base: 'middle' });
      x += tw + 6;
    }
  }
  function droneSide(x, y, s, tilt, col, alpha = 1, dashed = false, grounded = false) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(tilt);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.setLineDash(dashed ? [3, 3] : []);
    ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke();
    if (!dashed) ctx.fillRect(-s * .28, -s * .16, s * .56, s * .32); else ctx.strokeRect(-s * .28, -s * .16, s * .56, s * .32);
    ctx.lineWidth = 1.5;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * s, 0); ctx.lineTo(sx * s, -s * .22); ctx.stroke(); ctx.beginPath(); ctx.ellipse(sx * s, -s * .26, grounded ? s * .3 : s * .48, 1.6, 0, 0, 7); ctx.stroke(); }
    if (grounded || dashed) {} else { ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-s * .3, s * .16); ctx.lineTo(-s * .4, s * .36); ctx.moveTo(s * .3, s * .16); ctx.lineTo(s * .4, s * .36); ctx.stroke(); }
    ctx.restore(); ctx.setLineDash([]);
  }
  function drawScene() {
    const sc = L.scene, nar = L.nar;
    ctx.fillStyle = 'rgba(36,40,77,.55)'; roundRect(ctx, sc.x, sc.y, sc.w, sc.h, 12); ctx.fill();
    const k = Math.min((sc.w - (nar ? 30 : 60)) / 11, (sc.h - (nar ? 22 : 40)) / 2.5), floorY = sc.y + sc.h - (nar ? 12 : 22);
    const X = (m) => sc.x + (nar ? 18 : 40) + (m + 0.8) * k, Y = (m) => floorY - m * k;
    // floor, home pad, test-area boundary
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sc.x + 10, floorY); ctx.lineTo(sc.x + sc.w - 10, floorY); ctx.stroke();
    ctx.strokeStyle = C.teal; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(X(HOMEX) - k * .45, floorY); ctx.lineTo(X(HOMEX) + k * .45, floorY); ctx.stroke();
    text(ctx, 'home', X(HOMEX), floorY + (nar ? 10 : 15), { size: nar ? 9.5 : 11, color: C.teal, align: 'center' });
    const bx = X(BOUND), fenceHot = fail >= 0 && FAILS[fail].k === 'fence' && d.x > BOUND - 0.3;
    ctx.setLineDash([5, 5]); ctx.strokeStyle = fenceHot ? C.danger : 'rgba(220,214,236,.35)'; ctx.lineWidth = fenceHot ? 2 : 1.2; ctx.beginPath(); ctx.moveTo(bx, floorY); ctx.lineTo(bx, Y(2.45)); ctx.stroke(); ctx.setLineDash([]);
    text(ctx, nar ? 'edge' : 'test-area edge', bx - 6, floorY - 7, { size: nar ? 9.5 : 11, color: fenceHot ? C.danger : C.faint, align: 'right' });
    // the pilot with the radio, and the link to the drone
    const plx = X(-0.55), ply = floorY;
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    const ps = nar ? 0.6 : 1;
    ctx.beginPath(); ctx.arc(plx, ply - 30 * ps, 4 * ps, 0, 7); ctx.moveTo(plx, ply - 26 * ps); ctx.lineTo(plx, ply - 12 * ps); ctx.lineTo(plx - 5 * ps, ply); ctx.moveTo(plx, ply - 12 * ps); ctx.lineTo(plx + 5 * ps, ply); ctx.moveTo(plx, ply - 22 * ps); ctx.lineTo(plx + 7 * ps, ply - 18 * ps); ctx.stroke();
    if (!nar) text(ctx, 'pilot', plx, ply + 15, { size: 11, color: C.faint, align: 'center' });
    const dx = X(d.x), dy = Y(d.z) - 2, radioLost = fail >= 0 && FAILS[fail].k === 'radio';
    if (mode !== 'ground') {
      const ax = plx + 8 * ps, ay = ply - 20 * ps, ang = Math.atan2(dy - ay, dx - ax), dd = Math.hypot(dx - ax, dy - ay);
      ctx.lineWidth = 1.3;
      for (let i = 0; i < 3; i++) {
        const f = ((T * 0.8 + i / 3) % 1), r = 10 + f * Math.min(dd - 20, 140);
        ctx.strokeStyle = radioLost ? rgba('danger', .5 * (1 - f)) : rgba('teal', .55 * (1 - f));
        if (radioLost) ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.arc(ax, ay, r, ang - .22, ang + .22); ctx.stroke(); ctx.setLineDash([]);
      }
      if (radioLost) {
        const mx = ax + Math.cos(ang) * 40, my = ay + Math.sin(ang) * 40;
        ctx.strokeStyle = C.danger; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(mx - 5, my - 5); ctx.lineTo(mx + 5, my + 5); ctx.moveTo(mx + 5, my - 5); ctx.lineTo(mx - 5, my + 5); ctx.stroke();
      }
    }
    const kf = fail >= 0 ? FAILS[fail].k : '', s = nar ? 13 : 24;
    // failure-specific overlays
    if (kf === 'pi' && mode !== 'ground') {             // the last command, deliberately not continued
      const dir = Math.sign(d.lastVx) || 1, x2 = dx + dir * (nar ? 60 : 130);
      ctx.setLineDash([5, 5]); ctx.strokeStyle = rgba('danger', .7); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(dx + dir * (s + 8), dy); ctx.lineTo(x2, dy); ctx.stroke(); ctx.setLineDash([]);
      arrowHead(x2, dy, dir > 0 ? 0 : Math.PI, rgba('danger', .7));
      const cx2 = (dx + dir * (s + 8) + x2) / 2;
      ctx.strokeStyle = C.danger; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx2 - 5, dy - 5); ctx.lineTo(cx2 + 5, dy + 5); ctx.moveTo(cx2 + 5, dy - 5); ctx.lineTo(cx2 - 5, dy + 5); ctx.stroke();
      if (!nar) text(ctx, 'last command: not continued', cx2, dy - 14, { size: 11, color: C.danger, align: 'center' });
    }
    if (kf === 'slam' && (mode === 'hover' || mode === 'fly')) {
      const r = s + (nar ? 7 : 16);
      ctx.setLineDash([3, 4]); ctx.strokeStyle = rgba('teal', .7); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(dx, dy, r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      if (mode === 'hover') { ctx.strokeStyle = C.heat; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(dx, dy, r, T * 4, T * 4 + 1.2); ctx.stroke(); }
      if (!nar) text(ctx, mode === 'hover' ? 'holding on optical flow + barometer · relocalising…' : 'SLAM: tracking lost', dx, dy - r - 10, { size: 11, color: C.teal, align: 'center' });
    }
    if (kf === 'ekf' && d.ex > 0.02 && mode !== 'ground') {
      const gx = X(d.x + d.ex), gy = Y(d.z + d.ez) - 2, al = mode === 'fly' ? .8 : Math.max(0, .8 - modeT * .5);
      if (al > 0) { droneSide(gx, gy, s, 0, C.danger, al * .6, false, true); if (!nar) text(ctx, 'what the filter thinks', gx, gy - s * .6 - 10, { size: 11, color: C.danger, align: 'center' }); }
    }
    // the drone
    droneSide(dx, dy, s, clamp(d.vx * 0.22, -.3, .3), mode === 'ground' ? C.muted : C.heat, 1, false, mode === 'ground');
    if (mode === 'ground' && !nar) text(ctx, 'safe', dx, dy - s * .6 - 10, { size: 11, color: C.teal, align: 'center' });
    if (nar) text(ctx, 'When in doubt, go down gently.', sc.x + 10, sc.y + 14, { size: 10.5, color: C.muted, weight: 500 });
  }
  function drawSM() {
    const s = L.sm, N = L.nodes, nar = L.nar;
    if (!nar) text(ctx, 'the response, as a state machine', s.x + s.w, s.y + 8, { size: 11, color: C.faint, align: 'right' });
    const E = [['fly', 'hover'], ['fly', 'atti'], ['fly', 'home'], ['hover', 'home'], ['hover', 'land'], ['home', 'land'], ['atti', 'land'], ['land', 'ground']];
    for (const [a, b] of E) {
      const key = a + '>' + b, A2 = N[a], B = N[b], used = edges.has(key), hot = key === lastEdge;
      ctx.strokeStyle = hot ? C.heat : used ? C.teal : 'rgba(220,214,236,.16)'; ctx.lineWidth = hot || used ? 2 : 1.2;
      let x1, y1, x2, y2, c1x, c1y, c2x, c2y;
      if (key === 'fly>home') {
        x1 = A2.cx; y1 = A2.y; x2 = B.cx; y2 = B.y; const top = B.y - (nar ? 14 : 22);
        c1x = x1; c1y = top; c2x = x2; c2y = top;
      } else {
        x1 = A2.x + A2.w; y1 = A2.cy; x2 = B.x; y2 = B.cy;
        if (a === 'hover' && b === 'land') { x1 = A2.x + A2.w * .75; y1 = A2.y + A2.h; x2 = B.x; y2 = B.cy - B.h * .25; }
        c1x = x1 + (x2 - x1) * .5; c1y = y1; c2x = x1 + (x2 - x1) * .5; c2y = y2;
      }
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x2, y2); ctx.stroke();
      const ang = Math.atan2(y2 - c2y, x2 - c2x);
      arrowHead(x2, y2, ang, hot ? C.heat : used ? C.teal : 'rgba(220,214,236,.3)', nar ? 4 : 6);
    }
    for (const key of ['fly', 'hover', 'atti', 'home', 'land', 'ground']) {
      const n = N[key], act = mode === key, vis = seen.has(key);
      ctx.fillStyle = act ? rgba('heat', .16) : C.bg; roundRect(ctx, n.x, n.y, n.w, n.h, n.h / 2); ctx.fill();
      ctx.strokeStyle = act ? C.heat : vis ? C.teal : 'rgba(220,214,236,.28)'; ctx.lineWidth = act ? 2 : 1.2; ctx.stroke();
      let lab = STATE[key];
      if (nar) lab = { fly: 'Flying', hover: 'Hover', atti: 'Att. hold', home: 'Go home', land: 'Land', ground: 'Landed' }[key];
      text(ctx, lab, n.cx, n.cy + .5, { size: nar ? 9.5 : 12, color: act ? C.heat : vis ? C.ink : C.muted, weight: act ? 600 : 500, align: 'center', base: 'middle' });
    }
    if (mode === 'pilot') {
      ctx.fillStyle = rgba('apricot', .16); const pw = nar ? 90 : 150, ph = nar ? 20 : 30; roundRect(ctx, N.home.x, s.y + s.h - ph - 2, pw, ph, ph / 2); ctx.fill();
      ctx.strokeStyle = C.apricot; ctx.lineWidth = 1.6; ctx.stroke();
      text(ctx, nar ? 'Pilot control' : 'Pilot in control', N.home.x + pw / 2, s.y + s.h - ph / 2 - 1.5, { size: nar ? 9.5 : 12, color: C.apricot, weight: 600, align: 'center', base: 'middle' });
    }
  }
  function drawCard() {
    const nar = L.nar, f = fail >= 0 ? FAILS[fail] : null;
    if (!nar) {
      const c = L.card; let y = c.y + 14;
      text(ctx, 'HOW WE NOTICE', c.x, y, { size: 11, color: C.faint, weight: 600 }); y += 20;
      y = para(f ? f.notice : 'Pick a failure above.', c.x, y, c.w, 13, f ? C.ink : C.muted, 18) + 12;
      text(ctx, 'WHAT THE DRONE DOES', c.x, y, { size: 11, color: C.faint, weight: 600 }); y += 20;
      y = para(f ? f.does : '—', c.x, y, c.w, 13, f ? C.ink : C.muted, 18) + 8;
      if (note) para(note, c.x, y + 4, c.w, 12, C.apricot, 17);
      const cap = 'When in doubt, go down gently.';
      text(ctx, cap, c.x, c.y + c.h - 4, { size: 16, color: C.heat, font: F.serif, weight: 500 });
    } else {
      const t = L.txt; let y = t.y;
      if (!f) { para('Tap a failure above. ' + (note || 'Each one has a planned, safe response.'), t.x, y, t.w, 11.5, C.muted, 15); return; }
      y = para('Notice: ' + f.notice, t.x, y, t.w, 11.5, C.muted, 15) + 3;
      y = para('Does: ' + f.does, t.x, y, t.w, 11.5, C.ink, 15) + 3;
      if (note) para(note, t.x, y, t.w, 11, C.apricot, 14);
    }
  }
  function draw() {
    cv.clear();
    drawButtons(); drawHead(); drawScene(); drawSM(); drawCard();
  }

  const loop = kit.loop((dt) => {
    step(dt); draw();
    rState.set(STATE[mode]); rTime.set(fail >= 0 ? tf.toFixed(1) + ' s' : '—'); rAct.set(action);
  });
  draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

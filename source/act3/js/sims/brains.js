// Two brains: the flight computer (Pi 5 + Hailo-8) thinks in uneven chunks 10-30 times a second and sends only
// setpoints; the flight controller (CUAV V6X) corrects the attitude 400 times a second. Crash the computer and the
// controller notices the silence, hovers, then lands. Make the controller 50 ms late and the drone tumbles.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, roundRect, clamp, gauss } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;

  // time: the whole simulation runs 3x slower than real time so the 400 Hz ticks are visible
  const SLOW = 3, WIN = 0.4, SLOT = 0.0025, H = 0.00025;
  // the airframe: tilt is unstable (it grows by itself), motors respond with a 20 ms lag
  const LAM = 4.5, TM = 0.02, WN = 15, KP = LAM * LAM + WN * WN, KD = 2 * 0.7 * WN, G = 9.81;
  const SPD = 0.45, TIMEOUT = 0.5, HOVER_HOLD = 0.8, LAND_V = 0.6, Z0 = 1.15, LATE = 0.05;
  const KINDS = ['scan', 'detect', 'map', 'plan'];

  const rnd = kit.rng(11);
  // ring buffers (allocated once): controller slots and flight-computer blocks
  const NS = 512, sT = new Float64Array(NS), sK = new Uint8Array(NS);   // kind 1 on time, 2 late tick, 3 missed
  let sHead = 0;
  const NB = 32, bS = new Float64Array(NB), bE = new Float64Array(NB), bK = new Uint8Array(NB);
  let bHead = 0;
  const marks = [];   // rare annotations {t, label, color}

  let t, piDead, late, phase, tPhase, x, vx, z, vz, th, om, um, uc, pendU, xsp, zsp, xHold, lastSp, nextSlot,
    busyUntil, blockEnd, nextBlock, wpI, dist, interval, lastServed, tCrash, tLate, vsp, spPrev;
  function reset() {
    t = 0; piDead = false; late = false; phase = 'fly'; tPhase = 0;
    x = -0.6; vx = 0; z = Z0; vz = 0; th = 0; om = 0; um = 0; uc = 0; pendU = 0;
    xsp = -0.6; zsp = Z0; xHold = 0; lastSp = 0; nextSlot = 0; busyUntil = 0; dist = 0;
    interval = SLOT; lastServed = 0; tCrash = -1; tLate = -1;
    sT.fill(-9); sK.fill(0); sHead = 0; bS.fill(-9); bE.fill(-9); bHead = 0; marks.length = 0;
    blockEnd = -1; nextBlock = 0; wpI = 0; vsp = 0; spPrev = 0;
  }
  reset();

  kit.button(controls, { label: 'Crash the flight computer', kind: 'warn', onClick: () => {
    if (piDead) return; piDead = true; tCrash = t;
    const i = (bHead - 1 + NB) % NB; if (bE[i] > t) bE[i] = Infinity; else { bS[bHead] = t; bE[bHead] = Infinity; bK[bHead] = 0; bHead = (bHead + 1) % NB; }
  } });
  kit.button(controls, { label: 'Make the flight controller 50 ms late', kind: 'warn', onClick: () => { if (!late) { late = true; tLate = t; busyUntil = t + LATE; } } });
  kit.button(controls, { label: 'Reset', onClick: reset });
  const rState = kit.readout(readouts, { label: 'drone state', tone: 'heat' });
  const rAge = kit.readout(readouts, { label: 'setpoint age', tone: 'teal' });
  const rRate = kit.readout(readouts, { label: 'controller loop rate', tone: 'teal' });

  const tones = new Map(), tone = (r, tn) => { if (tones.get(r) !== tn) { tones.set(r, tn); r.tone(tn); } };
  const setPhase = (p, label, color) => { phase = p; tPhase = t; if (label) marks.push({ t, label, color }); if (marks.length > 8) marks.shift(); };

  // ---------------------------------------------------------------- the flight computer: uneven thinking blocks
  function computer() {
    if (piDead) return;
    if (blockEnd >= 0 && t >= blockEnd) {            // a block finished: send one setpoint
      blockEnd = -1; lastSp = t;
      const wp = (wpI % 2 ? 0.75 : -0.75); if (Math.abs(xsp - wp) < .01) wpI++;
      const step = clamp(wp - xsp, -SPD * (t - spPrev), SPD * (t - spPrev)); vsp = step / Math.max(1e-3, t - spPrev); xsp += step; spPrev = t;
      nextBlock = t + 0.003 + rnd() * 0.008;
    }
    if (blockEnd < 0 && t >= nextBlock) {             // start thinking about the next frame: 33-100 ms, sometimes longer
      const d = 0.033 + rnd() * 0.045 + (rnd() < .18 ? 0.02 + rnd() * 0.02 : 0);
      bS[bHead] = t; bE[bHead] = t + d; bK[bHead] = (rnd() * 4) | 0; bHead = (bHead + 1) % NB; blockEnd = t + d;
    }
  }

  // ---------------------------------------------------------------- the flight controller: one 2.5 ms slot
  function controlLaw() {
    const fly = phase === 'fly', xt = fly ? xsp : xHold;
    const aWant = clamp(2.2 * (xt - x) - 2.4 * (vx - (fly ? vsp : 0)), -3, 3);
    return -KP * (th - Math.atan(aWant / G)) - KD * om;
  }
  function slot() {
    let kind = 1;
    if (late) {
      if (t >= busyUntil) { kind = 2; uc = pendU; pendU = controlLaw(); busyUntil = t + LATE; }   // output based on a 52 ms old reading
      else kind = 3;                                                                           // deadline missed
    } else { uc = pendU; pendU = controlLaw(); }
    sT[sHead] = t; sK[sHead] = kind; sHead = (sHead + 1) % NS;
    if (kind === 3) return;
    interval += (t - lastServed - interval) * 0.25; lastServed = t;
    // supervision: is the flight computer still talking?
    const age = t - lastSp;
    if (phase === 'fly' && age > TIMEOUT) { xHold = x; zsp = z; setPhase('hover', 'no setpoint for 0.5 s → hover', C.heat); }
    else if (phase === 'hover' && t - tPhase > HOVER_HOLD) setPhase('land', 'still nothing → land', C.heat);
  }

  // ---------------------------------------------------------------- physics (side view)
  function physics(h) {
    if (phase === 'landed') return;
    if (phase === 'tumbled') {
      if (z > 0) { vz -= G * h; z += vz * h; x += vx * h; th += om * h; if (z <= 0) { z = 0; vz = 0; vx = 0; om = 0; } }
      else { const tgt = (2 * Math.round((th / Math.PI - 1) / 2) + 1) * Math.PI; th += (tgt - th) * Math.min(1, h * 10); }
      return;
    }
    dist += (gauss(rnd) * 9 - dist) * Math.min(1, h * 40);
    um += (uc - um) * h / TM;
    om += (LAM * LAM * Math.sin(th) + um + dist) * h; th += om * h;
    if (phase === 'land') zsp = Math.max(-0.05, zsp - LAND_V * h);
    const az = clamp(4 * (zsp - z) - 3.2 * (vz + (phase === 'land' && zsp > 0 ? LAND_V : 0)), -4, 4), tc = clamp(th, -1.3, 1.3);
    const acc = Math.min(2 * G, (G + az) / Math.cos(tc));
    vx += (acc * Math.sin(tc) - 0.3 * vx) * h; x += vx * h;
    vz += (acc * Math.cos(tc) - G) * h; z += vz * h;
    if (Math.abs(th) > 1.3) { setPhase('tumbled', 'tumbled', C.danger); vz = Math.min(vz, 0); }
    else if (z <= 0.005) {
      if (phase === 'land') { z = 0; vz = 0; vx = 0; th = 0; om = 0; setPhase('landed', 'landed', C.teal); }
      else { z = 0; vz = Math.max(0, vz); }
    }
  }

  function advance(dtSim) {
    const tEnd = t + dtSim;
    while (t < tEnd) {
      if (t >= nextSlot) { slot(); nextSlot += SLOT; }
      computer();
      physics(H); t += H;
    }
  }

  // ---------------------------------------------------------------- drawing
  function wrapLines(s, maxW, size) {
    ctx.font = `400 ${size}px ${F.sans}`; const out = []; let line = '';
    for (const w of s.split(' ')) { const tryL = line ? line + ' ' + w : w; if (ctx.measureText(tryL).width > maxW && line) { out.push(line); line = w; } else line = tryL; }
    if (line) out.push(line); return out;
  }
  function droneShape(cx, cy, ang, s, col) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang); ctx.lineCap = 'round';
    ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke();
    ctx.fillStyle = col; roundRect(ctx, -s * .28, -s * .16, s * .56, s * .3, 3); ctx.fill();
    ctx.lineWidth = 1.6; ctx.globalAlpha = .7;
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(k * s, 0); ctx.lineTo(k * s, -s * .2); ctx.stroke(); ctx.beginPath(); ctx.ellipse(k * s, -s * .24, s * .42, s * .06, 0, 0, 7); ctx.stroke(); }
    ctx.restore();
  }
  const stateName = () => phase === 'fly' ? 'Flying' : phase === 'hover' ? 'Hovering' : phase === 'land' ? 'Landing' : phase === 'landed' ? 'Landed' : 'Tumbled';
  function status() {
    if (phase === 'tumbled') return [C.danger, 'Tumbled. A correction that arrives 50 ms late is a wrong correction: the tilt has already grown. That is why the 400 Hz job runs alone on its own processor.'];
    if (late) return [C.danger, 'The controller is now 50 ms late every cycle (about 19 corrections a second instead of 400). Each push arrives after the tilt has moved on, so the wobble grows.'];
    if (phase === 'landed') return [C.teal, 'Landed safely. The intelligence crashed; the aircraft did not. It never kept flying to the last target.'];
    if (phase === 'land') return [C.heat, 'Still no setpoints, so the controller lands gently on its own. It never keeps flying to the last target.'];
    if (phase === 'hover') return [C.heat, 'Flight computer crashed. The controller is fine: no setpoint for 0.5 s, so it stops and hovers in place.'];
    if (piDead) return [C.rose, 'Flight computer crashed. Setpoints stopped, but the controller keeps the drone level and counts the silence.'];
    return [C.muted, 'Both brains healthy. The computer thinks in uneven chunks; only its setpoints cross down. The controller corrects 400 times a second.'];
  }

  function draw() {
    const w = cv.w, h = cv.h, phone = w < 600; cv.clear();
    const m = phone ? 12 : 24, insetW = phone ? 142 : 266;
    // vertical budget: panel, title, band, arrow gap, band, title, status
    const fixed = phone ? (10 + 30 + 30 + 52) : (20 + 42 + 40 + 64);
    const free = Math.max(0, h - fixed);
    const pH = clamp(free * .4, phone ? 86 : 120, phone ? 100 : 200);
    const bandH = clamp(free * .13, phone ? 22 : 30, phone ? 32 : 62), gapH = clamp(free * .18, phone ? 30 : 44, phone ? 44 : 104);
    // --- outcome panel (side view), kept left of the 3-D inset
    const pX = m, pY = phone ? 10 : 20, pW = w - insetW - m - (phone ? 0 : 6);
    ctx.fillStyle = C.panel; roundRect(ctx, pX, pY, pW, pH, 10); ctx.fill();
    const floorY = pY + pH - (phone ? 14 : 22), zpp = (floorY - pY - (phone ? 30 : 40)) / 1.75, xpp = (pW - (phone ? 50 : 110)) / 2 / 0.95;
    const sx = (mx) => pX + pW / 2 + mx * xpp, sy = (mz) => floorY - mz * zpp;
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pX + 12, floorY); ctx.lineTo(pX + pW - 12, floorY); ctx.stroke();
    ctx.strokeStyle = C.grid; const nh = Math.round(pW / 26); for (let i = 0; i < nh; i++) { const xx = pX + 20 + i * (pW - 30) / nh; ctx.beginPath(); ctx.moveTo(xx, floorY); ctx.lineTo(xx - 6, floorY + 6); ctx.stroke(); }
    // setpoint ghost
    const gx = sx(phase === 'fly' ? xsp : (phase === 'hover' || phase === 'land' ? xHold : xsp)), gy = sy(phase === 'land' || phase === 'landed' ? Math.max(0, zsp) : Z0);
    const ds = phone ? 20 : 34, rr = phone ? 9 : 13;
    if (phase !== 'landed' && phase !== 'tumbled') {
      ctx.setLineDash([3, 4]); ctx.strokeStyle = piDead ? C.faint : 'rgba(255,195,107,.75)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(gx, gy, rr, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      const lab = piDead ? (phase === 'fly' ? 'last setpoint' : phase === 'hover' ? 'hold here' : 'land here') : 'setpoint';
      ctx.font = `400 11px ${F.sans}`; const right = gx + rr + 10 + ctx.measureText(lab).width < pX + pW - 8;
      text(ctx, lab, right ? gx + rr + 6 : gx - rr - 6, gy + 4, { size: 11, color: piDead ? C.faint : C.heat, align: right ? 'left' : 'right' });
    }
    droneShape(sx(x), sy(z) - ds * (.14 + .16 * (1 - Math.cos(th)) / 2), th, ds, phase === 'tumbled' ? C.danger : C.ink);
    const [sc] = status();
    text(ctx, stateName() + (phase === 'hover' ? ' · no setpoints' : ''), pX + 12, pY + (phone ? 17 : 22), { size: phone ? 12 : 13, color: sc === C.muted ? C.teal : sc, weight: 600 });
    if (!phone) text(ctx, 'what the drone does', pX + pW - 12, pY + 22, { size: 11, color: C.faint, align: 'right' });

    // --- lanes: computer title above band 1, controller title below band 2, so the gap holds only setpoints
    const L = m + (phone ? 0 : 4), R = w - m, lw = R - L;
    const y1 = pY + pH + (phone ? 40 : 62), y2 = y1 + bandH + gapH;
    const xOf = (te) => L + ((te % WIN) / WIN) * lw, cut = t - WIN + WIN * .05;
    ctx.fillStyle = 'rgba(36,40,77,.6)'; roundRect(ctx, L - 4, y1 - 4, lw + 8, bandH + 8, 8); ctx.fill(); roundRect(ctx, L - 4, y2 - 4, lw + 8, bandH + 8, 8); ctx.fill();
    text(ctx, phone ? 'FLIGHT COMPUTER · Pi 5 + Hailo-8' : 'FLIGHT COMPUTER · Raspberry Pi 5 + Hailo-8', L, y1 - (phone ? 22 : 28), { size: phone ? 11 : 12, color: C.ink, weight: 600 });
    text(ctx, piDead ? 'crashed: no more thinking, no more setpoints' : (phone ? 'decides where to go · 10–30 Hz · can be slow' : 'decides where to go · 10–30 times a second · each frame takes as long as it takes'), L, y1 - (phone ? 9 : 12), { size: 11, color: piDead ? C.danger : C.faint });
    if (!phone) text(ctx, '0.4 s per sweep · shown 3× slower', R, y1 - 28, { size: 11, color: C.faint, align: 'right' });
    const t2 = y2 + bandH + (phone ? 18 : 22);
    text(ctx, 'FLIGHT CONTROLLER · CUAV V6X', L, t2, { size: phone ? 11 : 12, color: C.ink, weight: 600 });
    text(ctx, late ? (phone ? '50 ms late: misses its deadlines' : 'running 50 ms late: misses almost every 2.5 ms deadline') : (phone ? 'keeps it in the air · 400 Hz · never late' : 'keeps it in the air · 400 corrections a second · must never be late'), L, t2 + (phone ? 13 : 16), { size: 11, color: late ? C.danger : C.faint });

    // computer blocks (clipped to the visible sweep, split where they wrap)
    ctx.font = `400 11px ${F.sans}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < NB; i++) {
      let s = bS[i], e = bE[i]; if (e < cut || s > t) continue;
      const frozen = e === Infinity; s = Math.max(s, cut); e = Math.min(e, t);
      const xs = xOf(s), xe = xOf(e), segs = xe >= xs ? [[xs, xe]] : [[xs, R], [L, xe]];
      for (const [a, b] of segs) {
        if (b - a < .5) continue;
        ctx.fillStyle = frozen ? 'rgba(240,138,126,.14)' : 'rgba(143,140,196,.42)'; roundRect(ctx, a + .5, y1, Math.max(1, b - a - 1), bandH, 4); ctx.fill();
        if (frozen) {
          ctx.strokeStyle = 'rgba(240,138,126,.4)'; ctx.lineWidth = 1; ctx.beginPath(); for (let xx = a + 6; xx < b; xx += 9) { ctx.moveTo(xx, y1 + bandH - 2); ctx.lineTo(Math.min(b, xx + 7), y1 + 2); } ctx.stroke();
          if (b - a > 70) { ctx.fillStyle = C.bg; roundRect(ctx, (a + b) / 2 - 30, y1 + bandH / 2 - 9, 60, 18, 6); ctx.fill(); ctx.fillStyle = C.danger; ctx.fillText('frozen', (a + b) / 2, y1 + bandH / 2 + .5); }
        } else if (b - a > 36) { ctx.fillStyle = C.ink; ctx.fillText(KINDS[bK[i]], (a + b) / 2, y1 + bandH / 2 + .5); }
      }
    }
    // setpoint arrows: the only thing that crosses
    ctx.strokeStyle = C.heat; ctx.fillStyle = C.heat; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    const a0 = y1 + bandH + 3, a1 = y2 - 5;
    for (let i = 0; i < NB; i++) {
      const e = bE[i]; if (e === Infinity || e < cut || e > t) continue;
      const xx = xOf(e); ctx.beginPath(); ctx.moveTo(xx, a0); ctx.lineTo(xx, a1 - 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xx - 4, a1 - 6); ctx.lineTo(xx, a1); ctx.lineTo(xx + 4, a1 - 6); ctx.closePath(); ctx.fill();
    }
    ctx.textBaseline = 'alphabetic';
    {
      const lab = piDead ? 'no setpoints arriving' : 'position + setpoint cross ↓', ly = (a0 + a1) / 2 + 4; ctx.font = `500 11px ${F.sans}`; const tw = ctx.measureText(lab).width;
      ctx.fillStyle = C.bg; roundRect(ctx, L - 2, ly - 12, tw + 12, 17, 6); ctx.fill();
      text(ctx, lab, L + 4, ly, { size: 11, color: piDead ? C.danger : C.heat, weight: 500 });
    }
    // controller slots: teal = correction on time, tall rose = a late correction, small rose = a missed deadline
    ctx.lineWidth = phone ? 1 : 1.4;
    for (const kind of [1, 2]) {
      ctx.strokeStyle = kind === 1 ? C.teal : C.danger; ctx.beginPath();
      for (let i = 0; i < NS; i++) { const te = sT[i]; if (sK[i] !== kind || te < cut || te > t) continue; const xx = xOf(te); ctx.moveTo(xx, y2 + bandH); ctx.lineTo(xx, y2 + (kind === 1 ? 4 : 0)); }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(240,138,126,.6)';
    for (let i = 0; i < NS; i++) { const te = sT[i]; if (sK[i] !== 3 || te < cut || te > t) continue; ctx.fillRect(xOf(te) - .6, y2 + bandH - 5, 1.2, 5); }
    // annotations: drawn inside the arrow gap, just above the controller band
    for (const mk of marks) {
      if (mk.t < cut || mk.t > t) continue; const xx = xOf(mk.t);
      ctx.strokeStyle = mk.color; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(xx, y2 - 16); ctx.lineTo(xx, y2 + bandH + 4); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = `500 11px ${F.sans}`; const tw = ctx.measureText(mk.label).width, right = xx + tw + 10 > R;
      const lx = right ? xx - 6 - tw : xx + 6; ctx.fillStyle = C.bg; roundRect(ctx, lx - 4, y2 - 26, tw + 8, 17, 6); ctx.fill();
      text(ctx, mk.label, lx, y2 - 13, { size: 11, color: mk.color, weight: 500 });
    }
    // sweep cursor
    const cx = xOf(t); ctx.strokeStyle = 'rgba(243,238,242,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, y1 - 6); ctx.lineTo(cx, y2 + bandH + 6); ctx.stroke();
    // status
    const [col, msg] = status(), lines = wrapLines(msg, Math.min(lw - 18, 780), phone ? 12 : 13);
    let yy = t2 + (phone ? 38 : 50);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(L + 4, yy - 4, 4, 0, 7); ctx.fill();
    for (const ln of lines) { if (yy > h - 4) break; text(ctx, ln, L + 16, yy, { size: phone ? 12 : 13, color: col }); yy += phone ? 16 : 19; }
    if (phone) text(ctx, '0.4 s per sweep · 3× slower', R, t2, { size: 11, color: C.faint, align: 'right' });
  }

  const loop = kit.loop((dt) => {
    advance(dt / SLOW); draw();
    rState.set(stateName()); tone(rState, phase === 'tumbled' ? 'danger' : phase === 'landed' ? 'teal' : 'heat');
    const age = (t - lastSp) * 1000; rAge.set(age.toFixed(0) + ' ms'); tone(rAge, age > TIMEOUT * 1000 ? 'danger' : age > 150 ? 'apricot' : 'teal');
    const hz = 1 / Math.max(interval, 1e-4); rRate.set((hz > 100 ? Math.round(hz / 10) * 10 : Math.round(hz)) + ' Hz'); tone(rRate, hz < 300 ? 'danger' : 'teal');
  });
  advance(WIN); draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

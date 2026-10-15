// Cascaded control and PID: a side view of the drone flying to a target. It can only push sideways by tilting
// (underactuation), so the outer position PID asks for a tilt and an inner, faster loop delivers it.
// Tune P, I, D and watch overshoot, settling and the steady lean that only I removes.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F, text, plot, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  const P = { kp: 1.2, ki: .2, kd: 1.7 };
  kit.slider(controls, { label: 'P (spring)', min: 0, max: 5, step: .05, value: P.kp, fmt: (v) => v.toFixed(2), onInput: (v) => { P.kp = v; } });
  kit.slider(controls, { label: 'I (slow correction)', min: 0, max: 2, step: .05, value: P.ki, fmt: (v) => v.toFixed(2), onInput: (v) => { P.ki = v; } });
  kit.slider(controls, { label: 'D (shock absorber)', min: 0, max: 4, step: .05, value: P.kd, fmt: (v) => v.toFixed(2), onInput: (v) => { P.kd = v; } });
  let wind = 0;
  kit.toggle(controls, { label: 'Side wind', options: [{ v: 0, label: 'Calm' }, { v: 1, label: 'Steady wind' }], value: 0, onChange: (v) => { wind = v; } });
  kit.button(controls, { label: 'New target', kind: 'primary', onClick: () => { target = target > 0 ? -1.6 : 1.6; t0 = T; peak = 0; settled = null; } });
  const rOver = kit.readout(readouts, { label: 'overshoot', tone: 'rose' });
  const rSettle = kit.readout(readouts, { label: 'time to settle (±5 cm)', tone: 'teal' });
  const rTilt = kit.readout(readouts, { label: 'tilt right now', tone: 'heat' });

  // state: x position (m), v velocity, th tilt (rad), integral
  let x = -1.6, v = 0, th = 0, I = 0, target = 1.6, T = 0, t0 = 0, peak = 0, settled = null;
  const hist = [];
  function step(dt) {
    const e = target - x;
    I = clamp(I + e * dt, -1, 1);
    // outer loop: position -> wanted acceleration -> wanted tilt (a = g tan th)
    const aWant = P.kp * e + P.ki * I - P.kd * v;
    const thWant = clamp(Math.atan(aWant / 9.81), -.6, -(-.6));
    // inner loop: much faster, a first-order tilt response (time constant 60 ms)
    th += (thWant - th) * (1 - Math.exp(-dt / .06));
    const a = 9.81 * Math.tan(th) + (wind ? -1.1 : 0) - .25 * v;   // drag plus a steady push from the wind
    v += a * dt; x += v * dt; T += dt;
    const dir = Math.sign(target - (target > 0 ? -1.6 : 1.6));
    const over = (x - target) * dir; if (over > peak) peak = over;
    if (Math.abs(e) > .05) settled = null; else if (settled === null) settled = T - t0;
    hist.push([T, x, target]); while (hist.length && hist[0][0] < T - 12) hist.shift();
  }

  function draw() {
    const w = cv.w, h = cv.h; cv.clear();
    const top = 18, sceneH = h * .58, sx = (m) => w * .46 + m * (w * .17), floorY = top + sceneH - 10;
    // ground, scale and target
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(24, floorY); ctx.lineTo(w - 24, floorY); ctx.stroke();
    for (let m = -2; m <= 2; m++) { ctx.beginPath(); ctx.moveTo(sx(m), floorY); ctx.lineTo(sx(m), floorY + 6); ctx.stroke(); text(ctx, m + ' m', sx(m), floorY + 20, { size: 11, color: C.faint, align: 'center' }); }
    const ty = top + sceneH * .42;
    ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(255,195,107,.55)'; ctx.beginPath(); ctx.moveTo(sx(target), top + 8); ctx.lineTo(sx(target), floorY); ctx.stroke(); ctx.setLineDash([]);
    text(ctx, 'target', sx(target), top + 6, { size: 11, color: C.heat, align: 'center', base: 'top' });
    if (wind) for (let i = 0; i < 6; i++) { const yy = top + 30 + i * 22, xx = w - 40 - ((T * 120 + i * 57) % (w * .5)); ctx.strokeStyle = 'rgba(220,214,236,.25)'; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx - 26, yy); ctx.stroke(); }
    // the drone, tilted, with its thrust arrow
    const dx = sx(x); ctx.save(); ctx.translate(dx, ty); ctx.rotate(th);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-46, 0); ctx.lineTo(46, 0); ctx.stroke();
    ctx.fillStyle = C.ink; ctx.fillRect(-12, -7, 24, 14);
    for (const s of [-1, 1]) { ctx.fillRect(s * 46 - 3, -10, 6, 10); ctx.strokeStyle = 'rgba(243,238,242,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(s * 46, -12, 22, 3, 0, 0, 7); ctx.stroke(); }
    ctx.strokeStyle = C.teal; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, -62); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-6, -54); ctx.lineTo(0, -64); ctx.lineTo(6, -54); ctx.stroke();
    ctx.restore();
    // decompose thrust: the sideways part is what moves it
    const side = Math.sin(th) * 50;
    ctx.strokeStyle = C.rose; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(dx, ty + 22); ctx.lineTo(dx + side, ty + 22); ctx.stroke();
    text(ctx, 'sideways push = thrust × sin(tilt)', dx, ty + 40, { size: 11, color: C.rose, align: 'center' });
    // chart of the last 12 s
    const ch = { x: 20, y: top + sceneH + 10, w: w - 40, h: h - sceneH - top - 22 };
    const pts = hist.map(([a, b]) => [a, b]), tg = hist.map(([a, , c]) => [a, c]);
    plot(ctx, ch, [{ pts: tg, color: 'rgba(255,195,107,.6)', width: 1.5, dash: [4, 4] }, { pts, color: C.teal, width: 2.2 }], { xMin: T - 12, xMax: T, yMin: -2.4, yMax: 2.4, yLabel: 'position (m), last 12 s', xLabel: 'now', zero: true });
  }
  const loop = kit.loop((dt) => { for (let i = 0; i < 4; i++) step(dt / 4); draw();
    rOver.set((Math.max(0, peak) * 100).toFixed(0) + ' cm'); rSettle.set(settled === null ? '…' : settled.toFixed(1) + ' s'); rTilt.set((th * 57.3).toFixed(1) + '°'); });
  draw();
  return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); cv.destroy(); } };
}

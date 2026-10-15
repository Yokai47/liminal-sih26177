// the gate's sound line: flat, then three knocks, a pause, three knocks — a silent preview of what's waiting
export function gateWave(cv, getP = () => 1) {
  const x = cv.getContext('2d'); let raf = 0, t0 = performance.now();
  function draw(now) {
    raf = requestAnimationFrame(draw);
    const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    const t = (now - t0) / 1000, period = 3.4, knocks = [0, .3, .6];
    const lp = Math.max(0, Math.min(1, getP())); const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(143,140,196,0)'); g.addColorStop(Math.max(.001, lp * .98), 'rgba(246,210,177,.95)'); g.addColorStop(Math.min(.999, lp * .98 + .02), 'rgba(143,140,196,.35)'); g.addColorStop(1, 'rgba(143,140,196,0)');
    x.strokeStyle = g; x.lineWidth = 1.2; x.beginPath();
    for (let i = 0; i <= w; i += 2) {
      // the line scrolls left: x maps to a moment in the past
      const tt = t - (w - i) / w * 2.2; let a = 0;
      const ph = ((tt % period) + period) % period;
      for (const k of knocks) { const d = ph - k; if (d > 0 && d < .5) a += Math.exp(-d * 14) * Math.sin(d * 120) * (k === .6 ? 1 : .8); }
      a += Math.sin(i * .05 + t * 2) * .02 + (Math.random() - .5) * .015;
      const y = h / 2 - a * h * .38; i ? x.lineTo(i, y) : x.moveTo(i, y);
    }
    x.stroke();
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
}

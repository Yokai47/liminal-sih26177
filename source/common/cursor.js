// a soft ring that trails the pointer and stretches with speed (fine pointers only); grows over things you can press
export function liquidCursor() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return null;
  const el = document.createElement('div'); el.className = 'lc'; el.innerHTML = '<i></i>'; document.body.appendChild(el);
  document.documentElement.classList.add('has-lc');
  let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, vx = 0, vy = 0, big = 0, bigT = 0, seen = false;
  addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; if (!seen) { x = tx; y = ty; seen = true; el.style.opacity = 1; } const t = e.target.closest && e.target.closest('a, button'); bigT = t ? 1 : 0; }, { passive: true });
  addEventListener('pointerleave', () => { el.style.opacity = 0; seen = false; });
  let last = performance.now();
  (function loop(now) {
    requestAnimationFrame(loop); const dt = Math.min(.05, (now - last) / 1000); last = now;
    const k = 1 - Math.exp(-dt * 18); const nx = x + (tx - x) * k, ny = y + (ty - y) * k;
    vx += ((nx - x) / Math.max(dt, 1e-3) - vx) * .3; vy += ((ny - y) / Math.max(dt, 1e-3) - vy) * .3; x = nx; y = ny;
    big += (bigT - big) * (1 - Math.exp(-dt * 12));
    const sp = Math.min(1, Math.hypot(vx, vy) / 2400), ang = Math.atan2(vy, vx);
    el.style.transform = `translate(${x}px, ${y}px) rotate(${ang}rad) scale(${1 + sp * .9 + big * 1.4}, ${1 - sp * .45 + big * 1.4})`;
  })(last);
  return el;
}

// Act 3 simulation kit: one palette, one way to make a crisp canvas, one set of controls and readouts, so every
// simulation looks like part of the same instrument. Sims draw in CSS pixels; the kit handles device pixel ratio.
//
// A sim module looks like this:
//   export default function mount({ stage, controls, readouts, kit }) {
//     const cv = kit.canvas(stage);                 // fills the stage, resizes itself
//     const s = kit.slider(controls, { label: 'Gain', min: 0, max: 1, step: .01, value: .5, fmt: v => v.toFixed(2) });
//     const r = kit.readout(readouts, { label: 'Error', tone: 'rose' });
//     const loop = kit.loop((dt, t) => { ...simulate...; draw(cv.ctx, cv.w, cv.h); r.set('3.2 cm'); });
//     return { start: loop.start, stop: loop.stop, destroy() { loop.stop(); } };
//   }
// The page calls start() when the step opens and stop() when it closes. Never start your own requestAnimationFrame.

export const C = {
  bg: '#1b1e3d',        // stage background (dusk ink, a touch lighter than the page)
  panel: '#24284d',     // inset panels, chart backgrounds
  grid: 'rgba(220,214,236,.08)',
  line: 'rgba(220,214,236,.18)',
  ink: '#F3EEF2',       // primary text / truth lines
  muted: 'rgba(243,238,242,.66)',
  faint: 'rgba(243,238,242,.38)',
  teal: '#7FD4CF',      // the good answer: fused / estimate / free space
  rose: '#EFB1B4',      // a raw or failing signal
  danger: '#F08A7E',    // error, drift, alarm
  apricot: '#F6D2B1',   // secondary signal
  heat: '#FFC36B',      // the drone itself, people, highlights
  haze: '#8F8CC4',      // walls, structure, neutral
  dusk: '#4A4B86',      // unknown space
  mist: '#DCE4EE',
};
export const F = {
  sans: 'Geist, ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, monospace',
  serif: 'Fraunces, Georgia, serif',
};

// ------------------------------------------------------------------ canvas that fills its parent, DPR-correct
export function canvas(parent, { square = false } = {}) {
  const cv = document.createElement('canvas'); cv.className = 'k-cv';
  parent.appendChild(cv);
  const o = { cv, ctx: cv.getContext('2d'), w: 1, h: 1, dpr: 1, _fns: [] };
  const fit = () => {
    const r = parent.getBoundingClientRect();
    if ((r.width < 2 || r.height < 2) && o.w > 1) return;            // hidden (the act was closed): keep the last real size
    let w = Math.max(10, r.width), h = Math.max(10, r.height);
    if (square) w = h = Math.min(w, h);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (Math.abs(w - o.w) < .5 && Math.abs(h - o.h) < .5 && dpr === o.dpr) return;
    o.w = w; o.h = h; o.dpr = dpr; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px'; o.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const f of o._fns) f(w, h);
  };
  o.onResize = (f) => { o._fns.push(f); };
  o.fit = fit;
  const ro = new ResizeObserver(fit); ro.observe(parent); fit();
  o.destroy = () => { ro.disconnect(); cv.remove(); };
  o.clear = (col = C.bg) => { o.ctx.fillStyle = col; o.ctx.fillRect(0, 0, o.w, o.h); };
  return o;
}

// ------------------------------------------------------------------ animation loop owned by the page
let lastLoop = null;
export function loop(fn) {
  let raf = 0, last = 0, t = 0, on = false;
  const tick = (now) => { if (!on) return; raf = requestAnimationFrame(tick); let dt = (now - last) / 1000; if (!(dt > 0)) dt = .016; dt = Math.min(.05, dt); last = Math.max(last, now); t += dt; fn(dt, t); };   // the first rAF stamp can predate start(): never hand out a negative dt
  return lastLoop = {
    prime(sec = 6, step = 1 / 20) { const n = Math.round(sec / step); for (let i = 0; i < n; i++) { t += step; fn(step, t); } },
    start() { if (on) return; on = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    stop() { on = false; cancelAnimationFrame(raf); },
    get running() { return on; },
  };
}

// ------------------------------------------------------------------ controls
let uid = 0;
export function slider(parent, { label, min, max, step = 1, value, fmt = (v) => String(v), onInput = () => {} }) {
  const id = 'ks' + (++uid);
  const el = document.createElement('div'); el.className = 'k-slider';
  el.innerHTML = `<label for="${id}"><span>${label}</span><output></output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">`;
  parent.appendChild(el);
  const inp = el.querySelector('input'), out = el.querySelector('output');
  const paint = () => { const v = +inp.value; out.textContent = fmt(v); inp.style.setProperty('--p', ((v - min) / (max - min) * 100).toFixed(1) + '%'); };
  inp.addEventListener('input', () => { paint(); onInput(+inp.value); });
  paint();
  return { el, get: () => +inp.value, set(v) { inp.value = v; paint(); }, input: inp };
}
export function toggle(parent, { label, options, value, onChange = () => {} }) {
  const el = document.createElement('div'); el.className = 'k-toggle';
  el.innerHTML = (label ? `<span class="k-lab">${label}</span>` : '') + `<div class="k-seg" role="radiogroup">${options.map((o) => `<button type="button" role="radio" data-v="${o.v}">${o.label}</button>`).join('')}</div>`;
  parent.appendChild(el);
  let cur = value;
  const btns = [...el.querySelectorAll('button')];
  const paint = () => btns.forEach((b) => { const on = b.dataset.v === String(cur); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  btns.forEach((b) => b.addEventListener('click', () => { const o = options.find((x) => String(x.v) === b.dataset.v); cur = o.v; paint(); onChange(cur); }));
  paint();
  return { el, get: () => cur, set(v) { cur = v; paint(); } };
}
export function button(parent, { label, onClick = () => {}, kind = '' }) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'k-btn ' + kind; b.textContent = label;
  b.addEventListener('click', onClick); parent.appendChild(b); return b;
}
export function readout(parent, { label, tone = 'teal', value = '—' }) {
  const el = document.createElement('div'); el.className = 'k-read k-' + tone;
  el.innerHTML = `<b>${value}</b><span>${label}</span>`; parent.appendChild(el);
  const b = el.querySelector('b'); let last = '';
  return { el, set(v) { v = String(v); if (v !== last) { b.textContent = v; last = v; } }, tone(t) { el.className = 'k-read k-' + t; } };
}
export function hint(parent, html) { const p = document.createElement('p'); p.className = 'k-hint'; p.innerHTML = html; parent.appendChild(p); return p; }

// ------------------------------------------------------------------ drawing helpers (CSS pixels)
export function text(ctx, s, x, y, { size = 12, color = C.muted, font = F.sans, weight = 400, align = 'left', base = 'alphabetic' } = {}) {
  ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, y);
}
export function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
// a small chart: rect = {x, y, w, h}; series = [{ pts: [[x, y]...], color, width, dash, fill }]; x and y in data units
export function plot(ctx, rect, series, { xMin = 0, xMax = 1, yMin = 0, yMax = 1, xLabel = '', yLabel = '', panel = true, zero = false } = {}) {
  const { x, y, w, h } = rect;
  if (panel) { ctx.fillStyle = C.panel; roundRect(ctx, x, y, w, h, 10); ctx.fill(); }
  const px = (v) => x + 14 + (v - xMin) / (xMax - xMin) * (w - 28), py = (v) => y + h - 22 - (v - yMin) / (yMax - yMin) * (h - 40);
  ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 14, y + 16); ctx.lineTo(x + 14, y + h - 22); ctx.lineTo(x + w - 14, y + h - 22); ctx.stroke();
  if (zero && yMin < 0 && yMax > 0) { ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(x + 14, py(0)); ctx.lineTo(x + w - 14, py(0)); ctx.stroke(); }
  for (const s of series) {
    if (!s.pts || s.pts.length < 2) continue;
    ctx.save(); ctx.beginPath(); ctx.rect(x + 14, y + 10, w - 28, h - 30); ctx.clip();
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []); ctx.lineJoin = 'round';
    ctx.beginPath(); s.pts.forEach(([a, b], i) => { const X = px(a), Y = py(b); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke();
    if (s.fill) { ctx.lineTo(px(s.pts[s.pts.length - 1][0]), py(yMin)); ctx.lineTo(px(s.pts[0][0]), py(yMin)); ctx.closePath(); ctx.fillStyle = s.fill; ctx.fill(); }
    ctx.restore(); ctx.setLineDash([]);
  }
  if (yLabel) text(ctx, yLabel, x + 20, y + 14, { size: 11, color: C.faint });
  if (xLabel) text(ctx, xLabel, x + w - 14, y + h - 7, { size: 11, color: C.faint, align: 'right' });
  return { px, py };
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function rng(seed = 1) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function gauss(r = Math.random) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }


// a β₀ / pocket count that reads calmly: it only starts showing once the sweep is closing in (the raw count first
// drops to latchAt or below; before that the unsearched space is still breaking into many pieces as drones cut
// through it), and then it changes at most every `hold` seconds of wall time. A new mission (sim time going back)
// resets it.
export function stableCount({ latchAt = 12, hold = .6 } = {}) {
  let shown = null, t = -1e9, last = -1, latched = false;
  return { update(raw, simNow) {
    if (simNow < last - .001) { latched = false; shown = null; t = -1e9; } last = simNow;
    if (raw <= latchAt) latched = true;
    if (!latched) return '…';
    const now = performance.now() / 1000;
    if (shown === null || raw === 0 || now - t >= hold) { shown = raw; t = now; }
    return String(shown);
  } };
}

export const takeLastLoop = () => { const l = lastLoop; lastLoop = null; return l; };
export const kit = { C, F, canvas, loop, takeLastLoop, stableCount, slider, toggle, button, readout, hint, text, roundRect, plot, lerp, clamp, rng, gauss };
export default kit;

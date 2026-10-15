// The bottom dock: play/pause, speed, the scrubber with chapter segments (labelled by concept), time, lenses,
// Director and Drone view.
import { LENSES } from '../engine/lenses.js';
export const ICON = {
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9.5-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.5" y="2.5" width="3.2" height="11" rx="1"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="1"/></svg>',
  replay: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.5v2.8h2.8"/></svg>',
  eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
};
const pad = (n) => String(n).padStart(2, '0');
export const mmss = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;

export function createDock(el, h = {}) {
  el.innerHTML = `<div class="a4row1"><button class="a4play" type="button" aria-label="Play">${ICON.play}</button>
      <div class="a4seg" role="radiogroup" aria-label="Speed">${[1, 2, 4].map((s) => `<button type="button" role="radio" data-s="${s}">${s}x</button>`).join('')}</div>
      <div class="a4scrub" role="slider" aria-label="Mission timeline" tabindex="0"><div class="segs"></div><div class="head"></div><div class="tip"></div></div>
      <div class="a4time"><b class="t">00:00</b><span class="slash" style="display:inline;color:inherit;font-size:inherit"> / </span><span class="d" style="display:inline;color:inherit;font-size:inherit">00:00</span><span class="s"></span></div></div>
    <div class="a4row2"><div class="a4lens" role="radiogroup" aria-label="Lenses"><span class="k">Lenses</span>${LENSES.map((l) => `<button class="a4chip" type="button" role="radio" data-l="${l.id}" title="${l.tip}">${l.name}</button>`).join('')}</div>
      <div class="a4dirw" style="display:flex;gap:8px"><button class="a4chip a4dir" type="button" data-a="dir" title="The director frames the action; drag the view to take over"><i></i>Director</button><button class="a4chip" type="button" data-a="drone" title="Look through a drone's camera">Drone view</button></div></div>`;
  const play = el.querySelector('.a4play'), scrub = el.querySelector('.a4scrub'), segs = el.querySelector('.segs'), head = el.querySelector('.head'), tip = el.querySelector('.tip');
  const tEl = el.querySelector('.t'), dEl = el.querySelector('.d'), sEl = el.querySelector('.a4time .s');
  const dirB = el.querySelector('[data-a="dir"]'), droneB = el.querySelector('[data-a="drone"]');
  play.addEventListener('click', () => h.onPlay && h.onPlay());
  el.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => h.onSpeed && h.onSpeed(+b.dataset.s)));
  el.querySelectorAll('[data-l]').forEach((b) => b.addEventListener('click', () => h.onLens && h.onLens(b.dataset.l)));
  dirB.addEventListener('click', () => h.onDirector && h.onDirector());
  droneB.addEventListener('click', () => h.onDrone && h.onDrone());
  let chapters = [], dur = 1, segEls = [], lblEls = [], evEls = [];
  function setTimeline(ch, duration, marks = []) {
    chapters = ch; dur = Math.max(1, duration);
    segs.innerHTML = ''; segEls = []; lblEls.forEach((l) => l.remove()); lblEls = []; evEls.forEach((e) => e.remove()); evEls = [];
    for (const c of ch) {
      const s = document.createElement('div'); s.className = 'sg'; s.innerHTML = '<s></s>'; segs.appendChild(s); segEls.push(s);
      const l = document.createElement('div'); l.className = 'lbl'; l.textContent = c.label || c.title; scrub.appendChild(l); lblEls.push(l);
    }
    for (const m of marks) { const e = document.createElement('div'); e.className = 'ev'; e.style.background = m.color || 'var(--heat)'; e.dataset.p = m.p; scrub.appendChild(e); evEls.push(e); }
    layout();
  }
  function layout() {
    const W = scrub.clientWidth; if (!W) return; const gap = 3, n = chapters.length, usable = W - gap * Math.max(0, n - 1);
    let x = 0;
    chapters.forEach((c, i) => { const w = Math.max(4, usable * (c.p1 - c.p0) / dur); segEls[i].style.width = w + 'px'; const l = lblEls[i]; l.style.left = x + 'px'; l.style.width = Math.max(0, w - 4) + 'px'; l.style.display = w < 34 ? 'none' : ''; c._x = x; c._w = w; x += w + gap; });
    for (const e of evEls) e.style.left = pToX(+e.dataset.p) + 'px';
  }
  const pToX = (p) => { for (const c of chapters) if (p <= c.p1 || c === chapters[chapters.length - 1]) return c._x + Math.max(0, Math.min(1, (p - c.p0) / Math.max(1e-6, c.p1 - c.p0))) * c._w; return 0; };
  const xToP = (x) => { for (let i = 0; i < chapters.length; i++) { const c = chapters[i]; if (x <= c._x + c._w + 1.5 || i === chapters.length - 1) return c.p0 + Math.max(0, Math.min(1, (x - c._x) / Math.max(1, c._w))) * (c.p1 - c.p0); } return 0; };
  const ro = new ResizeObserver(layout); ro.observe(scrub);
  // seek by click or drag
  let drag = false;
  const seekAt = (e) => { const r = scrub.getBoundingClientRect(); const p = xToP(e.clientX - r.left); h.onSeek && h.onSeek(p); };
  scrub.addEventListener('pointerdown', (e) => { drag = true; scrub.setPointerCapture(e.pointerId); seekAt(e); h.onScrub && h.onScrub(true); });
  scrub.addEventListener('pointermove', (e) => { const r = scrub.getBoundingClientRect(), x = e.clientX - r.left, p = xToP(x); const c = chapters.find((q) => p >= q.p0 && p <= q.p1) || chapters[0];
    if (c) { tip.innerHTML = `${c.title}<small>${mmss(p)}${c.concept ? ' · ' + c.conceptName : ''}</small>`; tip.style.left = Math.max(80, Math.min(r.width - 80, x)) + 'px'; }
    if (drag) seekAt(e); });
  const end = () => { if (drag) { drag = false; h.onScrub && h.onScrub(false); } };
  scrub.addEventListener('pointerup', end); scrub.addEventListener('pointercancel', end);
  scrub.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { h.onStep && h.onStep(5); e.preventDefault(); } if (e.key === 'ArrowLeft') { h.onStep && h.onStep(-5); e.preventDefault(); } });
  let lastKey = '';
  function update(p, playing, simInfo) {
    const ci = chapters.findIndex((c) => p >= c.p0 && p < c.p1 + 1e-6);
    segEls.forEach((s, i) => { const c = chapters[i]; const f = Math.max(0, Math.min(1, (p - c.p0) / Math.max(1e-6, c.p1 - c.p0))); s.firstChild.style.width = (f * 100).toFixed(2) + '%'; s.classList.toggle('cur', i === ci); });
    lblEls.forEach((l, i) => l.classList.toggle('cur', i === ci));
    head.style.left = pToX(p) + 'px';
    const key = (playing ? 'p' : 's') + Math.floor(p) + (simInfo || '');
    if (key !== lastKey) { lastKey = key; play.innerHTML = playing ? ICON.pause : ICON.play; play.setAttribute('aria-label', playing ? 'Pause' : 'Play'); tEl.textContent = mmss(p); dEl.textContent = mmss(dur); sEl.textContent = simInfo || ''; scrub.setAttribute('aria-valuenow', Math.round(p)); }
  }
  function setSpeed(s) { el.querySelectorAll('[data-s]').forEach((b) => { const on = +b.dataset.s === s; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); }
  function setLens(id) { el.querySelectorAll('[data-l]').forEach((b) => { const on = b.dataset.l === id; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); }
  function setUser(u) { dirB.classList.toggle('user', u); dirB.title = u ? 'Give the camera back to the director' : 'The director frames the action; drag the view to take over'; }
  function setDrone(on) { droneB.classList.toggle('on', on); droneB.textContent = on ? 'Drone view on' : 'Drone view'; }
  return { setTimeline, update, setSpeed, setLens, setUser, setDrone, layout, dispose() { ro.disconnect(); } };
}

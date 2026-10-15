// The start screen: four mission cards with procedural posters and a primary "Play all four"; also the small mission
// menu in the top bar, the simulating overlay and the handover report.
import { POSTERS } from './posters.js';
import { CONCEPT } from './cards.js';
import { ICON } from './dock.js';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function createPicker(el, metas, { onPick, onAll }) {
  el.className = 'a4over a4pick hide';
  el.innerHTML = `<div class="in"><p class="kick">Act 4 · The swarm at work</p><h1>Watch the whole system <em>work on its own</em></h1>
    <p class="lede">Each mission is simulated in full first, then played back as a film. Nothing to fly. Pause, scrub, switch lenses or grab the camera; the concept cards show the physics while it is doing the work.</p>
    <div class="acts"><button class="a4pri" type="button" data-a="all">${ICON.play}Play all four</button><span class="note">About ten minutes · every visit is a new seed</span></div>
    <div class="a4grid">${metas.map((m, i) => `<button class="a4m" type="button" data-m="${m.id}"><canvas width="480" height="300" aria-hidden="true"></canvas><div class="b"><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${esc(m.title)}</h3><p class="pl">${esc(m.place)}</p><p class="md">${esc(m.mode)}</p><ul>${m.concepts.slice(0, 4).map((c) => `<li>${esc(CONCEPT[c]?.name || c)}</li>`).join('')}</ul><span class="go">Watch this mission</span></div></button>`).join('')}</div></div>`;
  el.querySelector('[data-a="all"]').addEventListener('click', () => onAll());
  el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.m)));
  const posters = [...el.querySelectorAll('.a4m canvas')];
  const draw = (t = 0) => posters.forEach((cv, i) => { const m = metas[i], x = cv.getContext('2d'); const r = cv.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1); const W = Math.max(200, Math.round(r.width * dpr)), H = Math.max(120, Math.round(r.height * dpr)); if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; } x.setTransform(1, 0, 0, 1, 0, 0); try { POSTERS[m.id](x, W, H, t); } catch (e) { console.warn(e); } });
  let shown = false;
  return {
    show() { el.classList.remove('hide'); shown = true; requestAnimationFrame(() => draw()); setTimeout(() => draw(), 120); },
    hide() { el.classList.add('hide'); shown = false; },
    get shown() { return shown; }, draw,
  };
}
export function createMissionMenu(btnWrap, metas, { onPick, onAll }) {
  btnWrap.innerHTML = `<button class="a4pill" type="button" aria-haspopup="true"><span class="cur">Choose a mission</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></button>
    <div class="a4menu" role="menu">${metas.map((m, i) => `<button type="button" role="menuitem" data-m="${m.id}"><i>${String(i + 1).padStart(2, '0')}</i><b>${esc(m.title)}</b><span>${esc(m.place)}</span></button>`).join('')}<button type="button" role="menuitem" data-m="__all"><i class="pl">${ICON.play}</i><b>Play all four</b><span>One tour, back to back</span></button></div>`;
  const btn = btnWrap.querySelector('.a4pill'), menu = btnWrap.querySelector('.a4menu'), cur = btnWrap.querySelector('.cur');
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('on'); });
  menu.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; menu.classList.remove('on'); if (b.dataset.m === '__all') onAll(); else onPick(b.dataset.m); });
  const close = (e) => { if (!btnWrap.contains(e.target)) menu.classList.remove('on'); };
  document.addEventListener('pointerdown', close);
  return { get open() { return menu.classList.contains('on'); }, close() { menu.classList.remove('on'); }, set(id) { const m = metas.find((q) => q.id === id); cur.textContent = m ? m.title : 'Choose a mission'; menu.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === id)); }, dispose() { document.removeEventListener('pointerdown', close); } };
}
export function createSimOverlay(el) {
  el.className = 'a4over a4sim hide';
  el.innerHTML = '<div class="box"><p class="k">Simulating the mission</p><h2></h2><p class="pl"></p><div class="bar"><s></s></div><p class="pc">0 %</p><p class="why">The whole mission runs first, from a new seed, and is recorded. Then it plays back as a film you can scrub.</p></div>';
  const h2 = el.querySelector('h2'), pl = el.querySelector('.pl'), bar = el.querySelector('.bar s'), pc = el.querySelector('.pc'), k = el.querySelector('.k');
  return {
    show(meta, label = 'Simulating the mission') { k.textContent = label; h2.textContent = meta.title; pl.textContent = meta.place; bar.style.width = '0%'; pc.textContent = '0 %'; el.classList.remove('hide'); },
    progress(p, label) { el.classList.remove('failed'); bar.style.width = (p * 100).toFixed(1) + '%'; pc.textContent = label || `simulating: ${Math.round(p * 100)} %`; },
    hide() { el.classList.add('hide'); el.classList.remove('failed'); },
    // a mission that could not be simulated: say so, offer to try again (with a new seed) or to go back
    fail(text, onRetry, onBack) {
      el.classList.remove('hide'); el.classList.add('failed'); k.textContent = 'Something went wrong'; pc.textContent = text;
      let row = el.querySelector('.row'); if (!row) { row = document.createElement('div'); row.className = 'row'; el.querySelector('.box').appendChild(row); }
      row.innerHTML = '<button class="a4pri" type="button" data-a="retry">Try again</button><button class="a4sec" type="button" data-a="back">Back to the missions</button>';
      row.querySelector('[data-a="retry"]').addEventListener('click', () => onRetry && onRetry());
      row.querySelector('[data-a="back"]').addEventListener('click', () => onBack && onBack());
    },
  };
}

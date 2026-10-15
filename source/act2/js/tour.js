/* LIMINAL · Act 2 · tour.js — first-time guide (spotlight + pointer + card for every element on screen),
   the expandable reasoning history, and the end-of-mission nudge toward it. */

// ---------------------------------------------------------------- the guide
export function createTour(ui, { PH, getMode, onDone }) {
  injectCSS();
  const root = ui.root;
  const wrap = document.createElement('div'); wrap.className = 'a2tour'; wrap.hidden = true;
  wrap.innerHTML = `<svg class="a2tarrow"><defs><marker id="a2ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs><path class="p" marker-end="url(#a2ah)"/></svg>
    <div class="a2spot"></div>
    <div class="a2coach"><div class="a2k"><span class="n"></span></div><h4></h4><div class="b"></div>
      <div class="a2cbtns"><button class="skip">Skip the guide</button><span></span><button class="back">Back</button><button class="next">Next</button></div><div class="a2keys">${PH ? '' : '→ / Enter next · ← back · Esc skip'}</div></div>`;
  root.appendChild(wrap);
  const spot = wrap.querySelector('.a2spot'), card = wrap.querySelector('.a2coach'), path = wrap.querySelector('path.p');
  const q = s => card.querySelector(s);
  const rel = (r) => { const R = root.getBoundingClientRect(); return { x: r.left - R.left, y: r.top - R.top, w: r.width, h: r.height }; };
  const rectOf = (...els) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const e of els) { if (!e) continue; const r = e.getBoundingClientRect(); if (!r.width) continue; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); } return rel({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }); };
  const dot = c => `<i class="d" style="background:${c}"></i>`;

  const steps = [
    { tab: null, el: () => { const f = rel(ui.fpv.getBoundingClientRect()); return { x: f.x + f.w * .28, y: f.y + f.h * .22, w: f.w * .44, h: f.h * .42 }; },
      t: 'This is what the drone sees',
      b: `Its camera, lit only by its own lamp. The <b style="color:#9fdcff">blue dots are LiDAR</b>: every dot is one laser hit, so the dots are the 3-D map being built. Boxes and labels appear on things it recognises: people, fire, hazards.` },
    { tab: null, el: () => rectOf(ui.mode, ui.spd, ui.rtl),
      t: 'Who is flying',
      b: `<b>AUTO</b>: the drone decides everything by itself. <b>MANUAL</b>: you fly; ${PH ? 'hold the screen to go forward, drag to turn' : 'W / S, A / D or the mouse, Q / E to slide sideways'}. Any key or touch takes over, and AUTO hands it back.<br><b>×1 ×2 ×4</b> speed up AUTO. <b>⌂</b> sends it home to land and ends the mission.` },
    { tab: null, el: () => rectOf(ui.sens),
      t: 'Switch sensors off, any time',
      b: `Each switch removes one sensor. What to expect:<ul>
        <li>${dot('#60c8ff')}<b>LiDAR</b> off: no map, so it stops, then flies home on the map it already has.</li>
        <li>${dot('#f4f4f2')}<b>Camera</b> off: it can’t tell a person from a warm generator → false alarm.</li>
        <li>${dot('#ff7a1a')}<b>Thermal</b> off: a shop mannequin counts as a person → false alarm.</li>
        <li>${dot('#b49cff')}<b>Acoustic</b> off: no hint where to look, so the search takes longer.</li>
        <li>${dot('#5ef2b5')}<b>Optical flow</b> off: its position slides in long corridors.</li>
        <li><b>LiDAR + flow</b> off: it no longer knows where it is → lands on the spot.</li></ul>` },
    { tab: 'SYS', el: () => rectOf(ui.osd),
      t: 'The flight computer, live',
      b: `Like a game’s performance overlay, but for the drone. Flight mode, how unsure it is of its own position (<b>σ</b>, in metres), whether SLAM is tracking, map size, how fast the AI chip runs, and the battery, including the energy it needs to get home.` },
    { tab: null, el: () => rectOf(ui.pip),
      t: 'Thermal camera',
      b: `Body heat glows yellow; cold things are purple. It sees through smoke, but heat alone can’t say <i>what</i> is warm. That is why a person needs the camera too.`, skip: () => ui.pip.hidden },
    { tab: null, el: () => rectOf(ui.ring),
      t: 'Evidence ring',
      b: `For whatever it is checking right now, four arcs fill up: ${dot('#b49cff')}heard, ${dot('#ff7a1a')}warm, ${dot('#f4f4f2')}looks like a person, ${dot('#60c8ff')}LiDAR points on it. A survivor is only <b>CONFIRMED</b> when camera and thermal agree.` },
    { tab: 'MAP', el: () => rectOf(ui.map),
      t: 'Its own map',
      b: `Built only from its LiDAR; nobody gave it a floor plan. <span class="lg f"></span>free, <span class="lg o"></span>wall or obstacle, <span class="lg u"></span>never seen, <span class="lg fr"></span><b>frontier</b>, where known meets unknown. Each <b>F</b> label is a frontier with its cost; it flies to the lowest. ${PH ? '' : 'Hover any cell to see the evidence stored in it.'}` },
    { tab: 'AUDIO', el: () => rectOf(ui.raw.parentNode, ui.clean.parentNode, ui.mon),
      t: 'What it hears',
      b: `<b>RAW</b>: everything its 4 microphones pick up, its own propellers included. <b>CLEAN</b>: after the propeller noise is removed and only human sounds are kept.<br>Use <b>off / raw mic / clean</b> to listen yourself. Turn your sound on; there is water, sparking wires, fire, creaking, a siren… and people.` },
    { tab: 'AUDIO', el: () => rectOf(ui.cls.parentNode),
      t: 'What made the sound, and from where',
      b: `The bars show how sure it is about each kind of sound: <b style="color:#c9b8ff">voice, moan, tapping</b> (people) versus water, sparks, fire, creaks, siren. The compass shows the direction of each human sound. Directions taken from different spots cross on the map and pin down where the person is, even behind a wall.` },
    { tab: 'THINK', el: () => rectOf(ui.think),
      t: 'What it is thinking',
      b: `<b>NOW / WHY / NEXT</b> in plain words, then every decision with its numbers: which frontier and why, what it heard, what it ruled out. <b>⤢ history</b> opens the full record.` },
    { tab: null, el: null,
      t: () => getMode() === 'MANUAL' ? 'Your turn' : 'Ready',
      b: () => getMode() === 'MANUAL' ? `It has taken off and scanned once. Fly toward the unknown (dark on the map), hover still for a moment to scan, and watch the map grow. The <b>?</b> button brings this guide back.`
        : `It has taken off and made its first scan. Press start and it will explore, listen and report on its own. Take the controls whenever you like. The <b>?</b> button brings this guide back.`, last: true },
  ];

  let i = 0, active = false, short = false;
  const live = () => steps.filter(s => !(s.skip && s.skip()));
  function show(k) {
    const S = live(); i = Math.max(0, Math.min(S.length - 1, k)); const s = S[i];
    if (PH && s.tab && ui.setTab) ui.setTab(s.tab);
    q('.n').textContent = `GUIDE · ${i + 1} / ${S.length}`;
    q('h4').textContent = typeof s.t === 'function' ? s.t() : s.t; q('.b').innerHTML = typeof s.b === 'function' ? s.b() : s.b;
    q('.back').style.visibility = i ? 'visible' : 'hidden'; q('.next').textContent = s.last ? (getMode() === 'MANUAL' ? 'Start flying' : 'Start the mission') : 'Next';
    q('.skip').style.visibility = s.last ? 'hidden' : 'visible';
    requestAnimationFrame(() => place(s));
  }
  function place(s) {
    const R = root.getBoundingClientRect(), W = R.width, H = R.height, pad = 12;
    const cw = Math.min(PH ? W - 24 : 340, W - 24); card.style.width = cw + 'px'; const ch = card.offsetHeight;
    if (!s.el) { spot.style.opacity = 0; path.style.opacity = 0; card.style.left = (W - cw) / 2 + 'px'; card.style.top = (H - ch) / 2 + 'px'; return; }
    const T = s.el(); const m = 6; spot.style.opacity = 1;
    Object.assign(spot.style, { left: T.x - m + 'px', top: T.y - m + 'px', width: T.w + 2 * m + 'px', height: T.h + 2 * m + 'px' });
    const gap = 84, cands = [];
    const fitsX = x => x >= pad && x + cw <= W - pad, fitsY = y => y >= pad && y + ch <= H - pad, cy = y => Math.max(pad, Math.min(H - ch - pad, y)), cx = x => Math.max(pad, Math.min(W - cw - pad, x));
    cands.push({ side: 'right', x: T.x + T.w + gap, y: cy(T.y + T.h / 2 - ch / 2) }); cands.push({ side: 'left', x: T.x - gap - cw, y: cy(T.y + T.h / 2 - ch / 2) });
    cands.push({ side: 'below', x: cx(T.x + T.w / 2 - cw / 2), y: T.y + T.h + gap }); cands.push({ side: 'above', x: cx(T.x + T.w / 2 - cw / 2), y: T.y - gap - ch });
    const order = PH ? ['below', 'above', 'right', 'left'] : T.x + T.w / 2 > W * .55 ? ['left', 'below', 'above', 'right'] : ['right', 'below', 'above', 'left'];
    let c = null; for (const sd of order) { const k = cands.find(o => o.side === sd); if (fitsX(k.x) && fitsY(k.y)) { c = k; break; } }
    if (!c) { c = { side: 'over', x: cx(W / 2 - cw / 2), y: T.y > H / 2 ? pad : H - ch - pad }; }
    card.style.left = c.x + 'px'; card.style.top = c.y + 'px';
    // the pointer: a curved arrow from the card's nearest edge to the element's nearest edge
    const cr = { x: c.x, y: c.y, w: cw, h: ch };
    const near = (r, p) => [Math.max(r.x, Math.min(r.x + r.w, p[0])), Math.max(r.y, Math.min(r.y + r.h, p[1]))];
    const tc = [T.x + T.w / 2, T.y + T.h / 2], cc = [cr.x + cr.w / 2, cr.y + cr.h / 2];
    let a = near(cr, tc), b = near({ x: T.x - m - 4, y: T.y - m - 4, w: T.w + 2 * m + 8, h: T.h + 2 * m + 8 }, cc);
    if (c.side === 'over') { a = [cc[0], c.y > T.y ? cr.y : cr.y + ch]; b = near({ x: T.x, y: T.y, w: T.w, h: T.h }, a); }
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, bend = Math.min(60, L * .3);
    const qx = mx - dy / L * bend, qy = my + dx / L * bend;
    path.setAttribute('d', `M${a[0]} ${a[1]} Q${qx} ${qy} ${b[0]} ${b[1]}`); path.style.opacity = L > 18 ? 1 : 0;
  }
  function start(opts = {}) { active = true; short = !!opts.short; wrap.hidden = false; root.classList.add('touring'); show(0); addEventListener('keydown', key, true); addEventListener('resize', re); }
  function end(skipped) { if (!active) return; active = false; wrap.hidden = true; root.classList.remove('touring'); removeEventListener('keydown', key, true); removeEventListener('resize', re); if (PH && ui.setTab) ui.setTab('MAP'); onDone && onDone(skipped); }
  const re = () => active && place(live()[i]);
  function key(e) { if (!active) return; const k = e.key; if (k === 'ArrowRight' || k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); next(); } else if (k === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); show(i - 1); } else if (k === 'Escape') { e.preventDefault(); end(true); } else { e.stopPropagation(); } }
  function next() { const S = live(); if (i >= S.length - 1) end(false); else show(i + 1); }
  q('.next').onclick = next; q('.back').onclick = () => show(i - 1); q('.skip').onclick = () => end(true);
  return { start, end, get active() { return active; }, reposition: re };
}

// ---------------------------------------------------------------- reasoning history
const GROUPS = [
  ['All', null],
  ['Decisions', /^(FRONTIER|PLAN|PRIOR|INVEST|RTL|LAND|MODE|ARM|SETPOINT|BOOT|END)$/],
  ['Map & SLAM', /^(MAP|SCAN|SLAM|LOOP|LIDAR)$/],
  ['Sound', /^(ACOUSTIC|DoA|OCCLUDED|LOCATE|TRACK)$/],
  ['Detections', /^(DETECT|PERSON|LIKELY|REJECT|FALSE\+|HAZARD)$/],
  ['Safety', /^(FAILSAFE|CONTACT|SENSOR)$/],
];
export function createHistory(ui, { getLog, fmt, esc }) {
  injectCSS();
  const box = document.createElement('div'); box.className = 'a2hist'; box.hidden = true;
  box.innerHTML = `<header><b>REASONING HISTORY</b><span class="cnt"></span><button class="x" title="close">✕</button></header>
    <div class="chips">${GROUPS.map(([n], k) => `<button data-g="${k}" class="${k ? '' : 'on'}">${n}<i></i></button>`).join('')}</div>
    <div class="note">Every line is one thing the drone decided, measured or ruled out, in order. Times are mission time.</div>
    <div class="list"></div>`;
  ui.root.appendChild(box);
  const list = box.querySelector('.list'); let g = 0, shown = 0, open = false;
  box.querySelector('.x').onclick = () => close();
  box.querySelector('.chips').addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (!b) return; g = +b.dataset.g; box.querySelectorAll('.chips button').forEach(x => x.classList.toggle('on', x === b)); shown = 0; list.innerHTML = ''; paint(true); });
  const inGroup = (log, k) => { const re = GROUPS[k][1]; if (!re) return log.map(() => true); let prev = false; return log.map(l => { const ok = l.tag ? re.test(l.tag) : prev; prev = ok; return ok; }); };
  function paint(force) {
    if (!open) return; const log = getLog(); const keep = inGroup(log, g);
    box.querySelectorAll('.chips button').forEach((b, k) => { b.querySelector('i').textContent = ' ' + inGroup(log, k).filter(Boolean).length; });
    box.querySelector('.cnt').textContent = `${log.length} entries`;
    if (!force && shown === log.length) return;
    const atBottom = list.scrollTop + list.clientHeight > list.scrollHeight - 30;
    let html = ''; for (let k = shown; k < log.length; k++) { if (!keep[k]) continue; const l = log[k]; html += `<p class="${l.cls}"><t>${fmt(l.t)}</t><g>${l.tag || ''}</g>${esc(l.text)}</p>`; }
    if (html) list.insertAdjacentHTML('beforeend', html); shown = log.length;
    if (atBottom || force) list.scrollTop = list.scrollHeight;
  }
  function show() { open = true; box.hidden = false; shown = 0; list.innerHTML = ''; paint(true); }
  function close() { open = false; box.hidden = true; }
  return { show, close, paint, get open() { return open; }, reset() { shown = 0; list.innerHTML = ''; } };
}

// ---------------------------------------------------------------- one-off pointer (end of mission)
export function nudge(ui, target, text, { side = 'left', ms = 16000, xMax = Infinity } = {}) {
  injectCSS();
  const root = ui.root, R = root.getBoundingClientRect(), r = target.getBoundingClientRect(); if (!r.width) return () => {};
  const n = document.createElement('div'); n.className = 'a2nudge';
  n.innerHTML = `<svg class="a2tarrow"><defs><marker id="a2ah2" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs><path class="p" marker-end="url(#a2ah2)"/></svg><div class="t">${text}</div>`;
  root.appendChild(n);
  const t = n.querySelector('.t'), p = n.querySelector('path.p'); const tw = Math.min(260, R.width - 24); t.style.width = tw + 'px';
  const T = { x: r.left - R.left, y: r.top - R.top, w: r.width, h: r.height };
  let x = side === 'left' ? Math.min(T.x - tw - 70, xMax - tw) : T.x + T.w / 2 - tw / 2, y = side === 'left' ? T.y + T.h / 2 - t.offsetHeight - 30 : T.y - t.offsetHeight - 60;
  x = Math.max(12, Math.min(R.width - tw - 12, x)); y = Math.max(12, Math.min(R.height - t.offsetHeight - 12, y));
  t.style.left = x + 'px'; t.style.top = y + 'px';
  const a = side === 'left' ? [x + tw, y + t.offsetHeight * .6] : [x + tw / 2, y + t.offsetHeight], b = side === 'left' ? [T.x - 8, T.y + T.h / 2] : [T.x + T.w / 2, T.y - 6];
  p.setAttribute('d', `M${a[0]} ${a[1]} Q${(a[0] + b[0]) / 2} ${Math.max(a[1], b[1]) + 40} ${b[0]} ${b[1]}`);
  target.classList.add('a2pulse');
  const kill = () => { n.remove(); target.classList.remove('a2pulse'); }; setTimeout(kill, ms); n.addEventListener('click', kill);
  return kill;
}

function injectCSS() {
  if (document.getElementById('a2tourcss')) return;
  const s = document.createElement('style'); s.id = 'a2tourcss';
  s.textContent = `
.a2tour{position:absolute;inset:0;z-index:30;pointer-events:auto}
.a2spot{position:absolute;border-radius:12px;box-shadow:0 0 0 4000px rgba(2,8,20,.74),0 0 0 1.5px #9fdcff,0 0 28px 4px rgba(96,200,255,.35);transition:left .4s cubic-bezier(.2,.8,.2,1),top .4s cubic-bezier(.2,.8,.2,1),width .4s cubic-bezier(.2,.8,.2,1),height .4s cubic-bezier(.2,.8,.2,1),opacity .3s;pointer-events:none}
.a2coach{position:absolute;background:rgba(5,16,38,.97);border:1px solid #2b4a6b;border-radius:14px;padding:14px 16px 12px;box-shadow:0 14px 50px rgba(0,0,0,.55);transition:left .4s cubic-bezier(.2,.8,.2,1),top .4s cubic-bezier(.2,.8,.2,1);font:12px/1.45 "Geist Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;color:#e9eef4}
.a2coach .a2k{margin-bottom:4px;color:#60c8ff}.a2coach h4{font:500 19px/1.2 Geist,system-ui,sans-serif;margin:0 0 8px;color:#fff;letter-spacing:-.01em}
.a2coach .b{font-size:11.5px;color:#c8d6e4}.a2coach .b b{color:#fff;font-weight:600}.a2coach .b ul{margin:6px 0 0;padding:0;list-style:none}.a2coach .b li{margin:0 0 5px;padding-left:14px;position:relative}
.a2coach .d{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:0}.a2coach .b li .d{position:absolute;left:0;top:4px}
.a2coach .lg{display:inline-block;width:9px;height:9px;border-radius:2px;margin:0 4px 0 2px;vertical-align:-1px}.a2coach .lg.f{background:#2b7fb4}.a2coach .lg.o{background:#ffe7b0}.a2coach .lg.u{background:#0b1a33;border:1px solid #2b4a6b}.a2coach .lg.fr{background:#ff4fd8}
.a2cbtns{display:flex;gap:8px;align-items:center;margin-top:12px}.a2cbtns span{flex:1}.a2cbtns button{font:inherit;cursor:pointer}
.a2cbtns .skip{background:none;border:0;color:#6f8aa6;padding:4px 0;font-size:10.5px}.a2cbtns .back{background:none;border:1px solid #2b4a6b;border-radius:999px;padding:6px 13px;color:#c8d6e4;font-size:11px}
.a2cbtns .next{background:#F4F4F2;border:0;border-radius:999px;padding:7px 16px;color:#030d22;font-weight:600;font-size:11px}
.a2keys{font-size:9.5px;color:#4f6a86;margin-top:6px;text-align:right}
.a2tarrow{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.a2tarrow path.p{fill:none;stroke:#bfe8ff;stroke-width:2.6;stroke-dasharray:7 5;filter:drop-shadow(0 0 4px rgba(96,200,255,.7));animation:a2dash 1.1s linear infinite;transition:opacity .3s}.a2tarrow marker path{fill:#9fdcff}
@keyframes a2dash{to{stroke-dashoffset:-22}}
.a2.touring .a2toast,.a2.touring .a2labels{opacity:0}
.a2hist{position:absolute;left:12px;top:12px;bottom:12px;right:calc(var(--side) + 12px);z-index:25;background:rgba(3,11,28,.97);border:1px solid #2b4a6b;border-radius:14px;display:flex;flex-direction:column;padding:12px 14px;font:11px/1.45 "Geist Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;color:#e9eef4;box-shadow:0 14px 50px rgba(0,0,0,.5)}
.a2ph .a2hist{left:6px;right:6px;top:6px;bottom:6px}
.a2hist header{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}.a2hist header b{letter-spacing:.14em;font-size:11.5px}.a2hist .cnt{color:#6f8aa6;font-size:10px}
.a2hist .x{margin-left:auto;background:none;border:1px solid #2b4a6b;border-radius:999px;color:#c8d6e4;cursor:pointer;padding:2px 10px;font:inherit}
.a2hist .chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}.a2hist .chips button{background:none;border:1px solid #1d3550;border-radius:999px;padding:3px 10px;color:#8fa5bb;cursor:pointer;font:inherit;font-size:10px}
.a2hist .chips button.on{background:#e9eef4;color:#030d22;border-color:#e9eef4}.a2hist .chips i{font-style:normal;opacity:.6}
.a2hist .note{font-size:10px;color:#6f8aa6;margin-bottom:8px}
.a2hist .list{flex:1;overflow:auto;padding-right:6px}.a2hist .list p{margin:0 0 3px;color:#a9b9c9;padding:2px 0;border-bottom:1px solid rgba(29,53,80,.35)}
.a2hist .list p t{color:#4f6a86;margin-right:8px}.a2hist .list p g{display:inline-block;min-width:76px;font-weight:600;color:#7fb2d8;margin-right:6px}
.a2hist .list p.plan g{color:#ffd36b}.a2hist .list p.map g,.a2hist .list p.scan g{color:#60c8ff}.a2hist .list p.ac g,.a2hist .list p.ac{color:#c9b8ff}.a2hist .list p.inv g{color:#ff9ad5}.a2hist .list p.good g{color:#5ef2b5}
.a2hist .list p.bad g,.a2hist .list p.bad{color:#ff8a8a}.a2hist .list p.mode g{color:#ffb35c}.a2hist .list p.dim{color:#6f8aa6}.a2hist .list p.per g{color:#f4f4f2}.a2hist .list p.haz g{color:#ffd23f}
.a2nudge{position:absolute;inset:0;z-index:26;pointer-events:none}.a2nudge .t{position:absolute;pointer-events:auto;cursor:pointer;background:#F4F4F2;color:#030d22;border-radius:12px;padding:10px 12px;font:12px/1.4 "Geist Mono",ui-monospace,Menlo,Consolas,monospace;box-shadow:0 10px 30px rgba(0,0,0,.45);animation:a2pop .4s cubic-bezier(.2,.8,.2,1)}
.a2nudge .t b{font-weight:700}.a2nudge path.p{stroke:#F4F4F2}.a2nudge marker path{fill:#F4F4F2}
@keyframes a2pop{from{opacity:0;transform:translateY(6px)}}
.a2pulse{animation:a2pulse 1.4s ease-in-out infinite;border-radius:999px}@keyframes a2pulse{50%{box-shadow:0 0 0 6px rgba(244,244,242,.35)}}
`;
  document.head.appendChild(s);
}

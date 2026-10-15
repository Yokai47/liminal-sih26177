// LIMINAL Act 4: the swarm at work. Layer 2 running on its own, end to end, in four environments, in 3-D, with the
// physics made visible while it happens. Each mission is simulated in full first (deterministic, seeded, in time
// slices), recorded to a tape, then played back as a directed film: chapters, captions, lenses, live concept cards,
// a director camera the viewer can take over. createAct4(host, opts) mounts it into any element.
//   opts: { base: 'assets/', onExit(), onLab(pageId), music: bool, start: missionId, seed, quality: 'high'|'low', test }
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CSS } from './style.js';
import { createMusic } from './music.js';
import { createRenderer } from './engine/renderer.js';
import { createOverlay } from './engine/overlay.js';
import { createCutout } from './engine/cutout.js';
import { createSwarmView } from './engine/swarmview.js';
import { createDirector } from './engine/director.js';
import { createLenses, LENSES } from './engine/lenses.js';
import { createDock, mmss } from './ui/dock.js';
import { createCaptions } from './ui/captions.js';
import { createCards, CONCEPT } from './ui/cards.js';
import { createLabels } from './ui/labels.js';
import { createPicker, createMissionMenu, createSimOverlay } from './ui/picker.js';
import { createReport } from './ui/report.js';
import { MISSIONS, ORDER } from './missions/index.js';
import { simulate } from './sim/core.js';
import { droneAt, auxAt, fieldAt, forecastAt, ST, FLAG, simClock } from './sim/tape.js';
import { components, angDiff } from './sim/fields.js';

const META = {
  city: { id: 'city', title: 'A city block after an earthquake', place: 'Inspired by Turkey and Syria, February 2023', mode: 'Indoor and outdoor', concepts: ['symmetry', 'crdt', 'phase', 'topology', 'pocket', 'vicsek'] },
  flood: { id: 'flood', title: 'A flooded village', place: 'Inspired by Kerala, August 2018', mode: 'Outdoor, GPS on', concepts: ['vicsek', 'turing', 'koopman', 'phase', 'topology'] },
  forest: { id: 'forest', title: 'Under the canopy', place: 'A missing trekker', mode: 'Outdoor, two layers', concepts: ['stigmergy', 'phase', 'slowing', 'crdt', 'topology'] },
  cave: { id: 'cave', title: 'A flooded cave', place: 'Inspired by Tham Luang, 2018', mode: 'Indoor, no GPS, no radio', concepts: ['stigmergy', 'crdt', 'topology', 'pocket'] },
};
const fmtVol = (v) => (v >= 100 ? `${Math.round(v).toLocaleString('en')} m³` : `${v.toFixed(1)} m³`);
const ICON = {
  note: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12V3.5l7-1.5v8.5"/><circle cx="4.3" cy="12" r="1.7"/><circle cx="11.3" cy="10.5" r="1.7"/></svg>',
  grid: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="9.5" y="1.5" width="5" height="5" rx="1"/><rect x="1.5" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/></svg>',
  back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 3 5 8l5 5"/></svg>',
};

export async function createAct4(host, opts = {}) {
  const base = opts.base || 'assets/';
  if (!document.getElementById('a4css')) { const st = document.createElement('style'); st.id = 'a4css'; st.textContent = CSS; document.head.appendChild(st); }
  const PH = matchMedia('(max-width: 760px)').matches;
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TEST = !!opts.test;
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const exitAct = () => { if (opts.onExit) opts.onExit(); else location.href = opts.backHref || '../'; };
  const onLab = (id) => { if (opts.onLab) opts.onLab(id); else toast(`Opens the swarm lab: ${id}`); };

  // ------------------------------------------------------------------ DOM
  const root = h('div', 'a4' + (TEST ? ' test' : '')); root.tabIndex = -1; root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Act 4: the swarm at work');
  const view = h('div', 'a4view'), canvas = h('canvas'), labelsEl = h('div', 'a4labels'); view.append(canvas, labelsEl);
  const top = h('header', 'a4top', `<div class="a4brand">LIMINAL <i>Act 4 · The swarm at work</i></div><div class="a4mis"></div><span class="sp"></span>
    <button class="a4pill a4mus" type="button" data-a="music" aria-pressed="false" title="Music">${ICON.note}<span class="hideS">Music</span></button>
    <button class="a4pill" type="button" data-a="missions">${ICON.grid}<span class="hideS">Missions</span></button>
    <button class="a4pill" type="button" data-a="exit">${ICON.back}<span class="hideS">Back to the story</span><span class="showS">Back</span></button>`);
  const capEl = h('div', 'a4cap'); capEl.setAttribute('aria-live', 'polite');
  const cardsEl = h('div', 'a4cards');
  const pipEl = h('div', 'a4pip', '<div class="ret"></div><div class="t"></div><i class="rec"></i>');
  const dockEl = h('div', 'a4dock');
  const pickEl = h('div'), simEl = h('div'), repEl = h('div'), toastEl = h('div', 'a4toast');
  root.append(view, top, capEl, cardsEl, pipEl, dockEl, repEl, simEl, pickEl, toastEl);
  host.appendChild(root);
  let toastT = 0; function toast(s) { toastEl.textContent = s; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2600); }

  // ------------------------------------------------------------------ engine
  const R = createRenderer(canvas, { phone: PH, preserve: TEST });
  // a lost GPU context (driver reset, too much memory) comes back: three.js rebuilds its state on restore
  const onLost = (e) => { e.preventDefault(); toast('The graphics were reset. One moment…'); };
  canvas.addEventListener('webglcontextlost', onLost);
  const { scene, camera, renderer } = R;
  const overlay = createOverlay();
  const cutout = createCutout();
  let props = null;
  try {
    const gl = new GLTFLoader(); gl.setMeshoptDecoder(MeshoptDecoder);
    props = (await gl.loadAsync(base + 'props.glb')).scene;
  } catch (e) { props = null; }
  const swarm = createSwarmView(scene, { props, phone: PH });
  const lenses = createLenses();
  const labels = createLabels(labelsEl);
  const director = createDirector(camera, canvas, { phone: PH, onTake: (u) => dock.setUser(u) });
  const pipCam = new THREE.PerspectiveCamera(68, 1.6, .1, 2000);
  // the drone's own lamp, lit only while the inset renders an indoor view (always in the scene: no shader recompiles)
  const pipLamp = new THREE.PointLight(0xFFF1E0, 0, 16, 1.6); scene.add(pipLamp);

  // ------------------------------------------------------------------ UI
  const metas = ORDER.map((id) => META[id]);
  const captions = createCaptions(capEl);
  const cards = createCards(cardsEl, { onLab, phone: PH });
  const dock = createDock(dockEl, {
    onPlay: () => (playing ? pause() : play()), onSpeed: (s) => setSpeed(s), onSeek: (p) => seek(p), onLens: (l) => setLens(l),
    onDirector: () => { if (director.user) director.giveBack(); else toast('The director has the camera. Drag the view to take over.'); },
    onDrone: () => setDroneView(!droneView), onStep: (d) => seek(P + d), onScrub: (on) => { scrubbing = on; },
  });
  const picker = createPicker(pickEl, metas, { onPick: (id) => { tour = null; startMission(id); }, onAll: () => playAll() });
  const menu = createMissionMenu(top.querySelector('.a4mis'), metas, { onPick: (id) => { tour = null; startMission(id); }, onAll: () => playAll() });
  const simOv = createSimOverlay(simEl);
  const report = createReport(repEl, { onReplay: () => { report.hide(); seek(0); play(); }, onNext: (id) => startMission(id), onMissions: () => { report.hide(); showPicker(); }, onLab });
  top.querySelector('[data-a="exit"]').addEventListener('click', exitAct);
  top.querySelector('[data-a="missions"]').addEventListener('click', () => showPicker());
  const music = createMusic('swarm'), musB = top.querySelector('[data-a="music"]');
  const paintMus = () => { musB.classList.toggle('on', music.on); musB.setAttribute('aria-pressed', String(music.on)); const t = musB.querySelector('span'); if (t) t.textContent = music.on ? 'Music on' : 'Music off'; };
  musB.addEventListener('click', () => { music.on ? music.stop() : music.start(); paintMus(); });
  if (opts.music) music.start(); paintMus();

  // ------------------------------------------------------------------ state
  let world = null, tape = null, script = null, meta = null, mod = null, missionId = null, seedUsed = 0;
  let simulating = false;
  let P = 0, playing = false, speed = 1, dur = 1, chapters = [], scrubbing = false, droneView = false, tour = null, loadId = 0, endedAt = -1, readyFired = false;
  const res = new THREE.Vector2(1, 1);
  function setSpeed(s) { speed = s; dock.setSpeed(s); }
  function setLens(id) { lenses.set(id); dock.setLens(lenses.current); }
  function setDroneView(on) { droneView = on; dock.setDrone(on); if (!on) director.setShot(curShot || { kind: 'wide' }, { cut: true }); }
  setSpeed(1); setLens('world');

  // time map: playback seconds <-> fractional ticks, chapter by chapter
  const tickAt = (p) => { for (const c of chapters) if (p <= c.p1) return c.t0 + Math.max(0, p - c.p0) * c.rate / tape.dt; return tape ? tape.T - 1 : 0; };
  const pAt = (t) => { for (const c of chapters) if (t <= c.t1) return c.p0 + (t - c.t0) * tape.dt / c.rate; return dur; };
  const chapterAt = (p) => { let i = chapters.findIndex((c) => p >= c.p0 && p < c.p1); return i < 0 ? chapters.length - 1 : i; };

  function showPicker() {
    pause(); report.hide(); clearTimeout(tourT);
    if (loading) { loadId++; loading = false; simOv.hide(); if (job) job.fg = false; }    // a mission still loading carries on in the background
    picker.show(); root.classList.toggle('nomis', !tape); prefetch();
  }
  let fogBase = 0, wev = null, loadInfo = null; // base fog density of the world; world reactions to the tape (see worldEvents)
  // ------------------------------------------------------------------ missions: build, simulate, cache
  // A job builds a mission's world and simulates its tape in slices. It runs in the foreground (big slices, no 3-D
  // frames, a progress bar) or in the background (small slices, e.g. the city while the picker is showing, or a
  // mission the viewer left for the picker). Tapes are kept for the session: reopening a mission is instant.
  const tapeCache = new Map();          // mission id -> { seed, source, tape }
  const worldCache = new Map();         // mission id -> { seed, world }: a mission shown again skips its world build too
  let job = null, loading = false;
  const disposeWorld = (w) => { if (!w) return; try { overlay.forget(w); } catch (e) { /* ignore */ } try { w.dispose && w.dispose(); } catch (e) { /* ignore */ } };
  const isCached = (w) => !!w && [...worldCache.values()].some((c) => c.world === w);
  // put the shown world away (kept for this session, so coming back to that mission is instant)
  function stashWorld() {
    if (!world) return; const w = world; world = null; scene.remove(w.group); overlay.detach();
    const id = w.__a4mission; if (!id) { disposeWorld(w); return; }
    const old = worldCache.get(id); if (old && old.world !== w) disposeWorld(old.world);
    worldCache.set(id, { seed: w.__a4seed, world: w });
  }
  const newSeed = () => (TEST ? 7 : ((Math.random() * 1e6) | 0) + 1);
  const nextTask = (ms = 0) => new Promise((res2) => setTimeout(res2, ms));
  function cancelJob() {
    if (!job) return; job.cancelled = true;
    if (job.world && !job.adopted && !isCached(job.world)) disposeWorld(job.world);
    job = null;
  }
  function runJob(id, seed, fg) {
    const j = { id, seed, fg, fgSince: performance.now(), cancelled: false, adopted: false, p: 0, mod: null, world: null, tape: null, error: null, onWorld: null, onSim: null, onProgress: null };
    j.promise = (async () => {
      j.mod = (await MISSIONS[id]()).default; if (j.cancelled) return j;
      await nextTask(fg ? 30 : 60); if (j.cancelled) return j;             // let the overlay (or the picker) paint first
      const wc = worldCache.get(id);
      if (wc && wc.seed === seed) { j.world = wc.world; resetWorld(j.world); }
      else {
        j.world = await j.mod.world(THREE, { seed, quality: opts.quality || (PH ? 'low' : 'high'), props, placeholder: !!opts.placeholder });
        j.world.__a4mission = id; j.world.__a4seed = seed;
        if (j.cancelled) { disposeWorld(j.world); return j; }
      }
      if (j.onWorld) j.onWorld(j);
      const hit = tapeCache.get(id);
      if (hit && hit.seed === seed && hit.source === j.world.__source) { j.tape = hit.tape; j.p = 1; return j; }
      if (j.onSim) j.onSim(j);
      const cfg = { ...j.mod.config(j.world, seed), slice: () => (TEST ? 60 : j.fg ? 45 : 12) };
      const gen = simulate(j.world, cfg);
      let lastP = -1, lastT = performance.now();
      for (;;) {
        const r = gen.next(); if (r.done) { j.tape = r.value; break; }
        const now = performance.now();
        if (!j.fg) { lastT = now; j.fgSince = now; }                        // the watchdog only counts foreground time
        j.p = r.value.p; if (j.p > lastP + 1e-4) { lastP = j.p; lastT = now; }
        if (j.onProgress) j.onProgress(j.p);
        if (now - lastT > 15000) throw new Error('the simulation stopped making progress');
        if (now - j.fgSince > 150000) throw new Error('the simulation took too long');
        await nextTask(j.fg ? 0 : 6); if (j.cancelled) return j;
      }
      tapeCache.set(id, { seed, source: j.world.__source, tape: j.tape });
      return j;
    })().catch((e) => { j.error = e; return j; });
    return j;
  }
  // prefetch: start the first mission while the picker is showing (only when nothing else is running)
  let prefetchT = 0;
  function prefetch(id = ORDER[0]) {
    clearTimeout(prefetchT);
    prefetchT = setTimeout(() => { if (destroyed || job || tape || !picker.shown || tapeCache.has(id)) return; job = runJob(id, opts.seed ?? newSeed(), false); }, 900);
  }
  // show a built world (the place appears under the progress bar; the swarm comes with the tape)
  // a world shown again starts as it was built: everyone visible, no water rise, calm, not cut
  function resetWorld(w) {
    try { if (w.showPeople) w.showPeople(-1, true); if (w.setWaterRise) w.setWaterRise(0); if (w.setWind) w.setWind(1, 0, 0); if (w.cutaway) w.cutaway(null); } catch (e) { /* ignore */ }
    if (w.objects) { if (w.objects.people) w.objects.people.visible = false; if (w.objects.pocket) w.objects.pocket.visible = false; }
  }
  function adoptWorld(j) {
    if (world && world !== j.world) stashWorld();
    if (world === j.world) { scene.remove(world.group); overlay.detach(); }
    j.adopted = true; mod = j.mod; seedUsed = j.seed; world = j.world;
    meta = { ...META[j.id], title: mod.title || META[j.id].title, place: mod.place || META[j.id].place };
    scene.add(world.group);
    world.group.traverse((o) => { if (o.isMesh && o.castShadow === undefined) o.castShadow = true; });
    R.setSky(world.sky || {}, world.bounds, mod.look || {}); fogBase = scene.fog ? scene.fog.density : 0;
    overlay.attach(world, scene); cutout.reset(); if (mod.cutout) cutout.attach(world, mod.cutout.test); overlay.U.uOn.value = 0; overlay.U.uKnown.value = mod.overlay?.known ?? 0; overlay.U.uUnk.value = mod.overlay?.unknown ?? .75;
    director.setWorld(world, null); director.setDefaultCut(mod.defaultCut ?? null);
    const wc = world.camera && world.camera.wide;
    director.setShot(wc ? { kind: 'focus', target: wc.target, dist: wc.pos.distanceTo(wc.target), el: Math.asin(THREE.MathUtils.clamp((wc.pos.y - wc.target.y) / Math.max(1e-6, wc.pos.distanceTo(wc.target)), -1, 1)), az: Math.atan2(wc.pos.x - wc.target.x, wc.pos.z - wc.target.z), drift: .03 } : { kind: 'wide', drift: .03 }, { cut: true });
    swarm.root.visible = false;
    wantRender = true;                       // one frame of the place, then no 3-D frames until the tape is ready
  }
  // a world that failed (its tape could not be made) is thrown away, not kept
  function dropWorld() {
    if (!world) return; const w = world; world = null; scene.remove(w.group); overlay.detach();
    for (const [k, c] of worldCache) if (c.world === w) worldCache.delete(k);
    disposeWorld(w);
  }
  async function startMission(id, { seed } = {}) {
    if (!MISSIONS[id]) return;
    clearTimeout(prefetchT);
    const my = ++loadId; picker.hide(); report.hide(); pause(); endedAt = -1;
    missionId = id; meta = META[id]; menu.set(id);
    simOv.show(meta, 'Building the scene'); simOv.progress(.02, 'building the scene');
    cards.clear(); captions.set(null, '', ''); tape = null; script = null; chapters = []; wev = null; curShot = null; shotIdx = -1;
    director.setShot({ kind: 'wide' }); loading = true; root.classList.add('nomis');
    const T0 = performance.now(); loadInfo = { mission: id, world: 0, sim: 0, total: 0, cached: false };
    const hit = tapeCache.get(id);
    for (let attempt = 0; attempt < 3; attempt++) {
      // the seed: as asked, else this session's tape, else a running job's, else a new one (a retry always takes a new one)
      const want = attempt ? newSeed() : seed ?? (hit ? hit.seed : job && job.id === id && !job.cancelled ? job.seed : opts.seed ?? newSeed());
      const wasCached = !!(tapeCache.get(id) && tapeCache.get(id).seed === want);
      let j = job && job.id === id && job.seed === want && !job.cancelled && !job.error ? job : null;
      if (!j) { cancelJob(); if (world && world.__a4mission !== id) stashWorld(); j = job = runJob(id, want, true); }
      else { j.fg = true; j.fgSince = performance.now(); }
      const label = () => simOv.show(meta, 'Simulating the mission');
      j.onWorld = (jj) => { if (my !== loadId) return; loadInfo.world = Math.round(performance.now() - T0); adoptWorld(jj); };
      j.onSim = () => { if (my === loadId) label(); };
      j.onProgress = (p) => { if (my === loadId) simOv.progress(.03 + p * .95); };
      if (j.world && !j.adopted) adoptWorld(j);                                  // a background job that already built its world
      if (j.world && !j.tape && !j.error) { label(); simOv.progress(.03 + j.p * .95); }
      await j.promise; if (my !== loadId) return;
      if (job === j) job = null;
      if (j.error || !j.tape) {
        console.warn(`[act4] ${id} (seed ${want}) failed, trying another seed:`, j.error);
        tapeCache.delete(id);
        if (j.world) { if (world === j.world) dropWorld(); else { for (const [k, c] of worldCache) if (c.world === j.world) worldCache.delete(k); disposeWorld(j.world); } }
        continue;
      }
      if (!j.adopted) adoptWorld(j);
      loadInfo.sim = Math.round(performance.now() - T0); loadInfo.cached = wasCached;
      try { begin(j); } catch (e) { console.warn(`[act4] ${id} (seed ${want}) could not start:`, e); tapeCache.delete(id); dropWorld(); tape = null; continue; }
      await nextTask(TEST ? 0 : 300); if (my !== loadId) return;
      simOv.hide(); root.classList.remove('nomis'); loading = false; loadInfo.total = Math.round(performance.now() - T0);
      P = 0; curShot = null; shotIdx = -1; director.giveBack(); overlay.U.uOn.value = 1;
      play();
      if (!readyFired) { readyFired = true; if (opts.onReady) opts.onReady(); }
      return;
    }
    loading = false;
    simOv.fail('This mission could not be simulated here.', () => startMission(id), () => { simOv.hide(); showPicker(); });
  }
  // the tape is ready: overlays, views, script, timeline
  function begin(j) {
    tape = j.tape; seedUsed = j.seed;
    overlay.setTape(tape); overlay.setOwn(tape, null); wev = null; pipBad.clear();
    swarm.setTape(tape, world); swarm.root.visible = true;
    director.setWorld(world, tape);
    script = mod.script(tape, world);
    let p = 0; chapters = script.chapters.map((c) => { const d = Math.max(c.minPlay ?? 7, (c.t1 - c.t0) * tape.dt / c.rate); const o = { ...c, p0: p, p1: p + d }; p += d; return o; });
    // make the time map exact: each chapter's rate fits its playback length
    for (const c of chapters) c.rate = (c.t1 - c.t0) * tape.dt / Math.max(1e-6, c.p1 - c.p0);
    dur = p; if (!(dur > 1) || !chapters.length) throw new Error('empty script');
    const marks = []; for (const e of tape.events) { if (e.type === 'find') marks.push({ p: pAt(e.t), color: 'var(--heat)' }); else if (['aftershock', 'gust', 'current', 'water_rise', 'battery'].includes(e.type)) marks.push({ p: pAt(e.t), color: 'var(--danger)' }); else if (e.type === 'pocket') marks.push({ p: pAt(e.t), color: 'var(--lav)' }); }
    dock.setTimeline(chapters, dur, marks);
    cards.setTape(tape, {});
    proofCache.t = -1;
    simOv.progress(1, `ready: ${simClock(tape, tape.T)} of mission time`);
    R.resetAdapt && R.resetAdapt();
  }
  function playAll() { tour = [...ORDER]; startMission(tour[0]); }
  function play() { if (!tape) return; if (P >= dur - .05) P = 0; report.hide(); playing = true; endedAt = -1; if (held) { held = false; running = true; last = performance.now(); } }
  function pause() { playing = false; }
  function seek(p) { if (!tape) return; P = Math.max(0, Math.min(dur, p)); shotIdx = -1; if (P < dur - .1) { report.hide(); endedAt = -1; } }
  // pause() / resume() for the host: stop playback, the render loop and the music, then bring back exactly what was on
  let held = false, heldPlaying = false, heldMusic = false, tourT = 0, destroyed = false;
  function hold() { if (held) { playing = false; return; } held = true; heldPlaying = playing; playing = false; running = false; heldMusic = music.on; if (music.on) { music.stop(); paintMus(); } }
  function unhold() { running = true; last = performance.now(); if (!held) return; held = false; if (heldPlaying) play(); if (heldMusic) { music.start(); paintMus(); } }
  function nextOf(id) { if (tour) { const i = tour.indexOf(id); return i >= 0 && i < tour.length - 1 ? META[tour[i + 1]] : null; } const i = ORDER.indexOf(id); return i < ORDER.length - 1 ? META[ORDER[i + 1]] : null; }

  // ------------------------------------------------------------------ per-frame playback
  let curShot = null, shotIdx = -1, pipDrone = 0;
  const A = { x: 0, y: 0, z: 0, h: 0, state: 0, bat: 1, layer: 0, team: -1, flags: 0, own: 0 }, AU = { x: 0, y: 0, z: 0, h: 0, state: 0 };
  // (a shot from the last mission may still ask for a drone while the next one loads: answer safely)
  const ctx = { N: 0, droneAt: (i, o) => { if (!tape) { o.x = o.y = o.z = o.h = 0; o.state = ST.IDLE; return o; } return droneAt(tape, curTf, Math.max(0, Math.min(tape.N - 1, i | 0)), o); },
    layerOf: (i) => { if (!tape) return null; droneAt(tape, curTf, Math.max(0, Math.min(tape.N - 1, i | 0)), A2); const L = tape.layers[A2.layer]; return L ? (L.outdoor ? null : L.id) : null; }, shake: 0 };
  const A2 = { x: 0, y: 0, z: 0, h: 0, state: 0, bat: 1, layer: 0, team: -1, flags: 0, own: 0 };
  let curTf = 0;
  const proofCache = { t: -1, blobs: [] };
  function proofBlobs(tf) {
    const t = Math.floor(tf); if (t === proofCache.t) return proofCache.blobs; proofCache.t = t; const out = [];
    for (const L of tape.layers) {
      const lab = new Int32Array(L.nx * L.nz); const cs = components(L.nx, L.nz, (c) => L.srch[c] && L.firstSeen[c] > t, lab, 3);
      for (const c of cs) out.push({ x: L.x0 + (c.cx + .5) * L.cell, y: L.outdoor ? L.y + 1 : L.y + 1.2, z: L.z0 + (c.cz + .5) * L.cell, n: c.n, layer: L.id });
    }
    out.sort((a, b) => b.n - a.n); proofCache.blobs = out; return out;
  }
  const activeBuf = [], orderBuf = [];
  function playback(dt, time) {
    if (!tape) return;
    if (playing && !scrubbing) { P += dt * speed; if (P >= dur) { P = dur; playing = false; endedAt = time; onEnded(); } }
    const tf = tickAt(P); curTf = tf; ctx.N = tape.N;
    const ci = chapterAt(P), ch = chapters[ci];
    // beats active now
    const active = activeBuf; active.length = 0; for (const b of script.beats) if (tf >= b.t0 && tf <= b.t1) active.push(b);
    lenses.beats(active);
    const order = orderBuf; order.length = 0; for (const b of active) if (!order.includes(b.concept)) order.push(b.concept);
    if (ch && ch.concept) { const k = order.indexOf(ch.concept); if (k >= 0 && k < order.length - 1) { order.splice(k, 1); order.splice(Math.max(0, order.length - 1), 0, ch.concept); } } // the chapter's own concept never drops out
    cards.show(order);
    // caption
    let cap = null; for (const c of script.captions) { if (c.t <= tf + .5) cap = c; else break; }
    // a moment's caption lasts about ten seconds; then the chapter's own sentence comes back
    if (cap && ch && P - pAt(cap.t) > 11) {
      if (cap.t < ch.t0 - .5) cap = null; // a stale sentence from an earlier chapter: leave just the chapter title
      else { const base = script.captions.find((c) => c.t >= ch.t0 && c.t < ch.t1); if (base && base !== cap && base.t < cap.t) cap = base; }
    }
    captions.set(ci, ch ? ch.title : '', cap ? (cap.live ? cap.live.replace('{b}', tape.metrics.beta0[Math.max(0, Math.min(tape.T - 1, Math.floor(tf)))]) : cap.text) : '');
    // shots (the user may have the camera)
    let si = -1; for (let i = 0; i < script.shots.length; i++) { if (script.shots[i].t <= tf + .5) si = i; else break; }
    if (si !== shotIdx) { shotIdx = si; curShot = si >= 0 ? script.shots[si] : { kind: 'wide' }; if (!droneView) director.setShot(curShot, { cut: !!curShot.cut }); }
    // PiP drone
    let pd = 0; for (const q of script.pip) { if (q.t <= tf) pd = q.drone; else break; }
    if (curShot && curShot.kind === 'chase') pd = curShot.drone; if (curShot && curShot.chase != null) pd = curShot.chase;
    droneAt(tape, tf, pd, A); if (A.state === ST.DEAD || A.state === ST.LANDED || A.state === ST.IDLE) { for (let i = 0; i < tape.N; i++) { droneAt(tape, tf, i, A); if (A.state === ST.SEARCH) { pd = i; break; } } }
    pipSel = pd; pipDrone = pipPick(pd, tf);
    if (droneView) director.setShot({ kind: 'pov', drone: pd });
    // overlay uniforms
    const W = lenses.W, B = lenses.B, U = overlay.U;
    U.uT.value = tf; U.uTime.value = time;
    U.uWorld.value = W.world; U.uMap.value = Math.max(W.map, 0); U.uProof.value = Math.max(W.proof, (chapters[chapterAt(P)]?.id || '').startsWith('proof') ? B.topology * .85 : B.topology * .3);
    U.uField.value = Math.max(W.physics, B.turing * .9) * (tape.field ? 1 : 0); U.uGhost.value = Math.max(W.physics * .6, B.koopman); U.uUV.value = W.uv; U.uOwn.value = 0;
    R.finish.uniforms.uv.value = W.uv * .7;
    if (tape.field) overlay.setField(fieldAt(tape, tf), tape.field.w, tape.field.h);
    overlay.setGhost(forecastAt(tape, tf));
    swarm.update(tf, W, B, pd, time, camera, res);
    worldEvents(tf);
    // the ground shakes: so does the camera, for a few seconds after an aftershock
    if (!tape._shakes) tape._shakes = tape.events.filter((e) => e.type === 'aftershock' || e.type === 'gust');
    let sh = 0; for (const e of tape._shakes) { const age = (tf - e.t) * tape.dt; if (age >= 0 && age < 9) sh = Math.max(sh, (e.type === 'gust' ? .35 : 1) * Math.exp(-age * .45) * (age < .4 ? age / .4 : 1)); }
    ctx.shake = sh;
  }
  // the world reacts to the tape: the cave's hidden people appear once found, the flood's roofs empty as the boats pick
  // people up, wind and water follow their events (all derived from tf, so scrubbing back restores them)
  function prepWorldEvents() {
    wev = { picked: [], hidden: new Set(), gust: tape.events.find((e) => e.type === 'gust'), rise: tape.events.find((e) => e.type === 'water_rise'), conf: Math.min(...tape.candidates.filter((c) => c.kind === 'person' && c.confT >= 0).map((c) => c.confT), 1e9), pk: tape.pockets.find((p) => p.t >= 0), wind: -1, riseNow: -1, people: null };
    const P = world && world.anchors && world.anchors.people;
    if (world && world.showPeople && P) for (const e of tape.events) { if (e.type !== 'pickup' || e.cand == null) continue; const c = tape.candidates.find((q) => q.id === e.cand); if (!c) continue;
      const gis = []; P.forEach((p, gi) => { const q = p.pos || p; if (Math.hypot(q.x - c.pos[0], q.z - c.pos[2]) < 16) gis.push(gi); }); if (gis.length) wev.picked.push({ t: e.t + Math.round(6 / tape.dt), gis }); }
  }
  function worldEvents(tf) {
    if (!world || !tape) return; if (!wev) prepWorldEvents();
    try {
      const O = world.objects || {};
      if (O.people) { const on = tf >= wev.conf; if (O.people.visible !== on) O.people.visible = on; }
      if (O.pocket && wev.pk) { const on = tf >= wev.pk.t; if (O.pocket.visible !== on) O.pocket.visible = on; }
      if (wev.picked.length) { for (const p of wev.picked) { const want = tf >= p.t; for (const gi of p.gis) { if (want && !wev.hidden.has(gi)) { wev.hidden.add(gi); world.showPeople(gi, false); } else if (!want && wev.hidden.has(gi)) { wev.hidden.delete(gi); world.showPeople(gi, true); } } } }
      if (world.setWind && wev.gust) { const age = (tf - wev.gust.t) * tape.dt, dur = wev.gust.dur || 16; const g = age >= 0 && age < dur + 6 ? Math.max(0, 1 - Math.max(0, age - dur) / 6) : 0; const w = 1 + g * 1.5; if (Math.abs(w - wev.wind) > .01) { wev.wind = w; world.setWind(w, g, clock - age); } }
      if (world.setWaterRise && wev.rise) { const age = (tf - wev.rise.t) * tape.dt, full = wev.rise.rise ?? 1.2, k = Math.max(0, Math.min(1, age / 20)); const dy = full * k * k * (3 - 2 * k); if (Math.abs(dy - wev.riseNow) > .05) { wev.riseNow = dy; world.setWaterRise(dy); } }
    } catch (e) { /* a world hook must never stop the film */ }
  }
  function onEnded() {
    report.show(meta, tape, nextOf(missionId), tour && nextOf(missionId) ? 11 : 0);
    if (tour) { const nx = nextOf(missionId); if (nx) { const id = nx.id, my = loadId; clearTimeout(tourT); tourT = setTimeout(() => { if (my === loadId && report.shown && tour && !held) startMission(id); }, TEST ? 1e9 : 11000); } else tour = null; }
  }
  // labels in the scene
  function sceneLabels(tf, W, B) {
    const r = canvas.getBoundingClientRect(); labels.begin(camera, r.width, r.height);
    if (!tape) { labels.end(); return; }
    const k = Math.floor(tf);
    // tethered drone
    const tk = tape.aux.list.findIndex((a) => a.kind === 'tether');
    const chId = chapters[chapterAt(P)]?.id || '';
    if (tk >= 0) { auxAt(tape, tf, tk, AU); const ta = Math.max(chId === 'intro' || chId === 'home' ? .85 : 0, W.mesh * .9); if (AU.state > 0 && ta > .02) labels.add(AU.x, AU.y + 2.6 * swarm.tdrone.scale.y, AU.z, `<b>Tethered drone</b><small>mast · commands sent: 0</small>`, 'apr', ta, 6); }
    // ground robots
    let q = 0; const ua = Math.max(B.symmetry, W.physics, chId === 'intro' ? .6 : 0) * .85; tape.aux.list.forEach((a, i) => { if (a.kind !== 'ugv') return; auxAt(tape, tf, i, AU); q++; if (ua > .02) labels.add(AU.x, AU.y + 3.2 * Math.max(1.2, swarm.scale * .6), AU.z, `<b>Ground robot ${q}</b><small>${AU.state >= 2 ? 'parked · sends nothing' : 'driving'}</small>`, 'apr', ua, 6); });
    // finds and false alarms
    for (const c of tape.candidates) {
      if (tf < c.detT) continue; const f = tape.finds.find((x) => x.cand === c.id); const rej = tape.events.find((e) => e.type === 'reject' && e.cand === c.id);
      if (c.kind === 'person') {
        const conf = f && tf >= f.confirmT; const conv = c.tipT >= 0 && tf >= c.tipT;
        const age = conf ? (tf - f.confirmT) * tape.dt : 0, summary = chId === 'home' || W.proof > .5;
        const a = !conf ? 1 : age < 45 ? 1 : summary ? .9 : Math.max(0, 1 - (age - 45) / 12);
        const html = conf ? (age < 45 ? `<b>${f.count > 1 ? f.count + ' people' : 'One person'} · confirmed</b><small>thermal and camera agree</small>` : `<b>${f.count > 1 ? f.count + ' people' : '1 person'}</b>`) : conv ? '<b>Converging</b><small>thermal signal, checking</small>' : '<b>Warm signal</b><small>thermal only</small>';
        if (a > .02) labels.add(c.pos[0], c.pos[1] + 2.4, c.pos[2], html, 'heat', a, 10);
      } else if (!rej || tf < rej.t + 60) {
        const html = rej && tf >= rej.t ? `<b>${(rej.label || 'warm object').replace(/^./, (m) => m.toUpperCase())}</b><small>camera disagrees: rejected</small>` : '<b>Warm signal</b><small>checking with the camera</small>';
        labels.add(c.pos[0], c.pos[1] + 2.2, c.pos[2], html, rej && tf >= rej.t ? '' : 'heat', .95, 10);
      }
    }
    // the followed drone
    if (pipDrone != null && !droneView) { droneAt(tape, tf, pipDrone, A); if (A.state !== ST.IDLE && A.state !== ST.LANDED) { const L = tape.layers[A.layer];
      const st = ['', 'launching', 'in transit', 'searching', 'converging', 'confirming', 'relay', 'returning', 'battery failed', '', 'pulling out', 'holding the line'][A.state] || '';
      labels.add(A.x, A.y + 1.6 * swarm.scale, A.z, `<b>Drone ${pipDrone + 1}</b><small>${st}${A.flags & FLAG.OUT ? ' · out of range' : ''} · ${Math.round(A.bat * 100)}%${L && !L.outdoor ? ' · LiDAR' : ''}</small>`, A.flags & FLAG.OUT ? '' : 'teal', .9, 8); } }
    // sealed voids
    for (const p of tape.pockets) if (p.t >= 0 && tf >= p.t) { const a = Math.max(W.proof, B.pocket, chId === 'home' ? .8 : 0); if (a > .02) labels.add(p.pos[0], p.pos[1] + 2.4, p.pos[2], `<b>${p.name ? p.name.replace(/^./, (m) => m.toUpperCase()) : 'Sealed void'} · ${fmtVol(p.volume)}</b><small>β₂ = 1 · mapped all round</small>`, 'lav', a, 10); }
    // β0: the unsearched pockets, numbered (Proof lens, or while counting to zero)
    const pw = Math.max(W.proof, chId.startsWith('proof') ? B.topology : 0);
    if (pw > .05) { const bl = proofBlobs(tf); bl.slice(0, 24).forEach((b, i) => labels.num(b.x, b.y, b.z, String(i + 1), pw)); }
    labels.end();
  }

  // ------------------------------------------------------------------ PiP: the drone's eye
  // the inset is checked as it is drawn (a few times a second): if the picture is mostly one flat colour (the lens is
  // inside a wall, a slab or a crown), that drone is skipped for a while and the nearest readable one takes over
  const pipBad = new Map(); let pipSel = 0, probeT = -1, probeBuf = null, lastProbe = null;
  function renderPip(time) {
    for (let k = 0; k < (TEST ? 6 : 1); k++) {
      const drawn = renderPipOnce(time); if (!drawn) return;
      if (!TEST && time - probeT < .6) return; probeT = time;
      if (!pipProbeBad(drawn)) return;
      pipBad.set(pipDrone, curTf); const before = pipDrone; pipDrone = pipPick(pipSel, curTf);
      if (pipNone || pipDrone === before) { pipNone = true; break; }
      if (!TEST) return; // live: the new drone is drawn (and checked) from the next frame on
    }
    pipNone = true; pipEl.classList.remove('on'); R.render(clock); // nothing readable: no inset (repaint over the rejected picture)
  }
  function pipProbeBad(r) {
    const gl = renderer.getContext(), pr = renderer.getPixelRatio(), X = Math.floor(r.x * pr) + 2, Y = Math.floor(r.y * pr) + 2, W = Math.max(8, Math.floor(r.w * pr) - 4), H = Math.max(8, Math.floor(r.h * pr * .82) - 4);
    if (!probeBuf || probeBuf.length < W * H * 4) probeBuf = new Uint8Array(W * H * 4);
    try { gl.readPixels(X, Y, W, H, gl.RGBA, gl.UNSIGNED_BYTE, probeBuf); } catch (e) { return false; }
    // 8 x 6 blocks: count the ones with almost no variation
    let flat = 0, s1a = 0, s2a = 0, na = 0, hot = 0;
    for (let by = 0; by < 6; by++) for (let bx = 0; bx < 8; bx++) {
      let s1 = 0, s2 = 0, c = 0; const x0 = Math.floor(bx * W / 8), x1 = Math.floor((bx + 1) * W / 8), y0 = Math.floor(by * H / 6), y1 = Math.floor((by + 1) * H / 6);
      for (let yy = y0; yy < y1; yy += 2) for (let xx = x0; xx < x1; xx += 2) { const o = (yy * W + xx) * 4, l = (.2126 * probeBuf[o] + .7152 * probeBuf[o + 1] + .0722 * probeBuf[o + 2]) / 255; s1 += l; s2 += l * l; c++; if (l > .7) hot++; }
      if (!c) continue; const sd = Math.sqrt(Math.max(0, s2 / c - (s1 / c) ** 2)); if (sd < .012) flat++; s1a += s1; s2a += s2; na += c;
    }
    const sdAll = na ? Math.sqrt(Math.max(0, s2a / na - (s1a / na) ** 2)) : 1;
    const mean = na ? s1a / na : 0; lastProbe = { d: pipDrone, flat: +(flat / 48).toFixed(2), sd: +sdAll.toFixed(3), mean: +mean.toFixed(3), hot: +(hot / Math.max(1, na)).toFixed(2) };
    // flat (inside a wall), blown out (a wall right in front of the lamp) or nearly black
    return (flat / 48 > .5 && sdAll < .05) || (flat / 48 > .62 && sdAll < .09) || flat / 48 > .8 || sdAll < (mod.pipMinSd ?? .032) || hot / Math.max(1, na) > .25 || mean < .05;
  }
  function renderPipOnce(time) {
    let on = !!tape && !droneView && pipEl.offsetWidth > 0 && (playing || P > 0) && !report.shown;
    if (on && pipNone) on = false;
    if (on) { droneAt(tape, curTf, pipDrone, A); if (A.state === ST.IDLE || A.state === ST.LANDED || A.state === ST.DEAD || (A.y - tape.base.y < 1.2 && A.state === ST.LAUNCH)) on = false; }
    pipEl.classList.toggle('on', on && pipVisible());
    if (!on || !pipVisible()) return null;
    droneAt(tape, curTf, pipDrone, A);
    const L = tape.layers[A.layer]; const indoor = L && !L.outdoor;
    // indoors the camera turns toward open space, so a drone hovering by a wall does not show a blank wall
    const low = L && L.outdoor && A.y - L.y < 9; // a low drone by a wall: turn the camera to open space too
    const want = indoor || low ? pipOpenDir(A, L) : A.h, dtP = Math.min(.25, Math.max(0, time - pipT)); pipT = time;
    if (pipYaw == null || pipFor !== pipDrone || !playing) pipYaw = want; else pipYaw += angDiff(pipYaw, want) * (1 - Math.exp(-dtP * 2.5));
    pipFor = pipDrone;
    const ahead = indoor ? .25 : .9;
    pipCam.position.set(A.x + Math.cos(pipYaw) * ahead * swarm.scale, A.y - (indoor ? .1 : .25) * swarm.scale, A.z + Math.sin(pipYaw) * ahead * swarm.scale);
    pipCam.lookAt(A.x + Math.cos(pipYaw) * 12, A.y - (indoor ? (mod.pipDown ?? 1.2) : Math.min(5.5, Math.max(.8, (A.y - (L ? L.y : 0)) * .45))), A.z + Math.sin(pipYaw) * 12);
    pipCam.near = indoor ? .15 : .3; pipCam.far = 900; pipCam.fov = indoor ? 70 : 64;
    const cr = canvas.getBoundingClientRect(), pr = pipEl.getBoundingClientRect();
    const x = pr.left - cr.left, y = cr.bottom - pr.bottom, w = pr.width, hh = pr.height;
    pipCam.aspect = w / hh; pipCam.updateProjectionMatrix();
    pipEl.querySelector('.t').innerHTML = `Drone ${pipDrone + 1}’s camera<small>${indoor ? `LiDAR + camera · ${L.name || L.id}` : `thermal + camera · ${Math.max(0, A.y - (L ? L.y : 0)).toFixed(0)} m up`}</small>`;
    // a world cut open for the main camera is whole again for the drone's own camera (no cut faces, ceilings back).
    // Everything this extra render changes (scissor, viewport, autoClear, the lamp, the cut-outs, the world's cut) is put
    // back in a finally block: a failure here must never leave the main view clipped or black.
    const uncut = mod && (mod.pipUncut || mod.pipCut) && world && world.cutaway && (director.cutValue != null || mod.pipCut);
    const ac = renderer.autoClear, cw = cutout.U.a4cOn.value; let begun = false, cutDone = false;
    try {
      if (uncut) { world.cutaway(mod.pipCut ? mod.pipCut(A) : null); cutDone = true; }
      renderer.setRenderTarget(null); renderer.setScissorTest(true); renderer.setScissor(x, y, w, hh); renderer.setViewport(x, y, w, hh);
      renderer.autoClear = true; cutout.U.a4cOn.value = 0;
      pipLamp.position.set(pipCam.position.x - Math.cos(pipYaw) * .9, pipCam.position.y + .3, pipCam.position.z - Math.sin(pipYaw) * .9); // a little behind the lens
      pipLamp.intensity = indoor ? (mod.pipLamp ?? 2.4) : 0; pipLamp.distance = mod.pipLampRange ?? 16; pipLamp.decay = mod.pipLampDecay ?? 1.6;
      swarm.pipBegin(hh); begun = true;
      renderer.render(scene, pipCam);
    } finally {
      if (begun) swarm.pipEnd();
      pipLamp.intensity = 0; cutout.U.a4cOn.value = cw; renderer.autoClear = ac;
      if (cutDone) { try { world.cutaway(director.cutValue); } catch (e) { /* ignore */ } }
      resetGL();
    }
    return { x, y, w, h: hh };
  }
  let pipFlag = true, pipYaw = null, pipFor = -1, pipT = 0;
  let pipRun = 9, pipSide = 9;
  function pipOpenDir(A, L) {
    const free = (x, z) => { const i = Math.floor((x - L.x0) / L.cell), k = Math.floor((z - L.z0) / L.cell); if (i < 0 || k < 0 || i >= L.nx || k >= L.nz) return false; const t = L.grid[k * L.nx + i]; return t === 0 || t === 3 || t === 4; };
    const run = (a, max) => { let r = .25; for (; r < max; r += .25) if (!free(A.x + Math.cos(a) * r, A.z + Math.sin(a) * r)) break; return r; };
    let best = A.h, bs = -1e9; pipRun = 0; pipSide = 0;
    if (!free(A.x, A.z)) return best; // the drone's own cell is not open: nothing readable from here
    for (let j = 0; j < 12; j++) {
      const off = Math.ceil(j / 2) * (j % 2 ? 1 : -1) * Math.PI / 6, a = A.h + off, r = run(a, 9);
      const side = Math.min(run(a + Math.PI / 2, 2), run(a - Math.PI / 2, 2)); // walls right beside the lens fill the picture
      const sc = Math.min(r, 6) + 1.5 * Math.min(side, 1.5) - Math.abs(off) * .5; if (sc > bs) { bs = sc; best = a; pipRun = r; pipSide = side; }
    }
    return best;
  }
  // the drone's-eye inset only shows a drone that has something to look at: not one in a crawl space or pressed against
  // a wall (its camera would sit inside the geometry); otherwise the nearest drone that does, or nothing
  const B2 = { x: 0, y: 0, z: 0, h: 0, state: 0, layer: 0 };
  const pipOK = (i, tf) => {
    droneAt(tape, tf, i, B2); const st = B2.state; if (st === ST.IDLE || st === ST.LANDED || st === ST.DEAD || (st === ST.LAUNCH && B2.y - tape.base.y < 1.2)) return false;
    const L = tape.layers[B2.layer]; if (!L) return true; if (L.kind === 'void') return false;
    if (!L.outdoor) { const lo = L.y + .45, hi = (Number.isFinite(L.b1) && L.b1 > L.y + 1 ? Math.min(L.b1, L.y + 4) : L.y + 2.8) - .35; if (B2.y < lo || B2.y > hi) return false; // a camera in the slab sees only the inside of it
      pipOpenDir(B2, L); return pipRun >= 3.5 && pipSide >= .75; }
    // over a building cell below the tallest roofs the lens may be inside the building (or pressed to its wall)
    const top = world && world.bounds ? world.bounds.max.y : 30, ci = Math.floor((B2.x - L.x0) / L.cell), ck = Math.floor((B2.z - L.z0) / L.cell);
    const own = ci >= 0 && ck >= 0 && ci < L.nx && ck < L.nz ? L.grid[ck * L.nx + ci] : 0; if (own === 1 && B2.y < top + 2) return false;
    if (B2.y - L.y < 9) { pipOpenDir(B2, L); return pipRun >= 3; }
    return true;
  };
  let pipNone = false;
  function pipPick(pd, tf) {
    pipNone = false; const bad = (i) => { const b = pipBad.get(i); return b != null && Math.abs(tf - b) < 30; };
    if (!tape || (pipOK(pd, tf) && !bad(pd))) return pd;
    droneAt(tape, tf, pd, B2); const x = B2.x, z = B2.z; let best = -1, bd = 1e18;
    for (let i = 0; i < tape.N; i++) { if (i === pd || bad(i) || !pipOK(i, tf)) continue; const d = (B2.x - x) ** 2 + (B2.z - z) ** 2; if (d < bd) { bd = d; best = i; } }
    if (best < 0) { pipNone = true; return pd; } return best;
  }
  const pipVisible = () => pipFlag && (!curShot || ['chase', 'cutaway', 'focus', 'flock'].includes(curShot.kind) || PH === false);

  // ------------------------------------------------------------------ frame loop
  let raf = 0, last = performance.now(), clock = 0, running = true, frames = 0, fpsT = 0, fps = 0;
  // software GL (tests) renders on demand: the logic runs every frame, the picture every testRenderMs or on renderNow()
  let lastRender = -1e9, wantRender = false;
  const simInfo = () => { const ch = chapters[chapterAt(P)]; return `sim ${simClock(tape, curTf)} · ×${ch ? Math.max(1, Math.round(ch.rate * speed)) : 1}`; };
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!running || document.hidden) { last = now; return; }
    try { frameBody(now); } catch (e) { resetGL(); if (frameErr++ < 3) console.warn('[act4] frame failed', e); }
  }
  function frameBody(now) {
    const dtRaw = Math.min(TEST ? 1 : .25, (now - last) / 1000), dt = TEST ? dtRaw : Math.min(.05, dtRaw); last = now; clock += dt; frames++;
    if (now - fpsT > 1000) { fps = frames; frames = 0; fpsT = now; }
    // nothing to draw behind the (opaque) picker, and nothing while a mission loads except one frame of its place:
    // the GPU rests and the simulator gets the main thread
    const idle = (picker.shown && !wantRender) || (loading && !wantRender);
    if (!TEST && !idle) R.adapt(dtRaw); else if (!TEST) R.resetAdapt();
    const q0 = performance.now();
    lenses.update(dt);
    playback(dt, clock);
    const q1 = performance.now();
    if (world && world.update && !idle) { try { world.update(clock, dt); } catch (e) { /* a world's animation must never stop the film */ } }
    const q2 = performance.now();
    { const goal = cards.active.length && !PH ? cardsHalf : 0; const n = offNow + (goal - offNow) * (1 - Math.exp(-dt * 1.6)); if (Math.abs(n - offNow) > .05) { offNow = n; director.setFrame(viewW, viewH, offNow, PH ? 0 : 22); } }
    director.update(dt, ctx);
    afterCamera(dt);
    prof.play = q1 - q0; prof.world = q2 - q1; prof.dir = performance.now() - q2;
    if (!idle && (!TEST || wantRender || (playing && now - lastRender > (opts.testRenderMs ?? 2500)))) { safeDraw(); lastRender = now; wantRender = false; }
    const q3 = performance.now();
    if (tape) { dock.update(P, playing, simInfo()); cards.update(curTf, TEST); }
    prof.ui = performance.now() - q3; prof.frame = performance.now() - q0;
  }
  const prof = {};
  // under a canopy: when the camera follows or looks at something below the crowns, cut the crowns in front of it away
  let cutOn = 0;
  function afterCamera(dt) {
    // fog thins as the camera pulls back, so a wide or top-down shot is not washed out (at most ~30 % fog at the target)
    if (scene.fog && fogBase) { const d = camera.position.distanceTo(director.tgt); scene.fog.density = Math.min(fogBase, .46 / Math.max(1, d)); }
    updateCutout(dt);
  }
  function updateCutout(dt) {
    if (!mod || !mod.cutout || !world) { if (cutOn) { cutOn = 0; cutout.set(0); } return; }
    const T = director.tgt, C = camera.position, d = C.distanceTo(T);
    const top = world.canopyTopAt ? world.canopyTopAt(T.x, T.z) : T.y + 30;
    const s = curShot && curShot.kind, follow = s === 'cutaway' || s === 'chase' || s === 'pov' || (s === 'focus' && d < 120) || director.user;
    const goal = follow && T.y < top - 3 && d < 220 ? 1 : 0;
    cutOn += (goal - cutOn) * (1 - Math.exp(-(dt || .1) * 3)); if (Math.abs(goal - cutOn) < .01) cutOn = goal;
    cutout.set(cutOn, C, T, Math.max(mod.cutout.radius ?? 10, Math.min(20, d * .22)));
  }
  function draw() { R.render(clock); const bad = mainProbe(); renderPip(clock); sceneLabels(curTf, lenses.W, lenses.B); return bad; }
  // the renderer's state as the main pass expects it: no render target, no scissor, the whole canvas
  function resetGL() { renderer.setRenderTarget(null); renderer.setScissorTest(false); renderer.setViewport(0, 0, R.w, R.h); renderer.autoClear = true; }
  let frameErr = 0;
  function safeDraw() { try { draw(); } catch (e) { resetGL(); if (frameErr++ < 3) console.warn('[act4] frame failed', e); } }
  // a safety net for the director: a few times a second the middle of the picture is checked; if it is one flat colour
  // (the camera ended up inside a building, a slab or a hill), the shot is replaced by a wider, higher view of its target
  let mainProbeT = -1, mainBuf = null, lastMain = null;
  function mainProbe() {
    if (!tape || director.user || droneView || !curShot || (!TEST && clock - mainProbeT < 1)) return false; mainProbeT = clock;
    // (a small region in the middle of the view: reading pixels makes the CPU wait for the GPU, so keep it cheap)
    const gl = renderer.getContext(), pr = renderer.getPixelRatio(), W = Math.min(320, Math.floor(viewW * pr * .4)), H = Math.min(200, Math.floor(viewH * pr * .4)), X = Math.floor(viewW * pr * (PH ? .5 : .43) - W / 2), Y = Math.floor(viewH * pr * .5 - H / 2);
    if (W < 16 || H < 16) return false; if (!mainBuf || mainBuf.length < W * H * 4) mainBuf = new Uint8Array(W * H * 4);
    try { gl.readPixels(X, Y, W, H, gl.RGBA, gl.UNSIGNED_BYTE, mainBuf); } catch (e) { return false; }
    let flat = 0, s1a = 0, s2a = 0, na = 0;
    for (let by = 0; by < 6; by++) for (let bx = 0; bx < 8; bx++) { let s1 = 0, s2 = 0, c = 0; for (let yy = Math.floor(by * H / 6); yy < Math.floor((by + 1) * H / 6); yy += 3) for (let xx = Math.floor(bx * W / 8); xx < Math.floor((bx + 1) * W / 8); xx += 3) { const o = (yy * W + xx) * 4, l = (.2126 * mainBuf[o] + .7152 * mainBuf[o + 1] + .0722 * mainBuf[o + 2]) / 255; s1 += l; s2 += l * l; c++; }
      if (!c) continue; if (Math.sqrt(Math.max(0, s2 / c - (s1 / c) ** 2)) < .018) flat++; s1a += s1; s2a += s2; na += c; } // (film grain alone is ~.004)
    const sd = na ? Math.sqrt(Math.max(0, s2a / na - (s1a / na) ** 2)) : 1; lastMain = { flat: +(flat / 48).toFixed(2), sd: +sd.toFixed(3) };
    if (!(flat / 48 > .7 && sd < .065)) return false;
    // pull back: the same target from twice as far and higher (a hint keeps its building cut)
    const s = director.shot, h = s.kind === 'hint' && world.camera ? world.camera[s.name] : null;
    let fb;
    if (h) { const d = h.pos.distanceTo(h.target), az = Math.atan2(h.pos.x - h.target.x, h.pos.z - h.target.z) + .5; fb = { kind: h.cut != null ? 'cutaway' : 'focus', target: [h.target.x, h.target.y, h.target.z], dist: Math.max(40, d * 2.2), el: 1.05, az, level: h.cut ?? undefined, drift: .006 }; }
    else if ((s.kind === 'focus' || s.kind === 'cutaway') && !s._fb) { const t = director.tgt; fb = { ...s, chase: undefined, target: [t.x, t.y, t.z], dist: (s.dist ?? 40) * 2, el: Math.max(s.el ?? .55, 1.0) }; }
    else fb = { kind: 'wide', drift: .01 };
    fb._fb = true; director.setShot(fb); mainProbeT = clock + 2.5; return true; // give the camera time to get out before checking again
  }
  function resize() {
    const r = view.getBoundingClientRect(); const w = Math.max(16, r.width), hh = Math.max(16, r.height);
    R.setSize(w, hh); res.set(w * R.dpr, hh * R.dpr);
    viewW = w; viewH = hh; cardsHalf = PH ? 0 : Math.min(190, (parseFloat(getComputedStyle(root).getPropertyValue('--cards')) || 336) * .5);
    director.setFrame(w, hh, offNow, PH ? 0 : 22);
    dock.layout();
  }
  let viewW = 1, viewH = 1, cardsHalf = 0, offNow = 0;
  const ro = new ResizeObserver(resize); ro.observe(view); resize();
  raf = requestAnimationFrame(frame);
  // keys
  const typing = (t) => t && t.closest && t.closest('input, textarea, select');
  const onKey = (e) => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ' && tape && !picker.shown) { e.preventDefault(); playing ? pause() : play(); }
    else if (e.key === 'ArrowRight' && tape) seek(P + 5); else if (e.key === 'ArrowLeft' && tape) seek(P - 5);
    else if (/^[1-6]$/.test(e.key)) setLens(LENSES[+e.key - 1].id);
    else if (e.key === 'd' || e.key === 'D') director.giveBack();
    else if (e.key === 'v' || e.key === 'V') setDroneView(!droneView);
    else if (e.key === 'Escape') { if (menu.open) menu.close(); else exitAct(); } // Esc leaves the act (the host's onExit)
  };
  addEventListener('keydown', onKey);
  // start
  if (opts.start && MISSIONS[opts.start]) startMission(opts.start); else showPicker();
  root.focus({ preventScroll: true });

  const api = {
    root, play: () => { held = false; running = true; play(); }, pause: () => hold(), resume: () => unhold(), mission: (id, o) => startMission(id, o), playAll, seek, seekTick: (t) => seek(pAt(t)), lens: setLens, speed: setSpeed, droneView: setDroneView,
    chapter: (i) => { const c = chapters[i]; if (c) seek(c.p0 + .01); },
    director: () => director.giveBack(), takeCamera: () => director.take(), showPicker, pip: (on) => { pipFlag = on; },
    get state() { return { mission: missionId, seed: seedUsed, P, dur, playing, tick: curTf, chapter: chapters[chapterAt(P)]?.id, lens: lenses.current, cards: cards.active, caption: captions.text, world: world && world.__source, fps, dpr: R.dpr, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, shot: curShot && curShot.kind, user: director.user, load: loadInfo }; },
    renderNow(settle = 0) { playback(0, clock); offNow = cards.active.length && !PH ? cardsHalf : 0; director.setFrame(viewW, viewH, offNow, PH ? 0 : 22); for (let i = 0; i < settle; i++) { lenses.update(.1); director.update(.1, ctx); afterCamera(.1); } lenses.update(.016); playback(0, clock); director.update(.016, ctx); afterCamera(.016); if (draw()) { for (let i = 0; i < settle; i++) { director.update(.1, ctx); afterCamera(.1); } draw(); } if (tape) { dock.update(P, playing, simInfo()); cards.update(curTf, true); } return api.state; },
    snapCamera() { director.snapNow(); }, get prof() { return prof; },
    // test helper: how readable the last frame is (luminance spread and edge density of the main view and of the PiP)
    frameStats() {
      const stat = (sx, sy, sw, sh, W, H) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(canvas, sx, sy, sw, sh, 0, 0, W, H); const d = x.getImageData(0, 0, W, H).data, L = new Float32Array(W * H);
        let m = 0; for (let i = 0; i < W * H; i++) { L[i] = (.2126 * d[i * 4] + .7152 * d[i * 4 + 1] + .0722 * d[i * 4 + 2]) / 255; m += L[i]; } m /= W * H; let v = 0, e = 0, n = 0;
        for (let k = 1; k < H - 1; k++) for (let i = 1; i < W - 1; i++) { const q = k * W + i; v += (L[q] - m) ** 2; const g = Math.abs(L[q + 1] - L[q - 1]) + Math.abs(L[q + W] - L[q - W]); if (g > .06) e++; n++; }
        // flat: the share of 12 x 8 blocks with almost no variation (a wall or slab filling part of the picture)
        let flat = 0; const bw = W / 12, bh = H / 8; for (let by = 0; by < 8; by++) for (let bx = 0; bx < 12; bx++) { let s1 = 0, s2 = 0, c = 0; for (let k = Math.floor(by * bh); k < Math.floor((by + 1) * bh); k++) for (let i = Math.floor(bx * bw); i < Math.floor((bx + 1) * bw); i++) { const l = L[k * W + i]; s1 += l; s2 += l * l; c++; } const sd = Math.sqrt(Math.max(0, s2 / c - (s1 / c) ** 2)); if (sd < .012) flat++; }
        let bad = 0, hot = 0; for (let i = 0; i < W * H; i++) { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; if (r > 235 && b > 235 && g < 40) bad++; else if (g > 235 && r < 40 && b < 40) hot++; } // (the guard's debug flag paints NaN/Inf magenta, >2000 green)
        return { mean: +m.toFixed(3), std: +Math.sqrt(v / n).toFixed(3), edge: +(e / n).toFixed(3), flat: +(flat / 96).toFixed(2), nan: bad, hot }; };
      const cw = canvas.width, ch = canvas.height, cr = canvas.getBoundingClientRect(), k = cw / Math.max(1, cr.width);
      const main = stat(0, 0, cw * (PH ? 1 : .7), ch * .8, 192, 120);
      const pr = pipEl.getBoundingClientRect(), pipOn = pipEl.classList.contains('on') && pr.width > 10;
      const pip = pipOn ? stat((pr.left - cr.left) * k, (pr.top - cr.top) * k, pr.width * k, pr.height * k, 96, 60) : null;
      let pd = null; if (tape) { droneAt(tape, curTf, pipDrone, A); const L = tape.layers[A.layer]; pd = { d: pipDrone, layer: L && L.id, kind: L && L.kind, y: +A.y.toFixed(2), ly: L && +L.y.toFixed(2), b1: L && L.b1, ok: pipOK(pipDrone, curTf), run: pipRun, side: pipSide, none: pipNone, cut: director.cutValue, probe: lastProbe, bad: [...pipBad.keys()], main: lastMain, fb: !!(director.shot && director.shot._fb) }; }
      const cam = camera.position; return { main, pip, pd, cam: [Math.round(cam.x), Math.round(cam.y), Math.round(cam.z)], shot: curShot && curShot.kind, chapter: chapters[chapterAt(P)]?.id };
    },
    timeDraw() { const gl = renderer.getContext(); const t0 = performance.now(); R.render(clock); gl.finish(); const t1 = performance.now(); renderPip(clock); gl.finish(); const t2 = performance.now(); sceneLabels(curTf, lenses.W, lenses.B); return { composer: Math.round(t1 - t0), pip: Math.round(t2 - t1), labels: Math.round(performance.now() - t2), calls: renderer.info.render.calls }; },
    get tape() { return tape; }, get script() { return script; }, get chapters() { return chapters; }, get world() { return world; },
    _dbg: { scene, camera, renderer, R, overlay, swarm, director, lenses },
    pause2() { running = false; },
    destroy() {
      if (destroyed) return; destroyed = true; clearTimeout(prefetchT); cancelJob(); tapeCache.clear();
      for (const c of worldCache.values()) if (c.world !== world) { scene.remove(c.world.group); disposeWorld(c.world); } worldCache.clear();
      canvas.removeEventListener('webglcontextlost', onLost);
      cancelAnimationFrame(raf); running = false; playing = false; ro.disconnect(); removeEventListener('keydown', onKey); loadId++; tour = null;
      clearTimeout(toastT); clearTimeout(tourT);
      try { music.destroy(); } catch (e) { /* ignore */ }
      menu.dispose(); dock.dispose(); director.dispose();
      if (world) { scene.remove(world.group); try { world.dispose && world.dispose(); } catch (e) { /* ignore */ } }
      overlay.dispose(); swarm.dispose();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }); });
      if (props) props.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }); });
      world = null; tape = null; script = null; chapters = []; cutout.reset();
      R.dispose(); root.remove();
    },
  };
  return api;
}

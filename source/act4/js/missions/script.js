// Shared script builder: turns a tape into chapters, captions, beats and shots. Each mission passes its own words and
// a few options; every time comes from the tape (events and metrics), never from a fixed clock.
//   chapters: [{ id, title, label, concept, t0, t1, rate }]   (ticks; rate = sim seconds per playback second)
//   captions: [{ t, text }]   beats: [{ t0, t1, concept }]   shots: [{ t, kind, ... , cut }]
import { ST } from '../sim/tape.js';
export const v = (p) => (p ? { x: p.x, y: p.y ?? 0, z: p.z } : null);
export function centreOf(world) {
  if (world.bounds && world.bounds.isBox3) { const c = world.bounds.getCenter(world.bounds.min.clone()); return { x: c.x, y: 0, z: c.z }; }
  const L = world.layers[0]; return { x: L.x0 + L.nx * L.cell / 2, y: 0, z: L.z0 + L.nz * L.cell / 2 };
}
const DEFAULT = {
  intro: 'The responders arrive. A drone on a cable rises above them: the swarm’s radio mast. It sends no commands.',
  tether: 'The tethered drone is the swarm’s fixed point, not its leader: a mast, a high camera and a floodlight.',
  launch: 'The drones lift off one by one and gather above the base.',
  transit: 'They cross as one flock. Each copies its neighbours’ heading, with just enough noise to stay responsive.',
  swerve: 'One drone swerves; its neighbours turn with it, and the turn ripples through the flock. No message was sent.',
  arrive: 'The flock arrives and breaks up into searchers.',
  split: 'The ground robots park where the damage is worst. The swarm splits into teams around them; nobody assigned them.',
  search: 'Each drone heads for the nearest unsearched place no neighbour has claimed, using its own copy of the map.',
  search2: 'Maps travel drone to drone. Whatever one has searched, its neighbours soon know.',
  out: 'Drone {d} slips out of radio range. It keeps mapping on its own.',
  merge: 'Back in range, drone {d}’s map merges with the others in one step. A union has nothing to reconcile.',
  battery: 'Drone {d}’s battery fails. Its neighbours already hold everything it mapped, and they spread into its area.',
  detectP: 'A warm signal on drone {d}’s thermal camera.',
  detectD: 'Something warm on drone {d}’s thermal camera.',
  tip: 'The signal tilts the landscape until the search valley vanishes. Nearby drones converge on their own.',
  find: 'Thermal and camera agree: {count}, alive. The position goes to the responders.',
  findThermal: 'The cameras cannot get a clear view, but the heat signature holds: {count}, flagged for the rescuers to check.',
  findMore: 'Another find: {count}. {total} found so far, each handed to the responders.',
  handover: 'Handed over. The landscape tilts back and the drones return to the search.',
  reject: '{label}: warm, but the camera disagrees. The signal never reached the tipping point, so nobody converged.',
  aftershock: 'An aftershock. The drones inside pull out and wait for the rubble to settle.',
  reservoir: 'Nothing told them it happened: the swarm’s own motion carries the signal, and a simple readout spikes.',
  slowing: 'Order comes back slowly. Near the threshold the swarm takes its time, and that slowness says where it sits.',
  gust: 'A gust shoves the drones above the canopy off their lines.',
  current: 'A current pushes a boat off course; the swarm’s map gives it a new way round.',
  water: 'The water rises in a passage. Drones there pull back; the swarm marks it for divers.',
  pocket: 'One void stays sealed: mapped all round, never entered. β₂ flags it for the listening devices.',
  koopman: 'From its own recent motion, the swarm forecasts where its search edge will be a minute from now.',
  stigmergy: 'Drones leave marks on the world where they enter. Later drones read them and go somewhere else.',
  beacon: 'Drone {d} drops a relay beacon at a junction: the radio chain grows as the swarm goes deeper.',
  front: 'The drones spread into a line. Each climbs a chemical-like field and keeps its neighbours at arm’s length.',
  frontDone: 'The line has crossed the whole area. Now the drones mop up whatever it missed.',
  proof: 'What is left is counted as separate unsearched pockets: {b} now. The search ends only at zero.',
  complete: 'Nothing unsearched is left: β₀ of the unknown is zero. The drones come home.',
  home: 'Every drone flies home. The responders now hold the same map the swarm built.',
  fpga: 'Counting the holes, merging the maps and the forecast run as fixed hardware: the same cycles every tick.',
};
const NUMW = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const fill = (s, o = {}) => s.replace(/\{(\w+)\}/g, (_, k) => (o[k] ?? ''));
const NAMES = { vicsek: 'Vicsek order', slowing: 'Slowing down', symmetry: 'Symmetry breaking', turing: 'Turing spacing', phase: 'Phase change', stigmergy: 'Stigmergy', crdt: 'Merging maps', topology: 'β₀ to zero', pocket: 'β₂ void', koopman: 'Forecast', reservoir: 'Reservoir', fpga: 'FPGA', null: '' };
export const conceptName = (c) => NAMES[c] || '';

export function buildScript(tape, world, words = {}, opt = {}) {
  const W = { ...DEFAULT, ...words };
  const T = tape.T, dt = tape.dt, s2t = (s) => Math.round(s / dt);
  const E = tape.events, first = (type, from = 0) => E.find((e) => e.type === type && e.t >= from);
  const all = (type) => E.filter((e) => e.type === type);
  const clampT = (t) => Math.max(0, Math.min(T - 1, Math.round(t)));
  const complete = first('complete')?.t ?? T - s2t(40);
  const keys = [];
  const key = (id, title, concept, t0, t1, rate, extra = {}) => { t0 = clampT(t0); t1 = clampT(t1); if (t1 - t0 >= 4) keys.push({ id, title, concept, t0, t1, rate, ...extra }); };
  // first tick any drone searches / is on a front
  let firstSearch = T - 1; for (let t = 0; t < T && firstSearch === T - 1; t += 2) for (let i = 0; i < tape.N; i++) { const st = tape.drones[(t * tape.N + i) * tape.DR + 4]; if (st === ST.SEARCH || st === ST.FRONT) { firstSearch = t; break; } }
  const dep = first('depart'), arr = first('arrive'), fr = first('front'), frDone = first('front_done');
  key('intro', opt.introTitle || 'Arrival', null, 0, dep ? dep.t : fr ? fr.t : firstSearch, opt.introRate ?? 3.4);
  if (dep && arr) key('transit', opt.transitTitle || 'Crossing as one', 'vicsek', dep.t, arr.t + s2t(6), opt.transitRate ?? 1.3);
  if (fr) { const f1 = frDone ? frDone.t : fr.t + s2t(180);
    // a long sweep becomes two chapters: the line forming, then the line moving on (with its own concept)
    if (opt.front2 && f1 - fr.t > s2t(300)) { const mid = fr.t + Math.round((f1 - fr.t) * .45); key('front', opt.frontTitle || 'Holding a line', 'turing', fr.t, mid, opt.frontRate ?? 6, { also: ['vicsek'] }); key('front2', opt.front2.title, opt.front2.concept, mid, f1, opt.frontRate ?? 6, { prio: 8 }); }
    else key('front', opt.frontTitle || 'Holding a line', 'turing', fr.t, f1, opt.frontRate ?? 6, { also: ['vicsek'] }); }
  const parks = all('ugv_park'), joins = all('join');
  if (parks.length && joins.length) { const t0 = Math.max(arr ? arr.t + s2t(6) : 0, Math.min(...joins.map((e) => e.t)) - s2t(4)); key('split', opt.splitTitle || `${NUMW[parks.length] || parks.length} teams, no orders`.replace(/^./, (m) => m.toUpperCase()), 'symmetry', t0, t0 + s2t(opt.splitSec ?? 50), opt.splitRate ?? 2.4); }
  // finds: one chapter each for at most three of them (the first, then the most spread out); the rest are moments
  const tips = all('tip'); const finds = all('find');
  const findKeys = [];
  for (const tp of tips) {
    const f = finds.find((q) => q.cand === tp.cand), det = E.find((q) => q.type === 'detect' && q.cand === tp.cand);
    const t0 = (det ? Math.min(det.t, tp.t) : tp.t) - s2t(6), t1 = (f ? f.t + s2t(opt.findTail ?? 22) : tp.t + s2t(50));
    findKeys.push({ t0, t1, cand: tp.cand });
  }
  // the count to zero: the last stretch before completion (finds are picked before it, so the film does not count
  // down and then cut back to another find)
  let tProof = complete - s2t(opt.proofSec ?? 140);
  for (let t = Math.floor(T * .45); t < complete; t++) if (tape.metrics.coverage[t] >= (opt.proofCov ?? .9)) { tProof = Math.max(tProof, t); break; }
  const chosen = [];
  if (findKeys.length) { chosen.push(findKeys[0]); const early = findKeys.slice(1).filter((k) => k.t1 <= tProof), rest = early.length ? early : findKeys.slice(1); while (chosen.length < (opt.maxFinds ?? 3) && rest.length) { let bi = 0, bd = -1; rest.forEach((k, i) => { const d = Math.min(...chosen.map((c) => Math.abs(c.t0 - k.t0))); if (d > bd) { bd = d; bi = i; } }); chosen.push(rest.splice(bi, 1)[0]); } }
  chosen.sort((a, b) => a.t0 - b.t0);
  while (chosen.length) { const lf = chosen[chosen.length - 1]; if (lf.t1 <= tProof || lf.t0 >= complete) break; if (complete - lf.t1 >= s2t(30)) { tProof = lf.t1; break; } if (chosen.length === 1) break; chosen.pop(); }
  chosen.forEach((k, i) => key('find' + i, i === 0 ? (opt.findTitle || 'A find') : i === chosen.length - 1 && chosen.length > 2 ? 'The last find' : 'Another find', 'phase', k.t0, k.t1, opt.findRate ?? 2.2, { cand: k.cand, prio: 6, min: s2t(16) }));
  for (const type of ['aftershock', 'gust', 'current', 'water_rise']) { const e = first(type); if (!e) continue; const shake = type === 'aftershock' || type === 'gust';
    key('dist', type === 'aftershock' ? 'Aftershock' : type === 'gust' ? 'A gust' : type === 'current' ? 'The current' : 'Rising water', shake ? 'slowing' : type === 'current' ? 'crdt' : 'topology', e.t - s2t(5), e.t + s2t(opt.distSec ?? 46), opt.distRate ?? 1.8, { also: shake ? ['reservoir'] : [], ev: e, prio: 7, min: s2t(30) }); }
  key('proof', opt.proofTitle || 'Counting to zero', 'topology', tProof, complete, opt.proofRate ?? 4.5, { prio: 5, min: s2t(30) });
  key('home', opt.homeTitle || 'Home', 'topology', complete, T - 1, opt.homeRate ?? 3.2, { also: [], prio: 10 });
  // allocate time by priority: each key takes what is still free of its span (its largest free piece)
  const PRI = { intro: 10, transit: 9, split: 8, front: 8 };
  for (const k of keys) { k.prio = k.prio ?? PRI[k.id] ?? 4; k.min = k.min ?? 6; }
  const taken = [];
  const ch = [];
  for (const k of [...keys].sort((a, b) => b.prio - a.prio)) {
    let pieces = [[k.t0, k.t1]];
    for (const [a, b] of taken) pieces = pieces.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, Math.min(y, a)], [Math.max(x, b), y]].filter(([p, q]) => q - p > 0)));
    if (!pieces.length) continue;
    const best = pieces.reduce((m, p) => (p[1] - p[0] > m[1] - m[0] ? p : m));
    if (best[1] - best[0] < Math.min(k.min, k.t1 - k.t0)) continue;
    k.t0 = best[0]; k.t1 = best[1]; taken.push([k.t0, k.t1]); ch.push(k);
  }
  ch.sort((a, b) => a.t0 - b.t0);
  // fill the gaps with searching (maps merging over the mesh)
  const out = []; let cur = 0, ns = 0;
  for (const c of ch) {
    if (c.t0 > cur + 4) { const len = c.t0 - cur; if (len > s2t(220)) { const mid = cur + Math.round(len / 2); out.push(searchCh(cur, mid, ns++)); out.push(searchCh(mid, c.t0, ns++)); } else out.push(searchCh(cur, c.t0, ns++)); }
    c.t0 = Math.max(c.t0, cur); out.push(c); cur = c.t1;
  }
  if (cur < T - 1) out.push(searchCh(cur, T - 1, ns++));
  function searchCh(t0, t1, n) { return { id: 'search' + n, title: n === 0 ? (opt.searchTitle || 'Searching') : n === 1 ? (opt.searchTitle2 || 'Mapping together') : n === 2 ? (opt.searchTitle3 || 'Closing in') : (opt.searchTitle4 || 'Every corner'), concept: n % 2 === 0 ? 'crdt' : (opt.search2Concept || 'koopman'), t0, t1, rate: opt.searchRate ?? 6 }; }
  for (let i = out.length - 1; i > 0; i--) if (out[i].t1 - out[i].t0 < 3 || out[i].id.startsWith('search') && out[i].t1 - out[i].t0 < s2t(14)) { out[i - 1].t1 = out[i].t1; out.splice(i, 1); }
  { let n = 0; for (const c of out) if (c.id.startsWith('search')) { const r = searchCh(c.t0, c.t1, n++); c.id = r.id; c.title = r.title; c.concept = r.concept; } }
  { const fs = out.filter((c) => c.id.startsWith('find')); fs.forEach((c, i) => { c.title = i === 0 ? (opt.findTitle || 'A find') : i === fs.length - 1 && fs.length > 2 ? 'The last find' : 'Another find'; }); }
  out.forEach((c, i) => { if (i) c.t0 = out[i - 1].t1; });
  out[out.length - 1].t1 = T - 1;
  // playback lengths: scale every rate so the film lasts about the target duration
  const target = opt.target ?? 175;
  const MINP = { proof: opt.proofMin ?? 18 }, MAXP = { home: opt.homeMax ?? 18, intro: opt.introMax ?? 20 };
  for (const c of out) { c.minPlay = c.minPlay ?? MINP[c.id] ?? (c.id.startsWith('find') ? 13 : 7); c.maxPlay = c.maxPlay ?? MAXP[c.id] ?? 1e9; }
  const play = (c) => Math.min(c.maxPlay, Math.max(c.minPlay, (c.t1 - c.t0) * dt / c.rate));
  let tot = out.reduce((a, c) => a + play(c), 0);
  for (let it = 0; it < 12 && Math.abs(tot - target) > 2; it++) { const k = tot / target; for (const c of out) c.rate *= k; tot = out.reduce((a, c) => a + play(c), 0); }
  for (const c of out) c.rate = (c.t1 - c.t0) * dt / play(c);
  for (const c of out) { c.label = (c.id === 'home' ? c.title : conceptName(c.concept)) || c.title; c.conceptName = conceptName(c.concept); }

  // ------------------------------------------------------------------ captions
  const cap = []; const say = (t, text, prio) => { if (text) cap.push({ t: clampT(t), text, prio }); };
  const chOf = (id) => out.find((c) => c.id === id);
  say(0, W.intro);
  const tu = first('tether_up'); if (tu) say(tu.t + s2t(4), W.tether);
  const ln = first('launch'); if (ln) say(ln.t + s2t(2), W.launch);
  if (dep) say(dep.t, W.transit);
  const sw = first('swerve'); if (sw) say(sw.t, W.swerve);
  if (fr) say(fr.t + s2t(4), W.front); if (frDone) say(frDone.t, W.frontDone);
  const sp = chOf('split'); if (sp) { const n = tape.ugvParks.length; say(sp.t0, fill(W.split, { n: NUMW[n] || n, N: String(NUMW[n] || n).replace(/^./, (m) => m.toUpperCase()) })); }
  for (const c of out.filter((q) => q.id.startsWith('search'))) say(c.t0 + s2t(2), c.id === 'search0' ? W.search : W.search2);
  const outs = all('out'), merges = all('merge');
  // the first long disconnection that ends in a merge (the CRDT story)
  let story = null; for (const o of outs) { const m = merges.find((q) => q.drone === o.drone && q.t > o.t && q.t - o.t < s2t(240)); if (m) { story = { o, m }; break; } }
  if (story) { say(story.o.t, fill(W.out, { d: story.o.drone + 1 })); say(story.m.t, fill(W.merge, { d: story.m.drone + 1 })); }
  const bat = first('battery'); if (bat) say(bat.t, fill(W.battery, { d: bat.drone + 1 }));
  const mk = tape.marks.length > 3 ? tape.marks[Math.min(3, tape.marks.length - 1)] : null; if (mk && W.stigmergy) say(mk.t, W.stigmergy);
  const bc = first('beacon'); if (bc) say(bc.t, fill(W.beacon, { d: bc.drone + 1 }));
  // a find with its own chapter (or the very first) is told in full: signal, tip, agreement, handover; the others are
  // one short line with the running total, and may give way to more important sentences
  const findCh = new Set(out.filter((c) => c.id.startsWith('find')).map((c) => c.cand));
  const ppl = (n) => (n > 1 ? `${n} people` : 'one person');
  let total = 0, nFound = 0;
  for (const tp of tips) {
    const det = E.find((q) => q.type === 'detect' && q.cand === tp.cand), f = finds.find((q) => q.cand === tp.cand), hand = E.find((q) => q.type === 'handover' && q.cand === tp.cand);
    const fd = tape.finds.find((q) => q.cand === tp.cand), n = fd ? fd.count || 1 : 1;
    const full = findCh.has(tp.cand) || nFound === 0;
    if (f) { total += n; nFound++; }
    if (full) {
      if (det) say(det.t, fill(W.detectP, { d: (det.drone ?? 0) + 1 }));
      say(tp.t, W.tip);
      if (f) say(f.t, fd && fd.thermalOnly ? fill(W.findThermal, { count: ppl(n) }) : fill(W.find, { count: ppl(n), where: fd ? fd.layer : '' }) + (fd && fd.note && opt.notes !== false ? ` (${fd.note})` : ''), true);
      if (hand) say(hand.t, W.handover);
    } else if (f) say(f.t, fill(W.findMore, { count: ppl(n), total: total === 1 ? 'one person' : `${total} people`, Total: total }), false);
  }
  for (const r of all('reject')) { const det = E.find((q) => q.type === 'detect' && q.cand === r.cand); if (det) say(det.t, fill(W.detectD, { d: (det.drone ?? 0) + 1 })); const lbl = r.label || 'Something warm'; say(r.t, fill(W.reject, { label: lbl.charAt(0).toUpperCase() + lbl.slice(1) })); }
  for (const [type, wk] of [['aftershock', 'aftershock'], ['gust', 'gust'], ['current', 'current'], ['water_rise', 'water']]) { const e = first(type); if (e) { say(e.t, W[wk]); if (type === 'aftershock' || type === 'gust') { say(e.t + s2t(12), W.reservoir); say(e.t + s2t(30), W.slowing); } } }
  const pk = tape.pockets.find((p) => p.t >= 0); if (pk) say(pk.t, W.pocket);
  const pc = chOf('proof'); if (pc && W.proof) { say(pc.t0 + 2, fill(W.proof, { b: tape.metrics.beta0[pc.t0] })); cap[cap.length - 1].live = W.proof; } // {b} follows the count
  if (pc && W.fpga) say(Math.round(pc.t0 + (pc.t1 - pc.t0) * .55), W.fpga);
  say(complete, W.complete);
  const ld = first('landed'); say((ld ? ld.t : complete) - s2t(30), W.home);
  if (tape.forecast.length > 4 && W.koopman) { const s1 = out.find((c) => c.concept === 'koopman') || out.find((c) => c.id.startsWith('search')); if (s1) say(s1.t0 + Math.round((s1.t1 - s1.t0) * .45), W.koopman, true); }
  cap.sort((a, b) => a.t - b.t);
  // keep captions readable: at least ~4.5 s of playback each
  const pAt = (t) => { let p = 0; for (const c of out) { if (t >= c.t1) { p += play(c); continue; } if (t > c.t0) p += (t - c.t0) * dt / c.rate; break; } return p; };
  const caps = []; for (const c of cap) { const last = caps[caps.length - 1]; if (last && pAt(c.t) - pAt(last.t) < 4.2) { if (c.prio || (c.prio !== false && /found|agree|zero|fails|aftershock/i.test(c.text))) { last.t2 = c.t; caps.push(c); } else continue; } else caps.push(c); }
  // ------------------------------------------------------------------ beats (cards and forced overlays)
  const beats = [];
  const beat = (concept, t0, t1, extra = {}) => { if (t1 > t0) beats.push({ concept, t0: clampT(t0), t1: clampT(t1), ...extra }); };
  for (const c of out) { if (c.concept && c.id !== 'home') beat(c.concept, c.t0, c.t1); for (const a of c.also || []) beat(a, c.t0, c.t1); }
  if (story) beat('crdt', story.o.t - s2t(4), story.m.t + s2t(30));
  if (bat) beat('crdt', bat.t, bat.t + s2t(40));
  if (pk) beat('pocket', pk.t, Math.min(T - 1, pk.t + s2t(90)));
  if (pc) beat('fpga', pc.t0 + Math.round((pc.t1 - pc.t0) * .5), pc.t1);
  if (mk) beat('stigmergy', mk.t - s2t(4), mk.t + s2t(60));
  if (bc) beat('stigmergy', bc.t - s2t(2), bc.t + s2t(80));
  for (const r of all('reject')) beat('phase', r.t - s2t(20), r.t + s2t(8));
  const hm = chOf('home'); if (hm) beat('topology', hm.t0, hm.t0 + s2t(20));
  beats.sort((a, b) => a.t0 - b.t0);
  // ------------------------------------------------------------------ shots
  const shots = [];
  const shot = (t, sh) => shots.push({ t: clampT(t), ...sh });
  const hasHint = (n) => !!(world.camera && world.camera[n]);
  const H = (t, names, extra = {}) => { for (const n of [].concat(names)) if (hasHint(n)) { shot(t, { kind: 'hint', name: n, drift: .008, ...extra }); return true; } return false; };
  // which of the world's camera hints play which role (missions override; the city's names are the defaults)
  const RO = { wide: ['wide'], wide2: ['wide_east', 'wide'], base: ['van', 'base'], mast: [], search: ['wide'], search2: ['wide_east', 'wide'], top: ['top'], home: ['wide'], homeClose: ['van', 'base'], find: [], decoy: [], pocket: ['pocket'], water: [], ...(opt.roles || {}) };
  const base = tape.base, teth = tape.tether;
  const layerOfId = (id) => tape.layers.find((l) => l.id === id);
  const Rw = (() => { const b = world.bounds; if (b && b.isBox3) { const sz = b.getSize(b.min.clone()); return Math.max(sz.x, sz.z) * .5; } return opt.radius ?? 110; })();
  const R = opt.radius ?? Rw;
  const allIn = !tape.layers.some((l) => l.outdoor);
  const chaseShot = (t, d, extra = {}) => { const L = layerAt(tape, d, t + s2t(6)) || (allIn ? tape.layers[0] : null); if (L && !L.outdoor) shot(t, { kind: 'cutaway', chase: d, dist: opt.chaseIn ?? 26, el: opt.chaseEl ?? 1.0, az: opt.chaseAz ?? .6, level: L.id, drift: .01, ...extra }); else shot(t, { kind: 'chase', drone: d, dist: opt.chaseOut ?? 22, el: .5, ...extra }); };
  const inCh = (t, pred) => { const c = out.find((q) => t >= q.t0 && t < q.t1); return c && pred(c); };
  for (const c of out) {
    const len = c.t1 - c.t0;
    if (c.id === 'intro') {
      if (!H(c.t0, RO.wide, { cut: true, drift: .012 })) shot(c.t0, { kind: 'wide', dist: R * 1.9, el: .55, az: opt.introAz ?? .85, drift: .015, cut: true });
      if (!H(c.t0 + len * .32, RO.base, { drift: .02 })) shot(c.t0 + len * .32, { kind: 'focus', target: [teth.station.x, teth.station.y + 4, teth.station.z], dist: opt.vanDist ?? 30, el: .3, az: (opt.introAz ?? .85) - .25, drift: .02 });
      if (!H(c.t0 + len * .62, RO.mast, { drift: .015 })) shot(c.t0 + len * .62, { kind: 'focus', target: [teth.hover.x * .5 + teth.station.x * .5, teth.hover.y * .55, teth.hover.z * .5 + teth.station.z * .5], dist: opt.mastDist ?? 58, el: opt.mastEl ?? .16, az: opt.mastAz ?? ((opt.introAz ?? .85) + 2.4), drift: .02 });
    } else if (c.id === 'transit') shot(c.t0, { kind: 'flock', states: [ST.TRANSIT], el: .38, az: opt.flockAz ?? 1.9, k: 2.1, min: 48, drift: .012 });
    else if (c.id === 'front') { shot(c.t0, { kind: 'flock', states: [ST.FRONT], el: .75, az: opt.frontAz ?? .4, k: 1.25, min: 70, drift: .008 }); shot(c.t0 + len * .55, { kind: 'flock', states: [ST.FRONT], el: 1.15, az: (opt.frontAz ?? .4) + .25, k: 1.15, min: 70, drift: .004 }); }
    else if (c.id === 'front2') { if (!H(c.t0, RO.search, { drift: .008 })) shot(c.t0, { kind: 'flock', states: [ST.FRONT], el: .55, az: (opt.frontAz ?? .4) + 1.2, k: 1.3, min: 70, drift: .008 }); shot(c.t0 + len * .5, { kind: 'flock', states: [ST.FRONT], el: .9, az: (opt.frontAz ?? .4) - .5, k: 1.2, min: 70, drift: .006 }); }
    else if (c.id === 'split') { const parks = tape.ugvParks; const cx = parks.reduce((a, p) => a + p.x, 0) / Math.max(1, parks.length), cz = parks.reduce((a, p) => a + p.z, 0) / Math.max(1, parks.length);
      let spread = 30; for (const p of parks) spread = Math.max(spread, Math.hypot(p.x - cx, p.z - cz)); shot(c.t0, { kind: 'focus', target: [cx, 0, cz], dist: spread * 1.9 + 55, el: .95, az: .35, drift: .006 }); }
    else if (c.id.startsWith('find')) {
      const cd = tape.candidates.find((q) => q.id === c.cand) || tape.candidates[0]; const L = cd && layerOfId(cd.layer); const ind = L && !L.outdoor;
      if (RO.find.length && H(c.t0, RO.find, { drift: .012 })) { shot(c.t0 + len * .5, { kind: ind ? 'cutaway' : 'focus', target: cd.pos, dist: (ind ? opt.findDistIn ?? 32 : opt.findDistOut ?? 52) * .8, el: opt.findEl2 ?? .9, az: 1.5, level: ind ? L.id : undefined, drift: .012 }); }
      else if (ind) { if (!(L.building && H(c.t0, ['inside_' + L.building], { drift: .01 }))) shot(c.t0, { kind: 'cutaway', target: cd.pos, dist: opt.findDistIn ?? 32, el: .95, az: .6, level: L.id, drift: .012 });
        shot(c.t0 + len * .5, { kind: 'cutaway', target: cd.pos, dist: (opt.findDistIn ?? 32) * .72, el: 1.05, az: 1.5, level: L.id, drift: .012 }); }
      else { shot(c.t0, { kind: 'focus', target: cd.pos, dist: opt.findDistOut ?? 52, el: .72, az: .6, drift: .012 }); shot(c.t0 + len * .5, { kind: 'focus', target: cd.pos, dist: (opt.findDistOut ?? 52) * .7, el: .62, az: 1.5, drift: .012 }); }
    } else if (c.id === 'dist') { const ev = c.ev; const water = ev && ev.type === 'water_rise' && RO.water.length && H(c.t0, RO.water, { drift: .01 });
      if (!water && !H(c.t0, RO.wide2, { drift: .01 })) shot(c.t0, { kind: 'wide', dist: R * 1.7, el: .6, az: 1.2, drift: .01 });
      if (water) H(c.t0 + Math.round(len * .55), RO.wide2, { drift: .01 }); } // the rising water, then where it sits in the whole cave
    else if (c.id.startsWith('proof')) {
      // optionally: frame what is still unsearched (an oblique, closer view) before the map-like view from the top
      const U = opt.proofFocus ? unsearchedAt(tape, c.t0 + Math.round((c.t1 - c.t0) * .15)) : null;
      if (U) { shot(c.t0, { kind: 'focus', target: [U.x, U.y, U.z], dist: Math.max(opt.proofMinDist ?? 90, Math.min(R * 1.5, U.r * 2.4)), el: opt.proofEl ?? .9, az: opt.proofAz ?? .5, drift: .006 });
        const t2 = c.t0 + Math.round((c.t1 - c.t0) * .55), U2 = unsearchedAt(tape, t2 + Math.round((c.t1 - c.t0) * .1));
        if (opt.proofTop !== false) H(t2, RO.top, { drift: .003 });
        else if (U2) shot(t2, { kind: 'focus', target: [U2.x, U2.y, U2.z], dist: Math.max((opt.proofMinDist ?? 90) * 1.6, Math.min(R * 1.2, U2.r * 2.6)), el: (opt.proofEl ?? .9) + .15, az: (opt.proofAz ?? .5) + 1.1, drift: .006 }); }
      else if (!H(c.t0, RO.top, { drift: .003 })) shot(c.t0, { kind: 'top', dist: R * 2.4, el: 1.32, az: .15, drift: .004 }); }
    else if (c.id === 'home') { if (!H(c.t0, RO.home, { drift: .012 })) shot(c.t0, { kind: 'wide', dist: R * 1.9, el: .5, az: opt.homeAz ?? 1.1, drift: .02 }); if (!H(c.t0 + len * .55, RO.homeClose, { drift: .02 })) shot(c.t0 + len * .55, { kind: 'focus', target: [base.x, base.y + 4, base.z], dist: opt.vanDist ? opt.vanDist * 1.4 : 48, el: .45, az: (opt.homeAz ?? 1.1) - .5, drift: .02 }); }
    else if (c.id.startsWith('search')) {
      const d = story ? story.o.drone : 3;
      const ns = +c.id.slice(6) || 0;
      if (!H(c.t0, ns % 2 ? RO.search2 : RO.search, { drift: .01 })) shot(c.t0, { kind: 'wide', dist: R * 1.75, el: .72, az: .95, drift: .012 });
      if (len > s2t(60) && opt.chase !== false) chaseShot(c.t0 + len * .4, d);
      if (len > s2t(120)) { if (!H(c.t0 + len * .75, RO.top, { drift: .004 })) shot(c.t0 + len * .75, { kind: 'top', dist: R * 2.2, el: 1.2, az: .4, drift: .006 }); }
    }
  }
  // event shots only where they do not fight a chapter's own framing
  const isSearch = (c) => c.id.startsWith('search');
  if (story && inCh(story.m.t, isSearch)) { chaseShot(story.m.t - s2t(8), story.m.drone); H(story.m.t + s2t(30), ['wide_east', 'wide']); }
  if (bat && inCh(bat.t, isSearch)) { chaseShot(bat.t - s2t(3), bat.drone); H(bat.t + s2t(30), ['wide', 'top']); }
  if (pk) { const L = layerOfId(pk.layer); if (!H(pk.t - s2t(2), RO.pocket, { drift: .01 })) shot(pk.t - s2t(2), { kind: 'cutaway', target: pk.pos, dist: 26, el: 1.0, az: .8, level: L ? L.id : 2.8, drift: .01 }); const c2 = out.find((q) => pk.t >= q.t0 && pk.t < q.t1); if (c2 && c2.id.startsWith('proof')) H(pk.t + s2t(45), ['top']); }
  // a false alarm inside a search chapter: look at that very thing (its own camera hint, by kind, or a plain focus)
  for (const r of all('reject')) { const det = E.find((q) => q.type === 'detect' && q.cand === r.cand); if (!det || !inCh(det.t, (c) => c.id.startsWith('search'))) continue;
    const cd = tape.candidates.find((q) => q.id === r.cand); const names = cd && cd.what ? [cd.what, ...(RO.decoyKinds?.[cd.what] || [])] : [];
    if (!H(det.t, names, { drift: .012, zoom: opt.decoyZoom ?? 1, lift: opt.decoyLift ?? 0 })) { if (!RO.decoy.length || !cd) continue; const L = layerOfId(cd.layer), ind = L && !L.outdoor; shot(det.t, { kind: ind ? 'cutaway' : 'focus', target: cd.pos, dist: ind ? (opt.findDistIn ?? 32) : (opt.findDistOut ?? 52) * .8, el: .8, az: .9, level: ind ? L.id : undefined, drift: .012 }); }
    H(r.t + s2t(16), RO.search2, { drift: .01 }); }
  shots.sort((a, b) => a.t - b.t);
  // which drone the PiP follows over time
  const pip = [{ t: 0, drone: 0 }];
  if (story) pip.push({ t: story.o.t - s2t(20), drone: story.o.drone });
  for (const tp of tips) { const det = E.find((q) => q.type === 'detect' && q.cand === tp.cand); if (det && det.drone != null && det.drone >= 0) pip.push({ t: det.t - s2t(4), drone: det.drone }); }
  if (bat) pip.push({ t: bat.t - s2t(10), drone: bat.drone });
  pip.sort((a, b) => a.t - b.t);
  return { chapters: out, captions: caps, beats, shots, pip, story };
}
// the centre and spread of the cells still unsearched at tick t (all layers), or null when nothing is left
function unsearchedAt(tape, t) {
  let n = 0, sx = 0, sy = 0, sz = 0; const pts = [];
  for (const L of tape.layers) for (let c = 0; c < L.nx * L.nz; c++) { if (!L.srch[c] || L.firstSeen[c] <= t) continue; const x = L.x0 + (c % L.nx + .5) * L.cell, z = L.z0 + (((c / L.nx) | 0) + .5) * L.cell; sx += x; sy += L.y; sz += z; n++; if (pts.length < 4000) pts.push(x, z); }
  if (!n) return null; const x = sx / n, z = sz / n; let r = 20; const d = []; for (let q = 0; q < pts.length; q += 2) d.push(Math.hypot(pts[q] - x, pts[q + 1] - z)); d.sort((a, b) => a - b); r = Math.max(r, d[Math.floor(d.length * .85)] || 20);
  return { x, y: sy / n, z, r, n };
}
function layerAt(tape, d, t) { const o = (Math.max(0, Math.min(tape.T - 1, t)) * tape.N + d) * tape.DR; return tape.layers[tape.drones[o + 6]]; }

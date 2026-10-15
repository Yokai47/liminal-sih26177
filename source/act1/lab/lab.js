// LIMINAL: Act 5, the swarm lab (Layer 2 explained, one live simulation per idea; opens on top of the story like Acts 2
// and 3), plus the five-act index at the end of Act 1 and the Contents dialog (both built into the page on import).
// Sims follow the Act 3 contract: mount({ stage, controls, readouts, kit }) -> { start, stop, destroy }.
import kit from './simkit.js';
import { KIT_CSS } from './kitcss.js';

// static imports so the single-file build can bundle them
const SIMS = {
  school: () => import('./sims/school.js'), vicsek: () => import('./sims/vicsek.js'), symmetry: () => import('./sims/symmetry.js'),
  turing: () => import('./sims/turing.js'), stigmergy: () => import('./sims/stigmergy.js'), phase: () => import('./sims/phase.js'),
  crdt: () => import('./sims/crdt.js'), topology: () => import('./sims/topology.js'),
  slowing: () => import('./sims/slowing.js'), pocket: () => import('./sims/pocket.js'), koopman: () => import('./sims/koopman.js'),
  reservoir: () => import('./sims/reservoir.js'), fpga: () => import('./sims/fpga.js'), demo: () => import('./sims/demo.js'),
};
import { createMusic } from './music.js';

export const LAB = [
  { id: 'school', title: 'Three rules, no leader', map: ['A school of fish', 'drones that avoid, match and stay together'],
    body: [
      'A sardine has no idea what shape its school is. It watches the few fish nearest to it and follows three rules: don\'t crowd them, swim the way they swim, don\'t drift away from them. In 1987 Craig Reynolds showed that those three rules are enough to make a school.',
      'That is the design principle behind LIMINAL: <b>design the physics, not the behaviour</b>. Nobody programs the school. You program the rules, and the school is what happens.'],
    tryit: 'Sweep your cursor through the school: it is a predator. Then turn the rules off one at a time. Without separation the fish crush together, without alignment they buzz with no direction, without cohesion they drift apart.',
    inl: 'Every drone runs the same local rules on what its own sensors and its nearest neighbours tell it. Take any drone away and the rest carry on, because none of them was special. Leaders stays at zero.',
    eq: 'steer = separation + alignment + cohesion', eqs: 'Reynolds, 1987. Each fish only ever looks at its neighbours.' },
  { id: 'vicsek', title: 'The edge between order and chaos', map: ['A starling flock', 'a fleet tuned to its tipping point'],
    body: [
      'Strip the school down to one rule: turn toward the average heading of your neighbours, plus a little noise. That is the Vicsek model (1995). With little noise the agents lock into one flock and the order Φ is near 1. With a lot of noise they scatter and Φ falls toward 0.',
      'In between, order doesn\'t fade gradually. It collapses at a critical noise, a real phase transition, like water turning to ice. Right there the susceptibility χ peaks: one agent\'s turn spreads furthest through the rest, and no message is sent. <b>Liminal means "at the threshold".</b> That is where the fleet is tuned to sit, and where the name comes from.'],
    tryit: 'Press Sweep the noise and watch Φ fall off a cliff while χ spikes. Then drag Noise η slowly across the shaded band.',
    inl: 'Near the threshold, a drone that swerves around debris turns its neighbours, and theirs, without a single message. Ordered enough to move as one, loose enough to react.',
    eq: 'θᵢ(t+1) = ⟨θⱼ⟩ + Δθ,   Φ = |Σ vᵢ| / N v₀', eqs: 'Vicsek et al., 1995. Φ is the order parameter: 1 is perfect order, 0 is none.' },
  { id: 'slowing', title: "Listening for the threshold", map: ["Lakes and forests before they tip", "a fleet that can tell how close it is to the edge"],
    body: ["The fleet is meant to sit right at the threshold, but nobody is watching the whole fleet to say where that is. It has to be felt from the inside.", "Push a flock and time how long it takes to settle. Far from the threshold it snaps back almost at once; close to it, recovery gets slower and slower, because the pull back toward order fades just before order collapses. This is <b>critical slowing down</b>, the same early warning ecologists watch for in lakes and forests before they tip.", "It cuts both ways, and LIMINAL is built for both. Slow recovery is the sign that the fleet is near the edge, and it is also why measuring there needs patience: the closer the fleet gets, the longer it must average. And one drone hears only its neighbours, so its reading of the order comes out too high. That bias is predictable, so it can be corrected."],
    tryit: "Leave Auto-kick on and slide Noise η to the right. Recovery time τ climbs and the plot turns sharply upward at the threshold. The faint line on the trace is what one drone sees from its neighbours alone: higher than the truth, but it recovers at the same pace.",
    inl: "Each drone times how quickly its own neighbourhood settles after small disturbances. That is how the fleet can find and hold the threshold without anyone measuring the whole fleet.",
    eq: "τ ∝ |η − η_c|^(−zν)", eqs: "Recovery time grows without limit as the noise approaches its critical value η_c. A kick here turns half the flock by 135°." },
  { id: 'symmetry', title: 'Steering without giving orders', map: ['A magnet', 'a ground robot that biases, never commands'],
    body: [
      'Picture a round table with a napkin between every two guests. Nobody knows if theirs is on the left or the right, until one guest picks one up. Then everyone\'s choice is made. That is symmetry breaking: when every option is equally good, a tiny nudge decides for the whole group.',
      'A leaderless swarm has the same problem. Every drone is identical and every direction is as good as any other, so on its own the flock wanders. LIMINAL\'s ground robots (UGVs) are the guest who picks up the napkin. Each emits a weak field worth a few percent of one turn, and only the drones nearby feel it. Near the threshold, that is enough to turn them all.'],
    tryit: 'Drag the UGV in a new direction and watch the flock follow it. Set UGV pull to 0 % and the flock ignores it; switch the UGV off and the heading drifts again.',
    inl: 'The UGV has an influence channel, never a command channel. If it fails, no drone breaks: the flock simply goes back to choosing for itself.',
    eq: 'θᵢ(t+1) = ⟨θⱼ⟩ + p·θ_UGV + Δθ', eqs: 'The same rule as before, plus one weak extra term p (the UGV pull).' },
  { id: 'turing', title: 'Patterns nobody drew', map: ['Zebra stripes', 'even spacing that nobody assigned'],
    body: [
      'In 1952 Alan Turing asked how a uniform ball of cells ends up with stripes. His answer was two chemicals. An activator makes more of itself; a second chemical, which spreads faster, holds it back. From almost nothing, that tug of war settles into spots or stripes at a fixed spacing, with no blueprint anywhere.',
      'LIMINAL uses the same mathematics as a placement rule. The UGVs act as sources of virtual chemicals and every drone climbs its local gradient, so the drones settle one per spot: evenly spaced, and no position was handed out.'],
    tryit: 'Drag across the pattern to wipe it, and watch it grow back. Move Spacing and the drones spread out to the new distance. Switch between Spots, Worms and Coral.',
    inl: 'Wipe part of the pattern and it heals itself. Spacing is set by how fast the virtual chemicals spread, so one number tunes the whole fleet\'s coverage.',
    eq: '∂u/∂t = Dᵤ∇²u + f(u, v),   ∂v/∂t = Dᵥ∇²v + g(u, v)', eqs: 'Turing, 1952. Shown here with the Gray–Scott model; the limiting chemical spreads faster.' },
  { id: 'phase', title: 'A new mission is a change of phase', map: ['Water freezing', 'switching from search to rescue with no command'],
    body: [
      'When a drone finds someone, the fleet has to switch from spreading out to gathering round. A command would do it, if the radio reached and the commander survived. LIMINAL does it the way water turns to ice: by changing a parameter until the old state stops existing.',
      'Think of the fleet\'s mode as a marble in a landscape with two valleys, search and converge. The survivor signal tilts the landscape. Below a tipping point both valleys exist and the marble stays put. Past it, the search valley vanishes and the marble has nowhere to go but over.'],
    tryit: 'Push Survivor signal to the right until the marble rolls. Now pull it back a little: the swarm stays converged. Switch the signal to Noisy and watch Mode switches stay put.',
    inl: 'No mode is ever sent. The drones nearest the survivor tip first and, near the threshold, their neighbours follow. Hysteresis, the refusal to roll back, stops a flickering thermal reading from making the fleet flip-flop.',
    eq: 'V(x) = x⁴/4 − x²/2 − h·x', eqs: 'The valley disappears at h = ±2/(3√3) ≈ ±0.385: a saddle-node bifurcation.' },
  { id: 'stigmergy', title: 'Notes left in the building', map: ['An ant trail', 'marks on the floor that jamming can\'t touch'],
    body: [
      'Ants don\'t phone each other. They leave chemical marks on the ground, and the next ant reads them. Biologists call this stigmergy: coordination through traces left in the world rather than through messages.',
      'LIMINAL drones mark what they have searched, with UV ink or a dropped RFID tag. A drone arriving later steers toward the least-marked floor it can see. Both floors here have the same drones, speed and layout; only the right side reads the marks.'],
    tryit: 'Watch the two coverage numbers race. Jam the radio: nothing changes, because nothing here uses it. Shorten Marks fade after and the advantage shrinks.',
    inl: 'Marks can\'t be jammed, they outlast a drone whose battery dies, and a rescuer with a UV torch can see which rooms were searched. The catch is capacity: a mark says "searched" and almost nothing else.',
    eq: '', eqs: '' },
  { id: 'crdt', title: 'Maps that agree in any order', map: ['Gossip', 'maps that merge however the messages arrive'],
    body: [
      'Inside rubble the radio is patchy. Messages arrive late, twice, out of order or never. If two drones disagree about which rooms are searched, one gets searched twice, or one never gets searched at all.',
      'So drones never send orders, only what they have measured. Each keeps its own copy of the searched cells, and merging two copies is a plain union. A union doesn\'t care about order or repeats: A ∪ B = B ∪ A, and A ∪ A = A. Structures like this are called CRDTs. Two drones that have heard the same facts hold the same map, however those facts arrived.'],
    tryit: 'Raise Packets lost and keep the delivery Shuffled: the fingerprints still end up identical. Cut the link to drone C, let it fall behind, then restore it and watch its missing count drain to zero.',
    inl: 'About half a kilobyte a second per drone. The mesh carries measurement, never command, so a lost packet costs a little time, never a wrong decision.',
    eq: 'merge(A, B) = A ∪ B', eqs: 'Commutative, associative and idempotent: order, grouping and repeats don\'t matter.' },
  { id: 'topology', title: 'Proving nothing was missed', map: ['Topology', 'counting the gaps nobody has looked into'],
    body: [
      'A checklist of waypoints can tick every box and still leave a pocket behind a pillar that nobody looked into. LIMINAL needs a stopping rule that catches the gaps nobody planned for.',
      'Topology counts shape and ignores size. β₀ counts the separate pieces of what has been sensed; β₁ counts the holes, unsensed regions completely surrounded by sensed ones. Grow the sensor range and holes are born and die. A hole that survives across a wide range is a real gap; one that blinks out at once is noise. That lifetime is called persistence.'],
    tryit: 'Shrink Sensor range until holes appear, then drag a drone into the pocket behind the pillar to close it. The long bar in the barcode is the real gap.',
    inl: 'The search ends when the unexplored space has no pieces left, β₀ = 0, counted on the drones\' own merged map. Next, watch the real building count down.',
    eq: 'persistence = death − birth', eqs: 'de Silva and Ghrist, 2007: coverage checked from which sensors overlap, not from coordinates.' },
  { id: 'pocket', title: "Finding the air pocket", map: ["A bubble in a loaf of bread", "a sealed void in the rubble where someone can breathe"],
    body: ["People survive collapses in voids: the gap under a table, the triangle of space beside a fallen slab. On a map those are holes closed in on every side. In three dimensions, topology counts them with β₂.", "The drones' map is made of small cubes (voxels), so LIMINAL does the topology on cubes too. One union-find pass joins neighbouring unexplored cubes into pieces. A piece that still touches open air is simply unexplored: it counts in β₀. A piece sealed in by rubble on every side is a pocket: it counts in β₂."],
    tryit: "Watch the haze of unknown space shrink as the drones scan. Slide Cut-away to look inside the pile, and press New rubble pile for another collapse. Voids the drones could fly into are labelled as open, not pockets.",
    inl: "A sealed pocket is the first place to dig. Responders get its position and its size, even though no drone could get inside it.",
    eq: "β₂ = pieces of unexplored space sealed on every side", eqs: "Cubical homology on the voxel map: one pass over cubes joined face to face, fast enough to run in flight." },
  { id: 'koopman', title: "The swarm as one machine", map: ["A weather forecast", "predicting where the whole swarm goes next"],
    body: ["Hundreds of drones following nonlinear rules are hard to predict one by one. In 1931 Bernard Koopman found a way round it: don't track the drones, track the right measurements of the whole swarm, and the way those measurements change becomes linear.", "Linear means one matrix. Watch the swarm for a few seconds, fit the matrix K that turns each snapshot into the next (dynamic mode decomposition), and run it forward to see where the swarm is going. The eigenvalues of K are the swarm's own rhythms: on the unit circle they keep going, inside it they fade."],
    tryit: "Switch Observables between Raw and Lifted and compare the dashed forecast with what actually happens. Shorten Learn from to less than one lap of the loop and the forecast falls apart: K has not seen enough.",
    inl: "The fleet forecasts its own next few seconds with one matrix multiply: where coverage is about to open up, and which drone has stopped behaving like the rest.",
    eq: "K g(xₖ) = g(xₖ₊₁)", eqs: "Koopman, 1931. g: the measurements of the swarm. K: one matrix, learned from snapshots." },
  { id: 'reservoir', title: "The swarm as a computer", map: ["Ripples in a bucket of water", "a swarm whose motion remembers what it passed through"],
    body: ["Drop stones into a bucket of water and the ripples hold a fading memory of where and when each one fell. Train a simple straight-line readout on the surface and the bucket can answer questions about its own past. That is reservoir computing: the water does the hard work, and only the readout is trained.", "A swarm is a richer bucket. When a ground robot swerves through it, the turns ripple from drone to drone, and their headings carry a memory of the swerves. There is a sweet spot: too calm and the memory fades at once; too wild and it drowns in its own noise. The best memory sits just on the calm side of the threshold, close to where the fleet reacts best but not on it, so LIMINAL balances the two."],
    tryit: "Move Coupling and watch the memory bars and the capacity curve: low at both ends, best in between. Switch Reservoir between Water and Swarm, then press Train the readout.",
    inl: "The fleet's own motion becomes a sensor that integrates what it has flown through, read by one small trained layer. Only that layer is trained, which is what lets it run on the FPGA.",
    eq: "y(t) = W · x(t)", eqs: "x: the state of the water or the swarm. W: the only weights that are ever trained." },
  { id: 'fpga', title: "A production line, not a chef", map: ["A kitchen", "swarm maths that always finishes on time"],
    body: ["A CPU is one very fast chef: it can cook anything, one step at a time, and sometimes it gets interrupted. A GPU is a thousand chefs all chopping onions. An FPGA is a production line built in the shape of the recipe: ingredients flow through and come out finished. There is no recipe to read, because the recipe is the wiring.", "For the swarm the point is not raw speed. It is that every step takes exactly the same time, every cycle, because for drones flying metres apart a late answer is a safety problem. The FPGA also does different jobs side by side: the order parameter, the topology update, the Koopman multiply and the reservoir readout, each on its own lane."],
    tryit: "Raise Drones in the swarm and turn Background load on: the CPU rows start missing the 2.5 ms deadline while the FPGA rows never move. The grid on the right is a systolic array doing the matrix multiply.",
    inl: "The swarm maths runs on its own FPGA board beside the flight computer, so the collective layer keeps its timing whatever else the drone is busy with.",
    eq: "the same number of clock cycles, every cycle", eqs: "A 400 Hz loop leaves 2.5 ms per cycle. The model's assumptions are written under the timeline." },
  { id: 'demo', title: "How we will prove it", map: ["A driving test", "a test rig the drones cannot cheat in"],
    body: ["The demonstration uses one full Layer 1 drone and a swarm of palm-sized drones indoors. The small ones are too small to carry LiDAR, so ceiling cameras tell each one where it is, the way a motion-capture studio tracks an actor.", "That creates a temptation: the cameras see everything. So the rig has one rule: <b>localisation from outside is legitimate, decisions from outside are not</b>. A sensing emulator hands each drone only what its own sensors could see, the neighbours within its radius and the walls in its line of sight, and each drone runs the swarm rules itself."],
    tryit: "Hover or tap a drone to see exactly what it is told. Switch Rule to Cheating: the swarm suddenly looks perfect, which is the problem, and Commands from outside stops being zero.",
    inl: "Everything the small drones do in the demo comes from the same local rules the full-size drones run, so what works in the rig is what flies in the rubble.",
    eq: "", eqs: "" },
];
export const PARTS = [{"name": "Moving as one", "ids": ["school", "vicsek", "slowing"]}, {"name": "Steering without orders", "ids": ["symmetry", "turing", "phase"]}, {"name": "Sharing what they know", "ids": ["stigmergy", "crdt"]}, {"name": "Knowing when it is done", "ids": ["topology", "pocket"]}, {"name": "The swarm as one machine", "ids": ["koopman", "reservoir", "fpga"]}, {"name": "Proving it", "ids": ["demo"]}];
export const REMEMBER = [["Both obvious approaches fail.", "Programming every drone doesn't scale, and a central controller doesn't survive the building. That bind is why LIMINAL exists.", "lab-intro"], ["Coordination doesn't need a coordinator.", "Three local rules make a school. Design the physics of the interactions and the behaviour follows.", "lab-school"], ["Criticality is communication without communicating.", "At the edge between order and chaos, one drone's reaction reaches the whole fleet with no message sent.", "lab-vicsek"], ["The ground robots steer by being different, not by commanding.", "Breaking the symmetry creates structure; moving the robots reshapes what the swarm does.", "lab-symmetry"], ["Topology finds the gaps nobody expected.", "Betti numbers find holes in coverage whatever caused them, which is exactly where a missing person would be.", "lab-topology"], ["Finished is something you can prove.", "Topological coverage verification is LIMINAL's core contribution: the search ends when the count of unexplored pieces reaches zero, not when the battery runs low.", "lab-pocket"]];


export const ACTS = [
  { n: 1, title: 'Someone is tapping', st: 'here', label: 'You are here', text: 'The hook and the idea: someone trapped under the rubble, why one drone is not enough, and a swarm with no leader that finds them.' },
  { n: 2, title: 'You are the drone', st: 'ok', label: 'Open now', go: 'act2', goLabel: 'Fly the first drone', text: 'Layer 1, running. One drone searches a collapsed floor on its own, or you take the sticks. Four survivors, three decoys, eight hazards. Switch sensors off and see what breaks.' },
  { n: 3, title: 'Inside one drone', st: 'ok', label: 'Open now', go: 'act3', goLabel: 'Open the drone up', text: 'Layer 1, taken apart in 27 steps and 19 simulations: the two computers, the sensors, EKF3, PID, LiDAR, SLAM, OctoMap, frontiers and failsafes.' },
  { n: 4, title: 'The swarm at work', st: 'ok', label: 'Open now', go: 'act4', goLabel: 'Watch the swarm work', text: 'Layer 2, running. Four missions in 3-D (a city block, a flooded village, a forest, a flooded cave), each simulated in full and played back as a film. Lenses, live concept cards and the tethered drone show the whole system working on its own.' },
  { n: 5, title: 'Inside the swarm', st: 'ok', label: 'Open now', go: 'act5', goLabel: 'Open the swarm lab', text: 'Layer 2, taken apart: the swarm lab, 14 live simulations. Boids, criticality, symmetry breaking, Turing patterns, phase changes, stigmergy, CRDT maps, topology and the air pocket, Koopman, reservoir computing, the FPGA, and the demo rig.' },
];

const ICON = {"act4": "<svg class=\"bi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M10 8.5l5 3.5-5 3.5z\"/></svg>", "note": '<svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>', "back": '<svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>', "act2": "<svg class=\"bi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"6\" cy=\"6\" r=\"2.6\"/><circle cx=\"18\" cy=\"6\" r=\"2.6\"/><circle cx=\"6\" cy=\"18\" r=\"2.6\"/><circle cx=\"18\" cy=\"18\" r=\"2.6\"/><path d=\"M8 8l8 8M16 8l-8 8\"/></svg>", "act3": "<svg class=\"bi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 3l9 5-9 5-9-5z\"/><path d=\"M3 12.5l9 5 9-5\"/><path d=\"M3 17l9 5 9-5\"/></svg>", "act5": "<svg class=\"bi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"5\" cy=\"8\" r=\"1.7\"/><circle cx=\"12\" cy=\"4.5\" r=\"1.7\"/><circle cx=\"19\" cy=\"8.5\" r=\"1.7\"/><circle cx=\"7.5\" cy=\"15.5\" r=\"1.7\"/><circle cx=\"16\" cy=\"16\" r=\"1.7\"/><circle cx=\"12\" cy=\"10.5\" r=\"1.7\"/><path d=\"M12 19.5v.01\"/></svg>", "code": "<svg class=\"bi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5\"/></svg>"};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const chev = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const actCard = (a) => `<li class="act${a.st === 'here' ? ' is-here' : ''}${a.go ? ' has-go' : ''}"${a.go ? ` data-open="${a.go}"` : ''}><span class="no">${a.n}</span>
  <h4>${esc(a.title)} <span class="st ${a.st}">${a.label}</span></h4><p>${esc(a.text)}</p>
  ${a.go ? `<button class="go" type="button" data-open="${a.go}">${ICON[a.go] || ''}<span>${a.goLabel}</span></button>` : (a.st === 'here' ? '<span class="here-note">You are reading it</span>' : '')}</li>`;

// ---------------------------------------------------------------- build the DOM (runs on import)
function buildLab(container) {
  const N = LAB.length;
  const intro = document.createElement('section'); intro.className = 'lab-intro'; intro.id = 'lab-intro';
  intro.innerHTML = `<div class="lab-intro-in">
    <h2>How do you run a swarm that has no one in charge?</h2>
    <p>A central controller would be one radio link away from failure, and inside a collapsed building the radio barely reaches the next room. So LIMINAL has no controller. Every drone runs the same few local rules, and the behaviour of the whole fleet comes out of the physics of those rules.</p>
    <p>Nature got there first: fish schools, starling flocks, zebra stripes, ant trails. Each of the next ${N} pages is one idea LIMINAL uses, running live in your browser, in six parts. Play with them; none of it is a video.</p>
    ${PARTS.map((p) => `<h3 class="lab-part">${esc(p.name)}</h3><ol class="lab-map">${p.ids.map((id) => { const i = LAB.findIndex((l) => l.id === id), l = LAB[i]; return `<li><button type="button" data-go="lab-${l.id}"><span class="n">${i + 1}</span><span class="t">${esc(l.title)}</span><span class="d">${esc(l.map[0])} <i>becomes</i> ${esc(l.map[1])}</span></button></li>`; }).join('')}</ol>`).join('')}
    <p style="margin-top:28px"><button class="lab-next" type="button" data-go="lab-${LAB[0].id}">Start with the fish ${chev}</button></p>
  </div>`;
  container.appendChild(intro);
  LAB.forEach((l, i) => {
    const s = document.createElement('section'); s.className = 'lab'; s.id = 'lab-' + l.id; s.dataset.lab = l.id; s.setAttribute('aria-label', `Swarm lab ${i + 1} of ${N}: ${l.title}`);
    const next = LAB[i + 1];
    s.innerHTML = `<div class="lab-grid">
      <div class="lab-head"><div class="lab-ticks"><span>${i + 1} of ${N}</span>${LAB.map((m, j) => `<button type="button" class="${j < i ? 'done' : j === i ? 'cur' : ''}" data-go="lab-${m.id}" aria-label="${j + 1}: ${esc(m.title)}"${j === i ? ' aria-current="step"' : ''}></button>`).join('')}</div>
        <h2 class="lab-h">${esc(l.title)}</h2></div>
      <div class="lab-body">${l.body.map((p) => `<p class="lab-p">${p}</p>`).join('')}
        <div class="lab-try"><b>Try this</b>${esc(l.tryit)}</div>
        <div class="lab-in"><b>In LIMINAL</b>${esc(l.inl)}</div>
        ${l.eq ? `<p class="lab-eq">${esc(l.eq)}<small>${esc(l.eqs)}</small></p>` : ''}
        ${next ? `<button class="lab-next" type="button" data-go="lab-${next.id}">Next: ${esc(next.title)} ${chev}</button>` : `<button class="lab-next" type="button" data-go="lab-remember">Next: six things to remember ${chev}</button>`}</div>
      <div class="lab-bench"><div class="lab-stage"><p class="lab-wait">Loading the simulation</p></div><div class="lab-dock"><div class="lab-controls"></div><div class="lab-readouts"></div></div></div>
    </div>`;
    container.appendChild(s);
  });
  const end = document.createElement('section'); end.className = 'lab-end'; end.id = 'lab-remember';
  end.innerHTML = `<div class="lab-end-in"><h2>If you remember six things</h2>
    <ol class="six">${REMEMBER.map(([t, d, go], i) => `<li><span class="n">${i + 1}</span><h3>${esc(t)}</h3><p>${esc(d)}</p><button type="button" class="six-go" data-go="${go}">See it again</button></li>`).join('')}</ol>
    <div class="acts-end"><button class="btn primary" type="button" data-open="story">${ICON.back}<span>Back to the story</span></button><button class="btn" type="button" data-go="lab-intro">${ICON.act5}<span>Back to the start of the lab</span></button><a class="btn ghost" href="https://github.com/Yokai47/liminal-sih26177" target="_blank" rel="noopener">${ICON.code}<span>Read the code</span></a></div></div>`;
  container.appendChild(end);
}
function buildActs() {
  const people = document.getElementById('c-people'); if (!people) return;
  const s = document.createElement('section'); s.className = 'acts'; s.id = 'acts';
  s.innerHTML = `<div class="acts-in">
    <h2>That was the idea. The rest of the site takes it apart.</h2>
    <p>Five acts. Each layer of LIMINAL gets two: one where you watch it run, one where it is taken apart and explained. Acts 2 to 5 open right here, on top of this page.</p>
    <ol class="actlist">${ACTS.map((a) => actCard(a)).join('')}</ol>
    <div class="acts-end"><button class="btn primary" type="button" data-open="act2">${ICON.act2}<span>Fly the first drone</span></button><button class="btn" type="button" data-open="act3">${ICON.act3}<span>Open the drone up</span></button><button class="btn" type="button" data-open="act4">${ICON.act4}<span>Watch the swarm work</span></button><button class="btn" type="button" data-open="act5">${ICON.act5}<span>Open the swarm lab</span></button><a class="btn ghost" href="https://github.com/Yokai47/liminal-sih26177" target="_blank" rel="noopener">${ICON.code}<span>Read the code</span></a></div>
  </div>`;
  people.after(s);
}
function buildContents() {
  const d = document.createElement('div'); d.className = 'contents'; d.id = 'contents'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'contents-h'); d.hidden = true;
  const story = [['c-hook', 'The tapping', 'the hook'], ['c-stakes', 'Seventy-two hours', 'the stakes'], ['tools', 'What rescuers carry today', 'and where each one stops'], ['c-agent', 'One drone', 'where next?'], ['c-swarm', 'The swarm', 'no leader, no orders']];
  const after = [['c-done', 'Finished', 'β₀ reaches zero'], ['beyond', 'Not just one building', 'six disaster zones, live']];
  const afterZ = [['c-people', 'People', 'thermal and camera agree'], ['acts', 'The five acts', 'where the site goes next']];
  const li = ([id, t, s]) => `<li><a href="#${id}" data-go="${id}">${esc(t)}<small>${esc(s)}</small></a></li>`;
  d.innerHTML = `<div class="contents-in">
    <button class="contents-x" type="button" aria-label="Close contents"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <h2 id="contents-h">Contents</h2>
    <p class="lede">Act 1 is this page: the hook and the idea. Each layer then gets two acts, one where it runs and one where it is taken apart. Acts 2 to 5 open on top of this page.</p>
    <div class="toc-col"><h3>Act 1, this page</h3>
      <ul class="toc">${story.map(li).join('')}
        ${after.map(li).join('')}
        ${ZONES.map(([id, k, h]) => `<li class="sub"><a href="#zone-${id}" data-go="zone-${id}">${esc(h)}<small>${esc(k.split(',')[0])}</small></a></li>`).join('')}
        ${afterZ.map(li).join('')}</ul>
      <h3>Act 5, the swarm lab</h3>
      <ul class="toc"><li><a href="#lab-intro" data-go="lab-intro">How do you run a swarm with no one in charge?<small>${LAB.length} live simulations</small></a></li>
        ${LAB.map((l, i) => `<li class="sub"><a href="#lab-${l.id}" data-go="lab-${l.id}">${i + 1}. ${esc(l.title)}<small>${esc(l.map[0].toLowerCase())}</small></a></li>`).join('')}
        <li class="sub"><a href="#lab-remember" data-go="lab-remember">Six things to remember<small>the summary</small></a></li></ul></div>
    <div class="acts-col"><h3>The five acts</h3><ol class="actlist">${ACTS.map((a) => actCard(a, true)).join('')}</ol></div>
  </div>`;
  document.body.appendChild(d);
}

// ---------------------------------------------------------------- Act 1: what rescuers carry today (after "Seventy-two hours")
const TOOLS = [["dog", "Search dogs", "Find a living person by scent, fast, even through rubble.", "Can't draw a map or say what is left, and need rest between searches."], ["ear", "Listening devices", "Pick up tapping and voices through concrete.", "Need silence on site, and a survivor who can still make a sound."], ["pole", "Cameras on poles", "Look into a void through a drilled hole or a gap.", "Reach only as far as the pole goes: a few metres."], ["heat", "Thermal cameras", "See body heat in the dark.", "See only what is in direct line of sight; rubble blocks heat."], ["drone", "One drone, one pilot", "Quick eyes from above, outdoors.", "Needs GPS and a radio link, and both fail inside. One pilot flies one drone."], ["swarm", "LIMINAL", "Goes inside on its own: many drones, no pilot, no GPS, no leader. Maps everything and proves when nothing is left.", "It finds and maps. People still dig: it tells the dog, the listener and the rescuers where to go."]];
const TOOLICON = {"dog": "<path d=\"M5 14c0-3 2-5 5-5h4l2-3h2l1 3-2 1v4c0 2-1 4-3 4H9\"/><path d=\"M7 14v5M15 18v1M5 14l-2-1\"/>", "ear": "<path d=\"M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-5 2\"/><path d=\"M10 10a2 2 0 0 1 4 0\"/><path d=\"M19 7c1 1.5 1 4.5 0 6M21 5c2 3 2 7 0 10\"/>", "pole": "<path d=\"M3 20L15 8\"/><circle cx=\"17\" cy=\"6\" r=\"2.5\"/><path d=\"M19 4l2-2\"/>", "heat": "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4\"/>", "drone": "<circle cx=\"6\" cy=\"6\" r=\"2.6\"/><circle cx=\"18\" cy=\"6\" r=\"2.6\"/><circle cx=\"6\" cy=\"18\" r=\"2.6\"/><circle cx=\"18\" cy=\"18\" r=\"2.6\"/><path d=\"M8 8l8 8M16 8l-8 8\"/>", "swarm": "<circle cx=\"5\" cy=\"8\" r=\"1.6\"/><circle cx=\"12\" cy=\"4.5\" r=\"1.6\"/><circle cx=\"19\" cy=\"8.5\" r=\"1.6\"/><circle cx=\"7.5\" cy=\"15.5\" r=\"1.6\"/><circle cx=\"16\" cy=\"16\" r=\"1.6\"/><circle cx=\"12\" cy=\"10.5\" r=\"1.6\"/><path d=\"M5 8l7 2.5 7-2M7.5 15.5l4.5-5 4 5.5\"/>"};
const ZONES = [["city", "Turkey and Syria, 6 February 2023", "A city block after an earthquake", "A magnitude 7.8 earthquake struck before dawn. About 38,900 buildings were destroyed and 59,488 people died. Survivors were still being pulled from the rubble eleven days later.", "Many buildings at once. Ground robots park at the worst-hit blocks and the swarm splits itself into one team per building, with nobody assigning them. Inside each building it is the search from the story; between them, an outdoor one."], ["tunnel", "Silkyara, Uttarakhand, 12 November 2023", "A collapsed tunnel", "Part of a highway tunnel under construction caved in and sealed 41 workers inside. Every one of them was brought out alive, after 17 days.", "Radio dies in rock. Drones slip through the gap above the debris and park one by one as a relay chain, so the news gets out, and they map the debris pile from the inside to show where a pipe could go."], ["landslide", "Wayanad, Kerala, 30 July 2024", "A hillside after a debris flow", "In the early hours two landslides and a debris flow swept through Punchirimattom, Mundakkai and Chooralmala. 251 people died and 47 are still missing; more than 200 buildings were washed away.", "The swarm compares what it sees with a map from before the disaster. Houses now under mud show up as outlines, so the search starts where people lived, not where the mud is thickest."], ["flood", "Kerala, August 2018", "A flooded plain", "More than 483 people died and about a million were evacuated. Fishermen from the coast brought 669 of their own boats and rescued more than 65,000 people.", "The area is huge and the people are on roofs. The swarm spreads into a wide front, checks every roof, and steers the boats along water it has already searched, away from fallen power lines."], ["forest", "Any forest, any season", "Under the canopy", "A trekker is missing in thick forest. From above, the trees hide almost everything; under them, GPS weakens and the trunks block the radio.", "A forest is a building with no walls. Some drones fly above the trees with thermal cameras and flag warm spots through the gaps; others fly beneath and go to look. A deer is warm too, so a find counts only when the camera agrees."], ["cave", "Tham Luang, Thailand, June to July 2018", "A flooded cave", "Twelve boys and their football coach were trapped about 2 km inside a flooding cave for 18 days. As many as 10,000 people took part in the rescue, and a former Navy SEAL diver died delivering air tanks.", "No GPS and no radio through rock, and some passages are flooded to the roof. Drones drop small relay beacons as they go, map every dry branch, mark the sumps only divers can pass, and count the unexplored branches down to zero."]];
const ZONE_SIMS = {
  city: () => import('../zones/city.js'), tunnel: () => import('../zones/tunnel.js'), landslide: () => import('../zones/landslide.js'),
  flood: () => import('../zones/flood.js'), forest: () => import('../zones/forest.js'), cave: () => import('../zones/cave.js'),
};
function buildTools() {
  const stakes = document.getElementById('c-stakes'); if (!stakes) return;
  const s = document.createElement('section'); s.className = 'tools cover'; s.id = 'tools';
  s.innerHTML = `<div class="tools-in">
    <h2>What rescuers carry today, and where each one stops</h2>
    <p class="tools-lede">Rescue teams are skilled and brave, and every tool they carry is good at one job. None of them can go alone into a dark, unknown building with no GPS and come back with a map that says what is left to search.</p>
    <div class="ledger" role="table" aria-label="Rescue tools: what each is good at and where it stops">
      <div class="lrow lhead" role="row"><span role="columnheader">Tool</span><span role="columnheader">Good at</span><span role="columnheader">Where it stops</span></div>
      ${TOOLS.map(([k, name, good, stop]) => `<div class="lrow${k === 'swarm' ? ' us' : ''}" role="row"><span class="lname" role="cell"><svg viewBox="0 0 24 24" aria-hidden="true">${TOOLICON[k]}</svg>${esc(name)}</span><span class="lgood" role="cell">${esc(good)}</span><span class="lstop" role="cell">${esc(stop)}</span></div>`).join('')}
    </div>
    <p class="tools-end">LIMINAL works in the gap between them. It doesn't replace the dog or the listener; it tells them where to go.</p>
  </div>`;
  stakes.after(s);
}
// ---------------------------------------------------------------- Act 1: beyond one building (after "Finished", before "People" and its buttons): six live disaster zones
function buildZones() {
  const people = document.getElementById('c-people'); if (!people) return;
  const frag = document.createDocumentFragment();
  const intro = document.createElement('section'); intro.className = 'zones-intro cover'; intro.id = 'beyond';
  intro.innerHTML = `<div class="zones-intro-in">
    <h2>Not just one building</h2>
    <p>A collapsed building is the hardest case: no GPS, no radio, no light. The same swarm, with the same rules, works wherever the map has run out. Outdoors it changes mode: GPS comes back on, the map coarsens from 5 cm cubes to cells of 2 to 5 m, and the thermal camera leads.</p>
    <p>Six kinds of disaster, each from a real event and each running live. Nothing is scripted: every time a scene loops, the drones decide for themselves again.</p>
    <ol class="zone-list">${ZONES.map(([id, k, h]) => `<li><button type="button" data-go="zone-${id}"><span class="k">${esc(k)}</span><span class="t">${esc(h)}</span></button></li>`).join('')}</ol>
  </div>`;
  frag.appendChild(intro);
  for (const [id, k, h, what, how] of ZONES) {
    const z = document.createElement('section'); z.className = 'zone cover'; z.id = 'zone-' + id; z.dataset.zone = id; z.setAttribute('aria-label', h);
    z.innerHTML = `<div class="zone-stage"><p class="zone-wait">Loading the scene</p></div>
      <div class="zone-card"><p class="zone-k">${esc(k)}</p><h3 class="zone-h">${esc(h)}</h3><p class="zone-p">${esc(what)}</p><p class="zone-p"><b>What changes for LIMINAL:</b> ${esc(how)}</p>
      <div class="zone-dock"><div class="zone-controls"></div><div class="zone-readouts"></div></div></div>`;
    frag.appendChild(z);
  }
  const more = document.createElement('section'); more.className = 'zones-more cover'; more.id = 'zones-more';
  more.innerHTML = `<div class="zones-more-in"><h3>And the same physics carries further</h3>
    <ul>${[['Mine collapses', 'like a cave, with gas sensors leading'], ['Avalanche fields', 'heat hardly shows through snow, so phone and transceiver signals lead'], ['Chemical-plant fires and gas leaks', 'drones go where no one should breathe'], ['Collapsed bridges and derailed trains', 'long, narrow wreckage searched end to end'], ['Capsized ships', 'a building turned on its side, half under water'], ['After a cyclone', 'a whole coastline of roofs to check']].map(([a, b]) => `<li><b>${esc(a)}</b><span>${esc(b)}</span></li>`).join('')}</ul>
    <p>What changes from place to place is the sensor that leads and the size of a map cell. The rules don't change.</p></div>`;
  frag.appendChild(more);
  people.before(frag);   // before the chapter with the buttons, so nobody leaves for Act 2 without seeing them
}
buildTools(); buildZones();

export function initZones() {
  const zones = [...document.querySelectorAll('.zone[data-zone]')];
  const live = new Map();
  const safe = (stage) => { const card = stage.parentElement.querySelector('.zone-card'); stage.dataset.left = innerWidth > 760 && card ? String(Math.min(.6, (card.getBoundingClientRect().right + 24) / innerWidth).toFixed(3)) : '0'; };
  async function mount(sec) {
    const id = sec.dataset.zone; if (live.has(id)) return live.get(id);
    const rec = { api: null, running: false, want: false }; live.set(id, rec);
    try {
      const mod = await ZONE_SIMS[id]();
      const stage = sec.querySelector('.zone-stage'); safe(stage);
      stage.querySelector('.zone-wait')?.remove();
      kit.takeLastLoop();
      rec.api = mod.default({ stage, controls: sec.querySelector('.zone-controls'), readouts: sec.querySelector('.zone-readouts'), kit });
      const l = kit.takeLastLoop(); if (l) l.prime(4);
      if (rec.want) { rec.api.start(); rec.running = true; }
    } catch (err) { console.error('zone', id, err); const w = sec.querySelector('.zone-wait'); if (w) w.textContent = 'This scene could not start in this browser.'; }
    return rec;
  }
  function run(id, on) { const rec = live.get(id); if (!rec) return; rec.want = on; if (!rec.api) return; if (on && !rec.running) { rec.api.start(); rec.running = true; } else if (!on && rec.running) { rec.api.stop(); rec.running = false; } }
  const near = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) mount(e.target); }, { rootMargin: '100% 0px 100% 0px' });
  const vis = new Map();
  const onScreen = new IntersectionObserver((es) => {
    for (const e of es) vis.set(e.target.dataset.zone, e.intersectionRatio);
    let best = null, br = .25; for (const [id, r] of vis) if (r > br) { br = r; best = id; }
    for (const z of zones) { const id = z.dataset.zone; if (id === best) mount(z).then(() => run(id, true)); else run(id, false); }
  }, { threshold: [0, .15, .25, .4, .6, .8, 1] });
  zones.forEach((z) => { near.observe(z); onScreen.observe(z); });
  addEventListener('resize', () => { for (const z of zones) safe(z.querySelector('.zone-stage')); });
  let paused = [];
  return {
    pauseAll() { paused = []; for (const [id, r] of live) if (r.running) { r.api.stop(); r.running = false; paused.push(id); } },
    resumeAll() { for (const id of paused) run(id, true); paused = []; },
  };
}

buildActs(); buildContents();
{ const st = document.createElement('style'); st.textContent = KIT_CSS; document.head.appendChild(st); }

// ---------------------------------------------------------------- behaviour (wired by the story once it is ready)
export function initLab({ open = {}, onScrollTo } = {}) {
  const goTo = (id) => {
    closeContents();
    if (/^lab-/.test(id)) { open.act5 && open.act5(id); return; }      // a lab page lives in Act 5
    if (open.story) open.story();                                     // a story chapter: leave any act first
    const el = document.getElementById(id); if (!el) return;
    if (onScrollTo) onScrollTo(el); else el.scrollIntoView({ behavior: 'smooth' });
  };
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); goTo(g.dataset.go); return; }
    const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); const k = o.dataset.open; if (k === 'contents') openContents(); else { closeContents(); open[k] && open[k](); } }
  });

  // ---- contents dialog
  const dlg = document.getElementById('contents'); let lastFocus = null;
  function openContents() { if (!dlg.hidden && dlg.classList.contains('open')) return; lastFocus = document.activeElement; dlg.hidden = false; requestAnimationFrame(() => dlg.classList.add('open')); setTimeout(() => dlg.querySelector('.contents-x').focus(), 60); document.body.classList.add('in-contents'); }
  function closeContents() { if (dlg.hidden) return; dlg.classList.remove('open'); document.body.classList.remove('in-contents'); setTimeout(() => { if (!dlg.classList.contains('open')) dlg.hidden = true; }, 380); if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); }
  dlg.querySelector('.contents-x').addEventListener('click', closeContents);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeContents(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dlg.hidden) { e.stopPropagation(); closeContents(); } }, true);

  return { openContents, closeContents, goTo };
}

// ---------------------------------------------------------------- Act 5: the swarm lab, in its own scrolling layer
export function mountAct5(host, { music: musicOn = false } = {}) {
  host.insertAdjacentHTML('beforeend', `<div class="a5bar"><p class="a5t">Liminal <i>Act 5, inside the swarm</i></p>
    <button class="a5btn a5mus" type="button" aria-pressed="false" title="Music">${ICON.note}<span>Music</span></button>
    <button class="a5btn" type="button" data-open="contents">Contents</button><button class="a5btn a5back" type="button" data-open="story"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Back to the story</button></div>`);
  const body = document.createElement('div'); body.className = 'a5body'; host.appendChild(body);
  buildLab(body);
  // ---- music: generative, soft; it follows the story's sound choice and can be switched here
  const music = createMusic('swarm'), mb = host.querySelector('.a5mus');
  const paintMus = () => { mb.setAttribute('aria-pressed', String(music.on)); mb.classList.toggle('on', music.on); mb.querySelector('span').textContent = music.on ? 'Music on' : 'Music off'; };
  let wantMusic = musicOn;
  mb.addEventListener('click', () => { wantMusic = !music.on; wantMusic ? music.start() : music.stop(); paintMus(); });
  if (wantMusic) music.start(); paintMus();
  // ---- sims: mount when the page comes near, run only the one on screen
  const pages = [...host.querySelectorAll('.lab[data-lab]')];
  const live = new Map();    // id -> { api, loop, running }
  async function mount(sec) {
    const id = sec.dataset.lab; if (live.has(id)) return live.get(id);
    const rec = { api: null, running: false, want: false }; live.set(id, rec);
    try {
      const mod = await SIMS[id]();
      const stage = sec.querySelector('.lab-stage'), controls = sec.querySelector('.lab-controls'), readouts = sec.querySelector('.lab-readouts');
      stage.querySelector('.lab-wait')?.remove();
      kit.takeLastLoop();
      rec.api = mod.default({ stage, controls, readouts, kit });
      const l = kit.takeLastLoop(); if (l) l.prime(4);
      if (rec.want) { rec.api.start(); rec.running = true; }
    } catch (err) { console.error('lab sim', id, err); const w = sec.querySelector('.lab-wait'); if (w) w.textContent = 'This simulation could not start in this browser.'; }
    return rec;
  }
  function run(id, on) {
    const rec = live.get(id); if (!rec) return; rec.want = on;
    if (!rec.api) return;
    if (on && !rec.running) { rec.api.start(); rec.running = true; } else if (!on && rec.running) { rec.api.stop(); rec.running = false; }
  }
  const near = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) mount(e.target); }, { root: host, rootMargin: '120% 0px 120% 0px' });
  const vis = new Map();
  const onScreen = new IntersectionObserver((es) => {
    for (const e of es) vis.set(e.target.dataset.lab, e.intersectionRatio);
    let best = null, br = .18; for (const [id, r] of vis) if (r > br) { br = r; best = id; }
    for (const p of pages) { const id = p.dataset.lab; if (id === best) mount(p).then(() => run(id, true)); else run(id, false); }
  }, { root: host, threshold: [0, .1, .2, .35, .5, .7, .9, 1] });
  pages.forEach((p) => { near.observe(p); onScreen.observe(p); });
  document.addEventListener('visibilitychange', () => { for (const [id, r] of live) if (document.hidden) { if (r.running) { r.api.stop(); r.running = false; r.resume = true; } } else if (r.resume) { r.resume = false; run(id, true); } });

  return {
    goTo(id, smooth = true) { const el = host.querySelector('#' + id); if (el) host.scrollTo({ top: el.offsetTop - (id === 'lab-intro' ? 0 : 8), behavior: smooth ? 'smooth' : 'auto' }); },
    pauseAll() { for (const [, r] of live) if (r.running) { r.api.stop(); r.running = false; r.resume = true; } if (music.on) music.stop(); },
    resumeAll(soundOn) { for (const [id, r] of live) if (r.resume) { r.resume = false; run(id, true); } if (soundOn != null) wantMusic = wantMusic && soundOn; if (wantMusic && !music.on) music.start(); paintMus(); },
  };
}

// Mission: a flooded village (inspired by Kerala, August 2018). Outdoor, GPS on: the drones hold a line that sweeps the
// water, evenly spaced by a Turing field and aligned by Vicsek noise held near the threshold; rescue boats go where the
// swarm has found people, along water the swarm has already searched; the tethered drone rides a boat as the mast.
import { loadWorld } from '../index.js';
import { buildScript } from '../script.js';

function extent(world) {
  // the searchable area (land, roofs, water, hazards) and which way to sweep it (away from the base)
  const L = world.layers.find((l) => l.id === 'ground') || world.layers[0];
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let k = 0; k < L.nz; k++) for (let i = 0; i < L.nx; i++) { const t = L.grid[k * L.nx + i]; if (t === 0 || t === 3 || t === 4) { const x = L.x0 + (i + .5) * L.cell, z = L.z0 + (k + .5) * L.cell; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; } }
  return { L, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
}

export default {
  id: 'flood',
  title: 'A flooded village',
  short: 'Flooded village',
  place: 'Inspired by Kerala, August 2018',
  mode: 'Outdoor, GPS on',
  concepts: ['vicsek', 'turing', 'koopman', 'phase', 'topology'],
  mood: 'Overcast morning',
  look: { exposure: .93, bloomThreshold: 1.4 }, // a bright, flat day: keep the water from blooming into haze
  world: (THREE, ctx) => loadWorld('flood', THREE, ctx),
  config(world, seed) {
    const A = world.anchors || {}, E = extent(world), b = A.base || { x: E.x1, z: E.cz };
    // sweep along the longer axis, starting from the side nearer the base
    const alongX = (E.x1 - E.x0) >= (E.z1 - E.z0) * .8;
    const dir = alongX ? [b.x > E.cx ? -1 : 1, 0] : [0, b.z > E.cz ? -1 : 1];
    const len = alongX ? E.x1 - E.x0 : E.z1 - E.z0, width = (alongX ? E.z1 - E.z0 : E.x1 - E.x0) + 20;
    return {
      seed, dt: .5, drones: 18, maxTicks: 4200,
      speed: { outdoor: 5.2, transit: 8, climb: 3 },
      sensor: { outdoor: 27, camera: 9 },
      radio: { outdoor: 170, indoor: 20, tether: 620, base: 80, loss: .08, perTick: 3000 },
      alt: { outdoor: 34 },
      launch: { at: 16, every: 1.5 },
      tether: { rise: 4, riseDur: 26 },
      front: { dir, center: { x: E.cx, z: E.cz }, s0: -len / 2 + 22, s1: len / 2 - 12, width, depth: 66, speed: 1.75, spacing: Math.max(48, width / 17), fieldCell: 6 },
      turing: { F: .030, k: .062, climb: 240 },
      vicsek: { r: 150, eta0: .9, target: .64, goal: .9, gain: .14 },
      claim: { outdoor: 40, penalty: 60 },
      phase: { confirm: 4, hold: 24, radiusOut: 120, max: 2 },
      boatSpeed: 4.2, groupR: 10,
      battery: { drain: 1 / 3600 },
      events: [
        { type: 'swerve', after: 'front', delay: 40 },
        { type: 'battery', drone: 9, whenCoverage: .34 },
        { type: 'current', boat: 0, after: 'boat_go', delay: 25, strength: 2.6, dur: 26, dir: [0, 1], text: 'a current pushes the boat off course' },
      ],
      koopman: { every: 10, window: 18, horizon: 12 },
    };
  },
  script(tape, world) {
    return buildScript(tape, world, {
      intro: 'Morning over the flood. A drone on a cable rises from its boat: the swarm’s radio mast, a high camera, a floodlight. It commands nothing.',
      launch: 'Eighteen drones lift off from the relief camp.',
      front: 'They spread into one line across the water. Each climbs a chemical-like field and keeps its neighbours at arm’s length: even lanes, nobody placed them.',
      swerve: 'One drone dodges a mast; the turn ripples down the line and dies out. Order held near the threshold bends without breaking.',
      search2: 'Behind the line the water is searched; the edge of the search moves steadily west.',
      detectP: 'Warm shapes on a roof in drone {d}’s thermal camera.',
      find: 'Thermal and camera agree: {count} on the roof. A boat is on its way, along water the swarm has already searched.',
      findMore: 'Another roof: {count}. {total} found so far; the boats take them in turn.',
      handover: 'The drones go back to the line; the gap they left has already closed.',
      current: 'A current pushes a boat off course. The swarm’s map gives it a new way round, clear of the live lines.',
      koopman: 'From its own last few minutes, the swarm forecasts where its search edge will be a minute from now. The ghost is the forecast.',
      frontDone: 'The line has crossed the whole flood. Now the drones mop up the strips between their lanes.',
      proof: 'What is left is counted as separate unsearched patches: {b} now. The search ends only at zero.',
      complete: 'Nothing unsearched is left on the water: β₀ is zero. The drones fly back to the camp.',
      home: 'The boats are out; the camp holds the same map the swarm built.',
      battery: 'Drone {d}’s battery fails. Its neighbours slide over and the lane closes; the field keeps the spacing even.',
      fpga: 'Counting the patches, merging the maps and the forecast run as fixed hardware: the same cycles every tick.',
    }, { proofFocus: true, proofTop: false, proofEl: .95, frontTitle: 'One line, even lanes', front2: { title: 'Forecasting the edge', concept: 'koopman' }, findTitle: 'People on a roof', notes: false, introTitle: 'Morning', target: 180, maxFinds: 2, proofCov: .93, searchTitle: 'Behind the line', search2Concept: 'koopman', findDistOut: 90, radius: 420, chaseOut: 40, roles: { base: ['camp'], mast: ['station'], search: ['wide', 'river'], search2: ['low', 'wide'], wide2: ['river', 'wide'], home: ['wide'], homeClose: ['camp'], top: ['top'] } });
  },
};

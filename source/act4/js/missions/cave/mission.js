// Mission: a flooded cave (inspired by Tham Luang, 2018). Indoor, no GPS, no radio through rock: the drones string a
// chain of relay beacons behind them (stigmergy that also carries the mesh), explore every dry branch by frontier,
// leave the sumps to divers, count the unexplored branches down to zero and find the group on the shelf.
import { loadWorld } from '../index.js';
import { buildScript } from '../script.js';

export default {
  id: 'cave',
  title: 'A flooded cave',
  short: 'Flooded cave',
  place: 'Inspired by Tham Luang, 2018',
  mode: 'Indoor, no GPS, no radio',
  concepts: ['stigmergy', 'crdt', 'topology', 'pocket'],
  mood: 'Darkness, lit by the drones',
  defaultCut: 1,
  overlay: { known: .6, unknown: 1 },
  look: { sun: .46, hemi: .68, exposure: 1.1 },
  // the drone's camera sees the cave closed (roof, walls), lit by its own floodlight down the passage
  // (the inset only shows a drone whose view has real contrast: a lit passage, not a wall of evenly shaded rock)
  pipUncut: true, pipDown: 1.6, pipLamp: 4, pipLampRange: 40, pipLampDecay: 1, pipMinSd: .09,
  world: (THREE, ctx) => loadWorld('cave', THREE, ctx),
  config(world, seed) {
    const A = world.anchors || {};
    const deep = (A.water || [])[1] || (A.water || [])[0];
    return {
      seed, dt: .5, drones: 16, maxTicks: 6000,
      speed: { indoor: 1.9, transit: 4, climb: 1.6 },
      sensor: { indoor: 14, camera: 7 },
      radio: { outdoor: 90, indoor: 34, tether: 60, base: 40, loss: .1, perTick: 2400 },
      launch: { at: 12, every: 2.5 },
      tether: { rise: 3, riseDur: 16 },
      relay: { perDrone: 2, maxBeacons: 28, at: .68, park: true, maxParked: 3 },
      stigmergy: { at: 'junctions', kind: 'rfid', spacing: 14, penalty: 60, radius: 22 },
      claim: { indoor: 18, penalty: 60 },
      phase: { confirm: 5, hold: 50, radiusIn: 40, max: 4 },
      groupR: 14,
      battery: { drain: 1 / 3400 },
      events: [
        { type: 'battery', drone: 5, whenCoverage: .38 },
        ...(deep ? [{ type: 'water', whenCoverage: .55, region: { layer: world.layers[0].id, pos: deep.pos, r: 22 }, rise: 1.2, text: 'the water rises' }] : []),
      ],
      koopman: { every: 10, window: 18, horizon: 12 },
    };
  },
  script(tape, world) {
    return buildScript(tape, world, {
      intro: 'Monsoon rain at the cave mouth. A drone on a cable rises into the entrance: the last place a radio can reach from outside.',
      tether: 'Inside there is no GPS and no radio through rock. Whatever the swarm learns has to come back through the air of the passages.',
      launch: 'Sixteen drones fly in, one by one, lights on.',
      search: 'Each drone takes the nearest unexplored passage no neighbour has claimed. The map grows as a glow along the walls.',
      search2: 'Passages split and split again. Every dry branch gets a drone; every branch that floods to the roof is left for divers.',
      beacon: 'Drone {d} is about to lose the drones behind it, so it drops a relay beacon at a junction. The radio chain grows with the search.',
      stigmergy: 'Each beacon is also a mark on the wall: “someone went this way.” A drone that reads it takes another branch.',
      out: 'Drone {d} turns a corner and the rock cuts its radio. It keeps mapping on its own.',
      merge: 'Back in sight of a beacon, drone {d}’s map flows back up the chain and merges in one step.',
      battery: 'Drone {d}’s battery fails deep in a branch. What it mapped had already gone up the chain.',
      water: 'The water rises in a low passage until it meets the roof. The drones there pull back; the map now says: divers only.',
      detectP: 'Warm shapes ahead of drone {d}, high on a rock shelf above the water.',
      tip: 'The signal tilts the landscape: the nearby drones stop exploring and gather at the shelf.',
      find: 'Thermal and camera agree: {count}, alive, in an air pocket. The way in is on the map.',
      handover: 'The position goes up the beacon chain to the cave mouth. The search goes on until no branch is left.',
      pocket: 'The air pocket is mapped all round: a sealed space above the water, the reason they are alive.',
      proof: 'Unexplored branches left: {b}. The search ends only when that count is zero.',
      complete: 'No branch is left unexplored: β₀ is zero. The drones fly back out along the beacon chain.',
      home: 'At the mouth, the rescuers hold the whole map: the passages, the sumps for divers, the shelf.',
      fpga: 'Counting the branches, merging the maps and the forecast run as fixed hardware: the same cycles every tick.',
    }, { introTitle: 'The cave mouth', searchTitle: 'Into the dark', searchTitle2: 'Branches', searchTitle3: 'Deeper', search2Concept: 'stigmergy', findTitle: 'The shelf', proofTitle: 'Branches to zero', maxFinds: 1, target: 180, notes: false, findDistIn: 70, chaseIn: 210, chaseEl: .62, chaseAz: 3.0, // from the open side of the section, like the 'section' view, closer in
       radius: 380, vanDist: 40, roles: { wide: ['mountain', 'wide'], base: ['entrance'], mast: ['entrance'], search: ['section', 'wide'], search2: ['junction', 'bypass', 'section'], wide2: ['section'], top: ['top'], home: ['section'], homeClose: ['entrance'], find: ['shelf'], pocket: ['shelf'], water: ['sump'] } });
  },
};

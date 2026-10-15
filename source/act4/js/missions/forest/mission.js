// Mission: under the canopy (a missing trekker). Outdoor, two layers: drones above the crowns sweep a wide thermal
// swath and see the ground only through gaps; drones below fly between the trunks with LiDAR and see everything near
// them. They leave UV marks on trunks (stigmergy), a deer and a sun-warmed rock are rejected when thermal and camera
// disagree, a gust knocks the upper layer about and the swarm's order recovers slowly (critical slowing down).
import { loadWorld } from '../index.js';
import { buildScript } from '../script.js';

export default {
  id: 'forest',
  title: 'Under the canopy',
  short: 'Under the canopy',
  place: 'A missing trekker',
  mode: 'Outdoor, two layers',
  concepts: ['stigmergy', 'phase', 'slowing', 'crdt', 'topology'],
  mood: 'Golden late afternoon',
  look: { bloomThreshold: 1.25 },
  // the crowns between the camera and a drone under the canopy are cut away (never a camera inside the leaves)
  cutout: { test: (o) => o.isInstancedMesh && (!!o.userData.sway || /tree|emergent|sapling|conifer|broad/i.test(o.name || '')), radius: 11 },
  world: (THREE, ctx) => loadWorld('forest', THREE, ctx),
  config(world, seed) {
    const A = world.anchors || {};
    const up = world.layers.find((l) => l.density || /canopy|above/i.test(l.id)) || world.layers[0];
    const low = world.layers.find((l) => l !== up) || up;
    const c = A.pois?.centre || A.pois?.center || { x: up.x0 + up.nx * up.cell / 2, y: 0, z: up.z0 + up.nz * up.cell / 2 };
    return {
      seed, dt: .5, drones: 20, maxTicks: 6400,
      speed: { outdoor: 4.2, indoor: 2.1, transit: 6, climb: 2.6 },
      sensor: { outdoor: 22, indoor: 9, camera: 6 },
      radio: { outdoor: 140, indoor: 46, tether: 420, base: 60, loss: .1, perTick: 3000 },
      alt: { outdoor: 14, transit: 52 },
      launch: { at: 14, every: 1.5 },
      tether: { rise: 4, riseDur: 24 },
      transit: { to: { x: c.x, y: 0, z: c.z }, arrive: 60 },
      vicsek: { r: 30, eta0: 2.2, target: .64, goal: .45, gain: .25 },
      prefer: [{ layer: up.id, n: 7 }, { layer: low.id, n: 13 }], prefPenalty: 500,
      gapDensity: 80, gapSpacing: 20, seeThrough: 150,
      claim: { outdoor: 30, indoor: 9, penalty: 50 },
      stigmergy: { at: 'trunks', layers: [low.id], kind: 'uv', spacing: 9, penalty: 60, radius: 13 },
      relay: { perDrone: 0, park: true, maxParked: 2, at: .8 },
      phase: { confirm: 5, hold: 40, radiusOut: 80, radiusIn: 30, max: 4 },
      battery: { drain: 1 / 3200 },
      events: [
        { type: 'swerve', after: 'depart', delay: 6 },
        { type: 'gust', whenCoverage: .4, strength: 7, dur: 16, dir: [1, .3], layers: [up.id], text: 'a gust' },
        { type: 'battery', drone: 12, whenCoverage: .55 },
      ],
      koopman: { every: 10, window: 18, horizon: 12 },
    };
  },
  script(tape, world) {
    return buildScript(tape, world, {
      intro: 'Late afternoon at the trailhead. A drone on a cable rises above the trees: the swarm’s radio mast, a high camera, a floodlight for the dusk.',
      launch: 'Twenty drones lift off. A forest is a building with no walls.',
      transit: 'They cross the ridge as one flock, high above the crowns.',
      search: 'Seven stay above the canopy with wide thermal cameras; thirteen drop through the gaps and fly between the trunks.',
      search2: 'Below, each drone that passes a trunk paints a small UV mark on it. Later drones read the marks and take another way.',
      stigmergy: 'A UV mark on a trunk: “someone searched here.” Nothing to send, nothing to jam, and the rescuers can read it too.',
      detectP: 'A warm shape on drone {d}’s thermal camera.',
      detectD: 'Something warm through a gap in the crowns, on drone {d}’s thermal camera.',
      reject: '{label}: warm, but the camera disagrees. The signal never reached the tipping point; the swarm did not move.',
      gust: 'A gust shoves the drones above the canopy off their lines. The ones below, between the trunks, barely feel it.',
      reservoir: 'Nothing measured the wind: the swarm’s own motion carries the signal, and a simple readout spikes.',
      slowing: 'Order comes back slowly. That slowness is how the swarm can tell it sits near its threshold.',
      tip: 'The signal tilts the landscape until the search valley vanishes. The drones nearby, above and below, converge.',
      find: 'Thermal and camera agree: the trekker, alive, by the stream. The position goes down the cable to the trailhead.',
      handover: 'Handed over. The drones go back to the search: the forest must still be cleared to be sure.',
      out: 'Drone {d} is deep under the crowns and out of radio range. It keeps mapping on its own.',
      merge: 'Back in range, drone {d}’s map merges with the others in one step.',
      battery: 'Drone {d}’s battery fails under the canopy. Its neighbours already hold everything it mapped.',
      proof: 'Unsearched patches left, above and below: {b}. The search ends only at zero.',
      complete: 'Nothing unsearched is left, above or below the canopy: β₀ is zero. The drones fly back to the trailhead.',
      home: 'Dusk. The rescuers hold one map of both layers, with the trekker on it, and the UV marks on the trunks agree.',
      fpga: 'Counting the patches, merging the maps and the forecast run as fixed hardware: the same cycles every tick.',
    }, { introTitle: 'The trailhead', transitTitle: 'Over the ridge', searchTitle: 'Two layers', searchTitle2: 'Marks on the trunks', search2Concept: 'stigmergy', findTitle: 'The trekker', maxFinds: 1, target: 180, notes: false, findDistOut: 46, radius: 320, chaseOut: 30, chaseIn: 36, chaseEl: 1.2, chase: false, findDistIn: 95, decoyZoom: 2.3, decoyLift: .3, // from above the crowns, through the cut-out
       proofFocus: true, proofTop: false, proofEl: 1.05, proofMinDist: 110, roles: { base: ['trailhead'], mast: ['canopy'], search: ['canopy', 'wide'], search2: ['ridge', 'canopy'], wide2: ['canopy', 'wide'], home: ['wide'], homeClose: ['trailhead'], find: ['trekker'], decoy: ['deer', 'rock'], top: ['top'] } });
  },
};

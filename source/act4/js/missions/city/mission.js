// Mission: a city block after an earthquake (inspired by Turkey and Syria, February 2023).
import { loadWorld } from '../index.js';
import { buildScript, centreOf, v } from '../script.js';

export default {
  pipUncut: true, // the drone's-eye inset sees the building whole, not the director's cut
  // blue hour, but less violet: cooler fill and fog, less saturation, a magenta cast pulled back (clay and teal read true)
  look: { sat: .92, demag: .6, tint: { mix: .45, hemiSky: '#A7B4D4', hemiGround: '#3E4462', fog: '#7D88B0', horizon: '#8C95BA', top: '#212B52', sun: '#FFD3BC' } },
  id: 'city',
  title: 'A city block after an earthquake',
  short: 'City block',
  place: 'Inspired by Turkey and Syria, February 2023',
  mode: 'Indoor and outdoor',
  modeLine: 'Indoor mode inside the rubble (LiDAR, no GPS) · outdoor mode between buildings (thermal)',
  concepts: ['symmetry', 'crdt', 'phase', 'topology', 'pocket', 'vicsek'],
  mood: 'Blue hour',
  world: (THREE, ctx) => loadWorld('city', THREE, ctx),
  config(world, seed) {
    const A = world.anchors || {};
    const to = A.pois?.centre || centreOf(world);
    return {
      seed, dt: .5, drones: 24, maxTicks: 6400,
      speed: { outdoor: 1.9, indoor: .42, transit: 4.6, climb: 2.4 },
      sensor: { outdoor: 6.5, indoor: 4.2, camera: 4 },
      radio: { outdoor: 75, indoor: 16, tether: 190, base: 30, loss: .1, perTick: 1600 },
      alt: { outdoor: 9, transit: 30 },
      launch: { at: 34, every: 2 },
      tether: { rise: 6, riseDur: 24 },
      transit: { to: v(to), arrive: 18 },
      vicsek: { r: 18, eta0: 2.4, target: .64, goal: .4, gain: .25 },
      ugv: { parkAt: 72, speed: 2.2, radius: 30, pull: .8, fill: .85 },
      claim: { outdoor: 16, indoor: 4, penalty: 42 },
      phase: { confirm: 6, hold: 45, radiusOut: 55, radiusIn: 20, max: 5 },
      stigmergy: { at: 'portals', kind: 'uv', spacing: 6, penalty: 26 },
      battery: { drain: 1 / 3000 },
      events: [
        { type: 'swerve', after: 'depart', delay: 7 },
        { type: 'battery', drone: 6, whenCoverage: .42 },
        { type: 'aftershock', whenCoverage: .66, hold: 46, holdOut: 14, mag: 5.6 },
      ],
      koopman: { every: 10, window: 18, horizon: 12 },
    };
  },
  script(tape, world) {
    return buildScript(tape, world, {
      intro: 'The responders’ van parks at the cordon. A drone on a cable rises above it: the swarm’s radio mast. It sends no commands.',
      transit: 'Twenty-four drones lift off and cross the block as one flock. Each copies its neighbours’ heading, with just enough noise to stay responsive.',
      split: '{N} ground robots park at the worst-hit blocks. The swarm splits into {n} teams; nobody assigned them.',
      search: 'Inside the rubble each drone crawls void to void with its LiDAR. Every map it makes is shared with whoever is in range.',
      complete: 'Nothing unsearched is left anywhere in the block: β₀ of the unknown is zero. The drones come home.',
      place: 'block',
    });
  },
};

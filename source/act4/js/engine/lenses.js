// Lenses: which overlays and objects are shown. Each lens has a weight that eases toward 0 or 1, so switching never
// pops. Active story beats force their own overlay on softly (B), even in the World lens.
export const LENSES = [
  { id: 'world', name: 'World', tip: 'The scene as it is, with light overlays for whatever is happening now' },
  { id: 'map', name: 'Swarm’s map', tip: 'What the swarm knows: unknown dark, searched tinted, frontiers bright' },
  { id: 'mesh', name: 'Mesh', tip: 'Radio links, packets in flight, the tethered drone’s reach' },
  { id: 'physics', name: 'Physics', tip: 'Alignment, the Turing field, the ground robots’ halos' },
  { id: 'uv', name: 'UV marks', tip: 'Marks the drones left on the world (stigmergy)' },
  { id: 'proof', name: 'Proof', tip: 'Every unsearched pocket counted, sealed voids outlined' },
];
export const CONCEPTS = ['vicsek', 'slowing', 'symmetry', 'turing', 'phase', 'stigmergy', 'crdt', 'topology', 'pocket', 'koopman', 'reservoir', 'fpga'];
export function createLenses() {
  let cur = 'world';
  const W = { world: 1, map: 0, mesh: 0, physics: 0, uv: 0, proof: 0 };
  const B = {}; for (const c of CONCEPTS) B[c] = 0;
  const bT = {};
  return {
    W, B,
    get current() { return cur; },
    set(id) { if (LENSES.some((l) => l.id === id)) cur = id; },
    beats(active) { for (const c of CONCEPTS) bT[c] = 0; for (const b of active) bT[b.concept] = Math.max(bT[b.concept] || 0, b.w ?? 1); },
    update(dt) {
      const k = 1 - Math.exp(-dt * 5);
      for (const l of LENSES) { const goal = l.id === cur ? 1 : 0; W[l.id] += (goal - W[l.id]) * k; if (Math.abs(W[l.id] - goal) < .002) W[l.id] = goal; }
      // the world lens's soft reveal stays on underneath the others, except where a lens repaints the floor
      W.world = Math.max(W.world, (1 - W.map) * (1 - W.proof) * .85);
      const kb = 1 - Math.exp(-dt * 2.5);
      for (const c of CONCEPTS) { B[c] += ((bT[c] || 0) - B[c]) * kb; if (B[c] < .002) B[c] = 0; }
    },
  };
}

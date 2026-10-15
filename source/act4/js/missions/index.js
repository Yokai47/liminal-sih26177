// Static loaders for the four missions (esbuild needs literal import() strings).
export const MISSIONS = {
  city: () => import('./city/mission.js'),
  flood: () => import('./flood/mission.js'),
  forest: () => import('./forest/mission.js'),
  cave: () => import('./cave/mission.js'),
};
export const ORDER = ['city', 'flood', 'forest', 'cave'];
// the real world.js of each mission (written separately) with a placeholder fallback, both static
export const WORLDS = {
  city: { real: () => import('./city/world.js'), place: () => import('./city/placeholder.js') },
  flood: { real: () => import('./flood/world.js'), place: () => import('./flood/placeholder.js') },
  forest: { real: () => import('./forest/world.js'), place: () => import('./forest/placeholder.js') },
  cave: { real: () => import('./cave/world.js'), place: () => import('./cave/placeholder.js') },
};
// buildWorld for a mission: the real one if it loads and passes a sanity check, else the placeholder
export async function loadWorld(id, THREE, ctx = {}) {
  const W = WORLDS[id];
  if (!ctx.placeholder) {
    try {
      const mod = await W.real();
      const w = await mod.buildWorld(THREE, ctx);
      const problems = checkWorld(w);
      if (!problems.length) { w.__source = 'world.js'; return w; }
      console.warn(`[act4] ${id}/world.js does not match the contract, using the placeholder:`, problems.join('; '));
      try { w.dispose && w.dispose(); } catch (e) { /* ignore */ }
    } catch (e) { if (!/Failed to fetch|Cannot find|404|error loading dynamically/i.test(String(e && e.message))) console.warn(`[act4] ${id}/world.js failed, using the placeholder:`, e); }
  }
  const p = await W.place();
  const w = await p.buildWorld(THREE, ctx); w.__source = 'placeholder'; return w;
}
export function checkWorld(w) {
  const out = [];
  if (!w || !w.group || !w.group.isObject3D) out.push('no group');
  if (!w || !Array.isArray(w.layers) || !w.layers.length) out.push('no layers');
  else for (const L of w.layers) {
    if (!L.id) out.push('layer without id');
    if (!(L.nx > 0 && L.nz > 0 && L.cell > 0)) out.push(`layer ${L.id}: bad size`);
    if (!L.grid || L.grid.length !== L.nx * L.nz) out.push(`layer ${L.id}: grid length ${L.grid && L.grid.length} != ${L.nx * L.nz}`);
    if (!(Number.isFinite(L.x0) && Number.isFinite(L.z0))) out.push(`layer ${L.id}: no x0/z0`);
  }
  if (!w || !w.anchors || !w.anchors.base) out.push('no anchors.base');
  return out;
}

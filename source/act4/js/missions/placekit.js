// Helpers for the placeholder worlds (used only until, or if, a mission's real world.js is missing or broken).
// Clay maquette materials, value noise, instancing, layer grids. No DOM needed (works in node for tests).
export function makeKit(THREE, seed = 1) {
  let s = (seed * 2654435761) >>> 0 || 1;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const rf = (a, b) => a + r() * (b - a);
  const hash = (x, y, sd) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(sd | 0, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const vnoise = (x, y, sd = 0) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, sd), b = hash(xi + 1, yi, sd), c = hash(xi, yi + 1, sd), d = hash(xi + 1, yi + 1, sd); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  const fbm = (x, y, sd = 0, o = 4) => { let a = 0, amp = .5, f = 1, n = 0; for (let i = 0; i < o; i++) { a += amp * vnoise(x * f, y * f, sd + i * 31); n += amp; f *= 2.03; amp *= .5; } return a / n; };
  const mats = new Map();
  const mat = (color, o = {}) => { const k = color + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: o.rough ?? .92, metalness: 0, flatShading: !!o.flat, emissive: o.emissive ? new THREE.Color(o.emissive) : undefined, emissiveIntensity: o.ei ?? 1, transparent: !!o.transparent, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide, vertexColors: !!o.vc })); return mats.get(k); };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  // instances: [{ x, y, z, sx, sy, sz, rx, ry, rz, c }]
  const instanced = (geo, material, list, { shadow = true, receive = true, colors = null } = {}) => {
    const im = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
    list.forEach((o, i) => { e.set(o.rx || 0, o.ry || 0, o.rz || 0); q.setFromEuler(e); p.set(o.x, o.y, o.z); sc.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1); m4.compose(p, q, sc); im.setMatrixAt(i, m4); if (o.c != null) im.setColorAt(i, new THREE.Color(o.c)); });
    im.count = list.length; im.castShadow = shadow; im.receiveShadow = receive; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere(); return im;
  };
  const layer = (id, x0, z0, nx, nz, cell, y, fill = 0, extra = {}) => ({ id, x0, z0, nx, nz, cell, y, grid: new Uint8Array(nx * nz).fill(fill), ...extra });
  const setRect = (L, xa, za, xb, zb, v, only = null) => {
    const i0 = Math.max(0, Math.floor((Math.min(xa, xb) - L.x0) / L.cell)), i1 = Math.min(L.nx - 1, Math.floor((Math.max(xa, xb) - L.x0) / L.cell - 1e-6));
    const k0 = Math.max(0, Math.floor((Math.min(za, zb) - L.z0) / L.cell)), k1 = Math.min(L.nz - 1, Math.floor((Math.max(za, zb) - L.z0) / L.cell - 1e-6));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) { const c = k * L.nx + i; if (only == null || only.includes(L.grid[c])) L.grid[c] = v; }
  };
  const setDisc = (L, x, z, rad, v, only = null) => {
    for (let k = 0; k < L.nz; k++) for (let i = 0; i < L.nx; i++) { const wx = L.x0 + (i + .5) * L.cell, wz = L.z0 + (k + .5) * L.cell; if ((wx - x) ** 2 + (wz - z) ** 2 <= rad * rad) { const c = k * L.nx + i; if (only == null || only.includes(L.grid[c])) L.grid[c] = v; } }
  };
  const cellC = (L, c) => ({ x: L.x0 + ((c % L.nx) + .5) * L.cell, z: L.z0 + (((c / L.nx) | 0) + .5) * L.cell });
  const plane = (w, d, color, y = 0, x = 0, z = 0, o = {}) => { const g = new THREE.PlaneGeometry(w, d, o.seg || 1, o.seg || 1); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, o.material || mat(color, o)); m.position.set(x, y, z); m.receiveShadow = true; return m; };
  const box = (w, h, d, color, x, y, z, o = {}) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), o.material || mat(color, o)); m.position.set(x, y, z); m.castShadow = o.cast ?? true; m.receiveShadow = true; if (o.ry) m.rotation.y = o.ry; return m; };
  return { r, rf, hash, vnoise, fbm, mat, instanced, layer, setRect, setDisc, cellC, plane, box, V: (x, y, z) => new THREE.Vector3(x, y, z) };
}
// a soft blob radial texture is drawn in the engine; placeholders never touch the DOM
export const PAL = {
  ink: '#1E2140', night: '#2B2F5E', dusk: '#4A4B86', haze: '#8F8CC4', rose: '#EFB1B4', apricot: '#F6D2B1', mist: '#DCE4EE', paper: '#F3EEF2', teal: '#7FD4CF', heat: '#FFC36B', danger: '#F08A7E',
  clay: '#CFC6D6', clay2: '#B9AFC6', clay3: '#A49BB6', asphalt: '#5B5878', walk: '#8A85A3', rubble: '#9C93AE', rubble2: '#B5A9B8', sage: '#9DB8A0', moss: '#6F8F7A', silt: '#C9A98E', water: '#5E7FB0', water2: '#8FB7D0', slate: '#6E6A8E',
};

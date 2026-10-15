// LIMINAL · Act 4 · mission "flood": "A flooded village" (inspired by Kerala, August 2018), an overcast morning.
// buildWorld(THREE, { seed, quality, props }) -> world, per ACT4_SPEC.md 5.2. Metres, y up, the flood surface is y = 0.
//
// About 1 km of drowned farmland and village under an animated water surface. The water is ONE MeshStandardMaterial
// patched in onBeforeCompile (kept in material.userData.worldPatch so an overlay patch can chain it): depth tint from a
// height texture, submerged roads / streets / paddy bunds / compound walls from a ghost texture, soft ripples, current
// streaks over the drowned river, foam rings and wakes around everything that pokes out, sky fresnel, cloud shade.
// Above it: tiled hip, gable and flat roofs (some with people), palms and mango trees, a church on a knoll and a
// two-storey school holding crowds, a telecom mast and a water tower, a submerged bridge whose railings break the
// surface, power lines along two roads with three spans down in the water (live: hazard cells), drifting debris, a
// relief camp on a dry mound joined to the eastern hills by a causeway, and the tethered drone's station boat.
// Searchable layer 'ground' (5 m cells): 0 dry land / roof, 1 mast / tower / spire, 2 outside the search area,
// 3 water, 4 live line in the water.
export function buildWorld(THREE, { seed = 1, quality = 'high', props = null } = {}) {
  const T0 = performance.now(), HI = quality !== 'low', TAU = Math.PI * 2, MARK = [], mark = (n) => MARK.push(n + ' ' + Math.round(performance.now() - T0));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x), lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const r = rng(seed * 7919 + 101), rr = (a, b) => a + (b - a) * r(), pick = (a) => a[Math.floor(r() * a.length)];
  const S1 = (seed * 31 + 7) & 1023, S2 = (seed * 57 + 11) & 1023, S3 = (seed * 91 + 13) & 1023, S4 = (seed * 17 + 19) & 1023;
  const lin = (hex) => new THREE.Color(hex);                    // sRGB hex -> linear working colour

  // ================================================================ layout (all analytic, so shaders can share it)
  const RZ0 = rr(-75, -35), A1 = rr(55, 72), F1 = 1 / rr(240, 290), P1 = r() * TAU, A2 = rr(16, 26), F2 = 1 / rr(95, 120), P2 = r() * TAU, TILT = rr(-.06, .06);
  const riverZ = (x) => RZ0 + A1 * Math.sin(x * F1 + P1) + A2 * Math.sin(x * F2 + P2) + TILT * x;
  const riverS = (x) => A1 * F1 * Math.cos(x * F1 + P1) + A2 * F2 * Math.cos(x * F2 + P2) + TILT;
  const rdist = (x, z) => { const s = riverS(x); return (z - riverZ(x)) / Math.sqrt(1 + s * s); };
  const shoreX = (z) => 418 + 50 * (fbm(z / 230, 4.2, S3, 2) - .5) * 2 + 34 * (vn(z / 64, 9.1, S4 + 3) - .5) * 2;   // foot of the eastern hills
  const cside = r() < .5 ? -1 : 1, rside = -cside;                               // camp bank, town bank
  const camp = { x: rr(250, 275) }; camp.z = riverZ(camp.x) + cside * rr(185, 210);
  const town = { x: rr(-205, -135) }; town.z = riverZ(town.x) + rside * rr(170, 195); town.a = rr(-.25, .25);
  const tc = Math.cos(town.a), ts = Math.sin(town.a);
  const church = { x: town.x + tc * 40 - ts * rside * 34, z: town.z + ts * 40 + tc * rside * 34, a: -town.a };
  // the causeway: from the camp mound east to the hills (a raised road, just dry)
  const cw0 = { x: camp.x + 46, z: camp.z + rr(-10, 10) }, cw1 = { x: shoreX(camp.z) + 40, z: camp.z + rr(-40, 40) };
  const islets = [];
  const segD = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1); return Math.hypot(ax + dx * t - x, az + dz * t - z); };
  function ground(x, z) {
    let g = -1.75 + (fbm(x / 420, z / 420, S1, 3) - .5) * 2.5 + (fbm(x / 95, z / 95, S2, 2) - .5) * .7;
    const n = rdist(x, z), an = Math.abs(n);
    if (an < 90) {
      const cw = 14.5 * (.72 + .56 * vn(x / 170, 2.7, S4 + 1));
      g -= 4.4 * Math.exp(-(n * n) / (2 * cw * cw));                            // the drowned channel
      g += .8 * Math.exp(-((an - 31) ** 2) / 90);                                // natural levees
    }
    const sx = x > 270 ? shoreX(z) : 1e9;
    if (x > sx - 100) g += smooth(sx - 90, sx + 210, x) * (22 + 16 * fbm(x / 150, z / 150, S3, 3)) + smooth(sx + 250, sx + 900, x) * 42 * fbm(x / 400 + 2, z / 400, S1 + 3, 3);
    const dc = Math.hypot(x - camp.x, z - camp.z);
    if (dc < 100) { const de = dc + 22 * (vn(x / 34, z / 34, S2 + 5) - .5) * 2; g = lerp(g, 3.1 + (vn(x / 26, z / 26, S2 + 3) - .5) * .5, 1 - smooth(36, 78, de)); }
    const dw = segD(x, z, cw0.x, cw0.z, cw1.x, cw1.z); if (dw < 22) g = Math.max(g, .7 - 3.4 * smooth(7, 20, dw));
    const dk = Math.hypot(x - church.x, z - church.z); if (dk < 62) g = Math.max(g, .4 - 2.8 * smooth(19, 48, dk + 9 * (vn(x / 16, z / 16, S1 + 7) - .5) * 2));
    for (const s of islets) { const d = Math.hypot(x - s.x, z - s.z); if (d < s.r * 2.8) g = Math.max(g, s.h - (s.h + 2.6) * smooth(s.r * .6, s.r * 2.3, d + s.r * .45 * (vn(x / 11, z / 11, S3 + 9) - .5) * 2)); }
    return g;
  }
  // a couple of small dry islets with trees (a temple grove, a raised homestead plot), clear of everything else
  for (let t = 0; t < 200 && islets.length < 3; t++) {
    const x = rr(-430, 260), z = rr(-430, 430);
    if (Math.abs(rdist(x, z)) < 90 || Math.hypot(x - camp.x, z - camp.z) < 200 || Math.hypot(x - town.x, z - town.z) < 220 || islets.some((s) => Math.hypot(s.x - x, s.z - z) < 260)) continue;
    islets.push({ x, z, r: rr(15, 22), h: rr(.6, 1.2) });
  }
  // the search polygon: a jittered octagon about 1 km across, kept off the eastern hills
  const poly = [[-470, -460], [0, -480], [400, -470], [440, 0], [410, 470], [0, 485], [-460, 465], [-485, 0]].map(([x, z]) => [clamp(x + rr(-35, 35), -490, 490), clamp(z + rr(-30, 30), -490, 490)]).map(([x, z]) => [Math.min(x, shoreX(z) - 75), z]);
  const inPoly = (x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const flow = (x, z, out) => {                                                  // current, m/s (east to west)
    const sl = riverS(x), nn = Math.sqrt(1 + sl * sl), n = rdist(x, z), sp = 2.6 * Math.exp(-(n * n) / 2300) + .15;
    out[0] = -sp / nn; out[1] = -sp * sl / nn; return out;
  };

  // ================================================================ height grid (4 m) -> depth texture, grid classes
  const HB = 600, HSP = 8, HN = Math.round(2 * HB / HSP) + 1, H = new Float32Array(HN * HN);
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) H[j * HN + i] = ground(-HB + i * HSP, -HB + j * HSP);
  const Hat = (x, z) => {                                                        // bilinear in the 4 m grid
    let fx = clamp((x + HB) / HSP, 0, HN - 1.001), fz = clamp((z + HB) / HSP, 0, HN - 1.001); const i = fx | 0, j = fz | 0; fx -= i; fz -= j;
    const a = H[j * HN + i], b = H[j * HN + i + 1], c = H[(j + 1) * HN + i], d = H[(j + 1) * HN + i + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
  const gAt = (x, z) => (Math.abs(x) < HB - 1 && Math.abs(z) < HB - 1 ? Hat(x, z) : ground(x, z));

  mark('H');
  // ================================================================ roads and a road mask (houses and palms keep off)
  const roads = [];
  { const p = []; for (let x = -820; x <= 820; x += 14) p.push([x, riverZ(x) + rside * (108 + 16 * Math.sin(x / 210 + P2))]); roads.push({ p, w: 7, kind: 'bank' }); }
  { const p = []; for (let t = -820; t <= 820; t += 14) p.push([town.x + ts * t + 12 * Math.sin(t / 260), town.z + tc * t]); roads.push({ p, w: 7, kind: 'cross' }); }
  { const p = [], zc = (x) => riverZ(x) + cside * (150 + 26 * Math.sin(x / 300 + P1)), off = camp.z - zc(camp.x - 60);
    for (let x = -820; x <= camp.x - 30; x += 14) p.push([x, zc(x) + off * smooth(camp.x - 330, camp.x - 60, x)]); p.push([camp.x - 16, camp.z]); roads.push({ p, w: 6, kind: 'camp' }); }
  const streets = [];
  for (let k = -2; k <= 2; k++) {
    const a = [], b = [];
    for (let t = -150; t <= 150; t += 10) { a.push([town.x + tc * t - ts * k * 50, town.z + ts * t + tc * k * 50]); b.push([town.x + tc * k * 56 - ts * t, town.z + ts * k * 56 + tc * t]); }
    streets.push({ p: a, w: 5 }, { p: b, w: 5 });
  }
  const RM = 4, RMN = 300, rmask = new Uint8Array(RMN * RMN);                     // 4 m road mask over ±600
  const stampLine = (p, w) => { for (let q = 1; q < p.length; q++) { const [x0, z0] = p[q - 1], [x1, z1] = p[q], L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 2); for (let s = 0; s <= n; s++) { const x = lerp(x0, x1, s / n), z = lerp(z0, z1, s / n), R = w / 2 + 2; for (let dz = -R; dz <= R; dz += 2) for (let dx = -R; dx <= R; dx += 2) { if (dx * dx + dz * dz > R * R) continue; const i = Math.floor((x + dx + 600) / RM), j = Math.floor((z + dz + 600) / RM); if (i >= 0 && j >= 0 && i < RMN && j < RMN) rmask[j * RMN + i] = 1; } } } };
  for (const rd of roads) stampLine(rd.p, rd.w); for (const st of streets) stampLine(st.p, st.w);
  const onRoad = (x, z) => { const i = Math.floor((x + 600) / RM), j = Math.floor((z + 600) / RM); return i >= 0 && j >= 0 && i < RMN && j < RMN && rmask[j * RMN + i] === 1; };

  mark('roads');
  // ================================================================ houses
  const houses = [], hgrid = new Map(), hkey = (i, j) => (i + 512) * 4096 + j + 512;
  const spaced = (x, z, rad) => { const gi = Math.floor(x / 40), gj = Math.floor(z / 40); for (let j = gj - 1; j <= gj + 1; j++) for (let i = gi - 1; i <= gi + 1; i++) { const L = hgrid.get(hkey(i, j)); if (L) for (const h of L) { const d = rad + h.rad; if ((h.x - x) ** 2 + (h.z - z) ** 2 < d * d) return false; } } return true; };
  const WALL = ['#E2DCD4', '#D5DDD2', '#DCD3E0', '#E7D6CC', '#D3DAE1', '#E9E3E7', '#D9D3C4'];
  const ROOF_T = ['#B9837C', '#C4928A', '#AE7C78', '#CF9F8F'], ROOF_S = ['#A6A1BE', '#9FB0AC', '#B3AEC6'], ROOF_C = ['#C9CCD4', '#D6D2DA', '#C2C6CF'];
  function addHouse(x, z, a, o = {}) {
    const l = o.l || rr(9.5, 14), w = o.w || rr(7.5, 10.5), rad = Math.hypot(l, w) / 2;
    const ca = Math.cos(a), sa = Math.sin(a); let gy = 1e9;
    for (const [u, v] of [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5], [0, 0]]) gy = Math.min(gy, gAt(x + ca * u * l - sa * v * w, z + sa * u * l + ca * v * w));
    const q = r(), two = o.two ?? (gy < -2.3 || q < .3), roof = o.roof || (r() < (two ? .5 : .22) ? 'flat' : r() < .62 ? 'hip' : 'gable');
    const top = gy + (two ? 6.5 : 3.3);
    if (!o.kind && top < .9) return null;                                       // fully drowned: nothing pokes out
    const h = { x, z, a, l, w, rad, gy, two, roof, top, kind: o.kind || 'house', wall: o.wall || pick(WALL), people: 0, no: 0 };
    h.rc = o.rc || (roof === 'flat' ? pick(ROOF_C) : r() < .7 ? pick(ROOF_T) : pick(ROOF_S));
    h.rise = roof === 'flat' ? .95 : (roof === 'hip' ? .36 : .42) * w;
    h.ridge = top + (roof === 'flat' ? .95 : h.rise);
    houses.push(h); const k = hkey(Math.floor(x / 40), Math.floor(z / 40)); if (!hgrid.has(k)) hgrid.set(k, []); hgrid.get(k).push(h);
    return h;
  }
  const okSite = (x, z, rad = 9) => Math.abs(x) < 560 && Math.abs(z) < 560 && Math.abs(rdist(x, z)) > 44 && x < shoreX(z) - 70 && gAt(x, z) < -.5 &&
    Math.hypot(x - camp.x, z - camp.z) > 105 && Math.hypot(x - church.x, z - church.z) > 34 && !onRoad(x, z) && spaced(x, z, rad) && islets.every((s) => Math.hypot(s.x - x, s.z - z) > s.r * 2.6);
  // the school: long, two storeys, flat roof, beside the bank road
  let school = null;
  { const rd = roads[0].p; for (let t = 0; t < 60 && !school; t++) { const q = Math.floor(rd.length * rr(.5, .62)), [x0, z0] = rd[q], [x1, z1] = rd[q + 1], a = Math.atan2(z1 - z0, x1 - x0), x = x0 - Math.sin(a) * rside * 30, z = z0 + Math.cos(a) * rside * 30;
    if (Math.abs(x - town.x) > 150 && okSite(x, z, 26)) school = addHouse(x, z, a, { l: 40, w: 12, two: true, roof: 'flat', kind: 'school', wall: '#E6DFD2', rc: '#CFCBD3' }); } }
  // town streets, then strung along the roads (typical of Kerala), then scattered homesteads
  for (const st of streets) for (let q = 1; q < st.p.length; q++) {
    const [x0, z0] = st.p[q - 1], [x1, z1] = st.p[q], a = Math.atan2(z1 - z0, x1 - x0), nx = -Math.sin(a), nz = Math.cos(a);
    for (const sg of [-1, 1]) { if (r() > .55) continue; const off = rr(12, 16), x = (x0 + x1) / 2 + nx * sg * off, z = (z0 + z1) / 2 + nz * sg * off; if (okSite(x, z, 8.5)) addHouse(x, z, a + rr(-.08, .08)); }
  }
  for (const rd of roads) for (let q = 1; q < rd.p.length; q++) {
    if (r() > .24) continue;
    const [x0, z0] = rd.p[q - 1], [x1, z1] = rd.p[q], a = Math.atan2(z1 - z0, x1 - x0), sg = r() < .5 ? -1 : 1, off = rr(14, 34);
    const x = x0 - Math.sin(a) * sg * off, z = z0 + Math.cos(a) * sg * off; if (okSite(x, z, 10)) addHouse(x, z, a + (r() < .3 ? Math.PI / 2 : 0) + rr(-.2, .2));
  }
  for (let t = 0; t < 900; t++) { const x = rr(-560, 420), z = rr(-560, 560); if (fbm(x / 160, z / 160, S4, 2) < .55 || !okSite(x, z, 30)) continue; addHouse(x, z, r() * Math.PI); }
  // the camp hall on the mound (a house too: walls + gable roof)
  const hall = addHouse(camp.x + 8, camp.z + cside * 22, rr(-.2, .2), { l: 22, w: 10, two: false, roof: 'gable', kind: 'hall', wall: '#ECE5E2', rc: '#A6A1BE' });
  hall.gy = gAt(hall.x, hall.z) - .3; hall.top = hall.gy + 4.4; hall.ridge = hall.top + hall.rise;

  mark('houses');
  // ================================================================ trees
  const palms = [], trees = [], tgrid = new Map();
  const tfree = (x, z, sp) => { const gi = Math.floor(x / 20), gj = Math.floor(z / 20); for (let j = gj - 1; j <= gj + 1; j++) for (let i = gi - 1; i <= gi + 1; i++) { const L = tgrid.get(hkey(i, j)); if (L) for (const p of L) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < sp * sp) return false; } return true; };
  const tput = (x, z) => { const k = hkey(Math.floor(x / 20), Math.floor(z / 20)); if (!tgrid.has(k)) tgrid.set(k, []); tgrid.get(k).push([x, z]); };
  const palmOK = (x, z) => Math.abs(x) < 640 && Math.abs(z) < 640 && Math.hypot(x - camp.x, z - camp.z) > 44 && Math.abs(rdist(x, z)) > 36 && !onRoad(x, z) && spaced(x, z, 2.5) && tfree(x, z, 5.5) && gAt(x, z) < 6;
  const addPalm = (x, z, s) => { const g = gAt(x, z); palms.push({ x, z, y: g, s: s * clamp((g + 11.5) / 10.5, .95, 1.25), a: r() * TAU, lean: rr(.02, .16), la: r() * TAU, v: r() < .5 ? 0 : 1, ph: r() * TAU }); tput(x, z); };
  const addTree = (x, z, s, kind = 0) => { const g = gAt(x, z); trees.push({ x, z, y: g, s, a: r() * TAU, v: kind, ph: r() * TAU }); tput(x, z); };
  const NP = HI ? 600 : 380;
  for (const h of houses) { if (h.kind !== 'house') continue; const n = 1 + Math.floor(r() * 4); for (let q = 0; q < n && palms.length < NP; q++) { const a = r() * TAU, d = h.rad + rr(3, 12), x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d; if (palmOK(x, z)) addPalm(x, z, rr(.85, 1.2)); } }
  for (const rd of roads) for (const [x, z] of rd.p) if (r() < .3 && palms.length < NP) { const sg = r() < .5 ? -1 : 1, x2 = x + rr(-6, 6), z2 = z + sg * rr(8, 12); if (palmOK(x2, z2)) addPalm(x2, z2, rr(.8, 1.15)); }
  for (let z = -620; z < 620 && palms.length < NP; z += 13) for (let x = -620; x < 600 && palms.length < NP; x += 13) {   // coconut groves
    if (fbm(x / 210 + 7, z / 210, S4 + 5, 3) < .6) continue; const jx = x + rr(-5, 5), jz = z + rr(-5, 5); if (r() < .6 && palmOK(jx, jz)) addPalm(jx, jz, rr(.8, 1.2));
  }
  for (let t = 0; t < (HI ? 260 : 150); t++) { const h = pick(houses); if (!h || h.kind !== 'house') continue; const a = r() * TAU, d = h.rad + rr(5, 22), x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d; if (palmOK(x, z)) addTree(x, z, rr(.8, 1.15)); }
  for (const s of islets) for (let q = 0; q < 9; q++) { const a = r() * TAU, d = Math.sqrt(r()) * s.r * 1.3, x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d; if (tfree(x, z, 5)) (q % 3 ? addTree(x, z, rr(.9, 1.3)) : addPalm(x, z, rr(.9, 1.2))); }
  // the hills: a lumpy canopy "carpet" sculpted into the terrain, with real trees along its edges and in the glades
  const cwEnd = { x: cw1.x + 90, z: cw1.z + 12 };
  const carpetAt = (x, z, g) => {
    if (g < 1.2 || x < 250) return 0;
    const m = smooth(1.2, 5, g) * smooth(.36, .48, fbm(x / 160, z / 160, S2 + 9, 3)) * smooth(10, 26, segD(x, z, cw0.x, cw0.z, cwEnd.x, cwEnd.z)) * smooth(75, 105, Math.hypot(x - camp.x, z - camp.z));
    return m <= 0 ? 0 : m * (2.8 + 9 * Math.max(0, fbm(x / 26, z / 26, S3 + 5, 2) - .32));
  };
  const SPH = HI ? 9 : 12;
  for (let z = -760; z < 760; z += SPH) for (let x = 300; x < 900; x += SPH) {
    const jx = x + rr(-3.5, 3.5), jz = z + rr(-3.5, 3.5), g = gAt(jx, jz); if (g < 1.4) continue;
    const c = carpetAt(jx, jz, g), sx = shoreX(jz), edge = jx < sx + 130 ? 1 : 0, open = c < .8 ? 1 : 0;
    if (segD(jx, jz, cw0.x, cw0.z, cwEnd.x, cwEnd.z) < 9 || Math.hypot(jx - camp.x, jz - camp.z) < 70) continue;
    if (r() > (open ? (edge ? .55 : .14) : (edge ? .16 : .02))) continue;
    trees.push({ x: jx, z: jz, y: g + c * .75 - .6, s: rr(.85, 1.35) * (open ? 1 : 1.25), a: r() * TAU, v: 1 + (r() < .35 ? 1 : 0), ph: r() * TAU });
  }
  for (let q = 0; q < 26; q++) { const a = r() * TAU, d = rr(44, 66), x = camp.x + Math.cos(a) * d, z = camp.z + Math.sin(a) * d; if (gAt(x, z) > -1 && tfree(x, z, 7) && Math.abs(a - Math.atan2(-cside, 0)) > .5) (q % 2 ? addTree(x, z, rr(.9, 1.2)) : addPalm(x, z, rr(.9, 1.1))); }

  mark('trees');
  // ================================================================ power lines (bank road + camp road); three spans down
  const lines = [];
  for (const ri of [0, 2]) {
    const p = roads[ri].p, poles = []; let acc = 0;
    for (let q = 1; q < p.length; q++) {
      acc += Math.hypot(p[q][0] - p[q - 1][0], p[q][1] - p[q - 1][1]); if (acc < 42) continue; acc = 0;
      const a = Math.atan2(p[q][1] - p[q - 1][1], p[q][0] - p[q - 1][0]), x = p[q][0] - Math.sin(a) * 6.5, z = p[q][1] + Math.cos(a) * 6.5;
      if (Math.abs(x) > 640 || Math.abs(z) > 640 || x > shoreX(z) - 20 || Math.abs(rdist(x, z)) < 30 || Math.hypot(x - camp.x, z - camp.z) < 85) { if (poles.length) { lines.push(poles.splice(0)); } continue; }
      poles.push({ x, z, g: gAt(x, z), a, down: 0 });
    }
    if (poles.length > 1) lines.push(poles);
  }
  const hazards = [];
  { const cand = []; lines.forEach((L) => { for (let q = 1; q < L.length - 1; q++) { const a = L[q - 1], b = L[q]; const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2; if (inPoly(mx, mz) && inPoly(a.x, a.z) && Math.hypot(mx - camp.x, mz - camp.z) > 260) cand.push([L, q]); } });
    for (let t = 0; t < 200 && hazards.length < 3 && cand.length; t++) {
      const [L, q] = pick(cand), b = L[q]; if (hazards.some((h) => Math.hypot(h.pole.x - b.x, h.pole.z - b.z) < 220)) continue;
      b.down = 1; b.lean = Math.acos(clamp((rr(2.2, 3.4) - b.g) / 9.5, .05, .9)); b.la = b.a + (r() < .5 ? 1 : -1) * rr(1.1, 1.9);
      hazards.push({ line: L, q, pole: b, cells: [] });
    }
  }

  // ================================================================ the tethered drone's boat, the jetty, the rescue boats
  let station = null;
  for (let t = 0; t < 400 && !station; t++) {
    const x = rr(-60, 140), n = rside * rr(55, 85), z = riverZ(x) + n;
    if (gAt(x, z) > -1.4 || !spaced(x, z, 22) || !tfree(x, z, 14) || onRoad(x, z)) continue;
    station = { x, z, a: Math.atan2(riverS(x), 1) + Math.PI };
  }
  if (!station) station = { x: 40, z: riverZ(40) + rside * 70, a: Math.PI };
  let jx = camp.x, jz = camp.z; for (let q = 0; q < 60 && gAt(jx, jz) > -1.3; q++) jz -= cside * 2;
  const jetty0 = { x: camp.x, z: camp.z - cside * 30 }, jetty1 = { x: jx, z: jz - cside * 4 };

  // ================================================================ people on roofs (hidden until found)
  let pno = 0;
  for (const h of houses) h.no = h.kind === 'house' ? ++pno : 0;
  const groups = [];
  const roofSpots = (h, n) => {                                                  // standing / sitting spots on a roof
    const out = [], ca = Math.cos(h.a), sa = Math.sin(h.a);
    for (let k = 0; k < n; k++) {
      let u, v, y, pose;
      if (h.roof === 'flat') { u = rr(-.36, .36) * h.l; v = rr(-.34, .34) * h.w; y = h.top + .25; pose = r() < .45 ? 1 : r() < .6 ? 0 : 2; }
      else { u = rr(-.28, .28) * h.l * (h.roof === 'hip' ? .7 : 1); v = rr(-.05, .05); y = h.ridge - .15; pose = 2; }
      if (h.kind === 'church') { u = rr(-17.6, -16.7); v = rr(-.3, .3) * 13; y = h.gy + 1.17; pose = r() < .5 ? 1 : 0; }
      out.push({ x: h.x + ca * u - sa * v, y, z: h.z + sa * u + ca * v, a: h.a + rr(-1.4, 1.4) + (h.roof === 'flat' ? r() * TAU : Math.PI / 2), pose });
    }
    return out;
  };
  const inSearch = (x, z) => inPoly(x, z) && inPoly(x + 14, z) && inPoly(x - 14, z) && inPoly(x, z + 14) && inPoly(x, z - 14);
  const big = [school, ...houses.filter((h) => h.kind === 'church')].filter(Boolean);
  const pool = houses.filter((h) => h.kind === 'house' && inSearch(h.x, h.z) && Math.hypot(h.x - camp.x, h.z - camp.z) > 230);
  for (let t = 0, made = 0; t < 600 && made < 10 && pool.length; t++) {
    const h = pick(pool); if (h.people || pool.length && groups.some((g) => Math.hypot(g.h.x - h.x, g.h.z - h.z) < 120)) continue;
    if (!(h.two || h.roof === 'flat') && r() < .6) continue;
    h.people = 1 + Math.floor(r() * 4); groups.push({ h, n: h.people }); made++;
  }

  mark('people');
  // ================================================================ GEOMETRY
  const group = new THREE.Group(); group.name = 'flood-world';
  const disposables = [];
  const own = (x) => { disposables.push(x); return x; };
  const mats = {
    v: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0 })),
    terrain: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })),
    tree: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: 0, side: THREE.DoubleSide })),
    people: own(new THREE.MeshStandardMaterial({ color: lin('#FFC36B'), emissive: lin('#FFB060'), emissiveIntensity: .22, roughness: .8, metalness: 0 })),
    wire: own(new THREE.LineBasicMaterial({ color: lin('#4A4B6E'), transparent: true, opacity: .75 })),
    drift: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, metalness: 0 })),
  };
  const G = {                                                                    // tiny geometry kit (all coloured)
    box: (w, h, d, c, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) => xf(paint(new THREE.BoxGeometry(w, h, d), c), x, y, z, rx, ry, rz),
    cyl: (rt, rb, h, seg, c, x = 0, y = 0, z = 0, open = false, rx = 0, rz = 0, ry = 0) => xf(paint(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), c), x, y + h / 2, z, rx, ry, rz),
  };
  function xf(g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) { const m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz)); g.applyMatrix4(m); return g; }
  function paint(g, hex) { const c = typeof hex === 'string' ? lin(hex) : hex, n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
  function merge(geos) {
    let nv = 0, ni = 0; for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let ov = 0, oi = 0;
    for (const g of geos) {
      const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color, cnt = p.count;
      const cp = (a, D) => { if (!a.isInterleavedBufferAttribute && !a.normalized && a.itemSize === 3 && a.array.length === cnt * 3) D.set(a.array, ov * 3); else for (let i = 0; i < cnt; i++) { const o = (ov + i) * 3; D[o] = a.getX(i); D[o + 1] = a.getY(i); D[o + 2] = a.getZ(i); } };
      cp(p, P); if (n) cp(n, N); if (c) cp(c, C); else C.fill(1, ov * 3, (ov + cnt) * 3);
      if (g.index) { const ix = g.index.array, m = g.index.count; for (let i = 0; i < m; i++) I[oi + i] = ix[i] + ov; oi += m; } else { for (let i = 0; i < cnt; i++) I[oi + i] = ov + i; oi += cnt; }
      ov += cnt; g.dispose();
    }
    const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('color', new THREE.BufferAttribute(C, 3)); out.setIndex(new THREE.BufferAttribute(I, 1));
    out.computeBoundingSphere(); out.computeBoundingBox(); return out;
  }
  const mesh = (geo, mat, cast = true, receive = true, name = '') => { const m = new THREE.Mesh(own(geo), mat); m.castShadow = cast; m.receiveShadow = receive; m.name = name; group.add(m); return m; };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = V(), _s = V(), _c = new THREE.Color();
  function inst(geo, mat, list, { cast = true, receive = true, name = '', tint = false } = {}) {
    const im = new THREE.InstancedMesh(own(geo), mat, Math.max(1, list.length)); im.count = list.length; im.name = name;
    list.forEach((o, i) => { _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'); _q.setFromEuler(_e); _m.compose(_p.set(o.x, o.y, o.z), _q, _s.set(o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1)); im.setMatrixAt(i, _m); if (tint) im.setColorAt(i, _c.set(o.c || '#ffffff')); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = cast; im.receiveShadow = receive; im.computeBoundingSphere(); group.add(im); return im;
  }
  // props.glb nodes -> one merged, vertex-coloured geometry (origin at the base centre); trees recoloured to this palette
  function propGeo(name, colorOf) {
    const root = props && props.getObjectByName ? props.getObjectByName(name) : null; if (!root) return null;
    root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), parts = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const src = o.geometry, pa = src.attributes.position, na = src.attributes.normal, n = pa.count, g = new THREE.BufferGeometry(), P = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { P[i * 3] = pa.getX(i); P[i * 3 + 1] = pa.getY(i); P[i * 3 + 2] = pa.getZ(i); }
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      if (na) { const N = new Float32Array(n * 3); for (let i = 0; i < n; i++) { N[i * 3] = na.getX(i); N[i * 3 + 1] = na.getY(i); N[i * 3 + 2] = na.getZ(i); } g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); }
      if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
      if (!na) g.computeVertexNormals();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      const mt = Array.isArray(o.material) ? o.material[0] : o.material;
      paint(g, colorOf ? colorOf(mt, o) : (mt && mt.color ? mt.color.clone() : lin('#D9D2E2'))); parts.push(g);
    });
    if (!parts.length) return null;
    const geo = merge(parts); geo.userData.tris = geo.index.count / 3; return geo;
  }
  const woodOrLeaf = (wood, leaf) => (mt, o) => (/foliage|leaf|leaves|crown|canopy|frond/i.test(((mt && mt.name) || '') + ' ' + (o.name || '')) ? lin(leaf) : lin(wood));
  // fit a prop geometry to a target height (keeps proportions)
  const fitH = (geo, h) => { const bb = geo.boundingBox, k = h / Math.max(.01, bb.max.y - bb.min.y); geo.scale(k, k, k); geo.translate(0, -bb.min.y * k, 0); geo.computeBoundingBox(); geo.computeBoundingSphere(); return geo; };

  // ---------------------------------------------------------------- terrain (dry ground and hills; submerged quads culled)
  // 8 m vertices over the play area, spacing growing outward (east to 1.7 km, the hills fade into the fog)
  let terrain, meshY;
  {
    const XA = -560, XB = 600, ZA = -600, ZB = 600, TS = 8, xs = [], zs = [];
    for (let x = XA; x <= XB; x += TS) xs.push(x); for (let d = TS * 1.1, x = XB; x < 1750; d *= 1.1) { x += d; xs.push(x); }
    for (let d = TS * 1.1, z = ZA; z > -1500; d *= 1.1) { z -= d; zs.unshift(z); } for (let z = ZA; z <= ZB; z += TS) zs.push(z); for (let d = TS * 1.1, z = ZB; z < 1500; d *= 1.1) { z += d; zs.push(z); }
    const NXT = xs.length, NZT = zs.length, jz0 = zs.indexOf(ZA), P = new Float32Array(NXT * NZT * 3), C = new Float32Array(NXT * NZT * 3), Y = new Float32Array(NXT * NZT), CP = new Float32Array(NXT * NZT);
    for (let j = 0; j < NZT; j++) for (let i = 0; i < NXT; i++) {
      const x = xs[i], z = zs[j], hi = (x + HB) / HSP, hj = (z + HB) / HSP;
      const g = hi >= 0 && hj >= 0 && hi < HN && hj < HN && hi === Math.floor(hi) && hj === Math.floor(hj) ? H[hj * HN + hi] : ground(x, z), c = carpetAt(x, z, g);
      Y[j * NXT + i] = g + c; CP[j * NXT + i] = c;
    }
    const cMud = lin('#959786'), cGrass = lin('#93A584'), cGrass2 = lin('#839A78'), cHill = lin('#7A9170'), cCan = lin('#4F6B55'), cCan2 = lin('#7D9A70'), cRock = lin('#A39EAE'), cEarth = lin('#C6B8A2'), tmp = new THREE.Color();
    for (let j = 0; j < NZT; j++) for (let i = 0; i < NXT; i++) {
      const k = j * NXT + i, x = xs[i], z = zs[j], y = Y[k], c = CP[k];
      const dxs = xs[Math.min(NXT - 1, i + 1)] - xs[Math.max(0, i - 1)], dzs = zs[Math.min(NZT - 1, j + 1)] - zs[Math.max(0, j - 1)];
      const sl = Math.hypot((Y[j * NXT + Math.min(NXT - 1, i + 1)] - Y[j * NXT + Math.max(0, i - 1)]) / dxs, (Y[Math.min(NZT - 1, j + 1) * NXT + i] - Y[Math.max(0, j - 1) * NXT + i]) / dzs);
      const n = vn(x / 60, z / 60, S4 + 2);
      tmp.copy(cGrass).lerp(cGrass2, n); tmp.lerp(cHill, smooth(2, 12, y));
      tmp.lerp(cRock, smooth(.5, 1, sl) * .5 * (1 - smooth(.5, 2, c)));
      if (c > 0) { const top = smooth(2.8, 6.5, c), m = smooth(.3, 1.6, c); _c.copy(cCan).lerp(cCan2, top * (.5 + .5 * vn(x / 90, z / 90, S1 + 8))); tmp.lerp(_c, m); }
      tmp.lerp(cMud, 1 - smooth(.1, 1.1, y));
      const dc = Math.hypot(x - camp.x, z - camp.z); tmp.lerp(cEarth, (1 - smooth(18, 44, dc)) * .55);
      P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z; C[k * 3] = tmp.r; C[k * 3 + 1] = tmp.g; C[k * 3 + 2] = tmp.b;
    }
    const idx = [];
    for (let j = 0; j < NZT - 1; j++) for (let i = 0; i < NXT - 1; i++) {
      const a = j * NXT + i, b = a + 1, c = a + NXT, d = c + 1;
      if (Math.max(Y[a], Y[b], Y[c], Y[d]) < -.6) continue;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setIndex(idx); g.computeVertexNormals();
    terrain = mesh(g, mats.terrain, false, true, 'terrain'); terrain.userData.layer = 'ground';
    meshY = (x, z) => {                                                         // the terrain exactly as triangulated (play area)
      if (x < XA || x > XB - .01 || z < ZA || z > ZB - .01) { const g0 = ground(x, z); return g0 + carpetAt(x, z, g0); }
      let fx = (x - XA) / TS, fz = (z - ZA) / TS; const i = fx | 0, j = fz | 0; fx -= i; fz -= j;
      const o = (jz0 + j) * NXT + i, a = Y[o], b = Y[o + 1], c = Y[o + NXT], d = Y[o + NXT + 1];
      return fx + fz < 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
    };
  }

  mark('terrain');
  // ---------------------------------------------------------------- textures for the water: depth (from H) and ghosts
  const depthData = new Uint8Array(HN * HN * 4);
  for (let k = 0; k < HN * HN; k++) { const d = -H[k]; depthData[k * 4] = clamp(Math.round(d / 8 * 255), 0, 255); depthData[k * 4 + 1] = H[k] > 0 ? 255 : 0; depthData[k * 4 + 3] = 255; }
  const depthTex = own(new THREE.DataTexture(depthData, HN, HN)); depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter; depthTex.wrapS = depthTex.wrapT = THREE.ClampToEdgeWrapping; depthTex.needsUpdate = true;
  const GN = HI ? 2048 : 1024, GB = 600, gcv = document.createElement('canvas'); gcv.width = gcv.height = GN;
  const gx = gcv.getContext('2d'), PX = (x) => (x + GB) / (2 * GB) * GN, PS = GN / (2 * GB);
  gx.fillStyle = '#000'; gx.fillRect(0, 0, GN, GN); gx.globalCompositeOperation = 'lighter'; gx.lineCap = 'round'; gx.lineJoin = 'round';
  const gpath = (p) => { gx.beginPath(); p.forEach(([x, z], q) => (q ? gx.lineTo(PX(x), PX(z)) : gx.moveTo(PX(x), PX(z)))); };
  const grect = (x, z, l, w, a) => { const ca = Math.cos(a), sa = Math.sin(a); gx.beginPath(); [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([u, v], q) => { const X = PX(x + ca * u * l / 2 - sa * v * w / 2), Z = PX(z + sa * u * l / 2 + ca * v * w / 2); q ? gx.lineTo(X, Z) : gx.moveTo(X, Z); }); gx.closePath(); };
  // paddy bunds: a rotated grid of low banks in the open fields, away from the town, the river and the houses
  const fth = rr(-.35, .35), fc = Math.cos(fth), fs = Math.sin(fth);
  const fieldOK = (x, z) => fbm(x / 260 + 3, z / 260, S2 + 6, 3) > .47 && Math.abs(rdist(x, z)) > 70 && Math.hypot(x - town.x, z - town.z) > 210 && gAt(x, z) < -1 && x < shoreX(z) - 60 && spaced(x, z, 6);
  gx.filter = `blur(${Math.max(.6, .7 * PS).toFixed(1)}px)`; gx.strokeStyle = 'rgba(255,0,0,.42)'; gx.lineWidth = Math.max(1, 2.2 * PS); gx.beginPath();
  for (let a = -760; a < 760; a += 34) for (let b = -760; b < 760; b += 24) {
    const x = fc * a - fs * b, z = fs * a + fc * b; if (Math.abs(x) > GB - 4 || Math.abs(z) > GB - 4) continue;
    if (fieldOK(x + fc * 17, z + fs * 17)) { gx.moveTo(PX(x), PX(z)); gx.lineTo(PX(x + fc * 34), PX(z + fs * 34)); }
    if (fieldOK(x - fs * 12, z + fc * 12)) { gx.moveTo(PX(x), PX(z)); gx.lineTo(PX(x - fs * 24), PX(z + fc * 24)); }
  }
  gx.stroke();
  gx.filter = 'none';
  // compound walls and footpaths around houses
  gx.strokeStyle = 'rgba(255,0,0,.55)'; gx.lineWidth = Math.max(1, .6 * PS);
  for (const h of houses) if (h.kind === 'house' && r() < .55) { grect(h.x, h.z, h.l + rr(7, 13), h.w + rr(7, 12), h.a); gx.stroke(); }
  // roads (pale, with brighter edges), streets
  for (const st of streets) { gpath(st.p); gx.strokeStyle = 'rgba(255,0,0,.24)'; gx.lineWidth = st.w * PS; gx.stroke(); }
  for (const rd of roads) { gpath(rd.p); gx.strokeStyle = 'rgba(255,0,0,.26)'; gx.lineWidth = rd.w * PS; gx.stroke(); gx.strokeStyle = 'rgba(255,0,0,.12)'; gx.lineWidth = (rd.w + 2) * PS; gx.stroke(); }
  // the bridge where the cross road meets the river: deck just under the surface
  let bridge = null;
  { const p = roads[1].p; let bi = 0, bd = 1e9; p.forEach(([x, z], q) => { const d = Math.abs(rdist(x, z)); if (d < bd) { bd = d; bi = q; } });
    const [x0, z0] = p[bi - 1], [x1, z1] = p[bi + 1], a = Math.atan2(z1 - z0, x1 - x0), mx = p[bi][0], mz = p[bi][1];
    bridge = { x: mx, z: mz, a, L: 64 };
    gx.strokeStyle = 'rgba(255,0,0,.75)'; gx.lineWidth = 7 * PS; gx.beginPath(); gx.moveTo(PX(mx - Math.cos(a) * 32), PX(mz - Math.sin(a) * 32)); gx.lineTo(PX(mx + Math.cos(a) * 32), PX(mz + Math.sin(a) * 32)); gx.stroke(); }
  // waterline foam rings (green) around everything that pokes out; wakes (blue) downstream of things in the current
  const ring = (x, z, rad, a = .8) => { gx.fillStyle = `rgba(0,255,0,${a})`; gx.beginPath(); gx.arc(PX(x), PX(z), Math.max(1.2, rad * PS), 0, TAU); gx.fill(); };
  const wake = (x, z, rad) => {
    const n = rdist(x, z); if (Math.abs(n) > 75) return; const k = Math.exp(-(n * n) / 2300), f = flow(x, z, [0, 0]), sp = Math.hypot(f[0], f[1]) || 1, dx = f[0] / sp, dz = f[1] / sp, L = (8 + rad * 3) * (.5 + k);
    for (let s = 0; s < 6; s++) { const t = s / 6; gx.strokeStyle = `rgba(0,0,255,${(.55 * (1 - t) * (.4 + .6 * k)).toFixed(3)})`; gx.lineWidth = Math.max(1, (rad * 1.4 + t * rad * 1.8) * PS); gx.beginPath(); gx.moveTo(PX(x + dx * L * t), PX(z + dz * L * t)); gx.lineTo(PX(x + dx * L * (t + 1 / 6)), PX(z + dz * L * (t + 1 / 6))); gx.stroke(); }
  };
  for (const h of houses) { if (h.kind === 'hall') continue; grect(h.x, h.z, h.l + .9, h.w + .9, h.a); gx.strokeStyle = 'rgba(0,255,0,.6)'; gx.lineWidth = Math.max(1, 1.0 * PS); gx.stroke(); wake(h.x, h.z, h.rad * .7); }
  for (const p of palms) { ring(p.x, p.z, .9, .6); wake(p.x, p.z, .5); }
  for (const t of trees) if (t.y < 0) { ring(t.x, t.z, 1.1, .6); wake(t.x, t.z, .7); }
  for (const L of lines) for (const p of L) { ring(p.x, p.z, .7, .55); wake(p.x, p.z, .3); }
  ring(station.x, station.z, 5.5, .5); wake(station.x, station.z, 3);

  mark('ghost');
  // ---------------------------------------------------------------- houses, church, school, structures: one merged mesh
  const parts = [];
  const hipGeo = () => { const g = new THREE.BufferGeometry(), r0 = .28, v = [[-.5, 0, -.5], [.5, 0, -.5], [.5, 0, .5], [-.5, 0, .5], [-.5 + r0, 1, 0], [.5 - r0, 1, 0]], f = [[0, 4, 5, 1], [2, 5, 4, 3], [1, 5, 2], [3, 4, 0]], P = [];
    for (const q of f) { const tri = q.length === 4 ? [[q[0], q[1], q[2]], [q[0], q[2], q[3]]] : [q]; for (const t of tri) for (const k of t) P.push(...v[k]); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g; };
  const gableGeo = () => { const g = new THREE.BufferGeometry(), v = [[-.5, 0, -.5], [.5, 0, -.5], [.5, 0, .5], [-.5, 0, .5], [-.5, 1, 0], [.5, 1, 0]], f = [[0, 4, 5, 1], [2, 5, 4, 3], [1, 5, 2], [3, 4, 0]], P = [];
    for (const q of f) { const tri = q.length === 4 ? [[q[0], q[1], q[2]], [q[0], q[2], q[3]]] : [q]; for (const t of tri) for (const k of t) P.push(...v[k]); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g; };
  const placeH = (g, h, u, y, v, sx, sy, sz, ry = 0) => xf(g, h.x + Math.cos(h.a) * u - Math.sin(h.a) * v, y, h.z + Math.sin(h.a) * u + Math.cos(h.a) * v, 0, -h.a + ry, 0, sx, sy, sz);
  const darken = (hex, k) => lin(hex).multiplyScalar(k);
  for (const h of houses) {
    if (h.kind === 'church') continue;
    const bot = h.gy - .4;
    parts.push(placeH(paint(new THREE.BoxGeometry(1, 1, 1), h.wall), h, 0, (bot + h.top) / 2, 0, h.l, h.top - bot, h.w));
    if (h.two || h.kind === 'school') {                                         // upper-floor windows and a slab line
      const nw = Math.max(2, Math.round(h.l / 4.2)), wy = h.top - 1.9;
      for (let k = 0; k < nw; k++) { const u = (k + .5) / nw * h.l - h.l / 2; for (const sg of [-1, 1]) parts.push(placeH(paint(new THREE.BoxGeometry(1.25, 1.2, .14), '#5D6280'), h, u, wy, sg * h.w / 2, 1, 1, 1)); }
      parts.push(placeH(paint(new THREE.BoxGeometry(1, .22, 1), darken(h.wall, .86)), h, 0, h.top - 3.25, 0, h.l + .3, 1, h.w + .3));
    }
    if (h.roof === 'flat') {
      parts.push(placeH(paint(new THREE.BoxGeometry(1, .25, 1), h.rc), h, 0, h.top + .12, 0, h.l + .3, 1, h.w + .3));
      for (const [u, v, l, w] of [[0, .5, 1, 0], [0, -.5, 1, 0], [.5, 0, 0, 1], [-.5, 0, 0, 1]]) parts.push(placeH(paint(new THREE.BoxGeometry(l ? h.l + .3 : .22, .75, w ? h.w + .3 : .22), darken(h.wall, .95)), h, u * (h.l + .1), h.top + .6, v * (h.w + .1), 1, 1, 1));
      if (h.kind === 'house' && r() < .55) parts.push(placeH(paint(new THREE.BoxGeometry(3, 2.4, 3), h.wall), h, h.l * rr(-.3, .3), h.top + 1.4, h.w * rr(-.2, .2), 1, 1, 1));
      if (r() < .6) parts.push(placeH(paint(new THREE.CylinderGeometry(.62, .62, 1.3, 9), '#4E5068'), h, h.l * rr(-.35, .35), h.top + .9, h.w * rr(-.3, .3), 1, 1, 1));
    } else {
      const g = h.roof === 'hip' ? hipGeo() : gableGeo(); paint(g, h.rc);
      parts.push(placeH(g, h, 0, h.top, 0, h.l + 1.1, h.rise, h.w + 1.1));
    }
  }
  // church: nave, gabled front with a cross, a bell tower, a side annex with a flat roof, on a plinth
  const ch = { x: church.x, z: church.z, a: church.a, l: 30, w: 13, gy: gAt(church.x, church.z) }; let chTower = null;
  {
    const h = ch, wall = '#ECE7EA', roof = '#B27F7A', trim = '#D9D0D8', y0 = h.gy + .9;
    parts.push(placeH(paint(new THREE.BoxGeometry(1, 1, 1), '#C9C2C8'), h, 0, h.gy + .45, 0, h.l + 6, 1.4, h.w + 6));        // plinth
    parts.push(placeH(paint(new THREE.BoxGeometry(1, 1, 1), wall), h, 0, y0 + 4.5, 0, h.l, 9, h.w));
    parts.push(placeH(paint(gableGeo(), roof), h, 0, y0 + 9, 0, h.l + 1, 5.6, h.w + 1.2));
    parts.push(placeH(paint(new THREE.BoxGeometry(1.6, 1, 1), wall), h, -h.l / 2 - .5, y0 + 6.5, 0, 1, 13, h.w + 1.6));          // front wall, taller
    parts.push(placeH(paint(gableGeo(), wall), h, -h.l / 2 - .5, y0 + 13, 0, 1.6, 3.6, h.w + 1.6));
    parts.push(placeH(paint(new THREE.BoxGeometry(.5, 3.4, .5), trim), h, -h.l / 2 - .5, y0 + 18.3, 0, 1, 1, 1));
    parts.push(placeH(paint(new THREE.BoxGeometry(.5, .5, 2), trim), h, -h.l / 2 - .5, y0 + 18.9, 0, 1, 1, 1));
    for (let k = 0; k < 5; k++) for (const sg of [-1, 1]) parts.push(placeH(paint(new THREE.BoxGeometry(1.1, 3.4, .16), '#7C7896'), h, -h.l / 2 + 4 + k * 5.4, y0 + 4.6, sg * h.w / 2, 1, 1, 1));
    parts.push(placeH(paint(new THREE.BoxGeometry(2.4, 4.2, .2), '#7C7896'), h, -h.l / 2 - 1.35, y0 + 2.1, 0, 1, 1, 1, Math.PI / 2));
    const tu = h.l / 2 - 3, tv = -h.w / 2 - 3.2;                                                                               // bell tower
    parts.push(placeH(paint(new THREE.BoxGeometry(5, 18, 5), wall), h, tu, y0 + 9, tv, 1, 1, 1));
    parts.push(placeH(paint(new THREE.BoxGeometry(5.4, .5, 5.4), trim), h, tu, y0 + 13.5, tv, 1, 1, 1));
    for (const sg of [-1, 1]) parts.push(placeH(paint(new THREE.BoxGeometry(1.4, 2.4, 5.1), '#6E6A88'), h, tu + sg * 1.85, y0 + 15.6, tv, 1, 1, 1));
    { const g = new THREE.ConeGeometry(3.9, 6.5, 4); g.rotateY(Math.PI / 4); paint(g, roof); parts.push(placeH(g, h, tu, y0 + 21.25, tv, 1, 1, 1)); }
    parts.push(placeH(paint(new THREE.BoxGeometry(.35, 2.4, .35), trim), h, tu, y0 + 25.6, tv, 1, 1, 1));
    parts.push(placeH(paint(new THREE.BoxGeometry(.35, .35, 1.4), trim), h, tu, y0 + 26, tv, 1, 1, 1));
    chTower = { x: h.x + Math.cos(h.a) * tu - Math.sin(h.a) * tv, z: h.z + Math.sin(h.a) * tu + Math.cos(h.a) * tv, top: y0 + 26.8 };
    const au = h.l * .1, av = h.w / 2 + 5;                                                                                    // annex, flat roof
    parts.push(placeH(paint(new THREE.BoxGeometry(14, 6, 8), '#E3DDE2'), h, au, h.gy + 3, av, 1, 1, 1));
    parts.push(placeH(paint(new THREE.BoxGeometry(14.4, .3, 8.4), '#CFCAD2'), h, au, h.gy + 6.1, av, 1, 1, 1));
    for (const [u, v, l, w] of [[0, 4.1, 14.4, .2], [0, -4.1, 14.4, .2], [7.1, 0, .2, 8.4], [-7.1, 0, .2, 8.4]]) parts.push(placeH(paint(new THREE.BoxGeometry(l, .7, w), '#DCD6DB'), h, au + u, h.gy + 6.55, av + v, 1, 1, 1));
    houses.push({ x: h.x, z: h.z, a: h.a, l: h.l + 6, w: h.w + 6, rad: 20, gy: h.gy, two: true, roof: 'gable', top: y0 + 9, ridge: y0 + 14.6, kind: 'church', people: 0, no: 0 });
    houses.push({ x: h.x - Math.sin(h.a) * av + Math.cos(h.a) * au, z: h.z + Math.cos(h.a) * av + Math.sin(h.a) * au, a: h.a, l: 14, w: 8, rad: 8, gy: h.gy, two: true, roof: 'flat', top: h.gy + 6.1, ridge: h.gy + 7, kind: 'annex', people: 0, no: 0 });
  }
  const churchH = houses[houses.length - 2], annex = houses[houses.length - 1];
  churchH.people = 4 + Math.floor(r() * 3); annex.people = 3 + Math.floor(r() * 3); if (school) school.people = 6 + Math.floor(r() * 4);
  groups.unshift({ h: churchH, n: churchH.people }, { h: annex, n: annex.people }); if (school) groups.unshift({ h: school, n: school.people });
  // telecom mast in the town and an overhead water tank near the school
  const mast = (() => { for (let t = 0; t < 80; t++) { const x = town.x + rr(-120, 120), z = town.z + rr(-110, 110); if (okSite(x, z, 6)) return { x, z, g: gAt(x, z) }; } return { x: town.x + 90, z: town.z + 60, g: gAt(town.x + 90, town.z + 60) }; })();
  { const H0 = 34; for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const g = new THREE.CylinderGeometry(.14, .2, H0 - mast.g, 4); g.translate(0, (H0 - mast.g) / 2, 0); const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-sz * .035, 0, sx * .035)); g.applyMatrix4(m); g.translate(mast.x + sx * 1.1, mast.g, mast.z + sz * 1.1); parts.push(paint(g, '#8E8AA8')); }
    for (let y = mast.g + 4; y < H0 - 2; y += 4) parts.push(G.box(2.2 - (y - mast.g) / H0 * 1.2, .14, 2.2 - (y - mast.g) / H0 * 1.2, '#8E8AA8', mast.x, y, mast.z));
    for (let k = 0; k < 3; k++) parts.push(G.box(.5, 2, .25, '#D9D3DE', mast.x + Math.cos(k * 2.1) * 1, H0 - 2.5, mast.z + Math.sin(k * 2.1) * 1, -k * 2.1));
    parts.push(G.box(.3, .3, .3, '#EFB1B4', mast.x, H0 + .2, mast.z)); }
  const tank = (() => { const base = school || { x: town.x, z: town.z, a: 0, l: 20 }; for (let t = 0; t < 80; t++) { const x = base.x + rr(-70, 70), z = base.z + rr(-70, 70); if (okSite(x, z, 6)) return { x, z, g: gAt(x, z) }; } return { x: base.x + 40, z: base.z + 30, g: gAt(base.x + 40, base.z + 30) }; })();
  { const top = 13.5; for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(G.box(.35, top - tank.g, .35, '#B5B0C2', tank.x + sx * 2, (top + tank.g) / 2, tank.z + sz * 2));
    parts.push(G.box(4.6, .2, .2, '#B5B0C2', tank.x, 7, tank.z + 2)); parts.push(G.box(4.6, .2, .2, '#B5B0C2', tank.x, 7, tank.z - 2)); parts.push(G.box(.2, .2, 4.6, '#B5B0C2', tank.x + 2, 7, tank.z)); parts.push(G.box(.2, .2, 4.6, '#B5B0C2', tank.x - 2, 7, tank.z));
    parts.push(G.cyl(3.3, 3, 4.2, 14, '#D8D3DC', tank.x, top, tank.z)); parts.push(G.cyl(.3, 3.4, 1.1, 14, '#BDB7C7', tank.x, top + 4.2, tank.z)); }
  // the submerged bridge: railings break the surface, the current piles foam against them
  { const b = bridge, ca = Math.cos(b.a), sa = Math.sin(b.a);
    for (const sg of [-1, 1]) {
      for (let s = -b.L / 2; s <= b.L / 2; s += 2.5) { const x = b.x + ca * s - sa * sg * 3.4, z = b.z + sa * s + ca * sg * 3.4; parts.push(G.box(.25, 1.5, .25, '#D6D0D8', x, -.15, z, -b.a)); ring(x, z, .5, .5); wake(x, z, .25); }
      parts.push(G.box(b.L, .18, .2, '#E2DDE3', b.x - sa * sg * 3.4, .55, b.z + ca * sg * 3.4, -b.a));
    } }
  // submerged cars, roofs just breaking the surface along the bank road
  const cars = [];
  { const p = roads[0].p; for (let t = 0; t < 40 && cars.length < 4; t++) { const q = 5 + Math.floor(r() * (p.length - 10)), [x0, z0] = p[q], [x1, z1] = p[q + 1], a = Math.atan2(z1 - z0, x1 - x0), x = x0 + rr(-2, 2), z = z0 + rr(-1.5, 1.5);
    if (Math.abs(x) > 460 || Math.abs(z) > 460 || gAt(x, z) < -1.9 || gAt(x, z) > -.9 || cars.some((c) => Math.hypot(c.x - x, c.z - z) < 90)) continue;
    const g = gAt(x, z), c = pick(['#C9C3D6', '#B98480', '#8FA0B3', '#E1DCD4']); cars.push({ x, z });
    parts.push(G.box(4.3, 1, 1.8, c, x, g + .75, z, -a + rr(-.3, .3))); parts.push(G.box(2.3, .75, 1.6, c, x - Math.cos(a) * .2, g + 1.6, z - Math.sin(a) * .2, -a)); ring(x, z, 2.6, .45); wake(x, z, 1.4); } }
  // power poles: standing ones with crossarms; the downed ones lean into the water
  const wires = [], wireP = (x0, y0, z0, x1, y1, z1, sag, n = 10) => { let px = x0, py = y0, pz = z0; for (let k = 1; k <= n; k++) { const t = k / n, x = lerp(x0, x1, t), z = lerp(z0, z1, t), y = lerp(y0, y1, t) - sag * 4 * t * (1 - t); wires.push(px, py, pz, x, y, z); px = x; py = y; pz = z; } };
  const poleTop = (p) => { const h = 9.5; if (!p.down) return [p.x, p.g + h, p.z]; const c = Math.cos(p.lean), s = Math.sin(p.lean); return [p.x + Math.cos(p.la) * s * h, p.g + c * h, p.z + Math.sin(p.la) * s * h]; };
  for (const L of lines) for (let q = 0; q < L.length; q++) {
    const p = L[q], h = 9.5, g = new THREE.CylinderGeometry(.13, .18, h, 6); g.translate(0, h / 2, 0);
    const arm = new THREE.BoxGeometry(.14, .14, 1.9); arm.translate(0, h - .5, 0); arm.rotateY(-p.a + Math.PI / 2); const pole = merge([paint(g, '#9C97AB'), paint(arm, '#8A869C')]);
    if (p.down) { pole.applyMatrix4(new THREE.Matrix4().makeRotationAxis(V(Math.sin(p.la), 0, -Math.cos(p.la)), p.lean)); }
    pole.translate(p.x, p.g, p.z); parts.push(pole);
    if (q === 0) continue;
    const a = L[q - 1], [ax, ay, az] = poleTop(a), [bx, by, bz] = poleTop(p), down = a.down || p.down, nx = -Math.sin(p.a) * .85, nz = Math.cos(p.a) * .85;
    for (const sg of [-1, 1]) wireP(ax + nx * sg, ay - .5, az + nz * sg, bx + nx * sg, by - .5, bz + nz * sg, down ? 3.6 + sg * .6 : .55);
  }
  for (const hz of hazards) {                                                    // cells near any wire that sinks below the surface
    const L = hz.line, q = hz.q, pts = [];
    for (const [a, b] of [[L[q - 1], L[q]], [L[q], L[q + 1]]]) { if (!a || !b) continue; const [ax, ay, az] = poleTop(a), [bx, by, bz] = poleTop(b); for (let k = 0; k <= 30; k++) { const t = k / 30, y = lerp(ay, by, t) - .5 - 3.6 * 4 * t * (1 - t); if (y < .4) pts.push([lerp(ax, bx, t), lerp(az, bz, t)]); } }
    const [px, , pz] = poleTop(hz.pole); pts.push([px, pz]); hz.pts = pts;
  }
  // the relief camp: launch pad, tents, a tarp shelter, stacked supplies, a water tank, the jetty, the causeway road
  const campY = (x, z) => meshY(x, z);
  const pad = { x: camp.x - 18, z: camp.z - cside * 6 }; pad.y = campY(pad.x, pad.z) + .14;
  parts.push(G.cyl(8.5, 8.8, .3, 28, '#E9E3EA', pad.x, pad.y - .3, pad.z)); parts.push(G.cyl(6.3, 6.3, .04, 28, '#B9B4D6', pad.x, pad.y, pad.z)); parts.push(G.cyl(5.7, 5.7, .06, 28, '#E9E3EA', pad.x, pad.y, pad.z));
  const tents = [], TENT = ['#F2D2B4', '#E7B3B0', '#EDE6EA', '#F6D2B1', '#D9D4E8'];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 3; b++) { const x = camp.x + 2 + a * 9.5, z = camp.z - cside * (2 + b * 8.5) + cside * 4; if (Math.hypot(x - pad.x, z - pad.z) < 13) continue; tents.push({ x, z, y: campY(x, z), a: rr(-.06, .06), c: pick(TENT) }); }
  { const x = camp.x - 14, z = camp.z + cside * 14, y = campY(x, z); for (const [u, v] of [[-5, -3.5], [5, -3.5], [5, 3.5], [-5, 3.5]]) parts.push(G.box(.2, 3.2, .2, '#9C97AB', x + u, y + 1.6, z + v)); parts.push(G.box(11, .25, 8, '#B8B3D4', x, y + 3.3, z)); for (let k = 0; k < 7; k++) parts.push(G.box(1.1, .8, .9, pick(['#E9C7A6', '#D9D3DE', '#C9B79E']), x + rr(-4, 4), y + .4 + (k > 4 ? .8 : 0), z + rr(-3, 3), rr(0, 1))); }
  for (let k = 0; k < 14; k++) { const x = camp.x + rr(-30, -8), z = camp.z + cside * rr(2, 26), y = campY(x, z); parts.push(G.box(1.2, .7, .9, pick(['#E9C7A6', '#D9D3DE', '#C9B79E', '#EFD9C2']), x, y + .35, z, rr(0, 1))); }
  { const x = camp.x + 30, z = camp.z + cside * 18, y = campY(x, z); for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(G.box(.18, 3, .18, '#9C97AB', x + u, y + 1.5, z + v)); parts.push(G.cyl(1.3, 1.3, 1.9, 12, '#4E5068', x, y + 3, z)); }
  { const dx = jetty1.x - jetty0.x, dz = jetty1.z - jetty0.z, L = Math.hypot(dx, dz), a = Math.atan2(dz, dx), n = Math.ceil(L / 3);   // jetty
    for (let k = 0; k < n; k++) { const t = (k + .5) / n, x = jetty0.x + dx * t, z = jetty0.z + dz * t; parts.push(G.box(3.05, .22, 2.6, k % 2 ? '#C9B49A' : '#BFA98F', x, .62, z, -a));
      for (const sg of [-1, 1]) { const px = x - Math.sin(a) * sg * 1.2, pz = z + Math.cos(a) * sg * 1.2, gy = gAt(px, pz); if (k % 2 === 0) { parts.push(G.box(.22, .9 - gy, .22, '#9E8E7E', px, (gy + .9) / 2, pz)); if (gy < 0) ring(px, pz, .5, .5); } } } }
  // causeway road (a pale ribbon draped on the terrain) and the road up the mound
  const ribbon = (pts, w, hex, lift = .06) => {
    const P = [], I = [], c = lin(hex), C = [];
    for (let k = 0; k < pts.length; k++) {
      const [x, z] = pts[k], [xa, za] = pts[Math.max(0, k - 1)], [xb, zb] = pts[Math.min(pts.length - 1, k + 1)], a = Math.atan2(zb - za, xb - xa), nx = -Math.sin(a) * w / 2, nz = Math.cos(a) * w / 2;
      for (const sg of [-1, 1]) { const X = x + nx * sg, Z = z + nz * sg; P.push(X, Math.max(meshY(X, Z), .05) + lift, Z); C.push(c.r, c.g, c.b); }
      if (k) { const o = (k - 1) * 2; I.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
  };
  { const pts = [], P = [[camp.x - 10, camp.z], [cw0.x, cw0.z], [cw1.x, cw1.z], [cw1.x + 90, cw1.z + 12]]; for (let q = 1; q < P.length; q++) { const n = Math.ceil(Math.hypot(P[q][0] - P[q - 1][0], P[q][1] - P[q - 1][1]) / 4); for (let k = q > 1 ? 1 : 0; k <= n; k++) pts.push([lerp(P[q - 1][0], P[q][0], k / n), lerp(P[q - 1][1], P[q][1], k / n)]); } parts.push(ribbon(pts, 5.2, '#CFC5B5')); }
  { const pts = []; for (let t = 0; t <= 1.0001; t += 1 / 12) pts.push([lerp(jetty0.x, pad.x, t), lerp(jetty0.z, pad.z, t)]); parts.push(ribbon(pts, 3, '#D3C8B8')); }
  // the tethered drone's boat (props.boat when present), anchored near the river
  let stationPos = null;
  {
    const pg = propGeo('boat'), root = pg ? props.getObjectByName('boat') : null;
    const local = (name, fb) => { const o = root && root.getObjectByName(name); if (!o) return fb; root.updateMatrixWorld(true); return o.getWorldPosition(V()).applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert()); };
    const M = new THREE.Matrix4(), tmpM = new THREE.Matrix4();
    if (pg) {                                                                     // the props boat, scaled up to a 9 m launch, floating at its waterline
      const bb = pg.boundingBox, long = bb.max.z - bb.min.z > bb.max.x - bb.min.x, L = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), k = 9 / L;
      const wl = local('boat_waterline', V(0, .25 * (bb.max.y - bb.min.y), 0)), dm = local('deck_mount', V(0, bb.max.y * .3, 0));
      M.makeScale(k, k, k); if (long) M.premultiply(tmpM.makeRotationY(Math.PI / 2)); M.premultiply(tmpM.makeTranslation(0, -wl.y * k + .05, 0)); M.premultiply(tmpM.makeRotationY(-station.a)); M.premultiply(tmpM.makeTranslation(station.x, 0, station.z));
      pg.applyMatrix4(M); parts.push(pg); stationPos = dm.clone().applyMatrix4(M); stationPos.y += .02;
    } else {
      const sh = new THREE.Shape(); sh.moveTo(-4.4, -1.5); sh.lineTo(2.4, -1.5); sh.quadraticCurveTo(4.3, -1.2, 4.9, 0); sh.quadraticCurveTo(4.3, 1.2, 2.4, 1.5); sh.lineTo(-4.4, 1.5); sh.quadraticCurveTo(-4.8, 0, -4.4, -1.5);
      const hull = new THREE.ExtrudeGeometry(sh, { depth: 1.3, bevelEnabled: true, bevelThickness: .12, bevelSize: .12, bevelSegments: 1, curveSegments: 5 }); hull.rotateX(-Math.PI / 2); hull.translate(0, -.5, 0);
      const pa = hull.attributes.position; for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); if (y < 0) { const kk = .72 + .28 * (y + .62) / .62; pa.setX(i, pa.getX(i) * (.94 + .06 * kk)); pa.setZ(i, pa.getZ(i) * kk); } } hull.computeVertexNormals();
      const g = merge([paint(hull, '#EBC9A8'), G.box(8.2, .12, 2.6, '#E6E0E6', -.2, .84, 0), G.box(2.4, 1.5, 2.2, '#E4DEE6', -2.6, 1.6, 0), G.box(2.6, .14, 2.4, '#B8B3D4', -2.6, 2.4, 0), G.box(8.9, .16, .16, '#D99A7C', -.2, .9, 1.52), G.box(8.9, .16, .16, '#D99A7C', -.2, .9, -1.52)]);
      M.makeRotationY(-station.a); M.premultiply(tmpM.makeTranslation(station.x, 0, station.z)); g.applyMatrix4(M); parts.push(g); stationPos = V(1.4, .92, 0).applyMatrix4(M);
    }
  }

  const STRUCT = merge(parts); mesh(STRUCT, mats.v, true, true, 'village');
  // tents: ridge tents, instanced
  { const g = new THREE.BufferGeometry(), v = [[-.5, 0, -.5], [.5, 0, -.5], [.5, 0, .5], [-.5, 0, .5], [-.5, 1, 0], [.5, 1, 0]], f = [[0, 4, 5, 1], [2, 5, 4, 3], [1, 5, 2], [3, 4, 0]], P = [];
    for (const q of f) { const tri = q.length === 4 ? [[q[0], q[1], q[2]], [q[0], q[2], q[3]]] : [q]; for (const t of tri) for (const k of t) P.push(...v[k]); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); paint(g, '#ffffff');
    inst(g, mats.v, tents.map((t) => ({ x: t.x, y: t.y - .05, z: t.z, ry: t.a, sx: 3.2, sy: 2.4, sz: 4.4, c: t.c })), { tint: true, name: 'tents' }); }

  // ---------------------------------------------------------------- palms and trees (instanced; props when they fit the budget)
  const palmGeo = (variant) => {
    const H0 = 11, p = [];
    const tr = new THREE.CylinderGeometry(.17, .26, H0, 5, 3, true), pa = tr.attributes.position;
    for (let i = 0; i < pa.count; i++) { const y = pa.getY(i) + H0 / 2, t = y / H0; pa.setY(i, y); pa.setX(i, pa.getX(i) + (variant ? 1.1 : .6) * t * t); }
    tr.computeVertexNormals(); p.push(paint(tr, '#9A8B7E'));
    const tx = variant ? 1.1 : .6, nf = variant ? 8 : 7;
    for (let f = 0; f < nf; f++) {
      const a = f / nf * TAU + (variant ? .3 : 0), L = rr(3.6, 4.6), droop = rr(1.6, 2.6), P = [], I = [], segs = 3;
      for (let s = 0; s <= segs; s++) { const t = s / segs, d = t * L, y = H0 + .5 + 1.2 * t - droop * t * t * 1.4, w = .62 * Math.sin(Math.PI * (.15 + .85 * t)) * (1 - .55 * t) + .05; for (const sg of [-1, 1]) { const ox = Math.cos(a) * d - Math.sin(a) * w * sg, oz = Math.sin(a) * d + Math.cos(a) * w * sg; P.push(tx + ox, y - Math.abs(sg) * w * .25, oz); } if (s) { const o = (s - 1) * 2; I.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
      const nn = g.attributes.normal; for (let i = 0; i < nn.count; i++) { nn.setY(i, Math.abs(nn.getY(i)) + .6); } g.normalizeNormals();
      p.push(paint(g, f % 2 ? '#7C9A74' : '#6C8B68'));
    }
    p.push(xf(paint(new THREE.OctahedronGeometry(.75, 0), '#6E7A5A'), tx, H0 + .2, 0, 0, 0, 0, 1, .7, 1));
    return merge(p);
  };
  const blobGeo = (rx, ry, rz, cx, cy, cz, hex, sd, det = 1) => {
    const g = new THREE.IcosahedronGeometry(1, det), pa = g.attributes.position, N = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), k = 1 + (vn(x * 1.7 + sd, y * 1.7 + z * 1.3, 77) - .5) * .32; N[i * 3] = x; N[i * 3 + 1] = y * .8 + .2; N[i * 3 + 2] = z; pa.setXYZ(i, cx + x * rx * k, cy + y * ry * k * (y < 0 ? .7 : 1), cz + z * rz * k); }
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.normalizeNormals(); return paint(g, hex);
  };
  const broadGeo = (v) => {
    const H0 = v === 2 ? 13 : 9, tr = new THREE.CylinderGeometry(.22, .36, H0 * .62, 5, 1, true); tr.translate(0, H0 * .31, 0);
    const p = [paint(tr, '#86766E')];
    if (v === 2) { p.push(blobGeo(4.2, 3, 4.2, 0, H0 * .7, 0, '#6F8C69', 1.3)); p.push(blobGeo(2.9, 2.4, 2.9, 1.6, H0 * .86, -1, '#7D9A72', 4.1)); }
    else { p.push(blobGeo(3.4, 2.6, 3.4, 0, H0 * .66, 0, v ? '#6A8865' : '#728F6A', v * 3 + 2)); p.push(blobGeo(2.3, 1.9, 2.3, -1.3, H0 * .8, .9, v ? '#7A956F' : '#819C74', v * 5 + 1, 0)); }
    return merge(p);
  };
  // canopy clumps sunk into the hill carpet: a lumpy forest roof for a few triangles each (cast no shadow)
  {
    const list = [], SP = HI ? 11.5 : 15, CC = ['#FFFFFF', '#EEF4E9', '#E2EADF', '#F6F3E4', '#DCE6DA'];
    for (let z = -700; z < 700; z += SP) for (let x = 330; x < 760; x += SP) {
      const jx = x + rr(-4, 4), jz = z + rr(-4, 4), g = gAt(jx, jz); if (g < 2) continue; const c = carpetAt(jx, jz, g); if (c < 1.6) continue;
      const R = rr(5.2, 7.6) * (.8 + c * .05); list.push({ x: jx, y: meshY(jx, jz) - R * .25, z: jz, ry: r() * TAU, sx: R, sy: R * rr(.55, .75), sz: R * rr(.85, 1.1), c: pick(CC) });
    }
    const g0 = blobGeo(1, 1, 1, 0, 0, 0, '#6A8664', 7.7, 0), g1 = blobGeo(1, 1, 1, 0, 0, 0, '#5E7A5C', 2.9, 0);
    inst(g0, mats.v, list.filter((_, i) => i % 2 === 0), { cast: false, tint: true, name: 'clumps' }); inst(g1, mats.v, list.filter((_, i) => i % 2 === 1), { cast: false, tint: true, name: 'clumps' });
  }
  const PALMC = ['#FFFFFF', '#F3F6EE', '#E9EEE6', '#FFF8EC'], TREEC = ['#FFFFFF', '#EEF3E8', '#F7F2E6', '#E6ECE6'];
  const sway = [];                                                               // instanced meshes that sway in update()
  const placeTrees = (list, geos, propName, propLeaf, H0, budget) => {
    let pg = propGeo(propName, woodOrLeaf('#8C7B70', propLeaf)), heroN = 0;
    if (pg) { fitH(pg, H0); heroN = Math.min(list.length, Math.floor(budget / pg.userData.tris)); }
    // the prop replaces the procedural tree for the instances nearest the places the camera visits
    const foci = [camp, town, church, station, ...groups.map((g) => g.h)];
    const order = list.map((t, i) => [Math.min(...foci.map((f) => Math.hypot(f.x - t.x, f.z - t.z))), i]).sort((a, b) => a[0] - b[0]);
    const hero = new Set(order.slice(0, heroN).map((o) => o[1]));
    const out = [];
    for (let v = 0; v < geos.length + (pg ? 1 : 0); v++) {
      const sel = list.filter((t, i) => (v === geos.length ? hero.has(i) : !hero.has(i) && t.v === v));
      if (!sel.length) { if (v === geos.length) pg.dispose(); else geos[v].dispose(); continue; }
      const im = inst(v === geos.length ? pg : geos[v], mats.tree, sel.map((t) => ({ x: t.x, y: t.y - .1, z: t.z, ry: t.a, s: t.s, c: pick(propName === 'tree_palm' ? PALMC : TREEC) })), { tint: true, name: propName });
      im.userData.sway = sel.map((t) => [t.s, t.ph, t.x, t.z]); sway.push(im); out.push(im);
    }
    if (!pg) {} return out;
  };
  placeTrees(palms, [palmGeo(0), palmGeo(1)], 'tree_palm', '#728F6C', 11.5, HI ? 14000 : 6000);
  const hillGeo = (v) => { const H0 = v === 2 ? 14 : 10, tr = new THREE.CylinderGeometry(.22, .36, H0 * .62, 5, 1, true); tr.translate(0, H0 * .31, 0);
    return merge([paint(tr, '#86766E'), blobGeo(3.8, 3, 3.8, 0, H0 * .66, 0, v === 2 ? '#64815F' : '#6E8A66', v * 3 + 1, 0), blobGeo(2.6, 2.2, 2.6, 1.2, H0 * .82, -.8, v === 2 ? '#728E68' : '#7C976F', v * 7 + 2, 0)]); };
  placeTrees(trees, [broadGeo(0), hillGeo(1), hillGeo(2)], 'tree_broad', '#6E8B68', 10, HI ? 9000 : 4000);

  mark('trees3d');
  // ---------------------------------------------------------------- people (heat-coloured clay figures; hidden in the story until found)
  const figGeo = (pose) => {
    const p = [], body = new THREE.CapsuleGeometry(.19, pose === 2 ? .45 : .95, 2, 7); body.translate(0, pose === 2 ? .52 : .66, 0); p.push(paint(body, '#ffffff'));
    const head = new THREE.SphereGeometry(.15, 7, 5); head.translate(0, pose === 2 ? 1.05 : 1.5, 0); p.push(paint(head, '#ffffff'));
    if (pose === 1) { const arm = new THREE.CapsuleGeometry(.055, .6, 2, 5); arm.rotateZ(-.35); arm.translate(.3, 1.62, 0); p.push(paint(arm, '#ffffff')); const arm2 = new THREE.CapsuleGeometry(.055, .6, 2, 5); arm2.rotateZ(.3); arm2.translate(-.32, 1.6, 0); p.push(paint(arm2, '#ffffff')); }
    if (pose === 2) { const legs = new THREE.CapsuleGeometry(.12, .55, 2, 6); legs.rotateX(Math.PI / 2); legs.translate(0, .22, .38); p.push(paint(legs, '#ffffff')); }
    return merge(p);
  };
  const people = [], figs = [[], [], []];
  groups.forEach((gp, gi) => {
    const spots = roofSpots(gp.h, gp.n); let cx = 0, cy = 0, cz = 0;
    for (const s of spots) { figs[s.pose].push({ x: s.x, y: s.y, z: s.z, ry: s.a, s: rr(.92, 1.06), g: gi }); cx += s.x; cy += s.y; cz += s.z; }
    const k = spots.length || 1, h = gp.h;
    const name = h.kind === 'school' ? 'the school roof' : h.kind === 'church' ? 'the church steps' : h.kind === 'annex' ? 'the church annex' : `roof ${h.no}`;
    people.push({ pos: V(cx / k, cy / k, cz / k), layer: 'ground', hidden: true, count: gp.n, kind: h.kind === 'house' ? 'roof' : h.kind, name, roofY: h.roof === 'flat' ? h.top + .25 : h.ridge });
  });
  const peopleGroup = new THREE.Group(); peopleGroup.name = 'people'; group.add(peopleGroup);
  const figMeshes = figs.map((list, pose) => { const im = inst(figGeo(pose), mats.people, list, { cast: true, name: 'people' + pose }); group.remove(im); peopleGroup.add(im); im.userData.base = im.instanceMatrix.array.slice(); im.userData.owner = list.map((f) => f.g); return im; });
  // rescuers at the camp (props.rescuer when present)
  { const pg = propGeo('rescuer'), geo = pg ? fitH(pg, 1.78) : (() => { const g = figGeo(0), c = g.attributes.color, pa = g.attributes.position, a = lin('#EFB98F'), w = lin('#E4DEE6'); for (let i = 0; i < c.count; i++) { const y = pa.getY(i), cc = y > .75 && y < 1.3 ? a : w; c.setXYZ(i, cc.r, cc.g, cc.b); } return g; })();
    const list = []; for (let k = 0; k < 6; k++) { const t = k / 6, x = lerp(jetty0.x, pad.x, t * .8) + rr(-6, 6), z = lerp(jetty0.z, pad.z, t * .8) + rr(-5, 5); list.push({ x, y: campY(x, z), z, ry: r() * TAU }); }
    inst(geo, mats.v, list, { name: 'rescuers' }); }
  // a relief truck on the causeway (props.van when present)
  { const x = lerp(cw0.x, cw1.x, .35), z = lerp(cw0.z, cw1.z, .35), a = Math.atan2(cw1.z - cw0.z, cw1.x - cw0.x), y = meshY(x, z);
    let g = propGeo('van'); if (g) { const bb = g.boundingBox; if (bb.max.z - bb.min.z > bb.max.x - bb.min.x) g.rotateY(Math.PI / 2); fitH(g, 2.6); }
    else g = merge([G.box(5.6, 2.2, 2.3, '#E8E2E8', 0, 1.5, 0), G.box(1.8, 1.7, 2.2, '#E8E2E8', 3.5, 1.25, 0), G.box(.4, .25, 1.6, '#F08A7E', 3.4, 2.2, 0), G.box(5.6, .22, 2.35, '#EFB98F', 0, 1.1, 0), ...[[-1.8, 1], [-1.8, -1], [3.2, 1], [3.2, -1]].map(([u, v]) => xf(paint(new THREE.CylinderGeometry(.45, .45, .3, 10), '#4E5068'), u, .45, v * 1.08, Math.PI / 2, 0, 0))]);
    g.rotateY(-a); g.translate(x, y + .05, z); mesh(g, mats.v, true, true, 'truck'); }
  // power lines
  { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3)); const ls = new THREE.LineSegments(own(g), mats.wire); ls.name = 'wires'; group.add(ls); }

  // ---------------------------------------------------------------- drifting debris (animated in update)
  const drifters = [], driftKinds = [];
  {
    const logG = merge([xf(paint(new THREE.CylinderGeometry(.24, .28, 1, 6), '#8E7C70'), 0, 0, 0, 0, 0, Math.PI / 2)]);
    const boxG = merge([paint(new THREE.BoxGeometry(1, 1, 1), '#ffffff')]);
    const blobG = merge([blobGeo(1, .55, 1, 0, 0, 0, '#ffffff', 3.3, 0)]);
    const lists = [[], [], []];
    const add = (kind, sx, sy, sz, c, river) => {
      let x, z, n = 0; for (let t = 0; t < 60; t++) { x = rr(-460, 380); n = river ? rr(-34, 34) : 0; z = river ? riverZ(x) + n : rr(-460, 460); if (river || (gAt(x, z) < -1 && spaced(x, z, 6) && Math.abs(rdist(x, z)) > 60)) break; }
      const d = { kind, x0: x, z0: z, n, river, sx, sy, sz, c, ph: r() * TAU, sp: river ? rr(1.1, 1.9) : 0, ry: r() * TAU, i: lists[kind].length };
      lists[kind].push({ x, y: 0, z, sx, sy, sz, c }); drifters.push(d);
    };
    for (let k = 0; k < 5; k++) add(0, rr(3, 6), .9, .9, '#ffffff', k < 4);
    add(1, 1.9, .22, .95, '#ECE6EA', true); add(1, 2.2, .07, .45, '#BBA58F', true); add(1, 1.9, .08, .9, '#B58C7C', false); add(1, .7, .7, .7, '#7E95B0', true); add(1, .8, .6, .6, '#A6A1BE', false);
    add(2, 1.2, .9, 1.2, '#C9AE7E', true); add(2, 1.6, .9, 1.3, '#B7A274', false); add(2, .5, .5, .5, '#7E8C5C', true);
    [logG, boxG, blobG].forEach((g, k) => { const im = inst(g, mats.drift, lists[k], { cast: false, tint: true, name: 'debris' + k }); driftKinds.push(im); });
  }

  mark('misc3d');
  // ---------------------------------------------------------------- the water
  const WU = {
    uTime: { value: 0 }, uDepth: { value: depthTex }, uGhost: { value: null },
    uBox: { value: new THREE.Vector4(-HB, -HB, 2 * HB, HN) }, uGBox: { value: new THREE.Vector4(-GB, -GB, 2 * GB, GN) },
    uRiv0: { value: new THREE.Vector4(RZ0, A1, F1, P1) }, uRiv1: { value: new THREE.Vector4(A2, F2, P2, TILT) },
    uShallow: { value: lin('#67869B') }, uDeep: { value: lin('#536B96') }, uSilt: { value: lin('#828F89') }, uSky: { value: lin('#DCE4EE') }, uFoam: { value: lin('#E4EAEE') }, uLine: { value: lin('#C3D0CD') },
  };
  const ghostTex = own(new THREE.CanvasTexture(gcv)); ghostTex.flipY = false; ghostTex.anisotropy = 4; ghostTex.wrapS = ghostTex.wrapT = THREE.ClampToEdgeWrapping; WU.uGhost.value = ghostTex;
  const waterMat = own(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .5, metalness: 0 }));
  const worldPatch = (sh) => {
    Object.assign(sh.uniforms, WU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uTime; uniform sampler2D uDepth, uGhost; uniform vec4 uBox, uGBox, uRiv0, uRiv1; uniform vec3 uShallow, uDeep, uSilt, uSky, uFoam, uLine; varying vec3 vWP;
      float wh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float wn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(wh(i), wh(i + vec2(1., 0.)), f.x), mix(wh(i + vec2(0., 1.)), wh(i + vec2(1., 1.)), f.x), f.y); }
      float wrip(vec2 p, float t){ return .5 * wn(p * .085 + vec2(t * .045, t * .03)) + .32 * wn(p * .21 + vec2(-t * .07, t * .055)) + .18 * wn(p * .5 + vec2(t * .11, -t * .09)); }
      float wripC(vec2 p, float t){ p.x += t * 3.2; return .6 * wn(p * vec2(.07, .16)) + .4 * wn(p * vec2(.19, .42) + vec2(t * .3, 0.)); }
      vec2 wtex(vec2 xz, vec4 b){ return ((xz - b.xy) / b.z * (b.w - 1.) + .5) / b.w; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      float wT = uTime;
      vec2 wxz = vWP.xz;
      float wx = wxz.x;
      float wrz = uRiv0.x + uRiv0.y * sin(wx * uRiv0.z + uRiv0.w) + uRiv1.x * sin(wx * uRiv1.y + uRiv1.z) + uRiv1.w * wx;
      float wsl = uRiv0.y * uRiv0.z * cos(wx * uRiv0.z + uRiv0.w) + uRiv1.x * uRiv1.y * cos(wx * uRiv1.y + uRiv1.z) + uRiv1.w;
      float wn_ = (wxz.y - wrz) / sqrt(1. + wsl * wsl);
      float wcur = exp(-wn_ * wn_ / 2300.);
      float wDepth = texture2D(uDepth, wtex(wxz, uBox)).r * 8.;
      vec2 wgu = (wxz - uGBox.xy) / uGBox.z; float win = step(0., wgu.x) * step(wgu.x, 1.) * step(0., wgu.y) * step(wgu.y, 1.);
      vec3 wg = texture2D(uGhost, wgu).rgb * win;
      float wCam = length(cameraPosition - vWP);
      vec3 wc = mix(uShallow, uDeep, smoothstep(.3, 5.5, wDepth));
      float wsn = wn(wxz * .011 + 3.1) * .65 + wn(wxz * .037 - 1.7) * .35;
      wc = mix(wc, uSilt, clamp(.3 - wDepth * .05 + (wsn - .5) * .5, 0., .42));
      float wDown = smoothstep(.12, .6, abs(normalize(cameraPosition - vWP).y));
      wc = mix(wc, uLine, wg.r * .42 * (.35 + .65 * wDown) * (1. - smoothstep(.8, 5.5, wDepth)));
      float wcl = wn(wxz * .0035 + vec2(wT * .006, wT * .003)) * .7 + wn(wxz * .009 - vec2(wT * .004, 0.)) * .3;
      wc *= .9 + .16 * smoothstep(.3, .75, wcl);
      float ws1 = wn(vec2(wx * .05 + wT * .2, wn_ * .5)), ws2 = wn(vec2(wx * .11 + wT * .48, wn_ * 1.15 + 7.));
      float wstreak = smoothstep(.58, .95, ws1 * .6 + ws2 * .4) * wcur * (1. - smoothstep(500., 1400., wCam));
      float wfn = wn(wxz * .7 + vec2(wT * .4, -wT * .3));
      float wshore = (1. - smoothstep(.02, .28, wDepth)) * (.35 + .4 * wfn);
      float wfoam = max(wg.g * (.5 + .5 * wfn), wshore);
      wfoam += wg.b * smoothstep(.35, .8, wn(vec2(wx * .3 + wT * 1.2, wn_ * .9))) * .9;
      wc = mix(wc, uFoam, clamp(wstreak * .3 + wfoam * .7, 0., .9));
      diffuseColor.rgb = wc;
      float wh0 = wrip(wxz, wT), whx = wrip(wxz + vec2(1., 0.), wT), whz = wrip(wxz + vec2(0., 1.), wT);
      vec2 wgr = vec2(whx - wh0, whz - wh0);
      if (wcur > .03) { vec2 wq = vec2(wx, wn_); float c0 = wripC(wq, wT), cx = wripC(wq + vec2(1., 0.), wT), cz = wripC(wq + vec2(0., 1.), wT); wgr = mix(wgr, vec2(cx - c0, cz - c0) * 1.3, wcur); }
      float wk = 1.5 / (1. + wCam / 220.);
      vec3 wNw = normalize(vec3(-wgr.x * wk, 1., -wgr.y * wk));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal = normalize((viewMatrix * vec4(wNw, 0.)).xyz);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec3 wV = normalize(cameraPosition - vWP); float wf = pow(1. - max(dot(wV, wNw), 0.), 4.); totalEmissiveRadiance += uSky * (wf * .24 + .018) * (1. - wfoam * .5); }`);
  };
  waterMat.onBeforeCompile = worldPatch; waterMat.userData.worldPatch = worldPatch; waterMat.customProgramCacheKey = () => 'liminal-flood-water';
  const water = new THREE.Mesh(own(new THREE.PlaneGeometry(9000, 9000, 60, 60).rotateX(-Math.PI / 2)), waterMat);
  water.receiveShadow = true; water.name = 'water'; water.userData.layer = 'ground'; group.add(water);

  mark('water');
  // ================================================================ the search grid ('ground', 5 m cells)
  const CELL = 5, GX0 = -500, GZ0 = -500, NX = 200, NZ = 200, grid = new Uint8Array(NX * NZ);
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
    const x = GX0 + (i + .5) * CELL, z = GZ0 + (k + .5) * CELL;
    grid[k * NX + i] = !inPoly(x, z) ? 2 : Hat(x, z) > .02 ? 0 : 3;
  }
  const cellOf = (x, z) => { const i = Math.floor((x - GX0) / CELL), k = Math.floor((z - GZ0) / CELL); return i >= 0 && k >= 0 && i < NX && k < NZ ? k * NX + i : -1; };
  const stampRect = (h, v, pad = 0) => {                                        // every cell whose centre is under the footprint
    const ca = Math.cos(h.a), sa = Math.sin(h.a), R = h.rad + CELL;
    for (let z = h.z - R; z <= h.z + R; z += CELL) for (let x = h.x - R; x <= h.x + R; x += CELL) {
      const c = cellOf(x, z); if (c < 0 || grid[c] === 2) continue; const cx = GX0 + (c % NX + .5) * CELL, cz = GZ0 + (Math.floor(c / NX) + .5) * CELL, dx = cx - h.x, dz = cz - h.z;
      if (Math.abs(dx * ca + dz * sa) <= h.l / 2 + pad && Math.abs(-dx * sa + dz * ca) <= h.w / 2 + pad) grid[c] = v;
    }
    const c0 = cellOf(h.x, h.z); if (c0 >= 0 && grid[c0] !== 2) grid[c0] = v;
  };
  for (const h of houses) if (h.kind !== 'church') stampRect(h, 0, 1);
  stampRect({ ...ch, l: ch.l + 6, w: ch.w + 6, rad: 20 }, 0, 0);
  const stampDisk = (x, z, R, v) => { for (let dz = -R - CELL; dz <= R + CELL; dz += CELL) for (let dx = -R - CELL; dx <= R + CELL; dx += CELL) { const c = cellOf(x + dx, z + dz); if (c < 0 || grid[c] === 2) continue; const cx = GX0 + (c % NX + .5) * CELL, cz = GZ0 + (Math.floor(c / NX) + .5) * CELL; if (Math.hypot(cx - x, cz - z) <= R) grid[c] = v; } const c0 = cellOf(x, z); if (c0 >= 0 && grid[c0] !== 2) grid[c0] = v; };
  stampDisk(chTower.x, chTower.z, 3.5, 1); stampDisk(mast.x, mast.z, 2.5, 1); stampDisk(tank.x, tank.z, 3.5, 1);
  for (const hz of hazards) { for (const [x, z] of hz.pts) stampDisk(x, z, 7, 4); hz.cells = []; }
  for (let c = 0; c < grid.length; c++) if (grid[c] === 4) { const x = GX0 + (c % NX + .5) * CELL, z = GZ0 + (Math.floor(c / NX) + .5) * CELL; let best = null, bd = 1e9; for (const hz of hazards) for (const [px, pz] of hz.pts) { const d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; best = hz; } } if (best) best.cells.push(c); }
  const layer = { id: 'ground', y: 0, band: [-1, 8], cell: CELL, x0: GX0, z0: GZ0, nx: NX, nz: NZ, grid, poly: poly.map(([x, z]) => V(x, 0, z)) };

  mark('grid');
  // ================================================================ anchors, camera hints, sky
  const base = V(pad.x, pad.y, pad.z);
  const tether = { station: stationPos, hover: stationPos.clone().add(V(0, 40, 0)), cable: 46 };
  const ja = Math.atan2(jetty1.z - jetty0.z, jetty1.x - jetty0.x), jn = [-Math.sin(ja), Math.cos(ja)];
  const boats = [];                                                             // moored either side of the jetty head, in water at least 1 m deep
  for (let t = 1.6; t > .2 && boats.length < 6; t -= .06) for (const sg of [-1, 1]) { const x = lerp(jetty0.x, jetty1.x, t) + jn[0] * sg * 7, z = lerp(jetty0.z, jetty1.z, t) + jn[1] * sg * 7; if (boats.length < 6 && gAt(x, z) < -1 && boats.every((b) => Math.hypot(b.x - x, b.z - z) > 7.5)) boats.push(V(x, 0, z)); }
  const landing = V(jetty1.x, 0, jetty1.z);
  const hz = hazards.map((h, i) => { const [x, y, z] = poleTop(h.pole), m = h.pts[Math.floor(h.pts.length / 2)] || [x, z]; return { pos: V(m[0], 0, m[1]), poleTop: V(x, y, z), pts: h.pts.map(([a, b]) => V(a, 0, b)), radius: 7, cells: h.cells, kind: 'live line', name: `live line ${i + 1}` }; });
  const pois = { camp: V(camp.x, 3.2, camp.z), pad: base.clone(), jetty: landing.clone(), causeway: V((cw0.x + cw1.x) / 2, .7, (cw0.z + cw1.z) / 2), town: V(town.x, 2, town.z), church: V(church.x, 8, church.z), 'church tower': V(chTower.x, chTower.top, chTower.z),
    bridge: V(bridge.x, 0, bridge.z), river: V(0, 0, riverZ(0)), station: stationPos.clone(), mast: V(mast.x, 34, mast.z), 'water tower': V(tank.x, 15, tank.z) };
  if (school) pois.school = V(school.x, school.top + 1, school.z);
  people.forEach((p) => { pois[p.name] = p.pos.clone(); });
  hz.forEach((h) => { pois[h.name] = h.pos.clone(); });
  const center = V(lerp(camp.x, town.x, .5) * .6, 0, lerp(camp.z, town.z, .5) * .5);
  const look = (tx, ty, tz, dx, dy, dz) => ({ pos: V(tx + dx, ty + dy, tz + dz), target: V(tx, ty, tz) });
  const ph = groups.find((g) => g.h.kind === 'house');
  const camera = {
    wide: look(center.x + 20, 0, center.z - 10, -560, 390, 600),
    top: { pos: V(0, 1350, 1), target: V(0, 0, 0) },
    camp: look(camp.x - 6, 3, camp.z, -95, 48, -cside * 115),
    town: look(town.x, 2, town.z, -150, 115, -rside * 175),
    church: look(church.x, 7, church.z, -60, 34, -rside * 62),
    school: school ? look(school.x, school.top, school.z, -52, 30, -rside * 48) : look(town.x, 2, town.z, -80, 60, 80),
    roof: ph ? look(ph.h.x, ph.h.ridge, ph.h.z, -26, 17, 30) : look(town.x, 2, town.z, -40, 30, 40),
    river: { pos: V(250, 32, riverZ(250) - rside * 50), target: V(-60, 0, riverZ(-60)) },
    station: look(stationPos.x, 2, stationPos.z, -42, 26, -rside * 40),
    hazard: hz.length ? look(hz[0].pos.x, 1, hz[0].pos.z, -36, 22, 38) : look(0, 0, 0, -40, 30, 40),
    low: { pos: V(center.x - 330, 15, center.z + 280), target: V(center.x + 140, 6, center.z - 40) },
  };
  const sky = { top: '#A3ABC6', horizon: '#D3D9E3', fog: '#D3D9E3', fogDensity: .00042, sun: { dir: V(.55, .62, .38).normalize(), color: '#F4E6DE', intensity: 2.1 }, hemi: { sky: '#DDE4EE', ground: '#77808E', intensity: 1.1 } };

  // ================================================================ animation
  const swayCol = [];                                                            // per sway mesh: base column 1 (sx*sy terms)
  for (const im of sway) { const a = im.instanceMatrix.array, n = im.count, b = new Float32Array(n * 3); for (let i = 0; i < n; i++) { b[i * 3] = a[i * 16 + 4]; b[i * 3 + 1] = a[i * 16 + 5]; b[i * 3 + 2] = a[i * 16 + 6]; } swayCol.push(b); }
  let wind = 1, gust = 0;
  const _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _de = new THREE.Euler(), _dp = V(), _ds = V();
  function update(t) {
    WU.uTime.value = t;
    for (let s = 0; s < sway.length; s++) {                                      // shear the trees a little with the breeze
      const im = sway[s], a = im.instanceMatrix.array, b = swayCol[s], info = im.userData.sway, n = im.count, amp = .006 * wind + .02 * gust;
      for (let i = 0; i < n; i++) { const sw = info[i], ph = sw[1], x = sw[2], z = sw[3], k = amp * (Math.sin(t * .8 + ph + x * .01) + .45 * Math.sin(t * 2.1 + ph * 1.7)) , kz = amp * .6 * Math.sin(t * .67 + ph * 1.3 + z * .01), sy = b[i * 3 + 1]; a[i * 16 + 4] = b[i * 3] + k * sy; a[i * 16 + 6] = b[i * 3 + 2] + kz * sy; }
      im.instanceMatrix.needsUpdate = true;
    }
    for (let di = 0; di < drifters.length; di++) {
      const d = drifters[di]; let x = d.x0, z = d.z0, sink = 0;
      if (d.river) { const span = 980; x = d.x0 - d.sp * t; x = ((x + 520) % span + span) % span - 520; z = riverZ(x) + d.n + Math.sin(t * .2 + d.ph) * 2; sink = (1 - smooth(-520, -460, x)) + (1 - smooth(460, 400, x)); }
      else { x += Math.sin(t * .05 + d.ph) * 2.5; z += Math.cos(t * .043 + d.ph) * 2.5; }
      const y = Math.sin(t * 1.3 + d.ph) * .06 - .1 - sink * 1.5, ry = d.ry + (d.river ? Math.sin(t * .1 + d.ph) * .6 : t * .02);
      _de.set(Math.sin(t * 1.1 + d.ph) * .05, ry, Math.cos(t * .9 + d.ph) * .05, 'YXZ'); _dq.setFromEuler(_de); _dm.compose(_dp.set(x, y, z), _dq, _ds.set(d.sx, d.sy, d.sz));
      driftKinds[d.kind].setMatrixAt(d.i, _dm);
    }
    for (let k = 0; k < driftKinds.length; k++) driftKinds[k].instanceMatrix.needsUpdate = true;
  }
  update(0);
  // people visibility: the engine can reveal groups one by one (all visible by default = the truth)
  const showPeople = (gi, on) => { for (const im of figMeshes) { const a = im.instanceMatrix.array, b = im.userData.base, ow = im.userData.owner; for (let i = 0; i < ow.length; i++) if (gi < 0 || ow[i] === gi) for (let k = 0; k < 16; k++) a[i * 16 + k] = on ? b[i * 16 + k] : 0; im.instanceMatrix.needsUpdate = true; } };

  const buildMs = performance.now() - T0;
  return {
    group, sky, layers: [layer], surfaces: [water, terrain],
    anchors: { base, tether, boats, landing, jetty: [V(jetty0.x, .6, jetty0.z), V(jetty1.x, .6, jetty1.z)], people, hazards: hz, decoys: [], ugvRoutes: [], pois, waterLevel: 0,
      river: { centre: Array.from({ length: 53 }, (_, k) => V(-520 + k * 20, 0, riverZ(-520 + k * 20))), halfWidth: 18, currentWidth: 48 },
      flowAt: (x, z, out = [0, 0]) => flow(x, z, out), groundAt: (x, z) => gAt(x, z) },
    bounds: new THREE.Box3(V(-510, -6, -510), V(510, 36, 510)), camera,
    heightAt: (x, z) => Math.max(0, gAt(x, z)), showPeople, peopleGroup,
    setWind(w, g = 0) { wind = w; gust = g; },
    update, stats: { marks: MARK.join(', '), buildMs, houses: houses.length, palms: palms.length, trees: trees.length },
    dispose() { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const d of disposables) if (d.dispose) d.dispose(); },
  };
}

// ---------------------------------------------------------------- seeded helpers
function rng(s) { let a = (s >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash(x, y, s) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vn(x, y, s) { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; }
function fbm(x, y, s, o) { let t = 0, a = .5, n = 0; for (let i = 0; i < o; i++) { t += a * vn(x, y, s + i * 131); n += a; a *= .5; x *= 2.03; y *= 2.03; } return t / n; }

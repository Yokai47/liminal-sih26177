// LIMINAL · Act 4 · mission "forest": "Under the canopy" (a missing trekker), golden late afternoon.
// buildWorld(THREE, { seed, quality, props }) -> world, per ACT4_SPEC.md 5.2. Metres, y up.
//
// About 600 m of hilly forest: a heightmap valley with a stream (flowing west, two small cascades), a trail from the
// trailhead car park that crosses the stream on a footbridge and climbs to a ridge. A layered canopy of instanced trees
// (emergents, broadleaf canopy, conifers on the high ground, a sub-canopy of saplings), gaps, three clearings, logs,
// boulders, ferns. The hills beyond the search area are a sculpted canopy "carpet" with clumps, fading into the haze.
// The stream is a ribbon with its own patched MeshStandardMaterial (flow streaks, ripples, cascade foam, warm sky
// fresnel; the patch is kept in material.userData.worldPatch so an overlay patch can chain it).
// Two searchable layers:
//   'canopy'      (4 m cells): flown above the trees, wide thermal swath. layer.density (0..255) is the crown cover
//                 rasterised from the actual crowns (dense cells see little of the ground); layer.top is the crown
//                 top height per cell, layer.ground the ground height. Classes: 0 searchable, 2 outside, 3 stream.
//   'understorey' (2 m cells): flown between the trunks. Classes: 0 open, 1 trunk / boulder / log, 2 outside,
//                 3 stream. layer.ground per cell.
// For both, y is a nominal height and band is relative to layer.top (canopy) or layer.ground (understorey).
export function buildWorld(THREE, { seed = 1, quality = 'high', props = null } = {}) {
  const T0 = performance.now(), HI = quality !== 'low', TAU = Math.PI * 2, MARK = [], mark = (n) => MARK.push(n + ' ' + Math.round(performance.now() - T0));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x), lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const r = rng(seed * 7919 + 13), rr = (a, b) => a + (b - a) * r(), pick = (a) => a[Math.floor(r() * a.length)];
  const S1 = (seed * 31 + 1) & 1023, S2 = (seed * 57 + 5) & 1023, S3 = (seed * 91 + 9) & 1023, S4 = (seed * 17 + 21) & 1023;
  const lin = (hex) => new THREE.Color(hex);

  // ================================================================ the stream (polyline, flows west; water level rises east)
  const SX0 = -1000, SX1 = 1000, zA = rr(-60, 10), zB = rr(-10, 60);
  const cl = (x) => lerp(zA, zB, (x - SX0) / (SX1 - SX0)) + (fbm(x / 260, 3.3, S3, 3) - .5) * 150;
  const casc = [rr(60, 160), rr(-170, -60)];                                     // two small cascades
  const wYx = (x) => -2 + .011 * (x - SX0) + 1.7 * smooth(casc[0] - 2.5, casc[0] + 2.5, x) + 1.3 * smooth(casc[1] - 2.5, casc[1] + 2.5, x) - 5.3;
  const SP = [], SW = [], SH = [];                                                // points, water level, half width
  for (let x = SX0; x <= SX1; x += 4) {
    const y0 = cl(x), nx = -(cl(x + 3) - cl(x - 3)) / 6, nl = Math.hypot(nx, 1), m = (fbm(x / 75, 5.9, S2 + 7, 2) - .5) * 46;
    const px = x + nx / nl * m, pz = y0 + m / nl; SP.push(px, pz); SW.push(wYx(px)); SH.push(2.1 + 1.6 * vn(x / 40, 1.3, S4));
  }
  const stream = mkLine(SP);
  let NEAR_W = 0, NEAR_HW = 3, LAST_D = 0;
  const streamD = (x, z) => {                                                    // distance, water level and half width at the nearest point
    const da = Math.abs(z - cl(x)) * .97;
    if (da > 200) { NEAR_W = wYx(x); NEAR_HW = 2.9; return (LAST_D = da); }
    LD_T = -1; let d = lineDist(stream, x, z, 260), wy, hw;
    if (LD_T < 0) { d = da; wy = wYx(x); hw = 2.9; } else { wy = atT(SW, LD_T); hw = atT(SH, LD_T); }
    if (da > 150) { const k = smooth(150, 200, da); d = lerp(d, da, k); wy = lerp(wy, wYx(x), k); hw = lerp(hw, 2.9, k); }
    NEAR_W = wy; NEAR_HW = hw; return (LAST_D = d);
  };
  const atT = (A, t) => { const i = clamp(Math.floor(t), 0, A.length - 2), f = clamp(t - i, 0, 1); return A[i] + (A[i + 1] - A[i]) * f; };
  const streamZ = (x) => { let b = 0, bd = 1e9; for (let k = 0; k < SP.length; k += 2) { const d = Math.abs(SP[k] - x); if (d < bd) { bd = d; b = k; } } return SP[b + 1]; };

  // ================================================================ the search polygon, the trailhead, clearings
  const P = [];
  for (let k = 0; k < 18; k++) { const th = (k + rr(-.2, .2)) / 18 * TAU, c = Math.cos(th), s = Math.sin(th), e = 2 / 4.6, j = rr(.93, 1); P.push(Math.sign(c) * Math.pow(Math.abs(c), e) * 284 * j, Math.sign(s) * Math.pow(Math.abs(s), e) * 280 * j); }
  const inPoly = (x, z) => { let c = false; for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) { const xi = P[i], zi = P[i + 1], xj = P[j], zj = P[j + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const side = r() < .5 ? -1 : 1;
  const cp = { z: clamp(cl(-280) + side * rr(80, 115), -200, 200) };
  { let lx = 1e9; for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) { const zi = P[i + 1], zj = P[j + 1]; if ((zi > cp.z) !== (zj > cp.z)) { const x = P[i] + (P[j] - P[i]) * (cp.z - zi) / (zj - zi); if (x < lx) lx = x; } } cp.x = lx - 20; }
  cp.a = rr(-.25, .25);
  const clear = [{ x: cp.x + 26, z: cp.z, rx: 34, rz: 26, home: true }];
  for (let k = 0, t = 0; k < 3 && t < 400; t++) {
    const x = rr(-.6, .85) * 280, z = rr(-.8, .8) * 270;
    if (clear.some((c) => Math.hypot(c.x - x, c.z - z) < 150) || !inPoly(x, z) || Math.abs(z - cl(x)) < 40) continue;
    clear.push({ x, z, rx: rr(20, 32), rz: rr(16, 26) }); k++;
  }
  for (let k = 0; k < 7; k++) { const a = r() * TAU, d = rr(380, 900); clear.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, rx: rr(30, 70), rz: rr(25, 55) }); }

  // ================================================================ terrain height
  function groundRaw(x, z) {
    const d = streamD(x, z), wy = NEAR_W, hw = NEAR_HW;
    let h = d < hw ? wy - .95 * (1 - (d / hw) ** 2) - .05 : wy + .6 * smooth(hw, hw + 3.5, d) + .085 * Math.min(d - hw, 260);
    h += ((fbm(x / 230, z / 230, S1, 3) - .42) * 34 + (fbm(x / 75, z / 75, S2, 2) - .5) * 7) * smooth(8, 110, d);
    const R = Math.max(Math.abs(x), Math.abs(z)); if (R > 380) h += smooth(380, 1300, R) * 55 * fbm(x / 420 + 4, z / 420, S3 + 2, 2);
    return h;
  }
  cp.y = groundRaw(cp.x, cp.z);
  const ground = (x, z) => { let h = groundRaw(x, z); const dc = Math.hypot(x - cp.x, z - cp.z); if (dc < 52) h = lerp(h, cp.y, 1 - smooth(22, 50, dc)); return h; };

  // ================================================================ the trail (Catmull-Rom through control points) and the footbridge
  const cps = [[cp.x - 420, cp.z + 60], [cp.x - 160, cp.z + 20], [cp.x - 30, cp.z], [cp.x + 14, cp.z], [-200, cl(-200) + side * 66], [-115, cl(-115) + side * 30],
    [-40, cl(-40)], [45, cl(45) - side * 42], [140, cl(140) - side * 95], [230, cl(230) - side * 150], [300, cl(300) - side * 205], [420, cl(420) - side * 290], [700, cl(700) - side * 420]];
  const TP = [];
  for (let k = 0; k < cps.length - 1; k++) {
    const p0 = cps[Math.max(0, k - 1)], p1 = cps[k], p2 = cps[k + 1], p3 = cps[Math.min(cps.length - 1, k + 2)], n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3));
    for (let i = 0; i < n; i++) {
      const t = i / n, t2 = t * t, t3 = t2 * t, f = (q0, q1, q2, q3) => .5 * (2 * q1 + (-q0 + q2) * t + (2 * q0 - 5 * q1 + 4 * q2 - q3) * t2 + (-q0 + 3 * q1 - 3 * q2 + q3) * t3);
      const wob = k < 3 ? 0 : (fbm(TP.length * .02, 9.1, S1, 2) - .5) * 10;
      TP.push(f(p0[0], p1[0], p2[0], p3[0]) + wob * .5, f(p0[1], p1[1], p2[1], p3[1]) + wob);
    }
  }
  const trail = mkLine(TP);
  // where the trail crosses the stream: the footbridge
  let bridge = null;
  { let bi = 0, bd = 1e9; for (let k = 0; k < TP.length; k += 2) { const d = lineDist(stream, TP[k], TP[k + 1], 60); if (d < bd) { bd = d; bi = k; } }
    const x = TP[bi], z = TP[bi + 1]; lineDist(stream, x, z, 60); const NEAR_T = LD_T; const a = Math.atan2(TP[Math.min(TP.length - 1, bi + 3)] - TP[Math.max(1, bi - 1)], TP[Math.min(TP.length - 2, bi + 2)] - TP[Math.max(0, bi - 2)]);
    bridge = { x, z, a, wy: atT(SW, NEAR_T), hw: atT(SH, NEAR_T), L: 2 * atT(SH, NEAR_T) + 9 }; bridge.y = bridge.wy + 1.7; }

  // ================================================================ canopy density (what decides where trees stand)
  const canopyF = (x, z, dS, hw, dT) => {
    let d = .3 + .7 * smooth(.32, .56, fbm(x / 120 + 3.1, z / 120 + 7.7, S1 + 11, 3));
    d *= .45 + .55 * smooth(.28, .5, fbm(x / 22, z / 22, S2 + 13, 2));
    for (const c of clear) { const ex = (x - c.x) / c.rx, ez = (z - c.z) / c.rz, e = ex * ex + ez * ez; if (e < 3.4) d *= smooth(.6, 1.6, Math.sqrt(e) + (vn(x / 11, z / 11, S3) - .5) * .5); }
    d *= .15 + .85 * smooth(3, 22, dS - hw);
    d *= .5 + .5 * smooth(1.2, 6, dT);
    return d;
  };
  mark('layout');

  // ================================================================ terrain mesh: 5 m in the play area, coarser outward
  const group = new THREE.Group(); group.name = 'forest-world';
  const disposables = [], own = (x) => { disposables.push(x); return x; };
  const mats = {
    terrain: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })),
    v: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0 })),
    tree: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: 0 })),
    trail: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
    people: own(new THREE.MeshStandardMaterial({ color: lin('#FFC36B'), emissive: lin('#FFB060'), emissiveIntensity: .22, roughness: .8, metalness: 0 })),
  };
  const _c = new THREE.Color();
  let terrain, meshY;
  const carpetAt = (x, z, dS) => { const R = Math.max(Math.abs(x), Math.abs(z)) + 50 * (vn(x / 45, z / 45, S1 + 21) - .5); if (R < 330) return 0; if (dS === undefined) { dS = streamD(x, z) - NEAR_HW; } if (dS < 6) return 0; const far = smooth(366, 396, Math.max(Math.abs(x), Math.abs(z))); return smooth(330, 400, R) * smooth(6, 20, dS) * (11 + (1 - far) * 13 * Math.max(0, fbm(x / 19, z / 19, S3 + 5, 2) - .28) + far * 10 * fbm(x / 70, z / 70, S3 + 6, 2)); };
  const TA = -384, TB = 384, TS = HI ? 6 : 8;
  {
    const xs = [], zs = []; for (let x = TA; x <= TB + .01; x += TS) xs.push(x);
    const grow = (arr, from, sgn) => { for (let d = TS * 1.28, x = from; Math.abs(x) < 2000; d *= 1.28) { x += sgn * d; sgn < 0 ? arr.unshift(x) : arr.push(x); } };
    grow(xs, xs[0], -1); grow(xs, xs[xs.length - 1], 1); zs.push(...xs);
    const i0 = xs.indexOf(TA), NX = xs.length, NZ = zs.length, Pp = new Float32Array(NX * NZ * 3), C = new Float32Array(NX * NZ * 3), Y = new Float32Array(NX * NZ);
    const DEN = new Float32Array(NX * NZ), DS = new Float32Array(NX * NZ);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const x = xs[i], z = zs[j], k = j * NX + i, h = ground(x, z), dS = LAST_D, hw = NEAR_HW;
      Y[k] = dS < hw + 2.6 ? Math.min(h, NEAR_W - .3) : h; DS[k] = dS - hw;
      DEN[k] = Math.abs(x) < 400 && Math.abs(z) < 400 ? canopyF(x, z, dS, hw, lineDist(trail, x, z, 30)) : .9;
    }
    // the far forest: a sculpted canopy carpet (the play area keeps real trees)
    const CP = new Float32Array(NX * NZ); for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i; CP[k] = carpetAt(xs[i], zs[j], DS[k]); Y[k] += CP[k]; }
    const cLit = lin('#746D60'), cMoss = lin('#5E6E50'), cGrass = lin('#9DA36C'), cGrass2 = lin('#8A985E'), cBank = lin('#A2978A'), cRock = lin('#A59C9E'), cCan = lin('#45604A'), cCan2 = lin('#7F9763'), cGravel = lin('#B9AF9E'), tmp = new THREE.Color();
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i, x = xs[i], z = zs[j], y = Y[k], c = CP[k], den = DEN[k];
      const dx = xs[Math.min(NX - 1, i + 1)] - xs[Math.max(0, i - 1)], dz = zs[Math.min(NZ - 1, j + 1)] - zs[Math.max(0, j - 1)];
      const sl = Math.hypot((Y[j * NX + Math.min(NX - 1, i + 1)] - Y[j * NX + Math.max(0, i - 1)]) / dx, (Y[Math.min(NZ - 1, j + 1) * NX + i] - Y[Math.max(0, j - 1) * NX + i]) / dz);
      const n = vn(x / 14, z / 14, S4 + 3);
      tmp.copy(cGrass).lerp(cGrass2, n); tmp.lerp(cLit, smooth(.35, .7, den)); tmp.lerp(cMoss, smooth(.6, .9, den) * (.3 + .5 * vn(x / 40, z / 40, S1 + 5)));
      tmp.lerp(cRock, smooth(.55, 1.1, sl) * .55); tmp.lerp(cBank, 1 - smooth(.5, 4, DS[k]));
      if (c > 0) { _c.copy(cCan).lerp(cCan2, smooth(12, 19, c) * (.45 + .55 * vn(x / 60, z / 60, S2 + 8))); tmp.lerp(_c, smooth(1, 6, c)); }
      const dc = Math.hypot(x - cp.x, z - cp.z); tmp.lerp(cGravel, 1 - smooth(14, 22, dc));
      Pp[k * 3] = x; Pp[k * 3 + 1] = y; Pp[k * 3 + 2] = z; C[k * 3] = tmp.r; C[k * 3 + 1] = tmp.g; C[k * 3 + 2] = tmp.b;
    }
    const idx = []; for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) { const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(Pp, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setIndex(idx); g.computeVertexNormals();
    terrain = new THREE.Mesh(own(g), mats.terrain); terrain.receiveShadow = true; terrain.name = 'terrain'; terrain.userData.layer = 'understorey'; group.add(terrain);
    meshY = (x, z) => {
      if (x < TA || x >= xs[i0 + Math.round((TB - TA) / TS)] || z < TA || z >= xs[i0 + Math.round((TB - TA) / TS)]) return ground(x, z) + carpetAt(x, z);
      let fx = (x - TA) / TS, fz = (z - TA) / TS; const i = fx | 0, j = fz | 0; fx -= i; fz -= j;
      const o = (i0 + j) * NX + i0 + i, a = Y[o], b = Y[o + 1], c = Y[o + NX], d = Y[o + NX + 1];
      return fx + fz < 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
    };
  }
  mark('terrain');

  // ================================================================ geometry kit
  function xf(g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) { g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz))); return g; }
  function paint(g, hex) { const c = typeof hex === 'string' ? lin(hex) : hex, n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
  const box = (w, h, d, c, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) => xf(paint(new THREE.BoxGeometry(w, h, d), c), x, y, z, rx, ry, rz);
  function merge(geos) {
    let nv = 0, ni = 0; for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const Pq = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let ov = 0, oi = 0;
    for (const g of geos) {
      const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color, cnt = p.count;
      const cp3 = (a, D) => { if (!a.isInterleavedBufferAttribute && !a.normalized && a.itemSize === 3 && a.array.length === cnt * 3) D.set(a.array, ov * 3); else for (let i = 0; i < cnt; i++) { const o = (ov + i) * 3; D[o] = a.getX(i); D[o + 1] = a.getY(i); D[o + 2] = a.getZ(i); } };
      cp3(p, Pq); if (n) cp3(n, N); if (c) cp3(c, C); else C.fill(1, ov * 3, (ov + cnt) * 3);
      if (g.index) { const ix = g.index.array, m = g.index.count; for (let i = 0; i < m; i++) I[oi + i] = ix[i] + ov; oi += m; } else { for (let i = 0; i < cnt; i++) I[oi + i] = ov + i; oi += cnt; }
      ov += cnt; g.dispose();
    }
    const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(Pq, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('color', new THREE.BufferAttribute(C, 3)); out.setIndex(new THREE.BufferAttribute(I, 1));
    out.computeBoundingSphere(); out.computeBoundingBox(); return out;
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = V(), _s = V();
  function inst(geo, mat, list, { cast = true, receive = true, name = '', tint = false } = {}) {
    const im = new THREE.InstancedMesh(own(geo), mat, Math.max(1, list.length)); im.count = list.length; im.name = name;
    list.forEach((o, i) => { _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'); _q.setFromEuler(_e); _m.compose(_p.set(o.x, o.y, o.z), _q, _s.set(o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1)); im.setMatrixAt(i, _m); if (tint) im.setColorAt(i, _c.set(o.c || '#ffffff')); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = cast; im.receiveShadow = receive; im.computeBoundingSphere(); group.add(im); return im;
  }
  function propGeo(name, colorOf) {
    const root = props && props.getObjectByName ? props.getObjectByName(name) : null; if (!root) return null;
    root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), parts = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const src = o.geometry, pa = src.attributes.position, na = src.attributes.normal, n = pa.count, g = new THREE.BufferGeometry(), Pq = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { Pq[i * 3] = pa.getX(i); Pq[i * 3 + 1] = pa.getY(i); Pq[i * 3 + 2] = pa.getZ(i); }
      g.setAttribute('position', new THREE.BufferAttribute(Pq, 3));
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
  const fitH = (geo, h) => { const bb = geo.boundingBox, k = h / Math.max(.01, bb.max.y - bb.min.y); geo.scale(k, k, k); geo.translate(0, -bb.min.y * k, 0); geo.computeBoundingBox(); geo.computeBoundingSphere(); return geo; };
  const lengthAlongX = (geo) => { const bb = geo.boundingBox; if (bb.max.z - bb.min.z > bb.max.x - bb.min.x) { geo.rotateY(Math.PI / 2); geo.computeBoundingBox(); } return geo; };
  const blobGeo = (rx, ry, rz, cx, cy, cz, hex, sd, det = 1, flat = .7, lump = .34) => {
    const g = new THREE.IcosahedronGeometry(1, det), pa = g.attributes.position, N = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), k = 1 + (vn(x * 1.7 + sd, y * 1.7 + z * 1.3, 77) - .5) * lump; N[i * 3] = x; N[i * 3 + 1] = y * .8 + .25; N[i * 3 + 2] = z; pa.setXYZ(i, cx + x * rx * k, cy + y * ry * k * (y < 0 ? flat : 1), cz + z * rz * k); }
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.normalizeNormals(); return paint(g, hex);
  };
  const trunkGeo = (r0, r1, h, hex, seg = 6, lean = 0) => { const g = new THREE.CylinderGeometry(r1, r0, h, seg, lean ? 2 : 1, true); g.translate(0, h / 2, 0); if (lean) { const pa = g.attributes.position; for (let i = 0; i < pa.count; i++) { const t = pa.getY(i) / h; pa.setX(i, pa.getX(i) + lean * t * t); } g.computeVertexNormals(); } return paint(g, hex); };

  // ================================================================ trees: placement
  const BARK = '#7E6A62', BARK2 = '#8C7A70';
  const trees = [], under = [], tgrid = new Map(), hk = (i, j) => (i + 512) * 4096 + j + 512;
  const tput = (x, z, rad) => { const k = hk(Math.floor(x / 16), Math.floor(z / 16)); if (!tgrid.has(k)) tgrid.set(k, []); tgrid.get(k).push([x, z, rad]); };
  const tfree = (x, z, rad) => { const gi = Math.floor(x / 16), gj = Math.floor(z / 16); for (let j = gj - 1; j <= gj + 1; j++) for (let i = gi - 1; i <= gi + 1; i++) { const L = tgrid.get(hk(i, j)); if (L) for (const p of L) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < (rad + p[2]) ** 2) return false; } return true; };
  // the trekker (by the stream, as far from the trailhead as the stream goes inside the search area), a deer, a warm rock
  const deep = (x, z, m) => inPoly(x, z) && inPoly(x - m, z) && inPoly(x + m, z) && inPoly(x, z - m) && inPoly(x, z + m);
  let trek = null;
  { let best = -1; const cand = [];
    for (let k = 2; k < SP.length - 2; k += 2) { const x = SP[k], z = SP[k + 1]; if (!deep(x, z, 60)) continue; const d = Math.hypot(x - cp.x, z - cp.z); cand.push([d, k]); best = Math.max(best, d); }
    const far = cand.filter(([d]) => d > best * .75); const [, k] = far.length ? pick(far) : [0, ((SP.length / 4) | 0) * 2];
    const x = SP[k], z = SP[k + 1], a = Math.atan2(SP[k + 3] - SP[k - 1], SP[k + 2] - SP[k - 2]) + (r() < .5 ? 1 : -1) * Math.PI / 2, off = rr(13, 19), ti = k / 2;
    trek = { x: x + Math.cos(a) * off, z: z + Math.sin(a) * off, face: a + Math.PI, wy: SW[ti] };
    if (!deep(trek.x, trek.z, 20)) { trek.x = x - Math.cos(a) * off; trek.z = z - Math.sin(a) * off; trek.face = a; }
    trek.y = ground(trek.x, trek.z); }
  const fromBase = (x, z) => Math.hypot(x - cp.x, z - cp.z), farT = fromBase(trek.x, trek.z);
  const spotIn = (lo, hi, avoid, open) => {
    if (open) for (const c of clear) if (!c.home && deep(c.x, c.z, 30) && fromBase(c.x, c.z) > lo * farT && fromBase(c.x, c.z) < hi * farT && avoid.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 120)) return { x: c.x + rr(-.25, .25) * c.rx, z: c.z + rr(-.25, .25) * c.rz };
    for (let t = 0; t < 2000; t++) { const x = rr(-.85, .85) * 280, z = rr(-.85, .85) * 270; const d = fromBase(x, z); if (!deep(x, z, 25) || d < lo * farT || d > hi * farT || !avoid.every((o) => Math.hypot(o.x - x, o.z - z) > 120)) continue; const dS = lineDist(stream, x, z, 60); if (dS < 25) continue; if (!open || canopyF(x, z, dS, 3, lineDist(trail, x, z, 30)) < .45) return { x, z }; }
    return { x: rr(-60, 60), z: rr(-60, 60) };
  };
  const deer = spotIn(.25, .7, [trek], true), rock = spotIn(.35, .9, [trek, deer], true);
  deer.y = ground(deer.x, deer.z); rock.y = ground(rock.x, rock.z); deer.a = r() * TAU;
  clear.push({ x: rock.x, z: rock.z, rx: 13, rz: 11 });                         // the warm rock sits in the sun
  tput(trek.x, trek.z, 3); tput(deer.x, deer.z, 3); tput(rock.x, rock.z, 4);
  // canopy, emergent and conifer trees on a jittered grid, thinned by the canopy density
  const STEP = HI ? 16.5 : 19.5;
  for (let z = -362; z < 362; z += STEP) for (let x = -362; x < 362; x += STEP) {
    const jx = x + rr(-5, 5), jz = z + rr(-5, 5); if (Math.max(Math.abs(jx), Math.abs(jz)) + 30 * (vn(jx / 45, jz / 45, S1 + 21) - .5) > 348) continue;
    const dS = lineDist(stream, jx, jz, 60), hw = atT(SH, LD_T), wy = atT(SW, LD_T), dT = lineDist(trail, jx, jz, 30);
    const den = canopyF(jx, jz, dS, hw, dT);
    if (dS < hw + 6.5 || dT < 2.6 || Math.hypot(jx - cp.x, jz - cp.z) < 24 || Math.hypot(jx - bridge.x, jz - bridge.z) < 12) continue;
    if (r() > den * 1.5) continue;
    const g = ground(jx, jz), hi = g - wy, ridge = smooth(14, 24, hi) * smooth(.4, .6, fbm(jx / 90, jz / 90, S4 + 4, 2));
    const kind = r() < ridge * .9 ? 2 : r() < .075 ? 1 : 0;                      // 0 broadleaf canopy, 1 emergent, 2 conifer
    const s = kind === 1 ? rr(1.05, 1.25) : rr(.9, 1.22), rad = kind === 2 ? .38 * s : kind === 1 ? .75 * s : .5 * s;
    if (!tfree(jx, jz, rad + 2.5)) continue;
    trees.push({ x: jx, z: jz, y: g, s, kind, rad, a: r() * TAU, v: r() < .955 ? Math.floor(r() * 4) : 4 + Math.floor(r() * 2), ph: r() * TAU }); tput(jx, jz, rad);
  }
  // sub-canopy saplings and young trees between the big ones
  for (let t = 0; t < (HI ? 1100 : 650); t++) {
    const x = rr(-345, 345), z = rr(-345, 345), dS = lineDist(stream, x, z, 40), hw = atT(SH, LD_T); if (dS < hw + 1.5 || lineDist(trail, x, z, 10) < 2.2 || Math.hypot(x - cp.x, z - cp.z) < 22) continue;
    const den = canopyF(x, z, dS, hw, 30); if (den < .25 || r() > .55) continue; if (!tfree(x, z, 1.4)) continue;
    under.push({ x, z, kind: 1 }); tput(x, z, .15);
  }
  mark('trees');

  // ================================================================ trees: geometry (vertex coloured variants) and instancing
  const CROWNS = ['#6A895F', '#5D7C59', '#779361', '#6E8E60', '#9C9A6C', '#9E8B78'];  // greens, then two muted turning crowns
  const CSH = [[9.8, 6, 9.8], [8.4, 7.4, 8.8], [10.6, 5.2, 10], [9.2, 6.6, 8.6], [9.6, 6, 9.6], [9, 6.4, 9.4]];
  const broadGeo = (v) => { const H0 = 22, p = [trunkGeo(.6, .36, H0 * .6, v % 2 ? BARK : BARK2, 5)], a = v * 1.7, [cx, cy, cz] = CSH[v];
    p.push(blobGeo(cx, cy, cz, 0, H0 * .7 + (cy - 6) * .5, 0, CROWNS[v], v * 3.1 + 1, 1, .5, .3));
    if (v % 2) p.push(blobGeo(4.6, 3.4, 4.6, Math.cos(a) * 4.6, H0 * .78, Math.sin(a) * 4.6, CROWNS[v < 4 ? (v + 1) % 4 : v], v * 5.3 + 2, 0, .7)); return merge(p); };
  const emergGeo = (v) => { const H0 = 33, p = [trunkGeo(.75, .42, H0 * .7, BARK2, 7, v ? 1 : -.8)];
    p.push(blobGeo(9, 5.5, 9, 0, H0 * .78, 0, v ? '#6F8C5C' : '#7B9563', 7.3 + v, 1, .5)); p.push(blobGeo(5.5, 4, 5.5, 3, H0 * .9, -2, v ? '#7D9866' : '#86A06B', 2.2 + v, 0, .6)); p.push(blobGeo(5, 3.4, 5, -4, H0 * .74, 3, '#647F55', 4.4 + v, 0)); return merge(p); };
  const conGeo = (v) => { const H0 = 24, p = [trunkGeo(.38, .22, H0 * .9, BARK, 6)];
    for (let k = 0; k < 4; k++) { const y = H0 * (.3 + k * .17), R = 4.3 * (1 - k * .2), g = new THREE.ConeGeometry(R, H0 * .3, 7, 1, true); g.translate(0, y + H0 * .15, 0); p.push(paint(g, v ? '#4E6B52' : '#567459')); } return merge(p); };
  const sapGeo = (v) => merge([trunkGeo(.12, .08, v ? 7 : 4.5, BARK2, 4), blobGeo(v ? 2.4 : 1.7, v ? 2 : 1.5, v ? 2.4 : 1.7, 0, v ? 6.2 : 4, 0, v ? '#7E9963' : '#8AA26A', v * 2.7 + 3, 0, .8)]);
  const sway = [];
  const forest = (list, geos, propName, propH, budget, cast = true, label = '') => {
    const pg = propName ? propGeo(propName, woodOrLeaf('#7E6A62', propName === 'tree_conifer' ? '#567459' : '#6E8B5E')) : null; let heroN = 0;
    if (pg) { fitH(pg, propH); heroN = Math.min(list.length, Math.floor(budget / pg.userData.tris)); }
    const foci = [cp, trek, deer, rock, bridge];
    const order = heroN ? list.map((t, i) => [Math.min(...foci.map((f) => Math.hypot(f.x - t.x, f.z - t.z))), i]).sort((a, b) => a[0] - b[0]) : [];
    const hero = new Set(order.slice(0, heroN).map((o) => o[1]));
    for (let v = 0; v <= geos.length; v++) {
      const isP = v === geos.length; if (isP && !pg) break;
      const sel = list.filter((t, i) => (isP ? hero.has(i) : !hero.has(i) && t.v % geos.length === v));
      if (!sel.length) { (isP ? pg : geos[v]).dispose(); continue; }
      const im = inst(isP ? pg : geos[v], mats.tree, sel.map((t) => ({ x: t.x, y: t.y - .3, z: t.z, ry: t.a, s: t.s, c: pick(['#FFFFFF', '#F4F7EC', '#FFF6E8', '#EEF3EA']) })), { tint: true, cast, name: propName || label || 'saplings' });
      im.userData.sway = sel.map((t) => [t.s, t.ph, t.x, t.z]); sway.push(im);
      if (propName === 'tree_broad' || label === 'emergent') { im.userData.layer = 'canopy'; crownMeshes.push(im); }
    }
  };
  const crownMeshes = [];
  forest(trees.filter((t) => t.kind === 0), [0, 1, 2, 3, 4, 5].map(broadGeo), 'tree_broad', 22, HI ? 6000 : 3000);
  forest(trees.filter((t) => t.kind === 1), [emergGeo(0), emergGeo(1)], null, 0, 0, true, 'emergent');
  forest(trees.filter((t) => t.kind === 2), [conGeo(0), conGeo(1)], 'tree_conifer', 24, HI ? 5000 : 2000);
  const saps = under.filter((u) => u.kind === 1).map((u) => ({ ...u, y: ground(u.x, u.z), s: rr(.8, 1.25), a: r() * TAU, v: Math.floor(r() * 2), ph: r() * TAU }));
  forest(saps, [sapGeo(0), sapGeo(1)], null, 0, 0, false);
  mark('trees3d');

  // ================================================================ understorey: ferns, bushes, logs, boulders; canopy clumps beyond
  const parts = [];
  {
    const fern = (() => { const p = []; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU, g = new THREE.PlaneGeometry(.5, 1.5, 1, 1); g.translate(0, .75, 0); const pa = g.attributes.position; for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); pa.setZ(i, -y * y * .22); } g.rotateX(-1.0); g.rotateY(a); g.computeVertexNormals(); p.push(paint(g, k % 2 ? '#6F8A55' : '#7E9860')); } return merge(p); })();
    const bush = merge([blobGeo(1.2, .8, 1.1, 0, .6, 0, '#6C8758', 1.1, 0), blobGeo(.8, .6, .8, .7, .8, .3, '#7A945F', 2.2, 0)]);
    const fl = [], bl = [];
    for (let t = 0; t < (HI ? 1700 : 1000); t++) {
      const x = rr(-340, 340), z = rr(-340, 340), dS = lineDist(stream, x, z, 30), hw = atT(SH, LD_T); if (dS < hw + .8 || lineDist(trail, x, z, 6) < 1.4 || Math.hypot(x - cp.x, z - cp.z) < 20 || Math.hypot(x - bridge.x, z - bridge.z) < 6) continue;
      const den = canopyF(x, z, dS, hw, 30), y = meshY(x, z);
      if (dS < hw + 9 ? r() < .55 : r() < den * .6) fl.push({ x, y: y - .05, z, ry: r() * TAU, s: rr(.7, 1.4), c: pick(['#FFFFFF', '#EEF2E2', '#F6F1DE']) });
      else if (r() < .35) bl.push({ x, y: y - .1, z, ry: r() * TAU, s: rr(.8, 1.6), c: pick(['#FFFFFF', '#EEF2E2', '#F2EEDD']) });
    }
    inst(fern, mats.tree, fl, { cast: false, tint: true, name: 'ferns' });
    // the prop bush (when present) for the few bushes nearest the trailhead and the trekker, procedural for the rest
    let pb = propGeo('bush', () => lin('#6C8758')); const nb = pb ? Math.min(bl.length, Math.floor((HI ? 6000 : 2400) / pb.userData.tris)) : 0;
    if (pb) { fitH(pb, 1.4); bl.sort((a, b) => Math.min(Math.hypot(a.x - cp.x, a.z - cp.z), Math.hypot(a.x - trek.x, a.z - trek.z)) - Math.min(Math.hypot(b.x - cp.x, b.z - cp.z), Math.hypot(b.x - trek.x, b.z - trek.z))); inst(pb, mats.tree, bl.slice(0, nb), { cast: false, tint: true, name: 'bushes' }); }
    inst(bush, mats.tree, bl.slice(nb), { cast: false, tint: true, name: 'bushes' });
    mats.tree.side = THREE.DoubleSide;
  }
  const logs = [], rocks = [];
  for (let t = 0; t < 200 && logs.length < (HI ? 34 : 22); t++) {
    const x = rr(-300, 300), z = rr(-300, 300), dS = lineDist(stream, x, z, 30), hw = atT(SH, LD_T), L = rr(6, 13), a = r() * TAU;
    if (dS < hw + 4 || lineDist(trail, x, z, 12) < 6 || !tfree(x, z, L / 2) || canopyF(x, z, dS, hw, 30) < .35) continue;
    const rad = rr(.28, .5), y0 = meshY(x - Math.cos(a) * L / 2, z - Math.sin(a) * L / 2), y1 = meshY(x + Math.cos(a) * L / 2, z + Math.sin(a) * L / 2);
    const g = trunkGeo(rad, rad * .85, L, '#7C6C62', 7); g.rotateZ(-Math.PI / 2); g.translate(-L / 2, 0, 0); g.rotateZ(Math.atan2(y1 - y0, L)); g.rotateY(-a); g.translate(x, (y0 + y1) / 2 + rad * .55, z);
    parts.push(g); parts.push(xf(paint(new THREE.CircleGeometry(rad * .85, 7), '#C2A88C'), x + Math.cos(a) * L / 2, y1 + rad * .55, z + Math.sin(a) * L / 2, 0, -a + Math.PI / 2, 0));
    logs.push({ x, z, a, L, rad }); tput(x, z, 1);
  }
  const addRock = (x, z, R, hex = '#A39C9E', sink = .35) => { const y = meshY(x, z); rocks.push({ x, y: y - R * sink, z, R, c: hex, ry: r() * TAU, sx: R * rr(.9, 1.3), sy: R * rr(.55, .85), sz: R * rr(.8, 1.1) }); };
  for (const c of clear) if (Math.abs(c.x) < 340 && Math.abs(c.z) < 340 && !c.home) for (let k = 0; k < 6; k++) { const a = r() * TAU, q = Math.sqrt(r()) * 1.1, x = c.x + Math.cos(a) * c.rx * q, z = c.z + Math.sin(a) * c.rz * q; if (Math.hypot(x - rock.x, z - rock.z) > 8 && Math.hypot(x - deer.x, z - deer.z) > 6) addRock(x, z, rr(.6, 1.6)); }
  for (let k = 0; k < (HI ? 110 : 60); k++) { const t = rr(4, SP.length / 2 - 4) | 0, x = SP[t * 2], z = SP[t * 2 + 1]; if (Math.abs(x) > 340 || Math.abs(z) > 340) continue; const a = r() * TAU, d = SH[t] * rr(.2, 2.2); addRock(x + Math.cos(a) * d, z + Math.sin(a) * d, rr(.5, 1.4), pick(['#9E9799', '#A8A09C', '#948F96']), .45); }
  for (let k = 0; k < 40; k++) { const x = rr(-330, 330), z = rr(-330, 330); if (lineDist(trail, x, z, 8) > 3 && lineDist(stream, x, z, 8) > 6) addRock(x, z, rr(.8, 2.4)); }
  addRock(rock.x, rock.z, 3.3, '#C2AE9E', .3); const rockR = rocks[rocks.length - 1]; rockR.sx = 4.4; rockR.sy = 2.6; rockR.sz = 3.6;
  inst(merge([blobGeo(1, 1, 1, 0, 0, 0, '#ffffff', 5.5, 0, .9)]), mats.v, rocks.slice(0, -1), { tint: true, name: 'rocks' });
  inst(merge([blobGeo(1, 1, 1, 0, 0, 0, '#ffffff', 8.5, 1, .9, .22)]), mats.v, rocks.slice(-1), { tint: true, name: 'warm rock' });
  mark('under');

  // ================================================================ the trailhead: car park, cars, van, hut, sign, rescuers; trail; footbridge
  {
    const ca = Math.cos(cp.a), sa = Math.sin(cp.a), at = (u, v) => [cp.x + ca * u - sa * v, cp.z + sa * u + ca * v];
    const sh = new THREE.Shape(); const W2 = 18, D2 = 12, rc = 5; sh.moveTo(-W2 + rc, -D2); sh.lineTo(W2 - rc, -D2); sh.quadraticCurveTo(W2, -D2, W2, -D2 + rc); sh.lineTo(W2, D2 - rc); sh.quadraticCurveTo(W2, D2, W2 - rc, D2); sh.lineTo(-W2 + rc, D2); sh.quadraticCurveTo(-W2, D2, -W2, D2 - rc); sh.lineTo(-W2, -D2 + rc); sh.quadraticCurveTo(-W2, -D2, -W2 + rc, -D2);
    const pad = new THREE.ShapeGeometry(sh, 4); pad.rotateX(Math.PI / 2); pad.rotateY(-cp.a); pad.translate(cp.x, cp.y + .07, cp.z); parts.push(paint(pad, '#C3B9AA'));
    for (let k = 0; k < 6; k++) { const [x, z] = at(-14 + k * 4.2, -5.5); parts.push(box(.14, .02, 4.6, '#E6DED6', x, cp.y + .09, z, -cp.a)); }
    const CARS = ['#B98480', '#8FA0B3', '#D9D3DE', '#A6A1BE'];
    for (const [k, c] of [[0, 0], [2, 1], [3, 2]]) { const [x, z] = at(-12 + k * 4.2, -7.6), g = merge([box(1.85, .8, 4.3, CARS[c], 0, .6, 0), box(1.65, .66, 2.3, CARS[c], 0, 1.33, -.2), ...[[-.8, 1.3], [.8, 1.3], [-.8, -1.3], [.8, -1.3]].map(([u, v]) => xf(paint(new THREE.CylinderGeometry(.34, .34, .24, 8), '#4E5068'), u, .34, v, 0, 0, Math.PI / 2))]); g.rotateY(-cp.a + rr(-.05, .05)); g.translate(x, cp.y + .05, z); parts.push(g); }
    { let g = propGeo('van'); if (g) g = fitH(g, 2.8); else g = merge([box(2.2, 2.3, 5.8, '#E8E2E8', 0, 1.55, 0), box(2.2, .25, 5.8, '#EFB98F', 0, 1.1, 0), box(1.5, .2, .4, '#F08A7E', 0, 2.8, 1.4), ...[[-1, 1.8], [1, 1.8], [-1, -1.8], [1, -1.8]].map(([u, v]) => xf(paint(new THREE.CylinderGeometry(.42, .42, .3, 10), '#4E5068'), u, .42, v, 0, 0, Math.PI / 2))]);
      const [x, z] = at(6, 4.5); g.rotateY(-cp.a + Math.PI / 2 + .1); g.translate(x, cp.y + .05, z); const vm = new THREE.Mesh(own(g), mats.v); vm.castShadow = vm.receiveShadow = true; vm.name = 'van'; group.add(vm); }
    { const [x, z] = at(-12, 8.5); parts.push(box(5, 3, 4, '#D9CFC4', x, cp.y + 1.5, z, -cp.a)); const g = new THREE.BufferGeometry(), vv = [[-.5, 0, -.5], [.5, 0, -.5], [.5, 0, .5], [-.5, 0, .5], [-.5, 1, 0], [.5, 1, 0]], f = [[0, 4, 5, 1], [2, 5, 4, 3], [1, 5, 2], [3, 4, 0]], Pq = [];
      for (const q of f) { const tri = q.length === 4 ? [[q[0], q[1], q[2]], [q[0], q[2], q[3]]] : [q]; for (const tt of tri) for (const kk of tt) Pq.push(...vv[kk]); }
      g.setAttribute('position', new THREE.Float32BufferAttribute(Pq, 3)); g.computeVertexNormals(); paint(g, '#9C7F78'); parts.push(xf(g, x, cp.y + 3, z, 0, -cp.a, 0, 6, 1.8, 4.8)); parts.push(box(1, 1.9, .12, '#6E5A58', ...at(-12, 6.45).flatMap((v, i) => (i ? [cp.y + .95, v] : [v])), -cp.a)); }
    { const [x, z] = at(17, -1); parts.push(box(.18, 2.4, .18, '#8C7462', x - .9, cp.y + 1.2, z)); parts.push(box(.18, 2.4, .18, '#8C7462', x + .9, cp.y + 1.2, z)); parts.push(box(2.2, 1.2, .12, '#B59A82', x, cp.y + 1.9, z, -cp.a + Math.PI / 2)); parts.push(box(2.3, .14, .5, '#8C7462', x, cp.y + 2.6, z, -cp.a + Math.PI / 2)); }
  }
  // trail markers every ~60 m (a post with an apricot band)
  { let acc = 0; for (let k = 2; k < TP.length; k += 2) { acc += Math.hypot(TP[k] - TP[k - 2], TP[k + 1] - TP[k - 1]); if (acc < 60 || Math.abs(TP[k]) > 320 || Math.abs(TP[k + 1]) > 320) continue; acc = 0; const a = Math.atan2(TP[k + 1] - TP[k - 1], TP[k] - TP[k - 2]), x = TP[k] - Math.sin(a) * 1.4, z = TP[k + 1] + Math.cos(a) * 1.4, y = meshY(x, z); parts.push(box(.16, 1.2, .16, '#8C7462', x, y + .55, z)); parts.push(box(.18, .16, .18, '#EFB98F', x, y + 1.02, z)); } }
  // the trail: a ribbon draped exactly on the triangulated terrain, broken at the footbridge
  {
    const Pq = [], Cq = [], I = [], cA = lin('#C9B497'), cB = lin('#B9A487'); let n = 0, open = false;
    for (let k = 0; k < TP.length; k += 2) {
      const x = TP[k], z = TP[k + 1]; if (Math.max(Math.abs(x), Math.abs(z)) > 330 || Math.hypot(x - bridge.x, z - bridge.z) < bridge.L / 2 - .5) { open = false; continue; }
      const a = Math.atan2(TP[Math.min(TP.length - 1, k + 3)] - TP[Math.max(1, k - 1)], TP[Math.min(TP.length - 2, k + 2)] - TP[Math.max(0, k - 2)]), w = 1.7 + .5 * vn(k * .05, 2, S1), nx = -Math.sin(a) * w / 2, nz = Math.cos(a) * w / 2;
      for (const sg of [-1, 1]) { const X = x + nx * sg, Z = z + nz * sg, c = sg < 0 ? cA : cB; Pq.push(X, meshY(X, Z) + .05, Z); Cq.push(c.r, c.g, c.b); }
      if (open) I.push(n - 2, n - 1, n, n - 1, n + 1, n); n += 2; open = true;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(Pq, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cq, 3)); g.setIndex(I); g.computeVertexNormals();
    const m = new THREE.Mesh(own(g), mats.trail); m.receiveShadow = true; m.name = 'trail'; group.add(m);
  }
  // footbridge
  { const b = bridge, ca = Math.cos(b.a), sa = Math.sin(b.a), at = (u, v) => [b.x + ca * u - sa * v, b.z + sa * u + ca * v];
    for (let u = -b.L / 2; u <= b.L / 2 + .01; u += .55) { const [x, z] = at(u, 0); parts.push(box(.5, .12, 1.9, u % 1.1 < .55 ? '#A88B72' : '#9E8269', x, b.y, z, -b.a)); }
    for (const sg of [-1, 1]) { for (let u = -b.L / 2; u <= b.L / 2 + .01; u += 2.2) { const [x, z] = at(u, sg * .95), y0 = Math.min(b.y, meshY(x, z)); parts.push(box(.14, b.y + 1.05 - y0, .14, '#8C7462', x, (b.y + 1.05 + y0) / 2, z)); } const [x, z] = at(0, sg * .95); parts.push(box(b.L, .1, .1, '#A88B72', x, b.y + 1, z, -b.a)); }
    for (const sg of [-1, 1]) { const [x, z] = at(sg * (b.hw + 1.2), 0), y0 = meshY(x, z); parts.push(box(.8, b.y - y0 + .2, 2.1, '#A39C9E', x, (b.y + y0) / 2 - .1, z, -b.a)); } }
  // the deer (a decoy): body, neck, head, ears, legs
  { const d = deer, c = '#A9866C', g = merge([blobGeo(.75, .45, .38, 0, 1.15, 0, c, 1.3, 1, .9), xf(paint(new THREE.CylinderGeometry(.13, .18, .75, 6), c), .62, 1.55, 0, 0, 0, -.6), blobGeo(.26, .17, .15, .95, 1.9, 0, c, 2.2, 0, .9),
      xf(paint(new THREE.ConeGeometry(.07, .22, 4), '#8E6E5A'), .88, 2.1, .1, .3, 0, 0), xf(paint(new THREE.ConeGeometry(.07, .22, 4), '#8E6E5A'), .88, 2.1, -.1, -.3, 0, 0),
      ...[[.45, .18], [.45, -.18], [-.45, .18], [-.45, -.18]].map(([u, v]) => xf(paint(new THREE.CylinderGeometry(.045, .06, .95, 5), '#8E6E5A'), u, .48, v)), blobGeo(.12, .1, .1, -.78, 1.3, 0, '#E9E1D8', 3.1, 0)]);
    g.rotateY(-d.a); g.translate(d.x, d.y, d.z); const m = new THREE.Mesh(own(g), mats.v); m.castShadow = m.receiveShadow = true; m.name = 'deer'; group.add(m); }
  const STRUCT = merge(parts); { const m = new THREE.Mesh(own(STRUCT), mats.v); m.castShadow = m.receiveShadow = true; m.name = 'structures'; group.add(m); }
  // rescuers at the trailhead (props.rescuer when present)
  { let geo = propGeo('rescuer'); if (geo) geo = fitH(geo, 1.76); else { geo = merge([xf(paint(new THREE.CapsuleGeometry(.19, .95, 2, 7), '#E4DEE6'), 0, .66, 0), xf(paint(new THREE.SphereGeometry(.15, 7, 5), '#EFB98F'), 0, 1.5, 0)]); }
    const ca = Math.cos(cp.a), sa = Math.sin(cp.a), list = [[2, 1], [3.2, -.4], [9, 0], [11, 1.4]].map(([u, v]) => { const x = cp.x + ca * u - sa * v, z = cp.z + sa * u + ca * v; return { x, y: cp.y + .05, z, ry: r() * TAU }; });
    inst(geo, mats.v, list, { name: 'rescuers' }); }
  // the trekker (hidden in the story until found): props.survivor when present, a backpack beside
  const peopleGroup = new THREE.Group(); peopleGroup.name = 'people'; group.add(peopleGroup);
  { let g = propGeo('survivor', () => lin('#FFC36B')); if (g) { g = fitH(g, .46); lengthAlongX(g); } else g = merge([xf(paint(new THREE.CapsuleGeometry(.2, 1.1, 2, 7), '#ffffff'), 0, .22, 0, 0, 0, Math.PI / 2 - .2), xf(paint(new THREE.SphereGeometry(.15, 7, 5), '#ffffff'), -.82, .38, 0), xf(paint(new THREE.CapsuleGeometry(.11, .5, 2, 6), '#ffffff'), .45, .2, .3, 0, .6, Math.PI / 2)]);
    g.rotateY(-trek.face); g.translate(trek.x, trek.y + .02, trek.z); const m = new THREE.Mesh(own(g), mats.people); m.castShadow = true; m.name = 'trekker'; peopleGroup.add(m);
    const bp = merge([box(.55, .65, .3, '#EFB98F', 0, .32, 0), box(.5, .12, .32, '#C98E6E', 0, .6, 0)]); bp.rotateY(-trek.face + .7); bp.translate(trek.x + Math.cos(trek.face + 1.2) * 1.1, trek.y, trek.z + Math.sin(trek.face + 1.2) * 1.1); const bm = new THREE.Mesh(own(bp), mats.v); bm.castShadow = true; bm.name = 'backpack'; peopleGroup.add(bm); }
  mark('props');

  // ================================================================ the stream: a ribbon with its own water shader
  const WU = { uTime: { value: 0 }, uShallow: { value: lin('#7C9A8E') }, uDeep: { value: lin('#3F6270') }, uSky: { value: lin('#F3D0AC') }, uFoam: { value: lin('#EDE6DE') } };
  const waterMat = own(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .35, metalness: 0 }));
  {
    const Pq = [], Fl = [], Tn = [], Fm = [], I = [], VS = [-1.9, -1, -.35, .35, 1, 1.9]; let s = 0, n = 0;
    for (let k = 0; k < SP.length / 2; k++) {
      const x = SP[k * 2], z = SP[k * 2 + 1]; if (Math.abs(x) > 760 || Math.abs(z) > 760) continue;
      const kb = Math.max(0, k - 1), ka = Math.min(SP.length / 2 - 1, k + 1), tx0 = SP[ka * 2] - SP[kb * 2], tz0 = SP[ka * 2 + 1] - SP[kb * 2 + 1], tl = Math.hypot(tx0, tz0) || 1, tx = tx0 / tl, tz = tz0 / tl;
      if (n) s += Math.hypot(x - Pq[Pq.length - 18 + 6], z - Pq[Pq.length - 18 + 8]) || 4;
      const hw = SH[k], wy = SW[k], foam = smooth(.05, .3, Math.abs(SW[ka] - SW[kb]) / 8);
      for (const v of VS) { Pq.push(x - tz * v * hw, wy, z + tx * v * hw); Fl.push(s, v, hw); Tn.push(tx, tz); Fm.push(foam); }
      if (n) { const o = (n - 1) * 6; for (let q = 0; q < 5; q++) I.push(o + q, o + q + 1, o + q + 6, o + q + 1, o + q + 7, o + q + 6); }
      n++;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(Pq, 3)); g.setAttribute('aFlow', new THREE.Float32BufferAttribute(Fl, 3)); g.setAttribute('aTan', new THREE.Float32BufferAttribute(Tn, 2)); g.setAttribute('aFoam', new THREE.Float32BufferAttribute(Fm, 1));
    g.setIndex(I); g.computeVertexNormals();
    const worldPatch = (sh) => {
      Object.assign(sh.uniforms, WU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aFlow; attribute vec2 aTan; attribute float aFoam; varying vec3 vFl; varying vec2 vTn; varying float vFm; varying vec3 vWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvFl = aFlow; vTn = aTan; vFm = aFoam; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec3 uShallow, uDeep, uSky, uFoam; varying vec3 vFl; varying vec2 vTn; varying float vFm; varying vec3 vWP;
        float wh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float wn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(wh(i), wh(i + vec2(1., 0.)), f.x), mix(wh(i + vec2(0., 1.)), wh(i + vec2(1., 1.)), f.x), f.y); }
        float wr(vec2 q, float t){ q.x += t * 1.6; return .6 * wn(q * vec2(.32, .7)) + .4 * wn(q * vec2(.9, 1.6) + vec2(t * .9, 0.)); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
        float wT = uTime; float sA = vFl.x, ac = vFl.y, hw = vFl.z;
        float cen = clamp(1. - ac * ac, 0., 1.);
        vec3 wc = mix(uShallow, uDeep, smoothstep(.05, .85, cen));
        float st = smoothstep(.58, .9, wn(vec2(sA * .3 + wT * .55, ac * hw * .9)) * .6 + wn(vec2(sA * .7 + wT * 1.25, ac * hw * 2.1 + 5.)) * .4);
        float fm = clamp(vFm * (.55 + .45 * wn(vec2(sA * 1.3 + wT * 2.5, ac * 4.))) + (1. - smoothstep(.0, .35, cen)) * .25 * wn(vec2(sA * .9 + wT * .8, ac * 6.)), 0., 1.);
        wc = mix(wc, uFoam, clamp(st * .32 + fm * .85, 0., .9));
        diffuseColor.rgb = wc;
        vec2 wq = vec2(sA, ac * hw); float r0 = wr(wq, wT), rs = wr(wq + vec2(.5, 0.), wT), ra = wr(wq + vec2(0., .5), wT);
        float wCam = length(cameraPosition - vWP); float wk = (.7 + vFm * 1.2) / (1. + wCam / 160.);
        vec2 tn = normalize(vTn), nn = vec2(-tn.y, tn.x); vec2 gw = ((rs - r0) * tn + (ra - r0) * nn) * 2. * wk;
        vec3 wNw = normalize(vec3(-gw.x, 1., -gw.y));`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(wNw, 0.)).xyz);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 wV = normalize(cameraPosition - vWP); float wf = pow(1. - max(dot(wV, wNw), 0.), 4.); totalEmissiveRadiance += uSky * (wf * .45 + .03) * (1. - fm * .6); }`);
    };
    waterMat.onBeforeCompile = worldPatch; waterMat.userData.worldPatch = worldPatch; waterMat.customProgramCacheKey = () => 'liminal-forest-stream';
    var water = new THREE.Mesh(own(g), waterMat); water.receiveShadow = true; water.name = 'stream'; water.userData.layer = 'understorey'; group.add(water);
  }
  mark('stream');

  // ================================================================ the two search layers
  const poly2 = []; for (let i = 0; i < P.length; i += 2) poly2.push(V(P[i], 0, P[i + 1]));
  const mkLayer = (id, cell) => { const n = Math.round(600 / cell); return { id, cell, x0: -300, z0: -300, nx: n, nz: n, grid: new Uint8Array(n * n), ground: new Float32Array(n * n) }; };
  const LC = mkLayer('canopy', 4), LU = mkLayer('understorey', 2);
  for (const L of [LC, LU]) for (let k = 0; k < L.nz; k++) for (let i = 0; i < L.nx; i++) { const x = L.x0 + (i + .5) * L.cell, z = L.z0 + (k + .5) * L.cell, c = k * L.nx + i; L.ground[c] = meshY(x, z); L.grid[c] = inPoly(x, z) ? 0 : 2; }
  const cellAt = (L, x, z) => { const i = Math.floor((x - L.x0) / L.cell), k = Math.floor((z - L.z0) / L.cell); return i >= 0 && k >= 0 && i < L.nx && k < L.nz ? k * L.nx + i : -1; };
  const stamp = (L, x, z, R, fn) => { const i0 = Math.floor((x - R - L.x0) / L.cell), i1 = Math.floor((x + R - L.x0) / L.cell), k0 = Math.floor((z - R - L.z0) / L.cell), k1 = Math.floor((z + R - L.z0) / L.cell);
    for (let k = Math.max(0, k0); k <= Math.min(L.nz - 1, k1); k++) for (let i = Math.max(0, i0); i <= Math.min(L.nx - 1, i1); i++) { const cx = L.x0 + (i + .5) * L.cell, cz = L.z0 + (k + .5) * L.cell, d = Math.hypot(cx - x, cz - z); fn(k * L.nx + i, d); } };
  // stream cells (water, searchable from the air) in both layers
  for (let k = 0; k < SP.length / 2; k++) { const x = SP[k * 2], z = SP[k * 2 + 1]; if (Math.abs(x) > 310 || Math.abs(z) > 310) continue; for (const L of [LC, LU]) stamp(L, x, z, SH[k] * .9, (c, d) => { if (d <= SH[k] * .9 && L.grid[c] !== 2) L.grid[c] = 3; }); }
  { const c = cellAt(LU, bridge.x, bridge.z); }                                     // the footbridge spans the water: keep it water below
  // understorey obstacles: trunks, boulders, logs (a cell is blocked when the obstacle covers its centre, plus a small margin)
  const obst = (x, z, R) => { stamp(LU, x, z, R + .35, (c, d) => { if (d <= R + .35 && LU.grid[c] !== 2) LU.grid[c] = 1; }); const c0 = cellAt(LU, x, z); if (c0 >= 0 && LU.grid[c0] !== 2) LU.grid[c0] = 1; };
  for (const t of trees) obst(t.x, t.z, t.rad);
  for (const u of saps) obst(u.x, u.z, .12 * u.s);
  for (const k of rocks) if (k.R > .7) obst(k.x, k.z, k.sx * .75);
  for (const l of logs) for (let s = -l.L / 2; s <= l.L / 2; s += 1) obst(l.x + Math.cos(l.a) * s, l.z + Math.sin(l.a) * s, l.rad);
  // canopy: crown cover rasterised from the actual crowns, and the crown tops
  const dens = new Float32Array(LC.nx * LC.nz), top = new Float32Array(LC.nx * LC.nz); top.set(LC.ground);
  const crownOf = (t) => (t.kind === 1 ? [9.5 * t.s, 33 * t.s] : t.kind === 2 ? [4.4 * t.s, 24 * t.s] : [10.2 * t.s, 21.3 * t.s]);
  for (const t of trees) { const [R, H] = crownOf(t); stamp(LC, t.x, t.z, R * 1.05, (c, d) => { if (d > R * 1.05) return; dens[c] += 1 - smooth(R * .7, R * 1.05, d); top[c] = Math.max(top[c], t.y + H * (1 - .35 * (d / R) ** 2)); }); }
  for (const u of saps) stamp(LC, u.x, u.z, 2.6, (c, d) => { if (d < 2.6) dens[c] += .25 * (1 - d / 2.6); });
  const density = new Uint8Array(LC.nx * LC.nz); for (let c = 0; c < density.length; c++) density[c] = Math.round(clamp(dens[c], 0, 1) * 255);
  Object.assign(LC, { y: 30, band: [6, 22], relative: 'top', top, density });
  Object.assign(LU, { y: 0, band: [1.5, 6], relative: 'ground', density: (() => { const d = new Uint8Array(LU.nx * LU.nz); for (let k = 0; k < LU.nz; k++) for (let i = 0; i < LU.nx; i++) d[k * LU.nx + i] = density[Math.floor(k / 2) * LC.nx + Math.floor(i / 2)]; return d; })() });
  for (const L of [LC, LU]) L.poly = poly2;
  mark('grid');

  // ================================================================ anchors, camera hints, sky
  const base = V(cp.x + Math.cos(cp.a) * -2, cp.y + .08, cp.z + Math.sin(cp.a) * -2);
  const stn = V(cp.x + Math.cos(cp.a) * 6 - Math.sin(cp.a) * 9, cp.y + .05, cp.z + Math.sin(cp.a) * 6 + Math.cos(cp.a) * 9);
  const canopyTopAt = (x, z) => { const c = cellAt(LC, x, z); return c >= 0 ? top[c] : meshY(x, z) + 24; };
  let topNear = 0; for (let dz = -30; dz <= 30; dz += 6) for (let dx = -10; dx <= 50; dx += 6) topNear = Math.max(topNear, canopyTopAt(stn.x + dx, stn.z + dz));
  const tether = { station: stn, hover: V(stn.x + 6, Math.max(stn.y + 40, topNear + 14), stn.z), cable: 0 }; tether.cable = Math.round(tether.hover.distanceTo(stn) * 1.12);
  const casP = casc.map((x) => { let b = 0, bd = 1e9; for (let k = 0; k < SP.length; k += 2) { const d = Math.abs(SP[k] - x); if (d < bd) { bd = d; b = k; } } return V(SP[b], SW[b / 2], SP[b + 1]); });
  const pois = { trailhead: base.clone(), 'car park': V(cp.x, cp.y, cp.z), footbridge: V(bridge.x, bridge.y, bridge.z), trekker: V(trek.x, trek.y + .3, trek.z), deer: V(deer.x, deer.y + 1.2, deer.z), 'warm rock': V(rock.x, rock.y + 2, rock.z) };
  casP.forEach((p, i) => { if (Math.abs(p.x) < 300) pois[`cascade ${i + 1}`] = p; });
  clear.filter((c) => !c.home && Math.abs(c.x) < 300 && Math.abs(c.z) < 300).forEach((c, i) => { pois[`clearing ${i + 1}`] = V(c.x, meshY(c.x, c.z), c.z); });
  { let bi = 0; for (let k = 0; k < TP.length; k += 2) if (inPoly(TP[k], TP[k + 1])) bi = k; pois.ridge = V(TP[bi], meshY(TP[bi], TP[bi + 1]), TP[bi + 1]); }
  { let b = 0, bd = 1e9; for (let k = 0; k < SP.length; k += 2) { const d = Math.hypot(SP[k], SP[k + 1]); if (d < bd) { bd = d; b = k; } } pois.stream = V(SP[b], SW[b / 2], SP[b + 1]); }
  const trailPts = []; for (let k = 0; k < TP.length; k += 8) if (Math.abs(TP[k]) < 360 && Math.abs(TP[k + 1]) < 360) trailPts.push(V(TP[k], meshY(TP[k], TP[k + 1]), TP[k + 1]));
  const streamPts = []; for (let k = 0; k < SP.length; k += 4) if (Math.abs(SP[k]) < 360 && Math.abs(SP[k + 1]) < 360) streamPts.push(V(SP[k], SW[k / 2], SP[k + 1]));
  const clearY = (x, z, y) => { let m = -1e9; for (let dz = -12; dz <= 12; dz += 6) for (let dx = -12; dx <= 12; dx += 6) m = Math.max(m, canopyTopAt(x + dx, z + dz)); return Math.max(y, m + 9); };
  const look = (p, dx, dy, dz) => ({ pos: V(p.x + dx, clearY(p.x + dx, p.z + dz, p.y + dy), p.z + dz), target: p.clone() });
  // camera hints: from above the canopy, steep enough to look down into openings; under the canopy from a verified free spot
  const above = (p, dx, dz, h) => ({ pos: V(p.x + dx, clearY(p.x + dx, p.z + dz, p.y + h), p.z + dz), target: p.clone() });
  const underCam = (p, D, h, tgtH = 1) => {                                          // a free understorey cell D m away, under the densest cover
    let best = null;
    for (let a = 0; a < TAU; a += TAU / 24) for (const dd of [D, D * .7, D * 1.3]) {
      const x = p.x + Math.cos(a) * dd, z = p.z + Math.sin(a) * dd; let ok = true;
      for (const [ox, oz] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) { const c = cellAt(LU, x + ox, z + oz); if (c < 0 || LU.grid[c] === 1 || LU.grid[c] === 3) ok = false; }
      if (!ok) continue; const c = cellAt(LC, x, z), sc = (c >= 0 ? dens[c] : 0) - Math.abs(dd - D) * .01; if (!best || sc > best.sc) best = { x, z, sc };
    }
    const b = best || { x: p.x + D, z: p.z }; return { pos: V(b.x, meshY(b.x, b.z) + h, b.z), target: V(p.x, p.y + tgtH, p.z) };
  };
  const tk = V(trek.x, trek.y, trek.z), cpp = V(cp.x, cp.y + 1, cp.z);
  const camera = {
    wide: { pos: V(-140, 260, 540), target: V(10, 8, -10) },
    top: { pos: V(0, 820, 1), target: V(0, 0, 0) },
    trailhead: { pos: V(cp.x + 58, clearY(cp.x + 58, cp.z + side * 12, cp.y + 26), cp.z + side * 12), target: cpp },
    canopy: { pos: V(170, canopyTopAt(170, 150) + 55, 160), target: V(-30, canopyTopAt(-30, -20) - 8, -20) },
    understorey: underCam(tk, 24, 3.2, 1),
    trekker: underCam(tk, 10, 2.4, .4),
    stream: above(pois.stream, 34, 12, 58),
    footbridge: above(pois.footbridge, 10, 14, 30),
    deer: above(pois.deer, 6, 8, 20),
    rock: above(pois['warm rock'], 18, 16, 26),
    ridge: { pos: V(pois.ridge.x, clearY(pois.ridge.x, pois.ridge.z, pois.ridge.y + 40), pois.ridge.z), target: V(cp.x * .4, 0, cp.z * .4) },
  };
  const sky = { top: '#9DA2D2', horizon: '#F1CBA8', fog: '#F1CBA8', fogDensity: .0009, sun: { dir: V(-.74, .36, .32).normalize(), color: '#FFC892', intensity: 2.8 }, hemi: { sky: '#C9C4EA', ground: '#5C6450', intensity: 1.25 } };

  // ================================================================ animation: the canopy sways (stronger in a gust)
  const swayCol = sway.map((im) => { const a = im.instanceMatrix.array, b = new Float32Array(im.count * 3); for (let i = 0; i < im.count; i++) { b[i * 3] = a[i * 16 + 4]; b[i * 3 + 1] = a[i * 16 + 5]; b[i * 3 + 2] = a[i * 16 + 6]; } return b; });
  let wind = 1, gust = 0, gustT = -99;
  const WX = .92, WZ = -.39;                                                      // the breeze comes from the west, along the valley
  function update(t) {
    WU.uTime.value = t;
    for (let s = 0; s < sway.length; s++) {
      const im = sway[s], a = im.instanceMatrix.array, b = swayCol[s], info = im.userData.sway, n = im.count;
      for (let i = 0; i < n; i++) {
        const sw = info[i], x = sw[2], z = sw[3], ph = sw[1], front = x * WX + z * WZ;
        const g = gust > 0 ? gust * Math.exp(-((((t - gustT) * 28 - front - 340) / 60) ** 2)) : 0;          // a gust front crossing the forest
        const k = .0035 * wind * (Math.sin(t * .7 + ph + front * .02) + .5 * Math.sin(t * 1.9 + ph * 1.7)) + .03 * g, sy = b[i * 3 + 1];
        a[i * 16 + 4] = b[i * 3] + k * WX * sy; a[i * 16 + 6] = b[i * 3 + 2] + k * WZ * sy;
      }
      im.instanceMatrix.needsUpdate = true;
    }
  }
  update(0);
  mark('done');
  const buildMs = performance.now() - T0;
  return {
    group, sky, layers: [LC, LU], surfaces: [terrain, water, ...crownMeshes],
    anchors: {
      base, tether, people: [{ pos: V(trek.x, trek.y + .3, trek.z), layer: 'understorey', hidden: true, count: 1, kind: 'trekker', name: 'the trekker' }],
      decoys: [{ pos: V(deer.x, deer.y + 1.2, deer.z), layer: 'understorey', kind: 'deer', name: 'a deer', warm: true }, { pos: V(rock.x, rock.y + 2, rock.z), layer: 'understorey', kind: 'rock', name: 'a sun-warmed rock', warm: true }],
      ugvRoutes: [], boats: [], pois, trail: trailPts, stream: streamPts, footbridge: { pos: V(bridge.x, bridge.y, bridge.z), heading: bridge.a, length: bridge.L },
      wind: V(WX, 0, WZ), groundAt: (x, z) => meshY(x, z), canopyAt: (x, z) => { const c = cellAt(LC, x, z); return c >= 0 ? { density: density[c] / 255, top: top[c] } : { density: .8, top: meshY(x, z) + 24 }; },
    },
    bounds: new THREE.Box3(V(-310, -6, -310), V(310, 60, 310)), camera, peopleGroup,
    heightAt: (x, z) => meshY(x, z), canopyTopAt,
    setWind(w, g = 0, tNow = 0) { wind = w; gust = g; gustT = tNow; },
    update, stats: { marks: MARK.join(', '), buildMs, trees: trees.length, saplings: saps.length, logs: logs.length, rocks: rocks.length },
    dispose() { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const d of disposables) if (d.dispose) d.dispose(); },
  };
}

// ---------------------------------------------------------------- seeded helpers, polylines
function rng(s) { let a = (s >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash(x, y, s) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vn(x, y, s) { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; }
function fbm(x, y, s, o) { let t = 0, a = .5, n = 0; for (let i = 0; i < o; i++) { t += a * vn(x, y, s + i * 131); n += a; a *= .5; x *= 2.03; y *= 2.03; } return t / n; }
function mkLine(pts) {
  const n = pts.length >> 1, ch = [];
  for (let i = 0; i < n - 1; i += 8) { const j = Math.min(n - 1, i + 8); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let k = i; k <= j; k++) { const x = pts[2 * k], y = pts[2 * k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } ch.push(i, j, x0, y0, x1, y1); }
  return { pts, n, ch };
}
let LD_T = 0;                                                                     // segment parameter of the last nearest point
function lineDist(Ln, x, y, cap) {
  let best = cap * cap, bt = -1; const p = Ln.pts, ch = Ln.ch;
  for (let c = 0; c < ch.length; c += 6) {
    const dx = Math.max(ch[c + 2] - x, 0, x - ch[c + 4]), dy = Math.max(ch[c + 3] - y, 0, y - ch[c + 5]); if (dx * dx + dy * dy >= best) continue;
    for (let k = ch[c]; k < ch[c + 1]; k++) {
      const ax = p[2 * k], ay = p[2 * k + 1], bx = p[2 * k + 2] - ax, by = p[2 * k + 3] - ay, l2 = bx * bx + by * by || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * bx + (y - ay) * by) / l2)), ex = ax + bx * t - x, ey = ay + by * t - y, d2 = ex * ex + ey * ey;
      if (d2 < best) { best = d2; bt = k + t; }
    }
  }
  if (bt >= 0) LD_T = bt;
  return Math.sqrt(best);
}

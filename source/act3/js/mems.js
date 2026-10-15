// Act 3: four MEMS sensors you can play with. Each demo is a THREE.Group lying in the XY plane (facing +Z), about
// 1.6 units wide, with update(dt, input) where input = {x, y} in -1..1 (cursor or drag), plus a readout for the page.
// Motion is exaggerated by about a million: real proof masses move nanometres.
import * as THREE from 'three';

const C = { si: 0xc9c4dc, siDark: 0x9a94b8, sub: 0x2b2f5e, rose: 0xefb1b4, apricot: 0xf6d2b1, gold: 0xe7c48d, teal: 0x7fd4cf, ink: 0x1e2140, heat: 0xffc36b };
function kit() {
  const mats = [];
  const m = (color, o = {}) => { const mm = new THREE.MeshPhysicalMaterial(Object.assign({ color, metalness: .55, roughness: .32, clearcoat: .4, clearcoatRoughness: .2, transparent: true }, o)); mats.push(mm); return mm; };
  const M = {
    si: m(C.si, { metalness: .6, roughness: .26 }), si2: m(C.siDark, { metalness: .6, roughness: .3 }),
    sub: m(C.sub, { metalness: .1, roughness: .7, clearcoat: 0 }), subLine: m(0x3a3f78, { metalness: .1, roughness: .6 }),
    A: m(C.rose, { metalness: .75, roughness: .25 }), B: m(C.apricot, { metalness: .75, roughness: .25 }),
    gold: m(C.gold, { metalness: .9, roughness: .3 }), teal: m(C.teal, { metalness: .2, roughness: .4, emissive: C.teal, emissiveIntensity: .25 }),
    ink: m(C.ink, { metalness: 0, roughness: .6, clearcoat: 0 }), heat: m(C.heat, { metalness: 0, roughness: .5, emissive: C.heat, emissiveIntensity: .35 }),
    copper: m(0xd59a72, { metalness: .9, roughness: .3 }), ferrite: m(0x34364a, { metalness: .3, roughness: .5 }),
  };
  return { M, mats, setOpacity(a) { for (const mm of mats) { mm.opacity = a; mm.depthWrite = a > .98; mm.visible = a > .003; } } };
}
const bx = (w, h, d, mat, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); return o; };
function perforated(w, h, d, nx, ny, hole, mat) {
  const s = new THREE.Shape(); s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(w / 2, h / 2); s.lineTo(-w / 2, h / 2); s.lineTo(-w / 2, -h / 2);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const cx = -w / 2 + (i + .5) * w / nx, cy = -h / 2 + (j + .5) * h / ny, r = hole / 2, p = new THREE.Path();
    p.moveTo(cx - r, cy - r); p.lineTo(cx - r, cy + r); p.lineTo(cx + r, cy + r); p.lineTo(cx + r, cy - r); p.lineTo(cx - r, cy - r); s.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); g.translate(0, 0, -d / 2); return new THREE.Mesh(g, mat);
}
function arrow(mat, len = .3, r = .012) {
  const g = new THREE.Group(); const sh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 12), mat); sh.position.y = .5; g.add(sh);
  const hd = new THREE.Mesh(new THREE.ConeGeometry(r * 2.6, r * 6, 16), mat); g.add(hd);
  g.userData.set = (L) => { L = Math.max(1e-4, L); sh.scale.y = Math.max(1e-4, L - r * 6); sh.position.y = (L - r * 6) / 2; hd.position.y = L - r * 3; g.visible = L > r * 2; };
  g.userData.set(len); return g;
}
// serpentine spring between two x positions, beams along y
function serpentine(n, h, t, mat) {
  const g = new THREE.Group(), beams = [], links = [];
  for (let i = 0; i < n; i++) { const b = bx(t, h, .03, mat); beams.push(b); g.add(b); }
  for (let i = 0; i < n - 1; i++) { const l = bx(1, t, .03, mat); links.push(l); g.add(l); }
  g.userData.span = (x0, x1, y0) => {
    for (let i = 0; i < n; i++) { const x = x0 + (x1 - x0) * i / (n - 1); beams[i].position.set(x, y0, 0); }
    for (let i = 0; i < n - 1; i++) { const xa = beams[i].position.x, xb = beams[i + 1].position.x; links[i].scale.x = Math.abs(xb - xa) + t; links[i].position.set((xa + xb) / 2, y0 + (i % 2 ? -h / 2 : h / 2), 0); }
  };
  return g;
}

// ============================================================== accelerometer
export function makeAccel() {
  const K = kit(), M = K.M, root = new THREE.Group(), chip = new THREE.Group(); root.add(chip);
  chip.add(bx(1.9, 1.25, .05, M.sub, 0, 0, -.06));
  const mass = new THREE.Group(); chip.add(mass);
  const W = .74, H = .36;
  mass.add(perforated(W, H, .04, 12, 6, .026, M.si));
  // moving fingers off the top and bottom edges
  const pitch = .1, nF = 7, fingers = [];
  for (let s = -1; s <= 1; s += 2) for (let i = 0; i < nF; i++) {
    const x = (i - (nF - 1) / 2) * pitch; const f = bx(.016, .2, .04, M.si, x, s * (H / 2 + .1), 0); mass.add(f); fingers.push(f);
  }
  // fixed fingers (two electrodes, A and B) on stator rails
  const gap = .028;
  for (let s = -1; s <= 1; s += 2) {
    chip.add(bx(nF * pitch + .1, .05, .05, M.gold, 0, s * (H / 2 + .29), 0));
    for (let i = 0; i < nF; i++) {
      const x = (i - (nF - 1) / 2) * pitch;
      chip.add(bx(.016, .2, .04, M.A, x + gap, s * (H / 2 + .16), 0));
      chip.add(bx(.016, .2, .04, M.B, x - gap, s * (H / 2 + .16), 0));
    }
  }
  // springs at both ends to anchors
  const anchors = [], springs = [];
  for (let s = -1; s <= 1; s += 2) {
    const a = bx(.07, .3, .06, M.gold, s * (W / 2 + .2), 0, 0); chip.add(a); anchors.push(a);
    const sp = serpentine(6, .26, .012, M.si); chip.add(sp); springs.push(sp);
  }
  // gravity arrow (stays vertical on screen), its label is drawn by the page
  const g = arrow(M.heat, .34, .014); g.rotation.z = Math.PI; g.position.set(1.18, .2, .05); root.add(g);
  let th = 0, d = 0, auto = 0;
  return {
    group: root, kit: K, cam: { pos: [0, -.6, 4.8], tgt: [.1, .05, 0] },
    update(dt, inp) {
      auto += dt; const target = inp.active ? inp.x * .62 : Math.sin(auto * .7) * .42;
      th += (target - th) * Math.min(1, dt * 5); chip.rotation.z = th;
      const dGoal = -Math.sin(th) * .034; d += (dGoal - d) * Math.min(1, dt * 9);   // the mass slides downhill
      mass.position.x = d;
      springs[0].userData.span(-W / 2 - .2 + .035, -W / 2 + d, 0); springs[1].userData.span(W / 2 + d, W / 2 + .2 - .035, 0);
    },
    read() { const a = 9.81 * Math.sin(th); const cA = gap / (gap - d), cB = gap / (gap + d);
      return { tilt: th * 180 / Math.PI, a, cA, cB }; },
  };
}

// ============================================================== gyroscope
export function makeGyro() {
  const K = kit(), M = K.M, root = new THREE.Group(), chip = new THREE.Group(); root.add(chip);
  chip.add(bx(1.75, 1.2, .05, M.sub, 0, 0, -.06));
  const frame = new THREE.Group(); chip.add(frame);
  const FW = .86, FH = .62, T = .05;
  frame.add(bx(FW, T, .04, M.si2, 0, FH / 2), bx(FW, T, .04, M.si2, 0, -FH / 2), bx(T, FH, .04, M.si2, FW / 2, 0), bx(T, FH, .04, M.si2, -FW / 2, 0));
  // drive combs: moving teeth on the frame's outer sides, fixed teeth on the substrate
  for (let s = -1; s <= 1; s += 2) {
    chip.add(bx(.05, .5, .05, M.gold, s * (FW / 2 + .3), 0, 0));
    for (let i = 0; i < 6; i++) {
      const y = -.2 + i * .08;
      frame.add(bx(.18, .014, .04, M.si2, s * (FW / 2 + .1), y, 0));
      chip.add(bx(.18, .014, .04, M.teal, s * (FW / 2 + .2), y + .04, 0));
    }
  }
  // sense mass inside the frame, sense electrodes on the frame's inner edges
  const mass = perforated(.5, .26, .04, 9, 5, .026, M.si); frame.add(mass);
  const eTop = bx(.42, .03, .04, M.A, 0, FH / 2 - .1, 0), eBot = bx(.42, .03, .04, M.B, 0, -FH / 2 + .1, 0); frame.add(eTop, eBot);
  const springs = []; for (let s = -1; s <= 1; s += 2) { const sp = serpentine(5, .14, .01, M.si); sp.rotation.z = Math.PI / 2; frame.add(sp); springs.push(sp); }
  // springs that hold the frame to the substrate (four corners)
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) chip.add(bx(.06, .06, .06, M.gold, x * (FW / 2 + .12), y * (FH / 2 + .14), 0));
  const fs = []; for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const b = bx(.012, .14, .03, M.si, 0, 0, 0); chip.add(b); fs.push({ b, x, y }); }
  const vArrow = arrow(M.teal, .2, .011); vArrow.rotation.z = -Math.PI / 2; vArrow.position.set(0, FH / 2 + .1, .04); frame.add(vArrow);
  const fArrow = arrow(M.heat, .2, .013); fArrow.position.set(.31, 0, .05); frame.add(fArrow);
  let ph = 0, om = 0, ang = 0, auto = 0, yS = 0;
  return {
    group: root, kit: K, cam: { pos: [0, -.6, 4.8], tgt: [.1, .05, 0] },
    update(dt, inp) {
      auto += dt; const target = inp.active ? inp.x * 1.4 : Math.sin(auto * .45) * 1.0;   // rad/s of chip rotation (shown slowed)
      om += (target - om) * Math.min(1, dt * 4); ang += om * dt * .35; chip.rotation.z = ang;
      ph += dt * 2 * Math.PI * 1.4; const x = Math.sin(ph) * .045, v = Math.cos(ph);
      frame.position.x = x;
      yS = -om * v * .05;                                   // Coriolis: proportional to rate x velocity, in step with the swing
      mass.position.y = yS;
      springs[0].userData.span(FH / 2 - T / 2 - .02, .13 + yS, 0); springs[1].userData.span(-.13 + yS, -FH / 2 + T / 2 + .02, 0);
      for (const s of springs) { s.position.x = 0; }
      for (const f of fs) { f.b.position.set(f.x * (FW / 2 + .06) + x * .5, f.y * (FH / 2 + .07), 0); f.b.rotation.z = -x * 1.5 * f.y; }
      vArrow.userData.set(.08 + Math.abs(v) * .16); vArrow.rotation.z = v > 0 ? -Math.PI / 2 : Math.PI / 2; vArrow.position.x = v > 0 ? -.1 : .1;
      fArrow.userData.set(Math.abs(yS) * 3.2); fArrow.rotation.z = yS > 0 ? 0 : Math.PI; fArrow.position.y = yS + (yS > 0 ? .14 : -.14);
    },
    read() { return { rate: om * 57.3, heading: ((ang * 57.3 / .35) % 360 + 360) % 360 }; },
  };
}

// ============================================================== barometer (cut-away)
export function makeBaro() {
  const K = kit(), M = K.M, root = new THREE.Group(), cell = new THREE.Group(); root.add(cell);
  const Ro = .62, Rc = .44, depth = .1, base = -.3;
  // half-lathed substrate with the cavity, plus the flat cut face
  const prof = [[0, base], [Ro, base], [Ro, 0], [Rc, 0], [Rc, -depth], [0, -depth]].map(([r, y]) => new THREE.Vector2(r, y));
  const lathe = new THREE.Mesh(new THREE.LatheGeometry(prof, 96, Math.PI / 2, Math.PI), M.si2); cell.add(lathe);
  const cut = new THREE.Shape(); cut.moveTo(-Ro, base); cut.lineTo(Ro, base); cut.lineTo(Ro, 0); cut.lineTo(Rc, 0); cut.lineTo(Rc, -depth); cut.lineTo(-Rc, -depth); cut.lineTo(-Rc, 0); cut.lineTo(-Ro, 0); cut.lineTo(-Ro, base);
  const cutM = new THREE.Mesh(new THREE.ShapeGeometry(cut), M.sub); cutM.rotation.y = 0; cell.add(cutM);
  // bottom electrode on the cavity floor
  const el = new THREE.Mesh(new THREE.CylinderGeometry(Rc * .8, Rc * .8, .012, 64, 1, false, Math.PI / 2, Math.PI), M.A); el.position.y = -depth + .007; cell.add(el);
  // membrane: a polar grid over the half disc, displaced each frame, plus its cut edge
  const NR = 26, NA = 64, thick = .018;
  const pos = new Float32Array((NR + 1) * (NA + 1) * 3), idx = [];
  for (let i = 0; i <= NR; i++) for (let j = 0; j <= NA; j++) { const r = Ro * i / NR, a = Math.PI * j / NA; const k = (i * (NA + 1) + j) * 3; pos[k] = r * Math.cos(a); pos[k + 1] = 0; pos[k + 2] = -r * Math.sin(a); }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + NA + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); mg.setIndex(idx);
  const memM = M.si.clone(); memM.side = THREE.DoubleSide; K.mats.push(memM);
  const mem = new THREE.Mesh(mg, memM); mem.position.y = .004; cell.add(mem);
  const topEl = new THREE.Mesh(mg, M.B); topEl.scale.set(.8, 1, .8); topEl.position.y = -thick * .6; cell.add(topEl);
  const edgeN = 80, ep = new Float32Array(edgeN * 2 * 3), ei = [];
  for (let i = 0; i < edgeN - 1; i++) { const a = i * 2; ei.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3)); eg.setIndex(ei);
  const edge = new THREE.Mesh(eg, memM); edge.position.set(0, .004, .003); cell.add(edge);
  // air molecules above
  const NP = 260, pp = new Float32Array(NP * 3), pv = [];
  for (let i = 0; i < NP; i++) { pp[i * 3] = (Math.random() - .5) * 1.4; pp[i * 3 + 1] = .05 + Math.random() * .45; pp[i * 3 + 2] = -Math.random() * .7; pv.push(new THREE.Vector3((Math.random() - .5), (Math.random() - .5), (Math.random() - .5)).multiplyScalar(.5)); }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const pm = new THREE.PointsMaterial({ color: C.ink, size: .022, transparent: true, opacity: .55, depthWrite: false }); K.mats.push(pm);
  const pts = new THREE.Points(pg, pm); pts.frustumCulled = false; cell.add(pts);
  cell.rotation.x = .18;
  let alt = 0, w = 0, auto = 0;
  const P0 = 101325, pOf = (h) => P0 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
  return {
    group: root, kit: K, cam: { pos: [.3, .75, 3.3], tgt: [0, -.02, -.2] },
    update(dt, inp) {
      auto += dt; const target = inp.active ? ((inp.touch ? inp.x : inp.y) * .5 + .5) * 30 : (Math.sin(auto * .5) * .5 + .5) * 30;   // metres
      alt += (target - alt) * Math.min(1, dt * 3);
      const wGoal = .02 + .075 * (1 - alt / 30); w += (wGoal - w) * Math.min(1, dt * 6);   // more pressure, deeper bow
      const def = (r) => r < Rc ? -w * Math.pow(1 - (r / Rc) * (r / Rc), 2) : 0;
      for (let i = 0; i <= NR; i++) { const r = Ro * i / NR, y = def(r); for (let j = 0; j <= NA; j++) pos[(i * (NA + 1) + j) * 3 + 1] = y; }
      mg.attributes.position.needsUpdate = true; mg.computeVertexNormals();
      for (let i = 0; i < edgeN; i++) { const x = -Ro + 2 * Ro * i / (edgeN - 1), y = def(Math.abs(x)); ep.set([x, y, 0, x, y - thick, 0], i * 6); }
      eg.attributes.position.needsUpdate = true; eg.computeVertexNormals();
      // molecules: denser and faster low down
      const dens = .55 + .45 * (1 - alt / 30), n = Math.floor(NP * dens);
      for (let i = 0; i < NP; i++) {
        const v = pv[i]; let x = pp[i * 3] + v.x * dt, y = pp[i * 3 + 1] + v.y * dt, z = pp[i * 3 + 2] + v.z * dt;
        if (x < -.7 || x > .7) v.x *= -1; if (y < .03 || y > .5) v.y *= -1; if (z > 0 || z < -.7) v.z *= -1;
        pp[i * 3] = Math.max(-.7, Math.min(.7, x)); pp[i * 3 + 1] = i < n ? Math.max(.03, Math.min(.5, y)) : -10; pp[i * 3 + 2] = Math.max(-.7, Math.min(0, z));
      }
      pg.attributes.position.needsUpdate = true;
    },
    read() { const p = pOf(alt); return { alt, p, gapPct: (1 - w / depth) * 100 }; },
  };
}

// ============================================================== magnetometer
class Helix extends THREE.Curve {
  constructor(r, len, turns) { super(); this.r = r; this.len = len; this.turns = turns; }
  getPoint(t, o = new THREE.Vector3()) { const a = t * this.turns * Math.PI * 2; return o.set(this.r * Math.cos(a), (t - .5) * this.len, this.r * Math.sin(a)); }
}
export function makeMag() {
  const K = kit(), M = K.M, root = new THREE.Group(), chip = new THREE.Group(); root.add(chip);
  chip.add(bx(1.1, .8, .05, M.sub, 0, 0, -.06));
  const coil = (axis, x, y, z) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .5, 24), M.ferrite));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new Helix(.066, .42, 22), 600, .011, 8), M.copper));
    for (const s of [-1, 1]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .03, 24), M.si2); cap.position.y = s * .235; g.add(cap); }
    if (axis === 'x') g.rotation.z = Math.PI / 2; if (axis === 'y') g.rotation.x = 0; if (axis === 'z') g.rotation.x = Math.PI / 2;
    g.position.set(x, y, z); chip.add(g); return g;
  };
  coil('x', -.15, .2, .05); coil('y', .32, -.05, .05); coil('z', -.25, -.2, .28);
  chip.add(bx(.18, .18, .05, M.ink, .1, .22, 0));
  // rebar: three steel bars that slide in from the right
  const steel = new THREE.MeshPhysicalMaterial({ color: 0x6d6a7c, metalness: .85, roughness: .45, transparent: true }); K.mats.push(steel);
  const rebar = new THREE.Group(); root.add(rebar);
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, 1.6, 20), steel); b.position.set(i * .13, 0, -.1 + i * .02); rebar.add(b);
    for (let k = 0; k < 14; k++) { const r = new THREE.Mesh(new THREE.TorusGeometry(.036, .006, 6, 16), steel); r.position.set(i * .13, -.75 + k * .115, -.1 + i * .02); r.rotation.x = Math.PI / 2; rebar.add(r); } }
  // field lines in the chip plane: uniform field (north = +y) bent by the steel's induced poles
  const NL = 15, NS = 110, lines = [];
  const lineM = new THREE.LineBasicMaterial({ color: 0x2f8f89, transparent: true, opacity: .9 }); K.mats.push(lineM);
  const dotM = new THREE.PointsMaterial({ color: 0x2f8f89, size: .022, transparent: true, depthWrite: false }); K.mats.push(dotM);
  for (let i = 0; i < NL; i++) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NS * 3), 3)); const l = new THREE.Line(g, lineM); l.frustumCulled = false; root.add(l); lines.push(l);
    const d = new THREE.Points(g, dotM); d.frustumCulled = false; root.add(d); }
  const PHI = .5;                                   // the bars lie tilted, as rebar does in rubble
  rebar.rotation.z = -PHI;
  const poles = [];
  const field = (x, y) => {                          // B0 = (0,1) plus the induced poles at each bar's ends (2-D)
    let bxv = 0, byv = 1;
    for (const [px, py, q] of poles) { const dx = x - px, dy = y - py, r2 = dx * dx + dy * dy + .03; bxv += q * .32 * dx / r2; byv += q * .32 * dy / r2; }
    return [bxv, byv];
  };
  const needle = new THREE.Group(); root.add(needle); needle.position.set(.18, .62, .3); needle.scale.setScalar(.7);
  const nN = new THREE.Mesh(new THREE.ConeGeometry(.04, .32, 4), M.A); nN.position.y = .16; needle.add(nN);
  const nS = new THREE.Mesh(new THREE.ConeGeometry(.04, .32, 4), M.si); nS.position.y = -.16; nS.rotation.z = Math.PI; needle.add(nS);
  needle.add(new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .03, 16), M.gold).rotateX(Math.PI / 2));
  const ghost = new THREE.Mesh(new THREE.ConeGeometry(.03, .3, 4), new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, opacity: .25 })); K.mats.push(ghost.material); ghost.position.set(.18, .62 + .105, .29); ghost.scale.setScalar(.7); root.add(ghost);
  let near = 0, err = 0, auto = 0, lastRx = 99;
  return {
    group: root, kit: K, cam: { pos: [0, -.7, 4.0], tgt: [.15, 0, 0] },
    update(dt, inp) {
      auto += dt; const target = inp.active ? (inp.x * .5 + .5) : (Math.sin(auto * .45) * .5 + .5);
      near += (target - near) * Math.min(1, dt * 3);
      const rx = 1.7 - near * 1.15; rebar.position.x = rx;
      if (Math.abs(rx - lastRx) > .002) {
        lastRx = rx; poles.length = 0;
        const ca = Math.cos(-PHI), sa = Math.sin(-PHI), dx = Math.sin(PHI), dy = Math.cos(PHI);
        for (let i = 0; i < 3; i++) { const cx = rx + i * .13 * ca, cy = i * .13 * sa; poles.push([cx + dx * .62, cy + dy * .62, 1], [cx - dx * .62, cy - dy * .62, -1]); }
        for (let i = 0; i < NL; i++) {
          let x = -1.3 + i * .19, y = -1.0; const a = lines[i].geometry.attributes.position.array;
          for (let s = 0; s < NS; s++) { a[s * 3] = x; a[s * 3 + 1] = y; a[s * 3 + 2] = .02;
            const [fx, fy] = field(x, y); const L = Math.hypot(fx, fy) || 1; x += fx / L * .02; y += fy / L * .02; }
          lines[i].geometry.attributes.position.needsUpdate = true;
        }
      }
      const [fx, fy] = field(0, 0); const e = Math.atan2(fx, fy);
      err += (e - err) * Math.min(1, dt * 6); needle.rotation.z = -err;
    },
    read() { return { err: -err * 57.3, near }; },
  };
}

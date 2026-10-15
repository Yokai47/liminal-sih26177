// The ground/floor overlay: every surface the world marks with userData.layer gets its material patched (onBeforeCompile)
// to look up its layer's grid by world xz. The tape's firstSeen (tick a cell was first searched by anyone) is a float
// texture; the shader compares it with uT, so scrubbing is free. Lenses only change a few weights.
import * as THREE from 'three';

const NEVER = 1e7;
export function createOverlay() {
  const U = {
    uT: { value: 0 }, uTime: { value: 0 }, uKnown: { value: 0 }, uUnk: { value: .75 }, uWorld: { value: 1 }, uMap: { value: 0 }, uProof: { value: 0 }, uField: { value: 0 }, uGhost: { value: 0 }, uOwn: { value: 0 }, uUV: { value: 0 }, uOn: { value: 0 },
    cTeal: { value: new THREE.Color('#7FD4CF') }, cRose: { value: new THREE.Color('#EFB1B4') }, cLav: { value: new THREE.Color('#B9A6F2') }, cInk: { value: new THREE.Color('#1E2140') }, cHeat: { value: new THREE.Color('#FFC36B') },
    tField: { value: null }, fO: { value: new THREE.Vector4() }, fA: { value: new THREE.Vector4() }, fN: { value: new THREE.Vector2(1, 1) },
    tGhost: { value: null }, gBox: { value: new THREE.Vector4(0, 0, 1, 1) },
  };
  const blank = (() => { const t = new THREE.DataTexture(new Float32Array([NEVER]), 1, 1, THREE.RedFormat, THREE.FloatType); t.needsUpdate = true; return t; })();
  const blank8 = (() => { const t = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType); t.needsUpdate = true; return t; })();
  U.tField.value = blank8; U.tGhost.value = blank8;
  const layers = new Map();      // id -> { grid uniforms, textures }
  const patched = [];            // { mesh, orig, mat }
  const extraPlanes = [];
  const layerU = (id) => {
    if (!layers.has(id)) layers.set(id, { grid: { value: new THREE.Vector4(0, 0, 1, 0) }, n: { value: new THREE.Vector2(1, 1) }, tSeen: { value: blank }, tType: { value: blank8 }, tOwn: { value: blank }, main: { value: 0 } });
    return layers.get(id);
  };
  function patchMaterial(mat, L) {
    // chain whatever the world already patched into this material (animated water, cutaway sections...)
    const prev = (mat.userData && typeof mat.userData.worldPatch === 'function') ? mat.userData.worldPatch : (Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile') ? mat.onBeforeCompile : null);
    const prevKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey.call(mat) : '';
    const m = mat.clone();
    m.userData = mat.userData;
    m.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(m, sh, r);
      for (const k of Object.keys(U)) sh.uniforms['a4_' + k] = U[k];
      Object.assign(sh.uniforms, { a4_aGrid: L.grid, a4_aN: L.n, a4_tSeen: L.tSeen, a4_tType: L.tType, a4_tOwn: L.tOwn, a4_aMain: L.main });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vA4W; varying vec3 vA4N;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 a4p = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            a4p = instanceMatrix * a4p;
          #endif
          vA4W = (modelMatrix * a4p).xyz;
          #ifdef A4FLAT
            vA4N = vec3(0., 1., 0.);
          #else
            vA4N = normalize(mat3(modelMatrix) * objectNormal);
          #endif`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vA4W; varying vec3 vA4N;
        uniform float a4_uKnown, a4_uUnk, a4_uT, a4_uTime, a4_uWorld, a4_uMap, a4_uProof, a4_uField, a4_uGhost, a4_uOwn, a4_uUV, a4_uOn, a4_aMain;
        uniform vec3 a4_cTeal, a4_cRose, a4_cLav, a4_cInk, a4_cHeat;
        uniform vec4 a4_aGrid, a4_fO, a4_fA, a4_gBox; uniform vec2 a4_aN, a4_fN;
        uniform sampler2D a4_tSeen, a4_tType, a4_tOwn, a4_tField, a4_tGhost;
        float a4seen(vec2 uv) { float s = texture2D(a4_tSeen, uv).r; float o = texture2D(a4_tOwn, uv).r; return mix(s, o, a4_uOwn); }
        float a4srch(vec2 uv) { float t = floor(texture2D(a4_tType, uv).r * 255. + .5); return (t < .5 || abs(t - 3.) < .5 || abs(t - 4.) < .5) ? 1. : 0.; }`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        if (a4_uOn > .001 && vA4N.y > .45) {
          vec2 g = (vA4W.xz - a4_aGrid.xy) / a4_aGrid.z; vec2 uv = g / a4_aN;
          if (uv.x > 0. && uv.y > 0. && uv.x < 1. && uv.y < 1.) {
            vec2 px = 1. / a4_aN;
            vec2 cuv = (floor(g) + .5) * px;
            float typ = floor(texture2D(a4_tType, cuv).r * 255. + .5);
            float sr = a4srch(cuv), s = a4seen(cuv), known = step(s, a4_uT);
            // soft: the four nearest cell centres, blended (the World lens reveal has no hard cell edges)
            vec2 gp = g - .5, b = floor(gp), f = gp - b; f = f * f * (3. - 2. * f);
            vec2 u00 = (b + .5) * px, u10 = u00 + vec2(px.x, 0.), u01 = u00 + vec2(0., px.y), u11 = u00 + px;
            float r00 = a4srch(u00), r10 = a4srch(u10), r01 = a4srch(u01), r11 = a4srch(u11);
            float e00 = a4seen(u00), e10 = a4seen(u10), e01 = a4seen(u01), e11 = a4seen(u11);
            float k00 = r00 * step(e00, a4_uT), k10 = r10 * step(e10, a4_uT), k01 = r01 * step(e01, a4_uT), k11 = r11 * step(e11, a4_uT);
            float srS = mix(mix(r00, r10, f.x), mix(r01, r11, f.x), f.y);
            float knS = mix(mix(k00, k10, f.x), mix(k01, k11, f.x), f.y);
            float frS = mix(mix(k00 * exp(-max(a4_uT - e00, 0.) * .14), k10 * exp(-max(a4_uT - e10, 0.) * .14), f.x), mix(k01 * exp(-max(a4_uT - e01, 0.) * .14), k11 * exp(-max(a4_uT - e11, 0.) * .14), f.x), f.y);
            float unkS = smoothstep(.15, .85, clamp(srS - knS, 0., 1.));
            vec2 fc = abs(fract(g) - .5); float sq = 1. - smoothstep(.34, .5, max(fc.x, fc.y));
            float unkN = 0.;
            unkN += a4srch(cuv + vec2(px.x, 0.)) * step(a4_uT, a4seen(cuv + vec2(px.x, 0.)));
            unkN += a4srch(cuv - vec2(px.x, 0.)) * step(a4_uT, a4seen(cuv - vec2(px.x, 0.)));
            unkN += a4srch(cuv + vec2(0., px.y)) * step(a4_uT, a4seen(cuv + vec2(0., px.y)));
            unkN += a4srch(cuv - vec2(0., px.y)) * step(a4_uT, a4seen(cuv - vec2(0., px.y)));
            float front = known * sr * step(.5, unkN);
            vec3 col = gl_FragColor.rgb;
            float lum = dot(col, vec3(.3, .55, .15));
            // world lens: what is not yet searched sits a little dimmer and cooler; fresh scans glow softly
            col = mix(col, mix(col, vec3(lum) * vec3(.8, .8, .98), .36) * mix(.87, .45, clamp(a4_uUnk - .75, 0., 1.) * 4.), unkS * a4_uWorld * min(a4_uUnk, .95));
            col = mix(col, col * .8 + a4_cTeal * (.22 + .1 * lum), knS * a4_uKnown * a4_uWorld);
            col += a4_cTeal * smoothstep(.05, .9, frS) * (.2 * a4_uWorld);
            // swarm's map: crisp cells. unknown dark and hatched, known tinted, frontiers bright, mapped obstacles rose
            float hatch = step(.62, fract((g.x + g.y) * 1.5));
            vec3 mapUnk = a4_cInk * (.55 + .25 * hatch);
            vec3 mapKnown = mix(col * .55, a4_cTeal * (.35 + .35 * lum), .45);
            vec3 mcol = sr > .5 ? mix(mapUnk, mapKnown, known) : (typ > .5 && typ < 1.5 ? mix(col * .4, a4_cRose * .55, known) : col * .45);
            mcol += a4_cTeal * front * (.9 + .35 * sin(a4_uTime * 4.)) * (.5 + .5 * sq);
            mcol += a4_cTeal * sr * known * exp(-max(a4_uT - s, 0.) * .14) * .5 * sq;
            col = mix(col, mcol, a4_uMap * (.35 + .65 * sq));
            // proof: every unsearched pocket glows lavender until it is gone
            col = mix(col, col * .5 + a4_cLav * (.55 + .2 * sin(a4_uTime * 3.)), a4_uProof * unkS);
            col = mix(col, col * .72, a4_uProof * (1. - unkS) * .4);
            // turing field (ground robots and the tethered drone keep its spots alive)
            if (a4_uField > .001) {
              vec2 d = vA4W.xz - a4_fO.xy; vec2 fu = vec2(dot(d, a4_fA.xy) / a4_fO.z, dot(d, a4_fA.zw) / a4_fO.w) / a4_fN;
              if (fu.x > 0. && fu.y > 0. && fu.x < 1. && fu.y < 1.) {
                float v = texture2D(a4_tField, fu).r; float edge = min(min(fu.x, fu.y), min(1. - fu.x, 1. - fu.y));
                float k = smoothstep(.0, .06, edge);
                float iso = abs(fract(v * 5.) - .5); float ring = 1. - smoothstep(.0, .09, iso);
                col += (a4_cHeat * .2 * smoothstep(.15, .9, v) + a4_cHeat * ring * .12 * step(.12, v)) * a4_uField * k;
              }
            }
            // koopman: a faint ghost where the forecast says the search will have reached a minute from now
            if (a4_uGhost > .001 && a4_aMain > .5) {
              vec2 gu = (vA4W.xz - a4_gBox.xy) / a4_gBox.zw;
              if (gu.x > 0. && gu.y > 0. && gu.x < 1. && gu.y < 1.) { float p = texture2D(a4_tGhost, gu).r; float gh = smoothstep(.45, .7, p) * unkS; float st = step(.55, fract((vA4W.x - vA4W.z) * .25 + a4_uTime * .3)); col += a4_cTeal * gh * a4_uGhost * (.12 + .1 * st); }
            }
            // UV lens: the world under a blacklight, the floor faintly violet
            col = mix(col, col * vec3(.5, .45, .9) * .7, a4_uUV * .5);
            gl_FragColor.rgb = col;
          }
        }`);
    };
    m.customProgramCacheKey = () => 'a4ov|' + prevKey + '|' + (mat.type || '') + (mat.vertexColors ? 'vc' : '') + (mat.map ? 'map' : '');
    return m;
  }
  // patch the world's surfaces; a surface whose material we cannot patch gets a decal plane instead
  const clones = new Map();      // material uuid | layer -> patched clone, kept for the session (a world shown again reuses them)
  function attach(world, scene) {
    detach();
    const cache = clones;
    for (const mesh of world.surfaces || []) {
      const id = mesh.userData && mesh.userData.layer; if (!id) continue;
      const L = layerU(id);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out = mats.map((mt) => {
        if (!mt || !(mt.isMeshStandardMaterial || mt.isMeshLambertMaterial || mt.isMeshPhongMaterial || mt.isMeshPhysicalMaterial || mt.isMeshToonMaterial)) return null;
        const key = mt.uuid + '|' + id; if (!cache.has(key)) cache.set(key, patchMaterial(mt, L)); return cache.get(key);
      });
      if (out.some((x) => !x)) { decal(mesh, id, scene); continue; }
      patched.push({ mesh, orig: mesh.material });
      mesh.material = Array.isArray(mesh.material) ? out : out[0];
    }
  }
  function decal(mesh, id, scene) {
    // a flat overlay plane over the mesh's bounds (for shader-material surfaces such as animated water)
    const b = new THREE.Box3().setFromObject(mesh); if (b.isEmpty()) return;
    const L = layerU(id), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const mat = patchMaterial(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }), L); mat.defines = { A4FLAT: '' };
    const g = new THREE.PlaneGeometry(s.x, s.z); g.rotateX(-Math.PI / 2);
    const p = new THREE.Mesh(g, mat); p.position.set(c.x, b.max.y + .06, c.z); p.renderOrder = 2; scene.add(p); extraPlanes.push(p);
  }
  function detach() {
    for (const p of patched) p.mesh.material = p.orig; patched.length = 0;
    for (const p of extraPlanes) { p.parent && p.parent.remove(p); p.geometry.dispose(); p.material.dispose(); } extraPlanes.length = 0;
  }
  // textures from the tape
  let texs = [];
  function setTape(tape) {
    for (const t of texs) t.dispose(); texs = [];
    for (const L of tape.layers) {
      const u = layerU(L.id);
      const f = new Float32Array(L.nx * L.nz); for (let c = 0; c < f.length; c++) f[c] = L.firstSeen[c] === 65535 ? NEVER : L.firstSeen[c];
      const ts = new THREE.DataTexture(f, L.nx, L.nz, THREE.RedFormat, THREE.FloatType); ts.needsUpdate = true; ts.magFilter = ts.minFilter = THREE.NearestFilter;
      const tt = new THREE.DataTexture(L.grid.slice(), L.nx, L.nz, THREE.RedFormat, THREE.UnsignedByteType); tt.needsUpdate = true; tt.magFilter = tt.minFilter = THREE.NearestFilter;
      u.tSeen.value = ts; u.tType.value = tt; u.tOwn.value = ts; u.grid.value.set(L.x0, L.z0, L.cell, 0); u.n.value.set(L.nx, L.nz); u.main.value = tape.layers[tape.mainLayer] === L ? 1 : 0;
      texs.push(ts, tt);
    }
    // the forecast ghost box = the main layer
    const M = tape.layers[tape.mainLayer]; U.gBox.value.set(M.x0, M.z0, M.nx * M.cell, M.nz * M.cell);
    U.uOn.value = 1;
  }
  // one drone's own map instead of the merged one
  let ownTex = [];
  function setOwn(tape, drone) {
    for (const t of ownTex) t.dispose(); ownTex = [];
    for (const L of tape.layers) { const u = layerU(L.id); if (drone == null || !tape.knownAt) { u.tOwn.value = u.tSeen.value; continue; }
      const K = tape.knownAt[drone], f = new Float32Array(L.nx * L.nz); for (let c = 0; c < f.length; c++) { const v = K[L.off + c]; f[c] = v === 65535 ? NEVER : v; }
      const t = new THREE.DataTexture(f, L.nx, L.nz, THREE.RedFormat, THREE.FloatType); t.needsUpdate = true; t.magFilter = t.minFilter = THREE.NearestFilter; u.tOwn.value = t; ownTex.push(t); }
  }
  // turing field snapshot
  let fieldTex = null, fieldSnap = null;
  function setField(snap, w, h) {
    if (!snap) { U.uField.value = 0; return; }
    if (snap === fieldSnap) return; fieldSnap = snap;
    if (!fieldTex || fieldTex.image.width !== w || fieldTex.image.height !== h) { if (fieldTex) fieldTex.dispose(); fieldTex = new THREE.DataTexture(new Uint8Array(w * h), w, h, THREE.RedFormat, THREE.UnsignedByteType); fieldTex.magFilter = fieldTex.minFilter = THREE.LinearFilter; U.tField.value = fieldTex; }
    fieldTex.image.data.set(snap.data); fieldTex.needsUpdate = true;
    const F = snap.frame; U.fO.value.set(F.ox, F.oz, F.su, F.sv); U.fA.value.set(F.ux, F.uz, F.vx, F.vz); U.fN.value.set(w, h);
  }
  let ghostTex = null, ghostF = null;
  function setGhost(f) {
    if (!f) return; if (f === ghostF) return; ghostF = f;
    if (!ghostTex || ghostTex.image.width !== f.gw) { if (ghostTex) ghostTex.dispose(); ghostTex = new THREE.DataTexture(new Uint8Array(f.gw * f.gh), f.gw, f.gh, THREE.RedFormat, THREE.UnsignedByteType); ghostTex.magFilter = ghostTex.minFilter = THREE.LinearFilter; U.tGhost.value = ghostTex; }
    ghostTex.image.data.set(f.grid); ghostTex.needsUpdate = true;
  }
  // a world that is thrown away: its patched clones go too
  function forget(world) {
    for (const mesh of world.surfaces || []) for (const mt of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!mt) continue; for (const [k, c] of clones) if (k.startsWith(mt.uuid + '|')) { c.dispose(); clones.delete(k); }
    }
  }
  return { U, attach, detach, forget, setTape, setOwn, setField, setGhost, dispose() { detach(); for (const c of clones.values()) c.dispose(); clones.clear(); for (const t of [...texs, ...ownTex]) t.dispose(); if (fieldTex) fieldTex.dispose(); if (ghostTex) ghostTex.dispose(); blank.dispose(); blank8.dispose(); } };
}

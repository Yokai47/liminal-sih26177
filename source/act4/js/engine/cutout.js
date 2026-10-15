// See-through cutout: fragments of chosen meshes (a forest's crowns) that sit between the camera and what it looks at
// are discarded inside a soft capsule around the camera-to-target segment, so a camera following a drone under the
// canopy never sits inside a crown or looks at a wall of leaves. Materials are patched in place (chaining whatever
// onBeforeCompile the world or the overlay already set), and the effect is off unless a shot asks for it.
import * as THREE from 'three';

export function createCutout() {
  const U = { a4cC: { value: new THREE.Vector3() }, a4cT: { value: new THREE.Vector3() }, a4cR: { value: 10 }, a4cOn: { value: 0 }, a4cAbove: { value: 2.5 } };
  const done = new WeakSet();     // a material is patched once for good (a world shown again keeps its patch)
  function patch(mat) {
    if (!mat || done.has(mat) || !(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial || mat.isMeshPhysicalMaterial)) return;
    done.add(mat);
    const prev = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile') ? mat.onBeforeCompile : (mat.userData && typeof mat.userData.worldPatch === 'function' ? mat.userData.worldPatch : null);
    const prevKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey : null;
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vA4C;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          { vec4 a4q = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            a4q = instanceMatrix * a4q;
          #endif
            vA4C = (modelMatrix * a4q).xyz; }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vA4C; uniform vec3 a4cC, a4cT; uniform float a4cR, a4cOn, a4cAbove;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (a4cOn > .01) {
            vec3 ab = a4cT - a4cC; float s = clamp(dot(vA4C - a4cC, ab) / max(dot(ab, ab), 1e-4), 0., 1.);
            float d = distance(vA4C, a4cC + ab * s), r = a4cR * a4cOn * mix(1.7, .6, s); // widest at the camera, where a crown would fill the picture
            float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
            if (s < .94 && vA4C.y > a4cT.y + a4cAbove && d < r * (.82 + .18 * dither)) discard;
          }`);
    };
    mat.customProgramCacheKey = function () { return 'a4cut|' + (prevKey ? prevKey.call(this) : ''); };
    mat.needsUpdate = true;
  }
  // test(obj) picks the meshes to cut; called again after the overlay swaps materials
  function attach(world, test) {
    if (!world || !test) return 0; let n = 0;
    world.group.traverse((o) => { if (!o.isMesh || !test(o)) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) { patch(m); n++; } });
    return n;
  }
  function set(on, cam, tgt, radius) { U.a4cOn.value = on; if (cam) U.a4cC.value.copy(cam); if (tgt) U.a4cT.value.copy(tgt); if (radius) U.a4cR.value = radius; }
  return { U, attach, set, reset() { U.a4cOn.value = 0; } };
}

// Screen-space thick line segments (ribbons) with per-vertex colour, optional dashes and travelling packets.
// One draw call for thousands of segments; buffers are preallocated and rewritten per frame (no allocation).
import * as THREE from 'three';

export function createLines(cap, { width = 2, additive = true, dash = 0, packets = false, depthTest = true, opacity = 1, nearFade = [0, 0] } = {}) {
  const V = cap * 4;
  const pos = new Float32Array(V * 3), oth = new Float32Array(V * 3), side = new Float32Array(V), col = new Float32Array(V * 4), uu = new Float32Array(V * 2);
  const idx = new Uint32Array(cap * 6);
  for (let s = 0; s < cap; s++) { const v = s * 4, i = s * 6; idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 3; idx[i + 3] = v; idx[i + 4] = v + 3; idx[i + 5] = v + 2;
    side[v] = 1; side[v + 1] = -1; side[v + 2] = -1; side[v + 3] = 1; }
  const g = new THREE.BufferGeometry();
  const aP = new THREE.BufferAttribute(pos, 3), aO = new THREE.BufferAttribute(oth, 3), aC = new THREE.BufferAttribute(col, 4), aU = new THREE.BufferAttribute(uu, 2);
  for (const a of [aP, aO, aC, aU]) a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', aP); g.setAttribute('other', aO); g.setAttribute('side', new THREE.BufferAttribute(side, 1)); g.setAttribute('col', aC); g.setAttribute('uu', aU);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const U = { res: { value: new THREE.Vector2(1000, 800) }, width: { value: width }, time: { value: 0 }, dash: { value: dash }, pk: { value: packets ? 1 : 0 }, op: { value: opacity }, nf: { value: new THREE.Vector2(nearFade[0], nearFade[1]) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, depthTest, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
    vertexShader: `attribute vec3 other; attribute float side; attribute vec4 col; attribute vec2 uu; uniform vec2 res, nf; uniform float width; varying vec4 vC; varying vec2 vU;
      void main(){ vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.); vec4 b = projectionMatrix * modelViewMatrix * vec4(other, 1.);
        vec2 sa = a.xy / max(abs(a.w), 1e-4), sb = b.xy / max(abs(b.w), 1e-4); vec2 d = (sb - sa) * res; float l = length(d); vec2 dir = l > 1e-5 ? d / l : vec2(1., 0.);
        vec2 n = vec2(-dir.y, dir.x); float w = width * col.a > 0. ? width : 0.;
        a.xy += n * side * w / res * a.w; gl_Position = a; vC = col; vU = uu; if (nf.y > 0.) vC.a *= smoothstep(nf.x, nf.y, min(a.w, b.w));
        if (a.w < .2 || b.w < .2) { gl_Position = vec4(0., 0., -2., 1.); vC = vec4(0.); } }`,
    fragmentShader: `uniform float time, dash, pk, op; varying vec4 vC; varying vec2 vU;
      void main(){ float a = vC.a * op; if (dash > 0. && fract(vU.x / dash - time * .6) > .55) a *= .15;
        vec3 c = vC.rgb;
        if (pk > 0. && vU.y > 0.) { float ph = fract(vU.x * .02 - time * .9 + vU.y * 7.13); float p = smoothstep(.07, 0., abs(ph - .5)); c += vec3(.9, 1., .98) * p * min(1., vU.y); a = max(a, p * min(1., vU.y) * .9 * op); }
        gl_FragColor = vec4(c * a, a); }`,
  });
  if (!additive) { mat.blending = THREE.CustomBlending; mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor; }
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 5;
  let n = 0;
  return {
    mesh, U,
    begin() { n = 0; },
    // segment a->b with colours (r,g,b,a) at each end; u0/u1 travel coordinate (metres) for dashes, pk = packet strength
    seg(ax, ay, az, bx, by, bz, r, gg, b, a0, a1 = a0, u0 = 0, u1 = 0, pk = 0) {
      if (n >= cap) return; const v = n * 4;
      for (let k = 0; k < 4; k++) { const isA = k < 2, o = (v + k) * 3; pos[o] = isA ? ax : bx; pos[o + 1] = isA ? ay : by; pos[o + 2] = isA ? az : bz; oth[o] = isA ? bx : ax; oth[o + 1] = isA ? by : ay; oth[o + 2] = isA ? bz : az;
        const c = (v + k) * 4; col[c] = r; col[c + 1] = gg; col[c + 2] = b; col[c + 3] = isA ? a0 : a1; const q = (v + k) * 2; uu[q] = isA ? u0 : u1; uu[q + 1] = pk; }
      n++;
    },
    end() { g.setDrawRange(0, n * 6); for (const [a, k] of [[aP, 12], [aO, 12], [aC, 16], [aU, 8]]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, n * k)); a.needsUpdate = true; } },
    get count() { return n; },
    dispose() { g.dispose(); mat.dispose(); },
  };
}

// glowing points with a minimum on-screen size
// dot: a crisp disc with a dark rim in normal blending, a fixed pixel size, shown only while the drone is too far away
// to read as a model (so the swarm stays visible on bright water or snow, where additive glows wash out)
export function createGlows(cap, { additive = true, minPx = 3, depthTest = true, dot = false } = {}) {
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 4), size = new Float32Array(cap);
  const g = new THREE.BufferGeometry();
  const aP = new THREE.BufferAttribute(pos, 3), aC = new THREE.BufferAttribute(col, 4), aS = new THREE.BufferAttribute(size, 1);
  for (const a of [aP, aC, aS]) a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', aP); g.setAttribute('col', aC); g.setAttribute('size', aS);
  const U = { px: { value: 1 }, minPx: { value: minPx }, maxPx: { value: 4096 }, hh: { value: 800 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, depthTest, blending: additive && !dot ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
    vertexShader: dot ? `attribute vec4 col; attribute float size; uniform float px, minPx, maxPx, hh; varying vec4 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; vC = col;
        float s = size * projectionMatrix[1][1] * hh * .5 / max(.1, -mv.z); vC.a *= 1. - smoothstep(minPx * 1.6, minPx * 4.5, s);
        gl_PointSize = vC.a > .01 ? minPx * px : 0.; }` : `attribute vec4 col; attribute float size; uniform float px, minPx, maxPx, hh; varying vec4 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; vC = col;
        float s = size * projectionMatrix[1][1] * hh * .5 / max(.1, -mv.z); gl_PointSize = min(maxPx, max(s, minPx * px * step(.001, size))); }`,
    fragmentShader: dot ? `varying vec4 vC; void main(){ vec2 q = gl_PointCoord - .5; float d = length(q) * 2.; if (d > 1.) discard;
      float a = 1. - smoothstep(.82, 1., d); vec3 c = mix(min(vC.rgb, vec3(1.)), vec3(.11, .12, .25), smoothstep(.5, .72, d) * .85); gl_FragColor = vec4(c, a * vC.a); }`
      : `varying vec4 vC; void main(){ vec2 q = gl_PointCoord - .5; float d = length(q) * 2.; if (d > 1.) discard;
      float core = exp(-d * d * 18.), halo = exp(-d * d * 3.2) * .55; float a = (core + halo) * vC.a; gl_FragColor = vec4(vC.rgb * a, a); }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 6;
  let n = 0;
  return {
    mesh: pts, U,
    begin() { n = 0; },
    add(x, y, z, r, gg, b, a, s) { if (n >= cap) return; pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z; col[n * 4] = r; col[n * 4 + 1] = gg; col[n * 4 + 2] = b; col[n * 4 + 3] = a; size[n] = s; n++; },
    end() { g.setDrawRange(0, n); for (const [a, k] of [[aP, 3], [aC, 4], [aS, 1]]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, n * k)); a.needsUpdate = true; } },
    dispose() { g.dispose(); mat.dispose(); },
  };
}

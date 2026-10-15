// LIMINAL Act 1 — a small stable-fluids solver (Stam 1999) on GPU render targets. The pointer stirs it; the page
// reads `velocity` to bend the image like liquid glass and `dye` as a soft trail the pointer leaves behind.
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main(){ vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`;
const H = `precision highp float; varying vec2 vUv; uniform vec2 texel;`;

export function createFluid(renderer, { size = 128, dyeSize = 256 } = {}) {
  const aspectRT = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  const pair = (w, h) => { const p = { a: aspectRT(w, h), b: aspectRT(w, h), swap() { const t = p.a; p.a = p.b; p.b = t; } }; return p; };
  let vel = pair(size, size), dye = pair(dyeSize, dyeSize), prs = pair(size, size), div = aspectRT(size, size);
  const scene = new THREE.Scene(), cam = new THREE.Camera();
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(geo); quad.frustumCulled = false; scene.add(quad);
  const M = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: H + frag, uniforms: { texel: { value: new THREE.Vector2(1 / size, 1 / size) }, ...uniforms }, depthTest: false, depthWrite: false });
  const advect = M(`uniform sampler2D src, v; uniform float dt, diss; uniform vec2 asp;
    void main(){ vec2 p = vUv - dt * texture2D(v, vUv).xy * asp; gl_FragColor = texture2D(src, p) * diss; }`,
    { src: { value: null }, v: { value: null }, dt: { value: 0 }, diss: { value: .98 }, asp: { value: new THREE.Vector2(1, 1) } });
  const splat = M(`uniform sampler2D src; uniform vec2 pt; uniform vec3 val; uniform float r, aspect;
    void main(){ vec2 d = vUv - pt; d.x *= aspect; float g = exp(-dot(d, d) / r); gl_FragColor = texture2D(src, vUv) + vec4(val * g, 0.); }`,
    { src: { value: null }, pt: { value: new THREE.Vector2() }, val: { value: new THREE.Vector3() }, r: { value: .001 }, aspect: { value: 1 } });
  const divg = M(`uniform sampler2D v;
    void main(){ float L = texture2D(v, vUv - vec2(texel.x, 0.)).x, R = texture2D(v, vUv + vec2(texel.x, 0.)).x;
      float B = texture2D(v, vUv - vec2(0., texel.y)).y, T = texture2D(v, vUv + vec2(0., texel.y)).y; gl_FragColor = vec4(.5 * (R - L + T - B), 0., 0., 1.); }`, { v: { value: null } });
  const jac = M(`uniform sampler2D p, d;
    void main(){ float L = texture2D(p, vUv - vec2(texel.x, 0.)).x, R = texture2D(p, vUv + vec2(texel.x, 0.)).x;
      float B = texture2D(p, vUv - vec2(0., texel.y)).x, T = texture2D(p, vUv + vec2(0., texel.y)).x;
      gl_FragColor = vec4((L + R + B + T - texture2D(d, vUv).x) * .25, 0., 0., 1.); }`, { p: { value: null }, d: { value: null } });
  const grad = M(`uniform sampler2D p, v;
    void main(){ float L = texture2D(p, vUv - vec2(texel.x, 0.)).x, R = texture2D(p, vUv + vec2(texel.x, 0.)).x;
      float B = texture2D(p, vUv - vec2(0., texel.y)).x, T = texture2D(p, vUv + vec2(0., texel.y)).x;
      vec2 u = texture2D(v, vUv).xy - .5 * vec2(R - L, T - B); gl_FragColor = vec4(u, 0., 1.); }`, { p: { value: null }, v: { value: null } });
  const clear = M(`uniform sampler2D src; uniform float k; void main(){ gl_FragColor = texture2D(src, vUv) * k; }`, { src: { value: null }, k: { value: .8 } });

  function run(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(scene, cam); }
  const ptr = { x: .5, y: .5, px: .5, py: .5, moved: false, aspect: 1 };
  const queue = [];   // extra splats requested by the page (e.g. a tap ripple)

  function update(dt, aspect = 1) {
    dt = Math.min(dt, 1 / 30); ptr.aspect = aspect;
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear; renderer.autoClear = false;
    advect.uniforms.asp.value.set(1, 1);
    advect.uniforms.dt.value = dt * 1.0; advect.uniforms.diss.value = .985;
    advect.uniforms.src.value = vel.a.texture; advect.uniforms.v.value = vel.a.texture; run(advect, vel.b.texture ? vel.b : vel.b); vel.swap();
    splat.uniforms.aspect.value = aspect;
    if (ptr.moved) {
      const dx = (ptr.x - ptr.px), dy = (ptr.y - ptr.py);
      splat.uniforms.r.value = .0016; splat.uniforms.pt.value.set(ptr.x, ptr.y); splat.uniforms.val.value.set(dx * 260, dy * 260, 0);
      splat.uniforms.src.value = vel.a.texture; run(splat, vel.b); vel.swap();
      splat.uniforms.r.value = .0022; splat.uniforms.val.value.set(Math.min(1, Math.hypot(dx * aspect, dy) * 26 + .05), 0, 0);
      splat.uniforms.src.value = dye.a.texture; run(splat, dye.b); dye.swap();
      ptr.px = ptr.x; ptr.py = ptr.y; ptr.moved = false;
    }
    while (queue.length) {
      const q = queue.shift();
      splat.uniforms.r.value = q.r; splat.uniforms.pt.value.set(q.x, q.y);
      if (q.vel) { splat.uniforms.val.value.set(q.vel[0], q.vel[1], 0); splat.uniforms.src.value = vel.a.texture; run(splat, vel.b); vel.swap(); }
      if (q.dye) { splat.uniforms.val.value.set(q.dye, 0, 0); splat.uniforms.src.value = dye.a.texture; run(splat, dye.b); dye.swap(); }
    }
    divg.uniforms.v.value = vel.a.texture; run(divg, div);
    clear.uniforms.src.value = prs.a.texture; clear.uniforms.k.value = .8; run(clear, prs.b); prs.swap();
    jac.uniforms.d.value = div.texture;
    for (let i = 0; i < 14; i++) { jac.uniforms.p.value = prs.a.texture; run(jac, prs.b); prs.swap(); }
    grad.uniforms.p.value = prs.a.texture; grad.uniforms.v.value = vel.a.texture; run(grad, vel.b); vel.swap();
    advect.uniforms.dt.value = dt; advect.uniforms.diss.value = .972;
    advect.uniforms.src.value = dye.a.texture; advect.uniforms.v.value = vel.a.texture; run(advect, dye.b); dye.swap();
    renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto;
  }
  function move(x, y) { if (!ptr.init) { ptr.px = x; ptr.py = y; ptr.init = true; } ptr.x = x; ptr.y = y; ptr.moved = true; }
  function splatAt(x, y, o) { queue.push({ x, y, r: o.r || .002, vel: o.vel, dye: o.dye }); }
  return { update, move, splatAt, get velocity() { return vel.a.texture; }, get dye() { return dye.a.texture; } };
}

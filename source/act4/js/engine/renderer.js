// Renderer, scene, sky dome, lights, fog and post (bloom on emissive things only), adaptive resolution.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createRenderer(canvas, { phone = false, preserve = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: preserve, alpha: false });
  let DPR = Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 1.5);
  renderer.setPixelRatio(DPR);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x2b2f5e, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .5, 4000);
  // sky: a gradient dome with a soft glow toward the sun
  const skyU = { top: { value: new THREE.Color('#2E3166') }, horizon: { value: new THREE.Color('#B79AB7') }, ground: { value: new THREE.Color('#4F4B6F') }, sunDir: { value: new THREE.Vector3(-.7, .4, .3).normalize() }, sunCol: { value: new THREE.Color('#FFC9B0') }, glow: { value: .6 }, dark: { value: 0 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 top, horizon, ground, sunCol, sunDir; uniform float glow, dark; varying vec3 vP;
      void main(){ float y = vP.y; vec3 c = y > 0. ? mix(horizon, top, pow(smoothstep(0., .75, y), .7)) : mix(horizon, ground, smoothstep(0., .12, -y));
        float s = max(0., dot(normalize(vP), normalize(sunDir))); c += sunCol * (pow(s, 6.) * .35 + pow(s, 60.) * .5) * glow * smoothstep(-.1, .2, y + .1);
        c *= 1. - dark * .85; gl_FragColor = vec4(c, 1.);
      }` }));
  sky.renderOrder = -10; sky.frustumCulled = false; sky.scale.setScalar(3000); scene.add(sky);
  scene.fog = new THREE.FogExp2(0x7e72a0, .004);
  const hemi = new THREE.HemisphereLight(0xa8a2da, 0x3e3762, .95); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc9b0, 1.5); sun.castShadow = true;
  const SM = phone ? 1024 : 2048; sun.shadow.mapSize.set(SM, SM); sun.shadow.bias = -.0004; sun.shadow.normalBias = .6; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  // post
  const size = new THREE.Vector2(16, 16);
  const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: phone ? 2 : 4 });
  const composer = new EffectComposer(renderer, rt);
  const pass = new RenderPass(scene, camera); composer.addPass(pass);
  // HDR guard: a NaN or an overflow (a specular glint above half-float range) in a single pixel would be blurred by the
  // bloom over the whole frame and turn it black; clean them before the bloom sees them
  const guard = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, flag: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float flag; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv);
        ${renderer.capabilities.isWebGL2 ? 'if (any(isnan(c)) || any(isinf(c.rgb))) c = flag > .5 ? vec4(40., 0., 40., 1.) : vec4(0., 0., 0., 1.); else if (flag > .5 && max(c.r, max(c.g, c.b)) > 2000.) c = vec4(0., 40., 0., 1.);' : ''}
        gl_FragColor = vec4(clamp(c.rgb, 0., 48.), clamp(c.a, 0., 1.)); }` });
  composer.addPass(guard);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .38, .42, .9); composer.addPass(bloom);
  // a gentle vignette + grain so the frame never looks like a debug view
  const finish = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, res: { value: new THREE.Vector2(1, 1) }, time: { value: 0 }, vig: { value: new THREE.Color('#1E2140') }, amt: { value: .22 }, uv: { value: 0 }, fade: { value: 0 }, sat: { value: 1.08 }, demag: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 res; uniform float time, amt, uv, fade, sat, demag; uniform vec3 vig; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 3.1) * 43758.5453); }
      void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 q = vUv - .5; q.x *= res.x / res.y; float v = smoothstep(.45, 1.25, length(q));
        c.rgb = mix(c.rgb, vig * .5, v * amt);
        // a gentle grade: a touch more contrast and colour, so the clay never looks washed out
        vec3 g = clamp(c.rgb, 0., 1.); c.rgb = mix(c.rgb, g * g * (3. - 2. * g), .18); float l0 = dot(c.rgb, vec3(.299, .587, .114)); c.rgb = mix(vec3(l0), c.rgb, sat);
        // pull a magenta cast back toward neutral (red and blue both above green), leaving blue and teal alone
        float pm = max(0., min(c.r, c.b) - c.g); c.rgb += vec3(-.55, .35, -.3) * pm * demag;
        // UV lens: the world under a blacklight
        float l = dot(c.rgb, vec3(.3, .55, .15)); c.rgb = mix(c.rgb, vec3(l * .28, l * .22, l * .5) + c.rgb * vec3(.25, .2, .45), uv * .85);
        c.rgb = mix(c.rgb, vig * .6, fade);
        c.rgb += (h(vUv * res) - .5) * .012; gl_FragColor = c; }` });
  composer.addPass(finish);
  composer.addPass(new OutputPass());
  let W = 16, H = 16;
  function setSize(w, h) {
    W = Math.max(16, w | 0); H = Math.max(16, h | 0);
    renderer.setPixelRatio(DPR); renderer.setSize(W, H, false);
    composer.setPixelRatio(DPR); composer.setSize(W, H);
    bloom.setSize(W * DPR / 2, H * DPR / 2);
    finish.uniforms.res.value.set(W * DPR, H * DPR);
    camera.aspect = W / H; camera.updateProjectionMatrix();
  }
  function setSky(s, bounds, look = {}) {
    const C = (x, d) => new THREE.Color(x || d);
    skyU.top.value.copy(C(s.top, '#2E3166')); skyU.horizon.value.copy(C(s.horizon, '#B79AB7')); skyU.ground.value.copy(C(s.fog || s.horizon, '#4F4B6F')).multiplyScalar(.75);
    scene.fog.color.copy(C(s.fog || s.horizon, '#7E72A0')); scene.fog.density = s.fogDensity ?? .004;
    // a mission may pull the world's light toward a cooler, less saturated version of itself
    if (look.tint) { const m = look.tint.mix ?? .4; if (look.tint.fog) { scene.fog.color.lerp(C(look.tint.fog), m); skyU.ground.value.lerp(C(look.tint.fog).multiplyScalar(.75), m); }
      if (look.tint.horizon) skyU.horizon.value.lerp(C(look.tint.horizon), m); if (look.tint.top) skyU.top.value.lerp(C(look.tint.top), m); }
    renderer.setClearColor(scene.fog.color, 1);
    hemi.color.copy(C(s.hemi?.sky, '#A8A2DA')); hemi.groundColor.copy(C(s.hemi?.ground, '#3E3762')); hemi.intensity = (s.hemi?.intensity ?? .9) * .95 * (look.hemi ?? 1);
    if (look.tint) { const m = look.tint.mix ?? .4; if (look.tint.hemiSky) hemi.color.lerp(C(look.tint.hemiSky), m); if (look.tint.hemiGround) hemi.groundColor.lerp(C(look.tint.hemiGround), m); }
    sun.color.copy(C(s.sun?.color, '#FFC9B0')); sun.intensity = (s.sun?.intensity ?? 1.5) * 1.05 * (look.sun ?? 1); renderer.toneMappingExposure = look.exposure ?? 1; finish.uniforms.sat.value = look.sat ?? 1.08; finish.uniforms.demag.value = look.demag ?? 0; bloom.threshold = look.bloomThreshold ?? .9; bloom.strength = look.bloom ?? .38;
    if (look.tint && look.tint.sun) sun.color.lerp(C(look.tint.sun), look.tint.mix ?? .4);
    const dir = s.sun?.dir ? new THREE.Vector3().copy(s.sun.dir).normalize() : new THREE.Vector3(-.7, .45, .3).normalize();
    skyU.sunDir.value.copy(dir); skyU.sunCol.value.copy(sun.color); skyU.glow.value = s.glow ?? .6; skyU.dark.value = s.dark ?? 0;
    const b = bounds || new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 30, 100));
    const c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3()), R = Math.max(sz.x, sz.z) * .6 + 10;
    sun.position.copy(c).addScaledVector(dir, R * 2.2); sun.target.position.copy(c);
    const sc = sun.shadow.camera; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = R * 5; sc.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
  }
  // adaptive resolution: if frames stay slow, render fewer pixels (never below 1)
  let slow = 0, fast = 0;
  function adapt(dt) {
    if (dt > .026) { slow++; fast = 0; } else { fast++; slow = Math.max(0, slow - 1); }
    if (slow > 50 && DPR > 1) { DPR = Math.max(1, DPR - .25); setSize(W, H); slow = 0; return true; }
    if (slow > 400 && bloom.enabled && DPR <= 1) { bloom.enabled = false; slow = 0; }
    return false;
  }
  // every frame starts from a known state (an extra render, e.g. the drone's-eye inset, may have changed it)
  function render(t) {
    renderer.setRenderTarget(null); renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.autoClear = true;
    finish.uniforms.time.value = t; composer.render();
  }
  return {
    renderer, scene, camera, composer, bloom, finish, guard, sun, hemi, sky, skyU, setSize, setSky, render, adapt, resetAdapt() { slow = 0; fast = 0; },
    get dpr() { return DPR; }, get w() { return W; }, get h() { return H; },
    // everything on the GPU: the composer's targets and each pass's own, the sky, then the context itself
    dispose() { for (const p of composer.passes) { try { p.dispose && p.dispose(); } catch (e) { /* ignore */ } } composer.dispose?.(); rt.dispose(); sky.geometry.dispose(); sky.material.dispose(); renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss(); },
  };
}

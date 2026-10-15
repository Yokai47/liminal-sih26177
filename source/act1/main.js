// LIMINAL — Act 1, attempt 4: "maquette 2.0".
// Two Cycles-baked sets. A close-up of the void (night + dawn bakes) where your cursor is a real torch with
// soft shadows and the knocking has to be found; and the clay maquette of the whole building where one drone,
// then the swarm, map it for real (ray casts on the model) until the unexplored pockets are counted down to zero.
// We come back to the void at first light for the find.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { createSound } from '../common/sound.js';
import { createFluid } from '../common/fluid.js';
import { GRID, FLOORS, truthGrids, runMission } from '../common/sim.js';
import { liquidCursor } from '../common/cursor.js';
import { LiminalSwarm } from './lab/swarm.js';
import { initLab, mountAct5, initZones } from './lab/lab.js';
liquidCursor();
// ---------------------------------------------------------------- the gate: a school of drones assembles the name while the story loads
let LOADP = 0, gateSwarm = null, knockT = 0;
{
  const cv = document.querySelector('.gate-swarm'), wide = innerWidth > 760;
  try {
    gateSwarm = LiminalSwarm(cv, { n: wide ? 1100 : 600, mode: 'scatter', text: 'LIMINAL', font: '720 {fs}px Fraunces, Georgia, serif',
      textBox: wide ? { cx: .5, cy: .55, w: .7, h: .44 } : { cx: .5, cy: .52, w: .9, h: .24 },
      ink: [220, 228, 238], accent: [246, 210, 177], bg: '30,33,64', trail: .3, eta: .22, reform: 'text', reformHold: 1e9, reformDelay: 900, inputEl: document.getElementById('gate') });
    gateSwarm.setTheme({ colorBy: 'heading', hueStart: 175, hueSpan: 150, hueSat: 46, hueLight: 80 });
    gateSwarm.setRecruit(0);
    const form = () => gateSwarm && gateSwarm.formation('text', 1e9);
    (document.fonts && document.fonts.load ? document.fonts.load('720 100px Fraunces').catch(() => {}) : Promise.resolve()).then(() => setTimeout(form, 350));
    // three knocks from under the rubble, every few seconds: the school flinches before you hear anything
    knockT = setInterval(() => { if (!gateSwarm) return; const z = gateSwarm.size(); [0, 280, 560].forEach((d) => setTimeout(() => gateSwarm && gateSwarm.knock(z.w * .5, z.h * 1.04, Math.max(z.w, z.h) * .8), d)); }, 3600);
  } catch (e) { console.warn('gate swarm', e); }
}
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const Q = new URLSearchParams(location.search);
const PH = matchMedia('(max-width: 760px)').matches || Q.has('phone');
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s) => document.querySelector(s);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const C = (h) => new THREE.Color(h);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- renderer + post
const canvas = $('#gl'), ov = $('#ov'), g2 = ov.getContext('2d'), labels = $('#labels');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }); }
catch (e) { document.documentElement.classList.add('nogl'); document.body.classList.remove('locked'); document.getElementById('gate').remove(); document.getElementById('chrome').hidden = false; throw e; }
const DPR = Math.min(devicePixelRatio || 1, PH ? 1.6 : 1.75);
renderer.setPixelRatio(DPR); renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.03, 200);
const maqScene = new THREE.Scene(), setScene = new THREE.Scene();
const rt = new THREE.WebGLRenderTarget(innerWidth * DPR, innerHeight * DPR, { type: THREE.HalfFloatType, samples: PH ? 2 : 4 });
const composer = new EffectComposer(renderer, rt);
const rpass = new RenderPass(maqScene, camera); composer.addPass(rpass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), .5, .65, .86); composer.addPass(bloom);
const fluid = createFluid(renderer, { size: PH ? 64 : 128, dyeSize: PH ? 128 : 256 });
const finish = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, vel: { value: null }, time: { value: 0 }, res: { value: new THREE.Vector2() }, liquid: { value: 1 }, vig: { value: C('#1E2140') }, grain: { value: .03 }, fade: { value: 0 }, fadeCol: { value: C('#3B3E7A') }, alt: { value: null }, altOn: { value: 0 }, altInv: { value: 0 }, heat: { value: null }, heatAmt: { value: 0 }, heatTx: { value: new THREE.Vector2(1, 1) }, dofAmt: { value: 0 }, dofMode: { value: 1 }, focus: { value: new THREE.Vector2(.6, .55) }, dofR: { value: new THREE.Vector2(.18, .6) }, dark: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse, vel, heat, alt; uniform float altOn, altInv, time, liquid, grain, fade, heatAmt, dofAmt, dofMode, dark; uniform vec2 heatTx, focus, dofR; uniform vec2 res; uniform vec3 vig, fadeCol; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 7.13) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5), b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5), c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5), d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
    void main(){
      vec2 v = texture2D(vel, vUv).xy; float m = length(v);
      vec2 uv = vUv - v * .0014 * liquid; float ca = clamp(m * .0006, 0., .005) * liquid;
      vec3 c = vec3(texture2D(tDiffuse, uv + v * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - v * ca).b);
      // lens: shallow focus around the subject in the void, a tilt-shift band on the maquette
      if (dofAmt > .001) {
        float dd = dofMode < 1.5 ? length((vUv - focus) * vec2(res.x / res.y, 1.)) : abs(vUv.y - focus.y);
        float bl = smoothstep(dofR.x, dofR.y, dd) * dofAmt;
        if (bl > .001) { vec3 acc = c; for (int i = 0; i < 12; i++) { float a = float(i) * 2.39996, r = sqrt((float(i) + .5) / 12.); acc += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * r * bl * vec2(res.y / res.x, 1.) * .014).rgb; } c = acc / 13.; }
      }
      // thermal: a blurred heat render of the hidden body, mapped through a soft iron palette
      if (heatAmt > .001) {
        float ht = 0.; for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) ht += texture2D(heat, vUv + vec2(float(i), float(j)) * heatTx * 1.5).r * exp(-float(i * i + j * j) * .25);
        ht /= 6.3;
        // iron palette: violet edge -> magenta -> amber -> near-white core
        vec3 ramp = mix(vec3(.36, .22, .6), vec3(.86, .36, .58), smoothstep(.12, .4, ht));
        ramp = mix(ramp, vec3(1., .66, .34), smoothstep(.4, .68, ht)); ramp = mix(ramp, vec3(1., .95, .84), smoothstep(.72, .95, ht));
        c = mix(c, ramp, smoothstep(.05, .22, ht) * heatAmt * .9);
      }
      vec2 q = vUv - .5; q.x *= res.x / res.y; c = mix(c, vig * .55, smoothstep(.4, 1.2, length(q)) * .5);
      // chapter changes pass through a drift of dust
      vec2 du = vUv * vec2(res.x / res.y, 1.);
      float n = vn(vec2(du.x * 1.6 - time * .9, du.y * 7.)) * .55 + vn(vec2(du.x * 5. - time * 1.7, du.y * 22.)) * .3 + vn(du * 40.) * .15;
      // the next set is already there under the dust: a front blows across left to right and swaps them
      float front = altOn * 1.7 - .35 - (1. - vUv.x) * .5 + (n - .5) * .45;
      float sw = smoothstep(-.18, .18, front);
      if (altOn > .001) {
        vec3 a2 = texture2D(alt, vUv + vec2(.004, 0.) * sin(time + vUv.y * 9.)).rgb;
        float m = mix(sw, 1. - sw, altInv);
        c = mix(c, a2, m);
        c = mix(c, fadeCol * (.95 + .1 * n), (1. - abs(sw - .5) * 2.) * .35);
      }
      c = mix(c, vig * .7, dark);
      c += (h(vUv * res) - .5) * grain;
      gl_FragColor = vec4(c, 1.);
    }`
});
composer.addPass(finish); composer.addPass(new OutputPass());

// ---------------------------------------------------------------- maquette: sky + baked material (from A1, softened grid)
const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { dawn: { value: 0 }, n0: { value: C('#1E2140') }, n1: { value: C('#3B3E7A') }, d0: { value: C('#9C98D0') }, d1: { value: C('#F2C3B4') }, d2: { value: C('#F9DEC3') } },
  vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `uniform float dawn; uniform vec3 n0, n1, d0, d1, d2; varying vec3 vP;
    void main(){ float y = normalize(vP).y; float t = smoothstep(0., .55, y);
      vec3 night = mix(n1, n0, t); vec3 day = mix(d2, mix(d1, d0, smoothstep(.0, .5, t)), smoothstep(-.1, .25, t));
      gl_FragColor = vec4(mix(night, day, dawn), 1.); }`
}));
sky.renderOrder = -1; maqScene.add(sky);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
  uniforms: { dawn: sky.material.uniforms.dawn, n: { value: C('#33366F') }, d: { value: C('#EBD3D2') }, sh: { value: C('#1E2140') }, hn: sky.material.uniforms.n1, hd: sky.material.uniforms.d2 }, depthWrite: true,
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform float dawn; uniform vec3 n, d, sh, hn, hd; varying vec3 vW;
    float box(vec2 p, vec2 b){ vec2 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, q.y), 0.); }
    void main(){ vec3 base = mix(n, d, dawn);
      float s = box(vW.xz - vec2(1.5, 0.), vec2(13., 9.5));
      float contact = 1. - smoothstep(-.2, 2.6, s); float wide = 1. - smoothstep(0., 9., s);
      vec3 c = mix(base, sh, contact * .55 + wide * .18);
      float far = smoothstep(18., 90., length(vW.xz));
      gl_FragColor = vec4(mix(c, mix(hn, hd, dawn), far), 1.); }` }));
floor.position.y = -1.62; maqScene.add(floor);
const U = {
  lmN: { value: null }, lmD: { value: null }, dawn: { value: 0 }, nightGain: { value: .66 }, time: { value: 0 }, cut: { value: 99 },
  occ: { value: null }, mapOn: { value: 0 }, floorOn: { value: new THREE.Vector4() }, floorTops: { value: new THREE.Vector4(...FLOORS.map(f => f.top)) },
  grid: { value: new THREE.Vector4(GRID.x0, GRID.z0, GRID.cs, 0) }, gridN: { value: new THREE.Vector2(GRID.nx, GRID.nz) },
  ink: { value: C('#1E2140') }, poche: { value: C('#EFB1B4') }, unkPulse: { value: 0 }, exposure: { value: 1 },
};
const maqMat = (lmN, lmD) => new THREE.ShaderMaterial({
  uniforms: { ...U, lmN: { value: lmN }, lmD: { value: lmD } }, side: THREE.DoubleSide,
  vertexShader: `varying vec2 vUv; varying vec3 vW, vN; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform sampler2D lmN, lmD, occ; uniform float dawn, nightGain, cut, mapOn, unkPulse, exposure; uniform vec2 gridN; uniform vec4 floorOn, floorTops, grid; uniform vec3 ink, poche;
    varying vec2 vUv; varying vec3 vW, vN;
    void main(){
      if (vW.y > cut) discard;
      if (!gl_FrontFacing) { gl_FragColor = vec4(poche * mix(.62, 1., dawn), 1.); return; }
      vec3 col = mix(texture2D(lmN, vUv).rgb * nightGain, texture2D(lmD, vUv).rgb, dawn) * exposure;
      if (mapOn > .001 && vN.y > .9) {
        for (int f = 0; f < 4; f++) {
          if (floorOn[f] < .001 || abs(vW.y - floorTops[f]) > .08) continue;
          vec2 g = (vW.xz - grid.xy) / grid.z; vec2 gu = g / gridN;
          if (gu.x < 0. || gu.y < 0. || gu.x > 1. || gu.y > 1.) continue;
          vec4 o = texture2D(occ, vec2(gu.x, (gu.y + float(f)) * .25));
          vec2 cc = abs(fract(g) - .5); float sq = 1. - smoothstep(.36, .44, max(cc.x, cc.y) + .25 * length(max(cc - .25, 0.)));
          float a = o.a * mapOn * floorOn[f];
          float isUnk = step(.95, o.a) * step(o.r + o.g + o.b, .05);
          col = mix(col, col * .5 + o.rgb * .85, a * (.25 + .75 * sq) * (1. - isUnk));
          col += vec3(.55, .45, .95) * isUnk * mapOn * floorOn[f] * (.14 + .12 * unkPulse) * (.4 + .6 * sq);
        }
      }
      gl_FragColor = vec4(col, 1.);
    }`
});

// ---------------------------------------------------------------- the void set: baked emissive + a real torch (Lambert + shadows)
const SU = { lmN: { value: null }, lmD: { value: null }, dawn: { value: 0 }, vis: { value: 1 }, time: { value: 0 }, taps: { value: [-99, -99, -99, -99] }, knock: { value: V(.21, .776, .05) }, ring: { value: C('#F7C8A6') } };
function setMat(lmN, lmD, albedo = '#A9A4AE') {
  const m = new THREE.MeshLambertMaterial({ color: C(albedo), emissive: 0xffffff, emissiveMap: lmN });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { lmD2: SU.lmD, dawn: SU.dawn, vis: SU.vis, time: SU.time, taps: SU.taps, knock: SU.knock, ringCol: SU.ring });
    sh.uniforms.lmD2 = { get value() { return m.userData.lmD; } };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D lmD2; uniform float dawn, vis, time, taps[4]; uniform vec3 knock, ringCol; varying vec3 vWP;`)
      .replace('#include <emissivemap_fragment>', `
        vec3 eN = texture2D(emissiveMap, vEmissiveMapUv).rgb, eD = texture2D(lmD2, vEmissiveMapUv).rgb;
        float ring = 0.; float dk = distance(vWP, knock);
        for (int i = 0; i < 4; i++) { float a = time - taps[i]; if (a < 0. || a > 5.) continue; float r = a * 1.9; ring += exp(-pow((dk - r) / (.018 + a * .03), 2.)) * exp(-a * 1.5) * smoothstep(2.4, 1.1, r); }
        totalEmissiveRadiance = mix(eN, eD, dawn) * vis + ringCol * ring * .32;`)
      // the torch should find texture and corners too: borrow occlusion + surface grain from the night bake
      .replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 bn = texture2D(emissiveMap, vEmissiveMapUv).rgb; float l = dot(bn, vec3(.299, .587, .114)); diffuseColor.rgb *= clamp(l * 2.6, .28, 1.5); }`);
  };
  m.userData.lmD = lmD;
  return m;
}
const torch = new THREE.SpotLight(C('#FFE6C8'), 9, 9, .3, .65, 1.6);
torch.castShadow = true; torch.shadow.mapSize.set(PH ? 512 : 1024, PH ? 512 : 1024); torch.shadow.bias = -.0004; torch.shadow.normalBias = .012; torch.shadow.camera.near = .05; torch.shadow.camera.far = 9;
setScene.add(torch, torch.target);
const beamGeo = new THREE.CylinderGeometry(.015, .62, 2.2, 40, 1, true); beamGeo.translate(0, -1.1, 0); beamGeo.rotateX(-Math.PI / 2);
const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { on: { value: 0 }, time: { value: 0 }, col: { value: C('#FFE2C2') } },
  vertexShader: `varying vec3 vP, vN, vV; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float on, time; uniform vec3 col; varying vec3 vP, vN, vV;
    float n(vec3 p){ return fract(sin(dot(floor(p), vec3(12.9, 78.2, 37.7))) * 43758.5); }
    void main(){ float t = clamp(vP.z / 2.2, 0., 1.); float edge = pow(abs(dot(vN, vV)), 2.2);
      float dust = .75 + .25 * sin(vP.z * 9. - time * .7 + sin(vP.x * 14. + time * .3) * 2.);
      gl_FragColor = vec4(col * edge * pow(1. - t, 2.) * dust * on * .09, 1.); }` }));
beam.frustumCulled = false; setScene.add(beam);
const dbeam = beam.clone(); dbeam.material = beam.material.clone(); dbeam.material.uniforms.col.value = C('#C9FFF6'); dbeam.material.uniforms.on.value = 0; setScene.add(dbeam);
const droneLight = new THREE.SpotLight(C('#CFFFF8'), 0, 5, .55, .8, 1.8); droneLight.castShadow = true; droneLight.shadow.mapSize.set(512, 512); droneLight.shadow.bias = -.0005; droneLight.shadow.normalBias = .012;
setScene.add(droneLight, droneLight.target);
const sunFill = new THREE.HemisphereLight(C('#FFD8B8'), C('#6E6AA8'), 0); setScene.add(sunFill);
setScene.background = C('#1E2140'); setScene.fog = new THREE.FogExp2(C('#1E2140'), .08);
// the person, as only a thermal camera sees them: a body under the rubble, one arm up to the pipe (never drawn plainly)
const heatScene = new THREE.Scene(), heatRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
const BREATH = { value: 0 };
const heatMat = (k, br = 0) => new THREE.ShaderMaterial({ uniforms: { k: { value: k }, br: { value: br }, breath: BREATH }, blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, depthTest: true, depthWrite: false,
  vertexShader: `varying vec3 vN, vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float k, br, breath; varying vec3 vN, vV; void main(){ float f = pow(abs(dot(vN, vV)), .9); gl_FragColor = vec4(vec3(f * k * (1. + br * breath)), 1.); }` });
const HEATP = [];
const topRT = new THREE.WebGLRenderTarget(320, 200, { type: THREE.HalfFloatType });
const topCam = new THREE.OrthographicCamera(-.95, .95, .6, -.6, .1, 10); topCam.up.set(0, 0, -1); topCam.position.set(.88, 3, .2); topCam.lookAt(.88, 0, .2); topCam.updateMatrixWorld();
const pipScene = new THREE.Scene(), pipCam = new THREE.Camera();
const pipMat = new THREE.ShaderMaterial({ uniforms: { src: { value: topRT.texture }, a: { value: 0 }, time: { value: 0 }, tx: { value: new THREE.Vector2(1 / 320, 1 / 200) } }, depthTest: false, depthWrite: false, transparent: true,
  vertexShader: `varying vec2 vUv; void main(){ vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: `uniform sampler2D src; uniform float a, time; uniform vec2 tx; varying vec2 vUv;
    void main(){ float h = 0.; for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) h += texture2D(src, vUv + vec2(float(i), float(j)) * tx * 2.4).r * exp(-float(i * i + j * j) * .3);
      h /= 5.2; h *= .8; float bg = .1 + .05 * sin(vUv.y * 140. + time * 4.) * .3 + .04 * fract(sin(dot(vUv * 300., vec2(12.9, 78.2)) + time) * 4e4);
      float v = max(h, bg);
      vec3 c = mix(vec3(.13, .1, .3), vec3(.36, .22, .6), smoothstep(.05, .2, v)); c = mix(c, vec3(.86, .36, .58), smoothstep(.2, .45, v));
      c = mix(c, vec3(1., .66, .34), smoothstep(.45, .7, v)); c = mix(c, vec3(1., .95, .84), smoothstep(.75, .98, v));
      gl_FragColor = vec4(c, a); }` });
{ const q = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)), pipMat); q.frustumCulled = false; pipScene.add(q); }
const PIP = { x: 0, y: 0, w: 0, h: 0, a: 0 };
function limb(a, b, r, k, br = 0) { const A = V(...a), B = V(...b), L = A.distanceTo(B); const g = new THREE.CapsuleGeometry(r, L, 6, 14); const m = new THREE.Mesh(g, heatMat(k, br)); m.position.copy(A).add(B).multiplyScalar(.5); m.quaternion.setFromUnitVectors(V(0, 1, 0), B.clone().sub(A).normalize()); heatScene.add(m); HEATP.push(A, B); }
const ball = (c, r, k, sc = [1, 1, 1]) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), heatMat(k)); m.position.set(...c); m.scale.set(...sc); heatScene.add(m); HEATP.push(m.position.clone()); };
// lying on the left side, knees drawn up, one arm up to the pipe: warm core, cooler limbs
ball([.42, .2, .28], .1, .95, [1.15, 1, .95]);
limb([.5, .2, .3], [.57, .2, .31], .045, .82);
limb([.64, .1, .3], [.64, .36, .32], .07, .8);
limb([.64, .22, .32], [.9, .2, .38], .15, .9, .08); limb([.9, .19, .38], [1.08, .18, .42], .12, .86, .06);
ball([1.12, .18, .44], .14, .78);
limb([1.12, .24, .42], [.98, .26, .08], .075, .62); limb([.98, .26, .08], [1.32, .24, -.05], .055, .52);
limb([1.14, .1, .45], [1.06, .09, .1], .075, .6); limb([1.06, .09, .1], [1.42, .08, 0], .055, .5);
limb([.64, .36, .3], [.45, .55, .12], .045, .62); limb([.45, .55, .12], [.26, .73, .06], .038, .6); ball([.235, .765, .055], .045, .58);
// an open hand flat on the pipe: palm + four fingers + thumb
ball([.215, .8, .05], .042, .56, [1, .55, 1.25]);
[[-.05, .01], [-.017, .03], [.017, .03], [.05, .01]].forEach(([dz, dx]) => limb([.21, .83, .05 + dz * .6], [.16 + dx, .87, .05 + dz * 1.9], .015, .52));
limb([.25, .79, .1], [.24, .84, .15], .015, .5);
for (const m of heatScene.children.slice(-9)) m.material.depthTest = false;   // forearm + hand: out in the open
const ARM = new Set(heatScene.children.slice(-9)), BODY = heatScene.children.filter(m => !ARM.has(m));
limb([.64, .1, .3], [.8, .08, .05], .042, .6); limb([.8, .08, .05], [.95, .08, -.02], .036, .52); ball([.99, .08, -.03], .038, .48);

// dust motes in the void: lit by the torch cone, the gap light and the knocks
const DUSTN = PH ? 1600 : 3200;
const dustU = { time: SU.time, tPos: { value: V() }, tDir: { value: V() }, tOn: { value: 0 }, dPos: { value: V() }, dDir: { value: V() }, dOn: { value: 0 }, dawn: SU.dawn, knock: SU.knock, taps: SU.taps, px: { value: DPR }, vis: SU.vis };
const dust = (() => {
  const g = new THREE.BufferGeometry(), p = new Float32Array(DUSTN * 3), r = new Float32Array(DUSTN);
  for (let i = 0; i < DUSTN; i++) { p[i * 3] = -2.2 + Math.random() * 4.6; p[i * 3 + 1] = Math.random() * 1.6; p[i * 3 + 2] = -2.6 + Math.random() * 5; r[i] = Math.random(); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('rnd', new THREE.BufferAttribute(r, 1));
  const m = new THREE.ShaderMaterial({ uniforms: dustU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float rnd; uniform float time, tOn, dOn, dawn, taps[4], px, vis; uniform vec3 tPos, tDir, dPos, dDir, knock; varying float vB; varying vec3 vC;
      void main(){
        vec3 p = position; float t = time * (.03 + rnd * .04);
        p += vec3(sin(t * 3. + rnd * 40.) * .15, -mod(t * .6 + rnd * 1.6, 1.6) + .8 - .8, cos(t * 2.3 + rnd * 17.) * .15);
        p.y = mod(p.y, 1.6);
        vec3 L = p - tPos; float dl = length(L); float c = smoothstep(.9, .97, dot(L / dl, tDir)) * tOn / (1. + dl * dl * .6);
        vec3 Ld = p - dPos; float dd = length(Ld); float cd = smoothstep(.8, .92, dot(Ld / dd, dDir)) * dOn / (1. + dd * dd);
        float gap = smoothstep(-.6, -2.2, p.z) * (.25 + dawn * 1.2);
        float ring = 0.; float dk = distance(p, knock); for (int i = 0; i < 4; i++) { float a = time - taps[i]; if (a < 0. || a > 4.) continue; ring += exp(-pow((dk - a * 1.9) / (.06 + a * .08), 2.)) * exp(-a * 1.2) * smoothstep(2.4, 1.1, a * 1.9); }
        vB = c * 2.4 + cd * 1.6 + gap * .05 * (.1 + .9 * dawn) + ring * .12;
        vC = mix(mix(vec3(1., .9, .78), vec3(.75, 1., .96), cd / (c + cd + 1e-3)), vec3(1., .78, .55), dawn * gap / (vB + 1e-3));
        vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
        gl_PointSize = px * (.8 + rnd * 1.6) * clamp(1.6 / -mv.z, .4, 2.6);
      }`,
    fragmentShader: `varying float vB; varying vec3 vC; void main(){ vec2 q = gl_PointCoord - .5; float d = dot(q, q); if (d > .25) discard; gl_FragColor = vec4(vC * vB * (1. - d * 4.) * .55, 1.); }` });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; return pts;
})();
setScene.add(dust);
// grit that shakes loose from the slab with each knock
const FALLN = 240;
const fall = (() => {
  const g = new THREE.BufferGeometry(), p = new Float32Array(FALLN * 3), r = new Float32Array(FALLN * 2);
  for (let i = 0; i < FALLN; i++) { p[i * 3] = .21 + (Math.random() - .5) * .9; p[i * 3 + 1] = 1.2; p[i * 3 + 2] = .05 + (Math.random() - .5) * .9; r[i * 2] = Math.random(); r[i * 2 + 1] = Math.random(); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('rnd', new THREE.BufferAttribute(r, 2));
  const m = new THREE.ShaderMaterial({ uniforms: { t0: { value: -99 }, time: SU.time, tPos: dustU.tPos, tDir: dustU.tDir, tOn: dustU.tOn, px: dustU.px }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec2 rnd; uniform float t0, time, tOn, px; uniform vec3 tPos, tDir; varying float vA;
      void main(){ float a = time - t0 - rnd.x * .25; vec3 p = position; float on = step(0., a) * step(a, 1.6);
        p.y = 1.16 - (p.x - .2) * .5 - .5 * 4.2 * a * a; vA = on * (1. - a / 1.6);
        vec3 L = p - tPos; float dl = length(L); vA *= .25 + 2. * smoothstep(.9, .97, dot(L / dl, tDir)) * tOn;
        vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = px * (1. + rnd.y * 1.6) * clamp(1.6 / -mv.z, .4, 3.); }`,
    fragmentShader: `varying float vA; void main(){ vec2 q = gl_PointCoord - .5; if (dot(q, q) > .25) discard; gl_FragColor = vec4(vec3(.95, .88, .8) * vA, 1.); }` });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; return pts;
})();
setScene.add(fall);

// a drone you can actually look at (for the find at dawn)
function makeDrone(scale = 1) {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: C('#E4DEEA'), roughness: .7, metalness: 0 }), dark = new THREE.MeshStandardMaterial({ color: C('#A9A2BE'), roughness: .7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(.13, .045, .2, 2, 1, 2), shell); g.add(body);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(.032, .036, .03, 20), dark); top.position.y = .038; g.add(top);   // lidar puck
  for (const [x, z] of [[.12, .12], [-.12, .12], [.12, -.12], [-.12, -.12]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.012, .012, .17), shell); arm.position.set(x / 2, 0, z / 2); arm.rotation.y = Math.atan2(x, z); g.add(arm);
    const mot = new THREE.Mesh(new THREE.CylinderGeometry(.016, .016, .025, 14), dark); mot.position.set(x, .012, z); g.add(mot);
    const prop = new THREE.Mesh(new THREE.CircleGeometry(.065, 28), new THREE.MeshBasicMaterial({ color: C('#CFC8EA'), transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide })); prop.rotation.x = -Math.PI / 2; prop.position.set(x, .028, z); g.add(prop);
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(.008, 8, 6), new THREE.MeshBasicMaterial({ color: C('#9FF0E8') })); led.position.set(0, 0, .102); g.add(led);
  const cam = new THREE.Mesh(new THREE.SphereGeometry(.018, 14, 10), dark); cam.position.set(0, -.02, .1); g.add(cam);
  g.scale.setScalar(scale); return g;
}
const altRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }); const altCam = new THREE.PerspectiveCamera(45, 1, .03, 200);
const heroDrone = makeDrone(.95); heroDrone.visible = false; setScene.add(heroDrone);
const keyLight = new THREE.DirectionalLight(C('#FFC9A0'), 0); keyLight.position.set(.5, 2, -3); setScene.add(keyLight);

// ---------------------------------------------------------------- loading
const gate = $('#gate'), loadBar = $('.gate-load');
const mgr = new THREE.LoadingManager(); mgr.onProgress = (u, a, b) => { LOADP = (a / b) * .85; if (gateSwarm) gateSwarm.setRecruit(.08 + LOADP * .92); };
const texL = new THREE.TextureLoader(mgr), gltfL = new GLTFLoader(mgr); { const dl = new DRACOLoader(); dl.setDecoderPath('vendor/draco/'); gltfL.setDRACOLoader(dl); }
const tex = (u) => new Promise(r => texL.load(u, t => { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4; r(t); }));
const glb = (u) => new Promise((r, j) => gltfL.load(u, g => r(g.scene), undefined, j));
const meshOf = (root) => { let m = null; root.traverse(o => { if (o.isMesh && !m) m = o; }); return m; };
const S = { P: 0, Ps: 0, time: 0, introT: -1, started: false, tapClock: 1, tapI: 0, ptr: new THREE.Vector2(.2, .1), ptrS: new THREE.Vector2(.2, .1), moved: 0, aimT: 0, found: 0, last: performance.now() };
let solo, maq, setMesh, agent, swarm, occTex, occData, ptsA, ptsS, drones = [], beams, links, radio, pocketLines;
const TX = PH ? '_1k' : '';
Promise.all([glb('act1/assets/maq.glb'), tex(`act1/assets/lm_night${TX}.webp`), tex(`act1/assets/lm_dawn${TX}.webp`), glb('act1/assets/set.glb'), tex(`act1/assets/set_night${TX}.webp`), tex(`act1/assets/set_dawn${TX}.webp`), glb('act1/assets/screen.glb'), glb('act1/assets/phone.glb')]).then(([m, n, d, sm, sn, sd, scr, ph]) => {
  maq = meshOf(m); maq.material = maqMat(n, d); maqScene.add(maq);
  setMesh = meshOf(sm); setMesh.material = setMat(sn, sd); setMesh.castShadow = setMesh.receiveShadow = true; setScene.add(setMesh);
  renderer.localClippingEnabled = true;
  const occ = new THREE.Mesh(setMesh.geometry, new THREE.MeshBasicMaterial({ colorWrite: false, clippingPlanes: [new THREE.Plane(V(0, -1, 0), .6)], side: THREE.DoubleSide }));
  occ.renderOrder = -1; occ.matrixAutoUpdate = false; occ.matrix.copy(setMesh.matrixWorld); heatScene.add(occ); S.occ = occ;
  S.occPlanesMain = occ.material.clippingPlanes; S.occPlanesTop = [new THREE.Plane(V(0, -1, 0), .62), new THREE.Plane(V(0, 1, 0), -.5)];
  const sc = document.createElement('canvas'); sc.width = 256; sc.height = 512; { const x = sc.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, '#5B5FA8'); g.addColorStop(1, '#C88FA6'); x.fillStyle = g; x.fillRect(0, 0, 256, 512);
    x.fillStyle = '#F3EEF2'; x.textAlign = 'center'; x.font = '300 108px Geist, sans-serif'; x.fillText('3:12', 128, 200); x.font = '26px Geist, sans-serif'; x.fillText('Tuesday', 128, 244);
    x.font = '600 28px Geist, sans-serif'; x.fillText('No service', 128, 340); x.font = '24px Geist, sans-serif'; x.fillText('Battery 3%', 128, 376);
    x.font = '20px Geist, sans-serif'; x.textAlign = 'left'; x.fillText('No service', 18, 34); x.textAlign = 'right'; x.fillText('3%', 238, 34);
    x.strokeStyle = '#F3EEF2'; x.lineWidth = 2; x.strokeRect(180, 20, 26, 14); x.fillStyle = '#F08A7E'; x.fillRect(182, 22, 3, 10);
    x.fillStyle = 'rgba(243,238,242,.85)'; x.beginPath(); x.roundRect(70, 470, 116, 6, 3); x.fill(); }
  const stex = new THREE.CanvasTexture(sc); stex.colorSpace = THREE.SRGBColorSpace;
  const screen = meshOf(scr); screen.material = new THREE.MeshBasicMaterial({ map: stex, color: C('#D8D4F0') }); setScene.add(screen); S.screenMat = screen.material;
  const phone = meshOf(ph); phone.material = new THREE.MeshLambertMaterial({ color: C('#2A2A3A') }); phone.castShadow = true; setScene.add(phone);
  setTimeout(() => { build(); ready(); }, 30);
}).catch(e => { console.error(e); $('.gate-ask').textContent = 'The model failed to load. Reload to try again.'; });


// ---------------------------------------------------------------- the unexplored pockets, tracked through the whole mission
// Each step: the separate pieces of unexplored floor (β₀ of the unexplored set). A pocket keeps its identity from step to
// step (it is the piece it shares most cells with), so its number on screen doesn't jump. A pocket that lives for fewer
// than PERSIST moves is a LiDAR shadow behind a doorframe, not a space anyone could be in, so it isn't counted: this is the
// persistence rule from persistent homology. Numbers are small and reused: a new pocket takes the lowest free number.
function trackPockets(mis, truth, steps) {
  const NC = GRID.nx * GRID.nz, PERSIST = 8, MIN = 6, raw = [], life = [];
  let prevOwn = [0, 1, 2, 3].map(() => new Int32Array(NC).fill(-1)), nextId = 0;
  for (let s = 0; s < steps; s++) {
    const list = [];
    for (let f = 0; f < 4; f++) {
      const M = mis.maps[f], T = truth[f], seen = new Uint8Array(NC), own = new Int32Array(NC).fill(-1), prev = prevOwn[f], comps = [];
      for (let c = 0; c < NC; c++) {
        if (seen[c] || T[c] !== 0 || M.free[c] <= s || M.occ[c] <= s) continue;
        const q = [c]; seen[c] = 1; let sx = 0, sz = 0;
        for (let qi = 0; qi < q.length; qi++) { const u = q[qi], i = u % GRID.nx, k = (u / GRID.nx) | 0; sx += i; sz += k;
          for (const [di, dk] of N4P) { const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= GRID.nx || kk >= GRID.nz) continue; const v = kk * GRID.nx + ii; if (!seen[v] && T[v] === 0 && M.free[v] > s && M.occ[v] > s) { seen[v] = 1; q.push(v); } } }
        if (q.length < MIN) continue;
        const votes = new Map(); for (const u of q) { const p = prev[u]; if (p >= 0) votes.set(p, (votes.get(p) || 0) + 1); }
        let best = -1, bv = 0; for (const [p, v] of votes) if (v > bv) { bv = v; best = p; }
        comps.push({ f, cells: Uint16Array.from(q), cx: sx / q.length, cz: sz / q.length, best, bv });
      }
      comps.sort((a, b) => b.bv - a.bv); const taken = new Set();   // on a split, the bigger piece keeps the identity
      for (const p of comps) { let id = p.best; if (id < 0 || taken.has(id)) { id = nextId++; life[id] = { birth: s, last: s }; } taken.add(id); life[id].last = s; p.id = id; for (const u of p.cells) own[u] = id; list.push(p); }
      prevOwn[f] = own;
    }
    raw.push(list);
  }
  const keep = (id) => life[id].last - life[id].birth + 1 >= PERSIST || life[id].last === steps - 1;
  const out = [], count = new Uint8Array(steps), label = new Map();
  for (let s = 0; s < steps; s++) {
    const list = raw[s].filter((p) => keep(p.id)), alive = new Set(list.map((p) => p.id));
    for (const id of [...label.keys()]) if (!alive.has(id)) label.delete(id);
    const used = new Set(label.values());
    for (const p of list) { if (!label.has(p.id)) { let n = 1; while (used.has(n)) n++; label.set(p.id, n); used.add(n); } p.n = label.get(p.id); }
    out.push(list); count[s] = Math.min(255, list.length);
  }
  return { steps: out, count };
}
const N4P = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function build() {
  const t0 = performance.now();
  setMesh.geometry.boundsTree = new MeshBVH(setMesh.geometry);
  const g = maq.geometry.clone(); g.applyMatrix4(maq.matrixWorld); const bvh = new MeshBVH(g); const truth = truthGrids(bvh); S.truth = truth;
  const SURV = V(3.05, .28, -.75);
  agent = runMission(bvh, truth, [{ floor: 0, x: -3.6, z: 3.5 }], { steps: 300, rays: 64, speed: .2, seed: 5, survivor: SURV });
  swarm = runMission(bvh, truth, [{ floor: 0, x: -1.0, z: 3.6 }, { floor: 0, x: 3.2, z: 3.4 }, { floor: 1, x: -4.6, z: 3.6 }, { floor: 1, x: 0.6, z: 3.6 }, { floor: 2, x: -3.0, z: 3.6 }, { floor: 2, x: 1.0, z: 3.4 }, { floor: 3, x: -4.0, z: 3.6 }, { floor: 3, x: 0.2, z: 3.6 }], { steps: 110, rays: 48, speed: .2, seed: 9, survivor: SURV });
  const START8 = [{ floor: 0, x: -1.0, z: 3.6 }, { floor: 0, x: 3.2, z: 3.4 }, { floor: 1, x: -4.6, z: 3.6 }, { floor: 1, x: 0.6, z: 3.6 }, { floor: 2, x: -3.0, z: 3.6 }, { floor: 2, x: 1.0, z: 3.4 }, { floor: 3, x: -4.0, z: 3.6 }, { floor: 3, x: 0.2, z: 3.6 }];
  solo = runMission(bvh, truth, START8, { steps: 110, rays: 48, speed: .2, seed: 9, shared: false });
  S.pk = trackPockets(swarm, truth, swarm.steps); S.pkA = trackPockets(agent, truth, agent.steps); S.pkU = trackPockets(solo, truth, solo.steps);
  S.b0 = S.pk.count; S.done = S.b0.findIndex((b, i) => i > 0 && b === 0);
  { let a = 0; const M = agent.maps[0]; for (let c = 0; c < M.free.length; c++) if (M.free[c] < 65535) a++;
    let t = 0; for (const M2 of swarm.maps) for (let c = 0; c < M2.free.length; c++) if (M2.free[c] <= S.done) t++;
    const cov = (mis, n) => { const out = new Float32Array(n); const add = new Float32Array(n + 1); for (const M of mis.maps) for (let c = 0; c < M.free.length; c++) { const f = Math.min(M.free[c], M.occ[c]); if (f < n) add[f]++; } let acc = 0; for (let i = 0; i < n; i++) { acc += add[i]; out[i] = acc * GRID.cs * GRID.cs; } return out; };
    S.covA = cov(agent, swarm.steps); S.covS = cov(swarm, swarm.steps); S.covU = cov(solo, swarm.steps);
    const cum = (e) => { const o = new Float32Array(e.length); let a = 0; for (let i = 0; i < e.length; i++) { a += e[i]; o[i] = a * GRID.cs * GRID.cs; } return o; };
    S.effS = cum(swarm.effort); S.effU = cum(solo.effort);
    S.covMax = Math.max(S.effU[swarm.steps - 1], S.effS[swarm.steps - 1]); S.doneU = S.pkU.count.findIndex((b, i) => i > 0 && b === 0); }
  console.log('build', (performance.now() - t0) | 0, 'ms');
  occData = new Uint8Array(GRID.nx * GRID.nz * 16); occTex = new THREE.DataTexture(occData, GRID.nx, GRID.nz * 4); occTex.colorSpace = THREE.SRGBColorSpace; occTex.magFilter = occTex.minFilter = THREE.NearestFilter; maq.material.uniforms.occ.value = occTex;
  const ptsMat = () => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { cur: { value: 0 }, on: { value: 0 }, col: { value: C('#7FD4CF') }, px: { value: DPR }, cut: U.cut },
    vertexShader: `attribute float step; uniform float cur, px; varying float vA, vY; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; vY = position.y; float age = cur - step; vA = age < 0. ? 0. : (age < 3. ? 1.5 : .4 + .3 * exp(-age * .05)); gl_PointSize = px * (age < 3. ? 3. : 1.7) * clamp(14. / -mv.z, .5, 2.2); }`,
    fragmentShader: `uniform vec3 col; uniform float on, cut; varying float vA, vY; void main(){ if (vY > cut) discard; vec2 q = gl_PointCoord - .5; float d = dot(q, q); if (d > .25) discard; gl_FragColor = vec4(col * vA * on * (1. - d * 3.), 1.); }` });
  const mkPts = (mis) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(mis.hits.pos, 3)); g.setAttribute('step', new THREE.BufferAttribute(mis.hits.step, 1)); const p = new THREE.Points(g, ptsMat()); p.frustumCulled = false; maqScene.add(p); return p; };
  ptsA = mkPts(agent); ptsS = mkPts(swarm);
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.2, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  for (let i = 0; i < 8; i++) {
    const g = makeDrone(1.6); g.traverse(o => { if (o.material && o.material.isMeshStandardMaterial) o.material = new THREE.MeshBasicMaterial({ color: o.material.color }); });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C('#9FF0E8'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); sp.scale.setScalar(1.25); g.add(sp); g.userData.sp = sp;
    const tr = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3)), new THREE.LineBasicMaterial({ color: C('#7FD4CF'), transparent: true, opacity: .6, blending: THREE.AdditiveBlending, depthWrite: false }));
    tr.frustumCulled = false; maqScene.add(tr); g.userData.trail = tr; g.visible = false; maqScene.add(g); drones.push(g);
  }
  beams = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 6), 3)), new THREE.LineBasicMaterial({ color: C('#7FD4CF'), transparent: true, opacity: .2, blending: THREE.AdditiveBlending, depthWrite: false })); beams.frustumCulled = false; maqScene.add(beams);
  links = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 6), 3)), new THREE.LineDashedMaterial({ color: C('#9FE3DD'), transparent: true, opacity: .32, dashSize: .12, gapSize: .1, depthWrite: false })); links.frustumCulled = false; maqScene.add(links);
  pocketLines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(8000 * 6), 3)), new THREE.LineBasicMaterial({ color: C('#C9B8FF'), transparent: true, opacity: .95, depthTest: false })); pocketLines.frustumCulled = false; pocketLines.renderOrder = 5; maqScene.add(pocketLines);
  const ringGeo = new THREE.RingGeometry(.96, 1, 96); ringGeo.rotateX(-Math.PI / 2);
  radio = new THREE.Group(); for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: C('#EFB1B4'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); r.position.y = .1; radio.add(r); }
  radio.position.set(9.4, .12, 8.1); maqScene.add(radio);
  const clay = new THREE.MeshBasicMaterial({ color: C('#D9D2E2') });
  const van = new THREE.Group(); { const b = new THREE.Mesh(new THREE.BoxGeometry(1.9, .78, .86), clay); b.position.y = .45; const c = new THREE.Mesh(new THREE.BoxGeometry(.55, .55, .84), clay); c.position.set(1.15, .34, 0); van.add(b, c);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(.5, .07, .3), new THREE.MeshBasicMaterial({ color: C('#F08A7E') })); bar.position.set(.9, .88, 0); van.add(bar); van.userData.bar = bar; }
  van.position.set(9.4, .04, 8.1); van.rotation.y = .25; maqScene.add(van); radio.userData.van = van;
  const pool = new THREE.Mesh(new THREE.CircleGeometry(4.5, 48).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { col: { value: C('#F08A7E') }, a: { value: 0 } },
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 col; uniform float a; varying vec2 vU; void main(){ float d = length(vU - .5) * 2.; gl_FragColor = vec4(col * pow(1. - clamp(d, 0., 1.), 2.2) * a, 1.); }` }));
  pool.position.set(10.2, .07, 8.0); maqScene.add(pool); radio.userData.pool = pool;
  const fig = new THREE.CapsuleGeometry(.17, 1.1, 4, 10); fig.translate(0, .72, 0); const head = new THREE.SphereGeometry(.13, 12, 8); head.translate(0, 1.6, 0);
  const armG = new THREE.CapsuleGeometry(.06, .55, 3, 8); S.rescuers = [];
  [[6.6, 6.9], [7.2, 7.3], [5.9, 7.5], [11.6, 7.2], [8.0, 6.6]].forEach(([x, z], i) => { const g = new THREE.Group(); g.add(new THREE.Mesh(fig, clay), new THREE.Mesh(head, clay));
    const a1 = new THREE.Mesh(armG, clay), a2 = new THREE.Mesh(armG, clay); a1.position.set(.22, 1.05, 0); a2.position.set(-.22, 1.05, 0); a1.rotation.z = .25 + (i % 2) * .6; a2.rotation.z = -.2; g.add(a1, a2);
    if (i === 4) { a1.rotation.z = 1.35; a1.position.set(.32, 1.25, 0); }
    g.scale.setScalar(1.45); g.position.set(x, .04, z); g.rotation.y = -1.2 + i * .3; maqScene.add(g); S.rescuers.push(g); });
  const tape = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(-10, .9, 6.1), V(-2, .9, 6.1), V(5, .9, 6.1), V(13.5, .9, 6.1)]), new THREE.LineDashedMaterial({ color: C('#FFC36B'), dashSize: .5, gapSize: .3 })); tape.computeLineDistances(); maqScene.add(tape);
  for (let i = 0; i < 32; i++) { const d = document.createElement('div'); d.className = 'pk'; d.style.opacity = 0; labels.appendChild(d); }
  const cl = document.createElement('div'); cl.className = 'tag'; cl.textContent = 'Rescuers wait at the cordon. Radio reaches a few rooms in.'; document.body.appendChild(cl); S.cordonLabel = cl;
}
function ready() { LOADP = 1; if (gateSwarm) gateSwarm.setRecruit(1); gate.classList.add('ready'); $('#go-sound').disabled = $('#go-quiet').disabled = false; if (Q.has('auto')) start(false); }

// ---------------------------------------------------------------- gate, sound, scroll, pointer
const snd = createSound();
function start(ws) { if (S.started) return; S.started = true; if (!Q.has('auto')) goFull(); S.words = 0; S.tapClock = .9; S.tapI = 0; snd.setEnabled(ws); setSnd(ws); if (gateSwarm) gateSwarm.burst(1400); clearInterval(knockT); gate.classList.add('gone'); document.body.classList.remove('locked'); $('#chrome').hidden = false; S.introT = 0; setTimeout(() => { gate.remove(); if (gateSwarm) { gateSwarm.destroy(); gateSwarm = null; } }, 1600); measure(); const hh = location.hash; if (/act4/i.test(hh)) setTimeout(() => openAct4(), 300); else if (/act3/i.test(hh)) setTimeout(() => openAct3(), 300); else if (/act2/i.test(hh)) setTimeout(() => openAct2(), 300); else if (/contents/i.test(hh)) setTimeout(() => lab.openContents(), 300); else if (/lab|act5/i.test(hh)) setTimeout(() => openAct5(hh.slice(1).startsWith('lab-') ? hh.slice(1) : 'lab-intro'), 300); }
$('#go-sound').onclick = () => start(true); $('#go-quiet').onclick = () => start(false);
const sb = $('#snd'); function setSnd(v) { sb.classList.toggle('on', v); sb.setAttribute('aria-pressed', v); const l = sb.querySelector('.snd-l'); if (l) l.textContent = v ? 'Sound on' : 'Sound off'; } sb.onclick = () => { const v = !snd.on; snd.setEnabled(v); setSnd(v); };
const secs = [...document.querySelectorAll('.ch')], rail = [...document.querySelectorAll('#rail a')];
let tops = [], hs = [], covers = [], merged = [];
// sections that sit on top of the 3-D story (the rescue tools, the disaster zones, the five acts): opaque, so the 3-D can rest under them
function measure() {
  tops = secs.map(s => s.offsetTop); hs = secs.map(s => s.offsetHeight); covers = []; merged = [];
  for (const el of document.querySelectorAll('#story .cover')) {
    const key = el.id === 'tools' ? 'tools' : el.id === 'acts' ? 'acts' : 'beyond', top = el.offsetTop, bottom = top + el.offsetHeight;
    const c = covers[covers.length - 1]; if (c && c.key === key && top <= c.bottom + 2) c.bottom = bottom; else covers.push({ top, bottom, key });
    const m = merged[merged.length - 1]; if (m && top <= m.bottom + 2) m.bottom = bottom; else merged.push({ top, bottom });
  }
}
// inside the lab or the acts index the 3-D story is fully hidden: stop drawing it so the simulations get the GPU
function zones() {
  const y = scrollY, mid = y + innerHeight * .5;
  let z = ''; for (const c of covers) if (mid >= c.top && mid < c.bottom) { z = c.key; break; }
  let cov = false; for (const m of merged) if (y >= m.top + 4 && y + innerHeight <= m.bottom + 2) { cov = true; break; }
  S.cover = cov;
  if (z !== S.zone) { S.zone = z; for (const k of ['tools', 'beyond', 'acts']) document.body.classList.toggle('in-' + k, z === k); }
  railSync();
}
function railSync() { const key = S.zone || String(Math.min(5, Math.floor(S.Ps + .1))); if (key === S.railKey) return; S.railKey = key; rail.forEach((a) => a.classList.toggle('on', a.dataset.k === key)); }
function chapterP() { const y = scrollY; for (let i = secs.length - 1; i >= 0; i--) if (y >= tops[i] - 1) return i + clamp((y - tops[i]) / Math.max(1, hs[i] - innerHeight)); return 0; }
addEventListener('scroll', () => { S.P = chapterP(); zones(); }, { passive: true });
addEventListener('pointerdown', (e) => { S.ptr.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight * 2 - 1)); S.moved = 1; }, { passive: true });
addEventListener('pointermove', (e) => { S.ptr.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight * 2 - 1)); S.moved = 1; fluid.move(e.clientX / innerWidth, 1 - e.clientY / innerHeight); }, { passive: true });

// ---------------------------------------------------------------- camera paths (the set uses metres around the void; the maquette its own)
const SETK = [
  { p: 0.00, pos: [-1.2, .5, 1.95], tgt: [.3, .62, -.15], fov: 50 },
  { p: 0.70, pos: [-.95, .48, 1.62], tgt: [.28, .66, -.1], fov: 48 },
  { p: 0.95, pos: [-.5, .72, -.2], tgt: [.1, 1.0, -3.0], fov: 52 },
  { p: 5.05, pos: [-1.15, .98, -.75], tgt: [.75, .38, .3], fov: 50 },
  { p: 6.00, pos: [-1.35, 1.04, -.9], tgt: [.75, .38, .3], fov: 50 }];
const MAQK = [
  { p: 0.90, pos: [9, 4, 15], tgt: [2.5, 2.5, 0], fov: 40 },
  { p: 1.22, pos: [23, 14.5, 30], tgt: [1.2, 5.0, 0], fov: 36 },
  { p: 1.90, pos: [27, 12.5, 24], tgt: [1.4, 5.0, 0], fov: 35 },
  { p: 2.22, pos: [3.5, 17.5, 15.5], tgt: [-.6, .3, -.4], fov: 40 },
  { p: 2.92, pos: [-1.5, 17.0, 15.0], tgt: [-.8, .3, -.4], fov: 40 },
  { p: 3.10, pos: [-23, 18, 29], tgt: [0, 5.5, 0], fov: 40 },
  { p: 3.90, pos: [-9, 18, 27], tgt: [0, 5.2, 0], fov: 38 },
  { p: 4.20, pos: [-.2, 33, 10.5], tgt: [-1.2, 0, -.2], fov: 33 },
  { p: 5.10, pos: [-.2, 32, 9.5], tgt: [-1.2, 0, -.2], fov: 33 }];
const _a = V(), _b = V();
function poseCam(cam, inSet, P) {
  const k = inSet ? camAt(SETK, P < 3 ? Math.min(P, .95) : P) : camAt(MAQK, P);
  const par = RM ? 0 : (inSet ? .05 : .8);
  cam.position.copy(k.pos); cam.lookAt(k.tgt);
  cam.position.addScaledVector(_v.set(1, 0, 0).applyQuaternion(cam.quaternion), S.ptrS.x * par).addScaledVector(_w.set(0, 1, 0).applyQuaternion(cam.quaternion), S.ptrS.y * par * .4);
  cam.lookAt(k.tgt); cam.fov = k.fov; cam.aspect = innerWidth / innerHeight;
  const w = innerWidth, h = innerHeight;
  if (!PH && w > 900) cam.setViewOffset(w, h, -w * .2, 0, w, h); else if (PH) cam.setViewOffset(w, h, 0, h * .16, w, h); else cam.clearViewOffset();
  cam.updateProjectionMatrix(); cam.updateMatrixWorld();
}
function camAt(K, P) { let i = 0; while (i < K.length - 2 && P > K[i + 1].p) i++; const A = K[i], B = K[i + 1], t = smooth(A.p, B.p, P); return { pos: _a.fromArray(A.pos).lerp(V().fromArray(B.pos), t).clone(), tgt: _b.fromArray(A.tgt).lerp(V().fromArray(B.tgt), t).clone(), fov: lerp(A.fov, B.fov, t) }; }

// ---------------------------------------------------------------- maquette state per step (from A1, plus links + pocket outlines)
let lastPaint = '';
function paintOcc(mis, step, floors) {
  const key = (mis === agent ? 'a' : 's') + step + floors.join(''); if (key === lastPaint) return; lastPaint = key;
  const nx = GRID.nx, nz = GRID.nz, D = occData; D.fill(0);
  for (let f = 0; f < 4; f++) { if (!floors[f]) continue; const M = mis.maps[f], T = S.truth[f];
    for (let c = 0; c < nx * nz; c++) { const o = ((f * nz + ((c / nx) | 0)) * nx + (c % nx)) * 4;
      if (M.occ[c] <= step) { D[o] = 239; D[o + 1] = 177; D[o + 2] = 180; D[o + 3] = 220; continue; }
      if (M.free[c] <= step) { let fr = false; const i = c % nx, k = (c / nx) | 0;
        for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue; const n = kk * nx + ii; if (M.free[n] > step && M.occ[n] > step && T[n] === 0) { fr = true; break; } }
        if (fr) { D[o] = 200; D[o + 1] = 255; D[o + 2] = 250; D[o + 3] = 255; } else { D[o] = 127; D[o + 1] = 212; D[o + 2] = 207; D[o + 3] = 140; } }
      else if (floors[f] === 2 && T[c] === 0) D[o + 3] = 255; } }
  occTex.needsUpdate = true;
}
const stepOf = (mis, t) => Math.round(clamp(t) * (mis.steps - 1));
const _v = V(), _w = V();
function placeDrones(mis, step, n, show, P) {
  const bpos = beams.geometry.attributes.position.array; let nb = 0; const lp = links.geometry.attributes.position.array; let nl = 0;
  const arrive = mis === swarm ? smooth(3.0, 3.35, P) : 1;   // the swarm comes in from the sky first
  for (let i = 0; i < drones.length; i++) {
    const g = drones[i], d = mis && mis.drones[i];
    if (!show || i >= n || !d) { g.visible = false; g.userData.trail.visible = false; continue; }
    const tr = d.track, F = FLOORS[d.f], s = clamp(step, 0, mis.steps - 1);
    const bob = Math.sin(S.time * 3 + i) * .04;
    _v.set(tr[s * 3], F.scan + bob, tr[s * 3 + 1]);
    if (arrive < 1) {   // murmuration in: a loose flock circling down from the sky, then each peels off to its floor
      const a = S.time * .35 + i * .5, r = 16 - 6 * arrive, h = 14 - 6 * arrive + Math.sin(S.time * .9 + i) * 1.2;
      _w.set(Math.cos(a) * r + Math.sin(S.time * .7 + i * 2.1) * 1.5, h, Math.sin(a) * r * .7 + 4);
      _v.lerpVectors(_w, _v, smooth(.55, 1, arrive));
    }
    g.position.copy(_v); g.rotation.y = -tr[s * 3 + 2]; g.visible = g.position.y < U.cut.value + .2 || arrive < 1;
    g.userData.sp.material.opacity = .55 + .45 * Math.sin(S.time * 6 + i);
    const tp = g.userData.trail.geometry.attributes.position.array;
    for (let k = 0; k < 64; k++) { const ss = Math.max(0, s - k * 2); if (arrive < 1) { tp[k * 3] = g.position.x; tp[k * 3 + 1] = g.position.y; tp[k * 3 + 2] = g.position.z; continue; } tp[k * 3] = tr[ss * 3]; tp[k * 3 + 1] = F.scan; tp[k * 3 + 2] = tr[ss * 3 + 1]; }
    g.userData.trail.geometry.attributes.position.needsUpdate = true; g.userData.trail.visible = g.visible && arrive >= 1;
    if (arrive >= 1) { const H = mis.hits; let lo = 0, hi = H.step.length; while (lo < hi) { const m = (lo + hi) >> 1; if (H.step[m] < s) lo = m + 1; else hi = m; }
      for (let k = lo; k < H.step.length && H.step[k] === s && nb < 600; k++) { if (H.floor[k] !== d.f || (mis === swarm && k % 3)) continue; const hx = H.pos[k * 3], hy = H.pos[k * 3 + 1], hz = H.pos[k * 3 + 2]; if (Math.hypot(hx - g.position.x, hz - g.position.z) > 6.6) continue; bpos.set([g.position.x, g.position.y, g.position.z, hx, hy, hz], nb * 6); nb++; } }
  }
  // gossip: neighbours in radio range share coverage (dashed links)
  if (mis === swarm) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const a = drones[i].position, b = drones[j].position; if (!drones[i].visible || !drones[j].visible) continue; if (a.distanceTo(b) < 7.5 && nl < 64) { lp.set([a.x, a.y, a.z, b.x, b.y, b.z], nl * 6); nl++; } }
  beams.geometry.setDrawRange(0, nb * 2); beams.geometry.attributes.position.needsUpdate = true;
  links.geometry.setDrawRange(0, nl * 2); links.geometry.attributes.position.needsUpdate = true; links.computeLineDistances(); links.material.opacity = mis === swarm ? .32 : 0; beams.material.opacity = mis === swarm ? .1 : .2;
}
// unexplored pockets: outline + numbered label, for the floor currently under the plan cut
function pockets(step, lvl, on) {
  const pp = pocketLines.geometry.attributes.position.array; let n = 0; const lab = labels.children;
  if (on > .01 && S.pk) {
    const list = S.pk.steps[Math.min(step, S.pk.steps.length - 1)];
    for (const p of list) {
      if (p.f !== lvl) continue;
      const y = FLOORS[p.f].top + .03, inP = new Set(p.cells);
      for (const u of p.cells) { const i = u % GRID.nx, kk = (u / GRID.nx) | 0; const x0 = GRID.x0 + i * GRID.cs, z0 = GRID.z0 + kk * GRID.cs, x1 = x0 + GRID.cs, z1 = z0 + GRID.cs;
        const seg = (ax, az, bx, bz) => { if (n < 8000) { pp.set([ax, y, az, bx, y, bz], n * 6); n++; } };
        if (!inP.has(u - 1) || i === 0) seg(x0, z0, x0, z1); if (!inP.has(u + 1)) seg(x1, z0, x1, z1); if (!inP.has(u - GRID.nx)) seg(x0, z0, x1, z0); if (!inP.has(u + GRID.nx)) seg(x0, z1, x1, z1); }
      const el = lab[Math.min(lab.length - 1, p.n - 1)]; if (el) { _v.set(GRID.x0 + (p.cx + .5) * GRID.cs, y, GRID.z0 + (p.cz + .5) * GRID.cs).project(camera); el.style.left = ((_v.x * .5 + .5) * innerWidth) + 'px'; el.style.top = ((-_v.y * .5 + .5) * innerHeight) + 'px'; el.textContent = p.n; el.style.opacity = on; el.dataset.used = 1; }
    }
  }
  for (const el of lab) { if (!el.dataset.used) el.style.opacity = 0; delete el.dataset.used; }
  pocketLines.geometry.setDrawRange(0, n * 2); pocketLines.geometry.attributes.position.needsUpdate = true; pocketLines.material.opacity = on;
}

// ---------------------------------------------------------------- overlay: the heat signature + the camera's confirmation
function pipOverlay() {
  if (PIP.a < .01) return;
  const { x, y, w: pw, h: ph, a } = PIP; g2.globalAlpha = a;
  g2.strokeStyle = 'rgba(255,226,184,.55)'; g2.lineWidth = 1; g2.strokeRect(x + .5, y + .5, pw - 1, ph - 1);
  // brackets on the body (projected from the top camera)
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const q of HEATP) { _v.copy(q).project(topCam); const X = x + (_v.x * .5 + .5) * pw, Y = y + (-_v.y * .5 + .5) * ph; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); }
  x0 = Math.max(x + 6, x0 - 10); y0 = Math.max(y + 6, y0 - 10); x1 = Math.min(x + pw - 6, x1 + 10); y1 = Math.min(y + ph - 6, y1 + 10); const L = 10; g2.strokeStyle = '#FFC36B'; g2.lineWidth = 1.5; g2.beginPath();
  [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].forEach(([X, Y, sx, sy]) => { g2.moveTo(X + sx * L, Y); g2.lineTo(X, Y); g2.lineTo(X, Y + sy * L); }); g2.stroke();
  const pill = (X, Y, W, H) => { g2.fillStyle = 'rgba(30,33,64,.78)'; g2.beginPath(); g2.roundRect(X, Y, W, H, 8); g2.fill(); };
  g2.font = `500 ${PH ? 12 : 13}px Geist, sans-serif`; const t0 = 'Drone thermal camera, looking down'; pill(x, y - 30, g2.measureText(t0).width + 20, 24);
  g2.textBaseline = 'middle'; g2.fillStyle = '#FFE2B8'; g2.fillText(t0, x + 10, y - 18);
  const t1 = 'Person: thermal and camera agree', t2 = '35.2 °C, 0.4 m under rubble, a hand on the pipe';
  g2.font = `${PH ? 11 : 12}px "Geist Mono", monospace`; const w2 = g2.measureText(t2).width; g2.font = `500 ${PH ? 12 : 13}px Geist, sans-serif`;
  pill(x, y + ph + 6, Math.max(g2.measureText(t1).width, w2) + 20, 46);
  g2.textBaseline = 'top'; g2.fillStyle = '#FFE2B8'; g2.fillText(t1, x + 10, y + ph + 13);
  g2.font = `${PH ? 11 : 12}px "Geist Mono", monospace`; g2.fillStyle = 'rgba(255,226,184,.8)'; g2.fillText(t2, x + 10, y + ph + 31);
  g2.globalAlpha = 1;
}
function heatOverlay(a, conf, P) {
  const w = innerWidth, h = innerHeight; g2.setTransform(DPR, 0, 0, DPR, 0, 0); g2.clearRect(0, 0, w, h);
  if (conf < .01) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of HEATP) { _v.copy(p).project(camera); const x = (_v.x * .5 + .5) * w, y = (-_v.y * .5 + .5) * h; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const pad = 18; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad; const L = 16;
  g2.globalAlpha = conf; g2.strokeStyle = '#FFC36B'; g2.lineWidth = 1.5; g2.beginPath();
  [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].forEach(([x, y, sx, sy]) => { g2.moveTo(x + sx * L, y); g2.lineTo(x, y); g2.lineTo(x, y + sy * L); });
  g2.stroke();
  g2.textBaseline = 'bottom'; g2.font = `500 ${PH ? 12 : 13}px Geist, sans-serif`; g2.fillStyle = '#FFE2B8';
  const l1 = 'Person: thermal and camera agree', l2 = '35.2 °C, 0.4 m under rubble';
  g2.font = `500 ${PH ? 12 : 13}px Geist, sans-serif`; const w1 = g2.measureText(l1).width; g2.font = `${PH ? 11 : 12}px "Geist Mono", monospace`; const w2 = g2.measureText(l2).width;
  const bw = Math.max(w1, w2) + 24, bx = Math.min(w - bw - 16, Math.max(x0, x1 - bw)), by = y1 + 12;
  g2.fillStyle = 'rgba(30,33,64,.72)'; g2.beginPath(); g2.roundRect(bx, by, bw, 48, 10); g2.fill();
  g2.textBaseline = 'top'; g2.fillStyle = '#FFE2B8'; g2.font = `500 ${PH ? 12 : 13}px Geist, sans-serif`; g2.fillText(l1, bx + 12, by + 8);
  g2.font = `${PH ? 11 : 12}px "Geist Mono", monospace`; g2.fillStyle = 'rgba(255,226,184,.8)'; g2.fillText(l2, bx + 12, by + 27);
  g2.globalAlpha = 1;
}
// ---------------------------------------------------------------- per frame
// the four floors as a small drawing: what's mapped, and each unexplored pocket outlined and numbered
const miniC = $('#mini'), mx = miniC.getContext('2d'); let miniKey = -1;
const FN = ['Ground', 'First', 'Second', 'Third'];
function mini(step) {
  if (step === miniKey) return; miniKey = step;
  const cs = PH ? 1.25 : 1.9, tw = GRID.nx * cs, th = GRID.nz * cs, gap = 10, top = 18, d = Math.min(2, devicePixelRatio || 1);
  const W = tw * 4 + gap * 3, H = th + top; if (miniC.width !== W * d) { miniC.width = W * d; miniC.height = H * d; miniC.style.width = W + 'px'; miniC.style.height = H + 'px'; }
  mx.setTransform(d, 0, 0, d, 0, 0); mx.clearRect(0, 0, W, H); let n = 0;
  const lit = document.body.classList.contains('lit'), ink = lit ? '#2B2F5E' : '#DCE4EE';
  for (const f of [0, 1, 2, 3]) {
    const ox = f * (tw + gap), oy = top, M = swarm.maps[f], T = S.truth[f];
    mx.font = '500 12px Geist, sans-serif'; mx.fillStyle = ink; mx.globalAlpha = .8; mx.fillText(FN[f], ox, oy - 6); mx.globalAlpha = 1;
    for (let c = 0; c < GRID.nx * GRID.nz; c++) { if (T[c] === 2) continue; const i = c % GRID.nx, k = (c / GRID.nx) | 0;
      mx.fillStyle = M.occ[c] <= step ? '#EFB1B4' : (M.free[c] <= step ? 'rgba(127,212,207,.75)' : (lit ? 'rgba(43,47,94,.12)' : 'rgba(220,228,238,.1)')); mx.fillRect(ox + i * cs, oy + k * cs, cs - .4, cs - .4); }
    for (const p of S.pk.steps[Math.min(step, S.pk.steps.length - 1)]) { if (p.f !== f) continue;
      const inP = new Set(p.cells); mx.strokeStyle = '#B9A6F2'; mx.lineWidth = 1.2; mx.beginPath();
      for (const u of p.cells) { const i = u % GRID.nx, k = (u / GRID.nx) | 0, X = ox + i * cs, Y = oy + k * cs;
        if (!inP.has(u - 1)) { mx.moveTo(X, Y); mx.lineTo(X, Y + cs); } if (!inP.has(u + 1)) { mx.moveTo(X + cs, Y); mx.lineTo(X + cs, Y + cs); }
        if (!inP.has(u - GRID.nx)) { mx.moveTo(X, Y); mx.lineTo(X + cs, Y); } if (!inP.has(u + GRID.nx)) { mx.moveTo(X, Y + cs); mx.lineTo(X + cs, Y + cs); } }
      mx.stroke(); const LX = ox + (p.cx + .5) * cs, LY = oy + (p.cz + .5) * cs;
      mx.fillStyle = '#B9A6F2'; mx.beginPath(); mx.arc(LX, LY, 7, 0, 7); mx.fill(); mx.fillStyle = '#1E2140'; mx.font = '600 10px Geist, sans-serif'; mx.textAlign = 'center'; mx.textBaseline = 'middle'; mx.fillText(p.n, LX, LY + .5); mx.textAlign = 'left'; mx.textBaseline = 'alphabetic'; }
  }
}
// the β₀ curve over the whole swarm mission, with a marker at the step on screen
const sparkC = document.getElementById('b0spark'); let sparkKey = -1;
function b0spark(step) {
  if (!sparkC || !swarm || step === sparkKey) return; sparkKey = step;
  const d = Math.min(2, devicePixelRatio || 1), W = 260, H = 46; if (sparkC.width !== W * d) { sparkC.width = W * d; sparkC.height = H * d; sparkC.style.width = W + 'px'; sparkC.style.height = H + 'px'; }
  const x = sparkC.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, W, H);
  const N = Math.max(1, (S.done > 0 ? S.done : swarm.steps - 1)), B = S.b0; let mx = 1; for (let i = 0; i <= N; i++) mx = Math.max(mx, B[i]);
  const lit = document.body.classList.contains('lit'), ink = lit ? 'rgba(43,47,94,' : 'rgba(220,214,236,';
  const px = (i) => 2 + i / N * (W - 4), py = (v) => H - 12 - v / mx * (H - 18);
  x.strokeStyle = ink + '.18)'; x.lineWidth = 1; x.beginPath(); x.moveTo(2, H - 12); x.lineTo(W - 2, H - 12); x.stroke();
  x.strokeStyle = ink + '.38)'; x.lineWidth = 1.4; x.beginPath(); for (let i = 0; i <= N; i++) { const X = px(i), Y = py(B[i]); i ? x.lineTo(X, Y) : x.moveTo(X, Y); } x.stroke();
  const s = Math.min(step, N); x.strokeStyle = lit ? '#6D4AA8' : '#B9A6F2'; x.lineWidth = 2; x.beginPath(); for (let i = 0; i <= s; i++) { const X = px(i), Y = py(B[i]); i ? x.lineTo(X, Y) : x.moveTo(X, Y); } x.stroke();
  x.fillStyle = lit ? '#6D4AA8' : '#B9A6F2'; x.beginPath(); x.arc(px(s), py(B[s]), 3, 0, 7); x.fill();
  x.font = '11px Geist, sans-serif'; x.fillStyle = ink + '.6)'; x.fillText('the count over the whole search', 2, H - 1);
}
const hookH = $('#hook-h'), hookP = $('#hook-p'), elA = $('#a-cov'), elB = $('#beta'), elBn = $('#beta-note');
const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
function found() { if (S.found) return; S.found = S.time; document.body.dataset.words = 3; hookH.textContent = 'There. Still warm.'; hookP.textContent = 'Under the rubble, one hand on the pipe. You found them by sound and by heat; rescuers outside can do neither through concrete.'; snd.blip(660, .05, .6); setTimeout(() => snd.blip(990, .04, .8), 140); $('#showme').hidden = true; }
$('#showme').onclick = () => { _v.copy(SU.knock.value).project(camera); S.ptr.set(_v.x, _v.y); S.auto = 1; setTimeout(found, 900); };
const Q8 = { n: 0, sum: 0, level: 0 };
function adapt(dt) {
  if (Q8.level >= 2 || S.introT < 1.5 || Q.has('auto')) return;
  Q8.n++; Q8.sum += dt;
  if (Q8.n < 90) return;
  const ms = Q8.sum / Q8.n * 1000; Q8.n = 0; Q8.sum = 0;
  if (ms > 26 && Q8.level === 0) { Q8.level = 1; renderer.setPixelRatio(1); composer.setPixelRatio ? composer.setPixelRatio(1) : 0; resize(); bloom.enabled = false; console.log('quality 1', ms.toFixed(1)); }
  else if (ms > 40 && Q8.level === 1) { Q8.level = 2; torch.castShadow = false; droneLight.castShadow = false; finish.uniforms.dofAmt.value = 0; S.noDof = true; console.log('quality 2', ms.toFixed(1)); }
}
function tick(dt) {
  adapt(dt);
  S.time += dt; U.time.value = SU.time.value = S.time; finish.uniforms.time.value = S.time; if (S.introT >= 0) S.introT += dt;
  S.Ps += (S.P - S.Ps) * (1 - Math.exp(-dt * (S.snap ? 1e3 : 5))); const P = S.Ps;
  const inSet = P < .93 || P > 5.07;
  S.preT = (S.preT || 0) + dt;
  finish.uniforms.dark.value = S.introT < 0 ? lerp(1, .42, smooth(.3, 2.5, S.preT)) : .42 * (1 - smooth(.2, 2.2, S.introT));
  if (inSet) { finish.uniforms.dofMode.value = 1; finish.uniforms.dofAmt.value = RM || S.noDof ? 0 : .9; finish.uniforms.dofR.value.set(.2, .75); }
  else { finish.uniforms.dofMode.value = 2; finish.uniforms.dofAmt.value = RM || S.noDof ? 0 : (P > 4.05 && P < 5.1 ? .35 : .7); finish.uniforms.dofR.value.set(.22, .62); finish.uniforms.focus.value.set(.5, PH ? .62 : .5); }
  rpass.scene = inSet ? setScene : maqScene; bloom.strength = inSet && P > 5 ? .32 : .5;
  // dust drifts across every change of scene
  finish.uniforms.fade.value = Math.max(1 - Math.abs(P - .93) / .07, 1 - Math.abs(P - 5.07) / .07, 0);
  // during a swap, render the other set from its own camera into a texture
  const sw1 = clamp((P - .86) / .14), sw2 = clamp((P - 5.0) / .14);
  const swapping = (sw1 > 0 && sw1 < 1) || (sw2 > 0 && sw2 < 1);
  finish.uniforms.altOn.value = 0;
  finish.uniforms.fadeCol.value.set(P < 3 ? '#3B3E7A' : '#E9C6C4');
  const dawnMaq = smooth(3.0, 4.9, P), dawnSet = smooth(5.0, 5.3, P);
  U.dawn.value = dawnMaq; sky.material.uniforms.dawn.value = dawnMaq; SU.dawn.value = dawnSet;
  document.body.classList.toggle('lit', (P > 4.15 && P < 5.0)); document.body.classList.toggle('final', P > 5.35);
  document.body.style.setProperty('--lt', (P > 4.15 && P < 5.0) ? 1 : 0);
  const S2 = renderer.domElement;
  // ---------------- camera
  S.ptrS.lerp(S.ptr, 1 - Math.exp(-dt * 4));
  const w = innerWidth, h = innerHeight;
  poseCam(camera, inSet, P);
  // ---------------- the void
  if (inSet) {
    const night = P < 3;
    SU.vis.value = night ? lerp(.2, .55, smooth(.75, .95, P)) : .82;
    // torch: from just beside the camera along the pointer ray
    const tOn = night ? (S.introT < 0 ? 0 : smooth(.3, 1.4, S.introT)) * (1 - smooth(.8, .93, P)) : 0;
    ray.setFromCamera(S.ptrS, camera);
    const hits = setMesh ? ray.intersectObject(setMesh, false) : [];
    const aim = hits.length ? hits[0].point : ray.ray.at(3, V());
    torch.position.copy(camera.position).addScaledVector(_v.set(1, 0, 0).applyQuaternion(camera.quaternion), .14).addScaledVector(_w.set(0, 1, 0).applyQuaternion(camera.quaternion), -.06);
    torch.target.position.lerp(aim, 1 - Math.exp(-dt * 10)); torch.intensity = 11 * tOn; torch.visible = tOn > .01;
    beam.position.copy(torch.position); beam.lookAt(torch.target.position); beam.material.uniforms.on.value = tOn; beam.material.uniforms.time.value = S.time;
    dustU.tPos.value.copy(torch.position); dustU.tDir.value.subVectors(torch.target.position, torch.position).normalize(); dustU.tOn.value = tOn;
    // find the knocking: hold the torch on it
    if (night && !S.found && tOn > .5) {
      const d = aim.distanceTo(SU.knock.value);
      S.aimT = d < .38 ? S.aimT + dt : Math.max(0, S.aimT - dt * 2);
      if (S.aimT > .7) found();
    }
    // the find at dawn: a drone hovering, its light on them, warm sun through the gap
    const fin = smooth(5.1, 5.45, P);
    heroDrone.visible = fin > .01; heroDrone.position.set(lerp(-.2, -.42, fin), lerp(1.15, .9, fin) + Math.sin(S.time * 2) * .012, lerp(-1.6, -.18, fin)); heroDrone.lookAt(.8, .5, .3);
    heroDrone.children.forEach(c => { if (c.geometry && c.geometry.type === 'CircleGeometry') c.rotation.z = S.time * 50; });
    droneLight.intensity = 3.2 * fin; droneLight.position.copy(heroDrone.position).add(_v.set(0, -.03, 0)); droneLight.target.position.lerp(V(.8, .25, .3), .2);
    dbeam.position.copy(droneLight.position); dbeam.lookAt(droneLight.target.position); dbeam.material.uniforms.on.value = fin * 1.4; dbeam.material.uniforms.time.value = S.time;
    sunFill.intensity = .35 * dawnSet; keyLight.intensity = 1.2 * dawnSet;
    dustU.dPos.value.copy(droneLight.position); dustU.dDir.value.subVectors(droneLight.target.position, droneLight.position).normalize(); dustU.dOn.value = fin;
    setScene.fog.color.set(night ? '#1E2140' : '#3A3566'); setScene.background.copy(setScene.fog.color); setScene.fog.density = night ? .08 : .05;
    BREATH.value = Math.sin(S.time * 1.55);
    const kp = Math.max(0, 1 - (S.time - SU.taps.value[(S.tapI + 3) % 4]) * 1.4);
    const heatA = night ? smooth(0, 1.5, S.found ? S.time - S.found : -1) * (1 - smooth(.8, .93, P)) * (.75 + .35 * kp) : 0;
    PIP.a = night ? 0 : smooth(5.42, 5.6, P);
    finish.uniforms.heatAmt.value = heatA;
    if (heatA > .001) { for (const m of BODY) m.visible = !night; renderer.setRenderTarget(heatRT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(heatScene, camera); renderer.setRenderTarget(null); }
    heatOverlay(heatA, 0, P); pipOverlay();
    const PHONE = V(-.28, .04, .62); const onPhone = night && aim.distanceTo(PHONE) < .35;
    _v.copy(onPhone ? PHONE : (night ? (tOn > .3 ? torch.target.position : SU.knock.value) : V(.6, .4, .3))).project(camera); finish.uniforms.focus.value.lerp(new THREE.Vector2(_v.x * .5 + .5, _v.y * .5 + .5), 1 - Math.exp(-dt * 3));
    if (S.screenMat) S.screenMat.color.setScalar(onPhone ? 1.25 : .85);
  } else { g2.setTransform(1, 0, 0, 1, 0, 0); g2.clearRect(0, 0, ov.width, ov.height); finish.uniforms.heatAmt.value = 0; }
  // knocks
  const near = P < 1 ? 1 : (P > 5.07 ? .6 : 0);
  if ((S.introT > .7 || (S.introT < 0 && S.preT > 1.2)) && near > 0 && (S.tapClock -= dt) <= 0) {
    const kk = S.tapI % 3;
    if (S.introT >= 0 && S.words < 3) { S.words++; document.body.dataset.words = S.words; } SU.taps.value[S.tapI % 4] = S.time; S.tapI++;
    fall.material.uniforms.t0.value = kk === 0 ? S.time : fall.material.uniforms.t0.value;
    snd.place(SU.knock.value, camera); snd.tap(near * (kk === 2 ? 1 : .85));
    S.tapClock = kk === 2 ? 2.5 + Math.random() * .6 : .3;
  }
  // ---------------- the maquette
  if (!inSet && agent) {
    let cut = 99;
    if (P > 1.75 && P < 3.2) cut = lerp(14, 1.95, smooth(1.8, 2.25, P)) + 12 * smooth(2.95, 3.1, P);
    let lvl = -1;
    if (P >= 4.05) { const t = smooth(4.05, 4.2, P); lvl = 0; cut = lerp(99, FLOORS[0].top + 1.75, t); }
    U.cut.value = cut;
    let mis = null, step = 0, nShow = 0, floors = [0, 0, 0, 0], mapOn = 0, pOn = [0, 0];
    if (P > 1.9 && P < 3.0) { mis = agent; step = stepOf(agent, (P - 2.12) / .8); nShow = 1; floors = [1, 0, 0, 0]; mapOn = smooth(1.95, 2.15, P) * (1 - smooth(2.9, 3.0, P)); pOn[0] = mapOn; }
    else if (P >= 3.0) { mis = swarm; const t = P < 4.2 ? lerp(0, .5, clamp((P - 3.3) / .75)) : lerp(.5, 1, clamp((P - 4.22) / .6)); step = stepOf(swarm, t);
      // a flick of the wheel must not race the count down: the shown step walks toward the scrolled one at a capped pace
      S.swStep = S.swStep == null ? step : S.swStep + clamp(step - S.swStep, -dt * 9, dt * 9); step = Math.round(S.swStep); nShow = 8; floors = P > 4.1 ? [2, 2, 2, 2] : [1, 1, 1, 1]; mapOn = smooth(3.0, 3.2, P); pOn[1] = mapOn; }
    if (mis !== swarm) S.swStep = null;
    U.mapOn.value = mapOn; U.floorOn.value.set(...floors.map(x => x ? 1 : 0)); U.unkPulse.value = .5 + .5 * Math.sin(S.time * 3);
    if (mis) paintOcc(mis, step, floors);
    ptsA.material.uniforms.on.value = pOn[0]; ptsA.material.uniforms.cur.value = mis === agent ? step : 0;
    ptsS.material.uniforms.on.value = pOn[1]; ptsS.material.uniforms.cur.value = mis === swarm ? step : 0;
    placeDrones(mis, step, nShow, !!mis && mapOn > .02, P);
    pockets(step, lvl, mis === swarm ? smooth(4.1, 4.25, P) : 0);
    if (mis === agent) { let a = 0; const M = agent.maps[0]; for (let c = 0; c < M.free.length; c++) if (Math.min(M.free[c], M.occ[c]) <= step) a++; elA.textContent = `${Math.round(a * GRID.cs * GRID.cs)} m² mapped by this drone in ${step} moves`; }
    if (mis === swarm) { mini(step);
      const N = swarm.steps - 1, rs = Math.round(clamp((P - 3.12) / .7) * N);   // the race runs on its own clock so it finishes inside this chapter
      const dS = S.done, dU = S.doneU < 0 ? N : S.doneU, M = S.effU[dU] * 1.04, pc = (v) => (v / M * 100).toFixed(1) + '%';
      const sS = S.covS[Math.min(rs, dS)], uU = S.covU[Math.min(rs, dU)], wU = S.effU[Math.min(rs, dU)] - uU, a1 = S.covA[rs];
      $('#r8').style.width = pc(sS); $('#ru').style.width = pc(uU); $('#ruw').style.left = pc(uU); $('#ruw').style.width = pc(wU); $('#r1').style.width = pc(a1);
      $('#r8v').textContent = rs >= dS ? `done, ${dS} moves` : `${Math.round(sS)} m²`; $('#ruv').textContent = rs >= dU ? `done, ${dU} moves` : `${Math.round(uU + wU)} m²`;
      $('#r1v').textContent = rs >= N ? `still flying` : `${Math.round(a1)} m²`;
      $('#rc').textContent = rs < dS ? '' : (rs < dU ? `LIMINAL is done: ${Math.round(S.covS[dS])} m², nothing searched twice. The eight that don't share are still going.` : `To cover the same building, the eight that don't share flew ${Math.round(S.effU[dU])} m², nearly twice LIMINAL's ${Math.round(S.covS[dS])} m². One drone alone still has ${S.pkA.count[N]} pockets left on the ground floor.`);
      // β₀: shown calmly (at most ~3 changes a second), with the whole mission's curve beside it so a brief rise reads as a split, not noise
      const b = S.b0[step];
      const nowR = performance.now() / 1000; if (S.bShown !== b && (nowR - (S.bT || 0) > .32 || b === 0)) { S.bShown = b; S.bT = nowR; elB.textContent = b; elBn.textContent = b === 0 ? 'nothing left unexplored: the search can end' : (b === 1 ? 'unexplored pocket left' : 'unexplored pockets left'); }
      b0spark(S.bShown == null ? 0 : step); }
    const rOn = smooth(1.05, 1.25, P) * (1 - smooth(1.85, 2.0, P));
    if (S.rescuers) for (const g of S.rescuers) g.visible = P > 1.05;
    if (S.cordonLabel) { _v.set(4.6, 2.2, 8.2).project(camera); const lw = S.cordonLabel.offsetWidth || 320; const lx = Math.min(innerWidth - lw - 56, Math.max(innerWidth * .42, (_v.x * .5 + .5) * innerWidth - lw)); S.cordonLabel.style.transform = `translate(${lx}px, ${(-_v.y * .5 + .5) * innerHeight}px)`; S.cordonLabel.style.opacity = rOn; }
    radio.children.forEach((r, i) => { const a = ((S.time * .35 + i / 3) % 1); r.scale.setScalar(.4 + a * 9); r.material.opacity = rOn * (1 - a) * .8; });
    if (radio.userData.van) { const on = Math.sin(S.time * 9) > 0; radio.userData.van.userData.bar.material.color.set(on ? '#F08A7E' : '#9C98D0'); radio.userData.pool.material.uniforms.col.value.set(on ? '#F08A7E' : '#8F8CC4'); radio.userData.pool.material.uniforms.a.value = .35 * (1 - dawnMaq); }
    snd.st.drones = mis ? mapOn * (mis === agent ? .6 : 1) : 0; snd.st.swarm = mis === swarm ? mapOn : 0;
  } else { for (const el of labels.children) el.style.opacity = 0; if (S.cordonLabel) S.cordonLabel.style.opacity = 0; snd.st.drones = P > 5.07 ? smooth(5.1, 5.5, P) * .5 : 0; snd.st.swarm = 0; }
  // text
  secs.forEach((s, i) => { let o; const l = P - i;
    if (i === 0) o = (S.introT > 0 ? 1 : 0) * (1 - smooth(.62, .85, l));
    else o = smooth(-.05, .12, l) * (i === secs.length - 1 ? 1 : 1 - smooth(.86, 1, l));
    s.firstElementChild.style.setProperty('--o', o.toFixed(3)); });
  railSync();
  $('#hint').classList.toggle('off', !(P < .5 && S.introT > 2.5 && !S.found));
  if (!S.found && S.introT > 12 && !S.helped) { S.helped = 1; $('#hint').textContent = 'Listen closely: it is coming from near the pipe.'; }
  if (!S.found && S.introT > 7 && P < .6) $('#showme').hidden = false;
  snd.st.dawn = Math.max(dawnMaq * .6, dawnSet); snd.st.muffle = inSet ? 1 : .6; snd.update(dt);
  if (swapping) {
    // inSet is decided at P=.93 / 5.07; the alt scene is whichever set we are going to (or coming from)
    const T1 = sw1 > 0 && sw1 < 1, t = T1 ? sw1 : sw2;
    poseCam(altCam, !inSet, inSet ? (P < 3 ? .96 : 5.06) : (P < 3 ? .92 : 5.08));
    renderer.setRenderTarget(altRT); renderer.render(inSet ? maqScene : setScene, altCam); renderer.setRenderTarget(null);
    finish.uniforms.alt.value = altRT.texture;
    // current frame shows "from" until the midpoint and "to" after: the dust front always moves forward
    finish.uniforms.altOn.value = t; finish.uniforms.altInv.value = (T1 ? P >= .93 : P >= 5.07) ? 1 : 0;
  }
  if (PIP.a > .01) { for (const m of BODY) m.visible = true; if (S.occ) S.occ.material.clippingPlanes = S.occPlanesTop; renderer.setRenderTarget(topRT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(heatScene, topCam); renderer.setRenderTarget(null); if (S.occ) S.occ.material.clippingPlanes = S.occPlanesMain; }
  fluid.update(dt, w / h); finish.uniforms.vel.value = fluid.velocity;
  composer.render(dt);
  if (PIP.a > .01) {
    _v.copy(heroDrone.position).project(camera); const dy = (-_v.y * .5 + .5) * h;
    const pw = PH ? Math.min(w - 32, 300) : Math.min(380, w * .3), ph = pw * .625, px = PH ? 16 : Math.min(w * .55, w - pw - 120), py = PH ? 96 : (dy < h * .5 ? h * .5 : h * .14);
    Object.assign(PIP, { x: px, y: py, w: pw, h: ph }); pipMat.uniforms.a.value = PIP.a; pipMat.uniforms.time.value = S.time;
    renderer.setScissorTest(true); renderer.setScissor(px, h - py - ph, pw, ph); renderer.setViewport(px, h - py - ph, pw, ph);
    renderer.autoClear = false; renderer.render(pipScene, pipCam); renderer.autoClear = true;
    renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h);
  }
}
let raf = 0, running = true;
// ---------------------------------------------------------------- full screen (browsers only allow it from a click, so Enter asks for it)
const FS = document.documentElement;
function goFull() { if (document.fullscreenElement || document.webkitFullscreenElement) return; const f = FS.requestFullscreen || FS.webkitRequestFullscreen; if (f) try { const r = f.call(FS, { navigationUI: 'hide' }); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
function toggleFull() { if (document.fullscreenElement || document.webkitFullscreenElement) { const x = document.exitFullscreen || document.webkitExitFullscreen; if (x) x.call(document); } else goFull(); }
$('#fs').onclick = toggleFull;
addEventListener('keydown', (e) => { if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && !act2 && !act3 && !act4 && !act5Open && !/input|textarea|select/i.test(e.target.tagName)) toggleFull(); });
const fsSync = () => $('#fs').classList.toggle('on', !!(document.fullscreenElement || document.webkitFullscreenElement));
document.addEventListener('fullscreenchange', fsSync); document.addEventListener('webkitfullscreenchange', fsSync);
// ---------------------------------------------------------------- Act 2 opens in this page; ending it brings you back here
const ACT2_BASE = 'act2/assets/';
let act2 = null, act2Opening = false, sndWas = false, zonesCtl = null;
const act2Host = $('#act2host');
function pauseAct1() { cancelAnimationFrame(raf); running = false; sndWas = snd.on; if (snd.on) snd.setEnabled(false); if (zonesCtl) zonesCtl.pauseAll(); }
function resumeAct1() { if (running) return; running = true; S.last = performance.now(); raf = requestAnimationFrame(frame); if (sndWas) snd.setEnabled(true); if (zonesCtl) zonesCtl.resumeAll(); }
async function openAct2() {
  if (act2 || act2Opening) return; if (act5Open) closeAct5(); act2Opening = true; goFull();
  S.retY = scrollY; act2Host.hidden = false; document.body.classList.add('in-act2'); pauseAct1();
  try {
    const { createAct2 } = await import('../act2/js/act2.js');
    act2 = await createAct2(act2Host, { base: ACT2_BASE, onExit: closeAct2 });
    window.__act = act2;
  } catch (e) { console.error(e); act2Host.querySelector('.a2wait').textContent = 'Act 2 could not load here. Press Esc or reload the page.'; }
  act2Opening = false;
}
function closeAct2() {
  if (act2) { act2.destroy(); act2 = null; }
  for (const n of [...act2Host.children]) if (!n.classList.contains('a2wait')) n.remove();
  act2Host.hidden = true; document.body.classList.remove('in-act2'); resumeAct1();
  backTo();
}
$('#fly').addEventListener('click', (e) => { e.preventDefault(); openAct2(); });
// ---------------------------------------------------------------- Act 3 (inside one drone) opens the same way
const ACT3_BASE = 'act3/assets/';
let act3 = null, act3Opening = false;
const act3Host = $('#act3host');
async function openAct3() {
  if (act3 || act3Opening || act2) return; if (act5Open) closeAct5(); act3Opening = true; goFull();
  S.retY = scrollY; act3Host.hidden = false; document.body.classList.add('in-act3'); pauseAct1();
  try {
    const { createAct3 } = await import('../act3/js/act3.js');
    act3 = await createAct3(act3Host, { base: ACT3_BASE, onExit: closeAct3, music: sndWas });
    window.__act3 = act3;
  } catch (e) { console.error(e); act3Host.querySelector('.a3wait').textContent = 'Act 3 could not load here. Press Esc or reload the page.'; }
  act3Opening = false;
}
function closeAct3() {
  if (act3) { act3.destroy(); act3 = null; }
  for (const n of [...act3Host.children]) if (!n.classList.contains('a3wait')) n.remove();
  act3Host.hidden = true; document.body.classList.remove('in-act3'); resumeAct1();
  backTo();
}
$('#inside').addEventListener('click', (e) => { e.preventDefault(); openAct3(); });
// ---------------------------------------------------------------- Act 4 (the swarm at work: four missions, simulated then played as a film) opens the same way
const ACT4_BASE = 'act4/assets/';
let act4 = null, act4Opening = false;
const act4Host = $('#act4host');
async function openAct4() {
  if (act4 || act4Opening || act2 || act3) return; if (act5Open) closeAct5(); act4Opening = true; goFull();
  S.retY = scrollY; act4Host.hidden = false; document.body.classList.add('in-act4'); pauseAct1();
  try {
    const { createAct4 } = await import('../act4/js/act4.js');
    act4 = await createAct4(act4Host, { base: ACT4_BASE, onExit: closeAct4, music: sndWas, onLab: (id) => { closeAct4(); openAct5(id); } });
    window.__act4 = act4;
  } catch (e) { console.error(e); act4Host.querySelector('.a4wait').textContent = 'Act 4 could not load here. Press Esc or reload the page.'; }
  act4Opening = false;
}
function closeAct4() {
  if (act4) { act4.destroy(); act4 = null; }
  for (const n of [...act4Host.children]) if (!n.classList.contains('a4wait')) n.remove();
  act4Host.hidden = true; document.body.classList.remove('in-act4'); resumeAct1();
  backTo();
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && act4Opening && !act4) closeAct4(); });
// ---------------------------------------------------------------- Act 5 (inside the swarm: the swarm lab) opens the same way, in its own scrolling layer
const act5Host = $('#act5host'); let act5 = null, act5Open = false;
function openAct5(id = 'lab-intro') {
  if (act2 || act3) return;
  if (act5Open) { act5.goTo(id); return; }
  act5Open = true; S.retY = scrollY; goFull();
  act5Host.hidden = false; document.body.classList.add('in-act5'); pauseAct1();
  if (!act5) act5 = mountAct5(act5Host, { music: sndWas }); else act5.resumeAll(sndWas);
  act5.goTo(id, false); act5Host.focus({ preventScroll: true });
}
function closeAct5() { if (!act5Open) return; act5Open = false; act5.pauseAll(); act5Host.hidden = true; document.body.classList.remove('in-act5'); resumeAct1(); backTo(); }
addEventListener('keydown', (e) => { if (e.key === 'Escape' && act5Open && !document.body.classList.contains('in-contents')) closeAct5(); });
function backTo() { if (S.retY != null) { scrollTo(0, S.retY); S.retY = null; } else { const last = secs[secs.length - 1]; scrollTo(0, last.offsetTop + Math.max(0, last.offsetHeight - innerHeight) * .5); } measure(); S.P = chapterP(); zones(); }
// ---------------------------------------------------------------- the swarm lab, the six acts and the contents dialog
function scrollToEl(el) {
  const go = () => {
    measure();
    let y = el.offsetTop;
    const i = secs.indexOf(el); if (i >= 0) y = tops[i] + Math.max(0, hs[i] - innerHeight) * (i === 0 ? 0 : .3);   // a story chapter: land where its text is up
    const far = Math.abs(y - scrollY) > innerHeight * 2.5;
    scrollTo({ top: y, behavior: far || RM ? 'auto' : 'smooth' });
  };
  if (!S.started) { start(false); setTimeout(go, 450); } else go();
}
const whenIn = (f) => () => { if (!S.started) start(false); f(); };
zonesCtl = initZones();
const lab = initLab({ open: { act2: whenIn(openAct2), act3: whenIn(openAct3), act4: whenIn(openAct4), act5: (id) => { if (!S.started) start(false); openAct5(typeof id === 'string' ? id : 'lab-intro'); }, story: closeAct5 }, onScrollTo: scrollToEl });
document.querySelectorAll('#rail a').forEach((a) => a.addEventListener('click', (e) => { const el = document.querySelector(a.getAttribute('href')); if (el) { e.preventDefault(); scrollToEl(el); } }));
window.LIMINAL = { openAct2, closeAct2, openAct3, closeAct3, openAct4, closeAct4, openAct5, closeAct5, lab };
// the wordmark steps aside while a chapter's text scrolls under it, so the two never print on top of each other
{ const mark = document.querySelector('.mark'); let q = 0, blocks = null;
  const chk = () => { q = 0; if (!mark) return; blocks = blocks || [...document.querySelectorAll('#story .ch-in > *, #story .tools-in > *, #story .zones-intro-in > *, #story .zones-more-in > *')];
    const m = mark.getBoundingClientRect(), lim = (m.bottom || 70) + 10; let hit = false;
    for (const b of blocks) { const r = b.getBoundingClientRect(); if (r.top < lim && r.bottom > 8 && r.left < m.right + 24 && +getComputedStyle(b.parentElement).opacity > .1) { hit = true; break; } }
    mark.classList.toggle('aside', hit); };
  addEventListener('scroll', () => { if (!q) q = requestAnimationFrame(chk); }, { passive: true }); addEventListener('resize', () => { blocks = null; chk(); });
  setInterval(() => { if (!document.hidden && !q) chk(); }, 250); }   // chapter text fades in after the scroll stops
function frame(now) { raf = requestAnimationFrame(frame); const dt = Math.min(.05, (now - S.last) / 1000); S.last = now; if (!(maq && agent)) return; if (S.cover && S.started) { snd.st.drones = 0; snd.st.swarm = 0; snd.update(dt); return; }
  if (!S.started && gateSwarm) { S.gateAcc = (S.gateAcc || 0) + dt; if (S.gateAcc < .5) return; S.gateAcc = 0; }   // the opaque gate hides the 3-D: draw it only twice a second (keeps it warm) so the school gets the GPU
  tick(dt); }
requestAnimationFrame(frame);
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w / 2, h / 2); camera.aspect = w / h; camera.updateProjectionMatrix(); altRT.setSize(Math.max(4, w * DPR * .6 | 0), Math.max(4, h * DPR * .6 | 0)); heatRT.setSize(Math.max(4, w * DPR / 2 | 0), Math.max(4, h * DPR / 2 | 0)); finish.uniforms.heat.value = heatRT.texture; finish.uniforms.heatTx.value.set(2.4 / (w * DPR), 2.4 / (h * DPR)); finish.uniforms.res.value.set(w * DPR, h * DPR); ov.width = w * DPR; ov.height = h * DPR; measure(); S.P = chapterP(); }
addEventListener('resize', resize); resize(); zones();
new ResizeObserver(() => { measure(); S.P = chapterP(); zones(); }).observe(document.getElementById('story'));
let left = 71 * 3600 + 42 * 60 + 18; const clk = $('#clock');
setInterval(() => { left--; clk.textContent = `${(left / 3600) | 0}:${String(((left % 3600) / 60) | 0).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; }, 1000);
window.__ACT = { S, U, SU, camera, start, get solo() { return solo; }, droneScreen() { _v.copy(heroDrone.position).project(camera); return [_v.x, _v.y, _v.z]; }, get swarm() { return swarm; }, get agent() { return agent; }, get ready() { return !!agent; },
  go(P) { document.body.dataset.words = 3; S.words = 3; const i = Math.min(secs.length - 1, Math.floor(P)), f = P - i; scrollTo(0, tops[i] + f * Math.max(1, hs[i] - innerHeight)); S.P = P; S.Ps = P; S.introT = Math.max(S.introT, 5); },
  tapNow() { S.tapClock = 0; S.tapI = 0; }, warp(s) { S.time += s; S.introT += s; },
  cursorAt(x, y) { S.ptr.set(x / innerWidth * 2 - 1, -(y / innerHeight * 2 - 1)); S.ptrS.copy(S.ptr); },
  findNow() { found(); }, find() { S.found = S.time - 2; document.body.dataset.words = 3; hookH.textContent = 'There. Still warm.'; hookP.textContent = 'Under the rubble, one hand on the pipe. You found them by sound and by heat; rescuers outside can do neither through concrete.'; } };

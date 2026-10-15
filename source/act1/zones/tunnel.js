// A collapsed tunnel (Silkyara, Uttarakhand, 12 Nov 2023). A side cross-section of a Himalayan slope: layered rock,
// a few faults, a road tunnel running into the mountain from its portal. Near the portal a long debris plug fills the
// tube except a thin gap under the crown; beyond it, a dry section where the workers wait.
// Radio does not go through rock, and the debris eats it too, so the swarm keeps a RELAY CHAIN: drones fly in one by
// one, the queue's second drone parks as a relay whenever its signal back to the chain falls to a margin (or the lead's
// line of sight is about to break over the pile), and the next one passes it. Everyone maps with LiDAR as they go
// (indoor mode: 3-D voxels at 5 cm, GPS off), so the debris pile's shape is revealed from inside. The inset shows the
// profile they mapped and where a pipe could go. Lengths come from this scene's own geometry only.
export default function mount({ stage, controls, readouts, kit }) {
  const B0S = kit.stableCount({ latchAt: 6 });   // calm display of the β₀ counter
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx, el = cv.cv;
  el.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- the model (metres, mission seconds)
  const TL = 13, ND = 12, D = 9, WORKERS = 41;                 // time-lapse, drones, tunnel height, people inside
  const V_OPEN = 1.5, V_SLOPE = .5, V_GAP = .27;                // flight speed in the open tube, over the slopes, in the gap
  const R_L = 10;                                               // LiDAR range
  const PARK_DBM = -80, LOST_DBM = -90;                         // park a relay at this margin; below this there is no link
  const BASE = { x: -14, z: 2 };                                // the mesh node outside the portal

  const rR = kit.readout(readouts, { label: 'Relay links', tone: 'teal' });
  const rM = kit.readout(readouts, { label: 'Debris mapped', tone: 'apricot' });
  const rP = kit.readout(readouts, { label: 'People found', tone: 'heat' });

  // ---------------------------------------------------------------- helpers
  const hash = (x, y, s) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const vn1 = (x, s) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f), a = hash(i, 0, s); return a + (hash(i + 1, 0, s) - a) * u; };
  const fb1 = (x, s, o = 4) => { let a = 0, amp = .5, f = 1, n = 0; for (let k = 0; k < o; k++) { a += amp * vn1(x * f, s + k * 17); n += amp; f *= 2.1; amp *= .5; } return a / n; };
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  const rgbOf = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const shade = (h, k, a = 1) => { const c = rgbOf(h).map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  function sprite(r, g, b, a0, size = 64) {
    const c = mk(size, size), x = c.getContext('2d'), gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, `rgba(${r},${g},${b},${a0})`); gr.addColorStop(.3, `rgba(${r},${g},${b},${a0 * .5})`); gr.addColorStop(.65, `rgba(${r},${g},${b},${a0 * .14})`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, size, size); return c;
  }
  const SPR_TEAL = sprite(127, 212, 207, 1), SPR_HEAT = sprite(255, 195, 107, 1, 96), SPR_MIST = sprite(236, 228, 236, 1);
  const GRAIN = (() => { const c = mk(128, 128), g = c.getContext('2d'), im = g.createImageData(128, 128), d = im.data, r = kit.rng(91);
    for (let i = 0; i < 128 * 128; i++) { const v = 128 + (r() - .5) * 130; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0); return c; })();
  // strata: soft slate, mauve, ochre; a repeating sequence with variation
  const STRATA = ['#2f3159', '#363866', '#3d3e6f', '#454575', '#4e4a7a', '#574f7c', '#60537c', '#69587a', '#715e77', '#786573'];   // slate → mauve → dusky rose
  const ACCENT = ['#86726e', '#8d7a6c', '#5d6590', '#7a6f95'];                                                                           // thin ochre and pale slate beds

  // ---------------------------------------------------------------- the mountain and the tunnel
  let M = null;
  function genMission(seed) {
    const r = kit.rng(seed), rf = (a, b) => a + r() * (b - a), sd = Math.floor(r() * 9999);
    const XF = Math.round(rf(252, 278)), xd0 = Math.round(rf(56, 70)), Ld = Math.round(rf(52, 64)), xd1 = xd0 + Ld;
    const front = rf(10, 13.5), back = rf(11, 15), xc0 = xd0 + front, xc1 = xd1 - back;
    const NH = Math.ceil((Ld + 6) / .25) + 1, hp = new Float32Array(NH), x0h = xd0 - 3;
    for (let i = 0; i < NH; i++) {
      const x = x0h + i * .25;
      let gap = .62 + 1.05 * fb1(x * .08 + sd, sd + 1, 3) + .3 * (vn1(x * .7, sd + 2) - .5);
      gap = clamp(gap, .55, 1.9);
      const top = D - gap, rough = .45 * (vn1(x * 1.3, sd + 3) - .5) + .25 * (vn1(x * 3.1, sd + 4) - .5);
      const fr = (x - (xd0 - 3)) / (front + 3), bk = ((xd1 + 3) - x) / (back + 3);
      const rise = Math.pow(clamp(fr, 0, 1), .85) * (D - .6), fall = Math.pow(clamp(bk, 0, 1), .8) * (D - .6);
      hp[i] = clamp(Math.min(top, rise + rough * (fr < 1 ? 1 : 0), fall + rough * (bk < 1 ? 1 : 0)), 0, D - .5);
    }
    let gmin = 9, gmax = 0; for (let x = xc0 + 1; x <= xc1 - 1; x += .25) { const g = D - hAtRaw(hp, x0h, x); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
    const xw = Math.round(rf(xd1 + 48, Math.min(XF - 32, xd1 + 110)));
    const wk = new Float32Array(WORKERS * 3);
    for (let i = 0; i < WORKERS; i++) { const a = r() * TAU, q = Math.sqrt(r()); wk[i * 3] = xw + Math.cos(a) * q * 9 + (r() - .5) * 2; wk[i * 3 + 1] = r() < .55 ? .35 : rf(.9, 1.5); wk[i * 3 + 2] = r(); }
    // faults: steep lines x = a + c z; the throw shifts the strata across each
    const faults = [];
    const fxs = [rf(-70, -30), xd0 + Ld * rf(.3, .6), rf(xd1 + 60, XF + 40), rf(XF + 60, XF + 160)].sort((a, b) => a - b);
    let acc = 0; for (const a of fxs) { acc += rf(1.2, 3.5) * (r() < .5 ? -1 : 1); faults.push({ a, c: rf(-.45, -.15), thr: acc }); }
    const nb = 120, bands = []; let z = -150; const ph0 = rf(0, 6), fr0 = rf(.28, .42);
    for (let k = 0; k < nb; k++) {
      const thin = r() < .2, t = thin ? rf(.7, 1.6) : rf(2.2, 6);
      const ci = clamp(Math.round((Math.sin(k * fr0 + ph0) * .5 + .5) * (STRATA.length - 1) + (r() - .5) * 2.4), 0, STRATA.length - 1);
      bands.push({ z, t, col: thin ? ACCENT[(r() * ACCENT.length) | 0] : STRATA[ci], wob: Math.floor(r() * 9999) }); z += t;
    }
    return { seed, sd, XF, xd0, xd1, xc0, xc1, Ld, hp, x0h, gmin, gmax, xw, wk, faults, bands, dip: rf(.05, .12), slope: rf(.3, .4), fold: rf(2.5, 4.5), fph: rf(0, 6) };
  }
  function hAtRaw(hp, x0h, x) { const f = (x - x0h) / .25, i = Math.floor(f); if (i < 0 || i >= hp.length - 1) return 0; return hp[i] + (hp[i + 1] - hp[i]) * (f - i); }
  const hAt = (x) => hAtRaw(M.hp, M.x0h, x);
  const surf = (x) => {                                                   // ground surface (world z)
    if (x < -10) return -.6 - 1.4 * smooth(-30, -160, x) + 1.2 * (fb1(x * .03, M.sd + 7, 3) - .5) * smooth(-20, -60, x);
    if (x < 0) return 0;
    return D + 3.5 + x * M.slope + 7 * (fb1(x * .025, M.sd + 8, 4) - .5) + 3 * Math.sin(x * .05 + M.fph) * smooth(10, 50, x);
  };
  const foldAt = (x) => M.fold * Math.sin(x * .016 + M.fph) + 6 * (fb1(x * .01, M.sd + 9, 3) - .5);
  function los(ax, az, bx, bz, tol = .05) {                              // line of sight inside the tube: rubble blocks it
    for (let k = 1; k <= 7; k++) { const t = k / 8, x = ax + (bx - ax) * t, z = az + (bz - az) * t; if (x > M.x0h && x < M.xd1 + 3 && z < hAt(x) - tol) return false; }
    return true;
  }
  function rssi(ax, az, bx, bz) {                                         // dBm from 0 dBm: path loss along the tube, extra loss in the gap
    if (!los(ax, az, bx, bz, 1)) return -120;                            // radio bends a little round a rubble crest (diffraction); light does not
    const d = Math.max(1, Math.hypot(bx - ax, bz - az)), lo = Math.max(Math.min(ax, bx), M.xc0 - 1), hi = Math.min(Math.max(ax, bx), M.xc1 + 1);
    return -(38 + 22 * Math.log10(d) + 1.15 * Math.max(0, hi - lo));
  }

  // the flight line: from the pad, through the portal, over the pile through the gap, on to the face
  let PX = null, PZ = null, PU = null, NPATH = 0;
  function buildPath() {
    const xs = [], zs = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8; xs.push(BASE.x + (2 - BASE.x) * t); zs.push(1.2 + (4.6 - 1.2) * smooth(0, 1, t)); }
    for (let x = 3; x <= M.XF - 3; x += 1) {
      const h = hAt(x), clr = Math.min(1.3, (D - h) / 2);
      xs.push(x); zs.push(Math.max(4.6, h + clr));
    }
    for (let i = 1; i < zs.length - 1; i++) if (xs[i] > 3) zs[i] = Math.max(zs[i], (zs[i - 1] + zs[i] + zs[i + 1]) / 3, hAt(xs[i]) + Math.min(.6, (D - hAt(xs[i])) / 2));
    NPATH = xs.length; PX = Float32Array.from(xs); PZ = Float32Array.from(zs); PU = new Float32Array(NPATH);
    for (let i = 1; i < NPATH; i++) PU[i] = PU[i - 1] + Math.hypot(PX[i] - PX[i - 1], PZ[i] - PZ[i - 1]);
  }
  function at(u, out) {
    u = clamp(u, 0, PU[NPATH - 1]); let lo = 0, hi = NPATH - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (PU[m] <= u) lo = m; else hi = m; }
    const t = (u - PU[lo]) / Math.max(1e-6, PU[hi] - PU[lo]); out[0] = PX[lo] + (PX[hi] - PX[lo]) * t; out[1] = PZ[lo] + (PZ[hi] - PZ[lo]) * t; return out;
  }
  const speedAt = (x) => (x > M.xc0 - 1 && x < M.xc1 + 1) ? V_GAP : (x > M.xd0 - 2 && x < M.xd1 + 2) ? V_SLOPE : V_OPEN;
  const uOfX = (x) => { let i = 0; while (i < NPATH - 1 && PX[i] < x) i++; return PU[i]; };

  // ---------------------------------------------------------------- layout
  let L = null, terr = null;
  function layout() {
    const W = cv.w, H = cv.h, phone = W < 640, left = phone ? 0 : (parseFloat(stage.dataset.left) || 0);
    const ax0 = left > 0 ? left * W + 20 : 16, ax1 = Math.max(ax0 + 160, W - (phone ? 16 : 24));
    const VE = phone ? 6 : 4, xp = ax0 + (phone ? 42 : 66), s = Math.max(.4, (ax1 - 8 - xp) / M.XF);
    const yf = Math.round(phone ? Math.max(200, H * .5) : clamp(H * .56, 330, H - 290));
    const iw = phone ? Math.min(250, ax1 - ax0) : Math.min(420, (ax1 - ax0) * .5), ih = phone ? 96 : 132;
    const iy = phone ? clamp(yf + 62, yf + 50, H - 64 - ih) : Math.max(yf + 86, H - 64 - ih);
    L = { W, H, phone, left, ax0, ax1, VE, xp, s, yf, inset: { x: ax0 + (phone ? 0 : 6), y: iy, w: iw, h: ih } };
    renderTerrain(); notes.forEach((n) => { n.placed = false; });
  }
  const X = (x) => L.xp + x * L.s, Y = (z) => L.yf - z * L.s * L.VE;
  const WX = (sx) => (sx - L.xp) / L.s, WZ = (sy) => (L.yf - sy) / (L.s * L.VE);

  // ---------------------------------------------------------------- the pre-rendered scene
  function renderTerrain() {
    const { W, H, s, VE } = L, dpr = cv.dpr, r = kit.rng(M.seed ^ 0x2c1b3c6d), rf = (a, b) => a + r() * (b - a);
    if (!terr) terr = mk(1, 1);
    terr.width = Math.round(W * dpr); terr.height = Math.round(H * dpr);
    const g = terr.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const STEP = 3, NS = Math.ceil(W / STEP) + 2, sx = new Float32Array(NS), wxs = new Float32Array(NS), fold = new Float32Array(NS), sfz = new Float32Array(NS);
    for (let i = 0; i < NS; i++) { sx[i] = i * STEP - STEP; wxs[i] = WX(sx[i]); fold[i] = foldAt(wxs[i]); sfz[i] = Y(surf(wxs[i])); }
    // rock: one clip per fault block, strata bands dipping into the mountain, offset by each fault's throw
    const fx = (f, z) => X(f.a + f.c * z), zTop = WZ(-40), zBot = WZ(H + 40);
    const blocks = [{ l: null, r: M.faults[0], thr: 0 }]; M.faults.forEach((f, i) => blocks.push({ l: f, r: M.faults[i + 1] || null, thr: f.thr }));
    for (const B of blocks) {
      g.save(); g.beginPath();
      const lt = B.l ? fx(B.l, zTop) : -50, lb = B.l ? fx(B.l, zBot) : -50, rt = B.r ? fx(B.r, zTop) : W + 50, rb = B.r ? fx(B.r, zBot) : W + 50;
      g.moveTo(lt, -40); g.lineTo(rt, -40); g.lineTo(rb, H + 40); g.lineTo(lb, H + 40); g.closePath(); g.clip();
      const zof = (k, i) => M.bands[k].z + B.thr + M.dip * wxs[i] + fold[i] + .8 * (vn1(wxs[i] * .05, M.bands[k].wob) - .5);
      for (let k = 0; k < M.bands.length - 1; k++) {
        let anyOn = false; for (let i = 0; i < NS; i += 8) { const yt = Y(zof(k + 1, i)), yb = Y(zof(k, i)); if (yb > -10 && yt < H + 10) { anyOn = true; break; } }
        if (!anyOn) continue;
        g.beginPath(); for (let i = 0; i < NS; i++) { const y = Y(zof(k + 1, i)); i ? g.lineTo(sx[i], y) : g.moveTo(sx[i], y); }
        for (let i = NS - 1; i >= 0; i--) g.lineTo(sx[i], Y(zof(k, i)));
        g.closePath(); g.fillStyle = M.bands[k].col; g.fill();
        // laminae inside the band
        g.strokeStyle = k % 2 ? 'rgba(243,238,242,.06)' : 'rgba(18,18,44,.12)'; g.lineWidth = .8; g.beginPath();
        for (const t of [.33, .7]) { for (let i = 0; i < NS; i++) { const y = Y(zof(k, i) + M.bands[k].t * t); i ? g.lineTo(sx[i], y) : g.moveTo(sx[i], y); } }
        g.stroke();
      }
      g.restore();
    }
    // rock texture: grain, specks, joints
    g.globalAlpha = .1; g.globalCompositeOperation = 'overlay'; g.fillStyle = g.createPattern(GRAIN, 'repeat'); g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    const lt = new Path2D(), dk = new Path2D(), jt = new Path2D();
    for (let k = 0; k < (W * H) / 700; k++) { const x = r() * W, y = r() * H, rr = rf(.5, 1.8), rx = rr * rf(1.4, 2.8), p = r() < .5 ? lt : dk; p.moveTo(x + rx, y); p.ellipse(x, y, rx, rr, 0, 0, TAU); }
    for (let k = 0; k < (W * H) / 5000; k++) { const x = r() * W, y = r() * H, l = rf(4, 12), a = 1.35 + rf(-.25, .25); jt.moveTo(x, y); jt.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); }
    g.fillStyle = 'rgba(243,238,242,.07)'; g.fill(lt); g.fillStyle = 'rgba(16,16,40,.13)'; g.fill(dk);
    g.strokeStyle = 'rgba(16,16,40,.22)'; g.lineWidth = .8; g.stroke(jt);
    // faults: a dark seam with a pale gouge beside it
    for (const f of M.faults) {
      const xa = fx(f, zTop), xb = fx(f, zBot);
      g.strokeStyle = 'rgba(16,16,40,.55)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(xa, -40);
      for (let k = 1; k <= 40; k++) { const t = k / 40; g.lineTo(xa + (xb - xa) * t + (vn1(k * .9, M.sd + 21) - .5) * 5, -40 + (H + 80) * t); }
      g.stroke(); g.strokeStyle = 'rgba(220,214,236,.16)'; g.lineWidth = 1; g.stroke();
    }
    // the tunnel: fractured halo, rock bolts, lining, interior, road bed, duct, the debris plug, the far end
    const x0 = X(0), x1 = X(M.XF), yc = Y(D), yfl = Y(0), th = yfl - yc;
    g.fillStyle = 'rgba(18,18,44,.32)'; g.fillRect(x0, yc - th * .32, x1 - x0, th * 1.64);
    g.strokeStyle = 'rgba(18,18,44,.4)'; g.lineWidth = .9; g.beginPath();
    for (let x = 2; x < M.XF; x += 3.2) { g.moveTo(X(x), yc); g.lineTo(X(x) + rf(-2, 2), yc - th * rf(.2, .36)); g.moveTo(X(x + 1.6), yfl); g.lineTo(X(x + 1.6) + rf(-2, 2), yfl + th * rf(.15, .3)); }
    g.stroke();
    const ig = g.createLinearGradient(0, yc, 0, yfl); ig.addColorStop(0, '#232547'); ig.addColorStop(.6, '#292a4e'); ig.addColorStop(1, '#2e2d50');
    g.fillStyle = ig; g.fillRect(x0, yc, x1 - x0, th);
    g.strokeStyle = 'rgba(200,196,226,.06)'; g.lineWidth = 1; g.beginPath(); for (let x = 1.5; x < M.XF; x += 3) { g.moveTo(X(x), yc + 1); g.lineTo(X(x), yfl - 2); } g.stroke();
    g.fillStyle = '#3a3a5e'; g.fillRect(x0, Y(.7), x1 - x0, yfl - Y(.7)); g.fillStyle = 'rgba(220,214,236,.22)'; g.fillRect(x0, Y(.7), x1 - x0, 1);
    g.fillStyle = 'rgba(220,214,236,.14)'; for (let x = 2; x < M.XF; x += 6) g.fillRect(X(x), Y(.38), Math.max(1, 2.5 * s), 1);
    const duct = (a, b) => { g.fillStyle = 'rgba(200,196,226,.2)'; g.fillRect(X(a), Y(D - .7), X(b) - X(a), Y(D - 1.5) - Y(D - .7)); g.fillStyle = 'rgba(243,238,242,.18)'; g.fillRect(X(a), Y(D - .7), X(b) - X(a), 1); };
    duct(0, M.xd0 - 4); duct(M.xd1 + 3, M.XF - 6);
    for (let x = 8; x < M.XF - 4; x += 12) { if (x > M.xd0 - 4 && x < M.xd1 + 3) continue; g.fillStyle = x > M.xd1 ? 'rgba(246,226,200,.5)' : 'rgba(200,196,226,.35)'; g.fillRect(X(x) - 1.5, yc + 1, 3, 2); }
    // beyond the debris the lights are still on: a soft wash on the floor of the dry section
    const wl = g.createLinearGradient(X(M.xd1), 0, X(M.XF), 0); wl.addColorStop(0, 'rgba(246,226,200,0)'); wl.addColorStop(.25, 'rgba(246,226,200,.06)'); wl.addColorStop(1, 'rgba(246,226,200,.03)');
    g.fillStyle = wl; g.fillRect(X(M.xd1), yc, x1 - X(M.xd1), th);
    // site gear in the dry section: a dumper, a container, the drill jumbo at the face
    const veh = (x, w, h, col) => { g.fillStyle = 'rgba(14,14,36,.4)'; g.fillRect(X(x) + 2, Y(h) + 2, w * s, Y(.7) - Y(h)); g.fillStyle = col; roundRect(g, X(x), Y(h), w * s, Y(.7) - Y(h), 2); g.fill(); g.fillStyle = 'rgba(20,20,46,.8)'; g.beginPath(); g.arc(X(x) + w * s * .2, Y(.7), Math.max(2, .55 * s * VE * .6), 0, TAU); g.arc(X(x) + w * s * .8, Y(.7), Math.max(2, .55 * s * VE * .6), 0, TAU); g.fill(); };
    veh(M.xd1 + 14, 8, 3.2, '#8a8aa8'); veh(M.XF - 26, 6, 2.6, '#7b86a6');
    g.fillStyle = '#9a8fa6'; g.fillRect(X(M.xw + 16), Y(2.9), 6 * s, Y(.7) - Y(2.9)); g.strokeStyle = 'rgba(20,20,46,.5)'; g.lineWidth = 1; g.strokeRect(X(M.xw + 16), Y(2.9), 6 * s, Y(.7) - Y(2.9));
    g.fillStyle = '#8f87a3'; g.fillRect(X(M.XF - 13), Y(3.4), 7 * s, Y(.7) - Y(3.4)); g.strokeStyle = '#a69dba'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(M.XF - 7), Y(2.8)); g.lineTo(X(M.XF - 1.2), Y(5.6)); g.moveTo(X(M.XF - 7), Y(2)); g.lineTo(X(M.XF - 1.2), Y(3.4)); g.stroke();
    // the excavation face: the tube ends in raw rock
    g.fillStyle = shade('#6f6290', -.1); g.beginPath(); g.moveTo(x1, yc - 2); for (let k = 0; k <= 10; k++) g.lineTo(x1 - rf(0, 5), yc + th * k / 10); g.lineTo(x1 + 8, yfl + 2); g.lineTo(x1 + 8, yc - 2); g.closePath(); g.fill();
    // the debris plug: rubble, shotcrete slabs, bent ribs
    const deb = new Path2D(); deb.moveTo(X(M.x0h), yfl);
    for (let x = M.x0h; x <= M.xd1 + 3; x += .25) deb.lineTo(X(x), Y(hAt(x)));
    deb.lineTo(X(M.xd1 + 3), yfl); deb.closePath();
    g.fillStyle = '#5f587c'; g.fill(deb);
    g.save(); g.clip(deb);
    const RB = ['#7c7598', '#938aa8', '#6a6388', '#a69fb8', '#8f7d88', '#a08c80', '#575276'];
    const pp = RB.map(() => new Path2D()), psh = new Path2D();
    for (let y = yc - 4; y < yfl + 4; y += 3.4) for (let x = X(M.x0h); x < X(M.xd1 + 3); x += 3.6) {
      const px = x + rf(-1.8, 1.8), py = y + rf(-1.7, 1.7), sz = rf(1.3, 3.6) * (L.phone ? .8 : 1), nv = 4 + ((r() * 3) | 0), rot = r() * TAU, tgt = pp[(r() * RB.length) | 0];
      for (let k = 0; k < nv; k++) { const a = rot + k / nv * TAU, q = sz * rf(.6, 1.1), vx = px + Math.cos(a) * q, vy = py + Math.sin(a) * q * .8; if (k) { tgt.lineTo(vx, vy); psh.lineTo(vx + .8, vy + 1); } else { tgt.moveTo(vx, vy); psh.moveTo(vx + .8, vy + 1); } }
      tgt.closePath(); psh.closePath();
    }
    g.fillStyle = 'rgba(14,14,36,.5)'; g.fill(psh); pp.forEach((p, i) => { g.fillStyle = RB[i]; g.fill(p); });
    for (let k = 0; k < 9; k++) { const x = rf(M.xd0, M.xd1), w = rf(3, 7) * s, h0 = rf(1.6, 3), a = rf(-.5, .5); g.save(); g.translate(X(x), Y(hAt(x) * rf(.4, .85))); g.rotate(a); g.fillStyle = 'rgba(14,14,36,.4)'; g.fillRect(-w / 2 + 1, -h0 / 2 + 1.2, w, h0); g.fillStyle = '#b3adc4'; g.fillRect(-w / 2, -h0 / 2, w, h0); g.restore(); }
    g.strokeStyle = 'rgba(40,38,70,.85)'; g.lineWidth = 1.2; g.beginPath();
    for (let k = 0; k < 7; k++) { const x = rf(M.xd0 + 2, M.xd1 - 2), y = Y(hAt(x) * rf(.3, .8)), rr = rf(4, 9) * s * .5; g.moveTo(x + rr, y); g.arc(X(x), y, rr, rf(3.4, 4), rf(5, 6)); }
    g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(214,206,226,.2)'; g.lineWidth = 1; g.beginPath(); for (let x = M.x0h; x <= M.xd1 + 3; x += .25) { const y = Y(hAt(x)); x === M.x0h ? g.moveTo(X(x), y) : g.lineTo(X(x), y); } g.stroke();
    // lining: crown and invert
    g.fillStyle = '#9b97b7'; g.fillRect(x0, yc - 2, x1 - x0, 2); g.fillRect(x0, yfl, x1 - x0, 2);
    g.fillStyle = 'rgba(243,238,242,.25)'; g.fillRect(x0, yc - 2, x1 - x0, .8);
    // sky above the ground line, with far ridges and a few stars
    const sky = new Path2D(); sky.moveTo(-10, -10); sky.lineTo(W + 10, -10); for (let i = NS - 1; i >= 0; i--) sky.lineTo(sx[i], sfz[i]); sky.closePath();
    g.save(); g.clip(sky);
    const sg = g.createLinearGradient(0, 0, 0, Y(0)); sg.addColorStop(0, '#1d2042'); sg.addColorStop(.55, '#33356a'); sg.addColorStop(.85, '#5a4f7e'); sg.addColorStop(1, '#8a6f8e');
    g.fillStyle = sg; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(243,238,242,.6)'; for (let k = 0; k < 70; k++) { const x = r() * W, y = r() * Y(0) * .6, q = r(); g.globalAlpha = .15 + q * .45; g.fillRect(x, y, q > .85 ? 1.6 : 1, q > .85 ? 1.6 : 1); } g.globalAlpha = 1;
    const ridge = (base, amp, fr, col, sn, seedR) => {                // a far ridge; snow only above a snowline, ragged at its foot
      const yAt = (x) => base - amp * Math.pow(fb1(x * fr, seedR, 5), 1.6) * 1.6;
      g.beginPath(); g.moveTo(-10, H); for (let x = -10; x <= W + 10; x += 5) g.lineTo(x, yAt(x)); g.lineTo(W + 10, H); g.closePath(); g.fillStyle = col; g.fill();
      if (sn) {
        g.save(); g.clip(); g.beginPath(); g.moveTo(-10, -10);
        for (let x = -10; x <= W + 10; x += 5) g.lineTo(x, base - amp * (.62 + .18 * vn1(x * .08, seedR + 5)));
        g.lineTo(W + 10, -10); g.closePath(); g.fillStyle = sn; g.fill();
        g.restore();
      }
    };
    const hb = Y(0);
    ridge(hb - (hb) * .35, hb * .45, .004, 'rgba(110,104,160,.55)', 'rgba(220,228,238,.35)', M.sd + 31);
    ridge(hb - (hb) * .18, hb * .32, .006, 'rgba(84,80,134,.8)', 'rgba(220,228,238,.18)', M.sd + 32);
    ridge(hb - 6, hb * .18, .01, 'rgba(62,60,108,.95)', null, M.sd + 33);
    const glow = g.createRadialGradient(X(-40), hb, 10, X(-40), hb, W * .5); glow.addColorStop(0, 'rgba(239,177,180,.18)'); glow.addColorStop(1, 'rgba(239,177,180,0)'); g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.restore();
    // soil, the ground line, conifers on the slope and in the valley
    g.strokeStyle = 'rgba(52,44,70,.85)'; g.lineWidth = Math.max(4, 2.2 * s * VE); g.beginPath(); for (let i = 0; i < NS; i++) { const y = sfz[i] + g.lineWidth / 2; i ? g.lineTo(sx[i], y) : g.moveTo(sx[i], y); } g.stroke();
    g.strokeStyle = 'rgba(157,184,160,.45)'; g.lineWidth = 1.4; g.beginPath(); for (let i = 0; i < NS; i++) i ? g.lineTo(sx[i], sfz[i]) : g.moveTo(sx[i], sfz[i]); g.stroke();
    const trees = (n, xa, xb) => { for (let k = 0; k < n; k++) { const x = rf(xa, xb); if (x > -8 && x < 4) continue; const y = Y(surf(x)) + 1, h0 = rf(10, 22) * (L.phone ? .7 : 1), w0 = h0 * .42; if (y < -5 || y > H) continue;
      g.fillStyle = 'rgba(34,40,52,.95)'; for (let t = 0; t < 3; t++) { const yy = y - t * h0 * .28; g.beginPath(); g.moveTo(X(x), yy - h0 * .55); g.lineTo(X(x) - w0 * (1 - t * .22), yy); g.lineTo(X(x) + w0 * (1 - t * .22), yy); g.closePath(); g.fill(); }
      g.fillStyle = 'rgba(111,143,122,.35)'; g.beginPath(); g.moveTo(X(x), y - h0 * 1.1); g.lineTo(X(x) - w0 * .35, y - h0 * .6); g.lineTo(X(x), y - h0 * .7); g.fill(); } };
    trees(60, WX(-20), -12); trees(26, 6, WX(W));
    // road and portal: the apron, the hood, the headwall
    g.fillStyle = '#2b2b4c'; g.fillRect(-10, Y(0) - 1, X(0) + 10, Math.max(3, .5 * s * VE)); g.fillStyle = 'rgba(220,214,236,.28)'; g.fillRect(-10, Y(0) - 1, X(0) + 10, 1);
    g.fillStyle = '#a49fbd'; g.fillRect(X(-.6), Y(D + 3.2), Math.max(4, 1.6 * s), Y(D) - Y(D + 3.2) + 2);
    g.fillStyle = '#b8b2cb'; g.beginPath(); g.moveTo(X(-5), Y(D + .3)); g.lineTo(X(1), Y(D + .3)); g.lineTo(X(1), Y(D + 1.6)); g.lineTo(X(-5), Y(D + 1.1)); g.closePath(); g.fill();
    g.fillStyle = 'rgba(20,20,46,.45)'; g.fillRect(X(-5), Y(D + .3), X(1) - X(-5), 2);
    // the rescue camp in the valley (it continues under the card)
    for (let k = 0; k < 12; k++) {
      const x = -24 - k * rf(7, 11), y = Y(surf(x)), kind = k % 3;
      if (kind === 0) { g.fillStyle = k % 2 ? '#b98f96' : '#a7889d'; g.beginPath(); g.moveTo(X(x) - 7, y); g.lineTo(X(x), y - 9); g.lineTo(X(x) + 7, y); g.closePath(); g.fill(); g.fillStyle = 'rgba(20,20,46,.4)'; g.fillRect(X(x) - 1.2, y - 4, 2.4, 4); }
      else if (kind === 1) { g.fillStyle = '#8c93b3'; g.fillRect(X(x) - 10, y - 8, 20, 8); g.fillStyle = 'rgba(243,238,242,.25)'; g.fillRect(X(x) - 10, y - 8, 20, 1.2); }
      else { g.fillStyle = '#d3cbd8'; roundRect(g, X(x) - 9, y - 8, 18, 6.5, 1.5); g.fill(); g.fillStyle = '#c08c92'; g.fillRect(X(x) - 9, y - 5.6, 18, 1.6); g.fillStyle = 'rgba(20,20,46,.8)'; g.beginPath(); g.arc(X(x) - 5, y - 1.2, 1.6, 0, TAU); g.arc(X(x) + 5, y - 1.2, 1.6, 0, TAU); g.fill(); }
    }
    for (const x of [-30, -78]) { const y = Y(surf(x)); g.strokeStyle = 'rgba(200,196,226,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(x), y); g.lineTo(X(x), y - 34); g.stroke(); g.globalAlpha = .5; g.drawImage(SPR_MIST, X(x) - 16, y - 50, 32, 32); g.globalAlpha = 1; }
    // the mesh node outside the portal
    { const x = X(BASE.x), y = Y(surf(BASE.x)); g.strokeStyle = 'rgba(220,228,238,.7)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 18); g.moveTo(x - 5, y); g.lineTo(x, y - 10); g.lineTo(x + 5, y); g.stroke(); }
    // light: a warm wash from the valley, darker toward the deep rock
    const lg = g.createRadialGradient(X(-30), Y(0), 20, X(-30), Y(0), Math.max(W, H) * .95); lg.addColorStop(0, 'rgba(246,210,177,.07)'); lg.addColorStop(.5, 'rgba(14,15,34,0)'); lg.addColorStop(1, 'rgba(14,15,34,.42)');
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
    const fg = g.createLinearGradient(0, Y(D) - H * .45, 0, Y(0) + H * .5); fg.addColorStop(0, 'rgba(18,19,44,0)'); fg.addColorStop(.42, 'rgba(18,19,44,0)'); fg.addColorStop(1, 'rgba(18,19,44,.38)');
    g.fillStyle = fg; g.fillRect(0, Y(0), W, H - Y(0));
  }

  // ---------------------------------------------------------------- LiDAR coverage of the tube (1 m x 0.5 m cells) and the fog
  let GW = 1, GH = 18, NCELL = 1, cov = null, fresh = null, solid = null, fogCv = null, fogX = null, fogIm = null, fogPx = null, satCv = null, satX = null, satIm = null, satPx = null, lab = null;
  let NSMP = 0, smpX = null, smpSeen = null, nSeen = 0, unseenComp = 1;
  const QB = new Int32Array(8192);
  const pack = (r, g, b, a) => ((Math.round(a) << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
  const LUT = new Uint32Array(32 * 16 * 2), LUTS = new Uint32Array(32);
  for (let q = 0; q < 32; q++) {
    const c = q / 31, sv = smooth(.03, .4, c), fa0 = .78 * (1 - sv);
    LUTS[q] = pack(128, 128, 128, 255 * .85 * (1 - sv));
    for (let f = 0; f < 16; f++) for (let hz = 0; hz < 2; hz++) {
      const fa = fa0 * (hz ? .8 : 1), ga = .3 * (f / 15) * Math.min(1, c * 1.5), a = ga + fa * (1 - ga), mix = (t, u) => a > 0 ? (t * ga + u * fa * (1 - ga)) / a : 0;
      LUT[(q * 16 + f) * 2 + hz] = pack(mix(127, 18), mix(212, 19), mix(207, 42), 255 * a);
    }
  }
  function allocGrid() {
    GW = M.XF; NCELL = GW * GH; cov = new Float32Array(NCELL); fresh = new Float32Array(NCELL); solid = new Uint8Array(NCELL); lab = new Int16Array(NCELL);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) solid[j * GW + i] = (j + .5) * .5 < hAt(i + .5) - .1 ? 1 : 0;
    fogCv = mk(GW, GH); fogX = fogCv.getContext('2d'); fogIm = fogX.createImageData(GW, GH); fogPx = new Uint32Array(fogIm.data.buffer);
    satCv = mk(GW, GH); satX = satCv.getContext('2d'); satIm = satX.createImageData(GW, GH); satPx = new Uint32Array(satIm.data.buffer);
    NSMP = Math.round((M.xd1 + 3 - M.x0h) / .5); smpX = new Float32Array(NSMP); smpSeen = new Uint8Array(NSMP); nSeen = 0;
    for (let k = 0; k < NSMP; k++) smpX[k] = M.x0h + (k + .5) * .5;
  }
  // a drone looks around: open cells within range and in sight; debris surface points likewise
  function scan(x, z, fr) {
    const i0 = Math.max(0, Math.floor(x - R_L)), i1 = Math.min(GW - 1, Math.floor(x + R_L)), R2 = R_L * R_L;
    for (let i = i0; i <= i1; i++) {
      const cx = i + .5, dx = cx - x; let ok = -1;
      for (let j = 0; j < GH; j++) {
        const k = j * GW + i; if (solid[k] || cov[k] >= 1) continue;
        const cz = (j + .5) * .5, d2 = dx * dx + (cz - z) * (cz - z); if (d2 >= R2) continue;
        if (ok < 0 || (j & 3) === 0) ok = los(x, z, cx, cz) ? 1 : 0;
        if (!ok) continue;
        const q = d2 / R2, w = 1 - q * q; if (w > cov[k]) { if (fr && w > cov[k] + .02) fresh[k] = 1; cov[k] = w; }
      }
    }
    const k0 = Math.max(0, Math.floor((x - R_L - M.x0h) / .5)), k1 = Math.min(NSMP - 1, Math.ceil((x + R_L - M.x0h) / .5));
    for (let k = k0; k <= k1; k++) {
      if (smpSeen[k]) continue; const sxp = smpX[k], sz = hAt(sxp) + .12;
      if ((sxp - x) ** 2 + (sz - z) ** 2 > R2) continue;
      if (los(x, z, sxp, sz + .02)) { smpSeen[k] = 1; nSeen++; const i = Math.floor(sxp); if (i >= 0 && i < GW) for (let j = 0; j < GH; j++) { const c = j * GW + i; if (solid[c]) { cov[c] = Math.max(cov[c], .9); if (fr) fresh[c] = Math.max(fresh[c], .5); } } }
    }
  }
  function components() {                                                // β₀ of the unsearched open space (cells not yet seen)
    lab.fill(-1); let n = 0;
    for (let c = 0; c < NCELL; c++) {
      if (lab[c] !== -1 || solid[c] || cov[c] >= .5) continue;
      let qh = 0, qt = 0; QB[qt++] = c; lab[c] = n; let size = 0;
      while (qh < qt) { const v = QB[qh++], vi = v % GW, vj = (v / GW) | 0; size++;
        if (vi > 0) { const w = v - 1; if (lab[w] === -1 && !solid[w] && cov[w] < .5) { lab[w] = n; if (qt < QB.length) QB[qt++] = w; } }
        if (vi < GW - 1) { const w = v + 1; if (lab[w] === -1 && !solid[w] && cov[w] < .5) { lab[w] = n; if (qt < QB.length) QB[qt++] = w; } }
        if (vj > 0) { const w = v - GW; if (lab[w] === -1 && !solid[w] && cov[w] < .5) { lab[w] = n; if (qt < QB.length) QB[qt++] = w; } }
        if (vj < GH - 1) { const w = v + GW; if (lab[w] === -1 && !solid[w] && cov[w] < .5) { lab[w] = n; if (qt < QB.length) QB[qt++] = w; } }
      }
      if (size >= 2) n++;                                                 // a single 0.5 m² cell is sensor noise, not a region
    }
    unseenComp = n;
  }
  function paintFog(dtw, doSat) {
    const k = Math.exp(-dtw / .7);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const c = (GH - 1 - j) * GW + i, src = j * GW + i;                  // canvas row 0 is the crown
      let f = fresh[src]; if (f > .004) fresh[src] = f *= k; else f = fresh[src] = 0;
      const cq = (Math.min(1, cov[src]) * 31 + .5) | 0;
      fogPx[c] = LUT[(cq * 16 + ((f * 15 + .5) | 0)) * 2 + (((i + j) & 3) < 2 ? 1 : 0)];
      if (doSat) satPx[c] = LUTS[cq];
    }
    fogX.putImageData(fogIm, 0, 0); if (doSat) satX.putImageData(satIm, 0, 0);
  }

  // ---------------------------------------------------------------- drones and the relay chain
  const drones = []; const AT = [0, 0];
  for (let i = 0; i < ND; i++) drones.push({ id: i, u: 0, x: 0, z: 0, st: 'pad', launch: 0, linked: true, rssi: 0, uOk: 0, lat: 0, rel: -1, pz: 0, tx: 0, tz: 0, hold: 0, trail: new Float32Array(20), tn: 0, th: 0, hd: 0, pend: [] });
  const chain = [];                                                       // parked relays, in order from the portal
  let simT = 0, wallT = 0, phase = 'run', phaseT = 0, seedN = 1, found = false, foundT = 0, endT = 0, msg = null, done = {}, fadeA = 0, frontDbm = -60, cdT = 0;
  function newMission(fresh0) {
    if (fresh0) seedN = (seedN * 7919 + 104729) % 1000003 + 1;
    M = genMission(seedN * 2654435761 >>> 0); buildPath(); allocGrid(); layout();
    simT = 0; wallT = 0; phase = 'run'; phaseT = 0; found = false; foundT = 0; endT = 0; msg = null; done = {}; chain.length = 0; notes.length = 0; frontDbm = -60;
    drones.forEach((d, i) => Object.assign(d, { u: 0, x: BASE.x - 2 - i * 1.6, z: 0, st: 'pad', launch: (.3 + i * .42) * TL, linked: true, rssi: -40, uOk: 0, lat: (i % 3 - 1) * .7, rel: -1, hold: 0, tn: 0, th: 0, hd: 0 }));
    drones.forEach((d) => { d.pend.length = 0; });
    for (let i = 0; i < 6; i++) for (let j = 0; j < GH; j++) cov[j * GW + i] = 1;     // the mouth is seen from outside
    components(); paintFog(0, true);
  }
  const endNode = () => chain.length ? chain[chain.length - 1] : BASE;
  const movers = () => drones.filter((d) => d.st === 'move' || d.st === 'scout' || d.st === 'parkgo').sort((a, b) => b.u - a.u);
  function park(d, why) {
    d.st = 'relay'; d.rel = chain.length; d.pz = Math.min(D - .8, Math.max(d.z, hAt(d.x) + (D - hAt(d.x)) * .5));
    const prev = endNode(), db = rssi(prev.x, prev.z, d.x, d.pz); chain.push(d); d.rssiBack = db;
    const n = chain.length;
    if (n <= 2 || why) say(`drone ${d.id + 1} parks as relay ${n}`, d.x, d.pz, C.teal, 3.6, why || `${Math.round(db)} dBm back to ${n > 1 ? 'relay ' + (n - 1) : 'the portal'}`);
  }
  function step(ds) {
    simT += ds;
    if (phase === 'run') for (const d of drones) if (d.st === 'pad' && simT >= d.launch) { d.st = 'move'; d.u = 0; if (!done.launch) { done.launch = 1; say(`${ND} drones fly in one by one · GPS off`, BASE.x, 3, C.teal, 4.4, 'no radio through rock: the tube is the only path'); } }
    const mv = movers(), lead = mv.find((d) => d.st === 'move');
    const E = endNode();
    // lead: explore forward; wait for the queue if its link is about to break
    if (lead) {
      lead.rssi = rssi(E.x, E.z, lead.x, lead.z);
      const behind = mv.find((d) => d !== lead && d.st === 'move');
      let v = speedAt(lead.x);
      const canRelay = chain.length < ND - 3 && behind;
      if (lead.rssi < -87 && canRelay && lead.u - behind.u < 40 && lead.hold < 8 * TL) { v = 0; lead.hold += ds; } else if (lead.rssi >= -87) lead.hold = 0;   // hold for the next relay
      if (found && lead.x > M.xw - 6) v = 0;
      lead.u = Math.min(PU[NPATH - 1], lead.u + v * ds);
    }
    // followers: keep spacing behind whoever is ahead
    let ahead = lead;
    for (const d of mv) {
      if (d === lead) continue;
      if (d.st === 'parkgo') { d.u = Math.max(d.uOk, d.u - V_OPEN * ds); if (d.u <= d.uOk + .01) park(d, null); continue; }
      if (d.st === 'scout') { d.u = Math.min(PU[NPATH - 1] - 1, d.u + speedAt(d.x) * ds); continue; }
      const gap = (d.x > M.xd0 - 3 && d.x < M.xd1 + 3) ? 4 : 7, tgt = ahead ? ahead.u - gap : d.u + 99;
      d.u = Math.max(d.u, Math.min(tgt, d.u + speedAt(d.x) * ds));
      ahead = d;
    }
    for (const d of drones) {
      if (d.st === 'pad') continue;
      if (d.st === 'relay') { d.z += (d.pz - d.z) * Math.min(1, ds * .5); continue; }
      if (d.st === 'conf') { const a = simT * .08 + d.id; d.x += (d.tx + Math.cos(a) * .8 - d.x) * Math.min(1, ds * .4); d.z += (d.tz + Math.sin(a) * .4 - d.z) * Math.min(1, ds * .4); continue; }
      at(d.u, AT); const ox = d.x; d.x = AT[0]; const inPile = d.x > M.xd0 - 2 && d.x < M.xd1 + 2; d.z = AT[1] + (inPile ? 0 : d.lat * .8);
      if (d.x !== ox) d.hd = d.x > ox ? 0 : Math.PI;
    }
    // the relay rule: the queue's second drone parks when its own link back falls to the margin, or when the lead's is about to break
    if (lead && phase === 'run') {
      const f1 = mv.find((d) => d !== lead && d.st === 'move');
      for (const d of mv) { d.rssi = rssi(E.x, E.z, d.x, d.z); if (d.rssi >= PARK_DBM - 3) d.uOk = d.u; }
      const lastU = chain.length ? chain[chain.length - 1].u : 0;
      if (f1 && chain.length < ND - 3 && f1.u - lastU > 5 && !(found && f1.x > M.xd1 + 20)) {
        if (f1.rssi < PARK_DBM || lead.rssi < -86) {
          if (f1.rssi >= LOST_DBM) park(f1, chain.length >= 2 && lead.rssi < -100 && !done.crest ? (done.crest = 1, 'the pile hides the lead: a relay where both can see') : null);
          else { f1.st = 'parkgo'; }
        }
      }
    }
    // who is linked: the portal node and every relay are; a mover is linked if it hears one of them or a linked mover
    const mv2 = drones.filter((d) => d.st === 'move' || d.st === 'scout' || d.st === 'parkgo' || d.st === 'conf').sort((a, b) => a.u - b.u);
    let prevLinked = null;
    for (const d of mv2) {
      const was = d.linked; let a = rssi(BASE.x, BASE.z, d.x, d.z);
      for (const q of chain) { const v = rssi(q.x, q.z, d.x, d.z); if (v > a) a = v; }
      const b = prevLinked ? rssi(prevLinked.x, prevLinked.z, d.x, d.z) : -200;
      d.rssi = Math.max(a, b); d.linked = d.rssi >= LOST_DBM; if (d.linked) prevLinked = d;
      if (d.linked && !was && d.pend.length) { const n = d.pend.length; for (const p of d.pend) scan(p[0], p[1], true); d.pend.length = 0; if (n > 4 && !done.merge) { done.merge = 1; say(`drone ${d.id + 1} back in range: its map merges`, d.x, d.z, C.teal, 3.2); } }
      if (!d.linked && was && !done.lost) { done.lost = 1; say(`drone ${d.id + 1} out of range`, d.x, d.z, C.muted, 3, 'it keeps mapping alone and merges later'); }
    }
    const lead2 = movers().find((d) => d.st === 'move') || mv2[mv2.length - 1];
    if (lead2) frontDbm = lead2.rssi;
    // mapping
    for (const d of drones) {
      if (d.st === 'pad' || d.st === 'relay') continue;
      if (d.linked) scan(d.x, d.z, true); else if (!d.pend.length || Math.abs(d.pend[d.pend.length - 1][0] - d.x) > 1) d.pend.push([d.x, d.z]);
    }
    // story beats
    if (lead && !done.plug && lead.x > M.xd0 - 6) { done.plug = 1; say('debris plug: the only way on is a gap under the crown', M.xd0 + 4, D - 1, C.ink, 4.4, `${M.gmin.toFixed(1)}–${M.gmax.toFixed(1)} m high, mapped as they squeeze through`); }
    if (lead && !done.vox && lead.x > M.xc0 + 3) { done.vox = 1; say('indoor mode: 3-D voxels at 5 cm, LiDAR', lead.x, lead.z, C.teal, 3.6, 'the pile’s shape appears as they scan it'); }
    if (lead && !done.through && lead.x > M.xd1 + 2) { done.through = 1; say(`through the gap: ${M.Ld} m of debris`, M.xd1, D - 1, C.ink, 3.8, `${chain.length} relays strung behind the lead`); }
    if (!found) for (const d of drones) {
      if (!d.linked || d.st === 'pad' || d.st === 'relay') continue;
      if (Math.abs(d.x - M.xw) < 13 && los(d.x, d.z, M.xw, 1)) {
        found = true; foundT = wallT;
        say(`people found: ${WORKERS}, beyond the debris`, M.xw, 1.4, C.heat, 6, 'thermal + camera agree · 3 drones confirm', 'found');
        const free = movers().filter((q) => q.st === 'move').slice(0, 3);
        free.forEach((q, k) => { q.st = 'conf'; q.tx = M.xw - 8 + k * 6; q.tz = 3.8 + (k % 2) * 1.6; });
        // the news hops back to the portal, relay by relay
        msg = { t0: wallT, pts: [[d.x, d.z], ...chain.slice().reverse().map((q) => [q.x, q.pz]), [BASE.x, BASE.z + 1]] };
        for (const q of movers()) if (q.st === 'move') q.st = 'scout';
        break;
      }
    }
    if (found && phase === 'run' && wallT - foundT > 3.2) for (const d of drones) if (d.st === 'conf' && d.id % 2 === 0) { d.st = 'scout'; d.u = uOfX(d.x); }
    if (msg && !msg.done && wallT - msg.t0 > (msg.pts.length - 1) * .3) { msg.done = true; say(`the news reaches the portal over ${chain.length} relay hops`, BASE.x, 3, C.heat, 4.2, 'the chain stays as the lifeline'); }
  }
  function checkEnd() {
    if (phase !== 'run') return;
    if ((found && unseenComp === 0 && msg && msg.done && wallT - foundT > 4.5) || wallT > 90) {
      phase = 'done'; phaseT = 0; endT = simT;
      say('nothing left unsearched: β₀ = 0', (M.xd1 + M.XF) / 2, D - 1, C.teal, 3.4, 'relays stay in place as the lifeline', 'end');
      for (const d of drones) if (d.st === 'scout' || d.st === 'move') { d.st = 'conf'; d.tx = d.x; d.tz = d.z; }
    }
  }

  // ---------------------------------------------------------------- callouts
  const notes = [];
  function say(s, x, z, col, life = 3.6, s2 = '', kind = '') {
    notes.push({ s, s2, x, z, col, t: wallT, life, kind, placed: false, ox: 0, oy: 0 });
    while (notes.length > (L && L.phone ? 2 : 3)) { const i = notes.findIndex((n) => n.kind !== 'found'); notes.splice(i >= 0 ? i : 0, 1); }
  }
  const occR = []; let nOcc = 0;
  const addOcc = (x, y, w, h) => { occR[nOcc++] = [x, y, w, h]; };
  const overlap = (x, y, w, h) => { let a = 0; for (let k = 0; k < nOcc; k++) { const o = occR[k], ix = Math.min(x + w, o[0] + o[2]) - Math.max(x, o[0]), iy = Math.min(y + h, o[1] + o[3]) - Math.max(y, o[1]); if (ix > 0 && iy > 0) a += ix * iy; } return a; };
  function pill(x, y, w, h, a = .86) { ctx.fillStyle = `rgba(27,30,61,${a})`; roundRect(ctx, x, y, w, h, Math.min(9, h / 2)); ctx.fill(); ctx.strokeStyle = 'rgba(220,214,236,.13)'; ctx.lineWidth = 1; ctx.stroke(); }
  function drawNotes() {
    const ph = L.phone, fs = ph ? 11 : 12, fs2 = ph ? 10.5 : 11;
    for (const n of notes) {
      const age = wallT - n.t; if (age > n.life) continue;
      const a = Math.min(1, age / .3) * Math.min(1, (n.life - age) / .7) * (phase === 'sum' ? Math.max(0, 1 - phaseT / .4) : phase === 'fade' ? 0 : 1);
      if (a <= 0) continue;
      ctx.font = `500 ${fs}px ${F.sans}`; let w = ctx.measureText(n.s).width;
      if (n.s2) { ctx.font = `400 ${fs2}px ${F.sans}`; w = Math.max(w, ctx.measureText(n.s2).width); }
      const bw = Math.min(w + 18, L.ax1 - L.ax0), bh = n.s2 ? (ph ? 36 : 40) : 24, axp = X(n.x), ayp = Y(n.z);
      if (!n.placed) {
        for (const m2 of notes) addOcc(X(m2.x) - 14, Y(m2.z) - 14, 28, 28);
        if (found) addOcc(X(M.xw) - 60, Y(D * .8), 120, Y(0) - Y(D * .8));
        const cands = [[16, -bh - 30], [-16 - bw, -bh - 30], [16, 34], [-16 - bw, 34], [-bw / 2, -bh - 48], [-bw / 2, 48], [16, -bh - 70], [-16 - bw, -bh - 70], [16, 70], [-bw / 2, 92]];
        let ok = null, best = 1e9;
        for (const [dx, dy] of cands) { const bx = clamp(axp + dx, L.ax0, L.ax1 - bw), by = clamp(ayp + dy, 74, L.H - bh - (ph ? 40 : 10)), o = overlap(bx, by, bw, bh); if (o < best) { best = o; ok = [bx - axp, by - ayp]; if (o === 0) break; } }
        n.ox = ok[0]; n.oy = ok[1]; n.placed = true;
      }
      const bx = axp + n.ox, by = ayp + n.oy; addOcc(bx, by, bw, bh);
      ctx.globalAlpha = a;
      const cx = clamp(axp, bx + 8, bx + bw - 8), cy = by + bh / 2 > ayp ? by : by + bh;
      ctx.strokeStyle = 'rgba(220,214,236,.42)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(axp, ayp); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.fillStyle = n.col; ctx.beginPath(); ctx.arc(axp, ayp, 2.4, 0, TAU); ctx.fill();
      pill(bx, by, bw, bh);
      text(ctx, n.s, bx + 9, by + 16, { size: fs, color: n.col, weight: 500 });
      if (n.s2) text(ctx, n.s2, bx + 9, by + (ph ? 30 : 32), { size: fs2, color: C.muted });
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- drawing
  const fmtClock = (t) => { t = Math.floor(t); const h = (t / 3600) | 0, mm = ((t % 3600) / 60) | 0, ss = t % 60; return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; };
  const fmtDur = (t) => { t = Math.round(t); return `${(t / 60) | 0} min ${String(t % 60).padStart(2, '0')} s`; };
  const dbmCol = (v) => v > -76 ? C.teal : v > -86 ? C.apricot : C.danger;
  function bars(x, y, v, h = 10) {
    const n = v > -70 ? 4 : v > -78 ? 3 : v > -85 ? 2 : v > -90 ? 1 : 0, col = dbmCol(v);
    for (let k = 0; k < 4; k++) { const bh = h * (k + 1) / 4; ctx.fillStyle = k < n ? col : 'rgba(220,214,236,.18)'; ctx.fillRect(x + k * 4, y - bh, 2.6, bh); }
  }
  function droneGlyph(p, x, y, hd, a) { const c = Math.cos(hd + Math.PI / 4) * a, s = Math.sin(hd + Math.PI / 4) * a; p.moveTo(x - c, y - s); p.lineTo(x + c, y + s); p.moveTo(x + s, y - c); p.lineTo(x - s, y + c); }
  function rotors(p, x, y, hd, a, rr) { const c = Math.cos(hd + Math.PI / 4) * a, s = Math.sin(hd + Math.PI / 4) * a; for (const [qx, qy] of [[x - c, y - s], [x + c, y + s], [x + s, y - c], [x - s, y + c]]) { p.moveTo(qx + rr, qy); p.arc(qx, qy, rr, 0, TAU); } }
  let hover = null, hoverT = 0;
  function drawInset() {
    const I = L.inset, ph = L.phone; if (!I) return;
    const prog = M.Ld ? nSeen / NSMP : 0; if (prog < .02 || (ph && (phase === 'sum' || phase === 'fade'))) return;
    const a = Math.min(1, prog * 8) * (phase === 'fade' ? 1 - Math.min(1, phaseT) : 1);
    ctx.globalAlpha = a; pill(I.x, I.y, I.w, I.h, .88); addOcc(I.x, I.y, I.w, I.h);
    text(ctx, 'debris profile, as mapped', I.x + 12, I.y + 17, { size: ph ? 10.5 : 11.5, color: C.muted });
    text(ctx, `${Math.round(100 * prog)} %`, I.x + I.w - 12, I.y + 17, { size: ph ? 10.5 : 11.5, color: C.apricot, font: F.mono, align: 'right' });
    const px0 = I.x + 12, px1 = I.x + I.w - 12, py0 = I.y + 26, py1 = I.y + I.h - (ph ? 18 : 22), xa = M.x0h, xb = M.xd1 + 3;
    const PXf = (x) => px0 + (x - xa) / (xb - xa) * (px1 - px0), PZf = (z) => py1 - z / D * (py1 - py0);
    ctx.fillStyle = 'rgba(35,37,71,.9)'; ctx.fillRect(px0, PZf(D), px1 - px0, PZf(0) - PZf(D));
    // unmapped outline, faint; mapped surface filled with a teal edge
    ctx.strokeStyle = 'rgba(220,214,236,.2)'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 0; k < NSMP; k++) { const x = PXf(smpX[k]), y = PZf(hAt(smpX[k])); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#6b6388'; ctx.strokeStyle = C.teal; ctx.lineWidth = 1.6;
    let k = 0;
    while (k < NSMP) {
      while (k < NSMP && !smpSeen[k]) k++; if (k >= NSMP) break;
      const k0 = k; while (k < NSMP && smpSeen[k]) k++;
      ctx.beginPath(); ctx.moveTo(PXf(smpX[k0] - .25), PZf(0)); for (let q = k0; q < k; q++) ctx.lineTo(PXf(smpX[q]), PZf(hAt(smpX[q]))); ctx.lineTo(PXf(smpX[k - 1] + .25), PZf(0)); ctx.closePath(); ctx.fill();
      ctx.beginPath(); for (let q = k0; q < k; q++) { const x = PXf(smpX[q]), y = PZf(hAt(smpX[q])); q === k0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(155,151,183,.9)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(px0, PZf(D)); ctx.lineTo(px1, PZf(D)); ctx.moveTo(px0, PZf(0)); ctx.lineTo(px1, PZf(0)); ctx.stroke();
    // relays in the pile, as dots
    ctx.fillStyle = C.teal; for (const d of chain) if (d.x > M.xd0 && d.x < M.xd1) { ctx.beginPath(); ctx.arc(PXf(d.x), PZf(d.pz), 2.4, 0, TAU); ctx.fill(); }
    // where a pipe could go: straight through the pile, low down
    if (prog > .92 || found) {
      const pa = Math.min(1, ((found ? wallT - foundT : 0) + (prog - .7) * 10) / 1.2);
      ctx.globalAlpha = a * clamp(pa, 0, 1); ctx.strokeStyle = C.apricot; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(PXf(M.xd0 - 2), PZf(1.3)); ctx.lineTo(PXf(M.xd1 + 2), PZf(1.3)); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, ph ? `a pipe could go here · ${M.Ld} m` : `a pipe could go here: ${M.Ld} m through the pile`, (px0 + px1) / 2, PZf(1.3) - 5, { size: ph ? 10 : 11, color: C.apricot, align: 'center' });
      ctx.globalAlpha = a;
    }
    ctx.strokeStyle = 'rgba(220,214,236,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(PXf(M.xd0), PZf(0) + 2); ctx.lineTo(PXf(M.xd0), PZf(0) + 5); ctx.moveTo(PXf(M.xd1), PZf(0) + 2); ctx.lineTo(PXf(M.xd1), PZf(0) + 5); ctx.stroke();
    text(ctx, '0', PXf(M.xd0), I.y + I.h - (ph ? 5 : 7), { size: 10, color: C.faint, font: F.mono, align: 'center' });
    text(ctx, `${M.Ld} m`, PXf(M.xd1), I.y + I.h - (ph ? 5 : 7), { size: 10, color: C.faint, font: F.mono, align: 'center' });
    if (!ph) text(ctx, `gap under the crown ${M.gmin.toFixed(1)}–${M.gmax.toFixed(1)} m`, (px0 + px1) / 2, I.y + I.h - 7, { size: 11, color: C.faint, align: 'center' });
    ctx.globalAlpha = 1;
  }
  function draw() {
    const { W, H, s, phone } = L;
    nOcc = 0;
    ctx.drawImage(terr, 0, 0, W, H);
    // the fog over the tube
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const tx0 = X(0), ty0 = Y(D), tw = GW * s, th = Y(0) - Y(D);
    ctx.globalCompositeOperation = 'saturation'; ctx.drawImage(satCv, tx0, ty0, tw, th);
    ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(fogCv, tx0, ty0, tw, th);
    // the point cloud: crown, floor and the pile's surface where seen
    ctx.fillStyle = 'rgba(127,212,207,.75)'; ctx.beginPath();
    for (let i = 0; i < GW; i += 2) { if (cov[(GH - 1) * GW + i] >= .5) ctx.rect(X(i + .5) - .7, ty0 + .5, 1.4, 1.4); if (cov[i] >= .5 && !solid[i]) ctx.rect(X(i + .5) - .7, Y(0) - 2, 1.4, 1.4); }
    for (let k = 0; k < NSMP; k += 1) if (smpSeen[k]) ctx.rect(X(smpX[k]) - .8, Y(hAt(smpX[k])) - .8, 1.6, 1.6);
    ctx.fill();
    // the workers: a very faint hint until found, then warm
    const fa = found ? Math.min(1, (wallT - foundT) / .8) : 0;
    { const gx = X(M.xw), gy = Y(.8), gs = (phone ? 90 : 170) * (1 + .06 * Math.sin(wallT * 2.4));
      ctx.globalAlpha = .06 + .75 * fa; ctx.drawImage(SPR_HEAT, gx - gs / 2, gy - gs * .3, gs, gs * .6); ctx.globalAlpha = 1;
      if (fa > 0) {                                                      // 41 small figures: some standing, most sitting
        const k = phone ? .75 : 1;
        ctx.globalAlpha = fa; ctx.fillStyle = C.heat; ctx.beginPath();
        for (let i = 0; i < WORKERS; i++) { const x = X(M.wk[i * 3]) + (i % 2 ? .8 : -.8), sit = M.wk[i * 3 + 1] < .5, y = Y(.7) - .5, hh = (sit ? 5 : 9) * k, w = 2.4 * k; ctx.moveTo(x - w / 2, y); ctx.rect(x - w / 2, y - hh, w, hh); ctx.moveTo(x + 1.7 * k, y - hh - 1.8 * k); ctx.arc(x, y - hh - 1.8 * k, 1.7 * k, 0, TAU); }
        ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    // chain links: the portal node, each relay, then the drones in the queue
    const A = phone ? 3.8 : 5.2, RR = phone ? 1.5 : 1.95;
    let prev = BASE; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
    for (const d of chain) { const q = clamp((d.rssiBack + 95) / 30, 0, 1); ctx.strokeStyle = `rgba(127,212,207,${(.3 + .55 * q).toFixed(3)})`; ctx.beginPath(); ctx.moveTo(X(prev.x), Y(prev === BASE ? BASE.z + 1.5 : prev.z)); ctx.lineTo(X(d.x), Y(d.z)); ctx.stroke(); prev = d; }
    const mvd = drones.filter((d) => d.st !== 'pad' && d.st !== 'relay').sort((a, b) => a.x - b.x);
    let pl = prev;
    for (const d of mvd) { if (!d.linked) continue; const q = clamp((d.rssi + 95) / 30, 0, 1); ctx.strokeStyle = `rgba(127,212,207,${(.18 + .4 * q).toFixed(3)})`; ctx.beginPath(); ctx.moveTo(X(pl.x), Y(pl === BASE ? BASE.z + 1.5 : pl.z)); ctx.lineTo(X(d.x), Y(d.z)); ctx.stroke(); pl = d; }
    ctx.setLineDash([]);
    // trails
    ctx.lineCap = 'round';
    for (let k = 1; k < 9; k++) {
      ctx.strokeStyle = `rgba(127,212,207,${(.32 * (1 - k / 9)).toFixed(3)})`; ctx.lineWidth = 1.5 - k * .1; ctx.beginPath();
      for (const d of drones) { if (d.tn <= k + 1) continue; const a0 = ((d.th - k + 10) % 10) * 2, a1 = ((d.th - k - 1 + 10) % 10) * 2; ctx.moveTo(X(d.trail[a0]), Y(d.trail[a0 + 1])); ctx.lineTo(X(d.trail[a1]), Y(d.trail[a1 + 1])); }
      ctx.stroke();
    }
    // relays: a ring and a number
    for (const d of chain) {
      const x = X(d.x), y = Y(d.z), q = clamp((d.rssiBack + 95) / 30, 0, 1);
      ctx.strokeStyle = `rgba(127,212,207,${(.35 + .4 * q).toFixed(3)})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, A + 4.5, 0, TAU); ctx.stroke();
    }
    for (const d of drones) {
      const x = X(d.x), y = Y(d.z), g = phone ? 20 : 28;
      ctx.globalAlpha = d.st === 'pad' ? .12 : d.linked ? .42 : .15; ctx.drawImage(SPR_TEAL, x - g / 2, y - g / 2, g, g);
    }
    ctx.globalAlpha = 1;
    for (let pass = 0; pass < 2; pass++) {
      const pa = new Path2D(), pr = new Path2D();
      for (const d of drones) { if ((d.linked ? 0 : 1) !== pass) continue; const x = X(d.x), y = Y(d.z), sc = d.st === 'pad' ? .7 : 1; droneGlyph(pa, x, y, d.hd, A * sc); rotors(pr, x, y, d.hd, A * sc, RR * sc); }
      ctx.strokeStyle = 'rgba(16,18,40,.7)'; ctx.lineWidth = 3; ctx.stroke(pa);
      ctx.strokeStyle = pass ? 'rgba(127,212,207,.45)' : C.teal; ctx.lineWidth = 1.5; ctx.stroke(pa); ctx.fillStyle = 'rgba(127,212,207,.3)'; ctx.fill(pr); ctx.lineWidth = 1.1; ctx.stroke(pr);
    }
    const rf = phone ? 10 : 11; let lastLx = -99;
    for (const d of chain) {
      const x = X(d.x), y = Y(d.z) - A - 9;
      if (x - lastLx < (phone ? 16 : 20)) continue; lastLx = x;
      text(ctx, `R${d.rel + 1}`, x, y, { size: rf, color: C.teal, font: F.mono, weight: 500, align: 'center' });
      if (!phone) text(ctx, `${Math.round(d.rssiBack)}`, x, Y(d.z) + A + 15, { size: 10.5, color: C.faint, font: F.mono, align: 'center' });
    }
    // the message hopping home
    if (msg && !msg.done) {
      const t = (wallT - msg.t0) / .3, k = Math.min(msg.pts.length - 2, Math.floor(t)), f = t - k, p0 = msg.pts[k], p1 = msg.pts[k + 1];
      const x = X(p0[0] + (p1[0] - p0[0]) * f), y = Y(p0[1] + (p1[1] - p0[1]) * f);
      ctx.globalAlpha = .9; ctx.drawImage(SPR_HEAT, x - 14, y - 14, 28, 28); ctx.globalAlpha = 1; ctx.fillStyle = C.heat; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, TAU); ctx.fill();
    }
    // the lead's signal back to the chain
    const lead = drones.filter((d) => d.st === 'move' || d.st === 'scout').sort((a, b) => b.u - a.u)[0];
    if (lead && phase === 'run') {
      const x = X(lead.x), y = Y(lead.z) + A + (phone ? 13 : 16), s0 = `${Math.round(lead.rssi)} dBm`;
      ctx.font = `500 ${phone ? 10 : 11}px ${F.mono}`; const w0 = ctx.measureText(s0).width;
      pill(x - w0 / 2 - 22, y - 11, w0 + 30, 16, .78); bars(x - w0 / 2 - 16, y + 2, lead.rssi, 9);
      text(ctx, s0, x - w0 / 2 + 2, y + 1, { size: phone ? 10 : 11, color: dbmCol(lead.rssi), font: F.mono, weight: 500 });
      addOcc(x - w0 / 2 - 22, y - 11, w0 + 30, 16);
    }
    // HUD
    const fsH = phone ? 11 : 12, tg = ctx.createLinearGradient(0, 0, 0, phone ? 124 : 134);
    tg.addColorStop(0, 'rgba(27,30,61,.7)'); tg.addColorStop(.6, 'rgba(27,30,61,.5)'); tg.addColorStop(1, 'rgba(27,30,61,0)'); ctx.fillStyle = tg; ctx.fillRect(0, 0, W, phone ? 124 : 134);
    const bg2 = ctx.createLinearGradient(0, H - (phone ? 70 : 52), 0, H); bg2.addColorStop(0, 'rgba(27,30,61,0)'); bg2.addColorStop(1, 'rgba(27,30,61,.7)'); ctx.fillStyle = bg2; ctx.fillRect(0, H - (phone ? 70 : 52), W, phone ? 70 : 52);
    ctx.font = `500 ${fsH}px ${F.mono}`; const cl = fmtClock(phase === 'run' ? simT : endT), cw = ctx.measureText(cl).width;
    text(ctx, cl, L.ax0, phone ? 88 : 92, { size: fsH, color: C.ink, font: F.mono, weight: 500 });
    text(ctx, ` · time-lapse ×${TL}`, L.ax0 + cw, phone ? 88 : 92, { size: fsH, color: C.muted });
    text(ctx, 'indoor mode: 3-D voxels at 5 cm, GPS off, relay chain', L.ax0, phone ? 104 : 110, { size: phone ? 10.5 : 11.5, color: C.muted });
    addOcc(L.ax0 - 4, 74, phone ? 330 : 360, 44);
    const b0 = B0S.update(phase === 'run' ? unseenComp : 0, phase === 'run' ? simT : 0);
    ctx.font = `600 ${phone ? 13 : 15}px ${F.mono}`; const bw0 = ctx.measureText(b0).width;
    text(ctx, b0, L.ax1, phone ? 88 : 93, { size: phone ? 13 : 15, color: b0 === '0' ? C.teal : C.ink, font: F.mono, weight: 600, align: 'right' });
    text(ctx, 'unsearched β₀', L.ax1 - bw0 - 8, phone ? 88 : 92, { size: phone ? 10.5 : 11.5, color: C.muted, align: 'right' });
    if (!phone) {
      const s1 = `${Math.round(frontDbm)} dBm`; ctx.font = `500 12px ${F.mono}`; const w1 = ctx.measureText(s1).width;
      text(ctx, s1, L.ax1, 111, { size: 12, color: dbmCol(frontDbm), font: F.mono, weight: 500, align: 'right' });
      bars(L.ax1 - w1 - 24, 112, frontDbm, 10);
      text(ctx, 'radio at the front', L.ax1 - w1 - 32, 111, { size: 11.5, color: C.muted, align: 'right' });
    }
    addOcc(L.ax1 - 260, 74, 260, 46);
    // labels on the scene
    text(ctx, 'portal', X(0) + 4, Y(D + 3.2) - 6, { size: phone ? 10.5 : 11, color: C.muted });
    if (!phone) text(ctx, 'workers’ section, lights still on', X(M.xd1 + 8), Y(D) + 14, { size: 11, color: 'rgba(246,226,200,.55)' });
    text(ctx, 'excavation face', X(M.XF) - 4, Y(0) + (phone ? 14 : 17), { size: phone ? 10.5 : 11, color: C.muted, align: 'right' });
    // scale bar
    const sbm = phone ? 20 : 25, sbx = L.ax0 + (phone ? 0 : 6), sby = L.H - (phone ? 40 : 20);
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(sbx, sby - 4); ctx.lineTo(sbx, sby); ctx.lineTo(sbx + sbm * s, sby); ctx.lineTo(sbx + sbm * s, sby - 4); ctx.stroke();
    text(ctx, `${sbm} m · vertical ×${L.VE}`, sbx + sbm * s + 6, sby + 1, { size: 11, color: C.muted, font: F.mono });
    addOcc(sbx - 4, sby - 14, 220, 20); addOcc(L.W - 200, L.H - 70, 200, 70); addOcc(0, 0, L.W, 70); if (L.left > 0) addOcc(0, 0, L.left * L.W, L.H);
    drawInset();
    drawNotes();
    if (hover && wallT < hoverT) {
      let best = null, bd = (phone ? 22 : 16) ** 2;
      for (const d of drones) { const q = (X(d.x) - hover[0]) ** 2 + (Y(d.z) - hover[1]) ** 2; if (q < bd) { bd = q; best = d; } }
      if (best) {
        const d = best, where = d.x < 0 ? 'outside' : d.x < M.xd0 - 2 ? 'approach' : d.x < M.xd1 + 2 ? 'over the pile' : 'dry section';
        let s0 = d.st === 'relay' ? `relay ${d.rel + 1}, ${Math.round(d.rssiBack)} dBm back` : d.st === 'pad' ? 'on the pad' : d.st === 'conf' ? 'confirming: thermal + camera' : `${where}, ${Math.round(d.x)} m in, ${Math.round(d.rssi)} dBm`;
        if (!d.linked) s0 += ', out of range';
        const s1 = `drone ${d.id + 1}: ${s0}`; ctx.font = `400 11.5px ${F.sans}`; const tw2 = ctx.measureText(s1).width + 16;
        const hx = clamp(X(d.x) + 12, 8, W - tw2 - 8), hy = clamp(Y(d.z) - 34, 72, H - 30);
        pill(hx, hy, tw2, 22, .92); text(ctx, s1, hx + 8, hy + 15, { size: 11.5, color: C.ink });
      }
    }
    if (phase === 'sum' || phase === 'fade') {
      const a = phase === 'sum' ? Math.min(1, phaseT / .5) : 1, pw = Math.min(380, L.ax1 - L.ax0 - 10), ph2 = phone ? 160 : 182;
      const px = phone ? (L.ax0 + L.ax1) / 2 - pw / 2 : L.ax1 - pw - 10, py = phone ? clamp(L.inset.y - 8, Y(0) + 24, H - ph2 - 34) : clamp(Y(D) - ph2 - 40, 130, H - ph2 - 80);
      ctx.globalAlpha = a; pill(px, py, pw, ph2, .93);
      text(ctx, `${WORKERS} people found`, px + 20, py + 34, { size: phone ? 18 : 21, color: C.heat, font: F.serif });
      text(ctx, 'beyond the debris · nothing left unsearched (β₀ = 0)', px + 20, py + 56, { size: phone ? 11 : 12, color: C.teal });
      const rows = [['Debris mapped', `${M.Ld} m long · ${Math.round(100 * nSeen / NSMP)} %`], ['Relay links', `${chain.length}`], ['Drones', `${ND}`], ['Mission time', fmtDur(endT)]];
      rows.forEach(([k, v], i) => { const yy = py + 84 + i * (phone ? 16 : 19); text(ctx, k, px + 20, yy, { size: 12, color: C.muted }); text(ctx, v, px + pw - 20, yy, { size: 12, color: C.ink, font: F.mono, align: 'right' }); });
      ctx.globalAlpha = 1;
    }
    if (fadeA > 0) { ctx.fillStyle = `rgba(27,30,61,${fadeA.toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  }

  // ---------------------------------------------------------------- loop
  let frameN = 0, lastLeft = stage.dataset.left;
  function tick(dt) {
    wallT += dt; phaseT += dt;
    if (phase === 'run' || phase === 'done') {
      const ds = dt * TL, n = Math.max(1, Math.ceil(ds / .3));
      for (let k = 0; k < n; k++) step(ds / n);
      cdT -= dt; if (cdT <= 0) { components(); cdT = .25; }
      checkEnd();
      if (phase === 'done' && phaseT > 2.6) { phase = 'sum'; phaseT = 0; }
    } else if (phase === 'sum') { step(dt * TL); if (phaseT > 6) { phase = 'fade'; phaseT = 0; } }
    else if (phase === 'fade') { fadeA = Math.min(1, phaseT / .9); if (phaseT > 1) { newMission(true); fadeA = 1; phase = 'run'; } }
    if (phase !== 'fade' && fadeA > 0) fadeA = Math.max(0, fadeA - dt / .9);
    for (const d of drones) { d.trail[d.th * 2] = d.x; d.trail[d.th * 2 + 1] = d.z; d.th = (d.th + 1) % 10; if (d.tn < 10) d.tn++; if (d.st === 'pad' || d.st === 'relay') d.tn = 0; }
  }
  function reads() { rR.set(String(chain.length)); rM.set(`${Math.round(100 * nSeen / NSMP)} %`); rP.set(found ? String(WORKERS) : '0'); }
  newMission(false);
  const loop = kit.loop((dt) => {
    dt = clamp(dt, 0, .05); frameN++;
    tick(dt);
    if (stage.dataset.left !== lastLeft) { lastLeft = stage.dataset.left; layout(); }
    paintFog(dt, frameN % 3 === 0);
    draw(); reads();
  });
  cv.onResize(() => { if (M) layout(); });
  const onMove = (e) => { hover = [e.offsetX, e.offsetY]; hoverT = wallT + (e.pointerType === 'mouse' ? 1e9 : 2.5); };
  const onLeave = () => { hover = null; };
  el.addEventListener('pointermove', onMove); el.addEventListener('pointerdown', onMove); el.addEventListener('pointerleave', onLeave);
  draw();
  return {
    start: loop.start, stop: loop.stop,
    destroy() { loop.stop(); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onMove); el.removeEventListener('pointerleave', onLeave); cv.destroy(); },
    warp(sec) { const n = Math.round(sec / .05); for (let k = 0; k < n; k++) { tick(.05); paintFog(.05, false); } paintFog(.05, true); draw(); reads(); },
    bench(n = 60) { let t0 = performance.now(); for (let k = 0; k < n; k++) { tick(1 / 60); paintFog(1 / 60, k % 3 === 0); } const a = (performance.now() - t0) / n; t0 = performance.now(); for (let k = 0; k < 10; k++) draw(); return { simMs: +a.toFixed(3), drawMs: +((performance.now() - t0) / 10).toFixed(2) }; },
    pick() { const d = drones.find((q) => q.st === 'move' || q.st === 'scout' || q.st === 'conf') || drones[0]; return [X(d.x), Y(d.z)]; },
    info() { return { phase, wallT: +wallT.toFixed(1), simT: Math.round(simT), relays: chain.length, mapped: Math.round(100 * nSeen / NSMP), found, beta0: unseenComp, front: Math.round(frontDbm), lead: Math.round((drones.filter((d) => d.st === 'move').sort((a, b) => b.u - a.u)[0] || { x: -1 }).x), xd0: M.xd0, xd1: M.xd1, xw: M.xw, XF: M.XF }; },
  };
}

// Three rules, no leader (Reynolds 1987, "boids"). A school of fish in which every fish uses only what it can sense
// nearby: separation (do not crowd the fish right next to you), alignment (match the heading of the fish around you)
// and cohesion (drift toward the centre of the fish you can see). Nobody leads, nobody sees the whole school.
// The cursor is a predator: fish within reach flee, flash apricot and the school splits around it and re-forms.
// One focus fish wears its three perception rings. Turn a rule off and the school changes within a couple of seconds.
export default function mount({ stage, controls, readouts, kit }) {
  const { C, F } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx;
  cv.cv.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------ size: count and radii scale with the stage
  const area0 = Math.max(1, cv.w * cv.h);
  const N = Math.round(Math.max(150, Math.min(430, 400 * Math.sqrt(area0 / 504000))));
  let SC = 1;                                                     // px scale (1 on desktop, ~.82 on a phone)
  const P = {};
  function scaleParams() {
    SC = Math.max(.86, Math.min(1.12, .62 + .5 * Math.sqrt(cv.w * cv.h / 504000)));
    P.rs = 13 * SC; P.ra = 42 * SC; P.rc = 70 * SC;                // separation, alignment, cohesion radii (px)
    P.vc = 78 * SC; P.vmin = 40 * SC; P.vmax = 104 * SC; P.vpanic = 120 * SC;
    P.Fm = 175 * SC;                                              // max steering force per rule (px/s^2)
    P.margin = 54 * SC; P.rp = 92 * SC;                           // soft-wall margin, predator reach
  }
  scaleParams();
  const K = { ws: 2.1, wa: 1.5, wc: 1.0, ww: .5, wander: 2.1, wwall: 3.2, wf: 3.4, turn: 5, turnP: 7 };

  // ------------------------------------------------------------ state (preallocated)
  const x = new Float64Array(N), y = new Float64Array(N), vx = new Float64Array(N), vy = new Float64Array(N);
  const nvx = new Float64Array(N), nvy = new Float64Array(N), st = new Float32Array(N), wa = new Float64Array(N), ph = new Float64Array(N);
  const rule = { sep: 1, ali: 1, coh: 1 };
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rnd()); };
  let focus = 0;
  function seedSchool() {                                        // three loose schools in different corners, each already schooling: they meet and merge
    const W = cv.w, H = cv.h, gap = P.rs * 1.05, spots = [[.24, .32], [.74, .3], [.5, .72]];
    let i = 0;
    for (let g = 0; g < 3; g++) {
      const n = g < 2 ? Math.round(N / 3) : N - 2 * Math.round(N / 3), cols = Math.ceil(Math.sqrt(n * 1.6)), rows = Math.ceil(n / cols);
      const h0 = rnd() * TAU, c = Math.cos(h0), s = Math.sin(h0), x0 = W * spots[g][0], y0 = H * spots[g][1];
      for (let k = 0; k < n; k++, i++) {
        const u = (k % cols - (cols - 1) / 2) * gap + (rnd() - .5) * gap * .5, v = (((k / cols) | 0) - (rows - 1) / 2) * gap + (rnd() - .5) * gap * .5;
        x[i] = x0 + u * c - v * s; y[i] = y0 + u * s + v * c;
        const h = h0 + gauss() * .12; vx[i] = Math.cos(h) * P.vc; vy[i] = Math.sin(h) * P.vc; wa[i] = rnd() * TAU; ph[i] = rnd() * TAU; st[i] = 0;
      }
    }
  }
  seedSchool();

  // ------------------------------------------------------------ spatial hash (cell = cohesion radius)
  let gw = 1, gh = 1, CS = 1, head = new Int32Array(1);
  const next = new Int32Array(N), cellOf = new Int32Array(N);
  function grid() { CS = P.rc; gw = Math.ceil(cv.w / CS) + 1; gh = Math.ceil(cv.h / CS) + 1; if (head.length < gw * gh) head = new Int32Array(gw * gh); }
  grid();
  function hash() {
    head.fill(-1, 0, gw * gh);
    for (let i = 0; i < N; i++) {
      let gx = (x[i] / CS) | 0, gy = (y[i] / CS) | 0; if (gx < 0) gx = 0; else if (gx >= gw) gx = gw - 1; if (gy < 0) gy = 0; else if (gy >= gh) gy = gh - 1;
      const c = gy * gw + gx; cellOf[i] = c; next[i] = head[c]; head[c] = i;
    }
  }
  let lastW = cv.w, lastH = cv.h;
  cv.onResize((w, h) => {
    const sx = w / lastW, sy = h / lastH; lastW = w; lastH = h;
    const old = SC; scaleParams(); const k = SC / old;
    for (let i = 0; i < N; i++) { x[i] *= sx; y[i] *= sy; vx[i] *= k; vy[i] *= k; }
    grid(); layoutText();
  });

  // ------------------------------------------------------------ the predator (the user's hand)
  const pred = { x: 0, y: 0, on: false, until: 0, touch: false };
  let T = 0;
  const onMove = (e) => {
    pred.x = e.offsetX; pred.y = e.offsetY; touched = true;
    if (e.pointerType === 'mouse') { pred.on = true; pred.touch = false; }
    else if (pred.on) pred.until = T + 1.5;
  };
  let touched = false;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const onDown = (e) => { pred.x = e.offsetX; pred.y = e.offsetY; pred.on = true; pred.touch = e.pointerType !== 'mouse'; pred.until = T + 1.5; touched = true; };
  const onLeave = (e) => { if (e.pointerType === 'mouse') pred.on = false; };
  cv.cv.addEventListener('pointermove', onMove);
  cv.cv.addEventListener('pointerdown', onDown);
  cv.cv.addEventListener('pointerleave', onLeave);

  // ------------------------------------------------------------ one physics step: the three rules + walls + predator
  const tmp = [0, 0];
  function steer(dx, dy, vxi, vyi) {                               // Reynolds: steering = desired velocity - velocity, capped
    const m = Math.sqrt(dx * dx + dy * dy); if (m < 1e-9) { tmp[0] = tmp[1] = 0; return; }
    let fx = dx / m * P.vc - vxi, fy = dy / m * P.vc - vyi; const f = Math.sqrt(fx * fx + fy * fy);
    if (f > P.Fm) { fx *= P.Fm / f; fy *= P.Fm / f; } tmp[0] = fx; tmp[1] = fy;
  }
  function step(dt) {
    if (!(dt > 0)) return;
    const W = cv.w, H = cv.h;
    hash();
    const rs2 = P.rs * P.rs, ra2 = P.ra * P.ra, rc2 = P.rc * P.rc, m = P.margin, sq = Math.sqrt(dt);
    const predOn = pred.on && (!pred.touch || T < pred.until);
    for (let i = 0; i < N; i++) {
      const xi = x[i], yi = y[i], vxi = vx[i], vyi = vy[i], c = cellOf[i], gy = (c / gw) | 0, gx = c - gy * gw;
      let sx = 0, sy = 0, ns = 0, ax = 0, ay = 0, na = 0, cx = 0, cy = 0, nc = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const yy = gy + oy; if (yy < 0 || yy >= gh) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const xx = gx + ox; if (xx < 0 || xx >= gw) continue;
          for (let j = head[yy * gw + xx]; j >= 0; j = next[j]) {
            if (j === i) continue;
            const dx = x[j] - xi, dy = y[j] - yi, d2 = dx * dx + dy * dy; if (d2 >= rc2) continue;
            if (d2 < rs2) { const d = Math.sqrt(d2) + .5; sx -= dx / (d * d); sy -= dy / (d * d); ns++; }
            if (d2 < ra2) { const sp = Math.sqrt(vx[j] * vx[j] + vy[j] * vy[j]) + 1e-6; ax += vx[j] / sp; ay += vy[j] / sp; na++; }
            cx += dx; cy += dy; nc++;
          }
        }
      }
      let fx = 0, fy = 0;
      if (rule.sep && ns) { steer(sx, sy, vxi, vyi); fx += K.ws * tmp[0]; fy += K.ws * tmp[1]; }
      if (rule.ali && na) { steer(ax, ay, vxi, vyi); fx += K.wa * tmp[0]; fy += K.wa * tmp[1]; }
      if (rule.coh && nc) {                                         // seek the local centre, gently when already close to it
        cx /= nc; cy /= nc; steer(cx, cy, vxi, vyi); const k = K.wc * Math.min(1, Math.sqrt(cx * cx + cy * cy) / (P.rc * .35)); fx += k * tmp[0]; fy += k * tmp[1];
      }
      // a little individual restlessness (each fish's own slowly turning whim)
      wa[i] += gauss() * K.wander * sq; fx += Math.cos(wa[i]) * K.ww * P.Fm; fy += Math.sin(wa[i]) * K.ww * P.Fm;
      // soft walls
      let wx = 0, wy = 0;
      if (xi < m) wx += ((m - xi) / m) ** 2; else if (xi > W - m) wx -= ((xi - W + m) / m) ** 2;
      if (yi < m) wy += ((m - yi) / m) ** 2; else if (yi > H - m) wy -= ((yi - H + m) / m) ** 2;
      fx += wx * K.wwall * P.Fm; fy += wy * K.wwall * P.Fm;
      // the predator: flee, panic
      if (predOn) {
        const dx = xi - pred.x, dy = yi - pred.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < P.rp) { const k = 1 - d / P.rp, f = K.wf * P.Fm * (.45 + k) / (d + 1e-6); fx += dx * f; fy += dy * f; const s = .55 + .45 * k; if (s > st[i]) st[i] = s; }
      }
      // integrate: limited turn rate, speed relaxes to cruise (faster when panicked)
      const nx = vxi + fx * dt, ny = vyi + fy * dt;
      const h0 = Math.atan2(vyi, vxi); let dh = Math.atan2(ny, nx) - h0; dh -= Math.round(dh / TAU) * TAU;
      const mt = (K.turn + st[i] * K.turnP) * dt; if (dh > mt) dh = mt; else if (dh < -mt) dh = -mt;
      let sp = Math.sqrt(nx * nx + ny * ny); const vt = P.vc + st[i] * P.vpanic;
      sp += (vt - sp) * Math.min(1, dt * 2.2); sp = Math.max(P.vmin, Math.min(P.vmax + st[i] * P.vpanic, sp));
      const h = h0 + dh; nvx[i] = Math.cos(h) * sp; nvy[i] = Math.sin(h) * sp;
    }
    for (let i = 0; i < N; i++) {
      const a = nvx[i], b = nvy[i]; vx[i] = a; vy[i] = b; x[i] += a * dt; y[i] += b * dt;
      if (x[i] < 4) { x[i] = 4; vx[i] = Math.abs(a); } else if (x[i] > W - 4) { x[i] = W - 4; vx[i] = -Math.abs(a); }
      if (y[i] < 4) { y[i] = 4; vy[i] = Math.abs(b); } else if (y[i] > H - 4) { y[i] = H - 4; vy[i] = -Math.abs(b); }
      if (!(x[i] === x[i]) || !(y[i] === y[i]) || !(vx[i] === vx[i]) || !(vy[i] === vy[i])) { x[i] = W * (.3 + .4 * rnd()); y[i] = H * (.3 + .4 * rnd()); vx[i] = P.vc; vy[i] = 0; wa[i] = 0; }   // never NaN
      st[i] = Math.max(0, st[i] - dt / 1.6);
      ph[i] += dt * (9 + Math.sqrt(a * a + b * b) * .1 / SC);
    }
    T += dt;
  }

  // ------------------------------------------------------------ measurements: order Φ and groups (union-find within the cohesion radius)
  const par = new Int32Array(N);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  function countGroups() {
    hash();
    for (let i = 0; i < N; i++) par[i] = i;
    const rc2 = P.rc * P.rc;
    for (let i = 0; i < N; i++) {
      const c = cellOf[i], gy = (c / gw) | 0, gx = c - gy * gw;
      for (let oy = 0; oy <= 1; oy++) {
        const yy = gy + oy; if (yy >= gh) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (oy === 0 && ox < 0) continue;
          const xx = gx + ox; if (xx < 0 || xx >= gw) continue;
          for (let j = head[yy * gw + xx]; j >= 0; j = next[j]) {
            if (oy === 0 && ox === 0 && j <= i) continue;
            const dx = x[j] - x[i], dy = y[j] - y[i]; if (dx * dx + dy * dy >= rc2) continue;
            const a = find(i), b = find(j); if (a !== b) par[a] = b;
          }
        }
      }
    }
    let g = 0; for (let i = 0; i < N; i++) if (find(i) === i) g++;
    return g;
  }
  function order() {
    let px = 0, py = 0;
    for (let i = 0; i < N; i++) { const s = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]) + 1e-9; px += vx[i] / s; py += vy[i] / s; }
    return Math.sqrt(px * px + py * py) / N;
  }
  function pickFocus() {                                           // the fish nearest the school's centre
    let mx = 0, my = 0; for (let i = 0; i < N; i++) { mx += x[i]; my += y[i]; } mx /= N; my /= N;
    let b = 0, bd = 1e18; for (let i = 0; i < N; i++) { const d = (x[i] - mx) ** 2 + (y[i] - my) ** 2; if (d < bd) { bd = d; b = i; } }
    focus = b;
  }

  // ------------------------------------------------------------ controls and readouts
  const caption = () => {
    const off = [!rule.sep && 'sep', !rule.ali && 'ali', !rule.coh && 'coh'].filter(Boolean);
    if (!off.length) return 'Three local rules, no leader';
    if (off.length === 3) return 'No rules: every fish for itself';
    if (off.length > 1) return 'Two rules off: no school left';
    return { sep: 'Separation off: they crush into tight clumps', ali: 'Alignment off: a buzzing swarm, no common heading', coh: 'Cohesion off: the school drifts apart' }[off[0]];
  };
  const opts = [{ v: 1, label: 'On' }, { v: 0, label: 'Off' }];
  kit.toggle(controls, { label: 'Separation', options: opts, value: 1, onChange: (v) => { rule.sep = v; } });
  kit.toggle(controls, { label: 'Alignment', options: opts, value: 1, onChange: (v) => { rule.ali = v; } });
  kit.toggle(controls, { label: 'Cohesion', options: opts, value: 1, onChange: (v) => { rule.coh = v; } });
  const rPhi = kit.readout(readouts, { label: 'Order Φ', tone: 'teal' });
  const rGroups = kit.readout(readouts, { label: 'Groups', tone: 'ink' });
  const rLead = kit.readout(readouts, { label: 'Leaders', tone: 'heat' });
  rLead.set('0');
  for (const r of [rPhi, rGroups, rLead]) r.el.style.minWidth = '84px';   // three short numbers: keep the dock on one row

  // ------------------------------------------------------------ drawing
  const FISH = ['rgba(220,228,238,.7)', '#E2D9D6', '#EED5C1', C.apricot];   // mist -> apricot as a startle fades
  const paths = [null, null, null, null];
  let labelW = { s: 0, a: 0, c: 0 }, hintA = 1;
  function layoutText() {
    ctx.font = `400 ${11.5}px ${F.sans}`;
    labelW = { s: ctx.measureText('too close').width, a: ctx.measureText('match heading').width, c: ctx.measureText('stay with the group').width };
  }
  layoutText();
  function fishPath(p, i, s) {
    const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]) + 1e-9, ux = vx[i] / sp, uy = vy[i] / sp, nx = -uy, ny = ux, X = x[i], Y = y[i];
    const L = (a, b) => X + ux * a * s + nx * b * s, M = (a, b) => Y + uy * a * s + ny * b * s;
    // teardrop body
    p.moveTo(L(3.2, 0), M(3.2, 0));
    p.quadraticCurveTo(L(2.8, 1.75), M(2.8, 1.75), L(.6, 1.65), M(.6, 1.65));
    p.quadraticCurveTo(L(-1.4, 1.4), M(-1.4, 1.4), L(-2.8, 0), M(-2.8, 0));
    p.quadraticCurveTo(L(-1.4, -1.4), M(-1.4, -1.4), L(.6, -1.65), M(.6, -1.65));
    p.quadraticCurveTo(L(2.8, -1.75), M(2.8, -1.75), L(3.2, 0), M(3.2, 0));
    // tail, wiggling with speed
    const w = Math.sin(ph[i]) * (.55 + .5 * Math.min(1.6, sp / P.vc)) * 1.15;
    p.moveTo(L(-2.2, 0), M(-2.2, 0)); p.lineTo(L(-5.6, w + 1.55), M(-5.6, w + 1.55)); p.lineTo(L(-4.7, w), M(-4.7, w)); p.lineTo(L(-5.6, w - 1.55), M(-5.6, w - 1.55)); p.closePath();
  }
  function haloText(s, X, Y, col, align = 'center', size = 11.5) {
    ctx.font = `400 ${size}px ${F.sans}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3.5; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(27,30,61,.85)'; ctx.strokeText(s, X, Y);
    ctx.fillStyle = col; ctx.fillText(s, X, Y);
  }
  function draw() {
    const W = cv.w, H = cv.h; cv.clear();
    // faint caustic-free water: just a soft floor gradient for depth
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(74,75,134,0)'); g.addColorStop(1, 'rgba(74,75,134,.10)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // focus fish rings (under the fish)
    const fx = x[focus], fy = y[focus];
    const rings = [[P.rc, 'rgba(143,140,196,', rule.coh], [P.ra, 'rgba(127,212,207,', rule.ali], [P.rs, 'rgba(239,177,180,', rule.sep]];
    for (const [r, col, on] of rings) {
      ctx.beginPath(); ctx.arc(fx, fy, r, 0, TAU);
      ctx.fillStyle = col + (on ? '.06)' : '.0)'); ctx.fill();
      ctx.setLineDash(on ? [] : [3, 4]); ctx.lineWidth = on ? 1.4 : 1; ctx.strokeStyle = col + (on ? '.75)' : '.35)'); ctx.stroke();
    }
    ctx.setLineDash([]);

    // the predator
    const predOn = pred.on && (!pred.touch || T < pred.until);
    if (predOn) {
      const fade = pred.touch ? Math.min(1, (pred.until - T) / .4) : 1;
      ctx.globalAlpha = fade;
      const rg = ctx.createRadialGradient(pred.x, pred.y, 0, pred.x, pred.y, P.rp);
      rg.addColorStop(0, 'rgba(246,210,177,.16)'); rg.addColorStop(1, 'rgba(246,210,177,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(pred.x, pred.y, P.rp, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(246,210,177,.22)'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]); ctx.beginPath(); ctx.arc(pred.x, pred.y, P.rp, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = C.apricot; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pred.x, pred.y, 11 * SC, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(246,210,177,.35)'; ctx.beginPath(); ctx.arc(pred.x, pred.y, 3, 0, TAU); ctx.fill();
      const ly = pred.y + 11 * SC + 14 > H - 18 ? pred.y - 11 * SC - 12 : pred.y + 11 * SC + 13;
      haloText('predator', Math.max(40, Math.min(W - 40, pred.x)), ly, C.apricot, 'center', 11);
      ctx.globalAlpha = 1;
    }

    // all fish, batched by startle level (one fill per colour)
    for (let b = 0; b < 4; b++) paths[b] = new Path2D();
    const s = SC * 1.25, glow = new Path2D(), gr = 5.5 * SC;
    for (let i = 0; i < N; i++) {
      if (i === focus) continue;
      const v = st[i], b = v < .04 ? 0 : v < .3 ? 1 : v < .6 ? 2 : 3;
      fishPath(paths[b], i, s);
      if (b >= 2) { glow.moveTo(x[i] + gr, y[i]); glow.arc(x[i], y[i], gr, 0, TAU); }
    }
    ctx.fillStyle = 'rgba(246,210,177,.2)'; ctx.fill(glow);
    for (let b = 0; b < 4; b++) { ctx.fillStyle = FISH[b]; ctx.fill(paths[b]); }
    // the focus fish, a little larger, in ink
    ctx.fillStyle = 'rgba(243,238,242,.14)'; ctx.beginPath(); ctx.arc(fx, fy, 8 * SC, 0, TAU); ctx.fill();
    const pf = new Path2D(); fishPath(pf, focus, s * 1.3); ctx.fillStyle = C.ink; ctx.fill(pf);

    // ring labels: above each ring (below it if that would leave the stage), kept inside the margins
    const lab = [['stay with the group', P.rc, '#B4B1E0', rule.coh, labelW.c], ['match heading', P.ra, C.teal, rule.ali, labelW.a], ['too close', P.rs, C.rose, rule.sep, labelW.s]];
    for (const [t, r, col, on, tw] of lab) {
      let ly = fy - r - 8; if (ly < 24) ly = fy + r + 9;
      if (ly > H - 22) ly = H - 22;
      const lx = Math.max(20 + tw / 2, Math.min(W - 20 - tw / 2, fx));
      haloText(on ? t : t + ' (off)', lx, ly, on ? col : 'rgba(243,238,242,.45)');
    }

    // what the school is doing right now, and (until first used) how to be the predator
    haloText(caption(), 22, 28, C.muted, 'left', 12.5);
    hintA = touched ? Math.max(0, hintA - .02) : 1;
    if (hintA > 0) {
      ctx.globalAlpha = hintA;
      ctx.strokeStyle = C.apricot; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(28, H - 26, 5.5, 0, TAU); ctx.stroke();
      haloText(coarse ? 'Tap near the school: you are the predator' : 'Your cursor is a predator: sweep it through the school', 41, H - 26, 'rgba(246,210,177,.85)', 'left', 12);
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------ loop
  let phiS = order(), gT = 0, groups = 1;
  for (let i = 0; i < 120; i++) step(1 / 60);
  pickFocus(); groups = countGroups();
  const loop = kit.loop((dt) => {
    dt = Math.max(0, Math.min(.05, dt || 0));                     // the first rAF timestamp can precede start(): never step backwards
    const n = Math.max(1, Math.ceil(dt / .026));
    for (let k = 0; k < n; k++) step(dt / n);
    phiS += (order() - phiS) * Math.min(1, dt * 6);
    gT += dt; if (gT >= .25) { gT = 0; groups = countGroups(); }
    if (loop.running) {
      draw();
      rPhi.set(phiS.toFixed(2)); rGroups.set(String(groups));
    }
  });
  draw(); rPhi.set(phiS.toFixed(2)); rGroups.set(String(groups));
  return {
    start() { loop.start(); },
    stop() { loop.stop(); },
    destroy() {
      loop.stop();
      cv.cv.removeEventListener('pointermove', onMove); cv.cv.removeEventListener('pointerdown', onDown); cv.cv.removeEventListener('pointerleave', onLeave);
      cv.destroy();
    },
  };
}

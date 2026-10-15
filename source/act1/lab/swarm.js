/* LIMINAL swarm.js (module): a school of tiny X-frame drones on Canvas 2D. Act 1 gate: the loader assembles the name.
   Additions over kit/swarm.js: opt.textBox (where the word forms), opt.font, setRecruit(p) (only that fraction of the
   school joins the formation: loading progress), knock(x, y) (a ripple the school flinches from), burst() (scatter on enter).
   Modes
     'scatter'  intro: a milling fish school. The cursor (or finger) is a predator: drones it touches flash
                mint and scatter; when the cursor rests or leaves, the school re-forms into a shape (opt.reform).
     'join'     Act III: a pure Vicsek model (constant speed, wrap-around edges, heading = neighbours' mean
                heading + noise eta*U(-1/2,1/2), eta in [0, 2pi]). The cursor is one more agent that
                neighbours align with. Sliding eta shows the real order/disorder phase transition (phi).
   API: setMode(m) · setEta(e) · setCount(n) · formation(kind, holdMs, args) · release()
        removeNearest(x, y, r) · setTheme({bg, ink, accent, colorBy:'heading'|'', hueStart, hueSpan}) · pause() · resume() · destroy() · state.phi
   Formation kinds: 'text' | 'grid' | 'ring' | 'drone' | 'map' (args.holes = number of pockets)       */
export function LiminalSwarm(canvas, opt) {
    opt = Object.assign({
      n: 1400, mode: 'scatter', text: 'LIMINAL', ink: [244, 244, 242], accent: [94, 242, 181],
      bg: '0,0,0', trail: 0.26, dpr: 1.5, eta: 0.22, vicsekEta: 1.2, onTick: null, autoForm: 0,
      reform: 'text', reformDelay: 1200, inputEl: null
    }, opt || {});
    var ctx = canvas.getContext('2d');
    var HUES = [];
    function buildHues() { HUES = []; var st = opt.hueSat || 85, li = opt.hueLight || 64; for (var k = 0; k < 16; k++) HUES.push('hsla(' + Math.round((opt.hueStart || 0) + k * (opt.hueSpan || 360) / 16) + ',' + st + '%,' + li + '%,0.9)'); }
    buildHues();
    var W = 1, H = 1, scale = 1, N = 0;
    var px, py, vx, vy, tx, ty, heat, rank, recruit = 1, knocks = [];
    var S = { mode: opt.mode, form: null, formUntil: 0, formArgs: {}, running: true, phi: 0, t: 0, eta: opt.eta, vEta: opt.vicsekEta };
    var M = { x: -1e5, y: -1e5, vx: 0, vy: 0, hx: 0, hy: -1, inside: false, lastMove: 0, lastScatter: 0 };
    var bursts = [];
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    function resize() {
      var r = canvas.getBoundingClientRect();
      var d = Math.min(window.devicePixelRatio || 1, opt.dpr);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * d); canvas.height = Math.round(H * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      scale = Math.max(0.55, Math.min(1.25, Math.min(W, H) / 760));
      ctx.fillStyle = 'rgb(' + opt.bg + ')'; ctx.fillRect(0, 0, W, H);
      if (S.form && N) buildTargets(S.form, S.formArgs);
    }
    function alloc(n) {
      N = n; px = new Float32Array(n); py = new Float32Array(n); vx = new Float32Array(n); vy = new Float32Array(n);
      tx = new Float32Array(n); ty = new Float32Array(n); heat = new Float32Array(n); rank = new Float32Array(n); for (var q2 = 0; q2 < n; q2++) rank[q2] = Math.random();
      var cx = W * 0.5, cy = H * 0.5, a0 = Math.random() * 6.283;
      for (var i = 0; i < n; i++) {
        var r = Math.sqrt(Math.random()) * Math.min(W, H) * 0.32, a = Math.random() * 6.283;
        px[i] = cx + Math.cos(a) * r * 1.4; py[i] = cy + Math.sin(a) * r;
        var h = a0 + (Math.random() - 0.5) * 0.8; vx[i] = Math.cos(h); vy[i] = Math.sin(h);
      }
      if (S.form) buildTargets(S.form, S.formArgs);
    }

    // ---------- formations ----------
    function shapePoints(kind, args) {
      var pts = [], k, q;
      if (kind === 'text') {
        var oc = document.createElement('canvas'), w = Math.round(W), h = Math.round(H);
        oc.width = w; oc.height = h; var o = oc.getContext('2d');
        var tb = opt.textBox || { cx: .5, cy: .5, w: .9, h: .34 };
        var fs = Math.min(w * tb.w / (opt.text.length * 0.6), h * tb.h);
        o.font = (opt.font || '600 {fs}px Geist, "Helvetica Neue", Arial, sans-serif').replace('{fs}', fs);
        o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillStyle = '#fff';
        o.fillText(opt.text, w * tb.cx, h * tb.cy);
        var data = o.getImageData(0, 0, w, h).data, cand = [];
        for (var y = 0; y < h; y += 2) for (var x = 0; x < w; x += 2) if (data[(y * w + x) * 4 + 3] > 128) cand.push(x, y);
        var m = cand.length / 2;
        if (m < 1) return shapePoints('grid', args);           // nothing drawn (tiny/hidden canvas): fall back
        var stride = Math.max(1, m / N);
        for (k = 0; k < N; k++) { var j = Math.floor(k * stride) % m; pts.push([cand[j * 2] + Math.random(), cand[j * 2 + 1] + Math.random()]); }
      } else if (kind === 'grid' || kind === 'map') {
        var holes = [];
        if (kind === 'map') {
          var all = [[0.27, 0.38, 0.11], [0.62, 0.66, 0.08], [0.78, 0.30, 0.06], [0.45, 0.22, 0.05], [0.18, 0.72, 0.07]];
          holes = all.slice(0, Math.max(0, Math.min(5, args && args.holes != null ? args.holes : 3)));
        }
        var cols = Math.ceil(Math.sqrt(N * W / H) * 1.15), rows = Math.ceil(N * 1.25 / cols);
        var gx = W * 0.84 / cols, gy = H * 0.76 / rows, cells = [];
        for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
          var X = W * 0.08 + (c + 0.5) * gx, Y = H * 0.12 + (r + 0.5) * gy, inHole = false;
          for (q = 0; q < holes.length; q++) { var hx = holes[q][0] * W, hy = holes[q][1] * H, hr = holes[q][2] * Math.min(W, H) * 1.6; if ((X - hx) * (X - hx) + (Y - hy) * (Y - hy) < hr * hr) inHole = true; }
          if (!inHole) cells.push([X, Y]);
        }
        var st = cells.length / N;
        for (k = 0; k < N; k++) pts.push(cells[Math.floor(k * st) % cells.length]);
      } else if (kind === 'drone') {                          // top view: 4 rotor rings, 4 arms, body
        var s = Math.min(W / 640, H / 420) * 0.9, cx = W / 2, cy = H / 2, rot = [[-147, -83], [147, -83], [-147, 83], [147, 83]];
        for (k = 0; k < N; k++) {
          var u = k / N, R = rot[k % 4], t = Math.random() * 6.283;
          if (u < 0.5) pts.push([cx + (R[0] + Math.cos(t) * 92) * s, cy + (R[1] + Math.sin(t) * 52) * s]);
          else if (u < 0.75) { var f = Math.random(); pts.push([cx + R[0] * f * s, cy + R[1] * f * s]); }
          else { var a1 = Math.random() - 0.5, b1 = Math.random() - 0.5; pts.push([cx + (a1 + b1) * 108 * s, cy + (b1 - a1) * 61 * s]); }
        }
      } else {                                                // rings
        var R0 = Math.min(W, H) * 0.08, rings = 6, per = Math.ceil(N / rings);
        for (var z = 0; z < N; z++) {
          var ri = Math.floor(z / per), an = (z % per) / per * 6.283 + ri * 0.4, rr = R0 + ri * Math.min(W, H) * 0.055;
          pts.push([W / 2 + Math.cos(an) * rr * 1.25, H / 2 + Math.sin(an) * rr]);
        }
      }
      return pts;
    }
    function buildTargets(kind, args) {
      var pts = shapePoints(kind, args);
      var idx = []; for (var i = 0; i < N; i++) idx.push(i);
      idx.sort(function (a, b) { return px[a] - px[b]; });      // sort both along x: a sweeping, uncrossed fly-in
      pts.sort(function (a, b) { return a[0] - b[0]; });
      for (var s = 0; s < N; s++) { tx[idx[s]] = pts[s][0]; ty[idx[s]] = pts[s][1]; }
    }
    function formation(kind, holdMs, args) {
      if (W < 50 || H < 50 || !N) return;                      // hidden or collapsed canvas: skip
      S.form = kind || 'text'; S.formArgs = args || {}; buildTargets(S.form, S.formArgs);
      S.formUntil = performance.now() + (holdMs == null ? 3200 : holdMs);
    }
    function release() { S.form = null; }

    // ---------- spatial hash ----------
    var cellSize = 30, gw = 0, gh = 0, head, next;
    function cellX(x) { return Math.min(gw - 1, Math.max(0, Math.floor(x / cellSize) + 1)); }
    function cellY(y) { return Math.min(gh - 1, Math.max(0, Math.floor(y / cellSize) + 1)); }
    function hash() {
      cellSize = 30 * scale; gw = Math.ceil(W / cellSize) + 2; gh = Math.ceil(H / cellSize) + 2;
      if (!head || head.length < gw * gh) head = new Int32Array(gw * gh);
      if (!next || next.length < N) next = new Int32Array(N);
      head.fill(-1);
      for (var i = 0; i < N; i++) { var c = cellY(py[i]) * gw + cellX(px[i]); next[i] = head[c]; head[c] = i; }
    }

    // ---------- step ----------
    function step(dt) {
      S.t += dt;
      var now = performance.now();
      var forming = S.form && now < S.formUntil;
      if (S.form && !forming) S.form = null;
      var vicsek = S.mode === 'join' && !forming;
      var v0 = (reduce ? 0.7 : 1.55) * scale, R = 30 * scale, R2 = R * R, sep2 = (11 * scale) * (11 * scale);
      var ax = W * (0.5 + 0.30 * Math.sin(S.t * 0.11)), ay = H * (0.5 + 0.26 * Math.sin(S.t * 0.17 + 1.3));
      var mouseLive = M.inside && (now - M.lastMove < 1200);
      var pr = 120 * scale, pr2 = pr * pr, jr = 150 * scale, jr2 = jr * jr;
      hash();
      var sumx = 0, sumy = 0, scattered = false;
      for (var i = 0; i < N; i++) {
        var x = px[i], y = py[i];
        var cx = cellX(x), cy = cellY(y);
        var alx = vicsek ? vx[i] : 0, aly = vicsek ? vy[i] : 0, cox = 0, coy = 0, sx = 0, sy = 0, nc = 0;
        for (var oy = -1; oy <= 1; oy++) {
          var yy = cy + oy; if (yy < 0 || yy >= gh) continue;
          for (var ox = -1; ox <= 1; ox++) {
            var xx = cx + ox; if (xx < 0 || xx >= gw) continue;
            for (var j = head[yy * gw + xx]; j >= 0; j = next[j]) {
              if (j === i) continue;
              var dx = px[j] - x, dy = py[j] - y, d2 = dx * dx + dy * dy;
              if (d2 > R2) continue;
              alx += vx[j]; aly += vy[j]; cox += dx; coy += dy; nc++;
              if (d2 < sep2 && d2 > 0.01) { var inv = 1 / d2; sx -= dx * inv; sy -= dy * inv; }
            }
          }
        }
        var hx = vx[i], hy = vy[i], spd = v0, mdx = x - M.x, mdy = y - M.y, md2 = mdx * mdx + mdy * mdy;
        if (vicsek) {
          // pure Vicsek: mean heading of neighbours (incl. self) + the cursor as a heavy neighbour, then noise
          if (mouseLive && md2 < jr2) { var w = 8 * (1 - Math.sqrt(md2) / jr); alx += M.hx * w; aly += M.hy * w; heat[i] = Math.min(1, heat[i] + 0.06); }
          var th = Math.atan2(aly, alx) + S.vEta * (Math.random() - 0.5);
          hx = Math.cos(th); hy = Math.sin(th);
          vx[i] = hx; vy[i] = hy; sumx += hx; sumy += hy;
          var nx2 = x + hx * spd * dt * 60, ny2 = y + hy * spd * dt * 60;
          px[i] = (nx2 + W) % W; py[i] = (ny2 + H) % H;          // wrap-around edges
          heat[i] *= 0.975;
          continue;
        }
        var dxv = hx * 0.6 + alx * 0.9 / (nc || 1), dyv = hy * 0.6 + aly * 0.9 / (nc || 1);
        if (nc) { dxv += cox / nc * 0.010; dyv += coy / nc * 0.010; }
        dxv += sx * 9; dyv += sy * 9;
        var tax = ax - x, tay = ay - y, tl = Math.sqrt(tax * tax + tay * tay) + 1;  // wandering attractor + milling
        dxv += tax / tl * 0.05 - tay / tl * 0.03; dyv += tay / tl * 0.05 + tax / tl * 0.03;
        var m = 70 * scale;                                                          // soft walls
        if (x < m) dxv += 0.6 * (1 - x / m); if (x > W - m) dxv -= 0.6 * (1 - (W - x) / m);
        if (y < m) dyv += 0.6 * (1 - y / m); if (y > H - m) dyv -= 0.6 * (1 - (H - y) / m);
        var eta = S.eta;
        for (var kq = 0; kq < knocks.length; kq++) {
          var kn = knocks[kq], kr = (now - kn.t) * 0.42 * scale, kdx = x - kn.x, kdy = y - kn.y, kd = Math.sqrt(kdx * kdx + kdy * kdy) + 0.1, band = Math.abs(kd - kr);
          if (band < 16 * scale && kr < kn.r) { var kf = (1 - band / (16 * scale)) * (1 - kr / kn.r); dxv += kdx / kd * kf * 2.4; dyv += kdy / kd * kf * 2.4; heat[i] = Math.min(1, heat[i] + kf * 0.22); }
        }
        if (S.burstUntil > now) { var bdx = x - W * 0.5, bdy = y - H * 0.42, bd = Math.sqrt(bdx * bdx + bdy * bdy) + 0.1; dxv += bdx / bd * 4; dyv += bdy / bd * 4; spd = v0 * 3.2; eta = 0; }
        if (mouseLive && md2 < pr2) {                                                // predator
          var md = Math.sqrt(md2) + 0.1, f = (1 - md / pr);
          dxv += mdx / md * f * 6; dyv += mdy / md * f * 6;
          heat[i] = Math.min(1, heat[i] + f * 0.5); eta += f * 2.2; spd = v0 * (1 + 1.6 * f); scattered = true;
        }
        if (forming && rank[i] <= recruit) {
          var fx = tx[i] - x, fy = ty[i] - y, fd = Math.sqrt(fx * fx + fy * fy) + 0.001;
          var k = Math.min(1, fd / (60 * scale));
          dxv = dxv * 0.15 + fx / fd * 3; dyv = dyv * 0.15 + fy / fd * 3;
          spd = Math.max(0.08, Math.min(v0 * 3.2, fd * 0.09)); eta *= 0.2 * k;
        }
        var ang = Math.atan2(dyv, dxv) + eta * (Math.random() - 0.5) * 3.1416 * 0.5;
        var nx = Math.cos(ang), ny = Math.sin(ang), blend = forming ? 0.22 : 0.12;
        hx += (nx - hx) * blend; hy += (ny - hy) * blend;
        var hl = Math.sqrt(hx * hx + hy * hy) || 1; hx /= hl; hy /= hl;
        vx[i] = hx; vy[i] = hy; sumx += hx; sumy += hy;
        px[i] = x + hx * spd * dt * 60; py[i] = y + hy * spd * dt * 60;
        if (!(px[i] === px[i])) { px[i] = W / 2; py[i] = H / 2; }                    // NaN guard
        heat[i] *= 0.975;
      }
      S.phi = N ? Math.sqrt(sumx * sumx + sumy * sumy) / N : 0;
      if (scattered) M.lastScatter = now;
      // re-form after a scatter, once the cursor rests or leaves
      if (S.mode === 'scatter' && opt.reform && !S.form && M.lastScatter && now - M.lastScatter > opt.reformDelay && now - M.lastScatter < opt.reformDelay + 600) {
        M.lastScatter = 0; formation(opt.reform, opt.reformHold || 2600); autoT = 0;
      }
    }

    // ---------- draw ----------
    function draw() {
      ctx.fillStyle = 'rgba(' + opt.bg + ',' + (reduce ? 1 : opt.trail) + ')';
      ctx.fillRect(0, 0, W, H);
      var s = 3.3 * scale, ink = opt.ink, ac = opt.accent;
      var byHead = opt.colorBy === 'heading', NB = byHead ? HUES.length : 1;
      var paths = []; for (var q0 = 0; q0 <= NB; q0++) paths.push(new Path2D());
      for (var i = 0; i < N; i++) {
        var p = heat[i] > 0.18 ? paths[NB] : byHead ? paths[((Math.floor((Math.atan2(vy[i], vx[i]) + 3.14159) / 6.28319 * NB) % NB) + NB) % NB] : paths[0];
        var hx = vx[i] * s, hy = vy[i] * s;           // X-frame: arms at +-45 deg to heading
        var ax = (hx - hy) * 0.7071, ay = (hy + hx) * 0.7071, bx = (hx + hy) * 0.7071, by = (hy - hx) * 0.7071;
        var x = px[i], y = py[i];
        p.moveTo(x - ax, y - ay); p.lineTo(x + ax, y + ay);
        p.moveTo(x - bx, y - by); p.lineTo(x + bx, y + by);
      }
      ctx.lineWidth = Math.max(0.8, 1.0 * scale); ctx.lineCap = 'round';
      if (byHead) for (var q1 = 0; q1 < NB; q1++) { ctx.strokeStyle = HUES[q1]; ctx.stroke(paths[q1]); }
      else { ctx.strokeStyle = 'rgba(' + ink.join(',') + ',0.82)'; ctx.stroke(paths[0]); }
      ctx.strokeStyle = 'rgba(' + ac.join(',') + ',0.95)'; ctx.stroke(paths[NB]);
      var now = performance.now();
      knocks = knocks.filter(function (k) { return (now - k.t) * 0.42 * scale < k.r; });
      for (var kq = 0; kq < knocks.length; kq++) {
        var kn = knocks[kq], kr = (now - kn.t) * 0.42 * scale, ka = 1 - kr / kn.r;
        ctx.strokeStyle = 'rgba(' + ac.join(',') + ',' + (0.32 * ka * ka).toFixed(3) + ')'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(kn.x, kn.y, kr, 0, 6.283); ctx.stroke();
      }
      bursts = bursts.filter(function (b) { return now - b.t < 600; });
      bursts.forEach(function (b) {                   // a removed drone pops into points
        var e = (now - b.t) / 600; ctx.fillStyle = 'rgba(' + ac.join(',') + ',' + (1 - e) + ')';
        for (var q = 0; q < 14; q++) { var a = q / 14 * 6.283; ctx.fillRect(b.x + Math.cos(a) * e * 26 - 1, b.y + Math.sin(a) * e * 26 - 1, 2, 2); }
      });
      if (S.mode === 'join' && M.inside) {          // your agent: a larger mint X and its influence radius
        var k = 7 * scale, hx2 = M.hx * k, hy2 = M.hy * k;
        var a1 = (hx2 - hy2) * 0.7071, b1 = (hy2 + hx2) * 0.7071, a2 = (hx2 + hy2) * 0.7071, b2 = (hy2 - hx2) * 0.7071;
        ctx.strokeStyle = 'rgb(' + ac.join(',') + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(M.x - a1, M.y - b1); ctx.lineTo(M.x + a1, M.y + b1);
        ctx.moveTo(M.x - a2, M.y - b2); ctx.lineTo(M.x + a2, M.y + b2); ctx.stroke();
        ctx.beginPath(); ctx.arc(M.x, M.y, 150 * scale, 0, 6.283); ctx.strokeStyle = 'rgba(' + ac.join(',') + ',0.18)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }

    function removeNearest(x, y, r) {
      r = r || 24; var best = -1, bd = r * r;
      for (var i = 0; i < N; i++) { var dx = px[i] - x, dy = py[i] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
      if (best < 0) return false;
      bursts.push({ x: px[best], y: py[best], t: performance.now() });
      var L = N - 1;                                  // swap-remove: nobody else moves
      px[best] = px[L]; py[best] = py[L]; vx[best] = vx[L]; vy[best] = vy[L]; tx[best] = tx[L]; ty[best] = ty[L]; heat[best] = heat[L];
      N = L; return true;
    }

    // ---------- loop + input ----------
    var last = 0, raf = 0, visible = true, autoT = 0;
    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (!S.running || !visible) { last = t; return; }
      var dt = Math.max(0.001, Math.min(0.05, (t - last) / 1000 || 0.016)); last = t;
      if (opt.autoForm && !S.form && S.mode === 'scatter') { autoT += dt; if (autoT > opt.autoForm) { autoT = 0; formation('text', 3000); } }
      step(dt); draw();
      if (opt.onTick) opt.onTick(S);
    }
    function setPos(cx, cy) {
      var r = canvas.getBoundingClientRect(), x = cx - r.left, y = cy - r.top, now = performance.now(), dtm = Math.max(1, now - M.lastMove);
      var nvx = (x - M.x) / dtm, nvy = (y - M.y) / dtm;
      if (M.inside && Math.abs(nvx) + Math.abs(nvy) < 5) {
        M.vx = M.vx * 0.8 + nvx * 0.2; M.vy = M.vy * 0.8 + nvy * 0.2;
        var l = Math.sqrt(M.vx * M.vx + M.vy * M.vy);
        if (l > 0.02) { M.hx = M.vx / l; M.hy = M.vy / l; }
      }
      M.x = x; M.y = y; M.inside = x >= 0 && y >= 0 && x <= W && y <= H; M.lastMove = now;
    }
    var host = opt.inputEl || canvas;
    var onMove = function (e) { setPos(e.clientX, e.clientY); };
    var onTouch = function (e) { if (e.touches && e.touches[0]) setPos(e.touches[0].clientX, e.touches[0].clientY); };
    var onLeave = function () { M.inside = false; };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerdown', onMove);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('touchmove', onTouch, { passive: true });   // keeps firing while the page scrolls
    host.addEventListener('touchend', onLeave, { passive: true });
    var ro = new ResizeObserver(resize); ro.observe(canvas);
    var io = null;
    if ('IntersectionObserver' in window) { io = new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }); io.observe(canvas); }
    resize(); alloc(opt.n); raf = requestAnimationFrame(frame);

    return {
      state: S,
      setMode: function (m) { S.mode = m; release(); },
      setEta: function (e) { if (S.mode === 'join') S.vEta = e; else S.eta = e; },
      setCount: function (n) { alloc(n); },
      formation: formation, release: release, removeNearest: removeNearest,
      setReform: function (k) { opt.reform = k; },
      setRecruit: function (p) { recruit = Math.max(0, Math.min(1, p)); },
      knock: function (x, y, r) { knocks.push({ x: x, y: y, t: performance.now(), r: r || Math.max(W, H) * 0.7 }); },
      burst: function (ms) { S.form = null; S.burstUntil = performance.now() + (ms || 900); },
      size: function () { return { w: W, h: H }; },
      setTheme: function (t) { Object.assign(opt, t || {}); buildHues(); ctx.fillStyle = 'rgb(' + opt.bg + ')'; ctx.fillRect(0, 0, W, H); if (canvas.parentElement) canvas.style.background = 'rgb(' + opt.bg + ')'; },
      count: function () { return N; },
      pause: function () { S.running = false; }, resume: function () { S.running = true; },
      destroy: function () {
        cancelAnimationFrame(raf); ro.disconnect(); if (io) io.disconnect();
        host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerdown', onMove); host.removeEventListener('pointerleave', onLeave);
        host.removeEventListener('touchmove', onTouch); host.removeEventListener('touchend', onLeave);
      }
    };
  }


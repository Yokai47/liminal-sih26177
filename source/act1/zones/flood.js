// A flooded plain (Kerala, August 2018). Top-down, outdoor mode: a 2.5-D grid of 5 m cells inside a search polygon,
// thermal camera first, GPS on, and boats steered by the swarm.
// Art: floodwater over farmland and a small town, depth-shaded, with drifting caustic ripples and current streaks along
// the drowned river; submerged roads, paddy bunds and streets show through as pale lines; roofs, palm crowns and a few
// big buildings stand out of the water; a relief camp sits on a dry mound. The swarm spreads from the camp as a wide
// front (each drone takes the best unsearched 60 m block that touches searched water and that no neighbour on its mesh
// has claimed), checks every roof with the thermal camera, and flags people (heat, waving), live power lines down in the
// water and the strong current. Every rescue boat follows the gradient of a distance field the swarm computes over the
// water it has searched (live lines are no-go, current is expensive, unsearched water is unknown and never used), with a
// drone hovering over the roof as a beacon. The mission ends when no unsearched patch is left (β₀ = 0) and every person
// found is in a boat.
export default function mount({ stage, controls, readouts, kit }) {
  const B0S = kit.stableCount();   // calm display of the β₀ counter
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx, el = cv.cv;
  el.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ------------------------------------------------------------ world and swarm constants (metres, sim seconds)
  const WM = 2600, HM = 2200, CELL = 5, GW = WM / CELL, GH = HM / CELL, NC = GW * GH;
  const BS = 12, BW = Math.ceil(GW / BS), BH = Math.ceil(GH / BS), NB = BW * BH;       // 60 m planning blocks
  const R_FINE = 45, TL = 16, V_FINE = 12, V_BOAT = 9, RADIO = 760, DONE = .06, LEVEL = 6.2;
  const NDR = 24, NBOAT = 8, CAP = 12;
  const NAV = 20, NVW = WM / NAV, NVH = HM / NAV, NNV = NVW * NVH;                       // boat navigation grid

  // ------------------------------------------------------------ noise and sprites
  function noise2(sd) {
    const r = kit.rng(sd), P = new Uint8Array(512), V = new Float32Array(256);
    for (let i = 0; i < 256; i++) { P[i] = i; V[i] = r(); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = P[i]; P[i] = P[j]; P[j] = t; }
    for (let i = 0; i < 256; i++) P[i + 256] = P[i];
    const n = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
      const a = V[P[P[X] + Y]], b = V[P[P[X + 1] + Y]], c = V[P[P[X] + Y + 1]], d = V[P[P[X + 1] + Y + 1]];
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    n.fbm = (x, y, o) => { let s = 0, a = .5, t = 0; for (let k = 0; k < o; k++) { s += a * n(x, y); t += a; const nx = 1.6 * x - 1.2 * y + 5.3, ny = 1.2 * x + 1.6 * y + 1.7; x = nx; y = ny; a *= .5; } return s / t; };
    return n;
  }
  // seamless tiles from periodic value noise: soft blobs (cloud shadow) or thin bright ridges (caustic ripples)
  function tile(sd, N, P0, rgb, shape) {
    const r = kit.rng(sd), V = new Float32Array(64 * 64); for (let i = 0; i < V.length; i++) V[i] = r();
    const pn = (x, y, P) => {
      const xi = Math.floor(x), yi = Math.floor(y), u0 = x - xi, v0 = y - yi, i0 = ((xi % P) + P) % P, j0 = ((yi % P) + P) % P, i1 = (i0 + 1) % P, j1 = (j0 + 1) % P;
      const a = V[j0 * 64 + i0], b = V[j0 * 64 + i1], c = V[j1 * 64 + i0], d = V[j1 * 64 + i1], u = u0 * u0 * (3 - 2 * u0), v = v0 * v0 * (3 - 2 * v0);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N), px = img.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0, a = .5, t = 0, P = P0;
      for (let k = 0; k < 4; k++) { s += a * pn(x / N * P, y / N * P, P); t += a; a *= .5; P *= 2; }
      const o = (y * N + x) * 4; px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255 * shape(s / t);
    }
    g.putImageData(img, 0, 0); return c;
  }
  function sprite(r, stops) {
    const c = document.createElement('canvas'); c.width = c.height = r * 2;
    const g = c.getContext('2d'), gr = g.createRadialGradient(r, r, 0, r, r, r);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2); return c;
  }
  const BRUSH = sprite(64, [[0, 'rgba(0,0,0,1)'], [.5, 'rgba(0,0,0,1)'], [.68, 'rgba(0,0,0,.72)'], [.82, 'rgba(0,0,0,.3)'], [1, 'rgba(0,0,0,0)']]);
  const GLOW_T = sprite(32, [[0, 'rgba(127,212,207,.6)'], [.35, 'rgba(127,212,207,.2)'], [1, 'rgba(127,212,207,0)']]);
  const GLOW_H = sprite(48, [[0, 'rgba(255,214,150,1)'], [.18, 'rgba(255,195,107,.75)'], [.5, 'rgba(255,195,107,.22)'], [1, 'rgba(255,195,107,0)']]);
  // ripples: a seamless tile of short, slightly bent strokes (an illustrator's water lines), two layers drift apart
  function rippleTile(sd, N, n, L0, L1, rgb) {
    const r = kit.rng(sd), c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'); g.lineCap = 'round';
    for (let k = 0; k < n; k++) {
      const x = r() * N, y = r() * N, L = L0 + r() * (L1 - L0), a = (r() - .5) * .3, bend = (r() - .5) * 3.2, al = .25 + r() * .55, ca = Math.cos(a) * L / 2, sa = Math.sin(a) * L / 2;
      g.strokeStyle = `rgba(${rgb},${al.toFixed(2)})`; g.lineWidth = .7 + r() * .7; g.beginPath();
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { const X0 = x + ox, Y0 = y + oy; if (X0 < -L || X0 > N + L || Y0 < -8 || Y0 > N + 8) continue; g.moveTo(X0 - ca, Y0 - sa); g.quadraticCurveTo(X0 - sa * .0, Y0 + bend, X0 + ca, Y0 + sa); }
      g.stroke();
    }
    return c;
  }
  const RIP = rippleTile(21, 256, 150, 5, 15, '214,230,242'), RIP2 = rippleTile(33, 256, 70, 10, 26, '200,222,240');
  const CLOUD = tile(5, 128, 4, [24, 24, 52], (v) => smooth(.5, .8, v));

  // ------------------------------------------------------------ the mission's world
  const XT0 = -800, XT1 = WM + 800, XST = 4, NX = Math.round((XT1 - XT0) / XST) + 1;
  const lookX = (T, x) => { let f = (x - XT0) / XST; if (f <= 0) return T[0]; if (f >= NX - 1) return T[NX - 1]; const i = f | 0; f -= i; return T[i] + (T[i + 1] - T[i]) * f; };
  const inPolyW = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  let Wd = null;
  // world, grids and art are generators: the next mission is built in small slices (a few ms per frame) during the
  // summary and a short black hold, so no frame ever blocks; at first mount and on resize they simply run to the end
  const runSync = (it) => { let r; do { r = it.next(); } while (!r.done); return r.value; };
  function* gen(sd) {
    const r = kit.rng(sd * 7919 + 29), tRY = new Float32Array(NX), tRS = new Float32Array(NX);   // every world owns its tables
    const nA = noise2(sd * 31 + 1), nB = noise2(sd * 57 + 2), nC = noise2(sd * 83 + 3), nD = noise2(sd * 101 + 4);
    const ry0 = HM * (.47 + (r() - .5) * .08), p1 = r() * TAU, p2 = r() * TAU, tilt = (r() - .5) * .22;
    for (let i = 0; i < NX; i++) { const x = XT0 + i * XST; tRY[i] = ry0 + 190 * Math.sin(x / 450 + p1) + 70 * Math.sin(x / 175 + p2) + tilt * (x - WM / 2); }
    for (let i = 0; i < NX; i++) tRS[i] = (tRY[Math.min(NX - 1, i + 1)] - tRY[Math.max(0, i - 1)]) / (2 * XST);
    const riverY = (x) => lookX(tRY, x);
    const rdist = (x, y) => { const sl = lookX(tRS, x); return (y - riverY(x)) / Math.sqrt(1 + sl * sl); };
    const shoreX = (y) => WM - 110 + 80 * (nC(y / 260, 2.2) - .5) * 2;
    // the relief camp: a school on a mound on the east side of the plain, one bank or the other
    const cside = r() < .5 ? -1 : 1, cxw = WM * (.72 + r() * .05), cyw = riverY(cxw) + cside * (330 + r() * 60);
    const ground = (x, y) => {
      let g = 3.3 + (nA.fbm(x / 760, y / 760, 4) - .5) * 4.4 + (nB.fbm(x / 170, y / 170, 3) - .5) * 1.1;
      const rd = Math.abs(rdist(x, y)); g -= 4.2 * Math.exp(-(rd * rd) / 3600);
      g += 1.0 * Math.exp(-((rd - 75) ** 2) / 900);                        // natural levees beside the channel
      const sx = shoreX(y); g += smooth(sx - 160, sx + 260, x) * 38;        // the hills to the east
      const dc = (x - cxw) ** 2 + (y - cyw) ** 2; g += 5 * Math.exp(-dc / 15000);
      return g;
    };
    const flow = (x, y, out) => {                                          // current, m/s, along the drowned river (east to west)
      const sl = lookX(tRS, x), n = Math.sqrt(1 + sl * sl), rd = rdist(x, y), sp = 2.7 * Math.exp(-(rd * rd) / 6400) + .3;
      out[0] = -sp / n; out[1] = -sp * sl / n;
    };
    // search polygon: jittered octagon, kept off the eastern hills
    let poly = [[50, 70], [WM * .5, 26], [WM - 80, 60], [WM - 50, HM * .5], [WM - 90, HM - 60], [WM * .5, HM - 26], [60, HM - 70], [26, HM * .5]]
      .map(([x, y]) => [clamp(x + (r() - .5) * 90, 8, WM - 8), clamp(y + (r() - .5) * 70, 8, HM - 8)]);
    poly = poly.map(([x, y]) => [Math.min(x, shoreX(y) - 120), y]);
    // roads: the bank road along the river, a road through the town crossing the river, the camp road west
    const rside = -cside, roads = [], towns = [];
    const tcx = WM * (.3 + r() * .1), tcy = riverY(tcx) + rside * (300 + r() * 60), tth = (r() - .5) * .5;
    towns.push([tcx, tcy, tth]);
    { const pts = []; for (let x = -300; x <= WM + 300; x += 20) pts.push([x, riverY(x) + rside * (165 + 25 * Math.sin(x / 300 + p2))]); roads.push({ pts, w: 7, main: true }); }
    { const pts = []; const dx = Math.sin(tth), dy = Math.cos(tth); for (let t = -1800; t <= 1800; t += 20) pts.push([tcx + dx * t + 30 * Math.sin(t / 400), tcy + dy * t]); roads.push({ pts, w: 7, main: true, cross: true }); }
    { const pts = []; for (let x = cxw; x >= -300; x -= 20) pts.push([x, riverY(x) + cside * (300 + 50 * Math.sin(x / 520 + p1)) + (cyw - riverY(cxw) - cside * (300 + 50 * Math.sin(cxw / 520 + p1))) * smooth(cxw - 600, cxw, x)]); roads.push({ pts, w: 6, main: true }); }
    // town streets: a small grid around the town centre
    const streets = [];
    for (let k = -2; k <= 2; k++) {
      const c0 = Math.cos(tth), s0 = Math.sin(tth), p1s = [], p2s = [];
      for (let t = -270; t <= 270; t += 18) {
        p1s.push([tcx + c0 * t + s0 * k * 95, tcy - s0 * t + c0 * k * 95]);
        p2s.push([tcx + c0 * k * 105 + s0 * t, tcy - s0 * k * 105 + c0 * t]);
      }
      streets.push({ pts: p1s, w: 5 }, { pts: p2s, w: 5 });
    }
    // houses: dense in the town, strung along the roads elsewhere (typical of Kerala), each with a few palms
    const houses = [], hgrid = new Map();
    const hkey = (x, y) => ((Math.floor(x / 40) + 1000) * 4096 + Math.floor(y / 40) + 1000);
    const spaced = (x, y, sp) => {
      const gx = Math.floor(x / 40), gy = Math.floor(y / 40);
      for (let j = gy - 1; j <= gy + 1; j++) for (let i = gx - 1; i <= gx + 1; i++) { const L = hgrid.get((i + 1000) * 4096 + j + 1000); if (L) for (const h of L) if ((h.x - x) ** 2 + (h.y - y) ** 2 < sp * sp) return false; }
      return true;
    };
    const addHouse = (x, y, a, big) => {
      const q = r(), h = big ? { x, y, a, l: big[0], w: big[1], col: 4, big: true } : { x, y, a, l: 10 + r() * 5, w: 8 + r() * 3, col: q < .5 ? 0 : q < .74 ? 1 : q < .93 ? 3 : 2, big: false };
      houses.push(h); const k = hkey(x, y); if (!hgrid.has(k)) hgrid.set(k, []); hgrid.get(k).push(h);
    };
    const okSite = (x, y) => x > -150 && x < WM + 150 && y > -150 && y < HM + 150 && Math.abs(rdist(x, y)) > 80 && ground(x, y) < LEVEL - .6 && (x - cxw) ** 2 + (y - cyw) ** 2 > 180 * 180;
    // the two big buildings people climbed onto: a church in the town, a school on the bank road
    const big = [];
    { const x = tcx + Math.cos(tth) * 60 - Math.sin(tth) * 48, y = tcy - Math.sin(tth) * 60 + Math.cos(tth) * 48; addHouse(x, y, -tth, [36, 16]); big.push(houses[houses.length - 1]); houses[houses.length - 1].kind = 'church'; }
    { const rd = roads[0].pts, p = rd[Math.floor(rd.length * (.55 + r() * .15))]; const x = p[0], y = p[1] + rside * 34; if (okSite(x, y)) { addHouse(x, y, 0, [44, 15]); big.push(houses[houses.length - 1]); houses[houses.length - 1].kind = 'school'; } }
    yield;
    for (const st of streets) {
      yield;
      for (let q = 1; q < st.pts.length; q++) {
        const [x0, y0] = st.pts[q - 1], [x1, y1] = st.pts[q], a = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(a), ny = Math.cos(a);
        for (const sg of [-1, 1]) {
          if (r() > .42) continue;
          const x = (x0 + x1) / 2 + nx * sg * (13 + r() * 6), y = (y0 + y1) / 2 + ny * sg * (13 + r() * 6);
          if (okSite(x, y) && spaced(x, y, 19)) addHouse(x, y, a + (r() - .5) * .15);
        }
      }
    }
    for (const rd of roads) {
      for (let q = 1; q < rd.pts.length; q++) {
        if ((q & 63) === 0) yield;
        const [x0, y0] = rd.pts[q - 1], [x1, y1] = rd.pts[q], a = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(a), ny = Math.cos(a);
        if (r() > .2) continue;
        const sg = r() < .5 ? -1 : 1, off = 16 + r() * 34, x = x0 + nx * sg * off, y = y0 + ny * sg * off;
        if (okSite(x, y) && spaced(x, y, 22)) addHouse(x, y, a + (r() < .3 ? Math.PI / 2 : 0) + (r() - .5) * .3);
      }
    }
    for (let t = 0; t < 900; t++) {                                       // a scatter of homesteads off the roads
      if ((t & 127) === 0) yield;
      const x = r() * WM, y = r() * HM;
      if (nC.fbm(x / 400, y / 400, 2) < .55 || !okSite(x, y) || !spaced(x, y, 90)) continue;
      addHouse(x, y, r() * Math.PI);
    }
    // palms around houses, along roads, and in groves; a few broadleaf trees
    const palms = [], trees = [];
    const palmOK = (x, y) => Math.abs(rdist(x, y)) > 64 && ground(x, y) < LEVEL + 3 && spaced(x, y, 9);
    for (let hi = 0; hi < houses.length; hi++) { const h = houses[hi]; if ((hi & 63) === 0) yield; if (h.big) continue; const n = 1 + ((r() * 4) | 0); for (let q = 0; q < n; q++) { const a = r() * TAU, d = 12 + r() * 16, x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a) * d; if (palmOK(x, y)) palms.push([x, y, r() * TAU, .85 + r() * .4]); } }
    for (const rd of roads) for (let q = 0; q < rd.pts.length; q++) if (r() < .32) { const [x, y] = rd.pts[q], sg = r() < .5 ? -1 : 1, x2 = x + (r() - .5) * 12, y2 = y + sg * (9 + r() * 6); if (palmOK(x2, y2)) palms.push([x2, y2, r() * TAU, .8 + r() * .4]); }
    yield;
    for (let y = -100; y < HM + 100; y += 15) for (let x = -100; x < WM + 100; x += 15) {
      if (x === -100 && ((y + 100) / 15 & 3) === 0) yield;
      const v = nD.fbm(x / 230 + 7, y / 230, 3); if (v < .63) continue;
      const jx = x + (r() - .5) * 12, jy = y + (r() - .5) * 12; if (r() < .55 && palmOK(jx, jy)) palms.push([jx, jy, r() * TAU, .8 + r() * .45]);
    }
    yield;
    for (let t = 0; t < 700; t++) { const h = houses[(r() * houses.length) | 0]; if (!h || h.big) continue; const x = h.x + (r() - .5) * 60, y = h.y + (r() - .5) * 60; if (palmOK(x, y)) trees.push([x, y, 6 + r() * 6]); }
    // paddy plots: a rotated grid of bunds in the low fields away from the town
    const fth = (r() - .5) * .4, fieldOK = (x, y) => nB.fbm(x / 520 + 3, y / 520, 3) > .54 && Math.abs(rdist(x, y)) > 110 && (x - tcx) ** 2 + (y - tcy) ** 2 > 420 * 420 && ground(x, y) < LEVEL - 2.4;
    // power lines beside the bank road and the camp road; three spans are down in the water (live)
    const lines = [], hazards = [];
    for (const ri of [0, 2]) {
      const pts = roads[ri].pts, poles = [];
      let acc = 0;
      for (let q = 1; q < pts.length; q++) { acc += Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]); if (acc >= 46) { acc = 0; const a = Math.atan2(pts[q][1] - pts[q - 1][1], pts[q][0] - pts[q - 1][0]); poles.push([pts[q][0] - Math.sin(a) * 8, pts[q][1] + Math.cos(a) * 8]); } }
      lines.push(poles);
    }
    const cand = [];
    lines.forEach((poles) => { for (let q = 1; q < poles.length; q++) { const [x0, y0] = poles[q - 1], [x1, y1] = poles[q], mx = (x0 + x1) / 2, my = (y0 + y1) / 2; if (inPolyW(mx, my, poly) && (mx - cxw) ** 2 + (my - cyw) ** 2 > 400 * 400) cand.push([x0, y0, x1, y1]); } });
    for (let t = 0; t < 60 && hazards.length < 3 && cand.length; t++) {
      const c = cand[(r() * cand.length) | 0], mx = (c[0] + c[2]) / 2, my = (c[1] + c[3]) / 2;
      if (hazards.every((h) => Math.hypot(h.mx - mx, h.my - my) > 500)) hazards.push({ x0: c[0], y0: c[1], x1: c[2], y1: c[3], mx, my, known: 0, tk: 0 });
    }
    // people on roofs: the two big buildings and a dozen houses, away from the camp
    let no = 0;
    for (const h of houses) { h.inP = inPolyW(h.x, h.y, poly); h.no = h.inP ? ++no : 0; h.chk = 0; h.n = 0; h.st = 0; h.tHit = 0; h.tConf = 0; h.clock = 0; h.dr = []; h.boat = null; h.left = 0; }
    for (const h of big) if (h.inP) h.n = 6 + ((r() * 4) | 0);
    const pool = houses.filter((h) => h.inP && !h.big && (h.x - cxw) ** 2 + (h.y - cyw) ** 2 > 350 * 350);
    for (let t = 0, made = 0; t < 400 && made < 11 && pool.length; t++) {
      const h = pool[(r() * pool.length) | 0];
      if (h.n || houses.some((o) => o.n && Math.hypot(o.x - h.x, o.y - h.y) < 200)) continue;
      h.n = 1 + ((r() * 4) | 0); made++;
    }
    // the camp jetty: walk from the camp toward the river until the water is a metre deep
    let jx = cxw, jy = cyw; const jd = -cside;
    for (let q = 0; q < 80 && ground(jx, jy) > LEVEL - 1.2; q++) jy += jd * 5;
    yield;
    return { sd, ground, rdist, riverY, flow, shoreX, poly, roads, streets, houses, palms, trees, fth, fieldOK, lines, hazards, camp: [cxw, cyw], jetty: [jx, jy], town: [tcx, tcy], nD, nB };
  }

  // ------------------------------------------------------------ coverage grids
  const inP = new Uint8Array(NC), tru = new Uint8Array(NC), shr = new Uint8Array(NC), cb = new Int16Array(NC);
  const btot = new Uint16Array(NB), bun = new Uint16Array(NB), bcx = new Float32Array(NB), bcy = new Float32Array(NB);
  const bHouses = []; for (let b = 0; b < NB; b++) bHouses.push([]);
  let polyN = 0, shrN = 0, truN = 0, checked = 0, nRoofs = 0, found = 0, safe = 0, nFound = 0;
  for (let c = 0; c < NC; c++) { const i = c % GW, j = (c / GW) | 0; cb[c] = ((j / BS) | 0) * BW + ((i / BS) | 0); }
  const blockAt = (x, y) => { const i = Math.floor(x / (CELL * BS)), j = Math.floor(y / (CELL * BS)); return i < 0 || j < 0 || i >= BW || j >= BH ? -1 : j * BW + i; };
  // boat navigation: static cost (dry land, roofs, palms, current), plus live lines once the swarm has seen them
  const navBase = new Float32Array(NNV), navCost = new Float32Array(NNV), navDist = new Float32Array(NNV), heap = new Int32Array(NNV * 8), hkeyA = new Float32Array(NNV * 8);
  function* initGrids(w) {
    tru.fill(0); shr.fill(0); btot.fill(0); bun.fill(0); bcx.fill(0); bcy.fill(0);
    polyN = 0;
    for (let j = 0; j < GH; j++) {
      if ((j & 7) === 0) yield;
      for (let i = 0; i < GW; i++) {
        const c = j * GW + i, v = inPolyW((i + .5) * CELL, (j + .5) * CELL, w.poly) ? 1 : 0;
        inP[c] = v; if (!v) continue;
        polyN++; const b = cb[c]; btot[b]++; bcx[b] += (i + .5) * CELL; bcy[b] += (j + .5) * CELL;
      }
    }
    for (let b = 0; b < NB; b++) { bun[b] = btot[b]; if (btot[b]) { bcx[b] /= btot[b]; bcy[b] /= btot[b]; } bHouses[b].length = 0; }
    navCnt.fill(0); knownNav.fill(0);
    for (let c = 0; c < NC; c++) if (!inP[c]) { const n = navOf[c]; if (++navCnt[n] >= 8) knownNav[n] = 1; }
    yield;
    for (const h of w.houses) { if (!h.inP) continue; const b = blockAt(h.x, h.y); if (b >= 0) bHouses[b].push(h); }
    for (let j = 0; j < NVH; j++) {
      if ((j & 3) === 0) yield;
      for (let i = 0; i < NVW; i++) {
        const x = (i + .5) * NAV, y = (j + .5) * NAV, g = w.ground(x, y), rd = Math.abs(w.rdist(x, y));
        navBase[j * NVW + i] = g > LEVEL - .7 ? Infinity : 1 + 5 * Math.exp(-(rd * rd) / 4900);
      }
    }
    // a 20 m cell with a house in it is slow going (boats thread between roofs); the two big buildings block outright
    for (const h of w.houses) { const i = Math.floor(h.x / NAV), j = Math.floor(h.y / NAV); if (i >= 0 && j >= 0 && i < NVW && j < NVH && navBase[j * NVW + i] < Infinity) navBase[j * NVW + i] = h.big ? Infinity : navBase[j * NVW + i] + 2.5; }
    for (const p of w.palms) { const i = Math.floor(p[0] / NAV), j = Math.floor(p[1] / NAV); if (i >= 0 && j >= 0 && i < NVW && j < NVH && navBase[j * NVW + i] < 4) navBase[j * NVW + i] += .35; }
  }

  // ------------------------------------------------------------ layout
  let s = 1, ox = 0, oy = 0, phone = false, fx0 = 0, fx1 = 0, fy0 = 0, fy1 = 0, leftFrac = -1;
  const X = (x) => ox + x * s, Y = (y) => oy + y * s;
  function layout() {
    const W = cv.w, H = cv.h; leftFrac = parseFloat(stage.dataset.left) || 0;
    phone = W < 640 || (leftFrac === 0 && W < 900);
    fx0 = leftFrac > 0 ? leftFrac * W + 20 : (phone ? 12 : 24); fx1 = W - (phone ? 12 : 24);
    fy0 = 124; fy1 = H - (phone ? 50 : 34);
    s = Math.min((fx1 - fx0) / WM, (fy1 - fy0) / HM);
    ox = fx0 + (fx1 - fx0 - WM * s) / 2; oy = fy0 + (fy1 - fy0 - HM * s) / 2;
  }

  // ------------------------------------------------------------ art: water (below the ripples) and objects (above them)
  const TC = document.createElement('canvas'), tctx = TC.getContext('2d');
  const OBJ = document.createElement('canvas'), octx = OBJ.getContext('2d');
  const LOW = document.createElement('canvas'), lctx = LOW.getContext('2d');
  const LOWD = document.createElement('canvas'), ldctx = LOWD.getContext('2d');
  const U = document.createElement('canvas'), uctx = U.getContext('2d');
  const COV = document.createElement('canvas'); COV.width = GW; COV.height = GH;
  const STEP = 3;
  let LW = 0, LH = 0, GS = null, LIMG = null, DIMG = null;
  const ROOF = ['#C48E8A', '#DDB696', '#AEA8C8', '#CDD1DA', '#E4E2EA'];
  function* renderArt(w) {
    const W = cv.w, H = cv.h, dpr = cv.dpr, rr = kit.rng(w.sd * 13 + 5);
    for (const Cn of [TC, OBJ]) { Cn.width = Math.max(2, Math.round(W * dpr)); Cn.height = Math.max(2, Math.round(H * dpr)); }
    const g = tctx, o = octx; g.setTransform(dpr, 0, 0, dpr, 0, 0); o.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lw = Math.ceil(W / STEP) + 3, lh = Math.ceil(H / STEP) + 3;
    if (lw !== LW || lh !== LH) { LW = lw; LH = lh; GS = new Float32Array(LW * LH); LOW.width = LOWD.width = LW; LOW.height = LOWD.height = LH; LIMG = lctx.createImageData(LW, LH); DIMG = ldctx.createImageData(LW, LH); }
    for (let j = 0; j < LH; j++) { if ((j & 3) === 0) yield; const ym = ((j - 1) * STEP - oy) / s; for (let i = 0; i < LW; i++) GS[j * LW + i] = w.ground(((i - 1) * STEP - ox) / s, ym); }
    // water: depth-shaded, a little silty in the shallows; dry ground: hillshaded greens with a soft shoreline (alpha)
    const px = LIMG.data, pd = DIMG.data, k = s / (2 * STEP), Lx = -.45, Ly = -.6, Lz = .66, Ll = Math.hypot(Lx, Ly, Lz);
    const SH = [118, 152, 182], DP = [50, 68, 118], SILT = [128, 136, 134];
    for (let j = 0; j < LH; j++) {
      if ((j & 3) === 0) yield;
      const ym = ((j - 1) * STEP - oy) / s, jm = Math.max(0, j - 1) * LW, jp = Math.min(LH - 1, j + 1) * LW;
      for (let i = 0; i < LW; i++) {
        const c = j * LW + i, xm = ((i - 1) * STEP - ox) / s, gg = GS[c], d = LEVEL - gg, q = c * 4;
        const t = smooth(-.2, 5.5, d), n = w.nD(xm / 90, ym / 90) - .5, silt = clamp(.22 - d * .05 + n * .25, 0, .3);
        let R = SH[0] + (DP[0] - SH[0]) * t, G = SH[1] + (DP[1] - SH[1]) * t, B = SH[2] + (DP[2] - SH[2]) * t;
        R += (SILT[0] - R) * silt; G += (SILT[1] - G) * silt; B += (SILT[2] - B) * silt;
        const m = 1 + n * .1; px[q] = R * .8 * m; px[q + 1] = G * .82 * m; px[q + 2] = B * .88 * m; px[q + 3] = 255;
        // dry ground
        const hx = (GS[j * LW + Math.min(LW - 1, i + 1)] - GS[j * LW + Math.max(0, i - 1)]) * k, hy = (GS[jp + i] - GS[jm + i]) * k;
        const nx = -hx * 2.2, ny = -hy * 2.2, nl = 1 / Math.sqrt(nx * nx + ny * ny + 1), dif = (nx * Lx + ny * Ly + Lz) * nl / Ll;
        const lum = clamp(.86 + 1.0 * (dif - .66) + n * .14, .4, 1.2), hill = smooth(LEVEL + 1, LEVEL + 12, gg);
        let r2 = 128 + (88 - 128) * hill, g2 = 150 + (116 - 150) * hill, b2 = 116 + (100 - 116) * hill;
        r2 *= lum; g2 *= lum; b2 *= lum;
        const sh = clamp((.86 - lum) * 1.0, 0, .4); r2 += (54 - r2) * sh; g2 += (52 - g2) * sh; b2 += (102 - b2) * sh;
        pd[q] = r2 * .86; pd[q + 1] = g2 * .86; pd[q + 2] = b2 * .9; pd[q + 3] = 255 * smooth(-.25, .15, -d);
      }
    }
    lctx.putImageData(LIMG, 0, 0); ldctx.putImageData(DIMG, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(LOW, -1.5 * STEP, -1.5 * STEP, LW * STEP, LH * STEP);
    const xm0 = (0 - ox) / s - 60, xm1 = (W - ox) / s + 60, ym0 = (0 - oy) / s - 60, ym1 = (H - oy) / s + 60;
    g.lineCap = 'round'; g.lineJoin = 'round';
    // under water: paddy bunds, the river's banks, roads and streets as pale ghosts
    {
      const c0 = Math.cos(w.fth), s0 = Math.sin(w.fth), PW = 46, PH = 32;
      g.beginPath();
      const span = Math.max(WM, HM) + 1200, cx0 = WM / 2, cy0 = HM / 2;
      for (let a = -span / 2; a < span / 2; a += PW) for (let b = -span / 2; b < span / 2; b += PH) {
        if (b === -span / 2 && (Math.round(a / PW) & 3) === 0) yield;
        const x = cx0 + c0 * a - s0 * b, y = cy0 + s0 * a + c0 * b; if (x < xm0 || x > xm1 || y < ym0 || y > ym1) continue;
        if (!w.fieldOK(x + c0 * PW / 2, y + s0 * PW / 2)) continue;
        g.moveTo(X(x), Y(y)); g.lineTo(X(x + c0 * PW), Y(y + s0 * PW));
        if (w.fieldOK(x - s0 * PH / 2, y + c0 * PH / 2)) { g.moveTo(X(x), Y(y)); g.lineTo(X(x - s0 * PH), Y(y + c0 * PH)); }
      }
      g.strokeStyle = 'rgba(206,226,236,.085)'; g.lineWidth = 1; g.stroke();
    }
    for (const sg of [-1, 1]) {
      g.beginPath();
      for (let x = xm0; x <= xm1; x += 8) { const y = w.riverY(x) + sg * 34; if (x === xm0) g.moveTo(X(x), Y(y)); else g.lineTo(X(x), Y(y)); }
      g.strokeStyle = 'rgba(30,40,80,.22)'; g.lineWidth = Math.max(1.5, 6 * s); g.stroke();
    }
    const polyline = (pts, ctx2) => { ctx2.beginPath(); pts.forEach(([x, y], q) => (q ? ctx2.lineTo(X(x), Y(y)) : ctx2.moveTo(X(x), Y(y)))); };
    for (const st of w.streets) { polyline(st.pts, g); g.strokeStyle = 'rgba(214,226,232,.16)'; g.lineWidth = Math.max(2, st.w * s * 1.4); g.stroke(); }
    for (const rd of w.roads) { polyline(rd.pts, g); g.strokeStyle = 'rgba(222,230,234,.2)'; g.lineWidth = Math.max(2.4, rd.w * s * 1.6); g.stroke(); g.strokeStyle = 'rgba(232,236,238,.12)'; g.lineWidth = Math.max(.8, rd.w * s * .4); g.stroke(); }
    // the cross road's bridge, just under the surface
    {
      const rd = w.roads[1].pts; let bi = 0, bd = 1e9; rd.forEach(([x, y], q) => { const d = Math.abs(w.rdist(x, y)); if (d < bd) { bd = d; bi = q; } });
      const p0 = rd[Math.max(0, bi - 3)], p1 = rd[Math.min(rd.length - 1, bi + 3)];
      g.beginPath(); g.moveTo(X(p0[0]), Y(p0[1])); g.lineTo(X(p1[0]), Y(p1[1])); g.strokeStyle = 'rgba(226,232,236,.28)'; g.lineWidth = Math.max(3, 9 * s); g.stroke();
    }
    yield;
    // objects layer: dry ground, shoreline, roofs and their shadows on the water, palms, trees, poles, the camp
    o.imageSmoothingEnabled = true; o.imageSmoothingQuality = 'high'; o.drawImage(LOWD, -1.5 * STEP, -1.5 * STEP, LW * STEP, LH * STEP);
    {
      // the waterline: a soft pale edge where the ground meets the flood
      o.beginPath();
      for (let j = 0; j < LH - 1; j++) for (let i = 0; i < LW - 1; i++) {
        if (i === 0 && (j & 31) === 0) yield;
        const c = j * LW + i, a = GS[c] - LEVEL, b = GS[c + 1] - LEVEL, d = GS[c + LW] - LEVEL, e = GS[c + LW + 1] - LEVEL;
        const m = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (e > 0 ? 4 : 0) | (d > 0 ? 8 : 0); if (m === 0 || m === 15) continue;
        const X0 = (i - 1) * STEP, Y0 = (j - 1) * STEP, tx = X0 - a / (b - a) * STEP, bx = X0 - d / (e - d) * STEP, ly = Y0 - a / (d - a) * STEP, ry = Y0 - b / (e - b) * STEP;
        const pts = [];
        if ((a > 0) !== (b > 0)) pts.push(tx, Y0); if ((b > 0) !== (e > 0)) pts.push(X0 + STEP, ry); if ((d > 0) !== (e > 0)) pts.push(bx, Y0 + STEP); if ((a > 0) !== (d > 0)) pts.push(X0, ly);
        if (pts.length >= 4) { o.moveTo(pts[0], pts[1]); o.lineTo(pts[2], pts[3]); } if (pts.length >= 8) { o.moveTo(pts[4], pts[5]); o.lineTo(pts[6], pts[7]); }
      }
      o.strokeStyle = 'rgba(226,236,240,.4)'; o.lineWidth = 1.1; o.stroke();
    }
    const hk = Math.max(s * 1.15, phone ? .26 : .38), quad = (P, x, y, l, wd, a, dx = 0, dy = 0) => {
      const c0 = Math.cos(a), s0 = Math.sin(a), hl = l / 2, hw = wd / 2, Xc = X(x) + dx, Yc = Y(y) + dy;
      P.moveTo(Xc + c0 * hl - s0 * hw, Yc + s0 * hl + c0 * hw); P.lineTo(Xc - c0 * hl - s0 * hw, Yc - s0 * hl + c0 * hw);
      P.lineTo(Xc - c0 * hl + s0 * hw, Yc - s0 * hl - c0 * hw); P.lineTo(Xc + c0 * hl + s0 * hw, Yc + s0 * hl - c0 * hw); P.closePath();
    };
    yield;
    // trees and palm shadows first, so roofs sit on top
    const tS = new Path2D(), tB = new Path2D(), tH = new Path2D(), pS = new Path2D(), pF = new Path2D(), pF2 = new Path2D();
    for (const [x, y, R0] of w.trees) {
      if (x < xm0 || x > xm1 || y < ym0 || y > ym1) continue;
      const R = Math.max(phone ? 1.1 : 1.6, R0 * s * 1.1), Xs = X(x), Ys = Y(y);
      tS.moveTo(Xs + R * .6 + R, Ys + R * .7); tS.arc(Xs + R * .6, Ys + R * .7, R, 0, TAU);
      tB.moveTo(Xs + R, Ys); tB.arc(Xs, Ys, R, 0, TAU); tH.moveTo(Xs - R * .3 + R * .45, Ys - R * .3); tH.arc(Xs - R * .3, Ys - R * .3, R * .45, 0, TAU);
    }
    const pr = clamp(5.2 * s * 1.25, phone ? 1.6 : 2.4, 5.4);
    for (const [x, y, a0, sc] of w.palms) {
      if (x < xm0 || x > xm1 || y < ym0 || y > ym1) continue;
      const Xs = X(x), Ys = Y(y), R = pr * sc;
      pS.moveTo(Xs + R * .7 + R * .8, Ys + R * .8); pS.arc(Xs + R * .7, Ys + R * .8, R * .8, 0, TAU);
      for (let q = 0; q < 6; q++) {
        const a = a0 + q * TAU / 6, ex = Xs + Math.cos(a) * R, ey = Ys + Math.sin(a) * R, mx = Xs + Math.cos(a + .35) * R * .55, my = Ys + Math.sin(a + .35) * R * .55;
        (q % 2 ? pF : pF2).moveTo(Xs, Ys); (q % 2 ? pF : pF2).quadraticCurveTo(mx, my, ex, ey);
      }
    }
    o.fillStyle = 'rgba(20,26,52,.32)'; o.fill(tS); o.fill(pS);
    o.fillStyle = '#577A68'; o.fill(tB); o.fillStyle = 'rgba(176,206,170,.2)'; o.fill(tH);
    o.lineCap = 'round'; o.strokeStyle = '#5E8A6E'; o.lineWidth = Math.max(1.1, pr * .36); o.stroke(pF2); o.strokeStyle = '#7FA585'; o.lineWidth = Math.max(.9, pr * .28); o.stroke(pF);
    yield;
    // roofs: a shadow on the water, a pale waterline ring, the roof, its ridge
    const shadow = new Path2D(), ring = new Path2D(), roofs = ROOF.map(() => new Path2D()), ridge = new Path2D();
    for (const h of w.houses) {
      if (h.x < xm0 || h.x > xm1 || h.y < ym0 || h.y > ym1) continue;
      const l = h.l * hk, wd = h.w * hk;
      quad(shadow, h.x, h.y, l, wd, h.a, 1.6, 1.9); quad(ring, h.x, h.y, l + 2.2, wd + 2.2, h.a); quad(roofs[h.col], h.x, h.y, l, wd, h.a);
      if (!h.big) { const c0 = Math.cos(h.a) * l * .4, s0 = Math.sin(h.a) * l * .4; ridge.moveTo(X(h.x) - c0, Y(h.y) - s0); ridge.lineTo(X(h.x) + c0, Y(h.y) + s0); }
    }
    o.fillStyle = 'rgba(18,22,48,.42)'; o.fill(shadow);
    o.strokeStyle = 'rgba(214,232,240,.32)'; o.lineWidth = 1; o.stroke(ring);
    roofs.forEach((P, q) => { o.fillStyle = ROOF[q]; o.fill(P); });
    o.strokeStyle = 'rgba(48,40,66,.42)'; o.lineWidth = .8; o.stroke(ridge);
    for (const h of w.houses) if (h.big) {                                // a cross on the church, a parapet on the school
      const Xs = X(h.x), Ys = Y(h.y), c0 = Math.cos(h.a), s0 = Math.sin(h.a), L = h.l * hk;
      o.strokeStyle = 'rgba(80,72,104,.5)'; o.lineWidth = 1; o.beginPath();
      if (h.kind === 'church') { const ex = Xs + c0 * L * .32, ey = Ys + s0 * L * .32, k2 = 3.2; o.moveTo(ex - c0 * k2, ey - s0 * k2); o.lineTo(ex + c0 * k2, ey + s0 * k2); o.moveTo(ex + s0 * k2 * .7, ey - c0 * k2 * .7); o.lineTo(ex - s0 * k2 * .7, ey + c0 * k2 * .7); }
      else { const P = new Path2D(); quad(P, h.x, h.y, L - 3, h.w * hk - 3, h.a); o.stroke(P); }
      o.stroke();
    }
    // power poles and their wires (the spans that are down get drawn live, once the swarm finds them)
    o.beginPath();
    for (const poles of w.lines) for (let q = 1; q < poles.length; q++) {
      const [x0, y0] = poles[q - 1], [x1, y1] = poles[q]; if (Math.max(x0, x1) < xm0 || Math.min(x0, x1) > xm1) continue;
      if (w.hazards.some((hz) => hz.x0 === x0 && hz.y0 === y0)) continue;
      o.moveTo(X(x0), Y(y0)); o.lineTo(X(x1), Y(y1));
    }
    o.strokeStyle = 'rgba(30,30,52,.4)'; o.lineWidth = .8; o.stroke();
    o.beginPath(); for (const poles of w.lines) for (const [x, y] of poles) { if (x < xm0 || x > xm1) continue; o.moveTo(X(x) + 1.3, Y(y)); o.arc(X(x), Y(y), 1.3, 0, TAU); }
    o.fillStyle = 'rgba(40,36,60,.85)'; o.fill();
    // the relief camp: tents in rows on the mound beside the school, and a jetty
    {
      const [cx0, cy0] = w.camp, [jx, jy] = w.jetty;
      o.beginPath(); o.moveTo(X(cx0), Y(cy0)); o.lineTo(X(jx), Y(jy)); o.strokeStyle = 'rgba(214,196,170,.85)'; o.lineWidth = Math.max(2, 5 * s); o.stroke();
      const tents = [new Path2D(), new Path2D()];
      for (let a = -2; a <= 2; a++) for (let b = -1; b <= 1; b++) { const x = cx0 + a * 16 - 10, y = cy0 + b * 14 - 4; quad(tents[(a + b + 4) % 2], x, y, Math.max(3.4, 10 * hk), Math.max(2.6, 7 * hk), 0); }
      o.fillStyle = '#F2D2B4'; o.fill(tents[0]); o.fillStyle = '#E7B3B0'; o.fill(tents[1]);
    }
    // dusk: a soft vignette and a lilac haze from the top
    for (const c2 of [o]) {
      const vg = c2.createRadialGradient(W * .62, H * .55, Math.min(W, H) * .3, W * .62, H * .55, Math.max(W, H) * .85);
      vg.addColorStop(0, 'rgba(20,22,48,0)'); vg.addColorStop(1, 'rgba(20,22,48,.42)');
      c2.save(); c2.globalCompositeOperation = 'source-atop'; c2.fillStyle = vg; c2.fillRect(0, 0, W, H); c2.restore();
    }
    {
      const vg = g.createRadialGradient(W * .62, H * .55, Math.min(W, H) * .3, W * .62, H * .55, Math.max(W, H) * .85);
      vg.addColorStop(0, 'rgba(20,22,48,0)'); vg.addColorStop(1, 'rgba(20,22,48,.42)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
      const hz = g.createLinearGradient(0, 0, 0, H * .45); hz.addColorStop(0, 'rgba(143,140,196,.14)'); hz.addColorStop(1, 'rgba(143,140,196,0)'); g.fillStyle = hz; g.fillRect(0, 0, W, H * .45);
    }
    // outside the search polygon: veiled for good (on both layers)
    for (const c2 of [g, o]) {
      c2.save(); c2.beginPath(); c2.rect(-2, -2, W + 4, H + 4); w.poly.forEach(([x, y], q) => (q ? c2.lineTo(X(x), Y(y)) : c2.moveTo(X(x), Y(y)))); c2.closePath(); c2.clip('evenodd');
      c2.globalCompositeOperation = 'source-atop'; c2.fillStyle = '#1f2248'; c2.globalAlpha = .28; c2.fillRect(0, 0, W, H); c2.globalAlpha = 1;
      c2.restore();
    }
  }

  // ------------------------------------------------------------ fog of war
  function polyPath(g) { const P = Wd.poly; g.beginPath(); P.forEach(([x, y], q) => (q ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); }
  function renderFog() {
    const W = Math.ceil(cv.w), H = Math.ceil(cv.h), g = uctx;
    U.width = W; U.height = H; g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = '#1f2248'; g.fillRect(0, 0, W, H);
    g.save(); polyPath(g); g.clip();
    g.strokeStyle = 'rgba(150,146,204,.42)'; g.lineWidth = 1; g.beginPath();
    for (let k = -H; k < W; k += 7) { g.moveTo(k, 0); g.lineTo(k + H, H); }
    g.stroke(); g.restore();
    const cg = COV.getContext('2d'), img = cg.createImageData(GW, GH), px = img.data;
    let any = false;
    for (let c = 0; c < NC; c++) { if (tru[c]) { any = true; px[c * 4 + 3] = 255; } }
    g.save(); polyPath(g); g.clip();                                     // stamps stay inside the polygon until the next resize
    if (any) { cg.putImageData(img, 0, 0); g.globalCompositeOperation = 'destination-out'; g.imageSmoothingEnabled = true; g.drawImage(COV, X(0), Y(0), WM * s, HM * s); g.globalCompositeOperation = 'source-over'; }
  }
  function fogStamp(x, y, R) {
    const rp = R * s * (1.18 + Math.random() * .24); x += (Math.random() - .5) * R * .25; y += (Math.random() - .5) * R * .25; uctx.globalCompositeOperation = 'destination-out';
    uctx.drawImage(BRUSH, X(x) - rp, Y(y) - rp, 2 * rp, 2 * rp); uctx.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------ swarm, boats, events
  const TRN = 12, D = [], B = [];
  for (let k = 0; k < NDR; k++) D.push({ k, id: k + 1, x: 0, y: 0, vx: 0, vy: 0, hd: 0, st: 'pad', tb: -1, sx: 0, sy: 0, at: 0, trail: new Float32Array(TRN * 2), tn: 0, tt: 0, comp: 0, iso: false, offT: 0, tx: 0, ty: 0, wv: 0, isoT: 0, myUn: new Uint16Array(NB), pend: [], grp: null, slot: 0, idleT: 0 });
  const WK = 26;
  for (let k = 0; k < NBOAT; k++) B.push({ k, id: k + 1, x: 0, y: 0, hd: 0, st: 'dock', path: new Float32Array(4000), pn: 0, pi: 0, roof: null, cargo: 0, wait: 0, rt: 0, wake: new Float32Array(WK * 3), wn: 0, wt: 0, trips: 0, sp: 0 });
  const active = (d) => d.st !== 'pad' && d.st !== 'landed';
  const links = new Int16Array(NDR * NDR * 2), linkShow = new Uint8Array(NDR * NDR); let nLinks = 0;
  const par = new Int8Array(NDR), compSize = new Int8Array(NDR);
  let mainComp = 0, nIso = 0;
  const notes = [], queue = [];
  let simT = 0, wallT = 0, phase = 'run', phaseT = 0, meshT = 0, betaT = 0, beta0 = 1, isoSaid = -99, missionN = 0, summary = null, lastIso = null, dispT = 0, saidBoat = 0, saidCur = 0;
  const patches = [];
  const P = (long, short) => (phone ? short : long);                     // callouts are shorter on a phone
  function say(s2, x, y, col = C.ink, dur = 4.2, key = '') {
    if (key) for (let q = notes.length - 1; q >= 0; q--) if (notes[q].key === key) notes.splice(q, 1);   // a newer note of the same kind replaces the old one
    notes.push({ s: s2, x, y, col, t0: wallT, dur, key }); if (notes.length > 3) notes.shift();
  }

  // the next mission: built in slices while the summary shows (world + grids), then behind a black hold (art)
  let job = null, jobKind = '', nextW = null;
  function* prep(sd) { const w = yield* gen(sd); yield* initGrids(w); nextW = w; }
  function pump(ms) { const t0 = performance.now(); while (job && performance.now() - t0 < ms) if (job.next().done) job = null; }
  function newMission() {                                                 // Wd, the grids and the art are ready
    renderFog();
    shrN = 0; truN = 0; checked = 0; found = 0; safe = 0; nFound = 0; nRoofs = 0; for (const h of Wd.houses) if (h.inP) nRoofs++;
    simT = 0; phase = 'run'; phaseT = 0; meshT = 0; betaT = 0; beta0 = 1; notes.length = 0; summary = null; isoSaid = -99; missionN++; queue.length = 0; dispT = 0; saidBoat = 0; saidCur = 0;
    const [cx0, cy0] = Wd.camp;
    for (const d of D) {
      d.x = cx0 + ((d.k % 6) - 2.5) * 12; d.y = cy0 + (((d.k / 6) | 0) - 1.5) * 12; d.vx = d.vy = 0; d.hd = Math.atan2(d.y - cy0, d.x - cx0); d.st = 'pad'; d.tb = -1;
      d.sx = d.x; d.sy = d.y; d.at = .2 + d.k * .1; d.tn = 0; d.tt = 0; d.iso = false; d.offT = 0; d.wv = d.k * 1.7; d.pend.length = 0; d.grp = null; d.idleT = 0;
    }
    const [jx, jy] = Wd.jetty;
    for (const b of B) { b.x = jx + (b.k - 3.5) * 11; b.y = jy + (b.k % 2) * 8; b.hd = Math.atan2(jy - cy0, jx - cx0); b.st = 'dock'; b.pn = 0; b.pi = 0; b.roof = null; b.cargo = 0; b.wait = 0; b.rt = 0; b.wn = 0; b.trips = 0; b.sp = 0; }
    say(`${NDR} drones fan out from the relief camp`, cx0, cy0, C.teal, 4.5);
  }

  // frontier choice (the same rule as every LIMINAL zone)
  const claimS = new Int32Array(NB), claimV = new Float32Array(NB); let claimN = 0;
  function mark(b, v, nb) {
    const bi = b % BW, bj = (b / BW) | 0;
    for (let j = bj - nb; j <= bj + nb; j++) for (let i = bi - nb; i <= bi + nb; i++) {
      if (i < 0 || j < 0 || i >= BW || j >= BH) continue;
      const q = j * BW + i, vv = (i === bi && j === bj) ? v : v * .06;
      if (claimS[q] !== claimN) { claimS[q] = claimN; claimV[q] = vv; } else claimV[q] += vv;
    }
  }
  const doneB = (un, b) => !btot[b] || un[b] <= btot[b] * DONE;
  function choose(d) {
    claimN++;
    for (const o of D) { if (o === d || !active(o) || o.comp !== d.comp) continue; if (o.tb >= 0) mark(o.tb, 2.2, 1); const ob = blockAt(o.x, o.y); if (ob >= 0) mark(ob, .3, 0); }
    const un = d.iso ? d.myUn : bun, hx = Math.cos(d.hd), hy = Math.sin(d.hd);
    let best = -1, bs = -1e9;
    for (let b = 0; b < NB; b++) {
      const t = btot[b]; if (!t || un[b] <= t * DONE) continue;
      const dx = bcx[b] - d.x, dy = bcy[b] - d.y, dist = Math.sqrt(dx * dx + dy * dy) + 1;
      let sc = .5 * un[b] / t - dist / 380 - .22 * (1 - (dx * hx + dy * hy) / dist);
      const bi = b % BW, bj = (b / BW) | 0, dl = bi > 0 && doneB(un, b - 1), dr = bi < BW - 1 && doneB(un, b + 1), du = bj > 0 && doneB(un, b - BW), dd = bj < BH - 1 && doneB(un, b + BW);
      if (dl || dr || du || dd) sc += .32;                               // frontier: touches searched water
      if ((dl && dr) || (du && dd)) sc += .3;                             // a gap left between two passes: close it now
      if (claimS[b] === claimN) sc -= claimV[b];
      if (sc > bs) { bs = sc; best = b; }
    }
    d.tb = best;
    if (best >= 0) aim(d, best);
  }
  // inside the chosen block, fly to the unsearched cell nearest the centroid of what is still unsearched there
  function aim(d, b) {
    const seen = d.iso ? tru : shr, bi = (b % BW) * BS, bj = ((b / BW) | 0) * BS;
    let sx = 0, sy = 0, n = 0;
    for (let j = bj; j < Math.min(GH, bj + BS); j++) for (let i = bi; i < Math.min(GW, bi + BS); i++) { const c = j * GW + i; if (inP[c] && !seen[c]) { sx += i; sy += j; n++; } }
    if (!n) { d.tx = bcx[b]; d.ty = bcy[b]; return; }
    sx /= n; sy /= n; let bd = 1e9;
    for (let j = bj; j < Math.min(GH, bj + BS); j++) for (let i = bi; i < Math.min(GW, bi + BS); i++) { const c = j * GW + i; if (inP[c] && !seen[c]) { const q = (i - sx) ** 2 + (j - sy) ** 2; if (q < bd) { bd = q; d.tx = (i + .5) * CELL; d.ty = (j + .5) * CELL; } } }
  }
  function stampFine(d, x, y) {
    const ci = x / CELL, cj = y / CELL, rc = R_FINE / CELL, rc2 = rc * rc;
    const i0 = Math.max(0, Math.floor(ci - rc)), i1 = Math.min(GW - 1, Math.ceil(ci + rc)), j0 = Math.max(0, Math.floor(cj - rc)), j1 = Math.min(GH - 1, Math.ceil(cj + rc));
    for (let j = j0; j <= j1; j++) {
      const dy = j + .5 - cj, row = j * GW;
      for (let i = i0; i <= i1; i++) {
        const dx = i + .5 - ci; if (dx * dx + dy * dy > rc2) continue;
        const c = row + i; if (!inP[c]) continue;
        if (!tru[c]) { tru[c] = 1; truN++; if (d.iso) { d.pend.push(c); if (d.myUn[cb[c]] > 0) d.myUn[cb[c]]--; } }
        if (!d.iso && !shr[c]) shareCell(c);
      }
    }
    fogStamp(x, y, R_FINE);
    // roofs in view are checked; heat on a roof is a thermal hit
    const R2 = (R_FINE * .92) ** 2, bi0 = Math.floor((x - R_FINE) / (CELL * BS)), bi1 = Math.floor((x + R_FINE) / (CELL * BS)), bj0 = Math.floor((y - R_FINE) / (CELL * BS)), bj1 = Math.floor((y + R_FINE) / (CELL * BS));
    for (let bj = Math.max(0, bj0); bj <= Math.min(BH - 1, bj1); bj++) for (let bi = Math.max(0, bi0); bi <= Math.min(BW - 1, bi1); bi++) {
      for (const h of bHouses[bj * BW + bi]) {
        if (h.chk || (h.x - x) ** 2 + (h.y - y) ** 2 > R2) continue;
        h.chk = 1; h.tChk = wallT; checked++;
        if (h.n) hit(h, d);
      }
    }
    for (const hz of Wd.hazards) if (!hz.known && (hz.mx - x) ** 2 + (hz.my - y) ** 2 < R2) {
      hz.known = 1; hz.tk = wallT; say(P('live power line down in the water: boats keep clear', 'live line in the water'), hz.mx, hz.my, C.danger, 5);
      const r2 = 34 * 34;
      for (let j = 0; j < NVH; j++) for (let i = 0; i < NVW; i++) { const px = (i + .5) * NAV, py = (j + .5) * NAV; if (segD2(px, py, hz.x0, hz.y0, hz.x1, hz.y1) < r2) navBase[j * NVW + i] = Infinity; }
    }
  }
  const segD2 = (px, py, x0, y0, x1, y1) => { const dx = x1 - x0, dy = y1 - y0, t = clamp(((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1), 0, 1), ex = x0 + dx * t - px, ey = y0 + dy * t - py; return ex * ex + ey * ey; };
  function hit(h, d) {
    h.st = 1; h.tHit = simT; h.dr = [d]; h.clock = 0;
    const o = D.filter((q) => q !== d && q.st === 'search' && q.comp === d.comp && Math.hypot(q.x - h.x, q.y - h.y) < 420).sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0];
    if (o) h.dr.push(o);
    const a0 = Math.atan2(d.y - h.y, d.x - h.x);
    h.dr.forEach((q, k) => { q.st = 'conf'; q.grp = h; q.slot = a0 + k * Math.PI; });
  }
  function confirm(h) {
    h.st = 2; h.tConf = wallT; found += h.n; nFound++; h.left = h.n;
    const who = h.n > 1 ? `${h.n} people` : '1 person', where = h.kind === 'church' ? 'on the church roof' : h.kind === 'school' ? 'on the school roof' : `on roof ${h.no}`;
    say(P(`${who} ${where}: heat + waving, camera agrees`, `${who} ${where}`), h.x, h.y, C.heat, 4.6);
    for (const q of h.dr) if (q.st === 'conf') { q.st = 'search'; q.tb = -1; q.grp = null; }
    queue.push(h);
  }

  // boats: Dijkstra from the goal over the water the swarm has searched; the boat walks down the gradient
  // a boat may use a 20 m nav cell once at least half of its 16 fine cells are in the shared map (kept up to date as cells are searched)
  const knownNav = new Uint8Array(NNV), navCnt = new Uint8Array(NNV), navOf = new Int16Array(NC);
  for (let c = 0; c < NC; c++) navOf[c] = (((c / GW) | 0) >> 2) * NVW + ((c % GW) >> 2);
  const shareCell = (c) => { shr[c] = 1; shrN++; bun[cb[c]]--; const n = navOf[c]; if (++navCnt[n] >= 8) knownNav[n] = 1; };
  function dijkstra(gx, gy, campGoal, relax) {
    // unsearched water is unknown: never used, except as a costly last resort for a roof that has waited too long
    for (let c = 0; c < NNV; c++) { const k = navBase[c]; navCost[c] = (knownNav[c] || campGoal) ? k : relax ? k + 12 : Infinity; navDist[c] = Infinity; }
    const ci = clamp(Math.floor(gx / NAV), 0, NVW - 1), cj = clamp(Math.floor(gy / NAV), 0, NVH - 1), g0 = cj * NVW + ci;
    let hn = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= NVW || jj >= NVH || (!di && !dj)) continue; const c = jj * NVW + ii; if (navCost[c] < Infinity) navDist[c] = 0; }
    const push = (c, d) => { let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hkeyA[p] <= d) break; heap[i] = heap[p]; hkeyA[i] = hkeyA[p]; i = p; } heap[i] = c; hkeyA[i] = d; };
    const pop = () => { const top = heap[0], last = heap[--hn], lk = hkeyA[hn]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hkeyA[c + 1] < hkeyA[c]) c++; if (hkeyA[c] >= lk) break; heap[i] = heap[c]; hkeyA[i] = hkeyA[c]; i = c; } heap[i] = last; hkeyA[i] = lk; return top; };
    navDist[g0] = 0; push(g0, 0);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= NVW || jj >= NVH || (!di && !dj)) continue; const c = jj * NVW + ii; if (navDist[c] === 0) push(c, 0); }
    while (hn > 0) {
      const dK = hkeyA[0], c = pop(); if (dK > navDist[c]) continue;
      const i = c % NVW, j = (c / NVW) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NVW || jj >= NVH) continue;
        const n = jj * NVW + ii, k = navCost[n]; if (k === Infinity) continue;
        if (di && dj && (navCost[j * NVW + ii] === Infinity || navCost[jj * NVW + i] === Infinity)) continue;
        const nd = dK + (di && dj ? 1.4142 : 1) * k;
        if (nd < navDist[n] && hn < heap.length - 1) { navDist[n] = nd; push(n, nd); }
      }
    }
  }
  // walk down the distance field from (x, y) to the goal; then smooth the polyline (Chaikin) into the boat's path
  const tmpP = new Float32Array(4000), tmpQ = new Float32Array(4000);
  const navAt = (x, y) => { const i = Math.floor(x / NAV), j = Math.floor(y / NAV); return i < 0 || j < 0 || i >= NVW || j >= NVH ? Infinity : navCost[j * NVW + i]; };
  function sight(x0, y0, x1, y1) {
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(L / (NAV * .4)), lim = Math.max(Math.min(navAt(x0, y0), 9), Math.min(navAt(x1, y1), 9), 1.6) + .4;
    for (let q = 1; q < n; q++) { const t = q / n, c = navAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); if (c === Infinity || c > lim) return false; }
    return true;
  }
  function route(b, x, y, gx, gy) {
    let i = clamp(Math.floor(x / NAV), 0, NVW - 1), j = clamp(Math.floor(y / NAV), 0, NVH - 1);
    if (navDist[j * NVW + i] === Infinity) {                              // start just off a roof or the jetty: step to the nearest reachable cell
      let bd = Infinity, bi = -1;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NVW || jj >= NVH) continue; const v = navDist[jj * NVW + ii]; if (v < bd) { bd = v; bi = jj * NVW + ii; } }
      if (bi < 0) return false; i = bi % NVW; j = (bi / NVW) | 0;
    }
    let n = 0; tmpP[n++] = x; tmpP[n++] = y;
    for (let guard = 0; guard < 1500; guard++) {
      const c = j * NVW + i; if (navDist[c] === 0) break;
      let best = c, bv = navDist[c];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NVW || jj >= NVH) continue; const v = navDist[jj * NVW + ii]; if (v < bv) { bv = v; best = jj * NVW + ii; } }
      if (best === c) return false;
      i = best % NVW; j = (best / NVW) | 0;
      if (n < tmpP.length - 4) { tmpP[n++] = (i + .5) * NAV; tmpP[n++] = (j + .5) * NAV; }
    }
    if (n < tmpP.length - 2) { tmpP[n++] = gx; tmpP[n++] = gy; }
    // string pulling: from each kept point jump to the farthest point in clear sight (no roofs, no dry land, no live
    // line, and no shortcut through the current that the route itself avoided), then smooth the corners
    const keep2 = tmpQ; let m2 = 0, i0 = 0; keep2[m2++] = tmpP[0]; keep2[m2++] = tmpP[1];
    while (i0 < n - 2) {
      let j = Math.min(n - 2, i0 + 80);
      while (j > i0 + 2 && !sight(tmpP[i0], tmpP[i0 + 1], tmpP[j], tmpP[j + 1])) j -= 2;
      keep2[m2++] = tmpP[j]; keep2[m2++] = tmpP[j + 1]; i0 = j;
    }
    tmpP.set(keep2.subarray(0, m2)); n = m2;
    // two rounds of Chaikin corner cutting
    let src = tmpP, cnt = n;
    for (let it = 0; it < 2; it++) {
      const dst = b.path; let m = 0; dst[m++] = src[0]; dst[m++] = src[1];
      for (let q = 0; q + 3 < cnt && m < dst.length - 6; q += 2) {
        const x0 = src[q], y0 = src[q + 1], x1 = src[q + 2], y1 = src[q + 3];
        dst[m++] = x0 * .75 + x1 * .25; dst[m++] = y0 * .75 + y1 * .25; dst[m++] = x0 * .25 + x1 * .75; dst[m++] = y0 * .25 + y1 * .75;
      }
      dst[m++] = src[cnt - 2]; dst[m++] = src[cnt - 1];
      if (it === 0) { tmpP.set(dst.subarray(0, m)); src = tmpP; }
      cnt = m;
    }
    b.pn = cnt; b.pi = 0;
    return true;
  }
  function dispatch() {
    if (!queue.length) return;
    const idle = B.filter((b) => b.st === 'dock');
    if (!idle.length) return;
    const h = queue[0];
    const b = idle.sort((p, q) => Math.hypot(p.x - h.x, p.y - h.y) - Math.hypot(q.x - h.x, q.y - h.y))[0];
    dijkstra(h.x, h.y, false, wallT - h.tConf > 6);
    if (!route(b, b.x, b.y, h.x, h.y)) {
      if (wallT - h.tConf > 14) { queue.shift(); h.st = 4; say(P(`no boat route to ${h.kind ? 'the ' + h.kind : 'roof ' + h.no}: ground team called`, 'no boat route: ground team called'), h.x, h.y, C.muted, 4); }
      else if (queue.length > 1) queue.push(queue.shift());
      return;
    }
    queue.shift(); b.st = 'out'; b.wait = 0; b.rt = 0; b.roof = h; h.boat = b; b.trips++;
    // a drone hovers over the roof as a beacon until the boat is alongside
    const bc = D.filter((d) => d.st === 'search').sort((p, q) => Math.hypot(p.x - h.x, p.y - h.y) - Math.hypot(q.x - h.x, q.y - h.y))[0];
    if (bc) { bc.st = 'beacon'; bc.grp = h; }
    const hzNear = Wd.hazards.some((hz) => hz.known && pathNear(b, hz.mx, hz.my, 260));
    if (saidBoat < 3 || hzNear) {
      const to = h.kind ? 'the ' + h.kind : 'roof ' + h.no;
      say(P(hzNear ? `boat ${b.id} guided to ${to}, around a live line` : `boat ${b.id} guided to ${to} along the swarm's route`, `boat ${b.id} guided to ${to}`), b.x, b.y, C.apricot, 4.4);
      saidBoat++;
    }
  }
  const pathNear = (b, x, y, R) => { for (let q = 0; q < b.pn; q += 6) if ((b.path[q] - x) ** 2 + (b.path[q + 1] - y) ** 2 < R * R) return true; return false; };
  function boatHome(b) {
    dijkstra(Wd.jetty[0], Wd.jetty[1], true);
    b.st = 'back'; b.wait = 0;
    if (route(b, b.x, b.y, Wd.jetty[0] + (b.k - 3.5) * 11, Wd.jetty[1] + (b.k % 2) * 8)) b.rt = 0; else { b.pn = 0; b.pi = 0; b.rt = 1; }   // no way back yet: hold and retry
  }
  function stepBoat(b, sdt, dt) {
    if (b.st === 'dock' || b.st === 'load' || b.st === 'unload') {
      b.sp = Math.max(0, b.sp - sdt * 1.5);
      if (b.st === 'load') {
        b.wait -= sdt;
        if (b.wait <= 0) {
          const h = b.roof; b.cargo += h.left; h.left = 0; h.st = 3;
          say(`${b.cargo} aboard boat ${b.id}`, h.x, h.y, C.apricot, 3.2, 'aboard' + b.id);
          for (const d of D) if (d.st === 'beacon' && d.grp === h) { d.st = 'search'; d.grp = null; d.tb = -1; }
          // another roof waiting close by, and room for its people? go there first
          let nxt = -1; for (let q = 0; q < queue.length; q++) { const o = queue[q]; if (Math.hypot(o.x - h.x, o.y - h.y) < 520 && b.cargo + o.left <= CAP) { nxt = q; break; } }
          if (nxt >= 0) {
            const o = queue[nxt]; dijkstra(o.x, o.y, false);
            if (route(b, b.x, b.y, o.x, o.y)) { queue.splice(nxt, 1); b.st = 'out'; b.wait = 0; b.rt = 0; b.roof = o; o.boat = b; const bc = D.filter((d) => d.st === 'search').sort((p, q) => Math.hypot(p.x - o.x, p.y - o.y) - Math.hypot(q.x - o.x, q.y - o.y))[0]; if (bc) { bc.st = 'beacon'; bc.grp = o; } return; }
          }
          b.roof = null; boatHome(b);
        }
      } else if (b.st === 'unload') { b.wait -= sdt; if (b.wait <= 0) { safe += b.cargo; say(P(`boat ${b.id} unloads: ${safe} safe at the camp`, `${safe} safe at the camp`), b.x, b.y, C.apricot, 3.4, 'camp'); b.cargo = 0; b.st = 'dock'; } }
    } else {
      if (b.rt > 0) { b.rt -= dt; if (b.rt <= 0) boatHome(b); return; }
      b.sp = Math.min(V_BOAT, b.sp + sdt * 1.2);
      let move = b.sp * sdt;
      while (move > 0 && b.pi < b.pn - 2) {
        const tx = b.path[b.pi + 2], ty = b.path[b.pi + 3], dx = tx - b.x, dy = ty - b.y, dd = Math.hypot(dx, dy);
        if (dd <= move) { b.x = tx; b.y = ty; move -= dd; b.pi += 2; } else { b.x += dx / dd * move; b.y += dy / dd * move; move = 0; }
        if (dd > .01) { const a = Math.atan2(dy, dx); let da = a - b.hd; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU; b.hd += da * Math.min(1, sdt * 1.6); }
      }
      if (b.pi >= b.pn - 2) {
        if (b.st === 'out') { b.st = 'load'; b.wait = 4 + b.roof.left * 1.5; }
        else if (!b.pn) return;
        else { b.st = 'unload'; b.wait = 3 + b.cargo; b.hd = Math.atan2(Wd.camp[1] - b.y, Wd.camp[0] - b.x); }
      }
    }
    b.wt += dt; if (b.wt > .06 && b.sp > .5) { b.wt = 0; const o = (b.wn % WK) * 3; b.wake[o] = b.x; b.wake[o + 1] = b.y; b.wake[o + 2] = wallT; b.wn++; }
  }

  // radio mesh (flat plain: range only) and the shared map's merge on reconnection
  function mesh() {
    nLinks = 0;
    for (let i = 0; i < NDR; i++) par[i] = i;
    const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let i = 0; i < NDR; i++) {
      const a = D[i]; if (!active(a)) continue;
      for (let j = i + 1; j < NDR; j++) {
        const b = D[j]; if (!active(b)) continue;
        if ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 > RADIO * RADIO) continue;
        links[nLinks * 2] = i; links[nLinks * 2 + 1] = j; nLinks++;
        const ra = find(i), rb = find(j); if (ra !== rb) par[ra] = rb;
      }
    }
    compSize.fill(0);
    let best = -1, bn = 0;
    for (let i = 0; i < NDR; i++) { if (!active(D[i])) continue; const r0 = find(i); D[i].comp = r0; compSize[r0]++; if (compSize[r0] > bn) { bn = compSize[r0]; best = r0; } }
    mainComp = best; nIso = 0;
    for (let q = 0; q < nLinks; q++) {
      const a = D[links[q * 2]], b = D[links[q * 2 + 1]], dd = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      let ra = 0, rb = 0;
      for (let p = 0; p < nLinks; p++) {
        const i = links[p * 2], j = links[p * 2 + 1];
        if (i === a.k || j === a.k) { const o = D[i === a.k ? j : i]; if ((o.x - a.x) ** 2 + (o.y - a.y) ** 2 < dd) ra++; }
        if (i === b.k || j === b.k) { const o = D[i === b.k ? j : i]; if ((o.x - b.x) ** 2 + (o.y - b.y) ** 2 < dd) rb++; }
      }
      linkShow[q] = ra < 2 || rb < 2 ? 1 : 0;
    }
    for (const d of D) {
      if (!active(d)) { d.iso = false; continue; }
      d.offT = d.comp !== mainComp ? d.offT + .15 : 0;
      const iso = d.offT > 1.2;
      if (iso && !d.iso) {
        d.isoT = wallT;
        d.myUn.set(bun); d.pend.length = 0;
        if (wallT - isoSaid > 8 && phase === 'run') { say(P(`drone ${d.id} out of radio range: keeps searching on its own`, `drone ${d.id} out of range, searching alone`), d.x, d.y, C.muted, 4); isoSaid = wallT; lastIso = d; }
      } else if (!iso && d.iso) {
        let m = 0; for (const c of d.pend) if (!shr[c]) { shareCell(c); m++; }
        d.pend.length = 0;
        if (lastIso === d && m > 120 && wallT - d.isoT > 3) { say(P(`drone ${d.id} back in range: maps merged, +${(m * CELL * CELL / 1e4).toFixed(1)} ha`, `drone ${d.id} back: maps merged`), d.x, d.y, C.teal, 4); lastIso = null; }
      }
      d.iso = iso; if (iso) nIso++;
    }
  }
  const bpar = new Int16Array(NB), bacc = new Float32Array(NB * 3);
  function betaCount() {
    const live = (b) => btot[b] > 0 && bun[b] > btot[b] * DONE;
    for (let b = 0; b < NB; b++) bpar[b] = b;
    const find = (i) => { while (bpar[i] !== i) { bpar[i] = bpar[bpar[i]]; i = bpar[i]; } return i; };
    for (let b = 0; b < NB; b++) {
      if (!live(b)) continue; const i = b % BW;
      if (i + 1 < BW && live(b + 1)) { const ra = find(b), rb = find(b + 1); if (ra !== rb) bpar[ra] = rb; }
      if (b + BW < NB && live(b + BW)) { const ra = find(b), rb = find(b + BW); if (ra !== rb) bpar[ra] = rb; }
    }
    bacc.fill(0); let n = 0;
    for (let b = 0; b < NB; b++) { if (!live(b)) continue; const r0 = find(b); if (!bacc[r0 * 3 + 2]) n++; bacc[r0 * 3] += bcx[b]; bacc[r0 * 3 + 1] += bcy[b]; bacc[r0 * 3 + 2]++; }
    patches.length = 0;
    if (n <= 8) for (let b = 0; b < NB; b++) if (bacc[b * 3 + 2]) patches.push([bacc[b * 3] / bacc[b * 3 + 2], bacc[b * 3 + 1] / bacc[b * 3 + 2]]);
    patches.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    return n;
  }

  function moveDrone(d, tx, ty, v, sdt) {
    const dx = tx - d.x, dy = ty - d.y, dist = Math.hypot(dx, dy) || 1, sp = Math.min(v, dist / Math.max(sdt, .05) * .9);
    let ex = dx / dist * sp, ey = dy / dist * sp;
    // a gentle weave across the track (a few tens of metres, period ~400 m): coverage edges come out organic, not ruled
    const wv = Math.sin(d.wv) * .5 * sp * smooth(4, 22, dist); ex -= dy / dist * wv; ey += dx / dist * wv;
    d.wv += sp * sdt / 64;
    for (const o of D) {
      if (o === d || !active(o)) continue;
      const qx = d.x - o.x, qy = d.y - o.y, q2 = qx * qx + qy * qy;
      if (q2 < 2500 && q2 > 1e-4) { const q = Math.sqrt(q2), f = (50 - q) / 50 * 5; ex += qx / q * f; ey += qy / q * f; }
    }
    const k = 1 - Math.exp(-sdt * 1.1);
    d.vx += (ex - d.vx) * k; d.vy += (ey - d.vy) * k;
    d.x += d.vx * sdt; d.y += d.vy * sdt;
    if (!(Math.abs(d.x) < 1e5 && Math.abs(d.y) < 1e5)) { d.x = d.sx = tx; d.y = d.sy = ty; d.vx = d.vy = 0; }   // never lose a drone to a numeric glitch
    if (d.vx * d.vx + d.vy * d.vy > .5) d.hd = Math.atan2(d.vy, d.vx);
  }
  // current streaks: particles carried by the flow (they live in world metres)
  const FLW = new Float32Array(2), NP = 150, PX = new Float32Array(NP), PY = new Float32Array(NP), PA = new Float32Array(NP), PL = new Float32Array(NP), PQ = new Float32Array(NP * 2);
  let prng = kit.rng(77);
  function spawn(q) {
    const W = cv.w, H = cv.h, x = ((prng() * W) - ox) / s, near = prng() < .78;
    const y = near ? Wd.riverY(x) + (prng() - .5) * 220 : ((prng() * H) - oy) / s;
    PX[q] = x; PY[q] = y; PQ[q * 2] = x; PQ[q * 2 + 1] = y; PA[q] = 0; PL[q] = 1.2 + prng() * 1.8;
  }
  function stepParticles(dt) {
    for (let q = 0; q < NP; q++) {
      PA[q] += dt; if (PA[q] > PL[q] || !Wd) { spawn(q); continue; }
      Wd.flow(PX[q], PY[q], FLW); PQ[q * 2] = PX[q]; PQ[q * 2 + 1] = PY[q];
      PX[q] += FLW[0] * dt * TL * 1.6; PY[q] += FLW[1] * dt * TL * 1.6;
      if (Wd.ground(PX[q], PY[q]) > LEVEL - .3) spawn(q);
    }
  }

  function step(dt) {
    wallT += dt; phaseT += dt;
    stepParticles(dt);
    if (phase === 'summary' || phase === 'fade' || phase === 'regen') {
      pump(phase === 'regen' ? 6 : 3.5);
      if (!job && jobKind === 'prep' && phase === 'regen') { job = renderArt(nextW); jobKind = 'art'; pump(5); }
      if (!job && jobKind === 'art') { jobKind = ''; Wd = nextW; nextW = null; newMission(); for (let q = 0; q < NP; q++) spawn(q); return; }
      if (phase === 'summary' && phaseT > 6) { phase = 'fade'; phaseT = 0; } else if (phase === 'fade' && phaseT > 1) { phase = 'regen'; phaseT = 0; }
      return;
    }
    const sdt = dt * TL; simT += sdt;
    for (const d of D) {
      if (d.st === 'pad') { if (phaseT >= d.at && phase === 'run') d.st = 'search'; else continue; }
      if (d.st === 'landed') continue;
      let tx = d.x, ty = d.y, v = V_FINE;
      if (d.st === 'search' || d.st === 'idle') {
        const un = d.iso ? d.myUn : bun;
        if (d.tb < 0 || un[d.tb] <= btot[d.tb] * DONE || Math.hypot(d.tx - d.x, d.ty - d.y) < 8) { d.idleT -= dt; if (d.tb >= 0 || d.idleT <= 0) { choose(d); d.idleT = .6; } }
        if (d.tb >= 0) { d.st = 'search'; tx = d.tx; ty = d.ty; }
        else if (d.iso) { d.st = 'idle'; tx = Wd.camp[0]; ty = Wd.camp[1]; }           // nothing left in its own map: fly back into range and merge
        else { d.st = 'idle'; v = 2; }
      } else if (d.st === 'conf') {
        const h = d.grp; tx = h.x + Math.cos(d.slot + simT * .03) * 30; ty = h.y + Math.sin(d.slot + simT * .03) * 30; v = V_FINE * 1.25;
      } else if (d.st === 'beacon') {
        const h = d.grp; tx = h.x + Math.cos(simT * .06) * 14; ty = h.y + Math.sin(simT * .06) * 14;
      } else if (d.st === 'home') {
        tx = Wd.camp[0] + ((d.k % 6) - 2.5) * 12; ty = Wd.camp[1] + (((d.k / 6) | 0) - 1.5) * 12; v = V_FINE * 1.4;
        if (Math.hypot(tx - d.x, ty - d.y) < 6) { d.st = 'landed'; continue; }
      }
      moveDrone(d, tx, ty, v, sdt);
      const mx = d.x - d.sx, my = d.y - d.sy, md = Math.hypot(mx, my), gap = R_FINE * .3;
      if (md >= gap) {
        const n = Math.min(8, Math.floor(md / gap));
        if (d.st !== 'home') for (let q = 1; q <= n; q++) stampFine(d, d.sx + mx * q / n, d.sy + my * q / n);
        d.sx = d.x; d.sy = d.y;
      }
      d.tt += dt; if (d.tt > .07) { d.tt = 0; const o = (d.tn % TRN) * 2; d.trail[o] = d.x; d.trail[o + 1] = d.y; d.tn++; }
    }
    for (const h of Wd.houses) {
      if (h.st !== 1) continue;
      if (h.dr.every((o) => o.st !== 'conf' || Math.hypot(o.x - h.x, o.y - h.y) < 44)) h.clock += sdt;
      if (h.clock > 14 || simT - h.tHit > 60) confirm(h);
    }
    for (const b of B) stepBoat(b, sdt, dt);
    dispT -= dt; if (dispT <= 0) { dispatch(); dispT = .4; }
    if (!saidCur && simT > 40) for (const d of D) if (active(d) && Math.abs(Wd.rdist(d.x, d.y)) < 40 && phase === 'run') { say(P('strong current over the drowned river: boats cross it, never follow it', 'strong current: boats only cross it'), d.x, Wd.riverY(d.x), C.mist, 5); saidCur = 1; break; }
    meshT -= dt; if (meshT <= 0) { mesh(); meshT = .15; }
    betaT -= dt; if (betaT <= 0) { beta0 = betaCount(); betaT = .25; }
    const rescued = queue.length === 0 && !Wd.houses.some((h) => h.st === 1 || (h.st === 2 && h.left > 0));   // st 4: no boat route, handed to a ground team
    if (phase === 'run') {
      if (beta0 === 0 && rescued && !D.some((d) => d.iso && d.pend.length)) {
        phase = 'home'; phaseT = 0; for (const d of D) if (active(d) && d.st !== 'beacon') { d.st = 'home'; d.grp = null; }
        say('nothing left unsearched: β₀ = 0', WM / 2, HM / 2, C.teal, 4);
      } else if (phaseT > 80) { phase = 'home'; phaseT = 0; for (const d of D) if (active(d)) d.st = 'home'; }
    } else if (phase === 'home') {
      for (const d of D) if ((d.st === 'beacon' && !B.some((b) => b.roof === d.grp)) || d.st === 'search' || d.st === 'idle' || d.st === 'conf') { d.st = 'home'; d.grp = null; }
      const boatsIn = B.every((b) => b.st === 'dock' || b.st === 'back' || b.st === 'unload');
      if ((D.every((d) => !active(d)) && boatsIn) || phaseT > 12) {
        phase = 'summary'; phaseT = 0;
        summary = { km2: shrN * CELL * CELL / 1e6, t: simT, roofs: checked, nRoofs, people: found, places: nFound, aboard: safe + B.reduce((a, b) => a + b.cargo, 0), safe, boats: B.filter((b) => b.trips).length };
        job = prep((Wd.sd * 1103 + 12345) % 9973 + 1); jobKind = 'prep';
      }
    }
  }

  // ------------------------------------------------------------ drawing
  const fmtClock = (t) => { const m = Math.floor(t / 60), h = Math.floor(m / 60); return `${h}:${String(m % 60).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
  const placed = new Float32Array(4 * 200); let nPl = 0;
  const keep = (x, y, w, h) => { if (nPl < placed.length) { placed[nPl++] = x; placed[nPl++] = y; placed[nPl++] = w; placed[nPl++] = h; } };
  const free = (x, y, w, h) => {
    if (x < fx0 - 4 || x + w > cv.w - 8 || y < fy0 - 8 || y + h > cv.h - (phone ? 34 : 6)) return false;     // below the HUD lines, above the card
    if (x + w > cv.w - 210 && y + h > cv.h - 74) return false;
    for (let k = 0; k < nPl; k += 4) if (x < placed[k] + placed[k + 2] && placed[k] < x + w && y < placed[k + 1] + placed[k + 3] && placed[k + 1] < y + h) return false;
    return true;
  };
  const OFFS = [[0, 12, -1, -8], [1, -12, -1, -8], [0, 12, 0, 8], [1, -12, 0, 8], [.5, 0, -1, -16], [.5, 0, 0, 14], [0, 16, -.5, 0], [1, -16, -.5, 0]];
  function pill(s2, px0, py0, col, alpha, size) {
    ctx.font = `400 ${size}px ${F.sans}`; const tw = ctx.measureText(s2).width, w = tw + 16, h = size + 10;
    let bx = 0, by = 0, ok = false;
    for (const o of OFFS) { bx = px0 - o[0] * w + o[1]; by = py0 + o[2] * h + o[3]; if (free(bx, by, w, h)) { ok = true; break; } }
    if (!ok) { bx = clamp(px0 + 12, fx0, cv.w - w - 10); by = clamp(py0 - h - 8, fy0 - 8, cv.h - h - (phone ? 36 : 8)); }
    keep(bx, by, w, h);
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = alpha * .55; ctx.beginPath();
    const ax = clamp(px0, bx + 6, bx + w - 6), ay = py0 < by ? by : by + h; ctx.moveTo(px0, py0); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.globalAlpha = alpha; ctx.fillStyle = 'rgba(27,30,61,.88)'; roundRect(ctx, bx, by, w, h, h / 2); ctx.fill();
    text(ctx, s2, bx + 8, by + h / 2 + .5, { size, color: col, base: 'middle' });
    ctx.globalAlpha = 1;
  }
  function droneShape(d, sz) {
    const x = X(d.x), y = Y(d.y), a = d.hd + Math.PI / 4, c0 = Math.cos(a) * sz, s0 = Math.sin(a) * sz;
    ctx.moveTo(x - c0, y - s0); ctx.lineTo(x + c0, y + s0); ctx.moveTo(x + s0, y - c0); ctx.lineTo(x - s0, y + c0);
  }
  function rotors(d, sz, r) {
    const x = X(d.x), y = Y(d.y), a = d.hd + Math.PI / 4, c0 = Math.cos(a) * sz, s0 = Math.sin(a) * sz;
    ctx.moveTo(x - c0 + r, y - s0); ctx.arc(x - c0, y - s0, r, 0, TAU); ctx.moveTo(x + c0 + r, y + s0); ctx.arc(x + c0, y + s0, r, 0, TAU);
    ctx.moveTo(x + s0 + r, y - c0); ctx.arc(x + s0, y - c0, r, 0, TAU); ctx.moveTo(x - s0 + r, y + c0); ctx.arc(x - s0, y + c0, r, 0, TAU);
  }
  function boatShape(b, L) {
    const x = X(b.x), y = Y(b.y), c0 = Math.cos(b.hd), s0 = Math.sin(b.hd), W2 = L * .3;
    ctx.moveTo(x + c0 * L * .6, y + s0 * L * .6);
    ctx.quadraticCurveTo(x + c0 * L * .1 - s0 * W2 * 1.2, y + s0 * L * .1 + c0 * W2 * 1.2, x - c0 * L * .45 - s0 * W2, y - s0 * L * .45 + c0 * W2);
    ctx.lineTo(x - c0 * L * .45 + s0 * W2, y - s0 * L * .45 - c0 * W2);
    ctx.quadraticCurveTo(x + c0 * L * .1 + s0 * W2 * 1.2, y + s0 * L * .1 - c0 * W2 * 1.2, x + c0 * L * .6, y + s0 * L * .6);
    ctx.closePath();
  }
  let hover = null, hoverT = 0;
  const dbg = { nofog: false };
  const causP = ctx.createPattern(RIP, 'repeat'), caus2P = ctx.createPattern(RIP2, 'repeat'), cloudP = ctx.createPattern(CLOUD, 'repeat');
  function draw() {
    const W = cv.w, H = cv.h, t = wallT;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    if (phase === 'regen') return;                                        // a short black hold while the next plain is drawn
    ctx.drawImage(TC, 0, 0, W, H);
    // live water: two caustic layers drifting against each other, then the current streaks
    ctx.save(); ctx.globalAlpha = .3 + .1 * Math.sin(t * .8); ctx.fillStyle = causP; ctx.translate(-((t * 6) % 256), (t * 1.5) % 256); ctx.fillRect(0, -256, W + 512, H + 512); ctx.restore();
    ctx.save(); ctx.globalAlpha = .22 + .1 * Math.sin(t * .6 + 2); ctx.fillStyle = caus2P; ctx.translate((t * 3.5) % 358.4, -((t * 2.2) % 358.4)); ctx.scale(1.4, 1.4); ctx.fillRect(-256, 0, W / 1.4 + 512, H / 1.4 + 512); ctx.restore();
    for (let band = 0; band < 2; band++) {
      ctx.beginPath();
      for (let q = band; q < NP; q += 2) {
        const a = PA[q] / PL[q]; if (a < .08 || a > .92) continue;
        const x1 = X(PX[q]), y1 = Y(PY[q]), dx = x1 - X(PQ[q * 2]), dy = y1 - Y(PQ[q * 2 + 1]), L = Math.hypot(dx, dy); if (L < .05) continue;
        const k = Math.min(18, 1.5 + L * 9) / L; ctx.moveTo(x1, y1); ctx.lineTo(x1 - dx * k, y1 - dy * k);
      }
      ctx.strokeStyle = band ? 'rgba(226,238,244,.42)' : 'rgba(226,238,244,.24)'; ctx.lineWidth = band ? 1.2 : 1; ctx.lineCap = 'round'; ctx.stroke();
    }
    // boat wakes: a widening V behind each boat
    for (const b of B) {
      let n = 0; while (n < Math.min(WK, b.wn) && t - b.wake[((b.wn - 1 - n) % WK) * 3 + 2] < 1.5) n++;   // only the last 1.5 s of track
      if (n < 3) continue;
      for (const sg of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(X(b.x), Y(b.y));
        for (let q = 0; q < n - 1; q++) {
          const i0 = ((b.wn - 1 - q) % WK) * 3, j0 = ((b.wn - 2 - q) % WK) * 3, age = (t - b.wake[i0 + 2]) / 1.5;
          const dx = b.wake[i0] - b.wake[j0], dy = b.wake[i0 + 1] - b.wake[j0 + 1], dl = Math.hypot(dx, dy) || 1, off = 1.5 + age * 9;
          ctx.lineTo(X(b.wake[i0]) - dy / dl * off * sg, Y(b.wake[i0 + 1]) + dx / dl * off * sg);
        }
        ctx.strokeStyle = 'rgba(232,240,246,.4)'; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(X(b.x), Y(b.y)); for (let q = 0; q < Math.min(n, 9); q++) { const i0 = ((b.wn - 1 - q) % WK) * 3; ctx.lineTo(X(b.wake[i0]), Y(b.wake[i0 + 1])); }
      ctx.strokeStyle = 'rgba(240,246,250,.5)'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.drawImage(OBJ, 0, 0, W, H);
    ctx.save(); ctx.globalAlpha = .35; ctx.fillStyle = cloudP; ctx.translate((t * 10) % 512, (t * 3) % 512); ctx.scale(4, 4); ctx.fillRect(-128, -128, W / 4 + 256, H / 4 + 256); ctx.restore();
    if (!dbg.nofog) {
      ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = .9; ctx.drawImage(U, 0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = .5; ctx.drawImage(U, 0, 0, W, H); ctx.globalAlpha = 1;
    }
    polyPath(ctx); ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(220,228,238,.42)'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    nPl = 0;
    // roofs checked: a faint teal tick of outline that fades in
    {
      const hk = Math.max(s * 1.15, phone ? .26 : .38);
      ctx.beginPath();
      for (const h of Wd.houses) {
        if (!h.chk || h.n) continue;
        const l = h.l * hk / 2 + 1.5, wd = h.w * hk / 2 + 1.5, c0 = Math.cos(h.a), s0 = Math.sin(h.a), Xc = X(h.x), Yc = Y(h.y);
        ctx.moveTo(Xc + c0 * l - s0 * wd, Yc + s0 * l + c0 * wd); ctx.lineTo(Xc - c0 * l - s0 * wd, Yc - s0 * l + c0 * wd); ctx.lineTo(Xc - c0 * l + s0 * wd, Yc - s0 * l - c0 * wd); ctx.lineTo(Xc + c0 * l + s0 * wd, Yc + s0 * l - c0 * wd); ctx.closePath();
      }
      ctx.strokeStyle = 'rgba(127,212,207,.42)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // live lines the swarm has found
    for (const hz of Wd.hazards) {
      if (!hz.known) continue;
      const a = smooth(0, .5, t - hz.tk), x0 = X(hz.x0), y0 = Y(hz.y0), x1 = X(hz.x1), y1 = Y(hz.y1);
      ctx.globalAlpha = a * .16; ctx.strokeStyle = C.danger; ctx.lineWidth = Math.max(6, 68 * s); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.globalAlpha = a; ctx.lineWidth = 1.4; ctx.setLineDash([3, 3]); ctx.lineDashOffset = -t * 6; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + 3, (y0 + y1) / 2 + 5, x1, y1); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      // a little lightning mark
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - 9; ctx.fillStyle = C.danger; ctx.beginPath(); ctx.moveTo(mx + 1, my - 5); ctx.lineTo(mx - 3, my + 1); ctx.lineTo(mx, my + 1); ctx.lineTo(mx - 1, my + 5); ctx.lineTo(mx + 3, my - 1); ctx.lineTo(mx, my - 1); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1; keep(Math.min(x0, x1) - 4, Math.min(y0, y1) - 12, Math.abs(x1 - x0) + 8, Math.abs(y1 - y0) + 16);
    }
    // remaining unsearched pieces, numbered
    if (phase === 'run' && beta0 > 0 && beta0 <= 6 && shrN > polyN * .75) {
      patches.forEach(([x, y], q) => {
        const Xs = X(x), Ys = Y(y), pulse = .5 + .5 * Math.sin(t * 3 + q);
        ctx.fillStyle = `rgba(143,140,196,${.18 + .12 * pulse})`; ctx.beginPath(); ctx.arc(Xs, Ys, 10, 0, TAU); ctx.fill();
        ctx.fillStyle = C.haze; ctx.beginPath(); ctx.arc(Xs, Ys, 6.5, 0, TAU); ctx.fill();
        text(ctx, String(q + 1), Xs, Ys + .5, { size: 9.5, color: '#1E2140', weight: 600, align: 'center', base: 'middle' });
        keep(Xs - 10, Ys - 10, 20, 20);
      });
    }
    // routes the swarm computed: dotted teal paths marching toward the goal
    ctx.setLineDash([2, 5]); ctx.lineDashOffset = -t * 14; ctx.lineCap = 'round';
    for (const b of B) {
      if ((b.st !== 'out' && b.st !== 'back') || b.pn < 4) continue;
      ctx.beginPath(); ctx.moveTo(X(b.x), Y(b.y));
      for (let q = b.pi + 2; q < b.pn; q += 2) ctx.lineTo(X(b.path[q]), Y(b.path[q + 1]));
      ctx.strokeStyle = b.st === 'out' ? 'rgba(127,212,207,.85)' : 'rgba(246,210,177,.55)'; ctx.lineWidth = 1.8; ctx.stroke();
    }
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    // the camp
    {
      const cx0 = X(Wd.camp[0]), cy0 = Y(Wd.camp[1]), up = Wd.jetty[1] > Wd.camp[1], ly = cy0 + (up ? -(phone ? 14 : 20) : (phone ? 20 : 28));   // label on the side away from the jetty
      text(ctx, 'relief camp', cx0, ly, { size: 11, color: C.apricot, align: 'center' }); keep(cx0 - 34, ly - 12, 68, 16);
    }
    // people on roofs
    for (const h of Wd.houses) {
      if (h.st === 0 || h.st === 3) continue;
      const Xs = X(h.x), Ys = Y(h.y);
      if (h.st === 1) {
        const p = (t * 1.6) % 1;
        ctx.strokeStyle = C.heat; ctx.globalAlpha = 1 - p; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(Xs, Ys, 6 + p * 20, 0, TAU); ctx.stroke(); ctx.globalAlpha = .7; ctx.drawImage(GLOW_H, Xs - 12, Ys - 12, 24, 24); ctx.globalAlpha = 1;
      } else if (h.st === 2 || h.st === 4) {
        const a = smooth(0, .6, t - h.tConf), R = 17 + 2.5 * Math.sin(t * 2.2 + h.no), n = h.left;
        ctx.globalAlpha = a; ctx.drawImage(GLOW_H, Xs - R, Ys - R, 2 * R, 2 * R);
        ctx.fillStyle = '#FFE6BF'; ctx.strokeStyle = '#FFE6BF'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let q = 0; q < n; q++) {
          const ang = q * 2.4 + h.no, rr = n > 1 ? 2.6 + (q % 3) * 1.4 : 0, x = Xs + Math.cos(ang) * rr, y = Ys + Math.sin(ang) * rr;
          ctx.moveTo(x + 1.4, y); ctx.arc(x, y, 1.4, 0, TAU);
        }
        ctx.fill();
        ctx.beginPath();                                                    // two of them wave
        for (let q = 0; q < Math.min(2, n); q++) { const ang = q * 2.4 + h.no, rr = n > 1 ? 2.6 + (q % 3) * 1.4 : 0, x = Xs + Math.cos(ang) * rr, y = Ys + Math.sin(ang) * rr, w2 = Math.sin(t * 9 + q * 2) * .8; ctx.moveTo(x + .8, y - .8); ctx.lineTo(x + .8 + Math.sin(w2) * 3.2, y - .8 - Math.cos(w2) * 3.2); }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      keep(Xs - 12, Ys - 12, 24, 24);
    }
    // boats: hull, a dark rim, people aboard
    const BL = phone ? 7.5 : clamp(30 * s, 9, 13);
    ctx.beginPath(); for (const b of B) boatShape(b, BL);
    ctx.fillStyle = C.apricot; ctx.strokeStyle = 'rgba(30,26,48,.75)'; ctx.lineWidth = 1.6; ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#FFC36B';
    for (const b of B) { if (!b.cargo) continue; ctx.beginPath(); const n = Math.min(6, Math.ceil(b.cargo / 2)); for (let q = 0; q < n; q++) { const off = (q - (n - 1) / 2) * 1.8, x = X(b.x) + Math.cos(b.hd) * off, y = Y(b.y) + Math.sin(b.hd) * off; ctx.moveTo(x + 1, y); ctx.arc(x, y, 1, 0, TAU); } ctx.fill(); }
    for (const b of B) keep(X(b.x) - 8, Y(b.y) - 8, 16, 16);
    // beacons: a drone over the roof with a slow teal ring for the boat to home on
    for (const d of D) if (d.st === 'beacon') { const p = (t * .9 + d.k * .3) % 1; ctx.strokeStyle = C.teal; ctx.globalAlpha = (1 - p) * .8; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(X(d.x), Y(d.y), 5 + p * 18, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
    // mesh links
    ctx.beginPath();
    for (let q = 0; q < nLinks; q++) { if (!linkShow[q]) continue; const a = D[links[q * 2]], b = D[links[q * 2 + 1]]; if (!active(a) || !active(b)) continue; ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); }
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(127,212,207,.45)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    // drones
    const sz = phone ? 3.6 : 5;
    for (const d of D) { if (!active(d)) continue; ctx.globalAlpha = d.iso ? .25 : .7; ctx.drawImage(GLOW_T, X(d.x) - 16, Y(d.y) - 16, 32, 32); }
    ctx.globalAlpha = 1;
    for (let band = 0; band < 3; band++) {
      ctx.beginPath();
      for (const d of D) {
        if (!active(d) || d.tn < 2) continue;
        const n = Math.min(TRN, d.tn), seg = Math.ceil(n / 3), from = band * seg, to = Math.min(n - 1, from + seg);
        for (let q = from; q <= to; q++) { const idx = ((d.tn - n + q) % TRN) * 2, x = X(d.trail[idx]), y = Y(d.trail[idx + 1]); if (q === from) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        if (band === 2) ctx.lineTo(X(d.x), Y(d.y));
      }
      ctx.strokeStyle = `rgba(127,212,207,${[.1, .22, .4][band]})`; ctx.lineWidth = 1.4; ctx.stroke();
    }
    for (const dim of [true, false]) {
      ctx.beginPath(); for (const d of D) if (active(d) && d.iso === dim) droneShape(d, sz);
      ctx.strokeStyle = 'rgba(20,22,46,.8)'; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.globalAlpha = dim ? .5 : 1; ctx.stroke();
      ctx.strokeStyle = C.teal; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); for (const d of D) if (active(d) && d.iso === dim) rotors(d, sz, 1.7);
      ctx.fillStyle = 'rgba(20,22,46,.85)'; ctx.fill(); ctx.strokeStyle = C.teal; ctx.lineWidth = 1.1; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const d of D) if (active(d)) keep(X(d.x) - 7, Y(d.y) - 7, 14, 14);
    for (let q = notes.length - 1; q >= 0; q--) {
      const n = notes[q], age = t - n.t0; if (age > n.dur) continue;
      pill(n.s, X(n.x), Y(n.y), n.col, Math.min(1, age / .3) * Math.min(1, (n.dur - age) / .6), phone ? 10.5 : 12);
    }
    while (notes.length && t - notes[0].t0 > notes[0].dur) notes.shift();
    hud(W, H);
    if (hover && t - hoverT < 3) tooltip(W, H);
    if (phase === 'summary' || phase === 'fade') drawSummary(W, H);
    let fade = 0;
    if (phase === 'run' && phaseT < .9) fade = 1 - phaseT / .9;
    if (phase === 'fade') fade = Math.min(1, phaseT / .9);
    if (fade > 0) { ctx.globalAlpha = fade; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }
  function tooltip(W, H) {
    let s2 = '', x = 0, y = 0;
    if (hover.kind === 'boat') {
      const b = hover.o; x = X(b.x); y = Y(b.y);
      s2 = b.st === 'out' ? `boat ${b.id}: to ${b.roof.kind ? 'the ' + b.roof.kind : 'roof ' + b.roof.no}, following the swarm's route` : b.st === 'back' ? `boat ${b.id}: ${b.cargo} aboard, back to camp` : b.st === 'load' ? `boat ${b.id}: taking people aboard` : `boat ${b.id}: at the camp`;
    } else {
      const d = hover.o; if (!active(d)) return; x = X(d.x); y = Y(d.y);
      const dist = d.tb >= 0 ? Math.round(Math.hypot(d.tx - d.x, d.ty - d.y)) : 0;
      s2 = `drone ${d.id}: ` + (d.st === 'conf' ? 'confirming a find' : d.st === 'beacon' ? 'beacon over a roof for a boat' : d.st === 'home' ? 'returning to camp' : d.iso ? 'out of range, searching alone' : d.st === 'idle' ? 'waiting for a frontier' : `frontier, ${dist} m`);
      ctx.strokeStyle = 'rgba(127,212,207,.45)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(x, y, R_FINE * s, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.font = `400 11.5px ${F.sans}`; const tw = ctx.measureText(s2).width;
    const bx = clamp(x + 10, 6, W - tw - 22), by = clamp(y - 30, 74, H - 30);
    ctx.fillStyle = 'rgba(27,30,61,.94)'; roundRect(ctx, bx, by, tw + 16, 22, 11); ctx.fill(); ctx.strokeStyle = 'rgba(127,212,207,.5)'; ctx.lineWidth = 1; ctx.stroke();
    text(ctx, s2, bx + 8, by + 11.5, { size: 11.5, color: C.ink, base: 'middle' });
  }
  function status() {
    if (phase === 'home') return [C.teal, phone ? 'Nothing left unsearched: back to camp' : 'Nothing left unsearched (β₀ = 0) and everyone found is aboard'];
    if (Wd.houses.some((h) => h.st === 1)) return [C.heat, phone ? 'Heat on a roof: drones gather to confirm' : 'Heat on a roof: two drones gather and confirm with the camera'];
    if (B.some((b) => b.st === 'out')) return [C.apricot, phone ? 'Boats follow the route the swarm maps' : 'Boats follow routes the swarm maps around live lines and current'];
    return [C.teal, phone ? 'A wide front checks every roof' : 'A wide front of drones spreads over the flood, checking every roof'];
  }
  function hud(W, H) {
    const b0s = B0S.update(beta0, phase === 'run' ? simT : 0);
    if (phase === 'summary' || phase === 'fade') return;
    const [col, msg] = status(), y1 = phone ? 86 : 92, y2 = phone ? 103 : 111;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(fx0 + 4, y1 - 4.5, 3.6, 0, TAU); ctx.fill();
    text(ctx, msg, fx0 + 14, y1, { size: phone ? 12 : 13.5, color: C.ink, weight: 500 });
    text(ctx, phone ? 'outdoor: 2.5-D grid, 5 m cells, GPS on, boats steered' : 'outdoor mode: 2.5-D grid, 5 m cells, GPS on, boats steered by the swarm', fx0 + 14, y2, { size: phone ? 10.5 : 11.5, color: C.faint });
    if (phone) {
      const y3 = 119; text(ctx, 'unsearched patches (β₀)', fx0 + 14, y3, { size: 10.5, color: C.muted });
      ctx.font = `400 10.5px ${F.sans}`; const lw2 = ctx.measureText('unsearched patches (β₀)').width;
      text(ctx, b0s, fx0 + 20 + lw2, y3 + .5, { size: 13, color: b0s === '0' ? C.teal : b0s === '…' ? C.muted : '#B4B1E0', font: F.mono, weight: 500 });
      text(ctx, `${fmtClock(simT)} · ×${TL}`, fx1, y3, { size: 10.5, color: C.faint, font: F.mono, align: 'right' });
      scaleBar(fx0 + 4, H - 38);
    } else {
      text(ctx, b0s, fx1, y1 + 1, { size: 17, color: b0s === '0' ? C.teal : b0s === '…' ? C.muted : '#B4B1E0', font: F.mono, weight: 500, align: 'right' });
      ctx.font = `500 17px ${F.mono}`; const nw = ctx.measureText(b0s).width;
      text(ctx, 'unsearched patches (β₀)', fx1 - nw - 8, y1, { size: 12, color: C.muted, align: 'right' });
      text(ctx, `${fmtClock(simT)} sim · time-lapse ×${TL}`, fx1, y2, { size: 11.5, color: C.faint, font: F.mono, align: 'right' });
      const xe = scaleBar(fx0, H - 14);
      let out = 0; for (const b of B) if (b.st !== 'dock') out++;
      text(ctx, `roofs checked ${checked} of ${nRoofs} · boats out ${out} · at the camp ${safe}`, xe + 22, H - 14, { size: 11.5, color: C.muted, base: 'middle' });
    }
  }
  function scaleBar(x, y) {
    let m = 200; for (const c of [200, 250, 500, 1000]) if (c * s <= (phone ? 90 : 130)) m = c;
    const L = m * s;
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + L, y); ctx.lineTo(x + L, y - 4); ctx.moveTo(x + L / 2, y); ctx.lineTo(x + L / 2, y - 2.5); ctx.stroke();
    text(ctx, m >= 1000 ? `${m / 1000} km` : `${m} m`, x + L + 7, y + .5, { size: 11, color: C.muted, font: F.mono, base: 'middle' });
    ctx.font = `400 11px ${F.mono}`; const nx = x + L + 18 + ctx.measureText(m >= 1000 ? `${m / 1000} km` : `${m} m`).width; ctx.fillStyle = C.muted; ctx.beginPath(); ctx.moveTo(nx, y - 9); ctx.lineTo(nx + 3.5, y); ctx.lineTo(nx, y - 2.5); ctx.lineTo(nx - 3.5, y); ctx.closePath(); ctx.fill();
    text(ctx, 'N', nx + 7, y - 3, { size: 10, color: C.faint, base: 'middle' });
    return nx + 14;
  }
  function drawSummary(W, H) {
    if (!summary) return;
    const a = phase === 'summary' ? smooth(0, .5, phaseT) : 1, S = summary;
    const pw = phone ? Math.min(W - 24, 340) : 410, rows = [
      [C.teal, `${S.km2.toFixed(2)} km²`, 'of floodwater searched; nothing left unsearched (β₀ = 0)'],
      [C.mist, String(S.roofs), `roofs checked by thermal camera, of ${S.nRoofs} in the search area`],
      [C.heat, String(S.people), `people found on ${S.places} roofs`],
      [C.apricot, String(S.aboard), `picked up by ${S.boats} boats, each on a route the swarm mapped${S.safe < S.aboard ? `; ${S.safe} already at the camp` : ''}`],
      [C.muted, fmtClock(S.t), `of flight for ${NDR} drones, time-lapse ×${TL}`],
    ];
    const lh = phone ? 38 : 42, ph = 64 + rows.length * lh, cx = (fx0 + fx1) / 2, cy = (fy0 + fy1) / 2, x0 = clamp(cx - pw / 2, fx0, W - pw - 12), y0 = clamp(cy - ph / 2, 76, H - ph - 80);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(27,30,61,.92)'; roundRect(ctx, x0, y0, pw, ph, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(220,214,236,.14)'; ctx.lineWidth = 1; ctx.stroke();
    text(ctx, 'Flood plain searched', x0 + 20, y0 + 34, { size: phone ? 17 : 20, color: C.ink, font: F.serif });
    rows.forEach(([col, big, small], q) => {
      const yy = y0 + 66 + q * lh;
      text(ctx, big, x0 + 20, yy, { size: phone ? 15 : 17, color: col, font: F.mono, weight: 500 });
      wrap(small, x0 + (phone ? 108 : 122), yy - 5, pw - (phone ? 124 : 140), phone ? 11 : 12);
    });
    ctx.globalAlpha = 1;
  }
  function wrap(s2, x, y, w, size) {
    ctx.font = `400 ${size}px ${F.sans}`; const words = s2.split(' '); let line = ''; const lines = [];
    for (const wd of words) { const tt = line ? line + ' ' + wd : wd; if (ctx.measureText(tt).width > w && line) { lines.push(line); line = wd; } else line = tt; }
    lines.push(line);
    const top = y - (lines.length - 1) * (size + 3) / 2;
    lines.forEach((l, q) => text(ctx, l, x, top + q * (size + 3), { size, color: C.muted, base: 'middle' }));
  }

  // ------------------------------------------------------------ pointer
  const pick = (e) => {
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = null, bd = (e.pointerType === 'mouse' ? 14 : 24) ** 2;
    for (const d of D) { if (!active(d)) continue; const q = (X(d.x) - x) ** 2 + (Y(d.y) - y) ** 2; if (q < bd) { bd = q; best = { kind: 'drone', o: d }; } }
    for (const b of B) { const q = (X(b.x) - x) ** 2 + (Y(b.y) - y) ** 2; if (q < bd) { bd = q; best = { kind: 'boat', o: b }; } }
    return best;
  };
  const onMove = (e) => { if (e.pointerType !== 'mouse') return; const d = pick(e); if (d) { hover = d; hoverT = wallT; } el.style.cursor = d ? 'help' : ''; };
  const onDown = (e) => { const d = pick(e); if (d) { hover = d; hoverT = wallT; } };
  const onLeave = () => { hover = null; el.style.cursor = ''; };
  el.addEventListener('pointermove', onMove); el.addEventListener('pointerdown', onDown); el.addEventListener('pointerleave', onLeave);

  // ------------------------------------------------------------ readouts, layout changes, loop
  const rA = kit.readout(readouts, { label: 'Area searched', tone: 'teal' });
  const rR = kit.readout(readouts, { label: 'Roofs checked', tone: 'ink' });
  const rP = kit.readout(readouts, { label: 'People found', tone: 'heat' });
  let lw0 = 0, lh0 = 0;
  function relayout() {
    layout(); lw0 = cv.w; lh0 = cv.h;
    if (jobKind) {                                                        // a new mission was being built: finish it now and start it
      if (jobKind === 'prep' && job) runSync(job);
      job = null; jobKind = ''; runSync(renderArt(nextW)); Wd = nextW; nextW = null; newMission();
    } else { runSync(renderArt(Wd)); renderFog(); }
    for (let q = 0; q < NP; q++) spawn(q);
  }
  cv.onResize(() => { if (Wd) relayout(); });
  Wd = runSync(gen(3 + Math.floor(Math.random() * 500)));
  layout(); lw0 = cv.w; lh0 = cv.h;
  runSync(initGrids(Wd)); runSync(renderArt(Wd)); newMission();
  for (let q = 0; q < NP; q++) { spawn(q); PA[q] = prng() * PL[q]; }
  const loop = kit.loop((dt) => {
    if ((parseFloat(stage.dataset.left) || 0) !== leftFrac || cv.w !== lw0 || cv.h !== lh0) relayout();
    // the first frame after a long task can arrive with a timestamp older than start(): never step time backwards
    step(dt > 0 ? Math.min(dt, .05) : 0); draw();
    rA.set(`${(shrN * CELL * CELL / 1e6).toFixed(2)} km²`); rR.set(String(checked)); rP.set(String(found));
  });
  draw();
  return {
    start: loop.start, stop: loop.stop, dbg,
    bench(n = 120) { let a = 0, b = 0; for (let q = 0; q < n; q++) { const t0 = performance.now(); step(1 / 60); const t1 = performance.now(); draw(); a += t1 - t0; b += performance.now() - t1; } return { stepMs: +(a / n).toFixed(3), drawMs: +(b / n).toFixed(3) }; },
    until(ph, max = 120) { for (let q = 0; q < max * 20 && phase !== ph; q++) step(.05); draw(); return { phase, wallT: +wallT.toFixed(1) }; },
    warp(sec) { for (let q = 0; q < sec * 20; q++) step(.05); draw(); return { phase, simT: Math.round(simT), wallT: +wallT.toFixed(1), beta0, checked, nRoofs, found, safe, km2: +(shrN * 25 / 1e6).toFixed(3), nIso, queue: queue.length, boats: B.map((b) => b.st).join(','), mission: missionN }; },
    destroy() { loop.stop(); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerleave', onLeave); cv.destroy(); },
  };
}

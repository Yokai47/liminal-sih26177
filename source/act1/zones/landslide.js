// A hillside after a debris flow (Wayanad, Kerala, 30 July 2024: Mundakkai and Chooralmala).
// Top-down, outdoor mode: a 2.5-D grid of 4 m cells inside a search polygon, thermal camera first, GPS on.
// The terrain is an fbm heightmap with hillshade and contours: a river valley, tea rows on the slopes, forest on the
// ridges, two villages along the road, and a long tongue of mud and boulders that came down the valley and buried part
// of both. The swarm carries the pre-disaster map, so three scouts fly the flow first and compare: every house that is in
// the old map but under mud now becomes a dashed ghost outline (the change map), and the fine thermal search goes there
// first. Then the drones sweep the slopes in evenly spaced lanes (each picks the best unsearched block that no neighbour
// on its mesh has claimed; no assignments), flag thermal hits, gather to confirm, and stop when no unsearched patch is
// left (β₀ of the unsearched region = 0). A drone that loses radio behind a ridge keeps searching on its own and its
// cells merge into the shared map when it reconnects.
export default function mount({ stage, controls, readouts, kit }) {
  const B0S = kit.stableCount();   // calm display of the β₀ counter
  const { C, F, text, roundRect, clamp } = kit;
  const cv = kit.canvas(stage), ctx = cv.ctx, el = cv.cv;
  el.style.touchAction = 'pan-y';
  const TAU = Math.PI * 2;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ------------------------------------------------------------ world and swarm constants (metres, sim seconds)
  const WM = 1300, HM = 1200, CELL = 4, GW = WM / CELL, GH = HM / CELL, NC = GW * GH;
  const BS = 10, BW = Math.ceil(GW / BS), BH = Math.ceil(GH / BS), NB = BW * BH;      // 40 m planning blocks
  const R_FINE = 30, R_SCOUT = 90, TL = 8, V_FINE = 10, V_SCOUT = 16, ALT = 60, RADIO = 680, DONE = .07;
  const NDR = 18, NSC = 3;

  // ------------------------------------------------------------ value noise
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
  // a seamless tile of soft blobs (drifting cloud shadow and valley mist)
  function blobTile(sd, N, P0, rgb, lo, hi) {
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
      const o = (y * N + x) * 4; px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255 * smooth(lo, hi, s / t);
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
  const CLOUD = blobTile(5, 128, 4, [24, 24, 52], .5, .8), MIST = blobTile(9, 128, 4, [214, 220, 236], .55, .85);

  // ------------------------------------------------------------ the mission's world (y grows downhill, to the bottom of the map)
  const YT0 = -500, YT1 = HM + 500, YST = 2, NY = Math.round((YT1 - YT0) / YST) + 1;
  const look = (T, y) => { let f = (y - YT0) / YST; if (f <= 0) return T[0]; if (f >= NY - 1) return T[NY - 1]; const i = f | 0; f -= i; return T[i] + (T[i + 1] - T[i]) * f; };
  const inPolyW = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  let Wd = null;
  // world, grids and art are generators: the next mission is built in small slices (a few ms per frame) during the
  // summary and a short black hold, so no frame ever blocks; at first mount and on resize they simply run to the end
  const runSync = (it) => { let r; do { r = it.next(); } while (!r.done); return r.value; };
  function* gen(sd) {
    const r = kit.rng(sd * 7919 + 17);
    const tCX = new Float32Array(NY), tSL = new Float32Array(NY), tFC = new Float32Array(NY), tWL = new Float32Array(NY), tWR = new Float32Array(NY), tRX = new Float32Array(NY), tRD = new Float32Array(NY);
    const nA = noise2(sd * 31 + 1), nB = noise2(sd * 57 + 2), nC = noise2(sd * 83 + 3), nD = noise2(sd * 101 + 4);
    const a0 = WM * (.52 + (r() - .5) * .08), a1 = 55 + r() * 55, f1 = 1 / (320 + r() * 140), p1 = r() * TAU, tilt = (r() - .5) * .26, p2 = r() * TAU;
    const scarY = 80 + r() * 30, side = r() < .5 ? -1 : 1, scarOff = 165 + r() * 45;
    const yb = 770 + r() * 90, rsd = r() < .5 ? -1 : 1;                   // the bridge, and the bank the road starts on
    const prof = [[scarY - 48, 0], [scarY - 10, 78], [scarY + 40, 74], [scarY + 140, 50], [330, 112], [520, 158], [690, 90], [860, 148], [1030, 128], [1190, 84], [1700, 64]];
    for (const p of prof) p[1] *= .86 + r() * .28;
    const hwAt = (y) => {
      if (y <= prof[0][0]) return 0;
      for (let i = 1; i < prof.length; i++) if (y <= prof[i][0]) { const [y0, w0] = prof[i - 1], [y1, w1] = prof[i], t = (y - y0) / (y1 - y0); return i === 1 ? w1 * Math.sqrt(t) : w0 + (w1 - w0) * smooth(0, 1, t); }
      return prof[prof.length - 1][1];
    };
    for (let i = 0; i < NY; i++) {
      const y = YT0 + i * YST, c = a0 + a1 * Math.sin(y * f1 + p1) + tilt * (y - HM / 2) + 20 * Math.sin(y / 110 + p2), hw = hwAt(y);
      tCX[i] = c;
      tRX[i] = c + 14 * Math.sin(y / 64 + p2) + 6 * Math.sin(y / 23 + p1);
      tFC[i] = c + side * scarOff * Math.exp(-(((y - scarY) / 175) ** 2));
      tWL[i] = hw * (.78 + .44 * nC(y / 80, 1.7)); tWR[i] = hw * (.78 + .44 * nC(y / 80, 6.3));
      tRD[i] = rsd * (70 + 14 * Math.sin(y / 130 + p1)) * (1 - 2 * smooth(yb - 45, yb + 45, y));
    }
    for (let i = 0; i < NY; i++) tSL[i] = (tCX[Math.min(NY - 1, i + 2)] - tCX[Math.max(0, i - 2)]) / (4 * YST);
    yield;
    const flowE = (x, y) => { const c = look(tFC, y), l = look(tWL, y), q = look(tWR, y); if (l + q < .5) return -999; return Math.min(x - (c - l), (c + q) - x); };
    const riverX = (y) => look(tRX, y), roadX = (y) => look(tCX, y) + look(tRD, y);
    const cdist = (x, y) => { const sl = look(tSL, y); return (x - look(tCX, y)) / Math.sqrt(1 + sl * sl); };
    // tributary gullies run down the valley walls and join the river at an angle pointing downstream (herringbone)
    const gully = (x, y, ad) => { const v = .5 + .5 * Math.cos(TAU * ((y + .45 * ad) / 250 + 1.1 * (nB.fbm(x / 300, y / 300, 3) - .5))); return v * v * v; };
    const height = (x, y) => {
      const d = cdist(x, y), ad = Math.abs(d), rel = smooth(30, 360, ad);
      let h = 880 + (HM - y) * .16 + 290 * (1 - Math.exp(-(d * d) / 230400)) + .04 * ad;
      h += (nA.fbm(x / 620, y / 620, 4) - .5) * 260 * rel;
      h -= 48 * gully(x, y, ad) * smooth(50, 260, ad);
      const sx = look(tCX, scarY) + side * scarOff, dx = (x - sx) / 95, dy = (y - scarY - 12) / 80;
      h -= 30 * Math.exp(-(dx * dx + dy * dy));                          // the scar: the slope that gave way is a scooped bowl
      const fe = flowE(x, y), keep = 1 - .85 * smooth(-8, 24, fe);         // the deposit smooths the small relief away
      h += keep * (nD.fbm(x / 120, y / 120, 3) - .5) * 24 * smooth(15, 120, ad);
      return h;
    };
    const grad = (x, y) => [(height(x + 4, y) - height(x - 4, y)) / 8, (height(x, y + 4) - height(x, y - 4)) / 8];
    const landUse = (x, y, h, ad, slope) => {             // 0 valley floor, 1 tea, 2 forest, 3 scrub
      const n = nC.fbm(x / 260 + 11, y / 260 + 3, 3), m = nD(x / 70 + 2, y / 70), rel = h - 880 - (HM - y) * .16;
      if (ad < 88 + 26 * m) return 0;
      if (rel > 340 + 40 * m || n > .63 || slope > 1.25 || (ad > 220 && gully(x, y, ad) > .86 + .08 * m)) return 2;
      if (rel > 300 + 40 * m || n > .595 || rel < 22) return 3;
      return 1;
    };
    // the search polygon: a ring of jittered points just inside the map box
    const poly = [[40, 46], [WM * .5, 16], [WM - 46, 38], [WM - 18, HM * .46], [WM - 40, HM - 52], [WM * .56, HM - 16], [52, HM - 40], [18, HM * .5]]
      .map(([x, y]) => [clamp(x + (r() - .5) * 46, 6, WM - 6), clamp(y + (r() - .5) * 34, 6, HM - 6)]);
    // houses: two villages along the road, a few homesteads elsewhere, estate line houses up on the tea slopes
    const houses = [], vil = [[250 + r() * 60, 600 + r() * 60, 'Mundakkai'], [Math.max(yb - 50, 800), 1190, 'Chooralmala']];
    const spaced = (x, y, sp) => { for (const h of houses) if ((h.x - x) ** 2 + (h.y - y) ** 2 < sp * sp) return false; return true; };
    // village houses sit on both banks, from the river out onto the lower slopes; the flow took the inner ones
    for (let t = 0; t < 6000 && houses.length < 100; t++) {
      if ((t & 63) === 0) yield;
      const y = -150 + r() * (HM + 300); let dens = .05;
      for (const v of vil) if (y > v[0] && y < v[1]) dens = 1;
      if (r() > dens) continue;
      const sg = r() < .5 ? -1 : 1, edge = look(tFC, y) + sg * (sg < 0 ? look(tWL, y) : look(tWR, y)), x = edge + sg * (-62 + r() * 240);
      if (Math.abs(x - riverX(y)) < 22 || !spaced(x, y, 17)) continue;
      const g = grad(x, y); if (Math.hypot(g[0], g[1]) > .5) continue;
      const rs = (look(tCX, y + 3) + look(tRD, y + 3) - roadX(y - 3)) / 6, ang = Math.atan2(1, rs) + (r() < .5 ? 0 : Math.PI / 2) + (r() - .5) * .3;
      const q = r(); houses.push({ x, y, w: 7 + r() * 2.5, l: 9 + r() * 4, a: ang, col: q < .52 ? 0 : q < .76 ? 1 : q < .94 ? 3 : 2, line: false });
    }
    for (let t = 0, made = 0; t < 400 && made < 5; t++) {
      if ((t & 31) === 0) yield;
      const x = -150 + r() * (WM + 300), y = r() * HM, d = Math.abs(cdist(x, y));
      if (d < 200 || d > 520) continue;
      const h = height(x, y), g = grad(x, y), sl = Math.hypot(g[0], g[1]);
      if (sl > .55 || landUse(x, y, h, d, sl) !== 1 || !spaced(x, y, 60)) continue;
      houses.push({ x, y, w: 7, l: 20 + r() * 6, a: Math.atan2(g[1], g[0]) + Math.PI / 2, col: 0, line: true }); made++;
    }
    let nBuried = 0;
    for (const h of houses) { h.buried = flowE(h.x, h.y) > 1; h.inP = inPolyW(h.x, h.y, poly); h.loc = 0; h.tl = 0; if (h.buried && h.inP) nBuried++; }
    // base: downstream, beside the flow
    const yB = HM - 80, fcB = look(tFC, yB);
    let base = [fcB + look(tWR, yB) + 110, yB];
    if (!inPolyW(base[0], base[1], poly) || Math.abs(cdist(base[0], yB)) > 260) base = [fcB - look(tWL, yB) - 110, yB];
    // people: at the flow's edge beside houses that survived, and cut off on the slopes
    const groups = [], farFrom = (x, y, d) => Math.hypot(x - base[0], y - base[1]) > 380 && groups.every((g) => Math.hypot(g.x - x, g.y - y) > d);
    const edge = houses.filter((h) => !h.buried && h.inP && flowE(h.x, h.y) > -55 && flowE(h.x, h.y) < -8);
    for (let t = 0; t < 60 && groups.length < 2 && edge.length; t++) {
      const h = edge[(r() * edge.length) | 0], x = h.x + (r() - .5) * 8, y = h.y + (r() - .5) * 8;
      if (farFrom(x, y, 260) && inPolyW(x, y, poly)) groups.push({ x, y, n: groups.length ? 1 : 2, kind: 'edge' });
    }
    yield;
    for (let t = 0; t < 400 && groups.length < 4; t++) {
      const x = 40 + r() * (WM - 80), y = 60 + r() * (HM - 140), d = Math.abs(cdist(x, y));
      if (d < 230 || d > 540 || flowE(x, y) > -120 || !inPolyW(x, y, poly) || !farFrom(x, y, 300)) continue;
      groups.push({ x, y, n: r() < .5 ? 2 : 1, kind: 'slope' });
    }
    for (const g of groups) { g.st = 0; g.tHit = 0; g.tConf = 0; g.dr = []; g.clock = 0; }
    // three scouts fly the flow from the base to the scar: left edge, centre line, right edge
    const routes = [-.55, 0, .55].map((u) => {
      const pts = [];
      for (let y = HM - 130; y > scarY; y -= 45) pts.push([look(tFC, y) + u * (u < 0 ? look(tWL, y) : look(tWR, y)), y]);
      pts.push([look(tFC, scarY) + u * 50, scarY - 20]);
      return pts;
    });
    const scar = [look(tFC, scarY), scarY - 30];
    return { sd, height, flowE, riverX, roadX, cdist, landUse, grad, poly, houses, nBuried, groups, base, routes, scar, scarY, yb, vil, side, nD, T: { FC: tFC, WL: tWL, WR: tWR } };
  }

  // ------------------------------------------------------------ coverage grids (shared map, union of all drones, change map)
  const inP = new Uint8Array(NC), tru = new Uint8Array(NC), shr = new Uint8Array(NC), mapd = new Uint8Array(NC), cb = new Int16Array(NC);
  const btot = new Uint16Array(NB), bun = new Uint16Array(NB), bpri = new Uint8Array(NB), bcx = new Float32Array(NB), bcy = new Float32Array(NB);
  const hgrid = new Float32Array(151 * 141);                                 // 10 m height grid for radio line of sight
  let polyN = 0, shrN = 0, truN = 0, located = 0, found = 0;
  for (let c = 0; c < NC; c++) { const i = c % GW, j = (c / GW) | 0; cb[c] = ((j / BS) | 0) * BW + ((i / BS) | 0); }
  function* initGrids(w) {
    tru.fill(0); shr.fill(0); mapd.fill(0); btot.fill(0); bun.fill(0); bpri.fill(0); bcx.fill(0); bcy.fill(0);
    polyN = 0;
    for (let j = 0; j < GH; j++) {
      if ((j & 7) === 0) yield;
      for (let i = 0; i < GW; i++) {
        const c = j * GW + i, v = inPolyW((i + .5) * CELL, (j + .5) * CELL, w.poly) ? 1 : 0;
        inP[c] = v; if (!v) continue;
        polyN++; const b = cb[c]; btot[b]++; bcx[b] += (i + .5) * CELL; bcy[b] += (j + .5) * CELL;
      }
    }
    for (let b = 0; b < NB; b++) { bun[b] = btot[b]; if (btot[b]) { bcx[b] /= btot[b]; bcy[b] /= btot[b]; } }
    for (let j = 0; j < 141; j++) { if ((j & 3) === 0) yield; for (let i = 0; i < 151; i++) hgrid[j * 151 + i] = w.height(i * 10 - 100, j * 10 - 100); }
  }
  const hAt = (x, y) => {
    const fx = clamp((x + 100) / 10, 0, 149.999), fy = clamp((y + 100) / 10, 0, 139.999), i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, c = j * 151 + i;
    return hgrid[c] + (hgrid[c + 1] - hgrid[c]) * u + (hgrid[c + 151] - hgrid[c]) * v + (hgrid[c] - hgrid[c + 1] - hgrid[c + 151] + hgrid[c + 152]) * u * v;
  };
  const blockAt = (x, y) => { const i = Math.floor(x / (CELL * BS)), j = Math.floor(y / (CELL * BS)); return i < 0 || j < 0 || i >= BW || j >= BH ? -1 : j * BW + i; };

  // ------------------------------------------------------------ layout: the action sits right of the card, below the top bar
  let s = 1, ox = 0, oy = 0, phone = false, fx0 = 0, fx1 = 0, fy0 = 0, fy1 = 0, leftFrac = -1;
  const X = (x) => ox + x * s, Y = (y) => oy + y * s;
  function layout() {
    const W = cv.w, H = cv.h; leftFrac = parseFloat(stage.dataset.left) || 0;
    phone = W < 640 || (leftFrac === 0 && W < 900);
    fx0 = leftFrac > 0 ? leftFrac * W + 20 : (phone ? 12 : 24); fx1 = W - (phone ? 12 : 24);
    fy0 = phone ? 124 : 124; fy1 = H - (phone ? 50 : 34);
    s = Math.min((fx1 - fx0) / WM, (fy1 - fy0) / HM);
    ox = fx0 + (fx1 - fx0 - WM * s) / 2; oy = fy0 + (fy1 - fy0 - HM * s) / 2;
  }

  // ------------------------------------------------------------ terrain art: rendered once per mission (and on resize)
  const TC = document.createElement('canvas'), tctx = TC.getContext('2d');
  const LOW = document.createElement('canvas'), lctx = LOW.getContext('2d');
  const U = document.createElement('canvas'), uctx = U.getContext('2d');
  const COV = document.createElement('canvas'); COV.width = GW; COV.height = GH;
  const STEP = 3;
  let LW = 0, LH = 0, HS = null, FE = null, LU = null, SH = null, LIMG = null;
  const COLS = {
    floor: [150, 158, 120], tea: [132, 164, 130], forest: [62, 92, 86], scrub: [138, 144, 120],
    mud: [204, 170, 144], wet: [158, 128, 120], scar: [184, 146, 134], shade: [54, 52, 102], warm: [246, 210, 177],
  };
  const ROOF = ['#B98884', '#D4B094', '#A8A2C2', '#C9CCD6'];
  function* renderTerrain(w) {
    const W = cv.w, H = cv.h, dpr = cv.dpr, g = tctx, rr = kit.rng(w.sd * 13 + 5), tFC = w.T.FC, tWL = w.T.WL, tWR = w.T.WR;
    TC.width = Math.max(2, Math.round(W * dpr)); TC.height = Math.max(2, Math.round(H * dpr));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lw = Math.ceil(W / STEP) + 3, lh = Math.ceil(H / STEP) + 3;
    if (lw !== LW || lh !== LH) { LW = lw; LH = lh; HS = new Float32Array(LW * LH); FE = new Float32Array(LW * LH); LU = new Uint8Array(LW * LH); SH = new Float32Array(LW * LH); LOW.width = LW; LOW.height = LH; LIMG = lctx.createImageData(LW, LH); }
    // sample (i, j) sits at screen ((i - 1) * STEP, (j - 1) * STEP): the grid overhangs every edge by a sample
    for (let j = 0; j < LH; j++) {
      if ((j & 3) === 0) yield;
      const ym = ((j - 1) * STEP - oy) / s;
      for (let i = 0; i < LW; i++) { const xm = ((i - 1) * STEP - ox) / s, c = j * LW + i; HS[c] = w.height(xm, ym); FE[c] = w.flowE(xm, ym); }
    }
    const px = LIMG.data, k = s / (2 * STEP), EX = 1.7, Lx = -.3, Ly = -.72, Lz = .62, Ll = Math.hypot(Lx, Ly, Lz);
    for (let j = 0; j < LH; j++) {
      if ((j & 3) === 0) yield;
      const ym = ((j - 1) * STEP - oy) / s, jm = Math.max(0, j - 1) * LW, jp = Math.min(LH - 1, j + 1) * LW;
      for (let i = 0; i < LW; i++) {
        const c = j * LW + i, xm = ((i - 1) * STEP - ox) / s;
        const hx = (HS[j * LW + Math.min(LW - 1, i + 1)] - HS[j * LW + Math.max(0, i - 1)]) * k, hy = (HS[jp + i] - HS[jm + i]) * k;
        const nx = -hx * EX, ny = -hy * EX, nl = 1 / Math.sqrt(nx * nx + ny * ny + 1), dif = (nx * Lx + ny * Ly + Lz) * nl / Ll;
        const slope = Math.sqrt(hx * hx + hy * hy), ad = Math.abs(w.cdist(xm, ym)), fe = FE[c], mot = w.nD(xm / 22, ym / 22) - .5;
        let col, lum = clamp(.84 + 1.0 * (dif - .6), .32, 1.2);
        if (fe > 0) {
          if (ym < w.scarY + 60) { col = COLS.scar; lum = clamp(.95 + (lum - .84) * .5 + (w.nD(xm / 9, ym / 40) - .5) * .35, .6, 1.25); LU[c] = 8; }
          else {
            const wet = clamp(.25 + .7 * (w.nD(xm / 55 + 9, ym / 55) - .35) + .3 * (1 - smooth(0, 14, fe)), 0, 1);
            col = [COLS.mud[0] + (COLS.wet[0] - COLS.mud[0]) * wet, COLS.mud[1] + (COLS.wet[1] - COLS.mud[1]) * wet, COLS.mud[2] + (COLS.wet[2] - COLS.mud[2]) * wet];
            lum = .9 + (lum - .82) * .55 + mot * .12; LU[c] = 9;
          }
        } else {
          const u = w.landUse(xm, ym, HS[c], ad, slope); LU[c] = u;
          col = u === 0 ? COLS.floor : u === 1 ? COLS.tea : u === 2 ? COLS.forest : COLS.scrub;
          lum += mot * .1;
          if (fe > -14) lum *= .82 + .18 * smooth(-14, 0, -fe);              // a darker wet margin outside the mud
        }
        SH[c] = lum;
        let R = col[0] * lum, G2 = col[1] * lum, B = col[2] * lum;
        const sh = clamp((.84 - lum) * 1.0, 0, .45), hi = clamp((lum - .86) * .7, 0, .32);
        R += (COLS.shade[0] - R) * sh + (COLS.warm[0] - R) * hi; G2 += (COLS.shade[1] - G2) * sh + (COLS.warm[1] - G2) * hi; B += (COLS.shade[2] - B) * sh + (COLS.warm[2] - B) * hi;
        const o = c * 4; px[o] = R * .86; px[o + 1] = G2 * .86; px[o + 2] = B * .9; px[o + 3] = 255;
      }
    }
    lctx.putImageData(LIMG, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(LOW, -1.5 * STEP, -1.5 * STEP, LW * STEP, LH * STEP);

    // marching squares over the sample grid: every level k * step, only in cells that pass the filter
    const iso = function* (step, keep) {
      for (let j = 0; j < LH - 1; j++) for (let i = 0; i < LW - 1; i++) {
        if (i === 0 && (j & 15) === 0) yield;
        const c = j * LW + i; if (!keep(c)) continue;
        const a = HS[c], b = HS[c + 1], d = HS[c + LW], e = HS[c + LW + 1];
        const lo = Math.min(a, b, d, e), hi = Math.max(a, b, d, e), X0 = (i - 1) * STEP, Y0 = (j - 1) * STEP;
        for (let L = Math.ceil(lo / step) * step; L <= hi; L += step) {
          const m = (a > L ? 1 : 0) | (b > L ? 2 : 0) | (e > L ? 4 : 0) | (d > L ? 8 : 0);
          if (m === 0 || m === 15) continue;
          const tx = X0 + (L - a) / (b - a) * STEP, by = Y0 + STEP, bx = X0 + (L - d) / (e - d) * STEP;
          const ly = Y0 + (L - a) / (d - a) * STEP, rx = X0 + STEP, ry = Y0 + (L - b) / (e - b) * STEP;
          switch (m) {
            case 1: case 14: g.moveTo(tx, Y0); g.lineTo(X0, ly); break;
            case 2: case 13: g.moveTo(tx, Y0); g.lineTo(rx, ry); break;
            case 3: case 12: g.moveTo(X0, ly); g.lineTo(rx, ry); break;
            case 4: case 11: g.moveTo(rx, ry); g.lineTo(bx, by); break;
            case 6: case 9: g.moveTo(tx, Y0); g.lineTo(bx, by); break;
            case 7: case 8: g.moveTo(X0, ly); g.lineTo(bx, by); break;
            case 5: case 10: g.moveTo(tx, Y0); g.lineTo(rx, ry); g.moveTo(X0, ly); g.lineTo(bx, by); break;
          }
        }
      }
    };
    // tea rows follow the contours, about 5 px apart whatever the zoom
    g.lineCap = 'round';
    g.beginPath(); yield* iso(Math.max(2, 1.5 / s), (c) => LU[c] === 1 && FE[c] < -4); g.strokeStyle = 'rgba(34,56,48,.34)'; g.lineWidth = .9; g.stroke();
    // contours: minor and major
    const minor = s < .4 ? 20 : 10;
    g.beginPath(); yield* iso(minor, (c) => FE[c] < -2); g.strokeStyle = 'rgba(28,30,62,.2)'; g.lineWidth = .7; g.stroke();
    g.beginPath(); yield* iso(minor * 5, (c) => FE[c] < -2); g.strokeStyle = 'rgba(28,30,62,.36)'; g.lineWidth = 1.1; g.stroke();

    const ym0 = Math.max(YT0, (0 - oy) / s - 40), ym1 = Math.min(YT1, (H - oy) / s + 40);
    // the river: its old course where the mud spared it, a new braided channel where the flow buried it
    const rw = Math.max(2.4, 13 * s);
    const riverPass = (inside, style) => {
      g.beginPath(); let pen = false;
      for (let y = ym0; y <= ym1; y += 3) {
        const fe = w.flowE(w.riverX(y), y), wig = smooth(0, 30, fe) * (14 * Math.sin(y / 41) + 6 * Math.sin(y / 13)), x = w.riverX(y) + wig;
        if ((fe > 0) === inside) { if (pen) g.lineTo(X(x), Y(y)); else { g.moveTo(X(x), Y(y)); pen = true; } } else pen = false;
      }
      style();
    };
    g.lineJoin = 'round';
    riverPass(false, () => { g.strokeStyle = 'rgba(36,44,74,.55)'; g.lineWidth = rw + 2.4; g.stroke(); g.strokeStyle = '#5E7FB0'; g.lineWidth = rw; g.stroke(); g.strokeStyle = 'rgba(143,183,208,.55)'; g.lineWidth = rw * .35; g.stroke(); });
    riverPass(true, () => { g.strokeStyle = 'rgba(110,90,92,.5)'; g.lineWidth = rw * .9 + 1.6; g.stroke(); g.strokeStyle = 'rgba(122,146,170,.92)'; g.lineWidth = rw * .62; g.stroke(); g.strokeStyle = 'rgba(176,200,214,.4)'; g.lineWidth = rw * .22; g.stroke(); });

    yield;
    // the debris flow: outline, flow lines, levees, boulders, logs, broken roofs
    const fpath = new Path2D(); let first = true;
    const yTop = w.scarY - 48, ys = [];
    for (let y = yTop; y <= ym1 + 60; y += 4) ys.push(y);
    for (const y of ys) { const fc = look(tFC, y), l = look(tWL, y); if (first) { fpath.moveTo(X(fc - l), Y(y)); first = false; } else fpath.lineTo(X(fc - l), Y(y)); }
    for (let k2 = ys.length - 1; k2 >= 0; k2--) { const y = ys[k2]; fpath.lineTo(X(look(tFC, y) + look(tWR, y)), Y(y)); }
    fpath.closePath();
    g.save(); g.clip(fpath);
    for (let u = -.88, n = 0; u <= .9; u += .11, n++) {
      g.beginPath();
      for (let q = 0; q < ys.length; q += 2) {
        const y = ys[q], x = look(tFC, y) + (u < 0 ? u * look(tWL, y) : u * look(tWR, y)) + 5 * Math.sin(y / 33 + u * 9) + 3 * Math.sin(y / 11 + n);
        if (q) g.lineTo(X(x), Y(y)); else g.moveTo(X(x), Y(y));
      }
      g.strokeStyle = n % 2 ? 'rgba(250,232,214,.1)' : 'rgba(84,58,58,.13)'; g.lineWidth = n % 3 ? 1 : 1.6; g.stroke();
    }
    // wet sheen along the channel
    for (let q = 0; q < 26; q++) {
      const y = ym0 + rr() * (ym1 - ym0); if (w.flowE(w.riverX(y), y) < 20) continue;
      const x = w.riverX(y) + (rr() - .5) * 60, R = (18 + rr() * 30) * s, gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), R);
      gr.addColorStop(0, 'rgba(226,232,240,.09)'); gr.addColorStop(1, 'rgba(226,232,240,0)'); g.fillStyle = gr; g.fillRect(X(x) - R, Y(y) - R, 2 * R, 2 * R);
    }
    // boulders: denser at the margins and the snout, a few big ones in the channel
    const bA = new Path2D(), bB = new Path2D(), bC = new Path2D(), bS = new Path2D(), bH = new Path2D();
    const fx0w = (0 - ox) / s, fx1w = (W - ox) / s, area = (Math.min(ym1, HM + 200) - yTop) * 260 * s * s, nb = Math.min(2600, area / 70);
    for (let q = 0, made = 0; q < nb * 4 && made < nb; q++) {
      if ((q & 1023) === 0) yield;
      const y = yTop + rr() * (Math.min(ym1, HM + 200) - yTop), fc = look(tFC, y), l = look(tWL, y), rgt = look(tWR, y), x = fc - l + rr() * (l + rgt);
      if (x < fx0w - 10 || x > fx1w + 10) continue;
      const fe = w.flowE(x, y); if (fe < 1.5) continue;
      const hw = (l + rgt) / 2, edgeT = 1 - clamp(fe / hw, 0, 1);
      if (rr() > .25 + .75 * edgeT * edgeT) continue;
      made++;
      const R = Math.max(.7, (1 + rr() * rr() * 3.2) * clamp(s / .6, .55, 1.3)), Xs = X(x), Ys = Y(y), ra = R * (.7 + rr() * .5);
      bS.moveTo(Xs + R * .45 + R, Ys + R * .5); bS.ellipse(Xs + R * .45, Ys + R * .5, R, ra, 0, 0, TAU);
      const P = rr() < .45 ? bA : rr() < .6 ? bB : bC; P.moveTo(Xs + R, Ys); P.ellipse(Xs, Ys, R, ra, rr() * 3, 0, TAU);
      if (R > 1.4) { bH.moveTo(Xs - R * .25 + R * .35, Ys - R * .3); bH.arc(Xs - R * .25, Ys - R * .3, R * .35, 0, TAU); }
    }
    g.fillStyle = 'rgba(46,36,52,.42)'; g.fill(bS);
    g.fillStyle = '#9A8E98'; g.fill(bA); g.fillStyle = '#8C7F7C'; g.fill(bB); g.fillStyle = '#AE9C8C'; g.fill(bC);
    g.fillStyle = 'rgba(236,226,220,.35)'; g.fill(bH);
    // logs and uprooted trees
    g.beginPath();
    for (let q = 0, made = 0; q < 900 && made < 90; q++) {
      const y = yTop + 60 + rr() * (Math.min(ym1, HM + 100) - yTop - 60), x = look(tFC, y) + (rr() - .5) * 2 * look(tWR, y);
      if (w.flowE(x, y) < 4) continue; made++;
      const a = Math.PI / 2 + (rr() - .5) * 2.2, L = (5 + rr() * 9) * clamp(s / .6, .6, 1.2);
      g.moveTo(X(x) - Math.cos(a) * L / 2, Y(y) - Math.sin(a) * L / 2); g.lineTo(X(x) + Math.cos(a) * L / 2, Y(y) + Math.sin(a) * L / 2);
    }
    g.strokeStyle = 'rgba(72,52,50,.75)'; g.lineWidth = 1.3; g.stroke();
    // broken roof pieces carried a little way downstream of each buried house
    for (let ci = 0; ci < 4; ci++) {
      g.beginPath();
      for (const h of w.houses) {
        if (!h.buried) continue;
        for (let q = 0; q < 3; q++) {
          if (((h.x * 7 + h.y * 13 + q * 5) | 0) % 4 !== ci) continue;
          const x = h.x + (rr() - .5) * 26, y = h.y + 6 + rr() * 50, sz = Math.max(1.2, (2 + rr() * 3) * s), a = rr() * 3;
          if (w.flowE(x, y) < 2) continue;
          const c0 = Math.cos(a) * sz, s0 = Math.sin(a) * sz;
          g.moveTo(X(x) - c0, Y(y) - s0); g.lineTo(X(x) + s0 * .6, Y(y) - c0 * .6); g.lineTo(X(x) + c0, Y(y) + s0); g.closePath();
        }
      }
      g.fillStyle = ROOF[ci]; g.globalAlpha = .7; g.fill(); g.globalAlpha = 1;
    }
    g.restore();
    yield;
    // levees: a pale lip just inside each margin, a dark wet line outside it
    g.lineJoin = 'round';
    for (const sgn of [-1, 1]) {
      g.beginPath(); let p0 = true;
      for (const y of ys) { const x = look(tFC, y) + sgn * (sgn < 0 ? look(tWL, y) : look(tWR, y)); if (p0) { g.moveTo(X(x), Y(y)); p0 = false; } else g.lineTo(X(x), Y(y)); }
      g.strokeStyle = 'rgba(48,34,46,.4)'; g.lineWidth = 2.2; g.stroke();
      g.beginPath(); p0 = true;
      for (const y of ys) { const x = look(tFC, y) + sgn * ((sgn < 0 ? look(tWL, y) : look(tWR, y)) - 5); if (p0) { g.moveTo(X(x), Y(y)); p0 = false; } else g.lineTo(X(x), Y(y)); }
      g.strokeStyle = 'rgba(240,222,204,.22)'; g.lineWidth = 1.2; g.stroke();
    }
    // the crown scarp: map notation, a line with ticks pointing down the scar
    {
      g.beginPath(); const pts = [];
      for (let y = yTop + 2; y < w.scarY + 26; y += 3) pts.push([look(tFC, y) - look(tWL, y) + 3, y]);
      const pr = []; for (let y = w.scarY + 26; y > yTop + 2; y -= 3) pr.push([look(tFC, y) + look(tWR, y) - 3, y]);
      const all = pts.concat(pr);
      all.forEach(([x, y], q) => (q ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.strokeStyle = 'rgba(52,34,44,.75)'; g.lineWidth = 1.6; g.stroke();
      g.beginPath();
      for (let q = 1; q < all.length - 1; q += 2) {
        const [x0, y0] = all[q - 1], [x1, y1] = all[q + 1], dx = X(x1) - X(x0), dy = Y(y1) - Y(y0), dl = Math.hypot(dx, dy) || 1, nx = -dy / dl, ny = dx / dl;
        const cxp = X(all[q][0]), cyp = Y(all[q][1]), sg = (cyp + ny * 3 > Y(w.scarY - 20)) ? 1 : -1;
        g.moveTo(cxp, cyp); g.lineTo(cxp + nx * 4 * sg, cyp + ny * 4 * sg);
      }
      g.lineWidth = 1; g.stroke();
    }
    // roads (cut where the mud covers them), side tracks up to the estate line houses, and the bridge
    const roadPass = (pts) => {
      g.beginPath(); let pen = false;
      for (let q = 0; q < pts.length; q++) { const [x, y] = pts[q], buried = w.flowE(x, y) > -3; if (buried) { pen = false; continue; } if (pen) g.lineTo(X(x), Y(y)); else { g.moveTo(X(x), Y(y)); pen = true; } }
    };
    const main = []; for (let y = ym0; y <= ym1; y += 5) main.push([w.roadX(y), y]);
    const tracks = [];
    for (const h of w.houses) if (h.line) { const y0 = h.y + 40, x0 = w.roadX(y0), pts = []; for (let t = 0; t <= 1.0001; t += .05) { const x = x0 + (h.x - x0) * t + Math.sin(t * Math.PI) * 40 * (h.x > x0 ? -1 : 1), y = y0 + (h.y - y0) * t + Math.sin(t * Math.PI * 2) * 18; pts.push([x, y]); } tracks.push(pts); }
    for (const pts of tracks) { roadPass(pts); g.strokeStyle = 'rgba(46,40,62,.4)'; g.lineWidth = 2.4; g.stroke(); g.strokeStyle = 'rgba(214,198,176,.6)'; g.lineWidth = 1; g.stroke(); }
    roadPass(main); g.strokeStyle = 'rgba(40,36,60,.5)'; g.lineWidth = Math.max(2.6, 9 * s) + 1.6; g.stroke(); g.strokeStyle = 'rgba(224,208,186,.82)'; g.lineWidth = Math.max(1.6, 9 * s); g.stroke();
    {
      const xb = w.riverX(w.yb), yb = w.yb;
      if (w.flowE(xb, yb) < -6) {
        const a0 = Math.atan2(1, (w.roadX(yb + 3) - w.roadX(yb - 3)) / 6), L = 18 * s + 4;
        g.save(); g.translate(X(w.roadX(yb)), Y(yb)); g.rotate(a0);
        g.fillStyle = 'rgba(40,36,60,.6)'; g.fillRect(-L, -3.2, 2 * L, 6.4); g.fillStyle = '#D9CCB8'; g.fillRect(-L, -2, 2 * L, 4); g.restore();
      }
    }
    yield;
    // houses that survived: shadow, roof, ridge
    const shadow = new Path2D(), roofs = ROOF.map(() => new Path2D()), ridge = new Path2D();
    const quad = (P, x, y, l, wd, a, dx = 0, dy = 0) => {
      const c0 = Math.cos(a), s0 = Math.sin(a), hl = l / 2, hw = wd / 2, Xc = X(x) + dx, Yc = Y(y) + dy;
      P.moveTo(Xc + c0 * hl - s0 * hw, Yc + s0 * hl + c0 * hw); P.lineTo(Xc - c0 * hl - s0 * hw, Yc - s0 * hl + c0 * hw);
      P.lineTo(Xc - c0 * hl + s0 * hw, Yc - s0 * hl - c0 * hw); P.lineTo(Xc + c0 * hl + s0 * hw, Yc + s0 * hl - c0 * hw); P.closePath();
    };
    const hk = Math.max(s, .42);                                         // px per metre for houses: never smaller than a few pixels
    for (const h of w.houses) {
      if (h.buried) continue;
      const l = h.l * hk, wd = h.w * hk; quad(shadow, h.x, h.y, l, wd, h.a, 1.1, 1.3); quad(roofs[h.col], h.x, h.y, l, wd, h.a);
      const c0 = Math.cos(h.a) * l * .42, s0 = Math.sin(h.a) * l * .42; ridge.moveTo(X(h.x) - c0, Y(h.y) - s0); ridge.lineTo(X(h.x) + c0, Y(h.y) + s0);
    }
    g.fillStyle = 'rgba(24,24,48,.45)'; g.fill(shadow);
    roofs.forEach((P, q) => { g.fillStyle = ROOF[q]; g.fill(P); });
    g.strokeStyle = 'rgba(40,36,60,.35)'; g.lineWidth = .8; g.stroke(ridge);
    // tree crowns: forest on the ridges, shade trees in the tea, homestead trees on the valley floor
    const sp = clamp(5.2 * Math.sqrt(s / .6), 3.6, 6), cr = clamp(2.75 * Math.sqrt(s / .6), 1.7, 3.2);
    const cS = new Path2D(), cT = [new Path2D(), new Path2D(), new Path2D()], cH = new Path2D(), fS = new Path2D(), fT = [new Path2D(), new Path2D(), new Path2D()], fH = new Path2D();
    for (let y = -sp, row = 0; y < H + sp; y += sp * .87, row++) for (let x = -sp + ((y / sp) & 1 ? sp / 2 : 0); x < W + sp; x += sp) {
      if (x < 0 && (row & 7) === 0) yield;
      const jx = x + (rr() - .5) * sp * .8, jy = y + (rr() - .5) * sp * .8, li = clamp(Math.round(jx / STEP) + 1, 0, LW - 1), lj = clamp(Math.round(jy / STEP) + 1, 0, LH - 1), c = lj * LW + li, u = LU[c];
      const p = u === 2 ? 1 : u === 1 ? .025 : u === 0 ? .08 : u === 3 ? .06 : 0;
      if (p === 0 || rr() > p) continue;
      const R = cr * (u === 2 ? .8 + rr() * .5 : .7 + rr() * .3), sh2 = SH[c], t = sh2 < .7 ? 0 : sh2 < .95 ? 1 : 2;
      // canopy crowns sit on a dark canopy floor and only cast a shadow where the forest ends
      const S2 = u === 2 ? fS : cS, T2 = u === 2 ? fT : cT, H2 = u === 2 ? fH : cH;
      let edge = u !== 2;
      if (!edge) { const lr = LU[c + 2] !== 2 || LU[c - 2] !== 2 || LU[c + 2 * LW] !== 2 || LU[c - 2 * LW] !== 2; edge = lr; }
      if (edge) { S2.moveTo(jx + R * .4 + R * 1.05, jy + R * .45); S2.arc(jx + R * .4, jy + R * .45, R * 1.05, 0, TAU); }
      T2[t].moveTo(jx + R, jy); T2[t].arc(jx, jy, R, 0, TAU);
      if (t > 0) { H2.moveTo(jx - R * .3 + R * .42, jy - R * .32); H2.arc(jx - R * .3, jy - R * .32, R * .42, 0, TAU); }
    }
    g.fillStyle = 'rgba(22,30,40,.34)'; g.fill(cS); g.fill(fS);
    g.fillStyle = '#4C6A62'; g.fill(cT[0]); g.fillStyle = '#5E7E6E'; g.fill(cT[1]); g.fillStyle = '#6F8F7A'; g.fill(cT[2]);
    g.fillStyle = 'rgba(190,214,186,.22)'; g.fill(cH);
    g.fillStyle = '#41605C'; g.fill(fT[0]); g.fillStyle = '#4E6F66'; g.fill(fT[1]); g.fillStyle = '#5C7D70'; g.fill(fT[2]);
    g.fillStyle = 'rgba(178,206,180,.16)'; g.fill(fH);
    yield;
    // place names, faint, set off the flow
    g.font = `400 ${phone ? 10 : 11}px ${F.sans}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    try { g.letterSpacing = '1.5px'; } catch (_) { /* older canvases */ }
    for (const [a, b, name] of w.vil) {
      const y = Math.min(HM - 60, (a + b) / 2), fc = look(tFC, y), side = w.roadX(y) > fc ? 1 : -1;
      const x = fc + side * ((side > 0 ? look(tWR, y) : look(tWL, y)) + 150);
      g.fillStyle = 'rgba(20,22,48,.5)'; g.fillText(name.toUpperCase(), X(x) + .8, Y(y) + .8); g.fillStyle = 'rgba(243,238,242,.62)'; g.fillText(name.toUpperCase(), X(x), Y(y));
    }
    try { g.letterSpacing = '0px'; } catch (_) { /* older canvases */ }
    // outside the search polygon: never searched, so desaturated and veiled for good
    g.save(); g.beginPath(); g.rect(-2, -2, W + 4, H + 4); w.poly.forEach(([x, y], q) => (q ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); g.clip('evenodd');
    g.globalCompositeOperation = 'saturation'; g.fillStyle = '#4a4b86'; g.globalAlpha = .75; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over'; g.fillStyle = '#1f2248'; g.globalAlpha = .25; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    g.restore();
    // dusk: a soft vignette and a lilac haze from the top
    const vg = g.createRadialGradient(W * .62, H * .55, Math.min(W, H) * .3, W * .62, H * .55, Math.max(W, H) * .85);
    vg.addColorStop(0, 'rgba(20,22,48,0)'); vg.addColorStop(1, 'rgba(20,22,48,.5)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    const hz = g.createLinearGradient(0, 0, 0, H * .45); hz.addColorStop(0, 'rgba(143,140,196,.16)'); hz.addColorStop(1, 'rgba(143,140,196,0)'); g.fillStyle = hz; g.fillRect(0, 0, W, H * .45);
  }

  // ------------------------------------------------------------ fog of war: a dusk veil with hatching, cleared by soft brush stamps
  function polyPath(g) { const P = Wd.poly; g.beginPath(); P.forEach(([x, y], q) => (q ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); }
  function renderFog() {
    const W = Math.ceil(cv.w), H = Math.ceil(cv.h), g = uctx;
    U.width = W; U.height = H; g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = '#1f2248'; g.fillRect(0, 0, W, H);
    g.save(); polyPath(g); g.clip();
    g.strokeStyle = 'rgba(150,146,204,.42)'; g.lineWidth = 1; g.beginPath();
    for (let k = -H; k < W; k += 7) { g.moveTo(k, 0); g.lineTo(k + H, H); }
    g.stroke(); g.restore();
    // replay what is already known (after a resize): searched cells clear fully, cells only mapped by the scouts clear a little
    const cg = COV.getContext('2d'), img = cg.createImageData(GW, GH), px = img.data;
    let any = false;
    for (let c = 0; c < NC; c++) { const a = tru[c] ? 255 : mapd[c] ? 80 : 0; if (a) any = true; px[c * 4 + 3] = a; }
    // from here on every stamp is clipped to the polygon: outside it stays veiled (the clip lasts until the next resize)
    g.save(); polyPath(g); g.clip();
    if (any) { cg.putImageData(img, 0, 0); g.globalCompositeOperation = 'destination-out'; g.imageSmoothingEnabled = true; g.drawImage(COV, X(0), Y(0), WM * s, HM * s); g.globalCompositeOperation = 'source-over'; }
  }
  function fogStamp(x, y, R, a) {
    const rp = R * s * (1.18 + Math.random() * .24); x += (Math.random() - .5) * R * .25; y += (Math.random() - .5) * R * .25; uctx.globalCompositeOperation = 'destination-out'; uctx.globalAlpha = a;
    uctx.drawImage(BRUSH, X(x) - rp, Y(y) - rp, 2 * rp, 2 * rp); uctx.globalAlpha = 1; uctx.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------ the swarm
  const TRN = 12, D = [];
  for (let k = 0; k < NDR; k++) D.push({ k, id: k + 1, x: 0, y: 0, vx: 0, vy: 0, hd: -Math.PI / 2, st: 'pad', tb: -1, ri: 0, sx: 0, sy: 0, at: 0,
    trail: new Float32Array(TRN * 2), tn: 0, tt: 0, comp: 0, iso: false, offT: 0, tx: 0, ty: 0, wv: 0, isoT: 0, myUn: new Uint16Array(NB), pend: [], grp: null, slot: 0, idleT: 0 });
  const active = (d) => d.st !== 'pad' && d.st !== 'landed';
  const links = new Int16Array(NDR * NDR * 2), linkShow = new Uint8Array(NDR * NDR); let nLinks = 0;
  const par = new Int8Array(NDR), compSize = new Int8Array(NDR);
  let mainComp = 0, nIso = 0;
  const notes = [];
  let simT = 0, wallT = 0, phase = 'run', phaseT = 0, meshT = 0, betaT = 0, beta0 = 1, isoSaid = -99, missionN = 0, summary = null, lastIso = null;
  const patches = [];                                                     // unsearched components: [cx, cy, blocks]
  const P = (long, short) => (phone ? short : long);                     // callouts are shorter on a phone
  function say(s2, x, y, col = C.ink, dur = 4.2, key = '') {
    if (key) for (let q = notes.length - 1; q >= 0; q--) if (notes[q].key === key) notes.splice(q, 1);   // a newer note of the same kind replaces the old one
    notes.push({ s: s2, x, y, col, t0: wallT, dur, key }); if (notes.length > 3) notes.shift();
  }

  // the next mission: built in slices while the summary shows (world + grids), then behind a black hold (art)
  let job = null, jobKind = '', nextW = null;
  function* prep(sd) { const w = yield* gen(sd); yield* initGrids(w); nextW = w; }
  function pump(ms) { const t0 = performance.now(); while (job && performance.now() - t0 < ms) if (job.next().done) job = null; }
  function newMission() {                                                 // Wd, the grids and the terrain art are ready
    renderFog();
    shrN = 0; truN = 0; located = 0; found = 0;
    simT = 0; phase = 'run'; phaseT = 0; meshT = 0; betaT = 0; beta0 = 1; notes.length = 0; summary = null; isoSaid = -99; missionN++;
    const [bx, by] = Wd.base;
    for (const d of D) {
      d.x = bx + ((d.k % 6) - 2.5) * 9; d.y = by + (((d.k / 6) | 0) - 1) * 9; d.vx = d.vy = 0; d.hd = -Math.PI / 2; d.st = 'pad'; d.tb = -1; d.ri = 0;
      d.sx = d.x; d.sy = d.y; d.at = .25 + (d.k < NSC ? d.k * .12 : .5 + (d.k - NSC) * .16); d.tn = 0; d.tt = 0; d.iso = false; d.offT = 0; d.wv = d.k * 1.7; d.pend.length = 0; d.grp = null; d.idleT = 0;
    }
  }

  // frontier choice: the best unsearched 40 m block, preferring straight on (lanes), near, not claimed on my mesh
  const claimS = new Int32Array(NB), claimV = new Float32Array(NB); let claimN = 0;
  function mark(b, v, nb) {
    const bi = b % BW, bj = (b / BW) | 0;
    for (let j = bj - nb; j <= bj + nb; j++) for (let i = bi - nb; i <= bi + nb; i++) {
      if (i < 0 || j < 0 || i >= BW || j >= BH) continue;
      const q = j * BW + i, vv = (i === bi && j === bj) ? v : v * .06;
      if (claimS[q] !== claimN) { claimS[q] = claimN; claimV[q] = vv; } else claimV[q] += vv;
    }
  }
  function choose(d) {
    claimN++;
    for (const o of D) {
      if (o === d || !active(o) || o.comp !== d.comp || o.st === 'scout') continue;
      if (o.tb >= 0) mark(o.tb, 2.2, 1);
      const ob = blockAt(o.x, o.y); if (ob >= 0) mark(ob, .3, 0);
    }
    const un = d.iso ? d.myUn : bun, hx = Math.cos(d.hd), hy = Math.sin(d.hd);
    let best = -1, bs = -1e9;
    for (let b = 0; b < NB; b++) {
      const t = btot[b]; if (!t || un[b] <= t * DONE) continue;
      const dx = bcx[b] - d.x, dy = bcy[b] - d.y, dist = Math.sqrt(dx * dx + dy * dy) + 1;
      let sc = .5 * un[b] / t - dist / 260 - .24 * (1 - (dx * hx + dy * hy) / dist);
      // frontier: blocks that touch searched ground (or the polygon's edge) first, so the searched area grows in one piece
      const bi = b % BW, bj = (b / BW) | 0, dn = (q) => !btot[q] || un[q] <= btot[q] * DONE;
      const dl = bi > 0 && dn(b - 1), dr = bi < BW - 1 && dn(b + 1), du = bj > 0 && dn(b - BW), dd = bj < BH - 1 && dn(b + BW);
      if (dl || dr || du || dd) sc += .32;                               // frontier: touches searched ground (or the polygon's edge)
      if ((dl && dr) || (du && dd)) sc += .3;                             // a gap left between two lanes: close it now
      if (bpri[b]) sc += .9;
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
        if (!d.iso && !shr[c]) { shr[c] = 1; shrN++; bun[cb[c]]--; }
      }
    }
    fogStamp(x, y, R_FINE, 1);
    for (const g of Wd.groups) if (g.st === 0 && (g.x - x) ** 2 + (g.y - y) ** 2 < (R_FINE * .9) ** 2) hit(g, d);
  }
  function stampScout(x, y) {
    const ci = x / CELL, cj = y / CELL, rc = R_SCOUT / CELL, rc2 = rc * rc;
    const i0 = Math.max(0, Math.floor(ci - rc)), i1 = Math.min(GW - 1, Math.ceil(ci + rc)), j0 = Math.max(0, Math.floor(cj - rc)), j1 = Math.min(GH - 1, Math.ceil(cj + rc));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const dx = i + .5 - ci, dy = j + .5 - cj; if (dx * dx + dy * dy <= rc2) mapd[j * GW + i] = 1; }
    fogStamp(x, y, R_SCOUT * .92, .16);
    let fresh = 0, fx = 0, fy = 0;
    for (const h of Wd.houses) {
      if (!h.buried || !h.inP || h.loc || (h.x - x) ** 2 + (h.y - y) ** 2 > R_SCOUT * R_SCOUT) continue;
      h.loc = 1; h.tl = wallT; located++; fresh++; fx = h.x; fy = h.y;
      const b = blockAt(h.x, h.y); if (b >= 0) bpri[b] = 1;
    }
    if (fresh && located === fresh) say(P('change map: a house in the old map is under mud here', 'change map: a house under mud'), fx, fy, C.rose, 4.5);
  }
  function hit(g, d) {
    g.st = 1; g.tHit = simT; g.dr = [d]; g.clock = 0;
    say(P('thermal hit: neighbours come to confirm', 'thermal hit'), g.x, g.y, C.heat, 3.2);
    const cand = D.filter((o) => o !== d && o.st === 'search' && o.comp === d.comp && Math.hypot(o.x - g.x, o.y - g.y) < 380).sort((a, b) => Math.hypot(a.x - g.x, a.y - g.y) - Math.hypot(b.x - g.x, b.y - g.y));
    for (const o of cand.slice(0, 2)) g.dr.push(o);
    const a0 = Math.atan2(d.y - g.y, d.x - g.x);
    g.dr.forEach((o, q) => { o.st = 'conf'; o.grp = g; o.slot = a0 + q * TAU / g.dr.length; });
  }
  function confirmGroup(g) {
    g.st = 2; g.tConf = wallT; found += g.n;
    const who = g.n > 1 ? `${g.n} people` : '1 person';
    const where = g.kind === 'edge' ? "at the flow's edge" : 'cut off on the slope';
    say(P(`${who} ${where}: thermal + camera agree`, `${who} ${where}`), g.x, g.y, C.heat, 5);
    for (const o of g.dr) if (o.st === 'conf') { o.st = 'search'; o.tb = -1; o.grp = null; }
  }

  // radio: links within range and line of sight over the terrain; the largest connected group is the shared mesh
  function mesh() {
    nLinks = 0;
    for (let i = 0; i < NDR; i++) par[i] = i;
    const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let i = 0; i < NDR; i++) {
      const a = D[i]; if (!active(a)) continue;
      for (let j = i + 1; j < NDR; j++) {
        const b = D[j]; if (!active(b)) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dd = dx * dx + dy * dy; if (dd > RADIO * RADIO) continue;
        let ok = true;
        const za = hAt(a.x, a.y) + ALT, zb = hAt(b.x, b.y) + ALT;
        for (let q = 1; q < 8 && ok; q++) { const t = q / 8; if (hAt(a.x + dx * t, a.y + dy * t) > za + (zb - za) * t + 6) ok = false; }
        if (!ok) continue;
        links[nLinks * 2] = i; links[nLinks * 2 + 1] = j; nLinks++;
        const ra = find(i), rb = find(j); if (ra !== rb) par[ra] = rb;
      }
    }
    compSize.fill(0);
    let best = -1, bn = 0;
    for (let i = 0; i < NDR; i++) { if (!active(D[i])) continue; const r0 = find(i); D[i].comp = r0; compSize[r0]++; if (compSize[r0] > bn) { bn = compSize[r0]; best = r0; } }
    mainComp = best; nIso = 0;
    // drawn links: each drone to its two nearest neighbours in range (the mesh itself is denser)
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
      if (!active(d) || d.st === 'scout') { d.iso = false; continue; }
      // out of the shared mesh for more than a moment (a blink behind a spur does not count)
      d.offT = d.comp !== mainComp ? d.offT + .15 : 0;
      const iso = d.offT > 1.2;
      if (iso && !d.iso) {
        d.isoT = wallT;                                                      // lost the mesh: keep a private copy of the map
        d.myUn.set(bun); d.pend.length = 0;
        if (wallT - isoSaid > 7 && phase === 'run') { say(P(`drone ${d.id} behind a ridge: out of range, keeps searching`, `drone ${d.id} behind a ridge, searching alone`), d.x, d.y, C.muted, 4); isoSaid = wallT; lastIso = d; }
      } else if (!iso && d.iso) {                                               // back: its cells merge into the shared map
        let m = 0; for (const c of d.pend) if (!shr[c]) { shr[c] = 1; shrN++; bun[cb[c]]--; m++; }
        d.pend.length = 0;
        if (lastIso === d && m > 120 && wallT - d.isoT > 3) { say(P(`drone ${d.id} back in range: maps merged, +${(m * CELL * CELL / 1e4).toFixed(1)} ha`, `drone ${d.id} back: maps merged`), d.x, d.y, C.teal, 4); lastIso = null; }
      }
      d.iso = iso; if (iso) nIso++;
    }
  }
  // β₀ of the unsearched region (blocks still above the threshold, 4-connected), and where each piece is
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
    if (n <= 8) for (let b = 0; b < NB; b++) if (bacc[b * 3 + 2]) patches.push([bacc[b * 3] / bacc[b * 3 + 2], bacc[b * 3 + 1] / bacc[b * 3 + 2], bacc[b * 3 + 2]]);
    patches.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    return n;
  }

  function moveDrone(d, tx, ty, v, sdt) {
    let dx = tx - d.x, dy = ty - d.y; const dist = Math.hypot(dx, dy) || 1, sp = Math.min(v, dist / Math.max(sdt, .05) * .9);
    let ex = dx / dist * sp, ey = dy / dist * sp;
    // a gentle weave across the track (a few tens of metres, period ~400 m): coverage edges come out organic, not ruled
    const wv = Math.sin(d.wv) * .5 * sp * smooth(4, 22, dist); ex -= dy / dist * wv; ey += dx / dist * wv;
    d.wv += sp * sdt / 64;
    for (const o of D) {
      if (o === d || !active(o)) continue;
      const qx = d.x - o.x, qy = d.y - o.y, q2 = qx * qx + qy * qy;
      if (q2 < 1225 && q2 > 1e-4) { const q = Math.sqrt(q2), f = (35 - q) / 35 * 5; ex += qx / q * f; ey += qy / q * f; }
    }
    const k = 1 - Math.exp(-sdt * 1.1);
    d.vx += (ex - d.vx) * k; d.vy += (ey - d.vy) * k;
    d.x += d.vx * sdt; d.y += d.vy * sdt;
    if (!(Math.abs(d.x) < 1e5 && Math.abs(d.y) < 1e5)) { d.x = d.sx = tx; d.y = d.sy = ty; d.vx = d.vy = 0; }   // never lose a drone to a numeric glitch
    if (d.vx * d.vx + d.vy * d.vy > .5) d.hd = Math.atan2(d.vy, d.vx);
    return dist;
  }
  function step(dt) {
    wallT += dt; phaseT += dt;
    if (phase === 'summary' || phase === 'fade' || phase === 'regen') {
      pump(phase === 'regen' ? 6 : 3.5);
      if (!job && jobKind === 'prep' && phase === 'regen') { job = renderTerrain(nextW); jobKind = 'art'; pump(5); }
      if (!job && jobKind === 'art') { jobKind = ''; Wd = nextW; nextW = null; newMission(); return; }
      if (phase === 'summary' && phaseT > 5.5) { phase = 'fade'; phaseT = 0; } else if (phase === 'fade' && phaseT > 1) { phase = 'regen'; phaseT = 0; }
      return;
    }
    const sdt = dt * TL; simT += sdt;
    for (const d of D) {
      if (d.st === 'pad') { if (phaseT >= d.at && phase === 'run') { d.st = d.k < NSC ? 'scout' : 'search'; d.ri = 0; } else continue; }
      if (d.st === 'landed') continue;
      let tx = d.x, ty = d.y, v = V_FINE;
      if (d.st === 'scout') {
        const rt = Wd.routes[d.k]; const wp = rt[Math.min(d.ri, rt.length - 1)]; tx = wp[0]; ty = wp[1]; v = V_SCOUT;
        if (Math.hypot(tx - d.x, ty - d.y) < 14) { d.ri++; if (d.ri >= rt.length) { d.st = 'search'; d.tb = -1; if (d.k === 1) say('scar: where the slope gave way', Wd.scar[0], Wd.scar[1], C.muted, 4.5); } }
      } else if (d.st === 'search' || d.st === 'idle') {
        const un = d.iso ? d.myUn : bun;
        if (d.tb < 0 || un[d.tb] <= btot[d.tb] * DONE || Math.hypot(d.tx - d.x, d.ty - d.y) < 6) {
          d.idleT -= dt; if (d.tb >= 0 || d.idleT <= 0) { choose(d); d.idleT = .6; }
        }
        if (d.tb >= 0) { d.st = 'search'; tx = d.tx; ty = d.ty; }
        else if (d.iso) { d.st = 'idle'; tx = Wd.base[0]; ty = Wd.base[1]; }           // nothing left in its own map: fly back into range and merge
        else { d.st = 'idle'; tx = d.x; ty = d.y; v = 2; }
      } else if (d.st === 'conf') {
        const g = d.grp; tx = g.x + Math.cos(d.slot + simT * .02) * 24; ty = g.y + Math.sin(d.slot + simT * .02) * 24; v = V_FINE * 1.25;
      } else if (d.st === 'home') {
        tx = Wd.base[0] + ((d.k % 6) - 2.5) * 9; ty = Wd.base[1] + (((d.k / 6) | 0) - 1) * 9; v = V_FINE * 1.4;
        if (Math.hypot(tx - d.x, ty - d.y) < 5) { d.st = 'landed'; continue; }
      }
      moveDrone(d, tx, ty, v, sdt);
      // stamp what the camera sees, every ~9 m of track (more often when the step is long)
      const mx = d.x - d.sx, my = d.y - d.sy, md = Math.hypot(mx, my), gap = d.st === 'scout' ? R_SCOUT * .32 : R_FINE * .3;
      if (md >= gap) {
        const n = Math.min(6, Math.floor(md / gap));
        for (let q = 1; q <= n; q++) { const x = d.sx + mx * q / n, y = d.sy + my * q / n; if (d.st === 'scout') stampScout(x, y); else if (d.st !== 'home') stampFine(d, x, y); }
        d.sx = d.x; d.sy = d.y;
      }
      d.tt += dt; if (d.tt > .07) { d.tt = 0; const o = (d.tn % TRN) * 2; d.trail[o] = d.x; d.trail[o + 1] = d.y; d.tn++; }
    }
    // confirmations: once the gathered drones hover in place, thermal + camera take a moment
    for (const g of Wd.groups) {
      if (g.st !== 1) continue;
      const ready = g.dr.every((o) => o.st !== 'conf' || Math.hypot(o.x - g.x, o.y - g.y) < 36);
      if (ready) g.clock += sdt;
      if (g.clock > 26 || simT - g.tHit > 90) confirmGroup(g);
    }
    meshT -= dt; if (meshT <= 0) { mesh(); meshT = .15; }
    betaT -= dt; if (betaT <= 0) { beta0 = betaCount(); betaT = .25; }
    if (phase === 'run') {
      const scouting = D.some((d) => d.st === 'scout' || d.st === 'pad');
      if (!scouting && beta0 === 0 && !Wd.groups.some((g) => g.st === 1) && !D.some((d) => d.iso && d.pend.length)) {
        phase = 'home'; phaseT = 0; for (const d of D) if (active(d)) { d.st = 'home'; d.grp = null; }
        say('nothing left unsearched: β₀ = 0', WM / 2, HM / 2, C.teal, 4);
      } else if (phaseT > 80) { phase = 'home'; phaseT = 0; for (const d of D) if (active(d)) d.st = 'home'; }
    } else if (phase === 'home') {
      if (D.every((d) => !active(d)) || phaseT > 6) {
        phase = 'summary'; phaseT = 0;
        summary = { km2: shrN * CELL * CELL / 1e6, t: simT, houses: located, buried: Wd.nBuried, people: found, groups: Wd.groups.filter((g) => g.st === 2).length };
        job = prep((Wd.sd * 1103 + 12345) % 9973 + 1); jobKind = 'prep';
      }
    }
  }

  // ------------------------------------------------------------ drawing
  const fmtClock = (t) => { const m = Math.floor(t / 60), h = Math.floor(m / 60); return `${h}:${String(m % 60).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
  const placed = new Float32Array(4 * 160); let nPl = 0;               // label boxes and markers drawn this frame
  const keep = (x, y, w, h) => { if (nPl < placed.length) { placed[nPl++] = x; placed[nPl++] = y; placed[nPl++] = w; placed[nPl++] = h; } };
  const free = (x, y, w, h) => {
    if (x < fx0 - 4 || x + w > cv.w - 8 || y < fy0 - 8 || y + h > cv.h - (phone ? 34 : 6)) return false;     // below the HUD lines, above the card
    if (x + w > cv.w - 210 && y + h > cv.h - 74) return false;                 // the sound / full-screen buttons
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
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = alpha * .55; ctx.beginPath();
    const ax = clamp(px0, bx + 6, bx + w - 6), ay = py0 < by ? by : by + h; ctx.moveTo(px0, py0); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.globalAlpha = alpha; ctx.fillStyle = 'rgba(27,30,61,.86)'; roundRect(ctx, bx, by, w, h, h / 2); ctx.fill();
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
  let hover = null, hoverT = 0;
  const dbg = { nofog: false };
  function draw() {
    const W = cv.w, H = cv.h, t = wallT;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    if (phase === 'regen') return;                                        // a short black hold while the next hillside is drawn
    ctx.drawImage(TC, 0, 0, W, H);
    // weather: cloud shadows and valley mist drift slowly across
    ctx.save();
    ctx.globalAlpha = .55; ctx.fillStyle = cloudPat; ctx.translate((t * 9) % (512 * 1), (t * 4) % 512); ctx.scale(4, 4); ctx.fillRect(-128, -128, W / 4 + 256, H / 4 + 256);
    ctx.restore(); ctx.save();
    ctx.globalAlpha = .1; ctx.fillStyle = mistPat; ctx.translate(-(t * 6) % 640, (t * 2) % 640); ctx.scale(5, 5); ctx.fillRect(0, -128, W / 5 + 256, H / 5 + 256);
    ctx.restore();
    // fog of war: desaturate, then veil
    if (!dbg.nofog) {
      ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = .92; ctx.drawImage(U, 0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = .5; ctx.drawImage(U, 0, 0, W, H); ctx.globalAlpha = 1;
    }
    // the search polygon
    polyPath(ctx); ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(220,228,238,.42)'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    nPl = 0;
    // change map: houses from the old map that are under mud now
    const hk = Math.max(s, .42);
    const ghost = (P, h, grow) => {
      const l = h.l * hk * grow, wd = h.w * hk * grow, c0 = Math.cos(h.a), s0 = Math.sin(h.a), hl = l / 2, hw = wd / 2, Xc = X(h.x), Yc = Y(h.y);
      P.moveTo(Xc + c0 * hl - s0 * hw, Yc + s0 * hl + c0 * hw); P.lineTo(Xc - c0 * hl - s0 * hw, Yc - s0 * hl + c0 * hw);
      P.lineTo(Xc - c0 * hl + s0 * hw, Yc - s0 * hl - c0 * hw); P.lineTo(Xc + c0 * hl + s0 * hw, Yc + s0 * hl - c0 * hw); P.closePath();
    };
    ctx.beginPath(); let nNew = 0;
    for (const h of Wd.houses) if (h.loc) ghost(ctx, h, 1 + .5 * (1 - smooth(0, .5, t - h.tl)));
    ctx.fillStyle = 'rgba(239,177,180,.16)'; ctx.fill();
    ctx.strokeStyle = 'rgba(30,26,46,.55)'; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.setLineDash([2.5, 2]); ctx.strokeStyle = C.rose; ctx.lineWidth = 1.1; ctx.stroke(); ctx.setLineDash([]);
    for (const h of Wd.houses) if (h.loc && t - h.tl < .8) { nNew++; const a = 1 - (t - h.tl) / .8; ctx.globalAlpha = a; ctx.strokeStyle = C.rose; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X(h.x), Y(h.y), 4 + 14 * (1 - a), 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // the last unsearched pieces get numbered markers
    if (phase === 'run' && beta0 > 0 && beta0 <= 6 && shrN > polyN * .75) {
      patches.forEach(([x, y], q) => {
        const Xs = X(x), Ys = Y(y), pulse = .5 + .5 * Math.sin(t * 3 + q);
        ctx.fillStyle = `rgba(143,140,196,${.18 + .12 * pulse})`; ctx.beginPath(); ctx.arc(Xs, Ys, 10, 0, TAU); ctx.fill();
        ctx.fillStyle = C.haze; ctx.beginPath(); ctx.arc(Xs, Ys, 6.5, 0, TAU); ctx.fill();
        text(ctx, String(q + 1), Xs, Ys + .5, { size: 9.5, color: '#1E2140', weight: 600, align: 'center', base: 'middle' });
        keep(Xs - 10, Ys - 10, 20, 20);
      });
    }
    // the base
    {
      const bx = X(Wd.base[0]), by = Y(Wd.base[1]), bw = phone ? 15 : 22, bh = phone ? 10 : 14;
      ctx.strokeStyle = C.apricot; ctx.lineWidth = 1.3; ctx.globalAlpha = .85; roundRect(ctx, bx - bw, by - bh, 2 * bw, 2 * bh, 6); ctx.stroke(); ctx.globalAlpha = 1;
      keep(bx - bw - 2, by - bh - 2, 2 * bw + 4, 2 * bh + 4);
      text(ctx, 'base', bx, by + bh + 12, { size: 10.5, color: C.apricot, align: 'center' }); keep(bx - 16, by + bh + 2, 32, 14);
    }
    // people
    for (const g of Wd.groups) {
      if (g.st === 0) continue;
      const Xs = X(g.x), Ys = Y(g.y);
      if (g.st === 1) {
        const p = (t * 1.6) % 1;
        ctx.strokeStyle = C.heat; ctx.globalAlpha = 1 - p; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(Xs, Ys, 6 + p * 22, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.globalAlpha = .7; ctx.drawImage(GLOW_H, Xs - 12, Ys - 12, 24, 24); ctx.globalAlpha = 1;
      } else {
        const a = smooth(0, .6, t - g.tConf), R = 20 + 3 * Math.sin(t * 2.2);
        ctx.globalAlpha = a; ctx.drawImage(GLOW_H, Xs - R, Ys - R, 2 * R, 2 * R);
        ctx.fillStyle = '#FFE3B8';
        for (let q = 0; q < g.n; q++) { ctx.beginPath(); ctx.arc(Xs + (q - (g.n - 1) / 2) * 4, Ys + (q % 2) * 1.5, 1.7, 0, TAU); ctx.fill(); }
        ctx.strokeStyle = C.heat; ctx.lineWidth = 1; ctx.globalAlpha = a * .7; ctx.beginPath(); ctx.arc(Xs, Ys, 11, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      }
      keep(Xs - 12, Ys - 12, 24, 24);
    }
    // scouts' wide change-map swath
    for (const d of D) if (d.st === 'scout') {
      ctx.strokeStyle = 'rgba(127,212,207,.35)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.arc(X(d.x), Y(d.y), R_SCOUT * s, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(127,212,207,.05)'; ctx.fill();
    }
    // mesh links: each drone to its two nearest neighbours in range (dashed)
    ctx.beginPath();
    for (let q = 0; q < nLinks; q++) {
      if (!linkShow[q]) continue;
      const a = D[links[q * 2]], b = D[links[q * 2 + 1]]; if (!active(a) || !active(b)) continue;
      ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y));
    }
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(127,212,207,.5)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    // drones: glow, trail, dark under-stroke, teal X-frame with four rotors
    const sz = phone ? 3.4 : 4.8;
    for (const d of D) { if (!active(d)) continue; ctx.globalAlpha = d.iso ? .25 : .7; ctx.drawImage(GLOW_T, X(d.x) - 16, Y(d.y) - 16, 32, 32); }
    ctx.globalAlpha = 1;
    for (let band = 0; band < 3; band++) {
      ctx.beginPath();
      for (const d of D) {
        if (!active(d) || d.tn < 2) continue;
        const n = Math.min(TRN, d.tn), seg = Math.ceil(n / 3), from = band * seg, to = Math.min(n - 1, from + seg);
        for (let q = from; q <= to; q++) {
          const idx = ((d.tn - n + q) % TRN) * 2, x = X(d.trail[idx]), y = Y(d.trail[idx + 1]);
          if (q === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
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
    // callouts (newest first get the best spots)
    for (let q = notes.length - 1; q >= 0; q--) {
      const n = notes[q], age = t - n.t0; if (age > n.dur) continue;
      const a = Math.min(1, age / .3) * Math.min(1, (n.dur - age) / .6);
      pill(n.s, X(n.x), Y(n.y), n.col, a, phone ? 10.5 : 12);
    }
    while (notes.length && t - notes[0].t0 > notes[0].dur) notes.shift();
    hud(W, H);
    // hover tooltip
    if (hover && active(hover) && t - hoverT < 3) {
      const d = hover, dist = d.tb >= 0 ? Math.round(Math.hypot(d.tx - d.x, d.ty - d.y)) : 0;
      const what = d.st === 'scout' ? 'change-map scout' : d.st === 'conf' ? 'confirming a find' : d.st === 'home' ? 'returning to base' : d.iso ? `out of range, searching alone` : d.st === 'idle' ? 'waiting for a frontier' : `frontier, ${dist} m`;
      const s2 = `drone ${d.id}: ${what}`; ctx.font = `400 11.5px ${F.sans}`; const tw = ctx.measureText(s2).width;
      const bx = clamp(X(d.x) + 10, 6, W - tw - 22), by = clamp(Y(d.y) - 30, 74, H - 30);
      ctx.fillStyle = 'rgba(27,30,61,.94)'; roundRect(ctx, bx, by, tw + 16, 22, 11); ctx.fill(); ctx.strokeStyle = 'rgba(127,212,207,.5)'; ctx.lineWidth = 1; ctx.stroke();
      text(ctx, s2, bx + 8, by + 11.5, { size: 11.5, color: C.ink, base: 'middle' });
      ctx.strokeStyle = 'rgba(127,212,207,.45)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(X(d.x), Y(d.y), R_FINE * s, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    if (phase === 'summary' || phase === 'fade') drawSummary(W, H);
    let fade = 0;
    if (phase === 'run' && phaseT < .9) fade = 1 - phaseT / .9;
    if (phase === 'fade') fade = Math.min(1, phaseT / .9);
    if (fade > 0) { ctx.globalAlpha = fade; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }
  function status() {
    if (phase === 'home') return [C.teal, phone ? 'Nothing left unsearched: back to base' : 'Nothing left unsearched (β₀ = 0): the swarm flies back to base'];
    if (D.some((d) => d.st === 'scout')) return [C.rose, phone ? 'Scouts compare the flow with the before-map' : 'Three scouts fly the flow first, comparing it with the before-map'];
    if (Wd.groups.some((g) => g.st === 1)) return [C.heat, phone ? 'Thermal hit: neighbours gather to confirm' : 'Thermal hit: the nearest drones gather and confirm with the camera'];
    let pri = false; for (let b = 0; b < NB; b++) if (bpri[b] && bun[b] > btot[b] * DONE) { pri = true; break; }
    if (pri) return [C.rose, phone ? 'Searching where houses were, first' : 'Searching where the houses were first, then the slopes'];
    return [C.teal, phone ? 'Sweeping the slopes in spaced lanes' : 'Sweeping the slopes in evenly spaced lanes, no assignments'];
  }
  function hud(W, H) {
    const b0s = B0S.update(beta0, phase === 'run' ? simT : 0);
    if (phase === 'summary' || phase === 'fade') return;
    const [col, msg] = status(), y1 = phone ? 86 : 92, y2 = phone ? 103 : 111;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(fx0 + 4, y1 - 4.5, 3.6, 0, TAU); ctx.fill();
    text(ctx, msg, fx0 + 14, y1, { size: phone ? 12 : 13.5, color: C.ink, weight: 500 });
    text(ctx, phone ? 'outdoor: 2.5-D grid, 4 m cells, thermal, GPS on' : 'outdoor mode: 2.5-D grid, 4 m cells, thermal first, GPS on', fx0 + 14, y2, { size: phone ? 10.5 : 11.5, color: C.faint });
    // β₀ counter and clock
    const bx = phone ? fx0 : fx1, al = phone ? 'left' : 'right';
    if (phone) {
      const y3 = 119; text(ctx, 'unsearched patches (β₀)', fx0 + 14, y3, { size: 10.5, color: C.muted });
      ctx.font = `400 10.5px ${F.sans}`; const lw2 = ctx.measureText('unsearched patches (β₀)').width;
      text(ctx, b0s, fx0 + 20 + lw2, y3 + .5, { size: 13, color: b0s === '0' ? C.teal : b0s === '…' ? C.muted : '#B4B1E0', font: F.mono, weight: 500 });
      text(ctx, `${fmtClock(simT)} · ×${TL}`, fx1, y3, { size: 10.5, color: C.faint, font: F.mono, align: 'right' });
      scaleBar(fx0 + 4, H - 38);
    } else {
      text(ctx, b0s, bx, y1 + 1, { size: 17, color: b0s === '0' ? C.teal : b0s === '…' ? C.muted : '#B4B1E0', font: F.mono, weight: 500, align: al });
      ctx.font = `500 17px ${F.mono}`; const nw = ctx.measureText(b0s).width;
      text(ctx, 'unsearched patches (β₀)', bx - nw - 8, y1, { size: 12, color: C.muted, align: al });
      text(ctx, `${fmtClock(simT)} sim · time-lapse ×${TL}`, bx, y2, { size: 11.5, color: C.faint, font: F.mono, align: al });
      scaleBar(fx0, H - 14);
    }
  }
  function scaleBar(x, y) {
    let m = 100; for (const c of [100, 200, 250, 500]) if (c * s <= (phone ? 90 : 130)) m = c;
    const L = m * s;
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + L, y); ctx.lineTo(x + L, y - 4); ctx.moveTo(x + L / 2, y); ctx.lineTo(x + L / 2, y - 2.5); ctx.stroke();
    text(ctx, `${m} m`, x + L + 7, y + .5, { size: 11, color: C.muted, font: F.mono, base: 'middle' });
    // north arrow
    ctx.font = `400 11px ${F.mono}`; const nx = x + L + 18 + ctx.measureText(`${m} m`).width; ctx.fillStyle = C.muted; ctx.beginPath(); ctx.moveTo(nx, y - 9); ctx.lineTo(nx + 3.5, y); ctx.lineTo(nx, y - 2.5); ctx.lineTo(nx - 3.5, y); ctx.closePath(); ctx.fill();
    text(ctx, 'N', nx + 7, y - 3, { size: 10, color: C.faint, base: 'middle' });
  }
  function drawSummary(W, H) {
    if (!summary) return;
    const a = phase === 'summary' ? smooth(0, .5, phaseT) : 1, S = summary;
    const pw = phone ? Math.min(W - 24, 340) : 400, rows = [
      [C.teal, `${S.km2.toFixed(2)} km²`, 'searched; nothing left unsearched (β₀ = 0)'],
      [C.rose, String(S.houses), `houses under the mud, mapped against the before-map: dig sites for ground teams`],
      [C.heat, String(S.people), S.groups > 1 ? `people found alive in ${S.groups} places, at the flow's edges and cut off on slopes` : 'people found alive'],
      [C.muted, fmtClock(S.t), `of flight for ${NDR} drones, time-lapse ×${TL}`],
    ];
    const lh = phone ? 40 : 44, ph = 64 + rows.length * lh, cx = (fx0 + fx1) / 2, cy = (fy0 + fy1) / 2, x0 = clamp(cx - pw / 2, fx0, W - pw - 12), y0 = clamp(cy - ph / 2, 76, H - ph - 80);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(27,30,61,.92)'; roundRect(ctx, x0, y0, pw, ph, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(220,214,236,.14)'; ctx.lineWidth = 1; ctx.stroke();
    text(ctx, 'Hillside searched', x0 + 20, y0 + 34, { size: phone ? 17 : 20, color: C.ink, font: F.serif });
    rows.forEach(([col, big, small], q) => {
      const yy = y0 + 66 + q * lh;
      text(ctx, big, x0 + 20, yy, { size: phone ? 15 : 17, color: col, font: F.mono, weight: 500 });
      wrap(small, x0 + (phone ? 108 : 122), yy - 5, pw - (phone ? 124 : 140), phone ? 11 : 12);
    });
    ctx.globalAlpha = 1;
  }
  function wrap(s2, x, y, w, size) {
    ctx.font = `400 ${size}px ${F.sans}`; const words = s2.split(' '); let line = '', yy = y; const lines = [];
    for (const wd of words) { const tt = line ? line + ' ' + wd : wd; if (ctx.measureText(tt).width > w && line) { lines.push(line); line = wd; } else line = tt; }
    lines.push(line);
    const top = yy - (lines.length - 1) * (size + 3) / 2;
    lines.forEach((l, q) => text(ctx, l, x, top + q * (size + 3), { size, color: C.muted, base: 'middle' }));
  }

  // ------------------------------------------------------------ pointer: hover or tap a drone for a tiny tooltip
  const pick = (e) => {
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = null, bd = (e.pointerType === 'mouse' ? 14 : 24) ** 2;
    for (const d of D) { if (!active(d)) continue; const q = (X(d.x) - x) ** 2 + (Y(d.y) - y) ** 2; if (q < bd) { bd = q; best = d; } }
    return best;
  };
  const onMove = (e) => { if (e.pointerType !== 'mouse') return; const d = pick(e); if (d) { hover = d; hoverT = wallT; } el.style.cursor = d ? 'help' : ''; };
  const onDown = (e) => { const d = pick(e); if (d) { hover = d; hoverT = wallT; } };
  const onLeave = () => { hover = null; el.style.cursor = ''; };
  el.addEventListener('pointermove', onMove); el.addEventListener('pointerdown', onDown); el.addEventListener('pointerleave', onLeave);

  // ------------------------------------------------------------ readouts, layout changes, loop
  const rA = kit.readout(readouts, { label: 'Area searched', tone: 'teal' });
  const rH = kit.readout(readouts, { label: 'Buried houses located', tone: 'rose' });
  const rP = kit.readout(readouts, { label: 'People found', tone: 'heat' });
  const cloudPat = ctx.createPattern(CLOUD, 'repeat'), mistPat = ctx.createPattern(MIST, 'repeat');
  let lw0 = 0, lh0 = 0;
  function relayout() {
    layout(); lw0 = cv.w; lh0 = cv.h;
    if (jobKind) {                                                        // a new mission was being built: finish it now and start it
      if (jobKind === 'prep' && job) runSync(job);
      job = null; jobKind = ''; runSync(renderTerrain(nextW)); Wd = nextW; nextW = null; newMission(); return;
    }
    runSync(renderTerrain(Wd)); renderFog();
  }
  cv.onResize(() => { if (Wd) relayout(); });
  Wd = runSync(gen(3 + Math.floor(Math.random() * 500)));
  layout(); lw0 = cv.w; lh0 = cv.h;
  runSync(initGrids(Wd)); runSync(renderTerrain(Wd)); newMission();
  const loop = kit.loop((dt) => {
    if ((parseFloat(stage.dataset.left) || 0) !== leftFrac || cv.w !== lw0 || cv.h !== lh0) relayout();
    // the first frame after a long task can arrive with a timestamp older than start(): never step time backwards
    step(dt > 0 ? Math.min(dt, .05) : 0); draw();
    rA.set(`${(shrN * CELL * CELL / 1e6).toFixed(2)} km²`); rH.set(String(located)); rP.set(String(found));
  });
  draw();
  return {
    start: loop.start, stop: loop.stop, dbg,
    bench(n = 120) { let a = 0, b = 0; for (let q = 0; q < n; q++) { const t0 = performance.now(); step(1 / 60); const t1 = performance.now(); draw(); a += t1 - t0; b += performance.now() - t1; } return { stepMs: +(a / n).toFixed(3), drawMs: +(b / n).toFixed(3) }; },
    until(ph, max = 120) { for (let q = 0; q < max * 20 && phase !== ph; q++) step(.05); draw(); return { phase, wallT: +wallT.toFixed(1) }; },
    warp(sec) { for (let q = 0; q < sec * 20; q++) step(.05); draw(); return { phase, simT: Math.round(simT), wallT: +wallT.toFixed(1), beta0, located, found, km2: +(shrN * 16 / 1e6).toFixed(3), nIso, mission: missionN }; },
    destroy() { loop.stop(); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerleave', onLeave); cv.destroy(); },
  };
}

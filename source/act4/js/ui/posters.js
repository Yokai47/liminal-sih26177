// Small illustrated posters for the mission picker, drawn procedurally on a 2-D canvas (one per mission).
const rng = (s) => () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
function grad(x, w, h, stops, y0 = 0, y1 = h) { const g = x.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); x.fillStyle = g; x.fillRect(0, 0, w, h); }
function glow(x, px, py, r, col, a = 1) { const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, col.replace('A', a)); g.addColorStop(.35, col.replace('A', a * .35)); g.addColorStop(1, col.replace('A', 0)); x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill(); }
function drone(x, px, py, s = 1, a = 1) { glow(x, px, py, 9 * s, 'rgba(127,212,207,A)', .55 * a); x.fillStyle = `rgba(214,248,245,${a})`; x.beginPath(); x.arc(px, py, 1.7 * s, 0, 7); x.fill(); }
// isometric box helper: (gx, gz) ground position, w, d footprint, hgt height
function iso(x, ox, oy, k, gx, gz, w, d, hgt, top, left, right) {
  const P = (a, b, c) => [ox + (a - b) * k * .87, oy + (a + b) * k * .5 - c * k];
  const A = P(gx, gz, hgt), B = P(gx + w, gz, hgt), C2 = P(gx + w, gz + d, hgt), D = P(gx, gz + d, hgt), E = P(gx + w, gz + d, 0), F = P(gx, gz + d, 0), G = P(gx + w, gz, 0);
  x.fillStyle = left; x.beginPath(); x.moveTo(...D); x.lineTo(...C2); x.lineTo(...E); x.lineTo(...F); x.closePath(); x.fill();
  x.fillStyle = right; x.beginPath(); x.moveTo(...B); x.lineTo(...C2); x.lineTo(...E); x.lineTo(...G); x.closePath(); x.fill();
  x.fillStyle = top; x.beginPath(); x.moveTo(...A); x.lineTo(...B); x.lineTo(...C2); x.lineTo(...D); x.closePath(); x.fill();
}
export const POSTERS = {
  city(x, w, h, t = 0) {
    grad(x, w, h, [[0, '#2A2D62'], [.55, '#6A5E96'], [1, '#C9A3B8']]);
    glow(x, w * .18, h * .62, w * .5, 'rgba(255,201,176,A)', .35);
    const k = w / 26, ox = w * .52, oy = h * .3, r = rng(7);
    x.fillStyle = 'rgba(46,44,84,.9)'; x.beginPath(); const P = (a, b) => [ox + (a - b) * k * .87, oy + (a + b) * k * .5]; x.moveTo(...P(-2, -2)); x.lineTo(...P(16, -2)); x.lineTo(...P(16, 16)); x.lineTo(...P(-2, 16)); x.closePath(); x.fill();
    const blocks = [[0, 0, 4, 4, 7], [6, 0, 4, 3.5, 5], [12, 0, 3, 4, 8], [0, 6, 4, 4, 0], [6, 6, 4, 4, 6], [12, 6, 3.5, 4, 0], [0, 12, 4, 3, 5], [6, 12, 4, 3, 4], [12, 12, 3, 3, 6]];
    for (const [gx, gz, bw, bd, hh] of blocks) {
      if (hh) iso(x, ox, oy, k, gx, gz, bw, bd, hh, '#E5D9E2', '#B2A6C4', '#9A8FB4');
      else for (let q = 0; q < 26; q++) { const a = gx + r() * bw, b = gz + r() * bd, s = .5 + r() * .9; iso(x, ox, oy, k, a, b, s, s * (.6 + r() * .6), .3 + r() * 1.6, '#C9BCCD', '#9B90B0', '#877DA0'); }
    }
    // van + tether
    const vx = ox + (-1 - 15) * k * .87, vy = oy + (-1 + 15) * k * .5; x.fillStyle = '#EFE3E6'; x.fillRect(vx - 10, vy - 10, 22, 10); x.fillStyle = '#F08A7E'; x.fillRect(vx - 2, vy - 13, 8, 3);
    x.strokeStyle = 'rgba(30,33,64,.8)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(vx, vy - 12); x.quadraticCurveTo(vx + 4, vy - h * .25, vx + 8, vy - h * .42); x.stroke();
    glow(x, vx + 8, vy - h * .42, 26, 'rgba(255,230,196,A)', .6); x.fillStyle = '#FFF1DC'; x.beginPath(); x.arc(vx + 8, vy - h * .42, 2.6, 0, 7); x.fill();
    for (let i = 0; i < 18; i++) { const a = i * 2.4 + t * .4, rr = 30 + (i % 5) * 16; drone(x, ox + Math.cos(a) * rr * 1.4 + 20, oy + h * .3 + Math.sin(a) * rr * .55, .9); }
    glow(x, ox + 6 * k * .87 * 0 + k * 2, oy + (6 + 3) * k * .5 + 10, 18, 'rgba(255,195,107,A)', .9);
  },
  flood(x, w, h, t = 0) {
    grad(x, w, h, [[0, '#9CA3C6'], [.38, '#C4C8DC'], [.42, '#7891B7'], [1, '#4E6A99']]);
    const r = rng(11);
    for (let i = 0; i < 70; i++) { const y = h * .42 + r() * h * .58, xx = r() * w; x.strokeStyle = `rgba(220,232,245,${.08 + r() * .14})`; x.lineWidth = 1; x.beginPath(); x.moveTo(xx, y); x.lineTo(xx + 10 + r() * 30, y); x.stroke(); }
    for (let i = 0; i < 16; i++) { const px = r() * w, py = h * .5 + r() * h * .45, s = 10 + r() * 14; x.fillStyle = r() < .5 ? '#E9B8B5' : '#F2D3B7'; x.beginPath(); x.moveTo(px - s, py); x.lineTo(px, py - s * .55); x.lineTo(px + s, py); x.lineTo(px, py + s * .45); x.closePath(); x.fill(); x.fillStyle = 'rgba(30,33,64,.18)'; x.beginPath(); x.moveTo(px, py - s * .55); x.lineTo(px + s, py); x.lineTo(px, py + s * .45); x.closePath(); x.fill(); }
    for (let i = 0; i < 9; i++) { const px = r() * w, py = h * .5 + r() * h * .45; x.fillStyle = '#8FA79A'; x.beginPath(); x.arc(px, py, 6 + r() * 5, 0, 7); x.fill(); }
    // the front: an even line of drones over the water
    for (let i = 0; i < 9; i++) drone(x, w * .08 + i * w * .105, h * .54 + Math.sin(i * 1.3 + t) * 4, 1);
    x.strokeStyle = 'rgba(255,195,107,.25)'; x.setLineDash([3, 4]); x.beginPath(); x.moveTo(w * .05, h * .58); x.lineTo(w * .95, h * .58); x.stroke(); x.setLineDash([]);
    const bx = w * .3, by = h * .82; x.strokeStyle = 'rgba(240,248,255,.5)'; x.beginPath(); x.moveTo(bx - 40, by + 8); x.lineTo(bx, by); x.lineTo(bx - 40, by - 8); x.stroke();
    x.fillStyle = '#F6E6D8'; x.beginPath(); x.ellipse(bx, by, 12, 5, 0, 0, 7); x.fill(); x.fillStyle = '#F6D2B1'; x.fillRect(bx - 4, by - 7, 7, 5);
    x.strokeStyle = 'rgba(30,33,64,.7)'; x.beginPath(); x.moveTo(bx, by - 6); x.quadraticCurveTo(bx + 6, by - 40, bx + 2, by - h * .45); x.stroke(); glow(x, bx + 2, by - h * .45, 18, 'rgba(255,230,196,A)', .7);
    glow(x, w * .72, h * .7, 14, 'rgba(255,195,107,A)', .95);
  },
  forest(x, w, h, t = 0) {
    grad(x, w, h, [[0, '#F2C7A1'], [.4, '#D9A79A'], [1, '#5E7468']]);
    glow(x, w * .82, h * .18, w * .45, 'rgba(255,214,160,A)', .5);
    const r = rng(5);
    x.strokeStyle = 'rgba(140,175,200,.75)'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, h * .9); x.bezierCurveTo(w * .3, h * .7, w * .5, h * .95, w, h * .78); x.stroke();
    for (let i = 0; i < 90; i++) { const px = r() * w * 1.1 - w * .05, py = h * .35 + r() * h * .7, s = 10 + r() * 16; const sh = r(); x.fillStyle = sh < .33 ? '#6F8F7A' : sh < .66 ? '#86A592' : '#9DB8A0'; x.beginPath(); x.arc(px, py, s, 0, 7); x.fill(); x.fillStyle = 'rgba(255,226,180,.18)'; x.beginPath(); x.arc(px - s * .3, py - s * .35, s * .55, 0, 7); x.fill(); }
    for (let i = 0; i < 8; i++) drone(x, w * .1 + i * w * .11, h * .26 + Math.sin(i + t) * 5, 1);
    for (let i = 0; i < 4; i++) drone(x, w * .2 + i * w * .17, h * .72 + Math.cos(i) * 8, .7, .5);
    glow(x, w * .64, h * .8, 16, 'rgba(255,195,107,A)', .95);
    glow(x, w * .36, h * .62, 12, 'rgba(255,195,107,A)', .35);
  },
  cave(x, w, h, t = 0) {
    grad(x, w, h, [[0, '#2A2D5A'], [.25, '#24264B'], [1, '#15172F']]);
    x.fillStyle = '#3A3A62'; x.beginPath(); x.moveTo(0, h * .26); for (let i = 0; i <= 20; i++) x.lineTo(i / 20 * w, h * (.16 + .08 * Math.sin(i * 1.7)) + (i > 3 ? 0 : 6)); x.lineTo(w, h); x.lineTo(0, h); x.closePath(); x.fill();
    const r = rng(3); x.lineCap = 'round';
    const path = [[w * .06, h * .3], [w * .2, h * .42], [w * .38, h * .46], [w * .52, h * .58], [w * .7, h * .56], [w * .86, h * .7]];
    const draw = (pts, wd, col) => { x.strokeStyle = col; x.lineWidth = wd; x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(...p) : x.moveTo(...p))); x.stroke(); };
    draw(path, 16, '#1A1B36'); draw([[w * .38, h * .46], [w * .46, h * .32], [w * .6, h * .28]], 12, '#1A1B36'); draw([[w * .52, h * .58], [w * .5, h * .8], [w * .66, h * .86]], 12, '#1A1B36');
    draw(path.slice(0, 4), 3, 'rgba(127,212,207,.55)'); draw([[w * .38, h * .46], [w * .46, h * .32], [w * .6, h * .28]], 2.5, 'rgba(127,212,207,.4)');
    x.fillStyle = 'rgba(94,127,176,.8)'; x.fillRect(w * .62, h * .55, w * .14, h * .04); x.fillRect(w * .5, h * .78, w * .1, h * .05);
    glow(x, w * .06, h * .26, 40, 'rgba(255,230,196,A)', .6);
    for (const [px, py] of [[w * .2, h * .42], [w * .38, h * .46], [w * .46, h * .32]]) { glow(x, px, py, 8, 'rgba(246,210,177,A)', .9); }
    drone(x, w * .5, h * .56, 1); drone(x, w * .58, h * .29, .9); drone(x, w * .3, h * .45, .9);
    glow(x, w * .86, h * .66, 14, 'rgba(255,195,107,A)', .9);
    for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(220,214,236,${r() * .08})`; x.fillRect(r() * w, r() * h, 1, 1); }
  },
};

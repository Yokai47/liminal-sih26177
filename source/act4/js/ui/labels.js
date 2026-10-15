// Labels pinned to 3-D positions (projected every frame) and the numbered β0 blobs of the Proof lens.
import * as THREE from 'three';
export function createLabels(el) {
  const pool = [], nums = [];
  const v = new THREE.Vector3();
  let used = 0, usedN = 0;
  const get = () => { if (used >= pool.length) { const d = document.createElement('div'); d.className = 'a4lab'; el.appendChild(d); pool.push({ d, html: '', cls: '' }); } return pool[used++]; };
  const getN = () => { if (usedN >= nums.length) { const d = document.createElement('div'); d.className = 'a4num'; el.appendChild(d); nums.push({ d, t: '' }); } return nums[usedN++]; };
  let W = 1, H = 1, cam = null;
  function begin(camera, w, h) { cam = camera; W = w; H = h; used = 0; usedN = 0; boxes.length = 0; }
  function project(x, y, z) { v.set(x, y, z).project(cam); if (v.z > 1 || v.z < -1) return null; return [(v.x * .5 + .5) * W, (-v.y * .5 + .5) * H]; }
  // html: inner html; cls: tone class; a: opacity; dy: pixels above the point
  const boxes = [];
  function add(x, y, z, html, cls = '', a = 1, dy = 10, prio = 0) {
    const p = project(x, y, z); if (!p || a < .02) return; if (p[0] < -40 || p[0] > W + 40 || p[1] < 0 || p[1] > H + 20) return;
    const L = get(); if (L.html !== html) { L.d.innerHTML = html; L.html = html; L.w = 0; } if (L.cls !== cls) { L.d.className = 'a4lab ' + cls; L.cls = cls; }
    if (!L.w) { L.w = L.d.offsetWidth || 120; L.h = L.d.offsetHeight || 34; }
    // nudge up until it does not cover an earlier label
    p[0] = Math.max(L.w / 2 + 8, Math.min(W - L.w / 2 - 8, p[0])); // keep the whole label on screen
    let yy = p[1] - dy; const x0 = p[0] - L.w / 2, x1 = p[0] + L.w / 2;
    for (let it = 0; it < 6; it++) { let hit = false; for (const b of boxes) if (x0 < b[2] && x1 > b[0] && yy - L.h < b[3] && yy > b[1]) { yy = b[1] - 4; hit = true; } if (!hit) break; }
    boxes.push([x0, yy - L.h, x1, yy]);
    L.d.style.transform = `translate(${p[0].toFixed(1)}px, ${yy.toFixed(1)}px) translate(-50%, -100%)`; L.d.style.opacity = a.toFixed(2);
  }
  function num(x, y, z, t, a = 1) {
    const p = project(x, y, z); if (!p || a < .02) return; const N = getN(); if (N.t !== t) { N.d.textContent = t; N.t = t; }
    N.d.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px) translate(-50%, -50%)`; N.d.style.opacity = a.toFixed(2);
  }
  function end() { for (let i = used; i < pool.length; i++) if (pool[i].d.style.opacity !== '0') pool[i].d.style.opacity = '0'; for (let i = usedN; i < nums.length; i++) if (nums[i].d.style.opacity !== '0') nums[i].d.style.opacity = '0'; }
  return { begin, add, num, end, project };
}

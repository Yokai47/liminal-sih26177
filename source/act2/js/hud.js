/* LIMINAL · Act 2 · hud.js — everything drawn on top of the view.
   OSD (flight-stack telemetry, like a game's performance overlay), sensor switches, mode/speed,
   right column: MAP (log-odds occupancy + frontiers + plan), ACOUSTIC (raw vs clean spectrogram, classes, DoA),
   REASONING (now / why / next + decision trace). On phones the right column becomes a tabbed bottom sheet. */
export const SENSORS = [
  { k: 'lidar', name: 'LiDAR', c: '#60c8ff', tag: 'RPLidar A1 · servo-tilted', on: 'SLAM + the occupancy map + obstacle avoidance', off: 'No SLAM, no map: the autonomy can only hold and go home' },
  { k: 'camera', name: 'Camera', c: '#f4f4f2', tag: 'AR0234 · YOLOv8n on Hailo-8', on: 'Labels people and hazards; PointPainting gives them 3-D positions', off: 'No labels: heat alone can’t tell a person from a warm machine' },
  { k: 'thermal', name: 'Thermal', c: '#ff7a1a', tag: 'LWIR · being added', on: 'Body heat; sees through smoke', off: 'No heat check: a mannequin passes as a person' },
  { k: 'acoustic', name: 'Acoustic', c: '#b49cff', tag: '4-mic array · planned', on: 'Hears calls, moans, tapping; gives a direction', off: 'Deaf: exploration has no acoustic prior' },
  { k: 'flow', name: 'Optical flow', c: '#5ef2b5', tag: 'Matek 3901-L0X', on: 'Velocity for EKF3; holds position where SLAM is weak', off: 'Long corridors and smoke let the position slide' },
];

export function createHUD(host, { PH, CLASSES }) {
  injectCSS();
  const root = document.createElement('div'); root.className = 'a2' + (PH ? ' a2ph' : '');
  root.innerHTML = `
  <div class="a2fpv"></div>
  <div class="a2load"><div class="a2k">ACT 2 · LOADING THE BUILDING</div><div class="a2bar"><i></i></div><div class="a2lt">textures · models · BVH · LiDAR point set</div></div>
  <div class="a2intro" hidden>
    <div class="a2k">ACT 2 · YOU ARE THE DRONE</div>
    <h2>A floor has collapsed. Four people are somewhere inside.</h2>
    <p>No GPS. No map. Smoke, water, live wires. The drone builds its own map, decides where to look next, and listens. Watch it think, or take the sticks.</p>
    <div class="a2btns c"><button class="a2btn" data-go="AUTO">Watch it search on its own</button><button class="a2btn ghost" data-go="MANUAL">Fly it yourself</button></div>
    <button class="a2back" data-back>Back to the story</button>
    <p class="a2small">${PH ? 'Hold = fly forward · drag = steer' : 'Click-hold or W = forward · mouse / A-D = turn · Q-E = strafe'} · any input takes control (LOITER) · switch sensors off at any time</p>
  </div>
  <div class="a2hud" hidden>
    <div class="a2osd"></div>
    <div class="a2top">
      <div class="a2seg a2mode"><button data-mode="AUTO">AUTO<span> · GUIDED</span></button><button data-mode="MANUAL">MANUAL<span> · LOITER</span></button></div>
      <div class="a2seg a2spd">${[1, 2, 4].map(s => `<button data-spd="${s}">×${s}</button>`).join('')}</div>
      <button class="a2rtl" title="Return to launch and land">⌂<span> RETURN HOME</span></button>
      <button class="a2end" title="Stop here and see the mission report">■ END</button>
      <div class="a2clock">00:00</div>
      <button class="a2guide" title="Show the guide again">?</button>
    </div>
    <div class="a2help" hidden>${PH ? 'hold = forward · drag = turn' : 'W / S forward · A / D or mouse turn · Q / E strafe'} · hover still to scan · AUTO hands back · ⌂ to finish</div>
    <div class="a2sens"><div class="a2k">SENSORS</div>${SENSORS.map(s => `<button data-s="${s.k}" style="--c:${s.c}"><i></i><span><b>${s.name}</b><small>${s.tag}</small><em class="on">${s.on}</em><em class="off">${s.off}</em></span></button>`).join('')}
      <div class="a2lock"><i></i><span><b>IMU ×3 · baro · ToF</b><small>always on: it can’t fly without them</small></span></div></div>
    <div class="a2pip" hidden><span>THERMAL · LWIR</span><em></em></div>
    <div class="a2ring"><svg viewBox="0 0 100 100">${['acoustic', 'thermal', 'camera', 'lidar'].map((k, i) => seg(k, i)).join('')}</svg><div class="a2ringt"><b>EXPLORING</b><span></span></div></div>
    <div class="a2arc"><svg viewBox="0 0 200 200"><path d="M74 10 A92 92 0 0 1 126 10"/></svg><b></b></div>
    <div class="a2labels"></div>
    <div class="a2toast"></div>
    <div class="a2side">
      <div class="a2tabs">${['MAP', 'AUDIO', 'THINK', 'SYS'].map((t, i) => `<button data-tab="${t}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div>
      <section class="a2map" data-p="MAP"><header><b>MAP</b><span>2.5-D occupancy · 0.25 m cells · log-odds ℓ = ln p/(1−p)</span></header>
        <canvas></canvas><div class="a2maprd"></div>
        <div class="a2leg"><span class="u">unknown</span><span class="f">free ℓ&lt;0</span><span class="o">occupied ℓ&gt;0</span><span class="fr">frontier</span><span class="pa">plan</span></div></section>
      <section class="a2aud" data-p="AUDIO"><header><b>ACOUSTIC</b><span class="a2mon">monitor <button data-mon="off" class="on">off</button><button data-mon="raw">raw mic</button><button data-mon="clean">clean</button></span></header>
        <div class="a2spec"><canvas class="raw"></canvas><label>RAW · 4-mic sum</label></div>
        <div class="a2spec"><canvas class="clean"></canvas><label>CLEAN · ego-noise removed · class mask</label></div>
        <div class="a2pipe">4 mics → rotor ego-noise subtracted → class mask keeps <b>voice · moan · tapping</b>, suppresses water · arc · fire · creak · siren → GCC-PHAT direction → bearings fused on 1 m cells</div>
        <div class="a2audrow"><div class="a2cls">${CLASSES.map((c, i) => `<div data-c="${i}" class="${c.human ? 'h' : ''}" style="--c:${c.c}"><span>${c.k}</span><i><u></u></i><em></em></div>`).join('')}</div><canvas class="a2doa"></canvas></div>
        <div class="a2audnote"></div></section>
      <section class="a2think" data-p="THINK"><header><b>REASONING</b><span class="a2st"></span><button class="a2exp" title="Open the full reasoning history">⤢ history</button></header><div class="a2why"></div><div class="a2log"></div></section>
    </div>
  </div>
  <div class="a2score" hidden></div>`;
  host.appendChild(root);
  const q = s => root.querySelector(s);
  const ui = { root, fpv: q('.a2fpv'), load: q('.a2load'), bar: q('.a2bar i'), intro: q('.a2intro'), hud: q('.a2hud'), osd: q('.a2osd'), clock: q('.a2clock'), sens: q('.a2sens'),
    pip: q('.a2pip'), pipNote: q('.a2pip em'), ring: q('.a2ring'), ringL: q('.a2ringt b'), ringS: q('.a2ringt span'), arc: q('.a2arc'), arcT: q('.a2arc b'), labels: q('.a2labels'), toast: q('.a2toast'),
    side: q('.a2side'), map: q('.a2map canvas'), mapRd: q('.a2maprd'), raw: q('.a2spec canvas.raw'), clean: q('.a2spec canvas.clean'), cls: q('.a2cls'), doa: q('.a2doa'), audNote: q('.a2audnote'),
    why: q('.a2why'), log: q('.a2log'), st: q('.a2st'), score: q('.a2score'), mode: q('.a2mode'), spd: q('.a2spd'), mon: q('.a2mon'), tabs: q('.a2tabs'), rtl: q('.a2rtl'), end: q('.a2end'), help: q('.a2help'), think: q('.a2think'), guide: q('.a2guide'), exp: q('.a2exp') };
  // OSD rows
  const OSD = [['FC', '#9fdcff'], ['EKF3', '#9fdcff'], ['SLAM', '#60c8ff'], ['FLOW', '#5ef2b5'], ['MAP', '#60c8ff'], ['NPU', '#f4f4f2'], ['MIC', '#b49cff'], ['PI 5', '#c8d6e4'], ['PWR', '#ffd36b']];
  ui.osd.innerHTML = OSD.map(([k, c]) => `<div class="r" data-k="${k}"><b style="--c:${c}">${k}</b><span></span><canvas width="64" height="16"></canvas></div>`).join('');
  ui.osdRows = Object.fromEntries([...ui.osd.querySelectorAll('.r')].map(r => [r.dataset.k, { t: r.querySelector('span'), c: r.querySelector('canvas'), h: [] }]));
  // tabs (phone)
  ui.tabs.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; setTab(b.dataset.tab); });
  function setTab(t) { ui.tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); root.dataset.tab = t; }
  setTab('MAP'); ui.setTab = setTab;
  return ui;

  function seg(k, i) { const a0 = i * 90 + 4, a1 = a0 + 82; const p = a => { const r = a * Math.PI / 180; return [50 + 42 * Math.sin(r), 50 - 42 * Math.cos(r)]; }; const [x0, y0] = p(a0), [x1, y1] = p(a1); const S = SENSORS.find(s => s.k === k);
    return `<g><path d="M${x0} ${y0} A42 42 0 0 1 ${x1} ${y1}" class="bg"/><path d="M${x0} ${y0} A42 42 0 0 1 ${x1} ${y1}" pathLength="100" data-seg="${k}" style="stroke:${S.c}"/></g>`; }
}

export function spark(row, v, max, color) {
  const h = row.h; h.push(v); if (h.length > 64) h.shift();
  const c = row.c, x = c.getContext('2d'); x.clearRect(0, 0, 64, 16); x.strokeStyle = color; x.lineWidth = 1; x.beginPath();
  const m = max || Math.max(1e-6, ...h); h.forEach((y, i) => { const px = i + (64 - h.length), py = 15 - Math.min(1, y / m) * 13; i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke();
}

function injectCSS() {
  if (document.getElementById('a2v2css')) return;
  const s = document.createElement('style'); s.id = 'a2v2css';
  s.textContent = `
.a2{position:absolute;inset:0;font:12px/1.4 "Geist Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;color:#e9eef4;overflow:hidden;background:#030d22;--side:min(372px,30vw)}
.a2 *{box-sizing:border-box}.a2 button{font:inherit;color:inherit;cursor:pointer}.a2 [hidden]{display:none!important}
.a2fpv{position:absolute;inset:0}.a2fpv canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;outline:none}
.a2k{font-size:10.5px;letter-spacing:.16em;color:#8fb6d8;margin-bottom:6px}
.a2load{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#030d22;z-index:5}
.a2bar{width:min(320px,70%);height:3px;background:#12284a;border-radius:2px;overflow:hidden}.a2bar i{display:block;height:100%;width:0;background:#60c8ff;transition:width .2s}.a2lt{font-size:10.5px;color:#56708c}
.a2intro{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;background:radial-gradient(ellipse at center,rgba(3,13,34,.5),rgba(3,13,34,.94));z-index:4}
.a2intro h2{font:300 clamp(24px,3.6vw,44px)/1.1 Geist,system-ui,sans-serif;margin:0 0 12px;max-width:17em}
.a2intro p{color:#b8c7d6;max-width:36em;margin:0 0 20px;font-size:13px}.a2small{font-size:11px!important;color:#7f93a8!important;margin-top:16px!important}
.a2btns{display:flex;gap:10px;flex-wrap:wrap}.a2btns.c{justify-content:center}
.a2btn{background:#F4F4F2;color:#030d22!important;border:0;border-radius:999px;padding:11px 22px;font-weight:600;letter-spacing:.03em}.a2btn.ghost{background:transparent;color:#F4F4F2!important;border:1px solid #4a6a8c}
.a2hud{position:absolute;inset:0;pointer-events:none}.a2hud button,.a2hud canvas,.a2side,.a2sens{pointer-events:auto}
.a2osd{position:absolute;left:12px;top:12px;width:440px;background:rgba(2,10,26,.62);border:1px solid rgba(96,200,255,.16);border-radius:8px;padding:6px 8px;backdrop-filter:blur(6px);font-size:10.5px}
.a2osd .r{display:grid;grid-template-columns:36px 1fr 64px;gap:6px;align-items:center;height:17px;white-space:nowrap}
.a2osd .r b{font-weight:600;color:var(--c);letter-spacing:.04em}.a2osd .r span{overflow:hidden;text-overflow:ellipsis;color:#c8d6e4}.a2osd .r span i{font-style:normal;color:#fff}.a2osd .r span .w{color:#ffb35c}.a2osd .r span .bad{color:#ff6b6b}.a2osd .r span .ok{color:#5ef2b5}.a2osd canvas{width:64px;height:16px}
.a2top{position:absolute;top:12px;right:calc(var(--side) + 12px);display:flex;gap:8px;align-items:center}
.a2seg{display:flex;background:rgba(2,10,26,.7);border:1px solid #1d3550;border-radius:999px;padding:2px}.a2seg button{background:none;border:0;border-radius:999px;padding:5px 11px;font-size:10.5px;letter-spacing:.06em;color:#8fa5bb}
.a2seg button.on{background:#e9eef4;color:#030d22}.a2mode button[data-mode=MANUAL].on{background:#ffb35c}
.a2rtl{background:rgba(2,10,26,.7);border:1px solid #1d3550;border-radius:999px;padding:5px 11px;font-size:10.5px;letter-spacing:.06em;color:#9fdcff}.a2rtl:hover{border-color:#9fdcff}
.a2end{background:rgba(2,10,26,.7);border:1px solid #5a2a38;border-radius:999px;padding:5px 11px;font-size:10.5px;letter-spacing:.06em;color:#ff9fb0;cursor:pointer}.a2end:hover{border-color:#ff9fb0;background:rgba(60,14,26,.8)}
.a2back{margin-top:14px;background:none;border:0;color:#9fb6cc;font-size:12.5px;text-decoration:underline;text-underline-offset:4px;cursor:pointer;padding:8px}.a2back:hover{color:#fff}
.a2scrollhint{margin:10px 0 0;font-size:11px;color:#7f93a8}
.a2help{position:absolute;left:calc((100% - var(--side)) / 2);bottom:160px;transform:translateX(-50%);font-size:10.5px;color:#ffcf99;background:rgba(2,10,26,.6);border:1px solid rgba(255,179,92,.35);border-radius:999px;padding:4px 12px;white-space:nowrap}
.a2guide{width:28px;height:28px;border-radius:50%;background:rgba(2,10,26,.7);border:1px solid #1d3550;color:#9fdcff;font-weight:700;font-size:12px;padding:0}.a2guide:hover{border-color:#9fdcff}
.a2exp{margin-left:8px;background:none;border:1px solid #2b4a6b;border-radius:999px;padding:1px 8px;font-size:9.5px!important;color:#c8d6e4!important;letter-spacing:.04em}.a2exp:hover{border-color:#9fdcff;color:#fff!important}
.a2clock{background:rgba(2,10,26,.7);border:1px solid #1d3550;border-radius:999px;padding:5px 11px;font-size:11px;letter-spacing:.08em}
.a2sens{position:absolute;left:12px;top:192px;width:236px;background:rgba(2,10,26,.6);border:1px solid #1d3550;border-radius:10px;padding:8px;backdrop-filter:blur(6px)}
.a2sens button,.a2lock{display:flex;gap:8px;align-items:flex-start;width:100%;text-align:left;background:none;border:0;border-radius:7px;padding:5px 4px}.a2sens button:hover{background:rgba(96,200,255,.07)}
.a2sens i{flex:none;width:28px;height:15px;border-radius:9px;background:var(--c);position:relative;margin-top:1px;transition:background .2s}.a2sens i::after{content:"";position:absolute;right:2px;top:2px;width:11px;height:11px;border-radius:50%;background:#030d22;transition:right .2s}
.a2sens button.off i{background:#2a3a4c}.a2sens button.off i::after{right:15px;background:#8A8A86}
.a2sens b{display:block;font-weight:600;font-size:11.5px}.a2sens small{display:block;font-size:9.5px;color:#6f8aa6;letter-spacing:.02em}.a2sens em{display:block;font-style:normal;font-size:10px;color:#9fb3c7;line-height:1.3;margin-top:1px}
.a2sens button em.off{display:none}.a2sens button.off em.on{display:none}.a2sens button.off em.off{display:block;color:#ff9a9a}.a2sens button.off b{color:#8A8A86}.a2lock{opacity:.55}.a2lock i{background:#3d5068}.a2lock i::after{background:#8fb6d8}
.a2pip{position:absolute;left:12px;bottom:12px;border:1px solid rgba(255,122,26,.55);border-radius:6px;box-shadow:0 0 0 1px rgba(0,0,0,.5)}.a2pip span{position:absolute;left:8px;top:6px;font-size:10px;letter-spacing:.14em;color:#ffb36b;text-shadow:0 0 4px #000}
.a2pip em{position:absolute;left:8px;bottom:6px;font-style:normal;font-size:10px;color:#ffd9a8;text-shadow:0 0 4px #000}
.a2ring{position:absolute;left:calc((100% - var(--side)) / 2);bottom:14px;transform:translateX(-50%);width:140px;text-align:center}
.a2ring svg{width:140px;height:140px;display:block;filter:drop-shadow(0 0 6px rgba(0,0,0,.6))}.a2ring path{fill:none;stroke-width:6;stroke-linecap:round;stroke-dasharray:100;transition:stroke-dashoffset .25s}
.a2ring path.bg{stroke:rgba(140,170,200,.16);stroke-dasharray:none}.a2ring g.off path:not(.bg){stroke:#3a4656!important}
.a2ringt{position:absolute;left:0;right:0;top:44px;display:flex;flex-direction:column;align-items:center}.a2ringt b{font-size:12px;letter-spacing:.1em}.a2ringt span{font-size:9px;color:#9fb3c7;max-width:112px;line-height:1.25;margin-top:3px}
.a2ring.hot b{color:#ffd23f}.a2ring.warn b{color:#ff9a3d}.a2ring.violet b{color:#c9b8ff}.a2ring.bad b{color:#ff6b6b}.a2ring.dim b{color:#8A8A86}
.a2arc{position:absolute;left:calc((100% - var(--side)) / 2);top:50%;width:min(70vh,56%);aspect-ratio:1;transform:translate(-50%,-50%);opacity:0;transition:opacity .25s}.a2arc svg{width:100%;height:100%}
.a2arc path{fill:none;stroke:#b49cff;stroke-width:5;stroke-linecap:round;filter:drop-shadow(0 0 6px #b49cff)}.a2arc b{position:absolute;left:50%;top:-4px;transform:translateX(-50%);font-size:10px;font-weight:400;color:#d9ccff;white-space:nowrap;text-shadow:0 0 4px #000}
.a2lab{position:absolute;left:0;top:0;pointer-events:none}
.a2lab i{position:absolute;left:-26px;top:-26px;width:52px;height:52px;border:1.5px solid #F4F4F2;border-radius:4px;clip-path:polygon(0 0,30% 0,30% 8%,8% 8%,8% 30%,0 30%,0 70%,8% 70%,8% 92%,30% 92%,30% 100%,70% 100%,70% 92%,92% 92%,92% 70%,100% 70%,100% 30%,92% 30%,92% 8%,70% 8%,70% 0,100% 0,100% 100%,0 100%)}
.a2lab span{position:absolute;left:30px;top:-28px;white-space:nowrap;font-size:10.5px;background:rgba(3,13,34,.72);padding:2px 6px;border-radius:3px;border-left:2px solid #F4F4F2}
.a2lab.hot i{border-color:#ff9a3d}.a2lab.hot span{border-color:#ff9a3d;color:#ffd9a8}.a2lab.ok i{border-color:#ffd23f}.a2lab.ok span{border-color:#ffd23f;color:#fff2b0}
.a2lab.haz i{border-color:#ffd23f;border-style:dashed}.a2lab.haz span{border-color:#ffd23f;color:#ffe9a0}.a2lab.bad i{border-color:#ff6b6b}.a2lab.bad span{border-color:#ff6b6b;color:#ffb3b3}
.a2lab.dim i{border-color:#6b7684}.a2lab.dim span{color:#9aa3ad;border-color:#6b7684;text-decoration:line-through}.a2lab.ac i{border-color:#b49cff;border-radius:50%}.a2lab.ac span{border-color:#b49cff;color:#d9ccff}
.a2toast{position:absolute;left:calc((100% - var(--side)) / 2 + 120px);top:58px;transform:translate(-50%,-6px);max-width:min(520px,46%);background:rgba(3,13,34,.88);border:1px solid #60c8ff;border-radius:8px;padding:7px 12px;font-size:11.5px;opacity:0;transition:opacity .3s,transform .3s;text-align:center}.a2toast.on{opacity:1;transform:translate(-50%,0)}
.a2side{position:absolute;right:0;top:0;bottom:0;width:var(--side);background:linear-gradient(180deg,rgba(2,9,22,.9),rgba(2,9,22,.94));border-left:1px solid #13284a;display:flex;flex-direction:column;backdrop-filter:blur(8px)}
.a2tabs{display:none}
.a2side section{border-bottom:1px solid #13284a;padding:8px 10px;display:flex;flex-direction:column;min-height:0}
.a2side header{display:flex;gap:8px;align-items:baseline;margin-bottom:6px;white-space:nowrap;overflow:hidden}.a2side header b{font-size:11px;letter-spacing:.14em;color:#e9eef4}.a2side header span{font-size:9.5px;color:#6f8aa6;overflow:hidden;text-overflow:ellipsis}
.a2map canvas{width:100%;aspect-ratio:1.18;border-radius:6px;background:#04112a;image-rendering:pixelated;cursor:crosshair}
.a2maprd{font-size:10px;color:#9fb3c7;height:14px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.a2leg{display:flex;gap:9px;flex-wrap:wrap;font-size:9.5px;color:#8fa5bb;margin-top:2px}.a2leg span::before{content:"";display:inline-block;width:8px;height:8px;margin-right:4px;vertical-align:-1px;border-radius:2px}
.a2leg .u::before{background:#0b1a33;border:1px solid #1d3550}.a2leg .f::before{background:#2b7fb4}.a2leg .o::before{background:#ffe7b0}.a2leg .fr::before{background:#ff4fd8}.a2leg .pa::before{background:#fff;height:2px;vertical-align:3px}
.a2mon{margin-left:auto}.a2mon button{background:none;border:1px solid #1d3550;border-radius:999px;padding:1px 7px;font-size:9.5px;color:#8fa5bb;margin-left:3px}.a2mon button.on{border-color:#b49cff;color:#e3d9ff;background:rgba(180,156,255,.12)}
.a2spec{position:relative;margin-bottom:4px}.a2spec canvas{width:100%;height:46px;display:block;border-radius:4px;background:#050b18;image-rendering:pixelated}.a2spec label{position:absolute;left:6px;top:3px;font-size:9px;letter-spacing:.06em;color:#cdd8e4;text-shadow:0 0 3px #000}
.a2pipe{font-size:9px;color:#6f8aa6;line-height:1.35;margin:2px 0 5px}.a2pipe b{color:#c9b8ff;font-weight:500}
.a2audrow{display:grid;grid-template-columns:1fr 104px;gap:8px;align-items:center}
.a2cls div{display:grid;grid-template-columns:44px 1fr 38px;gap:5px;align-items:center;height:12.5px;font-size:9.5px;color:#7f93a8}.a2cls div.h span{color:#e3d9ff}
.a2cls i{height:5px;background:#0e1d36;border-radius:3px;overflow:hidden}.a2cls u{display:block;height:100%;width:0;background:var(--c);border-radius:3px;transition:width .15s}.a2cls em{font-style:normal;text-align:right;font-size:9px}
.a2doa{width:104px;height:104px}.a2audnote{font-size:10px;color:#c9b8ff;min-height:28px;margin-top:4px;line-height:1.35}
.a2think{flex:1;min-height:0!important}.a2st{margin-left:auto!important;color:#60c8ff!important;font-size:10px!important;letter-spacing:.08em}
.a2why{font-size:11px;line-height:1.35;margin-bottom:6px}.a2why div{display:grid;grid-template-columns:48px 1fr;gap:6px;margin-bottom:2px}.a2why b{font-size:9.5px;letter-spacing:.1em;color:#60c8ff;padding-top:1px}
.a2why div:nth-child(2) b{color:#ffd36b}.a2why div:nth-child(3) b{color:#5ef2b5}
.a2log{flex:1;min-height:0;overflow:hidden;font-size:10px;line-height:1.38;display:flex;flex-direction:column;justify-content:flex-end;mask-image:linear-gradient(transparent,#000 22%)}
.a2log p{margin:0 0 2px;color:#a9b9c9}.a2log p t{color:#4f6a86;margin-right:5px}.a2log p g{display:inline-block;min-width:62px;font-weight:600;color:#7fb2d8;margin-right:4px}
.a2log p.plan g{color:#ffd36b}.a2log p.map g{color:#60c8ff}.a2log p.scan g{color:#60c8ff}.a2log p.ac g,.a2log p.ac{color:#c9b8ff}.a2log p.inv g{color:#ff9ad5}.a2log p.good g{color:#5ef2b5}.a2log p.bad g,.a2log p.bad{color:#ff8a8a}.a2log p.mode g{color:#ffb35c}.a2log p.dim{color:#6f8aa6}.a2log p.per g{color:#f4f4f2}.a2log p.haz g{color:#ffd23f}
.a2score{position:absolute;left:calc((100% - var(--side)) / 2);top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100% - var(--side) - 40px));background:rgba(3,13,34,.9);border:1px solid #2b4a6b;border-radius:14px;padding:20px;backdrop-filter:blur(8px);z-index:3}
.a2hide{position:absolute;right:14px;top:12px;background:none;border:1px solid #2b4a6b;border-radius:999px;padding:2px 9px;font-size:10px;color:#8fb6d8!important}
.a2score.min>*:not(.a2k):not(h3):not(.a2hide):not(.a2btns){display:none}.a2score.min{top:auto!important;bottom:16px;transform:none!important}
.a2score h3{font:300 26px/1.15 Geist,system-ui,sans-serif;margin:0 0 12px}.a2score .a2k{margin-bottom:6px}
.a2sv{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}.a2sv div{border-radius:8px;padding:7px 8px;background:rgba(96,200,255,.06);font-size:10px;color:#9fb3c7}.a2sv b{display:block;font:500 13px Geist,system-ui,sans-serif;color:#fff}
.a2sv .ok b{color:#ffd23f}.a2sv .un b{color:#ff9a3d}.a2sv .no b{color:#6b7684}
.a2grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}.a2grid div{background:rgba(96,200,255,.06);border-radius:8px;padding:7px 8px}.a2grid b{display:block;font:300 21px Geist,system-ui,sans-serif}.a2grid b.bad{color:#ff6b6b}.a2grid span{font-size:9.5px;color:#8fa5bb}
.a2fa{margin:0 0 8px;padding-left:16px;color:#ffb3b3;font-size:11px}.a2how{font-size:11.5px;color:#c8d6e4;margin:0 0 6px}.a2tip{font-size:11.5px;color:#c9b8ff;margin:0 0 12px}
.a2hud.ending .a2osd,.a2hud.ending .a2sens,.a2hud.ending .a2ring,.a2hud.ending .a2pip,.a2hud.ending .a2arc{opacity:0;pointer-events:none;transition:opacity .5s}
.a2hud.ending ~ .a2score{left:24px;transform:translateY(-50%);width:min(520px,calc(100% - var(--side) - 48px))}
.a2ph .a2hud.ending ~ .a2score{left:12px;right:12px;width:auto;transform:none}
.a2.flying:not(.a2ph) .a2fpv{right:var(--side)}.a2ph:not(.flying) .a2fpv{bottom:0}
.a2ph{--side:100%}
.a2ph .a2fpv{bottom:46%}.a2ph .a2side{top:54%;left:0;width:100%;border-left:0;border-top:1px solid #13284a}
.a2ph .a2tabs{display:flex;gap:2px;padding:4px 6px 0}.a2ph .a2tabs button{flex:1;background:none;border:0;border-bottom:2px solid transparent;padding:6px 0;font-size:10.5px;letter-spacing:.1em;color:#6f8aa6}.a2ph .a2tabs button.on{color:#fff;border-color:#60c8ff}
.a2ph .a2side section{display:none;border:0;flex:1}.a2ph[data-tab=MAP] .a2map,.a2ph[data-tab=AUDIO] .a2aud,.a2ph[data-tab=THINK] .a2think{display:flex}
.a2ph[data-tab=SYS] .a2osd{display:block}.a2ph .a2osd{display:none;position:absolute;left:0;right:0;top:calc(54% + 34px);width:auto;border:0;background:none;font-size:10.5px;z-index:2}
.a2ph .a2map canvas{height:calc(100% - 40px);width:auto;max-width:100%;align-self:center;aspect-ratio:1.18}
.a2ph .a2mode span,.a2ph .a2rtl span{display:none}.a2ph .a2end{padding:4px 8px;font-size:9.5px}.a2ph .a2help{left:50%;bottom:calc(46% + 112px);font-size:9.5px}.a2ph .a2rtl{padding:4px 8px;font-size:9.5px}
.a2ph .a2top{left:50%;right:auto;transform:translateX(-50%);top:8px}.a2ph .a2seg button{padding:4px 8px;font-size:9.5px}.a2ph .a2clock{display:none}
.a2ph .a2sens{left:6px;right:6px;top:44px;width:auto;display:flex;gap:4px;flex-wrap:wrap;justify-content:center;padding:4px;background:none;border:0;backdrop-filter:none}
.a2ph .a2sens .a2k,.a2ph .a2sens em,.a2ph .a2sens small,.a2ph .a2lock{display:none!important}.a2ph .a2sens button{width:auto;padding:4px 6px;gap:5px;align-items:center;background:rgba(2,10,26,.6);border-radius:999px}.a2ph .a2sens b{font-size:10px}
.a2ph .a2ring{left:50%;bottom:calc(46% + 8px);width:100px}.a2ph .a2ring svg{width:100px;height:100px}.a2ph .a2ringt{top:30px}.a2ph .a2ringt b{font-size:10px}.a2ph .a2ringt span{font-size:8px;max-width:80px}
.a2ph .a2pip{left:auto;right:8px;bottom:auto;top:84px}.a2ph .a2toast{left:50%;top:84px;max-width:92%}.a2ph .a2arc{left:50%;top:27%;width:70%}
.a2ph .a2score{left:8px;right:8px;width:auto;transform:none;top:auto;bottom:8px;padding:12px;max-height:60%;overflow:auto}.a2ph .a2score h3{font-size:19px;margin-bottom:8px}
.a2ph .a2sv{grid-template-columns:repeat(4,1fr);gap:4px}.a2ph .a2sv div{padding:5px;font-size:8.5px}.a2ph .a2sv .nt{display:none}.a2ph .a2sv b{font-size:10.5px}
.a2ph .a2grid{grid-template-columns:repeat(4,1fr);gap:4px}.a2ph .a2grid div{padding:5px}.a2ph .a2grid b{font-size:15px}.a2ph .a2grid span{font-size:8px}
.a2ph .a2how,.a2ph .a2tip{display:none}.a2ph .a2btns .a2btn{padding:8px 12px;font-size:11px}
@media (max-width:1366px){.a2:not(.a2ph) .a2osd{width:360px;font-size:9.5px}.a2:not(.a2ph) .a2clock,.a2:not(.a2ph) .a2rtl span{display:none}}
@media (max-height:760px){.a2:not(.a2ph) .a2sens em{display:none!important}.a2:not(.a2ph) .a2sens{top:186px}}
`;
  document.head.appendChild(s);
}

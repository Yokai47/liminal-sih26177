// Act 3 styles. Injected by the module, so the act also works inside Act 1's page and in the single-file build.
// Palette from Act 1: ink, night, dusk, haze, rose, apricot, paper, signal teal, heat.
export const CSS = `
.a3 { --ink:#1E2140; --night:#2B2F5E; --stage:#1b1e3d; --dusk:#4A4B86; --haze:#8F8CC4; --rose:#EFB1B4; --apricot:#F6D2B1; --paper:#F3EEF2; --teal:#7FD4CF; --heat:#FFC36B; --danger:#F08A7E;
  --line: rgba(220,214,236,.12); --muted: rgba(243,238,242,.7); --faint: rgba(243,238,242,.45);
  --serif:"Fraunces", Georgia, serif; --sans:"Geist", ui-sans-serif, system-ui, sans-serif; --mono:"Geist Mono", ui-monospace, monospace; --ease: cubic-bezier(.2,.7,.1,1);
  position: fixed; inset: 0; z-index: 60; background: var(--ink); color: var(--paper); font: 16px/1.55 var(--sans); -webkit-font-smoothing: antialiased;
  display: grid; grid-template-columns: minmax(340px, 31vw) 1fr; grid-template-rows: 56px minmax(0,1fr) auto 76px;
  grid-template-areas: "top top" "text stage" "text dock" "nav nav"; overflow: hidden; }
.a3 *, .a3 *::before, .a3 *::after { box-sizing: border-box; }
.a3 button { font-family: inherit; }
.a3 :focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }
/* top bar */
.a3top { grid-area: top; display: flex; align-items: center; gap: 18px; padding: 0 22px; border-bottom: 1px solid var(--line); min-width: 0; }
.a3brand { font: 500 14px/1 var(--sans); letter-spacing: .01em; white-space: nowrap; }
.a3brand i { font: italic 400 15px/1 var(--serif); color: var(--haze); margin-left: 6px; }
.a3top .sp { flex: 1; }
.a3tour { height: 36px; align-items: center; } .a3tour button { min-height: 28px; padding: 6px 12px; }
.a3mt { display: none; } .a3top .showS { display: none; }
.a3pill { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--paper); font: 500 13.5px/1 var(--sans); cursor: pointer; white-space: nowrap; transition: border-color .2s, background .2s; }
.a3pill:hover { border-color: rgba(243,238,242,.5); background: rgba(243,238,242,.05); }
.a3pill svg { width: 15px; height: 15px; }
/* text panel */
.a3text { grid-area: text; overflow-y: auto; overflow-x: hidden; padding: 30px 34px 34px; border-right: 1px solid var(--line); scrollbar-width: thin; scrollbar-color: rgba(220,214,236,.2) transparent; }
.a3num { display: flex; align-items: baseline; gap: 10px; margin: 0 0 6px; }
.a3num b { font: italic 300 58px/1 var(--serif); color: var(--haze); letter-spacing: -.02em; }
.a3num span { font: 13px/1.3 var(--sans); color: var(--faint); }
.a3part { font: 500 13px/1.3 var(--sans); color: var(--haze); margin: 0 0 18px; }
.a3text h2 { font: 400 clamp(28px, 2.5vw, 38px)/1.08 var(--serif); letter-spacing: -.015em; margin: 0 0 16px; text-wrap: balance; }
.a3text .lede { font: 400 18px/1.5 var(--serif); color: var(--paper); margin: 0 0 14px; }
.a3text p { margin: 0 0 13px; color: rgba(243,238,242,.86); font-size: 15.5px; line-height: 1.62; max-width: 46ch; text-wrap: pretty; }
.a3analogy { margin: 18px 0; padding: 2px 0 2px 16px; border-left: 2px solid var(--rose); font: italic 400 16px/1.5 var(--serif); color: rgba(243,238,242,.82); max-width: 44ch; }
.a3lim { margin: 18px 0 14px; padding: 14px 16px; border-radius: 14px; background: rgba(127,212,207,.07); border: 1px solid rgba(127,212,207,.22); }
.a3lim h4 { margin: 0 0 6px; font: 500 12.5px/1.2 var(--sans); color: var(--teal); }
.a3lim p { margin: 0; font-size: 14.5px; color: rgba(243,238,242,.88); }
.a3try { display: flex; gap: 10px; align-items: flex-start; margin: 14px 0 0; font-size: 14px; line-height: 1.5; color: var(--heat); max-width: 46ch; }
.a3try svg { flex: none; width: 18px; height: 18px; margin-top: 1px; }
.a3qs { display: grid; gap: 8px; margin: 18px 0; }
.a3q { display: grid; grid-template-columns: 26px 1fr; align-items: baseline; gap: 2px 8px; text-align: left; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: rgba(243,238,242,.02); color: var(--paper); cursor: default; transition: border-color .2s, background .2s; }
.a3q:hover, .a3q:focus-visible { border-color: rgba(255,195,107,.55); background: rgba(255,195,107,.06); }
.a3q b { font: italic 300 22px/1 var(--serif); color: var(--heat); grid-row: span 2; }
.a3q span { font: 500 16px/1.25 var(--sans); } .a3q small { font: 13px/1.3 var(--sans); color: var(--faint); }
.a3five { counter-reset: f; list-style: none; padding: 0; margin: 16px 0; display: grid; gap: 12px; }
.a3five li { counter-increment: f; display: grid; grid-template-columns: 30px 1fr; gap: 8px; font-size: 15px; line-height: 1.5; color: rgba(243,238,242,.88); }
.a3five li::before { content: counter(f); font: italic 300 24px/1 var(--serif); color: var(--heat); }
.a3cta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
.a3cta a, .a3cta button { display: inline-flex; align-items: center; min-height: 44px; padding: 0 20px; border-radius: 999px; font: 500 15px/1 var(--sans); text-decoration: none; cursor: pointer; border: 1px solid var(--paper); }
.a3cta .pri { background: var(--paper); color: var(--ink); } .a3cta .sec { background: transparent; color: var(--paper); border-color: rgba(243,238,242,.35); }
/* stage */
.a3stage { grid-area: stage; position: relative; overflow: hidden; background: radial-gradient(90% 80% at 55% 45%, #2a2e5c 0%, #1f2247 55%, #1b1e3d 100%); min-height: 0; }
.a3view { position: absolute; inset: 0; z-index: 1; transition: opacity .25s var(--ease); }
.a3view canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: pan-y; }
.a3view.inset { inset: 14px 14px auto auto; width: 210px; height: 164px; border-radius: 14px; overflow: hidden; z-index: 5; background: radial-gradient(90% 90% at 50% 40%, #30356a, #22264c); border: 1px solid rgba(220,214,236,.16); box-shadow: 0 12px 30px rgba(10,12,30,.35); pointer-events: none; }
.a3view .cap { position: absolute; left: 10px; right: 10px; bottom: 8px; font: 500 11.5px/1.25 var(--sans); color: var(--paper); text-shadow: 0 1px 6px rgba(20,22,50,.8); display: none; }
.a3view.inset .cap { display: block; }
.a3view .cap span { color: var(--faint); font-weight: 400; display: block; }
.a3sims { position: absolute; inset: 0; z-index: 2; }
.a3sim { position: absolute; inset: 0; display: none; background: #1b1e3d; }
.a3sim.on { display: block; }
.a3stage { transition: opacity .14s; } .a3fade { opacity: 0; }
.a3labels { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
.a3labels svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.a3labels path { fill: none; stroke: rgba(220,214,236,.4); stroke-width: 1; }
.a3labels circle { fill: var(--ink); stroke: var(--paper); stroke-width: 1.2; }
.a3lab { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: pointer; padding: 3px 4px; border: 0; background: none; color: var(--paper); text-align: left; border-radius: 6px; transition: opacity .3s; }
.a3lab b { display: block; font: 500 13.5px/1.2 var(--sans); }
.a3lab span { display: block; font: 11.5px/1.25 var(--sans); color: var(--faint); }
.a3lab i { position: absolute; left: -12px; top: 9px; width: 7px; height: 7px; border-radius: 50%; }
.a3lab:hover b { color: var(--heat); }
.g-sense { background: var(--teal); } .g-think { background: #a9a5e6; } .g-fly { background: var(--apricot); }
.a3legend { position: absolute; left: 22px; bottom: 18px; z-index: 3; display: flex; gap: 16px; font-size: 12.5px; color: var(--muted); pointer-events: none; }
.a3legend span { display: inline-flex; align-items: center; gap: 7px; } .a3legend i { width: 8px; height: 8px; border-radius: 50%; }
.a3drag { position: absolute; right: 18px; bottom: 16px; z-index: 3; font-size: 12px; color: var(--faint); pointer-events: none; }
.a3memscap { position: absolute; left: 22px; top: 18px; z-index: 3; font: 13px/1.4 var(--mono); color: var(--haze); pointer-events: none; }
/* part card */
.a3card { position: absolute; top: 14px; right: 14px; bottom: 14px; width: min(380px, calc(100% - 28px)); z-index: 6; background: rgba(36,40,77,.94); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(220,214,236,.16); border-radius: 18px; padding: 26px 26px 22px; overflow-y: auto; transform: translateX(110%); transition: transform .45s var(--ease); }
.a3card.on { transform: none; }
.a3card .grp { font-size: 13px; display: flex; gap: 8px; align-items: center; color: var(--muted); margin: 0; } .a3card .grp i { width: 8px; height: 8px; border-radius: 50%; }
.a3card h3 { font: 400 32px/1.05 var(--serif); margin: 10px 0 4px; }
.a3card .mdl { font: 13px/1.4 var(--mono); color: var(--haze); margin: 0 0 18px; }
.a3card p { font-size: 15px; line-height: 1.55; margin: 0 0 16px; color: rgba(243,238,242,.88); }
.a3card dl { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; margin: 0 0 18px; }
.a3card dt { font: 400 24px/1.05 var(--serif); color: var(--heat); } .a3card dd { margin: 4px 0 0; font-size: 12px; color: var(--faint); }
.a3card h4 { font: 500 12.5px/1.2 var(--sans); color: var(--teal); margin: 0 0 6px; }
.a3x { position: absolute; top: 14px; right: 14px; width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--paper); font-size: 20px; cursor: pointer; }
/* dock */
.a3dock { grid-area: dock; border-top: 1px solid var(--line); background: var(--ink); min-height: 0; }
.a3dockpane { display: none; gap: 26px; align-items: flex-end; justify-content: space-between; padding: 14px 24px 16px; }
.a3dockpane.on { display: flex; }
.a3dockpane .controls { display: flex; gap: 16px 22px; flex-wrap: wrap; align-items: flex-end; flex: 1; min-width: 0; }
.a3dockpane .readouts { display: flex; gap: 22px; flex-wrap: wrap; justify-content: flex-end; }
/* bottom navigation */
.a3nav { grid-area: nav; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 22px; padding: 0 22px; border-top: 1px solid var(--line); background: #1a1d3b; }
.a3prev, .a3next { display: inline-flex; align-items: center; gap: 10px; height: 46px; border-radius: 999px; cursor: pointer; font: 500 15px/1 var(--sans); white-space: nowrap; transition: transform .2s var(--ease), background .2s; }
.a3prev { padding: 0 18px; background: transparent; color: var(--paper); border: 1px solid var(--line); }
.a3prev:disabled { opacity: .35; cursor: default; }
.a3prev svg { width: 16px; height: 16px; flex: none; }
.a3next { padding: 0 10px 0 22px; background: var(--paper); color: var(--ink); border: 0; max-width: 46vw; }
.a3next:hover { transform: translateX(2px); }
.a3next .t { overflow: hidden; text-overflow: ellipsis; max-width: 30vw; }
.a3next .t small { font: 400 12.5px/1 var(--sans); color: rgba(30,33,64,.6); margin-right: 8px; }
.a3next .arr { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--ink); color: var(--paper); }
.a3next.pulse .arr { animation: a3pulse 1.6s var(--ease) infinite; }
@keyframes a3pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(30,33,64,.5); } 50% { box-shadow: 0 0 0 7px rgba(30,33,64,0); } }
.a3prog { display: grid; gap: 7px; min-width: 0; }
.a3prog .meta { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; color: var(--faint); white-space: nowrap; overflow: hidden; }
.a3prog .meta b { color: var(--paper); font-weight: 500; }
.a3segs { display: flex; gap: 3px; height: 14px; align-items: center; }
.a3segs button { flex: 1; height: 14px; border: 0; padding: 0; background: none; cursor: pointer; position: relative; }
.a3segs button::after { content: ""; position: absolute; left: 0; right: 0; top: 5px; height: 4px; border-radius: 2px; background: rgba(220,214,236,.18); transition: background .25s, height .2s, top .2s; }
.a3segs button.done::after { background: rgba(127,212,207,.55); }
.a3segs button.on::after { background: var(--heat); height: 6px; top: 4px; }
.a3segs button.gap { margin-left: 8px; }
.a3segs button:hover::after { background: rgba(243,238,242,.6); }
.a3keys { font-size: 12px; color: var(--faint); white-space: nowrap; }
.a3keys kbd { font: 500 11px/1 var(--mono); border: 1px solid var(--line); border-radius: 5px; padding: 3px 5px; color: var(--muted); }
/* contents */
.a3menu { position: absolute; inset: 56px 0 76px 0; z-index: 20; background: rgba(27,30,61,.97); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); padding: 34px 40px; overflow-y: auto; display: none; }
.a3menu.on { display: block; }
.a3menu h3 { font: 400 30px/1.1 var(--serif); margin: 0 0 24px; }
.a3menu .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 28px; }
.a3menu h4 { font: 500 13px/1.3 var(--sans); color: var(--haze); margin: 0 0 10px; }
.a3menu ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.a3menu li button { width: 100%; display: grid; grid-template-columns: 34px 1fr; gap: 6px; align-items: baseline; text-align: left; padding: 8px 10px; border-radius: 10px; border: 0; background: transparent; color: var(--paper); font: 15px/1.3 var(--sans); cursor: pointer; }
.a3menu li button:hover { background: rgba(243,238,242,.06); }
.a3menu li button.on { background: rgba(255,195,107,.12); }
.a3menu li button i { font: italic 300 18px/1 var(--serif); color: var(--haze); font-style: italic; }
.a3load { position: absolute; inset: 0; z-index: 30; display: grid; place-items: center; background: var(--ink); transition: opacity .5s; }
.a3load div { width: 180px; height: 2px; background: rgba(220,214,236,.15); border-radius: 2px; overflow: hidden; } .a3load s { display: block; height: 100%; width: 0; background: var(--paper); }
.a3load p { margin: 12px 0 0; font-size: 13px; color: var(--faint); text-align: center; }
@media (max-width: 760px) {
  .a3 { grid-template-columns: 1fr; grid-template-rows: 48px 42vh minmax(0,1fr) 64px; grid-template-areas: "top" "stage" "text" "nav"; }
  .a3text .a3dock { margin: -16px -16px 16px; border-top: 0; border-bottom: 1px solid var(--line); background: #1a1d3b; }
  .a3text .a3dock:empty, .a3text .a3dock:not(:has(.a3dockpane.on)) { display: none; }
  .a3top { padding: 0 12px; gap: 8px; } .a3brand i, .a3top .hideS { display: none; }
  .a3pill { height: 32px; padding: 0 10px; font-size: 12.5px; }
  .a3text { border-right: 0; padding: 16px 16px 20px; }
  .a3num b { font-size: 34px; } .a3part { margin-bottom: 10px; }
  .a3text h2 { font-size: 25px; margin-bottom: 10px; } .a3text p { font-size: 14.5px; }
  .a3dockpane { flex-direction: column; align-items: stretch; gap: 12px; padding: 12px 14px; }
  .a3dockpane .readouts { justify-content: flex-start; gap: 16px; }
  .a3view.inset { width: 120px; height: 96px; inset: 34px 8px auto auto; }
  .a3mt { display: block; position: absolute; left: 0; right: 0; top: 0; z-index: 7; padding: 7px 12px; font: 500 13px/1.3 var(--sans); background: linear-gradient(rgba(27,30,61,.92), rgba(27,30,61,0)); pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .a3mt b { font: italic 300 15px/1 var(--serif); color: var(--haze); margin-right: 6px; }
  .a3 .a3tour { display: none; } .a3view.inset .cap { font-size: 10px; } .a3view.inset .cap span { display: none; }
  .a3nav { gap: 10px; padding: 0 10px; grid-template-columns: auto 1fr auto; }
  .a3prev { padding: 0 14px; height: 42px; } .a3prev .t { display: none; }
  .a3next { height: 42px; padding: 0 8px 0 16px; } .a3next .t { max-width: 34vw; } .a3next .t small { display: none; }
  .a3keys, .a3prog .meta .k { display: none; }
  .a3lab span { display: none; } .a3lab b { font-size: 11.5px; }
  .a3card { top: auto; height: 70%; left: 8px; right: 8px; width: auto; bottom: 8px; transform: translateY(110%); }
  .a3menu { inset: 48px 0 64px 0; padding: 20px; }
  .a3legend { left: 10px; bottom: 8px; font-size: 11px; gap: 10px; } .a3drag { display: none; }
}
@media (prefers-reduced-motion: reduce) { .a3 * { transition-duration: .01s !important; animation: none !important; } }

.a3pill.a3mus.on { color: #7FD4CF; border-color: rgba(127,212,207,.55); }
`;

// Act 4 styles, scoped under .a4. Injected by the module, so the act also works inside Act 1's page and in the
// single-file build. Same palette and type conventions as Act 3 (sentence case, Fraunces / Geist / Geist Mono).
export const CSS = `
.a4 { --ink:#1E2140; --night:#2B2F5E; --dusk:#4A4B86; --haze:#8F8CC4; --rose:#EFB1B4; --apricot:#F6D2B1; --mist:#DCE4EE; --paper:#F3EEF2; --teal:#7FD4CF; --heat:#FFC36B; --danger:#F08A7E; --lav:#B9A6F2;
  --line: rgba(220,214,236,.14); --muted: rgba(243,238,242,.72); --faint: rgba(243,238,242,.48); --glass: rgba(30,33,64,.62); --glass2: rgba(36,40,77,.78);
  --serif:"Fraunces", Georgia, serif; --sans:"Geist", ui-sans-serif, system-ui, sans-serif; --mono:"Geist Mono", ui-monospace, monospace; --ease: cubic-bezier(.2,.7,.1,1);
  --top: 56px; --dock: 104px; --cards: 336px;
  position: absolute; inset: 0; z-index: 60; background: var(--ink); color: var(--paper); font: 15px/1.5 var(--sans); -webkit-font-smoothing: antialiased; overflow: hidden; user-select: none; -webkit-user-select: none; }
.a4 *, .a4 *::before, .a4 *::after { box-sizing: border-box; }
.a4 button { font-family: inherit; }
.a4 :focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }
/* the 3-D view: full bleed under everything on desktop */
.a4view { position: absolute; inset: 0; z-index: 1; background: radial-gradient(120% 90% at 50% 40%, #3a3d72 0%, #262a55 60%, #1E2140 100%); }
.a4view canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
.a4view canvas:active { cursor: grabbing; }
.a4labels { position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: hidden; }
.a4lab { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); white-space: nowrap; font: 500 12px/1.25 var(--sans); color: var(--paper); padding: 4px 8px 4px 8px; border-radius: 8px; background: rgba(30,33,64,.62); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 1px solid rgba(220,214,236,.14); opacity: 0; transition: opacity .35s; }
.a4lab small { display: block; font: 11px/1.25 var(--mono); color: var(--faint); margin-top: 1px; }
.a4lab.heat { border-color: rgba(255,195,107,.45); } .a4lab.heat b { color: #FFE2B8; font-weight: 500; }
.a4lab.lav { border-color: rgba(185,166,242,.45); } .a4lab.lav b { color: #DCD2FF; font-weight: 500; }
.a4lab.apr b { color: var(--apricot); font-weight: 500; }
.a4lab.teal b { color: #BFF0EC; font-weight: 500; }
.a4lab::after { content: ""; position: absolute; left: 50%; bottom: -5px; width: 1px; height: 5px; background: rgba(220,214,236,.4); }
.a4num { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font: 600 12px/1 var(--sans); color: var(--ink); background: var(--lav); box-shadow: 0 0 0 4px rgba(185,166,242,.25), 0 0 18px rgba(185,166,242,.6); opacity: 0; transition: opacity .3s; }
/* top bar */
.a4top { position: absolute; left: 0; right: 0; top: 0; height: var(--top); z-index: 25; display: flex; align-items: center; gap: 14px; padding: 0 22px; background: linear-gradient(rgba(24,26,52,.86), rgba(24,26,52,.55) 70%, rgba(24,26,52,0)); }
.a4brand { font: 500 14px/1 var(--sans); letter-spacing: .01em; white-space: nowrap; }
.a4brand i { font: italic 400 15px/1 var(--serif); color: var(--haze); margin-left: 6px; }
.a4top .sp { flex: 1; }
.a4pill { color: var(--paper); display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line); background: rgba(30,33,64,.35); color: var(--paper); font: 500 13.5px/1 var(--sans); cursor: pointer; white-space: nowrap; transition: border-color .2s, background .2s, color .2s; }
.a4pill:hover { border-color: rgba(243,238,242,.5); background: rgba(243,238,242,.07); }
.a4pill svg { width: 15px; height: 15px; flex: none; }
.a4pill.on { color: var(--teal); border-color: rgba(127,212,207,.55); }
.a4mis { position: relative; }
.a4mis .a4pill { background: rgba(243,238,242,.06); }
.a4mis .cur { max-width: 300px; overflow: hidden; text-overflow: ellipsis; }
.a4menu { position: absolute; top: 44px; left: 0; min-width: 320px; padding: 6px; border-radius: 14px; background: rgba(36,40,77,.97); border: 1px solid var(--line); box-shadow: 0 20px 50px rgba(10,12,30,.5); display: none; z-index: 30; }
.a4menu.on { display: block; }
.a4menu button { display: grid; grid-template-columns: 26px 1fr; gap: 2px 8px; width: 100%; text-align: left; padding: 9px 10px; border: 0; background: transparent; border-radius: 10px; cursor: pointer; }
.a4menu button:hover, .a4menu button.on { background: rgba(243,238,242,.07); }
.a4menu button i { font: italic 300 18px/1.1 var(--serif); color: var(--haze); grid-row: span 2; }
.a4menu button i.pl { color: var(--teal); } .a4menu button i.pl svg { width: 12px; height: 12px; margin-top: 4px; }
.a4menu button b { font: 500 14px/1.3 var(--sans); } .a4menu button span { font: 12px/1.3 var(--sans); color: var(--faint); }
/* caption: lower third */
.a4cap { position: absolute; left: 30px; bottom: calc(var(--dock) + 22px); z-index: 6; max-width: min(620px, calc(100% - var(--cards) - 320px)); pointer-events: none; }
.a4cap .ch { font: 500 12.5px/1.2 var(--sans); color: var(--teal); margin: 0 0 8px; display: flex; gap: 10px; align-items: baseline; opacity: .95; }
.a4cap .ch i { font: italic 300 20px/1 var(--serif); color: var(--haze); }
.a4cap p { margin: 0; font: 400 clamp(19px, 1.6vw, 23px)/1.36 var(--serif); color: var(--paper); text-wrap: pretty; text-shadow: 0 1px 18px rgba(20,22,50,.9), 0 0 2px rgba(20,22,50,.6); transition: opacity .5s var(--ease), transform .5s var(--ease); }
.a4cap p.out { opacity: 0; transform: translateY(6px); }
/* concept cards */
.a4cards { position: absolute; right: 16px; top: calc(var(--top) + 6px); bottom: calc(var(--dock) + 14px); width: calc(var(--cards) - 24px); z-index: 7; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
.a4card { pointer-events: auto; background: var(--glass); backdrop-filter: blur(14px) saturate(1.1); -webkit-backdrop-filter: blur(14px) saturate(1.1); border: 1px solid rgba(220,214,236,.16); border-radius: 16px; padding: 13px 14px 12px; transition: opacity .45s var(--ease), transform .45s var(--ease); box-shadow: 0 14px 34px rgba(12,14,34,.28); }
.a4card.enter { opacity: 0; transform: translateX(24px); } .a4card.leave { opacity: 0; transform: translateX(24px); }
.a4card header { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; }
.a4card header i { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 0 3px rgba(127,212,207,.18); animation: a4live 1.6s ease-in-out infinite; flex: none; }
.a4card h4 { margin: 0; font: 400 18px/1.15 var(--serif); letter-spacing: -.005em; flex: 1; }
.a4card .tag { font: 11.5px/1 var(--sans); color: var(--faint); }
.a4card canvas { display: block; width: 100%; height: 92px; border-radius: 10px; background: rgba(20,22,48,.45); }
.a4card .st { display: flex; justify-content: space-between; gap: 10px; margin: 8px 0 0; font: 12px/1.3 var(--mono); color: var(--muted); }
.a4card .st b { color: var(--paper); font-weight: 500; }
.a4card p { margin: 6px 0 0; font: 13px/1.45 var(--sans); color: rgba(243,238,242,.8); }
.a4card:not(:first-child) p, .a4card:not(:first-child) .lab { display: none; }
.a4card:not(:first-child) canvas { height: 64px; }
.a4cards { overflow: hidden; }
.a4card .lab { margin-top: 9px; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--line); background: transparent; font: 500 12px/1 var(--sans); cursor: pointer; color: var(--paper); }
.a4card .lab:hover { border-color: rgba(127,212,207,.6); color: var(--teal); }
@keyframes a4live { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
/* picture in picture: the drone's eye */
.a4pip { position: absolute; z-index: 6; right: var(--cards); bottom: calc(var(--dock) + 18px); width: 252px; height: 158px; border-radius: 14px; border: 1px solid rgba(220,214,236,.22); box-shadow: 0 14px 30px rgba(10,12,30,.4); overflow: hidden; pointer-events: none; opacity: 0; transition: opacity .4s; }
.a4pip.on { opacity: 1; }
.a4pip .t { position: absolute; left: 8px; top: 7px; font: 500 11.5px/1.2 var(--sans); color: var(--paper); text-shadow: 0 1px 6px rgba(20,22,50,.9); }
.a4pip .t small { display: block; font: 10.5px/1.2 var(--mono); color: var(--muted); }
.a4pip .rec { position: absolute; right: 9px; top: 9px; width: 7px; height: 7px; border-radius: 50%; background: var(--danger); animation: a4live 1.2s infinite; }
.a4pip .ret { position: absolute; inset: 0; background: radial-gradient(transparent 62%, rgba(20,22,50,.45)); }
/* dock */
.a4.nomis .a4dock, .a4.nomis .a4cap, .a4.nomis .a4cards, .a4.nomis .a4pip { visibility: hidden; }
.a4dock { position: absolute; left: 0; right: 0; bottom: 0; height: var(--dock); z-index: 9; padding: 12px 22px 12px; display: grid; grid-template-rows: 40px 34px; gap: 8px; background: linear-gradient(rgba(24,26,52,0), rgba(24,26,52,.78) 32%, rgba(24,26,52,.92)); }
.a4row1 { display: grid; grid-template-columns: auto auto 1fr auto; align-items: center; gap: 14px; min-width: 0; }
.a4row2 { display: flex; align-items: center; gap: 12px; min-width: 0; }
.a4play { width: 40px; height: 40px; border-radius: 50%; border: 0; background: var(--paper); color: var(--ink); display: grid; place-items: center; cursor: pointer; transition: transform .2s var(--ease); }
.a4play:hover { transform: scale(1.06); } .a4play svg { width: 16px; height: 16px; }
.a4seg { display: inline-flex; padding: 3px; border-radius: 999px; border: 1px solid var(--line); background: rgba(30,33,64,.4); }
.a4seg button { color: var(--muted); border: 0; background: transparent; height: 28px; min-width: 38px; padding: 0 9px; border-radius: 999px; font: 500 12.5px/1 var(--mono); color: var(--muted); cursor: pointer; }
.a4seg button.on { background: rgba(243,238,242,.14); color: var(--paper); }
.a4scrub { position: relative; height: 40px; min-width: 0; cursor: pointer; touch-action: none; }
.a4scrub .segs { position: absolute; left: 0; right: 0; top: 19px; height: 6px; display: flex; gap: 3px; }
.a4scrub .sg { position: relative; height: 6px; border-radius: 3px; background: rgba(220,214,236,.16); overflow: hidden; flex: none; }
.a4scrub .sg s { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: rgba(127,212,207,.8); }
.a4scrub .sg.cur s { background: var(--heat); }
.a4scrub .lbl { position: absolute; top: 2px; font: 11px/1.2 var(--sans); color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.a4scrub .lbl.cur { color: var(--paper); }
.a4scrub .head { position: absolute; top: 14px; width: 2px; height: 16px; margin-left: -1px; border-radius: 1px; background: var(--paper); box-shadow: 0 0 0 3px rgba(243,238,242,.15); pointer-events: none; }
.a4scrub .ev { position: absolute; top: 30px; width: 5px; height: 5px; margin-left: -2.5px; border-radius: 50%; pointer-events: none; }
.a4scrub .tip { position: absolute; bottom: 44px; transform: translateX(-50%); padding: 6px 10px; border-radius: 9px; background: rgba(36,40,77,.97); border: 1px solid var(--line); font: 12px/1.3 var(--sans); white-space: nowrap; opacity: 0; transition: opacity .15s; pointer-events: none; }
.a4scrub .tip small { display: block; font: 11px/1.3 var(--mono); color: var(--faint); }
.a4scrub:hover .tip { opacity: 1; }
.a4time { font: 12.5px/1.25 var(--mono); color: var(--muted); white-space: nowrap; text-align: right; }
.a4time b { color: var(--paper); font-weight: 500; }
.a4time span { display: block; color: var(--faint); font-size: 11.5px; }
.a4lens { display: flex; gap: 6px; align-items: center; min-width: 0; overflow-x: auto; scrollbar-width: none; flex: 1; }
.a4lens::-webkit-scrollbar { display: none; }
.a4lens .k { font: 12px/1 var(--sans); color: var(--faint); margin-right: 4px; white-space: nowrap; }
.a4chip { color: var(--muted); height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); background: rgba(30,33,64,.35); font: 500 12.5px/1 var(--sans); color: var(--muted); cursor: pointer; white-space: nowrap; transition: background .2s, color .2s, border-color .2s; flex: none; }
.a4chip:hover { color: var(--paper); border-color: rgba(243,238,242,.4); }
.a4chip.on { background: var(--paper); color: var(--ink); border-color: var(--paper); }
.a4dir { display: inline-flex; align-items: center; gap: 8px; }
.a4dir i { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 0 3px rgba(127,212,207,.2); }
.a4dir.user { color: var(--ink); background: var(--heat); border-color: var(--heat); } .a4dir.user i { background: var(--ink); box-shadow: none; animation: a4live 1.2s infinite; }
/* overlays: picker, simulating, report */
.a4over { position: absolute; inset: 0; z-index: 20; display: grid; place-items: center; transition: opacity .6s var(--ease); }
.a4over.hide { opacity: 0; pointer-events: none; visibility: hidden; transition: opacity .6s var(--ease), visibility 0s .6s; }
.a4pick { background: radial-gradient(110% 80% at 50% 0%, rgba(58,61,114,.96), rgba(30,33,64,.985) 62%); overflow-y: auto; place-items: start center; }
.a4pick .in { width: min(1320px, 100%); padding: 86px 36px 40px; }
.a4pick .kick { font: 500 13px/1 var(--sans); color: var(--haze); margin: 0 0 14px; }
.a4pick h1 { font: 300 clamp(36px, 4vw, 56px)/1.02 var(--serif); letter-spacing: -.02em; margin: 0 0 14px; }
.a4pick h1 em { font-style: italic; color: var(--apricot); }
.a4pick .lede { font: 400 18px/1.5 var(--serif); color: rgba(243,238,242,.86); max-width: 62ch; margin: 0 0 22px; }
.a4pick .acts { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 0 0 28px; }
.a4pri { display: inline-flex; align-items: center; gap: 10px; min-height: 46px; padding: 0 22px; border-radius: 999px; border: 0; background: var(--paper); color: var(--ink); font: 500 15px/1 var(--sans); cursor: pointer; transition: transform .2s var(--ease); }
.a4pri:hover { transform: translateY(-1px); }
.a4pri.auto { background: linear-gradient(90deg, rgba(127,212,207,.5), rgba(127,212,207,.5)) no-repeat 0 0 / 0% 100%, var(--paper); animation: a4auto var(--auto, 11s) linear forwards; }
@keyframes a4auto { to { background-size: 100% 100%, auto; } } .a4pri svg { width: 14px; height: 14px; }
.a4sec { display: inline-flex; align-items: center; min-height: 46px; padding: 0 20px; border-radius: 999px; border: 1px solid rgba(243,238,242,.35); background: transparent; color: var(--paper); font: 500 15px/1 var(--sans); cursor: pointer; }
.a4pick .note { font: 13px/1.4 var(--sans); color: var(--faint); }
.a4grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.a4m { text-align: left; border: 1px solid rgba(220,214,236,.16); background: rgba(36,40,77,.55); border-radius: 18px; padding: 0 0 16px; cursor: pointer; overflow: hidden; display: flex; flex-direction: column; transition: transform .3s var(--ease), border-color .3s, background .3s; color: var(--paper); }
.a4m:hover { transform: translateY(-3px); border-color: rgba(243,238,242,.4); background: rgba(44,48,90,.7); }
.a4m canvas { width: 100%; aspect-ratio: 16 / 10; display: block; }
.a4m .b { padding: 14px 16px 0; display: flex; flex-direction: column; gap: 6px; flex: 1; }
.a4m .n { font: italic 300 15px/1 var(--serif); color: var(--haze); }
.a4m h3 { font: 400 21px/1.15 var(--serif); margin: 0; letter-spacing: -.01em; }
.a4m .pl { font: 13px/1.35 var(--sans); color: var(--muted); margin: 0; }
.a4m .md { font: 12px/1.3 var(--mono); color: var(--teal); margin: 2px 0 0; }
.a4m ul { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 5px; }
.a4m li { font: 11.5px/1 var(--sans); padding: 5px 8px; border-radius: 999px; background: rgba(243,238,242,.07); color: rgba(243,238,242,.82); }
.a4m .go { margin-top: auto; padding-top: 12px; font: 500 13px/1 var(--sans); color: var(--paper); display: inline-flex; gap: 8px; align-items: center; }
.a4m .go svg { width: 13px; height: 13px; }
.a4sim { background: radial-gradient(60% 50% at 50% 50%, rgba(30,33,64,.55), rgba(30,33,64,.15) 70%, rgba(30,33,64,0)); pointer-events: none; }
.a4sim .box { text-align: center; padding: 26px 34px; border-radius: 20px; background: rgba(30,33,64,.58); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(220,214,236,.14); min-width: 360px; }
.a4sim .row { display: none; gap: 10px; justify-content: center; margin-top: 16px; } .a4sim.failed { pointer-events: auto; } .a4sim.failed .row { display: flex; } .a4sim.failed .bar, .a4sim.failed .why { display: none; }
.a4sim .k { font: 500 12.5px/1 var(--sans); color: var(--haze); margin: 0 0 10px; }
.a4sim h2 { font: 400 28px/1.12 var(--serif); margin: 0 0 6px; }
.a4sim .pl { font: 13.5px/1.4 var(--sans); color: var(--muted); margin: 0 0 18px; }
.a4sim .bar { height: 3px; border-radius: 2px; background: rgba(220,214,236,.16); overflow: hidden; }
.a4sim .bar s { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--teal), #CFF5F2); transition: width .2s; }
.a4sim .pc { font: 12.5px/1.2 var(--mono); color: var(--muted); margin: 10px 0 0; }
.a4sim .why { font: 12.5px/1.45 var(--sans); color: var(--faint); margin: 12px auto 0; max-width: 38ch; }
.a4rep { z-index: 15; background: linear-gradient(90deg, rgba(24,26,52,.0) 0%, rgba(24,26,52,.35) 40%, rgba(24,26,52,.86) 100%); place-items: center end; padding-right: 40px; }
.a4rep .card { width: min(560px, 100%); max-height: calc(100% - 140px); overflow-y: auto; padding: 26px 28px 22px; border-radius: 22px; background: rgba(32,35,70,.94); border: 1px solid rgba(220,214,236,.18); box-shadow: 0 30px 70px rgba(10,12,30,.5); }
.a4rep .k { font: 500 12.5px/1 var(--sans); color: var(--teal); margin: 0 0 10px; }
.a4rep h2 { font: 400 30px/1.08 var(--serif); margin: 0 0 6px; letter-spacing: -.01em; }
.a4rep .pl { font: 13.5px/1.4 var(--sans); color: var(--muted); margin: 0 0 18px; }
.a4rep dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 16px; margin: 0 0 18px; }
.a4rep dt { font: 400 26px/1.05 var(--serif); color: var(--paper); } .a4rep dt.h { color: var(--heat); } .a4rep dt.t { color: var(--teal); } .a4rep dt.l { color: var(--lav); }
.a4rep dd { margin: 4px 0 0; font: 12px/1.3 var(--sans); color: var(--faint); }
.a4rep h4 { font: 500 12.5px/1.2 var(--sans); color: var(--haze); margin: 14px 0 8px; }
.a4rep ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 7px; }
.a4rep li { display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; align-items: baseline; font: 13.5px/1.4 var(--sans); color: rgba(243,238,242,.88); }
.a4rep li i { font: italic 300 16px/1 var(--serif); color: var(--heat); }
.a4rep li small { font: 11.5px/1.3 var(--mono); color: var(--faint); }
.a4rep .row { display: flex; gap: 10px; flex-wrap: wrap; position: sticky; bottom: -22px; margin: 18px -28px -22px; padding: 16px 28px 20px; background: linear-gradient(rgba(32,35,70,0), rgba(32,35,70,.97) 26%); }
.a4rep .zero { margin: 16px 0 0; padding: 12px 14px; border-radius: 12px; background: rgba(127,212,207,.08); border: 1px solid rgba(127,212,207,.24); font: 13px/1.45 var(--sans); color: rgba(243,238,242,.88); }
.a4rep .zero b { font-family: var(--mono); color: var(--teal); font-weight: 500; }
.a4toast { position: absolute; left: 50%; top: calc(var(--top) + 10px); transform: translateX(-50%); z-index: 12; padding: 8px 14px; border-radius: 999px; background: rgba(36,40,77,.92); border: 1px solid var(--line); font: 12.5px/1.2 var(--sans); color: var(--muted); opacity: 0; transition: opacity .4s; pointer-events: none; white-space: nowrap; }
.a4toast.on { opacity: 1; }
.a4top .showS { display: none; }
/* medium widths: the top bar keeps every control on one line (the brand's subtitle and the button labels go first) */
@media (max-width: 1100px) and (min-width: 761px) { .a4brand i { display: none; } }
@media (max-width: 960px) and (min-width: 761px) { .a4top .a4mus .hideS { display: none; } .a4mis .cur { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
@media (max-width: 1180px) { .a4grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .a4 { --cards: 316px; } }
@media (max-width: 1320px) { .a4cap { max-width: min(560px, calc(100% - var(--cards) - 300px)); } }
/* phone: the view on top, the caption, the dock, then the cards as a strip */
@media (max-width: 760px) {
  .a4 { --top: 48px; display: grid; grid-template-rows: var(--top) 52svh auto auto minmax(0, 1fr); grid-template-areas: "top" "view" "cap" "dock" "cards"; }
  .a4top { position: relative; grid-area: top; padding: 0 10px; gap: 6px; background: rgba(24,26,52,.96); }
  .a4brand i, .a4top .hideS, .a4top .showS { display: none; }
  .a4brand { font-size: 13px; }
  .a4pill { height: 32px; padding: 0 9px; font-size: 12.5px; gap: 6px; }
  .a4top .sp { flex: 1 1 0; min-width: 0; }
  .a4mis { min-width: 0; flex: 0 1 auto; } .a4mis .a4pill { max-width: 100%; } .a4mis .cur { max-width: 112px; }
  .a4menu { position: fixed; left: 8px; right: 8px; top: 52px; min-width: 0; }
  .a4view { position: relative; grid-area: view; inset: auto; }
  .a4labels { position: absolute; }
  .a4lab { font-size: 11px; padding: 3px 7px; } .a4lab small { display: none; }
  .a4cap { position: relative; grid-area: cap; left: auto; bottom: auto; max-width: none; padding: 10px 14px 6px; background: #1E2140; }
  .a4cap .ch { margin-bottom: 4px; font-size: 11.5px; } .a4cap .ch i { font-size: 16px; }
  .a4cap p { font-size: 16px; line-height: 1.38; text-shadow: none; min-height: 2.76em; }
  .a4dock { position: relative; grid-area: dock; height: auto; padding: 8px 12px 8px; grid-template-rows: auto auto; background: #1E2140; border-top: 1px solid var(--line); gap: 6px; }
  .a4row1 { grid-template-columns: auto 1fr auto; gap: 10px; }
  .a4row2 { overflow-x: auto; scrollbar-width: none; } .a4row2::-webkit-scrollbar { display: none; }
  .a4lens { overflow: visible; flex: none; }
  .a4time .d, .a4time .slash { display: none !important; }
  .a4row1 .a4seg { display: none; }
  .a4play { width: 36px; height: 36px; }
  .a4time { font-size: 11px; } .a4time span { font-size: 10.5px; }
  .a4scrub .lbl { display: none; }
  .a4lens .k { display: none; }
  .a4row2 { gap: 8px; }
  .a4row2 .a4dirw { display: flex; gap: 6px; flex: none; }
  .a4chip { height: 30px; padding: 0 10px; font-size: 12px; }
  .a4cards { position: relative; grid-area: cards; right: auto; top: auto; bottom: auto; width: auto; flex-direction: row; overflow-x: auto; padding: 10px 12px 14px; gap: 10px; scroll-snap-type: x mandatory; background: #1E2140; scrollbar-width: none; }
  .a4cards::-webkit-scrollbar { display: none; }
  .a4card { flex: none; width: 82vw; max-width: 330px; scroll-snap-align: start; padding: 11px 12px 10px; background: rgba(36,40,77,.75); }
  .a4card canvas { height: 64px; }
  .a4card p { display: none; }
  .a4card .lab { margin-top: 7px; }
  .a4pip { right: 8px; top: calc(var(--top) + 52svh - 104px); bottom: auto; width: 132px; height: 84px; border-radius: 10px; }
  .a4pip .t small { display: none; } .a4pip .t { font-size: 10px; }
  .a4pick .in { padding: 64px 16px 30px; }
  .a4pick .lede { font-size: 16px; }
  .a4grid { grid-template-columns: 1fr; gap: 12px; }
  .a4m { flex-direction: row; padding: 0; min-height: 132px; }
  .a4m canvas { width: 38%; aspect-ratio: auto; height: auto; }
  .a4m .b { padding: 12px 12px 12px; gap: 4px; }
  .a4m h3 { font-size: 17px; } .a4m .pl { font-size: 12px; } .a4m ul { display: none; } .a4m .go { padding-top: 6px; }
  .a4sim .box { min-width: 0; width: calc(100% - 32px); padding: 20px; }
  .a4rep { padding: 0; place-items: end center; background: rgba(24,26,52,.6); }
  .a4rep .card { width: 100%; max-height: 88%; border-radius: 20px 20px 0 0; padding: 20px 18px 18px; }
  .a4rep .row { bottom: -18px; margin: 14px -18px -18px; padding: 14px 18px 18px; }
  .a4rep h2 { font-size: 24px; } .a4rep dl { grid-template-columns: repeat(2, 1fr); } .a4rep dt { font-size: 22px; }
}

.a4.test *, .a4.test *::before, .a4.test *::after { transition: none !important; animation: none !important; }
@media (prefers-reduced-motion: reduce) { .a4 * { transition-duration: .01s !important; animation: none !important; } }
`;

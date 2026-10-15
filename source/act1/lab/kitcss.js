// styles for the simulation kit's controls and readouts (shared by the act and the sim test page)
export const KIT_CSS = `
.k-cv { display: block; }
.k-slider { display: grid; gap: 6px; min-width: 150px; flex: 1 1 170px; max-width: 250px; }
.k-slider label { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font: 12.5px/1.2 var(--sans); color: rgba(243,238,242,.7); }
.k-slider output { font: 500 12.5px/1 var(--mono); color: #FFC36B; font-variant-numeric: tabular-nums; white-space: nowrap; }
.k-slider input { -webkit-appearance: none; appearance: none; width: 100%; height: 24px; background: transparent; margin: 0; cursor: pointer; --p: 50%; }
.k-slider input::-webkit-slider-runnable-track { height: 3px; border-radius: 3px; background: linear-gradient(90deg, #7FD4CF var(--p), rgba(220,214,236,.2) var(--p)); }
.k-slider input::-moz-range-track { height: 3px; border-radius: 3px; background: rgba(220,214,236,.2); }
.k-slider input::-moz-range-progress { height: 3px; border-radius: 3px; background: #7FD4CF; }
.k-slider input::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; margin-top: -6.5px; border-radius: 50%; background: #F3EEF2; border: 0; box-shadow: 0 0 0 4px rgba(127,212,207,.18); transition: box-shadow .2s; }
.k-slider input::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: #F3EEF2; border: 0; }
.k-slider input:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px rgba(127,212,207,.55); }
.k-slider input:hover::-webkit-slider-thumb { box-shadow: 0 0 0 6px rgba(127,212,207,.25); }
.k-toggle { display: grid; gap: 6px; }
.k-lab { font: 12.5px/1.2 var(--sans); color: rgba(243,238,242,.7); }
.k-seg { display: inline-flex; border: 1px solid rgba(220,214,236,.22); border-radius: 999px; padding: 3px; gap: 2px; }
.k-seg button { border: 0; background: transparent; color: rgba(243,238,242,.75); font: 500 12.5px/1 var(--sans); padding: 8px 12px; border-radius: 999px; cursor: pointer; min-height: 32px; white-space: nowrap; }
.k-seg button.on { background: #F3EEF2; color: #1E2140; }
.k-seg button:focus-visible, .k-btn:focus-visible { outline: 2px solid #7FD4CF; outline-offset: 2px; }
.k-btn { border: 1px solid rgba(220,214,236,.3); background: transparent; color: #F3EEF2; font: 500 13px/1 var(--sans); padding: 0 16px; min-height: 38px; border-radius: 999px; cursor: pointer; white-space: nowrap; transition: background .2s, border-color .2s; }
.k-btn:hover { border-color: #F3EEF2; background: rgba(243,238,242,.06); }
.k-btn.primary { background: #F3EEF2; color: #1E2140; border-color: #F3EEF2; }
.k-btn.warn { border-color: rgba(240,138,126,.7); color: #F6B3AA; }
.k-read { display: grid; gap: 4px; min-width: 96px; }
.k-read b { font: 500 22px/1 var(--mono); font-variant-numeric: tabular-nums; letter-spacing: -.02em; white-space: nowrap; }
.k-read span { font: 11.5px/1.25 var(--sans); color: rgba(243,238,242,.55); }
.k-teal b { color: #7FD4CF; } .k-rose b { color: #EFB1B4; } .k-danger b { color: #F08A7E; } .k-heat b { color: #FFC36B; } .k-ink b { color: #F3EEF2; } .k-apricot b { color: #F6D2B1; } .k-haze b { color: #B4B1E0; }
.k-hint { font: 12.5px/1.45 var(--sans); color: rgba(243,238,242,.55); margin: 0; max-width: 46ch; }
`;

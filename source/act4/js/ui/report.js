// The handover report at the end of a mission: what was searched, who was found and where, what is flagged for the
// rescuers, and the proof that nothing is left (β0 = 0). Every number comes from the tape.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmtT = (s) => { const m = Math.floor(s / 60), ss = Math.round(s % 60); return m ? `${m} min ${String(ss).padStart(2, '0')} s` : `${ss} s`; };
const area = (m2) => (m2 >= 2e5 ? `${(m2 / 1e6).toFixed(2)} km²` : `${(Math.round(m2 / 10) * 10).toLocaleString('en')} m²`);
export function createReport(el, { onReplay, onNext, onMissions, onLab }) {
  el.className = 'a4over a4rep hide';
  let shown = false;
  function show(meta, tape, next, autoSec = 0) {
    const R = tape.report, finds = tape.finds, L = (id) => tape.layers.find((l) => l.id === id);
    const where = (f) => { const l = L(f.layer); return l ? (l.name || l.id) : f.layer; };
    const people = finds.reduce((a, f) => a + (f.count || 1), 0);
    const pk = tape.pockets.filter((p) => p.t >= 0);
    const rej = tape.events.filter((e) => e.type === 'reject');
    el.innerHTML = `<div class="card" role="dialog" aria-label="Handover report"><p class="k">Handover to the rescue team</p><h2>${esc(meta.title)}</h2><p class="pl">${esc(meta.place)} · ${fmtT(R.simSeconds)} of mission time · ${R.drones} drones</p>
      <dl><div><dt class="t">${area(R.areaM2)}</dt><dd>searched, ${Math.round(R.coverage * 100)}% of the area</dd></div><div><dt class="h">${people}</dt><dd>${people === 1 ? 'person' : 'people'} found, ${finds.length} place${finds.length === 1 ? '' : 's'}</dd></div><div><dt class="l">${pk.length}</dt><dd>sealed void${pk.length === 1 ? '' : 's'} flagged</dd></div>
        <div><dt>${rej.length}</dt><dd>false alarm${rej.length === 1 ? '' : 's'} rejected</dd></div><div><dt>${R.dronesLost}</dt><dd>drone${R.dronesLost === 1 ? '' : 's'} lost, nothing it mapped lost</dd></div><div><dt>0</dt><dd>commands sent to any drone</dd></div></dl>
      <h4>Who, where, when</h4><ol>${finds.map((f, i) => `<li><i>${i + 1}</i><span>${f.count > 1 ? f.count + ' people' : 'One person'} · ${esc(where(f))}${f.note ? `<br><small>${esc(f.note)}</small>` : ''}</span><small>${fmtT(f.confirmT * tape.dt)}</small></li>`).join('') || '<li><i>–</i><span>Nobody found in this area</span><small></small></li>'}</ol>
      ${pk.length ? `<h4>Flagged for the rescuers</h4><ol>${pk.map((p, i) => `<li><i style="color:#B9A6F2">β₂</i><span>${p.name ? esc(p.name.replace(/^./, (m) => m.toUpperCase())) : 'Sealed void'}, ${p.volume >= 100 ? Math.round(p.volume).toLocaleString('en') : p.volume.toFixed(1)} m³ · ${esc(L(p.layer)?.name || p.layer)}<br><small>mapped all round, never entered: check with listening devices</small></span><small>${fmtT(p.t * tape.dt)}</small></li>`).join('')}</ol>` : ''}
      ${rej.length ? `<h4>Rejected</h4><ol>${rej.map((e) => `<li><i style="color:#8F8CC4">×</i><span>${esc((e.label || 'a warm object').replace(/^./, (m) => m.toUpperCase()))}: warm, but the camera disagreed</span><small>${fmtT(e.t * tape.dt)}</small></li>`).join('')}</ol>` : ''}
      <p class="zero">${R.unreached > 0 ? `Unsearched: <b>${area(R.unreachedM2)}</b> the drones could not reach, flagged for the rescuers.` : 'Unsearched pockets left: <b>β₀ = 0</b>.'} Every drone’s map was merged into one record; the responders now hold the same map the swarm built.</p>
      <div class="row"><button class="a4pri${next && autoSec ? ' auto' : ''}" type="button" data-a="next"${next && autoSec ? ` style="--auto:${autoSec}s" title="Starts on its own in ${autoSec} s"` : ''}>${next ? `Next: ${esc(next.title)}` : 'Back to the missions'}</button><button class="a4sec" type="button" data-a="replay">Watch again</button><button class="a4sec" type="button" data-a="lab">See it in the lab</button></div></div>`;
    el.querySelector('[data-a="next"]').addEventListener('click', () => (next ? onNext(next.id) : onMissions()));
    el.querySelector('[data-a="replay"]').addEventListener('click', () => onReplay());
    el.querySelector('[data-a="lab"]').addEventListener('click', () => onLab('lab-topology'));
    el.classList.remove('hide'); shown = true;
  }
  return { show, hide() { el.classList.add('hide'); shown = false; }, get shown() { return shown; } };
}

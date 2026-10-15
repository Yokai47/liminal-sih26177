// The tape: everything the simulator recorded, in compact typed arrays, plus helpers to read it back at any
// fractional tick (playback interpolates between recorded ticks, so scrubbing is free).
//
// tape = {
//   dt, T (ticks recorded), N (drones), DR (floats per drone row), AR (floats per auxiliary row),
//   drones: Float32Array(T * N * DR)   rows: x, y, z, heading, state, battery, layer, team, flags, ownCov
//   aux: { list: [{ kind: 'ugv'|'boat'|'tether'|'station', name }], data: Float32Array(T * NA * AR) }   rows: x, y, z, heading, state
//   linkOff: Uint32Array(T + 1), links: Uint16Array(2 * L), linkCells: Uint16Array(L)   (node ids: drones 0..N-1, then NODE.*)
//   layers: [{ id, nx, nz, x0, z0, cell, y, fly, grid, firstSeen: Uint16Array(nx * nz), off }]
//   knownAt: [Uint16Array(totalCells)] per drone: the tick each cell entered THAT drone's own map (65535 never)
//   metrics: { coverage, phi, phiL, eta, beta0, frontier, meshSize, identical, bytes, cv, readout, h, x, mode, inRange } Float32Array(T)
//   beta0L: [Float32Array(T)] per layer
//   field: { w, h, frame: { ox, oz, ux, uz, vx, vz, su, sv }, snaps: [{ t, data: Uint8Array(w * h), frame }] } | null
//   marks, events, finds, forecast, pockets, beacons, report
// }
export const ST = { IDLE: 0, LAUNCH: 1, TRANSIT: 2, SEARCH: 3, CONVERGE: 4, CONFIRM: 5, RELAY: 6, RETURN: 7, DEAD: 8, LANDED: 9, EVADE: 10, FRONT: 11 };
export const ST_NAME = ['on the van', 'launching', 'in transit', 'searching', 'converging', 'confirming', 'relay', 'returning', 'down', 'landed', 'pulling out', 'holding the front'];
export const FLAG = { OUT: 1, MERGE: 2, CONV: 4, INDOOR: 8 };
export const NEVER = 65535;

export function droneAt(tape, tf, i, out) {
  const T = tape.T, DR = tape.DR, N = tape.N;
  const t = Math.max(0, Math.min(T - 1, tf)), a = Math.floor(t), b = Math.min(T - 1, a + 1), f = t - a;
  const A = (a * N + i) * DR, B = (b * N + i) * DR, D = tape.drones;
  out.x = D[A] + (D[B] - D[A]) * f; out.y = D[A + 1] + (D[B + 1] - D[A + 1]) * f; out.z = D[A + 2] + (D[B + 2] - D[A + 2]) * f;
  let dh = D[B + 3] - D[A + 3]; if (dh > Math.PI) dh -= Math.PI * 2; if (dh < -Math.PI) dh += Math.PI * 2;
  out.h = D[A + 3] + dh * f;
  const r = f < .5 ? A : B;
  out.state = D[r + 4]; out.bat = D[A + 5] + (D[B + 5] - D[A + 5]) * f; out.layer = D[r + 6]; out.team = D[r + 7]; out.flags = D[r + 8]; out.own = D[A + 9] + (D[B + 9] - D[A + 9]) * f;
  return out;
}
export function auxAt(tape, tf, k, out) {
  const T = tape.T, AR = tape.AR, NA = tape.aux.list.length; if (!NA) return out;
  const t = Math.max(0, Math.min(T - 1, tf)), a = Math.floor(t), b = Math.min(T - 1, a + 1), f = t - a;
  const A = (a * NA + k) * AR, B = (b * NA + k) * AR, D = tape.aux.data;
  out.x = D[A] + (D[B] - D[A]) * f; out.y = D[A + 1] + (D[B + 1] - D[A + 1]) * f; out.z = D[A + 2] + (D[B + 2] - D[A + 2]) * f;
  let dh = D[B + 3] - D[A + 3]; if (dh > Math.PI) dh -= Math.PI * 2; if (dh < -Math.PI) dh += Math.PI * 2;
  out.h = D[A + 3] + dh * f; out.state = D[(f < .5 ? A : B) + 4];
  return out;
}
export function metricAt(tape, key, tf) {
  const m = tape.metrics[key]; if (!m) return 0;
  const t = Math.max(0, Math.min(tape.T - 1, tf)), a = Math.floor(t), b = Math.min(tape.T - 1, a + 1), f = t - a;
  return m[a] + (m[b] - m[a]) * f;
}
// a window of a metric ending at tick t (for sparklines): returns { a, b } tick range clamped
export function metricWindow(tape, t, span) { const b = Math.max(0, Math.min(tape.T - 1, Math.floor(t))); return { a: Math.max(0, b - span), b }; }
export function linksAt(tape, t) { const k = Math.max(0, Math.min(tape.T - 1, Math.round(t))); return { a: tape.linkOff[k], b: tape.linkOff[k + 1] }; }
export function fieldAt(tape, t) {
  const F = tape.field; if (!F || !F.snaps.length) return null;
  let lo = 0, hi = F.snaps.length - 1; if (t <= F.snaps[0].t) return F.snaps[0];
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (F.snaps[m].t <= t) lo = m; else hi = m - 1; }
  return F.snaps[lo];
}
export function forecastAt(tape, t) {
  const L = tape.forecast; if (!L || !L.length) return null; let best = null;
  for (const f of L) { if (f.t0 <= t) best = f; else break; } return best;
}
export const simClock = (tape, tf) => {
  const s = Math.max(0, tf) * tape.dt; const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min ${String(ss).padStart(2, '0')} s`;
};

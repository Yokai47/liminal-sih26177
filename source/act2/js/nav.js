/* LIMINAL · Act 2 · nav.js — state estimation model (what the flight controller believes vs. where the drone really is).
   This is a behavioural model of the Layer 1 estimator, not a full filter:
     EKF3 (ArduPilot, 24 states, 3 IMU lanes) fuses IMU + barometer + optical flow (Matek 3901-L0X) + external nav.
     External nav = LiDAR-inertial odometry (FAST-LIO2 class): bounds drift; degrades in smoke and along featureless corridors.
     Loop closure: revisiting a keyframe exposes accumulated drift and removes it (the map "snaps").
   The estimation error e = (estimate − truth) is what the planner flies on, so drift shows up as a real offset. */
export function createNav({ roomAt, smokeAt, floodAt }) {
  const S = {
    e: [0, 0], ev: [0, 0], d: [0, 0], sig: [.03, .03], ang: 0,
    lio: 'TRACKING', lioFit: .93, lioHz: 10, flowQ: 0, flowHz: 0, lanes: [1, 1, 1], primary: 0,
    innov: { vel: .1, pos: .1, hgt: .08 }, lostT: 0, bothOffT: 0, failsafe: null, lcCount: 0, lcLast: null,
    keyframes: [], dist: 0, lastKF: null, axis: null, degen: 0, events: [], bias: [.004, -.003],
  };
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2832 * v); };
  const CORR = { C1: 'x', C2: 'z', C3: 'x', C4: 'z' };

  function reset() { Object.assign(S, { bias: [(Math.random() - .5) * .012, (Math.random() - .5) * .012], e: [0, 0], ev: [0, 0], d: [0, 0], sig: [.03, .03], lio: 'TRACKING', lostT: 0, bothOffT: 0, failsafe: null, lcCount: 0, lcLast: null, keyframes: [], dist: 0, lastKF: null, events: [] }); }

  function update(dt, T, sensors, t) {
    const sp = Math.hypot(T.vx, T.vz); S.dist += sp * dt;
    const room = roomAt(T.x, T.z), smoke = smokeAt(T.x, T.z), flood = floodAt(T.x, T.z);
    // ---- optical flow: needs texture + light under the drone; water and smoke wreck it
    S.flowQ = sensors.flow ? Math.max(0, Math.min(255, (flood ? 70 : smoke ? 110 : 205) + 18 * gauss())) : 0;
    S.flowHz = sensors.flow ? 80 : 0;
    const flowOK = sensors.flow && S.flowQ > 90;
    // ---- LiDAR-inertial odometry
    S.axis = CORR[room] || null;
    const prev = S.lio;
    if (!sensors.lidar) S.lio = 'LOST';
    else if (smoke) S.lio = 'DEGRADED';
    else if (S.axis) S.lio = 'DEGENERATE';
    else S.lio = 'TRACKING';
    S.lioFit = S.lio === 'LOST' ? 0 : S.lio === 'TRACKING' ? .9 + .05 * Math.random() : S.lio === 'DEGENERATE' ? .74 + .06 * Math.random() : .55 + .1 * Math.random();
    S.lioHz = sensors.lidar ? 10 : 0;
    if (prev !== S.lio) S.events.push({ k: 'lio', from: prev, to: S.lio, room });
    // drift growth of the LIO solution itself (small, distance-proportional)
    if (S.lio !== 'LOST') {
      // LIO drift: ~0.5–1 % of distance flown, with a slowly wandering direction (scan-matching bias)
      for (let i = 0; i < 2; i++) S.bias[i] += (gauss() * .006 - S.bias[i] * .04) * dt;
      const k = S.lio === 'DEGRADED' ? .03 : .008;
      S.d[0] += (S.bias[0] * sp * 1.4 + gauss() * k * sp * .3 + (S.lio === 'DEGRADED' ? .01 * gauss() : 0)) * dt; S.d[1] += (S.bias[1] * sp * 1.4 + gauss() * k * sp * .3) * dt;
      if (S.lio === 'DEGENERATE' && !flowOK) { // along the corridor nothing constrains it: scan matching slides
        const a = S.axis === 'x' ? 0 : 1; S.d[a] += Math.sign(a ? T.vz : T.vx) * Math.abs(a ? T.vz : T.vx) * .07 * dt; }
      S.e[0] = S.d[0]; S.e[1] = S.d[1]; S.ev[0] *= .9; S.ev[1] *= .9; S.lostT = 0;
    } else {
      S.lostT += dt;
      if (flowOK) { S.ev[0] = .02 * gauss() + .025 * T.vx; S.ev[1] = .02 * gauss() + .025 * T.vz; }        // flow: velocity known to ~2–3 %
      else { S.ev[0] += (.06 * gauss() + .02) * dt * 3; S.ev[1] += (.06 * gauss() - .015) * dt * 3; }       // IMU only: integrated bias, quadratic growth
      S.e[0] += S.ev[0] * dt; S.e[1] += S.ev[1] * dt; S.d[0] = S.e[0]; S.d[1] = S.e[1];
    }
    // ---- covariance (1σ, metres)
    const tgt = S.lio === 'TRACKING' ? [.03, .03] : S.lio === 'DEGRADED' ? [.12, .12] : S.lio === 'DEGENERATE' ? (S.axis === 'x' ? [flowOK ? .07 : .22, .03] : [.03, flowOK ? .07 : .22]) : null;
    if (tgt) for (let i = 0; i < 2; i++) S.sig[i] += (tgt[i] - S.sig[i]) * Math.min(1, dt * 3);
    else for (let i = 0; i < 2; i++) S.sig[i] += (flowOK ? .015 * sp + .003 : .05 + .12 * S.lostT) * dt;
    // ---- innovation test ratios (dimensionless; < 1 passes the gate)
    const n = () => Math.abs(gauss()) * .05;
    S.innov.vel = flowOK ? .12 + n() + (smoke ? .2 : 0) : 0; S.innov.pos = sensors.lidar ? (.1 + n() + (S.lio === 'DEGRADED' ? .25 : S.lio === 'DEGENERATE' ? .15 : 0)) : 0; S.innov.hgt = .08 + n();
    // ---- failsafe: no position or velocity aiding → the filter's variance runs away → LAND
    S.bothOffT = !sensors.lidar && !sensors.flow ? S.bothOffT + dt : 0;
    if (!S.failsafe && Math.max(S.sig[0], S.sig[1]) > 1.2 && S.bothOffT > 2) { S.failsafe = 'EKF'; S.events.push({ k: 'failsafe' }); }
    // ---- keyframes + loop closure
    if (sensors.lidar && S.lio !== 'LOST') {
      if (!S.lastKF || Math.hypot(T.x - S.lastKF.x, T.z - S.lastKF.z) > 2) { S.lastKF = { x: T.x, z: T.z, t, id: S.keyframes.length }; S.keyframes.push(S.lastKF); }
      const dm = Math.hypot(S.d[0], S.d[1]);
      if (dm > .08 && (!S.lcLast || t - S.lcLast > 15) && S.lio === 'TRACKING') {
        for (const kf of S.keyframes) if (t - kf.t > 35 && Math.hypot(T.x - kf.x, T.z - kf.z) < 1.6) {
          S.lcCount++; S.lcLast = t; S.events.push({ k: 'loop', kf: kf.id, age: t - kf.t, corr: dm, fit: .86 + .08 * Math.random(), n: S.keyframes.length });
          S.d = [0, 0]; S.e = [0, 0]; S.innov.pos = .7; break; }
      }
    }
    S.ang = S.sig[0] > S.sig[1] ? 0 : Math.PI / 2;
  }
  return { S, update, reset };
}

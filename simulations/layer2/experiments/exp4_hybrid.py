"""Sim 4: 8 real drones flying inside a large virtual flock.

A) Noise scan: where does this flock (1,024 virtual + 8 real agents in a 4 x 4 m
   net, radius 0.5 m, 0.4 m/s) switch from ordered to disordered?
B) Requirements: how much loop latency and command-packet loss can the
   drones tolerate before they stop moving with the flock?
C) Design choices and assumptions: embodied vs puppet coupling, heading taken
   from the command vs from camera-measured velocity, and how sensitive the
   result is to the ASSUMED drone response time and disturbance level.
D) Showcase: 4,088 virtual + 8 real agents, positions saved for the animation.

All drone parameters are assumptions until measured on the mocap rig.
Output: results/data/exp4_hybrid.json, results/data/exp4_showcase.npz
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim.hybrid import Hybrid

TICKS, WARM, EVERY = 2000, 500, 10   # 40 s of flight at 50 Hz, measure after 10 s


def run(kw):
    kw = dict(kw)
    label = kw.pop("label")
    h = Hybrid(**kw)
    er, ev, ph, phr, pl, nn = [], [], [], [], [], []
    for k in range(TICKS):
        h.tick()
        if k >= WARM and k % EVERY == 0:
            a, b = h.alignment_errors()
            er.append(a); ev.append(b)
            ph.append(h.order()); phr.append(h.order(np.arange(h.nv, h.n)))
            pl.append(h.local_order()); nn.append(np.percentile(h.nn_dist(), 5))
    er = np.degrees(np.concatenate(er)); ev = np.degrees(np.concatenate(ev))
    ph = np.array(ph)
    return dict(label=label, **{k: v for k, v in kw.items()},
                align_real_deg=float(np.nanmean(er)), align_virtual_deg=float(np.nanmean(ev)),
                align_real_p90=float(np.nanpercentile(er, 90)),
                phi=float(ph.mean()), chi=float(h.n * ph.var()), phi_real=float(np.mean(phr)),
                overshoot_m=h.overshoot, ticks_outside_net=h.left_net, min_drone_dist_m=h.min_dist,
                phi_local=float(np.mean(pl)), chi_local=float(h.n * np.var(pl)),
                nn_p5_m=float(np.mean(nn)), safety_active_frac=h.sep_ticks / max(TICKS - 100, 1),
                drone_stalled_frac=h.stall_samples / max(h.drone_samples, 1))


if __name__ == "__main__":
    t0 = time.time()
    base = dict(n_virtual=1024, n_real=8, latency=0.04, loss=0.0, mode="embodied", heading_source="command")
    with Pool(2) as pool:
        # A: noise scan
        A = pool.map(run, [dict(base, eta=float(e), seed=1, label="A") for e in np.arange(0.5, 5.01, 0.5)])
        print("A done", time.time() - t0, flush=True)
        chis = [(r["chi"], r["eta"]) for r in A]
        eta_near = max(chis)[1]
        # B: latency x loss at an ordered and a near-transition noise level
        jobs = []
        for eta, tag in ((1.0, "ordered"), (eta_near, "near-transition")):
            for lat in (0.02, 0.05, 0.1, 0.2, 0.4):
                for loss in (0.0, 0.1, 0.3, 0.5):
                    for sd in (1, 2):
                        jobs.append(dict(base, eta=eta, latency=lat, loss=loss, seed=sd, label="B-" + tag))
        B = pool.map(run, jobs)
        print("B done", time.time() - t0, flush=True)
        # C: design choices and sensitivity (ordered flock, baseline latency)
        jobs = [dict(base, eta=1.0, seed=3, label="C-embodied-command"),
                dict(base, eta=1.0, seed=3, heading_source="measured", label="C-embodied-measured"),
                dict(base, eta=1.0, seed=3, mode="puppet", label="C-puppet"),
                dict(base, eta=1.0, seed=3, walls="hard", label="C-hard-walls")]
        for tau in (0.15, 0.3, 0.6):
            jobs.append(dict(base, eta=1.0, seed=3, tau=tau, label="C-tau"))
        for vn in (0.0, 0.02, 0.05, 0.1):
            jobs.append(dict(base, eta=1.0, seed=3, vel_noise=vn, label="C-disturbance"))
        C = pool.map(run, jobs)
        print("C done", time.time() - t0, flush=True)
    json.dump({"A": A, "B": B, "C": C, "eta_near": eta_near,
               "assumptions": dict(tau_s=0.3, a_max=3.0, vel_noise=0.05, pos_noise_m=0.003, speed=0.4,
                                   radius_m=0.5, arena_m=4.0, margin_m=0.3, rate_hz=50),
               "runtime_s": time.time() - t0}, open("results/data/exp4_hybrid.json", "w"), indent=1)
    # D: showcase for the animation
    h = Hybrid(n_virtual=4088, n_real=8, eta=1.0, seed=5)
    frames = []
    for k in range(1500):
        if k == 750:
            h.eta = eta_near * 1.15   # halfway: raise the noise so the flock breaks up
        h.tick()
        if k % 5 == 0:
            frames.append(np.concatenate([np.stack([h.x[:h.nv], h.y[:h.nv]], 1), h.p]).astype(np.float32))
    np.savez_compressed("results/data/exp4_showcase.npz", frames=np.array(frames), n_virtual=h.nv, arena=h.L,
                        margin=h.b, switch_frame=150)
    print("all done", time.time() - t0)

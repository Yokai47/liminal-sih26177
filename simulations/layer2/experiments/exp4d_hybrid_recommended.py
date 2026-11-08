"""Sim 4d: the hybrid flock at a physically consistent density (recommended setup).

Sims 4 and 4b showed that 1,024+ agents cannot share a 4 x 4 m net with real
drones: with a 0.5 m radius each agent has ~50 neighbours and the flock never
disorders (Sim 4); with the 7-nearest rule the neighbours sit ~10 cm apart, and a
drone that needs ~0.3 s to respond cannot follow structure that fine (Sim 4b).
Here the net holds the same density as the finite-size sweep (2 agents per R^2):
120 virtual agents + 8 real drones, radius 0.5 m.

A) noise scan   B) latency x packet loss (ordered, and at the fluctuation peak)
C) design choices and assumed drone parameters   D) drone-to-drone safety layer
E) showcase animation data
Output: results/data/exp4d_recommended.json, results/data/exp4_showcase.npz
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from experiments.exp4_hybrid import run
from liminal_sim.hybrid import Hybrid

if __name__ == "__main__":
    t0 = time.time()
    base = dict(n_virtual=120, n_real=8, latency=0.04, loss=0.0, mode="embodied", heading_source="command",
                separation=0.5, sep_gain=4.0)
    with Pool(2) as pool:
        A = pool.map(run, [dict(base, eta=float(e), seed=s, label="A") for e in np.round(np.arange(0.5, 5.01, 0.25), 2)
                           for s in (1, 2)])
        agg = {}
        for r in A:
            agg.setdefault(r["eta"], []).append(r["chi"])
        eta_peak = max((np.mean(v), e) for e, v in agg.items())[1]
        print("A done, peak at", eta_peak, time.time() - t0, flush=True)
        jobs = []
        for eta, tag in ((1.0, "ordered"), (eta_peak, "near-peak")):
            for lat in (0.02, 0.05, 0.1, 0.2, 0.4):
                for loss in (0.0, 0.1, 0.3, 0.5):
                    for sd in (1, 2, 3):
                        jobs.append(dict(base, eta=eta, latency=lat, loss=loss, seed=sd, label="B-" + tag))
        B = pool.map(run, jobs)
        print("B done", time.time() - t0, flush=True)
        jobs = []
        for sd in (3, 4, 5):
            c = dict(base, eta=1.0, seed=sd)
            jobs += [dict(c, label="C-embodied-command"),
                     dict(c, heading_source="measured", label="C-embodied-measured"),
                     dict(c, mode="puppet", label="C-puppet"),
                     dict(c, walls="hard", label="C-hard-walls")]
            jobs += [dict(c, tau=t, label="C-tau") for t in (0.15, 0.3, 0.6)]
            jobs += [dict(c, vel_noise=v, label="C-disturbance") for v in (0.0, 0.05, 0.1)]
            jobs += [dict(c, separation=s, sep_gain=g, label="D-safety")
                     for s, g in ((0.0, 0.0), (0.4, 1.5), (0.5, 4.0), (0.6, 6.0))]
        C = pool.map(run, jobs)
    json.dump({"A": A, "B": B, "C": C, "eta_peak": float(eta_peak), "base": base,
               "assumptions": dict(tau_s=0.3, a_max=3.0, vel_noise=0.05, pos_noise_m=0.003, speed=0.4,
                                   radius_m=0.5, arena_m=4.0, margin_m=0.3, rate_hz=50),
               "runtime_s": time.time() - t0}, open("results/data/exp4d_recommended.json", "w"), indent=1)
    h = Hybrid(**dict(base, eta=1.0, seed=7))
    frames = []
    for k in range(1500):
        if k == 750:
            h.eta = 4.5
        h.tick()
        if k % 5 == 0:
            frames.append(np.concatenate([np.stack([h.x[:h.nv], h.y[:h.nv]], 1), h.p,
                                          np.stack([np.cos(h.th), np.sin(h.th)], 1)[:0].reshape(0, 2)]).astype(np.float32))
    np.savez_compressed("results/data/exp4_showcase.npz", frames=np.array(frames), n_virtual=h.nv, arena=h.L,
                        margin=h.b, switch_frame=150)
    print("all done", time.time() - t0)

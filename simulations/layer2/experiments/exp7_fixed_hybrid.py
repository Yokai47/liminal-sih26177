"""Sim 7: does the FPGA's integer arithmetic fly the demo flock like the exact model?

The FPGA engine version 1.1 adds the walled arena of the hybrid demo (soft walls,
hard backstop, real-drone slots). Its integer model, liminal_sim.fixedpoint.step_walls,
is bit-exact with fpga/rtl/vicsek_engine.v (WALLS = 1). Here the same hybrid
demo (120 virtual + 8 real drones, 4 x 4 m net, safety layer on) runs once with
the floating-point kernels and once with the integer engine.

A) noise scan: order, local order, susceptibility, drone misalignment
B) ordered flock (noise 1.0), 6 runs: drone misalignment, closest approach,
   time outside the net
Output: results/data/exp7_fixed_hybrid.json
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from experiments.exp4_hybrid import run

BASE = dict(n_virtual=120, n_real=8, latency=0.04, loss=0.0, mode="embodied", heading_source="command",
            separation=0.5, sep_gain=4.0)

if __name__ == "__main__":
    t0 = time.time()
    jobs = []
    for eng in ("float", "fixed"):
        for sd in (1, 2, 3):
            for e in np.round(np.arange(0.5, 5.01, 0.25), 2):
                jobs.append(dict(BASE, eta=float(e), seed=sd, engine=eng, label="A"))
        for sd in (3, 4, 5, 6, 7, 8):
            jobs.append(dict(BASE, eta=1.0, seed=sd, engine=eng, label="B"))
    with Pool(2) as pool:
        res = pool.map(run, jobs)
    json.dump({"A": [r for r in res if r["label"] == "A"], "B": [r for r in res if r["label"] == "B"],
               "base": BASE, "runtime_s": time.time() - t0}, open("results/data/exp7_fixed_hybrid.json", "w"), indent=1)
    print("all done", time.time() - t0)

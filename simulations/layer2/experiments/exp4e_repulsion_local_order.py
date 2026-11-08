"""Sim 4e: repulsion for every agent, and a local order measure.

Setup: the recommended hybrid flock of Sim 4d (120 virtual + 8 real drones,
4 x 4 m net, radius 0.5 m, 0.4 m/s, drone safety layer 0.5 m / gain 4).

A) Repulsion. The Vicsek rule only aligns; nothing keeps agents apart, so
   virtual agents overlap and the drone safety layer has to fight the flock.
   Here every agent also turns away from any agent closer than r_rep, with a
   strength of up to `gain` neighbours' worth at contact. Variants:
     - with and without the drone safety layer
     - "drones ignore virtual": drones are not pushed by virtual agents
       (they cannot collide with them), but virtual agents keep clear of drones.
   Measured: drone misalignment (and the virtual agents' own, as a baseline),
   closest drone-drone distance, how often the safety layer had to act, the
   spacing of the virtual agents, and the order.

B) Local order. In a walled arena the flock bends and circles, so the
   whole-flock order phi can be low even when every neighbourhood is aligned.
   phi_local averages, over agents, how aligned each agent's own neighbourhood
   is. Noise scan of phi and phi_local, without and with repulsion.

Output: results/data/exp4e_repulsion.json
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from experiments.exp4_hybrid import run

BASE = dict(n_virtual=120, n_real=8, latency=0.04, loss=0.0, mode="embodied", heading_source="command",
            separation=0.5, sep_gain=4.0)
SEEDS_A = (3, 4, 5, 6, 7, 8)
REC = dict(repulsion=0.3, rep_gain=1.0, rep_drones_ignore_virtual=True)   # the mild setting

if __name__ == "__main__":
    t0 = time.time()
    jobs = []
    for sd in SEEDS_A:
        c = dict(BASE, eta=1.0, seed=sd)
        jobs.append(dict(c, label="A", variant="safety only"))
        for ign in (False, True):
            for r in (0.2, 0.3, 0.4, 0.5):
                for g in (1.0, 2.0):
                    jobs.append(dict(c, repulsion=r, rep_gain=g, rep_drones_ignore_virtual=ign, label="A",
                                     variant="safety + repulsion" + (", drones ignore virtual" if ign else "")))
        for r, g in ((0.4, 1.0), (0.5, 2.0), (0.5, 5.0)):
            jobs.append(dict(c, separation=0.0, sep_gain=0.0, repulsion=r, rep_gain=g, label="A",
                             variant="repulsion only"))
        jobs.append(dict(c, separation=0.0, sep_gain=0.0, label="A", variant="nothing"))
    for sd in (1, 2, 3):
        for e in np.round(np.arange(0.5, 5.01, 0.25), 2):
            jobs.append(dict(BASE, eta=float(e), seed=sd, label="B", variant="no repulsion"))
            jobs.append(dict(BASE, eta=float(e), seed=sd, label="B", variant="mild repulsion", **REC))

    def strip(j):
        j = dict(j); j.pop("variant"); return j
    with Pool(2) as pool:
        res = pool.map(run, [strip(j) for j in jobs])
    for j, r in zip(jobs, res):
        r["variant"] = j["variant"]
        r.setdefault("repulsion", 0.0); r.setdefault("rep_gain", 0.0); r.setdefault("rep_drones_ignore_virtual", False)
    json.dump({"A": [r for r in res if r["label"] == "A"], "B": [r for r in res if r["label"] == "B"],
               "base": BASE, "recommended_repulsion": REC, "runtime_s": time.time() - t0},
              open("results/data/exp4e_repulsion.json", "w"), indent=1)
    print("all done", time.time() - t0)

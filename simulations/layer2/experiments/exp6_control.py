"""Sim 6: criticality controller and order/disorder switching.

A) Extremum-seeking controller on a 512-agent flock, started from a too-ordered
   (eta = 1.6) and a too-disordered (eta = 3.6) setting. Does it find the
   susceptibility peak measured in Sim 3?
B) The same controller on an 8-agent flock (the real-drone count).
C) Mission primitives: switch the noise between "transit" (ordered, eta = 1.0)
   and "search" (disordered, eta = 4.0), and measure how long the flock takes
   to change state, for 8, 64 and 512 agents.
Output: results/data/exp6_control.json
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim.vicsek import run_periodic, init_random, box_size
from liminal_sim.control import extremum_seek

DENSITY, V0 = 2.0, 0.03


def ctrl_job(args):
    n, eta0, seed, W, iters = args
    L = box_size(n, DENSITY)
    x, y, th = init_random(n, L, seed)
    run_periodic(x, y, th, L, 1.0, V0, eta0, 5000, seed)
    h = extremum_seek(x, y, th, L, n, eta0, iters=iters, W=W, seed=seed * 1000)
    return dict(n=n, eta0=eta0, seed=seed, W=W, history=h)


def switch_job(args):
    n, seed = args
    L = box_size(n, DENSITY)
    x, y, th = init_random(n, L, seed)
    run_periodic(x, y, th, L, 1.0, V0, 1.0, 20000, seed)        # settle ordered
    res = {"n": n, "seed": seed, "to_search": [], "to_transit": []}
    for cyc in range(6):
        p1 = run_periodic(x, y, th, L, 1.0, V0, 4.0, 6000, seed + 10 * cyc + 1)   # transit -> search
        p2 = run_periodic(x, y, th, L, 1.0, V0, 1.0, 20000, seed + 10 * cyc + 2)  # search -> transit
        def first_cross(p, thr, below):
            idx = np.where(p < thr)[0] if below else np.where(p > thr)[0]
            return int(idx[0]) if len(idx) else -1
        res["to_search"].append(first_cross(p1, 0.5, True))
        res["to_transit"].append(first_cross(p2, 0.8, False))
        if cyc == 0:
            res["trace"] = np.concatenate([p1[::20], p2[::20]]).tolist()
    return res


if __name__ == "__main__":
    t0 = time.time()
    jobs = [(512, 1.6, 1, 3000, 50), (512, 3.6, 2, 3000, 50), (8, 1.0, 3, 20000, 50), (8, 4.5, 4, 20000, 50)]
    with Pool(2) as pool:
        C = pool.map(ctrl_job, jobs)
        print("control done", time.time() - t0, flush=True)
        S = pool.map(switch_job, [(n, s) for n in (8, 64, 512) for s in (1, 2, 3)])
    json.dump({"control": C, "switching": S, "v0": V0, "density": DENSITY, "runtime_s": time.time() - t0},
              open("results/data/exp6_control.json", "w"), indent=1)
    print("done", time.time() - t0)

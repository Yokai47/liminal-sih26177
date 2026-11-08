"""Sim 11: Turing patterns for spreading drones over a search area.

A) Spot spacing of the Gierer-Meinhardt field against the activator diffusion rate
   (theory: spacing grows as its square root).
B) Search coverage: 8 drones, 32 x 32 m area, 2 m sensing radius, 1 m/s, launched
   from one edge; policies random walk, lawnmower strips, greedy (nearest unsearched
   cell), Lloyd/Voronoi, the Turing field alone, and the Turing field with the greedy
   rule as mop-up; with and without 3 drones failing at 15 s. 10 runs each.
Output: results/data/exp11_turing.json, results/data/exp11_example.npz
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim import turing as T


def spacing_job(a):
    Da, seed = a
    nspots, sp, _ = T.spot_spacing(Da, seed=seed)
    return dict(Da=Da, seed=seed, spots=int(nspots), spacing_cells=float(sp))


def cov_job(a):
    pol, fail, seed = a
    r = T.coverage_run(pol, t_max=200.0, seed=seed, fail_at=15.0 if fail else None, n_fail=3 if fail else 0)
    r.update(fail=fail, seed=seed)
    return r


if __name__ == "__main__":
    t0 = time.time()
    with Pool(2) as pool:
        A = pool.map(spacing_job, [(Da, s) for Da in (0.25, 0.5, 1, 2, 4, 8, 16) for s in (0, 1)])
        B = pool.map(cov_job, [(p, f, s) for p in ("random", "lawnmower", "greedy", "lloyd", "turing_only", "turing")
                               for f in (False, True) for s in range(1, 11)])
    ex = {}
    for Da in (0.5, 2.0, 8.0):
        ex[f"a_{Da}"] = T.spot_spacing(Da, seed=0)[2]
    np.savez_compressed("results/data/exp11_example.npz", **ex)
    json.dump({"spacing": A, "coverage": B, "runtime_s": time.time() - t0}, open("results/data/exp11_turing.json", "w"))
    print("done", time.time() - t0)

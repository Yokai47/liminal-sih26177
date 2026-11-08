"""Sim 4b: the hybrid flock with the k-nearest-neighbour (topological) rule.

Finding from Sim 4: packing 1,024 agents into a 4 x 4 m net with a 0.5 m radius
gives each agent ~70 neighbours (the flock uses a 3.4 x 3.4 m area), so its order stays at
the ceiling set by each agent's own noise (0.20 at eta = 5). The near-transition regime is out of reach.
Fix tested here: each agent follows its 7 nearest neighbours instead of everyone
within 0.5 m (the rule starlings appear to use; Ballerini et al., PNAS 2008).
That makes the behaviour independent of how densely the net is packed.

A) noise scan with k = 7      B) latency x loss at the noise with the largest fluctuations
Output: results/data/exp4b_hybrid_knn.json
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from experiments.exp4_hybrid import run

if __name__ == "__main__":
    t0 = time.time()
    base = dict(n_virtual=1024, n_real=8, latency=0.04, loss=0.0, mode="embodied", heading_source="command", k_nn=7)
    with Pool(2) as pool:
        A = pool.map(run, [dict(base, eta=float(e), seed=1, label="A-knn") for e in np.round(np.arange(0.1, 1.61, 0.15), 2)])
        eta_peak = max((r["chi"], r["eta"]) for r in A)[1]
        print("A done, peak at", eta_peak, time.time() - t0, flush=True)
        jobs = []
        for eta, tag in ((0.2, "ordered"), (eta_peak, "near-transition")):
            for lat in (0.02, 0.1, 0.2, 0.4):
                for loss in (0.0, 0.3, 0.5):
                    jobs.append(dict(base, eta=eta, latency=lat, loss=loss, seed=1, label="B-knn-" + tag))
        B = pool.map(run, jobs)
    json.dump({"A": A, "B": B, "eta_peak": eta_peak, "runtime_s": time.time() - t0},
              open("results/data/exp4b_hybrid_knn.json", "w"), indent=1)
    print("all done", time.time() - t0)

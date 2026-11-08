"""Sim 3b: more repeats for the large flocks.

In Sim 3 the 2,048- and 4,096-agent flocks ran once per noise level, so their
fluctuation curves are noisy and the peak position is uncertain. This script
adds three more independent runs (seeds 1-3) around the peak, and also extends
the noise range down to 1.6/1.7 in case the peak sits below the first sweep.

Output: results/data/exp3b_large_n_repeats.json (one row per run). The figure
script averages these runs with the Sim 3 runs; see merge_finite_size() in
make_figures.py.
"""
import json, sys, time, os
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from experiments.exp3_finite_size import job

PLAN = {
    2048: dict(etas=np.round(np.arange(1.6, 2.81, 0.1), 3), eq=10000, meas=40000, seeds=(1, 2, 3)),
    4096: dict(etas=np.round(np.arange(1.7, 2.81, 0.1), 3), eq=10000, meas=30000, seeds=(1, 2, 3)),
}

if __name__ == "__main__":
    jobs = [(n, float(e), sd, p["eq"], p["meas"]) for n, p in PLAN.items() for e in p["etas"] for sd in p["seeds"]]
    jobs.sort(key=lambda j: -j[0] * (j[3] + j[4]))
    t0 = time.time()
    res = []
    with Pool(2) as pool:
        for i, r in enumerate(pool.imap_unordered(job, jobs)):
            res.append(r)
            print(f"{i+1}/{len(jobs)} done, {time.time()-t0:.0f}s", flush=True)
            os.makedirs("results/data", exist_ok=True)
            json.dump({"meta": {"runtime_s": time.time() - t0, "complete": len(res) == len(jobs)}, "runs": res},
                      open("results/data/exp3b_large_n_repeats.json", "w"), indent=1)
    print("all done", time.time() - t0)

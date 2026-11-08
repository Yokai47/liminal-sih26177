"""Sim 3: finite-size sweep.

Runs the reference Vicsek model at constant density for flock sizes from 8 to
4,096 agents across a range of noise levels, and records the order parameter,
susceptibility (fluctuations), Binder cumulant and autocorrelation.

Question it answers: does a flock of 8 show a real transition, and how does the
picture change as the flock grows? (Physics background: a finite system has no
sharp phase transition, only a smooth crossover whose fluctuation peak sharpens
and shifts as N grows; see Attanasi et al., arXiv:1412.6975.)

Output: results/data/exp3_finite_size.json
"""
import json, sys, time, os
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim.vicsek import run_periodic, init_random, box_size
from liminal_sim.stats import summarize

DENSITY = 2.0   # agents per R^2
V0 = 0.03       # step length in units of R (standard small-speed Vicsek)
R = 1.0

PLAN = {
    8:    dict(etas=np.round(np.arange(0.5, 5.01, 0.25), 3), eq=5000, meas=400000, seeds=4),
    32:   dict(etas=np.round(np.arange(0.5, 5.01, 0.25), 3), eq=5000, meas=200000, seeds=3),
    128:  dict(etas=np.round(np.arange(1.0, 4.51, 0.2), 3), eq=10000, meas=100000, seeds=2),
    512:  dict(etas=np.round(np.arange(1.6, 3.81, 0.1), 3), eq=10000, meas=60000, seeds=1),
    2048: dict(etas=np.round(np.arange(1.8, 3.61, 0.1), 3), eq=10000, meas=40000, seeds=1),
    4096: dict(etas=np.round(np.arange(2.0, 3.41, 0.1), 3), eq=10000, meas=30000, seeds=1),
}


def job(args):
    n, eta, seed, eq, meas = args
    L = box_size(n, DENSITY)
    x, y, th = init_random(n, L, 1000 * n + seed)
    run_periodic(x, y, th, L, R, V0, eta, eq, seed)
    phi = run_periodic(x, y, th, L, R, V0, eta, meas, seed + 7919)
    s = summarize(phi, n)
    s.update(n=n, eta=float(eta), seed=seed, steps=meas)
    return s


if __name__ == "__main__":
    jobs = []
    for n, p in PLAN.items():
        for eta in p["etas"]:
            for sd in range(p["seeds"]):
                jobs.append((n, float(eta), sd, p["eq"], p["meas"]))
    # longest first for better load balance
    jobs.sort(key=lambda j: -j[0] * (j[3] + j[4]))
    t0 = time.time()
    with Pool(2) as pool:
        res = []
        for i, r in enumerate(pool.imap_unordered(job, jobs)):
            res.append(r)
            if i % 20 == 0:
                print(f"{i+1}/{len(jobs)} done, {time.time()-t0:.0f}s", flush=True)
    # average seeds
    out = {}
    for r in res:
        out.setdefault((r["n"], r["eta"]), []).append(r)
    rows = []
    for (n, eta), rs in sorted(out.items()):
        row = {"n": n, "eta": eta, "seeds": len(rs)}
        for k in ("phi", "chi", "binder", "ac"):
            row[k] = float(np.mean([r[k] for r in rs]))
        row["phi_err"] = float(np.sqrt(np.mean([r["phi_err"] ** 2 for r in rs]) / len(rs)))
        row["chi_err"] = float(np.sqrt(np.mean([r["chi_err"] ** 2 for r in rs]) / len(rs)))
        rows.append(row)
    meta = dict(density=DENSITY, v0=V0, R=R, model="2D Vicsek, periodic box, angular noise U[-eta/2, eta/2]",
                runtime_s=time.time() - t0)
    os.makedirs("results/data", exist_ok=True)
    json.dump({"meta": meta, "rows": rows}, open("results/data/exp3_finite_size.json", "w"), indent=1)
    print("saved", len(rows), "rows in", time.time() - t0, "s")

"""Sim 13: can a ground robot (UGV) steer the flock without sending commands?

Architecture section 7 says a visibly different UGV breaks the swarm's symmetry
and the drones organise relative to it, with no radio. Here a UGV drives through
a Vicsek flock and turns 90 degrees every 3,000 steps; drones that see it (within
one interaction radius) count its heading w times in their neighbour average.
Compared with no UGV and with a broadcast command to every drone.

Part A: 128 drones, noise 0.5 to 4.5, w = 1, 4, 16, 8 runs each.
Part B: one UGV (w = 4) in flocks of 32, 128 and 512 drones, and four UGVs
(one per 128 drones, all driving the same way) in the flock of 512.

Measures (see liminal_sim/ugv.py): G = share of the flock's motion along the
UGV's heading, averaged after the first segment; the mean G curve after a turn;
the half-response time (steps until that curve is half way to its level at the
end of the segment; right after a 90 degree turn the flock moves across the new
heading, so the curve starts from 0).

Output: results/data/exp13_ugv.json
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim.ugv import run_ugv, ugv_start
from liminal_sim.vicsek import init_random, box_size

DENSITY, V0, R, RU = 2.0, 0.03, 1.0, 1.0
T, SEGS, REC, SEEDS = 3000, 9, 10, 8
ETAS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5]
CONFIGS = [("none", 0, 0.0), ("local w=1", 1, 1.0), ("local w=4", 1, 4.0),
           ("local w=16", 1, 16.0), ("broadcast", 2, 1.0)]


def job(a):
    n, eta, name, mode, w, seed, m = a
    L = box_size(n, DENSITY)
    x, y, th = init_random(n, L, 7000 + 31 * seed + n)
    ux, uy = ugv_start(L, m)
    phi, theta, g, psi, seen = run_ugv(x, y, th, L, R, V0, eta, T * SEGS, 100 + seed,
                                       mode, w, RU, T, REC, ux, uy)
    per = T // REC
    gs = g[per:]                                   # drop the first segment (start-up)
    curve = gs.reshape(SEGS - 1, per).mean(axis=0)  # mean over the 8 turns
    return dict(n=n, ugvs=m, eta=eta, config=name, seed=seed, G=float(gs.mean()),
                phi=float(phi[per:].mean()), seen=float(seen[per:].mean()),
                curve=curve.tolist())


def half_time(curve):
    """Steps until the mean post-turn curve first reaches half of its mean over the
    last third of the segment. Just before the turn the flock moves along the old
    heading, at 90 degrees to the new one, so the curve starts from 0."""
    c = np.asarray(curve)
    end = c[2 * len(c) // 3:].mean()
    if end < 0.1:
        return None                                # no clear response to time
    hit = np.nonzero(c >= 0.5 * end)[0]
    return int((hit[0] + 1) * REC) if len(hit) else None


def summarise(res, keys):
    out = []
    groups = {}
    for r in res:
        groups.setdefault(tuple(r[k] for k in keys), []).append(r)
    for k, rs in sorted(groups.items(), key=lambda kv: tuple(str(v) for v in kv[0])):
        G = np.array([r["G"] for r in rs])
        curve = np.mean([r["curve"] for r in rs], axis=0)
        # half time per run, for a between-run spread
        ht = [half_time(r["curve"]) for r in rs]
        ht_ok = [h for h in ht if h is not None]
        out.append(dict(**{kk: vv for kk, vv in zip(keys, k)}, runs=len(rs),
                        G=float(G.mean()), G_se=float(G.std(ddof=1) / np.sqrt(len(G))),
                        phi=float(np.mean([r["phi"] for r in rs])),
                        seen=float(np.mean([r["seen"] for r in rs])),
                        t_half=half_time(curve),
                        t_half_runs_median=float(np.median(ht_ok)) if ht_ok else None,
                        t_half_runs_n=len(ht_ok),
                        curve=curve.tolist()))
    return out


if __name__ == "__main__":
    t0 = time.time()
    jobsA = [(128, e, nm, md, w, s, 1) for e in ETAS for (nm, md, w) in CONFIGS for s in range(SEEDS)]
    jobsB = [(n, e, "local w=4", 1, 4.0, s, m) for (n, m) in ((32, 1), (512, 1), (512, 4))
             for e in (1.0, 2.0, 3.0) for s in range(SEEDS)]
    with Pool(2) as p:
        resA = p.map(job, jobsA, chunksize=4)
        resB = p.map(job, jobsB, chunksize=2)
    resB += [r for r in resA if r["config"] == "local w=4" and r["eta"] in (1.0, 2.0, 3.0)]
    out = dict(params=dict(density=DENSITY, v0=V0, R=R, Ru=RU, turn_every=T, segments=SEGS,
                           rec=REC, seeds=SEEDS, curve_step=REC),
               partA=summarise(resA, ["config", "eta"]),
               partB=summarise(resB, ["n", "ugvs", "eta"]),
               seconds=round(time.time() - t0))
    os.makedirs("results/data", exist_ok=True)
    json.dump(out, open("results/data/exp13_ugv.json", "w"), indent=1)
    for r in out["partA"]:
        print(r["config"], r["eta"], "G=%.2f+-%.2f" % (r["G"], r["G_se"]), "phi=%.2f" % r["phi"],
              "t_half", r["t_half"], "seen=%.1f" % r["seen"])
    for r in out["partB"]:
        print("N", r["n"], "ugvs", r["ugvs"], r["eta"], "G=%.2f+-%.2f" % (r["G"], r["G_se"]), "t_half", r["t_half"])
    print("seconds", out["seconds"])

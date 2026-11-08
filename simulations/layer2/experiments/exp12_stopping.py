"""Sim 12: when is a search finished?

The same 30 generated floors as Sim 9. One drone explores with the nearest-frontier
planner and does not stop when it has found every victim (a real drone cannot know
that). For each stopping rule we record when it would end the search, which victims
it would miss, how much truly open floor space is still unseen, and how much of
that the rule reports to rescuers (only the topological audit reports anything).
Rules: fixed budget (5, 10 min), plateau (map grew < 1 m^2 in 60 s), frontier
exhaustion, exhaustion + audit (report flagged regions, no extra flight), and the
full topological rule (audit, fly to look into each flagged region, report the rest).
Output: results/data/exp12_stopping.json, results/data/exp12_example.npz
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim import stopping as S
from liminal_sim import explore as E

SEEDS = range(1, 31)          # the Sim 9 floors
EXAMPLE = 4


def job(seed):
    r = S.run_search(seed, t_max=1800.0)
    ev = S.evaluate(r)
    ev["curve"] = [(e["t"], e["found"], e["unseen_open_m2"]) for e in r["log"]]
    if seed == EXAMPLE:
        solid, start, victims, _ = E.make_building(seed)
        np.savez_compressed("results/data/exp12_example.npz", grid=r["grid"], solid=solid,
                            flagged=r["reported"], victims=np.array(victims), start=np.array(start))
    return ev


if __name__ == "__main__":
    t0 = time.time()
    with Pool(2) as pool:
        res = pool.map(job, list(SEEDS), chunksize=1)
    json.dump({"runs": res, "runtime_s": time.time() - t0}, open("results/data/exp12_stopping.json", "w"))
    print("done", time.time() - t0)

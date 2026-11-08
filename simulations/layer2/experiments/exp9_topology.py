"""Sim 9: topology of the map, and does it help find victims?

A) On generated collapsed buildings, one drone explores with three policies
   (nearest frontier, utility, topology-boosted utility) for 10 minutes; we record
   victims found over time (open-room victims and victims inside walled pockets)
   and the area mapped.
B) On one fully explored map: Betti numbers, the room graph (persistent homology of
   the distance to obstacles), and how many bytes the room graph takes compared with
   the occupancy grid.
C) Pocket detector on part-explored maps (2 and 4 minutes into a nearest-frontier
   search, all 30 floors): how many still-unseen real pockets it flags, and how many
   other regions it flags.
All 2D, simplified (no drone dynamics, perfect localisation, ideal sensors).
Output: results/data/exp9_topology.json, results/data/exp9_example.npz
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim import explore as E
from liminal_sim import topology as T

SEEDS = range(1, 31)
POLICIES = ("nearest", "utility", "topology", "nearest_pockets")


def job(a):
    seed, pol = a
    r = E.run_episode(seed, pol, t_max=600.0)
    r.pop("snaps", None)
    return r


CHECK_T = (120.0, 240.0)


def pocket_check(seed):
    """How well the pocket detector finds the generator's real pockets on a part-explored
    map (nearest-frontier drone, maps kept at CHECK_T). A real pocket counts as still
    unseen if more than half its inside is unknown; it is detected if a detected pocket
    region overlaps its inside. Detections that overlap no real pocket are counted too."""
    solid, start, victims, pk = E.make_building(seed)
    r = E.run_episode(seed, "nearest", t_max=max(CHECK_T), snap_times=CHECK_T)
    out = []
    for t in CHECK_T:
        g = r["snaps"].get(t)
        if g is None:                        # episode ended early (all victims found)
            continue
        det = T.pockets(g, E.RES)
        unseen = [m for m in pk if (g[m] == T.UNK).mean() > 0.5]
        hit = sum(1 for m in unseen if any((d["cells"] & m).any() for d in det))
        other = [d for d in det if not any((d["cells"] & m).any() for m in pk)]
        # the flags the pockets-first planners act on (open, at least 1 m^2), and how many are real pockets
        used = [d for d in det if not d["sealed"] and d["area_m2"] >= 1.0]
        out.append(dict(seed=seed, t=t, pockets_unseen=len(unseen), detected=hit, other_flags=len(other),
                        other_sealed=sum(1 for d in other if d["sealed"]),
                        other_area_m2=[d["area_m2"] for d in other],
                        planner_flags=len(used), planner_flags_on_real=sum(1 for d in used if any((d["cells"] & m).any() for m in pk))))
    return out


def example(seed=4):
    solid, start, victims, pk = E.make_building(seed)
    grid = np.where(solid, T.OCC, T.FREE).astype(np.int8)
    reach = E.open_space(solid, start)
    grid[~reach & ~solid] = T.UNK                     # free space walled off from the start stays unknown
    free = grid == T.FREE
    b0, b1 = T.betti(free)
    rooms, doors, labels = T.room_graph(free, E.RES, min_persistence=0.4)
    raw, comp = T.grid_bytes(grid)
    np.savez_compressed("results/data/exp9_example.npz", solid=solid, labels=labels,
                        rooms=np.array([r["cell"] for r in rooms]),
                        doors=np.array([[d["a"], d["b"], d["cell"][0], d["cell"][1], d["width_m"]] for d in doors]),
                        victims=np.array(victims), pockets=np.array(pk) if pk else np.zeros((0,) + solid.shape, bool),
                        start=np.array(start))
    return dict(seed=seed, betti0=b0, betti1=b1, rooms=len(rooms), doors=len(doors),
                door_widths=[d["width_m"] for d in doors], graph_bytes=T.graph_bytes(rooms, doors),
                grid_bytes_raw=raw, grid_bytes_zlib=comp, cells=int(grid.size), pockets_true=len(pk),
                sealed_void_m2=float((~reach & ~solid).sum() * E.RES * E.RES))


if __name__ == "__main__":
    t0 = time.time()
    only = sys.argv[1:]                     # e.g. "nearest_pockets": run one policy and merge into the saved results
                                            # "check": only redo the example and the pocket-detector check
    ex = example()
    print("example", {k: v for k, v in ex.items() if k != "door_widths"}, flush=True)
    with Pool(2) as pool:
        chk = [c for cs in pool.map(pocket_check, list(SEEDS)) for c in cs]
    print("pocket check done", flush=True)
    if only == ["check"]:
        d = json.load(open("results/data/exp9_topology.json"))
        d.update(example=ex, pocket_check=chk)
        json.dump(d, open("results/data/exp9_topology.json", "w"))
        sys.exit(0)
    jobs = [(s, p) for s in SEEDS for p in (only or POLICIES)]
    with Pool(2) as pool:
        res = pool.map(job, jobs, chunksize=1)
    if only and os.path.exists("results/data/exp9_topology.json"):
        old = json.load(open("results/data/exp9_topology.json"))["episodes"]
        res = [e for e in old if e["policy"] not in only] + res
    json.dump({"episodes": res, "example": ex, "pocket_check": chk, "runtime_s": time.time() - t0},
              open("results/data/exp9_topology.json", "w"))
    print("all done", time.time() - t0)

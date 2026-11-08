"""Sim 16: marks instead of radio (stigmergy, architecture section 10).

Six drones search a collapsed floor (the floors of Sims 9 and 12; model in
liminal_sim/stigmergy.py). Radio is assumed jammed except in the "radio" upper
bound. Compared (20 floors each):
  radio      ideal shared map (upper bound)
  alone      no sharing at all
  marks 1 m  simple marks ("searched around here") dropped every 1 m
  marks 3 m  the same every 3 m
  tags 10 m  data tags (store the dropper's whole searched-map) every 10 m
  tags 25 m  the same every 25 m
Measured: time until 50, 75, 90, 95 and 99% of the searchable floor has been
searched (the last percent is slow, scattered mop-up of small leftovers next to
walls, so 90% is the main measure and 99% is reported with that caveat), the
coverage curve, distance flown, marks or tags used.

Persistence test: a first wave of six drones (not sharing anything) flies for
3 minutes (battery), leaving marks every 1 m and data tags every 10 m, and lands
where it is. A second wave of six new drones with no memory of the first then
enters. The same first wave is used for every second-wave variant. To isolate
what the first wave's marks are worth, each sharing method is run with and
without them:
  alone                 no sharing, ignores the marks
  marks, own only       drops and reads its own simple marks (1 m), not the first wave's
  marks + first wave's  also reads the first wave's simple marks
  tags, own only        drops and reads its own data tags (10 m), not the first wave's
  tags + first wave's   also reads the first wave's data tags
  tags + full map       reference: the first wave's whole searched-map is handed
                        over at the door (one data tag at the entrance), plus own tags
Measured: second-wave times until 90, 95 and 99% of the floor is searched
(counting what the first wave searched), its coverage curve, and distance flown.

Output: results/data/exp16_stigmergy.json
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim import stigmergy as S

FLOORS = list(range(20))
POLICIES = [("radio", "radio", 2.0), ("alone", "alone", 2.0), ("marks 1 m", "marks", 1.0),
            ("marks 3 m", "marks", 3.0), ("tags 10 m", "tags", 10.0), ("tags 25 m", "tags", 25.0)]
WAVE1_S = 180
T_MAX = 1500
FRACS = (0.50, 0.75, 0.90, 0.95, 0.99)
CURVE_EVERY = 5


def times(c):
    return {f"t{int(round(100 * f))}": S.time_to(c, f) for f in FRACS}


def sampled(c):
    """Coverage every CURVE_EVERY s up to T_MAX, held at its last value after the run stops."""
    idx = np.arange(0, T_MAX, CURVE_EVERY)
    return [float(c[min(i, len(c) - 1)]) for i in idx]


def job_main(a):
    seed, name, pol, every = a
    w = S.world(seed)
    r = S.run(seed, pol, t_max=T_MAX, mark_every_m=every, wrld=w)
    c = r["curve"]
    return dict(floor=seed, policy=name, **times(c), curve=sampled(c),
                final=float(c[-1]), flown=r["flown"], marks=len(r["marks"]) + len(r["tags"]),
                searchable_m2=r["n_searchable"] * S.RES ** 2)


WAVE_VARIANTS = ("alone", "marks, own only", "marks + first wave's", "tags, own only", "tags + first wave's", "tags + full map")


def job_wave(seed):
    w = S.world(seed)
    r1 = S.run(seed, "alone", t_max=T_MAX, active_until=WAVE1_S, wrld=w, write_marks_m=1.0, write_tags_m=10.0)
    wave1 = r1["truth"]
    out = dict(floor=seed, wave1_cov=float(r1["curve"][-1]), wave1_marks=len(r1["marks"]), wave1_tags=len(r1["tags"]))
    start = w[1]
    variants = (("alone", "alone", 2.0, [], []),
                ("marks, own only", "marks", 1.0, [], []),
                ("marks + first wave's", "marks", 1.0, r1["marks"], []),
                ("tags, own only", "tags", 10.0, [], []),
                ("tags + first wave's", "tags", 10.0, [], r1["tags"]),
                ("tags + full map", "tags", 10.0, [], [(start[0], start[1], wave1)]))
    for name, pol, every, pm, pt in variants:
        r2 = S.run(seed + 500, pol, t_max=T_MAX, mark_every_m=every, prior_marks=pm, prior_tags=pt,
                   prior_truth=wave1, wrld=w)
        out[name] = dict(**times(r2["curve"]), curve=sampled(r2["curve"]), flown=r2["flown"])
    return out


def wave_summary(waves):
    wrows = {}
    for nm in WAVE_VARIANTS:
        wrows[nm] = dict(flown=stat([w[nm]["flown"] for w in waves]),
                         curve=np.mean([w[nm]["curve"] for w in waves], axis=0).tolist(),
                         **{k: stat([w[nm][k] for w in waves]) for k in ("t90", "t95", "t99")})
    def pd(a, b, key):
        return stat([w[a][key] - w[b][key] for w in waves if w[a][key] is not None and w[b][key] is not None])
    PAIRS = (("marks + first wave's", "marks, own only"), ("tags + first wave's", "tags, own only"),
             ("tags + full map", "tags, own only"), ("marks, own only", "alone"), ("tags, own only", "alone"))
    wpairs = {key: {f"{a} - {b}": pd(a, b, key) for a, b in PAIRS} for key in ("t90", "t99")}
    wrows["wave1_cov"] = stat([w["wave1_cov"] for w in waves])
    wrows["wave1_marks"] = stat([w["wave1_marks"] for w in waves])
    wrows["wave1_tags"] = stat([w["wave1_tags"] for w in waves])
    return wrows, wpairs


def print_wave(wrows, wpairs):
    for k in WAVE_VARIANTS:
        print("wave2", k, " ".join("%s %.0f+-%.0f" % (q, wrows[k][q]["mean"], wrows[k][q]["se"]) for q in ("t90", "t95", "t99")))
    for key, v in wpairs.items():
        for k, x in v.items():
            print("wave2 paired", key, k, "%.0f+-%.0f" % (x["mean"], x["se"]))
    print("wave1 coverage %.2f" % wrows["wave1_cov"]["mean"])


def stat(v):
    v = [x for x in v if x is not None]
    if not v:
        return None
    v = np.array(v, float)
    return dict(mean=float(v.mean()), se=float(v.std(ddof=1) / np.sqrt(len(v))) if len(v) > 1 else None,
                min=float(v.min()), max=float(v.max()), n=len(v))


if __name__ == "__main__" and sys.argv[1:] == ["wave"]:
    # redo only the persistence test, keeping the main comparison
    out = json.load(open("results/data/exp16_stigmergy.json"))
    with Pool(2) as p:
        waves = p.map(job_wave, FLOORS, chunksize=1)
    out["wave"], out["wave_paired"] = wave_summary(waves)
    out["per_floor_wave"] = waves
    json.dump(out, open("results/data/exp16_stigmergy.json", "w"), indent=1)
    print_wave(out["wave"], out["wave_paired"])
elif __name__ == "__main__":
    t0 = time.time()
    jobs = [(s, nm, p, e) for s in FLOORS for (nm, p, e) in POLICIES]
    with Pool(2) as p:
        main = p.map(job_main, jobs, chunksize=1)
        waves = p.map(job_wave, FLOORS, chunksize=1)
    rows = []
    for nm, _, _ in POLICIES:
        rs = [r for r in main if r["policy"] == nm]
        row = dict(policy=nm, floors=len(rs), reached99=sum(r["t99"] is not None for r in rs),
                   flown=stat([r["flown"] for r in rs]), marks=stat([r["marks"] for r in rs]),
                   curve=np.mean([r["curve"] for r in rs], axis=0).tolist())
        for f in FRACS:
            k = f"t{int(round(100 * f))}"
            row[k] = stat([r[k] for r in rs])
        rows.append(row)
    # paired differences per floor
    def paired(a, b, key):
        d = []
        for s_ in FLOORS:
            ra = next(r for r in main if r["floor"] == s_ and r["policy"] == a)
            rb = next(r for r in main if r["floor"] == s_ and r["policy"] == b)
            if ra[key] is not None and rb[key] is not None:
                d.append(ra[key] - rb[key])
        return stat(d)
    PAIRS = (("alone", "radio"), ("marks 1 m", "alone"), ("marks 3 m", "alone"), ("tags 10 m", "alone"),
             ("tags 25 m", "alone"), ("tags 10 m", "radio"), ("marks 1 m", "radio"), ("marks 3 m", "radio"))
    pairs = {key: {f"{a} - {b}": paired(a, b, key) for a, b in PAIRS} for key in ("t90", "t99")}
    wrows, wpairs = wave_summary(waves)
    out = dict(params=dict(drones=6, speed=0.5, sense_m=3.0, read_m=3.0, launch_gap=15, spread_m=5.0, t_max=T_MAX,
                           wave1_s=WAVE1_S, floors=len(FLOORS)),
               curve_every=CURVE_EVERY, rows=rows, paired=pairs, wave=wrows, wave_paired=wpairs,
               per_floor=main, per_floor_wave=waves,
               seconds=round(time.time() - t0))
    json.dump(out, open("results/data/exp16_stigmergy.json", "w"), indent=1)
    for r in rows:
        print(r["policy"], " ".join("%s %.0f+-%.0f" % (k, r[k]["mean"], r[k]["se"]) for k in ("t50", "t75", "t90", "t95", "t99")),
              "flown %.0f" % r["flown"]["mean"], "marks %.0f" % r["marks"]["mean"])
    for key, v in pairs.items():
        for k, x in v.items():
            print(key, k, "%.0f+-%.0f" % (x["mean"], x["se"]))
    print_wave(wrows, wpairs)
    print("seconds", out["seconds"])

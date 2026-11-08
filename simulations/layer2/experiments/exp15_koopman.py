"""Sim 15: does a linear (Koopman/DMD) model predict the flock? (architecture section 16)

Data: Vicsek flock, 128 drones, observables (51 coarse-grained numbers, see
liminal_sim/koopman.py) sampled every 10 steps. Two cases:
  free     no UGV; the flock moves on its own
  steered  a UGV whose heading is a random input (new value every 50 steps, as in
           Sim 14) steers the drones that see it; the model gets the UGV heading
           as a known input (DMD with control)
Models are fitted on 3 runs (5,000 samples each) and tested on 2 fresh runs.
Rank r is chosen by leave-one-run-out validation (5-sample-ahead error).

Compared at horizons of 1 to 50 samples (10 to 500 steps):
  order phi:  DMD; persistence (phi stays as it is); AR(1) on phi alone (a
              one-number linear model); the long-run mean. Skill = 1 - MSE/MSE of
              the long-run mean (1 perfect, 0 no better than the mean, < 0 worse).
  heading:    mean absolute error of the flock's heading, DMD vs persistence and
              "constant" (always predict the training runs' mean heading); in the
              steered case also "copy the UGV" (predict the flock will head where
              the UGV is heading now) and "smoother", a one-parameter model given the
              same known future UGV headings as DMD: start from the flock's heading
              and move a fraction a of the angle towards the UGV's heading each
              sample (a fitted on the training runs, 5 samples ahead). Added after
              an independent review: the first version had only persistence and
              copy-the-UGV, both of which ignore the future inputs DMD is given.
Noise eta 0.5 to 4.5, three independent repeats.

Output: results/data/exp15_koopman.json
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim.reservoir import run_reservoir
from liminal_sim.koopman import DMD, ar1_fit, angle_error
from liminal_sim.vicsek import init_random, box_size

N, DENSITY, V0, R, RU, W = 128, 2.0, 0.03, 1.0, 1.0, 4.0
L = box_size(N, DENSITY)
DT = 10                 # steps per sample
HOLD = 5                # samples per UGV input value (50 steps)
T = 5000                # samples per run (50,000 steps)
WASH = 100
HORIZONS = [1, 2, 5, 10, 20, 50]
RANKS = [2, 5, 10, 20, 51]
NTRAIN, NTEST, REPEATS = 3, 2, 3
IPHI, ICOS, ISIN = 48, 49, 50


def run(eta, steered, seed):
    rng = np.random.default_rng(seed)
    nval = (T + WASH) // HOLD + 2
    uval = rng.uniform(-1, 1, nval) if steered else np.zeros(nval)
    u = np.repeat(uval, HOLD)[: T + WASH + 1]
    x, y, th = init_random(N, L, seed + 1)
    g = run_reservoir(x, y, th, L, R, V0, eta, u[:-1], DT, seed + 2, W if steered else 0.0, RU, L / 2, L / 2)
    psi = 0.5 * np.pi * u
    v = np.stack([np.cos(psi[1:]), np.sin(psi[1:])], axis=1)   # v[t]: input during t -> t+1
    return g[WASH:], v[WASH:], psi[WASH:-1]                     # psi[t]: UGV heading during the interval ending at t


SMOOTH_RATES = [0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 1.0]


def wrap(a):
    return (a + np.pi) % (2 * np.pi) - np.pi


def smoother(g, psi, t0, h, a):
    """Flock heading at t0, moved a fraction a towards the known UGV heading each sample."""
    s = np.arctan2(g[t0, ISIN], g[t0, ICOS])
    for k in range(1, h + 1):
        s = s + a * wrap(psi[t0 + k] - s)
    return s


def fit_smoother(train, h=5):
    best, best_a = np.inf, SMOOTH_RATES[0]
    for a in SMOOTH_RATES:
        e = []
        for g, v, psi in train:
            t0 = np.arange(0, len(g) - h, 7)
            s = smoother(g, psi, t0, h, a)
            e.append(angle_error(g[t0 + h, ICOS], g[t0 + h, ISIN], np.cos(s), np.sin(s)))
        me = float(np.mean(np.concatenate(e)))
        if me < best:
            best, best_a = me, a
    return best_a


def mean_heading(train):
    hd = np.concatenate([np.arctan2(q[0][:, ISIN], q[0][:, ICOS]) for q in train])
    return float(np.arctan2(np.sin(hd).mean(), np.cos(hd).mean()))


def evaluate(model, test, h, n_in, ar, head0=0.0, a_s=None):
    m_phi, a_phi = ar
    out = dict(dmd_phi=[], pers_phi=[], ar_phi=[], clim_phi=[], dmd_head=[], pers_head=[], ugv_head=[],
               const_head=[], smooth_head=[])
    for g, v, psi in test:
        t0 = np.arange(0, len(g) - h, 3)
        fut = np.stack([v[t0 + k] for k in range(h)], axis=1) if n_in else None
        pred = model.predict(g[t0], h, fut)
        tru = g[t0 + h]
        out["dmd_phi"].append((pred[:, IPHI] - tru[:, IPHI]) ** 2)
        out["pers_phi"].append((g[t0, IPHI] - tru[:, IPHI]) ** 2)
        out["ar_phi"].append((m_phi + a_phi ** h * (g[t0, IPHI] - m_phi) - tru[:, IPHI]) ** 2)
        out["clim_phi"].append((m_phi - tru[:, IPHI]) ** 2)
        out["dmd_head"].append(angle_error(tru[:, ICOS], tru[:, ISIN], pred[:, ICOS], pred[:, ISIN]))
        out["pers_head"].append(angle_error(tru[:, ICOS], tru[:, ISIN], g[t0, ICOS], g[t0, ISIN]))
        out["ugv_head"].append(angle_error(tru[:, ICOS], tru[:, ISIN], np.cos(psi[t0]), np.sin(psi[t0])))
        out["const_head"].append(angle_error(tru[:, ICOS], tru[:, ISIN], np.full(len(t0), np.cos(head0)),
                                             np.full(len(t0), np.sin(head0))))
        if n_in:
            sm = smoother(g, psi, t0, h, a_s)
            out["smooth_head"].append(angle_error(tru[:, ICOS], tru[:, ISIN], np.cos(sm), np.sin(sm)))
    o = {k: float(np.mean(np.concatenate(v))) for k, v in out.items() if v}
    clim = o["clim_phi"]
    res = dict(h=h, skill_dmd=1 - o["dmd_phi"] / clim, skill_pers=1 - o["pers_phi"] / clim,
               skill_ar=1 - o["ar_phi"] / clim, head_dmd=o["dmd_head"], head_pers=o["pers_head"],
               head_const=o["const_head"])
    if n_in:
        res["head_ugv"] = o["ugv_head"]
        res["head_smooth"] = o["smooth_head"]
    return res


def job(a):
    eta, steered, rep = a
    base = 200000 * rep + int(1000 * eta) + (50000 if steered else 0)
    runs = [run(eta, steered, base + 17 * i) for i in range(NTRAIN + NTEST)]
    train, test = runs[:NTRAIN], runs[NTRAIN:]
    n_in = 2 if steered else 0
    # rank by leave-one-run-out validation, 5 samples ahead, all observables (z-scored)
    best, best_r = np.inf, RANKS[0]
    for r in RANKS:
        errs = []
        for i in range(NTRAIN):
            tr = [train[j] for j in range(NTRAIN) if j != i]
            m = DMD(r, n_in).fit([q[0] for q in tr], [q[1] for q in tr] if n_in else None)
            g, v, _ = train[i]
            t0 = np.arange(0, len(g) - 5, 7)
            fut = np.stack([v[t0 + k] for k in range(5)], axis=1) if n_in else None
            p = m.predict(g[t0], 5, fut)
            errs.append(np.mean(((p - g[t0 + 5]) / m.sd) ** 2))
        if np.mean(errs) < best:
            best, best_r = np.mean(errs), r
    model = DMD(best_r, n_in).fit([q[0] for q in train], [q[1] for q in train] if n_in else None)
    ar = ar1_fit([q[0][:, IPHI] for q in train])
    head0 = mean_heading(train)
    a_s = fit_smoother(train) if n_in else None
    ev = [evaluate(model, test, h, n_in, ar, head0, a_s) for h in HORIZONS]
    lam = model.eigenvalues()
    return dict(eta=eta, steered=steered, rep=rep, rank=best_r, ar_a=ar[1], phi_mean=ar[0], smooth_rate=a_s,
                max_abs_eig=float(np.max(np.abs(lam))), horizons=ev)


if __name__ == "__main__":
    t0 = time.time()
    etas = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5]
    jobs = [(e, s, r) for s in (False, True) for e in etas for r in range(REPEATS)]
    with Pool(2) as p:
        res = p.map(job, jobs, chunksize=1)
    rows = []
    for s in (False, True):
        for e in etas:
            rs = [r for r in res if r["eta"] == e and r["steered"] == s]
            hz = []
            for i, h in enumerate(HORIZONS):
                d = dict(h=h, steps=h * DT)
                for k in rs[0]["horizons"][i]:
                    if k == "h":
                        continue
                    v = np.array([r["horizons"][i][k] for r in rs])
                    d[k] = float(v.mean()); d[k + "_se"] = float(v.std(ddof=1) / np.sqrt(len(v)))
                hz.append(d)
            rows.append(dict(case="steered" if s else "free", eta=e, repeats=len(rs),
                             ranks=[r["rank"] for r in rs], phi_mean=float(np.mean([r["phi_mean"] for r in rs])),
                             ar_a=float(np.mean([r["ar_a"] for r in rs])),
                             smooth_rate=[r["smooth_rate"] for r in rs],
                             max_abs_eig=[r["max_abs_eig"] for r in rs], horizons=hz))
    out = dict(params=dict(N=N, density=DENSITY, v0=V0, R=R, Ru=RU, w=W, dt=DT, hold_samples=HOLD,
                           samples_per_run=T, train_runs=NTRAIN, test_runs=NTEST, repeats=REPEATS,
                           horizons=HORIZONS, ranks=RANKS),
               rows=rows, seconds=round(time.time() - t0))
    json.dump(out, open("results/data/exp15_koopman.json", "w"), indent=1)
    for r in rows:
        for d in r["horizons"]:
            if d["h"] in (1, 10, 50):
                extra = " const %.0f" % d["head_const"]
                extra += " ugv %.0f smooth %.0f" % (d["head_ugv"], d["head_smooth"]) if "head_ugv" in d else ""
                print(r["case"], r["eta"], "r", r["ranks"], "h", d["h"],
                      "skill dmd %.2f pers %.2f ar %.2f | head dmd %.0f pers %.0f%s" % (
                          d["skill_dmd"], d["skill_pers"], d["skill_ar"], d["head_dmd"], d["head_pers"], extra))
    print("seconds", out["seconds"])

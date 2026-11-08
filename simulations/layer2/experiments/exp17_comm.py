"""Sim 17: the communication layer (architecture sections 18 and 21).

Part A, mesh radio and merging after a split (section 18). Six drones search the
Sim 16 floors with a radio of limited range (5, 10 or 20 m along free space).
Linked drones merge their searched-maps by set union (a CRDT, see
liminal_sim/stigmergy.py). Measured: time to search 90% and 99% of the floor
(paired with the ideal radio and with no sharing from Sim 16, same floors and drones),
(time to 90% is the main measure, as in Sim 16), how often the drones were
split into more than one group, and a check that no
drone ever believes a cell is searched when it is not (beliefs contain only real
observations, so a merge can never invent coverage).

Part B, missing reports (section 21: "does the estimator handle changing N?").
A free flock of 128 drones; at every snapshot only n of them report. Measured:
the plain order parameter from the n reports, the corrected estimate (see
liminal_sim/comm.py), and the true order of all 128, for
  random    the n reporting drones are a random subset
  clustered the n reporting drones are the n nearest to one point (as if only
            drones near the ground station's antenna get through)

Part C, unsynchronised clocks (section 21). A flock of 128 steered by a UGV that
turns 90 degrees every 3,000 steps. Each drone's clock is off by a fixed amount,
uniform in [-s, +s] steps, so a "snapshot" mixes headings from different moments.
Measured: error of the snapshot order parameter and heading against the true
ones, overall and in the 300 steps after each turn, and the susceptibility
(N x variance of phi) the skewed snapshots imply.

Output: results/data/exp17_comm.json
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim import stigmergy as S
from liminal_sim.comm import run_history, phi_of, phi_corrected, skewed_snapshots
from liminal_sim.vicsek import init_random, box_size

FLOORS = list(range(20))
LINKS = [5.0, 10.0, 20.0]
N, DENSITY, V0, R = 128, 2.0, 0.03, 1.0
L = box_size(N, DENSITY)


def job_mesh(a):
    seed, link = a
    w = S.world(seed)
    r = S.run(seed, "mesh", t_max=1500, link_m=link, wrld=w, log_groups=True)
    viol = int(sum((b & ~r["truth"]).sum() for b in r["believed"]))
    g = np.array(r["n_groups"])
    return dict(floor=seed, link=link, t90=S.time_to(r["curve"], 0.90), t95=S.time_to(r["curve"], 0.95),
                t99=S.time_to(r["curve"], 0.99),
                split_frac=float((g > 1).mean()) if len(g) else 0.0, max_groups=int(g.max()) if len(g) else 1,
                false_belief_cells=viol, flown=r["flown"])


def job_dropout(a):
    eta, seed = a
    x, y, th = init_random(N, L, 900 + seed)
    psi = np.zeros(25000)
    hist, hx, hy = run_history(x, y, th, L, R, V0, eta, psi, 50 + seed, 0.0, 1.0, L / 2, L / 2, 25)
    hist, hx, hy = hist[200:], hx[200:], hy[200:]          # drop the first 5,000 steps
    rng = np.random.default_rng(seed)
    out = dict(eta=eta, seed=seed, true=float(np.mean([phi_of(h) for h in hist])), n={})
    cx = cy = L / 2
    for n in (8, 16, 32, 64):
        raw, cor, clu = [], [], []
        for k in range(len(hist)):
            sub = rng.choice(N, n, replace=False)
            raw.append(phi_of(hist[k, sub])); cor.append(phi_corrected(hist[k, sub], N))
            dx = (hx[k] - cx + L / 2) % L - L / 2
            dy = (hy[k] - cy + L / 2) % L - L / 2
            near = np.argsort(dx * dx + dy * dy)[:n]
            clu.append(phi_of(hist[k, near]))
        out["n"][n] = dict(raw=float(np.mean(raw)), corrected=float(np.mean(cor)), clustered=float(np.mean(clu)))
    return out


def turn_headings(rng, segs):
    """UGV heading per segment: starts at 0, then turns +90 or -90 degrees each segment.
    (The first version zeroed the first heading after the cumulative sum, so the first
    turn was 0 or 180 degrees instead of 90; found by an independent review.)"""
    steps = np.where(rng.random(segs) < 0.5, 0.5, -0.5) * np.pi
    steps[0] = 0.0
    return np.cumsum(steps)


def job_skew(a):
    eta, seed = a
    x, y, th = init_random(N, L, 1900 + seed)
    T, segs, rec = 3000, 9, 5
    rng = np.random.default_rng(seed)
    psi = np.repeat(turn_headings(rng, segs), T)
    hist, _, _ = run_history(x, y, th, L, R, V0, eta, psi, 70 + seed, 4.0, 1.0, L / 2, L / 2, rec)
    first = T // rec                                       # drop the first segment
    true_phi = np.abs(np.mean(np.exp(1j * hist), axis=1))
    true_head = np.angle(np.mean(np.exp(1j * hist), axis=1))
    t_idx = np.arange(len(hist))
    after = ((t_idx * rec) % T) < 300                       # 300 steps after a turn
    out = dict(eta=eta, seed=seed, s={})
    for s_steps in (0, 10, 30, 100, 300):
        off = rng.integers(-s_steps // rec, s_steps // rec + 1, N) if s_steps else np.zeros(N, int)
        snap, idx = skewed_snapshots(hist, off)
        keep = idx >= first
        idx, snap = idx[keep], snap[keep]
        ps = np.abs(np.mean(np.exp(1j * snap), axis=1))
        hs = np.angle(np.mean(np.exp(1j * snap), axis=1))
        err = np.abs(ps - true_phi[idx])
        herr = np.degrees(np.abs((hs - true_head[idx] + np.pi) % (2 * np.pi) - np.pi))
        a_ = after[idx]
        out["s"][s_steps] = dict(phi_err=float(err.mean()), phi_err_after_turn=float(err[a_].mean()),
                                 phi_drop_after_turn=float((true_phi[idx][a_] - ps[a_]).mean()),
                                 head_err=float(herr.mean()), head_err_after_turn=float(herr[a_].mean()),
                                 chi_ratio=float(ps.var() / true_phi[idx].var()),
                                 phi_true=float(true_phi[idx].mean()), phi_snap=float(ps.mean()))
    return out


def mean_se(v):
    v = np.array([x for x in v if x is not None], float)
    return dict(mean=float(v.mean()), se=float(v.std(ddof=1) / np.sqrt(len(v))) if len(v) > 1 else None, n=len(v))


def skew_rows(skew):
    srows = []
    for e in (1.0, 2.0):
        rs = [r for r in skew if r["eta"] == e]
        row = dict(eta=e, s={})
        for sv in (0, 10, 30, 100, 300):
            row["s"][sv] = {k: float(np.mean([r["s"][sv][k] for r in rs])) for k in rs[0]["s"][sv]}
        srows.append(row)
    return srows


if __name__ == "__main__" and sys.argv[1:] == ["skew"]:
    # redo only Part C (clock skew), keeping Parts A and B
    out = json.load(open("results/data/exp17_comm.json"))
    with Pool(2) as p:
        skew = p.map(job_skew, [(e, s) for e in (1.0, 2.0) for s in range(4)])
    out["skew"] = skew_rows(skew)
    json.dump(out, open("results/data/exp17_comm.json", "w"), indent=1)
    for r in out["skew"]:
        print("skew eta", r["eta"], {s: (round(d["phi_err"], 3), round(d["phi_drop_after_turn"], 3),
                                          round(d["head_err_after_turn"], 1), round(d["chi_ratio"], 2)) for s, d in r["s"].items()})
elif __name__ == "__main__":
    t0 = time.time()
    with Pool(2) as p:
        mesh = p.map(job_mesh, [(s, l) for l in LINKS for s in FLOORS], chunksize=1)
        drop = p.map(job_dropout, [(e, s) for e in (1.0, 2.0, 3.0, 4.0, 4.5) for s in range(4)])
        skew = p.map(job_skew, [(e, s) for e in (1.0, 2.0) for s in range(4)])
    e16 = json.load(open("results/data/exp16_stigmergy.json"))
    ref = {(r["floor"], r["policy"]): r for r in e16["per_floor"]}
    mrows = []
    for l in LINKS:
        rs = [r for r in mesh if r["link"] == l]
        def diff(key, pol):
            return mean_se([r[key] - ref[(r["floor"], pol)][key] for r in rs
                            if r[key] is not None and ref[(r["floor"], pol)][key] is not None])
        mrows.append(dict(link_m=l, t90=mean_se([r["t90"] for r in rs]), t95=mean_se([r["t95"] for r in rs]),
                          t99=mean_se([r["t99"] for r in rs]), reached99=sum(r["t99"] is not None for r in rs),
                          t90_minus_radio=diff("t90", "radio"), t90_minus_alone=diff("t90", "alone"),
                          t99_minus_radio=diff("t99", "radio"), t99_minus_alone=diff("t99", "alone"),
                          split_frac=mean_se([r["split_frac"] for r in rs]),
                          max_groups=max(r["max_groups"] for r in rs),
                          false_belief_cells=sum(r["false_belief_cells"] for r in rs)))
    drows = []
    for e in (1.0, 2.0, 3.0, 4.0, 4.5):
        rs = [r for r in drop if r["eta"] == e]
        row = dict(eta=e, true=float(np.mean([r["true"] for r in rs])), n={})
        for n in (8, 16, 32, 64):
            row["n"][n] = {k: float(np.mean([r["n"][n][k] for r in rs])) for k in ("raw", "corrected", "clustered")}
        drows.append(row)
    srows = skew_rows(skew)
    out = dict(params=dict(drones_search=6, links=LINKS, N=N, density=DENSITY, v0=V0, R=R,
                           dropout_steps=25000, dropout_discard=5000, skew_turn_every=3000, skew_rec=5,
                           seeds_dropout=4, seeds_skew=4),
               mesh=mrows, mesh_per_floor=mesh, dropout=drows, skew=srows, seconds=round(time.time() - t0))
    json.dump(out, open("results/data/exp17_comm.json", "w"), indent=1)
    for r in mrows:
        print("mesh", r["link_m"], "t90 %.0f" % r["t90"]["mean"], "vs radio %+.0f+-%.0f" % (r["t90_minus_radio"]["mean"], r["t90_minus_radio"]["se"]),
              "vs alone %+.0f+-%.0f" % (r["t90_minus_alone"]["mean"], r["t90_minus_alone"]["se"]), "t99 %.0f" % r["t99"]["mean"],
              "split %.2f" % r["split_frac"]["mean"],
              "maxg", r["max_groups"], "false", r["false_belief_cells"])
    for r in drows:
        print("drop eta", r["eta"], "true %.3f" % r["true"],
              {n: {k: round(v, 3) for k, v in d.items()} for n, d in r["n"].items()})
    for r in srows:
        print("skew eta", r["eta"], {s: (round(d["phi_err"], 3), round(d["phi_drop_after_turn"], 3),
                                          round(d["head_err_after_turn"], 1), round(d["chi_ratio"], 2)) for s, d in r["s"].items()})
    print("seconds", out["seconds"])

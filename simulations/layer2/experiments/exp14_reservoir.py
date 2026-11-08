"""Sim 14: can the flock compute? (reservoir computing, architecture section 17)

Task (the document says one must be defined first): a UGV's heading carries an
input signal u(t) (a new random value in [-1, 1] every `hold` steps). A linear
readout of the flock's coarse state (51 numbers, see liminal_sim/reservoir.py)
is trained to output
  memory    u(t - k) for k = 0..10   (k = 0: the current input; memory capacity
            MC = sum of test r^2 over k = 1..10, as in Jaeger 2001)
  nonlinear u(t) * u(t - 1)          (needs memory and a nonlinearity)
Readouts are trained on 3 independent runs (alpha chosen by leave-one-run-out
cross-validation) and scored on 2 further runs with fresh starting positions,
noise and input. r^2 below zero is counted as zero.

Echo-state / consistency test: two copies of the flock, same input, different
starting positions, headings and noise. If the input drives the state, the
copies' features agree; consistency = mean over features of their correlation.

References, trained and tested the same way on the same kind of input (fresh
random sequences of the same length and rate, not the identical sequences the
flock runs used):
  ESN-51   a standard software echo state network with 51 tanh nodes
           (spectral radius 0.9, input and bias weights uniform in [-0.5, 0.5];
           without the bias a tanh network is odd in u and cannot compute the
           even product task). For scale: a linear reservoir of n numbers has
           memory capacity at most n (Jaeger 2001), and a single running average
           of the input holds current + MC <= 1 in total.
  shuffled the flock run with the input sequence shuffled relative to the
           targets (should score zero: checks the readout cannot cheat)

Sweep: noise eta 0.5 to 4.5 at hold 50 (the flock's half-response time to a UGV
turn is about 30-60 steps, Sim 13), and holds 20 and 100 at three noise levels.
Three independent repeats of the whole train/test split per point.

Output: results/data/exp14_reservoir.json
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim.reservoir import run_reservoir, ridge_fit, ridge_predict, r2, NFEAT
from liminal_sim.vicsek import init_random, box_size

N, DENSITY, V0, R, RU, W = 128, 2.0, 0.03, 1.0, 1.0, 4.0
L = box_size(N, DENSITY)
KMAX = 10
WASH = 50                      # input intervals discarded at the start of every run
ALPHAS = [0.01, 0.1, 1.0, 10.0, 100.0, 1000.0]
NTRAIN_RUNS, NTEST_RUNS, REPEATS = 3, 2, 3


def samples(hold):
    """Input intervals per run: about 50,000 steps of data per run."""
    return int(50000 / hold) + WASH


def flock_run(eta, hold, seed, u=None):
    rng = np.random.default_rng(seed)
    if u is None:
        u = rng.uniform(-1, 1, samples(hold))
    x, y, th = init_random(N, L, seed + 1)
    f = run_reservoir(x, y, th, L, R, V0, eta, u, hold, seed + 2, W, RU, L / 2, L / 2)
    return u, f


def esn_run(u, seed):
    rng = np.random.default_rng(seed)
    n = NFEAT
    Wr = rng.normal(size=(n, n))
    Wr *= 0.9 / np.max(np.abs(np.linalg.eigvals(Wr)))
    win = rng.uniform(-0.5, 0.5, n)
    bias = rng.uniform(-0.5, 0.5, n)
    s = np.zeros(n)
    out = np.empty((len(u), n))
    for t, ut in enumerate(u):
        s = np.tanh(Wr @ s + win * ut + bias)
        out[t] = s
    return out


def targets(u, k, task):
    """Rows t >= KMAX (same rows for every k so scores are comparable)."""
    t = np.arange(KMAX, len(u))
    if task == "mem":
        return u[t - k]
    return u[t] * u[t - 1]


def fit_score(train, test, k, task):
    """train/test: lists of (u, features). Alpha by leave-one-run-out CV."""
    def xy(pairs):
        X = np.vstack([f[WASH:][KMAX:] for u, f in pairs])
        y = np.concatenate([targets(u[WASH:], k, task) for u, f in pairs])
        return X, y
    best, best_a = -np.inf, ALPHAS[0]
    for a in ALPHAS:
        sc = []
        for i in range(len(train)):
            tr = [p for j, p in enumerate(train) if j != i]
            X, y = xy(tr); Xv, yv = xy([train[i]])
            sc.append(r2(yv, ridge_predict(ridge_fit(X, y, a), Xv)))
        if np.mean(sc) > best:
            best, best_a = np.mean(sc), a
    X, y = xy(train); Xt, yt = xy(test)
    return max(0.0, float(r2(yt, ridge_predict(ridge_fit(X, y, best_a), Xt))))


def scores(train, test):
    mem = [fit_score(train, test, k, "mem") for k in range(KMAX + 1)]
    return dict(r2_k=mem, current=mem[0], MC=float(sum(mem[1:])),
                product=fit_score(train, test, 0, "prod"))


def job(a):
    eta, hold, rep = a
    base = 100000 * rep + int(1000 * eta) + 7 * hold
    runs = [flock_run(eta, hold, base + 11 * i) for i in range(NTRAIN_RUNS + NTEST_RUNS)]
    train, test = runs[:NTRAIN_RUNS], runs[NTRAIN_RUNS:]
    out = dict(eta=eta, hold=hold, rep=rep, flock=scores(train, test))
    # shuffled control: features paired with a permuted input sequence
    rng = np.random.default_rng(base + 5)
    sh = lambda pairs: [(rng.permutation(u), f) for u, f in pairs]
    out["shuffled"] = scores(sh(train), sh(test))
    # consistency: second copy driven by the first test run's input
    u0, f0 = test[0]
    _, f1 = flock_run(eta, hold, base + 999, u=u0)
    A, B = f0[WASH:], f1[WASH:]
    cs = [np.corrcoef(A[:, j], B[:, j])[0, 1] for j in range(A.shape[1]) if A[:, j].std() > 0 and B[:, j].std() > 0]
    out["consistency"] = float(np.mean(cs))
    out["consistency_heading"] = float(np.corrcoef(A[:, -1], B[:, -1])[0, 1])   # sin of flock heading
    return out


def references(hold, rep):
    base = 100000 * rep + 7 * hold
    us = [np.random.default_rng(base + 11 * i).uniform(-1, 1, samples(hold)) for i in range(NTRAIN_RUNS + NTEST_RUNS)]
    esn = [(u, esn_run(u, 4242 + rep)) for u in us]
    return dict(hold=hold, rep=rep, esn=scores(esn[:NTRAIN_RUNS], esn[NTRAIN_RUNS:]))


def agg(rows, key):
    vals = [r[key] for r in rows]
    if isinstance(vals[0], dict):
        q = {}
        for f in ("current", "MC", "product"):
            v = np.array([d[f] for d in vals])
            q[f] = float(v.mean()); q[f + "_se"] = float(v.std(ddof=1) / np.sqrt(len(v)))
        q["r2_k"] = np.mean([d["r2_k"] for d in vals], axis=0).tolist()
        return q
    v = np.array(vals)
    return dict(mean=float(v.mean()), se=float(v.std(ddof=1) / np.sqrt(len(v))))


def refs_only():
    out = json.load(open("results/data/exp14_reservoir.json"))
    refs = [references(h, r) for h in (20, 50, 100) for r in range(REPEATS)]
    out["references"] = [dict(hold=h, esn=agg([r for r in refs if r["hold"] == h], "esn")) for h in (20, 50, 100)]
    json.dump(out, open("results/data/exp14_reservoir.json", "w"), indent=1)
    for r in out["references"]:
        print("hold", r["hold"], "ESN current %.2f MC %.2f prod %.2f" % (r["esn"]["current"], r["esn"]["MC"], r["esn"]["product"]))


if __name__ == "__main__" and sys.argv[1:] == ["refs"]:
    refs_only()
elif __name__ == "__main__":
    t0 = time.time()
    etas = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5]
    jobs = [(e, 50, r) for e in etas for r in range(REPEATS)]
    jobs += [(e, h, r) for h in (20, 100) for e in (1.0, 3.0, 4.0) for r in range(REPEATS)]
    with Pool(2) as p:
        res = p.map(job, jobs, chunksize=1)
        refs = p.starmap(references, [(h, r) for h in (20, 50, 100) for r in range(REPEATS)])
    rows = []
    for (eta, hold) in sorted({(r["eta"], r["hold"]) for r in res}):
        rs = [r for r in res if r["eta"] == eta and r["hold"] == hold]
        rows.append(dict(eta=eta, hold=hold, repeats=len(rs), flock=agg(rs, "flock"),
                         shuffled=agg(rs, "shuffled"), consistency=agg(rs, "consistency"),
                         consistency_heading=agg(rs, "consistency_heading")))
    refrows = []
    for h in (20, 50, 100):
        rs = [r for r in refs if r["hold"] == h]
        refrows.append(dict(hold=h, esn=agg(rs, "esn")))
    out = dict(params=dict(N=N, density=DENSITY, v0=V0, R=R, Ru=RU, w=W, kmax=KMAX, wash=WASH,
                           train_runs=NTRAIN_RUNS, test_runs=NTEST_RUNS, repeats=REPEATS,
                           steps_per_run=50000, alphas=ALPHAS),
               rows=rows, references=refrows, seconds=round(time.time() - t0))
    json.dump(out, open("results/data/exp14_reservoir.json", "w"), indent=1)
    for r in rows:
        f = r["flock"]
        print(r["hold"], r["eta"], "current %.2f MC %.2f+-%.2f prod %.2f | shuffled MC %.2f cur %.2f | consist %.2f head %.2f" % (
            f["current"], f["MC"], f["MC_se"], f["product"], r["shuffled"]["MC"], r["shuffled"]["current"],
            r["consistency"]["mean"], r["consistency_heading"]["mean"]))
    for r in refrows:
        print("hold", r["hold"], "ESN current %.2f MC %.2f prod %.2f" % (r["esn"]["current"], r["esn"]["MC"], r["esn"]["product"]))
    print("seconds", out["seconds"])

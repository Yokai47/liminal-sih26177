"""Small statistics helpers for order-parameter time series."""
import numpy as np


def summarize(phi, n, lag=10, blocks=10):
    """Mean order parameter, susceptibility, Binder cumulant and lag autocorrelation.

    chi = N * var(phi)                 (fluctuations; peaks near the transition)
    G   = 1 - <phi^4> / (3 <phi^2>^2)  (Binder cumulant; curves for different N cross near the transition)
    ac  = autocorrelation of phi fluctuations at `lag` steps (rises toward 1 near the transition:
          the flock takes longer to forget a disturbance, "critical slowing down")
    Errors are from splitting the series into `blocks` equal blocks.
    """
    phi = np.asarray(phi, dtype=float)
    d = phi - phi.mean()
    ac = float(np.dot(d[:-lag], d[lag:]) / np.dot(d, d)) if np.dot(d, d) > 0 else 0.0
    out = {
        "phi": float(phi.mean()),
        "chi": float(n * phi.var()),
        "binder": float(1 - np.mean(phi ** 4) / (3 * np.mean(phi ** 2) ** 2)),
        "ac": ac,
    }
    bl = np.array_split(phi, blocks)
    out["phi_err"] = float(np.std([b.mean() for b in bl]) / np.sqrt(blocks))
    out["chi_err"] = float(np.std([n * b.var() for b in bl]) / np.sqrt(blocks))
    return out


def merge_finite_size(e3, e3b=None):
    """Combine the Sim 3 rows (already averaged over their seeds) with the extra
    large-flock runs of Sim 3b. Returns rows in the Sim 3 format, with `seeds`
    counting all runs that went into each point. Block errors combine as
    independent runs: err_mean = sqrt(sum(err_run^2)) / runs. chi_err_runs is the
    standard error from the spread between runs (None if fewer than two are known)."""
    import numpy as _np
    acc = {}
    for r in e3["rows"]:
        k = (r["n"], r["eta"]); s = r["seeds"]
        acc[k] = dict(m=s, phi=r["phi"] * s, chi=r["chi"] * s, binder=r["binder"] * s, ac=r["ac"] * s,
                      pe2=(r["phi_err"] * s) ** 2, ce2=(r["chi_err"] * s) ** 2,
                      runs=[r["chi"]] if s == 1 else None)      # per-run values known only for single-run rows
    for r in (e3b or {}).get("runs", []):
        k = (r["n"], round(r["eta"], 3))
        a = acc.setdefault(k, dict(m=0, phi=0.0, chi=0.0, binder=0.0, ac=0.0, pe2=0.0, ce2=0.0, runs=[]))
        a["m"] += 1
        if a["runs"] is not None:
            a["runs"].append(r["chi"])
        for q in ("phi", "chi", "binder", "ac"):
            a[q] += r[q]
        a["pe2"] += r["phi_err"] ** 2; a["ce2"] += r["chi_err"] ** 2
    rows = []
    for (n, eta), a in sorted(acc.items()):
        m = a["m"]
        runs = a.get("runs")
        # spread between independent runs (standard error of the mean), where at least
        # two runs are known individually; within-run block errors understate the
        # uncertainty near the transition, where the order changes slowly
        between = float(_np.std(runs, ddof=1) / _np.sqrt(len(runs))) if runs and len(runs) >= 2 else None
        rows.append(dict(n=n, eta=eta, seeds=m, phi=a["phi"] / m, chi=a["chi"] / m, binder=a["binder"] / m, ac=a["ac"] / m,
                         phi_err=float(_np.sqrt(a["pe2"]) / m), chi_err=float(_np.sqrt(a["ce2"]) / m),
                         chi_err_runs=between))
    return {"meta": e3["meta"], "rows": rows}

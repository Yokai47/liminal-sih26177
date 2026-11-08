"""Criticality controller: keep the flock at its fluctuation (susceptibility) peak.

A finite flock has no true critical point, but it does have a noise level where
its fluctuations are largest (the susceptibility peak). Near that point the flock
reacts most strongly to a disturbance such as one drone turning. The controller
finds and holds that point without knowing where it is in advance.

Method: two-point extremum seeking.
  repeat:
    run W steps at eta_hat + delta, measure chi_plus  = N * var(phi)
    run W steps at eta_hat - delta, measure chi_minus
    gradient ~ (log chi_plus - log chi_minus) / (2 delta)
    eta_hat += gain * gradient            (step clipped to max_step)
Logs are used so the step size does not depend on how big chi is.
It only needs the order parameter, which the swarm layer computes anyway.
"""
import numpy as np
from .vicsek import run_periodic


def extremum_seek(x, y, th, L, n, eta0, iters=60, W=3000, discard=500, delta=0.15, gain=0.08,
                  max_step=0.15, R=1.0, v0=0.03, seed=0, eta_bounds=(0.3, 5.5)):
    eta = eta0
    hist = []
    s = seed
    for k in range(iters):
        chis = []
        for sign in (+1, -1):
            e = float(np.clip(eta + sign * delta, *eta_bounds))
            phi = run_periodic(x, y, th, L, R, v0, e, W, s); s += 1
            chis.append(n * phi[discard:].var())
        g = (np.log(chis[0] + 1e-9) - np.log(chis[1] + 1e-9)) / (2 * delta)
        step = float(np.clip(gain * g, -max_step, max_step))
        eta = float(np.clip(eta + step, *eta_bounds))
        hist.append(dict(iter=k, eta=eta, chi_plus=float(chis[0]), chi_minus=float(chis[1]),
                         steps=(k + 1) * 2 * W))
    return hist

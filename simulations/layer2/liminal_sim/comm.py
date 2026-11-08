"""Measuring the collective state over an imperfect network.

Architecture section 21 lists two open questions this module tests:
  * Does the estimator handle changing N? If some drones' reports are missing,
    does the order parameter misread the smaller count as a change in behaviour?
  * Time synchronisation: a collective state assembled from drones whose clocks
    disagree measures clock skew as much as alignment.

Finite-sample bias of the order parameter. If n of the N drones report, chosen
at random, and the whole flock's order is phi, then (sampling without
replacement from the N headings of that moment)
    E[phi_n^2] = phi^2 + f (1 - phi^2) / n,   f = (N - n) / (N - 1),
so the plain estimate phi_n is biased upward for small n (a disordered flock seen
through 8 random reports shows phi_n of about 0.3). The corrected estimate solves
that relation for phi^2 (clipped at 0). It removes the bias only when the missing
drones are missing at random; if the reports come from one part of the flock
(for example the drones within radio range), phi_n measures that part's local
order instead, and no formula fixes that.
"""
import numpy as np
from numba import njit

from .vicsek import _build_cells


def phi_of(th):
    return float(np.abs(np.mean(np.exp(1j * np.asarray(th)))))


def phi_corrected(th, n_total):
    """Order of the whole flock of n_total drones estimated from the reports `th`
    of n of them, assuming the missing ones are missing at random."""
    n = len(th)
    p2 = np.abs(np.mean(np.exp(1j * np.asarray(th)))) ** 2
    if n >= n_total:
        return float(np.sqrt(p2))
    f = (n_total - n) / (n_total - 1.0)
    return float(np.sqrt(max(0.0, (p2 - f / n) / (1.0 - f / n))))


@njit(cache=True)
def run_history(x, y, th, L, R, v0, eta, psi_seq, seed, w, Ru, ux0, uy0, rec):
    """Vicsek flock steered by one UGV (local mode, as in ugv.py) whose heading at
    step t is psi_seq[t]. Returns every drone's heading and position every `rec`
    steps, each of shape (steps // rec, n)."""
    np.random.seed(seed)
    n = x.shape[0]
    steps = psi_seq.shape[0]
    ncell = int(L / R)
    if ncell < 3:
        ncell = 3
    cs = L / ncell
    half = 0.5 * L
    R2 = R * R
    Ru2 = Ru * Ru
    ux = ux0
    uy = uy0
    newth = np.empty(n)
    hist = np.empty((steps // rec, n))
    hx = np.empty((steps // rec, n))
    hy = np.empty((steps // rec, n))
    k = 0
    for t in range(steps):
        cpsi = np.cos(psi_seq[t])
        spsi = np.sin(psi_seq[t])
        head, nxt = _build_cells(x, y, L, ncell)
        c = np.cos(th)
        s = np.sin(th)
        for i in range(n):
            cx = int(x[i] / cs) % ncell
            cy = int(y[i] / cs) % ncell
            sx = 0.0
            sy = 0.0
            for ddx in range(-1, 2):
                for ddy in range(-1, 2):
                    nc = ((cx + ddx) % ncell) * ncell + ((cy + ddy) % ncell)
                    j = head[nc]
                    while j >= 0:
                        dx = x[j] - x[i]
                        dy = y[j] - y[i]
                        if dx > half:
                            dx -= L
                        elif dx < -half:
                            dx += L
                        if dy > half:
                            dy -= L
                        elif dy < -half:
                            dy += L
                        if dx * dx + dy * dy <= R2:
                            sx += c[j]
                            sy += s[j]
                        j = nxt[j]
            dx = ux - x[i]
            dy = uy - y[i]
            if dx > half:
                dx -= L
            elif dx < -half:
                dx += L
            if dy > half:
                dy -= L
            elif dy < -half:
                dy += L
            if dx * dx + dy * dy <= Ru2:
                sx += w * cpsi
                sy += w * spsi
            if sx == 0.0 and sy == 0.0:
                m = th[i]
            else:
                m = np.arctan2(sy, sx)
            newth[i] = m + eta * (np.random.random() - 0.5)
        for i in range(n):
            th[i] = newth[i]
            x[i] = (x[i] + v0 * np.cos(th[i])) % L
            y[i] = (y[i] + v0 * np.sin(th[i])) % L
        ux = (ux + v0 * cpsi) % L
        uy = (uy + v0 * spsi) % L
        if (t + 1) % rec == 0 and k < hist.shape[0]:
            for i in range(n):
                hist[k, i] = th[i]
                hx[k, i] = x[i]
                hy[k, i] = y[i]
            k += 1
    return hist, hx, hy


def skewed_snapshots(hist, offsets):
    """Snapshot k assembled from drone i's report at sample k + offsets[i]
    (offsets in samples, fixed per drone: each drone's clock is off by a constant).
    Returns the snapshots that are valid for every drone, and their true indices."""
    n = hist.shape[1]
    lo = max(0, -int(offsets.min()))
    hi = hist.shape[0] - max(0, int(offsets.max()))
    idx = np.arange(lo, hi)
    snap = hist[idx[:, None] + offsets[None, :], np.arange(n)[None, :]]
    return snap, idx

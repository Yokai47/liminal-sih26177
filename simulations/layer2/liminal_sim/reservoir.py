"""The flock as a reservoir computer.

Architecture section 17 proposes using the swarm as a physical reservoir: a UGV
moving through the flock is the input, the flock's collective dynamics transform
it, and only a linear readout is trained. The document lists three open problems:
no task is defined, the echo-state property (the reservoir must forget old
inputs) may conflict with criticality, and the input may be lost in the noise.
It poses the research question: is the flock best at computing near its critical
point?

Model. Vicsek flock in a periodic box (vicsek.py). One UGV moves at speed v0 with
heading psi(t) = (pi/2) * u(t), where u is the input signal: a new value drawn
uniformly from [-1, 1] every `hold` steps. Drones within Ru of the UGV add w
copies of psi to their neighbour average (as in ugv.py, local mode).

Readout features, sampled at the end of each hold interval: the flock is divided
into a 4 x 4 grid of cells (a coarse camera view); for each cell the mean of
cos(theta), the mean of sin(theta) and the drone count, plus the flock order phi
and cos/sin of the flock mean heading: 51 numbers. Only drone states are used;
nothing is read from the UGV.
"""
import numpy as np
from numba import njit

from .vicsek import _build_cells

GRID = 4
NFEAT = 3 * GRID * GRID + 3


@njit(cache=True)
def run_reservoir(x, y, th, L, R, v0, eta, u, hold, seed, w, Ru, ux0, uy0):
    """Drive the flock with the input sequence u (one value per hold interval).
    Returns features, shape (len(u), NFEAT): the state at the end of each interval."""
    np.random.seed(seed)
    n = x.shape[0]
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
    nin = u.shape[0]
    feats = np.zeros((nin, 3 * GRID * GRID + 3))
    for k in range(nin):
        psi = 0.5 * np.pi * u[k]
        cpsi = np.cos(psi)
        spsi = np.sin(psi)
        for t in range(hold):
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
        # features at the end of the interval
        gc = L / GRID
        for i in range(n):
            gx = int(x[i] / gc) % GRID
            gy = int(y[i] / gc) % GRID
            b = 3 * (gx * GRID + gy)
            feats[k, b] += np.cos(th[i])
            feats[k, b + 1] += np.sin(th[i])
            feats[k, b + 2] += 1.0
        for cidx in range(GRID * GRID):
            b = 3 * cidx
            cnt = feats[k, b + 2]
            if cnt > 0:
                feats[k, b] /= cnt
                feats[k, b + 1] /= cnt
            feats[k, b + 2] = cnt / n * GRID * GRID   # density relative to the mean
        sx = 0.0
        sy = 0.0
        for i in range(n):
            sx += np.cos(th[i])
            sy += np.sin(th[i])
        p = np.sqrt(sx * sx + sy * sy) / n
        b = 3 * GRID * GRID
        feats[k, b] = p
        if p > 0:
            feats[k, b + 1] = sx / (n * p)
            feats[k, b + 2] = sy / (n * p)
    return feats


def ridge_fit(X, y, alpha):
    """Linear readout with intercept, ridge penalty alpha on standardised features."""
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd[sd == 0] = 1.0
    Z = (X - mu) / sd
    A = Z.T @ Z + alpha * np.eye(Z.shape[1])
    wts = np.linalg.solve(A, Z.T @ (y - y.mean()))
    return mu, sd, wts, y.mean()


def ridge_predict(model, X):
    mu, sd, wts, b = model
    return ((X - mu) / sd) @ wts + b


def r2(y, yhat):
    """Coefficient of determination on test data (can be negative; clipped by callers)."""
    return 1.0 - np.mean((y - yhat) ** 2) / np.var(y)


def lagged(feat, u, k):
    """Pairs (state at step t, input k steps earlier): rows t = k .. end."""
    return feat[k:], u[: len(u) - k]

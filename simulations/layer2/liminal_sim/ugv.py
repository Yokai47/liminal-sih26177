"""A distinguishable ground robot (UGV) steering a Vicsek flock without commands.

Architecture claim being tested (Layer 2 document, section 7): drones that all
follow the same rule form a symmetric system with no preferred direction; a UGV
that is visibly different breaks that symmetry, and the flock organises relative
to it. The UGV sends no messages. It changes the flock only by being seen.

Model. The standard Vicsek flock (see vicsek.py: speed v0, radius R, uniform
noise of width eta, periodic L x L box). One UGV moves at the flock's speed v0 on
a heading psi(t) that it chooses itself; it turns by +/-90 degrees every
`turn_every` steps (sign random). The UGV ignores the drones (one-way influence).

Three ways the drones can use the UGV's heading:
  mode 0  none       no UGV (baseline: where does an unsteered flock go?)
  mode 1  local      a drone that SEES the UGV (distance <= Ru) adds w copies of
                     the UGV's heading to its neighbour average. Drones farther
                     away learn of the turn only through their neighbours.
  mode 2  broadcast  every drone adds w copies of psi, wherever it is. This is a
                     radio command to all drones: an upper bound that the
                     no-command design gives up.
w = 1 means the UGV counts as one more neighbour; larger w means the drones'
rule gives the UGV more weight than a fellow drone (like an "informed
individual" in Couzin et al., Nature 433, 513 (2005)).

Measured every `rec` steps:
  phi    flock order |mean_j exp(i theta_j)|
  theta  flock mean heading arg(mean_j exp(i theta_j))
  g      mean_j cos(theta_j - psi): the share of the flock's motion that goes the
         UGV's way (1 = every drone moves exactly along the UGV's heading,
         0 = no net motion along it, negative = against it)
"""
import numpy as np
from numba import njit

from .vicsek import _build_cells


@njit(cache=True)
def run_ugv(x, y, th, L, R, v0, eta, steps, seed, mode, w, Ru,
            turn_every, rec, ux0, uy0):
    """ux0, uy0: arrays with the starting positions of the UGVs (all UGVs share
    the heading psi; a drone that sees at least one UGV adds w copies of psi)."""
    np.random.seed(seed)
    n = x.shape[0]
    ncell = int(L / R)
    if ncell < 3:
        ncell = 3
    cs = L / ncell
    half = 0.5 * L
    R2 = R * R
    Ru2 = Ru * Ru
    nrec = steps // rec
    out_phi = np.empty(nrec)
    out_theta = np.empty(nrec)
    out_g = np.empty(nrec)
    out_psi = np.empty(nrec)
    out_seen = np.empty(nrec)
    psi = 0.0
    ux = ux0.copy()
    uy = uy0.copy()
    nu = ux.shape[0]
    newth = np.empty(n)
    k = 0
    for t in range(steps):
        if t > 0 and t % turn_every == 0:
            if np.random.random() < 0.5:
                psi += 0.5 * np.pi
            else:
                psi -= 0.5 * np.pi
        cpsi = np.cos(psi)
        spsi = np.sin(psi)
        head, nxt = _build_cells(x, y, L, ncell)
        c = np.cos(th)
        s = np.sin(th)
        seen = 0
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
            if mode == 2:
                sx += w * cpsi
                sy += w * spsi
            elif mode == 1:
                for q in range(nu):
                    dx = ux[q] - x[i]
                    dy = uy[q] - y[i]
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
                        seen += 1
                        break
            if sx == 0.0 and sy == 0.0:
                m = th[i]
            else:
                m = np.arctan2(sy, sx)
            newth[i] = m + eta * (np.random.random() - 0.5)
        for i in range(n):
            th[i] = newth[i]
            x[i] = (x[i] + v0 * np.cos(th[i])) % L
            y[i] = (y[i] + v0 * np.sin(th[i])) % L
        for q in range(nu):
            ux[q] = (ux[q] + v0 * cpsi) % L
            uy[q] = (uy[q] + v0 * spsi) % L
        if (t + 1) % rec == 0 and k < nrec:
            sx = 0.0
            sy = 0.0
            g = 0.0
            for i in range(n):
                sx += np.cos(th[i])
                sy += np.sin(th[i])
                g += np.cos(th[i] - psi)
            out_phi[k] = np.sqrt(sx * sx + sy * sy) / n
            out_theta[k] = np.arctan2(sy, sx)
            out_g[k] = g / n
            out_psi[k] = psi
            out_seen[k] = seen
            k += 1
    return out_phi, out_theta, out_g, out_psi, out_seen


def ugv_start(L, m):
    """Starting positions for m UGVs (m a square number): centres of an even grid."""
    k = int(round(np.sqrt(m)))
    c = (np.arange(k) + 0.5) * L / k
    gx, gy = np.meshgrid(c, c)
    return gx.ravel().astype(np.float64), gy.ravel().astype(np.float64)


def angdiff(a, b):
    """Signed difference a - b wrapped to (-pi, pi]."""
    return (np.asarray(a) - np.asarray(b) + np.pi) % (2 * np.pi) - np.pi


def response_times(theta, psi, rec, turn_every, tol_deg=30.0):
    """For each UGV turn after the first segment: steps until the flock heading
    first comes within tol_deg of the new UGV heading. NaN if it never does
    before the next turn."""
    per = turn_every // rec
    nseg = len(theta) // per
    tol = np.radians(tol_deg)
    out = []
    for s in range(1, nseg):
        a = slice(s * per, (s + 1) * per)
        d = np.abs(angdiff(theta[a], psi[a]))
        hit = np.nonzero(d <= tol)[0]
        out.append((hit[0] + 1) * rec if len(hit) else np.nan)
    return np.array(out, dtype=float)

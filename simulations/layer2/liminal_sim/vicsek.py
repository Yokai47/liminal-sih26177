"""Reference (floating-point) 2D Vicsek model.

The Vicsek model (Vicsek et al., Phys. Rev. Lett. 75, 1226, 1995):
every agent moves at constant speed v0. At each step it takes the average
heading of all agents within radius R (itself included), adds a random
angle drawn uniformly from [-eta/2, +eta/2], and moves one step that way.

  theta_i(t+1) = arg( sum_{|x_j - x_i| < R} exp(i theta_j(t)) ) + noise
  x_i(t+1)     = x_i(t) + v0 * (cos theta_i(t+1), sin theta_i(t+1))

Order parameter (how aligned the flock is, 0 = random, 1 = perfect):
  phi(t) = | (1/N) sum_i exp(i theta_i(t)) |

Units: lengths in units of the interaction radius R (R = 1), time in steps.
Neighbour search uses a cell list (grid of R x R cells), so each step costs
about N * (agents in 9 nearby cells) distance checks instead of N^2.
"""
import numpy as np
from numba import njit


@njit(cache=True)
def _build_cells(x, y, L, ncell):
    n = x.shape[0]
    head = -np.ones(ncell * ncell, dtype=np.int64)
    nxt = -np.ones(n, dtype=np.int64)
    cs = L / ncell
    for i in range(n):
        cx = int(x[i] / cs) % ncell
        cy = int(y[i] / cs) % ncell
        c = cx * ncell + cy
        nxt[i] = head[c]
        head[c] = i
    return head, nxt


@njit(cache=True)
def _mean_headings_periodic(x, y, th, L, R, ncell, head, nxt, out):
    n = x.shape[0]
    cs = L / ncell
    R2 = R * R
    c = np.cos(th)
    s = np.sin(th)
    half = 0.5 * L
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
        if sx == 0.0 and sy == 0.0:
            out[i] = th[i]
        else:
            out[i] = np.arctan2(sy, sx)


@njit(cache=True)
def run_periodic(x, y, th, L, R, v0, eta, steps, seed, record_every=1):
    """Run the Vicsek model in a periodic L x L box (modifies x, y, th in place).

    Returns phi(t) sampled every `record_every` steps.
    ncell is chosen so that cells are at least R wide (needed for correctness
    with only 9 neighbouring cells), and at least 3 per side.
    """
    np.random.seed(seed)
    n = x.shape[0]
    ncell = int(L / R)
    if ncell < 3:
        ncell = 3  # still correct: cells wider than R, every pair is checked
    nrec = steps // record_every
    phi = np.empty(nrec)
    mean = np.empty(n)
    k = 0
    for t in range(steps):
        head, nxt = _build_cells(x, y, L, ncell)
        _mean_headings_periodic(x, y, th, L, R, ncell, head, nxt, mean)
        for i in range(n):
            th[i] = mean[i] + eta * (np.random.random() - 0.5)
            x[i] = (x[i] + v0 * np.cos(th[i])) % L
            y[i] = (y[i] + v0 * np.sin(th[i])) % L
        if (t + 1) % record_every == 0 and k < nrec:
            sx = 0.0
            sy = 0.0
            for i in range(n):
                sx += np.cos(th[i])
                sy += np.sin(th[i])
            phi[k] = np.sqrt(sx * sx + sy * sy) / n
            k += 1
    return phi


def init_random(n, L, seed):
    rng = np.random.default_rng(seed)
    x = rng.uniform(0, L, n)
    y = rng.uniform(0, L, n)
    th = rng.uniform(-np.pi, np.pi, n)
    return x, y, th


def order_parameter(th):
    return float(np.abs(np.mean(np.exp(1j * th))))


def box_size(n, density):
    """Side of the square box that holds n agents at the given density (agents per R^2)."""
    return float(np.sqrt(n / density))

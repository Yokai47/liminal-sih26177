"""Turing patterns for spreading a swarm over an area.

A Turing (activator-inhibitor) system, here Gierer-Meinhardt, makes a field of
evenly spaced spots from nothing but local rules: the activator boosts itself and
the inhibitor, the inhibitor spreads faster and suppresses the activator. The spot
spacing grows with the square root of the diffusion rate, so one number sets how
far apart the drones should be.
For search, already-searched ground stops producing activator, so spots fade where
the swarm has been and survive only on unsearched ground; each drone flies to a spot.
Everything is a local stencil on a grid (each cell needs only its neighbours), the
kind of computation an FPGA does well.

Compared with: correlated random walk; greedy (each drone heads for the nearest
unsearched cell); Lloyd/Voronoi coverage on unsearched area (each drone heads for the
centre of the unsearched part of its Voronoi cell; Cortes et al. 2004); and
lawnmower strips (one strip per drone, assigned by distance, swept from the nearer
end; a drone that finishes takes the nearest unswept strip, including those of
failed drones). "turing" is the Turing field plus a mop-up rule (a drone whose spot
is on searched ground, or that has no spot, uses the greedy rule); "turing_only" is
the field alone.
"""
import math
import numpy as np
from scipy import fft, ndimage
from scipy.optimize import linear_sum_assignment


class GMField:
    """Gierer-Meinhardt on an n x n grid with no-flux edges (cosine transform),
    semi-implicit time stepping (diffusion exact in transform space)."""

    def __init__(self, n=128, Da=1.0, ratio=40.0, rho=1.0, mu_a=1.0, mu_h=2.0, seed=0):
        r = np.random.default_rng(seed)
        self.n, self.Da, self.Dh, self.rho, self.mu_a, self.mu_h = n, Da, Da * ratio, rho, mu_a, mu_h
        k = np.pi * np.arange(n) / n
        self.K2 = (2 - 2 * np.cos(k))[:, None] + (2 - 2 * np.cos(k))[None, :]   # discrete Laplacian eigenvalues
        a0 = mu_h / mu_a
        self.a = a0 * (1 + 0.05 * r.standard_normal((n, n)))
        self.h = np.full((n, n), rho * a0 * a0 / mu_h)

    def step(self, dt=0.05, block=None):
        """block: 0..1 per cell; 1 = this ground cannot produce activator (already searched)."""
        a, h = self.a, self.h
        prod = self.rho * a * a
        if block is not None:
            prod = prod * (1 - block)
        Ra = prod / h - self.mu_a * a
        Rh = prod - self.mu_h * h
        A = fft.dctn(a + dt * Ra, norm="ortho") / (1 + dt * self.Da * self.K2)
        H = fft.dctn(h + dt * Rh, norm="ortho") / (1 + dt * self.Dh * self.K2)
        self.a = np.clip(fft.idctn(A, norm="ortho"), 1e-6, 1e4)
        self.h = np.clip(fft.idctn(H, norm="ortho"), 1e-3, 1e5)

    def spots(self, frac=0.5):
        a = self.a
        m = (a == ndimage.maximum_filter(a, size=3, mode="nearest")) & (a > frac * a.max())
        return np.argwhere(m).astype(float)


def spot_spacing(Da, n=128, steps=3000, seed=0):
    f = GMField(n, Da=Da, seed=seed)
    for _ in range(steps):
        f.step()
    p = f.spots()
    return len(p), (n / np.sqrt(len(p)) if len(p) else np.nan), f.a


def coverage_run(policy, n_drones=8, L=32.0, cell=0.25, rs=2.0, speed=1.0, t_max=300.0, dt=0.5,
                 fail_at=None, n_fail=0, Da=None, block=0.95, seed=0):
    """Fraction of the area searched (within rs of any drone's path) over time."""
    r = np.random.default_rng(seed)
    n = int(L / cell)
    yy, xx = np.mgrid[0:n, 0:n] * cell + cell / 2
    searched = np.zeros((n, n), bool)
    pos = np.c_[r.uniform(0, 3, n_drones), r.uniform(0, L, n_drones)]          # launched from one edge
    alive = np.ones(n_drones, bool)
    heading = r.uniform(0, 2 * np.pi, n_drones)
    if policy == "lawnmower":
        w = L / n_drones
        sx = np.array([i * w + w / 2 for i in range(n_drones)])          # one strip per drone, swept along y
        s_done = np.zeros(n_drones, bool); s_owner = -np.ones(n_drones, int)
        d_strip = -np.ones(n_drones, int); d_goal = np.zeros(n_drones); d_phase = np.zeros(n_drones, int)
        ends = (0.0, L)                                                  # sweep the full length

        def take(i, cand):
            # nearest end of the nearest strip in cand; phase 0 = fly to that end, 1 = sweep to the other
            best = min(((math.hypot(pos[i, 0] - sx[k], pos[i, 1] - e), k, e) for k in cand for e in ends))
            _, k, e = best
            s_owner[k] = i; d_strip[i] = k; d_phase[i] = 0; d_goal[i] = e

        C0 = np.array([[min(math.hypot(pos[i, 0] - sx[k], pos[i, 1] - e) for e in ends) for k in range(n_drones)]
                       for i in range(n_drones)])
        for i, k in zip(*linear_sum_assignment(C0)):
            take(i, [k])
    if policy in ("turing", "turing_only"):
        if Da is None:
            Da = (L / cell / np.sqrt(n_drones) / 12.2) ** 2               # spacing ~ 12.2 cells at Da = 1
        field = GMField(n, Da=Da, seed=seed)
        for _ in range(1500):                                             # let the first pattern form
            field.step()
    hist_t, hist_c = [], []
    t = 0.0
    while t <= t_max:
        for i in np.nonzero(alive)[0]:
            searched |= (yy - pos[i, 1]) ** 2 + (xx - pos[i, 0]) ** 2 <= rs * rs
        hist_t.append(t); hist_c.append(float(searched.mean()))
        if fail_at is not None and t >= fail_at and alive.sum() == n_drones:
            alive[r.choice(n_drones, n_fail, replace=False)] = False
        idx = np.nonzero(alive)[0]
        targets = pos.copy()
        if policy == "random":
            heading += r.normal(0, 0.5, n_drones)
            targets = pos + np.c_[np.cos(heading), np.sin(heading)] * 5
        elif policy == "lloyd":
            P = pos[idx]
            d2 = (xx[..., None] - P[:, 0]) ** 2 + (yy[..., None] - P[:, 1]) ** 2
            owner = np.argmin(d2, axis=2)
            wgt = ~searched
            for j, i in enumerate(idx):
                m = (owner == j) & wgt
                if not wgt.any():
                    continue
                if m.any():
                    cx, cy = xx[m].mean(), yy[m].mean()
                    # the centre of a ring-shaped unsearched area can itself be searched:
                    # then head for the unsearched cell of this region nearest that centre
                    gi = min(int(cy / cell), n - 1), min(int(cx / cell), n - 1)
                    if searched[gi]:
                        dc = np.where(m, (xx - cx) ** 2 + (yy - cy) ** 2, np.inf)
                        k = np.argmin(dc); cx, cy = xx.ravel()[k], yy.ravel()[k]
                    targets[i] = [cx, cy]
                else:                                            # own region done: nearest unsearched cell
                    k = np.argmin(np.where(wgt, d2[..., j], np.inf))
                    targets[i] = [xx.ravel()[k], yy.ravel()[k]]
        elif policy == "greedy":
            unsearched = ~searched
            if unsearched.any():
                for i in idx:
                    k = np.argmin(np.where(unsearched, (xx - pos[i, 0]) ** 2 + (yy - pos[i, 1]) ** 2, np.inf))
                    targets[i] = [xx.ravel()[k], yy.ravel()[k]]
        elif policy in ("turing", "turing_only"):
            for _ in range(10):
                field.step(dt=0.05, block=block * searched)
            S = field.spots()
            if len(S):
                S = S[:, ::-1] * cell + cell / 2                  # (row, col) -> (x, y) metres
                C = np.linalg.norm(pos[idx][:, None, :] - S[None, :, :], axis=2)
                ri, ci = linear_sum_assignment(C)
                for a_, b_ in zip(ri, ci):
                    targets[idx[a_]] = S[b_]
                rest = set(range(len(idx))) - set(ri)
                for a_ in rest:                                   # more drones than spots: nearest spot
                    targets[idx[a_]] = S[np.argmin(C[a_])]
            # mop-up (turing only): a drone whose spot sits on searched ground (or that has
            # no spot) heads for the nearest unsearched cell, as in the greedy rule
            unsearched = ~searched
            if policy == "turing" and unsearched.any():
                for i in idx:
                    gy, gx = min(int(targets[i, 1] / cell), n - 1), min(int(targets[i, 0] / cell), n - 1)
                    if searched[gy, gx] or not len(S):
                        k = np.argmin(np.where(unsearched, (xx - pos[i, 0]) ** 2 + (yy - pos[i, 1]) ** 2, np.inf))
                        targets[i] = [xx.ravel()[k], yy.ravel()[k]]
        elif policy == "lawnmower":
            for i in np.nonzero(~alive)[0]:                         # a failed drone's strip is released
                if d_strip[i] >= 0 and not s_done[d_strip[i]]:
                    s_owner[d_strip[i]] = -1
                d_strip[i] = -1
            for i in idx:
                k = d_strip[i]
                if k >= 0 and abs(pos[i, 0] - sx[k]) < 0.01 and abs(pos[i, 1] - d_goal[i]) < 0.01:   # the last move lands exactly on the target
                    if d_phase[i] == 0:
                        d_phase[i] = 1; d_goal[i] = L - d_goal[i]       # at one end: sweep to the other
                    else:
                        s_done[k] = True; d_strip[i] = -1
                if d_strip[i] < 0:
                    free = [q for q in range(n_drones) if not s_done[q] and s_owner[q] < 0]
                    if free:
                        take(i, free)
                k = d_strip[i]
                targets[i] = [sx[k], d_goal[i]] if k >= 0 else pos[i]
        dvec = targets - pos
        dist = np.linalg.norm(dvec, axis=1, keepdims=True)
        stepv = np.where(dist > speed * dt, dvec / np.maximum(dist, 1e-9) * speed * dt, dvec)
        stepv[~alive] = 0
        pos = np.clip(pos + stepv, 0, L)
        if policy == "random":
            hit = (pos <= 0) | (pos >= L)
            heading[hit.any(1)] += np.pi
        t += dt
    hist_c = np.array(hist_c)
    t90 = float(hist_t[np.argmax(hist_c >= 0.9)]) if (hist_c >= 0.9).any() else float("nan")
    return dict(policy=policy, t=hist_t, cov=hist_c.tolist(), t90=t90, final=float(hist_c[-1]))

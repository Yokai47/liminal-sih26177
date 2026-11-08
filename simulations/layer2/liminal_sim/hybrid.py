"""Hybrid flock: a few real drones flying as members of a large virtual flock.

The virtual agents live only in the computer (later: the FPGA). The real
drones are measured by the cameras, and are sent a velocity command each tick.
Both kinds follow the same Vicsek rule, inside the same walled arena, and
each kind sees the other as neighbours.

Two ways to tie a real drone into the flock (an important design choice):
  "embodied" - the drone's MEASURED position is its position in the flock.
               If the drone lags, the flock feels it. True hardware-in-the-loop.
  "puppet"   - the computer keeps an ideal twin agent and the drone just chases
               the twin. The flock never feels the real drone. (Reference only.)

Real-drone model (ASSUMED values until measured on the mocap rig):
  velocity follows the command with a first-order lag (time constant tau),
  acceleration limited to a_max, random velocity disturbance (air from other
  drones, turbulence), camera position noise, loop latency, and dropped
  command packets (the drone keeps its last command when a packet is lost).

Units: metres, seconds. The Vicsek tick is the control loop tick (1/rate).
"""
import math
import numpy as np
from numba import njit


@njit(cache=True)
def _mean_headings_box(x, y, th, L, R, ncell, out, count, b, w, kappa, rep_r, rep_gain, rep_from):
    n = x.shape[0]
    cs = L / ncell
    head = -np.ones(ncell * ncell, dtype=np.int64)
    nxt = -np.ones(n, dtype=np.int64)
    for i in range(n):
        cx = min(int(x[i] / cs), ncell - 1)
        cy = min(int(y[i] / cs), ncell - 1)
        c = cx * ncell + cy
        nxt[i] = head[c]
        head[c] = i
    c_ = np.cos(th)
    s_ = np.sin(th)
    R2 = R * R
    rr2 = rep_r * rep_r
    for i in range(n):
        cx = min(int(x[i] / cs), ncell - 1)
        cy = min(int(y[i] / cs), ncell - 1)
        sx = 0.0
        sy = 0.0
        px = 0.0
        py = 0.0
        k = 0
        for ax in range(max(cx - 1, 0), min(cx + 2, ncell)):
            for ay in range(max(cy - 1, 0), min(cy + 2, ncell)):
                j = head[ax * ncell + ay]
                while j >= 0:
                    dx = x[j] - x[i]
                    dy = y[j] - y[i]
                    d2 = dx * dx + dy * dy
                    if d2 <= R2:
                        sx += c_[j]
                        sy += s_[j]
                        k += 1
                    if rep_r > 0.0 and d2 < rr2 and j != i and d2 > 0.0 and (i < rep_from or j >= rep_from):
                        # (agents i >= rep_from, the real drones, ignore pushes from agents j < rep_from)
                        # short-range repulsion: a push straight away from j, growing
                        # linearly from 0 at rep_r to rep_gain "neighbours' worth" at contact
                        d = math.sqrt(d2)
                        f = rep_gain * (1.0 - d / rep_r) / d
                        px -= f * dx
                        py -= f * dy
                    j = nxt[j]
        count[i] = k - 1
        sx += px
        sy += py
        # soft walls: inside the band of width w next to the flock boundary
        # (which sits b metres inside the net), add a push toward the middle,
        # weighted like kappa extra neighbours per unit depth into the band.
        if w > 0.0:
            g = kappa * k
            if x[i] < b + w:
                sx += g * (b + w - x[i]) / w
            elif x[i] > L - b - w:
                sx -= g * (x[i] - (L - b - w)) / w
            if y[i] < b + w:
                sy += g * (b + w - y[i]) / w
            elif y[i] > L - b - w:
                sy -= g * (y[i] - (L - b - w)) / w
        if sx == 0.0 and sy == 0.0:
            out[i] = th[i]
        else:
            out[i] = math.atan2(sy, sx)


@njit(cache=True)
def _mean_headings_knn(x, y, th, L, R, ncell, out, k_nn, b, w, kappa):
    """Topological rule: average the headings of the k nearest agents (plus itself),
    whatever their distance. Used by starlings (Ballerini et al., PNAS 2008, ~7 neighbours).
    Unlike the radius rule, the result does not depend on how densely the agents are packed."""
    n = x.shape[0]
    cs = L / ncell
    head = -np.ones(ncell * ncell, dtype=np.int64)
    nxt = -np.ones(n, dtype=np.int64)
    for i in range(n):
        cx = min(int(x[i] / cs), ncell - 1)
        cy = min(int(y[i] / cs), ncell - 1)
        c = cx * ncell + cy
        nxt[i] = head[c]
        head[c] = i
    c_ = np.cos(th)
    s_ = np.sin(th)
    bd = np.empty(k_nn)
    bj = np.empty(k_nn, dtype=np.int64)
    for i in range(n):
        cx = min(int(x[i] / cs), ncell - 1)
        cy = min(int(y[i] / cs), ncell - 1)
        found = 0
        ring = 1
        while True:
            for q in range(k_nn):
                bd[q] = 1e30
                bj[q] = -1
            found = 0
            for ax in range(max(cx - ring, 0), min(cx + ring + 1, ncell)):
                for ay in range(max(cy - ring, 0), min(cy + ring + 1, ncell)):
                    j = head[ax * ncell + ay]
                    while j >= 0:
                        if j != i:
                            dx = x[j] - x[i]
                            dy = y[j] - y[i]
                            d = dx * dx + dy * dy
                            found += 1
                            if d < bd[k_nn - 1]:
                                q = k_nn - 1
                                while q > 0 and bd[q - 1] > d:
                                    bd[q] = bd[q - 1]
                                    bj[q] = bj[q - 1]
                                    q -= 1
                                bd[q] = d
                                bj[q] = j
                        j = nxt[j]
            if found >= k_nn or ring >= ncell:
                break
            ring += 1
        sx = c_[i]
        sy = s_[i]
        for q in range(k_nn):
            if bj[q] >= 0:
                sx += c_[bj[q]]
                sy += s_[bj[q]]
        if w > 0.0:
            g = kappa * (k_nn + 1)
            if x[i] < b + w:
                sx += g * (b + w - x[i]) / w
            elif x[i] > L - b - w:
                sx -= g * (x[i] - (L - b - w)) / w
            if y[i] < b + w:
                sy += g * (b + w - y[i]) / w
            elif y[i] > L - b - w:
                sy -= g * (y[i] - (L - b - w)) / w
        out[i] = math.atan2(sy, sx)


@njit(cache=True)
def _local_order(x, y, th, L, R, ncell):
    """For every agent: how well its neighbourhood (itself plus every agent within R)
    is aligned, |mean of their heading unit vectors|, from 0 (random) to 1 (parallel).
    Averaged over agents. Unlike the whole-flock order, a flock circling inside the
    walls still scores high here, because neighbours stay aligned with each other."""
    n = x.shape[0]
    cs = L / ncell
    head = -np.ones(ncell * ncell, dtype=np.int64)
    nxt = -np.ones(n, dtype=np.int64)
    for i in range(n):
        cx = min(int(x[i] / cs), ncell - 1)
        cy = min(int(y[i] / cs), ncell - 1)
        c = cx * ncell + cy
        nxt[i] = head[c]
        head[c] = i
    c_ = np.cos(th)
    s_ = np.sin(th)
    R2 = R * R
    tot = 0.0
    for i in range(n):
        cx = min(int(x[i] / cs), ncell - 1)
        cy = min(int(y[i] / cs), ncell - 1)
        sx = 0.0
        sy = 0.0
        k = 0
        for ax in range(max(cx - 1, 0), min(cx + 2, ncell)):
            for ay in range(max(cy - 1, 0), min(cy + 2, ncell)):
                j = head[ax * ncell + ay]
                while j >= 0:
                    dx = x[j] - x[i]
                    dy = y[j] - y[i]
                    if dx * dx + dy * dy <= R2:
                        sx += c_[j]
                        sy += s_[j]
                        k += 1
                    j = nxt[j]
        tot += math.sqrt(sx * sx + sy * sy) / k
    return tot / n


@njit(cache=True)
def _nn_dist(x, y):
    # nearest-neighbour distance of every agent (all pairs; fine for ~128 agents)
    n = x.shape[0]
    out = np.empty(n)
    for i in range(n):
        m = 1e30
        for j in range(n):
            if j != i:
                d = (x[j] - x[i]) ** 2 + (y[j] - y[i]) ** 2
                if d < m:
                    m = d
        out[i] = math.sqrt(m)
    return out


@njit(cache=True)
def _reflect(x, y, th, lo, hi):
    # hard backstop: mirror any agent that crosses the flock boundary
    for i in range(x.shape[0]):
        if x[i] < lo:
            x[i] = 2 * lo - x[i]
            th[i] = math.pi - th[i]
        elif x[i] > hi:
            x[i] = 2 * hi - x[i]
            th[i] = math.pi - th[i]
        if y[i] < lo:
            y[i] = 2 * lo - y[i]
            th[i] = -th[i]
        elif y[i] > hi:
            y[i] = 2 * hi - y[i]
            th[i] = -th[i]


def wrap(a):
    return (a + np.pi) % (2 * np.pi) - np.pi


class Hybrid:
    def __init__(self, n_virtual=1024, n_real=8, arena=4.0, R=0.5, speed=0.4, rate=50.0, eta=1.0,
                 tau=0.3, a_max=3.0, vel_noise=0.05, pos_noise=0.003, latency=0.04, loss=0.0,
                 mode="embodied", heading_source="command", walls="soft", margin=0.3, wall_band=0.6,
                 wall_gain=1.5, k_nn=0, separation=0.0, sep_gain=1.5, repulsion=0.0, rep_gain=3.0,
                 rep_drones_ignore_virtual=False, engine="float", seed=0):
        self.nv, self.nr, self.L, self.R = n_virtual, n_real, arena, R
        self.v0, self.dt, self.eta = speed, 1.0 / rate, eta
        self.tau, self.a_max, self.vel_noise, self.pos_noise = tau, a_max, vel_noise, pos_noise
        self.loss, self.mode, self.heading_source = loss, mode, heading_source
        self.b = margin                                  # flock boundary sits this far inside the net
        self.w = wall_band if walls == "soft" else 0.0   # 0 = hard reflection only
        self.kappa = wall_gain
        self.k_nn = k_nn                                 # 0 = radius rule, k > 0 = k nearest neighbours
        self.sep, self.sep_gain = separation, sep_gain   # real drones push apart closer than this (m); 0 = off
        self.rep_r, self.rep_gain = repulsion, rep_gain   # every agent turns away from any agent closer than this (m); 0 = off
        # True: drones are not pushed by virtual agents (they cannot collide with them),
        # but virtual agents still keep clear of drones and of each other
        self.rep_from = n_virtual if rep_drones_ignore_virtual else n_virtual + n_real
        if repulsion > 0 and k_nn > 0:
            raise ValueError("repulsion is only implemented for the radius rule (k_nn=0)")
        self.min_dist = np.inf                           # closest any two real drones came (m)
        self.sep_ticks = 0                               # ticks in which the safety layer pushed any drone
        self.rng = np.random.default_rng(seed)
        n = n_virtual + n_real
        self.n = n
        r = self.rng
        # agent state (virtual agents + twins of the real drones)
        self.x = r.uniform(margin, arena - margin, n)
        self.y = r.uniform(margin, arena - margin, n)
        self.th = r.uniform(-np.pi, np.pi, n)
        # real drones take off from a grid (at least ~0.8 m apart), hovering
        cols = int(math.ceil(math.sqrt(n_real * 2)))
        rows = int(math.ceil(n_real / cols))
        gx = np.linspace(margin + 0.5, arena - margin - 0.5, cols)
        gy = np.linspace(margin + 0.5, arena - margin - 0.5, max(rows, 1) + 2)[1:-1] if rows > 0 else []
        grid = np.array([(a, b) for b in gy for a in gx])[:n_real]
        self.x[n_virtual:] = grid[:, 0]
        self.y[n_virtual:] = grid[:, 1]
        self.p = grid.astype(float).copy()
        self.v = np.zeros((n_real, 2))
        self.cmd = np.zeros((n_real, 2))          # last command received by each drone
        d = max(int(round(latency / self.dt / 2)), 0)
        self.d_meas, self.d_cmd = d, max(int(round(latency / self.dt)) - d, 0)
        # each buffer holds d entries: append the new one, pop the oldest, so a value
        # comes out exactly d ticks after it went in (d = 0: no delay)
        self.meas_buf = [self.p.copy() for _ in range(self.d_meas)]
        self.cmd_buf = [np.zeros((n_real, 2)) for _ in range(self.d_cmd)]
        self.stall_samples, self.drone_samples = 0, 0
        self.prev_meas = self.p.copy()
        self.ncell = max(int(arena / R), 1)
        # engine: "float" = this file's Numba kernels; "fixed" = the FPGA's integer model
        # (liminal_sim.fixedpoint.step_walls), bit-exact with fpga/rtl/vicsek_engine.v (WALLS=1)
        self.engine = engine
        if engine == "fixed":
            from liminal_sim import fixedpoint as fp
            if walls != "soft" or k_nn > 0 or repulsion > 0 or heading_source != "command":
                raise ValueError("fixed engine supports soft walls, radius rule, no repulsion, command headings")
            self._fp = fp
            self.wp = fp.WallParams(L=arena, R=R, speed=speed, rate=rate, eta=eta, margin=margin,
                                    band=wall_band, gain=wall_gain)
            self.xq = fp.quantize_pos(self.x, arena); self.yq = fp.quantize_pos(self.y, arena)
            self.hq = (np.round(self.th / (2 * np.pi) * 65536).astype(np.int64)) & 0xFFFF
            self.sq = r.integers(1, 2 ** 32, n).astype(np.int64)
            self.hmq = np.zeros(n, dtype=np.int64)
        self.mean = np.zeros(n)
        self.count = np.zeros(n, dtype=np.int64)
        self.t = 0
        self.overshoot = 0.0      # furthest a real drone got beyond the flock boundary (m)
        self.left_net = 0         # ticks in which any real drone was outside the net
        self.hist_real = []       # true drone positions, for displacement-based alignment
        self.hist_virt = []       # positions of a sample of virtual agents

    def tick(self):
        nv, nr, L = self.nv, self.nr, self.L
        r = self.rng
        # 1. camera measurement of the real drones (delayed, noisy)
        self.meas_buf.append(self.p + r.normal(0, self.pos_noise, self.p.shape))
        meas = self.meas_buf.pop(0)
        # 2. embodied: real agents sit where the cameras say the drones are
        if self.mode == "embodied":
            self.x[nv:] = np.clip(meas[:, 0], 0, L)
            self.y[nv:] = np.clip(meas[:, 1], 0, L)
            if self.heading_source == "measured":
                vel = (meas - self.prev_meas) / self.dt
                sp = np.hypot(vel[:, 0], vel[:, 1])
                ok = sp > 0.3 * self.v0
                self.th[nv:][ok] = np.arctan2(vel[ok, 1], vel[ok, 0])
        self.prev_meas = meas
        # 3. Vicsek update for everyone (this is what the FPGA computes)
        if self.engine == "fixed":
            fp, wp = self._fp, self.wp
            if self.mode == "embodied":       # the laptop writes the measured drone positions
                self.xq[nv:] = fp.quantize_pos(self.x[nv:], L); self.yq[nv:] = fp.quantize_pos(self.y[nv:], L)
            etaq = min(int(round(self.eta / (2 * math.pi) * 65536)), 65536)
            fp.step_walls(self.xq, self.yq, self.hq, self.sq, wp.rq2, wp.vq, etaq, wp.lo, wp.hi, wp.wlo, wp.whi,
                          wp.wk, self.hmq)
            self.x = self.xq * (L / 65536.0); self.y = self.yq * (L / 65536.0)
            self.th = wrap(self.hq * (2 * np.pi / 65536.0))
        elif self.k_nn > 0:
            _mean_headings_knn(self.x, self.y, self.th, L, self.R, self.ncell, self.mean, self.k_nn,
                               self.b, self.w, self.kappa)
        else:
            _mean_headings_box(self.x, self.y, self.th, L, self.R, self.ncell, self.mean, self.count,
                               self.b, self.w, self.kappa, self.rep_r, self.rep_gain, self.rep_from)
        if self.engine != "fixed":
            self.th = wrap(self.mean + self.eta * (r.random(self.n) - 0.5))
            self.x += self.v0 * np.cos(self.th) * self.dt
            self.y += self.v0 * np.sin(self.th) * self.dt
            _reflect(self.x, self.y, self.th, self.b, L - self.b)
            self.th = wrap(self.th)
        # 4. commands for the real drones
        if self.mode == "embodied":
            c = self.v0 * np.stack([np.cos(self.th[nv:]), np.sin(self.th[nv:])], 1)
        else:  # puppet: chase the twin's ideal position
            twin = np.stack([self.x[nv:], self.y[nv:]], 1)
            ff = self.v0 * np.stack([np.cos(self.th[nv:]), np.sin(self.th[nv:])], 1)
            c = ff + 2.0 * (twin - meas)
        if self.sep > 0:
            # safety layer for the real drones only: the Vicsek rule has no repulsion,
            # so add a push away from any other real drone closer than `separation`
            d = meas[:, None, :] - meas[None, :, :]
            dist = np.hypot(d[..., 0], d[..., 1]) + np.eye(nr) * 1e9
            push = np.clip(self.sep - dist, 0, None) / self.sep
            if self.t >= int(2.0 / self.dt) and push.any():
                self.sep_ticks += 1
            c = c + self.sep_gain * self.v0 * (push[..., None] * d / dist[..., None]).sum(1)
        self.cmd_buf.append(c)
        arriving = self.cmd_buf.pop(0)
        got = r.random(nr) >= self.loss
        self.cmd[got] = arriving[got]
        # 5. drone physics (5 substeps per tick)
        h = self.dt / 5
        for _ in range(5):
            a = (self.cmd - self.v) / self.tau
            an = np.hypot(a[:, 0], a[:, 1])[:, None]
            a = np.where(an > self.a_max, a * self.a_max / np.maximum(an, 1e-12), a)
            self.v += a * h + r.normal(0, self.vel_noise * math.sqrt(h), self.v.shape)
            self.p += self.v * h
        dd = self.p[:, None, :] - self.p[None, :, :]
        dmin = (np.hypot(dd[..., 0], dd[..., 1]) + np.eye(nr) * 1e9).min()
        if self.t >= int(2.0 / self.dt):          # ignore the first 2 s (take-off positions)
            self.min_dist = min(self.min_dist, float(dmin))
        out = np.maximum(np.maximum(self.b - self.p, self.p - (L - self.b)), 0).max()
        self.overshoot = max(self.overshoot, float(out))
        if ((self.p < 0) | (self.p > L)).any():
            self.left_net += 1
        self.p = np.clip(self.p, 0, L)
        self.hist_real.append(self.p.copy())
        self.hist_virt.append(np.stack([self.x[:8], self.y[:8]], 1).copy())
        if len(self.hist_real) > 64:
            self.hist_real.pop(0); self.hist_virt.pop(0)
        self.t += 1

    # ---- measurements -------------------------------------------------------
    def local_heading(self, px, py, exclude=-1):
        dx = self.x - px; dy = self.y - py
        d2 = dx * dx + dy * dy
        if exclude >= 0:
            d2[exclude] = np.inf
        if self.k_nn > 0:
            nb = np.zeros(self.n, dtype=bool)
            nb[np.argpartition(d2, self.k_nn)[:self.k_nn]] = True
        else:
            nb = d2 <= self.R ** 2
        if not nb.any():
            return np.nan, 0
        return math.atan2(np.sin(self.th[nb]).sum(), np.cos(self.th[nb]).sum()), int(nb.sum())

    def alignment_errors(self, window=0.2):
        """Angle (rad) between the direction each agent actually travelled over the last
        `window` seconds and the mean heading of its neighbours now. Same measure for the
        real drones (true positions) and for 8 virtual agents (their baseline), so the
        two are directly comparable: an agent that moved less than 20% of its nominal
        distance in the window (a drone held back, or a virtual agent reflected at a
        wall) has no direction of travel and is left out. How often a drone is held back
        is counted separately (stall_samples / drone_samples)."""
        k = max(int(round(window / self.dt)), 1)
        if len(self.hist_real) <= k:
            return np.array([np.nan]), np.array([np.nan])
        nv = self.nv
        dr = self.hist_real[-1] - self.hist_real[-1 - k]
        dv = self.hist_virt[-1] - self.hist_virt[-1 - k]
        real, virt = [], []
        for j in range(self.nr):
            m, cnt = self.local_heading(self.p[j, 0], self.p[j, 1], exclude=nv + j)
            if not cnt:
                real.append(np.nan); continue
            self.drone_samples += 1
            if math.hypot(*dr[j]) < 0.2 * self.v0 * window:
                self.stall_samples += 1
                real.append(np.nan); continue
            real.append(abs(wrap(math.atan2(dr[j, 1], dr[j, 0]) - m)))
        for i in range(dv.shape[0]):
            m, cnt = self.local_heading(self.x[i], self.y[i], exclude=i)
            if not cnt or math.hypot(*dv[i]) < 0.2 * self.v0 * window:
                virt.append(np.nan)   # reflected at a wall in this window: skip
                continue
            virt.append(abs(wrap(math.atan2(dv[i, 1], dv[i, 0]) - m)))
        return np.array(real), np.array(virt)

    def local_order(self):
        return float(_local_order(self.x, self.y, self.th, self.L, self.R, self.ncell))

    def nn_dist(self):
        return _nn_dist(self.x, self.y)

    def order(self, idx=None):
        th = self.th if idx is None else self.th[idx]
        return float(np.abs(np.mean(np.exp(1j * th))))

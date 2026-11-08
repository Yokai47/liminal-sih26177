"""Checks for the Sim 13-17 models (UGV steering, reservoir, Koopman/DMD,
stigmergy and mesh search, communication estimators)."""
import numpy as np

from liminal_sim.vicsek import init_random, box_size
from liminal_sim.ugv import run_ugv, ugv_start, angdiff
from liminal_sim.reservoir import run_reservoir, ridge_fit, ridge_predict, r2, NFEAT, GRID
from liminal_sim.koopman import DMD, angle_error
from liminal_sim import stigmergy as S
from liminal_sim.comm import phi_of, phi_corrected, skewed_snapshots


def _flock(n=128, seed=0):
    L = box_size(n, 2.0)
    x, y, th = init_random(n, L, seed)
    return x, y, th, L


def test_ugv_modes():
    x, y, th, L = _flock()
    ux, uy = ugv_start(L, 1)
    # broadcast at low noise: the flock goes the UGV's way
    _, _, g, _, _ = run_ugv(x, y, th, L, 1.0, 0.03, 0.3, 6000, 1, 2, 1.0, 1.0, 3000, 10, ux, uy)
    assert g[100:].mean() > 0.9
    # no UGV: no preference for the UGV's heading on average over turns
    x, y, th, L = _flock(seed=1)
    gs = []
    for sd in range(4):
        x, y, th, L = _flock(seed=sd)
        _, _, g, _, _ = run_ugv(x, y, th, L, 1.0, 0.03, 4.0, 9000, sd, 0, 1.0, 1.0, 3000, 10, ux, uy)
        gs.append(g.mean())
    assert abs(np.mean(gs)) < 0.1


def test_ugv_start_and_angdiff():
    ux, uy = ugv_start(16.0, 4)
    assert sorted(zip(ux, uy)) == [(4.0, 4.0), (4.0, 12.0), (12.0, 4.0), (12.0, 12.0)]
    assert np.isclose(angdiff(np.pi - 0.1, -np.pi + 0.1), -0.2)


def test_reservoir_features():
    x, y, th, L = _flock()
    u = np.random.default_rng(0).uniform(-1, 1, 20)
    f = run_reservoir(x, y, th, L, 1.0, 0.03, 1.0, u, 10, 3, 4.0, 1.0, L / 2, L / 2)
    assert f.shape == (20, NFEAT)
    dens = f[:, 2:3 * GRID * GRID:3]
    assert np.allclose(dens.sum(axis=1), GRID * GRID)          # relative densities average to 1
    assert np.all((f[:, -3] >= 0) & (f[:, -3] <= 1))            # order parameter


def test_ridge_recovers_linear_map():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(500, 5))
    y = X @ np.array([1.0, -2.0, 0.5, 0.0, 3.0]) + 4.0
    m = ridge_fit(X, y, 1e-8)
    assert r2(y, ridge_predict(m, X)) > 0.999999


def test_dmd_recovers_linear_system():
    rng = np.random.default_rng(1)
    A = np.array([[0.9, 0.2, 0.0], [-0.2, 0.9, 0.0], [0.0, 0.0, 0.5]])
    B = np.array([[1.0], [0.0], [0.5]])
    runs, ins = [], []
    for _ in range(3):
        g = np.zeros((300, 3)); v = rng.normal(size=(300, 1)); g[0] = rng.normal(size=3)
        for t in range(299):
            g[t + 1] = A @ g[t] + B @ v[t]
        runs.append(g); ins.append(v)
    m = DMD(3, n_in=1, ridge=1e-12).fit(runs, ins)
    g, v = runs[0], ins[0]
    p = m.predict(g[:50], 5, np.stack([v[k:k + 50] for k in range(5)], axis=1))
    assert np.allclose(p, g[5:55], atol=1e-6)


def test_angle_error():
    assert np.isclose(angle_error(1.0, 0.0, 0.0, 1.0), 90.0)
    assert np.isclose(angle_error(-1.0, 1e-9, -1.0, -1e-9), 0.0, atol=1e-6)


def test_bfs_and_ball():
    free = np.ones((7, 7), bool)
    free[:, 3] = False
    free[6, 3] = True                                        # one gap at the bottom
    d = S.bfs(free, np.array([0], np.int32), np.array([0], np.int32), 100)
    assert d[0, 2] == 2 and d[0, 4] == 6 + 4 + 6             # down, through the gap, back up
    out = np.zeros_like(free)
    S.ball(free, 0, 0, 3, out)
    assert out[0, 2] and not out[0, 4]                       # the wall blocks searching


def test_crdt_merge_order_does_not_matter():
    rng = np.random.default_rng(2)
    maps = [rng.random((20, 20)) < 0.2 for _ in range(5)]
    results = set()
    for _ in range(10):
        order = rng.permutation(5)
        m = np.zeros((20, 20), bool)
        for i in order:
            m |= maps[i]
            m |= maps[order[0]]                              # repeating a merge changes nothing
        results.add(m.tobytes())
    assert len(results) == 1


def test_beliefs_are_only_real_observations():
    w = S.world(0)
    for pol in ("mesh", "marks", "tags"):
        r = S.run(0, pol, t_max=150, wrld=w)
        for b in r["believed"]:
            assert not (b & ~r["truth"]).any()


def test_phi_correction_unbiased_in_phi_squared():
    rng = np.random.default_rng(3)
    th = rng.vonmises(0.0, 1.0, 128)
    true2 = phi_of(th) ** 2
    est = []
    f = (128 - 8) / 127
    for _ in range(20000):
        p2 = phi_of(th[rng.choice(128, 8, replace=False)]) ** 2
        est.append((p2 - f / 8) / (1 - f / 8))
    assert abs(np.mean(est) - true2) < 0.01
    assert phi_corrected(th, 128) == phi_of(th)


def test_skewed_snapshots_zero_offset():
    h = np.random.default_rng(4).uniform(-np.pi, np.pi, (50, 6))
    snap, idx = skewed_snapshots(h, np.zeros(6, int))
    assert np.array_equal(snap, h) and np.array_equal(idx, np.arange(50))
    snap, idx = skewed_snapshots(h, np.array([0, 1, -2, 0, 0, 0]))
    assert idx[0] == 2 and idx[-1] == 48
    assert snap[0, 1] == h[3, 1] and snap[0, 2] == h[0, 2]


def test_beliefs_real_with_battery_limit():
    # persistence-test setting: drones stop at active_until; marks they leave must
    # only claim searched cells (a later wave reads them)
    w = S.world(0)
    r = S.run(0, "alone", t_max=400, active_until=120, wrld=w, write_marks_m=1.0, write_tags_m=10.0)
    claimed = np.zeros_like(r["truth"])
    for (my, mx) in r["marks"]:
        S.ball(w[3], my, mx, int(round(3.0 / S.RES)), claimed)
    assert not (claimed & ~r["truth"]).any()
    for (_, _, m) in r["tags"]:
        assert not (m & ~r["truth"]).any()


def test_clock_skew_turns_are_90_degrees():
    import os, sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from experiments.exp17_comm import turn_headings
    for sd in range(10):
        h = turn_headings(np.random.default_rng(sd), 9)
        assert h[0] == 0.0
        assert np.allclose(np.abs(np.diff(h)), np.pi / 2)

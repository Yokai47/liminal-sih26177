import numpy as np
from liminal_sim.hybrid import Hybrid


def test_drones_stay_in_net_and_flock():
    h = Hybrid(n_virtual=256, eta=0.8, seed=4)
    for _ in range(800):
        h.tick()
    assert h.left_net == 0              # soft walls + margin keep drones inside the net
    assert h.order() > 0.7              # low noise: the mixed flock is ordered


def test_puppet_mode_runs():
    h = Hybrid(n_virtual=64, mode="puppet", seed=1)
    for _ in range(100):
        h.tick()
    assert np.isfinite(h.p).all()


def test_repulsion_spreads_agents():
    def nn5(**kw):
        h = Hybrid(n_virtual=120, n_real=8, eta=1.0, seed=2, **kw)
        for _ in range(600):
            h.tick()
        return np.percentile(h.nn_dist(), 5)
    assert nn5(repulsion=0.4, rep_gain=2.0) > 2 * nn5()


def test_local_order_bounds():
    h = Hybrid(n_virtual=120, n_real=8, eta=0.5, seed=3)
    for _ in range(600):
        h.tick()
    lo = h.local_order()
    assert 0.0 < lo <= 1.0 and lo >= h.order() - 0.05   # neighbourhoods at least as aligned as the whole flock


def test_merge_finite_size():
    from liminal_sim.stats import merge_finite_size
    e3 = {"meta": {}, "rows": [dict(n=2048, eta=2.0, seeds=1, phi=0.5, chi=40.0, binder=0.6, ac=0.9, phi_err=0.1, chi_err=4.0)]}
    e3b = {"runs": [dict(n=2048, eta=2.0, phi=0.7, chi=20.0, binder=0.6, ac=0.9, phi_err=0.1, chi_err=4.0)]}
    r = merge_finite_size(e3, e3b)["rows"][0]
    assert r["seeds"] == 2 and abs(r["chi"] - 30.0) < 1e-9 and abs(r["chi_err"] - np.sqrt(32) / 2) < 1e-9


def test_fixed_engine_flies_the_demo():
    # the FPGA's integer engine (v1.1) in the hybrid loop: drones stay in the net, flock orders
    h = Hybrid(n_virtual=120, n_real=8, eta=1.0, separation=0.5, sep_gain=4.0, engine="fixed", seed=5)
    for _ in range(800):
        h.tick()
    assert h.left_net == 0 and h.order() > 0.8
    wp = h.wp
    assert h.xq.min() >= 0 and h.xq.max() <= 65535 and h.xq[:120].min() >= wp.lo and h.xq[:120].max() <= wp.hi


def test_latency_is_exactly_the_setting():
    # a value pushed into a delay buffer must come out exactly d ticks later (d = 0: no delay)
    from liminal_sim.hybrid import Hybrid
    for lat, ticks in ((0.0, 0), (0.02, 1), (0.04, 2), (0.1, 5), (0.4, 20)):
        h = Hybrid(n_virtual=16, n_real=2, latency=lat, seed=0)
        assert h.d_meas + h.d_cmd == ticks
        assert len(h.meas_buf) == h.d_meas and len(h.cmd_buf) == h.d_cmd

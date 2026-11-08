import numpy as np
from liminal_sim.vicsek import run_periodic, init_random, box_size


def test_zero_noise_orders():
    # With no noise a dense flock must become almost perfectly aligned.
    n = 256; L = box_size(n, 2.0)
    x, y, th = init_random(n, L, 1)
    phi = run_periodic(x, y, th, L, 1.0, 0.03, 0.0, 3000, 1)
    assert phi[-1] > 0.95


def test_max_noise_disorders():
    # With eta = 2*pi the heading is random every step: phi ~ 1/sqrt(N).
    n = 400; L = box_size(n, 2.0)
    x, y, th = init_random(n, L, 2)
    phi = run_periodic(x, y, th, L, 1.0, 0.03, 2 * np.pi, 4000, 2)
    m = phi[1000:].mean()
    assert abs(m - np.sqrt(np.pi / (4 * n))) < 0.02  # mean of |sum of N unit vectors|/N


def test_deterministic():
    n = 64; L = box_size(n, 2.0)
    a = init_random(n, L, 3); b = init_random(n, L, 3)
    p1 = run_periodic(*a, L, 1.0, 0.03, 1.0, 200, 7)
    p2 = run_periodic(*b, L, 1.0, 0.03, 1.0, 200, 7)
    assert np.array_equal(p1, p2)

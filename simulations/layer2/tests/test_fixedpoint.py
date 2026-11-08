import math
import numpy as np
from liminal_sim import fixedpoint as fp


def test_cordic_accuracy():
    # CORDIC atan2 must agree with math.atan2 to within 1 angle unit (0.0055 deg)
    rng = np.random.default_rng(0)
    worst = 0
    for _ in range(20000):
        sx, sy = rng.integers(-2 ** 20, 2 ** 20, 2) >> rng.integers(0, 16)
        if sx == 0 and sy == 0:
            continue
        z = fp.cordic_atan2(int(sy), int(sx), 0)
        ref = (math.atan2(sy, sx) * 65536 / (2 * math.pi)) % 65536
        d = (z - ref + 32768) % 65536 - 32768
        worst = max(worst, abs(d))
    assert worst <= 1.0, worst


def test_noise_range():
    # noise must stay inside [-eta/2, eta/2]
    p = fp.Params(5.0, 1.0, 0.03, 2.0)
    s = 12345
    lo, hi = 10 ** 9, -10 ** 9
    for _ in range(100000):
        s = fp.xorshift32(s)
        r = s >> 16
        nz = ((r * p.etaq) >> 16) - (p.etaq >> 1)
        lo, hi = min(lo, nz), max(hi, nz)
    assert -p.etaq / 2 - 1 <= lo and hi <= p.etaq / 2


def test_zero_noise_orders():
    n = 128
    L = math.sqrt(n / 2.0)
    p = fp.Params(L, 1.0, 0.03, 0.0)
    x, y, h, s = fp.init_state(n, 1)
    phi = fp.run(x, y, h, s, p.rq2, p.vq, p.etaq, 3000)
    assert phi[-1] > 0.95

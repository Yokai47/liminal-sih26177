"""Fixed-point Vicsek model: the bit-exact reference for the FPGA.

Every operation here is integer arithmetic that maps one-to-one onto hardware.
The Verilog agent engine must reproduce these numbers exactly, bit for bit.

Number formats
--------------
position  x, y : 16-bit unsigned. 0..65535 covers the box [0, L).
                 Wrap-around of a 16-bit counter IS the periodic boundary,
                 so the hardware gets periodic boundaries for free.
heading   h    : 16-bit unsigned "binary angle". 65536 = one full turn (2*pi).
                 Again, overflow wraps naturally (359 deg + 2 deg = 1 deg).
cos/sin        : signed Q1.15 values (32767 = +1.0) read from a 1024-entry
                 lookup table (one block RAM on the FPGA).
mean heading   : atan2 of the summed cos/sin, computed by a 16-step CORDIC
                 (shift-and-add only: no multipliers, no division). The angle
                 accumulator carries 4 extra fraction bits (20 bits) so table
                 rounding does not add up; the result is rounded to 16 bits.
noise          : one 32-bit xorshift random-number generator per agent.

One step, for every agent i at the same time (synchronous update):
  1. Sx, Sy = sum of cos/sin of every agent j with dx^2 + dy^2 <= Rq2
     (dx, dy = 16-bit wrapped differences; agent i counts itself).
  2. h_mean = CORDIC_atan2(Sy, Sx)            (keep own heading if Sx = Sy = 0)
  3. h_new  = h_mean + noise,  noise uniform in [-eta/2, +eta/2]
  4. x += round(vq * cos(h_new)),  y += round(vq * sin(h_new))   (mod 2^16)
"""
import math
import numpy as np
from numba import njit

POS_BITS = 16
ANG_BITS = 16
LUT_BITS = 10
CORDIC_ITERS = 16
MASK16 = 0xFFFF
MASK32 = 0xFFFFFFFF

# ---- lookup tables (these become ROM contents on the FPGA) -----------------
LUT_N = 1 << LUT_BITS
COS_LUT = np.array([int(round(32767 * math.cos(2 * math.pi * k / LUT_N))) for k in range(LUT_N)], dtype=np.int64)
SIN_LUT = np.array([int(round(32767 * math.sin(2 * math.pi * k / LUT_N))) for k in range(LUT_N)], dtype=np.int64)
Z_FRAC = 4  # CORDIC keeps 4 extra fraction bits on the angle, rounded off at the end
ATAN_TAB = np.array([int(round(math.atan(2.0 ** -i) * (65536 << Z_FRAC) / (2 * math.pi))) for i in range(CORDIC_ITERS)], dtype=np.int64)


class Params:
    """Converts physical parameters (units of R) into the integer constants the hardware uses."""

    def __init__(self, L, R, v0, eta):
        self.L, self.R, self.v0, self.eta = L, R, v0, eta
        rq = R / L * 65536
        self.rq2 = int(round(rq * rq))                       # squared radius, position units
        self.vq = int(round(v0 / L * 65536))                 # step length, position units
        self.etaq = int(round(eta / (2 * math.pi) * 65536))  # noise width, angle units
        if self.etaq > 65536:
            self.etaq = 65536

    def as_dict(self):
        return dict(L=self.L, R=self.R, v0=self.v0, eta=self.eta, rq2=self.rq2, vq=self.vq, etaq=self.etaq)


@njit(cache=True)
def lut_index(h):
    return ((h + (1 << (ANG_BITS - LUT_BITS - 1))) >> (ANG_BITS - LUT_BITS)) & (LUT_N - 1)


@njit(cache=True)
def cordic_atan2(sy, sx, own):
    """Binary-angle atan2 by CORDIC vectoring (shift-and-add)."""
    if sx == 0 and sy == 0:
        return own
    x = sx
    y = sy
    # normalise: shift small vectors left so the shifts below keep precision
    # (hardware: leading-zero count + barrel shifter, a few LUTs)
    m = abs(x) if abs(x) > abs(y) else abs(y)
    while m < (1 << 26):
        x <<= 1
        y <<= 1
        m <<= 1
    z = 0
    if x < 0:            # rotate by 180 deg so the vector is in the right half-plane
        x = -x
        y = -y
        z = 32768 << Z_FRAC
    for i in range(CORDIC_ITERS):
        if y > 0:
            xn = x + (y >> i)
            y = y - (x >> i)
            z = z + ATAN_TAB[i]
        else:
            xn = x - (y >> i)
            y = y + (x >> i)
            z = z - ATAN_TAB[i]
        x = xn
    return ((z + (1 << (Z_FRAC - 1))) >> Z_FRAC) & MASK16


@njit(cache=True)
def xorshift32(s):
    s ^= (s << 13) & MASK32
    s ^= s >> 17
    s ^= (s << 5) & MASK32
    return s & MASK32


@njit(cache=True)
def wrap16(d):
    return ((d + 32768) & MASK16) - 32768


@njit(cache=True)
def step(x, y, h, rng, rq2, vq, etaq, hmean_out):
    """One synchronous step. Arrays are int64; modified in place."""
    n = x.shape[0]
    for i in range(n):
        sx = 0
        sy = 0
        for j in range(n):
            dx = wrap16(x[j] - x[i])
            dy = wrap16(y[j] - y[i])
            if dx * dx + dy * dy <= rq2:
                k = lut_index(h[j])
                sx += COS_LUT[k]
                sy += SIN_LUT[k]
        hmean_out[i] = cordic_atan2(sy, sx, h[i])
    for i in range(n):
        rng[i] = xorshift32(rng[i])
        r = rng[i] >> 16
        noise = ((r * etaq) >> 16) - (etaq >> 1)
        h[i] = (hmean_out[i] + noise) & MASK16
        k = lut_index(h[i])
        x[i] = (x[i] + ((vq * COS_LUT[k] + (1 << 14)) >> 15)) & MASK16
        y[i] = (y[i] + ((vq * SIN_LUT[k] + (1 << 14)) >> 15)) & MASK16


@njit(cache=True)
def run(x, y, h, rng, rq2, vq, etaq, steps):
    """Run `steps` steps; returns the order parameter after each step (computed in float)."""
    n = x.shape[0]
    hm = np.zeros(n, dtype=np.int64)
    phi = np.empty(steps)
    for t in range(steps):
        step(x, y, h, rng, rq2, vq, etaq, hm)
        sx = 0.0
        sy = 0.0
        for i in range(n):
            a = h[i] * (2 * np.pi / 65536)
            sx += np.cos(a)
            sy += np.sin(a)
        phi[t] = np.sqrt(sx * sx + sy * sy) / n
    return phi


def init_state(n, seed):
    """Random initial state in integer form, plus per-agent RNG seeds (never zero)."""
    rng = np.random.default_rng(seed)
    x = rng.integers(0, 65536, n).astype(np.int64)
    y = rng.integers(0, 65536, n).astype(np.int64)
    h = rng.integers(0, 65536, n).astype(np.int64)
    s = rng.integers(1, 2 ** 32, n).astype(np.int64)
    return x, y, h, s


def to_float(x, y, h, L):
    return x * (L / 65536.0), y * (L / 65536.0), (h * (2 * np.pi / 65536.0) + np.pi) % (2 * np.pi) - np.pi


# =============================================================================
# Version 1.1: the walled arena of the hybrid demo (liminal_sim/hybrid.py)
# =============================================================================
# Positions now cover a real arena [0, L) metres with NO wrap-around:
#   * distances are plain signed differences (17 bits), not wrapped ones
#   * soft walls: an agent inside the band of width w next to the flock boundary
#     (which sits b metres inside the net) gets a push toward the middle, worth
#     kappa * k neighbours per band-width of depth (k = neighbours incl. itself),
#     exactly as in hybrid._mean_headings_box
#   * hard backstop: an agent that crosses the boundary is mirrored back and its
#     heading reflected (x: h -> 180 deg - h, y: h -> -h), as in hybrid._reflect
# The real drones are ordinary agents whose x, y the laptop overwrites every tick
# with the camera measurement (heading and RNG state are left alone).

class WallParams:
    """Physical arena parameters (metres, seconds) -> the integer constants of the hardware."""

    def __init__(self, L=4.0, R=0.5, speed=0.4, rate=50.0, eta=1.0, margin=0.3, band=0.6, gain=1.5):
        self.L, self.R, self.speed, self.rate, self.eta = L, R, speed, rate, eta
        self.margin, self.band, self.gain = margin, band, gain
        u = 65536.0 / L                                     # position units per metre
        self.rq2 = int(round((R * u) ** 2))
        self.vq = int(round(speed / rate * u))
        self.etaq = min(int(round(eta / (2 * math.pi) * 65536)), 65536)
        self.lo = int(round(margin * u))                    # flock boundary (reflection)
        self.hi = int(round((L - margin) * u))
        self.wlo = int(round((margin + band) * u))          # inner edge of the soft-wall band
        self.whi = int(round((L - margin - band) * u))
        # push per neighbour per position unit of depth, in Q1.15 units, scaled by 2^16
        self.wk = int(round(gain * 32768 * L / band))
        assert self.lo > 2 * self.vq and self.hi < 65536 - 2 * self.vq

    def as_dict(self):
        return {k: getattr(self, k) for k in ("L", "R", "speed", "rate", "eta", "margin", "band", "gain",
                                              "rq2", "vq", "etaq", "lo", "hi", "wlo", "whi", "wk")}


@njit(cache=True)
def step_walls(x, y, h, rng, rq2, vq, etaq, lo, hi, wlo, whi, wk, hmean_out):
    """One synchronous step in the walled arena. Arrays are int64; modified in place."""
    n = x.shape[0]
    for i in range(n):
        sx = 0
        sy = 0
        k = 0
        for j in range(n):
            dx = x[j] - x[i]
            dy = y[j] - y[i]
            if dx * dx + dy * dy <= rq2:
                q = lut_index(h[j])
                sx += COS_LUT[q]
                sy += SIN_LUT[q]
                k += 1
        if x[i] < wlo:
            sx += (k * (wlo - x[i]) * wk) >> 16
        elif x[i] > whi:
            sx -= (k * (x[i] - whi) * wk) >> 16
        if y[i] < wlo:
            sy += (k * (wlo - y[i]) * wk) >> 16
        elif y[i] > whi:
            sy -= (k * (y[i] - whi) * wk) >> 16
        hmean_out[i] = cordic_atan2(sy, sx, h[i])
    for i in range(n):
        rng[i] = xorshift32(rng[i])
        r = rng[i] >> 16
        noise = ((r * etaq) >> 16) - (etaq >> 1)
        hh = (hmean_out[i] + noise) & MASK16
        q = lut_index(hh)
        xn = x[i] + ((vq * COS_LUT[q] + (1 << 14)) >> 15)
        yn = y[i] + ((vq * SIN_LUT[q] + (1 << 14)) >> 15)
        if xn < lo:
            xn = 2 * lo - xn
            hh = (32768 - hh) & MASK16
        elif xn > hi:
            xn = 2 * hi - xn
            hh = (32768 - hh) & MASK16
        if yn < lo:
            yn = 2 * lo - yn
            hh = (65536 - hh) & MASK16
        elif yn > hi:
            yn = 2 * hi - yn
            hh = (65536 - hh) & MASK16
        x[i] = xn & MASK16
        y[i] = yn & MASK16
        h[i] = hh


def quantize_pos(v, L):
    """Metres -> 16-bit position units, clipped to the arena."""
    return np.clip(np.round(np.asarray(v) * (65536.0 / L)), 0, 65535).astype(np.int64)


def init_walled(n, wp, seed):
    """Random integer state inside the flock boundary, plus per-agent RNG seeds."""
    r = np.random.default_rng(seed)
    x = r.integers(wp.lo, wp.hi + 1, n).astype(np.int64)
    y = r.integers(wp.lo, wp.hi + 1, n).astype(np.int64)
    h = r.integers(0, 65536, n).astype(np.int64)
    s = r.integers(1, 2 ** 32, n).astype(np.int64)
    return x, y, h, s

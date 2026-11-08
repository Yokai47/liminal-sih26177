"""Locating a steady sound source from the Doppler shift a moving drone hears.

A drone flies a known path (from its own SLAM or the motion-capture rig) carrying one
microphone. A source on the floor emits a steady tone of unknown frequency f0 (an
alarm, a phone, a whistle held steady). Because the drone moves, it hears
    f(t) = f0 * (1 + v_r(t) / c),
where v_r is the drone's velocity component toward the source and c = 343 m/s.
(For a stationary source and a moving listener this is exact: no emission-time
correction is needed, unlike a moving source.) The shape of f(t) depends on where the
source is, so fitting it gives the source position.

This module simulates the microphone signal (tone falling off as 1/distance, the
drone's own propeller noise as harmonics of a wandering blade-pass frequency, plus
broadband noise), tracks the tone's frequency with a short-time Fourier transform,
and fits the source position and f0 by a robust grid search.
"""
import numpy as np

C = 343.0


def path_straight(L=12.0, v=1.0, alt=2.0, dt=1 / 16000):
    t = np.arange(0, L / v, dt)
    return t, np.c_[v * t, np.zeros_like(t), np.full_like(t, alt)], np.c_[np.full_like(t, v), 0 * t, 0 * t]


def path_L(L1=8.0, L2=8.0, v=1.0, alt=2.0, dt=1 / 16000):
    t = np.arange(0, (L1 + L2) / v, dt)
    s = v * t
    first = s < L1
    pos = np.where(first[:, None], np.c_[s, 0 * s, 0 * s], np.c_[np.full_like(s, L1), s - L1, 0 * s])
    pos[:, 2] = alt
    vel = np.where(first[:, None], np.c_[np.full_like(s, v), 0 * s, 0 * s], np.c_[0 * s, np.full_like(s, v), 0 * s])
    return t, pos, vel


def simulate(t, pos, vel, src, f0, snr1m_db=50.0, fs=16000, drift_hz_per_sqrt_s=0.0, prop=True, seed=0):
    """Microphone signal. snr1m_db: tone power at 1 m over broadband noise power in a 1 Hz band."""
    r = np.random.default_rng(seed)
    d = src[None, :] - pos
    dist = np.linalg.norm(d, axis=1)
    vr = np.einsum("ij,ij->i", vel, d) / dist
    f = f0 * (1 + vr / C)
    if drift_hz_per_sqrt_s > 0:                                     # the source's own pitch wander
        f = f + np.cumsum(r.normal(0, drift_hz_per_sqrt_s / np.sqrt(fs), len(t)))
    phase = 2 * np.pi * np.cumsum(f) / fs
    amp = 1.0 / dist
    tone = amp * np.sin(phase + r.uniform(0, 2 * np.pi))
    sigma = np.sqrt(0.5 / 10 ** (snr1m_db / 10) * fs / 2)          # broadband noise std
    x = tone + r.normal(0, sigma, len(t))
    if prop:                                                        # 2-blade props, ~4,500 rpm, wandering
        rpm = 4500 * (1 + 0.02 * np.sin(2 * np.pi * 0.3 * t + r.uniform(0, 6)) + 0.01 * r.standard_normal() )
        bpf = 2 * rpm / 60
        ph = 2 * np.pi * np.cumsum(bpf) / fs
        line_amp = sigma * np.sqrt(10 * 5 / (fs / 2))               # each line 10 dB above the floor in a 5 Hz band
        for k in range(1, int(5000 / 150)):
            x += line_amp * np.sin(k * ph + r.uniform(0, 2 * np.pi))
    return x, f


def track(x, fs=16000, band=(2500, 3700), win=0.4, hop=0.1, pad=4, max_shift_hz=40.0):
    """Frequency of the tone, frame by frame.
    1. Short-time spectra; each frame is whitened ACROSS FREQUENCY (its level minus a
       ~100 Hz running median), which flattens the broadband noise but keeps narrow
       lines. (Whitening across time would erase a tone whose pitch barely changes,
       as it does when the source is far away.)
    2. The tone's band is found as the frequency whose strongest line appears in the
       most frames; then each frame's peak is searched only within max_shift_hz of it
       (the largest Doppler shift at 2 m/s is about 20 Hz), with sub-bin interpolation."""
    n = int(win * fs); h = int(hop * fs); nf = n * pad
    w = np.hanning(n)
    frames = np.lib.stride_tricks.sliding_window_view(x, n)[::h]
    S = np.abs(np.fft.rfft(frames * w, nf, axis=1))
    freqs = np.fft.rfftfreq(nf, 1 / fs)
    sel = (freqs >= band[0] - 60) & (freqs <= band[1] + 60)
    from scipy.ndimage import median_filter
    L = 20 * np.log10(S[:, sel] + 1e-12)
    df = freqs[1] - freqs[0]
    L = L - median_filter(L, size=(1, int(100 / df) | 1), mode="nearest")
    fb = freqs[sel]
    inb = (fb >= band[0]) & (fb <= band[1])
    k0 = np.argmax(np.where(inb[None, :], L, -np.inf), axis=1)
    hist, edges = np.histogram(fb[k0], bins=np.arange(band[0], band[1] + 5, 5.0))
    fc = edges[np.argmax(np.convolve(hist, np.ones(9), "same"))] + 2.5
    win_ = np.abs(fb - fc) <= max_shift_hz
    k = np.argmax(np.where(win_[None, :], L, -np.inf), axis=1)
    k = np.clip(k, 1, len(fb) - 2)
    r = np.arange(len(k))
    a, b_, c = L[r, k - 1], L[r, k], L[r, k + 1]
    den = a - 2 * b_ + c
    off = np.where(den != 0, 0.5 * (a - c) / np.where(den == 0, 1, den), 0.0)
    tc = (r * h + n / 2) / fs
    return tc, fb[k] + np.clip(off, -0.5, 0.5) * df, b_


def locate(tc, fhat, t, pos, vel, area=((-5, 20), (-12, 12)), step=0.25, delta_hz=3.0, src_z=0.0, refine=True):
    """Grid search over source (x, y) on the floor; f0 solved in closed form at each cell;
    truncated-quadratic loss so frames that locked onto noise do not drag the fit."""
    ii = np.clip(np.searchsorted(t, tc), 0, len(t) - 1)
    P, V = pos[ii], vel[ii]

    def cost(xs, ys):
        S = np.stack(np.meshgrid(xs, ys, indexing="ij"), -1).reshape(-1, 2)
        d = np.concatenate([S[:, None, :] - P[None, :, :2], (src_z - P[None, :, 2:3]) * np.ones((len(S), 1, 1))], 2)
        g = 1 + np.einsum("tk,stk->st", V, d) / np.linalg.norm(d, axis=2) / C
        f0 = (g * fhat).sum(1) / (g * g).sum(1)
        res = fhat[None, :] - f0[:, None] * g
        return S, np.minimum(res ** 2, delta_hz ** 2).sum(1), f0

    xs = np.arange(area[0][0], area[0][1] + 1e-9, step); ys = np.arange(area[1][0], area[1][1] + 1e-9, step)
    S, J, F = cost(xs, ys)
    order = np.argsort(J)
    best = S[order[0]]
    if refine:
        xs2 = np.arange(best[0] - step, best[0] + step + 1e-9, step / 10)
        ys2 = np.arange(best[1] - step, best[1] + step + 1e-9, step / 10)
        S2, J2, F2 = cost(xs2, ys2)
        best = S2[np.argmin(J2)]
    # second-best solution far from the best (to report mirror ambiguity)
    far = np.linalg.norm(S[order] - S[order[0]], axis=1) > 2.0
    second = S[order][far][0] if far.any() else best
    j2 = J[order][far][0] if far.any() else J[order[0]]
    return best, second, float(j2 / max(J[order[0]], 1e-9))

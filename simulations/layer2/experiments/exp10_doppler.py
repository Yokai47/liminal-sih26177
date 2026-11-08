"""Sim 10: locating a steady sound from the Doppler shift heard by a moving drone.

One microphone on the drone, flying at 2 m height along a known path; a source on
the floor emitting a steady tone (2.8-3.4 kHz, frequency unknown to the drone);
the drone's own propeller noise as wandering harmonics plus broadband noise.
A) Path shape: straight pass vs L-shaped path (mirror ambiguity).
B) Loudness: tone-to-noise ratio at 1 m from 60 down to 20 dB (per 1 Hz band).
C) Source pitch stability: random pitch drift of the source.
D) Flight speed.
Output: results/data/exp10_doppler.json, results/data/exp10_example.npz
"""
import json, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim import doppler as D

N = 30


def trial(a):
    path, snr, drift, v, seed = a
    r = np.random.default_rng(1000 + seed)
    if path == "straight":
        t, pos, vel = D.path_straight(L=12.0, v=v)
        src = np.array([r.uniform(2, 10), r.choice([-1, 1]) * r.uniform(1, 7), 0.0])
    else:
        t, pos, vel = D.path_L(8.0, 8.0, v=v)
        src = np.array([r.uniform(-2, 14), r.uniform(-6, 12), 0.0])
        while min(np.hypot(src[0] - pos[:, 0], src[1] - pos[:, 1])) < 1.0:   # not right under the path
            src = np.array([r.uniform(-2, 14), r.uniform(-6, 12), 0.0])
    f0 = r.uniform(2800, 3400)
    x, f = D.simulate(t, pos, vel, src, f0, snr1m_db=snr, drift_hz_per_sqrt_s=drift, seed=seed)
    tc, fh, _ = D.track(x)
    best, second, ratio = D.locate(tc, fh, t, pos, vel, area=((-4, 16), (-10, 14)))
    err = float(np.hypot(*(best - src[:2])))
    mirror = np.array([best[0], -best[1]])
    err_mirror = float(min(err, np.hypot(*(mirror - src[:2])))) if path == "straight" else err
    ftrue = np.interp(tc, t, f)
    return dict(path=path, snr=snr, drift=drift, v=v, seed=seed, err_m=err, err_up_to_mirror_m=err_mirror,
                ambiguity_ratio=ratio, track_err_hz=float(np.median(np.abs(fh - ftrue))),
                dist_min_m=float(min(np.linalg.norm(src - pos, axis=1))))


if __name__ == "__main__":
    t0 = time.time()
    jobs = []
    for p in ("straight", "L"):
        jobs += [(p, 50.0, 0.0, 1.0, s) for s in range(N)]
    for snr in (60.0, 40.0, 30.0, 20.0):
        jobs += [("L", snr, 0.0, 1.0, s) for s in range(N)]
    for drift in (0.1, 0.2, 0.5, 1.0, 2.0, 5.0):
        jobs += [("L", 50.0, drift, 1.0, s) for s in range(N)]
    for v in (0.5, 2.0):
        jobs += [("L", 50.0, 0.0, v, s) for s in range(N)]
    with Pool(2) as pool:
        res = pool.map(trial, jobs, chunksize=4)
    # one example for the figure
    t, pos, vel = D.path_L(8.0, 8.0, v=1.0)
    src = np.array([5.0, 4.0, 0.0])
    x, f = D.simulate(t, pos, vel, src, 3100.0, snr1m_db=50.0, seed=3)
    tc, fh, _ = D.track(x)
    best, second, ratio = D.locate(tc, fh, t, pos, vel, area=((-4, 16), (-10, 14)))
    n = int(0.4 * 16000); h = int(0.1 * 16000)
    frames = np.lib.stride_tricks.sliding_window_view(x, n)[::h]
    S = np.abs(np.fft.rfft(frames * np.hanning(n), 4 * n, axis=1))
    fr = np.fft.rfftfreq(4 * n, 1 / 16000)
    sel = (fr > 2950) & (fr < 3250)
    np.savez_compressed("results/data/exp10_example.npz", spec=20 * np.log10(S[:, sel] + 1e-12), freqs=fr[sel], tc=tc,
                        fhat=fh, ftrue=np.interp(tc, t, f), path=pos[::1600, :2], src=src[:2], best=best)
    json.dump({"trials": res, "runtime_s": time.time() - t0}, open("results/data/exp10_doppler.json", "w"), indent=1)
    print("done", time.time() - t0)

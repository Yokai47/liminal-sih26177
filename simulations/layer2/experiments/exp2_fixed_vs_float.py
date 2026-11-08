"""Sim 2: does the FPGA's integer arithmetic behave like the real model?

(a) One-step accuracy: from the same flock state, compare the mean heading the
    fixed-point model computes with the exact floating-point value.
(b) Behaviour: sweep the noise for N = 512 with both models and compare the
    order parameter and susceptibility curves.
(c) Test vectors: write a small run (64 agents, 32 steps) with every
    intermediate value, for the Verilog testbench to check bit for bit.

Outputs: results/data/exp2_fixed_vs_float.json, vectors/vicsek_n64_eta1p5.txt
"""
import json, math, os, sys, time
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim import fixedpoint as fp
from liminal_sim.vicsek import run_periodic, init_random, box_size
from liminal_sim.stats import summarize

DENSITY, V0, R = 2.0, 0.03, 1.0


def float_mean_heading(xf, yf, thf, L, R):
    dx = xf[None, :] - xf[:, None]; dy = yf[None, :] - yf[:, None]
    dx -= L * np.round(dx / L); dy -= L * np.round(dy / L)
    nb = dx * dx + dy * dy <= R * R
    sx = (nb * np.cos(thf)[None, :]).sum(1); sy = (nb * np.sin(thf)[None, :]).sum(1)
    return np.arctan2(sy, sx), nb


def fixed_mean_heading(x, y, h, rq2):
    n = len(x)
    out = np.zeros(n, dtype=np.int64)
    nbs = np.zeros((n, n), dtype=bool)
    for i in range(n):
        dx = ((x - x[i] + 32768) & 0xFFFF) - 32768
        dy = ((y - y[i] + 32768) & 0xFFFF) - 32768
        nb = dx * dx + dy * dy <= rq2
        nbs[i] = nb
        k = np.array([fp.lut_index(int(v)) for v in h[nb]])
        out[i] = fp.cordic_atan2(int(fp.SIN_LUT[k].sum()), int(fp.COS_LUT[k].sum()), int(h[i]))
    return out, nbs


def accuracy(n=512, trials=6):
    L = box_size(n, DENSITY)
    p = fp.Params(L, R, V0, 0.0)
    errs, mism, pairs = [], 0, 0
    for t in range(trials):
        x, y, h, s = fp.init_state(n, 100 + t)
        # partially ordered flock: headings spread around a common direction
        h = (np.int64(t * 9000) + np.random.default_rng(t).integers(-12000, 12000, n)) & 0xFFFF
        xf, yf, thf = fp.to_float(x, y, h, L)
        mf, nbf = float_mean_heading(xf, yf, thf, L, R)
        mq, nbq = fixed_mean_heading(x, y, h, p.rq2)
        same = (nbf == nbq).all(1)
        mism += int((nbf != nbq).sum()); pairs += int(nbf.sum())
        d = ((mq * 2 * math.pi / 65536) - mf + math.pi) % (2 * math.pi) - math.pi
        errs.extend(np.degrees(np.abs(d[same])).tolist())
    e = np.array(errs)
    return dict(n=n, agents_compared=len(e), median_deg=float(np.median(e)), p99_deg=float(np.percentile(e, 99)),
                max_deg=float(e.max()), neighbour_mismatches=mism, neighbour_pairs=pairs)


def sweep_job(args):
    kind, eta, n, eq, meas = args
    L = box_size(n, DENSITY)
    if kind == "float":
        x, y, th = init_random(n, L, 11)
        run_periodic(x, y, th, L, R, V0, eta, eq, 3)
        phi = run_periodic(x, y, th, L, R, V0, eta, meas, 4)
    else:
        p = fp.Params(L, R, V0, eta)
        x, y, h, s = fp.init_state(n, 11)
        fp.run(x, y, h, s, p.rq2, p.vq, p.etaq, eq)
        phi = fp.run(x, y, h, s, p.rq2, p.vq, p.etaq, meas)
    r = summarize(phi, n); r.update(kind=kind, eta=eta, n=n)
    return r


def write_vectors(n=64, eta=1.5, steps=32, path="vectors/vicsek_n64_eta1p5.txt"):
    L = box_size(n, DENSITY)
    p = fp.Params(L, R, V0, eta)
    x, y, h, s = fp.init_state(n, 2026)
    hm = np.zeros(n, dtype=np.int64)
    lines = ["# LIMINAL fixed-point Vicsek test vectors (SIMULATION reference for the Verilog testbench)",
             f"# params: n={n} L={L:.6f} R={R} v0={V0} eta={eta} rq2={p.rq2} vq={p.vq} etaq={p.etaq}",
             "# lut_bits=10 cordic_iters=16 cordic_zfrac=4 pos_bits=16 ang_bits=16 rng=xorshift32(13,17,5)",
             "# columns (hex): step agent x y h rng hmean   step 0 = initial state, hmean = mean heading used to reach this step"]
    for i in range(n):
        lines.append(f"0 {i} {x[i]:04x} {y[i]:04x} {h[i]:04x} {s[i]:08x} 0000")
    for t in range(1, steps + 1):
        fp.step(x, y, h, s, p.rq2, p.vq, p.etaq, hm)
        for i in range(n):
            lines.append(f"{t} {i} {x[i]:04x} {y[i]:04x} {h[i]:04x} {s[i]:08x} {hm[i]:04x}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write("\n".join(lines) + "\n")
    return dict(path=path, n=n, steps=steps, params=p.as_dict())


if __name__ == "__main__":
    t0 = time.time()
    acc = accuracy()
    print("accuracy", acc, flush=True)
    vec = write_vectors()
    etas = [round(v, 2) for v in np.arange(1.6, 3.81, 0.2)]
    jobs = [(k, e, 512, 10000, 40000) for e in etas for k in ("float", "fixed")]
    with Pool(2) as pool:
        sweep = pool.map(sweep_job, jobs)
    json.dump({"accuracy": acc, "sweep": sweep, "vectors": vec, "runtime_s": time.time() - t0},
              open("results/data/exp2_fixed_vs_float.json", "w"), indent=1)
    print("done", time.time() - t0)

"""Turn the three logs of a ground-station run into the same numbers as the offline
hybrid simulation (liminal_sim/hybrid.py), plus timing statistics of the real loop."""
import json
import math
import os
import sys
import numpy as np


def _wrap(a):
    return (a + np.pi) % (2 * np.pi) - np.pi


def load(run_dir):
    g = dict(np.load(os.path.join(run_dir, "gs.npz")))
    w = dict(np.load(os.path.join(run_dir, "world.npz")))
    ep = os.path.join(run_dir, "engine.npz")
    e = dict(np.load(ep)) if os.path.exists(ep) else {"compute_us": np.array([np.nan])}   # FPGA: no engine log
    cfg = json.load(open(os.path.join(run_dir, "config.json")))
    return cfg, g, w, e


def _interp_p(w, t):
    tw, p = w["t"], w["p"]
    i = np.clip(np.searchsorted(tw, t), 1, len(tw) - 1)
    f = np.clip((t - tw[i - 1]) / max(tw[i] - tw[i - 1], 1e-9), 0, 1)
    return p[i - 1] + (p[i] - p[i - 1]) * f


def summarise(run_dir, warm=10.0, every=10, window=0.2):
    cfg, g, w, e = load(run_dir)
    nv, nr, L, R, v0 = cfg["n_virtual"], cfg["n_real"], cfg["arena"], cfg["R"], cfg["speed"]
    u = L / 65536.0
    t, ok = g["t"], g["ok"].astype(bool)
    X, Y, H = g["x"] * u, g["y"] * u, g["h"] * (2 * np.pi / 65536.0)
    k_win = max(int(round(window * cfg["rate"])), 1)
    er, ev, ph = [], [], []
    n_drone, n_stall = 0, 0
    for k in range(len(t)):
        if t[k] < warm or k % every or k < k_win or not ok[k] or not ok[k - k_win]:
            continue
        x, y, h = X[k], Y[k], H[k]
        ph.append(abs(np.mean(np.exp(1j * h))))
        # drone positions at the END of the tick, as in the offline simulation (Sim 4)
        te = t[k] + 1.0 / cfg["rate"]
        p_now, p_then = _interp_p(w, te), _interp_p(w, te - window)
        for j in range(nr):
            d2 = (x - p_now[j, 0]) ** 2 + (y - p_now[j, 1]) ** 2
            d2[nv + j] = np.inf
            nb = d2 <= R * R
            if not nb.any():
                er.append(np.nan); continue
            m = math.atan2(np.sin(h[nb]).sum(), np.cos(h[nb]).sum())
            dr = p_now[j] - p_then[j]
            n_drone += 1
            if math.hypot(*dr) < 0.2 * v0 * window:      # held back: no direction of travel (counted separately)
                n_stall += 1
                er.append(np.nan); continue
            er.append(abs(_wrap(math.atan2(dr[1], dr[0]) - m)))
        for i in range(8):                       # virtual baseline, same measure
            d2 = (x - x[i]) ** 2 + (y - y[i]) ** 2
            d2[i] = np.inf
            nb = d2 <= R * R
            dv = np.array([x[i] - X[k - k_win, i], y[i] - Y[k - k_win, i]])
            if not nb.any() or math.hypot(*dv) < 0.2 * v0 * window:
                ev.append(np.nan); continue
            m = math.atan2(np.sin(h[nb]).sum(), np.cos(h[nb]).sum())
            ev.append(abs(_wrap(math.atan2(dv[1], dv[0]) - m)))
    er, ev, ph = np.degrees(np.array(er)), np.degrees(np.array(ev)), np.array(ph)
    # drones: spacing and the net
    tw, p = w["t"], w["p"]
    after = tw >= 2.0
    dd = p[after][:, :, None, :] - p[after][:, None, :, :]
    dist = np.hypot(dd[..., 0], dd[..., 1]) + np.eye(nr) * 1e9
    at_net = ((p <= 1e-6) | (p >= L - 1e-6)).any(axis=(1, 2))
    b = cfg["margin"]
    overshoot = float(np.maximum(np.maximum(b - p, p - (L - b)), 0).max())
    # loop timing
    dtk = np.diff(t) * 1e3
    rtt = g["rtt_us"][ok]
    modes = g["mode"]
    s = dict(
        ticks=int(len(t)), engine_replies_pct=float(100 * ok.mean()),
        align_real_deg=float(np.nanmean(er)) if len(er) else float("nan"),
        align_real_p90=float(np.nanpercentile(er, 90)) if len(er) else float("nan"),
        align_virtual_deg=float(np.nanmean(ev)) if len(ev) else float("nan"),
        drone_stalled_frac=float(n_stall / max(n_drone, 1)),
        phi=float(ph.mean()) if len(ph) else float("nan"),
        min_drone_dist_m=float(dist.min()), samples_at_net_edge=int(at_net.sum()), overshoot_m=overshoot,
        tick_ms_mean=float(dtk.mean()), tick_ms_p99=float(np.percentile(dtk, 99)), tick_ms_max=float(dtk.max()),
        rtt_us_p50=float(np.percentile(rtt, 50)) if len(rtt) else float("nan"),
        rtt_us_p99=float(np.percentile(rtt, 99)) if len(rtt) else float("nan"),
        rtt_us_max=float(rtt.max()) if len(rtt) else float("nan"),
        engine_compute_us_p50=float(np.percentile(e["compute_us"], 50)),
        engine_compute_us_p99=float(np.percentile(e["compute_us"], 99)),
        camera_age_ms_p50=float(np.percentile(g["age_ms"], 50)), camera_age_ms_p99=float(np.percentile(g["age_ms"], 99)),
        ticks_hold=int((modes == 1).sum()), ticks_hover=int((modes == 2).sum()), late_replies=int(g["late"][-1]),
        cmds_sent=int(len(t)), cmds_received=int(w["rx_cmds"]), cmds_lost_radio=int(w["lost_cmds"]),
    )
    # unplug: how fast do the drones slow down, and how fast do they recover
    for f in cfg.get("engine_faults", []):
        if f["kind"] == "unplug":
            sp = np.hypot(*(np.gradient(p, tw, axis=0)).transpose(2, 0, 1))      # (T, nr) speeds
            a, z = f["start"], f["start"] + f["dur"]
            during = (tw > a + cfg["hold_time"] + 0.5) & (tw < z)
            before = (tw > a - 3) & (tw < a)
            s.update(unplug_start=a, unplug_s=f["dur"],
                     speed_before_ms=float(sp[before].mean()), speed_during_ms=float(sp[during].mean()),
                     first_hover_tick_s=float(t[np.argmax(modes == 2)]) if (modes == 2).any() else float("nan"),
                     resumed_s=float(t[(t > z) & ok][0]) if ((t > z) & ok).any() else float("nan"))
    return s


def print_summary(s):
    print("\nGround-station run")
    print(f"  loop: {s['ticks']} ticks, interval {s['tick_ms_mean']:.2f} ms mean, {s['tick_ms_p99']:.2f} ms p99, "
          f"{s['tick_ms_max']:.2f} ms max")
    print(f"  engine: {s['engine_replies_pct']:.1f}% of steps answered, round trip {s['rtt_us_p50']:.0f} us median "
          f"({s['rtt_us_p99']:.0f} us p99), compute {s['engine_compute_us_p50']:.0f} us")
    print(f"  cameras: measurement age {s['camera_age_ms_p50']:.1f} ms median")
    print(f"  drones: misalignment {s['align_real_deg']:.1f} deg (virtual agents {s['align_virtual_deg']:.1f}), "
          f"closest pair {s['min_drone_dist_m']*100:.0f} cm, order {s['phi']:.2f}")
    print(f"  radio: {s['cmds_lost_radio']} of {s['cmds_received']} commands lost; hold ticks {s['ticks_hold']}, "
          f"hover ticks {s['ticks_hover']}")
    if "unplug_start" in s:
        print(f"  unplug at {s['unplug_start']} s for {s['unplug_s']} s: speed {s['speed_before_ms']:.2f} -> "
              f"{s['speed_during_ms']:.2f} m/s, hover from {s['first_hover_tick_s']:.2f} s, resumed {s['resumed_s']:.2f} s")


if __name__ == "__main__":
    print_summary(summarise(sys.argv[1] if len(sys.argv) > 1 else "gs_run"))

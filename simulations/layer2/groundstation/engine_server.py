"""The flock engine as a UDP server: a stand-in for the FPGA.

It runs liminal_sim.fixedpoint.step_walls, the integer model that fpga/rtl/vicsek_engine.v
(WALLS = 1) matches bit for bit, and speaks the protocol in protocol.py / PROTOCOL.md.
When the AXKU5 arrives, the FPGA takes this program's place: same packets, same port,
only the IP address in the ground station's settings changes.

Run on its own:  python -m groundstation.engine_server
"""
import time
import numpy as np

from groundstation.common import config, now, sleep_until, udp
from groundstation import protocol as P
from liminal_sim import fixedpoint as fp


def run_engine(cfg, t0=None):
    nv, nr = cfg["n_virtual"], cfg["n_real"]
    n = nv + nr
    wp = fp.WallParams(L=cfg["arena"], R=cfg["R"], speed=cfg["speed"], rate=cfg["rate"], eta=cfg["eta"],
                       margin=cfg["margin"], band=cfg["wall_band"], gain=cfg["wall_gain"])
    x, y, h, s = fp.init_walled(n, wp, cfg["seed"])
    init = np.stack([x, y, h, s]).copy()
    hm = np.zeros(n, dtype=np.int64)
    etaq = wp.etaq
    # warm up the compiled step on a copy, so the first real step is fast
    fp.step_walls(x.copy(), y.copy(), h.copy(), s.copy(), wp.rq2, wp.vq, etaq, wp.lo, wp.hi, wp.wlo, wp.whi, wp.wk, hm)

    sock = udp(cfg["engine_host"], cfg["engine_port"], timeout=0.05)
    rng = np.random.default_rng(cfg["seed"] + 101)
    faults = cfg.get("engine_faults", [])
    log_seq, log_t, log_first, log_wx, log_wy, log_eta, log_us, log_dropped = [], [], [], [], [], [], [], []
    t0 = t0 if t0 is not None else now()
    t_end = t0 + cfg["duration"] + 1.0
    step = 0
    while now() < t_end:
        try:
            buf, addr = sock.recvfrom(4096)
        except OSError:
            continue
        hd = P.parse_header(buf)
        if hd is None:
            continue
        ptype, seq, pay = hd
        tr = now() - t0
        if ptype == P.T_SET_PARAM:
            pid, val = P.unpack_set_param(pay)
            if pid == P.P_ETAQ:
                etaq = int(min(val, 65536))
            sock.sendto(P.pack_param_ack(seq, pid, val), addr)
            continue
        if ptype != P.T_STEP:
            continue
        if any(f["kind"] == "unplug" and f["start"] <= tr < f["start"] + f["dur"] for f in faults):
            log_dropped.append(tr)
            continue                                   # "cable pulled": no step, no reply
        flags, first, xs, ys = P.unpack_step(pay)
        ta = now()
        if flags & P.F_WRITE:
            x[first:first + len(xs)] = xs
            y[first:first + len(ys)] = ys
        fp.step_walls(x, y, h, s, wp.rq2, wp.vq, etaq, wp.lo, wp.hi, wp.wlo, wp.whi, wp.wk, hm)
        step += 1
        us = (now() - ta) * 1e6
        full = (x.tolist(), y.tolist(), h.tolist()) if flags & P.F_FULL else None
        reply = P.pack_step_reply(seq, P.ST_OK, step, h[first:first + len(xs)].tolist(), full)
        for f in faults:
            if f["kind"] == "delay" and rng.random() < f["prob"]:
                time.sleep(f["ms"] / 1000.0)
        sock.sendto(reply, addr)
        log_seq.append(seq); log_t.append(tr); log_first.append(first)
        log_wx.append(xs if flags & P.F_WRITE else [-1] * len(xs))
        log_wy.append(ys if flags & P.F_WRITE else [-1] * len(ys))
        log_eta.append(etaq); log_us.append(us)
    sock.close()
    return dict(init=init, seq=np.array(log_seq), t=np.array(log_t), first=np.array(log_first),
                wx=np.array(log_wx, dtype=np.int64).reshape(-1, nr), wy=np.array(log_wy, dtype=np.int64).reshape(-1, nr),
                etaq=np.array(log_eta), compute_us=np.array(log_us), dropped_t=np.array(log_dropped),
                wp=np.array([wp.rq2, wp.vq, wp.lo, wp.hi, wp.wlo, wp.whi, wp.wk]))


def process_main(cfg, t0, out_path):
    res = run_engine(cfg, t0)
    np.savez_compressed(out_path, **res)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Python stand-in for the FPGA flock engine")
    ap.add_argument("--duration", type=float, default=3600.0)
    ap.add_argument("--port", type=int, default=5005)
    a = ap.parse_args()
    cfg = config(duration=a.duration, engine_port=a.port, engine_host="0.0.0.0")
    print(f"engine listening on UDP {a.port} ({cfg['n_virtual']} virtual + {cfg['n_real']} drone slots); Ctrl+C to stop")
    run_engine(cfg)

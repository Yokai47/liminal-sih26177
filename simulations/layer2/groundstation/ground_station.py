"""The laptop's control loop: the program that will really run at the demo.

Every 20 ms (50 Hz):
  1. take the newest camera measurement of the 8 drones (POSE packets)
  2. send it to the flock engine (STEP), wait up to engine_timeout for the reply
  3. turn each drone's new heading into a velocity command at the flock speed
  4. add the safety layer: push apart any two drones closer than `separation`
  5. send the commands to the drones (CMD)
If the engine stops answering, the drones keep their last command for hold_time,
then hover in place (velocity 0) until the engine is back. The safety layer stays on.
"""
import math
import numpy as np

from groundstation.common import now, sleep_until, udp
from groundstation import protocol as P

MODE_RUN, MODE_HOLD, MODE_HOVER = 0, 1, 2


def safety_push(meas, sep, gain, v0):
    nr = meas.shape[0]
    d = meas[:, None, :] - meas[None, :, :]
    dist = np.hypot(d[..., 0], d[..., 1]) + np.eye(nr) * 1e9
    push = np.clip(sep - dist, 0, None) / sep
    return gain * v0 * (push[..., None] * d / dist[..., None]).sum(1)


def run_gs(cfg, t0):
    nv, nr, L, v0 = cfg["n_virtual"], cfg["n_real"], cfg["arena"], cfg["speed"]
    dt = 1.0 / cfg["rate"]
    pose_rx = udp(cfg["gs_host"], cfg["gs_pose_port"])
    pose_rx.setblocking(False)
    eng = udp(timeout=cfg["engine_timeout"])
    eng_addr = (cfg["engine_host"], cfg["engine_port"])
    cmd_tx = udp()
    world = (cfg["world_host"], cfg["world_cmd_port"])
    view = ("127.0.0.1", cfg["viewer_port"]) if cfg.get("viewer") else None
    ticks = int(cfg["duration"] * cfg["rate"])
    meas, meas_seq, meas_t = None, -1, 0.0
    last_c = np.zeros((nr, 2))
    miss = 0
    lg = {k: [] for k in ("t", "seq", "ok", "rtt_us", "age_ms", "mode", "c", "meas", "x", "y", "h", "late")}
    late = 0
    for k in range(ticks):
        sleep_until(t0 + k * dt)
        tk = now()
        # 1. newest camera measurement
        while True:
            try:
                buf = pose_rx.recv(2048)
            except (BlockingIOError, OSError):
                break
            hd = P.parse_header(buf)
            if hd and hd[0] == P.T_POSE and hd[1] > meas_seq:
                t_ns, xm, ym = P.unpack_pose(hd[2])
                meas, meas_seq, meas_t = np.c_[xm, ym] / 1000.0, hd[1], t_ns / 1e9
        if meas is None:
            continue
        # 2. engine step
        xq = np.clip(np.round(meas[:, 0] * 65536.0 / L), 0, 65535).astype(int).tolist()
        yq = np.clip(np.round(meas[:, 1] * 65536.0 / L), 0, 65535).astype(int).tolist()
        ts = now()
        eng.sendto(P.pack_step(k, nv, xq, yq, write=True, full=True), eng_addr)
        reply = None
        while True:
            try:
                buf = eng.recv(8192)
            except OSError:
                break                                   # timeout
            hd = P.parse_header(buf)
            if hd and hd[0] == P.T_STEP_REPLY:
                if hd[1] == k:
                    reply = P.unpack_step_reply(hd[2]); break
                late += 1                               # an old reply arriving late: ignore it
            if now() - ts > cfg["engine_timeout"]:
                break
        rtt = now() - ts
        # 3. headings -> velocity commands (or hold / hover when the engine is silent)
        if reply is not None:
            _, _, heads, full = reply
            th = np.array(heads) * (2 * math.pi / 65536.0)
            c = v0 * np.c_[np.cos(th), np.sin(th)]
            last_c, miss, mode = c, 0, MODE_RUN
        else:
            miss += 1
            if miss * dt <= cfg["hold_time"]:
                c, mode = last_c, MODE_HOLD
            else:
                c, mode = np.zeros((nr, 2)), MODE_HOVER
            full = None
        # 4. safety layer
        if cfg["separation"] > 0:
            c = c + safety_push(meas, cfg["separation"], cfg["sep_gain"], v0)
        sp = np.hypot(c[:, 0], c[:, 1])[:, None]
        c = np.where(sp > cfg["v_max"], c * cfg["v_max"] / np.maximum(sp, 1e-9), c)
        # 5. send to the drones
        cm = np.round(c * 1000).astype(int)
        cmd_tx.sendto(P.pack_cmd(k, cm[:, 0].tolist(), cm[:, 1].tolist()), world)
        if view and full is not None:
            cmd_tx.sendto(P.pack_view(k, nv, full[0], full[1], full[2], int(rtt * 1e6), 0, mode), view)
        lg["t"].append(tk - t0); lg["seq"].append(k); lg["ok"].append(reply is not None)
        lg["rtt_us"].append(rtt * 1e6); lg["age_ms"].append((tk - t0 - meas_t) * 1e3); lg["mode"].append(mode)
        lg["c"].append(c.copy()); lg["meas"].append(meas.copy())
        if full is not None:
            lg["x"].append(full[0]); lg["y"].append(full[1]); lg["h"].append(full[2])
        else:
            lg["x"].append([-1] * (nv + nr)); lg["y"].append([-1] * (nv + nr)); lg["h"].append([-1] * (nv + nr))
        lg["late"].append(late)
    pose_rx.close(); eng.close(); cmd_tx.close()
    out = {k: np.array(v) for k, v in lg.items()}
    return out


def process_main(cfg, t0, out_path):
    np.savez_compressed(out_path, **run_gs(cfg, t0))

"""The physical world, simulated: 8 drones and the motion-capture cameras.

Drones: each follows its velocity command with a first-order response (time
constant tau), limited acceleration and random disturbances; the same ASSUMED model as
liminal_sim/hybrid.py, integrated at 250 Hz in real time.
Cameras: measure every drone at cam_rate with a little noise and deliver the
measurement cam_latency later (POSE packets to the ground station).
Radio: velocity commands (CMD packets) arrive radio_latency after they are sent;
a fraction radio_loss is lost.

When the real rig exists, the cameras' software sends the POSE packets and the
drones' radio link receives the CMD packets; this program is no longer needed.
"""
import heapq
import math
import numpy as np

from groundstation.common import now, sleep_until, udp, takeoff_grid
from groundstation import protocol as P


def run_world(cfg, t0):
    nr, L = cfg["n_real"], cfg["arena"]
    rng = np.random.default_rng(cfg["seed"] + 202)
    p = takeoff_grid(nr, L, cfg["margin"])
    v = np.zeros((nr, 2))
    cmd = np.zeros((nr, 2))
    tau, amax, vn = cfg["tau"], cfg["a_max"], cfg["vel_noise"]
    rx = udp(cfg["world_host"], cfg["world_cmd_port"])
    rx.setblocking(False)
    tx = udp()
    gs = (cfg["gs_host"], cfg["gs_pose_port"])
    dt_phys, dt_cam = 1 / 250.0, 1 / cfg["cam_rate"]
    q = []                                     # (due time, counter, kind, data)
    cnt = 0
    log_t, log_p, log_cmd = [], [], []
    rx_cmds, lost_cmds = 0, 0
    sleep_until(t0)
    t_phys, t_cam, t_log = t0, t0, t0
    t_end = t0 + cfg["duration"]
    seq = 0
    while True:
        tn = now()
        if tn >= t_end:
            break
        # incoming commands -> scheduled after the radio delay (or lost)
        while True:
            try:
                buf = rx.recv(2048)
            except (BlockingIOError, OSError):
                break
            hd = P.parse_header(buf)
            if hd and hd[0] == P.T_CMD:
                rx_cmds += 1
                if rng.random() < cfg["radio_loss"]:
                    lost_cmds += 1
                    continue
                vx, vy = P.unpack_cmd(hd[2])
                heapq.heappush(q, (tn + cfg["radio_latency"], cnt, "cmd", np.c_[vx, vy] / 1000.0)); cnt += 1
        # due events
        while q and q[0][0] <= tn:
            _, _, kind, data = heapq.heappop(q)
            if kind == "cmd":
                cmd = data
            else:
                tx.sendto(data, gs)
        # physics, catching up in fixed 4 ms steps
        while t_phys + dt_phys <= tn:
            a = (cmd - v) / tau
            an = np.hypot(a[:, 0], a[:, 1])[:, None]
            a = np.where(an > amax, a * amax / np.maximum(an, 1e-12), a)
            v += a * dt_phys + rng.normal(0, vn * math.sqrt(dt_phys), v.shape)
            p += v * dt_phys
            p = np.clip(p, 0, L)            # the net
            t_phys += dt_phys
            if t_phys >= t_log:
                log_t.append(t_phys - t0); log_p.append(p.copy()); log_cmd.append(cmd.copy())
                t_log += 1 / 50.0
        # cameras
        if tn >= t_cam:
            meas = p + rng.normal(0, cfg["pos_noise"], p.shape)
            mm = np.round(meas * 1000).astype(int)
            pkt = P.pack_pose(seq, int((t_cam - t0) * 1e9), mm[:, 0].tolist(), mm[:, 1].tolist()); seq += 1
            heapq.heappush(q, (t_cam + cfg["cam_latency"], cnt, "pose", pkt)); cnt += 1
            t_cam += dt_cam
        nxt = min(t_phys + dt_phys, t_cam, q[0][0] if q else t_end)
        sleep_until(min(nxt, tn + 0.002))
    rx.close(); tx.close()
    return dict(t=np.array(log_t), p=np.array(log_p), cmd=np.array(log_cmd),
                rx_cmds=rx_cmds, lost_cmds=lost_cmds)


def process_main(cfg, t0, out_path):
    np.savez_compressed(out_path, **run_world(cfg, t0))

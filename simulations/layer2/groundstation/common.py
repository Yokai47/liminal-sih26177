"""Shared configuration and timing helpers for the ground-station processes."""
import os
import socket
import sys
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

DEFAULTS = dict(
    # flock (same as the recommended hybrid demo, Sim 4d)
    n_virtual=120, n_real=8, arena=4.0, R=0.5, speed=0.4, rate=50.0, eta=1.0,
    margin=0.3, wall_band=0.6, wall_gain=1.5, seed=1,
    # drones and cameras: ASSUMED until measured on the rig
    tau=0.3, a_max=3.0, vel_noise=0.05, pos_noise=0.003, v_max=1.0,
    cam_rate=100.0, cam_latency=0.010, radio_latency=0.020, radio_loss=0.0,
    # ground station
    separation=0.5, sep_gain=4.0, engine_timeout=0.008, hold_time=0.10,
    # faults injected into the engine link: list of dicts
    #   {"kind": "unplug", "start": s, "dur": s}       engine silent (no step, no reply)
    #   {"kind": "delay", "prob": p, "ms": d}           some replies arrive d ms late
    engine_faults=[],
    # network (all on this machine; the FPGA gets its own IP later)
    engine_host="127.0.0.1", engine_port=5005, gs_host="127.0.0.1", gs_pose_port=5006,
    world_host="127.0.0.1", world_cmd_port=5007, viewer_port=5008, viewer=False,
    # run
    duration=40.0, start_delay=4.0, out_dir="gs_run",
)


def config(**kw):
    c = dict(DEFAULTS)
    c.update(kw)
    return c


def now():
    return time.perf_counter()


def sleep_until(t):
    """Sleep until perf_counter() reaches t (coarse sleep, then a short spin)."""
    while True:
        d = t - time.perf_counter()
        if d <= 0:
            return
        time.sleep(d - 0.0006 if d > 0.0015 else 0)


def udp(bind_host=None, bind_port=None, timeout=None):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 20)
    if bind_port is not None:
        s.bind((bind_host or "127.0.0.1", bind_port))
    if timeout is not None:
        s.settimeout(timeout)
    return s


def takeoff_grid(n_real, arena, margin):
    """Same take-off layout as liminal_sim.hybrid.Hybrid."""
    import math
    import numpy as np
    cols = int(math.ceil(math.sqrt(n_real * 2)))
    rows = int(math.ceil(n_real / cols))
    gx = np.linspace(margin + 0.5, arena - margin - 0.5, cols)
    gy = np.linspace(margin + 0.5, arena - margin - 0.5, max(rows, 1) + 2)[1:-1]
    return np.array([(a, b) for b in gy for a in gx])[:n_real].astype(float)

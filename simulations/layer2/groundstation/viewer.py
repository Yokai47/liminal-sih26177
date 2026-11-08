"""Live window for the demo: the whole flock as the engine sees it.

Grey dots are virtual agents, blue arrows are the real drones, the dashed square
is the flock boundary inside the 4 x 4 m net. The title shows the engine round
trip and the loop state (RUN / HOLD / HOVER).
Started automatically by:  python -m groundstation.run_demo --viewer
"""
import math
import socket
import numpy as np

from groundstation.common import config
from groundstation import protocol as P

MODES = {0: "RUN", 1: "HOLD (engine late)", 2: "HOVER (engine lost)"}


def process_main(cfg):
    import matplotlib
    import matplotlib.pyplot as plt
    from matplotlib.animation import FuncAnimation
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", cfg["viewer_port"]))
    sock.setblocking(False)
    L, nv, b = cfg["arena"], cfg["n_virtual"], cfg["margin"]
    u = L / 65536.0
    fig, ax = plt.subplots(figsize=(7, 7))
    ax.set_xlim(0, L); ax.set_ylim(0, L); ax.set_aspect("equal")
    ax.plot([b, L - b, L - b, b, b], [b, b, L - b, L - b, b], "--", color="#999", lw=1)
    ax.set_xlabel("x (m)"); ax.set_ylabel("y (m)")
    virt = ax.scatter([], [], s=10, color="#9aa3ad")
    real = ax.quiver([], [], [], [], color="#1f5fd6", scale=12, width=0.008)
    title = ax.set_title("waiting for the ground station...")

    def update(_):
        nonlocal real
        latest = None
        while True:
            try:
                latest = sock.recv(8192)
            except (BlockingIOError, OSError):
                break
        if latest is None:
            return virt, real, title
        hd = P.parse_header(latest)
        if not hd or hd[0] != P.T_VIEW:
            return virt, real, title
        nv_, x, y, h, rtt_us, _, mode = P.unpack_view(hd[2])
        x, y = np.array(x) * u, np.array(y) * u
        th = np.array(h) * (2 * math.pi / 65536.0)
        virt.set_offsets(np.c_[x[:nv_], y[:nv_]])
        real.remove()
        real = ax.quiver(x[nv_:], y[nv_:], np.cos(th[nv_:]), np.sin(th[nv_:]), color="#1f5fd6", scale=12, width=0.008)
        phi = abs(np.mean(np.exp(1j * th)))
        title.set_text(f"tick {hd[1]}   order {phi:.2f}   engine round trip {rtt_us/1000:.2f} ms   {MODES.get(mode, '')}")
        return virt, real, title

    FuncAnimation(fig, update, interval=40, cache_frame_data=False)
    plt.show()


if __name__ == "__main__":
    process_main(config())

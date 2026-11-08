"""Short GIF animations for the README and website.
  results/figures/anim_flock_forms.gif   512 agents go from random to a flock
  results/figures/anim_hybrid.gif        8 'real' drones (blue) inside 4,088 virtual agents;
                                          halfway the noise is raised and the flock breaks up
"""
import io, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim.plotstyle import setup, INK, QUIET, ACCENT, GRID
from liminal_sim.vicsek import run_periodic, init_random, box_size
import matplotlib.pyplot as plt
from PIL import Image

setup()
F = "results/figures"


def to_img(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=80, facecolor="white")
    plt.close(fig)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def save_gif(frames, path, duration):
    # one shared palette for every frame, so colours stay stable in every viewer
    pal = frames[len(frames) // 2].quantize(colors=64, method=Image.Quantize.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
    q[0].save(path, save_all=True, append_images=q[1:], duration=duration, loop=0, disposal=1)


def flock_forms():
    n = 512; L = box_size(n, 2.0)
    x, y, th = init_random(n, L, 21)
    frames = []
    for k in range(90):
        phi = run_periodic(x, y, th, L, 1.0, 0.03, 0.8, 40 if k else 1, 21 + k)
        fig, ax = plt.subplots(figsize=(5, 5.4))
        ax.quiver(x, y, np.cos(th), np.sin(th), color=INK, alpha=0.8, scale=36, width=0.005, headwidth=3.5)
        ax.set_xlim(0, L); ax.set_ylim(0, L); ax.set_aspect("equal"); ax.set_xticks([]); ax.set_yticks([]); ax.grid(False)
        ax.set_title(f"512 agents, low noise   step {k*40:>4}   order {phi[-1]:.2f}", fontsize=10, loc="left")
        fig.text(0.98, 0.01, "SIMULATION", ha="right", fontsize=8, color=QUIET)
        frames.append(to_img(fig))
    save_gif(frames, f"{F}/anim_flock_forms.gif", 80)


def hybrid():
    d = np.load("results/data/exp4_showcase.npz")
    fr = d["frames"]; nv = int(d["n_virtual"]); L = float(d["arena"]); m = float(d["margin"]); sw = int(d["switch_frame"])
    frames = []
    for k in range(0, len(fr), 2):
        f = fr[k]
        fig, ax = plt.subplots(figsize=(5, 5.4))
        ax.scatter(f[:nv, 0], f[:nv, 1], s=(14 if nv < 500 else 1.2), color="#8b929c", linewidths=0)
        ax.scatter(f[nv:, 0], f[nv:, 1], s=36, color=ACCENT, edgecolors="white", linewidths=0.8, zorder=3)
        ax.plot([m, L - m, L - m, m, m], [m, m, L - m, L - m, m], color=GRID, lw=1, ls="--")
        ax.set_xlim(0, L); ax.set_ylim(0, L); ax.set_aspect("equal"); ax.set_xticks([]); ax.set_yticks([]); ax.grid(False)
        phase = "low noise: flocking" if k < sw else "noise raised: order breaks up"
        ax.set_title(f"{nv} virtual agents (grey) + 8 drones (blue), 4 x 4 m net\n{phase}   t = {k*5/50:.1f} s", fontsize=9.5, loc="left")
        fig.text(0.98, 0.01, "SIMULATION (drone behaviour assumed)", ha="right", fontsize=7.5, color=QUIET)
        frames.append(to_img(fig))
    save_gif(frames, f"{F}/anim_hybrid.gif", 70)


if __name__ == "__main__":
    flock_forms()
    if os.path.exists("results/data/exp4_showcase.npz"):
        hybrid()
    print([f for f in os.listdir(F) if f.endswith(".gif")])

"""One plotting style for every LIMINAL figure, so they read as one set."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import cm
import numpy as np

INK = "#1d1f24"
QUIET = "#6b7280"
GRID = "#e5e7eb"
GREY = "#9aa0a8"
ACCENT = "#1f5fd6"
GOOD = "#2e8b57"
BAD = "#c2410c"


def setup():
    plt.rcParams.update({
        "figure.dpi": 110, "savefig.dpi": 160, "font.size": 10.5, "font.family": "DejaVu Sans",
        "axes.edgecolor": QUIET, "axes.labelcolor": INK, "axes.titlecolor": INK,
        "xtick.color": QUIET, "ytick.color": QUIET, "axes.spines.top": False, "axes.spines.right": False,
        "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8, "legend.frameon": False,
        "axes.titlesize": 11, "axes.titleweight": "bold", "axes.titlelocation": "left",
    })


def blues(k):
    """k shades of the accent hue, light to dark (for ordered series such as flock size)."""
    return [cm.Blues(v) for v in np.linspace(0.35, 0.95, k)]


def finish(fig, title, subtitle, path, source="LIMINAL Layer 2 simulations"):
    import textwrap
    w = fig.get_size_inches()[0]
    sub = "\n".join(textwrap.wrap(subtitle, width=int(w * 12.5)))
    nlines = sub.count("\n") + 1
    fig.suptitle(title, x=0.012, y=0.995, ha="left", va="top", fontsize=13.5, fontweight="bold", color=INK)
    fig.text(0.012, 0.935, sub, ha="left", va="top", fontsize=10, color=QUIET, linespacing=1.35)
    fig.text(0.995, 0.995, "SIMULATION", ha="right", va="top", fontsize=8.5, color="white", fontweight="bold",
             bbox=dict(boxstyle="round,pad=0.35", fc=QUIET, ec="none"))
    fig.text(0.995, 0.005, source, ha="right", va="bottom", fontsize=7.5, color=QUIET)
    top = 0.9 - 0.055 * (nlines - 1) * (4.3 / fig.get_size_inches()[1])
    fig.tight_layout(rect=(0, 0.02, 1, top))
    fig.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close(fig)

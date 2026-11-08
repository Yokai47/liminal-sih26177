"""Draw every figure from the saved results (results/data -> results/figures).
Run after the experiments. Figures whose data is missing are skipped."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim.stats import merge_finite_size
from liminal_sim.plotstyle import setup, finish, blues, INK, QUIET, GREY, ACCENT, GOOD, BAD, GRID
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

D = "results/data"; F = "results/figures"
os.makedirs(F, exist_ok=True)
setup()


def load(name):
    p = os.path.join(D, name)
    return json.load(open(p)) if os.path.exists(p) else None


# ---------------------------------------------------------------- fig 1
def fig1():
    from liminal_sim.vicsek import run_periodic, init_random, box_size
    n = 512; L = box_size(n, 2.0)
    fig, axs = plt.subplots(1, 3, figsize=(11, 4.0))
    for ax, (eta, name) in zip(axs, [(1.0, "Low noise: one flock"), (2.6, "Near the peak: clusters form and break"),
                                     (4.5, "High noise: no order")]):
        x, y, th = init_random(n, L, 4)
        phi = run_periodic(x, y, th, L, 1.0, 0.03, eta, 8000, 4)
        pm = phi[-3000:].mean()
        ax.quiver(x, y, np.cos(th), np.sin(th), color=INK, alpha=0.75, scale=38, width=0.004, headwidth=3.5)
        ax.set_xlim(0, L); ax.set_ylim(0, L); ax.set_aspect("equal"); ax.set_xticks([]); ax.set_yticks([])
        ax.grid(False)
        for s in ax.spines.values():
            s.set_visible(True); s.set_color(GRID)
        ax.set_title(f"{name}\nnoise = {eta}, average order = {pm:.2f}", fontsize=10.5)
    finish(fig, "Noise alone decides whether the agents flock",
           "512 agents, each copying its neighbours' average heading plus random noise (2D Vicsek model). Arrows show headings.",
           f"{F}/fig1_flock_states.png")


# ---------------------------------------------------------------- fig 2
def fig2(d):
    acc = d["accuracy"]; sw = d["sweep"]
    fig, axs = plt.subplots(1, 2, figsize=(11, 4.2))
    ax = axs[0]
    for kind, col, mk in (("float", GREY, "o"), ("fixed", ACCENT, "s")):
        r = sorted([s for s in sw if s["kind"] == kind], key=lambda s: s["eta"])
        ax.plot([s["eta"] for s in r], [s["phi"] for s in r], marker=mk, color=col, lw=2,
                label="exact (floating point)" if kind == "float" else "FPGA arithmetic (16-bit integers)")
    ax.set_xlabel("noise eta (radians)"); ax.set_ylabel("order parameter")
    ax.set_title("Order: the two curves sit on top of each other"); ax.legend()
    ax = axs[1]
    for kind, col, mk in (("float", GREY, "o"), ("fixed", ACCENT, "s")):
        r = sorted([s for s in sw if s["kind"] == kind], key=lambda s: s["eta"])
        ax.plot([s["eta"] for s in r], [s["chi"] for s in r], marker=mk, color=col, lw=2)
    ax.set_xlabel("noise eta (radians)"); ax.set_ylabel("susceptibility  N * var(order)")
    ax.set_title("Fluctuations: same peak in both")
    finish(fig, "The FPGA's integer maths behaves like the exact model",
           f"512 agents. One-step heading error of the integer version: median {acc['median_deg']:.3f} deg, "
           f"worst {acc['max_deg']:.2f} deg over {acc['agents_compared']:,} agents; neighbour sets identical.",
           f"{F}/fig3_fixed_vs_float.png")


# ---------------------------------------------------------------- fig 3
def fig3(d):
    rows = d["rows"]; ns = sorted({r["n"] for r in rows}); cols = blues(len(ns))
    fig, axs = plt.subplots(1, 3, figsize=(13, 4.3), gridspec_kw=dict(width_ratios=[1, 1, 0.8]))
    peaks = []
    for n, c in zip(ns, cols):
        r = sorted([q for q in rows if q["n"] == n], key=lambda q: q["eta"])
        e = np.array([q["eta"] for q in r]); p = np.array([q["phi"] for q in r]); x = np.array([q["chi"] for q in r])
        axs[0].plot(e, p, color=c, lw=2, label=f"N = {n:,}")
        axs[1].plot(e, x, color=c, lw=2)
        k = int(np.argmax(x)); peaks.append((n, e[k], x[k]))
        axs[1].plot([e[k]], [x[k]], "o", color=c, ms=5)
    axs[0].set_xlabel("noise eta"); axs[0].set_ylabel("order parameter"); axs[0].legend(fontsize=9)
    axs[0].set_title("Order falls as noise rises")
    axs[1].set_xlabel("noise eta"); axs[1].set_ylabel("susceptibility  N * var(order)"); axs[1].set_yscale("log")
    axs[1].set_title("The fluctuation peak grows and sharpens")
    pn = np.array([p[0] for p in peaks]); px = np.array([p[2] for p in peaks])
    axs[2].loglog(pn, px, "o-", color=ACCENT, lw=2)
    for n, e, x in peaks:
        if n == 8:
            continue
        axs[2].annotate(f"peak at eta {e:.2f}", (n, x), textcoords="offset points", xytext=(7, -4), fontsize=8, color=QUIET)
    axs[2].set_xlabel("flock size N"); axs[2].set_ylabel("peak susceptibility"); axs[2].set_title("Peak height vs flock size")
    axs[2].text(0.04, 0.70, "N = 8: only a plateau,\nbarely above the random\nlevel (0.20)", transform=axs[2].transAxes,
                fontsize=8, color=QUIET)
    big = [q["seeds"] for q in rows if q["n"] >= 2048 and q["eta"] <= 2.8]
    reps = (f"Near the peak, 2,048 and 4,096 points average {min(big)}-{max(big)} runs each; their peak position is still uncertain by a few tenths in noise."
            if big and min(big) > 1 else "Peaks for 2,048 and 4,096 are noisy (one run each); their position is uncertain by about 0.3.")
    finish(fig, "Eight agents have no clear fluctuation peak; thousands have a tall, sharp one",
           "2D Vicsek model at constant density (2 agents per R^2), long runs averaged over 1-4 seeds. A finite flock has no true "
           "phase transition, only a fluctuation peak that sharpens and moves to lower noise as N grows. " + reps,
           f"{F}/fig2_finite_size.png")
    return peaks


# ---------------------------------------------------------------- fig 4
def _heat(ax, B, label, lats, losses, vmin, vmax, title, cmap):
    M = np.full((len(losses), len(lats)), np.nan)
    for i, lo in enumerate(losses):
        for j, la in enumerate(lats):
            v = [r["align_real_deg"] for r in B if r["label"] == label and r["latency"] == la and r["loss"] == lo]
            if v:
                M[i, j] = np.mean(v)
    ax.imshow(M, origin="lower", cmap=cmap, vmin=vmin, vmax=vmax, aspect="auto")
    for i in range(len(losses)):
        for j in range(len(lats)):
            ax.text(j, i, f"{M[i, j]:.0f}", ha="center", va="center", fontsize=9,
                    color="white" if M[i, j] > (vmin + vmax) / 2 else INK)
    ax.set_xticks(range(len(lats))); ax.set_xticklabels([f"{int(l*1000)}" for l in lats])
    ax.set_yticks(range(len(losses))); ax.set_yticklabels([f"{int(l*100)}%" for l in losses])
    ax.set_xlabel("loop latency (ms)"); ax.set_ylabel("command packets lost"); ax.grid(False)
    vb = np.nanmean([r["align_virtual_deg"] for r in B if r["label"] == label])
    ax.set_title(title + f"\nreal-drone misalignment, deg (virtual agents: {vb:.0f})", fontsize=10)


def fig4(d, dk, dr):
    """Which hybrid set-up works: dense radius rule, dense 7-nearest rule, realistic density."""
    fig, axs = plt.subplots(1, 2, figsize=(12.5, 4.5), gridspec_kw=dict(width_ratios=[1.25, 1]))
    ax = axs[0]
    def curve(A, key="eta"):
        g = {}
        for r in A:
            g.setdefault(r[key], []).append(r["phi"])
        e = sorted(g)
        return e, [np.mean(g[k]) for k in e]
    e, p = curve(d["A"]); ax.plot(e, p, "o-", color=GREY, lw=2, label="1,032 agents, everyone within 0.5 m")
    e, p = curve(dk["A"]); ax.plot(e, p, "^-", color="#b7bcc4", lw=2, label="1,032 agents, 7 nearest")
    e, p = curve(dr["A"]); ax.plot(e, p, "s-", color=ACCENT, lw=2.4, label="128 agents, everyone within 0.5 m")
    ee = np.linspace(0.05, 5, 200)
    ax.plot(ee, np.sin(ee / 2) / (ee / 2), ":", color=INK, lw=1.2, label="ceiling: every agent's own noise only")
    ax.set_xlabel("noise eta"); ax.set_ylabel("order parameter"); ax.set_ylim(0, 1.02); ax.legend(fontsize=8.5, loc="upper right")
    ax.set_title("Order vs noise in the 4 x 4 m net", fontsize=10)
    ax = axs[1]
    rows = [("1,032, radius", [r for r in d["A"] if r["eta"] == 1.0]),
            ("1,032, 7 nearest", [r for r in dk["A"] if r["eta"] <= 0.55]),
            ("128, radius", [r for r in dr["A"] if r["eta"] == 1.0])]
    x = np.arange(len(rows)); w = 0.36
    rv = [np.mean([r["align_real_deg"] for r in rs]) for _, rs in rows]
    vv = [np.mean([r["align_virtual_deg"] for r in rs]) for _, rs in rows]
    ax.bar(x - w / 2, vv, w, color="#c9cdd3", label="virtual agents")
    ax.bar(x + w / 2, rv, w, color=[GREY, BAD, ACCENT], label="real drones")
    for xi, a, b in zip(x, vv, rv):
        ax.text(xi - w / 2, a + 0.6, f"{a:.0f}", ha="center", fontsize=8.5, color=INK)
        ax.text(xi + w / 2, b + 0.6, f"{b:.0f}", ha="center", fontsize=8.5, color=INK)
    ax.set_xticks(x); ax.set_xticklabels([r[0] for r in rows], fontsize=9); ax.set_ylabel("misalignment at low noise (deg)")
    from matplotlib.patches import Patch
    ax.legend(handles=[Patch(color="#c9cdd3", label="virtual agents (left bar)"), Patch(color=INK, label="real drones (right bar)")],
              fontsize=8.5, loc="upper left")
    ax.set_ylim(0, max(rv) * 1.3)
    ax.set_title("Can the real drones keep up?", fontsize=10)
    finish(fig, "Thousands of agents cannot share a 4 x 4 m net with real drones; about 128 can",
           "Packed in with a 0.5 m radius, 1,032 agents keep one common heading at any noise: their order stays at the ceiling set by each agent's own noise. With the 7-nearest rule they never order, and "
           "neighbours sit ~10 cm apart, too close for a drone needing ~0.3 s to respond. At 128 agents (2 per R^2 over the net) "
           "the flock has a clear transition and the drones keep up. Drone behaviour ASSUMED.", f"{F}/fig5_hybrid_setup.png")


def fig4b(dr):
    cmap = LinearSegmentedColormap.from_list("blu", ["#eef4fc", "#9cc1ee", "#1f5fd6", "#0b2a66"])
    B = dr["B"]; lats = sorted({r["latency"] for r in B}); losses = sorted({r["loss"] for r in B})
    fig, axs = plt.subplots(1, 2, figsize=(11.5, 4.4))
    for ax, tag, nm in ((axs[0], "B-ordered", "Ordered flock (eta 1.0)"), (axs[1], "B-near-peak", f"At the fluctuation peak (eta {dr['eta_peak']:.2f})")):
        vals = [r["align_real_deg"] for r in B if r["label"] == tag]
        _heat(ax, B, tag, lats, losses, min(vals), max(vals), nm, cmap)
    finish(fig, "Keep the control loop under about 100 ms; lost packets matter less",
           "128-agent hybrid (120 virtual + 8 simulated drones), 4 x 4 m net, 50 Hz loop, mean of 3 runs per cell. Misalignment = angle "
           "between where a drone went over 0.2 s and its neighbours' heading. Drone behaviour ASSUMED (0.3 s response, 3 m/s^2, "
           "0.05 m/s disturbance, 3 mm camera noise). Each panel has its own colour scale.", f"{F}/fig6_latency_loss.png")


def fig7(dr):
    C = [r for r in dr["C"] if r["label"].startswith("C-")]
    D = [r for r in dr["C"] if r["label"] == "D-safety"]
    fig, axs = plt.subplots(1, 2, figsize=(12.5, 4.4), gridspec_kw=dict(width_ratios=[1.25, 1]))
    ax = axs[0]
    names = {"C-embodied-command": "baseline: flock feels the measured drone",
             "C-embodied-measured": "heading taken from camera velocity",
             "C-puppet": "puppet: drone chases an ideal twin",
             "C-hard-walls": "hard walls instead of soft walls"}
    groups = {}
    for r in C:
        lab = r["label"]
        if lab == "C-tau":
            lab = f"assumed response time {r['tau']} s"
        elif lab == "C-disturbance":
            lab = f"assumed disturbance {r['vel_noise']} m/s"
        else:
            lab = names[lab]
        groups.setdefault(lab, []).append(r)
    labels = list(groups)
    vals = [np.mean([r["align_real_deg"] for r in groups[l]]) for l in labels]
    outside = [int(round(np.mean([r["ticks_outside_net"] for r in groups[l]]))) for l in labels]
    cols = [ACCENT if l.startswith("baseline") else (BAD if "hard walls" in l else GREY) for l in labels]
    y = np.arange(len(labels))[::-1]
    ax.barh(y, vals, color=cols, height=0.62)
    for yi, v, o in zip(y, vals, outside):
        ax.text(v + 0.4, yi, f"{v:.0f}" + (f"   outside the net {o} ticks" if o else ""), va="center", fontsize=8.5, color=INK)
    ax.set_yticks(y); ax.set_yticklabels(labels, fontsize=8.5); ax.set_xlabel("real-drone misalignment (deg)")
    ax.set_xlim(0, max(vals) * 1.75)
    ax.set_title("Response time matters most; hard walls let drones hit the net", fontsize=10)
    ax = axs[1]
    seps = sorted({r["separation"] for r in D})
    md = [np.mean([r["min_drone_dist_m"] for r in D if r["separation"] == s]) for s in seps]
    mn = [np.min([r["min_drone_dist_m"] for r in D if r["separation"] == s]) for s in seps]
    mis = [np.mean([r["align_real_deg"] for r in D if r["separation"] == s]) for s in seps]
    x = np.arange(len(seps))
    ax.bar(x, [m * 100 for m in mn], color=[BAD if m < 0.25 else ACCENT for m in mn], width=0.55)
    for xi, m, a in zip(x, mn, mis):
        ax.text(xi, m * 100 + 1.5, (f"{m*100:.1f}" if m < 0.05 else f"{m*100:.0f}") + f" cm\nmisalign {a:.0f} deg", ha="center", fontsize=8.5, color=INK)
    ax.set_xticks(x); ax.set_xticklabels(["off" if s == 0 else f"{s} m" for s in seps], fontsize=9)
    ax.set_xlabel("safety layer: push real drones apart when closer than")
    ax.set_ylabel("closest two real drones came (cm)"); ax.set_ylim(0, max(mn) * 100 * 1.5)
    ax.set_title("Without a safety layer, real drones collide", fontsize=10)
    finish(fig, "Drone response time and spacing decide whether the demo is safe and convincing",
           "128-agent hybrid, ordered flock, 40 ms latency, 3 runs each. Left: misalignment for each design option (drone parameters "
           "ASSUMED). Right: worst closest approach between any two real drones in 40 s, for different safety-layer settings.",
           f"{F}/fig7_design_safety.png")


# ---------------------------------------------------------------- fig 8
def fig8(d):
    """Repulsion for every agent, and local vs global order (Sim 4e)."""
    A = d["A"]; B = d["B"]
    def grp(**kw):
        return [r for r in A if all(r.get(k) == v for k, v in kw.items())]
    def mean(rs, k):
        return float(np.mean([r[k] for r in rs]))
    fig, axs = plt.subplots(1, 3, figsize=(14, 4.5), gridspec_kw=dict(width_ratios=[1.15, 0.95, 1.05]))
    # (a) trade-off: safety-layer workload vs excess drone misalignment
    ax = axs[0]
    so = grp(variant="safety only")
    ex = lambda rs: mean(rs, "align_real_deg") - mean(rs, "align_virtual_deg")
    ax.plot([mean(so, "safety_active_frac") * 100], [ex(so)], "o", color=ACCENT, ms=9, zorder=3)
    ax.annotate("safety layer only\n(current design)", (mean(so, "safety_active_frac") * 100, ex(so)), textcoords="offset points",
                xytext=(-30, 42), ha="center", fontsize=8.5, color=ACCENT,
                arrowprops=dict(arrowstyle="-", color=ACCENT, lw=0.8))
    for ign, col, mk, lab in ((False, GREY, "s", "repulsion between all agents"), (True, INK, "^", "same, drones ignore virtual agents")):
        for g, fill in ((1.0, "full"), (2.0, "none")):
            pts = []
            for r_ in (0.2, 0.3, 0.4, 0.5):
                rs = grp(variant="safety + repulsion" + (", drones ignore virtual" if ign else ""), repulsion=r_, rep_gain=g)
                pts.append((mean(rs, "safety_active_frac") * 100, ex(rs), r_))
            ax.plot([p[0] for p in pts], [p[1] for p in pts], marker=mk, color=col, lw=1.3, ms=6, fillstyle=fill,
                    markerfacecolor=col if fill == "full" else "white", label=f"{lab}, gain {g:.0f}")
            if not ign and g == 2.0:
                for x_, y_, r_ in pts:
                    ax.annotate(f"{r_} m", (x_, y_), textcoords="offset points", xytext=(6, -3), fontsize=7.5, color=QUIET)
    ax.set_xlabel("time the drone safety layer had to push (%)"); ax.set_ylabel("drone misalignment above virtual agents' (deg)")
    ax.set_title("Repulsion saves the safety layer work\nonly by costing alignment", fontsize=10)
    ax.legend(fontsize=7.5, loc="upper right")
    # (b) closest approach
    ax = axs[1]
    cases = [("nothing", grp(variant="nothing")),
             ("repulsion only\n0.4 m, gain 1", grp(variant="repulsion only", repulsion=0.4, rep_gain=1.0)),
             ("repulsion only\n0.5 m, gain 5", grp(variant="repulsion only", repulsion=0.5, rep_gain=5.0)),
             ("safety layer only", so),
             ("safety + mild\nrepulsion 0.3 m", grp(variant="safety + repulsion, drones ignore virtual", repulsion=0.3, rep_gain=1.0))]
    y = np.arange(len(cases))[::-1]
    mn = [min(r["min_drone_dist_m"] for r in rs) * 100 for _, rs in cases]
    mis = [mean(rs, "align_real_deg") for _, rs in cases]
    ax.set_axisbelow(True)
    ax.barh(y, mn, color=[BAD if v < 25 else ACCENT for v in mn], height=0.6)
    for yi, v, m in zip(y, mn, mis):
        ax.text(v + 1, yi, (f"{v:.1f}" if v < 5 else f"{v:.0f}") + f" cm,  misalign {m:.0f} deg", va="center", fontsize=8.5, color=INK)
    ax.set_yticks(y); ax.set_yticklabels([c[0] for c in cases], fontsize=8.5)
    ax.set_xlim(0, max(mn) * 2.1); ax.set_xlabel("closest two real drones came (cm, worst of 6 runs)")
    ax.set_title("Repulsion alone does not keep drones apart", fontsize=10)
    # (c) global vs local order
    ax = axs[2]
    for v, ls in (("no repulsion", "-"), ("mild repulsion", "--")):
        rs = [r for r in B if r["variant"] == v]
        es = sorted({r["eta"] for r in rs})
        g_ = [np.mean([r["phi"] for r in rs if r["eta"] == e]) for e in es]
        l_ = [np.mean([r["phi_local"] for r in rs if r["eta"] == e]) for e in es]
        ax.plot(es, g_, ls, color=GREY, lw=2, label=f"whole-flock order, {v}")
        ax.plot(es, l_, ls, color=ACCENT, lw=2, label=f"local order, {v}")
    ax.axhline(0.29, color=QUIET, lw=1, ls=":")
    ax.text(0.6, 0.31, "random headings still score ~0.29 locally\n(each agent sees only ~9 neighbours)", fontsize=8, color=QUIET)
    ax.set_xlabel("noise eta"); ax.set_ylabel("order"); ax.set_ylim(0, 1.02); ax.legend(fontsize=7.5, loc="upper right")
    ax.set_title("With soft walls, the two order measures agree\nwhile the flock is ordered", fontsize=10)
    finish(fig, "Two ideas tested and set aside: repulsion for every agent, and a local order measure",
           "128-agent hybrid (120 virtual + 8 drones), 4 x 4 m net, 40 ms latency. Left and middle: noise 1.0, 6 runs of 40 s per setting. "
           "Right: 3 runs per point. Drone parameters ASSUMED.", f"{F}/fig10_repulsion_local_order.png")


# ---------------------------------------------------------------- fig 9
def fig9(d):
    """Floating-point demo flock vs the FPGA's integer engine (v1.1), Sim 7."""
    A, B = d["A"], d["B"]
    es = sorted({r["eta"] for r in A})
    m = lambda eng, k: [np.mean([r[k] for r in A if r["engine"] == eng and r["eta"] == e]) for e in es]
    fig, axs = plt.subplots(1, 2, figsize=(12, 4.4))
    ax = axs[0]
    ax.plot(es, m("float", "phi"), "-", color=GREY, lw=2.4, label="exact model (floating point)")
    ax.plot(es, m("fixed", "phi"), "o", color=ACCENT, ms=5, label="FPGA integer engine")
    ax.set_xlabel("noise eta"); ax.set_ylabel("order parameter"); ax.set_ylim(0, 1.02); ax.legend(fontsize=9)
    ax.set_title("Order of the whole demo flock", fontsize=10)
    ax = axs[1]
    ax.plot(es, m("float", "align_real_deg"), "-", color=GREY, lw=2.4, label="real drones, exact model")
    ax.plot(es, m("fixed", "align_real_deg"), "o", color=ACCENT, ms=5, label="real drones, FPGA engine")
    ax.plot(es, m("float", "align_virtual_deg"), "--", color=GREY, lw=1.6, label="virtual agents, exact model")
    ax.plot(es, m("fixed", "align_virtual_deg"), "s", color=ACCENT, ms=4, fillstyle="none", label="virtual agents, FPGA engine")
    ax.set_xlabel("noise eta"); ax.set_ylabel("misalignment (deg)"); ax.legend(fontsize=8.5)
    ax.set_title("How closely the drones follow the flock", fontsize=10)
    q = lambda eng, k, f=np.mean: f([r[k] for r in B if r["engine"] == eng])
    finish(fig, "The FPGA's integer engine flies the demo flock like the exact model",
           f"120 virtual + 8 simulated drones, 4 x 4 m net, safety layer on, 3 runs per point. Ordered flock (noise 1.0, 6 runs): "
           f"drone misalignment {q('float', 'align_real_deg'):.1f} vs {q('fixed', 'align_real_deg'):.1f} deg, closest drones "
           f"{q('float', 'min_drone_dist_m', np.min)*100:.0f} vs {q('fixed', 'min_drone_dist_m', np.min)*100:.0f} cm (exact vs FPGA).",
           f"{F}/fig4_fixed_hybrid.png")


# ---------------------------------------------------------------- fig 10
def fig10(d, nominal_dir, unplug_dir):
    """The demo loop over UDP in real time (Sim 8)."""
    import json as _json
    runs = d["runs"]
    fig, axs = plt.subplots(1, 3, figsize=(15, 4.6), gridspec_kw=dict(width_ratios=[1.25, 1.0, 1.0]))
    # (a) misalignment per scenario
    ax = axs[0]
    names, real, virt = [], [], []
    for nm in dict.fromkeys(r["scenario"] for r in runs):
        rs = [r for r in runs if r["scenario"] == nm]
        names.append(nm + (f"\n({len(rs)} runs)" if len(rs) > 1 else ""))
        real.append(np.mean([r["align_real_deg"] for r in rs])); virt.append(np.mean([r["align_virtual_deg"] for r in rs]))
    yy = np.arange(len(names))[::-1]
    ax.set_axisbelow(True)
    ax.barh(yy + 0.18, real, height=0.36, color=ACCENT, label="real drones")
    ax.barh(yy - 0.18, virt, height=0.36, color=GREY, label="virtual agents")
    for yi, v in zip(yy, real):
        ax.text(v + 0.5, yi + 0.18, f"{v:.1f}", va="center", fontsize=8.5, color=INK)
    _d7 = load("exp7_fixed_hybrid.json")
    off = float(np.mean([r["align_real_deg"] for r in _d7["B"] if r["engine"] == "fixed"]))
    ax.axvline(off, color=INK, lw=1, ls=":")
    ax.text(off + 0.3, yy[0] + 0.62, f"offline simulation: {off:.1f}", fontsize=8, color=QUIET)
    ax.set_yticks(yy); ax.set_yticklabels(names, fontsize=8.5); ax.set_xlabel("misalignment (deg)")
    ax.set_xlim(0, max(real) * 1.45)
    ax.legend(fontsize=8, loc="lower right"); ax.set_title("Drones follow the flock as offline,\nand degrade gently", fontsize=10)
    # (b) loop timing, nominal run (both in ms on one axis)
    ax = axs[1]
    g = np.load(os.path.join(nominal_dir, "gs.npz"))
    jit = np.abs(np.diff(g["t"]) * 1e3 - 20.0)
    rtt = g["rtt_us"][g["ok"].astype(bool)] / 1e3
    bins = np.linspace(0, 1.6, 65)
    ax.hist(np.clip(jit, 0, 1.6), bins=bins, color=GREY, alpha=0.9, label=f"tick timing error (|interval - 20 ms|; worst {jit.max():.1f} ms, drawn at 1.6)")
    ax.hist(rtt, bins=bins, color=ACCENT, alpha=0.75, label="engine round trip over UDP")
    ax.set_yscale("log"); ax.set_xlabel("milliseconds"); ax.set_ylabel("ticks (log scale)")
    ax.legend(fontsize=8, loc="upper right")
    ax.set_title(f"Timing: ticks within {np.percentile(jit, 99):.2f} ms of 20 ms (p99),\n"
                 f"engine answers in {np.median(rtt):.2f} ms (median)", fontsize=10)
    # (c) unplug timeline
    ax = axs[2]
    if unplug_dir and os.path.exists(os.path.join(unplug_dir, "world.npz")):
        w = np.load(os.path.join(unplug_dir, "world.npz")); gu = np.load(os.path.join(unplug_dir, "gs.npz"))
        cfgu = _json.load(open(os.path.join(unplug_dir, "config.json")))
        f = cfgu["engine_faults"][0]
        sp = np.hypot(*(np.gradient(w["p"], w["t"], axis=0)).transpose(2, 0, 1)).mean(1)
        sel = (w["t"] > f["start"] - 4) & (w["t"] < f["start"] + f["dur"] + 5)
        ax.axvspan(f["start"], f["start"] + f["dur"], color=BAD, alpha=0.12, lw=0)
        ax.text(f["start"] + 0.1, 0.62, "engine\nunplugged", fontsize=8, color=BAD, va="top")
        m = gu["mode"]; tg = gu["t"]
        hov = tg[m == 2]
        if len(hov):
            ax.axvspan(hov.min(), hov.max(), color=GREY, alpha=0.15, lw=0)
            ax.text(hov.min() + 0.1, 0.05, "drones hover", fontsize=8, color=QUIET)
        ax.plot(w["t"][sel], sp[sel], color=ACCENT, lw=1.6)
        ax.axhline(cfgu["speed"], color=INK, lw=0.8, ls=":")
        ax.set_ylim(0, 0.7); ax.set_xlabel("time (s)"); ax.set_ylabel("mean drone speed (m/s)")
        ax.set_title(f"Engine silent for {f['dur']:.0f} s: drones hold {cfgu['hold_time']*1000:.0f} ms,\n"
                     "then hover, then rejoin the flock", fontsize=10)
    finish(fig, "The demo loop over UDP, in real time: engine, drones and ground station as separate programs",
           "Engine = the FPGA's integer model as a UDP server; drones and cameras simulated (ASSUMED response); "
           "50 Hz control loop, 40 s per run, camera 10 ms and radio 20 ms latency unless stated.",
           f"{F}/fig11_groundstation.png")


# ---------------------------------------------------------------- fig 11
def fig11(d):
    """Topology layer and exploration (Sim 9)."""
    ex = np.load(os.path.join(D, "exp9_example.npz"))
    E = d["episodes"]; X = d["example"]
    fig = plt.figure(figsize=(15.5, 4.9))
    gs_ = fig.add_gridspec(1, 3, width_ratios=[1.45, 1, 0.85])
    ax = fig.add_subplot(gs_[0])
    solid, labels = ex["solid"], ex["labels"]
    res = 0.1
    ext = (0, solid.shape[1] * res, 0, solid.shape[0] * res)
    rng_ = np.random.default_rng(3)
    pal = rng_.uniform(0.80, 0.97, (labels.max() + 2, 3)); pal[:, 2] = np.clip(pal[:, 2] + 0.03, 0, 1)
    img = np.ones(solid.shape + (3,))
    m = labels >= 0
    img[m] = pal[labels[m]]
    img[solid] = [0.15, 0.17, 0.2]
    ax.imshow(img, origin="lower", extent=ext, interpolation="nearest")
    rooms = ex["rooms"]
    for dd in ex["doors"]:
        a, b, cy, cx = int(dd[0]), int(dd[1]), dd[2], dd[3]
        for k in (a, b):
            ax.plot([rooms[k][1] * res, cx * res], [rooms[k][0] * res, cy * res], color=ACCENT, lw=1.1)
        ax.plot(cx * res, cy * res, "s", color=ACCENT, ms=3.5)
    ax.plot(rooms[:, 1] * res, rooms[:, 0] * res, "o", color=ACCENT, ms=5, mec="white", mew=0.8)
    for pk in ex["pockets"]:
        ax.contour(pk.astype(float), levels=[0.5], colors=[BAD], linewidths=1.2, origin="lower", extent=ext)
    v = ex["victims"]
    ax.plot(v[v[:, 2] == 0][:, 1] * res, v[v[:, 2] == 0][:, 0] * res, "*", color="#e8a400", ms=11, mec=INK, mew=0.5, label="victim, open")
    ax.plot(v[v[:, 2] == 1][:, 1] * res, v[v[:, 2] == 1][:, 0] * res, "*", color=BAD, ms=11, mec=INK, mew=0.5, label="victim, in a pocket")
    ax.set_xlabel("x (m)"); ax.set_ylabel("y (m)"); ax.legend(fontsize=8, loc="lower right", framealpha=0.9)
    ax.set_title(f"Room graph: {X['rooms']} rooms, {X['doors']} doorways = {X['graph_bytes']} bytes\n"
                 f"(map: {X['grid_bytes_raw']/1000:.0f} KB raw, {X['grid_bytes_zlib']/1000:.1f} KB compressed); "
                 f"b0 = {X['betti0']}, b1 = {X['betti1']}", fontsize=10)
    # victims found over time
    ax = fig.add_subplot(gs_[1])
    T = np.arange(0, 601)
    names = {"nearest": "nearest frontier", "utility": "utility (gain / distance)",
             "topology": "utility + pockets", "nearest_pockets": "nearest + pockets"}
    cols = {"nearest": GREY, "utility": INK, "topology": "#7a5af5", "nearest_pockets": ACCENT}
    pols = [p for p in ("nearest", "utility", "topology", "nearest_pockets") if any(e["policy"] == p for e in E)]
    for pol in pols:
        ep = [e for e in E if e["policy"] == pol]
        allc = np.mean([np.interp(T, e["hist_t"], np.array(e["hist_found"]) / e["n_victims"], right=e["hist_found"][-1] / e["n_victims"]) for e in ep], 0)
        pkc = np.mean([np.array([(np.array(e["t_found_pocket"]) <= tt).sum() for tt in T]) / max(e["n_pocket_victims"], 1) for e in ep], 0)
        ax.plot(T, allc * 100, color=cols[pol], lw=2, label=names[pol])
        ax.plot(T, pkc * 100, color=cols[pol], lw=1.4, ls="--")
    ax.set_xlabel("time (s)"); ax.set_ylabel("victims found (%)"); ax.set_ylim(0, 100)
    ax.legend(fontsize=8, loc="lower right"); ax.set_title("All victims (solid) and pocket victims (dashed),\nmean of 30 maps", fontsize=10)
    # summary bars
    ax = fig.add_subplot(gs_[2])
    found = [np.mean([e["found"] / e["n_victims"] for e in E if e["policy"] == p]) * 100 for p in pols]
    fpk = [np.mean([e["found_pocket"] / max(e["n_pocket_victims"], 1) for e in E if e["policy"] == p]) * 100 for p in pols]
    yy = np.arange(len(pols))[::-1]
    ax.barh(yy + 0.18, found, height=0.36, color=[cols[p] for p in pols], alpha=0.95)
    ax.barh(yy - 0.18, fpk, height=0.36, color=[cols[p] for p in pols], alpha=0.45)
    for yi, a_, b_ in zip(yy, found, fpk):
        ax.text(a_ + 1, yi + 0.18, f"{a_:.0f}% all", va="center", fontsize=8)
        ax.text(b_ + 1, yi - 0.18, f"{b_:.0f}% in pockets", va="center", fontsize=8)
    ax.set_yticks(yy); ax.set_yticklabels([names[p].split(" (")[0].replace(" + ", "\n+ ") for p in pols], fontsize=8.5)
    ax.set_xlim(0, 125); ax.set_xlabel("victims found within 10 min (%)")
    ax.set_title("After 10 minutes", fontsize=10)
    finish(fig, "Topology of the map: a room graph small enough for the radio; pockets-first changes little for nearest-frontier",
           "Generated 40 x 30 m collapsed floors (rooms, rubble, walled-in pockets with a 0.9 m gap); one drone, 6 m LiDAR, "
           "4 m line-of-sight victim detection, 0.5 m/s. 2D, ideal sensing and localisation: a simplified model.",
           f"{F}/fig12_topology.png")


# ---------------------------------------------------------------- fig 12
def fig12(d):
    """Doppler localisation of a steady tone (Sim 10)."""
    ex = np.load(os.path.join(D, "exp10_example.npz"))
    tr = d["trials"]
    fig, axs = plt.subplots(1, 3, figsize=(15, 4.6), gridspec_kw=dict(width_ratios=[1.2, 0.9, 1.1]))
    ax = axs[0]
    ax.imshow(ex["spec"].T, origin="lower", aspect="auto", cmap="Greys",
              extent=(ex["tc"][0], ex["tc"][-1], ex["freqs"][0], ex["freqs"][-1]),
              vmin=np.percentile(ex["spec"], 50), vmax=np.percentile(ex["spec"], 99.7))
    ax.plot(ex["tc"], ex["ftrue"], color=BAD, lw=1.2, label="true pitch heard")
    ax.plot(ex["tc"], ex["fhat"], ".", color=ACCENT, ms=3, label="tracked")
    ax.set_xlabel("time (s)"); ax.set_ylabel("frequency (Hz)"); ax.legend(fontsize=8, loc="upper right")
    ax.set_title("What the drone's microphone hears: a 3.1 kHz tone shifted\nby the drone's own motion, among propeller lines", fontsize=10)
    ax = axs[1]
    pth, src, best = ex["path"], ex["src"], ex["best"]
    ax.plot(pth[:, 0], pth[:, 1], color=INK, lw=2, label="drone path (2 m up, 1 m/s)")
    ax.annotate("", xy=pth[-1], xytext=pth[-3], arrowprops=dict(arrowstyle="->", color=INK, lw=2))
    ax.plot(*src, "*", color=BAD, ms=15, label="sound source")
    ax.plot(*best, "+", color=ACCENT, ms=16, mew=2.5, label=f"estimate ({np.hypot(*(best - src)) * 100:.0f} cm off)")
    ax.set_aspect("equal"); ax.set_xlim(-2, 11); ax.set_ylim(-2, 10); ax.legend(fontsize=8, loc="upper left")
    ax.set_xlabel("x (m)"); ax.set_ylabel("y (m)"); ax.set_title("One L-shaped pass locates it", fontsize=10)
    ax = axs[2]
    def med(sel):
        # a straight pass is scored up to its left/right mirror image (the fit cannot tell the two apart)
        e = [t["err_up_to_mirror_m"] for t in tr if sel(t)]
        return np.median(e), np.mean(np.array(e) < 1.0) * 100
    rows = [("straight pass (side unknown)*", lambda t: t["path"] == "straight"),
            ("L path, 60 dB", lambda t: t["path"] == "L" and t["snr"] == 60 and t["drift"] == 0 and t["v"] == 1),
            ("L path, 50 dB", lambda t: t["path"] == "L" and t["snr"] == 50 and t["drift"] == 0 and t["v"] == 1),
            ("L path, 40 dB", lambda t: t["path"] == "L" and t["snr"] == 40),
            ("L path, 30 dB", lambda t: t["path"] == "L" and t["snr"] == 30),
            ("L path, 20 dB", lambda t: t["path"] == "L" and t["snr"] == 20),
            ("pitch drift 0.1 Hz/sqrt(s)", lambda t: t["drift"] == 0.1),
            ("pitch drift 0.2 Hz/sqrt(s)", lambda t: t["drift"] == 0.2),
            ("pitch drift 0.5 Hz/sqrt(s)", lambda t: t["drift"] == 0.5),
            ("pitch drift 2 Hz/sqrt(s)", lambda t: t["drift"] == 2.0),
            ("0.5 m/s", lambda t: t["v"] == 0.5), ("2 m/s", lambda t: t["v"] == 2.0)]
    vals = [med(f) for _, f in rows]
    yy = np.arange(len(rows))[::-1]
    pct = [v[1] for v in vals]
    ax.set_axisbelow(True)
    ax.barh(yy, pct, color=[GREY if i == 0 else (BAD if p < 50 else ACCENT) for i, p in enumerate(pct)], height=0.65)
    for yi, (m_, p_) in zip(yy, vals):
        ax.text(p_ + 1, yi, f"{p_:.0f}%  (median {m_:.2f} m)" if m_ < 10 else f"{p_:.0f}%", va="center", fontsize=8)
    ax.set_yticks(yy); ax.set_yticklabels([r[0] for r in rows], fontsize=8.5); ax.set_xlim(0, 135)
    ax.set_xlabel("sources located within 1 m (%), 30 trials each")
    ax.set_title("Needs a loud, steady tone and a turn in the path", fontsize=10)
    finish(fig, "One microphone, one pass: locating a steady sound from the drone's own Doppler shift",
           "Simulated microphone: tone falling as 1/distance, propeller harmonics (wandering blade-pass), broadband noise; "
           "dB = tone over noise in a 1 Hz band at 1 m. *A straight pass cannot tell left from right: scored up to that mirror image.",
           f"{F}/fig13_doppler.png")


# ---------------------------------------------------------------- fig 13
def fig13(d):
    """Turing-pattern coverage (Sim 11)."""
    ex = np.load(os.path.join(D, "exp11_example.npz"))
    fig = plt.figure(figsize=(15.5, 4.8))
    gs_ = fig.add_gridspec(2, 4, width_ratios=[0.55, 0.55, 1, 1.25], height_ratios=[1, 1])
    for i, Da in enumerate((0.5, 2.0, 8.0)):
        ax = fig.add_subplot(gs_[i // 2, i % 2]) if i < 2 else fig.add_subplot(gs_[1, 0])
        ax.imshow(ex[f"a_{Da}"], cmap="Blues"); ax.set_xticks([]); ax.set_yticks([])
        ax.set_title(f"diffusion {Da}", fontsize=8.5)
    ax = fig.add_subplot(gs_[1, 1]); ax.axis("off")
    ax.text(0.02, 0.5, "Same rules,\nfaster diffusion:\nfewer, wider-\nspaced spots", fontsize=8.5, color=QUIET, va="center")
    ax = fig.add_subplot(gs_[:, 2])
    A = d["spacing"]
    Das = sorted({a["Da"] for a in A})
    sp = [np.mean([a["spacing_cells"] for a in A if a["Da"] == x]) for x in Das]
    ax.loglog(Das, sp, "o", color=ACCENT, ms=7, label="measured spot spacing")
    ref = sp[2] * np.sqrt(np.array(Das) / Das[2])
    ax.loglog(Das, ref, "--", color=GREY, label="square-root law")
    ax.set_xlabel("activator diffusion (grid units)"); ax.set_ylabel("spot spacing (cells)")
    ax.legend(fontsize=8); ax.set_title("One number sets the spacing", fontsize=10)
    ax = fig.add_subplot(gs_[:, 3])
    C = d["coverage"]
    cols = {"random": GREY, "lawnmower": INK, "greedy": GOOD, "lloyd": "#7a5af5", "turing_only": "#e8a400", "turing": ACCENT}
    lab = {"random": "random walk", "lawnmower": "lawnmower strips", "greedy": "greedy (nearest unsearched)",
           "lloyd": "Lloyd / Voronoi", "turing_only": "Turing field alone", "turing": "Turing field + greedy mop-up"}
    for pol in [p for p in ("random", "lawnmower", "greedy", "lloyd", "turing_only", "turing") if any(c["policy"] == p for c in C)]:
        for fail, ls in ((False, "-"), (True, "--")):
            rs = [c for c in C if c["policy"] == pol and c["fail"] == fail]
            T_ = np.array(rs[0]["t"]); cv = np.mean([c["cov"] for c in rs], 0) * 100
            ax.plot(T_, cv, ls, color=cols[pol], lw=2 if not fail else 1.4, label=lab[pol] if not fail else None)
    ax.axvline(15, color=BAD, lw=0.8, ls=":"); ax.text(16, 8, "3 of 8 drones\nfail (dashed)", fontsize=8, color=BAD)
    ax.set_xlim(0, 200); ax.set_ylim(0, 101); ax.set_xlabel("time (s)"); ax.set_ylabel("area searched (%)")
    ax.legend(fontsize=8, loc="lower right"); ax.set_title("8 drones search 32 x 32 m (mean of 10 runs)", fontsize=10)
    finish(fig, "A Turing field spreads the swarm with local rules, but covers ground no faster than simple rules",
           "Gierer-Meinhardt activator-inhibitor field; searched ground stops producing activator, so spots move to unsearched ground "
           "and each drone flies to a spot. 2 m sensing radius, 1 m/s, launched from the left edge. Dashed: 3 of 8 drones fail at 15 s.",
           f"{F}/fig14_turing.png")


# ---------------------------------------------------------------- fig 5
def fig5(d):
    rows = d["rows"]
    fig, axs = plt.subplots(1, 2, figsize=(11.5, 4.3), sharey=True)
    for ax, case in zip(axs, ("constant density", "fixed arena")):
        for scheme, col, ls in (("all-pairs", GREY, "-"), ("grid", ACCENT, "-")):
            r = sorted([q for q in rows if q["case"] == case and q["scheme"] == scheme and q["rate_hz"] == 100], key=lambda q: q["n"])
            ax.loglog([q["n"] for q in r], [q["dsp"] for q in r], ls, color=col, lw=2.2, marker="o", ms=3.5,
                      label=f"{scheme} neighbour search")
        ax.axhline(1824, color=BAD, lw=1.2, ls="--"); ax.text(300, 1824 * 1.25, "all 1,824 DSP slices on the XCKU5P", color=BAD, fontsize=8.5)
        mu = d["assumptions"]["max_units_by_lut"] * d["assumptions"]["dsp_per_unit"]
        ax.axhline(mu, color=BAD, lw=1.2, ls=":"); ax.text(300, mu * 0.62, f"logic (LUTs) runs out first: ~{mu // 2} units", color=BAD, fontsize=8.5)
        ax.axvline(4096, color=QUIET, lw=1, ls=":"); ax.text(4096 * 0.88, 40, "4,096-agent demo", color=QUIET, fontsize=8.5, rotation=90, ha="right")
        ax.set_xlabel("number of agents"); ax.set_title("Room grows with the flock" if case == "constant density" else "Fixed 4 x 4 m net (denser with more agents)")
    axs[0].set_ylabel("DSP slices needed at 100 updates/s"); axs[0].legend(fontsize=9, loc="lower right")
    lim = d["max_agents"]
    finish(fig, "The 4,096-agent demo uses under 1% of the chip's multipliers; logic is the real limit",
           f"Arithmetic estimate: one distance check per clock per unit at an assumed 250 MHz, 2 DSP and ~{d['assumptions']['lut_per_unit']:,.0f} LUTs per unit "
           f"(from the open-source synthesis of the v1 engine). Ceiling at 100 Hz: about {lim['constant density / all-pairs / 100 Hz']:,} agents "
           f"checking all pairs, and memory-limited near {lim['constant density / grid / 100 Hz']:,} with a grid. To be confirmed in Vivado.",
           f"{F}/fig8_neighbour_cost.png")


# ---------------------------------------------------------------- fig 6
def fig6(d, peaks):
    C = d["control"]; S = d["switching"]
    fig, axs = plt.subplots(1, 3, figsize=(13.5, 4.3), gridspec_kw=dict(width_ratios=[1.2, 1.2, 0.9]))
    pk = {n: e for n, e, x in (peaks or [])}
    for ax, n in zip(axs[:2], (512, 8)):
        for c, col in zip([c for c in C if c["n"] == n], (ACCENT, GREY)):
            h = c["history"]
            ax.plot([0] + [q["iter"] + 1 for q in h], [c["eta0"]] + [q["eta"] for q in h], color=col, lw=2,
                    label=f"start at eta {c['eta0']}")
        if n in pk and n > 8:
            ax.axhline(pk[n], color=INK, lw=1, ls="--"); ax.text(1, pk[n] + 0.06, f"peak from the sweep (eta {pk[n]:.2f})", fontsize=8.5, color=INK)
        if n == 8:
            ax.text(25, 2.2, "the 8-agent sweep has only\na plateau at high noise:\nnothing sharp to find", fontsize=8.5, color=QUIET)
        ax.set_xlabel("controller iteration"); ax.set_ylabel("noise eta set by the controller"); ax.legend(fontsize=9)
        ax.set_title(f"{n} agents" + (": settles near the peak" if n == 512 else ": no sharp peak, drifts to high noise"))
    ax = axs[2]
    ns = sorted({s["n"] for s in S}); w = 0.36
    # the saved value is the index of the first step past the threshold; steps = index + 1
    ts = [np.mean([v + 1 for s in S if s["n"] == n for v in s["to_search"] if v >= 0]) for n in ns]
    tt = [np.mean([v + 1 for s in S if s["n"] == n for v in s["to_transit"] if v >= 0] or [np.nan]) for n in ns]
    x = np.arange(len(ns))
    ax.bar(x - w / 2, ts, w, color=GREY, label="transit -> search (noise up)")
    ax.bar(x + w / 2, tt, w, color=ACCENT, label="search -> transit (noise down)")
    for xi, a, b in zip(x, ts, tt):
        ax.text(xi - w / 2, a + 3, f"{a:.0f}", ha="center", fontsize=8.5, color=INK)
        ax.text(xi + w / 2, b + 3, f"{b:.0f}", ha="center", fontsize=8.5, color=INK)
    ax.set_xticks(x); ax.set_xticklabels([f"N={n}" for n in ns]); ax.set_ylabel("steps to change state")
    ax.set_ylim(0, max(tt) * 1.35)
    ax.legend(fontsize=8.5, loc="upper left"); ax.set_title("Switching mission mode by changing noise")
    finish(fig, "A simple controller finds the fluctuation peak, but only in a large flock",
           "Extremum seeking on the susceptibility (two-point probing). Right: steps for the order parameter to cross 0.5 "
           "(going disordered) or 0.8 (going ordered) after a noise switch, averaged over 3 runs x 6 switches.",
           f"{F}/fig9_control.png")


# ---------------------------------------------------------------- fig 14
RULES12 = ["budget 5 min", "budget 10 min", "plateau", "exhausted", "exhausted + audit", "topology"]
NAMES12 = {"budget 5 min": "5-minute budget", "budget 10 min": "10-minute budget", "plateau": "map stopped growing",
           "exhausted": "no frontier left", "exhausted + audit": "no frontier + audit report",
           "topology": "audit, look again, report"}


def fig14(d):
    """When is a search finished (Sim 12)."""
    ex = np.load(os.path.join(D, "exp12_example.npz"))
    R = d["runs"]
    fig = plt.figure(figsize=(15.5, 4.9))
    gs_ = fig.add_gridspec(1, 3, width_ratios=[1.3, 1, 1])
    ax = fig.add_subplot(gs_[0])
    g, solid, fl = ex["grid"], ex["solid"], ex["flagged"]
    img = np.ones(g.shape + (3,))
    img[g == 0] = [0.93, 0.94, 0.95]
    img[g == 2] = [0.86, 0.80, 0.68]
    img[g == 1] = [0.12, 0.13, 0.15]
    img[fl] = [0.93, 0.55, 0.35]
    ax.imshow(img, origin="lower", extent=(0, g.shape[1] * 0.1, 0, g.shape[0] * 0.1), interpolation="nearest")
    v = ex["victims"]
    ax.plot(v[:, 1] * 0.1, v[:, 0] * 0.1, "*", color=ACCENT, ms=11, mec=INK, mew=0.5, ls="none", label="victim (all found)")
    from matplotlib.patches import Patch
    hs = [Patch(facecolor=(0.93, 0.94, 0.95), edgecolor=GREY, label="seen free"), Patch(color=(0.86, 0.80, 0.68), label="unseen"),
          Patch(color=(0.93, 0.55, 0.35), label="flagged for rescuers")]
    ax.legend(handles=hs + ax.get_legend_handles_labels()[0], fontsize=8, loc="lower right", framealpha=0.95)
    run4 = next(r for r in R if r["seed"] == 4)
    big = max(run4["report_end"]["flags"], key=lambda f: f["open_inside_m2"])
    ax.set_xlabel("x (m)"); ax.set_ylabel("y (m)")
    ax.set_title(f"Floor 4 when the search ends: {big['open_inside_m2']:.0f} m\u00b2 of open floor behind gaps\n"
                 f"narrower than the drone is flagged for rescuers", fontsize=10)
    # stop time and victims missed
    ax = fig.add_subplot(gs_[1])
    yy = np.arange(len(RULES12))[::-1]
    tm = [np.mean([r["rules"][k]["t_stop"] for r in R]) / 60 for k in RULES12]
    nv = sum(r["n_victims"] for r in R)
    miss = [100 * sum(r["rules"][k]["missed"] for r in R) / nv for k in RULES12]
    ax.barh(yy, tm, color=[GREY, GREY, GREY, INK, INK, ACCENT], height=0.6)
    for yi, a_, m_ in zip(yy, tm, miss):
        ax.text(a_ + 0.2, yi, f"{a_:.1f} min, {m_:.0f}% of victims missed", va="center", fontsize=8)
    ax.set_yticks(yy); ax.set_yticklabels([NAMES12[k] for k in RULES12], fontsize=8.5)
    ax.set_xlim(0, max(tm) * 1.9); ax.set_xlabel("mean time when the rule ends the search (min)")
    ax.set_title(f"When each rule stops ({len(R)} floors)", fontsize=10)
    # unseen open space: reported vs silent
    ax = fig.add_subplot(gs_[2])
    un = np.array([np.mean([r["rules"][k]["unseen_open_m2"] for r in R]) for k in RULES12])
    si = np.array([np.mean([r["rules"][k]["silent_open_m2"] for r in R]) for k in RULES12])
    ax.barh(yy, si, color=BAD, height=0.6, label="not reported (silent)")
    ax.barh(yy, un - si, left=si, color=(0.93, 0.55, 0.35), height=0.6, label="flagged for rescuers")
    for yi, u_, s_ in zip(yy, un, si):
        ax.text(u_ * 1.12 + 0.5, yi, f"{u_:.0f} m\u00b2 unseen, {s_:.1f} silent", va="center", fontsize=8)
    ax.set_xscale("symlog", linthresh=10); ax.set_xlim(0, max(un) * 8)
    ax.set_yticks(yy); ax.set_yticklabels([])
    ax.set_xlabel("open floor space still unseen at the stop (m\u00b2, mean; log scale above 10)")
    ax.set_title("What is left unseen, and is anyone told?\nred: nobody is told; orange: flagged for rescuers", fontsize=10)
    finish(fig, "When is a search finished? Only the topological audit says what was not seen",
           "The 30 Sim 9 floors, one drone, nearest-frontier planner run until it has no target left; it does not know "
           "when it has found every victim. Open floor = truly free space connected to the start (scoring only; sealed voids excluded).",
           f"{F}/fig15_stopping.png")


def _chi_peak_eta(n):
    d3 = load("exp3_finite_size.json")
    if not d3:
        return None
    rows = [r for r in merge_finite_size(d3, load("exp3b_large_n_repeats.json"))["rows"] if r["n"] == n]
    return max(rows, key=lambda r: r["chi"])["eta"]


def fig16(d):
    """UGV symmetry breaking (Sim 13)."""
    A, B = d["partA"], d["partB"]
    pk = _chi_peak_eta(128)
    fig, axs = plt.subplots(1, 3, figsize=(15.5, 4.7), gridspec_kw=dict(width_ratios=[1.15, 1.1, 1.0]))
    ax = axs[0]
    styles = [("broadcast", INK, "--", "radio to all"),
              ("local w=16", blues(3)[2], "-", "UGV, w = 16"),
              ("local w=4", ACCENT, "-", "UGV, w = 4"),
              ("local w=1", blues(3)[0], "-", "UGV, w = 1"),
              ("none", GREY, ":", "no UGV")]
    for cfg, col, ls, lab in styles:
        rs = sorted([r for r in A if r["config"] == cfg], key=lambda r: r["eta"])
        e = [r["eta"] for r in rs]; g = [r["G"] for r in rs]; se = [r["G_se"] for r in rs]
        ax.errorbar(e, g, yerr=se, color=col, ls=ls, marker="o", ms=3.5, lw=1.6, capsize=2, label=lab)
    if pk:
        ax.axvline(pk, color=BAD, lw=1, ls="-.")
        ax.text(pk - 0.05, 0.05, f"fluctuation peak\nfor 128 (Sim 3)", color=BAD, fontsize=8, va="bottom", ha="right")
    ax.set_xlabel("noise \u03b7 (rad)"); ax.set_ylabel("share of the flock's motion along the UGV's heading")
    ax.set_ylim(-0.1, 1.05); ax.legend(fontsize=7.6, loc="center left", bbox_to_anchor=(0.0, 0.40))
    ax.set_title("How much of a flock of 128 follows (8 runs each; bars: SE)", fontsize=10)
    ax = axs[1]
    step = d["params"]["curve_step"]
    for eta, col in ((1.0, blues(3)[2]), (2.0, ACCENT), (3.0, blues(3)[0])):
        r = next(r for r in A if r["config"] == "local w=4" and r["eta"] == eta)
        c = np.array(r["curve"]); t = (np.arange(len(c)) + 1) * step
        ax.plot(t, c, color=col, lw=1.6, label=f"\u03b7 = {eta:g}" + (f", half after {r['t_half']} steps" if r["t_half"] else ""))
    r = next(r for r in A if r["config"] == "broadcast" and r["eta"] == 2.0)
    c = np.array(r["curve"]); ax.plot((np.arange(len(c)) + 1) * step, c, color=INK, ls="--", lw=1.2, label="radio command, \u03b7 = 2")
    ax.set_xlim(0, 1500); ax.set_ylim(-0.05, 1.0)
    ax.set_xlabel("steps after the UGV turns 90\u00b0"); ax.set_ylabel("share of motion along the new heading")
    ax.legend(fontsize=7.8, loc="lower right")
    ax.set_title("After a turn (UGV weight 4; mean of 8 turns x 8 runs)", fontsize=10)
    ax = axs[2]
    groups = [(32, 1, "32 drones,\n1 UGV"), (128, 1, "128 drones,\n1 UGV"), (512, 1, "512 drones,\n1 UGV"), (512, 4, "512 drones,\n4 UGVs on a grid")]
    xs = np.arange(len(groups)); wbar = 0.26
    for j, (eta, col) in enumerate(((1.0, blues(3)[2]), (2.0, ACCENT), (3.0, blues(3)[0]))):
        vals = [next(r for r in B if r["n"] == n and r["ugvs"] == m and r["eta"] == eta)["G"] for n, m, _ in groups]
        ax.bar(xs + (j - 1) * wbar, vals, wbar, color=col, label=f"\u03b7 = {eta:g}")
        for xi, v in zip(xs + (j - 1) * wbar, vals):
            ax.text(xi, v + 0.015, f"{v:.2f}", ha="center", fontsize=7)
    ax.set_xticks(xs); ax.set_xticklabels([g[2] for g in groups], fontsize=8.5)
    ax.set_ylim(0, 1.05); ax.set_ylabel("share of motion along the UGV's heading")
    ax.legend(fontsize=7.8, loc="upper right")
    ax.set_title("Flock size and number of UGVs (weight 4)", fontsize=10)
    finish(fig, "A ground robot can steer the flock without sending a single message, best when the flock is calm",
           "Vicsek flock in a periodic box (density 2 per R\u00b2). The UGV drives at the drones' speed and turns \u00b190\u00b0 every 3,000 steps; "
           "drones within one radius of it count its heading w times in their neighbour average. Near the noise where fluctuations peak, "
           "the flock follows only partly.",
           f"{F}/fig16_ugv.png")


def fig17(d):
    """The flock as a reservoir computer (Sim 14)."""
    rows = d["rows"]; refs = {r["hold"]: r for r in d["references"]}
    pk = _chi_peak_eta(128)
    h50 = sorted([r for r in rows if r["hold"] == 50], key=lambda r: r["eta"])
    fig, axs = plt.subplots(1, 3, figsize=(15.5, 4.7), gridspec_kw=dict(width_ratios=[1.15, 1.0, 1.0]))
    ax = axs[0]
    e = [r["eta"] for r in h50]
    for key, col, lab in (("current", ACCENT, "current input, r\u00b2"), ("MC", INK, "memory capacity (sum of r\u00b2, delays 1-10)"),
                          ("product", GOOD, "u(t)\u00b7u(t-1), r\u00b2")):
        ax.errorbar(e, [r["flock"][key] for r in h50], yerr=[r["flock"][key + "_se"] for r in h50], color=col, marker="o",
                    ms=3.5, lw=1.6, capsize=2, label=lab)
    ax.plot(e, [r["shuffled"]["current"] for r in h50], color=GREY, ls=":", lw=1.2, label="shuffled input (control)")
    if pk:
        ax.axvline(pk, color=BAD, lw=1, ls="-.")
        ax.text(pk + 0.05, 0.6, "fluctuation\npeak (Sim 3)", color=BAD, fontsize=8, va="top")
    es = refs[50]["esn"]
    ax.text(0.98, 0.98, f"software reservoir, 51 nodes, no noise:\ncurrent {es['current']:.2f}, memory {es['MC']:.1f}, product {es['product']:.2f}",
            transform=ax.transAxes, ha="right", va="top", fontsize=8, color=QUIET,
            bbox=dict(boxstyle="round,pad=0.3", fc="white", ec=GRID))
    ax.set_ylim(-0.02, 0.7); ax.set_xlabel("noise \u03b7 (rad)"); ax.set_ylabel("score on fresh test runs")
    ax.legend(fontsize=7.8, loc="center right", bbox_to_anchor=(1.0, 0.55))
    ax.set_title("What a readout of 128 drones can compute (input every 50 steps)", fontsize=10)
    ax = axs[1]
    k = np.arange(11)
    ax.plot(k, refs[50]["esn"]["r2_k"], color=GREY, lw=1.6, marker="s", ms=3.5, label="software reservoir, 51 nodes")
    for eta, col in ((0.5, blues(3)[2]), (1.5, ACCENT), (3.0, blues(3)[0])):
        r = next(r for r in h50 if r["eta"] == eta)
        ax.plot(k, r["flock"]["r2_k"], color=col, lw=1.6, marker="o", ms=3.5, label=f"flock, \u03b7 = {eta:g}")
    ax.set_xlabel("delay k (input intervals of 50 steps)"); ax.set_ylabel("r\u00b2 of recalling u(t - k)")
    ax.set_ylim(-0.02, 1.05); ax.set_xticks(k); ax.legend(fontsize=7.8, loc="center right")
    ax.set_title("How far back the readout can recall the input", fontsize=10)
    ax = axs[2]
    for hold, mk, col in ((20, "^", blues(3)[0]), (50, "o", ACCENT), (100, "s", blues(3)[2])):
        rs = sorted([r for r in rows if r["hold"] == hold], key=lambda r: r["eta"])
        ax.errorbar([r["eta"] for r in rs], [r["consistency"]["mean"] for r in rs], yerr=[r["consistency"]["se"] for r in rs],
                    color=col, marker=mk, ms=4, lw=1.4 if hold == 50 else 0, capsize=2, label=f"all 51 features, input every {hold} steps")
    ax.plot([r["eta"] for r in h50], [r["consistency_heading"]["mean"] for r in h50], color=INK, ls="--", lw=1.2,
            label="sine of flock heading only, every 50 steps")
    if pk:
        ax.axvline(pk, color=BAD, lw=1, ls="-.")
    ax.set_ylim(0, 1); ax.set_xlabel("noise \u03b7 (rad)"); ax.set_ylabel("correlation between two copies")
    ax.legend(fontsize=7.6, loc="upper right")
    ax.set_title("Echo-state test: same input, different start and noise", fontsize=10)
    finish(fig, "The flock is a weak reservoir computer, and it computes best when calm, not at its critical point",
           "A UGV's heading carries a random input (new value every 50 steps); a linear readout of the flock's coarse state (4 x 4 grid of mean heading "
           "and density, plus order and heading: 51 numbers) is trained on 3 runs and scored on 2 fresh ones; 3 repeats per point (bars: SE). "
           "128 drones, UGV weight 4.",
           f"{F}/fig17_reservoir.png")


def fig18(d):
    """Koopman / DMD prediction (Sim 15)."""
    rows = d["rows"]
    pk = _chi_peak_eta(128)
    def R(case, eta):
        return next(r for r in rows if r["case"] == case and r["eta"] == eta)
    fig, axs = plt.subplots(1, 3, figsize=(15.5, 4.7))
    ax = axs[0]
    for eta, ls in ((1.0, "-"), (3.0, "--")):
        hz = R("free", eta)["horizons"]; st = [h["steps"] for h in hz]
        ax.plot(st, [h["skill_dmd"] for h in hz], color=ACCENT, ls=ls, marker="o", ms=3.5, lw=1.6, label=f"linear model (DMD), \u03b7 = {eta:g}")
        ax.plot(st, [h["skill_ar"] for h in hz], color=GOOD, ls=ls, marker="x", ms=4, lw=1.0, label=f"one-number model (AR(1)), \u03b7 = {eta:g}")
        ax.plot(st, [h["skill_pers"] for h in hz], color=GREY, ls=ls, marker=".", lw=1.0, label=f"'stays as it is', \u03b7 = {eta:g}")
    ax.axhline(0, color=INK, lw=0.8)
    ax.set_xscale("log"); ax.set_ylim(-1.1, 1.0)
    ax.set_xlabel("how far ahead (steps, log scale)"); ax.set_ylabel("skill for the order \u03c6 (1 perfect, 0 no better than the mean)", fontsize=9)
    ax.legend(fontsize=7.4, loc="lower left")
    ax.set_title("Free flock: order is predictable only briefly", fontsize=10)
    ax = axs[1]
    for eta, ls in ((1.0, "-"), (3.0, "--")):
        hz = R("steered", eta)["horizons"]; st = [h["steps"] for h in hz]
        lab = eta == 1.0
        ax.plot(st, [h["head_dmd"] for h in hz], color=ACCENT, ls=ls, marker="o", ms=3.5, lw=1.6, label="linear model with the UGV input" if lab else None)
        ax.plot(st, [h["head_smooth"] for h in hz], color=GOOD, ls=ls, marker="x", ms=4, lw=1.0, label="one-number smoother with the UGV input" if lab else None)
        ax.plot(st, [h["head_pers"] for h in hz], color=GREY, ls=ls, marker=".", lw=1.0, label="'keeps its heading'" if lab else None)
        ax.plot(st, [h["head_ugv"] for h in hz], color=BAD, ls=ls, lw=1.0, label="'heads where the UGV heads now'" if lab else None)
    ax.plot([], [], color=INK, ls="-", lw=1.0, label="solid: \u03b7 = 1")
    ax.plot([], [], color=INK, ls="--", lw=1.0, label="dashed: \u03b7 = 3")
    ax.set_xscale("log"); ax.set_ylim(0, 125); ax.set_yticks(range(0, 81, 20))
    ax.set_xlabel("how far ahead (steps, log scale)"); ax.set_ylabel("mean heading error (degrees)")
    ax.legend(fontsize=7.4, loc="upper left")
    ax.set_title("Steered flock: a one-number smoother does as well", fontsize=10)
    ax = axs[2]
    for case, key, col, ls, lab in (("steered", "head_dmd", ACCENT, "-", "steered: model + input"),
                                     ("steered", "head_smooth", GOOD, "-", "steered: smoother + input"),
                                     ("steered", "head_const", INK, "--", "steered: average heading"),
                                     ("steered", "head_pers", GREY, "-", "steered: keeps heading"),
                                     ("steered", "head_ugv", BAD, "-", "steered: copies UGV"),
                                     ("free", "head_dmd", ACCENT, ":", "free: model"),
                                     ("free", "head_pers", GREY, ":", "free: keeps heading")):
        rs = sorted([r for r in rows if r["case"] == case], key=lambda r: r["eta"])
        h = [next(x for x in r["horizons"] if x["h"] == 50) for r in rs]
        ax.errorbar([r["eta"] for r in rs], [x[key] for x in h], yerr=[x[key + "_se"] for x in h], color=col, ls=ls,
                    marker="o", ms=3, lw=1.4, capsize=2, label=lab)
    if pk:
        ax.axvline(pk, color=BAD, lw=1, ls="-.")
    ax.set_ylim(0, 150); ax.set_yticks(range(0, 101, 20)); ax.set_xticks([0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5])
    ax.set_xlabel("noise \u03b7 (rad)"); ax.set_ylabel("heading error 500 steps ahead (degrees)")
    ax.legend(fontsize=7.4, loc="upper left")
    ax.set_title("500 steps ahead, across noise (3 repeats; bars: SE)", fontsize=10)
    finish(fig, "A linear (Koopman/DMD) model predicts the flock no better than one-number rules, with or without the UGV's moves",
           "128 drones; 51 coarse observables (4 x 4 grid of mean heading and density, plus order and heading) every 10 steps; models fitted on 3 runs "
           "of 50,000 steps and tested on 2 fresh runs; rank chosen by validation (it chose all 51). Steered: a UGV whose heading changes at random "
           "every 50 steps, known to the model and to the smoother (which turns the flock's heading a fitted fraction toward the UGV's every 10 steps).",
           f"{F}/fig18_koopman.png")


def fig19(d):
    """Stigmergy: marks instead of radio (Sim 16)."""
    rows = {r["policy"]: r for r in d["rows"]}
    order = ["radio", "tags 10 m", "tags 25 m", "marks 1 m", "marks 3 m", "alone"]
    labels = {"radio": "ideal radio", "tags 10 m": "tags every 10 m", "tags 25 m": "tags every 25 m",
              "marks 1 m": "marks every 1 m", "marks 3 m": "marks every 3 m", "alone": "no sharing"}
    cols = {"radio": INK, "tags 10 m": ACCENT, "tags 25 m": blues(3)[0], "marks 1 m": GOOD, "marks 3 m": (0.55, 0.78, 0.6), "alone": BAD}
    ce = d["curve_every"]
    fig, axs = plt.subplots(1, 3, figsize=(15.5, 4.8), gridspec_kw=dict(width_ratios=[1.15, 1.0, 1.0]))
    ax = axs[0]
    for p in order:
        c = np.array(rows[p]["curve"]); t = np.arange(len(c)) * ce / 60
        m = rows[p]["marks"]["mean"]
        ax.plot(t, 100 * c, color=cols[p], lw=1.8 if p in ("radio", "alone") else 1.4,
                ls="--" if p == "radio" else "-",
                label=f"{labels[p]}: {rows[p]['t90']['mean'] / 60:.1f} min" + (f" ({m:.0f} dropped)" if m else ""))
    ax.axhline(90, color=GREY, lw=0.8, ls=":")
    ax.set_xlim(0, 12); ax.set_ylim(0, 101)
    ax.set_xlabel("time (min)"); ax.set_ylabel("floor searched (%, mean of floors)")
    ax.legend(fontsize=7.2, loc="lower right", title="time to 90%", title_fontsize=7.4)
    ax.set_title(f"Six drones from one entrance ({rows['radio']['floors']} floors)", fontsize=10)
    ax = axs[1]
    pr = d["paired"]["t90"]
    keys = [("marks 1 m - alone", "simple marks 1 m vs none"), ("marks 3 m - alone", "simple marks 3 m vs none"),
            ("tags 10 m - alone", "data tags 10 m vs none"), ("tags 25 m - alone", "data tags 25 m vs none"),
            ("alone - radio", "none vs ideal radio"), ("marks 1 m - radio", "simple marks 1 m vs ideal radio"),
            ("tags 10 m - radio", "data tags 10 m vs ideal radio")]
    yy = np.arange(len(keys))[::-1]
    v = [pr[k]["mean"] / 60 for k, _ in keys]; e = [pr[k]["se"] / 60 for k, _ in keys]
    ax.barh(yy, v, xerr=e, color=[GOOD if x < 0 else BAD for x in v], height=0.6, capsize=2)
    ax.axvline(0, color=INK, lw=0.8)
    lim = max(abs(a) + b for a, b in zip(v, e)) * 1.5
    for yi, x, er in zip(yy, v, e):
        ax.text(x + (er + 0.12 if x >= 0 else -er - 0.12), yi, f"{x:+.1f} \u00b1 {er:.1f}", va="center",
                ha="left" if x >= 0 else "right", fontsize=7.8)
    ax.set_yticks(yy); ax.set_yticklabels([l for _, l in keys], fontsize=8.5)
    ax.set_xlim(-lim, lim)
    ax.set_xlabel("difference in time to 90% on the same floor (min)")
    ax.set_title("Paired by floor (negative = faster; \u00b1 SE)", fontsize=10)
    ax = axs[2]
    w = d["wave"]
    wk = [("tags + full map", "own tags + full map at door", INK, ":"),
          ("tags + first wave's", "own + first wave's tags", ACCENT, "-"), ("tags, own only", "own tags only", ACCENT, "--"),
          ("marks + first wave's", "own + first wave's marks", GOOD, "-"), ("marks, own only", "own marks only", GOOD, "--"),
          ("alone", "no sharing", BAD, "-")]
    for k, lab, col, ls in wk:
        c = np.array(w[k]["curve"]); t = np.arange(len(c)) * ce / 60
        ax.plot(t, 100 * c, color=col, ls=ls, lw=1.5, label=f"{lab}: {w[k]['t90']['mean'] / 60:.1f} min")
    ax.axhline(90, color=GREY, lw=0.8, ls=":")
    ax.set_xlim(0, 10); ax.set_ylim(0, 101)
    ax.set_xlabel("time since the second wave entered (min)"); ax.set_ylabel("floor searched (%, both waves)")
    ax.legend(fontsize=6.8, loc="lower right", title="second wave, time to 90%", title_fontsize=7.0, borderaxespad=0.3)
    ax.set_title(f"A second wave after the first ran out of battery\n(first wave: {d['params']['wave1_s'] // 60} min, "
                 f"{100 * w['wave1_cov']['mean']:.0f}% of the floor)", fontsize=10)
    finish(fig, "Marks left in the building make a jammed swarm search faster, and they tell later drones what was done",
           "Six drones search the 40 x 30 m collapsed floors of Sims 9 and 12 from one entrance at 0.5 m/s, searching 3 m around them. Simple marks say "
           "'searched around here'; data tags store the dropper's whole searched-map. Radio is jammed except in the ideal case. Times to 90% are compared "
           "(the last few percent are slow mop-up next to walls).",
           f"{F}/fig19_stigmergy.png")


def fig20(d):
    """Communication: mesh radio, missing reports, clock skew (Sim 17)."""
    e16 = load("exp16_stigmergy.json")
    ref = {r["policy"]: r for r in e16["rows"]}
    fig, axs = plt.subplots(1, 3, figsize=(15.5, 4.8))
    ax = axs[0]
    L_ = [r["link_m"] for r in d["mesh"]]
    t = [r["t90"]["mean"] / 60 for r in d["mesh"]]; e = [r["t90"]["se"] / 60 for r in d["mesh"]]
    ax.errorbar(L_, t, yerr=e, color=ACCENT, marker="o", lw=1.8, capsize=3, label="mesh radio, merge on contact")
    ax.axhline(ref["radio"]["t90"]["mean"] / 60, color=INK, ls="--", lw=1.2, label="ideal radio")
    ax.axhline(ref["alone"]["t90"]["mean"] / 60, color=BAD, ls=":", lw=1.4, label="no sharing")
    ax.axhline(ref["tags 10 m"]["t90"]["mean"] / 60, color=GOOD, ls="-.", lw=1.2, label="data tags every 10 m, no radio")
    lo = min(ref["radio"]["t90"]["mean"], min(r["t90"]["mean"] for r in d["mesh"])) / 60
    hi = max(ref["alone"]["t90"]["mean"], max(r["t90"]["mean"] for r in d["mesh"])) / 60
    ax.set_xticks(L_)
    ax.set_xticklabels([f"{r['link_m']:g} m\n(split {100 * r['split_frac']['mean']:.0f}%\nof the time)" for r in d["mesh"]], fontsize=8)
    ax.set_xlabel("radio range along free space"); ax.set_ylabel("time until 90% searched (min)")
    ax.set_ylim(lo - 0.45 * (hi - lo), hi + 0.35 * (hi - lo))
    ax.legend(fontsize=7.6, loc="center right", bbox_to_anchor=(1.0, 0.56))
    ax.set_title(f"Mesh radio with merging after splits ({len(d['mesh_per_floor']) // len(L_)} floors)", fontsize=10)
    ax = axs[1]
    dr = sorted(d["dropout"], key=lambda r: r["eta"])
    e_ = [r["eta"] for r in dr]
    ax.plot(e_, [r["true"] for r in dr], color=INK, lw=2.2, label="true order, all 128")
    for n, ls in (("8", "-"), ("32", "--")):
        ax.plot(e_, [r["n"][n]["raw"] for r in dr], color=BAD, ls=ls, marker="o", ms=3, lw=1.4, label=f"{n} random reports, plain")
        ax.plot(e_, [r["n"][n]["corrected"] for r in dr], color=ACCENT, ls=ls, marker="o", ms=3, lw=1.4, label=f"{n} random reports, corrected")
        ax.plot(e_, [r["n"][n]["clustered"] for r in dr], color=(0.93, 0.55, 0.35), ls=ls, marker="s", ms=3, lw=1.4, label=f"{n} nearest one point, plain")
    ax.set_xlabel("noise \u03b7 (rad)"); ax.set_ylabel("order parameter \u03c6 (mean)")
    ax.set_ylim(0, 1.0); ax.legend(fontsize=7.2, loc="lower left")
    ax.set_title("Missing reports: what the ground station would see", fontsize=10)
    ax = axs[2]
    sk = d["skew"]
    for r, col in zip(sk, (ACCENT, blues(3)[0])):
        sv = sorted(int(k) for k in r["s"].keys())
        ax.plot(sv, [r["s"][str(k)]["chi_ratio"] for k in sv], color=col, marker="o", lw=1.8, label=f"\u03b7 = {r['eta']:g}: fluctuations, skewed / true")
    ax.axhline(1, color=INK, lw=0.8)
    ax.set_xscale("symlog", linthresh=10); ax.set_yscale("log")
    from matplotlib.ticker import FixedLocator, NullLocator, FormatStrFormatter
    ax.yaxis.set_major_locator(FixedLocator([0.5, 0.75, 1, 1.5, 2, 3, 5, 7])); ax.yaxis.set_minor_locator(NullLocator())
    ax.yaxis.set_major_formatter(FormatStrFormatter("%g"))
    ax.set_xticks([0, 10, 30, 100, 300]); ax.set_xticklabels(["0", "10", "30", "100", "300"])
    ax.set_xlabel("clock offsets up to \u00b1 s steps"); ax.set_ylabel("susceptibility: skewed / true (log)")
    ax2 = ax.twinx()
    for r, col in zip(sk, (ACCENT, blues(3)[0])):
        sv = sorted(int(k) for k in r["s"].keys())
        ax2.plot(sv, [r["s"][str(k)]["head_err_after_turn"] for k in sv], color=col, ls="--", marker="x", lw=1.2,
                 label=f"\u03b7 = {r['eta']:g}: heading error after a turn (\u00b0)")
    ax2.set_ylabel("heading error after a turn (\u00b0, dashed)", fontsize=9)
    ax2.grid(False); ax2.spines["right"].set_visible(True)
    h1, l1 = ax.get_legend_handles_labels(); h2, l2 = ax2.get_legend_handles_labels()
    ax.legend(h1 + h2, l1 + l2, fontsize=7.2, loc="upper left")
    ax.set_title("Unsynchronised clocks, steered flock of 128", fontsize=10)
    finish(fig, "Measuring the swarm over a real network: merging is safe, but missing reports and clock skew distort what you measure",
           "Left: the Sim 16 search with a radio of limited range; linked drones merge their searched-maps by set union. Middle: a free flock of 128 "
           "where only some drones' reports arrive (4 runs per point). Right: each drone's clock is off by a fixed amount, so a snapshot mixes moments (4 runs).",
           f"{F}/fig20_comm.png")


if __name__ == "__main__":
    fig1()
    d2 = load("exp2_fixed_vs_float.json"); d2 and fig2(d2)
    d3 = load("exp3_finite_size.json")
    if d3:
        d3 = merge_finite_size(d3, load("exp3b_large_n_repeats.json"))
    peaks = fig3(d3) if d3 else None
    d4 = load("exp4_hybrid.json"); d4b = load("exp4b_hybrid_knn.json"); d4d = load("exp4d_recommended.json")
    if d4 and d4b and d4d:
        fig4(d4, d4b, d4d); fig4b(d4d); fig7(d4d)
    d5 = load("exp5_neighbour_cost.json"); d5 and fig5(d5)
    d6 = load("exp6_control.json"); d6 and fig6(d6, peaks)
    d4e = load("exp4e_repulsion.json"); d4e and fig8(d4e)
    d7 = load("exp7_fixed_hybrid.json"); d7 and fig9(d7)
    d8 = load("exp8_groundstation.json")
    d8 and fig10(d8, "results/data/gs_nominal", "results/data/gs_unplug")
    d9 = load("exp9_topology.json"); d9 and fig11(d9)
    d10 = load("exp10_doppler.json"); d10 and fig12(d10)
    d11 = load("exp11_turing.json"); d11 and fig13(d11)
    d12 = load("exp12_stopping.json"); d12 and fig14(d12)
    d13 = load("exp13_ugv.json"); d13 and fig16(d13)
    d14 = load("exp14_reservoir.json"); d14 and fig17(d14)
    d15 = load("exp15_koopman.json"); d15 and fig18(d15)
    d16 = load("exp16_stigmergy.json"); d16 and fig19(d16)
    d17 = load("exp17_comm.json"); d17 and fig20(d17)
    print("figures:", sorted(os.listdir(F)))

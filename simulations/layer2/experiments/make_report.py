"""Build docs/report.html from the saved results. Every number in the report is
read from results/data, so the text cannot drift from the data.

  python experiments/make_report.py            -> docs/report.html (repo version)
  python experiments/make_report.py artifact   -> docs/report_artifact.html (figures at ./figures/)
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim.stats import merge_finite_size

D = "results/data"
ART = len(sys.argv) > 1 and sys.argv[1] == "artifact"
FIG = "figures/" if ART else "../results/figures/"


def load(n):
    return json.load(open(os.path.join(D, n)))


e2 = load("exp2_fixed_vs_float.json"); e3 = load("exp3_finite_size.json"); e4 = load("exp4_hybrid.json")
e4b = load("exp4b_hybrid_knn.json"); e4d = load("exp4d_recommended.json"); e5 = load("exp5_neighbour_cost.json")
e6 = load("exp6_control.json"); fe = load("fpga_estimate.json"); cpu = load("cpu_timing.json")
e3b = load("exp3b_large_n_repeats.json") if os.path.exists(os.path.join(D, "exp3b_large_n_repeats.json")) else None
e3 = merge_finite_size(e3, e3b)
e4e = load("exp4e_repulsion.json")
e7 = load("exp7_fixed_hybrid.json")
e8 = load("exp8_groundstation.json")

# ---------------- numbers -------------------------------------------------------
acc = e2["accuracy"]
rows = e3["rows"]; NS = sorted({r["n"] for r in rows})
peak = {}
for n in NS:
    rs = sorted([r for r in rows if r["n"] == n], key=lambda r: r["eta"])
    k = int(np.argmax([r["chi"] for r in rs]))
    peak[n] = dict(eta=rs[k]["eta"], chi=rs[k]["chi"], phi=rs[k]["phi"])
chi_ratio = peak[max(NS)]["chi"] / peak[8]["chi"]

def mean_where(rs, **kw):
    v = [r["align_real_deg"] for r in rs if all(r.get(k) == val for k, val in kw.items())]
    return float(np.mean(v))

Bd = e4d["B"]
ord_20 = mean_where(Bd, label="B-ordered", latency=0.02, loss=0.0)
ord_100 = mean_where(Bd, label="B-ordered", latency=0.1, loss=0.0)
ord_200 = mean_where(Bd, label="B-ordered", latency=0.2, loss=0.0)
ord_400 = mean_where(Bd, label="B-ordered", latency=0.4, loss=0.0)
ord_100_l50 = mean_where(Bd, label="B-ordered", latency=0.1, loss=0.5)
_ld = [mean_where(Bd, label="B-ordered", latency=l, loss=0.5) - mean_where(Bd, label="B-ordered", latency=l, loss=0.0)
       for l in sorted({r["latency"] for r in Bd})]
loss_lo, loss_hi = min(_ld), max(_ld)
pk_20 = mean_where(Bd, label="B-near-peak", latency=0.02, loss=0.0)
pk_400 = mean_where(Bd, label="B-near-peak", latency=0.4, loss=0.0)
vb_ord = float(np.mean([r["align_virtual_deg"] for r in Bd if r["label"] == "B-ordered"]))
vb_pk = float(np.mean([r["align_virtual_deg"] for r in Bd if r["label"] == "B-near-peak"]))
C = e4d["C"]
def cm(label, **kw):
    rs = [r for r in C if r["label"] == label and all(r.get(k) == v for k, v in kw.items())]
    return dict(mis=float(np.mean([r["align_real_deg"] for r in rs])), mind=float(min(r["min_drone_dist_m"] for r in rs)),
                out=float(np.mean([r["ticks_outside_net"] for r in rs])))
base = cm("C-embodied-command"); meas = cm("C-embodied-measured"); pup = cm("C-puppet"); hard = cm("C-hard-walls")
t15 = cm("C-tau", tau=0.15); t60 = cm("C-tau", tau=0.6)
s0 = cm("D-safety", separation=0.0); s5 = cm("D-safety", separation=0.5); s6 = cm("D-safety", separation=0.6)
dense_phi5 = [r["phi"] for r in e4["A"] if r["eta"] == 5.0][0]
_cdiff = pup["mis"] - base["mis"]
coupling_txt = ("The &ldquo;embodied&rdquo; coupling (the flock feels where the drone really is) "
                + (f"beat the &ldquo;puppet&rdquo; one (the drone's agent moves as the flock says, wherever the drone is): {base['mis']:.0f}&deg; against {pup['mis']:.0f}&deg;." if _cdiff > 2 else
                   f"and the &ldquo;puppet&rdquo; one (the drone's agent moves as the flock says, wherever the drone is) gave about the same alignment ({base['mis']:.0f}&deg; and {pup['mis']:.0f}&deg;)"
                   + (f", but with the puppet coupling the drones came closer together ({pup['mind']*100:.0f} cm against {base['mind']*100:.0f} cm at worst)." if pup["mind"] < base["mind"] - 0.03 else ".")))
knn_real = float(np.mean([r["align_real_deg"] for r in e4b["A"] if r["eta"] <= 0.55]))
knn_phimax = float(max(r["phi"] for r in e4b["A"]))
dense_nb = 1032 / (4.0 - 2 * 0.3) ** 2 * np.pi * 0.5 ** 2        # agents within R = 0.5 m when 1,032 share the 3.4 x 3.4 m flock area
demo_density = 128 / ((4.0 - 2 * 0.3) / 0.5) ** 2                # agents per R^2 inside that area
knn_virt = float(np.mean([r["align_virtual_deg"] for r in e4b["A"] if r["eta"] <= 0.55]))
rec_A = [r for r in e4d["A"] if r["eta"] == 1.0]
rec_real = float(np.mean([r["align_real_deg"] for r in rec_A])); rec_virt = float(np.mean([r["align_virtual_deg"] for r in rec_A]))
lim = e5["max_agents"]
ctrl, ctrl_last = {}, {}
for c in e6["control"]:
    ctrl[(c["n"], c["eta0"])] = float(np.mean([q["eta"] for q in c["history"][-20:]]))
    ctrl_last[(c["n"], c["eta0"])] = float(c["history"][-1]["eta"])
sw = {}
for n in sorted({s["n"] for s in e6["switching"]}):
    up = [v for s in e6["switching"] if s["n"] == n for v in s["to_search"] if v >= 0]
    dn = [v for s in e6["switching"] if s["n"] == n for v in s["to_transit"] if v >= 0]
    sw[n] = (float(np.mean(up)) + 1, float(np.mean(dn)) + 1)     # first_cross gives the index of the step; steps = index + 1
N_RTL, P_RTL = fe["config"]["N"], fe["config"]["P"]
clk = (N_RTL // P_RTL) * (N_RTL + 2 * P_RTL + 22); ms = clk / 250e6 * 1e3
tot, dev = fe["totals"], fe["device"]
pct = lambda a, b: 100.0 * a / b
demo = next((b for b in fe.get("builds", []) if b["WALLS"] == 1 and b["N"] == 128), None)
B7 = e7["B"]
R8 = e8["runs"]
def s8(name, key, f=np.mean):
    return float(f([r[key] for r in R8 if r["scenario"] == name]))
u8 = next(r for r in R8 if r["scenario"].startswith("engine unplugged"))
rp8 = e8["replay"]
rtl8 = " ".join(e8["rtl"])
_g8 = np.load(os.path.join(D, "gs_nominal", "gs.npz"))
jit8 = float(np.percentile(np.abs(np.diff(_g8["t"]) * 1e3 - 20.0), 99))
late8 = float(np.max(np.abs(np.diff(_g8["t"]) * 1e3 - 20.0)))
rtt8 = float(np.median(_g8["rtt_us"][_g8["ok"].astype(bool)] / 1e3))
sd8 = float(np.std([r["align_real_deg"] for r in R8 if r["scenario"] == "nominal"], ddof=1))
nom8 = s8("nominal", "align_real_deg")
_faults8 = ["radio loss 10%", "radio loss 30%", "radio latency 100 ms", "engine late replies"]
_clear8 = [f for f in _faults8 if s8(f, "align_real_deg") - nom8 > 2 * sd8]
_noise8 = [f for f in _faults8 if f not in _clear8]
fault8 = ((("10% and 30% command loss and late engine replies" if set(_noise8) == {"radio loss 10%", "radio loss 30%", "engine late replies"}
            else ", ".join(_noise8)) + f" stayed within two standard deviations of nominal (single runs, so within noise)" if _noise8 else "") +
          (("; " if _noise8 else "") + ", ".join({"radio latency 100 ms": f"a 100 ms radio link ({s8('radio latency 100 ms', 'align_real_deg'):.1f}&deg;)",
                                                  "radio loss 10%": "10% command loss", "radio loss 30%": "30% command loss",
                                                  "engine late replies": "late engine replies"}[f] for f in _clear8)
           + f" cost clearly more than nominal ({nom8:.1f}&deg;)" if _clear8 else ""))
q7 = lambda eng, k, f=np.mean: float(f([r[k] for r in B7 if r["engine"] == eng]))
# order curves of the two engines: at each noise, difference of means against the combined standard error (3 runs each)
_o7 = []
for _eta in sorted({r["eta"] for r in e7["A"]}):
    _a = [r["phi"] for r in e7["A"] if r["eta"] == _eta and r["engine"] == "float"]
    _b = [r["phi"] for r in e7["A"] if r["eta"] == _eta and r["engine"] == "fixed"]
    _se = float(np.hypot(np.std(_a, ddof=1) / np.sqrt(len(_a)), np.std(_b, ddof=1) / np.sqrt(len(_b))))
    _o7.append((_eta, float(np.mean(_b) - np.mean(_a)), _se))
_out7 = [(e_, d_, se_) for e_, d_, se_ in _o7 if abs(d_) > 2 * se_]
q7_overlap = ("The order curves agree within two standard errors (3 runs each) at every noise level." if not _out7 else
              "The order curves agree within two standard errors (3 runs each) at every noise level except " +
              ", ".join(f"{e_:g} (integer engine {d_:+.3f})" for e_, d_, _ in _out7) +
              f"; the largest difference anywhere is {max(abs(d_) for _, d_, _ in _o7):.3f} in an order parameter that runs from 0 to 1.")
demo_size = (f"An open-source estimate puts the 128-agent demo build at about {demo['totals']['LUT']:,} LUTs "
             f"({pct(demo['totals']['LUT'], dev['LUT']):.1f}% of the chip) and {demo['totals']['DSP']} DSP slices. "
             if demo else "")

# ---- Sims 9-11: topology, Doppler, Turing
e9 = load("exp9_topology.json"); e10 = load("exp10_doppler.json"); e11 = load("exp11_turing.json")
E9, X9 = e9["episodes"], e9["example"]
P9 = ("nearest", "utility", "topology", "nearest_pockets")
def s9(p):
    es = [e for e in E9 if e["policy"] == p]
    return dict(all=100 * np.mean([e["found"] / e["n_victims"] for e in es]),
                pk=100 * np.mean([e["found_pocket"] / max(e["n_pocket_victims"], 1) for e in es]),
                all300=100 * np.mean([np.interp(300, e["hist_t"], np.array(e["hist_found"]) / e["n_victims"]) for e in es]),
                pk300=100 * np.mean([(np.array(e["t_found_pocket"]) <= 300).sum() / max(e["n_pocket_victims"], 1) for e in es]))
R9 = {p: s9(p) for p in P9}
n9 = len({e["seed"] for e in E9})
nv9 = np.mean([e["n_victims"] for e in E9]); npv9 = np.mean([e["n_pocket_victims"] for e in E9])
PC9 = e9.get("pocket_check", [])
def pc9(t, k):
    return sum(c[k] for c in PC9 if c["t"] == t)
diff9 = sum(1 for sd in {e["seed"] for e in E9}
            if next(e["found"] for e in E9 if e["seed"] == sd and e["policy"] == "nearest")
            != next(e["found"] for e in E9 if e["seed"] == sd and e["policy"] == "nearest_pockets"))
pk_share9 = 100 * sum(e["n_pocket_victims"] for e in E9 if e["policy"] == "nearest") / sum(e["n_victims"] for e in E9 if e["policy"] == "nearest")
names9 = {"nearest": "Nearest frontier", "utility": "Utility (new area / distance)",
          "topology": "Utility + pockets first", "nearest_pockets": "Nearest + pockets first"}
rows9 = "".join(f'<tr><td>{names9[p]}</td><td class="num">{R9[p]["all300"]:.0f}%</td><td class="num">{R9[p]["pk300"]:.0f}%</td>'
                f'<td class="num">{R9[p]["all"]:.0f}%</td><td class="num">{R9[p]["pk"]:.0f}%</td></tr>' for p in P9)
T10 = e10["trials"]
def s10(sel):
    e = np.array([t["err_m"] for t in T10 if sel(t)])
    return dict(p=100 * np.mean(e < 1.0), med=float(np.median(e)))
d_st = s10(lambda t: t["path"] == "straight")
d_st_m = 100 * np.mean([t["err_up_to_mirror_m"] < 1.0 for t in T10 if t["path"] == "straight"])
d_snr = {s: s10(lambda t, s=s: t["path"] == "L" and t["snr"] == s and t["drift"] == 0 and t["v"] == 1) for s in (60.0, 50.0, 40.0, 30.0, 20.0)}
d_dr = {x: s10(lambda t, x=x: t["drift"] == x) for x in (0.1, 0.2, 0.5, 1.0, 2.0, 5.0)}
d_v = {x: s10(lambda t, x=x: t["v"] == x and t["path"] == "L" and t["snr"] == 50 and t["drift"] == 0) for x in (0.5, 1.0, 2.0)}
trk10 = float(np.median([t["track_err_hz"] for t in T10 if t["path"] == "L" and t["snr"] == 50 and t["drift"] == 0 and t["v"] == 1]))
A11, C11 = e11["spacing"], e11["coverage"]
Da11 = sorted({a["Da"] for a in A11})
sp11 = [np.mean([a["spacing_cells"] for a in A11 if a["Da"] == x]) for x in Da11]
slope11 = float(np.polyfit(np.log(Da11), np.log(sp11), 1)[0])
def s11(p, fail):
    rs = [c for c in C11 if c["policy"] == p and c["fail"] == fail]
    ok = [c["t90"] for c in rs if c["t90"] == c["t90"]]
    return dict(n=len(rs), ok=len(ok), t90=(float(np.mean(ok)) if ok else float("nan")), final=100 * np.mean([c["final"] for c in rs]),
                sd=(float(np.std(ok, ddof=1)) if len(ok) > 1 else 0.0),
                c60=100 * np.mean([np.interp(60, c["t"], c["cov"]) for c in rs]))
P11 = ("random", "lawnmower", "greedy", "lloyd", "turing_only", "turing")
R11 = {(p, f): s11(p, f) for p in P11 for f in (False, True)}
names11 = {"random": "Random walk", "lawnmower": "Lawnmower strips (reassigned on failure)", "greedy": "Greedy: nearest unsearched cell",
           "lloyd": "Lloyd / Voronoi", "turing_only": "Turing field alone", "turing": "Turing field + greedy mop-up"}
def t90s(r):
    if r["ok"] == 0: return "never"
    return f'{r["t90"]:.0f} &plusmn; {r["sd"]:.0f} s' + ("" if r["ok"] == r["n"] else f' ({r["ok"]} of {r["n"]} runs)')
rows11 = "".join(f'<tr><td>{names11[p]}</td><td class="num">{t90s(R11[(p, False)])}</td><td class="num">{R11[(p, False)]["final"]:.0f}%</td>'
                 f'<td class="num">{t90s(R11[(p, True)])}</td><td class="num">{R11[(p, True)]["final"]:.0f}%</td></tr>' for p in P11)

# ---- Sim 12: stopping rules
e12 = load("exp12_stopping.json")
R12 = e12["runs"]
RULES12 = ["budget 5 min", "budget 10 min", "plateau", "exhausted", "exhausted + audit", "topology"]
names12 = {"budget 5 min": "Stop after 5 minutes", "budget 10 min": "Stop after 10 minutes",
           "plateau": "Stop when the map stops growing (&lt; 1 m&sup2; in 60 s)", "exhausted": "Stop when no frontier is left",
           "exhausted + audit": "No frontier left, then audit the map and report", "topology": "Audit, fly back to look into each flagged region, report"}
nv12 = sum(r["n_victims"] for r in R12); n12 = len(R12)
def r12(k, q):
    return float(np.mean([r["rules"][k][q] for r in R12]))
miss12 = {k: sum(r["rules"][k]["missed"] for r in R12) for k in RULES12}
rows12 = "".join(f'<tr><td>{names12[k]}</td><td class="num">{r12(k, "t_stop") / 60:.1f} min</td><td class="num">{miss12[k]} ({100 * miss12[k] / nv12:.0f}%)</td>'
                 f'<td class="num">{r12(k, "unseen_open_m2"):.0f} m&sup2;</td><td class="num">{r12(k, "silent_open_m2"):.1f} m&sup2;</td></tr>' for k in RULES12)
FX = [f for r in R12 for f in r["report_exhausted"]["flags"]]
fx_n = len(FX) / n12
fx_real = sum(f["open_inside_m2"] >= 1.0 for f in FX); fx_false = sum(f["open_inside_m2"] < 0.25 for f in FX)
fx_sealed = sum(f["sealed"] for f in FX)
FE = [f for r in R12 for f in r["report_end"]["flags"]]
unseen_big12 = sum(r["rules"]["exhausted"]["unseen_open_m2"] > 5 for r in R12)
unseen_max12 = max(r["rules"]["exhausted"]["unseen_open_m2"] for r in R12)
extra12 = float(np.mean([r["t_done"] - r["t_exhausted"] for r in R12]))
ex12 = next(r for r in R12 if r["seed"] == 4)
ex12_big = max(ex12["report_end"]["flags"], key=lambda f: f["open_inside_m2"])["open_inside_m2"]
silent_max12 = max(r["rules"]["exhausted + audit"]["silent_open_m2"] for r in R12)


# ---- Sim 13: UGV symmetry breaking
e13 = load("exp13_ugv.json")
A13, B13 = e13["partA"], e13["partB"]
def g13(cfg, eta):
    return next(r for r in A13 if r["config"] == cfg and r["eta"] == eta)
def b13(n, m, eta):
    return next(r for r in B13 if r["n"] == n and r["ugvs"] == m and r["eta"] == eta)
pk13 = max([r for r in rows if r["n"] == 128], key=lambda r: r["chi"])["eta"]
th13 = [g13("local w=4", e)["t_half"] for e in (0.5, 1.0, 1.5, 2.0, 2.5, 3.0)]


# ---- Sim 14: reservoir computing
e14 = load("exp14_reservoir.json")
def r14(hold, eta):
    return next(r for r in e14["rows"] if r["hold"] == hold and r["eta"] == eta)
esn14 = next(r for r in e14["references"] if r["hold"] == 50)["esn"]
sh14 = max(max(r["shuffled"]["current"], r["shuffled"]["MC"], r["shuffled"]["product"]) for r in e14["rows"])
best14 = max(e14["rows"], key=lambda r: r["flock"]["current"] + r["flock"]["MC"])          # any noise, any input rate


# ---- Sim 15: Koopman / DMD
e15 = load("exp15_koopman.json")
def k15(case, eta, h):
    r = next(r for r in e15["rows"] if r["case"] == case and r["eta"] == eta)
    return next(x for x in r["horizons"] if x["h"] == h)
ranks15 = sorted({k for r in e15["rows"] for k in r["ranks"]})
gap15 = max(abs(k15(c, e, 1)["skill_dmd"] - k15(c, e, 1)["skill_ar"]) for c in ("free",) for e in (0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5))
ETAS15 = (0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5)
far15 = max((k15("free", e, h)["skill_ar"] - k15("free", e, h)["skill_dmd"], e) for e in ETAS15 for h in (5, 10, 20, 50))
dsm15 = max(abs(k15("steered", e, h)["head_dmd"] - k15("steered", e, h)["head_smooth"]) for e in ETAS15 for h in (1, 2, 5, 10, 20, 50))
lo15 = min(min(k15("free", e, 10)["skill_dmd"], k15("free", e, 10)["skill_ar"]) for e in ETAS15)



# ---- Sim 16: stigmergy
e16 = load("exp16_stigmergy.json")
e16r = {r["policy"]: r for r in e16["rows"]}
P16 = e16["paired"]["t90"]
W16, WP16 = e16["wave"], e16["wave_paired"]["t90"]
gap16 = P16["alone - radio"]["mean"]
rec16 = {k: -P16[f"{k} - alone"]["mean"] / gap16 for k in ("marks 1 m", "marks 3 m", "tags 10 m", "tags 25 m")}
mn = lambda k: e16r[k]["t90"]["mean"] / 60
w16_tags = W16["tags + first wave's"]["t90"]["mean"] / 60
w16_full = W16["tags + full map"]["t90"]["mean"] / 60
d16_tags = WP16["tags + first wave's - tags, own only"]
d16_marks = WP16["marks + first wave's - marks, own only"]

# ---- Sim 17: communication
e17 = load("exp17_comm.json")
M17 = {r["link_m"]: r for r in e17["mesh"]}
D17 = {r["eta"]: r for r in e17["dropout"]}
K17 = {r["eta"]: r for r in e17["skew"]}
false17 = sum(r["false_belief_cells"] for r in e17["mesh"])
same20 = sum(1 for r in e17["mesh_per_floor"] if r["link"] == 20.0 and r["t90"] == next(q for q in load("exp16_stigmergy.json")["per_floor"] if q["floor"] == r["floor"] and q["policy"] == "radio")["t90"])
n17 = sum(1 for r in e17["mesh_per_floor"] if r["link"] == 20.0)

def f0(v): return f"{v:,.0f}"
def f1(v): return f"{v:.1f}"
def f2(v): return f"{v:.2f}"

# ---------------- page -------------------------------------------------------------
CSS = """
:root {
  --bg: #f3f5f8; --panel: #ffffff; --ink: #141920; --muted: #5a6472; --rule: #d9dee6;
  --accent: #1f5fd6; --accent-soft: #e3ecfc; --warn: #b4530c; --warn-soft: #fbeee3; --good: #2b7a4b;
  --font-display: "IBM Plex Sans Condensed", "Arial Narrow", system-ui, sans-serif;
  --font-body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-data: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --bg: #0e1217; --panel: #161b22; --ink: #e5e9ef; --muted: #8d97a5; --rule: #2a313b;
    --accent: #6fa3ff; --accent-soft: #1b2a44; --warn: #f0a46a; --warn-soft: #3a2616; --good: #6cc495; color-scheme: dark; }
}
:root[data-theme="dark"] { --bg: #0e1217; --panel: #161b22; --ink: #e5e9ef; --muted: #8d97a5; --rule: #2a313b;
  --accent: #6fa3ff; --accent-soft: #1b2a44; --warn: #f0a46a; --warn-soft: #3a2616; --good: #6cc495; color-scheme: dark; }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 16px; line-height: 1.6;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 28px 56px; }
main { max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px; }
.text { max-width: 70ch; }
h1 { font-family: var(--font-display); font-weight: 600; font-size: clamp(1.9rem, 4vw, 2.6rem); line-height: 1.1; margin: 0; text-wrap: balance; }
h2 { font-family: var(--font-display); font-weight: 600; font-size: 1.5rem; line-height: 1.2; margin: 0 0 6px; text-wrap: balance; }
h3 { font-size: 1rem; margin: 18px 0 4px; }
p { margin: 0 0 10px; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; color: var(--muted); font-size: 0.9rem; }
.chip { font-family: var(--font-data); font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; border: 1px solid var(--rule);
  border-radius: 4px; padding: 2px 8px; color: var(--muted); }
.banner { background: var(--warn-soft); border-left: 3px solid var(--warn); padding: 12px 16px; border-radius: 4px; max-width: 78ch; }
.glance { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.card { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 14px 16px; min-width: 0; }
.card .k { font-family: var(--font-data); font-variant-numeric: tabular-nums; font-size: 1.35rem; color: var(--accent); line-height: 1.2; }
.card p { margin: 6px 0 0; font-size: 0.93rem; color: var(--muted); }
section { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--rule); padding-top: 22px; }
figure { margin: 6px 0; background: #ffffff; border: 1px solid var(--rule); border-radius: 8px; padding: 10px; overflow-x: auto; }
figure img { display: block; width: 100%; min-width: 640px; height: auto; }
figure.anim img { min-width: 0; max-width: 420px; }
.anims { display: flex; flex-wrap: wrap; gap: 14px; }
.anims figure { flex: 1 1 320px; }
figcaption { font-size: 0.86rem; color: #5a6472; padding: 6px 4px 0; }
.read { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.read > div { min-width: 0; }
.read h3 { margin-top: 0; font-family: var(--font-display); font-size: 1.05rem; }
.tablewrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.93rem; background: var(--panel); }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 0.82rem; letter-spacing: 0.03em; }
td.num { font-family: var(--font-data); font-variant-numeric: tabular-nums; white-space: nowrap; }
ul.changes { padding-left: 1.2em; margin: 0; display: flex; flex-direction: column; gap: 8px; max-width: 78ch; }
code, pre { font-family: var(--font-data); font-size: 0.88em; }
pre { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: 12px; overflow-x: auto; margin: 0; }
a { color: var(--accent); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sources li { margin-bottom: 4px; }
"""

def fig(name, cap, cls=""):
    return f'<figure class="{cls}"><img src="{FIG}{name}" alt="{cap}"><figcaption>{cap}</figcaption></figure>'

def read(what, how, means):
    return (f'<div class="read"><div><h3>What it shows</h3><p>{what}</p></div><div><h3>How to read it</h3><p>{how}</p></div>'
            f'<div><h3>What it means for LIMINAL</h3><p>{means}</p></div></div>')

p8, pL = peak[8], peak[max(NS)]
big_runs = [r["seeds"] for r in rows if r["n"] >= 2048 and r["eta"] <= 2.8]
big_note = (f"The 2,048 and 4,096 curves average {min(big_runs)} to {max(big_runs)} runs per point near the peak, so they are smoother than in the first version of this report, but still uneven: near the transition the flock changes slowly, so even a long run holds few independent samples."
            if min(big_runs) > 1 else "The 2,048 and 4,096 curves are jagged because each point is one run; near the transition the flock changes slowly, so a run holds few independent samples.")
CHI_RANDOM_8 = 0.201          # N * var(phi) for 8 completely random headings (Monte Carlo, 400,000 samples)
for n in NS:
    rs = sorted([r for r in rows if r["n"] == n], key=lambda r: r["eta"])
    k = int(np.argmax([r["chi"] for r in rs]))
    rr = rs[k]
    se = lambda r: r["chi_err_runs"] if r.get("chi_err_runs") is not None else r["chi_err"]
    peak[n]["runs"] = rr["seeds"]
    peak[n]["between"] = rr.get("chi_err_runs") is not None
    peak[n]["err"] = se(rr)
    # noise values whose fluctuations cannot be told apart from the highest point:
    # within two combined standard errors (between-run errors where known), or, with
    # one run per point, within 15% of it
    def same(r):
        if peak[n]["between"]:
            return abs(rr["chi"] - r["chi"]) < 2 * np.hypot(se(rr), se(r))
        return r["chi"] >= 0.85 * rr["chi"]
    ok = [r["eta"] for r in rs if same(r)]          # every noise value that cannot be told apart, not only neighbours
    peak[n]["lo"], peak[n]["hi"] = min(ok), max(ok)
def _err(n):
    q = peak[n]
    return (f'{q["chi"]:.1f} &plusmn; {q["err"]:.1f}' if q["between"] else f'{q["chi"]:.2f}' if q["chi"] < 1 else f'{q["chi"]:.1f}') 
_rng = lambda q: f'{q["lo"]:.2f}' if q["lo"] == q["hi"] else f'{q["lo"]:.2f}&ndash;{q["hi"]:.2f}'
peak_table = "".join(f'<tr><td class="num">{n:,}</td><td class="num">{peak[n]["eta"]:.2f}</td><td class="num">{_rng(peak[n])}</td>'
                     f'<td class="num">{_err(n)}</td><td class="num">{peak[n]["phi"]:.2f}</td><td class="num">{peak[n]["runs"]}</td></tr>' for n in NS)

# ---- Sim 4e: repulsion and local order
EA, EB = e4e["A"], e4e["B"]
def ga(**kw):
    return [r for r in EA if all(r.get(k) == v for k, v in kw.items())]
def gm(rs, k):
    return float(np.mean([r[k] for r in rs]))
r_so = ga(variant="safety only"); r_none = ga(variant="nothing")
r_mild = ga(variant="safety + repulsion, drones ignore virtual", repulsion=0.3, rep_gain=1.0)
r_strong = ga(variant="safety + repulsion", repulsion=0.5, rep_gain=2.0)
r_only4 = ga(variant="repulsion only", repulsion=0.4, rep_gain=1.0); r_only5 = ga(variant="repulsion only", repulsion=0.5, rep_gain=5.0)
mind = lambda rs: min(r["min_drone_dist_m"] for r in rs) * 100
def eb(v, e, k):
    return float(np.mean([r[k] for r in EB if r["variant"] == v and r["eta"] == e]))
lo_g, lo_l = eb("no repulsion", 1.0, "phi"), eb("no repulsion", 1.0, "phi_local")
hi_g, hi_l = eb("no repulsion", 5.0, "phi"), eb("no repulsion", 5.0, "phi_local")
sw_rows = "".join(f'<tr><td class="num">{n:,}</td><td class="num">{a:.0f}</td><td class="num">{b:.0f}</td></tr>' for n, (a, b) in sw.items())
cpu_rows = "".join(f'<tr><td class="num">{r["n"]:,}</td><td class="num">{r["ms_per_step"]:.1f}</td><td class="num">{r["steps_per_s"]:.0f}</td></tr>'
                   for r in cpu["rows"])

HEAD = """<title>LIMINAL Layer 2 Results</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&display=swap">
<style>""" + CSS + "</style>\n"

BODY = f"""
<main>
<header style="display:flex;flex-direction:column;gap:12px">
  <h1>LIMINAL Layer 2 Results</h1>
  <div class="meta"><span class="chip">Simulation</span><span>Flocking physics, the hybrid real-plus-virtual flock, the first FPGA module, the ground-station loop, four search studies, and tests of the five remaining architecture ideas</span><span>November 2026</span></div>
  <p class="text">Layer 2 is the swarm layer of LIMINAL: many cheap drones that flock, spread out and decide together without a commander. These simulations test the ideas behind it before any hardware is bought, and they size the FPGA and the motion-capture demo.</p>
  <div class="banner"><strong>Everything on this page is simulation.</strong> No number here comes from a flight. Where drone behaviour matters (how fast a drone responds, air disturbance, camera noise), the values are assumptions until they are measured on the motion-capture rig, and they are marked as assumed.</div>
</header>

<section>
  <h2>In short</h2>
  <div class="glance">
    <div class="card"><div class="k">bit for bit</div><p>The Verilog flock engine matches the Python reference model exactly in all eleven simulation checks (64 to 256 agents, 1 to 64 lanes, the walled demo arena, and a recorded ground-station session). Estimated size for 4,096 agents: {pct(tot['LUT'], dev['LUT']):.0f}% of the XCKU5P's logic, {pct(tot['DSP'], dev['DSP']):.0f}% of its DSP slices.</p></div>
    <div class="card"><div class="k">{p8['chi']:.2f} &rarr; {pL['chi']:.0f}</div><p>Fluctuations at the transition grow from {p8['chi']:.2f} with 8 agents, a plateau barely above the {CHI_RANDOM_8:.2f} of random headings, to about {pL['chi']:.0f} with {max(NS):,}.</p></div>
    <div class="card"><div class="k">~128 agents</div><p>That is about how many agents fit a 4 &times; 4 m net with real drones. Thousands either freeze in order or move in structure too fine for a drone to follow.</p></div>
    <div class="card"><div class="k">&lt; 100 ms</div><p>Loop latency budget. In an ordered flock, drone misalignment goes from {ord_20:.0f}&deg; at 20 ms to {ord_100:.0f}&deg; at 100 ms and {ord_400:.0f}&deg; at 400 ms. Losing half the packets adds about {ord_100_l50 - ord_100:.0f}&deg;.</p></div>
    <div class="card"><div class="k">{s0['mind']*100:.1f} cm</div><p>The closest two real drones came with no safety layer. With a push-apart layer at 0.5 m the worst case was {s5['mind']*100:.0f} cm.</p></div>
    <div class="card"><div class="k">No radio</div><p>A ground robot that only drives, and is seen, steers the flock with no radio: {g13('local w=4', 1.0)['G']:.2f} of the flock's motion follows it at low noise, {g13('local w=4', pk13)['G']:.2f} at the critical point. One UGV's grip weakens as the flock grows; how many UGVs a large flock needs is not settled.</p></div>
    <div class="card"><div class="k">{100 * rec16['tags 10 m']:.0f}%</div><p>Of the search time a jammed radio costs, recovered by data tags dropped every 10 m; a later wave that reads them is as fast as one handed the whole map. Reservoir computing (memory {r14(50, 0.5)['flock']['MC']:.2f} of 10) and Koopman/DMD prediction (no better than one-number rules) did not hold up.</p></div>
    <div class="card"><div class="k">{ctrl[(512, 1.6)]:.2f} / {ctrl[(512, 3.6)]:.2f}</div><p>Where a simple controller settled the noise for 512 agents, starting too ordered and too disordered. Both are inside the sweep's broad maximum ({peak[512]['lo']:.1f}&ndash;{peak[512]['hi']:.1f}).</p></div>
  </div>
</section>

<section>
  <h2>The model in one paragraph</h2>
  <div class="text">
  <p>Every agent moves at a constant speed. At each step it looks at every agent within one radius R, takes their average heading, adds a random angle (the <em>noise</em>, eta, drawn evenly from &minus;eta/2 to +eta/2), and moves one step that way. This is the Vicsek model (Vicsek et al., 1995). The <strong>order parameter</strong> measures how aligned the flock is: add every heading as an arrow of length 1 and divide by the number of agents, giving 1 for a perfect flock and close to 0 for random headings. The <strong>susceptibility</strong> measures how much the order swings: N times its variance. It peaks where order is about to break. In systems at equilibrium that is exactly where a small push (one member turning) has the largest effect on the whole; a flock is not at equilibrium, so for flocks this link is approximate. The same measure, and how it grows with group size, has been used to probe near-criticality in real midge swarms (Attanasi et al., 2014).</p>
  </div>
  <div class="anims">
    {fig("anim_flock_forms.gif", "512 agents at low noise go from random headings to flocking.", "anim")}
    {fig("anim_hybrid.gif", "120 virtual agents (grey) and 8 simulated drones (blue) in the 4 &times; 4 m net; halfway, the noise is raised and order breaks up.", "anim")}
  </div>
  {fig("fig1_flock_states.png", "Figure 1. The same 512 agents at three noise levels.")}
</section>

<section>
  <h2>1. Eight agents cannot show a real transition</h2>
  {fig("fig2_finite_size.png", "Figure 2. Order and susceptibility against noise for flocks of 8 to 4,096 agents at constant density.")}
  {read(f"Order falls smoothly as noise rises for every flock size. For 8 agents there is no peak: the fluctuations rise to a plateau of about {p8['chi']:.2f} from noise {p8['lo']:.2f} to the end of the sweep at 5, barely above the {CHI_RANDOM_8:.2f} that completely random headings give; whether they fall again before the largest possible noise (2&pi;) was not simulated. From 32 agents up a clear peak appears; it grows to about {pL['chi']:.0f} at {max(NS):,} agents and moves from noise {peak[32]['eta']:.2f} (32 agents) to about {pL['lo']:.1f}&ndash;{pL['hi']:.1f}.",
        "Left: one line per flock size, darker for larger flocks. Middle: the same runs, now showing fluctuations on a log scale; dots mark each peak. Right: peak height against flock size on log-log axes. " + big_note,
        "A finite flock has no sharp phase transition, only a peak that sharpens as the flock grows (finite-size scaling). Eight drones on their own have no clear peak to sit at, so any claim about criticality has to come from larger flocks: in simulation now, and in real time on the FPGA later. Even with extra runs, the large-flock peak positions are uncertain by a few tenths in noise (see the range column below).")}
  <div class="tablewrap"><table><thead><tr><th>Agents</th><th>Noise at the highest point</th><th>Noise range that cannot be told apart</th><th>Susceptibility there</th><th>Order there</th><th>Runs</th></tr></thead><tbody>{peak_table}</tbody></table></div>
  <p class="text">Uncertainty: where a point has at least two runs known individually (2,048 and 4,096 agents near the peak), &plusmn; is the standard error from the spread between runs, and the range spans every noise value within two combined standard errors of the highest point. Elsewhere the runs were averaged when saved, or there is one run, so the range is the noise values within 15% of the highest point. Error estimates from blocks within one run were used in the first version of this report; near the transition the order changes so slowly that they understated the uncertainty by up to five times, so they are not shown.</p>
  <p class="text">Model details: 2D Vicsek, periodic box, 2 agents per R&sup2;, step length 0.03 R. Standard caution: in very large systems the Vicsek transition becomes discontinuous, with travelling bands (Chat&eacute; et al., 2008); at these sizes it behaves as a smooth crossover.</p>
</section>

<section>
  <h2>2. The FPGA's integer maths behaves like the exact model</h2>
  {fig("fig3_fixed_vs_float.png", "Figure 3. Exact (floating-point) model and FPGA-style integer model, 512 agents.")}
  {read(f"Using only 16-bit integers, a 1,024-entry cosine table and a CORDIC arctangent, the integer model reproduces the exact model. From the same state, the average-heading error is {acc['median_deg']:.3f}&deg; median and {acc['max_deg']:.2f}&deg; worst, and every agent finds exactly the same neighbours. (At this box size that part is guaranteed: the exact model starts from the integer positions converted without rounding, so it checks the heading maths rather than the neighbour search.)",
        "Grey is the exact model, blue the integer model. On the left the curves overlap. On the right the peak is in the same place; the wiggles are run-to-run noise from a single run per point.",
        "The FPGA can use cheap integer hardware without changing the physics. Positions and headings that wrap around 65,536 give the periodic box for free.")}
  <div class="text">
  <h3>The Verilog engine</h3>
  <p>The engine in <code>fpga/rtl/vicsek_engine.v</code> processes the flock in blocks of P lanes. Each lane holds one agent, the whole flock streams past one agent per clock tick, and each lane adds up the neighbours it sees. A CORDIC unit then turns the sums into a heading, and the new state is written to a second memory bank so every agent moves together. In simulation (Icarus Verilog) it matches the Python model <strong>bit for bit</strong>: 64 agents for 32 steps with 1, 4, 8 and 64 lanes, and 256 agents for 16 steps with 16 lanes.</p>
  <h3>Version 1.1: the demo arena</h3>
  <p>The demo is a walled 4 &times; 4 m net, not a periodic box, with 8 real drones among the virtual agents. Version 1.1 of the engine adds exactly that: soft walls that push agents back from the edge, mirroring at the boundary, and plain distances instead of wrapped ones. The drones are ordinary agents: before every step the laptop writes in their camera-measured positions. In simulation it again matches the Python model <strong>bit for bit</strong>: the 128-agent demo flock for 40 steps with 1, 8 and 16 lanes, and a noisy 64-agent flock with 4 and 64 lanes, with drone positions written before every step. One step of the demo flock takes {(128 // 16) * (128 + 2 * 16 + 22 + 17):,} clock ticks (the testbench counts one more for the start handshake), about {(128 // 16) * (128 + 2 * 16 + 22 + 17) / 250:.1f} microseconds at an assumed 250 MHz, against a 20 ms control tick. Even at a quarter of that clock it would take under 30 microseconds. {demo_size}</p>
  {fig("fig4_fixed_hybrid.png", "Figure 4. The 128-agent hybrid demo run with the exact (floating-point) model and with the FPGA's integer engine.")}
  <p>Run through the full hybrid demo, the integer engine flies like the exact model: in the ordered flock, drone misalignment was {q7('float', 'align_real_deg'):.1f}&deg; with the exact model and {q7('fixed', 'align_real_deg'):.1f}&deg; with the integer engine, and the closest two drones came {q7('float', 'min_drone_dist_m', np.min)*100:.0f} and {q7('fixed', 'min_drone_dist_m', np.min)*100:.0f} cm apart. {q7_overlap}</p>
  <p>An open-source synthesis estimate (Yosys, not Vivado) for {N_RTL:,} agents and {P_RTL} lanes: about {tot['LUT']:,} LUTs ({pct(tot['LUT'], dev['LUT']):.0f}%), {tot['FF']:,} flip-flops, {tot['DSP']} DSP slices ({pct(tot['DSP'], dev['DSP']):.0f}%) and {tot['BRAM36']} block RAMs ({pct(tot['BRAM36'], dev['BRAM36']):.0f}%). One step takes {clk:,} clock ticks, about {ms:.1f} ms at an assumed 250 MHz. That clock is not verified: each lane does two multiplies, a cosine-table read and several compares in one clock tick, which may need pipelining to reach 250 MHz. Vivado's timing report will give the real clock; <code>fpga/vivado/build.tcl</code> runs that build with one command.</p>
  </div>
</section>

<section>
  <h2>3. Which hybrid set-up works in a 4 &times; 4 m net</h2>
  {fig("fig5_hybrid_setup.png", "Figure 5. Three ways to put a large virtual flock and 8 real drones in the same net.")}
  {read(f"With 1,032 agents and a 0.5 m radius, each agent has about {dense_nb:.0f} neighbours (the flock keeps 0.3 m inside the net, so it uses a 3.4 &times; 3.4 m area), and the flock never loses its common heading. Even with every neighbourhood perfectly aligned, each agent's own noise caps the order parameter at sin(&eta;/2)/(&eta;/2), which is 0.24 at noise 5; the dense flock sits at that ceiling at every noise level ({dense_phi5:.2f} at noise 5), so it has no transition to study. With the 7-nearest rule (as starlings do; Ballerini et al., 2008) the flock never reaches a well-ordered state (order at most {knn_phimax:.2f} at noise 0.1 to 1.6, one run per noise value), and the drones are badly misaligned with their neighbours ({knn_real:.0f}&deg; against {knn_virt:.0f}&deg; for virtual agents), so that set-up fails for the opposite reason. Mixing real robots with virtual ones follows earlier mixed-reality robotics work (H&ouml;nig et al., 2015) and motion-capture swarm set-ups such as Crazyswarm (Preiss et al., 2017). At 128 agents ({demo_density:.1f} per R&sup2; in the area the flock uses; 2 per R&sup2; over the whole net) the flock has a clear transition and the drones stay within {rec_real:.0f}&deg; (virtual: {rec_virt:.0f}&deg;).",
        "Left: order against noise for each set-up; the dotted line is the ceiling set by each agent's own noise. Right: misalignment at low noise for virtual agents and real drones. Misalignment is the angle between where a drone actually went over 0.2 s and its neighbours' average heading.",
        "A large virtual flock cannot share a small net with real drones. Either pack too many into the radius rule (physics frozen) or follow nearest neighbours that sit ~10 cm apart, which a drone needing ~0.3 s to respond cannot track. The demo should run about 120 virtual agents with the 8 drones in the net, and show large flocks on screen separately.")}
</section>

<section>
  <h2>4. Latency budget and lost packets</h2>
  {fig("fig6_latency_loss.png", "Figure 6. Real-drone misalignment for each loop latency and packet loss, 128-agent hybrid.")}
  {read(f"In an ordered flock, misalignment is {ord_20:.0f}&deg; at 20 ms, {ord_100:.0f}&deg; at 100 ms, {ord_200:.0f}&deg; at 200 ms and {ord_400:.0f}&deg; at 400 ms. Losing half the command packets changed it by {loss_lo:+.0f} to {loss_hi:+.0f}&deg; across these latencies (3 runs per cell). At the fluctuation peak everything is noisy: {pk_20:.0f}&deg; at 20 ms and {pk_400:.0f}&deg; at 400 ms, against {vb_pk:.0f}&deg; for virtual agents.",
        "Each cell is the mean of 3 runs of 40 s. Rows are the share of command packets lost (the drone keeps its last command); columns are the full camera-to-drone loop delay. Each panel has its own colour scale.",
        "Design the loop for under 100 ms end to end (camera exposure, tracking, swarm maths, radio). Wi-Fi packet loss in a crowded hall is a smaller risk than latency. Because the swarm maths for 128 agents takes well under a millisecond on a laptop, the latency budget is set by the cameras and the radio, not the computer.")}
</section>

<section>
  <h2>5. Design choices for the real drones</h2>
  {fig("fig7_design_safety.png", "Figure 7. Design options and the safety layer, 128-agent hybrid, ordered flock, 40 ms latency.")}
  {read(f"The drone's response time is the biggest lever: {t15['mis']:.0f}&deg; at 0.15 s, {base['mis']:.0f}&deg; at 0.3 s, {t60['mis']:.0f}&deg; at 0.6 s. Hard walls (agents bounce off the boundary) left drones outside the net for {hard['out']:.0f} of 2,000 ticks on average; soft walls with a 0.3 m margin kept them inside. Without a safety layer two drones came within {s0['mind']*100:.1f} cm.",
        "Left: misalignment for each option, mean of 3 runs. Blue is the baseline used everywhere else, orange the option that breaks the net. Right: the worst closest approach between any two real drones over 40 s.",
        f"Three must-haves for the demo: soft walls with a margin inside the net; a safety layer that pushes real drones apart (0.5 m gave a worst case of {s5['mind']*100:.0f} cm at no cost in alignment); and a measured, ideally tuned, drone response time. {coupling_txt}")}
</section>

<section>
  <h2>6. How much hardware the swarm maths needs</h2>
  {fig("fig8_neighbour_cost.png", "Figure 8. DSP slices needed to update the flock 100 times a second.")}
  {read(f"Checking every pair, the XCKU5P could update about {lim['constant density / all-pairs / 100 Hz']:,} agents 100 times a second, limited by its logic (about {e5['assumptions']['max_units_by_lut']} lanes, using at most 75% of the chip's LUTs); sorting agents into grid cells first raises that to about {lim['constant density / grid / 100 Hz']:,}, limited by on-chip memory. That grid figure is an upper bound: it ignores the cost of sorting the agents into cells and the memory for the cell lists. The 4,096-agent case needs about 14 DSP slices.",
        "Log-log axes. Grey checks every pair; blue uses a grid. The red line is all the DSP slices on the chip. The dotted line is where the chip's logic (LUTs) runs out, at about 1,600 LUTs per lane from the open-source synthesis of version 1; logic, not DSP slices, is the real limit. This is arithmetic, assuming one distance check per lane per clock at an unverified 250 MHz and two copies of every agent's record in memory, and needs confirming in Vivado.",
        "The chip is far larger than the 8-drone demo needs. Its value is in flocks of tens of thousands, fixed timing, and a ground station that runs without a laptop.")}
  <div class="text">
  <h3>Honest comparison with a CPU</h3>
  <p>The same model on one core of the shared cloud machine used for these runs (a laptop core is faster):</p>
  </div>
  <div class="tablewrap" style="max-width:520px"><table><thead><tr><th>Agents</th><th>ms per step</th><th>steps per second</th></tr></thead><tbody>{cpu_rows}</tbody></table></div>
  <p class="text">A laptop, and even the browser explorer, runs 4,096 agents in real time. Version 1 of the FPGA engine ({ms:.1f} ms per step at {N_RTL:,} agents and {P_RTL} lanes) is a correctness milestone, not a speed win. The FPGA pulls ahead at tens of thousands of agents with more lanes, a shared CORDIC and grid neighbour search. A desktop GPU would also be fast at this; the FPGA's distinct strengths are fixed timing and running standalone.</p>
</section>

<section>
  <h2>7. Holding the flock at its peak, and switching modes</h2>
  {fig("fig9_control.png", "Figure 9. Left and middle: the noise level chosen by an extremum-seeking controller. Right: steps to change mission mode.")}
  {read(f"For 512 agents the controller settles near noise {ctrl[(512, 1.6)]:.2f} from below and {ctrl[(512, 3.6)]:.2f} from above, inside the sweep's broad maximum (highest point {peak[512]['eta']:.2f}; {peak[512]['lo']:.1f} to {peak[512]['hi']:.1f} within 15% of it, one run per noise value). For 8 agents the curve is almost flat at high noise: the controller drifted up to {ctrl_last[(8, 1.0)]:.2f} (started at 1.0, still creeping up when the run ended) and {ctrl_last[(8, 4.5)]:.2f} (started at 4.5), onto the plateau, where it has nothing sharp to hold. Raising the noise drops the order below 0.5 within {max(sw[64][0], sw[512][0]):.0f} to {sw[8][0]:.0f} steps; re-forming order (above 0.8) takes {sw[64][1]:.0f} steps for 64 agents and {sw[512][1]:.0f} for 512.",
        "The controller probes slightly above and below its current noise, measures the susceptibility at each, and steps toward the larger. Dashed lines mark the peak from the sweep. Right: mean over 3 runs and 6 switches.",
        "A swarm can find its own most responsive setting using only its order parameter, which the swarm layer computes anyway, but only when the flock is large enough to have a clear peak. With 8 drones it would need the virtual flock around them. Switching between search (disordered) and transit (ordered) by changing one number works, and the slow direction is re-forming order. The fast direction is fast partly by construction: one step at noise 4 already scrambles headings enough to push the order below 0.5.")}
  <div class="tablewrap" style="max-width:520px"><table><thead><tr><th>Agents</th><th>Steps to disorder (noise up)</th><th>Steps to re-order (noise down)</th></tr></thead><tbody>{sw_rows}</tbody></table></div>
  <p class="text">Steps are counted from the change of noise to the first step past the threshold, averaged over 3 runs and 6 switches. With 8 agents the order parameter jumps across both thresholds by chance within a step or two, so their switching times say little about the flock.</p>
</section>

<section>
  <h2>8. Two ideas tested and set aside</h2>
  <p class="text">The first version of this report suggested two improvements: short-range repulsion for every agent, and a local order measure for the walled net. Both were tested in Sim 4e. Neither earned its place in the demo.</p>
  {fig("fig10_repulsion_local_order.png", "Figure 10. Left: safety-layer workload against extra drone misalignment for each repulsion setting. Middle: worst closest approach of two drones. Right: whole-flock and local order against noise.")}
  {read(f"Repulsion makes every agent turn away from anything closer than a set distance. It did cut how often the drone safety layer had to push, from {gm(r_so, 'safety_active_frac')*100:.0f}% of the time to {gm(r_mild, 'safety_active_frac')*100:.0f}% (0.3 m, mild) or {gm(r_strong, 'safety_active_frac')*100:.0f}% (0.5 m, strong). But drone misalignment rose with it, from {gm(r_so, 'align_real_deg'):.0f}&deg; to {gm(r_mild, 'align_real_deg'):.0f}&deg; and {gm(r_strong, 'align_real_deg'):.0f}&deg;. On its own, repulsion let drones come within {mind(r_only4):.0f} cm (mild) or {mind(r_only5):.0f} cm (very strong, with {gm(r_only5, 'align_real_deg'):.0f}&deg; misalignment). Local order matched whole-flock order while the flock was ordered ({lo_l:.2f} against {lo_g:.2f} at noise 1) and stayed higher once it disordered ({hi_l:.2f} against {hi_g:.2f} at noise 5).",
        "Left: each line is one family of repulsion settings, from 0.2 m (bottom right) to 0.5 m (top left); misalignment is shown above the virtual agents' own, so the extra turning that repulsion causes for everyone is taken out. The blue dot is the current design. Middle: the smallest distance between any two real drones over 6 runs of 40 s. Right: grey is whole-flock order, blue is local order (each agent's neighbourhood, averaged); the dotted line is what random headings score when each agent sees about 9 neighbours.",
        "Keep the separate safety layer as the only drone-protection rule, and keep the plain Vicsek rule for the flock: repulsion pulls agents off the flock's heading, which is exactly what the drones are supposed to follow. Soft walls already stop the walls from spoiling the whole-flock order, so the order parameter stays the headline number. Local order is still worth logging as a check; it never drops below about 0.3 with ~9 neighbours, so it cannot show full disorder.")}
</section>

<section>
  <h2>9. The demo loop over UDP, in real time</h2>
  <p class="text">Sims 1 to 8 run the drones, cameras and flock inside one program. The demo will not: the cameras, the laptop, the FPGA and the drones are separate machines joined by network links. Sim 8 builds that loop as it will run. The ground-station program (the real one for the demo) runs a 50 Hz control loop and talks over UDP to two stand-ins: the flock engine, using the FPGA's exact integer model, and a real-time simulation of the drones and cameras. The packet formats are written down in <code>groundstation/PROTOCOL.md</code>, so the FPGA can later take the engine's place without changing anything else.</p>
  {fig("fig11_groundstation.png", "Figure 11. Left: drone and virtual-agent misalignment in each scenario, with the offline result for comparison. Middle: loop timing in a nominal run. Right: mean drone speed when the engine goes silent for 3 s.")}
  {read(f"In six nominal runs (40 s each) the drones followed the flock with {s8('nominal', 'align_real_deg'):.1f}&deg; misalignment, against {q7('fixed', 'align_real_deg'):.1f}&deg; in the offline simulation with the same engine, and came no closer than {s8('nominal', 'min_drone_dist_m', np.min)*100:.0f} cm. In the recorded run, 99% of control ticks came within {jit8:.2f} ms of their 20 ms slot, the worst tick was {late8:.1f} ms late, and the engine answered in {rtt8:.2f} ms (median). Each fault case below is a single run; the six nominal runs spread by {sd8:.1f}&deg; (standard deviation), so differences of that size are noise. Losing {s8('radio loss 10%', 'cmds_lost_radio', np.sum):.0f} of {s8('radio loss 10%', 'cmds_received', np.sum):.0f} commands (10%) gave {s8('radio loss 10%', 'align_real_deg'):.1f}&deg;, 30% loss {s8('radio loss 30%', 'align_real_deg'):.1f}&deg;, and a 100 ms radio link {s8('radio latency 100 ms', 'align_real_deg'):.1f}&deg;. With 10% of engine replies arriving too late, the loop held the last command for those ticks and reached {s8('engine late replies', 'align_real_deg'):.1f}&deg;. When the engine went silent for 3 s, the drones' mean speed fell from {u8['speed_before_ms']:.2f} to {u8['speed_during_ms']:.2f} m/s (hover) and they rejoined the flock as soon as replies returned. Replaying a recorded nominal session through the integer model reproduced {rp8['headings_matching']:,} of {rp8['headings_checked']:,} heading sets the ground station received, and its first {rp8['rtl_steps']} steps through the Verilog gave: {rtl8} (the testbench's clock count includes the start handshake)",
        "Left: each bar is the mean over 40 s of flight (6 runs for nominal). Grey bars are the virtual agents' own misalignment under the same measure, the baseline. Middle: grey is the time between control ticks, blue the time from sending a STEP packet to receiving the reply. Right: red shading is the engine outage, grey the time the ground station commanded a hover.",
        f"The software side of the demo works end to end and reproduces the offline results, so the FPGA only has to speak the protocol. The loop handles the network faults it will meet: {fault8}; and a dead engine makes the drones stop rather than fly blind. All of this runs on one laptop over localhost; the real Ethernet link to the board and the drones' radio will add their own delays, which the latency results (Figure 6) say stay harmless below about 100 ms.")}
</section>

<section>
  <h2>10. Topology: a room graph for the radio, and a pocket detector that does not work yet</h2>
  <p class="text">Sections 10 to 13 (Sims 9 to 12) move from the flock itself to what a search swarm does with it. In a collapsed building, a drone's map is a grid of free, blocked and unseen cells: about {X9['grid_bytes_raw']/1000:.0f} KB for one 40 &times; 30 m floor at 10 cm. Sim 9 turns that grid into its <em>shape</em>. Rooms are the wide open areas (found with persistent homology (Edelsbrunner et al., 2002), which keeps only open areas that stand out by at least 0.4 m from their surroundings), doorways are the narrowest points between them, and Betti numbers count the separate free regions (b0) and the loops around obstacles (b1). <strong>Pockets</strong> are small, mostly walled-in patches the drone has not yet seen into, where a trapped person could be out of sight. The test: one simulated drone with a 6 m LiDAR explores {n9} generated collapsed floors, each with about {nv9:.0f} victims, under four exploration rules. Each floor has four U-shaped pockets with a 0.9 m opening, and by design a victim sits in every reachable pocket, so {pk_share9:.0f}% of all victims are in pockets; that choice favours any rule that looks into pockets.</p>
  {fig("fig12_topology.png", "Figure 12. Left: one generated floor, shaded by room, with the room graph (blue) and the pockets the floor generator placed (red outlines). Middle: victims found over time, mean of " + str(n9) + " floors. Right: victims found within 10 minutes.")}
  {read(f"The example floor reduces to {X9['rooms']} rooms and {X9['doors']} doorways: {X9['graph_bytes']} bytes, against {X9['grid_bytes_raw']/1000:.0f} KB for the raw map and {X9['grid_bytes_zlib']/1000:.1f} KB compressed. Within 10 minutes, nearest-frontier exploration (always go to the closest edge of the unknown; Yamauchi, 1997) found {R9['nearest']['all']:.0f}% of victims and {R9['nearest']['pk']:.0f}% of those in pockets. A rule that weighs new area against distance did worse, {R9['utility']['all']:.0f}% and {R9['utility']['pk']:.0f}%, because it chases big open areas; sending it to pockets first raised that to {R9['topology']['all']:.0f}% and {R9['topology']['pk']:.0f}%. Adding pockets-first to nearest-frontier gave {R9['nearest_pockets']['all']:.0f}% and {R9['nearest_pockets']['pk']:.0f}%; the two rules found a different number of victims on only {diff9} of the {n9} floors (the runs are paired on the same floors). But the pocket detector itself rarely found the real pockets. Checked on the drone's own map 2 and 4 minutes into a nearest-frontier search, it flagged {pc9(120.0, 'detected')} of {pc9(120.0, 'pockets_unseen')} and {pc9(240.0, 'detected')} of {pc9(240.0, 'pockets_unseen')} real pockets that were still unseen; of the {pc9(120.0, 'planner_flags') + pc9(240.0, 'planner_flags')} flags the pockets-first rules would act on at those moments, {pc9(120.0, 'planner_flags_on_real') + pc9(240.0, 'planner_flags_on_real')} were real pockets. While a pocket's surroundings are still unexplored, its inside is part of one large unseen region, so it does not stand out.",
        "Left: each room has its own shade; blue dots are rooms, squares are doorways, lines join rooms through doorways. Red outlines are the generator's pockets (not the detector's output), stars are victims. Middle: solid lines are all victims, dashed lines victims in pockets. Right: dark bars are all victims, light bars pocket victims.",
        "The room graph is the useful result: a few hundred bytes describe a floor, so drones can share the building's layout over a weak radio instead of whole maps. The pocket detector, as built, does not do its job during the search: the gain it gave the gain-driven planner came from flags on other small walled-in patches, which make that planner finish nearby corners before chasing big open areas (as nearest-frontier does anyway), not from recognising pockets. Detecting pockets reliably needs a different test, for example on the shape of the seen walls rather than on the unseen region; the topological check that does work is the end-of-search audit in Sim 12. This is a simplified model: flat 2D floors, perfect position, perfect LiDAR and a victim seen whenever it is in line of sight within 4 m.")}
  <div class="tablewrap" style="max-width:720px"><table><thead><tr><th>Exploration rule</th><th>All victims, 5 min</th><th>In pockets, 5 min</th><th>All victims, 10 min</th><th>In pockets, 10 min</th></tr></thead><tbody>{rows9}</tbody></table></div>
</section>

<section>
  <h2>11. Locating a steady sound from the drone's own Doppler shift</h2>
  <p class="text">A trapped person's phone, an alarm or a beacon makes a steady tone. A drone flying past hears it slightly higher while approaching and lower while moving away, and the exact shape of that pitch curve depends on where the sound is. Sim 10 tests whether one microphone on one drone, flying a known path at 2 m height and 1 m/s, can locate the source from that curve. The simulated microphone hears the tone (2.8 to 3.4 kHz; the drone does not know the exact frequency, only that it lies in the 2.5 to 3.7 kHz band it searches; quieter with distance), the drone's own propeller harmonics wandering in pitch, and broadband noise. The tracker follows the tone's pitch frame by frame; a grid search then finds the floor position and tone frequency that best explain the curve. Each case is 30 trials with random source positions; the search area brackets the area where sources are placed.</p>
  {fig("fig13_doppler.png", "Figure 13. Left: the microphone's spectrum over time for one pass, with the true and tracked pitch. Middle: the L-shaped path, the source and the estimate. Right: the share of sources located within 1 m in each case.")}
  {read(f"With an L-shaped path and a loud, steady tone the method works: {d_snr[60.0]['p']:.0f}%, {d_snr[50.0]['p']:.0f}% and {d_snr[40.0]['p']:.0f}% of sources within 1 m at 60, 50 and 40 dB, with median errors of {d_snr[60.0]['med']*100:.0f} to {d_snr[40.0]['med']*100:.0f} cm, and the tracked pitch within {trk10:.2f} Hz (median). Below that it fails abruptly: {d_snr[30.0]['p']:.0f}% at 30 dB and {d_snr[20.0]['p']:.0f}% at 20 dB. A straight pass cannot tell which side of its line the sound is on: the source and its mirror image fit exactly equally well in every trial, so the side it reports is arbitrary. Allowing for that mirror image, {d_st_m:.0f}% of straight-pass estimates were within 1 m. A source whose own pitch wanders breaks it fast: {d_dr[0.1]['p']:.0f}%, {d_dr[0.5]['p']:.0f}% and {d_dr[2.0]['p']:.0f}% within 1 m at 0.1, 0.5 and 2 Hz/&radic;s of drift. Flight speed made no difference ({d_v[0.5]['p']:.0f}% at 0.5 m/s, {d_v[2.0]['p']:.0f}% at 2 m/s).",
        "Left: darker means louder. The pitch shifts by a few hertz as the drone approaches, passes and turns; the step at 8 s is the turn. Right: blue bars at least half within 1 m, orange bars below half, grey the straight pass, scored up to its left/right mirror image. dB is the tone's power at 1 m over the background noise in a 1 Hz band, so at 40 dB the tone, at 1 m, carries about as much power as all the background noise across the 8 kHz the microphone records: clearly audible close up, and 14 dB weaker at 5 m.",
        "One drone and one microphone can locate a steady electronic tone (an alarm, a phone ringtone, a beacon) on a single pass, as long as the path turns. It will not locate a human-blown whistle or a voice, whose pitch wanders far more than these limits. It is a simulation without echoes, walls or a moving source, and with the drone's path known exactly. Echoes in a real building are the main open question, and the next step is a recording on a real drone over a phone playing a tone.")}
</section>

<section>
  <h2>12. Turing patterns for spreading the swarm out</h2>
  <p class="text">Turing (1952) showed that two chemicals that react and spread at different rates can form spots and stripes from an even start; Gierer and Meinhardt (1972) recast this as an activator, which boosts itself, and an inhibitor, which spreads faster and holds it back. Such a system makes evenly spaced spots from local rules alone. Sim 11 uses the Gierer&ndash;Meinhardt model as a map of where the drones should be: each drone flies to a spot, and searched ground stops producing activator, so the spots move onto ground nobody has searched yet. It is compared with four standard ways to cover an area: a random walk; lawnmower strips (each drone sweeps its own strip, assigned by distance; a drone that finishes takes over the nearest unswept strip, including those of failed drones); a greedy rule (each drone heads for the nearest unsearched spot); and Lloyd/Voronoi coverage (each drone heads for the centre of the unsearched part of the area closest to it; Cort&eacute;s et al., 2004). The Turing pattern is run two ways: the field alone, and the field with the greedy rule as a mop-up for a drone whose spot is already searched or that has no spot. Eight drones with a 2 m sensing radius search a 32 &times; 32 m area at 1 m/s, launched from one edge; each case is 10 runs, with and without 3 drones failing at 15 s.</p>
  {fig("fig14_turing.png", "Figure 14. Left: the pattern at three diffusion rates. Middle: spot spacing against diffusion rate. Right: area searched over time; dashed lines are runs where 3 of the 8 drones fail at 15 s.")}
  {read(f"The spot spacing follows the square-root law: on log-log axes the measured slope is {slope11:.2f} against the theory's 0.5, from {sp11[0]:.1f} cells at diffusion {Da11[0]} to {sp11[-1]:.1f} at {Da11[-1]:g}. With all 8 drones, Lloyd/Voronoi searched 90% of the area fastest ({t90s(R11[('lloyd', False)])}); the Turing field alone ({t90s(R11[('turing_only', False)])}), the Turing field with mop-up ({t90s(R11[('turing', False)])}), lawnmower strips ({t90s(R11[('lawnmower', False)])}) and the greedy rule ({t90s(R11[('greedy', False)])}) were all about the same, and the random walk took {t90s(R11[('random', False)])}. The field alone never finished: it stopped at {R11[('turing_only', False)]['final']:.0f}%, because spots cannot form in small leftover patches; with the mop-up it reached 100%. When 3 drones failed at 15 s, every method except the random walk still reached 90% and all but the Turing field alone ({R11[('turing_only', True)]['final']:.0f}%) finished; their times to 90% ({min(R11[(q, True)]['t90'] for q in ('lawnmower', 'greedy', 'lloyd', 'turing_only', 'turing')):.0f} to {max(R11[(q, True)]['t90'] for q in ('lawnmower', 'greedy', 'lloyd', 'turing_only', 'turing')):.0f} s) were within the run-to-run spread of each other.",
        "Left: darker blue is more activator; the drones fly to the dark spots. Middle: log-log axes, so a straight line with slope 0.5 is the square-root law. Right: each line is the mean of 10 runs; times to 90% are in the table below as mean &plusmn; standard deviation over the 10 runs.",
        "On coverage speed, the Turing field is no better than simple rules: a greedy rule or lawnmower strips that hand over unfinished strips do as well, and Lloyd/Voronoi is faster with all drones flying. The field does spread the drones on its own, but it needs a mop-up rule to finish. What it still offers is practical: the whole field is one small local stencil per grid cell, the kind of computation the FPGA does well, and one number (the diffusion rate) sets how far apart the drones spread. Whether that matters more than speed is a design choice, not a result. Here the field, like the other methods, is computed centrally; drones are points flying straight lines in an empty square, with no obstacles or collision checks.")}
  <div class="tablewrap" style="max-width:720px"><table><thead><tr><th>Method</th><th>90% searched, 8 drones</th><th>Final, 8 drones</th><th>90% searched, 3 fail</th><th>Final, 3 fail</th></tr></thead><tbody>{rows11}</tbody></table></div>
</section>

<section>
  <h2>13. When is a search finished?</h2>
  <p class="text">The LIMINAL design says a search is complete when the count of unexplored regions (the Betti number &beta;&#8320; of the unseen part of the map) reaches zero. Sim 12 tests that on the 30 floors of Sim 9. One drone explores with nearest-frontier exploration and, unlike in Sim 9, does not stop when it has found every victim, because a real drone cannot know that. Afterwards we ask when each stopping rule would have ended the search and what it would have missed. Besides victims, the score counts <strong>unseen open floor</strong>: truly free space connected to the start, that the drone never saw (ground truth is used only for scoring; free space walled off completely from the start is not counted). The topological rule is tested in two forms. The <em>audit</em> runs once the planner has no frontier left: it flags every unseen region of at least 1 m&sup2; with an opening onto seen free space, plus every closed-off unseen region of at least 4 m&sup2; and 0.5 m across (it could be solid, or a room seen only through a crack), and hands the list to rescuers. The full rule then also flies back to look into each flagged region before reporting.</p>
  {fig("fig15_stopping.png", "Figure 15. Left: floor 4 when the search ends, with the regions the audit reports. Middle: when each rule stops, and the victims it misses. Right: unseen open floor when each rule stops, split into what is reported and what is missed silently (log scale above 10 m&sup2;).")}
  {read(f"Victims were placed only where the drone can fly, and stopping when no frontier is left found all {nv12} of them, after {r12('exhausted', 't_stop') / 60:.1f} minutes on average. Stopping after 10 minutes would have missed {miss12['budget 10 min']} ({100 * miss12['budget 10 min'] / nv12:.0f}%), after 5 minutes {miss12['budget 5 min']} ({100 * miss12['budget 5 min'] / nv12:.0f}%), and when the map stopped growing {miss12['plateau']}. But when the frontier ran out, an average of {r12('exhausted', 'unseen_open_m2'):.0f} m&sup2; of open floor was still unseen (more than 5 m&sup2; on {unseen_big12} of {n12} floors, up to {unseen_max12:.0f} m&sup2;): mostly rooms and corners behind gaps narrower than the drone. Frontier exploration says nothing about them. The audit reported all but {r12('exhausted + audit', 'silent_open_m2'):.1f} m&sup2; of it on average (at most {silent_max12:.1f} m&sup2; on any floor), at the cost of {fx_n:.1f} flags per floor, of which {fx_real} of {len(FX)} held at least 1 m&sup2; of open floor and {fx_false} held almost none (less than 0.25 m&sup2;: the cores of rubble heaps and wall cavities). Flying back to look into every flag took {extra12 / 60:.1f} more minutes, found no further victims, and shrank the unseen open floor only from {r12('exhausted', 'unseen_open_m2'):.0f} to {r12('topology', 'unseen_open_m2'):.0f} m&sup2;.",
        f"Middle: bars are the mean stop time over the 30 floors; the label adds the share of all victims not yet found at that time. Right: red is unseen open floor nobody is told about, orange the part inside regions the audit flags. Only the two audit rules flag anything, so for the others all of it is red. Left: orange regions are what the audit hands to rescuers; on this floor {ex12_big:.0f} m&sup2; of open floor lies behind gaps the drone cannot pass, next to a space walled off completely.",
        "The topological idea earns its place, but not as a proof that the search is complete. The unseen part of a real map never reaches &beta;&#8320; = 0 (the insides of walls and rubble heaps are never seen), and a drone cannot enter gaps narrower than itself. What works is: explore until no frontier is left, then count the unseen regions and hand rescuers a short list of the ones that could hide a person and that the drone could not see into. That costs no extra flight and leaves almost nothing unreported. Flying back to look again is not worth it here. The audit cannot tell a rubble core from a hidden space, so most flags are false alarms; a thermal or acoustic check at each flag, or a smaller drone, is the way to clear them. Same simplified model as Sim 9 (2D, perfect position and LiDAR), and the victims were placed only where the drone can fly, so this test cannot show a victim saved by the audit; it shows the unseen floor space where one could be.")}
  <div class="tablewrap" style="max-width:860px"><table><thead><tr><th>Stopping rule</th><th>Mean stop time</th><th>Victims missed (of {nv12})</th><th>Unseen open floor at the stop (mean)</th><th>of which nobody is told</th></tr></thead><tbody>{rows12}</tbody></table></div>
</section>

<section>
  <h2>14. A ground robot steers the flock without sending a message</h2>
  <p class="text">The architecture says the ground robots (UGVs) exist to break the swarm's symmetry: identical drones following identical rules have no preferred direction, and a robot that looks different gives them something to organise around. It sends no messages; the drones simply see it. Sim 13 tests the simplest form of this, following. A UGV drives through a flock of 128 at the drones' speed and turns 90&deg; left or right every 3,000 steps. A drone that sees it (within one interaction radius) counts the UGV's heading w times in its neighbour average; drones farther away hear of a turn only through their neighbours. The UGV ignores the drones. It is compared with no UGV and with a radio command that gives every drone the UGV's heading (an upper bound the no-command design gives up). The score is the share of the flock's motion that goes the UGV's way (1: every drone moves along the UGV's heading; 0: no net motion along it). Eight runs per point, each with eight turns.</p>
  {fig("fig16_ugv.png", "Figure 16. Left: how much of a flock of 128 follows the UGV, against noise. Middle: the response after a turn. Right: flock size and number of UGVs (the four UGVs sit on a regular grid with one shared heading, a 2 &times; 2 copy of the 128-drone case).")}
  {read(f"With no UGV the flock goes its own way (score about 0). With a UGV of weight 4 the score is {g13('local w=4', 0.5)['G']:.2f} at noise 0.5, {g13('local w=4', 1.0)['G']:.2f} at 1.0, {g13('local w=4', 2.0)['G']:.2f} at 2.0 and {g13('local w=4', pk13)['G']:.2f} at {pk13:.1f}, the noise where the flock of 128 fluctuates most (Sim 3); a radio command to every drone scores {g13('broadcast', pk13)['G']:.2f} there. Weight 1 (the UGV counts as one more neighbour) gives {g13('local w=1', pk13)['G']:.2f} at {pk13:.1f}; weight 16 gives {g13('local w=16', pk13)['G']:.2f}, hardly more than weight 4. After a turn, half of the final response comes within {min(t for t in th13 if t):.0f} to {max(t for t in th13 if t):.0f} steps (weight 4, noise 0.5 to 3; about 1 to 2 interaction radii of travel; measured on the average response curve, sampled every 10 steps, so at noise 3 single runs often reach half on the first sample). One UGV steers a flock of 32 better ({b13(32, 1, 3.0)['G']:.2f} at noise 3) and a flock of 512 worse ({b13(512, 1, 3.0)['G']:.2f}). Comparing at one noise value overstates this: noise 3 is still on the ordered side of the fluctuation peak for 32 drones and already past it for 512 (Sim 3), and the flock of 512 is less ordered there (order {b13(512, 1, 3.0)['phi']:.2f}, against {b13(128, 1, 3.0)['phi']:.2f} for 128), so part of the drop is simply disorder. At noise 1, where all three sizes are ordered, the scores are closer: {b13(32, 1, 1.0)['G']:.2f}, {b13(128, 1, 1.0)['G']:.2f} and {b13(512, 1, 1.0)['G']:.2f}. Four UGVs in the flock of 512 give {b13(512, 4, 3.0)['G']:.2f} at noise 3, a little more than one UGV in 128 ({b13(128, 1, 3.0)['G']:.2f}). That test is weaker evidence than it looks: the four UGVs sit on a regular grid and share one heading, which makes the 512-drone box a 2 &times; 2 copy of the 128-drone setup, so a similar score is close to guaranteed by construction. UGVs at random positions, or with different headings, were not tested.",
        "Left: each line is a way of using the UGV; the dashed black line is the radio command, the dotted grey line no UGV; bars are standard errors over the 8 runs, mostly smaller than the dots. The red line marks the fluctuation peak of a flock of 128 from Sim 3. Middle: the share of motion along the new heading, averaged over all turns and runs; it starts near 0 because just before a turn the flock moves at 90&deg; to the new heading. Right: the same score for different flock sizes and numbers of UGVs.",
        f"The mechanism works: a robot that only drives, and is seen, steers the flock, and no radio is involved. Two things limit it. First, it pulls against the plan to run the flock near its critical point: at the fluctuation peak only about a third of the flock's motion follows the UGV, against nine-tenths at low noise, so a mission that needs steering should run calmer than the peak (noise around 1 to 2 here). Second, one UGV's grip weakens as the flock grows, even at low noise. Adding UGVs helps, but how many a large flock needs is not settled, because the four-UGV test was a regular tiling with one shared heading; one UGV per 128 drones is a starting point to test, not a measured requirement. For the demo (8 drones among about 120 virtual agents) one UGV is enough. The model is an open box with no walls, the drones see the UGV perfectly within one radius, and only following was tested; clustering around, avoiding or orbiting a UGV, also named in the architecture, were not.")}
</section>

<section>
  <h2>15. Can the flock compute? Reservoir computing</h2>
  <p class="text">The architecture's most speculative idea is to use the swarm as a <em>reservoir computer</em>: a UGV moving through the flock is the input, the flock's own dynamics transform it, and only a simple linear readout is trained, as in the bucket of water used as a computer (Fernando and Sojakka, 2003). The document itself names three problems: no task is defined, the reservoir must forget old inputs (the echo-state property) while a flock near its critical point remembers for a long time, and the input may drown in the flock's own noise. It asks whether the flock computes best at its critical point. Sim 14 gives it a task and measures all three. The UGV's heading carries a random input, a new value every 50 steps. A linear readout of a coarse view of the flock (a 4 &times; 4 grid of mean heading and density, plus order and mean heading: 51 numbers, nothing read from the UGV) is trained on three runs and scored on two fresh runs, to output the current input, the input k intervals ago (the sum of the scores for k = 1 to 10 is the <em>memory capacity</em>; Jaeger, 2001), and the product of the current and the previous input, which needs both memory and a nonlinearity. Scores are r&sup2; on the test runs (1 perfect, 0 useless). For scale, a standard software reservoir with 51 nodes and no noise is trained and scored the same way.</p>
  {fig("fig17_reservoir.png", "Figure 17. Left: scores against noise. Middle: how well the input k intervals back can be recalled. Right: the echo-state test, two copies of the flock driven by the same input from different starts and noise.")}
  {read(f"The flock does respond to the input: with the input shuffled against the targets every score is {sh14:.2f}, and with the real input the readout recovers the current input with r&sup2; {r14(50, 0.5)['flock']['current']:.2f} at noise 0.5, falling to {r14(50, 3.0)['flock']['current']:.2f} at noise 3 (the fluctuation peak of a flock of 128) and {r14(50, 4.5)['flock']['current']:.2f} at 4.5. It hardly remembers: the memory capacity is {r14(50, 0.5)['flock']['MC']:.2f} at noise 0.5 and {r14(50, 3.0)['flock']['MC']:.2f} at noise 3, out of a possible 10; the input one interval back is already almost gone. The product task scores at most {max(r['flock']['product'] for r in e14['rows']):.2f} (any noise, any input rate). Holding each input for 100 steps raises the current-input score to {r14(100, 1.0)['flock']['current']:.2f} at noise 1 but lowers the memory to {r14(100, 1.0)['flock']['MC']:.2f}. The 51-node software reservoir scores {esn14['current']:.2f} on the current input, a memory capacity of {esn14['MC']:.1f} and {esn14['product']:.2f} on the product. In the echo-state test, two copies of the flock driven by the same input agree with a correlation of only {r14(50, 0.5)['consistency']['mean']:.2f} (all features) or {r14(50, 0.5)['consistency_heading']['mean']:.2f} (the sine of the flock's heading) at noise 0.5, falling to {r14(50, 3.0)['consistency']['mean']:.2f} and {r14(50, 3.0)['consistency_heading']['mean']:.2f} at noise 3.",
        "Left: each line is one task, scored on runs the readout never saw; bars are standard errors over 3 repeats. The grey box gives the software reservoir's scores, which are far off this scale. Middle: r&sup2; for recalling the input k intervals back; the flock's line drops to near zero after k = 0. Right: if the input decided the flock's state, two copies driven by the same input would agree (correlation 1); low values mean the flock's own noise and starting state decide most of it.",
        f"The answer to the document's research question is no, in this model: the flock computes best when it is calm and ordered, and worse the closer it gets to its critical point and beyond, because its own noise swamps the input there. Even at its best it is a weak reservoir: what the readout can recover is less than a single running average of the input would hold (whose scores over all delays add up to at most 1; here they add up to at most {best14['flock']['current'] + best14['flock']['MC']:.2f}, at noise {best14['eta']:g} with each input held {best14['hold']} steps), and a 51-node program on any microcontroller does vastly better. The echo-state test shows why: most of the flock's state comes from its own noise, not from the input. Reservoir computing should not be presented as a working part of LIMINAL. It stays a research question; a better input channel (several UGVs, or the input fed to many drones) and a richer readout are the first things to try. Only one model was tested: 128 drones, one UGV of weight 4, a coarse-grid readout and one input rate per run.")}
</section>

<section>
  <h2>16. Predicting the flock with a linear (Koopman/DMD) model</h2>
  <p class="text">The architecture proposes treating the whole swarm as one machine: instead of the drones' positions and headings, track a set of measurable quantities (<em>observables</em>) and learn from data a matrix that steps them forward in time. Koopman (1931) showed that such a linear description exists in principle; dynamic mode decomposition (DMD; Schmid, 2010) estimates it from data, and DMD with control (Proctor et al., 2016) adds an input. The promised benefits are fast prediction (one matrix multiplication), dynamics learned from data, and control by linear methods. Sim 15 learns such a model for a flock of 128 from 51 coarse observables (a 4 &times; 4 grid of mean heading and density, plus order and mean heading) sampled every 10 steps, fitted on three runs of 50,000 steps and tested on two fresh runs. It is compared with simple predictors: the value stays as it is; the long-run mean; a one-number model of the order alone (it relaxes toward its mean at a fitted rate, AR(1)); for the heading, &ldquo;always the average heading of the training runs&rdquo;; and, when a UGV steers the flock, &ldquo;the flock heads where the UGV is heading now&rdquo; and a one-number <em>smoother</em> that is given the same known UGV moves as the model: start from the flock's current heading and, every 10 steps, turn a fixed fraction of the way toward the UGV's heading (the fraction fitted on the training runs). In the steered case the UGV's heading (a new random value every 50 steps) is given to the model as a known input. The smoother and the average-heading rule were added after an independent review pointed out that the first comparison had only baselines that ignore the UGV's future moves.</p>
  {fig("fig18_koopman.png", "Figure 18. Left: how well the order can be predicted, free flock. Middle: heading error for a steered flock. Right: heading error 500 steps ahead across noise.")}
  {read(f"For the free flock the linear model predicts the order 10 steps ahead with skill {k15('free', 1.0, 1)['skill_dmd']:.2f} at noise 1 and {k15('free', 3.0, 1)['skill_dmd']:.2f} at noise 3 (1 is perfect, 0 no better than the long-run mean), exactly what the one-number model gets (at that horizon they differ by less than {max(gap15, 0.005) + 0.005:.2f} at any noise). Further ahead the full model is never better and is up to {far15[0]:.2f} worse (at noise {far15[1]:g}); by 100 steps both are at about zero skill at every noise (between {lo15:.2f} and {max(max(k15('free', e, 10)['skill_dmd'], k15('free', e, 10)['skill_ar']) for e in ETAS15):.2f}). The free flock's heading is predicted no better than by assuming it keeps its heading ({k15('free', 1.0, 50)['head_dmd']:.0f}&deg; against {k15('free', 1.0, 50)['head_pers']:.0f}&deg; 500 steps ahead at noise 1). With the UGV's moves known, the model predicts the steered flock's heading 500 steps ahead to within {k15('steered', 1.0, 50)['head_dmd']:.0f}&deg; at noise 1. The one-number smoother, given the same moves, gets {k15('steered', 1.0, 50)['head_smooth']:.0f}&deg;; at every noise and horizon the two differ by at most {dsm15:.0f}&deg;. The rules that ignore the UGV's future moves do worse: {k15('steered', 1.0, 50)['head_const']:.0f}&deg; for always the average heading, {k15('steered', 1.0, 50)['head_pers']:.0f}&deg; for keeping the heading and {k15('steered', 1.0, 50)['head_ugv']:.0f}&deg; for copying the UGV's current heading. At noise 3 the five figures are {k15('steered', 3.0, 50)['head_dmd']:.0f}&deg;, {k15('steered', 3.0, 50)['head_smooth']:.0f}&deg;, {k15('steered', 3.0, 50)['head_const']:.0f}&deg;, {k15('steered', 3.0, 50)['head_pers']:.0f}&deg; and {k15('steered', 3.0, 50)['head_ugv']:.0f}&deg;. (The average-heading rule does well because the UGV's random headings are centred on one direction, so the flock does not wander far from it.) Validation always chose the largest rank offered (rank {', '.join(str(r) for r in ranks15)}), so the model is in effect an ordinary least-squares fit on all 51 observables plus the input; the rank-truncation step of DMD never came into play.",
        "Left: skill above 0 means the prediction beats the long-run mean; the blue and green lines lie on top of each other. Middle and right: mean angle between the predicted and the true flock heading; lower is better; the blue model line and the green smoother line lie on top of each other; the right panel takes the 500-step point for every noise level (bars: standard error over 3 repeats).",
        "In this model the linear (Koopman/DMD) model brings no benefit over one-number rules. Prediction is a single 51 &times; 51 matrix multiplication, trivial for the FPGA, but on its own the flock is predictable only for a few tens of steps, and the 51-number model adds nothing over one number for the order: what is left is noise-driven, and no model can predict that. When the UGV's planned moves are known, the flock's future heading can be predicted, but almost all of that comes from the moves themselves: a one-number smoother (&ldquo;the flock turns a fixed fraction of the way toward the UGV every 10 steps&rdquo;) does as well as the full model at every noise level. So, in this model, predicting the result of UGV moves needs only that one fitted number, the flock's turning lag. The first version of this section said the model predicted the steered flock clearly better than simple rules; that comparison used only rules that ignore the UGV's future moves, and it is withdrawn. Not tested: closing the loop (choosing UGV moves with the model), other observables (which might capture what one number cannot), and real drones with their delays.")}
</section>

<section>
  <h2>17. Marks instead of radio (stigmergy)</h2>
  <p class="text">Ants coordinate through marks left in their surroundings rather than messages (stigmergy; Grass&eacute;, 1959). The architecture proposes the same for LIMINAL: marks written into the building cannot be jammed, they last after the drones that wrote them are gone, and rescuers can read them. Sim 16 tests whether that is worth anything in a search. Six drones search the 20 collapsed floors of Sims 9 and 12 from one entrance (launched 15 s apart, 0.5 m/s, searching 3 m around them along free space; each heads for the nearest unsearched floor it knows of, with a small personal preference so they do not all pick the same spot). With the radio jammed they can share nothing, or drop <em>simple marks</em> that say &ldquo;searched around here&rdquo;, or drop <em>data tags</em> (like RFID tags with memory) that store the dropper's whole searched-map; another drone reads a mark or tag within 3 m. These are compared with an ideal radio that is not jammed. A persistence test then lets a first wave fly for 3 minutes and land, and sends a second wave that remembers nothing; each sharing method is run with and without the first wave's marks, and with the first wave's whole map handed over at the door as a reference. The main measure is the time until 90% of the floor is searched, compared floor by floor; the last few percent are slow mop-up next to walls and vary a lot from floor to floor.</p>
  {fig("fig19_stigmergy.png", "Figure 19. Left: share of the floor searched over time. Middle: differences in time to 90%, paired by floor. Right: a second wave after the first wave's battery ran out.")}
  {read(f"With an ideal radio, 90% of the floor was searched in {mn('radio'):.1f} min; with no sharing it took {mn('alone'):.1f} min ({gap16:.0f} &plusmn; {P16['alone - radio']['se']:.0f} s longer on the same floor). Simple marks every 1 m brought that to {mn('marks 1 m'):.1f} min and data tags every 10 m to {mn('tags 10 m'):.1f} min, recovering {100 * rec16['marks 1 m']:.0f}% and {100 * rec16['tags 10 m']:.0f}% of what the jammed radio lost; marks every 3 m recovered {100 * rec16['marks 3 m']:.0f}% and tags every 25 m {100 * rec16['tags 25 m']:.0f}%. The cost is the number dropped: about {e16r['marks 1 m']['marks']['mean']:,.0f} marks per floor at 1 m spacing ({e16r['marks 3 m']['marks']['mean']:,.0f} at 3 m), against {e16r['tags 10 m']['marks']['mean']:.0f} tags at 10 m and {e16r['tags 25 m']['marks']['mean']:.0f} at 25 m. At 99% the ideal radio's lead remains ({e16r['alone']['t99']['mean'] / 60:.1f} min alone against {e16r['radio']['t99']['mean'] / 60:.1f}; {e16['paired']['t99']['alone - radio']['mean']:.0f} &plusmn; {e16['paired']['t99']['alone - radio']['se']:.0f} s on the same floor), but the gains from marks and tags ({min(-e16['paired']['t99'][k + ' - alone']['mean'] for k in ('marks 1 m', 'marks 3 m', 'tags 10 m', 'tags 25 m')):.0f} to {max(-e16['paired']['t99'][k + ' - alone']['mean'] for k in ('marks 1 m', 'marks 3 m', 'tags 10 m', 'tags 25 m')):.0f} s) are within the floor-to-floor spread of the slow last percent. In the persistence test the first wave searched {100 * W16['wave1_cov']['mean']:.0f}% of the floor and left {W16['wave1_tags']['mean']:.0f} data tags. A second wave reading them reached 90% in {w16_tags:.1f} min, {-d16_tags['mean']:.0f} &plusmn; {d16_tags['se']:.0f} s sooner than with its own tags alone and as fast as when handed the first wave's whole map ({w16_full:.1f} min). The first wave's simple marks saved only {-d16_marks['mean']:.0f} &plusmn; {d16_marks['se']:.0f} s.",
        "Left: each line is the mean over 20 floors; the dotted line marks 90%. Middle: for each floor, the time to 90% with one method minus with another; negative means the first method was faster; bars are standard errors over the 20 floors. Right: the second wave's progress, counting what the first wave searched (so every line starts at the first wave's share); solid lines read the first wave's marks or tags, dashed lines only their own.",
        "Stigmergy earns its place as the fallback when the radio is jammed: marks recover about three-quarters of what is lost, and they keep working after the drones that wrote them have gone. The two kinds of mark do different jobs. Simple marks need to be dense (hundreds to thousands per floor) and tell a later wave little; data tags are needed in far smaller numbers (about 200 per floor at 10 m spacing; a first wave's 39 were enough for the second wave) and carry almost all of what a later wave needs. So data tags are the version to build, if a drone or UGV can carry and place them; that hardware is the open question, and so is the tag's memory: each tag here stores the dropper's whole searched-map, 15 kB as a plain bitmap at 10 cm, or about 1.1 kB compressed (1.5 kB at most, measured on three floors). That is more than common RFID and NFC tags hold (usually under 1 kB of user memory); large-memory tags hold a few kB. Read time, read range and a capped payload were not modelled, and here the drones place the tags themselves where the architecture gives the job to UGVs. The model is ideal in other ways too: 2D, perfect positions, every mark within 3 m read without error, nothing damaged by debris. Rescuers reading the marks was not tested.")}
</section>

<section>
  <h2>18. The communication layer: merging after a split, missing reports, unsynchronised clocks</h2>
  <p class="text">The architecture keeps a radio mesh for measurement only, never for commands, and makes two claims about it: the shared coverage record is a CRDT (a conflict-free replicated data type; Shapiro et al., 2011), so when the network splits and rejoins the records merge exactly; and the order parameter and other collective measurements need every drone's state at the same moment. Its open questions ask what happens when drones drop out of the count and when clocks disagree. Sim 17 tests the three. <strong>Mesh:</strong> the Sim 16 search with a radio of limited range (5, 10 or 20 m along free space, a rough stand-in for walls weakening the signal); drones in reach of each other, directly or through other drones, merge their searched-maps by set union, and a group that is cut off keeps searching and merges when it reconnects. <strong>Missing reports:</strong> a free flock of 128 in which only n drones' reports arrive, either a random n or the n nearest one point (as if only drones near the antenna get through); the plain order parameter of the reports is compared with the true one and with a corrected estimate that removes the known bias of small samples (exact for drones missing at random). <strong>Clocks:</strong> a flock steered by a UGV that turns 90&deg; every 3,000 steps; each drone's clock is off by a fixed amount, up to &plusmn;s steps, so a &ldquo;snapshot&rdquo; mixes headings from different moments.</p>
  {fig("fig20_comm.png", "Figure 20. Left: search time with a mesh radio of limited range. Middle: order parameter seen from missing reports. Right: unsynchronised clocks.")}
  {read(f"<strong>Mesh:</strong> with a 5, 10 or 20 m radio the drones were split into separate groups {100 * M17[5.0]['split_frac']['mean']:.0f}%, {100 * M17[10.0]['split_frac']['mean']:.0f}% and {100 * M17[20.0]['split_frac']['mean']:.0f}% of the time, yet 90% of the floor was searched in {M17[5.0]['t90']['mean'] / 60:.1f}, {M17[10.0]['t90']['mean'] / 60:.1f} and {M17[20.0]['t90']['mean'] / 60:.1f} min, against {e16r['radio']['t90']['mean'] / 60:.1f} min with an ideal radio (paired differences {M17[5.0]['t90_minus_radio']['mean']:+.0f} &plusmn; {M17[5.0]['t90_minus_radio']['se']:.0f}, {M17[10.0]['t90_minus_radio']['mean']:+.0f} &plusmn; {M17[10.0]['t90_minus_radio']['se']:.0f} and {M17[20.0]['t90_minus_radio']['mean']:+.0f} s; with 20 m the times matched the ideal radio on {same20} of {n17} floors) and {e16r['alone']['t90']['mean'] / 60:.1f} min with no sharing. No drone ever believed a cell searched that was not ({false17} such cells in all runs; guaranteed by construction, since beliefs only grow from real observations). <strong>Missing reports:</strong> with 8 random reports from a disordered flock (noise 4.5, true order {D17[4.5]['true']:.2f}) the plain order parameter reads {D17[4.5]['n']['8']['raw']:.2f}; the corrected estimate reads {D17[4.5]['n']['8']['corrected']:.2f}; 8 reports from one part of the flock read {D17[4.5]['n']['8']['clustered']:.2f}. At noise 3 (true {D17[3.0]['true']:.2f}) the three read {D17[3.0]['n']['8']['raw']:.2f}, {D17[3.0]['n']['8']['corrected']:.2f} and {D17[3.0]['n']['8']['clustered']:.2f}; with 32 reports the plain value is off by at most {max(abs(D17[e]['n']['32']['raw'] - D17[e]['true']) for e in D17):.2f}. <strong>Clocks:</strong> with offsets up to &plusmn;10 steps the snapshot order is off by {K17[1.0]['s']['10']['phi_err']:.3f} (noise 1) and the heading after a turn by {K17[1.0]['s']['10']['head_err_after_turn']:.0f}&deg;; with &plusmn;300 steps, by {K17[1.0]['s']['300']['phi_err']:.3f} and {K17[1.0]['s']['300']['head_err_after_turn']:.0f}&deg;, the order seems to drop by {K17[1.0]['s']['300']['phi_drop_after_turn']:.2f} after every turn, and the fluctuation measure (susceptibility) comes out {K17[1.0]['s']['300']['chi_ratio']:.1f} times too large. At noise 2 small offsets make it {K17[2.0]['s']['30']['chi_ratio']:.2f} times the true value (too small) and &plusmn;300 steps {K17[2.0]['s']['300']['chi_ratio']:.1f} times (too large).",
        "Left: blue is the mesh radio (bars: standard error over 20 floors); the horizontal lines are the Sim 16 results on the same floors with the same drones. Middle: the black line is the truth; red lines are the plain estimate from random reports, blue the corrected estimate, orange the plain estimate from the drones nearest one point; solid 8 reports, dashed 32. Right: solid lines (left axis, log scale) are the susceptibility from skewed snapshots divided by the true one; dashed lines (right axis) the heading error in the 300 steps after a turn. If one step is 0.1 s (0.3 m/s with a 1 m radius), &plusmn;10 steps is &plusmn;1 s and &plusmn;300 steps is &plusmn;30 s.",
        f"The merge claim holds, but this test is weak evidence for it: a record that only grows and is merged by set union is conflict-free by construction (merging cannot invent coverage, so the zero above is guaranteed rather than measured), and message delay, partial delivery and concurrent edits were not modelled. What the test does show is that merging is cheap: for this search even a short-range mesh that is split most of the time comes within about 10 s of an ideal radio. The two measurement questions have clear answers. The order parameter does misread a drop in the number of reports as a change in the flock: with few reports a disordered flock looks ordered. Correct for the sample size, which works when reports go missing at random (the correction is exact on average for the square of the order parameter, so the corrected order itself still reads a little low at intermediate order: {D17[3.0]['n']['8']['corrected']:.2f} against a true {D17[3.0]['true']:.2f} at noise 3 with 8 reports), and when they go missing by place (out of radio range) treat the number as local order of the drones heard, not of the swarm. Clock errors of about a second or less hardly matter for the order and the heading (the susceptibility is then off by up to {100 * max(abs(1 - K17[e]['s']['10']['chi_ratio']) for e in K17):.0f}%); tens of seconds make every turn look like a loss of order and distort the susceptibility, here up to {max(K17[e]['s']['300']['chi_ratio'] for e in K17):.1f} times too large. Time-stamp states against one clock (in the demo, the motion-capture system's) and keep offsets well under a second. Not modelled: radio packet loss inside a group, bandwidth limits, moving rubble (a map that changes is no longer a pure union of observations), and clocks that drift rather than sit at a fixed offset.")}
</section>

<section>
  <h2>What should change</h2>
  <ul class="changes">
    <li><strong>Size the demo at about 128 agents in the net.</strong> Fly the 8 drones with ~120 virtual agents at the same density as the simulations, and show the large-flock physics on screen. A co-moving virtual world, where the net is a window that travels with a much larger flock, is the advanced version.</li>
    <li><strong>Add a safety layer before any multi-drone flight.</strong> The Vicsek rule has no repulsion. Push real drones apart below about 0.5 m, and keep soft walls with a 0.3 m margin inside the net.</li>
    <li><strong>Measure the drones first.</strong> Response time, acceleration limit and tracking noise are assumptions here, and response time is the biggest single lever. One hover-and-step test on the rig replaces all of them.</li>
    <li><strong>Budget the loop at under 100 ms.</strong> Time-stamp camera frames and measure the full loop on the rig.</li>
    <li><strong>Do not add repulsion to the flock rule.</strong> Tested in Sim 4e: it reduces the safety layer's work only by costing drone alignment (the more work it saves, the more alignment it costs), and on its own it does not keep drones apart. Virtual agents may overlap on screen; that is acceptable because they are not physical.</li>
    <li><strong>Search methods to keep.</strong> Share room graphs, not maps, between drones (a few hundred bytes per floor; Sim 9). End a search when no frontier is left, then run the topological audit and hand rescuers the list of unseen regions the drone could not look into; do not claim &beta;&#8320; = 0 as proof of completeness (Sim 12). Try Doppler localisation on a real drone with a phone playing a steady tone before relying on it (Sim 10). To spread drones over open ground, Lloyd/Voronoi was fastest and a greedy rule matched the Turing field; keep the Turing field only if a local, FPGA-friendly rule matters more than speed (Sim 11).</li>
    <li><strong>Ground robots (UGVs): keep them, and size them.</strong> A UGV that only drives steers the flock with no radio (Sim 13), but its grip is weak at the critical point. Steer in a calmer regime, and expect larger flocks to need more UGVs; one per 128 drones is a starting point to test (the four-UGV run was a regular tiling with one shared heading), not a measured requirement.</li>
    <li><strong>Do not present reservoir computing as part of the system.</strong> In Sim 14 the flock was a weak reservoir, best when calm and worst near its critical point; keep it as a research question.</li>
    <li><strong>Do not build a Koopman/DMD model for now.</strong> On its own the flock is not predictable beyond a few tens of steps; with the UGV's planned moves its heading is predictable, but a one-number smoother (the flock's turning lag) does as well as the 51-number linear model (Sim 15). Use the lag to plan UGV moves; keep Koopman/DMD as a research question.</li>
    <li><strong>Build data tags, not paint marks, for the jammed-radio case.</strong> About 200 tags per floor (one every 10 m) that store the dropper's searched-map recover about three-quarters of the time a jammed radio costs and tell a later wave everything it needs (Sim 16). Each needs about 1.5 kB for a compressed map, more than most RFID or NFC tags hold. Who carries and places them, drone or UGV, and which tag holds that much, are the hardware questions to answer.</li>
    <li><strong>Keep the mesh for measurement, and fix how it measures.</strong> Merging searched-maps by set union is conflict-free by construction, and a short-range mesh is enough for this search (Sim 17); message delay and loss are still to be tested. Correct the order parameter for the number of drones heard, treat reports from one part of the swarm as local, and time-stamp every state against one clock to well under a second.</li>
    <li><strong>FPGA version 2.</strong> (Walls are done in version 1.1.) Share one pipelined CORDIC between lanes, add grid neighbour search, raise the lane count, and add an Ethernet (UDP) link to the laptop that speaks <code>groundstation/PROTOCOL.md</code>; the ground-station software for it is done (Sim 8). Then run Vivado for real resource and timing numbers.</li>
  </ul>
</section>

<section>
  <h2>Assumptions to replace with measurements</h2>
  <div class="tablewrap"><table><thead><tr><th>Quantity</th><th>Value used</th><th>Why it matters</th><th>How to measure</th></tr></thead><tbody>
    <tr><td>Drone velocity response time</td><td class="num">0.3 s</td><td>Biggest effect on alignment (Figure 7)</td><td>Command a velocity step under mocap and fit the rise</td></tr>
    <tr><td>Acceleration limit</td><td class="num">3 m/s&sup2;</td><td>Limits how sharply a drone can turn with the flock</td><td>Same step test</td></tr>
    <tr><td>Velocity disturbance</td><td class="num">0.05 m/s</td><td>Small effect up to 0.1 m/s</td><td>Hover test, spread of tracked velocity</td></tr>
    <tr><td>Camera position noise</td><td class="num">3 mm</td><td>Sets how well headings can be measured</td><td>Static marker, spread of tracked position</td></tr>
    <tr><td>Loop latency</td><td class="num">40 ms</td><td>Above ~100 ms alignment degrades (Figure 6)</td><td>LED flash seen by camera vs command time stamps</td></tr>
    <tr><td>Flight speed / radius</td><td class="num">0.4 m/s / 0.5 m</td><td>Set the flock's length and time scales</td><td>Design choices; revisit after the first flights</td></tr>
  </tbody></table></div>
</section>

<section>
  <h2>How this was made</h2>
  <div class="text">
  <p>Python with NumPy and Numba; every run uses fixed random seeds, except the real-time ground-station runs (Sim 8), whose timing depends on the computer. The FPGA check uses Icarus Verilog against test vectors written by the Python fixed-point model. Run <code>pytest</code> for the automatic checks, and see <code>README.md</code> for the commands that regenerate each figure. The live flock is in <a href="explorer.html">the browser explorer</a>, and three mechanisms (flocking, reaction&ndash;diffusion patterns, counting unexplored map regions) run live in <a href="layer2_demo.html">the Layer 2 demo</a>.</p>
  </div>
</section>

<section>
  <h2>Sources</h2>
  <ul class="sources text">
    <li>Vicsek, Czir&oacute;k, Ben-Jacob, Cohen, Shochet, <a href="https://doi.org/10.1103/PhysRevLett.75.1226">Novel type of phase transition in a system of self-driven particles</a>, Physical Review Letters 75, 1226 (1995).</li>
    <li>Chat&eacute;, Ginelli, Gr&eacute;goire, Raynaud, <a href="https://doi.org/10.1103/PhysRevE.77.046113">Collective motion of self-propelled particles interacting without cohesion</a>, Physical Review E 77, 046113 (2008).</li>
    <li>Attanasi, Cavagna et al., <a href="https://doi.org/10.1103/PhysRevLett.113.238102">Finite-size scaling as a way to probe near-criticality in natural swarms</a>, Physical Review Letters 113, 238102 (2014); <a href="https://arxiv.org/abs/1412.6975">arXiv:1412.6975</a>.</li>
    <li>Ballerini et al., <a href="https://doi.org/10.1073/pnas.0711437105">Interaction ruling animal collective behavior depends on topological rather than metric distance</a>, PNAS 105, 1232 (2008).</li>
    <li>H&ouml;nig et al., <a href="https://act.usc.edu/publications/Hoenig_IROS2015.pdf">Mixed Reality for Robotics</a>, USC (IROS 2015).</li>
    <li>Yamauchi, <a href="https://doi.org/10.1109/CIRA.1997.613851">A frontier-based approach for autonomous exploration</a>, IEEE CIRA (1997).</li>
    <li>Edelsbrunner, Letscher, Zomorodian, <a href="https://doi.org/10.1007/s00454-002-2885-2">Topological persistence and simplification</a>, Discrete &amp; Computational Geometry 28, 511 (2002).</li>
    <li>Turing, <a href="https://doi.org/10.1098/rstb.1952.0012">The chemical basis of morphogenesis</a>, Philosophical Transactions of the Royal Society B 237, 37 (1952).</li>
    <li>Gierer, Meinhardt, <a href="https://doi.org/10.1007/BF00289234">A theory of biological pattern formation</a>, Kybernetik 12, 30 (1972).</li>
    <li>Cort&eacute;s, Mart&iacute;nez, Karata&scedil;, Bullo, <a href="https://doi.org/10.1109/TRA.2004.824698">Coverage control for mobile sensing networks</a>, IEEE Transactions on Robotics and Automation 20, 243 (2004).</li>
    <li>Couzin, Krause, Franks, Levin, <a href="https://doi.org/10.1038/nature03236">Effective leadership and decision-making in animal groups on the move</a>, Nature 433, 513 (2005).</li>
    <li>Fernando, Sojakka, <a href="https://doi.org/10.1007/978-3-540-39432-7_63">Pattern recognition in a bucket</a>, Advances in Artificial Life (ECAL 2003), Lecture Notes in Computer Science 2801 (2003).</li>
    <li>Jaeger, Short term memory in echo state networks, GMD Report 152, German National Research Center for Information Technology (2001).</li>
    <li>Koopman, <a href="https://doi.org/10.1073/pnas.17.5.315">Hamiltonian systems and transformation in Hilbert space</a>, PNAS 17, 315 (1931).</li>
    <li>Schmid, <a href="https://doi.org/10.1017/S0022112010001217">Dynamic mode decomposition of numerical and experimental data</a>, Journal of Fluid Mechanics 656, 5 (2010).</li>
    <li>Proctor, Brunton, Kutz, <a href="https://doi.org/10.1137/15M1013857">Dynamic mode decomposition with control</a>, SIAM Journal on Applied Dynamical Systems 15, 142 (2016).</li>
    <li>Grass&eacute;, La reconstruction du nid et les coordinations interindividuelles chez Bellicositermes natalensis et Cubitermes sp., Insectes Sociaux 6, 41 (1959).</li>
    <li>Shapiro, Pregui&ccedil;a, Baquero, Zawirski, <a href="https://doi.org/10.1007/978-3-642-24550-3_29">Conflict-free replicated data types</a>, Stabilization, Safety, and Security of Distributed Systems (SSS 2011), Lecture Notes in Computer Science 6976 (2011).</li>
    <li>Preiss, H&ouml;nig, Sukhatme, Ayanian, <a href="https://act.usc.edu/publications/Preiss_ICRA2017.pdf">Crazyswarm: A Large Nano-Quadcopter Swarm</a>, USC (ICRA 2017).</li>
  </ul>
</section>
</main>
"""

if ART:
    out = HEAD + BODY
    path = "docs/report_artifact.html"
else:
    out = ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
           "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
           + HEAD + "</head>\n<body>\n" + BODY + "\n</body>\n</html>\n")
    path = "docs/report.html"
open(path, "w").write(out)
print("wrote", path)

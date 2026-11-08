"""When is a search finished? (Sim 12)

One drone explores a generated collapsed floor (liminal_sim.explore, the same
floors as Sim 9) with the nearest-frontier planner. It does NOT stop when it has
found every victim, because a real drone cannot know that. We ask when each
stopping rule would have ended the search, and what it would have missed.

Rules compared:
  budget 5 / 10 min - stop after a fixed time
  plateau           - stop when the map grew by less than 1 m^2 in the last 60 s
  exhausted         - stop when the frontier planner has no target left
                      (standard frontier exploration, Yamauchi 1997)
  topology          - when the planner is exhausted, audit the map: every unseen
                      region of at least 1 m^2 with an opening onto seen free space
                      is flagged; the drone flies to the nearest point it can reach
                      next to each flagged region and looks again; it stops when no
                      unvisited flagged region is left, and reports the regions
                      still flagged (it could not see into them) to rescuers, plus
                      closed-off unseen regions of at least 4 m^2 (see sealed())

The planner ignores unseen cells that touch a seen solid cell, because those are
usually inside or behind a wall (Sim 9). The audit uses the same test for where a
region can be looked into (its "mouth": unseen cells next to seen free space and
not touching seen solid), but it looks at whole regions, not at frontier cells.

Ground truth is used only to score: "unseen open space" is truly free space
connected to the start that the drone has not seen. Same simplifications as Sim 9:
2D, perfect localisation, ideal LiDAR, no drone dynamics.
"""
import math
import numpy as np
from scipy import ndimage
from skimage.graph import MCP_Geometric

from liminal_sim import explore as E
from liminal_sim.topology import FREE, OCC, UNK, N4, N8

RES = E.RES
A_FLAG = 1.0          # m^2: smallest unseen region the audit flags
VIEW_CELLS = 8        # a viewpoint must be within 0.8 m of a region's mouth


def _regions(grid):
    lab, n = ndimage.label(grid == UNK, structure=N4)
    mouth = (grid == UNK) & ~ndimage.binary_dilation(grid == OCC, structure=N4) & \
        ndimage.binary_dilation(grid == FREE, structure=N4)
    if n == 0:
        return lab, mouth, np.zeros(0), np.zeros(0, bool)
    idx = np.arange(1, n + 1)
    areas = ndimage.sum(np.ones_like(lab), lab, index=idx) * RES * RES
    has_mouth = ndimage.maximum(mouth, lab, index=idx).astype(bool)
    return lab, mouth, areas, has_mouth


def audit(grid, a_min=A_FLAG):
    """Flagged regions: unseen, at least a_min m^2, with a mouth onto seen free space."""
    lab, mouth, areas, has_mouth = _regions(grid)
    return [k + 1 for k in range(len(areas)) if has_mouth[k] and areas[k] >= a_min], lab, mouth


A_SEALED = 4.0        # m^2: smallest closed-off unseen region the audit reports
W_SEALED = 2          # erosion steps (cells): a reported closed region must hold a 0.5 x 0.5 m block


def sealed(grid, a_min=A_SEALED):
    """Closed-off unseen regions: no opening the drone could look through, at least
    a_min m^2, and at least 0.5 m wide somewhere (so a thin unseen layer of a wall
    does not count). From the map alone such a region may be solid (a thick wall,
    a rubble heap) or a room whose only opening is a crack; it is reported, not
    visited."""
    lab, mouth, areas, has_mouth = _regions(grid)
    if len(areas) == 0:
        return [], lab
    wide = ndimage.binary_erosion(grid == UNK, structure=N4, iterations=W_SEALED)
    has_wide = ndimage.maximum(wide, lab, index=np.arange(1, len(areas) + 1)).astype(bool)
    return [k + 1 for k in range(len(areas)) if not has_mouth[k] and areas[k] >= a_min and has_wide[k]], lab


def mopup_path(grid, pos, trav, attempted, a_min=A_FLAG):
    """Path to the nearest reachable viewpoint of a flagged region not yet visited."""
    flagged, lab, mouth = audit(grid, a_min)
    todo = [k for k in flagged if attempted[lab == k].mean() < 0.5]
    if not todo:
        return None, None
    cost = np.where(trav & (grid == FREE), 1.0, np.inf)
    mcp = MCP_Geometric(cost, fully_connected=True)
    dist, _ = mcp.find_costs([pos])
    best, best_d, best_k = None, np.inf, None
    for k in todo:
        near = ndimage.binary_dilation(mouth & (lab == k), structure=N4, iterations=VIEW_CELLS)
        dd = np.where(near, dist, np.inf)
        j = np.unravel_index(np.argmin(dd), dd.shape)
        if dd[j] < best_d:
            best, best_d, best_k = j, dd[j], k
    if best is None:
        return [], lab == todo[0]            # no reachable viewpoint for any: give up on one at a time
    return mcp.traceback(best), lab == best_k


def report(grid, open_space, victims, found, a_min=A_FLAG, sticky=None):
    """What the audit tells rescuers: flagged regions (area, truly open space inside,
    victims still unfound inside) and the unseen open space it does NOT flag.
    sticky: cells flagged earlier; they stay on the list until they are seen (a closer
    look can hide a region's mouth without showing what is inside)."""
    flagged, lab, mouth = audit(grid, a_min)
    closed, _ = sealed(grid)
    rep = np.isin(lab, flagged)
    rep_sealed = np.isin(lab, closed)
    rep = rep | rep_sealed
    if sticky is not None:
        rep |= sticky & (grid == UNK)
    comp, n = ndimage.label(rep, structure=N4)
    flags = []
    for k in range(1, n + 1):
        m = comp == k
        flags.append(dict(area_m2=float(m.sum() * RES * RES), open_inside_m2=float((m & open_space).sum() * RES * RES),
                          sealed=bool((m & rep_sealed).any() and not (m & np.isin(lab, flagged)).any()),
                          victims=int(sum(1 for i, v in enumerate(victims) if m[v[0], v[1]] and i not in found))))
    unseen = open_space & (grid == UNK)
    return dict(flags=flags, unseen_open_m2=float(unseen.sum() * RES * RES),
                unflagged_open_m2=float((unseen & ~rep).sum() * RES * RES)), rep


def run_search(seed, t_max=1800.0, speed=0.5, dt=1.0, sense_m=6.0, detect_m=4.0, log_every=5.0, a_min=A_FLAG):
    solid, start, victims, pk_masks = E.make_building(seed)
    clear = E.true_clearance(solid)
    open_space = E.open_space(solid, start)                           # truly free space connected to the start
    open_m2 = float(open_space.sum() * RES * RES)
    grid = np.full(solid.shape, UNK, dtype=np.int8)
    attempted = np.zeros(solid.shape, bool)
    pos = start
    found = {}
    t = 0.0
    path, replan_in, mode = [], 0, "frontier"
    target_region = None
    t_exhausted, t_done, rep_exhausted, ever_flagged = None, None, None, None
    log, next_log = [], 0.0
    step_cells = speed * dt / RES
    n_mopup = 0
    while t <= t_max:
        E.lidar(solid, grid, pos, sense_m)
        for i, (vy, vx, inp) in enumerate(victims):
            if i not in found and math.hypot(vy - pos[0], vx - pos[1]) * RES <= detect_m and E.visible(solid, pos, (vy, vx)):
                found[i] = t
        if t >= next_log:
            log.append(dict(t=t, area=float((grid != UNK).sum() * RES * RES), found=len(found),
                            unseen_open_m2=float((open_space & (grid == UNK)).sum() * RES * RES), mode=mode))
            next_log += log_every
        trav = E.traversable(grid == OCC)
        if not path or (mode == "frontier" and replan_in <= 0):
            if mode == "mopup" and target_region is not None:
                attempted |= target_region                  # arrived (or blocked): this region has had its look
                target_region = None
            p = E.choose("nearest", grid, pos, trav)
            if p is not None:
                path, mode, replan_in = p, "frontier", 4
            else:
                if t_exhausted is None:
                    t_exhausted = t
                    rep_exhausted, ever_flagged = report(grid, open_space, victims, found, a_min)
                ever_flagged = report(grid, open_space, victims, found, a_min, ever_flagged)[1]   # flags stay until seen
                p, reg = mopup_path(grid, pos, trav, attempted, a_min)
                if p is None:
                    t_done = t
                    break
                if not p:                                   # flagged but no reachable viewpoint
                    attempted |= reg
                    continue
                path, mode, target_region = p, "mopup", reg
                n_mopup += 1
        adv = 0.0
        while path and adv < step_cells:
            nxt = path.pop(0)
            if not trav[nxt] or clear[nxt] < 0.35:
                path = []; break
            adv += math.hypot(nxt[0] - pos[0], nxt[1] - pos[1])
            pos = nxt
        replan_in -= 1
        t += dt
    rep_end, reported = report(grid, open_space, victims, found, a_min, ever_flagged if t_exhausted is not None else None)
    log.append(dict(t=t, area=float((grid != UNK).sum() * RES * RES), found=len(found),
                    unseen_open_m2=float((open_space & (grid == UNK)).sum() * RES * RES), mode="end"))
    return dict(seed=seed, victims=[[int(v[0]), int(v[1]), bool(v[2])] for v in victims],
                found={int(k): float(v) for k, v in found.items()}, open_m2=open_m2,
                t_exhausted=t_exhausted, t_done=t_done, t_end=float(min(t, t_max)), n_mopup=n_mopup,
                report_exhausted=rep_exhausted, report_end=rep_end, log=log, grid=grid, reported=reported)


def stop_times(run, budgets=(300.0, 600.0), plateau_s=60.0, plateau_m2=1.0):
    """Time at which each rule ends the search (None = the rule never fired in this run)."""
    L = [e for e in run["log"] if e["mode"] != "end"]
    T = np.array([e["t"] for e in L]); A = np.array([e["area"] for e in L])
    out = {}
    for b in budgets:
        out[f"budget {b / 60:.0f} min"] = b if run["t_end"] >= b else None
    # plateau: judged on the exploration phase only (after the planner is exhausted a
    # plateau-only drone would have nothing left to do, so its map stops growing then)
    t_ex = run["t_exhausted"] if run["t_exhausted"] is not None else np.inf
    out["plateau"] = None
    for j, tj in enumerate(T):
        if tj < plateau_s or tj > t_ex:
            continue
        i = int(np.searchsorted(T, tj - plateau_s))
        if A[j] - A[i] < plateau_m2:
            out["plateau"] = float(tj); break
    if out["plateau"] is None and t_ex + plateau_s <= run["t_end"]:
        out["plateau"] = float(t_ex + plateau_s)
    out["exhausted"] = run["t_exhausted"]
    out["topology"] = run["t_done"]
    return out


def evaluate(run):
    st = stop_times(run)
    found, V = run["found"], run["victims"]
    L = run["log"]
    T = np.array([e["t"] for e in L]); U = np.array([e["unseen_open_m2"] for e in L])
    res = {}
    for rule, ts in st.items():
        t_stop = ts if ts is not None else run["t_end"]
        miss = [i for i in range(len(V)) if i not in found or found[i] > t_stop]
        unseen = float(np.interp(t_stop, T, U))
        if rule == "exhausted" and run["report_exhausted"] is not None:
            unseen = run["report_exhausted"]["unseen_open_m2"]
        if rule == "topology" and ts is not None:
            unseen = run["report_end"]["unseen_open_m2"]
        res[rule] = dict(t_stop=float(t_stop), fired=ts is not None, missed=len(miss),
                         missed_pocket=sum(1 for i in miss if V[i][2]), unseen_open_m2=unseen)
    # which rules tell rescuers anything: only the audit does; for the others all
    # unseen open space is missed silently
    for rule in res:
        rep = run["report_end"] if rule == "topology" else None
        res[rule]["silent_open_m2"] = rep["unflagged_open_m2"] if rep else res[rule]["unseen_open_m2"]
    rx = run["report_exhausted"]
    if rx is not None:
        e = res["exhausted"]
        res["exhausted + audit"] = dict(t_stop=e["t_stop"], fired=True, missed=e["missed"], missed_pocket=e["missed_pocket"],
                                        unseen_open_m2=rx["unseen_open_m2"], silent_open_m2=rx["unflagged_open_m2"])
    return dict(seed=run["seed"], rules=res, n_victims=len(V), n_pocket=sum(1 for v in V if v[2]),
                found_total=len(found), open_m2=run["open_m2"], n_mopup=run["n_mopup"],
                report_exhausted=rx, report_end=run["report_end"],
                t_exhausted=run["t_exhausted"], t_done=run["t_done"], t_end=run["t_end"])

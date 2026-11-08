"""2D exploration of a collapsed building by one drone (a horizontal slice of Layer 1).

World: a 40 x 30 m floor at 0.1 m cells, with rooms off a corridor, doorways,
rubble heaps, and small walled-in pockets that can only be looked into through a
narrow gap. Victims sit in open rooms and inside pockets.
Drone: a disc of radius 0.35 m, 0.5 m/s, a 360-degree LiDAR with 6 m range that
maps free and solid cells, and a camera/thermal sensor that detects a victim within
4 m when there is a clear line of sight.
Policies for choosing where to go next (frontier = known free cell next to unseen):
  nearest   - the closest frontier (Yamauchi 1997)
  utility   - the frontier cluster with the most unseen area per metre of travel
  topology  - utility, boosted for frontiers that open onto a candidate pocket
              (small, mostly walled-in unseen region; liminal_sim.topology.pockets)
  nearest_pockets - nearest frontier, but a frontier at a pocket counts as 6 m closer
This is a simplified 2D model: no drone dynamics, perfect localisation, ideal LiDAR.
"""
import math
import numpy as np
from scipy import ndimage
from skimage.graph import MCP_Geometric

from liminal_sim.topology import FREE, OCC, UNK, N4, N8, pockets

RES = 0.1


# ---------------------------------------------------------------- world
def _disc(shape, cy, cx, r):
    yy, xx = np.ogrid[:shape[0], :shape[1]]
    return (yy - cy) ** 2 + (xx - cx) ** 2 <= r * r


def make_building(seed, W=40.0, H=30.0, n_victims_open=3, n_pockets=4, n_rubble=22):
    """Returns (solid mask, start cell, victims list of (y, x, in_pocket), pocket masks)."""
    r = np.random.default_rng(seed)
    w, h = int(W / RES), int(H / RES)
    s = np.zeros((h, w), bool)
    t = 2                                                   # wall thickness: 0.2 m
    s[:t, :] = s[-t:, :] = s[:, :t] = s[:, -t:] = True
    cy0, cy1 = int(13.5 / RES), int(16.5 / RES)             # corridor along x
    s[cy0 - t:cy0, :] = True
    s[cy1:cy1 + t, :] = True
    for top in (True, False):
        x = t
        while x < w - t - 30:
            rw = int(r.uniform(5, 9) / RES)
            x2 = min(x + rw, w - t)
            s[(0 if top else cy1):(cy0 if top else h), x2:x2 + t] = True       # dividing wall
            dx = int(r.uniform(x + 8, max(x + 9, x2 - 18)))                     # 1 m doorway to the corridor
            wy = slice(cy0 - t, cy0) if top else slice(cy1, cy1 + t)
            s[wy, dx:dx + 10] = False
            if r.random() < 0.35 and x2 - x > 60:                               # some rooms split in two
                yy = int(r.uniform(3, 10) / RES) if top else int(r.uniform(20, 27) / RES)
                s[yy:yy + t, x:x2] = True
                gx = int(r.uniform(x + 5, x2 - 15))
                s[yy:yy + t, gx:gx + 10] = False
            x = x2 + t
    start = (int(15 / RES), int(1.5 / RES))
    # pockets: U-shaped collapsed walls, 1.6-2.4 m inside, one 0.9 m opening
    pk_masks, pk_cells = [], []
    tries = 0
    while len(pk_masks) < n_pockets and tries < 400:
        tries += 1
        a = int(r.uniform(1.6, 2.4) / RES)
        y0 = int(r.uniform(1, H - 4) / RES); x0 = int(r.uniform(4, W - 4) / RES)
        box = (slice(y0 - t, y0 + a + t), slice(x0 - t, x0 + a + t))
        if s[box].any() or abs(y0 + a / 2 - 15 / RES) < a / 2 + 25:
            continue                                         # keep clear of walls and the corridor
        sp = np.zeros_like(s)
        sp[box] = True
        sp[y0:y0 + a, x0:x0 + a] = False
        side = r.integers(4)
        o0 = int(r.uniform(2, a - 11))
        if side == 0: sp[y0 - t:y0, x0 + o0:x0 + o0 + 9] = False
        if side == 1: sp[y0 + a:y0 + a + t, x0 + o0:x0 + o0 + 9] = False
        if side == 2: sp[y0 + o0:y0 + o0 + 9, x0 - t:x0] = False
        if side == 3: sp[y0 + o0:y0 + o0 + 9, x0 + a:x0 + a + t] = False
        s |= sp
        inside = np.zeros_like(s); inside[y0:y0 + a, x0:x0 + a] = True
        pk_masks.append(inside); pk_cells.append((y0 + a // 2, x0 + a // 2))
    # rubble heaps (never on the start, never sealing the corridor completely)
    for _ in range(n_rubble):
        for _ in range(50):
            cy = r.uniform(0, h); cx = r.uniform(30, w)
            rad = r.uniform(0.3, 1.0) / RES
            m = _disc(s.shape, cy, cx, rad)
            if any((m & pm).any() for pm in pk_masks) or (cy0 - 2 < cy < cy1 + 2 and rad > 6):
                continue
            s |= m
            break
    # victims: some in pockets, some in open reachable space
    reach = reachable(s, start)
    victims = [(y, x, True) for (y, x) in pk_cells if reach[y, x]]
    free_cells = np.argwhere(reach & ~np.any(pk_masks, axis=0) if pk_masks else reach)
    for k in r.choice(len(free_cells), n_victims_open, replace=False):
        victims.append((int(free_cells[k][0]), int(free_cells[k][1]), False))
    return s, start, victims, pk_masks


def traversable(solid_known, radius=0.35):
    # a cell is traversable if it is not solid and at least `radius` from any solid cell
    return (ndimage.distance_transform_edt(~solid_known) * RES >= radius) & ~solid_known


def open_space(solid, start):
    """Truly free cells connected (4-connected) to the start: the space a person
    could be in. Free space walled off from the start (a sealed void) is excluded."""
    lab, _ = ndimage.label(~solid, structure=N4)
    return lab == lab[start]


def true_clearance(solid):
    """Distance (m) from each cell to the nearest real obstacle. Used only to stop the
    drone before it squeezes through a gap narrower than itself whose far side it has
    not mapped yet (it moves up to 0.5 m between scans)."""
    return ndimage.distance_transform_edt(~solid) * RES


def reachable(solid, start, radius=0.35):
    trav = traversable(solid, radius)
    lab, _ = ndimage.label(trav, structure=N8)
    return lab == lab[start]


# ---------------------------------------------------------------- sensing
_ANG = np.radians(np.arange(0, 360, 1.0))


def lidar(solid, grid, pos, rng_m=6.0):
    """Cast 360 rays from pos; mark free cells along each ray and the first solid cell."""
    n = int(rng_m / RES)
    steps = np.arange(1, n + 1)
    ys = pos[0] + np.outer(np.sin(_ANG), steps)
    xs = pos[1] + np.outer(np.cos(_ANG), steps)
    yi = np.clip(np.round(ys).astype(int), 0, solid.shape[0] - 1)
    xi = np.clip(np.round(xs).astype(int), 0, solid.shape[1] - 1)
    hit = solid[yi, xi]
    first = np.where(hit.any(1), hit.argmax(1), n)
    mask = steps[None, :] <= first[:, None] + 1              # up to and including the hit
    yy, xx = yi[mask], xi[mask]
    hh = hit[mask]
    grid[yy[~hh], xx[~hh]] = FREE
    grid[yy[hh], xx[hh]] = OCC
    grid[pos] = FREE                                          # the drone's own cell


def visible(solid, a, b):
    n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1]))) + 1
    ys = np.round(np.linspace(a[0], b[0], n)).astype(int)
    xs = np.round(np.linspace(a[1], b[1], n)).astype(int)
    return not solid[ys, xs].any()


# ---------------------------------------------------------------- planning
def frontier_clusters(grid, trav, min_cells=6):
    free = (grid == FREE) & trav
    # unseen cells touching a solid cell are usually inside or behind a wall and can
    # never be seen, so they do not make a frontier
    unk = (grid == UNK) & ~ndimage.binary_dilation(grid == OCC, structure=N4)
    fr = free & ndimage.binary_dilation(unk, structure=N4, iterations=4)
    lab, n = ndimage.label(fr, structure=N8)
    if n == 0:
        return lab, []
    sizes = ndimage.sum(fr, lab, index=np.arange(1, n + 1))
    return lab, [k + 1 for k in range(n) if sizes[k] >= min_cells]


def choose(policy, grid, pos, trav, unk_gain_r=2.0):
    lab, ks = frontier_clusters(grid, trav)
    if not ks:
        return None
    cost = np.where(trav & (grid == FREE), 1.0, np.inf)
    mcp = MCP_Geometric(cost, fully_connected=True)
    dist, _ = mcp.find_costs([pos])
    unk = (grid == UNK).astype(float)
    gain_map = ndimage.uniform_filter(unk, size=int(2 * unk_gain_r / RES) + 1)
    # pockets worth flying to: partly open (a camera can look in) and at least 1 m^2;
    # sealed ones are usually the solid core of a rubble heap or a wall
    pk = [p for p in pockets(grid, RES) if not p["sealed"] and p["area_m2"] >= 1.0] if policy in ("topology", "nearest_pockets") else []
    near_pk = None
    if pk:
        near_pk = ndimage.binary_dilation(np.any([p["cells"] for p in pk], axis=0), iterations=int(1.0 / RES))
    best, best_score, best_cell = None, -np.inf, None
    for k in ks:
        cells = np.argwhere(lab == k)
        dd = dist[cells[:, 0], cells[:, 1]]
        if not np.isfinite(dd).any():
            continue
        j = int(np.argmin(dd))
        c, dcost = tuple(cells[j]), dd[j] * RES
        if policy in ("nearest", "nearest_pockets"):
            score = -dcost
            if policy == "nearest_pockets" and near_pk is not None and near_pk[cells[:, 0], cells[:, 1]].any():
                score += 6.0                                   # a pocket counts as if it were 6 m closer
        else:
            gain = gain_map[cells[:, 0], cells[:, 1]].mean() * len(cells)
            score = gain / (dcost + 2.0)
            if policy == "topology" and near_pk is not None and near_pk[cells[:, 0], cells[:, 1]].any():
                score *= 4.0
        if score > best_score:
            best, best_score, best_cell = k, score, c
    if best_cell is None:
        return None
    path = mcp.traceback(best_cell)
    return path


# ---------------------------------------------------------------- episode
def run_episode(seed, policy, t_max=600.0, speed=0.5, dt=1.0, sense_m=6.0, detect_m=4.0, snap_times=()):
    """snap_times: times (s) at which a copy of the drone's map is kept (result["snaps"])."""
    solid, start, victims, pk_masks = make_building(seed)
    grid = np.full(solid.shape, UNK, dtype=np.int8)
    pos = start
    found = {}
    t = 0.0
    path, replan_in = [], 0
    hist_t, hist_area, hist_found = [], [], []
    step_cells = speed * dt / RES
    clear = true_clearance(solid)
    sealed_seen = set()
    snaps = {}
    while t <= t_max:
        lidar(solid, grid, pos, sense_m)
        for i, (vy, vx, inp) in enumerate(victims):
            if i not in found and math.hypot(vy - pos[0], vx - pos[1]) * RES <= detect_m and visible(solid, pos, (vy, vx)):
                found[i] = t
        if t in snap_times:
            snaps[t] = grid.copy()
        hist_t.append(t); hist_area.append(float((grid != UNK).sum() * RES * RES)); hist_found.append(len(found))
        if len(found) == len(victims):
            break
        trav = traversable(grid == OCC)
        if replan_in <= 0 or not path:
            path = choose(policy, grid, pos, trav)
            replan_in = 4
            if path is None:
                break
        # move along the path, stopping if a newly seen obstacle blocks it
        adv = 0.0
        while path and adv < step_cells:
            nxt = path.pop(0)
            if not trav[nxt] or clear[nxt] < 0.35:      # the real obstacle is closer than the map says: stop, look again
                path = []; break
            adv += math.hypot(nxt[0] - pos[0], nxt[1] - pos[1])
            pos = nxt
        replan_in -= 1
        t += dt
    n_pk = sum(1 for v in victims if v[2])
    return dict(seed=seed, policy=policy, n_victims=len(victims), n_pocket_victims=n_pk,
                found=len(found), found_pocket=sum(1 for i in found if victims[i][2]),
                t_all=float(max(found.values())) if len(found) == len(victims) else float("nan"),
                t_found=[float(v) for v in found.values()], t_found_pocket=[float(found[i]) for i in found if victims[i][2]],
                t_end=float(t), hist_t=hist_t, hist_area=hist_area, hist_found=hist_found,
                reach_area=float(reachable(solid, start).sum() * RES * RES), snaps=snaps)

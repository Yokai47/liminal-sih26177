"""Several drones searching a collapsed floor, with and without a radio.

Architecture section 10 (stigmergy): marks written into the environment let the
swarm coordinate with no transmission. They cannot be jammed, they persist (a
drone arriving an hour later still reads them), and people can read them.

World: the collapsed-building floors of Sims 9 and 12 (explore.make_building,
40 x 30 m, 0.1 m cells). K drones launch from the entrance one after another
(`launch_gap` s apart), fly at 0.5 m/s and keep 0.35 m from obstacles. A drone
searches the free cells within `sense_m` metres of it, measured along free space
(walls block it; a simple stand-in for line-of-sight detection). Each second a
drone heads for the nearest open-floor cell it can fly to and believes is
unsearched; once there are none, for the nearest place from which some cell it
believes unsearched (next to a wall, or behind a gap too narrow to fly through)
is within sensing range. Each drone adds its own fixed random preference (a
smooth random field of up to `spread_m` metres) to the distance, so that
identical drones do not all pick the same target.

What a drone believes is searched depends on the policy:
  alone    only what it searched itself (radio jammed, no marks)
  marks    it drops a mark every `mark_every_m` metres; a mark says "the area
           within sense_m of here has been searched". A drone that comes within
           `read_m` of a mark (along free space, as for searching) learns that.
  tags     as marks, but each mark is a data tag that stores the dropper's whole
           searched-map at the moment it is dropped; a reader merges that map into
           its own (an RFID tag with memory used as a dead drop)
  radio    every drone knows everything every drone has searched (ideal radio;
           upper bound)
  mesh     a radio of limited range: drones within `link_m` of each other
           (measured along free space, a rough stand-in for walls weakening the
           signal) are linked, messages hop along links, and every group of
           linked drones merges its searched-maps by set union (a CRDT: the order
           and repetition of merges do not matter). A group cut off from the rest
           keeps searching on its own and merges when it reconnects.
"""
import numpy as np
from numba import njit
from scipy import ndimage

from . import explore as E

RES = E.RES


@njit(cache=True)
def bfs(passable, sources_y, sources_x, maxd):
    """4-connected BFS distance (cells) from the sources through passable cells,
    stopping at maxd. -1 = not reached."""
    h, w = passable.shape
    dist = -np.ones((h, w), np.int32)
    qy = np.empty(h * w, np.int32)
    qx = np.empty(h * w, np.int32)
    head = 0
    tail = 0
    for k in range(sources_y.shape[0]):
        y = sources_y[k]
        x = sources_x[k]
        if passable[y, x] and dist[y, x] < 0:
            dist[y, x] = 0
            qy[tail] = y
            qx[tail] = x
            tail += 1
    while head < tail:
        y = qy[head]
        x = qx[head]
        head += 1
        d = dist[y, x]
        if d >= maxd:
            continue
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny = y + dy
            nx = x + dx
            if 0 <= ny < h and 0 <= nx < w and passable[ny, nx] and dist[ny, nx] < 0:
                dist[ny, nx] = d + 1
                qy[tail] = ny
                qx[tail] = nx
                tail += 1
    return dist


@njit(cache=True)
def ball(free, y, x, r, out):
    """Mark in `out` the free cells within r cells of (y, x) along free space
    (local BFS in a (2r+1)^2 window). Returns the number of newly marked cells."""
    h, w = free.shape
    y0 = max(0, y - r)
    x0 = max(0, x - r)
    y1 = min(h, y + r + 1)
    x1 = min(w, x + r + 1)
    sub = free[y0:y1, x0:x1]
    sy = np.array([y - y0], np.int32)
    sx = np.array([x - x0], np.int32)
    d = bfs(sub, sy, sx, r)
    new = 0
    for i in range(y1 - y0):
        for j in range(x1 - x0):
            if d[i, j] >= 0 and not out[y0 + i, x0 + j]:
                out[y0 + i, x0 + j] = True
                new += 1
    return new


@njit(cache=True)
def step_toward(dist_to_goal, y, x, nsteps):
    """Move up to nsteps cells down a distance field (4-connected)."""
    h, w = dist_to_goal.shape
    for _ in range(nsteps):
        d = dist_to_goal[y, x]
        if d <= 0:
            break
        by, bx, bd = y, x, d
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny = y + dy
            nx = x + dx
            if 0 <= ny < h and 0 <= nx < w:
                nd = dist_to_goal[ny, nx]
                if nd >= 0 and nd < bd:
                    by, bx, bd = ny, nx, nd
        if bd == d:
            break
        y, x = by, bx
    return y, x


@njit(cache=True)
def nearest_target(dist_from_drone, excluded, trav, pref):
    """Cell minimising (path distance + preference) among reachable traversable
    cells not in `excluded`. Returns (-1, -1) if none is reachable."""
    h, w = trav.shape
    best = 1e18
    by = -1
    bx = -1
    for i in range(h):
        for j in range(w):
            d = dist_from_drone[i, j]
            if d >= 0 and trav[i, j] and not excluded[i, j]:
                c = d + pref[i, j]
                if c < best:
                    best = c
                    by = i
                    bx = j
    return by, bx


def mesh_groups(positions, free, link_cells):
    """Groups of drones connected through chains of links (a link: within
    link_cells of each other along free space)."""
    n = len(positions)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(n):
        y, x = positions[i]
        reach = np.zeros(free.shape, bool)
        ball(free, y, x, link_cells, reach)
        for j in range(i + 1, n):
            if reach[positions[j][0], positions[j][1]]:
                parent[find(i)] = find(j)
    g = {}
    for i in range(n):
        g.setdefault(find(i), []).append(i)
    return list(g.values())


def world(seed):
    solid, start, victims, pockets = E.make_building(seed)
    trav = E.traversable(solid)
    lab, _ = ndimage.label(trav, structure=E.N4)
    trav = lab == lab[start]                         # traversable and connected to the entrance
    free = ~solid
    return solid, start, trav, free


def searchable(trav, free, r):
    """Free cells within r cells (along free space) of some traversable cell:
    everything a drone could search on this floor."""
    ys, xs = np.nonzero(trav)
    d = bfs(free, ys.astype(np.int32), xs.astype(np.int32), r)
    return d >= 0


def run(seed, policy, K=6, t_max=1500, speed=0.5, sense_m=3.0, read_m=3.0, mark_every_m=2.0,
        launch_gap=15, spread_m=5.0, prior_marks=None, prior_tags=None, prior_truth=None,
        active_until=None, stop_frac=0.995, wrld=None, write_marks_m=None, write_tags_m=None,
        link_m=10.0, log_groups=False):
    """One search. Returns dict with the coverage curve (fraction of searchable cells
    truly searched, each second), marks/tags left behind and distance flown.
    prior_marks / prior_tags: marks left by an earlier wave (persistence test);
    prior_truth: cells that wave already searched (counted in the coverage, but
    the new drones do not know about them unless marks tell them).
    active_until: second at which every drone stops (battery), None = t_max.
    write_marks_m / write_tags_m: drop marks / tags at this spacing whatever the
    policy (default: the policy's own kind at mark_every_m). Lets a wave that does
    not read marks still leave them for a later wave."""
    solid, start, trav, free = wrld if wrld is not None else world(seed)
    rs = int(round(sense_m / RES))
    rr = int(round(read_m / RES))
    srch = searchable(trav, free, rs)
    n_srch = srch.sum()
    rng = np.random.default_rng(seed * 1000 + 7)
    prefs = [ndimage.gaussian_filter(rng.random(trav.shape), 40) for _ in range(K)]
    prefs = [(p - p.min()) / (p.max() - p.min()) * spread_m / RES for p in prefs]
    truth = np.zeros_like(trav) if prior_truth is None else prior_truth.copy()
    believed = [np.zeros_like(trav) for _ in range(K)]
    marks = list(prior_marks or [])             # (y, x)
    tags = list(prior_tags or [])               # (y, x, map)
    read = [set() for _ in range(K)]            # indices of marks/tags already read
    pos = [start] * K
    since_mark = [0.0] * K
    since_tag = [0.0] * K
    if write_marks_m is None and policy == "marks":
        write_marks_m = mark_every_m
    if write_tags_m is None and policy == "tags":
        write_tags_m = mark_every_m
    flown = 0.0
    curve = []
    n_groups = []
    cells_per_s = int(round(speed / RES))
    end = t_max if active_until is None else min(t_max, active_until)
    for t in range(t_max):
        for k in range(K):
            if t < k * launch_gap or t >= end:
                continue
            y, x = pos[k]
            # search around the drone
            tmp = np.zeros_like(trav)
            ball(free, y, x, rs, tmp)
            truth |= tmp
            believed[k] |= tmp
            # read marks / tags in view
            if policy in ("marks", "tags") and (marks or tags):
                src = marks if policy == "marks" else tags
                near = np.zeros_like(trav)
                ball(free, y, x, rr, near)
                for i, m in enumerate(src):
                    if i not in read[k] and near[m[0], m[1]]:
                        read[k].add(i)
                        if policy == "marks":
                            ball(free, m[0], m[1], rs, believed[k])
                        else:
                            believed[k] |= m[2]
        if policy == "radio":
            for k in range(K):
                believed[k] |= truth
        elif policy == "mesh":
            act = [k for k in range(K) if k * launch_gap <= t < end]
            groups = mesh_groups([pos[k] for k in act], free, int(round(link_m / RES)))
            for g in groups:
                merged = np.zeros_like(trav)
                for i in g:
                    merged |= believed[act[i]]
                for i in g:
                    believed[act[i]] |= merged
            if log_groups:
                n_groups.append(len(groups))
        cov = (truth & srch).sum() / n_srch
        curve.append(cov)
        if cov >= stop_frac or t >= end:
            break
        # move
        shared = None
        idle = 0
        for k in range(K):
            if t < k * launch_gap or t >= end:
                idle += 1
                continue
            if active_until is not None and t == end - 1:
                # battery runs out after this tick's search: no last move, so no mark or
                # tag is dropped at a spot that is never searched (found by an
                # independent review: such a last mark claimed an unsearched 3 m ball)
                idle += 1
                continue
            y, x = pos[k]
            d = bfs(trav, np.array([y], np.int32), np.array([x], np.int32), 1 << 30)
            # stage 1: the nearest open-floor cell the drone can fly to and believes unsearched
            ty, tx = nearest_target(d, believed[k], trav, prefs[k])
            if ty < 0:
                # stage 2 (mop-up): open floor done; go where some unsearched cell near a
                # wall or in a gap is within sensing range
                if policy == "radio" and shared is not None:
                    not_goal = shared
                else:
                    uy, ux = np.nonzero(srch & ~believed[k])
                    near_un = bfs(free, uy.astype(np.int32), ux.astype(np.int32), rs) >= 0
                    not_goal = ~near_un
                    if policy == "radio":
                        shared = not_goal
                ty, tx = nearest_target(d, not_goal, trav, prefs[k])
            if ty < 0:
                idle += 1
                continue
            dg = bfs(trav, np.array([ty], np.int32), np.array([tx], np.int32), 1 << 30)
            ny, nx = step_toward(dg, y, x, cells_per_s)
            moved = (abs(ny - y) + abs(nx - x)) * RES
            flown += moved
            pos[k] = (ny, nx)
            if write_marks_m is not None:
                since_mark[k] += moved
                if since_mark[k] >= write_marks_m:
                    since_mark[k] = 0.0
                    marks.append((ny, nx))
            if write_tags_m is not None:
                since_tag[k] += moved
                if since_tag[k] >= write_tags_m:
                    since_tag[k] = 0.0
                    tags.append((ny, nx, believed[k].copy()))
        if idle == K and t >= (K - 1) * launch_gap:
            break                                  # every drone believes the floor is done
    curve = np.array(curve)
    return dict(curve=curve, marks=marks, tags=tags, flown=flown, n_searchable=int(n_srch), truth=truth,
                believed=believed, n_groups=n_groups, searchable=srch,
                believed_unsearched=[int((srch & ~b).sum()) for b in believed])


def time_to(curve, frac):
    hit = np.nonzero(curve >= frac)[0]
    return int(hit[0]) + 1 if len(hit) else None

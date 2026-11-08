"""Topology of an occupancy map: rooms, doorways, loops and enclosed pockets.

An occupancy grid has three kinds of cell: FREE (seen empty), OCC (seen solid) and
UNK (not seen yet). From it this module computes:

* Betti numbers of the free space. b0 counts separate free regions; b1 counts
  loops, i.e. solid or unseen islands that free space goes all the way around
  (a pillar, a rubble heap you can circle).
* A room graph by 0-dimensional persistent homology of the distance to the nearest
  obstacle. Picture water draining from the map: the deepest points of free space
  (room centres) appear first as separate pools; pools join at the narrowest point
  between them (a doorway). A pool that stays separate over a long range of levels
  (high persistence) is a real room; one that joins almost at once is just a bump.
  Rooms become nodes, the joining points become edges with a doorway width.
* Candidate pockets: unseen regions that are small and mostly walled in by solid
  cells. In a collapsed building those are where a trapped person may be, and the
  drone should look into them first. A pocket walled in completely is "sealed":
  no camera can see inside, so it is flagged for thermal, acoustic or radar checks.
"""
import zlib
import numpy as np
from scipy import ndimage

FREE, OCC, UNK = 0, 1, 2
N4 = ndimage.generate_binary_structure(2, 1)
N8 = ndimage.generate_binary_structure(2, 2)


def betti(free):
    """b0, b1 of a binary free-space mask (free 4-connected, complement 8-connected)."""
    _, b0 = ndimage.label(free, structure=N4)
    comp = np.pad(~free, 1, constant_values=True)          # the outside is one region
    _, n = ndimage.label(comp, structure=N8)
    return int(b0), int(n - 1)


def room_graph(free, res, min_persistence=0.4):
    """0-dim persistence of the distance-to-obstacle superlevel sets of free space.

    Returns (rooms, doors, labels): rooms = list of dict(cell, peak_m), doors = list of
    dict(a, b, cell, width_m), labels = room index of every free cell
    (-1 elsewhere), assigned by flooding from the room centres (watershed)."""
    d = ndimage.distance_transform_edt(free) * res
    h, w = free.shape
    idx = np.flatnonzero(free.ravel())
    order = idx[np.argsort(-d.ravel()[idx], kind="stable")]
    parent = -np.ones(h * w, dtype=np.int64)
    peak = np.zeros(h * w)                      # birth level of each component root
    peak_cell = np.zeros(h * w, dtype=np.int64)

    def find(a):
        r = a
        while parent[r] != r:
            r = parent[r]
        while parent[a] != r:                    # path compression
            parent[a], a = r, parent[a]
        return r

    merges = []                                  # (younger peak cell, older peak cell, saddle cell, level)
    dflat = d.ravel()
    for c in order:
        parent[c] = c; peak[c] = dflat[c]; peak_cell[c] = c
        y, x = divmod(c, w)
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w:
                n = ny * w + nx
                if parent[n] < 0:
                    continue
                ra, rb = find(c), find(n)
                if ra == rb:
                    continue
                if peak[ra] < peak[rb]:
                    ra, rb = rb, ra              # ra = elder (higher peak)
                merges.append((peak_cell[rb], peak_cell[ra], c, dflat[c], peak[rb]))
                parent[rb] = ra
    roots = {find(c) for c in idx}
    keep = {int(peak_cell[r]) for r in roots}    # the eldest of every free region never dies
    for yc, oc, sc, lev, pk in merges:
        if pk - lev >= min_persistence:
            keep.add(int(yc))
    keep = sorted(keep)
    rooms = [dict(cell=divmod(c, w), peak_m=float(dflat[c])) for c in keep]
    markers = np.zeros(free.shape, dtype=np.int32)
    for i, (y, x) in enumerate(r["cell"] for r in rooms):
        markers[y, x] = i + 1
    from skimage.segmentation import watershed
    labels = watershed(-d, markers, mask=free) - 1
    # doorways: where two room regions touch, the widest point of their shared border
    pa, pb, sc, cy, cx = [], [], [], [], []
    for a_, b_, dy, dx in ((labels[:, :-1], labels[:, 1:], 0, 1), (labels[:-1, :], labels[1:, :], 1, 0)):
        m = (a_ >= 0) & (b_ >= 0) & (a_ != b_)
        ys, xs = np.nonzero(m)
        pa.append(np.minimum(a_[m], b_[m])); pb.append(np.maximum(a_[m], b_[m]))
        sc.append(np.minimum(d[ys, xs], d[ys + dy, xs + dx])); cy.append(ys); cx.append(xs)
    doors = []
    if pa and sum(len(v) for v in pa):
        pa, pb, sc, cy, cx = (np.concatenate(v) for v in (pa, pb, sc, cy, cx))
        for key in set(zip(pa.tolist(), pb.tolist())):
            sel = np.nonzero((pa == key[0]) & (pb == key[1]))[0]
            j = sel[np.argmax(sc[sel])]
            doors.append(dict(a=int(key[0]), b=int(key[1]), cell=(int(cy[j]), int(cx[j])), width_m=float(2 * sc[j])))
    return rooms, doors, labels


def pockets(grid, res, max_area_m2=15.0, min_enclosed=0.6):
    """Unseen regions that are small and mostly walled in.

    Returns a list of dict(cells (bool mask), area_m2, enclosed (fraction of the
    region's boundary that is solid), sealed (True if no free cell borders it))."""
    unk = grid == UNK
    lab, n = ndimage.label(unk, structure=N8)
    if n == 0:
        return []
    border = set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])) - {0}
    out = []
    areas = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    for k in range(1, n + 1):
        if k in border or areas[k - 1] * res * res > max_area_m2:
            continue
        m = lab == k
        ring = ndimage.binary_dilation(m, structure=N4) & ~m
        vals = grid[ring]
        if vals.size == 0:
            continue
        enclosed = float((vals == OCC).mean())
        if enclosed >= min_enclosed:
            out.append(dict(cells=m, area_m2=float(areas[k - 1] * res * res), enclosed=enclosed,
                            sealed=bool((vals == FREE).sum() == 0)))
    return out


def graph_bytes(rooms, doors):
    """Size of the room graph as a radio message: per room x, y (int16) and peak (uint8);
    per door two room ids (uint8), x, y (int16) and width (uint8)."""
    return 2 + 5 * len(rooms) + 7 * len(doors)


def grid_bytes(grid):
    """Size of the occupancy grid: raw at 2 bits per cell, and zlib-compressed."""
    raw = int(np.ceil(grid.size * 2 / 8))
    return raw, len(zlib.compress(grid.astype(np.uint8).tobytes(), 9))

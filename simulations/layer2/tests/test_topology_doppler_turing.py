import os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim import topology as T
from liminal_sim import doppler as D
from liminal_sim import turing as G


def two_rooms():
    g = np.ones((100, 200), bool)
    g[0, :] = g[-1, :] = g[:, 0] = g[:, -1] = False
    g[:, 100] = False
    g[45:55, 100] = True          # 1 m doorway
    g[40:60, 40:60] = False       # a pillar in the left room
    return g


def test_betti_and_room_graph():
    g = two_rooms()
    assert T.betti(g) == (1, 1)                     # one free region, one loop (around the pillar)
    rooms, doors, labels = T.room_graph(g, 0.1)
    assert len(rooms) == 2 and len(doors) == 1
    assert abs(doors[0]["width_m"] - 1.0) < 0.15
    assert T.graph_bytes(rooms, doors) < T.grid_bytes(g.astype(np.int8))[1]


def test_pockets_open_and_sealed():
    grid = np.full((60, 60), T.FREE, np.int8)
    grid[10:30, 10:30] = T.OCC; grid[12:28, 12:28] = T.UNK          # sealed box of unseen space
    grid[35:55, 35:55] = T.OCC; grid[37:53, 37:53] = T.UNK
    grid[37:40, 35:37] = T.FREE                                      # a gap in the second box
    pk = sorted(T.pockets(grid, 0.1), key=lambda p: p["sealed"])
    assert len(pk) == 2 and pk[0]["sealed"] is False and pk[1]["sealed"] is True


def test_doppler_locates_source():
    t, pos, vel = D.path_L(8.0, 8.0, v=1.0)
    src = np.array([5.0, 4.0, 0.0])
    x, _ = D.simulate(t, pos, vel, src, 3100.0, snr1m_db=55.0, seed=2)
    tc, fh, _ = D.track(x)
    best, _, _ = D.locate(tc, fh, t, pos, vel, area=((-4, 16), (-10, 14)))
    assert np.hypot(*(best - src[:2])) < 1.0


def test_turing_spacing_grows_with_diffusion():
    n1, s1, _ = G.spot_spacing(1.0, n=96, steps=2000)
    n4, s4, _ = G.spot_spacing(4.0, n=96, steps=2000)
    assert n4 < n1 and 1.5 < s4 / s1 < 2.6                        # about sqrt(4) = 2


def test_audit_flags_open_unseen_regions_only():
    from liminal_sim import stopping as St
    grid = np.full((80, 80), T.FREE, np.int8)
    grid[0, :] = grid[-1, :] = grid[:, 0] = grid[:, -1] = T.OCC
    # a 2 x 2 m unseen region whose top side opens onto seen free space
    grid[10:31, 10] = grid[10:31, 31] = grid[30, 10:32] = T.OCC
    grid[10:30, 11:31] = T.UNK
    # the unseen core of a rubble heap: walled in on every side
    grid[50:62, 50:62] = T.OCC; grid[51:61, 51:61] = T.UNK
    flagged, lab, mouth = St.audit(grid, a_min=1.0)
    assert len(flagged) == 1
    assert lab[20, 20] == flagged[0] and lab[55, 55] not in flagged


def test_plateau_rule_uses_exploration_phase():
    from liminal_sim import stopping as St
    log = [dict(t=float(t), area=min(t, 100) * 1.0, found=0, unseen_open_m2=0.0, mode="frontier") for t in range(0, 400, 5)]
    run = dict(log=log, t_exhausted=300.0, t_done=350.0, t_end=400.0)
    st = St.stop_times(run)
    assert st["plateau"] == 160.0                      # area stops growing at 100 s; 60 s later the rule fires
    assert st["exhausted"] == 300.0 and st["topology"] == 350.0 and st["budget 5 min"] == 300.0


def test_sealed_regions_need_area_and_width():
    from liminal_sim import stopping as St
    grid = np.full((100, 100), T.FREE, np.int8)
    grid[0:2, :] = grid[-2:, :] = grid[:, 0:2] = grid[:, -2:] = T.OCC
    grid[0, :] = T.UNK                                    # unseen outer layer of a wall: thin, not reported
    grid[20:46, 20] = grid[20:46, 45] = grid[20, 20:46] = grid[45, 20:46] = T.OCC
    grid[21:45, 21:45] = T.UNK                            # a closed-off 2.4 x 2.4 m room: reported
    grid[60:72, 60] = grid[60:72, 71] = grid[60, 60:72] = grid[71, 60:72] = T.OCC
    grid[61:71, 61:71] = T.UNK                            # 1 m^2 closed core: too small
    closed, lab = St.sealed(grid)
    assert len(closed) == 1 and lab[30, 30] == closed[0]

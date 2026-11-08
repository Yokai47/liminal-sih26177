import os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from groundstation import protocol as P


def test_protocol_round_trip():
    pkt = P.pack_step(7, 120, [1, 2, 65535], [4, 5, 0], write=True, full=True)
    assert len(pkt) == 8 + 6 + 12
    t, seq, pay = P.parse_header(pkt)
    assert (t, seq) == (P.T_STEP, 7)
    assert P.unpack_step(pay) == (P.F_WRITE | P.F_FULL, 120, [1, 2, 65535], [4, 5, 0])
    rep = P.pack_step_reply(7, P.ST_OK, 99, [10, 20, 30], ([1, 2], [3, 4], [5, 6]))
    t, seq, pay = P.parse_header(rep)
    assert P.unpack_step_reply(pay) == (P.ST_OK, 99, [10, 20, 30], ([1, 2], [3, 4], [5, 6]))
    t, seq, pay = P.parse_header(P.pack_cmd(3, [-400, 400], [0, -1]))
    assert P.unpack_cmd(pay) == ([-400, 400], [0, -1])
    t, seq, pay = P.parse_header(P.pack_pose(4, 123456789, [-5, 4000], [7, 0]))
    assert P.unpack_pose(pay) == (123456789, [-5, 4000], [7, 0])
    assert P.parse_header(b"XX" + pkt[2:]) is None


def test_live_loop_short(tmp_path):
    """Three processes over UDP for 6 s: every step answered, 20 ms ticks, and the
    integer model replays the received headings exactly."""
    from groundstation.common import config
    from groundstation import run_demo, rtl_replay
    cfg = config(duration=6.0, start_delay=3.0, out_dir=str(tmp_path), engine_port=5105, gs_pose_port=5106,
                 world_cmd_port=5107, viewer_port=5108)
    s = run_demo.run(cfg, verbose=False)
    assert s["engine_replies_pct"] > 95
    assert abs(s["tick_ms_mean"] - 20.0) < 0.5
    r = rtl_replay.replay(str(tmp_path), steps=5, name="pytest_replay")
    assert r["headings_checked"] > 200 and r["headings_matching"] == r["headings_checked"]
    for ext in (".mem", "_w.mem", ".vh"):
        os.remove(os.path.join(rtl_replay.SIM, "test_pytest_replay" + ext))

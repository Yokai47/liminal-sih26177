"""Sim 8: the full demo loop over UDP, in real time.

Engine (the FPGA's integer model as a UDP server), simulated drones + cameras, and
the ground-station control loop run as three separate processes that talk only
through UDP packets, at real 50 Hz timing. Scenarios:
  nominal (6 seeds)       camera latency 10 ms, radio latency 20 ms, no loss
  radio loss 10%, 30%     command packets dropped on the way to the drones
  radio latency 100 ms    a slow link
  engine late replies     10% of engine replies arrive 15 ms late (after the 8 ms timeout)
  engine unplugged        the engine stops answering at 20 s for 3 s
Then the nominal session is replayed through the Verilog (fpga/sim, bit-exact check).
Each run takes its duration in real time (about 8 minutes in total).
Output: results/data/exp8_groundstation.json, results/data/gs_nominal/ (logs of one run)
"""
import json, os, shutil, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from groundstation.common import config
from groundstation import run_demo, rtl_replay

OUT = "results/data/gs_runs"
SCEN = [
    ("nominal", dict(seed=1)), ("nominal", dict(seed=2)), ("nominal", dict(seed=3)),
    ("nominal", dict(seed=4)), ("nominal", dict(seed=5)), ("nominal", dict(seed=6)),
    ("radio loss 10%", dict(radio_loss=0.1)), ("radio loss 30%", dict(radio_loss=0.3)),
    ("radio latency 100 ms", dict(radio_latency=0.100)),
    ("engine late replies", dict(engine_faults=[{"kind": "delay", "prob": 0.1, "ms": 15}])),
    ("engine unplugged 3 s", dict(engine_faults=[{"kind": "unplug", "start": 20.0, "dur": 3.0}])),
]

if __name__ == "__main__":
    t0 = time.time()
    res = []
    for i, (name, kw) in enumerate(SCEN):
        cfg = config(duration=40.0, out_dir=os.path.join(OUT, f"run{i}"), **kw)
        s = run_demo.run(cfg, verbose=False)
        s.update(scenario=name, **{k: v for k, v in kw.items() if k != "engine_faults"})
        res.append(s)
        print(f"{name}: misalignment {s['align_real_deg']:.1f} deg, rtt {s['rtt_us_p50']:.0f} us, "
              f"replies {s['engine_replies_pct']:.1f}%  ({time.time()-t0:.0f}s)", flush=True)
    rep = rtl_replay.replay(os.path.join(OUT, "run0"), steps=40)
    rtl = rtl_replay.run_iverilog(rep["name"])
    for src, keep in (("run0", "results/data/gs_nominal"), (f"run{len(SCEN)-1}", "results/data/gs_unplug")):
        shutil.rmtree(keep, ignore_errors=True)
        shutil.copytree(os.path.join(OUT, src), keep)
    shutil.rmtree(OUT, ignore_errors=True)
    json.dump({"runs": res, "replay": rep, "rtl": rtl, "runtime_s": time.time() - t0},
              open("results/data/exp8_groundstation.json", "w"), indent=1)
    print(rep, rtl)

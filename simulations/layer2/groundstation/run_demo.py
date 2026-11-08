"""Run the whole demo loop on one computer: engine + simulated world + ground station.

    python -m groundstation.run_demo                      # 40 s, nominal settings
    python -m groundstation.run_demo --duration 60 --viewer
    python -m groundstation.run_demo --radio-loss 0.1 --unplug 15 2

Each part runs as its own process and they talk only through UDP packets, exactly
as they will at the demo. At the end the logs are saved to --out and summarised.
"""
import argparse
import json
import multiprocessing as mp
import os

from groundstation.common import config, now
from groundstation import engine_server, world_sim, ground_station, analyse


def run(cfg, verbose=True):
    os.makedirs(cfg["out_dir"], exist_ok=True)
    t0 = now() + cfg["start_delay"]                 # everyone starts together; time to load Numba
    paths = {k: os.path.join(cfg["out_dir"], f"{k}.npz") for k in ("engine", "world", "gs")}
    external = cfg["engine_host"] not in ("127.0.0.1", "localhost")      # the FPGA, on its own IP
    procs = [mp.Process(target=world_sim.process_main, args=(cfg, t0, paths["world"])),
             mp.Process(target=ground_station.process_main, args=(cfg, t0, paths["gs"]))]
    if not external:
        procs.insert(0, mp.Process(target=engine_server.process_main, args=(cfg, t0, paths["engine"])))
    if cfg.get("viewer"):
        from groundstation import viewer
        procs.append(mp.Process(target=viewer.process_main, args=(cfg,)))
    for p in procs:
        p.start()
    n_main = 2 if external else 3
    for p in procs[:n_main]:
        p.join()
    for p in procs[n_main:]:
        p.terminate()
    json.dump(cfg, open(os.path.join(cfg["out_dir"], "config.json"), "w"), indent=1)
    summary = analyse.summarise(cfg["out_dir"])
    json.dump(summary, open(os.path.join(cfg["out_dir"], "summary.json"), "w"), indent=1)
    if verbose:
        analyse.print_summary(summary)
    return summary


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--duration", type=float, default=40.0)
    ap.add_argument("--eta", type=float, default=1.0, help="flock noise (radians); about 4 = disordered")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--radio-loss", type=float, default=0.0, help="fraction of command packets lost")
    ap.add_argument("--radio-latency", type=float, default=0.020, help="seconds")
    ap.add_argument("--cam-latency", type=float, default=0.010, help="seconds")
    ap.add_argument("--unplug", type=float, nargs=2, metavar=("START", "SECONDS"),
                    help="engine stops answering at START for SECONDS (like pulling the Ethernet cable)")
    ap.add_argument("--engine-host", default="127.0.0.1",
                    help="flock engine address; set to the FPGA's IP when the board is connected")
    ap.add_argument("--viewer", action="store_true", help="open a live window")
    ap.add_argument("--out", default="gs_run")
    a = ap.parse_args()
    faults = [{"kind": "unplug", "start": a.unplug[0], "dur": a.unplug[1]}] if a.unplug else []
    cfg = config(duration=a.duration, eta=a.eta, seed=a.seed, radio_loss=a.radio_loss,
                 radio_latency=a.radio_latency, cam_latency=a.cam_latency, engine_faults=faults,
                 engine_host=a.engine_host, viewer=a.viewer, out_dir=a.out)
    run(cfg)


if __name__ == "__main__":
    mp.freeze_support()
    main()

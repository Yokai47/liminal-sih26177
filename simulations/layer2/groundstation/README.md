# Ground station: the demo loop, end to end

This folder is the software that will run the hybrid demo: 8 real drones flying
inside a 120-agent virtual flock computed by the FPGA. Until the hardware exists, the
drones, the cameras and the FPGA are stand-ins; the control loop is the real one.

```
 cameras ──POSE──▶ ground station (laptop, 50 Hz) ──STEP──▶ flock engine
                     │   ▲                     ◀──STEP_REPLY──  (Python now, FPGA later)
                     │   └── safety layer
                     └──CMD──▶ drones
```

| File | What it is | Replaced at the demo by |
| --- | --- | --- |
| `ground_station.py` | The laptop's 50 Hz control loop | Nothing: this is the real program |
| `engine_server.py` | The flock engine as a UDP server, using the FPGA's exact integer model | The AXKU5 board (same packets) |
| `world_sim.py` | 8 simulated drones and motion-capture cameras, in real time | The real drones and cameras |
| `protocol.py`, `PROTOCOL.md` | The packet formats | |
| `run_demo.py` | Starts everything and summarises the run | |
| `viewer.py` | Live window of the flock | |
| `analyse.py` | Turns the logs into the same numbers as the offline simulation | |
| `rtl_replay.py` | Replays a recorded session through the Verilog engine | |

## Run it

From the repository's top folder:

```
python -m groundstation.run_demo                          (40 s run, prints a summary)
python -m groundstation.run_demo --viewer                 (with a live window)
python -m groundstation.run_demo --radio-loss 0.1         (lose 10% of drone commands)
python -m groundstation.run_demo --unplug 15 3            (engine silent from 15 s for 3 s)
python -m groundstation.rtl_replay gs_run                 (replay the run through the Verilog)
```

Each part runs as its own process and they talk only through UDP on this computer
(ports 5005 to 5008). Windows may ask whether Python can use the network: allow
it for private networks.

## When the FPGA arrives

The board will need an Ethernet interface that speaks `PROTOCOL.md` (the planned
FPGA version 2). Then:

```
python -m groundstation.run_demo --engine-host 192.168.1.10
```

with the board's IP address. The ground station then talks to the FPGA instead of
the Python engine; nothing else changes. Because the Python engine and the Verilog
compute identical numbers, results from this folder carry over to the board.

## What a run measures

The loop timing (interval between ticks, engine round trip), the age of the camera
data, how closely the drones follow the flock (same misalignment measure as Sim 4),
how close any two drones came, and what the drones do when packets are lost or the
engine goes silent. All drone and camera behaviour is ASSUMED until measured.

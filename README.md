# LIMINAL — Flow Chart & Simulations

**Team LIMINAL** · Smart India Hackathon 2026 · Problem Statement **SIH26177** (Qualcomm — autonomous drone swarm for search & rescue) · Team ID **#139614**

> A leaderless swarm of drones that self-organizes at the edge of flocking criticality and proves its own coverage complete, mapping and searching GPS-denied disaster sites with no central controller, no operator, and no prior map.

This repository holds the system flow chart(s) and simulation work for LIMINAL — the part of the project that shows *how* the swarm's decision-making and coordination logic behaves before it's committed to hardware.

## What's here

- **`/flowcharts`** — end-to-end flow diagrams: single-agent decision loop (frontier detection → local planning), and the swarm coordination layer (state-sharing mesh, Vicsek alignment, coverage merge).
- **`/simulations`** — simulation scripts, notebooks, and output plots/data used to validate the swarm logic before deployment on real hardware. *(Fill in: which simulator/framework, what's being tested — flocking behavior, coverage convergence, persistent-homology completion check, etc.)*
- **`README.md`** — this file.

## How to run

```bash
# fill in once the simulation environment is set up, e.g.:
pip install -r requirements.txt
python simulations/<entry_point>.py
```

## Why a flow chart and simulation first

The core bet behind LIMINAL is that identical, leaderless agents can produce reliable swarm behavior through local rules alone — no central controller, no operator. Before flying real hardware, the flow charts and simulations here validate that logic: that agents converge on the same decisions a leader would have handed down, without one ever existing.

## Reference / inspiration

The extrinsic motion-capture approach used for demonstrating swarm behavior at low cost is inspired by Joshua Bird's open-source system:

[![Open Source Motion Capture for Autonomous Drones](https://img.youtube.com/vi/0ql20JKrscQ/0.jpg)](https://www.youtube.com/watch?v=0ql20JKrscQ)

*(Reference and inspiration only — not our own footage.)*

Full citation list: see the References slide in the [project deck](#) *(link once shared)*.

## Team

Team LIMINAL — Smart India Hackathon 2026, PS 26177.

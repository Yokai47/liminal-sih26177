# LIMINAL ground-station protocol, version 1

Every packet is one UDP datagram. All fields are big-endian (network byte order),
fixed-size and unsigned unless marked signed, so the FPGA can parse a packet with a
simple byte counter. `protocol.py` is the reference implementation.

## Header (8 bytes, every packet)

| Offset | Size | Field | Value |
| --- | --- | --- | --- |
| 0 | 2 | magic | `0x4C 0x4D` ("LM") |
| 2 | 1 | version | 1 |
| 3 | 1 | type | see below |
| 4 | 4 | seq | sequence number; a reply echoes the request's |

## Engine link: laptop ↔ flock engine (UDP port 5005)

Today the engine is `engine_server.py`; on the AXKU5 it is the FPGA's Ethernet
interface in front of `vicsek_engine.v`. Positions are the engine's 16-bit units
(0 to 65,535 across the 4 m net); headings are 16-bit binary angles (65,536 = one turn).

**STEP (type 1), laptop → engine.** Write the drones' measured positions, run one step.

| Offset | Size | Field |
| --- | --- | --- |
| 8 | 2 | flags: bit 0 = write positions, bit 1 = return the full state |
| 10 | 2 | n, number of drones written (8) |
| 12 | 2 | first agent index written (120: drones occupy the last slots) |
| 14 | 4 × n | for each drone: x u16, y u16 |

Size with 8 drones: 46 bytes. Before stepping, the engine overwrites x and y of
agents `first .. first + n - 1`; their heading and random-number state are kept.

**STEP_REPLY (type 2), engine → laptop.**

| Offset | Size | Field |
| --- | --- | --- |
| 8 | 2 | status: bit 0 = OK |
| 10 | 4 | step counter |
| 14 | 2 | n |
| 16 | 2 × n | new heading of each written drone |
| 16 + 2n | 2 | (only if full state requested) total agents m |
| 18 + 2n | 6 × m | (only if full state requested) x, y, h of every agent |

Size with 8 drones: 32 bytes, or 802 bytes with the full state of 128 agents (one
packet; for thousands of agents the full state would need its own paged request).

**SET_PARAM (type 3), laptop → engine:** param id u16 (1 = noise etaq), value u32.
**PARAM_ACK (type 4)** echoes them.

## World link (simulated today)

**POSE (type 10), cameras → laptop, port 5006:** capture time u64 (ns), n u16, then
for each drone x, y as signed 16-bit millimetres.

**CMD (type 11), laptop → drones, port 5007:** n u16, then for each drone vx, vy
as signed 16-bit mm/s.

## Display

**VIEW (type 20), laptop → viewer, port 5008:** n u16, nv u16, round trip u32 (µs),
etaq u32, mode u8 (0 run, 1 hold, 2 hover), then x, y, h u16 for every agent.

## Timing rules

- The laptop sends one STEP per 20 ms tick and waits at most 8 ms for the reply.
- A reply whose seq is not the current tick's is ignored (it arrived late).
- No reply for up to 100 ms: the drones keep their last command. Longer: they
  hover (velocity 0) until replies return. The drone safety layer is always on.

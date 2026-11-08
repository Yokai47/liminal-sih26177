# Vicsek agent engine (FPGA, version 1.1)

This folder holds the first LIMINAL FPGA module: a circuit that updates a whole
flock of Vicsek agents, step by step, for the AMD Kintex UltraScale+ XCKU5P (the
chip on the ALINX AXKU5 board). The board is not needed to build or check it.

The engine has two modes, chosen with the `WALLS` parameter:

| | Version 1 (`WALLS = 0`) | Version 1.1 (`WALLS = 1`) |
| --- | --- | --- |
| Arena | Periodic box: leaving one edge brings an agent back in on the other | The 4 x 4 m demo net: soft walls push agents back, and anything crossing the boundary is mirrored back inside |
| Used for | Physics runs (large flocks, the fluctuation peak) | The hybrid demo: 120 virtual agents + 8 real drones |
| Real drones | none | Ordinary agents whose x, y the laptop overwrites with the camera measurement before every step |

**Status:** in simulation (Icarus Verilog) the Verilog matches the Python reference
model **bit for bit** in all eleven checks: version 1 with 64 and 256 agents and 1, 4, 8,
16 and 64 lanes; version 1.1 with the 128-agent demo flock (1, 8 and 16 lanes) and a
noisy 64-agent flock (4 and 64 lanes), with the testbench writing drone positions
before every step, including drones parked in a corner outside the boundary; and a
session recorded by the ground-station program (Sim 8), replayed with 16 lanes. The
integer model also flies the demo like the floating-point simulation (report,
Figure 4). Nothing has been run through Vivado or on hardware yet.

## What is in here

| Path | What it is |
| --- | --- |
| `rtl/vicsek_engine.v` | The circuit (Verilog) |
| `rtl/trig_lut_init.vh` | Cosine/sine table contents (generated) |
| `rtl/atan_tab.vh` | CORDIC arctangent table (generated) |
| `sim/tb_vicsek_engine.v` | Testbench: loads the Python model's starting state, runs the engine, compares every agent after every step |
| `sim/test_*.mem`, `sim/test_*.vh` | Expected results from the Python model (generated) |
| `sim/run_iverilog.sh`, `sim/run_iverilog.bat` | Runs all checks with the free Icarus Verilog simulator (Linux / Windows) |
| `vivado/build.tcl` | One-command Vivado build: synthesis, placement, routing, resource and timing reports |
| `vivado/constraints.xdc` | The clock target (250 MHz) |
| `vivado/run_sim.bat` / `run_sim.sh` | Runs the same testbench inside Vivado's own simulator |
| `gen_rtl_data.py` | Regenerates the tables and test files from `liminal_sim/fixedpoint.py` |
| `sim/test_walls_*_w.mem` | Walled tests: the laptop's writes before each step (drone address + state with camera x, y) |
| `yosys_estimate.py` | Open-source size estimate for the three main configurations (`results/data/fpga_estimate.json`) |

## How to run it

**Check the design (no Vivado needed):** install Icarus Verilog, then from `fpga/sim`:

```
sh run_iverilog.sh        (Linux, macOS, Git Bash)
run_iverilog.bat          (Windows Command Prompt)
```

Every line should start with `PASS`. The `.bat` version is written for Windows
but was only tested on Linux; tell me if it misbehaves.

**Build it in Vivado (free ML Standard edition, Kintex UltraScale+ device family):**
open the Vivado Tcl Shell, go to `fpga/vivado`, then run

```
vivado -mode batch -source build.tcl
```

It builds 4,096 agents with 16 lanes in the periodic box (version 1) by default.
The three numbers after `-tclargs` are agents, lanes and walls:

```
vivado -mode batch -source build.tcl -tclargs 128 16 1     (the demo flock, version 1.1; fast)
vivado -mode batch -source build.tcl -tclargs 4096 16 0    (the default)
```
 Read `out/summary.txt`
first, then `out/utilization.txt` and `out/timing.txt`. If the timing report shows
a negative WNS (worst negative slack), the design does not reach 250 MHz yet;
`summary.txt` estimates the clock it does reach.

**Run the testbench inside Vivado:** from `fpga/sim`, run `..\vivado\run_sim.bat`
(Windows) or `sh ../vivado/run_sim.sh` (Linux).

## How the circuit works, from scratch

**What an FPGA does here.** A processor runs instructions one after another. An
FPGA is a large grid of small logic blocks, adders, multipliers (DSP slices) and
memories (block RAM) whose wiring you choose. Verilog describes that wiring. Every
line in `vicsek_engine.v` becomes real hardware, and everything inside one
`always @(posedge clk)` block happens together on each clock tick (4 ns at 250 MHz).

**Numbers are integers.** The FPGA has no built-in floating point here, so every
quantity is a whole number with a fixed meaning:

- A position is a 16-bit number from 0 to 65,535 covering the box from 0 to L.
  When it passes 65,535 it rolls back to 0, which is exactly the periodic box of
  the Vicsek model. The hardware gets the wrap-around for free.
- A heading is a 16-bit "binary angle": 65,536 means one full turn. Turning past
  360° also rolls over by itself.
- Cosine and sine come from a 1,024-entry table stored in the chip, as signed
  numbers where 32,767 means 1.0.

**One step of the flock, in four phases.** The agents are handled in blocks of P
(the "lanes"; P = 16 by default):

1. **LOAD:** copy this block's P agents into the lanes.
2. **ACC (accumulate):** stream every agent of the flock past the lanes, one per
   clock tick. Each lane checks whether the passing agent is within radius R
   (`dx*dx + dy*dy <= R²`, using the chip's multipliers) and, if so, adds the
   passing agent's cosine and sine to its running sums.
3. **CORDIC:** each lane turns its two sums into an angle, the average heading.
   CORDIC finds an angle using only shifts and additions: it rotates the vector by
   smaller and smaller fixed angles (45°, 26.6°, 14°, …) until it points along the
   x-axis, and adds up the rotations it made. Sixteen rounds give an error below
   0.006°.
4. **UPD (update):** for each lane, draw a random number (one xorshift generator
   per agent), add noise to the heading, look up the new cosine and sine, move
   one step, and write the result into a second copy of the memory.

Every agent reads the old state and writes into the second copy, so all agents
move together, exactly as in the Python model. At the end of the step the two
copies swap roles.

**Version 1.1 adds two things.**

5. **WALL (P + 1 extra clock ticks per block):** a lane whose agent is inside
   the band next to the boundary (0.3 to 0.9 m from the net) adds a push toward the
   middle to its sums: its neighbour count, times how deep it is in the band, times
   a gain. This is the integer version of the soft-wall rule in
   `liminal_sim/hybrid.py`, so the flock turns before it reaches the edge. The
   lanes take turns on one shared multiplier: a first version gave every lane its
   own and needed about eight times as many DSP slices, for no useful gain in speed.
6. **Mirror in UPD:** after the move, an agent that crossed the boundary is mirrored
   back inside and its heading reflected, like a ball off a wall. Distances are now
   plain differences, because nothing wraps around.

**How the laptop uses it in the demo.** Every control tick (50 times a second):
read the 8 drone entries, write them back with x, y replaced by the cameras'
measurement (heading and random-number state unchanged), pulse `start`, wait for
`done`, then read the 8 new headings and turn them into velocity commands. The
safety layer that keeps drones apart stays on the laptop.

**Speed.** One step takes exactly (N / P) × (N + 2P + 22) clock ticks, plus P + 1
per block with walls. (Earlier versions of this file said N + P + 23; that undercounted
by P per block, which changes the 4,096-agent figure by 0.4%.) With 4,096 agents and
16 lanes that is about 1.06 million ticks, or about 4.2 ms at 250 MHz (roughly 235
steps per second). The demo flock, 128 agents with 16 lanes and walls, takes 1,592
ticks (the testbench reports 1,593 because it also counts the start handshake): about
**6.4 microseconds** per step, so the FPGA's share of the 20 ms control tick is
negligible. **250 MHz is a target, not a measured result.** Each lane does two
multiplies, a cosine-table read and several compares in a single clock tick, which may
need pipelining to reach it; Vivado's timing report will say. Even at a quarter of the
clock, the demo step stays under 30 microseconds. Doubling the lanes roughly halves the time.

**Size (estimate).** Open-source synthesis runs (Yosys, `synth_xilinx -family xcup`,
`python fpga/yosys_estimate.py`). The XCKU5P has 216,960 LUTs, 1,824 DSP slices and
480 block RAMs.

| Build | LUTs | Flip-flops | DSP slices | Block RAMs | Time per step at 250 MHz |
| --- | --- | --- | --- | --- | --- |
| 4,096 agents, 16 lanes, periodic box (v1) | about 25,800 (12%) | 3,800 | 35 (2%) | 18 (4%) | 4.25 ms |
| 4,096 agents, 16 lanes, walled arena (v1.1) | about 27,100 (13%) | 4,100 | 51 (3%) | 18 (4%) | 4.27 ms |
| Demo flock: 128 agents, 16 lanes, walled arena (v1.1) | about 26,800 (12%) | 4,000 | 43 (2%) | 2 | 6.4 µs |

Most of the logic is the 16 lanes themselves (each has its own CORDIC), so the
128-agent build is not much smaller than the 4,096-agent one; only the memory
shrinks. Vivado's real numbers will differ; `build.tcl` produces them.

## What version 2 should change

- **Grid neighbour search.** Version 1 checks every pair of agents. Sorting agents
  into cells first would cut the work by a large factor for big flocks.
- **More lanes.** 64 or 128 lanes would bring 4,096 agents under 1 ms per step.
- **Ethernet link.** A UDP interface so the laptop can send real drone positions
  in and read headings out every control tick. Alex Forencich's open-source
  `verilog-ethernet` supports UltraScale+.
- ~~**Walls.**~~ Done in version 1.1.

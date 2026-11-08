# LIMINAL Layer 2: review brief for an independent reviewer

This file is written to be handed to another AI model or a human expert along with the
repository (`liminal-layer2-sim`). It says what was built, how, what was found, which
file each number comes from, what is assumed, and what earlier reviews found. Section 1
is a ready-to-paste reviewer prompt.

**Everything in this repository is simulation.** No result comes from a flight or from
FPGA hardware. Drone behaviour (response time, disturbances, camera noise) is assumed.

---

## 1. Prompt to paste into the reviewing model

> You are a strict, independent technical reviewer: a senior examiner in swarm robotics,
> statistical physics, robot exploration, acoustic signal processing and FPGA design.
> Below (and in the attached repository, if provided) is the Layer 2 simulation work of
> LIMINAL, a final-year undergraduate project for a drone swarm for search and rescue.
> Your job is to find errors, not to praise. Look for:
> 1. code bugs that change a result (wrong formula, units, off-by-one, a metric computed
>    differently from how the text describes it);
> 2. numbers in the text that do not follow from the stated method or data;
> 3. claims the evidence does not support (overclaiming, misused terms such as phase
>    transition, susceptibility, Doppler shift, Turing pattern, persistent homology,
>    Betti number, Koopman operator, reservoir computing, echo-state property,
>    stigmergy, CRDT), conclusions that ignore a confound, unfair or weak baselines;
> 4. statistics too thin for the claim (number of runs, error bars, differences inside
>    the noise);
> 5. modelling assumptions that would change the conclusion if they were realistic;
> 6. wrong or misused citations;
> 7. FPGA claims that are not supported (timing, resources).
>
> For every finding give: where it is (section, file and line if you have the code),
> why it is wrong, how sure you are (confirmed / suspected), how serious it is
> (high: a result or claim is wrong; medium: misleading; low: minor), and a concrete fix.
> If you have the repository, recompute key numbers from `results/data/*.json` and run
> `python -m pytest -q`. Do not run the long experiments (exp3, exp3b, exp4, exp8, exp16).
> Rank findings most serious first. Then list what you checked and found correct.
> Do not repeat the limitations already admitted in section 7 of the brief unless you
> think they are understated.
> Treat every statement in the brief as a claim to check, not a fact. Say plainly which
> files you opened and which checks you could not do; do not invent line numbers, file
> contents or results; mark anything you are unsure about as suspected. Sims 13-17
> (sections 4.13-4.17) have had one independent review (round 3, section 9), and its
> fixes have not been re-reviewed, so check them hardest.
> No praise or padding.

---

## 2. Project in one paragraph

LIMINAL is a swarm of cheap drones for search and rescue inside collapsed buildings,
where there is no GPS. Layer 1 is a single autonomous drone (separate work). Layer 2 is
the swarm layer: many drones that flock, spread out and decide together without a
commander, with the swarm maths on an FPGA (AMD/Xilinx Kintex UltraScale+ XCKU5P,
on an ALINX AXKU5 board). The planned demo is 8 real drones in a 4 x 4 m motion-capture
net, flying among about 120 virtual agents computed by the FPGA, with a laptop ground
station in the loop. These simulations test the ideas before hardware, size the FPGA,
and set requirements for the demo.

## 3. Repository map

| Path | What it is |
| --- | --- |
| `liminal_sim/vicsek.py`, `fixedpoint.py`, `stats.py` | Vicsek flock (floating point, Numba), FPGA-style 16-bit integer model, statistics helpers |
| `liminal_sim/hybrid.py` | Real-plus-virtual flock in the 4 x 4 m net: drone dynamics, camera noise, latency, packet loss, soft walls, safety layer |
| `liminal_sim/control.py` | Extremum-seeking controller on the susceptibility |
| `liminal_sim/topology.py`, `explore.py`, `stopping.py` | Betti numbers, room graph, pockets; 2D exploration of collapsed floors; stopping rules and the topological audit |
| `liminal_sim/doppler.py` | Microphone simulation, pitch tracker, source localisation |
| `liminal_sim/turing.py` | Gierer-Meinhardt field and coverage policies |
| `groundstation/` | Real-time ground-station loop over UDP, engine server, drone/camera simulator, protocol, replay to Verilog |
| `fpga/rtl/vicsek_engine.v`, `fpga/sim/` | Verilog engine and Icarus Verilog testbench with test vectors from the Python integer model |
| `experiments/expN_*.py` | One script per result; writes `results/data/` |
| `experiments/make_figures.py`, `make_report.py` | Figures and `docs/report.html`, every number read from `results/data` |
| `docs/report.html` | Full write-up (20 figures) |
| `docs/layer2_demo.html`, `docs/explorer.html` | Browser demos |
| `liminal_sim/ugv.py`, `reservoir.py`, `koopman.py` | UGV steering a flock; the flock as a reservoir computer; Koopman/DMD models |
| `liminal_sim/stigmergy.py`, `comm.py` | Multi-drone search with marks, data tags or a mesh radio (CRDT merge); order-parameter estimators for missing reports and clock skew |
| `tests/` | 37 automatic checks (`python -m pytest -q`) |

## 4. The simulations: method, result, source

Numbers below are as generated on 8 November 2026. "Report Figure N" refers to `docs/report.html`.

### 4.1 Flocking physics (exp3, exp3b; report section 1, Figure 2)
- **Model:** 2D Vicsek, periodic box, 2 agents per R^2, speed 0.03 R per step, angular noise uniform in [-eta/2, eta/2], radius-R neighbourhood including self. Order parameter phi = |mean unit heading|; susceptibility chi = N var(phi).
- **Sizes:** N = 8, 32, 128, 512, 2,048, 4,096; long runs; 1 to 4 runs per point. N = 2,048 and 4,096 have 4 individually known runs near the peak (exp3 plus exp3b).
- **Result:** N = 8 shows no peak, only a plateau (chi about 0.24 from eta 4.5 to the end of the sweep at 5; random headings give 0.201 for N = 8; noise up to 2 pi was not simulated). A clear peak from N = 32; peak chi about 70 at N = 4,096 at eta 2.2 (2.2 +/- between-run SE 2.4), with eta 1.8-2.2 statistically indistinguishable (N = 2,048: 2.0-2.4).
- **Uncertainty:** where at least two runs are known individually, the standard error is from the spread between runs; elsewhere the report shows no +/- and uses "within 15% of the highest point" as the range (block errors within one run were found to understate the error up to 5x and are no longer shown).

### 4.2 Integer (FPGA) model vs exact model (exp2; section 2, Figure 3)
- 16-bit positions and headings, 1,024-entry cosine table, CORDIC arctangent.
- From the same state (512 agents, 3,072 updates compared): heading error 0.028 deg median, 0.15 deg worst; neighbour sets identical (guaranteed at this box size, because the float model starts from the integer positions).

### 4.3 Verilog engine (fpga/; section 2, Figure 4)
- Blocks of P lanes; each lane holds one agent; the flock streams past one agent per clock; CORDIC; double-buffered state. Version 1.1 adds soft walls, mirroring, and drone positions written before each step.
- **Bit-exact in all 11 Icarus Verilog checks** (64/256 agents, 1-64 lanes; 128-agent demo flock; noisy 64-agent walled flock; a recorded ground-station session).
- Clocks per step: (N/P)(N + 2P + 22), plus P + 1 per block with walls; demo flock 1,592 (testbench counts 1,593 including the start handshake). Time figures assume **250 MHz, not verified** (each lane does two multiplies, a table read and compares in one clock).
- Yosys (open-source, not Vivado) estimate for 4,096 agents and 16 lanes: 25,793 LUTs (12%), 3,797 FFs, 35 DSP (2%), 18 BRAM36 (4%).

### 4.4 Real-plus-virtual flock in the net (exp4, exp4b, exp4d, exp7; sections 3-5, Figures 5-7)
- **Model:** 120 virtual + 8 simulated drones, 4 x 4 m net, R = 0.5 m, 0.4 m/s, 50 Hz loop, soft walls 0.3 m inside the net, drone first-order velocity response tau = 0.3 s, 3 m/s^2 acceleration limit, 0.05 m/s velocity disturbance, 3 mm camera noise, loop latency 40 ms (all ASSUMED), 0.5 m safety push layer. 40 s runs, 3 runs per cell.
- **Latency is now exact:** a delay of d ticks is applied by buffers holding d entries (earlier versions added one extra tick per buffer, i.e. +40 ms; fixed and all affected experiments re-run).
- **Misalignment:** angle between a drone's actual travel over 0.2 s and its neighbours' mean heading; agents that moved less than 20% of nominal distance are excluded for both drones and virtual agents (the share of stalled drone samples is reported separately).
- **Results:** 1,032 agents in the net (about 70 neighbours each) keep one common heading at any noise: their order parameter stays at the ceiling sin(eta/2)/(eta/2) set by each agent's own noise (0.20 against 0.24 at eta 5), so there is no transition; with 7 nearest neighbours the flock never reaches a well-ordered state (phi at most 0.56 at eta 0.1-1.6, one run per value). At 128 agents: drone misalignment 13 deg (virtual 6 deg). Ordered flock: 13 deg at 20 ms, 15 deg at 100 ms, 19 deg at 200 ms, 30 deg at 400 ms latency; losing 50% of command packets changes it by -1 to +2 deg across latencies (3 runs per cell). No safety layer: closest drones 1.8 cm; 0.5 m layer: 38 cm. Response time 0.15/0.3/0.6 s: 10/14/21 deg. Integer engine flies like the exact model (13.7 vs 13.9 deg).

### 4.5 Hardware cost (exp5; section 6, Figure 8)
- Arithmetic: one distance check per lane per clock, assumed 250 MHz, 2 DSP and about 1,612 LUTs per lane (from the Yosys estimate), at most 75% of the LUTs used, two memory banks of 80-bit agent records. All-pairs at 100 Hz: about 15,700 agents (logic-limited, 100 lanes); with a grid: about 227,000 (memory-limited; an upper bound that ignores cell sorting and cell-list memory).
- CPU comparison (one cloud core): 4,096 agents at about 340 steps/s.

### 4.6 Controller and mode switching (exp6; section 7, Figure 9)
- Extremum seeking on chi: 512 agents settle at eta 2.55 and 2.52 (sweep's broad maximum 2.3-2.7). 8 agents drift to high noise (final values 4.41, still rising, and 4.59). Switching: re-forming order takes 20 steps (64 agents) and 159 (512); disordering takes 1-2 steps (one noise kick).

### 4.7 Repulsion and local order (exp4e; section 8, Figure 10)
- Short-range repulsion reduces how often the safety layer acts (94% of the time to 20-86%) only by raising drone misalignment (14 deg to 15-33 deg); alone it lets drones come within 7-15 cm. Set aside.

### 4.8 Ground-station loop over UDP, real time (exp8, groundstation/; section 9, Figure 11)
- Separate processes: ground station (50 Hz), engine server (the integer model), drone/camera simulator (cameras 100 Hz, 10 ms camera latency, 20 ms radio latency). Faults: radio loss, radio latency, late engine replies, engine unplugged.
- Nominal (6 runs): 13.6 deg (SD 1.0) vs 13.7 deg offline; 99% of ticks within 0.27 ms of 20 ms, worst 14.2 ms off; engine median round trip 0.34 ms. Single-run faults: 10%/30% loss 14.4/14.5 deg, late replies 15.2 deg (all within noise), 100 ms radio 17.5 deg. Engine unplugged 3 s: drones hover (0.37 to 0.03 m/s) and rejoin. Recorded session replayed: 1,999 of 1,999 heading sets match; Verilog PASS.

### 4.9 Topology and exploration (exp9; section 10, Figure 12)
- **World:** generated 40 x 30 m floors at 0.1 m cells: corridor, rooms with 1 m doors, 22 rubble heaps (0.3-1 m radius), 4 U-shaped pockets (1.6-2.4 m inside, one 0.9 m opening), victims (3 open + those in reachable pockets). One drone: disc of radius 0.35 m, 0.5 m/s, 360-ray 6 m LiDAR, victim seen within 4 m line of sight, perfect localisation, 2D. The drone stops before squeezing through a real gap narrower than itself.
- **Topology:** Betti numbers; rooms from 0-dimensional persistent homology of the distance-to-obstacle field (persistence 0.4 m) with watershed; doorways = widest point of the boundary between two room regions; pockets = small (<= 15 m^2), mostly walled (>= 60% solid boundary) unseen regions.
- **Results (30 floors, 10 min):** room graph of the example floor 283 bytes (24 rooms, 23 doors; free space walled off from the start is excluded) vs 30 KB raw grid / 1.4 KB compressed. Victims found all/in pockets: nearest frontier 86/85%, utility 79/69%, utility + pockets 85/81%, nearest + pockets 87/87% (nearest and nearest + pockets differ on only 3 of 30 floors). By design a victim sits in every reachable pocket (53% of victims), which favours pocket-seeking rules.
- **Pocket detector check:** on the drone's map 2 and 4 minutes into a search it flagged 0 of 112 and 3 of 89 still-unseen real pockets; of 72 flags the pockets-first rules would act on, 2 were real pockets. So the pockets-first gain for the utility planner does not come from recognising pockets. Reported as a negative result.

### 4.10 Doppler localisation (exp10; section 11, Figure 13)
- One microphone; source on the floor with a steady tone of unknown frequency (2.8-3.4 kHz); drone at 2 m height on a known path; f = f0 (1 + v_r / c) (moving listener, stationary source). Simulated propeller harmonics and broadband noise; STFT 0.4 s window, whitening across frequency, band lock, parabolic interpolation; grid search over position with f0 in closed form and a truncated quadratic loss. 30 trials per case.
- **Results:** L-shaped path: 100% within 1 m at 60/50/40 dB (median 3-4 cm), 10% at 30 dB, 0% at 20 dB. Straight pass: left/right mirror ambiguity (exactly symmetric fit), 100% within 1 m up to the mirror. Source pitch drift 0.1/0.2/0.5/2 Hz/sqrt(s): 97/93/57/13%. Speed 0.5 and 2 m/s: 100%.
- dB here = tone power at 1 m over noise power in a 1 Hz band.

### 4.11 Turing-pattern coverage (exp11; section 12, Figure 14)
- Gierer-Meinhardt on a grid with no-flux edges, semi-implicit cosine-transform stepping; searched ground stops producing activator; drones assigned to spots (Hungarian). Spot spacing vs activator diffusion: slope 0.48 on log-log (theory 0.5).
- Coverage: 8 drones, 32 x 32 m, 2 m sensing radius, 1 m/s, launched from one edge, 10 runs each, with/without 3 drones failing at 15 s. Time to 90% (mean +/- SD): Lloyd/Voronoi 41 +/- 2 s; Turing field alone 49 +/- 4 s (stalls at 97%); Turing + greedy mop-up 49 +/- 4 s; lawnmower with reassignment 48 +/- 1 s; greedy 48 +/- 7 s; random 135 +/- 23 s. With failures, all but random reach 90% (66-69 s, within each other's spread); all but the field alone (98%) finish. Conclusion in the report: the Turing field is not faster than simple rules; its case is a local, FPGA-friendly rule.

### 4.12 When is a search finished? (exp12; section 13, Figure 15)
- Same 30 floors; nearest-frontier planner run until it has no target (it is not told when all victims are found). Rules: 5- and 10-minute budgets, map-growth plateau, frontier exhaustion, exhaustion + topological audit (flag unseen regions >= 1 m^2 with an opening onto seen free space, plus closed-off unseen regions >= 4 m^2 and >= 0.5 m wide), and audit + fly back to look into each flagged region.
- **Results:** exhaustion found all 191 victims at 12.3 min on average; 10-minute budget missed 14%, 5-minute 52%, plateau 5%. At exhaustion about 31 m^2 of open floor per floor was still unseen (> 5 m^2 on 15 of 30 floors, up to 158 m^2), mostly behind gaps narrower than the drone. Open floor = free space 4-connected to the start; sealed voids are excluded. The audit reports all but 0.4 m^2 of it on average (max 1.2 m^2), with about 5.6 flags per floor, of which 31 of 168 held >= 1 m^2 of open floor and 118 held < 0.25 m^2 (false alarms: rubble cores, wall cavities). Looking again cost 3.3 minutes and found nothing more.
- Note: victims are placed only where the drone can fly, so this test cannot show a victim saved by the audit; it measures unseen open floor.

### 4.13 UGV symmetry breaking (exp13; section 14, Figure 16)
- Architecture claim: a visibly different UGV lets identical drones organise relative to it, with no messages. Tested form: following. Vicsek flock (density 2, v0 0.03, R 1, periodic box); one UGV at the drones' speed turns +/-90 deg every 3,000 steps; a drone within R of it adds w copies of the UGV's heading to its neighbour average; the UGV ignores the drones. Compared: no UGV, and a radio command adding w = 1 copy of the heading for every drone. Score G = mean over drones and time of cos(theta_j - psi). 8 runs x 8 turns per point.
- **Results (N = 128, w = 4):** G = 0.96 (eta 0.5), 0.89 (1.0), 0.64 (2.0), 0.30 (3.0, the fluctuation peak for 128 in Sim 3); no UGV about 0; radio command 0.60 at eta 3. w = 1: 0.19, w = 16: 0.33 at eta 3. Half-response after a turn 30-60 steps (measured on the mean response curve, 10-step sampling; at eta 3 single runs often reach half on the first sample). One UGV: N = 32 0.49, 128 0.30, 512 0.14 at eta 3, but eta 3 sits at a different distance from each size's own fluctuation peak (512 is already disordered there: phi 0.29 vs 0.44 for 128); at eta 1, where all are ordered, 0.93 / 0.89 / 0.80. Four UGVs in 512: 0.33 at eta 3 (vs 0.30 for one in 128, about 6 SE apart); the four sit on a regular grid with one shared heading, which makes the 512 box a 2 x 2 copy of the 128 case, so this is close to guaranteed by construction. UGVs at random positions or with independent headings not tested.
- Not tested: clustering around, avoiding or orbiting a UGV; walls; imperfect detection.

### 4.14 Reservoir computing (exp14; section 15, Figure 17)
- Task: UGV heading = (pi/2) u(t), u uniform in [-1, 1], new value every 50 steps (also 20 and 100). Readout: ridge regression on 51 coarse features of the drones only (4 x 4 grid of mean cos, mean sin, relative density; order; cos/sin of mean heading), sampled at the end of each interval. Trained on 3 runs (50,000 steps each; alpha by leave-one-run-out CV), scored on 2 fresh runs; 3 repeats. Targets: u(t - k), k = 0..10 (memory capacity MC = sum over k = 1..10 of test r^2, clipped at 0; Jaeger 2001); u(t) u(t - 1). Controls: input shuffled against targets; echo-state test = mean feature correlation between two copies with the same input and different starts and noise. Reference: a 51-node tanh echo state network (spectral radius 0.9, input and bias weights uniform +/-0.5), noise-free.
- **Results (hold 50):** current-input r^2 0.41 (eta 0.5), 0.23 (eta 3), 0.05 (eta 4.5); MC 0.11, 0.01, 0.00; product at most 0.12 over all runs (hold 100, eta 1); shuffled 0.00. Hold 100 at eta 1: current 0.62, MC 0.06. Consistency 0.25 (all features) / 0.57 (sine of the flock heading) at eta 0.5, 0.09 / 0.30 at eta 3. ESN reference: current 1.00, MC 8.8, product 0.98. Conclusion: computation falls steadily with noise; no optimum at the critical point; current + MC (at most 0.68, at hold 100 and eta 1; 0.52 at hold 50) is below the 1.0 that a single running average of the input would hold.

### 4.15 Koopman / DMD (exp15; section 16, Figure 18)
- 51 observables (as 4.14) every 10 steps; exact-DMD-style linear model z_k+1 = A z_k + B v_k + c on z-scored observables, rank chosen by leave-one-run-out validation at 5 samples (always chose 51, the largest offered, so in effect ordinary least squares on all observables plus the input); 3 training runs, 2 test runs of 5,000 samples; 3 repeats. Free flock (no UGV) and steered (UGV heading changes at random every 50 steps, given to the model as v = (cos psi, sin psi)). Baselines: persistence, long-run mean, AR(1) on phi alone, "constant" (training runs' mean heading), "copy the UGV's current heading", and (steered) a one-parameter smoother given the same known future UGV headings as DMD: s <- s + a * wrap(psi - s) each sample from the flock's heading, a fitted on the training runs at 5 samples ahead (chosen a = 0.05-0.1 for eta <= 3).
- **Results:** free flock, skill for phi at 10 steps = 0.56 (eta 1) and 0.45 (eta 3), identical to AR(1) on phi alone (largest difference 0.01); 0.00 by 100 steps. Free-flock heading: DMD = persistence. Steered flock, heading error 500 steps ahead: DMD with input 16 deg, smoother with input 17, constant 23, persistence 31, copy-UGV 49 (eta 1); 43 / 45 / 51 / 69 / 65 deg (eta 3). DMD and the smoother differ by at most 2 deg at any noise and horizon. Conclusion: the 51-observable model adds nothing over one-number rules, free or steered; the steered flock's predictability comes from the known UGV moves, not from the model. Free flock beyond 10 steps: DMD never better than AR(1), up to 0.03 worse (eta 0.5).

### 4.16 Stigmergy (exp16; section 17, Figure 19)
- Six drones, the 20 floors of Sims 9/12 (seeds 0-19), one entrance, launched 15 s apart, 0.5 m/s, 0.35 m clearance; searching = free cells within 3 m along free space (4-connected BFS; a stand-in for line of sight). Goal: nearest believed-unsearched traversable cell plus a smooth per-drone random preference (up to 5 m); when none is left, the nearest place from which a believed-unsearched cell is within 3 m (mop-up). Policies: ideal radio (shared truth), alone, simple marks (every 1 or 3 m; a mark = "the 3 m around here is searched"), data tags (every 10 or 25 m; a tag stores the dropper's whole believed-searched map); marks/tags read within 3 m along free space. Measure: time to 50/75/90/95/99% of searchable cells (free cells within 3 m of a reachable traversable cell); 90% is the main measure because the last percent is slow mop-up.
- **Results (time to 90%):** radio 5.1 min, tags 10 m 5.6, marks 1 m 5.7, marks 3 m 6.1, tags 25 m 6.3, alone 7.3. Paired by floor: alone - radio +134 +/- 10 s; marks 1 m -101 +/- 10 and tags 10 m -103 +/- 9 vs alone (75-76% of the gap recovered); marks 3 m -76 +/- 9; tags 25 m -62 +/- 9. Dropped per floor: 2,457 marks (1 m), 694 (3 m), 193 tags (10 m), 76 (25 m). At 99%: alone - radio +119 +/- 33 s; marks/tags gains 28-71 s, within the spread.
- Persistence: one shared first wave (alone, 180 s, writes marks every 1 m and tags every 10 m; 43% covered, 39 tags, 423 marks) then a second wave (different preferences). Time to 90%: alone 7.0 min; own marks only 5.5, own + first wave's marks 5.2 (-19 +/- 7 s); own tags only 5.4, own + first wave's tags 4.4 (-59 +/- 7 s); own tags + the first wave's full map handed over at the door 4.4 (-61 +/- 12 s).
- Here drones place the marks/tags; the architecture gives that job to UGVs. Each data tag stores the full 300 x 400 searched bitmap: 15 kB raw, about 1.1 kB compressed (median; 1.5 kB at most, zlib, measured on floors 0-2), more than common RFID/NFC user memory; no payload cap, read time or read range modelled.
- Re-run after round 3: the persistence test now stops drones without a last move on the battery's final second (before, a last mark could claim a 3 m ball that was never searched); the first wave now leaves 39 tags and 423 marks (was 41 and 426); second-wave times to 90% changed by under 1 s, to 95% and 99% by up to 4 and 18 s, within their standard errors.

### 4.17 Communication layer (exp17; section 18, Figure 20)
- Mesh: the 4.16 search with a radio of 5/10/20 m range along free space; groups connected through chains of links merge believed maps by union every second. Time to 90%: 5.3 / 5.0 / 5.1 min (paired vs ideal radio +9 +/- 5, -6 +/- 5, +0 s; 20 m gave the same times as the ideal radio on all 20 floors although the drones were split 21% of the time). Split 76 / 67 / 21% of the time. Cells believed searched but not searched: 0 in all runs (guaranteed by construction: beliefs only grow from real observations and merge by union, so this checks the code, not the CRDT claim; message delay, partial delivery and concurrency not modelled).
- Missing reports: free flock of 128, 25,000 steps (first 5,000 dropped), sampled every 25 steps, 4 runs per noise level. n of 128 report: random subset, or the n nearest one point. Correction: phi_c^2 = (phi_n^2 - f/n) / (1 - f/n), f = (N - n)/(N - 1), clipped at 0 (exact in expectation for phi^2 under random missingness; tested). Eta 4.5 (true 0.12), n = 8: plain 0.33, corrected 0.14, clustered 0.37; eta 3 (true 0.43): 0.51 / 0.39 / 0.61; n = 32 plain off by at most 0.06.
- Clock skew: flock of 128 steered by a UGV turning +/-90 deg every 3,000 steps; each drone's samples offset by a fixed integer in [-s, s] steps (sampled every 5). Eta 1: s = 10: phi error 0.008, heading error after turns 2 deg, susceptibility x 0.94; s = 300: 0.044, 15 deg, apparent drop of phi 0.15 after turns, susceptibility x 4.4. Eta 2: susceptibility x 0.88 at s = 10, x 0.75 at s = 30, x 1.17 at s = 300. (Re-run after round 3: the first version's first turn was 0 or 180 deg, which gave x 6.9.)

## 5. Browser demos
- `docs/layer2_demo.html`: Vicsek flock with an automatic noise sweep (ordered start, 150 steps per noise level, first 50 discarded); Gray-Scott reaction-diffusion with no-flux edges and two presets checked by running them (spots F 0.030 k 0.062; stripes F 0.038 k 0.061); unexplored-region counting with open vs sealed regions (sealed specks under 4 cells not counted), agents following a BFS distance field to the nearest open unknown cell.
- `docs/explorer.html`: the flock with a noise dial.

## 6. Review history
- **Round 1 (independent reviewer, no access to how the work was made):** 2 high, 9 medium, 7 low findings. All were checked and fixed: latency buffers (+40 ms) fixed and Sims 4/4b/4d/4e/7 re-run; misalignment metric made symmetric and Sim 8 re-run; greedy baseline and field-only variant added to Sim 11 and the lawnmower baseline made fair (assignment by distance, reassignment after failures); 8-agent susceptibility wording; between-run error bars and peak ranges; 7-nearest wording; logic and two-bank memory limits in Sim 5; 250 MHz labelled as unverified; Doppler straight pass scored up to its mirror image; figure numbering made sequential; switching times corrected (+1) and caveated; density and neighbour counts; Sim 8 single-run faults described as within noise; "same neighbours" noted as exact by construction; count mismatches; citations (Attanasi PRL 113, 238102; every reference now cited in the text; Turing/Gierer-Meinhardt framing; susceptibility-as-response hedged).
- **Also found and fixed while building Sim 12:** the exploring drone could squeeze through a real gap narrower than itself when its far side was unmapped (moves 0.5 m between scans); it now stops at the real gap. Sim 9 was re-run; its results did not change.
- **Round 2:** see section 8. **Round 3** (Sims 13-17): see section 9.
- **Sims 13-17 (added after round 2; reviewed in round 3, see section 9).** Bugs found and fixed by the author before the results were used: (1) Sim 15's DMD had no constant term, so it could not fit centred data whose mean shifts (caught by a unit test before the run); (2) Sim 16's first goal rule made drones stop with unsearched cells next to walls left over, and a first fix made them creep one cell per second; replaced by the two-stage rule in 4.16; (3) the Sim 14 reference echo state network had no bias input, so it could not do the (even) product task; bias added and the reference re-run; a "leaky average" reference whose parameter choice was arbitrary was dropped; (4) Sim 13's half-response time used the first sample as its start, so fast responses read as none; it now starts from 0 (the value just before a turn), and Sim 13 was re-run with a four-UGV case added; (5) Sim 16's first persistence test compared second waves after different first waves, and its "full map" reference did not let the second wave share among itself; it now uses one shared first wave and with/without pairs; (6) Sim 16's 99% time is dominated by mop-up; 90% is now the main measure.

## 7. Limitations already admitted
- All drone parameters are assumptions; no flight data. Camera, radio and drone dynamics are simple models.
- FPGA: no Vivado run yet; resources are open-source estimates; the clock is unverified.
- Exploration and search studies are 2D with perfect localisation and ideal sensors; victims are detected by line of sight within 4 m.
- Doppler: no echoes, no walls, stationary source, exactly known drone path.
- Turing and other coverage methods are computed centrally; drones are points with no obstacles.
- Sim 8 runs on one computer over localhost.
- The Sim 9 pocket detector does not find real pockets during a search (negative result); victims are placed in every reachable pocket by design.
- Sim 12 places victims only where the drone can fly, so it measures unseen open floor rather than victims saved by the audit.
- Fault cases in Sim 8 are single runs.
- Scope: every Layer 2 mechanism in the architecture document now has a simulation (criticality, Turing patterns, topology and completeness, the FPGA engine, the ground-station loop, Doppler, UGV symmetry breaking, stigmergy, Koopman/DMD, reservoir computing, the communication layer). The architecture document itself is not in this repository.
- Sims 13-15: periodic open box, no walls; drones detect the UGV perfectly within one radius; only following was tested (not clustering, avoiding or orbiting). Reservoir: one readout design (coarse 4 x 4 grid), one UGV of weight 4, 128 drones. Koopman: one set of observables; closed-loop control with the model not tested.
- Sims 16-17: 2D, perfect positions, marks/tags read without error within 3 m, no debris damage; drones (not UGVs) place the marks; mesh links are a distance rule along free space, with no packet loss or bandwidth limit inside a group; clocks have fixed offsets (no drift). Step duration (0.1 s) used only to translate clock offsets into seconds.

## 8. Round 2 findings (second independent reviewer) and what was done
- Earlier issues: 10 fully fixed, 7 partly. Completed: peak ranges now test every noise value (N = 2,048: 2.0-2.4); 7-nearest wording; figure files renamed to match the report's figure numbers (`fig1_...` to `fig15_...`); the testbench's 1,593 explained next to the Sim 8 replay line.
- **High: open floor was miscounted** (`reachable(..., radius=0)` returned the whole grid, so sealed voids counted as open floor). Fixed (`explore.open_space`, and `traversable` now always excludes solid cells); Sim 12 re-run: unseen open floor at exhaustion 31 m^2, not 50.
- **Same bug in the Sim 9 example**, and the pocket detector was never tested on part-explored maps. Fixed, and the new check (section 4.9) showed the detector does not work during a search; the report now says so.
- **Medium/low wording and assumptions:** pocket premise softened and the 53% pocket-victim design stated; Turing-alone 98% after failures; packet-loss effect stated as measured; explorer and demo text aligned with Sims 4 and 12; 8-agent controller final values; paired-floor comparison in Sim 9; logic capped at 75% in Sim 5 and the grid figure called an upper bound; Doppler band prior stated; stale docstrings; 8-agent "plateau" rather than "maximum".
- **Found by the author during round 2:** the dense-flock claim ("1,032 agents stay ordered") was misleading as worded, because each agent's own noise caps the order parameter at sin(eta/2)/(eta/2); the report and Figure 5 now show that ceiling and state that the dense flock sits on it.

## 9. Round 3 findings (independent reviewer of Sims 13-17) and what was done
The reviewer had only this brief and the repository, ran the tests, recomputed the stated numbers from `results/data/*.json`, and ran reduced versions of the experiments. Each finding was checked by the author before anything was changed.
- **Critical, Sim 15: unfair baselines.** The model was given the UGV's future headings, but the baselines it beat ("keeps its heading", "copies the UGV's current heading") were not. Added a constant-heading baseline and a one-parameter smoother given the same future headings; Sim 15 re-run. The smoother matches the 51-observable model within 2 deg at every noise and horizon (17 vs 16 deg at eta 1, 45 vs 43 at eta 3, 500 steps ahead). The conclusion "the model predicts the steered flock clearly better than simple rules" is withdrawn; the report, Figure 18 and the recommendation now say the model adds nothing over one-number rules.
- **Major, Sim 17: wrong first turn in the clock-skew test.** The first heading was zeroed after the cumulative sum, so the first kept turn was 0 or 180 deg. Fixed (`turn_headings`, with a test that every turn is +/-90 deg) and Part C re-run: susceptibility x 4.4 at eta 1 and s = 300 (was x 6.9); conclusions unchanged.
- **Major, Sim 13: confounded flock-size comparison.** Comparing sizes at eta 3 mixes the size effect with each size's distance from its own fluctuation peak, and the four-UGV case is a 2 x 2 tiling of the 128 case with one shared heading. Text, Figure 16 and the recommendation corrected: grip still falls with size at eta 1 (0.93 / 0.89 / 0.80), "one UGV per 128" is now a starting point to test, not a result.
- **Medium, Sim 16: tag payload not stated.** Stated (15 kB raw, about 1.1-1.5 kB compressed, more than common RFID/NFC tags); payload cap, read time and range named as not modelled.
- **Minor, Sim 16: a first-wave drone's last mark could claim an unsearched ball.** Fixed (no move on the battery's last second), with a test that fails on the old code; persistence test re-run (39 tags instead of 41; 90% times unchanged within 1 s).
- **Minor, wording:** Sim 14 best current + MC is 0.68 (hold 100, eta 1), not "about half"; Sim 15 free-flock "identical" holds at 10 steps, and further ahead the model is up to 0.03 worse than AR(1); validation always chose the largest rank (so in effect least squares); Sim 17's zero false cells is guaranteed by construction, so it checks the code, not the CRDT claim; the corrected order is exact on average for phi^2, so it reads a little low at intermediate order; the Sim 14 docstring's half-response time (now 30-60 steps) and "same input" for the reference reservoir (now "same kind of input") corrected; the consistency line is the sine of the heading; the half-response time's 10-step resolution stated; the unverifiable "targets differed 27 times on floor 0" removed.
- Not changed: the reviewer's spot checks of Sims 1-12 found no problems, and Sims 1-10 and 12 code was not reviewed in round 3.

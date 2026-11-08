"""Sim 5: how much hardware does the neighbour search need?

Every agent must find the agents within radius R. Two ways:
  all-pairs : check every pair, N^2 distance checks per update.
  grid      : sort agents into R x R cells first, then only check the 9 cells
              around each agent: about 9 * (agents per cell) checks per agent.

Hardware model (ASSUMPTIONS, to be replaced by Vivado numbers):
  * one "pair unit" does one distance check per clock: two multipliers
    (dx^2 and dy^2, i.e. 2 DSP slices), a compare and two adders;
  * clock 250 MHz (assumed; not yet confirmed by Vivado timing); XCKU5P has
    1,824 DSP slices and 216,960 LUTs;
  * each unit also needs logic: the open-source synthesis of the v1 engine
    (results/data/fpga_estimate.json, 4,096 agents, 16 lanes) gives about 1,600
    LUTs per lane, so logic, not DSP slices, limits the number of units; at most
    75% of the LUTs are used, leaving room for routing, I/O and control;
  * each agent record (x, y, heading, RNG state) is 80 bits, stored twice (the
    engine reads one bank and writes the other).

Two situations:
  constant density : the room grows with the flock (2 agents per R^2), as in Sim 3
  fixed arena      : the 4 x 4 m net with R = 0.5 m (64 R^2), as in the hybrid demo,
                     so more agents means a denser flock
Output: results/data/exp5_neighbour_cost.json
"""
import json, math, os

F_CLK = 250e6
DSP_PER_UNIT = 2
DSP_TOTAL = 1824
BITS_PER_AGENT = 2 * 80                               # two banks
_fe = json.load(open("results/data/fpga_estimate.json"))
LUT_TOTAL = _fe["device"]["LUT"]
LUT_PER_UNIT = _fe["totals"]["LUT"] / _fe["config"]["P"]   # whole v1 design divided by its lanes (conservative)
UTIL = 0.75                                               # leave a quarter of the logic for routing, I/O and control
MAX_UNITS = int(UTIL * LUT_TOTAL // LUT_PER_UNIT)
BRAM_URAM_BITS = 480 * 36 * 1024 + 64 * 288 * 1024   # XCKU5P block RAM + UltraRAM


def checks(n, scheme, case):
    if scheme == "all-pairs":
        return n * n
    area = n / 2.0 if case == "constant density" else 64.0   # in units of R^2
    per_cell = n / area                                          # agents per R x R cell
    return n * 9 * per_cell


rows = []
for case in ("constant density", "fixed arena"):
    for scheme in ("all-pairs", "grid"):
        for k in range(8, 18):
            n = 2 ** k
            for rate in (50, 100):
                c = checks(n, scheme, case)
                units = math.ceil(c * rate / F_CLK)
                rows.append(dict(case=case, scheme=scheme, n=n, rate_hz=rate, checks_per_update=c,
                                 pair_units=units, dsp=units * DSP_PER_UNIT, lut=units * LUT_PER_UNIT,
                                 fits=units * DSP_PER_UNIT <= DSP_TOTAL and units <= MAX_UNITS,
                                 memory_bits=n * BITS_PER_AGENT,
                                 memory_fits=n * BITS_PER_AGENT <= BRAM_URAM_BITS))


def max_n(scheme, case, rate):
    n = 1
    while True:
        c = checks(n * 2, scheme, case)
        u = math.ceil(c * rate / F_CLK)
        if u * DSP_PER_UNIT > DSP_TOTAL or u > MAX_UNITS or (n * 2) * BITS_PER_AGENT > BRAM_URAM_BITS:
            break
        n *= 2
    # refine linearly
    step = max(n // 64, 1)
    while True:
        c = checks(n + step, scheme, case)
        u = math.ceil(c * rate / F_CLK)
        if u * DSP_PER_UNIT > DSP_TOTAL or u > MAX_UNITS or (n + step) * BITS_PER_AGENT > BRAM_URAM_BITS:
            return n
        n += step


limits = {f"{case} / {scheme} / {rate} Hz": max_n(scheme, case, rate)
          for case in ("constant density", "fixed arena") for scheme in ("all-pairs", "grid") for rate in (50, 100)}
demo = [r for r in rows if r["n"] == 4096 and r["rate_hz"] == 100]
os.makedirs("results/data", exist_ok=True)
json.dump({"assumptions": dict(f_clk_hz=F_CLK, dsp_per_unit=DSP_PER_UNIT, dsp_total=DSP_TOTAL,
                               lut_total=LUT_TOTAL, lut_per_unit=LUT_PER_UNIT, lut_utilisation=UTIL, max_units_by_lut=MAX_UNITS,
                               bits_per_agent=BITS_PER_AGENT, on_chip_bits=BRAM_URAM_BITS),
           "rows": rows, "max_agents": limits, "demo_4096_at_100hz": demo},
          open("results/data/exp5_neighbour_cost.json", "w"), indent=1)
for k, v in limits.items():
    print(f"{k:42s} max agents ~ {v:,}")
for r in demo:
    print(r["case"], r["scheme"], "units", r["pair_units"], "DSP", r["dsp"])

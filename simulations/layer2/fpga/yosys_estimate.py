"""Open-source size estimate of the engine with Yosys (synth_xilinx -family xcup).
Vivado's real numbers will differ; fpga/vivado/build.tcl produces those.

  python fpga/yosys_estimate.py            -> results/data/fpga_estimate.json
Needs yosys on the PATH. The 4,096-agent builds take several minutes each.
"""
import json, os, re, subprocess, sys, tempfile, time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RTL = os.path.join(ROOT, "fpga", "rtl")
CONFIGS = [  # (N, P, WALLS, what it is)
    (4096, 16, 0, "physics runs: 4,096 agents, periodic box (version 1)"),
    (4096, 16, 1, "4,096 agents in the walled arena (version 1.1)"),
    (128, 16, 1, "the demo flock: 120 virtual + 8 drones, walled arena (version 1.1)"),
]
DEVICE = dict(part="xcku5p-ffvb676-2-i", LUT=216960, FF=433920, DSP=1824, BRAM36=480)


def synth(n, p, walls):
    aw = max((n - 1).bit_length(), 1)
    script = (f"read_verilog -I{RTL} {os.path.join(RTL, 'vicsek_engine.v')}; "
              f"chparam -set N {n} -set P {p} -set AW {aw} -set WALLS {walls} vicsek_engine; "
              f"synth_xilinx -family xcup -top vicsek_engine; tee -q -o {{stat}} stat")
    with tempfile.TemporaryDirectory() as td:
        stat = os.path.join(td, "stat.txt")
        subprocess.run(["yosys", "-q", "-p", script.replace("{stat}", stat)], capture_output=True, text=True, check=True)
        out = open(stat).read()
    cells = {}
    for m in re.finditer(r"^\s+(\S+)\s+(\d+)\s*$", out.split("Number of cells")[-1], re.M):
        cells[m.group(1)] = int(m.group(2))
    lut = sum(v for k, v in cells.items() if re.fullmatch(r"LUT\d", k))
    ff = sum(v for k, v in cells.items() if k.startswith("FD"))
    dsp = cells.get("DSP48E2", 0)
    bram = cells.get("RAMB36E2", 0) + 0.5 * cells.get("RAMB18E2", 0)
    clocks = (n // p) * (n + 2 * p + 22 + (p + 1) * walls)
    return dict(N=n, P=p, WALLS=walls, AW=aw, cells=cells, totals=dict(LUT=lut, FF=ff, DSP=dsp, BRAM36=bram),
                clocks_per_step=clocks, us_per_step_at_250MHz=clocks / 250.0)


if __name__ == "__main__":
    t0 = time.time()
    rows = []
    for n, p, w, what in CONFIGS:
        r = synth(n, p, w); r["what"] = what; rows.append(r)
        print(what, r["totals"], f"{r['us_per_step_at_250MHz']:.1f} us/step", f"{time.time()-t0:.0f}s", flush=True)
    old = os.path.join(ROOT, "results", "data", "fpga_estimate.json")
    keep = json.load(open(old)) if os.path.exists(old) else {}
    out = dict(tool="Yosys synth_xilinx -family xcup (open-source estimate; Vivado will differ)",
               device=DEVICE, builds=rows,
               rtl_tests=[dict(test="64 agents x 32 steps, periodic", lanes=[1, 4, 8, 64], result="bit-exact"),
                          dict(test="256 agents x 16 steps, periodic", lanes=[16], result="bit-exact"),
                          dict(test="128 agents (120 + 8 drones) x 40 steps, walled, drone positions written each step",
                               lanes=[1, 8, 16], result="bit-exact"),
                          dict(test="64 agents (56 + 8 drones) x 40 steps, walled, noise 4.0", lanes=[4, 64],
                               result="bit-exact")],
               clocks_per_step_formula="(N/P) * (N + 2P + 22), plus P + 1 per block when WALLS = 1",
               # kept for the report: the headline configuration
               config=dict(N=rows[0]["N"], P=rows[0]["P"], AW=rows[0]["AW"]), totals=rows[0]["totals"])
    json.dump(out, open(old, "w"), indent=1)
    print("saved", old)

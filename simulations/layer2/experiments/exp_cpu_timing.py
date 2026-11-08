"""How fast does an ordinary CPU core run the same flock? (for an honest FPGA comparison)
Single core, Numba-compiled cell-list Vicsek, constant density 2 per R^2, best of 3 runs of 100 steps.
Output: results/data/cpu_timing.json
"""
import json, os, platform, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from liminal_sim.vicsek import run_periodic, init_random, box_size

rows = []
for n in (128, 512, 4096, 16384, 65536):
    L = box_size(n, 2.0); x, y, th = init_random(n, L, 0)
    run_periodic(x, y, th, L, 1.0, 0.03, 2.5, 5, 0)
    steps = 200 if n <= 4096 else 40
    best = 1e9
    for rep in range(3):
        t = time.perf_counter(); run_periodic(x, y, th, L, 1.0, 0.03, 2.5, steps, rep)
        best = min(best, (time.perf_counter() - t) / steps)
    rows.append(dict(n=n, ms_per_step=best * 1e3, steps_per_s=1.0 / best))
    print(n, f"{best*1e3:.3f} ms/step")
json.dump({"machine": platform.processor() or platform.machine(), "cores_used": 1, "rows": rows,
           "note": "shared cloud virtual machine; a laptop core is typically faster"},
          open("results/data/cpu_timing.json", "w"), indent=1)

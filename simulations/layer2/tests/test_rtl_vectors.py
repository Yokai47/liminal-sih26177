"""The checked-in RTL test vectors must match what the Python model produces today."""
import os, subprocess, sys, filecmp, shutil, tempfile

ROOT = os.path.join(os.path.dirname(__file__), "..")


def test_vectors_up_to_date():
    sim = os.path.join(ROOT, "fpga", "sim")
    names = ["test_n64.mem", "test_walls_n128.mem", "test_walls_n128_w.mem"]
    before = [open(os.path.join(sim, f)).read() for f in names]
    subprocess.check_call([sys.executable, os.path.join(ROOT, "fpga", "gen_rtl_data.py")])
    after = [open(os.path.join(sim, f)).read() for f in names]
    assert before == after


def test_rtl_bit_exact():
    if shutil.which("iverilog") is None:
        import pytest
        pytest.skip("iverilog not installed")
    sim = os.path.join(ROOT, "fpga", "sim")
    out = subprocess.run(["sh", "run_iverilog.sh"], cwd=sim, capture_output=True, text=True).stdout
    assert out.count("PASS") == 11 and "FAIL" not in out, out

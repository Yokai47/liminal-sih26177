#!/bin/sh
# Open-source check with Icarus Verilog (what was used to verify this design).
# Run from fpga/sim:  sh run_iverilog.sh
set -e
for cfg in "test_n64.vh 8" "test_n64.vh 1" "test_n64.vh 64" "test_n64_ordered.vh 4" "test_n256.vh 16" \
           "test_walls_n128.vh 16" "test_walls_n128.vh 8" "test_walls_n128.vh 1" "test_walls_n64_noisy.vh 4" "test_walls_n64_noisy.vh 64" \
           "test_replay_session.vh 16"; do
  set -- $cfg
  iverilog -g2012 -I ../rtl -I . -DTEST_VH=\"$1\" -Ptb.P=$2 -o tb.vvp tb_vicsek_engine.v ../rtl/vicsek_engine.v
  vvp -n tb.vvp | grep -E "PASS|FAIL|MISMATCH"
done
rm -f tb.vvp

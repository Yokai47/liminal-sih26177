#!/bin/sh
# Same as run_sim.bat, for Linux. Run from fpga/sim:  sh ../vivado/run_sim.sh
xvlog -sv -i ../rtl -i . -d TEST_VH=\"test_n64.vh\" tb_vicsek_engine.v ../rtl/vicsek_engine.v && \
xelab -generic_top "P=8" tb -s tb_sim && xsim tb_sim -runall

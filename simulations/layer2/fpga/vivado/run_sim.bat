@echo off
REM Run the bit-exact testbench in Vivado's own simulator (xsim) on Windows.
REM Open "Vivado 20xx Tcl Shell" or a terminal where Vivado is on the PATH,
REM cd into fpga\sim, then run:  ..\vivado\run_sim.bat
REM Expected last line: PASS: 64 agents x 32 steps match the Python model bit for bit
call xvlog -sv -i ../rtl -i . -d TEST_VH="test_n64.vh" tb_vicsek_engine.v ../rtl/vicsek_engine.v || exit /b 1
call xelab -generic_top "P=8" tb -s tb_sim || exit /b 1
call xsim tb_sim -runall

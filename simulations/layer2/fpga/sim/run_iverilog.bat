@echo off
REM Windows version of run_iverilog.sh. Needs Icarus Verilog on the PATH (bleyer.org/icarus).
REM Run from fpga\sim:  run_iverilog.bat     Every line should start with PASS.
for %%C in ("test_n64.vh 8" "test_n64.vh 1" "test_n64.vh 64" "test_n64_ordered.vh 4" "test_n256.vh 16") do call :run %%~C
REM walled arena (version 1.1)
for %%C in ("test_walls_n128.vh 16" "test_walls_n128.vh 8" "test_walls_n128.vh 1" "test_walls_n64_noisy.vh 4" "test_walls_n64_noisy.vh 64") do call :run %%~C
REM a recorded ground-station session (groundstation/rtl_replay.py)
for %%C in ("test_replay_session.vh 16") do call :run %%~C
del tb.vvp 2>nul
goto :eof
:run
iverilog -g2012 -I ../rtl -I . -DTEST_VH=\"%1\" -Ptb.P=%2 -o tb.vvp tb_vicsek_engine.v ../rtl/vicsek_engine.v || exit /b 1
vvp -n tb.vvp | findstr /C:"PASS" /C:"FAIL" /C:"MISMATCH"
goto :eof

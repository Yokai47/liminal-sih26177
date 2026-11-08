# LIMINAL Vicsek engine - one-command Vivado build (no board needed)
# ------------------------------------------------------------------
# Synthesises, places and routes the engine for the XCKU5P (ALINX AXKU5 chip)
# "out of context", i.e. as a block on its own without pin assignments, and
# writes the resource and timing reports.
#
# Run it from this folder (fpga/vivado), either way:
#   Command Prompt with Vivado on the PATH:   vivado -mode batch -source build.tcl
#   Vivado Tcl Shell (Start menu):            cd <path>/fpga/vivado   then   source build.tcl
# Choose the flock size, lane count and arena with the three "set" lines below,
# or from a Command Prompt with:  vivado -mode batch -source build.tcl -tclargs 4096 16 0
#   WALLS 0 = periodic box (physics runs, version 1)
#   WALLS 1 = walled demo arena (version 1.1); the demo flock is  -tclargs 128 16 1
# A small first build (e.g. 128 16 1) finishes much faster.
#
# Results:  out/utilization.txt  (how much of the chip it uses)
#           out/timing.txt       (does it meet 250 MHz? look for "WNS" >= 0)
#           out/summary.txt      (the key numbers in a few lines)

set N  4096
set P  16
set WALLS 0
if {[info exists argc] && $argc >= 1} { set N [lindex $argv 0] }
if {[info exists argc] && $argc >= 2} { set P [lindex $argv 1] }
if {[info exists argc] && $argc >= 3} { set WALLS [lindex $argv 2] }
set AW [expr {int(ceil(log($N)/log(2)))}]
set part xcku5p-ffvb676-2-i
set out ./out
file mkdir $out

read_verilog [list ../rtl/vicsek_engine.v]
read_xdc constraints.xdc

synth_design -top vicsek_engine -part $part -mode out_of_context \
    -include_dirs ../rtl -generic N=$N -generic P=$P -generic AW=$AW -generic WALLS=$WALLS
opt_design
place_design
route_design

report_utilization    -file $out/utilization.txt
report_timing_summary -file $out/timing.txt

set wns [get_property SLACK [get_timing_paths -max_paths 1 -nworst 1 -setup]]
set period 4.000
set fmax [expr {1000.0 / ($period - $wns)}]
set clocks_per_step [expr {($N / $P) * ($N + 2 * $P + 22 + ($P + 1) * $WALLS)}]
set steps_per_s [expr {$fmax * 1.0e6 / $clocks_per_step}]
set f [open $out/summary.txt w]
puts $f "agents N = $N, lanes P = $P, WALLS = $WALLS, part $part"
puts $f "worst negative slack at 250 MHz: $wns ns"
puts $f [format "estimated max clock: %.1f MHz" $fmax]
puts $f "clocks per step: $clocks_per_step"
puts $f [format "steps per second at that clock: %.1f" $steps_per_s]
close $f
puts [read [open $out/summary.txt]]

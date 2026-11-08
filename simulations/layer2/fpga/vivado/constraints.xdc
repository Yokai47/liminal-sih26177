# Clock target for the out-of-context build: 250 MHz (4.000 ns).
# Lower it (e.g. 5.000 ns = 200 MHz) if timing fails, or raise it to see the limit.
create_clock -period 4.000 -name clk [get_ports clk]

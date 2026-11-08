// Testbench: load the Python model's starting state, run the engine step by
// step, and compare every agent's x, y, heading and RNG state with the Python
// model's numbers. Any difference at all is reported as a failure.
// Walled tests (T_WALLS = 1) also act as the laptop: before each step they write
// T_NW agent entries (the real drones, with camera-measured x, y) from T_WMEM.
//
// Build and run (from fpga/sim), e.g. for the 64-agent test with 8 lanes:
//   iverilog -g2012 -I ../rtl -I . -DTEST_VH=\"test_n64.vh\" -Ptb.P=8 \
//            -o tb.vvp tb_vicsek_engine.v ../rtl/vicsek_engine.v && vvp tb.vvp
`timescale 1ns/1ps
module tb;
`ifdef TEST_VH
    `include `TEST_VH
`else
    `include "test_n64.vh"
`endif
    parameter P = 8;

    reg clk = 0, rst = 1, start = 0, wr_en = 0;
    reg  [T_AW-1:0] wr_addr = 0, rd_addr = 0;
    reg  [79:0] wr_data = 0;
    wire [79:0] rd_data;
    wire busy, done;
    always #2 clk = ~clk;   // 250 MHz

    vicsek_engine #(.N(T_N), .P(P), .AW(T_AW), .WALLS(T_WALLS)) dut (
        .clk(clk), .rst(rst), .rq2(T_RQ2), .vq(T_VQ), .etaq(T_ETAQ),
        .lo(T_LO), .hi(T_HI), .wlo(T_WLO), .whi(T_WHI), .wk(T_WK),
        .wr_en(wr_en), .wr_addr(wr_addr), .wr_data(wr_data), .rd_addr(rd_addr), .rd_data(rd_data),
        .start(start), .busy(busy), .done(done));

    reg [79:0] expect_mem [0:(T_STEPS + 1) * T_N - 1];
    reg [95:0] write_mem [0:(T_NW > 0 ? T_STEPS * T_NW : 1) - 1];   // {16-bit address, 80-bit state}
    integer i, s, errors, cycles, step_cycles;

    initial begin
        $readmemh(T_MEM, expect_mem);
        if (T_NW > 0) $readmemh(T_WMEM, write_mem);
        errors = 0;
        repeat (4) @(posedge clk);
        rst = 0;
        // load step-0 state
        for (i = 0; i < T_N; i = i + 1) begin
            @(negedge clk); wr_en = 1; wr_addr = i; wr_data = expect_mem[i];
        end
        @(negedge clk); wr_en = 0;
        for (s = 1; s <= T_STEPS; s = s + 1) begin
            // the laptop's writes for this step (drone positions from the cameras)
            for (i = 0; i < T_NW; i = i + 1) begin
                @(negedge clk); wr_en = 1;
                wr_addr = write_mem[(s - 1) * T_NW + i][95:80];
                wr_data = write_mem[(s - 1) * T_NW + i][79:0];
            end
            @(negedge clk); wr_en = 0;
            @(negedge clk); start = 1;
            @(negedge clk); start = 0;
            cycles = 0;
            while (!done) begin @(posedge clk); cycles = cycles + 1; end
            step_cycles = cycles;
            // read back and compare
            for (i = 0; i < T_N; i = i + 1) begin
                @(negedge clk); rd_addr = i;
                @(posedge clk); #1;
                if (rd_data !== expect_mem[s * T_N + i]) begin
                    errors = errors + 1;
                    if (errors <= 10)
                        $display("MISMATCH step %0d agent %0d: got x=%h y=%h h=%h rng=%h  expected x=%h y=%h h=%h rng=%h",
                                 s, i, rd_data[79:64], rd_data[63:48], rd_data[47:32], rd_data[31:0],
                                 expect_mem[s*T_N+i][79:64], expect_mem[s*T_N+i][63:48],
                                 expect_mem[s*T_N+i][47:32], expect_mem[s*T_N+i][31:0]);
                end
            end
        end
        if (errors == 0)
            $display("PASS: %0d agents x %0d steps match the Python model bit for bit (P=%0d lanes, %0d clocks per step%s)",
                     T_N, T_STEPS, P, step_cycles, T_WALLS ? ", walled arena" : "");
        else
            $display("FAIL: %0d mismatching agent states", errors);
        $finish;
    end
endmodule

// LIMINAL Layer 2 - Vicsek agent engine (version 1.1)
// ---------------------------------------------------------------------------
// Updates N flocking agents per step, bit-exact with liminal_sim/fixedpoint.py.
//
// How it works (one step):
//   The agents are processed in blocks of P ("lanes"). For each block:
//   LOAD  - copy the P agents of this block into the lanes             (P+1 clocks)
//   ACC   - stream ALL N agents past the lanes, one per clock. Every lane
//           checks "is this agent within radius R of me?" and, if so, adds
//           its cos/sin to the lane's running sums                       (N+2 clocks)
//   NORM, PRE, ITER, ROUND - each lane turns its (sum_cos, sum_sin) into a
//           heading with a CORDIC (shift-and-add arctangent)             (19 clocks)
//   UPD   - for each lane in turn: add noise, move one step, and write the
//           new state into the OTHER memory bank                          (P clocks)
//   After the last block the banks swap, so every agent in a step saw the
//   same old state (a synchronous update, like the Python model).
//   Clocks per step = (N/P) * (N + 2P + 22), plus P + 1 per block with WALLS = 1
//   (LOAD P+1, ACC N+2, [WALL P+1], NORM/PRE/ITER/ROUND 19, UPD P).
//
// WALLS = 0 (version 1): periodic box, positions wrap around (physics runs).
// WALLS = 1 (version 1.1): the walled arena of the hybrid demo, bit-exact with
//   liminal_sim/fixedpoint.py step_walls():
//   - plain (unwrapped) distances
//   - WALL  - soft walls: a lane inside the band next to the boundary adds a
//           push toward the middle, (count * depth * wk) >> 16, to its sums. One
//           shared multiplier pipeline handles the lanes in turn   (P+1 clocks)
//   - UPD also mirrors an agent that crosses lo/hi and reflects its heading
//   The real drones are ordinary agents: between steps the laptop reads their
//   state, and writes it back with x, y replaced by the camera measurement.
//
// Number formats (identical to the Python model):
//   x, y   16-bit unsigned; wrap-around = periodic box
//   h      16-bit binary angle; 65536 = one full turn
//   rng    32-bit xorshift state, one per agent
//   cos/sin signed Q1.15 from a 1024-entry ROM
// ---------------------------------------------------------------------------
`timescale 1ns/1ps
module vicsek_engine #(
    parameter N  = 64,   // number of agents (a multiple of P)
    parameter P  = 8,    // parallel lanes
    parameter AW = 6,    // log2(N)
    parameter WALLS = 0  // 0 = periodic box (v1), 1 = walled arena (v1.1)
)(
    input  wire        clk,
    input  wire        rst,
    // parameters, held constant while busy
    input  wire [31:0] rq2,     // radius squared, position units
    input  wire [15:0] vq,      // step length, position units
    input  wire [16:0] etaq,    // noise width, angle units (65536 = 2*pi)
    // walled arena (used only when WALLS = 1; tie to 0 otherwise)
    input  wire [15:0] lo, hi,  // flock boundary: agents are mirrored back inside [lo, hi]
    input  wire [15:0] wlo, whi,// inner edges of the soft-wall bands
    input  wire [23:0] wk,      // wall push per neighbour per unit depth (Q1.15 * 2^16)
    // load / read the agent states while idle
    input  wire          wr_en,
    input  wire [AW-1:0] wr_addr,
    input  wire [79:0]   wr_data,   // {x, y, h, rng}
    input  wire [AW-1:0] rd_addr,
    output wire [79:0]   rd_data,   // valid one clock after rd_addr
    // control
    input  wire        start,      // pulse: run one step
    output reg         busy,
    output reg         done        // one-clock pulse at the end of the step
);
    localparam NB = N / P;
    localparam LW = (P > 1) ? $clog2(P) : 1;
    localparam BW = (NB > 1) ? $clog2(NB) : 1;

    // ---------------- agent state: two banks of N entries -------------------
    reg [79:0] mem [0:2*N-1];
    reg        cur;                      // bank holding the current state
    reg [AW:0] raddr;                    // {bank, index}
    reg [79:0] mrd;                      // registered read data (block RAM style)
    always @(posedge clk) mrd <= mem[raddr];
    assign rd_data = mrd;

    // ---------------- ROMs --------------------------------------------------
    reg [15:0] cos_lut [0:1023];
    reg [15:0] sin_lut [0:1023];
    `include "trig_lut_init.vh"
    `include "atan_tab.vh"

    function [9:0] lidx(input [15:0] h);       // round(h / 64) mod 1024
        reg [16:0] t;
        begin t = {1'b0, h} + 17'd32; lidx = t[15:6]; end
    endfunction

    function [31:0] xorshift32(input [31:0] s0);
        reg [31:0] s;
        begin s = s0; s = s ^ (s << 13); s = s ^ (s >> 17); s = s ^ (s << 5); xorshift32 = s; end
    endfunction

    // ---------------- lanes -------------------------------------------------
    reg        [15:0] lx  [0:P-1];
    reg        [15:0] ly  [0:P-1];
    reg        [15:0] lh  [0:P-1];
    reg        [31:0] lr  [0:P-1];
    reg signed [31:0] sx  [0:P-1];
    reg signed [31:0] sy  [0:P-1];
    reg signed [39:0] cx  [0:P-1];
    reg signed [39:0] cy  [0:P-1];
    reg signed [21:0] cz  [0:P-1];
    reg               zro [0:P-1];
    reg        [15:0] hmean [0:P-1];
    reg        [AW:0] cnt [0:P-1];      // neighbours seen (incl. itself), for the wall push
    // wall push: ONE shared multiplier pipeline, one lane per clock (stage A, then B)
    reg        [AW+16:0] kdx, kdy;      // stage A result: count * depth into the wall band
    reg        [1:0]  wmx, wmy;         // 0 = no push, 1 = push +, 2 = push -
    reg        [LW-1:0] wl;             // lane that stage B is working on
    reg               wv;               // stage B holds a valid lane

    // ---------------- control -----------------------------------------------
    localparam S_IDLE = 4'd0, S_LOAD = 4'd1, S_ACC = 4'd2, S_NORM = 4'd3, S_PRE = 4'd4,
               S_ITER = 4'd5, S_ROUND = 4'd6, S_UPD = 4'd7, S_WALL = 4'd8;
    reg [3:0]  state;
    reg [BW:0] blk;
    reg [AW+1:0] j;          // ACC counter 0..N+1
    reg [LW:0] u;            // LOAD / UPD lane counter
    reg [4:0]  it;           // CORDIC iteration
    // ACC pipeline
    reg        v0, v1;
    reg [15:0] p1x, p1y;
    reg signed [15:0] p1c, p1s;

    // read-address mux (one read port, so the state can live in block RAM)
    wire [AW-1:0] base = blk[BW-1:0] * P;
    always @(*) begin
        case (state)
            S_ACC:   raddr = {cur, j[AW-1:0]};
            S_LOAD:  raddr = {cur, base + u[LW-1:0]};
            default: raddr = {cur, rd_addr};
        endcase
    end

    integer l, b;
    reg signed [15:0] dx, dy;
    reg        [32:0] d2;
    reg        [31:0] ax, ay, m;
    integer           msb, sh;
    reg signed [39:0] nx, ny;
    reg        [31:0] r1;
    reg        [32:0] prod;
    reg signed [17:0] noise;
    reg        [15:0] hn;
    reg signed [15:0] cc, ss;
    reg signed [32:0] mvx, mvy;
    reg        [15:0] xn, yn;
    reg signed [21:0] zr;
    reg signed [16:0] sdx, sdy;
    reg        [33:0] d2w;
    reg               hit;
    localparam PWW = (AW + 41 > 48) ? AW + 41 : 48;   // width of count*depth*wk, at least 48
    reg        [PWW-1:0] pw;
    reg signed [17:0] xs, ys;
    reg        [15:0] hr;

    always @(posedge clk) begin
        done <= 1'b0;
        if (rst) begin
            state <= S_IDLE; busy <= 1'b0; cur <= 1'b0;
        end else begin
            case (state)
            // ------------------------------------------------------------------
            S_IDLE: begin
                if (wr_en) mem[{cur, wr_addr}] <= wr_data;
                if (start) begin
                    busy <= 1'b1; blk <= 0; u <= 0; state <= S_LOAD;
                end
            end
            // ------------------------------------------------------------------
            S_LOAD: begin   // issue address u, store data of address u-1
                if (u != 0) begin
                    lx[u-1] <= mrd[79:64]; ly[u-1] <= mrd[63:48];
                    lh[u-1] <= mrd[47:32]; lr[u-1] <= mrd[31:0];
                    sx[u-1] <= 0; sy[u-1] <= 0; cnt[u-1] <= 0;
                end
                if (u == P) begin
                    j <= 0; v0 <= 1'b0; v1 <= 1'b0; state <= S_ACC;
                end else
                    u <= u + 1'b1;
            end
            // ------------------------------------------------------------------
            S_ACC: begin
                // stage 0 (memory read) happens in the always block above
                v0 <= (j < N);
                // stage 1: look up cos/sin of the streamed agent's heading
                p1x <= mrd[79:64]; p1y <= mrd[63:48];
                p1c <= cos_lut[lidx(mrd[47:32])];
                p1s <= sin_lut[lidx(mrd[47:32])];
                v1  <= v0;
                // stage 2: every lane tests the distance and accumulates
                if (v1) begin
                    for (l = 0; l < P; l = l + 1) begin
                        if (WALLS) begin
                            sdx = $signed({1'b0, p1x}) - $signed({1'b0, lx[l]});   // plain distance
                            sdy = $signed({1'b0, p1y}) - $signed({1'b0, ly[l]});
                            d2w = sdx * sdx + sdy * sdy;
                            hit = (d2w <= {2'b00, rq2});
                        end else begin
                            dx = p1x - lx[l];             // 16-bit wrap = periodic distance
                            dy = p1y - ly[l];
                            d2 = dx * dx + dy * dy;
                            hit = (d2 <= {1'b0, rq2});
                        end
                        if (hit) begin
                            sx[l]  <= sx[l] + p1c;
                            sy[l]  <= sy[l] + p1s;
                            cnt[l] <= cnt[l] + 1'b1;
                        end
                    end
                end
                if (j == N + 1) begin
                    state <= WALLS ? S_WALL : S_NORM;
                    u <= 0; wv <= 1'b0;
                end
                j <= j + 1'b1;
            end
            // ------------------------------------------------------------------
            S_WALL: begin   // soft walls, one lane per clock through a shared 2-stage pipeline
                // stage A (lane u): how deep is the lane in a wall band, times its neighbour count
                if (u < P) begin
                    if (lx[u[LW-1:0]] < wlo)      begin kdx <= cnt[u[LW-1:0]] * (wlo - lx[u[LW-1:0]]); wmx <= 2'd1; end
                    else if (lx[u[LW-1:0]] > whi) begin kdx <= cnt[u[LW-1:0]] * (lx[u[LW-1:0]] - whi); wmx <= 2'd2; end
                    else                          begin kdx <= 0;                                       wmx <= 2'd0; end
                    if (ly[u[LW-1:0]] < wlo)      begin kdy <= cnt[u[LW-1:0]] * (wlo - ly[u[LW-1:0]]); wmy <= 2'd1; end
                    else if (ly[u[LW-1:0]] > whi) begin kdy <= cnt[u[LW-1:0]] * (ly[u[LW-1:0]] - whi); wmy <= 2'd2; end
                    else                          begin kdy <= 0;                                       wmy <= 2'd0; end
                    wl <= u[LW-1:0]; wv <= 1'b1;
                end else
                    wv <= 1'b0;
                // stage B (lane wl, from the previous clock): add the push toward the middle
                if (wv) begin
                    pw = kdx * wk;
                    if (wmx == 2'd1)      sx[wl] <= sx[wl] + $signed(pw[47:16]);
                    else if (wmx == 2'd2) sx[wl] <= sx[wl] - $signed(pw[47:16]);
                    pw = kdy * wk;
                    if (wmy == 2'd1)      sy[wl] <= sy[wl] + $signed(pw[47:16]);
                    else if (wmy == 2'd2) sy[wl] <= sy[wl] - $signed(pw[47:16]);
                end
                if (u == P) state <= S_NORM;
                u <= u + 1'b1;
            end
            // ------------------------------------------------------------------
            S_NORM: begin   // scale small vectors up so the CORDIC keeps precision
                for (l = 0; l < P; l = l + 1) begin
                    zro[l] = (sx[l] == 0) && (sy[l] == 0);
                    ax = sx[l][31] ? -sx[l] : sx[l];
                    ay = sy[l][31] ? -sy[l] : sy[l];
                    m  = (ax > ay) ? ax : ay;
                    msb = 0;
                    for (b = 0; b < 32; b = b + 1) if (m[b]) msb = b;
                    sh = (msb < 26) ? (26 - msb) : 0;
                    cx[l] <= $signed({{8{sx[l][31]}}, sx[l]}) <<< sh;
                    cy[l] <= $signed({{8{sy[l][31]}}, sy[l]}) <<< sh;
                end
                state <= S_PRE;
            end
            S_PRE: begin    // rotate by 180 deg if the vector points left
                for (l = 0; l < P; l = l + 1) begin
                    if (cx[l] < 0) begin
                        cx[l] <= -cx[l]; cy[l] <= -cy[l]; cz[l] <= 22'sd524288;  // 32768 << 4
                    end else
                        cz[l] <= 22'sd0;
                end
                it <= 0; state <= S_ITER;
            end
            S_ITER: begin   // 16 shift-and-add steps drive y to zero; z collects the angle
                for (l = 0; l < P; l = l + 1) begin
                    if (cy[l] > 0) begin
                        nx = cx[l] + (cy[l] >>> it);
                        ny = cy[l] - (cx[l] >>> it);
                        cz[l] <= cz[l] + atan_tab(it);
                    end else begin
                        nx = cx[l] - (cy[l] >>> it);
                        ny = cy[l] + (cx[l] >>> it);
                        cz[l] <= cz[l] - atan_tab(it);
                    end
                    cx[l] <= nx; cy[l] <= ny;
                end
                if (it == 5'd15) state <= S_ROUND;
                it <= it + 1'b1;
            end
            S_ROUND: begin  // drop the 4 fraction bits (round half up)
                for (l = 0; l < P; l = l + 1) begin
                    zr = (cz[l] + 22'sd8) >>> 4;
                    hmean[l] <= zro[l] ? lh[l] : zr[15:0];
                end
                u <= 0; state <= S_UPD;
            end
            // ------------------------------------------------------------------
            S_UPD: begin    // one lane per clock: noise, move, write to the other bank
                r1    = xorshift32(lr[u[LW-1:0]]);
                prod  = r1[31:16] * etaq;
                noise = $signed({1'b0, prod[32:16]}) - $signed({2'b00, etaq[16:1]});
                hn    = hmean[u[LW-1:0]] + noise[15:0];
                cc    = cos_lut[lidx(hn)];
                ss    = sin_lut[lidx(hn)];
                mvx   = ($signed({1'b0, vq}) * cc + 33'sd16384) >>> 15;
                mvy   = ($signed({1'b0, vq}) * ss + 33'sd16384) >>> 15;
                if (WALLS) begin
                    // move without wrap-around, then mirror back anything that left [lo, hi]
                    xs = $signed({2'b00, lx[u[LW-1:0]]}) + $signed(mvx[17:0]);
                    ys = $signed({2'b00, ly[u[LW-1:0]]}) + $signed(mvy[17:0]);
                    hr = hn;
                    if (xs < $signed({2'b00, lo}))      begin xs = $signed({1'b0, lo, 1'b0}) - xs; hr = 16'd32768 - hr; end
                    else if (xs > $signed({2'b00, hi})) begin xs = $signed({1'b0, hi, 1'b0}) - xs; hr = 16'd32768 - hr; end
                    if (ys < $signed({2'b00, lo}))      begin ys = $signed({1'b0, lo, 1'b0}) - ys; hr = 16'd0 - hr; end
                    else if (ys > $signed({2'b00, hi})) begin ys = $signed({1'b0, hi, 1'b0}) - ys; hr = 16'd0 - hr; end
                    xn = xs[15:0]; yn = ys[15:0];
                end else begin
                    hr = hn;
                    xn = lx[u[LW-1:0]] + mvx[15:0];
                    yn = ly[u[LW-1:0]] + mvy[15:0];
                end
                mem[{~cur, base + u[LW-1:0]}] <= {xn, yn, hr, r1};
                if (u == P - 1) begin
                    if (blk == NB - 1) begin
                        cur <= ~cur; busy <= 1'b0; done <= 1'b1; state <= S_IDLE;
                    end else begin
                        blk <= blk + 1'b1; u <= 0; state <= S_LOAD;
                    end
                end else
                    u <= u + 1'b1;
            end
            default: state <= S_IDLE;
            endcase
        end
    end
endmodule

"""LIMINAL ground-station UDP protocol (version 1).

Every packet is one UDP datagram, big-endian ("network order"), fixed layout, so the
FPGA can parse it with a simple state machine. See PROTOCOL.md for the byte tables.

    header (8 bytes): magic 'LM' (0x4C 0x4D), version u8 = 1, type u8, seq u32

Engine link (laptop <-> flock engine; the Python engine now, the FPGA later):
    STEP        type 1   laptop -> engine   write drone positions, run one step
    STEP_REPLY  type 2   engine -> laptop   new headings of those drones (+ optional full state)
    SET_PARAM   type 3   laptop -> engine   change a parameter (e.g. the noise eta)
    PARAM_ACK   type 4   engine -> laptop
World link (simulated here; real cameras and radios later):
    POSE        type 10  cameras -> laptop  measured drone positions (mm) + capture time
    CMD         type 11  laptop -> drones   velocity commands (mm/s)
Display:
    VIEW        type 20  laptop -> viewer   engine state + loop statistics
"""
import struct

MAGIC = b"LM"
VERSION = 1
T_STEP, T_STEP_REPLY, T_SET_PARAM, T_PARAM_ACK = 1, 2, 3, 4
T_POSE, T_CMD, T_VIEW = 10, 11, 20
F_WRITE, F_FULL = 0x1, 0x2          # STEP flags
P_ETAQ = 1                          # SET_PARAM ids
ST_OK = 0x1                         # STEP_REPLY status bits

_HDR = struct.Struct(">2sBBI")


def header(ptype, seq):
    return _HDR.pack(MAGIC, VERSION, ptype, seq & 0xFFFFFFFF)


def parse_header(buf):
    """-> (type, seq, payload) or None if the packet is not ours."""
    if len(buf) < _HDR.size:
        return None
    magic, ver, ptype, seq = _HDR.unpack_from(buf)
    if magic != MAGIC or ver != VERSION:
        return None
    return ptype, seq, buf[_HDR.size:]


# ---------------- engine link ----------------
def pack_step(seq, first, xs, ys, write=True, full=False):
    """Write positions (16-bit units) into agents first .. first+n-1, then step once."""
    n = len(xs)
    flags = (F_WRITE if write else 0) | (F_FULL if full else 0)
    body = struct.pack(">HHH", flags, n, first)
    body += struct.pack(">" + "HH" * n, *[v for p in zip(xs, ys) for v in p])
    return header(T_STEP, seq) + body


def unpack_step(payload):
    flags, n, first = struct.unpack_from(">HHH", payload)
    vals = struct.unpack_from(">" + "HH" * n, payload, 6)
    return flags, first, list(vals[0::2]), list(vals[1::2])


def pack_step_reply(seq, status, step, headings, full_state=None):
    body = struct.pack(">HIH", status, step & 0xFFFFFFFF, len(headings))
    body += struct.pack(">" + "H" * len(headings), *headings)
    if full_state is not None:
        x, y, h = full_state
        body += struct.pack(">H", len(x))
        body += struct.pack(">" + "HHH" * len(x), *[v for t in zip(x, y, h) for v in t])
    return header(T_STEP_REPLY, seq) + body


def unpack_step_reply(payload):
    status, step, n = struct.unpack_from(">HIH", payload)
    off = 8
    heads = list(struct.unpack_from(">" + "H" * n, payload, off)); off += 2 * n
    full = None
    if len(payload) > off:
        (m,) = struct.unpack_from(">H", payload, off); off += 2
        vals = struct.unpack_from(">" + "HHH" * m, payload, off)
        full = (list(vals[0::3]), list(vals[1::3]), list(vals[2::3]))
    return status, step, heads, full


def pack_set_param(seq, pid, value):
    return header(T_SET_PARAM, seq) + struct.pack(">HI", pid, value)


def unpack_set_param(payload):
    return struct.unpack_from(">HI", payload)


def pack_param_ack(seq, pid, value):
    return header(T_PARAM_ACK, seq) + struct.pack(">HI", pid, value)


# ---------------- world link ----------------
def pack_pose(seq, t_ns, xs_mm, ys_mm):
    n = len(xs_mm)
    return header(T_POSE, seq) + struct.pack(">QH", t_ns, n) + \
        struct.pack(">" + "hh" * n, *[v for p in zip(xs_mm, ys_mm) for v in p])


def unpack_pose(payload):
    t_ns, n = struct.unpack_from(">QH", payload)
    vals = struct.unpack_from(">" + "hh" * n, payload, 10)
    return t_ns, list(vals[0::2]), list(vals[1::2])


def pack_cmd(seq, vx_mms, vy_mms):
    n = len(vx_mms)
    return header(T_CMD, seq) + struct.pack(">H", n) + \
        struct.pack(">" + "hh" * n, *[v for p in zip(vx_mms, vy_mms) for v in p])


def unpack_cmd(payload):
    (n,) = struct.unpack_from(">H", payload)
    vals = struct.unpack_from(">" + "hh" * n, payload, 2)
    return list(vals[0::2]), list(vals[1::2])


# ---------------- display ----------------
def pack_view(seq, nv, x, y, h, rtt_us, etaq, mode):
    n = len(x)
    return header(T_VIEW, seq) + struct.pack(">HHIIB", n, nv, rtt_us, etaq, mode) + \
        struct.pack(">" + "HHH" * n, *[v for t in zip(x, y, h) for v in t])


def unpack_view(payload):
    n, nv, rtt_us, etaq, mode = struct.unpack_from(">HHIIB", payload)
    vals = struct.unpack_from(">" + "HHH" * n, payload, 13)
    return nv, list(vals[0::3]), list(vals[1::3]), list(vals[2::3]), rtt_us, etaq, mode

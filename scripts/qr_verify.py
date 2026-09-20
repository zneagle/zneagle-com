#!/usr/bin/env python3
"""Decode the QR artifacts without trusting the generator.

Reads the module grid straight out of the SVG path and the PNG pixels, checks
that the two grids match, then decodes the grid: format info, unmasking,
Reed-Solomon syndromes, and the data segments. Exits 1 if anything is off or
the payload isn't the expected URL.

Usage: python3 scripts/qr_verify.py [expected_url]   (needs Pillow for the PNG)
"""
import re
import sys
from pathlib import Path

QR_DIR = Path(__file__).resolve().parent.parent / "artifacts" / "qr"
SVG = QR_DIR / "zneagle-r-qr-H.svg"
PNG = QR_DIR / "zneagle-r-qr-H.png"
BORDER = 4

# --- GF(256) arithmetic for Reed-Solomon (primitive polynomial 0x11D) ---
EXP, LOG = [0] * 512, [0] * 256
_x = 1
for _i in range(255):
    EXP[_i], LOG[_x] = _x, _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    EXP[_i] = EXP[_i - 255]


def gf_mul(a, b):
    return 0 if a == 0 or b == 0 else EXP[LOG[a] + LOG[b]]


def syndromes(block, n):
    out = []
    for k in range(n):
        s = 0
        for c in block:
            s = gf_mul(s, EXP[k]) ^ c
        out.append(s)
    return out


# ECC codewords per block and block count, indexed [ecl][version], versions 1-6 only
# (ISO/IEC 18004 table 9). Versions 7+ also carry version info, which decode() doesn't handle.
ECC_PER_BLOCK = {
    "L": [None, 7, 10, 15, 20, 26, 18],
    "M": [None, 10, 16, 26, 18, 24, 16],
    "Q": [None, 13, 22, 18, 26, 18, 24],
    "H": [None, 17, 28, 22, 16, 22, 28],
}
NUM_BLOCKS = {
    "L": [None, 1, 1, 1, 1, 1, 2],
    "M": [None, 1, 1, 1, 2, 2, 4],
    "Q": [None, 1, 1, 2, 2, 4, 4],
    "H": [None, 1, 1, 2, 4, 4, 4],
}
ECL_BITS = {1: "L", 0: "M", 3: "Q", 2: "H"}
ALIGN = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34]}
MASKS = [
    lambda x, y: (x + y) % 2 == 0,
    lambda x, y: y % 2 == 0,
    lambda x, y: x % 3 == 0,
    lambda x, y: (x + y) % 3 == 0,
    lambda x, y: (x // 3 + y // 2) % 2 == 0,
    lambda x, y: x * y % 2 + x * y % 3 == 0,
    lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
    lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
]


def raw_data_modules(ver):
    n = (16 * ver + 128) * ver + 64
    if ver >= 2:
        na = ver // 7 + 2
        n -= (25 * na - 10) * na - 55
    return n


def bch_format(data5):
    rem = data5
    for _ in range(10):
        rem = (rem << 1) ^ ((rem >> 9) * 0x537)
    return ((data5 << 10) | rem) ^ 0x5412


def grid_from_svg(path):
    text = path.read_text()
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', text).group(1).split()]
    rects = re.findall(r"M([\d.]+),([\d.]+)H([\d.]+)V([\d.]+)H[\d.]+z", text)
    sizes = {(float(x2) - float(x1), float(y2) - float(y1)) for x1, y1, x2, y2 in rects}
    assert len(sizes) == 1, f"non-uniform module rects: {sizes}"
    s = sizes.pop()[0]
    total = round(vb[2] / s)
    n = total - 2 * BORDER
    grid = [[False] * n for _ in range(n)]
    for x1, y1, _, _ in rects:
        c, r = round(float(x1) / s) - BORDER, round(float(y1) / s) - BORDER
        assert 0 <= r < n and 0 <= c < n, "dark module inside the quiet zone"
        grid[r][c] = True
    return grid, s, vb


def grid_from_png(path, n):
    from PIL import Image

    img = Image.open(path).convert("L")
    w, h = img.size
    total = n + 2 * BORDER
    assert w == h and w % total == 0, f"PNG {w}x{h} is not a whole number of px per module"
    px = w // total
    dark = lambda r, c: img.getpixel((c * px + px // 2, r * px + px // 2)) < 128
    for r in range(total):
        for c in range(total):
            if (r < BORDER or r >= total - BORDER or c < BORDER or c >= total - BORDER) and dark(r, c):
                raise AssertionError("PNG quiet zone is not clear")
    return [[dark(r + BORDER, c + BORDER) for c in range(n)] for r in range(n)], px


def decode(grid):
    n = len(grid)
    ver = (n - 17) // 4
    assert 17 + 4 * ver == n and 1 <= ver <= 6, f"unsupported size {n}"
    g = lambda x, y: int(grid[y][x])

    # Format info: both copies must decode to the same valid codeword.
    first = [(8, i) for i in range(6)] + [(8, 7), (8, 8), (7, 8)] + [(14 - i, 8) for i in range(9, 15)]
    second = [(n - 1 - i, 8) for i in range(8)] + [(8, n - 15 + i) for i in range(8, 15)]
    fmt = [sum(g(x, y) << i for i, (x, y) in enumerate(pos)) for pos in (first, second)]
    assert fmt[0] == fmt[1], "format info copies disagree"
    data5 = (fmt[0] ^ 0x5412) >> 10
    assert bch_format(data5) == fmt[0], "format info BCH check failed"
    ecl, mask = ECL_BITS[data5 >> 3], data5 & 7
    assert g(8, n - 8) == 1, "dark module missing"

    # Function-pattern map.
    func = [[False] * n for _ in range(n)]

    def mark(x0, y0, w, h):
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                func[y][x] = True

    mark(0, 0, 9, 9)
    mark(n - 8, 0, 8, 9)
    mark(0, n - 8, 9, 8)
    mark(6, 0, 1, n)
    mark(0, 6, n, 1)
    pos = ALIGN[ver]
    for cy in pos:
        for cx in pos:
            if (cx, cy) not in ((pos[0], pos[0]), (pos[0], pos[-1]), (pos[-1], pos[0])):
                mark(cx - 2, cy - 2, 5, 5)

    # Zigzag read, unmasked.
    bits = []
    right = n - 1
    while right >= 1:
        if right == 6:
            right = 5
        for vert in range(n):
            for j in range(2):
                x = right - j
                y = (n - 1 - vert) if ((right + 1) & 2) == 0 else vert
                if not func[y][x]:
                    bits.append(g(x, y) ^ int(MASKS[mask](x, y)))
        right -= 2
    raw = raw_data_modules(ver)
    assert len(bits) == raw, f"read {len(bits)} data modules, expected {raw}"
    total_cw = raw // 8
    cws = [int("".join(map(str, bits[i * 8:i * 8 + 8])), 2) for i in range(total_cw)]

    # De-interleave into blocks and check Reed-Solomon syndromes.
    nb, ecc = NUM_BLOCKS[ecl][ver], ECC_PER_BLOCK[ecl][ver]
    short_len = total_cw // nb
    n_short = nb - total_cw % nb
    data_lens = [short_len - ecc if b < n_short else short_len + 1 - ecc for b in range(nb)]
    blocks, k = [[] for _ in range(nb)], 0
    for i in range(max(data_lens)):
        for b in range(nb):
            if i < data_lens[b]:
                blocks[b].append(cws[k])
                k += 1
    for _ in range(ecc):
        for b in range(nb):
            blocks[b].append(cws[k])
            k += 1
    rs_ok = all(not any(syndromes(blk, ecc)) for blk in blocks)
    data = [c for b in range(nb) for c in blocks[b][:data_lens[b]]]

    # Parse segments.
    stream = "".join(f"{c:08b}" for c in data)
    p, out, modes = 0, "", []

    def take(nbits):
        nonlocal p
        v = int(stream[p:p + nbits], 2)
        p += nbits
        return v

    alnum = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"
    while p + 4 <= len(stream):
        m = take(4)
        if m == 0:
            break
        if m == 4:
            count = take(8)
            out += bytes(take(8) for _ in range(count)).decode("latin-1")
            modes.append(f"byte({count})")
        elif m == 2:
            count = take(9)
            for _ in range(count // 2):
                v = take(11)
                out += alnum[v // 45] + alnum[v % 45]
            if count % 2:
                out += alnum[take(6)]
            modes.append(f"alphanumeric({count})")
        elif m == 1:
            count = take(10)
            for _ in range(count // 3):
                out += f"{take(10):03d}"
            rem = count % 3
            if rem:
                out += f"{take(3 * rem + 1):0{rem}d}"
            modes.append(f"numeric({count})")
        else:
            raise AssertionError(f"unsupported mode {m:04b}")
    return {"version": ver, "size": n, "ecl": ecl, "mask": mask, "rs_ok": rs_ok,
            "blocks": f"{nb}x({data_lens[0]} data + {ecc} ecc)", "modes": modes, "payload": out}


def main():
    expected = sys.argv[1] if len(sys.argv) > 1 else "https://zneagle.com/r"
    svg_grid, module, vb = grid_from_svg(SVG)
    png_grid, px = grid_from_png(PNG, len(svg_grid))
    same = svg_grid == png_grid
    info = decode(svg_grid)
    print(f"svg: {vb[2]:g}x{vb[3]:g} units, module {module:g} units, {BORDER}-module quiet zone")
    print(f"png: {px} px/module, quiet zone clear; grid identical to svg: {same}")
    for k, v in info.items():
        print(f"{k}: {v}")
    ok = same and info["rs_ok"] and info["payload"] == expected
    print(f"RESULT: {'PASS' if ok else 'FAIL'} (expected {expected!r})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

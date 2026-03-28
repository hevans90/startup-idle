# Default ASCII tilemap

Edit these files in a **monospace** font so columns line up with map **X** (left → right) and rows with **Y** (top → bottom, map row 0 at the top line).

| File | Z | Contents |
|------|---|----------|
| `legend.txt` | — | `#` comments; each data line = one character + space + SubTexture name from a `*_sheet.xml` under `public/isometric_assets` |
| `layer-0-ground.txt` | 0 | **Dense** ground: every column must be a symbol (no spaces) |
| `layer-1.txt` | 1 | Floors, stairs: **space** = no tile at z=1 |
| `layer-2.txt` | 2 | Walls, etc.: **space** = no tile at z=2 |

**Layer 0** defines world size: every row must be the same width and fully dense.

**Higher layers** are fitted to that size: short lines are padded with spaces on the right, long lines are **truncated**, extra lines are ignored, missing lines are treated as all spaces — so you can sketch structures without perfect alignment.

After editing, run `bun run build` to verify symbols exist in `legend.txt` and each `spriteId` matches an atlas frame name.

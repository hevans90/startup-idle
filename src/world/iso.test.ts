import { describe, expect, test } from "bun:test";
import {
  HEIGHT_STEP,
  HEIGHT_UNIT,
  HH,
  HW,
  TILE_DIAMOND_H,
  TILE_W,
  bandCount,
  bandOf,
  cellToWorld,
  faceCoords,
  pickCell,
  spriteY,
  surfaceHeight,
  worldToCell,
  worldToCellF,
  RAMP,
  type Cell,
  type Surface,
  type SurfaceAt,
} from "./iso";

const SCALES = [0.5, 1, 2, 3];
const HEIGHTS = [-4, -2, -1, 0, 1, 2, 5, 8];

describe("constants", () => {
  test("match the measured art", () => {
    expect(TILE_W).toBe(132);
    expect(TILE_DIAMOND_H).toBe(66);
    expect(HW).toBe(66);
    expect(HH).toBe(33);
    expect(HEIGHT_UNIT).toBe(16.5); // half step
    expect(HEIGHT_STEP).toBe(33); // full step == 2 units == one slab skirt
    expect(HEIGHT_STEP / HEIGHT_UNIT).toBe(2);
  });
});

describe("cellToWorld", () => {
  test("golden values at scale 1, h 0", () => {
    const got = ([[0, 0], [1, 0], [0, 1], [1, 1], [5, 5], [12, 7], [-3, 4]] as const)
      .map(([x, y]) => { const w = cellToWorld(x, y, 0, 1); return [w.wx, w.wy]; });
    expect(got).toEqual([
      [0, 0], [66, 33], [-66, 33], [0, 66], [0, 330], [330, 627], [-462, 33],
    ]);
  });

  test("wx is INDEPENDENT of height — the property depth sorting relies on", () => {
    for (const s of SCALES) for (const h of HEIGHTS) {
      expect(cellToWorld(7, 3, h, s).wx).toBeCloseTo(cellToWorld(7, 3, 0, s).wx, 10);
    }
  });

  test("height raises by exactly HEIGHT_UNIT per unit", () => {
    for (const s of SCALES) for (const h of HEIGHTS) {
      const flat = cellToWorld(4, 6, 0, s);
      expect(cellToWorld(4, 6, h, s).wy).toBeCloseTo(flat.wy - h * HEIGHT_UNIT * s, 10);
    }
  });

  test("a full step equals one slab skirt", () => {
    const a = cellToWorld(2, 2, 0, 1), b = cellToWorld(2, 2, 2, 1);
    expect(a.wy - b.wy).toBe(HEIGHT_STEP);
  });
});

describe("worldToCell", () => {
  test("round-trips the diamond centre for every cell, scale and height", () => {
    for (const s of SCALES) for (const h of HEIGHTS) {
      for (let x = -6; x <= 12; x++) for (let y = -6; y <= 12; y++) {
        const { wx, wy } = cellToWorld(x, y, h, s);
        expect(worldToCell(wx, wy, h, s)).toEqual({ x, y });
      }
    }
  });

  /**
   * The regression that bit v1: without the +HH shift the pick lands one cell
   * out along y. Verified by probing INSIDE the diamond, not just at centre.
   */
  test("points inside the diamond resolve to that diamond", () => {
    for (const s of SCALES) {
      for (let x = 0; x <= 8; x++) for (let y = 0; y <= 8; y++) {
        const { wx, wy } = cellToWorld(x, y, 0, s);
        // 80% of the way to each of the four vertices
        const probes: [number, number][] = [
          [0, 0],
          [0, -HH * 0.8 * s], [HW * 0.8 * s, 0],
          [0, HH * 0.8 * s], [-HW * 0.8 * s, 0],
        ];
        for (const [dx, dy] of probes) {
          expect(worldToCell(wx + dx, wy + dy, 0, s)).toEqual({ x, y });
        }
      }
    }
  });

  test("worldToCellF is exact (not floored) at a centre", () => {
    const f = worldToCellF(cellToWorld(3, 5, 0, 1).wx, cellToWorld(3, 5, 0, 1).wy, 0, 1);
    expect(f.x).toBeCloseTo(3, 10);
    expect(f.y).toBeCloseTo(5, 10);
  });
});

describe("spriteY", () => {
  test("a 132x99 slab sits 66px below its diamond centre", () => {
    // measured: visible diamond centre == sprite anchor - 66
    expect(spriteY(0, 99, 1)).toBe(66);
  });
  test("skirt is derived per frame", () => {
    expect(spriteY(0, 83, 1)).toBe(HH + (83 - TILE_DIAMOND_H)); // 33 + 17
    expect(spriteY(0, 131, 1)).toBe(HH + (131 - TILE_DIAMOND_H)); // 33 + 65
  });
  test("scales", () => {
    expect(spriteY(100, 99, 2)).toBe(100 + 66 * 2);
  });
});

describe("bandOf", () => {
  test("is x + y and ignores height", () => {
    expect(bandOf(0, 0)).toBe(0);
    expect(bandOf(5, 7)).toBe(12);
    expect(bandOf(7, 5)).toBe(12);
  });

  /**
   * Within a band, cells are exactly one tile-width apart horizontally and
   * identical in Y, so no two sprites can overlap and draw order inside a band
   * is irrelevant. That is what lets the renderer skip sorting entirely.
   */
  test("cells sharing a band are TILE_W apart and level", () => {
    const a = cellToWorld(3, 9, 0, 1);   // band 12
    const b = cellToWorld(4, 8, 0, 1);   // band 12
    expect(Math.abs(a.wx - b.wx)).toBe(TILE_W);
    expect(a.wy).toBe(b.wy);
  });

  test("bandCount", () => {
    expect(bandCount(64, 64)).toBe(127);
    expect(bandCount(1, 1)).toBe(1);
  });
});

/**
 * Brute force: the cell whose top face contains the point, nearest first.
 *
 * This is the ORACLE for picking, deliberately NOT the flat picker that shipped
 * in Phase 1. That one resolves by flooring an inverted projection, so for a
 * point exactly on the edge shared by two faces its answer falls out of
 * rounding rather than out of the geometry — fine in practice, useless as a
 * reference. Scanning every cell and keeping the largest band cannot be wrong:
 * with no overhangs the largest band IS the nearest surface (§3.1).
 */
function pickByScan(
  w: number,
  h: number,
  surfaceAt: SurfaceAt,
  wx: number,
  wy: number,
  s = 1,
): Cell | null {
  let best: Cell | null = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const surf = surfaceAt(x, y);
      if (!surf) continue;
      if (!faceCoords(wx, wy, x, y, surf, s)) continue;
      if (!best || x + y > best.x + best.y) best = { x, y };
    }
  }
  return best;
}

const level = (height: number): Surface => ({ height, ramp: RAMP.NONE, rise: 0 });

describe("pickCell", () => {
  const flat: SurfaceAt = () => level(0);

  test("finds the cell on flat ground", () => {
    for (let x = 0; x <= 8; x++) for (let y = 0; y <= 8; y++) {
      const { wx, wy } = cellToWorld(x, y, 0, 1);
      expect(pickCell(wx, wy, flat, { min: 0, max: 0 })).toEqual({ x, y });
    }
  });

  test("a near raised column wins over lower ground behind it", () => {
    const at = (x: number, y: number) => (x === 4 && y === 4 ? 2 : 0);
    const surf: SurfaceAt = (x, y) => level(at(x, y));
    const { wx, wy } = cellToWorld(4, 4, 2, 1);   // the raised top face
    expect(pickCell(wx, wy, surf, { min: 0, max: 2 })).toEqual({ x: 4, y: 4 });
  });

  test("off-map returns null rather than a phantom cell", () => {
    const bounded: SurfaceAt = (x, y) =>
      x >= 0 && y >= 0 && x < 8 && y < 8 ? level(0) : null;
    const { wx, wy } = cellToWorld(40, 40, 0, 1);
    expect(pickCell(wx, wy, bounded, { min: 0, max: 0 })).toBeNull();
  });

  test("the march is bounded by the height range, not the map size", () => {
    let calls = 0;
    const surf: SurfaceAt = () => { calls++; return null; };
    pickCell(0, 0, surf, { min: -4, max: 8 });
    // (max + MAX_RISE − min) half steps is (8 + 2 + 4)/2 = 7 bands, plus slack
    expect(calls).toBeLessThan(16);
    expect(calls).toBeGreaterThan(4);
  });

  test("matches a brute-force scan over a stepped world, at every point", () => {
    const H = (x: number, y: number) => ((x * 7 + y * 13) % 5) * 2 - 2;
    const W = 20, HT = 20;
    const surf: SurfaceAt = (x, y) =>
      x >= 0 && y >= 0 && x < W && y < HT ? level(H(x, y)) : null;
    const range = { min: -2, max: 6 };
    let checked = 0, hits = 0;
    for (let px = -600; px <= 600; px += 7) {
      for (let py = 0; py <= 1400; py += 11) {
        const got = pickCell(px, py, surf, range, 1);
        expect(got).toEqual(pickByScan(W, HT, surf, px, py, 1));
        checked++;
        if (got) hits++;
      }
    }
    expect(checked).toBeGreaterThan(10000);
    expect(hits).toBeGreaterThan(2000);
  });

  test("matches the scan on a world of RAMPS — the point of the rewrite", () => {
    const W = 14, HT = 14;
    const surf: SurfaceAt = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= HT) return null;
      const dir = [RAMP.NONE, RAMP.N, RAMP.E, RAMP.S, RAMP.W][(x * 3 + y) % 5];
      const rise = dir === RAMP.NONE ? 0 : ((x + y) % 2 === 0 ? 1 : 2);
      return { height: ((x + y) % 3) * 2, ramp: dir, rise };
    };
    const range = { min: 0, max: 4 };
    let hits = 0;
    for (let px = -450; px <= 450; px += 5) {
      for (let py = 0; py <= 900; py += 7) {
        const got = pickCell(px, py, surf, range, 1);
        expect(got).toEqual(pickByScan(W, HT, surf, px, py, 1));
        if (got) hits++;
      }
    }
    expect(hits).toBeGreaterThan(1000);
  });

  test("matches the scan at non-unit scales", () => {
    const H = (x: number, y: number) => ((x + y) % 3) * 2;
    const W = 12, HT = 12;
    const surf: SurfaceAt = (x, y) =>
      x >= 0 && y >= 0 && x < W && y < HT ? level(H(x, y)) : null;
    const range = { min: 0, max: 4 };
    for (const s of [0.5, 2.5]) {
      for (let px = -300 * s; px <= 300 * s; px += 11 * s) {
        for (let py = 0; py <= 700 * s; py += 13 * s) {
          expect(pickCell(px, py, surf, range, s))
            .toEqual(pickByScan(W, HT, surf, px, py, s));
        }
      }
    }
  });
});

describe("faceCoords", () => {
  test("the diamond centre is the middle of the face", () => {
    const { wx, wy } = cellToWorld(5, 3, 0, 1);
    const f = faceCoords(wx, wy, 5, 3, level(0), 1);
    expect(f?.u).toBeCloseTo(0.5, 9);
    expect(f?.v).toBeCloseTo(0.5, 9);
  });

  test("misses a cell on a different diagonal column", () => {
    const { wx, wy } = cellToWorld(5, 3, 0, 1);
    expect(faceCoords(wx, wy, 7, 3, level(0), 1)).toBeNull();
  });

  test("covers the whole face and nothing outside it", () => {
    // every point of the diamond belongs to exactly one of the 9 nearby cells
    let inside = 0;
    for (let dx = -66; dx <= 66; dx += 3) {
      for (let dy = -33; dy <= 33; dy += 3) {
        const { wx, wy } = cellToWorld(5, 5, 0, 1);
        let hits = 0;
        for (let x = 4; x <= 6; x++) for (let y = 4; y <= 6; y++) {
          if (faceCoords(wx + dx, wy + dy, x, y, level(0), 1)) hits++;
        }
        if (Math.abs(dx) / 66 + Math.abs(dy) / 33 < 0.95) { inside++; expect(hits).toBe(1); }
      }
    }
    expect(inside).toBeGreaterThan(200);
  });

  test("a ramp's named edge is its HIGH edge", () => {
    // (5,5) rises toward S, which is (x+1, y) — so the +x side is higher
    const surf: Surface = { height: 0, ramp: RAMP.S, rise: 2 };
    for (const [u, expected] of [[0.1, 0.1], [0.9, 0.9]] as const) {
      // pick the world point that IS at face coords (u, 0.5) on that surface
      const h = surfaceHeight(surf, u, 0.5);
      const wx = (5 + u - (5 + 0.5)) * HW;               // x̃ − ỹ = u − v
      const wy = (5 + u + 5 + 0.5) * HH - h * HEIGHT_UNIT - HH;
      const f = faceCoords(wx, wy, 5, 5, surf, 1);
      expect(f?.u).toBeCloseTo(expected, 6);
      expect(f?.v).toBeCloseTo(0.5, 6);
    }
  });

  test("solves every ramp direction and rise back to the point it came from", () => {
    for (const ramp of [RAMP.N, RAMP.E, RAMP.S, RAMP.W]) {
      for (const rise of [1, 2]) {
        for (const s of [1, 0.75]) {
          const surf: Surface = { height: 4, ramp, rise };
          for (const u of [0.05, 0.5, 0.95]) for (const v of [0.05, 0.5, 0.95]) {
            const h = surfaceHeight(surf, u, v);
            const X = 6, Y = 2;
            const wx = ((X + u) - (Y + v)) * HW * s;
            const wy = ((X + u) + (Y + v)) * HH * s - h * HEIGHT_UNIT * s - HH * s;
            const f = faceCoords(wx, wy, X, Y, surf, s);
            expect(f).not.toBeNull();
            expect(f!.u).toBeCloseTo(u, 6);
            expect(f!.v).toBeCloseTo(v, 6);
          }
        }
      }
    }
  });

  test("a tilted face resolves a point differently from a flat one", () => {
    // Same cell, same world point, two different surfaces: the tilt has to
    // change WHERE on the face the point lands, or the solve is ignoring it.
    const surf: Surface = { height: 0, ramp: RAMP.S, rise: 2 };
    const u = 0.9, v = 0.5;
    const h = surfaceHeight(surf, u, v);
    const wx = ((5 + u) - (5 + v)) * HW;
    const wy = ((5 + u) + (5 + v)) * HH - h * HEIGHT_UNIT - HH;
    const tilted = faceCoords(wx, wy, 5, 5, surf, 1);
    const flat = faceCoords(wx, wy, 5, 5, level(0), 1);
    expect(tilted?.u).toBeCloseTo(u, 6);
    expect(flat).not.toBeNull();
    expect(Math.abs(flat!.u - tilted!.u)).toBeGreaterThan(0.2);
  });
});

describe("pickCell on ramps", () => {
  const rampWorld = (ramp: number, rise: number): SurfaceAt => (x, y) => {
    if (x < 0 || y < 0 || x >= 12 || y >= 12) return null;
    if (x === 5 && y === 5) return { height: 0, ramp, rise };
    return level(0);
  };

  test("picks the ramp cell from points along its whole surface", () => {
    for (const ramp of [RAMP.N, RAMP.E, RAMP.S, RAMP.W]) {
      const surf: Surface = { height: 0, ramp, rise: 2 };
      const world = rampWorld(ramp, 2);
      for (const u of [0.15, 0.5, 0.85]) for (const v of [0.15, 0.5, 0.85]) {
        const h = surfaceHeight(surf, u, v);
        const wx = ((5 + u) - (5 + v)) * HW;
        const wy = ((5 + u) + (5 + v)) * HH - h * HEIGHT_UNIT - HH;
        expect(pickCell(wx, wy, world, { min: 0, max: 2 }, 1)).toEqual({ x: 5, y: 5 });
      }
    }
  });

  test("a half-rise ramp is pickable across its surface too", () => {
    const surf: Surface = { height: 0, ramp: RAMP.W, rise: 1 };
    const world = rampWorld(RAMP.W, 1);
    for (const v of [0.1, 0.5, 0.9]) {
      const h = surfaceHeight(surf, 0.5, v);
      const wx = (0.5 - v) * HW;
      const wy = ((5 + 0.5) + (5 + v)) * HH - h * HEIGHT_UNIT - HH;
      expect(pickCell(wx, wy, world, { min: 0, max: 1 }, 1)).toEqual({ x: 5, y: 5 });
    }
  });
});

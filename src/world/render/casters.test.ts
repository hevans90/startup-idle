import { describe, expect, test } from "bun:test";
import { createGrid } from "../grid";
import { SHADOW_RUN, SUN_X, SUN_Y } from "../light";
import { castGround, shadeOf, SHADE_PER_TILE, type GroundMesh } from "./ground-mesh";

// A flat field, and the parts of a ground mesh the shade is worked out from.
function field(n: number) {
  const grid = createGrid(n, n, 1), S = SHADE_PER_TILE, W = n * S;
  const gm = {
    heights: new Float32Array(W * W), shade: new Uint8Array(W * W), casts: new Float32Array(W * W), tops: new Float32Array(n * n), cast: new Map(), castTop: 0, shadeTop: NaN, shadeRev: 0,
    shadeSource: { update() {} }, w: n, h: n,
  } as unknown as GroundMesh;
  const at = (x: number, y: number) => gm.shade[Math.floor(y * S) * W + Math.floor(x * S)];
  return { grid, gm, at };
}
const tower = { key: "tower", boxes: [{ u0: 16, v0: 16, u1: 17, v1: 17, z: 8 }] };

describe("what is built throws its shadow on the ground", () => {
  test("away from the sun and not toward it, further the taller it is", () => {
    const { grid, gm, at } = field(32);
    grid.structures.set(1, { id: 1, def: "x", x: 16, y: 16, w: 1, h: 1 });
    expect(castGround(gm, grid, () => tower)).toBe(true);
    // Its shadow is `reach` tiles long. A third of the way down it: in shadow. As far up the sun's way: lit.
    const reach = 8 * SHADOW_RUN, near = 0.5 + reach / 3;
    expect(at(16.5 - SUN_X * near, 16.5 - SUN_Y * near)).toBeGreaterThan(150);
    expect(at(16.5 + SUN_X * near, 16.5 + SUN_Y * near)).toBe(0);
    // Well off to the side: lit.
    expect(at(16.5, 12.5)).toBe(0);
    // Past the end of it, lit again.
    expect(at(16.5 - SUN_X * (reach + 2), 16.5 - SUN_Y * (reach + 2))).toBe(0);
    // Nothing changed: nothing worked out again.
    expect(castGround(gm, grid, () => tower)).toBe(false);
  });
  test("gone, its shadow goes: the shade is the bare ground's again", () => {
    const { grid, gm } = field(32);
    const bare = gm.shade.slice();
    grid.structures.set(1, { id: 1, def: "x", x: 16, y: 16, w: 1, h: 1 });
    castGround(gm, grid, () => tower);
    expect(gm.shade.some((v) => v > 0)).toBe(true);
    grid.structures.delete(1);
    expect(castGround(gm, grid, () => null)).toBe(true);
    expect([...gm.shade]).toEqual([...bare]);
  });
  test("worked out round the one that changed, it is what the whole map worked out at once would be", () => {
    const { grid, gm } = field(32), S = SHADE_PER_TILE, W = 32 * S;
    const casters = new Map([[1, tower], [2, { key: "b", boxes: [{ u0: 8, v0: 20, u1: 10, v1: 21, z: 14 }] }]]);
    grid.structures.set(1, { id: 1, def: "x", x: 16, y: 16, w: 1, h: 1 });
    castGround(gm, grid, (id) => casters.get(id) ?? null);
    grid.structures.set(2, { id: 2, def: "x", x: 8, y: 20, w: 2, h: 1 });
    castGround(gm, grid, (id) => casters.get(id) ?? null);
    const whole = new Uint8Array(W * W);
    shadeOf(gm.heights, W, W, gm.shadeTop, whole, [0, 0, W, W], gm.casts);
    expect([...gm.shade]).toEqual([...whole]);
  });
});

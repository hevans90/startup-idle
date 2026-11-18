import { describe, expect, test } from "bun:test";
import { shadeOf } from "./ground-mesh";

// Quarter tiles: 4 a tile. A plateau `up` half steps high on the eye's side (large x + y) of a flat field.
function field(up: number) {
  const W = 48, H = 48, hs = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) hs[j * W + i] = i + j >= 56 ? up : 0;
  const out = new Uint8Array(W * H);
  shadeOf(hs, W, H, up + 2, out);
  return (i: number, j: number) => out[j * W + i];
}

describe("the shade behind a crest", () => {
  test("ground right behind a drop that faces away is shaded, and the shade is gone a tile and a half back", () => {
    const at = field(5);
    // Far from the sun's own shadow: the plateau is toward +x, the sun toward −x.
    expect(at(27, 27)).toBeGreaterThan(100);   // under the crest
    expect(at(25, 25)).toBeLessThan(at(27, 27));
    expect(at(24, 24)).toBeGreaterThan(0);
    expect(at(20, 20)).toBe(0);                // two tiles back
  });
  test("a low rise shades nothing behind it", () => {
    const at = field(1);
    expect(at(27, 27)).toBe(0);
  });
  test("the crest's own top is not shaded", () => {
    const at = field(5);
    expect(at(34, 34)).toBe(0);
  });
});

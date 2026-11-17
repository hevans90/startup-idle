/**
 * Something pouring: where its quad goes, and that both dialects of its
 * shader are written from the one body.
 */
import { describe, expect, test } from "bun:test";

import { POUR, pourSources, pourVerts } from "./pour";
import { growSources } from "./road-grow";
import { onRound } from "./road-plant";

describe("a pour", () => {
  test("its quad is a box on the screen round the fall, its skirt and its heap, each corner knowing where it is from the lip and carrying what it is told", () => {
    const v = new Float32Array(4 * 20);
    pourVerts(v, [10, 20], [16, 80], 4, 1.2, 6, { time: 3, kind: POUR.tar, head: 0.7, tail: 0.1, pile: 0.5, lit: 0xff8000, shade: 0x102030 });
    // Wide enough either side for what flies off it; from just over the lip to under the landing.
    expect(v[0]).toBeLessThan(10 - 4 * 4);
    expect(v[20]).toBeGreaterThan(16 + 4 * 4);
    expect(v[1]).toBeLessThanOrEqual(20);
    expect(v[2 * 20 + 1]).toBeGreaterThan(80);
    for (let k = 0; k < 4; k++) {
      const o = k * 20;
      // From the lip, pixels: its place less the lip's.
      expect(v[o + 2]).toBeCloseTo(v[o] - 10, 5);
      expect(v[o + 3]).toBeCloseTo(v[o + 1] - 20, 5);
      expect([v[o + 4], v[o + 5], v[o + 6], v[o + 7]]).toEqual([3, 2, 0.7, 0.1].map(Math.fround));
      // Six across to where it lands, its heap, sixty down, four half across; its taper and a metre.
      expect([v[o + 8], v[o + 9], v[o + 10], v[o + 11], v[o + 12], v[o + 13]]).toEqual([6, 0.5, 60, 4, 1.2, 6].map(Math.fround));
      expect(v[o + 14]).toBeCloseTo(1, 5);
      expect(v[o + 19]).toBeCloseTo(0x30 / 255, 5);
    }
  });

  test("one body, two dialects: neither left with the other's words in it", () => {
    const { wgsl, fragment } = pourSources();
    expect(wgsl).toContain("fn mainFragment");
    expect(wgsl).not.toMatch(/\bfloat \w+ =/);
    expect(fragment).toContain("void main()");
    expect(fragment).not.toMatch(/\blet \w+ =|vec[23]<f32>/);
  });
});

describe("a road growing", () => {
  test("one body, two dialects, each sampling both tiles", () => {
    const { wgsl, fragment } = growSources();
    expect(wgsl).toContain("fn mainFragment");
    expect(wgsl).not.toMatch(/\b(float|vec[234]) \w+ =/);
    expect(fragment).not.toMatch(/\blet \w+ =|vec[234]<f32>/);
    for (const src of [wgsl, fragment]) { expect(src).toContain("tapBare(vUvA)"); expect(src).toContain("tapLined(vUvB)"); }
  });
});

describe("somebody on a round", () => {
  const round = [
    { al: 0, ac: 0, pose: "work" as const, dwell: 4, face: 1 },
    { al: 1.6, ac: 0, pose: "stand" as const, dwell: 2, face: 2 },
  ];
  test("works where they are, walks to the next place facing the way they go, and comes round again", () => {
    expect(onRound(round, 1)).toMatchObject({ al: 0, pose: "work", face: 1 });
    // 1.6 tiles at 0.16 a second: ten seconds on the way, half way after five.
    const mid = onRound(round, 4 + 5);
    expect(mid.pose).toBe("walk");
    expect(mid.al).toBeCloseTo(0.8, 6);
    expect(mid.face).toBeCloseTo(0, 6);
    expect(onRound(round, 4 + 10 + 1)).toMatchObject({ al: 1.6, pose: "stand" });
    // Back the other way, facing back; and the whole round again.
    expect(onRound(round, 4 + 10 + 2 + 5).face).toBeCloseTo(Math.PI, 6);
    expect(onRound(round, 26 + 1)).toMatchObject({ al: 0, pose: "work" });
  });
});

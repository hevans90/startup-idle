/**
 * Something pouring: where its quad goes, and that both dialects of its
 * shader are written from the one body.
 */
import { describe, expect, test } from "bun:test";

import { POUR, pourSources, pourVerts } from "./pour";
import { growSources } from "./road-grow";
import { onRound } from "./road-plant";

describe("a pour", () => {
  test("its quad runs from the lip to past the landing, as wide as its heap, and carries what it is told on every corner", () => {
    const v = new Float32Array(4 * 18);
    pourVerts(v, [10, 20], [16, 80], 4, 1.2, { time: 3, kind: POUR.tar, head: 0.7, tail: 0.1, pile: 0.5, lit: 0xff8000, shade: 0x102030 });
    // The lip: either side of where it leaves, at its height, the top of the fall.
    expect([v[0], v[1], v[2], v[3]]).toEqual([10 - 4 * 2.6, 20, -1, 0].map(Math.fround));
    expect(v[18 + 2]).toBe(1);
    // The foot: past the landing along the same line, for the heap.
    expect(v[2 * 18 + 3]).toBeGreaterThan(1);
    expect(v[2 * 18 + 1]).toBeGreaterThan(80);
    for (let k = 0; k < 4; k++) {
      const o = k * 18;
      expect([v[o + 4], v[o + 5], v[o + 6], v[o + 7], v[o + 9]]).toEqual([3, 2, 0.7, 0.1, 0.5].map(Math.fround));
      expect(v[o + 12]).toBeCloseTo(1, 5);
      expect(v[o + 17]).toBeCloseTo(0x30 / 255, 5);
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

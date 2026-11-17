/**
 * Something poured — its grains and its heap — a road growing, and the gang's rounds.
 */
import { describe, expect, test } from "bun:test";

import { COLUMN, GRAVITY, POURS, clearPour, createPourSim, heaped, stepPour } from "./pour-sim";
import { growSources } from "./road-grow";
import { onRound } from "./road-plant";

describe("something poured", () => {
  const run = (s: ReturnType<typeof createPourSim>, seconds: number, pours: boolean, width = 8, o = {}) => { let landed = 0; for (let t = 0; t < seconds; t += 1 / 60) landed += stepPour(s, 1 / 60, pours, width, o); return landed; };

  test("grains fall as things fall and land where they are aimed: the heap rises under the landing, and what lands is what the heap is", () => {
    const s = createPourSim(POURS.stone);
    s.dx = 9; s.drop = 14;
    // Nothing has landed in the time the fall takes less a little; then it has.
    const fall = Math.sqrt((2 * 14) / GRAVITY);
    expect(run(s, fall * 0.7, true)).toBe(0);
    const landed = run(s, 2, true, 8, { gain: 0.2 });
    expect(landed).toBeGreaterThan(50);
    expect(heaped(s)).toBeCloseTo(landed, 3);
    // Its top is over the landing, give or take the lip's width.
    let peak = 0;
    s.heap.forEach((h, i) => { if (h > s.heap[peak]) peak = i; });
    expect(Math.abs(peak - (s.heap.length >> 1)) * COLUMN).toBeLessThan(6);
    // Stopped, the last of it falls and nothing is left in the air.
    run(s, 2, false);
    expect(s.n).toBe(0);
  });

  test("the heap stands no steeper than its stuff will: earth steep, blacktop all but level", () => {
    for (const kind of [POURS.earth, POURS.stone, POURS.tar]) {
      const s = createPourSim(kind);
      s.dx = 0; s.drop = 20;
      run(s, 3, true, 4, { gain: 0.3 });
      run(s, 2, false, 4, { gain: 0.3 });
      let steepest = 0;
      for (let i = 0; i + 1 < s.heap.length; i++) steepest = Math.max(steepest, Math.abs(s.heap[i] - s.heap[i + 1]) / COLUMN);
      expect(steepest).toBeLessThanOrEqual(kind.rest + 0.1);
      expect(heaped(s)).toBeGreaterThan(20);
    }
    // And so, of as much of each, blacktop lies lower and wider than earth.
    const tops = [POURS.earth, POURS.tar].map((kind) => { const s = createPourSim(kind); s.drop = 20; run(s, 3, true, 4, { rate: 100, gain: 5.3 / (kind.grain * kind.grain * 0.8) }); run(s, 2, false, 4); return Math.max(...s.heap); });
    expect(tops[1]).toBeLessThan(tops[0] * 0.6);
  });

  test("walls hold it: nothing heaps beyond them; and what is taken away goes", () => {
    const s = createPourSim(POURS.earth, 6);
    s.drop = 16;
    run(s, 3, true, 6);
    const mid = s.heap.length >> 1, edge = Math.round(6 / COLUMN);
    s.heap.forEach((h, i) => { if (Math.abs(i - mid) > edge) expect(h).toBe(0); });
    expect(s.heap[mid + edge]).toBeGreaterThan(0);
    const full = heaped(s);
    run(s, 2, false, 6, { drain: 1 });
    expect(heaped(s)).toBeLessThan(full * 0.2);
    // And a grain stands for as much as it is told to.
    const a = createPourSim(POURS.stone), b = createPourSim(POURS.stone);
    a.drop = b.drop = 12;
    const whole = run(a, 1, true, 6), tenth = run(b, 1, true, 6, { gain: 0.1 });
    expect(tenth).toBeGreaterThan(0);
    expect(tenth / whole).toBeLessThan(0.2);
    clearPour(a);
    expect(heaped(a)).toBe(0);
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

/**
 * Something poured — its grains and its heap — a road growing, and the gang's rounds.
 */
import { describe, expect, test } from "bun:test";

import { COLUMN, GRAVITY, POURS, carry, clearPour, createPourSim, eachColumn, groundAt, heaped, stepPour } from "./pour-sim";
import { growSources } from "./road-grow";
import { LEFT_BEHIND, STRIDE, walkRound, type Walker } from "./road-plant";

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

describe("what is poured on the ground", () => {
  test("stays where it fell: as the lip moves on the heap is left behind it, each column keeping its own number, and what passes out of reach is gone", () => {
    const s = createPourSim(POURS.stone);
    s.drop = 12;
    for (let t = 0; t < 2; t += 1 / 60) stepPour(s, 1 / 60, true, 4, { gain: 0.2 });
    const mid = s.heap.length >> 1, before = Array.from(s.heap), ids: number[] = [];
    eachColumn(s, (_x, _g, _h, id) => ids.push(id));
    // The lip moves three columns on: the heap is three columns back under it, and is the same heap.
    carry(s, 3 * COLUMN);
    for (let i = 0; i + 3 < s.heap.length; i++) expect(s.heap[i]).toBe(before[i + 3]);
    const after: number[] = [];
    eachColumn(s, (_x, _g, _h, id) => after.push(id));
    expect(after).toEqual(ids);
    expect(s.heap[mid]).toBe(before[mid + 3]);
    // Far enough on, and none of it is under the lip any more.
    carry(s, s.heap.length * COLUMN);
    expect(heaped(s)).toBe(0);
  });

  test("lies along the road as the screen shows it: the ground under it runs aslant, and a grain lands on that", () => {
    const s = createPourSim(POURS.earth);
    s.dx = 0; s.drop = 10; s.base = 0.5;
    expect(groundAt(s, 0)).toBe(10);
    expect(groundAt(s, 8)).toBe(14);
    expect(groundAt(s, -8)).toBe(6);
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
  test("nobody slides: whoever is not walking has not moved, and whoever has moved is walking, at a walk", () => {
    const h: Walker = {};
    // A machine creeping on at a tenth of a cell a second, for two minutes.
    let seen = { work: 0, stand: 0, walk: 0 }, back = 0;
    for (let f = 0, by = 3; f < 60 * 120; f++, by += 0.1 / 60) {
      const was = { p: h.p, ac: h.ac }, r = walkRound(h, round, by, 1 / 60);
      seen[r.pose]++;
      if (was.p === undefined) continue;
      const moved = Math.hypot(h.p! - was.p, h.ac! - was.ac!);
      if (r.pose === "walk") expect(moved).toBeCloseTo(STRIDE / 60, 6);
      // (Arriving, they take the last part of a step.)
      else expect(moved).toBeLessThanOrEqual(STRIDE / 60 + 1e-6);
      if (r.pose !== "walk" && moved > 0) back++;
      // Never left far behind the machine: a stop's place, and what it creeps while they are there and on their way.
      expect(Math.abs(h.p! - by)).toBeLessThan(1.6 + LEFT_BEHIND + 0.5);
    }
    expect(seen.work).toBeGreaterThan(600); expect(seen.stand).toBeGreaterThan(300); expect(seen.walk).toBeGreaterThan(600);
    // Moved while not walking only on the step they arrive: once a stop.
    expect(back).toBeLessThan(40);
  });
  test("a job that stands: nobody moves", () => {
    const h: Walker = {};
    walkRound(h, round, 3, 1 / 60);
    for (let f = 0; f < 300; f++) walkRound(h, round, 3, 1 / 60);
    const at = { ...h };
    for (let f = 0; f < 600; f++) expect(walkRound(h, round, 3, 0).pose).not.toBe("walk");
    expect(h.p).toBe(at.p); expect(h.ac).toBe(at.ac);
  });
});

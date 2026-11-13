import { describe, expect, test } from "bun:test";

import { FLOW_DEFAULTS, createColumnField } from "../../fluid/columns";
import { addBoat, createFleet, stepFleet } from "./fleet";
import { ARM_WHITE, WAKE_LIFE, createWake, foamWake, stepWake, wakeMarks } from "./wake";

/** A lake `tiles` across whose surface falls toward +x, so a boat drifts. */
const river = (tiles: number) => {
  const n = tiles * 4;
  const c = createColumnField(n, n, { ...FLOW_DEFAULTS, wind: 0 }, 0.25);
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) { c.ground[cy * n + cx] = -cx * 0.1; c.depth[cy * n + cx] = 3; }
  }
  return c;
};

describe("a boat's wake", () => {
  test("trails a boat under way, and leaves the water exactly as it was", () => {
    const c = river(16);
    const depth = c.depth.slice(), ground = c.ground.slice();
    const f = createFleet();
    const b = addBoat(f, c, 4, 8)!;
    const w = createWake();
    for (let k = 0; k < 120; k++) { stepFleet(f, c, 1 / 60); stepWake(w, f, 1 / 60); }
    const marks = wakeMarks(w, c);
    expect(marks.length).toBeGreaterThan(3);
    // Behind it, and spreading: the oldest arms are wider apart than the newest.
    for (const m of marks) expect(m.mid.x).toBeLessThan(b.x);
    const width = (m: (typeof marks)[number]) => Math.hypot(m.left.x - m.right.x, m.left.y - m.right.y);
    expect(width(marks[0])).toBeGreaterThan(width(marks[marks.length - 1]));
    // On the sheet.
    for (const m of marks) expect(m.mid.z).toBeCloseTo(3 - (m.mid.x + 0.5) * 0.4 + 0.05, 0);
    // A trail and nothing more.
    expect([...c.depth]).toEqual([...depth]);
    expect([...c.ground]).toEqual([...ground]);
  });

  test("a boat at rest leaves none, and an old wake fades away", () => {
    const c = river(16);
    c.ground.fill(0);                                 // still water now
    const f = createFleet();
    addBoat(f, c, 4, 8);
    const w = createWake();
    for (let k = 0; k < 60; k++) { stepFleet(f, c, 1 / 60); stepWake(w, f, 1 / 60); }
    expect(w.points.length).toBe(0);
    w.points.push({ boat: 1, x: 3, y: 8, hx: 1, hy: 0, born: w.t, strength: 1 });
    stepWake(w, f, WAKE_LIFE + 0.1);
    expect(w.points.length).toBe(0);
  });
});

describe("a wake's foam", () => {
  test("is the water's own: marked on the columns its arms and churn lie over, strongest nearest the boat, and nowhere else", () => {
    const c = river(16);
    const depth = c.depth.slice();
    const f = createFleet();
    const b = addBoat(f, c, 4, 8)!;
    const w = createWake();
    for (let k = 0; k < 120; k++) { stepFleet(f, c, 1 / 60); stepWake(w, f, 1 / 60); }
    expect(c.drips.splashed).toBe(false);
    const made = foamWake(wakeMarks(w, c), c);
    expect(made).toBeGreaterThan(10);
    // Through the one way in: the marks, the list they fade from and the flag the foam reads all agree.
    expect(c.drips.splashed).toBe(true);
    const lit = [...c.drips.splash].map((v, i) => ({ v, x: ((i % c.nx) + 0.5) / 4 - 0.5, y: (Math.floor(i / c.nx) + 0.5) / 4 - 0.5 })).filter((m) => m.v > 0);
    expect(lit.length).toBe(c.drips.nlit);
    // Behind the boat, never ahead of it; none whiter than an arm at its strongest.
    for (const m of lit) { expect(m.x).toBeLessThan(b.x + 0.3); expect(m.v).toBeLessThanOrEqual(ARM_WHITE + 1e-6); }
    // Whiter near the boat than at the far end of the wake.
    const near = lit.filter((m) => m.x > b.x - 0.6), far = lit.filter((m) => m.x < Math.min(...lit.map((q) => q.x)) + 0.4);
    const mean = (l: typeof lit) => l.reduce((n, m) => n + m.v, 0) / l.length;
    expect(mean(near)).toBeGreaterThan(mean(far));
    // Either side of where it went as well as behind it: the arms have spread.
    const ys = lit.map((m) => m.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.5);
    // Foam is a mark on the water, not water: none is moved.
    expect([...c.depth]).toEqual([...depth]);
  });

  test("none on dry ground, and none from a boat at rest", () => {
    const c = river(16);
    c.ground.fill(0);
    const f = createFleet();
    addBoat(f, c, 4, 8);
    const w = createWake();
    for (let k = 0; k < 60; k++) { stepFleet(f, c, 1 / 60); stepWake(w, f, 1 / 60); }
    expect(foamWake(wakeMarks(w, c), c)).toBe(0);
    // A wake whose water has gone marks nothing.
    w.points.push({ boat: 1, x: 3, y: 8, hx: 1, hy: 0, born: w.t, strength: 1 }, { boat: 1, x: 3.2, y: 8, hx: 1, hy: 0, born: w.t, strength: 1 });
    c.depth.fill(0);
    expect(foamWake(wakeMarks(w, c), c)).toBe(0);
    expect(c.drips.splashed).toBe(false);
  });
});

describe("hulls move the water", () => {
  test("a hull under way raises the water at its bow and lowers it astern, and nothing is made or lost", async () => {
    const { FLOW_DEFAULTS, createColumnField, totalWater } = await import("../../fluid/columns");
    const { pushWater } = await import("./wake");
    const { addBoat, createFleet } = await import("./fleet");
    const c = createColumnField(64, 64, { ...FLOW_DEFAULTS, wind: 0 }, 0.25);
    c.depth.fill(4);
    const f = createFleet();
    for (const [cls, y] of [[0, 4], [1, 8], [2, 12]] as const) {
      const b = addBoat(f, c, 6, y, cls)!;
      b.vx = 0.8; b.heading = 0;
    }
    const before = totalWater(c);
    for (let k = 0; k < 120; k++) { for (const b of f.boats) b.x += b.vx / 60; pushWater(f, c, 1 / 60); }
    expect(totalWater(c)).toBeCloseTo(before, 6);
    let high = 0, low = 0;
    for (const d of c.depth) { if (d > 4.001) high++; if (d < 3.999) low++; }
    expect(high).toBeGreaterThan(0);
    expect(low).toBeGreaterThan(0);
    // Tied up, or stopped, it moves none.
    const still = Float32Array.from(c.depth);
    for (const b of f.boats) b.moor = { x: b.x, y: b.y };
    pushWater(f, c, 1 / 60);
    expect(Array.from(c.depth)).toEqual(Array.from(still));
  });
});

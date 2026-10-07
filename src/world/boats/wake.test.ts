import { describe, expect, test } from "bun:test";

import { FLOW_DEFAULTS, createColumnField } from "../../fluid/columns";
import { addBoat, createFleet, stepFleet } from "./fleet";
import { WAKE_LIFE, createWake, stepWake, wakeMarks } from "./wake";

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

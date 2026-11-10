/**
 * Walkers over the pavements: off the kerb only where the road is crossed,
 * over it when it is safe — on the walk at lights, on a zebra with the cars
 * stopping for them, in a gap elsewhere — and never under a car.
 */
import { describe, expect, test } from "bun:test";

import { createNetwork } from "../../roads/network";
import { halfLength } from "../cars/fleet";
import { createTown, setTownCaps, stepTown, townCaps, trafficOf, type Mover } from "../town";
import { walkLeft } from "./drive";
import { crossroads } from "./traffic.test-kit";
import type { Grid } from "../../grid";

/** A busy town of walkers and cars for `secs`: what the walkers did at the crossings. */
function walkers(g: Grid, secs: number, zebras = false) {
  const caps = { ...townCaps };
  setTownCaps({ cars: 40, people: 40, every: 1 });
  const net = createNetwork(g), t = createTown();
  const T = trafficOf(t, g);
  if (zebras) {
    t.dress = new Uint8Array(g.w * g.h);
    for (const c of T.G.crossings) for (const i of c.cells) t.dress[i] = 4;
  }
  const out = { crossed: 0, offKerb: 0, under: 0, steppedOnRed: 0, waited: 0, arrived: 0 };
  const lines = new Map<number, Mover>();
  const dt = 1 / 20;
  for (let k = 0; k < secs / dt; k++) {
    const was = new Map(t.movers.filter((m) => m.walk).map((m) => [m.id, m.walk!.on]));
    const before = new Set(t.movers.map((m) => m.id));
    stepTown(t, g, net, 0, dt);
    const after = new Set(t.movers.map((m) => m.id));
    for (const id of before) if (!after.has(id) && lines.get(id)?.kind === "person") out.arrived++;
    const cars = t.movers.filter((m) => m.kind !== "person");
    for (const m of t.movers) {
      lines.set(m.id, m);
      const w = m.walk;
      if (!w) continue;
      const x = w.crossings[w.k];
      // OUT ON IT just now: at lights, only on the walk.
      if (x && w.on && was.get(m.id) === false) {
        out.crossed++;
        const C = T.G.crossings[x.c];
        if (C.junction >= 0 && T.G.junctions[C.junction].kind === "signals" && walkLeft(T, C.junction, t.t) <= 0) out.steppedOnRed++;
      }
      if (x && !w.on && w.waited > 0) out.waited += dt;
      // OFF THE KERB only on a crossing: anywhere else, at the side of the cell.
      const onCrossing = w.crossings.some((c) => m.s > c.s0 - 0.02 && m.s < c.s1 + 0.02);
      const edge = Math.max(Math.abs(m.x - Math.round(m.x)), Math.abs(m.y - Math.round(m.y)));
      const onMap = m.x > -0.5 && m.y > -0.5 && m.x < g.w - 0.5 && m.y < g.h - 0.5;
      if (onMap && !onCrossing && !m.sit && edge < 0.3) out.offKerb++;
      // UNDER A CAR, out on a crossing.
      if (onCrossing) {
        for (const c of cars) {
          const hx = Math.cos(c.heading), hy = Math.sin(c.heading), dx = m.x - c.x, dy = m.y - c.y;
          if (Math.abs(dx * hx + dy * hy) < halfLength(c) && Math.abs(-dx * hy + dy * hx) < 0.1) out.under++;
        }
      }
    }
  }
  setTownCaps(caps);
  return out;
}

describe("walkers at the crossings", () => {
  test("give way: over in the gaps, only where it is crossed, and never under a car", () => {
    const r = walkers(crossroads(1, 1), 120);
    expect(r.crossed).toBeGreaterThan(10);
    expect(r.offKerb).toBe(0);
    expect(r.under).toBe(0);
    expect(r.arrived).toBeGreaterThan(20);
  });

  test("zebras: the cars stop for them, and they wait less", () => {
    const g = crossroads(1, 1);
    const plain = walkers(g, 120), zebra = walkers(g, 120, true);
    expect(zebra.crossed).toBeGreaterThan(10);
    expect(zebra.under).toBe(0);
    expect(zebra.waited / zebra.crossed).toBeLessThan(plain.waited / plain.crossed);
  });

  test("lights: over on the walk, and never on the red", () => {
    const r = walkers(crossroads(2, 1), 120);
    expect(r.crossed).toBeGreaterThan(10);
    expect(r.steppedOnRed).toBe(0);
    expect(r.offKerb).toBe(0);
    expect(r.under).toBe(0);
  });
});

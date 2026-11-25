/**
 * Walkers over the pavements: off the kerb only where the road is crossed,
 * over it when it is safe — on the walk at lights, on a zebra with the cars
 * stopping for them, in a gap elsewhere — and never under a car.
 */
import { describe, expect, test } from "bun:test";

import { FIXTURE_SIZE, applyFixture } from "../../debug/fixtures";
import { createNetwork } from "../../roads/network";
import { halfLength } from "../cars/fleet";
import { createTown, setTownCaps, stepTown, townCaps, trafficOf, type Mover } from "../town";
import { walkOn } from "./drive";
import { crossroads } from "./traffic.test-kit";
import { createGrid, type Grid } from "../../grid";

/** A busy town of walkers and cars for `secs`: what the walkers did at the crossings. */
function walkers(g: Grid, secs: number, zebras = false, people = 40) {
  const caps = { ...townCaps };
  setTownCaps({ cars: 40, people, every: 1 });
  const net = createNetwork(g), t = createTown();
  const T = trafficOf(t, g);
  if (zebras) {
    t.dress = new Uint8Array(g.w * g.h);
    for (const c of T.G.crossings) for (const i of c.cells) t.dress[i] = 4;
  }
  const out = { crossed: 0, offKerb: 0, under: 0, steppedOnRed: 0, waited: 0, arrived: 0, drove: 0, longestStand: 0, stood: 0 };
  let seen = 0;
  const standing = new Map<number, number>();
  const lines = new Map<number, Mover>();
  const dt = 1 / 20;
  for (let k = 0; k < secs / dt; k++) {
    const was = new Map(t.movers.filter((m) => m.walk).map((m) => [m.id, m.walk!.on]));
    const before = new Set(t.movers.map((m) => m.id));
    stepTown(t, g, net, 0, dt);
    const after = new Set(t.movers.map((m) => m.id));
    for (const id of before) if (!after.has(id)) { if (lines.get(id)?.kind === "person") out.arrived++; else out.drove++; }
    const cars = t.movers.filter((m) => m.kind !== "person");
    // STOOD AT A CROSSING'S LINE, the first in its queue: for how long, without a break.
    for (const c of cars) {
      seen++;
      if (c.speed < 0.05 && !c.wait) out.stood++;
      const d = c.drive;
      let atLine = false;
      for (let j = d?.k ?? 0; d && j < Math.min(d.lanes.length, d.k + 2); j++) for (const x of T.over.get(d.lanes[j]) ?? []) {
        const front = d.start[j] + x.s - c.s - halfLength(c);
        if (front > 0.1 && front < 0.55) atLine = true;
      }
      const s = atLine && c.speed < 0.05 ? (standing.get(c.id) ?? 0) + dt : 0;
      standing.set(c.id, s);
      out.longestStand = Math.max(out.longestStand, s);
    }
    for (const m of t.movers) {
      lines.set(m.id, m);
      const w = m.walk;
      if (!w) continue;
      const x = w.crossings[w.k];
      // OUT ON IT just now: at lights, only on the walk.
      if (x && w.on && was.get(m.id) === false) {
        out.crossed++;
        const C = T.G.crossings[x.c];
        if (C.junction >= 0 && T.G.junctions[C.junction].kind === "signals" && !walkOn(T, C.junction, T.G.junctions[C.junction].arms.findIndex((a) => a.crossing === x.c), t.t)) out.steppedOnRed++;
      }
      if (x && !w.on && w.waited > 0) out.waited += dt;
      // OFF THE KERB only on a crossing: anywhere else, at the side of the cell.
      const onCrossing = w.crossings.some((c) => m.s > c.s0 - 0.02 && m.s < c.s1 + 0.02);
      const edge = Math.max(Math.abs(m.x - Math.round(m.x)), Math.abs(m.y - Math.round(m.y)));
      const onMap = m.x > -0.5 && m.y > -0.5 && m.x < g.w - 0.5 && m.y < g.h - 0.5;
      // (Out of a car at the kerb, or into one: the first steps or the last.)
      const atCar = m.s < 0.3 || m.at[m.at.length - 1] - m.s < 0.3;
      if (onMap && !onCrossing && !m.sit && !atCar && edge < 0.3) out.offKerb++;
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
  out.stood /= seen;
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

  test("crowds at the zebras: the traffic gets its turn, the queue goes together, and nobody stands there for ever", () => {
    const r = walkers(crossroads(1, 1), 150, true, 120);
    expect(r.crossed).toBeGreaterThan(100);
    expect(r.under).toBe(0);
    // (It once stood 45 s, one car a ten-second turn, the crowd back out between each.)
    expect(r.longestStand).toBeLessThan(25);
    expect(r.drove).toBeGreaterThan(60);
  });

  test("a town of wide roads, zebras all over: the traffic keeps moving", () => {
    const n = FIXTURE_SIZE.traffic ?? 48, g = createGrid(n, n, 1);
    applyFixture(g, "traffic", 1);
    const r = walkers(g, 200, true, 120);
    // (Two in three once stood still: cars on the green for people held at the red, cars in the junction and people at its kerb each for the other.)
    expect(r.stood).toBeLessThan(0.35);
    expect(r.under).toBe(0);
  });

  test("lights: over on the walk, and never on the red", () => {
    const r = walkers(crossroads(2, 1), 120);
    expect(r.crossed).toBeGreaterThan(10);
    expect(r.steppedOnRed).toBe(0);
    expect(r.offKerb).toBe(0);
    expect(r.under).toBe(0);
  });
});

describe("those who have stopped by a crossing hold nobody up", () => {
  /** A crossroads, somebody who came over a crossing to a place right at its far kerb, and what they do there. */
  const stood = (what: (m: Mover) => void) => {
    const caps = { ...townCaps };
    setTownCaps({ cars: 30, people: 0, every: 2 });
    const g = crossroads(1, 1), net = createNetwork(g), t = createTown(), T = trafficOf(t, g);
    const C = T.G.crossings.find((c) => c.junction >= 0)!, a = T.G.walk.nodes[C.a], b = T.G.walk.nodes[C.b], len = Math.hypot(b.x - a.x, b.y - a.y);
    const m = {
      id: t.next++, kind: "person", path: [{ x: Math.round(b.x), y: Math.round(b.y) }, { x: Math.round(b.x), y: Math.round(b.y) }], line: [a, b], at: new Float32Array([0, len]),
      s: len, speed: 0, cruise: 0.45, x: b.x, y: b.y, z: 0, heading: 0, stuck: 0, colour: 0, phase: 0,
      walk: { graph: T.G, crossings: [{ c: C.id, s0: 0, s1: len }], k: 0, on: true, waited: 0 },
    } as unknown as Mover;
    what(m);
    t.movers.push(m);
    let longest = 0, over = 0;
    for (let k = 0; k < 120 * 20; k++) {
      stepTown(t, g, net, 0, 1 / 20);
      for (const c of t.movers) if (c.kind !== "person") longest = Math.max(longest, c.stuck);
    }
    for (const x of T.lanesOver.get(C.id) ?? []) over += T.over.get(x)!.length;
    setTownCaps(caps);
    expect(over).toBeGreaterThan(0);
    return longest;
  };
  test("a builder put to work, where their way in ended at a crossing's kerb", () => {
    expect(stood((m) => { m.s = 0; m.at = new Float32Array(1); m.line = [m.line[1]]; m.job = { site: 1, role: "working" }; })).toBeLessThan(25);
  });
  test("a cleaner at their work", () => {
    expect(stood((m) => { m.s = 0; m.job = { site: 1, role: "cleaning" }; })).toBeLessThan(25);
  });
});

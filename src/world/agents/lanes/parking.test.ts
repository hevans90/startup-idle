/**
 * Parking at the kerb: cars to a door park in a bay near it and their people
 * walk in; trips from a door walk out to one and drive off when they are in;
 * on a street one cell wide, the others get by out in the oncoming lane when
 * it is clear — and nobody drives through anybody, parked or not.
 */
import { describe, expect, test } from "bun:test";

import { createNetwork } from "../../roads/network";
import { createTown, setTownCaps, stepTown, townCaps, trafficOf, type Mover } from "../town";
import { crossroads, overlap } from "./traffic.test-kit";
import type { Grid } from "../../grid";

/** A town `secs` seconds: how its parking went. */
function parking(g: Grid, secs: number) {
  const caps = { ...townCaps };
  setTownCaps({ cars: 30, people: 10, every: 1 });
  const net = createNetwork(g), t = createTown();
  const out = { parkedIn: 0, pulledOut: 0, passes: 0, overlaps: 0, gone: 0, residents: 0, boarded: 0, longest: 0 };
  const passing = new Set<number>();
  const dt = 1 / 20;
  for (let k = 0; k < secs / dt; k++) {
    const was = new Set(t.parked.map((c) => c.id)), before = new Map(t.movers.map((m) => [m.id, m]));
    stepTown(t, g, net, 0, dt);
    if (k === 0) out.residents = t.parked.length;
    const now = new Set(t.parked.map((c) => c.id)), moving = new Set(t.movers.map((m) => m.id));
    for (const c of t.parked) if (!was.has(c.id)) out.parkedIn++;
    for (const id of was) if (!now.has(id) && moving.has(id)) out.pulledOut++;
    for (const [id, m] of before) if (!moving.has(id) && m.gone) { out.gone++; if (process.env.DBG) console.log("GONE", (k * dt).toFixed(1), m.kind, m.x.toFixed(2), m.y.toFixed(2), JSON.stringify(m.pass)); }
    for (const [id, m] of before) if (!moving.has(id) && m.toCar !== undefined) out.boarded++;
    const cars: Mover[] = [...t.movers.filter((m) => m.kind !== "person"), ...t.parked];
    for (const m of cars) {
      if (m.pass && !passing.has(m.id)) { passing.add(m.id); out.passes++; }
      if (!m.pass) passing.delete(m.id);
      if (!m.park) out.longest = Math.max(out.longest, m.stuck);
    }
    const on = (m: Mover) => m.x >= 0 && m.y >= 0 && m.x <= g.w - 1 && m.y <= g.h - 1;
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (a.park && b.park) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.6 && on(a) && on(b) && overlap(a, b)) {
        out.overlaps++;
        if (process.env.DBG) console.log("OVER", (k * dt).toFixed(1), a.id, a.kind, !!a.park, JSON.stringify(a.pass), a.side?.toFixed(2), a.speed.toFixed(2), "|", b.id, b.kind, !!b.park, JSON.stringify(b.pass), b.side?.toFixed(2), b.speed.toFixed(2), Math.hypot(a.x - b.x, a.y - b.y).toFixed(2));
      }
    }
  }
  setTownCaps(caps);
  return { ...out, bays: trafficOf(t, g).G.bays.length, left: t.parked.length };
}

describe("parking at the kerb", () => {
  test("narrow streets: in and out of the bays, and by the parked cars in the oncoming lane", () => {
    const r = parking(crossroads(1, 1), 900);
    if (process.env.DBG) console.log(r);
    expect(r.residents).toBeGreaterThan(0);
    expect(r.parkedIn).toBeGreaterThan(5);
    expect(r.pulledOut).toBeGreaterThan(3);
    expect(r.boarded).toBeGreaterThan(3);
    expect(r.passes).toBeGreaterThan(5);
    expect(r.overlaps).toBe(0);
    expect(r.gone).toBe(0);
  });

  test("wide roads: the bays are out of the lanes", () => {
    const r = parking(crossroads(2, 2), 240);
    if (process.env.DBG) console.log(r);
    expect(r.parkedIn).toBeGreaterThan(5);
    expect(r.passes).toBe(0);
    expect(r.overlaps).toBe(0);
    expect(r.gone).toBe(0);
  });
});

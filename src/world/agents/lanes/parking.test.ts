/**
 * Parking at the kerb: cars to a door park in a bay near it and their people
 * walk in; trips from a door walk out to one and drive off when they are in.
 * The bays are out of the lanes — on a street one cell wide, in lay-bys — so
 * nobody has to get by a parked car, and nobody drives through anybody,
 * parked or not.
 */
import { describe, expect, test } from "bun:test";

import { createNetwork } from "../../roads/network";
import { createTown, setTownCaps, stepTown, townCaps, trafficOf, type Mover } from "../town";
import { crossroads, overlap } from "./traffic.test-kit";
import { NEIGHBOUR } from "../../../iso/dir";
import { bayMarksOf, buildLaneGraph, LAYBY_AT } from "./graph";
import { looksOf } from "../../roads/looks";
import type { Grid } from "../../grid";

/** A town `secs` seconds: how its parking went. */
function parking(g: Grid, secs: number) {
  const caps = { ...townCaps };
  setTownCaps({ cars: 30, people: 10, every: 1 });
  const net = createNetwork(g), t = createTown();
  const out = { parkedIn: 0, pulledOut: 0, overlaps: 0, gone: 0, residents: 0, boarded: 0, longest: 0 };
  const dt = 1 / 20;
  for (let k = 0; k < secs / dt; k++) {
    const was = new Set(t.parked.map((c) => c.id)), before = new Map(t.movers.map((m) => [m.id, m]));
    stepTown(t, g, net, 0, dt);
    if (k === 0) out.residents = t.parked.length;
    const now = new Set(t.parked.map((c) => c.id)), moving = new Set(t.movers.map((m) => m.id));
    for (const c of t.parked) if (!was.has(c.id)) out.parkedIn++;
    for (const id of was) if (!now.has(id) && moving.has(id)) out.pulledOut++;
    for (const [id, m] of before) if (!moving.has(id) && m.gone) { out.gone++; if (process.env.DBG) console.log("GONE", (k * dt).toFixed(1), m.kind, m.x.toFixed(2), m.y.toFixed(2)); }
    for (const [id, m] of before) if (!moving.has(id) && m.toCar !== undefined) out.boarded++;
    const cars: Mover[] = [...t.movers.filter((m) => m.kind !== "person"), ...t.parked];
    for (const m of cars) if (!m.park) out.longest = Math.max(out.longest, m.stuck);
    const on = (m: Mover) => m.x >= 0 && m.y >= 0 && m.x <= g.w - 1 && m.y <= g.h - 1;
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (a.park && b.park) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.6 && on(a) && on(b) && overlap(a, b)) {
        out.overlaps++;
        if (process.env.DBG) console.log("OVER", (k * dt).toFixed(1), a.id, a.kind, !!a.park, a.side?.toFixed(2), a.speed.toFixed(2), "|", b.id, b.kind, !!b.park, b.side?.toFixed(2), b.speed.toFixed(2), Math.hypot(a.x - b.x, a.y - b.y).toFixed(2));
      }
    }
  }
  setTownCaps(caps);
  const G = trafficOf(t, g).G;
  return { ...out, bays: G.bays.length, laybys: G.bays.filter((b) => b.layby).length, left: t.parked.length };
}

describe("parking at the kerb", () => {
  test("narrow streets: in and out of the lay-bys", () => {
    const r = parking(crossroads(1, 1), 900);
    if (process.env.DBG) console.log(r);
    expect(r.laybys).toBe(r.bays);
    expect(r.residents).toBeGreaterThan(0);
    expect(r.parkedIn).toBeGreaterThan(5);
    expect(r.pulledOut).toBeGreaterThan(3);
    expect(r.boarded).toBeGreaterThan(3);
    expect(r.overlaps).toBe(0);
    expect(r.gone).toBe(0);
  });

  test("wide roads: the bays are out of the lanes", () => {
    const r = parking(crossroads(2, 2), 240);
    if (process.env.DBG) console.log(r);
    expect(r.parkedIn).toBeGreaterThan(5);
    expect(r.laybys).toBe(0);
    expect(r.overlaps).toBe(0);
    expect(r.gone).toBe(0);
  });

  test("lay-bys: out of the lane, the kerb set back and painted, walkers by on the pavement", () => {
    const g = crossroads(1, 1), G = buildLaneGraph(g);
    const lay = G.bays.filter((b) => b.layby);
    expect(lay.length).toBeGreaterThan(0);
    const looks = looksOf(g, undefined, bayMarksOf(G, g));
    for (const b of lay) {
      // A car in it clear of one going by in the lane, side by side.
      expect(b.side - 0.085).toBeGreaterThanOrEqual(0.085);
      const x = b.cell % g.w, y = (b.cell / g.w) | 0, [dx, dy] = NEIGHBOUR[b.kerb];
      // The pavement's points beside it set back with the kerb.
      for (const e of [-1, 1]) {
        const n = G.walk.at.get(`${x},${y},${dx || e},${dy || e}`)!;
        const p = G.walk.nodes[n];
        expect(dx ? (p.x - x) * dx : (p.y - y) * dy).toBeCloseTo(LAYBY_AT, 5);
      }
      // Painted: a lay-by there, and either end of a run tapering in.
      expect(looks[b.cell]!.bay).toContain("L");
      for (const e of [-1, 1]) {
        const ax = dx ? 0 : e, ay = dx ? e : 0, j = b.cell + ay * g.w + ax;
        if (!G.bays.some((o) => o.cell === j && o.layby)) expect(looks[j]!.bay).toContain("T");
      }
    }
  });
});

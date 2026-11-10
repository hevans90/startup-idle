/**
 * The buses: stops at the kerb of the wider streets, routes round the
 * busiest; buses round them, standing at each stop, people getting on and
 * off — and nobody driving through anybody.
 */
import { describe, expect, test } from "bun:test";

import { createGrid } from "../grid";
import { applyFixture } from "../debug/fixtures";
import { createNetwork } from "../roads/network";
import { createTown, setOff, setTownCaps, stepTown, townCaps, trafficOf, type Mover } from "./town";
import { kerbAt, queueAt } from "./buses";
import { stopTo } from "./bus-routes";
import { overlap } from "./lanes/traffic.test-kit";

function town(secs: number) {
  const caps = { ...townCaps };
  setTownCaps({ cars: 40, people: 80, every: 1 });
  const g = createGrid(48, 48, 1);
  applyFixture(g, "traffic", 1);
  const net = createNetwork(g), t = createTown();
  const out = { buses: new Set<number>(), calls: 0, boarded: 0, alighted: 0, overlaps: 0, gone: 0 };
  const riders = new Map<number, { n: number; at?: number }>();
  const dt = 1 / 20;
  for (let k = 0; k < secs / dt; k++) {
    const before = new Map(t.movers.map((m) => [m.id, m]));
    stepTown(t, g, net, 0, dt);
    // A few going by bus, waiting at the first stop of each route, to its last.
    if (k % 400 === 200) for (const r of t.buses!.routes) {
      const G = trafficOf(t, g).G, a = G.stops[r.stops[0]], b = G.stops[r.stops[r.stops.length - 1]];
      const doors = t.places.filter((p) => p.kind === "door" && !p.building);
      const to = doors.sort((p, q) => stopTo(b, p) - stopTo(b, q))[0];
      const w = setOff(t, g, "person", kerbAt(g, a), to);
      if (w) { w.ride = { route: r.id, on: 0, off: r.stops.length - 1, to, waited: 0 }; queueAt(t, g, G, w); t.movers.push(w); }
    }
    const now = new Map(t.movers.map((m) => [m.id, m]));
    for (const [id, m] of before) if (!now.has(id) && m.gone && m.kind !== "person") out.gone++;
    for (const m of t.movers) {
      if (!m.bus) continue;
      out.buses.add(m.id);
      const was = riders.get(m.id), n = m.bus.riders.length;
      if (was && m.bus.at !== was.at) { out.calls++; }
      riders.set(m.id, { n, at: m.bus.at });
      if (was && n > was.n) out.boarded += n - was.n;
      if (was && n < was.n) out.alighted += was.n - n;
    }
    const cars: Mover[] = t.movers.filter((m) => m.kind !== "person");
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.8 && overlap(a, b)) out.overlaps++;
    }
  }
  setTownCaps(caps);
  return { ...out, buses: out.buses.size };
}

describe("the buses", () => {
  test("stops at the kerb, routes round the busiest of them", () => {
    const g = createGrid(48, 48, 1);
    applyFixture(g, "traffic", 1);
    const net = createNetwork(g), t = createTown();
    stepTown(t, g, net, 0, 1 / 20);
    const G = trafficOf(t, g).G;
    expect(G.stops.length).toBeGreaterThan(4);
    for (const s of G.stops) {
      // In toward the kerb — on a street a cell wide, only a little — on a street lane.
      expect(s.side).toBeGreaterThan(-0.01);
      expect(G.lanes[s.lane].kind).toBe("street");
    }
    const routes = t.buses!.routes;
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.stops.length).toBeGreaterThanOrEqual(2);
      expect(new Set(r.stops).size).toBe(r.stops.length);
    }
  });

  test("round the routes: in at the stops, people on and off, nobody into anybody", () => {
    const r = town(300);
    expect(r.buses).toBeGreaterThan(1);
    expect(r.calls).toBeGreaterThan(5);
    expect(r.boarded).toBeGreaterThan(2);
    expect(r.alighted).toBeGreaterThan(0);
    expect(r.overlaps).toBe(0);
    expect(r.gone).toBe(0);
  });
});

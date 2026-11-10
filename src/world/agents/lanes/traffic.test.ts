/**
 * The traffic on the lanes, run for minutes on busy towns: nobody drives
 * through anybody, nobody is stuck for good, and trips get where they go —
 * through give ways, lights and a roundabout.
 */
import { describe, expect, test } from "bun:test";

import { createGrid, type Grid } from "../../grid";
import { FIXTURE_SIZE, applyFixture, type FixtureId } from "../../debug/fixtures";
import { createNetwork } from "../../roads/network";
import { createTown, setTownCaps, stepTown, townCaps, trafficOf } from "../town";
import { crossroads, overlap } from "./traffic.test-kit";
import { isChange, lightOf, lineOf, routeLanes } from "./drive";
import { buildLaneGraph } from "./graph";
import { isPaved } from "../../roads/mask";

/** Run a town `secs` seconds: trips finished, vehicles lost, overlaps, the longest wait. */
function soak(g: Grid, secs: number) {
  const net = createNetwork(g);
  const t = createTown();
  let arrived = 0, gone = 0, overlaps = 0, longest = 0, peak = 0, changed = 0, bikes = 0, behindBike = 0;
  const dt = 1 / 20;
  for (let k = 0; k < secs / dt; k++) {
    const before = new Map(t.movers.map((m) => [m.id, m]));
    stepTown(t, g, net, 0, dt);
    const after = new Set(t.movers.map((m) => m.id));
    for (const [id, m] of before) if (!after.has(id)) { const G0 = m.drive?.graph; if (G0 && m.drive!.lanes.some((l, k) => k > 0 && isChange(G0, m.drive!.lanes[k - 1], l))) changed++; if (!m.gone && m.kind === "bike") bikes++; if (m.gone) { gone++; if (process.env.DBG) console.log("GONE", k * dt, id, m.x.toFixed(2), m.y.toFixed(2), m.stuck.toFixed(1), m.drive?.lanes.join(">"), m.drive?.k, m.drive?.let, (m.at[m.at.length - 1] - m.s).toFixed(2)); } else arrived++; }
    const cars = t.movers.filter((m) => m.kind !== "person");
    peak = Math.max(peak, cars.length);
    for (const m of cars) longest = Math.max(longest, m.stuck);
    // A car close behind a cyclist on its lane, at the cyclist's pace.
    for (const b of cars) if (b.kind === "bike" && b.speed > 0.2) for (const m of cars) {
      if (m.kind === "bike" || m.drive?.lanes[m.drive.k] !== b.drive?.lanes[b.drive.k]) continue;
      const gap = (b.s - b.drive!.start[b.drive!.k]) - (m.s - m.drive!.start[m.drive!.k]);
      if (gap > 0 && gap < 1.4 && m.speed < b.speed + 0.1) behindBike++;
    }
    const on = (m: Mover) => m.x >= 0 && m.y >= 0 && m.x <= g.w - 1 && m.y <= g.h - 1;
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.6 && on(a) && on(b) && overlap(a, b)) {
        overlaps++;
        if (process.env.DBG) {
          const G = trafficOf(t, g).G, la = G.lanes[a.drive!.lanes[a.drive!.k]], lb = G.lanes[b.drive!.lanes[b.drive!.k]];
          console.log("OVER", k * dt, a.kind, b.kind, a.drive!.let, a.drive!.k, b.drive!.let, b.drive!.k, JSON.stringify(a.drive!.claims), JSON.stringify(b.drive!.claims), a.id, la.id, la.kind, la.turn, (a.s - a.drive!.start[a.drive!.k]).toFixed(2), a.speed.toFixed(2), (a.heading * 57.3).toFixed(0), "|", b.id, lb.id, lb.kind, lb.turn, (b.s - b.drive!.start[b.drive!.k]).toFixed(2), b.speed.toFixed(2), (b.heading * 57.3).toFixed(0), "d", Math.hypot(a.x - b.x, a.y - b.y).toFixed(2), a.drive!.lanes.join(">"), "/", b.drive!.lanes.join(">"));
        }
      }
    }
  }
  return { t, arrived, gone, overlaps, longest, peak, changed, bikes, behindBike };
}

describe("traffic on the lanes", () => {
  const caps = { ...townCaps };
  const busy = () => setTownCaps({ cars: 80, people: 0, every: 1 });
  const done = () => setTownCaps(caps);

  test("a roundabout: round it, giving way to the ring, and nobody into anybody", () => {
    busy();
    const g = crossroads(2, 2);
    const r = soak(g, 150);
    done();
    expect(trafficOf(r.t, g).G.junctions.map((j) => j.kind)).toEqual(["roundabout"]);
    expect(r.peak).toBeGreaterThan(15);
    expect(r.overlaps).toBe(0);
    expect(r.gone).toBe(0);
    expect(r.arrived).toBeGreaterThan(60);
  });

  test("lights: through on the green, and nobody into anybody", () => {
    busy();
    const g = crossroads(2, 1);
    const r = soak(g, 150);
    done();
    expect(trafficOf(r.t, g).G.junctions.map((j) => j.kind)).toEqual(["signals"]);
    expect(r.overlaps).toBe(0);
    expect(r.gone).toBe(0);
    expect(r.arrived).toBeGreaterThan(60);
  });

  test("the lights change, one way and then the other, never both green", () => {
    const g = crossroads(2, 1);
    const t = createTown();
    const T = trafficOf(t, g);
    const J = T.G.junctions[0];
    const ew = J.arms.findIndex((a) => Math.abs(a.out.x) > 0.5), ns = J.arms.findIndex((a) => Math.abs(a.out.x) < 0.5);
    const seen = new Set<string>();
    for (let s = 0; s < 30; s += 0.25) {
      const a = lightOf(T, J.id, ew, s), b = lightOf(T, J.id, ns, s);
      expect(a === "red" || b === "red").toBe(true);
      seen.add(a); seen.add(b);
    }
    expect([...seen].sort()).toEqual(["amber", "green", "red"]);
  });

  test("give way: a crossroads of narrow streets keeps going", () => {
    busy();
    const r = soak(crossroads(1, 1), 150);
    done();
    expect(r.overlaps).toBe(0);
    expect(r.gone).toBe(0);
    expect(r.arrived).toBeGreaterThan(40);
  });

  test("a road four cells wide: two lanes each way, side by side, and a change across to turn", () => {
    const g = crossroads(4, 1);
    const G = buildLaneGraph(g);
    const wide = G.lanes.filter((l) => l.kind === "street" && l.lanes === 2);
    expect(wide.length).toBeGreaterThan(0);
    for (const l of wide) expect(l.beside?.length).toBe(1);
    // From the inner lane of the wide road, a right turn off it changes to the outer lane first.
    const inner = wide.find((l) => l.slot === 0 && l.source)!;
    const right = G.lanes.find((l) => l.kind === "connector" && l.turn === "right" && G.lanes.some((p) => p.next.includes(l.id) && p.street === inner.street && p.slot === 1))!;
    const after = G.lanes[right.next[0]];
    const r = routeLanes(G, [{ lane: inner.id, s: 0.5 }], [{ lane: after.id, s: Math.min(3, after.len) }])!;
    expect(r.lanes.some((l, k) => k > 0 && isChange(G, r.lanes[k - 1], l))).toBe(true);
    const { pts } = lineOf(G, r);
    expect(pts.every((p) => isPaved(g, Math.round(p.x), Math.round(p.y)))).toBe(true);
    // No step in the line: across smoothly, never turning sharply but at the junction.
    let sharp = 0;
    for (let k = 2; k < pts.length; k++) {
      const a = Math.atan2(pts[k - 1].y - pts[k - 2].y, pts[k - 1].x - pts[k - 2].x), b = Math.atan2(pts[k].y - pts[k - 1].y, pts[k].x - pts[k - 1].x);
      if (Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) > 0.6) sharp++;
    }
    expect(sharp).toBe(0);
  });

  test("cyclists: ridden, at the kerb, and the cars wait behind them", () => {
    busy();
    const r = soak(crossroads(1, 1), 150);
    done();
    expect(r.bikes).toBeGreaterThan(3);
    expect(r.behindBike).toBeGreaterThan(0);
    expect(r.overlaps).toBe(0);
    expect(r.gone).toBe(0);
  });

  test("busy on a four-lane road: lanes changed, nobody into anybody", () => {
    busy();
    const r = soak(crossroads(4, 1), 150);
    done();
    expect(r.overlaps).toBe(0);
    expect(r.gone).toBe(0);
    expect(r.changed).toBeGreaterThan(0);
    expect(r.arrived).toBeGreaterThan(60);
  });

  test.each(["traffic", "streets", "singularity", "bigtown"] as FixtureId[])("%s, busy for three minutes: no overlaps, no knots", (id) => {
    busy();
    const n = FIXTURE_SIZE[id] ?? 48;
    const g = createGrid(n, n, 1);
    applyFixture(g, id, 1);
    const r = soak(g, 180);
    done();
    expect(r.overlaps).toBe(0);
    expect(r.gone).toBe(0);
    expect(r.longest).toBeLessThan(30);
    expect(r.arrived).toBeGreaterThan(100);
  });
});

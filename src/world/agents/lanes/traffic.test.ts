/**
 * The traffic on the lanes, run for minutes on busy towns: nobody drives
 * through anybody, nobody is stuck for good, and trips get where they go —
 * through give ways, lights and a roundabout.
 */
import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../../edit/commands";
import { createGrid, fillTerrain, idx, type Grid } from "../../grid";
import { FIXTURE_SIZE, applyFixture, type FixtureId } from "../../debug/fixtures";
import { createNetwork } from "../../roads/network";
import { structureDef } from "../../structures/def";
import { placeCommand } from "../../structures/place";
import { halfLength } from "../cars/fleet";
import { createTown, setTownCaps, stepTown, townCaps, trafficOf, type Mover } from "../town";
import { lightOf } from "./drive";

const pave = (g: Grid, x: number, y: number) => { g.paved[idx(g, x, y)] = 1; };

/** Two roads crossing edge to edge, `kx` and `ky` cells wide, with houses along both. */
function crossroads(kx: number, ky: number, n = 40) {
  const g = createGrid(n, n);
  fillTerrain(g, 1);
  const at = n / 2 - 1;
  for (let x = 0; x < n; x++) for (let j = 0; j < kx; j++) pave(g, x, at + j);
  for (let y = 0; y < n; y++) for (let j = 0; j < ky; j++) pave(g, at + j, y);
  const history = createHistory();
  const kit = structureDef("kit:intern.t0")!;
  for (let k = 3; k < n - 3; k += 3) {
    if (Math.abs(k - at) < 4) continue;
    for (const [x, y] of [[k, at - 1], [k, at + kx], [at - 1, k], [at + ky, k]]) {
      const cmd = placeCommand(g, kit, x, y);
      if (cmd) commit(g, history, cmd);
    }
  }
  return g;
}

/** Whether two vehicles' outlines overlap, a little inside their real size. */
function overlap(a: Mover, b: Mover) {
  const box = (m: Mover) => {
    const c = Math.cos(m.heading), s = Math.sin(m.heading);
    return { x: m.x, y: m.y, ax: [[c, s], [-s, c]], h: [halfLength(m) * 0.92, 0.08 * 0.92] };
  };
  const A = box(a), B = box(b);
  for (const P of [A, B]) for (const [ux, uy] of P.ax) {
    const span = (Q: typeof A) => {
      const c = Q.x * ux + Q.y * uy;
      const r = Q.h[0] * Math.abs(Q.ax[0][0] * ux + Q.ax[0][1] * uy) + Q.h[1] * Math.abs(Q.ax[1][0] * ux + Q.ax[1][1] * uy);
      return [c - r, c + r];
    };
    const [a0, a1] = span(A), [b0, b1] = span(B);
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

/** Run a town `secs` seconds: trips finished, vehicles lost, overlaps, the longest wait. */
function soak(g: Grid, secs: number) {
  const net = createNetwork(g);
  const t = createTown();
  let arrived = 0, gone = 0, overlaps = 0, longest = 0, peak = 0;
  const dt = 1 / 20;
  for (let k = 0; k < secs / dt; k++) {
    const before = new Map(t.movers.map((m) => [m.id, m]));
    stepTown(t, g, net, 0, dt);
    const after = new Set(t.movers.map((m) => m.id));
    for (const [id, m] of before) if (!after.has(id)) { if (m.gone) { gone++; if (process.env.DBG) console.log("GONE", k * dt, id, m.x.toFixed(2), m.y.toFixed(2), m.stuck.toFixed(1), m.drive?.lanes.join(">"), m.drive?.k, m.drive?.let, (m.at[m.at.length - 1] - m.s).toFixed(2)); } else arrived++; }
    const cars = t.movers.filter((m) => m.kind !== "person");
    peak = Math.max(peak, cars.length);
    for (const m of cars) longest = Math.max(longest, m.stuck);
    const on = (m: Mover) => m.x >= 0 && m.y >= 0 && m.x <= g.w - 1 && m.y <= g.h - 1;
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.6 && on(a) && on(b) && overlap(a, b)) {
        overlaps++;
        if (process.env.DBG) {
          const G = trafficOf(t, g).G, la = G.lanes[a.drive!.lanes[a.drive!.k]], lb = G.lanes[b.drive!.lanes[b.drive!.k]];
          console.log("OVER", k * dt, a.id, la.id, la.kind, la.turn, (a.s - a.drive!.start[a.drive!.k]).toFixed(2), a.speed.toFixed(2), (a.heading * 57.3).toFixed(0), "|", b.id, lb.id, lb.kind, lb.turn, (b.s - b.drive!.start[b.drive!.k]).toFixed(2), b.speed.toFixed(2), (b.heading * 57.3).toFixed(0), "d", Math.hypot(a.x - b.x, a.y - b.y).toFixed(2), a.drive!.lanes.join(">"), "/", b.drive!.lanes.join(">"));
        }
      }
    }
  }
  return { t, arrived, gone, overlaps, longest, peak };
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

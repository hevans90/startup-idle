import { describe, expect, test } from "bun:test";

import { FLOW_DEFAULTS, createColumnField } from "../../fluid/columns";
import { portCallFee } from "../../game/build-cost";
import { commit, createHistory } from "../edit/commands";
import { createGrid, edited, idx, setInflow, type Grid } from "../grid";
import { SEAPORTS } from "../structures/def";
import { placeCommand, quayBanks } from "../structures/place";
import { SHIP_CLASSES } from "./classes";
import { createFleet, stepFleet } from "./fleet";
import { dredgeCells } from "./quay";
import { mapRiver, poolDepthOf } from "./river";
import { PATIENCE, berthsFor, createTraffic, portsOf, stepTraffic, trafficSteer } from "./traffic";

/** A river across a flat map, rows 6 to 10, `depth` deep, in over the west edge. */
function river(depth: number, w = 40): Grid {
  const g = createGrid(w, 18, 1);
  for (let y = 6; y <= 10; y++) for (let x = 0; x < w; x++) { g.pool[idx(g, x, y)] = depth; g.height[idx(g, x, y)] = -depth - 1; setInflow(g, 0, y, depth); }
  return g;
}
const fieldOf = (g: Grid) => {
  const c = createColumnField(g.w * 4, g.h * 4, { ...FLOW_DEFAULTS, wind: 0 }, 0.25);
  for (let cy = 0; cy < c.ny; cy++) for (let cx = 0; cx < c.nx; cx++) { c.depth[cy * c.nx + cx] = g.pool[idx(g, cx >> 2, cy >> 2)]; c.ground[cy * c.nx + cx] = g.height[idx(g, cx >> 2, cy >> 2)]; }
  return c;
};
const port = (g: Grid, tier: number, x = 14) => {
  commit(g, createHistory(), placeCommand(g, SEAPORTS[tier - 1], x, 4)!);
  return [...g.structures.values()].at(-1)!;
};
const rivers = (g: Grid) => mapRiver(g, poolDepthOf(g));

describe("a river's channels", () => {
  test("a deeper river takes bigger ships", () => {
    expect(rivers(river(2)).reach[idx(river(2), 10, 8)]).toBe(1);
    expect(rivers(river(4)).reach[idx(river(4), 10, 8)]).toBe(2);
    expect(rivers(river(6)).reach[idx(river(6), 10, 8)]).toBe(3);
  });

  test("a shoal across it stops them all the way up, and a bridge stops ships", () => {
    const g = river(6);
    for (let y = 6; y <= 10; y++) g.pool[idx(g, 20, y)] = 2;
    const r = rivers(g);
    // No ship gets in past it, and none could get out from before it: the channel is both ways.
    expect([r.reach[idx(g, 10, 8)], r.reach[idx(g, 30, 8)]]).toEqual([1, 1]);
    const b = river(6);
    for (let y = 6; y <= 10; y++) b.deck[idx(b, 20, y)] = 1;
    expect(rivers(b).reach[idx(b, 10, 8)]).toBe(2);
  });
});

describe("what a port takes", () => {
  test("no bigger than its size, and no bigger than its water", () => {
    const takes = (depth: number, tier: number) => {
      const g = river(depth);
      const s = port(g, tier);
      return portsOf(g, rivers(g)).get(s.id)!.takes;
    };
    expect([takes(6, 1), takes(6, 2), takes(6, 3)]).toEqual([0, 1, 2]);
    expect([takes(4, 3), takes(2, 3)]).toEqual([1, 0]);
  });

  test("a ship lies across two berths side by side", () => {
    const g = river(6);
    const s = port(g, 3);
    const p = portsOf(g, rivers(g)).get(s.id)!;
    expect(berthsFor(p, 0)).toEqual([0, 1, 2]);
    expect(berthsFor(p, 2)).toEqual([0, 1]);
  });

  test("a bigger ship pays for the berth-time it takes, and a little over", () => {
    const fee = (cls: number) => portCallFee("seaport-3", 100, cls)!;
    expect(fee(0)).toBe(100);
    for (const c of SHIP_CLASSES) expect(fee(SHIP_CLASSES.indexOf(c)) / (fee(0) * c.dock * c.span)).toBeGreaterThanOrEqual(1);
    expect(fee(2) / (fee(0) * 6)).toBeCloseTo(1.25, 2);
  });

  test("the banks are lit by the biggest ship that can come alongside", () => {
    const deep = river(6), shallow = river(2);
    expect(new Set(quayBanks(deep, SEAPORTS[2]).map((b) => b.cls))).toEqual(new Set([2]));
    expect(new Set(quayBanks(deep, SEAPORTS[0]).map((b) => b.cls))).toEqual(new Set([0]));
    expect(new Set(quayBanks(shallow, SEAPORTS[2]).map((b) => b.cls))).toEqual(new Set([0]));
  });
});

describe("the traffic, by size", () => {
  const run = (g: Grid, seconds: number, each?: (t: ReturnType<typeof createTraffic>, f: ReturnType<typeof createFleet>) => void) => {
    const c = fieldOf(g), f = createFleet(), t = createTraffic();
    for (let k = 0; k < seconds * 30; k++) {
      stepTraffic(t, f, g, c, 1 / 30);
      stepFleet(f, c, 1 / 30, trafficSteer(t));
      each?.(t, f);
    }
    return { t, f };
  };

  test("a deep river with a big port is sent coasters and ships, and they call and are paid for", () => {
    const g = river(6);
    port(g, 3);
    const seen = new Set<number>(), called = new Set<number>();
    run(g, 240, (t, f) => {
      for (const b of f.boats) seen.add(b.cls ?? 0);
      for (const c of t.calls.splice(0)) called.add(c.cls);
    });
    expect(seen).toEqual(new Set([0, 1, 2]));
    expect(called).toEqual(new Set([0, 1, 2]));
  });

  test("a coaster is refused a shallow river, and comes once it is dredged", () => {
    const g = river(2);
    port(g, 2);
    const before = new Set<number>();
    run(g, 60, (_t, f) => { for (const b of f.boats) before.add(b.cls ?? 0); });
    expect(before).toEqual(new Set([0]));
    // Dredged twice, the whole river: two half steps deeper.
    for (let pass = 0; pass < 2; pass++) {
      const all = dredgeCells(g, Array.from({ length: g.w * g.h }, (_, i) => ({ x: i % g.w, y: (i / g.w) | 0 })));
      for (const c of all) { g.height[idx(g, c.x, c.y)]--; g.pool[idx(g, c.x, c.y)]++; }
    }
    edited(g);
    const after = new Set<number>();
    run(g, 60, (_t, f) => { for (const b of f.boats) after.add(b.cls ?? 0); });
    expect(after.has(1)).toBe(true);
  });

  test("dredging is of river bed only", () => {
    const g = river(2);
    port(g, 1);
    const cells = dredgeCells(g, [{ x: 3, y: 2 }, { x: 14, y: 4 }, { x: 3, y: 8 }]);
    expect(cells).toEqual([{ x: 3, y: 8 }]);
  });

  test("a ship with no berth waits in a line off the port, and goes in the end, unpaid", () => {
    const g = river(2);
    const s = port(g, 1);
    const c = fieldOf(g), f = createFleet(), t = createTraffic();
    let turned = 0, waitedAtAnchor = false;
    // A port whose one berth is never given up: held by a boat with a long call.
    for (let k = 0; k < (PATIENCE + 90) * 30; k++) {
      stepTraffic(t, f, g, c, 1 / 30);
      const alongside = f.boats.find((b) => (b.dockLeft ?? 0) > 0);
      if (alongside) alongside.dockLeft = 999;
      stepFleet(f, c, 1 / 30, trafficSteer(t));
      const p = t.ports.get(s.id)!;
      for (const b of f.boats) if ((b.waited ?? 0) > 5 && p.anchorage.some((a) => Math.hypot(a.x - b.x, a.y - b.y) < 0.5)) waitedAtAnchor = true;
      turned += t.turned.splice(0).length;
      t.calls.length = 0;
    }
    expect(waitedAtAnchor).toBe(true);
    expect(turned).toBeGreaterThan(0);
  });
});

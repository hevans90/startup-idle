import { describe, expect, test } from "bun:test";

import { FLOW_DEFAULTS, createColumnField } from "../../fluid/columns";
import { portCallFee } from "../../game/build-cost";
import { commit, createHistory } from "../edit/commands";
import { createGrid, edited, idx, setInflow, type Grid } from "../grid";
import { SEAPORTS } from "../structures/def";
import { placeCommand, quayBanks } from "../structures/place";
import { SHIP_CLASSES } from "./classes";
import { createFleet, saveFleet, stepFleet } from "./fleet";
import { dredgeCells } from "./quay";
import { mapRiver, poolDepthOf } from "./river";
import { LOW_HOLD, PATIENCE, SWING_SECONDS, berthsFor, createTraffic, portsOf, stepTraffic, swingOf, trafficSteer } from "./traffic";
import { lookOf } from "./cargo";

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
    // A ship is turned at either end of her call besides: sixteen boats' fees. @see simulation/port-balance.test.ts
    expect(fee(2) / fee(0)).toBe(16);
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

describe("which port a boat is sent to", () => {
  /** Every boat sent to each port, and the most at each at once — alongside, or waiting off it — that are no ship. */
  const calls = (g: Grid, seconds: number) => {
    const c = fieldOf(g), f = createFleet(), t = createTraffic();
    const got = new Map<number, Set<number>>(), most = new Map<number, number>();
    for (let k = 0; k < seconds * 30; k++) {
      stepTraffic(t, f, g, c, 1 / 30);
      stepFleet(f, c, 1 / 30, trafficSteer(t));
      const small = new Map<number, number>();
      for (const b of f.boats) {
        const to = b.route?.[0];
        if (to === undefined) continue;
        got.set(to, (got.get(to) ?? new Set()).add(b.id));
        // Not those still coming up the river: a port far up it has berths clear by the time they are there. @see onTheWay
        if ((b.cls ?? 0) < 2 && (b.berth !== undefined || (b.waited ?? 0) > 0)) small.set(to, (small.get(to) ?? 0) + 1);
      }
      for (const [to, n] of small) most.set(to, Math.max(most.get(to) ?? 0, n));
      t.calls.length = 0;
    }
    return { got, most };
  };

  test("two ports alike take turns: the first built does not take the lion's share", () => {
    const g = river(6, 56);
    const a = port(g, 2, 12), b = port(g, 2, 34);
    const { got } = calls(g, 180);
    const na = got.get(a.id)?.size ?? 0, nb = got.get(b.id)?.size ?? 0;
    expect(na + nb).toBeGreaterThan(6);
    // Not boat for boat — the nearer is free sooner — but a fair share each.
    expect(Math.min(na, nb) / (na + nb)).toBeGreaterThan(0.38);
  });

  test("by the berths a boat can lie at: a big port's gantries are no room for it", () => {
    const g = river(6, 56);
    const small = port(g, 1, 12), big = port(g, 3, 34);
    big.fit = ["gantry", "gantry", "crane"];
    const { got, most } = calls(g, 180);
    // One at its crane, one to wait, and at the worst the two sent ahead up
    // the river come in together — never a queue for the gantries, which
    // counted as room would have ten bound for it.
    expect(most.get(big.id) ?? 0).toBeLessThanOrEqual(4);
    expect(got.get(small.id)?.size ?? 0).toBeGreaterThan(1);
  });
});

describe("moments on the river", () => {
  const run = (g: Grid, seconds: number, t = createTraffic(), each?: (f: ReturnType<typeof createFleet>) => void) => {
    const c = fieldOf(g), f = createFleet();
    for (let k = 0; k < seconds * 30; k++) {
      stepTraffic(t, f, g, c, 1 / 30);
      stepFleet(f, c, 1 / 30, trafficSteer(t));
      each?.(f);
    }
    return { t, f };
  };

  test("a convoy is the biggest ships the port takes, one after another, in its livery", () => {
    const g = river(6);
    port(g, 3);
    const t = createTraffic();
    t.convoy = true;
    const seen = new Set<string>();
    // The port's own tug is not of the convoy.
    run(g, 60, t, (f) => { for (const b of f.boats) if (b.tug === undefined) seen.add(`${b.cls ?? 0}|${!!b.convoy}`); });
    expect(seen).toEqual(new Set(["2|true"]));
  });

  test("the first of each bigger class to call at a port is greeted, once, and the port remembers", () => {
    const g = river(6);
    const s = port(g, 3);
    const t = createTraffic();
    const firsts: number[] = [];
    const c = fieldOf(g), f = createFleet();
    for (let k = 0; k < 300 * 30; k++) {
      stepTraffic(t, f, g, c, 1 / 30);
      stepFleet(f, c, 1 / 30, trafficSteer(t));
      firsts.push(...t.firsts.splice(0).map((x) => x.cls));
    }
    expect(firsts).toEqual([1, 2]);
    expect(g.structures.get(s.id)!.biggest).toBe(2);
  });

  test("a river that falls too low for a port's ships is noticed", () => {
    const g = river(6);
    const s = port(g, 3);
    const { t } = run(g, 3);
    expect(t.lows).toEqual([]);
    for (let y = 6; y <= 10; y++) for (let x = 0; x < g.w; x++) g.pool[idx(g, x, y)] = 2;
    // Not at once: a dip that passes is not said. @see LOW_HOLD
    run(g, 3, t);
    expect(t.lows).toEqual([]);
    run(g, LOW_HOLD, t);
    expect(t.lows).toEqual([s.id]);
  });

  test("a river dipping under a ship's depth and back is not noticed", () => {
    const g = river(6);
    port(g, 3);
    const { t } = run(g, 3);
    const set = (d: number) => { for (let y = 6; y <= 10; y++) for (let x = 0; x < g.w; x++) g.pool[idx(g, x, y)] = d; };
    for (let k = 0; k < 6; k++) { set(2); run(g, LOW_HOLD / 4, t); set(6); run(g, 2, t); }
    expect(t.lows).toEqual([]);
  });
});

describe("a port's tug, and a ship turned", () => {
  const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

  test("a call with a swing at each end of it: the work between, and the ship round and back", () => {
    const b = { dockFor: 30, dockLeft: 30 + 2 * 9, swing: { lie: 0, secs: 9, at: { x: 0, y: 0 }, out: { x: 0, y: 1 } } };
    expect(swingOf(b)).toEqual({ work: 0, turn: 0 });
    expect(swingOf({ ...b, dockLeft: 30 + 9 })).toEqual({ work: 0, turn: 1 });
    expect(swingOf({ ...b, dockLeft: 15 + 9 })).toEqual({ work: 0.5, turn: 1 });
    expect(swingOf({ ...b, dockLeft: 9 })).toEqual({ work: 1, turn: 1 });
    expect(swingOf({ ...b, dockLeft: 4.5 }).turn).toBeCloseTo(1.5, 6);
    expect(swingOf({ ...b, dockLeft: 0.001 }).turn).toBeCloseTo(2, 3);
    // A boat nobody turns is worked from the moment she ties up to the moment she goes.
    expect(swingOf({ dockFor: 20, dockLeft: 5 })).toEqual({ work: 0.75, turn: 1 });
  });

  test("a port that takes ships keeps a tug off the end of its quay; one that takes none has none; it is not saved", () => {
    const deep = river(6), shallow = river(4);
    port(deep, 3); port(shallow, 3);
    const run = (g: Grid) => {
      const c = fieldOf(g), f = createFleet(), t = createTraffic();
      for (let k = 0; k < 60; k++) { stepTraffic(t, f, g, c, 1 / 30); stepFleet(f, c, 1 / 30, trafficSteer(t)); }
      return f;
    };
    const f = run(deep), tugs = f.boats.filter((b) => b.tug !== undefined);
    expect(tugs).toHaveLength(1);
    expect(lookOf(tugs[0].cls ?? 0, tugs[0].fit, false, false)).toBe("tug");
    // On the river, by the port, and going nowhere.
    expect(tugs[0].y).toBeGreaterThan(5.5);
    expect(tugs[0].route).toBeUndefined();
    expect(saveFleet(f).length).toBe(f.boats.length - 1);
    // Water for coasters and no more: nothing to turn, and no tug.
    expect(run(shallow).boats.some((b) => b.tug !== undefined)).toBe(false);
  });

  test("the tug lays itself on a ship's bow and she is swung head to the stream, worked, and swung back to go", () => {
    const g = river(6);
    const s = port(g, 3);
    const c = fieldOf(g), f = createFleet(), t = createTraffic();
    t.convoy = true;   // ships, one after another
    let came: number | null = null, worked: number | null = null, tugNear = Infinity, tugHomeWhileWorked = false, callFor = 0, left: number | null = null;
    let shipId = -1;
    for (let k = 0; k < 30 * 240 && left === null; k++) {
      stepTraffic(t, f, g, c, 1 / 30);
      stepFleet(f, c, 1 / 30, trafficSteer(t));
      const tug = f.boats.find((b) => b.tug === s.id)!;
      const ship = shipId < 0 ? f.boats.find((b) => (b.cls ?? 0) === 2 && (b.dockLeft ?? 0) > 0) : f.boats.find((b) => b.id === shipId);
      if (!ship) { if (shipId >= 0) left = 1; continue; }
      if (shipId < 0) { shipId = ship.id; came = ship.swing!.lie; }
      if ((ship.dockLeft ?? 0) > 0) {
        callFor += 1 / 30;
        const at = swingOf(ship);
        if (at.turn > 0.3 && at.turn < 0.7) {
          // Mid-swing: the tug is against her bow, a boat's length or so from her middle.
          const bow = { x: ship.x + Math.cos(ship.heading) * 0.86, y: ship.y + Math.sin(ship.heading) * 0.86 };
          tugNear = Math.min(tugNear, Math.hypot(tug.x - bow.x, tug.y - bow.y));
        }
        if (at.turn === 1 && at.work > 0.4 && at.work < 0.6) {
          worked = ship.heading;
          tugHomeWhileWorked = Math.hypot(tug.x - ship.x, tug.y - ship.y) > 1.5;
        }
      } else if (worked !== null && left === null) {
        // Cast off: she heads the way she came.
        expect(turn(ship.heading, came!)).toBeLessThan(0.5);
        left = 1;
      }
    }
    expect(came).not.toBeNull();
    // Worked lying the other way round from how she came.
    expect(turn(worked!, came! + Math.PI)).toBeLessThan(0.25);
    expect(tugNear).toBeLessThan(0.9);
    expect(tugHomeWhileWorked).toBe(true);
    // Her call was the longer by two swings.
    expect(left).toBe(1);
    expect(callFor).toBeGreaterThan(2 * SWING_SECONDS + 5);
  }, 60_000);
});


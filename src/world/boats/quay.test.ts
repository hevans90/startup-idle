import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { createGrid, idx, setInflow, stampFootprint, type Grid, type Structure } from "../grid";
import { SEAPORTS, structureDef } from "../structures/def";
import { placeCommand, planUpgrade, quayBanks, upgradeCommand, validatePlacement } from "../structures/place";
import { berthsAlong, channelTo, facePorts, steadyRivers } from "./quay";
import { mapRiver, poolDepthOf } from "./river";
import { portsOf } from "./traffic";

const [T1, T2, T3] = SEAPORTS;

/** A river down the map along y: columns `x0..x1`, in over the north edge. Land at `land`, the bed at nought. */
function alongY(x0 = 6, x1 = 9, land = 0): Grid {
  const g = createGrid(16, 24, 1);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) g.height[idx(g, x, y)] = x >= x0 && x <= x1 ? -4 : land;
  for (let x = x0; x <= x1; x++) { for (let y = 0; y < g.h; y++) g.pool[idx(g, x, y)] = 3; setInflow(g, x, 0, 3); }
  return g;
}
const place = (g: Grid, def = T1, x: number, y: number, rules = {}) => {
  const cmd = placeCommand(g, def, x, y, rules);
  if (!cmd) return null;
  commit(g, createHistory(), cmd);
  return [...g.structures.values()].at(-1)!;
};

describe("placing a seaport", () => {
  test("it turns to face the water: a tier 3 on a bank along y has its three berths", () => {
    const g = alongY();
    // West bank: the quay is its +x side. East bank: its -x side.
    const west = place(g, T3, 4, 8)!, east = place(g, T3, 10, 8)!;
    expect([west.w, west.h, west.facing]).toEqual([2, 4, "S"]);
    expect([east.w, east.h, east.facing]).toEqual([2, 4, "N"]);
    const r = steadyRivers(g);
    expect(berthsAlong(r, west, west.facing!, 3).map((b) => [b.tx, b.ty])).toEqual([[6, 8], [6, 10], [6, 11]]);
    expect(portsOf(g, mapRiver(g, poolDepthOf(g))).get(east.id)!.berths).toHaveLength(3);
  });

  test("every tile of quay is on the water, and the ones that are not say so", () => {
    const g = alongY();
    // A bay one tile wide into the west bank: a port under it touches the river at that tile alone.
    g.pool[idx(g, 5, 12)] = 3; g.height[idx(g, 5, 12)] = -4;
    const check = validatePlacement(g, T3, 2, 13);
    expect(check.ok).toBe(false);
    expect(check.reasons).toEqual(["quay off the water"]);
    // The one tile of its quay that has water is not among the cells at fault.
    expect(check.cells.filter((c) => !c.ok).length).toBe(3);
  });

  test("it is built at the water: cut down to a half step over it, and refused on a cliff", () => {
    const low = alongY(6, 9, 1);
    const s = place(low, T1, 4, 8)!;
    // The water stands at -1; the quay is at nought.
    expect([low.height[idx(low, 4, 8)], low.height[idx(low, 5, 9)]]).toEqual([0, 0]);
    expect(s.facing).toBe("S");
    const cliff = alongY(6, 9, 6);
    expect(validatePlacement(cliff, T1, 4, 8).reasons).toEqual(["too high above the water"]);
  });

  test("the bank is the standing water's: the rivers of the moment change nothing", () => {
    const g = alongY();
    const dry = mapRiver(g, () => 0);
    expect(validatePlacement(g, T2, 4, 8, { rivers: dry }).ok).toBe(true);
    expect(validatePlacement(g, T2, 1, 8, { rivers: mapRiver(g, () => 9) }).ok).toBe(false);
  });

  test("the gate is landward: the road it needs is behind it", () => {
    const g = alongY();
    // A road past its north end is not at its gate.
    for (let x = 0; x < 6; x++) g.paved[idx(g, x, 7)] = 1;
    expect(validatePlacement(g, T2, 4, 8, { needsRoad: true }).reasons).toEqual(["no road at the gate"]);
    g.paved[idx(g, 3, 9)] = 1;
    expect(validatePlacement(g, T2, 4, 8, { needsRoad: true }).ok).toBe(true);
  });

  test("every reason comes at once", () => {
    const g = alongY(6, 9, 6);
    g.pool[idx(g, 6, 11)] = 0; g.height[idx(g, 6, 11)] = 6;
    expect(validatePlacement(g, T3, 4, 8, { needsRoad: true }).reasons).toEqual(["quay off the water", "too high above the water", "no road at the gate"]);
  });

  test("the banks it could go on are both sides of the river, and nowhere inland", () => {
    const g = alongY();
    const lit = new Set(quayBanks(g, T2));
    expect(lit.has(idx(g, 5, 10))).toBe(true);
    expect(lit.has(idx(g, 10, 10))).toBe(true);
    expect([...lit].every((i) => i % g.w === 5 || i % g.w === 10)).toBe(true);
  });

  test("the way in runs from where the river comes in to the berth", () => {
    const g = alongY();
    const way = channelTo(steadyRivers(g), { x: 6, y: 9 });
    expect(way[0].y).toBe(0);
    expect(way.at(-1)).toEqual({ x: 6, y: 9 });
    expect(way).toHaveLength(10);
  });
});

describe("growing a seaport", () => {
  test("it grows along its quay, and keeps its side to the water", () => {
    const g = alongY();
    const s = place(g, T1, 4, 8)!;
    const plan = planUpgrade(g, s.id)!;
    expect(plan.ok).toBe(true);
    expect([plan.at, plan.facing]).toEqual([{ x: 4, y: 8, w: 2, h: 3 }, "S"]);
    commit(g, createHistory(), upgradeCommand(g, s.id)!);
    const grown = g.structures.get(s.id)!;
    expect([grown.def, grown.w, grown.h, grown.facing]).toEqual(["seaport-2", 2, 3, "S"]);
    expect(berthsAlong(steadyRivers(g), grown, "S", 2)).toHaveLength(2);
  });

  test("blocked at one end, it grows at the other", () => {
    const g = alongY();
    const s = place(g, T1, 4, 8)!;
    g.paved[idx(g, 5, 10)] = 1;
    const plan = planUpgrade(g, s.id)!;
    expect([plan.ok, plan.at.y]).toEqual([true, 7]);
  });
});

describe("a seaport from before ports faced the water", () => {
  /** One stamped as the old rule left it: long along x, whatever the bank. */
  const old = (g: Grid, def: string, x: number, y: number): Structure => {
    const d = structureDef(def)!;
    const s: Structure = { id: g.nextStructureId++, def, x, y, w: d.footprint.w, h: d.footprint.h };
    g.structures.set(s.id, s);
    stampFootprint(g, s);
    return s;
  };

  test("is given the side its water is on, and works with the berths that side has", () => {
    const g = alongY();
    // End on to the river: two tiles of it on the water.
    const s = old(g, "seaport-3", 2, 8);
    facePorts(g, (p) => !!structureDef(p.def)?.port);
    expect(s.facing).toBe("S");
    expect(portsOf(g, mapRiver(g, poolDepthOf(g))).get(s.id)!.berths).toHaveLength(2);
  });

  test("and end on to the river, has no quay to lengthen", () => {
    const g = alongY();
    const s = old(g, "seaport-2", 3, 8);
    facePorts(g, (p) => !!structureDef(p.def)?.port);
    const plan = planUpgrade(g, s.id)!;
    expect([plan.ok, plan.reason]).toEqual([false, "quay off the water"]);
    expect(upgradeCommand(g, s.id)).toBeNull();
  });
});

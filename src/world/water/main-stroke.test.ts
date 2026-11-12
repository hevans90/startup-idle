/**
 * THE PIPE TOOL'S PROMISES (plans/pipe-network.md, phase 13): what the card
 * says a water main will cost and bring is what the stroke then charges and
 * the main then delivers — its pump included, where it needs one — whether it
 * is dragged or laid by clicks through pinned corners.
 */
import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { buildCost, pipeCost } from "../../game/build-cost";
import { PUMP_HEAD, demandOf } from "../../game/cooling";
import { useMoneyStore } from "../../state/money.store";
import { mainWet, useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../edit/commands";
import type { Stroke } from "../edit/tools";
import { MAIN_END, createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { connectPoints, pipeClick, snapToConnect } from "../pipes/connect-points";
import { pipeGraph } from "../pipes/graph";
import { strokeRoute } from "../pipes/stroke-route";
import { resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { setWaterEdge, stepWater } from "./field";
import { mainStroke } from "./main-stroke";
import { mainProfile, mainReportAt, runMains } from "./mains";

const s = () => useWorldStore.getState();
afterEach(() => { s().setPlaying(false); useMoneyStore.setState({ money: new Decimal(0) }); resetCooling(); });

const AGENTS = 30;
/** A lake `rise` over the ground (or under it), its bank at x = 4 raised to hold it, and a Data Centre 20 tiles on with 30 agents to cool; played, the Pipe tool in hand. */
function yard(rise = 5): { g: Grid; dc: number; inlet: { x: number; y: number } } {
  const g = createGrid(34, 14);
  fillTerrain(g, 1);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, x <= 3 ? rise - 6 : x === 4 ? Math.max(rise, 0) + 2 : 0);
  for (let y = 0; y < g.h; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 6;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 22, 2)!);
  s().loadGrid(g);
  s().setPlaying(true);
  s().setTool("pipe");
  const live = s().grid, dc = [...live.structures.values()].find((b) => b.def === "datacentre")!.id;
  setWaterEdge(s().getWaterField()!, false);
  stepCooling(live, 0, false, 0);
  // Thirty agents to cool, as its racks would give it.
  Object.assign(tankFor(dc)!, { agents: AGENTS, demand: demandOf("datacentre", AGENTS, false) });
  useMoneyStore.setState({ money: new Decimal(1e6) });
  return { g: live, dc, inlet: { x: 23, y: 5 } };
}
const stroke = (o: Partial<Stroke> & Pick<Stroke, "anchor" | "head">): Stroke => ({ tool: "pipe", brush: "line", ...o });
/** Lay the stroke; what it cost. */
function lay(st: Stroke): number {
  const before = useMoneyStore.getState().money.toNumber();
  useWorldStore.setState({ stroke: st });
  s().endStroke();
  return before - useMoneyStore.getState().money.toNumber();
}
/** Water a second into the Data Centre over the last half of `seconds`, its tank kept empty. */
function delivered(dc: number, seconds = 8): number {
  const f = s().getWaterField()!, g = s().grid, t = tankFor(dc)!;
  let got = 0;
  for (let n = 0; n < seconds * 60; n++) {
    // A tank as big as it gets, emptied every frame: what arrives is all the main can carry.
    t.capacity = 1e9; t.level = 0;
    runMains(f, g, 1 / 60);
    stepWater(f, 1 / 60);
    if (n >= seconds * 30) got += t.level;
  }
  return got / (seconds / 2);
}

describe("what the card says is what happens", () => {
  test("a main by gravity: its price charged, its flow delivered, its bar the share of the building's thirst", () => {
    const { g, dc, inlet } = yard();
    const st = stroke({ anchor: { x: 4, y: 5 }, head: inlet });
    const m = mainStroke(g, s().getWaterField(), st, mainWet(g));
    expect(m.refused).toBeNull();
    expect(m.complete).toBe(true);
    expect(m.pump).toBe(false);
    expect(m.price).toEqual({ pipe: pipeCost(m.fresh).toNumber(), pump: 0, total: pipeCost(m.fresh).toNumber() });
    // Twenty-one agents' worth for thirty: a bar part full, and it says so.
    expect(m.need).toMatchObject({ building: dc, agents: AGENTS });
    expect(m.need!.cooled).toBeLessThan(AGENTS);
    expect(m.need!.share).toBeCloseTo(m.look!.flow / tankFor(dc)!.demand, 6);
    expect(lay(st)).toBeCloseTo(m.price.total, 6);
    expect(Math.abs(delivered(dc) / m.look!.flow - 1)).toBeLessThan(0.05);
  });

  test("water too low: laid with a pump, priced in before the click — and nothing offered after", () => {
    const { g, dc, inlet } = yard(-(PUMP_HEAD / 2));
    const st = stroke({ anchor: { x: 4, y: 5 }, head: inlet });
    const m = mainStroke(g, s().getWaterField(), st, mainWet(g));
    expect(m.pump).toBe(true);
    expect(m.wantsPump).toBe(true);
    expect(m.complete).toBe(true);
    expect(m.price.pump).toBe(buildCost("pump")!.toNumber());
    expect(m.price.total).toBe(m.price.pipe + m.price.pump);
    expect(lay(st)).toBeCloseTo(m.price.total, 6);
    expect(s().grid.mainEnd[idx(s().grid, 4, 5)]).toBe(MAIN_END.pump);
    expect(s().pumpOffer).toBeNull();
    expect(Math.abs(delivered(dc) / m.look!.flow - 1)).toBeLessThan(0.05);
  });

  test("the player may lay it without: no pump charged, and the card has already said it will not flow", () => {
    const { g, inlet } = yard(-(PUMP_HEAD / 2));
    const st = stroke({ anchor: { x: 4, y: 5 }, head: inlet, noPump: true });
    const m = mainStroke(g, s().getWaterField(), st, mainWet(g));
    expect([m.pump, m.wantsPump, m.complete]).toEqual([false, true, false]);
    expect(m.look!.problem).toMatch(/needs a pump/);
    expect(lay(st)).toBeCloseTo(m.price.pipe, 6);
    expect(s().grid.mainEnd[idx(s().grid, 4, 5)]).toBe(MAIN_END.intake);
  });
});

describe("a pipe laid by clicks", () => {
  test("runs through each corner pinned, in order, and never across itself", () => {
    const { g, inlet } = yard();
    const pins = [{ x: 4, y: 5 }, { x: 10, y: 10 }, { x: 16, y: 8 }];
    const route = strokeRoute(g, stroke({ anchor: pins[0], head: inlet, pins }), mainWet(g))!;
    const at = (c: { x: number; y: number }) => route.findIndex((r) => r.x === c.x && r.y === c.y);
    expect(at(pins[0])).toBe(0);
    expect(at(pins[1])).toBeGreaterThan(0);
    expect(at(pins[2])).toBeGreaterThan(at(pins[1]));
    expect(route.at(-1)).toEqual(inlet);
    expect(new Set(route.map((c) => idx(g, c.x, c.y))).size).toBe(route.length);
    // Longer than the straight drag, and priced as what it is.
    const straight = mainStroke(g, s().getWaterField(), stroke({ anchor: pins[0], head: inlet }), mainWet(g));
    const pinned = mainStroke(g, s().getWaterField(), stroke({ anchor: pins[0], head: inlet, pins }), mainWet(g));
    expect(pinned.fresh).toBe(route.length);
    expect(pinned.fresh).toBeGreaterThan(straight.fresh);
    expect(lay(stroke({ anchor: pins[0], head: inlet, pins }))).toBeCloseTo(pinned.price.total, 6);
    for (const p of pins) expect(s().grid.main[idx(s().grid, p.x, p.y)]).not.toBe(0);
  });

  test("the store pins a corner where the pointer is, takes the last back, and drops the stroke with the first", () => {
    yard();
    s().beginStroke({ x: 4, y: 5 });
    s().startPins();
    expect(s().stroke!.pins).toEqual([{ x: 4, y: 5 }]);
    s().updateStroke({ x: 10, y: 10 });
    s().pinStroke();
    s().pinStroke();                                   // the same corner twice is once
    expect(s().stroke!.pins).toHaveLength(2);
    s().unpinStroke();
    expect(s().stroke!.pins).toEqual([{ x: 4, y: 5 }]);
    s().toggleStrokePump();
    expect(s().stroke!.noPump).toBe(true);
    s().unpinStroke();
    expect(s().stroke).toBeNull();
  });
});

describe("where a pipe can connect", () => {
  test("a water main: the bank, the building's inlets; begun at the water, only the inlets stay", () => {
    const { g, dc, inlet } = yard();
    const wet = mainWet(g);
    const all = connectPoints(g, "main", wet);
    expect(all.some((p) => p.kind === "water" && p.cell === idx(g, 4, 5))).toBe(true);
    expect(all.filter((p) => p.kind === "inlet").map((p) => p.building)).toEqual([dc, dc]);
    expect(all.some((p) => p.cell === idx(g, inlet.x, inlet.y))).toBe(true);
    const fromWater = connectPoints(g, "main", wet, { x: 4, y: 5 });
    expect(new Set(fromWater.map((p) => p.kind))).toEqual(new Set(["inlet"]));
    const fromInlet = connectPoints(g, "main", wet, inlet);
    expect(new Set(fromInlet.map((p) => p.kind))).toEqual(new Set(["water"]));
  });

  test("an end within a tile of an inlet goes to it; further off, it stays where it is", () => {
    const { g, inlet } = yard();
    const points = connectPoints(g, "main", mainWet(g), { x: 4, y: 5 });
    expect(snapToConnect(g, { x: inlet.x - 1, y: inlet.y + 1 }, points)).toEqual(inlet);
    expect(snapToConnect(g, { x: inlet.x - 3, y: inlet.y + 2 }, points)).toEqual({ x: inlet.x - 3, y: inlet.y + 2 });
    // So a drag let go beside the inlet is laid into it.
    const m = mainStroke(g, s().getWaterField(), stroke({ anchor: { x: 4, y: 5 }, head: { x: inlet.x - 1, y: inlet.y + 1 } }), mainWet(g));
    expect(m.route!.at(-1)).toEqual(inlet);
    expect(m.complete).toBe(true);
  });

  test("a laid main's open end is a place to carry on from", () => {
    const { g } = yard();
    lay(stroke({ anchor: { x: 4, y: 9 }, head: { x: 12, y: 9 } }));
    const live = s().grid;
    expect(connectPoints(live, "main", mainWet(live)).some((p) => p.kind === "main-end" && p.cell === idx(live, 12, 9))).toBe(true);
    void g;
  });
});

describe("one tool does everything its pipes need", () => {
  test("a main carried on from its open end loses its cap there; one begun on its middle branches off it", () => {
    yard();
    lay(stroke({ anchor: { x: 6, y: 9 }, head: { x: 12, y: 9 } }));
    let g = s().grid;
    expect(g.mainEnd[idx(g, 12, 9)]).toBe(MAIN_END.cap);
    // On from the end: one run, its cap at the new end.
    lay(stroke({ anchor: { x: 12, y: 9 }, head: { x: 16, y: 9 } }));
    g = s().grid;
    expect(g.mainEnd[idx(g, 12, 9)]).toBe(0);
    expect(g.mainEnd[idx(g, 16, 9)]).toBe(MAIN_END.cap);
    // Off the middle: a tee, and still one network.
    lay(stroke({ anchor: { x: 9, y: 9 }, head: { x: 9, y: 12 } }));
    g = s().grid;
    const graph = pipeGraph(g);
    expect(graph.nodes[graph.nodeAt.main[idx(g, 9, 9)]].links).toHaveLength(3);
    expect(graph.mains.filter((n) => !n.sewer)).toHaveLength(1);
  });

  test("a click on a main's middle selects it; on its open end, or on open ground, it starts a run", () => {
    yard();
    lay(stroke({ anchor: { x: 6, y: 9 }, head: { x: 12, y: 9 } }));
    const g = s().grid;
    expect(pipeClick(g, "pipe", { x: 9, y: 9 })).toBe("select");
    expect(pipeClick(g, "pipe", { x: 12, y: 9 })).toBe("start");
    expect(pipeClick(g, "pipe", { x: 9, y: 11 })).toBe("start");
    // The Sewer tool has no business with a water main: a click there starts its own.
    expect(pipeClick(g, "sewer", { x: 9, y: 9 })).toBe("start");
  });
});

describe("the profile: a main from the side", () => {
  test("flowing by gravity: the water's line falls from the lake to the building, above its floor all the way, and nothing is red", () => {
    const { g, inlet } = yard();
    const m = mainStroke(g, s().getWaterField(), stroke({ anchor: { x: 4, y: 5 }, head: inlet }), mainWet(g));
    const p = m.profile!;
    expect(p.kind).toBe("main");
    expect(p.cells).toEqual(m.route!.map((c) => idx(g, c.x, c.y)));
    expect([p.source, p.floor]).toEqual([5, 0]);
    // The line starts at the lake's level and only falls.
    expect(p.head![0]).toBeCloseTo(5, 6);
    for (let k = 1; k < p.head!.length; k++) expect(p.head![k]!).toBeLessThanOrEqual(p.head![k - 1]! + 1e-9);
    expect(p.head!.at(-1)!).toBeGreaterThan(p.floor!);
    expect(p.bad).toEqual([]);
    expect(p.reason).toBeNull();
    // The pipe lies on the ground, over the lake's bank and down.
    expect(p.pipe).toEqual(p.ground);
    expect(p.ground[0]).toBe(7);
  });

  test("water too low, no pump: the line lies under the floor the whole way — red, and the reason the card gives", () => {
    const { g, inlet } = yard(-(PUMP_HEAD / 2));
    const m = mainStroke(g, s().getWaterField(), stroke({ anchor: { x: 4, y: 5 }, head: inlet, noPump: true }), mainWet(g));
    const p = m.profile!;
    expect(m.look!.problem).toMatch(/slabs below the building's floor/);
    expect(p.source).toBe(-PUMP_HEAD / 2);
    expect(p.head!.every((h) => h !== null && h < p.floor!)).toBe(true);
    expect(p.bad).toEqual([[0, p.cells.length - 1]]);
    expect(p.reason).toBe("The water cannot rise to the building's floor");
    expect(p.marks.some((k) => k.kind === "pump")).toBe(false);
  });

  test("with its pump: the line steps up at the intake, clears the floor, and nothing is red", () => {
    const { g, inlet } = yard(-(PUMP_HEAD / 2));
    const m = mainStroke(g, s().getWaterField(), stroke({ anchor: { x: 4, y: 5 }, head: inlet }), mainWet(g));
    const p = m.profile!;
    expect(p.marks).toContainEqual({ at: 0, kind: "pump" });
    expect(p.head![0]).toBeCloseTo(p.source! + PUMP_HEAD, 6);
    expect(p.head!.at(-1)!).toBeGreaterThan(p.floor!);
    expect(p.bad).toEqual([]);
  });

  test("a main laid and looked at says the same as its report: red if it reads `no-head`, not if it flows", () => {
    const { g, dc, inlet } = yard(-(PUMP_HEAD / 2));
    lay(stroke({ anchor: { x: 4, y: 5 }, head: inlet, noPump: true }));
    const f = s().getWaterField()!, live = s().grid;
    runMains(f, live, 1 / 60);
    expect(mainReportAt(live, 12, 5)!.state).toBe("no-head");
    expect(mainProfile(live, f, idx(live, 12, 5))!.bad.length).toBe(1);
    // Given its pump, it flows, and the red is gone.
    live.mainEnd[idx(live, 4, 5)] = MAIN_END.pump;
    live.rev++;
    tankFor(dc)!.level = 0;
    runMains(f, live, 1 / 60);
    expect(mainReportAt(live, 12, 5)!.state).toBe("flowing");
    expect(mainProfile(live, f, idx(live, 12, 5))!.bad).toEqual([]);
    void g;
  });
});

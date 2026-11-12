/**
 * CONNECT IT FOR ME. The plan's guards: each suggestion passes the planner a
 * hand-drawn one does, at the same price, and is laid for that price; none is
 * offered before its kind is opened by one laid by hand and seen to work.
 * @see suggest, plans/pipe-network.md phase 15
 */
import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { pipeCost, buildCost } from "../../game/build-cost";
import { useMoneyStore } from "../../state/money.store";
import { mainWet, useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../edit/commands";
import { MAIN_AI, MAIN_END, MAIN_SEWER, createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { fromJSON, serializeWorld, toJSON } from "../io/serialize";
import { resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { planLateral, planSewer, routeSewer } from "../sewers/lay";
import { stepSlop } from "../slop/tanks";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField, setWaterEdge, stepWater, type WaterField } from "../water/field";
import { mainStroke } from "../water/main-stroke";
import { layMain, planMain, runMains } from "../water/mains";
import { portsOf } from "../water/ports";
import { noteLaidByHand, setSuggestOpen, suggestConnections, suggestMains, suggestOpen, suggestionsAt } from "./suggest";
import { stepPipes } from "./tick";

afterEach(() => { resetCooling(); useWorldStore.getState().setPlaying(false); useMoneyStore.setState({ money: new Decimal(0) }); });

/**
 * Two waters and a Data Centre between them: a lake high on the west, a
 * pond low on the east, the building on the flat in the middle. Gravity
 * from the lake, the long way; a pump from the pond, the short.
 */
function twoWaters(): { g: Grid; f: WaterField; dc: number; inlet: { x: number; y: number } } {
  const g = createGrid(44, 14);
  fillTerrain(g, 1);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 44; x++) setHeight(g, x, y, x <= 3 ? 2 : x === 4 ? 10 : x >= 40 ? -8 : 0);
  for (let y = 0; y < 14; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 6;
  for (let y = 0; y < 14; y++) for (let x = 40; x < 44; x++) g.pool[idx(g, x, y)] = 4;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 28, 3)!);
  const s = [...g.structures.values()].find((b) => b.def === "datacentre")!;
  const p = portsOf(g, s).find((q) => q.port.fluid === "water")!;
  const f = createWaterField(g);
  setWaterEdge(f, false);
  stepCooling(g, 0, false, 0);
  tankFor(s.id)!.capacity = 30;
  return { g, f, dc: s.id, inlet: { x: p.x, y: p.y } };
}

describe("water mains, suggested", () => {
  test("never one answer where there are two: the best of them, and the shortest of the rest beside it", () => {
    const { g, f, inlet } = twoWaters();
    const list = suggestMains(g, f, inlet, mainWet(g));
    expect(list.length).toBe(2);
    // The lake, by gravity, the long way: a pump costs far more than the pipe, so it is the cheapest too.
    const best = list.find((s) => s.why === "cheapest")!, short = list.find((s) => s.why === "shortest")!;
    expect(best.pump).toBe(false);
    expect(best.route[0].x).toBeLessThan(10);
    // The pond is nearer and lower: the short way, with a pump.
    expect(short.pump).toBe(true);
    expect(short.route[0].x).toBeGreaterThan(30);
    expect(short.fresh).toBeLessThan(best.fresh);
    expect(short.price).toBeGreaterThan(best.price);
    expect(best.carries).toBeGreaterThan(short.carries);
    // None offered twice, and each ends at the inlet.
    expect(new Set(list.map((s) => `${s.route[0].x},${s.route[0].y}|${s.pump}`)).size).toBe(list.length);
    for (const s of list) expect(s.route[s.route.length - 1]).toEqual(inlet);
  });

  test("each is what the planner makes of that route by hand, at the same price", () => {
    const { g, f, inlet } = twoWaters();
    for (const s of suggestMains(g, f, inlet, mainWet(g))) {
      // The same working-out a drawn stroke gets.
      const m = mainStroke(g, f, s.stroke, mainWet(g));
      expect(m.refused).toBeNull();
      expect(m.complete).toBe(true);
      expect(m.price.total).toBe(s.price);
      expect(m.pump).toBe(s.pump);
      // And the planner itself, on the bare route.
      const plan = planMain(g, s.route, mainWet(g), s.pump);
      expect("refused" in plan).toBe(false);
      expect(s.price).toBe(pipeCost(s.fresh).toNumber() + (s.pump ? buildCost("pump")!.toNumber() : 0));
      // No special powers: tile to tile, never through a building or the water.
      for (const [k, c] of s.route.entries()) {
        expect(g.structureAt[idx(g, c.x, c.y)]).toBe(-1);
        expect(g.pool[idx(g, c.x, c.y)]).toBe(0);
        if (k) expect(Math.abs(c.x - s.route[k - 1].x) + Math.abs(c.y - s.route[k - 1].y)).toBe(1);
      }
    }
  });

  test("where only one way exists it is the only way", () => {
    const { g, f, inlet } = twoWaters();
    // The pond gone: the lake is all there is.
    for (let y = 0; y < 14; y++) for (let x = 40; x < 44; x++) g.pool[idx(g, x, y)] = 0;
    g.rev++;
    const list = suggestMains(g, f, inlet, mainWet(g));
    expect(list.map((s) => s.why)).toEqual(["only"]);
  });

  test("laid, it costs what it said and is the main it said", () => {
    const { g, inlet } = twoWaters();
    const st = useWorldStore.getState();
    st.loadGrid(g);
    st.setPlaying(true);
    const map = useWorldStore.getState().grid, field = useWorldStore.getState().getWaterField();
    stepCooling(map, 0, false, 0);
    const pick = suggestMains(map, field, inlet, mainWet(map)).find((s) => !s.pump)!;
    useMoneyStore.setState({ money: new Decimal(pick.price + 7) });
    useWorldStore.getState().laySuggestion(pick.stroke);
    expect(useMoneyStore.getState().money.toNumber()).toBe(7);
    for (const c of pick.route) expect(map.main[idx(map, c.x, c.y)]).not.toBe(0);
    expect(map.mainEnd[idx(map, pick.route[0].x, pick.route[0].y)]).toBe(MAIN_END.intake);
    expect(map.mainEnd[idx(map, inlet.x, inlet.y)]).toBe(MAIN_END.outlet);
    // The player's own: not marked as the AI's.
    expect(map.main[idx(map, inlet.x, inlet.y)] & MAIN_AI).toBe(0);
    expect(useWorldStore.getState().stroke).toBeNull();
  });
});

describe("opened by doing it once by hand", () => {
  test("nothing is offered on a map where no pipe of the player's has worked", () => {
    const { g, f, inlet } = twoWaters();
    expect(suggestOpen(g)).toEqual({ water: false, sewer: false });
    expect(suggestionsAt(g, f, inlet, mainWet(g))).toEqual([]);
  });

  test("the player's first main carrying water opens the mains — and only the mains", () => {
    const { g, f, inlet } = twoWaters();
    // By hand: down from the lake's bank along a row to the inlet.
    const by = suggestMains(g, f, inlet, mainWet(g)).find((s) => !s.pump)!;
    const plan = planMain(g, by.route, mainWet(g), false);
    if ("refused" in plan) throw new Error(plan.refused);
    layMain(g, plan.cells);
    noteLaidByHand(g);
    // Laid, but nothing has flowed yet.
    expect(suggestOpen(g).water).toBe(false);
    for (let k = 0; k < 60 * 6; k++) { stepPipes(g, f, 1 / 60, { slop: { desks: null, perCoder: 0 } }); stepWater(f, 1 / 60); }
    expect(suggestOpen(g)).toEqual({ water: true, sewer: false });
  }, 20_000);

  test("a main the AI laid opens nothing", () => {
    const { g, f, inlet } = twoWaters();
    const by = suggestMains(g, f, inlet, mainWet(g)).find((s) => !s.pump)!;
    const plan = planMain(g, by.route, mainWet(g), false);
    if ("refused" in plan) throw new Error(plan.refused);
    layMain(g, plan.cells);
    for (const c of plan.cells) g.main[idx(g, c.x, c.y)] |= MAIN_AI;
    g.rev++;
    for (let k = 0; k < 60 * 6; k++) { runMains(f, g, 1 / 60); stepWater(f, 1 / 60); noteLaidByHand(g); }
    expect(suggestOpen(g).water).toBe(false);
  }, 20_000);

  test("once open, a free thirsty inlet is offered routes; a tile that is not one, none", () => {
    const { g, f, inlet } = twoWaters();
    setSuggestOpen(g, { water: true });
    expect(suggestionsAt(g, f, inlet, mainWet(g)).length).toBeGreaterThan(0);
    expect(suggestionsAt(g, f, { x: 20, y: 10 }, mainWet(g))).toEqual([]);
    // Sewers are not open: a slop port would be offered nothing.
    expect(suggestOpen(g).sewer).toBe(false);
  });

  test("what is open is kept with the map", () => {
    const { g, f } = twoWaters();
    setSuggestOpen(g, { water: true, sewer: false });
    const loaded = fromJSON(toJSON(serializeWorld(g, { terrain: [null], paved: [null] }, f)));
    expect(suggestOpen(loaded.grid)).toEqual({ water: true, sewer: false });
    // A map that has opened nothing writes nothing.
    const fresh = twoWaters();
    expect(serializeWorld(fresh.g, { terrain: [null], paved: [null] }, fresh.f).pipeHelp).toBeUndefined();
  });
});

describe("sewer connections, suggested", () => {
  /** A lake down the west edge, a trunk from it with a manhole at (12, 6) and another at (16, 6), and a vibe office. */
  function street() {
    const g = createGrid(24, 14);
    fillTerrain(g, 1);
    for (let y = 0; y < 14; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, x <= 3 ? -2 : 2);
    for (let y = 0; y < 14; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 4;
    commit(g, createHistory(), placeCommand(g, { ...structureDef("office-vibe")!, placement: undefined }, 10, 3)!);
    const a = [...g.structures.values()].find((s) => s.def === "office-vibe")!;
    const wet = mainWet(g);
    const p = planSewer(g, routeSewer(g, { x: 3, y: 6 }, { x: 16, y: 6 }, wet)!, wet, { unit: 1, liftPrice: 1 });
    if ("refused" in p) throw new Error(p.refused);
    for (const c of p.cells) { const i = idx(g, c.x, c.y); g.sewer[i] = p.staged.sewer[i]; g.sewerFit[i] = p.staged.sewerFit[i]; }
    g.sewerFit[idx(g, 12, 6)] = 1;
    g.rev++;
    const port = portsOf(g, a).find((q) => q.port.fluid === "slop")!;
    return { g, a, port: { x: port.x, y: port.y }, f: createWaterField(g) };
  }

  test("into the manholes it can reach, each the plan a hand-drawn connection gets, at its price", () => {
    const { g, port } = street();
    const list = suggestConnections(g, port, mainWet(g));
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) {
      const plan = planLateral(g, s.route, mainWet(g));
      if ("refused" in plan) throw new Error(plan.refused);
      expect(plan.exit).toBe(true);
      expect(s.price).toBe(pipeCost(plan.fresh).toNumber());
      expect(s.kind).toBe("connection");
      expect(s.stroke.lateral).toBe(true);
    }
    // The cheapest goes to the nearer manhole.
    const cheapest = list.find((s) => s.why === "cheapest" || s.why === "only")!;
    expect(cheapest.route[cheapest.route.length - 1]).toEqual({ x: 12, y: 6 });
  });

  test("the player's first connection draining opens the sewers", () => {
    const { g, a, port, f } = street();
    const by = suggestConnections(g, port, mainWet(g))[0];
    const plan = planLateral(g, by.route, mainWet(g));
    if ("refused" in plan) throw new Error(plan.refused);
    layMain(g, plan.cells, true);
    expect(g.main[idx(g, port.x, port.y)] & MAIN_SEWER).toBe(MAIN_SEWER);
    expect(suggestOpen(g).sewer).toBe(false);
    const desks = new Map([[a.id, { used: 1 }]]);
    for (let k = 0; k < 30; k++) { runMains(f, g, 1); stepSlop(g, f, desks, 0.5, 1); stepWater(f, 1); noteLaidByHand(g); }
    expect(suggestOpen(g)).toEqual({ water: false, sewer: true });
  });

  test("with no manhole in reach, none", () => {
    const { g, port } = street();
    for (let i = 0; i < g.sewerFit.length; i++) if (g.sewerFit[i] === 1) g.sewerFit[i] = 0;
    g.rev++;
    expect(suggestConnections(g, port, mainWet(g))).toEqual([]);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useAiSingularityStore } from "../../state/ai-singularity.store";
import { useMoneyStore } from "../../state/money.store";
import { useQuestStore } from "../../state/quest.store";
import { useSessionStore } from "../../state/session.store";
import { useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../../world/edit/commands";
import { createGrid, fillTerrain, idx, structureAt } from "../../world/grid";
import { structureDef } from "../../world/structures/def";
import { placeCommand } from "../../world/structures/place";
import { clearBlock, inRebuiltBlock } from "../../world/ai/arc-rules";
import { aiDistrict } from "../../world/ai/district";
import { chooseAction } from "../../world/ai/planner";
import { resetCooling, stepCooling, tankFor } from "../../world/projects/cooling";
import { buildCost } from "../build-cost";
import { CHAPTERS } from "./chapters";
import { questDistrictCentre } from "./effects";
import type { QuestWorld } from "./objectives";
import type { Effect } from "./types";

afterEach(() => { useWorldStore.setState({ playing: false }); resetCooling(); resetAllGameStores(); });

const FROM = { tool: 0, assistant: 20, colleague: 40, manager: 60, overseer: 80, ascension: 100 };
const world = (w: Partial<QuestWorld> = {}): QuestWorld => ({
  meter: 0, stageFrom: FROM, agents: 10, running: 10, dcCooled: 1, covered: 1, counts: {}, block: false, keep: false, site: false, ...w,
});
const q = () => useQuestStore.getState();

/** A road along row 12, a Data Centre north of it, two starter houses and a café south of it. */
function town() {
  const g = createGrid(30, 20);
  fillTerrain(g, 1);
  for (let x = 2; x < 28; x++) g.paved[idx(g, x, 12)] = 1;
  const h = createHistory();
  commit(g, h, placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 12, 9)!);
  for (const [def, x, y] of [["kit:intern.t0", 8, 13], ["kit:intern.t0", 10, 13], ["cafe", 6, 13]] as const) {
    commit(g, h, placeCommand(g, { ...structureDef(def)!, placement: undefined }, x, y)!);
  }
  useWorldStore.getState().loadGrid(g, [null]);
  useWorldStore.setState({ playing: true });
  useMoneyStore.setState({ money: new Decimal(1e12) });
  return useWorldStore.getState().grid;
}

describe("the chapters", () => {
  test("one at each stage in order, every option's effects stated, every echo remembered", () => {
    expect(CHAPTERS.map((c) => c.stage)).toEqual(["assistant", "colleague", "manager", "overseer", "overseer", "overseer"]);
    expect(CHAPTERS.map((c) => c.number)).toEqual([1, 2, 3, 4, 4, 5]);
    for (const c of CHAPTERS) {
      expect(c.options[c.preferred]).toBeDefined();
      const flags = c.options.flatMap((o) => [...o.effects, ...(o.success ?? []), ...(o.failure ?? [])])
        .flatMap((e: Effect) => (e.kind === "flag" ? [e.name] : []));
      for (const f of flags) expect(c.echoes?.[f]).toBeString();
      for (const o of c.options) {
        expect(o.says.length).toBeGreaterThan(0);
        for (const n of Object.values(o.axis)) expect(Math.abs(n!)).toBeLessThanOrEqual(2);
      }
    }
  });

  test("they come one after another as the meter climbs, the test of trust after the Charter", () => {
    const seen: string[] = [];
    for (const meter of [25, 45, 65, 85, 85, 96]) {
      q().step(world({ meter }), 1);
      seen.push(q().offer!.id);
      q().choose(CHAPTERS.find((c) => c.id === q().offer!.id)!.options.length - 1);
    }
    expect(seen).toEqual(["ledger", "commute", "thirst", "charter", "trust", "last-light"]);
  });

  test("Thirst remembers the Ledger refused", () => {
    const thirst = CHAPTERS.find((c) => c.id === "thirst")!;
    expect(thirst.transmission(new Set())).toHaveLength(1);
    expect(thirst.transmission(new Set(["ledger:refused"]))[1]).toContain("trust me with money");
  });

  test("the Commute Problem: a block picked, a building kept, the rest of its starter houses cleared, the district centred there", () => {
    const g = town();
    useQuestStore.setState({ offer: { kind: "chapter", id: "commute", waited: 0 } });
    q().choose(1);
    q().pickBlock({ x: 9, y: 13 });
    q().step(world({ meter: 45, block: true, keep: false }), 1);
    expect(q().objective?.progress).toBe(0.5);
    const kept = structureAt(g, 8, 13);
    q().keepBuilding(kept);
    q().step(world({ meter: 45, block: true, keep: true }), 1);
    expect(q().objective).toBeNull();
    expect(q().actions).toEqual([{ kind: "rebuildBlock" }]);
    expect(q().flags).toEqual(expect.arrayContaining(["block:rebuilt", "block:kept"]));
    expect(questDistrictCentre()).toEqual({ x: 9, y: 13 });
    expect(aiDistrict(g, "colleague")).toMatchObject({ cx: 9, cy: 13 });
    expect(clearBlock(g)).toBe(1);
    expect(structureAt(g, 8, 13)).toBe(kept);
    expect(structureAt(g, 10, 13)).toBe(-1);
    // The café is not a starter house: it stays.
    expect(structureAt(g, 6, 13)).toBeGreaterThanOrEqual(0);
    expect(inRebuiltBlock(10, 14)).toBe(true);
    // A new company's map has no block.
    q().newCompany();
    expect(questDistrictCentre()).toBeNull();
  });

  test("Thirst, the river given: its own kept in water, floods half as often again", () => {
    const g = town();
    useQuestStore.setState({ offer: { kind: "chapter", id: "thirst", waited: 0 } });
    q().choose(0);
    q().step(world({ meter: 65, covered: 1 }), 1);
    expect(q().flags).toContain("river:dammed");
    useAiSingularityStore.setState({ value: 65 });
    const dc = [...g.structures.values()].find((s) => s.def === "datacentre")!;
    stepCooling(g, 40, false, 0.01);
    Object.assign(tankFor(dc.id)!, { level: 0 });
    stepCooling(g, 40, false, 1);
    expect(tankFor(dc.id)!.share).toBe(1);
  });

  test("the Partnership: the AI pays half of what you build in its district", () => {
    const g = town();
    useAiSingularityStore.setState({ value: 85 });
    useSessionStore.setState({ aiWallet: 1e9 });
    useQuestStore.setState({ offer: { kind: "chapter", id: "charter", waited: 0 } });
    q().choose(1);
    const price = buildCost("cafe")!.toNumber();
    const before = useMoneyStore.getState().money.toNumber();
    expect(aiDistrict(g, "overseer")).not.toBeNull();
    useWorldStore.setState({ tool: "placeStructure", structureDefId: "cafe" });
    useWorldStore.getState().commitStructure({ x: 16, y: 13 });
    expect(before - useMoneyStore.getState().money.toNumber()).toBeCloseTo(price / 2);
    expect(useSessionStore.getState().aiWallet).toBeCloseTo(1e9 - price / 2);
  });

  test("a site given is the AI's: you cannot build there", () => {
    town();
    useQuestStore.setState({ offer: { kind: "chapter", id: "trust", waited: 0 } });
    q().choose(0);
    q().giveSite({ x: 20, y: 14 });
    q().step(world({ meter: 85, site: true }), 1);
    expect(q().flags).toContain("site:given");
    useWorldStore.setState({ tool: "placeStructure", structureDefId: "cafe" });
    useWorldStore.getState().commitStructure({ x: 20, y: 13 });
    expect(useWorldStore.getState().notice?.text).toContain("AI's site");
    expect(structureAt(useWorldStore.getState().grid, 20, 13)).toBe(-1);
    // Off the site, it builds.
    useWorldStore.getState().commitStructure({ x: 24, y: 13 });
    expect(structureAt(useWorldStore.getState().grid, 24, 13)).toBeGreaterThanOrEqual(0);
  });

  test("the Lattice goes on the site given", () => {
    const g = town();
    useQuestStore.setState({ site: { x: 20, y: 14 }, flags: ["site:given"] });
    useAiSingularityStore.setState({ value: 96 });
    useSessionStore.setState({ aiWallet: 1e12 });
    const a = chooseAction(g, "overseer", () => 0.5);
    expect(a).toMatchObject({ kind: "place", def: "lattice", at: { x: 19, y: 13 } });
  });
});

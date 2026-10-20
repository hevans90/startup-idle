import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { setHousingReader } from "../../game/housing";
import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useAgentsStore } from "../../state/agents.store";
import { useAiSingularityStore } from "../../state/ai-singularity.store";
import { useGenerationStore } from "../../state/generation.store";
import { useMoneyStore } from "../../state/money.store";
import { useSessionStore, type AiFocus } from "../../state/session.store";
import { useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { FOCUSES } from "./focus";
import { chooseAction, type AiAction } from "./planner";

/** A road along row 12, a Data Centre north of it, houses and services along it. */
function town() {
  const g = createGrid(30, 16);
  fillTerrain(g, 1);
  for (let x = 2; x < 28; x++) g.paved[idx(g, x, 12)] = 1;
  const h = createHistory();
  commit(g, h, placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 12, 9)!);
  for (const [def, x, y] of [["kit:intern.t0", 8, 13], ["kit:intern.t0", 10, 13], ["cafe", 16, 13], ["park", 20, 13]] as const) {
    commit(g, h, placeCommand(g, { ...structureDef(def)!, placement: undefined }, x, y)!);
  }
  useWorldStore.getState().loadGrid(g, [null]);
  useWorldStore.setState({ playing: true });
  useMoneyStore.setState({ money: new Decimal(1e12) });
  unhouse = setHousingReader(() => ({ intern: 0, vibe_coder: 0, "10x_dev": 0 }));
  return useWorldStore.getState().grid;
}
let unhouse = () => {};
let seed = 11;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);

afterEach(() => {
  unhouse();
  useWorldStore.setState({ playing: false });
  resetAllGameStores();
});

/** What it does over many turns, told to work at `focus`. */
function jobs(focus: AiFocus, stage: "manager" | "overseer" = "overseer"): AiAction[] {
  const g = town();
  useSessionStore.getState().setAiFocus(focus);
  const out: AiAction[] = [];
  for (let k = 0; k < 80; k++) { const a = chooseAction(g, stage, rand); if (a) out.push(a); }
  return out;
}
const lots = (as: AiAction[]) => as.filter((a) => a.kind === "place" && a.def.startsWith("kit:"));
const converts = (as: AiAction[], into: string) => as.filter((a) => a.kind === "convert" && a.into === into);

describe("the AI's focus", () => {
  test("grow the town: never converts a house", () => {
    const as = jobs("grow");
    expect(as.length).toBeGreaterThan(0);
    expect(converts(as, "ai-node")).toEqual([]);
  });

  test("feed the machine: never zones a lot", () => {
    const as = jobs("machine");
    expect(as.length).toBeGreaterThan(0);
    expect(lots(as)).toEqual([]);
  });

  test("serve the people: never repurposes a service, nor converts a house", () => {
    const as = jobs("people");
    expect(as.length).toBeGreaterThan(0);
    expect(converts(as, "gpu-farm")).toEqual([]);
    expect(converts(as, "ai-node")).toEqual([]);
  });

  test("hands off: nothing but cooling — and held back, as if throttled", () => {
    expect(jobs("hands-off").filter((a) => a.kind !== "pipe")).toEqual([]);
    useAgentsStore.setState({ agents: 4, running: 4 } as never);
    useSessionStore.getState().setAiFocus("grow");
    useAiSingularityStore.getState().tick(10);
    expect(useGenerationStore.getState().log.throttled).toBe(0);
    useSessionStore.getState().setAiFocus("hands-off");
    useAiSingularityStore.getState().tick(10);
    expect(useGenerationStore.getState().log.throttled).toBeGreaterThan(0);
  });

  test("what it asked for, it says it was asked", () => {
    const says = FOCUSES.find((f) => f.id === "grow")!.says;
    expect(jobs("grow").some((a) => a.why.startsWith(says))).toBe(true);
  });
});

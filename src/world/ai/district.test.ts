import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useAiSingularityStore } from "../../state/ai-singularity.store";
import { useMoneyStore } from "../../state/money.store";
import { useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { isPaved } from "../roads/mask";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { paveRoad } from "../play/build-actions";
import { DISTRICT_RADIUS, aiDistrict, inDistrict } from "./district";
import { chooseAction, targetOf } from "./planner";

/** A long road along row 5, a finished Data Centre at its west end, loaded into the game. */
function town() {
  const g = createGrid(64, 14);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  commit(g, createHistory(), placeCommand(g, structureDef("datacentre")!, 4, 2)!);
  useWorldStore.getState().loadGrid(g, [null]);
  useWorldStore.setState({ playing: true });
  return useWorldStore.getState().grid;
}

afterEach(() => {
  useWorldStore.setState({ playing: false });
  resetAllGameStores();
});

describe("the AI's district", () => {
  test("a circle round the Data Centre growing with the stage; none before the Colleague, nor without one", () => {
    const g = town();
    expect(aiDistrict(g, "assistant")).toBeNull();
    const c = aiDistrict(g, "colleague")!, m = aiDistrict(g, "manager")!, o = aiDistrict(g, "overseer")!;
    expect([c.r, m.r, o.r]).toEqual([DISTRICT_RADIUS.colleague, DISTRICT_RADIUS.manager, DISTRICT_RADIUS.overseer]);
    expect(inDistrict(c, c.cx + 7, c.cy)).toBe(true);
    expect(inDistrict(c, c.cx + 9, c.cy)).toBe(false);
    expect(inDistrict(aiDistrict(g, "ascension"), 63, 13)).toBe(true);
    expect(aiDistrict(createGrid(8, 8), "overseer")).toBeNull();
  });

  test("the AI's work on the map stays in it", () => {
    const g = town();
    useMoneyStore.setState({ money: new Decimal(1e12) });
    const d = aiDistrict(g, "manager")!;
    let seed = 3;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    let onMap = 0;
    for (let k = 0; k < 60; k++) {
      const a = chooseAction(g, "manager", rand);
      if (!a || a.kind === "pipe") continue;
      const at = targetOf(a);
      if (!at) continue;
      onMap++;
      expect(inDistrict(d, at.x, at.y)).toBe(true);
    }
    expect(onMap).toBeGreaterThan(0);
  });

  test("from the Overseer, its streets are its own: the player is refused there, not outside it, and the AI is not", () => {
    const g = town();
    useMoneyStore.setState({ money: new Decimal(1e12) });
    useAiSingularityStore.setState({ value: 85 });
    const d = aiDistrict(g, "overseer")!;
    const inside = { x: Math.round(d.cx), y: 7 }, outside = { x: 60, y: 7 };
    expect(inDistrict(d, inside.x, inside.y)).toBe(true);
    expect(inDistrict(d, outside.x, outside.y)).toBe(false);
    const st = useWorldStore.getState();
    const playerLays = (c: { x: number; y: number }) => {
      st.setTool("paintRoad");
      useWorldStore.setState({ stroke: { tool: "paintRoad", brush: "line", anchor: c, head: c } });
      useWorldStore.getState().endStroke();
    };
    playerLays(inside);
    expect(isPaved(useWorldStore.getState().grid, inside.x, inside.y)).toBe(false);
    expect(useWorldStore.getState().notice?.text).toMatch(/AI manages/);
    playerLays(outside);
    expect(isPaved(useWorldStore.getState().grid, outside.x, outside.y)).toBe(true);
    // The AI lays its own.
    expect(paveRoad(inside, inside)).toBe(true);
    expect(isPaved(useWorldStore.getState().grid, inside.x, inside.y)).toBe(true);
    expect(g).toBeDefined();
  });
});

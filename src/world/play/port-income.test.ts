import { beforeEach, describe, expect, test } from "bun:test";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useGeneratorStore } from "../../state/generators.store";
import { useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { payday } from "./port-income";

describe("payday", () => {
  beforeEach(() => { localStorage.clear(); resetAllGameStores(); });

  test("a workplace floats what the people at its desks earned", () => {
    const g = createGrid(30, 10);
    fillTerrain(g, 1);
    for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
    const h = createHistory();
    commit(g, h, placeCommand(g, structureDef("garage")!, 3, 4)!);
    for (const x of [10, 12]) {
      const cmd = placeCommand(g, structureDef("kit:intern.t0")!, x, 4)!;
      cmd.structures!.added[0].residents = 2;
      commit(g, h, cmd);
    }
    useWorldStore.getState().loadGrid(g);
    useWorldStore.setState({ playing: true });
    useGeneratorStore.getState().increaseGenerator("intern", 4);
    const paid = payday(5000);
    const garage = [...g.structures.values()].find((s) => s.def === "garage")!;
    expect(paid.map((p) => p.structure)).toEqual([garage.id]);
    const perSecond = useGeneratorStore.getState().getGeneratorMoneyPerSecond("intern", 4);
    expect(paid[0].amount).toBeCloseTo(perSecond * 5, 6);
  });

  test("with nobody seated, nothing", () => {
    useWorldStore.setState({ playing: true });
    expect(payday(5000)).toEqual([]);
  });
});

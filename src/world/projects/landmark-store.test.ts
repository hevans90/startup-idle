import { afterEach, describe, expect, test } from "bun:test";

import { projectDef } from "../../game/projects";
import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { siteOf } from "./works";

afterEach(() => resetAllGameStores());

describe("a landmark's next tier, from the card", () => {
  test("starts at once where the last tier stands: no site to choose, one step to undo", () => {
    const g = createGrid(20, 12);
    fillTerrain(g, 1);
    for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
    commit(g, createHistory(), placeCommand(g, structureDef("garage")!, 6, 2)!);
    useWorldStore.getState().loadGrid(g);
    const st = useWorldStore.getState();
    const garage = [...st.grid.structures.values()][0];
    st.placeProject("hq");
    const after = useWorldStore.getState();
    expect(after.placingProject).toBeNull();
    const site = siteOf(after.grid, projectDef("hq")!)!;
    expect(site.id).toBe(garage.id);
    after.doUndo();
    expect(useWorldStore.getState().grid.structures.get(garage.id)?.def).toBe("garage");
  });
});

import { beforeEach, describe, expect, test } from "bun:test";

import { useWorldStore } from "../../state/world.store";
import { GROUPS, TOOLS, TOOL_KEYS, groupOf, pickGroup, pickTool } from "./toolbox";

/** THE EDITOR'S TOOLBOX: what the bar shows and the keys pick. @see toolbox */
const st = () => useWorldStore.getState();

describe("the editor's toolbox", () => {
  beforeEach(() => pickTool("inspect"));

  test("every tool is in one group, and no two share a key", () => {
    const all = GROUPS.flatMap((g) => g.tools);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual((Object.keys(TOOLS) as typeof all).sort());
    expect(Object.keys(TOOL_KEYS).length).toBe(Object.values(TOOLS).filter((t) => t!.key).length);
    // (Kept by the brush, the grid and the x-ray.)
    for (const k of ["1", "2", "3", "[", "]", "g", "y"]) expect(TOOL_KEYS[k]).toBeUndefined();
  });

  test("a group's brush is as it was left, whatever was done with another's", () => {
    pickTool("paintTerrain");
    st().setBrush("rect"); st().setBrushRadius(3);
    pickTool("paintRoad");
    expect([st().brush, st().brushRadius]).toEqual(["line", 0]);
    pickTool("placeStructure");
    expect([st().brush, st().brushRadius]).toEqual(["point", 0]);
    pickTool("raise");
    expect([st().brush, st().brushRadius]).toEqual(["rect", 3]);
  });

  test("a group is picked up at the tool last used from it", () => {
    pickTool("sink");
    pickGroup("land");
    expect(groupOf(st().tool).id).toBe("land");
    pickGroup("water");
    expect(st().tool).toBe("sink");
  });
});

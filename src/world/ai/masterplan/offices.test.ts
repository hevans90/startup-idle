import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../../edit/commands";
import { createGrid, fillTerrain, idx, type Grid } from "../../grid";
import { structureDef } from "../../structures/def";
import { placeCommand } from "../../structures/place";
import { planTown } from "./plan";
import { nextStep } from "./schedule";

/** A long street, and a vibe coder's lot on it with `living` in it. */
function town(living: number): Grid {
  const g = createGrid(32, 16);
  fillTerrain(g, 1);
  for (let x = 1; x < 31; x++) g.paved[idx(g, x, 8)] = 1;
  commit(g, createHistory(), placeCommand(g, structureDef("kit:vibe_coder.t1")!, 6, 7, { needsRoad: true })!);
  const lot = [...g.structures.values()].find((s) => s.def.startsWith("kit:vibe_coder"))!;
  lot.residents = living;
  return g;
}
const wants = { rules: { needsRoad: true }, kinds: ["intern" as const, "vibe_coder" as const], services: false, offices: true };

describe("AI mode's offices", () => {
  test("go up for the kind living on the map with no desk to go to", () => {
    const g = town(8);
    const s = nextStep(g, planTown(g, { owned: () => true, kinds: wants.kinds, services: false, offices: false }), wants);
    expect(s).toMatchObject({ kind: "build", def: "office-vibe" });
  });

  test("not while everyone has a desk", () => {
    const g = town(8);
    commit(g, createHistory(), placeCommand(g, structureDef("office-vibe")!, 20, 9, { needsRoad: true })!);
    const s = nextStep(g, planTown(g, { owned: () => true, kinds: wants.kinds, services: false, offices: false }), wants);
    expect(s?.kind === "build" && s.def.startsWith("office")).toBe(false);
  });
});

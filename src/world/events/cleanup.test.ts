import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, type Structure } from "../grid";
import { createNetwork } from "../roads/network";
import { createTown, stepTown } from "../agents/town";
import { placeCommand } from "../structures/place";
import { structureDef } from "../structures/def";
import { createWaterField, pourAt } from "../water/field";
import { fluidIndexOf } from "../water/materials";
import { CLEAN_MIN, createCleanup, stepCleanup, wetTiles } from "./cleanup";
import { sludgeAt } from "./sludge";

/** A road along row 5, a studio on its north side, and a pit to the south with sludge spilt beside it. */
function spill() {
  const g = createGrid(30, 16);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  const history = createHistory();
  commit(g, history, placeCommand(g, structureDef("studio")!, 4, 3)!);
  commit(g, history, placeCommand(g, structureDef("slop-pit")!, 18, 6)!);
  const studio = [...g.structures.values()].find((s) => s.def === "studio")!;
  const pit = [...g.structures.values()].find((s) => s.def === "slop-pit") as Structure;
  const field = createWaterField(g);
  for (const [x, y] of [[17, 8], [17, 9], [21, 8], [19, 10]]) pourAt(field, x, y, 0.6, fluidIndexOf("slop"));
  return { g, studio, pit, field };
}

describe("mopping up", () => {
  test("vibe coders leave work, walk to the sludge, drain it by hand, and go back", () => {
    const { g, studio, pit, field } = spill();
    const net = createNetwork(g), town = createTown(), c = createCleanup();
    expect(wetTiles(field, g, pit).length).toBe(4);
    let mostAway = 0, sawMopping = false;
    for (let k = 0; k < 30 * 120; k++) {
      stepTown(town, g, net, 0, 1 / 30);
      const away = stepCleanup(c, town, g, net, field, pit, 60, [studio.id], 1 / 30);
      mostAway = Math.max(mostAway, away);
      sawMopping ||= town.movers.some((m) => m.job?.role === "cleaning");
      town.arrived.length = 0;
    }
    expect(mostAway).toBe(8);
    expect(sawMopping).toBe(true);
    for (const [x, y] of [[17, 8], [17, 9], [21, 8], [19, 10]]) expect(sludgeAt(field, x, y)).toBeLessThanOrEqual(CLEAN_MIN);
    expect(c.away).toBe(0);
    expect(town.movers.some((m) => m.job?.role === "cleaning")).toBe(false);
  });

  test("a Clean Sweep needs half the people", () => {
    const { g, studio, pit, field } = spill();
    const net = createNetwork(g), town = createTown();
    expect(stepCleanup(createCleanup(), town, g, net, field, pit, 60, [studio.id], 1 / 30)).toBe(8);
    expect(stepCleanup(createCleanup(), town, g, net, field, pit, 60, [studio.id], 1 / 30, 1)).toBe(4);
  });

  test("never more away than there are", () => {
    const { g, studio, pit, field } = spill();
    const net = createNetwork(g), town = createTown(), c = createCleanup();
    expect(stepCleanup(c, town, g, net, field, pit, 3, [studio.id], 1 / 30)).toBe(3);
  });
});

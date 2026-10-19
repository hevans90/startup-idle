import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../../edit/commands";
import { createGrid, fillTerrain, idx, structureAt, type Grid } from "../../grid";
import { structureDef } from "../../structures/def";
import { placeCommand } from "../../structures/place";
import { replacementFor, stillStands } from "./replace";
import { nextStep } from "./schedule";
import { styleOf } from "./style";

/**
 * A street along row 12, a café and a gym and an office on it, and every
 * other tile of its frontage a lot of `tier` — no park, and nowhere left to
 * put one but in place of lots.
 */
function town(tier = "t0"): Grid {
  const g = createGrid(24, 24);
  fillTerrain(g, 1);
  for (let x = 2; x < 22; x++) g.paved[idx(g, x, 12)] = 1;
  const put = (def: string, x: number, y: number) => {
    const cmd = placeCommand(g, structureDef(def)!, x, y, { needsRoad: true });
    if (cmd) commit(g, createHistory(), cmd);
  };
  put("cafe", 2, 11); put("gym", 4, 10); put("office-intern", 6, 13);
  for (let x = 2; x < 22; x++) { put(`kit:intern.${tier}`, x, 11); put(`kit:intern.${tier}`, x, 13); }
  return g;
}
const box = { x0: 8, y0: 8, x1: 16, y1: 16 };
const owned = () => true;
const tall = { kinds: ["intern"], services: true, style: styleOf(["aesthete"]) };

describe("rebuilding where it pays", () => {
  test("a park in place of starter lots, where the town has none", () => {
    const g = town();
    const r = replacementFor(g, box, owned, tall, 1e6)!;
    expect(r).not.toBeNull();
    expect(r.def).toBe("park");
    expect(r.clears.length).toBeGreaterThan(0);
    expect(r.value).toBeGreaterThan(0);
    expect(stillStands(g, r)).toBe(true);
  });

  test("none where the money it adds would not pay for it", () => {
    expect(replacementFor(town(), box, owned, tall, 1e-6)).toBeNull();
  });

  test("never pulls down a house grown to III", () => {
    expect(replacementFor(town("t2"), box, owned, tall, 1e6)).toBeNull();
  });

  test("a wide lineage does not rebuild", () => {
    expect(replacementFor(town(), box, owned, { ...tall, style: styleOf(["hivemind"]) }, 1e6)).toBeNull();
  });

  test("the schedule takes it first, and drops it once its lots are gone", () => {
    const g = town();
    const r = replacementFor(g, box, owned, tall, 1e6)!;
    const plan = { steps: [r], predicted: 0, now: 0, centre: { x: 12, y: 12 } };
    const wants = { rules: { needsRoad: true, owned }, kinds: ["intern" as const], services: true, offices: true, style: tall.style };
    expect(nextStep(g, plan, wants)).toBe(r);
    const c = r.clears[0];
    g.structures.delete(structureAt(g, c.x, c.y));
    g.structureAt[idx(g, c.x, c.y)] = -1;
    commit(g, createHistory(), placeCommand(g, structureDef("kit:intern.t2")!, c.x, c.y, { needsRoad: true })!);
    expect(stillStands(g, r)).toBe(false);
    expect(nextStep(g, plan, wants)).not.toBe(r);
  });
});

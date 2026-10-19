import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../../edit/commands";
import { createGrid, fillTerrain, idx, type Grid } from "../../grid";
import { structureDef } from "../../structures/def";
import { placeCommand } from "../../structures/place";
import { planTown } from "./plan";
import { nextStep } from "./schedule";
import { DRY_MARGIN, PLAIN, SERVE_TALL, SERVE_WIDE, nearWater, styleOf, tallness } from "./style";

describe("The Model's style", () => {
  test("leans tall with no past at all, and Hivemind alone makes it wide", () => {
    expect(styleOf([])).toEqual(PLAIN);
    expect(PLAIN.tall).toBeGreaterThan(0.5);
    expect(PLAIN.parkFirst).toBe(true);
    expect(tallness(["hivemind"])).toBe(0);
    const wide = styleOf(["hivemind"]);
    expect(wide.parkFirst || wide.reachOnly || wide.rebuild).toBe(false);
    expect(wide.serve).toBe(SERVE_WIDE);
    expect(wide.commuteCap).toBeNull();
  });

  test("quality traits push it to the top; a mixed lineage lands between", () => {
    expect(tallness(["aesthete"])).toBe(1);
    expect(styleOf(["aesthete"]).serve).toBe(SERVE_TALL);
    expect(styleOf(["aesthete", "patient"]).targetTier).toBe("landmark");
    const mixed = tallness(["hivemind", "aesthete", "patient"]);
    expect(mixed).toBeGreaterThan(0);
    expect(mixed).toBeLessThan(1);
  });

  test("the services it waits for fall the taller it is", () => {
    const order = [["hivemind"], ["hivemind", "aesthete"], [], ["aesthete"]] as const;
    const serve = order.map((t) => styleOf(t).serve);
    for (let k = 1; k < serve.length; k++) expect(serve[k]).toBeLessThanOrEqual(serve[k - 1]);
  });

  test("and the old pulls stay", () => {
    expect(styleOf(["nanny"]).spareDesks).toBeGreaterThan(PLAIN.spareDesks);
    expect(styleOf(["paranoid"]).dryMargin).toBe(DRY_MARGIN);
    expect(styleOf(["hydrophile"]).wetPull).toBeGreaterThan(0);
    expect(styleOf(["hivemind"]).centre).toBe("datacentre");
    expect(styleOf(["patient", "patient"]).from).toEqual(["patient"]);
  });
});

/** Flat ground, a road along row 12, a strip of water down column 20. */
function town(): Grid {
  const g = createGrid(32, 24);
  fillTerrain(g, 1);
  for (let x = 2; x < 30; x++) g.paved[idx(g, x, 12)] = 1;
  for (let y = 0; y < 24; y++) g.pool[idx(g, 20, y)] = 1;
  for (let x = 19; x <= 21; x++) g.paved[idx(g, x, 12)] = 0;
  return g;
}
const base = { owned: () => true, kinds: ["intern" as const], services: true, offices: false };
const at = (s: { kind: string; at?: { x: number; y: number }; from?: { x: number; y: number }; to?: { x: number; y: number } }) =>
  s.at ? [s.at] : [s.from!, s.to!];

describe("a town planned in a style", () => {
  test("PARANOID: nothing of it within reach of the water", () => {
    const g = town();
    const plain = planTown(g, base).steps.flatMap(at);
    const dry = planTown(g, { ...base, style: styleOf(["paranoid"]) }).steps.flatMap(at);
    expect(plain.some((c) => nearWater(g, c.x, c.y, DRY_MARGIN))).toBe(true);
    expect(dry.some((c) => nearWater(g, c.x, c.y, DRY_MARGIN))).toBe(false);
  });

  test("TALL: a park before any lot, and every lot planned to grow to III", () => {
    const g = town();
    const box = { owned: (x: number, y: number) => x >= 2 && x <= 12 && y >= 6 && y <= 18 };
    const builds = planTown(g, { ...base, ...box, style: styleOf(["aesthete"]) }).steps.filter((s) => s.kind === "build");
    const park = builds.findIndex((s) => s.def === "park");
    const lots = builds.filter((s) => s.def.startsWith("kit:"));
    expect(park).toBeGreaterThanOrEqual(0);
    expect(lots.length).toBeGreaterThan(0);
    expect(builds.findIndex((s) => s.def.startsWith("kit:"))).toBeGreaterThan(park);
    for (const l of lots) expect(l.tier).toBe("t2");
  });

  test("WIDE: lots on all the frontage, and no park first", () => {
    const g = town();
    const box = { owned: (x: number, y: number) => x >= 2 && x <= 12 && y >= 6 && y <= 18 };
    const lots = (traits: Parameters<typeof styleOf>[0]) =>
      planTown(g, { ...base, ...box, style: styleOf(traits) }).steps.filter((s) => s.kind === "build" && s.def.startsWith("kit:")).length;
    expect(lots(["hivemind"])).toBeGreaterThan(lots(["aesthete"]));
  });

  test("RECURSIVE: grows out from the Data Centre", () => {
    const g = town();
    commit(g, createHistory(), placeCommand(g, structureDef("datacentre")!, 4, 9, { needsRoad: true })!);
    const dc = [...g.structures.values()].find((s) => s.def === "datacentre")!;
    expect(planTown(g, { ...base, style: styleOf(["hivemind"]) }).centre).toEqual({ x: dc.x + (dc.w >> 1), y: dc.y + (dc.h >> 1) });
  });

  test("PARANOID: the schedule puts no lot by the water either", () => {
    const g = town();
    const style = styleOf(["paranoid"]);
    const plan = planTown(g, { ...base, style });
    const w = { rules: { needsRoad: true, owned: () => true }, kinds: ["intern" as const], services: false, offices: false, style };
    for (let k = 0; k < 40; k++) {
      const s = nextStep(g, plan, w);
      if (!s) break;
      if (s.kind === "build") {
        expect(nearWater(g, s.at.x, s.at.y, DRY_MARGIN)).toBe(false);
        commit(g, createHistory(), placeCommand(g, structureDef(s.def)!, s.at.x, s.at.y, { needsRoad: true })!);
      } else if (s.kind === "road") {
        for (let y = s.from.y; y <= s.to.y; y++) for (let x = s.from.x; x <= s.to.x; x++) g.paved[idx(g, x, y)] = 1;
      }
    }
  });
});

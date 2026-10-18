import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../../edit/commands";
import { createGrid, fillTerrain, idx, type Grid } from "../../grid";
import { structureDef } from "../../structures/def";
import { placeCommand } from "../../structures/place";
import { planTown } from "./plan";
import { nextStep } from "./schedule";
import { DRY_MARGIN, PLAIN, SERVE_KIND, SERVE_LEAN, SERVE_PLAIN, nearWater, styleOf } from "./style";

describe("The Model's style", () => {
  test("is plain with no past, and each family pulls its own way", () => {
    expect(styleOf([])).toEqual(PLAIN);
    expect(styleOf(["aesthete"]).serve).toBe(SERVE_KIND);
    expect(styleOf(["ruthless"]).serve).toBe(SERVE_LEAN);
    expect(styleOf(["aesthete", "ruthless"]).serve).toBe(SERVE_PLAIN);
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

  test("planner traits plan more services than optimisers", () => {
    const g = town();
    const services = (traits: Parameters<typeof styleOf>[0]) =>
      planTown(g, { ...base, owned: (x, y) => x >= 2 && x <= 12 && y >= 6 && y <= 18, style: styleOf(traits) }).steps.filter((s) => s.kind === "build" && ["cafe", "park", "gym"].includes(s.def)).length;
    expect(services(["aesthete"])).toBeGreaterThanOrEqual(services([]));
    expect(services([])).toBeGreaterThanOrEqual(services(["ruthless"]));
    expect(services(["aesthete"])).toBeGreaterThan(services(["ruthless"]));
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

import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../../edit/commands";
import { heightWrites } from "../../edit/height-tools";
import { createGrid, fillTerrain, idx, structureAt, type Grid } from "../../grid";
import { isPaved } from "../../roads/mask";
import { structureDef } from "../../structures/def";
import { demolishCommand, placeCommand } from "../../structures/place";
import { planTown, type PlanStep } from "./plan";
import { nextStep } from "./schedule";

/**
 * Flat ground with a road along row 12 from x 2 to 21: the streets' pattern
 * falls on rows 0, 3, 6… and columns 2, 10, 18.
 */
function town(): Grid {
  const g = createGrid(24, 24);
  fillTerrain(g, 1);
  for (let x = 2; x < 22; x++) g.paved[idx(g, x, 12)] = 1;
  return g;
}
const everywhere = () => true;
const opts = (owned: (x: number, y: number) => boolean = everywhere) => ({ owned, kinds: [], services: false, offices: false });
const wants = (owned: (x: number, y: number) => boolean = everywhere) => ({ rules: { needsRoad: true, owned }, kinds: [], services: false, offices: false });
const kinds = (steps: PlanStep[]) => steps.map((s) => s.kind);

/** Take the schedule's steps on the grid, as the autopilot would, till it has none; what it took. */
function build(g: Grid, owned = everywhere): PlanStep[] {
  const plan = planTown(g, opts(owned));
  const took: PlanStep[] = [];
  for (let k = 0; k < 200; k++) {
    const s = nextStep(g, plan, wants(owned));
    if (!s) break;
    took.push(s);
    if (s.kind === "road") {
      for (let y = Math.min(s.from.y, s.to.y); y <= Math.max(s.from.y, s.to.y); y++)
        for (let x = Math.min(s.from.x, s.to.x); x <= Math.max(s.from.x, s.to.x); x++) g.paved[idx(g, x, y)] = 1;
    } else if (s.kind === "level") {
      const cells = [];
      for (let x = s.from.x; x <= s.to.x; x++) for (let y = s.from.y; y <= s.to.y; y++) cells.push({ x, y });
      for (const w of heightWrites(g, cells, "flatten")) g.height[idx(g, w.x, w.y)] = w.value;
    } else if (s.kind === "lift") {
      g.paved[idx(g, s.at.x, s.at.y)] = 0;
    } else if (s.kind === "clear") {
      commit(g, createHistory(), demolishCommand(g, structureAt(g, s.at.x, s.at.y))!);
    }
  }
  return took;
}

describe("AI mode terraforms", () => {
  test("a street over a spike is levelled first, to what the flatten tool makes of it", () => {
    const g = town();
    g.height[idx(g, 5, 15)] = 6;
    const plan = planTown(g, opts());
    const lv = plan.steps.find((s) => s.kind === "level");
    expect(lv).toEqual({ kind: "level", from: { x: 3, y: 15 }, to: { x: 5, y: 15 }, z: 0 });
    const took = build(g);
    const k = took.findIndex((s) => s.kind === "level");
    const road = took.findIndex((s) => s.kind === "road" && s.from.y === 15 && s.from.x === 3);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(road).toBeGreaterThan(k);
    expect(g.height[idx(g, 5, 15)]).toBe(0);
    expect(isPaved(g, 5, 15)).toBe(true);
  });

  test("never levels ground under a building put on the line since", () => {
    const g = town();
    // The spike first along the piece, the building after it.
    g.height[idx(g, 3, 15)] = 6;
    const plan = planTown(g, opts());
    // A lot put down on the line after the plan was made.
    g.paved[idx(g, 4, 14)] = 1;
    commit(g, createHistory(), placeCommand(g, structureDef("kit:intern.t0")!, 4, 15, { needsRoad: true })!);
    for (let k = 0; k < 60; k++) {
      const s = nextStep(g, plan, wants());
      if (!s) break;
      expect(s.kind).not.toBe("level");
      if (s.kind === "road") for (let y = s.from.y; y <= s.to.y; y++) for (let x = s.from.x; x <= s.to.x; x++) g.paved[idx(g, x, y)] = 1;
    }
    expect(g.height[idx(g, 4, 15)]).toBe(0);
  });

  test("leaves a cliff it cannot level", () => {
    const g = town();
    // A whole band of row 15's ground two slabs up: no piece levels into its neighbours.
    for (let x = 0; x < 24; x++) for (let y = 14; y < 24; y++) g.height[idx(g, x, y)] = 0;
    for (let x = 0; x < 24; x++) g.height[idx(g, x, 15)] = 8;
    expect(kinds(planTown(g, opts()).steps)).not.toContain("level");
  });
});

describe("AI mode rebuilds", () => {
  test("lifts a short spur that goes nowhere, from its dead end", () => {
    const g = town();
    g.paved[idx(g, 7, 13)] = 1;
    g.paved[idx(g, 7, 14)] = 1;
    const lifts = planTown(g, opts()).steps.filter((s) => s.kind === "lift");
    expect(lifts).toEqual([{ kind: "lift", at: { x: 7, y: 14 } }, { kind: "lift", at: { x: 7, y: 13 } }]);
    const took = build(g);
    expect(took.slice(0, 2)).toEqual(lifts);
    expect(isPaved(g, 7, 13) || isPaved(g, 7, 14)).toBe(false);
    expect(isPaved(g, 7, 12)).toBe(true);
  });

  test("keeps a spur with something beside it, or one too long to be a mistake", () => {
    const g = town();
    for (let y = 13; y <= 16; y++) g.paved[idx(g, 7, y)] = 1;
    g.paved[idx(g, 13, 13)] = 1;
    commit(g, createHistory(), placeCommand(g, structureDef("kit:intern.t0")!, 14, 13, { needsRoad: true })!);
    expect(kinds(planTown(g, opts()).steps)).not.toContain("lift");
  });

  test("clears a cheap house standing in the only way through, and lays the street", () => {
    const g = town();
    // Only columns 6 to 12 owned: the pattern's in phase with the first road
    // owned, (6, 12), so its connector at x 6 is the one way south.
    const owned = (x: number, y: number) => x >= 6 && x <= 12 && y >= 10;
    commit(g, createHistory(), placeCommand(g, structureDef("kit:intern.t0")!, 6, 13, { needsRoad: true })!);
    const plan = planTown(g, opts(owned));
    expect(plan.steps.filter((s) => s.kind === "clear")).toEqual([{ kind: "clear", at: { x: 6, y: 13 } }]);
    const took = build(g, owned);
    expect(took).toContainEqual({ kind: "clear", at: { x: 6, y: 13 } });
    expect(isPaved(g, 6, 13) && isPaved(g, 6, 15) && isPaved(g, 9, 15)).toBe(true);
  });

  test("leaves a house whose street would open little", () => {
    const g = town();
    commit(g, createHistory(), placeCommand(g, structureDef("kit:intern.t0")!, 10, 13, { needsRoad: true })!);
    expect(kinds(planTown(g, opts()).steps)).not.toContain("clear");
  });
});

import { describe, expect, test } from "bun:test";

import { GRASS, getNetwork, useWorldStore } from "../../state/world.store";
import { createGrid, fillTerrain, idx } from "../grid";
import { isConnected } from "../roads/network";
import { districtSize, layoutDistrict } from "./layout";
import { placeDistrictNow } from "./place";
import { findDistrictSite } from "./site";

const s = () => useWorldStore.getState();

describe("placeDistrictNow", () => {
  test("a district joined to the town, all of it built, lived in and off the undo history", () => {
    const g = createGrid(64, 64);
    fillTerrain(g, GRASS);
    // The town's one road, along the top.
    for (let x = 0; x < 64; x++) g.paved[idx(g, x, 2)] = 1;
    s().loadGrid(g);
    const spec = { across: 2, strips: 2, houses: ["kit:intern.t1"], desks: true };
    const { w, h } = districtSize(spec);
    const site = findDistrictSite(s().grid, w, h, { near: { x: 32, y: 40 } })!;
    expect(site.connector).not.toBeNull();
    const plan = layoutDistrict(s().grid, site.x0, site.y0, spec);
    const placed = placeDistrictNow(plan, site.connector);
    expect(placed.refused).toEqual([]);
    expect(placed.ids.length).toBe(plan.buildings.length);
    const grid = s().grid;
    for (const id of placed.ids) {
      const b = grid.structures.get(id)!;
      expect(b.build).toBeUndefined();
      expect(b.residents).toBeUndefined();
    }
    for (const c of plan.roads) expect(grid.paved[idx(grid, c.x, c.y)]).not.toBe(0);
    // The far corner of its ring reaches the town's road.
    expect(isConnected(getNetwork()!, grid, { x: plan.x0 + w - 1, y: plan.y0 + h - 1 }, { x: 0, y: 2 })).toBe(true);
    expect(s().undoDepth).toBe(0);
  });
});

describe("foundHeadStarts", () => {
  test("a bought head start: its district laid, its people hired and at home, none counted away", async () => {
    const { foundHeadStarts } = await import("./head-start");
    const { useGenerationStore } = await import("../../state/generation.store");
    const { useGeneratorStore } = await import("../../state/generators.store");
    const { useSessionStore } = await import("../../state/session.store");
    const { settleHousing } = await import("../agents/arrivals");
    const { residentsIn } = await import("../../game/housing");
    const g = createGrid(64, 64);
    fillTerrain(g, GRASS);
    for (let x = 0; x < 64; x++) g.paved[idx(g, x, 2)] = 1;
    s().loadGrid(g);
    useGenerationStore.setState({ machine: ["machine_h_suburb"] });
    useSessionStore.setState({ remoteBeds: null } as never);
    const interns = () => useGeneratorStore.getState().generators.find((x) => x.id === "intern")?.amount ?? 0;
    const before = interns();
    foundHeadStarts();
    const houses = [...s().grid.structures.values()].filter((b) => b.def === "kit:intern.t1");
    expect(houses.length).toBe(30);
    expect(interns() - before).toBe(150);
    // Settled as the game settles a map: everyone the district houses stays in it.
    settleHousing(s().grid, { intern: interns() }, useSessionStore.getState().remoteBeds ?? {});
    expect(houses.reduce((n, b) => n + residentsIn(b), 0)).toBeGreaterThanOrEqual(150 - 2);
    useGenerationStore.setState({ machine: [] });
  });
});

import { describe, expect, test } from "bun:test";

import { DIRT, GRASS, SAND, WOODS } from "../../state/world.store";
import { generatePlayableMap } from "../gen/generate-map";
import { DEFAULT_GEN } from "../gen/params";
import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import { validatePlacement } from "../structures/place";
import { deskBalance, districtSize, layoutDistrict, type DistrictSpec } from "./layout";
import { routeRoad, runsOf } from "./route";
import { findDistrictSite } from "./site";

const flat = (n = 48): Grid => { const g = createGrid(n, n); fillTerrain(g, GRASS); return g; };
const SUBURB: DistrictSpec = { across: 2, strips: 3, houses: ["kit:intern.t1", "kit:vibe_coder.t1"], desks: true, services: ["cafe"] };

/** The plan's roads laid on a copy, so its buildings can be checked against them. */
function withRoads(g: Grid, roads: { x: number; y: number }[]): Grid {
  const c = createGrid(g.w, g.h);
  c.terrain.set(g.terrain); c.height.set(g.height); c.pool.set(g.pool);
  for (const r of roads) c.paved[idx(c, r.x, r.y)] = 1;
  return c;
}

describe("routeRoad", () => {
  test("goes round what is in the way, in straight runs", () => {
    const g = flat(20);
    for (let x = 0; x < 20; x++) g.paved[idx(g, x, 0)] = 1;
    // A pond between the start and the road.
    for (let x = 4; x < 12; x++) g.pool[idx(g, x, 5)] = 3;
    const path = routeRoad(g, [{ x: 8, y: 10 }])!;
    expect(path[0]).toEqual({ x: 8, y: 10 });
    expect(g.paved[idx(g, path.at(-1)!.x, path.at(-1)!.y)]).not.toBe(0);
    expect(path.some((c) => g.pool[idx(g, c.x, c.y)] > 0)).toBe(false);
    // Round the pond's end and straight up: three runs, not a staircase.
    expect(runsOf(path).length).toBeLessThanOrEqual(3);
  });
  test("none when walled off", () => {
    const g = flat(10);
    g.paved[idx(g, 0, 0)] = 1;
    for (let x = 0; x < 10; x++) g.pool[idx(g, x, 4)] = 3;
    expect(routeRoad(g, [{ x: 5, y: 8 }])).toBeNull();
  });
});

describe("layoutDistrict", () => {
  const g = flat();
  const plan = layoutDistrict(g, 4, 4, SUBURB);
  const laid = withRoads(g, plan.roads);
  test("a ring and streets, its size as asked", () => {
    const { w, h } = districtSize(SUBURB);
    expect([plan.w, plan.h]).toEqual([w, h]);
    for (let x = 4; x < 4 + w; x++) { expect(laid.paved[idx(laid, x, 4)]).not.toBe(0); expect(laid.paved[idx(laid, x, 4 + h - 1)]).not.toBe(0); }
    // Every road tile is in a run.
    const inRuns = new Set<string>();
    for (const r of plan.runs) for (let y = r.from.y; y <= r.to.y; y++) for (let x = r.from.x; x <= r.to.x; x++) inRuns.add(`${x},${y}`);
    for (const c of plan.roads) expect(inRuns.has(`${c.x},${c.y}`)).toBe(true);
  });
  test("a square, filled: every lot built, fronting a road, none overlapping", () => {
    const taken = new Set<string>();
    for (const b of plan.buildings) {
      const d = structureDef(b.def)!;
      expect(validatePlacement(laid, d, b.x, b.y, { needsRoad: true }).ok).toBe(true);
      for (let dy = 0; dy < d.footprint.h; dy++) for (let dx = 0; dx < d.footprint.w; dx++) {
        const k = `${b.x + dx},${b.y + dy}`;
        expect(taken.has(k)).toBe(false);
        taken.add(k);
      }
    }
    // Inside the ring, every tile is a road, a building, or kept open for a sewer connection.
    const roads = new Set([...plan.roads, ...plan.open].map((c) => `${c.x},${c.y}`));
    for (let y = plan.y0; y < plan.y0 + plan.h; y++) for (let x = plan.x0; x < plan.x0 + plan.w; x++) expect(roads.has(`${x},${y}`) || taken.has(`${x},${y}`)).toBe(true);
  });
  test("a vibe office's slop comes out on open ground", () => {
    const p = layoutDistrict(g, 4, 4, { across: 2, strips: 2, houses: ["kit:vibe_coder.t1"], desks: true });
    const offices = p.buildings.filter((b) => b.def === "office-vibe");
    expect(offices.length).toBeGreaterThan(0);
    const open = new Set(p.open.map((c) => `${c.x},${c.y}`));
    // S is +x: the port is beside the office's east side, a row down.
    for (const o of offices) expect(open.has(`${o.x + 2},${o.y + 1}`)).toBe(true);
    expect(p.open.length).toBe(offices.length);
  });
  test("desks for the beds, not more: within an office of them", () => {
    for (const k of deskBalance(plan.buildings)) {
      expect(k.desks).toBeGreaterThanOrEqual(k.beds);
      expect(k.desks - k.beds).toBeLessThan(40);
    }
    expect(plan.buildings.filter((b) => b.def === "cafe").length).toBe(1);
  });
  test("a centre in the middle, the street under it cut", () => {
    const p = layoutDistrict(g, 4, 4, { ...SUBURB, centre: "studio" });
    expect(p.buildings[0].def).toBe("studio");
    const s = p.buildings[0];
    expect(p.roads.some((c) => c.x >= s.x && c.x < s.x + 4 && c.y >= s.y && c.y < s.y + 4)).toBe(false);
    // The studio's desks count for the vibe coders.
    const vibe = deskBalance(p.buildings).find((k) => k.kind === "vibe_coder")!;
    expect(vibe.desks).toBeGreaterThanOrEqual(vibe.beds);
  });
  test("what the ground will not take is left out", () => {
    const wet = flat();
    for (let y = 0; y < 48; y++) wet.pool[idx(wet, 12, y)] = 2;
    const p = layoutDistrict(wet, 4, 4, SUBURB);
    expect(p.buildings.some((b) => b.x <= 12 && b.x + structureDef(b.def)!.footprint.w > 12)).toBe(false);
  });
});

describe("findDistrictSite", () => {
  test("on a generated map: dry, bare, joined to the roads", () => {
    for (const seed of [1, 7, 42]) {
      const g = createGrid(96, 96);
      generatePlayableMap(g, { seed, material: GRASS, dirt: DIRT, sand: SAND, woods: WOODS, params: { ...DEFAULT_GEN, size: 96 } });
      const { w, h } = districtSize(SUBURB);
      const site = findDistrictSite(g, w, h, { maxRelief: 8 });
      expect(site).not.toBeNull();
      for (let y = site!.y0; y < site!.y0 + h; y++) for (let x = site!.x0; x < site!.x0 + w; x++) {
        const i = idx(g, x, y);
        expect(g.pool[i]).toBe(0);
        expect(g.paved[i]).toBe(0);
      }
      const plan = layoutDistrict(g, site!.x0, site!.y0, SUBURB);
      // Most of it built on, whatever the ground.
      expect(plan.buildings.length).toBeGreaterThan(20);
    }
  });
  test("none when nothing fits", () => {
    expect(findDistrictSite(flat(10), 30, 30)).toBeNull();
  });
});

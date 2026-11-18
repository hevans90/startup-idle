import { describe, expect, test } from "bun:test";

import { PLANT_LOADER_COLOUR, PLANT_LOADER_EMPTY_COLOUR, halfLength } from "../agents/cars/fleet";
import { createTown, stepTown } from "../agents/town";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { LINE_PLANT, newLine } from "../lines/jobs";
import { lineHead } from "../lines/line-loads";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { SITE_PLANT } from "../structures/projects/groundworks";
import { stepYard } from "./fleet";
import { stepPlant, type Plant } from "./plant";

describe("a job whose low-loaders do not wait", () => {
  test("each sets its machine down and goes home bare, and comes back for it when the job is done — one at a time", () => {
    const g = createGrid(40, 30);
    fillTerrain(g, 1);
    for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
    commit(g, createHistory(), placeCommand(g, structureDef("garage")!, 2, 2)!);
    const net = createNetwork(g), town = createTown(), haul = { net, town };
    // (A road tile to come to: found as a line's is.)
    const head = lineHead(g, net, newLine(1, "main", Array.from({ length: 4 }, (_, k) => ({ x: 20 + k, y: 8 })), null, 600, 0))!;
    const host: { plant?: false | Plant } = {};
    const seen: string[] = [];
    let worked = 0, bareOut = 0, bareHome = 0, loadedHome = 0, standing = 0, through = Infinity;
    const counted = new Set<number>();
    for (let t = 0; t < 600; t += 1 / 30) {
      stepYard(town, g, 1 / 30);
      const at = stepPlant(g, haul, host, { id: 7, role: "site-plant" }, head, SITE_PLANT, false, 1 / 30, false, 4);
      if (seen[seen.length - 1] !== at) seen.push(at);
      const p = host.plant as Plant;
      if (at === "work" && ++worked > 30 * 12 && p.leaving === undefined) { p.leaving = 0; p.t = 0; }
      for (const m of town.movers) {
        if (counted.has(m.id * 4 + (m.job?.role === "haul-back" ? 1 : 0))) continue;
        counted.add(m.id * 4 + (m.job?.role === "haul-back" ? 1 : 0));
        if (m.colour === PLANT_LOADER_EMPTY_COLOUR && m.job?.role === "haul-back") bareHome++;
        if (m.colour === PLANT_LOADER_EMPTY_COLOUR && m.job?.role === "site-plant") bareOut++;
        if (m.colour === PLANT_LOADER_COLOUR && m.job?.role === "haul-back") loadedHome++;
      }
      // (On the road, one behind another: never one through another.)
      const lorries = [...town.movers.filter((m) => m.kind === "truck"), ...town.legs.map((l) => l.m)];
      for (let a = 0; a < lorries.length; a++) for (let b = a + 1; b < lorries.length; b++) {
        const A = lorries[a], B = lorries[b];
        if (Math.cos(A.heading - B.heading) < 0.9) continue;
        const dx = B.x - A.x, dy = B.y - A.y, across = Math.abs(dx * Math.sin(A.heading) - dy * Math.cos(A.heading));
        if (across < 0.2) through = Math.min(through, Math.hypot(dx, dy) - halfLength(A) - halfLength(B));
      }
      // (Come back, never two stood at the road together.)
      const taken = 2 - (p.home?.filter((q) => q === "loader").length ?? 2);
      standing = Math.max(standing, (p.back?.length ?? 0) - taken);
      if (at === "gone") break;
      town.arrived.length = 0;
      stepTown(town, g, net, 0, 1 / 30);
    }
    expect(seen).toEqual(["wait", "work", "leaving", "gone"]);
    const p = host.plant as Plant;
    expect(p.lows?.length).toBe(2);
    expect(p.lows?.every((l) => l.gone)).toBe(true);
    expect(bareHome).toBe(2);
    expect(bareOut).toBe(2);
    expect(loadedHome).toBe(2);
    expect(standing).toBe(1);
    expect(through).toBeGreaterThan(-0.05);
  });

  test("a line's machines — crane, mixer, low-loaders, pickup — go out and come home one behind another, never one through another", () => {
    const g = createGrid(40, 30);
    fillTerrain(g, 1);
    for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
    commit(g, createHistory(), placeCommand(g, structureDef("garage")!, 2, 2)!);
    const net = createNetwork(g), town = createTown(), haul = { net, town };
    const head = lineHead(g, net, newLine(1, "main", Array.from({ length: 4 }, (_, k) => ({ x: 20 + k, y: 8 })), null, 600, 0))!;
    const host: { plant?: false | Plant } = {};
    let worked = 0, through = Infinity, at = "";
    for (let t = 0; t < 600 && at !== "gone"; t += 1 / 30) {
      stepYard(town, g, 1 / 30);
      at = stepPlant(g, haul, host, { id: 9, role: "plant" }, head, LINE_PLANT.main, false, 1 / 30);
      const p = host.plant as Plant;
      if (at === "work" && ++worked > 30 * 5 && p.leaving === undefined) { p.leaving = 0; p.t = 0; }
      const lorries = [...town.movers.filter((m) => m.kind === "truck"), ...town.legs.map((l) => l.m)];
      for (let a = 0; a < lorries.length; a++) for (let b = a + 1; b < lorries.length; b++) {
        const A = lorries[a], B = lorries[b];
        if (Math.cos(A.heading - B.heading) < 0.9) continue;
        const dx = B.x - A.x, dy = B.y - A.y, across = Math.abs(dx * Math.sin(A.heading) - dy * Math.cos(A.heading));
        if (across < 0.2) through = Math.min(through, Math.hypot(dx, dy) - halfLength(A) - halfLength(B));
      }
      town.arrived.length = 0;
      stepTown(town, g, net, 0, 1 / 30);
    }
    expect(at).toBe("gone");
    expect(through).toBeGreaterThan(-0.05);
  });
});

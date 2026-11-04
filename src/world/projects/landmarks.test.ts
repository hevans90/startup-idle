import { describe, expect, test } from "bun:test";

import { LANDMARKS, PROJECTS, projectDef, tierBelow, tiersIn } from "../../game/projects";
import { housingCapacity } from "../../game/housing";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { builtProjects, siteOf, startUpgradeCommand, upgradeFrom } from "./works";

/** A road along row 5, and a building north of it. */
function street(def: string, w?: number, h?: number) {
  const g = createGrid(20, 12);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  const d = structureDef(def)!;
  const shaped = w ? { ...d, footprint: { w, h: h! } } : d;
  commit(g, createHistory(), placeCommand(g, shaped, 6, 5 - shaped.footprint.h)!);
  return { g, s: [...g.structures.values()][0] };
}

describe("landmarks", () => {
  test("every project is a tier or a wing of one landmark, and a line's tiers share a footprint", () => {
    for (const p of PROJECTS) expect(LANDMARKS.filter((l) => l.tiers.includes(p.id) || l.wings?.includes(p.id)).length).toBe(1);
    for (const l of LANDMARKS) {
      const sizes = new Set(l.tiers.map((id) => JSON.stringify(structureDef(projectDef(id)!.structure)!.footprint)));
      expect(sizes.size).toBe(1);
    }
    expect(tierBelow("boardroom")?.id).toBe("hq");
    expect(tierBelow("garage")).toBeNull();
    expect(tierBelow("refinery")).toBeNull();
    expect(tiersIn("boardroom")).toEqual(["garage", "hq", "boardroom"]);
  });

  test("a tier rises where its landmark stands: same id, the tiers under it still built, its own once it opens", () => {
    const { g, s } = street("garage");
    const hq = projectDef("hq")!;
    expect(upgradeFrom(g, hq)?.id).toBe(s.id);
    commit(g, createHistory(), startUpgradeCommand(g, hq, { needsRoad: true }, 0)!);
    const site = siteOf(g, hq)!;
    expect(site.id).toBe(s.id);
    expect([site.x, site.y]).toEqual([s.x, s.y]);
    expect(g.structures.size).toBe(1);
    expect([...builtProjects(g)]).toEqual(["garage"]);
    delete site.build;
    expect([...builtProjects(g)].sort()).toEqual(["garage", "hq"]);
    // Nothing to rise from for a first tier, nor for a tier two above what stands.
    expect(upgradeFrom(g, projectDef("garage")!)).toBeNull();
    expect(upgradeFrom(g, projectDef("ipo")!)).toBeNull();
    expect(upgradeFrom(g, projectDef("boardroom")!)?.id).toBe(s.id);
  });

  test("a smaller first tier from an older save grows out into the next tier's footprint", () => {
    const { g, s } = street("garage", 2, 1);
    const cmd = startUpgradeCommand(g, projectDef("hq")!, { needsRoad: true }, 0)!;
    commit(g, createHistory(), cmd);
    const up = g.structures.get(s.id)!;
    expect([up.w, up.h]).toEqual([3, 3]);
    expect(up.y + up.h).toBe(s.y + s.h);
    expect(up.x <= s.x && up.x + up.w >= s.x + s.w).toBe(true);
  });

  test("the Agency is the 10x devs' home as the Campus was, and a Campus going up houses nobody", () => {
    const { g } = street("campus");
    const beds = housingCapacity(g)["10x_dev"];
    commit(g, createHistory(), startUpgradeCommand(g, projectDef("agency")!, {}, 0)!);
    expect(housingCapacity(g)["10x_dev"]).toBe(0);
    delete siteOf(g, projectDef("agency")!)!.build;
    expect(housingCapacity(g)["10x_dev"]).toBe(beds);
  });
});

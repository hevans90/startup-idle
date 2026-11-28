/**
 * World v2 editor — THE FIXTURES, AS THE TOOL BAR LISTS THEM: every one, by what it is for. @see fixtures, ToolDock
 */
import type { FixtureId } from "./fixtures";

export type FixtureKind = "Towns" | "Water" | "Harbours" | "Roads" | "Land" | "Works";

export const FIXTURES: Record<FixtureKind, readonly [FixtureId, string][]> = {
  Towns: [
    ["bigtown", "Big town"], ["singularity", "Singularity"], ["ascension", "Ascension"], ["shops", "Shops"],
    ["traffic", "Traffic"], ["streets", "Streets"], ["projects", "Projects"], ["demolition", "Demolition"],
  ],
  Water: [
    ["waterfall", "Waterfall"], ["cascade", "Cascade"], ["plunge", "Plunge"], ["lake", "Lake"], ["islands", "Islands"], ["river", "River"],
    ["inlet", "Inlet"], ["crossing", "Crossing"], ["bridge", "Bridge"], ["spill", "Spill"], ["brink", "Brink"],
  ],
  Harbours: [["waterfront", "Waterfront"], ["harbour", "Harbour"], ["shoal", "Shoal"], ["ports", "Ports"], ["cranes", "Cranes"]],
  Roads: [
    ["junctions", "Junctions"], ["avenue", "Avenue"], ["roadShapes", "Road shapes"], ["plaza", "Plaza"], ["hills", "Hills"],
    ["rampFan", "Ramp fan"], ["firstRoad", "First road"],
  ],
  Land: [
    ["flat", "Flat"], ["terrain", "Terrain"], ["ground", "Ground"], ["rough", "Rough"], ["farms", "Farms"], ["flood", "Flood"], ["harvest", "Harvest"], ["wildfire", "Wildfire"],
    ["ziggurat", "Ziggurat"], ["occluder", "Occluder"], ["splitTrap", "Split trap"],
  ],
  Works: [["sewers", "Sewers"], ["pipeyard", "Pipe yard"], ["glass", "Pipe glass"]],
};

/**
 * The address a fixture is at, or with none the editor's own map. Opened there and not laid over the map in hand: a
 * fixture has its own size and company, outlives a reload, and is never saved over the map somebody built.
 * @see startedOnFixture
 */
export function fixtureAddress(href: string, id: FixtureId | null): string {
  const u = new URL(href);
  if (id) u.searchParams.set("fixture", id); else u.searchParams.delete("fixture");
  return u.href;
}

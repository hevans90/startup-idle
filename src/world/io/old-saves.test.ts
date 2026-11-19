import { describe, expect, test } from "bun:test";

import { applyFixture, type FixtureId } from "../debug/fixtures";
import { createGrid, fillTerrain, idx, rampAt, setHeight, type Grid } from "../grid";
import { useWorldStore } from "../../state/world.store";
import { setGroundMode } from "../render/ground-mode";
import { connects } from "../roads/mask";
import { componentCount, createNetwork } from "../roads/network";
import { deserializeWorld, serializeWorld } from "./serialize";

/**
 * A SAVE FROM THE STEPPED GROUND opens on the continuous surface, the game's ground since 2026-11-19: its roads, laid
 * with ramps between the steps, are the same network, every two side by side still joined. @see render/ground-mode
 */
const PAL = { terrain: [null, "grass.png", "dirt.png", "sand.png"], paved: [null, "road.png"] };
/** Built on the stepped ground, as an old save was, and written out. */
function oldSave(id: FixtureId): string {
  setGroundMode("steps");
  try {
    const g = createGrid(64, 64, 1);
    applyFixture(g, id, 1);
    return JSON.stringify(serializeWorld(g, PAL));
  } finally { setGroundMode("smooth"); }
}
const ramps = (g: Grid) => { let n = 0; for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (rampAt(g, x, y)) n++; return n; };
/** Two road tiles side by side that do not join. */
function parted(g: Grid): number {
  let n = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (!g.paved[y * g.w + x]) continue;
    if (x + 1 < g.w && g.paved[y * g.w + x + 1] && !connects(g, x, y, "S")) n++;
    if (y + 1 < g.h && g.paved[(y + 1) * g.w + x] && !connects(g, x, y, "W")) n++;
  }
  return n;
}

describe("a save from the stepped ground", () => {
  test("a road up a staircase, ramped as the stepped ground ramped it: the ramps kept, one road still", () => {
    setGroundMode("steps");
    const st = () => useWorldStore.getState();
    let file: string;
    try {
      st().resize(24, 12);
      const g0 = st().grid;
      fillTerrain(g0, 1);
      for (let y = 0; y < 12; y++) for (let x = 0; x < 24; x++) setHeight(g0, x, y, Math.max(0, Math.min(8, Math.floor((x - 6) / 2) * 2)));
      st().loadGrid(g0);
      useWorldStore.setState({ playing: false, roadWorks: false });
      st().setTool("paintRoad"); st().setBrush("line");
      st().beginStroke({ x: 2, y: 5 }); st().updateStroke({ x: 21, y: 5 }); st().endStroke();
      file = JSON.stringify(serializeWorld(st().grid, PAL));
    } finally { setGroundMode("smooth"); }
    const g = deserializeWorld(JSON.parse(file)).grid;
    expect(ramps(g)).toBeGreaterThan(2);
    expect(componentCount(createNetwork(g))).toBe(1);
    expect(parted(g)).toBe(0);
    expect(g.paved[idx(g, 21, 5)]).toBeTruthy();
  });

  for (const id of ["hills", "junctions", "streets", "traffic"] as const) {
    test(`${id}: its roads are one network as they were, none parted`, () => {
      const file = oldSave(id);
      setGroundMode("steps");
      const before = deserializeWorld(JSON.parse(file)).grid;
      const was = { nets: componentCount(createNetwork(before)), parted: parted(before) };
      setGroundMode("smooth");
      const g = deserializeWorld(JSON.parse(file)).grid;
      expect(componentCount(createNetwork(g))).toBeLessThanOrEqual(was.nets);
      expect(parted(g)).toBeLessThanOrEqual(was.parted);
    });
  }
});

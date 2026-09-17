/**
 * The renderer registry and the mounted-structure layer.
 *
 * Textures are stand-ins with real frame sizes — what matters here is the
 * LIFECYCLE (mount once, unmount on demolish, re-draw when the ground moves)
 * and which band tier a sprite lands in, neither of which needs real art.
 */
import { describe, expect, test } from "bun:test";
import { Texture } from "pixi.js";

import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight, structureOf } from "../grid";
import { bandOf } from "../iso";
import { createBandLayer } from "../render/bands";
import { hidesTerrain } from "../render/terrain";
import { kitByName, registerStructureDef, structureDef, type StructureDef } from "./def";
import {
  clearStructureLayer, createStructureLayer, mountedCount, refreshStructuresAt,
  syncStructures,
} from "./layer";
import { rendererFor, type RenderCtx } from "./render";
import { tileSpriteCount } from "./tiles-renderer";
import { placeCommand, demolishCommand } from "./place";

const KIT = structureDef("kit:intern.t0")!;
/**
 * A big footprint that clears its ground. The slop pit used to be this; it is a
 * POOL now, so the tests that need a multi-cell clearing structure register
 * their own rather than depending on whatever content happens to ship.
 */
const PIT: StructureDef = {
  id: "test:yard",
  name: "yard",
  footprint: { w: 5, h: 5 },
  render: { kind: "custom", rendererId: "none" },
  clearsTerrain: true,
};
registerStructureDef(PIT);

/** Every frame any kit names, as a stand-in with a plausible ground size. */
const TEX: Record<string, Texture> = {};
for (const id of ["intern.t0", "intern.t1", "intern.t2", "10x_dev.t2", "intern.landmark"]) {
  const kit = kitByName(id);
  if (!kit) continue;
  for (const f of [kit.ground, kit.roof, ...kit.mids, ...kit.rooftopProps]) {
    if (f) TEX[f] = TEX[f] ?? new Texture({
      source: Texture.EMPTY.source,
      frame: { x: 0, y: 0, width: 132, height: 99 } as never,
    });
  }
}

const setup = (w = 12, h = 12) => {
  const grid = createGrid(w, h);
  fillTerrain(grid, 1);
  const bands = createBandLayer(w, h);
  const sl = createStructureLayer();
  const ctx: RenderCtx = { bands, textures: TEX, grid, scale: 1 };
  return { grid, bands, sl, ctx, hist: createHistory() };
};

describe("the registry", () => {
  test("resolves a def to the strategy its render.kind names", () => {
    expect(rendererFor(KIT)).not.toBeNull();
  });

  test("an unregistered strategy is NULL, not a throw", () => {
    // A map may name a structure whose renderer has not shipped; refusing to
    // draw one building beats refusing to draw the world.
    const odd: StructureDef = {
      id: "test:odd", name: "odd", footprint: { w: 1, h: 1 },
      render: { kind: "custom", rendererId: "not-registered" },
    };
    expect(rendererFor(odd)).toBeNull();
  });
});

describe("the tiles strategy", () => {
  test("mounts a stack into its cell's STRUCTURE tier, above ground and road", () => {
    const { grid, bands, sl, ctx, hist } = setup();
    commit(grid, hist, placeCommand(grid, KIT, 4, 4)!);
    syncStructures(sl, ctx);
    expect(mountedCount(sl)).toBe(1);
    const tier = bands.structureOf[bandOf(4, 4)];
    expect(tier.children.length).toBeGreaterThan(0);
    // the tier itself must sit above the ground and the roads in its band
    const band = bands.bands[bandOf(4, 4)];
    expect(band.getChildIndex(tier)).toBeGreaterThan(band.getChildIndex(bands.pavedOf[bandOf(4, 4)]));
  });

  test("a stack is ordered ground-first, so insertion order alone draws it", () => {
    const { grid, sl, ctx, hist } = setup();
    commit(grid, hist, placeCommand(grid, KIT, 4, 4)!);
    syncStructures(sl, ctx);
    const sprites = [...sl.mounted.values()][0];
    const ys = (sprites.handle as { sprites: { y: number }[] }).sprites.map((s) => s.y);
    // each part lifts by the kit's `lift`, so screen y descends through the stack
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThanOrEqual(ys[i - 1]);
  });

  test("the stack sits on the ground it was placed on", () => {
    const a = setup();
    commit(a.grid, a.hist, placeCommand(a.grid, KIT, 4, 4)!);
    syncStructures(a.sl, a.ctx);
    const low = firstSpriteY(a.sl);

    const b = setup();
    setHeight(b.grid, 4, 4, 2);                       // one full step up
    commit(b.grid, b.hist, placeCommand(b.grid, KIT, 4, 4)!);
    syncStructures(b.sl, b.ctx);
    expect(firstSpriteY(b.sl)).toBeLessThan(low);     // higher ground, higher sprite
  });

  test("a kit naming a missing frame drops that part, not the building", () => {
    const { grid, sl, hist, bands } = setup();
    const ctx: RenderCtx = { bands, textures: {}, grid, scale: 1 };
    commit(grid, hist, placeCommand(grid, KIT, 4, 4)!);
    syncStructures(sl, ctx);
    expect(mountedCount(sl)).toBe(1);
    expect(tileSpriteCount([...sl.mounted.values()][0].handle)).toBe(0);
  });

  test("a multi-cell footprint draws a column PER CELL, each in its own band", () => {
    const { grid, bands, sl, ctx, hist } = setup();
    // Registered, not just constructed: the renderer resolves a record's def
    // by ID, so an object nothing can look up would place but never draw.
    const wide: StructureDef = { ...KIT, id: "test:wide", footprint: { w: 2, h: 1 } };
    registerStructureDef(wide);
    commit(grid, hist, placeCommand(grid, wide, 4, 4)!);
    syncStructures(sl, ctx);
    expect(bands.structureOf[bandOf(4, 4)].children.length).toBeGreaterThan(0);
    expect(bands.structureOf[bandOf(5, 4)].children.length).toBeGreaterThan(0);
  });
});

describe("the layer's lifecycle", () => {
  test("mounts each record exactly once, however often it syncs", () => {
    const { grid, bands, sl, ctx, hist } = setup();
    commit(grid, hist, placeCommand(grid, KIT, 4, 4)!);
    const n = (() => { syncStructures(sl, ctx); return bands.structureOf[bandOf(4, 4)].children.length; })();
    syncStructures(sl, ctx);
    syncStructures(sl, ctx);
    expect(bands.structureOf[bandOf(4, 4)].children.length).toBe(n);
    expect(mountedCount(sl)).toBe(1);
  });

  test("unmounts and destroys the sprites when a structure is demolished", () => {
    const { grid, bands, sl, ctx, hist } = setup();
    commit(grid, hist, placeCommand(grid, KIT, 4, 4)!);
    syncStructures(sl, ctx);
    const id = structureOf(grid, 4, 4)!.id;
    commit(grid, hist, demolishCommand(grid, id)!);
    syncStructures(sl, ctx);
    expect(mountedCount(sl)).toBe(0);
    expect(bands.structureOf[bandOf(4, 4)].children.length).toBe(0);
  });

  test("a def with no renderer is COUNTED, not silently absent", () => {
    const { grid, sl, ctx } = setup();
    grid.structures.set(9, { id: 9, def: "nope", x: 1, y: 1, w: 1, h: 1 });
    syncStructures(sl, ctx);
    expect(mountedCount(sl)).toBe(0);
    expect(sl.unrenderable).toBe(1);
  });

  test("refresh re-draws only the structures standing on the dirty cells", () => {
    const { grid, sl, ctx, hist } = setup();
    commit(grid, hist, placeCommand(grid, KIT, 4, 4)!);
    commit(grid, hist, placeCommand(grid, KIT, 8, 8)!);
    syncStructures(sl, ctx);
    const before = firstSpriteY(sl);

    // the ground under (4,4) drops; the other building must not move
    grid.height[idx(grid, 4, 4)] = -2;
    refreshStructuresAt(sl, ctx, [{ x: 4, y: 4 }]);
    expect(firstSpriteY(sl)).toBeGreaterThan(before);
  });

  test("clearing the layer unmounts everything", () => {
    const { grid, bands, sl, ctx, hist } = setup();
    commit(grid, hist, placeCommand(grid, KIT, 4, 4)!);
    syncStructures(sl, ctx);
    clearStructureLayer(sl);
    expect(mountedCount(sl)).toBe(0);
    expect(bands.structureOf[bandOf(4, 4)].children.length).toBe(0);
  });
});

describe("clearsTerrain", () => {
  test("hides the ground under an excavation and nowhere else", () => {
    const { grid, hist } = setup();
    commit(grid, hist, placeCommand(grid, PIT, 3, 3)!);
    expect(hidesTerrain(grid, 5, 5)).toBe(true);
    expect(hidesTerrain(grid, 2, 5)).toBe(false);
  });

  test("a building does NOT hide the ground it stands on", () => {
    const { grid, hist } = setup();
    commit(grid, hist, placeCommand(grid, KIT, 4, 4)!);
    expect(hidesTerrain(grid, 4, 4)).toBe(false);
  });

  test("the ground is back the moment the footprint is freed", () => {
    const { grid, hist } = setup();
    commit(grid, hist, placeCommand(grid, PIT, 3, 3)!);
    const id = structureOf(grid, 5, 5)!.id;
    commit(grid, hist, demolishCommand(grid, id)!);
    expect(hidesTerrain(grid, 5, 5)).toBe(false);
  });
});

const firstSpriteY = (sl: ReturnType<typeof createStructureLayer>) =>
  ((([...sl.mounted.values()][0].handle) as { sprites: { y: number }[] }).sprites[0].y);

/**
 * The paved overlay. What matters here is that a road sprite is chosen by the
 * SAME mask the connectivity graph reads, and that a mask with no art leaves a
 * visible hole rather than a wrong tile.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Sprite, Texture } from "pixi.js";

import { createGrid, fillTerrain, setHeight, setPaved } from "../grid";
import { HEIGHT_STEP, RAMP, RAMP_NAME, bandOf, packRamp } from "../iso";
import { pavedRampFrame } from "../ramp-art";
import { DIAG, DIR, isPaved, maskAt } from "../roads/mask";
import { buildRoadTable, roadSpriteFor } from "../roads/table";
import { createBandLayer } from "./bands";
import {
  buildPaved, createPavedLayer, notchedCount, pavedCount, recountInexact, syncPaved,
} from "./paved";
import { NOTCH_SOURCE, notchVariantFrame } from "../roads/notch";
import { notchVariantsNeeded } from "../roads/variants";

const TABLE = buildRoadTable("landscape");

/** Every frame the landscape table can pick, as a stand-in texture. */
const TEX: Record<string, Texture> = {};
for (const pool of TABLE.byOpen.values()) {
  for (const f of pool) {
    TEX[f] = new Texture({ source: Texture.EMPTY.source, frame: { x: 0, y: 0, width: 132, height: 99 } as never });
  }
}
if (TABLE.fill) TEX[TABLE.fill] = TEX[TABLE.fill] ?? Texture.EMPTY;
TEX[NOTCH_SOURCE] = TEX[NOTCH_SOURCE] ?? new Texture({
  source: Texture.EMPTY.source,
  frame: { x: 0, y: 0, width: 132, height: 99 } as never,
});
// the baked sheet's frames, as the real atlas would supply them
for (const v of notchVariantsNeeded(TABLE)) {
  TEX[v.baked] = new Texture({
    source: Texture.EMPTY.source,
    frame: { x: 0, y: 0, width: 132, height: 99 } as never,
  });
}

const setup = (w = 12, h = 12) => {
  const grid = createGrid(w, h);
  fillTerrain(grid, 1);
  const bl = createBandLayer(w, h);
  const pl = createPavedLayer(grid, TABLE, 1);
  return { grid, bl, pl };
};
const run = (grid: ReturnType<typeof setup>["grid"], x: number, y0: number, y1: number) => {
  for (let y = y0; y <= y1; y++) setPaved(grid, x, y, 1);
};

describe("syncPaved", () => {
  test("an unpaved cell has no sprite", () => {
    const { grid, bl, pl } = setup();
    syncPaved(pl, bl, grid, TEX, 4, 4);
    expect(pl.sprites[4 * grid.w + 4]).toBeNull();
  });

  test("a paved cell gets a sprite in its band's PAVED tier", () => {
    const { grid, bl, pl } = setup();
    setPaved(grid, 4, 4, 1);
    syncPaved(pl, bl, grid, TEX, 4, 4);
    const s = pl.sprites[4 * grid.w + 4]!;
    expect(s).not.toBeNull();
    expect(s.parent).toBe(bl.pavedOf[bandOf(4, 4)]);
  });

  test("erasing removes the sprite, so the terrain reappears", () => {
    const { grid, bl, pl } = setup();
    setPaved(grid, 4, 4, 1);
    syncPaved(pl, bl, grid, TEX, 4, 4);
    setPaved(grid, 4, 4, 0);
    syncPaved(pl, bl, grid, TEX, 4, 4);
    expect(pl.sprites[4 * grid.w + 4]).toBeNull();
    expect(pl.frames[4 * grid.w + 4]).toBeNull();
  });

  test("the frame follows the MASK — the same run picks straights and ends", () => {
    const { grid, bl, pl } = setup();
    run(grid, 4, 2, 6);
    buildPaved(pl, bl, grid, TEX);
    const at = (x: number, y: number) => pl.frames[y * grid.w + x];
    // interior of the run is a straight; both tips are dead ends
    expect(at(4, 4)).toBe(at(4, 5));
    expect(at(4, 2)).not.toBe(at(4, 4));
    expect(at(4, 6)).not.toBe(at(4, 4));
    expect(at(4, 2)).not.toBe(at(4, 6));   // ends face opposite ways
  });

  test("a bend picks a corner, not the fill tile", () => {
    const { grid, bl, pl } = setup();
    run(grid, 4, 2, 4);
    setPaved(grid, 5, 4, 1);
    setPaved(grid, 6, 4, 1);
    buildPaved(pl, bl, grid, TEX);
    const bend = pl.frames[4 * grid.w + 4];
    expect(bend).not.toBe(TABLE.fill);
    expect(bend).toBeTruthy();
  });

  test("a plaza's interior uses fill and its rim does not", () => {
    const { grid, bl, pl } = setup();
    for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) setPaved(grid, x, y, 1);
    buildPaved(pl, bl, grid, TEX);
    expect(pl.frames[5 * grid.w + 5]).toBe(TABLE.fill);
    expect(pl.frames[3 * grid.w + 5]).not.toBe(TABLE.fill);
  });

  test("raising one cell of a run re-resolves it as a dead end", () => {
    const { grid, bl, pl } = setup();
    run(grid, 4, 2, 6);
    buildPaved(pl, bl, grid, TEX);
    const at = (x: number, y: number) => pl.frames[y * grid.w + x];
    const before = at(4, 3);
    expect(before).not.toBeNull();
    setHeight(grid, 4, 4, 4);
    for (const c of [{ x: 4, y: 3 }, { x: 4, y: 4 }, { x: 4, y: 5 }]) {
      syncPaved(pl, bl, grid, TEX, c.x, c.y);
    }
    expect(at(4, 3)).not.toBe(before);
  });

  test("a mask with no art leaves the cell BARE rather than wrong", () => {
    const { grid, bl } = setup();
    setPaved(grid, 4, 4, 1);
    // a table that can draw nothing at all
    const empty = createPavedLayer(grid, { ...TABLE, byRole: new Map(), byOpen: new Map(), fill: null }, 1);
    syncPaved(empty, bl, grid, TEX, 4, 4);
    expect(empty.sprites[4 * grid.w + 4]).toBeNull();
  });
});

describe("buildPaved", () => {
  test("one sprite per paved cell, none elsewhere", () => {
    const { grid, bl, pl } = setup();
    run(grid, 4, 2, 6);
    buildPaved(pl, bl, grid, TEX);
    expect(pavedCount(pl)).toBe(5);
  });

  test("a straight run on EITHER axis needs no substitution", () => {
    for (const along of ["x", "y"] as const) {
      const { grid, bl, pl } = setup();
      if (along === "x") for (let x = 2; x <= 6; x++) setPaved(grid, x, 4, 1);
      else run(grid, 4, 2, 6);
      buildPaved(pl, bl, grid, TEX);
      expect(recountInexact(pl, grid)).toEqual({ inexact: 0, missing: 0 });
    }
  });

  /**
   * Landscape is fully covered, so nothing on it should report a substitution.
   * A shape that USED to (an L bend, before the curve tiles were labelled) is
   * the useful case to pin: if a label regresses, this catches it.
   */
  test("an L bend needs no substitution now the curves are labelled", () => {
    const { grid, bl, pl } = setup();
    run(grid, 4, 2, 4);
    for (let x = 5; x <= 7; x++) setPaved(grid, x, 4, 1);
    buildPaved(pl, bl, grid, TEX);
    expect(recountInexact(pl, grid)).toEqual({ inexact: 0, missing: 0 });
    expect(pl.inexact).toBe(0);
  });

  test("a table with art missing still REPORTS it rather than hiding it", () => {
    const { grid, bl } = setup();
    run(grid, 4, 2, 4);
    for (let x = 5; x <= 7; x++) setPaved(grid, x, 4, 1);
    // strip the curve role, as the labels stood before the pass
    const stripped = { ...TABLE, byRole: new Map(TABLE.byRole) };
    stripped.byRole.delete("thick-curve");
    const pl = createPavedLayer(grid, stripped, 1);
    buildPaved(pl, bl, grid, TEX);
    const { inexact, missing } = recountInexact(pl, grid);
    expect(missing).toBe(0);
    expect(inexact).toBe(1);
  });
});

/**
 * Reported: "pave a 2x2 square and THEN pave a single tile outwards" put an
 * inner corner in the middle of the pavement.
 *
 * The general invariant is what these check, not the one shape: a KERB corner
 * is only ever correct where that corner's diagonal is grass. A kerb drawn
 * across solid pavement is a hard line in the middle of a road; the reverse —
 * a missing notch at an outside edge — is barely visible. So every rule here
 * resolves toward asphalt when the art cannot express the exact case.
 */
describe("no kerb inside pavement", () => {
  /** Corners of a cell whose two flanking orthogonals AND diagonal are all paved. */
  const interiorCorners = (grid: ReturnType<typeof setup>["grid"], x: number, y: number) => {
    const m = maskAt(grid, x, y);
    const pairs = [
      ["NE", DIR.N | DIR.E, DIAG.NE],
      ["SE", DIR.S | DIR.E, DIAG.SE],
      ["SW", DIR.S | DIR.W, DIAG.SW],
      ["NW", DIR.N | DIR.W, DIAG.NW],
    ] as const;
    return pairs.filter(([, orth, d]) => (m & orth) === orth && (m & d) !== 0).map(([n]) => n);
  };

  test("the 2x2-plus-a-stub corner cell does not take the T tile", () => {
    const { grid, bl, pl } = setup();
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]] as const) setPaved(grid, x, y, 1);
    setPaved(grid, 6, 5, 1);                       // one cell outwards
    buildPaved(pl, bl, grid, TEX);

    // (5,5) has N, E, S paved and only the NE diagonal — the mixed case
    const pick = roadSpriteFor(TABLE, maskAt(grid, 5, 5));
    expect(pick.role).toBe("thick-lane");
    expect(interiorCorners(grid, 5, 5)).toContain("NE");
  });

  test("no cell of that shape resolves to a tile that kerbs an interior corner", () => {
    const { grid, bl, pl } = setup();
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]] as const) setPaved(grid, x, y, 1);
    setPaved(grid, 6, 5, 1);
    buildPaved(pl, bl, grid, TEX);

    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (!isPaved(grid, x, y)) continue;
        const role = roadSpriteFor(TABLE, maskAt(grid, x, y)).role;
        // these two kerb every corner, so neither may appear where a corner
        // is genuinely interior
        if (role === "thin-T" || role === "thin-cross") {
          expect(interiorCorners(grid, x, y)).toEqual([]);
        }
      }
    }
  });

  test("holds for a stub off every side of the square, and for bigger blobs", () => {
    const shapes: [number, number][][] = [];
    const square: [number, number][] = [[4, 4], [5, 4], [4, 5], [5, 5]];
    for (const stub of [[6, 5], [3, 4], [5, 3], [4, 6], [6, 4], [3, 5]] as [number, number][]) {
      shapes.push([...square, stub]);
    }
    // a 3x3 with a stub, and an L of two squares
    const three: [number, number][] = [];
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) three.push([x, y]);
    shapes.push([...three, [7, 6]], [...three, [4, 7]]);
    shapes.push([...square, [6, 6], [7, 6], [6, 7], [7, 7]]);

    for (const cells of shapes) {
      const { grid, bl, pl } = setup();
      for (const [x, y] of cells) setPaved(grid, x, y, 1);
      buildPaved(pl, bl, grid, TEX);
      for (const [x, y] of cells) {
        const role = roadSpriteFor(TABLE, maskAt(grid, x, y)).role;
        if (role === "thin-T" || role === "thin-cross") {
          expect(interiorCorners(grid, x, y)).toEqual([]);
        }
      }
    }
  });

  test("a genuine 1-wide T and crossroads still get their kerbs", () => {
    const { grid, bl, pl } = setup();
    run(grid, 4, 2, 6);
    setPaved(grid, 5, 4, 1);                       // a branch → real T at (4,4)
    buildPaved(pl, bl, grid, TEX);
    expect(roadSpriteFor(TABLE, maskAt(grid, 4, 4)).role).toBe("thin-T");
    setPaved(grid, 3, 4, 1);                       // → real crossroads
    expect(roadSpriteFor(TABLE, maskAt(grid, 4, 4)).role).toBe("thin-cross");
  });
});

/**
 * Inner corners are drawn from a PRE-COMPOSITED tile, not overlay sprites — see
 * render/notch-variants for why. So what is testable without a renderer is the
 * variant SELECTION: that a cell needing corners asks for the right key, and
 * falls back to the plain base when the variant has not been built.
 */
/**
 * Inner corners are BAKED into `derived/roadCorners_sheet` at build time (see
 * dev/bake-road-corners.ts), so at runtime they are ordinary atlas frames.
 * Nothing is composited while the game runs — which is what these assert.
 */
describe("inner-corner variants", () => {
  /** A plus with one diagonal filled: the centre needs three notches. */
  const plusWithCorner = (grid: ReturnType<typeof setup>["grid"]) => {
    for (const [x, y] of [[4, 4], [3, 4], [5, 4], [4, 3], [4, 5], [3, 3]] as const) {
      setPaved(grid, x, y, 1);
    }
  };

  test("a cell needing corners draws the BAKED frame", () => {
    const { grid, bl, pl } = setup();
    plusWithCorner(grid);
    buildPaved(pl, bl, grid, TEX);
    const i = 4 * grid.w + 4;
    const baked = notchVariantFrame(TABLE.fill!, ["SE", "SW", "NW"]);
    expect(pl.frames[i]).toBe(baked);
    expect(pl.sprites[i]!.texture).toBe(TEX[baked]);
    expect(notchedCount(pl)).toBe(1);
  });

  test("ONE sprite per cell — nothing composited at draw time", () => {
    const { grid, bl, pl } = setup();
    plusWithCorner(grid);
    buildPaved(pl, bl, grid, TEX);
    let paved = 0;
    for (const v of grid.paved) if (v) paved++;
    expect(pavedCount(pl)).toBe(paved);
    for (const band of bl.pavedOf) {
      expect(band.children.length).toBeLessThanOrEqual(paved);
      for (const s of band.children) expect((s as Sprite).anchor.x).toBe(0.5);
    }
  });

  test("a missing baked frame leaves the cell bare, so the gap is visible", () => {
    const { grid, bl, pl } = setup();
    plusWithCorner(grid);
    const without = { ...TEX };
    for (const k of Object.keys(without)) if (k.startsWith("roadCorner_")) delete without[k];
    buildPaved(pl, bl, grid, without);
    expect(pl.sprites[4 * grid.w + 4]).toBeNull();
    expect(pl.sprites[3 * grid.w + 4]).not.toBeNull();   // its neighbours still draw
  });

  test("a plaza interior and a crossroads need no variant", () => {
    const { grid, bl, pl } = setup();
    for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) setPaved(grid, x, y, 1);
    buildPaved(pl, bl, grid, TEX);
    expect(notchedCount(pl)).toBe(0);
    expect(pl.frames[5 * grid.w + 5]).toBe(TABLE.fill);
  });

  test("stops using a variant once every corner becomes interior", () => {
    const { grid, bl, pl } = setup();
    plusWithCorner(grid);
    buildPaved(pl, bl, grid, TEX);
    expect(pl.frames[4 * grid.w + 4]!.startsWith("roadCorner_")).toBe(true);

    for (const [x, y] of [[5, 3], [5, 5], [3, 5]] as const) setPaved(grid, x, y, 1);
    buildPaved(pl, bl, grid, TEX);
    expect(pl.frames[4 * grid.w + 4]).toBe(TABLE.fill);
    expect(roadSpriteFor(TABLE, maskAt(grid, 4, 4)).notches).toEqual([]);
  });
});

/**
 * Ramp frames vary in height — the two rising up-screen are 131 tall against a
 * flat tile's 99 — and the extra is a DEEPER SKIRT under the low side, not a
 * taller tile. The art keeps its diamond in the same frame rows either way, so
 * every ramp must be anchored exactly where a flat tile at the same height is.
 *
 * The bug this pins: anchoring by the frame's own height dropped the 131px
 * frames one full step, so a ramp descending toward the viewer detached from
 * the plateau it was meant to join, with cliff showing through the gap.
 */
describe("ramp anchoring", () => {
  /** Real frame heights, so this test tracks the ART and not a copy of it. */
  const ATLAS_FRAME_H = (() => {
    const xml = readFileSync(
      "public/isometric_assets/landscape/landscape_sheet.xml", "utf8");
    const out = new Map<string, number>();
    for (const m of xml.matchAll(/name="([^"]+)"[^>]*height="(\d+)"/g)) {
      out.set(m[1], Number(m[2]));
    }
    return out;
  })();

  const texOf = (frame: string) => new Texture({
    source: Texture.EMPTY.source,
    frame: { x: 0, y: 0, width: 132, height: ATLAS_FRAME_H.get(frame) ?? 99 } as never,
  });

  const DIRS = [RAMP.N, RAMP.E, RAMP.S, RAMP.W] as const;

  test("the artset mixes frame heights, which is why the anchor cannot use them", () => {
    const heights = DIRS.map((d) => ATLAS_FRAME_H.get(pavedRampFrame(d, 2)!));
    expect(heights).not.toContain(undefined);
    // N and E rise up-screen and are 131; S and W rise toward the viewer and
    // fit the raise inside the 99 they already had.
    expect(Math.max(...(heights as number[]))).toBeGreaterThan(99);
    expect(new Set(heights).size).toBeGreaterThan(1);
  });

  test.each(DIRS.map((d) => [RAMP_NAME[d], d] as const))(
    "a %s ramp sits at the same screen y as a flat tile at its height",
    (_name, dir) => {
      const { grid, bl, pl } = setup();
      const frame = pavedRampFrame(dir, 2)!;
      const tex = { ...TEX, [frame]: texOf(frame) };

      setHeight(grid, 5, 5, 4);
      setPaved(grid, 5, 5, 1);
      syncPaved(pl, bl, grid, tex, 5, 5);
      const flatY = pl.sprites[5 * grid.w + 5]!.y;

      grid.ramp[5 * grid.w + 5] = packRamp(dir, 2);
      syncPaved(pl, bl, grid, tex, 5, 5);
      const s = pl.sprites[5 * grid.w + 5]!;
      expect(pl.frames[5 * grid.w + 5]).toBe(frame);
      expect(s.y).toBe(flatY);
    },
  );

  test("and a ramp one step up is exactly one step higher on screen", () => {
    const { grid, bl, pl } = setup();
    const frame = pavedRampFrame(RAMP.N, 2)!;
    const tex = { ...TEX, [frame]: texOf(frame) };
    const i = 5 * grid.w + 5;

    setPaved(grid, 5, 5, 1);
    grid.ramp[i] = packRamp(RAMP.N, 2);
    syncPaved(pl, bl, grid, tex, 5, 5);
    const low = pl.sprites[i]!.y;

    setHeight(grid, 5, 5, 2);       // one full step, in half-step units
    syncPaved(pl, bl, grid, tex, 5, 5);
    expect(pl.sprites[i]!.y).toBe(low - HEIGHT_STEP);
  });
});

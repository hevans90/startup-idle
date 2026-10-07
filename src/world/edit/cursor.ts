/**
 * World v2 — the RTS build cursor (plan §6.1).
 *
 * Engine feature, not debug chrome: every tool routes through it, so a 1×1
 * terrain brush, a drag stroke and a future 5×5 structure all get the same
 * affordance from one code path. The tool only ever supplies cells.
 *
 * Three parts, deliberately at different depths:
 *
 *   outline  Graphics in the OVERLAY, above the world — always readable, even
 *            where a tall sprite would hide the footprint
 *   ghost    Sprites INSIDE the bands at true depth — so you see how the
 *            placement will actually sit against what is already there,
 *            occluded by what is in front and occluding what is behind
 *
 * Keeping them separate is what lets both be true at once, and costs nothing.
 */
import { Container, Graphics, MeshSimple, Sprite, Texture } from "pixi.js";

import { HH, HW, bandOf, cellToWorld, spriteY, type Cell } from "../iso";
import { VOID, idx, inBounds, surfaceHeightAt, type Grid } from "../grid";
import { cellDiamond, drawDeckPiers } from "../render/overlays";
import { TILE_BLEED } from "../render/terrain";
import type { BandLayer } from "../render/bands";
import type { ToolId } from "./tools";

/** Green when placeable, red when not. Per CELL, never per footprint. */
export const CURSOR_OK = 0x7cfc9a;
export const CURSOR_BLOCKED = 0xff6b6b;

export type CellVerdict = { ok: boolean; reason?: string };

/**
 * Per-cell validity. A boolean for the whole footprint is the frustrating
 * version: when a 5×5 is blocked you need to know WHICH cells are the problem.
 */
export type Validator = (grid: Grid, x: number, y: number) => CellVerdict;

const OFF_MAP: CellVerdict = { ok: false, reason: "off map" };

export const validatePaint: Validator = (grid, x, y) =>
  inBounds(grid, x, y) ? { ok: true } : OFF_MAP;

export const validateErase: Validator = (grid, x, y) => {
  if (!inBounds(grid, x, y)) return OFF_MAP;
  if (grid.terrain[idx(grid, x, y)] === VOID) return { ok: false, reason: "already empty" };
  return { ok: true };
};

export function validatorFor(tool: ToolId): Validator {
  return tool === "erase" ? validateErase : validatePaint;
}

/**
 * The four diamond edges of a cell, each paired with the neighbour it faces.
 *
 * Worth deriving rather than guessing: a step of +1 in x moves the cell
 * down-RIGHT in world space (+HW, +HH), which bisects the East and South
 * vertices — so the E→S edge is the one facing (x+1, y), and so on round.
 * Getting this wrong yields a perimeter with holes in it.
 */
const EDGES = [
  { dx: 0, dy: -1, a: 0, b: 1 },  // N→E faces (x, y-1)
  { dx: 1, dy: 0, a: 1, b: 2 },   // E→S faces (x+1, y)
  { dx: 0, dy: 1, a: 2, b: 3 },   // S→W faces (x, y+1)
  { dx: -1, dy: 0, a: 3, b: 0 },  // W→N faces (x-1, y)
] as const;

/** The same diamond as the tile layers, as [N, E, S, W] vertex pairs. */
function vertices(x: number, y: number, h: number, scale: number) {
  const p = cellDiamond(x, y, h, scale);
  return [[p[0], p[1]], [p[2], p[3]], [p[4], p[5]], [p[6], p[7]]] as const;
}

/**
 * Outer boundary of a footprint as world-space segments.
 *
 * An edge is on the perimeter when the cell across it is not in the footprint.
 * Each segment uses its OWN cell's SURFACE height, so a footprint straddling a
 * step traces the terrain rather than floating at one level — and one
 * straddling the end of a bridge climbs onto the span. @see surfaceHeightAt
 */
export function footprintPerimeter(
  grid: Grid,
  cells: readonly Cell[],
  scale: number,
): [number, number, number, number][] {
  // A MASK OVER THE GRID, not a set of "x,y" strings: a pour dragged over a
  // 128 tile map is sixteen thousand cells, and this ran on every pointer
  // move. Cells off the map are rare and keep a set of their own.
  const mask = new Uint8Array(grid.w * grid.h);
  const off = new Set<string>();
  for (const c of cells) {
    if (inBounds(grid, c.x, c.y)) mask[c.y * grid.w + c.x] = 1;
    else off.add(`${c.x},${c.y}`);
  }
  const has = (x: number, y: number) => inBounds(grid, x, y)
    ? mask[y * grid.w + x] === 1
    : off.size > 0 && off.has(`${x},${y}`);
  const out: [number, number, number, number][] = [];
  for (const c of cells) {
    if (!inBounds(grid, c.x, c.y)) continue;
    // AN INTERIOR CELL HAS NO EDGE TO DRAW, and is most of a big footprint:
    // asked first, so only the rim works out its corners.
    if (EDGES.every((e) => has(c.x + e.dx, c.y + e.dy))) continue;
    const v = vertices(c.x, c.y, surfaceHeightAt(grid, c.x, c.y), scale);
    for (const e of EDGES) {
      if (has(c.x + e.dx, c.y + e.dy)) continue;
      out.push([v[e.a][0], v[e.a][1], v[e.b][0], v[e.b][1]]);
    }
  }
  return out;
}

export type CursorInput = {
  cells: readonly Cell[];
  /** Atlas frame to ghost, or null for tools that place nothing (erase). */
  frame: string | null;
  tool: ToolId;
  scale: number;
  /**
   * Per-cell validity for this footprint, when the tool's own is not the
   * whole story — a structure that must stand on a river's bank, say, which
   * no cell can answer alone. @see validatorFor
   */
  valid?: Validator;
};

/**
 * Cheap identity for a cursor state.
 *
 * The cursor redraws on CHANGE, not per frame — the same discipline as the
 * tile layers. Cells, heights, validity, frame and scale are everything the
 * drawing depends on, so if the signature matches, the picture would too.
 */
export function cursorSignature(grid: Grid, input: CursorInput, valid: Validator): string {
  // HASHED, NOT SPELLED OUT. A part per cell joined into one string was a
  // string of sixteen thousand parts for a pour dragged over a 128 tile map,
  // built on every pointer move to find out whether anything changed. Two
  // independent 32 bit hashes of the same numbers, and the count, say the
  // same thing for a few integer multiplies a cell.
  let h1 = 0x811c9dc5 | 0, h2 = 0x5bd1e995 | 0;
  const mix = (v: number) => {
    h1 = Math.imul(h1 ^ v, 0x01000193);
    h2 = Math.imul(h2 ^ v, 0x5bd1e995) ^ (h2 >>> 15);
  };
  for (const c of input.cells) {
    // THE HEIGHT IT DRAWS AT, not the terrain's: laying a deck under the
    // pointer moves the cursor and changes nothing else, and a signature off
    // the ground would call that the same picture and skip the redraw.
    const on = inBounds(grid, c.x, c.y);
    const h = on ? surfaceHeightAt(grid, c.x, c.y) : 0;
    const d = on ? grid.deck[idx(grid, c.x, c.y)] : 0;
    mix(c.x); mix(c.y); mix(Math.round(h * 64)); mix(d);
    mix(valid(grid, c.x, c.y).ok ? 1 : 0);
  }
  return [
    input.frame ?? "-", input.tool, input.scale.toFixed(4),
    input.cells.length, h1 >>> 0, h2 >>> 0,
  ].join("|");
}

export type BuildCursor = {
  outline: Graphics;
  /** Cells the last update drew, and how many were blocked. */
  cells: readonly Cell[];
  blocked: number;
  update: (grid: Grid, input: CursorInput, textures: Record<string, Texture>) => boolean;
  clear: () => void;
  destroy: () => void;
};

/**
 * @param overlay container ABOVE the world, inside the viewport
 * @param bands   band layer, so ghosts can be parented at true depth
 */
export function createBuildCursor(overlay: Container, bands: BandLayer): BuildCursor {
  const outline = new Graphics();
  outline.eventMode = "none";
  outline.zIndex = 1000;      // above the debug overlays, whatever order they mount in
  overlay.addChild(outline);

  // THE TINT AS TWO MESHES, open and blocked, under the outline. It was a
  // diamond and a fill per cell in the outline's Graphics, and Pixi builds a
  // shape object per call: a pour dragged over a 128 tile map was sixteen
  // thousand of them and 159 ms on every pointer move. Four corners a cell in
  // a typed array is the same picture for well under a millisecond.
  const tints: (MeshSimple | null)[] = [null, null];
  const setTint = (k: 0 | 1, corners: Float32Array, n: number, color: number) => {
    let m = tints[k];
    if (n === 0) { if (m) m.visible = false; return; }
    const verts = corners.subarray(0, n * 8);
    if (!m || m.vertices.length !== n * 8) {
      m?.destroy();
      const indices = new Uint32Array(n * 6);
      for (let q = 0; q < n; q++) {
        const o = q * 4, w = q * 6;
        indices[w] = o; indices[w + 1] = o + 1; indices[w + 2] = o + 2;
        indices[w + 3] = o; indices[w + 4] = o + 2; indices[w + 5] = o + 3;
      }
      m = new MeshSimple({
        texture: Texture.WHITE, vertices: Float32Array.from(verts),
        uvs: new Float32Array(n * 8), indices,
      });
      m.eventMode = "none";
      m.zIndex = 999;                            // under the outline
      m.alpha = 0.28;
      overlay.addChild(m);
      tints[k] = m;
    } else {
      m.vertices = Float32Array.from(verts);
    }
    m.tint = color;
    m.visible = true;
  };

  // Pooled: a drag over a 5×5 brush churns sprites otherwise.
  const pool: Sprite[] = [];
  let used = 0;

  const ghost = (): Sprite => {
    if (used < pool.length) return pool[used++];
    const s = new Sprite();
    s.anchor.set(0.5, 1);
    s.alpha = 0.55;
    s.eventMode = "none";
    pool.push(s);
    used++;
    return s;
  };

  const releaseGhosts = () => {
    for (let i = used; i < pool.length; i++) {
      pool[i].visible = false;
      pool[i].parent?.removeChild(pool[i]);
    }
  };

  const cursor: BuildCursor = {
    outline,
    cells: [],
    blocked: 0,
    update: () => false,
    clear: () => {},
    destroy: () => {},
  };

  let signature = "";

  cursor.clear = () => {
    outline.clear();
    for (const m of tints) if (m) m.visible = false;
    used = 0;
    releaseGhosts();
    cursor.cells = [];
    cursor.blocked = 0;
    signature = "";
  };

  cursor.update = (grid, input, textures) => {
    const valid = input.valid ?? validatorFor(input.tool);
    const sig = cursorSignature(grid, input, valid);
    if (sig === signature) return false;
    signature = sig;

    outline.clear();
    used = 0;

    if (!input.cells.length) {
      releaseGhosts();
      cursor.cells = [];
      cursor.blocked = 0;
      return true;
    }

    const tex = input.frame ? textures[input.frame] : undefined;
    let blocked = 0;

    // THREE SWEEPS, not one shape at a time. A diamond and a fill per cell was
    // sixteen thousand fills for a pour dragged over a 128 tile map, and Pixi
    // tessellates every one again when the outline is next drawn — the render
    // call's own time went from 5 ms to 19 with the drag. So the piers, then
    // every open cell's diamond under ONE fill, then every blocked one under
    // another: the same picture, piers under the tint as before, in three
    // instructions. @see drawDeckPiers
    const heights = new Float64Array(input.cells.length);
    const oks = new Uint8Array(input.cells.length);
    for (let n = 0; n < input.cells.length; n++) {
      const c = input.cells[n];
      if (!inBounds(grid, c.x, c.y)) { blocked++; continue; }
      // ON THE SURFACE PICKING CHOSE. A deck and the ground under it share a
      // cell, and the march stops at the deck — so a cursor drawn off
      // `grid.height` sat in the channel under the span the pointer was on,
      // which is the one reading of a bridge nobody wants.
      heights[n] = surfaceHeightAt(grid, c.x, c.y);
      const ok = valid(grid, c.x, c.y).ok;
      oks[n] = ok ? 1 : 2;
      if (!ok) blocked++;
      // And say what it is standing on, or two surfaces one above the other
      // are one diamond and the picture is ambiguous. @see drawDeckPiers
      drawDeckPiers(outline, grid, c.x, c.y, input.scale, ok ? CURSOR_OK : CURSOR_BLOCKED);
    }
    // per-cell tint, so a partly blocked footprint says which cells
    for (const want of [1, 2] as const) {
      const corners = new Float32Array(input.cells.length * 8);
      let q = 0;
      const hw = HW * input.scale, hh = HH * input.scale;
      for (let n = 0; n < input.cells.length; n++) {
        if (oks[n] !== want) continue;
        const c = input.cells[n];
        // cellDiamond's four corners, written straight into the array.
        const { wx, wy } = cellToWorld(c.x, c.y, heights[n], input.scale);
        const o = q * 8;
        corners[o] = wx; corners[o + 1] = wy - hh;
        corners[o + 2] = wx + hw; corners[o + 3] = wy;
        corners[o + 4] = wx; corners[o + 5] = wy + hh;
        corners[o + 6] = wx - hw; corners[o + 7] = wy;
        q++;
      }
      setTint(want === 1 ? 0 : 1, corners, q, want === 1 ? CURSOR_OK : CURSOR_BLOCKED);
    }
    if (tex) {
      for (let n = 0; n < input.cells.length; n++) {
        if (oks[n] !== 1) continue;
        const c = input.cells[n];
        const h = heights[n];
        const s = ghost();
        s.texture = tex;
        const { wx, wy } = cellToWorld(c.x, c.y, h, input.scale);
        s.x = wx;
        s.y = spriteY(wy, tex.height, input.scale);
        s.scale.set(input.scale * TILE_BLEED);
        s.tint = CURSOR_OK;
        s.visible = true;
        // in-band, so the ghost is occluded by whatever stands in front of it
        const dyn = bands.dynamicOf[bandOf(c.x, c.y)];
        if (s.parent !== dyn) dyn.addChild(s);
      }
    }

    // perimeter last and bolder, so the footprint reads as one shape
    for (const [x0, y0, x1, y1] of footprintPerimeter(grid, input.cells, input.scale)) {
      outline.moveTo(x0, y0).lineTo(x1, y1);
    }
    outline.stroke({
      color: blocked ? CURSOR_BLOCKED : CURSOR_OK,
      width: 2,
      alpha: 0.95,
      pixelLine: true,
    });

    releaseGhosts();
    cursor.cells = input.cells;
    cursor.blocked = blocked;
    return true;
  };

  cursor.destroy = () => {
    cursor.clear();
    for (const s of pool) s.destroy();
    pool.length = 0;
    for (const m of tints) m?.destroy();
    outline.destroy();
  };

  return cursor;
}

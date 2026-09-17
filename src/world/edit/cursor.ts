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
import { Container, Graphics, Sprite, type Texture } from "pixi.js";

import { bandOf, cellToWorld, spriteY, type Cell } from "../iso";
import { VOID, heightAt, idx, inBounds, type Grid } from "../grid";
import { cellDiamond } from "../render/overlays";
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
 * Each segment uses its OWN cell's height, so a footprint straddling a step
 * traces the terrain rather than floating at one level.
 */
export function footprintPerimeter(
  grid: Grid,
  cells: readonly Cell[],
  scale: number,
): [number, number, number, number][] {
  const inSet = new Set(cells.map((c) => `${c.x},${c.y}`));
  const out: [number, number, number, number][] = [];
  for (const c of cells) {
    if (!inBounds(grid, c.x, c.y)) continue;
    const v = vertices(c.x, c.y, heightAt(grid, c.x, c.y) ?? 0, scale);
    for (const e of EDGES) {
      if (inSet.has(`${c.x + e.dx},${c.y + e.dy}`)) continue;
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
};

/**
 * Cheap identity for a cursor state.
 *
 * The cursor redraws on CHANGE, not per frame — the same discipline as the
 * tile layers. Cells, heights, validity, frame and scale are everything the
 * drawing depends on, so if the signature matches, the picture would too.
 */
export function cursorSignature(grid: Grid, input: CursorInput, valid: Validator): string {
  const parts: string[] = [input.frame ?? "-", input.tool, input.scale.toFixed(4)];
  for (const c of input.cells) {
    const h = inBounds(grid, c.x, c.y) ? grid.height[idx(grid, c.x, c.y)] : 0;
    parts.push(`${c.x},${c.y},${h},${valid(grid, c.x, c.y).ok ? 1 : 0}`);
  }
  return parts.join("|");
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
    used = 0;
    releaseGhosts();
    cursor.cells = [];
    cursor.blocked = 0;
    signature = "";
  };

  cursor.update = (grid, input, textures) => {
    const valid = validatorFor(input.tool);
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

    for (const c of input.cells) {
      if (!inBounds(grid, c.x, c.y)) { blocked++; continue; }
      const h = heightAt(grid, c.x, c.y) ?? 0;
      const ok = valid(grid, c.x, c.y).ok;
      if (!ok) blocked++;

      // per-cell tint, so a partly blocked footprint says which cells
      outline.poly(cellDiamond(c.x, c.y, h, input.scale));
      outline.fill({ color: ok ? CURSOR_OK : CURSOR_BLOCKED, alpha: 0.28 });

      if (tex && ok) {
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
    outline.destroy();
  };

  return cursor;
}

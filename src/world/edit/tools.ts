/**
 * World v2 — edit tools.
 *
 * A tool turns pointer activity into cells, and nothing more: it never touches
 * the grid directly. Cells go into a {@link PatchBuilder} while the pointer is
 * down and become one undoable command on release, which is what makes a drag
 * stroke a single undo step.
 *
 * Keeping "which cells" separate from "what to write" is what lets one brush
 * shape serve terrain, height and paved alike.
 */
import type { Cell } from "../iso";
import type { Grid } from "../grid";

export type ToolId =
  | "paintTerrain"
  | "erase"
  | "raise"
  | "lower"
  | "flatten"
  | "smooth"
  | "paintRoad"
  | "eraseRoad"
  | "slope"
  | "unslope"
  | "pourWater"
  | "drainWater"
  | "spring"
  | "sink"
  | "placeStructure"
  | "demolish"
  | "inspect";

/** Tools that write the `height` layer rather than a material. */
export const HEIGHT_TOOLS = ["raise", "lower", "flatten", "smooth"] as const;

export const isHeightTool = (t: ToolId): t is (typeof HEIGHT_TOOLS)[number] =>
  (HEIGHT_TOOLS as readonly string[]).includes(t);

/** Tools that write the `paved` layer. */
export const isRoadTool = (t: ToolId) => t === "paintRoad" || t === "eraseRoad";

/** Tools that write the `ramp` layer on bare ground. See `edit/slope`. */
export const isSlopeTool = (t: ToolId) => t === "slope" || t === "unslope";

/**
 * Tools that POUR water, rather than painting it.
 *
 * A volume goes down and the simulation decides where it ends up — which is the
 * whole point, and why these are not layer writes like every other brush. Pour
 * on a hilltop and it runs off.
 */
export const isWaterTool = (t: ToolId) => t === "pourWater" || t === "drainWater";

/**
 * Tools that place a SPRING or a drain — a rate, not a volume.
 *
 * The difference from pouring is the whole point of them. A pour is a slug of
 * water that arrives once; a spring keeps arriving, so what it makes is a
 * standing flow rather than a thing that runs out. A drain is the same
 * mechanism backwards, and between them a map has somewhere for water to come
 * from and somewhere for it to go.
 */
export const isSourceTool = (t: ToolId) => t === "spring" || t === "sink";

/**
 * Tools that act on a STRUCTURE rather than on cells.
 *
 * They bypass the stroke machinery entirely: a structure is placed at one cell
 * by one command, so brush size and drag shape mean nothing to them. Dragging a
 * row of buildings would be a different tool, not a bigger brush.
 */
export const isStructureTool = (t: ToolId) => t === "placeStructure" || t === "demolish";

/**
 * How anchor→head is interpreted. These are DRAG shapes: with `point` a click
 * paints where you clicked, but `rect` and `line` need the pointer to travel,
 * because a click leaves anchor === head and therefore covers one cell.
 *
 * That distinction is separate from brush SIZE, which is what usually makes a
 * single click cover more than one tile — see {@link expandCells}.
 */
export type BrushId = "point" | "rect" | "line";

export type Stroke = {
  tool: ToolId;
  brush: BrushId;
  /** Where the pointer went down. */
  anchor: Cell;
  /** Where it is now. */
  head: Cell;
};

const clampCell = (g: Grid, c: Cell): Cell => ({
  x: Math.max(0, Math.min(g.w - 1, c.x)),
  y: Math.max(0, Math.min(g.h - 1, c.y)),
});

/** Every integer from `from` to `to`, inclusive, in either direction. */
function span(from: number, to: number): number[] {
  const step = from <= to ? 1 : -1;
  const out: number[] = [];
  for (let v = from; ; v += step) {
    out.push(v);
    if (v === to) break;
  }
  return out;
}

/**
 * A road line bends ONCE rather than cutting the diagonal.
 *
 * Bresenham's answer to a diagonal drag is a chain of cells touching only at
 * their corners, and a corner touch is not adjacency here — `connects()` and
 * `NEIGHBOUR` both run along edges. So a diagonal road "line" is a string of
 * lone squares: no corner art, no junctions, one network component per cell.
 * An L is the shape the road model can express, and its single bend is exactly
 * where the curve tile belongs.
 *
 * The LONG axis runs first, so the bend lands near the pointer rather than at
 * the anchor, and dragging mostly-horizontally gives a horizontal run. Sweeping
 * the pointer past the diagonal flips which leg leads, which is how you choose
 * the corner without a second gesture.
 */
function elbowCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
    for (const x of span(a.x, b.x)) out.push({ x, y: a.y });
    for (const y of span(a.y, b.y)) if (y !== a.y) out.push({ x: b.x, y });
  } else {
    for (const y of span(a.y, b.y)) out.push({ x: a.x, y });
    for (const x of span(a.x, b.x)) if (x !== a.x) out.push({ x, y: b.y });
  }
  return out;
}

/**
 * Cells a stroke covers.
 *
 * `single` is the head alone; `rect` is the axis-aligned block between anchor
 * and head — in CELL space, so on screen it reads as a diamond block, which is
 * what an isometric grid makes intuitive; `line` walks anchor→head so a drag
 * paints a connected run even when the pointer jumps between frames.
 *
 * A ROAD line walks that run as an L instead — see {@link elbowCells}.
 */
export function strokeCells(grid: Grid, s: Stroke): Cell[] {
  const a = clampCell(grid, s.anchor);
  const b = clampCell(grid, s.head);

  if (s.brush === "point") return [b];

  if (s.brush === "rect") {
    const out: Cell[] = [];
    const [x0, x1] = a.x <= b.x ? [a.x, b.x] : [b.x, a.x];
    const [y0, y1] = a.y <= b.y ? [a.y, b.y] : [b.y, a.y];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
    return out;
  }

  if (isRoadTool(s.tool)) return elbowCells(a, b);

  // line — integer Bresenham, so no gaps when the pointer moves fast
  const out: Cell[] = [];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return out;
}

/**
 * Dilate a cell set by a radius, so one click can cover more than one tile.
 *
 * Square rather than diamond: on an isometric grid a square in CELL space
 * already reads as a diamond on screen, so a square footprint looks like the
 * rotated block people expect from a brush.
 *
 * Deduplicated, so overlapping footprints along a stroke do not produce
 * repeated writes.
 */
export function expandCells(grid: Grid, cells: readonly Cell[], radius: number): Cell[] {
  if (radius <= 0) return cells.slice();
  const seen = new Set<number>();
  const out: Cell[] = [];
  for (const c of cells) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = c.x + dx, y = c.y + dy;
        if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
        const k = y * grid.w + x;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ x, y });
      }
    }
  }
  return out;
}

/** Cells a stroke covers, including its brush size. */
export function strokeFootprint(grid: Grid, s: Stroke, radius: number): Cell[] {
  return expandCells(grid, strokeCells(grid, s), radius);
}

/** A human label for the history entry a stroke will produce. */
export function strokeLabel(s: Stroke, n: number): string {
  const what =
    s.tool === "erase" ? "erase" :
    s.tool === "paintRoad" ? "road" :
    s.tool === "eraseRoad" ? "unroad" :
    s.tool === "slope" ? "slope" :
    s.tool === "unslope" ? "unslope" :
    s.tool === "pourWater" ? "pour" :
    s.tool === "drainWater" ? "drain" :
    s.tool === "spring" ? "spring" :
    s.tool === "sink" ? "sink" :
    isHeightTool(s.tool) ? s.tool :
    "paint";
  const shape = s.brush === "point" ? "" : ` ${s.brush}`;
  return `${what}${shape} (${n} cell${n === 1 ? "" : "s"})`;
}

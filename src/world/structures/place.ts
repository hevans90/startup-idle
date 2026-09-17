/**
 * World v2 — where a structure may stand, and the command that puts it there.
 *
 * Placement is a whole-FOOTPRINT question, but the build cursor tints per cell,
 * so validation reports both: a verdict for every cell and one summary. The two
 * cannot be collapsed — "the ground is uneven" is true of the footprint and of
 * no single cell in it.
 *
 * Placing is ONE command. Auto-flatten, stamping the footprint and creating the
 * record all travel together, so a single undo reverses the lot; a player who
 * flattened a hillside by placing a building would otherwise have to undo twice
 * to get their hill back.
 */
import { PatchBuilder, type Command } from "../edit/commands";
import type { CellVerdict } from "../edit/cursor";
import {
  VOID, footprintCells, idx, inBounds, structureAt, type Grid, type Structure,
} from "../grid";
import { RAMP } from "../iso";
import { placementOf, type StructureDef } from "./def";

export type PlacementCheck = {
  ok: boolean;
  /** One verdict per footprint cell, row-major — for the cursor's per-cell tint. */
  cells: CellVerdict[];
  /** Why the whole placement fails, or null. */
  reason: string | null;
  /** The height the footprint would be levelled to. */
  groundHeight: number;
};

const OK: CellVerdict = { ok: true };

/** Per-cell rules. Everything here is decidable without looking at the others. */
function cellVerdict(grid: Grid, def: StructureDef, x: number, y: number): CellVerdict {
  if (!inBounds(grid, x, y)) return { ok: false, reason: "off map" };
  const i = idx(grid, x, y);
  if (grid.terrain[i] === VOID) return { ok: false, reason: "no ground" };
  if (structureAt(grid, x, y) >= 0) return { ok: false, reason: "occupied" };
  if (!placementOf(def).allowOnPaved && grid.paved[i] !== VOID) {
    return { ok: false, reason: "on a road" };
  }
  return OK;
}

/**
 * The height a footprint levels to: the LOWER median of its cells.
 *
 * Median rather than mean so the result is a height the ground actually has —
 * a mean lands between steps and would need rounding, which is the same choice
 * made less honestly. Lower median on an even count, so the rule is total and
 * two runs on the same ground never differ.
 */
export function medianHeight(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

export function validatePlacement(
  grid: Grid,
  def: StructureDef,
  ox: number,
  oy: number,
): PlacementCheck {
  const { w, h } = def.footprint;
  const cells = footprintCells(ox, oy, w, h);
  const verdicts = cells.map((c) => cellVerdict(grid, def, c.x, c.y));

  const heights = cells
    .filter((c) => inBounds(grid, c.x, c.y))
    .map((c) => grid.height[idx(grid, c.x, c.y)]);
  const groundHeight = medianHeight(heights);

  const firstBad = verdicts.find((v) => !v.ok);
  if (firstBad) {
    return { ok: false, cells: verdicts, reason: firstBad.reason ?? "blocked", groundHeight };
  }

  // Uneven ground is a property of the FOOTPRINT, so it can only be judged
  // here — and only matters when nothing is going to level it.
  if (!placementOf(def).autoFlatten && new Set(heights).size > 1) {
    return {
      ok: false,
      cells: verdicts.map(() => ({ ok: false, reason: "uneven ground" })),
      reason: "uneven ground",
      groundHeight,
    };
  }
  return { ok: true, cells: verdicts, reason: null, groundHeight };
}

/**
 * The command that places one structure, or null if it may not stand there.
 *
 * The id comes from `grid.nextStructureId` but the grid is NOT advanced here —
 * applying the command does that, which is what lets redo restore the record
 * under its original id. Two commands built before either is committed would
 * therefore collide; build one, commit it, build the next.
 */
export function placeCommand(
  grid: Grid,
  def: StructureDef,
  ox: number,
  oy: number,
): Command | null {
  const check = validatePlacement(grid, def, ox, oy);
  if (!check.ok) return null;

  const b = new PatchBuilder(grid);
  const structure: Structure = {
    id: grid.nextStructureId,
    def: def.id,
    x: ox,
    y: oy,
    w: def.footprint.w,
    h: def.footprint.h,
  };

  for (const c of footprintCells(ox, oy, def.footprint.w, def.footprint.h)) {
    if (placementOf(def).autoFlatten) {
      b.set("height", c.x, c.y, check.groundHeight);
      // A ramp under a building is a contradiction: the cell is flat now.
      b.set("ramp", c.x, c.y, RAMP.NONE);
    }
    b.set("structureAt", c.x, c.y, structure.id);
  }
  b.addStructure(structure);
  return b.build(`place ${def.name}`);
}

/**
 * The command that removes one structure.
 *
 * It writes only `structureAt`. `clearsTerrain` never erased the material — the
 * renderer skips those cells while something stands on them — so the ground
 * reappears the moment the footprint is freed, with nothing to restore. Had the
 * placement zeroed the layer instead, demolishing would have had to remember
 * what used to be there, and a map edited and reloaded in between would not.
 *
 * Note this does NOT undo the levelling: flattening a hill to build on it is a
 * change to the ground, and knocking the building down does not put the hill
 * back. Undo does, because undo reverses the whole command.
 */
export function demolishCommand(grid: Grid, id: number): Command | null {
  const s = grid.structures.get(id);
  if (!s) return null;
  const b = new PatchBuilder(grid);
  for (const c of footprintCells(s.x, s.y, s.w, s.h)) {
    if (structureAt(grid, c.x, c.y) === id) b.set("structureAt", c.x, c.y, -1);
  }
  b.removeStructure(s);
  return b.build(`demolish ${s.def}`);
}

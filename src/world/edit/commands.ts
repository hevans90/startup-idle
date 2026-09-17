/**
 * World v2 — undo/redo.
 *
 * Built in from the start deliberately: an editor without undo is unusable,
 * and retrofitting it means auditing every mutation after the fact.
 *
 * Because every layer is a dense typed array, the cheap implementation is also
 * the robust one — record the touched cell indices with their before/after
 * values and replay them. No diffing, no structural cloning, and the memory
 * cost is proportional to what actually changed rather than to map size.
 *
 * A drag stroke is ONE command: the tool accumulates cells while the pointer
 * is down and commits on release, so a painted line undoes in a single step
 * rather than fifty.
 */
import { recomputeHeightRange, type Grid, type Structure } from "../grid";

/** Which dense layer a patch applies to. */
export type LayerKey = "terrain" | "height" | "paved" | "ramp" | "structureAt";

export type CellPatch = {
  layer: LayerKey;
  /** Flat indices into the layer, `y * w + x`. */
  idx: Int32Array;
  before: Int32Array;
  after: Int32Array;
};

/**
 * Structure records a command creates or destroys.
 *
 * A RIDER on the cell patches rather than a patch kind of its own: the cells a
 * structure occupies are an ordinary `structureAt` patch, and only the record
 * itself lives outside the dense layers. Keeping it as one optional field means
 * every existing consumer of `patches` — the surface and network predicates,
 * the touched-cell walk — goes on working unchanged.
 *
 * `added` is applied on `do` and reversed on `undo`; `removed` is the mirror.
 * Both lists exist because a single command can do both (replacing a building).
 */
export type StructureRider = {
  added: Structure[];
  removed: Structure[];
};

export type Command = {
  label: string;
  patches: CellPatch[];
  structures?: StructureRider;
};

export type History = {
  past: Command[];
  future: Command[];
  /** Hard cap so a long session cannot grow without bound. */
  limit: number;
};

export const createHistory = (limit = 200): History => ({ past: [], future: [], limit });

/** Accumulates cell writes, then bakes them into one undoable command. */
export class PatchBuilder {
  private readonly cells = new Map<string, { layer: LayerKey; i: number; before: number; after: number }>();

  constructor(private readonly grid: Grid) {}

  /**
   * Stage a write. Re-touching the same cell keeps the ORIGINAL `before`, so a
   * stroke that crosses itself still undoes to where it started.
   */
  set(layer: LayerKey, x: number, y: number, value: number): void {
    const { w, h } = this.grid;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    const key = `${layer}:${i}`;
    const existing = this.cells.get(key);
    if (existing) {
      existing.after = value;
      return;
    }
    this.cells.set(key, { layer, i, before: this.grid[layer][i], after: value });
  }

  get size(): number {
    return this.cells.size;
  }

  private readonly rider: StructureRider = { added: [], removed: [] };

  /** Stage a structure record. Its FOOTPRINT is staged separately, via `set`. */
  addStructure(s: Structure): void {
    this.rider.added.push(s);
  }

  /** Stage the removal of a structure record. */
  removeStructure(s: Structure): void {
    this.rider.removed.push(s);
  }

  /**
   * The value a layer WILL hold once this command applies — the staged write if
   * there is one, else what the grid holds now.
   *
   * Needed because derived layers have to be computed from the edit they are
   * part of. Staging happens before anything is written, so a derivation that
   * read the grid directly would see the state from before the stroke and stage
   * a value that contradicts it. Reading through here keeps the whole edit —
   * primary writes and everything derived from them — in ONE command, so undo
   * reverses it as a unit.
   */
  peek(layer: LayerKey, x: number, y: number): number {
    const { w, h } = this.grid;
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    const i = y * w + x;
    return this.cells.get(`${layer}:${i}`)?.after ?? this.grid[layer][i];
  }

  /** Null when nothing actually changed — so a no-op click adds no history. */
  build(label: string): Command | null {
    const byLayer = new Map<LayerKey, { i: number; before: number; after: number }[]>();
    for (const c of this.cells.values()) {
      if (c.before === c.after) continue;
      const list = byLayer.get(c.layer) ?? [];
      list.push(c);
      byLayer.set(c.layer, list);
    }
    const patches: CellPatch[] = [];
    for (const [layer, list] of byLayer) {
      patches.push({
        layer,
        idx: Int32Array.from(list, (c) => c.i),
        before: Int32Array.from(list, (c) => c.before),
        after: Int32Array.from(list, (c) => c.after),
      });
    }
    if (!patches.length && !this.rider.added.length && !this.rider.removed.length) return null;
    const cmd: Command = { label, patches };
    if (this.rider.added.length || this.rider.removed.length) cmd.structures = this.rider;
    return cmd;
  }
}

/**
 * Add and remove structure RECORDS. The cells they occupy travel as an ordinary
 * `structureAt` patch, so this only maintains the id → record map.
 *
 * `nextStructureId` is only ever advanced, never rewound: a redone command
 * re-adds its records under their original ids, and an id that has been used
 * must not come back around while an undone command still names it.
 */
function applyStructures(grid: Grid, r: StructureRider, dir: "do" | "undo") {
  const add = dir === "do" ? r.added : r.removed;
  const drop = dir === "do" ? r.removed : r.added;
  for (const s of drop) grid.structures.delete(s.id);
  for (const s of add) {
    grid.structures.set(s.id, s);
    if (s.id >= grid.nextStructureId) grid.nextStructureId = s.id + 1;
  }
}

function applyPatches(grid: Grid, cmd: Command, dir: "do" | "undo"): number[] {
  const touched: number[] = [];
  if (cmd.structures) applyStructures(grid, cmd.structures, dir);
  let height = false;
  for (const p of cmd.patches) {
    const src = dir === "do" ? p.after : p.before;
    const arr = grid[p.layer];
    if (p.layer === "height") height = true;
    for (let k = 0; k < p.idx.length; k++) {
      arr[p.idx[k]] = src[k];
      touched.push(p.idx[k]);
    }
  }
  // Patches write the typed arrays DIRECTLY, so they bypass `setHeight` and
  // the range it maintains. `pickCell`'s march bound and the camera AABB both
  // read that range, so a stale one means unpickable hills and a camera that
  // clips them — rescan once per command rather than per cell.
  if (height) recomputeHeightRange(grid);
  return touched;
}

/**
 * Whether a command changes a cell's SURFACE — its height or its ramp.
 *
 * Callers need this to know how far a change spreads: a surface edit alters how
 * the NEIGHBOURS render (a column belongs to the taller cell but exists because
 * of the shorter one), a material edit does not. Exposed as a predicate rather
 * than folded into the return values so undo and redo can be asked BEFORE they
 * run, which is when the answer is needed.
 */
export const touchesSurface = (cmd: Command) =>
  cmd.patches.some((p) => p.layer === "height" || p.layer === "ramp");

/**
 * Whether a command can change road connectivity.
 *
 * `paved` obviously, but `height` and `ramp` too: either can sever or bridge a
 * join without touching `paved` at all. Union-find has no split, so anything
 * here forces a reflood rather than an incremental union.
 */
export const touchesNetwork = (cmd: Command) =>
  cmd.patches.some((p) => p.layer === "paved" || p.layer === "height" || p.layer === "ramp");

/** The command undo would revert next, or null. */
export const peekUndo = (h: History): Command | null =>
  h.past.length ? h.past[h.past.length - 1] : null;

/** The command redo would reapply next, or null. */
export const peekRedo = (h: History): Command | null =>
  h.future.length ? h.future[h.future.length - 1] : null;

/** Applies a command and pushes it onto history, clearing the redo branch. */
export function commit(grid: Grid, hist: History, cmd: Command): number[] {
  const touched = applyPatches(grid, cmd, "do");
  hist.past.push(cmd);
  if (hist.past.length > hist.limit) hist.past.shift();
  hist.future.length = 0; // a new edit invalidates the redo branch
  return touched;
}

/** Returns the touched flat indices, or null when there is nothing to undo. */
export function undo(grid: Grid, hist: History): number[] | null {
  const cmd = hist.past.pop();
  if (!cmd) return null;
  const touched = applyPatches(grid, cmd, "undo");
  hist.future.push(cmd);
  return touched;
}

export function redo(grid: Grid, hist: History): number[] | null {
  const cmd = hist.future.pop();
  if (!cmd) return null;
  const touched = applyPatches(grid, cmd, "do");
  hist.past.push(cmd);
  return touched;
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;
// Index arithmetic rather than Array.prototype.at: the project's TS lib
// target predates it, and widening tsconfig for two call sites is not worth it.
export const undoLabel = (h: History) =>
  h.past.length ? h.past[h.past.length - 1].label : null;
export const redoLabel = (h: History) =>
  h.future.length ? h.future[h.future.length - 1].label : null;

/** Cells a command touches, as x/y — for reconciling sprites after apply. */
export function touchedCells(grid: Grid, touched: number[]): { x: number; y: number }[] {
  const seen = new Set<number>();
  const out: { x: number; y: number }[] = [];
  for (const i of touched) {
    if (seen.has(i)) continue;
    seen.add(i);
    out.push({ x: i % grid.w, y: Math.floor(i / grid.w) });
  }
  return out;
}

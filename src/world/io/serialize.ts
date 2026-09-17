/**
 * World v2 — map file format.
 *
 * Layers travel as base64 typed arrays rather than JSON number arrays: a 64²
 * map is 4,096 cells per layer, which as JSON is tens of kilobytes of decimal
 * text and slow to parse. Structures stay readable JSON, because they are few
 * and worth eyeballing in a diff.
 *
 * The material PALETTE ships with the file. Without it, re-ordering the
 * palette in code would silently repaint every saved map — the indices would
 * still be valid but would mean something else.
 */
import {
  VOID, createGrid, edited, recomputeHeightRange, stampFootprint,
  type Grid, type Structure,
} from "../grid";
import { poolSnapshot, type WaterField } from "../water/field";

export const WORLD_FILE_VERSION = 1;

export type WorldFile = {
  version: number;
  w: number;
  h: number;
  /** base64 Uint16Array */
  terrain: string;
  /** base64 Int8Array — signed, in half steps */
  height: string;
  /** base64 Uint16Array */
  paved: string;
  /**
   * base64 Uint16Array of fluid material indices.
   *
   * OPTIONAL on read, like `ramp`: a file written before pools existed is a
   * valid dry map. Indices, not ids — the material list is append-only for
   * exactly this reason, and re-ordering it would repaint every saved map.
   */
  fluid?: string;
  /**
   * Standing water, in half steps per cell. OPTIONAL on read.
   *
   * Absent means a file written before maps could hold water at all, which
   * is every file written before this: they open dry, which is what they
   * were. Same treatment as `ramp` and for the same reason — a version bump
   * refuses to open a map over a layer whose absence has an obvious answer.
   */
  pool?: string;
  /**
   * base64 Uint8Array of {@link import("../grid").RAMP} directions.
   *
   * OPTIONAL on read rather than a version bump: a file written before ramps
   * existed is still a valid flat map, and rejecting it would buy nothing. It
   * is always written.
   */
  ramp?: string;
  /**
   * base64 Int8Array of spring and drain rates.
   *
   * OPTIONAL on read, like `ramp`: a file written before springs existed has
   * none, and none is what `createGrid` already gives.
   */
  source?: string;
  /**
   * base64 Uint8Array of pipe facings; 0 where there is no pipe.
   *
   * OPTIONAL on read for the same reason as the rest: a file written before
   * pipes existed has none, and none is what `createGrid` gives.
   */
  pipe?: string;
  /**
   * base64 Int8Array of pipe INVERTS — where each pipe's floor sits.
   *
   * Optional beside `pipe` and for the same reason: a map written before pipes
   * had a level of their own has none, and none decodes as zero, which is the
   * map floor. Reading one of those back, a run laid on high ground would
   * arrive buried under it; there is no version of this that is right for
   * every old map, and every old map with a pipe on it is a test fixture.
   */
  pipeZ?: string;
  /**
   * Placed structures, as readable JSON — they are few, and worth eyeballing
   * in a diff.
   *
   * The `structureAt` layer is NOT saved: it is rebuilt by stamping each
   * record's footprint on load. That keeps 16KB of Int32 per 64² map out of
   * the file, and means the layer cannot disagree with the records it indexes,
   * which is the failure a second copy would eventually produce.
   *
   * OPTIONAL on read, like `ramp`: a file written before structures existed is
   * a valid map with none.
   */
  structures?: Structure[];
  /** Index → material id. Index 0 is VOID. Saved so indices keep their meaning. */
  palette: { terrain: (string | null)[]; paved: (string | null)[] };
};

// ── base64 <-> typed arrays ────────────────────────────────────────────────
// Chunked so a large map cannot blow the argument limit of String.fromCharCode.

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const encodeU16 = (a: Uint16Array) => bytesToB64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
const encodeI8 = (a: Int8Array) => bytesToB64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
const encodeU8 = (a: Uint8Array) => bytesToB64(a);

function decodeU8(b64: string, expected: number): Uint8Array {
  const bytes = b64ToBytes(b64);
  const out = new Uint8Array(expected);
  out.set(bytes.subarray(0, Math.min(expected, bytes.length)));
  return out;
}

function decodeU16(b64: string, expected: number): Uint16Array {
  const bytes = b64ToBytes(b64);
  const out = new Uint16Array(expected);
  // copy rather than alias: the decoded buffer may not be correctly aligned
  out.set(new Uint16Array(bytes.buffer, bytes.byteOffset, Math.min(expected, bytes.byteLength >> 1)));
  return out;
}

function decodeI8(b64: string, expected: number): Int8Array {
  const bytes = b64ToBytes(b64);
  const out = new Int8Array(expected);
  out.set(new Int8Array(bytes.buffer, bytes.byteOffset, Math.min(expected, bytes.byteLength)));
  return out;
}

// ── save / load ────────────────────────────────────────────────────────────

/**
 * `water` is the LIVE field, and giving it is what makes a save keep the water
 * that is on the map rather than the water the map was authored with.
 *
 * Pouring is not an edit: it puts water into the running WORLD rather than
 * into the grid, which is why it is not undoable and why the grid knows
 * nothing about it — so a file written from the grid alone comes back as the
 * empty basin the map started as, however long you spent filling it. Handed
 * the field, the file's `pool` layer is the water where it has actually got
 * to. See `poolSnapshot`, which also says what a snapshot cannot carry.
 *
 * Optional, because plenty of callers have a grid and no world running: a test
 * building a map, a fixture written out. Those get the authored layer, which
 * is the right answer for them.
 */
export function serializeWorld(
  grid: Grid,
  palette: { terrain: readonly (string | null)[]; paved: readonly (string | null)[] },
  water?: WaterField,
): WorldFile {
  return {
    version: WORLD_FILE_VERSION,
    w: grid.w,
    h: grid.h,
    terrain: encodeU16(grid.terrain),
    height: encodeI8(grid.height),
    paved: encodeU16(grid.paved),
    fluid: encodeU16(grid.fluid),
    pool: encodeU8(water ? poolSnapshot(water, grid) : grid.pool),
    source: encodeI8(grid.source),
    pipe: encodeU8(grid.pipe),
    pipeZ: encodeI8(grid.pipeZ),
    ramp: encodeU8(grid.ramp),
    structures: [...grid.structures.values()],
    palette: { terrain: [...palette.terrain], paved: [...palette.paved] },
  };
}

export class WorldFileError extends Error {}

/**
 * One structure record, or null if it is not one.
 *
 * Skipped rather than thrown on: a map that has grown one unreadable record is
 * still a map, and refusing to open it loses everything else in the file.
 */
function readStructure(raw: unknown): Structure | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<Structure>;
  const nums = [s.id, s.x, s.y, s.w, s.h];
  if (typeof s.def !== "string" || !nums.every((v) => Number.isInteger(v))) return null;
  if ((s.w as number) <= 0 || (s.h as number) <= 0 || (s.id as number) < 0) return null;
  return { id: s.id!, def: s.def, x: s.x!, y: s.y!, w: s.w!, h: s.h! };
}

/**
 * Rebuild a grid from a file.
 *
 * Deliberately strict about shape but forgiving about content: an unknown
 * material index is left as-is (the renderer already skips a material with no
 * frame), so a file saved against a longer palette degrades to holes rather
 * than refusing to open.
 */
export function deserializeWorld(file: unknown): { grid: Grid; palette: WorldFile["palette"] } {
  if (!file || typeof file !== "object") throw new WorldFileError("not an object");
  const f = file as Partial<WorldFile>;
  if (f.version !== WORLD_FILE_VERSION) {
    throw new WorldFileError(`unsupported version ${String(f.version)}`);
  }
  const { w, h } = f;
  if (!Number.isInteger(w) || !Number.isInteger(h) || (w as number) <= 0 || (h as number) <= 0) {
    throw new WorldFileError(`bad size ${String(w)}×${String(h)}`);
  }
  if (typeof f.terrain !== "string" || typeof f.height !== "string" || typeof f.paved !== "string") {
    throw new WorldFileError("missing layer data");
  }
  const n = (w as number) * (h as number);
  const grid = createGrid(w as number, h as number);
  grid.terrain.set(decodeU16(f.terrain, n));
  grid.height.set(decodeI8(f.height, n));
  grid.paved.set(decodeU16(f.paved, n));
  // absent means a pre-ramp file: every cell level, which createGrid already gives
  if (typeof f.ramp === "string") grid.ramp.set(decodeU8(f.ramp, n));
  if (typeof f.fluid === "string") grid.fluid.set(decodeU16(f.fluid, n));
  if (typeof f.pool === "string") grid.pool.set(decodeU8(f.pool, n));
  if (typeof f.source === "string") grid.source.set(decodeI8(f.source, n));
  if (typeof f.pipe === "string") grid.pipe.set(decodeU8(f.pipe, n));
  if (typeof f.pipeZ === "string") grid.pipeZ.set(decodeI8(f.pipeZ, n));
  grid.structureAt.fill(-1);
  for (const raw of Array.isArray(f.structures) ? f.structures : []) {
    const s = readStructure(raw);
    if (!s) continue;
    grid.structures.set(s.id, s);
    stampFootprint(grid, s);
    if (s.id >= grid.nextStructureId) grid.nextStructureId = s.id + 1;
  }
  recomputeHeightRange(grid);
  // A LOADED MAP IS AN EDIT, and the bulkiest one there is. The layers go in
  // by `set` rather than through any setter, so nothing else says so. @see edited
  edited(grid);
  const palette = {
    terrain: f.palette?.terrain ?? [null],
    paved: f.palette?.paved ?? [null],
  };
  if (palette.terrain[0] !== null || palette.paved[0] !== null) {
    // index 0 must stay VOID or every material shifts by one
    palette.terrain[0] = null;
    palette.paved[0] = null;
  }
  void VOID;
  return { grid, palette };
}

export const toJSON = (f: WorldFile) => JSON.stringify(f);
export const fromJSON = (s: string) => deserializeWorld(JSON.parse(s));

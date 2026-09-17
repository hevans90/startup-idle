/**
 * The map, kept across reloads.
 *
 * WHY NOT `persist` MIDDLEWARE, which every other store here uses. Zustand's
 * `partialize` runs on every `set()`, and the world store sets on every brush
 * stroke — so the map would be serialised, base64'd and written to localStorage
 * once per painted cell. A 64² map is tens of kilobytes; a drag is hundreds of
 * writes. The other stores hold a handful of numbers and do not have this
 * problem.
 *
 * So saving is EXPLICIT and debounced, on the same triggers the session store
 * already uses for presence — an interval and page-hide (`App.tsx`). @see touch
 *
 * THE FORMAT IS THE ONE THAT ALREADY EXISTS. `serializeWorld` is versioned,
 * round-trips through tests, and is what the editor's save button writes. A
 * second format for autosave would be a second thing to migrate.
 */
import {
  WorldFileError, deserializeWorld, serializeWorld, toJSON, type WorldFile,
} from "./serialize";
import type { Grid } from "../grid";
import type { WaterField } from "../water/field";

/** Where the autosave lives. Distinct from the game's own persisted stores. */
const KEY = "world-map";

/**
 * How long after the last edit the map is written.
 *
 * Long enough that a drag is one write rather than a hundred; short enough that
 * a tab closed straight after an edit still keeps it — and page-hide flushes
 * anyway, which is the case that actually matters. @see saveNow
 */
const DEBOUNCE_MS = 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: (() => WorldFile) | null = null;

/** Write immediately, cancelling any debounce. Safe to call when nothing waits. */
export function saveNow(): void {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  const make = pending;
  pending = null;
  if (!make) return;
  try {
    localStorage.setItem(KEY, toJSON(make()));
  } catch {
    // A full or blocked localStorage must not take the editor down with it.
    // The map is still in memory and the manual save button still works.
  }
}

/**
 * Note that the map changed; write it a moment later.
 *
 * Takes a THUNK rather than a `WorldFile` so an edit costs nothing but storing
 * a closure — the serialisation happens once, when the debounce fires, however
 * many edits arrived in between.
 */
export function saveSoon(make: () => WorldFile): void {
  pending = make;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(saveNow, DEBOUNCE_MS);
}

/** The whole of what a caller needs to hand over. @see serializeWorld */
export type SaveInput = {
  grid: Grid;
  palette: { terrain: readonly (string | null)[]; paved: readonly (string | null)[] };
  water?: WaterField;
};

/** Queue a save of this world. @see saveSoon */
export const scheduleSave = (get: () => SaveInput): void =>
  saveSoon(() => {
    const { grid, palette, water } = get();
    return serializeWorld(grid, palette, water);
  });

/**
 * The saved map, or null if there is none or it cannot be read.
 *
 * NEVER THROWS. A map that will not parse — a half-written entry, a file from a
 * future version — must start a new world rather than a blank screen, and the
 * loader already refuses an unknown version by throwing `WorldFileError`.
 */
export function loadSaved(): { grid: Grid; palette: WorldFile["palette"] } | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;                                // storage blocked entirely
  }
  if (!raw) return null;
  try {
    return deserializeWorld(JSON.parse(raw));
  } catch (e) {
    console.warn(
      "WORLD: the saved map could not be read and has been left alone —",
      e instanceof WorldFileError ? e.message : e,
    );
    return null;
  }
}

/** Whether a map has been saved at all. Cheap: no parse. */
export function hasSaved(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

/** Forget the saved map. Used by a deliberate reset, not by a failed load. */
export function clearSaved(): void {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  pending = null;
  try {
    localStorage.removeItem(KEY);
  } catch { /* nothing to do and nothing to say */ }
}

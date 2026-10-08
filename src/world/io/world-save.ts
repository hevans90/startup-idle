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
import type { Fleet } from "../boats/fleet";
import type { WaterField } from "../water/field";

/**
 * Where the autosave lives. Distinct from the game's own persisted stores.
 *
 * TWO SLOTS, because there are two maps. The EDITOR's (`?world=1`) is
 * somebody's authored map, kept until they throw it away. The RUN's is the
 * company's, made new for every company and thrown away when it is sold. Kept
 * apart so that ending a run can never take the editor's map with it — the
 * game's first exit would otherwise have deleted a map built by hand.
 * @see setSaveSlot, retireRunSave
 */
const SLOTS = { editor: "world-map", run: "world-run" } as const;
export type SaveSlot = keyof typeof SLOTS;
let KEY: string = SLOTS.editor;

/** Which map this page saves to and loads from. Set before anything loads. */
export function setSaveSlot(slot: SaveSlot): void {
  KEY = SLOTS[slot];
}

/**
 * Saving held off, while a map is in memory that must not be written: the
 * one a sold company left behind, between its exit and the next company's
 * map. Its last flush on unmount, and any save still queued, would otherwise
 * write it straight back over the slot that was just cleared. @see retireRunSave
 */
let suspended = false;
export function suspendSaving(on: boolean): void {
  suspended = on;
  if (on) { if (timer !== null) { clearTimeout(timer); timer = null; } pending = null; }
}

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
  if (!make || suspended) return;
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
  if (suspended) return;
  pending = make;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(saveNow, DEBOUNCE_MS);
}

/** The whole of what a caller needs to hand over. @see serializeWorld */
export type SaveInput = {
  grid: Grid;
  palette: { terrain: readonly (string | null)[]; paved: readonly (string | null)[] };
  water?: WaterField;
  fleet?: Fleet;
};

/** Queue a save of this world. @see saveSoon */
export const scheduleSave = (get: () => SaveInput): void =>
  saveSoon(() => {
    const { grid, palette, water, fleet } = get();
    return serializeWorld(grid, palette, water, fleet);
  });

/**
 * The saved map, or null if there is none or it cannot be read.
 *
 * NEVER THROWS. A map that will not parse — a half-written entry, a file from a
 * future version — must start a new world rather than a blank screen, and the
 * loader already refuses an unknown version by throwing `WorldFileError`.
 */
export function loadSaved(): ReturnType<typeof deserializeWorld> | null {
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

/**
 * THE COMPANY WAS SOLD, and its map goes with it.
 *
 * Forgets the run's saved map and, if this page is saving to it, holds saving
 * off until the next map is loaded — so the sold company's map, still in
 * memory and flushed by the world's unmount, is not written straight back.
 * The next company's map is made when the world next mounts and finds no save:
 * generated fresh from the day it was incorporated. The editor's map is never
 * touched, whichever slot this page is on. @see resetRunStores, useFoundWorld
 */
export function retireRunSave(): void {
  if (KEY === SLOTS.run) suspendSaving(true);
  try {
    localStorage.removeItem(SLOTS.run);
  } catch { /* nothing to do and nothing to say */ }
}

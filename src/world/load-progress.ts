/**
 * World v2 — WHAT A MAP'S FIRST LOAD IS WAITING FOR, kept in one place for the screen that says so.
 *
 * Told by whoever does each thing: the GPU's device opened, the scenery's pictures asked for and come, the first
 * frame of the map handed over, the water's solver built. The screen over the canvas reads it and lifts when all of
 * it is done and the GPU has caught up. @see map-loading.tsx
 *
 * THE SCENERY, NOT WHAT MOVES: the houses, trees, street furniture, landmarks, cranes and boats are counted — the
 * people's and the vehicles' sheets are four times all of those together, and a street its traffic drives into a
 * moment late is not a map popping in.
 */
export type LoadProgress = {
  /** The GPU's device is open (or there is none to wait for). */
  device: boolean;
  /** The map's first frame has been handed to the GPU. */
  frame: boolean;
  /** The water's solver is built (or the water is not the GPU's). */
  water: boolean;
  /** Scenery pictures asked for, and how many of them have come. */
  asked: number;
  come: number;
};

let now: LoadProgress = { device: false, frame: false, water: false, asked: 0, come: 0 };
const told = new Set<() => void>();
const set = (p: Partial<LoadProgress>) => {
  now = { ...now, ...p };
  for (const fn of [...told]) fn();
};

export const loadProgress = (): LoadProgress => now;
export const onLoadProgress = (fn: () => void): (() => void) => { told.add(fn); return () => told.delete(fn); };

/** A map's canvas is being put up: its frame and its water are to come again. (What is fetched stays fetched.) */
export const loadBegan = () => set({ frame: false, water: false });
export const loadDeviceOpen = () => { if (!now.device) set({ device: true }); };
export const loadFrameDrawn = () => { if (!now.frame) set({ frame: true }); };
export const loadWaterReady = () => { if (!now.water) set({ water: true }); };

/** One of the scenery's pictures being fetched: counted when asked for, and when it has come or failed. */
export function sceneryLoad<T>(p: Promise<T>): Promise<T> {
  set({ asked: now.asked + 1 });
  const done = () => set({ come: now.come + 1 });
  p.then(done, done);
  return p;
}

/** What the load is at, in a few words: the first of these not yet done. Null when nothing is left but the GPU. */
export function loadStage(p: LoadProgress): string | null {
  if (!p.device) return "Opening the GPU";
  if (!p.frame) return "Building the map";
  if (p.come < p.asked) return `Loading sprites · ${p.come} of ${p.asked}`;
  if (!p.water) return "Starting the water";
  return null;
}

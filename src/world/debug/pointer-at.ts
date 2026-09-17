/**
 * Where the pointer is in world space — a latch, not store state.
 *
 * It was a `set` per pointer move with a FRESH OBJECT every time, so every
 * subscriber woke on every move whether the value meant anything to them or
 * not. `WorldScene` was one of them — the component that mounts the whole Pixi
 * tree — so a mouse crossing the canvas re-rendered it about a hundred times a
 * second, and after the water meta went this was what react-dom still had left
 * in the profile.
 *
 * Two things read it and both can wait: the pick crosshair, which is drawn in
 * the tick beside everything else it overlays, and the calibration panel,
 * which polls. @see waterMetaSaw, which is the same rule and the same shape —
 * a number that changes faster than a person can click does not go in the
 * store.
 */
export type PointerAt = { wx: number; wy: number; fx: number; fy: number };

let last: PointerAt | null = null;

export const pointerSaw = (p: PointerAt | null) => { last = p; };
export const pointerRead = (): PointerAt | null => last;

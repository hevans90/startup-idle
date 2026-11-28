/**
 * WHAT THE SUN MOVING MAY REDRAW IN A FRAME (the editor's slider), ms: buildings lit again, and houses drawn from
 * the sheet's lit copy as the sun leaves home or back from it as it returns. A whole town at once was a frame of a sixth of a second; the rest wait for the next
 * frames. Back to none once the frame's tick is done. @see project-renderer, tiles-renderer
 */
const BUDGET_MS = 1.5;
let spent = 0, open = false;
/** Whether this frame has time left for it. */
export function sunBudgetLeft(): boolean {
  if (!open) { open = true; spent = 0; queueMicrotask(() => { open = false; }); }
  return spent < BUDGET_MS;
}
/** Time spent on it, ms. */
export const sunSpend = (ms: number) => { spent += ms; };

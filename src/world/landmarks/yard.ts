/**
 * World v2 — THE YARD of the company's own building, in numbers: what the model, the placing of it and the
 * game's own crane all have to agree on. Plot tiles: `u` across from the building's far corner, `v` to the front.
 * @see models (the yard as it is baked), structures/place (the road its gate needs), render/line-works (its crane)
 */

/** The Garage and what it grows into. */
export const YARD_DEFS: readonly string[] = ["garage", "hq", "boardroom", "ipo"];
/** How wide a plot with a yard is: the building's three tiles and two for the yard. */
export const YARD_WIDTH = 5;
/**
 * THE YARD'S GATE, on the plot: the middle of its last tile, on its front edge — and the tile in front of it must be
 * road. Where its crane stands, the stack it loads from, and where the lorry it is loading draws up. @see place, line-works
 */
export const YARD_GATE = { u: 4.5, tile: 4 } as const;
export const YARD_CRANE = { u: 4.0, v: 2.38 }, YARD_STACK = { u: 3.49, v: 2.55 }, YARD_BAY = { u: 4.5, v: 2.38 };

/**
 * The road tile a yard's gate opens on: the one in front of its last tile — or, the yard turned to face the back
 * of its plot (`facing` "N"), the one behind it. A yard faces whichever has the road. @see place
 */
export const gateRoad = (s: { x: number; y: number; h: number; facing?: string }) => ({ x: s.x + YARD_GATE.tile, y: s.facing === "N" ? s.y - 1 : s.y + s.h });
/** A place in a yard on a plot `h` deep, as that yard faces: the same place, mirrored front to back, when it faces the back. */
export const inYard = (p: { u: number; v: number }, s: { h: number; facing?: string }) => ({ u: p.u, v: s.facing === "N" ? s.h - p.v : p.v });
/** Whether a structure is a yard's building on a plot wide enough to have the yard. */
export const hasYard = (s: { def: string; w: number }) => s.w >= YARD_WIDTH && YARD_DEFS.includes(s.def);

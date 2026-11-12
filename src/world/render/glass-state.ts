/**
 * World v2 — WHAT A WINDOW IS TOLD TO SHOW, in place of what its pipe holds:
 * for the glass gallery, where every state a window can be in has to be
 * looked at side by side and no solver can be made to hold them all at once.
 * Nothing sets this in the game. @see buildGlassGallery, mains-layer showGlass
 */
import type { Grid } from "../grid";

/** A window's state, told: how full its pipe stands (nought to one) at the tile's middle and how that changes a tile along; tiles a second, signed along the run; how much of it is slop. */
export type GlassTold = { fill: number; tilt: number; speed: number; slop: number };
export type GlassTeller = (g: Grid, cell: number, seconds: number) => GlassTold | null;

let teller: GlassTeller | null = null;
/** What says what the windows show, or null: the pipes themselves. */
export const glassOverride = (): GlassTeller | null => teller;
export const setGlassOverride = (t: GlassTeller | null) => { teller = t; };

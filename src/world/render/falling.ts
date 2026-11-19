/**
 * FALLING LEAVES AND PETALS: in the autumn leaves drifting down off the woods' turning trees, in the spring petals
 * off the cherry and the apple in blossom — from a handful of trees in view, so it is a few here and there and not
 * a blizzard. Given off by the juice (@see disaster-fx LEAVES, PETALS); which trees, here. Pure.
 */
import { EVERGREEN, yearPart } from "../calendar";
import type { Grid } from "../grid";
import { COVER, vegAt } from "../vegetation/fields";
import { forestTrees, woodOf } from "./forest";

type Palette = readonly (string | null)[];

/** The most trees giving off at once. */
export const FALL_MOST = 14;
/** When in the year: leaves through the autumn, petals while the blossom is over. */
export const LEAVES_FALL = [0.58, 0.76] as const, PETALS_FALL = [0.07, 0.16] as const;
/** Kinds that blossom. */
const BLOSSOM: ReadonlySet<string> = new Set(["cherry", "apple"]);

export type Fall = { x: number; y: number; what: "leaves" | "petals" };

const hash = (x: number, y: number, salt: number) =>
  ((Math.imul(Math.imul(x, 0x2c1b3c6d) ^ Math.imul(y, 0x297a2d39) ^ salt, 0x85ebca6b) >>> 8) & 0xffff) / 0x10000;

/**
 * THE TREES GIVING OFF at `t` (years), of those whose cell `inView` says is on screen: a few of the woods', the
 * same while the calendar's ten seconds last, then others.
 */
export function fallWanted(g: Grid, palette: Palette, t: number, inView: (x: number, y: number) => boolean, most = FALL_MOST): Fall[] {
  const y0 = yearPart(t);
  const what = y0 >= LEAVES_FALL[0] && y0 < LEAVES_FALL[1] ? "leaves" : y0 >= PETALS_FALL[0] && y0 < PETALS_FALL[1] ? "petals" : null;
  if (!what) return [];
  const salt = Math.floor(t * 360);
  const seen: { x: number; y: number; r: number }[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const c = g.veg.cover[vegAt(g, palette, x, y)];
    if (c !== COVER.wood && c !== COVER.scrub && c !== COVER.row) continue;
    if (woodOf(g, palette, x, y) <= 0 && c !== COVER.row || !inView(x, y)) continue;
    seen.push({ x, y, r: hash(x, y, salt) });
  }
  seen.sort((a, b) => a.r - b.r);
  const out: Fall[] = [];
  for (let k = 0; k < seen.length && k < most * 5 && out.length < most; k++) {
    const { x, y } = seen[k];
    const kinds = forestTrees(g, palette, x, y).map((tr) => tr.kind);
    const gives = what === "petals" ? kinds.some((n) => BLOSSOM.has(n)) : kinds.some((n) => !EVERGREEN.has(n) && n !== "shrub" && n !== "flowers");
    if (gives) out.push({ x, y, what });
  }
  return out;
}

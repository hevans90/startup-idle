/**
 * World v2 — WHICH FIGURE EACH PERSON IS: pure, a hash of their id, so they
 * look the same for as long as they walk. Anyone sent on a job — building,
 * cleaning up — is a builder in hi-vis and a hard hat, so a crew can be told
 * from a crowd. @see figures.ts, town-render
 */
import type { Mover } from "../town";

/** Walkers' figures, and how often each is seen. */
export const FIGURE_WEIGHTS: Readonly<Record<string, number>> = {
  suit: 3, casual: 4, longHair: 3, skirt: 2, bun: 2, ponytail: 2, curly: 2, bald: 2, shorts: 2, skirtLong: 1, slim: 2,
};
const PICKS = Object.entries(FIGURE_WEIGHTS).flatMap(([id, w]) => Array<string>(w).fill(id));
const ofId = <T>(id: number, salt: number, list: readonly T[]) =>
  list[Math.abs(Math.imul(id ^ salt, 0x9e3779b1) >>> 7) % list.length];

export function figureFor(m: Pick<Mover, "id" | "job">): string {
  if (m.job && m.job.role !== "moving-in") return "builder";
  return ofId(m.id, 0x9e0, PICKS);
}

/** How tall, as a share of the figure: people differ by a tenth or so either way. */
export const heightOf = (id: number) => 0.92 + 0.14 * ((Math.imul(id ^ 0x5eed, 0x2c1b3c6d) >>> 8) % 1000) / 1000;

/**
 * World v2 — WHICH FIGURE EACH PERSON IS: pure, a hash of their id, so they
 * look the same for as long as they walk. Anyone sent on a job — building,
 * cleaning up — is a builder in hi-vis and a hard hat, so a crew can be told
 * from a crowd. @see figures.ts, town-render
 */
import type { Mover } from "../town";
import { RIDERS } from "./people-format";

/** Walkers' figures, and how often each is seen. */
export const FIGURE_WEIGHTS: Readonly<Record<string, number>> = {
  suit: 3, casual: 4, longHair: 3, skirt: 2, bun: 2, ponytail: 2, curly: 2, bald: 2, shorts: 2, skirtLong: 1, slim: 2,
};
const PICKS = Object.entries(FIGURE_WEIGHTS).flatMap(([id, w]) => Array<string>(w).fill(id));
const ofId = <T>(id: number, salt: number, list: readonly T[]) =>
  list[Math.abs(Math.imul(id ^ salt, 0x9e3779b1) >>> 7) % list.length];

/**
 * WHO SOMEBODY IS, for how they look: themselves — or, got out of a car or walking out to one, the one of its
 * people they are, so whoever is seen at the wheel is who is seen walking away. @see riderId
 */
export const whoOf = (m: Pick<Mover, "id" | "as">): number => m.as ?? m.id;
/** The `k`th of a vehicle's people, the driver nought: who they are, the same on foot and in it. */
export const riderId = (vehicle: number, k: number): number => 0x4000000 + vehicle * 8 + k;

/** The figure somebody of this identity is, were they nobody in particular. */
export const figureOfId = (id: number): string => ofId(id, 0x9e0, PICKS);
export function figureFor(m: Pick<Mover, "id" | "job" | "look" | "as">): string {
  if (m.job && m.job.role !== "moving-in") return "builder";
  return m.look ?? figureOfId(whoOf(m));
}

/** What people are made of and wear: skins, hair, trousers, shirts. */
export const SKINS = [0xf1d0b0, 0xe0b48e, 0xc68c5d, 0x9c6a43, 0x6e4a2f];
export const HAIRS = [0x2b2118, 0x4a3324, 0x8a5a2b, 0xd9b26a, 0x1c1c1c, 0x9a9a9a];
export const TROUSERS = [0x3a3f4b, 0x2f4a6b, 0x5b4a3a, 0x2b2b2b, 0x6b6f75];
export const SHIRTS = [0xd35454, 0x4a7fc1, 0xe6c35c, 0x5aa36b, 0x9b6bc2, 0xe08a3c, 0xf0f0f0];
/** Somebody's own colours, by who they are: the same always. */
export const skinOf = (id: number) => ofId(id, 0x51, SKINS);
export const hairOf = (id: number) => ofId(id, 0x7a, HAIRS);
export const legsOf = (id: number) => ofId(id, 0x33, TROUSERS);
export const shirtOf = (id: number) => ofId(id, 0x5a17, SHIRTS);

/** Which figure rides a bike: one of those dressed for it. @see RIDERS */
export const riderFor = (m: Pick<Mover, "id">): string => ofId(m.id, 0xb1c, RIDERS);

/** How tall, as a share of the figure: people differ by a tenth or so either way. */
export const heightOf = (id: number) => 0.92 + 0.14 * ((Math.imul(id ^ 0x5eed, 0x2c1b3c6d) >>> 8) % 1000) / 1000;

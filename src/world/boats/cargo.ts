/**
 * World v2 — WHAT A SHIP CARRIES, box by box.
 *
 * A ship's cargo is so many boxes, each in a SLOT on her deck: containers on
 * a container ship, crates on anything smaller. They are drawn one by one,
 * and worked one by one — a crane's lift takes the top box off, or sets one
 * down — so what is seen on the hook is what has left the deck.
 * @see traffic workOf, boats-render, seaport-renderer
 *
 * A ship's slots are in the order she is LOADED: the bottom tier first. She
 * is unloaded from the last. In metres in her own frame — `x` to the bow,
 * `z` up from the waterline — each the middle of a box's floor.
 */
import { BOX, CRATE } from "../structures/cranes/models";
import { SHIP_CLASSES } from "./classes";
import { TILES_PER_M } from "../agents/cars/models";

export type Slot = { x: number; y: number; z: number };
export type Cargo = { kind: "box" | "crate"; slots: readonly Slot[]; house: number };

/** A grid of slots: along her at `xs`, across at `ys`, `tiers` high from `z`, a tier at a time. */
function grid(xs: readonly number[], ys: readonly number[], z: number, tiers: number, tall: number): Slot[] {
  const out: Slot[] = [];
  for (let t = 0; t < tiers; t++) for (const x of xs) for (const y of ys) out.push({ x, y, z: z + t * (tall + 0.04) });
  return out;
}

const L = (cls: number) => SHIP_CLASSES[cls].length / TILES_PER_M;

/** Each look's cargo: what it is, where it goes, and how far along her the house is, to know which hides which. */
const CARGO: Readonly<Record<string, Cargo>> = {
  fishing: { kind: "crate", slots: grid([-2.9], [-0.85, 0.85], 1.0, 1, CRATE.tall), house: 1.6 },
  lighter: { kind: "crate", slots: grid([1.85, -0.35], [0], 1.07, 2, CRATE.tall), house: -3.1 },
  coaster: { kind: "crate", slots: grid([3.3, 1.0, -1.3], [-0.9, 0.9], 2.0, 2, CRATE.tall), house: -L(1) * 0.33 },
  container: { kind: "box", slots: grid([4.6, -1.3], [-1.22, 1.22], 2.3, 3, BOX.tall), house: -L(2) * 0.38 },
};

/** What a ship of this look carries, or null for one with no cargo to work. */
export const cargoOf = (look: string): Cargo | null => CARGO[look] ?? null;

/** Which look a ship is: by its size, and what it has come for. `odd` varies the plain trading boats. */
export function lookOf(cls: number, fit: string | undefined, ai: boolean, odd: boolean): string {
  if (cls === 2) return "container";
  if (cls === 1) return "coaster";
  if (ai) return "drone";
  if (fit === "ferry") return "ferry";
  if (fit === "pontoon") return "yacht";
  if (fit === "crane" || fit === "hardware") return "lighter";
  return odd ? "fishing" : "dinghy";
}

/** The colours boxes come in. */
export const BOX_TINTS: readonly number[] = [0x3f6e9c, 0xb8463a, 0x2f7d5b, 0xd9a23a, 0xc9c4b8, 0x9c6b3a, 0x7a4f8a, 0x2f8f9a];
/** And crates: wood, weathered or new. */
export const CRATE_TINTS: readonly number[] = [0xc9a26b, 0xb58a52, 0xd8b98a, 0xa97c48];

/** What colour the box in a ship's slot is: the same for that ship and slot always. */
export const slotTint = (kind: "box" | "crate", ship: number, slot: number): number => {
  const list = kind === "box" ? BOX_TINTS : CRATE_TINTS;
  return list[Math.abs(Math.imul(ship * 31 + slot * 7 + 3, 0x9e3779b1) >>> 9) % list.length];
};

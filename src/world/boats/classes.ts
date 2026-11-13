/**
 * World v2 — the SHIPS that come up a river, by size.
 *
 * Three, each needing more of the river than the last: deeper water all the
 * way from where the river comes in to its berth and on to the way out, more
 * room to turn at the quay, and a bigger port to call at. What a port is
 * paid follows what it can take. @see plans/seaports.md §2
 *
 * A CALL IS WORTH THE BERTH-TIME IT TAKES, and a little over: a coaster lies
 * twice as long as a boat and pays 2.2 times; a ship lies three times as long
 * across two berths, is turned by the tug at either end of it, and pays 16
 * times. MEASURED through the traffic (simulation/port-balance.test.ts), a
 * port's fees a minute against the same port on water for boats alone:
 *
 *   tier 2, coasters           — a fifth more
 *   tier 3, coasters           — a fifth more
 *   tier 3, coasters and ships — a third more
 *
 * So deep water is worth having, and deeper worth more. At 7.5, as she paid
 * before she was turned, a ship earned her port a quarter LESS than the
 * coasters she kept off the quay.
 */
export type ShipClass = {
  id: "boat" | "coaster" | "ship";
  name: string;
  /** Length and beam, tiles. */
  length: number;
  beam: number;
  /** Water under it to float, half steps. */
  draft: number;
  /** Deeper than this, half steps, and a tile is channel for it. */
  depth: number;
  /** The smallest port it calls at, by its berths. */
  tier: number;
  /** How many times a boat's call its call lasts, and pays. */
  dock: number;
  pay: number;
  /** Berths it lies across. */
  span: number;
  /** Tiles of its channel it needs among the nine round its berth, to turn. */
  basin: number;
  /** Cannot pass under a bridge. */
  tall?: boolean;
};

export const SHIP_CLASSES: readonly ShipClass[] = [
  { id: "boat", name: "Boat", length: 0.84, beam: 0.36, draft: 0.5, depth: 1, tier: 1, dock: 1, pay: 1, span: 1, basin: 0 },
  { id: "coaster", name: "Coaster", length: 1.5, beam: 0.5, draft: 1.5, depth: 3, tier: 2, dock: 2, pay: 2.2, span: 1, basin: 4 },
  { id: "ship", name: "Ship", length: 2.4, beam: 0.62, draft: 2.5, depth: 5, tier: 3, dock: 3, pay: 16, span: 2, basin: 6, tall: true },
];

/** Seconds a call takes beyond its time alongside: coming in from where she waited, and getting away. Measured. */
export const ALONGSIDE = 4;

/** A class by its number, a boat for anything else. */
export const classOf = (k: number | undefined): ShipClass => SHIP_CLASSES[k ?? 0] ?? SHIP_CLASSES[0];

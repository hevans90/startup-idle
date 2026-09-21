/**
 * The one rule, and the four cases it is supposed to have replaced.
 *
 * Each of the first four tests is a bridge situation that used to need its own
 * hand-written branch in the solver. None of them is named in `slots.ts`;
 * they are all the same intersection with different numbers in it, and that is
 * the whole claim being made here.
 *
 * Heights are HALF STEPS. A slab is two of them, so a deck four slabs over a
 * riverbed is a roof eight above the floor.
 */
import { describe, expect, it } from "bun:test";
import {
  OPEN_SKY, PRESSURE_SLOT, connected, head, overlapHi, overlapLo, present, wetTop,
} from "./slots";

/** A riverbed at 0 with a deck four slabs up, as the two slots it makes. */
const CHANNEL = { floor: 0, roof: 8 };     // under the span
const DECK = { floor: 9, roof: OPEN_SKY }; // on the span, the deck being 1 thick
/** The road either end of the bridge: one slot, level with the deck. */
const ROAD = { floor: 9, roof: OPEN_SKY };
/** Open ground beside the span, down at the water. */
const BANK = { floor: 0, roof: OPEN_SKY };

const link = (a: { floor: number; roof: number }, b: { floor: number; roof: number }) =>
  connected(a.floor, a.roof, b.floor, b.roof);

describe("the four cases that used to be branches", () => {
  it("a road meets a deck at the same level, so water crosses", () => {
    expect(link(ROAD, DECK)).toBe(true);
    // And over a sill at road level, not at the riverbed.
    expect(overlapLo(ROAD.floor, DECK.floor)).toBe(9);
  });

  it("the same road does not pour into the channel under that deck", () => {
    expect(link(ROAD, CHANNEL)).toBe(false);
  });

  it("off the side of a span the water leaves, over a drop", () => {
    expect(link(DECK, BANK)).toBe(true);
    // The sill is the deck's own floor, so the drop below it is a fall of
    // nine and not a flow along the ground.
    expect(overlapLo(DECK.floor, BANK.floor)).toBe(9);
  });

  it("a deck cannot leak into the channel beneath it", () => {
    expect(link(DECK, CHANNEL)).toBe(false);
  });
});

describe("connection", () => {
  it("is what ordinary ground has always done", () => {
    // Two open columns at any two heights are connected: this is the case
    // every existing map is made of, and it must not have acquired a test.
    for (const a of [-40, 0, 3, 126]) {
      for (const b of [-40, 0, 3, 126]) {
        expect(connected(a, OPEN_SKY, b, OPEN_SKY)).toBe(true);
      }
    }
  });

  it("is refused when the gap has no height", () => {
    // A deck whose underside sits exactly at the neighbouring road's level.
    expect(connected(9, OPEN_SKY, 0, 9)).toBe(false);
    // One half step of gap is a gap.
    expect(connected(9, OPEN_SKY, 0, 10)).toBe(true);
  });

  it("is symmetric", () => {
    const slots = [CHANNEL, DECK, ROAD, BANK, { floor: 4, roof: 12 }];
    for (const a of slots) for (const b of slots) {
      expect(link(a, b)).toBe(link(b, a));
    }
  });

  it("carries a lid, which is the shorter of the two roofs", () => {
    // A channel under a deck, against an open bank lower down: the water can
    // only push through the height of the channel, not the height of the bank.
    expect(overlapHi(CHANNEL.roof, BANK.roof)).toBe(8);
  });
});

describe("an absent slot", () => {
  it("is one with no room, and is not present", () => {
    expect(present(9, 9)).toBe(false);
    expect(present(0, OPEN_SKY)).toBe(true);
  });

  it("connects to nothing, which is why it needs no flag", () => {
    for (const other of [CHANNEL, DECK, ROAD, BANK]) {
      expect(link({ floor: 9, roof: 9 }, other)).toBe(false);
    }
  });
});

describe("the surface of a slot", () => {
  it("is the plain sum while there is room above it", () => {
    expect(head(0, 8, 3)).toBe(3);
    expect(wetTop(0, 8, 3)).toBe(3);
    // And with no roof at all it can never be anything else.
    expect(head(0, OPEN_SKY, 500)).toBe(500);
  });

  it("keeps climbing once the slot is full, but in something narrow", () => {
    // Eight of room and ten of water: two are in the pressure slot.
    expect(head(0, 8, 10)).toBeCloseTo(8 + 2 * PRESSURE_SLOT, 10);
    expect(head(0, 8, 10)).toBeGreaterThan(8);
  });

  it("is continuous at the moment it fills", () => {
    const below = head(0, 8, 8 - 1e-9), above = head(0, 8, 8 + 1e-9);
    expect(Math.abs(above - below)).toBeLessThan(1e-6);
  });

  it("still drives flow when full, which is the point of it", () => {
    // Two full culvert cells, one with more water in it than the other. A
    // scheme that clamped the surface at the roof would see no head here and
    // the water would never move.
    expect(head(0, 8, 12) - head(0, 8, 9)).toBeGreaterThan(0);
  });

  it("does not draw water inside the bridge", () => {
    expect(wetTop(0, 8, 10)).toBe(8);
    expect(wetTop(0, 8, 500)).toBe(8);
  });
});

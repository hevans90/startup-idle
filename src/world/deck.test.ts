/**
 * A DECK: a second surface over a cell, with a gap under it.
 *
 * The world is a heightfield everywhere else — one surface per cell — and
 * that is what makes the projection cheap and the picker a short march. This
 * is the one exception, so what it is held to is that it changes NOTHING
 * about the ground it spans. A bridge that altered the river under it would
 * be a hill with a road on top.
 */
import { describe, expect, test } from "bun:test";

import {
  createGrid, fillTerrain, idx, setDeck, setHeight, surfaceHeightAt, surfaceSampler,
} from "./grid";
import { applyFixture } from "./debug/fixtures";
import { createWaterField, depthAt, stepWater, totalVolume } from "./water/field";
import { deserializeWorld, serializeWorld } from "./io/serialize";
import { componentCount, createNetwork } from "./roads/network";

const PALETTE = { terrain: [null, "grass.png"], paved: [null, "road.png"] };

describe("a deck", () => {
  test("stands over the ground rather than replacing it", () => {
    const g = createGrid(8, 8);
    fillTerrain(g, 1);
    setHeight(g, 3, 3, 4);
    setDeck(g, 3, 3, 1, 20);
    const i = idx(g, 3, 3);
    // The TERRAIN is where it was — this is the property everything else here
    // depends on, and the one a "just raise the ground" bridge would fail.
    expect(g.height[i]).toBe(4);
    expect(g.deckZ[i]).toBe(20);
    // And what you would stand on is the deck.
    expect(surfaceHeightAt(g, 3, 3)).toBe(20);
    expect(surfaceSampler(g)(3, 3)!.height).toBe(20);
  });

  test("is refused where there would be no gap under it", () => {
    // At or below the ground a deck describes terrain, which the terrain layer
    // already describes better. @see setDeck
    const g = createGrid(8, 8);
    setHeight(g, 2, 2, 10);
    setDeck(g, 2, 2, 1, 10);
    expect(g.deck[idx(g, 2, 2)]).toBe(0);
    setDeck(g, 2, 2, 1, 4);
    expect(g.deck[idx(g, 2, 2)]).toBe(0);
    setDeck(g, 2, 2, 1, 11);
    expect(g.deck[idx(g, 2, 2)]).toBe(1);
  });

  test("and taking it away leaves the ground as it was", () => {
    const g = createGrid(8, 8);
    setHeight(g, 1, 1, -6);
    setDeck(g, 1, 1, 1, 12);
    setDeck(g, 1, 1, 0);
    expect(g.deck[idx(g, 1, 1)]).toBe(0);
    expect(g.height[idx(g, 1, 1)]).toBe(-6);
    expect(surfaceHeightAt(g, 1, 1)).toBe(-6);
  });

  test("survives a save and a load", () => {
    const g = createGrid(6, 6);
    fillTerrain(g, 1);
    setDeck(g, 2, 3, 1, 14);
    const { grid } = deserializeWorld(serializeWorld(g, PALETTE));
    expect(grid.deck[idx(grid, 2, 3)]).toBe(1);
    expect(grid.deckZ[idx(grid, 2, 3)]).toBe(14);
  });

  test("and a map written before decks existed loads without any", () => {
    const g = createGrid(6, 6);
    fillTerrain(g, 1);
    const file = serializeWorld(g, PALETTE);
    delete (file as { deck?: string }).deck;
    delete (file as { deckZ?: string }).deckZ;
    const { grid } = deserializeWorld(file);
    expect([...grid.deck].every((v) => v === 0)).toBe(true);
  });
});

/**
 * THE GAP IS REAL, which is the claim the whole thing rests on.
 *
 * Asserted as an IDENTITY rather than as a tolerance: the same seed with and
 * without a bridge over it must produce the same water, tile for tile, at
 * every moment. A deck that leaked into the terrain — lifted into the column
 * grounds the way a building's footprint is, say — would dam the channel it
 * spans, and a test that only checked the river was "still wet" would pass
 * while it did.
 */
describe("a river does not know there is a bridge over it", () => {
  const river = (withBridge: boolean) => {
    const g = createGrid(48, 48);
    applyFixture(g, withBridge ? "bridge" : "inlet", 1);
    return { g, field: createWaterField(g) };
  };

  test("the ground under a span is the ground that was there", () => {
    const bare = river(false).g, spanned = river(true).g;
    expect([...spanned.height]).toEqual([...bare.height]);
    expect([...spanned.deck].some((v) => v !== 0)).toBe(true);
  });

  test("and so are the column grounds the solver actually reads", () => {
    const bare = river(false).field, spanned = river(true).field;
    expect([...spanned.columns.ground]).toEqual([...bare.columns.ground]);
  });

  test("and the river runs the same with it as without it", () => {
    const a = river(false), b = river(true);
    for (let n = 0; n < 60 * 20; n++) { stepWater(a.field, 1 / 60); stepWater(b.field, 1 / 60); }
    expect(totalVolume(b.field, b.g)).toBeCloseTo(totalVolume(a.field, a.g), 3);
    // AND THERE IS WATER UNDER THE SPAN, which the identity above does not say
    // on its own: two dry maps are also identical.
    const spanned = [...b.g.deck].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const wet = spanned.filter((i) => depthAt(b.field, i % b.g.w, (i / b.g.w) | 0) > 0.5);
    expect(wet.length).toBeGreaterThan(0);
  }, 30_000);
});

/**
 * AND THE ROAD SYSTEM TREATS IT AS ROAD, at its own level.
 *
 * This is the one integration a deck actually needs, and it is one idea: the
 * mask and the connectivity graph ask for the SURFACE height rather than the
 * terrain under it. Asked for the terrain, a span over a river compares a
 * riverbed against a riverbed — uneven, by design, since the channel is cut
 * with a bed that falls — and every tile of the bridge is a dead end.
 */
describe("a deck is road at the level it is laid", () => {
  const spanned = () => {
    const g = createGrid(48, 48);
    applyFixture(g, "bridge", 1);
    return g;
  };

  test("a span over uneven ground is ONE road, not a row of loose tiles", () => {
    const g = spanned();
    const decked = [...g.deck].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    expect(decked.length).toBeGreaterThan(8);
    // The ground under it really is uneven — otherwise this proves nothing.
    expect(new Set(decked.map((i) => g.height[i])).size).toBeGreaterThan(1);
    // And the deck really is level.
    expect(new Set(decked.map((i) => g.deckZ[i])).size).toBe(1);
    expect(componentCount(createNetwork(g))).toBe(1);
  });
});

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
import { generateMap } from "./gen/generate-map";
import {
  createWaterField, deckedAt, depthAt, pourAt, setWaterEdge, stepWater, totalVolume,
} from "./water/field";
import { STOREY, totalWater } from "../fluid/columns";
import { createBandLayer } from "./render/bands";
import { createWaterLayer, drawWater } from "./render/water";
import { deserializeWorld, serializeWorld } from "./io/serialize";
import { componentCount, createNetwork } from "./roads/network";
import { derivedRamp, type SurfaceReader } from "./roads/ramp-derive";
import { RAMP } from "./iso";

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
    // NOT BIT FOR BIT ANY MORE, and losing that is the feature rather than a
    // regression. The exact identity held while a deck was sealed off from
    // everything — water could reach one only by being poured on it. A span
    // is a piece of road now: where it meets land at its own level the two
    // are one surface, so water on the bank can run onto the bridge and back.
    // What is left is the claim that matters — a bridge does not dam, divert
    // or drain the river under it. Measured at two hundredths of a per cent
    // over twenty seconds, against a bound of one.
    const a = river(false), b = river(true);
    for (let n = 0; n < 60 * 20; n++) { stepWater(a.field, 1 / 60); stepWater(b.field, 1 / 60); }
    const bare = totalVolume(a.field, a.g);
    expect(Math.abs(totalVolume(b.field, b.g) - bare)).toBeLessThan(bare * 0.01);
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

/**
 * AND NOTHING DERIVES A RAMP ONTO A BRIDGE.
 *
 * Ramps are derived from paving and height, and a surface edit anywhere —
 * including POURING WATER, which is a surface tool — re-derives them around
 * the cells it touched. Handed the terrain under a span, the derivation
 * compares a paved cell against its paved neighbours, sees a road stepping up
 * and down a channel bed, and cuts slopes across the bridge. It showed up as
 * ramps appearing in a road the moment you poured near it.
 */
describe("the ramp derivation reads the surface", () => {
  /** The reader an edit command builds, in both the right and the wrong form. */
  const readerFor = (g: ReturnType<typeof createGrid>, surface: boolean): SurfaceReader => ({
    inBounds: (x, y) => x >= 0 && y >= 0 && x < g.w && y < g.h,
    paved: (x, y) => g.paved[idx(g, x, y)] !== 0,
    height: (x, y) => (surface ? surfaceHeightAt(g, x, y) : g.height[idx(g, x, y)]),
  });

  const ramped = (g: ReturnType<typeof createGrid>, surface: boolean) =>
    [...g.paved]
      .map((v, i) => (v ? i : -1))
      .filter((i) => i >= 0)
      .filter((i) => derivedRamp(readerFor(g, surface), i % g.w, (i / g.w) | 0) !== RAMP.NONE);

  const generated = (seed: number) => {
    const g = createGrid(64, 64);
    generateMap(g, { seed, material: 1, dirt: 2, sand: 3, woods: [4, 5, 6], paved: 7 });
    return g;
  };

  test("a span derives no ramps, however uneven the ground under it", () => {
    for (let seed = 0; seed < 6; seed++) {
      const g = generated(seed);
      expect([...g.deck].some((v) => v !== 0)).toBe(true);
      expect(ramped(g, true)).toEqual([]);
    }
  });

  test("where reading the ground under it cuts slopes across the road", () => {
    // THE BUG, AS A TEST. A surface edit re-derives the ramps around it, and
    // a water tool is a surface tool — so pouring anywhere near a crossing
    // handed this the riverbed, which steps a slab at a time exactly like a
    // road running down a hill does. Measured over these seeds: ten to
    // twenty-six ramps cut across the street per map, against none.
    let wrong = 0;
    for (let seed = 0; seed < 6; seed++) wrong += ramped(generated(seed), false).length;
    expect(wrong).toBeGreaterThan(20);
  });
});

/**
 * WATER STANDS ON A BRIDGE, which is the other half of a deck being a surface.
 *
 * The picker resolves a click to the surface you can SEE, and a span is that
 * surface where there is one — so an edit aimed at a bridge has to act on the
 * bridge. It did not: every tool wrote the terrain, and a pour aimed at a span
 * landed on the riverbed twenty half steps below it, out of sight underneath.
 *
 * The fix is a second field over the same map — ground at the deck, no floor
 * anywhere else — stepped by the SAME solver rather than by a second, cheaper
 * set of rules about how water behaves. @see WaterField.over
 */
describe("water on a deck", () => {
  /** A walled pan with a flat deck over part of it, and nothing else. */
  const pan = (deckAt: number) => {
    const g = createGrid(12, 12);
    fillTerrain(g, 1);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, -6);
    for (let y = 4; y <= 7; y++) for (let x = 4; x <= 7; x++) setDeck(g, x, y, 1, deckAt);
    const field = createWaterField(g);
    setWaterEdge(field, false);            // a closed pan: nothing may leave
    return { g, field };
  };

  test("a map with no deck on it has no upper storey at all", () => {
    // It is a second field's worth of memory and of solver time, and a map
    // with no bridge should pay neither.
    const g = createGrid(8, 8);
    fillTerrain(g, 1);
    expect(createWaterField(g).over).toBeNull();
  });

  test("pouring on a span puts the water ON it, not on the ground beneath", () => {
    const { field } = pan(10);
    expect(deckedAt(field, 5, 5)).toBe(true);
    expect(deckedAt(field, 1, 1)).toBe(false);
    pourAt(field, 5, 5, 6, 1);
    // All of it upstairs, none of it on the bed — which is the whole bug.
    expect(totalWater(field.over!)).toBeGreaterThan(0);
    expect(totalWater(field.columns)).toBe(0);
  });

  test("and it runs off the end and falls to the ground below", () => {
    const { g, field } = pan(10);
    pourAt(field, 5, 5, 6, 1);
    const put = totalVolume(field, g);
    for (let n = 0; n < 60 * 20; n++) stepWater(field, 1 / 60);
    // Off the deck and down: most of it leaves, and what stays is the film a
    // FLAT surface always keeps — below `minSlope` nothing moves, which is
    // the same rule that lets a puddle sit on a plain instead of creeping
    // across it for ever. A deck is a plain four tiles wide.
    expect(totalWater(field.over!)).toBeLessThan(put * 0.25);
    expect(totalWater(field.columns)).toBeGreaterThan(put * 0.5);
  }, 20_000);

  test("and NOTHING IS LOST ON THE WAY DOWN", () => {
    // The handover is the part that can leak: the solver takes the water off
    // the upper field and the world puts it on the lower one, and a field
    // that knew about only one of those would report a leak or make water.
    // A closed pan, so the only way the total can move is a mistake here.
    const { g, field } = pan(10);
    pourAt(field, 5, 5, 6, 1);
    const put = totalVolume(field, g);
    for (let n = 0; n < 60 * 20; n++) {
      stepWater(field, 1 / 60);
      expect(totalVolume(field, g)).toBeCloseTo(put, 1);
    }
  }, 30_000);

  test("and it does not fall THROUGH the deck it is standing on", () => {
    // The gap is under the span, not in it. Water on a deck reaches the bed
    // by running off an edge, which takes time; it must not simply appear
    // below on the first step.
    const { field } = pan(10);
    pourAt(field, 5, 5, 6, 1);
    stepWater(field, 1 / 60);
    // The cells under the span itself are still dry after a step.
    for (let y = 5; y <= 6; y++) {
      for (let x = 5; x <= 6; x++) expect(depthAt(field, x, y)).toBe(0);
    }
  });
});

/**
 * AND IT IS DRAWN THERE, which is the other half of standing on a bridge.
 *
 * The water layer used to take the world's `WaterField` and reach into its
 * `columns`, which meant exactly one storey could ever be drawn — so water on
 * a deck was simulated, conserved, and invisible. It takes a `ColumnField`
 * now, and the scene builds a second layer over `field.over` into the same
 * bands, added after the one below because a span is nearer the camera than
 * the bed it crosses.
 */
describe("the upper storey has a mesh of its own", () => {
  const pan = () => {
    const g = createGrid(12, 12);
    fillTerrain(g, 1);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, -6);
    for (let y = 4; y <= 7; y++) for (let x = 4; x <= 7; x++) setDeck(g, x, y, 1, 10);
    const field = createWaterField(g);
    setWaterEdge(field, false);
    return { g, field, bands: createBandLayer(g.w, g.h) };
  };

  test("a dry deck draws nothing, and a wet one draws quads", () => {
    const { field, bands } = pan();
    const over = createWaterLayer(field.over!, bands, 1);
    drawWater(over, field.over!, bands, 1 / 60);
    expect(over.live.size).toBe(0);

    pourAt(field, 5, 5, 6, 1);
    drawWater(over, field.over!, bands, 1 / 60);
    expect(over.live.size).toBeGreaterThan(0);
  });

  test("and the two storeys draw independently of one another", () => {
    // The bug this replaced, stated: one layer over the world's field could
    // only ever show the ground storey, so a bridge's water had nowhere to
    // be drawn. Water upstairs must not light up the layer downstairs.
    const { field, bands } = pan();
    const under = createWaterLayer(field.columns, bands, 1);
    const over = createWaterLayer(field.over!, bands, 1);
    pourAt(field, 5, 5, 6, 1);
    drawWater(under, field.columns, bands, 1 / 60);
    drawWater(over, field.over!, bands, 1 / 60);
    expect(over.live.size).toBeGreaterThan(0);
    expect(under.live.size).toBe(0);
  });
});

/**
 * THE EDGE OF A DECK IS A LIP, NOT A CLIFF.
 *
 * The surface renderer draws a side face from the water down to the ground
 * BESIDE it, so what the upper storey calls the ground just off a deck is
 * what the edge of a bridge's water looks like. The first version said "the
 * land below", which is true and useless: a deck thirteen half steps up over
 * a riverbed at minus three drew a translucent pane sixteen half steps tall
 * along every edge of every bridge, and it never went away, because the film
 * a flat surface always keeps kept feeding it.
 *
 * Nothing in the physics turns on the number — water reaching an off-deck
 * column is taken off this field and handed downstairs whatever its ground
 * says — so this is a rendering rule, and it is tested as one.
 */
describe("the edge of a deck", () => {
  const spanned = () => {
    const g = createGrid(12, 12);
    fillTerrain(g, 1);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, -20);
    for (let y = 4; y <= 7; y++) for (let x = 4; x <= 7; x++) setDeck(g, x, y, 1, 12);
    return { g, field: createWaterField(g) };
  };

  test("is a short step down, not a drop to the land below", () => {
    const { g, field } = spanned();
    const over = field.over!;
    const { nx } = over;
    let checked = 0;
    for (let cy = 0; cy < over.ny; cy++) {
      for (let cx = 0; cx < nx; cx++) {
        const i = cy * nx + cx;
        if (over.storey![i] === STOREY.OWNED) continue;     // this one IS deck
        // Only the ring a deck's water can actually reach matters: it is the
        // only ground the renderer will draw a face against.
        const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .some(([dx, dy]) => {
            const jx = cx + dx, jy = cy + dy;
            return jx >= 0 && jy >= 0 && jx < nx && jy < over.ny
              && over.storey![jy * nx + jx] === STOREY.OWNED;
          });
        if (!beside) continue;
        checked++;
        // Within a slab of the deck it adjoins, and nowhere near the ground.
        expect(over.ground[i]).toBeGreaterThan(12 - 4);
        expect(over.ground[i]).toBeLessThan(12);
      }
    }
    expect(checked).toBeGreaterThan(8);
    // And the land really is a long way down, or this proves nothing.
    expect(g.height[idx(g, 5, 5)]).toBe(-20);
  });

  test("and water still runs off it, so the lip is not a wall", () => {
    const { g, field } = spanned();
    setWaterEdge(field, false);
    pourAt(field, 5, 5, 8, 1);
    const put = totalVolume(field, g);
    for (let n = 0; n < 60 * 20; n++) stepWater(field, 1 / 60);
    expect(totalWater(field.columns)).toBeGreaterThan(put * 0.5);
    expect(totalVolume(field, g)).toBeCloseTo(put, 1);
  }, 20_000);
});

/**
 * A BRIDGE IS A PIECE OF ROAD, which is the whole of what the first two
 * attempts at this got wrong.
 *
 * Modelled as a hole on every side, a deck could only be poured on directly
 * and could only lose water by having it deleted — so water would not run
 * onto a bridge from the road that meets it, nor off the far end onto the
 * road beyond. At either END of a span the land is at the deck's own level
 * and the surface is continuous; only at the SIDES has the ground fallen
 * away. @see STOREY
 */
describe("water crosses between a bridge and the road it meets", () => {
  /** A ditch with a deck laid over it, level with the land either side. */
  const crossing = () => {
    const g = createGrid(16, 16);
    fillTerrain(g, 1);
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) setHeight(g, x, y, x >= 7 && x <= 9 ? -20 : 0);
    }
    // The span, at the level of the land either side of the ditch.
    for (let y = 6; y <= 9; y++) for (let x = 7; x <= 9; x++) setDeck(g, x, y, 1, 0);
    const field = createWaterField(g);
    setWaterEdge(field, false);
    return { g, field };
  };

  const onDeck = (field: ReturnType<typeof createWaterField>) => {
    const o = field.over!;
    let sum = 0;
    for (let i = 0; i < o.depth.length; i++) {
      if (o.storey![i] === STOREY.OWNED) sum += o.depth[i];
    }
    return sum;
  };

  test("the margin is a GHOST where the road carries on and a HOLE at the sides", () => {
    const { field } = crossing();
    const o = field.over!;
    const kindAt = (x: number, y: number) => o.storey![(y * 4 + 1) * o.nx + (x * 4 + 1)];
    expect(kindAt(8, 7)).toBe(STOREY.OWNED);            // on the span
    expect(kindAt(6, 7)).toBe(STOREY.GHOST);            // the road, west end
    expect(kindAt(10, 7)).toBe(STOREY.GHOST);           // the road, east end
    expect(kindAt(8, 5)).toBe(STOREY.HOLE);             // off the side, over the ditch
    expect(kindAt(8, 10)).toBe(STOREY.HOLE);
  });

  test("water poured on the ROAD runs onto the bridge", () => {
    // The thing that could not happen at all before: nothing was poured on
    // the deck, and the deck ends up wet.
    const { field } = crossing();
    pourAt(field, 5, 7, 8, 1);
    expect(onDeck(field)).toBe(0);
    for (let n = 0; n < 60 * 10; n++) stepWater(field, 1 / 60);
    expect(onDeck(field)).toBeGreaterThan(0);
  }, 20_000);

  test("and water poured on the BRIDGE runs off onto the road beyond", () => {
    const { g, field } = crossing();
    pourAt(field, 8, 7, 8, 1);
    for (let n = 0; n < 60 * 10; n++) stepWater(field, 1 / 60);
    // It got to the far side of the ditch, which it can only have done
    // across the span: the ditch itself is twenty half steps down.
    let far = 0;
    for (let y = 0; y < g.h; y++) far += depthAt(field, 12, y);
    expect(far).toBeGreaterThan(0);
  }, 20_000);

  test("and nothing is made or lost trading across the edge", () => {
    // A ghost is a window onto the storey below, so every drop that crosses
    // is counted twice unless the settling is exact. A closed pan, checked
    // every step.
    const { g, field } = crossing();
    pourAt(field, 8, 7, 8, 1);
    pourAt(field, 5, 7, 8, 1);
    const put = totalVolume(field, g);
    for (let n = 0; n < 60 * 10; n++) {
      stepWater(field, 1 / 60);
      expect(totalVolume(field, g)).toBeCloseTo(put, 1);
    }
  }, 30_000);
});

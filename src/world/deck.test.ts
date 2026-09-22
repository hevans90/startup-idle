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
  COLUMNS_PER_TILE, createWaterField, deckedAt, depthAt, pourAt, setWaterEdge,
  stepWater, syncGround, totalVolume,
} from "./water/field";
import { addWater, createColumnField, totalWater } from "../fluid/columns";
import { DROP } from "../fluid/drips";
import { dropFrom, fallEdge } from "../fluid/falls";
import { OPEN_SKY, connected } from "../fluid/slots";

/**
 * Water standing on the DECKS, which is slot one everywhere it exists.
 *
 * There is no second field to total any more: a column's storeys are planes
 * of one depth array, and the upper one is the second `cells` of it.
 * @see syncSlots
 */
const onDeck = (field: { columns: { depth: Float32Array; cells: number; layers: number } }) => {
  const c = field.columns;
  if (c.layers < 2) return 0;
  let sum = 0;
  for (let i = c.cells; i < c.cells * c.layers; i++) sum += c.depth[i];
  return sum;
};

/** And water on the GROUND, which is slot zero: the river, under the span. */
const onGround = (field: { columns: { depth: Float32Array; cells: number } }) => {
  const c = field.columns;
  let sum = 0;
  for (let i = 0; i < c.cells; i++) sum += c.depth[i];
  return sum;
};
import { createBandLayer } from "./render/bands";
import { createFallLayer, destroyFallLayer, drawFalls } from "./render/falls-render";
import { activeBox } from "../fluid/columns";
import { TIERS, createWaterLayer, drawWater, tierAt } from "./render/water";
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
    // SLOT ZERO of the spanned map against the only slot of the bare one.
    // A bridge adds a storey; what it must not do is move the riverbed.
    const bare = river(false).field, spanned = river(true).field;
    const n = bare.columns.cells;
    expect([...spanned.columns.ground.subarray(0, n)])
      .toEqual([...bare.columns.ground.subarray(0, n)]);
    // And it really did add one, or this compares a map with itself.
    expect(spanned.columns.layers).toBe(2);
    expect(bare.columns.layers).toBe(1);
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
    // A slot costs its memory whether anything stands in it or not — at a
    // hundred and twenty eight tiles a spare storey is about a hundred
    // megabytes — so a map with no bridge should not have one.
    const g = createGrid(8, 8);
    fillTerrain(g, 1);
    expect(createWaterField(g).columns.layers).toBe(1);
    // And one that does have a bridge does have one.
    expect(pan(10).field.columns.layers).toBe(2);
  });

  test("and a deck laid on a map that had none grows the field for it", () => {
    // A field's slot count is fixed when it is made, so this is the one
    // place the field itself has to be replaced — and the water in the
    // river has to survive that. @see growStoreys
    const g = createGrid(12, 12);
    fillTerrain(g, 1);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, -6);
    const field = createWaterField(g);
    setWaterEdge(field, false);
    pourAt(field, 1, 1, 6, 1);
    const put = totalWater(field.columns);
    expect(field.columns.layers).toBe(1);
    const was = field.fieldRev;
    for (let y = 4; y <= 7; y++) for (let x = 4; x <= 7; x++) setDeck(g, x, y, 1, 10);
    syncGround(field, g);
    expect(field.columns.layers).toBe(2);
    expect(field.fieldRev).toBeGreaterThan(was);
    expect(totalWater(field.columns)).toBeCloseTo(put, 6);
  });

  test("pouring on a span puts the water ON it, not on the ground beneath", () => {
    const { field } = pan(10);
    expect(deckedAt(field, 5, 5)).toBe(true);
    expect(deckedAt(field, 1, 1)).toBe(false);
    pourAt(field, 5, 5, 6, 1);
    // All of it upstairs, none of it on the bed — which is the whole bug.
    expect(onDeck(field)).toBeGreaterThan(0);
    expect(onGround(field)).toBe(0);
  });

  test("a puddle STAYS on it, because a bridge has parapets", () => {
    // What the sides used to be: a slab BELOW the deck, which is a permanent
    // downhill into a bottomless drain — the columns off the side are
    // emptied every substep. Water poured on a bridge ran off both edges
    // inside half a second and could never accumulate on one, and the drop
    // at the lip had the solver running both sides as waterfalls the whole
    // time. Measured on this pan: 91% of a tile's worth still there after
    // twenty seconds. @see DECK_KERB
    const { field } = pan(10);
    pourAt(field, 5, 5, 6, 1);
    const put = onDeck(field);
    for (let n = 0; n < 60 * 20; n++) stepWater(field, 1 / 60);
    expect(onDeck(field)).toBeGreaterThan(put * 0.7);
  }, 20_000);

  test("and enough of it goes over the side and falls to the ground below", () => {
    // A parapet is not a lid. What a deck can hold is its own area times the
    // height of its kerb and not a drop more, so the puddle SATURATES: this
    // pan keeps about 168 whatever it is given. Measured over twenty seconds
    // — 96 poured and 91% stays, 320 and half of it goes, 640 and three
    // quarters go, 960 and five sixths go — which is a bridge with a kerb on
    // it rather than a bridge with a hole in it. @see DECK_KERB
    const { field } = pan(10);
    pourAt(field, 5, 5, 40, 1);
    const put = onDeck(field);
    for (let n = 0; n < 60 * 20; n++) stepWater(field, 1 / 60);
    expect(onDeck(field)).toBeLessThan(put * 0.4);
    expect(onGround(field)).toBeGreaterThan(put * 0.5);
  }, 20_000);

  test("and what it holds is bounded by the kerb, however much is poured", () => {
    // The saturation itself, because it is the thing that says the parapet
    // is geometry and not a fraction somebody tuned: twice the water over
    // the same deck leaves the same puddle behind.
    const held = (amount: number) => {
      const { field } = pan(10);
      pourAt(field, 5, 5, amount, 1);
      for (let n = 0; n < 60 * 20; n++) stepWater(field, 1 / 60);
      return onDeck(field);
    };
    // Within a couple of percent of each other, and both a long way under
    // what was put on: the number is the deck's capacity, not the pour's.
    const a = held(40), b = held(60);
    expect(Math.abs(b - a) / a).toBeLessThan(0.05);
    expect(b).toBeLessThan(640 * 0.4);
  }, 40_000);

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
 * AND IT IS DRAWN THERE, in the SAME MESH as everything else.
 *
 * This is what the whole slot model is for. A deck used to be a field of its
 * own with a water layer of its own drawn over the first, and two meshes is
 * two meshes however carefully they are levelled: the sheet arrived at the
 * mouth of a span, stopped, and a second sheet started. What was reported was
 * "it's clearly 2 meshes", and it was.
 *
 * One mesh now, because a corner vertex is shared by every slot that reaches
 * it — the road's water and the deck's water beside it stand at the same
 * level, average into the same corner, and there is nothing left to line up.
 * @see cornerValues
 */
describe("a bridge and the road it meets are one surface", () => {
  /** A ditch with a span over it, level with the road either side. */
  const crossing = () => {
    const g = createGrid(16, 16);
    fillTerrain(g, 1);
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) setHeight(g, x, y, x >= 7 && x <= 9 ? -20 : 0);
    }
    for (let y = 6; y <= 9; y++) for (let x = 7; x <= 9; x++) setDeck(g, x, y, 1, 0);
    const field = createWaterField(g);
    setWaterEdge(field, false);
    return { g, field, bands: createBandLayer(g.w, g.h) };
  };

  test("there is ONE water layer, and it draws both storeys", () => {
    const { field, bands } = crossing();
    const wl = createWaterLayer(field.columns, bands, 1);
    pourAt(field, 8, 7, 6, 1);               // on the span
    pourAt(field, 4, 7, 6, 1);               // on the road
    drawWater(wl, field.columns, bands, 1 / 60);
    let quads = 0;
    for (const b of wl.live) quads += wl.strips[b].n;
    expect(quads).toBeGreaterThan(0);
    // Both of them are in it: take the deck's water away and the count drops.
    const withBoth = quads;
    const { field: f2, bands: b2 } = crossing();
    const wl2 = createWaterLayer(f2.columns, b2, 1);
    pourAt(f2, 4, 7, 6, 1);                  // the road alone
    drawWater(wl2, f2.columns, b2, 1 / 60);
    let alone = 0;
    for (const b of wl2.live) alone += wl2.strips[b].n;
    expect(withBoth).toBeGreaterThan(alone);
  });

  test("the river under a span is drawn BENEATH the span, not over it", () => {
    // A band's sort key is `x + y` and leaves height out — sound while a cell
    // holds one surface, and a bridge is the cell that holds two. The water
    // drew last, so a channel running full painted itself across the front of
    // the deck above it, the span showing through in teeth where it stood
    // proud of the flood. Roofed water goes in a tier of its own, drawn
    // before the paving. @see BandLayer.underOf
    const { field, bands } = crossing();
    const wl = createWaterLayer(field.columns, bands, 1);
    const c = field.columns;
    // Fill the channel under the span right up to its soffit, and put a
    // puddle on the deck over it.
    for (let cy = 6 * COLUMNS_PER_TILE; cy < 10 * COLUMNS_PER_TILE; cy++) {
      for (let cx = 7 * COLUMNS_PER_TILE; cx < 10 * COLUMNS_PER_TILE; cx++) {
        const i = cy * c.nx + cx;
        addWater(c, cx, cy, c.roof[i] - c.ground[i] - 0.3, 1);
      }
    }
    pourAt(field, 8, 7, 2, 1);
    drawWater(wl, field.columns, bands, 1 / 60);
    let over = 0, under = 0;
    for (const b of wl.live) { over += wl.strips[b].n; under += wl.under[b].n; }
    // Both tiers carry water: the river below and the puddle on the deck.
    expect(under).toBeGreaterThan(0);
    expect(over).toBeGreaterThan(0);
    // And the roofed tier is the parent that draws before the paving.
    const b = wl.under.findIndex((q) => q.n > 0);
    expect(wl.under[b].mesh.parent).toBe(bands.underOf[b]);
    expect(wl.strips[b].mesh.parent).toBe(bands.structureOf[b]);
  });

  test("and the corner where they meet is ONE vertex at ONE height", () => {
    // THE SEAM, pinned. The last column of road and the first column of deck
    // share a corner. If the two were still separate surfaces they would
    // write that corner from separate passes and it would hold one height or
    // the other; sharing it, the corner is the average and BOTH contribute.
    const { field, bands } = crossing();
    const wl = createWaterLayer(field.columns, bands, 1);
    pourAt(field, 6, 7, 6, 1);               // the road, right up to the ditch
    pourAt(field, 7, 7, 6, 1);               // the first tile of the span
    drawWater(wl, field.columns, bands, 1 / 60);
    // The column boundary between tile 6 and tile 7, halfway down the lane.
    const c = field.columns;
    const cx = COLUMNS_PER_TILE * 7, cy = COLUMNS_PER_TILE * 7 + 1;
    const v = cy * (c.nx + 1) + cx;
    // The road is slot ZERO and the deck is slot ONE, so nothing about a slot
    // index can join them. They are one SHEET — overlapping intervals, no
    // fall between — and the corner holds one tier for it, with all four of
    // the columns that meet there in it. @see findBodies
    const road = wl.bodies.at[(cy) * c.nx + (cx - 1)];
    const deck = wl.bodies.at[c.cells + cy * c.nx + cx];
    expect(road).toBeGreaterThanOrEqual(0);
    expect(deck).toBe(road);
    const k = tierAt(wl, v, road);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(wl.vn[k]).toBe(4);
    // And nothing else reaches this corner: one sheet, one tier.
    expect(wl.cBody[v * TIERS + 1]).toBe(-1);
    // And the height it is drawn at is the water's, not the ditch's.
    expect(wl.vs[k]).toBeGreaterThan(0);
  });
});

/**
 * AND WHAT GOES OVER THE SIDE FALLS, where you can see it.
 *
 * The water was always simulated: a deck's parapet is a lip, the solver
 * spawns a fall on it, banks the water in the air and lands it below. What
 * did not happen was the DRAWING. A fall's edge is packed slot pair first
 * — `p * cells * 2 + i * 2 + axis` — and the renderer still decoded it as
 * `k >> 1`, which for a bridge's plane is a column index a whole plane past
 * the end of the map. Every one of them failed the bounds test and was
 * skipped, so water poured off a span vanished at the parapet and
 * reappeared in the river with nothing in between.
 */
describe("water going off a bridge is drawn falling", () => {
  /** A deck standing well clear of the ground, and a pour big enough to
   *  overtop its kerb. */
  const span = () => {
    const g = createGrid(12, 12);
    fillTerrain(g, 1);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, -20);
    for (let y = 4; y <= 7; y++) for (let x = 4; x <= 7; x++) setDeck(g, x, y, 1, 12);
    const field = createWaterField(g);
    setWaterEdge(field, false);
    const bands = createBandLayer(g.w, g.h);
    bands.visibleLo = 0;
    bands.visibleHi = g.w + g.h;
    return { g, field, bands };
  };

  test("the lips are on the DECK's plane, and the sheet is drawn from them", () => {
    const { field, bands } = span();
    const c = field.columns;
    const fl = createFallLayer(bands, 1);
    pourAt(field, 5, 5, 40, 1);
    let quads = 0, air = 0, lips = 0;
    for (let n = 0; n < 60 * 4; n++) {
      stepWater(field, 1 / 60);
      drawFalls(fl, c, activeBox(c), null, null);
      let q = 0;
      for (const b of fl.live) q += fl.strips[b].n;
      quads = Math.max(quads, q);
      let a = 0;
      for (let k = 0; k < c.falls.air.length; k++) a += c.falls.air[k];
      air = Math.max(air, a);
    }
    // Every lip is on a plane of its own: the deck against the ground beside
    // it, which is pair one-nought and never pair nought-nought.
    const planes = new Set<number>();
    for (let n = 0; n < c.falls.cliffN; n++) {
      planes.add((c.falls.cliff[n] / (c.cells * 2)) | 0);
      lips++;
    }
    expect(lips).toBeGreaterThan(8);
    expect(planes.has(0)).toBe(false);
    // Water really does leave the deck through the air...
    expect(air).toBeGreaterThan(1);
    // ...and it is drawn on its way down. Nought was the bug.
    expect(quads).toBeGreaterThan(0);
    destroyFallLayer(fl);
  });

  test("a drop shed off a deck starts AT the deck", () => {
    // The same decode, one level down. A drop comes off the sheet at a
    // height read from the slot the sheet LEFT — read from plane zero it
    // would be launched from the riverbed under the span, which is below
    // the water it is supposed to be falling into.
    const f = createColumnField(8, 8, undefined, 1, 2);
    for (let i = 0; i < f.cells; i++) {
      f.ground[i] = -20;
      f.roof[i] = 10;
      f.ground[f.cells + i] = 12;
      f.roof[f.cells + i] = OPEN_SKY;
    }
    const i = 3 * f.nx + 3;
    // Pair one-nought: off the deck, onto the ground beside it.
    const k = fallEdge(f, i, 0, 1 * f.layers + 0);
    dropFrom(f, k, DROP, 3, 0.5, 0, 1);
    expect(f.drips.live).toBe(1);
    expect(f.drips.z[0]).toBeCloseTo(12 - 3, 6);
  });

  test("and it sheds drops off the sheet as it comes apart", () => {
    const { field } = span();
    const c = field.columns;
    pourAt(field, 5, 5, 40, 1);
    // SAMPLED AS IT GOES, because a drop off a twenty half step span is in
    // the air for about half a second and every one of them has landed long
    // before the run ends.
    let live = 0, high = -Infinity;
    for (let n = 0; n < 60 * 4; n++) {
      stepWater(field, 1 / 60);
      live = Math.max(live, c.drips.live);
      for (let k = 0; k < c.drips.live; k++) high = Math.max(high, c.drips.z[k]);
    }
    expect(live).toBeGreaterThan(0);
    // Above the riverbed, which is twenty half steps down: these are drops
    // in the air over the channel, not water lying in it. Where each one
    // STARTS is the test above, which does not depend on what the budget
    // happened to let through.
    expect(high).toBeGreaterThan(-20);
  });
});

describe("the edge of a deck", () => {
  const spanned = () => {
    const g = createGrid(12, 12);
    fillTerrain(g, 1);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, -20);
    for (let y = 4; y <= 7; y++) for (let x = 4; x <= 7; x++) setDeck(g, x, y, 1, 12);
    return { g, field: createWaterField(g) };
  };

  test("stands ABOVE the deck, so it is a parapet and not a drop", () => {
    const { g, field } = spanned();
    const c = field.columns;
    const { nx, cells } = c;
    const decked = (i: number) => c.roof[cells + i] > c.ground[cells + i];
    let kerbs = 0, middles = 0;
    for (let cy = 0; cy < c.ny; cy++) {
      for (let cx = 0; cx < nx; cx++) {
        const i = cy * nx + cx;
        if (!decked(i)) continue;
        // The ring of the deck against open air, against its middle.
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const jx = cx + dx, jy = cy + dy;
          return jx < 0 || jy < 0 || jx >= nx || jy >= c.ny
            || !decked(jy * nx + jx);
        });
        const floor = c.ground[cells + i];
        if (edge) { kerbs++; expect(floor).toBeGreaterThan(12); }
        else { middles++; expect(floor).toBe(12); }
      }
    }
    expect(kerbs).toBeGreaterThan(8);
    expect(middles).toBeGreaterThan(8);
    // And the land really is a long way down, or this proves nothing: the
    // point is that the edge is NOT drawn or flowed against the riverbed.
    expect(g.height[idx(g, 5, 5)]).toBe(-20);
  });

  test("and the channel under the span is roofed by it", () => {
    // THE ABUTMENT, as geometry rather than as a rule. Slot zero under a
    // deck has a ceiling one slab below the road surface, which is what
    // stops anything at road level pouring into the river.
    const { field } = spanned();
    const c = field.columns;
    const i = (4 * 5 + 1) * c.nx + (4 * 5 + 1);       // the middle of the span
    expect(c.roof[i]).toBe(12 - 2);
    expect(c.ground[i]).toBe(-20);
    // And away from the span there is nothing overhead at all.
    const open = (4 * 1 + 1) * c.nx + (4 * 1 + 1);
    expect(c.roof[open]).toBe(OPEN_SKY);
  });

  test("and a flood still goes over it, so the parapet is not a lid", () => {
    const { g, field } = spanned();
    setWaterEdge(field, false);
    pourAt(field, 5, 5, 24, 1);
    const put = totalVolume(field, g);
    for (let n = 0; n < 60 * 20; n++) stepWater(field, 1 / 60);
    expect(totalWater(field.columns)).toBeGreaterThan(put * 0.4);
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

  test("the road's slot reaches the deck's, and never the channel's", () => {
    // WHAT THE FOUR RULES USED TO SAY, asked of the geometry instead. None of
    // ghost, hole, abutment or parapet is named anywhere any more; each of
    // them is this intersection with different numbers in it.
    const { field } = crossing();
    const c = field.columns;
    const at = (x: number, y: number) => (y * 4 + 1) * c.nx + (x * 4 + 1);
    const slot = (i: number, a: number) =>
      ({ floor: c.ground[a * c.cells + i], roof: c.roof[a * c.cells + i] });
    const road = slot(at(6, 7), 0);                  // the road, west end
    const deck = slot(at(8, 7), 1);                  // on the span
    const channel = slot(at(8, 7), 0);               // the river, under it
    expect(connected(road.floor, road.roof, deck.floor, deck.roof)).toBe(true);
    expect(connected(road.floor, road.roof, channel.floor, channel.roof)).toBe(false);
    expect(connected(deck.floor, deck.roof, channel.floor, channel.roof)).toBe(false);
    // And off the SIDE of the span, where the ground falls into the ditch,
    // the deck is joined to it — over a drop, which is a fall.
    const beside = slot(at(8, 5), 0);
    expect(connected(deck.floor, deck.roof, beside.floor, beside.roof)).toBe(true);
    expect(beside.floor).toBeLessThan(deck.floor - 4);
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

/**
 * A BRIDGE HAS AN ABUTMENT, which is the one thing a heightfield cannot say.
 *
 * Where a road meets a span the channel is UNDER the deck, and the road does
 * not pour into it — there is a wall. To the storey below, though, the road
 * simply ends at a cliff into the river, and water goes over cliffs: of a
 * hundred and sixty poured on an approach, eleven reached the deck and forty
 * three fell in the ditch. Water was getting to a bridge by going THROUGH it.
 *
 * A vertical face between two cells is not something a height per cell can
 * express, so the edge itself is closable. @see ColumnField.closed
 */
describe("the mouth of a bridge", () => {
  /** A walled lane, a ditch across it, a span over the ditch. The span is
   *  the only way from one side to the other, so anything that arrives on
   *  the far side went OVER, and anything in the ditch went THROUGH. */
  const lane = () => {
    const g = createGrid(16, 16);
    fillTerrain(g, 1);
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const inLane = y >= 6 && y <= 9;
        setHeight(g, x, y, !inLane ? 40 : x >= 7 && x <= 9 ? -20 : 0);
      }
    }
    for (let y = 6; y <= 9; y++) for (let x = 7; x <= 9; x++) setDeck(g, x, y, 1, 0);
    const field = createWaterField(g);
    setWaterEdge(field, false);
    return { g, field };
  };

  const inLane = (field: ReturnType<typeof createWaterField>, x0: number, x1: number) => {
    let sum = 0;
    for (let y = 6; y <= 9; y++) for (let x = x0; x <= x1; x++) sum += depthAt(field, x, y);
    return sum;
  };

  test("does not let the road pour into the channel under it", () => {
    const { field } = lane();
    pourAt(field, 4, 7, 10, 1);
    for (let n = 0; n < 60 * 30; n++) stepWater(field, 1 / 60);
    // Float dust rather than nought, and the SCALE is the point: a ten
    // thousandth of a half step against the FORTY THREE that used to land
    // there, out of a hundred and sixty poured. Written as a bound on the
    // order of magnitude, because pinning dust to its current digits is
    // pinning the arithmetic and not the rule. @see ColumnField.closed
    expect(inLane(field, 7, 9)).toBeLessThan(1e-3);
  }, 40_000);

  test("and the water gets across by going OVER the span", () => {
    const { field } = lane();
    pourAt(field, 4, 7, 10, 1);
    for (let n = 0; n < 60 * 30; n++) stepWater(field, 1 / 60);
    // On the far side of a ditch it cannot have crossed any other way.
    expect(inLane(field, 10, 15)).toBeGreaterThan(0);
  }, 40_000);

  /**
   * A channel that runs PAST the span at both ends, so the river has to
   * cross the boundary between a decked cell and an open one. `lane` cannot
   * ask this: its ditch is exactly the width of the deck, so every cell of
   * it is decked and the edges in question never come up.
   */
  const culvert = () => {
    const g = createGrid(20, 12);
    fillTerrain(g, 1);
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        setHeight(g, x, y, y >= 5 && y <= 6 ? -20 : 40);
      }
    }
    // A span across the middle of the channel, touching no road at all.
    for (let y = 5; y <= 6; y++) for (let x = 9; x <= 10; x++) setDeck(g, x, y, 1, 0);
    const field = createWaterField(g);
    setWaterEdge(field, false);
    return { g, field };
  };

  test("but the river still runs UNDER it, which the same edges must allow", () => {
    // The abutment is only the edges between a deck and the ROAD. The edges
    // from a deck to the channel either side are the river passing through,
    // and closing those dams it — which is the whole point of a bridge.
    const { field } = culvert();
    for (let cy = 5 * 4; cy < 7 * 4; cy++) addWater(field.columns, 2 * 4, cy, 16, 1);
    const beyond = () => {
      let sum = 0;
      for (let y = 5; y <= 6; y++) for (let x = 12; x < 20; x++) sum += depthAt(field, x, y);
      return sum;
    };
    expect(beyond()).toBe(0);
    for (let n = 0; n < 60 * 20; n++) stepWater(field, 1 / 60);
    // It got past the span, which it can only have done by going under it.
    expect(beyond()).toBeGreaterThan(0);
  }, 30_000);
});

import { describe, expect, jest, test } from "bun:test";

import { Mesh } from "pixi.js";

import { DIR } from "../../iso/dir";
import { SEWER_FIT, SEWER_GRATE, createGrid, fillTerrain, idx } from "../grid";
import { stepSewers, sewerReportsFor } from "../sewers/flow";
import { createBandLayer } from "./bands";
import { liveOf } from "./pipe-live";
import { LIVE_BASE, MATERIAL, WORDS, solid } from "./pipe-mesh";
import { createSewerLayer, deepened } from "./sewer-layer";

/** A sewer along y = 2 from an outfall at x = 1 to a manhole at x = 6. */
function map(exit = true) {
  const g = createGrid(16, 8);
  fillTerrain(g, 1);
  g.height.fill(4);
  for (let x = 1; x <= 6; x++) g.sewer[idx(g, x, 2)] = (x > 1 ? DIR.N : 0) | (x < 6 ? DIR.S : 0);
  if (exit) g.sewerFit[idx(g, 1, 2)] = SEWER_FIT.outfall;
  g.sewerFit[idx(g, 6, 2)] = SEWER_FIT.node;
  g.rev++;
  return g;
}
/** Let the clock run on: the layer times its marks by it, and the suite's clock moves only when told. */
const wait = (ms: number) => { jest.advanceTimersByTime(ms); };
const count = (tiers: { children: unknown[] }[]) => tiers.reduce((n, t) => n + t.children.length, 0);

describe("the sewer layer", () => {
  test("draws its tubes under the ground, shown only in the underground view", () => {
    const g = map(), bands = createBandLayer(g.w, g.h), layer = createSewerLayer(bands);
    layer.sync(g, 1, false);
    expect(count(bands.sewerOf)).toBeGreaterThan(0);
    expect(bands.sewerOf.every((t) => !t.visible)).toBe(true);
    layer.sync(g, 1, true);
    expect(bands.sewerOf.every((t) => t.visible)).toBe(true);
  });

  test("tints the tiles a live manhole reaches, while a slop maker is in hand", () => {
    const g = map(), bands = createBandLayer(g.w, g.h), layer = createSewerLayer(bands);
    layer.sync(g, 1, false);
    const paved = count(bands.pavedOf);
    layer.sync(g, 1, false, null, true);
    expect(count(bands.pavedOf)).toBeGreaterThan(paved);
    layer.sync(g, 1, false, null, false);
    expect(count(bands.pavedOf)).toBe(paved);
  });

  test("a manhole on a sewer with no exit reaches nothing", () => {
    const g = map(false), bands = createBandLayer(g.w, g.h), layer = createSewerLayer(bands);
    layer.sync(g, 1, false);
    const paved = count(bands.pavedOf);
    layer.sync(g, 1, false, null, true);
    expect(count(bands.pavedOf)).toBe(paved);
  });

  /** Every vertex's colour and material in a tier's meshes. */
  const verts = (tiers: { children: unknown[] }[]) => tiers.flatMap((t) => t.children).filter((c): c is Mesh => c instanceof Mesh).flatMap((mesh) => {
    const data = mesh.geometry.attributes.aPosition.buffer.data as Float32Array, words = new Uint32Array(data.buffer, data.byteOffset, data.length);
    return Array.from({ length: data.length / WORDS }, (_, v) => ({ colour: words[v * WORDS + 5], material: data[v * WORDS + 8] % LIVE_BASE, slot: Math.floor(data[v * WORDS + 8] / LIVE_BASE) }));
  });

  test("the way a trunk falls is a pattern of its own tube: nothing is drawn over it", () => {
    const g = map(), bands = createBandLayer(g.w, g.h), layer = createSewerLayer(bands);
    layer.sync(g, 1, true);
    // Only meshes under the ground: the chevrons that were shapes are gone.
    for (const t of bands.sewerOf) for (const c of t.children) expect(c).toBeInstanceOf(Mesh);
    // Falling toward the outfall at the low end of its row: back along its run, as that is counted.
    const made = new Set(verts(bands.sewerOf).map((v) => v.material));
    expect(made.has(MATERIAL.trunkBack)).toBe(true);
    expect(made.has(MATERIAL.trunkOn)).toBe(false);
  });

  test("a manhole's shaft is brick", () => {
    const g = map(), bands = createBandLayer(g.w, g.h), layer = createSewerLayer(bands);
    layer.sync(g, 1, true);
    expect(verts(bands.sewerOf).some((v) => v.material === MATERIAL.brick)).toBe(true);
  });

  test("deeper down, a trunk is darker and greyer", () => {
    const umber = 0x7a5230, shallow = deepened(umber, 1), deep = deepened(umber, 4);
    expect(shallow).toBe(umber);
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const sum = (c: number) => rgb(c).reduce((n, k) => n + k, 0);
    expect(sum(deep)).toBeLessThan(sum(umber) * 0.8);
    // Greyer: its channels closer together.
    const spread = (c: number) => Math.max(...rgb(c)) - Math.min(...rgb(c));
    expect(spread(deep)).toBeLessThan(spread(umber));
    expect(deepened(umber, 9)).toBe(deep);
  });

  test("what a trunk carries shows on its tube with nothing rebuilt: each tile a slot, its fill and its chevrons' run written there", () => {
    const g = map(), bands = createBandLayer(g.w, g.h), layer = createSewerLayer(bands);
    const manhole = idx(g, 6, 2);
    g.sewer[manhole] |= SEWER_GRATE;
    g.rev++;
    layer.sync(g, 1, true);
    const meshes = bands.sewerOf.flatMap((t) => t.children.slice());
    const before = verts(bands.sewerOf);
    // A slot a tile: six tiles of trunk, six slots, none of them nought.
    const slots = [...new Set(before.filter((v) => v.material === MATERIAL.trunkBack).map((v) => v.slot))];
    expect(slots.length).toBe(5);
    expect(slots.includes(0)).toBe(false);
    for (const s of slots) expect(liveOf(s)).toEqual({ fill: 0, phase: 0 });
    // Water down its grate for a while: the sewer carries it to its outfall.
    const hooks = {
      pay: () => true, room: () => 0, take: () => {}, release: () => {}, backedUp: null,
      standing: () => 2, drain: (_x: number, _y: number, depth: number) => ({ depth, strength: 0 }),
    };
    for (let k = 0; k < 90; k++) stepSewers(g, new Map(), 1 / 30, hooks);
    layer.sync(g, 1, true);
    wait(60);
    layer.sync(g, 1, true);
    // Some of it stands fuller than nothing, and its marks have run.
    const now = slots.map(liveOf);
    expect(now.some((l) => l.fill > 0.05)).toBe(true);
    expect(now.some((l) => l.phase > 0)).toBe(true);
    // Nothing made, nothing put away, and not a vertex written.
    expect(bands.sewerOf.flatMap((t) => t.children.slice())).toEqual(meshes);
    expect(verts(bands.sewerOf)).toEqual(before);
    // Out of the underground view, nothing is written at all.
    layer.sync(g, 1, false);
    const held = slots.map(liveOf);
    wait(40);
    layer.sync(g, 1, false);
    expect(slots.map(liveOf)).toEqual(held);
  });

  test("a network that backs up changes colour in place: no mesh is made or put away", () => {
    const g = map(), bands = createBandLayer(g.w, g.h), layer = createSewerLayer(bands);
    const manhole = idx(g, 6, 2);
    g.sewer[manhole] |= SEWER_GRATE;
    g.rev++;
    layer.sync(g, 1, true);
    const meshes = bands.sewerOf.flatMap((t) => t.children.slice());
    const before = verts(bands.sewerOf).map((v) => v.colour);
    // Water down its grate, and the manhole choked: backed up.
    stepSewers(g, new Map(), 1 / 30, {
      pay: () => true, room: () => 0, take: () => {}, release: () => {}, backedUp: manhole,
      standing: () => 2, drain: (_x, _y, depth) => ({ depth, strength: 0 }),
    });
    expect([...sewerReportsFor(g).values()][0].state).toBe("backed-up");
    layer.sync(g, 1, true);
    // The very same meshes, in the same places.
    expect(bands.sewerOf.flatMap((t) => t.children.slice())).toEqual(meshes);
    for (const mesh of meshes) expect((mesh as Mesh).destroyed).toBe(false);
    // And some of their vertices a different colour: the backed-up red-brown, in place of the umber.
    const after = verts(bands.sewerOf).map((v) => v.colour);
    expect(after.length).toBe(before.length);
    const changed = after.filter((c, k) => c !== before[k]);
    expect(changed.length).toBeGreaterThan(20);
    // The tube's own colour only: its brick shaft and its collars are as they were.
    expect(changed.length).toBeLessThan(after.length);
    // Each length by its own depth, so more than one shade of it — none of them the clear umber's.
    const clear = new Set([1, 1.5, 2, 2.5, 3, 3.5, 4].map((d) => solid(deepened(0x7a5230, d))));
    for (const c of changed) expect(clear.has(c)).toBe(false);
    // Looked at again with nothing new to say, nothing is written.
    layer.sync(g, 1, true);
    expect(verts(bands.sewerOf).map((v) => v.colour)).toEqual(after);
  });
});

import { describe, expect, test } from "bun:test";

import { Container, Texture } from "pixi.js";

import { createGrid } from "../grid";
import type { RenderCtx } from "../structures/render";
import { EMIT_MOTES, createJuice, grew, rampColour, spawnDue, zoomRate, type Recipe } from "./juice";

describe("juice", () => {
  test("a house hops only for growing a tier, not for any other change to its record", () => {
    expect(grew("kit:intern.t0", "kit:intern.t1")).toBe(true);
    expect(grew("kit:intern.t1", "kit:intern.landmark")).toBe(true);
    expect(grew("kit:intern.t1", "kit:intern.t1")).toBe(false);
    expect(grew("kit:intern.t2", "kit:intern.t1")).toBe(false);
    expect(grew("kit:intern.t0", "kit:vibe_coder.t1")).toBe(false);
    expect(grew("park", "park")).toBe(false);
  });

  test("a new building drops into place and lands exactly where it was drawn; a grown one hops and comes back", () => {
    const j = createJuice();
    const part = new Container();
    part.y = 100; part.alpha = 1;
    const ctx = { bands: { dynamicOf: [] }, textures: {}, grid: createGrid(4, 4), scale: 1 } as unknown as RenderCtx;
    const s = { id: 1, def: "kit:intern.t0", x: 1, y: 1, w: 1, h: 1 };
    j.mounted(s, { sprites: [part] }, ctx);
    j.tick(16);
    expect(part.y).toBeLessThan(100);
    for (let k = 0; k < 60; k++) j.tick(16);
    expect(part.y).toBe(100);
    expect(part.alpha).toBe(1);
    j.mounted({ ...s, def: "kit:intern.t1" }, { sprites: [part] }, ctx, s);
    j.tick(130);
    expect(part.y).toBeLessThan(100);
    for (let k = 0; k < 30; k++) j.tick(16);
    expect(part.y).toBeCloseTo(100);
  });

  test("a shop opening: the house pops out of its foot and settles exactly where it was", () => {
    const j = createJuice();
    const part = new Container();
    part.x = 10; part.y = 100;
    const ctx = { bands: { dynamicOf: [] }, textures: {}, grid: createGrid(4, 4), scale: 1 } as unknown as RenderCtx;
    j.opened({ id: 1, def: "kit:intern.t1", x: 1, y: 1, w: 1, h: 1 }, { sprites: [part] } as never, ctx, "Root Access", 0x23573f);
    j.tick(190);
    expect(part.scale.x).toBeGreaterThan(1);
    for (let k = 0; k < 40; k++) j.tick(16);
    expect(part.scale.x).toBeCloseTo(1);
    expect(part.x).toBeCloseTo(10);
    expect(part.y).toBeCloseTo(100);
  });
});

describe("emitters", () => {
  const recipe: Recipe = {
    texture: "dab", rate: 10, life: 1000, rise: 20, drift: 0, wobble: 0, spread: 0,
    from: 0xffffff, to: 0x000000, alpha: 1, size: [1, 1], blend: "normal",
  };
  const ctxWith = (layer: Container) => ({ bands: { dynamicOf: Array.from({ length: 64 }, () => layer) }, textures: {}, grid: createGrid(8, 8), scale: 1 }) as unknown as RenderCtx;
  const juice = () => createJuice({ texture: () => Texture.WHITE });

  test("motes are due at the rate, the fraction carried to the next frame", () => {
    let carry = 0, n = 0;
    for (let k = 0; k < 60; k++) { const d = spawnDue(10, 1000 / 60, carry); n += d.n; carry = d.carry; }
    expect(n).toBe(10);
    expect(spawnDue(0, 1000, 0).n).toBe(0);
  });

  test("a colour runs from one end of its ramp to the other", () => {
    expect(rampColour(0xff0000, 0x0000ff, 0)).toBe(0xff0000);
    expect(rampColour(0xff0000, 0x0000ff, 1)).toBe(0x0000ff);
    expect(rampColour(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(rampColour(0x000000, 0xffffff, 2)).toBe(0xffffff);
  });

  test("zoomed out an emitter gives off less, never under a quarter", () => {
    expect(zoomRate(2)).toBe(1);
    expect(zoomRate(0.5)).toBe(0.5);
    expect(zoomRate(0.05)).toBe(0.25);
  });

  test("an emitter gives off until stopped, and its motes die away after", () => {
    const layer = new Container(), j = juice();
    const stop = j.emit({ x: 2, y: 2, w: 1, h: 1, rise: 0 }, recipe, ctxWith(layer));
    for (let k = 0; k < 30; k++) j.tick(1000 / 30);
    expect(layer.children.length).toBeGreaterThanOrEqual(8);
    stop();
    for (let k = 0; k < 60; k++) j.tick(1000 / 30);
    expect(layer.children.length).toBe(0);
  });

  test("emitters never hold more than their share of the motes, and leave the bursts theirs", () => {
    const layer = new Container(), j = juice();
    for (let k = 0; k < 40; k++) j.emit({ x: k % 8, y: Math.floor(k / 8), w: 1, h: 1, rise: 0 }, { ...recipe, rate: 50, life: 5000 }, ctxWith(layer));
    for (let k = 0; k < 120; k++) j.tick(1000 / 30);
    expect(layer.children.length).toBe(EMIT_MOTES);
  });

  test("nothing is given off where the band is out of sight", () => {
    const layer = new Container(), j = juice();
    j.emit({ x: 2, y: 2, w: 1, h: 1, rise: 0 }, recipe, ctxWith(layer));
    for (let k = 0; k < 30; k++) j.tick(1000 / 30, { zoom: 1, shown: () => false });
    expect(layer.children.length).toBe(0);
  });
});

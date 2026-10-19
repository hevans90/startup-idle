import { describe, expect, test } from "bun:test";

import { Container } from "pixi.js";

import { createGrid } from "../grid";
import type { RenderCtx } from "../structures/render";
import { createJuice, grew } from "./juice";

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
});

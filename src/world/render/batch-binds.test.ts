import { describe, expect, test } from "bun:test";
import { TextureSource } from "pixi.js";

import { boundBatchBinds, createBinds, liveGroup } from "./batch-binds";

const sources = (n: number) => Array.from({ length: n }, () => new TextureSource({ width: 1, height: 1 }));

describe("the batch's bind groups, bounded", () => {
  test("one group for an order of textures, and another for another order", () => {
    const binds = createBinds();
    const [a, b] = sources(2);
    const g = binds.of([a, b], 2, 16, 1);
    expect(binds.of([a, b], 2, 16, 2)).toBe(g);
    expect(binds.of([b, a], 2, 16, 2)).not.toBe(g);
    expect(g.resources[0]).toBe(a);
    expect(g.resources[2]).toBe(b);
    expect(binds.size()).toBe(2);
  });

  test("past twice what it keeps, the groups no batch used this frame or the last are destroyed", () => {
    const dropped: unknown[] = [];
    const binds = createBinds(4, (g) => dropped.push(g));
    const s = sources(12);
    const old = binds.of([s[0]], 1, 16, 1);
    for (let i = 1; i < 8; i++) binds.of([s[i]], 1, 16, 1);
    const kept = binds.of([s[1]], 1, 16, 9);
    // The ninth order, eight frames on: all but the one used last frame go.
    const fresh = binds.of([s[8]], 1, 16, 10);
    expect(binds.size()).toBe(2);
    expect(dropped.length).toBe(7);
    expect(old.resources).toBeNull();
    expect(kept.resources).not.toBeNull();
    expect(fresh.resources).not.toBeNull();
    // And no group listens on its textures: there is nothing to take off them when it goes.
    expect(s[0].listenerCount("change")).toBe(0);
    expect(s[1].listenerCount("change")).toBe(0);
  });

  test("a group with a texture since destroyed, resized or unloaded is stale, and made again", () => {
    const binds = createBinds();
    const [a, b, c] = sources(3);
    const g = binds.of([a], 1, 16, 1);
    expect(liveGroup(g)).toBe(true);
    a.resize(4, 4);
    expect(liveGroup(g)).toBe(false);
    const g2 = binds.of([a], 1, 16, 2);
    expect(g2).not.toBe(g);
    expect(g.resources).toBeNull();
    const h = binds.of([b], 1, 16, 2);
    b.destroy();
    expect(liveGroup(h)).toBe(false);
    const k = binds.of([c], 1, 16, 2);
    c.unload();
    expect(liveGroup(k)).toBe(false);
    expect(binds.of([c], 1, 16, 3)).not.toBe(k);
  });

  test("a busy town — most groups still in use — is not swept again with every new one", () => {
    const binds = createBinds(4);
    const s = sources(40);
    let sweeps = 0, was = 0;
    // Every tick uses all it has made and makes one more: nothing can go.
    for (let tick = 1; tick < 40; tick++) {
      for (let i = 0; i < tick; i++) binds.of([s[i]], 1, 16, tick);
      if (binds.size() < was) sweeps++;
      was = binds.size();
    }
    expect(sweeps).toBe(0);
    expect(binds.size()).toBe(39);
  });

  test("a batch is given its group before Pixi looks, and a live one in place of a destroyed one", () => {
    const [a] = sources(1);
    const seen: unknown[] = [];
    const hash: Record<string, unknown> = {};
    const adaptor = { execute: (_: unknown, batch: { bindGroup: unknown }) => { seen.push(batch.bindGroup); } };
    const renderer = { tick: 1, limits: { maxBatchableTextures: 16 }, bindGroup: { _hash: hash }, renderPipes: { batch: { _adaptor: adaptor } } };
    boundBatchBinds(renderer);
    boundBatchBinds(renderer);
    const batch = { bindGroup: null as null | { resources: unknown; destroy: () => void }, textures: { textures: [a], count: 1 } };
    adaptor.execute(null, batch);
    expect(seen.length).toBe(1);
    const first = batch.bindGroup!;
    expect(first.resources).not.toBeNull();
    first.destroy();
    renderer.tick = 2;
    adaptor.execute(null, batch);
    expect(batch.bindGroup).not.toBe(first);
    expect(batch.bindGroup!.resources).not.toBeNull();
  });
});

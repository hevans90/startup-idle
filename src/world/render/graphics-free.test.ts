import { describe, expect, test } from "bun:test";
import { Container, Graphics, GraphicsContext } from "pixi.js";

import { freeGraphicsContexts, sameShapes } from "./graphics-free";

describe("a destroyed Graphics lets go of its shapes", () => {
  test("its own context goes with it, however it was destroyed, and its children's with theirs", () => {
    freeGraphicsContexts();
    freeGraphicsContexts();
    const a = new Graphics().rect(0, 0, 1, 1).fill(0xffffff), ca = a.context;
    a.destroy({ children: true });
    expect(ca.destroyed).toBe(true);
    const layer = new Container(), b = layer.addChild(new Graphics().circle(0, 0, 1).fill(0)), cb = b.context;
    layer.destroy({ children: true });
    expect(cb.destroyed).toBe(true);
    const c = new Graphics(), cc = c.context;
    c.destroy();
    expect(cc.destroyed).toBe(true);
  });

  test("a context it was lent is left standing", () => {
    freeGraphicsContexts();
    const shared = new GraphicsContext().rect(0, 0, 1, 1).fill(0);
    new Graphics(shared).destroy({ children: true });
    expect(shared.destroyed).toBe(false);
  });
});

describe("a Graphics redrawn the same shape is written over", () => {
  const src = {};
  const shape = (over: object = {}) => ({ indexOffset: 0, indexSize: 6, attributeOffset: 0, attributeSize: 4, baseColor: 1, alpha: 1, topology: "triangle-list", texture: { _source: src }, _batch: {}, _batcher: {}, ...over });
  test("moved and recoloured is the same, and takes the new colour", () => {
    const was = [shape()];
    expect(sameShapes(was, [shape({ baseColor: 7, alpha: 0.5 })], [0, 1, 2], [0, 1, 2])).toBe(true);
    expect(was[0].baseColor).toBe(7);
    expect(was[0].alpha).toBe(0.5);
  });
  test("more of it, another joining up, another texture or one never batched is not", () => {
    expect(sameShapes([shape()], [shape(), shape()], [0], [0])).toBe(false);
    expect(sameShapes([shape()], [shape({ attributeSize: 5 })], [0], [0])).toBe(false);
    expect(sameShapes([shape()], [shape()], [0, 1, 2], [0, 2, 1])).toBe(false);
    expect(sameShapes([shape()], [shape({ texture: { _source: {} } })], [0], [0])).toBe(false);
    expect(sameShapes([shape({ _batch: null })], [shape()], [0], [0])).toBe(false);
  });
});

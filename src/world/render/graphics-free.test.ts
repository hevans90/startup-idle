import { describe, expect, test } from "bun:test";
import { Container, Graphics, GraphicsContext } from "pixi.js";

import { freeGraphicsContexts } from "./graphics-free";

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

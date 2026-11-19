import { describe, expect, test } from "bun:test";
import { Container } from "pixi.js";

import { SNOW_STEPS, fadeWithSnow, setSnowLying, snowLying, snowStep } from "./snow-cover";

describe("snow on what is built", () => {
  test("its sprites faded in by how much lies, those gone let go", () => {
    setSnowLying(0);
    const a = new Container(), b = new Container();
    fadeWithSnow(a); fadeWithSnow(b);
    expect(a.alpha).toBe(0);
    setSnowLying(0.5);
    expect([a.alpha, b.alpha]).toEqual([0.5, 0.5]);
    b.destroy();
    setSnowLying(2);
    expect(snowLying()).toBe(1);
    expect(a.alpha).toBe(1);
    // A new one comes in as it lies now.
    const c = new Container();
    fadeWithSnow(c);
    expect(c.alpha).toBe(1);
    setSnowLying(0);
  });

  test("in steps, for what is drawn again when it changes", () => {
    setSnowLying(0.49);
    expect(snowStep()).toBe(Math.round(0.49 * SNOW_STEPS));
    setSnowLying(0);
    expect(snowStep()).toBe(0);
  });
});

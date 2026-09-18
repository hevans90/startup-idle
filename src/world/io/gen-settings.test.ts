/**
 * The generator's settings surviving a reload.
 *
 * The settings are the terms the NEXT map would be made on, so what matters
 * is what comes back out — and that whatever is in storage, valid or not, the
 * thing handed to the generator is usable. Half of these are about the second
 * one: this is a localStorage key, which is to say a text box anybody can
 * type into.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { forgetGenParams, loadGenParams, saveGenParams } from "./gen-settings";
import { DEFAULT_GEN, GEN_SLIDERS, withDefaults } from "../gen/params";

const KEY = "world-gen";

describe("generator settings", () => {
  beforeEach(() => localStorage.removeItem(KEY));

  test("come back as they were left", () => {
    const want = withDefaults({ relief: 30, rivers: 2, valleyDepth: 10 });
    saveGenParams(want);
    expect(loadGenParams()).toEqual(want);
  });

  test("and are the defaults when nothing has been saved", () => {
    expect(loadGenParams()).toEqual(withDefaults());
  });

  test("a setting added since the last save takes its default", () => {
    // A stored object is only ever a PARTIAL one: the code moves on and the
    // browser does not. Missing keys have an obvious answer and refusing the
    // whole file over one would throw away every setting to protect one.
    const { relief, ...rest } = withDefaults({ relief: 40 });
    void rest;
    localStorage.setItem(KEY, JSON.stringify({ relief }));
    const got = loadGenParams();
    expect(got.relief).toBe(40);
    expect(got.rivers).toBe(DEFAULT_GEN.rivers);
    expect(got.valleyWidth).toBe(DEFAULT_GEN.valleyWidth);
  });

  test("and one out of its slider's range is clamped, not obeyed", () => {
    // The generator multiplies these together. A relief of nine million is
    // not a big map, it is a hang.
    const relief = GEN_SLIDERS.find((s) => s.key === "relief")!;
    localStorage.setItem(KEY, JSON.stringify({ relief: 9e6, rivers: -5 }));
    const got = loadGenParams();
    expect(got.relief).toBe(relief.max);
    expect(got.rivers).toBe(GEN_SLIDERS.find((s) => s.key === "rivers")!.min);
  });

  test("and anything that is not a number at all is ignored", () => {
    localStorage.setItem(KEY, JSON.stringify({ relief: "lots", rivers: null, size: NaN }));
    expect(loadGenParams()).toEqual(withDefaults());
  });

  test("and text that is not JSON opens the defaults rather than throwing", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadGenParams()).toEqual(withDefaults());
  });

  test("and neither is a JSON value that is not an object", () => {
    for (const junk of ["7", '"relief"', "null", "[1,2,3]"]) {
      localStorage.setItem(KEY, junk);
      expect(loadGenParams()).toEqual(withDefaults());
    }
  });

  test("forgetting them gives back whatever the defaults are NOW", () => {
    // Which is the whole difference between forgetting and saving the current
    // defaults: a default that changes in the code has to be able to reach
    // somebody who has asked for the defaults.
    saveGenParams(withDefaults({ relief: 30 }));
    forgetGenParams();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(loadGenParams()).toEqual(withDefaults());
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

describe("the KTX2 transcoder served from this site", () => {
  test("is the one Pixi's loader was built against", () => {
    for (const f of ["libktx.js", "libktx.wasm"]) {
      expect(readFileSync(`public/transcoders/ktx/${f}`).equals(readFileSync(`node_modules/pixi.js/transcoders/ktx/${f}`))).toBe(true);
    }
  });
  test("every page a sheet names is on disk", () => {
    const dir = "public/isometric_assets/derived", have = new Set(readdirSync(dir));
    for (const f of have) {
      if (!f.endsWith(".json")) continue;
      for (const page of readFileSync(`${dir}/${f}`, "utf8").match(/[a-z]+_\d+\.(?:png|webp|ktx2)/g) ?? []) expect(have.has(page)).toBe(true);
    }
  });
});

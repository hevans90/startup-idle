/**
 * EVERY SHADER SOURCE BUILDS, and the two-dialect ones agree.
 *
 * These are template literals assembled from constants, and nothing in the
 * type system checks a template literal. A generator that throws, returns
 * nothing, or declares a function twice is a shader the device refuses at
 * pipeline creation — and an invalid pipeline takes the whole render pass with
 * it, which looks like a blank map rather than like a syntax error.
 *
 * `corner-rule` has had exactly that happen: a hand edit left its whole tail
 * declared twice, every test there passed, and the water silently stopped
 * drawing on the path that ships. These are the cheap guards that catch the
 * shape of it for all of them at once.
 */
import { describe, expect, test } from "bun:test";

import { accelerateSource } from "../../fluid/gpu/accelerate";
import { applySource } from "../../fluid/gpu/apply";
import { arriveSource } from "../../fluid/gpu/arrive";
import { cliffsSource } from "../../fluid/gpu/cliffs";
import { diffuseSource } from "../../fluid/gpu/diffuse";
import { divergenceSource } from "../../fluid/gpu/divergence";
import { falloutSource } from "../../fluid/gpu/fallout";
import { fallsSource } from "../../fluid/gpu/falls";
import { landingsSource } from "../../fluid/gpu/landings";
import { limitSource } from "../../fluid/gpu/limit";
import { matpackSource } from "../../fluid/gpu/matpack";
import { metaSource } from "../../fluid/gpu/meta";
import { sheetSource } from "../../fluid/gpu/sheet";
import { spillSource } from "../../fluid/gpu/spill";
import { cornerRuleSource } from "./corner-rule";
import { dripShaderSource } from "./drips-gpu";
import { foamSource } from "./foam-gpu";
import { sheetRuleSource } from "./nappe";
import { quadRuleSource } from "./quad-rule";
import { quadsSource } from "./quads-gpu";
import { washSource } from "./wash-gpu";
import { waterShaderSource } from "./water-gpu";

/** Every WGSL source in the project, by the name it is known by. */
const WGSL: [string, () => string][] = [
  ["accelerate", accelerateSource],
  ["apply", applySource],
  ["arrive", arriveSource],
  ["cliffs", cliffsSource],
  ["diffuse x", () => diffuseSource(0)],
  ["diffuse y", () => diffuseSource(1)],
  ["divergence", divergenceSource],
  ["fallout", falloutSource],
  ["falls", fallsSource],
  ["landings", landingsSource],
  ["limit", limitSource],
  ["matpack", matpackSource],
  ["meta", metaSource],
  ["sheet", sheetSource],
  ["spill", spillSource],
  ["foam", foamSource],
  ["wash", washSource],
  ["quads", () => quadsSource()],
  ["sheet rule", sheetRuleSource],
  ["corner rule", () => cornerRuleSource("wgsl")],
  ["quad rule", () => quadRuleSource("wgsl")],
];

describe("every shader source", () => {
  test("builds, and builds something", () => {
    for (const [name, make] of WGSL) {
      const src = make();
      expect(typeof src, name).toBe("string");
      expect(src.length, name).toBeGreaterThan(50);
    }
  });

  /**
   * A BACKTICK ENDS THE TEMPLATE. These are TypeScript template literals, so a
   * stray backtick in a WGSL comment does not produce bad WGSL — it produces a
   * TypeScript syntax error several lines later, in a place that looks
   * unrelated. This has cost an afternoon more than once.
   */
  test("carries no backtick, which would have ended its own template", () => {
    for (const [name, make] of WGSL) expect(make().includes("`"), name).toBe(false);
  });

  test("declares nothing twice", () => {
    for (const [name, make] of WGSL) {
      const names = [...make().matchAll(/\bfn\s+(\w+)\s*\(/g)].map((m) => m[1]);
      expect(new Set(names).size, name).toBe(names.length);
    }
  });

  /**
   * WGSL RESERVED WORDS, and the list is the MEASURED one.
   *
   * A pipeline built from a shader that uses one can report nothing more than
   * "invalid due to a previous error", which says neither which word nor
   * where, so it is worth catching here instead.
   *
   * Asked of the device directly — a one-line shader per word, under a
   * validation scope — rather than copied from the specification, because the
   * two do not agree. Rejected: `from`, `move`, `enum`, `typedef`, `do`.
   * ACCEPTED: `to`, `mat`, `f16`. This project's own notes have carried `to`
   * as reserved since the sheet pass was written, and it is not; `arrive`
   * declares a `mat` and has always worked.
   *
   * So this list is what fails in practice, not what the specification
   * reserves — the spec's list is longer, and a stricter implementation could
   * reject more than this catches.
   */
  test("uses no WGSL reserved word as an identifier", () => {
    const reserved = /\b(?:let|var|const)\s+(from|move|enum|typedef|do)\b/;
    for (const [name, make] of WGSL) expect(make().match(reserved)?.[1] ?? null, name).toBeNull();
  });

  /**
   * WITH THE COMMENTS TAKEN OFF FIRST, because the words themselves are
   * perfectly good prose: `accelerate` explains that 0/0 is NaN and `apply`
   * explains that a partial barrier is undefined behaviour. What must not
   * appear is either of them in the CODE, where it means a constant arrived
   * from somewhere that had not defined it.
   */
  const code = (src: string) => src.replace(/\/\/[^\n]*/g, "");

  test("and leaves no interpolation unresolved", () => {
    for (const [name, make] of WGSL) {
      const src = code(make());
      expect(src.includes("${"), name).toBe(false);
      expect(src.includes("undefined"), name).toBe(false);
      expect(src.includes("NaN"), name).toBe(false);
    }
  });
});

/**
 * THE TWO-DIALECT ONES, which have a stronger property available: the WGSL and
 * the GLSL must differ in nothing but their keywords. `corner-rule` has this
 * test already; `quad-rule` is its sibling and had none.
 */
describe("the rules written in both languages", () => {
  const skeleton = (src: string) =>
    src
      .replace(/fn (\w+)\(([^)]*)\)\s*->\s*[^{]*\{/g, (_m, n: string, a: string) =>
        `HEAD ${n}(${a.split(",").map((x) => x.split(":")[0].trim()).join(",")}) {`)
      .replace(/\b(?:float|vec4|vec2|int|bool|void)\s+(\w+)\(([^)]*)\)\s*\{/g,
        (_m, n: string, a: string) =>
          `HEAD ${n}(${a.split(",").map((x) => x.trim().split(/\s+/).pop()).join(",")}) {`)
      .replace(/vec4<f32>/g, "vec4")
      .replace(/vec2<f32>/g, "vec2")
      .replace(/\b(f32|float)\(/g, "T(")
      // Declaration keywords collapse to one token. GLSL spells a declaration
      // with its TYPE where WGSL spells it `let`, so `bool` and `vec4` are
      // declaration keywords here as much as `float` is — which the
      // corner-rule twin of this never needed, because its rule declares
      // neither.
      .replace(/\b(var|let|float|int|bool|vec4|vec2)\b/g, "T")
      .replace(/\s+/g, " ")
      .trim();

  test("quad-rule differs in nothing but its keywords", () => {
    expect(skeleton(quadRuleSource("glsl"))).toBe(skeleton(quadRuleSource("wgsl")));
  });

  test("and each is written in its own language", () => {
    expect(quadRuleSource("wgsl")).not.toContain("float ");
    expect(quadRuleSource("glsl")).not.toContain("<f32>");
  });

  test("the surface shader builds in both", () => {
    const s = waterShaderSource();
    for (const k of Object.keys(s) as (keyof typeof s)[]) {
      expect(typeof s[k], k).toBe("string");
      expect((s[k] as string).length, k).toBeGreaterThan(50);
    }
  });

  test("and so do the drips", () => {
    for (const d of ["wgsl", "glsl"] as const) {
      const s = dripShaderSource(d);
      expect(s, d).toBeTruthy();
    }
  });
});

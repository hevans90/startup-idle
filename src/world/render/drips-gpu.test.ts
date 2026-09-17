/**
 * The drip shaders, in two languages.
 *
 * There is one thing worth testing about a shader from here, and it is not
 * what it draws — nothing in this process has a GPU. It is that the WebGPU
 * version and the WebGL2 version are the SAME PROGRAM. That is the failure
 * this codebase has actually had: the water path's corner rule was written
 * twice, changed once, and grew a hairline of grass along every dip in the bed
 * on one backend and not the other. Nobody sees it until somebody with the
 * other backend looks at the map, which may be long after the change.
 *
 * So both dialects are generated from one text, and these check that the
 * generation did what it says: the same arithmetic, in each language's own
 * syntax, with nothing of the other language left in it.
 */
import { describe, expect, test } from "bun:test";

import { dripShaderSource } from "./drips-gpu";

/**
 * A source stripped of everything that is only dialect.
 *
 * Declarations all become `T`, constructors lose their WGSL type parameters,
 * the two names for a texture fetch become one, and a vertex shader's outputs
 * become where they go rather than what they are called. What is left is the
 * arithmetic, which is the only thing the two have to agree about.
 */
const skeleton = (src: string) =>
  src
    .replace(/vec([234])<f32>/g, "vec$1")
    .replace(/vec2<i32>/g, "ivec2")
    .replace(/\bf32\(/g, "cast(")
    .replace(/\bfloat\(/g, "cast(")
    .replace(/\bi32\(/g, "icast(")
    .replace(/\bint\(/g, "icast(")
    .replace(/\btextureLoad\(/g, "fetch(")
    .replace(/\btexelFetch\(/g, "fetch(")
    .replace(/\b(?:var|let|float|int|vec2|vec3|vec4|mat3)\s+(?=\w+\s*=)/g, "T ")
    .replace(/\bout\.(position|vColor|vUnit|vLight)\b/g, "$1")
    .replace(/\bgl_Position\b/g, "position")
    .replace(/\breturn out\b/g, "return")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();

const wgsl = dripShaderSource("wgsl");
const glsl = dripShaderSource("glsl");

describe("the drip shaders", () => {
  for (const part of ["outline", "bead", "vertex"] as const) {
    test(`the ${part} is the same program in both`, () => {
      expect(skeleton(glsl[part])).toBe(skeleton(wgsl[part]));
    });
  }

  test("and each is written in its own language, not the other's", () => {
    for (const part of ["outline", "bead", "vertex"] as const) {
      expect(wgsl[part]).not.toContain("ivec2");
      expect(wgsl[part]).not.toContain("texelFetch");
      expect(glsl[part]).not.toContain("<f32>");
      expect(glsl[part]).not.toContain("textureLoad");
      expect(glsl[part]).not.toContain("gl_Position = vec4<");
    }
    // And no token was left unspoken in either — an `F` or a `VEC3` that
    // survived into the output is a shader that will not compile, which is a
    // blank map rather than a wrong one.
    for (const src of [wgsl, glsl]) {
      for (const part of ["outline", "bead", "vertex"] as const) {
        expect(src[part]).not.toMatch(/\b(?:F|I|V2|V3|V4|M3|MUT2|DONE|POS|CLR|UNIT|LGT)\b/);
        expect(src[part]).not.toMatch(/\b(?:VEC2|VEC3|VEC4|IVEC2|FETCH|FLOAT|INT)\(/);
      }
    }
  });

  test("nothing declared `let` in the WGSL is ever assigned to again", () => {
    // The one rule of WGSL this keeps walking into. `let` is IMMUTABLE, and a
    // mutable local is `var` — but the shared text writes one declaration for
    // both languages, and GLSL has no such distinction, so a `float x = 0.0`
    // that is later set reads perfectly in one language and will not compile
    // in the other. It does not fail quietly either: the pipeline is rejected,
    // which invalidates the command buffer, which takes every other draw in
    // the frame with it — a completely black map from one word.
    //
    // The skeleton check above cannot see this, because both versions say the
    // same thing; only one of them is allowed to.
    for (const part of ["outline", "bead", "vertex"] as const) {
      const src = wgsl[part];
      for (const m of src.matchAll(/\blet\s+(\w+)\s*=/g)) {
        const name = m[1];
        // Everything AFTER this declaration, so the declaration itself is not
        // mistaken for the assignment it is looking for.
        const after = src.slice(m.index! + m[0].length);
        expect(`${part}: ${name} ${after.match(new RegExp(`\\b${name}\\s*=[^=]`)) ?? ""}`)
          .toBe(`${part}: ${name} `);
      }
    }
  });

  test("and both carry the teardrop, which is what a drop IS here", () => {
    // The curve, and the exponent that turns a circle into a drop. If this
    // ever goes back to being a rectangle it should be on purpose.
    for (const src of [wgsl, glsl]) {
      expect(src.outline).toContain("pow(neck, taper)");
      expect(src.outline).toContain("cos(t * 6.28318531)");
    }
  });

  test("and both light the bead off its own silhouette", () => {
    for (const src of [wgsl, glsl]) {
      expect(src.bead).toContain("sqrt(max(0.0, 1.0 - rr))");
      expect(src.bead).toContain("dot(n, light)");
    }
  });
});

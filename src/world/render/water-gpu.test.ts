/**
 * The surface shader, in two languages.
 *
 * There is one thing worth testing about it from here, and it is not what it
 * draws — nothing in this process has a GPU. It is that the WebGPU version and
 * the WebGL2 version are still the SAME SHADER.
 *
 * The corner rule and the drip shaders are generated from one text and cannot
 * drift. This one is not: it is long, and both halves are written out by hand.
 * That has already cost something. Falls learned to leave the rock and to thin
 * the way a sheet thins in the WGSL and not in the GLSL, because the edit
 * matched one twin's exact lines and did nothing at all to the other's — no
 * error, no failing test, just a WebGL path quietly a version behind. What
 * caught it in the end was counting occurrences of a word by hand.
 *
 * So: count them here instead. This cannot prove the two agree — only one text
 * could do that — but it catches the failure that actually happens, which is
 * an edit landing in one of them.
 */
import { describe, expect, test } from "bun:test";

import { waterShaderSource } from "./water-gpu";

/**
 * The shader with its comments taken out.
 *
 * Counted with them in, the two halves never match and never could: the WGSL
 * carries the explanations and the GLSL says "see the WGSL twin", so the word
 * `thin` came out eighteen to eleven on two halves that were byte for byte
 * equivalent in the part that runs. Prose is not the thing under test.
 */
const code = (src: string) => src.replace(/\/\/[^\n]*/g, "");
const { wgsl, glsl } = waterShaderSource();
const ran = { wgsl: code(wgsl), glsl: code(glsl) };

/**
 * Terms that only exist because of some piece of physics, so a half that has
 * lost one has lost the physics with it.
 *
 * Deliberately the NAMES and not the arithmetic: the two languages spell the
 * arithmetic differently — `select(a, b, c)` against `c ? b : a` — and a test
 * that demanded identical expressions would be a test nobody could keep green.
 */
const BOTH_MUST_HAVE = [
  "rim",            // the edge of the map is not a neighbour
  "resolveSide",    // the shared side rule
  "cornerOf",       // the shared corner rule
  "forward",        // which band a far-edge face is filed in
  "atBrink",        // a lip is not a shoreline, so it does not fade like one
  "fallMin",
  "levelAt",
  "flowAt",
  "sidePart",
  "cornerExtras",
  "aerated",
];

describe("the two halves of the water shader", () => {
  for (const term of BOTH_MUST_HAVE) {
    test(`both know about \`${term}\``, () => {
      expect(wgsl).toContain(term);
      expect(glsl).toContain(term);
    });
  }

  test("and use it about as often, so an edit landed in both", () => {
    // Counts, not just presence: the drift that started this went into the
    // WGSL in three places and the GLSL in none, and "does the word appear at
    // all" would have said nothing about that either, since it appeared in
    // neither before. (The falls have left this shader since — they are their
    // own layer, in one language — which is the better answer to the same
    // problem, and the reason the list below is shorter than it was.)
    const count = (s: string, term: string) => s.split(term).length - 1;
    for (const term of BOTH_MUST_HAVE) {
      const a = count(ran.wgsl, term), b = count(ran.glsl, term);
      expect(`${term}: ${Math.abs(a - b) <= 1}`).toBe(`${term}: true`);
    }
  });

  test("and each is written in its own language, not the other's", () => {
    expect(wgsl).toContain("@vertex");
    expect(wgsl).not.toContain("texelFetch");
    expect(glsl).toContain("#version 300 es");
    expect(glsl).not.toContain("textureLoad");
  });
});

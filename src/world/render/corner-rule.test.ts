/**
 * The corner rule.
 *
 * Two of these matter. The first is what the rule DOES, which the mesh builder
 * depends on. The second is that the two shader dialects are still the same
 * program — the whole reason the rule lives in one file is that it was written
 * out three times and the third one was wrong.
 */
import { describe, expect, test } from "bun:test";

import { FALL_MIN } from "../../fluid/falls";
import { OPEN_SKY } from "../../fluid/slots";
import { atBrink, cornerRuleSource, resolveCorner, resolveSide } from "./corner-rule";

describe("what height a corner is drawn at", () => {
  test("on level ground it is simply the mean of what meets there", () => {
    // Four columns on one bed, no low group at all.
    const c = resolveCorner(10 + 11 + 12 + 13, 4, 0, 0, 0);
    expect(c.high).toBeCloseTo(11.5, 6);
    // A corner with nothing below it answers the same either way.
    expect(c.low).toBe(c.high);
  });

  test("a sheet on a plateau and the lake below its cliff stay apart", () => {
    // The case the split exists for. The lake's surface is at 3 and the
    // plateau's floor at 10 — seven half steps of AIR between them — so they
    // are two bodies of water and no single height serves both. Averaged, the
    // sheet's edge runs down into the rock.
    //
    // Seven half steps of cliff beside it is also what stops the RIM rule
    // touching this corner: one wet column on the high bed is a fringe, but a
    // fringe at a LIP keeps its body, because the sheet going over starts on
    // it. Passing nought for that was only ever right while the rule was off.
    const c = resolveCorner(10.5, 1, 3 + 3 + 3, 3, 10, 7);
    expect(c.high).toBeCloseTo(10.5, 6);
    expect(c.low).toBeCloseTo(3, 6);
  });

  test("but a dip in the bed under one pool is one body, at one height", () => {
    // Drowned under twenty half steps, the water on the low bed reaches well
    // over the high one: there is no air anywhere and it is one sheet. Split,
    // the columns either side of the dip draw the same corner at two heights
    // differing by the surface's own ripple, and a corner that does not agree
    // with itself is a crack — nine pixels of grass through the water.
    const c = resolveCorner(30.2, 1, 30.0 + 29.9 + 30.1, 3, 10);
    expect(c.high).toBe(c.low);
    // And it is the mean over ALL of them, not either group's own.
    expect(c.high).toBeCloseTo((30.2 + 30.0 + 29.9 + 30.1) / 4, 6);
  });

  test("the low water reaching exactly the high bed is already one body", () => {
    // The boundary goes to merged: at equality there is no air left.
    const c = resolveCorner(12, 1, 10, 1, 10);
    expect(c.high).toBe(c.low);
  });
});

describe("the rim, and which kind of outside a corner is on", () => {
  // The strength goes in explicitly rather than being read from `RIM`, so
  // these say what they mean whatever the default becomes — and so the branch
  // at nought, which is the rule this replaced, can be pinned beside it.
  const ON = 1;

  test("a corner beside dry ground at its own level ends in a waterline", () => {
    // The fish tank. Three wet columns and a dry one, all on bed 10, and the
    // ground beside it does not go anywhere: the water ENDS here, and the end
    // of a body of water is a waterline. Brought to the bed there is no face
    // left for `resolveSide` to hang.
    const c = resolveCorner(12 + 12 + 12, 3, 0, 0, 10, 0, ON);
    expect(c.high).toBeCloseTo(10, 6);
  });

  test("nor does one with a bank RISING over it — that is a container", () => {
    // The third boundary, and the one that nearly went missing. Water is not
    // ended by a bank, it is HELD by one, and it stands full depth right up
    // against it. Feathered, a lake in a crater tapers away from the crater
    // wall and `?xray` shows a sheet with a void under it. The rule reads the
    // size of the step either way up, so this is the same number as a lip.
    const c = resolveCorner(12 + 12 + 12, 3, 0, 0, 10, FALL_MIN, ON);
    expect(c.high).toBeCloseTo(12, 6);
  });

  test("but a corner with the ground falling away under it keeps its body", () => {
    // The LIP. The water does not end here — it goes over, and what bounds it
    // is the sheet. Feathered, the lip would have no thickness to hand the
    // sheet and the fall would fade out exactly where it is strongest.
    const c = resolveCorner(12 + 12 + 12, 3, 0, 0, 10, FALL_MIN, ON);
    expect(c.high).toBeCloseTo(12, 6);
  });

  test("and it comes on gradually as a lip deepens, not at a threshold", () => {
    // Half a fall's least height is half the rule — and the same on the way
    // up, so a BEACH is the gentle end of the ramp and a wall is the far end.
    // A switch here pops a whole column of surface the frame a plunge pool
    // drains past the line, or a bank is raised one half step past it.
    const c = resolveCorner(12 + 12 + 12, 3, 0, 0, 10, FALL_MIN / 2, ON);
    expect(c.high).toBeCloseTo(11, 6);
    // Monotone in between, so nothing can snap back as a drop deepens.
    let last = -Infinity;
    for (let d = 0; d <= FALL_MIN * 2; d += 0.25) {
      const h = resolveCorner(36, 3, 0, 0, 10, d, ON).high;
      expect(h).toBeGreaterThanOrEqual(last - 1e-12);
      last = h;
    }
  });

  test("water running to the RIM OF THE MAP keeps its cross-section", () => {
    // A cut through the world is not a shore. The terrain shows its own skirt
    // at the map edge and the water should show a matching cross-section, so
    // the caller reports an unbounded drop off the edge and the rule leaves it
    // alone. Feathered away, the sheet at the edge has a void under it.
    const c = resolveCorner(12 + 12, 2, 0, 0, 10, Infinity, ON);
    expect(c.high).toBeCloseTo(12, 6);
  });

  test("an interior corner is untouched however deep the drop beside it", () => {
    // Four wet columns on one bed is INSIDE the water, whatever the ground is
    // doing a column away. Only the fringe moves, or a pond loses its depth.
    const c = resolveCorner(12 * 4, 4, 0, 0, 10, 0, ON);
    expect(c.high).toBeCloseTo(12, 6);
  });

  test("a merged corner on the fringe is read whole, and once", () => {
    // Drowned dip: one body, so the rim reads the count over BOTH groups.
    // Three columns of it beside dry ground is still a fringe.
    const c = resolveCorner(30, 1, 30 + 30, 2, 10, 0, ON);
    expect(c.high).toBe(c.low);
    expect(c.high).toBeCloseTo(10, 6);
  });

  test("off, which is what ships, it does nothing at all", () => {
    // The default is the drawn-before behaviour to the last bit, on every
    // branch — a rule landed off has to be provably off.
    for (const drop of [0, 1, FALL_MIN, Infinity]) {
      expect(resolveCorner(36, 3, 0, 0, 10, drop, 0).high).toBe(12);
      expect(resolveCorner(30, 1, 60, 2, 10, drop, 0).high).toBe(30);
    }
  });
});

describe("how far down the side of a body of water reaches", () => {
  /** A corner at one height, which is every corner on level ground. */
  const flat = (h: number, bed: number) => [h, h, bed] as const;

  test("down to its own bed, and no further, over dry ground", () => {
    // It used to run down to whatever the NEIGHBOUR stood on, so a pond on a
    // plateau painted itself over the whole cliff beneath it — and the higher
    // the ground, the more of the cliff it covered, because the excess was
    // exactly the height of the drop.
    const s = resolveSide(10, 0, false, ...flat(12, 10), ...flat(12, 10));
    expect(s.floorA).toBe(10);
    expect(s.topA).toBe(12);
  });

  test("down to the corner the NEIGHBOUR draws, when there is water there", () => {
    // Matched end for end to what is actually drawn next door, it cannot leave
    // a gap by construction. The rule it replaced — skip the side wherever the
    // water next door reaches this column's bed — tore along every step of a
    // staircase: 2.7% of the ground under interior water showed through.
    const s = resolveSide(10, 8, true, ...flat(11, 8), ...flat(11, 8));
    // The neighbour on bed 8 draws this corner at 11, so the side stops there.
    expect(s.floorA).toBe(11);
    expect(s.topA).toBe(11);
  });

  test("and a side that is not there comes back flat, not missing", () => {
    // A neighbour standing higher than this column's surface hides nothing and
    // is hidden by nothing: the face has no height. Flat rather than absent so
    // the shader can draw it regardless and make no fragments.
    const s = resolveSide(0, 20, true, ...flat(24, 20), ...flat(24, 20));
    expect(s.topA).toBe(s.floorA);
    expect(s.topB).toBe(s.floorB);
  });

  test("each end answers for itself", () => {
    // One end against deep water and the other against a dry drop is the
    // ordinary case at the corner of a pool, and the face is a wedge.
    const s = resolveSide(10, 6, true, 14, 14, 10, 11, 11, 6);
    expect(s.floorA).not.toBe(s.floorB);
  });
});

describe("the two shader dialects are the same program", () => {
  /**
   * Both, reduced to what they have in common.
   *
   * Types are the only thing allowed to differ. Declaration keywords collapse
   * to one token, and a function header collapses to its NAME and the NAMES of
   * its parameters in order — so a renamed function, a reordered parameter or
   * any change at all to a body still fails. Everything else has to match
   * character for character: every expression, every constant, every branch.
   * WGSL and GLSL cannot drift apart while this holds.
   */
  const skeleton = (src: string) =>
    src
      // fn name(a: T, b: T) -> T {
      .replace(/fn (\w+)\(([^)]*)\)\s*->\s*[^{]*\{/g, (_m, name: string, args: string) =>
        `HEAD ${name}(${args.split(",").map((a) => a.split(":")[0].trim()).join(",")}) {`)
      // T name(T a, T b) {
      .replace(/\b(?:float|vec4|int|bool|void)\s+(\w+)\(([^)]*)\)\s*\{/g, (_m, name: string, args: string) =>
        `HEAD ${name}(${args.split(",").map((a) => a.trim().split(/\s+/).pop()).join(",")}) {`)
      .replace(/vec4<f32>/g, "vec4")
      .replace(/\b(f32|float)\(/g, "T(")       // the cast, whichever it spells it
      .replace(/\b(var|let|float|int)\b/g, "T")
      .replace(/\s+/g, " ")
      .trim();

  test("they differ in nothing but their keywords", () => {
    expect(skeleton(cornerRuleSource("glsl"))).toBe(skeleton(cornerRuleSource("wgsl")));
  });

  test("and each is written in its own language, not the other's", () => {
    const wgsl = cornerRuleSource("wgsl"), glsl = cornerRuleSource("glsl");
    expect(wgsl).toContain("fn cornerOf(vx: i32, vy: i32, sheet: f32) -> vec4<f32>");
    expect(wgsl).toContain("fn resolveSide(bed: f32, bedJ: f32, wetJ: bool");
    expect(glsl).toContain("vec4 cornerOf(int vx, int vy, float sheet)");
    expect(glsl).toContain("vec4 resolveSide(float bed, float bedJ, bool wetJ");
    expect(glsl).not.toContain("<f32>");
    expect(wgsl).not.toContain("float ");
  });

  test("and neither declares anything twice", () => {
    // The twin test above compares the two dialects to EACH OTHER, so a fault
    // they share is invisible to it. Editing this template by hand once left
    // the whole tail — `atBrink`, `cornerOf`, `levelAt`, `resolveSide` — in
    // the source twice, equally in both, and every test here passed while the
    // GPU refused the shader outright: "redeclaration of 'atBrink'". The whole
    // water surface silently stopped drawing on the path that ships.
    for (const d of ["wgsl", "glsl"] as const) {
      const src = cornerRuleSource(d);
      const names = [...src.matchAll(/(?:fn|vec4|float)\s+(\w+)\s*\(/g)].map((m) => m[1]);
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  test("and both ask which SHEET, which is what replaced the merge", () => {
    // What went missing once was the MERGE: a corner split its contributors
    // by the bed they stood on and then thought better of it where the split
    // was wrong, and the builder had that second half while the shader did
    // not. There is no merge now because there is no guess to undo — the
    // split is made once, off the geometry, in `render/bodies`. So what both
    // dialects have to carry is the sheet test, and neither may carry the
    // grouping the merge existed to repair.
    for (const d of ["wgsl", "glsl"] as const) {
      const src = cornerRuleSource(d);
      expect(src).toContain("sheetAt(cx, cy, a) != sheet");
      expect(src).not.toContain("nHi");
      expect(src).not.toContain("nLo");
    }
  });
});

describe("a side reaches its own bed, whatever is next door", () => {
  /** One corner, shared by both ends of the face, standing at `surface`. */
  const face = (bed: number, bedJ: number, wetJ: boolean, surface: number) => {
    const s = resolveSide(bed, bedJ, wetJ, surface, surface, bed, surface, surface, bed);
    return { top: s.topA, floor: s.floorA, tall: s.topA - s.floorA };
  };

  test("DRY ground next door, however high, does not shorten it", () => {
    // It used to: a face buried in the hillside is a face nobody can see, and
    // that held right up until x-ray made the hillside translucent on purpose.
    // Drawn always, the normal view is unchanged — the bank in front is a
    // later band and paints over it.
    expect(face(0, 20, false, 5).tall).toBeCloseTo(5, 6);
    expect(face(0, 0, false, 5).tall).toBeCloseTo(5, 6);
    expect(face(0, -8, false, 5).tall).toBeCloseTo(5, 6);
  });

  test("and it never goes BELOW its own bed, which is the older rule", () => {
    // Water on a plateau ran its side down to whatever the neighbour stood on
    // and painted the cliff beneath it, worse the higher the ground was.
    expect(face(20, 0, false, 24).floor).toBe(20);
    expect(face(20, 0, false, 24).tall).toBeCloseTo(4, 6);
  });

  test("but WATER next door still does, because there is no face there", () => {
    // Two halves of one body. A face between them darkens the seam, so the
    // floor rises to whatever the neighbour's own quad reaches.
    expect(face(0, 0, true, 5).tall).toBeCloseTo(0, 6);
    // Which is the ONE case the older, shorter rule was right about, and the
    // reason the floor is not simply the bed in every case.
    expect(face(0, 20, true, 5).tall).toBeCloseTo(0, 6);
  });
});

describe("a lip is not a shoreline", () => {
  // A 3x3 of columns, the middle one the subject. `beside` is what stands on
  // the east neighbour: its bed, and how deep the water on it is.
  const scene = (bedE: number, depthE: number, bed = 10) => {
    const nx = 3, ny = 3;
    const ground = new Float32Array(nx * ny).fill(bed);
    const depth = new Float32Array(nx * ny).fill(1);
    ground[4 + 1] = bedE;
    depth[4 + 1] = depthE;
    return { nx, ny, ground, depth };
  };
  const ask = (bedE: number, depthE: number) => {
    const s = scene(bedE, depthE);
    return atBrink(s.nx, s.ny, 4, s.ground, s.depth, 0.02, 4);
  };

  test("water standing over a real drop is at a brink", () => {
    expect(ask(0, 0)).toBe(1);                  // ten half steps of nothing
    expect(ask(6, 0)).toBe(1);                  // four, which is a fall's least
  });

  test("a step a river tumbles down is not one", () => {
    // Scaled off the height at which a drop stops being a step in a river and
    // starts being a cliff: nothing at all below half of one.
    expect(ask(8, 0)).toBe(0);                  // two half steps down
    expect(ask(10, 0)).toBe(0);                 // level
    expect(ask(30, 0)).toBe(0);                 // walled in by higher ground
  });

  test("and it RAMPS, because a threshold is not the same number twice", () => {
    // Written as a yes or no it was a threshold evaluated in double on the
    // mesh builder and in float in the shader, and a hair either side of it
    // flipped a whole column's opacity: the two paths' pictures parted by 35
    // of 255 on the pixels where that happened.
    expect(ask(7, 0)).toBeCloseTo(0.5, 6);      // three down, half way
    expect(ask(7.5, 0)).toBeCloseTo(0.25, 6);
    expect(ask(6.5, 0)).toBeCloseTo(0.75, 6);
  });

  /**
   * THE ONE PLACE THE GROUND LIES ABOUT WHERE THE WATER CAN GO.
   *
   * At the mouth of a bridge the road stands level with the deck and the
   * channel runs far below it — so asked of the ground alone the road is at a
   * brink and the surface gets leaned into the hole. It cannot go there: the
   * abutment is a slot roofed below the road's own floor, which is what an
   * abutment IS, and the solver has always known it. The renderer did not, and
   * drew a trough where a road meets a span: measured along the `crossing`
   * fixture the corner dived 2.50 to 1.36 over four columns while the deck
   * beside it sat at 2.2, which is the gap in the surface somebody sees.
   *
   * @see fluid/slots, which is the rule both sides ask now
   */
  describe("a bridge's abutment is not a brink", () => {
    // The subject stands on the road at 10, open to the sky. Its east
    // neighbour is the CHANNEL — bed at 0 — and the question is whether the
    // channel is roofed below the road's floor, which is what a span does.
    const abut = (roofE: number) => {
      const nx = 3, ny = 3;
      const ground = new Float32Array(nx * ny).fill(10);
      const depth = new Float32Array(nx * ny).fill(1);
      const roof = new Float32Array(nx * ny).fill(OPEN_SKY);
      ground[5] = 0;                            // the channel, ten below
      depth[5] = 0;
      roof[5] = roofE;
      return atBrink(nx, ny, 4, ground, depth, 0.02, 4, 0, roof);
    };

    test("roofed under the road, the water has nowhere to go", () => {
      // A soffit at 8 is below the road's floor of 10: the two slots do not
      // overlap, so nothing crosses and there is no lip to lean towards.
      expect(abut(8)).toBe(0);
    });

    test("but open to the sky beside it, it is a brink as it always was", () => {
      // The same drop with nothing over it — off the SIDE of a span — still
      // draws down, or the fix would have been to delete the rule.
      expect(abut(OPEN_SKY)).toBe(1);
    });

    test("and with no roofs at all it answers exactly what it used to", () => {
      const nx = 3, ny = 3;
      const ground = new Float32Array(nx * ny).fill(10);
      const depth = new Float32Array(nx * ny).fill(1);
      ground[5] = 0;
      depth[5] = 0;
      expect(atBrink(nx, ny, 4, ground, depth, 0.02, 4)).toBe(1);
    });
  });

  test("and a pool deep enough below REACHES UP and drowns it", () => {
    // Read off the neighbour's surface, not its bed, for the same reason a
    // fall is: once the water below is deep enough there is no drop left.
    expect(ask(0, 0)).toBe(1);
    expect(ask(0, 4)).toBe(1);                  // six clear below, still a cliff
    expect(ask(0, 9)).toBe(0);                  // reaches to within one
  });
});

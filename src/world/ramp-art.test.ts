/**
 * Reading the hand-authored slope labels.
 *
 * These assert against the REAL slope-labels.json, not a fixture: the file is
 * the source of truth and the thing that can regress. A filter that silently
 * lets river tiles through would put un-walkable water surfaces in the ramp
 * palette, which is exactly the mistake the labelling pass was done to avoid.
 */
import { describe, expect, test } from "bun:test";

import { RAMP } from "./iso";
import {
  SLOPE_LABELS, buildRampIndex, rampCoverage, rampFrameFor, usableRampFrames,
} from "./ramp-art";

describe("slope-labels.json", () => {
  test("is fully labelled — every frame has a form", () => {
    const entries = Object.entries(SLOPE_LABELS);
    expect(entries.length).toBeGreaterThan(200);
    expect(entries.every(([, l]) => l.form === "flat" || l.form === "slope"
      || l.form === "cliff" || l.form === "wall")).toBe(true);
  });

  test("records only the two rises the artset and engine have", () => {
    for (const l of Object.values(SLOPE_LABELS)) {
      if (l.form !== "slope") continue;
      expect([0.5, 1]).toContain(l.rise);
    }
  });
});

describe("usableRampFrames", () => {
  const frames = usableRampFrames();

  test("finds ramps, and far fewer than the tilted set", () => {
    const tilted = Object.values(SLOPE_LABELS).filter((l) => l.form === "slope").length;
    expect(frames.length).toBeGreaterThan(8);
    expect(frames.length).toBeLessThan(tilted);
  });

  test("excludes water — a tilted water surface is not a ramp", () => {
    for (const f of frames) {
      expect(SLOPE_LABELS[f.frame].features ?? []).not.toContain("water");
    }
  });

  test("excludes road-extent embankments, whose face is not one tilted plane", () => {
    for (const f of frames) {
      expect(SLOPE_LABELS[f.frame].extent).toBe("full");
    }
  });

  test("excludes corner rises, which the ramp layer cannot express", () => {
    for (const f of frames) {
      expect(["N", "E", "S", "W"]).toContain(SLOPE_LABELS[f.frame].dir);
    }
  });

  test("converts the labeller's tile multiples into engine half steps", () => {
    for (const f of frames) {
      expect(f.rise).toBe((SLOPE_LABELS[f.frame].rise as number) * 2);
      expect([1, 2]).toContain(f.rise);
    }
  });
});

describe("rampFrameFor", () => {
  const ix = buildRampIndex();

  test("the artset covers every direction at every rise", () => {
    for (const c of rampCoverage(ix)) {
      expect(c.count).toBeGreaterThan(0);
    }
  });

  test("returns a frame whose label really matches what was asked", () => {
    for (const dir of [RAMP.N, RAMP.E, RAMP.S, RAMP.W]) {
      for (const rise of [1, 2]) {
        const f = rampFrameFor(ix, dir, rise);
        expect(f).not.toBeNull();
        expect(f!.dir).toBe(dir);
        expect(f!.rise).toBe(rise);
      }
    }
  });

  test("prefers bare ground over paved unless paving is asked for", () => {
    // full-step N has both kinds in the set
    const bare = rampFrameFor(ix, RAMP.N, 2, false);
    const paved = rampFrameFor(ix, RAMP.N, 2, true);
    expect(bare?.paved).toBe(false);
    expect(paved?.paved).toBe(true);
  });

  test("null for a combination with no art, rather than a wrong frame", () => {
    expect(rampFrameFor(ix, RAMP.N, 7)).toBeNull();
  });
});

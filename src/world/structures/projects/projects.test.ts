/**
 * A project's building: the model, the schedule it goes up on, and that every
 * building draws at every stage without anything coming out of the plot or
 * out of the arithmetic.
 */
import { describe, expect, test } from "bun:test";
import type { Graphics } from "pixi.js";

import { LOOKS, lookOf } from "./looks";
import { bays, floorsOf, wholeFloors, type Building, type Footprint } from "./model";
import { makePen } from "./pen";
import { PIT, STAGES, siteAt, topOf } from "./schedule";
import { drawFinished, drawSite, drawSky, jibLength, craneHeight, craneRest } from "./site";
import { OFFICES, PROJECT_BUILDINGS, SERVICES, LAB, LEVEE, DERELICT } from "../def";

const FOOTPRINTS: [string, Footprint][] = [...PROJECT_BUILDINGS, ...OFFICES, ...SERVICES, LAB, LEVEE, DERELICT]
  .map((d) => [d.id, { w: d.footprint.w, h: d.footprint.h }]);

/** A Graphics that only counts what it was asked to fill, and checks it is finite. */
function recorder() {
  let polys = 0, bad = 0;
  const g = {
    poly: (pts: number[]) => { polys++; if (pts.some((n) => !Number.isFinite(n))) bad++; return g; },
    circle: (x: number, y: number, r: number) => { polys++; if (![x, y, r].every(Number.isFinite)) bad++; return g; },
    fill: () => g,
  };
  return { g: g as unknown as Graphics, polys: () => polys, bad: () => bad };
}

describe("every building is a model that fits its plot", () => {
  test.each(FOOTPRINTS)("%s", (id, f) => {
    const b = lookOf(id, f);
    for (const m of b.masses) {
      expect(m.u0).toBeGreaterThanOrEqual(0);
      expect(m.v0).toBeGreaterThanOrEqual(0);
      expect(m.u1).toBeLessThanOrEqual(f.w);
      expect(m.v1).toBeLessThanOrEqual(f.h);
      expect(m.u1).toBeGreaterThan(m.u0);
      expect(m.v1).toBeGreaterThan(m.v0);
      expect(m.z1).toBeGreaterThan(m.z0);
      expect(floorsOf(m).n).toBeGreaterThanOrEqual(1);
    }
  });

  test("and everything that draws a project has a look", () => {
    for (const [id] of FOOTPRINTS) expect(LOOKS[id]).toBeDefined();
  });
});

describe("a site goes up trade after trade", () => {
  const b: Building = lookOf("hq", { w: 3, h: 3 });

  test("nothing stands on a plot nobody has worked", () => {
    const s = siteAt(b, 0);
    expect(s.pit).toBe(0);
    expect(s.plinth).toBe(0);
    expect(s.framing).toBe(false);
  });

  test("the pit is dug, then filled, then the plinth cast on it", () => {
    expect(siteAt(b, STAGES.dig[1]).pit).toBeCloseTo(PIT);
    expect(siteAt(b, (STAGES.found[0] + STAGES.found[1]) / 2).pit).toBeCloseTo(0);
    expect(siteAt(b, STAGES.found[1]).plinth).toBeCloseTo(b.plinth.h);
  });

  test("the cladding never gets ahead of the frame, and both only go up", () => {
    let last = siteAt(b, 0);
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const s = siteAt(b, Math.min(1, p));
      expect(s.clad).toBeLessThanOrEqual(s.frame + 1e-9);
      expect(s.frame).toBeGreaterThanOrEqual(last.frame - 1e-9);
      expect(s.clad).toBeGreaterThanOrEqual(last.clad - 1e-9);
      last = s;
    }
  });

  test("by the end the building is whole and the scaffold struck", () => {
    const s = siteAt(b, 0.999);
    expect(s.frame).toBeCloseTo(topOf(b));
    expect(s.clad).toBeCloseTo(topOf(b));
    expect(s.strike).toBe(1);
  });

  test("whole floors are counted off the mass's own foot", () => {
    const m = b.masses[1];
    const { h } = floorsOf(m);
    expect(wholeFloors(m, m.z0 + h * 2.5)).toBeCloseTo(m.z0 + h * 2);
    expect(wholeFloors(m, m.z1 + 1)).toBe(m.z1);
    expect(wholeFloors(m, m.z0 - 1)).toBe(m.z0);
  });
});

describe("windows are laid out inside their face", () => {
  test("spans sit inside the edges, in order, apart", () => {
    const s = bays(2.4, 0.2, 0.15, 0.12);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0][0]).toBeGreaterThanOrEqual(0.12 - 1e-9);
    expect(s[s.length - 1][1]).toBeLessThanOrEqual(2.4 - 0.12 + 1e-9);
    for (let k = 1; k < s.length; k++) expect(s[k][0]).toBeGreaterThan(s[k - 1][1]);
  });

  test("a face too short for one has none", () => {
    expect(bays(0.2, 0.3, 0.1)).toEqual([]);
  });
});

describe("every building draws at every stage", () => {
  test.each(FOOTPRINTS)("%s", (id, f) => {
    const b = lookOf(id, f);
    for (const p of [0, 0.04, 0.14, 0.3, 0.5, 0.7, 0.86, 0.95, 0.999]) {
      const site = siteAt(b, p);
      let polys = 0;
      for (let c = 0; c < f.w; c++) {
        const r = recorder();
        drawSite(makePen(r.g, 10, 10, 2, 1, c), b, f, site, 2);
        expect(r.bad()).toBe(0);
        polys += r.polys();
      }
      expect(polys).toBeGreaterThan(0);
      if (b.crane === "tower" && site.framing) {
        const r = recorder();
        drawSky(makePen(r.g, 10, 10, 2, 1, null), f, craneHeight(site.top), {
          heading: craneRest(f), reach: jibLength(f) * 0.7, hook: site.frame + 1, load: true,
        });
        expect(r.bad()).toBe(0);
        expect(r.polys()).toBeGreaterThan(0);
      }
    }
    let polys = 0;
    for (let c = 0; c < f.w; c++) {
      const r = recorder();
      drawFinished(makePen(r.g, 10, 10, 2, 1, c), b, f);
      expect(r.bad()).toBe(0);
      polys += r.polys();
    }
    expect(polys).toBeGreaterThan(0);
  });
});

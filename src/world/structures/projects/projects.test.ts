/**
 * A project's building: the model, the schedule it goes up on, and that every
 * building draws at every stage without anything coming out of the plot or
 * out of the arithmetic.
 */
import { describe, expect, test } from "bun:test";
import type { Graphics } from "pixi.js";

import { MAX_DRAWN, crewAt, insideBuilt } from "./crew";
import { LOOKS, lookOf } from "./looks";
import { bays, floorsOf, wholeFloors, type Building, type Footprint } from "./model";
import { makePen } from "./pen";
import { PIT, STAGES, siteAt, topOf } from "./schedule";
import {
  LIFT_CYCLE, MAST, OPENING, craneHeight, cranePose, craneRest, drawConfetti, drawFinished, drawSite, drawSky,
  jibLength,
} from "./site";
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

describe("the crane lifts from the yard to the work and back", () => {
  const f = { w: 3, h: 3 };
  const b = lookOf("hq", f);
  const site = siteAt(b, 0.5);
  const hookAt = (t: number) => {
    const q = cranePose(f, b, site, t);
    return { u: MAST.u + Math.cos(q.heading) * q.reach, v: MAST.v + Math.sin(q.heading) * q.reach, ...q };
  };

  test("it picks up at the gate, down on the ground", () => {
    const q = hookAt(2);
    expect(q.u).toBeCloseTo(f.w / 2, 1);
    expect(q.v).toBeCloseTo(f.h - 0.35, 1);
    expect(q.hook).toBeLessThan(1);
    expect(hookAt(2.6).load).toBe(true);
  });

  test("and sets down on the floor being built, then lets go", () => {
    const q = hookAt(10.5);
    expect(q.hook).toBeCloseTo(site.frame + 0.55, 5);
    expect(q.load).toBe(true);
    expect(hookAt(11.2).load).toBe(false);
    // Over the building, not over the yard.
    expect(q.v).toBeLessThan(f.h - 0.6);
  });

  test("it moves smoothly and goes round for ever", () => {
    let last = hookAt(0);
    for (let t = 0.01; t <= LIFT_CYCLE; t += 0.01) {
      const q = hookAt(t);
      expect(Math.abs(q.hook - last.hook)).toBeLessThan(0.2);
      expect(Math.hypot(q.u - last.u, q.v - last.v)).toBeLessThan(0.05);
      last = q;
    }
    const a = hookAt(0.3), z = hookAt(LIFT_CYCLE + 0.3);
    expect(z.hook).toBeCloseTo(a.hook, 6);
    expect(z.heading).toBeCloseTo(a.heading, 6);
  });

  test("its hook never leaves the jib", () => {
    for (let t = 0; t < LIFT_CYCLE; t += 0.25) {
      const q = cranePose(f, b, site, t);
      expect(q.reach).toBeLessThanOrEqual(jibLength(f));
      expect(q.hook).toBeLessThan(craneHeight(site.top));
    }
  });
});

describe("the crew work where the work is", () => {
  test.each(FOOTPRINTS.filter(([id]) => PROJECT_BUILDINGS.some((d) => d.id === id)))("%s: nobody inside a wall", (id, f) => {
    const b = lookOf(id, f);
    for (const p of [0.05, 0.15, 0.3, 0.45, 0.6, 0.75, 0.86, 0.95]) {
      const site = siteAt(b, p);
      for (const w of crewAt(b, f, site, 40, 3.3)) {
        expect(insideBuilt(b, site, w.u, w.v, w.z)).toBe(false);
        expect(w.u).toBeGreaterThanOrEqual(0);
        expect(w.u).toBeLessThanOrEqual(f.w);
        expect(w.v).toBeGreaterThanOrEqual(0);
        expect(w.v).toBeLessThanOrEqual(f.h);
      }
    }
  });

  test("a lone builder works rather than supervises", () => {
    const f = { w: 2, h: 1 }, b = lookOf("garage", f), site = siteAt(b, 0.5);
    expect(crewAt(b, f, site, 1, 0).map((w) => w.role)).toEqual(["fixer"]);
  });

  test("no more drawn than a site's worth, and none with nobody there", () => {
    const f = { w: 3, h: 3 }, b = lookOf("hq", f), site = siteAt(b, 0.5);
    expect(crewAt(b, f, site, 200, 0)).toHaveLength(MAX_DRAWN);
    expect(crewAt(b, f, site, 0, 0)).toHaveLength(0);
  });

  test("each keeps their job from one moment to the next", () => {
    const f = { w: 3, h: 3 }, b = lookOf("hq", f), site = siteAt(b, 0.5);
    const a = crewAt(b, f, site, 10, 1).map((w) => w.role);
    const z = crewAt(b, f, site, 10, 7.5).map((w) => w.role);
    expect(z).toEqual(a);
    expect(a[0]).toBe("foreman");
    expect(a).toContain("cladder");
    expect(a).toContain("carrier");
  });

  test("the cladders stand on the boards at the floor being clad", () => {
    const f = { w: 3, h: 3 }, b = lookOf("hq", f), site = siteAt(b, 0.5);
    const tower = b.masses[1];
    for (const w of crewAt(b, f, site, 14, 0).filter((x) => x.role === "cladder")) {
      expect(w.z).toBeCloseTo(wholeFloors(tower, site.clad), 6);
      expect(w.u > tower.u1 || w.v > tower.v1).toBe(true);
    }
  });
});

describe("a site waiting for materials stands about", () => {
  test("nobody at work, nobody carrying, and everyone where they were", () => {
    const f = { w: 3, h: 3 }, b = lookOf("hq", f), site = siteAt(b, 0.5);
    const busy = crewAt(b, f, site, 10, 2);
    const idle = crewAt(b, f, site, 10, 2, true);
    expect(idle.map((w) => w.role)).toEqual(busy.map((w) => w.role));
    for (const w of idle) {
      expect(w.working).toBe(false);
      expect(w.carrying).toBe(false);
    }
  });
});

describe("it opens with confetti, and then stops", () => {
  test("pieces fall while it lasts, and none after", () => {
    const count = (t: number) => {
      const r = recorder();
      drawConfetti(makePen(r.g, 0, 0, 0, 1, null), { w: 3, h: 3 }, 10, t);
      expect(r.bad()).toBe(0);
      return r.polys();
    };
    expect(count(0.5)).toBeGreaterThan(0);
    expect(count(OPENING + 0.1)).toBe(0);
  });
});

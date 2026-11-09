import { describe, expect, test } from "bun:test";
// THE BOOKS FIRST, as the game loads them: see projects.test.ts.
import "../../../game/quests/books";
import type { Graphics } from "pixi.js";

import { structureDef } from "../def";
import { ENTRY_H, drawEntries, portSetback, wallBehind } from "./entries";
import { lookOf } from "./looks";
import { makePen } from "./pen";

/** A Graphics that only counts what is drawn on it. */
function counter() {
  let polys = 0;
  const g = { poly: () => { polys++; return g; }, fill: () => g } as unknown as Graphics;
  return { g, polys: () => polys };
}

const setup = (id: string) => {
  const def = structureDef(id)!, f = def.footprint;
  return { def, f, b: lookOf(id, f), ports: def.ports ?? [] };
};

describe("where a pipe goes in", () => {
  test("an inlet — an AI building's water, a processor's slop — is flanged onto its own wall, however far back", () => {
    for (const id of ["ai-node", "compute-spire", "gpu-farm", "datacentre", "lattice", "refinery", "dataplant", "contentfarm"]) {
      const { f, b, ports } = setup(id);
      for (const p of ports) {
        const edge = p.face === "S" ? f.w : f.h, back = portSetback(b, f, p);
        expect(back, id).toBeGreaterThanOrEqual(0);
        expect(back, id).toBeCloseTo(edge - wallBehind(b, f, p), 6);
        // A wall stands across it, not just a corner of one: the flange's plate is on it.
        const a = p.at + 0.5, s = p.face === "S";
        expect(b.masses.some((m) => (s ? m.v0 + 0.15 <= a && a <= m.v1 - 0.15 : m.u0 + 0.15 <= a && a <= m.u1 - 0.15) && (s ? m.u1 : m.v1) >= edge - back - 1e-6), id).toBe(true);
      }
      // And no housing is drawn for it.
      const c = counter();
      drawEntries(makePen(c.g, 0, 0, 0, 1, null), b, f, ports);
      expect(c.polys(), id).toBe(0);
    }
  });

  test("a workplace's slop outlet has an entry out to the edge of the plot, its outlet on the face", () => {
    for (const id of ["office-vibe", "studio"]) {
      const { f, b, ports } = setup(id);
      for (const p of ports) expect(portSetback(b, f, p), id).toBe(0);
      const c = counter();
      drawEntries(makePen(c.g, 0, 0, 0, 1, null), b, f, ports);
      expect(c.polys(), id).toBeGreaterThan(ports.length * 6);
    }
    // Taller than the outlet's plate, which stands round a main at 1.1 half steps.
    expect(ENTRY_H).toBeGreaterThan(2);
  });
});

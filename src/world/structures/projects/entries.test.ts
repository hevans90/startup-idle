import { describe, expect, test } from "bun:test";
// THE BOOKS FIRST, as the game loads them: see projects.test.ts.
import "../../../game/quests/books";

import { allStructureDefs, structureDef } from "../def";
import { along, portSetback, wallAcross, wallBehind } from "./entries";
import { lookOf } from "./looks";

/** Every building that has ports, and the two faces the camera sees. */
const withPorts = allStructureDefs().filter((d) => d.ports?.length);
const seen = (face: string) => face === "S" || face === "W";

describe("where a pipe goes in", () => {
  test("the buildings with ports are the ones this was written for", () => {
    expect(withPorts.map((d) => d.id).sort()).toEqual([
      "ai-node", "compute-spire", "contentfarm", "datacentre", "dataplant", "gpu-farm", "lattice", "office-vibe", "refinery", "studio",
    ]);
  });

  test("every port is flanged onto its building's own wall, however far back: none without a wall drawn for it", () => {
    for (const def of withPorts) {
      const f = def.footprint, b = lookOf(def.id, f);
      for (const p of def.ports!.filter((q) => seen(q.face))) {
        const edge = p.face === "S" ? f.w : f.h, back = portSetback(b, f, p);
        expect(back, def.id).toBeGreaterThanOrEqual(0);
        expect(back, def.id).toBeLessThan(edge);
        expect(back, def.id).toBeCloseTo(edge - wallBehind(b, f, p), 6);
        // A wall stands the width of the outlet's plate, not just a corner of one.
        expect(wallAcross(b, f, p), `${def.id} ${p.face}${p.at}`).toBe(true);
      }
    }
  });

  test("a vibe workplace's slop outlet is on a wing of its own block, flush with its side wall, on a small plot and on the Campus's", () => {
    for (const id of ["office-vibe", "studio"]) {
      const def = structureDef(id)!, f = def.footprint, b = lookOf(id, f);
      const [main, ...wings] = b.masses, p = def.ports![0], a = along(p, f);
      expect(wings.length, id).toBe(1);
      const w = wings[0];
      // Part of the block: touching it, flush with the wall the outlet is on, in its material, and lower than it.
      expect(w.u1, id).toBeCloseTo(main.u1, 6);
      expect(Math.min(Math.abs(w.v0 - main.v1), Math.abs(w.v1 - main.v0)), id).toBeLessThan(1e-6);
      expect(w.wall, id).toBe(main.wall);
      expect(w.z1, id).toBeLessThan(main.z1);
      expect(w.v0 <= a + 1e-6 && a <= w.v1 + 1e-6, id).toBe(true);
      // Inside the plot, with room left in front of the wall for the pipe to come in.
      expect(w.v0, id).toBeGreaterThanOrEqual(0);
      expect(w.v1, id).toBeLessThanOrEqual(f.h);
      expect(portSetback(b, f, p), id).toBeGreaterThan(0.1);
    }
  });
});

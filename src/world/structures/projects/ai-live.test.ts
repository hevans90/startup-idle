import { afterEach, describe, expect, test } from "bun:test";
// THE BOOKS FIRST, as the game loads them: see projects.test.ts.
import "../../../game/quests/books";
import type { Graphics } from "pixi.js";

import { createGrid } from "../../grid";
import { damage, stepRepairs } from "../../events/damage";
import { structureDef } from "../def";
import { COOLANT, HOT, channelOf, drawLive, liveState } from "./ai-live";
import { lookOf } from "./looks";
import { makePen } from "./pen";

const DRINKERS = ["ai-node", "gpu-farm", "compute-spire", "datacentre", "lattice"];

/** A Graphics that keeps the colour of everything filled on it. */
function colours() {
  const seen: number[] = [];
  const g = { poly: () => g, circle: () => g, fill: (f: { color: number }) => { seen.push(f.color); return g; } } as unknown as Graphics;
  return { g, seen };
}

describe("an AI building's coolant and circuits", () => {
  test("every one that drinks has panels, its channels inside their glass, clear of its inlets", () => {
    for (const id of DRINKERS) {
      const def = structureDef(id)!, f = def.footprint, live = lookOf(id, f).live!;
      expect(live.panels.length, id).toBeGreaterThan(0);
      for (const q of live.panels) {
        for (const [a, z] of channelOf(q)) {
          expect(a).toBeGreaterThan(q.a0);
          expect(a).toBeLessThan(q.a1);
          expect(z).toBeGreaterThan(q.z0);
          expect(z).toBeLessThan(q.z1);
        }
        // Over an inlet's flange only well above it: the live layer is drawn over the mains.
        for (const p of def.ports ?? []) {
          if ((p.face === "S") !== (q.face === "u")) continue;
          const at = p.at + 0.5;
          if (q.a0 < at + 0.17 && q.a1 > at - 0.17) expect(q.z0, id).toBeGreaterThanOrEqual(1.6);
        }
      }
    }
  });

  test("cool, coolant runs and nothing glows red; overheated, the reverse", () => {
    const live = lookOf("datacentre", { w: 3, h: 3 }).live!;
    const cool = colours();
    drawLive(makePen(cool.g, 0, 0, 0, 1, null), live, 1, { flow: 1, heat: 0 });
    expect(cool.seen).toContain(COOLANT);
    expect(cool.seen).not.toContain(HOT);
    const hot = colours();
    drawLive(makePen(hot.g, 0, 0, 0, 1, null), live, 1, { flow: 0, heat: 1 });
    expect(hot.seen).not.toContain(COOLANT);
    expect(hot.seen).toContain(HOT);
  });

  describe("how it is running", () => {
    afterEach(() => stepRepairs(createGrid(1, 1), 0, false));
    test("idle with nothing to cool; overheated runs hot; shut for anything else, still", () => {
      expect(liveState(9001)).toEqual({ flow: 0.35, heat: 0 });
      const g = createGrid(4, 4);
      damage(g, [9001], "heat");
      damage(g, [9002], "flood");
      expect(liveState(9001)).toEqual({ flow: 0, heat: 1 });
      expect(liveState(9002)).toEqual({ flow: 0, heat: 0 });
    });
  });
});

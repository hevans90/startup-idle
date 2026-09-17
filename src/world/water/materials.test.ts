/**
 * The fluids.
 *
 * Small, but it exists because the numbers here are the only thing that makes
 * one fluid unlike another, and they are tuned against a solver that has been
 * retuned under them more than once. A pair that reads the same way in the game
 * is a pair that has quietly stopped meaning anything.
 */
import { describe, expect, test } from "bun:test";

import { addWater, at, createColumnField, setMaterialDrag, stepFlow, FLOW_DEFAULTS } from "../../fluid/columns";
import { DRY, FLUIDS, fluidChoices, fluidIndexOf, fluidMaterial } from "./materials";

/** How far a blob of a given fluid gets, weighted by how much of it gets there. */
function reach(drag: number): number {
  const f = createColumnField(61, 61, { ...FLOW_DEFAULTS, wind: 0 }, 0.5);
  setMaterialDrag(f, 1, drag);
  for (let y = 28; y <= 32; y++) for (let x = 28; x <= 32; x++) addWater(f, x, y, 4, 1);
  for (let n = 0; n < 90 * 60; n++) stepFlow(f, 1 / 60);
  let vol = 0, sum = 0;
  for (let y = 0; y < 61; y++) {
    for (let x = 0; x < 61; x++) {
      const d = f.depth[at(f, x, y)];
      if (d <= 0) continue;
      vol += d;
      sum += d * Math.hypot(x - 30, y - 30);
    }
  }
  return sum / vol;
}

const byId = (id: string) => FLUIDS.find((m) => m?.id === id)!;

describe("the fluids differ in the game, not just on paper", () => {
  test("sludge settles visibly short of where water gets to", () => {
    const water = byId("water"), slop = byId("slop");
    expect(slop.drag).toBeLessThan(water.drag);
    // Not a hair's difference: 9.3 tiles against 11.0. The pair was once 0.30
    // and 0.55, and matching that RATIO against water's much weaker damping
    // put them within 3% of each other — it is the gap between the damping
    // rates that has to be kept, not their ratio.
    expect(reach(slop.drag)).toBeLessThan(reach(water.drag) * 0.9);
  });

  test("every fluid is slower to give up its momentum than it is to move", () => {
    // A retention at or above 1 would be a fluid that never stops.
    for (const m of FLUIDS) {
      if (!m) continue;
      expect(m.drag).toBeGreaterThan(0);
      expect(m.drag).toBeLessThan(1);
    }
  });
});

describe("the table", () => {
  test("index 0 is dry, and is not a fluid", () => {
    expect(DRY).toBe(0);
    expect(FLUIDS[0]).toBeNull();
    expect(fluidMaterial(DRY)).toBeNull();
  });

  test("ids round-trip to indices, and an unknown one is dry", () => {
    for (const { index, material } of fluidChoices()) {
      expect(fluidIndexOf(material.id)).toBe(index);
      expect(fluidMaterial(index)).toBe(material);
    }
    expect(fluidIndexOf("custard")).toBe(DRY);
  });

  test("choices skip the dry slot, so a tool never offers 'no fluid'", () => {
    const choices = fluidChoices();
    expect(choices.length).toBe(FLUIDS.length - 1);
    expect(choices.every((c) => c.index > 0)).toBe(true);
  });
});

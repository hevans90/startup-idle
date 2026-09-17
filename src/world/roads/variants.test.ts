/**
 * Which inner-corner variants exist, and what they are called.
 *
 * These names are the contract between the baker and the engine: the baker
 * writes `roadCorner_*` frames into the derived sheet, and the resolver asks
 * for them by name. If the two disagree a cell silently renders bare, so the
 * naming and the enumeration are both pinned here.
 */
import { describe, expect, test } from "bun:test";

import { DIAG, DIR } from "./mask";
import { notchVariantFrame } from "./notch";
import { buildRoadTable, roadSpriteFor } from "./table";
import { notchVariantsNeeded, reachableMasks } from "./variants";

const TABLE = buildRoadTable("landscape");

describe("reachableMasks", () => {
  test("only masks a real grid can produce", () => {
    const all = reachableMasks();
    expect(all).toHaveLength(47);
    // a diagonal without both its flanking orthogonals cannot happen
    expect(all).not.toContain(DIAG.NE);
    expect(all).toContain(DIR.N | DIR.E | DIAG.NE);
  });
});

describe("notchVariantFrame", () => {
  test("canonical regardless of the order the corners arrive in", () => {
    expect(notchVariantFrame("landscapeTiles_081.png", ["SW", "NE"]))
      .toBe(notchVariantFrame("landscapeTiles_081.png", ["NE", "SW"]));
  });

  test("names the base's id and the corners", () => {
    expect(notchVariantFrame("landscapeTiles_081.png", ["NE", "SE", "SW", "NW"]))
      .toBe("roadCorner_081_NESESWNW.png");
    expect(notchVariantFrame("landscapeTiles_087.png", ["SE"]))
      .toBe("roadCorner_087_SE.png");
  });

  test("distinguishes base and corners", () => {
    const a = notchVariantFrame("landscapeTiles_081.png", ["NE"]);
    expect(a).not.toBe(notchVariantFrame("landscapeTiles_087.png", ["NE"]));
    expect(a).not.toBe(notchVariantFrame("landscapeTiles_081.png", ["SE"]));
  });
});

describe("notchVariantsNeeded", () => {
  const needed = notchVariantsNeeded(TABLE);

  test("22 variants — the masks a single tile cannot express", () => {
    expect(needed).toHaveLength(22);
    const byCount: Record<number, number> = {};
    for (const v of needed) byCount[v.notches.length] = (byCount[v.notches.length] ?? 0) + 1;
    expect(byCount).toEqual({ 1: 12, 2: 6, 3: 4 });
  });

  test("covers exactly what the resolver asks for, and no more", () => {
    const asked = new Set<string>();
    for (const mask of reachableMasks()) {
      const p = roadSpriteFor(TABLE, mask);
      if (p.notches.length && p.frame) asked.add(p.frame);
    }
    expect(new Set(needed.map((v) => v.baked))).toEqual(asked);
  });

  test("every variant's BASE is a real un-composited frame", () => {
    for (const v of needed) {
      expect(v.frame.startsWith("landscapeTiles_")).toBe(true);
      expect(v.baked.startsWith("roadCorner_")).toBe(true);
      expect(v.baked).toBe(notchVariantFrame(v.frame, v.notches));
    }
  });

  test("baked names are unique, so no variant overwrites another in the sheet", () => {
    expect(new Set(needed.map((v) => v.baked)).size).toBe(needed.length);
  });

  test("only fill and lane bases need one", () => {
    const bases = new Set(needed.map((v) => v.frame));
    expect(bases).toEqual(new Set([
      "landscapeTiles_081.png",   // fill
      "landscapeTiles_080.png", "landscapeTiles_087.png",
      "landscapeTiles_088.png", "landscapeTiles_095.png",   // the four lanes
    ]));
  });
});

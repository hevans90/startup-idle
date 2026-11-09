import { describe, expect, test } from "bun:test";
// Books first: chapters → finale → quest.store → books is a cycle. @see test-parallel
import "../../game/quests/books";

import { lapsOf, type StreetProp } from "./street-props";

describe("lapsOf", () => {
  const all = () => true;
  const edges = (pr: StreetProp, paved = all) => lapsOf([pr], paved).map((l) => `${l.edge}@${l.x},${l.y}`);

  test("a straight run is laid again by the road tile after it along its kerb", () => {
    expect(edges({ kind: "brick", x: 4, y: 7, side: "N" })).toEqual(["u@5,7"]);
    expect(edges({ kind: "brick", x: 4, y: 7, side: "W" })).toEqual(["v@4,8"]);
    // No road beyond, nothing paints over it.
    expect(edges({ kind: "brick", x: 4, y: 7, side: "N" }, () => false)).toEqual([]);
  });

  test("a curve only where it ends on a far edge", () => {
    // Centred at (0, 0): its ends lie on the near edges, drawn over by nothing later.
    expect(edges({ kind: "bend", x: 3, y: 7, side: "N", corner: 0 })).toEqual([]);
    expect(edges({ kind: "bend", x: 3, y: 7, side: "N", corner: 2 })).toEqual(["u@4,7", "v@3,8"]);
    expect(edges({ kind: "nub", x: 3, y: 7, side: "N", corner: 1 })).toEqual(["u@4,7"]);
    expect(edges({ kind: "nub", x: 3, y: 7, side: "N", corner: 3 })).toEqual(["v@3,8"]);
  });

  test("nothing but paving laps", () => {
    expect(edges({ kind: "lamp", x: 4, y: 7, side: "N" })).toEqual([]);
  });
});

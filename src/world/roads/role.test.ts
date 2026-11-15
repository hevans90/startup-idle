/** A road cell's role, by which of its eight neighbours are paved. */
import { describe, expect, test } from "bun:test";

import { DIR } from "../../iso/dir";
import { DIAG } from "./mask";
import { resolveRole } from "./role";

const ALL_DIAG = DIAG.NE | DIAG.SE | DIAG.SW | DIAG.NW;
const ORTH = DIR.N | DIR.E | DIR.S | DIR.W;

describe("resolveRole", () => {
  test("four connections with every diagonal is INTERIOR fill", () => {
    expect(resolveRole(ORTH, ALL_DIAG)).toBe("thick-fill");
  });

  test("four connections with NO diagonal is a crossroads", () => {
    expect(resolveRole(ORTH, 0)).toBe("thin-cross");
  });

  test("any paved diagonal means fill, not a crossroads", () => {
    // the crossroads tile has grass in all four corners, so one paved diagonal
    // already makes it wrong — this is the 2-wide junction case
    expect(resolveRole(ORTH, DIAG.SW)).toBe("thick-fill");
    expect(resolveRole(ORTH, ALL_DIAG & ~DIAG.NE)).toBe("thick-fill");
    expect(resolveRole(ORTH, ALL_DIAG)).toBe("thick-fill");
  });

  test("three connections with both far corners paved is a wide-road lane", () => {
    // missing N, so behind is S, whose flanking diagonals are SE and SW
    expect(resolveRole(DIR.E | DIR.S | DIR.W, DIAG.SE | DIAG.SW)).toBe("thick-lane");
    // missing S → behind is N → NE and NW
    expect(resolveRole(DIR.N | DIR.E | DIR.W, DIAG.NE | DIAG.NW)).toBe("thick-lane");
  });

  test("three connections with BOTH far corners on grass is a T-junction", () => {
    expect(resolveRole(DIR.E | DIR.S | DIR.W, 0)).toBe("thin-T");
    // diagonals on the closed side are irrelevant — that side is grass anyway
    expect(resolveRole(DIR.E | DIR.S | DIR.W, DIAG.NE | DIAG.NW)).toBe("thin-T");
  });

  /**
   * "Pave a 2x2, then pave one cell outwards." The corner cell of the square
   * keeps one paved far diagonal and loses the other. `thin-T` kerbs BOTH far
   * corners, which drew a kerb straight across solid pavement — a hard line in
   * the middle of the road. `thick-lane` paves both, so the worst it does is
   * miss a small notch at the outside edge.
   */
  test("ONE far corner paved still takes the lane, never the T", () => {
    expect(resolveRole(DIR.E | DIR.S | DIR.W, DIAG.SE)).toBe("thick-lane");
    expect(resolveRole(DIR.E | DIR.S | DIR.W, DIAG.SW)).toBe("thick-lane");
    expect(resolveRole(DIR.N | DIR.E | DIR.S, DIAG.NE)).toBe("thick-lane");
    expect(resolveRole(DIR.N | DIR.E | DIR.S, DIAG.SE)).toBe("thick-lane");
  });

  test("two OPPOSITE sides is a straight, whatever the diagonals", () => {
    expect(resolveRole(DIR.N | DIR.S, 0)).toBe("thin-straight");
    expect(resolveRole(DIR.E | DIR.W, 0)).toBe("thin-straight");
    expect(resolveRole(DIR.N | DIR.S, DIAG.NE | DIAG.SW)).toBe("thin-straight");
  });

  test("two ADJACENT sides is a turn, and the diagonal picks which art", () => {
    // paved diagonal → corner of a BLOCK, road fills the cell, square edges
    expect(resolveRole(DIR.N | DIR.E, DIAG.NE)).toBe("thick-outer-corner");
    expect(resolveRole(DIR.S | DIR.W, DIAG.SW)).toBe("thick-outer-corner");
    // grass diagonal → a single-width road turning, which the artset draws
    // only as a CURVE
    expect(resolveRole(DIR.N | DIR.E, 0)).toBe("thick-curve");
    expect(resolveRole(DIR.S | DIR.W, 0)).toBe("thick-curve");
    // only the vertex's OWN diagonal matters
    expect(resolveRole(DIR.N | DIR.E, DIAG.SW | DIAG.SE | DIAG.NW)).toBe("thick-curve");
    expect(resolveRole(DIR.E | DIR.S, DIAG.SE)).toBe("thick-outer-corner");
    expect(resolveRole(DIR.W | DIR.N, DIAG.NW)).toBe("thick-outer-corner");
  });

  test("one connection is a dead end; none is a patch of pavement", () => {
    expect(resolveRole(DIR.N, 0)).toBe("thin-end");
    expect(resolveRole(0, 0)).toBe("thick-fill");
  });
});

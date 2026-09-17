/**
 * The derived mask → sprite table.
 *
 * Asserted against the REAL label files, because the point of deriving is that
 * the table cannot drift from what the labeller authored. v1's hand-written
 * table omits all four outer corners despite the art being labelled, so every
 * bend in a v1 road silently becomes plain asphalt — these tests exist so that
 * class of gap is loud instead.
 */
import { describe, expect, test } from "bun:test";

import { DIR } from "../../iso/dir";
import { DIAG } from "./mask";
import {
  buildRoadTable, cornersExpressible, openMaskOf, resolveRole, roadCoverage,
  roadSpriteFor,
} from "./table";

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

describe("openMaskOf", () => {
  test("reads the labeller's edge names", () => {
    expect(openMaskOf({ open: { N: true, S: true } })).toBe(DIR.N | DIR.S);
    expect(openMaskOf({})).toBe(0);
  });
});

describe("landscape table", () => {
  const t = buildRoadTable("landscape");

  test("every mask resolves to SOME tile, so a network never gaps", () => {
    for (const diag of [0, ALL_DIAG]) {
      for (const row of roadCoverage(t, diag)) {
        expect(row.frame).not.toBeNull();
      }
    }
  });

  test("all four diagonal-paved corners are present — the gap v1 has", () => {
    const corners = t.byRole.get("thick-outer-corner")!;
    expect(corners.size).toBe(4);
    for (const pair of [DIR.N | DIR.E, DIR.E | DIR.S, DIR.S | DIR.W, DIR.W | DIR.N]) {
      expect(corners.get(pair)).toBeTruthy();
    }
  });

  test("the interior of a plaza and a lone paved square both use fill", () => {
    // every corner interior, or none to notch, so the plain fill is what draws
    expect(roadSpriteFor(t, ORTH | ALL_DIAG).frame).toBe(t.fill);
    expect(roadSpriteFor(t, 0).frame).toBe(t.fill);
    expect(t.fill).toBe("landscapeTiles_081.png");
  });

  test("a 1-wide crossroads is NOT the fill tile", () => {
    expect(roadSpriteFor(t, ORTH).frame).not.toBe(t.fill);
  });

  test("a 2-wide junction cell uses fill, so no grass lands mid-intersection", () => {
    // four orthogonals and exactly one paved diagonal, which is what each cell
    // of a 2x2 junction actually sees
    const pick = roadSpriteFor(t, ORTH | DIAG.SW);
    expect(pick.role).toBe("thick-fill");
    expect(pick.base).toBe(t.fill);
    // its other three corners need notching, so it DRAWS the baked variant
    expect(pick.notches).toEqual(["NE", "SE", "NW"]);
    expect(pick.frame).toBe("roadCorner_081_NESENW.png");
  });

  /**
   * The whole point of `roadCoverage`: if any mask stops resolving exactly,
   * this fails and names it. Landscape is fully covered as of the
   * `thick-curve` labelling pass.
   */
  test("EVERY mask resolves exactly — no substitutions anywhere", () => {
    for (const diag of [0, ALL_DIAG]) {
      const inexact = roadCoverage(t, diag).filter((r) => !r.exact);
      expect(inexact.map((r) => r.open)).toEqual([]);
    }
  });

  test("a lone paved square is fill, and that is the right tile for it", () => {
    // it has no open edges, so there is no mask to match — fill is chosen by
    // ROLE, and asking whether its own open mask equals the cell's is the
    // wrong question
    const pick = roadSpriteFor(t, 0);
    expect(pick.frame).toBe("landscapeTiles_081.png");
    expect(pick.exact).toBe(true);
  });

  test("a single-width turn resolves to a CURVE, exactly, in all four directions", () => {
    for (const [orth, frame] of [
      [DIR.S | DIR.W, "landscapeTiles_123.png"],
      [DIR.E | DIR.S, "landscapeTiles_125.png"],
      [DIR.N | DIR.W, "landscapeTiles_126.png"],
      [DIR.N | DIR.E, "landscapeTiles_127.png"],
    ] as const) {
      const pick = roadSpriteFor(t, orth);
      expect(pick.role).toBe("thick-curve");
      expect(pick.exact).toBe(true);
      expect(pick.frame).toBe(frame);
      expect(pick.notches).toEqual([]);   // a turn's one corner is in the art
    }
  });

  test("a BLOCK corner still gets the square-edged tile, not a curve", () => {
    for (const [orth, diagBit, frame] of [
      [DIR.S | DIR.W, DIAG.SW, "landscapeTiles_114.png"],
      [DIR.E | DIR.S, DIAG.SE, "landscapeTiles_118.png"],
      [DIR.N | DIR.W, DIAG.NW, "landscapeTiles_119.png"],
      [DIR.N | DIR.E, DIAG.NE, "landscapeTiles_122.png"],
    ] as const) {
      const pick = roadSpriteFor(t, orth | diagBit);
      expect(pick.role).toBe("thick-outer-corner");
      expect(pick.exact).toBe(true);
      expect(pick.frame).toBe(frame);
    }
  });



  test("a 2-wide avenue's two columns pick DIFFERENT lane tiles", () => {
    const left = roadSpriteFor(t, DIR.E | DIR.S | DIR.W | DIAG.SE | DIAG.SW);
    const right = roadSpriteFor(t, DIR.N | DIR.E | DIR.W | DIAG.NE | DIAG.NW);
    expect(left.role).toBe("thick-lane");
    expect(right.role).toBe("thick-lane");
    expect(left.frame).not.toBe(right.frame);
    expect(left.exact && right.exact).toBe(true);
  });

  /**
   * `width` is legacy data the labeller no longer authors, and filtering on it
   * excluded exactly one tile — the N–S straight, whose E–W twin is marked
   * `thick` despite being the same thing. Thick-only is enforced by the ROLES
   * the resolver asks for, not by this field.
   */
  test("both straights are available, on either axis", () => {
    const straights = t.byRole.get("thin-straight")!;
    expect(straights.get(DIR.N | DIR.S)).toBe("landscapeTiles_074.png");
    expect(straights.get(DIR.E | DIR.W)).toBe("landscapeTiles_082.png");
    expect(roadSpriteFor(t, DIR.N | DIR.S).exact).toBe(true);
    expect(roadSpriteFor(t, DIR.E | DIR.W).exact).toBe(true);
  });

  test("the resolver never asks for a thin-family ROLE", () => {
    // the thin road has its own corner role; the thick vocabulary is
    // fill / lane / outer-corner / inner-corner, plus the shared shape names
    const asked = new Set<string>();
    for (let orth = 0; orth <= ORTH; orth++) {
      for (const diag of [0, ALL_DIAG]) asked.add(resolveRole(orth, diag));
    }
    expect(asked.has("thin-corner" as never)).toBe(false);
  });
});

describe("city table", () => {
  const t = buildRoadTable("city");

  test("covers everything except the two masks nobody has labelled", () => {
    const missing = roadCoverage(t, 0).filter((r) => r.frame === null).map((r) => r.open);
    // an E-facing dead end and the N–E corner have no city tile marked as road
    expect(missing.sort()).toEqual(["E", "NE"]);
  });

  /**
   * The city sheet is far less labelled than landscape — roughly 20 of its
   * asphalt tiles carry no road label at all. This is the list of what it
   * cannot draw today, and it shrinks as that pass happens.
   */
  test("names what the city labels do not cover", () => {
    const inexact = roadCoverage(t, 0).filter((r) => !r.exact);
    expect(inexact.map((r) => r.open).sort()).toEqual(
      ["E", "ES", "NE", "NW", "SW"],
    );
    // no city tile is marked road for an E-facing dead end or an N–E turn
    for (const open of ["E", "NE"]) {
      expect(inexact.find((r) => r.open === open)!.frame).toBeNull();
    }
    // the other three turns substitute the square block corner, as landscape
    // did before its curves were labelled
    for (const open of ["ES", "NW", "SW"]) {
      const row = inexact.find((r) => r.open === open)!;
      expect(row.role).toBe("thick-curve");
      expect(row.frame).not.toBeNull();
    }
  });

  test("is a different sheet from the landscape set", () => {
    for (const row of roadCoverage(t, 0)) {
      if (row.frame) expect(row.frame.startsWith("cityTiles_")).toBe(true);
    }
  });
});

/**
 * The artset's real limit, enumerated.
 *
 * Every road tile is ALL-OR-NOTHING across its inner corners — fill paves all
 * four, cross kerbs all four, lane paves both far corners, T kerbs both. A cell
 * wanting a MIXTURE (some corners interior, some needing a kerbed notch) has no
 * tile, and no labelling fixes it: 091/092/093 are grass paths at 0% asphalt,
 * and 094/101/102/108 are lane-plus-thin-branch junctions rather than clean
 * notch pieces.
 *
 * This is the list to work from if the art is ever drawn — and it should shrink,
 * never grow.
 */
describe("inner-corner coverage", () => {
  const t = buildRoadTable("landscape");
  const V = ["NE", "SE", "SW", "NW"] as const;
  const FLANKS = {
    NE: DIR.N | DIR.E, SE: DIR.S | DIR.E, SW: DIR.S | DIR.W, NW: DIR.N | DIR.W,
  } as const;

  /** Masks a real grid can produce: a diagonal needs both its orthogonals. */
  const reachable = () => {
    const out: { orth: number; diag: number }[] = [];
    for (let orth = 0; orth <= 15; orth++) {
      for (let d = 0; d <= 15; d++) {
        const diag = d << 4;
        if (V.every((v) => !(diag & DIAG[v]) || (orth & FLANKS[v]) === FLANKS[v])) {
          out.push({ orth, diag });
        }
      }
    }
    return out;
  };

  test("47 masks are reachable, and 22 of them need art that does not exist", () => {
    const all = reachable();
    expect(all).toHaveLength(47);
    const missing = all.filter(({ orth, diag }) => !cornersExpressible(orth, diag));
    expect(missing).toHaveLength(22);
  });

  test("the gap is exactly the MIXED corner cases, in two families", () => {
    for (const { orth, diag } of reachable()) {
      const inner = V.filter((v) => (orth & FLANKS[v]) === FLANKS[v]);
      const paved = inner.filter((v) => diag & DIAG[v]).length;
      const mixed = inner.length >= 2 && paved > 0 && paved < inner.length;
      expect(cornersExpressible(orth, diag)).toBe(!mixed);
      // only 3- and 4-connection cells have two or more inner corners, so only
      // they can be mixed — a turn has one and both variants are labelled
      if (mixed) expect(inner.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("what a single tile cannot express, a BAKED variant makes up exactly", () => {
    for (const { orth, diag } of reachable()) {
      const pick = roadSpriteFor(t, orth | diag);
      expect(pick.frame).not.toBeNull();
      expect(pick.exact).toBe(true);          // baked, so always drawable
      // the notches are precisely the corners a single tile could not do
      const needsVariant = !cornersExpressible(orth, diag);
      expect(pick.notches.length > 0).toBe(needsVariant);
      // and when one is needed, the frame drawn is the baked tile, not the base
      expect(pick.frame!.startsWith("roadCorner_")).toBe(needsVariant);
      if (!needsVariant) expect(pick.frame).toBe(pick.base);
    }
  });

  test("notches are only added to roles whose base leaves corners paved", () => {
    for (const { orth, diag } of reachable()) {
      const pick = roadSpriteFor(t, orth | diag);
      if (!pick.notches.length) continue;
      expect(["thick-fill", "thick-lane"]).toContain(pick.role);
    }
  });

  test("a crossroads uses the four-nub tile rather than four overlays", () => {
    const ORTH_ALL = DIR.N | DIR.E | DIR.S | DIR.W;
    const pick = roadSpriteFor(t, ORTH_ALL);
    expect(pick.role).toBe("thin-cross");
    expect(pick.notches).toEqual([]);
  });

  test("the clean extremes ARE expressible, which is why a loop and a plaza look right", () => {
    const ORTH_ALL = DIR.N | DIR.E | DIR.S | DIR.W;
    expect(cornersExpressible(ORTH_ALL, ALL_DIAG)).toBe(true);   // plaza interior
    expect(cornersExpressible(ORTH_ALL, 0)).toBe(true);          // crossroads
    expect(cornersExpressible(DIR.S | DIR.W, 0)).toBe(true);      // a turn
    expect(cornersExpressible(DIR.S | DIR.W, DIAG.SW)).toBe(true); // a block corner
  });
});

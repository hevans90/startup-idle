import { describe, expect, test } from "bun:test";

import { DIR } from "../../iso/dir";
import { SEWER_FIT, createGrid, fillTerrain, idx, type Grid } from "../grid";
import { planNode, planSewer, routeSewer, SPAN_PRICE, type SewerPlan } from "./lay";
import { NODE_EVERY, SEWER_KIND, solveSewers } from "./solve";
import { sewerProfile, topOf } from "../pipes/profile";
import { structureDef } from "../structures/def";
import { validatePlacement } from "../structures/place";

const PRICES = { unit: 10, liftPrice: 1000 };

/** A map `w` by 9 at height 4, a pond along x = 0. */
function field(w = 30, heights?: (x: number) => number): { g: Grid; wet: (x: number, y: number) => boolean } {
  const g = createGrid(w, 9);
  fillTerrain(g, 1);
  for (let y = 0; y < 9; y++) for (let x = 0; x < w; x++) g.height[idx(g, x, y)] = heights?.(x) ?? 4;
  return { g, wet: (x) => x === 0 };
}

function plan(g: Grid, wet: (x: number, y: number) => boolean, from: { x: number; y: number }, to: { x: number; y: number }): SewerPlan {
  const route = routeSewer(g, from, to, wet);
  expect(route).not.toBeNull();
  const p = planSewer(g, route!, wet, PRICES);
  if ("refused" in p) throw new Error(p.refused);
  return p;
}

/** Lay a plan on the map. */
function lay(g: Grid, p: SewerPlan) {
  for (const c of p.cells) {
    const i = idx(g, c.x, c.y);
    g.sewer[i] |= c.join;
    if (c.fit) g.sewerFit[i] = c.fit;
  }
  g.rev++;
}

describe("laying a sewer", () => {
  test("dragged into a pond, it stops at the bank with an outfall, and a node at its far end", () => {
    const { g, wet } = field();
    const p = plan(g, wet, { x: 0, y: 4 }, { x: 6, y: 4 });
    expect(p.cells[0]).toMatchObject({ x: 1, y: 4, fit: SEWER_FIT.outfall });
    expect(p.cells[p.cells.length - 1]).toMatchObject({ x: 6, y: 4, fit: SEWER_FIT.node });
    expect(p.exit).toBe(true);
    expect(p.capacity).toBeGreaterThan(0);
    expect(p.problem).toBeNull();
  });

  test("a long run gets a manhole at least every few tiles, and one at a bend", () => {
    const { g, wet } = field();
    const p = plan(g, wet, { x: 1, y: 1 }, { x: 25, y: 7 });
    const fits = p.cells.map((c) => c.fit);
    let since = 0;
    for (const f of fits) { since = f ? 0 : since + 1; expect(since).toBeLessThan(NODE_EVERY); }
    const bend = p.cells.find((c) => c.join !== (DIR.N | DIR.S) && c.join !== (DIR.E | DIR.W) && c !== p.cells[0] && c !== p.cells[p.cells.length - 1]);
    expect(bend?.fit).toBe(SEWER_FIT.node);
  });

  test("it goes round a building, never under", () => {
    const { g, wet } = field();
    for (let y = 2; y <= 6; y++) g.structureAt[idx(g, 5, y)] = 7;
    const route = routeSewer(g, { x: 1, y: 4 }, { x: 9, y: 4 }, wet)!;
    expect(route.some((c) => c.x === 5 && c.y >= 2 && c.y <= 6)).toBe(false);
    expect(planSewer(g, [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }], wet, PRICES)).toEqual({ refused: "A sewer can't go under a building" });
  });

  test("without water or a processor at an end, it has no exit", () => {
    const { g, wet } = field();
    const p = plan(g, wet, { x: 5, y: 4 }, { x: 12, y: 4 });
    expect(p.exit).toBe(false);
    expect(p.capacity).toBe(0);
  });

  test("dug deeper, a tile costs more; a span more still; a lift station its price", () => {
    // Flat: each tile a cover deep, or a little more as it falls.
    const flat = field();
    const a = plan(flat.g, flat.wet, { x: 1, y: 4 }, { x: 8, y: 4 });
    expect(a.price).toBeGreaterThanOrEqual(a.fresh * PRICES.unit);
    // A valley to span.
    const v = field(30, (x) => (x >= 4 && x <= 6 ? 0 : 4));
    const b = plan(v.g, v.wet, { x: 1, y: 4 }, { x: 10, y: 4 });
    expect(b.spans).toBeGreaterThan(0);
    expect(b.price).toBeGreaterThan(a.price + b.spans * PRICES.unit * (SPAN_PRICE - 1.5));
    // A hill too high: lifted.
    const h = field(30, (x) => (x >= 4 && x <= 6 ? 11 : 4));
    const c = plan(h.g, h.wet, { x: 1, y: 4 }, { x: 10, y: 4 });
    expect(c.lifts.length).toBe(1);
    expect(c.solve.kind[c.lifts[0]]).toBe(SEWER_KIND.lift);
    expect(c.price).toBeGreaterThan(PRICES.liftPrice);
  });

  test("dragged from a sewer laid already, it joins it and drains through it", () => {
    const { g, wet } = field();
    lay(g, plan(g, wet, { x: 0, y: 4 }, { x: 10, y: 4 }));
    const p = plan(g, wet, { x: 6, y: 4 }, { x: 6, y: 8 });
    expect(p.fresh).toBe(4);
    expect(p.exit).toBe(true);
    // The junction keeps what it was; a manhole put there if it had none.
    expect(p.cells[0].fit).toBe(0);
    expect(p.staged.sewerFit[idx(g, 6, 4)]).toBe(SEWER_FIT.node);
    expect(p.staged.sewer[idx(g, 6, 4)] & DIR.W).toBeTruthy();
  });

  test("a node added by hand goes on a laid sewer with ground over it", () => {
    const { g, wet } = field();
    lay(g, plan(g, wet, { x: 0, y: 4 }, { x: 6, y: 4 }));
    expect(planNode(g, { x: 3, y: 4 })).toEqual({ cell: idx(g, 3, 4) });
    expect(planNode(g, { x: 3, y: 5 })).toHaveProperty("refused");
    expect(planNode(g, { x: 1, y: 4 })).toEqual({ refused: "It has one already" });
  });
});

describe("placing what makes slop", () => {
  const office = () => structureDef("office-vibe")!;
  test("needs a live manhole within a lateral's reach of its slop port", () => {
    const { g, wet } = field(30);
    // Nowhere near a sewer: refused.
    expect(validatePlacement(g, office(), 10, 2, { needsSewer: true })).toMatchObject({ ok: false, reason: "No manhole in reach" });
    // A trunk from the pond to (12, 4), its end a manhole.
    lay(g, plan(g, wet, { x: 0, y: 4 }, { x: 12, y: 4 }));
    expect(validatePlacement(g, office(), 10, 1, { needsSewer: true }).ok).toBe(true);
    // Without the rule (the editor, or before slop is made), anywhere.
    expect(validatePlacement(g, office(), 24, 1).ok).toBe(true);
  });

  test("a manhole on a sewer with no exit serves nothing", () => {
    const { g, wet } = field(30);
    lay(g, plan(g, wet, { x: 6, y: 4 }, { x: 12, y: 4 }));
    expect(validatePlacement(g, office(), 10, 1, { needsSewer: true }).ok).toBe(false);
  });

  test("nothing is built over a trunk", () => {
    const { g, wet } = field(30);
    lay(g, plan(g, wet, { x: 0, y: 4 }, { x: 12, y: 4 }));
    expect(validatePlacement(g, office(), 6, 3)).toMatchObject({ ok: false, reason: "over a sewer" });
  });
});

describe("the profile: a sewer from the side", () => {
  test("under flat ground it lies a slab down and falls toward its exit, its manhole and its outfall marked", () => {
    const { g, wet } = field();
    const p = plan(g, wet, { x: 0, y: 4 }, { x: 12, y: 4 });
    const prof = sewerProfile(p.staged, p.solve, p.staged.sewerFit, topOf(p.solve, p.cells.map((c) => idx(g, c.x, c.y))))!;
    expect(prof.kind).toBe("sewer");
    // From the far end down to the bank.
    expect(prof.cells[0]).toBe(idx(g, 12, 4));
    expect(prof.cells.at(-1)).toBe(idx(g, 1, 4));
    for (let k = 1; k < prof.pipe.length; k++) expect(prof.pipe[k]).toBeLessThan(prof.pipe[k - 1]);
    expect(prof.pipe.every((z, k) => z < prof.ground[k])).toBe(true);
    expect(prof.marks).toContainEqual({ at: 0, kind: "manhole" });
    expect(prof.marks).toContainEqual({ at: prof.cells.length - 1, kind: "exit" });
    expect(prof.bad).toEqual([]);
    expect(prof.spans!.some(Boolean)).toBe(false);
  });

  test("a dip is spanned, a hill lifted, and both show where they are", () => {
    // A dip four tiles wide at x 5–8.
    const dip = field(30, (x) => (x >= 5 && x <= 8 ? 0 : 4));
    const d = plan(dip.g, dip.wet, { x: 0, y: 4 }, { x: 14, y: 4 });
    const dp = sewerProfile(d.staged, d.solve, d.staged.sewerFit, topOf(d.solve, d.cells.map((c) => idx(dip.g, c.x, c.y))))!;
    expect(d.spans).toBeGreaterThan(0);
    expect(dp.spans!.filter(Boolean).length).toBe(d.spans);
    expect(dp.cells.filter((_, k) => dp.spans![k]).every((c) => { const x = c % dip.g.w; return x >= 5 && x <= 8; })).toBe(true);
    // A hill too high to dig through, at x 6–8.
    const hill = field(30, (x) => (x >= 6 && x <= 8 ? 12 : 4));
    const h = plan(hill.g, hill.wet, { x: 0, y: 4 }, { x: 14, y: 4 });
    const hp = sewerProfile(h.staged, h.solve, h.staged.sewerFit, topOf(h.solve, h.cells.map((c) => idx(hill.g, c.x, c.y))))!;
    expect(h.lifts.length).toBeGreaterThan(0);
    expect(hp.marks.filter((m) => m.kind === "lift").map((m) => hp.cells[m.at]).sort()).toEqual([...h.lifts].sort());
  });

  test("the red stretch is where the solve says the fault is, with its reason", () => {
    // A dip at x 5–8, spanned. The solve digs under or lifts rather than leave a fault, so one is handed it:
    // three tiles of the span said to be too long, as it says such things.
    const { g, wet } = field(30, (x) => (x >= 5 && x <= 8 ? 0 : 4));
    lay(g, plan(g, wet, { x: 0, y: 4 }, { x: 14, y: 4 }));
    const on = idx(g, 6, 4);
    expect(solveSewers(g).kind[on]).toBe(SEWER_KIND.span);
    const wrong = [idx(g, 7, 4), idx(g, 6, 4), idx(g, 5, 4)];
    const solve = { ...solveSewers(g), problems: wrong.map((cell) => ({ cell, reason: "A span longer than 8 tiles" })) };
    const prof = sewerProfile(g, solve, g.sewerFit, idx(g, 14, 4))!;
    // One stretch, those tiles and no others, and the solve's own words.
    expect(prof.bad).toHaveLength(1);
    expect(prof.bad.flatMap(([a, b]) => prof.cells.slice(a, b + 1))).toEqual(wrong);
    expect(prof.reason).toBe("A span longer than 8 tiles");
    // And one with no exit says so, with nothing red to point at.
    for (let i = 0; i < g.sewerFit.length; i++) if (g.sewerFit[i] === SEWER_FIT.outfall) g.sewerFit[i] = 0;
    g.rev++;
    const cut = sewerProfile(g, solveSewers(g), g.sewerFit, idx(g, 14, 4))!;
    expect([cut.bad, cut.reason]).toEqual([[], "No exit yet"]);
  });
});

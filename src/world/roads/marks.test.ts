/**
 * A WIDE ROAD'S MARKINGS come from its lanes, so there are rules they keep on
 * ANY map — not a list of layouts that happen to work. Checked here on the
 * layouts a town has, and on roads laid at random.
 */
import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { buildLaneGraph, laneSpan, lanesFor, type LaneGraph } from "../agents/lanes/graph";
import { lengths, pointAt, type Pt } from "../agents/lanes/geometry";
import { EDGE, LINE, marksOf } from "./marks";
import { lookAt } from "./looks";

type Shape = { kind: string; arg: string; pts: Pt[] };
/** Every shape of a map, back in the world's own coordinates. */
function shapesOf(g: Grid, G: LaneGraph): Shape[] {
  const out: Shape[] = [];
  marksOf(g, G).forEach((text, i) => {
    if (!text) return;
    const x = i % g.w, y = (i - x) / g.w;
    for (const item of text.split(";")) {
      const cut = item.indexOf(":");
      // (A roundel's second pair is the way it faces, not a place.)
      out.push({ kind: item[0], arg: item.slice(1, cut), pts: item.slice(cut + 1).split(" ").map((q, k) => { const [u, v] = q.split(",").map(Number); return item[0] === "R" && k === 1 ? { x: u, y: v } : { x: u + x - 0.5, y: v + y - 0.5 }; }) });
    }
  });
  return out;
}
/** (On the road, or within the kerb's width of it: a line that grazes an inside corner runs under the pavement there, which is drawn over it.) */
const paved = (g: Grid, p: Pt) => [-0.15, 0.15].some((e) => pavedAt(g, { x: p.x + e, y: p.y + e }) || pavedAt(g, { x: p.x + e, y: p.y - e }));
const pavedAt = (g: Grid, p: Pt) => { const x = Math.round(p.x), y = Math.round(p.y); return x >= 0 && y >= 0 && x < g.w && y < g.h && g.paved[idx(g, x, y)] !== 0; };
/** How far a point is from a line, and the line's heading where it is nearest. */
function near(P: readonly Pt[], p: Pt): { d: number; h: Pt } {
  let best = { d: Infinity, h: { x: 1, y: 0 } };
  for (let k = 0; k + 1 < P.length; k++) {
    const a = P[k], b = P[k + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    if (d < best.d) best = { d, h: { x: dx / Math.sqrt(l2), y: dy / Math.sqrt(l2) } };
  }
  return best;
}
const mid = (P: readonly Pt[]) => { const at = lengths(P); return pointAt(P, at, at[at.length - 1] / 2).p; };

/** The rules, on one map. What breaks them, in words; empty when none do. */
function broken(g: Grid): string[] {
  const G = buildLaneGraph(g), shapes = shapesOf(g, G), bad: string[] = [];
  const say = (what: string, p: Pt) => { if (bad.length < 6) bad.push(`${what} at ${p.x.toFixed(2)},${p.y.toFixed(2)}`); };
  const driven = G.lanes.filter((l) => l.pts.length > 1);
  for (const s of shapes) {
    // NOTHING IS PAINTED OFF THE ROAD.
    for (const p of s.pts) if (s.kind !== "R" || p === s.pts[0]) if (!paved(g, p) && s.kind !== "H") say(`${s.kind} off the road`, p);
    if (s.kind === "L") {
      const [, w] = s.arg.split(",").map(Number), m = mid(s.pts);
      // A LINE RUNS BETWEEN LANES, never down one: clear of every lane's path by a wheel's width.
      const d = Math.min(...driven.filter((l) => l.kind === "street").map((l) => near(l.pts, m).d));
      if ((w === LINE || w === EDGE) && d < 0.07) say("a line down a lane", m);
    }
    if (s.kind === "M") {
      // THE CENTRAL RESERVATION PARTS TRAFFIC GOING OPPOSITE WAYS: the nearest lane each side of it runs the other way.
      const m = mid(s.pts), by = driven.filter((l) => l.kind !== "ring").map((l) => near(l.pts, m)).filter((q) => q.d < 0.6).sort((a, b) => a.d - b.d);
      if (by.length >= 2 && !by.slice(1, 4).some((q) => q.h.x * by[0].h.x + q.h.y * by[0].h.y < -0.5)) say("a reservation between lanes going the same way", m);
      if (by.length && by[0].d < 0.1) say("a reservation in a lane", m);
    }
    if (s.kind === "R") {
      // A ROUNDEL IS SET TO THE WAY ITS LANE IS DRIVEN: read by the driver coming to it, whichever side they keep to.
      const at = s.pts[0], hx = s.pts[1].x, hy = s.pts[1].y;
      const lane = driven.filter((l) => l.kind === "street").map((l) => near(l.pts, at)).sort((a, b) => a.d - b.d)[0];
      if (!lane || lane.d > 0.02) say("a roundel off its lane", at);
      else if (lane.h.x * hx + lane.h.y * hy < 0.99) say("a roundel not facing its traffic", at);
    }
  }
  // EVERY LANE OF A WIDE STREET HAS SOMETHING EITHER SIDE OF IT: a line, the reservation, or the kerb's strip.
  const lineish = shapes.filter((s) => s.kind === "L" || s.kind === "M");
  for (const st of G.streets) {
    if (st.width < 2 || st.a1 - st.a0 < 4) continue;
    const n = lanesFor(st.width), lw = laneSpan(st.width) / n;
    for (const id of st.lanes) {
      const l = G.lanes[id];
      if (l.slot === n - 1 && st.width < 3) continue;
      const { p, h } = pointAt(l.pts, l.at, l.len / 2);
      for (const sg of l.slot === n - 1 ? [1, -1] : [1, -1]) {
        const q = { x: p.x - h.y * sg * lw * 0.5, y: p.y + h.x * sg * lw * 0.5 };
        // (The kerb lane of a two-cell road has its bays beyond it, not a line.)
        if (!lineish.some((s) => near(s.pts, q).d < lw * 0.3 + 0.6)) say("a lane with no line beside it", q);
      }
    }
  }
  return bad;
}

const town = (w: number, h: number, pave: (p: (x: number, y: number) => void) => void) => {
  const g = createGrid(w, h); fillTerrain(g, 1);
  pave((x, y) => { if (x >= 0 && y >= 0 && x < w && y < h) g.paved[idx(g, x, y)] = 1; });
  return g;
};
const rows = (p: (x: number, y: number) => void, y0: number, k: number, x0: number, x1: number) => { for (let x = x0; x <= x1; x++) for (let j = 0; j < k; j++) p(x, y0 + j); };
const cols = (p: (x: number, y: number) => void, x0: number, k: number, y0: number, y1: number) => { for (let y = y0; y <= y1; y++) for (let j = 0; j < k; j++) p(x0 + j, y); };

describe("a wide road's markings, from its lanes", () => {
  test("the rules hold on every layout a town has: straights, crossings, T's, bends, jogs, widenings, roads side by side", () => {
    const failed: string[] = [];
    const run = (name: string, g: Grid) => { const b = broken(g); if (b.length) failed.push(`${name}: ${b.join("; ")}`); };
    for (const k of [2, 3, 4]) {
      run(`${k} wide`, town(40, 24, (p) => rows(p, 10, k, 0, 39)));
      run(`${k} wide, dead ends`, town(40, 24, (p) => rows(p, 10, k, 5, 34)));
      for (const j of [1, 2, 3, 4]) {
        run(`${k} wide crossing ${j} wide`, town(40, 40, (p) => { rows(p, 18, k, 0, 39); cols(p, 18, j, 0, 39); }));
        run(`${j} wide ending at ${k} wide`, town(40, 40, (p) => { rows(p, 18, k, 0, 39); cols(p, 18, j, 18 + k, 39); }));
        run(`${k} wide meeting ${j} wide end on`, town(40, 24, (p) => { rows(p, 10, k, 0, 19); rows(p, 10, j, 20, 39); }));
        run(`${k} wide with a ${j} wide road laid beside it`, town(48, 30, (p) => { rows(p, 10, k, 0, 47); rows(p, 10 + k, j, 14, 47); }));
      }
      run(`${k} wide round a bend`, town(40, 40, (p) => { rows(p, 10, k, 0, 30); cols(p, 31 - k, k, 10, 39); }));
      run(`${k} wide with a jog`, town(40, 24, (p) => { rows(p, 10, k, 0, 20); rows(p, 11, k, 20, 39); }));
      run(`${k} wide, two jogs and a bend`, town(48, 48, (p) => { rows(p, 10, k, 0, 14); rows(p, 11, k, 14, 32); cols(p, 33 - k, k, 11, 30); cols(p, 34 - k, k, 30, 47); }));
      run(`${k} wide, side roads both sides and close together`, town(48, 40, (p) => { rows(p, 18, k, 0, 47); cols(p, 10, 1, 0, 17); cols(p, 13, 1, 18 + k, 39); cols(p, 30, 2, 0, 39); cols(p, 35, 1, 0, 17); }));
    }
    expect(failed).toEqual([]);
  });

  test("and on roads laid at random: any widths, anywhere, over each other", () => {
    const failed: string[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      let s = seed * 2654435761 >>> 0;
      const rnd = (n: number) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % n; };
      const strokes: string[] = [];
      const g = town(40, 40, (p) => {
        for (let q = 0, n = 4 + rnd(7); q < n; q++) {
          const k = 1 + rnd(4), a = 2 + rnd(34), b0 = rnd(30), b1 = b0 + 6 + rnd(30), across = rnd(2) === 0;
          strokes.push(`${across ? "rows" : "cols"} ${a}+${k} ${b0}-${b1}`);
          if (across) rows(p, a, k, b0, Math.min(39, b1)); else cols(p, a, k, b0, Math.min(39, b1));
        }
      });
      let b: string[];
      try { b = broken(g); } catch (e) { b = [`threw ${e}`]; }
      if (b.length) failed.push(`seed ${seed} [${strokes.join(", ")}]: ${b.slice(0, 2).join("; ")}`);
    }
    expect(failed).toEqual([]);
  }, 120_000);

  test("a straight road's cells are painted alike, row by row: one texture each, however long it is", () => {
    for (const k of [2, 3, 4]) {
      const g = town(60, 24, (p) => rows(p, 10, k, 0, 59));
      for (let j = 0; j < k; j++) {
        const kinds = new Set<string>();
        for (let x = 6; x < 54; x++) kinds.add(lookAt(g, x, 10 + j)!.mk);
        expect(kinds.size).toBe(1);
      }
    }
  });

  test("an arrow is a turn its lane's traffic can take, and at the head of a T none is straight on", () => {
    // Three cells wide, ending at a two-cell road: left and right, and nothing ahead.
    const g = town(40, 40, (p) => { rows(p, 18, 3, 0, 29); cols(p, 30, 2, 0, 39); });
    const G = buildLaneGraph(g), st = G.streets.find((q) => q.width === 3)!;
    const incoming = st.lanes.map((id) => G.lanes[id]).filter((l) => l.pts[l.pts.length - 1].x > 20);
    expect(incoming.length).toBe(3);
    const turns = incoming.flatMap((l) => [...new Set(l.next.map((c) => G.lanes[c].turn))]);
    expect(turns.includes("straight")).toBe(false);
    // Each arrow's head is a three-cornered shape: as many of them as there are turns to take.
    const heads = shapesOf(g, G).filter((s) => s.kind === "P" && s.pts.length === 3 && s.pts[0].x > 26 && s.pts[0].x < 29.5);
    const distinct = new Set(heads.map((s) => s.pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")));
    expect(distinct.size).toBe(turns.length);
  });

  test("where lanes wait there is a line across each of them: a stop line at lights, give way from the minor road, none on the main road", () => {
    // Lights: a three-cell road crossed by a one-cell street.
    const lit = town(40, 40, (p) => { rows(p, 18, 3, 0, 39); cols(p, 19, 1, 0, 39); });
    const G = buildLaneGraph(lit), J = G.junctions[0];
    expect(J.kind).toBe("signals");
    const bars = shapesOf(lit, G).filter((s) => s.kind === "P" && s.pts.length === 4);
    for (const arm of J.arms.filter((a) => a.width === 3)) for (const id of arm.inLanes) {
      const l = G.lanes[id], end = l.pts[l.pts.length - 1];
      expect(bars.some((s) => near(s.pts, end).d < 1.2 && near(l.pts, mid(s.pts)).d < 0.2)).toBe(true);
    }
    // A T with the main road running through: nothing across the main road's lanes.
    const tee = town(40, 40, (p) => { rows(p, 18, 3, 0, 39); cols(p, 19, 1, 21, 39); });
    const G2 = buildLaneGraph(tee), J2 = G2.junctions[0];
    expect(J2.kind).toBe("priority");
    const bars2 = shapesOf(tee, G2).filter((s) => s.kind === "P" && s.pts.length === 4 && s.pts.every((p) => p.y < 20.6));
    for (const id of J2.arms.filter((a) => a.major).flatMap((a) => a.inLanes)) {
      const l = G2.lanes[id], end = l.pts[l.pts.length - 1];
      expect(bars2.some((s) => near(s.pts, end).d < 0.4)).toBe(false);
    }
  });

  test("two roads laid side by side are one broad road, not a square: lanes down it, and no island in the middle of nothing", () => {
    const g = town(48, 30, (p) => { rows(p, 10, 3, 0, 47); rows(p, 13, 2, 0, 47); });
    const G = buildLaneGraph(g);
    expect(G.junctions.length).toBe(0);
    expect(G.streets.length).toBe(1);
    expect(G.streets[0].width).toBe(5);
    expect(G.streets[0].lanes.length).toBe(8);
  });
});

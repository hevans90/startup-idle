/**
 * EVERY WAY A ROAD IS LAID, with the tool itself, and what must be true after
 * each: every stroke taken (none refused), one network, no cell a ramp cannot
 * serve, no two road cells side by side and not joined, every traffic lane on
 * the road and leading somewhere, and the markings worked out without a
 * throw. On the flat and on three kinds of hill; roads one to four cells
 * wide, laid lane by lane in every order; bends, junctions, widenings.
 */
import { describe, expect, test } from "bun:test";

import { useWorldStore } from "../../state/world.store";
import { idx, setHeight, type Grid } from "../grid";
import { buildLaneGraph } from "../agents/lanes/graph";
import { isPaved, connects } from "./mask";
import { rampNeed } from "./ramp-derive";
import { looksOf } from "./looks";

const s = () => useWorldStore.getState();
type Stroke = [number, number, number, number];
const hills = (g: Grid) => { const at = (x: number) => x < 8 ? 0 : x < 14 ? 1 : x < 20 ? 3 : x < 26 ? 9 : x === 29 ? 3 : x < 34 ? 9 : x < 37 ? 4 : x < 41 ? 9 : x === 43 ? 12 : 6; for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, at(x)); };
const slope = (g: Grid) => { for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, Math.max(0, Math.min(12, x - 10))); };
const diag = (g: Grid) => { for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, Math.max(0, Math.min(14, Math.floor((x + y) / 3) - 6))); };

function run(name: string, terrain: ((g: Grid) => void) | null, strokes: Stroke[], allowRefused = 0) {
  s().resize(48, 48);
  const g = s().grid;
  terrain?.(g);
  const said: string[] = [];
  for (const [x0, y0, x1, y1] of strokes) {
    s().setTool("paintRoad"); s().setBrush("line");
    useWorldStore.setState({ notice: null });
    s().beginStroke({ x: x0, y: y0 }); s().updateStroke({ x: x1, y: y1 }); s().endStroke();
    const t = s().notice?.text; if (t) said.push(`${x0},${y0}>${x1},${y1}: ${t}`);
  }
  const problems: string[] = [];
  if (said.length > allowRefused) problems.push(`refused ${said.length}: ${said[0]}`);
  if (s().netComponents !== 1) problems.push(`components ${s().netComponents}`);
  const read = { inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h, paved: (x: number, y: number) => isPaved(g, x, y), height: (x: number, y: number) => g.deck[idx(g, x, y)] ? g.deckZ[idx(g, x, y)] : g.height[idx(g, x, y)] };
  let unbridged = 0, steps = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (!isPaved(g, x, y)) continue;
    if (rampNeed(read, x, y).kind === "unbridgeable") unbridged++;
    for (const d of ["S", "W"] as const) { const [nx, ny] = d === "S" ? [x + 1, y] : [x, y + 1]; if (isPaved(g, nx, ny) && !connects(g, x, y, d)) steps++; }
  }
  if (unbridged) problems.push(`unbridgeable cells ${unbridged}`);
  if (steps) problems.push(`paved neighbours not joined ${steps}`);
  const G = buildLaneGraph(g);
  const c = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.round(v)));
  const off = G.lanes.filter((l) => l.pts.some((p) => !isPaved(g, c(p.x, g.w), c(p.y, g.h)))).length;
  if (off) problems.push(`lanes off road ${off}`);
  const dead = G.lanes.filter((l) => !l.sink && !l.next.length).length;
  if (dead) problems.push(`lanes leading nowhere ${dead}`);
  if (G.loose) problems.push(`loose cells ${G.loose}`);
  if (G.junctions.some((J) => !J.arms.length)) problems.push("junction with no arms");
  try { looksOf(g); } catch (e) { problems.push(`looks threw ${e}`); }
  if (problems.length) FAILED.push(`${name} — ${problems.join("; ")}`);
}
const FAILED: string[] = [];
/** The cases laid since the last asking, that came out wrong. */
const failed = () => FAILED.splice(0);
const lanes = (k: number, f: (c: number) => Stroke) => Array.from({ length: k }, (_, c) => f(c));

describe("laying roads", () => {
  test("on the flat: one road, bends, junctions, loops, and roads two to four cells wide laid lane by lane", () => {
    run("straight", null, [[5, 20, 30, 20]]);
    run("elbow in one stroke", null, [[5, 20, 30, 34]]);
    run("elbow, the other leg first", null, [[5, 20, 12, 40]]);
    run("T: a stroke ending on a road", null, [[5, 20, 30, 20], [15, 35, 15, 20]]);
    run("T: a stroke begun on a road", null, [[5, 20, 30, 20], [15, 20, 15, 35]]);
    run("T: begun beside a road", null, [[5, 20, 30, 20], [15, 21, 15, 35]]);
    run("cross", null, [[5, 20, 30, 20], [15, 8, 15, 35]]);
    run("extended from its end", null, [[5, 20, 20, 20], [20, 20, 35, 20], [36, 20, 44, 20]]);
    run("relaid over itself", null, [[5, 20, 30, 20], [10, 20, 25, 20]]);
    run("one cell", null, [[5, 20, 5, 20], [6, 20, 12, 20]]);
    run("loop", null, [[10, 10, 30, 10], [30, 10, 30, 30], [30, 30, 10, 30], [10, 30, 10, 10]]);
    run("staircase", null, [[5, 5, 10, 5], [10, 5, 10, 10], [10, 10, 15, 10], [15, 10, 15, 15], [15, 15, 20, 15]]);
    run("grid of blocks", null, [...[8, 14, 20, 26].map((y): Stroke => [4, y, 40, y]), ...[6, 14, 22, 30, 38].map((x): Stroke => [x, 8, x, 26])]);
    for (const k of [2, 3, 4]) {
      run(`${k} wide`, null, lanes(k, (c) => [5, 20 + c, 40, 20 + c]));
      run(`${k} wide, lanes laid opposite ways`, null, lanes(k, (c) => (c % 2 ? [40, 20 + c, 5, 20 + c] : [5, 20 + c, 40, 20 + c])));
      run(`${k} wide, outer lanes first`, null, lanes(k, (c) => [5, 20 + (c * 7) % k, 40, 20 + (c * 7) % k]));
      run(`${k} wide with a bend, each lane an elbow`, null, lanes(k, (c) => [5, 20 + c, 30 - c, 40]));
      run(`${k} wide with a bend, legs laid apart`, null, [...lanes(k, (c): Stroke => [5, 20 + c, 30, 20 + c]), ...lanes(k, (c): Stroke => [30 - c, 20 + k, 30 - c, 40])]);
      run(`${k} wide, side road off`, null, [...lanes(k, (c): Stroke => [5, 20 + c, 40, 20 + c]), [20, 20 + k, 20, 36]]);
      run(`${k} wide, side road onto its far side`, null, [...lanes(k, (c): Stroke => [5, 20 + c, 40, 20 + c]), [20, 5, 20, 19]]);
      run(`${k} wide, road across`, null, [...lanes(k, (c): Stroke => [5, 20 + c, 40, 20 + c]), [20, 5, 20, 36]]);
      run(`${k} wide, a ${k} wide road off`, null, [...lanes(k, (c): Stroke => [5, 20 + c, 40, 20 + c]), ...lanes(k, (c): Stroke => [20 + c, 20 + k, 20 + c, 38])]);
      run(`${k} wide crossing ${k} wide`, null, [...lanes(k, (c): Stroke => [5, 20 + c, 40, 20 + c]), ...lanes(k, (c): Stroke => [20 + c, 5, 20 + c, 38])]);
      run(`one wide, then widened to ${k}, a side road already on it`, null, [[5, 20, 40, 20], [20, 20, 20, 5], ...lanes(k - 1, (c): Stroke => [5, 21 + c, 40, 21 + c])]);
      run(`${k} wide, short of full length on one lane`, null, [...lanes(k - 1, (c): Stroke => [5, 20 + c, 40, 20 + c]), [12, 20 + k - 1, 30, 20 + k - 1]]);
      run(`${k} wide narrowing to one`, null, [...lanes(k, (c): Stroke => [5, 20 + c, 22, 20 + c]), [22, 20, 40, 20]]);
    }
    expect(failed()).toEqual([]);
  });

  test("on hills: up, down, along and round corners; wide roads; side roads and crossings at every tile of a climb", () => {
    for (const [tn, t] of [["terraces", hills], ["even slope", slope], ["slope across both ways", diag]] as const) {
      run(`${tn}: straight up`, t, [[2, 20, 46, 20]]);
      run(`${tn}: straight down`, t, [[46, 20, 2, 20]]);
      run(`${tn}: along the hill`, t, [[22, 4, 22, 44]]);
      run(`${tn}: along the foot of a cliff`, t, [[19, 4, 19, 44]]);
      run(`${tn}: along the top of a cliff`, t, [[20, 4, 20, 44]]);
      run(`${tn}: elbow up and along`, t, [[4, 10, 30, 36]]);
      run(`${tn}: elbow along and up`, t, [[4, 36, 30, 10]]);
      run(`${tn}: laid in pieces`, t, [[2, 20, 12, 20], [12, 20, 22, 20], [22, 20, 32, 20], [32, 20, 46, 20]]);
      run(`${tn}: laid in pieces from the top`, t, [[46, 20, 36, 20], [36, 20, 24, 20], [24, 20, 2, 20]]);
      for (const k of [2, 3, 4]) {
        run(`${tn}: ${k} wide up`, t, lanes(k, (c) => [2, 20 + c, 46, 20 + c]));
        run(`${tn}: ${k} wide, lanes opposite ways`, t, lanes(k, (c) => (c % 2 ? [46, 20 + c, 2, 20 + c] : [2, 20 + c, 46, 20 + c])));
        run(`${tn}: ${k} wide, a road across it on the climb`, t, [...lanes(k, (c): Stroke => [2, 20 + c, 46, 20 + c]), [17, 6, 17, 40]]);
        run(`${tn}: ${k} wide with a bend`, t, lanes(k, (c) => [2, 20 + c, 34 - c, 44]));
      }
      for (let x = 6; x <= 44; x += 1) run(`${tn}: side road onto the climb at x=${x}`, t, [[2, 20, 46, 20], [x, 34, x, 20]]);
      for (let x = 6; x <= 44; x += 3) run(`${tn}: road across the climb at x=${x}`, t, [[2, 20, 46, 20], [x, 8, x, 34]]);
      for (let x = 6; x <= 44; x += 3) run(`${tn}: side road onto a 3 wide climb at x=${x}`, t, [...lanes(3, (c): Stroke => [2, 20 + c, 46, 20 + c]), [x, 36, x, 22]]);
    }
    expect(failed()).toEqual([]);
  });
});

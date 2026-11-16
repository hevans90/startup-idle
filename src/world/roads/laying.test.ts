/**
 * EVERY WAY A ROAD IS LAID, with the tool itself, and what must be true after
 * each: every stroke taken (none refused), one network, no cell a ramp cannot
 * serve, no two road cells side by side and not joined, every traffic lane on
 * the road and leading somewhere, and the markings worked out without a
 * throw. On the flat and on three kinds of hill; roads one to four cells
 * wide, laid lane by lane in every order; bends, junctions, widenings.
 */
import { describe, expect, test } from "bun:test";

import { generateMap } from "../gen/generate-map";
import { placeStructure } from "../play/build-actions";
import { IN_THE_WAY, ON_A_SLOPE, OPEN_WATER } from "./grade";

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
      // A WIDE BEND with its corner at every tile of the climb, its legs laid apart, lane by lane: the road and then
      // the leg off its end, and the leg first. Each lane of the leg meets the road's end where the one before did.
      for (const k of [2, 3, 4]) for (let x = 12; x <= 44; x += 1) {
        const road = lanes(k, (c): Stroke => [x - 10, 4 + c, x, 4 + c]), leg = lanes(k, (c): Stroke => [x - k + 1 + c, 4 + k, x - k + 1 + c, 16]);
        run(`${tn}: ${k} wide bend, corner at x=${x}, the leg after`, t, [...road, ...leg]);
        run(`${tn}: ${k} wide bend, corner at x=${x}, the leg first`, t, [...lanes(k, (c): Stroke => [x - k + 1 + c, 4, x - k + 1 + c, 16]), ...lanes(k, (c): Stroke => [x - 10, 4 + c, x - k, 4 + c])]);
      }
      for (let x = 6; x <= 44; x += 1) run(`${tn}: side road onto the climb at x=${x}`, t, [[2, 20, 46, 20], [x, 34, x, 20]]);
      for (let x = 6; x <= 44; x += 3) run(`${tn}: road across the climb at x=${x}`, t, [[2, 20, 46, 20], [x, 8, x, 34]]);
      for (let x = 6; x <= 44; x += 3) run(`${tn}: side road onto a 3 wide climb at x=${x}`, t, [...lanes(3, (c): Stroke => [2, 20 + c, 46, 20 + c]), [x, 36, x, 22]]);
    }
    expect(failed()).toEqual([]);
    // (Some twelve hundred layings: longer than a test's five seconds when the whole suite runs at once.)
  }, 60_000);

  /** One stroke of any line tool, and what it said. */
  const drag = (tool: "paintRoad" | "eraseRoad" | "pipe" | "sewer", x0: number, y0: number, x1: number, y1: number) => {
    s().setTool(tool); s().setBrush("line");
    useWorldStore.setState({ notice: null });
    s().beginStroke({ x: x0, y: y0 }); s().updateStroke({ x: x1, y: y1 }); s().endStroke();
    return s().notice?.text ?? "";
  };
  const fresh = (terrain: ((g: Grid) => void) | null = slope) => { s().resize(48, 48); terrain?.(s().grid); return s().grid; };
  /** What must hold of the roads on the map, however they came to be: the same as after laying. */
  const sound = (g: Grid, components = 1): string[] => {
    const problems: string[] = [];
    if (s().netComponents !== components) problems.push(`components ${s().netComponents}`);
    const read = { inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h, paved: (x: number, y: number) => isPaved(g, x, y), height: (x: number, y: number) => (g.deck[idx(g, x, y)] ? g.deckZ[idx(g, x, y)] : g.height[idx(g, x, y)]) };
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (isPaved(g, x, y) && rampNeed(read, x, y).kind === "unbridgeable") problems.push(`unbridgeable ${x},${y}`);
    const G = buildLaneGraph(g), c = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.round(v)));
    if (G.lanes.some((l) => l.pts.some((p) => !isPaved(g, c(p.x, g.w), c(p.y, g.h))))) problems.push("lanes off road");
    return problems;
  };

  test("a building in the way stops the road, and one beside it keeps its ground, on every kind of hill", () => {
    for (const [name, terrain] of [["terraces", hills], ["even slope", slope], ["slope across both ways", diag]] as const) {
      // Along the hill and up it: a building on the road's line, and others just off it either side.
      for (const along of [false, true]) {
        const g = fresh(terrain);
        const at = (a: number, b: number) => (along ? { x: 21 + b, y: a } : { x: a, y: 21 + b });
        const road = (b: number) => { const p = at(8, b), q = at(40, b); return drag("paintRoad", p.x, p.y, q.x, q.y); };
        const homes = [at(18, 0), at(15, -1), at(24, 1), at(30, -1), at(34, 1)];
        for (const h of homes) expect({ name, along, placed: placeStructure("kit:intern.t0", h) }).toEqual({ name, along, placed: true });
        const ground = homes.map((h) => g.height[idx(g, h.x, h.y)]);
        // Through the first: nothing laid, and it says why.
        expect(road(0)).toBe(IN_THE_WAY);
        expect(g.paved.some((v) => v !== 0)).toBe(false);
        // Past them all, two rows either side: laid — or refused and said so, never in pieces — and no building's ground has moved.
        const said = [road(-2), road(2)];
        expect(homes.map((h) => g.height[idx(g, h.x, h.y)])).toEqual(ground);
        const laid = said.filter((t) => t === "").length;
        expect({ name, along, problems: laid ? sound(g, laid) : [], said: said.every((t) => t === "" || /^Too steep/.test(t)) }).toEqual({ name, along, problems: [], said: true });
        // And a road ending at a building's door: it stops beside it.
        expect(drag("paintRoad", at(18, 0).x + (along ? 6 : 0), at(18, 0).y + (along ? 0 : 6), at(18, 0).x + (along ? 1 : 0), at(18, 0).y + (along ? 0 : 1))).not.toBe(IN_THE_WAY);
        expect(homes.map((h) => g.height[idx(g, h.x, h.y)])).toEqual(ground);
      }
    }
  });

  test("over a main or a sewer the road goes, and the ground they lie in is left alone", () => {
    for (const pipe of ["pipe", "sewer"] as const) {
      // Laid along it, then joined from the side at every tile of the climb: the ground over the pipe never moves.
      for (let at = 12; at <= 24; at += 2) {
        const g = fresh();
        expect(drag(pipe, 8, 20, 26, 20)).toBe("");
        const over = Array.from({ length: 19 }, (_, k) => g.height[idx(g, 8 + k, 20)]);
        expect(drag("paintRoad", 8, 20, 26, 20)).toBe("");
        const said = drag("paintRoad", at, 30, at, 20);
        expect(Array.from({ length: 19 }, (_, k) => g.height[idx(g, 8 + k, 20)])).toEqual(over);
        // Joined, or refused and said so: never laid in pieces.
        expect({ pipe, at, problems: sound(g, 1), said: said === "" || said === ON_A_SLOPE }).toEqual({ pipe, at, problems: [], said: true });
      }
      // And across one.
      const g = fresh();
      expect(drag(pipe, 16, 8, 16, 30)).toBe("");
      expect(drag("paintRoad", 8, 20, 26, 20)).toBe("");
      expect(sound(g)).toEqual([]);
    }
  });

  test("taken up and put back: what is left is sound, the gap relaid is one road again, and undo puts everything back", () => {
    for (const [name, terrain] of [["terraces", hills], ["even slope", slope], ["slope across both ways", diag]] as const) {
      for (const [a, b] of [[10, 14], [16, 22], [20, 21], [2, 8], [30, 46]]) {
        const g = fresh(terrain);
        const before = Array.from(g.height);
        expect(drag("paintRoad", 2, 20, 46, 20)).toBe("");
        const laid = Array.from(g.height);
        // A stretch taken up: two roads, each sound; the ground stays as the road left it.
        drag("eraseRoad", a, 20, b, 20);
        const pieces = (a > 2 ? 1 : 0) + (b < 46 ? 1 : 0);
        expect({ name, a, b, problems: sound(g, pieces) }).toEqual({ name, a, b, problems: [] });
        expect(Array.from(g.height)).toEqual(laid);
        // Put back: one road.
        expect(drag("paintRoad", a, 20, b, 20)).toBe("");
        expect({ name, a, b, problems: sound(g) }).toEqual({ name, a, b, problems: [] });
        // And every step undone: the hill as it was.
        s().doUndo(); s().doUndo(); s().doUndo();
        expect(Array.from(g.height)).toEqual(before);
        expect(g.paved.some((v) => v !== 0)).toBe(false);
        s().doRedo();
        expect(Array.from(g.height)).toEqual(laid);
      }
    }
    // One lane of a wide road taken up, on a hill: the rest is a road still.
    const g = fresh(hills);
    for (const c of [0, 1, 2]) expect(drag("paintRoad", 2, 20 + c, 46, 20 + c)).toBe("");
    drag("eraseRoad", 2, 22, 46, 22);
    expect(sound(g)).toEqual([]);
    drag("eraseRoad", 2, 20, 46, 20);
    expect(sound(g)).toEqual([]);
  });

  test("over water a road is a bridge: a deck from bank to bank, level, clear of the water; a lane laid beside it at its level; undone and lifted whole; never begun or ended or turned in the water", () => {
    s().resize(48, 48);
    const g = s().grid;
    // A river down x = 20…24: its bed four half steps down, three of water in it.
    for (let y = 0; y < g.h; y++) for (let x = 20; x <= 24; x++) { setHeight(g, x, y, -4); g.pool[idx(g, x, y)] = 3; }
    s().loadGrid(g);
    const G = s().grid, wet = [20, 21, 22, 23, 24];
    expect(drag("paintRoad", 12, 10, 32, 10)).toBe("");
    for (let x = 12; x <= 32; x++) expect(G.paved[idx(G, x, 10)]).not.toBe(0);
    // Its deck: over the water's cells and no others, one level, at least two half steps over the water; the bed untouched.
    for (let x = 12; x <= 32; x++) expect(G.deck[idx(G, x, 10)]).toBe(wet.includes(x) ? 1 : 0);
    const z = G.deckZ[idx(G, 20, 10)];
    for (const x of wet) { expect(G.deckZ[idx(G, x, 10)]).toBe(z); expect(G.height[idx(G, x, 10)]).toBe(-4); }
    expect(z).toBeGreaterThanOrEqual(-4 + 3 + 2);
    expect(sound(G)).toEqual([]);
    // A second lane beside it runs at the same level, and the two are one bridge.
    expect(drag("paintRoad", 12, 11, 32, 11)).toBe("");
    for (const x of wet) expect(G.deckZ[idx(G, x, 11)]).toBe(z);
    expect(sound(G)).toEqual([]);
    // Undone, the second lane and its deck are gone; lifted, the first and its.
    s().doUndo();
    for (let x = 12; x <= 32; x++) { expect(G.paved[idx(G, x, 11)]).toBe(0); expect(G.deck[idx(G, x, 11)]).toBe(0); }
    for (const x of wet) expect(G.deck[idx(G, x, 10)]).toBe(1);
    drag("eraseRoad", 12, 10, 32, 10);
    for (let i = 0; i < G.deck.length; i++) { expect(G.deck[i]).toBe(0); expect(G.deckZ[i]).toBe(0); expect(G.paved[i]).toBe(0); }
    // Not begun in the water, nor ended in it, nor turned in it: nothing laid, and it says why.
    expect(drag("paintRoad", 22, 30, 32, 30)).toBe(OPEN_WATER);
    expect(drag("paintRoad", 12, 30, 22, 30)).toBe(OPEN_WATER);
    for (let i = 0; i < G.paved.length; i++) expect(G.paved[i]).toBe(0);
    // Down the river and not across it: it never comes to a bank.
    expect(drag("paintRoad", 22, 5, 22, 40)).toBe(OPEN_WATER);
  });

  test("two lanes over a river that runs aslant, one bank a step lower: the lanes stay joined cell for cell — no ramp beside a deck — whichever is laid first", () => {
    for (const order of [[10, 11], [11, 10]]) for (const low of ["right", "left"]) {
      s().resize(48, 48);
      const g = s().grid;
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        const x0 = y <= 10 ? 20 : 21;
        if (x >= x0 && x <= x0 + 4) { setHeight(g, x, y, -4); g.pool[idx(g, x, y)] = 3; } else setHeight(g, x, y, (x < x0) === (low === "left") ? 0 : 1);
      }
      s().loadGrid(g);
      const G = s().grid;
      for (const y of order) expect(drag("paintRoad", 12, y, 32, y)).toBe("");
      expect(sound(G)).toEqual([]);
      for (let x = 12; x <= 32; x++) {
        expect({ order, low, x, joined: connects(G, x, 10, "W") }).toEqual({ order, low, x, joined: true });
        // A ramp has a ramp beside it across the road, climbing the same way.
        expect({ order, low, x, ramp: G.ramp[idx(G, x, 10)] }).toEqual({ order, low, x, ramp: G.ramp[idx(G, x, 11)] });
      }
    }
  });

  test("a bridge and a junction or a bend at its end, one bank lower: laid in either order the junction is level, never a ramp, and every road joined", () => {
    const river = (left: number, right: number) => {
      s().resize(48, 48);
      const g = s().grid;
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) { if (x >= 20 && x <= 24) { setHeight(g, x, y, -4); g.pool[idx(g, x, y)] = 3; } else setHeight(g, x, y, x < 20 ? left : right); }
      s().loadGrid(g);
      return s().grid;
    };
    const bridge: Stroke = [12, 10, 25, 10];
    const others: [string, Stroke][] = [["a road across its end", [25, 4, 25, 16]], ["a bend at its end", [25, 10, 25, 16]], ["a road on from its end, and one off that", [25, 10, 32, 10]]];
    for (const [left, right] of [[1, 0], [0, 1], [0, 0], [2, 0]]) for (const [name, other] of others) for (const first of ["bridge", "other"]) {
      const G = river(left, right), said: string[] = [];
      for (const st of first === "bridge" ? [bridge, other] : [other, bridge]) said.push(drag("paintRoad", ...st));
      const at = { left, right, name, first };
      // Laid, or refused whole and saying why: never half a road.
      if (said.some((t) => t !== "")) { expect({ ...at, said: said.filter(Boolean).every((t) => t === ON_A_SLOPE || /Too steep/.test(t)) }).toEqual({ ...at, said: true }); continue; }
      expect({ ...at, problems: sound(G) }).toEqual({ ...at, problems: [] });
      // No cell where roads meet from three ways, or turn, is a ramp.
      for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
        if (!isPaved(G, x, y) || !G.ramp[idx(G, x, y)]) continue;
        const ways = (["N", "E", "S", "W"] as const).filter((d) => connects(G, x, y, d));
        expect({ ...at, x, y, ways: ways.join("") }).toEqual({ ...at, x, y, ways: ways.length === 2 && (ways.join("") === "NS" || ways.join("") === "EW") ? ways.join("") : "straight" });
      }
      // And the bridge is there, joined to the road at each end of it.
      for (let x = 20; x <= 24; x++) expect(G.deck[idx(G, x, 10)]).toBe(1);
      expect({ ...at, a: connects(G, 19, 10, "S"), b: connects(G, 24, 10, "S") }).toEqual({ ...at, a: true, b: true });
    }
  });

  test("bridges on any ground: banks that climb, fall and step at random, roads already on them or not, one lane or two — a bridge is laid whole and sound, or refused whole", () => {
    let seed = Number(process.env.BRIDGE_SEED ?? 12345);
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const pick = (n: number) => Math.floor(rnd() * n);
    let laid = 0;
    for (let run = 0; run < 400; run++) {
      // Across the map one way, or the other.
      const swap = run % 2 === 1, at2 = (x: number, y: number): [number, number] => (swap ? [y, x] : [x, y]);
      const I = (q: Grid, x: number, y: number) => idx(q, ...at2(x, y)), lay = (st: Stroke) => drag("paintRoad", ...at2(st[0], st[1]), ...at2(st[2], st[3]));
      const along = swap ? "W" : "S", across = swap ? "S" : "W";
      s().resize(48, 48);
      const g = s().grid, x0 = 18 + pick(4), wide = 2 + pick(6), bed = -3 - pick(4), water = 1 + pick(3);
      // Each bank its own profile: a level, and a slope of 0, ±1 a tile or ±1 every other tile, from the water out.
      const prof = () => { const base = pick(6), slope = [0, 0, 1, -1, 0.5, -0.5][pick(6)]; return (d: number) => Math.max(bed + water + 1, Math.round(base + slope * d)); };
      const L = prof(), R = prof(), shore = pick(3);
      for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
        if (x >= x0 && x < x0 + wide) { setHeight(g, ...at2(x, y), bed); g.pool[I(g, x, y)] = water; }
        else { const d = x < x0 ? x0 - 1 - x : x - x0 - wide; setHeight(g, ...at2(x, y), d < shore && rnd() < 2 ? Math.min(bed + water + 1 + d, (x < x0 ? L : R)(d)) : (x < x0 ? L : R)(d)); }
      }
      s().loadGrid(g);
      const G = s().grid, before = pick(4), lanes = 1 + pick(2), said: string[] = [], strokes: Stroke[] = [];
      // Roads there first, some of the time: down a bank to the water's edge, or along it, on one side or both.
      if (before & 1) strokes.push([4, 10, x0 - 1 - pick(3), 10]);
      if (before & 2) strokes.push(rnd() < 0.5 ? [x0 + wide + pick(3), 10, 44, 10] : [x0 + wide + pick(2), 3, x0 + wide + pick(2), 20]);
      for (const st of strokes) lay(st);
      for (let k = 0; k < lanes; k++) said.push(lay([4 + pick(8), 10 + k, 44 - pick(8), 10 + k]));
      const at = { run, swap, x0, wide, bed, water, before, lanes };
      const problems = sound(G, s().netComponents);
      for (let k = 0; k < lanes; k++) if (G.deck[I(G, x0, 10 + k)] !== 0) for (let x = x0 - 1; x < x0 + wide; x++) if (!connects(G, ...at2(x, 10 + k), along)) problems.push(`not joined along ${x},${10 + k}`);
      if (problems.length && process.env.BRIDGE_DEBUG) for (const yy of [9, 10, 11, 12]) { let o = `${yy}: `; for (let x = 4; x < 44; x++) { const i = I(G, x, yy); o += (G.deck[i] ? "D" + G.deckZ[i] : G.paved[i] ? "P" + G.height[i] + (G.ramp[i] ? "r" : "") : "." + G.height[i] + (G.pool[i] ? "~" : "")) + " "; } console.log(o, said, strokes); }
      expect({ ...at, problems }).toEqual({ ...at, problems: [] });
      // Laid, it joined what was there into one; refused, nothing of it is there.
      for (let k = 0; k < lanes; k++) {
        const decked = G.deck[I(G, x0, 10 + k)] !== 0;
        expect({ ...at, k, decked, said: said[k] }).toEqual({ ...at, k, decked: said[k] === "", said: said[k] });
        if (decked) { laid++; for (let x = x0 - 1; x < x0 + wide; x++) expect({ ...at, x, joined: connects(G, ...at2(x, 10 + k), along) }).toEqual({ ...at, x, joined: true }); }
      }
      // Two lanes laid: joined to each other all the way.
      if (lanes === 2 && said.every((t) => t === "")) for (let x = 14; x <= 34; x++) if (isPaved(G, ...at2(x, 10)) && isPaved(G, ...at2(x, 11))) expect({ ...at, x, side: connects(G, ...at2(x, 10), across) }).toEqual({ ...at, x, side: true });
    }
    // Most of them are laid: refusing is for what cannot be built, not a way round building it.
    expect(laid).toBeGreaterThan(250);
  }, 120_000);

  test("open water: the road stops at it and says so; a bridge already there is joined", () => {
    s().resize(64, 64);
    const g = s().grid;
    generateMap(g, { seed: 7, material: 1, dirt: 2, sand: 3, woods: [4, 5, 6] });
    s().loadGrid(g);
    const G = s().grid;
    // A dry tile with standing water two tiles on, nothing paved between.
    let at: [number, number] | null = null;
    for (let y = 2; y < G.h - 2 && !at; y++) for (let x = 2; x < G.w - 6; x++) {
      const dry = (k: number) => G.pool[idx(G, x + k, y)] === 0 && G.inflow[idx(G, x + k, y)] === 0;
      if (dry(0) && dry(1) && !dry(2) && [0, 1, 2, 3].every((k) => G.paved[idx(G, x + k, y)] === 0 && G.deck[idx(G, x + k, y)] === 0)) { at = [x, y]; break; }
    }
    expect(at).not.toBeNull();
    const [x, y] = at!;
    // In the editor as in the game: nothing laid, and it says why.
    expect(drag("paintRoad", x, y, x + 3, y)).toBe(OPEN_WATER);
    expect(G.paved[idx(G, x, y)]).toBe(0);
    useWorldStore.setState({ playing: true });
    try { expect(drag("paintRoad", x, y, x + 3, y)).toBe(OPEN_WATER); } finally { useWorldStore.setState({ playing: false }); }
    // Every bridge the map came with still carries its road at its own level.
    const read = { inBounds: (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < G.w && cy < G.h, paved: (cx: number, cy: number) => isPaved(G, cx, cy), height: (cx: number, cy: number) => (G.deck[idx(G, cx, cy)] ? G.deckZ[idx(G, cx, cy)] : G.height[idx(G, cx, cy)]) };
    let decks = 0;
    for (let cy = 0; cy < G.h; cy++) for (let cx = 0; cx < G.w; cx++) if (G.deck[idx(G, cx, cy)]) { decks++; expect(rampNeed(read, cx, cy).kind).not.toBe("unbridgeable"); }
    // A road laid along a bridge and off its end onto the bank: the deck's ground is not touched.
    if (decks) {
      const under = Array.from(G.height);
      let d: [number, number] | null = null;
      for (let cy = 0; cy < G.h && !d; cy++) for (let cx = 0; cx < G.w; cx++) if (G.deck[idx(G, cx, cy)]) { d = [cx, cy]; break; }
      const [dx, dy] = d!;
      drag("paintRoad", dx, dy, Math.min(G.w - 1, dx + 6), dy);
      drag("paintRoad", dx, dy, dx, Math.min(G.h - 1, dy + 6));
      for (let i = 0; i < G.deck.length; i++) if (G.deck[i]) expect(G.height[i]).toBe(under[i]);
    }
  });
});

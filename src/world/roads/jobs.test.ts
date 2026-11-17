/**
 * ROADS ARE BUILT, NOT BOUGHT: a road dragged in the game is a job, worked
 * along its line over time and opened a length at a time — and every road it
 * opens, at every moment, is sound.
 */
import { describe, expect, test } from "bun:test";

import { useMoneyStore } from "../../state/money.store";
import { useWorldStore } from "../../state/world.store";
import { generateMap } from "../gen/generate-map";
import { idx, setHeight, type Grid } from "../grid";
import { ARRIVE, GANGS, PACE, frontOf, jobSeconds, lengthsOf, plannedGrid, stageOf } from "./jobs";
import { connects, isPaved } from "./mask";
import { rampNeed } from "./ramp-derive";

const s = () => useWorldStore.getState();
const drag = (tool: "paintRoad" | "eraseRoad" | "demolish", x0: number, y0: number, x1: number, y1: number) => {
  s().setTool(tool); s().setBrush("line");
  useWorldStore.setState({ notice: null });
  s().beginStroke({ x: x0, y: y0 }); s().updateStroke({ x: x1, y: y1 }); s().endStroke();
  return s().notice?.text ?? "";
};
/** A map in the game, roads built over time, money for anything. */
function game(w = 48, h = 48, shape?: (g: Grid) => void): Grid {
  s().resize(w, h);
  shape?.(s().grid);
  s().loadGrid(s().grid);
  useWorldStore.setState({ playing: true, roadWorks: true });
  useMoneyStore.getState().increaseMoney(1e12);
  return s().grid;
}
const done = () => useWorldStore.setState({ playing: false, roadWorks: false });
const run = (seconds: number, dt = 0.25) => { for (let t = 0; t < seconds; t += dt) s().stepRoadWorks(dt); };
const pavedCount = (g: Grid) => g.paved.reduce((n, v) => n + (v ? 1 : 0), 0);
/** Every fault of the roads that stand: a cell no ramp can serve, two side by side that do not join. */
function faults(G: Grid): Set<string> {
  const read = { inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < G.w && y < G.h, paved: (x: number, y: number) => isPaved(G, x, y), height: (x: number, y: number) => (G.deck[idx(G, x, y)] ? G.deckZ[idx(G, x, y)] : G.height[idx(G, x, y)]) };
  const out = new Set<string>();
  for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
    if (!isPaved(G, x, y)) continue;
    if (rampNeed(read, x, y).kind === "unbridgeable") out.add(`U${x},${y}`);
    if (x + 1 < G.w && isPaved(G, x + 1, y) && !connects(G, x, y, "S")) out.add(`X${x},${y}`);
    if (y + 1 < G.h && isPaved(G, x, y + 1) && !connects(G, x, y, "W")) out.add(`Y${x},${y}`);
  }
  return out;
}

describe("a road ordered in the game", () => {
  test("is a job and not a road: nothing is paved when the drag ends; the trades pass along it in turn; it opens a length at a time, from its first end; and when the last is open it is a road like any other and the job is gone", () => {
    const G = game();
    try {
      expect(drag("paintRoad", 10, 20, 29, 20)).toBe("");
      expect(pavedCount(G)).toBe(0);
      expect(G.roadJobs.length).toBe(1);
      const j = G.roadJobs[0];
      expect(j.cells.length).toBe(20);
      expect(j.cells.every((c) => c.fresh)).toBe(true);
      // Nobody on it yet; then the earthworks lead and each trade follows the one ahead.
      run(ARRIVE - 0.5);
      expect(frontOf(j, 0)).toBe(0);
      run(0.5 + PACE * 8);
      const fronts = [0, 1, 2, 3].map((t) => frontOf(j, t));
      expect(fronts[0]).toBeGreaterThanOrEqual(7);
      for (let t = 1; t < 4; t++) expect(fronts[t]).toBeLessThan(fronts[t - 1]);
      expect(stageOf(j, 0)).toBeGreaterThan(stageOf(j, 10));
      // Opening: only ever a whole length, counted from its first cell, the cells before the opening all road and none after.
      let seen = 0;
      for (let t = 0; t < jobSeconds(j) + 2 && G.roadJobs.length; t += 0.25) {
        s().stepRoadWorks(0.25);
        const n = pavedCount(G);
        if (n !== seen) {
          expect(lengthsOf(j.cells)).toContain(n);
          for (let k = 0; k < 20; k++) expect(isPaved(G, 10 + k, 20)).toBe(k < n);
          expect([...faults(G)]).toEqual([]);
          seen = n;
        }
      }
      expect(G.roadJobs.length).toBe(0);
      expect(pavedCount(G)).toBe(20);
      expect(s().netComponents).toBe(1);
      // About a second and a half a tile, and the gang's coming: a 20-tile road in under a minute.
      expect(jobSeconds(j)).toBeGreaterThan(20);
      expect(jobSeconds(j)).toBeLessThan(60);
    } finally { done(); }
  });

  test("is graded on the map as it will be: a road ordered to join one not yet built joins it when both are; the same road ordered twice is ordered once; a building may not stand on a road being built", () => {
    const G = game();
    try {
      expect(drag("paintRoad", 10, 20, 30, 20)).toBe("");
      // Off the middle of the first, which is not there yet.
      expect(drag("paintRoad", 20, 20, 20, 34)).toBe("");
      expect(G.roadJobs.length).toBe(2);
      expect(G.roadJobs[1].cells.filter((c) => c.fresh).length).toBe(14);
      expect(plannedGrid(G).paved[idx(G, 20, 27)]).not.toBe(0);
      expect(G.paved[idx(G, 20, 27)]).toBe(0);
      // Over the same line again: there is nothing to order.
      expect(drag("paintRoad", 12, 20, 28, 20)).toBe("");
      expect(G.roadJobs.length).toBe(2);
      run(120);
      expect(G.roadJobs.length).toBe(0);
      expect(pavedCount(G)).toBe(21 + 14);
      expect(s().netComponents).toBe(1);
      expect([...faults(G)]).toEqual([]);
    } finally { done(); }
  });

  test("over a hill and over a river: the ground is cut and filled as the earthworks pass, before any of it is road; a bridge opens whole", () => {
    const G = game(48, 48, (g) => {
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        if (x >= 30 && x <= 34) { setHeight(g, x, y, -4); g.pool[idx(g, x, y)] = 3; }
        else setHeight(g, x, y, x >= 14 && x <= 20 ? 6 : 0);
      }
    });
    try {
      expect(drag("paintRoad", 6, 10, 42, 10)).toBe("");
      const j = G.roadJobs[0], before = Array.from(G.height);
      run(ARRIVE + PACE * 30);
      // Ground has moved somewhere on the hill, on cells that are not road yet.
      const moved = j.cells.filter((c) => !c.deck && G.height[idx(G, c.x, c.y)] !== before[idx(G, c.x, c.y)]);
      expect(moved.length).toBeGreaterThan(0);
      let whole = true;
      for (let t = 0; t < 400 && G.roadJobs.length; t += 0.25) {
        s().stepRoadWorks(0.25);
        const decks = [30, 31, 32, 33, 34].filter((x) => G.deck[idx(G, x, 10)] !== 0).length;
        if (decks !== 0 && decks !== 5) whole = false;
        expect([...faults(G)]).toEqual([]);
      }
      expect(whole).toBe(true);
      expect(G.roadJobs.length).toBe(0);
      for (let x = 6; x <= 42; x++) expect(isPaved(G, x, 10)).toBe(true);
      expect(s().netComponents).toBe(1);
    } finally { done(); }
  });

  test("cancelled under Delete: what is open of it stays, what is not is taken up, its ground put back, and what was paid for the unbuilt tiles returned", () => {
    const G = game(48, 48, (g) => { for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, x >= 20 && x <= 24 ? 4 : 0); });
    try {
      const ground = Array.from(G.height), money0 = useMoneyStore.getState().money;
      expect(drag("paintRoad", 8, 12, 36, 12)).toBe("");
      const paid = money0.minus(useMoneyStore.getState().money).toNumber();
      expect(paid).toBeGreaterThan(0);
      const j = G.roadJobs[0];
      run(ARRIVE + PACE * 18);
      const open = pavedCount(G);
      expect(open).toBeGreaterThan(0);
      expect(open).toBeLessThan(29);
      expect(drag("demolish", 34, 12, 34, 12)).toBe("");
      expect(G.roadJobs.length).toBe(0);
      expect(pavedCount(G)).toBe(open);
      // The ground under what was never opened is as it was.
      for (const c of j.cells.slice(open)) expect(G.height[idx(G, c.x, c.y)]).toBe(ground[idx(G, c.x, c.y)]);
      const back = useMoneyStore.getState().money.minus(money0).toNumber() + paid;
      expect(back).toBeCloseTo((paid * (29 - open)) / 29, 4);
      expect([...faults(G)]).toEqual([]);
    } finally { done(); }
  });

  test(`no more than ${GANGS} jobs are worked at once: the rest wait, and are built in their turn`, () => {
    const G = game();
    try {
      for (let k = 0; k < 5; k++) expect(drag("paintRoad", 6, 6 + k * 6, 20, 6 + k * 6)).toBe("");
      run(ARRIVE + PACE * 6);
      expect(G.roadJobs.slice(0, GANGS).every((j) => j.t > 0)).toBe(true);
      expect(G.roadJobs.slice(GANGS).every((j) => j.t === 0)).toBe(true);
      run(200);
      expect(G.roadJobs.length).toBe(0);
      expect(pavedCount(G)).toBe(5 * 15);
    } finally { done(); }
  });

  test("off, as in the editor and a headless run, a stroke lays its road at once", () => {
    s().resize(32, 32);
    useWorldStore.setState({ playing: true, roadWorks: false });
    useMoneyStore.getState().increaseMoney(1e9);
    try {
      expect(drag("paintRoad", 4, 4, 20, 4)).toBe("");
      expect(pavedCount(s().grid)).toBe(17);
      expect(s().grid.roadJobs.length).toBe(0);
    } finally { done(); }
  });
});

describe("roads ordered at random over generated maps", () => {
  test("ordered, worked a while, some cancelled: at every moment every road that stands is sound, and in the end every job is built or was refused", () => {
    for (const start of [1, 2, 3]) {
      let seed = start;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const pick = (n: number) => Math.floor(rnd() * n);
      for (let m = 0; m < 4; m++) {
        s().resize(64, 64);
        generateMap(s().grid, { seed: 300 + m * 11 + start, material: 1, dirt: 2, sand: 3, woods: [4, 5, 6] });
        s().loadGrid(s().grid);
        useWorldStore.setState({ playing: true, roadWorks: true });
        useMoneyStore.getState().increaseMoney(1e12);
        const G = s().grid;
        try {
          let before = faults(G), ordered = 0;
          let planBefore = faults(plannedGrid(G));
          const checkPlan = (what: string) => {
            const P = plannedGrid(G), now = faults(P), fresh = [...now].filter((f) => !planBefore.has(f));
            if (fresh.length && process.env.JOBS_DEBUG) {
              const [fx, fy] = fresh[0].slice(1).split(",").map(Number);
              console.log("PLAN", what, fresh.join(" "));
              for (let y = fy - 3; y <= fy + 3; y++) { let o = `${String(y).padStart(2)}: `; for (let x = fx - 6; x <= fx + 6; x++) { if (x < 0 || y < 0 || x >= G.w || y >= G.h) continue; const i = idx(G, x, y); const job = G.roadJobs.find((j) => j.cells.some((c) => c.x === x && c.y === y)); o += ((P.deck[i] ? "D" + P.deckZ[i] : P.paved[i] ? "P" + P.height[i] + (P.ramp[i] ? "r" : "") : "." + P.height[i] + (P.pool[i] ? "~" : "")) + (G.paved[i] ? "" : P.paved[i] ? `*${job?.id}` : "")).padEnd(9); } console.log(o + ` (x from ${fx - 6})`); }
            }
            expect({ start, m, what, plan: fresh }).toEqual({ start, m, what, plan: [] });
            planBefore = now;
          };
          const check = (what: string) => {
            const now = faults(G), fresh = [...now].filter((f) => !before.has(f));
            if (fresh.length && process.env.JOBS_DEBUG) {
              const [fx, fy] = fresh[0].slice(1).split(",").map(Number);
              console.log(what, fresh.join(" "));
              for (let y = fy - 4; y <= fy + 4; y++) { let o = `${String(y).padStart(2)}: `; for (let x = fx - 6; x <= fx + 6; x++) { if (x < 0 || y < 0 || x >= G.w || y >= G.h) continue; const i = idx(G, x, y); const job = G.roadJobs.find((j) => j.cells.some((c) => c.x === x && c.y === y)); const jc = job?.cells.find((c) => c.x === x && c.y === y); o += ((G.deck[i] ? "D" + G.deckZ[i] : G.paved[i] ? "P" + G.height[i] + (G.ramp[i] ? "r" : "") : "." + G.height[i] + (G.pool[i] ? "~" : "")) + (jc ? `[${job!.id}:${jc.z}${jc.deck ? "d" : ""}${job!.cells.indexOf(jc) < job!.opened ? "o" : ""}]` : "")).padEnd(13); } console.log(o + ` (x from ${fx - 6})`); }
              console.log(JSON.stringify(G.roadJobs.map((j) => ({ id: j.id, n: j.cells.length, opened: j.opened, a: j.cells[0], b: j.cells[j.cells.length - 1], lengths: j.lengths, lev: j.levelled }))));
            }
            expect({ start, m, what, fresh }).toEqual({ start, m, what, fresh: [] });
            before = now;
          };
          for (let k = 0; k < 40; k++) {
            const horiz = rnd() < 0.5, a = 2 + pick(60), b0 = 2 + pick(40), b1 = Math.min(61, b0 + 4 + pick(30));
            const st: [number, number, number, number] = horiz ? [b0, a, b1, a] : [a, b0, a, b1];
            const jobs = G.roadJobs.length;
            drag("paintRoad", ...st);
            if (G.roadJobs.length > jobs) ordered++;
            check(`order ${st}`);
            checkPlan(`order ${st}`);
            for (let t = pick(40); t > 0; t--) { s().stepRoadWorks(0.5); check(`work after ${st}`); }
            // Now and then one is cancelled part built.
            if (G.roadJobs.length && rnd() < 0.15) {
              const j = G.roadJobs[pick(G.roadJobs.length)], c = j.cells[j.cells.length - 1];
              drag("demolish", c.x, c.y, c.x, c.y);
              check(`cancel job ${j.id}`);
              checkPlan(`cancel job ${j.id}`);
            }
          }
          expect(ordered).toBeGreaterThan(5);
          for (let t = 0; t < 4000 && G.roadJobs.length; t++) { s().stepRoadWorks(0.5); check("to the end"); }
          expect({ start, m, left: G.roadJobs.length }).toEqual({ start, m, left: 0 });
        } finally { done(); }
      }
    }
  }, 180_000);
});

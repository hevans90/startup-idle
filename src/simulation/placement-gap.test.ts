/**
 * THE PLACEMENT GAP: does where things go matter? Two players found the same
 * town on the same land — the garage and the services in the same places —
 * and then put down the same intern lots: one on the most desirable free tile
 * each time, the other anywhere the rules allow. Both towns then grow for an
 * hour of play by the town's own rules, every lot kept full. What each is
 * worth is its beds times what the commute leaves of a day: a stand-in for
 * the income they would make.
 *
 * The plan's target is a gap of 20–40%: near nothing, and placement is
 * decoration; far more, and a careless town is no town. `BALANCE=1` prints it,
 * `DEBUG=1` each town's mood, commute and tiers too.
 *
 * BOTH HAVE DESKS FOR NEARLY EVERYONE. Short of desks, "no desk" weighs on
 * every home alike and swamps where it is: the gap measured that way is ~5%.
 * @see plans/gameplay-fun.md "Measuring fun"
 */
import { describe, expect, test } from "bun:test";

import { housedBy } from "../game/housing";
import { DIRT, GRASS, SAND, WOODS } from "../state/world.store";
import { commuteFactor, liveCommutes } from "../world/agents/commute";
import { desireAt, liveDesireMaps } from "../world/agents/desirability";
import { liveMoods } from "../world/agents/mood";
import { createEvolution, stepEvolution } from "../world/agents/services";
import { commit, createHistory } from "../world/edit/commands";
import { generatePlayableMap } from "../world/gen/generate-map";
import { DEFAULT_GEN } from "../world/gen/params";
import { createGrid, type Grid } from "../world/grid";
import { createNetwork } from "../world/roads/network";
import { structureDef, type StructureDef } from "../world/structures/def";
import { placeCommand, validatePlacement } from "../world/structures/place";

const LOTS = 60;
const GROW_FOR = 3600;

/** A fresh copy of a seed's land with the garage and services put down where both players put them. */
function founded(seed: number) {
  const g = createGrid(64, 64);
  generatePlayableMap(g, { seed, material: GRASS, dirt: DIRT, sand: SAND, woods: WOODS, params: { ...DEFAULT_GEN, size: 64 } });
  // A company some way in: all its land bought.
  const rules = { needsRoad: true };
  const history = createHistory();
  const spots = (def: StructureDef) => {
    const out: { x: number; y: number }[] = [];
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (validatePlacement(g, def, x, y, rules).ok) out.push({ x, y });
    return out;
  };
  const put = (def: StructureDef, at: { x: number; y: number }) => {
    const cmd = placeCommand(g, def, at.x, at.y, rules);
    if (cmd) commit(g, history, cmd);
    return !!cmd;
  };
  // The garage nearest the middle of the land, and the services nearest it: the same for both.
  const mid = { x: g.w / 2, y: g.h / 2 };
  const near = (to: { x: number; y: number }) => (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - to.x, a.y - to.y) - Math.hypot(b.x - to.x, b.y - to.y);
  const garage = spots(structureDef("garage")!).sort(near(mid))[0];
  put(structureDef("garage")!, garage);
  for (const id of ["cafe", "park", "office-intern", "office-intern", "office-intern", "office-intern", "office-intern"]) put(structureDef(id)!, spots(structureDef(id)!).sort(near(garage))[3]);
  return { g, spots, put };
}

/** What a town is worth once grown: beds times the share of a day the commute leaves. */
function grownWorth(g: Grid): { beds: number; commute: number; worth: number } {
  const net = createNetwork(g), evo = createEvolution();
  const fill = () => { for (const s of g.structures.values()) { const h = housedBy(s.def); if (h) s.residents = h.slots; } };
  fill();
  for (let t = 0; t < GROW_FOR; t += 5) {
    if (stepEvolution(evo, g, liveMoods(g, net, 0), 5).length) { fill(); g.rev++; }
  }
  let beds = 0;
  for (const s of g.structures.values()) beds += housedBy(s.def)?.slots ?? 0;
  const commute = commuteFactor(g, liveCommutes(g, net), { intern: beds }, {}).intern ?? 1;
  if (process.env.DEBUG) {
    const moods = liveMoods(g, net, 0), cs = liveCommutes(g, net);
    const houses = [...g.structures.values()].filter((s) => housedBy(s.def));
    const avg = (f: (s: (typeof houses)[0]) => number) => (houses.reduce((n, s) => n + f(s), 0) / houses.length).toFixed(1);
    const tiers: Record<string, number> = {};
    for (const s of houses) { const t = s.def.split(".").pop()!; tiers[t] = (tiers[t] ?? 0) + 1; }
    console.log("  mood", avg((s) => moods.get(s.id)?.total ?? 0), "tiles", avg((s) => cs.get(s.id)?.tiles ?? 0), JSON.stringify(tiers));
  }
  return { beds, commute, worth: beds * commute };
}

function play(seed: number, smart: boolean) {
  const { g, spots, put } = founded(seed);
  const lot = structureDef("kit:intern.t0")!;
  let rng = seed;
  const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let k = 0; k < LOTS; k++) {
    const free = spots(lot);
    if (!free.length) break;
    let at = free[Math.floor(rand() * free.length)];
    if (smart) {
      const maps = liveDesireMaps(g, createNetwork(g));
      let best = -Infinity;
      for (const c of free) {
        const d = desireAt(g, maps, c.x, c.y, "intern")?.total ?? -Infinity;
        if (d > best) { best = d; at = c; }
      }
    }
    put(lot, at);
  }
  if (process.env.DEBUG) console.log(smart ? "smart" : "random");
  return grownWorth(g);
}

describe("the placement gap", () => {
  test("placing by desirability is worth more than placing anywhere", () => {
    const gaps: number[] = [];
    for (const seed of [11, 22, 33]) {
      const smart = play(seed, true), random = play(seed, false);
      const gap = smart.worth / random.worth - 1;
      gaps.push(gap);
      if (process.env.BALANCE) {
        console.log(`seed ${seed}: smart ${smart.beds} beds × ${smart.commute.toFixed(2)} · random ${random.beds} beds × ${random.commute.toFixed(2)} · gap ${(gap * 100).toFixed(0)}%`);
      }
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (process.env.BALANCE) console.log(`mean gap ${(mean * 100).toFixed(0)}%`);
    expect(mean).toBeGreaterThan(0.2);
    expect(mean).toBeLessThan(0.4);
  }, 120_000);
});

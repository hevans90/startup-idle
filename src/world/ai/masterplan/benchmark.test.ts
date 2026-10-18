/**
 * AI MODE AGAINST A GREEDY PLAYER: the same land, the same garage, the same
 * budget in build units (a lot 1, a service 3, an office 4, a tile of road
 * 0.2). AI mode takes the steps its schedule picks on the town as it stands,
 * with its masterplan's streets (`nextStep`); the greedy player puts each
 * lot on the most desirable spot there is, a service every six lots and an
 * office every eight, and pushes a dead-end road on when the frontage runs
 * out. What each town does once settled is compared. @see planTown
 * `BALANCE=1` prints it.
 */
import { describe, expect, test } from "bun:test";

import { housedBy } from "../../../game/housing";
import { DIRT, GRASS, SAND, WOODS } from "../../../state/world.store";
import { commit, createHistory } from "../../edit/commands";
import { generatePlayableMap } from "../../gen/generate-map";
import { DEFAULT_GEN } from "../../gen/params";
import { createGrid, idx, inBounds, type Grid } from "../../grid";
import { createNetwork } from "../../roads/network";
import { connects, isPaved } from "../../roads/mask";
import { derivedRamp } from "../../roads/ramp-derive";
import { structureDef } from "../../structures/def";
import { placeCommand, validatePlacement } from "../../structures/place";
import { desireAt, desireMapsOf } from "../../agents/desirability";
import { placesOf } from "../../agents/roads";
import { NEIGHBOUR } from "../../../iso/dir";
import { planTown } from "./plan";
import { nextStep, roadTiles } from "./schedule";
import { cloneGrid, settledTown } from "./town-model";

const BUDGET = 90;
const COST: Record<string, number> = { cafe: 3, park: 3, gym: 3, "office-intern": 4 };
const costOf = (def: string) => COST[def] ?? (housedBy(def) ? 1 : 3);
const ROAD = 0.2;

function founded(seed: number) {
  const g = createGrid(64, 64);
  generatePlayableMap(g, { seed, material: GRASS, dirt: DIRT, sand: SAND, woods: WOODS, params: { ...DEFAULT_GEN, size: 64 } });
  const def = structureDef("garage")!;
  outer: for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x++) if (validatePlacement(g, def, x, y, { needsRoad: true }).ok) { commit(g, createHistory(), placeCommand(g, def, x, y, { needsRoad: true })!); break outer; }
  return g;
}
const owned = (x: number, y: number) => x >= 16 && x < 48 && y >= 16 && y < 48;
const rules = { needsRoad: true, owned };

function pave(g: Grid, from: { x: number; y: number }, to: { x: number; y: number }): number {
  let n = 0;
  for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++) {
    for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) {
      if (!isPaved(g, x, y)) { g.paved[idx(g, x, y)] = 1; n++; }
    }
  }
  const read = { inBounds: (x: number, y: number) => inBounds(g, x, y), paved: (x: number, y: number) => isPaved(g, x, y), height: (x: number, y: number) => g.height[idx(g, x, y)] };
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (isPaved(g, x, y)) g.ramp[idx(g, x, y)] = derivedRamp(read, x, y);
  return n;
}
const put = (g: Grid, def: string, at: { x: number; y: number }) => {
  const cmd = placeCommand(g, structureDef(def)!, at.x, at.y, rules);
  if (cmd) commit(g, createHistory(), cmd);
  return !!cmd;
};

function aiMode(seed: number): number {
  const g = founded(seed);
  const plan = planTown(g, { owned, kinds: ["intern"], services: true, offices: true });
  const wants = { rules, kinds: ["intern" as const], services: true, offices: true };
  let left = BUDGET;
  for (let k = 0; k < 400 && left > 0.2; k++) {
    const s = nextStep(g, plan, wants);
    if (!s) break;
    if (s.kind === "road") {
      const cost = roadTiles(g, s) * ROAD;
      if (cost > left) break;
      pave(g, s.from, s.to);
      left -= cost;
    } else {
      if (costOf(s.def) > left || !put(g, s.def, s.at)) break;
      left -= costOf(s.def);
    }
  }
  if (process.env.DEBUG) describeTown("ai", g);
  return settledTown(cloneGrid(g)).work;
}

/** What a town has in it, for the printout. */
function describeTown(who: string, g: Grid) {
  const n: Record<string, number> = {};
  for (const s of g.structures.values()) n[s.def] = (n[s.def] ?? 0) + 1;
  let road = 0;
  for (let i = 0; i < g.paved.length; i++) if (g.paved[i]) road++;
  const t = settledTown(cloneGrid(g));
  console.log(who, "road", road, "beds", t.beds, "work", t.work.toFixed(0), JSON.stringify(n));
}

function greedy(seed: number): number {
  const g = founded(seed);
  let left = BUDGET, lots = 0, k = 0;
  const services = ["cafe", "park", "gym"];
  while (left > 0.5) {
    if (lots > 0 && lots % 8 === 0 && left >= 4 && k !== lots) {
      k = lots;
      const spots = [];
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (validatePlacement(g, structureDef("office-intern")!, x, y, rules).ok) spots.push({ x, y });
      if (spots.length && put(g, "office-intern", spots[0])) left -= 4;
    }
    if (lots > 0 && lots % 6 === 0 && left >= 3) {
      const def = services[(lots / 6) % 3];
      const houses = [...g.structures.values()].filter((s) => housedBy(s.def));
      let best = null, most = -1;
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        if (!validatePlacement(g, structureDef(def)!, x, y, rules).ok) continue;
        const n = houses.filter((h) => Math.abs(h.x - x) + Math.abs(h.y - y) <= 6).length;
        if (n > most) { most = n; best = { x, y }; }
      }
      if (best && put(g, def, best)) left -= 3;
    }
    const maps = desireMapsOf(g, placesOf(g, createNetwork(g)));
    let best = null, top = -Infinity;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      if (!validatePlacement(g, structureDef("kit:intern.t0")!, x, y, rules).ok) continue;
      const d = desireAt(g, maps, x, y, "intern")?.total ?? -Infinity;
      if (d > top) { top = d; best = { x, y }; }
    }
    if (best) { if (put(g, "kit:intern.t0", best)) { left -= 1; lots++; continue; } }
    // No frontage left: push a dead-end street on.
    let pushed = false;
    for (let y = 0; y < g.h && !pushed; y++) for (let x = 0; x < g.w && !pushed; x++) {
      if (!isPaved(g, x, y) || !owned(x, y)) continue;
      const ways = (["N", "E", "S", "W"] as const).filter((d) => connects(g, x, y, d));
      if (ways.length !== 1) continue;
      const [dx, dy] = NEIGHBOUR[ways[0]];
      const to = { x: x - dx * 6, y: y - dy * 6 };
      if (!inBounds(g, to.x, to.y) || !owned(to.x, to.y)) continue;
      left -= pave(g, { x: x - dx, y: y - dy }, to) * ROAD;
      pushed = true;
    }
    if (!pushed) break;
  }
  if (process.env.DEBUG) describeTown("greedy", g);
  return settledTown(cloneGrid(g)).work;
}

describe("AI mode", () => {
  test("builds a town that does more work than a greedy player's, for the same budget", () => {
    const gains: number[] = [];
    for (const seed of [11, 22, 33]) {
      const ai = aiMode(seed), gr = greedy(seed);
      gains.push(ai / gr - 1);
      if (process.env.BALANCE) console.log(`seed ${seed}: AI mode ${ai.toFixed(0)} · greedy ${gr.toFixed(0)} · ${((ai / gr - 1) * 100).toFixed(0)}%`);
    }
    const mean = gains.reduce((a, b) => a + b, 0) / gains.length;
    if (process.env.BALANCE) console.log(`mean ${(mean * 100).toFixed(0)}%`);
    // Measured 2026-10-18: +52%, +17%, +7%, mean +25%. The plan's target is +15%.
    expect(mean).toBeGreaterThan(0.15);
  }, 300_000);
});

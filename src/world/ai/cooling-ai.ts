/**
 * World v2 — THE AI KEEPS ITS DATA CENTRE COOL: which building that drinks
 * is short of water and not yet piped, the route to water for it, and laying
 * it as a main — a pump at its intake where one is needed — through the player's own
 * actions. AI mode and the company's AI both. @see routePipe, game/cooling
 */
import { boreCost, buildCost, pipeCost } from "../../game/build-cost";
import { isDrinker } from "../../game/cooling";
import { mainWet, useWorldStore } from "../../state/world.store";
import { MAIN_BORE, MAIN_END, idx, inBounds, type Grid, type Structure } from "../grid";
import { tankFor } from "../projects/cooling";
import { depthAt } from "../water/field";
import { layPipePath } from "../play/build-actions";
import { routePipe, type PipeRoute } from "./pipe-route";
import { findMains, mainReports, outletBuilding, planMain, previewMain } from "../water/mains";
import { skillOf } from "../../state/training.store";
import { RESERVOIR, reservoirs } from "./reservoir";

/** Below this share cooled, a drinker is short; and the most pipe ends the AI gives one. */
export const SHORT = 0.9;
export const MAX_INTAKES = 2;

/** Mains already feeding a building: their outlets beside it. @see outletBuilding */
export function intakesInto(g: Grid, s: Structure): number {
  let n = 0;
  for (let y = s.y - 1; y <= s.y + s.h; y++) {
    for (let x = s.x - 1; x <= s.x + s.w; x++) {
      if (!inBounds(g, x, y)) continue;
      const i = idx(g, x, y);
      if (g.mainEnd[i] === MAIN_END.outlet && outletBuilding(g, i) === s.id) n++;
    }
  }
  return n;
}

/** Water standing on a tile, and its top: from the live water where the map runs it. */
export function waterReader(g: Grid) {
  const field = useWorldStore.getState().getWaterField();
  const depth = (x: number, y: number) => Math.max(g.pool[idx(g, x, y)], field ? depthAt(field, x, y) : 0);
  return {
    wet: (x: number, y: number) => depth(x, y) >= 1,
    depth,
    surface: (x: number, y: number) => g.height[idx(g, x, y)] + depth(x, y),
  };
}

/** Seconds of what is drawn from a body of water, the new main's too, it must hold to be piped from: an hour. */
export const SUSTAIN_SECONDS = 3600;
/** What a new main is reckoned to draw, a second, before it is solved. */
const NEW_DRAW = 0.5;

/**
 * THE WATER IT MAY PIPE FROM: a body that can bear another main. One that
 * runs off the map's edge is a river, fed from beyond, and bears anything; a
 * pond or lake must hold `SUSTAIN_SECONDS` of what the mains already on it
 * draw and the new one would, beyond what its springs give it — so it does
 * not lay main after main into a pond until the pond is gone. Its own
 * reservoirs it keeps topped up: they bear their mains. @see plans/ai-takeover.md §8 "Water"
 */
export function waterThatLasts(g: Grid, wet: (x: number, y: number) => boolean, depth: (x: number, y: number) => number): (x: number, y: number) => boolean {
  const body = new Int32Array(g.w * g.h).fill(-1);
  const bodies: { volume: number; edge: boolean; draw: number; inflow: number; own: boolean }[] = [];
  for (let y0 = 0; y0 < g.h; y0++) for (let x0 = 0; x0 < g.w; x0++) {
    if (body[idx(g, x0, y0)] >= 0 || !wet(x0, y0)) continue;
    const id = bodies.length, b = { volume: 0, edge: false, draw: 0, inflow: 0, own: false };
    bodies.push(b);
    const stack = [idx(g, x0, y0)];
    body[stack[0]] = id;
    while (stack.length) {
      const i = stack.pop()!, x = i % g.w, y = (i - x) / g.w;
      b.volume += depth(x, y);
      if (x === 0 || y === 0 || x === g.w - 1 || y === g.h - 1) b.edge = true;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (!inBounds(g, nx, ny) || !wet(nx, ny)) continue;
        const j = idx(g, nx, ny);
        if (body[j] < 0) { body[j] = id; stack.push(j); }
      }
    }
  }
  // ITS OWN RESERVOIRS, by any tile of the basin. @see world/ai/reservoir
  for (const r of reservoirs()) {
    for (let dy = 0; dy < RESERVOIR; dy++) for (let dx = 0; dx < RESERVOIR; dx++) {
      const x = r.x + dx, y = r.y + dy;
      if (inBounds(g, x, y) && body[idx(g, x, y)] >= 0) bodies[body[idx(g, x, y)]].own = true;
    }
  }
  // WHAT ITS SPRINGS GIVE EACH: a spring in it, or beside it. @see runSources
  for (let i = 0; i < g.source.length; i++) {
    if (g.source[i] <= 0) continue;
    const x = i % g.w, y = (i - x) / g.w;
    const at = [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].find(([a, c]) => inBounds(g, a, c) && body[idx(g, a, c)] >= 0);
    if (at) bodies[body[idx(g, at[0], at[1])]].inflow += g.source[i];
  }
  // WHAT IS DRAWN FROM EACH: every main's capacity, on the body its intake stands in or beside.
  const reports = mainReports();
  for (const net of findMains(g).list) {
    const r = reports.get(net.id);
    const draw = r ? r.capacity : NEW_DRAW;
    for (const i of net.intakes) {
      const x = i % g.w, y = (i - x) / g.w;
      const at = [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].find(([a, c]) => inBounds(g, a, c) && body[idx(g, a, c)] >= 0);
      if (at) bodies[body[idx(g, at[0], at[1])]].draw += draw / net.intakes.length;
    }
  }
  return (x, y) => {
    if (!wet(x, y)) return false;
    const b = bodies[body[idx(g, x, y)]];
    return b.edge || b.own || b.volume >= (b.draw + NEW_DRAW - b.inflow) * SUSTAIN_SECONDS;
  };
}

/** The building most in need of a pipe, and its route; null if none is short, or none can be reached. */
export function neededPipe(g: Grid): { s: Structure; route: PipeRoute; price: number } | null {
  return pipeFor(g, (t) => t.share < SHORT);
}

/**
 * A main for the first drinker `wants` picks — by how short it is — with an
 * intake left to take, to water that will last, that would carry something.
 */
function pipeFor(g: Grid, wants: (t: NonNullable<ReturnType<typeof tankFor>>) => boolean): { s: Structure; route: PipeRoute; price: number } | null {
  const reader = waterReader(g), surface = reader.surface;
  // Only water that will last: not the last of a pond. @see waterThatLasts
  const wet = waterThatLasts(g, reader.wet, reader.depth);
  const short = [...g.structures.values()]
    .filter((s) => !s.build && isDrinker(s.def))
    .map((s) => ({ s, t: tankFor(s.id) }))
    .filter(({ s, t }) => t && t.demand > 0 && wants(t) && intakesInto(g, s) < MAX_INTAKES)
    .sort((a, b) => a.t!.share - b.t!.share || a.t!.level / a.t!.capacity - b.t!.level / b.t!.capacity);
  for (const { s } of short) {
    const owned = () => true;
    // TRAINED ON THE RIVER, it looks for a gravity run before settling for a pump. @see game/training
    // Water that will not last is still water: walked round, not over. @see waterThatLasts
    const avoid = reader.wet;
    const route = (skillOf("river") >= 1 ? routePipe(g, s, owned, wet, surface, avoid, false) : null)
      ?? routePipe(g, s, owned, wet, surface, avoid);
    if (!route) continue;
    // WHAT IT WOULD CARRY, by the same sum the tool shows: a route that would carry nothing is not laid.
    const field = useWorldStore.getState().getWaterField();
    const cells = route.pump ? [route.pump, ...route.pipe] : route.pipe;
    const plan = planMain(g, cells, mainWet(g), !!route.pump);
    if (field && !("refused" in plan) && previewMain(g, field, plan.cells, !!route.pump).flow <= 0) continue;
    const price = pipeCost(route.pipe.length).toNumber() + (route.pump ? buildCost("pump")?.toNumber() ?? Infinity : 0);
    return { s, route, price };
  }
  return null;
}

/**
 * WATER TO SPARE, to grow on: cooled, but with a tank below `full` of its
 * capacity — water coming in no faster than it goes — the AI cannot add a
 * drinker. For the drinker furthest from full: another main, if it has an
 * intake left and lasting water is in reach; or else a narrow main into it
 * widened, twice the water through the same run. Null with every tank full,
 * or nothing to be done. @see coolingState, widenMainAt
 */
export function moreWater(g: Grid, full: number):
  | { kind: "pipe"; s: Structure; route: PipeRoute; price: number }
  | { kind: "widen"; s: Structure; at: { x: number; y: number }; price: number }
  | null {
  const low = (t: NonNullable<ReturnType<typeof tankFor>>) => t.level < full * t.capacity;
  const pipe = pipeFor(g, low);
  if (pipe) return { kind: "pipe", ...pipe };
  const wanting = [...g.structures.values()]
    .filter((s) => !s.build && isDrinker(s.def))
    .map((s) => ({ s, t: tankFor(s.id) }))
    .filter(({ t }) => t && t.demand > 0 && low(t))
    .sort((a, b) => a.t!.level / a.t!.capacity - b.t!.level / b.t!.capacity);
  const nets = findMains(g).list;
  for (const { s } of wanting) {
    for (const net of nets) {
      if (!net.outlets.some((o) => outletBuilding(g, o) === s.id)) continue;
      const narrow = net.cells.filter((i) => !(g.main[i] & MAIN_BORE)).length;
      if (!narrow) continue;
      const i = net.cells[Math.floor(net.cells.length / 2)];
      return { kind: "widen", s, at: { x: i % g.w, y: (i - (i % g.w)) / g.w }, price: boreCost(narrow).toNumber() };
    }
  }
  return null;
}

/** Lay a route as a main: from its pump — a pump intake at the water — or the water, to the building. Whether it went down. */
export function layRoute(route: PipeRoute): boolean {
  return layPipePath(route.pump ? [route.pump, ...route.pipe] : route.pipe, !!route.pump);
}

/**
 * World v2 — A WATER MAIN'S STROKE, WORKED OUT ONCE: its route through its
 * pins, the plan, what it would carry, whether it is laid with a pump, the
 * whole price — pump included — and what it brings against what the building
 * needs. The ghost, the card and the stroke that lays it all read this, so
 * what the card says is what is charged and what then arrives.
 *
 * A PUMP IS PART OF THE STROKE. Where the water stands too low to reach the
 * building and a pump would lift it, the main is laid with one, priced in,
 * unless the player says not (`Stroke.noPump`). Nothing is offered afterwards.
 * @see previewMain, plans/pipe-network.md §8
 */
import { buildCost, pipeCost } from "../../game/build-cost";
import { allowanceOf, isDrinker } from "../../game/cooling";
import { agentsCooled } from "../../game/mains";
import type { Stroke } from "../edit/tools";
import { MAIN_END, idx, type Grid } from "../grid";
import { strokeKey, strokeRoute } from "../pipes/stroke-route";
import { tankFor } from "../projects/cooling";
import type { WaterField } from "./field";
import type { PipeProfile } from "../pipes/profile";
import { findMains, hasMain, laidCopy, mainProfile, mainReportsFor, planMain, previewMain, type MainCell } from "./mains";

type Cell = { x: number; y: number };

/** What a main brings a building against what it needs: the agents it has to cool, how many this would, and the share of its thirst met (nought to one). */
export type MainNeed = { building: number; agents: number; cooled: number; share: number };

export type MainStroke = {
  route: Cell[] | null;
  /** Why it cannot be laid at all; else its cells. */
  refused: string | null;
  cells: MainCell[];
  look: ReturnType<typeof previewMain> | null;
  /** Laid with a pump at its intake; and whether one would make a main that cannot flow, flow. */
  pump: boolean;
  wantsPump: boolean;
  /** New tiles, and the money: the pipe's, the pump's, and both. */
  fresh: number;
  price: { pipe: number; pump: number; total: number };
  need: MainNeed | null;
  /** The run from the side, as it would be laid. @see mainProfile */
  profile: PipeProfile | null;
  /** Both ends joined to something and water would flow: a click here lays it. */
  complete: boolean;
};

/** A water main's stroke, worked out. `auto` false lays a pump only if the stroke asks for one (`Stroke.pump`): the AI's, which decides for itself. */
export function mainStroke(g: Grid, field: WaterField | null, s: Stroke, wet: (x: number, y: number) => boolean, auto = true): MainStroke {
  // KEPT A MOMENT: the ghost asks every frame and the card every render, and the answer moves only with the stroke, the map, or — slowly — the water.
  const key = `${strokeKey(s)}|${s.pump ? 1 : 0}${s.noPump ? 1 : 0}${auto ? 1 : 0}|${s.path ? s.path.length : ""}`, now = Date.now();
  if (kept && kept.g === g && kept.rev === g.rev && kept.key === key && !s.path && now - kept.at < KEEP_MS) return kept.out;
  const out = work(g, field, s, wet, auto);
  kept = { g, rev: g.rev, key, at: now, out };
  return out;
}

/** Milliseconds a stroke's working-out stands before the water is looked at again. */
const KEEP_MS = 200;
let kept: { g: Grid; rev: number; key: string; at: number; out: MainStroke } | null = null;

function work(g: Grid, field: WaterField | null, s: Stroke, wet: (x: number, y: number) => boolean, auto: boolean): MainStroke {
  const none = { cells: [], look: null, pump: false, wantsPump: false, fresh: 0, price: { pipe: 0, pump: 0, total: 0 }, need: null, profile: null, complete: false };
  const route = strokeRoute(g, s, wet, "main");
  if (!route) return { ...none, route, refused: "No way through for a main: round buildings, off the water" };
  let plan = planMain(g, route, wet, !!s.pump, false);
  if ("refused" in plan) return { ...none, route, refused: plan.refused };
  let look = previewMain(g, field, plan.cells, !!s.pump);
  let pump = !!s.pump && plan.cells.some((c) => c.end === MAIN_END.pump);
  // TOO LOW, AND A PUMP WOULD LIFT IT: laid with one, unless told not to.
  const wantsPump = !pump && look.needsPump;
  if (wantsPump && auto && !s.noPump) {
    const lifted = planMain(g, route, wet, true, false);
    if (!("refused" in lifted)) { plan = lifted; look = previewMain(g, field, plan.cells, true); pump = true; }
  }
  const pipe = pipeCost(look.fresh).toNumber(), pumpPrice = pump ? buildCost("pump")?.toNumber() ?? 0 : 0;
  return {
    route, refused: null, cells: plan.cells, look, pump, wantsPump: wantsPump || (pump && !s.pump),
    fresh: look.fresh, price: { pipe, pump: pumpPrice, total: pipe + pumpPrice },
    need: needOf(g, plan.cells, look),
    profile: route.length > 1 ? mainProfile(laidCopy(g, plan.cells, pump), field, idx(g, route[route.length - 1].x, route[route.length - 1].y)) : null,
    complete: !look.problem && route.length > 1,
  };
}

/** What the planned main brings its building against what it needs, with what other mains already bring it. Null with no building, or one with no thirst. */
function needOf(g: Grid, cells: readonly MainCell[], look: ReturnType<typeof previewMain>): MainNeed | null {
  const s = look.building >= 0 ? g.structures.get(look.building) : undefined;
  const tank = s ? tankFor(s.id) : undefined;
  if (!s || !tank || !isDrinker(s.def) || !(tank.demand > 0)) return null;
  // What it gets already, from mains this one does not join: theirs is counted in its own flow.
  const nets = findMains(g), joined = new Set<number>();
  for (const c of cells) { const i = idx(g, c.x, c.y); if (hasMain(g, i)) joined.add(nets.list[nets.of[i]]?.cells[0] ?? -1); }
  let already = 0;
  for (const [key, r] of mainReportsFor(g)) if (!joined.has(key)) for (const o of r.outlets) if (o.building === s.id) already += o.capacity;
  const brings = already + look.flow;
  return {
    building: s.id, agents: tank.agents,
    cooled: Math.min(tank.agents, agentsCooled(brings) + allowanceOf(s.def)),
    share: Math.max(0, Math.min(1, brings / tank.demand)),
  };
}

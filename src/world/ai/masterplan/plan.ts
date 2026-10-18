/**
 * World v2 — THE MASTERPLAN: The Model's idea of the best town that will fit
 * on the land the company owns, as a list of steps to build it. Pure: a grid
 * and what the company can build in, a plan out. @see settledTown, AI mode
 *
 *  0. REBUILDING: short dead-end spurs the player laid that front nothing are
 *     lifted, to be built on; @see spurs
 *  1. STREETS: rows three tiles apart — a lot either side of every road — and
 *     connectors every `CONNECT` tiles, laid only where the ground is dry,
 *     free and not a cliff, and kept only where they join the roads there are.
 *     TERRAFORMED where the ground is too steep: a piece levelled, if that
 *     makes it roadable; REBUILT where a cheap house is in the way, cleared if
 *     the street through it opens `CLEAR_GAIN` tiles or more;
 *  2. SERVICES: cafés, parks and gyms, each where it reaches the most frontage
 *     not yet served;
 *  3. OFFICES: enough desks for the lots, where the frontage is thickest;
 *  4. LOTS: the rest of the frontage, each for the kind whose desks are near;
 *  5. A FEW PASSES moving each service to wherever the settled town does more
 *     work. @see settledTown
 *
 * Each step carries its cost-free VALUE — the work the town would lose without
 * it — so whoever builds it can go in order of what pays back soonest.
 */
import { housedBy } from "../../../game/housing";
import type { GeneratorId } from "../../../state/generators.store";
import { commit, createHistory } from "../../edit/commands";
import { idx, inBounds, structureAt, type Grid } from "../../grid";
import { isPaved } from "../../roads/mask";
import { derivedRamp, type SurfaceReader } from "../../roads/ramp-derive";
import { heightWrites } from "../../edit/height-tools";
import { structureDef } from "../../structures/def";
import { placeCommand, validatePlacement, type PlaceRules } from "../../structures/place";
import { DESKS, WORKPLACES } from "../../agents/commute";
import { desireAt, desireMapsOf } from "../../agents/desirability";
import { placesOf } from "../../agents/roads";
import { createNetwork } from "../../roads/network";
import { cloneGrid, settledTown } from "./town-model";
import { PLAIN, nearWater, type Style } from "./style";

type Cell = { x: number; y: number };

export type PlanStep =
  | { kind: "road"; from: Cell; to: Cell }
  | { kind: "build"; def: string; at: Cell; value: number }
  /** Flatten the ground along a line to `z`, as the flatten tool does: before a street over it. */
  | { kind: "level"; from: Cell; to: Cell; z: number }
  /** Lift a tile of road: a spur that goes nowhere. */
  | { kind: "lift"; at: Cell }
  /** Pull down the house in a planned street's way. */
  | { kind: "clear"; at: Cell };

export type Masterplan = {
  steps: PlanStep[];
  /** The day's work the planned town would do, settled; and the town as it stands. @see settledTown */
  predicted: number;
  now: number;
  /** Where the town is: its workplaces' middle, or the map's. The plan is built outward from here. @see buildOrder */
  centre: Cell;
};

export type PlanOptions = {
  /** Whether a tile is the company's to build on. */
  owned: (x: number, y: number) => boolean;
  /** The kinds it can hire, and so house. */
  kinds: GeneratorId[];
  /** Whether cafés, parks and gyms are open; whether offices. */
  services: boolean;
  offices: boolean;
  /** Passes moving services about; more is better and slower. */
  passes?: number;
  /** How the generations before lean it. @see styleOf */
  style?: Style;
};

/** Tiles between connecting streets. */
export const CONNECT = 8;
/** Offices of a kind a plan puts up at most. */
const MAX_OFFICES = 24;
/** The steepest step between neighbours a planned road may cross, half steps. */
const STEEP = 2;
/** Tiles of street a cleared house must open up; the longest spur lifted. */
export const CLEAR_GAIN = 6;
const SPUR = 3;

const OFFICE_FOR: Partial<Record<GeneratorId, string>> = { intern: "office-intern", vibe_coder: "office-vibe", "10x_dev": "office-10x" };

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Whether a tile is ground the company could build road on, steep or not: owned, dry, unpaved, free. */
function free(g: Grid, o: PlanOptions, x: number, y: number): boolean {
  if (!inBounds(g, x, y) || !o.owned(x, y)) return false;
  return !g.pool[idx(g, x, y)] && !isPaved(g, x, y) && structureAt(g, x, y) < 0;
}
/** Whether no neighbour is a cliff away. */
function level(g: Grid, x: number, y: number): boolean {
  const h = g.height[idx(g, x, y)];
  for (const [dx, dy] of SIDES) if (inBounds(g, x + dx, y + dy) && Math.abs(g.height[idx(g, x + dx, y + dy)] - h) > STEEP) return false;
  return true;
}
/** Whether a tile could take road: free, and not up a cliff. */
const roadable = (g: Grid, o: PlanOptions, x: number, y: number) => free(g, o, x, y) && level(g, x, y);

/** Take a building off the plan's grid. */
function unbuild(g: Grid, id: number) {
  g.structures.delete(id);
  for (let i = 0; i < g.structureAt.length; i++) if (g.structureAt[i] === id) g.structureAt[i] = -1;
}

/** The streets' pattern: rows three apart, connectors every `CONNECT`, in phase with a road already there. */
type Pattern = (x: number, y: number) => boolean;
function patternOf(g: Grid, o: PlanOptions): { on: Pattern; row: (y: number) => boolean } {
  let ry = 0, rx = 0;
  outer: for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (isPaved(g, x, y) && o.owned(x, y)) { ry = y % 3; rx = x % CONNECT; break outer; }
  return { on: (x, y) => y % 3 === ry || x % CONNECT === rx, row: (y) => y % 3 === ry };
}

const paved = (g: Grid, x: number, y: number) => inBounds(g, x, y) && isPaved(g, x, y);
const pavedSides = (g: Grid, x: number, y: number) => SIDES.filter(([dx, dy]) => paved(g, x + dx, y + dy)).length;

/**
 * SPURS: road the player laid that goes nowhere — up to `SPUR` tiles from a
 * dead end back to a junction, owned, off the pattern, away from the map's
 * edge and the water, with nothing beside it that needs it. Lifted on the
 * plan's grid; a step each.
 */
function spurs(g: Grid, o: PlanOptions, on: Pattern): PlanStep[] {
  const steps: PlanStep[] = [];
  const touches = (x: number, y: number) => SIDES.some(([dx, dy]) => inBounds(g, x + dx, y + dy) && structureAt(g, x + dx, y + dy) >= 0);
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      if (!paved(g, x, y) || pavedSides(g, x, y) !== 1) continue;
      const chain: Cell[] = [];
      let cur: Cell | null = { x, y }, prev: Cell | null = null, ok = true;
      while (cur) {
        const c: Cell = cur;
        const i = idx(g, c.x, c.y);
        if (c.x <= 0 || c.y <= 0 || c.x >= g.w - 1 || c.y >= g.h - 1 || !o.owned(c.x, c.y) || g.pool[i] || g.ramp[i] || on(c.x, c.y) || touches(c.x, c.y)) { ok = false; break; }
        chain.push(c);
        const next: Cell[] = SIDES.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter((n) => paved(g, n.x, n.y) && !(prev && n.x === prev.x && n.y === prev.y));
        if (next.length !== 1) { ok = false; break; }
        const n = next[0];
        // Back at a junction: the spur is what came before.
        if (pavedSides(g, n.x, n.y) >= 3) break;
        if (chain.length >= SPUR) { ok = false; break; }
        prev = c; cur = n;
      }
      if (!ok || !chain.length) continue;
      for (const c of chain) {
        g.paved[idx(g, c.x, c.y)] = 0;
        g.ramp[idx(g, c.x, c.y)] = 0;
        steps.push({ kind: "lift", at: c });
      }
    }
  }
  return steps;
}

/** Grown out from the roads there are, a tile at a time, through the tiles wanted. */
function grow(g: Grid, want: Set<number>): Set<number> {
  const kept = new Set<number>();
  const queue: number[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (isPaved(g, x, y)) queue.push(idx(g, x, y));
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % g.w, y = (i - x) / g.w;
    for (const [dx, dy] of SIDES) {
      if (!inBounds(g, x + dx, y + dy)) continue;
      const j = idx(g, x + dx, y + dy);
      if (!want.has(j) || kept.has(j)) continue;
      kept.add(j);
      queue.push(j);
    }
  }
  return kept;
}

/** A house cheap to pull down: a lot not grown past its first tier. */
const cheapHouse = (def: string) => !!housedBy(def) && /\.t[01]$/.test(def);

/** Runs of road along a row or a column, as from-to pairs. */
function runs(cells: Cell[], along: "x" | "y"): { from: Cell; to: Cell }[] {
  const key = (c: Cell) => (along === "x" ? c.y : c.x), pos = (c: Cell) => (along === "x" ? c.x : c.y);
  const sorted = [...cells].sort((a, b) => key(a) - key(b) || pos(a) - pos(b));
  const out: { from: Cell; to: Cell }[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && key(last.to) === key(c) && pos(last.to) + 1 === pos(c)) last.to = c;
    else out.push({ from: c, to: c });
  }
  return out;
}

/** Tiles of road a planned piece is: what one lot or two need in front of them. */
const PIECE = 3;

/** A run cut into pieces of `PIECE` tiles. */
function pieces(r: { from: Cell; to: Cell }): { from: Cell; to: Cell }[] {
  const out: { from: Cell; to: Cell }[] = [];
  const dx = Math.sign(r.to.x - r.from.x), dy = Math.sign(r.to.y - r.from.y);
  const len = Math.max(Math.abs(r.to.x - r.from.x), Math.abs(r.to.y - r.from.y)) + 1;
  for (let k = 0; k < len; k += PIECE) {
    const n = Math.min(PIECE, len - k) - 1;
    out.push({ from: { x: r.from.x + dx * k, y: r.from.y + dy * k }, to: { x: r.from.x + dx * (k + n), y: r.from.y + dy * (k + n) } });
  }
  return out;
}

/** THE STREETS: rows and connectors, joined to the roads there are — levelled, and cleared, where that pays. */
function planStreets(g: Grid, o: PlanOptions, on: Pattern, row: (y: number) => boolean): PlanStep[] {
  const steps: PlanStep[] = [];
  // TERRAFORMING: a piece of the pattern on free ground too steep for road,
  // flattened as the flatten tool would, and kept if that makes it roadable.
  const tried = new Set<number>();
  const level1 = (r: { from: Cell; to: Cell }) => {
    const cells: Cell[] = [];
    for (let y = r.from.y; y <= r.to.y; y++) for (let x = r.from.x; x <= r.to.x; x++) cells.push({ x, y });
    if (cells.every((c) => level(g, c.x, c.y)) || cells.some((c) => tried.has(idx(g, c.x, c.y)))) return;
    for (const c of cells) tried.add(idx(g, c.x, c.y));
    const was = cells.map((c) => g.height[idx(g, c.x, c.y)]);
    const writes = heightWrites(g, cells, "flatten");
    for (const w of writes) g.height[idx(g, w.x, w.y)] = w.value;
    if (writes.length && cells.every((c) => level(g, c.x, c.y))) steps.push({ kind: "level", from: r.from, to: r.to, z: writes[0].value });
    else cells.forEach((c, k) => { g.height[idx(g, c.x, c.y)] = was[k]; });
  };
  const freeCells: Cell[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (on(x, y) && free(g, o, x, y)) freeCells.push({ x, y });
  for (const r of runs(freeCells.filter((c) => row(c.y)), "x")) for (const p of pieces(r)) level1(p);
  for (const r of runs(freeCells.filter((c) => !row(c.y)), "y")) for (const p of pieces(r)) level1(p);

  const want = new Set<number>();
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (on(x, y) && roadable(g, o, x, y)) want.add(idx(g, x, y));
  let kept = grow(g, want);

  // REBUILDING: a cheap house on the pattern, pulled down if the street through it opens enough.
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const id = structureAt(g, x, y);
      const st = id >= 0 ? g.structures.get(id) : undefined;
      if (!st || !on(x, y) || !o.owned(x, y) || st.w !== 1 || st.h !== 1 || !cheapHouse(st.def) || g.pool[idx(g, x, y)] || !level(g, x, y)) continue;
      const i = idx(g, x, y);
      const trial = new Set(want).add(i);
      const more = grow(g, trial);
      if (more.size - kept.size < CLEAR_GAIN) continue;
      unbuild(g, id);
      want.add(i);
      kept = more;
      steps.push({ kind: "clear", at: { x, y } });
    }
  }

  const cells = [...kept].map((i) => ({ x: i % g.w, y: (i - (i % g.w)) / g.w }));
  // Rows first, then what the rows did not take as columns.
  const rows = runs(cells.filter((c) => row(c.y)), "x");
  const cols = runs(cells.filter((c) => !row(c.y)), "y");
  // IN PIECES of a few tiles, so a lot buys only the road in front of it. @see buildOrder
  for (const whole of [...rows, ...cols]) for (const r of pieces(whole)) {
    steps.push({ kind: "road", from: r.from, to: r.to });
    for (let y = r.from.y; y <= r.to.y; y++) for (let x = r.from.x; x <= r.to.x; x++) g.paved[idx(g, x, y)] = 1;
  }
  // THE RAMPS, as laying the road for real derives them, so the plan's roads join up across a step.
  const read: SurfaceReader = {
    inBounds: (x, y) => inBounds(g, x, y),
    paved: (x, y) => isPaved(g, x, y),
    height: (x, y) => g.height[idx(g, x, y)],
  };
  for (const c of cells) g.ramp[idx(g, c.x, c.y)] = derivedRamp(read, c.x, c.y);
  return steps;
}

/** Every spot a building could go on, by the rules. */
function spotsFor(g: Grid, def: string, rules: PlaceRules): Cell[] {
  const d = structureDef(def);
  if (!d) return [];
  const out: Cell[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (validatePlacement(g, d, x, y, rules).ok) out.push({ x, y });
  return out;
}

/** Put a building down on the plan's grid. Whether it went. */
function put(g: Grid, def: string, at: Cell, rules: PlaceRules): boolean {
  const d = structureDef(def);
  const cmd = d && placeCommand(g, d, at.x, at.y, rules);
  if (!cmd) return false;
  commit(g, createHistory(), cmd);
  return true;
}

/** Frontage a lot could take: free 1×1 spots by a road, owned. */
const frontage = (g: Grid, rules: PlaceRules, kind: GeneratorId) => spotsFor(g, `kit:${kind}.t0`, rules);

/** The middle of the town's workplaces, or of the map with none. */
function centreOf(g: Grid, style: Style): Cell {
  // RECURSIVE: out from the Data Centre, where there is one.
  const dc = style.centre === "datacentre" && [...g.structures.values()].find((s) => s.def === "datacentre");
  if (dc) return { x: dc.x + (dc.w >> 1), y: dc.y + (dc.h >> 1) };
  const ws = [...g.structures.values()].filter((s) => Object.values(WORKPLACES).some((d) => (d as readonly string[]).includes(s.def)));
  if (!ws.length) return { x: Math.floor(g.w / 2), y: Math.floor(g.h / 2) };
  return { x: Math.round(ws.reduce((n, s) => n + s.x, 0) / ws.length), y: Math.round(ws.reduce((n, s) => n + s.y, 0) / ws.length) };
}

const near = (a: Cell, b: Cell, r: number) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= r;

export function planTown(source: Grid, given: PlanOptions): Masterplan {
  const style = given.style ?? PLAIN;
  // PARANOID: nothing of the plan's within reach of the water.
  const o: PlanOptions = style.dryMargin
    ? { ...given, owned: (x, y) => given.owned(x, y) && !nearWater(source, x, y, style.dryMargin) }
    : given;
  const now = settledTown(cloneGrid(source)).work;
  const g = cloneGrid(source);
  const rules: PlaceRules = { needsRoad: true, owned: o.owned };
  const { on, row } = patternOf(g, o);
  const steps: PlanStep[] = [...spurs(g, o, on), ...planStreets(g, o, on, row)];
  const kind0 = o.kinds[0];
  const centre = centreOf(source, style);
  if (!kind0) return { steps, predicted: now, now, centre };

  // SERVICES: each where it reaches the most frontage not yet served.
  const placed: { def: string; at: Cell }[] = [];
  if (o.services) {
    for (const def of ["cafe", "park", "gym"]) {
      const front = frontage(g, rules, kind0);
      const served = new Set<number>();
      for (let n = 0; n < 6; n++) {
        let best: Cell | null = null, most = 0;
        for (const c of spotsFor(g, def, rules)) {
          const reach = front.filter((f, k) => !served.has(k) && near(f, c, 7)).length;
          if (reach > most) { most = reach; best = c; }
        }
        if (!best || most < style.serve || !put(g, def, best, rules)) break;
        placed.push({ def, at: best });
        front.forEach((f, k) => { if (near(f, best!, 7)) served.add(k); });
      }
    }
  }

  // OFFICES: desks for the lots to come, where the frontage is thickest.
  const lotsAhead = frontage(g, rules, kind0).length;
  if (o.offices) {
    for (const who of o.kinds) {
      const def = OFFICE_FOR[who];
      if (!def) continue;
      let desks = 0;
      for (const s of g.structures.values()) if ((WORKPLACES[who] as readonly string[]).includes(s.def)) desks += DESKS[s.def] ?? 0;
      // Lots shared between the kinds; a grown lot sleeps about five.
      const need = (lotsAhead / o.kinds.length) * 5 - desks;
      for (let n = 0; n < Math.ceil(need / (DESKS[def] ?? 40)) && n < MAX_OFFICES; n++) {
        const front = frontage(g, rules, who);
        let best: Cell | null = null, most = -1;
        for (const c of spotsFor(g, def, rules)) {
          const thick = front.filter((f) => near(f, c, 8)).length;
          if (thick > most) { most = thick; best = c; }
        }
        if (!best || !put(g, def, best, rules)) break;
        placed.push({ def, at: best });
      }
    }
  }

  // LOTS: the rest of the frontage, each for the kind whose workplace is nearest.
  const workplaces = [...g.structures.values()].flatMap((s) => {
    const who = (Object.keys(WORKPLACES) as GeneratorId[]).find((k) => (WORKPLACES[k] as readonly string[]).includes(s.def));
    return who && o.kinds.includes(who) ? [{ who, at: { x: s.x, y: s.y } }] : [];
  });
  for (const c of frontage(g, rules, kind0)) {
    const w = workplaces.length
      ? workplaces.reduce((a, b) => (Math.abs(b.at.x - c.x) + Math.abs(b.at.y - c.y) < Math.abs(a.at.x - c.x) + Math.abs(a.at.y - c.y) ? b : a)).who
      : kind0;
    const def = `kit:${w}.t0`;
    if (put(g, def, c, rules)) placed.push({ def, at: c });
  }

  // PASSES: each service tried a few tiles off, kept where the settled town does more.
  let score = settledTown(cloneGrid(g)).work;
  for (let pass = 0; pass < (o.passes ?? 1); pass++) {
    for (const p of placed.filter((x) => ["cafe", "park", "gym"].includes(x.def))) {
      for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
        const trial = cloneGrid(g);
        const id = structureAt(trial, p.at.x, p.at.y);
        if (id < 0) continue;
        unbuild(trial, id);
        const to = { x: p.at.x + dx, y: p.at.y + dy };
        if (!put(trial, p.def, to, rules)) continue;
        const s2 = settledTown(cloneGrid(trial)).work;
        if (s2 > score) { score = s2; p.at = to; g.structures = trial.structures; g.structureAt.set(trial.structureAt); }
      }
    }
  }

  // EACH STEP'S VALUE: a lot by how desirable it is in the planned town; the rest by its share.
  const lots = placed.filter((p) => housedBy(p.def)).length || 1;
  const maps = desireMapsOf(g, placesOf(g, createNetwork(g)));
  for (const p of placed) {
    const h = housedBy(p.def);
    const value = h ? desireAt(g, maps, p.at.x, p.at.y, h.id)?.total ?? 0 : score / lots;
    steps.push({ kind: "build", def: p.def, at: p.at, value });
  }
  return { steps, predicted: score, now, centre };
}

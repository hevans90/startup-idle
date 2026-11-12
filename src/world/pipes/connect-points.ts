/**
 * World v2 — WHERE A PIPE CAN START OR END: the places on the map a stroke of
 * each kind connects to, for the tool to light and for an end to snap to.
 *
 *  - a WATER MAIN: water it can draw (the bank beside it), a thirsty
 *    building's free inlet, the end of a main already laid;
 *  - a SEWER CONNECTION: a workplace's free slop port, a live manhole off the
 *    road;
 *  - a TRUNK: a bank to pour out at, a processor's inlet, the end of a trunk.
 *
 * ONCE A STROKE HAS BEGUN, only the ends that would finish it: from water, the
 * inlets and mains; from an inlet, the water and mains; from a slop port, the
 * manholes — and the other way about. Pure. @see plans/pipe-network.md §8
 */
import { isDrinker } from "../../game/cooling";
import { NEIGHBOUR } from "../../iso/dir";
import { MAIN_END, MAIN_SEWER, SEWER_FIT, VOID, idx, inBounds, type Grid } from "../grid";
import { lateralReach } from "../sewers/reach";
import { hasSewer } from "../sewers/solve";
import { portsOf } from "../water/ports";
import type { PipeKind } from "./stroke-route";

export type ConnectKind = "water" | "inlet" | "main-end" | "slop-port" | "manhole" | "processor" | "trunk-end";
/** A place a pipe connects: its tile, what it is, and the building whose tank it stands for, if any. */
export type ConnectPoint = { cell: number; kind: ConnectKind; building?: number };

type Cell = { x: number; y: number };
const SIDES = Object.values(NEIGHBOUR);

/** Every place a pipe of `kind` can connect; with `from`, a stroke's start, only those that would finish it. */
export function connectPoints(g: Grid, kind: PipeKind, wet: (x: number, y: number) => boolean, from?: Cell): ConnectPoint[] {
  const out: ConnectPoint[] = [];
  const hasMain = (i: number) => g.main[i] !== 0 || g.mainEnd[i] !== 0;
  const open = (i: number) => g.structureAt[i] < 0;
  /** Dry ground with water beside it: where an intake or an outfall stands. */
  const banks = () => {
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const i = idx(g, x, y);
      if (!open(i) || wet(x, y) || hasMain(i) || (kind === "trunk" && hasSewer(g, i))) continue;
      if (SIDES.some(([dx, dy]) => inBounds(g, x + dx, y + dy) && wet(x + dx, y + dy))) out.push({ cell: i, kind: "water" });
    }
  };
  if (kind === "main") {
    for (const s of g.structures.values()) {
      if (s.build || !isDrinker(s.def)) continue;
      for (const p of portsOf(g, s)) if (p.port.fluid === "water" && p.port.dir === "in" && open(p.i) && !hasMain(p.i)) out.push({ cell: p.i, kind: "inlet", building: s.id });
    }
    for (let i = 0; i < g.main.length; i++) if (g.mainEnd[i] === MAIN_END.cap && !(g.main[i] & MAIN_SEWER)) out.push({ cell: i, kind: "main-end" });
    banks();
  } else if (kind === "connection") {
    for (const s of g.structures.values()) {
      if (s.build) continue;
      for (const p of portsOf(g, s)) if (p.port.fluid === "slop" && p.port.dir === "out" && open(p.i) && !hasMain(p.i) && g.paved[p.i] === VOID) out.push({ cell: p.i, kind: "slop-port", building: s.id });
    }
    // A live manhole a connection can come down into: off the road. @see lateralReach
    const reach = lateralReach(g);
    for (let i = 0; i < reach.length; i++) if (reach[i] === 0 && g.sewerFit[i] === SEWER_FIT.node) out.push({ cell: i, kind: "manhole" });
  } else {
    for (const s of g.structures.values()) {
      if (s.build) continue;
      for (const p of portsOf(g, s)) if (p.port.fluid === "slop" && p.port.dir === "in" && open(p.i) && !hasSewer(g, p.i)) out.push({ cell: p.i, kind: "processor", building: s.id });
    }
    for (let i = 0; i < g.sewer.length; i++) {
      if (!(g.sewer[i] & 15) || g.sewerFit[i] === SEWER_FIT.outfall || g.sewerFit[i] === SEWER_FIT.inlet) continue;
      // A trunk's end: joined on one side only.
      const joins = (g.sewer[i] & 15).toString(2).split("1").length - 1;
      if (joins === 1) out.push({ cell: i, kind: "trunk-end" });
    }
    banks();
  }
  if (!from || !inBounds(g, from.x, from.y)) return out;
  // WHAT THE START IS decides what can finish it.
  const at = idx(g, from.x, from.y);
  const near = (k: ConnectKind) => out.some((p) => p.kind === k && Math.abs((p.cell % g.w) - from.x) + Math.abs(((p.cell / g.w) | 0) - from.y) <= 1);
  const start: ConnectKind | null = out.find((p) => p.cell === at)?.kind ?? (wet(from.x, from.y) || near("water") ? "water" : null);
  const ends: Partial<Record<ConnectKind, ConnectKind[]>> = {
    water: kind === "main" ? ["inlet", "main-end"] : ["processor", "trunk-end"],
    inlet: ["water", "main-end"],
    "slop-port": ["manhole"],
    manhole: ["slop-port"],
    processor: ["trunk-end", "water"],
  };
  const want = start ? ends[start] : undefined;
  return want ? out.filter((p) => want.includes(p.kind)) : out.filter((p) => p.cell !== at);
}

/** The connect point an end should go to: the one it is on, else the nearest within a tile, the bank last; else where it is. */
export function snapToConnect(g: Grid, c: Cell, points: readonly ConnectPoint[]): Cell {
  if (!inBounds(g, c.x, c.y)) return c;
  let best: ConnectPoint | null = null, bestD = Infinity;
  for (const p of points) {
    if (p.kind === "water") continue;
    const dx = Math.abs((p.cell % g.w) - c.x), dy = Math.abs(((p.cell / g.w) | 0) - c.y);
    if (Math.max(dx, dy) > 1) continue;
    const d = dx + dy;
    if (d < bestD) { best = p; bestD = d; }
  }
  return best ? { x: best.cell % g.w, y: (best.cell / g.w) | 0 } : c;
}

const kept = new WeakMap<Grid, Map<string, { rev: number; points: ConnectPoint[] }>>();

/** `connectPoints`, kept till the map changes: for whoever asks every frame. The bank follows the standing water, not this second's. */
export function connectPointsKept(g: Grid, kind: PipeKind, from?: Cell): ConnectPoint[] {
  const key = `${kind}|${from ? `${from.x},${from.y}` : ""}`;
  let by = kept.get(g);
  if (!by) kept.set(g, (by = new Map()));
  const was = by.get(key);
  if (was && was.rev === g.rev) return was.points;
  if (by.size > 8) by.clear();
  const points = connectPoints(g, kind, (x, y) => g.pool[idx(g, x, y)] > 0, from);
  by.set(key, { rev: g.rev, points });
  return points;
}

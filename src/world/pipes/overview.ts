/**
 * World v2 — EVERY PIPE AT A GLANCE: one row a network — a water main, a
 * sewer connection, a trunk — saying what it joins, what it is doing, how
 * much of what it could carry it is carrying, and whether it is about to go
 * wrong. Trouble first. And the rows that ARE trouble, for the town's
 * problems. Pure on the reports: a row is its network's report and nothing
 * the report does not say. @see pipeReports, plans/pipe-network.md §8
 */
import type { Grid } from "../grid";
import { SEWER_FIT } from "../grid";
import { tankFor } from "../projects/cooling";
import { lateralsOf } from "../sewers/flow";
import { solveSewers } from "../sewers/solve";
import { structureDef } from "../structures/def";
import { sayOf } from "../water/main-says";
import { portsAt } from "../water/ports";
import { pipeReports, type PipeReportRow } from "./reports";
import type { MainReport, SewerReport } from "./report";

export type PipeTone = "good" | "warn" | "bad" | "idle";
export type PipeRow = {
  /** Which network: its kind and a tile of it. */
  key: string;
  kind: PipeReportRow["kind"];
  cell: number;
  state: string;
  /** Its state in a word or two, and in a line. */
  title: string;
  text: string;
  tone: PipeTone;
  /** What it joins: "Water → Data Centre". */
  joins: string;
  /** What it carries a second, what it could, and the one as a share of the other. */
  flow: number;
  capacity: number;
  share: number;
  /** Not wrong yet, but about to be: why, in a line. The row shows amber. */
  warning: string | null;
  /** Something has gone wrong with it that the player would want telling: a main gone dry, a sewer come up in the street. */
  fault: boolean;
};

/** A tank that will be dry inside this many seconds at its present rate is warned of. */
export const DRY_WITHIN = 60;
/** A sewer carrying more than this share of what it can is warned of, before it comes up in the street. */
export const NEARLY_FULL = 0.9;

/** The states that are the player's to be told of. A pipe not finished — no source, nothing fed, no exit — is not news. */
const FAULTS = new Set(["dry", "burst", "backed-up", "unpaid", "surcharged", "no-head"]);
const TRUNK: Record<string, { title: string; text: string; tone: PipeTone }> = {
  flowing: { title: "Carrying", text: "Carrying slop to its exit", tone: "good" },
  idle: { title: "Empty", text: "Nothing in it", tone: "idle" },
  "no-exit": { title: "No exit", text: "It must pour into water or feed a processor", tone: "warn" },
  surcharged: { title: "Over full", text: "More than it carries: coming up at a manhole", tone: "bad" },
  "backed-up": { title: "Backed up", text: "Its slop is coming up at a manhole", tone: "bad" },
  unpaid: { title: "Lift stopped", text: "Not enough money to run its lift station", tone: "bad" },
};

const named = (g: Grid, id: number) => {
  const def = g.structures.get(id)?.def ?? "";
  return def === "lattice" ? "The Lattice" : structureDef(def)?.name ?? "A building";
};
const few = (names: string[]) => {
  const all = [...new Set(names)];
  return all.length > 2 ? `${all[0]} +${all.length - 1}` : all.join(", ");
};
/** Seconds as a clock, rounded up: a tank with a breath left has a second, not none. */
const clock = (secs: number) => { const s = Math.max(0, Math.ceil(secs - 1e-6)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** A water main's or a connection's row. */
function mainRow(g: Grid, row: PipeReportRow): PipeRow {
  const r = row.report as MainReport, say = sayOf(r);
  let joins: string, warning: string | null = null;
  if (r.sewer) {
    const to = r.sewer.node !== undefined ? "sewer" : r.sewer.outfalls.length ? "water" : r.outlets.length ? few(r.outlets.map((o) => named(g, o.building))) : "nowhere";
    joins = `${r.sewer.sources.length ? few(r.sewer.sources.map((id) => named(g, id))) : "Nothing"} → ${to}`;
  } else {
    const from = !r.intakes.length ? "No water" : r.intakes.some((k) => k.pump) ? "Pump" : "Water";
    const fed = r.outlets.filter((o) => o.building >= 0);
    joins = `${from} → ${fed.length ? few(fed.map((o) => named(g, o.building))) : "nothing"}`;
    // A TANK IT FEEDS, running down: dry inside a minute, drunk faster than the main can bring it. By what
    // it COULD bring while it is working, not what it happens to be carrying: a main tops a tank up in
    // sips, and one just loaded has carried nothing yet.
    const working = r.state === "flowing" || r.state === "full";
    let soonest = Infinity;
    for (const o of fed) {
      const t = tankFor(o.building);
      if (!t || !(t.demand > 0)) continue;
      const falls = t.demand - (working ? o.capacity : 0);
      if (falls > 1e-6 && t.level > 0) soonest = Math.min(soonest, t.level / falls);
    }
    if (soonest < DRY_WITHIN) warning = `A tank it feeds runs dry in ${clock(soonest)}`;
  }
  const tone: PipeTone = say.tone === "good" ? "good" : say.tone;
  return {
    key: `${row.kind}:${row.cell}`, kind: row.kind, cell: row.cell, state: r.state, title: say.title, text: say.text,
    tone: tone === "good" && warning ? "warn" : tone, joins, flow: r.flow, capacity: r.capacity,
    share: r.capacity > 0 ? Math.max(0, Math.min(1, r.flow / r.capacity)) : 0, warning, fault: FAULTS.has(r.state),
  };
}

/** A trunk's row. */
function trunkRow(g: Grid, row: PipeReportRow): PipeRow {
  const r = row.report as SewerReport, say = TRUNK[r.state] ?? TRUNK.idle;
  const s = solveSewers(g), net = s.nets[s.of[row.cell]];
  const drains = new Set(lateralsOf(g).filter((l) => l.node !== null && s.of[l.node] === net?.id).flatMap((l) => l.sources)).size;
  const exits = (net?.exits ?? []).map((e) => (g.sewerFit[e] === SEWER_FIT.outfall ? "water" : named(g, portsAt(g, e, "slop", "in")[0]?.building ?? -1)));
  const joins = `${drains} workplace${drains === 1 ? "" : "s"} → ${exits.length ? few(exits) : "nowhere"}`;
  // NEARLY AT WHAT IT CARRIES: amber before it comes up in the street.
  const load = r.capacity > 0 ? Math.max(r.flow, r.trunk.inflow) / r.capacity : 0;
  const warning = r.state === "flowing" && load > NEARLY_FULL ? "Nearly at what it carries" : null;
  return {
    key: `trunk:${row.cell}`, kind: "trunk", cell: row.cell, state: r.state, title: say.title, text: say.text,
    tone: say.tone === "good" && warning ? "warn" : say.tone, joins, flow: r.flow, capacity: r.capacity,
    share: Math.max(0, Math.min(1, load)), warning, fault: FAULTS.has(r.state),
  };
}

const RANK: Record<PipeTone, number> = { bad: 0, warn: 1, good: 2, idle: 3 };

/** A row for every network that has a report, trouble first; among equals, as the reports list them. */
export function pipeRows(g: Grid): PipeRow[] {
  return pipeReports(g).map((row) => (row.kind === "trunk" ? trunkRow(g, row) : mainRow(g, row)))
    .map((r, k) => ({ r, k })).sort((a, b) => RANK[a.r.tone] - RANK[b.r.tone] || a.k - b.k).map((x) => x.r);
}

/** The rows that are trouble the player would want telling of: for the town's problems. */
export const pipeFaults = (g: Grid): PipeRow[] => pipeRows(g).filter((r) => r.fault);

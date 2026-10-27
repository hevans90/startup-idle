/**
 * World v2 — what a building on the company's map would tell you about itself:
 * the words on its label. @see BuildingLabels
 *
 * Kept apart from the drawing, and from the stores, so what it says can be
 * tested from plain numbers: everything it needs from the live game comes in
 * through `InfoContext`.
 */
import { tankFor } from "../projects/cooling";
import { PUMP_HEAD } from "../../game/cooling";
import { AGENTS_A_RACK, RACK_RANGE } from "../../game/agents";
import { housedBy, residentsIn } from "../../game/housing";
import { projectForStructure, type ProjectDef } from "../../game/projects";
import type { GeneratorId } from "../../state/generators.store";
import type { Structure } from "../grid";
import { structureDef, type StructureDef } from "../structures/def";
import { workplaceKind, type Commute } from "../agents/commute";
import { NEAR_CONFERENCE_PAYS } from "../events/convoy";
import { moodWord, type MoodParts } from "../agents/mood";
import { growthShort, serviceOf, type ServiceId } from "../agents/services";
import { LAB_SHARE } from "../projects/labs";
import { KIND_COLOUR } from "../../game/kind-colours";

/** What the live game says, for the labels. */
export type InfoContext = {
  /** Money a second one employee of each kind makes, at their desk. */
  perHead: Partial<Record<GeneratorId, number>>;
  /** People on their way to each building, by its id. */
  arriving: ReadonlyMap<number, number>;
  /** Boats alongside each seaport, and waiting off it, by its id. */
  alongside: ReadonlyMap<number, number>;
  queued: ReadonlyMap<number, number>;
  /** How many live in each house, by its id. */
  residents: ReadonlyMap<number, number>;
  /** How happy each house is, and why, by its id. */
  moods: ReadonlyMap<number, MoodParts>;
  /** What serves each house, by its id. */
  coverage: ReadonlyMap<number, ReadonlySet<ServiceId>>;
  /** Each house's commute, by its id. Missing: nobody worked it out (no roads yet). */
  commutes: ReadonlyMap<number, Commute>;
  /** Each workplace's desks: taken, and how many. @see seat */
  desks?: ReadonlyMap<number, { used: number; of: number }>;
  /** What each seaport has earned in the last minute, by its id. */
  earning: ReadonlyMap<number, number>;
  /** Project sites stalled for want of money, by id. */
  stalled: ReadonlySet<number>;
  /** Money as the game writes it. */
  money: (n: number) => string;
  /** R&D labs near the campus or Data Centre, by id. @see nearHub */
  labsNear?: ReadonlySet<number>;
  /** What each workplace's desks get from where it is, by its id: a line each. @see deskPerks */
  perks?: ReadonlyMap<number, readonly string[]>;
  /** AI racks within the Data Centre's reach. @see world/projects/racks */
  racksPowered?: ReadonlySet<number>;
  /** Seconds until a flood-damaged building is repaired; null when it is not damaged. @see damage */
  repairedIn?: (id: number) => number | null;
  /** What regular routes add to every port call, as a share: 0.4 is +40%. @see ROUTE_BONUS */
  routeBonus?: number;
  /** Seaports near a standing Conference Centre, by id. @see convoyPays */
  nearConference?: ReadonlySet<number>;
};

export type InfoLine = { text: string; tone?: "good" | "warn" | "dim" };

/**
 * What a label says as FACTS, so several can be added up into one label
 * without anything lost. @see collate
 */
export type Fact =
  | { type: "home"; who: GeneratorId; residents: number; beds: number; earns?: number; coming: number; mood?: number; deskless?: number }
  | { type: "site"; name: string; pct: number; stalled: boolean; paused: boolean }
  | { type: "project"; name: string }
  | { type: "port"; berths: number; alongside: number; waiting: number; earning: number };

export type BuildingInfo = {
  title: string;
  /** The district's or the building's colour, for the label's edge. */
  accent: number;
  /** What is worth showing when zoomed out: a line, or for a collation a line a group. */
  brief: string[];
  lines: InfoLine[];
  facts: Fact[];
};

const KIND_NAME: Record<GeneratorId, [string, string]> = {
  intern: ["Intern", "interns"],
  vibe_coder: ["Vibe coder", "vibe coders"],
  "10x_dev": ["10x dev", "10x devs"],
};
export { KIND_COLOUR };
const TAB_NAME = { employees: "Employees", innovation: "Innovation", valuation: "Valuation", ai: "the AI" } as const;

/** A workplace's desks, as a label line: taken of how many, amber once full. */
function deskLine(id: number, ctx: InfoContext): InfoLine | null {
  const d = ctx.desks?.get(id);
  if (!d) return null;
  return { text: `${d.used}/${d.of} desks`, tone: d.used >= d.of ? "warn" : undefined };
}

/** What a workplace's desks get from where it is, a label line each: "Led by Ada · +25%". @see deskPerks */
const perkLines = (id: number, ctx: InfoContext): InfoLine[] =>
  (ctx.perks?.get(id) ?? []).map((text) => ({ text, tone: "good" as const }));

/** What a project opens, in a few words: "Opens hiring vibe coders". */
export function opensText(p: ProjectDef): string {
  if (p.unlocks) return `Opens hiring ${KIND_NAME[p.unlocks][1]}`;
  if (p.grants === "managers") return "Opens managers";
  if (p.grants === "services") return "Opens cafés, parks and gyms";
  if (p.grants === "ports") return "Opens seaports";
  if (p.bonus) {
    const b = p.bonus, parts: string[] = [];
    if (b.money) parts.push(`income ×${b.money}`);
    if (b.innovation) parts.push(`innovation ×${b.innovation}`);
    if (b.valuation) parts.push(`valuation ×${b.valuation}`);
    const text = `${parts.join(", ")}, for good`;
    return text[0].toUpperCase() + text.slice(1);
  }
  if (p.grants === "mandates") return "Opens board mandates";
  return "";
}

/** A housing building's name: `intern.t1` is "Intern house II", or "Intern lot II" while empty. */
export function housingName(defId: string, empty = false): string | null {
  const h = housedBy(defId);
  if (!h) return null;
  const tier = /\.(t0|t1|t2|landmark)$/.exec(defId)?.[1];
  const roman = tier === "landmark" ? " tower" : tier === "t0" ? "" : tier === "t1" ? " II" : " III";
  return `${KIND_NAME[h.id][0]} ${empty ? "lot" : "house"}${roman}`;
}

/** What is for sale, as the build picker names it. */
export function saleName(def: StructureDef): string {
  return housingName(def.id, true) ?? def.name.replace(/^seaport/, "Seaport");
}

/** A flood-damaged building's line: idle until the repair crew has been. */
function damageLine(s: Structure, ctx: InfoContext): InfoLine | null {
  const t = ctx.repairedIn?.(s.id);
  return t == null ? null : { text: `Flood damaged · repaired in ${Math.ceil(t)}s`, tone: "warn" };
}

/** What a building's label says, or null for one with nothing to say. */
export function infoFor(s: Structure, ctx: InfoContext): BuildingInfo | null {
  const def = structureDef(s.def);
  if (!def) return null;
  // A FLOOD WALL is a wall: no label. @see LEVEE
  if (s.def === "levee") return null;

  // HOUSING: who lives there, who is coming, and what they earn.
  const h = housedBy(s.def);
  if (h) {
    const here = residentsIn(s);
    const coming = ctx.arriving.get(s.id) ?? 0;
    const [, plural] = KIND_NAME[h.id];
    const rate = ctx.perHead[h.id];
    const commute = ctx.commutes.get(s.id);
    const eff = commute?.eff ?? 1;
    const lines: InfoLine[] = [{ text: `${here}/${h.slots} ${plural} living here` }];
    const broken = damageLine(s, ctx);
    if (broken) lines.push(broken);
    else if (here > 0 && rate !== undefined) lines.push({ text: `Earns ${ctx.money(here * rate * eff)}/s`, tone: "good" });
    // GROWING: how much more desirable it must get, or that it is growing.
    // @see GROW_AT
    const short = growthShort(s, ctx.moods.get(s.id));
    if (short !== null && here > 0) {
      if (short > 0) lines.push({ text: `Grows at +${short} more desirability`, tone: "dim" });
      else if (here >= h.slots) lines.push({ text: "Growing", tone: "good" });
    }
    // ITS MORALE, and what weighs on it most if it is down. @see world/agents/mood
    const mood = ctx.moods.get(s.id);
    if (mood && here > 0) {
      const worst = [...mood.parts].sort((a, b) => a.points - b.points)[0];
      const sign = mood.total > 0 ? "+" : "";
      lines.push({
        text: `Morale ${sign}${mood.total} · ${moodWord(mood.total).toLowerCase()}${mood.total < 0 && worst && worst.points < 0 ? `: ${worst.why}` : ""}`,
        tone: mood.total >= 0 ? "good" : "warn",
      });
    }
    if (commute && here > 0) {
      lines.push(commute.tiles === null
        ? { text: "No road to work", tone: "warn" }
        : { text: `${commute.tiles}-tile commute${eff < 1 ? ` · ${Math.round(eff * 100)}%` : ""}`, tone: eff < 0.75 ? "warn" : "dim" });
      if (commute.deskless > 0) lines.push({ text: `${commute.deskless} without a desk`, tone: "warn" });
    }
    if (coming > 0) lines.push({ text: `${coming} on the way`, tone: "good" });
    else if (here < h.slots) lines.push({ text: `${h.slots - here} beds free`, tone: "dim" });
    return {
      title: housingName(s.def, here === 0)!,
      accent: KIND_COLOUR[h.id],
      brief: [coming > 0 ? `${here}/${h.slots} · +${coming}` : `${here}/${h.slots}`],
      lines,
      facts: [{
        type: "home", who: h.id, residents: here, beds: h.slots, earns: rate === undefined ? undefined : broken ? 0 : here * rate * eff, coming,
        ...(mood && here > 0 ? { mood: mood.total } : {}),
        ...(commute?.deskless ? { deskless: commute.deskless } : {}),
      }],
    };
  }

  // A PROJECT: how far it has got, or what it is for.
  const p = projectForStructure(s.def);
  if (p) {
    if (s.build) {
      const pct = Math.floor((s.build.done / s.build.need) * 100);
      // The card has the rest: here, how far, and what is wrong.
      const lines: InfoLine[] = [{ text: `${pct}% built` }];
      if (s.build.priority === 0) lines.push({ text: "Paused", tone: "warn" });
      else if (ctx.stalled.has(s.id)) lines.push({ text: "Stalled", tone: "warn" });
      return {
        title: p.name, accent: 0xd4a01e, brief: [`${pct}%`], lines,
        facts: [{ type: "site", name: p.name, pct, stalled: ctx.stalled.has(s.id), paused: s.build.priority === 0 }],
      };
    }
    const lines: InfoLine[] = [];
    const desks = workplaceKind(s.def) ? deskLine(s.id, ctx) : null;
    if (desks) lines.push(desks);
    lines.push(...perkLines(s.id, ctx));
    if (p.bonus) lines.push({ text: opensText(p).replace(/, for good$/, ""), tone: "good" });
    if (p.opens) lines.push({ text: `Click for ${TAB_NAME[p.opens]}`, tone: "dim" });
    if (p.id === "datacentre") {
      const c = coolingLine(s.id);
      if (c) lines.push(c);
    }
    return { title: p.name, accent: 0x8fb3d9, brief: [p.name], lines, facts: [{ type: "project", name: p.name }] };
  }

  // THE SLOP PIT has no label: its card says it all. @see SlopPitCard
  if (s.def === "slop-pit") return null;

  // AN R&D LAB: what it adds to innovation. @see world/projects/labs
  if (s.def === "lab") {
    const near = ctx.labsNear?.has(s.id) ?? false;
    const pct = Math.round((near ? 2 : 1) * LAB_SHARE * 100);
    return {
      title: def.name, accent: 0x8a7fd6, brief: [`+${pct}%`],
      lines: [{ text: `Innovation +${pct}%${near ? ", beside the campus" : ""}`, tone: "good" }],
      facts: [{ type: "project", name: def.name }],
    };
  }

  // THE AI'S OWN THAT DRINK: how well they are cooled. @see game/cooling
  if (s.def === "ai-node" || s.def === "gpu-farm" || s.def === "compute-spire") {
    const c = coolingLine(s.id);
    return {
      title: def.name, accent: 0xb44aff, brief: [def.name],
      lines: c ? [c] : [],
      facts: [{ type: "project", name: def.name }],
    };
  }

  // A PUMP HOUSE: how far it lifts, and what it costs to run. @see PUMP
  if (s.def === "pump") {
    return {
      title: def.name, accent: 0x4a90c8, brief: ["Pump"],
      lines: [
        { text: `Lifts water ${PUMP_HEAD / 2} slabs up the pipe that meets it` },
        { text: `Costs money a second while it pumps`, tone: "dim" },
      ],
      facts: [{ type: "project", name: def.name }],
    };
  }

  // AN AI RACK: the agents it runs, and whether at full power. @see game/agents
  if (s.def === "rack") {
    const on = ctx.racksPowered?.has(s.id) ?? true;
    return {
      title: def.name, accent: 0x6c7cff, brief: [on ? "Powered" : "Half power"],
      lines: [
        { text: `Runs ${AGENTS_A_RACK} AI agents` },
        on
          ? { text: "Powered by the Data Centre", tone: "good" }
          : { text: `Half power: more than ${RACK_RANGE} tiles from the Data Centre`, tone: "warn" },
      ],
      facts: [{ type: "project", name: def.name }],
    };
  }

  // A SERVICE: how many homes it serves.
  const service = serviceOf(s.def);
  if (service) {
    let homes = 0;
    for (const [, set] of ctx.coverage) if (set.has(service)) homes++;
    return {
      title: def.name, accent: 0x2f8f6b, brief: [`${homes} homes`],
      lines: [{ text: `Serves ${homes} home${homes === 1 ? "" : "s"}` }],
      facts: [{ type: "project", name: def.name }],
    };
  }

  // AN OFFICE: who works there.
  const office = workplaceKind(s.def);
  if (office) {
    const d = ctx.desks?.get(s.id);
    return {
      title: def.name, accent: KIND_COLOUR[office], brief: [d ? `${d.used}/${d.of}` : def.name],
      lines: [deskLine(s.id, ctx) ?? { text: `${KIND_NAME[office][1]} work here` }, ...perkLines(s.id, ctx)],
      facts: [{ type: "project", name: def.name }],
    };
  }

  // A SEAPORT: its berths, and the boats calling.
  if (def.port) {
    const along = ctx.alongside.get(s.id) ?? 0, waiting = ctx.queued.get(s.id) ?? 0;
    const earning = ctx.earning.get(s.id) ?? 0;
    const lines: InfoLine[] = [
      { text: `${along}/${def.port.berths} alongside${waiting ? ` · ${waiting} waiting` : ""}`, tone: along ? undefined : "dim" },
    ];
    const broken = damageLine(s, ctx);
    if (broken) lines.push(broken);
    if (ctx.nearConference?.has(s.id)) lines.push({ text: `Conference Centre nearby: convoys ×${NEAR_CONFERENCE_PAYS}`, tone: "good" });
    if (ctx.routeBonus) lines.push({ text: `Regular routes: +${Math.round(ctx.routeBonus * 100)}% a call`, tone: "good" });
    if (earning > 0) lines.push({ text: `Earning ${ctx.money(earning)}/min`, tone: "good" });
    return {
      title: saleName(def), accent: 0x4a90c8,
      brief: [earning > 0 ? `${ctx.money(earning)}/min` : `${along}/${def.port.berths} alongside`], lines,
      facts: [{ type: "port", berths: def.port.berths, alongside: along, waiting, earning }],
    };
  }
  return null;
}

/**
 * SEVERAL LABELS AS ONE, for buildings too close on the screen to label each:
 * everything they said, added up by what it is about. Housing by district —
 * how many live in how many houses, what they earn, who is coming; sites one
 * a line; finished projects by name; seaports together. Nothing is dropped:
 * zoom in, and they come apart again.
 */
export function collate(infos: readonly BuildingInfo[], money: (n: number) => string): BuildingInfo {
  if (infos.length === 1) return infos[0];
  const t = tallyOf(infos[0]);
  for (let k = 1; k < infos.length; k++) addTally(t, tallyOf(infos[k]));
  return { ...said(t, money), facts: infos.flatMap((i) => i.facts) };
}

/**
 * WHAT A GROUP OF LABELS ADDS UP TO, kept as running totals, so two groups
 * merge in a few additions rather than by adding up every building in both
 * again — which, on a big town gathering two thousand labels into a few, was
 * most of a tenth of a second every time they were gathered. @see gatherLabels
 */
type HomeTally = { homes: number; res: number; beds: number; coming: number; known: number; earns: number; deskless: number; felt: number; moodRes: number; feltRes: number };
export type Tally = {
  count: number;
  homes: Map<GeneratorId, HomeTally>;
  sites: Extract<Fact, { type: "site" }>[];
  /** Finished projects by name, in the order each first turned up. */
  done: Map<string, number>;
  ports: { n: number; along: number; berths: number; waiting: number; earning: number };
  accents: Set<number>;
};

/** One building's label, as a tally. */
export function tallyOf(info: BuildingInfo): Tally {
  const t: Tally = { count: 1, homes: new Map(), sites: [], done: new Map(), ports: { n: 0, along: 0, berths: 0, waiting: 0, earning: 0 }, accents: new Set([info.accent]) };
  for (const f of info.facts) {
    if (f.type === "home") {
      const h = t.homes.get(f.who) ?? { homes: 0, res: 0, beds: 0, coming: 0, known: 0, earns: 0, deskless: 0, felt: 0, moodRes: 0, feltRes: 0 };
      h.homes++; h.res += f.residents; h.beds += f.beds; h.coming += f.coming; h.deskless += f.deskless ?? 0;
      if (f.earns !== undefined) { h.known++; h.earns += f.earns; }
      if (f.mood !== undefined && f.residents > 0) { h.felt++; h.moodRes += f.mood * f.residents; h.feltRes += f.residents; }
      t.homes.set(f.who, h);
    } else if (f.type === "site") t.sites.push(f);
    else if (f.type === "project") t.done.set(f.name, (t.done.get(f.name) ?? 0) + 1);
    else { t.ports.n++; t.ports.along += f.alongside; t.ports.berths += f.berths; t.ports.waiting += f.waiting; t.ports.earning += f.earning; }
  }
  return t;
}

/** `b` added into `a`, in that order: what `a` said, then what `b` did. */
export function addTally(a: Tally, b: Tally): void {
  a.count += b.count;
  for (const [who, h] of b.homes) {
    const x = a.homes.get(who);
    if (!x) { a.homes.set(who, { ...h }); continue; }
    for (const k of Object.keys(h) as (keyof HomeTally)[]) x[k] += h[k];
  }
  a.sites.push(...b.sites);
  for (const [name, n] of b.done) a.done.set(name, (a.done.get(name) ?? 0) + n);
  for (const k of Object.keys(b.ports) as (keyof Tally["ports"])[]) a.ports[k] += b.ports[k];
  for (const c of b.accents) a.accents.add(c);
}

/** What a tally says: the title, the lines and the brief of the collated label. */
export function said(t: Tally, money: (n: number) => string): Omit<BuildingInfo, "facts"> {
  const lines: InfoLine[] = [], brief: string[] = [];
  for (const who of Object.keys(KIND_NAME) as GeneratorId[]) {
    const h = t.homes.get(who);
    if (!h) continue;
    const [name] = KIND_NAME[who];
    lines.push({ text: `${name}s: ${h.res}/${h.beds} in ${h.homes} ${h.homes === 1 ? "home" : "homes"}` });
    if (h.known && h.res > 0) lines.push({ text: `  earn ${money(h.earns)}/s`, tone: "good" });
    if (h.coming) lines.push({ text: `  ${h.coming} on the way`, tone: "good" });
    if (h.deskless) lines.push({ text: `  ${h.deskless} without a desk`, tone: "warn" });
    // Their mood, weighted by who lives where. @see moodOffsets
    if (h.felt) {
      const avg = Math.round(h.moodRes / h.feltRes);
      lines.push({ text: `  morale ${avg > 0 ? "+" : ""}${avg} · ${moodWord(avg).toLowerCase()}`, tone: avg >= 0 ? "good" : "warn" });
    }
    brief.push(`${name}s ${h.res}/${h.beds}${h.coming ? ` +${h.coming}` : ""}`);
  }
  for (const f of t.sites) {
    const note = f.paused ? " (paused)" : f.stalled ? " (stalled)" : "";
    lines.push({ text: `${f.name}: ${f.pct}% built${note}`, tone: note ? "warn" : undefined });
    brief.push(`${f.name} ${f.pct}%`);
  }
  if (t.done.size) {
    const named = [...t.done].map(([name, k]) => (k > 1 ? `${name} ×${k}` : name)).join(", ");
    lines.push({ text: named });
    brief.push(named);
  }
  const p = t.ports;
  if (p.n) {
    lines.push({ text: `${p.n} seaport${p.n > 1 ? "s" : ""}: ${p.along}/${p.berths} alongside${p.waiting ? `, ${p.waiting} waiting` : ""}` });
    if (p.earning > 0) lines.push({ text: `  earning ${money(p.earning)}/min`, tone: "good" });
    brief.push(p.earning > 0 ? `Ports ${money(p.earning)}/min` : `Ports ${p.along}/${p.berths}`);
  }
  return {
    title: `${t.count} buildings`,
    accent: t.accents.size === 1 ? [...t.accents][0] : 0x9aa3ad,
    brief, lines,
  };
}

/**
 * Names, each once, with how many there are: "Intern office ×4, Café". In the
 * order each first turns up, so the same buildings read the same way round.
 */
export function counted(names: readonly string[]): string {
  const n = new Map<string, number>();
  for (const name of names) n.set(name, (n.get(name) ?? 0) + 1);
  return [...n].map(([name, k]) => (k > 1 ? `${name} ×${k}` : name)).join(", ");
}

/** Roughly how big a label is on the screen, px, before it is drawn: monospace at 10 px. */
const CHAR_W = 6.2, LINE_H = 13, PAD_W = 14, PAD_H = 6;
function sizeOf(info: Pick<BuildingInfo, "title" | "lines" | "brief">, full: boolean): { w: number; h: number } {
  const rows = full ? [info.title, ...info.lines.map((l) => l.text)] : info.brief;
  const longest = rows.reduce((n, r) => Math.max(n, r.length), 0);
  return { w: longest * CHAR_W + PAD_W, h: rows.length * LINE_H + PAD_H };
}

/**
 * GATHER labels that would overlap into one, until none do: each begins on
 * its own, and any two whose boxes meet become one, over the middle of their
 * buildings, saying all of what both did. Nearest the camera first, so a
 * group keeps the order the buildings stand in.
 */
export function gatherLabels(
  items: readonly { id: number; x: number; y: number; band: number; info: BuildingInfo }[],
  full: boolean, money: (n: number) => string, gap = 4,
): { ids: number[]; x: number; y: number; info: BuildingInfo }[] {
  // Each group's label kept as a TALLY while they merge, its text worked out
  // from that — and the whole label, facts and all, once at the end. @see Tally
  type Group = { ids: number[]; infos: BuildingInfo[]; tally: Tally | null; info: Omit<BuildingInfo, "facts"> & { facts?: Fact[] }; sx: number; n: number; top: number };
  let groups: Group[] = [...items].sort((p, q) => q.band - p.band).map((it) => ({
    ids: [it.id], infos: [it.info], tally: null, info: it.info, sx: it.x, n: 1, top: it.y,
  }));
  // Over the middle of its buildings, at the top of the highest.
  const anchor = (g: Group) => ({ x: g.sx / g.n, y: g.top });
  const box = (g: Group) => {
    const a = anchor(g), s = sizeOf(g.info, full);
    return { x: a.x - s.w / 2 - gap / 2, y: a.y - s.h - gap, w: s.w + gap, h: s.h + gap };
  };
  type Box = ReturnType<typeof box>;
  const meet = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // ANY TWO THAT MEET BECOME ONE, the nearer the camera keeping the other —
  // and the one that grew is looked at again at once, since its box has
  // moved and grown. Neighbours through a grid of fixed cells, so each look
  // is local: it was every pair, a merge at a time, and on a big town that
  // held the page for seconds. @see BuildingLabels
  const CELL = 192;
  const boxes = groups.map(box);
  // Each cell's groups as a set, a group taken out of its old cells before it
  // is filed in its new ones: refiled into lists, a grown group left a copy
  // behind in every cell it had been in, and every look after scanned them.
  const cells = new Map<number, Set<number>>();
  const key = (cx: number, cy: number) => cx * 73856093 ^ cy * 19349663;
  const each = (b: Box, f: (k: number) => void) => {
    for (let cx = Math.floor(b.x / CELL); cx <= Math.floor((b.x + b.w) / CELL); cx++) {
      for (let cy = Math.floor(b.y / CELL); cy <= Math.floor((b.y + b.h) / CELL); cy++) f(key(cx, cy));
    }
  };
  const file = (k: number) => each(boxes[k], (c) => { const l = cells.get(c); if (l) l.add(k); else cells.set(c, new Set([k])); });
  const unfile = (k: number) => each(boxes[k], (c) => { cells.get(c)?.delete(k); });
  groups.forEach((_, k) => file(k));
  const gone = new Uint8Array(groups.length);
  const queue = groups.map((_, k) => groups.length - 1 - k);
  while (queue.length) {
    const i = queue.pop()!;
    if (gone[i]) continue;
    let other = -1;
    each(boxes[i], (c) => {
      if (other >= 0) return;
      for (const j of cells.get(c) ?? []) {
        if (j !== i && !gone[j] && meet(boxes[i], boxes[j])) { other = j; return; }
      }
    });
    if (other < 0) continue;
    const a = Math.min(i, other), b = Math.max(i, other);
    const g = groups[a], o = groups[b];
    // The smaller into the larger: which order they are kept in shows nowhere
    // (the key sorts them, the facts are added up), and copying the bigger
    // into the smaller, merge after merge, was the rest of the quadratic.
    // Each side's tally taken first: a group of one has none yet, and makes it from its own label.
    const mine = g.tally ?? tallyOf(g.infos[0]), theirs = o.tally ?? tallyOf(o.infos[0]);
    if (o.ids.length > g.ids.length) { [g.ids, o.ids] = [o.ids, g.ids]; [g.infos, o.infos] = [o.infos, g.infos]; }
    for (const id of o.ids) g.ids.push(id);
    for (const info of o.infos) g.infos.push(info);
    g.sx += o.sx; g.n += o.n; g.top = Math.min(g.top, o.top);
    addTally(mine, theirs);
    g.tally = mine;
    g.info = said(mine, money);
    gone[b] = 1;
    unfile(a); unfile(b);
    boxes[a] = box(g);
    file(a);
    queue.push(a);
  }
  groups = groups.filter((_, k) => !gone[k]);
  return groups.map((g) => ({ ids: g.ids, ...anchor(g), info: g.infos.length === 1 ? g.infos[0] : { ...(g.info as Omit<BuildingInfo, "facts">), facts: g.infos.flatMap((i) => i.facts) } }));
}

/** What a building that drinks is drinking, and how well cooled it is. @see game/cooling */
function coolingLine(id: number): InfoLine | null {
  const t = tankFor(id);
  if (!t) return null;
  const pct = Math.round(t.share * 100);
  return { text: `Drinks ${t.demand.toFixed(2)} a second · ${pct}% cooled`, tone: pct >= 95 ? "good" : "warn" };
}

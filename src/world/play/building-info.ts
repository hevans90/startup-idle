/**
 * World v2 — what a building on the company's map would tell you about itself:
 * the words on its label, shown when the pointer is on it. @see BuildingLabels
 *
 * Kept apart from the drawing, and from the stores, so what it says can be
 * tested from plain numbers: everything it needs from the live game comes in
 * through `InfoContext`.
 */
import { processorBusy, slopTankOf } from "../slop/tanks";
import { CONTENTFARM_VALUATION, DATAPLANT_SPEED, REFINERY_INNOVATION, processorKind } from "../../game/processors";
import { tankFor } from "../projects/cooling";
import { PUMP_HEAD } from "../../game/cooling";
import { AGENTS_A_RACK, RACK_RANGE } from "../../game/agents";
import { housedBy, isLot, residentsIn } from "../../game/housing";
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
import { describe } from "../../game/wording";

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

export type BuildingInfo = {
  title: string;
  /** The district's or the building's colour, for the label's edge. */
  accent: number;
  lines: InfoLine[];
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
    const b = p.bonus;
    return `${describe({ money: b.money, innovation: b.innovation, valuation: b.valuation })}, for good`;
  }
  if (p.grants === "mandates") return "Opens board mandates";
  return "";
}

/** A housing building's name: `intern.t1` is "Intern house II", or "Intern lot II" while empty. */
export function housingName(defId: string, empty = false): string | null {
  const h = housedBy(defId);
  if (!h || !isLot(defId)) return null;
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
  if (h && isLot(s.def)) {
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
      lines,
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
        title: p.name, accent: 0xd4a01e, lines,
      };
    }
    const lines: InfoLine[] = [];
    // THE CAMPUS is where the 10x devs live, as well as work. @see CAMPUS_BEDS
    if (h) {
      const here = residentsIn(s), coming = ctx.arriving.get(s.id) ?? 0;
      lines.push({ text: `${here} ${KIND_NAME[h.id][here === 1 ? 0 : 1]} living here${coming > 0 ? ` · ${coming} on the way` : ""}` });
    }
    const desks = workplaceKind(s.def) ? deskLine(s.id, ctx) : null;
    if (desks) lines.push(desks);
    const slop = slopLine(s.id);
    if (slop) lines.push(slop);
    const proc = processorLine(s);
    if (proc) lines.push(proc);
    lines.push(...perkLines(s.id, ctx));
    if (p.bonus) lines.push({ text: opensText(p).replace(/, for good$/, ""), tone: "good" });
    if (p.opens) lines.push({ text: `Click for ${TAB_NAME[p.opens]}`, tone: "dim" });
    if (p.id === "datacentre") {
      const c = coolingLine(s.id);
      if (c) lines.push(c);
    }
    return { title: p.name, accent: 0x8fb3d9, lines };
  }

  // AN R&D LAB: what it adds to innovation. @see world/projects/labs
  if (s.def === "lab") {
    const near = ctx.labsNear?.has(s.id) ?? false;
    const pct = Math.round((near ? 2 : 1) * LAB_SHARE * 100);
    return {
      title: def.name, accent: 0x8a7fd6,
      lines: [{ text: `Innovation +${pct}%${near ? ", beside the campus" : ""}`, tone: "good" }],
    };
  }

  // THE AI'S OWN THAT DRINK: how well they are cooled. @see game/cooling
  if (s.def === "ai-node" || s.def === "gpu-farm" || s.def === "compute-spire") {
    const c = coolingLine(s.id);
    return {
      title: def.name, accent: 0xb44aff,
      lines: c ? [c] : [],
    };
  }

  // A PUMP HOUSE: how far it lifts, and what it costs to run. @see PUMP
  if (s.def === "pump") {
    return {
      title: def.name, accent: 0x4a90c8,
      lines: [
        { text: `Lifts water ${PUMP_HEAD / 2} slabs up the pipe that meets it` },
        { text: `Costs money a second while it pumps`, tone: "dim" },
      ],
    };
  }

  // AN AI RACK: the agents it runs, and whether at full power. @see game/agents
  if (s.def === "rack") {
    const on = ctx.racksPowered?.has(s.id) ?? true;
    return {
      title: def.name, accent: 0x6c7cff,
      lines: [
        { text: `Runs ${AGENTS_A_RACK} AI agents` },
        on
          ? { text: "Powered by the Data Centre", tone: "good" }
          : { text: `Half power: more than ${RACK_RANGE} tiles from the Data Centre`, tone: "warn" },
      ],
    };
  }

  // A SERVICE: how many homes it serves.
  const service = serviceOf(s.def);
  if (service) {
    let homes = 0;
    for (const [, set] of ctx.coverage) if (set.has(service)) homes++;
    return {
      title: def.name, accent: 0x2f8f6b,
      lines: [{ text: `Serves ${homes} home${homes === 1 ? "" : "s"}` }],
    };
  }

  // AN OFFICE: who works there.
  const office = workplaceKind(s.def);
  if (office) {
    return {
      title: def.name, accent: KIND_COLOUR[office],
      lines: [deskLine(s.id, ctx) ?? { text: `${KIND_NAME[office][1]} work here` }, ...[slopLine(s.id)].filter((l): l is InfoLine => !!l), ...perkLines(s.id, ctx)],
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
      title: saleName(def), accent: 0x4a90c8, lines,
    };
  }
  return null;
}

/** A slop processor: how busy, and what that is worth. @see game/processors */
function processorLine(s: Structure): InfoLine | null {
  const k = processorKind(s.def);
  if (!k || s.build) return null;
  const b = processorBusy(s.id);
  if (b < 0.02) return { text: "Idle: sewer slop to its inlet", tone: "dim" };
  const pct = Math.round(b * 100);
  const what = k === "refinery" ? `+${Math.round(b * REFINERY_INNOVATION * 100)}% innovation`
    : k === "dataplant" ? `training ${Math.round(b * DATAPLANT_SPEED * 100)}% faster`
    : `+${Math.round(b * CONTENTFARM_VALUATION * 100)}% valuation`;
  return { text: `${pct}% busy · ${what}`, tone: "good" };
}

/** A vibe workplace's slop tank: how full, or spilling. @see world/slop/tanks */
function slopLine(id: number): InfoLine | null {
  const t = slopTankOf(id);
  if (!t || t.rate <= 0) return null;
  if (t.spilling) return { text: "Slop tank full: spilling", tone: "warn" };
  const pct = Math.round((t.level / t.capacity) * 100);
  return { text: `Slop tank ${pct}%`, tone: pct >= 75 ? "warn" : "dim" };
}

/** What a building that drinks is drinking, and how well cooled it is. @see game/cooling */
function coolingLine(id: number): InfoLine | null {
  const t = tankFor(id);
  if (!t) return null;
  const pct = Math.round(t.share * 100);
  return { text: `Drinks ${t.demand.toFixed(2)} a second · ${pct}% cooled`, tone: pct >= 95 ? "good" : "warn" };
}

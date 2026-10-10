/**
 * World v2 — what a building on the company's map would tell you about itself:
 * the words on its label. @see BuildingLabels
 *
 * Kept apart from the drawing, and from the stores, so what it says can be
 * tested from plain numbers: everything it needs from the live game comes in
 * through `InfoContext`.
 */
import { housedBy, residentsIn } from "../../game/housing";
import { projectForStructure, type ProjectDef } from "../../game/projects";
import type { GeneratorId } from "../../state/generators.store";
import type { Structure } from "../grid";
import { structureDef, type StructureDef } from "../structures/def";
import { workplaceKind, type Commute } from "../agents/commute";
import { NEEDS, SERVICE_NAME, TIERS, serviceOf, tierOf, type ServiceId } from "../agents/services";

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
  /** How full the slop pit is, 0–100, and what share of income it takes. */
  slop?: { fill: number; penalty: number };
  /** What serves each house, by its id. */
  coverage: ReadonlyMap<number, ReadonlySet<ServiceId>>;
  /** Each house's commute, by its id. Missing: nobody worked it out (no roads yet). */
  commutes: ReadonlyMap<number, Commute>;
  /** What each seaport has earned in the last minute, by its id. */
  earning: ReadonlyMap<number, number>;
  /** Project sites stalled for want of money, by id. */
  stalled: ReadonlySet<number>;
  /** Money as the game writes it. */
  money: (n: number) => string;
};

export type InfoLine = { text: string; tone?: "good" | "warn" | "dim" };

/**
 * What a label says as FACTS, so several can be added up into one label
 * without anything lost. @see collate
 */
export type Fact =
  | { type: "home"; who: GeneratorId; residents: number; beds: number; earns?: number; coming: number }
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
export const KIND_COLOUR: Record<GeneratorId, number> = { intern: 0xf2b51d, vibe_coder: 0xff4fa3, "10x_dev": 0x2fb8a8 };
const TAB_NAME = { employees: "Employees", innovation: "Innovation", valuation: "Valuation" } as const;

/** How many commute to a workplace: everyone living where it is the nearest. */
function workforce(id: number, ctx: InfoContext): number {
  let n = 0;
  for (const [house, c] of ctx.commutes) if (c.to === id) n += ctx.residents.get(house) ?? 0;
  return n;
}

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
    return `Wonder: ${parts.join(", ")}, for good`;
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

/** What a building's label says, or null for one with nothing to say. */
export function infoFor(s: Structure, ctx: InfoContext): BuildingInfo | null {
  const def = structureDef(s.def);
  if (!def) return null;

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
    if (here > 0 && rate !== undefined) lines.push({ text: `Earns ${ctx.money(here * rate * eff)}/s`, tone: "good" });
    // GROWING: what it lacks for the next tier, or that it is full and served.
    const t = tierOf(s.def), next = t ? TIERS[TIERS.indexOf(t) + 1] : undefined;
    if (next && here > 0) {
      const lack = NEEDS[next].filter((n) => !ctx.coverage.get(s.id)?.has(n));
      if (lack.length) lines.push({ text: `Grows with a ${lack.map((n) => SERVICE_NAME[n]).join(" and ")}`, tone: "dim" });
      else if (here >= h.slots) lines.push({ text: "Growing", tone: "good" });
    }
    if (commute && here > 0) {
      lines.push(commute.tiles === null
        ? { text: "No road to work", tone: "warn" }
        : { text: `${commute.tiles}-tile commute${eff < 1 ? ` · ${Math.round(eff * 100)}%` : ""}`, tone: eff < 0.75 ? "warn" : "dim" });
    }
    if (coming > 0) lines.push({ text: `${coming} on the way`, tone: "good" });
    else if (here < h.slots) lines.push({ text: `${h.slots - here} beds free`, tone: "dim" });
    return {
      title: housingName(s.def, here === 0)!,
      accent: KIND_COLOUR[h.id],
      brief: [coming > 0 ? `${here}/${h.slots} · +${coming}` : `${here}/${h.slots}`],
      lines,
      facts: [{ type: "home", who: h.id, residents: here, beds: h.slots, earns: rate === undefined ? undefined : here * rate * eff, coming }],
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
    const staff = workforce(s.id, ctx);
    if (workplaceKind(s.def)) lines.push({ text: `${staff} work here` });
    if (p.bonus) lines.push({ text: opensText(p).replace(/^Wonder: /, "").replace(/, for good$/, ""), tone: "good" });
    if (p.opens) lines.push({ text: `Click for ${TAB_NAME[p.opens]}`, tone: "dim" });
    return { title: p.name, accent: 0x8fb3d9, brief: [p.name], lines, facts: [{ type: "project", name: p.name }] };
  }

  // THE SLOP PIT: how full, and what it is costing.
  if (s.def === "slop-pit") {
    const fill = Math.floor(ctx.slop?.fill ?? 0), penalty = Math.round((ctx.slop?.penalty ?? 0) * 100);
    const lines: InfoLine[] = [{ text: `${fill}% full` }];
    if (penalty > 0) lines.push({ text: `Income −${penalty}%`, tone: "warn" });
    return { title: def.name, accent: 0x7bd13a, brief: [`${fill}%`], lines, facts: [{ type: "project", name: def.name }] };
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
    const staff = workforce(s.id, ctx);
    return {
      title: def.name, accent: KIND_COLOUR[office], brief: [`${staff} at work`],
      lines: [{ text: `${staff} ${KIND_NAME[office][1]} work here` }],
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
  const facts = infos.flatMap((i) => i.facts);
  const lines: InfoLine[] = [], brief: string[] = [];

  for (const who of Object.keys(KIND_NAME) as GeneratorId[]) {
    const homes = facts.filter((f): f is Extract<Fact, { type: "home" }> => f.type === "home" && f.who === who);
    if (!homes.length) continue;
    const res = homes.reduce((n, f) => n + f.residents, 0), beds = homes.reduce((n, f) => n + f.beds, 0);
    const coming = homes.reduce((n, f) => n + f.coming, 0);
    const known = homes.filter((f) => f.earns !== undefined);
    const [name] = KIND_NAME[who];
    lines.push({ text: `${name}s: ${res}/${beds} in ${homes.length} ${homes.length === 1 ? "home" : "homes"}` });
    if (known.length && res > 0) lines.push({ text: `  earn ${money(known.reduce((n, f) => n + f.earns!, 0))}/s`, tone: "good" });
    if (coming) lines.push({ text: `  ${coming} on the way`, tone: "good" });
    brief.push(`${name}s ${res}/${beds}${coming ? ` +${coming}` : ""}`);
  }
  for (const f of facts) {
    if (f.type !== "site") continue;
    const note = f.paused ? " (paused)" : f.stalled ? " (stalled)" : "";
    lines.push({ text: `${f.name}: ${f.pct}% built${note}`, tone: note ? "warn" : undefined });
    brief.push(`${f.name} ${f.pct}%`);
  }
  const done = facts.filter((f): f is Extract<Fact, { type: "project" }> => f.type === "project");
  if (done.length) {
    lines.push({ text: done.map((f) => f.name).join(", ") });
    brief.push(done.map((f) => f.name).join(", "));
  }
  const ports = facts.filter((f): f is Extract<Fact, { type: "port" }> => f.type === "port");
  if (ports.length) {
    const along = ports.reduce((n, f) => n + f.alongside, 0), berths = ports.reduce((n, f) => n + f.berths, 0);
    const waiting = ports.reduce((n, f) => n + f.waiting, 0);
    const earning = ports.reduce((n, f) => n + f.earning, 0);
    lines.push({ text: `${ports.length} seaport${ports.length > 1 ? "s" : ""}: ${along}/${berths} alongside${waiting ? `, ${waiting} waiting` : ""}` });
    if (earning > 0) lines.push({ text: `  earning ${money(earning)}/min`, tone: "good" });
    brief.push(earning > 0 ? `Ports ${money(earning)}/min` : `Ports ${along}/${berths}`);
  }
  const accents = new Set(infos.map((i) => i.accent));
  return {
    title: `${infos.length} buildings`,
    accent: accents.size === 1 ? infos[0].accent : 0x9aa3ad,
    brief, lines, facts,
  };
}

/** Roughly how big a label is on the screen, px, before it is drawn: monospace at 10 px. */
const CHAR_W = 6.2, LINE_H = 13, PAD_W = 14, PAD_H = 6;
function sizeOf(info: BuildingInfo, full: boolean): { w: number; h: number } {
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
  let groups = [...items].sort((p, q) => q.band - p.band).map((it) => ({
    ids: [it.id], pts: [{ x: it.x, y: it.y }], infos: [it.info], info: it.info,
  }));
  const anchor = (g: (typeof groups)[number]) => ({
    x: g.pts.reduce((n, p) => n + p.x, 0) / g.pts.length,
    y: Math.min(...g.pts.map((p) => p.y)),
  });
  const box = (g: (typeof groups)[number]) => {
    const a = anchor(g), s = sizeOf(g.info, full);
    return { x: a.x - s.w / 2 - gap / 2, y: a.y - s.h - gap, w: s.w + gap, h: s.h + gap };
  };
  for (let merged = true; merged;) {
    merged = false;
    const boxes = groups.map(box);
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          const g = groups[i], o = groups[j];
          g.ids.push(...o.ids); g.pts.push(...o.pts); g.infos.push(...o.infos);
          g.info = collate(g.infos, money);
          groups = groups.filter((_, k) => k !== j);
          merged = true;
          break outer;
        }
      }
    }
  }
  return groups.map((g) => ({ ids: g.ids, ...anchor(g), info: g.info }));
}

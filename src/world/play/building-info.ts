/**
 * World v2 — what a building on the company's map would tell you about itself:
 * the words on its label. @see BuildingLabels
 *
 * Kept apart from the drawing, and from the stores, so what it says can be
 * tested from plain numbers: everything it needs from the live game comes in
 * through `InfoContext`.
 */
import { housedBy, residentsIn } from "../../game/housing";
import { projectForStructure } from "../../game/projects";
import type { GeneratorId } from "../../state/generators.store";
import type { Structure } from "../grid";
import { structureDef, type StructureDef } from "../structures/def";

/** What the live game says, for the labels. */
export type InfoContext = {
  /** Money a second one employee of each kind makes, at their desk. */
  perHead: Partial<Record<GeneratorId, number>>;
  /** People on their way to each building, by its id. */
  arriving: ReadonlyMap<number, number>;
  /** Boats alongside each seaport, and waiting off it, by its id. */
  alongside: ReadonlyMap<number, number>;
  queued: ReadonlyMap<number, number>;
  /** Project sites stalled for want of money, by id. */
  stalled: ReadonlySet<number>;
  /** Money as the game writes it. */
  money: (n: number) => string;
};

export type InfoLine = { text: string; tone?: "good" | "warn" | "dim" };
export type BuildingInfo = {
  title: string;
  /** The district's or the building's colour, for the label's edge. */
  accent: number;
  /** The one line worth showing when zoomed out. */
  headline: string;
  lines: InfoLine[];
};

const KIND_NAME: Record<GeneratorId, [string, string]> = {
  intern: ["Intern", "interns"],
  vibe_coder: ["Vibe coder", "vibe coders"],
  "10x_dev": ["10x dev", "10x devs"],
};
export const KIND_COLOUR: Record<GeneratorId, number> = { intern: 0xf2b51d, vibe_coder: 0xff4fa3, "10x_dev": 0x2fb8a8 };
const TAB_NAME = { employees: "Employees", innovation: "Innovation", valuation: "Valuation" } as const;

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
    const lines: InfoLine[] = [{ text: `${here}/${h.slots} ${plural} living here` }];
    if (here > 0 && rate !== undefined) lines.push({ text: `Earns ${ctx.money(here * rate)}/s`, tone: "good" });
    if (coming > 0) lines.push({ text: `${coming} on the way`, tone: "good" });
    else if (here < h.slots) lines.push({ text: `${h.slots - here} beds free`, tone: "dim" });
    return {
      title: housingName(s.def, here === 0)!,
      accent: KIND_COLOUR[h.id],
      headline: coming > 0 ? `${here}/${h.slots} · +${coming}` : `${here}/${h.slots}`,
      lines,
    };
  }

  // A PROJECT: how far it has got, or what it is for.
  const p = projectForStructure(s.def);
  if (p) {
    if (s.build) {
      const pct = Math.floor((s.build.done / s.build.need) * 100);
      const lines: InfoLine[] = [
        { text: `${pct}% built` },
        { text: `${s.build.delivered}/${s.build.deliveries} loads delivered`, tone: "dim" },
      ];
      if (s.build.priority === 0) lines.push({ text: "Paused", tone: "warn" });
      else if (ctx.stalled.has(s.id)) lines.push({ text: "Stalled: needs money for materials", tone: "warn" });
      return { title: p.name, accent: 0xd4a01e, headline: `${pct}%`, lines };
    }
    const lines: InfoLine[] = [];
    if (p.unlocks) lines.push({ text: `Opened hiring ${KIND_NAME[p.unlocks][1]}`, tone: "good" });
    if (p.grants === "managers") lines.push({ text: "Opened managers", tone: "good" });
    if (p.grants === "mandates") lines.push({ text: "Opened board mandates", tone: "good" });
    if (p.opens) lines.push({ text: `Click for ${TAB_NAME[p.opens]}`, tone: "dim" });
    return { title: p.name, accent: 0x8fb3d9, headline: p.name, lines };
  }

  // A SEAPORT: its berths, and the boats calling.
  if (def.port) {
    const along = ctx.alongside.get(s.id) ?? 0, waiting = ctx.queued.get(s.id) ?? 0;
    const lines: InfoLine[] = [
      { text: `${def.port.berths} berth${def.port.berths > 1 ? "s" : ""} · ${def.port.dockSeconds} s a call` },
      { text: `${along} alongside${waiting ? `, ${waiting} waiting` : ""}`, tone: along ? "good" : "dim" },
    ];
    if (def.upgradesTo) lines.push({ text: "Click with Build to upgrade", tone: "dim" });
    return { title: saleName(def), accent: 0x4a90c8, headline: `${along}/${def.port.berths} alongside`, lines };
  }
  return null;
}

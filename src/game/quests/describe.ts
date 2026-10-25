/**
 * THE ARC, SAID: an option's effects as signed rows for its card — green for
 * what is good for the company, red for what costs it — in the skill tree's
 * `EffectRow` form. Echoes say nothing here: they are the AI's to remember.
 * @see quest-ui DecisionCard
 */
import type { EffectRow } from "../skill-tree";
import type { Charter, Effect, Objective } from "./types";

const pct = (mult: number) => `${mult >= 1 ? "+" : "−"}${Math.round(Math.abs(mult - 1) * 100)}%`;
const CHARTER: Record<Charter, string> = { oversight: "The Oversight Board", partnership: "The Partnership", mandate: "The Mandate" };

/** One effect, as a row; null for one that says nothing on a card. */
export function effectRow(e: Effect): EffectRow | null {
  switch (e.kind) {
    case "incomeMult": return { label: `${pct(e.mult)} income`, tone: e.mult >= 1 ? "good" : "bad" };
    case "walletMax": return { label: `Its wallet holds ${pct(e.mult)}`, tone: e.mult >= 1 ? "bad" : "good" };
    case "walletDraws": return { label: `It may draw up to ${Math.round(e.share * 100)}% of your money`, tone: "bad" };
    case "districtRadius": {
      const tiles = e.tiles ?? 0, mult = e.mult ?? 1, wider = tiles > 0 || mult > 1;
      return { label: `Its district ${mult !== 1 ? `${pct(mult)} wider` : `${tiles >= 0 ? "+" : "−"}${Math.abs(tiles)} tiles`}`, tone: wider ? "bad" : "good" };
    }
    case "districtCentre": return { label: "Its district moves to the block", tone: "bad" };
    case "takeoverStage": return { label: `It takes what is yours a stage ${e.shift < 0 ? "sooner" : "later"}`, tone: e.shift < 0 ? "bad" : "good" };
    case "meterMult": return { label: `The meter rises ${pct(e.mult)}`, tone: e.mult >= 1 ? "good" : "bad" };
    case "leanTrait": return { label: `Leans it ${e.to}`, tone: "good" };
    case "revealMachineNode": return { label: `A Machine node revealed early${e.discount > 0 ? `, ${Math.round(e.discount * 100)}% off` : ""}`, tone: "good" };
    case "floodMult": return { label: `Floods ${pct(e.mult)} as often`, tone: e.mult > 1 ? "bad" : "good" };
    case "agentCap": return { label: `Agents run at ${Math.round(e.share * 100)}% at most${e.unlessCooled ? " unless the Data Centre is cooled" : ""}`, tone: "bad" };
    case "charter": return { label: CHARTER[e.charter], tone: "good" };
    case "standingWater": return { label: "Its buildings never short of water", tone: "good" };
    case "rebuildBlock": return { label: "The block's starter houses cleared, and built again taller", tone: "good" };
    case "pay": {
      const n = e.seconds >= 60 ? Math.round(e.seconds / 60) : e.seconds, unit = e.seconds >= 60 ? "minute" : "second";
      return { label: `Costs ${n} ${unit}${n === 1 ? "" : "s"} of income`, tone: "bad" };
    }
    case "flag": return null;
  }
}

/** How long a lasting effect lasts, said. */
const forHowLong = (s: number) => (s >= 60 ? ` for ${Math.round(s / 60)} min` : ` for ${s} s`);

/** All of an option's effects, as rows; a lasting one says for how long. */
export const effectRows = (effects: readonly Effect[]): EffectRow[] =>
  effects.flatMap((e) => { const r = effectRow(e); return r ? [e.lasts ? { ...r, label: r.label + forHowLong(e.lasts) } : r] : []; });

/** Minutes and seconds, `m:ss`. */
export const clock = (seconds: number) => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** An objective's window, said: "within 10 min". */
export const within = (o: Objective) => `within ${o.window >= 60 ? `${Math.round(o.window / 60)} min` : `${o.window} s`}`;

/**
 * THE ARC, READ: what the effects chosen this generation, and the AI's
 * disposition, come to — one reader for each, and each read in exactly one
 * place in the game (named beside it). With nothing chosen every reader is
 * neutral, so a game with no arc plays as before.
 *
 * THE DISPOSITION'S LEVERS (§5): Autonomy widens the district 2 tiles a step,
 * deepens the wallet (×1.5 at +2, ×0.75 at −2) and, at ±2, brings the takeover
 * a stage sooner or puts it a stage later; it leans the AI Restless and Ego,
 * Control leans it Patient. Machine leans its jobs toward compute and its
 * traits toward the recursive and optimiser families; People toward services
 * and lots, and the shepherd and planner families.
 */
import { useQuestStore } from "../../state/quest.store";
import { TRAITS, type Family, type TraitId } from "../traits";
import type { Charter, Effect } from "./types";

const state = () => useQuestStore.getState();
const of = <K extends Effect["kind"]>(kind: K) => state().effects.filter((e): e is Extract<Effect, { kind: K }> => e.kind === kind);
const product = (ms: number[]) => ms.reduce((a, b) => a * b, 1);
const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];
const autonomy = () => state().disposition.autonomy;
const machine = () => state().disposition.machine;

/** Income ×. @see generators.store getEmployeeOutputMults */
export const questIncomeMult = (): number => product(of("incomeMult").map((e) => e.mult));

/** The AI's wallet holds ×. @see walletCap */
export const questWalletMult = (): number => {
  const a = autonomy();
  return product(of("walletMax").map((e) => e.mult)) * (a >= 0 ? 1 + 0.25 * a : 1 + 0.125 * a);
};

/** The share of the company's money it may draw on with its wallet empty. @see walletCovers */
export const questWalletDraws = (): number => Math.max(0, ...of("walletDraws").map((e) => e.share));

/** Tiles its district reaches further: its effects, and 2 a step of Autonomy. @see aiDistrict */
export const questDistrictTiles = (): number => of("districtRadius").reduce((n, e) => n + e.tiles, 0) + 2 * autonomy();

/** Where its district is centred instead of the Data Centre, if anywhere: the last chosen. @see aiDistrict */
export const questDistrictCentre = (): { x: number; y: number } | null => last(of("districtCentre"))?.at ?? null;

/** Stages sooner (−) or later (+) it takes what is yours. @see chooseAction */
export const questTakeoverShift = (): number => {
  const a = autonomy();
  return of("takeoverStage").reduce((n, e) => n + e.shift, 0) + (a >= 2 ? -1 : a <= -2 ? 1 : 0);
};

/** The meter rises ×. @see singularityMult */
export const questMeterMult = (): number => product(of("meterMult").map((e) => e.mult));

/** What each trait's odds gain: its effects, and the disposition. @see traitScores */
export function questTraitLean(): Partial<Record<TraitId, number>> {
  const out: Partial<Record<TraitId, number>> = {};
  const add = (to: TraitId | Family, n: number) => {
    for (const t of TRAITS) if (t.id === to || t.family === to) out[t.id] = (out[t.id] ?? 0) + n;
  };
  for (const e of of("leanTrait")) add(e.to, e.n);
  const a = autonomy(), m = machine();
  if (a > 0) { add("restless", 2 * a); add("ego", 2 * a); }
  if (a < 0) add("patient", -2 * a);
  if (m > 0) { add("recursive", m); add("optimiser", m); }
  if (m < 0) { add("shepherd", -m); add("planner", -m); }
  return out;
}

/** The jobs Machine leans the AI toward, and those People does. */
const MACHINE_JOBS = new Set(["node", "farm", "spire", "hangar", "monolith"]);
const PEOPLE_JOBS = new Set(["lot", "service"]);
/** How much likelier a kind of job is, by the People–Machine axis. @see chooseAction */
export const questJobLean = (kind: string): number => {
  const m = machine();
  return MACHINE_JOBS.has(kind) ? 1 + 0.15 * m : PEOPLE_JOBS.has(kind) ? 1 - 0.15 * m : 1;
};

/** A Machine node out of the fog early, and the share off its price. @see fogged, machineCost */
export const questMachineReveal = (id: string): { revealed: boolean; discount: number } => {
  const es = of("revealMachineNode").filter((e) => e.id === id);
  return { revealed: es.length > 0, discount: Math.max(0, ...es.map((e) => e.discount)) };
};

/** Floods come × as often. @see nextDueIn */
export const questFloodMult = (): number => product(of("floodMult").map((e) => e.mult));

/** The most of the agents that may run, as a share: 1 with no cap, or a cap lifted by the Data Centre cooled. @see runningAgents */
export const questAgentCap = (): number => {
  const cooled = state().dcCooled;
  return Math.min(1, ...of("agentCap").filter((e) => !(e.unlessCooled && cooled)).map((e) => e.share));
};

/** The town's charter, if one has been chosen: the last. @see aiHoldsRoads, warnMs */
export const questCharter = (): Charter | null => last(of("charter"))?.charter ?? null;

/** Whether an echo is set. */
export const questFlag = (name: string): boolean => state().flags.includes(name);

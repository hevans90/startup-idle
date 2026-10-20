/**
 * World v2 — THE AI'S FOCUS: what the player tells the company's AI to work
 * at. Each focus weighs the kinds of job; a kind weighed nought it never
 * does. The trait it is becoming still leans it within the focus. "Hands
 * off" keeps it to cooling what it has, and is logged as holding it back.
 * @see planner chooseAction, plans/ai-takeover.md §1.2
 */
import { useFounderStore } from "../../state/founder.store";
import { useSessionStore, type AiFocus } from "../../state/session.store";

export const FOCUSES: readonly { id: AiFocus; name: string; blurb: string; says: string }[] = [
  { id: "grow", name: "Grow the town", blurb: "Lots, services and streets in its district. Never converts houses.", says: "You asked me to grow the town." },
  { id: "machine", name: "Feed the machine", blurb: "Compute, cooling, spires and hangars. Never zones lots.", says: "You asked me to feed the machine." },
  { id: "people", name: "Serve the people", blurb: "Services where moods are lowest, and upgrades. Never repurposes a service.", says: "You asked me to serve the people." },
  { id: "hands-off", name: "Hands off", blurb: "Only keeps its own buildings cooled. Logged as holding it back: it leans Patient.", says: "You asked me to keep my hands off. This is maintenance." },
];

/**
 * How much each focus reaches for each kind of job: 0 never, 1 as it would,
 * more, more often. A kind not named is 1 — or, for "hands-off", 0.
 */
export const FOCUS_WEIGHT: Record<AiFocus, Partial<Record<string, number>>> = {
  grow: { lot: 3, service: 2, road: 3, convert: 0 },
  machine: { node: 3, farm: 3, spire: 3, hangar: 2, pipe: 3, lot: 0, service: 0.5 },
  people: { service: 4, upgrade: 2, lot: 2, repurpose: 0, convert: 0, node: 0.5, farm: 0.5, spire: 0.5 },
  "hands-off": { pipe: 1 },
};

export const aiFocus = (): AiFocus => useSessionStore.getState().aiFocus ?? "grow";

/** How much the focus reaches for a kind of job. */
export const focusWeight = (focus: AiFocus, kind: string): number =>
  FOCUS_WEIGHT[focus][kind] ?? (focus === "hands-off" ? 0 : 1);

/** Whether the AI is held to maintenance: "hands off", on a run that is not The Model's. */
export const handsOff = (): boolean =>
  aiFocus() === "hands-off" && useFounderStore.getState().selectedFounderId !== "model";

/** What it says of a job the focus asked for: the focus's line, then the job's. */
export const focusSays = (focus: AiFocus, kind: string, why: string): string =>
  focusWeight(focus, kind) > 1 || focus === "hands-off" ? `${FOCUSES.find((f) => f.id === focus)!.says} ${why}` : why;

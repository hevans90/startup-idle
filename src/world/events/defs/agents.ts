/**
 * AN AGENT INCIDENT: one of the agents has done something on its own. Roll it
 * back (the meter down, and money for the clean-up), let it run (the meter up,
 * and whatever it made), or make it policy (an offer of the AI's own cards).
 * @see nudge, policyDeal
 */
import { useAiSingularityStore } from "../../../state/ai-singularity.store";
import { useGeneratorStore } from "../../../state/generators.store";
import type { EventDef } from "../events";

/** Points the meter moves either way. */
export const INCIDENT_METER = 5;
/** Seconds of income rolling back costs, and letting it run makes. */
export const ROLLBACK_SECONDS = 30;
export const RUN_SECONDS = 90;

export const AGENT_INCIDENT: EventDef = {
  kind: "agents",
  where: (v) => v.datacentre && { x: v.datacentre.x, y: v.datacentre.y },
  warnMs: 30_000,
  activeMs: 1_000,
  warning: { title: "An agent has gone off on its own", text: () => "One of the agents has done something nobody asked it to. It seems to have worked." },
  active: { title: "Agent incident", text: "Deciding what to do about it." },
  calledOff: "Nobody noticed.",
  choices: [
    { id: "rollback", label: "Roll it back", price: (v) => v.income * ROLLBACK_SECONDS, note: () => `the meter −${INCIDENT_METER}` },
    { id: "run", label: "Let it run", note: (v) => `the meter +${INCIDENT_METER} · +${Math.round(v.income * RUN_SECONDS)}` },
    {
      id: "policy", label: "Make it policy", note: () => "a culture card offer: 1 of 3 of the AI's own",
      unavailable: (v) => (v.datacentre?.policy ? undefined : "No AI cards to deal"),
    },
  ],
  default: "run",
  ai: () => "policy",
  outcome: (e, v) => {
    const meter = useAiSingularityStore.getState();
    if (e.chosen === "rollback") return { text: `Rolled back: the meter −${INCIDENT_METER}.`, then: () => meter.nudge(-INCIDENT_METER) };
    if (e.chosen === "policy") return { text: "Made policy: an offer of the AI's cards is on the deck.", then: () => { useGeneratorStore.getState().dealPolicy(); } };
    return { text: `It ran: the meter +${INCIDENT_METER}.`, money: v.income * RUN_SECONDS, then: () => meter.nudge(INCIDENT_METER) };
  },
};

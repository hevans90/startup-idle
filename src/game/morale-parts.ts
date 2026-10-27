/**
 * WHAT A KIND'S MORALE IS MADE OF, part by part: what the tick drifts it
 * toward and what the Morale panel shows, from the one place.
 *  - HOME: the morale of the houses they live in (the map's say);
 *  - WORK: the policies they are run by;
 *  - LEADERS: their leader's personality and perks, in full for their team and
 *    half for the rest, and every leader's Culture Carrier;
 *  - EVENTS: hackathons, floods, the AI's memos, felt for a day;
 *  - FOUNDER: traits fused into the founder, a lean on everyone.
 * @see game/satisfaction, tickSatisfaction, MoralePanel
 */
import type { GeneratorId } from "../state/generators.store";
import { fusionNow } from "./fusion";
import { moraleOffsets } from "./morale";
import type { PolicyId } from "./policies";
import { clampScore, satisfactionTargetForRole } from "./satisfaction";
import type { leadersNow } from "./leader-economy";
import { townMoodOffsets } from "./town-mood";

export type MoralePart = "home" | "work" | "leaders" | "events" | "founder";
export type MoraleParts = Record<MoralePart, number>;

/** The parts in the order they are shown. */
export const MORALE_PARTS: readonly MoralePart[] = ["home", "work", "leaders", "events", "founder"];

/** Every kind's parts now, given its policies and what the leaders do now. */
export function moralePartsNow(
  policies: Record<GeneratorId, readonly PolicyId[]>,
  led: ReturnType<typeof leadersNow> = { of: {}, everyone: 0 },
): Record<GeneratorId, MoraleParts> {
  const home = townMoodOffsets(), events = moraleOffsets();
  const founder = fusionNow().moraleLean;
  const out = {} as Record<GeneratorId, MoraleParts>;
  for (const id of ["intern", "vibe_coder", "10x_dev"] as GeneratorId[]) {
    out[id] = {
      home: home[id] ?? 0,
      work: satisfactionTargetForRole(policies[id] ?? []),
      leaders: (led.of[id]?.morale ?? 0) + led.everyone,
      events: events[id] ?? 0,
      founder,
    };
  }
  return out;
}

/** Where the parts take morale: their sum, within its range. */
export const moraleTarget = (p: MoraleParts): number => clampScore(MORALE_PARTS.reduce((n, k) => n + p[k], 0));

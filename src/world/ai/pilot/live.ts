/**
 * World v2 — THE PILOT, IN THE GAME: its purse read off the stores, and the
 * desks it sits at. The pilot itself holds no store. @see createPilot
 */
import { useGeneratorStore } from "../../../state/generators.store";
import { useInnovationStore } from "../../../state/innovation.store";
import { useMoneyStore } from "../../../state/money.store";
import { useWorldStore } from "../../../state/world.store";
import type { Purse } from "./chooser";
import { cultureDesk } from "./desks/culture";
import { eventsDesk } from "./desks/events";
import { harbourDesk } from "./desks/harbour";
import { landmarksDesk, owedOnSites } from "./desks/landmarks";
import { machineDesk } from "./desks/machine";
import { peopleDesk } from "./desks/people";
import { townDesk } from "./desks/town";
import { waterDesk } from "./desks/water";
import type { Desk } from "./pilot";

/** What the company has to spend now, and how fast it comes in; `reserveSeconds` of its income kept back. */
export function livePurse(reserveSeconds = 0): Purse {
  const gens = useGeneratorStore.getState(), income = gens.getMoneyPerSecond();
  // THE RESERVE, as so many seconds of income: a sum that grows with the company.
  const reserve = Math.max(0, reserveSeconds) * income;
  return {
    money: useMoneyStore.getState().money.toNumber(),
    income,
    // And what a site under way still owes for its loads: spent elsewhere, the site stalls. @see owedOnSites
    reserve: reserve + owedOnSites(useWorldStore.getState().grid),
    innovation: useInnovationStore.getState().innovation.toNumber(),
    innovationRate: gens.getInnovationPerSecond(),
  };
}

/** Every desk. */
export const allDesks = (): Desk[] => [peopleDesk(), townDesk(), landmarksDesk(), waterDesk(), harbourDesk(), cultureDesk(), machineDesk(), eventsDesk()];

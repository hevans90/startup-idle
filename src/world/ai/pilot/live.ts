/**
 * World v2 — THE PILOT, IN THE GAME: its purse read off the stores, and the
 * desks it sits at. The pilot itself holds no store. @see createPilot
 */
import { useGeneratorStore } from "../../../state/generators.store";
import { useInnovationStore } from "../../../state/innovation.store";
import { useMoneyStore } from "../../../state/money.store";
import { useWorldStore } from "../../../state/world.store";
import type { Purse } from "./chooser";
import { landmarksDesk, owedOnSites } from "./desks/landmarks";
import { peopleDesk } from "./desks/people";
import { townDesk } from "./desks/town";
import { waterDesk } from "./desks/water";
import type { Desk } from "./pilot";

/** What the company has to spend now, and how fast it comes in. */
export function livePurse(reserve = 0): Purse {
  const gens = useGeneratorStore.getState();
  return {
    money: useMoneyStore.getState().money.toNumber(),
    income: gens.getMoneyPerSecond(),
    // And what a site under way still owes for its loads: spent elsewhere, the site stalls. @see owedOnSites
    reserve: reserve + owedOnSites(useWorldStore.getState().grid),
    innovation: useInnovationStore.getState().innovation.toNumber(),
    innovationRate: gens.getInnovationPerSecond(),
  };
}

/** Every desk built so far. */
export const allDesks = (): Desk[] => [peopleDesk(), townDesk(), landmarksDesk(), waterDesk()];

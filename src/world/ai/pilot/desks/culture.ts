/**
 * World v2 — THE PILOT'S CULTURE DESK: what a player does on the Innovation
 * and Employees tabs that is not a hire or an upgrade.
 *
 *  - THE DECK AND THE LEADERS, a step at a time, as the kept planner plays
 *    them: a card taken and slotted, a slot or a rank bought with points, a
 *    job posted, an applicant checked and hired, a leader placed, a perk.
 *  - A MANAGER ASSIGNED, to whichever of the three has fewest, when the next
 *    costs little of the innovation in hand: innovation is itself a
 *    multiplier on everything, and is not spent down for a manager.
 *  - A MANDATE BOUGHT, the one that pays most for its price, with valuation
 *    that buys nothing else.
 * @see peopleMove, plans/ai-mode-rebuild.md phase 5
 */
import { featureGateOpen } from "../../../../game/projects";
import { ManagerKeyValues, nextManagerCost, useInnovationStore, type ManagerKeys } from "../../../../state/innovation.store";
import { MANDATES, useValuationStore, type MandateDef } from "../../../../state/valuation.store";
import { useWorldStore } from "../../../../state/world.store";
import { peopleMove } from "../../autopilot-people";
import { townStyle } from "./town";
import type { Purse } from "../chooser";
import type { Job } from "../job";
import type { Desk } from "../pilot";

/** The most of the innovation in hand the next manager may cost. */
export const MANAGER_SHARE = 0.05;
/** What a step of the deck's, a manager, or a mandate that multiplies no money is taken to be worth, as a share of income: enough to be done. */
const STEP_WORTH = 0.01;

const MANAGER_NAME: Record<ManagerKeys, string> = { agile: "an agile", corpo: "a corporate", sales: "a sales" };

/** What a level of a mandate is worth, as a share of income. */
const worthOf = (m: MandateDef) => Math.max(STEP_WORTH, m.moneyMultPerLevel + (m.innovationMultPerLevel + (m.synergyMultPerLevel ?? 0) + (m.equityBoostPerLevel ?? 0)) * 0.3);

export function cultureDesk(): Desk {
  const propose = (purse: Purse): Job[] => {
    const g = useWorldStore.getState().grid;
    const jobs: Job[] = [];
    const worth = Math.max(purse.income, 1) * STEP_WORTH;

    // THE DECK AND THE LEADERS: the next step, if there is one.
    // Only the Model leans by its fused traits; another founder's pilot is plain. @see townStyle
    const move = peopleMove(g, townStyle().tall);
    if (move) {
      jobs.push({
        id: `culture:${move.id}`, desk: "culture", says: move.plan, why: "the culture, played to its style",
        cost: 0, gain: worth,
        run: () => (move.run() ? { ok: true } : { ok: false, because: "it could not be done", retry: 30 }),
      });
    }

    // A MANAGER, to the one with fewest.
    const inn = useInnovationStore.getState();
    if (inn.unlocks.managers?.unlocked) {
      const key = [...ManagerKeyValues].sort((a, b) => inn.managers[a].assignment.cmp(inn.managers[b].assignment))[0];
      const cost = nextManagerCost(key).toNumber();
      if (cost <= purse.innovation * MANAGER_SHARE) {
        jobs.push({
          id: `manager:${key}`, desk: "culture", says: `Assign ${MANAGER_NAME[key]} manager`, why: "its tiers multiply for good",
          cost, costs: "innovation", gain: worth,
          run: () => {
            const before = useInnovationStore.getState().managers[key].assignment;
            useInnovationStore.getState().setAssignment(1);
            useInnovationStore.getState().assignManager(key);
            return useInnovationStore.getState().managers[key].assignment.gt(before) ? { ok: true } : { ok: false, because: "not enough innovation", retry: 10 };
          },
        });
      }
    }

    // A MANDATE: of those the valuation in hand buys, the best for its price.
    const val = useValuationStore.getState();
    if (featureGateOpen("mandates")) {
      const best = MANDATES.filter((m) => val.canAffordMandate(m.id))
        .sort((a, b) => worthOf(b) / val.getMandateCost(b.id).toNumber() - worthOf(a) / val.getMandateCost(a.id).toNumber())[0];
      if (best) {
        jobs.push({
          id: `mandate:${best.id}`, desk: "culture", says: `Pass the ${best.name} mandate`, why: best.description,
          cost: 0, gain: Math.max(purse.income, 1) * worthOf(best),
          run: () => {
            const before = useValuationStore.getState().mandateLevels[best.id];
            useValuationStore.getState().purchaseMandate(best.id);
            return useValuationStore.getState().mandateLevels[best.id] > before ? { ok: true } : { ok: false, because: "the board would not pass it", retry: 10 };
          },
        });
      }
    }
    return jobs;
  };
  return { id: "culture", propose };
}

/**
 * World v2 — where the projects on the map meet the game's economy: whose
 * hands there are to build with, the money a load is paid from, and the news
 * when a project opens. Kept apart from `works` so that stays testable with a
 * wallet of its own. @see stepWorks
 */

import { projectDef, type ProjectId } from "../../game/projects";
import { report } from "../../state/comms.store";
import { syncUnlockedGenerators, useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { useMoneyStore } from "../../state/money.store";

/** Employees of each kind the company has. */
export function ownedNow(): Partial<Record<GeneratorId, number>> {
  const out: Partial<Record<GeneratorId, number>> = {};
  for (const g of useGeneratorStore.getState().generators) out[g.id as GeneratorId] = g.amount;
  return out;
}

/**
 * The company's income a second, as the economy reports it: what a project
 * chosen now is priced off. @see projectCost
 */
export const incomeNow = (): number => useGeneratorStore.getState().getMoneyPerSecond();

/** Pay for a load out of the company's money, if it has it. */
export function payForLoad(amount: number): boolean {
  const m = useMoneyStore.getState();
  if (m.money.lt(amount)) return false;
  m.spendMoney(amount);
  return true;
}

/** Tell the player what opened, and let the economy see it at once. */
export function announceOpened(ids: readonly ProjectId[]): void {
  syncUnlockedGenerators();
  for (const id of ids) {
    const p = projectDef(id);
    if (!p) continue;
    // What it grants the Innovation tab, opened. @see grantFeatures
    useInnovationStore.getState().grantFeatures(p.grants);
    const news = p.unlocks ? " New hires are available."
      : p.grants === "managers" ? " Managers and employee management are open on the Innovation tab."
        : p.grants === "services" ? " You can now build cafés, parks and gyms."
          : p.grants === "ports" ? " You can now build seaports." : "";
    report(`${p.name} has opened.${news}`, { title: "Opened" });
  }
}

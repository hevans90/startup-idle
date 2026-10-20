/**
 * World v2 — what each workplace's people earned, for the "+$X" rising off it.
 * @see PortIncome
 */
import { useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { getNetwork, useWorldStore } from "../../state/world.store";
import { liveSeating, workplaceKind } from "../agents/commute";

/**
 * What each workplace's people earned in `ms`: their kind's income, shared
 * out by the desks taken at each. @see liveSeating
 */
export function payday(ms: number): { structure: number; amount: number }[] {
  const st = useWorldStore.getState(), net = getNetwork();
  if (!net || !st.playing) return [];
  const desks = liveSeating(st.grid, net).desks;
  const gens = useGeneratorStore.getState();
  const seated: Partial<Record<GeneratorId, number>> = {};
  for (const [id, d] of desks) {
    const who = workplaceKind(st.grid.structures.get(id)?.def ?? "");
    if (who) seated[who] = (seated[who] ?? 0) + d.used;
  }
  // Each kind's income worked out ONCE: it is the whole multiplier chain, and
  // asked again for every workplace it held a big town's page for a tenth of a second.
  const rate: Partial<Record<GeneratorId, number>> = {};
  for (const who of Object.keys(seated) as GeneratorId[]) {
    const owned = gens.generators.find((g) => g.id === who)?.amount ?? 0;
    rate[who] = gens.getGeneratorMoneyPerSecond(who, owned);
  }
  const out: { structure: number; amount: number }[] = [];
  for (const [id, d] of desks) {
    const who = workplaceKind(st.grid.structures.get(id)?.def ?? "");
    const all = who ? seated[who] ?? 0 : 0;
    if (!who || !d.used || !all) continue;
    const amount = (rate[who] ?? 0) * (d.used / all) * (ms / 1000);
    if (amount > 0) out.push({ structure: id, amount });
  }
  return out;
}


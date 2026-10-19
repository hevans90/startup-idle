/**
 * THE UPGRADES ON OFFER: within a generator's set only the next — the
 * cheapest available — is shown, so a set reveals one at a time. What the
 * Employees tab offers, and so all AI mode may buy. @see Upgrades, autopilot
 */
import type { Upgrade } from "../state/upgrades.store";

/** Which progression set an upgrade belongs to, by its id's prefix. */
export const upgradeSet = (u: Pick<Upgrade, "id">): string => {
  if (u.id.startsWith("10x_dev")) return "10x_dev";
  if (u.id.startsWith("vibe_coder")) return "vibe_coder";
  if (u.id.startsWith("cross")) return "cross";
  if (u.id.startsWith("intern")) return "intern";
  return u.id;
};

/** The cheapest available upgrade of each set. `available` comes cost-sorted ascending. */
export const nextPerSet = (available: readonly Upgrade[]): Upgrade[] => {
  const seen = new Set<string>();
  const out: Upgrade[] = [];
  for (const u of available) {
    const set = upgradeSet(u);
    if (seen.has(set)) continue;
    seen.add(set);
    out.push(u);
  }
  return out;
};

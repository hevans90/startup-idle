/**
 * World v2 — what a project's gate is met by, and the links from a gate to
 * the upgrade it waits on. @see game/projects Gate, gate-chips
 */
import { PROJECTS, type ProjectDef } from "../../game/projects";
import type { GeneratorId } from "../../state/generators.store";
import { useGlobalSettingsStore } from "../../state/global-settings.store";
import { useInnovationStore } from "../../state/innovation.store";
import { UPGRADES, useUpgradeStore, type Upgrade } from "../../state/upgrades.store";

/** One of a kind, or many. */
export const KIND: Record<GeneratorId, [string, string]> = {
  intern: ["intern", "interns"], vibe_coder: ["vibe coder", "vibe coders"], "10x_dev": ["10x dev", "10x devs"],
};
export const kindName = (who: GeneratorId, n: number) => `${n} ${KIND[who][n === 1 ? 0 : 1]}`;
export const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** The innovation unlocks had, and the upgrades bought: what a gate is met by. */
export function gateUnlocksNow(): Set<string> {
  const unlocks = useInnovationStore.getState().unlocks;
  const out = new Set(Object.entries(unlocks).filter(([, u]) => u?.unlocked).map(([k]) => k));
  for (const id of useUpgradeStore.getState().unlockedUpgradeIds) out.add(id);
  return out;
}

/** The same, kept up to date in a component. */
export function useGateUnlocks(): Set<string> {
  const unlocks = useInnovationStore((s) => s.unlocks);
  const bought = useUpgradeStore((s) => s.unlockedUpgradeIds);
  const out = new Set(Object.entries(unlocks).filter(([, u]) => u?.unlocked).map(([k]) => k));
  for (const id of bought) out.add(id);
  return out;
}

export const upgradeOf = (id: string): Upgrade | null => UPGRADES.find((u) => u.id === id) ?? null;

/** The projects an upgrade opens the way to. */
export const projectsGatedBy = (upgrade: string): ProjectDef[] => PROJECTS.filter((p) => p.gate.upgrade === upgrade);

/**
 * GO AND BUY IT: the Employees tab, where the upgrades are — and, on a phone,
 * the Company side, where the tabs are. @see App
 */
export function showUpgrades() {
  useGlobalSettingsStore.getState().setSidebarTab("employees");
  window.dispatchEvent(new CustomEvent("startup:show-company"));
}


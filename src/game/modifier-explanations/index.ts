export type { BreakdownRow, ModifierBreakdown } from "./types";

import type { ModifierBreakdown } from "./types";
import { entries as innovationEntries } from "./innovation";
import { entries as managersEntries } from "./managers";
import { entries as mandatesEntries } from "./mandates";
import { entries as vapeEntries } from "./vape";
import { entries as founderEntries } from "./founder";
import { entries as prestigeEntries } from "./prestige";
import { entries as satisfactionEntries } from "./satisfaction";
import { entries as unifiedEntries } from "./unified";
import { entries as teamLeadersEntries } from "./team-leaders";

const REGISTRY: Record<string, () => ModifierBreakdown> = {
  ...innovationEntries,
  ...managersEntries,
  ...mandatesEntries,
  ...vapeEntries,
  ...founderEntries,
  ...prestigeEntries,
  ...satisfactionEntries,
  ...unifiedEntries,
  ...teamLeadersEntries,
};

export function getModifierBreakdown(key: string): ModifierBreakdown | null {
  return REGISTRY[key]?.() ?? null;
}

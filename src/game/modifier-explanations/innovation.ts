import { useFounderStore } from "../../state/founder.store";
import { useInnovationStore } from "../../state/innovation.store";
import type { BreakdownRow, ModifierBreakdown } from "./types";
import { fmt2 } from "./utils";

const innovRef = (i: number) => `×${(1 + Math.log10(i + 1)).toFixed(0)}`;

export const entries: Record<string, () => ModifierBreakdown> = {
  innovationCurve: () => {
    const innov = useInnovationStore.getState();
    const founder = useFounderStore.getState();
    const total = innov.getMultiplier().toNumber();
    const innovTotal = innov.innovation.toNumber();
    const rows: BreakdownRow[] = [
      {
        source: `1 + log₁₀(${innovTotal.toFixed(0)} + 1)`,
        value: fmt2(total),
        tone: "good",
      },
    ];
    if (founder.innovationLogMult !== 1)
      rows.push({
        source: `Founder steepens curve ×${founder.innovationLogMult.toFixed(1)}`,
        value: "",
        tone: "good",
      });
    return {
      label: "Innovation curve",
      description: `Logarithmic:\n1k I → ${innovRef(1e3)}, 1M I → ${innovRef(1e6)}, 1B I → ${innovRef(1e9)}.`,
      rows,
      total: fmt2(total),
    };
  },
};

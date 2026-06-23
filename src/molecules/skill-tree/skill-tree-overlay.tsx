import { IconX } from "@tabler/icons-react";
import { useEffect } from "react";
import { usePrestigeStore } from "../../state/prestige.store";
import { Button } from "../../ui/Button";
import { isLocalDev } from "../../utils/dev-mode";
import { formatCurrency } from "../../utils/money-utils";
import { SkillTreeCanvas } from "./skill-tree-canvas";
import { SkillTreeTooltip } from "./skill-tree-tooltip";

/**
 * Full-screen acquisition skill tree. Lives in its own viewport so the tree has
 * room to breathe (a 1/3-width sidebar is too cramped for a PoE-style tree).
 * Close with the corner ✕ or the Esc key.
 */
export const SkillTreeOverlay = ({ onClose }: { onClose: () => void }) => {
  const equity = usePrestigeStore((s) => s.equity);
  const exits = usePrestigeStore((s) => s.exits);
  const allocated = usePrestigeStore((s) => s.allocated.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-primary-900 text-primary-100">
      <div className="flex shrink-0 items-center justify-between border-b border-primary-700 px-4 py-2">
        <div className="flex items-center gap-6 text-sm tabular-nums">
          <span>
            <span className="opacity-60">Equity</span>{" "}
            <span className="font-bold">
              {formatCurrency(equity, { showDollarSign: false })}
            </span>
          </span>
          <span className="opacity-60">Exits {exits}</span>
          <span className="opacity-60">Allocated {allocated}</span>
        </div>
        <div className="flex items-center gap-2">
          {isLocalDev() && (
            <Button
              className="text-xs"
              onClick={() => usePrestigeStore.getState().grantEquity(10)}
            >
              +10 Equity (dev)
            </Button>
          )}
          <button
            type="button"
            aria-label="Close skill tree"
            title="Close (Esc)"
            onClick={onClose}
            className="rounded p-1.5 text-primary-300 hover:bg-primary-700 hover:text-primary-50"
          >
            <IconX size={20} />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <SkillTreeCanvas />
        <SkillTreeTooltip />
      </div>
    </div>
  );
};

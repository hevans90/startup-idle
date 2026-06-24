import { IconSearch, IconX } from "@tabler/icons-react";
import { useEffect } from "react";
import { usePrestigeStore, RESPECS_PER_EXIT } from "../../state/prestige.store";
import { useSkillTreeUiStore } from "../../state/skill-tree-ui.store";
import { Button } from "../../ui/Button";
import { isLocalDev } from "../../utils/dev-mode";
import { formatCurrency } from "../../utils/money-utils";
import { SkillTreeBonuses } from "./skill-tree-bonuses";
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
  const respecPoints = usePrestigeStore((s) => s.respecPoints);
  const allocated = usePrestigeStore((s) => s.allocated.length);
  const respecMode = useSkillTreeUiStore((s) => s.respecMode);
  const search = useSkillTreeUiStore((s) => s.search);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc clears an active search first, otherwise closes the tree.
      if (useSkillTreeUiStore.getState().search) {
        useSkillTreeUiStore.getState().setSearch("");
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Reset transient UI (respec mode, search, hover spotlight) when the tree closes.
  useEffect(
    () => () => {
      const ui = useSkillTreeUiStore.getState();
      ui.setRespecMode(false);
      ui.setSearch("");
      ui.setHighlightIds([]);
    },
    [],
  );

  // Drop out of respec mode when you run out of points (the toggle is disabled,
  // so this avoids getting stuck in it).
  useEffect(() => {
    if (respecPoints < 1 && respecMode) {
      useSkillTreeUiStore.getState().setRespecMode(false);
    }
  }, [respecPoints, respecMode]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-primary-50 text-primary-900 dark:bg-primary-900 dark:text-primary-100">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-primary-300 px-4 py-2 dark:border-primary-700">
        <div className="flex items-center gap-6 text-sm tabular-nums">
          <span>
            <span className="opacity-60">Equity</span>{" "}
            <span className="font-bold">
              {formatCurrency(equity, { showDollarSign: false })}
            </span>
          </span>
          <span className="opacity-60">Exits {exits}</span>
          <span className="opacity-60">Allocated {allocated}</span>
          <span>
            <span className="opacity-60">Respecs</span>{" "}
            <span className="font-bold text-rose-500 dark:text-rose-400">{respecPoints}</span>
          </span>
        </div>

        <div className="relative">
          <IconSearch
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-primary-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => useSkillTreeUiStore.getState().setSearch(e.target.value)}
            placeholder="Search passives…"
            aria-label="Search passives"
            className="w-56 rounded-md border border-primary-300 bg-primary-100/80 py-1 pl-8 pr-7 text-xs text-primary-900 outline-none placeholder:text-primary-400 focus:border-cyan-500 dark:border-primary-700 dark:bg-primary-800/80 dark:text-primary-100"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => useSkillTreeUiStore.getState().setSearch("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-primary-400 hover:text-primary-700 dark:hover:text-primary-100"
            >
              <IconX size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            className="text-xs"
            disabled={exits < 1}
            onClick={() => usePrestigeStore.getState().buyRespecs()}
          >
            Buy {RESPECS_PER_EXIT} respecs (1 Exit)
          </Button>
          <Button
            disabled={respecPoints < 1}
            title={respecPoints < 1 ? "Buy respec points with an Exit first" : undefined}
            className={
              respecMode
                ? "text-xs ring-2 ring-rose-500 bg-rose-500/20 dark:ring-rose-400"
                : "text-xs"
            }
            onClick={() =>
              useSkillTreeUiStore.getState().setRespecMode(!respecMode)
            }
          >
            {respecMode ? "Respeccing…" : "Respec"}
          </Button>
          {isLocalDev() && (
            <Button
              className="text-xs"
              onClick={() => usePrestigeStore.getState().grantEquity(50)}
            >
              +50 Equity (dev)
            </Button>
          )}
          <button
            type="button"
            aria-label="Close skill tree"
            title="Close (Esc)"
            onClick={onClose}
            className="rounded p-1.5 text-primary-500 hover:bg-primary-200 hover:text-primary-900 dark:text-primary-300 dark:hover:bg-primary-700 dark:hover:text-primary-50"
          >
            <IconX size={20} />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <SkillTreeCanvas />
        <SkillTreeTooltip />
        <SkillTreeBonuses />
        {respecMode && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-rose-500/20 px-3 py-1 text-xs text-rose-700 ring-1 ring-rose-400/50 dark:text-rose-200">
            Respec mode — click an allocated node to refund it and everything past it (1 respec point each)
          </div>
        )}
      </div>
    </div>
  );
};

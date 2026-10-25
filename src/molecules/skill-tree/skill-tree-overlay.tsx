import { IconSearch, IconX } from "@tabler/icons-react";
import { useEffect } from "react";
import { usePrestigeStore, RESPECS_PER_EXIT } from "../../state/prestige.store";
import { useGenerationStore } from "../../state/generation.store";
import { useSkillTreeUiStore } from "../../state/skill-tree-ui.store";
import { twMerge } from "tailwind-merge";
import { Button, FOCUS, Frame, IconButton, Label, Num, Text } from "../../ui/console";
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
  // THE MACHINE's currency, once there is a Machine to spend it in. @see game/machine
  const weights = useGenerationStore((s) => s.weights);
  const ascended = useGenerationStore((s) => s.generation > 1);
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
    <div role="dialog" aria-modal="true" aria-label="The acquisition tree" className="fixed inset-0 z-50 flex flex-col bg-surface-0 text-fg">
      {/* THE HEADER: what there is to spend, the search, respec, and the way out. */}
      <div className="relative flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-2">
        <Frame kind="underline" assemble="auto" className="pointer-events-none absolute inset-x-0 bottom-0 h-2" />
        <div className="flex items-center gap-5 text-sm">
          <Text as="h2" text="Acquisition tree" className="font-display uppercase tracking-wider" />
          <span><Label>Equity</Label> <Num className="font-display text-base text-valuation">{formatCurrency(equity, { showDollarSign: false })}</Num></span>
          <span><Label>Exits</Label> <Num>{exits}</Num></span>
          <span><Label>Allocated</Label> <Num>{allocated}</Num></span>
          <span><Label>Respecs</Label> <Num className="text-bad">{respecPoints}</Num></span>
          {ascended && (
            <span title="Spent in the Machine, the AI's cluster below the tree">
              <Label>Weights</Label> <Num role="weights" className="font-display text-base">{weights}</Num>
            </span>
          )}
        </div>

        <div className="relative">
          <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => useSkillTreeUiStore.getState().setSearch(e.target.value)}
            placeholder="Search passives…"
            aria-label="Search passives"
            className={twMerge("w-56 border border-line bg-surface-1 py-1 pl-8 pr-7 text-xs text-fg placeholder:text-fg-faint focus:border-console", FOCUS)}
          />
          {search && (
            <IconButton label="Clear search" className="absolute right-0.5 top-1/2 -translate-y-1/2" onClick={() => useSkillTreeUiStore.getState().setSearch("")}>
              <IconX size={14} />
            </IconButton>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" disabled={exits < 1} onClick={() => usePrestigeStore.getState().buyRespecs()}>
            Buy {RESPECS_PER_EXIT} respecs (1 Exit)
          </Button>
          <Button size="sm" variant={respecMode ? "danger" : "secondary"} aria-pressed={respecMode}
            disabled={respecPoints < 1}
            title={respecPoints < 1 ? "Buy respec points with an Exit first" : undefined}
            className={respecMode ? "bg-bad-soft" : undefined}
            onClick={() => useSkillTreeUiStore.getState().setRespecMode(!respecMode)}>
            {respecMode ? "Respeccing…" : "Respec"}
          </Button>
          <IconButton label="Close the tree (Esc)" onClick={onClose}><IconX size={20} /></IconButton>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <SkillTreeCanvas />
        <SkillTreeTooltip />
        <SkillTreeBonuses />
        {respecMode && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 border border-bad-line bg-bad-soft px-3 py-1 text-xs text-bad">
            Respec mode — click an allocated node to refund it and everything past it (1 respec point each)
          </div>
        )}
      </div>
    </div>
  );
};

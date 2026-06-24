import { useLayoutEffect, useRef } from "react";
import { nodeById, pathEquityCost, SKILL_TREE } from "../../game/skill-tree";
import { usePrestigeStore } from "../../state/prestige.store";
import { useSkillTreeUiStore } from "../../state/skill-tree-ui.store";

const NODES = nodeById(SKILL_TREE);
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/**
 * HTML preview for the skill-tree node under the cursor. The renderer publishes
 * the hovered node + its on-screen anchor each frame (so it tracks pan/zoom);
 * this reads that plus live allocation state. Pointer-events off so it never
 * steals hover from the canvas.
 */
export const SkillTreeTooltip = () => {
  const hovered = useSkillTreeUiStore((s) => s.hovered);
  const previewPath = useSkillTreeUiStore((s) => s.previewPath);
  const respecMode = useSkillTreeUiStore((s) => s.respecMode);
  const allocated = usePrestigeStore((s) => s.allocated);
  const equity = usePrestigeStore((s) => s.equity);
  const respecPoints = usePrestigeStore((s) => s.respecPoints);
  const ref = useRef<HTMLDivElement>(null);

  // Keep the card inside the canvas bounds (it's positioned absolutely within
  // the overlay body, same origin as the Pixi viewport's toScreen output).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !hovered) return;
    const parent = el.offsetParent as HTMLElement | null;
    const pw = parent?.clientWidth ?? window.innerWidth;
    const ph = parent?.clientHeight ?? window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const pad = 8;
    const x = clamp(hovered.x, w / 2 + pad, pw - w / 2 - pad);
    const y = clamp(hovered.y - 16, h + pad, ph - pad);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });

  if (!hovered) return null;
  const node = NODES.get(hovered.id);
  if (!node) return null;

  const isAllocated = allocated.includes(node.id);
  const nextCost = usePrestigeStore.getState().getNextCost();
  const affordable = equity.gte(nextCost);
  // Multi-step route to a node you can't reach directly yet.
  const onPathToHere = previewPath.length > 1 && previewPath[previewPath.length - 1] === node.id;
  const routeCost = onPathToHere ? pathEquityCost(allocated.length, previewPath.length) : 0;
  const routeAffordable = equity.gte(routeCost);
  // Respec mode: previewPath is the subtree this node's refund would remove.
  const refundCount =
    respecMode && isAllocated && previewPath[0] === node.id ? previewPath.length : 0;
  const enoughPoints = respecPoints >= refundCount;

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 w-52 -translate-x-1/2 -translate-y-full"
      style={{ left: hovered.x, top: hovered.y - 16 }}
    >
      <div className="rounded-md border border-primary-500 bg-primary-100/95 px-3 py-2 text-primary-900 shadow-lg backdrop-blur-sm dark:bg-primary-800/95 dark:text-primary-100">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold">{node.title}</span>
          <span className="text-[10px] uppercase tracking-wide opacity-50">
            {node.kind}
          </span>
        </div>

        <p className="mt-1 text-xs opacity-70">
          {node.effect ?? "Effect — coming soon"}
        </p>

        <div className="mt-2 border-t border-primary-400/40 pt-1.5 text-xs tabular-nums dark:border-primary-600/50">
          {refundCount > 0 ? (
            <span
              className={
                enoughPoints
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-amber-600 dark:text-amber-400"
              }
            >
              Refund: {refundCount} {refundCount === 1 ? "node" : "nodes"} ·{" "}
              {refundCount} {refundCount === 1 ? "pt" : "pts"}
              {enoughPoints ? "" : ` (only ${respecPoints})`}
            </span>
          ) : isAllocated ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              ✓ Allocated
            </span>
          ) : onPathToHere ? (
            <span
              className={
                routeAffordable
                  ? "text-sky-600 dark:text-sky-400"
                  : "text-rose-600 dark:text-rose-400"
              }
            >
              Reach: {previewPath.length} nodes · {routeCost} Equity
              {routeAffordable ? "" : " (can't afford)"}
            </span>
          ) : (
            <span
              className={
                affordable
                  ? "text-primary-800 dark:text-primary-100"
                  : "text-rose-600 dark:text-rose-400"
              }
            >
              Cost: {nextCost} Equity{affordable ? "" : " (can't afford)"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

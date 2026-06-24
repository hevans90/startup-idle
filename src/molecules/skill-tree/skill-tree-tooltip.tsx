import { useLayoutEffect, useRef } from "react";
import {
  aggregateGrants,
  buildAdjacency,
  type EffectRow,
  frontierPath,
  type KeystoneSpecial,
  nodeById,
  nodeEffectRows,
  nodesToRemove,
  pathEquityCost,
  SKILL_TREE,
  specialEffectRow,
  STAT_META,
} from "../../game/skill-tree";
import { usePrestigeStore } from "../../state/prestige.store";
import { useSkillTreeUiStore } from "../../state/skill-tree-ui.store";

const NODES = nodeById(SKILL_TREE);
const ADJ = buildAdjacency(SKILL_TREE);
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${Number(v.toFixed(1))}%`;
const toneClass = (tone: "good" | "bad") =>
  tone === "good"
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";

/**
 * HTML preview for the skill-tree node under the cursor. The renderer publishes
 * the hovered node + its on-screen anchor each frame (so it tracks pan/zoom);
 * this reads that plus live allocation state. Pointer-events off so it never
 * steals hover from the canvas.
 */
export const SkillTreeTooltip = () => {
  const hovered = useSkillTreeUiStore((s) => s.hovered);
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
    // Clear the node's on-screen disc (scales with zoom) plus a small margin.
    const gap = hovered.r + 12;
    const x = clamp(hovered.x, w / 2 + pad, pw - w / 2 - pad);
    // Decide above/below from the NODE position only — not the tooltip height,
    // which grows a frame later as the route-gains content arrives (that was
    // causing an above→below flip flicker). Height is only used to clamp.
    const above = hovered.y - hovered.r > ph * 0.4;
    const top = above
      ? Math.max(hovered.y - gap, h + pad)
      : Math.min(hovered.y + gap, ph - pad - h);
    el.style.left = `${x}px`;
    el.style.top = `${top}px`;
    el.style.transform = above ? "translate(-50%, -100%)" : "translate(-50%, 0)";
  });

  if (!hovered) return null;
  const node = NODES.get(hovered.id);
  if (!node) return null;

  const effectRows = nodeEffectRows(node);
  const isAllocated = allocated.includes(node.id);
  const nextCost = usePrestigeStore.getState().getNextCost();
  const affordable = equity.gte(nextCost);

  // Compute the previewed route HERE (not from the store) so it's present on the
  // same frame as the base bonuses — the renderer publishes its copy a frame
  // later, which made the route-gains section pop in and flicker.
  const allocatedSet = new Set(allocated);
  const routePath = respecMode
    ? nodesToRemove(SKILL_TREE, allocatedSet, node.id, ADJ) // refund subtree
    : isAllocated
      ? []
      : frontierPath(SKILL_TREE, allocatedSet, node.id, ADJ); // path to reach it

  // Multi-step route to a node you can't reach directly yet.
  const onPathToHere = !respecMode && routePath.length > 1;
  const routeCost = onPathToHere ? pathEquityCost(allocated.length, routePath.length) : 0;
  const routeAffordable = equity.gte(routeCost);
  // Route gains account for EVERY multiplier on the path (minors, travel,
  // notables, keystones), plus the keystones' structural reshapes — so there's
  // no separate node list needed.
  const routeTotals = onPathToHere
    ? aggregateGrants(routePath.flatMap((id) => NODES.get(id)?.grants ?? []))
    : [];
  const routeStructural: EffectRow[] = onPathToHere
    ? [
        ...new Set(
          routePath
            .map((id) => NODES.get(id)?.special)
            .filter((s): s is KeystoneSpecial => !!s),
        ),
      ].map(specialEffectRow)
    : [];
  // Respec mode: routePath is the subtree this node's refund would remove.
  const refundCount = respecMode ? routePath.length : 0;
  const enoughPoints = respecPoints >= refundCount;

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 w-52"
      style={{
        left: hovered.x,
        top: hovered.y - hovered.r - 12,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="rounded-md border border-primary-500 bg-primary-100/95 px-3 py-2 text-primary-900 shadow-lg backdrop-blur-sm dark:bg-primary-800/95 dark:text-primary-100">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold">{node.title}</span>
          <span className="text-[10px] uppercase tracking-wide opacity-50">
            {node.kind}
          </span>
        </div>

        {effectRows.length > 0 ? (
          <div className="mt-1 flex flex-col gap-0.5 text-xs">
            {effectRows.map((row, i) => (
              <span key={i} className={toneClass(row.tone)}>
                {row.label}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs opacity-60">Pathway node — no bonus</p>
        )}

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
              Reach: {routePath.length} nodes · {routeCost} Equity
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

        {(routeTotals.length > 0 || routeStructural.length > 0) && (
          <div className="mt-2 border-t border-primary-400/40 pt-1.5 dark:border-primary-600/50">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-cyan-600 dark:text-cyan-400">
              Route gains
            </p>
            <div className="flex flex-col gap-0.5 text-[11px] tabular-nums">
              {routeTotals.map((t) => {
                const meta = STAT_META[t.stat];
                const pctGood = meta.good === "up" ? t.pct >= 0 : t.pct <= 0;
                const multGood = meta.good === "up" ? t.mult >= 1 : t.mult <= 1;
                return (
                  <div key={t.stat} className="flex items-baseline justify-between gap-2">
                    <span className="opacity-70">{meta.label}</span>
                    <span className="flex items-baseline gap-1 font-semibold">
                      {t.pct !== 0 && (
                        <span className={toneClass(pctGood ? "good" : "bad")}>
                          {fmtPct(t.pct)}
                        </span>
                      )}
                      {t.mult !== 1 && (
                        <span className={toneClass(multGood ? "good" : "bad")}>
                          ×{Number(t.mult.toFixed(2))}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
              {routeStructural.map((row, i) => (
                <div key={`s${i}`} className={`font-semibold ${toneClass(row.tone)}`}>
                  {row.label}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

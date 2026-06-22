import { useLayoutEffect, useRef } from "react";
import { useGeneratorStore } from "../state/generators.store";
import { useOfficeStore } from "../state/office.store";
import { formatCurrency } from "../utils/money-utils";
import { formatRate } from "../utils/rate-utils";

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/**
 * HTML tooltip that floats over the building under the cursor on the Pixi map.
 * The hovered building + its on-screen anchor are published to the office store
 * each frame by the renderer (so it tracks pan/zoom); here we just read that and
 * the live per-type economics. Pointer-events are off so it never steals hover.
 */
export const CityHoverPopover = () => {
  const hovered = useOfficeStore((s) => s.hovered);
  // Re-renders every frame while hovering (anchor updates), so reading the live
  // economics imperatively here is always fresh.
  useGeneratorStore((s) => s.generators);

  const ref = useRef<HTMLDivElement>(null);
  // Clamp the popover inside its container so a building near an edge doesn't get
  // its tooltip clipped by the map's `overflow-hidden`. Runs before paint each
  // render (the anchor moves every frame), so there's no flash at the edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !hovered) return;
    const parent = el.offsetParent as HTMLElement | null;
    const pw = parent?.clientWidth ?? window.innerWidth;
    const ph = parent?.clientHeight ?? window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const pad = 6;
    // el is translate(-50%, -100%): visible box is [x-w/2, x+w/2] × [y-h, y].
    const x = clamp(hovered.x, w / 2 + pad, pw - w / 2 - pad);
    const y = clamp(hovered.y - 22, h + pad, ph - pad);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });

  if (!hovered) return null;

  const gen = useGeneratorStore
    .getState()
    .generators.find((g) => g.id === hovered.district);
  if (!gen) return null;

  // Earnings for THIS building = the per-employee rate × the building's exact
  // occupants (the full multiplier chain incl. global/founder bonuses scales
  // linearly with headcount, so this is the building's true share of income).
  const money = useGeneratorStore
    .getState()
    .getGeneratorMoneyPerSecond(hovered.district, hovered.occupants);
  const innovation = useGeneratorStore
    .getState()
    .getGeneratorInnovationPerSecond(hovered.district, hovered.occupants);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full"
      style={{ left: hovered.x, top: hovered.y - 22 }}
    >
      <div className="min-w-44 rounded-md border border-primary-500 bg-primary-100/95 px-3 py-2 text-primary-900 shadow-lg backdrop-blur-sm dark:bg-primary-800/95 dark:text-primary-100">
        <div className="flex items-center justify-between gap-3">
          <span className="font-bold">{hovered.name}</span>
          {hovered.isLandmark && (
            <span className="rounded bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950">
              HQ
            </span>
          )}
        </div>
        <div className="text-[11px] capitalize opacity-60">{gen.name}</div>

        <div className="mt-1 flex flex-col gap-0.5 text-xs tabular-nums">
          <Row label="Floors" value={String(hovered.floors)} />
          <Row label="Occupants" value={String(hovered.occupants)} />
          <div className="my-1 border-t border-primary-400/40 dark:border-primary-600/50" />
          <Row label="Money" value={`${formatCurrency(money)}/s`} />
          <Row label="Innovation" value={formatRate(innovation).formatted} />
        </div>
      </div>
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-4">
    <span className="opacity-70">{label}</span>
    <span>{value}</span>
  </div>
);

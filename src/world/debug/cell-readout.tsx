/**
 * Cursor-tracking cell readout — HTML anchored to the hovered cell.
 *
 * The numbers live here rather than in Pixi text: per-cell labels would be
 * 4,096 of them on a 64² map, unreadable zoomed out and pointless zoomed in.
 * Colour overlays show the pattern; this shows the exact values on demand.
 *
 * Positioned imperatively by `useCellAnchorFollow`, so following the camera
 * costs no React renders.
 */
import { useRef } from "react";

import { useWorldStore } from "../../state/world.store";
import { useCellAnchorFollow } from "../anchors/use-cell-anchor";
import { bandOf, HEIGHT_UNIT, RAMP_NAME, rampDir, rampRise } from "../iso";
import { heightAt, rampPackedAt } from "../grid";
import { DIR, DIAG, isPaved, maskAt } from "../roads/mask";
import { buildRoadTable, roadSpriteFor } from "../roads/table";
import { netComponentAt } from "../../state/world.store";

const ROAD_TABLE = buildRoadTable("landscape");
const bitNames = (m: number, names: Record<string, number>) =>
  Object.keys(names).filter((k) => m & names[k]).join("") || "-";

export function CellReadout() {
  const ref = useRef<HTMLDivElement>(null);
  useCellAnchorFollow(ref, { lift: 2 });
  const hover = useWorldStore((s) => s.hover);
  const grid = useWorldStore((s) => s.grid);

  const h = hover ? (heightAt(grid, hover.x, hover.y) ?? 0) : 0;
  const packed = hover ? rampPackedAt(grid, hover.x, hover.y) : 0;
  const dir = rampDir(packed);
  const rise = rampRise(packed);

  // WHICH RULE FIRED. Without this an autotiling bug is a staring contest: the
  // tile looks wrong and nothing says whether the mask, the rule or the art is
  // at fault. Now it says all three.
  const paved = hover ? isPaved(grid, hover.x, hover.y) : false;
  const mask = paved && hover ? maskAt(grid, hover.x, hover.y) : 0;
  const pick = paved ? roadSpriteFor(ROAD_TABLE, mask) : null;
  const net = paved && hover ? netComponentAt(hover.x, hover.y) : -1;

  return (
    <div
      ref={ref}
      // pointer-events-none so it can never intercept a pick
      className="pointer-events-none absolute left-0 top-0 z-20 -translate-x-1/2 -translate-y-full
                 whitespace-nowrap rounded border border-emerald-500/50 bg-gray-950/90 px-2 py-1
                 font-mono text-[11px] leading-tight text-emerald-200 shadow-lg"
      style={{ visibility: "hidden" }}
    >
      {hover && (
        <>
          <div>
            cell <span className="text-white">{hover.x},{hover.y}</span>
            <span className="ml-2 text-gray-400">band</span>{" "}
            <span className="text-white">{bandOf(hover.x, hover.y)}</span>
          </div>
          <div className="text-gray-400">
            height <span className="text-white">{h}</span> ={" "}
            <span className="text-white">{(h * HEIGHT_UNIT).toFixed(1)}px</span>
            {h !== 0 && (
              <span className="ml-1">({h % 2 === 0 ? h / 2 : h / 2} step)</span>
            )}
          </div>
          {dir !== 0 && (
            <div className="text-gray-400">
              ramp <span className="text-white">{RAMP_NAME[dir]}</span>
              <span className="ml-1">
                rise <span className="text-white">×{rise / 2}</span>
              </span>
              {/* the named edge is the HIGH one, so say where it gets to */}
              <span className="ml-1">→ <span className="text-white">{h + rise}</span></span>
            </div>
          )}
          {paved && pick && (
            <>
              <div className="text-gray-400">
                open <span className="text-white">{bitNames(mask, DIR)}</span>
                <span className="ml-1">diag <span className="text-white">{bitNames(mask, DIAG)}</span></span>
              </div>
              <div className="text-gray-400">
                rule <span className="text-white">{pick.role}</span>
                {!pick.exact && <span className="ml-1 text-amber-400">(substituted)</span>}
              </div>
              <div className="text-gray-400">
                tile <span className="text-white">{pick.frame ?? "none"}</span>
              </div>
              <div className="text-gray-400">
                net <span className="text-white">{net}</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

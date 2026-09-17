/**
 * Pick calibration — proving the screen→cell mapping against the art.
 *
 * `worldToCell` shifts its query by +HH, because flooring the inverse selects a
 * diamond half a cell BELOW the visible one. That is derived and unit-tested,
 * but v1 is the cautionary tale: its equivalent correction is 33px wrong and
 * went unnoticed for as long as nothing exercised it.
 *
 * How to read this:
 *
 *   The white crosshair is where picking thinks the cursor is. The red dot is
 *   the centre of the cell it chose. Move the pointer around the map — the
 *   crosshair must stay INSIDE the highlighted diamond, and `Δ from centre`
 *   must stay within roughly ±66 x and ±33 y (half a tile).
 *
 *   If the crosshair sits consistently outside the diamond in one direction,
 *   the shift is wrong. Sweep the offset until it tracks, and the value it
 *   lands on is the correction the derivation is missing. It should be 0.
 */
import { useEffect, useState } from "react";

import { useWorldStore } from "../../state/world.store";
import { HH, HW } from "../iso";
import { pickError } from "../render/overlays";
import { pointerRead } from "./pointer-at";

export function Calibration() {
  const nudge = useWorldStore((s) => s.pickNudge);
  const setNudge = useWorldStore((s) => s.setPickNudge);
  // POLLED, because the pointer is a latch: it changes faster than anyone can
  // read it and a subscriber would re-render on every move. @see pointerSaw
  const [pointer, setPointer] = useState(pointerRead);
  useEffect(() => {
    const t = setInterval(() => setPointer(pointerRead()), 100);
    return () => clearInterval(t);
  }, []);
  const hover = useWorldStore((s) => s.hover);
  const grid = useWorldStore((s) => s.grid);
  const scale = useWorldStore((s) => s.scale);

  const err = pickError(pointer, hover, grid, scale);
  // Inside the diamond is |dx|/HW + |dy|/HH <= 1 — the diamond's own inequality.
  const inside = err
    ? Math.abs(err.dx) / (HW * scale) + Math.abs(err.dy) / (HH * scale) <= 1
    : null;

  return (
    <div>
      <p className="mb-1 text-gray-400">pick calibration</p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono">
        <dt className="text-gray-400">frac cell</dt>
        <dd>
          {pointer
            ? `${pointer.fx.toFixed(2)}, ${pointer.fy.toFixed(2)}`
            : <span className="text-gray-600">—</span>}
        </dd>
        <dt className="text-gray-400">picked</dt>
        <dd>{hover ? `${hover.x}, ${hover.y}` : <span className="text-gray-600">—</span>}</dd>
        <dt className="text-gray-400">Δ centre</dt>
        <dd>
          {err
            ? `${err.dx >= 0 ? "+" : ""}${err.dx.toFixed(1)}, ${err.dy >= 0 ? "+" : ""}${err.dy.toFixed(1)}`
            : <span className="text-gray-600">—</span>}
        </dd>
        <dt className="text-gray-400">verdict</dt>
        <dd>
          {inside === null ? (
            <span className="text-gray-600">hover the map</span>
          ) : inside ? (
            <span className="text-emerald-400">cursor inside cell ✓</span>
          ) : (
            <span className="text-red-400">OUTSIDE — offset wrong</span>
          )}
        </dd>
      </dl>

      <div className="mt-2 flex items-center gap-2">
        <input
          type="range"
          min={-HH}
          max={HH}
          step={0.5}
          value={nudge}
          onChange={(e) => setNudge(Number(e.target.value))}
          className="w-full accent-amber-400"
        />
        <span className="w-14 shrink-0 text-right font-mono text-white">
          {nudge > 0 ? "+" : ""}{nudge}px
        </span>
      </div>

      {nudge !== 0 && (
        <button
          type="button"
          onClick={() => setNudge(0)}
          className="mt-1 cursor-pointer rounded border border-amber-500/60 bg-amber-500/10 px-2 py-0.5
                     text-amber-300 hover:bg-amber-500/20"
        >
          reset to derived (0)
        </button>
      )}

      <p className="mt-2 leading-relaxed text-gray-500">
        White crosshair = where picking thinks the cursor is. Red dot = centre
        of the cell it chose. Move the pointer over the map: the crosshair must
        stay inside the highlighted diamond. Dragging the slider re-picks at the
        last pointer position, so you can see it break and recover.
      </p>
    </div>
  );
}

/**
 * The knobs on the map generator, as sliders.
 *
 * GENERATED FROM THE PARAMETER TABLE rather than written out here: `GEN_SLIDERS`
 * carries every knob's range, label and explanation, so adding a parameter puts
 * a correctly-bounded control in this panel with no edit to this file. A panel
 * hand-written beside the generator is a panel that goes stale the first time
 * somebody adds a knob and forgets.
 *
 * MOVING ONE DOES NOT REGENERATE. Dragging a slider through twenty positions
 * would rebuild the map twenty times, and each rebuild throws away the water
 * field and every sprite — so the settings are staged and `generate` applies
 * them. It also matches what the controls are FOR: you set up a kind of map and
 * then look at it, rather than watching one thrash.
 *
 * @see GenParams for why the seed and these are separate inputs.
 */
import { useState } from "react";
import { useShallow } from "zustand/shallow";

import { useWorldStore } from "../../state/world.store";
import { DEFAULT_GEN, GEN_SLIDERS, type Slider } from "../gen/params";

const GROUPS: { id: Slider["group"]; name: string }[] = [
  { id: "map", name: "map" },
  { id: "land", name: "land" },
  { id: "road", name: "street" },
  { id: "water", name: "water" },
  { id: "cover", name: "cover" },
];

/** Enough places to show the step, and no trailing noughts. */
const show = (v: number, step: number) =>
  step < 1 ? v.toFixed(String(step).split(".")[1]?.length ?? 1) : String(v);

export function GenControls() {
  const { gen, setGenParam, resetGenParams } = useWorldStore(
    useShallow((s) => ({
      gen: s.gen,
      setGenParam: s.setGenParam,
      resetGenParams: s.resetGenParams,
    })),
  );
  const [open, setOpen] = useState(false);

  /** Whether anything has been moved, so the panel can say so while shut. */
  const moved = GEN_SLIDERS.filter((s) => gen[s.key] !== DEFAULT_GEN[s.key]).length;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="cursor-pointer text-gray-400 hover:text-gray-200"
        >
          {open ? "▾" : "▸"} map settings
          {moved > 0 && <span className="ml-1 text-amber-400">·{moved}</span>}
        </button>
        {moved > 0 && (
          <button
            type="button"
            onClick={resetGenParams}
            title="Put every setting back to its default"
            className="cursor-pointer text-gray-500 underline hover:text-gray-300"
          >
            reset
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {GROUPS.map(({ id, name }) => (
            <div key={id}>
              <p className="text-gray-500">{name}</p>
              {GEN_SLIDERS.filter((s) => s.group === id).map((s) => (
                <label key={s.key} title={s.hint}
                  className="flex items-center gap-2 py-px">
                  <span className="w-20 shrink-0 truncate text-gray-400">{s.label}</span>
                  {/* `min-w-0`, or the range input's intrinsic width (~129px)
                      stops `flex-1` shrinking and the value falls off the panel. */}
                  <input
                    type="range"
                    min={s.min} max={s.max} step={s.step}
                    value={gen[s.key]}
                    onChange={(e) => setGenParam(s.key, Number(e.target.value))}
                    className="h-1 min-w-0 flex-1 cursor-pointer accent-amber-400"
                  />
                  <span className={`w-8 shrink-0 text-right font-mono ${
                    gen[s.key] === DEFAULT_GEN[s.key] ? "text-gray-500" : "text-amber-400"
                  }`}>
                    {show(gen[s.key], s.step)}
                  </span>
                </label>
              ))}
            </div>
          ))}
          <p className="text-gray-600">
            press generate to build a map with these
          </p>
        </div>
      )}
    </div>
  );
}

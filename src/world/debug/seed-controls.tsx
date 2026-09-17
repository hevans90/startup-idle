/**
 * The seed the world was founded on, and the two ways to change it.
 *
 * AT THE TOP, WHERE THE TITLE WAS. A panel does not need to tell you which
 * panel it is — you are looking at it — and the seed is the one thing here you
 * might want to write down or type back in. So it takes the most valuable row.
 *
 * Its own component rather than a section of `edit-panel` because it is now
 * mounted somewhere else: the panel's own body still holds the tools, and this
 * sits above the readout.
 */
import { useEffect, useState } from "react";
import { useShallow } from "zustand/shallow";

import { GenControls } from "./gen-controls";
import { useWorldStore } from "../../state/world.store";
import { seedFrom } from "../../utils/rng";

const BTN = "cursor-pointer rounded border px-2 py-1 font-mono";
const OFF = "border-gray-700 text-gray-300 hover:border-gray-500";

export function SeedControls() {
  const { seed, generateWorld } = useWorldStore(
    useShallow((s) => ({
      seed: s.seed,
      generateWorld: s.generateWorld,
    })),
  );

  /**
   * The field's text, held locally so typing does not regenerate on every
   * keystroke — the map is rebuilt on the button or on Enter.
   *
   * Re-synced when the STORE's seed changes, so "new" and a load both write
   * their result into the box rather than leaving whatever was typed there.
   */
  const [text, setText] = useState<string>(seed === null ? "" : String(seed));
  useEffect(() => { setText(seed === null ? "" : String(seed)); }, [seed]);

  /**
   * Found somewhere new.
   *
   * NO SIZE PASSED, and that is the point. This used to hand over the CURRENT
   * grid's width, which meant the size in the settings could be moved, shown in
   * the panel, and then silently overruled by the map already on screen — you
   * pressed generate and got the old size back. The size is a generation
   * setting; generation reads it. @see GenParams
   */
  const reroll = () => generateWorld((Math.random() * 0x7fffffff) | 0);

  /** Regenerate from whatever is in the box; a non-number is hashed. */
  const fromField = () => {
    const raw = text.trim();
    if (!raw) { reroll(); return; }
    const n = Number(raw);
    generateWorld(Number.isFinite(n) ? Math.trunc(n) : seedFrom(raw));
  };

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-1">
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") fromField(); }}
          placeholder="world seed"
          title="A seed to found on. Enter regenerates."
          className="w-28 rounded border border-gray-700 bg-gray-900 px-2 py-1
                     font-mono text-amber-400 placeholder:text-gray-600"
        />
        <button type="button" onClick={fromField}
          title="Regenerate from the seed in the field"
          className={`${BTN} ${OFF}`}>generate</button>
        <button type="button" onClick={reroll}
          title="Found on a brand new seed"
          className={`${BTN} ${OFF}`}>new</button>
      </div>
      {seed === null && (
        <p className="mt-1 text-gray-500">
          authored, loaded or a fixture — not generated
        </p>
      )}
      {/* The other half of the input. @see GenParams */}
      <div className="mt-2"><GenControls /></div>
    </div>
  );
}

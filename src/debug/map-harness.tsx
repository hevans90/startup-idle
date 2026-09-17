/**
 * Debug harness for the isometric office map — load via /?debug=map
 * Set employee counts and slop pit fill directly without the game flow.
 */
import { Office } from "../office/office";
import { useResizeToWrapper } from "../hooks/use-resize-to-wrapper";
import { useGeneratorStore, syncUnlockedGenerators } from "../state/generators.store";
import { useSlopPitStore } from "../state/slop-pit.store";
import { TopDownMap } from "./top-down-map";

const BTN =
  "rounded border border-dashed border-amber-500 px-2 py-1 text-xs text-amber-400 hover:bg-amber-500/10 cursor-pointer";

function setCount(id: "intern" | "vibe_coder" | "10x_dev", n: number) {
  useGeneratorStore.setState((s) => ({
    generators: s.generators.map((g) =>
      g.id === id ? { ...g, amount: n } : g,
    ),
  }));
  syncUnlockedGenerators();
}

export function MapHarness() {
  const { ref: wrapperRef, setRef: setWrapperRef, size: wrapperSize } = useResizeToWrapper();

  const fill = useSlopPitStore((s) => s.fill);
  const penalty = useSlopPitStore((s) => s.getMoneyPenaltyMult());
  const vibeCount = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "vibe_coder")?.amount ?? 0,
  );
  const internCount = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "intern")?.amount ?? 0,
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-950 text-white">
      {/* Isometric map */}
      <div ref={setWrapperRef} className="relative flex-1 min-h-0 min-w-0">
        {wrapperSize && (
          <Office wrapperRef={wrapperRef} wrapperSize={wrapperSize} />
        )}
      </div>

      {/* 2D top-down map */}
      <div className="w-[580px] shrink-0 border-l border-gray-800 overflow-hidden">
        <TopDownMap />
      </div>

      {/* Debug controls */}
      <div className="w-64 shrink-0 flex flex-col gap-4 border-l border-gray-800 bg-gray-950 p-4 text-xs overflow-y-auto">
        <p className="text-amber-400 font-bold text-sm uppercase tracking-wider">
          Map Debug
        </p>

        {/* Employee counts */}
        <section className="flex flex-col gap-2">
          <p className="text-gray-400 font-semibold">Interns ({internCount})</p>
          <div className="flex gap-1 flex-wrap">
            {[0, 10, 50].map((n) => (
              <button key={n} type="button" className={BTN} onClick={() => setCount("intern", n)}>
                {n}
              </button>
            ))}
          </div>

          <p className="text-gray-400 font-semibold">Vibe coders ({vibeCount})</p>
          <div className="flex gap-1 flex-wrap">
            {[0, 5, 20, 50, 100].map((n) => (
              <button key={n} type="button" className={BTN} onClick={() => setCount("vibe_coder", n)}>
                {n}
              </button>
            ))}
          </div>
        </section>

        {/* Slop pit */}
        <section className="flex flex-col gap-2">
          <p className="text-gray-400 font-semibold">Slop Pit</p>

          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={fill}
            className="w-full accent-amber-500"
            onChange={(e) => useSlopPitStore.setState({ fill: Number(e.target.value) })}
          />

          <div className="flex gap-1 flex-wrap">
            {[0, 25, 50, 75, 90, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                className={BTN}
                onClick={() => useSlopPitStore.setState({ fill: pct })}
              >
                {pct}%
              </button>
            ))}
          </div>

          <div className="font-mono text-gray-300 space-y-0.5 tabular-nums">
            <div>
              Fill:{" "}
              <span
                className={
                  fill > 80
                    ? "text-red-400"
                    : fill > 50
                      ? "text-orange-400"
                      : "text-green-400"
                }
              >
                {fill.toFixed(1)}%
              </span>
            </div>
            <div>
              Penalty: <span className={penalty < 0.5 ? "text-red-400" : "text-gray-300"}>{penalty.toFixed(3)}×</span>
            </div>
            <div>
              Income lost:{" "}
              <span className="text-red-400">{((1 - penalty) * 100).toFixed(1)}%</span>
            </div>
          </div>

          <button
            type="button"
            className="rounded bg-red-800 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-700 cursor-pointer"
            onClick={() => useSlopPitStore.getState().drain()}
          >
            DRAIN (hits vibe sat)
          </button>
        </section>

        <div className="mt-auto text-gray-600 text-[10px] space-y-0.5">
          <p>Drag to pan · scroll to zoom</p>
          <p>Slop pit is in the vibe coder zone (pan upper-right)</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Which solver passes the device agrees with the CPU about, on the map you
 * are looking at.
 *
 * NOT THE SWITCH, and the difference still matters — though not for the
 * reason this used to give. The device drives the water now; what this does
 * is say WHICH PASS disagrees, where the frame comparison only says that two
 * solvers do. It is deliberately slow: the whole field goes up and comes back
 * for every comparison, and the cliff index and the drips
 * are still the host's. This runs each pass BESIDE the solver, on a copy, and
 * reports — the water on screen is the CPU's throughout and nothing here
 * changes it.
 *
 * It is worth having pointed at your own terrain rather than at a fixture,
 * because every fault this port has turned up was found by a scene, and the
 * scenes in the harness are ones I chose. A map someone builds by hand is more
 * likely to catch what they miss, not less.
 *
 * Behind `?gpucheck`, because it runs six comparisons and copies the field
 * for each.
 */
import { useEffect, useState } from "react";

import { checkLive, type PassCheck } from "../../fluid/gpu/check-live";
import { useWorldStore } from "../../state/world.store";
import { heldDevice } from "./gpu-device";

/** Every two seconds. Each run is seven passes over a copy of the map. */
const EVERY = 2000;

export function GpuCheckHud() {
  const [rows, setRows] = useState<PassCheck[] | null>(null);
  // Polled rather than passed: the renderer is built after this mounts.
  const [device, setDevice] = useState<GPUDevice | null>(null);
  useEffect(() => {
    if (device) return;
    const t = setInterval(() => {
      const d = heldDevice();
      if (d) setDevice(d);
    }, 200);
    return () => clearInterval(t);
  }, [device]);

  useEffect(() => {
    if (!device) return;
    let alive = true;
    let busy = false;
    const run = async () => {
      // Never two at once: a run takes longer than the interval on a big map
      // and stacking them would queue readbacks for ever.
      if (busy) return;
      busy = true;
      try {
        const field = useWorldStore.getState().getWaterField();
        if (field) {
          const out = await checkLive(device, field.columns);
          if (alive) setRows(out);
        }
      } finally {
        busy = false;
      }
    };
    void run();
    const t = setInterval(() => void run(), EVERY);
    return () => { alive = false; clearInterval(t); };
  }, [device]);

  if (!device) {
    return (
      <div className="pointer-events-none absolute left-2 top-32 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-amber-400">
        waiting for a WebGPU device — none on the WebGL path
      </div>
    );
  }
  if (!rows) return null;

  return (
    <div className="pointer-events-none absolute left-2 top-32 rounded bg-black/70 px-2 py-1 font-mono text-[10px] leading-tight">
      <div className="mb-0.5 text-neutral-400">
        compute passes vs cpu, on this map
      </div>
      {rows.map((r) => (
        <div key={r.pass} className="flex gap-2">
          <span className="w-[72px] text-neutral-300">{r.pass}</span>
          <span className={r.ok ? "text-emerald-400" : "text-red-400"}>
            {r.ok ? "agrees" : "DIFFERS"}
          </span>
          <span className="text-neutral-500">
            {r.relative > 0 ? r.relative.toExponential(0) : "exact"}
          </span>
          {/* A pass that did nothing agrees perfectly — see `didOf`. */}
          <span className={r.did === 0 ? "text-amber-400" : "text-neutral-600"}>
            {r.did === 0 ? "not exercised" : `did ${r.did}`}
          </span>
        </div>
      ))}
      {rows.some((r) => r.why) && (
        <div className="mt-0.5 max-w-[340px] whitespace-pre-wrap text-amber-400">
          {rows.find((r) => r.why)?.why?.slice(0, 160)}
        </div>
      )}
    </div>
  );
}

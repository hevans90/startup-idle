/**
 * CPU or device, on the water you are looking at.
 *
 * A real switch this time, not a comparison: with it on, the frame's water is
 * stepped by the compute passes and the CPU solver does not run. It is here
 * because the passes agreeing on a fixture is not the same evidence as a map
 * somebody built behaving the same way while they watch it — the first is
 * arithmetic and the second is the thing anybody actually cares about.
 *
 * WHAT IT COSTS TODAY is no longer the round trip, and this used to say it
 * was: a megabyte each way, every frame, because the host's copy was what the
 * renderer, the editor, the pipes and the drips all read. The device owns the
 * water now. It sends up what the host has ADDED and reads back a quarter of a
 * megabyte for the renderer and the drips, off the critical path — nothing
 * waits on it. @see gpu/solver
 *
 * It falls back on its own if there is no device: the WebGL path has none, and
 * a toggle that silently did nothing would be worse than one that says so.
 */
import { useEffect, useState } from "react";

import { useWorldStore } from "../../state/world.store";
import { heldDevice } from "./gpu-device";
import { gpuWaterAlarm, gpuWaterNote, gpuWaterWhy } from "./gpu-water-stat";

/** Four a second, like the rest of the readouts. */
const EVERY = 250;

export function GpuWaterToggle() {
  const on = useWorldStore((s) => s.gpuWater);
  const set = useWorldStore((s) => s.setGpuWater);
  // Polled, because the renderer is built after this mounts and the frame
  // stats are a latch written inside a render tick.
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // THE LEAK ALARM, latched and on its own. @see gpuWaterAlarm
  const [alarm, setAlarm] = useState<string | null>(null);
  /** What is holding the device back, if the switch is on and it is not. */
  const [held, setHeld] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      setReady(heldDevice() !== null);
      setNote(gpuWaterNote());
      setAlarm(gpuWaterAlarm());
      setHeld(gpuWaterWhy());
    }, EVERY);
    return () => clearInterval(t);
  }, []);

  // BESIDE THE FRAME READOUT, not under it. Under it is where this used to
  // sit, and the readout is a hundred and ten pixels tall against a hundred
  // and twelve of clearance — so the two overlapped the moment a number grew a
  // digit, which is exactly when somebody is looking at both. `left-36` clears
  // its widest row with room to spare.
  return (
    <div
      className="absolute left-36 top-2 z-10 rounded border border-line
        bg-surface-1/80 px-2 py-1.5 font-mono text-[11px] leading-tight
        text-fg
        "
    >
      <button
        type="button"
        disabled={!ready}
        onClick={() => set(!on)}
        className={`w-full rounded px-2 py-1 text-left font-mono text-[11px]
          transition-colors ${
          !ready
            ? "cursor-not-allowed bg-surface-2 text-fg-muted"
            : on
              ? "bg-good text-white hover:bg-good dark:text-white"
              : "bg-surface-3 text-fg hover:bg-surface-2"
        }`}
      >
        water: {!ready
          ? "cpu (no device)"
          : !on
            ? "cpu"
            : held
              // THE PATH AND NOT THE PREFERENCE. @see gpuWaterWhy
              ? `cpu (${held})`
              : "GPU compute"}
      </button>
      {note && (
        <div className="mt-1 whitespace-pre text-[10px] text-fg-muted">
          {note}
        </div>
      )}
      {alarm && (
        <div
          className="mt-1 whitespace-pre-line rounded border border-bad
            bg-bad-soft/70 px-1 py-0.5 text-[10px] font-bold text-bad
              "
        >
          {alarm}
        </div>
      )}
    </div>
  );
}

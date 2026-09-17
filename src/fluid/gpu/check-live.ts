/**
 * Every solver pass, run on the map somebody is actually building.
 *
 * WHY THIS AS WELL AS THE SWITCH. This was written when there was no switch —
 * the device could match the CPU pass by pass and could not drive the water,
 * because the whole field went up and came back for every comparison, the
 * cliff index was built on the host and the drips were integrated there. All
 * of that is done: the solver runs on the device and the toggle is on by
 * default.
 *
 * What this still buys is WHICH PASS. The frame comparison says the two
 * solvers differ; this says the divergence pass differs, on your own terrain,
 * which is where every fault has come from. Seven passes, not six — diffuse,
 * accelerate, limit, divergence, apply, falls, landings.
 *
 * What is worth having meanwhile is the ability to point the comparison at
 * YOUR terrain instead of a fixture — because every fault this port has turned
 * up was found by a scene, and the scenes in the harness are ones I chose.
 *
 * It takes a snapshot, runs each pass both ways on copies of it, and reports.
 * The live field is never touched, so leaving it on changes nothing about the
 * water you are looking at.
 */
import { activeBox, type ColumnField } from "../columns";
import { compareAccelerate, cloneOf, type PassDiff } from "./compare-pass";

/** One pass's verdict, as the HUD shows it. */
export type PassCheck = {
  pass: string;
  ok: boolean;
  /** The largest disagreement, as a fraction of what the pass is working in. */
  relative: number;
  /** What the pass actually did, so a clean answer can be believed. */
  did: number;
  why?: string;
};

const ORDER = [
  "diffuse", "accelerate", "limit", "divergence", "apply", "falls", "landings",
] as const;

/**
 * Run all six against the live field and say which agree.
 *
 * SOLO, every one of them: down a chain the inputs have already parted by the
 * first pass's rounding, so only solo asks whether a pass is faithful from the
 * same bits. See `compare-pass`, where that distinction cost a while to see.
 */
export async function checkLive(
  device: GPUDevice, live: ColumnField,
): Promise<PassCheck[]> {
  if (!activeBox(live)) {
    return [{ pass: "—", ok: false, relative: 0, did: 0, why: "nothing wet" }];
  }
  const snapshot = cloneOf(live);
  const out: PassCheck[] = [];
  for (const pass of ORDER) {
    try {
      // No settling: the field is already whatever it is. `build` hands back a
      // fresh copy each time so the two sides start from the same bits.
      const r: PassDiff = await compareAccelerate(
        device, 0, () => cloneOf(snapshot), pass, true,
      );
      out.push({
        pass,
        ok: r.ok,
        relative: worstOf(r),
        did: didOf(pass, r),
        why: r.deviceSaid ?? undefined,
      });
    } catch (e) {
      out.push({
        pass, ok: false, relative: 0, did: 0,
        why: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

/** The largest disagreement any of a pass's outputs showed. */
function worstOf(r: PassDiff): number {
  const scale = Math.max(1e-9, r.scale ?? 1);
  return Math.max(
    (r.fx ?? 0) / scale,
    (r.worstDelta ?? 0) / Math.max(1e-9, r.deltaScale ?? 1),
    (r.worstDepth ?? 0) / Math.max(1e-9, r.depthScale ?? 1),
    (r.worstAir ?? 0) / scale,
  );
}

/**
 * HOW MUCH THE PASS DID, because a pass that did nothing agrees perfectly.
 *
 * Six times over in this port a comparison came back clean on a scene that
 * never ran the code in question. A terrain someone has built by hand is
 * likelier to miss a branch than one chosen to hit them, not less, so the
 * readout carries the count next to the verdict and a nought is a warning
 * rather than a pass.
 */
function didOf(pass: string, r: PassDiff): number {
  // The CLIFF EDGES WALKED, not the differences found: counting differences
  // would read "did 1" for ever now that the pass agrees, which is precisely
  // the blind spot this column exists to close.
  if (pass === "falls") return r.fellN ?? 0;
  // What the landings actually PUT IN. Nought means nothing was banked for it
  // to apply, and a pass with nothing to apply agrees with anything.
  if (pass === "landings") return r.landed ?? 0;
  if (pass === "apply") return r.depthScale ? 1 : 0;
  if (pass === "divergence") return r.notBitEqual ?? 0;
  return r.moved?.[pass] ?? 0;
}

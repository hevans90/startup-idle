/**
 * World v2 — which atlas frame draws a ramp.
 *
 * `slope-labels.json` is HAND-AUTHORED in `dev/roadlabel.html` (Slopes tab) and
 * is the single source of truth for what each frame's top face does. This module
 * only reads it: it turns 256 label entries into "give me a frame that rises
 * toward E by a full step".
 *
 * The labeller's `dir` names the edge that RISES, which is the same convention
 * the engine's ramp layer uses — the named edge is the high one. Its `rise` is
 * in tile multiples (×0.5 / ×1); the engine counts half steps, so it doubles.
 */
import labels from "../../slope-labels.json";

import { RAMP, RAMP_NAME, type RampDir } from "./iso";

/** One frame's label, as authored. Extra fields are ignored here. */
export type SlopeLabel = {
  form?: string;
  dir?: string;
  rise?: number;
  extent?: string;
  features?: string[];
  portal?: string;
  edges?: Record<string, string>;
};

export const SLOPE_LABELS = labels as Record<string, SlopeLabel>;

export type RampFrame = {
  frame: string;
  dir: RampDir;
  /** Half steps, so 1 or 2. */
  rise: number;
  paved: boolean;
};

const DIR_OF: Record<string, RampDir> = {
  N: RAMP.N, E: RAMP.E, S: RAMP.S, W: RAMP.W,
};

/**
 * Frames usable as walkable terrain ramps.
 *
 * Three filters, each for a reason:
 *
 *  - `form === "slope"` — the labeller also records flat, cliff and wall faces,
 *    and a tilted silhouette alone does not make a ramp.
 *  - no `water` feature — most of the gently tilted art is river and shoreline,
 *    where the tilt is a water surface sitting below its bank, not ground you
 *    can walk up. This is the filter that matters most: measuring tilt alone
 *    put ~18 river tiles in the ramp set.
 *  - `extent === "full"` — an embankment ramp (`extent: "road"`) tilts only the
 *    roadway and keeps the surrounding grass flat, so its face is NOT the
 *    single tilted plane the picker solves. Those belong with roads, not here.
 *
 * Corner directions (NE/ES/SW/WN) are excluded too: the ramp layer stores one
 * of four edges, and a corner rise is a different surface the solve does not
 * model.
 */
export function usableRampFrames(): RampFrame[] {
  const out: RampFrame[] = [];
  for (const [frame, l] of Object.entries(SLOPE_LABELS)) {
    if (l.form !== "slope") continue;
    if (l.features?.includes("water")) continue;
    if (l.extent && l.extent !== "full") continue;
    const dir = l.dir ? DIR_OF[l.dir] : undefined;
    if (!dir) continue;                       // corner or unlabelled
    if (l.rise !== 0.5 && l.rise !== 1) continue;
    out.push({
      frame,
      dir,
      rise: l.rise * 2,                       // tile multiples → half steps
      paved: !!l.features?.some((f) => f === "road" || f === "paving"),
    });
  }
  return out;
}

export type RampIndex = Map<string, RampFrame[]>;

const key = (dir: RampDir, rise: number) => `${dir}:${rise}`;

/** Group usable frames by direction and rise. */
export function buildRampIndex(frames = usableRampFrames()): RampIndex {
  const ix: RampIndex = new Map();
  for (const f of frames) {
    const k = key(f.dir, f.rise);
    const list = ix.get(k) ?? [];
    list.push(f);
    ix.set(k, list);
  }
  return ix;
}

/**
 * A frame for this direction and rise, preferring bare ground over paved.
 *
 * Null when the artset has none: the labelling pass found a balanced but not
 * complete set, so a caller must cope with a missing combination rather than
 * assume all eight exist.
 */
export function rampFrameFor(
  ix: RampIndex,
  dir: RampDir,
  rise: number,
  wantPaved = false,
): RampFrame | null {
  const list = ix.get(key(dir, rise));
  if (!list?.length) return null;
  return list.find((f) => f.paved === wantPaved) ?? list[0];
}

/** Which (direction, rise) pairs the artset can actually draw. */
export function rampCoverage(ix: RampIndex): { dir: string; rise: number; count: number }[] {
  const out: { dir: string; rise: number; count: number }[] = [];
  for (const dir of [RAMP.N, RAMP.E, RAMP.S, RAMP.W]) {
    for (const rise of [1, 2]) {
      out.push({ dir: RAMP_NAME[dir], rise, count: ix.get(key(dir, rise))?.length ?? 0 });
    }
  }
  return out;
}

/**
 * A frame matching direction, rise AND pavedness exactly, or null.
 *
 * Distinct from {@link rampFrameFor}, which falls back to anything sharing the
 * direction and rise. That fallback is right when only the shape matters and
 * WRONG when pavedness is the point: the artset has paved ramps at ×1 only, so
 * asking for a paved ×0.5 used to return a bare ramp and say nothing.
 */
export function rampFrameExact(
  ix: RampIndex,
  dir: RampDir,
  rise: number,
  paved: boolean,
): RampFrame | null {
  return ix.get(key(dir, rise))?.find((f) => f.paved === paved) ?? null;
}

/** Built once: the label file never changes at runtime. */
let sharedIndex: RampIndex | null = null;
const shared = () => (sharedIndex ??= buildRampIndex());

/**
 * Rises the artset can draw as a PAVED ramp, in half steps.
 *
 * Only ×1. There is no paved ×0.5 art, which is why a half-step difference
 * cannot be bridged by a road — see roads/ramp-derive.
 */
export const PAVED_RAMP_RISES: readonly number[] = [2];

/**
 * A ramp rising AWAY from the camera is drawn nearly edge-on, and it does not
 * look like a ramp on its own.
 *
 * N and E ramps rise up-screen, so their slope faces the camera and fills a
 * 131-tall frame. S and W rise toward the viewer: the raised near corners lift
 * into the frame the tile already had, so the frame stays 99 and the roadway
 * shows as a thin foreshortened band between two kerbs with the verge beside
 * it as a green sliver. Read in isolation that is easy to mistake for a flat
 * road with a stepped-down verge — I did, and removed all four S/W paved ramps
 * on the strength of it. Rendering the junction shows them bridging the step
 * exactly as the up-screen pair do. Do not judge one of these frames without
 * the assembly around it.
 */
/** The paved ramp frame for a direction and rise, or null if there is none. */
export const pavedRampFrame = (dir: RampDir, rise: number): string | null =>
  rampFrameExact(shared(), dir, rise, true)?.frame ?? null;

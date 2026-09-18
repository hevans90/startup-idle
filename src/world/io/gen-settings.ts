/**
 * The generator's settings, kept across reloads.
 *
 * A separate thing from the map, and separately stored. The map is the thing
 * you have; these are the terms the next one would be made on, and they
 * outlive it — turning up the relief, hitting generate a dozen times and then
 * refreshing should not put the relief back.
 *
 * WRITTEN STRAIGHT THROUGH, no debounce, which is the opposite of what the map
 * next door does and for the reason given there: `world-save` is avoiding tens
 * of kilobytes of base64 per painted cell. This is a couple of dozen numbers —
 * a few hundred bytes — and a slider drag writes it a few dozen times, which
 * costs nothing measurable and spares the whole question of flushing on the
 * way out. @see saveSoon
 *
 * READ THROUGH `withDefaults`, which is not politeness about old files but the
 * only thing standing between a hand-edited localStorage entry and a map
 * generator asked for a relief of nine million. It fills in keys added since,
 * clamps every one to its slider's range, and replaces anything that is not a
 * finite number — so whatever comes back out of storage, what the generator
 * gets is a valid `GenParams`.
 */
import { GEN_SLIDERS, withDefaults, type GenParams } from "../gen/params";

/** Where the settings live. Distinct from the map's own autosave. */
const KEY = "world-gen";

/** The stored settings, or the defaults if there are none worth having. */
export function loadGenParams(): GenParams {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage blocked entirely, which is a thing browsers do in private
    // windows. Defaults are a perfectly good answer.
  }
  if (!raw) return withDefaults();
  let got: unknown;
  try {
    got = JSON.parse(raw);
  } catch {
    // Not JSON any more. Nothing here is worth failing a page load over.
    return withDefaults();
  }
  if (!got || typeof got !== "object") return withDefaults();
  // TAKEN KEY BY KEY, rather than handed over whole. Spreading whatever was
  // in storage puts whatever was in storage into the settings object — an
  // ARRAY is an object as far as `typeof` is concerned, so `[1,2,3]` came
  // back as a perfectly valid `GenParams` carrying "0", "1" and "2" as well.
  // Nothing read them, and a settings object with junk in it is a settings
  // object that gets saved back with junk in it.
  const from = got as Record<string, unknown>;
  const pick: Partial<GenParams> = {};
  for (const s of GEN_SLIDERS) {
    const v = from[s.key];
    if (typeof v === "number") pick[s.key] = v;
  }
  return withDefaults(pick);
}

/** Remember these for next time. */
export function saveGenParams(gen: GenParams): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(gen));
  } catch {
    // Full or blocked. The settings still apply for this session.
  }
}

/**
 * Forget them, so the next load takes whatever the defaults are THEN.
 *
 * What reset means, and writing the current defaults would not mean it: a
 * default that changes in the code should reach somebody who has asked for
 * the defaults, and it cannot if their last click pinned the old ones.
 */
export function forgetGenParams(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do and nothing worth saying.
  }
}

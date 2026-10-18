/**
 * World v2 — THE ASCENSION SEQUENCE: when the singularity reaches 100 with the
 * map up, a few seconds of it on the map before the AI asks — the camera to
 * the Data Centre, light flooding out to every rack, the holograms pouring
 * into the streets, the sky going violet — and then the card. Live state;
 * not saved: a reload plays it again. @see AiLayer, AscensionCard
 */

/** How long it plays, ms. */
export const SEQUENCE_MS = 18_000;

let started: number | null = null;

/**
 * The sequence, moved on: started the moment the meter is full, forgotten as
 * soon as it is not (a shutdown). Returns whether it started just now — the
 * scene's cue to move the camera.
 */
export function stepSequence(value: number, now: number): boolean {
  if (value < 100) { started = null; return false; }
  if (started !== null) return false;
  started = now;
  return true;
}

/** How far into it, 0 to 1; 0 with none playing. */
export const sequenceProgress = (now: number) => (started === null ? 0 : Math.min(1, (now - started) / SEQUENCE_MS));

/** Its intensity on the map: building over the first half, held after. */
export const sequenceIntensity = (now: number) => Math.min(1, sequenceProgress(now) / 0.5);

/** Whether it has played to the end, so the card can ask. */
export const sequenceDone = (now: number) => started !== null && now - started >= SEQUENCE_MS;

/** Seconds the `singularity` fixture takes over each stage, and over the Ascension at the end. */
export const FIXTURE_STAGE_SECONDS = 15;
export const FIXTURE_ASCENSION_SECONDS = 18;

/**
 * THE `singularity` FIXTURE'S PREVIEW: the meter run up through every stage,
 * `FIXTURE_STAGE_SECONDS` each, then the Ascension played out, and round again.
 * `t` in seconds. @see buildSingularity
 */
export function aiFixturePreview(t: number): { value: number; ascension: number; training: boolean; plan?: undefined } {
  const rise = 5 * FIXTURE_STAGE_SECONDS, k = t % (rise + FIXTURE_ASCENSION_SECONDS);
  if (k < rise) return { value: (k / rise) * 100, ascension: 0, training: Math.floor(k / FIXTURE_STAGE_SECONDS) % 2 === 1 };
  return { value: 100, ascension: (k - rise) / FIXTURE_ASCENSION_SECONDS, training: false };
}

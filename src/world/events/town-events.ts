/**
 * World v2 — the scene's side of the events: what the town looks like to
 * them. Plain functions and a little live state. @see TownView
 */
import { housedBy, residentsIn } from "../../game/housing";
import type { Grid } from "../grid";
import type { MoodParts } from "../agents/mood";

/** The town's mood: every house's, weighted by who lives there. Nought with nobody home. */
export function townMood(g: Grid, moods: ReadonlyMap<number, MoodParts>): number {
  let sum = 0, n = 0;
  for (const s of g.structures.values()) {
    if (!housedBy(s.def)) continue;
    const r = residentsIn(s), m = moods.get(s.id);
    if (!r || !m) continue;
    sum += m.total * r;
    n += r;
  }
  return n ? sum / n : 0;
}

/**
 * THE CONVOY'S TAKE: the calls made while it was in, and what they paid, for
 * the one convoy under way. Live state; not saved. @see tallyCall
 */
let tally = { id: -1, calls: 0, earned: 0 };
export const convoyTally = (id: number) => (tally.id === id ? tally : { id, calls: 0, earned: 0 });
export function tallyCall(id: number, fee: number): void {
  if (tally.id !== id) tally = { id, calls: 0, earned: 0 };
  tally.calls++;
  tally.earned += fee;
}

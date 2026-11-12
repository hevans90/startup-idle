/**
 * World v2 — ONE FRAME OF EVERY PIPE ON THE MAP, in the order it has to go:
 * the editor's spouts (none in the game: `runPipes` leaves at once), the
 * water mains solved and delivered, then the slop — tanks filled, drained
 * down their connections and trunks, spilled where they cannot be. The slop
 * comes after the mains because the mains' frame is what says which sewer
 * connections there are. One call, so the scene and the headless sims cannot
 * run them in different orders or leave one out. @see plans/pipe-network.md §5
 */
import type { Grid } from "../grid";
import { stepSlop } from "../slop/tanks";
import type { WaterField } from "../water/field";
import { runMains } from "../water/mains";
import { runPipes } from "../water/pipes";

export type PipeTick = {
  /** How pumps and lift stations are paid for a second of running; free where left out, as in the editor. */
  pumps?: { pay: (seconds: number) => boolean };
  /** The slop made this frame: who sits at each workplace's desks, and what each makes a second. Left out, none is made or moved. */
  slop?: { desks: ReadonlyMap<number, { used: number }> | null; perCoder: number } | null;
};

export function stepPipes(g: Grid, field: WaterField, dt: number, tick: PipeTick = {}): void {
  runPipes(field, g, dt, tick.pumps);
  runMains(field, g, dt, tick.pumps);
  if (tick.slop) stepSlop(g, field, tick.slop.desks, tick.slop.perCoder, dt, tick.pumps?.pay);
}

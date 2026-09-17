/**
 * The outbox is drained IN EDGE ORDER, and that is a correctness property.
 *
 * `markCliffs` walks the map and pushes `k` then `k + 1` per column, so the
 * CPU's cliff set is ascending in `k` and it makes its drops in that order.
 * The device's threads claim outbox slots in whatever order they reach the
 * atomic, which is nothing at all. Sorting the records by edge puts the two
 * back in step — and it has to, because the drip list is a PACKED ARRAY. Which
 * slot a drop takes decides which drop it coalesces into when the list fills,
 * and `crown` advances a shared `spun` counter that turns each plume off the
 * last. Out of order the list is merely equivalent; in order it is identical.
 *
 * Within one edge a shed drop is made before a crown, because `stepFalls`
 * sheds off the sheet before it lands it — hence the tie-break on the kind.
 */
import { describe, expect, test } from "bun:test";

import { FLOW_DEFAULTS, createColumnField, type ColumnField } from "../columns";
import { SPAWN_CROWN, SPAWN_SHED, SPAWN_STRIDE } from "./state";
import { drainSpawns } from "./falls";

/** One outbox record, laid out as `postSpawn` writes it. */
function record(
  k: number, kind: number, cell: number, volume = 0.25, a = 1, b = 0.5,
  lip = 0, mat = 1,
): number[] {
  return [k, kind, cell, volume, a, b, lip, mat];
}

const field = (): ColumnField =>
  createColumnField(16, 16, { ...FLOW_DEFAULTS, wind: 0 }, 0.5);

/** Every drop in the list, as something two runs can be compared by. */
const asMade = (f: ColumnField) => {
  const d = f.drips;
  return Array.from({ length: d.live }, (_, n) =>
    [d.cx[n], d.cy[n], d.z[n], d.vx[n], d.vy[n], d.vz[n], d.volume[n]].join());
};

describe("draining the spray outbox", () => {
  test("the same records shuffled give the same drip list", () => {
    const records = [
      record(2, SPAWN_SHED, 1), record(2, SPAWN_CROWN, 1),
      record(9, SPAWN_SHED, 4), record(14, SPAWN_CROWN, 7),
      record(21, SPAWN_SHED, 10), record(30, SPAWN_CROWN, 15),
      record(41, SPAWN_SHED, 20), record(58, SPAWN_CROWN, 29),
    ];
    const raw = (order: number[]) =>
      new Float32Array(order.flatMap((n) => records[n]));

    const forward = field();
    const shuffled = field();
    const a = drainSpawns(forward, raw([0, 1, 2, 3, 4, 5, 6, 7]), 8);
    const b = drainSpawns(shuffled, raw([5, 2, 7, 0, 6, 1, 4, 3]), 8);

    expect(a).toEqual(b);
    expect(forward.drips.live).toBeGreaterThan(4);   // and drops were made
    expect(asMade(shuffled)).toEqual(asMade(forward));
  });

  test("and the order really does decide — the check can fail", () => {
    // The instrument. A crown turns by a shared counter and a shed drop does
    // not, so if the sort were dropped the two lists below would differ. If
    // this ever passes, the test above has stopped proving anything.
    const records = [
      record(2, SPAWN_CROWN, 1), record(9, SPAWN_CROWN, 4),
      record(14, SPAWN_CROWN, 7),
    ];
    const one = field(), two = field();
    // Drained WITHOUT the sort, by handing each a different arrival order and
    // edges that are already in order, so only the sort could line them up.
    for (const [f, order] of [[one, [0, 1, 2]], [two, [2, 1, 0]]] as
      [ColumnField, number[]][]) {
      for (const n of order) {
        drainSpawns(f, new Float32Array(records[n]), 1);
      }
    }
    expect(asMade(two)).not.toEqual(asMade(one));
  });

  test("an overflowed outbox is reported, not swallowed", () => {
    // The shader refuses to shed what it cannot post, so an overflow costs
    // drops and never water — but a scene reaching it has had its spray
    // silently stop, which is worth saying out loud.
    const f = field();
    const raw = new Float32Array(2 * SPAWN_STRIDE);
    raw.set(record(4, SPAWN_SHED, 2), 0);
    raw.set(record(6, SPAWN_SHED, 3), SPAWN_STRIDE);
    // Two records in the buffer, but the counter says five were asked for.
    const got = drainSpawns(f, raw, 5);
    expect(got.made).toBe(2);
    expect(got.lost).toBe(3);
  });

  test("each kind goes to its own maker", () => {
    const shedOnly = field(), crownOnly = field();
    drainSpawns(shedOnly, new Float32Array(record(4, SPAWN_SHED, 2)), 1);
    drainSpawns(crownOnly, new Float32Array(record(4, SPAWN_CROWN, 2)), 1);
    // A crown is a ring of drops off one impact; a shed drop is one drop.
    expect(shedOnly.drips.live).toBe(1);
    expect(crownOnly.drips.live).toBeGreaterThan(1);
    // And a crown is thrown UPWARDS, which is the whole look of it.
    expect(crownOnly.drips.vz[0]).toBeLessThan(0);
  });
});

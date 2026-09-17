/**
 * Do the falls COMMUTE?
 *
 * `stepFalls` walks `FallState.cliff`, and nothing guarantees the order that
 * index comes out in — `markCliffs` rebuilds it from the ground every frame,
 * and a device would walk it in no order at all. So the answer has to be yes,
 * or the solver's output depends on an accident.
 *
 * It used to be no, and by a lot. A landing went straight into the depth, and
 * the next landing in the same step then READ that depth — for whether the
 * cell was dry, which picks its material, and through `plungeInto` for how
 * deep it is, which sets the plunge's cap and whether it kicks at all. Two
 * falls into one pool saw different water depending on which lip came first.
 * A landing is banked now and applied afterwards; see `applyLandings`.
 *
 * MEASURE IT FAIRLY OR NOT AT ALL. The obvious experiment — reverse the loop,
 * run the scene, diff — is wrong, and wrong in a way that looks like a result:
 * the settling frames run reversed too, so the two runs reach the step under
 * test holding different water, and what comes out is saturated chaos. It
 * reported differences of 18.4, then 7.0, then 1.6 against a scale of 29, and
 * every one of those numbers was noise. Settled identically and reversed for
 * ONE step, the same scene answers 0.037 — and nought once the drip budget is
 * out of the way, which is what these pin.
 */
import { describe, expect, test } from "bun:test";

import {
  FLOW_DEFAULTS, activeBox, addWater, applyLandings, at, createColumnField,
  plungeInto, stepFlow, type ColumnField, type PassConsts,
} from "./columns";
import { markCliffs, stepFalls } from "./falls";
import { fadeSplashes } from "./drips";

describe("what a plunge turns white", () => {
  test("is a mark the foam can see and the clock can clear", () => {
    // A FALL LANDING IS NOT A DROP LANDING, and for a while only one of them
    // counted. `plungeInto` wrote the whiteness straight into `splash` and
    // left the flag beside it alone, so the sheet under every waterfall lit
    // nothing: the foam renderer reads the marks only when the flag is up, the
    // fade returned early for the same reason and so the mark never decayed,
    // and it then appeared all at once — at full strength, long after the
    // water that made it — the first time any unrelated drop landed and turned
    // the flag on. The mark and the fact that there IS a mark are the same
    // fact, and they go in through one door now.
    const f = createColumnField(24, 24, FLOW_DEFAULTS, 0.25);
    const d = f.drips;
    expect(d.splashed).toBe(false);

    // Slow enough to throw no crown, so the mark is the plunge's own doing and
    // not some drop's — which is the case that was broken.
    plungeInto(f, 10, 10, 0.5, 1, 1);
    const i = at(f, 10, 10);
    expect(d.splash[i]).toBeGreaterThan(0);
    expect(d.splashed).toBe(true);
    expect(d.nlit).toBe(1);

    // And it goes out on its own, rather than standing there for the session.
    for (let n = 0; n < 200; n++) fadeSplashes(d, 1 / 60);
    expect(d.splash[i]).toBe(0);
    expect(d.splashed).toBe(false);
  });
});

/**
 * A NOTCH in a shelf, with a drop too short to shed anything.
 *
 * `BREAK` is eight and `CROWN_SPEED` thirty, so a six half step fall never
 * sprays off its sheet and never throws a crown off its plunge. That takes the
 * drip budget out of the question, which matters because the budget is the one
 * thing here that still does not commute: whoever is reached first gets the
 * drops, and a drop is water. It is a RENDERING allowance feeding back into
 * the simulation, and it is deferred to the drips going over to the device.
 *
 * A NOTCH RATHER THAN A STRAIGHT CLIFF, because order can only matter where
 * two falls land in the SAME cell, and off a straight cliff every lip has its
 * own. Written straight, the test below that is supposed to fail — the one
 * standing in for the old behaviour — passed, because there was nothing for
 * the order to change. The notch puts an east-facing lip and a south-facing
 * one within a throw of each other.
 */
function shelf(high = 6): ColumnField {
  const f = createColumnField(40, 32, { ...FLOW_DEFAULTS, wind: 0 }, 0.5);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 40; x++) {
      const up = x < 20 || (y > 12 && y < 20 && x < 26);
      f.ground[at(f, x, y)] = up ? high : 0;
    }
  }
  for (let y = 3; y < 29; y++) for (let x = 2; x < 18; x++) addWater(f, x, y, 8, 1);
  for (let n = 0; n < 150; n++) stepFlow(f, 1 / 60);
  return f;
}

/** How many drops are in the air, so a test can say the spray really ran. */
const drops = (f: ColumnField) => f.drips.live;

const constsFor = (f: ColumnField, dt: number): PassConsts => {
  const r = activeBox(f)!;
  const p = f.params;
  return {
    x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
    gain: p.gravity * dt / f.cell, bedGain: p.bedDrag * dt,
    hMax: (f.cell / p.maxDt) ** 2 / (2 * p.gravity),
    minHead: p.minSlope * f.cell, spread: dt / f.cell,
    diffScale: dt / (f.cell * f.cell), dt,
  };
};

const state = (f: ColumnField) =>
  [...f.depth, ...f.fx, ...f.fy, ...f.falls.air, ...f.material];

describe("the falls commute", () => {
  test("the cliff set walked backwards gives the same answer, to the bit", () => {
    // Both settled the same way, in this process, so they reach the step under
    // test holding the same water. Only the LAST call is reversed, and it is
    // `stepFalls` directly rather than a whole frame — the point is the order
    // inside that one pass and nothing else.
    const a = shelf(), b = shelf();
    expect(state(a)).toEqual(state(b));          // or nothing below means anything

    const dt = 1 / 60;
    const c = constsFor(a, dt);
    const box = { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 };

    markCliffs(a);
    markCliffs(b);
    expect(b.falls.cliffN).toBeGreaterThan(4);   // and there are falls to walk
    const back = b.falls.cliff.slice(0, b.falls.cliffN).reverse();
    b.falls.cliff.set(back, 0);

    stepFalls(a, dt, box);
    applyLandings(a);
    stepFalls(b, dt, box);
    applyLandings(b);

    expect(state(b)).toEqual(state(a));
  });

  test("including off a fall tall enough to SHED, where the budget is live", () => {
    // The short drop above never sprays — `BREAK` is eight — so it says
    // nothing about the drip budget, which was the last thing here that did
    // not commute. `dripRoom` read per fall gave whoever was reached first the
    // drops, and a drop is water: taken out of the sheet by `shedSpray` and
    // held back from the pool by the plunge's crown. Sampled once a step, as
    // `ColumnField.room` now is, every fall sees the same allowance.
    const a = shelf(24), b = shelf(24);
    expect(drops(a)).toBeGreaterThan(0);        // and the spray really is running
    expect(state(a)).toEqual(state(b));

    const dt = 1 / 60;
    const c = constsFor(a, dt);
    const box = { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 };
    markCliffs(a);
    markCliffs(b);
    const back = b.falls.cliff.slice(0, b.falls.cliffN).reverse();
    b.falls.cliff.set(back, 0);

    stepFalls(a, dt, box);
    applyLandings(a);
    stepFalls(b, dt, box);
    applyLandings(b);

    expect(state(b)).toEqual(state(a));
  });

  test("and it is the LANDINGS that made it so, not luck", () => {
    // The same scene with the banking undone — a landing applied where it
    // happens, the way it used to be — must come apart. If this ever passes,
    // the test above has stopped proving anything.
    const a = shelf(), b = shelf();
    const dt = 1 / 60;
    const c = constsFor(a, dt);
    const box = { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 };

    markCliffs(a);
    markCliffs(b);
    const back = b.falls.cliff.slice(0, b.falls.cliffN).reverse();
    b.falls.cliff.set(back, 0);

    // Applied AS THEY LAND, by running the apply after every edge rather than
    // once at the end — which is what the old code did, and is the only thing
    // being changed.
    for (const f of [a, b]) {
      const all = f.falls.cliff.slice(0, f.falls.cliffN);
      for (let n = 0; n < all.length; n++) {
        f.falls.cliffN = 1;
        f.falls.cliff[0] = all[n];
        stepFalls(f, dt, box);
        applyLandings(f);
      }
      f.falls.cliff.set(all, 0);
      f.falls.cliffN = all.length;
    }
    expect(state(b)).not.toEqual(state(a));
  });
});

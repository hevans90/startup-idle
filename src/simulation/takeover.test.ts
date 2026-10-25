/**
 * THE TAKEOVER SIM: the company's AI let loose on the singularity fixture's
 * town, its real planner, wallet, cooling, mains and water, held to the
 * plan's guards (§8):
 *  - COOLING: once all it runs is cooled, never short for more than a minute;
 *    and, on a full run, all cooled in the end;
 *  - SPEND: never more than its wallet held and was given;
 *  - DISTRICT: nothing it builds or takes outside its district;
 *  - TAKEOVERS: each announced its warning ahead;
 *  - WATER: two reservoirs at most.
 * By default, a quarter-hour at each stage and with hands off; `TAKEOVER=1`
 * runs half an hour at every stage, focus and family of trait, and
 * `BALANCE=1` prints each report. (The water's total, which the plan also
 * asks for, is not held: the springs pour in and the mains drink, and an
 * account of both is the solver's tests' to keep.) @see takeover-sim
 */
import { afterAll, describe, expect, test } from "bun:test";

import type { Family } from "../game/traits";
import type { Stage } from "../state/ai-singularity.store";
import type { AiFocus } from "../state/session.store";
import { MAX_RESERVOIRS, endTakeover, simulateTakeover, type TakeoverRun } from "./takeover-sim";

const FULL = !!process.env.TAKEOVER;
const SECONDS = FULL ? 1800 : 900;
const STAGES_RUN: Stage[] = ["colleague", "manager", "overseer"];
const FOCUSES: AiFocus[] = ["grow", "machine", "people", "hands-off"];
const FAMILIES: Family[] = ["planner", "optimiser", "shepherd", "elemental", "recursive", "temper"];

const runs: TakeoverRun[] = FULL
  ? [
    ...STAGES_RUN.flatMap((stage) => FOCUSES.map((focus) => ({ stage, focus, seconds: SECONDS }))),
    ...FAMILIES.map((family) => ({ stage: "manager" as Stage, focus: "grow" as AiFocus, family, seconds: SECONDS })),
  ]
  : [...STAGES_RUN.map((stage) => ({ stage, focus: "grow" as AiFocus, seconds: SECONDS })), { stage: "manager", focus: "hands-off", seconds: SECONDS }];

/** A seeded roll, so a run is the same run each time. */
const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

describe("the takeover sim", () => {
  // Out of play again, the stores as they were: other tests share them.
  afterAll(endTakeover);
  for (const run of runs) {
    const name = `${run.stage}, ${run.focus}${run.family ? `, ${run.family}` : ""}`;
    test(name, () => {
      const r = simulateTakeover(run, seeded(7));
      if (process.env.BALANCE) console.log(name.padEnd(28), JSON.stringify(r));
      expect(r.relapse).toBeLessThanOrEqual(60);
      if (run.seconds >= 1800) expect(r.cooledEnd).toBeGreaterThanOrEqual(0.9);
      expect(r.spent).toBeLessThanOrEqual(r.allowed + 1);
      expect(r.outside).toBe(0);
      expect(r.unwarned).toBe(0);
      expect(r.reservoirs).toBeLessThanOrEqual(MAX_RESERVOIRS);
      // Hands off, it only cools. @see handsOff
      if (run.focus === "hands-off") expect(Object.keys(r.kinds).every((k) => k === "pipe" || k === "reservoir" || k === "refill")).toBe(true);
    }, 300_000);
  }
});

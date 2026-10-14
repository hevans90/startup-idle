/**
 * RUN SPREAD: do different founders play different runs, or the same run
 * faster or slower? Each founds the same company in the map sim, and each
 * run's milestones — the Studio, the Campus, the Data Centre, the IPO Tower,
 * the first AI agent — are put on its own clock, as shares of the time to its
 * core upgrades, which every run reaches. Founders who only scale the game
 * land on the same shape; ones who change it do not. `BALANCE=1` prints each
 * founder's run.
 *
 * WHAT THE SIM CANNOT SEE: its player is one greedy policy for everybody, and
 * it has no map events or term sheets; a founder whose rule is about those
 * (the Hustler's events) plays here as a number.
 * @see plans/gameplay-fun.md "Measuring fun"
 */
import { describe, expect, jest, test } from "bun:test";

import type { ProjectId } from "../game/projects";
import { simulateMapRun } from "./simulate-map-run";

const FOUNDERS = ["neet", "bootstrapper", "hacker", "visionary", "hustler"];
const MARKS: ProjectId[] = ["studio", "campus", "datacentre", "conference", "ipo"];

const fmt = (s?: number | null) => (s == null ? "—" : s < 3600 ? `${(s / 60).toFixed(0)}m` : `${(s / 3600).toFixed(2)}h`);

describe("run spread", () => {
  test("founders change the shape of a run, not only its speed", () => {
    const tick = jest.advanceTimersByTime.bind(jest);
    const shapes: Record<string, number[]> = {};
    const ipos: Record<string, number | null> = {};
    for (const founder of FOUNDERS) {
      const r = simulateMapRun(tick, { maxSimulatedSeconds: 86400 * 3, afterCore: 3 * 3600, founder });
      const core = r.coreAt ?? r.endedAt, end = r.endedAt;
      // The IPO Tower out of the shape: a run that never reaches it is a wall, not a shape. @see "the IPO"
      shapes[founder] = [...MARKS.filter((m) => m !== "ipo").map((m) => (r.opened[m] ?? end) / core), (r.firstAgent ?? end) / core];
      ipos[founder] = r.opened.ipo ?? null;
      if (process.env.BALANCE) {
        console.log(`${founder.padEnd(12)} ${MARKS.map((m) => `${m} ${fmt(r.opened[m])}`).join(" · ")} · agent ${fmt(r.firstAgent)} · core ${fmt(r.coreAt)} · shape ${shapes[founder].map((x) => x.toFixed(2)).join(" ")}`);
      }
    }
    // The mean distance between two founders' shapes: how differently, not how fast.
    let sum = 0, pairs = 0;
    for (let a = 0; a < FOUNDERS.length; a++) {
      for (let b = a + 1; b < FOUNDERS.length; b++) {
        const x = shapes[FOUNDERS[a]], y = shapes[FOUNDERS[b]];
        sum += x.reduce((n, v, k) => n + Math.abs(v - y[k]), 0) / x.length;
        pairs++;
      }
    }
    const spread = sum / pairs;
    if (process.env.BALANCE) console.log(`spread ${(spread * 100).toFixed(1)}% of a run to the core`);
    if (process.env.BALANCE) console.log(`no IPO Tower: ${FOUNDERS.filter((f) => ipos[f] === null).join(", ") || "none"}`);
    // Measured 2026-10-14: ~9%, nearly all the Visionary's early Data Centre and
    // the Hustler's quicker everything; the Bootstrapper and the Hacker run the
    // NEET's run within a few percent. Held above nothing so a change that
    // flattens them all shows.
    expect(spread).toBeGreaterThan(0.03);
  }, 600_000);
});

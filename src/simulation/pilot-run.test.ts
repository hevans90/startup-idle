import { afterEach, describe, expect, jest, test } from "bun:test";

import { housedBy, roomFor } from "../game/housing";
import { useGeneratorStore } from "../state/generators.store";
import { useSessionStore } from "../state/session.store";
import { playRules } from "../state/world.store";
import type { Grid } from "../world/grid";
import { placeStructure, startProject } from "../world/play/build-actions";
import { nearestSpot } from "../world/projects/works";
import { structureDef } from "../world/structures/def";
import { getAiRunner, stepAi } from "../world/ai/ai-runner";
import { lastStep, planInline, stepAutopilot, stepsTaken } from "../world/ai/autopilot";
import { playCompany, type PilotRunReport } from "./pilot-run";
import { resetAllGameStores } from "./reset-game-stores";

planInline();
afterEach(resetAllGameStores);

const IDLE = { stage: "tool" as const, running: 0, agents: 0 };
const mins = (s?: number) => (s === undefined ? "never" : (s / 60).toFixed(1) + " min");

/** AI mode as it is today, driving. @see stepAutopilot */
const autopilot = {
  begin: () => useSessionStore.getState().setAiMode({ aiMode: true, aiBudget: 0.8 }),
  drive: (g: Parameters<typeof stepAutopilot>[0], dt: number, now: number) => {
    stepAutopilot(g, dt, now);
    stepAi(getAiRunner(), g, IDLE, dt, now);
  },
  steps: stepsTaken,
  said: lastStep,
};

const print = (r: PilotRunReport) => {
  const firsts = Object.entries(r.firstHire).map(([k, v]) => k + " " + mins(v)).join(", ");
  console.log("\n=== seed " + r.seed + ", " + r.size + "² — " + mins(r.seconds) + " played");
  console.log("sale " + mins(r.saleAt) + " · staff " + JSON.stringify(r.staff) + " · first hires: " + firsts);
  console.log("upgrades " + r.upgrades.bought + "/" + r.upgrades.of + " · lots " + r.lots + " (" + r.residents + " living in them) · road " + r.paved + " · money " + r.money + " · income " + r.income + "/s · steps " + r.steps);
  console.log("projects: " + (Object.entries(r.opened).map(([k, v]) => k + " " + mins(v)).join(", ") || "none"));
  console.log("longest wait " + mins(r.longestWait.seconds) + " from " + mins(r.longestWait.from) + "; waits of a minute or more: " + r.waits.length + ", " + mins(r.waits.reduce((n, w) => n + w.seconds, 0)) + " in all");
  for (const w of r.waits.slice(0, 8)) console.log("   at " + mins(w.from) + " for " + mins(w.seconds) + " with $" + w.money + ", after: " + w.after);
  console.log("did: " + r.timeline.map((e) => mins(e.at) + " " + e.did).join(" | "));
};

describe("a company played on a real map with no screen", () => {
  test("the town's rules run: a garage built by hand, lots laid, interns hired, arrived and housed", () => {
    // A PLAYER BY HAND, the least of one: the garage, four lots by the road, and an intern whenever there is a bed and the money.
    let clock = 0, done = 0, last: string | null = null;
    const byHand = {
      begin: (g: Grid) => { if (startProject("garage", nearestSpot(g, structureDef("garage")!, playRules(g))!)) { done++; last = "the garage"; } },
      drive: (g: Grid, dt: number) => {
        if ((clock += dt) < 2) return;
        clock = 0;
        const lots = [...g.structures.values()].filter((s) => housedBy(s.def)).length;
        const at = lots < 4 ? nearestSpot(g, structureDef("kit:intern.t0")!, playRules(g)) : null;
        if (at && placeStructure("kit:intern.t0", at)) { done++; last = "a lot"; return; }
        const before = useGeneratorStore.getState().generators.find((x) => x.id === "intern")?.amount ?? 0;
        if (roomFor("intern", before) >= 1) useGeneratorStore.getState().purchaseGenerator("intern", 1);
        if ((useGeneratorStore.getState().generators.find((x) => x.id === "intern")?.amount ?? 0) > before) { done++; last = "an intern hired"; }
      },
      steps: () => done,
      said: () => last,
    };
    const r = playCompany(jest.advanceTimersByTime.bind(jest), { seed: 1, size: 64, minutes: 12, money: 5000, ...byHand });
    if (process.env.BALANCE) print(r);
    expect(r.seconds).toBe(12 * 60);
    expect(r.opened.garage).toBeDefined();
    expect(r.lots).toBe(4);
    expect(r.staff.intern ?? 0).toBeGreaterThan(2);
    // Hired, they came up the road and moved in.
    expect(r.residents).toBeGreaterThan(2);
    expect(r.income).toBeGreaterThan(0);
  }, 120_000);

  // THE NUMBER TO BEAT: today's AI mode, an hour on each of three maps. Printed, not held to anything.
  test.skipIf(!process.env.BALANCE)("today's AI mode, an hour a map", () => {
    for (const [seed, size] of [[1, 64], [7, 96], [23, 128]] as const) {
      print(playCompany(jest.advanceTimersByTime.bind(jest), { seed, size, minutes: 60, untilSale: true, ...autopilot }));
    }
    // And given $10,000 to start on, which gets it past its first hire.
    print(playCompany(jest.advanceTimersByTime.bind(jest), { seed: 1, size: 64, minutes: 60, untilSale: true, money: 10_000, ...autopilot }));
  }, 1_800_000);
});

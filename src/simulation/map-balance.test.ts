import { describe, expect, jest, test } from "bun:test";

import type { GeneratorId } from "../state/generators.store";
import { simulateCoreUpgradeRun } from "./simulate-core-run";
import { simulateMapRun } from "./simulate-map-run";

const fmt = (s?: number) => (s === undefined ? "—" : s < 3600 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(2)} h`);

/** Run with BALANCE=1 to print the milestones side by side. */
describe("the map's pacing", () => {
  test("the core run with the town gating it, against the run without", () => {
    const tick = jest.advanceTimersByTime.bind(jest);
    const base = simulateCoreUpgradeRun(tick, { maxSimulatedSeconds: 86400 * 7 });
    const first: Partial<Record<GeneratorId, number>> = {}, tenth: Partial<Record<GeneratorId, number>> = {};
    for (const p of base.employeePurchases) {
      first[p.id] ??= p.secondsAtPurchase;
      if (p.amountAfter >= 10) tenth[p.id] ??= p.secondsAtPurchase;
    }
    const map = simulateMapRun(tick, { maxSimulatedSeconds: 86400 * 7 });
    if (process.env.BALANCE) {
      console.table({
        "first intern": { base: fmt(first.intern), map: fmt(map.firstHire.intern) },
        "10 interns": { base: fmt(tenth.intern), map: fmt(map.tenth.intern) },
        "studio opens": { base: "—", map: fmt(map.opened.studio) },
        "first vibe coder": { base: fmt(first.vibe_coder), map: fmt(map.firstHire.vibe_coder) },
        "10 vibe coders": { base: fmt(tenth.vibe_coder), map: fmt(map.tenth.vibe_coder) },
        "campus opens": { base: "—", map: fmt(map.opened.campus) },
        "first 10x dev": { base: fmt(first["10x_dev"]), map: fmt(map.firstHire["10x_dev"]) },
        "core complete": { base: fmt(base.totalSeconds), map: fmt(map.totalSeconds) },
      });
      console.log({ lots: map.lots, spentOnHires: map.spentOnHires, spentOnLots: map.spentOnLots, spentOnProjects: map.spentOnProjects, services: map.services, spentOnServices: map.spentOnServices, stalled: map.stalledSeconds });
    }
    // PACING GUARDS, from the balance passes (2026-10-10: core 1.45 h
    // ungated, 1.26 h on a town with an 85% commute, 71 lots and 10 services
    // with one lot a kind that grows). Wide enough for tuning, tight enough to
    // catch a wall.
    expect(map.totalSeconds).toBeLessThan(base.totalSeconds * 1.5);
    expect(map.tenth.intern!).toBeLessThan(5 * 60);
    expect(map.opened.campus!).toBeLessThan(30 * 60);
    // Housing is part of hiring's price, not most of it.
    expect(map.spentOnLots).toBeLessThan(map.spentOnHires * 0.15);
    // A player places dozens of lots in a run, not hundreds.
    expect(map.lots).toBeLessThan(80);
    // And growing them is worth it: services get bought, not skipped.
    expect(map.services).toBeGreaterThan(3);
  });
});

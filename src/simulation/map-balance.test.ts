import { describe, expect, jest, test } from "bun:test";

import type { GeneratorId } from "../state/generators.store";
import { simulateCoreUpgradeRun } from "./simulate-core-run";
import { longestFlat, simulateMapRun } from "./simulate-map-run";

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
        "data centre": { base: "—", map: fmt(map.opened.datacentre) },
        "conference centre": { base: "—", map: fmt(map.opened.conference) },
        "IPO tower": { base: "—", map: fmt(map.opened.ipo) },
        "core complete": { base: fmt(base.totalSeconds), map: fmt(map.totalSeconds) },
      });
      console.log({ lots: map.lots, spentOnHires: map.spentOnHires, spentOnLots: map.spentOnLots, spentOnProjects: map.spentOnProjects, services: map.services, spentOnServices: map.spentOnServices, stalled: map.stalledSeconds, offices: map.offices, spentOnOffices: map.spentOnOffices });
    }
    // PACING GUARDS, from the balance passes (2026-10-12: core 1.45 h
    // ungated, 1.25 h on a town with an 85% commute, ~50 lots and 10 services
    // with one lot a kind that grows, the slop pit trucked when nearly full;
    // the Data Centre built on the way at 48 minutes, the later wonders past
    // the core run). Wide enough for tuning,
    // tight enough to catch a wall.
    expect(map.totalSeconds).toBeLessThan(base.totalSeconds * 1.5);
    expect(map.tenth.intern!).toBeLessThan(5 * 60);
    expect(map.opened.campus!).toBeLessThan(30 * 60);
    // GATED BY UPGRADES AND HEADCOUNTS (2026-10-13: studio 7.8 min, campus
    // 25 min, the Data Centre at 52 min on 120 interns, 50 vibe coders and
    // three 10x devs). @see ProjectDef.gate
    expect(map.opened.datacentre!).toBeLessThan(60 * 60);
    // Housing is part of hiring's price, not most of it.
    expect(map.spentOnLots).toBeLessThan(map.spentOnHires * 0.15);
    // A player places dozens of lots in a run, not hundreds. (Eighty since the
    // Data Centre wants 120 interns housed, 2026-10-13.)
    expect(map.lots).toBeLessThan(100);
    // And growing them is worth it: services get bought, not skipped.
    expect(map.services).toBeGreaterThan(3);
    // DESKS are room to work: offices get bought, and cost a share of hiring, not a wall. @see seat
    expect(map.offices).toBeGreaterThan(3);
    expect(map.spentOnOffices).toBeLessThan(map.spentOnHires * 0.2);
  });
});

describe("the late game", () => {
  test("three hours past the core: the wonders built, the town content, nothing running away", () => {
    const tick = jest.advanceTimersByTime.bind(jest);
    const run = simulateMapRun(tick, { maxSimulatedSeconds: 86400 * 7, afterCore: 3 * 3600 });
    if (process.env.BALANCE) {
      console.table({
        "core complete": fmt(run.coreAt ?? undefined),
        "data centre": fmt(run.opened.datacentre),
        "conference centre": fmt(run.opened.conference),
        "IPO tower": fmt(run.opened.ipo),
        "longest flat, to the core": fmt(longestFlat(run, run.coreAt ?? undefined).seconds),
        "first AI agent": fmt(run.firstAgent ?? undefined),
        "longest flat, to the first sale": run.saleAt === null ? "—" : `${fmt(longestFlat(run, run.saleAt).seconds)} (sale ${fmt(run.saleAt)})`,
        "agents · racks": `${run.agents} · ${run.racks}`,
        "longest flat, all run": `${fmt(longestFlat(run).seconds)} from ${fmt(longestFlat(run).from)}`,
      });
      console.log({
        labs: run.labs, spentOnLabs: run.spentOnLabs, lots: run.lots, services: run.services,
        mood: run.mood, townBonus: run.townBonus, income: run.income, spentOnHires: run.spentOnHires,
        slopAt: run.slopAt, seweredAt: run.seweredAt, refineryAt: run.refineryAt, refineries: run.refineries, sewers: run.sewers, peakSlop: run.peakSlop, spentOnSlop: run.spentOnSlop, offices: run.offices, spentOnOffices: run.spentOnOffices,
      });
      console.table(run.headcount.map((h) => ({ at: fmt(h.at), ...h.owned })));
    }
    // LATE-GAME GUARDS (2026-10-13, the wonders gated by headcounts of every
    // kind: the conference centre at 1.2 h, the IPO tower at 1.8 h — within a
    // first run's reach, where at 15 10x devs it never was).
    expect(run.coreAt).not.toBeNull();
    expect(run.opened.conference!).toBeLessThan(3 * 3600);
    expect(run.opened.ipo!).toBeLessThan(3 * 3600);
    // THE SALE AS THE RUN'S END (2026-10-13): valuation accrues 2.5× what it
    // did and the IPO tower doubles it, so a first company can be sold about
    // 2.3 h in — where at 4 h it still could not. @see OFFER_PREMIUM
    // (To the minute since 2026-10-31, where the half-hourly headcount put it
    // at the next half hour: 2.02 h read as 2.50 h.) @see MapRunReport.saleAt
    expect(run.saleAt).not.toBeNull();
    expect(run.saleAt!).toBeLessThanOrEqual(2.5 * 3600);
    // NO WALL ON THE WAY TO IT (2026-10-13): AI agents carry the late game,
    // 18 of them in five racks, the longest stretch with nothing new 11.7 min
    // where after the IPO tower it was 2.3 h. @see game/agents, longestFlat
    expect(longestFlat(run, run.saleAt!).seconds).toBeLessThan(15 * 60);
    expect(run.agents).toBeGreaterThan(5);
    // SLOP SEEN TO (2026-10-28, the pit gone for tanks and sewers): a sewer
    // paid for within a couple of minutes of the first slop. @see SIM_SEWER_TILES
    if (run.slopAt !== null) expect(run.seweredAt! - run.slopAt).toBeLessThan(120);
    // Income never collapses: the last half hour still earns.
    expect(run.income).toBeGreaterThan(0);
    // No kind's town is miserable on a well-served map.
    for (const m of Object.values(run.mood)) expect(m!).toBeGreaterThan(-15);
    expect(run.spentOnOffices).toBeLessThan(run.spentOnHires * 0.2);
  });
});

describe("slop", () => {
  test("spilt, it costs the run; refined or farmed, it pays without running away", () => {
    const run = (slop: "spill" | "sewer" | "refine" | "farm") =>
      simulateMapRun(jest.advanceTimersByTime.bind(jest), { maxSimulatedSeconds: 86400 * 7, afterCore: 3 * 3600, slop });
    const spill = run("spill"), sewer = run("sewer"), refine = run("refine"), farm = run("farm");
    const ips = (r: typeof spill) => (r.headcount[r.headcount.length - 1].owned as Record<string, number>).ips;
    if (process.env.BALANCE) {
      console.table(Object.fromEntries(Object.entries({ spill, sewer, refine, farm }).map(([k, r]) => [k, {
        ipo: fmt(r.opened.ipo), sale: fmt(r.saleAt ?? undefined), agents: r.agents, ips: ips(r), mopping: r.peakMopping,
        vibeMood: r.mood.vibe_coder?.toFixed(1), processors: r.refineries, sewers: r.sewers, peakSlop: r.peakSlop.toFixed(2),
        spentOnSlop: r.spentOnSlop.toExponential(2),
      }])));
    }
    // THE BALANCE PASS (2026-10-31): slop from 48 min, 1.85 a second at its
    // height, two sewers' worth. Left to spill, 23 vibe coders mop and their
    // street sulks (-9.6): the IPO 11 min later, the sale 12. Sewered, the
    // sewers cost nothing to speak of. Four refineries, ~1% of what hiring
    // costs, +63% innovation and two more agents, the sale where it was. Four
    // content farms, ungated, the sale 5 min sooner and 15% more Equity.
    expect(spill.saleAt!).toBeGreaterThan(sewer.saleAt! + 5 * 60);
    expect(spill.peakMopping).toBeGreaterThan(10);
    expect(sewer.spentOnSlop).toBeLessThan(sewer.spentOnHires * 0.01);
    expect(ips(refine)).toBeGreaterThan(ips(sewer) * 1.3);
    expect(ips(refine)).toBeLessThan(ips(sewer) * 2);
    expect(refine.spentOnSlop).toBeLessThan(refine.spentOnHires * 0.05);
    expect(farm.saleAt!).toBeGreaterThan(sewer.saleAt! - 15 * 60);
  }, 60_000);
});

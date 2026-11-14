import { afterEach, describe, expect, jest, test } from "bun:test";

import { housedBy, residentsIn, roomFor, setHousingReader } from "../game/housing";
import { PROJECTS, setProjectReader } from "../game/projects";
import { peopleDesk } from "../world/ai/pilot/desks/people";
import { allDesks, livePurse } from "../world/ai/pilot/live";
import { desksShort } from "../world/ai/masterplan/schedule";
import { PACE, createPilot } from "../world/ai/pilot/pilot";
import { shownAs } from "../world/ai/pilot/job";
import { useGeneratorStore } from "../state/generators.store";
import { useSessionStore } from "../state/session.store";
import { playRules } from "../state/world.store";
import type { Grid } from "../world/grid";
import { placeStructure, startProject } from "../world/play/build-actions";
import { builtProjects, nearestSpot } from "../world/projects/works";
import { structureDef } from "../world/structures/def";
import { getAiRunner, stepAi } from "../world/ai/ai-runner";
import { lastStep, planInline, stepAutopilot, stepsTaken } from "../world/ai/autopilot";
import { neededSewer } from "../world/ai/sewer-ai";
import { tanksOf } from "../world/slop/tanks";
import { portsOf } from "../world/water/ports";
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
  console.log("ports " + r.ports + ", paid $" + Math.round(r.portsPaid) + " · agents " + r.agents);
  console.log("slop spilling " + mins(r.spill.seconds) + " in all, " + mins(r.spill.longest) + " at a stretch");
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

  test("the People desk, on a town given to it: all three kinds hired, every upgrade bought, never a tick without words, never a fault", () => {
    const pilot = createPilot([peopleDesk()], { strict: true });
    let unnamed = 0, frames = 0, ready = 0, longestReady = 0;
    const kinds: Record<string, number> = {};
    const r = playCompany(jest.advanceTimersByTime.bind(jest), {
      seed: 1, size: 64, minutes: 90,
      // THE TOWN GIVEN: beds for everyone and every project standing, so only the desk is on trial.
      begin: () => {
        setHousingReader(() => ({ intern: 400, vibe_coder: 150, "10x_dev": 8 }));
        setProjectReader(() => ({ built: new Set(PROJECTS.map((p) => p.id)), away: {} }));
      },
      drive: (g, dt) => {
        const st = pilot.tick(dt, livePurse, g.rev);
        frames++;
        if (!st.says) unnamed++;
        ready = st.kind === "next" ? ready + dt : 0;
        longestReady = Math.max(longestReady, ready);
        kinds[st.kind] = (kinds[st.kind] ?? 0) + 1;
      },
      steps: pilot.done,
      said: pilot.last,
    });
    if (process.env.BALANCE) {
      print(r);
      console.log("states, share of frames: " + Object.entries(kinds).map(([k, n]) => k + " " + ((100 * n) / frames).toFixed(1) + "%").join(", "));
      console.log("queue at the end: " + pilot.queue().map((q) => q.job.says + " [$" + q.job.cost.toExponential(2) + ", +" + q.job.gain.toExponential(2) + "/s, " + shownAs(q.shown) + "]").join(" | "));
      console.log("log: " + pilot.log().slice(0, 6).map((l) => mins(l.at) + " " + l.text).join(" | "));
    }
    expect(unnamed).toBe(0);
    expect(pilot.faults()).toBe(0);
    for (const kind of ["intern", "vibe_coder", "10x_dev"] as const) expect(r.staff[kind] ?? 0).toBeGreaterThan(0);
    // Every bed filled; and every upgrade bought that could be: what is left costs more than the company has.
    expect(r.staff).toEqual({ intern: 400, vibe_coder: 150, "10x_dev": 8 });
    expect(r.upgrades.bought).toBeGreaterThanOrEqual(25);
    for (const q of pilot.queue()) {
      expect(["waiting", "saving"]).toContain(q.shown.state);
      if (q.shown.state === "saving") expect(q.job.cost).toBeGreaterThan(r.money);
    }
    // Never with a job ready and not done, beyond its pace.
    expect(longestReady).toBeLessThanOrEqual(PACE + 1);
  }, 300_000);

  test("the People desk alone on a fresh company: with nothing it can do, it says what it is waiting for", () => {
    const pilot = createPilot([peopleDesk()], { strict: true });
    const r = playCompany(jest.advanceTimersByTime.bind(jest), {
      seed: 1, size: 64, minutes: 5,
      drive: (g, dt) => { pilot.tick(dt, livePurse, g.rev); },
      steps: pilot.done, said: pilot.last,
    });
    if (process.env.BALANCE) console.log("fresh, People only: " + pilot.status().says + " · staff " + JSON.stringify(r.staff));
    // No Landmarks desk yet to build the garage that opens hiring: it waits, and names the garage.
    expect(pilot.status().kind).toBe("waiting");
    expect(pilot.status().says).toMatch(/after .*garage/i);
    expect(pilot.faults()).toBe(0);
  }, 120_000);

  /** People living on the map with no desk to go to, by kind. */
  const perched = (g: Grid) => desksShort(g, { rules: playRules(g), kinds: ["intern", "vibe_coder"], offices: true }).map((k) => [k.who, k.now] as const);
  const housed = (g: Grid) => { let n = 0; for (const s of g.structures.values()) if (!s.build && housedBy(s.def)) n += residentsIn(s); return n; };

  /** The pilot from an empty map, every desk it has. */
  const townRun = (seed: number, size: number, minutes: number, until?: (g: Grid) => boolean, untilSale = false) => {
    const pilot = createPilot(allDesks(), { strict: true });
    let unnamed = 0;
    let map: Grid | null = null;
    const r = playCompany(jest.advanceTimersByTime.bind(jest), {
      seed, size, minutes, until, untilSale,
      begin: (g) => { map = g; },
      drive: (g, dt) => {
        if (!pilot.tick(dt, livePurse, g.rev).says) unnamed++;
      },
      steps: pilot.done, said: pilot.last,
    });
    const g = map!;
    if (process.env.BALANCE) {
      print(r);
      console.log("at the end: " + pilot.status().says + " · perched " + JSON.stringify(perched(g)) + " · refusals " + pilot.log().filter((l) => l.kind === "refused").length);
      // EVERY TANK SPILLING at the end, and what the sewer planner makes of it.
      for (const [id, tank] of tanksOf(g)) {
        const x = g.structures.get(id);
        if (!x || !tank.spilling) continue;
        const p = portsOf(g, x).find((q) => q.port.fluid === "slop" && q.port.dir === "out");
        console.log("spilling: " + x.def + " at " + x.x + "," + x.y + " · port " + (p ? p.x + "," + p.y + " main " + g.main[p.i] + " paved " + g.paved[p.i] + " under " + g.structureAt[p.i] : "none") + " · planner: " + (neededSewer(g)?.key ?? "nothing"));
      }
      const refused = new Map<string, number>();
      for (const l of pilot.log()) if (l.kind === "refused") refused.set(l.text, (refused.get(l.text) ?? 0) + 1);
      console.log("refused: " + ([...refused].map(([text, n]) => n + "× " + text).join(" | ") || "nothing"));
      console.log("queue: " + pilot.queue().map((q) => q.job.says + " [" + shownAs(q.shown) + "]").join(" | "));
    }
    expect(unnamed).toBe(0);
    expect(pilot.faults()).toBe(0);
    // NO TANK SPILLING FOR TWO MINUTES: the Water desk's. @see plans/ai-mode-rebuild.md phase 4
    expect(r.spill.longest).toBeLessThan(120);
    return { r, g, pilot };
  };
  /** Two hundred hired, living on the map, and none of them without a desk. */
  const settled = (g: Grid) => {
    const staff = useGeneratorStore.getState().generators.reduce((n, x) => n + x.amount, 0);
    return staff >= 200 && housed(g) >= 200 && perched(g).every(([, n]) => n <= 0);
  };

  test("from an empty map, by itself: the garage, the studio, and two hundred people housed and at desks — never a fault", () => {
    const { r, g } = townRun(1, 64, 45, settled);
    expect(settled(g)).toBe(true);
    expect(r.seconds).toBeLessThan(35 * 60);
    // Its own doing: nobody began the garage or the studio for it.
    expect(r.opened.garage).toBeDefined();
    expect(r.opened.studio).toBeDefined();
    expect(r.staff.vibe_coder ?? 0).toBeGreaterThan(0);
    expect(r.upgrades.bought).toBeGreaterThan(5);
  }, 600_000);

  // ON EVERY SEED, and then an hour of it: the town it has built still housed and desked at the end.
  test.skipIf(!process.env.BALANCE || !!process.env.IPO)("the pilot on six maps, and an hour on one", () => {
    const only = process.env.SEED ? Number(process.env.SEED) : null;
    for (const [seed, size] of ([[1, 64], [2, 64], [7, 96], [11, 96], [23, 128], [42, 128]] as const).filter(([n]) => !process.env.HOUR && (only === null || n === only))) {
      const { r, g } = townRun(seed, size, 45, settled);
      expect(settled(g)).toBe(true);
      expect(r.seconds).toBeLessThan(40 * 60);
      expect(r.opened.studio).toBeDefined();
    }
    if (only === null || process.env.HOUR) {
      const { r, g, pilot } = townRun(only ?? 1, only === null || only < 7 ? 64 : 96, Number(process.env.MINUTES) || 60);
      expect(r.residents).toBeGreaterThan(400);
      // All three kinds, and the landmarks that open them.
      for (const kind of ["intern", "vibe_coder", "10x_dev"] as const) expect(r.staff[kind] ?? 0).toBeGreaterThan(0);
      for (const id of ["garage", "studio", "hq", "campus"] as const) expect(r.opened[id]).toBeDefined();
      // None perched beyond what one more office holds — or, more, their office is waiting on something it names
      // (the vibe coders' on a sewer, which is the Water desk's and not built yet) or being saved for.
      for (const [who, n] of perched(g)) {
        if (n <= 40) continue;
        const office = pilot.queue().find((q) => q.job.id === "desks:" + who);
        expect(["waiting", "saving"]).toContain(office?.shown.state);
      }
      expect(pilot.log().filter((l) => l.kind === "refused").length).toBeLessThan(5);
    }
  }, 3_000_000);

  // PHASE 3's BAR: the IPO Tower standing, by its own doing from five dollars.
  test.skipIf(!process.env.IPO)("to the IPO Tower", () => {
    const { r } = townRun(Number(process.env.SEED) || 1, 64, Number(process.env.MINUTES) || 240, (g) => builtProjects(g).has("ipo"));
    expect(r.opened.ipo).toBeDefined();
  }, 6_000_000);

  // PHASE 5's BAR: the company could be sold, by its own doing from five dollars, on every map.
  test.skipIf(!process.env.SALE)("to the acquisition offer", () => {
    const seed = Number(process.env.SEED) || 1;
    const size = ({ 1: 64, 2: 64, 7: 96, 11: 96, 23: 128, 42: 128 } as Record<number, number>)[seed] ?? 64;
    const { r } = townRun(seed, size, Number(process.env.MINUTES) || 120, undefined, !process.env.FULL);
    expect(r.saleAt).toBeDefined();
  }, 6_000_000);

  // THE NUMBER TO BEAT: today's AI mode, an hour on each of three maps. Printed, not held to anything.
  test.skipIf(!process.env.BALANCE)("today's AI mode, an hour a map", () => {
    for (const [seed, size] of [[1, 64], [7, 96], [23, 128]] as const) {
      print(playCompany(jest.advanceTimersByTime.bind(jest), { seed, size, minutes: 60, untilSale: true, ...autopilot }));
    }
    // And given $10,000 to start on, which gets it past its first hire.
    print(playCompany(jest.advanceTimersByTime.bind(jest), { seed: 1, size: 64, minutes: 60, untilSale: true, money: 10_000, ...autopilot }));
  }, 1_800_000);
});

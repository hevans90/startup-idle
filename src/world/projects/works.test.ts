import { afterEach, describe, expect, test } from "bun:test";

import {
  alreadyEarned, attendance, featureGateOpen, projectDef, projectGateOpen, setProjectReader,
} from "../../game/projects";
import { createTown, stepTown } from "../agents/town";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import {
  STALL_GRACE, builtProjects, catchUpWorks, createWorks, siteOf, startSiteCommand, stepWorks,
} from "./works";

const STUDIO = projectDef("studio")!;

/** A road along row 5 edge to edge, intern housing on its north side, room for a site on its south. */
function town() {
  const g = createGrid(30, 14);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  const history = createHistory();
  for (const x of [3, 6, 9]) commit(g, history, placeCommand(g, structureDef("kit:intern.t0")!, x, 4)!);
  return { g, history };
}

/** Run the town and its works for `seconds`, with a wallet. */
function run(g: Grid, seconds: number, wallet: { money: number }, owned = { intern: 10 }, onFrame?: () => void) {
  const net = createNetwork(g), t = createTown(), w = createWorks();
  const spend = (n: number) => (wallet.money >= n ? ((wallet.money -= n), true) : false);
  let now = 0;
  for (let k = 0; k < Math.round(seconds * 30); k++) {
    now += 1000 / 30;
    stepTown(t, g, net, 0, 1 / 30);
    stepWorks(w, g, net, t, owned, spend, 1 / 30, now);
    onFrame?.();
  }
  return { t, w };
}

describe("a project", () => {
  test("is laid out as a site, and nothing is paid until its materials are sent", () => {
    const { g, history } = town();
    commit(g, history, startSiteCommand(g, STUDIO, 12, 6, { needsRoad: true }, 0)!);
    const site = siteOf(g, STUDIO)!;
    expect(site.build).toMatchObject({ done: 0, delivered: 0, priority: 2 });
    expect(builtProjects(g).has("studio")).toBe(false);
  });

  test("is built by its crew walking there, with loads trucked in and paid for, and then opens", () => {
    const { g, history } = town();
    commit(g, history, startSiteCommand(g, STUDIO, 12, 6, { needsRoad: true }, 0)!);
    const wallet = { money: 10_000 };
    const { w } = run(g, 240, wallet, { intern: 10 });
    // Opened: the record is off, the studio stands, it was paid for in full.
    expect(siteOf(g, STUDIO)).toBeNull();
    expect(builtProjects(g).has("studio")).toBe(true);
    expect(wallet.money).toBeCloseTo(10_000 - STUDIO.cost, 6);
    expect(w.opened).toEqual(["studio"]);
  });

  test("takes its builders from their desks, half the interns at normal priority, and gives them back", () => {
    const { g, history } = town();
    commit(g, history, startSiteCommand(g, STUDIO, 12, 6, { needsRoad: true }, 0)!);
    const net = createNetwork(g), t = createTown(), w = createWorks();
    const wallet = { money: 10_000 };
    const spend = (n: number) => (wallet.money >= n ? ((wallet.money -= n), true) : false);
    let walking = 0, working = 0;
    // Thirty seconds: the furthest of them lives ten tiles off, at a walk.
    for (let k = 0; k < 30 * 30; k++) {
      stepTown(t, g, net, 0, 1 / 30);
      stepWorks(w, g, net, t, { intern: 10 }, spend, 1 / 30, k * 33);
      walking = Math.max(walking, t.movers.filter((m) => m.job?.role === "builder").length);
      working = Math.max(working, t.movers.filter((m) => m.job?.role === "working").length);
    }
    expect(w.away.intern).toBe(5);
    expect(walking).toBeGreaterThan(0);          // they walked there
    expect(working).toBe(5);                     // and are at work on the site
    // High priority: all of them.
    siteOf(g, STUDIO)!.build!.priority = 3;
    for (let k = 0; k < 30; k++) stepWorks(w, g, net, t, { intern: 10 }, spend, 1 / 30, 40_000 + k * 33);
    expect(w.away.intern).toBe(10);
    // Paused: nobody, and the ones on site walk home.
    siteOf(g, STUDIO)!.build!.priority = 0;
    stepWorks(w, g, net, t, { intern: 10 }, spend, 1 / 30, 50_000);
    expect(w.away.intern ?? 0).toBe(0);
    expect(t.movers.filter((m) => m.job?.role === "working")).toHaveLength(0);
    expect(t.movers.some((m) => m.job?.role === "home")).toBe(true);
  });

  test("stalls with no money for its next load, and its crew goes home", () => {
    const { g, history } = town();
    commit(g, history, startSiteCommand(g, STUDIO, 12, 6, { needsRoad: true }, 0)!);
    const wallet = { money: STUDIO.cost / STUDIO.deliveries * 2 };   // two loads' worth
    const { w } = run(g, 120, wallet);
    const b = siteOf(g, STUDIO)!.build!;
    expect(b.delivered).toBe(2);
    expect(b.done).toBeCloseTo((b.need * 2) / b.deliveries, 3);
    expect(w.stalled.get(siteOf(g, STUDIO)!.id)! > STALL_GRACE).toBe(true);
    expect(w.away.intern ?? 0).toBe(0);
  });

  test("goes on while you are away, as far as the money does", () => {
    const { g, history } = town();
    commit(g, history, startSiteCommand(g, STUDIO, 12, 6, { needsRoad: true }, 0)!);
    const wallet = { money: 10_000 };
    const spend = (n: number) => (wallet.money >= n ? ((wallet.money -= n), true) : false);
    // An hour away with ten interns, five building: done long since.
    expect(catchUpWorks(g, { intern: 10 }, spend, 3600_000)).toEqual(["studio"]);
    expect(builtProjects(g).has("studio")).toBe(true);
    expect(wallet.money).toBeCloseTo(10_000 - STUDIO.cost, 6);
  });
});

describe("the economy's side", () => {
  afterEach(() => setProjectReader(() => ({ built: new Set(), away: {} }))());

  test("with no map, nothing is gated and nobody is away", () => {
    expect(projectGateOpen("vibe_coder")).toBe(true);
    expect(attendance("intern", 10)).toBe(1);
  });

  test("with a map, vibe coders wait for the studio, and builders are not at their desks", () => {
    const stop = setProjectReader(() => ({ built: new Set(), away: { intern: 4 } }));
    expect(projectGateOpen("vibe_coder")).toBe(false);
    expect(projectGateOpen("intern")).toBe(true);
    expect(attendance("intern", 10)).toBeCloseTo(0.6, 9);
    stop();
    setProjectReader(() => ({ built: new Set(["studio"]), away: {} }));
    expect(projectGateOpen("vibe_coder")).toBe(true);
  });
});

describe("the HQ", () => {
  const HQ = projectDef("hq")!;

  test("waits on ten vibe coders, and is built by interns and vibe coders both, split by headcount", () => {
    expect(HQ.ready({ intern: 40, vibe_coder: 9 })).toBe(false);
    expect(HQ.ready({ intern: 40, vibe_coder: 10 })).toBe(true);
    const { g, history } = town();
    commit(g, history, startSiteCommand(g, HQ, 12, 6, { needsRoad: true }, 0)!);
    const net = createNetwork(g), t = createTown(), w = createWorks();
    stepWorks(w, g, net, t, { intern: 30, vibe_coder: 10 }, () => true, 1 / 30, 0);
    // Normal priority: half of forty, split three to one.
    expect(w.away).toEqual({ intern: 15, vibe_coder: 5 });
  });

  test("opens managers: shut until it stands, where there is a map", () => {
    const stop = setProjectReader(() => ({ built: new Set(["studio"]), away: {} }));
    expect(featureGateOpen("managers")).toBe(false);
    stop();
    const stop2 = setProjectReader(() => ({ built: new Set(["studio", "hq"]), away: {} }));
    expect(featureGateOpen("managers")).toBe(true);
    stop2();
    // With no map, never shut.
    expect(featureGateOpen("managers")).toBe(true);
  });

  test("is given finished to a company that already has managers", () => {
    expect(alreadyEarned(HQ, {}, new Set(["managers"]))).toBe(true);
    expect(alreadyEarned(HQ, { vibe_coder: 50 }, new Set())).toBe(false);
    expect(alreadyEarned(STUDIO, { vibe_coder: 1 }, new Set())).toBe(true);
  });
});

import { afterEach, describe, expect, test } from "bun:test";

import {
  PROJECTS, alreadyEarned, attendance, featureGateOpen, projectCost, projectDef, wonderBonus, projectGateOpen, setProjectReader,
} from "../../game/projects";
import { UPGRADES } from "../../state/upgrades.store";
import { createTown, stepTown } from "../agents/town";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import {
  STALL_GRACE, builtProjects, catchUpWorks, createWorks, depotFor, projectUnderWay, ruledOut, siteOf, startSiteCommand, stepWorks,
} from "./works";
import { placesOf } from "../agents/roads";

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
    expect(wallet.money).toBeCloseTo(10_000 - STUDIO.floor, 6);
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
    const wallet = { money: STUDIO.floor / STUDIO.deliveries * 2 };   // two loads' worth
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
    expect(wallet.money).toBeCloseTo(10_000 - STUDIO.floor, 6);
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
    expect(projectGateOpen("intern")).toBe(false);      // the garage comes first
    expect(attendance("intern", 10)).toBeCloseTo(0.6, 9);
    stop();
    setProjectReader(() => ({ built: new Set(["studio"]), away: {} }));
    expect(projectGateOpen("vibe_coder")).toBe(true);
  });
});

describe("the HQ", () => {
  const HQ = projectDef("hq")!;

  test("waits on Focus Vibing, and is built by interns and vibe coders both, split by headcount", () => {
    expect(HQ.ready({ intern: 40, vibe_coder: 50 }, new Set())).toBe(false);
    expect(HQ.ready({}, new Set(["vibe_coder_upgrade_1"]))).toBe(true);
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

describe("the Founder's Garage", () => {
  const GARAGE = projectDef("garage")!;

  test("is ready from the start, built by the founder alone, for nothing, and opens interns", () => {
    expect(GARAGE.ready({}, new Set())).toBe(true);
    expect(GARAGE.unlocks).toBe("intern");
    const { g, history } = town();
    commit(g, history, startSiteCommand(g, GARAGE, 12, 6, { needsRoad: true }, 0)!);
    const wallet = { money: 0 };
    const { w, t } = run(g, 120, wallet, {});
    // Opened: on a free load, by one builder who is nobody's desk.
    expect(builtProjects(g).has("garage")).toBe(true);
    expect(wallet.money).toBe(0);
    expect(w.away).toEqual({});
    void t;
  });

  test("its founder drives in, and works on foot", () => {
    const { g, history } = town();
    commit(g, history, startSiteCommand(g, GARAGE, 12, 6, { needsRoad: true }, 0)!);
    const net = createNetwork(g), tw = createTown(), w = createWorks();
    let drove = false, worked = false;
    for (let k = 0; k < 30 * 40; k++) {
      stepTown(tw, g, net, 0, 1 / 30);
      stepWorks(w, g, net, tw, {}, () => true, 1 / 30, k * 33);
      drove ||= tw.movers.some((m) => m.job?.role === "builder" && m.kind === "car");
      worked ||= tw.movers.some((m) => m.job?.role === "working" && m.kind === "person");
    }
    expect(drove).toBe(true);
    expect(worked).toBe(true);
  });

  test("is given finished to a company that already has interns", () => {
    expect(alreadyEarned(GARAGE, { intern: 3 }, new Set())).toBe(true);
    expect(alreadyEarned(GARAGE, {}, new Set())).toBe(false);
  });
});

describe("the Boardroom Tower", () => {
  const BOARDROOM = projectDef("boardroom")!;

  test("waits on Upward Management alone, and opens mandates where there is a map", () => {
    expect(BOARDROOM.ready({ vibe_coder: 100 }, new Set())).toBe(false);
    expect(BOARDROOM.ready({}, new Set(["intern_hybrid_upgrade_1"]))).toBe(true);
    const stop = setProjectReader(() => ({ built: new Set(["studio", "hq"]), away: {} }));
    expect(featureGateOpen("mandates")).toBe(false);
    stop();
    const stop2 = setProjectReader(() => ({ built: new Set(["boardroom"]), away: {} }));
    expect(featureGateOpen("mandates")).toBe(true);
    stop2();
    expect(featureGateOpen("mandates")).toBe(true);
  });

  test("is given finished to a company already passing mandates", () => {
    expect(alreadyEarned(BOARDROOM, {}, new Set(["mandates"]))).toBe(true);
    expect(alreadyEarned(BOARDROOM, {}, new Set(["managers"]))).toBe(false);
  });
});

describe("the Campus", () => {
  const CAMPUS = projectDef("campus")!;

  test("waits on JUULing, and gates 10x devs until it stands", () => {
    expect(CAMPUS.ready({ vibe_coder: 200 }, new Set())).toBe(false);
    expect(CAMPUS.ready({}, new Set(["vibe_coder_upgrade_2"]))).toBe(true);
    const stop = setProjectReader(() => ({ built: new Set(["garage", "studio"]), away: {} }));
    expect(projectGateOpen("10x_dev")).toBe(false);
    stop();
    const stop2 = setProjectReader(() => ({ built: new Set(["campus"]), away: {} }));
    expect(projectGateOpen("10x_dev")).toBe(true);
    stop2();
  });

  test("has a building to put up", () => {
    expect(structureDef(CAMPUS.structure)?.footprint.w).toBe(4);
    expect(structureDef(projectDef("boardroom")!.structure)?.footprint.w).toBe(3);
  });
});

describe("what a project costs", () => {
  test("is seconds of income, never under its floor, and fixed when the site is chosen", () => {
    // A company earning next to nothing pays the floor; one earning a lot pays its seconds.
    expect(projectCost(STUDIO, 1)).toBe(STUDIO.floor);
    expect(projectCost(STUDIO, 1e6)).toBe(STUDIO.incomeSeconds * 1e6);
    expect(projectCost(projectDef("garage")!, 1e9)).toBe(0);
    expect(projectCost(STUDIO, Number.NaN)).toBe(STUDIO.floor);
    expect(Number.isFinite(projectCost(STUDIO, 1e307))).toBe(true);
    const { g, history } = town();
    commit(g, history, startSiteCommand(g, STUDIO, 12, 6, { needsRoad: true }, 0, 1e4)!);
    const b = siteOf(g, STUDIO)!.build!;
    expect(b.cost).toBe(STUDIO.incomeSeconds * 1e4);
    // Each load is a share of that, however the income moves after.
    const wallet = { money: 1e9 };
    run(g, 10, wallet);
    // (Paid when sent, so a load on the road is paid for too.)
    const loads = (1e9 - wallet.money) / (b.cost / b.deliveries);
    expect(loads).toBeGreaterThanOrEqual(1);
    expect(loads).toBeCloseTo(Math.round(loads), 6);
  });
});

describe("the Town Hall and the Harbour Office", () => {
  test("open services and ports, shut until they stand where there is a map", () => {
    const TOWNHALL = projectDef("townhall")!, HARBOUR = projectDef("harbour")!;
    expect(TOWNHALL.grants).toBe("services");
    expect(HARBOUR.grants).toBe("ports");
    expect(TOWNHALL.ready({ intern: 500 }, new Set())).toBe(false);
    expect(TOWNHALL.ready({}, new Set(["intern_upgrade_2"]))).toBe(true);
    expect(HARBOUR.ready({}, new Set(["intern_upgrade_3"]))).toBe(true);
    const stop = setProjectReader(() => ({ built: new Set(["garage"]), away: {} }));
    expect(featureGateOpen("services")).toBe(false);
    expect(featureGateOpen("ports")).toBe(false);
    stop();
    const stop2 = setProjectReader(() => ({ built: new Set(["townhall", "harbour"]), away: {} }));
    expect(featureGateOpen("services")).toBe(true);
    expect(featureGateOpen("ports")).toBe(true);
    stop2();
  });

  test("are given finished to a company whose map already has services, or ports", () => {
    expect(alreadyEarned(projectDef("townhall")!, {}, new Set(["services"]))).toBe(true);
    expect(alreadyEarned(projectDef("harbour")!, {}, new Set(["ports"]))).toBe(true);
    expect(alreadyEarned(projectDef("harbour")!, {}, new Set(["services"]))).toBe(false);
  });
});

describe("every project's gate", () => {
  test("every project after the garage waits on an employee upgrade that exists, or a wonder on headcounts", () => {
    for (const p of PROJECTS) {
      if (p.id === "garage") { expect(p.gate).toEqual({}); continue; }
      if (p.bonus) expect(Object.keys(p.gate.staff ?? {}).length).toBeGreaterThan(0);
      else expect(UPGRADES.some((u) => u.id === p.gate.upgrade)).toBe(true);
    }
  });

  test("no two projects wait on the same upgrade", () => {
    const ids = PROJECTS.map((p) => p.gate.upgrade).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the wonders come in order: each needs at least as many of every kind as the one before", () => {
    const [a, b, c] = ["datacentre", "conference", "ipo"].map((id) => projectDef(id)!.gate.staff!);
    for (const who of ["intern", "vibe_coder", "10x_dev"] as const) {
      expect(b[who]!).toBeGreaterThanOrEqual(a[who]!);
      expect(c[who]!).toBeGreaterThanOrEqual(b[who]!);
    }
  });
});

describe("the wonders", () => {
  test("multiply what they say while they stand, and nothing with no map", () => {
    expect(wonderBonus("innovation")).toBe(1);
    const stop = setProjectReader(() => ({ built: new Set(["datacentre"]), away: {} }));
    expect(wonderBonus("innovation")).toBe(2);
    expect(wonderBonus("money")).toBe(1);
    stop();
    const stop2 = setProjectReader(() => ({ built: new Set(["datacentre", "conference", "ipo"]), away: {} }));
    // The conference centre's ×1.5, and the IPO tower's ×2.
    expect(wonderBonus("valuation")).toBe(3);
    expect(wonderBonus("money")).toBe(1.5);
    stop2();
  });

  test("come late, on headcounts of every kind at once, and each has a building", () => {
    for (const id of ["datacentre", "conference", "hackerspace", "ipo"] as const) {
      const p = projectDef(id)!;
      const staff = p.gate.staff!;
      expect(Object.keys(staff).sort()).toEqual(["10x_dev", "intern", "vibe_coder"]);
      expect(p.ready(staff, new Set())).toBe(true);
      // One short of any kind is not enough.
      for (const who of Object.keys(staff) as (keyof typeof staff)[]) {
        expect(p.ready({ ...staff, [who]: staff[who]! - 1 }, new Set())).toBe(false);
      }
      expect(structureDef(p.structure)).not.toBeNull();
    }
  });
});

describe("two sites at once", () => {
  test("each takes its share of whoever is still at a desk, so somebody is always earning", () => {
    const { g, history } = town();
    commit(g, history, startSiteCommand(g, STUDIO, 12, 6, { needsRoad: true }, 0)!);
    commit(g, history, startSiteCommand(g, projectDef("townhall")!, 20, 6, { needsRoad: true }, 0)!);
    const net = createNetwork(g), t = createTown(), w = createWorks();
    stepWorks(w, g, net, t, { intern: 20 }, () => true, 1 / 30, 0);
    // Normal is half: ten for the first, then half the ten left for the second.
    expect([...w.plan.values()].map((p) => p.want)).toEqual([10, 5]);
    expect(w.away.intern).toBe(15);
  });
});

describe("one project at a time", () => {
  test("the project under way is the one with a site, and there is none before or after", () => {
    const { g, history } = town();
    expect(projectUnderWay(g)).toBeNull();
    commit(g, history, startSiteCommand(g, STUDIO, 12, 6, { needsRoad: true }, 0)!);
    expect(projectUnderWay(g)?.id).toBe("studio");
    siteOf(g, STUDIO)!.build = undefined;
    expect(projectUnderWay(g)).toBeNull();
  });
});

describe("a fork", () => {
  test("the Conference Centre or the Hackerspace: a site for either rules the other out", () => {
    const g = createGrid(30, 14);
    fillTerrain(g, 1);
    for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
    const history = createHistory(), conf = projectDef("conference")!, hack = projectDef("hackerspace")!;
    expect(ruledOut(g, hack)).toBeNull();
    expect(ruledOut(g, conf)).toBeNull();
    commit(g, history, startSiteCommand(g, hack, 4, 6, { needsRoad: true }, 0)!);
    expect(ruledOut(g, conf)?.id).toBe("hackerspace");
    expect(ruledOut(g, hack)).toBeNull();
    expect(ruledOut(g, projectDef("ipo")!)).toBeNull();
  });
});

describe("a site's loads", () => {
  test("come from the Founder's Garage when it stands on the site's roads, else from the map's edge", () => {
    const { g, history } = town();
    commit(g, history, startSiteCommand(g, STUDIO, 12, 6, { needsRoad: true }, 0)!);
    const site = siteOf(g, STUDIO)!;
    const door = () => placesOf(g, createNetwork(g)).find((pl) => pl.structure === site.id)!;
    const depot = () => depotFor(g, placesOf(g, createNetwork(g)), site, door().net);
    expect(depot()?.kind).toBe("gateway");
    const garage = structureDef("garage")!;
    commit(g, history, placeCommand(g, garage, 20, 5 - garage.footprint.h, { needsRoad: true })!);
    const id = [...g.structures.values()].find((s) => s.def === "garage")!.id;
    expect(depot()?.structure).toBe(id);
    // Not while the garage is itself still going up.
    g.structures.get(id)!.build = { done: 0, need: 1, delivered: 0, deliveries: 1, cost: 0, priority: 2, updatedAt: 0 };
    expect(depot()?.kind).toBe("gateway");
  });
});

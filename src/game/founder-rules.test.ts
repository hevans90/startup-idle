import { afterEach, describe, expect, test } from "bun:test";

import { useFounderStore } from "../state/founder.store";
import { buildCost } from "./build-cost";
import { BOOTSTRAP_BUILD, FOUNDERS, HACKER_LABS, VISIONARY_DATACENTRE } from "./founders.catalog";
import { gateParts, labBonus, projectCost, projectDef, setProjectReader } from "./projects";

const as = (id: string | null) => useFounderStore.setState({ selectedFounderId: id });
afterEach(() => as(null));

describe("the founders' rules", () => {
  test("every founder but the NEET and the Agentic Delusionist plays by one", () => {
    const ruled = FOUNDERS.filter((f) => f.rule).map((f) => f.id).sort();
    expect(ruled).toEqual(["bootstrapper", "hacker", "hustler", "visionary"]);
  });

  test("the Bootstrapper builds for less, projects too", () => {
    const lot = buildCost("kit:intern.t0")!.toNumber(), studio = projectCost(projectDef("studio")!, 100);
    as("bootstrapper");
    expect(buildCost("kit:intern.t0")!.toNumber()).toBe(Math.round(lot * BOOTSTRAP_BUILD));
    expect(projectCost(projectDef("studio")!, 100)).toBe(Math.round(studio * BOOTSTRAP_BUILD));
  });

  test("the Visionary's Data Centre wants a share of the headcount, and nothing else changes", () => {
    const dc = projectDef("datacentre")!, ipo = projectDef("ipo")!;
    as("visionary");
    const need = gateParts(dc.gate, {}, new Set()).map((p) => (p.kind === "staff" ? p.need : 0));
    expect(need).toEqual([120, 50, 3].map((n) => Math.ceil(n * VISIONARY_DATACENTRE)));
    expect(dc.ready({ intern: 60, vibe_coder: 25, "10x_dev": 2 }, new Set())).toBe(true);
    expect(ipo.ready({ intern: 175, vibe_coder: 75, "10x_dev": 4 }, new Set())).toBe(false);
    as(null);
    expect(dc.ready({ intern: 60, vibe_coder: 25, "10x_dev": 2 }, new Set())).toBe(false);
  });

  test("the Hacker's labs count double", () => {
    const stop = setProjectReader(() => ({ built: new Set(), away: {}, labs: { count: 2, mult: 1.2 } }));
    expect(labBonus()).toBeCloseTo(1.2);
    as("hacker");
    expect(labBonus()).toBeCloseTo(1 + 0.2 * HACKER_LABS);
    stop();
  });
});

describe("a founder held to one kind", () => {
  test("is gated on that kind alone: no other kind's upgrade, no headcount they cannot hire", () => {
    useFounderStore.setState({ onlyGenerator: "vibe_coder" });
    try {
      expect(projectDef("townhall")!.ready({}, new Set())).toBe(true);
      expect(projectDef("hq")!.ready({}, new Set())).toBe(false);
      expect(projectDef("datacentre")!.ready({ vibe_coder: 50 }, new Set())).toBe(true);
      expect(projectDef("datacentre")!.ready({ vibe_coder: 49 }, new Set())).toBe(false);
    } finally {
      useFounderStore.setState({ onlyGenerator: null });
    }
  });
});

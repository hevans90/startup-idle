import { describe, expect, test } from "bun:test";

import { projectDef } from "../../game/projects";
import { UPGRADES } from "../../state/upgrades.store";
import { HINTS, nextHint, type HintState } from "./hints";

const state = (over: Partial<HintState> = {}): HintState => ({
  owned: { intern: 0, vibe_coder: 0, "10x_dev": 0 },
  built: new Set(), sites: new Set(), ready: new Set(["garage"]),
  lots: 0, residents: 0, awaiting: 0, services: 0, offices: 0, worstCommute: 1, wondersOpened: false, worstMood: 0, moodShown: false,
  freeFrontage: Infinity, landForSale: false, parcelsBought: 0, labs: 0, racks: 0, levees: 0, floodWarning: false, deskless: 0,
  ...over,
});

describe("first-run hints", () => {
  test("a new company is told to choose a site for its garage, and the projects log glows", () => {
    const { show } = nextHint(state(), new Set());
    expect(show?.id).toBe("garage-site");
    expect(show?.target).toBe("projects");
  });

  test("move on as the goals are met, one at a time", () => {
    expect(nextHint(state({ ready: new Set(), sites: new Set(["garage"]) }), new Set()).show?.id).toBe("garage-wait");
    expect(nextHint(state({ ready: new Set(), built: new Set(["garage"]) }), new Set()).show?.id).toBe("first-hire");
    expect(nextHint(state({ ready: new Set(), built: new Set(["garage"]), owned: { intern: 2, vibe_coder: 0, "10x_dev": 0 } }), new Set()).show?.id)
      .toBe("zone-lots");
  });

  test("an established company is told nothing it has already done, and those are put away unseen", () => {
    const s = state({
      ready: new Set(), built: new Set(["garage", "townhall", "studio"]), lots: 12, residents: 30, services: 2,
      owned: { intern: 40, vibe_coder: 0, "10x_dev": 0 },
    });
    const { show, settled } = nextHint(s, new Set());
    expect(show).toBeNull();
    expect(settled).toEqual(expect.arrayContaining(["garage-site", "garage-wait", "first-hire", "zone-lots", "arrivals", "townhall", "services"]));
  });

  test("a dismissed hint is not shown again", () => {
    expect(nextHint(state(), new Set(["garage-site"])).show).toBeNull();
  });

  test("a long commute with no office suggests one", () => {
    const s = state({ ready: new Set(), built: new Set(["garage", "townhall"]), lots: 4, residents: 8, services: 1, owned: { intern: 10, vibe_coder: 0, "10x_dev": 0 }, worstCommute: 0.6 });
    expect(nextHint(s, new Set()).show?.id).toBe("commute");
  });

  test("the newer systems, each when it comes up", () => {
    const settled = { ready: new Set<string>(), built: new Set(["garage", "townhall"]), lots: 4, residents: 8, services: 1, owned: { intern: 10, vibe_coder: 0, "10x_dev": 0 } };
    expect(nextHint(state({ ...settled, landForSale: true, freeFrontage: 3 }), new Set()).show?.id).toBe("land");
    expect(nextHint(state({ ...settled, landForSale: true, freeFrontage: 3, parcelsBought: 1 }), new Set()).show).toBeNull();
    expect(nextHint(state({ ...settled, built: new Set(["garage", "townhall", "campus"]) }), new Set()).show?.id).toBe("labs");
    expect(nextHint(state({ ...settled, floodWarning: true }), new Set()).show?.id).toBe("flood-walls");
    expect(nextHint(state({ ...settled, floodWarning: true, levees: 3 }), new Set()).show).toBeNull();
  });

  test("people without desks are told an office adds some", () => {
    const s = state({ ready: new Set(), built: new Set(["garage", "townhall"]), lots: 12, residents: 30, services: 2, owned: { intern: 30, vibe_coder: 0, "10x_dev": 0 }, deskless: 6 });
    expect(nextHint(s, new Set()).show?.id).toBe("desks");
  });
});

describe("the gate hint", () => {
  test("comes when the studio is the thing in the way, and goes when it can be started", () => {
    const s = state({ ready: new Set(), built: new Set(["garage"]), lots: 8, residents: 16, owned: { intern: 16, vibe_coder: 0, "10x_dev": 0 } });
    expect(nextHint(s, new Set()).show?.id).toBe("gates");
    expect(nextHint({ ...s, ready: new Set(["studio"]) }, new Set()).show?.id).not.toBe("gates");
  });

  test("names the studio's own gate", () => {
    const hint = HINTS.find((h) => h.id === "gates")!;
    const studio = projectDef("studio")!;
    const name = UPGRADES.find((u) => u.id === studio.gate.upgrade)!.name;
    expect(hint.text).toContain(name);
  });
});

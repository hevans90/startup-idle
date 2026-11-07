import { describe, expect, test } from "bun:test";

import { useSessionStore } from "../../state/session.store";
import type { Place } from "../agents/roads";
import { createGrid, type Structure } from "../grid";
import { portDepot } from "../projects/works";
import {
  CONFERENCE_REACH, CONVOY_LOADS, CONVOY_PAYS, NEAR_CONFERENCE_PAYS, ROUTE_LOADS, convoyPays, loadPriceMult, portsNear, setConvoyIn,
} from "./convoy";

const put = (g: ReturnType<typeof createGrid>, s: Structure) => { g.structures.set(s.id, s); return s; };

describe("a convoy's calls", () => {
  test("pay double, and treble at a port near a standing Conference Centre", () => {
    const g = createGrid(40, 40);
    const near = put(g, { id: 1, def: "seaport", x: 2, y: 2, w: 2, h: 2 });
    const far = put(g, { id: 2, def: "seaport", x: 35, y: 35, w: 2, h: 2 });
    expect(convoyPays(g, near)).toBe(CONVOY_PAYS);
    const conf = put(g, { id: 3, def: "conference", x: 3 + CONFERENCE_REACH, y: 2, w: 4, h: 3, build: { done: 0, need: 1, delivered: 0, deliveries: 1, cost: 0, priority: 2, updatedAt: 0 } });
    // Not while it is a site.
    expect(convoyPays(g, near)).toBe(CONVOY_PAYS);
    delete conf.build;
    expect(convoyPays(g, near)).toBe(NEAR_CONFERENCE_PAYS);
    expect(convoyPays(g, far)).toBe(CONVOY_PAYS);
    expect(portsNear(g, conf, (s) => s.def === "seaport").map((s) => s.id)).toEqual([1]);
  });
});

describe("a convoy's materials", () => {
  test("halve a load while it is in, and every route won takes a tenth off for good", () => {
    useSessionStore.setState({ routes: 0 });
    setConvoyIn(false);
    expect(loadPriceMult()).toBe(1);
    setConvoyIn(true);
    expect(loadPriceMult()).toBe(CONVOY_LOADS);
    useSessionStore.setState({ routes: 3 });
    setConvoyIn(false);
    expect(loadPriceMult()).toBeCloseTo(1 - 3 * ROUTE_LOADS);
    useSessionStore.setState({ routes: 0 });
  });

  test("come off the boats at the nearest standing port on the site's roads", () => {
    const g = createGrid(40, 40);
    const site = put(g, { id: 9, def: "hq", x: 20, y: 20, w: 3, h: 3 });
    put(g, { id: 1, def: "seaport", x: 2, y: 2, w: 2, h: 2 });
    put(g, { id: 2, def: "seaport", x: 25, y: 20, w: 2, h: 2 });
    put(g, { id: 3, def: "seaport", x: 21, y: 24, w: 2, h: 2 });
    const pl = (structure: number, net: number) => ({ structure, net } as unknown as Place);
    expect(portDepot(g, [pl(1, 0), pl(2, 0), pl(3, 1)], site, 0)).toMatchObject({ structure: 2 });
    expect(portDepot(g, [pl(1, 0)], site, 1)).toBeNull();
  });
});

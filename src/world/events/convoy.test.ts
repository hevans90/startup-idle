import { describe, expect, test } from "bun:test";

import { createGrid, type Structure } from "../grid";
import { CONFERENCE_REACH, CONVOY_PAYS, NEAR_CONFERENCE_PAYS, convoyPays, portsNear } from "./convoy";

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

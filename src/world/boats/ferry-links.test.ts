/**
 * THE FERRY AS A WAY TO WORK: a port with a ferry ramp joins the roads on
 * its river's banks to its gate, so a street with no bridge to it is a few
 * tiles off and not cut off. @see ferry-links, plans/seaports.md "Left to do"
 */
import { describe, expect, test } from "bun:test";

import { walkFrom } from "../agents/commute";
import { createGrid, idx, setInflow, type Grid, type Structure } from "../grid";
import { SEAPORTS } from "../structures/def";
import { FERRY_REACH, FERRY_TILES, ferryLinks } from "./ferry-links";

/**
 * A river along y 6–10 from the west edge to the east; a road along y = 3 on
 * the north bank and one along y = 13 on the south, each with a spur to the
 * water's edge at x = 20 — and no bridge. A tier one port on the south bank,
 * x 20–21, y 11–12, facing the river, its gate on the south road.
 */
function town(fit: string[]): { g: Grid; port: Structure } {
  const g = createGrid(60, 18, 1);
  for (let y = 6; y <= 10; y++) for (let x = 0; x < 60; x++) { g.pool[idx(g, x, y)] = 4; g.height[idx(g, x, y)] = -5; setInflow(g, 0, y, 4); }
  for (let x = 2; x < 58; x++) { g.paved[idx(g, x, 3)] = 1; g.paved[idx(g, x, 13)] = 1; }
  for (const y of [4, 5]) g.paved[idx(g, 20, y)] = 1;
  const id = g.nextStructureId++;
  // E is y − 1: the port's quay is on its north side, on the river.
  const port = { id, def: SEAPORTS[0].id, kind: "", x: 20, y: 11, w: 2, h: 2, facing: "E", fit } as never as Structure;
  g.structures.set(id, port);
  for (let y = 11; y <= 12; y++) for (let x = 20; x <= 21; x++) g.structureAt[idx(g, x, y)] = id;
  g.rev++;
  return { g, port };
}

describe("a ferry ramp", () => {
  test("with none, the far bank's road is cut off: there is no way to it", () => {
    const { g } = town(["trade"]);
    expect(ferryLinks(g).size).toBe(0);
    const dist = walkFrom(g, [idx(g, 30, 13)]);
    expect(dist[idx(g, 10, 13)]).toBe(20);
    expect(dist[idx(g, 30, 3)]).toBe(-1);
  });

  test("joins its gate to the roads by its river, a few tiles of road across: the far bank is near", () => {
    const { g } = town(["ferry"]);
    const links = ferryLinks(g);
    // Its gate is the road under it; the landing, the spur that comes down to the water on the far bank.
    const gate = idx(g, 20, 13), landing = idx(g, 20, 5);
    expect(links.get(gate)).toContain(landing);
    expect(links.get(landing)).toContain(gate);
    // The road along the far bank is not itself by the water: it is reached by the spur.
    expect(links.has(idx(g, 30, 3))).toBe(false);
    const dist = walkFrom(g, [idx(g, 30, 13)]);
    // Nine tiles to the near end of the gate, the crossing to the spur's top, one more to the road, ten along.
    expect(dist[idx(g, 30, 3)]).toBe(9 + FERRY_TILES + 1 + 10);
    // And the same back.
    expect(walkFrom(g, [idx(g, 30, 3)])[idx(g, 30, 13)]).toBe(9 + FERRY_TILES + 1 + 10);
    // A road already joined is no further than it was.
    expect(dist[idx(g, 10, 13)]).toBe(20);
  });

  test("lands only within its reach along the river, and is gone with the fitting", () => {
    const { g, port } = town(["ferry"]);
    const far = 20 + FERRY_REACH + 6;
    g.paved[idx(g, far, 4)] = 1; g.paved[idx(g, far, 5)] = 1;
    g.rev++;
    expect(ferryLinks(g).has(idx(g, far, 5))).toBe(false);
    port.fit = ["trade"];
    g.rev++;
    expect(ferryLinks(g).size).toBe(0);
  });
});

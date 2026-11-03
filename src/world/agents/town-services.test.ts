import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { createNetwork } from "../roads/network";
import { streetsOf } from "../roads/streets";
import { structureDef } from "../structures/def";
import { placeCommand, validatePlacement } from "../structures/place";
import { placesOf } from "./roads";
import { coverageOf } from "./services";
import {
  CHECK_EVERY, CLOSE_AFTER, MIN_DEMAND, OPEN_GAP, createTownServices, neighbourhoodsOf, stepTown, type TownHands,
} from "./town-services";

/** A road along row 5, 40 long; things on its north side; each house two people. */
function street(things: [string, number][], rows = [5]) {
  const g = createGrid(40, 14);
  fillTerrain(g, 1);
  for (const r of rows) for (let x = 0; x < g.w; x++) g.paved[idx(g, x, r)] = 1;
  const h = createHistory();
  for (const [def, x] of things) {
    const d = structureDef(def)!;
    const cmd = placeCommand(g, d, x, 5 - d.footprint.h)!;
    for (const s of cmd.structures!.added) if (def.startsWith("kit:")) s.residents = 2;
    commit(g, h, cmd);
  }
  return { g, ids: [...g.structures.values()].map((s) => s.id) };
}
const lots = (who: string, xs: number[]) => xs.map((x) => [`kit:${who}.t0`, x] as [string, number]);

/** The game's hands, on this grid: placed with the road rule, cleared by deleting. */
function hands(g: Grid, rand = () => 0): TownHands & { cleared: number[] } {
  const cleared: number[] = [];
  return {
    cleared,
    canPlace: (def, x, y) => validatePlacement(g, structureDef(def)!, x, y, { needsRoad: true }).ok,
    place: (def, x, y) => { const cmd = placeCommand(g, structureDef(def)!, x, y, { needsRoad: true })!; commit(g, createHistory(), cmd); return cmd.structures!.added[0].id; },
    clear: (id) => { cleared.push(id); g.structures.delete(id); },
    rand,
  };
}
const step = (t: ReturnType<typeof createTownServices>, g: Grid, dt: number, h: TownHands) => {
  const net = createNetwork(g);
  return stepTown(t, g, net, coverageOf(g, placesOf(g, net)), dt, h);
};

describe("the town's own services", () => {
  test("a street with enough people lacking a need opens a shop for it in one of their houses", () => {
    const { g } = street(lots("intern", [8, 10, 12]));
    const t = createTownServices(), h = hands(g);
    expect(step(t, g, CHECK_EVERY - 1, h)).toEqual([]);
    const [open] = step(t, g, 1, h);
    // Food before nightlife, the tie broken by name; the first of its shops.
    expect(open).toMatchObject({ kind: "open", service: "takeaway" });
    expect(g.structures.get(open.structure)!.shop).toBe("takeaway");
  });

  test("fewer than MIN_DEMAND people wanting it: nothing opens", () => {
    const { g } = street(lots("intern", [8]));
    expect(2).toBeLessThan(MIN_DEMAND);
    expect(step(createTownServices(), g, CHECK_EVERY, hands(g))).toEqual([]);
  });

  test("a neighbourhood waits OPEN_GAP before opening the next thing, then sees to its next need", () => {
    const { g } = street(lots("intern", [8, 10, 12]));
    const t = createTownServices(), h = hands(g);
    step(t, g, CHECK_EVERY, h);
    for (let s = CHECK_EVERY; s < OPEN_GAP; s += CHECK_EVERY) expect(step(t, g, CHECK_EVERY, h)).toEqual([]);
    expect(step(t, g, CHECK_EVERY, h)).toEqual([expect.objectContaining({ kind: "open", service: "bar" })]);
  });

  test("a big service gets a building of its own, within reach of those lacking it", () => {
    const { g, ids } = street(lots("intern", [8, 10, 12]));
    g.structures.get(ids[0])!.shop = "bakery";
    // The second of nightlife's: the night club.
    const t = createTownServices(), h = hands(g, () => 0.4);
    const [open] = step(t, g, CHECK_EVERY, h);
    expect(open).toMatchObject({ kind: "open", service: "club" });
    const club = g.structures.get(open.structure)!;
    expect(club.def).toBe("club");
    const net = createNetwork(g), cover = coverageOf(g, placesOf(g, net));
    for (const id of ids) expect(cover.get(id)?.has("nightlife")).toBe(true);
  });

  test("a service with nobody of its kind near closes after CLOSE_AFTER — a building cleared, a shop shut", () => {
    const { g, ids } = street([["cafe", 20], ...lots("intern", [8])]);
    const house = g.structures.get(ids[1])!;
    house.shop = "vape";
    const t = createTownServices(), h = hands(g);
    for (let s = 0; s < CLOSE_AFTER - CHECK_EVERY; s += CHECK_EVERY) expect(step(t, g, CHECK_EVERY, h)).toEqual([]);
    const closed = step(t, g, CHECK_EVERY, h);
    expect(closed.map((e) => e.service).sort()).toEqual(["cafe", "vape"]);
    expect(h.cleared).toEqual([ids[0]]);
    expect(house.shop).toBeUndefined();
  });

  test("streets apart are neighbourhoods apart", () => {
    const { g } = street(lots("intern", [8, 10]), [5, 10]);
    const h = createHistory();
    for (const x of [8, 10]) commit(g, h, placeCommand(g, structureDef("kit:intern.t0")!, x, 9)!);
    const doors = new Map<number, number>();
    for (const p of placesOf(g, createNetwork(g))) if (p.kind === "door" && p.structure !== undefined) doors.set(p.structure, p.y * g.w + p.x);
    const hoods = neighbourhoodsOf(g, streetsOf(g), doors);
    expect(hoods.map((n) => n.homes.length)).toEqual([2, 2]);
  });
});

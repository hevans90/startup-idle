import { describe, expect, test } from "bun:test";

import { awaitingArrival, housingResidents } from "../../game/housing";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { BUS_SEATS, BUS_WAIT, createArrivals, settleHousing, stepArrivals } from "./arrivals";
import { createTown, stepTown } from "./town";

/** A road along row 5, edge to edge if `open`, and empty lots of `kit` along its north side. */
function street(kit: string, xs: number[], open = true) {
  const g = createGrid(30, 12);
  fillTerrain(g, 1);
  for (let x = open ? 0 : 2; x < (open ? g.w : g.w - 2); x++) g.paved[idx(g, x, 5)] = 1;
  const history = createHistory();
  for (const x of xs) {
    const cmd = placeCommand(g, structureDef(kit)!, x, 4)!;
    for (const s of cmd.structures!.added) s.residents = 0;
    commit(g, history, cmd);
  }
  return g;
}

/** Run arrivals and the town for `seconds`, counting the vehicles seen. */
function run(g: Grid, owned: Record<string, number>, seconds: number, remote: Record<string, number> = {}) {
  const net = createNetwork(g), t = createTown(), a = createArrivals();
  const seen = new Map<number, string>();
  for (let k = 0; k < Math.round(seconds * 30); k++) {
    stepTown(t, g, net, 0, 1 / 30);
    stepArrivals(a, g, net, t, owned, remote, 1 / 30);
    t.arrived.length = 0;
    for (const m of t.movers) if (m.job?.role === "arrive") seen.set(m.id, m.kind);
  }
  return { a, t, seen };
}

describe("new hires arriving", () => {
  test("interns come by ONE bus, which waits for a load, and move in", () => {
    const g = street("kit:intern.t0", [4, 8, 12]);
    const { seen, a } = run(g, { intern: 5 }, BUS_WAIT + 40);
    expect(housingResidents(g).intern).toBe(5);
    expect([...new Set(seen.values())]).toEqual(["bus"]);
    expect(a.rides.size).toBe(0);
  });

  test("a bus waits for its first intern a while, not for ever", () => {
    const g = street("kit:intern.t0", [4]);
    const early = run(g, { intern: 1 }, BUS_WAIT - 1);
    expect(early.seen.size).toBe(0);
    expect(early.a.status.intern?.waiting).toBe(1);
  });

  test("a full busload goes at once", () => {
    const g = street("kit:intern.t2", [4, 8]);
    const { seen } = run(g, { intern: BUS_SEATS }, 1);
    expect(seen.size).toBe(1);
  });

  test("vibe coders come by car, one each; 10x devs by limousine", () => {
    const g = street("kit:vibe_coder.t1", [6]);
    const cars = run(g, { vibe_coder: 3 }, 40);
    expect(housingResidents(g).vibe_coder).toBe(3);
    expect([...cars.seen.values()]).toEqual(["car", "car", "car"]);
    const g2 = street("kit:10x_dev.t0", [6]);
    const limos = run(g2, { "10x_dev": 1 }, 40);
    expect([...limos.seen.values()]).toEqual(["limo"]);
    expect(housingResidents(g2)["10x_dev"]).toBe(1);
  });

  test("fills a part-full house before starting on an empty one", () => {
    const g = street("kit:intern.t1", [4, 20]);
    [...g.structures.values()].find((s) => s.x === 20)!.residents = 1;
    run(g, { intern: 3 }, BUS_WAIT + 40);
    const by = Object.fromEntries([...g.structures.values()].map((s) => [s.x, s.residents]));
    expect(by).toEqual({ 4: 0, 20: 3 });
  });

  test("nobody comes with no road in from the edge of the map, and the bar says why", () => {
    const g = street("kit:vibe_coder.t0", [6], false);
    const { seen, a } = run(g, { vibe_coder: 1 }, 10);
    expect(seen.size).toBe(0);
    expect(a.status.vibe_coder).toEqual({ riding: 0, waiting: 1, blocked: "no-road" });
  });

  test("people living off the map are never sent for", () => {
    const g = street("kit:intern.t0", [4]);
    const { seen } = run(g, { intern: 2 }, BUS_WAIT + 5, { intern: 2 });
    expect(seen.size).toBe(0);
  });
});

describe("hired and not here yet", () => {
  test("is away from a desk until moved in", () => {
    const g = street("kit:intern.t0", [4, 8]);
    expect(awaitingArrival({ intern: 5 }, { intern: 2 }, housingResidents(g))).toEqual({ intern: 3 });
    settleHousing(g, { intern: 5 }, { intern: 2 });
    expect(awaitingArrival({ intern: 5 }, { intern: 2 }, housingResidents(g))).toEqual({});
  });

  test("housing from before lots is settled to the people there are, the rest left as lots", () => {
    const g = street("kit:intern.t0", [4, 8, 12]);
    for (const s of g.structures.values()) delete s.residents;      // legacy: full
    expect(housingResidents(g).intern).toBe(6);
    const changed = settleHousing(g, { intern: 3 }, {});
    expect(changed.length).toBe(3);
    expect([...g.structures.values()].map((s) => s.residents)).toEqual([2, 1, 0]);
  });
});

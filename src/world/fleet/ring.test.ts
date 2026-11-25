/** A ROAD ROUND THE COMPANY'S OWN BUILDING: its junction right beside the yard's gate, where a lorry has no room to set off but one way. */
import { describe, expect, test } from "bun:test";

import { useMoneyStore } from "../../state/money.store";
import { useWorldStore } from "../../state/world.store";
import { createTown, stepTown } from "../agents/town";
import { commit, createHistory } from "../edit/commands";
import { fillTerrain, idx } from "../grid";
import { createNetwork } from "../roads/network";
import { orderRoad, takeOn } from "../roads/jobs";
import { placesOf, type Place } from "../agents/roads";
import { createWorks, stepWorks } from "../projects/works";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { queueYardLoad } from "./fleet";

const s = () => useWorldStore.getState();
const line = (a: number[], b: number[]) => {
  const n = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  return Array.from({ length: n + 1 }, (_, k) => ({ x: a[0] + Math.sign(b[0] - a[0]) * k, y: a[1] + Math.sign(b[1] - a[1]) * k }));
};
/** A garage on a road, and one loop round it ordered: in one piece or in three, from either end. */
function ring(west: number, east: number, spur: number | null, pieces: boolean, back: boolean) {
  s().resize(40, 34);
  fillTerrain(s().grid, 1);
  for (let x = west; x <= east; x++) s().grid.paved[idx(s().grid, x, 17)] = 1;
  if (spur !== null) for (let y = 17; y < 34; y++) s().grid.paved[idx(s().grid, spur, y)] = 1;
  s().loadGrid(s().grid);
  commit(s().grid, createHistory(), placeCommand(s().grid, structureDef("garage")!, 12, 14)!);
  const G = s().grid, at = [[11, 17], [11, 13], [17, 13], [17, 17]];
  const way = back ? [...at].reverse() : at, legs = way.slice(1).map((p, k) => line(way[k], p));
  for (const path of pieces ? legs : [legs.flat()]) {
    const o = orderRoad(G, path);
    if (!("job" in o)) throw new Error("not ordered");
    o.job.cost = 100;
    takeOn(G, o);
  }
  return G;
}
const DT = 1 / 10;
function rig() {
  const G = s().grid, town = createTown(), works = createWorks();
  let net = createNetwork(G), rev = s().revision, now = 0;
  return {
    town, net: () => net,
    /** A frame, in the game's own order. @see step-world */
    step() {
      if (s().revision !== rev) { rev = s().revision; net = createNetwork(s().grid); }
      stepTown(town, G, net, rev, DT);
      s().stepRoadWorks(DT, { net, town });
      stepWorks(works, G, net, town, {}, () => true, DT, (now += DT * 1000));
    },
  };
}
const on = () => { useWorldStore.setState({ playing: true, roadWorks: true }); useMoneyStore.getState().increaseMoney(1e12); };
const off = () => useWorldStore.setState({ playing: false, roadWorks: false });

describe("a road round the garage", () => {
  for (const [name, west, east, spur] of [["a road that stops short of one edge", 0, 23, 17], ["a road right across", 0, 39, 17], ["no road but its own", 0, 39, null]] as const) {
    for (const pieces of [false, true]) for (const back of [false, true]) {
      test(`${name}, ${pieces ? "in three" : "in one"}${back ? ", drawn back" : ""}: built, each load sent once`, () => {
        on();
        try {
          const G = ring(west, east, spur, pieces, back), w = rig(), sent = new Set<unknown>();
          const loads = G.roadJobs.reduce((n, j) => n + j.deliveries, 0);
          for (let t = 0; t < 1500 && G.roadJobs.length; t += DT) { w.step(); for (const q of w.town.yard) sent.add(q); }
          expect(G.roadJobs.length).toBe(0);
          for (let x = 11; x <= 17; x++) expect(G.paved[idx(G, x, 13)]).not.toBe(0);
          expect(sent.size).toBeLessThanOrEqual(loads);
        } finally { off(); }
      }, 60000);
    }
  }

  test("a load the yard can find no way for is counted as come, not sent for again and again", () => {
    on();
    try {
      const G = ring(0, 39, null, false, false), w = rig(), j = G.roadJobs[0];
      const from = placesOf(G, w.net()).find((p) => p.structure !== undefined)!;
      // (To the very tile it stands on: there is no way to drive.)
      const to: Place = { x: from.x, y: from.y, kind: "door", net: from.net };
      j.deliveries = 1;
      expect(queueYardLoad(G, w.town, from, to, { site: j.id, role: "road-load" }, "stone")).toBe(true);
      for (let t = 0; t < 40; t += DT) w.step();
      expect(j.delivered).toBe(1);
      expect(w.town.yard.length).toBe(0);
    } finally { off(); }
  }, 60000);
});

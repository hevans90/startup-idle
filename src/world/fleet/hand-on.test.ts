/**
 * A ROAD BUILT A PIECE AT A TIME IS WORKED BY THE ONE GANG: a piece ordered on from one whose machines are on it
 * waits for them, and when that one is done they go straight on to it — nothing sent from the yard for it, and
 * nothing of it worked before they come.
 */
import { describe, expect, test } from "bun:test";

import { useMoneyStore } from "../../state/money.store";
import { useWorldStore } from "../../state/world.store";
import { createTown, stepTown } from "../agents/town";
import { commit, createHistory } from "../edit/commands";
import { fillTerrain, idx } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { stepYard } from "./fleet";
import { HAND_ON, canHandOn, handOn, nearJob, type Plant } from "./plant";
import { ROAD_PLANT } from "../roads/jobs";

const s = () => useWorldStore.getState();
const drag = (x0: number, y0: number, x1: number, y1: number) => {
  s().setTool("paintRoad"); s().setBrush("line");
  s().beginStroke({ x: x0, y: y0 }); s().updateStroke({ x: x1, y: y1 }); s().endStroke();
};

describe("machines handed on", () => {
  test("only a job's whole gang, at work or all still on site, is handed on; and only to a job beside it", () => {
    const p: Plant = { queue: [], t: 0, here: true };
    expect(canHandOn(p, ROAD_PLANT)).toBe(true);
    expect(canHandOn({ ...p, here: false }, ROAD_PLANT)).toBe(true);
    expect(canHandOn(false, ROAD_PLANT)).toBe(false);
    expect(canHandOn({ ...p, leaving: 3, home: [...ROAD_PLANT] }, ROAD_PLANT)).toBe(true);
    expect(canHandOn({ ...p, leaving: 9, home: ROAD_PLANT.slice(1) }, ROAD_PLANT)).toBe(false);
    expect(canHandOn({ ...p, leaving: 9, home: [...ROAD_PLANT], to: { kind: "pickup", x: 0, y: 0, heading: 0 } }, ROAD_PLANT)).toBe(false);
    const a = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    expect(nearJob(a, [{ x: 1 + HAND_ON, y: 0 }])).toBe(true);
    expect(nearJob(a, [{ x: 2 + HAND_ON, y: 0 }])).toBe(false);
    const h = handOn({ ...p, leaving: 2, home: [...ROAD_PLANT], at: [{ colour: 1, x: 3, y: 4, heading: 0 }] }, 7, { x: 5, y: 6 });
    expect(h).toEqual({ queue: [], t: 0, here: true, head: { x: 5, y: 6 }, at: [{ colour: 1, x: 3, y: 4, heading: 0 }], from: 7 });
  });

  test("a road built a piece at a time: the second piece waits for the first's gang, which goes straight on to it — none sent from the yard for it", () => {
    s().resize(40, 30);
    fillTerrain(s().grid, 1);
    for (let x = 0; x < 40; x++) s().grid.paved[idx(s().grid, x, 5)] = 1;
    s().loadGrid(s().grid);
    useWorldStore.setState({ playing: true, roadWorks: true });
    useMoneyStore.getState().increaseMoney(1e12);
    try {
      commit(s().grid, createHistory(), placeCommand(s().grid, structureDef("garage")!, 2, 2)!);
      drag(20, 6, 20, 10);
      drag(20, 11, 20, 15);
      const G = s().grid;
      expect(G.roadJobs.length).toBe(2);
      const [A, B] = G.roadJobs;
      const town = createTown();
      let net = createNetwork(G), rev = s().revision;
      const fromYardForB = new Set<number>(), states: string[] = [];
      let bWorkedEarly = false, handed = false;
      const dt = 1 / 10;
      for (let t = 0; t < 3000 && G.roadJobs.length; t += dt) {
        if (s().revision !== rev) { rev = s().revision; net = createNetwork(s().grid); }
        stepYard(town, G, dt);
        s().stepRoadWorks(dt, { net, town });
        for (const m of town.movers) if (m.job?.role === "road-plant" && m.job.site === B.id) fromYardForB.add(m.id);
        for (const l of town.legs) if (l.m.job?.role === "road-plant" && l.m.job.site === B.id) fromYardForB.add(l.m.id);
        // (Nothing of the second piece worked while the first is still on the list.)
        if (G.roadJobs.includes(A) && B.t > 0) bWorkedEarly = true;
        if (B.plant && B.plant.from === A.id) handed = true;
        const st = G.roadJobs.includes(A) ? "A" : G.roadJobs.includes(B) ? "B" : "-";
        if (states[states.length - 1] !== st) states.push(st);
        town.arrived.length = 0;
        stepTown(town, G, net, rev, dt);
      }
      expect(states).toEqual(["A", "B", "-"]);
      expect(handed).toBe(true);
      expect(bWorkedEarly).toBe(false);
      expect(fromYardForB.size).toBe(0);
      for (let y = 6; y <= 15; y++) expect(G.paved[idx(G, 20, y)]).not.toBe(0);
    } finally {
      useWorldStore.setState({ playing: false, roadWorks: false });
    }
  }, 60000);

  test("a main laid a run at a time: the second run waits for the first's gang, which goes straight on to it; every lorry of both gets home", () => {
    s().resize(40, 30);
    fillTerrain(s().grid, 1);
    for (let x = 0; x < 40; x++) s().grid.paved[idx(s().grid, x, 5)] = 1;
    s().loadGrid(s().grid);
    useWorldStore.setState({ playing: true, roadWorks: true });
    useMoneyStore.getState().increaseMoney(1e12);
    const pipe = (x0: number, x1: number) => { s().setTool("pipe"); s().setBrush("line"); s().beginStroke({ x: x0, y: 8 }); s().updateStroke({ x: x1, y: 8 }); s().endStroke(); };
    try {
      commit(s().grid, createHistory(), placeCommand(s().grid, structureDef("garage")!, 2, 2)!);
      pipe(12, 17);
      pipe(18, 23);
      const G = s().grid;
      expect(G.lineJobs.length).toBe(2);
      const [A, B] = G.lineJobs;
      const town = createTown(), net = createNetwork(G);
      const fromYardForB = new Set<number>();
      let bWorkedEarly = false, handed = false, waited = false;
      const dt = 1 / 10;
      for (let t = 0; t < 3000 && (G.lineJobs.length || town.fleet.some((f) => !f.home) || town.legs.length); t += dt) {
        stepYard(town, G, dt);
        s().stepLineWorks(dt, Date.now(), { net, town });
        for (const m of town.movers) if (m.job?.role === "plant" && m.job.site === B.id) fromYardForB.add(m.id);
        for (const l of town.legs) if (l.m.job?.role === "plant" && l.m.job.site === B.id) fromYardForB.add(l.m.id);
        if (B.after === A.id) waited = true;
        if (!A.handed && G.lineJobs.includes(A) && B.t > 0) bWorkedEarly = true;
        if (B.plant && B.plant.from === A.id) handed = true;
        town.arrived.length = 0;
        stepTown(town, G, net, 0, dt);
      }
      expect(waited).toBe(true);
      expect(handed).toBe(true);
      expect(bWorkedEarly).toBe(false);
      expect(fromYardForB.size).toBe(0);
      expect(G.lineJobs.length).toBe(0);
      for (let x = 12; x <= 23; x++) expect(G.main[idx(G, x, 8)]).not.toBe(0);
      expect(town.fleet.every((f) => f.home)).toBe(true);
    } finally {
      useWorldStore.setState({ playing: false, roadWorks: false });
    }
  }, 60000);
});

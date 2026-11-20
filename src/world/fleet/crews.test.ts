/**
 * THE COMPANY'S CREWS: a trade each, sent only when its phase is about to begin, each on one job at a time, and on
 * from a job it has done to the next that wants it — by road, not home and out again.
 */
import { describe, expect, test } from "bun:test";

import { useMoneyStore } from "../../state/money.store";
import { useWorldStore } from "../../state/world.store";
import { createTown, stepTown } from "../agents/town";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { createNetwork } from "../roads/network";
import { CREW_TRADE, GAP, ROAD_CREWS, frontAt, tradeBegun, type RoadCrew } from "../roads/jobs";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { LINE_CREW_NAMES, crewKey, crewsOf } from "./crews";
import { LINE_CREWS } from "../lines/jobs";
import { stepYard } from "./fleet";

const s = () => useWorldStore.getState();
const drag = (x0: number, y0: number, x1: number, y1: number) => {
  s().setTool("paintRoad"); s().setBrush("line");
  s().beginStroke({ x: x0, y: y0 }); s().updateStroke({ x: x1, y: y1 }); s().endStroke();
};

describe("road crews", () => {
  test("a crew of each trade a yard; a second of the earthworks and the tarring at the biggest", () => {
    const g = createGrid(30, 30);
    fillTerrain(g, 1);
    commit(g, createHistory(), placeCommand(g, structureDef("garage")!, 2, 2)!);
    for (const c of ROAD_CREWS) expect(crewsOf(g, c)).toBe(1);
    const big = [...g.structures.values()][0];
    big.def = "boardroom";
    expect(ROAD_CREWS.map((c) => crewsOf(g, c))).toEqual([1, 2, 1, 2, 1]);
  });

  test("two pieces of road, one crew of each: each crew sent only when its phase is due, on one job at a time, and on from the first piece to the second — never out of the yard for it", () => {
    s().resize(40, 30);
    fillTerrain(s().grid, 1);
    for (let x = 0; x < 40; x++) s().grid.paved[idx(s().grid, x, 5)] = 1;
    s().loadGrid(s().grid);
    useWorldStore.setState({ playing: true, roadWorks: true });
    useMoneyStore.getState().increaseMoney(1e12);
    try {
      commit(s().grid, createHistory(), placeCommand(s().grid, structureDef("garage")!, 2, 2)!);
      drag(20, 6, 20, 13);
      drag(24, 6, 24, 9);
      const G = s().grid;
      expect(G.roadJobs.length).toBe(2);
      const [A, B] = G.roadJobs;
      const town = createTown();
      let net = createNetwork(G), rev = s().revision;
      const outOfYard = new Map<number, number>(), legged = new Set<number>(), early: string[] = [], twice: string[] = [];
      let together = false;
      const dt = 1 / 10;
      for (let t = 0; t < 4000 && (G.roadJobs.length || town.movers.some((m) => m.job?.role === "road-plant") || town.legs.length); t += dt) {
        if (s().revision !== rev) { rev = s().revision; net = createNetwork(s().grid); }
        stepYard(town, G, dt);
        s().stepRoadWorks(dt, { net, town });
        // (Out of the yard: on the road at the end of a leg from it, for whichever crew of whichever job.)
        for (const l of town.legs) legged.add(l.m.id);
        for (const m of town.movers) if (m.job?.role === "road-plant" && legged.has(m.id) && !outOfYard.has(m.id)) outOfYard.set(m.id, m.job.site);
        for (const j of G.roadJobs) for (const c of ROAD_CREWS) {
          const k = CREW_TRADE[c];
          // SENT ONLY WHEN DUE: no crew of a trade on a job before the trade ahead of it is under way and on.
          if (k > 0 && j.gangs?.[c] && !(tradeBegun(j, k - 1) && frontAt(j, k - 1) >= Math.min(j.cells.length, GAP) - 1)) early.push(`${j.id}:${c}`);
        }
        // ONE JOB AT A TIME: never two of a trade's crews on the go, with the one the company has.
        for (const c of ROAD_CREWS) {
          const on = G.roadJobs.filter((j) => { const g2 = j.gangs?.[c]; return g2 && !g2.gone && g2.onward === undefined; }).length;
          if (on > 1) twice.push(`${t.toFixed(1)}:${c}`);
        }
        // (And the two pieces worked at once, by different crews.)
        if (G.roadJobs.includes(A) && G.roadJobs.includes(B) && ROAD_CREWS.some((c) => A.gangs?.[c]?.plant && !A.gangs[c]!.gone) && ROAD_CREWS.some((c) => B.gangs?.[c]?.plant && (B.gangs[c]!.plant as { here: boolean }).here)) together = true;
        town.arrived.length = 0;
        stepTown(town, G, net, rev, dt);
      }
      expect(G.roadJobs.length).toBe(0);
      for (let y = 6; y <= 13; y++) expect(G.paved[idx(G, 20, y)]).not.toBe(0);
      for (let y = 6; y <= 9; y++) expect(G.paved[idx(G, 24, y)]).not.toBe(0);
      expect(early).toEqual([]);
      expect(twice).toEqual([]);
      expect(together).toBe(true);
      // Each of the first piece's crews out of the yard, once; none for the second: every one of its came on from the first.
      const sites = [...outOfYard.values()];
      for (const c of ROAD_CREWS) expect(sites.includes(crewKey(A, c as RoadCrew))).toBe(true);
      for (const c of ROAD_CREWS) expect(sites.includes(crewKey(B, c as RoadCrew))).toBe(false);
      // Every machine home: nothing of either left on the road.
      expect(town.movers.filter((m) => m.job?.role === "road-plant")).toEqual([]);
    } finally {
      useWorldStore.setState({ playing: false, roadWorks: false });
    }
  }, 60000);

  test("two runs of main, one crew of each: the layers come only once the footings are under way, each crew on one run at a time, the second run's crews on from the first; every lorry and machine home", () => {
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
      const outOfYard = new Map<number, number>(), legged = new Set<number>(), twice: string[] = [];
      let layersEarly = false;
      const key = (j: { id: number }, c: string) => j.id * 8 + LINE_CREW_NAMES.indexOf(c as never);
      const dt = 1 / 10;
      for (let t = 0; t < 3000 && (G.lineJobs.length || town.fleet.some((f) => !f.home) || town.legs.length || town.movers.some((m) => m.job?.role === "line-plant")); t += dt) {
        stepYard(town, G, dt);
        s().stepLineWorks(dt, Date.now(), { net, town });
        for (const l of town.legs) legged.add(l.m.id);
        for (const m of town.movers) if (m.job?.role === "line-plant" && legged.has(m.id) && !outOfYard.has(m.id)) outOfYard.set(m.id, m.job.site);
        for (const j of G.lineJobs) if (j.gangs?.laying && !(j.tc && j.tc[0] > 0)) layersEarly = true;
        for (const c of LINE_CREW_NAMES) if (G.lineJobs.filter((j) => { const g2 = j.gangs?.[c]; return g2 && !g2.gone && g2.onward === undefined; }).length > 1) twice.push(c);
        town.arrived.length = 0;
        stepTown(town, G, net, 0, dt);
      }
      expect(G.lineJobs.length).toBe(0);
      for (let x = 12; x <= 23; x++) expect(G.main[idx(G, x, 8)]).not.toBe(0);
      expect(layersEarly).toBe(false);
      expect([...new Set(twice)]).toEqual([]);
      const sites = [...outOfYard.values()];
      for (const c of LINE_CREWS.main) expect(sites.includes(key(A, c.crew))).toBe(true);
      for (const c of LINE_CREWS.main) expect(sites.includes(key(B, c.crew))).toBe(false);
      expect(town.fleet.every((f) => f.home)).toBe(true);
      expect(town.movers.filter((m) => m.job?.role === "line-plant")).toEqual([]);
    } finally {
      useWorldStore.setState({ playing: false, roadWorks: false });
    }
  }, 60000);
});

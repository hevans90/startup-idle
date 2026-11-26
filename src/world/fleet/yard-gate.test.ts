/**
 * World v2 — THE YARD'S GATE on a busy street: the lorries go out and come home, and the town's traffic goes by. A
 * lorry that crossed a lane and stood in it, waiting for one that had stopped for it, held the street a quarter of a minute.
 */
import { expect, test } from "bun:test";
import { useMoneyStore } from "../../state/money.store";
import { useWorldStore } from "../../state/world.store";
import { createTown, stepTown } from "../agents/town";
import { commit, createHistory } from "../edit/commands";
import { fillTerrain, idx } from "../grid";
import { createNetwork } from "../roads/network";
import { orderRoad, takeOn } from "../roads/jobs";
import { createWorks, stepWorks } from "../projects/works";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
const s = () => useWorldStore.getState();
const DT = 1 / 20, R = 20, GATE = 22;
/** Seven minutes of a town on one street (and one crossing it, `cross`), two roads being built off it: vehicle-seconds stood in the road by the gate off the lanes, and stood by one that is. */
function run(seed: number, cross: boolean) {
  s().resize(48, 40); fillTerrain(s().grid, 1);
  for (let x = 0; x < 48; x++) s().grid.paved[idx(s().grid, x, R)] = 1;
  if (cross) for (const x of [8, 40]) for (let y = 0; y < 40; y++) s().grid.paved[idx(s().grid, x, y)] = 1;
  s().loadGrid(s().grid);
  const g = s().grid, history = createHistory(), garage = structureDef("garage")!, kit = structureDef("kit:intern.t0")!;
  commit(g, history, placeCommand(g, garage, 18, R - garage.footprint.h)!);
  const house = (x: number, y: number) => { const c = placeCommand(g, kit, x, y); if (c) commit(g, history, c); };
  for (let x = 2; x < 46; x++) for (const y of [R - 1, R + 1]) if (Math.abs(x - 20) >= 6 || y !== R + 1) house(x, y);
  if (cross) for (let y = 2; y < 38; y += 2) for (const x of [39, 41]) house(x, y);
  for (const x of [18 + (seed % 6), 26 - (seed % 3)]) {
    const o = orderRoad(g, [...Array(8)].map((_, k) => ({ x, y: R + 1 + k })));
    if ("job" in o) { o.job.cost = 100; takeOn(g, o); }
  }
  const town = createTown(), works = createWorks();
  town.seed = seed * 7919 + 1;
  let net = createNetwork(g), rev = s().revision, stood = 0, held = 0, out = 0;
  const seen = new Set<number>();
  for (let t = 0; t < 420; t += DT) {
    if (s().revision !== rev) { rev = s().revision; net = createNetwork(g); }
    stepTown(town, g, net, rev, DT);
    s().stepRoadWorks(DT, { net, town });
    stepWorks(works, g, net, town, {}, () => true, DT, t * 1000);
    const near = town.legs.filter((l) => l.m.y > 19.62 && Math.abs(l.m.y - R) < 0.6 && Math.abs(l.m.x - GATE) < 1.5);
    for (const l of near) if (l.m.speed === 0) stood += DT;
    for (const l of town.legs) if (l.join && !seen.has(l.m.id)) { seen.add(l.m.id); out++; }
    if (near.length) for (const m of town.movers) if (m.kind !== "person" && m.speed < 0.02 && m.job?.role !== "working" && near.some((l) => Math.hypot(l.m.x - m.x, l.m.y - m.y) < 1.2)) held += DT;
  }
  return { stood, held, out };
}
test.each([[1, false], [2, true]] as const)("a yard's lorries do not stand in the road, nor the traffic for them (seed %i, crossed %p)", (seed, cross) => {
  useWorldStore.setState({ playing: true, roadWorks: true });
  useMoneyStore.getState().increaseMoney(1e12);
  const r = run(seed, cross);
  expect(r.out).toBeGreaterThan(2);
  expect(r.stood).toBeLessThan(12);
  expect(r.held).toBeLessThan(18);
}, 120000);

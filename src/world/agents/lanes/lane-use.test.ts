/** TRAFFIC USES THE LANES THERE ARE, and nobody is stood so long that they are lifted off the road. @see thinkAgain */
import { expect, test } from "bun:test";
import { createGrid, fillTerrain, idx } from "../../grid";
import { createNetwork } from "../../roads/network";
import { createTown, setTownCaps, stepTown, townCaps, trafficOf } from "../town";
import { overlap, settle } from "./traffic.test-kit";

/** A road `k` wide across the map, with streets `cw` wide over it, under as much traffic as it takes. */
function run(k: number, cross: number[], cw: number, cars: number) {
  const n = 64, g = createGrid(n, n), at = n / 2 - 1;
  fillTerrain(g, 1);
  const pave = (x: number, y: number) => { g.paved[idx(g, x, y)] = 1; };
  for (let x = 0; x < n; x++) for (let j = 0; j < k; j++) pave(x, at + j);
  for (const x of cross) for (let y = 8; y < n - 8; y++) for (let j = 0; j < cw; j++) pave(x + j, y);
  for (const y of [8, n - 9]) for (let x = cross[0]; x <= cross[cross.length - 1]; x++) pave(x, y);
  settle(g);
  const net = createNetwork(g), was = { ...townCaps }, t = createTown();
  t.seed = 7919;
  setTownCaps({ cars, people: 0, every: 2 });
  const use = Array<number>(k).fill(0);
  let gone = 0, over = 0;
  try {
    for (let i = 0; i < 300 * 20; i++) {
      const before = t.movers;
      stepTown(t, g, net, 0, 1 / 20);
      const after = new Set(t.movers);
      for (const m of before) if (m.kind !== "person" && m.gone && !after.has(m)) gone++;
      const G = trafficOf(t, g).G, cs = t.movers.filter((m) => m.kind !== "person" && m.drive?.graph === G);
      for (const m of cs) { const l = G.lanes[m.drive!.lanes[m.drive!.k]]; if (l.kind === "street" && l.lanes === k) use[l.slot!]++; }
      if (i % 10 === 0) cs.forEach((a, j) => { for (const b of cs.slice(j + 1)) if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && overlap(a, b)) over++; });
    }
  } finally { setTownCaps(was); }
  const all = use.reduce((a, b) => a + b, 0);
  return { use: use.map((u) => u / all), gone, over };
}

test("a road two lanes each way is driven in both, past lights", () => {
  const r = run(2, [12, 22, 32, 42, 52], 1, 160);
  expect(Math.min(...r.use)).toBeGreaterThan(0.4);
  expect([r.gone, r.over]).toEqual([0, 0]);
}, 60_000);

test("and between roundabouts, whose ways off all lead onto the kerb lane", () => {
  const r = run(2, [16, 32, 48], 2, 80);
  expect(Math.min(...r.use)).toBeGreaterThan(0.2);
  expect([r.gone, r.over]).toEqual([0, 0]);
}, 60_000);

test("a road three lanes each way is driven in all of them", () => {
  const r = run(3, [12, 27, 42, 52], 1, 120);
  expect(Math.min(...r.use)).toBeGreaterThan(0.12);
  expect([r.gone, r.over]).toEqual([0, 0]);
}, 60_000);

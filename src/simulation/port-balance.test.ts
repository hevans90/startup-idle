/**
 * THE PORTS, THROUGH THE TRAFFIC: what a port really turns round and is
 * paid, measured by running the rivers' own traffic past it for minutes on
 * end — every tier, on water for each size of ship, with each fitting.
 *
 * What it holds to (BALANCE=1 prints the table):
 *  - a port turns round what it is priced for, wherever on its river it is;
 *  - deeper water never earns less, and a gantry earns more than the quay it replaces;
 *  - a fitted berth costs fees, and its meter fills and holds;
 *  - a port pays itself back in ten to twenty minutes.
 * @see portCallFee, SHIP_CLASSES, FITTINGS, plans/seaports.md
 */
import { describe, expect, test } from "bun:test";

import { FLOW_DEFAULTS, createColumnField } from "../fluid/columns";
import { callsAMinute, portCallFee } from "../game/build-cost";
import { classOf } from "../world/boats/classes";
import { fitting } from "../world/boats/fittings";
import { createFleet, stepFleet } from "../world/boats/fleet";
import { creditTrade, resetTrade, stepTrade, tradeLevel, type TradeKind } from "../world/boats/trade";
import { createTraffic, stepTraffic, trafficSteer } from "../world/boats/traffic";
import { stepYards } from "../world/boats/yard";
import { commit, createHistory } from "../world/edit/commands";
import { createGrid, idx, setInflow, type Grid } from "../world/grid";
import { SEAPORTS, structureDef } from "../world/structures/def";
import { placeCommand } from "../world/structures/place";

/** A straight river five tiles wide and `depth` deep, in from the west. */
function river(depth: number, w: number): Grid {
  const g = createGrid(w, 18, 1);
  for (let y = 6; y <= 10; y++) for (let x = 0; x < w; x++) { g.pool[idx(g, x, y)] = depth; g.height[idx(g, x, y)] = -depth - 1; setInflow(g, 0, y, depth); }
  return g;
}
const fieldOf = (g: Grid) => {
  const c = createColumnField(g.w * 4, g.h * 4, { ...FLOW_DEFAULTS, wind: 0 }, 0.25);
  for (let cy = 0; cy < c.ny; cy++) for (let cx = 0; cx < c.nx; cx++) { c.depth[cy * c.nx + cx] = g.pool[idx(g, cx >> 2, cy >> 2)]; c.ground[cy * c.nx + cx] = g.height[idx(g, cx >> 2, cy >> 2)]; }
  return c;
};

/** Water for boats alone, for coasters, and for ships. */
const SHALLOW = 2, MID = 4, DEEP = 6;
/** Minutes run; longer where ships call, who are few and worth a lot each. */
const WARM = 120, LONG = 18;

type Run = {
  /** Calls a minute, all sizes and by size; ships that gave up waiting. */
  calls: number; by: number[]; turned: number;
  /** Fees a minute, in a boat's plain call at this port; and in seconds of the company's income. */
  pay: number; income: number;
  /** Minutes of that trade to pay the port's price back. */
  payback: number;
  /** Each meter, averaged over the second half. */
  meters: Record<TradeKind, number>;
};

/** A port of `tier` on such a river, fitted so, with a road out, run for some minutes. */
function run(tier: number, depth: number, fit?: string[], at = 14, w = 40): Run {
  const MINUTES = depth >= DEEP && tier === 3 ? LONG : 6;
  const g = river(depth, w);
  commit(g, createHistory(), placeCommand(g, SEAPORTS[tier - 1], at, 4)!);
  const s = [...g.structures.values()].at(-1)!;
  if (fit) s.fit = fit;
  const c = fieldOf(g), f = createFleet(), t = createTraffic(), dt = 1 / 30;
  resetTrade();
  const secs = MINUTES * 60, by = [0, 0, 0];
  const meters: Record<TradeKind, number> = { materials: 0, hardware: 0, ferries: 0, yachts: 0 };
  let pay = 0, turned = 0, n = 0;
  for (let k = 0; k < (WARM + secs) * 30; k++) {
    stepTraffic(t, f, g, c, dt);
    // A road out, and lorries on it: what is landed is taken away.
    stepYards(t.yards, dt, () => "sent");
    stepFleet(f, c, dt, trafficSteer(t));
    stepTrade(dt);
    const live = k >= WARM * 30;
    for (const call of t.calls.splice(0)) {
      const fitted = fitting(call.fit), cls = classOf(call.cls);
      if (fitted.keeps) creditTrade(fitted.keeps, cls.dock * cls.span);
      if (live) { pay += cls.pay * fitted.pay; by[call.cls]++; }
    }
    const gone = t.turned.splice(0).length;
    if (live) turned += gone;
    if (k >= (WARM + secs / 2) * 30) { n++; for (const m of Object.keys(meters) as TradeKind[]) meters[m] += tradeLevel(m); }
  }
  for (const m of Object.keys(meters) as TradeKind[]) meters[m] /= n;
  const def = structureDef(s.def)!.port!, income = (pay / MINUTES) * (portCallFee(s.def, 100)! / 100);
  return {
    calls: (by[0] + by[1] + by[2]) / MINUTES, by: by.map((v) => v / MINUTES), turned: turned / MINUTES,
    pay: pay / MINUTES, income, payback: (10 * callsAMinute(def)) / income, meters,
  };
}

const say = (name: string, r: Run) => {
  if (!process.env.BALANCE) return;
  const kept = (Object.entries(r.meters) as [string, number][]).filter(([, v]) => v > 0.005).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(" ");
  console.log(`${name.padEnd(26)} calls ${r.calls.toFixed(1).padStart(5)} (${r.by.map((v) => v.toFixed(1)).join("/")})  fees ${r.pay.toFixed(1).padStart(5)}  income-s ${r.income.toFixed(1).padStart(5)}  payback ${r.payback.toFixed(0).padStart(3)} min  ${kept}`);
};

describe("the ports through the traffic", () => {
  test("a port turns round what it is priced for, and pays itself back in ten to twenty minutes", () => {
    for (const tier of [1, 2, 3]) {
      const r = run(tier, SHALLOW);
      say(`tier ${tier}, boats`, r);
      const priced = callsAMinute(structureDef(["seaport", "seaport-2", "seaport-3"][tier - 1])!.port!);
      expect(Math.abs(r.calls - priced) / priced).toBeLessThan(0.1);
      expect(r.payback).toBeGreaterThan(9);
      expect(r.payback).toBeLessThan(21);
      expect(r.turned).toBe(0);
    }
  }, 60_000);

  test("it turns round as much far up its river as by the inflow", () => {
    for (const tier of [1, 3]) {
      const near = run(tier, SHALLOW, undefined, 6, 80), far = run(tier, SHALLOW, undefined, 60, 80);
      say(`tier ${tier}, 6 tiles up`, near);
      say(`tier ${tier}, 60 tiles up`, far);
      expect(far.calls).toBeGreaterThan(near.calls * 0.9);
    }
  }, 60_000);

  test("deeper water never earns a port less", () => {
    const two = [run(2, SHALLOW), run(2, MID), run(2, DEEP)];
    const three = [run(3, SHALLOW), run(3, MID), run(3, DEEP)];
    two.forEach((r, k) => say(`tier 2, ${["boats", "coasters", "deep"][k]}`, r));
    three.forEach((r, k) => say(`tier 3, ${["boats", "coasters", "ships"][k]}`, r));
    // A tier 1 takes boats whatever the water.
    expect(run(1, DEEP).by[1]).toBe(0);
    expect(two[1].pay).toBeGreaterThan(two[0].pay * 1.05);
    expect(two[2].pay).toBeGreaterThan(two[1].pay * 0.97);
    expect(three[1].pay).toBeGreaterThan(three[0].pay * 1.05);
    // Ships, turned by the tug at either end of a call, still earn more than the coasters they keep off the quay.
    expect(three[2].by[2]).toBeGreaterThan(0.5);
    expect(three[2].pay).toBeGreaterThan(three[1].pay * 1.05);
    expect(three[2].turned).toBe(0);
  }, 60_000);

  test("gantries earn more than the quays they replace, and the quay beside them is kept busy", () => {
    const quays = run(3, DEEP), pair = run(3, DEEP, ["gantry", "gantry", "trade"]), all = run(3, DEEP, ["gantry", "gantry", "gantry"]);
    say("tier 3, quays", quays);
    say("tier 3, 2 gantries + quay", pair);
    say("tier 3, 3 gantries", all);
    expect(pair.pay).toBeGreaterThan(quays.pay * 1.2);
    expect(pair.pay).toBeLessThan(quays.pay * 1.8);
    // A ship a minute at the gantries, near enough; and boats and coasters at the one quay as fast as it turns them.
    expect(pair.by[2]).toBeGreaterThan(0.9);
    expect(pair.by[0] + pair.by[1]).toBeGreaterThan(2);
    expect(all.by[2]).toBeGreaterThan(0.9);
    expect(pair.turned + all.turned).toBe(0);
  }, 60_000);

  test("a fitted berth costs fees, and its meter fills and holds", () => {
    const ferry = run(1, SHALLOW, ["ferry"]);
    const crane = run(2, MID, ["crane", "trade"]), plain = run(2, MID);
    const pontoon = run(3, DEEP, ["pontoon", "trade", "trade"]), quays = run(3, DEEP);
    const slop = run(2, MID, ["slop", "trade"]);
    say("tier 1, ferry ramp", ferry);
    say("tier 2, crane + quay", crane);
    say("tier 2, slop loader + quay", slop);
    say("tier 3, pontoon + 2 quays", pontoon);
    expect(ferry.meters.ferries).toBeGreaterThan(0.9);
    expect(crane.meters.materials).toBeGreaterThan(0.9);
    expect(pontoon.meters.yachts).toBeGreaterThan(0.6);
    expect(crane.pay).toBeLessThan(plain.pay);
    expect(crane.pay).toBeGreaterThan(plain.pay * 0.5);
    expect(pontoon.pay).toBeLessThan(quays.pay);
    expect(slop.pay).toBeLessThan(plain.pay * 0.7);
    // A barge every half minute or better: twenty a call against the loader's thirty a minute.
    expect(slop.by[0]).toBeGreaterThan(1.5);
  }, 60_000);
});

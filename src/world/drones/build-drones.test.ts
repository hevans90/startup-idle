import { afterEach, describe, expect, test } from "bun:test";

import { useGenerationStore } from "../../state/generation.store";
import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { orderRoad, stepRoadJobs, takeOn } from "../roads/jobs";
import { dronePort, sendDrones, stepBuildDrones, worksOn } from "./build-drones";

afterEach(() => useGenerationStore.setState({ generation: 1 }));

/** A garage with its yard, on a road along the top, and a road ordered down the side. */
function town(): Grid {
  const g = createGrid(30, 30);
  fillTerrain(g, 1);
  for (let x = 0; x < 30; x++) g.paved[idx(g, x, 5)] = 1;
  g.structures.set(1, { id: 1, def: "garage", x: 2, y: 2, w: 5, h: 3 });
  for (let y = 2; y < 5; y++) for (let x = 2; x < 7; x++) g.structureAt[idx(g, x, y)] = 1;
  return g;
}
const order = (g: Grid) => {
  const got = orderRoad(g, Array.from({ length: 12 }, (_, k) => ({ x: 20, y: 6 + k })));
  if (!("job" in got)) throw new Error("not ordered");
  takeOn(g, got);
  return got.job;
};
/** Seconds till the job is open, stepped a tenth at a time with no crews (all trades on). */
const openIn = (g: Grid, step?: (dt: number) => void) => {
  for (let t = 0; t < 3600; t += 0.1) {
    step?.(0.1);
    stepRoadJobs(g, 0.1);
    if (!g.roadJobs.length) return t;
  }
  return Infinity;
};

describe("build drones", () => {
  test("only from the first Ascension, from the garage's yard", () => {
    expect(dronePort(town())).toBeNull();
    useGenerationStore.setState({ generation: 2 });
    const p = dronePort(town())!;
    expect(p.x).toBeGreaterThan(4);
    expect(p.x).toBeLessThan(7);
  });

  test("a road ordered by AI mode waits for its drone, then opens many times faster than under crews, its materials paid on landing", () => {
    const slow = town();
    const slowJob = order(slow);
    slowJob.delivered = slowJob.deliveries;
    const crews = openIn(slow);

    useGenerationStore.setState({ generation: 2 });
    const g = town(), before = worksOn(g);
    const j = order(g);
    expect(sendDrones(g, before)).toBe(1);
    expect(j.drone).toBeDefined();
    // In the air: nothing opens.
    stepRoadJobs(g, 1);
    expect(j.opened).toBe(0);
    let paid = 0;
    const fast = openIn(g, (dt) => stepBuildDrones(g, dt, (n) => { paid += n; return true; }));
    expect(paid).toBeCloseTo(j.cost, 5);
    expect(fast).toBeLessThan(crews / 4);
  });

  test("hovers till its materials can be paid", () => {
    useGenerationStore.setState({ generation: 2 });
    const g = town(), before = worksOn(g);
    const j = order(g);
    sendDrones(g, before);
    for (let k = 0; k < 100; k++) stepBuildDrones(g, 0.1, () => false);
    expect(j.delivered).toBe(0);
    stepRoadJobs(g, 5);
    expect(j.opened).toBe(0);
  });
});

import { describe, expect, test } from "bun:test";

import { FLOW_DEFAULTS, createColumnField } from "../../fluid/columns";
import { commit, createHistory, undo } from "../edit/commands";
import { createGrid, idx, setInflow, type Grid } from "../grid";
import { SEAPORT, SEAPORTS, type StructureDef } from "../structures/def";
import { planUpgrade, placeCommand, touchesRoad, upgradeCommand, validatePlacement } from "../structures/place";
import { rampNeed } from "../roads/ramp-derive";
import { componentCount, createNetwork } from "../roads/network";
import { applyFixture } from "../debug/fixtures";
import { createFleet, stepFleet } from "./fleet";
import { berthsBeside, downstream, mapRiver, poolDepthOf, riversBeside } from "./river";
import { createTraffic, stepTraffic, trafficSteer } from "./traffic";

/**
 * A straight river across a flat map: rows `y0..y1` are water `depth` deep the
 * whole way across, coming in over the west edge. Plus, optionally, a lake.
 */
function straight(w = 24, h = 16, y0 = 6, y1 = 9, depth = 4, lake = false): Grid {
  const g = createGrid(w, h, 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < w; x++) g.pool[idx(g, x, y)] = depth;
    setInflow(g, 0, y, depth);
  }
  if (lake) for (let y = 1; y <= 3; y++) for (let x = 3; x <= 6; x++) g.pool[idx(g, x, y)] = depth;
  return g;
}

/** A column field whose depths are a grid's pool, four columns a tile. */
function fieldOf(g: Grid) {
  const c = createColumnField(g.w * 4, g.h * 4, { ...FLOW_DEFAULTS, wind: 0 }, 0.25);
  for (let cy = 0; cy < c.ny; cy++) {
    for (let cx = 0; cx < c.nx; cx++) c.depth[cy * c.nx + cx] = g.pool[idx(g, cx >> 2, cy >> 2)];
  }
  return c;
}

describe("the map's rivers", () => {
  test("are the water joined to an inflow, and a lake is not one", () => {
    const g = straight(24, 16, 6, 9, 4, true);
    const r = mapRiver(g, poolDepthOf(g));
    expect(r.river[idx(g, 10, 7)]).toBe(1);
    expect(r.river[idx(g, 4, 2)]).toBe(0);           // the lake
    expect(r.sources.map((s) => [s.x, s.y])).toEqual([[0, 6], [0, 7], [0, 8], [0, 9]]);
    // It leaves by the east edge.
    expect(r.exits.every((e) => e.x === g.w - 1)).toBe(true);
    expect(r.toExit[idx(g, g.w - 1, 7)]).toBe(0);
    expect(r.toExit[idx(g, 0, 7)]).toBe(g.w - 1);
  });

  test("downstream is the way to the exit", () => {
    const g = straight();
    const r = mapRiver(g, poolDepthOf(g));
    const d = downstream(r, 5, 7)!;
    expect(d.x).toBeCloseTo(1, 6);
    expect(downstream(r, 4, 2)).toBeNull();           // dry ground
  });
});

describe("a seaport", () => {
  test("stands on a river's bank, and nowhere else", () => {
    const g = straight();
    const rivers = mapRiver(g, poolDepthOf(g));
    expect(riversBeside(rivers, 8, 4, 2, 2)).toEqual([1]);
    // On the bank.
    expect(validatePlacement(g, SEAPORT, 8, 4, { rivers }).ok).toBe(true);
    expect(validatePlacement(g, SEAPORT, 8, 10, { rivers }).ok).toBe(true);
    // Back from it, in it, and with no rivers to ask about.
    expect(validatePlacement(g, SEAPORT, 8, 2, { rivers }).reason).toBe("not on a river bank");
    expect(validatePlacement(g, SEAPORT, 8, 5, { rivers }).ok).toBe(false);
    expect(validatePlacement(g, SEAPORT, 8, 4).ok).toBe(false);
  });

  test("by a lake is not by a river", () => {
    const g = straight(24, 16, 6, 9, 4, true);
    const rivers = mapRiver(g, poolDepthOf(g));
    expect(validatePlacement(g, SEAPORT, 7, 1, { rivers }).ok).toBe(false);
  });

  test("the harbour fixture has one of each tier on its bank, west to east, with a berth each", () => {
    const g = createGrid(64, 64, 1);
    applyFixture(g, "harbour", 1);
    const ports = [...g.structures.values()].sort((a, b) => a.x - b.x);
    expect(ports.map((p) => p.def)).toEqual(SEAPORTS.map((d) => d.id));
    const rivers = mapRiver(g, poolDepthOf(g));
    SEAPORTS.forEach((d, k) => {
      const p = ports[k];
      expect([p.w, p.h]).toEqual([d.footprint.w, d.footprint.h]);
      expect(riversBeside(rivers, p.x, p.y, p.w, p.h)).toEqual([1]);
      expect(berthsBeside(rivers, p.x, p.y, p.w, p.h, d.port!.berths)).toHaveLength(d.port!.berths);
    });
    // Evenly spread: a quarter of the map apart, give or take finding a bank.
    const mids = ports.map((p) => p.x + p.w / 2);
    for (let k = 1; k < mids.length; k++) expect(Math.abs(mids[k] - mids[k - 1] - 16)).toBeLessThan(4);
  });

  test("and roads that reach every port, as one network, with no step a road cannot climb", () => {
    const g = createGrid(64, 64, 1);
    applyFixture(g, "harbour", 1);
    expect(componentCount(createNetwork(g))).toBe(1);
    const read = {
      inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h,
      paved: (x: number, y: number) => g.paved[idx(g, x, y)] !== 0,
      height: (x: number, y: number) => g.height[idx(g, x, y)],
    };
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) expect(rampNeed(read, x, y).kind).not.toBe("unbridgeable");
    }
    // The main road runs edge to edge.
    const row = [...Array(g.h).keys()].find((y) => read.paved(0, y))!;
    for (let x = 0; x < g.w; x++) expect(read.paved(x, row)).toBe(true);
    for (const p of g.structures.values()) {
      let fronts = false;
      for (let k = 0; k < p.w; k++) for (let j = 0; j < p.h; j++) fronts ||= touchesRoad(g, p.x + k, p.y + j);
      expect(fronts).toBe(true);
    }
  });

  test("and no cliffs: nowhere does the surface you see step more than one step", () => {
    const g = createGrid(64, 64, 1);
    applyFixture(g, "harbour", 1);
    // The ground, or the water over it: a bank under the water is not a cliff.
    const top = (x: number, y: number) => g.height[idx(g, x, y)] + g.pool[idx(g, x, y)];
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (x + 1 < g.w) expect(Math.abs(top(x + 1, y) - top(x, y))).toBeLessThanOrEqual(2);
        if (y + 1 < g.h) expect(Math.abs(top(x, y + 1) - top(x, y))).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe("river traffic", () => {
  const port = (g: Grid, def: StructureDef = SEAPORT) => {
    const rivers = mapRiver(g, poolDepthOf(g));
    commit(g, createHistory(), placeCommand(g, def, 8, 4, { rivers })!);
  };
  const DOCK = SEAPORT.port!.dockSeconds;
  const run = (g: Grid, seconds: number, onFrame?: (f: ReturnType<typeof createFleet>) => void) => {
    const c = fieldOf(g), f = createFleet(), t = createTraffic();
    for (let k = 0; k < Math.round(seconds * 30); k++) {
      stepTraffic(t, f, g, c, 1 / 30);
      stepFleet(f, c, 1 / 30, trafficSteer(t));
      onFrame?.(f);
    }
    return { f, t, c };
  };

  test("sends no boats down a river with no port", () => {
    const { f } = run(straight(), 20);
    expect(f.boats.length).toBe(0);
  });

  test("sends them in over the inflow with a port, under their own power, even on still water", () => {
    const g = straight();
    port(g);
    const { f } = run(g, 4);
    expect(f.boats.length).toBe(1);
    const b = f.boats[0];
    expect(b.motor).toBeGreaterThan(0);
    // The water here is level and still, so only its own push moved it.
    expect(b.x).toBeGreaterThan(1.5);
    // Down the river, bound for the port's berth a little toward its bank.
    expect(Math.cos(b.heading)).toBeGreaterThan(0.85);
  });

  test("each one ties up at the port on its way, then goes on", () => {
    const g = straight();
    port(g);
    const [berth] = berthsBeside(mapRiver(g, poolDepthOf(g)), 8, 4, 2, 2, 1);
    expect(berth.ty).toBe(6);                        // the river tile below the quay
    let docked = 0, settled = 0, left = false;
    run(g, 60, (f) => {
      const b = f.boats.find((o) => o.id === 1);
      if (!b) { left = left || docked > 0; return; }
      if ((b.dockLeft ?? 0) <= 0) return;
      docked += 1 / 30;
      // Held at the berth, and still, once the line has taken it up.
      if (b.dockLeft! < DOCK / 2) {
        expect(Math.hypot(b.x - berth.x, b.y - berth.y)).toBeLessThan(0.15);
        expect(Math.hypot(b.vx, b.vy)).toBeLessThan(0.1);
        settled++;
      }
    });
    expect(docked).toBeCloseTo(DOCK, 0);
    expect(settled).toBeGreaterThan(0);
    // And then off down the river and out.
    expect(left).toBe(true);
  });

  test("and takes them off when they reach the far edge", () => {
    const g = straight();
    port(g);
    let most = 0, gone = 0;
    const ids = new Set<number>();
    const { f } = run(g, 75, (f) => {
      for (const b of f.boats) ids.add(b.id);
      most = Math.max(most, ...f.boats.map((b) => b.x));
      gone = ids.size - f.boats.length;
    });
    expect(most).toBeGreaterThan(g.w - 1.5);
    expect(gone).toBeGreaterThan(0);
    for (const b of f.boats) expect(b.x).toBeLessThan(g.w - 0.5);
  });

  test("a bigger port has more boats alongside at once, for less long each", () => {
    // Over the same two minutes, count the calls finished and the most boats
    // alongside at one moment, at a port of each tier.
    const calls = SEAPORTS.map((def) => {
      const g = straight(32, 16);
      port(g, def);
      let most = 0, done = 0;
      const was = new Map<number, boolean>();
      run(g, 120, (f) => {
        let now = 0;
        for (const b of f.boats) {
          const alongside = (b.dockLeft ?? 0) > 0;
          if (alongside) now++;
          if (was.get(b.id) && !alongside) done++;
          was.set(b.id, alongside);
        }
        most = Math.max(most, now);
      });
      return { most, done };
    });
    expect(calls.map((c) => c.most)).toEqual(SEAPORTS.map((d) => d.port!.berths));
    expect(calls[1].done).toBeGreaterThan(calls[0].done);
    expect(calls[2].done).toBeGreaterThan(calls[1].done);
  });
});

describe("a river wider than its inflow", () => {
  test("does not leave by the edge it came in over", () => {
    const g = straight();
    // Fed over only the middle two of its four rows.
    for (const y of [6, 9]) g.inflow[idx(g, 0, y)] = 0;
    const r = mapRiver(g, poolDepthOf(g));
    expect(r.exits.every((e) => e.x === g.w - 1)).toBe(true);
    expect(downstream(r, 0, 6)!.x).toBeGreaterThan(0.9);
  });
});

describe("upgrading a seaport in place", () => {
  const placed = (g: Grid, x = 8) => {
    const rivers = mapRiver(g, poolDepthOf(g));
    const history = createHistory();
    commit(g, history, placeCommand(g, SEAPORT, x, 4, { rivers })!);
    return { rivers, history, id: [...g.structures.keys()][0] };
  };

  test("grows it a tier at a time, eastward, under the same id, and stops at the top", () => {
    const g = straight();
    const { rivers, history, id } = placed(g);
    for (const tier of SEAPORTS.slice(1)) {
      commit(g, history, upgradeCommand(g, id, { rivers })!);
      const s = g.structures.get(id)!;
      expect([s.def, s.x, s.y, s.w, s.h]).toEqual([tier.id, 8, 4, tier.footprint.w, 2]);
      for (let k = 0; k < s.w; k++) for (let j = 0; j < 2; j++) expect(g.structureAt[idx(g, 8 + k, 4 + j)]).toBe(id);
    }
    expect(g.structures.size).toBe(1);
    expect(planUpgrade(g, id, { rivers })).toBeNull();          // the top tier
  });

  test("grows westward when the east is taken, and refuses when both are", () => {
    const g = straight();
    const { rivers, history, id } = placed(g);
    commit(g, history, placeCommand(g, SEAPORT, 10, 4, { rivers })!);   // right beside it
    const plan = planUpgrade(g, id, { rivers })!;
    expect(plan.ok).toBe(true);
    expect(plan.x).toBe(7);
    commit(g, history, placeCommand(g, SEAPORT, 6, 4, { rivers })!);    // and now the west too
    expect(planUpgrade(g, id, { rivers })!.ok).toBe(false);
    expect(upgradeCommand(g, id, { rivers })).toBeNull();
  });

  test("must still stand on the bank, and one undo puts it back as it was", () => {
    const g = straight();
    const { rivers, history, id } = placed(g);
    const before = { ...g.structures.get(id)! };
    commit(g, history, upgradeCommand(g, id, { rivers })!);
    undo(g, history);
    expect(g.structures.get(id)).toEqual(before);
    expect(g.structureAt[idx(g, 10, 4)]).toBe(-1);
    // With no rivers to ask, there is no bank to grow along.
    expect(upgradeCommand(g, id)).toBeNull();
  });
});

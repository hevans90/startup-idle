import { describe, expect, test } from "bun:test";

import { LINE_GAP, LINE_LOAD, LINE_PACE, LINE_TRADES, alongLine, lineDone, lineFront, lineLoads, lineSeconds, newLine, stepLine } from "./jobs";

const cells = (n: number) => Array.from({ length: n }, (_, k) => ({ x: 3 + k, y: 7 }));

describe("a line is laid, not bought", () => {
  test("its price is paid a load at a time, all of it by the end and none of it at the order; and it takes about its time", () => {
    for (const kind of ["main", "sewer", "dredge"] as const) {
      const j = newLine(1, kind, cells(17), null, 510, 0);
      let paid = 0, t = 0;
      expect(j.deliveries).toBe(lineLoads(17));
      const spend = (n: number) => { paid += n; return true; };
      expect(paid).toBe(0);
      for (; !lineDone(j) && t < 10_000; t += 0.1) stepLine(j, 0.1, spend);
      expect(lineDone(j)).toBe(true);
      expect(paid).toBeCloseTo(510, 6);
      expect(j.delivered).toBe(j.deliveries);
      // No sooner than its trades can pass it; and not long after — its loads are a few seconds each.
      expect(t).toBeGreaterThanOrEqual(lineSeconds(j) - 0.2);
      expect(t).toBeLessThan(lineSeconds(j) + j.deliveries * 8);
    }
  });

  test("the trades follow one another and none goes back; the pipe never passes what has been brought", () => {
    const j = newLine(1, "sewer", cells(20), null, 100, 0);
    let last = [0, 0, 0];
    for (let t = 0; !lineDone(j) && t < 5000; t += 0.1) {
      stepLine(j, 0.1, () => true);
      const f = [0, 1, 2].map((k) => lineFront(j, k));
      for (let k = 0; k < LINE_TRADES; k++) expect(f[k]).toBeGreaterThanOrEqual(last[k] - 1e-9);
      for (let k = 1; k < LINE_TRADES; k++) expect(f[k]).toBeLessThanOrEqual(f[k - 1] + 1e-9);
      expect(f[1]).toBeLessThanOrEqual(Math.min(20, j.delivered * LINE_LOAD) + 1e-6);
      last = f;
    }
    expect(lineFront(j, 2)).toBeCloseTo(20, 6);
    expect(LINE_GAP * LINE_PACE.sewer).toBeGreaterThan(0);
  });

  test("with no money it stands where it is, and nothing is lost; with money again it goes on", () => {
    const j = newLine(1, "main", cells(12), null, 240, 0);
    let money = 120, paid = 0;
    const spend = (n: number) => (money >= n ? ((money -= n), (paid += n), true) : false);
    for (let t = 0; t < 300; t += 0.1) stepLine(j, 0.1, spend);
    expect(lineDone(j)).toBe(false);
    expect(j.stalled).toBeGreaterThan(0);
    expect(paid).toBeCloseTo(120, 6);
    const at = j.t;
    for (let t = 0; t < 50; t += 0.1) stepLine(j, 0.1, spend);
    expect(j.t).toBe(at);
    money = 1000;
    for (let t = 0; !lineDone(j) && t < 300; t += 0.1) stepLine(j, 0.1, spend);
    expect(lineDone(j)).toBe(true);
    expect(paid).toBeCloseTo(240, 6);
    expect(j.stalled).toBe(0);
  });

  test("a place along it is on it, and faces the way it runs — round a corner too", () => {
    const bend = [...cells(4), { x: 6, y: 8 }, { x: 6, y: 9 }];
    expect(alongLine(bend, 0.5)).toMatchObject({ x: 3, y: 7 });
    expect(alongLine(bend, 2.5).heading).toBeCloseTo(0, 6);
    expect(alongLine(bend, 5.5)).toMatchObject({ x: 6, y: 9 });
    expect(alongLine(bend, 5.5).heading).toBeCloseTo(Math.PI / 2, 6);
    expect(alongLine(bend, 99)).toMatchObject({ x: 6, y: 9 });
  });
});

// ── through the game's own actions ──────────────────────────────────────────────────────────
import { afterEach } from "bun:test";
import { useMoneyStore } from "../../state/money.store";
import { useWorldStore } from "../../state/world.store";
import { hasMain } from "../water/mains";
import { idx } from "../grid";

describe("a main dragged in the game", () => {
  const S = () => useWorldStore.getState();
  const game = (built: boolean) => {
    S().resize(40, 24);
    S().loadGrid(S().grid);
    useWorldStore.setState({ playing: true, roadWorks: built });
    useMoneyStore.getState().increaseMoney(1e9);
    return S().grid;
  };
  afterEach(() => useWorldStore.setState({ playing: false, roadWorks: false }));
  const route = Array.from({ length: 9 }, (_, k) => ({ x: 6 + k, y: 12 }));
  const laid = (g: ReturnType<typeof game>) => route.filter((c) => hasMain(g, idx(g, c.x, c.y))).length;
  /** The player's own drag of the Pipe tool along the route. (The AI's hand lays at once: not this.) */
  const layPipePath = (cells: typeof route) => { S().setTool("pipe"); S().setBrush("line"); useWorldStore.setState({ notice: null }); S().beginStroke(cells[0]); S().updateStroke(cells[cells.length - 1]); S().endStroke(); };

  test("is ordered, not laid: nothing on the map and nothing paid; then laid, all of it, and paid for by then — a load at a time", () => {
    // What it costs, from laying the same thing where it is laid at once.
    let g = game(false);
    let before = useMoneyStore.getState().money;
    layPipePath(route);
    expect(laid(g)).toBe(route.length);
    const price = before.minus(useMoneyStore.getState().money).toNumber();
    expect(price).toBeGreaterThan(0);

    g = game(true);
    before = useMoneyStore.getState().money;
    layPipePath(route);
    expect(laid(g)).toBe(0);
    expect(g.lineJobs.length).toBe(1);
    expect(g.lineJobs[0]).toMatchObject({ kind: "main", delivered: 0, t: 0 });
    expect(g.lineJobs[0].cost).toBeCloseTo(price, 6);
    expect(useMoneyStore.getState().money.eq(before)).toBe(true);
    for (let t = 0; t < 400 && g.lineJobs.length; t += 0.25) { S().stepLineWorks(0.25); if (g.lineJobs.length) expect(laid(g)).toBe(0); }
    expect(g.lineJobs.length).toBe(0);
    expect(laid(g)).toBe(route.length);
    expect(before.minus(useMoneyStore.getState().money).toNumber()).toBeCloseTo(price, 4);
  });

  test("called off under Demolish before it is done: no main, and no job", () => {
    const g = game(true);
    layPipePath(route);
    expect(g.lineJobs.length).toBe(1);
    S().setTool("demolish"); S().setBrush("line");
    S().beginStroke({ x: 8, y: 12 }); S().updateStroke({ x: 8, y: 12 }); S().endStroke();
    expect(g.lineJobs.length).toBe(0);
    for (let t = 0; t < 60; t += 0.25) S().stepLineWorks(0.25);
    expect(laid(g)).toBe(0);
  });

  test("the time away is caught up", () => {
    const g = game(true);
    layPipePath(route);
    S().catchUpLineWorks(g.lineJobs[0].at + 3600_000);
    expect(g.lineJobs.length).toBe(0);
    expect(laid(g)).toBe(route.length);
  });
});

describe("a building under Demolish in the game", () => {
  const S = () => useWorldStore.getState();
  afterEach(() => useWorldStore.setState({ playing: false, roadWorks: false }));
  test("is ordered down, not gone: it stands until the gang has had its time at it, then it is gone as Demolish takes it; a site is called off at once", () => {
    S().resize(40, 24);
    const g0 = S().grid;
    for (let x = 0; x < g0.w; x++) g0.paved[idx(g0, x, 10)] = 1;
    S().loadGrid(g0);
    useWorldStore.setState({ playing: true, roadWorks: false });
    useMoneyStore.getState().increaseMoney(1e9);
    const g = S().grid;
    const put = (def: string, x: number) => { useWorldStore.setState({ tool: "placeStructure", structureDefId: def, notice: null }); S().commitStructure({ x, y: 11 }); };
    put("office-intern", 4);
    expect([...g.structures.values()].filter((q) => q.def === "office-intern").length).toBe(1);
    useWorldStore.setState({ roadWorks: true });
    const knock = (x: number) => { useWorldStore.setState({ tool: "demolish", notice: null }); S().commitStructure({ x, y: 11 }); };
    knock(4);
    expect(g.structures.size).toBe(1);
    expect(g.razeJobs.length).toBe(1);
    // (Asked twice, it is one job.)
    knock(5);
    expect(g.razeJobs.length).toBe(1);
    const need = g.razeJobs[0].need;
    for (let t = 0; t < need - 1; t += 0.25) S().stepLineWorks(0.25);
    expect(g.structures.size).toBe(1);
    for (let t = 0; t < 2; t += 0.25) S().stepLineWorks(0.25);
    expect(g.structures.size).toBe(0);
    expect(g.razeJobs.length).toBe(0);
    // A site, not built yet: called off there and then.
    put("office-intern", 12);
    const site = [...g.structures.values()][0];
    expect(site.build).toBeDefined();
    knock(12);
    expect(g.structures.size).toBe(0);
    expect(g.razeJobs.length).toBe(0);
  });
});

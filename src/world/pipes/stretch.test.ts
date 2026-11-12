/**
 * A STRETCH OF A MAIN: the run between two joints, found off the graph;
 * widened by itself, lifted by itself leaving caps, and picked by a first
 * click where a second picks the whole network. @see stretch, plans/pipe-network.md phase 17
 */
import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { boreCost } from "../../game/build-cost";
import { useMoneyStore } from "../../state/money.store";
import { useWorldStore } from "../../state/world.store";
import { MAIN_BORE, MAIN_END, createGrid, fillTerrain, idx, type Grid } from "../grid";
import { findMains, layMain, planMain } from "../water/mains";
import { pipeGraph } from "./graph";
import { deleteStretch, movableEnd, sameStretch, stretchAt } from "./stretch";

afterEach(() => { useWorldStore.getState().setPlaying(false); useMoneyStore.setState({ money: new Decimal(0) }); });

const dry = () => false;
const lay = (g: Grid, cells: { x: number; y: number }[]) => {
  const p = planMain(g, cells, dry, false);
  if ("refused" in p) throw new Error(p.refused);
  layMain(g, p.cells);
};
const line = (x0: number, y0: number, x1: number, y1: number) => {
  const out: { x: number; y: number }[] = [], n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = 0; k <= n; k++) out.push({ x: x0 + Math.sign(x1 - x0) * k, y: y0 + Math.sign(y1 - y0) * k });
  return out;
};
/**
 * A trunk main along y = 5 from x = 2 to x = 20, capped at both ends, with a
 * branch off it at x = 10 down to y = 11 that bends east to x = 14.
 */
function tee(): Grid {
  const g = createGrid(24, 16);
  fillTerrain(g, 1);
  lay(g, line(2, 5, 20, 5));
  lay(g, [...line(10, 5, 10, 11), ...line(11, 11, 14, 11)]);
  return g;
}
const at = (g: Grid, x: number, y: number) => idx(g, x, y);
const xs = (g: Grid, cells: number[]) => cells.map((c) => `${c % g.w},${(c / g.w) | 0}`);

describe("a stretch", () => {
  test("is taken hold of by an end of its own: its cap, not the tee others hang on, nor its middle", () => {
    const g = tee();
    const looked = at(g, 5, 5);
    expect(movableEnd(g, looked, at(g, 2, 5))).toBe(true);
    expect(movableEnd(g, looked, at(g, 10, 5))).toBe(false);
    expect(movableEnd(g, looked, at(g, 6, 5))).toBe(false);
    // Another stretch's end is not this one's.
    expect(movableEnd(g, looked, at(g, 20, 5))).toBe(false);
    expect(movableEnd(g, at(g, 12, 11), at(g, 14, 11))).toBe(true);
    expect(movableEnd(g, at(g, 0, 0), at(g, 2, 5))).toBe(false);
  });

  test("is the run between two joints: from a cap to the tee, not the whole main", () => {
    const g = tee();
    expect(findMains(g).list.length).toBe(1);
    const west = stretchAt(g, at(g, 5, 5))!;
    expect(xs(g, west.cells)).toEqual(xs(g, line(2, 5, 10, 5).map((c) => at(g, c.x, c.y))));
    // Its cap is its own; the tee is shared with the two other runs.
    expect(west.shared).toEqual([false, true]);
    const east = stretchAt(g, at(g, 15, 5))!;
    expect(east.cells.length).toBe(11);
    expect(east.cells).toContain(at(g, 10, 5));
    expect(east.cells).not.toContain(at(g, 9, 5));
  });

  test("goes on through a bend, and through the points the graph keeps along a straight", () => {
    const g = tee();
    const branch = stretchAt(g, at(g, 10, 8))!;
    // Down from the tee, round the corner, on to its cap: one stretch.
    expect(branch.cells[0] === at(g, 10, 5) || branch.cells[branch.cells.length - 1] === at(g, 10, 5)).toBe(true);
    expect(branch.cells).toContain(at(g, 10, 11));
    expect(branch.cells).toContain(at(g, 14, 11));
    expect(branch.cells.length).toBe(7 + 4);
    // More than one of the graph's links: it has nodes every few tiles and at the bend.
    const graph = pipeGraph(g);
    expect(new Set(branch.cells.map((c) => graph.linkAt.main[c]).filter((l) => l >= 0)).size).toBeGreaterThan(1);
    // Asked anywhere along it, it is the same stretch.
    expect(sameStretch(g, at(g, 10, 8), at(g, 13, 11))).toBe(true);
    expect(sameStretch(g, at(g, 10, 8), at(g, 5, 5))).toBe(false);
  });

  test("a main with no joints in it is one stretch: all of it", () => {
    const g = createGrid(16, 8);
    fillTerrain(g, 1);
    lay(g, line(2, 3, 12, 3));
    const s = stretchAt(g, at(g, 6, 3))!;
    expect(s.cells.length).toBe(11);
    expect(s.shared).toEqual([false, false]);
    expect(stretchAt(g, at(g, 6, 6))).toBeNull();
  });
});

describe("lifting a stretch", () => {
  test("takes its own tiles and leaves what it was joined to: the tee becomes a straight run", () => {
    const g = tee(), branch = stretchAt(g, at(g, 10, 8))!;
    for (const t of deleteStretch(g, branch)) { g.main[t.cell] = t.main; g.mainEnd[t.cell] = t.end; }
    g.rev++;
    // The branch is gone, the trunk whole: one main still, nineteen tiles, capped at its two ends.
    const nets = findMains(g).list;
    expect(nets.length).toBe(1);
    expect(nets[0].cells.length).toBe(19);
    expect(g.main[at(g, 10, 8)]).toBe(0);
    expect(g.mainEnd[at(g, 10, 5)]).toBe(0);
    // And the trunk is now one stretch end to end.
    expect(stretchAt(g, at(g, 5, 5))!.cells.length).toBe(19);
  });

  test("never leaves a loose end without a fitting: what stays is whole runs between caps", () => {
    const g = tee();
    for (const t of deleteStretch(g, stretchAt(g, at(g, 15, 5))!)) { g.main[t.cell] = t.main; g.mainEnd[t.cell] = t.end; }
    g.rev++;
    // The east arm gone, the tee is a bend: the west arm and the branch are now one stretch, cap to cap.
    const nets = findMains(g).list;
    expect(nets.length).toBe(1);
    const rest = stretchAt(g, at(g, 5, 5))!;
    expect(rest.cells.length).toBe(nets[0].cells.length);
    expect(rest.shared).toEqual([false, false]);
    for (const c of nets[0].cells) {
      const joins = [1, 2, 4, 8].filter((b) => g.main[c] & b).length;
      if (joins < 2) expect(g.mainEnd[c]).toBe(MAIN_END.cap);
    }
    // A joint left with one run on it and no fitting is given a cap: asked for directly.
    const one = stretchAt(g, at(g, 5, 5))!;
    const forced = deleteStretch(g, { ...one, cells: one.cells.slice(0, 4), shared: [false, true] });
    const end = forced.find((t) => t.cell === one.cells[3])!;
    expect(end.end).toBe(MAIN_END.cap);
    expect(end.main & 15).not.toBe(0);
  });
});

describe("by stretch, from the card", () => {
  const play = (g: Grid) => {
    const st = useWorldStore.getState();
    st.loadGrid(g);
    st.setPlaying(true);
    return useWorldStore.getState().grid;
  };

  test("a click picks the stretch; a second on it, the whole network; a click on another stretch, that one", () => {
    const g = play(tee()), st = () => useWorldStore.getState();
    st().lookAt({ x: 5, y: 5 });
    expect(st().pipeScope).toBe("stretch");
    st().lookAt({ x: 7, y: 5 });
    expect(st().pipeScope).toBe("network");
    st().lookAt({ x: 15, y: 5 });
    expect(st().pipeScope).toBe("stretch");
    st().lookAt({ x: 10, y: 8 });
    expect(st().pipeScope).toBe("stretch");
    expect(g.main[at(g, 10, 8)]).not.toBe(0);
  });

  test("widening a stretch widens it alone, for its own tiles' price: a wide link beside slim ones", () => {
    const g = play(tee()), st = () => useWorldStore.getState();
    const branch = stretchAt(g, at(g, 10, 8))!;
    useMoneyStore.setState({ money: new Decimal(boreCost(branch.narrow).toNumber() + 3) });
    st().widenMainAt({ x: 10, y: 8 }, true);
    expect(useMoneyStore.getState().money.toNumber()).toBe(3);
    for (const c of branch.cells) expect(g.main[c] & MAIN_BORE).toBe(MAIN_BORE);
    expect(g.main[at(g, 5, 5)] & MAIN_BORE).toBe(0);
    expect(g.main[at(g, 15, 5)] & MAIN_BORE).toBe(0);
    // The graph has a bore a link: the branch's are wide, the trunk's are not.
    const graph = pipeGraph(g);
    expect(graph.links[graph.linkAt.main[at(g, 10, 8)]].bore).toBe(2);
    expect(graph.links[graph.linkAt.main[at(g, 5, 5)]].bore).toBe(1);
    // Nothing left to widen on it; the whole main still has its slim tiles.
    expect(stretchAt(g, at(g, 10, 8))!.narrow).toBe(0);
  });

  test("lifting a stretch from the store lifts it alone, and can be undone", () => {
    const g = play(tee()), st = () => useWorldStore.getState();
    st().deleteMainAt({ x: 10, y: 8 }, true);
    expect(g.main[at(g, 10, 8)]).toBe(0);
    expect(g.main[at(g, 5, 5)]).not.toBe(0);
    st().doUndo();
    expect(useWorldStore.getState().grid.main[at(g, 10, 8)]).not.toBe(0);
    // Without the stretch asked for, the whole of it goes, as it always did.
    st().deleteMainAt({ x: 10, y: 8 });
    expect(findMains(useWorldStore.getState().grid).list.length).toBe(0);
  });

  test("moving a stretch lifts it and starts a run from its end furthest from the click", () => {
    const g = play(tee()), st = () => useWorldStore.getState();
    // Clicked near its cap at (14, 11): that end moves, and the run starts again at the tee.
    st().moveStretchAt({ x: 13, y: 11 });
    expect(g.main[at(g, 13, 11)]).toBe(0);
    expect(g.main[at(g, 10, 8)]).toBe(0);
    expect(g.main[at(g, 10, 5)]).not.toBe(0);
    expect(st().tool).toBe("pipe");
    expect(st().stroke?.pins).toEqual([{ x: 10, y: 5 }]);
  });
});

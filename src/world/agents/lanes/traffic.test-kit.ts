/** Shared by the traffic tests: towns to drive in, and whether two vehicles touch. */
import { commit, createHistory } from "../../edit/commands";
import { createGrid, fillTerrain, idx, type Grid } from "../../grid";
import { structureDef } from "../../structures/def";
import { placeCommand } from "../../structures/place";
import { halfLength } from "../cars/fleet";
import type { Mover } from "../town";

const pave = (g: Grid, x: number, y: number) => { g.paved[idx(g, x, y)] = 1; };

/** Two roads crossing edge to edge, `kx` and `ky` cells wide, with houses along both. */
export function crossroads(kx: number, ky: number, n = 40) {
  const g = createGrid(n, n);
  fillTerrain(g, 1);
  const at = n / 2 - 1;
  for (let x = 0; x < n; x++) for (let j = 0; j < kx; j++) pave(g, x, at + j);
  for (let y = 0; y < n; y++) for (let j = 0; j < ky; j++) pave(g, at + j, y);
  const history = createHistory();
  const kit = structureDef("kit:intern.t0")!;
  for (let k = 3; k < n - 3; k += 3) {
    if (Math.abs(k - at) < 4) continue;
    for (const [x, y] of [[k, at - 1], [k, at + kx], [at - 1, k], [at + ky, k]]) {
      const cmd = placeCommand(g, kit, x, y);
      if (cmd) commit(g, history, cmd);
    }
  }
  return g;
}

/** Houses along a town's roads, one every third cell on each side where there is room: somewhere for its traffic to go. */
export function settle(g: Grid): Grid {
  const history = createHistory();
  const kit = structureDef("kit:intern.t0")!;
  const road = (x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h && g.paved[idx(g, x, y)] !== 0;
  for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
    if (road(x, y) || (x + 2 * y) % 3 || ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => road(x + dx, y + dy))) continue;
    const cmd = placeCommand(g, kit, x, y);
    if (cmd) commit(g, history, cmd);
  }
  return g;
}

/**
 * A ROAD `k` CELLS WIDE THAT WINDS: in from the rim, a jog a cell sideways, round a bend, another jog, and out by
 * the rim — with houses along it.
 */
export function winding(k: number, n = 48) {
  const g = createGrid(n, n);
  fillTerrain(g, 1);
  // Along x at rows 10.., a cell over from x = 14; then down from the bend, a cell over from y = 30.
  for (let x = 0; x <= 32; x++) for (let j = 0; j < k + (x === 14 ? 1 : 0); j++) pave(g, x, 10 + j + (x > 14 ? 1 : 0));
  for (let y = 11; y < n; y++) for (let j = 0; j < k + (y === 30 ? 1 : 0); j++) pave(g, 33 - k + j + (y > 30 ? 1 : 0), y);
  return settle(g);
}

/** A vehicle's half width, tiles: a car's, or a bike's and its rider's. */
const halfWidth = (m: Mover) => (m.kind === "bike" ? 0.03 : 0.08);

/** Whether two vehicles' outlines overlap, a little inside their real size. */
export function overlap(a: Mover, b: Mover) {
  const box = (m: Mover) => {
    const c = Math.cos(m.heading), s = Math.sin(m.heading);
    return { x: m.x, y: m.y, ax: [[c, s], [-s, c]], h: [halfLength(m) * 0.92, halfWidth(m) * 0.92] };
  };
  const A = box(a), B = box(b);
  for (const P of [A, B]) for (const [ux, uy] of P.ax) {
    const span = (Q: typeof A) => {
      const c = Q.x * ux + Q.y * uy;
      const r = Q.h[0] * Math.abs(Q.ax[0][0] * ux + Q.ax[0][1] * uy) + Q.h[1] * Math.abs(Q.ax[1][0] * ux + Q.ax[1][1] * uy);
      return [c - r, c + r];
    };
    const [a0, a1] = span(A), [b0, b1] = span(B);
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}


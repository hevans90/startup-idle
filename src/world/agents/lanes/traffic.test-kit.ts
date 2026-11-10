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

/** Whether two vehicles' outlines overlap, a little inside their real size. */
export function overlap(a: Mover, b: Mover) {
  const box = (m: Mover) => {
    const c = Math.cos(m.heading), s = Math.sin(m.heading);
    return { x: m.x, y: m.y, ax: [[c, s], [-s, c]], h: [halfLength(m) * 0.92, 0.08 * 0.92] };
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


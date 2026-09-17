/**
 * World v2 — road connectivity (plan §5.1).
 *
 * Autotiling makes a road LOOK connected. Nothing else so far makes it BE
 * connected, and essentially every builder mechanic downstream — road access,
 * reachability, delivery, utilities, traffic — needs the real thing. Built now
 * because it hooks the dirty-cell events the autotiler already emits; retrofitted
 * later it would mean auditing every mutation.
 *
 * It uses {@link connects}, the same predicate as the render mask, so what you
 * see is what the graph believes. Two predicates would drift, and the drift
 * would be invisible until something downstream took the wrong route.
 *
 * Union-find over paved cells. Painting unions, which is trivially incremental.
 * ERASING can split a component, which union-find cannot undo — so an erase
 * refloods the affected component instead, bounded by its size. That is the
 * standard trade, and at this map scale a whole reflood is a few thousand cells.
 */
import { idx, inBounds, VOID, type Grid } from "../grid";
import type { Cell } from "../iso";
import { DIR, connects, isPaved } from "./mask";

const DIRS = ["N", "E", "S", "W"] as const;

export type Network = {
  /** Union-find parent per cell; −1 where unpaved. */
  parent: Int32Array;
  /** Component size, valid at roots only. */
  size: Int32Array;
  readonly w: number;
  readonly h: number;
};

export function createNetwork(grid: Grid): Network {
  const n = grid.w * grid.h;
  const net: Network = {
    parent: new Int32Array(n).fill(-1),
    size: new Int32Array(n),
    w: grid.w,
    h: grid.h,
  };
  rebuild(net, grid);
  return net;
}

/** Path-halving find. Returns −1 for an unpaved cell. */
export function find(net: Network, i: number): number {
  if (i < 0 || net.parent[i] < 0) return -1;
  let r = i;
  while (net.parent[r] !== r) {
    net.parent[r] = net.parent[net.parent[r]];
    r = net.parent[r];
  }
  return r;
}

function union(net: Network, a: number, b: number) {
  const ra = find(net, a), rb = find(net, b);
  if (ra < 0 || rb < 0 || ra === rb) return;
  // by size, so find stays near-flat
  const [big, small] = net.size[ra] >= net.size[rb] ? [ra, rb] : [rb, ra];
  net.parent[small] = big;
  net.size[big] += net.size[small];
  net.size[small] = 0;
}

/** Full rebuild. For a load, a resize, or a fixture. */
export function rebuild(net: Network, grid: Grid) {
  net.parent.fill(-1);
  net.size.fill(0);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (!isPaved(grid, x, y)) continue;
      const i = idx(grid, x, y);
      net.parent[i] = i;
      net.size[i] = 1;
    }
  }
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (!isPaved(grid, x, y)) continue;
      const i = idx(grid, x, y);
      // only S and W, so each edge is visited once
      for (const dir of ["S", "W"] as const) {
        if (!connects(grid, x, y, dir)) continue;
        const [dx, dy] = dir === "S" ? [1, 0] : [0, 1];
        union(net, i, idx(grid, x + dx, y + dy));
      }
    }
  }
}

/** Component id for a cell, or −1 when unpaved. Stable only until the next edit. */
export const netIdAt = (net: Network, grid: Grid, x: number, y: number): number =>
  inBounds(grid, x, y) ? find(net, idx(grid, x, y)) : -1;

export function isConnected(net: Network, grid: Grid, a: Cell, b: Cell): boolean {
  const ra = netIdAt(net, grid, a.x, a.y);
  return ra >= 0 && ra === netIdAt(net, grid, b.x, b.y);
}

export const componentSize = (net: Network, id: number) => (id < 0 ? 0 : net.size[id]);

/** How many distinct components exist. The number the debug overlay colours by. */
export function componentCount(net: Network): number {
  let n = 0;
  for (let i = 0; i < net.parent.length; i++) if (net.parent[i] === i) n++;
  return n;
}

/**
 * Unpaved cells orthogonally touching a component — "does this building have
 * road access?", which is the question Phase 5 will ask constantly.
 */
export function cellsAdjacentToNet(net: Network, grid: Grid, id: number): Cell[] {
  const seen = new Set<number>();
  const out: Cell[] = [];
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (!isPaved(grid, x, y)) continue;
      if (find(net, idx(grid, x, y)) !== id) continue;
      for (const dir of DIRS) {
        const [dx, dy] = dir === "N" ? [-1, 0] : dir === "E" ? [0, -1] : dir === "S" ? [1, 0] : [0, 1];
        const nx = x + dx, ny = y + dy;
        if (!inBounds(grid, nx, ny)) continue;
        if (grid.paved[idx(grid, nx, ny)] !== VOID) continue;
        const k = idx(grid, nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ x: nx, y: ny });
      }
    }
  }
  return out;
}

/**
 * Apply an edit.
 *
 * `grid` must ALREADY hold the new state — this reconciles the graph to it.
 * Painting is incremental; anything that could have removed a link refloods,
 * because union-find has no split. A height or ramp edit counts as removal:
 * it can sever a join without touching `paved` at all, which is the subtle case
 * a paved-only check would miss.
 */
export function applyEdit(net: Network, grid: Grid, touched: readonly Cell[], mayDisconnect: boolean) {
  if (mayDisconnect) { rebuild(net, grid); return; }

  for (const c of touched) {
    if (!isPaved(grid, c.x, c.y)) continue;
    const i = idx(grid, c.x, c.y);
    if (net.parent[i] < 0) { net.parent[i] = i; net.size[i] = 1; }
  }
  for (const c of touched) {
    if (!isPaved(grid, c.x, c.y)) continue;
    const i = idx(grid, c.x, c.y);
    for (const dir of DIRS) {
      if (!connects(grid, c.x, c.y, dir)) continue;
      const [dx, dy] = dir === "N" ? [-1, 0] : dir === "E" ? [0, -1] : dir === "S" ? [1, 0] : [0, 1];
      union(net, i, idx(grid, c.x + dx, c.y + dy));
    }
  }
}

export { DIR };

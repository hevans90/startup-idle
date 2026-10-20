/**
 * World v2 — SEEING BEHIND: whatever stands in front of what the player is
 * aiming at gets out of the way by itself.
 *
 * THE FOCUS is what the hand is on: the footprint a build tool would place,
 * the line a drag would lay, the brush; with the look tool, the building the
 * pointer is on. THE OCCLUDERS are the buildings drawn in front of it — nearer
 * the camera, and overlapping it on the screen. Each one COLLAPSES to its
 * ground floor and roof, with a faint outline of its full height, and stands
 * up again a moment after the pointer has moved on. A building drawn some
 * other way than in floors fades instead. @see tilesRenderer, world-scene
 *
 * Found from a narrow wedge of tiles in front of the focus — a building can
 * only hide what is behind it on the screen — so a pointer move is a few
 * dozen grid lookups, not a walk over the town. Pure, but for `boundsOf`.
 */
import { idx, inBounds, type Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW } from "../iso";

type Cell = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Bands in front of the focus looked at: as tall as a tall building stands, in tiles. */
export const CUT_REACH = 24;
/** Screen columns either side of the focus looked at, tiles: a wide building's reach sideways. */
export const CUT_SIDE = 3;
/** How long a building stays down after it stops being in the way, ms: no flicker as the pointer moves. */
export const GRACE_MS = 350;
/** How tall a building being placed is taken to be, half steps: so a tower placed behind another clears it too. */
export const PLACE_UP = 8;

/**
 * A tile's diamond as a box in the scene's space, raised `up` half steps above
 * its ground — and `inset` of the way in from each side: a pointer is on the
 * middle of a tile, and a building that only clips the box's corner is not
 * over it.
 */
export function tileRect(g: Grid, c: Cell, scale: number, up = 0, inset = 0): Rect {
  const z = inBounds(g, c.x, c.y) ? g.height[idx(g, c.x, c.y)] : 0;
  const cx = (c.x - c.y) * HW * scale, cy = (c.x + c.y) * HH * scale - z * HEIGHT_UNIT * scale;
  const lift = up * HEIGHT_UNIT * scale;
  const hw = HW * scale * (1 - inset), hh = HH * scale * (1 - inset);
  return { x: cx - hw, y: cy - hh - lift, w: 2 * hw, h: 2 * hh + lift };
}
/** How far in a pointed-at tile is tested from its sides: the middle of it. */
export const POINT_INSET = 0.4;

const meet = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The buildings drawn in front of the focus: nearer the camera than the focus
 * tile they overlap on the screen. `boundsOf` is where a building is drawn, in
 * the scene's space; `extra` more of the focus to keep clear (the focused
 * building's own height, a placement's).
 */
export function occludersOf(
  g: Grid, focus: readonly Cell[], scale: number, boundsOf: (id: number) => Rect | null, up = 0, extra: readonly Rect[] = [], inset = 0,
): Set<number> {
  const out = new Set<number>();
  if (!focus.length) return out;
  const inFocus = new Set<number>();
  for (const c of focus) if (inBounds(g, c.x, c.y)) { const id = g.structureAt[idx(g, c.x, c.y)]; if (id >= 0) inFocus.add(id); }
  const seen = new Set<number>();
  for (const f of focus) {
    const band = f.x + f.y, col = f.x - f.y;
    const rects = [tileRect(g, f, scale, up, inset), ...extra];
    for (let b = band + 1; b <= band + CUT_REACH; b++) {
      for (let c = col - CUT_SIDE; c <= col + CUT_SIDE; c++) {
        if ((b + c) & 1) continue;             // no tile has that band and column
        const x = (b + c) / 2, y = (b - c) / 2;
        if (!inBounds(g, x, y)) continue;
        const id = g.structureAt[idx(g, x, y)];
        if (id < 0 || inFocus.has(id) || out.has(id)) continue;
        // Nearer the camera than the focus tile: its front corner's band beyond it.
        const s = g.structures.get(id);
        if (!s || s.x + s.w - 1 + s.y + s.h - 1 <= band) continue;
        const key = id * 4096 + (band & 4095);
        if (seen.has(key)) continue;
        seen.add(key);
        const r = boundsOf(id);
        if (r && rects.some((f2) => meet(r, f2))) out.add(id);
      }
    }
  }
  return out;
}

/**
 * WHO IS DOWN, AND UNTIL WHEN: a building collapses the moment it is in the
 * way, and stands again `GRACE_MS` after it stops being. `set` takes this
 * moment's occluders; `tick` stands up those whose grace is over. The changes
 * come back as what to collapse and what to raise.
 */
export function createCutaway() {
  const down = new Map<number, number>();       // id → when it may stand again; Infinity while in the way
  return {
    set(next: ReadonlySet<number>, now: number): { collapse: number[] } {
      const collapse: number[] = [];
      for (const id of next) { if (!down.has(id)) collapse.push(id); down.set(id, Infinity); }
      for (const [id, until] of down) if (!next.has(id) && until === Infinity) down.set(id, now + GRACE_MS);
      return { collapse };
    },
    tick(now: number): { raise: number[] } {
      const raise: number[] = [];
      for (const [id, until] of down) if (until <= now) { raise.push(id); down.delete(id); }
      return { raise };
    },
    /** Raise everyone, at once: a new map, a teardown. */
    clear(): number[] { const all = [...down.keys()]; down.clear(); return all; },
    has: (id: number) => down.has(id),
    get size() { return down.size; },
  };
}

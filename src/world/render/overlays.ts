/**
 * World v2 — world-space overlays.
 *
 * Geometry and colour only, no text: per-cell numbers would be 4,096 labels on
 * a 64² map, illegible zoomed out and redundant zoomed in. Exact values are
 * reported by HTML anchored to the cell instead (see `anchors/`).
 *
 * Lives inside the viewport, above the bands, so it pans and zooms with the
 * world.
 */
import { Graphics } from "pixi.js";

import { HEIGHT_UNIT, HH, HW, cellToWorld, type Cell } from "../iso";
import { heightAt, idx, inBounds, surfaceHeightAt, type Grid } from "../grid";

/** Diamond outline for one cell, as a flat point list around its centre. */
export function cellDiamond(x: number, y: number, h: number, scale: number): number[] {
  const { wx, wy } = cellToWorld(x, y, h, scale);
  const hw = HW * scale, hh = HH * scale;
  return [wx, wy - hh, wx + hw, wy, wx, wy + hh, wx - hw, wy];
}

/**
 * Grid outlines for a band range. Drawn per band rather than per cell so the
 * caller can bound the work to what is on screen — at the framed zoom a 64²
 * map is 4,096 diamonds, which is worth skipping entirely.
 */
export function drawGrid(
  g: Graphics,
  grid: Grid,
  scale: number,
  bandLo: number,
  bandHi: number,
  maxCells = 2500,
): number {
  g.clear();
  let drawn = 0;
  for (let b = Math.max(0, bandLo); b <= Math.min(grid.w + grid.h - 2, bandHi); b++) {
    const xLo = Math.max(0, b - (grid.h - 1));
    const xHi = Math.min(grid.w - 1, b);
    for (let x = xLo; x <= xHi; x++) {
      if (drawn >= maxCells) return drawn;      // bail rather than stall
      const y = b - x;
      g.poly(cellDiamond(x, y, grid.height[y * grid.w + x], scale));
      drawn++;
    }
  }
  g.stroke({ color: 0xffffff, width: 1, alpha: 0.10, pixelLine: true });
  return drawn;
}

/**
 * Draw what a decked cell is standing OVER: the ground outlined faintly, and
 * a pier at each visible vertex joining the two.
 *
 * A cell with a bridge on it has two surfaces, and every tool acts on the
 * upper one. A lone diamond cannot say which, and drawn at the ground — which
 * is what everything here did — it says the wrong one outright: the highlight
 * sat in the riverbed under the span the pointer was on, twenty half steps
 * below the road it was about to paint. So the diamond goes on the surface,
 * and this says what the surface is standing on.
 *
 * The north vertex gets no pier. It is the back corner, hidden behind the
 * cell's own top face, and a line there reads as a stray mark rather than as
 * depth. @see surfaceHeightAt
 *
 * A no-op on a cell with no deck, which is almost all of them.
 */
export function drawDeckPiers(
  g: Graphics,
  grid: Grid,
  x: number,
  y: number,
  scale: number,
  color: number,
) {
  if (!inBounds(grid, x, y)) return;
  const i = idx(grid, x, y);
  if (grid.deck[i] === 0) return;
  const top = cellDiamond(x, y, grid.deckZ[i], scale);
  const bed = cellDiamond(x, y, grid.height[i], scale);
  g.poly(bed);
  g.stroke({ color, width: 1, alpha: 0.35, pixelLine: true });
  for (const v of [1, 2, 3]) {              // E, S, W — not N, which is behind
    g.moveTo(top[v * 2], top[v * 2 + 1]).lineTo(bed[v * 2], bed[v * 2 + 1]);
  }
  g.stroke({ color, width: 1, alpha: 0.5, pixelLine: true });
}

/** Highlight one cell. Cleared when `cell` is null. */
export function drawHover(g: Graphics, grid: Grid, cell: Cell | null, scale: number) {
  g.clear();
  if (!cell || !inBounds(grid, cell.x, cell.y)) return;
  // ON THE SURFACE, which is the deck where there is one. @see drawDeckPiers
  const h = surfaceHeightAt(grid, cell.x, cell.y);
  drawDeckPiers(g, grid, cell.x, cell.y, scale, 0x7cfc9a);
  g.poly(cellDiamond(cell.x, cell.y, h, scale));
  g.fill({ color: 0x7cfc9a, alpha: 0.22 });
  g.poly(cellDiamond(cell.x, cell.y, h, scale));
  g.stroke({ color: 0x7cfc9a, width: 2, alpha: 0.9, pixelLine: true });
}

/**
 * Band shading — alternating stripes so the painter's order is visible at a
 * glance, which is the fastest way to spot a depth-sorting mistake.
 */
export function drawBandStripes(
  g: Graphics,
  grid: Grid,
  scale: number,
  bandLo: number,
  bandHi: number,
  maxCells = 2500,
) {
  g.clear();
  let drawn = 0;
  const last = grid.w + grid.h - 2;
  for (let b = Math.max(0, bandLo); b <= Math.min(last, bandHi); b++) {
    if (b % 2 !== 0) continue;
    const xLo = Math.max(0, b - (grid.h - 1));
    const xHi = Math.min(grid.w - 1, b);
    for (let x = xLo; x <= xHi; x++) {
      if (drawn >= maxCells) return;
      const y = b - x;
      g.poly(cellDiamond(x, y, grid.height[y * grid.w + x], scale));
      drawn++;
    }
  }
  g.fill({ color: 0x5aa9ff, alpha: 0.14 });
}

/** Marks cell (0,0) and the +x / +y directions, which are not guessable. */
export function drawOrigin(g: Graphics, grid: Grid, scale: number) {
  g.clear();
  const o = cellToWorld(0, 0, heightAt(grid, 0, 0) ?? 0, scale);
  g.poly(cellDiamond(0, 0, heightAt(grid, 0, 0) ?? 0, scale));
  g.fill({ color: 0xf0a63c, alpha: 0.35 });

  // +x runs down-RIGHT, +y down-LEFT — the pair everyone guesses wrong.
  const arm = 4;
  const px = cellToWorld(arm, 0, 0, scale);
  const py = cellToWorld(0, arm, 0, scale);
  g.moveTo(o.wx, o.wy).lineTo(px.wx, px.wy);
  g.stroke({ color: 0xff7a7a, width: 3, alpha: 0.85 });
  g.moveTo(o.wx, o.wy).lineTo(py.wx, py.wy);
  g.stroke({ color: 0x7cfc9a, width: 3, alpha: 0.85 });
}

/** Height as colour: warm above 0, cool below, transparent at 0. */
export function drawHeightTint(
  g: Graphics,
  grid: Grid,
  scale: number,
  bandLo: number,
  bandHi: number,
  maxCells = 2500,
) {
  g.clear();
  if (grid.minHeight === 0 && grid.maxHeight === 0) return;
  const span = Math.max(1, Math.max(grid.maxHeight, -grid.minHeight));
  let drawn = 0;
  const last = grid.w + grid.h - 2;
  for (let b = Math.max(0, bandLo); b <= Math.min(last, bandHi); b++) {
    const xLo = Math.max(0, b - (grid.h - 1));
    const xHi = Math.min(grid.w - 1, b);
    for (let x = xLo; x <= xHi; x++) {
      if (drawn >= maxCells) return;
      const y = b - x;
      const hv = grid.height[y * grid.w + x];
      drawn++;
      if (hv === 0) continue;
      g.poly(cellDiamond(x, y, hv, scale));
      g.fill({
        color: hv > 0 ? 0xf0a63c : 0x5aa9ff,
        alpha: 0.12 + 0.4 * (Math.abs(hv) / span),
      });
    }
  }
}

/** Height in world px, for the readouts. */
export const heightPx = (units: number, scale = 1) => units * HEIGHT_UNIT * scale;

/**
 * Crosshair at the pointer's WORLD position, plus a line to the centre of the
 * cell picking chose.
 *
 * This is the actual calibration instrument: if the offset is right the
 * crosshair sits inside the highlighted diamond and the connector is short.
 * A crosshair consistently offset in one direction means the pick shift is
 * wrong — which is precisely the fault v1 carries unnoticed.
 */
export function drawPickCrosshair(
  g: Graphics,
  pointer: { wx: number; wy: number } | null,
  cell: Cell | null,
  grid: Grid,
  scale: number,
) {
  g.clear();
  if (!pointer) return;
  const r = 7 * scale;

  if (cell && inBounds(grid, cell.x, cell.y)) {
    // The height PICKING used, or the instrument reports an error the picker
    // did not make: over a bridge the march lands on the deck. @see surfaceSampler
    const c = cellToWorld(cell.x, cell.y, surfaceHeightAt(grid, cell.x, cell.y), scale);
    g.moveTo(pointer.wx, pointer.wy).lineTo(c.wx, c.wy);
    g.stroke({ color: 0xff7a7a, width: 1, alpha: 0.8, pixelLine: true });
    // dot at the cell centre picking resolved to
    g.circle(c.wx, c.wy, 3 * scale);
    g.fill({ color: 0xff7a7a, alpha: 0.9 });
  }

  g.moveTo(pointer.wx - r, pointer.wy).lineTo(pointer.wx + r, pointer.wy);
  g.moveTo(pointer.wx, pointer.wy - r).lineTo(pointer.wx, pointer.wy + r);
  g.stroke({ color: 0xffffff, width: 2, alpha: 0.95, pixelLine: true });
}

/** Offset from the pointer to the picked cell's centre, in world px. */
export function pickError(
  pointer: { wx: number; wy: number } | null,
  cell: Cell | null,
  grid: Grid,
  scale: number,
): { dx: number; dy: number; dist: number } | null {
  if (!pointer || !cell || !inBounds(grid, cell.x, cell.y)) return null;
  const c = cellToWorld(cell.x, cell.y, surfaceHeightAt(grid, cell.x, cell.y), scale);
  const dx = pointer.wx - c.wx;
  const dy = pointer.wy - c.wy;
  return { dx, dy, dist: Math.hypot(dx, dy) };
}

/**
 * One hue per road component.
 *
 * The single most useful road overlay there is: a network that LOOKS joined but
 * is two components is the most common bug this class of system has, and it is
 * invisible until the colours differ. Erase one cell of a loop and half of it
 * changes hue.
 *
 * Hue comes from the component id, so it is stable while nothing changes and
 * arbitrary across edits — the point is that two colours differ, not what they
 * are.
 */
export function drawNetComponents(
  g: Graphics,
  grid: Grid,
  scale: number,
  bandLo: number,
  bandHi: number,
  netIdAt: (x: number, y: number) => number,
): number {
  g.clear();
  let drawn = 0;
  const lo = Math.max(0, bandLo), hi = Math.min(grid.w + grid.h - 2, bandHi);
  for (let b = lo; b <= hi; b++) {
    const xLo = Math.max(0, b - (grid.h - 1));
    const xHi = Math.min(grid.w - 1, b);
    for (let x = xLo; x <= xHi; x++) {
      const y = b - x;
      const id = netIdAt(x, y);
      if (id < 0) continue;
      // A DECK IS A ROAD, so this is the surface height. @see setDeck
      const h = surfaceHeightAt(grid, x, y);
      g.poly(cellDiamond(x, y, h, scale));
      // golden-angle stride, so adjacent component ids never land on similar hues
      g.fill({ color: hslToHex((id * 137.508) % 360, 0.72, 0.55), alpha: 0.55 });
      drawn++;
    }
  }
  return drawn;
}

/** Mask value as colour, for reading the autotiler's decision at a glance. */
export function drawRoadMask(
  g: Graphics,
  grid: Grid,
  scale: number,
  bandLo: number,
  bandHi: number,
  maskAt: (x: number, y: number) => number,
  isPaved: (x: number, y: number) => boolean,
): number {
  g.clear();
  let drawn = 0;
  const lo = Math.max(0, bandLo), hi = Math.min(grid.w + grid.h - 2, bandHi);
  for (let b = lo; b <= hi; b++) {
    const xLo = Math.max(0, b - (grid.h - 1));
    const xHi = Math.min(grid.w - 1, b);
    for (let x = xLo; x <= xHi; x++) {
      const y = b - x;
      if (!isPaved(x, y)) continue;
      const m = maskAt(x, y);
      const h = surfaceHeightAt(grid, x, y);
      g.poly(cellDiamond(x, y, h, scale));
      // orthogonals set the hue, diagonal count the lightness
      const orth = m & 0xf;
      const diag = ((m >> 4) & 0xf).toString(2).split("").filter((c) => c === "1").length;
      g.fill({ color: hslToHex((orth / 16) * 360, 0.8, 0.35 + diag * 0.09), alpha: 0.6 });
      drawn++;
    }
  }
  return drawn;
}

/** Minimal HSL → 0xRRGGBB. Only used by the debug overlays. */
function hslToHex(hDeg: number, s: number, l: number): number {
  const h = ((hDeg % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    let u = t;
    if (u < 0) u += 1;
    if (u > 1) u -= 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  const r = Math.round(ch(h + 1 / 3) * 255);
  const gg = Math.round(ch(h) * 255);
  const bb = Math.round(ch(h - 1 / 3) * 255);
  return (r << 16) | (gg << 8) | bb;
}

/**
 * Paved cells drawing a SUBSTITUTED tile, or none at all.
 *
 * The actionable version of `roadCoverage`: instead of a list of masks, it
 * shows you the cells on the map whose art is missing. Amber for a substitution
 * (a tile that faces the right way but is the wrong family), red for a mask
 * with no tile at all.
 */
export function drawRoadGaps(
  g: Graphics,
  grid: Grid,
  scale: number,
  bandLo: number,
  bandHi: number,
  pickAt: (x: number, y: number) => { frame: string | null; exact: boolean } | null,
): number {
  g.clear();
  let drawn = 0;
  const lo = Math.max(0, bandLo), hi = Math.min(grid.w + grid.h - 2, bandHi);
  for (let b = lo; b <= hi; b++) {
    const xLo = Math.max(0, b - (grid.h - 1));
    const xHi = Math.min(grid.w - 1, b);
    for (let x = xLo; x <= xHi; x++) {
      const y = b - x;
      const pick = pickAt(x, y);
      if (!pick || pick.exact) continue;
      const h = surfaceHeightAt(grid, x, y);
      g.poly(cellDiamond(x, y, h, scale));
      g.fill({ color: pick.frame ? 0xffb347 : 0xff4d4d, alpha: 0.6 });
      drawn++;
    }
  }
  return drawn;
}

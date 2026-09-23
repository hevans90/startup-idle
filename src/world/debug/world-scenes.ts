/**
 * COMPARISON SCENES BUILT BY THE WORLD, not by hand.
 *
 * `fluid/gpu/compare-pass` has its own bridged scenes and they are written
 * column by column, which is the right shape for a fixture that has to isolate
 * one piece of arithmetic. What they cannot be is the geometry the GAME makes:
 * a hand-written deck is whatever the person writing it thought a deck was,
 * and the abutment where a road meets a span turned out to be the one place
 * that mattered and the one place no fixture had ever put water.
 *
 * So this builds a field the way the editor does — the real grid builder, the
 * real `createWaterField`, the real `syncSlots` — and pours on it. Anything
 * the solver disagrees about here is a disagreement about a map somebody could
 * actually make. It lives under `world/debug` and not under `fluid` because
 * the dependency only runs one way: the fluid engine must not know what a road
 * is. `world-scene` hands these to `compareFrames`, which takes a builder.
 */
import type { ColumnField } from "../../fluid/columns";
import { addWater } from "../../fluid/columns";
import { createGrid, type Grid } from "../grid";
import { applyFixture } from "./fixtures";
import { COLUMNS_PER_TILE, createWaterField, type WaterField } from "../water/field";

/** Every column of a tile, as field indices. */
function columnsOf(f: ColumnField, tx: number, ty: number): number[] {
  const out: number[] = [];
  for (let cy = ty * COLUMNS_PER_TILE; cy < (ty + 1) * COLUMNS_PER_TILE; cy++) {
    for (let cx = tx * COLUMNS_PER_TILE; cx < (tx + 1) * COLUMNS_PER_TILE; cx++) {
      out.push(cy * f.nx + cx);
    }
  }
  return out;
}

/**
 * The crossing fixture, with water poured on the ROAD either side of the span.
 *
 * A road east to west, a channel north to south, and a deck carrying the road
 * over the water where they meet. The pour is on the road approaches and not
 * on the deck, so the water has to reach the span by crossing the abutment —
 * which is a slot pair that is not (a, a): the road stands in slot zero and
 * the deck is slot one, level with each other and a storey apart in the index.
 *
 * WHY THIS AND NOT ANOTHER HAND-BUILT SCENE. At a real abutment the deck
 * column's slot zero is ABSENT — the terrain there is the deck's own soffit,
 * so the gap under the span has closed to nothing — while slot one carries the
 * road. A slot that is present above one that is not is the shape no fixture
 * written by hand had, because nobody writing a bridge by hand thinks to end
 * it on the ground.
 */
export function crossingScene(size = 24): { grid: Grid; field: WaterField } {
  const g = createGrid(size, size);
  applyFixture(g, "crossing", 1);
  const field = createWaterField(g);
  const f = field.columns;
  // THE ROAD EITHER SIDE OF THE SPAN, and nothing on the span itself.
  //
  // Right at the abutment rather than out at the fixture's own taps. Poured
  // six tiles back it took a hundred and fifty frames to arrive, so a
  // comparison over ninety watched the water travel and never saw it cross —
  // which is a scene that proves nothing while reporting a pass.
  //
  // `buildCrossing` lays the lane at y mid-1..mid+1 and cuts the channel at
  // x mid-1..mid+1, so the span is the square where they meet and the
  // approaches are the tiles immediately outside it.
  const mid = Math.round(size / 2);
  for (let ty = mid - 1; ty <= mid + 1; ty++) {
    for (const tx of [mid - 4, mid - 3, mid - 2, mid + 2, mid + 3, mid + 4]) {
      if (tx < 0 || tx >= size || ty < 0 || ty >= size) continue;
      for (const i of columnsOf(f, tx, ty)) {
        addWater(f, i % f.nx, (i / f.nx) | 0, 3, 1, 0);
      }
    }
  }
  return { grid: g, field };
}

/** Just the columns, for the solver comparisons. @see crossingScene */
export const crossingPoured = (): ColumnField => crossingScene().field.columns;

/**
 * Put a film on every column that has a DECK over it, and dry everything else.
 *
 * What the render check needs and the solver check does not: a state that is
 * unambiguous about where the water is, so "did the deck's water reach the
 * screen" has one answer. Returns how many columns were wetted, because a
 * check that renders nothing and a check that renders the wrong thing look the
 * same from the pixels alone.
 */
export function wetTheDecks(f: ColumnField, depth = 1.5): number {
  const { cells } = f;
  let n = 0;
  for (let i = 0; i < cells; i++) {
    f.depth[i] = 0;
    const decked = f.roof[cells + i] > f.ground[cells + i];
    f.depth[cells + i] = decked ? depth : 0;
    if (decked) n++;
  }
  // The box is what every builder walks; set by hand because nothing stepped.
  f.box.x0 = 0; f.box.y0 = 0; f.box.x1 = f.nx - 1; f.box.y1 = f.ny - 1;
  return n;
}

/**
 * Copy one field's water onto another that was built from the same grid.
 *
 * The render check builds its own field so that nothing it does reaches the
 * screen — which also means it renders water it invented rather than the water
 * somebody is complaining about. This carries the live one across: the depths,
 * what each column is made of, and the fluxes the surface is shaded from.
 */
export function copyWater(from: ColumnField, to: ColumnField): boolean {
  if (from.cells !== to.cells || from.layers !== to.layers) return false;
  to.depth.set(from.depth);
  to.material.set(from.material);
  to.fx.set(from.fx);
  to.fy.set(from.fy);
  to.box.x0 = from.box.x0; to.box.y0 = from.box.y0;
  to.box.x1 = from.box.x1; to.box.y1 = from.box.y1;
  return true;
}

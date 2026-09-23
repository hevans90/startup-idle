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
import { createGrid } from "../grid";
import { applyFixture } from "./fixtures";
import { COLUMNS_PER_TILE, createWaterField } from "../water/field";

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
export function crossingPoured(): ColumnField {
  const g = createGrid(24, 24);
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
  const mid = Math.round(24 / 2);
  for (let ty = mid - 1; ty <= mid + 1; ty++) {
    for (const tx of [mid - 4, mid - 3, mid - 2, mid + 2, mid + 3, mid + 4]) {
      if (tx < 0 || tx >= 24 || ty < 0 || ty >= 24) continue;
      for (const i of columnsOf(f, tx, ty)) {
        addWater(f, i % f.nx, (i / f.nx) | 0, 3, 1, 0);
      }
    }
  }
  return f;
}

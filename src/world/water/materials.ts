/**
 * World v2 — what kinds of fluid there are.
 *
 * A fluid is a colour, a drag and a name. Nothing in the simulation or the
 * renderer knows what water is or what sludge is. Adding a third — lava, tar —
 * is one entry here.
 *
 * Indices are what the column field's `material` array stores and what map
 * files carry, so **order matters**: index 0 is dry, and re-ordering the rest
 * would recolour every saved map. Append only.
 */

export type FluidMaterial = {
  /** Stable id, saved in map files rather than the index. */
  id: string;
  name: string;
  /** Base surface colour; the renderer shades it by the surface's own tilt. */
  colour: number;
  /**
   * Flux retention per second — how readily it keeps moving.
   *
   * The one place a fluid's character now lives. Depth, rest level and
   * choppiness are all gone: they described a flat plane sitting in a basin,
   * and a column has no plane and no basin. Sludge is draggier than water and
   * that is the whole difference.
   */
  drag: number;
};

/** Index 0 — no fluid. Never rendered, never simulated. */
export const DRY = 0;

/**
 * Every fluid, indexed by what the material array stores.
 *
 * Sludge is thicker: it holds less of its flux from one moment to the next, so
 * it creeps where water runs. The pair is set by the GAP between their damping
 * rates rather than the ratio — water lost most of its bulk damping when bed
 * friction took over the dissipating, and matching the old ratio against the
 * new, far smaller number left the two fluids all but identical. Released the
 * same way, sludge settles 9.3 tiles out and water 11.0. Both colours are mid-tone on purpose — the
 * renderer lightens them toward white with movement and depth, so a base that
 * is already dark has no highlight left and one already bright clips.
 */
export const FLUIDS: readonly (FluidMaterial | null)[] = [
  null,
  { id: "water", name: "water", colour: 0x2a6f97, drag: 0.9 },
  { id: "slop", name: "slop", colour: 0x1e3a1e, drag: 0.45 },
];

export const fluidMaterial = (index: number): FluidMaterial | null =>
  FLUIDS[index] ?? null;

/** Layer index for an id, or 0. For map files, which save the id not the index. */
export const fluidIndexOf = (id: string): number => {
  const i = FLUIDS.findIndex((f) => f?.id === id);
  return i < 0 ? DRY : i;
};

/** Every placeable fluid, with the index the layer stores. */
export const fluidChoices = (): { index: number; material: FluidMaterial }[] =>
  FLUIDS.flatMap((m, index) => (m ? [{ index, material: m }] : []));

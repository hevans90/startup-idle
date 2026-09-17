/**
 * World v2 — which inner-corner variants exist.
 *
 * Pixi-free on purpose: `dev/bake-road-corners.ts` imports this to decide what
 * to composite, and a build script should not pull in a renderer.
 *
 * Derived from the resolver rather than enumerated by hand, so the baked sheet
 * cannot drift from what {@link roadSpriteFor} asks for.
 */
import { DIAG, ORTH_MASK } from "./mask";
import { VERTEX_FLANKS, VERTICES, notchVariantFrame, type Vertex } from "./notch";
import { roadSpriteFor, type RoadTable } from "./table";

export type NotchVariant = {
  /** Base frame the variant composites on top of. */
  frame: string;
  /** Corners that get a kerb nub. */
  notches: Vertex[];
  /** Baked frame name — what the engine actually looks up. */
  baked: string;
};

/**
 * Masks a real grid can produce.
 *
 * A diagonal can only be paved when BOTH its flanking orthogonals are, so the
 * other combinations never arise and building textures for them would be waste.
 */
export function reachableMasks(): number[] {
  const out: number[] = [];
  for (let orth = 0; orth <= ORTH_MASK; orth++) {
    for (let d = 0; d <= 15; d++) {
      const diag = d << 4;
      const ok = VERTICES.every(
        (v) => !(diag & DIAG[v]) || (orth & VERTEX_FLANKS[v]) === VERTEX_FLANKS[v],
      );
      if (ok) out.push(orth | diag);
    }
  }
  return out;
}

/**
 * The distinct variants a table actually needs.
 *
 * Derived from the resolver rather than enumerated by hand, so it cannot drift:
 * whatever `roadSpriteFor` asks for is what gets built.
 */
export function notchVariantsNeeded(table: RoadTable): NotchVariant[] {
  const seen = new Map<string, NotchVariant>();
  for (const mask of reachableMasks()) {
    const pick = roadSpriteFor(table, mask);
    if (!pick.base || !pick.notches.length) continue;
    const baked = notchVariantFrame(pick.base, pick.notches);
    if (!seen.has(baked)) {
      seen.set(baked, { frame: pick.base, notches: [...pick.notches], baked });
    }
  }
  return [...seen.values()];
}


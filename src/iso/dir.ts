/**
 * SHARED (Phase 0). Bodies moved verbatim from `src/office/**`; the original
 * modules re-export them so v1 call sites are untouched. Do NOT change behaviour
 * here — v2 adds siblings alongside instead.
 */

/**
 * Road auto-tiling from the hand-labelled tileset (see dev labeller →
 * road-labels.json). Edge naming matches the labeller: N=top-left,
 * E=top-right, S=bottom-right, W=bottom-left.
 */
export const DIR = { N: 1, E: 2, S: 4, W: 8 } as const;

/**
 * Map-neighbour offset across each labelled edge, from the iso projection
 * (+mapX → screen down-right, +mapY → down-left):
 *   N → (x-1, y)   E → (x, y-1)   S → (x+1, y)   W → (x, y+1)
 */
export const NEIGHBOUR: Record<keyof typeof DIR, [number, number]> = {
  N: [-1, 0],
  E: [0, -1],
  S: [1, 0],
  W: [0, 1],
};

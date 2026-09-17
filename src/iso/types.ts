/**
 * SHARED (Phase 0). Bodies moved verbatim from `src/office/**`; the original
 * modules re-export them so v1 call sites are untouched. Do NOT change behaviour
 * here — v2 adds siblings alongside instead.
 */

/** SubTexture `name` from a `*_sheet.xml` under `public/isometric_assets` (e.g. `landscapeTiles_019.png`). */
export type SpriteId = string;

export type Cell = { mapX: number; mapY: number };

export type Rect = { x0: number; y0: number; x1: number; y1: number };

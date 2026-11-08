/**
 * World v2 — MARKS ON THE GROUND a disaster leaves: a SCORCH under and round
 * a building burnt out, and CRACKS under and round one an earthquake
 * damaged. Each stays while the building is damaged by it, and fades out
 * over minutes once it is rebuilt.
 *
 * A Graphics a tile, in the tile's band's paved tier: over the ground and the
 * roads, under every building — so the ring round the building shows, and
 * what stands in front still hides it. Added when the mark starts and taken
 * out when it has faded; in between only its alpha changes, once a second.
 * @see plans/disaster-rendering.md
 */
import { Graphics } from "pixi.js";

import { idx, inBounds, structureAt, type Grid, type Structure } from "../grid";
import { bandOf, cellToWorld, HH, HW } from "../iso";
import type { DamageCause } from "../events/damage";
import type { RenderCtx } from "../structures/render";

export type DecalKind = "scorch" | "crack";
/** How long a mark takes to fade once its building is rebuilt. */
export const DECAL_FADE_MS: Record<DecalKind, number> = { scorch: 180_000, crack: 120_000 };
const OF_CAUSE: Partial<Record<DamageCause, DecalKind>> = { fire: "scorch", quake: "crack" };

/** A mark's tiles: its footprint, and the ring round it not under another building. `inner` for those under it. */
export function decalTiles(g: Grid, s: Structure): { x: number; y: number; inner: boolean }[] {
  const out: { x: number; y: number; inner: boolean }[] = [];
  for (let y = s.y - 1; y <= s.y + s.h; y++) {
    for (let x = s.x - 1; x <= s.x + s.w; x++) {
      if (!inBounds(g, x, y)) continue;
      const inner = x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
      if (!inner && structureAt(g, x, y) >= 0) continue;
      out.push({ x, y, inner });
    }
  }
  return out;
}

/** The same numbers for the same tile, every time: a mark doesn't change shape as it is drawn again. */
const rand = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

/**
 * One tile's mark, about its centre, at scale 1. `toward` is where the
 * building is from it, in tiles: a ring tile's mark leans that way, the
 * burn or the crack running out from it.
 */
export function drawDecal(gfx: Graphics, kind: DecalKind, seed: number, inner: boolean, toward: { u: number; v: number }) {
  const r = rand(seed);
  // A point on the tile, u and v from -0.5 to 0.5 across it.
  const P = (u: number, v: number): [number, number] => [(u - v) * HW, (u + v) * HH];
  if (kind === "scorch") {
    // A soft burn: many faint patches overlapping, darkest against the
    // building and thinning out across the tile, so tiles run into each other.
    // How far a point is from the building's side of the tile: 0 there, 1 across.
    const off = (u: number, v: number) => (inner ? 0 : 0.5 - (u * toward.u + v * toward.v));
    for (let k = 0; k < 12; k++) {
      const u = r() - 0.5, v = r() - 0.5;
      const w = Math.pow(Math.max(0, 1 - off(u, v) * (0.85 + 0.4 * r())), 1.4);
      if (w < 0.05) continue;
      const [cx, cy] = P(u * 0.8, v * 0.8);
      const rad = (0.22 + 0.14 * r()) * HW, colour = r() < 0.5 ? 0x1e1712 : 0x33261c;
      // Feathered: rings stacked smaller and smaller, so it is darkest in its middle.
      for (let ring = 8; ring >= 1; ring--) gfx.ellipse(cx, cy, (rad * ring) / 8, (rad * ring) / 16).fill({ color: colour, alpha: 0.055 * w });
    }
    // Ash flecks, where it burnt hardest.
    for (let k = 0; k < 6; k++) {
      const u = r() - 0.5, v = r() - 0.5;
      if (off(u, v) > 0.45) continue;
      const [cx, cy] = P(u * 0.9, v * 0.9);
      gfx.ellipse(cx, cy, 1.5 + 1.5 * r(), 0.8 + 0.6 * r()).fill({ color: 0x8e8880, alpha: 0.5 });
    }
    return;
  }
  // CRACKS: jagged lines out from a point, dark, a pale lip beside each.
  const from = inner ? [(r() - 0.5) * 0.3, (r() - 0.5) * 0.3] : [toward.u * 0.45, toward.v * 0.45];
  const arms = inner ? 3 : 2;
  for (let a = 0; a < arms; a++) {
    // Away from the building on a ring tile; any way under it.
    const ang = inner ? (a / arms) * Math.PI * 2 + r() : Math.atan2(-toward.v, -toward.u) + (r() - 0.5) * 1.6;
    const pts: number[] = [];
    let u = from[0], v = from[1];
    pts.push(...P(u, v));
    for (let s = 0; s < 4; s++) {
      const len = 0.09 + 0.06 * r(), turn = ang + (r() - 0.5) * 1.1;
      u = Math.max(-0.47, Math.min(0.47, u + Math.cos(turn) * len));
      v = Math.max(-0.47, Math.min(0.47, v + Math.sin(turn) * len));
      pts.push(...P(u, v));
    }
    // A fork off its middle, thinner.
    const mid = 4, fork = [pts[mid], pts[mid + 1]];
    let fu = u, fv = v;
    for (let s = 0; s < 2; s++) {
      const turn = ang + (r() < 0.5 ? 1 : -1) * (0.7 + 0.5 * r());
      fu = Math.max(-0.47, Math.min(0.47, from[0] + (u - from[0]) * 0.45 + Math.cos(turn) * 0.1 * (s + 1)));
      fv = Math.max(-0.47, Math.min(0.47, from[1] + (v - from[1]) * 0.45 + Math.sin(turn) * 0.1 * (s + 1)));
      fork.push(...P(fu, fv));
    }
    gfx.poly(pts.map((p, i) => (i % 2 ? p + 1.5 : p)), false).stroke({ color: 0xd8ccb4, width: 1.5, alpha: 0.45 });
    gfx.poly(pts, false).stroke({ color: 0x241d18, width: 2.6, alpha: 0.85 });
    gfx.poly(fork, false).stroke({ color: 0x241d18, width: 1.6, alpha: 0.75 });
  }
}

/** The marks wanted now: one a building damaged by fire or quake, by key. Pure. */
export function decalsWanted(damaged: Iterable<readonly [number, DamageCause]>): Map<string, { id: number; kind: DecalKind }> {
  const out = new Map<string, { id: number; kind: DecalKind }>();
  for (const [id, cause] of damaged) {
    const kind = OF_CAUSE[cause];
    if (kind) out.set(`${kind}:${id}`, { id, kind });
  }
  return out;
}

/** How solid a mark is, `since` ms after its building was rebuilt; null once gone. */
export function decalAlpha(kind: DecalKind, since: number | null): number | null {
  if (since === null) return 1;
  const a = 1 - since / DECAL_FADE_MS[kind];
  return a > 0 ? a : null;
}

export type Decals = {
  /** Put down, fade or take up the marks, for what is damaged now; once a second. */
  sync: (ctx: RenderCtx, damaged: readonly (readonly [number, DamageCause])[], now: number) => void;
  clear: () => void;
};

export function createDecals(): Decals {
  /** Each mark: its tiles' Graphics, and when its building was rebuilt, if it has been. */
  const marks = new Map<string, { kind: DecalKind; tiles: Graphics[]; rebuilt: number | null }>();
  const drop = (key: string) => {
    for (const t of marks.get(key)?.tiles ?? []) if (!t.destroyed) { t.parent?.removeChild(t); t.destroy(); }
    marks.delete(key);
  };
  return {
    sync(ctx, damaged, now) {
      const g = ctx.grid;
      const want = decalsWanted(damaged);
      for (const [key, m] of marks) {
        // Its band went with a rebuilt map: put down again, below.
        if (m.tiles.some((t) => t.destroyed || !t.parent || t.parent.destroyed)) { drop(key); continue; }
        if (want.has(key)) { m.rebuilt = null; continue; }
        m.rebuilt ??= now;
        const a = decalAlpha(m.kind, now - m.rebuilt);
        if (a === null) { drop(key); continue; }
        for (const t of m.tiles) t.alpha = a;
      }
      for (const [key, w] of want) {
        if (marks.has(key)) continue;
        const s = g.structures.get(w.id);
        if (!s) continue;
        const cx = s.x + (s.w - 1) / 2, cy = s.y + (s.h - 1) / 2;
        const tiles: Graphics[] = [];
        for (const t of decalTiles(g, s)) {
          const layer = ctx.bands.pavedOf[bandOf(t.x, t.y)];
          if (!layer) continue;
          const gfx = new Graphics({ label: "decal" });
          const du = cx - t.x, dv = cy - t.y, d = Math.hypot(du, dv) || 1;
          drawDecal(gfx, w.kind, w.id * 7919 + t.x * 131 + t.y, t.inner, { u: du / d, v: dv / d });
          const { wx, wy } = cellToWorld(t.x, t.y, g.height[idx(g, t.x, t.y)], ctx.scale);
          gfx.position.set(wx, wy);
          gfx.scale.set(ctx.scale);
          gfx.eventMode = "none";
          layer.addChild(gfx);
          tiles.push(gfx);
        }
        marks.set(key, { kind: w.kind, tiles, rebuilt: null });
      }
    },
    clear() {
      for (const key of [...marks.keys()]) drop(key);
    },
  };
}

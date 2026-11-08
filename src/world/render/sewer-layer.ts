/**
 * World v2 — THE SEWERS, DRAWN. What shows depends on where it is:
 *
 *  - UNDER THE GROUND, in each band's sewer tier, seen only in the
 *    underground view: each trunk a tube at its own depth, coloured by what
 *    it is doing (umber draining, grey going nowhere), chevrons pointing the
 *    way it falls, and a drop from each manhole down to it;
 *  - AT THE SURFACE, always: a cast-iron MANHOLE cover flush with the ground
 *    at each node (paved tier, over the ground and roads); and, sorted with
 *    the town in the structure tier, a SPAN on piers where it crosses a dip,
 *    a brick LIFT STATION where it is pumped up, a concrete HEADWALL where it
 *    pours into water or feeds a processor.
 *
 * Drawn again only when the sewers, the ground or the scale change; the view
 * only shows or hides the tier. @see world/sewers/solve, plans/underground-sewers.md §6
 */
import { Graphics, type Container } from "pixi.js";

import { DIR, NEIGHBOUR } from "../../iso/dir";
import { SEWER_BORE, SEWER_FIT, idx, type Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW, bandOf } from "../iso";
import type { SewerPlan } from "../sewers/lay";
import { sewerReportsFor } from "../sewers/flow";
import { LATERAL_REACH, SEWER_KIND, solveSewers, type SewerSolve } from "../sewers/solve";
import type { BandLayer } from "./bands";

const SIDES = ["N", "E", "S", "W"] as const;
/** A trunk's radius, tile units; how much fatter a widened bore is. */
const TUBE_R = 0.07, BORE_WIDE = 1.35;
/** Its colours: draining, going nowhere; the dark under it and the light along it. */
const UMBER = 0x7a5230, NOWHERE = 0x8b8f96, BACKED = 0x9c3b1e, SHADE = 0x2a1c10, SHINE = 0xc79a66;
/** A sewer being dragged: how see-through, and a tile it can't be laid on. */
const GHOST_ALPHA = 0.6, BAD = 0xd8463a;
/** Where a slop maker in hand could go: the tiles a live manhole reaches, tinted. */
const REACH = 0x3fe0a8, REACH_ALPHA = 0.16;
/** The flow's chevrons. */
const CHEVRON = 0xf0d2a8;
/** Cast iron, its rim and its pattern; brick, concrete, a pier. */
const IRON = 0x3a3c40, IRON_RIM = 0x6b6e73, IRON_DARK = 0x26272a;
const BRICK = 0x9a4f3a, BRICK_DARK = 0x6e3627, ROOF = 0x5a5d62;
const CONCRETE = 0xb8b4aa, CONCRETE_DARK = 0x8a867c, PIER = 0x6f6a62;

export type SewerLayer = {
  /** Draw again if the sewers, the ground or the scale changed; show the underground or not. */
  sync: (g: Grid, scale: number, underground: boolean, ghost?: SewerPlan | null, reach?: boolean) => void;
  destroy: () => void;
};

/** A point on a tile at a height, in the scene's space: `u`, `v` tiles from its middle. */
function at(x: number, y: number, z: number, scale: number, u = 0, v = 0): [number, number] {
  const X = x + u, Y = y + v;
  return [(X - Y) * HW * scale, ((X + Y) * HH - z * HEIGHT_UNIT) * scale];
}

/** An iso box on a tile's middle: `a` tiles half across, `h` height units tall, from `z`. Its top and two faces that show. */
function box(gfx: Graphics, x: number, y: number, z: number, a: number, h: number, scale: number, side: number, front: number, top: number) {
  const P = (u: number, v: number, zz: number) => at(x, y, zz, scale, u, v);
  const flat = (...ps: [number, number][]) => ps.flat();
  // The face toward +x (lower right) and toward +y (lower left).
  gfx.poly(flat(P(a, -a, z), P(a, a, z), P(a, a, z + h), P(a, -a, z + h))).fill({ color: side });
  gfx.poly(flat(P(-a, a, z), P(a, a, z), P(a, a, z + h), P(-a, a, z + h))).fill({ color: front });
  gfx.poly(flat(P(-a, -a, z + h), P(a, -a, z + h), P(a, a, z + h), P(-a, a, z + h))).fill({ color: top });
}

/** A tube from one point to another: shade under, body, a light along its top. */
function tube(gfx: Graphics, a: [number, number], b: [number, number], r: number, body: number) {
  gfx.moveTo(a[0], a[1] + r * 0.25).lineTo(b[0], b[1] + r * 0.25).stroke({ color: SHADE, width: r * 2.3, cap: "round" });
  gfx.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke({ color: body, width: r * 2, cap: "round" });
  gfx.moveTo(a[0], a[1] - r * 0.45).lineTo(b[0], b[1] - r * 0.45).stroke({ color: SHINE, width: r * 0.55, cap: "round", alpha: 0.75 });
}

/** A manhole cover, flush with the ground at a tile's middle. */
function cover(gfx: Graphics, x: number, y: number, z: number, scale: number) {
  const [cx, cy] = at(x, y, z, scale);
  const rx = 0.24 * HW * scale, ry = rx * (HH / HW);
  gfx.ellipse(cx, cy, rx * 1.12, ry * 1.12).fill({ color: IRON_RIM });
  gfx.ellipse(cx, cy, rx, ry).fill({ color: IRON });
  // Its cast pattern: two rings and a cross.
  gfx.ellipse(cx, cy, rx * 0.66, ry * 0.66).stroke({ color: IRON_DARK, width: Math.max(0.6, scale), alpha: 0.9 });
  gfx.moveTo(cx - rx * 0.66, cy).lineTo(cx + rx * 0.66, cy).stroke({ color: IRON_DARK, width: Math.max(0.6, scale * 0.8), alpha: 0.8 });
  gfx.moveTo(cx, cy - ry * 0.66).lineTo(cx, cy + ry * 0.66).stroke({ color: IRON_DARK, width: Math.max(0.6, scale * 0.8), alpha: 0.8 });
}

export function createSewerLayer(bands: BandLayer): SewerLayer {
  /** What each band has drawn in it, by tier, so it can be cleared. */
  const drawn: Graphics[] = [], ghosts: Graphics[] = [], rings: Graphics[] = [];
  let ringed: { rev: number; scale: number } | null = null;

  /** The tiles within a lateral's reach of a live manhole, tinted, each in its band's paved tier. */
  function drawReach(g: Grid, scale: number) {
    clear(rings);
    const s = solveSewers(g), seen = new Set<number>(), make = gfxIn(rings, 1), by = new Map<number, Graphics>();
    for (const net of s.nets) {
      if (!net.exits.length) continue;
      for (const n of net.nodes) {
        const nx = n % g.w, ny = (n / g.w) | 0;
        for (let dy = -LATERAL_REACH; dy <= LATERAL_REACH; dy++) {
          for (let dx = -(LATERAL_REACH - Math.abs(dy)); dx <= LATERAL_REACH - Math.abs(dy); dx++) {
            const x = nx + dx, y = ny + dy;
            if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
            const i = idx(g, x, y);
            if (seen.has(i)) continue;
            seen.add(i);
            const b = bandOf(x, y);
            let gfx = by.get(b);
            if (!gfx) { gfx = make(bands.pavedOf, b); by.set(b, gfx); }
            const z = g.height[i];
            gfx.poly([...at(x, y, z, scale, -0.5, -0.5), ...at(x, y, z, scale, 0.5, -0.5), ...at(x, y, z, scale, 0.5, 0.5), ...at(x, y, z, scale, -0.5, 0.5)])
              .fill({ color: REACH, alpha: REACH_ALPHA });
          }
        }
      }
    }
  }
  let ghosted: SewerPlan | null = null;
  let was = { rev: -1, scale: 0, grid: null as Grid | null };
  let shown = false;
  let last: { sewer: Uint8Array; fit: Uint8Array; height: Int8Array } | null = null;
  const equal = (a: ArrayLike<number>, b: ArrayLike<number>) => {
    if (a.length !== b.length) return false;
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
    return true;
  };
  const gfxIn = (into: Graphics[], alpha: number) => (tier: Container[], b: number) => {
    const g = new Graphics();
    g.eventMode = "none";
    g.alpha = alpha;
    tier[b]?.addChild(g);
    into.push(g);
    return g;
  };
  const clear = (list: Graphics[] = drawn) => {
    for (const g of list) if (!g.destroyed) { g.parent?.removeChild(g); g.destroy(); }
    list.length = 0;
  };

  /**
   * Draw a map's sewers: all of them, or — for a ghost — only `only`, see-
   * through, a tile in `bad` red.
   */
  /** Networks backed up, surcharging or stopped, by id, and when last seen so: held a while, so a flicker redraws nothing. */
  const trouble = new Map<number, number>();
  let troubled = "";
  const TROUBLE_HOLD_MS = 2000;

  function draw(g: Grid, s: SewerSolve, scale: number, o: { into?: Graphics[]; only?: Set<number>; alpha?: number; bad?: number } = {}) {
    const into = o.into ?? drawn;
    clear(into);
    const make = gfxIn(into, o.alpha ?? 1);
    // A band's Graphics, made when it first has something.
    const under = new Map<number, Graphics>(), flush = new Map<number, Graphics>(), up = new Map<number, Graphics>();
    const take = (m: Map<number, Graphics>, tier: Container[], b: number) => {
      let gfx = m.get(b);
      if (!gfx) { gfx = make(tier, b); m.set(b, gfx); }
      return gfx;
    };
    for (const net of s.nets) {
      for (const i of net.cells) {
        if (o.only && !o.only.has(i)) continue;
        const x = i % g.w, y = (i / g.w) | 0, b = bandOf(x, y), ground = g.height[i];
        const r = TUBE_R * HW * scale * (g.sewer[i] & SEWER_BORE ? BORE_WIDE : 1);
        const lvl = s.level[i], kind = s.kind[i];
        const colour = i === o.bad ? BAD : !o.only && trouble.has(net.id) ? BACKED : s.drains[i] ? UMBER : NOWHERE;
        // The tube's middle: its floor plus its radius, in height units.
        const mid = (l: number) => l + (TUBE_R * HW) / HEIGHT_UNIT;
        // OUT TO EACH FACE IT JOINS, level with the neighbour's halfway.
        for (const side of SIDES) {
          if (!(g.sewer[i] & DIR[side])) continue;
          const [dx, dy] = NEIGHBOUR[side];
          const j = idx(g, x + dx, y + dy);
          if (!(g.sewer[j] & DIR[({ N: "S", S: "N", E: "W", W: "E" } as const)[side]])) continue;
          const face = (mid(lvl) + mid(s.level[j])) / 2;
          const from = at(x, y, mid(lvl), scale), to = at(x, y, face, scale, dx / 2, dy / 2);
          if (kind === SEWER_KIND.span) {
            // In the air: with the town, and a pier down to the ground.
            const gfx = take(up, bands.structureOf, b);
            tube(gfx, from, to, r, colour);
          } else tube(take(under, bands.sewerOf, b), from, to, r, colour);
        }
        // THE WAY IT FALLS, a chevron toward the next down.
        if (s.down[i] >= 0 && kind !== SEWER_KIND.span) {
          const d = s.down[i], dx = (d % g.w) - x, dy = ((d / g.w) | 0) - y;
          const gfx = take(under, bands.sewerOf, b);
          const tip = at(x, y, mid(lvl), scale, dx * 0.22, dy * 0.22);
          const l = at(x, y, mid(lvl), scale, -dx * 0.05 - dy * 0.12, -dy * 0.05 + dx * 0.12);
          const rr = at(x, y, mid(lvl), scale, -dx * 0.05 + dy * 0.12, -dy * 0.05 - dx * 0.12);
          gfx.moveTo(...l).lineTo(...tip).lineTo(...rr).stroke({ color: CHEVRON, width: Math.max(1, r * 0.5), alpha: 0.9 });
        }
        // A SPAN'S PIER, from under the tube to the ground.
        if (kind === SEWER_KIND.span) {
          const gfx = take(up, bands.structureOf, b);
          const [px, top] = at(x, y, lvl, scale), [, foot] = at(x, y, ground, scale);
          gfx.rect(px - r * 0.35, top, r * 0.7, Math.max(0, foot - top)).fill({ color: PIER });
          gfx.moveTo(px - r * 0.9, top).lineTo(px + r * 0.9, top).stroke({ color: SHADE, width: Math.max(1, r * 0.4) });
        }
        // A LIFT STATION: a brick pump house over where it lifts.
        if (kind === SEWER_KIND.lift) {
          const gfx = take(up, bands.structureOf, b);
          box(gfx, x, y, ground, 0.26, 2.2, scale, BRICK_DARK, BRICK, ROOF);
          // A steel door on the face toward the camera's left.
          const P = (u: number, zz: number) => at(x, y, ground + zz, scale, u, 0.26);
          gfx.poly([...P(-0.08, 0), ...P(0.08, 0), ...P(0.08, 1.4), ...P(-0.08, 1.4)]).fill({ color: IRON });
        }
        const fit = g.sewerFit[i];
        // A HEADWALL where it pours out or feeds a processor.
        if (fit === SEWER_FIT.outfall || fit === SEWER_FIT.inlet) {
          const gfx = take(up, bands.structureOf, b);
          // Its mouth on the side toward the water, or else the side it isn't joined on.
          const open = (s: (typeof SIDES)[number]) => {
            const [dx, dy] = NEIGHBOUR[s];
            const j = x + dx >= 0 && y + dy >= 0 && x + dx < g.w && y + dy < g.h ? idx(g, x + dx, y + dy) : -1;
            return { s, wet: j >= 0 && (g.pool[j] > 0 || g.fluid[j] > 0), joined: (g.sewer[i] & DIR[s]) !== 0 };
          };
          const sides = SIDES.map(open);
          const side = (sides.find((o) => o.wet && !o.joined) ?? sides.find((o) => !o.joined) ?? sides[0]).s;
          const [dx, dy] = NEIGHBOUR[side];
          const z = ground + 0.15;
          const from = at(x, y, z, scale), to = at(x, y, z, scale, dx * 0.58, dy * 0.58);
          // Toward the camera's sides the wall hides it; away from them, it shows past the wall.
          const behind = dx < 0 || dy < 0;
          const pipe = () => {
            tube(gfx, from, to, r * 1.2, CONCRETE_DARK);
            gfx.ellipse(to[0], to[1], r * 1.1, r * 0.9).fill({ color: SHADE });
          };
          if (behind) pipe();
          box(gfx, x, y, ground - 0.4, 0.26, 1.1, scale, CONCRETE_DARK, CONCRETE, CONCRETE);
          if (!behind) pipe();
        }
        // A NODE: its cover at the surface, and its drop down to the pipe.
        if (fit === SEWER_FIT.node) {
          cover(take(flush, bands.pavedOf, b), x, y, ground, scale);
          const gfx = take(under, bands.sewerOf, b);
          const [sx, sy] = at(x, y, ground, scale), [, py] = at(x, y, mid(lvl), scale);
          gfx.rect(sx - r * 1.2, sy, r * 2.4, Math.max(0, py - sy)).fill({ color: IRON_RIM, alpha: 0.55 });
        }
      }
    }
  }

  return {
    sync(g, scale, underground, ghost = null, reach = false) {
      // A SLOP MAKER IN HAND: where its port could be piped from.
      if (!reach) { if (ringed) { clear(rings); ringed = null; } }
      else if (!ringed || ringed.rev !== g.rev || ringed.scale !== scale) { drawReach(g, scale); ringed = { rev: g.rev, scale }; }
      // WHAT EACH NETWORK IS DOING: red-brown while backed up, surcharging or stopped.
      const now = performance.now();
      for (const [id, r] of sewerReportsFor(g)) if (r.state === "backed-up" || r.state === "surcharged" || r.state === "unpaid") trouble.set(id, now);
      for (const [id, t] of trouble) if (now - t > TROUBLE_HOLD_MS) trouble.delete(id);
      const key = [...trouble.keys()].sort((a, b) => a - b).join();
      if (key !== troubled) { troubled = key; was = { ...was, rev: -1 }; last = null; }
      // What it draws from: the sewers and the ground under them. A building
      // put up moves the map's revision on, and changes neither.
      if (was.grid !== g || was.rev !== g.rev || was.scale !== scale) {
        const same = was.grid === g && was.scale === scale && last && equal(last.sewer, g.sewer) && equal(last.fit, g.sewerFit) && equal(last.height, g.height);
        was = { grid: g, rev: g.rev, scale };
        if (!same) {
          last = { sewer: g.sewer.slice(), fit: g.sewerFit.slice(), height: g.height.slice() };
          draw(g, solveSewers(g), scale);
        }
      }
      // THE SEWER IN HAND: its tiles as they would be, see-through, drawn again as the drag moves.
      if (ghost !== ghosted || (ghost && was.scale !== scale)) {
        ghosted = ghost;
        if (!ghost) clear(ghosts);
        else {
          const only = new Set(ghost.cells.map((c) => idx(g, c.x, c.y)));
          draw(ghost.staged, ghost.solve, scale, { into: ghosts, only, alpha: GHOST_ALPHA, bad: ghost.problem?.cell });
        }
      }
      if (underground !== shown) {
        shown = underground;
        for (const t of bands.sewerOf) t.visible = underground;
      }
    },
    destroy: () => { clear(drawn); clear(ghosts); clear(rings); },
  };
}

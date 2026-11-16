/**
 * World v2 — A BRIDGE, BUILT. A road over water is a deck in the air
 * (`Grid.deck`); drawn as the road alone it is a ribbon floating over the
 * river. This stands it on something and gives it sides — as one of five
 * kinds of bridge, by its shape and where it is: a stone viaduct, a timber
 * trestle, a steel plate girder, a through truss, a cable-stayed span.
 *
 * WHAT GOES WHERE is worked out here from the deck's cells and nothing else
 * ({@link bridgePiecesOf}); the pieces are baked models (`props/bridges`), in
 * the props' sheet. Three tiers a tile, by what hides what:
 *  - `under`: what it stands on, drawn before the tile's own road, which is over it;
 *  - `back`: what stands along a far edge, behind whoever is on the deck;
 *  - `front`: its side along a near edge, and what is over the road, in front of them.
 */
import { Container } from "pixi.js";

import type { Grid } from "../grid";
import { idx, inBounds } from "../grid";
import { bandOf } from "../iso";
import { bakedProps, propSprite, propSprites, propsLoaded } from "../props/props-sheet";
import { ARCH_SPRING, HS } from "../props/bridges";
import type { BandLayer } from "./bands";

export type BridgeKind = "arch" | "trestle" | "girder" | "truss" | "stay";
export type BridgePiece = { id: string; turn: number; x: number; y: number; z: number; tier: "under" | "back" | "front" };
/** A bridge: the deck's cells joined up, the way it runs, how long and wide it is, the room under it, and what kind it is. */
export type Bridge = { kind: BridgeKind; cells: number[]; alongX: boolean; a0: number; len: number; width: number; room: number };

/** A pier every this many tiles along a girder or a truss; a pylon every this many of a cable-stayed bridge; the least room under a deck, half steps, for a pier to be worth standing. */
export const PIER_EVERY = 3, PYLON_EVERY = 7, PIER_ROOM = 3;
/** How far under the road each thing hangs, half steps; and how tall a footing stands. @see props/bridges */
const CAP_UNDER = 3.5 / HS, SPRING = ARCH_SPRING / HS, BENT_UNDER = 1.08 / HS, FOOT = 0.75 / HS;
const hash = (n: number) => { const s = Math.sin(n * 91.7 + 13.1) * 43758.5453; return s - Math.floor(s); };

/**
 * WHAT KIND A BRIDGE IS: one of those its shape allows, picked by where it
 * stands — so the same bridge is the same kind every time, and a map of them
 * is not five of one. Timber for a lane close over the water; stone arches
 * for one or two lanes with room to spring from; a truss for a long span;
 * pylons and stays for a broad, long one; a plate girder anywhere.
 */
export function kindOf(b: Pick<Bridge, "len" | "width" | "room" | "cells">): BridgeKind {
  const can: BridgeKind[] = ["girder"];
  if (b.width === 1 && b.room <= 9) can.push("trestle");
  if (b.width <= 2 && b.room >= 4) can.push("arch");
  if (b.width <= 3 && b.len >= 5) can.push("truss");
  if (b.width >= 2 && b.len >= 9) can.push("stay");
  return can[Math.floor(hash(Math.min(...b.cells)) * can.length) % can.length];
}

/** Every bridge on the map. `depth`, the water standing on the ground at a cell, half steps. */
export function bridgesOf(g: Grid, depth: (x: number, y: number) => number = () => 0, force?: BridgeKind): Bridge[] {
  const deck = (x: number, y: number) => inBounds(g, x, y) && g.deck[idx(g, x, y)] !== 0 && g.paved[idx(g, x, y)] !== 0;
  const seen = new Uint8Array(g.w * g.h), out: Bridge[] = [];
  for (let i0 = 0; i0 < seen.length; i0++) {
    if (seen[i0] || !deck(i0 % g.w, (i0 / g.w) | 0)) continue;
    const cells = [i0];
    seen[i0] = 1;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, room = 0;
    for (let q = 0; q < cells.length; q++) {
      const x = cells[q] % g.w, y = (cells[q] / g.w) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      room = Math.max(room, g.deckZ[cells[q]] - g.height[cells[q]] - Math.max(0, depth(x, y)));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (deck(x + dx, y + dy) && !seen[idx(g, x + dx, y + dy)]) { seen[idx(g, x + dx, y + dy)] = 1; cells.push(idx(g, x + dx, y + dy)); }
    }
    const alongX = x1 - x0 >= y1 - y0;
    const b = { cells, alongX, a0: alongX ? x0 : y0, len: alongX ? x1 - x0 + 1 : y1 - y0 + 1, width: alongX ? y1 - y0 + 1 : x1 - x0 + 1, room };
    out.push({ ...b, kind: force ?? kindOf(b) });
  }
  return out;
}

const NEAR = { arch: "archSide", trestle: "trestleEdge", girder: "girderEdge", truss: "trussNear", stay: "stayEdge" } as const;
const FAR = { arch: "archParapet", trestle: "trestleRail", girder: "girderRail", truss: "trussFar", stay: "stayRail" } as const;

/**
 * THE PIECES OF EVERY BRIDGE ON THE MAP, in the order they are drawn within a
 * tile. `depth`, the water standing on the ground at a cell, half steps: a
 * pier's footing is at the waterline, not on the bed under it.
 */
export function bridgePiecesOf(g: Grid, depth: (x: number, y: number) => number = () => 0, force?: BridgeKind): BridgePiece[] {
  const out: BridgePiece[] = [];
  const road = (x: number, y: number) => inBounds(g, x, y) && g.paved[idx(g, x, y)] !== 0;
  // A side of a tile: the step out through it; the turn that puts a piece's left edge on it; whether it faces the
  // camera; and which way along the map a piece so turned runs (its own +x).
  const SIDES = [
    { dx: 0, dy: 1, turn: 0, near: true, fx: 1, fy: 0 }, { dx: -1, dy: 0, turn: 1, near: false, fx: 0, fy: 1 },
    { dx: 0, dy: -1, turn: 2, near: false, fx: -1, fy: 0 }, { dx: 1, dy: 0, turn: 3, near: true, fx: 0, fy: -1 },
  ];
  for (const B of bridgesOf(g, depth, force)) {
    const K = B.kind, turn = B.alongX ? 0 : 1;
    for (const i of B.cells) {
      const x = i % g.w, y = (i / g.w) | 0, z = g.deckZ[i], k = (B.alongX ? x : y) - B.a0;
      const base = g.height[i] + Math.max(0, depth(x, y)), room = z - base;
      const put = (id: string, tier: BridgePiece["tier"], zz = z, t = turn) => out.push({ id, turn: t, x, y, z: zz, tier });
      /** A column from the footing up, a half step at a time, to `under` below the road: the last of it up behind what it carries. */
      const stack = (shaft: string, under: number, from = base + FOOT) => { for (let top = from + 1; top - 1 < z - under; top++) put(shaft, "under", top); };
      // The nearest pylon of a cable-stayed bridge, in tiles along it from here: + if this tile is on from it.
      const off = k - (Math.round((k - 3) / PYLON_EVERY) * PYLON_EVERY + 3);

      // UNDER IT, first: what it stands on.
      if (K === "arch") {
        // A pier between each arch and the last, at the tile's low end; the bank is the first one's.
        if (k > 0 && room > 0.8) {
          if (room > SPRING + 0.6) { put("archFoot", "under", base); stack("archShaft", SPRING); }
          put("archHead", "under");
        }
      } else if (K === "trestle") {
        if (room >= 1) { stack("trestleBent", BENT_UNDER, base - 0.3); put("trestleCap", "under"); }
      } else {
        const here = K === "stay" ? off === 0 : (B.alongX ? x : y) % PIER_EVERY === 1 && k >= 1 && k <= B.len - 2;
        if (here && room >= PIER_ROOM) { put("girderFoot", "under", base); stack("girderShaft", CAP_UNDER); put("girderCap", "under"); }
      }

      // ITS OPEN EDGES: what faces the camera shows its side; what faces away, only what stands over the road.
      for (const s of SIDES) {
        if (road(x + s.dx, y + s.dy)) continue;
        const tier = s.near ? "front" : "back", id = s.near ? NEAR[K] : FAR[K];
        put(id, tier, z, s.turn);
        // Along the bridge only, from here on: an end that stops in the air has a rail and no more.
        if ((s.dx !== 0) === B.alongX) continue;
        if (K === "girder" && (B.alongX ? x : y) % 2 === 0) put("bridgeLamp", tier, z, s.turn);
        if (K !== "stay") continue;
        if (off === 0) put(s.near ? "pylonLeg" : "pylonLegFar", tier, z, s.turn);
        else if (Math.abs(off) <= 3) {
          // A stay's piece has its pylon behind it (A) or ahead (B), as the piece itself runs.
          const ahead = (B.alongX ? s.fx : s.fy) * off > 0;
          put(`stay${ahead ? "A" : "B"}${Math.abs(off)}`, tier, z, s.turn);
        } else if (k % 2 === 0) put("bridgeLamp", tier, z, s.turn);
      }

      // OVER THE ROAD, last: a truss's bracing, a pylon's beams.
      if (K === "truss") put("trussTop", "front");
      if (K === "stay" && off === 0) put("pylonBeam", "front");
    }
  }
  return out;
}

export type BridgeProps = { sync(g: Grid, rev: number, scale: number, depth?: (x: number, y: number) => number, force?: BridgeKind): void; destroy(): void };

/** The bridges' pieces, in the bands. */
export function createBridgeProps(bands: BandLayer): BridgeProps {
  let drawn: Container[] = [], key = "";
  const clear = () => { for (const c of drawn) { c.parent?.removeChild(c); c.destroy({ children: true }); } drawn = []; };
  return {
    sync(g, rev, scale, depth, force) {
      const P = bakedProps() ? propsLoaded() : null;
      if (bakedProps() && !P) void propSprites();
      const k = `${rev}|${scale}|${force ?? ""}|${P ? "baked" : ""}`;
      if (k === key) return;
      key = k;
      clear();
      if (!P) return;
      // (Read once: a pier does not rise and fall with every ripple.)
      const still = depth ? (x: number, y: number) => Math.round(depth(x, y) * 2) / 2 : undefined;
      const under = new Map<number, Container>();
      for (const p of bridgePiecesOf(g, still, force)) {
        const band = bandOf(p.x, p.y), sp = propSprite(P, p.id, p.turn, p.x, p.y, p.z, scale);
        if (!sp) continue;
        if (p.tier === "under") {
          // BEFORE THE BAND'S ROADS: its own deck is over a pier, and is drawn over it.
          let c = under.get(band);
          if (!c) {
            const layer = bands.pavedOf[band];
            if (!layer) { sp.destroy({ children: true }); continue; }
            c = new Container(); c.eventMode = "none";
            layer.addChildAt(c, 0);
            under.set(band, c); drawn.push(c);
          }
          c.addChild(sp);
        } else {
          const layer = bands.dynamicOf[band];
          if (!layer) { sp.destroy({ children: true }); continue; }
          sp.zIndex = p.tier === "back" ? -0.45 : 0.45;
          layer.addChild(sp);
          drawn.push(sp);
        }
      }
    },
    destroy: clear,
  };
}

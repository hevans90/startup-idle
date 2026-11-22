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
 *  - `under`: what it stands on, from the ground up: drawn before the tile's water and its road, which are over it;
 *  - `back`: what stands along a far edge, behind whoever is on the deck;
 *  - `front`: its side along a near edge, and what is over the road, in front of them.
 */
import { Container } from "pixi.js";

import type { Grid } from "../grid";
import { idx, inBounds } from "../grid";
import { bandOf } from "../iso";
import { bakedProps, propSprite, propSprites, propsLoaded } from "../props/props-sheet";
import { ABUT_HEAD, ARCH_SPRING, BENT_MAX, BENT_UNDER, HS, FRAME_DEEP, FRAME_LOW, RIB_CROWN, RIB_FOOT } from "../props/bridges";
import type { BandLayer } from "./bands";
import { fadeWithSnow } from "./snow-cover";

export type BridgeKind = "arch" | "trestle" | "girder" | "truss" | "stay";
export type BridgePiece = { id: string; turn: number; x: number; y: number; z: number; tier: "under" | "back" | "front"; /** The cell it is drawn with, where that is not the one it stands on: a piece on the line between two tiles. */ cell?: { x: number; y: number }; /** Drawn this much taller than baked, from its foot: a pier made to the nearest half step, fitted to the room there is. */ stretch?: number };
/** A bridge: the deck's cells joined up, the way it runs, how long and how many lanes wide it is, whether it is a plain rectangle of deck, the room under it to the ground, and what kind it is. */
export type Bridge = { kind: BridgeKind; cells: number[]; alongX: boolean; a0: number; len: number; width: number; rect: boolean; room: number };

/** A pylon every this many tiles of a cable-stayed bridge; the least room under a deck, half steps, for a pier's head to fit. */
export const PYLON_EVERY = 7, PIER_ROOM = 2;
/** The most room under a deck to the ground, half steps, that timber is built over: higher is stone's or steel's. */
export const TRESTLE_ROOM = 12;
/** How far under the road each thing hangs, half steps; and how tall a footing stands. @see props/bridges */
const CAP_UNDER = 3.5 / HS, SPRING = ARCH_SPRING / HS, FOOT = 0.75 / HS;
const hash = (n: number) => { const s = Math.sin(n * 91.7 + 13.1) * 43758.5453; return s - Math.floor(s); };

/**
 * WHAT KIND A BRIDGE IS: one of those its shape allows, picked by where it
 * stands — so the same bridge is the same kind every time, and a map of them
 * is not five of one. Timber for a lane not far over the bed; stone arches
 * for one or two lanes with room to spring from; a truss for a long straight
 * span; pylons and stays for a broad, long, straight one; a plate girder
 * anywhere. By the ground and not the water, which rises and falls: a bridge
 * is not rebuilt in another style by a flood.
 */
export function kindOf(b: Pick<Bridge, "len" | "width" | "room" | "cells"> & { rect?: boolean }): BridgeKind {
  const can: BridgeKind[] = ["girder"], rect = b.rect ?? true;
  if (b.width === 1 && b.room <= TRESTLE_ROOM) can.push("trestle");
  if (b.width <= 2 && b.room >= 4) can.push("arch");
  if (rect && b.width <= 3 && b.len >= 5) can.push("truss");
  if (rect && b.width >= 2 && b.len >= 9) can.push("stay");
  return can[Math.floor(hash(Math.min(...b.cells)) * can.length) % can.length];
}

/** Every bridge on the map. */
export function bridgesOf(g: Grid, _depth?: (x: number, y: number) => number, force?: BridgeKind): Bridge[] {
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
      room = Math.max(room, g.deckZ[cells[q]] - g.height[cells[q]]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (deck(x + dx, y + dy) && !seen[idx(g, x + dx, y + dy)]) { seen[idx(g, x + dx, y + dy)] = 1; cells.push(idx(g, x + dx, y + dy)); }
    }
    const alongX = x1 - x0 >= y1 - y0, len = alongX ? x1 - x0 + 1 : y1 - y0 + 1, across = alongX ? y1 - y0 + 1 : x1 - x0 + 1;
    // A STREET THAT CROSSES ASLANT is a staircase of deck, not a rectangle: its lanes are what it averages across.
    const rect = cells.length === len * across;
    const b = { cells, alongX, a0: alongX ? x0 : y0, len, width: rect ? across : Math.max(1, Math.round(cells.length / len)), rect, room };
    out.push({ ...b, kind: force ?? kindOf(b) });
  }
  return out;
}

/**
 * WHERE THE ARCHES OVER A RUN OF DECK SPRING — and a timber bridge's trusses — in tiles along it from its first:
 * its length from the middle of its first tile to the middle of its last, shared out into arches of two or three
 * tiles (one, over a run of two).
 */
export function springsOf(len: number): number[] {
  const n = len - 1, count = Math.ceil(n / 3);
  return n < 1 ? [] : Array.from({ length: count + 1 }, (_, i) => Math.round((i * n) / count));
}
/** The tiles of a viaduct, along it from its first, with a gate tower on the pier at their low end: one in the middle of a short one, else one at each end and every three or four arches between. */
export function towersOf(len: number): number[] {
  if (len < 2) return [];
  if (len <= 4) return [Math.round(len / 2)];
  const n = len - 2, count = Math.max(1, Math.round(n / 3.5));
  return Array.from({ length: count + 1 }, (_, i) => 1 + Math.round((i * n) / count));
}

const NEAR = { arch: "archSide", trestle: "trestleEdge", girder: "girderEdge", truss: "trussNear", stay: "stayEdge" } as const;
/** What a bridge is faced with where it meets the bank, by its kind; and the rail that runs on along the road there. */
const FACED = { arch: "Stone", trestle: "Timber", girder: "Concrete", truss: "Concrete", stay: "Concrete" } as const;
const LAND_RAIL = { arch: "archParapet", trestle: "trestleRail", girder: "girderRail", truss: "girderRail", stay: "stayRail" } as const;
const FAR = { arch: "archParapet", trestle: "trestleRail", girder: "girderRail", truss: "trussFar", stay: "stayRail" } as const;

/**
 * THE PIECES OF EVERY BRIDGE ON THE MAP, in the order they are drawn within a
 * tile. `depth`, the water standing on the ground at a cell, half steps.
 *
 * EVERYTHING UNDER A DECK STANDS ON THE GROUND, the riverbed where there is
 * a river, and is drawn before the water, which is over as much of it as it
 * is over: nothing is made to a waterline, so none is wrong when the river
 * rises. The water says only how deep an arch may hang between two piers.
 *
 * A DECK IS NOT A RECTANGLE where a street crosses aslant: it is a staircase.
 * So what runs along a bridge — arches, trusses, ribs — runs along each
 * straight length of its EDGE, whole from that length's one end to its
 * other; and its piers stand along each straight ROW of it.
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
    const K = B.kind, turn = B.alongX ? 0 : 1, ax = B.alongX ? 1 : 0, ay = B.alongX ? 0 : 1;
    const mine = new Set(B.cells), on = (x: number, y: number) => inBounds(g, x, y) && mine.has(idx(g, x, y));
    const towers = K === "arch" && B.rect && B.width <= 2 ? towersOf(B.len) : [];
    // HOW FAR THE DECK IS OVER THE WATER, at the least, half steps: over the ground where there is none.
    let over = Infinity;
    for (const i of B.cells) { const w = Math.max(g.pool[i], depth(i % g.w, (i / g.w) | 0)); if (w > 0) over = Math.min(over, g.deckZ[i] - g.height[i] - w); }
    if (over === Infinity) over = B.room;
    // BETWEEN ITS PIERS, under the deck: a timber bridge's braced frame, a girder's or a truss's arch ribs — as deep
    // as the water leaves room for, and none where it leaves too little.
    const ribs = K === "girder" ? "rib" : K === "truss" ? "ribR" : "", crown = ribs ? RIB_CROWN[ribs] : 0;
    const ribFit = crown ? Math.min(1, (over * HS - 1.2 - crown) / (RIB_FOOT - crown)) : 0;
    const between = K === "trestle" ? (over * HS >= FRAME_DEEP + 1 ? "frame" : over * HS >= FRAME_LOW + 0.8 ? "frameLow" : "") : ribFit >= 0.45 ? ribs : "";
    const ribZ = (z: number) => z - (crown * (1 - ribFit)) / HS;
    /** A straight length of deck from a cell, back and on along the bridge, while `ok`: how far in it this cell is, and how long it is. */
    const run = (x: number, y: number, ok: (x: number, y: number) => boolean) => {
      let k = 0, n = 1;
      while (ok(x - (k + 1) * ax, y - (k + 1) * ay)) k++;
      while (ok(x + n * ax, y + n * ay)) n++;
      return { k, len: k + n };
    };
    for (const i of B.cells) {
      const x = i % g.w, y = (i / g.w) | 0, z = g.deckZ[i], ground = g.height[i], room = z - ground, k = (B.alongX ? x : y) - B.a0;
      const put = (id: string, tier: BridgePiece["tier"], zz = z, t = turn, stretch?: number) => out.push({ id, turn: t, x, y, z: zz, tier, ...(stretch && stretch !== 1 ? { stretch } : {}) });
      /** A column from the footing up, a half step at a time, to `under` below the road: the last of it up behind what it carries. */
      const stack = (shaft: string, under: number) => { for (let top = ground + FOOT + 1; top - 1 < z - under; top++) put(shaft, "under", top); };
      // Its row: this cell's place in the straight length of deck it is in.
      const row = run(x, y, on), rowSprings = springsOf(row.len);
      // The nearest pylon of a cable-stayed bridge, in tiles along it from here: + if this tile is on from it.
      const off = k - (Math.round((k - 3) / PYLON_EVERY) * PYLON_EVERY + 3), stayed = K === "stay" && B.rect;

      // UNDER IT, first: what it stands on, from the ground up.
      if (K === "arch") {
        // A pier between each arch and the last, at the tile's low end; the bank is the first one's.
        if (row.k > 0 && room > 0.8) {
          if (room > SPRING + 0.6) { put("archFoot", "under", ground); stack("archShaft", SPRING); }
          put("archHead", "under");
        }
      } else if (K === "trestle") {
        // A pier where two of its trusses meet, whole: the one made nearest the room there is from the bed to the
        // beams, and drawn the little taller or shorter that fits it exactly.
        const need = room - BENT_UNDER / HS, n = Math.max(1, Math.min(BENT_MAX, Math.round(need)));
        if (row.k >= 1 && row.k <= row.len - 2 && rowSprings.includes(row.k) && need >= 0.6) out.push({ id: `timberPier${n}`, turn, x, y, z: ground, tier: "under", stretch: need / n });
      } else {
        // A stay's pier is its pylon's; a girder's and a truss's, where two of its row's arches meet.
        const here = stayed ? off === 0 : K === "stay" ? row.k % 3 === 1 && row.k <= row.len - 2 : row.k >= 1 && row.k <= row.len - 2 && rowSprings.includes(row.k);
        if (here && room >= PIER_ROOM) { put("girderFoot", "under", ground); stack("girderShaft", CAP_UNDER); if (between && crown) put("ribWall", "under", ribZ(z), turn, ribFit); put("girderCap", "under"); }
      }

      // ITS OPEN EDGES: what faces the camera shows its side; what faces away, only what stands over the road.
      for (const s of SIDES) {
        if (road(x + s.dx, y + s.dy)) continue;
        const tier = s.near ? "front" : "back", id = s.near ? NEAR[K] : FAR[K];
        put(id, tier, z, s.turn);
        // Along the bridge only, from here on: an end that stops in the air has a rail and no more.
        if ((s.dx !== 0) === B.alongX) continue;
        // Which way along the bridge this piece's own +x runs.
        const way = B.alongX ? s.fx : s.fy;
        // THIS EDGE'S STRAIGHT LENGTH: what runs along it runs from its one end to its other, whole.
        const edge = run(x, y, (cx, cy) => on(cx, cy) && !road(cx + s.dx, cy + s.dy)), springs = springsOf(edge.len);
        // A span's own tile of what runs along it, by name: where two meet, the end of one and the start of the next.
        const along = (P: string, zz = z, fit = 1) => {
          const at = springs.indexOf(edge.k);
          if (at >= 0) {
            if (at + 1 < springs.length) put(`${P}${springs[at + 1] - edge.k}${way > 0 ? "A" : "B"}`, tier, zz, s.turn, fit);
            if (at > 0) put(`${P}${edge.k - springs[at - 1]}${way > 0 ? "B" : "A"}`, tier, zz, s.turn, fit);
          } else if (springs.length) {
            const q = springs.findIndex((v) => v > edge.k), span = springs[q] - springs[q - 1], j = edge.k - springs[q - 1];
            put(span === 2 ? `${P}2M` : `${P}3M${(j === 1) === way > 0 ? "A" : "B"}`, tier, zz, s.turn, fit);
          }
        };
        if (between && s.near) along(between, crown ? ribZ(z) : z, crown ? ribFit : 1);
        if (K === "arch" && towers.includes(k)) {
          // A GATE TOWER on the pier at the tile's low end: a turret at this edge, and over two lanes the half of the gate that springs from it.
          const at = { x: x - (B.alongX ? 0.5 : 0), y: y - (B.alongX ? 0 : 0.5), z, turn: s.turn };
          out.push({ id: s.near ? "archTower" : "archTowerFar", tier, ...at });
          if (B.width === 2) out.push({ id: "archGateHalf", tier: "front", ...at });
          // The turret's foot is the pier's: its stone on down from the springing to the ground.
          if (s.near && room > SPRING + 0.6) for (let top = ground + 1; top - 1 < z - SPRING; top++) out.push({ id: "archTowerShaft", tier: "under", ...at, z: Math.min(top, z - SPRING), cell: { x, y } });
        }
        // OVER IT: a girder's arches, each springing from a seat on the deck's edge — the pier's own concrete brought up past it where there is a pier; a timber bridge's trusses.
        if (K === "girder" && springs.includes(edge.k)) put(s.near && room >= PIER_ROOM && edge.k >= 1 && edge.k <= edge.len - 2 ? "bowSeat" : "bowSeatFar", tier, z, s.turn);
        if (K === "girder") along("bow");
        if (K === "trestle") along("kp");
        if (K !== "stay") continue;
        if (!stayed) { if (k % 2 === 0) put("bridgeLamp", tier, z, s.turn); continue; }
        if (off === 0) put(s.near ? "pylonLeg" : "pylonLegFar", tier, z, s.turn);
        else if (Math.abs(off) <= 3) {
          // A stay's piece has its pylon behind it (A) or ahead (B), as the piece itself runs.
          const ahead = (B.alongX ? s.fx : s.fy) * off > 0;
          put(`stay${ahead ? "A" : "B"}${Math.abs(off)}`, tier, z, s.turn);
        } else if (k % 2 === 0) put("bridgeLamp", tier, z, s.turn);
      }

      // OVER THE ROAD, last: a truss's bracing, a pylon's beams, a gate, a strut between two arches.
      if (K === "truss") put("trussTop", "front");
      if (stayed && off === 0) put("pylonBeam", "front");
      if (K === "arch" && B.width === 1 && towers.includes(k)) out.push({ id: "archGate", turn, x: x - (B.alongX ? 0.5 : 0), y: y - (B.alongX ? 0 : 0.5), z, tier: "front" });
      if (K === "girder" && B.rect && B.width <= 3) { const springs = springsOf(B.len); if (springs.length && !springs.includes(k)) { const q = springs.findIndex((v) => v > k); put(`bowBrace${springs[q] - springs[q - 1]}`, "front"); } }

      // WHERE IT MEETS THE BANK, at each end of its row: not the bridge's own tiles but the land's.
      for (const e of [0, 1]) {
        const out1 = e ? 1 : -1, ox = ax * out1, oy = ay * out1, F = FACED[K];
        const bx = x + ox, by = y + oy;
        if (!inBounds(g, bx, by) || on(bx, by) || g.deck[idx(g, bx, by)] !== 0) continue;
        // AN ABUTMENT on the bank's face under the deck's end: its head, and the wall on down to the ground. The river is its +x.
        if (g.height[idx(g, bx, by)] > ground + 0.5 && room * HS >= ABUT_HEAD + 0.4) {
          const at = { x: x + ox * 0.5, y: y + oy * 0.5, turn: (turn + (e ? 2 : 0)) % 4, tier: "under" as const, cell: { x, y } };
          for (let top = z - ABUT_HEAD / HS; top > ground; top--) out.push({ id: `abut${F}Shaft`, z: top, ...at });
          out.push({ id: `abut${F}`, z, ...at });
          // A WING WALL along the bank's face each side of it, where the bank runs on there and the ground falls away
          // in front of it: a piece's left is the side its turn names, so the other wing is the same piece turned about.
          for (const t of [at.turn, (at.turn + 2) % 4]) {
            const L = SIDES[t], bi = inBounds(g, bx + L.dx, by + L.dy) ? idx(g, bx + L.dx, by + L.dy) : -1, fi = inBounds(g, x + L.dx, y + L.dy) ? idx(g, x + L.dx, y + L.dy) : -1;
            if (bi < 0 || fi < 0 || g.deck[fi] !== 0 || g.height[bi] < z - 1 || g.height[fi] > z - ABUT_HEAD / HS) continue;
            for (let top = z - ABUT_HEAD / HS; top > g.height[fi]; top--) out.push({ id: `wing${F}Shaft`, z: top, ...at, turn: t });
            out.push({ id: `wing${F}`, z, ...at, turn: t });
          }
        }
        // THE RAIL RUNS ON along the road for a tile onto the land, and stops at a pier — where the road there is level with the deck.
        const bi = idx(g, bx, by);
        if (g.paved[bi] === 0 || g.ramp[bi] !== 0 || g.height[bi] !== z) continue;
        for (const s of SIDES) {
          if ((s.dx !== 0) === B.alongX || road(bx + s.dx, by + s.dy)) continue;
          const tier = s.near ? "front" : "back";
          out.push({ id: LAND_RAIL[K], turn: s.turn, x: bx, y: by, z, tier });
          out.push({ id: `end${F}`, turn: s.turn, x: bx + ox * 0.45, y: by + oy * 0.45, z, tier, cell: { x: bx, y: by } });
        }
      }
    }
  }
  return out;
}

export type BridgeProps = { sync(g: Grid, rev: number, scale: number, depth?: (x: number, y: number) => number, force?: BridgeKind): void; destroy(): void };

/** The bridges' pieces, in the bands. */
export function createBridgeProps(bands: BandLayer): BridgeProps {
  let drawn: Container[] = [], key = "", level = "", tick = 0, made = "";
  const clear = () => { for (const c of drawn) { c.parent?.removeChild(c); c.destroy({ children: true }); } drawn = []; };
  return {
    sync(g, rev, scale, depth, force) {
      const P = bakedProps() ? propsLoaded() : null;
      if (bakedProps() && !P) void propSprites();
      // (To the half step: an arch is not refitted for every ripple.)
      const still = depth ? (x: number, y: number) => Math.round(depth(x, y) * 2) / 2 : undefined;
      // THE RIVER RISES AND FALLS, and what hangs between a bridge's piers is fitted to the room over it: looked at
      // again now and then — how far each bridge's deck is over its water, at the least.
      if (still && tick++ % 45 === 0) {
        let sig = "";
        for (const B of bridgesOf(g)) { let over = Infinity; for (const i of B.cells) { const w = Math.max(g.pool[i], still(i % g.w, (i / g.w) | 0)); if (w > 0) over = Math.min(over, g.deckZ[i] - g.height[i] - w); } sig += `${over},`; }
        level = sig;
      }
      const k = `${rev}|${scale}|${force ?? ""}|${P ? "baked" : ""}|${level}`;
      if (k === key) return;
      key = k;
      // AN EDIT THAT MOVES NO PIECE OF A BRIDGE leaves them standing: every bridge's sprites were thrown away and made
      // again for a tile of road laid across the map, and each band they stand in drawn up again for it.
      const pieces = P ? bridgePiecesOf(g, still, force) : [];
      const sig = P ? `${scale}|${JSON.stringify(pieces)}` : "";
      if (sig === made) return;
      made = sig;
      clear();
      if (!P) return;
      const under = new Map<number, Container>();
      for (const p of pieces) {
        // (A piece between two tiles is the higher one's: drawn with it.)
        const band = p.cell ? bandOf(p.cell.x, p.cell.y) : bandOf(Math.ceil(p.x), Math.ceil(p.y)), sp = propSprite(P, p.id, p.turn, p.x, p.y, p.z, scale);
        if (!sp) continue;
        // SNOW on its copings, beams and tops: baked with it, over it, faded in by the snow lying. @see bake-props
        const snow = P.props.has(`${p.id}~snow`) ? propSprite(P, `${p.id}~snow`, p.turn, 0, 0, 0, scale) : null;
        if (snow) { fadeWithSnow(snow); sp.addChild(snow); }
        if (p.stretch) sp.scale.y = p.stretch;
        if (p.tier === "under") {
          // ON THE BAND'S GROUND, BEFORE ITS WATER AND ITS ROADS: the river is over a pier's foot and the deck over its head, and each is drawn over it.
          let c = under.get(band);
          if (!c) {
            const layer = bands.staticOf[band];
            if (!layer) { sp.destroy({ children: true }); made = ""; continue; }
            c = new Container(); c.eventMode = "none";
            layer.addChild(c);
            under.set(band, c); drawn.push(c);
          }
          c.addChild(sp);
        } else {
          const layer = bands.dynamicOf[band];
          if (!layer) { sp.destroy({ children: true }); made = ""; continue; }
          sp.zIndex = p.tier === "back" ? -0.45 : 0.45;
          layer.addChild(sp);
          drawn.push(sp);
        }
      }
    },
    destroy: clear,
  };
}

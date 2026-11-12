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
 * ONE TECHNIQUE: every solid thing here — tubes, shafts, covers, grates,
 * piers, pump houses, headwalls — is on the lit pipe mesh, under the one
 * light. Only what is laid over them as marks is still drawn as shapes: the
 * chevrons under the ground, and the reach tint. @see pipe-mesh
 *
 * Drawn again only when the sewers, the ground or the scale change; the view
 * only shows or hides the tier. @see world/sewers/solve, plans/underground-sewers.md §6
 */
import { Graphics, type Container, type Geometry, type Mesh, type Shader } from "pixi.js";

import { DIR, NEIGHBOUR } from "../../iso/dir";
import { SEWER_BORE, SEWER_FIT, SEWER_GRATE, idx, structureAt, type Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW, bandOf } from "../iso";
import type { SewerPlan } from "../sewers/lay";
import { sewerReportsFor } from "../sewers/flow";
import { SEWER_KIND, solveSewers, type SewerSolve } from "../sewers/solve";
import { lateralReach } from "../sewers/reach";
import type { BandLayer } from "./bands";
import { destroyPipeDrawable, pipeDrawable, recolour } from "./pipe-gpu";
import { LATERAL_R } from "./mains-layer";
import { portsOf, type PortCell } from "../water/ports";
import { MATERIAL, ZT, box as plainBox, disc, footing, made, pipeCell, pipeMesh, hring, solid, tube as solidTube, type Limb, type PipeMesh } from "./pipe-mesh";

const SIDES = ["N", "E", "S", "W"] as const;
/** The fittings' scale, from a slim tube's radius, tile units; how much fatter a widened bore is. */
const TUBE_R = 0.07, BORE_WIDE = 1.35;
/** A trunk's radius, tiles: a solid tube, lit, as a main above ground once was. @see pipeCell */
const TRUNK_R = (0.18 / Math.SQRT2) * 1.18, TRUNK_SIDES = 10;
/**
 * How much deeper a buried trunk is DRAWN than the solve lays it, height
 * units: a cover's depth is less than the tube is thick, and drawn there it
 * would graze the surface, with no room for a manhole's shaft to show.
 */
const SINK = 2.5;
/** A manhole's shaft, from its cover down onto the trunk: the lateral's own pipe carried on, collared where it meets the trunk. */
const SHAFT_R = LATERAL_R, SHAFT_COLLAR = 1.6, SHAFT_DARK = 0x56402c, SHAFT_WIDE = 1.3;
/**
 * A buried trunk's colour by how deep it lies, height units under the
 * ground: the deepest a sewer goes is a third darker and half way to grey.
 */
export function deepened(colour: number, depth: number): number {
  const k = Math.max(0, Math.min(1, (depth - 1) / 3)), grey = 0x70;
  const ch = (c: number) => Math.round((c + (grey - c) * 0.5 * k) * (1 - 0.33 * k));
  return (ch((colour >> 16) & 255) << 16) | (ch((colour >> 8) & 255) << 8) | ch(colour & 255);
}
/** Its colours: draining, going nowhere; the dark under it and the light along it. */
const UMBER = 0x7a5230, NOWHERE = 0x8b8f96, BACKED = 0x9c3b1e;
/** A sewer being dragged: how see-through, and a tile it can't be laid on. */
const GHOST_ALPHA = 0.6, BAD = 0xd8463a;
/** Where a slop maker in hand could go: the tiles a live manhole reaches, tinted. */
const REACH = 0x3fe0a8, REACH_ALPHA = 0.16;
/** Cast iron, its rim and its pattern; brick, concrete, a pier. */
const IRON = 0x3a3c40, IRON_RIM = 0x6b6e73, IRON_DARK = 0x26272a;
const BRICK = 0x9a4f3a, ROOF = 0x5a5d62;
const CONCRETE = 0xb8b4aa, CONCRETE_DARK = 0x8a867c, PIER = 0x9a958a;
/** The dark down a grate, and inside a pipe's mouth. */
const PIT = 0x0c0e10;
/** What an outfall has poured, dried on the concrete under its mouth. */
const STAIN = 0x5c4630;

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

/**
 * THE SEWERS' SURFACE PIECES, on the lit mesh the tubes are on: one light,
 * one set of tones, whatever it is made of. Each is a few solids in the
 * map's own axes — `u`, `v` in tiles, heights in the mesh's units (`ZT` a
 * height unit) — added nearest last, since a mesh paints in the order it is
 * built. @see pipe-mesh, plans/pipe-network.md §6 "One technique"
 */
/** A hair of height, so one flat thing lies over another without fighting it. */
const SKIN = 0.004;
/** A box, plain; and one of concrete, and of brick: the shader draws the boards and the courses. @see MATERIAL */
const meshBox = plainBox;
type BoxArgs = Parameters<typeof plainBox>;
const concreteBox = (...a: BoxArgs) => made(MATERIAL.concrete, () => plainBox(...a));
const brickBox = (...a: BoxArgs) => made(MATERIAL.brick, () => plainBox(...a));

/**
 * THE SURROUND a cover or a grate is set in: a square of concrete flush with
 * the ground, a darker joint round its edge, so the ironwork sits in
 * something made and not in the grass. `a` is half its width, tiles.
 */
export function surround(m: PipeMesh, s: number, x: number, y: number, z: number, a: number) {
  const h = z * ZT;
  meshBox(m, s, x - a - 0.018, y - a - 0.018, h - SKIN, x + a + 0.018, y + a + 0.018, h + SKIN * 0.25, solid(CONCRETE_DARK));
  meshBox(m, s, x - a, y - a, h - SKIN, x + a, y + a, h + SKIN * 0.5, solid(CONCRETE));
}
/** Half the width of a cover's surround and of a grate's, tiles. */
export const COVER_SURROUND = 0.25, GRATE_SURROUND = 0.32;

/** A MANHOLE COVER, cast iron, set in its surround, flush with the ground at a tile's middle: its rim, its plate, and the pattern cast in it — a ring and a cross. */
export function cover(m: PipeMesh, s: number, x: number, y: number, z: number) {
  surround(m, s, x, y, z, COVER_SURROUND);
  const h = z * ZT + SKIN, r = 0.17;
  hring(m, s, x, y, h, 0, r * 1.14, solid(IRON_RIM), 20);
  hring(m, s, x, y, h + SKIN, 0, r, solid(IRON), 20);
  hring(m, s, x, y, h + SKIN * 2, r * 0.6, r * 0.7, solid(IRON_DARK), 20);
  meshBox(m, s, x - r * 0.6, y - 0.008, h + SKIN, x + r * 0.6, y + 0.008, h + SKIN * 2.5, solid(IRON_DARK));
  meshBox(m, s, x - 0.008, y - r * 0.6, h + SKIN, x + 0.008, y + r * 0.6, h + SKIN * 2.5, solid(IRON_DARK));
}

/** A STORM DRAIN'S GRATE, flush with the ground: a square iron frame, dark under it, bars across. @see SEWER_GRATE */
export function grate(m: PipeMesh, s: number, x: number, y: number, z: number) {
  surround(m, s, x, y, z, GRATE_SURROUND);
  const h = z * ZT + SKIN, k = 0.24, bar = 0.014;
  meshBox(m, s, x - k * 1.14, y - k * 1.14, h - SKIN, x + k * 1.14, y + k * 1.14, h + SKIN, solid(IRON_RIM));
  meshBox(m, s, x - k, y - k, h, x + k, y + k, h + SKIN * 1.5, solid(PIT));
  // Its bars, far to near, and one across them.
  for (let b = -3; b <= 3; b++) {
    const v = y + (b / 3.5) * k;
    meshBox(m, s, x - k, v - bar, h + SKIN, x + k, v + bar, h + SKIN * 4, solid(IRON));
  }
  meshBox(m, s, x - bar, y - k, h + SKIN, x + bar, y + k, h + SKIN * 4.5, solid(IRON));
}

/** A SPAN'S PIER, concrete, from its footing on the ground up to under the tube: a shaft, and a cap the tube sits on. Before its tube, which lies over it. */
export function pier(m: PipeMesh, s: number, x: number, y: number, ground: number, under: number) {
  const h0 = ground * ZT, cap = 0.03;
  if (under - cap <= h0) return;
  const top = footing(m, s, x - 0.05, y - 0.05, x + 0.05, y + 0.05, h0);
  concreteBox(m, s, x - 0.05, y - 0.05, top, x + 0.05, y + 0.05, under - cap, solid(PIER));
  meshBox(m, s, x - 0.1, y - 0.1, under - cap, x + 0.1, y + 0.1, under, solid(CONCRETE_DARK));
}

/**
 * A PORTAL, where a span meets the bank: a concrete collar on the bank's
 * face that the tube comes out of, in place of a tube cut off against the
 * earth. At (u, v, h) on the tube's line, the tube running along (dx, dy)
 * out of the bank; `r` its radius. Before its tube, which comes out of it.
 */
export function portal(m: PipeMesh, s: number, u: number, v: number, h: number, dx: number, dy: number, r: number) {
  const across = r + 0.07, deep = 0.045, lip = 0.02;
  // Along the tube it is thin; across it, wider than the tube; a coping over it.
  const [au, av] = dx !== 0 ? [deep, across] : [across, deep];
  concreteBox(m, s, u - au, v - av, h - r - 0.07, u + au, v + av, h + r + 0.07, solid(CONCRETE));
  meshBox(m, s, u - au - lip, v - av - lip, h + r + 0.07, u + au + lip, v + av + lip, h + r + 0.1, solid(CONCRETE_DARK));
  // The dark it comes out of, on the face toward the span.
  disc(m, s, u + dx * (deep + 0.002), v + dy * (deep + 0.002), h, dx, dy, 0, r * 1.12, solid(PIT), 12);
}

/**
 * A LIFT STATION: a brick pump house on a concrete footing, a slab roof
 * overhanging, and a steel door on the face toward the
 * camera's left.
 */
function liftStation(m: PipeMesh, s: number, x: number, y: number, ground: number) {
  const a = 0.26, h0 = ground * ZT, foot = h0 + 0.2 * ZT, top = h0 + 2.2 * ZT;
  meshBox(m, s, x - a - 0.02, y - a - 0.02, h0, x + a + 0.02, y + a + 0.02, foot, solid(CONCRETE));
  // BRICK: its courses and its mortar are the shader's.
  brickBox(m, s, x - a, y - a, foot, x + a, y + a, top, solid(BRICK));
  // The door, and its lintel.
  meshBox(m, s, x - 0.08, y + a, foot, x + 0.08, y + a + 0.006, foot + 1.3 * ZT, solid(IRON));
  meshBox(m, s, x - 0.1, y + a, foot + 1.3 * ZT, x + 0.1, y + a + 0.008, foot + 1.42 * ZT, solid(CONCRETE));
  // The roof: a slab, overhanging, its edge lighter than its deck.
  meshBox(m, s, x - a - 0.04, y - a - 0.04, top, x + a + 0.04, y + a + 0.04, top + 0.14 * ZT, solid(ROOF));
}

/**
 * A HEADWALL, concrete, where a sewer pours out: a block on the bank with a
 * coping on it, the pipe out of its face toward (dx, dy), dark inside; an
 * APRON under the pipe out to the bank's edge; and a STAIN down the wall and
 * along the apron under the mouth, in the colour of what it pours. Toward
 * the camera's far sides the wall hides the pipe, so that goes in first.
 */
export function headwall(m: PipeMesh, s: number, x: number, y: number, ground: number, dx: number, dy: number, r: number) {
  const a = 0.26, g0 = ground * ZT, h0 = (ground - 0.4) * ZT, top = (ground + 0.7) * ZT, z = (ground + MOUTH) * ZT + r;
  const behind = dx < 0 || dy < 0;
  // Out from the wall's face to the tile's edge: a rectangle `w` either side of the pipe's line.
  const out = (from: number, to: number, w: number): [number, number, number, number] => {
    const [u0, u1] = dx !== 0 ? [x + dx * from, x + dx * to] : [x - w, x + w];
    const [v0, v1] = dy !== 0 ? [y + dy * from, y + dy * to] : [y - w, y + w];
    return [Math.min(u0, u1), Math.min(v0, v1), Math.max(u0, u1), Math.max(v0, v1)];
  };
  const apron = () => {
    const [u0, v0, u1, v1] = out(a, 0.5, 0.2);
    concreteBox(m, s, u0, v0, g0 - 0.03, u1, v1, g0 + 0.012, solid(CONCRETE));
    // What it pours has run along it.
    const [su0, sv0, su1, sv1] = out(a, 0.5, r * 0.7);
    meshBox(m, s, su0, sv0, g0 + 0.012, su1, sv1, g0 + 0.0135, solid(STAIN));
  };
  const pipe = () => {
    solidTube(m, s, x, y, z, x + dx * 0.58, y + dy * 0.58, z, r, solid(CONCRETE_DARK), 12);
    hoopEnd(m, s, x + dx * 0.58, y + dy * 0.58, z, dx, dy, r);
  };
  if (behind) { apron(); pipe(); }
  concreteBox(m, s, x - a, y - a, h0, x + a, y + a, top, solid(CONCRETE));
  meshBox(m, s, x - a - 0.025, y - a - 0.025, top, x + a + 0.025, y + a + 0.025, top + 0.1 * ZT, solid(CONCRETE_DARK));
  if (!behind) {
    // And down the wall under the mouth, where the wall's face is one the camera sees.
    const [u0, v0, u1, v1] = out(a, a + 0.003, r * 0.7);
    meshBox(m, s, u0, v0, g0, u1, v1, z - r * 0.6, solid(STAIN));
    apron();
    pipe();
  }
}
/** The open end of a headwall's pipe: its lip, and the dark of its bore. Seen only where it faces the camera. */
function hoopEnd(m: PipeMesh, s: number, u: number, v: number, h: number, dx: number, dy: number, r: number) {
  disc(m, s, u, v, h, dx, dy, r * 0.78, r, solid(CONCRETE), 12);
  disc(m, s, u + dx * 0.002, v + dy * 0.002, h, dx, dy, 0, r * 0.78, solid(PIT), 12);
}

type Drawn = Graphics | Mesh<Geometry, Shader>;

/** Where a headwall's pipe comes out, height units over the ground. */
const MOUTH = 0.15;
/**
 * The level a trunk tile is drawn at, height units: sunk if buried, as laid
 * on a span — and at an outfall, up at its headwall's mouth. At a
 * processor's inlet it stays buried: a riser comes up to it. @see SINK, riserPort
 */
const drawnAt = (g: Grid, s: SewerSolve, i: number) =>
  g.sewerFit[i] === SEWER_FIT.outfall || (g.sewerFit[i] === SEWER_FIT.inlet && !riserPort(g, i % g.w, (i / g.w) | 0)) ? g.height[i] + MOUTH
    : s.level[i] - (s.kind[i] === SEWER_KIND.span ? 0 : SINK);

/** The processor's slop inlet a sewer's inlet tile rises into, or null. */
export function riserPort(g: Grid, x: number, y: number): PortCell | null {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const id = structureAt(g, x + dx, y + dy);
    const st = id >= 0 ? g.structures.get(id) : undefined;
    if (!st) continue;
    const p = portsOf(g, st).find((q) => q.x === x && q.y === y && q.port.fluid === "slop" && q.port.dir === "in");
    if (p) return p;
  }
  return null;
}

export function createSewerLayer(bands: BandLayer): SewerLayer {
  /** What each band has drawn in it, by tier, so it can be cleared. */
  const drawn: Drawn[] = [], ghosts: Drawn[] = [], rings: Drawn[] = [];
  let ringed: { rev: number; scale: number } | null = null;

  /** The tiles within a lateral's reach of a live manhole, tinted, each in its band's paved tier. */
  function drawReach(g: Grid, scale: number) {
    clear(rings);
    // BY ROUTE, not by distance: a tile is lit only if a connection could be laid from it to a live manhole. @see lateralReach
    const reach = lateralReach(g), make = gfxIn(rings, 1), by = new Map<number, Graphics>();
    for (let i = 0; i < reach.length; i++) {
      if (reach[i] < 0) continue;
      const x = i % g.w, y = (i / g.w) | 0;
      const b = bandOf(x, y);
      let gfx = by.get(b);
      if (!gfx) { gfx = make(bands.pavedOf, b); by.set(b, gfx); }
      const z = g.height[i];
      gfx.poly([...at(x, y, z, scale, -0.5, -0.5), ...at(x, y, z, scale, 0.5, -0.5), ...at(x, y, z, scale, 0.5, 0.5), ...at(x, y, z, scale, -0.5, 0.5)])
        .fill({ color: REACH, alpha: REACH_ALPHA });
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
  const gfxIn = (into: Drawn[], alpha: number) => (tier: Container[], b: number) => {
    const g = new Graphics();
    g.eventMode = "none";
    g.alpha = alpha;
    tier[b]?.addChild(g);
    into.push(g);
    return g;
  };
  const clear = (list: Drawn[] = drawn) => {
    for (const g of list) {
      if (g.destroyed) continue;
      if (g instanceof Graphics) { g.parent?.removeChild(g); g.destroy(); } else destroyPipeDrawable(g);
    }
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

  /** The map's own trunks, by network: which vertices of which mesh, and their colour clear and backed up. */
  let owned: { mesh: Mesh<Geometry, Shader>; net: number; from: number; to: number; clear: number; backed: number }[] = [];
  /** The networks drawn backed up now. */
  let painted = new Set<number>();
  function repaint() {
    for (const k of owned) {
      const is = trouble.has(k.net), was = painted.has(k.net);
      if (is === was || k.mesh.destroyed) continue;
      recolour(k.mesh, k.from, k.to, is ? k.clear : k.backed, is ? k.backed : k.clear);
    }
    painted = new Set(trouble.keys());
  }

  function draw(g: Grid, s: SewerSolve, scale: number, o: { into?: Drawn[]; only?: Set<number>; alpha?: number; bad?: number } = {}) {
    const into = o.into ?? drawn;
    clear(into);
    // THE TUBES FIRST, solid, a mesh a band — under the ground, or on its piers
    // with the town — so what is drawn on them after (chevrons, drops) shows.
    const tubes = new Map<number, PipeMesh>(), spans = new Map<number, PipeMesh>();
    // WHICH VERTICES ARE WHOSE, of the map's own sewers: so a network's colour can be changed in place. @see recolour
    const mine: { mesh: PipeMesh; net: number; from: number; to: number; clear: number; backed: number }[] = [];
    const meshOf = (m: Map<number, PipeMesh>, b: number) => {
      let mesh = m.get(b);
      if (!mesh) m.set(b, (mesh = pipeMesh()));
      return mesh;
    };
    for (const net of s.nets) {
      for (const i of net.cells) {
        if (o.only && !o.only.has(i)) continue;
        const x = i % g.w, y = (i / g.w) | 0, b = bandOf(x, y), lvl = drawnAt(g, s, i);
        // DEEPER DOWN, darker and a little greyer: depth read without counting. @see deepened
        const depth = s.kind[i] === SEWER_KIND.buried ? g.height[i] - s.level[i] : 0;
        const clearOf = deepened(s.drains[i] ? UMBER : NOWHERE, depth), backedOf = deepened(BACKED, depth);
        const colour = i === o.bad ? BAD : !o.only && trouble.has(net.id) ? backedOf : clearOf;
        // Out to each face it joins, level there with the neighbour's halfway.
        const limbs: Limb[] = [];
        for (const side of SIDES) {
          if (!(g.sewer[i] & DIR[side])) continue;
          const [dx, dy] = NEIGHBOUR[side];
          const j = idx(g, x + dx, y + dy);
          if (!(g.sewer[j] & DIR[({ N: "S", S: "N", E: "W", W: "E" } as const)[side]])) continue;
          limbs.push({ dx, dy, zf: (lvl + drawnAt(g, s, j)) / 2 });
        }
        const r = TRUNK_R * (g.sewer[i] & SEWER_BORE ? BORE_WIDE : 1);
        // A SPAN'S PIER first: its tube lies over it. And its PORTAL, where it comes out of a bank
        // the camera sees the face of: the bank on its far side.
        if (s.kind[i] === SEWER_KIND.span) {
          pier(meshOf(spans, b), scale, x, y, g.height[i], lvl * ZT - r);
          for (const l of limbs) {
            const j = idx(g, x + l.dx, y + l.dy);
            if (s.kind[j] === SEWER_KIND.span || l.dx + l.dy > 0) continue;
            portal(meshOf(spans, b), scale, x + l.dx * 0.47, y + l.dy * 0.47, l.zf * ZT, -l.dx, -l.dy, r);
          }
        }
        // THE WAY IT FALLS is drawn along it by the shader: chevrons on, or back, as its run is counted. @see MATERIAL
        const d = s.down[i], falls = d >= 0 && s.kind[i] !== SEWER_KIND.span;
        const material = !falls ? MATERIAL.iron : (d % g.w) - x + (((d / g.w) | 0) - y) > 0 ? MATERIAL.trunkOn : MATERIAL.trunkBack;
        const tubeMesh = meshOf(s.kind[i] === SEWER_KIND.span ? spans : tubes, b), first = tubeMesh.nv;
        pipeCell(tubeMesh, scale, x, y, lvl, limbs, {
          r, colour, sides: TRUNK_SIDES, flanges: (x + y) % 2 === 0, bolts: false, end: null, material,
        });
        if (!o.only && i !== o.bad) mine.push({ mesh: tubeMesh, net: net.id, from: first, to: tubeMesh.nv, clear: solid(clearOf), backed: solid(backedOf) });
        // A MANHOLE'S SHAFT, after the trunk: down from its cover onto the trunk's
        // top, a collar where it meets it — its far half first, behind the shaft.
        // And at a processor's inlet, where its riser goes down: the same shaft, under the riser's collar.
        const fit = g.sewerFit[i];
        if ((fit === SEWER_FIT.node || fit === SEWER_FIT.inlet) && s.kind[i] !== SEWER_KIND.span) {
          const m = meshOf(tubes, b), dark = solid(SHAFT_DARK);
          const foot = lvl * ZT + r * 0.8, R = SHAFT_R * SHAFT_COLLAR, band = SHAFT_R * 0.9;
          hring(m, scale, x, y, foot + band, SHAFT_R, R, dark, TRUNK_SIDES);
          // THE SHAFT, a ring of brick from the cover down to the trunk.
          made(MATERIAL.brick, () => solidTube(m, scale, x, y, g.height[i] * ZT, x, y, foot + band, SHAFT_R * SHAFT_WIDE, solid(BRICK), TRUNK_SIDES));
          solidTube(m, scale, x, y, foot + band, x, y, foot, R, dark, TRUNK_SIDES);
        }
        // Its RISER, up out of the ground into the processor's inlet, is the
        // mains layer's: drawn in the same mesh as the inlet's outlet, in order. @see mains-layer
      }
    }
    const placed = new Map<PipeMesh, Mesh<Geometry, Shader>>();
    const place = (m: PipeMesh, tier: Container | undefined, live = false) => {
      if (!m.ni || !tier) return;
      const mesh = pipeDrawable(m, live);
      mesh.alpha = o.alpha ?? 1;
      tier.addChild(mesh);
      into.push(mesh);
      placed.set(m, mesh);
    };
    for (const [b, m] of tubes) place(m, bands.sewerOf[b], into === drawn);
    for (const [b, m] of spans) place(m, bands.structureOf[b], into === drawn);
    if (into === drawn) {
      owned = mine.flatMap((k) => { const mesh = placed.get(k.mesh); return mesh ? [{ ...k, mesh }] : []; });
      painted = new Set(trouble.keys());
    }
    // And the surface pieces' meshes: covers and grates flush with the ground, pump houses and headwalls with the town.
    const covers = new Map<number, PipeMesh>(), ups = new Map<number, PipeMesh>();
    for (const net of s.nets) {
      for (const i of net.cells) {
        if (o.only && !o.only.has(i)) continue;
        const x = i % g.w, y = (i / g.w) | 0, b = bandOf(x, y), ground = g.height[i];
        const kind = s.kind[i];
        // A LIFT STATION: a brick pump house over where it lifts.
        if (kind === SEWER_KIND.lift) liftStation(meshOf(ups, b), scale, x, y, ground);
        const fit = g.sewerFit[i];
        // A HEADWALL where it pours out — or feeds a processor with no inlet to rise into. @see riserPort
        if (fit === SEWER_FIT.outfall || (fit === SEWER_FIT.inlet && !riserPort(g, x, y))) {
          // Its mouth on the side toward the water, or else the side it isn't joined on.
          const open = (s: (typeof SIDES)[number]) => {
            const [dx, dy] = NEIGHBOUR[s];
            const j = x + dx >= 0 && y + dy >= 0 && x + dx < g.w && y + dy < g.h ? idx(g, x + dx, y + dy) : -1;
            return { s, wet: j >= 0 && (g.pool[j] > 0 || g.fluid[j] > 0), joined: (g.sewer[i] & DIR[s]) !== 0 };
          };
          const sides = SIDES.map(open);
          const side = (sides.find((o) => o.wet && !o.joined) ?? sides.find((o) => !o.joined) ?? sides[0]).s;
          const [dx, dy] = NEIGHBOUR[side];
          headwall(meshOf(ups, b), scale, x, y, ground, dx, dy, TUBE_R * 1.25 * (g.sewer[i] & SEWER_BORE ? BORE_WIDE : 1));
        }
        // A NODE: its cover at the surface; its shaft is with the tubes.
        if (fit === SEWER_FIT.node) ((g.sewer[i] & SEWER_GRATE) !== 0 ? grate : cover)(meshOf(covers, b), scale, x, y, ground);
      }
    }
    // Over the ground and the roads; and with the town, after the spans they stand beside.
    for (const [b, m] of covers) place(m, bands.pavedOf[b]);
    for (const [b, m] of ups) place(m, bands.structureOf[b]);
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
      // A NETWORK'S COLOUR, CHANGED IN PLACE: its own vertices written again, nothing made or taken away. @see recolour
      if (key !== troubled) { troubled = key; repaint(); }
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

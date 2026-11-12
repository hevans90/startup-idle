/**
 * World v2 — THE WATER MAINS, DRAWN: a built thing, not a line. Each cell is
 * a lit steel tube, out to the middle of each face it is joined on, flanged at
 * its joins, on saddles or a frame; and at its ends a fitting: an intake in
 * the water, a pump house, an outlet's valve at the building, a cap. And each
 * building's PORTS, nozzles out of its walls where a main may join it. One
 * mesh a band, in its paved tier, so it sorts with the town; built again only
 * when the mains, the scale or the zoom's tier of detail change. @see pipe-mesh
 *
 * And THE WATER IN THEM, every frame: seen through the glass sections, dashes
 * running from the intake to the building, as fast as the main carries —
 * drawn in each band over its tubes, so a building in front hides them as it
 * hides the tube; nothing in a dry main; and, over everything, an amber
 * warning at the intake of one that cannot reach its building.
 *
 * A main lies just off the ground, but RIDES ON STILTS over a road, and over
 * a dip it spans level with the banks either side. A widened bore is a fatter
 * tube; the AI's mains are banded in its violet.
 *
 * THE WATER OVERLAY, with the Pipe tool in hand or turned on: the town dimmed,
 * every main coloured by what it is doing, each building that drinks with its
 * tank as a ring and a mark at each free inlet, and the numbers — the
 * water's depth at each intake, each main's head. @see world/water/mains, plans/pipes-overhaul.md §3
 */
import { Container, Graphics, Matrix, Text, type Geometry, type Mesh, type Shader } from "pixi.js";

import { NEIGHBOUR } from "../../iso/dir";
import { MAIN_AI, MAIN_BORE, MAIN_END, MAIN_SEWER, SEWER_FIT, idx, inBounds, rampDir, rampRise, structureAt, type Grid } from "../grid";
import { allTanks } from "../projects/cooling";
import { HEIGHT_UNIT, HH, HW, surfaceHeight } from "../iso";
import { findMains, joined, mainLiveAt, mainReportAt, mainReportsFor, type MainState } from "../water/mains";
import { portsOf, type PortCell } from "../water/ports";
import { sayOf, type Say } from "../water/main-says";
import { pointerRead } from "../debug/pointer-at";
import type { BandLayer } from "./bands";
import { lookOf } from "../structures/projects/looks";
import { portSetback } from "../structures/projects/entries";
import { destroyPipeDrawable, pipeDrawable } from "./pipe-gpu";
import { glassDrawable, glassMesh, glassPane, type GlassState } from "./pipe-glass";
import { glassOverride } from "./glass-state";
import {
  MATERIAL,
  K, cellPaths, hoop, outlet, pipeCell, pipeMesh, solid, valve, ZT,
  type Fitting, type Limb, type PipeMesh, type Support,
} from "./pipe-mesh";

const SIDES = ["N", "E", "S", "W"] as const;
/**
 * The overlay's line, wider than the tube so a main reads at any zoom, tile
 * units; how high a tube's middle lies off the ground, in half steps.
 */
const OVERLAY_WIDE = 0.16;
const LIFT = 1.1;
/**
 * THE SOLID TUBE: its radius, tiles — 0.18 of a tile's width across, where
 * the strokes were 0.11; its faces round, and its colour for
 * each kind of main — the steel a warm grey, which the night's blue grade
 * turns to grey rather than to violet. @see pipe-mesh, plans/pipe-rendering.md
 */
const TUBE_R = 0.09 / Math.SQRT2;
/** Steel a shade darker than the concrete it stands on, so a main holds against grass; how much thicker a tube is drawn far off. */
const STEEL = 0xa6a9aa, IRON = 0x7d5c40;
export const FAR_THICK = 1.2;
/** A lateral's tube, its radius and its cast iron: what a manhole's shaft carries on down underground. @see sewer-layer */
export const LATERAL_IRON = IRON;
/**
 * HOW MUCH DETAIL, by how wide a tile is on the screen, px: far off, a
 * six-sided tube with no flanges and a saddle every other tile; nearer, ten
 * sides and flanges; near, fourteen sides, bolts, valve wheels and the
 * frames round the glass. A tier's own edges stretch a tenth past the
 * thresholds, so a zoom resting on one does not flip between the two.
 */
export type Detail = "far" | "mid" | "near";
const DETAIL_PX = { mid: 40, near: 100 } as const;
const DETAIL_SIDES: Record<Detail, number> = { far: 6, mid: 10, near: 14 };
export function detailFor(tilePx: number, was: Detail | null = null): Detail {
  const at = (edge: number, above: boolean) => edge * (was === null ? 1 : above ? 0.9 : 1.1);
  // Each threshold eased toward the tier it was in: above it, harder to drop below.
  const near = at(DETAIL_PX.near, was === "near"), mid = at(DETAIL_PX.mid, was === "near" || was === "mid");
  return tilePx >= near ? "near" : tilePx >= mid ? "mid" : "far";
}
/** Each `MAIN_END` as the fitting the solid tubes draw. */
const FITTINGS: Record<number, Fitting> = {
  [MAIN_END.cap]: "cap", [MAIN_END.intake]: "intake", [MAIN_END.pump]: "pump",
  [MAIN_END.outlet]: "outlet", [MAIN_END.drain]: "drain", [MAIN_END.outfall]: "outfall", [MAIN_END.drop]: "drop",
};
/** How high a main rides over a road, half steps; how much fatter a widened bore is. */
const ROAD_LIFT = 2.4;
const BORE_WIDE = 1.4;
/** A SEWER: a little wider, banded brown. The AI's mains: banded violet. */
const SEWER_BAND = 0x9a6a3a, SEWER_WIDE = 1.18;
export const LATERAL_R = TUBE_R * SEWER_WIDE;
const AI_BAND = 0xb44aff;
/** A port's nozzle: blue for water, brown for slop. */
const PORT_COLOUR = { water: 0x3f86c6, slop: 0x7a5230 } as const;
/** The water in a main, for the overlay's marks, and the warning at one that cannot deliver. */
const WATER = 0x5fb7ff, WARN = 0xf2a33a;
const INK = 0x16181c;
/** A sign opened out: its card's width and padding, screen pixels. */
const TIP_W = 230, TIP_PAD = 8;

/**
 * A WARNING SIGN over a main that cannot deliver: a rounded triangle `r`
 * across at `(x, y)`, outlined in ink with an ink "!", on a pin down to
 * `foot`, and a ring going out from it every second and a half — the sign
 * itself steady, so it reads at a glance.
 */
function warnSign(g: Graphics, x: number, y: number, r: number, foot: number, colour: number, t: number, open = false) {
  if (open) r *= 1.15;
  const line = Math.max(1, r * 0.11);
  // The pin, down to the fitting.
  g.moveTo(x, y + r * 0.62).lineTo(x, foot);
  g.stroke({ color: INK, width: line * 1.6, alpha: 0.55, cap: "round" });
  g.circle(x, foot, line * 1.4);
  g.fill({ color: INK, alpha: 0.55 });
  // The ring, going out and fading.
  if (!open) {
    const k = (t / 1.5) % 1;
    g.circle(x, y, r * (1 + 0.9 * k));
    g.stroke({ color: colour, width: line * 1.2, alpha: 0.6 * (1 - k) });
  }
  // The sign: a triangle, corners rounded by round-joined strokes — ink outside, its own colour in.
  const h = r * 0.95, tri = [x, y - h, x + h * 1.08, y + h * 0.62, x - h * 1.08, y + h * 0.62];
  g.poly(tri).stroke({ color: INK, width: line * 4.2, join: "round", alpha: 0.85 });
  g.poly(tri).fill({ color: colour }).stroke({ color: colour, width: line * 2.2, join: "round" });
  // The "!".
  g.roundRect(x - line * 0.75, y - h * 0.48, line * 1.5, h * 0.62, line * 0.75).fill({ color: INK });
  g.circle(x, y + h * 0.33, line * 0.85).fill({ color: INK });
}
/** Where an outlet's valve stands on a bend, tiles from the middle toward the wall: on the straight past the elbow. */
const VALVE_OUT = 0.37;
/** A glass section: how long, tiles — a whole tile and a quarter of the one either side. Its collars' steel. */
export const GLASS_LONG = 1.5;
const COLLAR = 0x4f565e;
/** A straight run this long has a window in its middle; a longer one, another every so many tiles. */
export const GLASS_RUN = 4, GLASS_EVERY = 8;

/** A piece of a glass section on one tile: the way the run goes, from where to where along it (tiles from the tile's middle), and where the whole section begins and ends on the map along that way. */
export type GlassSpan = { ax: number; ay: number; from: number; to: number; lo: number; hi: number };

/**
 * WHERE THE GLASS GOES: fewer and longer. One window a tile and a half long
 * in the middle of each straight run of four tiles or more, and one more
 * every eight tiles on a long run — so the flow has room to read and the
 * flanges carry the rhythm along the rest. A run is tiles in a line, joined
 * end to end and nowhere else, with no fitting on them, of one kind, and
 * straight in their climb too: glass is a straight length. By tile.
 */
export function glassSpans(g: Grid): Map<number, GlassSpan> {
  const out = new Map<number, GlassSpan>();
  for (const [ax, ay] of [[1, 0], [0, 1]] as const) {
    // Which sides are along this way is the map's to say: found from a step, not assumed.
    const along = SIDES.filter((sd) => Math.abs(NEIGHBOUR[sd][0]) === ax && Math.abs(NEIGHBOUR[sd][1]) === ay);
    const across = SIDES.filter((sd) => !along.includes(sd));
    const straight = (x: number, y: number) => {
      if (!inBounds(g, x, y) || !inBounds(g, x - ax, y - ay) || !inBounds(g, x + ax, y + ay)) return false;
      const i = idx(g, x, y);
      if (!g.main[i] || g.mainEnd[i]) return false;
      if (!along.every((sd) => joined(g, x, y, sd)) || across.some((sd) => joined(g, x, y, sd))) return false;
      return levelAt(g, x - ax, y - ay) + levelAt(g, x + ax, y + ay) === 2 * levelAt(g, x, y);
    };
    const kind = (x: number, y: number) => g.main[idx(g, x, y)] & MAIN_SEWER;
    const lines = ax ? g.h : g.w, long = ax ? g.w : g.h;
    for (let line = 0; line < lines; line++) {
      const at = (k: number): [number, number] => (ax ? [k, line] : [line, k]);
      for (let k = 0; k < long; k++) {
        if (!straight(...at(k))) continue;
        let n = 1;
        while (k + n < long && straight(...at(k + n)) && kind(...at(k + n)) === kind(...at(k))) n++;
        if (n >= GLASS_RUN) {
          const mid = (n - 1) >> 1;
          for (let c = mid % GLASS_EVERY; c < n; c += GLASS_EVERY) {
            if (c < 1 || c > n - 2 || Math.abs(c - mid) % GLASS_EVERY) continue;
            const centre = k + c, lo = centre - GLASS_LONG / 2, hi = centre + GLASS_LONG / 2, q = (GLASS_LONG - 1) / 2;
            for (const [d, from, to] of [[-1, 0.5 - q, 0.5], [0, -0.5, 0.5], [1, -0.5, -0.5 + q]] as const) {
              const [x, y] = at(centre + d);
              out.set(idx(g, x, y), { ax, ay, from, to, lo, hi });
            }
          }
        }
        k += n - 1;
      }
    }
  }
  return out;
}
/**
 * WHERE THE MAINS GO in a band's movers' tier: over the movers, whose depth
 * is their place in the band, −½ to ½ — under a building site's pieces, the
 * juice and the cursor. @see BandLayer.dynamicOf
 */
const PIPE_Z = 0.75;
/** The Water overlay: the dimming, and each state's colour. */
const DIM = 0x05080d;
const STATE_COLOUR: Record<MainState, number> = {
  flowing: 0x3fe08a, full: 0x5fb7ff, "no-head": WARN, unpaid: WARN, dry: 0xe5484d, "no-source": 0xe5484d, "no-outlet": 0xe5484d, burst: 0xe5484d, "backed-up": 0xe5484d,
};

export type MainsLayer = {
  /** Rebuild the tubes when the mains, the scale or the tier of detail for `zoom`, the viewport's, change. */
  sync: (g: Grid, scale: number, zoom?: number) => void;
  /** The water moving in them, this frame; and the main being dragged out, a ghost of itself. */
  tick: (g: Grid, scale: number, now: number, preview?: readonly { x: number; y: number }[] | null, ok?: boolean, water?: boolean, hover?: { x: number; y: number } | null, pumpAt?: { x: number; y: number } | null) => void;
  destroy: () => void;
};

/** The point of a cell's tube paths nearest its middle, `[u, v, h]`, or null with none. */
function nearestOn(paths: readonly (readonly (readonly number[])[])[], x: number, y: number): readonly number[] | null {
  let best: readonly number[] | null = null, d = Infinity;
  for (const path of paths) for (const p of path) {
    const e = Math.abs(p[0] - x) + Math.abs(p[1] - y);
    if (e < d) { d = e; best = p; }
  }
  return best;
}

/**
 * WHERE A CELL'S ARROW GOES on the length that leaves it at face (fu, fv): a
 * point on it a little past the middle — of a run or a bend; halfway out
 * along a stub or a loose end — and the way the tube runs there, level part a unit.
 */
export function chevronAt(paths: readonly (readonly (readonly number[])[])[], fu: number, fv: number): [number[], number[]] | null {
  const at = (p: readonly number[]) => Math.abs(p[0] - fu) < 1e-6 && Math.abs(p[1] - fv) < 1e-6;
  for (const raw of paths) {
    if (raw.length < 2) continue;
    const path = at(raw[raw.length - 1]) ? raw : at(raw[0]) ? [...raw].reverse() : null;
    if (!path) continue;
    // A run or a bend passes through the middle: past it. A length out to the face alone: halfway.
    const f = Math.abs(path[0][0] - fu) + Math.abs(path[0][1] - fv) > 0.75 ? 0.64 : 0.5;
    const along = [0];
    for (let k = 1; k < path.length; k++) along.push(along[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]));
    const want = along[along.length - 1] * f;
    let k = 1;
    while (k < path.length - 1 && along[k] < want) k++;
    const a = path[k - 1], b = path[k], seg = along[k] - along[k - 1] || 1, t = (want - along[k - 1]) / seg;
    const du = b[0] - a[0], dv = b[1] - a[1], dh = b[2] - a[2], l = Math.hypot(du, dv) || 1;
    return [[a[0] + du * t, a[1] + dv * t, a[2] + dh * t], [du / l, dv / l, dh / l]];
  }
  return null;
}

/** The point in screen space of map coordinates (cell centres on the integers) at `z` half steps. */
const P = (s: number, u: number, v: number, z: number): [number, number] => [(u - v) * HW * s, (u + v) * HH * s - z * HEIGHT_UNIT * s];


/**
 * THE GROUND under a point of a cell, half steps: (fu, fv) from its middle, a
 * half tile to each face — up its slope, on a ramp. @see surfaceHeight
 */
const groundAt = (g: Grid, x: number, y: number, fu = 0, fv = 0) => {
  if (!inBounds(g, x, y)) return 0;
  const i = idx(g, x, y), packed = g.ramp[i];
  return surfaceHeight({ height: g.height[i], ramp: rampDir(packed), rise: rampRise(packed) }, 0.5 + fu, 0.5 + fv);
};
/** The ground in a cell's middle. */
const ground = (g: Grid, x: number, y: number) => groundAt(g, x, y);

/**
 * How far above the ground a tube's middle line keeps where two cells meet,
 * half steps: its radius, and a little air. Without it a run over a step or up
 * a ramp met its neighbour at the mean of their levels, below the higher
 * ground there, and the tube went into the hill — showing where the terrain
 * nearer the camera did not hide it.
 */
const faceClear = (r: number) => r / ZT + 0.2;

/**
 * The level a main lies at on a cell: just off its ground — but on stilts
 * over a road, and over a dip (both cells it joins higher) level with the
 * lower of them.
 */
export function levelAt(g: Grid, x: number, y: number): number {
  if (!inBounds(g, x, y)) return LIFT;
  let z = ground(g, x, y), banks = 0, low = Infinity;
  for (const side of SIDES) {
    if (!joined(g, x, y, side)) continue;
    const [dx, dy] = NEIGHBOUR[side];
    const h = ground(g, x + dx, y + dy);
    if (h > z) { banks++; low = Math.min(low, h); }
  }
  if (banks >= 2) z = low;
  return z + (g.paved[idx(g, x, y)] ? ROAD_LIFT : LIFT);
}

/**
 * WHICH WAY A ROAD RUNS on a paved cell, for a main's frame over it to stand
 * clear of the traffic: along u, along v — or null at a junction or a lone
 * paving, where there is no edge the traffic keeps off.
 */
export function roadAxis(g: Grid, x: number, y: number): "u" | "v" | null {
  if (!inBounds(g, x, y) || !g.paved[idx(g, x, y)]) return null;
  const paved = (dx: number, dy: number) => inBounds(g, x + dx, y + dy) && g.paved[idx(g, x + dx, y + dy)] !== 0;
  const u = paved(1, 0) || paved(-1, 0), v = paved(0, 1) || paved(0, -1);
  return u === v ? null : u ? "u" : "v";
}

/** One of the Water overlay's numbers: what it says, where, and how much it matters (a warning most). */
export type Word = { text: string; colour: number; at: [number, number]; rank: number };

/** Roughly a number's size on the screen, px: 11 px type with its outline, anchored at its bottom middle. */
const wordSize = (text: string) => ({ w: text.length * 6.6 + 6, h: 15 });

/**
 * WHERE THE NUMBERS GO: what matters most first, each where it stands unless it
 * would land on one already placed — then it is left out, its building's own
 * label still a hover away. `px` is a screen pixel in the words' units.
 */
export function spaceWords(words: readonly Word[], px: number): Word[] {
  const placed: Word[] = [];
  for (const it of [...words].sort((a, b) => b.rank - a.rank)) {
    const s = wordSize(it.text);
    const hit = placed.some((p) => {
      const t = wordSize(p.text);
      return Math.abs(p.at[0] - it.at[0]) * 2 < (s.w + t.w) * px && Math.abs(p.at[1] - it.at[1]) < ((s.h + t.h) / 2) * px;
    });
    if (!hit) placed.push(it);
  }
  return placed;
}

export function createMainsLayer(bands: BandLayer, overlay: Container): MainsLayer {
  /** The tubes, a mesh a band — and a band's far legs over a road, and the lengths over the next band's traffic. */
  let drawn: Mesh<Geometry, Shader>[] = [];
  const scratch = new Matrix();
  /**
   * THE WINDOWS, a band at a time: their glass and what is in it, a mesh
   * written again each frame, in a render group of its own over the band's
   * tubes; and each window, where it is and how its tube looks.
   */
  /**
   * One tile's piece of a glass section: which window of its band's mesh, its
   * tile and span, whether a sewer's; and what it keeps between frames — how
   * far its pattern has been carried, and how high the liquid last stood at
   * either end, for the film it left.
   */
  type Pane = { pane: number; i: number; span: GlassSpan; sewer: boolean; way: number; carried: number; film: [number, number] };
  type Windows = Map<number, { own: Container; show: (pane: number, st: GlassState) => void; flush: () => void; panes: Pane[] }>;
  let windows: Windows = new Map();
  /** Where the glass is, for the pipes as they are: by tile. */
  let spans = new Map<number, GlassSpan>();
  let glassAt = 0;
  /**
   * ONE SET OF MESHES A LEVEL OF DETAIL, built when a zoom first wants it and
   * KEPT: crossing a threshold shows one set and hides another, as the roads
   * do it, and nothing is destroyed or built again until a pipe is laid or
   * lifted. `drawn`, `windows` and the panes' look above are the set on show.
   */
  type Level = { drawn: Mesh<Geometry, Shader>[]; windows: Windows };
  const levels = new Map<Detail, Level>();
  let base = "";
  const showLevel = (d: Detail) => {
    for (const [k, l] of levels) {
      const on = k === d;
      for (const mesh of l.drawn) if (mesh.visible !== on) mesh.visible = on;
      for (const { own } of l.windows.values()) if (own.visible !== on) own.visible = on;
    }
    const l = levels.get(d)!;
    drawn = l.drawn; windows = l.windows;
  };
  const flow = new Graphics();
  flow.eventMode = "none";
  overlay.addChild(flow);
  // The Water overlay's numbers, a pool of them, read again twice a second.
  const words = new Container();
  words.eventMode = "none";
  overlay.addChild(words);
  // THE SIGN UNDER THE POINTER, opened out: what is wrong, said plainly, over everything. @see signTip
  const tip = new Container();
  tip.eventMode = "none";
  tip.visible = false;
  const tipBack = new Graphics();
  const TIP_FONT = { fontFamily: "system-ui, sans-serif", wordWrap: true, wordWrapWidth: TIP_W - 2 * TIP_PAD };
  const tipTitle = new Text({ text: "", style: { ...TIP_FONT, fontSize: 12, fontWeight: "700", fill: 0xffffff } });
  const tipText = new Text({ text: "", style: { ...TIP_FONT, fontSize: 11, fill: 0xd6dde6, lineHeight: 15 } });
  tip.addChild(tipBack, tipTitle, tipText);
  overlay.addChild(tip);
  /** The sign last opened, and its box in the layer, so the pointer can move onto it and keep it open. */
  let opened: { key: string; box: [number, number, number, number] } | null = null;
  const pool: Text[] = [];
  let wordsAt = -Infinity;
  /** The zoom the numbers were last set out for: a new one sets them out again at once. */
  let wordsPx = 0, wordsScale = 0;
  let key = "";
  let detail: Detail | null = null;
  /** Each cell's tube as the middle lines it is swept along, (u, v, h) in tiles: what the Water overlay draws on. */
  const routes = new Map<number, ReturnType<typeof cellPaths>>();

  /** The level across the bore a pipe so full stands at: −1 dry, 1 its crown; full, past its crown — no surface to see. */
  const levelOf = (fill: number) => (fill >= 0.985 ? 1.3 : fill < 0.02 ? -1 : -1 + 2 * fill);
  /**
   * WHAT EACH WINDOW SHOWS, said to its mesh: a few numbers a vertex written
   * in place, a band's worth sent up once. Nothing is built. @see pipe-glass
   */
  const showGlass = (g: Grid, now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - glassAt) / 1000));
    glassAt = now;
    const forced = glassOverride();
    for (const { show, flush, panes } of windows.values()) {
      for (const p of panes) {
        const x = p.i % g.w, y = (p.i / g.w) | 0, { ax, ay, from, to } = p.span;
        let fills: [number, number], speed = 0, way = p.way, slop = 0;
        const told = forced?.(g, p.i, now / 1000);
        if (told) {
          // Told what to show: the gallery's. @see glass-state
          fills = [told.fill + from * told.tilt, told.fill + to * told.tilt];
          speed = Math.abs(told.speed); way = told.speed < 0 ? -1 : 1; slop = told.slop;
        } else if (p.sewer) {
          // A CONNECTION holds none of its own: it shows slop while it carries any.
          const r = mainReportAt(g, x, y), q = r && (r.state === "flowing" || r.state === "backed-up") ? r.flow : 0;
          fills = q > 0 ? [0.2 + 0.25 * Math.min(1, q), 0.2 + 0.25 * Math.min(1, q)] : [0, 0];
          speed = q > 0 ? 0.12 + Math.min(1, q) * 0.25 : 0;
          slop = 1;
        } else {
          // A WATER MAIN shows what the solver holds: as full as the pipe stands at either end of the piece.
          const here = mainLiveAt(g, p.i);
          const prev = mainLiveAt(g, idx(g, x - ax, y - ay))?.fill ?? here?.fill ?? 0, next = mainLiveAt(g, idx(g, x + ax, y + ay))?.fill ?? here?.fill ?? 0;
          const f = here?.fill ?? 0, at = (k: number) => (k < 0 ? f + (prev - f) * -k : f + (next - f) * k);
          fills = [at(from), at(to)];
          if (here && here.flow > 0.1) { speed = 0.35 + Math.min(2, here.flow) * 0.6; way = here.dir[0] * ax + here.dir[1] * ay < 0 ? -1 : 1; }
          // How fouled the water it draws is: the worst of its intakes'.
          slop = Math.max(0, ...(mainReportAt(g, x, y)?.intakes.map((k) => k.fouled) ?? [0]));
        }
        // CARRIED ALONG, by how fast it goes; kept small, so the patterns keep their grain.
        p.carried = (p.carried + way * speed * dt) % 4096;
        // WHAT IT LEFT where it stood: the film drains down toward the level, slop's slowly.
        const levels = [levelOf(fills[0]), levelOf(fills[1])], drain = (slop > 0.5 ? 0.06 : 0.25) * dt;
        for (const e of [0, 1] as const) p.film[e] = Math.max(Math.min(1, levels[e]), p.film[e] - drain);
        show(p.pane, { ends: [{ level: levels[0], film: p.film[0] }, { level: levels[1], film: p.film[1] }], carried: p.carried, speed, slop });
      }
      flush();
    }
  };

  /**
   * The ways a main on a cell is joined out, and the level at each face: the
   * mean of the two cells' — but never closer to the ground there than its
   * radius and some air, the higher of the two sides' ground at a step.
   */
  const limbsAt = (g: Grid, x: number, y: number): Limb[] => {
    const z = levelAt(g, x, y), out: Limb[] = [];
    for (const side of SIDES) {
      if (!joined(g, x, y, side)) continue;
      const [dx, dy] = NEIGHBOUR[side];
      const nx = x + dx, ny = y + dy, r = Math.max(tubeR(g.main[idx(g, x, y)]), inBounds(g, nx, ny) ? tubeR(g.main[idx(g, nx, ny)]) : 0);
      const edge = Math.max(groundAt(g, x, y, dx / 2, dy / 2), groundAt(g, nx, ny, -dx / 2, -dy / 2));
      out.push({ dx, dy, zf: Math.max((z + levelAt(g, nx, ny)) / 2, edge + faceClear(r)) });
    }
    return out;
  };

  /** The solid tube's radius on a cell, tiles: a sewer a little wider, a bore fatter. */
  const tubeR = (bits: number) => TUBE_R * (bits & MAIN_SEWER ? SEWER_WIDE : 1) * (bits & MAIN_BORE ? BORE_WIDE : 1);

  /**
   * A CELL'S TUBE, into its band's mesh, and the fitting at its end, in as
   * much detail as the zoom calls for. What it stands on: a frame where it
   * rides high, a saddle on the ground — every other tile, far off — nothing
   * under a fitting: it stands on its own, or on its building's nozzle.
   */
  /**
   * How far in past the port's cell its outlet stands, tiles: an AI
   * building's own wall, however far back; else 0. Once a map revision.
   * @see portSetback
   */
  const setbacks = new Map<number, number>();
  let setbackRev = -1;
  const setbackOf = (g: Grid, p: PortCell): number => {
    if (setbackRev !== g.rev) { setbacks.clear(); setbackRev = g.rev; }
    let k = setbacks.get(p.i);
    if (k === undefined) {
      const st = g.structures.get(p.building), f = { w: st?.w ?? 1, h: st?.h ?? 1 };
      k = st ? portSetback(lookOf(st.def, f), f, p.port) : 0;
      setbacks.set(p.i, k);
    }
    return k;
  };

  /** A cell's limbs, and INTO A BUILDING'S PORT: on to the wall, like any other join, collared there in its fluid's colour. */
  const cellLimbs = (g: Grid, x: number, y: number, port?: PortCell): Limb[] => {
    const out = limbsAt(g, x, y);
    if (port) {
      const [dx, dy] = NEIGHBOUR[port.port.face];
      out.push({ dx: -dx, dy: -dy, zf: levelAt(g, x, y), wall: PORT_COLOUR[port.port.fluid], reach: setbackOf(g, port) });
    }
    return out;
  };

  const tubeCell = (m: PipeMesh, g: Grid, i: number, s: number, d: Detail, port?: PortCell, split: { back?: PipeMesh; near?: PipeMesh } = {}) => {
    const x = i % g.w, y = (i / g.w) | 0, z = levelAt(g, x, y), floor = ground(g, x, y), out = cellLimbs(g, x, y, port);
    const bits = g.main[i], end = port ? 0 : g.mainEnd[i];
    const saddled = (!end || end === MAIN_END.cap) && (d !== "far" || (x + y) % 2 === 0);
    // OVER A ROAD, a frame across it, its legs at its edges; none at a junction, where the traffic turns.
    const verges = roadAxis(g, x, y);
    const support: Support = g.paved[i] && !verges ? "none" : z - floor > LIFT + 0.4 ? "frame" : saddled ? "saddle" : "none";
    // A SEWER: cast iron, flanged at every other join, banded brown. The AI's: steel, banded violet.
    const sewer = (bits & MAIN_SEWER) !== 0, ai = (bits & MAIN_AI) !== 0;
    const colour = sewer ? IRON : STEEL;
    // WHERE THE BORE CHANGES, the length each limb meets: the wider of the two draws the reducer. @see Limb.meets
    for (const l of out) {
      if (l.wall !== undefined || !inBounds(g, x + l.dx, y + l.dy)) continue;
      const next = g.main[idx(g, x + l.dx, y + l.dy)];
      if (next) l.meets = tubeR(next) * (d === "far" ? FAR_THICK : 1);
    }
    const band = (sewer || ai) && (x + y) % 4 === 3 ? (sewer ? SEWER_BAND : AI_BAND) : null;
    // A pump building stands over its own pump: no pump house drawn under it.
    const fit = FITTINGS[end] ?? null;
    const own = fit === "pump" && g.structures.get(structureAt(g, x, y))?.def === "pump";
    pipeCell(m, s, x, y, z, out, {
      // FAR OFF the tube is a little thicker, so it holds against the grass, and its strap is left off.
      r: tubeR(bits) * (d === "far" ? FAR_THICK : 1), colour, sides: DETAIL_SIDES[d], end: own ? null : fit, support, floor, strap: d !== "far" && !spans.has(i),
      material: sewer ? MATERIAL.iron : MATERIAL.steel,
      // No flange inside a glass section: its far face is one where the tile before it has glass too.
      flanges: d !== "far" && (!sewer || (x + y) % 2 === 0) && !(spans.get(i)?.from === -0.5), bolts: d === "near", valve: d === "near", band: spans.has(i) ? null : band,
      window: 0, glass: null, frames: d === "near",
      verges, ...(g.paved[i] ? split : {}),
    });
    // AN OUTLET'S VALVE, on top of the tube: in the middle of a straight, on the length into the wall where it bends.
    if (port && g.mainEnd[i] === MAIN_END.outlet && d === "near") {
      const wall = out[out.length - 1], straight = out.length === 2 && out[0].dx === -wall.dx && out[0].dy === -wall.dy;
      const k = straight ? 0 : VALVE_OUT;
      valve(m, s, x + wall.dx * k, y + wall.dy * k, z * ZT, tubeR(bits));
    }
  };

  /** Every level's meshes put away: the map's pipes changed. */
  const clear = () => {
    for (const l of levels.values()) {
      for (const mesh of l.drawn) destroyPipeDrawable(mesh);
      for (const { own } of l.windows.values()) { own.parent?.removeChild(own); own.destroy({ children: true }); }
    }
    levels.clear();
    drawn = [];
    windows = new Map();
  };

  /** One of the overlay's numbers, from the pool. */
  const word = (k: number, text: string, colour: number, at: [number, number], px: number) => {
    let tx = pool[k];
    if (!tx) {
      tx = new Text({ text, style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fontWeight: "600", fill: 0xffffff, stroke: { color: 0x05080d, width: 3 } } });
      tx.anchor.set(0.5, 1);
      pool[k] = tx;
      words.addChild(tx);
    }
    tx.visible = true;
    if (tx.text !== text) tx.text = text;
    tx.style.fill = colour;
    tx.scale.set(px);
    tx.position.set(at[0], at[1]);
  };

  /** THE WATER OVERLAY, this frame: the town dimmed; every main by its state; the tanks; the numbers. */
  const drawWater = (g: Grid, s: number, w: number, now: number) => {
    // A screen pixel, in the overlay's units: the rings and the numbers keep their size at any zoom.
    // Worked out now, not read from `worldTransform`, which is last frame's: a zoom drew them its old size.
    const px = 1 / Math.max(1e-3, Math.abs(overlay.getGlobalTransform(scratch, false).a));
    // Dimmed, the whole map and a margin round it for what stands up off it.
    const top = P(s, 0, 0, 40), bottom = P(s, g.w, g.h, -10), left = P(s, 0, g.h, 0), right = P(s, g.w, 0, 0);
    flow.rect(left[0] - 200 * s, top[1] - 200 * s, right[0] - left[0] + 400 * s, bottom[1] - top[1] + 400 * s);
    flow.fill({ color: DIM, alpha: 0.55 });
    const { list } = findMains(g);
    for (const net of list) {
      const r = mainReportAt(g, net.cells[0] % g.w, (net.cells[0] / g.w) | 0);
      const colour = r ? STATE_COLOUR[r.state] : 0x8796a8;
      // ALONG THE TUBES: each cell's middle lines, round its bends and up its climbs.
      for (const i of net.cells) {
        const x = i % g.w, y = (i / g.w) | 0;
        const paths = routes.get(i) ?? [];
        for (const path of paths) {
          for (const [k, [u, v, h]] of path.entries()) {
            const p = P(s, u, v, h / ZT);
            if (k === 0) flow.moveTo(p[0], p[1]); else flow.lineTo(p[0], p[1]);
          }
        }
        if (!paths.length) { const a = P(s, x, y, levelAt(g, x, y)); flow.circle(a[0], a[1], w * 0.6); }
      }
      flow.stroke({ color: colour, width: w * (net.bore > 1 ? 1.5 : 1.1), cap: "round", join: "round", alpha: 0.95 });
    }
    // EACH BUILDING THAT DRINKS, its tank as a ring: full round, empty none.
    const ringAt = new Map<number, [number, number]>();
    for (const [id, tank] of allTanks()) {
      const b = g.structures.get(id);
      if (!b) continue;
      const c = P(s, b.x + (b.w - 1) / 2, b.y + (b.h - 1) / 2, ground(g, b.x, b.y) + 4);
      ringAt.set(id, c);
      const r = 11 * px, share = tank.capacity > 0 ? Math.max(0, Math.min(1, tank.level / tank.capacity)) : 0;
      flow.circle(c[0], c[1], r);
      flow.fill({ color: DIM, alpha: 0.8 });
      flow.circle(c[0], c[1], r);
      flow.stroke({ color: 0x2b3440, width: 3.5 * px });
      if (share > 0) {
        flow.moveTo(c[0], c[1] - r).arc(c[0], c[1], r, -Math.PI / 2, -Math.PI / 2 + share * Math.PI * 2);
        flow.stroke({ color: share < 0.25 ? WARN : WATER, width: 3.5 * px, cap: "round" });
      }
    }
    // EACH FREE INLET, a mark to aim for: a main ends there, and nowhere else on the wall. @see portsOf
    for (const [id] of allTanks()) {
      const b = g.structures.get(id);
      if (!b) continue;
      for (const p of portsOf(g, b)) {
        if (p.port.fluid !== "water" || g.main[p.i] || g.mainEnd[p.i]) continue;
        const c = P(s, p.x, p.y, levelAt(g, p.x, p.y));
        flow.circle(c[0], c[1], 5 * px);
        flow.fill({ color: DIM, alpha: 0.8 });
        flow.circle(c[0], c[1], 5 * px);
        flow.stroke({ color: PORT_COLOUR.water, width: 2 * px });
        flow.circle(c[0], c[1], 1.8 * px);
        flow.fill({ color: WATER });
      }
    }
    // THE NUMBERS, twice a second — and at once after a zoom, or they stand at the old one's size:
    // each tank's share, each intake's depth, each main's head.
    words.visible = true;
    if (now - wordsAt < 500 && px === wordsPx && s === wordsScale) return;
    wordsAt = now;
    wordsPx = px;
    wordsScale = s;
    const all: Word[] = [];
    for (const [id, tank] of allTanks()) {
      const c = ringAt.get(id);
      if (!c) continue;
      const f = tank.capacity > 0 ? tank.level / tank.capacity : 0;
      all.push({ text: `${Math.round(100 * f)}%`, colour: 0xffffff, at: [c[0], c[1] - 13 * px], rank: f < 0.25 ? 3 : 2 });
    }
    for (const r of mainReportsFor(g).values()) {
      for (const it of r.intakes) {
        const x = it.cell % g.w, y = (it.cell / g.w) | 0;
        const c = P(s, x, y, levelAt(g, x, y));
        // FOULED water cools less, and says so. @see coolingKept
        const fouled = it.surface !== null && it.fouled >= 0.05 ? ` · ${Math.round(it.fouled * 100)}% fouled` : "";
        all.push({
          text: it.surface === null ? "dry" : `${(it.depth / 2).toFixed(1)} slabs deep${fouled}`,
          colour: it.surface === null ? 0xff8a8d : fouled ? 0xd9a35a : 0x9fd6ff,
          at: [c[0], c[1] - w * 3.4],
          rank: it.surface === null || fouled ? 3 : 1,
        });
      }
    }
    for (const net of list) {
      const r = mainReportAt(g, net.cells[0] % g.w, (net.cells[0] / g.w) | 0);
      if (!r || !r.intakes.some((it) => it.surface !== null) || !r.outlets.some((o) => o.building >= 0)) continue;
      const mid = net.cells[(net.cells.length / 2) | 0], x = mid % g.w, y = (mid / g.w) | 0;
      const c = P(s, x, y, levelAt(g, x, y));
      const slabs = r.head / 2;
      all.push({ text: slabs >= 0 ? `${slabs.toFixed(1)} slabs above the floor` : `${(-slabs).toFixed(1)} slabs below the floor`, colour: STATE_COLOUR[r.state], at: [c[0], c[1] - w * 1.6], rank: r.state === "flowing" || r.state === "full" ? 0 : 3 });
    }
    let k = 0;
    for (const it of spaceWords(all, px)) word(k++, it.text, it.colour, it.at, px);
    for (let j = k; j < pool.length; j++) pool[j].visible = false;
  };

  return {
    sync(g, scale, zoom = 1) {
      detail = detailFor(2 * HW * scale * zoom, detail);
      const b = `${g.rev}|${scale}|${g.w}x${g.h}`, k = `${b}|${detail}`;
      if (k === key) return;
      key = k;
      // THE PIPES CHANGED: every level goes. Only the zoom did: the level wanted is shown, built if it never was.
      if (b !== base) { base = b; clear(); }
      if (levels.has(detail)) { showLevel(detail); return; }
      drawn = [];
      windows = new Map();
      const d = detail, sides = DETAIL_SIDES[d];
      // THE PORTS on the buildings, as nozzles in their band's mesh, under any main that ends at them.
      const nozzles = new Map<number, PortCell[]>();
      for (const st of g.structures.values()) {
        for (const p of portsOf(g, st)) {
          const band = p.x + p.y;
          if (!bands.pavedOf[band]) continue;
          const list = nozzles.get(band) ?? [];
          nozzles.set(band, list);
          list.push(p);
        }
      }
      // A main ending at a port runs on into it: no nozzle there, the main to the wall. @see tubeCell
      const joinedPort = new Map<number, PortCell>();
      for (const list of nozzles.values()) for (const p of list) if (g.mainEnd[idx(g, p.x, p.y)]) joinedPort.set(idx(g, p.x, p.y), p);
      // THE ROUTES, every cell's, drawn or not.
      routes.clear();
      for (let i = 0; i < g.main.length; i++) {
        if (!g.main[i] && !g.mainEnd[i]) continue;
        const x = i % g.w, y = (i / g.w) | 0;
        routes.set(i, cellPaths(x, y, levelAt(g, x, y) * ZT, cellLimbs(g, x, y, joinedPort.get(i)), tubeR(g.main[i])));
      }
      spans = glassSpans(g);
      // WHICH WAY A CONNECTION'S SLOP GOES along each of its glass tiles: away from the workplace it drains.
      const sewerWay = new Map<number, number>();
      for (const net of findMains(g).list) {
        if (!net.sewer || !net.cells.some((i) => spans.has(i))) continue;
        const dist = new Map<number, number>(), queue = net.cells.filter((i) => g.mainEnd[i] === MAIN_END.drain);
        for (const q of queue) dist.set(q, 0);
        for (let h = 0; h < queue.length; h++) {
          const i = queue[h], x = i % g.w, y = (i / g.w) | 0;
          for (const side of SIDES) {
            if (!joined(g, x, y, side)) continue;
            const j = idx(g, x + NEIGHBOUR[side][0], y + NEIGHBOUR[side][1]);
            if (!dist.has(j)) { dist.set(j, dist.get(i)! + 1); queue.push(j); }
          }
        }
        for (const i of net.cells) {
          const sp = spans.get(i);
          if (sp) sewerWay.set(i, (dist.get(i + sp.ax + sp.ay * g.w) ?? 0) >= (dist.get(i) ?? 0) ? 1 : -1);
        }
      }
      // A BAND AT A TIME: its nozzles, its supports and tubes and fittings.
      const cells = new Map<number, number[]>();
      for (const band of nozzles.keys()) cells.set(band, []);
      for (let i = 0; i < g.main.length; i++) {
        if (!g.main[i] && !g.mainEnd[i]) continue;
        const band = (i % g.w) + ((i / g.w) | 0);
        if (!bands.pavedOf[band]) continue;
        const list = cells.get(band) ?? [];
        cells.set(band, list);
        list.push(i);
      }
      // EACH BAND'S MESHES, in its movers' tier and over them: a main is above
      // anything that moves past it — on stilts over the road, or by it on the
      // ground where nothing walks — and a mover under one is BEHIND it at every
      // point where the two overlap on the screen. In the paved tier, every car
      // in its band drew over it. Over a road, a frame's far leg goes under the
      // movers (they pass in front of it), and the length nearest the camera into
      // the next band's mesh, over the cars filed there by their noses. @see PipeLook.near
      const nears = new Map<number, PipeMesh>();
      const nearOf = (band: number) => {
        let n = nears.get(band);
        if (!n) nears.set(band, (n = pipeMesh()));
        return n;
      };
      const place = (m: PipeMesh, layer: Container | undefined, z: number) => {
        if (!m.ni || !layer) return;
        const mesh = pipeDrawable(m);
        mesh.zIndex = z;
        layer.addChild(mesh);
        drawn.push(mesh);
      };
      for (const [band, list] of cells) {
        const m = pipeMesh(), back = pipeMesh();
        // EACH PORT'S OUTLET, nearer drawn over farther: an open one pointing away
        // from the camera before the mains, toward it after; a joined one, which
        // stands between its main and the wall, the other way round. @see outlet
        const port = (before: boolean) => {
          for (const p of nozzles.get(band) ?? []) {
            // A sewer RISING into a processor's inlet is joined to it too. @see sewer-layer riser
            const i = idx(g, p.x, p.y), riser = p.port.dir === "in" && p.port.fluid === "slop" && g.sewerFit[i] === SEWER_FIT.inlet;
            const [dx, dy] = NEIGHBOUR[p.port.face], toward = dx + dy > 0, joined = joinedPort.has(i) || riser;
            if ((joined ? toward : !toward) !== before) continue;
            const slop = p.port.fluid === "slop", r = joinedPort.has(i) ? tubeR(g.main[i]) : riser ? LATERAL_R : TUBE_R * (slop ? SEWER_WIDE : 1);
            const out = () => outlet(m, scale, p.x, p.y, levelAt(g, p.x, p.y), dx, dy, r, PORT_COLOUR[p.port.fluid], slop ? IRON : STEEL, sides, joined, d === "near", setbackOf(g, p));
            if (!riser) { out(); continue; }
            // A SEWER'S RISER, up out of the ground in its collar and round into
            // the inlet, its flange bolted to the outlet's: the lateral's drop the
            // other way. Nearer the camera than the outlet it stands in front of. @see pipeCell "drop"
            const z = levelAt(g, p.x, p.y);
            const rise = () => pipeCell(m, scale, p.x, p.y, z, [{ dx: -dx, dy: -dy, zf: z, wall: 0, reach: setbackOf(g, p) }], {
              r: LATERAL_R, colour: LATERAL_IRON, sides, end: "drop", floor: ground(g, p.x, p.y), flanges: true, bolts: d === "near",
            });
            if (toward) { out(); rise(); } else { rise(); out(); }
          }
        };
        port(true);
        for (const i of list) {
          const road = g.paved[i] !== 0 && band + 1 < bands.dynamicOf.length;
          tubeCell(m, g, i, scale, d, joinedPort.get(i), road ? { back, near: nearOf(band + 1) } : {});
        }
        port(false);
        place(back, bands.pavedOf[band], 0);
        place(m, bands.dynamicOf[band], PIPE_Z);
        // ITS WINDOWS last in the band, over all its tubes — IN A RENDER GROUP OF THEIR OWN:
        // written again every frame the water moves, which in the chunk's group rebuilt the
        // draw list of every tile and building in the chunk, every frame. @see BandLayer.dynamicOf
        // BUILT ONCE: what each shows is written into it in place. @see showGlass
        const panes: Pane[] = [], gm = glassMesh(), m2 = pipeMesh();
        for (const i of list) {
          const sp = spans.get(i);
          if (!sp) continue;
          const x = i % g.w, y = (i / g.w) | 0, { ax, ay, from, to } = sp;
          const z = levelAt(g, x, y), slope = (levelAt(g, x + ax, y + ay) - levelAt(g, x - ax, y - ay)) / 2;
          const sewer = (g.main[i] & MAIN_SEWER) !== 0, r = tubeR(g.main[i]) * (d === "far" ? FAR_THICK : 1);
          const pt = (k: number): [number, number, number] => [x + ax * k, y + ay * k, (z + slope * k) * ZT];
          const [a, b] = [pt(from), pt(to)];
          // A hair prouder than the steel it lies over, which it hides.
          const pane = glassPane(gm, scale, a[0], a[1], a[2], b[0], b[1], b[2], r * 1.012, sp.lo, sp.hi);
          panes.push({ pane, i, span: sp, sewer, way: sewerWay.get(i) ?? 1, carried: 0, film: [-1, -1] });
          // ITS COLLAR, steel, where the section ends on this tile: at the end that is not a tile's face.
          if (d !== "far") for (const k of [from, to]) if (Math.abs(k) !== 0.5) hoop(m2, scale, pt(k), ax, ay, r, r * 1.14, 0.035, solid(COLLAR), sides, slope * ZT);
        }
        if (m2.ni) place(m2, bands.dynamicOf[band], PIPE_Z + 0.005);
        if (!panes.length) continue;
        const { mesh, show, flush } = glassDrawable(gm);
        const own = new Container({ isRenderGroup: true });
        own.eventMode = "none";
        own.addChild(mesh);
        own.zIndex = PIPE_Z + 0.01;
        bands.dynamicOf[band].addChild(own);
        windows.set(band, { own, show, flush, panes });
      }
      // The lengths over each band's traffic from the band behind it: under that band's own mains, which meet them.
      for (const [band, n] of nears) place(n, bands.dynamicOf[band], PIPE_Z - 0.01);
      levels.set(d, { drawn, windows });
      showLevel(d);
    },
    tick(g, scale, now, preview, ok = true, overlayOn = false, hover = null, pumpAt = null) {
      flow.clear();
      const t = now / 1000;
      showGlass(g, now);
      // The tube's width on screen, which the water seen through its glass is sized to.
      const w = TUBE_R * 2 * K * scale, ow = OVERLAY_WIDE * HW * 2 * scale;
      if (overlayOn) drawWater(g, scale, ow, now);
      else if (words.visible) words.visible = false;
      // THE MAIN BEING DRAGGED: its route as a tube of light, teal where it will work, amber where it won't.
      if (preview && preview.length) {
        const colour = ok ? 0x3fe0a8 : WARN;
        for (const [k, c] of preview.entries()) {
          const p = P(scale, c.x, c.y, levelAt(g, c.x, c.y));
          if (k === 0) flow.moveTo(p[0], p[1]); else flow.lineTo(p[0], p[1]);
        }
        flow.stroke({ color: colour, width: ow * 1.1, cap: "round", join: "round", alpha: 0.45 + 0.15 * Math.sin(t * 6) });
        for (const c of [preview[0], preview[preview.length - 1]]) {
          const p = P(scale, c.x, c.y, levelAt(g, c.x, c.y));
          flow.circle(p[0], p[1], ow * 0.8);
          flow.fill({ color: colour, alpha: 0.8 });
        }
        // THE PUMP IT WOULD BE LAID WITH, at its intake: the sign for one, a ring with a wedge in it.
        if (pumpAt) {
          const p = P(scale, pumpAt.x, pumpAt.y, levelAt(g, pumpAt.x, pumpAt.y)), r = ow * 2.2;
          flow.circle(p[0], p[1], r);
          flow.fill({ color: 0x0c1418, alpha: 0.85 });
          flow.circle(p[0], p[1], r);
          flow.stroke({ color: colour, width: ow * 0.45, alpha: 0.95 });
          flow.poly([p[0] - r * 0.45, p[1] - r * 0.55, p[0] + r * 0.6, p[1], p[0] - r * 0.45, p[1] + r * 0.55]);
          flow.fill({ color: colour, alpha: 0.95 });
        }
      }
      const { list } = findMains(g);
      // Each sign this frame; the one under the pointer opened out after them all.
      const signs: { key: string; x: number; y: number; r: number; colour: number; say: Say }[] = [];
      const signTip = () => {
        const ptr = pointerRead(), unit = 1 / (flow.worldTransform.a || 1);
        let hit: (typeof signs)[number] | null = null;
        if (ptr) {
          const keep = opened && signs.find((q) => q.key === opened!.key);
          const [x0, y0, x1, y1] = opened?.box ?? [0, 0, 0, 0];
          if (keep && ptr.wx >= x0 && ptr.wx <= x1 && ptr.wy >= y0 && ptr.wy <= y1) hit = keep;
          else for (const q of signs) if (Math.hypot(ptr.wx - q.x, ptr.wy - q.y) <= Math.max(q.r * 1.25, 10 * unit)) hit = q;
        }
        if (!hit) { tip.visible = false; opened = null; return; }
        opened = { key: hit.key, box: openSign(hit, unit) };
      };
      /** A sign opened out: a dark card from its right, its title in its colour, what is wrong under it. Returns its box. */
      const openSign = (q: (typeof signs)[number], unit: number): [number, number, number, number] => {
        tipTitle.text = q.say.title;
        tipTitle.style.fill = q.colour;
        tipText.text = q.say.text;
        const w = TIP_W, h = TIP_PAD * 2 + tipTitle.height + 3 + tipText.height;
        tipTitle.position.set(TIP_PAD, TIP_PAD);
        tipText.position.set(TIP_PAD, TIP_PAD + tipTitle.height + 3);
        tipBack.clear();
        tipBack.roundRect(0, 0, w, h, 4).fill({ color: INK, alpha: 0.94 }).stroke({ color: q.colour, width: 1, alpha: 0.9 });
        tipBack.rect(0, 4, 3, h - 8).fill({ color: q.colour });
        // Beside the sign, its middle at the sign's, on the side toward the
        // middle of the screen — the panels cover its right; in screen pixels whatever the zoom.
        const gap = q.r * 1.3, half = Math.max(q.r * 1.25, (h / 2) * unit);
        const left = flow.toGlobal({ x: q.x, y: q.y }).x > (globalThis.innerWidth ?? 0) * 0.4;
        const x0 = left ? q.x - gap - w * unit : q.x + gap;
        tip.scale.set(unit);
        tip.position.set(x0, q.y - (h / 2) * unit);
        tip.visible = true;
        // Over every other mark on the map, whatever was added after it.
        if (tip.parent && tip.parent.children[tip.parent.children.length - 1] !== tip) tip.parent.addChild(tip);
        // The box the pointer may cross to it and stay on it: the sign and the card.
        return [Math.min(x0, q.x - q.r * 1.25), q.y - half, Math.max(x0 + w * unit, q.x + q.r * 1.25), q.y + half];
      };
      if (!list.length) { signTip(); return; }
      const hoverAt = hover && inBounds(g, hover.x, hover.y) ? idx(g, hover.x, hover.y) : null;
      for (const net of list) {
        const first = net.cells[0], fx = first % g.w, fy = (first / g.w) | 0;
        const r = mainReportAt(g, fx, fy);
        const state: MainState | undefined = r?.state;
        // WHICH WAY: steps from the nearest intake, so the water runs away from it.
        const dist = new Map<number, number>();
        const queue = net.sewer ? net.cells.filter((i) => g.mainEnd[i] === MAIN_END.drain) : [...net.intakes];
        for (const q of queue) dist.set(q, 0);
        for (let h = 0; h < queue.length; h++) {
          const i = queue[h], x = i % g.w, y = (i / g.w) | 0;
          for (const side of SIDES) {
            if (!joined(g, x, y, side)) continue;
            const [dx, dy] = NEIGHBOUR[side];
            const j = idx(g, x + dx, y + dy);
            if (dist.has(j)) continue;
            dist.set(j, dist.get(i)! + 1);
            queue.push(j);
          }
        }
        {
          // THE INTAKE DRAWING: a slow swirl in the water at its mouth.
          if (state === "flowing") {
            for (const q of net.intakes) {
              const x = q % g.w, y = (q / g.w) | 0, c = P(scale, x, y, levelAt(g, x, y) - 0.3);
              for (let k = 0; k < 2; k++) {
                const a = t * 2.2 + k * Math.PI;
                flow.arc(c[0], c[1], w * (1.1 + k * 0.5), a, a + 1.6);
                flow.stroke({ color: 0xe8f6ff, width: Math.max(0.6, w * 0.12), alpha: 0.7 });
              }
            }
          }
        }
        // WHICH WAY IT RUNS, on the main under the pointer and every main in the
        // Water overlay: chevrons every other tile, pointing downstream.
        const hovered = hoverAt !== null && net.cells.includes(hoverAt);
        if ((hovered || overlayOn) && state === "flowing" && (!net.sewer || (r?.flow ?? 0) > 0)) {
          for (const i of net.cells) {
            const x = i % g.w, y = (i / g.w) | 0;
            if ((x + y) % 2) continue;
            const d = dist.get(i) ?? 0;
            for (const side of SIDES) {
              if (!joined(g, x, y, side)) continue;
              const [dx, dy] = NEIGHBOUR[side];
              if ((dist.get(idx(g, x + dx, y + dy)) ?? 0) <= d) continue;
              // On the tube: the length that leaves by this side, a little way along toward it.
              const on = chevronAt(routes.get(i) ?? [], x + dx * 0.5, y + dy * 0.5);
              if (!on) continue;
              const [c, [tu, tv, th]] = on, A = 0.08;
              const at = (k: number, side: number): [number, number] =>
                P(scale, c[0] + tu * A * k - tv * A * side, c[1] + tv * A * k + tu * A * side, (c[2] + th * A * k) / ZT);
              const tip = at(1, 0), l = at(-1, 1), rr = at(-1, -1);
              const lift = ow * 0.45;
              flow.moveTo(l[0], l[1] - lift).lineTo(tip[0], tip[1] - lift).lineTo(rr[0], rr[1] - lift);
              flow.stroke({ color: 0xffffff, width: Math.max(1, ow * 0.12), alpha: 0.9, join: "round", cap: "round" });
            }
          }
        }
        if (state && state !== "flowing" && state !== "full") {
          // CANNOT DELIVER: a warning sign at each intake — or at its far end,
          // with none — on a pin down to the fitting, in the colour of what is
          // wrong, a ring going out from it.
          const at = net.intakes.length ? net.intakes : [net.cells[0]];
          for (const i of at) {
            const x = i % g.w, y = (i / g.w) | 0;
            // Floated over the fitting — a pump house stands tall at an intake — its pin down to the tube.
            const c = P(scale, x, y, Math.max(levelAt(g, x, y), ground(g, x, y) + 3.4));
            const tube = nearestOn(routes.get(i) ?? [], x, y);
            const foot = tube ? P(scale, tube[0], tube[1], tube[2] / ZT) : P(scale, x, y, levelAt(g, x, y));
            const top = net.intakes.length ? c[1] - ow * 2.4 : foot[1] - ow * 1.9;
            const key = `${i}:${state}`;
            warnSign(flow, foot[0], top, ow * 0.7, foot[1], STATE_COLOUR[state], t + i * 0.37, opened?.key === key);
            if (r) signs.push({ key, x: foot[0], y: top, r: ow * 0.7, colour: STATE_COLOUR[state], say: sayOf(r) });
          }
        }
      }
      signTip();
    },
    destroy() {
      clear();
      flow.parent?.removeChild(flow);
      flow.destroy();
      tip.parent?.removeChild(tip);
      tip.destroy({ children: true });
      words.parent?.removeChild(words);
      words.destroy({ children: true });
    },
  };
}


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
import { MAIN_AI, MAIN_BORE, MAIN_END, MAIN_SEWER, idx, inBounds, structureAt, type Grid } from "../grid";
import { allTanks } from "../projects/cooling";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { findMains, joined, mainReportAt, mainReports, type MainState } from "../water/mains";
import { portsOf, type PortCell } from "../water/ports";
import type { BandLayer } from "./bands";
import { destroyPipeDrawable, pipeDrawable } from "./pipe-gpu";
import { K, nozzle, pipeCell, pipeMesh, type Fitting, type Limb, type PipeMesh, type Support } from "./pipe-mesh";

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
const TUBE_R = 0.18 / Math.SQRT2;
const STEEL = 0xb9b7b1, IRON = 0x7d5c40;
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
  [MAIN_END.outlet]: "outlet", [MAIN_END.drain]: "drain", [MAIN_END.outfall]: "outfall",
};
/** How high a main rides over a road, half steps; how much fatter a widened bore is. */
const ROAD_LIFT = 2.4;
const BORE_WIDE = 1.4;
/** A SEWER: a little wider, banded brown. The AI's mains: banded violet. */
const SEWER_BAND = 0x9a6a3a, SEWER_WIDE = 1.18;
const AI_BAND = 0xb44aff;
/** A port's nozzle: blue for water, brown for slop. */
const PORT_COLOUR = { water: 0x3f86c6, slop: 0x7a5230 } as const;
/** The slop seen in a sewer's glass, and the lumps in it. */
const SLOP_IN = 0x7a5230, SLOP_LUMP = 0x3f2a18;
/** The water in a main, and the warning at one that cannot deliver. */
const WATER = 0x5fb7ff, WARN = 0xf2a33a;
/** A glass section's tint, and how long it is, tiles. */
const GLASS_TINT = 0xd9f1ff, GLASS = 0.62;
/** Glass every fourth tile of a straight run (collars on the others). */
const isGlass = (g: Grid, x: number, y: number) => {
  const i = idx(g, x, y);
  if (!g.main[i] || g.mainEnd[i]) return false;
  const ns = joined(g, x, y, "N") && joined(g, x, y, "S"), ew = joined(g, x, y, "E") && joined(g, x, y, "W");
  return (ns !== ew) && !joined(g, x, y, ns ? "E" : "N") && !joined(g, x, y, ns ? "W" : "S") && (x + y) % 4 === 2;
};
/** The Water overlay: the dimming, and each state's colour. */
const DIM = 0x05080d;
const STATE_COLOUR: Record<MainState, number> = {
  flowing: 0x3fe08a, full: 0x5fb7ff, "no-head": WARN, unpaid: WARN, dry: 0xe5484d, "no-source": 0xe5484d, "no-outlet": 0xe5484d,
};

export type MainsLayer = {
  /** Rebuild the tubes when the mains, the scale or the tier of detail for `zoom`, the viewport's, change. */
  sync: (g: Grid, scale: number, zoom?: number) => void;
  /** The water moving in them, this frame; and the main being dragged out, a ghost of itself. */
  tick: (g: Grid, scale: number, now: number, preview?: readonly { x: number; y: number }[] | null, ok?: boolean, water?: boolean, hover?: { x: number; y: number } | null) => void;
  destroy: () => void;
};

/** The point in screen space of map coordinates (cell centres on the integers) at `z` half steps. */
const P = (s: number, u: number, v: number, z: number): [number, number] => [(u - v) * HW * s, (u + v) * HH * s - z * HEIGHT_UNIT * s];


const ground = (g: Grid, x: number, y: number) => (inBounds(g, x, y) ? g.height[idx(g, x, y)] : 0);

/**
 * The level a main lies at on a cell: just off its ground — but on stilts
 * over a road, and over a dip (both cells it joins higher) level with the
 * lower of them.
 */
function levelAt(g: Grid, x: number, y: number): number {
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
  /** The tubes, a mesh a band. */
  const meshes = new Map<number, Mesh<Geometry, Shader>>();
  const scratch = new Matrix();
  /** The water in the tubes, a Graphics a band, over that band's tubes; and those drawn in last frame. */
  const water = new Map<number, Graphics>();
  const wet = new Set<Graphics>();
  const flow = new Graphics();
  flow.eventMode = "none";
  overlay.addChild(flow);
  // The Water overlay's numbers, a pool of them, read again twice a second.
  const words = new Container();
  words.eventMode = "none";
  overlay.addChild(words);
  const pool: Text[] = [];
  let wordsAt = -Infinity;
  /** The zoom the numbers were last set out for: a new one sets them out again at once. */
  let wordsPx = 0, wordsScale = 0;
  let key = "";
  let detail: Detail | null = null;

  /** The solid tube's radius on a cell, tiles: a sewer a little wider, a bore fatter. */
  const tubeR = (bits: number) => TUBE_R * (bits & MAIN_SEWER ? SEWER_WIDE : 1) * (bits & MAIN_BORE ? BORE_WIDE : 1);

  /**
   * A CELL'S TUBE, into its band's mesh, and the fitting at its end, in as
   * much detail as the zoom calls for. What it stands on: a frame where it
   * rides high, a saddle on the ground — every other tile, far off — nothing
   * under a fitting: it stands on its own, or on its building's nozzle.
   */
  const tubeCell = (m: PipeMesh, g: Grid, i: number, s: number, d: Detail) => {
    const x = i % g.w, y = (i / g.w) | 0, z = levelAt(g, x, y), floor = ground(g, x, y), out: Limb[] = [];
    for (const side of SIDES) {
      if (!joined(g, x, y, side)) continue;
      const [dx, dy] = NEIGHBOUR[side];
      out.push({ dx, dy, zf: (z + levelAt(g, x + dx, y + dy)) / 2 });
    }
    const bits = g.main[i], end = g.mainEnd[i];
    const saddled = (!end || end === MAIN_END.cap) && (d !== "far" || (x + y) % 2 === 0);
    const support: Support = z - floor > LIFT + 0.4 ? "frame" : saddled ? "saddle" : "none";
    // A SEWER: cast iron, flanged at every other join, banded brown. The AI's: steel, banded violet.
    const sewer = (bits & MAIN_SEWER) !== 0, ai = (bits & MAIN_AI) !== 0;
    const colour = sewer ? IRON : STEEL;
    const band = (sewer || ai) && (x + y) % 4 === 3 ? (sewer ? SEWER_BAND : AI_BAND) : null;
    // A pump building stands over its own pump: no pump house drawn under it.
    const fit = FITTINGS[end] ?? null;
    const own = fit === "pump" && g.structures.get(structureAt(g, x, y))?.def === "pump";
    pipeCell(m, s, x, y, z, out, {
      r: tubeR(bits), colour, sides: DETAIL_SIDES[d], end: own ? null : fit, support, floor,
      flanges: d !== "far" && (!sewer || (x + y) % 2 === 0), bolts: d === "near", valve: d === "near", band,
      window: isGlass(g, x, y) ? GLASS / 2 : 0, glass: GLASS_TINT, frames: d === "near",
    });
  };

  const clear = () => {
    for (const mesh of meshes.values()) destroyPipeDrawable(mesh);
    meshes.clear();
    for (const gfx of water.values()) { const own = gfx.parent; own?.parent?.removeChild(own); own?.destroy({ children: true }); }
    water.clear();
    wet.clear();
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
      for (const i of net.cells) {
        const x = i % g.w, y = (i / g.w) | 0;
        const a = P(s, x, y, levelAt(g, x, y));
        let any = false;
        for (const side of SIDES) {
          if (!joined(g, x, y, side)) continue;
          const [dx, dy] = NEIGHBOUR[side];
          const b = P(s, x + dx * 0.5, y + dy * 0.5, (levelAt(g, x, y) + levelAt(g, x + dx, y + dy)) / 2);
          flow.moveTo(a[0], a[1]).lineTo(b[0], b[1]);
          any = true;
        }
        if (!any) flow.circle(a[0], a[1], w * 0.6);
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
    for (const r of mainReports().values()) {
      for (const it of r.intakes) {
        const x = it.cell % g.w, y = (it.cell / g.w) | 0;
        const c = P(s, x, y, levelAt(g, x, y));
        // FOULED water cools less, and says so. @see coolingKept
        const fouled = it.surface !== null && it.fouled >= 0.05 ? ` · ${Math.round(it.fouled * 100)}% fouled` : "";
        all.push({
          text: it.surface === null ? "dry" : `${(it.depth / 2).toFixed(1)} deep${fouled}`,
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
      all.push({ text: `head ${slabs > 0 ? "+" : ""}${slabs.toFixed(1)}`, colour: STATE_COLOUR[r.state], at: [c[0], c[1] - w * 1.6], rank: r.state === "flowing" || r.state === "full" ? 0 : 3 });
    }
    let k = 0;
    for (const it of spaceWords(all, px)) word(k++, it.text, it.colour, it.at, px);
    for (let j = k; j < pool.length; j++) pool[j].visible = false;
  };

  return {
    sync(g, scale, zoom = 1) {
      detail = detailFor(2 * HW * scale * zoom, detail);
      const k = `${g.rev}|${scale}|${g.w}x${g.h}|${detail}`;
      if (k === key) return;
      key = k;
      clear();
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
      for (const [band, list] of cells) {
        const m = pipeMesh();
        // A NOZZLE pointing away from the camera goes in before the mains, one pointing toward it after: nearer draws over farther.
        const port = (toward: boolean) => {
          for (const p of nozzles.get(band) ?? []) {
            const [dx, dy] = NEIGHBOUR[p.port.face];
            if ((dx + dy > 0) !== toward) continue;
            const open = !g.mainEnd[idx(g, p.x, p.y)];
            nozzle(m, scale, p.x, p.y, levelAt(g, p.x, p.y), dx, dy, TUBE_R, PORT_COLOUR[p.port.fluid], STEEL, sides, open);
          }
        };
        port(false);
        for (const i of list) tubeCell(m, g, i, scale, d);
        port(true);
        if (m.ni) {
          const mesh = pipeDrawable(m);
          bands.pavedOf[band].addChild(mesh);
          meshes.set(band, mesh);
        }
        // The water's Graphics last in the band, over all its tubes — IN A RENDER GROUP OF
        // ITS OWN: redrawn every frame the water moves, which in the chunk's group rebuilt the
        // draw list of every tile and building in the chunk, every frame. @see BandLayer.dynamicOf
        if (!list.length) continue;
        const own = new Container({ isRenderGroup: true });
        own.eventMode = "none";
        const gfx = new Graphics();
        own.addChild(gfx);
        bands.pavedOf[band].addChild(own);
        water.set(band, gfx);
      }
    },
    tick(g, scale, now, preview, ok = true, overlayOn = false, hover = null) {
      flow.clear();
      for (const gfx of wet) gfx.clear();
      wet.clear();
      const t = now / 1000;
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
      }
      const { list } = findMains(g);
      if (!list.length) return;
      const streaks = new Map<Graphics, [number, number, number, number][]>();
      /** And a sewer's slop in its glass: the band, and the lumps in it. */
      const slopBands = new Map<Graphics, [number, number, number, number][]>();
      const lumps = new Map<Graphics, [number, number][]>();
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
        // THE WATER, seen through each glass section: streaks running downstream
        // at the main's speed while it flows, standing still in a full one,
        // nothing in a dry one. @see isGlass
        // A sewer shows its slop only while some moves. @see solveSewer
        if ((state === "flowing" || state === "full") && r && (!net.sewer || r.flow > 0)) {
          const speed = state === "flowing" ? 0.35 + Math.min(2, r.flow) * 0.6 : 0;
          for (const i of net.cells) {
            const x = i % g.w, y = (i / g.w) | 0;
            if (!isGlass(g, x, y)) continue;
            const gfx = water.get(x + y);
            if (!gfx) continue;
            // Downstream: toward the neighbour further from the intake.
            const d = dist.get(i) ?? 0;
            let dir: [number, number] = [0, 0];
            for (const side of SIDES) {
              if (!joined(g, x, y, side)) continue;
              const [dx, dy] = NEIGHBOUR[side];
              if ((dist.get(idx(g, x + dx, y + dy)) ?? 0) > d) dir = [dx, dy];
            }
            const z = levelAt(g, x, y), half = GLASS * 0.5;
            const at = (k: number) => P(scale, x + dir[0] * k, y + dir[1] * k, z);
            // The water itself, a band along the glass; then the streaks moving in it.
            const a0 = at(-half), a1 = at(half);
            wet.add(gfx);
            // A SEWER'S SLOP: a brown band, and lumps sliding slowly down it.
            if (net.sewer) {
              const band = slopBands.get(gfx) ?? [];
              band.push([a0[0], a0[1] + w * 0.04, a1[0], a1[1] + w * 0.04]);
              slopBands.set(gfx, band);
              const go = (0.12 + Math.min(1, r.flow) * 0.25) * t;
              for (let k = 0; k < 2; k++) {
                const ph = (((go + k / 2) % 1) + 1) % 1, p = at(-half + ph * 2 * half);
                const at0 = lumps.get(gfx) ?? [];
                at0.push([p[0], p[1] - w * 0.02]);
                lumps.set(gfx, at0);
              }
              continue;
            }
            gfx.moveTo(a0[0], a0[1] + w * 0.04).lineTo(a1[0], a1[1] + w * 0.04);
            if (speed > 0) {
              for (let k = 0; k < 3; k++) {
                const ph = (((t * speed + k / 3) % 1) + 1) % 1;
                const p0 = at(-half + ph * 2 * half * 0.85), p1 = at(-half + Math.min(1, ph * 0.85 + 0.15) * 2 * half);
                const list = streaks.get(gfx) ?? [];
                list.push([p0[0], p0[1] - w * 0.06, p1[0], p1[1] - w * 0.06]);
                streaks.set(gfx, list);
              }
            }
          }
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
              const z = levelAt(g, x, y);
              const tip = P(scale, x + dx * 0.22, y + dy * 0.22, z), l = P(scale, x + dx * 0.06 - dy * 0.08, y + dy * 0.06 + dx * 0.08, z), rr = P(scale, x + dx * 0.06 + dy * 0.08, y + dy * 0.06 - dx * 0.08, z);
              const lift = ow * 0.45;
              flow.moveTo(l[0], l[1] - lift).lineTo(tip[0], tip[1] - lift).lineTo(rr[0], rr[1] - lift);
              flow.stroke({ color: 0xffffff, width: Math.max(1, ow * 0.12), alpha: 0.9, join: "round", cap: "round" });
            }
          }
        }
        if (state && state !== "flowing" && state !== "full") {
          // CANNOT DELIVER: a pulsing warning at each intake — or at its far end, with none.
          const at = net.intakes.length ? net.intakes : [net.cells[0]];
          const pulse = 0.55 + 0.45 * Math.sin(t * 4);
          for (const i of at) {
            const x = i % g.w, y = (i / g.w) | 0;
            // Floated over the fitting: a pump house stands tall at an intake.
            const c = P(scale, x, y, Math.max(levelAt(g, x, y), ground(g, x, y) + 3.4));
            flow.circle(c[0], c[1] - ow * 2.4, ow * 0.9);
            flow.fill({ color: WARN, alpha: pulse });
            flow.rect(c[0] - ow * 0.12, c[1] - ow * 2.9, ow * 0.24, ow * 0.6);
            flow.fill({ color: 0x1a1a1a, alpha: pulse });
          }
        }
      }
      for (const gfx of wet) {
        gfx.stroke({ color: WATER, width: Math.max(0.8, w * 0.62), cap: "butt", alpha: 0.85 });
        // The streaks, light on the water, over it in the same band.
        const list = streaks.get(gfx);
        if (list) {
          for (const [ax, ay, bx, by] of list) gfx.moveTo(ax, ay).lineTo(bx, by);
          gfx.stroke({ color: 0xffffff, width: Math.max(0.5, w * 0.16), cap: "round", alpha: 0.9 });
        }
        const band = slopBands.get(gfx);
        if (!band) continue;
        for (const [ax, ay, bx, by] of band) gfx.moveTo(ax, ay).lineTo(bx, by);
        gfx.stroke({ color: SLOP_IN, width: Math.max(0.8, w * 0.7), cap: "butt", alpha: 0.9 });
        for (const [x, y] of lumps.get(gfx) ?? []) gfx.circle(x, y, Math.max(0.5, w * 0.16));
        gfx.fill({ color: SLOP_LUMP });
      }
    },
    destroy() {
      clear();
      flow.parent?.removeChild(flow);
      flow.destroy();
      words.parent?.removeChild(words);
      words.destroy({ children: true });
    },
  };
}


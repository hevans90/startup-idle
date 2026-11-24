/**
 * World v2 — THE BAKED VEHICLES, in the game: the sheet `bun run bake:cars`
 * wrote, as textures, and which model each mover is. @see dev/bake-cars.ts
 *
 * A vehicle drawn from the sheet is two sprites, the paint tinted its colour
 * and the trim over it, at the frame for its heading. On a ramp the pair is
 * sheared so its nose rises by the pitch, rather than baked again for every
 * slope. `?cars=boxes` keeps the old box cars. @see town-render
 */
import "../../render/ktx";
import { Assets, Matrix, Rectangle, Texture, type TextureSource } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../../iso";
import { TILES_PER_M } from "./models";
import { CAR_GAP, type CarFrame, type CarSheet } from "./sheet-format";

const BASE = "/isometric_assets/derived";

/** A run of frames, one a heading. */
export type CarPoses = {
  paint: Texture[];
  trim: Texture[];
  /** Each heading's anchor in each layer: the vehicle's middle at the road, as a share of the layer. */
  paintAnchor: { x: number; y: number }[];
  trimAnchor: { x: number; y: number }[];
  /** Each heading's lamps' masks, in `LAMPS` order, and their anchors; an empty texture where there is none. @see raster LAMPS */
  lamps: { tex: Texture; anchor: { x: number; y: number } }[][];
  /** Each heading's layers that are drawn OVER whoever is in it — its paint's, then its trim's — and their anchors; empty textures where nobody could be seen. @see raster BakeOpts.over */
  over: { tex: Texture; anchor: { x: number; y: number } }[][];
};
export type CarLook = CarPoses & {
  id: string;
  /** Length and width, tiles. */
  length: number;
  width: number;
  /** Leant on a slope: a run for each pitch baked, a frame for each of a road's four ways. @see sheet-format CAR_PITCHES */
  tilted: CarPoses[];
};
export type CarSprites = { res: number; headings: number; pitches: number[]; pitchHeadings: number; looks: Map<string, CarLook> };

/** Whether vehicles come from the baked sheet: in a browser, unless `?cars=boxes`. */
export const bakedCars = () =>
  typeof document !== "undefined" && !(typeof location !== "undefined" && /[?&]cars=boxes\b/.test(location.search));

/** Each page's picture once it is in, and the frames cut from it before it was. @see loadCarSprites */
const pageNow: (TextureSource | undefined)[] = [];
const waiting: (Texture[] | undefined)[] = [];
/** The pages' files, the ones asked for, and those still to be fetched, in the order asked. */
let pageNames: readonly string[] = [];
const asked = new Set<number>();
const queue: number[] = [];
let fetchingNow = 0;
/** How many pages are fetched at a time. */
const PAGES_AT_ONCE = 3;
/** Fetch the next of the pages asked for, a few at a time; each handed to the frames waiting for it as it comes. */
function pump(): void {
  while (fetchingNow < PAGES_AT_ONCE && queue.length) {
    const i = queue.shift()!;
    fetchingNow++;
    void (async () => {
      try {
        const tex: Texture = await Assets.load({ src: `${BASE}/${pageNames[i]}`, data: { autoGenerateMipmaps: true, scaleMode: "linear" } });
        pageNow[i] = tex.source;
        for (const t of waiting[i] ?? []) { t.source = tex.source; t.update(); }
        waiting[i] = undefined;
      } catch (e) { console.warn(`cars: page ${pageNames[i]} would not load`, e); }
      fetchingNow--;
      pump();
    })();
  }
}
// (In development: `__carPages()` says which pages have been asked for, and which are in.)
if (import.meta.env?.DEV && typeof window !== "undefined") (window as unknown as { __carPages?: () => unknown }).__carPages = () => ({ of: pageNames.length, asked: [...asked].sort((a, b) => a - b), come: pageNow.map((p, i) => (p ? i : -1)).filter((i) => i >= 0) });
/** Ask for pages: each once. */
function wantPages(pages: readonly number[]): void {
  for (const i of pages) if (!asked.has(i)) { asked.add(i); queue.push(i); }
  pump();
}

/**
 * The looks by model — and A MODEL'S PAGES ASKED FOR WHEN IT IS FIRST LOOKED UP, not before: the sheet is baked a
 * model to a page or two, the works' plant and the buses are most of its twenty-six, and a town of cars was
 * fetching every one of them. @see dev/bake-cars.ts
 */
class Looks extends Map<string, CarLook> {
  readonly pagesOf = new Map<string, number[]>();
  override get(id: string): CarLook | undefined {
    const look = super.get(id);
    if (look) { const pages = this.pagesOf.get(id); if (pages) { this.pagesOf.delete(id); wantPages(pages); } }
    return look;
  }
}

/** Load the sheet and cut its frames. */
export async function loadCarSprites(): Promise<CarSprites> {
  const sheet: CarSheet = await Assets.load({ src: `${BASE}/cars.json`, loadParser: "loadJson" });
  // ITS PAGES AS THEY ARE WANTED, and not all of them before a vehicle is seen: there are twenty-six, tens of
  // megabytes. A frame is cut at once from an empty picture and given its page when that is in.
  const pages = sheet.pages.map((_p, i) => ({ get source() { return pageNow[i] ?? Texture.EMPTY.source; } }));
  /** A frame of a page: drawn from the page once it has come. */
  const frameOf = (page: number, rect: Rectangle) => {
    const t = new Texture({ source: pages[page].source, frame: rect, dynamic: true });
    if (!pageNow[page]) (waiting[page] ??= []).push(t);
    used.add(page);
    return t;
  };
  pageNames = sheet.pages;
  /** The pages the frames being cut have named so far: gathered a model at a time. */
  let used = new Set<number>();
  const looks = new Looks();
  /** A run of frames cut from the pages: each layer's texture and anchor, and its lamps. */
  const cut = (frames: CarFrame[]): CarPoses => {
    const paint: Texture[] = [], trim: Texture[] = [], paintAnchor: { x: number; y: number }[] = [], trimAnchor: typeof paintAnchor = [];
    const lamps: CarPoses["lamps"] = [], over: CarPoses["over"] = [], nOver = sheet.over ?? 0;
    for (const [page, x, y, pw, ph, pox, poy, tw, th, tox, toy, ...ls] of frames) {
      const mine: CarPoses["lamps"][number] = [];
      for (let k = 0; k + 6 < ls.length; k += 7) {
        const [lp, lx, ly, lw, lh, lox, loy] = ls.slice(k, k + 7);
        mine.push(lw ? { tex: frameOf(lp, new Rectangle(lx, ly, lw, lh)), anchor: { x: lox / lw, y: loy / lh } } : { tex: Texture.EMPTY, anchor: { x: 0, y: 0 } });
      }
      // (The last of them are not lamps: the layers over its occupants.)
      over.push(nOver ? mine.splice(mine.length - nOver, nOver) : []);
      lamps.push(mine);
      // A livery has no paint: an empty texture, so the paint sprite draws nothing.
      paint.push(pw ? frameOf(page, new Rectangle(x, y, pw, ph)) : Texture.EMPTY);
      trim.push(frameOf(page, new Rectangle(x + pw + CAR_GAP, y, tw, th)));
      paintAnchor.push(pw ? { x: pox / pw, y: poy / ph } : { x: 0, y: 0 });
      trimAnchor.push({ x: tox / tw, y: toy / th });
    }
    return { paint, trim, paintAnchor, trimAnchor, lamps, over };
  };
  for (const [id, m] of Object.entries(sheet.models)) {
    used = new Set<number>();
    looks.set(id, { id, length: m.length * TILES_PER_M, width: m.width * TILES_PER_M, ...cut(m.frames), tilted: (m.tilted ?? []).map(cut) });
    looks.pagesOf.set(id, [...used]);
  }
  return { res: sheet.res, headings: sheet.headings, pitches: sheet.pitches ?? [], pitchHeadings: sheet.pitchHeadings ?? 0, looks };
}

/**
 * WHICH FRAME A VEHICLE IS DRAWN FROM, at heading `h` (of the sheet's) on a slope of `pitch` half steps a tile.
 * Level, its heading's own. On a slope, heading one of a road's four ways or within a frame's turn of one — it
 * changes lane on a ramp without being drawn askew — the frame baked nearest its pitch, leant as it stands; and
 * `shear`, what is left of the pitch, for the pair to be sheared by: the little between two baked pitches as it
 * comes onto a ramp. Any other heading on a slope is its level frame sheared the whole way.
 */
export function poseOf(sheet: Pick<CarSprites, "headings" | "pitches" | "pitchHeadings">, look: CarLook, h: number, pitch: number):
  { from: CarPoses; k: number; heading: number; lean: number; shear: number; key: string } {
  const level = { from: look as CarPoses, k: h, heading: (h / sheet.headings) * Math.PI * 2, lean: 0, shear: pitch, key: `${h}` };
  const n = sheet.pitchHeadings, every = n ? sheet.headings / n : 0;
  if (!n || !look.tilted.length || Math.abs(pitch) < 0.5) return level;
  const k = Math.round(h / every), off = Math.abs(h - k * every);
  if (off > 1) return level;
  let best = 0;
  sheet.pitches.forEach((q, i) => { if (Math.abs(q - pitch) < Math.abs(sheet.pitches[best] - pitch)) best = i; });
  if (Math.abs(sheet.pitches[best] - pitch) > Math.abs(pitch)) return level;
  const kk = ((k % n) + n) % n;
  return { from: look.tilted[best], k: kk, heading: (kk / n) * Math.PI * 2, lean: sheet.pitches[best], shear: pitch - sheet.pitches[best], key: `t${best}.${kk}` };
}

export { modelFor } from "./fleet";

/** The frame for a heading, of `n` round the turn. */
export const headingIndex = (heading: number, n: number) => {
  const step = (Math.PI * 2) / n;
  return ((Math.round(heading / step) % n) + n) % n;
};

/** The base's corners, tiles from its middle: what decides its band, as the box cars' were. */
export function baseCorners(look: Pick<CarLook, "length" | "width">, heading: number): { u: number; v: number }[] {
  const ch = Math.cos(heading), sh = Math.sin(heading), l = look.length / 2, w = look.width / 2;
  return [[l, w], [l, -w], [-l, w], [-l, -w]].map(([a, b]) => ({ u: a * ch - b * sh, v: a * sh + b * ch }));
}

/**
 * A level frame tilted to a pitch: `pitch` half steps a tile along the
 * heading. Points along the heading rise with it and points across it stay,
 * so the shear maps the screen's along-vector A to A lifted, and keeps its
 * across-vector B. Null when level. The map's scale cancels: A, B and the
 * lift all grow with it.
 */
export function pitchMatrix(heading: number, pitch: number): Matrix | null {
  if (!pitch) return null;
  const ch = Math.cos(heading), sh = Math.sin(heading);
  const Ax = (ch - sh) * HW, Ay = (ch + sh) * HH;
  const Bx = (-sh - ch) * HW, By = (-sh + ch) * HH;
  const det = Ax * By - Ay * Bx;
  const bx = By / det, by = -Bx / det;
  // A tile along the heading rises `pitch` half steps: up the screen by this much.
  const lift = -pitch * HEIGHT_UNIT;
  // x' = x; y' = y + lift·(β·(x, y)), where β·A = 1 and β·B = 0.
  return new Matrix(1, lift * bx, 0, 1 + lift * by, 0, 0);
}

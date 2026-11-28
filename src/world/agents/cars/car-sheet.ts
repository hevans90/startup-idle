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
import { keepOnGpuOnly } from "../../render/sheet-copies";
import { Assets, Matrix, Rectangle, Texture, type TextureSource } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../../iso";
import { TILES_PER_M } from "./models";
import { CAR_GAP, type CarFrame, type CarSheet } from "./sheet-format";

const BASE = "/isometric_assets/derived";

/** A layer's picture, and its anchor: the vehicle's middle at the road, as a share of the layer. */
export type CarLayer = { tex: Texture; anchor: { x: number; y: number } };
/** A vehicle at one heading. */
export type CarPose = {
  paint: CarLayer;
  trim: CarLayer;
  /** Its lamps' masks, in `LAMPS` order; an empty texture where there is none. @see raster LAMPS */
  lamps: CarLayer[];
  /** Its layers that are drawn OVER whoever is in it — its paint's, then its trim's; empty textures where nobody could be seen. @see raster BakeOpts.over */
  over: CarLayer[];
  /** The snow that lies on it: an empty texture where the sheet has none. @see raster bakeSnowFrame */
  snow: CarLayer;
};
/** A run of frames, one a heading: each cut when it is first asked for. */
export type CarPoses = { at: (heading: number) => CarPose };
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
        keepOnGpuOnly(tex.source);
        // (And they are watched no longer: a sprite destroyed does not stop listening to its texture, so a frame kept would keep it.)
        for (const t of waiting[i] ?? []) { t.source = tex.source; t.update(); t.dynamic = false; t.removeAllListeners("update"); }
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

/** What a layer with nothing in it is drawn as. */
const NONE: CarLayer = { tex: Texture.EMPTY, anchor: { x: 0, y: 0 } };
/** A frame of a page, cut from an empty picture and given its page when that is in — watched by its sprites until then. */
function layer(page: number, x: number, y: number, w: number, h: number, ox: number, oy: number): CarLayer {
  if (!w) return NONE;
  const source = pageNow[page];
  const tex = new Texture({ source: source ?? Texture.EMPTY.source, frame: new Rectangle(x, y, w, h), dynamic: !source });
  if (!source) (waiting[page] ??= []).push(tex);
  return { tex, anchor: { x: ox / w, y: oy / h } };
}
/** One frame, cut: its paint (none, of a livery), its trim right of it, and its lamps — the last `over` of them its layers over its occupants. */
function cutFrame([page, x, y, pw, ph, pox, poy, tw, th, tox, toy, ...ls]: CarFrame, over: number, snow = 0): CarPose {
  const lamps: CarLayer[] = [];
  for (let k = 0; k + 6 < ls.length; k += 7) lamps.push(layer(ls[k], ls[k + 1], ls[k + 2], ls[k + 3], ls[k + 4], ls[k + 5], ls[k + 6]));
  // (From the end: the snow, and before it the layers over the occupants.)
  const lying = snow ? lamps.splice(lamps.length - snow, snow)[0] : NONE;
  return {
    snow: lying,
    paint: layer(page, x, y, pw, ph, pox, poy), trim: layer(page, x + pw + CAR_GAP, y, tw, th, tox, toy),
    over: over ? lamps.splice(lamps.length - over, over) : [], lamps,
  };
}
/**
 * A run of frames, EACH CUT WHEN IT IS FIRST ASKED FOR: there are some twenty-three thousand pictures in the sheet,
 * and a town draws a few hundred of them.
 */
export function cutRun(frames: readonly CarFrame[], over: number, snow = 0): CarPoses {
  const cut: CarPose[] = [];
  return { at: (k) => (cut[k] ??= cutFrame(frames[k], over, snow)) };
}
/** The pages a model's frames are on. */
export function pagesOf(m: Pick<CarSheet["models"][string], "frames" | "tilted">): number[] {
  const pages = new Set<number>();
  for (const run of [m.frames, ...(m.tilted ?? [])]) for (const f of run) {
    pages.add(f[0]);
    for (let k = 11; k + 6 < f.length; k += 7) if (f[k + 3]) pages.add(f[k]);
  }
  return [...pages];
}

/**
 * The looks by model — and A MODEL'S PAGES ASKED FOR WHEN IT IS FIRST LOOKED UP, not before: the sheet is baked a
 * model to a page or two, the works' plant and the buses are most of its twenty-six, and a town of cars was
 * fetching every one of them. @see dev/bake-cars.ts
 */
class Looks extends Map<string, CarLook> {
  readonly unasked = new Map<string, CarSheet["models"][string]>();
  override get(id: string): CarLook | undefined {
    const m = this.unasked.get(id);
    if (m) { this.unasked.delete(id); wantPages(pagesOf(m)); }
    return super.get(id);
  }
}

async function load(): Promise<CarSprites> {
  const sheet: CarSheet = await Assets.load({ src: `${BASE}/cars.json`, loadParser: "loadJson" });
  pageNames = sheet.pages;
  const looks = new Looks(), over = sheet.over ?? 0, snow = sheet.snow ?? 0;
  for (const [id, m] of Object.entries(sheet.models)) {
    looks.set(id, { id, length: m.length * TILES_PER_M, width: m.width * TILES_PER_M, ...cutRun(m.frames, over, snow), tilted: (m.tilted ?? []).map((run) => cutRun(run, over, snow)) });
    looks.unasked.set(id, m);
  }
  return { res: sheet.res, headings: sheet.headings, pitches: sheet.pitches ?? [], pitchHeadings: sheet.pitchHeadings ?? 0, looks };
}
/** The sheet, loaded once for everything that draws a vehicle; asked for again if it would not load. */
let loading: Promise<CarSprites> | null = null;
export const loadCarSprites = (): Promise<CarSprites> => (loading ??= load().catch((e) => { loading = null; throw e; }));

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

/**
 * World v2 — THE BAKED VEHICLES, in the game: the sheet `bun run bake:cars`
 * wrote, as textures, and which model each mover is. @see dev/bake-cars.ts
 *
 * A vehicle drawn from the sheet is two sprites, the paint tinted its colour
 * and the trim over it, at the frame for its heading. On a ramp the pair is
 * sheared so its nose rises by the pitch, rather than baked again for every
 * slope. `?cars=boxes` keeps the old box cars. @see town-render
 */
import { Assets, Matrix, Rectangle, Texture } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../../iso";
import { TILES_PER_M } from "./models";
import { CAR_GAP, type CarSheet } from "./sheet-format";

const BASE = "/isometric_assets/derived";

export type CarLook = {
  id: string;
  /** Length and width, tiles. */
  length: number;
  width: number;
  paint: Texture[];
  trim: Texture[];
  /** Each heading's anchor in each layer: the vehicle's middle at the road, as a share of the layer. */
  paintAnchor: { x: number; y: number }[];
  trimAnchor: { x: number; y: number }[];
  /** Each heading's lamps' masks, in `LAMPS` order, and their anchors; an empty texture where there is none. @see raster LAMPS */
  lamps: { tex: Texture; anchor: { x: number; y: number } }[][];
};
export type CarSprites = { res: number; headings: number; looks: Map<string, CarLook> };

/** Whether vehicles come from the baked sheet: in a browser, unless `?cars=boxes`. */
export const bakedCars = () =>
  typeof document !== "undefined" && !(typeof location !== "undefined" && /[?&]cars=boxes\b/.test(location.search));

/** Load the sheet and cut its frames. */
export async function loadCarSprites(): Promise<CarSprites> {
  const sheet: CarSheet = await Assets.load({ src: `${BASE}/cars.json`, loadParser: "loadJson" });
  const pages: Texture[] = await Promise.all(sheet.pages.map((p) =>
    Assets.load({ src: `${BASE}/${p}`, data: { autoGenerateMipmaps: true, scaleMode: "linear" } })));
  const looks = new Map<string, CarLook>();
  for (const [id, m] of Object.entries(sheet.models)) {
    const paint: Texture[] = [], trim: Texture[] = [], paintAnchor: { x: number; y: number }[] = [], trimAnchor: typeof paintAnchor = [];
    const lamps: CarLook["lamps"] = [];
    for (const [page, x, y, pw, ph, pox, poy, tw, th, tox, toy, ...ls] of m.frames) {
      const mine: CarLook["lamps"][number] = [];
      for (let k = 0; k + 6 < ls.length; k += 7) {
        const [lp, lx, ly, lw, lh, lox, loy] = ls.slice(k, k + 7);
        mine.push(lw ? { tex: new Texture({ source: pages[lp].source, frame: new Rectangle(lx, ly, lw, lh) }), anchor: { x: lox / lw, y: loy / lh } } : { tex: Texture.EMPTY, anchor: { x: 0, y: 0 } });
      }
      lamps.push(mine);
      const source = pages[page].source;
      // A livery has no paint: an empty texture, so the paint sprite draws nothing.
      paint.push(pw ? new Texture({ source, frame: new Rectangle(x, y, pw, ph) }) : Texture.EMPTY);
      trim.push(new Texture({ source, frame: new Rectangle(x + pw + CAR_GAP, y, tw, th) }));
      paintAnchor.push(pw ? { x: pox / pw, y: poy / ph } : { x: 0, y: 0 });
      trimAnchor.push({ x: tox / tw, y: toy / th });
    }
    looks.set(id, { id, length: m.length * TILES_PER_M, width: m.width * TILES_PER_M, paint, trim, paintAnchor, trimAnchor, lamps });
  }
  return { res: sheet.res, headings: sheet.headings, looks };
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

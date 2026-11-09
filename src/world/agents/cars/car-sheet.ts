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
import { VAN_COLOUR, type Mover } from "../town";
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
  /** Each heading's anchor: the vehicle's middle at the road, as a share of the frame. */
  anchor: { x: number; y: number }[];
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
    const paint: Texture[] = [], trim: Texture[] = [], anchor: { x: number; y: number }[] = [];
    for (const [page, x, y, w, h, ox, oy] of m.frames) {
      const source = pages[page].source;
      paint.push(new Texture({ source, frame: new Rectangle(x, y, w, h) }));
      trim.push(new Texture({ source, frame: new Rectangle(x + w + CAR_GAP, y, w, h) }));
      anchor.push({ x: ox / w, y: oy / h });
    }
    looks.set(id, { id, length: m.length * TILES_PER_M, width: m.width * TILES_PER_M, paint, trim, anchor });
  }
  return { res: sheet.res, headings: sheet.headings, looks };
}

/** One of a list, the same for the same mover always. */
const ofId = <T>(id: number, salt: number, list: readonly T[]) =>
  list[Math.abs(Math.imul(id ^ salt, 0x9e3779b1) >>> 7) % list.length];

/** Which baked model a mover is drawn as, or null for one the sheet has no model of yet. */
export function modelFor(m: Pick<Mover, "id" | "kind" | "colour">): string | null {
  if (m.kind === "car") return ofId(m.id, 0x51ed, ["hatchback", "hatchback", "saloon"]);
  if (m.kind === "truck" && m.colour === VAN_COLOUR) return "panelVan";
  return null;
}

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

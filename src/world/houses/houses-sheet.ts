/**
 * World v2 — THE BAKED HOUSES, in the game: the sheet `bun run bake:houses`
 * wrote, cut into frames. A house is a stack of parts — its ground floor,
 * a floor for each storey it has risen, its roof — each two sprites, the
 * walls tinted and the rest over them. @see dev/bake-houses.ts
 */
import { Assets, Rectangle, Texture } from "pixi.js";

import { HALF_STEPS_PER_M } from "../agents/cars/models";
import { HEIGHT_UNIT } from "../iso";
import { HOUSE_GAP, type HouseFrame, type HousesSheet } from "./houses-format";
import { houseOf } from "./models";

const BASE = "/isometric_assets/derived";

/** A part's layers: each a texture and its anchor, the middle of the plot at the ground. */
export type HousePart = { tex: Texture[]; anchor: { x: number; y: number }[] };
export type HouseLook = { ground: HousePart; mids: HousePart[]; roof: HousePart; snow?: HousePart };
export type HouseSprites = { res: number; kits: Map<string, HouseLook> };

export async function loadHouseSprites(): Promise<HouseSprites> {
  const sheet: HousesSheet = await Assets.load({ src: `${BASE}/houses.json`, loadParser: "loadJson" });
  const pages: Texture[] = await Promise.all(sheet.pages.map((p) =>
    Assets.load({ src: `${BASE}/${p}`, data: { autoGenerateMipmaps: true, scaleMode: "linear" } })));
  const cut = (f: HouseFrame): HousePart => {
    const source = pages[f[0]].source, tex: Texture[] = [], anchor: HousePart["anchor"] = [];
    let x = f[1];
    for (let k = 0; k < sheet.layers; k++) {
      const [w, h, ox, oy] = f.slice(3 + k * 4, 7 + k * 4);
      tex.push(w ? new Texture({ source, frame: new Rectangle(x, f[2], w, h) }) : Texture.EMPTY);
      anchor.push(w ? { x: ox / w, y: oy / h } : { x: 0, y: 0 });
      x += w + HOUSE_GAP;
    }
    return { tex, anchor };
  };
  const kits: HouseSprites["kits"] = new Map();
  for (const [id, k] of Object.entries(sheet.kits)) kits.set(id, { ground: cut(k.ground), mids: k.mids.map(cut), roof: cut(k.roof), ...(k.snow ? { snow: cut(k.snow) } : {}) });
  return { res: sheet.res, kits };
}

let loading: Promise<HouseSprites | null> | null = null;
let loaded: HouseSprites | null = null;
/** The sheet, loaded once; null if it could not be. */
export const houseSprites = () => (loading ??= loadHouseSprites().then((p) => (loaded = p)).catch(() => null));
/** The sheet if it is in yet, else null. */
export const housesLoaded = () => loaded;

/** A sheet put in by hand: for tests, which have no page to load one from. */
export const setHouseSprites = (h: HouseSprites | null) => { loaded = h; };

/** One sprite to draw: its texture, its anchor, how far up the stack it is lifted (px at scale 1), and whether it is the tinted walls. */
export type HousePiece = { tex: Texture; anchor: { x: number; y: number }; lift: number; walls: boolean; snow?: boolean };

/**
 * A house of `floors` storeys as the sprites to draw, lowest first: the
 * ground floor, a floor for each storey over it (which of the kit's, by
 * `seed`, so a street of one kit is not a street of one house), the roof, and the snow that lies on it.
 */
export function housePieces(look: HouseLook, kit: string, floors: number, seed: number): HousePiece[] {
  const storey = (houseOf(kit)?.storey ?? 0) * HALF_STEPS_PER_M * HEIGHT_UNIT;
  const out: HousePiece[] = [];
  const add = (p: HousePart, lift: number) => p.tex.forEach((tex, k) => { if (tex !== Texture.EMPTY) out.push({ tex, anchor: p.anchor[k], lift, walls: k === 0 }); });
  add(look.ground, 0);
  const n = look.mids.length ? Math.max(1, floors) : 1;
  for (let f = 1; f < n; f++) add(look.mids[(seed + f) % look.mids.length], (f - 1) * storey);
  add(look.roof, (n - 1) * storey);
  // (The snow alone is its second layer.)
  const snow = look.snow?.tex[1];
  if (snow && snow !== Texture.EMPTY) out.push({ tex: snow, anchor: look.snow!.anchor[1], lift: (n - 1) * storey, walls: false, snow: true });
  return out;
}

/** What a building's walls are tinted: one of its kit's, by its id. */
export function houseTint(kit: string, seed: number): number {
  const t = houseOf(kit)?.tints;
  return t?.length ? t[((seed * 2654435761) >>> 0) % t.length] : 0xffffff;
}

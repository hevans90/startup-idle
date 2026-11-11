/**
 * World v2 — THE BAKED FLEET, in the game: the sheet `bun run bake:boats`
 * wrote, cut into frames. A hull is its paint, tinted its line's livery, the
 * rest over it, and three masks of its lights for the night, at the frame for
 * its heading. `?boats=drawn` keeps the old drawn boat. @see dev/bake-boats.ts
 */
import { Assets, Rectangle, Texture } from "pixi.js";

import { BOAT_GAP, type BoatFrame, type BoatsSheet } from "./boats-format";

const BASE = "/isometric_assets/derived";

/** A frame's parts — the layers, then the marks — each a texture and its anchor: the hull's middle at the waterline. */
export type BoatLook = { tex: Texture[]; anchor: { x: number; y: number }[] };
export type BoatSprites = { res: number; headings: number; layers: number; marks: number; boats: Map<string, BoatLook[]> };

export async function loadBoatSprites(): Promise<BoatSprites> {
  const sheet: BoatsSheet = await Assets.load({ src: `${BASE}/boats.json`, loadParser: "loadJson" });
  const pages: Texture[] = await Promise.all(sheet.pages.map((p) =>
    Assets.load({ src: `${BASE}/${p}`, data: { autoGenerateMipmaps: true, scaleMode: "linear" } })));
  const cut = (f: BoatFrame): BoatLook => {
    const source = pages[f[0]].source, tex: Texture[] = [], anchor: BoatLook["anchor"] = [];
    let x = f[1];
    for (let k = 0; k < sheet.layers + sheet.marks; k++) {
      const [w, h, ox, oy] = f.slice(3 + k * 4, 7 + k * 4);
      tex.push(w ? new Texture({ source, frame: new Rectangle(x, f[2], w, h) }) : Texture.EMPTY);
      anchor.push(w ? { x: ox / w, y: oy / h } : { x: 0, y: 0 });
      x += w + BOAT_GAP;
    }
    return { tex, anchor };
  };
  const boats: BoatSprites["boats"] = new Map();
  for (const [id, frames] of Object.entries(sheet.boats)) boats.set(id, frames.map(cut));
  return { res: sheet.res, headings: sheet.headings, layers: sheet.layers, marks: sheet.marks, boats };
}

let loading: Promise<BoatSprites | null> | null = null;
let loaded: BoatSprites | null = null;
/** Start the sheet loading, once. A sheet that will not load leaves the drawn boats. */
export const boatSprites = () => (loading ??= loadBoatSprites().then((p) => (loaded = p)).catch(() => null));
/** The sheet if it is in yet, else null. */
export const boatsLoaded = () => loaded;

/** Whether boats come from the baked sheet: in a browser, unless `?boats=drawn`. */
export const bakedBoats = () =>
  typeof document !== "undefined" && !(typeof location !== "undefined" && /[?&]boats=drawn\b/.test(location.search));

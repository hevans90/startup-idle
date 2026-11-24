/**
 * World v2 — THE BAKED LANDMARKS, in the game: the sheet `bun run
 * bake:landmarks` wrote. A building is a sprite for each tile of its plot —
 * that tile's share of it, cut out of one picture — so each is filed in its
 * own tile's band and whatever stands beside any part of the building is in
 * front of or behind that part as it should be. @see dev/bake-landmarks.ts
 */
import { sceneryLoad } from "../load-progress";
import "../render/ktx";
import { Assets, Rectangle, Texture } from "pixi.js";

import type { LandmarkPiece, LandmarksSheet } from "./landmarks-format";

const BASE = "/isometric_assets/derived";

/** A tile's share: its texture and its anchor, the middle of the plot at the ground. Null where the tile shows nothing. */
export type LandmarkTile = { tex: Texture; anchor: { x: number; y: number } } | null;
export type LandmarkLook = { w: number; h: number; tiles: LandmarkTile[]; over: LandmarkTile[]; snow: LandmarkTile[]; snowOver: LandmarkTile[] };
export type LandmarkSprites = { res: number; snowRes: number; marks: Map<string, LandmarkLook> };

export async function loadLandmarkSprites(): Promise<LandmarkSprites> {
  const sheet: LandmarksSheet = await Assets.load({ src: `${BASE}/landmarks.json`, loadParser: "loadJson" });
  const pages: Texture[] = await Promise.all(sheet.pages.map((p) =>
    sceneryLoad(Assets.load({ src: `${BASE}/${p}`, data: { autoGenerateMipmaps: true, scaleMode: "linear" } }))));
  const cut = (t: LandmarkPiece): LandmarkTile => (t && t[3] > 0 ? { tex: new Texture({ source: pages[t[0]].source, frame: new Rectangle(t[1], t[2], t[3], t[4]) }), anchor: { x: t[5] / t[3], y: t[6] / t[4] } } : null);
  const marks: LandmarkSprites["marks"] = new Map();
  for (const [id, m] of Object.entries(sheet.marks)) {
    marks.set(id, {
      w: m.w, h: m.h,
      tiles: m.tiles.map(cut), over: (m.over ?? []).map(cut), snow: (m.snow ?? []).map(cut), snowOver: (m.snowOver ?? []).map(cut),
    });
  }
  return { res: sheet.res, snowRes: sheet.snowRes ?? sheet.res, marks };
}

let loading: Promise<LandmarkSprites | null> | null = null;
let loaded: LandmarkSprites | null = null;
/** The sheet, loaded once; null if it could not be. */
export const landmarkSprites = () => (loading ??= loadLandmarkSprites().then((p) => (loaded = p)).catch(() => null));
/** The sheet if it is in yet, else null. */
export const landmarksLoaded = () => loaded;
/** A sheet put in by hand: for tests, which have no page to load one from. */
export const setLandmarkSprites = (h: LandmarkSprites | null) => { loaded = h; };

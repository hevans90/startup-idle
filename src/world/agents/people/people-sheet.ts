/**
 * World v2 — THE BAKED PEOPLE, in the game: the sheet `bun run bake:people`
 * wrote, cut into frames. A person is five sprites, one a layer — skin,
 * bottoms, top and hair tinted, the rest as baked — at the frame for their
 * heading and their step. `?people=boxes` keeps the old drawn people.
 * @see dev/bake-people.ts, town-render
 */
import { Assets, Rectangle, Texture } from "pixi.js";

import { PERSON_GAP, type PeopleSheet, type PersonFrame } from "./people-format";

const BASE = "/isometric_assets/derived";

/** A frame's layers: each a texture and its anchor, the figure's feet. */
export type PersonLook = { tex: Texture[]; anchor: { x: number; y: number }[] };
export type PeopleSprites = {
  res: number; headings: number; strides: number;
  figures: Map<string, { walk: PersonLook[]; work?: PersonLook[] }>;
};

export const bakedPeople = () =>
  typeof document !== "undefined" && !(typeof location !== "undefined" && /[?&]people=boxes\b/.test(location.search));

export async function loadPeopleSprites(): Promise<PeopleSprites> {
  const sheet: PeopleSheet = await Assets.load({ src: `${BASE}/people.json`, loadParser: "loadJson" });
  const pages: Texture[] = await Promise.all(sheet.pages.map((p) =>
    Assets.load({ src: `${BASE}/${p}`, data: { autoGenerateMipmaps: true, scaleMode: "linear" } })));
  const cut = (f: PersonFrame): PersonLook => {
    const source = pages[f[0]].source, tex: Texture[] = [], anchor: PersonLook["anchor"] = [];
    let x = f[1];
    for (let k = 0; k < sheet.layers; k++) {
      const [w, h, ox, oy] = f.slice(3 + k * 4, 7 + k * 4);
      tex.push(w ? new Texture({ source, frame: new Rectangle(x, f[2], w, h) }) : Texture.EMPTY);
      anchor.push(w ? { x: ox / w, y: oy / h } : { x: 0, y: 0 });
      x += w + PERSON_GAP;
    }
    return { tex, anchor };
  };
  const figures: PeopleSprites["figures"] = new Map();
  for (const [id, f] of Object.entries(sheet.figures)) figures.set(id, { walk: f.walk.map(cut), work: f.work?.map(cut) });
  return { res: sheet.res, headings: sheet.headings, strides: sheet.strides, figures };
}

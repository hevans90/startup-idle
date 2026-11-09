/**
 * World v2 — THE BAKED PEOPLE, in the game: the sheet `bun run bake:people`
 * wrote, cut into frames. A person is five sprites, one a layer — skin,
 * bottoms, top and hair tinted, the rest as baked — at the frame for their
 * heading and their step. `?people=boxes` keeps the old drawn people.
 * @see dev/bake-people.ts, town-render
 */
import { Assets, Rectangle, Texture, type Sprite } from "pixi.js";

import { headingIndex } from "../cars/car-sheet";

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

/** The sheet, loaded once for the town and the building sites both. */
let loading: Promise<PeopleSprites> | null = null;
let loaded: PeopleSprites | null = null;
export const peopleSprites = () => (loading ??= loadPeopleSprites().then((p) => (loaded = p)));
/** The sheet if it is in yet, else null: whoever draws a person meanwhile draws the old one. */
export const peopleLoaded = () => loaded;

/**
 * Turn a person's five sprites to the frame for their heading and their step
 * — or their hammer's swing, at work — at the map's scale and their height.
 * Answers the frame's key, so a caller can skip it when nothing has changed.
 */
export function posePerson(
  parts: readonly Sprite[], P: PeopleSprites, figure: string, work: boolean,
  heading: number, phase: number, scale: number, height: number, was = "",
): string {
  const fig = P.figures.get(figure)!;
  const frames = work && fig.work ? fig.work : fig.walk;
  const h = headingIndex(heading, P.headings);
  const p = (((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
  const f = Math.round(p * P.strides) % P.strides;
  const key = `figure|${figure}|${frames === fig.work ? "w" : ""}|${h}|${f}|${scale}|${height}`;
  if (key === was) return key;
  const look = frames[h * P.strides + f], k = (scale / P.res) * height;
  look.tex.forEach((t, j) => { const sp = parts[j]; sp.texture = t; sp.anchor.set(look.anchor[j].x, look.anchor[j].y); sp.scale.set(k); });
  return key;
}

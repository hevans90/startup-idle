/**
 * World v2 — THE BAKED PEOPLE, in the game: the sheet `bun run bake:people`
 * wrote, cut into frames. A person is five sprites, one a layer — skin,
 * bottoms, top and hair tinted, the rest as baked — at the frame for their
 * heading and their step. `?people=boxes` keeps the old drawn people.
 * @see dev/bake-people.ts, town-render
 */
import "../../render/ktx";
import { keepOnGpuOnly } from "../../render/sheet-copies";
import { Assets, Rectangle, Texture, type Sprite, type TextureSource } from "pixi.js";

import { headingIndex } from "../cars/car-sheet";

import { PERSON_GAP, type FigureFrames, type FrameSet, type PeopleSheet, type PersonFrame } from "./people-format";

const BASE = "/isometric_assets/derived";

/** A frame's layers: each a texture and its anchor, the figure's feet. */
export type PersonLook = { tex: Texture[]; anchor: { x: number; y: number }[] };
/** A set of a figure's frames: each cut when it is first asked for. */
export type PersonLooks = { at: (frame: number) => PersonLook };
export type PeopleSprites = {
  res: number; headings: number; strides: number; runStrides: number; standFrames: number;
  figures: Map<string, Partial<Record<FrameSet, PersonLooks>> & { walk: PersonLooks }>;
};

export const bakedPeople = () =>
  typeof document !== "undefined" && !(typeof location !== "undefined" && /[?&]people=boxes\b/.test(location.search));

/** A frame's layers, right of one another in its page: an empty texture where it has none. */
function cutFrame(f: PersonFrame, layers: number, sources: readonly TextureSource[]): PersonLook {
  const source = sources[f[0]], tex: Texture[] = [], anchor: PersonLook["anchor"] = [];
  let x = f[1];
  for (let k = 0; k < layers; k++) {
    const w = f[3 + k * 4], h = f[4 + k * 4], ox = f[5 + k * 4], oy = f[6 + k * 4];
    tex.push(w ? new Texture({ source, frame: new Rectangle(x, f[2], w, h) }) : Texture.EMPTY);
    anchor.push(w ? { x: ox / w, y: oy / h } : { x: 0, y: 0 });
    x += w + PERSON_GAP;
  }
  return { tex, anchor };
}
/**
 * A set of frames, EACH CUT WHEN IT IS FIRST ASKED FOR: there are some forty thousand pictures in the sheet, most of
 * them steps nobody has taken in that direction.
 */
export function cutSet(frames: readonly PersonFrame[], layers: number, sources: readonly TextureSource[]): PersonLooks {
  const cut: PersonLook[] = [];
  return { at: (i) => (cut[i] ??= cutFrame(frames[i], layers, sources)) };
}

export async function loadPeopleSprites(): Promise<PeopleSprites> {
  const sheet: PeopleSheet = await Assets.load({ src: `${BASE}/people.json`, loadParser: "loadJson" });
  const pages: Texture[] = await Promise.all(sheet.pages.map((p) =>
    Assets.load({ src: `${BASE}/${p}`, data: { autoGenerateMipmaps: true, scaleMode: "linear" } })));
  for (const p of pages) keepOnGpuOnly(p.source);
  const sources = pages.map((p) => p.source);
  const figures: PeopleSprites["figures"] = new Map();
  for (const [id, f] of Object.entries(sheet.figures)) {
    const sets = Object.fromEntries(Object.entries(f as FigureFrames).map(([k, v]) => [k, cutSet(v as PersonFrame[], sheet.layers, sources)]));
    figures.set(id, sets as PeopleSprites["figures"] extends Map<string, infer V> ? V : never);
  }
  return { res: sheet.res, headings: sheet.headings, strides: sheet.strides, runStrides: sheet.runStrides, standFrames: sheet.standFrames, figures };
}

/** The sheet, loaded once for the town and the building sites both. */
let loading: Promise<PeopleSprites> | null = null;
let loaded: PeopleSprites | null = null;
export const peopleSprites = () => (loading ??= loadPeopleSprites().then((p) => (loaded = p)));
/** The sheet if it is in yet, else null: whoever draws a person meanwhile draws the old one. */
export const peopleLoaded = () => loaded;

/** How a figure is drawn: a set of its frames, its step or sway through them. Sets it has no frames for fall back. */
export type PoseSet = "walk" | "work" | "sit" | "ride" | "stand" | "run" | "hold" | "sniff";

/**
 * Turn a person's five sprites — or a dog's — to the frame for their heading
 * and their step, their hammer's swing, their sway, or sat down, at the map's
 * scale and their height. A set the figure has no frames for is drawn as
 * walking; stood, as the first frame of it.
 * Answers the frame's key, so a caller can skip it when nothing has changed.
 */
export function posePerson(
  parts: readonly Sprite[], P: PeopleSprites, figure: string, pose: PoseSet,
  heading: number, phase: number, scale: number, height: number, was = "",
): string {
  const fig = P.figures.get(figure)!;
  const h = headingIndex(heading, P.headings);
  const frames = fig[pose] ?? fig.walk, set = fig[pose] ? pose : "walk";
  const n = set === "sit" || set === "sniff" ? 1 : set === "stand" ? P.standFrames : set === "run" ? P.runStrides : P.strides;
  const p = (((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
  const f = pose === "stand" && set === "walk" ? 0 : Math.round(p * n) % n;
  const key = `figure|${figure}|${set}|${h}|${f}|${scale}|${height}`;
  if (key === was) return key;
  const look = frames.at(h * n + f), k = (scale / P.res) * height;
  look.tex.forEach((t, j) => { const sp = parts[j]; sp.texture = t; sp.anchor.set(look.anchor[j].x, look.anchor[j].y); sp.scale.set(k); });
  return key;
}

/**
 * World v2 — THE BAKED CRANES, in the game: the sheet `bun run bake:cranes`
 * wrote, cut into frames. A part is its steelwork's paint, tinted, the rest
 * over it, and a mask of its lights for the night, at the frame for the way
 * it faces. @see dev/bake-cranes.ts, models.ts
 */
import { Assets, Container, Rectangle, Sprite, Texture } from "pixi.js";

import { CRANE_GAP, type CraneFrame, type CranesSheet } from "./crane-format";

const BASE = "/isometric_assets/derived";

/** A frame's pieces — the layers, then the marks — each a texture and its anchor: the part's own origin. */
export type CraneLook = { tex: Texture[]; anchor: { x: number; y: number }[] };
export type CraneSprites = { res: number; layers: number; marks: number; parts: Map<string, CraneLook[]> };

export async function loadCraneSprites(): Promise<CraneSprites> {
  const sheet: CranesSheet = await Assets.load({ src: `${BASE}/cranes.json`, loadParser: "loadJson" });
  const pages: Texture[] = await Promise.all(sheet.pages.map((p) =>
    Assets.load({ src: `${BASE}/${p}`, data: { autoGenerateMipmaps: true, scaleMode: "linear" } })));
  const cut = (f: CraneFrame): CraneLook => {
    const source = pages[f[0]].source, tex: Texture[] = [], anchor: CraneLook["anchor"] = [];
    let x = f[1];
    for (let k = 0; k < sheet.layers + sheet.marks; k++) {
      const [w, h, ox, oy] = f.slice(3 + k * 4, 7 + k * 4);
      tex.push(w ? new Texture({ source, frame: new Rectangle(x, f[2], w, h) }) : Texture.EMPTY);
      anchor.push(w ? { x: ox / w, y: oy / h } : { x: 0, y: 0 });
      x += w + CRANE_GAP;
    }
    return { tex, anchor };
  };
  const parts: CraneSprites["parts"] = new Map();
  for (const [id, frames] of Object.entries(sheet.parts)) parts.set(id, frames.map(cut));
  return { res: sheet.res, layers: sheet.layers, marks: sheet.marks, parts };
}

let loading: Promise<CraneSprites | null> | null = null;
let loaded: CraneSprites | null = null;
/** Start the sheet loading, once. */
export const craneSprites = () => (loading ??= loadCraneSprites().then((p) => (loaded = p)).catch(() => null));
/** The sheet if it is in yet, else null. */
export const cranesLoaded = () => loaded;

/**
 * ONE PART ON THE MAP: a container of its sprites — paint, the rest, its
 * lights — made once, and after that only moved, turned to another frame,
 * tinted and faded.
 */
export type Piece = { c: Container; sp: Sprite[]; id: string; frame: number; lit: number };

export function makePiece(P: CraneSprites, parent: Container, id: string, frame: number, tint: number, scale: number): Piece {
  const c = new Container();
  c.eventMode = "none";
  const sp = Array.from({ length: P.layers + P.marks }, (_, k) => {
    const s = new Sprite();
    if (k === 0) s.tint = tint;
    if (k >= P.layers) { s.blendMode = "add"; s.tint = 0xffe2a8; s.alpha = 0; }
    c.addChild(s);
    return s;
  });
  c.scale.set(scale / P.res);
  parent.addChild(c);
  const piece: Piece = { c, sp, id, frame: -1, lit: 0 };
  framePiece(P, piece, frame);
  return piece;
}

/** Turn a part to another of its frames; nothing if it is there already. */
export function framePiece(P: CraneSprites, p: Piece, frame: number): void {
  if (p.frame === frame) return;
  const look = P.parts.get(p.id)?.[frame];
  if (!look) return;
  p.sp.forEach((s, k) => { s.texture = look.tex[k]; s.anchor.set(look.anchor[k].x, look.anchor[k].y); });
  p.frame = frame;
}

/** Light a part's lamps as it gets dark, 0–1. */
export function lightPiece(P: CraneSprites, p: Piece, lit: number): void {
  if (p.lit === lit) return;
  for (let k = P.layers; k < p.sp.length; k++) p.sp[k].alpha = lit;
  p.lit = lit;
}

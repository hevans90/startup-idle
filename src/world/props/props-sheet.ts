/**
 * World v2 — THE BAKED PROPS, in the game: the sheet `bun run bake:props`
 * wrote, cut into frames. A prop is two sprites, its leaves or cloth tinted
 * and the rest over them, at one of four turns. Loaded once for everything
 * that stands props about: the streets, the woods, the parks.
 * @see dev/bake-props.ts
 */
import { Assets, Container, Rectangle, Sprite, Texture } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../iso";
import { PROP_GAP, type PropFrame, type PropsSheet } from "./props-format";

const BASE = "/isometric_assets/derived";

/** A frame's layers: each a texture and its anchor, the prop's foot. */
export type PropLook = { tex: Texture[]; anchor: { x: number; y: number }[] };
export type PropSprites = { res: number; turns: number; props: Map<string, PropLook[]> };

export async function loadPropSprites(): Promise<PropSprites> {
  const sheet: PropsSheet = await Assets.load({ src: `${BASE}/props.json`, loadParser: "loadJson" });
  const pages: Texture[] = await Promise.all(sheet.pages.map((p) =>
    Assets.load({ src: `${BASE}/${p}`, data: { autoGenerateMipmaps: true, scaleMode: "linear" } })));
  const cut = (f: PropFrame): PropLook => {
    const source = pages[f[0]].source, tex: Texture[] = [], anchor: PropLook["anchor"] = [];
    let x = f[1];
    for (let k = 0; k < sheet.layers; k++) {
      const [w, h, ox, oy] = f.slice(3 + k * 4, 7 + k * 4);
      tex.push(w ? new Texture({ source, frame: new Rectangle(x, f[2], w, h) }) : Texture.EMPTY);
      anchor.push(w ? { x: ox / w, y: oy / h } : { x: 0, y: 0 });
      x += w + PROP_GAP;
    }
    return { tex, anchor };
  };
  const props: PropSprites["props"] = new Map();
  for (const [id, frames] of Object.entries(sheet.props)) props.set(id, frames.map(cut));
  return { res: sheet.res, turns: sheet.turns, props };
}

let loading: Promise<PropSprites> | null = null;
let loaded: PropSprites | null = null;
/** The sheet, loaded once. */
export const propSprites = () => (loading ??= loadPropSprites().then((p) => (loaded = p)));
/** The sheet if it is in yet, else null. */
export const propsLoaded = () => loaded;

/** Whether props come from the baked sheet: in a browser, unless `?props=drawn`. */
export const bakedProps = () =>
  typeof document !== "undefined" && !(typeof location !== "undefined" && /[?&]props=drawn\b/.test(location.search));

/** The turn of four nearest a heading. */
export const turnOf = (heading: number, turns = 4) => {
  const step = (Math.PI * 2) / turns;
  return ((Math.round(heading / step) % turns) + turns) % turns;
};

/**
 * A prop as a container of its two sprites, its foot at tile (`u`, `v`) and
 * `z` half steps up, at the map's `scale`; its first layer tinted `tint`,
 * `size` times as big as baked.
 */
export function propSprite(P: PropSprites, id: string, turn: number, u: number, v: number, z: number, scale: number, tint = 0xffffff, size = 1): Container | null {
  const look = P.props.get(id)?.[turn];
  if (!look) return null;
  const c = new Container();
  c.eventMode = "none";
  look.tex.forEach((t, k) => {
    const sp = new Sprite(t);
    sp.anchor.set(look.anchor[k].x, look.anchor[k].y);
    sp.scale.set((scale / P.res) * size);
    if (k === 0) sp.tint = tint;
    c.addChild(sp);
  });
  c.position.set((u - v) * HW * scale, (u + v) * HH * scale - z * HEIGHT_UNIT * scale);
  return c;
}

/**
 * THE HOUSES LIT BY THE SUN WHERE IT STANDS (the editor's slider), drawn ONCE A PIECE, not once a house: the sheet's
 * pages copied, each piece in it lit as the sun stands now — its +y wall left of its front corner, its +x wall right
 * of it, each by how it turns to the sun, darker by a tint, lighter by itself added — and every house on the map
 * drawn from the copy, one sprite a piece, as at home. A town's fifty thousand sprites split and tinted one by one
 * as the sun moved was the lag; now it is a few hundred pieces drawn into four pages. @see faceGain, tiles-renderer
 */
import { Container, Rectangle, RenderTexture, Sprite, Texture, type Renderer, type TextureSource } from "pixi.js";

import { TILES_PER_M } from "../agents/cars/models";
import { HW } from "../iso";
import { faceGain, sunRev } from "../light";
import type { HousePart, HouseSprites } from "./houses-sheet";
import { houseOf } from "./models";

/** A piece in the copy: its halves, each lit and with its added light (shown only where the wall is lit past its bake). */
type Half = { lit: Sprite; add: Sprite | null; wall: 0 | 1 | 2 };
type Copy = { of: HouseSprites; pages: Map<TextureSource, { rt: RenderTexture; scene: Container }>; byTex: Map<Texture, Texture>; halves: Half[]; at: number; when: number };
const RELIGHT_MS = 33;
let copy: Copy | null = null;

const gainOf = (wall: 0 | 1 | 2) => (wall === 0 ? faceGain(0, 1) : wall === 1 ? faceGain(1, 0) : (faceGain(0, 1) + faceGain(1, 0)) / 2);
const grey = (k: number) => { const c = Math.max(0, Math.min(255, Math.round(k * 255))); return (c << 16) | (c << 8) | c; };

function build(H: HouseSprites): Copy {
  const c: Copy = { of: H, pages: new Map(), byTex: new Map(), halves: [], at: -1, when: -Infinity };
  const put = (tex: Texture, ax: number, kit: string, snow: boolean) => {
    if (tex === Texture.EMPTY || c.byTex.has(tex)) return;
    const src = tex.source;
    let page = c.pages.get(src);
    if (!page) {
      page = { rt: RenderTexture.create({ width: src.width, height: src.height, resolution: src.resolution, antialias: false, autoGenerateMipmaps: true, scaleMode: "linear" }), scene: new Container() };
      c.pages.set(src, page);
    }
    const f = tex.frame;
    c.byTex.set(tex, new Texture({ source: page.rt.source, frame: new Rectangle(f.x, f.y, f.width, f.height) }));
    // CUT AT ITS FRONT CORNER: where its two walls meet, by its kit's house.
    const house = houseOf(kit), cut = Math.round(ax * f.width + (house ? (house.hx - house.hy) * TILES_PER_M * HW * H.res : 0));
    const parts: { frame: Rectangle; wall: 0 | 1 | 2 }[] = cut > 0 && cut < f.width
      ? [{ frame: new Rectangle(f.x, f.y, cut, f.height), wall: 0 }, { frame: new Rectangle(f.x + cut, f.y, f.width - cut, f.height), wall: 1 }]
      : [{ frame: new Rectangle(f.x, f.y, f.width, f.height), wall: 2 }];
    for (const p of parts) {
      const t = new Texture({ source: src, frame: p.frame });
      const at = (sp: Sprite) => { sp.position.set(p.frame.x, p.frame.y); page!.scene.addChild(sp); return sp; };
      const lit = at(new Sprite(t)), add = snow ? null : at(new Sprite(t));
      if (add) add.blendMode = "add";
      c.halves.push({ lit, add, wall: p.wall });
    }
  };
  for (const [kit, look] of H.kits) {
    const part = (p: HousePart | undefined, snow = false) => p?.tex.forEach((t, k) => put(t, p.anchor[k].x, kit, snow));
    part(look.ground); look.mids.forEach((m) => part(m)); part(look.roof); part(look.snow, true);
    for (const s of Object.values(look.shop ?? {})) part(s);
  }
  return c;
}

/**
 * Bring the copy up to the sun where it stands: drawn again only when the sun has moved since. Called each frame
 * the sun is away from home, before the houses are drawn. @see sunHome
 */
export function relightHouses(renderer: Renderer, H: HouseSprites) {
  if (!copy || copy.of !== H) { destroyCopy(); copy = build(H); }
  // (No more than every RELIGHT_MS: four pages drawn, and their mipmaps made, each time.)
  const t = performance.now();
  if (copy.at === sunRev || t - copy.when < RELIGHT_MS) return;
  copy.at = sunRev; copy.when = t;
  for (const h of copy.halves) {
    const g = gainOf(h.wall);
    h.lit.tint = grey(Math.min(1, g));
    if (h.add) { h.add.visible = g > 1.01; h.add.tint = grey(Math.max(0, g - 1)); }
  }
  for (const { rt, scene } of copy.pages.values()) {
    renderer.render({ container: scene, target: rt, clear: true });
    rt.source.updateMipmaps();
  }
}

/** A piece of the sheet as the sun lights it now; the piece itself if the copy is not made. */
export const litPiece = (tex: Texture): Texture => copy?.byTex.get(tex) ?? tex;

function destroyCopy() {
  if (!copy) return;
  for (const { rt, scene } of copy.pages.values()) { scene.destroy({ children: true }); rt.destroy(true); }
  copy = null;
}

/**
 * World v2 — A LANDMARK TIER'S PICTURE, for its card: its building drawn
 * finished, as the map draws it, once, into an image kept for the session.
 * On a small renderer of its own, off screen, made the first time a card asks.
 * @see LandmarksPanel, drawFinished
 */
import { useEffect, useState } from "react";
import { autoDetectRenderer, Graphics, type Renderer } from "pixi.js";

import { structureDef } from "../structures/def";
import { lookOf } from "../structures/projects/looks";
import { makePen } from "../structures/projects/pen";
import { drawFinished } from "../structures/projects/site";

/** How big it is drawn: half the map's size at its closest. */
const SCALE = 0.5;

let renderer: Promise<Renderer> | null = null;
const pictures = new Map<string, Promise<string | null>>();

function draw(defId: string): Promise<string | null> {
  const def = structureDef(defId);
  if (!def) return Promise.resolve(null);
  renderer ??= autoDetectRenderer({ preference: "webgl", backgroundAlpha: 0, antialias: true, width: 8, height: 8 });
  return renderer.then(async (r) => {
    const g = new Graphics();
    drawFinished(makePen(g, 0, 0, 0, SCALE, null), lookOf(defId, def.footprint), def.footprint);
    const url = await r.extract.base64({ target: g, resolution: 2 });
    g.destroy();
    return url;
  }).catch(() => null);
}

/** A structure's picture as an image URL, once drawn; null till then, or if it cannot be. */
export function useLandmarkPicture(defId: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!pictures.has(defId)) pictures.set(defId, draw(defId));
    void pictures.get(defId)!.then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [defId]);
  return url;
}

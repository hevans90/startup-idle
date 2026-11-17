/**
 * World v2 — THE GANG ON A ROAD BEING BUILT: an excavator at the earthworks,
 * a paver at the surfacing with a roller running back and forth behind it, a
 * lining truck last, and four in hi-vis beside them. From the vehicles'
 * sheet and the people's; moved along the job's line each frame BY TRANSFORM
 * — a unit changes parent only as it crosses into another band, about once a
 * tile. Stood still while the job stands for want of a load.
 * @see roads/jobs frontAt, plans/road-building.md
 */
import { Container, Graphics, Sprite } from "pixi.js";

import { bakedCars, headingIndex, loadCarSprites, pitchMatrix, poseOf, type CarSprites } from "../agents/cars/car-sheet";
import { bakedPeople, peopleLoaded, peopleSprites, posePerson } from "../agents/people/people-sheet";
import { idx, type Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW, bandOf } from "../iso";
import { ARRIVE, GANGS, GAP, PACE, frontAt, type RoadJob } from "../roads/jobs";
import type { BandLayer } from "./bands";

/** The contractor's yellow; the lining truck's white. */
const YELLOW = 0xe9a71b, WHITE = 0xf1f1ee;
/** Hi-vis, a hard hat, and the rest of a builder. */
const VESTS = [0xf47b20, 0xc8dc32, 0xf47b20, 0xe8e23a], HAT = 0xf5c224, SKIN = 0xd9a47a, LEGS = 0x3a4a63;
/** Where the four stand, tiles along the road from the machine they work beside, and across it. */
const CREW = [[-0.75, 0.3], [-1.05, -0.3], [-1.6, 0.28], [0.85, -0.32]];

type Unit = { c: Container; paint: Sprite; trim: Sprite; steam: Graphics | null; key: string; band: number };
type Hand = { c: Container; parts: Sprite[]; key: string; band: number };
type At = { x: number; y: number; z: number; heading: number; pitch: number };

export type RoadPlant = { sync(g: Grid, scale: number, t: number): void; destroy(): void };

/** Where on a job's line a place `p` cells along it is, how high, which way it runs there and how steeply. */
export function alongJob(g: Grid, j: RoadJob, p: number): At {
  const n = j.cells.length, q = Math.max(0, Math.min(n - 1, p)), i = Math.min(n - 1, Math.floor(q)), f = q - i;
  const a = j.cells[i], b = j.cells[Math.min(n - 1, i + 1)], back = j.cells[Math.max(0, i - 1)];
  // On the ground as it is now; on a bridge, at its deck.
  const zOf = (c: typeof a) => (c.deck ? c.z : g.deck[idx(g, c.x, c.y)] !== 0 ? g.deckZ[idx(g, c.x, c.y)] : g.height[idx(g, c.x, c.y)]);
  const dx = b === a ? a.x - back.x : b.x - a.x, dy = b === a ? a.y - back.y : b.y - a.y;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: zOf(a) + (zOf(b) - zOf(a)) * f, heading: Math.atan2(dy, dx), pitch: b === a ? 0 : zOf(b) - zOf(a) };
}

export function createRoadPlant(bands: BandLayer): RoadPlant {
  const units = new Map<string, Unit>(), hands = new Map<string, Hand>();
  let cars: CarSprites | null = null, asked = false;
  const drop = (c: Container) => { c.parent?.removeChild(c); c.destroy({ children: true }); };
  const into = (c: Container, was: number, x: number, y: number): number => {
    const band = Math.max(0, Math.min(bands.dynamicOf.length - 1, bandOf(Math.round(x), Math.round(y))));
    if (band !== was || !c.parent) { c.zIndex = 0.3; bands.dynamicOf[band]?.addChild(c); }
    return band;
  };
  return {
    sync(g, scale, t) {
      const seenU = new Set<string>(), seenH = new Set<string>();
      if (g.roadJobs.length && bakedCars()) {
        if (!cars && !asked) { asked = true; void loadCarSprites().then((s) => { cars = s; }); }
        const P = bakedPeople() ? peopleLoaded() : null;
        if (bakedPeople() && !P) void peopleSprites();
        g.roadJobs.slice(0, GANGS).forEach((j) => {
          if (j.t <= ARRIVE || !cars) return;
          const n = j.cells.length, f = [0, 1, 2, 3].map((s) => frontAt(j, s)), still = j.stalled > 0;
          const place = (name: string, look: string, tint: number, p: number, steam = false) => {
            const L = cars!.looks.get(look);
            if (!L) return null;
            const at = alongJob(g, j, p), id = `${j.id}:${name}`;
            seenU.add(id);
            let u = units.get(id);
            if (!u) {
              const c = new Container(); c.eventMode = "none";
              const paint = new Sprite(), trim = new Sprite();
              paint.tint = tint;
              c.addChild(paint, trim);
              const s = steam ? new Graphics() : null;
              if (s) { s.context.batchMode = "batch"; c.addChild(s); }
              u = { c, paint, trim, steam: s, key: "", band: -1 };
              units.set(id, u);
            }
            const h = headingIndex(at.heading, cars!.headings), pose = poseOf(cars!, L, h, at.pitch), F = pose.from, k = pose.k;
            const key = `${look}|${pose.key}|${scale}`;
            if (u.key !== key) {
              u.key = key;
              u.paint.texture = F.paint[k]; u.trim.texture = F.trim[k];
              u.paint.anchor.set(F.paintAnchor[k].x, F.paintAnchor[k].y); u.trim.anchor.set(F.trimAnchor[k].x, F.trimAnchor[k].y);
              u.paint.scale.set(scale / cars!.res); u.trim.scale.set(scale / cars!.res);
            }
            const x = (at.x - at.y) * HW * scale, y = (at.x + at.y) * HH * scale - at.z * HEIGHT_UNIT * scale;
            const tilt = pitchMatrix(pose.heading, pose.shear);
            if (tilt) { tilt.tx = x; tilt.ty = y; u.c.setFromMatrix(tilt); } else { u.c.scale.set(1); u.c.skew.set(0, 0); u.c.rotation = 0; u.c.position.set(x, y); }
            u.band = into(u.c, u.band, at.x, at.y);
            // STEAM off the mat behind it: three puffs that rise and thin.
            if (u.steam) {
              u.steam.clear();
              if (!still) for (let q = 0; q < 3; q++) {
                const ph = (t * 0.6 + q / 3) % 1, bx = -Math.cos(at.heading) * 0.42, by = -Math.sin(at.heading) * 0.42;
                u.steam.circle((bx - by) * HW * scale + (q - 1) * 5 * scale, (bx + by) * HH * scale - ph * 26 * scale, (3 + ph * 5) * scale).fill({ color: 0xffffff, alpha: 0.28 * (1 - ph) });
              }
            }
            return at;
          };
          // Each where its trade is, while its trade is still at work.
          if (f[0] < n) place("digger", "excavator", YELLOW, Math.max(0, f[0] - 0.55));
          const paving = j.t > ARRIVE + 2 * GAP * PACE && f[2] < n;
          if (paving) place("paver", "paver", YELLOW, f[2] + 0.1, true);
          if (j.t > ARRIVE + 2 * GAP * PACE && f[3] < n && f[2] > 1.2) place("roller", "roller", YELLOW, Math.min(n - 1, f[2]) - 1.25 + (still ? 0 : 0.45 * Math.sin(t * 1.7 + j.id)));
          if (f[3] > 0.2 && f[3] < n) place("liner", "pickup", WHITE, f[3] - 0.2);
          // THE FOUR, beside the paver once it is laying; before that, by the digger.
          if (P) {
            const by = paving ? f[2] : Math.max(0, f[0] - 0.55);
            CREW.forEach(([al, ac], k) => {
              const at = alongJob(g, j, by + al), id = `${j.id}:${k}`;
              seenH.add(id);
              let hnd = hands.get(id);
              if (!hnd) {
                const c = new Container(); c.eventMode = "none";
                const parts = [SKIN, LEGS, VESTS[k % VESTS.length], HAT, 0xffffff].map((tint) => { const sp = new Sprite(); sp.tint = tint; c.addChild(sp); return sp; });
                hnd = { c, parts, key: "", band: -1 };
                hands.set(id, hnd);
              }
              const px = at.x - Math.sin(at.heading) * ac, py = at.y + Math.cos(at.heading) * ac;
              hnd.key = posePerson(hnd.parts, P, "builder", still ? "stand" : k % 2 ? "work" : "walk", at.heading + (k % 2 ? Math.PI / 2 : 0), still ? 0 : t * 5 + k * 1.7, scale, 1, hnd.key);
              const x = (px - py) * HW * scale, y = (px + py) * HH * scale - at.z * HEIGHT_UNIT * scale;
              for (const sp of hnd.parts) sp.position.set(x, y);
              hnd.band = into(hnd.c, hnd.band, px, py);
            });
          }
        });
      }
      for (const [id, u] of units) if (!seenU.has(id)) { drop(u.c); units.delete(id); }
      for (const [id, h] of hands) if (!seenH.has(id)) { drop(h.c); hands.delete(id); }
    },
    destroy() { for (const u of units.values()) drop(u.c); for (const h of hands.values()) drop(h.c); units.clear(); hands.clear(); },
  };
}

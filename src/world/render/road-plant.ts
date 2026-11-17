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
/** The lorry's blue, tipping into the paver. */
const LORRY = 0x3f6fb0;
/**
 * THE FOUR, by what each does. Laying: two rake the mat behind the screed, facing it; one walks the edge beside the
 * roller; the foreman stands off the paver's shoulder. Before that, by the digger: one bank each side of the
 * bucket, one walking the line ahead with the pegs, the foreman behind. Tiles along from the machine, across the
 * road, the pose, and which way they face from the road's own way.
 */
type Role = { al: number; ac: number; pose: "work" | "walk" | "stand"; face: number; pace?: number };
const LAYING: Role[] = [
  { al: -0.62, ac: 0.24, pose: "work", face: Math.PI }, { al: -0.7, ac: -0.22, pose: "work", face: Math.PI },
  { al: -1.7, ac: 0.4, pose: "walk", face: 0, pace: 0.35 }, { al: 0.15, ac: -0.42, pose: "stand", face: Math.PI / 2 },
];
const DIGGING: Role[] = [
  { al: 0.75, ac: 0.38, pose: "stand", face: -Math.PI / 2 }, { al: 0.6, ac: -0.38, pose: "work", face: Math.PI / 2 },
  { al: 2.2, ac: 0.3, pose: "walk", face: 0, pace: 0.6 }, { al: -1.0, ac: -0.3, pose: "stand", face: 0 },
];

type Unit = { c: Container; paint: Sprite; trim: Sprite; fx: Graphics | null; key: string; band: number };
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
          const place = (name: string, look: string, tint: number, p: number, fx: "" | "steam" | "dust" = "", swing = 0) => {
            const L = cars!.looks.get(look);
            if (!L) return null;
            const at = alongJob(g, j, p), id = `${j.id}:${name}`;
            // Slewed off the road's own way: a digger swinging to its spoil and back.
            const way = at.heading;
            at.heading += swing;
            seenU.add(id);
            let u = units.get(id);
            if (!u) {
              const c = new Container(); c.eventMode = "none";
              const paint = new Sprite(), trim = new Sprite();
              paint.tint = tint;
              c.addChild(paint, trim);
              const s = fx ? new Graphics() : null;
              if (s) { s.context.batchMode = "batch"; c.addChild(s); }
              u = { c, paint, trim, fx: s, key: "", band: -1 };
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
            if (u.fx) {
              u.fx.clear();
              // STEAM off the mat behind a paver, the width of it; DUST where a digger's bucket bites, ahead of it.
              const steam = fx === "steam", far = steam ? -0.42 : 0.42, n = steam ? 5 : 3;
              if (!still) for (let q = 0; q < n; q++) {
                const ph = (t * (steam ? 0.55 : 0.8) + q / n + (q * 0.37) % 1) % 1, side = steam ? (q / (n - 1) - 0.5) * 0.5 : (q - 1) * 0.08;
                const bx = Math.cos(steam ? way : at.heading) * far - Math.sin(way) * side, by = Math.sin(steam ? way : at.heading) * far + Math.cos(way) * side;
                u.fx.circle((bx - by) * HW * scale, (bx + by) * HH * scale - (steam ? 4 + ph * 30 : 2 + ph * 12) * scale, (steam ? 3 + ph * 6 : 2.5 + ph * 4) * scale)
                  .fill({ color: steam ? 0xffffff : 0xa98660, alpha: (steam ? 0.26 : 0.34) * (1 - ph) });
              }
            }
            return at;
          };
          // Each where its trade is, while its trade is still at work.
          // (Not out over the water: there is nothing to dig on a bridge.)
          const digging = f[0] < n && !j.cells[Math.min(n - 1, Math.floor(f[0]))].deck && !j.cells[Math.max(0, Math.floor(f[0] - 0.55))].deck;
          // The digger swings out to its spoil and back as it goes.
          if (digging) place("digger", "excavator", YELLOW, Math.max(0, f[0] - 0.55), "dust", still ? 0 : 0.55 * Math.sin(t * 1.1 + j.id));
          const paving = j.t > ARRIVE + 2 * GAP * PACE && f[2] < n;
          if (paving) place("paver", "paver", YELLOW, f[2] + 0.1, "steam");
          // A LORRY backed up to its hopper, creeping ahead of it as it lays: there while there is something to tip.
          if (paving && !still && f[2] + 0.95 < n - 0.2) place("tipper", "tipper", LORRY, f[2] + 0.95);
          if (j.t > ARRIVE + 2 * GAP * PACE && f[3] < n && f[2] > 1.2) place("roller", "roller", YELLOW, Math.min(n - 1, f[2]) - 1.25 + (still ? 0 : 0.45 * Math.sin(t * 1.7 + j.id)));
          if (f[3] > 0.2 && f[3] < n) place("liner", "pickup", WHITE, f[3] - 0.2);
          // THE FOUR: by the paver once it is laying; before that, by the digger; with neither, stood where the work stopped.
          if (P) {
            const roles = paving ? LAYING : DIGGING, by = paving ? f[2] + 0.1 : Math.max(0, Math.min(n - 1, f[0]) - 0.55);
            roles.forEach((r, k) => {
              // One who walks, walks: up the line and back, at their own pace.
              const stride = r.pace && !still ? Math.sin(t * r.pace + k) * 0.7 : 0;
              const at = alongJob(g, j, by + r.al + stride), id = `${j.id}:${k}`;
              seenH.add(id);
              let hnd = hands.get(id);
              if (!hnd) {
                const c = new Container(); c.eventMode = "none";
                const parts = [SKIN, LEGS, k === 3 ? 0xf2f2f2 : VESTS[k % VESTS.length], HAT, 0xffffff].map((tint) => { const sp = new Sprite(); sp.tint = tint; c.addChild(sp); return sp; });
                hnd = { c, parts, key: "", band: -1 };
                hands.set(id, hnd);
              }
              const px = at.x - Math.sin(at.heading) * r.ac, py = at.y + Math.cos(at.heading) * r.ac;
              const turned = r.pace && !still && Math.cos(t * r.pace + k) < 0 ? Math.PI : 0;
              hnd.key = posePerson(hnd.parts, P, "builder", still ? "stand" : r.pose, at.heading + r.face + turned, still ? 0 : t * (r.pose === "walk" ? 7 : 5) + k * 1.7, scale, 0.94 + 0.04 * k, hnd.key);
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

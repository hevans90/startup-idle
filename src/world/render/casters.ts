/**
 * World v2 — WHAT STANDS ON THE GROUND AND THROWS A SHADOW ON IT.
 *
 * The ground's shadow was the ground's alone: a hill shaded the field behind it, and a tower on that field shaded
 * nothing. Here each finished building is boxes of height over its footprint — a house's walls a floor at a
 * time, a project's or a landmark's own masses — which the ground's shade is worked out through as it is through
 * the ground itself: one sun, one length of shadow to a height. @see ground-mesh castGround, light
 */
import { HALF_STEPS_PER_M, TILES_PER_M } from "../agents/cars/models";
import { footprintCells, type Structure } from "../grid";
import { housedBy } from "../../game/housing";
import { houseOf } from "../houses/models";
import { structureDef } from "../structures/def";
import { lookOf } from "../structures/projects/looks";
import { floorsFor, kitIdOf } from "../structures/tiles-renderer";

/** A box of something standing: over `u0…u1`, `v0…v1` of the map, tiles (a cell covers x…x+1), `z` half steps over its ground. */
export type CastBox = { u0: number; v0: number; u1: number; v1: number; z: number };
/** What a structure throws its shadow with, and a key that changes when that does. */
export type Caster = { key: string; boxes: CastBox[] };

/** How much of a storey a house's roof stands over its top floor's ceiling, taken as a box: a pitched roof's middle. */
const ROOF = 0.5;

/** What `s` throws a shadow with now, or null: a site, an empty lot and what is not a building throw none. */
export function casterOf(s: Structure): Caster | null {
  // (Kept for each structure while nothing of it that matters here has changed: asked a few times a second of a town's worth.)
  const sig = `${s.def}|${s.x},${s.y},${s.w},${s.h}|${s.build ? 1 : 0}|${s.residents ?? -1}`, was = kept.get(s);
  if (was && was.sig === sig) return was.caster;
  const caster = castOf(s);
  kept.set(s, { sig, caster });
  return caster;
}
const kept = new WeakMap<Structure, { sig: string; caster: Caster | null }>();
function castOf(s: Structure): Caster | null {
  const def = structureDef(s.def);
  if (!def || s.build) return null;
  if (def.render.kind === "tiles") {
    const kit = kitIdOf(def), house = kit ? houseOf(kit) : undefined;
    if (!house || (s.residents === 0 && housedBy(def.id))) return null;
    const floors = floorsFor(def, s, true);
    if (floors < 1) return null;
    const z = (house.ground + (floors - 1 + ROOF) * house.storey) * HALF_STEPS_PER_M, hu = house.hx * TILES_PER_M, hv = house.hy * TILES_PER_M;
    return {
      key: `${s.def}|${s.x},${s.y},${s.w},${s.h}|${floors}`,
      boxes: footprintCells(s.x, s.y, s.w, s.h).map((c) => ({ u0: c.x + 0.5 - hu, v0: c.y + 0.5 - hv, u1: c.x + 0.5 + hu, v1: c.y + 0.5 + hv, z })),
    };
  }
  if (def.render.rendererId !== "project") return null;
  const b = lookOf(s.def, { w: s.w, h: s.h });
  return {
    key: `${s.def}|${s.x},${s.y},${s.w},${s.h}`,
    boxes: b.masses.map((m) => ({ u0: s.x + m.u0, v0: s.y + m.v0, u1: s.x + m.u1, v1: s.y + m.v1, z: m.z1 })),
  };
}

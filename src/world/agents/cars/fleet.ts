/**
 * World v2 — WHICH VEHICLE EACH MOVER IS, and how long: pure, so the traffic
 * can space its cars by their models while the renderer draws them from the
 * sheet. @see car-sheet.ts, plans/baked-cars.md
 *
 * A mover's model is a hash of its id, weighted by kind — as common as on real
 * roads — so it is the same vehicle for as long as it drives.
 */
import type { Mover } from "../town";
import { BIKE_LENGTH } from "../people/people-format";
import { BUS_WEIGHTS, CAR_WEIGHTS, LORRY_WEIGHTS, MINIBUS_WEIGHTS, modelById, TILES_PER_M, VAN_WEIGHTS } from "./models";

/** The Machine's lorries: white, cabless, a violet light bar. @see Autonomous Freight */
export const AI_TRUCK_COLOUR = 0xeef0f6;
/** Hire to Fire's moving vans, white. */
export const VAN_COLOUR = 0xe9e6dd;
/** The interns' bus, yellow; Shuttle Bus's buses, blue. */
export const BUS_COLOUR = 0xf2b51d;
export const SHUTTLE_COLOUR = 0x3a78c9;

/** One of a list, the same for the same mover always. */
const ofId = <T>(id: number, salt: number, list: readonly T[]) =>
  list[Math.abs(Math.imul(id ^ salt, 0x9e3779b1) >>> 7) % list.length];

/** Each model as many times as its weight in fifths. */
const picks = (weights: Readonly<Record<string, number>>) =>
  Object.entries(weights).flatMap(([id, w]) => Array<string>(Math.round(w * 5)).fill(id));
const CAR_PICKS = picks(CAR_WEIGHTS), VAN_PICKS = picks(VAN_WEIGHTS), LORRY_PICKS = picks(LORRY_WEIGHTS);
const BUS_PICKS = picks(BUS_WEIGHTS), MINIBUS_PICKS = picks(MINIBUS_WEIGHTS);

/** The emergency services' vehicles. @see agents/emergency */
const SIREN_MODEL = { police: "police", ambulance: "ambulance", fire: "fireEngine" } as const;

/** Which model a mover is, or null for one on foot. */
export function modelFor(m: Pick<Mover, "id" | "kind" | "colour" | "siren" | "bus">): string | null {
  if (m.siren) return SIREN_MODEL[m.siren];
  if (m.kind === "car") return ofId(m.id, 0x51ed, CAR_PICKS);
  if (m.kind === "limo") return "limo";
  if (m.kind === "bus") return ofId(m.id, 0xb05, m.colour === SHUTTLE_COLOUR || m.bus ? BUS_PICKS : MINIBUS_PICKS);
  if (m.kind === "truck") {
    if (m.colour === AI_TRUCK_COLOUR) return "machineLorry";
    return ofId(m.id, 0x7a11, m.colour === VAN_COLOUR ? VAN_PICKS : LORRY_PICKS);
  }
  return null;
}

/** Half a mover's length, tiles: nose or tail from its middle. 0 for one on foot. */
export function halfLength(m: Pick<Mover, "id" | "kind" | "colour" | "siren" | "bus">): number {
  if (m.kind === "bike") return (BIKE_LENGTH * TILES_PER_M) / 2;
  const id = modelFor(m);
  const model = id ? modelById.get(id) : undefined;
  return model ? (model.length * TILES_PER_M) / 2 : 0;
}

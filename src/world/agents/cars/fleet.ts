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
/** A port's lorries, taking what was landed out by the gate: box lorries, in the port's blue. @see boats/yard */
export const PORT_LORRY_COLOUR = 0x2f6ea8;
/** A lorry bringing a line its pipe from the yard, three lengths on its bed; and the same lorry going home, its bed bare. @see line-loads */
export const PIPE_LORRY_COLOUR = 0x2e63b9, PIPE_EMPTY_COLOUR = 0x2e63b8;
/** A job's machines on the road between the yard and it: the crane travelling, a mixer, a low-loader with a digger on it, the gang's pickup. @see line-loads */
export const PLANT_CRANE_COLOUR = 0xe9a71a, PLANT_MIXER_COLOUR = 0xe9a71c, PLANT_LOADER_COLOUR = 0xe9a71d, PLANT_PICKUP_COLOUR = 0xe9a71e;
/** A low-loader with nothing on it: one that has set its machine down and gone home, or is come back for it. @see fleet/plant */
export const PLANT_LOADER_EMPTY_COLOUR = 0xe9a71f;
/** The company's own lorries with a site's pallets and a road's stone: a flatbed and a tipper, loaded; the tipper going home empty (the flatbed goes home a bare bed). @see world/fleet */
export const FLEET_FLATBED_COLOUR = 0x2e63ba, FLEET_TIPPER_COLOUR = 0x2e63bb, FLEET_TIPPER_EMPTY_COLOUR = 0x2e63bc;
/** A tipper going home with what it was filled with on the job: a pit's spoil, a building's rubble. @see fleet/plant `spoil` */
export const FLEET_SPOIL_COLOUR = 0x2e63bd;
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
    if (m.colour === PORT_LORRY_COLOUR) return "boxLorry";
    if (m.colour === PIPE_LORRY_COLOUR) return "pipeLorryLoaded";
    if (m.colour === PIPE_EMPTY_COLOUR) return "pipeLorry";
    if (m.colour === FLEET_FLATBED_COLOUR) return "flatbed";
    if (m.colour === PLANT_CRANE_COLOUR) return "craneTravel";
    if (m.colour === PLANT_MIXER_COLOUR) return "mixer";
    if (m.colour === PLANT_LOADER_COLOUR) return "lowLoader";
    if (m.colour === PLANT_LOADER_EMPTY_COLOUR) return "lowLoaderEmpty";
    if (m.colour === PLANT_PICKUP_COLOUR) return "pickup";
    if (m.colour === FLEET_TIPPER_COLOUR) return "tipper";
    if (m.colour === FLEET_TIPPER_EMPTY_COLOUR) return "spoil0";
    if (m.colour === FLEET_SPOIL_COLOUR) return "spoil4";
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

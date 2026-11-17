/**
 * World v2 — WHO IS IN EACH VEHICLE: pure. Somebody is driving every one of
 * them, and the right sort of somebody — a builder in a tipper, a paramedic
 * in an ambulance, the people of a car in the car, who are the people that
 * walk away from it. Nobody in the Machine's lorries: that is the point of
 * them. @see plans/vehicle-drivers.md, occupants (who draws them)
 */
import type { Mover } from "../town";
import { aboard } from "../parking";
import { figureOfId, hairOf, heightOf, legsOf, riderId, shirtOf, skinOf } from "../people/cast";
import { seatsOf } from "./models";

/** Somebody sat in a vehicle: which seat, which figure of the people's sheet, their colours — skin, legs, top, hair or hat — and how tall. */
export type Rider = { seat: number; figure: string; skin: number; legs: number; top: number; hair: number; height: number };

/** Hi-vis vests' own colours; a hard hat's; and the services' — an officer's black, a paramedic's greens, a firefighter's tunic and helmet. */
const VESTS = [0xf47b20, 0xc8dc32, 0xf47b20, 0xe8e23a], WORK_LEGS = 0x3a4a63;
const POLICE = { top: 0x1b1f2a, legs: 0x1b1f2a, hat: 0x14171f }, MEDIC = { top: 0x2f8f5b, legs: 0x256f47 };
const FIRE = { top: 0xb08d3c, legs: 0xa8863a, hat: 0xf2d21a };
/** A bus driver's shirt, a chauffeur's suit, a postie's red. */
const BUS_SHIRT = 0xdfe7f2, SUIT = 0x23262d, POST_RED = 0xc8102e;
/** The most people drawn in a bus, its driver among them. */
const BUS_MOST = 10;
/** How often a lorry or a van has a mate beside its driver, of a hundred. */
const MATE = 30;

const hash = (id: number, salt: number) => (Math.imul(id ^ salt, 0x9e3779b1) >>> 8) % 100;
/** Somebody of an identity, as they are in themselves: their own figure and colours. */
const person = (seat: number, who: number): Rider =>
  ({ seat, figure: figureOfId(who), skin: skinOf(who), legs: legsOf(who), top: shirtOf(who), hair: hairOf(who), height: heightOf(who) });
/** A builder: hi-vis and a hard hat (the hat is the figure's own). */
const builder = (seat: number, who: number): Rider =>
  ({ ...person(seat, who), figure: "builder", top: VESTS[who % VESTS.length], legs: WORK_LEGS });
const officer = (seat: number, who: number): Rider => ({ ...person(seat, who), figure: "officer", top: POLICE.top, legs: POLICE.legs, hair: POLICE.hat });
const medic = (seat: number, who: number): Rider => ({ ...person(seat, who), figure: "medic", top: MEDIC.top, legs: MEDIC.legs });
const firefighter = (seat: number, who: number): Rider => ({ ...person(seat, who), figure: "firefighter", top: FIRE.top, legs: FIRE.legs, hair: FIRE.hat });

/** What a model is crewed by, when it is not just somebody's car. */
const SERVICE: Readonly<Record<string, (seat: number, who: number) => Rider>> = { police: officer, ambulance: medic, fireEngine: firefighter };
/** The models builders drive, whatever they are doing. */
const WORKS = new Set(["pickup", "smallVan", "panelVan", "lutonVan", "flatbed", "boxLorry", "tipper", "pipeLorry", "pipeLorryLoaded"]);

/**
 * WHO IS IN A VEHICLE, the driver first: by what it is and what it is doing. Never more than it has seats; none in
 * one with no seats. The same for the same vehicle always.
 */
export function crewFor(m: Pick<Mover, "id" | "kind" | "siren" | "blues" | "bus">, model: string): Rider[] {
  const seats = seatsOf(model).length;
  if (!seats) return [];
  const who = (k: number) => riderId(m.id, k), take = (n: number, make: (seat: number, who: number) => Rider) =>
    Array.from({ length: Math.min(seats, n) }, (_, k) => make(k, who(k)));
  // THE SERVICES: two up in a police car and an ambulance; a crew in a fire engine.
  const service = SERVICE[model];
  if (service) return take(model === "fireEngine" ? 4 : 2, service);
  if (model === "limo") return [{ ...person(0, who(0)), figure: "suit", top: SUIT, legs: SUIT }];
  if (m.kind === "bus") {
    // A DRIVER, and passengers at the windows: a bus about half full, a minibus fuller, the same seats always.
    const out: Rider[] = [{ ...person(0, who(0)), figure: "suit", top: BUS_SHIRT }];
    // (No more than a busload's worth of sprites: every rider is five.)
    for (let k = 1; k < seats && out.length < BUS_MOST; k++) if (hash(m.id * 64 + k, 0xb055) < (m.bus ? 45 : 65)) out.push(person(k, who(k)));
    return out;
  }
  if (model === "postalVan") return [{ ...person(0, who(0)), figure: "casual", top: POST_RED }];
  if (model === "taxi") {
    // ITS DRIVER is its own; its fare, when it has one, sits in the back.
    const out = [{ ...person(0, riderId(m.id, 7)), figure: "bald" }];
    for (let k = 0; k < aboard(m) && k + 2 < seats; k++) out.push(person(k + 2, who(k)));
    return out;
  }
  if (m.kind === "truck" || WORKS.has(model)) return take(hash(m.id, 0x3a7e) < MATE ? 2 : 1, builder);
  // SOMEBODY'S CAR: the people it carries — who get out of it, and walk away as themselves.
  return take(aboard(m), person);
}

/** Who works a machine: a builder, by the machine. */
export const plantCrew = (model: string, id: number): Rider[] => (seatsOf(model).length ? [builder(0, riderId(id, 0))] : []);

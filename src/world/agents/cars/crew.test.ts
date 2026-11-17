/**
 * WHO IS IN EACH VEHICLE: somebody drives every one of them but the Machine's,
 * the right sort of somebody, and a car's people are the people who walk away
 * from it. @see crew, plans/vehicle-drivers.md
 */
import { describe, expect, test } from "bun:test";

import type { Mover } from "../town";
import { aboard } from "../parking";
import { figureFor, heightOf, legsOf, riderId, shirtOf, skinOf, whoOf } from "../people/cast";
import { figureById } from "../people/figures";
import { crewFor, plantCrew } from "./crew";
import { modelFor } from "./fleet";
import { MODELS, PLANT, modelById, seatsOf } from "./models";

const mover = (id: number, over: Partial<Mover> = {}) => ({ id, kind: "car", colour: 0xc0392b, ...over }) as Mover;

describe("every vehicle has seats, the driver's first", () => {
  test("all but the Machine's lorry, a paver's screed and a digger's tracks; and no two people in one seat", () => {
    const none = new Set(["machineLorry", "screed", "exTracks"]);
    for (const m of MODELS) {
      const seats = seatsOf(m.id);
      expect(seats.length > 0, m.id).toBe(!none.has(m.id));
      const at = new Set(seats.map((s) => `${s.l.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}`));
      expect(at.size, m.id).toBe(seats.length);
      // Inside it: not past its ends or its sides; and sat above the road.
      for (const s of seats) {
        expect(Math.abs(s.l), m.id).toBeLessThan(m.length / 2);
        expect(Math.abs(s.y), m.id).toBeLessThan(m.width / 2);
        expect(s.z, m.id).toBeGreaterThan(0.2);
      }
    }
  });
  test("the wheel is on the right — the side away from a bus's doors", () => {
    for (const id of ["saloon", "tipper", "singleDecker", "police", "taxi"]) expect(seatsOf(id)[0].y, id).toBeLessThan(0);
  });
});

describe("who is in a vehicle", () => {
  test("whatever a mover is, its crew fits its seats, sits one to a seat, and is drawn from figures there are", () => {
    for (let id = 1; id < 4000; id++) {
      for (const m of [mover(id), mover(id, { kind: "truck", colour: 0x777777 }), mover(id, { kind: "bus", colour: 0xf2b51d }), mover(id, { kind: "limo" }),
        mover(id, { siren: "police" }), mover(id, { siren: "ambulance" }), mover(id, { siren: "fire" })]) {
        const model = modelFor(m)!, crew = crewFor(m, model), seats = seatsOf(model).length;
        expect(crew.length, model).toBeGreaterThan(0);
        expect(crew.length, model).toBeLessThanOrEqual(seats);
        expect(new Set(crew.map((r) => r.seat)).size, model).toBe(crew.length);
        expect(crew[0].seat, model).toBe(0);
        for (const r of crew) { expect(r.seat).toBeLessThan(seats); expect(figureById.has(r.figure), r.figure).toBe(true); }
      }
    }
  });
  test("nobody in the Machine's lorries", () => {
    expect(crewFor(mover(5, { kind: "truck" }), "machineLorry")).toEqual([]);
  });
  test("the right sort of somebody: builders in lorries and vans, the services in their own, a crew in a fire engine", () => {
    for (let id = 1; id < 300; id++) {
      expect(crewFor(mover(id, { kind: "truck" }), "tipper").every((r) => r.figure === "builder")).toBe(true);
      expect(crewFor(mover(id), "smallVan")[0].figure).toBe("builder");
      expect(crewFor(mover(id, { siren: "police" }), "police").map((r) => r.figure)).toEqual(["officer", "officer"]);
      expect(crewFor(mover(id, { siren: "ambulance" }), "ambulance").map((r) => r.figure)).toEqual(["medic", "medic"]);
      expect(crewFor(mover(id, { siren: "fire" }), "fireEngine").map((r) => r.figure)).toEqual(Array(4).fill("firefighter"));
      // (One of the town's own cars that happens to be a police car is crewed as one.)
      expect(crewFor(mover(id), "police")[0].figure).toBe("officer");
    }
  });
  test("a car's people are as many as it carries — and each is who walks away from it", () => {
    for (let id = 1; id < 500; id++) {
      const c = mover(id), crew = crewFor(c, "estate");
      expect(crew.length).toBe(Math.min(aboard(c), seatsOf("estate").length));
      crew.forEach((r, k) => {
        // The walker the town sets down for them: `as` the same rider, their shirt by who they are.
        const w = mover(9000 + id * 3 + k, { kind: "person", as: riderId(c.id, k), colour: shirtOf(riderId(c.id, k)) });
        expect(figureFor(w)).toBe(r.figure);
        expect(w.colour).toBe(r.top);
        expect(skinOf(whoOf(w))).toBe(r.skin);
        expect(legsOf(whoOf(w))).toBe(r.legs);
        expect(heightOf(whoOf(w))).toBe(r.height);
      });
    }
  });
  test("a bus has its driver, and some of its seats taken: the same ones every time", () => {
    const b = mover(77, { kind: "bus", colour: 0x3a78c9 }), a = crewFor(b, "singleDecker");
    expect(a.length).toBeGreaterThan(2);
    expect(a.length).toBeLessThan(seatsOf("singleDecker").length);
    expect(crewFor(b, "singleDecker")).toEqual(a);
  });
  test("a builder works every machine that has a seat", () => {
    for (const m of PLANT) expect(plantCrew(m.id, 3).map((r) => r.figure), m.id).toEqual(seatsOf(m.id).length ? ["builder"] : []);
    expect(modelById.has("mixer")).toBe(true);
  });
});

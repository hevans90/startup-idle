import { describe, expect, test } from "bun:test";

import { seatsOf } from "../render/street-props";
import { seatsByCell, sitDown, type Mover } from "./town";
import { createGrid } from "../grid";

describe("sitting on benches", () => {
  test("a bench has two seats, facing away from its kerb into the street", () => {
    const seats = seatsOf([{ kind: "bench", x: 5, y: 7, side: "N", level: 2 }]);
    expect(seats).toHaveLength(2);
    for (const s of seats) {
      expect(s.heading).toBeCloseTo(Math.PI / 2);
      expect(Math.round(s.x)).toBe(5); expect(Math.round(s.y)).toBe(7);
      expect(s.bench).toBe("5,7,N");
    }
    expect(Math.abs(seats[0].x - seats[1].x)).toBeCloseTo(0.081);
    expect(seatsOf([{ kind: "bench", x: 5, y: 7, side: "W", level: 2 }])[0].heading).toBeCloseTo(0);
  });

  test("some walkers passing a free seat sit on it, facing the street; a taken one, nobody", () => {
    const g = createGrid(12, 12);
    const seats = seatsOf([{ kind: "bench", x: 5, y: 7, side: "N", level: 2 }]);
    const by = seatsByCell(g, seats);
    const walker = (id: number) => ({ id, kind: "person", x: seats[0].x + 0.02, y: seats[0].y, heading: 0, speed: 0.1, phase: 0 }) as unknown as Mover;
    const sat = Array.from({ length: 60 }, (_, id) => walker(id)).filter((m) => { sitDown(m, by, new Set(), g); return !!m.sit; });
    expect(sat.length).toBeGreaterThan(5);
    expect(sat.length).toBeLessThan(40);
    for (const m of sat) { expect(m.heading).toBeCloseTo(Math.PI / 2); expect(m.sit!.left).toBeGreaterThanOrEqual(10); }
    const busy = walker(sat[0].id);
    sitDown(busy, by, new Set(seats.map((s) => s.key)), g);
    expect(busy.sit).toBeUndefined();
  });
});

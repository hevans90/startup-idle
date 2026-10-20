import { describe, expect, test } from "bun:test";
import type { Graphics } from "pixi.js";

import type { Mover } from "./town";
import { HEADINGS, drawMover, lookOf } from "./town-render";

/** A stand-in for a Graphics that remembers every circle and arc drawn. */
function recorder() {
  const circles: { x: number; y: number; r: number }[] = [], arcs: { x: number; y: number; r: number }[] = [];
  const g: Record<string, unknown> = {};
  const self = () => g;
  for (const k of ["moveTo", "lineTo", "closePath", "poly", "fill", "stroke", "rect", "clear"]) g[k] = self;
  g.circle = (x: number, y: number, r: number) => { circles.push({ x, y, r }); return g; };
  g.arc = (x: number, y: number, r: number) => { arcs.push({ x, y, r }); return g; };
  return { g: g as unknown as Graphics, circles, arcs };
}

const person = (heading: number, job?: Mover["job"]) => ({
  id: 7, kind: "person", path: [], line: [], at: new Float32Array(), s: 0, speed: 0, cruise: 1,
  x: 10, y: 10, z: 0, heading, stuck: 0, phase: 0.4, colour: 0x3366cc, ...(job ? { job } : {}),
}) as unknown as Mover;

describe("a person", () => {
  test("wears their hair, or a hard hat, centred on their head whichever way they face", () => {
    for (const job of [undefined, { site: 1, role: "builder" as const }]) {
      for (let k = 0; k < 8; k++) {
        const { g, circles, arcs } = recorder();
        drawMover(g, person((k * Math.PI) / 4, job), 2, 1);
        // The head is the biggest circle; the hair the one arc.
        const head = [...circles].sort((a, b) => b.r - a.r)[0];
        expect(arcs.length).toBe(1);
        expect(arcs[0].x).toBeCloseTo(head.x, 6);
        expect(arcs[0].r).toBeCloseTo(head.r, 6);
        // On top of the head, not beside or below it.
        expect(arcs[0].y).toBeLessThanOrEqual(head.y);
        expect(head.y - arcs[0].y).toBeLessThan(head.r);
      }
    }
  });
});

describe("a mover's look, drawn once", () => {
  const car = (heading: number, colour = 0xc0392b) => ({ ...person(heading), kind: "car", colour }) as unknown as Mover;
  test("two movers that look alike share it; a turn or another colour does not", () => {
    expect(lookOf(car(0.01)).key).toBe(lookOf(car(-0.01)).key);
    expect(lookOf(car(0)).key).not.toBe(lookOf(car(Math.PI / 2)).key);
    expect(lookOf(car(0)).key).not.toBe(lookOf(car(0, 0x2e6fb5)).key);
    // A whole turn round is the same heading.
    expect(lookOf(car(0)).key).toBe(lookOf(car(Math.PI * 2)).key);
  });

  test("a person's look follows their stride and outfit, and a builder's hat", () => {
    const a = person(0), b = { ...person(0), phase: 0.4 + Math.PI } as Mover;
    expect(lookOf(a).key).not.toBe(lookOf(b).key);
    expect(lookOf(a).key).not.toBe(lookOf(person(0, { site: 1, role: "builder" })).key);
  });

  test("is drawn at the origin, its heading snapped to one of the set", () => {
    const { canon } = lookOf(car(0.3));
    expect([canon.x, canon.y, canon.z]).toEqual([0, 0, 0]);
    const step = (Math.PI * 2) / HEADINGS.vehicle;
    expect(canon.heading / step).toBeCloseTo(Math.round(canon.heading / step), 9);
  });
});

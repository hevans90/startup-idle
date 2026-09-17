/**
 * Pins the v2 closed-form projection helpers to the v1 mathjs ones.
 *
 * `mapToWorld` / `worldPlaneToMapCell` allocate a mathjs matrix per call, which
 * v2's per-cell hot paths can't afford — so v2 uses `cellToWorldFast` /
 * `worldPlaneToCellFast` instead. The originals are NOT modified; these tests
 * exist so the two implementations can never drift apart.
 */
import { describe, expect, test } from "bun:test";
import {
  cellToWorldFast,
  mapToWorld,
  worldPlaneToCellFast,
  worldPlaneToMapCell,
} from "./projection";

const SCALES = [0.5, 1, 2, 3];

describe("fast projection === mathjs projection", () => {
  test("cellToWorldFast matches mapToWorld", () => {
    for (const s of SCALES) {
      for (let x = -20; x <= 60; x += 3) {
        for (let y = -20; y <= 44; y += 3) {
          for (const z of [0, 1, 2.5]) {
            const a = mapToWorld(x, y, z, s);
            const b = cellToWorldFast(x, y, z, s);
            expect(b.x).toBeCloseTo(a.x, 9);
            expect(b.y).toBeCloseTo(a.y, 9);
          }
        }
      }
    }
  });

  test("worldPlaneToCellFast matches worldPlaneToMapCell", () => {
    for (const s of SCALES) {
      for (let x = -20; x <= 60; x += 3) {
        for (let y = -20; y <= 44; y += 3) {
          // sample the diamond interior, away from floor() boundaries
          const w = mapToWorld(x, y, 0, s);
          for (const [dx, dy] of [[0, 0], [10 * s, 4 * s], [-10 * s, -4 * s]]) {
            expect(worldPlaneToCellFast(w.x + dx, w.y + dy, s))
              .toEqual(worldPlaneToMapCell(w.x + dx, w.y + dy, s));
          }
        }
      }
    }
  });

  test("fast round-trip returns the originating cell", () => {
    for (const s of SCALES) {
      for (const [x, y] of [[0, 0], [1, 0], [0, 1], [17, 23], [55, 39], [-4, 6]]) {
        const w = cellToWorldFast(x, y, 0, s);
        expect(worldPlaneToCellFast(w.x, w.y, s)).toEqual({ mapX: x, mapY: y });
      }
    }
  });
});

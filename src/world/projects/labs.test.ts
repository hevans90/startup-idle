import { describe, expect, test } from "bun:test";

import { createGrid, type Structure } from "../grid";
import { LAB_SHARE, labReading } from "./labs";

const put = (g: ReturnType<typeof createGrid>, s: Omit<Structure, "id">, id: number) => g.structures.set(id, { ...s, id });

describe("R&D labs", () => {
  test("each adds its share of innovation, twice that near the campus", () => {
    const g = createGrid(60, 60);
    expect(labReading(g)).toEqual({ count: 0, mult: 1 });
    put(g, { def: "lab", x: 50, y: 50, w: 2, h: 2 }, 1);
    expect(labReading(g).mult).toBeCloseTo(1 + LAB_SHARE, 6);
    put(g, { def: "campus", x: 5, y: 5, w: 4, h: 4 }, 2);
    put(g, { def: "lab", x: 12, y: 6, w: 2, h: 2 }, 3);
    expect(labReading(g)).toEqual({ count: 2, mult: expect.closeTo(1 + 3 * LAB_SHARE, 6) });
  });
});

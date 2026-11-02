import { describe, expect, test } from "bun:test";
import { detailFor, spaceWords, type Word } from "./mains-layer";

describe("the Water overlay's numbers", () => {
  const word = (text: string, x: number, y: number, rank: number): Word => ({ text, colour: 0xffffff, at: [x, y], rank });

  test("where two would meet, the one that matters more is kept", () => {
    const out = spaceWords([word("head +1.0", 100, 100, 0), word("dry", 110, 104, 3), word("97%", 400, 100, 2)], 1);
    expect(out.map((w) => w.text)).toEqual(["dry", "97%"]);
  });

  test("zoomed in, the same numbers are far enough apart to all stand", () => {
    // A screen pixel is a fifth of a unit: the 10 units between them are 50 px.
    const out = spaceWords([word("100%", 100, 100, 2), word("98%", 100, 110, 2)], 0.2);
    expect(out).toHaveLength(2);
    expect(spaceWords([word("100%", 100, 100, 2), word("98%", 100, 110, 2)], 2)).toHaveLength(1);
  });
});

describe("how much detail a main is drawn in", () => {
  test("by how wide a tile is on the screen", () => {
    expect(detailFor(5)).toBe("far");
    expect(detailFor(60)).toBe("mid");
    expect(detailFor(132)).toBe("near");
  });

  test("a zoom resting near a threshold stays in the tier it was in", () => {
    // Just under the near threshold: near stays near, mid stays mid.
    expect(detailFor(95, "near")).toBe("near");
    expect(detailFor(95, "mid")).toBe("mid");
    // Just over it, from mid: not yet.
    expect(detailFor(105, "mid")).toBe("mid");
    expect(detailFor(115, "mid")).toBe("near");
    // And round the far threshold the same way.
    expect(detailFor(38, "mid")).toBe("mid");
    expect(detailFor(42, "far")).toBe("far");
    expect(detailFor(30, "mid")).toBe("far");
  });
});

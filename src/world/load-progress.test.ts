import { describe, expect, test } from "bun:test";
import { loadStage } from "./load-progress";

describe("what a map's load says it is at", () => {
  const all = { device: true, frame: true, water: true, asked: 6, come: 6 };
  test("is the first thing not yet done, in the order they come", () => {
    expect(loadStage({ ...all, device: false, frame: false, water: false, come: 0 })).toBe("Opening the GPU");
    expect(loadStage({ ...all, frame: false, water: false, come: 2 })).toBe("Building the map");
    expect(loadStage({ ...all, water: false, come: 2 })).toBe("Loading sprites · 2 of 6");
    expect(loadStage({ ...all, water: false })).toBe("Starting the water");
  });
  test("is nothing once only the GPU is left", () => {
    expect(loadStage(all)).toBeNull();
  });
});

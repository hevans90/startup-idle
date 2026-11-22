import { describe, expect, test } from "bun:test";
import { createGrid } from "../grid";
import { FIXTURE_SIZE, applyFixture } from "../debug/fixtures";
import { HOURS, hiddenAt, litAt, litShare, seedOf, windowsOf } from "./lit-windows";
import { SHADE_PER_TILE } from "./ground-mesh";

describe("a building's windows", () => {
  test("every finished building of a town has some, on the two faces the eye sees, each inside its building's reach", () => {
    const n = FIXTURE_SIZE.bigtown ?? 48, g = createGrid(n, n, 1);
    applyFixture(g, "bigtown", 1);
    let withWindows = 0, built = 0;
    for (const s of g.structures.values()) {
      if (s.build) continue;
      built++;
      const ws = windowsOf(s);
      if (!ws.length) continue;
      withWindows++;
      for (const w of ws) {
        expect(w.a1).toBeGreaterThan(w.a0);
        expect(w.z1).toBeGreaterThan(w.z0);
        expect(w.z0).toBeGreaterThanOrEqual(0);
        // On a face of its own building, give or take what stands proud of the wall.
        const [lo, hi] = w.face === 0 ? [s.x - 1, s.x + s.w] : [s.y - 1, s.y + s.h];
        expect(w.at).toBeGreaterThan(lo);
        expect(w.at).toBeLessThan(hi);
      }
    }
    expect(built).toBeGreaterThan(100);
    expect(withWindows / built).toBeGreaterThan(0.8);
  });
});

describe("a window's hours", () => {
  test("about the share asked for are lit at any moment, and which ones changes as the night goes on", () => {
    const n = FIXTURE_SIZE.bigtown ?? 48, g = createGrid(n, n, 1);
    applyFixture(g, "bigtown", 1);
    const seeds: number[] = [];
    for (const s of g.structures.values()) { if (seeds.length > 4000) break; for (const w of windowsOf(s)) seeds.push(seedOf(s.id, w)); }
    expect(seeds.length).toBeGreaterThan(2000);
    const at = (t: number, share: number) => seeds.map((sd) => litAt(sd, t, share));
    const a = at(100, 0.4), b = at(100 + HOURS * 3, 0.4);
    const lit = a.filter(Boolean).length / a.length;
    expect(lit).toBeGreaterThan(0.3);
    expect(lit).toBeLessThan(0.5);
    // Not the same windows three stretches later; and a second apart, nearly all the same.
    expect(a.filter((v, i) => v !== b[i]).length / a.length).toBeGreaterThan(0.2);
    const c = at(101, 0.4);
    expect(a.filter((v, i) => v !== c[i]).length / a.length).toBeLessThan(0.03);
  });
  test("fewer are lit toward morning than in the evening", () => {
    expect(litShare(0)).toBeGreaterThan(litShare(0.5));
    expect(litShare(0.5)).toBeGreaterThan(litShare(1));
    expect(litShare(1)).toBeGreaterThan(0);
  });
});

describe("a window behind a building", () => {
  test("is hidden by a tower standing nearer the eye, and not by one standing further off or one too low", () => {
    const n = 16, S = SHADE_PER_TILE, W = n * S;
    const gm = { heights: new Float32Array(W * W), casts: new Float32Array(W * W), w: n, h: n };
    const tower = (x: number, y: number, z: number) => { for (let j = y * S; j < (y + 1) * S; j++) for (let i = x * S; i < (x + 1) * S; i++) gm.casts[j * W + i] = z; };
    tower(8, 8, 12);
    // A tile back along the line of sight, two half steps up: the tower stands over the line.
    expect(hiddenAt(gm, 6.5, 6.5, 2)).toBe(true);
    // The same window, nearer the eye than the tower.
    expect(hiddenAt(gm, 9.5, 9.5, 2)).toBe(false);
    // And one high enough to be seen over it.
    expect(hiddenAt(gm, 6.5, 6.5, 11)).toBe(false);
  });
  test("is hidden by a bridge's deck across the line of sight, and not by one it is seen over or under", () => {
    const n = 16, S = SHADE_PER_TILE, W = n * S;
    const gm = { heights: new Float32Array(W * W), casts: new Float32Array(W * W), w: n, h: n };
    const decks = { on: new Uint8Array(n * n), z: new Int8Array(n * n) };
    // A deck eight half steps up, two tiles nearer the eye: the line from a point at the ground meets it there.
    decks.on[9 * n + 9] = 1; decks.z[9 * n + 9] = 8;
    expect(hiddenAt(gm, 6.5, 6.5, 0, 1, 1.1, decks)).toBe(true);
    // Higher, the line goes over the deck; lower, under it.
    expect(hiddenAt(gm, 6.5, 6.5, 5, 1, 1.1, decks)).toBe(false);
    expect(hiddenAt(gm, 6.5, 6.5, -5, 1, 1.1, decks)).toBe(false);
    // And a thing on the deck itself is not hidden by it.
    expect(hiddenAt(gm, 8.5, 8.5, 8.5, 0, 0.3, decks)).toBe(false);
  });
});

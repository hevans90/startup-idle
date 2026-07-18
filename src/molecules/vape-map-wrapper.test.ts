import { describe, expect, test } from "bun:test";
import { GAME_SECS, generateNotes } from "./vape-map-wrapper";

describe("vape minigame note generation", () => {
  test("no note's tail extends past the fixed game end (final long press isn't truncated)", () => {
    // The game finishes at a fixed GAME_SECS regardless of input. If any note —
    // especially the last one, a long hold — ended after that, the result screen
    // would pop mid-hold and cut it off. Property-check across many layouts.
    for (let run = 0; run < 3000; run++) {
      const notes = generateNotes();
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) {
        const tail = n.hitTime + n.duration;
        expect(tail).toBeLessThanOrEqual(GAME_SECS - 0.35);
        if (n.type === "tap") expect(n.duration).toBe(0);
        // No degenerate zero-length holds slipped through the fit-or-fallback.
        if (n.type === "hold") expect(n.duration).toBeGreaterThanOrEqual(0.4);
      }
    }
  });
});

import { describe, expect, test } from "bun:test";

import { MORALE_SECONDS, addMorale, clearMorale, moraleOffsets } from "./morale";

describe("morale that lasts", () => {
  test("leans a kind's satisfaction for a day, adding up, then is gone", () => {
    clearMorale();
    addMorale("vibe_coder", 15, MORALE_SECONDS, 0);
    addMorale("vibe_coder", -10, 60, 0);
    addMorale("intern", -5, MORALE_SECONDS, 0);
    expect(moraleOffsets(30_000)).toEqual({ vibe_coder: 5, intern: -5 });
    expect(moraleOffsets(61_000)).toEqual({ vibe_coder: 15, intern: -5 });
    expect(moraleOffsets(MORALE_SECONDS * 1000 + 1)).toEqual({});
  });
});

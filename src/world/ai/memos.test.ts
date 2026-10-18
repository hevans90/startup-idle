import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useGenerationStore, emptyLog } from "../../state/generation.store";
import { useMoneyStore } from "../../state/money.store";
import { createAiRunner, stepMemos } from "./ai-runner";
import { ARRIVALS, MEMOS, MEMO_EVERY, pickMemo } from "./memos";

afterEach(() => resetAllGameStores());

describe("the AI's memos", () => {
  test("say each stage's arrival first, once, then come every few minutes", () => {
    const r = createAiRunner();
    expect(stepMemos(r, "tool", 1000, [])).toBeNull();
    const hello = stepMemos(r, "assistant", 1, [], () => 0.5);
    expect(hello).toEqual({ text: ARRIVALS.assistant!, arrived: "assistant" });
    expect(stepMemos(r, "assistant", 1, ["assistant"], () => 0.5)).toBeNull();
    const memo = stepMemos(r, "assistant", MEMO_EVERY[1] + 1, ["assistant"], () => 0.5);
    expect(memo?.text.length).toBeGreaterThan(0);
  });

  test("do as they say", () => {
    useMoneyStore.setState({ money: new Decimal(1000) });
    const compute = MEMOS.find((m) => m.id === "compute")!;
    compute.apply!();
    expect(useMoneyStore.getState().money.toNumber()).toBeCloseTo(900);
  });

  test("lean toward the family the AI is becoming, and keep to its stage and the one before", () => {
    useGenerationStore.setState({ log: { ...emptyLog(), datasets: { people: 40 } } });
    const seen = new Map<string, number>();
    let s = 3;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let k = 0; k < 400; k++) {
      const m = pickMemo("colleague", rand)!;
      expect(["assistant", "colleague"]).toContain(m.stage);
      seen.set(m.family ?? "none", (seen.get(m.family ?? "none") ?? 0) + 1);
    }
    expect(seen.get("shepherd")!).toBeGreaterThan(seen.get("planner") ?? 0);
  });
});

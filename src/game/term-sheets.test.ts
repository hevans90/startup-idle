import { afterEach, describe, expect, test } from "bun:test";

import { useAgentsStore } from "../state/agents.store";
import { useSessionStore } from "../state/session.store";
import { QUICK_SALE, TERM_SHEETS, setTermReader, termBonusNow, termSheet, termSheetsFor, termStatus } from "./term-sheets";

afterEach(() => {
  useSessionStore.getState().reset();
  useAgentsStore.getState().reset();
});

describe("term sheets", () => {
  test("three are offered, the same three for the same land", () => {
    const a = termSheetsFor(1234).map((t) => t.id), b = termSheetsFor(1234).map((t) => t.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    const seen = new Set<string>();
    for (let seed = 1; seed < 50; seed++) for (const t of termSheetsFor(seed)) seen.add(t.id);
    expect(seen.size).toBe(TERM_SHEETS.length);
  });

  test("with none signed there is no bonus", () => {
    expect(termStatus()).toBeNull();
    expect(termBonusNow()).toBe(0);
  });

  test("pay their bonus only when the goal is met", () => {
    useSessionStore.getState().setTermSheet("town");
    const stop = setTermReader(() => ({ houses: 39, wonders: 0 }));
    expect(termBonusNow()).toBe(0);
    expect(termStatus()!.progress.text).toBe("39/40 houses");
    stop();
    const stop2 = setTermReader(() => ({ houses: 40, wonders: 0 }));
    expect(termBonusNow()).toBe(termSheet("town")!.bonus);
    stop2();
  });

  test("a clean run is broken by one overflow, for the rest of the run", () => {
    useSessionStore.getState().setTermSheet("clean");
    expect(termBonusNow()).toBe(termSheet("clean")!.bonus);
    useSessionStore.getState().markOverflowed();
    expect(termBonusNow()).toBe(0);
    useSessionStore.getState().reset();
    expect(useSessionStore.getState().overflowed).toBe(false);
  });

  test("a quick sale runs out, and agents count", () => {
    useSessionStore.setState({ termSheet: "quick", incorporatedAt: Date.now() - (QUICK_SALE + 60) * 1000 });
    expect(termStatus()!.progress).toMatchObject({ met: false, text: "Too late" });
    useSessionStore.setState({ termSheet: "agents" });
    useAgentsStore.setState({ agents: 12 });
    expect(termStatus()!.progress.met).toBe(true);
  });
});

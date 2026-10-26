import { afterEach, describe, expect, test } from "bun:test";

import { useAgentsStore } from "../state/agents.store";
import { useAiSingularityStore } from "../state/ai-singularity.store";
import { useGeneratorStore } from "../state/generators.store";
import { useSessionStore } from "../state/session.store";
import { INVESTORS } from "./term-investors";
import { QUICK_SALE, TERM_SHEETS, setTermReader, termBonusNow, termSheet, termSheetsFor, termStatus } from "./term-sheets";

afterEach(() => {
  useSessionStore.getState().reset();
  useAgentsStore.getState().reset();
  useAiSingularityStore.setState({ value: 0 });
});

const hire = (id: string, amount: number) =>
  useGeneratorStore.setState((s) => ({ generators: s.generators.map((g) => (g.id === id ? { ...g, amount } : g)) }));

describe("term sheets", () => {
  test("thirty-odd investors, none about the slop pit, each a goal that reads", () => {
    expect(TERM_SHEETS.length).toBeGreaterThanOrEqual(34);
    expect(new Set(TERM_SHEETS.map((t) => t.id)).size).toBe(TERM_SHEETS.length);
    for (const t of TERM_SHEETS) {
      expect(t.goal.toLowerCase()).not.toContain("slop");
      expect(t.goalAt(1.5)).toBeTruthy();
      expect(t.bonus).toBeGreaterThan(0);
    }
  });

  test("four are offered, the same four for the same land; a reroll draws others", () => {
    const a = termSheetsFor(1234).map((t) => t.id), b = termSheetsFor(1234).map((t) => t.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(4);
    expect(termSheetsFor(1234, 4, 1).map((t) => t.id)).not.toEqual(a);
    expect(termSheetsFor(1234, 5)).toHaveLength(5);
    const seen = new Set<string>();
    for (let seed = 1; seed < 200; seed++) for (const t of termSheetsFor(seed)) seen.add(t.id);
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
    expect(termStatus()!.progress.text).toBe("39/40 lived-in houses");
    stop();
    const stop2 = setTermReader(() => ({ houses: 40, wonders: 0 }));
    expect(termBonusNow()).toBe(termSheet("town")!.bonus);
    stop2();
  });

  test("a quick sale runs out; a patient one has to wait; a window opens and closes", () => {
    useSessionStore.setState({ termSheet: "quick", incorporatedAt: Date.now() - (QUICK_SALE + 60) * 1000 });
    expect(termStatus()!.progress).toMatchObject({ met: false, text: "Too late" });
    useSessionStore.setState({ termSheet: "patient", incorporatedAt: Date.now() - 3600 * 1000 });
    expect(termStatus()!.progress.met).toBe(false);
    useSessionStore.setState({ incorporatedAt: Date.now() - 4 * 3600 * 1000 });
    expect(termStatus()!.progress.met).toBe(true);
    useSessionStore.setState({ termSheet: "clockwork", incorporatedAt: Date.now() - 30 * 60 * 1000 });
    expect(termStatus()!.progress.met).toBe(false);
    useSessionStore.setState({ incorporatedAt: Date.now() - 90 * 60 * 1000 });
    expect(termStatus()!.progress.met).toBe(true);
  });

  test("more, fewer and none read the company", () => {
    useSessionStore.getState().setTermSheet("agents");
    useAgentsStore.setState({ agents: 12 });
    expect(termStatus()!.progress.met).toBe(true);
    useSessionStore.getState().setTermSheet("noAgents");
    expect(termStatus()!.progress.met).toBe(false);
    useAgentsStore.getState().reset();
    expect(termStatus()!.progress.met).toBe(true);
    useSessionStore.getState().setTermSheet("luddite");
    useAiSingularityStore.setState({ value: 30 });
    expect(termStatus()!.progress.met).toBe(false);
    useAiSingularityStore.setState({ value: 10 });
    expect(termStatus()!.progress.met).toBe(true);
    useSessionStore.getState().setTermSheet("interns");
    hire("intern", 80);
    expect(termStatus()!.progress.met).toBe(true);
    hire("intern", 0);
  });

  test("an investor no longer offered pays nothing: a run signed with them keeps no kicker", () => {
    useSessionStore.getState().setTermSheet("clean");
    expect(termStatus()).toBeNull();
    expect(INVESTORS.some((i) => i.id === "clean")).toBe(false);
  });
});

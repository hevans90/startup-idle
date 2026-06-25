import { beforeEach, describe, expect, test } from "bun:test";
import { useExitsStore } from "./exits.store";

const reset = () => useExitsStore.setState({ exits: {}, bestExitValuation: 0 });

describe("exits store", () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  test("getExitsForFounder returns empty record for unknown founder", () => {
    const record = useExitsStore.getState().getExitsForFounder("unknown_founder");
    expect(record.count).toBe(0);
    expect(record.totalValuation).toBe(0);
  });

  test("recordExit increments count and accumulates valuation", () => {
    const { recordExit, getExitsForFounder } = useExitsStore.getState();

    recordExit("hacker", 1000);
    const r1 = getExitsForFounder("hacker");
    expect(r1.count).toBe(1);
    expect(r1.totalValuation).toBe(1000);

    recordExit("hacker", 2500);
    const r2 = getExitsForFounder("hacker");
    expect(r2.count).toBe(2);
    expect(r2.totalValuation).toBe(3500);
  });

  test("multiple founders are tracked independently", () => {
    useExitsStore.getState().recordExit("hacker", 500);
    useExitsStore.getState().recordExit("neet", 200);
    useExitsStore.getState().recordExit("neet", 300);

    const h = useExitsStore.getState().getExitsForFounder("hacker");
    const n = useExitsStore.getState().getExitsForFounder("neet");

    expect(h.count).toBe(1);
    expect(h.totalValuation).toBe(500);
    expect(n.count).toBe(2);
    expect(n.totalValuation).toBe(500);
  });

  test("clearAll resets all exit records", () => {
    useExitsStore.getState().recordExit("hacker", 1000);
    useExitsStore.getState().recordExit("neet", 999);
    useExitsStore.getState().clearAll();

    expect(useExitsStore.getState().exits).toEqual({});
    expect(useExitsStore.getState().getExitsForFounder("hacker").count).toBe(0);
  });

  test("exits object is updated reactively after recordExit", () => {
    useExitsStore.getState().recordExit("bootstrapper", 750);
    const exits = useExitsStore.getState().exits;
    expect(exits["bootstrapper"]).toBeDefined();
    expect(exits["bootstrapper"].count).toBe(1);
  });

  test("bestExitValuation tracks the highest single exit across all founders", () => {
    useExitsStore.getState().recordExit("neet", 500);
    useExitsStore.getState().recordExit("hacker", 2000);
    useExitsStore.getState().recordExit("neet", 1000);
    expect(useExitsStore.getState().bestExitValuation).toBe(2000);
  });

  test("clearAll resets bestExitValuation", () => {
    useExitsStore.getState().recordExit("neet", 9999);
    useExitsStore.getState().clearAll();
    expect(useExitsStore.getState().bestExitValuation).toBe(0);
  });
});

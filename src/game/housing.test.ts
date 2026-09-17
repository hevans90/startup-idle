/**
 * Housing as a ceiling on hiring.
 *
 * The rule: an employee needs somewhere to live. The map raises the ceiling and
 * the existing economy fills it — the cost curve, upgrades and perks are all
 * untouched.
 *
 * What is worth testing here is not the arithmetic but the SEAMS: that the gate
 * sits on the one door every hiring path goes through, that it cannot be walked
 * past by auto-buy or by an absence, and that being at capacity never costs a
 * player money for employees who do not arrive.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import Decimal from "break_infinity.js";
import { useGeneratorStore } from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import {
  NO_HOUSING, housedBy, housingCapacity, roomFor, setHousingReader,
} from "./housing";
import { createGrid, fillTerrain } from "../world/grid";
import { placeCommand } from "../world/structures/place";
import { structureDef } from "../world/structures/def";
import { commit, createHistory } from "../world/edit/commands";

/** A map with `n` buildings of one kit on it, placed for real. */
function mapWith(defId: string, n: number) {
  const grid = createGrid(16, 16);
  fillTerrain(grid, 1);
  const def = structureDef(defId)!;
  const history = createHistory();
  for (let k = 0; k < n; k++) {
    const cmd = placeCommand(grid, def, 1 + k * 2, 1);
    if (cmd) commit(grid, history, cmd);
  }
  return grid;
}

const owned = (id: string) =>
  useGeneratorStore.getState().generators.find((g) => g.id === id)?.amount ?? 0;

/** Gate the economy at exactly `beds` interns. */
const gateAt = (beds: number) =>
  setHousingReader(() => ({ ...NO_HOUSING, intern: beds }));

describe("what a building houses", () => {
  test("the kit id carries the district and the tier", () => {
    expect(housedBy("kit:intern.t0")).toEqual({ id: "intern", slots: 2 });
    expect(housedBy("kit:vibe_coder.t1")?.id).toBe("vibe_coder");
    expect(housedBy("kit:10x_dev.landmark")?.id).toBe("10x_dev");
  });

  test("a bigger tier houses more, which is the map's second axis", () => {
    const t0 = housedBy("kit:intern.t0")!.slots;
    const t2 = housedBy("kit:intern.t2")!.slots;
    expect(t2).toBeGreaterThan(t0);
  });

  /** A map may name a building from a later build; it must not throw. */
  test("something that is not housing houses nobody", () => {
    expect(housedBy("kit:nonsense.t0")).toBeNull();
    expect(housedBy("statue")).toBeNull();
    expect(housedBy("")).toBeNull();
  });

  test("capacity is the sum over what is actually placed", () => {
    const per = housedBy("kit:intern.t0")!.slots;
    expect(housingCapacity(mapWith("kit:intern.t0", 3)).intern).toBe(per * 3);
    expect(housingCapacity(createGrid(8, 8)).intern).toBe(0);
  });

  test("housing one district does not house another", () => {
    const cap = housingCapacity(mapWith("kit:intern.t0", 3));
    expect(cap.intern).toBeGreaterThan(0);
    expect(cap.vibe_coder).toBe(0);
    expect(cap["10x_dev"]).toBe(0);
  });
});

describe("the gate", () => {
  let ungate: () => void = () => {};

  beforeEach(() => {
    localStorage.clear();
    resetAllGameStores();
    useMoneyStore.setState({ money: new Decimal(1e9) });
  });
  afterEach(() => ungate());

  /**
   * THE DEFAULT HAS TO BE NO GATE. The world is still its own route and the
   * rest of the game runs without it; if "no map" read as "no beds", simply not
   * opening World v2 would brick hiring.
   */
  test("with no map registered, hiring is limited by money alone", () => {
    expect(roomFor("intern", 0)).toBe(Infinity);
    useGeneratorStore.getState().purchaseGenerator("intern", 5);
    expect(owned("intern")).toBe(5);
  });

  test("a hire needs a bed", () => {
    ungate = gateAt(3);
    useGeneratorStore.getState().purchaseGenerator("intern", 3);
    expect(owned("intern")).toBe(3);
    useGeneratorStore.getState().purchaseGenerator("intern", 1);
    expect(owned("intern")).toBe(3);                 // full
  });

  /**
   * THE TRAP THIS EXISTS FOR. `purchaseGenerator` charges FIRST and increases
   * after, so a clamp alone would take a player's money and hand back nobody.
   */
  test("a refused hire takes no money", () => {
    ungate = gateAt(1);
    useGeneratorStore.getState().purchaseGenerator("intern", 1);
    const before = useMoneyStore.getState().money;

    useGeneratorStore.getState().purchaseGenerator("intern", 1);
    expect(owned("intern")).toBe(1);
    expect(useMoneyStore.getState().money.eq(before)).toBe(true);
  });

  test("and a partly-affordable bulk buy is refused whole, not clipped", () => {
    ungate = gateAt(2);
    const before = useMoneyStore.getState().money;
    useGeneratorStore.getState().purchaseGenerator("intern", 5);   // only 2 beds
    expect(owned("intern")).toBe(0);
    expect(useMoneyStore.getState().money.eq(before)).toBe(true);
  });

  /**
   * `increaseGenerator` is the door auto-buy and offline replay both use, and
   * neither goes through `purchaseGenerator`. It CLAMPS rather than refusing,
   * so "hire as many as you can" hires as many as it can.
   */
  test("the automatic path clamps to the beds available", () => {
    ungate = gateAt(4);
    useGeneratorStore.getState().increaseGenerator("intern", 10);
    expect(owned("intern")).toBe(4);
    useGeneratorStore.getState().increaseGenerator("intern", 10);
    expect(owned("intern")).toBe(4);                 // and stays there
  });

  test("building more housing lets exactly that many more in", () => {
    ungate = gateAt(2);
    useGeneratorStore.getState().increaseGenerator("intern", 99);
    expect(owned("intern")).toBe(2);
    ungate();
    ungate = gateAt(5);
    useGeneratorStore.getState().increaseGenerator("intern", 99);
    expect(owned("intern")).toBe(5);
  });

  /**
   * Demolishing below your own headcount is allowed; the employees already
   * hired stay, and nobody new arrives until there is room.
   */
  test("losing housing strands nobody, it just stops the intake", () => {
    ungate = gateAt(6);
    useGeneratorStore.getState().increaseGenerator("intern", 6);
    ungate();
    ungate = gateAt(2);                              // three buildings demolished
    expect(owned("intern")).toBe(6);                 // still employed
    expect(roomFor("intern", 6)).toBe(0);            // and not below zero
    useGeneratorStore.getState().increaseGenerator("intern", 1);
    expect(owned("intern")).toBe(6);                 // no new arrivals
  });

  /**
   * THE PATH AN ABSENCE TAKES. Offline progress replays `tickGenerators` in
   * chunks, and its auto-buy calls `increaseGenerator` DIRECTLY — never
   * `purchaseGenerator`. So this is the one that proves a player cannot come
   * back from a week away to more employees than houses.
   */
  test("auto-buy, and therefore an absence, cannot outrun the housing", () => {
    ungate = gateAt(3);
    const g = useGeneratorStore.getState();
    // One intern to seed it (auto-buy skips a generator at zero), and a perk
    // level so the rate is above zero at all.
    g.increaseGenerator("intern", 1);
    useGeneratorStore.setState((st) => ({
      employeeManagement: {
        ...st.employeeManagement,
        perks: {
          ...st.employeeManagement.perks,
          intern: { ...st.employeeManagement.perks.intern, autoBuyLevel: 20 },
        },
      },
    }));
    expect(useGeneratorStore.getState().getAutoBuyRate("intern")).toBeGreaterThan(0);

    // A minute of catch-up, which at this rate would hire far past three.
    useGeneratorStore.setState({ globalLastTick: Date.now() - 60_000 });
    useGeneratorStore.getState().tickGenerators();

    expect(owned("intern")).toBe(3);
  });

  test("the gate is per district", () => {
    ungate = setHousingReader(() => ({ ...NO_HOUSING, intern: 2, vibe_coder: 0 }));
    useGeneratorStore.getState().increaseGenerator("intern", 5);
    useGeneratorStore.getState().increaseGenerator("vibe_coder", 5);
    expect(owned("intern")).toBe(2);
    expect(owned("vibe_coder")).toBe(0);
  });
});

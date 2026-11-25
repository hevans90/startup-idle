/** PUMPS ARE BILLED ONCE A SECOND: whatever they run, the company's money does not change every frame. @see settleBill */
import { afterEach, expect, test } from "bun:test";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import { useMoneyStore } from "../state/money.store";
import { PAID_PUMPS, settleBill } from "./step-world";

afterEach(() => { settleBill(10); resetAllGameStores(); });

test("three pumps for ten seconds: ten payments, of all they ran; and none run that cannot be paid for", () => {
  useMoneyStore.getState().reset();
  useMoneyStore.getState().increaseMoney(1e9);
  let changes = 0;
  const off = useMoneyStore.subscribe(() => changes++);
  for (let i = 0; i < 640; i++) {
    for (let k = 0; k < 3; k++) expect(PAID_PUMPS.pay(1 / 64)).toBe(true);
    settleBill(1 / 64);
  }
  off();
  expect(changes).toBe(10);
  const spent = 1e9 - useMoneyStore.getState().money.toNumber();
  expect(spent).toBeGreaterThan(0);
  // As much as ten seconds each, billed at once, comes to.
  PAID_PUMPS.pay(30);
  const before = useMoneyStore.getState().money.toNumber();
  settleBill(1);
  expect(before - useMoneyStore.getState().money.toNumber()).toBeCloseTo(spent, 3);
  useMoneyStore.getState().reset();
  expect(PAID_PUMPS.pay(1)).toBe(false);
});

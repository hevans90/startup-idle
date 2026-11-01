import { expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { formatCurrency } from "./money-utils";

test("money is written out below $10M and in e-notation from there", () => {
  expect(formatCurrency(1234.56)).toBe("$1,234.6");
  expect(formatCurrency(1e7)).toBe("$1.00e+7");
  expect(formatCurrency(new Decimal("3.57e828"))).toBe("$3.57e+828");
});

test("a debt takes the true minus, before the dollar", () => {
  expect(formatCurrency(-5)).toBe("−$5");
  expect(formatCurrency(-1.2e9)).toBe("−$1.20e+9");
});

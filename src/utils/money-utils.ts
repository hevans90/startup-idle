import Decimal from "break_infinity.js";

import { INFINITY } from "./time-utils";

type FormatCurrencyOptions = {
  exponentBreakpoint?: number;
  decimals?: number;
  showDollarSign?: boolean;
  /**
   * Always the one decimal place, ".0" and all: for a figure that changes as
   * you watch it, whose width — and so its place, centred — should not jump
   * every time the tenths come round to nought. @see Toolbar
   */
  steady?: boolean;
};

export const formatCurrency = (
  amount: Decimal | number,
  {
    exponentBreakpoint = 1e7,
    decimals = 2,
    showDollarSign = true,
    steady = false,
  }: FormatCurrencyOptions = {}
): string => {
  // Without limit: "∞", "$∞", "−$∞" — never the word. @see INFINITY
  const n = typeof amount === "number" ? amount : null;
  if (n === Infinity || n === -Infinity) return (n < 0 ? "−" : "") + (showDollarSign ? "$" : "") + INFINITY;
  const dec = typeof amount === "number" ? new Decimal(amount) : amount;
  // The true minus, before the dollar: "−$5", "−$1.20e+9". @see game/wording
  const sign = dec.lt(0) ? "−" : "";
  const abs = dec.abs();

  if (abs.gte(exponentBreakpoint)) {
    const sci = abs.toExponential(decimals);
    return sign + (showDollarSign ? `$${sci}` : sci);
  }

  return sign + formatterFor(showDollarSign, steady).format(abs.toNumber());
};

/**
 * THE FORMATTERS, made once each. An `Intl.NumberFormat` is slow to build and
 * quick to use, and this used to build one for every number it formatted —
 * on a big town, thousands a second for the map's labels alone.
 */
const formatters = new Map<string, Intl.NumberFormat>();
function formatterFor(dollar: boolean, steady: boolean): Intl.NumberFormat {
  const key = `${dollar}|${steady}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: dollar ? "currency" : "decimal",
      currency: "USD",
      maximumFractionDigits: 1,
      minimumFractionDigits: steady ? 1 : 0,
    });
    formatters.set(key, f);
  }
  return f;
}

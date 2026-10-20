import Decimal from "break_infinity.js";

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
  const dec = typeof amount === "number" ? new Decimal(amount) : amount;

  if (dec.gte(exponentBreakpoint)) {
    const sci = dec.toExponential(decimals);
    return showDollarSign ? `$${sci}` : sci;
  }

  return formatterFor(showDollarSign, steady).format(dec.toNumber());
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

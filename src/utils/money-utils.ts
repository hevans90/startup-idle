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

  const formatted = new Intl.NumberFormat("en-US", {
    style: showDollarSign ? "currency" : "decimal",
    currency: "USD",
    maximumFractionDigits: 1,
    minimumFractionDigits: steady ? 1 : 0,
  }).format(dec.toNumber());

  return formatted;
};

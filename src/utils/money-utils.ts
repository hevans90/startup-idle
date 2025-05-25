import Decimal from "break_infinity.js";

type FormatCurrencyOptions = {
  exponentBreakpoint?: number;
  decimals?: number;
  showDollarSign?: boolean;
};

export const formatCurrency = (
  amount: Decimal | number,
  {
    exponentBreakpoint = 1e7,
    decimals = 2,
    showDollarSign = true,
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
    minimumFractionDigits: 0,
  }).format(dec.toNumber());

  return formatted;
};

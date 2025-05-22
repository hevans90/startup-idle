import Decimal from "break_infinity.js";

export const formatCurrency = (
  amount: Decimal | number,
  exponentBreakpoint = 1e7,
  decimals = 2
): string => {
  const dec = typeof amount === "number" ? new Decimal(amount) : amount;

  if (dec.gte(exponentBreakpoint)) {
    // Use scientific notation above 10 million
    return `$${dec.toExponential(decimals)}`;
  }

  // Format normally below 1 billion
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(dec.toNumber());
};

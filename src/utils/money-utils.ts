import Decimal from "break_infinity.js";

export const formatCurrency = (amount: Decimal | number): string => {
  const dec = typeof amount === "number" ? new Decimal(amount) : amount;

  if (dec.gte(1e7)) {
    // Use scientific notation above 1 million
    return `$${dec.toExponential(3)}`;
  }

  // Format normally below 1 billion
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(dec.toNumber());
};

import Decimal from "break_infinity.js";

export const formatCurrency = (amount: Decimal | number): string => {
  const num = typeof amount === "number" ? amount : amount.toNumber();
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(num);
};

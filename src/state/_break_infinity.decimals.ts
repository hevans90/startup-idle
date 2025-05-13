/* eslint-disable @typescript-eslint/no-explicit-any */
import Decimal from "break_infinity.js";

// Key-aware replacer for Decimal
export function decimalReplacer(key: string, value: unknown): unknown {
  if (value instanceof Decimal) {
    return { type: "decimal", value: value.toString() };
  }
  return value;
}

function isValidNumber(value: string) {
  const num = parseFloat(value);
  return !isNaN(num) && isFinite(num);
}

// Key-aware reviver for Decimal
export function decimalReviver(key: string, value: any): unknown {
  if (value && isValidNumber(value)) {
    return new Decimal(value);
  }
  return value;
}

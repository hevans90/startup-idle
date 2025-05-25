/* eslint-disable @typescript-eslint/no-explicit-any */
import Decimal from "break_infinity.js";

// @ts-expect-error prototype
Decimal.prototype.toJSON = function () {
  return {
    type: "decimal",
    mantissa: this.mantissa,
    exponent: this.exponent,
  };
};

// Key-aware replacer for Decimal
export function decimalReplacer(key: string, value: unknown): unknown {
  if (key) {
    //
  }

  if (
    value &&
    typeof value === "object" &&
    typeof (value as any).mantissa === "number" &&
    typeof (value as any).exponent === "number"
  ) {
    return {
      type: "decimal",
      mantissa: (value as any).mantissa,
      exponent: (value as any).exponent,
    };
  }
  return value;
}

// Key-aware reviver for Decimal
export function decimalReviver(key: string, value: any): unknown {
  if (!key) {
    //
  }
  if (
    value &&
    value.type === "decimal" &&
    typeof value.mantissa === "number" &&
    typeof value.exponent === "number"
  ) {
    return Decimal.fromMantissaExponent(value.mantissa, value.exponent);
  }
  return value;
}

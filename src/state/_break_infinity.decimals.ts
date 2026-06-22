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

/**
 * Coerce any persisted shape back into a Decimal. The reviver only revives the
 * exact `{type:"decimal",...}` form, so older/foreign saves (a raw number, or a
 * `{mantissa,exponent}` missing the `type` tag) slip through as non-Decimals and
 * crash `.add`/`.mul`/etc. This is the defensive net at hydration.
 */
export function coerceDecimal(
  value: unknown,
  fallback: Decimal = new Decimal(0),
): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Decimal(value);
  }
  if (value && typeof value === "object") {
    const o = value as any;
    if (typeof o.mantissa === "number" && typeof o.exponent === "number") {
      return Decimal.fromMantissaExponent(o.mantissa, o.exponent);
    }
  }
  return fallback;
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

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

/**
 * Whether `v` is a usable finite amount.
 *
 * The economy multiplies through some native-`number` factors (the founder's
 * `globalMoneyMult` is `2^exits`, and several rate getters compute in floats),
 * so at extreme scale a factor can overflow to `Infinity`. Adding that into a
 * persisted Decimal poisons the save permanently — valuation/equity become
 * `Infinity`/`NaN` and never recover. Guard every store entry point with this.
 */
export function isFiniteAmount(v: number | Decimal): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  return Number.isFinite(v.mantissa) && Number.isFinite(v.exponent);
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

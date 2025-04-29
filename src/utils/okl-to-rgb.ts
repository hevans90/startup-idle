import { formatHex, parse } from "culori";

/**
 * Converts an OKLCH string to a hex color.
 * Falls back to default if parsing fails.
 */
export function convertColorToHex(
  colorString: string,
  fallback = "#000000"
): string {
  const parsed = parse(colorString);
  if (!parsed) {
    console.warn("Failed to parse color:", colorString);
    return fallback;
  }
  return formatHex(parsed);
}

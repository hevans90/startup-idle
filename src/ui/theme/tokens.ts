/**
 * THE CONSOLE'S TOKENS: every colour the UI uses, by its ROLE — never a raw
 * hue in a component — in both themes, built as scales with `@arwes/theme`.
 * Applied as CSS variables (`--ui-*`) on `:root` and `.dark` by `installTheme`,
 * read by Tailwind (`bg-surface-1`, `text-money`, …) and by arwes's frames.
 * @see plans/ui-overhaul.md §1.1
 *
 * A role has three faces: its colour itself (`--ui-money`: safe for text and
 * lines on the theme's surfaces), `-soft` (a tint to fill behind it) and
 * `-line` (a frame or a border in it). The surfaces, lines and text are the
 * console's greys, the game's own `primary` palette.
 */
import { createThemeColor, createThemeMultiplier, createThemeUnit } from "@arwes/theme";

export type Theme = "light" | "dark";

/** A hue's scale by its lightness, 0 to 100, at a saturation: arwes's HSL creator (it rounds the step, so the step is the lightness). */
const scale = (hue: number, sat: number) => createThemeColor((l) => [hue, sat, l]);

/** The greys: the game's `primary` palette, darkest to lightest, as index.css has it. */
const GREY = createThemeColor([
  "#111417", "#1b1f23", "#272e35", "#313840", "#3d454f", "#4c5661", "#717883", "#a6abb3", "#c7cbd1", "#e1e3e6", "#f4f5f6",
]);

/** The hues the roles are drawn from. */
const HUES = {
  // The founder's teal — the company's own — and the AI's violet: the two the takeover moves between.
  accent: scale(160, 62),
  ai: scale(275, 72),
  money: scale(152, 58),
  innovation: scale(190, 75),
  valuation: scale(40, 85),
  juice: scale(330, 70),
  weights: scale(270, 60),
  good: scale(150, 55),
  warn: scale(38, 90),
  bad: scale(0, 70),
  info: scale(205, 70),
} as const;
export type Role = keyof typeof HUES;
export const ROLES = Object.keys(HUES) as Role[];

/** The lightness each face takes in each theme: dark text on light, light on dark. */
const STEP: Record<Theme, { main: number; soft: number; line: number }> = {
  light: { main: 28, soft: 95, line: 50 },
  dark: { main: 76, soft: 17, line: 59 },
};

/** The greys' roles: surfaces 0 (the page) to 3 (an overlay), lines, and text (`fg`, so the class reads `text-fg`). */
const NEUTRAL: Record<Theme, Record<string, string>> = {
  light: {
    "surface-0": GREY(10), "surface-1": GREY(9), "surface-2": GREY(8), "surface-3": "#ffffff",
    "line-quiet": GREY(8), "line": GREY(7), "line-strong": GREY(5),
    "fg": GREY(1), "fg-muted": GREY(5), "fg-faint": GREY(6),
  },
  dark: {
    "surface-0": GREY(0), "surface-1": GREY(1), "surface-2": GREY(2), "surface-3": GREY(3),
    "line-quiet": GREY(3), "line": GREY(4), "line-strong": GREY(6),
    "fg": GREY(9), "fg-muted": GREY(7), "fg-faint": GREY(6),
  },
};

/** Every token's value in a theme, by name without the `--ui-` prefix. */
export function tokens(theme: Theme): Record<string, string> {
  const out: Record<string, string> = { ...NEUTRAL[theme] };
  const s = STEP[theme];
  for (const role of ROLES) {
    const c = HUES[role];
    out[role] = c(s.main);
    out[`${role}-soft`] = c(s.soft);
    out[`${role}-line`] = c(s.line);
  }
  return out;
}

/**
 * THE TAKEOVER MIX: how far the console has gone from the founder's teal to
 * the AI's violet, by the meter's stage — and how much it decorates itself.
 * @see plans/ui-overhaul.md §1.1, §1.4
 */
export const CONSOLE_AI: Record<string, number> = { tool: 0, assistant: 0.1, colleague: 0.25, manager: 0.45, overseer: 0.8, ascension: 1 };

/** Spacing: a 4 px grid. Type: a step of 1.2. */
export const space = createThemeUnit((i) => `${i * 0.25}rem`);
export const typeStep = createThemeMultiplier((i) => 1.2 ** i);

/** The pairs that must read, and how well: text at WCAG AA (4.5), lines and focus at 3. @see tokens.test */
export const CONTRAST: { fg: string; bg: string; min: number }[] = [
  ...["surface-0", "surface-1", "surface-2", "surface-3"].flatMap((bg) => [
    { fg: "fg", bg, min: 4.5 },
    { fg: "fg-muted", bg, min: 4.5 },
    ...ROLES.map((r) => ({ fg: r, bg, min: 3 })),
  ]),
  ...["surface-0", "surface-1"].map((bg) => ({ fg: "line-strong", bg, min: 3 })),
  ...ROLES.map((r) => ({ fg: r, bg: `${r}-soft`, min: 4.5 })),
];

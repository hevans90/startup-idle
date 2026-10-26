import { describe, expect, test } from "bun:test";
import { parse, wcagContrast } from "culori";

import { CONSOLE_AI, CONTRAST, ROLES, tokens, type Theme } from "./tokens";
import { themeCss } from "./install";

describe("the console's tokens", () => {
  for (const theme of ["light", "dark"] as Theme[]) {
    const t = tokens(theme);
    test(`${theme}: every role has its three faces, and every one is a colour`, () => {
      for (const r of ROLES) for (const k of [r, `${r}-soft`, `${r}-line`]) expect(parse(t[k])).toBeDefined();
    });

    test(`${theme}: what must read, reads`, () => {
      const short = CONTRAST
        .map(({ fg, bg, min }) => ({ fg, bg, min, got: wcagContrast(t[fg], t[bg]) }))
        .filter((p) => p.got < p.min)
        .map((p) => `${p.fg} on ${p.bg}: ${p.got.toFixed(2)} < ${p.min}`);
      expect(short).toEqual([]);
    });
  }

  test("written as variables for both themes, the console's colour mixed wherever its inputs change", () => {
    const css = themeCss();
    expect(css).toContain(`:root { --ui-surface-0: ${tokens("light")["surface-0"]};`);
    expect(css).toContain(`.dark { --ui-surface-0: ${tokens("dark")["surface-0"]};`);
    expect(css).toMatch(/:root, \.dark, \.console-scope \{ --ui-console: color-mix/);
  });

  test("the takeover mix rises with the stage, from none to all", () => {
    const order = ["tool", "assistant", "colleague", "manager", "overseer", "ascension"].map((s) => CONSOLE_AI[s]);
    expect(order[0]).toBe(0);
    expect(order[order.length - 1]).toBe(1);
    for (let k = 1; k < order.length; k++) expect(order[k]).toBeGreaterThan(order[k - 1]);
  });
});

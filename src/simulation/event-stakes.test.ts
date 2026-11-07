/**
 * THE STAKES of each map event's choices, across many companies: far enough
 * apart to matter, no choice simply always right, and the default seldom the
 * worst. The costs are the model's. `BALANCE=1` prints every event's split.
 * @see event-model, plans/events-overhaul.md "Stakes you feel"
 */
import { describe, expect, test } from "bun:test";

import { GAP } from "../world/events/director";
import { EVENT_DEFS } from "../world/events/defs";
import type { EventKind } from "../world/events/events";
import { EVENTS, company } from "./event-model";

/** Each event's choices, and the share of companies each is best for. */
export function dominance(draws = 4000, seed = 7): Record<string, Record<string, number>> {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const out: Record<string, Record<string, number>> = {};
  for (const [event, choices] of Object.entries(EVENTS)) {
    const wins: Record<string, number> = Object.fromEntries(Object.keys(choices).map((k) => [k, 0]));
    for (let k = 0; k < draws; k++) {
      const c = company(rand);
      let best = "", least = Infinity;
      for (const [name, cost] of Object.entries(choices)) {
        const v = cost(c);
        if (v < least) { least = v; best = name; }
      }
      wins[best]++;
    }
    out[event] = Object.fromEntries(Object.entries(wins).map(([k, n]) => [k, n / draws]));
  }
  return out;
}

/** Seconds of income between one event and the next: the middle of the director's gap. @see GAP */
export const BETWEEN = (GAP[0] + GAP[1]) / 2;

/**
 * THE STAKES: each event's median gap between its best and worst choice
 * (those that can be taken), as a share of the income till the next event.
 */
export function stakes(draws = 4000, seed = 7): Record<string, number> {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const out: Record<string, number> = {};
  for (const [event, choices] of Object.entries(EVENTS)) {
    const gaps: number[] = [];
    for (let k = 0; k < draws; k++) {
      const c = company(rand);
      const costs = Object.values(choices).map((cost) => cost(c)).filter(Number.isFinite);
      gaps.push(Math.max(...costs) - Math.min(...costs));
    }
    gaps.sort((a, b) => a - b);
    out[event] = gaps[gaps.length >> 1] / BETWEEN;
  }
  return out;
}

describe("dominant choices", () => {
  test("no event has a choice that is best for nearly every company", () => {
    const d = dominance();
    if (process.env.BALANCE) {
      for (const [event, split] of Object.entries(d)) {
        console.log(`${event.padEnd(14)} ${Object.entries(split).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(" · ")}`);
      }
    }
    for (const [event, split] of Object.entries(d)) {
      expect(Math.max(...Object.values(split))).toBeLessThanOrEqual(0.7);
    }
  });
});

/** The rare, big ones, whose stakes are higher. @see plans/events-overhaul.md "Stakes you feel" */
const RARE = new Set(["river-flood", "heatwave"]);
/** Each event's stakes, as a share of the income till the next: ordinary, and rare. */
const ORDINARY_BAR: readonly [number, number] = [0.05, 0.15];
const RARE_BAR: readonly [number, number] = [0.15, 0.4];

/** How often each event's default is the worst of its choices that can be taken. */
export function defaultWorst(draws = 4000, seed = 7): Record<string, number> {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const out: Record<string, number> = {};
  for (const [event, choices] of Object.entries(EVENTS)) {
    const d = EVENT_DEFS[event as EventKind].default;
    let worst = 0;
    for (let k = 0; k < draws; k++) {
      const c = company(rand);
      const costs = Object.entries(choices).map(([id, cost]) => [id, cost(c)] as const).filter(([, v]) => Number.isFinite(v));
      if (costs.reduce((a, b) => (b[1] > a[1] ? b : a))[0] === d) worst++;
    }
    out[event] = worst / draws;
  }
  return out;
}

describe("the stakes", () => {
  test("each event's best and worst choice are far enough apart to matter, and not so far as to decide the run", () => {
    const st = stakes();
    if (process.env.BALANCE) for (const [e, v] of Object.entries(st)) console.log(`${e.padEnd(14)} ${(v * 100).toFixed(1)}%`);
    for (const [event, share] of Object.entries(st)) {
      const [lo, hi] = RARE.has(event) ? RARE_BAR : ORDINARY_BAR;
      expect({ event, share: share >= lo && share <= hi }).toEqual({ event, share: true });
    }
  });

  test("every choice modelled is one the event has, and its default is seldom the worst", () => {
    for (const [event, choices] of Object.entries(EVENTS)) {
      const def = EVENT_DEFS[event as EventKind];
      expect(Object.keys(choices).sort()).toEqual(def.choices.map((c) => c.id).sort());
    }
    const worst = defaultWorst();
    if (process.env.BALANCE) for (const [e, v] of Object.entries(worst)) console.log(`${e.padEnd(14)} default worst ${(v * 100).toFixed(0)}%`);
    // With two choices, the default is the worst whenever the other is best: held to the dominance bar.
    for (const [event, share] of Object.entries(worst)) {
      const bar = Object.keys(EVENTS[event]).length > 2 ? 0.5 : 0.7;
      expect({ event, share: share <= bar }).toEqual({ event, share: true });
    }
  });
});

/**
 * THE CONSOLE'S TIMINGS: an entrance in steps — a dialog's frame, then its
 * title, then its body, then its buttons — and a list's rows staggered in;
 * both within the budgets, and both all at once when calm. Timers, never a
 * frame loop: nothing runs once it has arrived. @see ENTER_MOST, STAGGER_MS
 */
import { useEffect, useState } from "react";

import { ENTER_MOST, STAGGER_MOST, STAGGER_MS } from "./console";

/** When each of `steps` steps begins, s: evenly through the budget, the first at once. */
export const stepTimes = (steps: number, total = ENTER_MOST): number[] =>
  Array.from({ length: steps }, (_, k) => (steps <= 1 ? 0 : (k * total) / steps));

/** How many of `steps` have begun; all of them at once when `calm`. Starts again when `key` changes. */
export function useSequence(steps: number, calm: boolean, key: unknown = null, total = ENTER_MOST): number {
  const [n, setN] = useState(calm ? steps : 1);
  useEffect(() => {
    if (calm) { setN(steps); return; }
    setN(1);
    const timers = stepTimes(steps, total).slice(1).map((t, k) => window.setTimeout(() => setN(k + 2), t * 1000));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [steps, calm, key, total]);
  return n;
}

/** The delay of a list's row, ms: staggered for the first `STAGGER_MOST`, the rest with the last; none when calm. */
export const staggerDelay = (index: number, calm: boolean): number => (calm ? 0 : Math.min(index, STAGGER_MOST) * STAGGER_MS);

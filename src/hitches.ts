/**
 * `?hitches`, in development: WHAT BLOCKS THE MAIN THREAD, by name.
 *
 * The frame meter averages, and drops the frames far out of character — so a
 * hitch of a third of a second five times a second is invisible on it while
 * the game is unplayable. This times every timer, interval and animation-frame
 * callback the page registers, filed under where it was registered (the first
 * frame of the stack outside this file), and `__hitches()` lists them by the
 * worst single run. Installed before anything else loads, so it sees them all.
 * @see main.tsx
 */
type Tally = { n: number; total: number; max: number };
const tallies = new Map<string, Tally>();
/** Whether `?hitches` is on: `section` is a no-op without it. */
let on = false;

/** Where a callback came from: the first line of the stack that is not this file. */
function whence(): string {
  const lines = (new Error().stack ?? "").split("\n").slice(2);
  const line = lines.find((l) => !l.includes("hitches")) ?? "?";
  return line.trim().replace(/^at /, "").replace(/\?[^:)]*/, "").replace(location.origin, "");
}

function timed<A extends unknown[]>(where: string, fn: (...a: A) => unknown) {
  return (...a: A) => {
    const t0 = performance.now();
    try { return fn(...a); } finally {
      const ms = performance.now() - t0;
      const t = tallies.get(where) ?? { n: 0, total: 0, max: 0 };
      t.n++; t.total += ms; t.max = Math.max(t.max, ms);
      tallies.set(where, t);
    }
  };
}

export function installHitches() {
  on = true;
  const w = window as unknown as Record<string, unknown>;
  const si = window.setInterval.bind(window), st = window.setTimeout.bind(window), raf = window.requestAnimationFrame.bind(window);
  w.setInterval = (fn: TimerHandler, ms?: number, ...a: unknown[]) =>
    typeof fn === "function" ? si(timed(`interval ${whence()}`, fn as (...x: unknown[]) => unknown), ms, ...a) : si(fn, ms, ...a);
  w.setTimeout = (fn: TimerHandler, ms?: number, ...a: unknown[]) =>
    typeof fn === "function" ? st(timed(`timeout ${whence()}`, fn as (...x: unknown[]) => unknown), ms, ...a) : st(fn, ms, ...a);
  w.requestAnimationFrame = (fn: FrameRequestCallback) => raf(timed(`raf ${whence()}`, fn));
  w.__hitches = (top = 15) =>
    [...tallies.entries()]
      .map(([where, t]) => ({ where, n: t.n, max: Math.round(t.max), mean: Math.round((t.total / t.n) * 10) / 10, total: Math.round(t.total) }))
      .sort((a, b) => b.max - a.max)
      .slice(0, top);
  w.__hitchesReset = () => tallies.clear();
}


/**
 * A NAMED SECTION of some bigger callback — the scene's tick is one callback
 * that does everything — timed into the same list as the timers: `section`
 * at its start, the returned function at its end.
 */
export function section(name: string): () => void {
  if (!on) return noop;
  const t0 = performance.now();
  return () => {
    const ms = performance.now() - t0;
    const t = tallies.get(name) ?? { n: 0, total: 0, max: 0 };
    t.n++; t.total += ms; t.max = Math.max(t.max, ms);
    tallies.set(name, t);
  };
}
const noop = () => {};

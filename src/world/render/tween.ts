/**
 * World v2 — TWEENS: a number eased from one value to another over a time,
 * written through a setter each frame. The map's small motions — a building
 * dropping into place, a house hopping as it grows — are these. Stepped from
 * the scene's ticker; nothing here touches Pixi. @see juice
 */

export type Ease = (t: number) => number;

export const EASE = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  /** Past the end and back: a landing with a little give. */
  outBack: (t: number) => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  /** Up and down again: 0 at both ends, 1 in the middle. */
  hop: (t: number) => Math.sin(Math.PI * t),
} satisfies Record<string, Ease>;

type Tween = { from: number; to: number; ms: number; at: number; ease: Ease; set: (v: number) => void; done?: () => void; alive?: () => boolean };

export type Tweens = {
  /** Ease `set` from `from` to `to` over `ms`; `alive` false stops it unfinished, `done` runs at the end. */
  add: (t: Omit<Tween, "at">) => void;
  /** Step them all on by `dtMs`. */
  step: (dtMs: number) => void;
  /** How many are running. */
  readonly size: number;
  /** Stop them all, each set to its end. */
  finish: () => void;
};

export function createTweens(): Tweens {
  let list: Tween[] = [];
  return {
    add(t) { list.push({ ...t, at: 0 }); },
    step(dtMs) {
      if (!list.length) return;
      const next: Tween[] = [];
      for (const t of list) {
        if (t.alive && !t.alive()) continue;
        t.at += dtMs;
        const k = Math.min(1, t.ms > 0 ? t.at / t.ms : 1);
        t.set(t.from + (t.to - t.from) * t.ease(k));
        if (k < 1) next.push(t);
        else t.done?.();
      }
      list = next;
    },
    get size() { return list.length; },
    finish() {
      for (const t of list) if (!t.alive || t.alive()) { t.set(t.from + (t.to - t.from) * t.ease(1)); t.done?.(); }
      list = [];
    },
  };
}

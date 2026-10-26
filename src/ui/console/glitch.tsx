/**
 * THE CONSOLE'S GLITCH: anything, now and then, torn — sliced into bands
 * jolted sideways and split into its red and its cyan — by an SVG filter made
 * for it alone. Still between bursts, and then no filter is on it at all, so
 * a glitching thing at rest costs nothing; calm, it never glitches.
 *
 *   noise, flat along x (bands) → quantised (each band its own shift)
 *     → displaces the element → its red one way, its green and blue the other
 *
 * `useGlitch(ref)` for an element you already have, its kick for a burst on
 * cue; `useTakeoverGlitch(ref)` to tear as hard as the takeover has got;
 * `<Glitch>` to wrap one. @see FounderCard, Transmission, AscensionCard
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

import { useConsoleMotion } from "../motion";
import { CONSOLE_AI } from "../theme/tokens";

export type GlitchOptions = {
  /** How hard it tears, 0–1 and past: the bands' shift and the colours' split. */
  strength?: number;
  /** Seconds between bursts, on average; null, only when kicked. */
  every?: number | null;
  /** Seconds a burst lasts, on average. */
  burst?: number;
  /** A burst as soon as it is on: something arriving. */
  arrive?: boolean;
  /** Off, it is simply itself. */
  active?: boolean;
};

/** A burst now, harder or longer than its own if asked. */
export type Kick = (opts?: { strength?: number; burst?: number }) => void;

const SVG = "http://www.w3.org/2000/svg";
let made = 0;

const el = (name: string, attrs: Record<string, string>, parent: Element) => {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
};

/** THE FILTER, in its own hidden SVG: what each frame of a burst sets. */
function makeFilter() {
  const id = `ui-glitch-${++made}`;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none");
  const filter = el("filter", { id, x: "-15%", y: "-5%", width: "130%", height: "110%", "color-interpolation-filters": "sRGB" }, el("defs", {}, svg));
  // Bands: noise that never changes along x, each band one shift.
  const noise = el("feTurbulence", { type: "fractalNoise", baseFrequency: "0 0.05", numOctaves: "1", seed: "1", result: "noise" }, filter);
  const bands = el("feComponentTransfer", { in: "noise", result: "bands" }, filter);
  const funcR = el("feFuncR", { type: "discrete", tableValues: "0.5" }, bands);
  el("feFuncG", { type: "discrete", tableValues: "0.5" }, bands);
  const tear = el("feDisplacementMap", { in: "SourceGraphic", in2: "bands", scale: "0", xChannelSelector: "R", yChannelSelector: "G", result: "torn" }, filter);
  // The split: red one way, green and blue the other, screened back together.
  el("feColorMatrix", { in: "torn", type: "matrix", values: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", result: "red" }, filter);
  const redShift = el("feOffset", { in: "red", dx: "0", dy: "0", result: "redOff" }, filter);
  el("feColorMatrix", { in: "torn", type: "matrix", values: "0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0", result: "cyan" }, filter);
  const cyanShift = el("feOffset", { in: "cyan", dx: "0", dy: "0", result: "cyanOff" }, filter);
  el("feBlend", { in: "redOff", in2: "cyanOff", mode: "screen" }, filter);
  document.body.appendChild(svg);
  return { id, svg, noise, funcR, tear, redShift, cyanShift };
}

const vary = (s: number) => s * (0.5 + Math.random());

/**
 * GLITCH THIS ELEMENT, now and then, until it goes or `active` is off; and
 * whenever the kick it hands back is called. Calm, the kick does nothing.
 */
export function useGlitch(ref: RefObject<Element | null>, { strength = 1, every = 3, burst = 0.35, arrive = false, active = true }: GlitchOptions = {}): Kick {
  const calm = useConsoleMotion().calm;
  const kick = useRef<Kick>(() => {});
  // THE ELEMENT, as it is after each commit: one shown later, or swapped, is picked up.
  const [node, setNode] = useState<Element | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- every commit, by design; set only when it changed
  useLayoutEffect(() => { if (ref.current !== node) setNode(ref.current); });
  useEffect(() => {
    const target = node as (HTMLElement | SVGElement) | null;
    if (!target || !active || calm) return;
    const f = makeFilter();
    const was = target.style.filter;
    let timer = 0;

    // A FRAME of a burst: new bands, a new tear, a new split.
    const frame = (k: number) => {
      f.noise.setAttribute("seed", String(Math.floor(Math.random() * 1000)));
      f.noise.setAttribute("baseFrequency", `0 ${(0.01 + Math.random() * 0.08).toFixed(3)}`);
      // Most bands stay put (0.5); a few go left or right.
      const table = Array.from({ length: 8 }, () => (Math.random() < 0.6 ? 0.5 : Math.random()).toFixed(2));
      f.funcR.setAttribute("tableValues", table.join(" "));
      f.tear.setAttribute("scale", String(Math.round(k * (12 + Math.random() * 48))));
      const split = k * (1 + Math.random() * 4);
      f.redShift.setAttribute("dx", split.toFixed(1));
      f.cyanShift.setAttribute("dx", (-split).toFixed(1));
    };
    const rest = () => {
      target.style.filter = was;
      if (every != null) timer = window.setTimeout(() => start(strength, burst), vary(every) * 1000);
    };
    const start = (k: number, long: number) => {
      window.clearTimeout(timer);
      const ends = performance.now() + vary(long) * 1000;
      target.style.filter = `url(#${f.id})`;
      const step = () => {
        if (performance.now() >= ends) return rest();
        frame(k);
        timer = window.setTimeout(step, 40 + Math.random() * 70);
      };
      step();
    };
    kick.current = (o) => start(o?.strength ?? strength, o?.burst ?? burst);
    if (arrive) start(strength, burst);
    else if (every != null) timer = window.setTimeout(() => start(strength, burst), Math.random() * every * 1000);
    return () => {
      kick.current = () => {};
      window.clearTimeout(timer);
      target.style.filter = was;
      f.svg.remove();
    };
  }, [node, strength, every, burst, arrive, active, calm]);
  return useCallback<Kick>((o) => kick.current(o), []);
}

/**
 * HOW HARD THE TAKEOVER TEARS THE CONSOLE: nothing till the Colleague, then
 * more often and harder by the stage — now and then at the Colleague, steadily
 * at the Overseer. @see CONSOLE_AI
 */
export function takeoverGlitch(mix: number): GlitchOptions {
  if (mix < CONSOLE_AI.colleague) return { active: false };
  return { strength: Math.min(1.2, 0.2 + mix), every: 2 + 22 * (1 - mix) ** 1.5 };
}

/** GLITCH THIS ELEMENT AS THE TAKEOVER DOES: harder with the stage. @see takeoverGlitch */
export function useTakeoverGlitch(ref: RefObject<Element | null>, extra: Omit<GlitchOptions, "strength" | "every"> = {}): Kick {
  const mix = useConsoleMotion().mix;
  const o = takeoverGlitch(mix);
  return useGlitch(ref, { ...extra, ...o, active: (extra.active ?? true) && o.active !== false });
}

/** ANYTHING, GLITCHING: a box round it that tears now and then. */
export function Glitch({ children, className, style, ...options }: GlitchOptions & { children?: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useGlitch(ref, options);
  return <div ref={ref} className={className} style={style}>{children}</div>;
}

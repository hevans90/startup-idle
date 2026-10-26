/**
 * THE CONSOLE'S GLITCH: anything, now and then, torn — sliced into bands
 * jolted sideways and split into its red and its cyan — by an SVG filter made
 * for it alone. Still between bursts, and then no filter is on it at all, so
 * a glitching thing at rest costs nothing; calm, it never glitches.
 *
 *   noise, flat along x (bands) → quantised (each band its own shift)
 *     → displaces the element → its red one way, its green and blue the other
 *
 * `useGlitch(ref)` for an element you already have; `<Glitch>` to wrap one.
 * @see FounderCard (the Model, locked)
 */
import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";

import { useConsoleMotion } from "../motion";

export type GlitchOptions = {
  /** How hard it tears, 0–1 and past: the bands' shift and the colours' split. */
  strength?: number;
  /** Seconds between bursts, on average. */
  every?: number;
  /** Seconds a burst lasts, on average. */
  burst?: number;
  /** Off, it is simply itself. */
  active?: boolean;
};

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

/** GLITCH THIS ELEMENT, now and then, until it goes or `active` is off. */
export function useGlitch(ref: RefObject<Element | null>, { strength = 1, every = 3, burst = 0.35, active = true }: GlitchOptions = {}) {
  const calm = useConsoleMotion().calm;
  useEffect(() => {
    const target = ref.current as (HTMLElement | SVGElement) | null;
    if (!target || !active || calm) return;
    const f = makeFilter();
    const was = target.style.filter;
    let timer = 0;

    // A FRAME of a burst: new bands, a new tear, a new split.
    const frame = () => {
      f.noise.setAttribute("seed", String(Math.floor(Math.random() * 1000)));
      f.noise.setAttribute("baseFrequency", `0 ${(0.01 + Math.random() * 0.08).toFixed(3)}`);
      // Most bands stay put (0.5); a few go left or right.
      const table = Array.from({ length: 8 }, () => (Math.random() < 0.6 ? 0.5 : Math.random()).toFixed(2));
      f.funcR.setAttribute("tableValues", table.join(" "));
      f.tear.setAttribute("scale", String(Math.round(strength * (12 + Math.random() * 48))));
      const split = strength * (1 + Math.random() * 4);
      f.redShift.setAttribute("dx", split.toFixed(1));
      f.cyanShift.setAttribute("dx", (-split).toFixed(1));
    };
    const rest = () => {
      target.style.filter = was;
      timer = window.setTimeout(start, vary(every) * 1000);
    };
    const start = () => {
      const ends = performance.now() + vary(burst) * 1000;
      target.style.filter = `url(#${f.id})`;
      const step = () => {
        if (performance.now() >= ends) return rest();
        frame();
        timer = window.setTimeout(step, 40 + Math.random() * 70);
      };
      step();
    };
    timer = window.setTimeout(start, Math.random() * every * 1000);
    return () => {
      window.clearTimeout(timer);
      target.style.filter = was;
      f.svg.remove();
    };
  }, [ref, strength, every, burst, active, calm]);
}

/** ANYTHING, GLITCHING: a box round it that tears now and then. */
export function Glitch({ children, className, style, ...options }: GlitchOptions & { children?: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useGlitch(ref, options);
  return <div ref={ref} className={className} style={style}>{children}</div>;
}

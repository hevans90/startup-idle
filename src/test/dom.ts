/**
 * A DOM FOR A TEST THAT NEEDS ONE: happy-dom's window, its globals put where
 * React and the kit look for them. Imported first by the tests that render
 * (the kit's); the rest of the suite keeps the bare stubs of preload.ts, which
 * deliberately leave `window` undefined. Returns how to take it away.
 */
import { GlobalWindow as Window } from "happy-dom";

const KEYS = [
  "window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "Element", "Node", "Text", "SVGElement", "SVGSVGElement",
  "SVGPathElement", "SVGGElement", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "CustomEvent", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver", "DocumentFragment", "matchMedia",
] as const;

export function installDom(): { window: Window; remove: () => void } {
  const win = new Window({ url: "http://localhost/", width: 1280, height: 800 });
  const g = globalThis as Record<string, unknown>;
  const was = new Map(KEYS.map((k) => [k, g[k]]));
  for (const k of KEYS) g[k] = k === "window" ? win : (win as unknown as Record<string, unknown>)[k];
  // Observers the kit's frames use, which do nothing here: there is no layout to observe.
  g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (win as unknown as Record<string, unknown>).ResizeObserver = g.ResizeObserver;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    window: win,
    remove: () => {
      for (const [k, v] of was) g[k] = v;
      void win.happyDOM.close();
    },
  };
}

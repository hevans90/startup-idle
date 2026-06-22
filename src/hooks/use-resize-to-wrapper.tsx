import { useCallback, useRef, useState, type RefObject } from "react";

type Size = {
  width: number;
  height: number;
};

/**
 * Tracks an element's size. Returns a `setRef` callback to attach to the
 * element, a `ref` object (for consumers that need a RefObject, e.g. Pixi's
 * `resizeTo`), and the measured `size`.
 *
 * Uses a CALLBACK ref so measurement begins the instant the element mounts —
 * even if that's long after the hook first ran (e.g. the element lives behind a
 * conditional gate like the founder-select screen). A `useEffect(…, [ref])`
 * would fire once before the element exists and never re-run, leaving `size`
 * stuck at null.
 */
export const useResizeToWrapper = (): {
  ref: RefObject<HTMLDivElement | null>;
  setRef: (el: HTMLDivElement | null) => void;
  size: Size | null;
} => {
  const ref = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [size, setSize] = useState<Size | null>(null);

  const setRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    ref.current = el;
    if (!el) return;
    const measure = () =>
      setSize({ width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observerRef.current = ro;
  }, []);

  return { ref, setRef, size };
};

import { RefObject, useEffect, useState } from "react";

type Size = {
  width: number;
  height: number;
};

export const useResizeToWrapper = (
  ref: RefObject<HTMLDivElement | null>
): Size | null => {
  const [size, setSize] = useState<Size | null>(null);

  useEffect(() => {
    if (!ref || !ref.current) return;
    const measure = () => {
      const el = ref.current;
      setSize(el ? { width: el.offsetWidth, height: el.offsetHeight } : null);
    };
    // Measure synchronously on mount: ResizeObserver's first callback isn't
    // guaranteed to fire promptly in every environment, and waiting on it
    // leaves the wrapper (and the Pixi canvas gated on its size) unmounted.
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(ref.current);
    return () => resizeObserver.disconnect();
  }, [ref]);

  return size;
};

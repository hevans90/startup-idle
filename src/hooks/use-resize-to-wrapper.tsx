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
    const resizeObserver = new ResizeObserver(() => {
      setSize(
        ref.current
          ? {
              width: ref.current.offsetWidth,
              height: ref.current.offsetHeight,
            }
          : null
      );
    });
    resizeObserver.observe(ref.current);
    return () => resizeObserver.disconnect();
  }, [ref]);

  return size;
};

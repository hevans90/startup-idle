import { RefObject, useCallback, useEffect } from "react";

export const useDisableDOMZoom = ({
  wrapperRef,
}: {
  wrapperRef: RefObject<HTMLDivElement | null>;
}) => {
  const handleWheelEvent = useCallback((e: WheelEvent) => {
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (wrapperRef?.current) {
      wrapperRef?.current.addEventListener("wheel", handleWheelEvent, {
        passive: false,
      });
    }

    return () => {
      if (wrapperRef?.current) {
        wrapperRef.current.removeEventListener("wheel", handleWheelEvent);
      }
    };
  }, []);
};

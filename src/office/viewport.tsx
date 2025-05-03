import { memo, useCallback, useEffect, useRef } from "react";

import { extend, useApplication } from "@pixi/react";

import { Viewport } from "pixi-viewport";
import { Rectangle, Text } from "pixi.js";

import { useOfficeStore } from "../state/office.store";
import { clampViewport } from "./utils/clamp-viewport";
import { updateScaledObjects } from "./utils/update-scaled-objects";

extend({ Viewport, Text });

export type AppViewportProps = {
  children: React.ReactNode;
  screenSize: {
    width: number;
    height: number;
  };
};

export const AppViewport = memo(
  ({ children, screenSize }: AppViewportProps) => {
    const updateScaledContainers = (viewport: Viewport) => {
      if (viewport) {
        updateScaledObjects(viewport);
      }
    };

    const setViewport = useOfficeStore((state) => state.setViewport);

    const pixiApp = useApplication();
    const events = pixiApp?.app.renderer?.events;
    const ticker = pixiApp?.app.ticker;
    const viewportRef = useRef<Viewport>(null);

    const initViewport = useCallback(() => {
      if (viewportRef.current) {
        viewportRef.current
          .drag({
            clampWheel: false,
            mouseButtons: "left-middle",
          })
          .pinch({ noDrag: false })
          .wheel({
            percent: 3,
            trackpadPinch: true,
            wheelZoom: false,
          })
          .clampZoom({
            minScale: 0.1,
            maxScale: 15,
          });

        // Add event listeners
        const onZoomed = () => {
          if (viewportRef.current) {
            viewportRef.current.plugins.remove("clamp");
            updateScaledContainers(viewportRef.current);
          }
        };

        const onZoomEnd = () => {
          if (viewportRef.current)
            clampViewport(
              viewportRef.current,
              new Rectangle(0, 0, screenSize.width, screenSize.height)
            );
        };

        const onSnapZoomEnd = () => {
          if (viewportRef.current) {
            updateScaledContainers(viewportRef.current);
          }
        };

        viewportRef.current.on("zoomed", onZoomed);
        viewportRef.current.on("zoomed-end", onZoomEnd);
        viewportRef.current.on("snap-zoom-end", onSnapZoomEnd);

        setViewport(viewportRef.current);
        console.info("VIEWPORT: bootstrapped");

        viewportRef.current.fitWidth(screenSize.width * 2, true);

        return () => {
          if (viewportRef.current) {
            viewportRef.current.off("zoomed", onZoomed);
            viewportRef.current.off("zoomed-end", onZoomEnd);
            viewportRef.current.off("snap-zoom-end", onSnapZoomEnd);
          }
        };
      } else {
        console.error("VIEWPORT: failed, retrying...");
        const timeoutId = setTimeout(initViewport, 100); // Retry after 100ms
        return () => clearTimeout(timeoutId);
      }
    }, []);

    useEffect(() => {
      const eventListenerCleanup = initViewport();

      return eventListenerCleanup;
    }, [initViewport]);

    if (!ticker || !events) {
      console.error(
        "VIEWPORT: events or ticker undefined, skipping render cycle"
      );
      return null;
    }

    return (
      // @ts-expect-error nice
      <viewport
        label="viewport"
        screenWidth={screenSize.width}
        screenHeight={screenSize.height}
        events={events}
        ticker={ticker}
        ref={viewportRef}
      >
        {children}
        {/* @ts-expect-error nice */}
      </viewport>
    );
  }
);

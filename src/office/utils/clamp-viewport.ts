import { Viewport } from "pixi-viewport";
import { Rectangle } from "pixi.js";

export const clampViewport = (viewport: Viewport, screenSize: Rectangle) => {
  const padding = 1000;
  const zoom = viewport.scale.x;

  const viewWidth = viewport.screenWidth / zoom;
  const viewHeight = viewport.screenHeight / zoom;

  const margin = padding / 1 / zoom;

  const left =
    screenSize.x - Math.max(0, (viewWidth - screenSize.width) / 2) - margin / 2;

  const right =
    screenSize.x +
    screenSize.width +
    Math.max(0, (viewWidth - screenSize.width) / 2) +
    margin / 2;

  const top = screenSize.y - Math.max(0, (viewHeight - screenSize.height) / 2);

  const bottom = Math.max(viewHeight, screenSize.height + margin / 2);

  viewport.clamp({
    left,
    right,
    top,
    bottom,
    underflow: "none",
  });
};

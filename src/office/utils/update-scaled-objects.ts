import { Viewport } from "pixi-viewport";
import { findChildrenByName } from "./recursive-container-search";

/**
 * Runs logic to preserve the scale of any recursive child of the viewport.
 * To preverse scale, add `PRESERVE_SCALE` to the `label` property of an item.
 * Substrings work, so `xxx_PREVERSE_SCALE` is fine.
 */
export const updateScaledObjects = (viewport: Viewport) => {
  const preservedScaleObjects = findChildrenByName({
    container: viewport,
    labelSubstring: "PRESERVE_SCALE",
  });

  for (const element of preservedScaleObjects) {
    element.scale.y = 1 / viewport.scale.y;
    element.scale.x = 1 / viewport.scale.x;
  }
};

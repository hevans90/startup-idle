/** Small helpers shared by the map's cards: a countdown, and the camera to a tile. */
import { useWorldStore } from "../../state/world.store";
import { HH, HW } from "../iso";

export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** How long the camera takes to fly to a tile, ms. */
export const FLY_MS = 550;

/**
 * Fly the camera to a tile: eased there over `FLY_MS`, not cut, so the eye
 * can follow where it went. A drag or a wheel on the way stops it.
 */
export function showMe(where: { x: number; y: number }) {
  const vp = useWorldStore.getState().viewport;
  if (!vp) return;
  vp.plugins.remove("animate");
  vp.animate({
    position: { x: (where.x - where.y) * HW, y: (where.x + where.y) * HH },
    time: FLY_MS, ease: "easeInOutCubic", removeOnInterrupt: true,
    callbackOnComplete: () => vp.emit("moved", { viewport: vp, type: "drag" } as never),
  });
}

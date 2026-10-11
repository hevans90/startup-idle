/** Small helpers shared by the map's cards: a countdown, and the camera to a tile. */
import { useWorldStore } from "../../state/world.store";
import { HH, HW } from "../iso";

export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Centre the camera on a tile. */
export function showMe(where: { x: number; y: number }) {
  const vp = useWorldStore.getState().viewport;
  if (!vp) return;
  vp.moveCenter((where.x - where.y) * HW, (where.x + where.y) * HH);
  vp.emit("moved", { viewport: vp, type: "drag" } as never);
}

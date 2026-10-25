/** Small helpers shared by the map's cards: a countdown, the camera to a tile, and to a feature's project. */
import { PROJECTS, type FeatureId } from "../../game/projects";
import { useSessionStore } from "../../state/session.store";
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

/**
 * SHOW ME the project that opens a feature: its site, if it is being built;
 * otherwise the projects log, opened, where it waits. @see Locked
 */
export function showProject(feature: FeatureId) {
  const p = PROJECTS.find((q) => q.grants === feature);
  // Its site, if it is being built: as `siteOf` finds it — not imported, as that would bring the map's engine into the sidebar's bundle.
  const site = p ? [...useWorldStore.getState().grid.structures.values()].find((s) => s.def === p.structure && s.build) : undefined;
  if (site) showMe({ x: site.x + 1, y: site.y + 1 });
  else useSessionStore.getState().setProjectsOpen(true);
}

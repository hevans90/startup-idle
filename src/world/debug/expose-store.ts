/**
 * Puts the editor store on `window` in dev.
 *
 * Not a convenience: under Vite, `await import("…/world.store")` from a
 * devtools console resolves through a DIFFERENT module graph and hands back a
 * SECOND store instance, whose state has nothing to do with the one the UI is
 * rendering. Any assertion made against it is silently meaningless. This
 * module runs inside the app's own graph, so the handle it exposes is the real
 * one — the only reliable way to inspect the live map from outside React.
 */
import { getNetwork, netComponentAt, useWorldStore } from "../../state/world.store";

declare global {
  interface Window {
    __world?: typeof useWorldStore;
    /** Road graph, for the same reason: it lives outside the store entirely. */
    __net?: { get: typeof getNetwork; at: typeof netComponentAt };
    /**
     * Mounted structures, set by the scene.
     *
     * Needed for the same reason as the others — it lives outside the store —
     * and specifically because an ANIMATED structure cannot be checked any
     * other way from outside: the Pixi canvas has no `preserveDrawingBuffer`,
     * so reading its pixels back outside its own frame returns an empty image,
     * and a comparison of two such reads looks exactly like a still surface.
     */
    __structures?: unknown;
    /**
     * The live water field, for the same reason.
     *
     * Depth is a float updated every frame and held outside the store, so this
     * is the only way to look at it from a console — and the only way to check
     * a flow sim without watching it, since the canvas cannot be read back.
     */
    __water?: unknown;
    /** The water mesh layer, so a frame can be drawn by hand when rAF is paused. */
    __waterLayer?: unknown;
    /** Drives frames by hand, past the rAF throttle. See world-scene. */
    __waterBench?: (n?: number, sync?: boolean) => Promise<unknown>;
    /** Draws one scene both ways and compares the pixels. See water-compare. */
    __waterCompare?: (o?: Record<string, number>) => unknown;
    /**
     * The band layer, so a console session can move the camera.
     *
     * Band visibility is culled by a `useTick`, and a hidden browser tab does
     * not get one — so a scripted camera move leaves everything it moved to
     * still culled away, and the map looks empty for no reason at all.
     */
    __bands?: unknown;
  }
}

if (import.meta.env.DEV) {
  window.__world = useWorldStore;
  window.__net = { get: getNetwork, at: netComponentAt };
}

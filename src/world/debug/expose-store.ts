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
  }
}

if (import.meta.env.DEV) {
  window.__world = useWorldStore;
  window.__net = { get: getNetwork, at: netComponentAt };
}

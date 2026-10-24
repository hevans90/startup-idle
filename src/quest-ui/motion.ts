/**
 * QUEST UI — LESS MOTION: whether the player has asked the system for it.
 * Then frames are simply there and text appears whole. Read live, so a change
 * in the system's setting is followed without a reload.
 */
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";
const media = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null);

/** Whether less motion is asked for, now. */
export const reducedMotion = (): boolean => media()?.matches ?? false;

/** The same, as a hook that re-renders when it changes. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (on) => {
      const m = media();
      m?.addEventListener("change", on);
      return () => m?.removeEventListener("change", on);
    },
    reducedMotion,
    () => false,
  );
}

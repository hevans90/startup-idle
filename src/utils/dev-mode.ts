/**
 * Whether the app is running locally (localhost). Gate dev-only affordances
 * (cheats, inspectors, debug panels) behind this so they appear during local
 * development but never on a deployed build — the seed of a fuller local dev
 * mode. Runtime check (by hostname), not build-time, so it also covers a local
 * production preview.
 */
export const isLocalDev = (): boolean => {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "[::1]" ||
    h.endsWith(".local")
  );
};

/**
 * Human-readable duration ("2d 3h", "5m 12s", "8s"). Shows the two largest
 * meaningful units, with seconds resolution so short, live-ticking timers read
 * naturally. Negative/NaN inputs clamp to "0s".
 */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

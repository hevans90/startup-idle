/**
 * World v2 — what the ports EARN: a fee for every call completed, paid to the
 * company, with a record of it for whoever shows it — the "+$X" rising off a
 * port, and the port's label saying what it makes a minute.
 * @see portCallFee, Traffic.calls
 *
 * Live state like the traffic: not saved, and nothing earned while the map is
 * not running.
 */

/** A fee paid, for the "+$X" over the port. */
export type Paid = { port: number; amount: number; at: number };

export type Exports = {
  /** Fees paid in the last minute or so, by port. */
  recent: Map<number, Paid[]>;
  /** Fees not yet shown rising off their port. Drained by whoever shows them. */
  fresh: Paid[];
};

/** How far back "a minute" looks, ms. */
const WINDOW = 60_000;

export const createExports = (): Exports => ({ recent: new Map(), fresh: [] });

/** A call paid for. */
export function recordCall(e: Exports, port: number, amount: number, now: number): void {
  const paid = { port, amount, at: now };
  const list = (e.recent.get(port) ?? []).filter((p) => now - p.at < WINDOW);
  list.push(paid);
  e.recent.set(port, list);
  e.fresh.push(paid);
  // Nobody is showing them: do not let them pile up.
  if (e.fresh.length > 64) e.fresh.splice(0, e.fresh.length - 64);
}

/** What a port has made in the last minute. */
export function perMinute(e: Exports, port: number, now: number): number {
  return (e.recent.get(port) ?? []).reduce((n, p) => (now - p.at < WINDOW ? n + p.amount : n), 0);
}

/**
 * World v2 — WHAT THE PORTS' TRADE DOES for the town, beyond its fees.
 *
 * A fitted berth's calls keep a METER up: materials landed, hardware landed,
 * ferries run, yachts in. Each is nought to one, pushed up by every call at
 * a berth of its kind and running down by itself in a few minutes, so an
 * effect is earned by trade and kept only while the trade goes on.
 * @see FITTINGS, plans/seaports.md §3
 *
 * Live state, like the traffic: not saved. Away from the game the fees are
 * credited at the rate last seen; the meters start again from nought.
 */
export type TradeKind = "materials" | "hardware" | "ferries" | "yachts";

const meters: Record<TradeKind, number> = { materials: 0, hardware: 0, ferries: 0, yachts: 0 };

/**
 * Seconds for a full meter to run down with no trade; and what a boat's call
 * adds to its meter, a bigger ship's by its berth-time. Set so ONE BERTH OF
 * THE SMALLEST PORT, kept busy, fills its meter in a few minutes and holds
 * it: a ferry ramp at a tier 1 turns a boat round in 24 seconds. At 0.12 a
 * call against three minutes' run-down that ramp never got its meter over an
 * eighth, and a pontoon among quays not much further.
 * @see simulation/port-balance.test.ts
 */
export const TRADE_LASTS = 300;
export const TRADE_A_CALL = 0.2;

/** At full, a site's loads cost this much less; racks and the AI's buildings this much less. */
export const MATERIALS_OFF = 0.3;
export const HARDWARE_OFF = 0.25;
/** At full, new hires set off this many times as often. */
export const FERRY_SPEED = 2;
/** At full, valuation grows this much faster. */
export const YACHT_VALUATION = 0.08;

export const tradeLevel = (k: TradeKind) => meters[k];

/** A call at a berth of this kind, worth `weight` boats' calls. */
export function creditTrade(k: TradeKind, weight = 1): void {
  meters[k] = Math.min(1, meters[k] + TRADE_A_CALL * weight);
}

/** `dt` seconds of the meters running down. */
export function stepTrade(dt: number): void {
  for (const k of Object.keys(meters) as TradeKind[]) meters[k] = Math.max(0, meters[k] - dt / TRADE_LASTS);
}

/** Start again from nought: a new map, or a test. */
export function resetTrade(): void {
  for (const k of Object.keys(meters) as TradeKind[]) meters[k] = 0;
}

/** What a building site's load costs, against its usual price, for the materials landed. */
export const materialsMult = () => 1 - MATERIALS_OFF * meters.materials;
/** What a rack or one of the AI's buildings costs, for the hardware landed. */
export const hardwareMult = () => 1 - HARDWARE_OFF * meters.hardware;
/** How many times as often new hires set off, for the ferries run. */
export const ferrySpeed = () => 1 + (FERRY_SPEED - 1) * meters.ferries;
/** What valuation's growth is multiplied by, for the yachts in. */
export const yachtValuation = () => 1 + YACHT_VALUATION * meters.yachts;

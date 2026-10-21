/**
 * WATER MAINS, the rules: how much a main carries, from how much head over
 * how long a run. Plain hydraulics a player can be told — more head, more
 * flow; a longer run carries less — and pure, so the tool's preview and the
 * map's delivery are the same sum. Calibrated to what the old pipes were
 * measured to carry: a 20-tile gravity run with the water 2½ slabs up, 0.95
 * a second; a pump, at most `PUMP_RATE`. @see world/water/mains, plans/pipes-overhaul.md
 */
import { PUMP_HEAD, PUMP_RATE, WATER_PER_AGENT } from "./cooling";

/** Half steps of head the reference flow is at; that flow, a second, before the run's length. */
export const MAIN_REF_HEAD = 5;
export const MAIN_REF_FLOW = 1.425;
/** Tiles of run at which a main carries half what a short one does. */
export const MAIN_LENGTH = 40;
/** The most a main carries, a second, a bore. */
export const MAIN_MAX = 2;

/** What a main carries a second over `head` half steps and `length` tiles, of `bore` bores; nought with no head. */
export function mainFlow(head: number, length: number, bore = 1): number {
  if (!(head > 0)) return 0;
  return Math.min(MAIN_MAX * bore, (bore * MAIN_REF_FLOW * Math.sqrt(head / MAIN_REF_HEAD)) / (1 + Math.max(0, length) / MAIN_LENGTH));
}

/** What a pump at an intake adds to its head, and the most it moves a second. */
export const pumpLift = () => PUMP_HEAD;
export const PUMP_MOST = PUMP_RATE;

/** How many agents a flow cools, at full power. */
export const agentsCooled = (flow: number) => Math.floor(flow / WATER_PER_AGENT + 1e-9);

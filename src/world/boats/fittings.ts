/**
 * World v2 — what a BERTH DOES: its fitting.
 *
 * A port's size is how much quay it has; a fitting is what one berth of it is
 * for. Each berth takes one, chosen on the port's card and changed at will,
 * and the ships sent to the port come for the berths it has: a ferry for a
 * ferry ramp, a yacht for a pontoon. A fitted berth pays less of the plain
 * fee than a trading quay, and does something for the town instead — so what
 * each is worth depends on what the town is short of. @see plans/seaports.md §3
 *
 * THE TRADING QUAY IS TODAY'S PORT: the full fee, any ship, nothing else. A
 * port never fitted out is all trading quays, and earns what it always did.
 */
import type { Structure } from "../grid";
import type { TradeKind } from "./trade";

export type FitId = "trade" | "ferry" | "crane" | "hardware" | "gantry" | "pontoon";

export type Fitting = {
  id: FitId;
  name: string;
  /** The smallest port it can be fitted at, by its berths. */
  tier: number;
  /** The ship classes that call at it, by number. @see SHIP_CLASSES */
  classes: readonly number[];
  /** The share of the plain fee a call at it pays. */
  pay: number;
  /** What its calls keep up, if anything. @see trade */
  keeps?: TradeKind;
  /** What it does, in a line. */
  does: string;
  /** What must be open before it can be fitted, for the card to say. */
  needs?: "datacentre";
};

export const FITTINGS: readonly Fitting[] = [
  { id: "trade", name: "Trading quay", tier: 1, classes: [0, 1, 2], pay: 1, does: "Full fee" },
  { id: "ferry", name: "Ferry ramp", tier: 1, classes: [0], pay: 0.5, keeps: "ferries", does: "Hires arrive sooner" },
  { id: "crane", name: "Cargo crane", tier: 2, classes: [0, 1], pay: 0.35, keeps: "materials", does: "Site loads cost less" },
  { id: "hardware", name: "Hardware berth", tier: 2, classes: [0, 1], pay: 0.35, keeps: "hardware", does: "Racks cost less", needs: "datacentre" },
  { id: "gantry", name: "Container gantry", tier: 3, classes: [2], pay: 1.5, does: "Ships only, fee and a half" },
  { id: "pontoon", name: "Pontoon", tier: 3, classes: [0], pay: 0.6, keeps: "yachts", does: "Valuation grows faster" },
];

const BY_ID = new Map(FITTINGS.map((f) => [f.id, f]));
export const fitting = (id: string | undefined): Fitting => BY_ID.get(id as FitId) ?? FITTINGS[0];

/** What a port's berth is fitted with: a trading quay unless it says otherwise. */
export const fitOf = (s: Pick<Structure, "fit">, berth: number): Fitting => fitting(s.fit?.[berth]);

/** Whether a fitting can go on a port of this many berths. */
export const fitsTier = (f: Fitting, berths: number) => f.tier <= berths;

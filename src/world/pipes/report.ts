/**
 * World v2 — WHAT A PIPE NETWORK IS DOING, in one shape: a water main, a
 * sewer connection above ground and a trunk under it all report the same
 * thing — a state, what it could carry and what it did, how long and how
 * wide it is, and what it joins — so the cards, the overlays and the lists
 * read one type. A trunk adds what only it has: what came down its manholes,
 * what came up in the street, its lift stations. @see plans/pipe-network.md §5
 */

/**
 * A main's or a connection's state:
 *  - `flowing`: carrying into its buildings;
 *  - `full`: it could, and every tank it feeds is full;
 *  - `dry`: every intake's water has gone;
 *  - `no-head`: the water stands too low to reach the building — it needs a pump;
 *  - `unpaid`: its pump wants paying and the company cannot;
 *  - `no-source` / `no-outlet`: it has no intake, or feeds nothing;
 *  - `burst`, `backed-up`: the events'.
 */
export type MainState = "flowing" | "full" | "dry" | "no-head" | "unpaid" | "no-source" | "no-outlet" | "burst" | "backed-up";
/** A trunk's state. */
export type SewerState = "flowing" | "idle" | "no-exit" | "surcharged" | "backed-up" | "unpaid";
export type PipeState = MainState | SewerState;

/** What only a trunk has to say: slop a second in at its manholes, put somewhere, and brought up in the street; its lift stations by cell. */
export type TrunkFlow = { inflow: number; delivered: number; spilled: number; lifts: number[] };

export type PipeReport<S extends PipeState = PipeState> = {
  state: S;
  /** Half steps of head to its best-placed outlet; units a second it could carry, and carried this frame. */
  head: number;
  capacity: number;
  flow: number;
  /** Tiles long; its bore, 1 or 2. */
  length: number;
  bore: number;
  /** Each outlet's building, what it could take a second, and whether a pump is doing the lifting. */
  outlets: { cell: number; building: number; capacity: number; pumped: boolean }[];
  /** Each intake's water surface, or null if dry, how deep it stands there, and how fouled (nought to one); whether it is a pump. */
  intakes: { cell: number; surface: number | null; depth: number; pump: boolean; fouled: number }[];
  /** A CONNECTION's: the workplaces it takes slop from, by id, its outfalls by cell, and its manhole if it reaches one. @see stepSewers */
  sewer?: { sources: number[]; outfalls: number[]; node?: number };
  /** A TRUNK's. */
  trunk?: TrunkFlow;
};

/** A water main's report, or a connection's. */
export type MainReport = PipeReport<MainState>;
/** A trunk's report. */
export type SewerReport = PipeReport<SewerState> & { trunk: TrunkFlow };

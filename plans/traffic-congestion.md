# Traffic that matters: congestion

## Why

The cars and people on the map are decoration, but they are not harmless:
- every driving mover yields to every other (`trafficLimit`), so a decorative trip can queue in front of a project's delivery lorry and slow the build;
- commutes, which do cost the company, are pure road distance (`seat`, `commute.ts`), and no car on screen plays any part in them.

So what you see and what you pay disagree. The goal is one model of traffic that both the economy and the screen follow: a jam you see is a jam you pay for, and road layout becomes a real decision (second access roads, offices beside housing, no single bottleneck).

**Decisions taken:**
- congestion is real;
- the visual cap raise is held until this lands, then becomes "cars on screen follow the flow".

## How it works today (what is reused)

- **`seat(g, places)`** pairs houses with desks, nearest first by road distance. The distance comes from `walkFrom`, a breadth-first search that counts ramps as `CLIMB`. It returns each house's `Commute` (`tiles`, `eff`, `to`, `deskless`) and each workplace's desks.
- **`commuteEfficiency(tiles)`**: 8 tiles are free (`FREE`), then 1.25% per tile, down to 0.5 (`WORST`); 0.25 if stranded.
- **The economy:** `commuteFactor` feeds attendance (`setProjectReader`) and mood (the "long commute" and "no desk" parts in `mood.ts`).
- **The AI planner's town model** (`town-model.ts`) calls `seat` too, so congestion reaches its plans for free.
- **Live movers:** 60% of car trips are already commutes (`commuteTrip`, from `liveCommutes`).

## The model (deterministic, no live simulation)

1. **Flow.** Each house's commuters drive (commute over `WALK_TO_WORK` tiles) or walk. Each driver adds one car to every road cell on the path to its desk, traced back down the workplace's distance field. Delivery lorries' routes (`stepWorks`) add their load too, weighted heavier.
2. **Capacity.** Each road cell gets one:
   - one lane each way on a single road, more on a wide road (paved beside it, as `carLine` already detects);
   - junctions a little less;
   - ramps a little less.
3. **Travel time.** Each cell's time is free time × (1 + 0.15 (load / capacity)^4), the standard road-traffic (BPR) curve. Near-free until a road fills, then steeply worse.
4. **Seating in time, not tiles.** `seat` pairs houses and desks by travel time (Dijkstra over cell times instead of the breadth-first walk). Two rounds:
   1. seat at free flow, load the roads;
   2. seat again at those times.

   That's a cheap, deterministic approximation of everyone picking the quickest way. A commute's `tiles` becomes *effective tiles* (travel time in tile-equivalents), so `commuteEfficiency`, mood and attendance need no changes. The commute also records `jam` (effective minus actual tiles).
5. **Memo.** Recomputed exactly when seating is today (`liveSeating`'s memo: map revision, sites, residents), so it costs nothing per frame.

## Shown to the player

- **Mood:** a house whose commute is mostly jam shows "stuck in traffic" instead of "long commute" (same points rule).
- **Labels:** "Commute 14 tiles (6 in traffic)".
- **A traffic overlay**, beside the existing street-heat overlay: each street coloured by load / capacity, green through red.
- **Live cars follow the flow:**
  - commute trips are drawn in proportion to each route's load, so busy roads look busy;
  - a car's cruise speed on a cell is scaled by that cell's congestion, so a jammed road visibly crawls;
  - the number of cars on screen follows total flow, which replaces the held cap raise.
- **Freight priority:** lorries stop yielding to trip cars. Their delay comes from the congestion field instead: their speed on each cell is scaled the same way. That's deterministic, offline-safe, and matches what you see.

## Phases (each with tests, `npx tsc -b`, eslint and a commit)

1. **Flow and capacity:**
   - `agents/traffic-flow.ts`: `flowOf(g, seating, places)` → load per road cell; `capacityAt`; `cellTime`;
   - tests on a constructed town: a single-access cul-de-sac jams, a grid doesn't.
2. **Seating in travel time:**
   - `seat` takes a cell-time field: Dijkstra, two rounds, `Commute.jam`;
   - the existing seating, commute and town-model tests are held to their current results at free flow;
   - new tests: a bottleneck lengthens commutes, and a second road relieves it.
3. **Economy and mood:**
   - attendance and mood read congested commutes (no change of formulas);
   - "stuck in traffic" mood part, labels;
   - the AI benchmark re-run: does tall planning lay out roads that don't jam? If not, the planner gets a road-relief step.
4. **Freight:**
   - lorries stop yielding to trip cars, and their per-cell speed is scaled by congestion;
   - `works` tests: a jammed route delivers later.
5. **Visuals:**
   - the traffic overlay;
   - live commute trips weighted by route load;
   - cruise speed scaled by congestion;
   - cars on screen from total flow, which supersedes the held cap raise.
6. **Balance:**
   - pick capacities and the curve so a sensible town of each size barely congests, and a one-road sprawl with one office loses 10–25% attendance;
   - the balance sim (`BALANCE=1 bun test src/simulation/map-balance.test.ts`) and the AI benchmark as guards.

## Open questions

- Should people on foot congest pavements? Proposed: no; only cars load roads.
- Should gateway (through) traffic from map edges load roads? Proposed: a small constant per gateway pair, so edge roads see some traffic.
- What effect should the Hivemind (wide) style have on congestion? Long streets of starter lots should jam; that's its intended cost.

## Verification

- Unit tests per phase (above).
- `?fixture=bigtown`: the traffic overlay shows jams on the long rows into the few offices. Adding a cross street visibly relieves them, and attendance rises.
- The AI planning benchmark and the map balance sim stay within their guards (or are re-baselined with the numbers in the commit).
- `?hitches`: seating recompute stays under a frame on `bigtown`.

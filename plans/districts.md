# Districts: planned blocks for AI mode, and for a head start

Status: **built** (2026-11-26): phases 1–3, and build drones for AI mode (`world/drones/`).

## What is wrong today

AI mode is the pilot (`world/ai/pilot/`, The Model's runs); its town desk builds from `masterplan/`.

- **Lots in a line.** `lotStep` (schedule.ts:179) puts each lot at the most desirable valid tile on the whole map, and a lot needs road frontage, so every lot strings along the one starting road.
- **No roads.** A street step is worth 0 (town.ts:299) and is laid only when no lot or office fits anywhere (`wanted` in chooser; pilot.test.ts:83 asserts it). While any frontage is left, nothing new is laid.
- **Builds on roads that are not open.** `touchesRoad` (place.ts:155) counts road-job cells as frontage. The schedule's own `laid` uses `isPaved`, so it re-orders pieces already ordered; the order is refused and the block dropped (town.ts:189, 221).
- **Too many offices.** `desksShort` counts every lot as 12 future beds (`TALL_BEDS`, even an empty starter lot), and `planTown` plans up to 24 offices a kind ahead of anyone living there.
- The company AI (`planner.ts`) is separate: offices it never builds; roads only as 4–7 tile stubs off dead ends from the Manager on. Out of scope here except that it can use the same layouts later.

## What we build

A **district**: a square of blocks the planner lays out whole, and then builds in order — **arterial first, streets next, then lots and offices only on open road**.

```
 ═══════════════════════════   ← arterial (the district's edge), joined to the town by a connector
 ║ h h h ║ h h h ║ o o o ║
 ║───────╫───────╫───────║   ← streets every 3 tiles: a lot either side
 ║ h h h ║ s s s ║ o o o ║   h house lot · o office · s service / plaza / landmark
 ═══════════════════════════
```

### Phase 1 — the utilities (pure, tested; no behaviour changes)

`src/world/districts/`:

- **`routeRoad(g, from, to, opts)`**: an A* over tiles. It costs slope, water (refused, or bridged where `gradeRoad` allows), structures (refused) and turns, and returns straight runs ready for `paveRoad`/`orderRoad`. Today the only road router is harbour's 40-tile BFS.
- **`layoutDistrict(g, origin, spec)`**: a square grid of `blocks × blocks`. Each block is `BLOCK` tiles of lots between 3-tile street rows, with an arterial ring. The result is `{ arterial, streets, lots: {def, at, tier}[], offices, centre, footprint }`. Lots are validated with `validatePlacement` against the grid *as planned* (roads included), using the same rules as play.
- **`findDistrictSite(g, size, near, owned)`**: the nearest dry, buildable, mostly flat square of that size whose arterial can be joined to the network by `routeRoad`. It scores ground to level, trees to fell, and connector length.
- **`deskBalance(lots, offices)`**: offices sized to **beds that exist or are under way at their current tier**, not 12 per future lot. A district's office share is set from that.
- **`placeDistrictNow(g, plan, opts)`**: lays the whole plan at once (paved, finished, lived in). It reuses the fixtures' path: `placeCommand` with no `build`, `residents` filled, `rebuildNet`. This is for the head start.

Tests: layouts on flat, river, hilly and island fixtures; every lot fronts a planned road; no plan crosses water without a bridge; desks within ±10% of beds; a placed district passes `validatePlacement` tile for tile and is reachable by `isConnected`.

### Phase 2 — AI mode builds districts

Replace the town desk's greedy `lotStep` and `officeStep` with a district at a time:

1. Pick a site (`findDistrictSite` near the town centre, then outward), and show it as the AI's planned footprint.
2. **Roads first:** the connector and arterial, then streets, each as one `orderRoad`.
3. **Wait for them to open:** lots and offices only where `isPaved` is true, not road-job cells. The AI gets its own `touchesOpenRoad` rule; the player's rules are unchanged.
4. Lots, then offices by `deskBalance`, then services and a landmark slot in the centre.
5. When the district is full, start the next one beside it, sharing an arterial.

Tests to update:
- `pilot.test.ts:83`: streets now have worth through their district.
- `masterplan/offices`, `schedule` and `style`: rewritten to district semantics.
- `benchmark`: district beats today's greedy.
- `pilot-run`: 200 housed and desked within today's time bound, with `roadWorks` on.

### Phase 3 — head starts in the Machine

A fifth ring of the Machine, past the keystones, revealed an Ascension after them. These are big bonuses. Each one uses `placeDistrictNow` in the founding-gifts effect (`world-canvas.tsx:102`), which runs once per generated map and never on load. Residents are added as owned employees, and `remoteBeds` is set so they aren't counted as remote.

- **Ready-made Suburb:** a full district of lived-in intern and vibe-coder houses with desks to match.
- **Studio District:** a finished Vibe Coder Studio and a vibe district around it.
- Others in the same style, each a single district shape, priced 150 Weights and up.

## Order

1. Phase 1 utilities and their tests.
2. A debug fixture that lays a district, to look at it.
3. Phase 3's two head starts, which only need Phase 1.
4. Phase 2, the AI rework, with its tests moved over.

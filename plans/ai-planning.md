# AI mode planning, drastically better: tall and wide

## Context

AI mode (The Model's autopilot, `src/world/ai/autopilot.ts`) now plans one 9×9 block at a time (`blockAt` in `masterplan/plan.ts`). It plans the block's streets and frontage (`planTown`) and builds it step by step (`nextStep` in `masterplan/schedule.ts`). It is greedy about lots: every free tile of frontage gets a starter lot, and services go in only once enough lots are unserved. Traits barely touch it (`masterplan/style.ts`: service thresholds, water margin, growing out from the Data Centre).

### The game's rules reward tall
From `game/housing.ts`, `agents/mood-rules.ts` and `agents/services.ts`:
- **Beds:** every lot is 1×1 at every tier, with 2 / 5 / 12 / 30 beds (t0 / t1 / t2 / tower). A tower holds 15× a starter lot on the same tile.
- **Growth:** a lot grows a tier when it is full and its mood has stayed at 4 / 10 / 16 or more for 20 s (`GROW_AT`, `GROW_AFTER`).
- **Mood:** it comes from services within 8 road tiles (café +4, park +6, gym +4, or −6 with none), water within 2 tiles (+5), a wonder within 10 (+5), and the commute (0 within 8 tiles, then −0.6 a tile, down to −30).
- **Crowding:** a t2 lot or tower with no park in reach takes −6 (`desirabilityAt`).
- **The tower recipe:**
  - t2: a park plus a café or gym.
  - Tower: all three plus water or a wonder, with the commute under 8 tiles.
- **Why mood matters beyond beds:** mood also sets each kind's satisfaction target, and satisfaction multiplies income, up to 10×.

### The town model has gaps
`settledTown` (`masterplan/town-model.ts`) is how the planner scores a layout, and it is wrong in ways that matter here:
- it ignores crowding;
- it ignores the 10x devs' move-in threshold of mood 10 or more (`MOVE_IN_AT`);
- it computes mood once, before seating, so desk shortages don't feed back;
- it can downgrade a house below the tier it was bought at.

### The goal
The Model plans in a **style set by its traits**, on a dial from wide to tall:
- **Tall (most traits, and the default):** compact blocks built round a park, services first, lots only where they will grow, offices within the 8-tile commute, rebuilding where it pays.
- **Wide (Hivemind):** long streets of cheap lots, few services, quick beds.

It **chooses between candidate plans by looking ahead** with a corrected town model. The **player sees the style**, and the holograms show the tier each house is planned to reach.

### Decisions taken
- **Wide traits:** Hivemind only.
- **Several traits:** a tallness score.
- **Rebuilding:** yes, when it pays back.
- **Scope:** look-ahead evaluation, and showing the style to the player.

## 1. The town model, made faithful (`masterplan/town-model.ts`)

`settledTown(g, opts?)` is rewritten to the live rules, reusing them rather than restating them:
- **Tiers:** iterate to a fixed point, at most 3 rounds:
  1. compute each house's mood with `desireAt` plus the crowding rule from `desirabilityAt`, which needs a park for t2 and up;
  2. grow each house a tier while `desirabilityAt(m, t, next) >= GROW_AT[next]`, never dropping below its bought tier (`s.grown` semantics);
  3. seat everyone (`seat`) and feed the "no desk" and long-commute losses back into mood.
- **10x devs:** their houses with mood under `MOVE_IN_AT["10x_dev"]` stay empty.
- **Outputs:** `{ beds, work, moodByKind, tiers }`.
  - `moodByKind` is the resident-weighted mean, as `moodOffsets` computes it.
  - `work` stays as Σ residents × commute efficiency.
  - **Income:** add an estimate of steady income, multiplying work by each kind's satisfaction multiplier, using `satisfactionRevenueMultiplier` with the mood offset added to a neutral base. This is what the planner maximises.
- **Tests:** in a small town, the model's tiers match the live evolution (run `stepEvolution` with live moods for a few simulated minutes). In particular, a park-less café-and-gym block settles at t1, not t2.

## 2. The style dial (`masterplan/style.ts`)

**Tallness score** `tallness(traits)`:
- the base is +1, so everything leans tall;
- each trait adds its own pull;
- the sum is clamped to [−2, +2] and mapped to `tall ∈ [0, 1]`.

| Trait | Pull |
|---|---|
| Aesthete, Zoner, Nanny, Patient, Ego | +1 (quality, monuments, a short leash) |
| HR, Accountant, Ruthless, Paranoid, Hydrophile | +0.5 (efficiency is tall: beds per tile and mood per dollar) |
| Mirror, Restless, Resentful | 0 |
| **Hivemind** | **−3** (one Hivemind outweighs a typical lineage and makes it wide) |

`Style` gains `tall` and parameters derived from it, all interpolated between the wide and tall ends:
- `parkFirst`: true when tall ≥ 0.5;
- `serve`: unserved lots a service waits for, from 2 (tall) to 9 (wide);
- `targetTier`: `landmark` above 0.75, `t2` above 0.4, else `t1`;
- `reachOnly`: lots only on frontage within `RANGE` of a planned or existing park;
- `commuteCap`: desks within 8 tiles when tall;
- `rebuild`: true when tall ≥ 0.5.

The existing Paranoid, Hydrophile and Data Centre pulls stay. `styleOf` keeps its signature, so the worker, `nextStep` and the autopilot pick these up through `Style` as they already do.

## 3. Block plans by style (`masterplan/plan.ts`)

Within the 9×9 block, `planTown` builds in one of two orders.

**Tall (`parkFirst`):**
1. Streets: the existing row and connector pattern.
2. A **park at the block's heart**: the tile reaching the most planned frontage within `RANGE`.
3. A café and a gym where they cover the same frontage. Each is skipped if one already reaches it.
4. **Lots only on frontage that can reach `targetTier`**, by the corrected model's tier projection. Frontage that can't is left for a service or an office.
5. An office within `commuteCap` of the block's lots if desks are short. Its candidate spots are scored by the walk from the lots' doors (`walkFrom`).

Each planned lot records its **projected tier** for the holograms (§6).

**Wide:**
- streets, then lots on all frontage;
- services only past `serve` unserved lots;
- offices placed by thickness, as today.

`nextStep` follows the same orders: services ahead of lots when `parkFirst`, lots only on reachable frontage when `reachOnly`, and offices by commute when `commuteCap` is set.

## 4. Look-ahead: candidates, scored (`masterplan/lookahead.ts`, new; run in the worker)

Each time a block is due, the worker builds several candidate plans and the autopilot takes the best:
- **Anchors:** the 3 best `blockAt` anchors by distance to the centre. Tall prefers infill beside existing services, wide the frontier.
- **Variants:** two street phases (the pattern offset 0 and 1), and the park on one of the 2 best heart tiles.
- **That makes** up to 3 × 2 × 2 = 12 candidates, each a small `planTown` on a clone. Measure on 96² maps, keeping the worker under ~300 ms a cycle.
- **Scoring:**
  1. apply the plan's steps to a clone, as the benchmark does;
  2. run the corrected `settledTown`;
  3. score Δ(settled steady income) ÷ the plan's cost (lots, services, offices, road; `buildCost`, `roadCost`).
  - **By style:** wide is scored on *immediate* beds per dollar (tiers at t0, no growth); tall on settled income. In between, the two blend by `tall`.
- **The result:** the masterplan request and response gain `candidates` and `chosen`, with the score, kept for the panel's "why".

## 5. Rebuilding on payback, when tall (`masterplan/rebuild.ts`, new; used by `nextStep`)

A new step kind, `replace`: pull down a t0 or t1 lot and build a park, café, gym or office there.
- **Candidates:** low-tier lots inside the block, or within `RANGE` of it, whose tile is the best heart for a missing park, or the best spot for a needed office.
- **Accept if:** settled income with the replacement minus without exceeds the lost beds' income plus the new building's cost, within a horizon (`REBUILD_HORIZON`, about 10 minutes of income). Measured with the corrected model on a clone.
- **Executing:** `demolishAt` then `placeStructure`, both through the drone. The hologram shows the new building in cyan and the old one in red.
- **Never:** a lot that grew beyond t1, or anything a project depends on.

## 6. Shown to the player

**AI mode panel** (`play/ai-mode-panel.tsx`):
- **Style line:** "Tall: towers round parks" or "Wide: streets of starter lots", with a small wide-to-tall meter and the traits pulling each way. For example: "Hivemind pulls wide; Aesthete, Patient pull tall".
- **Why line:** for the current block, "Chosen of 12: +$4.2k/s settled for $38k (towers III)", from `chosen`.

**Holograms** (`world-scene.tsx`, the plan-holo specs): a planned lot's hologram is drawn at its **projected tier**. `withTier(def, tier)` gives the glass t2 or tower, so you see the district it is building toward. The real build still starts at t0.

## 7. The benchmark (`masterplan/benchmark.test.ts`)

Extend the block-by-block benchmark:
- **Contestants:** each map is run with the tall style (`tall` = 1), the wide style (0) and the greedy player.
- **Scoring:** the corrected `settledTown` income, with growth, at the same budget, plus beds after a short horizon with no growth.
- **Guards:**
  - tall beats greedy on settled income by 15% or more (the bar now);
  - tall beats wide on settled income;
  - wide beats tall on early beds, which is its point.
- `BALANCE=1` prints all three, plus the tier mix (how many t1, t2 and towers).

## Phases (each with tests, `npx tsc -b`, eslint and a commit)

1. **The town model:** crowding, move-in, fixed point, bought-tier floor, income estimate; parity tests against the live evolution.
2. **The style dial:** `tallness`, the new `Style` fields; tests per trait mix.
3. **Plans by style:** tall and wide orders in `planTown` and `nextStep`; the projected tier on planned lots.
4. **Look-ahead:** candidates and scoring in the worker; plumb `chosen` through the autopilot; a timing check.
5. **Rebuild:** the `replace` step, payback test, drone and holograms.
6. **The player's view:** the panel's style and why lines; tiered holograms.
7. **Benchmark and balance:** three-way runs, guards, tune the trait pulls and thresholds.

## Files

- `src/world/ai/masterplan/town-model.ts`, `plan.ts`, `schedule.ts`, `style.ts`, `masterplan.worker.ts`
- New: `src/world/ai/masterplan/lookahead.ts`, `rebuild.ts`
- `src/world/ai/autopilot.ts` (request candidates, take `replace`, keep `chosen`)
- `src/world/play/ai-mode-panel.tsx`, `src/world/world-scene.tsx` (hologram tiers)
- `src/world/ai/masterplan/benchmark.test.ts` plus new tests beside each module

## Reused, not rewritten

- `desireAt` and `desireMapsOf` (`agents/desirability.ts`)
- `desirabilityAt`, `withTier`, `tierOf`, `RANGE`, `TIERS` (`agents/services.ts`)
- `GROW_AT`, `MOVE_IN_AT`, `MOOD` (`agents/mood-rules.ts`)
- `seat`, `DESKS`, `WORKPLACES` (`agents/commute.ts`)
- `satisfactionRevenueMultiplier` (`game/satisfaction.ts`)
- `buildCost`, `roadCost` (`game/build-cost.ts`)
- `blockAt`, `planTown`, `nextStep`, `cloneGrid`
- holograms (`render/holograms.ts`)
- the drone hand-off (`send` in `autopilot.ts`)

## Verification

- **Unit:**
  - the town model matches the live evolution: a park-less t2 is refused, the 10x move-in threshold holds, the bought-tier floor holds;
  - `tallness` per trait mix: Hivemind goes wide, the default leans tall;
  - a tall block plan puts a park before its lots, and its lots all project t2 or better;
  - a wide plan fills the frontage;
  - look-ahead picks the higher-scoring candidate on a constructed map;
  - `replace` is accepted only when it pays back, and never touches a t2;
  - the worker's cycle stays under budget on 96².
- **Benchmark:** `BALANCE=1 bun test src/world/ai/masterplan/benchmark.test.ts` — tall over greedy by 15% or more, tall over wide on settled income, wide over tall on early beds.
- **Browser** (isolated server, `/?fixture=singularity`, AI mode on, with "+1B money" in the sandbox):
  - the panel names the style and the chosen candidate;
  - holograms show the planned tiers, with a park at each block's heart;
  - towers appear within a few minutes;
  - a Hivemind lineage builds long streets of lots instead. Set it by changing the fixture seed's past trait to `hivemind` in `world/debug/fixture-company.ts`, which runs in the sandboxed copy only.
- **Full suite:** before each commit.

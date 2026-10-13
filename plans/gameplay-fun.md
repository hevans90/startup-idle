# Making the game more fun: a deep plan

## What is wrong today (measured, not guessed)

The balance sim (`BALANCE=1 bun test src/simulation/map-balance.test.ts`) plays a greedy
"buy the cheapest next thing" player on the town. Its timeline is the clearest picture of
the game we have:

| | when |
| --- | --- |
| 10 interns | 2.4 min |
| Studio opens | 5.6 min |
| Campus opens, first 10x dev | 18 min |
| Data Centre | 44 min |
| core upgrades done | 1.06 h |
| Conference Centre | 1.67 h |
| IPO Tower | **never, in 4 h** |

And headcount over the late run:

| at | interns | vibe coders | 10x devs | seconds of income for the next 10x dev |
| --- | --- | --- | --- | --- |
| 1.0 h | 342 | 88 | 3 | 21 |
| 1.5 h | 382 | 171 | 7 | 261 |
| 2.5 h | 382 | 180 | 8 | 947 |
| 4.0 h | 382 | 188 | 8 | 1,132 |

Five problems follow from that and from the code:

1. **A WALL AT 90 MINUTES.** Interns stop at 382 (cost ×1.1 each, so the next costs 2.6
   million seconds of income), 10x devs stop at 8 (cost **×10 each**, `costExponent: 10`),
   and there is no fourth kind to move on to. From 1.5 h the run is flat: nothing new to
   buy, nothing new to build, the last wonder out of reach. The only way forward is to sell,
   and nothing tells the player that, or makes the sale an event.

2. **THE MAP IS UPKEEP, NOT DECISIONS.** The greedy sim plays the town *well* — 50 lots,
   11 services, 11 offices — without ever choosing *where*. That is the tell: if a bot that
   ignores placement does fine, placement does not matter. Commute (free to 8 tiles),
   service range (8 road tiles) and mood are real, but they are passive multipliers the
   player cannot see while placing, so building is "beds ran out, drag another row".

3. **CHOICES ARE PRICE TAGS.** Events and fixes cost "N seconds of income" (sandbags 30 s,
   sludge trucks 20 s, tidying 10 s). Income grows exponentially, so by mid-game every
   option is affordable and the right answer is always "pay". A choice with a right answer
   is not a choice.

4. **EVERY RUN IS THE SAME RUN.** One linear unlock chain (garage → studio → campus →
   wonders), three employee kinds, and founders and skill-tree nodes that move numbers.
   The map's terrain changes, the strategy does not.

5. **WEAK FEEDBACK FROM THE MAP TO THE NUMBERS.** The money goes up in a corner; the town
   is beautiful but the player cannot see *which* building, street or decision is earning
   it. Labels say it if you read them.

## Pillars

Everything below serves one of these, and anything that serves none is cut.

- **P1 — Always a next goal.** No stretch longer than ~15 minutes where nothing new is
  within reach, from the first intern to the sale.
- **P2 — Where you build matters.** Placement is the game's core decision; the map shows
  the consequence before you click.
- **P3 — Choices cost something other than money.** Trade-offs in time, people, mood, land
  and risk, which do not inflate away.
- **P4 — Each run is a different town.** The map, the founder and the run's goals change
  what a good strategy is.
- **P5 — See the town earn.** Money and trouble visibly come from places on the map.

## Phase A — Break the wall (P1)

The shortest path to more fun: the game currently stops being a game at 90 minutes.

- **Fix the 10x dev curve.** Each costs ten times the last (`costExponent: 10` in
  `generators.store.ts`), so a run tops out at about eight — scarce on purpose, perhaps
  ("10x developers are a myth"), but with nothing after them it is where the run stops,
  and the Neural Bootstrap directive's 300 hired takes ~40 runs. Move to ×1.35–1.5 and
  re-tune their base cost so the first is still a milestone — or keep them rare and let
  AI agents (below) carry the late game.
- **A fourth kind: AI agents.** Opened by the Data Centre, housed not in lots but in
  *racks* (a datacentre-adjacent building), paid in power and innovation rather than beds.
  It fits the game's own joke (the singularity meter), gives the late game a new resource,
  and makes the Data Centre a turning point instead of a ×2.
- **Promotion instead of dead tiers.** Once interns stop being worth hiring, let the
  player *promote* them (intern → vibe coder at an innovation cost) so 382 interns are a
  pool, not a fossil. Same for vibe coder → 10x dev later.
- **The sale as a climax.** A visible valuation goal per run ("an offer at $X valuation"),
  offers arriving as events that rise and lapse, and the IPO Tower as the run's natural end
  (an IPO is a sale on your own terms: the best Equity multiplier). Target: a first run
  sells at **~2–2.5 h**, each later run 25–40% faster.
- **Validate in the sim:** add "longest flat stretch" (minutes with no new kind, project,
  tier or upgrade) to the report and guard it below 15 min; guard the IPO Tower inside 3 h.

## Phase B — Placement is the puzzle (P2, P5)

- **Desirability.** One number per tile, from what is near it: services (+), parks (+),
  water views (+), wonders (+), offices of the right kind (+, the commute), the slop pit,
  derelicts, floodable banks and busy roads (−). Houses grow and fill by it; it replaces
  the separate service-tier rule and folds in mood. (The pieces exist: `services.ts`,
  `mood.ts`, `commute.ts` — this unifies them into one thing the player can read.)
- **Show it before the click.** With a building in hand, tint the land by what that
  building would get there (a heat map like the Mood overlay), and float the numbers on
  the ghost: "+18% (café 3 tiles, studio 5 tiles), −5 (slop pit)". Placement becomes
  reading a map, not dragging rows.
- **Adjacency between workplaces.** Small, legible bonuses: a lab beside the campus (exists:
  +20%), a café beside an office (+desks morale), the Conference Centre beside the harbour
  (convoys pay more). A handful, each shown on the ghost.
- **Terrain becomes strategy.** Waterfront is the best land and the floodable land; hills
  are cheap and far; the river is ports and floods. The map generator's settings then
  change how a run plays, not just how it looks.
- **Money from places.** Floating income ticks over buildings ("+$1.2k" rising off a busy
  office), and a "what's earning" overlay ranking streets. The sale offer should name the
  town's best street.
- **Validate in the sim:** give the sim a placement-aware player and a random-placement
  player; the gap between them should be **20–40%** of income by the Campus. If it is near
  zero, placement still does not matter.

## Phase C — Choices that cost something real (P3)

- **Re-price events in non-money currencies.** Sandbags cost the *crew* (20 interns off
  work for a minute); evacuating costs *mood*; trucking sludge costs *road time* (trucks
  block the street); tidying for investors costs a *project's* progress. Money can still
  be one option, but never the dominant one.
- **Consequences that persist.** An ignored flood leaves *damaged* buildings that produce
  nothing until a repair crew visits; a failed investor tour lowers the next offer; a
  skipped hackathon lowers vibe satisfaction for a day. A few, legible, and shown on the
  map (a damaged building looks damaged).
- **Event chains.** A tour that goes well brings a term sheet event; a convoy that is
  served brings a regular route (a permanent port bonus). Choices open doors.
- **Two projects you can't both have.** At each era, a fork: e.g. Town Hall *or* a
  Co-working Hub (services vs desks), Conference Centre *or* a Hackerspace. Each run
  commits to a direction.

## Phase D — Every run a different town (P4)

- **Run goals ("term sheets").** At founding, pick one of three investor term sheets:
  "IPO in 3 h", "a 100-house town", "no slop overflow all run"… Each pays Equity on top
  of the sale and pushes a different strategy. (`directives.catalog.ts` has the bones of
  this as lifetime goals; term sheets are per run and chosen.)
- **Founders that change the game, not a number.** The Bootstrapper cannot buy land but
  builds cheaper; the Visionary sees one wonder early; the Hustler gets events twice as
  often with better payouts. One rule each, played on the map.
- **Map types that matter.** River, lake and hills already exist as settings; give each a
  reason to pick it (ports, waterfront desirability, cheap land) and a cost (floods, steep
  roads).
- **Skill-tree notables that unlock buildings and rules** (the four town perks are the
  model), fewer that add 3% to something.

## Phase E — The people are the town (P5)

- **Workplaces fill with the people who work there** (they already commute): a busy office
  looks busy, an understaffed one dark.
- **Team leaders matter on the map:** a leader's presence boosts the building they work in
  (shown), so where their house is becomes a decision.
- **The singularity meter as a late-game threat,** tied to AI agents (Phase A): run too
  many unhappy vibe coders and agents start "deciding things" — an event track with real
  stakes and a sale option that ends the run on the AI's terms (the AGI acquisition
  exists; make it a story beat).

## Measuring fun (applies to every phase)

The sim is the guardrail, extended to report what fun *is* in numbers:

- **Longest flat stretch** — minutes with nothing new in reach (Phase A: < 15).
- **Placement gap** — smart vs random placement income (Phase B: 20–40%).
- **Dominant choices** — for each event, how often the cheapest option is also the best
  over the next 10 minutes (Phase C: no option above 70%).
- **Run spread** — income curves of different term sheets / founders should differ by
  strategy, not just scale (Phase D).

And a playtest script per phase: a fresh run to the first sale, noting every moment of
"nothing to do" and every decision that felt obvious.

## Order and size

| Phase | Why this order | Size |
| --- | --- | --- |
| A — Break the wall | the game currently ends at 90 min; nothing else matters until it doesn't | M |
| B — Placement is the puzzle | the map is the game's identity and currently decorative | L |
| C — Real choices | cheap once B exists: costs can be paid in mood, land, crews | M |
| D — Different runs | needs A–C to have strategies worth varying | M |
| E — People on the map | polish of B and C, best last | M |

## Decisions needed before starting

1. **The fourth employee kind** — AI agents in racks (recommended), or no new kind and
   promotion only?
2. **Desirability replacing the service-tier and mood rules** — one unified number
   (recommended, simpler to read and to tune), or layered on top of what exists?
3. **Exclusive project forks** — in (recommended: they are what makes runs differ), or
   keep one chain everyone builds?

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

## Phase 0 — Upgrades and headcounts are the gates (P1, P3)

Today every project is gated by a headcount ("needs 10 interns") and the Boardroom by
Employee Management. The ladder is invisible until you reach a rung, and hiring is the
only lever. Instead:

- **Every project after the Garage needs an employee upgrade bought.** The upgrade is
  already a milestone the player chases on the Employees tab, so the two ladders become
  one: buy *Micromanagement*, and the Town Hall can be sited. Buying it is a choice (spend
  on the gate now, or on hires), which a headcount never was.
- **Every wonder needs headcounts of several kinds at once**, shown as progress in the
  wonders panel, so the late game reads as a target ("interns 342/350, vibe coders 88/150,
  10x devs 3/8") rather than a sentence.
- **The Garage stays ungated:** it is what makes hiring possible, so nothing can come
  before it.

### The gates (as built, 2026-10-13)

The first choice (Town Hall ← Micromanagement, Studio ← Mandatory Weekend Work, Campus ←
Intern Promotion) moved the Studio to 12.6 min and the Campus to 1.16 h in the sim. Re-picked
for pacing, the upgrades that become buyable nearest each project's old headcount:

| Project | Was | Gate | Buyable at |
| --- | --- | --- | --- |
| Founder's Garage | — | — | — |
| Vibe Coder Studio | 10 interns | **Micromanagement** ($400) | 15 interns |
| Town Hall | 6 interns | **Mandatory Weekend Work** ($2.2k) | 25 interns |
| Harbour Office | 5 vibe coders | **Promotion Griefing** ($10k) | 50 interns |
| Company HQ | 10 vibe coders | **Focus Vibing** ($7.5k) | 10 vibe coders |
| Boardroom Tower | Employee Management | **Upward Management** ($200k) + Employee Management | 100 interns + 35 vibe coders |
| Campus | 20 vibe coders | **JUULing** ($30k) | 20 vibe coders |

| Wonder | Was | Gate (all at once) |
| --- | --- | --- |
| Data Centre ★ | 3 10x devs | 120 interns · 50 vibe coders · 3 10x devs |
| Conference Centre ★ | 8 10x devs | 250 interns · 100 vibe coders · 6 10x devs |
| IPO Tower ★ | 15 10x devs | 350 interns · 150 vibe coders · 8 10x devs |

In the sim: Studio 5.6 → 7.8 min, Campus 18 → 25 min, Data Centre 44 → 52 min, Conference
Centre 1.67 → 1.2 h, IPO Tower never → 1.8 h. Guarded in `map-balance.test.ts`. The Studio
now comes before the Town Hall.

### Gates as data, not code

`ProjectDef.ready` and `readyWhen` are a function and a sentence; nothing can show
progress toward either. Replace them with data both the gate check and the UI read:

```ts
gate?: { upgrade?: string; feature?: string; staff?: Partial<Record<GeneratorId, number>> }
```

`ready` becomes one function over that (upgrade bought, feature unlocked, every count
met), and the sentence is generated from it.

### The UI

- **Projects log:** a locked project shows its gate as an icon chip — the upgrade's
  name, and a padlock, a "buy now" mark or a tick. Hovering (or tapping, on a phone) opens
  a popover: what the upgrade does (its description), its price, when it becomes buyable
  ("at 25 interns: you have 18"), and what it opens here. A button in the popover jumps
  to the upgrade on the Employees tab.
- **Employees tab:** an upgrade that gates a project carries a small tag, "Opens: Town
  Hall", with its own popover — so the link is visible from both ends, and the player
  learns why the upgrade matters before the project log ever mentions it.
- **Wonders panel:** each wonder lists its counts with a bar per kind, in the kind's
  colour, green when met; a popover on each count says how many more and what each costs
  at today's prices.
- Same popover component as the people row (`Stat` in `build-bar.tsx`), lifted into a
  shared one that opens on tap as well as hover (it is hover-only today).

### Done when

- Every project but the Garage has a gate; every gate names a real upgrade or count
  (a test walks `PROJECTS` and checks).
- The order holds: each project's gate is buyable no later than the next project's.
- The balance sim buys a gate's upgrade when it is the next thing in the way (the greedy
  player must know the gate exists), and its guards hold: 10 interns < 5 min, Campus
  < 30 min; and new guards: Data Centre < 1 h, IPO Tower reachable in the late run.
- Hints, the README's projects table and the event that checks for the HQ/Town Hall
  ("investor tour") still read correctly.

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
| 0 — Upgrades and headcounts as gates | small, visible, and it sets the ladder A re-tunes | S–M |
| A — Break the wall | the game currently ends at 90 min; nothing else matters until it doesn't | M |
| B — Placement is the puzzle | the map is the game's identity and currently decorative | L |
| C — Real choices | cheap once B exists: costs can be paid in mood, land, crews | M |
| D — Different runs | needs A–C to have strategies worth varying | M |
| E — People on the map | polish of B and C, best last | M |

## Decisions (2026-10-13)

1. **The fourth employee kind: AI agents**, opened by the Data Centre, housed in racks,
   paid in power and innovation.
2. **Placement: one desirability score** per tile, replacing the separate service-tier and
   mood rules; houses grow and fill by it, and it is shown as a heat map while placing.
3. **Project forks: yes.** At each stage one of two projects, so each run commits to a
   direction.

## Status (2026-10-13)

Built, phase by phase — everything above except where noted:

- **0** — upgrade gates for every project, headcount gates for every wonder, shown as chips and bars.
- **A** — AI agents in racks; the sale as the run's end with an acquirer's offer event; the
  longest flat stretch guarded in the sim. Promotion of interns to vibe coders for innovation, dearer each time. *Not built:*
  vibe coder → 10x dev promotion, which would sidestep the 10x devs' scarcity.
- **B** — one desirability score, the placing heat map and its readout, houses growing and
  filling by it; workplaces' "+$X" floaters.
- **C** — sandbags, extra hands and tidying cost crew time; an ignored flood leaves damage a
  repair crew works through; a served convoy becomes a regular route; the Conference Centre
  or a Hackerspace. A tour that leaves investors unimpressed lowers the next acquirer's
  premium; a hackathon turned down costs the vibe coders' mood.
- **D** — term sheets at founding; four founders with a rule each on the map; hilly land
  cheap with climbing commutes, and the land screen saying what the land means; three more
  rule notables (a starting route, quick repairs, a fourth term sheet).
- **E** — workplaces dim when empty; team leaders lead the workplace nearest the best home
  of their kind (+25% at its desks); agents speed the singularity, and at 90% they decide
  things — pull the plug, sell on their terms, or lose half the money to compute.

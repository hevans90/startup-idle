# Map events: overhauled

Status: **phase 2 done** (2026-11-07): the flood's levee, the convoy's materials, the hackathon's card (kept at a minute: at two, declining won 86%), due diligence (the snub gone; water read from what drinks, as homes have no water need) and the offer reading first refusal (there is no drag-along clause). **Phase 1 done** (2026-11-04): engine, director (100 hired, then 15–25 min), defaults, conditions, general damage. Economy multipliers on conditions wait for an event that needs them. Replaces the director in `world/events/events.ts` and the events block in `world-scene.tsx`. Floods, sludge and clean-up stay as map systems; this plan is about what starts them and what they leave behind.

## Why: what is there now

Five events, one at a time, each on its own clock (`PACING`). The clocks stop while any event is under way.

| Event | Needs | First / then | Choices | What it leaves |
|---|---|---|---|---|
| River flood | a river | 15 min / 20–35 | sandbags (½ the interns off), evacuate, brace | brace: buildings idle till repaired; evacuate: −2 morale for a day |
| Convoy | a port | 10 / 15–25 | extra hands (¼ the interns off), as usual | port calls ×2 for a minute; a regular route, +20% on port calls |
| Investor tour | the HQ line | 20 / 25–40 | tidy up (every vibe coder off), as it is | 30–90 s of income; a poor one takes 15 points off the next offer's premium |
| Hackathon | studio, 10 vibe coders | 8 / 20–30 | host (20 s of income in pizza, vibe coders off a minute), not now | ±6 / −4 vibe coder morale for 10 min |
| Acquirer's offer | something to sell | 1 / 15–25 | look at it, hold out | +25% Equity on a sale made while it's open |

### 1. The stakes are a rounding error

Measured with the model in `dominant-choices.test.ts`: the gap between the best and worst choice, in seconds of income, across 4,000 random companies. The second column is that gap as a share of what the company earns before the next event of that kind comes.

| Event | Median gap | Median gap, share of income till the next one | 90th percentile share |
|---|---|---|---|
| Flood | 19 s | 1.2% | 3.9% |
| Convoy | 9 s | 0.7% | 3.0% |
| Investor tour | 5 s | 0.3% | 0.6% |
| Hackathon | 7 s | 0.5% | 23% (companies with miserable vibe coders) |

`dominant-choices.test.ts` makes sure no choice is best more than 70% of the time, and it passes. But **balanced and tiny means there's nothing to decide.** The test checks the wrong thing on its own.

### 2. Rewards paid in seconds of income can't matter

In an idle game, income a minute from now is larger than income now. A prize of "60 s of income" every half hour is ~3%, and it's gone at once. Only four things last:
- a convoy's route, but port income is a small share for most companies;
- the investors' snub on the next offer;
- a flood's damage;
- the offer's premium, which is the one event that works.

### 3. They don't touch the game as it is now

The events predate most of the game's systems. None of them reaches:
- the culture deck;
- water mains and cooling;
- sewers, slop and spills;
- traffic and roads;
- projects and landmarks;
- services, leaders, the AI agents and singularity;
- the term sheet (bar the no-shop clause);
- the equity tree (bar Conglomerate's route).

### 4. Clocks, not causes

Each kind comes on its timer whatever the town is doing. Four of the five need a particular building, so a company without a river or a port sees only three kinds, and for the first 8–20 minutes it sees none.

### 5. Nothing shows

Only a flood shows on the map. Every other outcome is a sentence on a card that's put away after 10 s. Morale, the snub and the route have no place on screen where they can be seen afterwards.

### 6. Hard to add to

One event is spread over four files:
- `events.ts`: its definition;
- `world-scene.tsx`: what the director is shown, and what an ended event leaves (~70 lines);
- `world.store.ts`: `CHOICE_PRICE`;
- `event-cards.tsx`: the offer's special case.

The balance sim (`simulate-map-run.ts`) has no events at all.

## Goals

- **Every event changes something you can see, and most leave something that lasts.** That could be a building, a road, a card, a rule, a route or a price.
- **Stakes you feel.**
  - Ordinary events: the median gap between best and worst choice is **5–15% of income till the next one**.
  - Rare ones (flood, offer, a heatwave on the Data Centre): **15–40%**.
- **Choices trade what you're short of:** people off work, a project's progress, culture points, water, slop room, Equity, the AI's meter. Not "money or nothing".
- **Rare.** None before 100 employees, then one every 15–25 min. Fewer events is why each must matter.
- **Caused by the town.** Events come from what you've built and how it's doing. A town short of water gets droughts; one with spilling offices gets inspectors.
- **One file an event**, as data. The engine does the rest.

## Decisions (proposed)

| Question | Proposal |
|---|---|
| Shape | **Data-defined events** (`EventDef`): when it can come, how likely, its warning, its choices, what each does, what happens if unanswered, and any follow-up. |
| Effects | **One effects engine.** An event's outcome is **conditions**: a `CardEffects` bundle and/or economy multipliers and/or rule flags, each lasting **N seconds or for the run**. They fold in where the deck and the equity tree already fold in (`cultureNow`'s sources, `computeModifiers`). Nothing event-specific in the scene. |
| Director | **A weighted deck**, not five clocks. Each eligible event has a weight from the town's state. **None until the company has 100 employees** (every kind owned, summed); the first comes ~3 min after, small. Then a **gap of 15–25 min** between events. **One at a time.** The gap clock keeps running while one is under way. |
| Escalation | **Weight and stakes grow with the era** (garage → IPO). Rare, big events only from the HQ on. |
| Chains | An outcome can **queue a follow-up**, e.g. a good due diligence brings a term-sheet sweetener, and an ignored inspector comes back with a fine. |
| Unanswered | Each event names its **default**, applied when the warning runs out. The default is never the worst choice. **In AI mode the AI answers**, by a simple heuristic as the deck's autopilot does. |
| Offline | **No events while away**, as now. Lasting conditions keep their effects offline; timed ones run down on the clock. |
| Map | **Every event has a place**, ringed as now. **Every condition with a place shows there**: a damaged building looks damaged, an inspected office is taped off, a rerouted street has barriers. |
| Measuring | `dominant-choices` becomes **stakes and dominance**: median gap within the targets, and no choice best above 70%. Events go into the balance sim. |
| Old saves | Saved event pacing is dropped. Routes and the snub carry over as conditions. |

## The engine

- **`EventDef`** in `world/events/defs/*.ts`, one file each:
  - `id`, `family` (water, slop, traffic, projects, people, culture, ports, money, AI);
  - `when(town)`: eligible or not, and the place it's about;
  - `weight(town)`;
  - `cooldown`;
  - `warn` and `active` durations;
  - `choices`: each with a `price` (paid on choosing: money, crew off work, culture points, Equity, meter) and an `effect`;
  - `default`;
  - `outcome(town, chosen)`: conditions to apply, a line for comms, follow-ups.
- **`TownView`**: one snapshot built every half second (what `EventWorld` is now, but general):
  - buildings by def;
  - tanks and spills;
  - mains and cooling;
  - traffic jams;
  - the project under way;
  - morale by kind;
  - the deck's slots;
  - ports, river and income.
- **Conditions** (`game/conditions.ts`, saved with the company):
  - `{ id, source, effects: CardEffects, econ?: Partial<Mults>, flags?: Rule, place?, until | "run" }`;
  - read by `cultureNow` (a third source after the deck and the tree, through the reader added for the tree);
  - read by `computeModifiers` for money, innovation and valuation.
- **Prices** handled in one place, replacing `CHOICE_PRICE` and `CREW_SHARE`: crew taken off work goes through `eventAway` as now.
- **The card** says each choice's stakes in the game's numbers ("+20% build speed for 10 min", "−1 slot until repaired"), worked out by the engine from the effect, not written by hand.

## The events (first set, 14)

Kept and reworked:

1. **River flood** (water). As now, plus a fourth choice: **build a levee**. It costs a project's worth of materials (trucks to the riverbank) and is permanent, cutting future floods there by half. Brace's damage stays. Sandbags cost the interns, as now. Stakes come from damage to workplaces as well as homes.
2. **Supply convoy** (ports, projects). The port's convoy now **brings materials**. While it's in, project loads are half price and arrive by river. Extra hands make the route, as now, and the route also takes 10% off loads for good (up to 5).
3. **Due diligence**, replacing the investor tour (money). The investors inspect **three things the town shows**: home mood, spills, and cooling or water delivered. Each passes or fails. The result sets **valuation ×0.85–×1.25 until the next diligence**, and a pass on all three queues a term-sheet sweetener. Preparing costs crews and projects, not money.
4. **Hackathon** (culture, people). Hosting costs vibe coders off work for 2 min and a slop spike at the studio. It **draws a culture card offer, 1 of 3**, or a rank on a slotted hustle/chaos card. Declining keeps the morale hit.
5. **Acquirer's offer** (money). Kept. The premium also reads the town's best street, as it does now, and the term sheet's clauses (no-shop, drag-along).

New, from the systems the game has now:

6. **Heatwave** (water, AI). The Data Centre and the AI's buildings drink twice as much for 3 min. Choices:
   - pay for emergency pumps (money);
   - throttle the agents (their boost and the meter stop for the heatwave);
   - ride it out (dry tanks overheat racks: offline until repaired).
   It comes more often on a map with one thin main.
7. **Drought** (water). The river drops for 10 min and shallow intakes run dry. Choices:
   - dig the reservoir the AI would dig, now and at half price;
   - ration (home mood −8 for a day);
   - truck water in (money a minute).
8. **Health inspector** (slop). Comes when offices have spilled. Choices:
   - a clean-up sprint (vibe coders off);
   - pay the fine;
   - let them close the worst office for 5 min.
   A pass gives **Clean record**: house mood +5 for the run, lost at the next spill. A closure that recurs comes back as a fine.
9. **Road works** (traffic). The council closes the busiest junction for 5 min; attendance on that street drops. Choices:
   - pay overtime to finish fast;
   - build a bypass, with road free for 5 min;
   - put up with it.
   A bypass built stays.
10. **Supplier strike** (projects). Only while a project is building. Loads cost ×2 for 4 min (Refactoring's trucks feel it most). Choices:
    - pay the strikers (money);
    - wait (the site stalls);
    - truck from the map's edge (slower loads, normal price).
11. **Poaching** (people). A rival offers your 10x devs or a leader. Choices:
    - match it (money or a culture point);
    - let N go;
    - counter-poach (Equity off the next sale, + N hires free).
    It comes when morale for that kind is low.
12. **Viral post** (culture). Something the deck is doing goes viral. Choices:
    - lean in: the slotted card's rank-3 rule for 5 min, then −morale;
    - bank it: a culture point.
    Its weight follows your tags.
13. **Tenants' strike** (people). Comes on a street of unhappy homes (no desk, commute, sludge). Choices:
    - a free café or park on that street, placed now;
    - a rent freeze (income from those homes −50% for a day);
    - ignore it (those homes' beds −25% for a day).
14. **Agent incident** (AI, after the first agents). An agent does something on its own. Choices:
    - roll it back (meter −, money cost);
    - let it run (meter +, a random small gain);
    - make it policy (a culture card of the AI family offered).

Each choice's numbers get tuned against the stakes targets in phase 5, not set here.

## Disasters, by what the map can already draw

Disasters are the fun ones, but the map has little to show them with. So **each one is built from pieces that already draw**, and none waits on new render work:

| Piece | Where | Used now for |
|---|---|---|
| Real water, rising or falling at the river's head | `events/flood.ts`, the water solver | floods |
| Rain over the screen | `drawRain` (`daylight.ts`) | a flood coming |
| A colour grade over the whole map | the night sheet, `mixColour` | night |
| Each building's glow | `render/lights.ts` | night, Crunch Week |
| Damaged: idle, a badge, repaired in N s | `repairedIn`, `badges.ts`, `building-info.ts` | floods |
| Spills spreading on the ground | `events/sludge.ts` | slop |
| Dust puff, sparkle, confetti | `render/juice.ts` | building, demolishing, Ship It |
| Moving the camera | `vp.animate` | following |

**Damaged** becomes general: any disaster can damage a building, for any reason, with the same badge, line and repair crew. Phase 1 builds this.

Disasters in the order they cost to draw, cheapest first:

1. **Flood.** Draws already. Gets the levee.
2. **Drought.** The flood run backwards: the river's head drops and the solver drains the channel (to check: the head has only ever been raised). Rain off, grade warm.
3. **Burst main.** A main breaks at a joint. Water pours out there (the solver, from a pipe cell), and that main delivers nothing until a crew fixes it.
4. **Sewer backup.** A sewer's slop comes up in the street: a sludge spill, from a manhole instead of an office.
5. **Blackout.** A district's lights go out (lights layer, per building) and its buildings are damaged until power is back. Best at night.
6. **Heatwave.** The map graded warm. Racks without cooling are damaged. Replaces event 6's "overheat" line above.
7. **Earthquake.** The camera shakes, dust puffs on a few buildings, and they're damaged. Cheap, but fairly random, so rare and only once the HQ is built.

Left out until there's art for them: fire, storms with wind, tornadoes, anything falling from the sky.

Every disaster has a **built answer** that softens it: a levee, a reservoir, a second main or a loop, a second sewer, a backup generator, cooling. That gives the player something to do before the next one, not only during it.

## Phases

1. **Engine, no change in play.** Build `EventDef`, `TownView`, general damage (any building, any cause), conditions (saved, folded into `cultureNow` and `computeModifiers`), the deck director, defaults, prices in one place, and the card's stakes line. Port the five events as they are and delete the scene's events block. Tests:
   - the director picks only eligible events;
   - the gap holds;
   - a default applies when the warning runs out;
   - conditions expire and survive a reload.
2. **The five, reworked** (1–5 above): the levee, materials by convoy, due diligence, a hackathon that deals a card, and the offer reading the term sheet.
3. **New events, water and work:** heatwave, drought, health inspector, supplier strike. The map shows each condition with a place.
4. **New events, town and people:** road works, poaching, viral post, tenants' strike, agent incident. Chains, AI mode answering, and founder hooks (the Hustler's ×2 becomes weight, not speed).
5. **Measured and tuned:**
   - `dominant-choices` → `event-stakes.test.ts`, with gap and dominance bars;
   - events in `simulate-map-run` (a deterministic draw), so run-length and income targets see them;
   - README.

## Questions (all decided 2026-11-04)

1. ~~How often?~~ **Decided:** none before 100 employees, then one every 15–25 min of play. Phase 5 checks in the sim when a typical run reaches 100, so the gate isn't hours away.
2. ~~Disasters?~~ **Decided:** yes, the ones the map can already draw (see Disasters), each softened by something built beforehand.
3. ~~Unanswered events~~ **Decided:** the event's default, never the worst choice (the flood's is now evacuate, not brace).
4. ~~Where active conditions show~~ **Decided:** on the map only, on what they affect; no new UI text.
5. ~~Keep "No events"~~ **Decided:** kept.
6. ~~Which of the 14~~ **Decided:** all 14 for now; cut after playing them.

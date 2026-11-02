# The culture deck: work policies, overhauled

Status: **phases 1–2 done, phase 3 keystones done** (2026-11-02): engine, store, migration, autopilot, the card board, and every card's rank-3 rule wired into its system. Tag sets still to come. Planned 2026-11-02, agreed in conversation. Replaces the work policies of `plans/innovation-overhaul.md` §3.

## Why

- A manager tier only adds to a total, so which track you raise doesn't matter.
- Policies are flat stat trades (±% output for ±morale). Nothing on the map changes.
- Nine policies and up to four slots: the best set is found once and never revisited.

## Decisions

| Question | Decision |
|---|---|
| Shape | A **culture deck**: policies become cards with three ranks. |
| A tier | **A point to spend.** The tracks' flat ~3% multipliers go. |
| Points buy | **Slots (wide) or ranks (tall)**, both at rising prices. |
| Ranks | Ranks 1–2 sharpen the card's trade; **rank 3 is a keystone that rewrites a rule.** |
| Scope | **One company-wide deck.** Each card says which kinds it touches; a few are for one kind only, offered once you employ them. |
| New cards | **Offered 1 of 3**, roguelite style. Paced, not one per tier (below). **Reroll for innovation**, the price rising each reroll. |
| Tracks | **Each track deals its own families.** Which track you raise decides what you're offered. |
| Switching | **Free**, as now: morale drifts to its new level. Points spent on slots and ranks stay spent; ranks stay with the card. |
| Trade-offs | **Every card is a trade.** |
| Synergy | **Tags with set bonuses** at 2, 3 and 4 of a tag slotted. |
| Map | **Both:** every card shows in the town; keystones change map systems. |
| Across runs | **Discovered cards persist** in the offer pool; the deck itself resets. |
| AI families | **Only after a first ascension.** They **bend the singularity meter** and some are **unreliable on purpose** (dice). |
| Size | **~30 cards** at launch. |
| Autopilot | **Simple heuristic.** |
| Old saves | **Refund as points**; old policies become rank-1 cards already in the deck. |

## Design

### 1. The economy

- **Points:** one per manager tier, on any track.
- **Card progress:** each track has its own bar. A track's tiers fill its bar, and a full bar deals an offer from that track's families. The bar grows: the 1st card at 1 tier, then 3, 4, 5, 6… more tiers of that track (first guess; tune against the pacing sims so a new card lands every 10–15 minutes of mid-game).
- **Slots:** the first is free. Each further slot costs 2, 3, 4, 5… points.
- **Ranks:** rank 2 costs 6 points, rank 3 costs 15: max rank is a long climb. Trades are structural (desks, beds, commutes, leader ranks), not small percentages.
- **Rerolls:** innovation, starting at a minute of income and doubling each reroll of the same offer.
- **Pending offers queue up:** they wait if you're busy, and are never lost.

### 2. Tracks and families

| Track | Deals | After a first ascension, also |
|---|---|---|
| Agile | Hustle, Chaos | Agentic |
| Corpo | Wellness, Growth | Alignment |
| Sales | Growth, Hustle | Hallucination |

Alignment is a third AI family, proposed here (see open questions).

### 3. Tag sets

Each slotted card counts toward its tag.

| Tag | 2 | 3 | 4 |
|---|---|---|---|
| Hustle | +5% output | morale drifts down 25% slower | Keystone: overtime as a resource (below) |
| Wellness | +3 morale | homes near offices +desirability | Keystone: no morale floor penalty |
| Growth | −5% hire price | +10% housing reach for commutes | Keystone: one free hire for every 20 hired |
| Chaos | +10% innovation | slop also feeds innovation | Keystone: random daily "pivot" buff |
| Agentic | meter +5%/min | agents boost +1% each | Keystone: agents act without racks for 30 s bursts |
| Alignment | meter −5%/min | shutdowns cost half | Keystone: the meter can be held at a level |
| Hallucination | ±10% output, rerolled each minute | — | Keystone: one card's rank-3 rule, borrowed at random each minute |

These numbers are placeholders, to make the shape concrete.

### 4. The cards

About 30 cards: 5 per base family (20) and 3–4 per AI family (10). Each has a trade at ranks 1–2 and a keystone rule at rank 3. Kind-only cards are marked (I) intern, (V) vibe coder, (X) 10x dev. The map column is the town flavour every card shows.

| Card | Tag | Trade (ranks 1–2) | Rank 3 rewrites | On the map |
|---|---|---|---|---|
| Crunch Week | Hustle | those with no desk work at 70%, then in full; −morale | Output ×2 while it is light | Office lights stay on at night |
| Stack Ranking | Hustle | leader ranks ×2, then ×3; −morale | Leaders rank on past 5, without end | Desks with red flags |
| Hot Desking | Hustle | desks ×1.5, then ×2; −house mood | Any kind sits at any workplace | Shared desks, sticky notes |
| Hire-to-Fire (I) | Hustle | intern price curve −0.04, then −0.07; −morale | A free vibe coder with every 10 interns hired | Moving vans |
| Ship It Fridays | Hustle | build speed ×2, then ×3; +slop | Crews build ahead of deliveries | Confetti over offices |
| Free Lunch | Wellness | workplaces count as a café 6, then 12 tiles out; build prices +15% | Lunch counts as a café, park and gym | Food trucks by offices |
| Remote Fridays | Wellness | 25%, then 50% work from home: no desk, no commute | Home workers join their leader's team | Fewer cars on Fridays |
| Sabbaticals (X) | Wellness | 10x innovation ×2, then ×3; −project attendance | Every 10x dev works from home | Empty desk, palm tree |
| Therapy Budget | Wellness | spill upset −50%, then none; +hire price | No one moves out over mood | Clinic sign on HQ |
| Four-Day Week | Wellness | +10, then +15 house mood; −project attendance | Morale over +20: attendance ×1.5 | Weekend crowds in parks |
| Always Be Hiring | Growth | auto-buy 1/s, then 3/s; price curve +0.03 | Auto-buy +1/s for every 1,000 hired | Recruiter booths |
| Hire Freeze | Growth | hire price ×0.5, then ×0.33; no auto-buy, −morale | Hire prices halve again every 10 min | "Not hiring" signs |
| Shuttle Bus | Growth | free commute 8 tiles further, then unlimited; build prices +15% | Houses with no road get to work anyway | Buses on the streets |
| Company Housing | Growth | beds per house ×2, then ×3; −house mood | Houses beside a workplace need no desks | Dorm signs |
| Mentorship (I) | Growth | intern innovation ×3, then ×5; half the desks | Interns earn what vibe coders earn | Pairs at desks |
| Hackathon Culture (V) | Chaos | innovation ×2, then ×3; slop ×2 | Innovation ×2 while no tank spills | Pizza boxes |
| Move Fast | Chaos | build speed ×2, then ×3; slop tanks halved | Workplaces seat people while still building | Construction cones |
| Vibes Only (V) | Chaos | vibe coders work deskless at 70%, then in full; +slop, −house mood | Innovation ×3 while a tank spills | Beanbags on lawns |
| Pivot Weekly | Chaos | innovation ×1.5, then ×2; a card swapped out every 10 min | Pivots bring a card in, in a slot of its own | Logo swaps on HQ |
| Open Plan | Chaos | leaders lead everyone in full, then XP ×2; −morale | Every leader leads every kind | Walls removed |
| Autonomous Agents | Agentic | +agent boost, meter faster | Agents run tasks while you're offline | Racks blink |
| Agent Swarm | Agentic | more agents per rack, meter faster | A full rack spawns a free agent each hour | Drones over racks |
| Self-Improving | Agentic | training runs faster, meter faster | Each training run raises every card's rank by one for 5 minutes | Racks glow |
| Confident Guess | Hallucination | ±output dice each minute | Bad rolls are re-rolled once | Question marks over offices |
| Phantom Revenue | Hallucination | +valuation, sometimes it vanishes | Vanished revenue comes back as innovation | Ghost money signs |
| Made-Up Benchmark | Hallucination | +innovation, sometimes −morale | Doubles the next project's grant, or halves it | Charts on billboards |
| Red Team | Alignment | meter slower, −agent boost | Shutdown keeps the agents | Security fences |
| Constitution | Alignment | meter capped per minute, −output | The meter's weights carry more into the next run | Plaques on racks |
| Kill Switch | Alignment | shutdowns cost less, −innovation | A shutdown can be undone within a minute | Red button on the Data Centre |

### 5. Discovery

- The base families' cards are in the pool from the first run.
- AI families join the pool after the first ascension.
- A card once offered is **discovered**: kept in a journal that survives ascension. The journal shows found and unfound counts, by family.

### 6. Autopilot

- Picks by style: tall picks Hustle and ranks its best card to 3; wide picks Wellness and Growth and buys slots.
- Never rerolls.
- AI-family cards: never picked.

### 7. Old saves

- Each manager's tiers become unspent points.
- The old policies become rank-1 cards in the deck, slotted as they were, as far as the free slot allows; the rest are unslotted.
- Each track's card progress starts at zero.

### 8. UI

- **The deck:** replaces the Work policies panel. The slots in a row, the cards owned below, and tag-set progress (2/3/4) on the side.
- **An offer:** three cards to choose from, with a reroll button and its price. Opened from a pulsing chip when an offer waits. *(Greybox: done; the panel lists slots, then unslotted cards only.)*
- **Each manager row:** its card progress bar beside the tier.
- **The journal:** a page of discovered cards, greyed for unfound ones.
- Every card shows its trade in one line and its rank-3 rule in one line. Keep it short.

## Polish, and showing the UI as it goes

The user wants this **very polished**, and to **see the UI at each stage** to give feedback:
- Every phase that touches the screen ends with screenshots of it, light and dark, at desktop and phone widths, before the next starts.
- UI lands in stages: a working greybox first (to judge the flow), then the styled version, then motion and feel. Each is shown before moving on.
- Card art, the offer reveal, rank-ups and tag-set completion each get a moment of feedback (motion, sound where the game has it), shown before they're kept.

## Phases

1. **Engine.** *(Done: `game/culture.ts`; ranks stop at 2 until phase 3; the tracks' multipliers are kept for now.)* Card catalogue, tags, deck state (points, slots, ranks, slotted, progress per track, offers), effects replacing `policyEffects`, migration. Tests. The six `getPolicyEffects` callers switch over.
2. **Deck UI.** The deck panel, offer picker, rerolls, progress bars.
3. **Tag sets and keystones.** Each rank-3 rule wired into its system (commutes, slop, leaders, housing, agents, the meter). *(Keystones done: `Card.rule`, read through `cultureNow`; a slotted rank-3 card's foot lit as its rule. Tag sets to come.)*
4. **Map flavour.** Each card's look in the town.
5. **AI families and the journal.** Gated on ascension; discovery persisted.
6. **Autopilot, sims, balance, README.** Pacing guards in `map-balance` and the progression sims re-measured.

## Open questions

- **Alignment:** a third AI family alongside Hallucination and Agentic, or a different name or theme?
- **Card pacing:** how often should a new card land, in real minutes, early and late?
- **Discovery:** should discovered cards be offered more often than undiscovered ones, or is the journal only a record?
- **The tracks' old multipliers** (~3% a tier): dropped as agreed, but the economy leans on them. Make up the difference in base rates, or let the deck carry it?
- **Kind-only cards** for 10x devs: only Sabbaticals so far. More, or fine?
- **Hallucination dice:** honest odds shown on the card, or hidden?

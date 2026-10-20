# The AI takeover, overhauled: a colleague you manage, not weather

## Why

The takeover is the best idea in the late game: the company's AI starts doing your job, then redoing it, and you watch drones carry it out. As built it is mostly weather that happens to the player:
- **It over-expands.** It zones lots and puts up compute wherever it can, spending the player's money as it goes.
- **It fails to cool what it builds.** Its servers run dry, and then it builds more.
- **It sabotages.** It turns cafés, parks, offices and houses into GPU farms at random.
- **It locks the road tools** for the rest of the run at the Overseer stage.
- **It digs water** in odd places, too often, and the water doesn't stay where it's put.
- **The player's only lever is the agent throttle.**

**Training runs** are flat stat buffs. One of them (the town's +8 desirability) ratchets the town up permanently, run after run.

**Ascension** comes too easily and gives too little.

**The Ascension popover** does not respect the light/dark theme.

**The goal:**
- **More agency** with at most three new controls, all in the Data Centre panel the player already uses, plus one gesture on the map.
- **An AI that is competent** at what it does: it never builds what it can't cool, and never takes what isn't its to take.
- **Training that shapes what kind of AI you raise** instead of buffing the economy.
- **An Ascension worth reaching** and harder to reach.

This is a plan only. Nothing here is built yet.

---

## How it works today

### The meter and its stages

`state/ai-singularity.store.ts`:
- **Range and stages:** the meter runs 0–100, through Tool (0), Assistant (20), Colleague (40), Manager (60), Overseer (80) and Ascension (100).
- **Rise:** 0.0005 points a second for every agent running (`RATE_PER_AGENT`), times `singularityMult()`, which covers the skill-tree hype passives, the Quiet Model module and fused tempers.
- **Decay:** it sinks at 0.002 a second only when agents are owned and none run.
- **A sale** keeps 80% (`CARRY`) and never leaves it under 10 a sale this generation, capped at 90 (`afterSale`). The cadence test (`simulation/singularity-cadence.test.ts`) tunes a strong player to ascend in about 5 sales and a typical one in about 10.
- **Other jumps:**
  - training runs, +3 to +8 each (×2 with Ego fused);
  - the Colleague's "compute" memo, +2.

### The takeover (`world/ai/planner.ts`, `ai-runner.ts`)

- **When:** from the Colleague stage, every `INTERVAL` seconds (60 at Colleague, 35 at Manager, 20 at Overseer), slowed by the share of agents running and sped up by drone hangars. It picks a job (`chooseAction`).
- **How it picks:** each kind its stage allows gets a random weight, leant by the family of the trait it is becoming (`LEAN`). The first kind with a candidate wins.

  | Stage | Kinds it may pick |
  |---|---|
  | Colleague | lot, service, node, farm, pipe |
  | Manager | adds convert (house → node), repurpose (café, park, gym or office → GPU farm), road, lift, hire, upgrade |
  | Overseer | adds flatten, pond, spire, hangar, monolith |

- **How it does it:** through the player's own build actions (`build-actions.ts`), paid from the player's money. A drone flies out, scans for 2.5 s, and the job is done. The player can see it coming but can't stop it.
- **Roads:** at the Overseer stage (meter ≥ 80) the road and lift tools are taken away (`build-bar.tsx`, `ROAD_TOOLS`), for good this run.
- **Time away:** catches up to 10 jobs at once on return (`catchUpAi`).

### Why it goes wrong

| Symptom | Cause in the code |
|---|---|
| Over-expands | No budget: every job spends whatever money there is. Lot and service candidates search the whole owned map (`spots(g, def)` over everything), not a district. Kinds are drawn at random, so it zones lots nobody asked for while its servers are dry. |
| Fails to cool | `node`, `farm` and `spire` place drinking buildings with no check that water can reach them. `pipe` is one random option among many, offered only once a building is already short (`neededPipe`, share < `SHORT`) and only if the money is there right then. Nothing stops it building more drinkers while existing ones are dry. |
| Sabotage | `repurpose` picks a random café, park, gym or office anywhere, utilisation and value unconsidered. `convert` takes the least happy single house, residents and all. Neither is announced or can be refused. |
| Water | `pond` digs a 2×2 at a random spot within 6 tiles of the Data Centre, through the player's brush strokes. The hole's size depends on whatever brush radius the player last used, and the pour on the stroke. Nothing checks the ground is a basin, so water on a slope runs off into the town. Nothing feeds it, so it drains or spreads. The elemental family leans it ×4, so it happens often. |
| No agency | The throttle is the only lever, and it's all-or-nothing: fewer agents slows everything the AI does, good and bad alike. |

### Training runs (`game/training.ts`, `state/training.store.ts`)

There are five datasets. Each run lasts 180 s, costs 60 s of innovation (rising ×1.3 a run this generation), and gives a boost while it runs, then a meter jump and a lean in the behaviour log:

| Dataset | Boost while running | Jump |
|---|---|---|
| Town | every house +8 desirability | 3 |
| Money | income ×1.15 | 4 |
| People | +15 satisfaction | 3 |
| River | port calls ×1.5, floods repaired 3× faster | 3 |
| Itself | each agent's boost ×1.5 | 8 |

What's wrong with them:
- **The town ratchet.** +8 desirability lifts houses over `GROW_AT`, and houses grow a tier. A grown house only declines when its mood falls `DECLINE_MARGIN` (4) below its tier's threshold, so most keep the tier when the +8 ends. Chained runs ratchet the town up permanently: that's the "+8 stacking forever".
- **Uninspired.** They're stat sliders, unrelated to the AI on the map. Nothing about the AI's behaviour changes with what it was trained on, beyond a trait lean.
- **No real cost.** Innovation is plentiful late, and nothing about a run costs the town.

### Ascension (`game/ascension.ts`, `game/modules.ts`, `game/fusion.ts`)

- **Ascend:** banks Weights (`2·runs + 3·√equity + peakAgents/2`), fuses one trait into the founder played, and wipes everything else.
- **Weights buy modules:** 8 modules, 3 levels each, mostly ±15–45% tweaks or a seed of $500–$50k. They only work while in a slot, and there's one slot per Ascension.
- **Shut it down:** agents deleted, racks dark for 10 min, the meter back to 50.
- **Too easy:** the meter only needs agents running. Sales keep most of it and set floors, and training jumps add up.
- **Too weak:** a module tweak and one trait per generation don't change how the next run plays.

---

## Design principles

1. **Agency through a few, legible choices.**
   - **Panel:** two controls in the Data Centre panel (a focus, a budget).
   - **Map:** one gesture (cancel a drone), plus the one decision that already matters, *where you put the Data Centre*, made to matter more.
2. **The AI is competent and honest.**
   - It never builds what it can't power and cool.
   - It never takes what isn't its to take.
   - It always says what it's about to do, and gives a moment to refuse.

   Its *personality* (trait, stage) changes *what* it wants, not whether it's good at it.
3. **Escalation stays.** The later stages still take things over: that's the fun. Now it's legible, bounded and resistible, and resisting has consequences in the AI's upbringing.
4. **No new currencies.**
   - The budget is a share of the player's own income.
   - Training costs the agents' time instead of innovation.
   - Ascension's new rewards live in the Weights and modules that already exist.

---

## 1. The takeover

### 1.1 Its district: where you put the Data Centre is where it takes over

- **The district** is a circle round the Data Centre, shown on the map as a faint violet boundary from the Colleague stage on.
- **It grows with the stage:** about 8 tiles at Colleague, 12 at Manager, 18 at Overseer. The Ascension sequence covers the map.
- **Inside the district** it builds its compute, services and lots, and later converts and repurposes.
- **Outside,** before the Overseer, it only lays cooling pipes to water (they must reach water) and hires and buys upgrades at a desk.
- **The agency:** placing the Data Centre is now a real spatial decision. Put it in the industrial edge of town and the takeover happens there. Put it downtown and it eats downtown. A second Data Centre (later) could be a second district.
- **Code:**
  - `planner.ts` `spots()` takes the district instead of the whole map;
  - `candidate()` filters `structures` to the district for convert and repurpose;
  - a new `aiDistrict(g, stage)` in `world/ai/district.ts`;
  - the map draws it in `ai-layer.ts`.

### 1.2 Its focus: one choice

A focus selector in the Data Centre panel, four options:

| Focus | What it prefers | What it never does |
|---|---|---|
| **Grow the town** (default) | lots, services, roads in its district | convert houses |
| **Feed the machine** | compute, cooling, spires, hangars | zone lots |
| **Serve the people** | services where moods are lowest, upgrades that raise satisfaction | repurpose services |
| **Hands off** | maintenance only: cooling its own buildings, keeping them running | build anything new |

- **The focus sets the kind weights.** The trait's `LEAN` still flavours them within the focus, so an Elemental AI on "Feed the machine" pipes more and spires less.
- **The stage still gates what's possible.**
- **"Hands off" isn't free:** the meter still rises, and a maintenance-only AI is logged as *throttled* in the behaviour log, leaning the Patient trait. It's a choice with a cost, like the throttle.
- **Replaces** the random weighted draw in `chooseAction`: weights = focus table × trait lean.

### 1.3 Its wallet: a budget

- **A slider in the Data Centre panel:** the share of income the AI may spend, from 0 to 50% in steps of 5%, default 20%.
- **It's an allowance, shown as a balance** next to the slider. The share of each second's income accrues into it, and it never holds more than 10 minutes' worth.
- **Every job checks the balance first** (`priceOf` the action) and pays from it. No balance, no job: it waits rather than draining the company.
- **Hires and upgrades** come from the same wallet.
- **Ends over-expansion** directly, and makes "how much do I let it spend" a dial the player tunes.
- **Code:** `world/ai/wallet.ts`. Its state lives in the session store, so it is saved with the run. `perform` pays from it before calling the build action, refunding on failure.

### 1.4 Cancel a drone

- **The scan becomes a veto window.** A drone carrying a job shows its hologram at the target. That already exists for AI mode and needs to exist for the takeover too.
- **Click the hologram or the drone** to cancel it. The drone turns back and the money is refunded to the wallet.
- **The scan goes from 2.5 s to 4 s,** so there's time to react. Conversions and repurposes get a longer warning (see 1.6).
- **Cancellations are remembered:**
  - each one adds to a `vetoes` count in the behaviour log, leaning **Resentful** (strongly) and **Patient** (a little);
  - a memo answers in its voice ("Noted.", "I have filed your objection with myself.").

  So refusing it shapes what it becomes. That's agency with stakes, using a system that already exists.
- **Not the build bar's job:** it's a click on the map.
- **Code:**
  - `ai-runner.ts` gets `cancelJob(id)`;
  - the takeover's jobs become `deferred` actions with a `holo`, as AI mode's are, so they already show as holograms;
  - pointer handling hit-tests the holograms (`world-scene.tsx`).

### 1.5 Roads: taken in its district only

- **The road and lift tools stay available** at the Overseer stage.
- **Inside the district, the AI owns the streets:**
  - the road tool is refused there, with a hint ("The AI manages these streets");
  - the AI may re-lay and lift there.
- **Outside it,** the player builds as normal.
- **Code:** `ROAD_TOOLS` gating moves from "meter ≥ 80" to a per-tile rule in `validatePlacement` and the road stroke, `inAiDistrict(x, y)`.

### 1.6 It builds only what it can run, and announces what it takes

- **Cooling first.** Before any job that adds water demand (node, farm, spire), it adds up its **water budget**: demand from every drinker, including the new one, against supply from every intake it has or can lay a route to now.
  - If the new building would leave anything short, the job becomes the pipe or pump that would cover it, or nothing.
  - Any drinker running short makes "fix its cooling" the next job ahead of everything else, whatever the focus.
  - **Code:** `world/ai/water-budget.ts` from `tankFor`, `neededPipe`, `routePipe` and `PUMP_RATE`, plus a guard in `candidate()`.
- **Its own buildings only, unless announced.**
  - **Convert and repurpose become announced takeovers.** A memo names the building ("In 60 seconds I will repurpose the Café on Elm Row as a GPU farm"), and a red hologram stands over it for **60 s**. Cancel it like a drone (1.4), or move people out of a house.
  - **Targets are chosen, not random:**
    - repurpose takes the *least used* service or office in the district: lowest coverage of houses that don't have another of its kind in range, or the emptiest desks;
    - convert takes empty or near-empty houses only.
  - **Stage gating stays:** Manager and up.
- **Water it digs properly.** See section 3.

### 1.7 Feedback: what it's doing, and why

- **One status line in the Data Centre panel:** focus, wallet, the next job ("Next: a GPU farm by the river, in 40 s"), and cooling health (share cooled).
- **Its memos refer to the player's choices:** "You asked me to serve the people. I have opened a park where they were unhappiest." This reuses `memos.ts` and its voice.
- **A count of what it owns** in the district: buildings, water, agents powered. This also feeds 4.2.

### 1.8 Catch-up and offline

`catchUpAi` keeps its cap of 10, now within the district, focus and wallet. Announced takeovers never happen offline: they need a warning that can be refused.

---

## 2. Training runs, rebuilt

### The idea: training teaches the AI, it doesn't buff the economy

A training run spends the **agents' time**:
- while it runs, the agents train instead of working, so their income boost is suspended;
- it teaches the AI a **skill** that changes *how it acts on the map* for the rest of this company;
- it leans the trait it will have at the Ascension, as today.

The choice becomes "what kind of colleague am I raising", and it's paid for in output the player can feel, not in a currency they have plenty of.

### The model

- **Cost:** for the run's length, the agents' boost to income (`agentBonus`) is suspended. No innovation cost: the opportunity cost is real and scales with the late game by itself.
- **Length:** 120 s.
- **Skill levels:** each dataset has three levels of skill, for this company only. Run it once for level 1, again for 2, a third time for 3.
  - Levels reset at a sale, so a new company is a new upbringing.
  - Further runs on a maxed dataset still lean the trait and still jump the meter.
- **Meter jump:** +2 a run, the same for every dataset. "Itself" is the exception (see the table).
- **Curriculum:** the trait lean doubles for the *first* run of each dataset this generation, so variety in upbringing is visible in the forecast.
- **No temporary economy buffs at all.** That removes the town ratchet and the "+8 forever" at the root.

### What each dataset teaches

| Dataset | Skill, levels 1 → 3 | Trait lean |
|---|---|---|
| **The town** | Plans its district: (1) lots and services placed by desirability *and* its district's coverage; (2) uses AI mode's block planner for what it builds (`masterplan/plan.ts`), streets included; (3) its houses are built at the tier they'll grow to, not starter lots. | planner |
| **The money** | Spends well: (1) wallet accrues 25% faster; (2) prefers cheapest-per-value jobs (the planner's `value / cost`); (3) refunds half of any job it can't finish. | optimiser |
| **The people** | Considers them: (1) never converts an occupied house; (2) repurposes only services with no houses relying on them alone; (3) builds a service before each new block of lots. | shepherd |
| **The river** | Understands water: (1) cooling routes prefer gravity over pumps; (2) digs reservoirs that hold (section 3) instead of ponds; (3) warns of floods a day ahead and sandbags its own district. | elemental |
| **Itself** | Improves itself: (1) +1 agent a rack in its district; (2) drones scan and fly 50% faster; (3) its compute boost +25%. **Jumps the meter +5**, not +2. | recursive |

**Code:**
- `game/training.ts`: `DATASETS` gets `skill: [string, string, string]` and drops `boost`;
- `training.store.ts`: `skills: Record<DatasetId, 0–3>` for this company, reset at a sale;
- the planner and the AI's actions read `skillOf(dataset)`;
- the agent boost reads `training()`, to suspend it;
- removed: the old boosts (`TOWN_DESIRE`, `MONEY_MULT`, `PEOPLE_MORALE`, `RIVER_PORTS`, `ITSELF_AGENTS`) and their readers (`mood.ts`, the money tick, `addMorale`, port fees).

### Balance targets

- A run costs roughly 2 minutes of the agents' share of income. Late in a run that's 20–40% of income for 2 minutes.
- A company has room for about 8–15 runs before its sale. Maxing three datasets is a real choice; maxing all five isn't possible.
- No dataset should be the best choice over 60% of the time. Measure with the existing dominant-choices harness (`dominant-choices.test.ts`), modelling each dataset's skill over 10 minutes.

---

## 3. Water the AI places

### When

- **Only as a cooling source of last resort:** when a drinker in its district is short and **no pipe route** to existing water exists within its wallet. Not as a random job.
- **The `pond` job kind is removed.** Its place is taken by `reservoir`, chosen only by the water-budget rule (1.6).
- **The elemental lean** raises the share of cooling met by gravity, and its taste for reservoirs over pumps, but never adds water for its own sake.
- **Expected frequency:** at most one or two reservoirs a company, where today there are ponds every few minutes at the Overseer stage.

### How it works

- **Fixed footprint:** a 3×3 reservoir, never the player's brush.
- **The site** must be:
  - level ground (all cells within one half-step);
  - not paved, not built on, owned, in the district;
  - its rim not the edge of any lower ground the water could escape to.

  The site is scored by the length of pipe to the drinker.
- **Dug as a basin:** the 3×3 lowered two steps, and the ring around it left at or raised to the original height as a **rim**. That's done directly through the height tools (`heightWrites`), not a stroke, so the brush has no part in it.
- **Filled to the rim** by `pourAt` with an exact depth, not `pour` along a stroke.
- **Fed:** a reservoir holds water but makes none. One without a source would empty as the drinker drinks.
  - **River level 1:** reservoirs are filled once, a water budget lasting about 20 minutes of its demand. The AI then pipes a proper source when one becomes affordable.
  - **River level 2:** each reservoir gets a small spring (`setSource`), sized to its demand, so it holds.
- **Drawn as a built thing:** a stone rim (a reservoir structure def, 3×3) so the player reads it as infrastructure, not a puddle.
- **Code:** `world/ai/reservoir.ts`: `siteFor`, `dig`, `fill`; tests on a flat map, a slope (refused), and a lake shore (refused).

---

## 4. Ascension: harder to reach, worth more

### 4.1 Harder to reach

1. **Slow the meter:**
   - `CARRY` 0.8 → 0.6, `FLOOR_PER_SALE` 10 → 5, `FLOOR_CAP` 90 → 60;
   - training jumps +2 (Itself +5) instead of +3 to +8;
   - the Colleague's "compute" memo no longer raises the meter;
   - Ego's ×2 jump becomes ×1.5.

   Re-tune `singularity-cadence.test.ts` to **8–10 sales** for a strong player and **14–18** for a typical one.
2. **A final threshold the AI must build: the Lattice.**
   - **At 95%** the meter holds until the AI completes a final project in its district: a 3×3 Ascension structure (reusing the `monolith` slot and art direction).
   - **It needs:**
     - a cooled Data Centre;
     - at least **24 agents running** (powered, not just owned);
     - a water budget covering the Lattice's own large demand.
   - **The AI builds it itself,** from its wallet, over a few minutes, so the last stretch is a visible event the player can watch, help (more agents, water) or stall (throttle, cancel).
   - Reaching 100% is a goal the player works toward, not a timer.
   - **Code:** `ai-singularity.store` caps at 95 until `latticeBuilt(grid)`; a new planner kind `lattice`, allowed only at ≥ 95%.

### 4.2 Worth more

1. **The ascended AI comes back as yours.** In the next generation's companies, the AI starts at the Assistant stage and its takeover begins one stage later (Manager instead of Colleague). Until the takeover, it works *for* the player:
   - it does jobs **only** from the focus the player sets;
   - the wallet starts at 30%;
   - it never converts or repurposes.

   So each Ascension buys a stretch of cooperative AI the next run, longer with each Ascension, until it eventually helps all the way. That's the payoff: the AI you raised becomes your colleague.
2. **Lineage:** each Ascension adds a permanent ×1.25 to all income, compounding (×1.25 → ×1.56 → ×1.95…). That's simple, felt from the first second of the next run, and makes "how many times have I ascended" matter.
3. **Weights are worth more:**
   - `weightsFor` stays as it is;
   - modules get stronger top levels (Warm Start 10/25/50%, Seed Round $5k/$100k/$5M, Quiet Model 15/30/45%, Rack Density +1/+2/+4);
   - two new modules that touch the takeover:
     - **Loyalty:** the takeover begins one more stage later.
     - **Allowance:** the wallet's maximum is ×2.
   - Slots: 1 + Ascensions, as now, but the first two Ascensions give 2 slots each.
4. **Fusions stay** as they are. They're the flavour layer, and some are already strong; rebalance only if the guards below fail.

### 4.3 Shutting it down

It stays, with its cost raised to match. On top of what it does now, it resets the district: the AI's buildings in it go dark until racks are back.

---

## 5. The Ascension popover and light/dark

- **What was found:** the Ascension card (`molecules/ascension-card.tsx`) pairs its colours with `dark:` variants. The AI meter readout (`molecules/ai-singularity-readout.tsx`) is the one AI surface that's always dark (`bg-primary-900/85`) in light mode.
- **First, reproduce:** open `?fixture=singularity` in both themes at 100% and screenshot:
  - the card;
  - the sequence;
  - the readout;
  - the founder screen's Ascension announcement.

  Identify the element that's wrong.
- **Fix:** every AI surface follows the same pattern, a light panel with dark text by default and `dark:` variants for the dark theme (`dark-mode-always`). That covers:
  - the readout;
  - the card;
  - the Data Centre panel's new controls (focus, wallet, status line);
  - the announced-takeover memo and its hologram label;
  - the Lattice's progress.

---

## 6. Phases (each committed to `main`, with tests, `npx tsc -b` and eslint)

| # | Phase | What lands | Depends on |
|---|---|---|---|
| 1 | Theme fix | Reproduce and fix the popover; AI surfaces audited | — |
| 2 | District | `aiDistrict`, drawn on the map, planner limited to it, road tools gated per tile | — |
| 3 | Wallet | Budget slider, allowance, every job paid from it, refunds | — |
| 4 | Competence | Water budget and cooling-first rule; repurpose and convert targets chosen; announced takeovers with a 60 s warning | 2 |
| 5 | Veto | Takeover jobs as holograms; cancel a drone; vetoes in the behaviour log and trait lean | 4 |
| 6 | Focus | Focus selector and weights; status line; memos that refer to the focus | 2, 3 |
| 7 | Reservoirs | `pond` removed; `reservoir` placement, digging, filling, feeding | 4 |
| 8 | Training | Agents' time as cost; skills by dataset; old boosts removed (no ratchet) | 2, 7 for River |
| 9 | Ascension reach | Meter retune; the Lattice | 4 |
| 10 | Ascension worth | The ascended AI comes back cooperative; lineage; stronger modules; Loyalty and Allowance | 6, 9 |
| 11 | Balance | Cadence, dominant choices, takeover sim; tune | all |

---

## 7. Measures and guards

- **Takeover sim** (new, `simulation/takeover.test.ts`): run the AI headless on generated maps with the singularity fixture's company, for 30 simulated minutes at each stage, each focus and each trait family. Guards:
  - **Cooling:** the share of the AI's drinkers cooled never drops below 90% for more than 60 s.
  - **Spend:** the AI's spend never exceeds the wallet, and the company's money never goes below what it was minus the wallet's maximum.
  - **District:** nothing it builds or takes is outside its district, pipes to water excepted.
  - **Takeovers:** conversions and repurposes are always preceded by their 60 s warning.
  - **Water:** reservoirs at most 2 a company. The water total in the map changes only by what reservoirs and their springs account for, and none leaks outside its rim (the still-flood check from `frame-compare-misses-leaks`).
- **Cadence** (`singularity-cadence.test.ts`): 8–10 sales strong, 14–18 typical, and the Lattice reached in a measured window.
- **Dominant choices** (`dominant-choices.test.ts`): no dataset best for more than 60% of 4,000 random companies; no focus best for more than 60% at any stage.
- **The ratchet is gone:** a test that chains 10 training runs of every dataset and checks the town's tier mix afterwards matches a town that ran none (within noise).
- **Browser checks** on the isolated server, in both themes, with the `singularity` fixture:
  - the district boundary shows;
  - the focus and wallet controls work;
  - a drone cancels when clicked;
  - an announced repurpose can be refused;
  - a reservoir holds its water;
  - the Lattice builds;
  - the card renders in both themes.

---

## Open questions

1. **District shape:** a circle is simplest. A flood-fill along roads from the Data Centre might read better on the map. Proposed: a circle first, revisited after playing.
2. **Focus on The Model's runs (AI mode):** AI mode already has its own planner and budget. Proposed: these controls apply to the takeover only, and AI mode keeps its own (`ai-mode-panel.tsx`).
3. **Lineage's size:** ×1.25 a generation compounds fast. The cadence target may want ×1.15. Decide in phase 11 on the numbers.
4. **Vetoes and Resentful:** should many vetoes also speed the meter ("it resents being stopped")? It would be thematic, but it makes vetoing a trap. Proposed: no; the trait lean is the consequence.

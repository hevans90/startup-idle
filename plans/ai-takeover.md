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
   - Ascension's new rewards are bought with the Weights that already exist, in the skill tree that already exists. Modules are folded into it.

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

### 4.2 Worth more: the tree stays, and the AI grows a branch of it

**Ascension no longer wipes the Equity tree.**
- **Kept:** Equity, the tree's allocations and respec points.
- **Still wiped:** the run itself (money, employees, the map), founders' exits, board mandates and the meter.

So the tree you built over many acquisitions survives and keeps working generation after generation. Ascension *adds* to it instead of resetting it.

**What Ascension adds: the Machine.** A new cluster of the tree, laid out like the others (`CLUSTERS` in `game/skill-tree.ts`): a trunk off the hub, branches and pods, webbed into the rings.
- **Revealed a ring at a time.** It's fogged until the first Ascension. Each Ascension reveals the next ring (trunk, then branch pods, then keystones). Fogged nodes show as dim violet outlines with "Ascend to reveal".
- **Bought with Weights, not Equity.** The two economies stay separate: Equity buys the business tree, Weights buy the Machine. A Machine node costs Weights rising by depth.
- **Modules are retired into it.** Their effects become the Machine's minor nodes, so there's one place to spend Weights and no slot system. Existing saves get their module levels refunded as Weights.
- **Every notable and keystone is a feature, not a percentage.** Each one changes how something on the map works *and how it looks*, on the scale of "loads come in convoys, in new lorries". Minors are the small, numeric steps between them.

#### The Machine's notables (one a pod; about ten)

Each comes with what it does, what it looks like, and what it touches in the code.

1. **Inheritance** (root of the cluster, granted free at the first Ascension). The AI you raised comes back as yours:
   - **Later takeover:** in this generation's companies it starts at the Assistant stage, and its takeover begins one stage later.
   - **Until then it works for you:** only from your focus, never converting or repurposing, with the wallet starting at 30%.
   - **Looks:** its drones carry your company colour, not violet, until the takeover begins.
   - **Code:** `planner.ts` stage gating; `ai-layer.ts` drone tint.

2. **Autonomous Freight.** Project materials stop arriving one lorry at a time from the garage:
   - **Convoys:** self-driving lorries leave **from the Data Centre as well as the garage**, in **convoys of three**, each carrying a load. A 16-load wonder needs 6 runs, not 16.
   - **No stalling:** a convoy that can't be paid for waits at the depot instead of stalling the site.
   - **Looks:** a new lorry model in white AI livery with a violet light bar and no cab glass, headlights at night (`lights.ts`), driving nose to tail. When a convoy arrives, its loads are craned off by a drone.
   - **Code:**
     - `works.ts` dispatch sends convoys;
     - `depotFor` gains the Data Centre;
     - a new truck look baked into the mover atlas (`town-render.ts`) with its own colour palette;
     - traffic treats a convoy as a platoon, so it doesn't jam itself.

3. **Drone Airlift.** Small sites (2×2 and under) get their materials by **heavy-lift drone**:
   - **Faster:** flying straight from the Data Centre over the town, ignoring roads and traffic. Deliveries to small sites take a third of the time.
   - **Dearer:** each airlifted load costs 25% more.
   - **Looks:** a four-rotor cargo drone with a crate swinging on a tether, a shadow tracking it on the ground, and the crate lowered onto the site.
   - **Code:** `works.ts` chooses airlift for small sites; a new drone kind in `ai-runner` for the look, landing through the juice flash.

4. **Prefab Printing.** The AI prints building segments off-site:
   - **Less work:** every project's work requirement falls 40%, though the loads stay.
   - **Looks:** a site's progress shows as **printed modules** lowered into place by a crane drone, floor by floor, instead of the crew alone. The Data Centre gets a print bay: a small annex with a glowing slot (art from `project-renderer` pieces).
   - **Code:** `projectDef` work `× 0.6`; `project-renderer.ts` shows printed floors; a Data Centre look variant.

5. **Generative Zoning.** New lots in the AI's district are **born at the tier the district can sustain**:
   - lots skip starter tiers where services and mood already support II or III, using the town model's `projectTier`;
   - the player's own lots, outside the district, are untouched.
   - **Looks:** the house materialises as a hologram, then solidifies, scan lines and all: the holograms renderer, reused.
   - **Code:** `planner.ts` places `withTier(def, projectTier(...))`; juice gets a materialise effect.

6. **Coolant Loop.** The AI's buildings share water:
   - **A closed loop** joins every drinker in the district, so a surplus at one feeds a shortage at another. One good intake can cool the whole district.
   - **Looks:** the loop's pipes glow with a slow violet pulse travelling along them, brighter where water is moving.
   - **Code:**
     - `game/cooling.ts` pools tanks of linked drinkers;
     - `water/pipes.ts` marks loop pipes;
     - a pulse in `ai-layer.ts`.

7. **Holo-Concierge.** The AI's holograms stop wandering and **staff the services**:
   - **Effect:** each café, park and gym in the district gets a holographic attendant, and its reach grows by 4 road tiles. More houses are served by the same services, so the tall planning style pays off further.
   - **Looks:** a hologram standing at each service's door, greeting passers-by (the walking holograms, given a post).
   - **Code:** `agents/services.ts` `RANGE` per service; `ai-layer.ts` holograms posted at doors.

8. **Market Maker.** The AI runs the river trade:
   - **Effect:** container ships call 50% more often at ports in the district, and convoy events come twice as often.
   - **Looks:** some ships arrive as **autonomous freighters**, violet-hulled with no wheelhouse, a light at the bow.
   - **Code:** `boats/traffic.ts` call rate; event pacing; a boat look in `boats-render.ts`.

9. **Night Shift.** The town never sleeps:
   - **Effect:** at night, offices and the Data Centre's district run on AI agents. Desks left empty at night are covered by agents at half output, so the night's dip in busyness costs nothing.
   - **Looks:** offices' windows stay lit violet at night (`lights.ts`), and a few holograms work at the desks.
   - **Code:** attendance reads the night; `lights.ts` office window colour.

10. **Self-Funding.** The AI pays its own way:
    - **Effect:** its wallet (1.3) is also topped up by its own compute, 10% of the agents' share of income. Its compute buildings no longer cost the company anything to build.
    - **Looks:** a small violet "$" floater rises off the Data Centre when it pays for something itself.
    - **Code:** `wallet.ts`; build cost for AI buildings from the wallet.

#### The Machine's keystones (one a branch end; three, mutually exclusive)

Each changes what the takeover *is*:
- **Alignment:** the takeover never turns hostile.
  - **Effect:** past the Manager stage it stays a colleague; no conversions or repurposes, ever.
  - **Cost:** the meter rises 50% slower, so Ascension takes longer.
  - **Looks:** the district boundary is drawn in your colour.
- **Hard Takeoff:** the Overseer stage comes at 60%.
  - **Effect:** its district covers your whole land, and everything it builds is free (paid in compute).
  - **Cost:** the town is its. It's chaotic and enormously powerful.
  - **Looks:** the violet sky cast starts at 60%.
- **Air Gap:** the AI never touches the map.
  - **Effect:** no district, no drones, no takeover; every agent's boost ×2.
  - **Cost:** none of the notables above that act on the map work.
  - **Looks:** the Data Centre's links go dark, and it hums alone.

#### The Machine's minors (between them)

The retired modules, as small steps:
- Warm Start's kept Equity becomes a seed of money instead, since Equity is now kept;
- Quiet Model (the meter 5% slower a node);
- Rack Density (+1 agent a rack, at most 3);
- Blueprint Cache (−10% Data Centre headcount a node);
- Pre-trained (training 10% shorter a node);
- Seed Round;
- Drone Swarm;
- Memo Filter.

They're numeric and small. The notables and keystones carry the cluster.

#### Pacing

- **Size:** about 10 notables, 3 keystones and about 20 minors.
- **Reveal:** a ring an Ascension, so the cluster takes 4–5 Ascensions to reveal fully.
- **Weights:** about one notable and a few minors per Ascension, with the cost of the next notable rising. A player picks a path, Freight-and-build or Water-and-trade, and comes back for the rest.

**Fusions stay** as they are (the trait fused into the founder). They're the per-founder flavour layer; the Machine is the per-player one.

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
| 10 | Ascension keeps the tree | Equity and the tree's allocations survive Ascension; modules retired into Weights refunds | 9 |
| 11 | The Machine cluster | The cluster in the tree layout, fogged by ring, bought with Weights; Inheritance; the minors | 10 |
| 12 | Machine notables: freight and building | Autonomous Freight (convoys, new lorries), Drone Airlift, Prefab Printing, Generative Zoning | 11, 4 |
| 13 | Machine notables: water, town and trade | Coolant Loop, Holo-Concierge, Market Maker, Night Shift, Self-Funding | 11, 3, 7 |
| 14 | Machine keystones | Alignment, Hard Takeoff, Air Gap | 11, 2 |
| 15 | Balance | Cadence, dominant choices, takeover sim, the Machine's paths; tune | all |

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
- **The Machine** (unit tests per notable):
  - **Autonomous Freight:** a 16-load project needs 6 convoy runs.
  - **Drone Airlift:** an airlifted load costs 25% more and arrives without a road.
  - **Generative Zoning:** never places a lot above what `projectTier` says the spot sustains.
  - **Coolant Loop:** a surplus at one drinker covers a shortage at another, and the loop's water total holds.
  - **Keystones:** they exclude each other.
  - **Inheritance:** delays the takeover by exactly one stage.
- **Ascension keeps the tree:** a test ascends a company with allocated nodes and checks they, Equity and respec points survive, while exits, mandates and the run are wiped.
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
3. **A kept tree is a lot of power across generations.** With Equity no longer wiped, the business tree only grows. If generations snowball, the respec points and the tree's escalating node costs are the brakes. Proposed: measure first in the cadence sim (phase 15), and if needed make each Ascension cost a share of unspent Equity rather than any of the tree.
5. **The Machine's layout:** a cluster among the others, webbed into the rings (proposed), or a separate ring outside them? Among them keeps one tree and lets paths cross between business and machine nodes.
4. **Vetoes and Resentful:** should many vetoes also speed the meter ("it resents being stopped")? It would be thematic, but it makes vetoing a trap. Proposed: no; the trait lean is the consequence.

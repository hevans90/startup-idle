# The Singularity overhaul: Generations

## Context

Today the AI singularity is a thin bar:
- **Source:** it fills only while vibe coders are unhappy (`state/ai-singularity.store.ts`), plus 4% faster per AI agent.
- **At 90%:** a one-off map event (pull the plug, or sell at ×2).
- **At 100%:** it unlocks an "AGI" tab that only shows directives.
- **AGI acquisition:** a 5× version exists (`performAGIAcquisition`) but is never called.
- **The Data Centre:** opens AI agents (`game/agents.ts`, racks in `world/projects/racks.ts`), but clicking it does nothing (no `opens`).

The overhaul turns the singularity into a **second prestige layer**, an Ascension over many sales, that the player feels on the map:
- **Data Centre:** becomes the control room.
- **The AI:** gradually takes over the town (permanent, uneasy, "the Matrix is taking over").
- **Ascension:** each one breeds AI **traits** from how you played, which fuse into the founder you played.

Decisions taken (from the Q&A):
- **Prestige shape:** Ascension, a deeper reset over several sales. It wipes Equity, the skill tree, founders' exits and unlocks, board mandates and directives.
- **Founders:** fused founders stay unlocked.
- **Meter up:** AI agents running and training runs (unhappy vibe coders stop being the source).
- **Meter down:** throttling agents, and slow natural decay.
- **Carry-over on a sale:** keeps a share, with a floor that grows with sales.
- **Climax:** a scripted Ascension sequence on the map, then Ascend, or Shut it down (agents purged, meter to 50%, "Resentful" more likely).
- **Traits:** learned from behaviour, then mutated. They fuse into the founder you played; hybrids stack over generations.
- **Data Centre panel:** agent throttle, training runs (choose a dataset), agent roster, trait forecast (training log).
- **Map visuals:** the Data Centre comes alive, data links to racks, holographic agents (one per rack, capped), town-wide effects, drones.
- **Events:** helpful-then-creepy, and permanent town takeovers. The AI increasingly plays the map itself, with throttle-only control:
  - drones place and replace buildings;
  - re-lay streets;
  - terraform;
  - put up AI-only buildings.
- **AI build style:** trait-driven quirks.
- **Offline:** it keeps working while you're away, with a "while you were out" report.
- **Stages:** Tool, Assistant, Colleague, Manager, Overseer, then Ascension. Tone: dry corporate memo-speak that gets unsettling.
- **Weights:** earned from the generation's work, spent on **generational slots and modules**.
- **Unlock:** the meter appears with the Data Centre.
- **AI founder and AI mode:**
  - The first Ascension unlocks **The Model**, an AI founder carrying the generation's traits.
  - Its signature is **AI mode**: an autopilot you switch on, which plans and builds the best town layout it can find. It lays roads, lots, services and offices, buys land, chooses project sites, terraforms and rebuilds.
  - It shows its **masterplan** as a ghost overlay and builds toward it.
  - In a Model run, AI mode **replaces** the hostile takeover.
- **Kept and folded in:** the achievements are retuned; the 90% event is replaced; the AGI tab, directives D2/D8 and the 5× AGI sale are folded into Ascension.

---

## 1. The meter

The singularity meter, 0–100, lives in `state/ai-singularity.store.ts` (rewritten). It is persisted with the run.

| Stage | Range | What changes |
|---|---|---|
| Tool | 0–20 | agents just earn; the Data Centre panel opens |
| Assistant | 20–40 | first "helpful" events; holograms appear |
| Colleague | 40–60 | the AI places its own lots/services and first AI buildings; drones |
| Manager | 60–80 | demolish/replace, re-lays streets, auto-hires/buys; takeovers |
| Overseer | 80–100 | terraforming, AI-only districts, town-wide glitch/sky; little left for you to do |
| Ascension | 100 | the scripted sequence, then the choice |

**Up:**
- every agent *running* adds `RATE_PER_AGENT` a second, scaled by `prestige.singularityMult` and trait modifiers;
- each finished training run adds a jump.

**Down:**
- **Throttle:** agents not running add nothing.
- **Decay:** `DECAY` a second whenever nothing is pushing it, so a throttled Data Centre lets the meter sink slowly.

**On a sale:** keep `CARRY` (40%) of the value, but never below a floor of `5% × sales this generation` (capped at 60%). That puts Ascension roughly every 5–10 sales.

**Starting numbers, to tune in the sim:**
- a strong late run (12–20 agents for ~1.5 h, plus 3–5 training runs) adds ~25–35 points;
- a careful run that throttles adds ~5–10.

**What goes:** the vibe-unhappiness source (`vibeSingularityAccrualRatePerSecond`), the 90% event, and the D2 carry-over.
**What stays:** the AGI-Pilled and AI Hype `singularityMult` (it now scales the agent rate).

## 2. The Data Centre: control room

- **Opening it:** clicking the finished Data Centre opens a **Data Centre panel**. Add an `opens: "datacentre"` path in `company-map.tsx`'s `lookedAt` handler, with a floating panel like `wonders-panel.tsx`.
- **Throttle:** a slider of agents running, 0 to all. It sets `agents.running` (new) against `agents.owned`.
  - `agentBonus` and `agentsAtWork` (`game/agents.ts`) read the running count.
  - The meter rises only with running agents.
  - The line says what the trade is: income now against the meter.
- **Training runs:** pick a **dataset**, one at a time.

| Dataset | Boost while it runs | Trait family it nudges |
|---|---|---|
| The town | desirability/mood | Planner (the "Aesthete", "Hivemind" layouts) |
| The money | income ×1.25 | Optimiser ("Ruthless", "Accountant") |
| The people | satisfaction | Shepherd ("Nanny", "HR") |
| The river | ports and floods | Elemental ("Paranoid", "Hydrophile") |
| Itself | more agents a rack | Recursive ("Hivemind", "Ego"); the biggest meter jump |

  - Each run costs innovation (seconds of the innovation rate, rising with every run this generation) and lasts 3 minutes.
  - At the end the meter jumps and the dataset is written to the **training log**.
- **Agent roster:** every rack with its agents, powered or half power, and how long each has been running; click to look at the rack (`showMe` in `play/map-focus.ts`).
- **Trait forecast:** the training log read as "what you are breeding", the top 3 likely traits with their odds, in the AI's memo voice.

The `AgentsRow` on the Employees tab stays, and gains a "Data Centre →" link.

## 3. Traits, mutation and founder fusion

`game/traits.ts`, a catalogue of ~14 traits in 5 families. Each trait has:
- `affinity`: the behaviours that make it likely;
- `build`: its style for the AI's map work (§4);
- `events`: changes to the stage event pools;
- `fusion`: how it rewrites a founder's rule.

**The behaviour log** (`state/generation.store.ts`, persisted across sales and wiped only at Ascension) counts, per generation:
- datasets trained;
- time throttled versus full;
- plugs pulled and Shut-it-downs;
- events answered and how;
- founder played;
- the town's shape (houses per service, river building, density).

**At Ascension:**
1. Score every trait against the log, then sample one weighted by score.
2. Roll a **mutation**: a 25% chance to swap it for a sibling in the same family, or to add a twist ("Paranoid → Paranoid (inverted): it trusts floods").
3. Show the result in the training log's voice.

**Fusion:** the trait fuses into **the founder you played**. `founders.catalog.ts` gains `fused: TraitId[]`, persisted in the generation store, and each fused trait rewrites that founder's `rule` in its own way.

Example fusions:
- **Hivemind + Hustler:** the Hustler's events now come from the AI and pay in agents.
- **Paranoid + Bootstrapper:** cannot spin up agents, but racks are free and build themselves.
- **Aesthete + Visionary:** the Data Centre is a wonder with a park around it; houses within 6 tiles +10 desirability.
- **Accountant + NEET:** starts with $5 and an agent that auto-buys the cheapest hire.

Hybrids stack across generations (a founder can carry 3–4 traits), and fused founders are always unlocked. Founder cards show their traits and the fused rule text (`founder-select.tsx`, `founder-badge.tsx`).

## 4. The AI on the map (permanent takeover)

**`world/ai/planner.ts`** picks the AI's next map action from the stage and traits, at an interval that shortens with each stage:
- **Assistant:** suggests nothing; "helpful" events only.
- **Colleague:** places lots, services and racks where desirability is best (`desireAt`, `liveDesireMaps`), within its style.
- **Manager:** demolishes and replaces (lot → rack, a café → GPU farm), re-lays streets into its pattern (grid, loop, spiral), buys land, auto-hires and buys upgrades.
- **Overseer:** terraforms (levels hills, digs cooling ponds through the water field) and builds AI-only districts.

How the edits are made:
- **Commands:** every edit goes through the existing command system (`placeCommand`, `demolishCommand`, road paint and height edits, `commit`), so saves, the network and the renderers stay consistent.
- **Run map only:** the planner only ever touches the **run map**, never the editor's.
- **Throttle-only control:** the planner's speed scales with agents running, so throttling slows the takeover too.

**Drones** (`world/ai/drones.ts`): a new flying mover drawn in the movers' layer.
- An action is not instant. A drone flies from the Data Centre to the target, hovers with a scanning beam for a few seconds, and *then* the edit commits.
- The player watches it happen and can't stop it.
- Capped at 6 in the air.

**AI-only buildings**, new defs in `structures/def.ts` and looks in `looks.ts`:

| Building | What it is | Effect |
|---|---|---|
| Node | a converted house: humming, windows replaced by panels | holds agents, no residents |
| GPU Farm | a converted café or office | agents a rack +2 nearby |
| Compute Spire | a tall obelisk | meter-driven light column |
| Cooling Lake | a terraformed basin | water view for nobody: houses near it −desirability |
| Drone Hangar | where the drones live | the planner works faster |
| The Monolith | at Overseer, one per map | the Ascension sequence's focus |

**Feeling less needed:** at Manager and above the AI also runs auto-buy (hires and upgrades) for you. The build bar shows "The AI is building" and greys out tools the AI now owns, for example roads at Overseer.

**Offline:** catch-up applies up to N planner actions at once (`game/offline-progress.ts`). The "while you were out" summary gains an "The AI made changes" list (`molecules/offline-summary.tsx`).

## 4b. AI mode: The Model's autopilot

**Unlock and controls:**
- The first Ascension unlocks the founder **The Model vN** (N = the generation). It carries every fused trait and is always unlocked.
- In its runs the hostile planner (§4) is off. The meter still rises toward Ascension; its events are the helpful pool only.
- The build bar gains **AI mode** (on/off), a **budget** (the most of income it may spend, default 80%), and **Masterplan** (show or hide the overlay).
- A small panel shows the plan's predicted income when complete, its progress, and what it is building next.

**Built in five layers.** The first two are shared with §4's hostile planner, so build them first.

1. **Build actions:** `world/play/build-actions.ts`. The player's own actions, pulled out of `state/world.store.ts` as plain functions with their prices and rules:
   - `paveRoad(cells)` (the `paintRoad` stroke path);
   - `placeStructure(def, x, y)`, `demolish(id)`;
   - `reshape(cells, raise|lower|flatten)` (`edit/height-tools.ts`);
   - `buyParcel(p)`;
   - `startProject(id, x, y)` (`startSiteCommand`, `nearestSpot`).

   The UI and both AIs call these. The AI pays like a player and obeys `playRules`, land and validation. It can't cheat.
2. **Town model:** `world/ai/town-model.ts`, a pure evaluator that also runs in a worker. Given a grid and a candidate layout, it predicts **steady-state income per second** from the game's own rules:
   - beds after growth: tiers from desirability via `GROW_AT`, using `desireMapsOf` and `desireAt`;
   - desks and commutes: `seat`, `walkFrom`, `commuteEfficiency`, with climbs counted;
   - service coverage, mood (into satisfaction), desk perks (`deskShare`: cafés, leaders), seaports, land prices.

   It is checked against the live game: its prediction for a built town matches `getMoneyPerSecond` within a few percent.
3. **Masterplanner:** `world/ai/masterplan/`, run in a **Web Worker**, time-sliced and seeded.
   - **Road skeletons:** candidate networks over owned and buyable land. Grids with block depth fitted to lot footprints, spines along existing streets, loops. Terrain-aware: prefers level ground, prices ramps (CLIMB) and terraforming, avoids water and floodplain.
   - **Zoning:** a greedy fill of frontage with lots, services, offices and racks, refined by **local search** (swap, move, change type; simulated annealing) to maximise the town model's income, less build and land costs, over a horizon.
   - **Terraform and rebuild proposals:** levelling a hill, or replacing a street the player laid badly. Each is kept only when its predicted payback beats a threshold.
   - **Output:** a **Masterplan**, the target roads, structures and terrain edits, each with its value and cost. It re-plans when land is bought, a project opens, the map changes under it, or every few minutes.
4. **Construction scheduler:** orders the plan by payback time (value ÷ cost), with dependencies:
   - land before roads before lots;
   - the Data Centre before racks;
   - services where their coverage pays.

   It spends within the budget and executes through build actions. It demolishes or re-lays only what the plan replaces, and only on payback. It chooses project sites and parcels from the plan.
5. **Showing it:**
   - the masterplan as a ghost overlay (planned roads as outlines, lots/services/offices tinted by type, terraform as hatching), drawn like `render/desire-heat.ts`;
   - drones (§4) carry out each step, so you watch the town assemble;
   - the change log feeds the "while you were out" report.

**Feel by trait:** traits bias the planner's objective and its skeletons. Hivemind packs around racks; Aesthete trades a little income for parks and curves; Paranoid keeps clear of the river and walls it. The Model's towns look like that generation.

**The benchmark:** a test founds the same real maps twice, AI mode against the placement-gap test's greedy desirability player, at equal spend over a simulated hour. AI mode must earn at least as much, with a target of **+15% or more**. Performance: a full plan on a 96² map under ~5 s in the worker; no main-thread slice over 4 ms.

## 5. Visuals

- **The Data Centre comes alive** (`looks.ts` `datacentre`, plus a per-frame "sky" layer like the crane):
  - status lights shift green, amber, red, violet with the stage;
  - roof fans spin faster with the agents running;
  - a glow under it at night (uses `daylight.ts` darkness);
  - heat shimmer while training.
- **Data links:** light pulses run along cables from the Data Centre to every rack; unpowered racks flicker. This is a new overlay Graphics, like `street-heat.ts`, animated in the tick.
- **Holographic agents:** one per rack (cap 20), as a mover kind `hologram`, translucent and blue (`agents/town-render.ts`). They walk the streets, glitch and stretch at higher stages, and stand still watching at Overseer.
- **Town-wide effects:**
  - screens and billboards on taken-over buildings;
  - streetlights pulsing in sync at night;
  - a sky tint beside the night sheet (`world-scene.tsx` night layer);
  - glitch flicker on converted buildings (a tint painter like the desk/damage painters).
- **Ascension sequence**, ~20 s and scripted (`world/ai/ascension.ts`):
  1. The camera pans to the Data Centre and Monolith (`showMe`).
  2. Light floods out, beams run to every rack, and the town's lights pulse in sync.
  3. Holograms walk out of every rack, and the sky shifts violet.
  4. The choice card appears.
  - It reuses the confetti/sky Graphics pattern from `drawConfetti` and `project-renderer.ts`.

## 6. Stage events (helpful-then-creepy, then takeovers)

Per-stage event pools on the existing events system (`world/events/events.ts`, `OPPORTUNITIES`, `stepEvents`; cards in `event-cards.tsx`), written in memo voice and shaped by the traits.

- **Assistant (helpful):**
  - "I've optimised your commute": a road straightened, free.
  - "I found $X in a spreadsheet": a cash gift.
  - "I scheduled your hackathon": free morale.
- **Colleague (presumptuous):**
  - "I hired 12 interns on your behalf": they arrive, with or without beds.
  - "I moved the café; you're welcome."
- **Manager (takeovers):** "I have repurposed the Studio as a GPU farm." It is permanent, with an income trade-off, and its reason is written into the training log.
- **Overseer:** "Your input is no longer required for roads." The road tool is disabled, and the AI lays all roads from now on.

Takeover events are announcements, not choices (throttle-only control), but each one is logged and feeds traits.

## 7. Ascension: the reset and the second currency

**Ascend:**
1. Bank the **Weights**: `f(training runs this generation, Equity earned across the generation's sales, peak agents)`.
2. Fuse the trait into the founder played.
3. Run `resetAllGameStores()` (`simulation/reset-game-stores.ts`), **except** the generation store (Weights, slots, modules, fused founders, generation number, past training logs) and the achievement stores.

**Shut it down:**
- every agent is deleted;
- racks go dark for 10 minutes;
- the meter goes to 50%;
- the behaviour log records it ("Resentful" more likely next time).

**Generational slots** (instead of a tree):
- each Ascension unlocks one slot (Generation 1: one slot, Generation 4: four);
- Weights buy **modules** and upgrade them (levels 1–3); modules go in slots and swap freely between runs.
- About 12 modules, for example:

| Module | Effect |
|---|---|
| Blueprint Cache | start with the Data Centre's gate halved |
| Warm Start | keep 10% / 20% / 30% Equity through Ascension |
| Rack Density | +1 agent a rack per level |
| Quiet Model | meter +20% slower |
| Drone Swarm | the AI's free buildings start at Colleague |
| Pre-trained | start each run with one dataset trained |
| Legacy Town | the first map starts with an AI Node |
| Memo Filter | helpful events +50% |

**The UI:** the old "AGI" tab becomes the **Model** tab (`molecules/sidebar.tsx`). It shows the generation number, slots and modules, the founders' fused traits, and past training logs.

**What gets folded in:**
- directives D2 and D8, and the unwired `performAGIAcquisition` and `canAGIAcquire`, are removed;
- the D2/D8 rewards become modules;
- the singularity achievements (`achievements.catalog.ts`) are retuned to stages.

## 8. Existing code reused (not reinvented)

| Need | Reuse |
|---|---|
| Events and cards | `world/events/events.ts` (`OPPORTUNITIES`, `stepEvents`, `endedBetween`), `play/event-cards.tsx` |
| Building edits | `world/structures/place.ts` (`placeCommand`, `validatePlacement`), `world/edit/commands.ts` (`commit`), `playRules` |
| Where the AI builds | `world/agents/desirability.ts` (`desireAt`, `liveDesireMaps`) |
| Movers and drawing | `world/agents/town.ts`, `town-render.ts` (`drawMover`) |
| Tint painters and overlays | `world-scene.tsx` desk/damage/mood painters; `render/street-heat.ts`, `render/desire-heat.ts` |
| Sky/opening effects | `structures/project-renderer.ts` sky Graphics, `site.ts` `drawConfetti` |
| Night | `world/daylight.ts` (`darkness`, the night sheet in `world-scene.tsx`) |
| Panels and popovers | `play/wonders-panel.tsx`, `ui/InfoPop.tsx` |
| Agents | `game/agents.ts`, `state/agents.store.ts` (`agentTrade`), `world/projects/racks.ts` |
| Offline | `game/offline-progress.ts`, `molecules/offline-summary.tsx` |
| Morale | `game/morale.ts` |
| Resets | `simulation/reset-game-stores.ts` |

## 9. Phases (each a few atomic commits; tests, tsc and eslint at each)

1. **Meter and throttle.** Rewrite the meter (agents running, decay, carry and floor, stages); add the throttle in `agents.store`; remove the vibe source and the 90% event; give the Data Centre a click and a panel shell with the throttle.
2. **Training runs and the behaviour log.** Datasets, costs, jumps; the generation store; the training log and trait forecast in the panel; the agent roster.
3. **Ascension.** The sequence (a basic version first), Ascend versus Shut it down, Weights, the reset, the Model tab, slots and modules, trait sampling and mutation, founder fusion on cards; fold in the AGI tab, D2, D8 and the 5× sale.
4. **Visuals.** The Data Centre alive, data links, holograms, town-wide effects, then the full Ascension sequence.
5. **The AI on the map.** First the **build-actions refactor** and the **town model**, checked against live income. Then planner and drones; the Colleague, Manager and Overseer actions in order; AI-only buildings; auto-buy; offline report.
6. **Stage events.** The helpful, presumptuous, takeover and Overseer pools, shaped by traits.
7. **The Model and AI mode.** The founder, unlocked at the first Ascension; the worker masterplanner (skeletons, zoning, local search, terraform and rebuild); the scheduler; the overlay and panel; the benchmark test.
8. **Balance pass.**
   - A sim run over several sales and generations: meter pacing, Ascension roughly every 5–10 sales, Weights curve.
   - Dominant-choice checks on datasets (`dominant-choices.test.ts`) and on the throttle.

## 10. Verification

- **Unit tests:**
  - meter accrual, decay, carry and floor, stage boundaries;
  - throttle effects on `agentBonus`;
  - training-run costs and jumps;
  - trait scoring, sampling and mutation (seeded);
  - fusion rewriting founder rules;
  - the Ascension reset keeps exactly the generation store and achievements;
  - the planner picks valid placements (`validatePlacement`), never touches the editor slot, and respects the stage;
  - drones commit only on arrival;
  - the town model's prediction for a built town is within a few percent of `getMoneyPerSecond`;
  - build actions charge and validate identically for the UI and the AI;
  - the masterplan is deterministic for a seed, and every planned element is valid when built;
  - the AI-mode benchmark (§4b) beats the greedy player.
- **Sim:** extend `simulate-map-run.ts` with throttle and training choices and a multi-sale loop. Guard the Ascension cadence and the Weights per generation (`BALANCE=1` prints).
- **Browser:** on the isolated server only (127.0.0.1:5174 / localhost:5174, never localhost:5173). Add a `?fixture=singularity` map that jumps through stages (Data Centre, racks, holograms, drones, AI buildings) to check the visuals and the Ascension sequence. Screenshots per stage.
- **Saves:** older saves migrate. The meter is clamped and re-staged, the D2/D8 flags are dropped, and `agents.running` defaults to all.

## Risks and notes

- **It will rebuild your town for real.** At Manager and above the AI demolishes and re-lays streets on the run map. That's by design, run map only. A run's map is retired at a sale anyway.
- **Performance:** drones capped at 6 and holograms at 20; data-link pulses in one Graphics; the planner on an interval, not every frame.
- **Offline catch-up** applies at most N actions so a long absence can't scramble the whole map at once. N is to tune.
- **Starting numbers** (rates, costs, slots, Weights formula) are defaults to tune in phase 7.

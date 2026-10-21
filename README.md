# Startup Idle

A satirical idle game: hire interns, vibe coders and 10x devs, and build your company's town. React, with the map in PixiJS on its own isometric engine.

## Gameplay

### The economy

- **Employees** (`intern`, `vibe_coder`, `10x_dev`) produce money and innovation; **upgrades** scale them.
- **Innovation:** a soft multiplier (`1 + logMult · log₁₀(innovation + 1)`) and the currency for **managers** (auto-tiering multipliers) and unlocks. **Valuation** buys permanent **board mandates**.
- **Satisfaction:** perks per role and a morale score feeding output. **Team leaders:** one per role, with a trait, ranks and skills.
- **Vape shop:** 53 achievements earn juice for 12 upgrades; the vape rhythm minigame appears at 50 vibe coders. Both survive prestige.
- **Slop pit** (`state/slop-pit.store.ts`): fills from 50 vibe coders, costs income above half full (up to 85%); on the map a 3×3 fluid basin (`StructureDef.basin`, `syncPit`) with a card: Drain (−40 vibe morale), Trucks.
- **AI singularity** (`state/ai-singularity.store.ts`): 0–100, pushed by running agents, sinking when all are throttled; stages Tool → Assistant → Colleague → Manager → Overseer. A sale keeps 80%, floor 10 a sale this generation, cap 90 (`state/generation.store.ts`; `simulation/singularity-cadence.test.ts`: ~5 sales an Ascension strong, 10 typical).
  - **AI tab** (`molecules/ai-tab.tsx`, opened by clicking the Data Centre): generation and Weights, then the Data Centre's controls (`play/datacentre-panel.tsx`): throttle, cooling, **training runs** (`game/training.ts`, `state/training.store.ts`: 2 min with the agents' income boost suspended, then a skill level for this company (`skillOf`, 3 a dataset, reset at a sale: town builds better, money spends better, people spares them, river handles water, itself runs faster) and a meter jump (+2, Itself +5); a dataset's first run leans the trait double), racks, and the training log of **traits** (`game/traits.ts`).
  - **Ascension** at 100 (`game/ascension.ts`, `molecules/ascension-card.tsx`): wipes the company, exits and mandates (Equity and the skill tree are **kept**) for **Weights** (0.4 a training run + 3√Equity + peak agents/2); a logged trait (25% mutates) **fuses into the founder** (`game/fusion.ts`). Shutting down: agents deleted, racks dark 10 min, meter halved. Weights buy **the Machine** (`game/machine.ts`): the skill tree's AI cluster, its own constellation below the business tree with its own root, **Inheritance** (granted at the first Ascension: each company's AI starts at the Assistant, takes nothing till the Overseer, works only to your focus, teal drones); a spoke of 3 minors a module (`moduleLevel` counts them; old module levels refunded), a ring revealed an Ascension, nodes 3/9/20 Weights, kept till a new game. **Notables** between the spokes (ring 2; 30 Weights, +15 each bought): **Autonomous Freight** (`works.ts` `CONVOY`: loads in convoys of three white AI lorries, `AI_TRUCK_COLOUR`, from the garage or the Data Centre, whichever is nearer), **Drone Airlift** (sites ≤4 tiles get loads by cargo drone from the Data Centre, `Airlift`, ×1.25 a load), **Prefab Printing** (new sites ×0.6 work), **Generative Zoning** (the AI's lots born at the tier their spot can carry, `projectTier`). Then **Coolant Loop** (the AI's tanks pool their water, violet links), **Holo-Concierge** (district services reach +4, `CONCIERGE_REACH`, a hologram at the door), **Night Shift** (deskless work at 0.7 not 0.35, `desklessShare`; offices lit violet), and at ring 3 **Market Maker** (district ports turn ships ×1.5 faster, every other one a violet AI freighter; convoys twice as often) and **Self-Funding** (a tenth of the agents' share of income into the AI's wallet, `SELF_FUNDING`). The founder screen's shop (`molecules/model-shop.tsx`) links to it, with fused founders and past generations.
  - **Map** (`world/ai/ai-layer.ts`): Data Centre glows in stage colour, light to racks, one hologram a rack, violet sky from Manager; an 18 s **Ascension sequence** (`world/ai/ascension-sequence.ts`). Preview: `window.__aiPreview = { value, ascension, plan }`, `?world=1&fixture=singularity` (cycles the stages); `/?fixture=singularity` plays it as The Model, gen 2, on an in-memory copy of storage (`fixture-sandbox.ts`, `world/debug/fixture-company.ts`).
  - **The AI builds** from Colleague (`world/ai/planner.ts`, `ai-runner.ts`) via the player's actions (`play/build-actions.ts`): lots, services, its own buildings (`AI_BUILDINGS`); Manager: houses, roads, hires; Overseer: terraforms, and its district's streets are its own. All of it in its **district** (`world/ai/district.ts`): a circle round the Data Centre, 8/12/18 tiles by stage, the map at the Ascension; pipes to water, hires and upgrades anywhere. It spends only its **allowance** (`world/ai/wallet.ts`): a share of income set in the Data Centre panel (0–50%, default 20%), up to 10 minutes of it; a job it can't pay for, it waits for. Pace = share of agents running; offline up to 10 jobs. **Memos** (`world/ai/memos.ts`, `play/ai-memos.tsx`) every 3–6 min. It **cools first** (pipes when short; no new drinker till every tank is 80% full), takes empty houses and the least-used service/office first, and **announces** each takeover a minute ahead (memo + red hologram, `pending` in `ai-runner.ts`). **Veto:** click a takeover drone, its hologram or a red building to call it off (`vetoAt`); each refusal is logged (`log.vetoes`), leans Resentful (and a little Patient), and gets a reply. **Focus** (`world/ai/focus.ts`, Data Centre panel): Grow the town / Feed the machine / Serve the people / Hands off weigh its kinds of job (0 = never) under the trait's lean; Hands off is cooling only and logged as throttled; the panel shows its next job's ETA and worst-cooled building. **The Lattice** (`world/ai/lattice.ts`): at 95% the meter holds (`meterCap`, a reader the scene registers) till the AI builds a 3×3 Lattice by the Data Centre and charges it 3 min with the Data Centre and the Lattice cooled (it drinks 1/s) and 24 agents running; the panel lists what it lacks.
  - **The Model** (founder, unlocked by the first Ascension, carries every trait) has **AI mode** (`world/ai/autopilot.ts`, `play/ai-mode-panel.tsx`): one small **block** at a time — a 9×9 patch by the street nearest the town's middle with room beside it (`blockAt`), planned in a worker (`world/ai/masterplan/`) and built step by step every 2 s (`nextStep`) within a budget, hiring into empty beds and buying the upgrade the next project waits on; each build flown out by drone and done when it has scanned, a **hologram** of it there till then (`render/holograms.ts`: the real renderer, tinted, additive, scan lines — the build tool shows one too, red where it cannot go; the block's plan is holograms throughout — its buildings faint glass, its streets their road tiles joined up as if laid, its levelling the ground at its new height, what it lifts or clears red (`createTileHolograms`)); offices for the kind living on the map without desks, ghosted; traits set a **style**, wide to tall (`tallness` in `masterplan/style.ts`: most lean tall, Hivemind pulls wide) — tall plans a park, café and gym first, lots only where they will grow to III (`projectTier`), offices nearest their houses; scored by a town model held to the live game's growth (`town-model.ts`); each block the best of six looked ahead at (`chooseBlock` in `lookahead.ts`: income or beds for the price, by style); a starter lot or two pulled down for a missing service where it pays back in 10 min (`replace.ts`). Benchmarked on settled income at +90% over a greedy player. Plans: `plans/singularity.md`, `plans/ai-planning.md`.
- **Founders:** six archetypes (Hacker, Bootstrapper, Visionary, Hustler, Agentic Delusionist, NEET), bonuses growing per exit; NEET starts with $5, ×2 money per exit. Map rules (`FounderDef.rule`, `game/founder-rules.ts`): Bootstrapper builds −35%; Hacker labs ×2; Visionary Data Centre half headcount; Hustler events ×2.
- **Offline progress:** the real tick replayed (cap 2 days).
- **Acquisition (prestige):** sell for **Equity**, spent in a ~330-node skill tree. Notables for the next town: Hometown Hero (a café), Clean Sweep (half the mop crew), Conglomerate (a starting route), Open Core (repairs ×2), Founder Worship (a fourth term sheet).

### Founding

**Who**, **where**, **terms** (`founder-select.tsx`, `map-setup.tsx`): the land picker previews the real generator (seed, size 48/64/96, hills, rivers, lakes, woods) and founds on that map (`Session.mapChoice`). Hilly maps (`gen/rugged.ts`) say so: ramps count double on commutes (`CLIMB`, `walkFrom`). **Term sheets** (`term-sheet-select.tsx`, `game/term-sheets.ts`): three of five by seed (sell inside 2 h 30, 40 lived-in houses, no slop overflow, two wonders, 12 AI agents), each +20–30% Equity if met.

### The company's map

The town (`world/play/company-map.tsx`): buildings need **road frontage**. **Hints** (`play/hints.ts`, `data-hint`). **Phone** (≤ 768 px): Map/Company tabs, map always mounted, touch buttons ≥ 44 px.

- **Build bar** (`build-bar.tsx`): beds per district, tools (Look, Road, Lift, Build, Demolish, Wonders, Mood, Labels), a picker (Lot, Office, Services, Ports).
- **Undo** for 15 s, money included (`undoLastBuild`). **Labels** (`building-labels.tsx`) collate when they overlap (`gatherLabels`).
- **No land to buy:** the company builds anywhere on its map by a road. A **derelict** (old saves) is −5 mood within 4 tiles and costs 15 s of income to clear.
- **Housing** (`world/agents/arrivals.ts`): **lots** (1×1, 2 beds) dragged in rows (`lotLine`) count toward the hiring cap at once (`Structure.residents`). Hires travel in, idle until housed (`attendance`): interns by 12-seat bus, others by car/limo. Loading moves everyone in (`settleHousing`). 2 remote intern beds to start (`foundingRemoteBeds`).
- **Desks** (`agents/commute.ts`): garage 20, Studio 30, Campus 10; intern/vibe offices 40, 10x 10. Nearest free desk first (`seat`); deskless work at 35%. Commutes free to 8 tiles, then −1.25%/tile to 50%; no road 25% (`commuteFactor`). Fill tint: `deskTint`.
- **R&D labs** (`world/projects/labs.ts`, 2×2): +10% innovation each, 20% within 10 tiles of campus or Data Centre (`labBonus`); a minute of income (≥ $100k), ×1.5 each.
- **AI agents** (`game/agents.ts`, `world/projects/racks.ts`): after the Data Centre, cost innovation (2, ×1.25); racks hold 4 (20 s of income, ×1.15). +4% income each within 10 tiles of the Data Centre, half beyond; the row shows the net trade (`agentTrade`).
- **Cooling water** (`game/cooling.ts`, `world/projects/cooling.ts`): the Data Centre, AI nodes, GPU farms and spires drink (0.05 an agent a second, the Data Centre's first 2 agents free) from a 30 s tank; the share met is the share of agents at full power, the rest at half. A pipe end facing a drinker fills its tank (`intakeOf` in `water/pipes.ts`), with water really taken from the pond or river. **Pipe tool** in the build bar (`gamePipeRun`: ends face a drinker, a pump or water, else cap; a water end sits on the water's floor; ×2 road's price); Lift lifts pipe. **Pump house** (`PUMP`, beside water) lifts 4 slabs, money a second while it runs (`runPumps`). The AI routes pipes (`world/ai/pipe-route.ts`, `cooling-ai.ts`): AI mode first when short, the takeover AI from Colleague. With no water in reach (Manager on) it digs a **reservoir** (`world/ai/reservoir.ts`): a 3×3 basin on level ground by the building, 8 half steps deep, one pour, a stone rim drawn round it; two a company at most; it then pipes from it. No random ponds. Measured in `pipe-capacity.test.ts`: one gravity run feeds ~20 agents, a pump ~12. Plan: `plans/datacentre-water.md`.
- **Services and growth** (`agents/services.ts`): café, park, gym serve within 8 road tiles (4/8/16 s of income). Full houses grow at desirability 4/10/16 (`GROW_AT`) after 20 s, decline after 30 s at 4 below. 10x devs need 10.
- **Mood is desirability** (`agents/mood.ts`, `agents/desirability.ts`, `game/town-mood.ts`): commute (to −30), services (+4/+6/+4, none −6), water view +5, slop pit −8 to −20, crowding −6, wonder +5, derelict −5, sludge −15, flood −20; cap ±40. A lot in hand heat-maps it (`desire-heat.ts`, `desire-readout.tsx`). At −25 a house loses a resident a minute. **Earnings** tints streets gold and lists the top three (`roads/streets.ts`, `play/street-earnings.ts`, `top-streets.tsx`).
- **Prices** (`game/build-cost.ts`): max(floor, live share): lots ¼ of the next hire a bed (≥ $15), offices four hires, services and seaports seconds of income, road max($2, 0.25 s) a tile.

**Map events** (`world/events/`, `play/event-cards.tsx`): one at a time, a choice card each, paced in play time (`PACING`, `Session.eventPacing`). Event morale lasts a day (`game/morale.ts`).

- **Slop overflow** (`events/sludge.ts`): warned at 90%, spills at 100% until under 95%; Drain, trucks (20 s, 3 × 12%) or spill. **Mopping up** (`events/cleanup.ts`): 2 vibe coders a wet tile.
- **River flood** (`events/flood.ts`): the inflow tops its lowest bank for a minute. Sandbags (half the interns), evacuate (−5 satisfaction a day) or brace (−20 mood, ports shut, buildings **damaged** until repaired, 40 s each). **Flood walls**: 1×1, max($20, 0.5 s) a tile.
- **Convoy** (`events/convoy.ts`): calls pay ×2 for a minute, ×3 within 10 tiles of the Conference Centre; served, it becomes a **regular route** (+20% calls, up to five, `session.routes`).
- **Investor tour:** 30 s of income + 1.5 s per mood point; tidying +10 mood; a snub drops the next premium to +10% (`SNUB`).
- **Hackathon** (10 vibe coders): 20 s of pizza for +15 satisfaction a day, or −10.
- **The agents decide things:** each agent speeds the meter 4%; at 90% pull the plug (meter 50%), sell to them at 2× Equity, or lose half the money to compute.
- **Acquisition offer:** +25% Equity for two minutes (`OFFER_PREMIUM`). A first company sells ~2.3 h in.

**Projects** (`game/projects.ts`, `world/projects/works.ts`): gated by an upgrade, wonders by headcounts (`ProjectDef.gate`); **one at a time** (`projectUnderWay`). A crew builds, trucks bring materials paid per load; offline caught up (`catchUpWorks`). A finished building that opens something lights up amber under the pointer and takes the click from any tool but demolish (`world/play/opens.ts`, `render/open-highlight.ts`).

| Project | Gate | Built by | Work (builder-s) | Materials | Site | Opens |
| --- | --- | --- | --- | --- | --- | --- |
| Founder's Garage | — | the founder | 30 | free | 2×1 | interns |
| Town Hall | Mandatory Weekend Work | interns | 300 | 30 s (≥ $120) | 3×2 | services |
| Vibe Coder Studio | Micromanagement | interns | 600 | 45 s (≥ $400) | 3×2 | vibe coders |
| Harbour Office | Promotion Griefing, river maps | int + vibe | 900 | 45 s (≥ $1.5k) | 2×2, ≤ 3 from a river | seaports |
| Company HQ | Focus Vibing | int + vibe | 2,400 | 60 s (≥ $5k) | 3×3 | managers |
| Boardroom Tower | Upward Management + emp. mgmt | int + vibe | 4,000 | 90 s (≥ $20k) | 3×3 | board mandates |
| Campus | JUULing | int + vibe | 6,000 | 2 min (≥ $40k) | 4×4 | 10x devs |
| Data Centre ★ | 120 · 50 · 3 | vibe + 10x | 10,000 | 3 min (≥ $200k) | 3×3 | innovation ×2, AI agents |
| Conference Centre ★ | 250 · 100 · 6 | vibe + 10x | 14,000 | 4 min (≥ $500k) | 4×3 | valuation ×1.5 |
| *or* Hackerspace ★ | 250 · 100 · 6 | vibe + 10x | 14,000 | 4 min (≥ $500k) | 4×3 | income ×1.3 |
| IPO Tower ★ | 350 · 150 · 8 | vibe + 10x | 20,000 | 5 min (≥ $2M) | 3×3 | income ×1.5, valuation ×2 |

★ Wonders (`play/wonders-panel.tsx`; headcounts interns · vibe · 10x; "int" = interns). Conference Centre and Hackerspace are a fork (`ProjectDef.rival`, `ruledOut`). Log: `projects-panel.tsx` (`Session.seenProjects`). Gated only with a map mounted (`setHousingReader`, `setProjectReader`).

- **Seaports** (`boats/traffic.ts`): three tiers (1–3 berths, 20/15/10 s calls), each call 0.5/0.75/1 s of income (`portCallFee`), credited offline.
- **Town life** (`agents/town.ts`): traffic; a 10-minute day/night with rush hours (`world/daylight.ts`).
- **Team leaders on the map** (`agents/leaders.ts`, `play/leader-tags.tsx`): live in the best home of their kind and lead the nearest workplace, +25% desks, two a building (`leadershipOf`, `leadShare`, `leadBonus`). A **café** within 3 tiles adds +10% (`agents/desk-perks.ts`, `deskBonus`).
- **At a sale** (`projects/town-worth.ts`): +1% a grown tier, +2% a service, +5% a wonder, up to +50%. Run and editor maps save apart (`world-run`, `world-map`).

## Tech stack

React 19 + TypeScript (Vite, SWC), Tailwind CSS v4; Zustand persisted to `localStorage`; PixiJS v8, @pixi/react, pixi-viewport; WebGPU compute water with a CPU reference; break_infinity.js (`Decimal`); Arwes (`@arwes/text`: the decipher text); Bun (runtime, tests); Tauri (desktop).

## Getting started

`bun install`, then:

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server (HMR) |
| `bun run build` | Type-check + production build |
| `bun run typecheck` | `tsc -b`. A bare `tsc -p tsconfig.json` checks nothing here. |
| `bun test` | The test suite |
| `bun run lint` | ESLint |
| `bun run preview` | Preview the build |
| `bun run tauri:dev` / `tauri:build` | Desktop app |
| `bun run bake:trees` / `bake:road-corners` | Regenerate tile sheets in `public/isometric_assets/derived/` |

## Project structure

```
src/
  App.tsx            # Root, game loop, offline check
  state/             # Zustand stores, one per system, persisted
  game/              # Pure game logic: catalogs, multipliers, costs, projects…
  molecules/  ui/    # Composite UI and primitives
  iso/               # Isometric maths, building-kit composition
  fluid/             # Column water solver; gpu/ is WebGPU compute
  world/             # The company's map, and the ?world=1 editor
    grid.ts  iso.ts  #   Map layers; projection, picking
    gen/             #   Map generator
    roads/           #   Masks, autotiling, network
    structures/      #   Definitions, placement, renderers; projects/ for sites
    water/           #   Live water field, springs, pipes
    render/          #   Bands, terrain, water mesh, foam, falls
    agents/          #   Traffic, arrivals, commute, services, mood
    events/          #   Map events
    boats/           #   Boats, wakes, port traffic
    projects/        #   Project sites, labs, racks, town worth
    ai/              #   AI layer, planner, memos, autopilot, masterplan
    play/            #   Map UI: build bar, projects, labels, panels
    edit/  io/       #   Editor tools, undo; map files and saves
    debug/           #   Editor chrome, fixtures, perf/GPU harnesses
  simulation/        # Headless sims, used by tests
```

## Architecture

- **State:** a persisted Zustand store per system; `Decimal`s via `decimalReplacer`/`decimalReviver`. Bumping major/minor of `CURRENT_VERSION` wipes progress.
- **Game loop:** an interval in `App.tsx`; offline time credited once map readers register (`whenWorldReady`).
- **The world reads, the economy listens:** `game/` never imports `world/` at runtime; the map registers readers.
- **Grid:** typed arrays indexed `y*w+x`, dirty-cell redraws.
- **Bands:** a container per diagonal `x+y`; cached render groups, so **Pixi's GC is off** (`stopGarbageCollection`).
- **Heights:** half steps (16.5 px); roads autotile from 8-neighbour masks.
- **Water:** a storeyed shallow-water column solver, WebGPU by default, CPU the reference (`?gpucheck`, `__waterCompare`); the mesh is built in a vertex shader.
- **Map generator:** rivers first, ground carved round a street, priority-flood basins.
- **Live state** (water, boats, traffic, arrivals, crews) lives outside the grid.
- **Atlases:** padded re-packs (`bun run bake:padded`), mipmapped: `nearest` up close, filtered zoomed out (`crispUpClose`; `?nomips` for the old sheets).
- **Feel:** eased arrow keys, fly-to (`showMe`); `render/juice.ts` drops new buildings in, hops grown houses, puffs dust (tweens: `render/tween.ts`).
- **Seeing behind:** whatever stands in front of what the hand is on — the tile under the pointer, a build tool's footprint or drag — collapses to its ground floor with an outline of its full height, and stands again a moment after (`render/cutaway.ts`); a building not drawn in floors fades.
- **Night:** a multiplied grade (`NIGHT_GRADE`) with the town's lights over it (`render/lights.ts`: lit houses, street lamps); `__dayPhase` holds an hour in dev.
- **Sound:** `src/audio/sound.ts`, synthesised in Web Audio (effects, a town hum, birds, crickets); level and mute in settings.
- **Engine plan:** `plans/engine-polish.md`.

## Dev tools

- **Editor:** `?world=1`. **Flags:** `?fixture=<name>` (unsaved test map; `projects` shows every build stage, `singularity` the AI), `?nosave`, `?cpuwater`, `?webgl`, `?gpucheck` / `?gpuwhy`, `?perf` (frame meter in play: town, fx, draws, Graphics redrawn; `__perf()`); `?fixture=bigtown&crowd=2000` is the engine's stress town (~2,100 buildings), measured with `__townPerf()` (real frames: the pane must be visible). `?hitches` times every timer and frame callback by where it was registered: `__hitches()` lists the worst — the meter averages, and hides hitches.
- **Window hooks (dev):** `__world`, `__town()`, `__structures`, `__net`, `__waterBench(n, true)`, `__fakeHires = { intern: 9 }`, `__eventNow`, `__aiPreview`. Use these, not `import()` (a second module copy).
- **Water solver** logged per change (`WATER: GPU solver` / `WATER: CPU solver — <reason>`, `GPU:`); history in `window.__waterSolver()`.
- **A hidden tab pauses `requestAnimationFrame`**; its frame numbers mean nothing.
- **Labeller** (`dev/roadlabel.html`) authors `building-kits.json`, `road-labels.json`, `slope-labels.json`: hand-authored, never overwritten by code.
- **DEV panel** (cheats): development builds only (`import.meta.env.DEV`).

## Testing

`bun test` runs `*.test.ts` and `src/simulation` sims: `simulate-map-run.ts` plays a gated run, `map-balance.test.ts` holds its pacing (`BALANCE=1` prints milestones); `placement-gap.test.ts` holds desirable-vs-anywhere lots at 20–40% (~33%); `dominant-choices.test.ts` holds every event choice under 70% best; `run-spread.test.ts` compares five founders (`MapRunOptions.founder`, ~9%). Type-check with `bun run typecheck` (`tsc -b`).

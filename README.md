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
  - **AI tab** (`molecules/ai-tab.tsx`, opened by clicking the Data Centre): generation and Weights, then the Data Centre's controls (`play/datacentre-panel.tsx`): throttle, cooling, **training runs** (`game/training.ts`, `state/training.store.ts`: 3 min boost, then a meter jump), racks, and the training log of **traits** (`game/traits.ts`).
  - **Ascension** at 100 (`game/ascension.ts`, `molecules/ascension-card.tsx`): wipes Equity, skill tree, exits and mandates for **Weights**; a logged trait (25% mutates) **fuses into the founder** (`game/fusion.ts`). Shutting down: agents deleted, racks dark 10 min, meter halved. Weights buy **modules** (`game/modules.ts`, 3 levels, one slot an Ascension) **between companies**, on the founder screen (`molecules/model-shop.tsx`): slots, modules, fused founders, past generations.
  - **Map** (`world/ai/ai-layer.ts`): Data Centre glows in stage colour, light to racks, one hologram a rack, violet sky from Manager; an 18 s **Ascension sequence** (`world/ai/ascension-sequence.ts`). Preview: `window.__aiPreview = { value, ascension, plan }`, `?world=1&fixture=singularity` (cycles the stages); `/?fixture=singularity` plays it as The Model, gen 2, on an in-memory copy of storage (`fixture-sandbox.ts`, `world/debug/fixture-company.ts`).
  - **The AI builds** from Colleague (`world/ai/planner.ts`, `ai-runner.ts`) via the player's actions (`play/build-actions.ts`): lots, services, its own buildings (`AI_BUILDINGS`); Manager: houses, roads, hires; Overseer: terraforms, locks road tools. Pace = share of agents running; offline up to 10 jobs. **Memos** (`world/ai/memos.ts`, `play/ai-memos.tsx`) every 3–6 min; from Manager it repurposes services/offices as GPU farms.
  - **The Model** (founder, unlocked by the first Ascension, carries every trait) has **AI mode** (`world/ai/autopilot.ts`, `play/ai-mode-panel.tsx`): one small **block** at a time — a 9×9 patch by the street nearest the town's middle with room beside it (`blockAt`), planned in a worker (`world/ai/masterplan/`) and built step by step every 2 s (`nextStep`) within a budget, hiring into empty beds and buying the upgrade the next project waits on; each build flown out by drone and done when it has scanned, a **hologram** of it there till then (`render/holograms.ts`: the real renderer, tinted, additive, scan lines — the build tool shows one too, red where it cannot go; the block's plan is holograms throughout — its buildings faint glass, its streets their road tiles joined up as if laid, its levelling the ground at its new height, what it lifts or clears red (`createTileHolograms`)); offices for the kind living on the map without desks, ghosted; traits set a **style**, wide to tall (`tallness` in `masterplan/style.ts`: most lean tall, Hivemind pulls wide) — tall plans a park, café and gym first, lots only where they will grow to III (`projectTier`), offices nearest their houses; scored by a town model held to the live game's growth (`town-model.ts`); each block the best of six looked ahead at (`chooseBlock` in `lookahead.ts`: income or beds for the price, by style); a starter lot or two pulled down for a missing service where it pays back in 10 min (`replace.ts`). Benchmarked on settled income at +90% over a greedy player. Plans: `plans/singularity.md`, `plans/ai-planning.md`.
- **Founders:** six archetypes (Hacker, Bootstrapper, Visionary, Hustler, Agentic Delusionist, NEET), bonuses growing per exit; NEET starts with $5, ×2 money per exit. Map rules (`FounderDef.rule`, `game/founder-rules.ts`): Bootstrapper builds −35%, land ×2; Hacker labs ×2; Visionary Data Centre half headcount; Hustler events ×2.
- **Offline progress:** the real tick replayed (cap 2 days).
- **Acquisition (prestige):** sell for **Equity**, spent in a ~330-node skill tree. Notables for the next town: Company Town (+2 parcels), Cheap Real Estate (land −40%), Hometown Hero (a café), Clean Sweep (half the mop crew), Conglomerate (a starting route), Open Core (repairs ×2), Founder Worship (a fourth term sheet).

### Founding

**Who**, **where**, **terms** (`founder-select.tsx`, `map-setup.tsx`): the land picker previews the real generator (seed, size 48/64/96, hills, rivers, lakes, woods) and founds on that map (`Session.mapChoice`). Hills cut land up to 40% (`landDiscount`, `ruggedness`) but ramps count double on commutes (`CLIMB`, `walkFrom`). **Term sheets** (`term-sheet-select.tsx`, `game/term-sheets.ts`): three of five by seed (sell inside 2 h 30, 40 lived-in houses, no slop overflow, two wonders, 12 AI agents), each +20–30% Equity if met.

### The company's map

The town (`world/play/company-map.tsx`): buildings need **road frontage**. **Hints** (`play/hints.ts`, `data-hint`). **Phone** (≤ 768 px): Map/Company tabs, map always mounted, touch buttons ≥ 44 px.

- **Build bar** (`build-bar.tsx`): beds per district, tools (Look, Road, Lift, Build, Demolish, Land, Wonders, Mood, Labels), a picker (Lot, Office, Services, Ports).
- **Undo** for 15 s, money included (`undoLastBuild`). **Labels** (`building-labels.tsx`) collate when they overlap (`gatherLabels`).
- **Land** (`world/land.ts`): 4×4 parcels; a new company owns a 2×2 block (`Session.land`; null owns all). A parcel costs max($400 × 2.5ⁿ, 45 s × 1.5ⁿ of income). About half carry a **derelict** (`placeDerelicts`): −5 mood within 4 tiles, 15 s of income to clear.
- **Housing** (`world/agents/arrivals.ts`): **lots** (1×1, 2 beds) dragged in rows (`lotLine`) count toward the hiring cap at once (`Structure.residents`). Hires travel in, idle until housed (`attendance`): interns by 12-seat bus, others by car/limo. Loading moves everyone in (`settleHousing`). 2 remote intern beds to start (`foundingRemoteBeds`).
- **Promotion** (`state/promotion.store.ts`, `molecules/promotion-row.tsx`): intern → vibe coder for 20 s of innovation (≥ 10), +5% each; needs a vibe bed.
- **Desks** (`agents/commute.ts`): garage 20, Studio 30, Campus 10; intern/vibe offices 40, 10x 10. Nearest free desk first (`seat`); deskless work at 35%. Commutes free to 8 tiles, then −1.25%/tile to 50%; no road 25% (`commuteFactor`). Fill tint: `deskTint`.
- **R&D labs** (`world/projects/labs.ts`, 2×2): +10% innovation each, 20% within 10 tiles of campus or Data Centre (`labBonus`); a minute of income (≥ $100k), ×1.5 each.
- **AI agents** (`game/agents.ts`, `world/projects/racks.ts`): after the Data Centre, cost innovation (2, ×1.25); racks hold 4 (20 s of income, ×1.15). +4% income each within 10 tiles of the Data Centre, half beyond; the row shows the net trade (`agentTrade`).
- **Cooling water** (`game/cooling.ts`, `world/projects/cooling.ts`): the Data Centre, AI nodes, GPU farms and spires drink (0.05 an agent a second, the Data Centre's first 2 agents free) from a 30 s tank; the share met is the share of agents at full power, the rest at half. A pipe end facing a drinker fills its tank (`intakeOf` in `water/pipes.ts`), with water really taken from the pond or river. **Pipe tool** in the build bar (`gamePipeRun`: ends face a drinker, a pump or water, else cap; a water end sits on the water's floor; ×2 road's price); Lift lifts pipe. **Pump house** (`PUMP`, beside water) lifts 4 slabs, money a second while it runs (`runPumps`). The AI routes pipes (`world/ai/pipe-route.ts`, `cooling-ai.ts`): AI mode first when short, the takeover AI from Colleague. Measured in `pipe-capacity.test.ts`: one gravity run feeds ~20 agents, a pump ~12. Plan: `plans/datacentre-water.md`.
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

React 19 + TypeScript (Vite, SWC), Tailwind CSS v4; Zustand persisted to `localStorage`; PixiJS v8, @pixi/react, pixi-viewport; WebGPU compute water with a CPU reference; break_infinity.js (`Decimal`); Bun (runtime, tests); Tauri (desktop).

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
    land.ts          #   Parcels and their price
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
- **Feel:** camera inertia, eased wheel and arrows, fly-to (`showMe`); `render/juice.ts` drops new buildings in, hops grown houses, puffs dust (tweens: `render/tween.ts`).
- **Night:** a multiplied grade (`NIGHT_GRADE`) with the town's lights over it (`render/lights.ts`: lit houses, street lamps); `__dayPhase` holds an hour in dev.
- **Sound:** `src/audio/sound.ts`, synthesised in Web Audio (effects, a town hum, birds, crickets); level and mute in settings.
- **Engine plan:** `plans/engine-polish.md`.

## Dev tools

- **Editor:** `?world=1`. **Flags:** `?fixture=<name>` (unsaved test map; `projects` shows every build stage, `singularity` the AI), `?nosave`, `?cpuwater`, `?webgl`, `?gpucheck` / `?gpuwhy`, `?perf` (frame meter in play: town, fx, draws, Graphics redrawn; `__perf()`).
- **Window hooks (dev):** `__world`, `__town()`, `__structures`, `__net`, `__waterBench(n, true)`, `__fakeHires = { intern: 9 }`, `__eventNow`, `__aiPreview`. Use these, not `import()` (a second module copy).
- **Water solver** logged per change (`WATER: GPU solver` / `WATER: CPU solver — <reason>`, `GPU:`); history in `window.__waterSolver()`.
- **A hidden tab pauses `requestAnimationFrame`**; its frame numbers mean nothing.
- **Labeller** (`dev/roadlabel.html`) authors `building-kits.json`, `road-labels.json`, `slope-labels.json`: hand-authored, never overwritten by code.
- **DEV panel** (cheats): development builds only (`import.meta.env.DEV`).

## Testing

`bun test` runs `*.test.ts` and `src/simulation` sims: `simulate-map-run.ts` plays a gated run, `map-balance.test.ts` holds its pacing (`BALANCE=1` prints milestones); `placement-gap.test.ts` holds desirable-vs-anywhere lots at 20–40% (~33%); `dominant-choices.test.ts` holds every event choice under 70% best; `run-spread.test.ts` compares five founders (`MapRunOptions.founder`, ~9%). Type-check with `bun run typecheck` (`tsc -b`).

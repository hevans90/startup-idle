# Startup Idle

A satirical idle game about scaling a tech startup by any means necessary: hire interns, unleash vibe coders, anoint 10x devs, and build the town your company lives in. A single-page React app, with the company's map drawn in PixiJS on a mutable isometric engine of its own.

## Gameplay

### The economy

- **Employees** are the generators: `intern`, `vibe_coder` and `10x_dev`, each producing money and innovation every tick. Hire more, and buy **upgrades** to scale them.
- **Innovation** is a soft global multiplier (`1 + logMult · log₁₀(innovation + 1)`) and the currency for **managers** and unlocks.
- **Managers** are auto-tiering multipliers for money, innovation and valuation.
- **Valuation** accrues from revenue and buys permanent **board mandates**.
- **Employee management and satisfaction:** perks per role (money, innovation, cost, auto-buy), and a morale score that drifts each tick and feeds back into output.
- **Team leaders:** one named employee per role, hired from three candidates. Each has a trait, earns ranks over time, and spends skill points on a small skill pool, some of which reach across roles.
- **Vape shop:** 53 achievements earn vape juice, which buys 12 upgrades shown on an SVG vape. The vape itself, a rhythm minigame, appears once the company has 50 vibe coders. Achievements and upgrades survive prestige.
- **Slop pit:** fills with headcount once there are 50 vibe coders, and costs income above half full, up to 85% (`state/slop-pit.store.ts`). On the map it opens beside the studio as a 3×3 excavation with acid-green sludge rising as it fills (`structures/slop-renderer.ts`). A card shows the fill and the penalty, with a Drain button that costs 40 vibe coder morale.
- **AI singularity:** a meter that creeps up when vibe coders are miserable.
- **Founders:** six archetypes (Hacker, Bootstrapper, Visionary, Hustler, Agentic Delusionist, NEET). Each has a bonus that grows with every exit made as that founder. NEET starts with $5 and doubles money output per exit.
- **Offline progress:** the real tick is replayed over the time away (capped at 2 days), with a "welcome back" summary.
- **Acquisition (prestige):** sell the company for permanent **Equity**, start a fresh company, and spend Equity in a procedurally laid out skill tree of about 330 nodes.

### Founding

Founding is two steps: **who**, then **where** (`molecules/founder-select.tsx`, `world/play/map-setup.tsx`). "Choose your land" runs the real map generator live and previews it as a shaded diamond. It offers a seed, a size (48, 64 or 96 tiles), and sliders for hills, rivers, lakes and woods, with every generator setting behind "All settings". The map you found on is exactly the map you saw (`Session.mapChoice`).

### The company's map

Every company builds a town (`world/play/company-map.tsx`). Under the game's rules, buildings need **road frontage** (one footprint cell touching paving) and cost money. The build bar (`build-bar.tsx`) is one panel:

- **Top row:** each district's people against its beds, with who's on the way and who's waiting.
- **Bottom row:** the tools, Look, Road, Lift, Build, Demolish and Labels.
- **Build picker:** everything at once, no scrolling: a row per employee kind the company can hire (its Lot and its Office), then Services once the Town Hall stands, then Ports once the Harbour Office does.

**Housing is zoned, Caesar-style** (`world/agents/arrivals.ts`):

- **Lots:** building housing lays out a **lot** (staked ground and a sign in the district's colour). Its beds count towards the hiring cap at once, but nobody lives there yet (`Structure.residents`).
- **Hires travel in:** a hire is an offer accepted. The new hire travels in from where a road leaves the map, and **produces nothing until they've moved in**. Hired-but-absent people count as away in `attendance`.
- **Interns come by bus**, shared: it waits for 12 interns, or for the first to have waited 6 s, then drives a round of their lots, filling part-full houses first.
- **Vibe coders come by car** and **10x devs by limousine**, one each.
- **Conditions to arrive:** a lot of their kind with a free bed (counting people already on the way), and a road to it from the map's edge. If either is missing they wait, and the beds row says why.
- **Houses rise as they fill**, floor by floor.
- **On load:** rides aren't saved, so loading the map moves everyone straight in (`settleHousing`).
- **Remote beds:** a new company has 2 intern beds off the map, so it can earn its first house. A company that had staff before it had a map keeps them all (`foundingRemoteBeds`).
- **Max hiring** stops at the free beds (`getMaxAffordableAmountAndCost`).

**Commuting** (`world/agents/commute.ts`):

- **Workplaces:** each kind works at the building that opened it (garage, studio, campus) or at an **office** for its kind. Offices are bought from the Build picker and drawn like the original buildings: an intern office (2×2), a vibe studio (2×2) and a 10x office (3×3).
- **The cost of distance:** a house's commute is its road distance to the nearest workplace of its kind. Up to 8 tiles costs nothing, then 1.25% a tile down to 50%. With no road to any workplace, its people work at 25%. Remote workers lose nothing.
- **Effect:** the average multiplies into each kind's output through `attendance` (`commuteFactor`), alongside people away building or still arriving.
- **On the map:** 60% of the town's trips are commutes, walked if 12 tiles or under, driven if further. House labels show the commute; workplace labels show how many work there.

**Services, and housing that evolves** (`world/agents/services.ts`):

- **Services:** a café (2×1), a park (2×2) and a gym (2×2). Each serves homes within 8 road tiles of its door. They're in the picker's Services section, priced at 4, 8 and 16 s of income (at least $150, $400 or $2,000), so growing a street is cheaper a bed than adding to it.
- **Growth:** a full house served for the next tier for 20 s grows in place, for free: a lot grows to II with a café, II to III with a café and a park, III to a tower with all three. More beds on the same ground (`Structure.grown`).
- **Decline:** a house that grew declines one tier after 30 s without what its tier needs, and the people beyond its beds move out until there's room. Houses bought at a tier never decline below it.
- **10x devs are particular:** they only move into lots served by a café and a park, and the beds row says so when that's what they're waiting for.
- **Labels:** each house says what it needs to grow next; each service says how many homes it serves.

**Prices follow the economy** (`game/build-cost.ts`). Each is the larger of a fixed floor and a live share:

- **Housing:** one lot per kind (1×1, 2 beds) for a quarter of the next hire's price per bed, at least $15. Bigger houses aren't for sale: lots grow into them.
- **Seaports:** 10 seconds of income per boat a minute they can turn round.
- **Services:** seconds of income (see above).
- **Offices:** four times the next hire's price for that kind (at least $150, $2,500 or $50,000).

**Projects: the company grows by building** (`game/projects.ts`, `world/projects/works.ts`, `world/play/projects-panel.tsx`). Milestones make a **project** available instead of unlocking things outright. You choose a site, and then:

1. **The crew walks there:** builders leave their desks and walk to the site in hard hats. They produce nothing while away.
2. **Trucks bring materials:** they keep two loads on hand, and each load is **paid when sent**. With no money for the next load, the site **stalls**, and an idle crew goes home after 6 s.
3. **The building goes up:** foundations, walls in scaffolding, then the roof. When it opens, its feature unlocks.

Other project rules:

- **Priority:** Paused, Low, Normal or High commits none, a quarter, half or all of the eligible employees, capped at 4 per footprint tile.
- **Price:** materials cost **seconds of income**, never less than a floor, fixed when the site is chosen (`projectCost`).
- **Time away:** it's caught up on load (`catchUpWorks`).
- **Earned already:** a company that already has what a project opens gets the building finished (`foundEarnedProjects`).
- **Clicking a finished building** with Look opens its tab.

| Project | Available at | Built by | Work (builder-s) | Materials | Site | Opens |
| --- | --- | --- | --- | --- | --- | --- |
| Founder's Garage | the start | the founder, who drives in | 30 | free | 2×1 | hiring interns |
| Vibe Coder Studio | 10 interns | interns | 600 | 45 s of income (≥ $400), 8 loads | 3×2 | hiring vibe coders |
| Company HQ | 10 vibe coders | interns + vibe coders | 2,400 | 60 s (≥ $5,000), 12 loads | 3×3 | managers |
| Boardroom Tower | employee management | interns + vibe coders | 4,000 | 90 s (≥ $20,000), 14 loads | 3×3 | board mandates |
| Campus | 20 vibe coders | interns + vibe coders | 6,000 | 2 min (≥ $40,000), 16 loads | 4×4 | hiring 10x devs |
| Town Hall | 6 interns | interns | 300 | 30 s (≥ $120), 6 loads | 3×2 | cafés, parks and gyms |
| Harbour Office | 5 vibe coders, on a map with a river | interns + vibe coders | 900 | 45 s (≥ $1,500), 8 loads | 2×2, within 3 tiles of the river | seaports |

The gates apply only while a map is mounted, through registered readers (`setHousingReader`, `setProjectReader`). Simulations, tests and the phone layout are never gated.

**The projects log** (`world/play/projects-panel.tsx`) is a quest log in the corner: In progress, Available and Up next (each with what it waits for). It folds to one line, and pulses with a "new" badge when a project becomes available that you haven't seen. Opening it marks them seen (`Session.seenProjects`, kept with the company, as is whether it's open). The slop pit's card sits beside it.

**Labels** (`world/play/building-labels.tsx`, `building-info.ts`) sit over every building:

- **What they say:**
  - houses: residents, earnings and arrivals;
  - sites: progress and stalls;
  - finished projects: what they opened;
  - seaports: boats alongside and waiting.
- **Crowding:** labels that would overlap **collate** into one that adds up what they said, so zooming out never hides information (`gatherLabels`, `collate`).

**Seaports and river traffic** (`structures/def.ts`, `boats/river.ts`, `boats/traffic.ts`):

- **Tiers:** three, at 2×2, 3×2 and 4×2, with 1, 2 and 3 berths and 20, 15 and 10 s calls. They go on river banks only.
- **Upgrades:** click a seaport with Build to upgrade it in place; you pay the difference.
- **Traffic:** boats come down a river only when it has a port. They queue first-come for a berth, dock, then leave at the map's far end.
- **Ports earn:** every completed call pays 0.5, 0.75 or 1 s of income by tier, never under $4, $8 or $16 (`portCallFee`). A "+$X" rises off the port, and its label shows earnings a minute. Nothing is earned while the map isn't running.

**The town's traffic** (`world/agents/town.ts`):

- **Trips:** cars and people make trips between doors and the map's edges, along cheapest routes.
- **Driving:** cars keep to the right-hand lane, follow at a gap, and yield at junctions by predicting where others will be.
- **People:** they walk the kerb with jointed, striding legs.

**Saves:** the run's map and the editor's map are kept apart (`world-run`, `world-map`). Selling the company forgets the run's map (`retireRunSave`).

## Tech stack

- **React 19** and **TypeScript** (Vite, SWC); **Tailwind CSS v4**
- **Zustand** for state, persisted to `localStorage`
- **PixiJS v8**, **@pixi/react** and **pixi-viewport** for the map; **WebGPU** compute for the water, with a CPU reference solver
- **break_infinity.js** for large numbers (`Decimal`)
- **Bun** as runtime and test runner; **Tauri** for a desktop build

## Getting started

```bash
bun install
bun run dev
```

| Command | What it does |
| --- | --- |
| `bun run dev` | Vite dev server with HMR |
| `bun run build` | Type-check, then a production build |
| `bun run typecheck` | `tsc -b`. A bare `tsc -p tsconfig.json` checks nothing here. |
| `bun test` | The test suite |
| `bun run lint` | ESLint |
| `bun run preview` | Preview the production build |
| `bun run tauri:dev` / `tauri:build` | Desktop app |
| `bun run bake:trees` / `bake:road-corners` | Regenerate derived tile sheets in `public/isometric_assets/derived/` |

## Project structure

```
src/
  App.tsx            # Root: founder gate, layout, game loop, offline check
  state/             # Zustand stores, one per system, persisted
  game/              # Pure game logic: catalogs, multipliers, satisfaction, achievements,
                     #   offline progress, skill tree, housing, build costs, projects
  molecules/  ui/    # Composite UI and primitives
  iso/               # Shared isometric maths and building-kit composition
  fluid/             # Water: column solver (columns.ts, slots.ts), falls, drips;
                     #   gpu/ is the same solver as WebGPU compute passes
  world/             # World v2: the company's map, and the ?world=1 editor
    grid.ts  iso.ts  #   Dense map layers; projection, half-step heights, picking
    gen/             #   Map generator: rivers planned first, land carved round a road
    roads/           #   Road masks, autotiling, network
    structures/      #   Definitions, placement, renderers (kit stacks, seaports, projects, lots)
    water/           #   The live water field, springs, pipes
    render/          #   Bands, terrain, water mesh (vertex shader), foam, falls
    agents/          #   Town traffic, routes, new hires arriving
    boats/           #   Boats, wakes, rivers, port traffic
    projects/        #   Project sites: crews, trucks, stalls, catch-up
    play/            #   The game's map UI: build bar, projects, labels, land picker
    edit/  io/       #   Tools, undo/redo, build cursor; map files and saves
    debug/           #   Editor chrome, fixtures, perf and GPU comparison harnesses
  simulation/        # Headless sims and reset helpers, used by tests
```

## Architecture

- **State:** a Zustand store per system, persisted. `Decimal`s are serialized by `decimalReplacer`/`decimalReviver`, and `coerceDecimal` re-hydrates odd shapes. Bumping the major or minor of `CURRENT_VERSION` (`state/version.store.ts`) wipes progress.
- **Game loop:** an interval in `App.tsx`. Per-second getters (`getMoneyPerSecond` and friends) mirror the tick's multiplier chains, so displayed rates match earnings.
- **The world reads, the economy listens:** `game/` imports nothing from `world/` at runtime. The map registers readers for beds and projects while it's mounted.
- **Grid:** dense typed arrays indexed `y*w+x`: terrain, height, paving, ramps, structures, decks, pipes. An edit marks cells dirty, and the renderer drains them, so an edit redraws only what changed.
- **Bands:** sprites live in one container per diagonal `x+y`, so nothing inside a band needs sorting. Tall things are split into per-column pieces filed in their own band.
- **Heights:** in **half steps** (16.5 px), because the art has exactly two rises. Height moves sprites vertically only, which keeps band order and picking cheap.
- **Roads:**
  - **Painted as areas**, then autotiled from 8-neighbour masks.
  - **Ramps are derived** from paving and height, not placed.
  - **Bridges are decks:** paved ground at a level of their own, the one place the map stops being a heightfield.
- **Structures:** a definition plus a render strategy:
  - kit sprite stacks for housing;
  - projected "prism" drawings for seaports, project sites and lots, each column filed in its own band.
- **Water:**
  - **A field of columns** stepped by a shallow-water style solver, with storeys (slots) so water can run under a bridge and over it at once.
  - **Two paths:** the CPU path is the reference, and the WebGPU path is the default.
  - **Comparison harnesses** keep the two paths in agreement: `?gpucheck`, `__waterCompare`, `__sheetCompare`, `__cliffCompare`.
  - **Rivers** are fed by off-map inflows held at a level, and the map's edge absorbs.
  - **Effects:** waterfalls, drips and foam are simulated.
  - **Drawing:** the mesh is built in a vertex shader.
- **Map generator:**
  - **River first:** it plans river courses before the land, then carves a cone of buildable ground around a wandering street.
  - **Water:** it fills basins by priority flood.
  - **Seed vs settings:** the seed picks *which* map, and the settings pick *what kind*.
- **Live state is not map state:** water depth, boats, traffic, arrivals and project crews live outside the grid. Saves keep what matters: pools, boats, and build and resident records.

## Dev tools

- **World editor:** `?world=1` has every terrain, road, water and structure tool, with undo/redo, fixtures and overlays.
- **URL flags:**
  - `?fixture=<name>` uses a test map for the session (`harbour`, `firstRoad`, `crossing`, …) and doesn't autosave;
  - `?nosave` skips saving;
  - `?cpuwater` pins the CPU water solver;
  - `?webgl` forces WebGL;
  - `?gpucheck` / `?gpuwhy` debug the device.
- **Window hooks in dev:**
  - `__world` (the store), `__town`, `__structures` and `__net` to inspect the live map;
  - `__waterBench(n, true)` to drive frames;
  - `__fakeHires = { intern: 9 }` to watch arrivals without touching the economy.
  - Use these rather than `import()` in the console, which loads a second copy of each module.
- **Perf gotcha:** a hidden tab or pane pauses `requestAnimationFrame`, so its frame numbers are meaningless.
- **Labeller** (`dev/roadlabel.html`): authors `building-kits.json`, `road-labels.json` and `slope-labels.json`. These are hand-authored data; never overwrite them programmatically.
- **Localhost-only:** dev affordances like "grant juice" are gated to localhost (`utils/dev-mode.ts`).

## Testing

`bun test` runs colocated `*.test.ts` files and headless progression sims in `src/simulation`. `simulate-map-run.ts` plays the core run with the town gating it (beds, arrivals, projects, commute), and `map-balance.test.ts` holds its pacing against the ungated run. Run it with `BALANCE=1` to print the milestones side by side. Type-check with `bun run typecheck` (`tsc -b`); the app tsconfig excludes tests, so they run through Bun. Design rationale lives in the code's doc comments, beside what it explains.

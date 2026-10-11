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
- **Slop pit:** fills with headcount once there are 50 vibe coders, and costs income above half full, up to 85% (`state/slop-pit.store.ts`). On the map it opens beside the studio as a 3×3 hole, and its sludge is real fluid standing in it as deep as it is full (`StructureDef.basin`, `events/sludge.ts` `syncPit`). A card shows the fill and the penalty, with a Drain button that costs 40 vibe coder morale.
- **AI singularity:** a meter that creeps up when vibe coders are miserable.
- **Founders:** six archetypes (Hacker, Bootstrapper, Visionary, Hustler, Agentic Delusionist, NEET). Each has a bonus that grows with every exit made as that founder. NEET starts with $5 and doubles money output per exit.
- **Offline progress:** the real tick is replayed over the time away (capped at 2 days), with a "welcome back" summary.
- **Acquisition (prestige):** sell the company for permanent **Equity**, start a fresh company, and spend Equity in a procedurally laid out skill tree of about 330 nodes.

### Founding

Founding is two steps: **who**, then **where** (`molecules/founder-select.tsx`, `world/play/map-setup.tsx`). "Choose your land" runs the real map generator live and previews it as a shaded diamond. It offers a seed, a size (48, 64 or 96 tiles), and sliders for hills, rivers, lakes and woods, with every generator setting behind "All settings". The map you found on is exactly the map you saw (`Session.mapChoice`).

### The company's map

Every company builds a town (`world/play/company-map.tsx`). Buildings need **road frontage** and cost money. **First-run hints** (`play/hints.ts`) explain it a tip at a time, with the thing they're about glowing (`data-hint`); they can be dismissed or switched off.

- **Build bar** (`build-bar.tsx`): beds per district; the tools (Look, Road, Lift, Build, Demolish, Wonders, Mood, Labels); and a picker with a row per hireable kind (Lot, Office), then Services and Ports once unlocked. No scrolling.
- **Undo** for 15 s after a build, road stroke or row of lots, money included (`undoLastBuild`). Refusals say why in a notice.
- **Labels** (`building-labels.tsx`) over every building: residents, earnings, mood, progress, boats. Overlapping labels **collate** into one rather than hide (`gatherLabels`).

**Housing is zoned, Caesar-style** (`world/agents/arrivals.ts`):

- **Lots:** one per kind (1×1, 2 beds), dragged along a street a row at a time (`lotLine`). Their beds count toward the hiring cap at once; nobody lives there yet (`Structure.residents`).
- **Hires travel in** from the map's edge and produce nothing until moved in (counted away in `attendance`). Interns share a bus (12 seats, waits up to 6 s, fills part-full houses first); vibe coders come by car, 10x devs by limousine. They walk from the road to their door.
- **They wait** for a free bed and a road from the edge; the beds row says why. Rides aren't saved: loading moves everyone in (`settleHousing`).
- **Remote beds:** 2 intern beds off-map to start; a company with staff before its map keeps them (`foundingRemoteBeds`). Max hiring stops at the free beds.

**Commuting** (`agents/commute.ts`): each kind works at the building that opened it or an **office** of its kind (bought from the picker). Up to 8 road tiles is free, then −1.25% a tile to 50%; no road at all is 25%. The average multiplies into output (`commuteFactor`).

**Services and growth** (`agents/services.ts`): a café, park and gym serve homes within 8 road tiles (4, 8, 16 s of income). A full house served for 20 s grows a tier for free (café → II, + park → III, + gym → tower), and declines after 30 s without. 10x devs only move in with a café and a park.

**Mood** (`agents/mood.ts`, `game/town-mood.ts`): each house's mood is its commute (to −30), services (+4/+6/+4, none −6), the slop pit nearby (−8 to −20), crowding (−6), a wonder (+5), sludge (−15) and flooding (−20), capped at ±40. It shifts each kind's satisfaction target; at −25 a house loses a resident a minute. The Mood tool tints houses.

**Map events** (`world/events/`, `play/event-cards.tsx`): a warning with a countdown, a ring on the map, and a card of choices. One at a time, each kind paced in play time (`PACING`); off with "no events" on a card or in Settings. In dev, `window.__eventNow = "convoy"` brings one forward.

- **Slop overflow** (`events/sludge.ts`): warned at 90%; at 100% what the vibe coders still at work produce (at least 2% of the pit a second) brims over the rim onto open ground until under 95%. **Mopping up** (`events/cleanup.ts`): 2 vibe coders a wet tile leave work (counted away), walk out and drain it by hand, then go back. Drain (−40 vibe coder morale), sludge trucks (20 s of income, three loads of 12%), or let it spill. Sludge dries up after.
- **River flood** (`events/flood.ts`): the river's inflow rises just over its lowest nearby bank for a minute. Buildings with water higher against them than before are flooded. Sandbags (30 s of income), evacuate (flooded homes away), or brace (−20 mood, ports shut). Leftover water soaks away.
- **Convoy** (with a port): calls pay double for a minute; extra hands (20 s) halve call time.
- **Investor tour** (garage, town hall or HQ): pays 30 s of income + 1.5 s a point of town mood (0–90 s); tidying (10 s) counts +10 mood.
- **Hackathon** (studio, 10 vibe coders): host it and they're away a minute, then +15 satisfaction.

**Prices follow the economy** (`game/build-cost.ts`), each the larger of a floor and a live share: lots a quarter of the next hire a bed (≥ $15); offices four hires; services seconds of income; seaports 10 s of income per boat a minute; road max($2, 0.25 s of income) a tile, lifting free.

**Projects** (`game/projects.ts`, `world/projects/works.ts`): milestones make a project available, **one at a time** (wonders included; the log and wonders menu show only the one under way, `projectUnderWay`); you pick a site, a crew walks there (away from their desks), trucks bring materials paid per load (no money stalls the site; an idle crew goes home after 6 s), and the building opens its feature. Priority commits none to all of the eligible crew; materials cost seconds of income fixed at siting; time away is caught up (`catchUpWorks`).

| Project | Available at | Built by | Work (builder-s) | Materials | Site | Opens |
| --- | --- | --- | --- | --- | --- | --- |
| Founder's Garage | the start | the founder | 30 | free | 2×1 | interns |
| Town Hall | 6 interns | interns | 300 | 30 s (≥ $120) | 3×2 | services |
| Vibe Coder Studio | 10 interns | interns | 600 | 45 s (≥ $400) | 3×2 | vibe coders |
| Harbour Office | 5 vibe coders, river maps | interns + vibe | 900 | 45 s (≥ $1,500) | 2×2, ≤ 3 tiles from a river | seaports |
| Company HQ | 10 vibe coders | interns + vibe | 2,400 | 60 s (≥ $5,000) | 3×3 | managers |
| Boardroom Tower | employee management | interns + vibe | 4,000 | 90 s (≥ $20,000) | 3×3 | board mandates |
| Campus | 20 vibe coders | interns + vibe | 6,000 | 2 min (≥ $40,000) | 4×4 | 10x devs |
| Data Centre ★ | 3 10x devs | vibe + 10x | 10,000 | 3 min (≥ $200k) | 3×3 | innovation ×2 |
| Conference Centre ★ | 8 10x devs | vibe + 10x | 14,000 | 4 min (≥ $500k) | 4×3 | valuation ×1.5 |
| IPO Tower ★ | 15 10x devs | vibe + 10x | 20,000 | 5 min (≥ $2M) | 3×3 | income ×1.5 |

★ Wonders have their own menu (`play/wonders-panel.tsx`). The **projects log** (`projects-panel.tsx`) is a foldable quest log that pulses when something new is available (`Session.seenProjects`). Gates apply only while a map is mounted, through registered readers (`setHousingReader`, `setProjectReader`); sims, tests and the phone layout are never gated.

**Seaports** (`boats/traffic.ts`): three tiers on river banks (1–3 berths, 20/15/10 s calls), upgraded in place for the difference. Boats queue for a berth; each call pays 0.5/0.75/1 s of income (`portCallFee`), credited offline at the last measured rate.

**Town traffic** (`agents/town.ts`): cars keep right, follow at a gap and yield at junctions; people walk the kerb.

**At a sale** (`projects/town-worth.ts`) the Equity offer gets +1% a grown tier, +2% a service, +5% a wonder, up to +50%. The run's map and the editor's are saved apart (`world-run`, `world-map`); selling forgets the run's.

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
- **Bands:** sprites live in one container per diagonal `x+y`, so nothing inside a band needs sorting. Bands are cached in render groups, so **Pixi's garbage collector is switched off** (`stopGarbageCollection`): it freed the buffers of chunks that had been off screen for a minute, and their cached draws then failed every frame once they came back. Tall things are split into per-column pieces filed in their own band.
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

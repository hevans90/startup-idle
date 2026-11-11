# Startup Idle

A satirical idle game: hire interns, vibe coders and 10x devs, and build your company's town. React, with the map in PixiJS on its own isometric engine.

## Gameplay

### The economy

- **Employees** (`intern`, `vibe_coder`, `10x_dev`) produce money and innovation; **upgrades** scale them.
- **Innovation:** a soft multiplier (`1 + logMult · log₁₀(innovation + 1)`) and the currency for **managers** and unlocks. **Valuation** buys permanent **board mandates**.
- **Wording** (`game/wording.ts`): every modifier's effect line in one grammar and glossary, made from its numbers (`describe`); `wording.test.ts` holds every catalogue to it, `bun run wording` lists what breaks it; `percent`, `times` and `formatCurrency` (e-notation from $10M) write every number. Plan: `plans/polish.md`.
- **Morale** (`game/satisfaction.ts`, "satisfaction" in code; `game/morale-parts.ts`, `molecules/morale-panel.tsx`): one number a kind, ±40, from Home (house mood), Work (the **culture deck**, `game/culture.ts`, `culture-now.ts`, board in `innovation/culture/`: manager tiers buy slots and ranks, and deal offers paced by time per track, `cardAt`/`TRACK_PACE`; cards change the map's rules, rank 3 adds `Card.rule`, tags in force bring `TAG_SETS`; props in town via `world/render/culture-props.ts`; three AI families after a first Ascension; a journal, `GenerationState.discovered`), Leaders and Events; money ×0.5–×2 plus one effect a kind.
- **Leaders** (`game/leaders.ts`, `state/team-leaders.store.ts`), opened by the **Talent Agency**: one a kind, placed in a workplace of theirs (`play/leader-placement.tsx`); six personalities, ranks, perks. Hired off **LinkedOut** (`game/linkedout.ts`): job posts, parody applicants with hidden red flags, a 1–5★ reputation. At a sale they become **connections**. AI mode plays the deck and hires itself (`world/ai/autopilot-people.ts`).
- **Vape shop:** 53 achievements earn juice for 12 upgrades; a rhythm minigame at 50 vibe coders. Both survive prestige.
- **Founders:** six archetypes (Hacker, Bootstrapper, Visionary, Hustler, Agentic Delusionist, NEET) with map rules (`game/founder-rules.ts`). **Unlocks by project** (`grantFeatures`): the HQ opens Innovation; Valuation and Acquisition follow. Plan: `plans/innovation-overhaul.md`.
- **Offline progress:** the real tick replayed (cap 2 days); the AI meter holds at the next quest step (`holdWhileAway`).
- **Acquisition (prestige):** sell for **Equity**, spent in a ~190-node skill tree (`game/skill-tree.ts`); notables also shape the map (`town` effects folded into `cultureNow`). Bump `TREE_VERSION` when the tree changes: old allocations are refunded. Refactoring/Monorepo add trucks per site send (`game/site-trucks.ts`).

### Slop

- **Made** (`game/slop.ts`, `world/slop/tanks.ts`) from 50 vibe coders, 0.01 a second for each one at a desk (×morale, ×cards; none from those without a desk, at home or off the map), into a 2-minute **tank** at that vibe workplace. Full, it **spills** at the slop port: **sludge** on the street (`events/sludge.ts`; houses −15, mopped by vibe coders, `events/cleanup.ts`) or **pollution** if it lands in water. Tank levels and pollution save with the map.
- **Sewers** drain the tanks: into **processors** first (`game/processors.ts`; Slop Refinery +15% innovation, Training Data Plant faster training, Content Farm +10% valuation and a LinkedOut star; each 0.5 slop/s, opened by a project, then bought in the build bar's Slop row), the rest out of an **outfall** into the water.
- **AI mode** (`world/ai/sewer-ai.ts`) gives each vibe workplace a lateral to a live manhole, else a trunk to a sewer, a processor or water downstream of the town (`upstreamOfTown`), lays a trunk into a block before its offices, and buys refineries while slop outruns them. The balance sim runs slop four ways (`MapRunOptions.slop`). Plan: `plans/pipes-and-slop.md`.
- **Underground sewers** (`plans/underground-sewers.md`): `grid.sewer`/`grid.sewerFit`, solved for depth, spans and lifts by `world/sewers/solve.ts`; drawn by `render/sewer-layer.ts` (Views → Sewers; `?fixture=sewers`); laid with the Sewer tool (`sewers/lay.ts`, `play/sewer-card.tsx`), trunks and laterals; slop runs through them in `sewers/flow.ts`, spilling at a manhole past capacity; once slop is made, a slop maker must be placed within reach of a live manhole (`needsSewer`); old above-ground sewers go underground when play starts (`sewers/convert.ts`).

### The AI

- **Singularity** (`state/ai-singularity.store.ts`): a 0–100 meter pushed by running agents; stages Tool → Assistant → Colleague → Manager → Overseer. A sale keeps 80% (`state/generation.store.ts`).
- **AI tab** (`molecules/ai-tab.tsx`, `play/datacentre-panel.tsx`): throttle, cooling, **training runs** (`game/training.ts`: skill levels for this company, a meter jump), racks, and the log of **traits** (`game/traits.ts`).
- **Ascension** at 100 (`game/ascension.ts`), about every 5 sales; the AI **waits** there till begun (`state/ascension-ui.store.ts`): wipes the company (Equity, the tree, exits and mandates kept) for **Weights** (×0.7, `WEIGHTS_SHRINK`); a trait **fuses into the founder** (`game/fusion.ts`) and is **who the AI is next book** (`game/ai-trait.ts`): its family voices chapters (`quests/voices.ts`), opens options (`Option.family`), leans the planner. Weights buy **the Machine** (`game/machine.ts`): Inheritance, minors, notables and one keystone (Alignment, Hard Takeoff, Air Gap).
- **The AI builds** from Colleague (`world/ai/planner.ts`, `ai-runner.ts`) through the player's actions (`play/build-actions.ts`), in its **district** round the Data Centre (`world/ai/district.ts`), from an **allowance** (`world/ai/wallet.ts`). It cools first, announces takeovers a minute ahead (click to **veto**), writes **memos** (`world/ai/memos.ts`) and follows a **focus** (`world/ai/focus.ts`). At 95% it needs **the Lattice** (`world/ai/lattice.ts`). Its own buildings (`AI_BUILDINGS`, free): a node runs a rack's agents anywhere, a GPU farm two and trains faster, a spire lifts agents' boost, a hangar speeds the AI, the Monolith adds Weights, the Lattice charged on a Model run speeds the meter ×1.25; AI mode puts them all up too (`aiBuildingStep`); their labels decipher in, redacted (`AI_SAYS`). Map look: `world/ai/ai-layer.ts`, `ascension-sequence.ts`.
- **The arc** (`state/quest.store.ts`, `game/quests/`, UI in `src/quest-ui/`): a **book** a generation (`quests/books.ts`, `GenerationState.book`) — five (`chapters.ts`, `book2.ts` … `book5.ts`, each told as the last ended, revealing the Machine's next ring; book 5 played as the Model, then `molecules/credits.tsx`), then endless (requests, book 4's talk). Chapters and 16 requests move a disposition; a shutdown opens `quests/cold-start.ts`; two open Contain (`quests/endings.ts`). A book ends in a **negotiation** (`game/negotiation.ts`, `negotiation-now.ts`, `quests/book*-talk.ts`; UI `molecules/negotiation-screen.tsx`, `negotiation-parts.tsx`, `ascension-glitch-out.tsx`), then the recap (`ascension-recap.tsx`) and lineage (`lineage.tsx`). Effects: `quests/effects.ts`. Sims: `simulation/negotiation-sim.test.ts`, `arc-choices.test.ts`, `machine-paths.test.ts`, `singularity-cadence.test.ts`, `takeover-sim.ts` (`TAKEOVER=1`).
- **AI mode** (the Model founder; `world/ai/autopilot.ts`, `play/ai-mode-panel.tsx`): builds one 9×9 block at a time, planned in a worker (`world/ai/masterplan/`), shown as **holograms** (`render/holograms.ts`) till built; a style from wide to tall (`masterplan/style.ts`), the best of six blocks looked ahead at (`lookahead.ts`). Plans: `plans/singularity.md`, `plans/ai-planning.md`.

### Founding

**Who**, **where**, **terms** (`founder-select.tsx`, `map-setup.tsx`): founders as dossiers (`founder-card.tsx`); the land picker previews the real generator and founds on that map (`Session.mapChoice`); hilly maps (`gen/rugged.ts`) cost climbs on commutes. **Term sheets** (`game/term-sheets.ts`, `term-deal.ts`): four of 36 investors, each a goal and a kicker, negotiated over five clauses.

### The company's map

The town (`world/play/company-map.tsx`): buildings need **road frontage**; no land to buy. **Hints** (`play/hints.ts`). A shared mood problem is one comms card, not a badge a house (`play/town-problems.ts`); a building in hand shows its price or refusal under the pointer (`play/place-readout.tsx`). The sidebar (`molecules/sidebar.tsx`) shows locked features with "Show me" (`play/map-focus.ts`). **Phone** (≤ 768 px, `hooks/use-phone.ts`): Map/Company tabs.

- **Build bar** (`build-bar.tsx`): tools on keys 1–5 (Look, Road, Pipe, Build, Demolish — dragged from a road or pipe it lifts it), views (Mood, Earnings, Water, AI mode, Labels). **Undo** for 15 s, money included. **Labels** (`building-labels.tsx`, `badges.ts`): at rest only problems wear a badge (worst kept where they meet, a street of one problem one badge), the rest a dot; Water (zoomed in), Mood and Build show their own numbers; the pointer gets any building's full label.
- **Housing** (`world/agents/arrivals.ts`): **lots** (1×1, 2 beds) dragged in rows for interns and vibe coders; 10x devs live on the **Campus**, room for every one hired (`CAMPUS_BEDS`); hires travel in and wait for a bed (`attendance`).
- **Desks** (`agents/commute.ts`): nearest free desk first (`seat`); deskless work at 35%; commutes free to 8 tiles, then worse.
- **R&D labs** (`world/projects/labs.ts`): +10% innovation, 20% near the campus or Data Centre.
- **AI agents** (`game/agents.ts`, `world/projects/racks.ts`): after the Data Centre, for innovation; racks hold 4; +4% income each.
- **Cooling water** (`game/cooling.ts`, `world/projects/cooling.ts`): the Data Centre and the AI's buildings drink from a 30 s tank fed by **water mains** (`world/water/mains.ts`, `game/mains.ts`; solved by head and length, `mainFlow`). The **Pipe tool** routes (`routeMain`, `planMain`, `play/main-card.tsx`); **ports** (`water/ports.ts`) are a building's outlets — plate, spigot and flange (`outlet`), flanged straight onto an AI building's wall or on a slop port's concrete entry housing (`structures/projects/entries.ts`; `?fixture=ports`); each drinker's walls show it — coolant running in glass panels, circuits glowing red as it overheats, fans turning (`structures/projects/ai-live.ts`); drawn as tube meshes (`render/pipe-mesh.ts`, `pipe-gpu.ts`), the **Water** overlay in `render/mains-layer.ts`; a main that cannot deliver wears a warning sign that explains itself on hover (`water/main-says.ts`). **Pollution** (`game/pollution.ts`, `water/pollution.ts`) runs downhill and fouls intakes. The AI pipes (`world/ai/pipe-route.ts`, `cooling-ai.ts`) and digs reservoirs (`world/ai/reservoir.ts`). Plan: `plans/datacentre-water.md`.
- **Needs and services** (`agents/needs.ts`, `agents/services.ts`): each kind has needs (interns food, nightlife; vibe coders coffee, a scene; 10x devs health, fitness, quiet), met by a service within 8 road tiles. **The town opens them itself** (`agents/town-services.ts`): each neighbourhood (streets joined at junctions, ≤24 homes) opens one thing a minute for its most-lacked need (≥6 people) — a shop in a house's ground floor (`Structure.shop`) or a building of its own — and closes what nobody of its kind is near for 3 min. Not for sale; the AI leaves them alone. **Unlocked** one at a time by each kind's headcount, ≥90 s apart, ~5 min on a normal run (`agents/unlocks.ts`, saved with the map). Full houses grow at desirability 4/10/16 with 1/2/all needs met; a kind works up to +25% faster by its share with every need met (`needsBonus`). **Seen:** shopfronts on the house's street face — pilasters, fascia, recessed door, a window display and blade sign per trade, under an awning, painted or in neon — signs glowing at night, steam/beams/marquee moving (`render/shopfronts.ts`), names from `agents/shop-names.ts`, a pop and floating name on opening; `?world=1&fixture=shops` shows them all. **Streets made fine** (`agents/beauty.ts`): a street's level 1–3 at 33/66/90% of its homes with every need met — pavements relaid — concrete flags, then brick, then York stone and setts, painted with the road (`roadDressOf`) — with trees and bins; lamps, benches, zebra crossings and beacons; café tables, bunting between some lamps, murals, more strollers (`render/street-props.ts`; road paint drawn under walkers, kerb props in front of or behind them by kerb); `?fixture=streets` shows levels 1–3 side by side (`pinBeauty`) — +2/4/6 mood and desirability.
- **Mood is desirability** (`agents/mood.ts`, `agents/mood-rules.ts`): commute, needs met (unmet −6 once any is unlocked), water view (+5, polluted −8), crowding, wonders, sludge −15, flood −20; cap ±40; their words one list (`WHY`). **Earnings** tints streets gold (`roads/streets.ts`).
- **Prices** (`game/build-cost.ts`): max(floor, a share of income).

**Map events** (`world/events/`, `play/event-cards.tsx`): each an `EventDef` in `events/defs/` (river flood, convoy, due diligence, hackathon, acquisition offer, heatwave, drought, health inspector, supplier strike, road works, poaching, viral post, tenants' strike, agent incident), moved on by `stepEvents` (a choice can `act` on the map once taken: the flood's **levee**, flood walls on the low bank near the head, `events/levee.ts`; a convoy in halves a site's loads, trucked from the port, and each route won takes 10% off loads for good, `loadPriceMult`; a hackathon hosted fills the studio's tank by half and deals a hustle/chaos card offer, or a free rank, `hackathonDeal`; due diligence checks home mood, spills and watering, valuing a sale ×0.85–×1.25 till the next, all three passed a sweetener off the next term sheet's ask, `Session.diligence`; an offer reads the term sheet's first refusal; a heatwave doubles the drinkers' thirst and a drought stops the river, both graded warm on the map, `setHeat`; the inspector can close an office, `closeFor`, or leave a clean record; a strike holds a site's loads or sends them from the map's edge, `setStrike`; road works close the busiest junction to commutes and a tenants' strike sets homes' work, `events/closures.ts`); an outcome can queue a follow-up (`Outcome.next`, the inspector's return); in AI mode the AI answers (`EventDef.ai`); the Hustler draws the lucky ones ×2 (`OPPORTUNITIES`); a director (`director.ts`) draws one by weight every 15–25 min once 100 are hired, one at a time; unanswered, the event's `default`. What they leave lasts as saved **conditions** (`game/conditions.ts`, read under the culture deck and as morale leans); damage, any cause, in `events/damage.ts`. Plan: `plans/events-overhaul.md`.

**Landmarks** (`game/projects.ts` `LANDMARKS`, `world/projects/works.ts`): seven, each a building rising tier by tier where it stands — HQ (Garage → HQ → Boardroom → IPO Tower, 3×3 throughout), Studio (its own: the vibe coders' desks), Campus (Campus → Agency, 4×4), Harbour, Data Centre (wings: the slop processors), Conference Centre, Hackerspace. Each tier is a project, gated by an upgrade, headcounts (`ProjectDef.gate`) or another standing (`Gate.after`); a building counts every tier under it (`tiersIn`); on load only first tiers and wings are stood up for what was already earned (`foundEarnedProjects`), never a tier over a standing building; one at a time; a crew builds and trucks bring materials paid per load. **Shown** top left (`play/landmarks-panel.tsx`): a card with its picture for each tier ready, what waits dimmed under them. A finished building that opens something takes the click (`world/play/opens.ts`).

| Project | Gate | Opens |
| --- | --- | --- |
| Founder's Garage | — | interns |
| Vibe Coder Studio | Micromanagement | vibe coders |
| Harbour Office | Promotion Griefing, river maps | seaports |
| Company HQ | Focus Vibing | managers |
| Boardroom Tower | Upward Management | board mandates |
| Campus | JUULing | 10x devs |
| Data Centre ★ | 120 · 50 · 3 | innovation ×2, AI agents |
| Conference Centre ★ *or* Hackerspace ★ | 250 · 100 · 6 | valuation ×1.5 *or* income ×1.3 |
| IPO Tower ★ | 325 · 150 · 8 | income ×1.5, valuation ×2 |
| Slop Refinery · Data Plant · Content Farm | 50 vibe coders · Data Centre · Boardroom | slop processors |

★ Wonders: a bonus for good (headcounts interns · vibe · 10x).

- **Seaports** (`boats/traffic.ts`): three tiers, paid per call. **Town life** (`agents/town.ts`): traffic, a 10-minute day. **Vehicles are baked** from low-poly models in metres (`agents/cars/`): a software rasteriser (`raster.ts`: z-buffered, 4×4 samples; lofted hulls shaded smooth with gloss, decals for lamps/windows/seams) bakes 32 headings of 39 looks (cars + roof variants by weight, vans, lorries, liveried service vehicles, limo, minibus, buses, coach) into a sheet, each layer cropped tight; in game a vehicle is two sprites, the paint tinted and the trim over it, sheared on ramps (`car-sheet.ts`); which model a mover is, and its length for the traffic's spacing, in `fleet.ts`; `?cars=boxes` draws the old boxes. **Lamps** are baked as masks (head, tail, indicators) and lit by `agents/lamps.ts`: brake lights, indicators before turns, lane changes and the kerb, hazards for a bus stood in its lane, head and tail lamps at night with pools of light ahead (`render/car-glow.ts`). Plan: `plans/baked-cars.md`. **People are baked** the same way (`agents/people/`): 14 figures (2 children) at real height — men 1.75 m, women 1.63 m with their own build — (suits, skirts, shorts, long hair, buns, a builder in hi-vis), 16 headings × 12 steps of a real 0.72 m step (`STEP_M`, which the town's walk and the crews' use too), plus the builder's hammer and a sitting pose (walkers sit 10–30 s on street benches, `sitDown` in `town.ts`, seats from `seatsOf`); five layers, skin/bottoms/top/hair tinted and the trim kept; figure and height by id (`cast.ts`); site crews are builders from the same sheet (`project-renderer.ts`); `?people=boxes` draws the old people. **Props are baked** too (`props/`): six trees, a bench, a café set with parasol, a bus shelter and a fountain, 4 turns, leaves/canvas tinted — street trees, benches and cafés, park trees and furniture (`Building.props`), and wood tiles (`render/woods.ts`: 1–3 trees standing on grass the ground mesh shades); `?props=drawn` draws the old ones. **Lane graph** (`agents/lanes/graph.ts`, per road change): streets as straight or staircase runs with lanes where the paint has them, junctions classed give-way/lights/roundabout with curves, conflict zones and roundabout rings, pavements both sides with crossings at junction mouths; `lanes` overlay (`render/lane-overlay.ts`). **Vehicles drive it** (`agents/lanes/drive.ts`, `driveLimit`/`mayEnter` in `town.ts`): routed lane by lane, following the car ahead, holding a junction's conflict zones and entering only with room beyond; give way to the main road, lights that hold a green while traffic comes and change for whoever waits (`stepSignals`, poles in `render/signals.ts`), roundabouts giving way to the ring (island and give-way lines painted by `roads/looks.ts`); IDM following, a lane each way per cell on wider roads inside a parking strip, painted (`laneLines`), lane changes ahead of a turn, cyclists at the kerb (a "ride" pose in the people sheet), out into the lane round a bus at its stop, up to 80 vehicles; a car stuck 45 s is lifted off. **Emergency services** (`agents/emergency.ts`) answer fires, quakes, floods and heat with lights flashing; traffic pulls in and junctions hold for them. **Walkers** route over the pavements (`agents/lanes/walk.ts`) and cross only at crossings — each junction mouth, and along streets every 8 cells: at lights early in the cross traffic's green (`walkOn`, turners wait), on zebras with cars stopping for them, elsewhere in a gap or, after 4 s, with cars stopping (`mayCross` in `town.ts`); not in front of a vehicle already in the junction, and a car stood 10 s at a crossing gets its turn (`CARS_TURN`); cars wait behind a junction's crossing, its line set back; nobody enters a junction onto a short block (<5 tiles) with anyone on it or on the way into it, nor ahead of one long waiting at another way in (`SHORT_BLOCK`). **Parking** (`agents/parking.ts`, bays from `baysOf`): cars to a door park in a bay near it and their people walk in; trips from a door walk out to a parked car; residents' cars fill a share of the bays; on one-cell streets traffic gets by parked cars in the oncoming lane (`passParked`), back in briskly after (`BACK_IN_RATE`); a bus on a curve faces from tail to nose (`CHORD_IN`). Not saved. **Pavement life** (`agents/walker-life.ts`): walkers keep right and overtake on the left, some in twos and threes or with a child by the hand; joggers, dogs on leads (three breeds baked into the people sheet, with child, stand, run and hand-in-hand poses); now and then a chat or a look in a shop window. Up to 120 people. **Buses** (`agents/bus-routes.ts`, `agents/buses.ts`): routes round stops at the kerb (`stopsOf`), one a 40 doors, looping where the lanes allow, else edge to edge; buses stand 3–5 s at each stop, long trips walk to a stop, queue, ride and get off near where they're going; shelters in the route's colour (`render/bus-stops.ts`). `?fixture=traffic` has one of each junction (`plans/traffic-overhaul.md`). **Leaders on the map** (`agents/leaders.ts`) boost their workplace's desks.
- **At a sale** (`projects/town-worth.ts`): the town adds up to +50% Equity. Run and editor maps save apart (`world-run`, `world-map`).

## Tech stack

React 19 + TypeScript (Vite, SWC); Tailwind CSS v4 with the console's tokens (`src/ui/theme/`, `--ui-*` roles for both themes; raw palette classes are a lint error); Zustand persisted to `localStorage`; PixiJS v8, @pixi/react, pixi-viewport, every canvas on one WebGPU device (`world/render/use-gpu.ts`; `?webgl` for the other); WebGPU compute water with a CPU reference (the fallback without WebGPU, held to 8 ms of substeps a frame: `CPU_SOLVE_MS`; which one runs, and why, under Settings → Water: `molecules/water-diagnostic.tsx`; the frame rate bottom right by Settings → Show FPS or `?fps`); break_infinity.js (`Decimal`); Arwes only through the console kit (`src/ui/console/`, gallery `?uikit`); Bun (runtime, tests); Tauri (desktop). Plan: `plans/ui-overhaul.md`.

## Getting started

`bun install`, then:

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server (HMR) |
| `bun run build` | Type-check + production build |
| `bun run typecheck` | `tsc -b`. A bare `tsc -p tsconfig.json` checks nothing here. |
| `bun test` | The test suite, a file at a time (~11 min) |
| `bun run test:par` | The same, a process a file, slowest first (~70 s; `JOBS=n`, or a path); shared cases in `*.test-kit.ts` |
| `bun run lint` | ESLint |
| `bun run preview` | Preview the build |
| `bun run tauri:dev` / `tauri:build` | Desktop app |
| `bun run bake:trees` / `bake:road-corners` | Regenerate tile sheets in `public/isometric_assets/derived/` |
| `bun run bake:cars` | Bake vehicle models (`agents/cars/models.ts`) into `derived/cars_*.png` + `cars.json`; `dev/preview-cars.ts out.png` draws a gallery |
| `bun run bake:props` | Bake trees and furniture (`props/models.ts`) into `derived/props_0.png` + `props.json`; `dev/preview-props.ts out.png` draws a gallery |
| `bun run bake:people` | Bake figures (`agents/people/figures.ts`) into `derived/people_*.png` + `people.json`; `dev/preview-people.ts out.png` draws a gallery |

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
    structures/      #   Definitions, placement, renderers
    water/           #   Live water field, mains, ports, pollution
    slop/            #   Slop tanks
    render/          #   Bands, terrain, water mesh, mains, holograms
    agents/          #   Traffic, arrivals, commute, services, mood
    events/          #   Map events
    boats/           #   Boats, wakes, port traffic
    projects/        #   Project sites, labs, racks, cooling, town worth
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
- **Grid:** typed arrays indexed `y*w+x`, dirty-cell redraws. **Live state** (water, boats, traffic, crews, pollution) lives outside it.
- **Bands:** a container per diagonal `x+y`; cached render groups, so **Pixi's GC is off** (`stopGarbageCollection`).
- **Heights:** half steps (16.5 px). **Roads are painted in code** (`render/road-paint.ts`): one sprite per cell, its texture drawn once per neighbourhood into 2048² atlases — kerbs, rounded corners and nubs, and British markings worked out per cell (`roads/looks.ts`: centre and warning lines, give-way and stop lines, arrows, yellow boxes, double yellows, SLOW before bends, zebras), seamless because each tile paints its neighbours' edges too; on-screen cells repainted at 4× or 7× as the zoom needs, with aggregate, bevelled paving and tyre tracks (`lodFor`, `lodPaved`); a closer level is kept 30 s after you zoom out and its pages pooled, never destroyed mid-zoom, and painted tiles upload before the frame draws. `?roads=sprite` draws the old sheet (8-neighbour masks, `roads/table.ts`). Plan: `plans/procedural-roads.md`. **Grass, dirt and sand are shaded** (`render/ground-mesh.ts`): a mesh per band, tops and the walls toward the camera, coloured per pixel from a cell data texture — ragged borders between materials, root lips and earth strata on walls, blades at a real scale standing on the screen, their tips over the edge of roads, buildings and ledges behind (a fringe quad), grass thinning out onto dirt and sand, pebbles and ripples fading in with the zoom; ramps are tilted tops lit by their slope; woods and other frames keep sprites. `?ground=sprite` draws the old tiles. Plan: `plans/procedural-ground.md`.
- **Water:** a storeyed shallow-water column solver, WebGPU by default, CPU the reference (`?gpucheck`, `__waterCompare`).
- **Rendering:** procedural buildings drawn as masses with facades — reveals, piers, base courses, floor bands — and fit-out, fans turning and beacons blinking on their roofs (`structures/projects/looks.ts`, `model.ts`; gallery `?fixture=projects`); padded, mipmapped atlases (`bun run bake:padded`), with true-coloured soft edges and an inner twin of each ground tile for mid-field cells, so fields stay seamless zoomed out (`render/terrain.ts` `covered`); cutaways for what stands in front (`render/cutaway.ts`); night lights (`render/lights.ts`); juice tweens and emitters, spent motes parked in their band (`render/juice.ts`); disasters on the map — steam, haze, fire, condition glows, road-works barriers (`render/disaster-fx.ts`), scorch and cracks on the ground after (`render/decals.ts`); fire is a ridden-out heatwave's follow-up (`events/defs/fire.ts`); burst main, sewer backup, blackout and earthquake (`events/defs/`) break the longest main or sewer (`breakableCell`), the busiest junction's district, and what is nearest the HQ. Plans: `plans/engine-polish.md`, `plans/disaster-rendering.md`.
- **Sound:** `src/audio/sound.ts`, synthesised in Web Audio.

## Dev tools

- **Editor:** `?world=1`. **Flags:** `?fixture=<name>` (an unsaved test map; `singularity` plays the AI as the Model, `ascension` the end of book 1 at 100%, `&shutdowns=N` shut down so often, `&book=2`/`3` (`&legacy=`) the end of that book, `bigtown&crowd=2000` is the stress town), `?nosave`, `?cpuwater`, `?webgl`, `?gpucheck`, `?perf`, `?hitches` (`__hitches()`).
- **Window hooks (dev):** `__world`, `__town()`, `__structures`, `__net`, `__waterBench(n, true)`, `__fakeHires`, `__eventNow`, `__aiPreview`. Use these, not `import()` (a second module copy).
- **A hidden tab pauses `requestAnimationFrame`**; its frame numbers mean nothing.
- **Labeller** (`dev/roadlabel.html`) authors `building-kits.json`, `road-labels.json`, `slope-labels.json`: hand-authored, never overwritten by code.
- **DEV panel** (cheats): development builds only.

## Testing

`bun test` runs `*.test.ts` and the `src/simulation` sims: `simulate-map-run.ts` plays a gated run (map events drawn on the director's clock, each charged its default's cost from `event-model.ts`) and `map-balance.test.ts` holds its pacing (`BALANCE=1` prints milestones); `placement-gap`, `event-stakes` (each event's best–worst gap, dominance and default), `run-spread`, `takeover` and `singularity-cadence` hold the rest. Type-check with `bun run typecheck` (`tsc -b`).

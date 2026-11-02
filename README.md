# Startup Idle

A satirical idle game: hire interns, vibe coders and 10x devs, and build your company's town. React, with the map in PixiJS on its own isometric engine.

## Gameplay

### The economy

- **Employees** (`intern`, `vibe_coder`, `10x_dev`) produce money and innovation; **upgrades** scale them.
- **Innovation:** a soft multiplier (`1 + logMult · log₁₀(innovation + 1)`) and the currency for **managers** and unlocks. **Valuation** buys permanent **board mandates**.
- **Wording** (`game/wording.ts`): every modifier's effect line in one grammar and glossary, made from its numbers (`describe`); `wording.test.ts` holds every catalogue to it, `bun run wording` lists what breaks it; `percent`, `times` and `formatCurrency` (e-notation from $10M) write every number. Plan: `plans/polish.md`.
- **Morale** (`game/satisfaction.ts`, "satisfaction" in code; `game/morale-parts.ts`, `molecules/morale-panel.tsx`): one number a kind, ±40, from Home (house mood), Work (the **culture deck**, `game/culture.ts`, `molecules/innovation/culture-deck-panel.tsx` and a full-screen board, `innovation/culture/`, cards dragged or tapped into slots: manager tiers are points for slots or card ranks; each track deals 1-of-3 card offers), Leaders and Events; money ×0.5–×2 plus one effect a kind (interns: innovation; vibe coders: slop; 10x devs: cost curve).
- **Leaders** (`game/leaders.ts`, `state/team-leaders.store.ts`), opened by the **Talent Agency**: one a kind, placed in a workplace of theirs (`play/leader-placement.tsx`); six personalities, ranks, perks. Hired off **LinkedOut** (`game/linkedout.ts`): job posts, parody applicants with hidden red flags, a 1–5★ reputation. At a sale they become **connections**. AI mode plays the deck and hires itself (`world/ai/autopilot-people.ts`).
- **Vape shop:** 53 achievements earn juice for 12 upgrades; a rhythm minigame at 50 vibe coders. Both survive prestige.
- **Founders:** six archetypes (Hacker, Bootstrapper, Visionary, Hustler, Agentic Delusionist, NEET) with map rules (`game/founder-rules.ts`). **Unlocks by project** (`grantFeatures`): the HQ opens Innovation; Valuation and Acquisition follow. Plan: `plans/innovation-overhaul.md`.
- **Offline progress:** the real tick replayed (cap 2 days); the AI meter holds at the next quest step (`holdWhileAway`).
- **Acquisition (prestige):** sell for **Equity**, spent in a ~330-node skill tree.

### Slop

- **Made** (`game/slop.ts`, `world/slop/tanks.ts`) from 50 vibe coders, 0.01 a coder a second (×morale, ×cards), into a 2-minute **tank** at each vibe workplace by desks taken. Full, it **spills** at the slop port: **sludge** on the street (`events/sludge.ts`; houses −15, mopped by vibe coders, `events/cleanup.ts`) or **pollution** if it lands in water. Tank levels and pollution save with the map.
- **Sewers** (`MAIN_SEWER`, the Pipe tool's Sewer mode) drain the tanks: into **processors** first (`game/processors.ts`; Slop Refinery +15% innovation, Training Data Plant faster training, Content Farm +10% valuation and a LinkedOut star; each 0.5 slop/s, opened by a project, then bought in the build bar's Slop row), the rest out of an **outfall** into the water.
- **AI mode** (`world/ai/sewer-ai.ts`) sewers each workplace to a processor, a sewer or water downstream of the town (`upstreamOfTown`), and buys refineries while slop outruns them. The balance sim runs slop four ways (`MapRunOptions.slop`). Plan: `plans/pipes-and-slop.md`.

### The AI

- **Singularity** (`state/ai-singularity.store.ts`): a 0–100 meter pushed by running agents; stages Tool → Assistant → Colleague → Manager → Overseer. A sale keeps 80% (`state/generation.store.ts`).
- **AI tab** (`molecules/ai-tab.tsx`, `play/datacentre-panel.tsx`): throttle, cooling, **training runs** (`game/training.ts`: skill levels for this company, a meter jump), racks, and the log of **traits** (`game/traits.ts`).
- **Ascension** at 100 (`game/ascension.ts`): wipes the company (Equity kept) for **Weights**; a trait **fuses into the founder** (`game/fusion.ts`). Weights buy **the Machine** (`game/machine.ts`): the skill tree's AI constellation — Inheritance, notables (Autonomous Freight, Drone Airlift, Prefab Printing, Generative Zoning, Coolant Loop, Holo-Concierge, Night Shift, Market Maker, Self-Funding) and one keystone (Alignment, Hard Takeoff, Air Gap).
- **The AI builds** from Colleague (`world/ai/planner.ts`, `ai-runner.ts`) through the player's actions (`play/build-actions.ts`), in its **district** round the Data Centre (`world/ai/district.ts`), from an **allowance** (`world/ai/wallet.ts`). It cools first, announces takeovers a minute ahead (click to **veto**), writes **memos** (`world/ai/memos.ts`) and follows a **focus** (`world/ai/focus.ts`). At 95% it needs **the Lattice** (`world/ai/lattice.ts`). Map look: `world/ai/ai-layer.ts`, `ascension-sequence.ts`.
- **The arc** (`state/quest.store.ts`, `game/quests/`, UI in `src/quest-ui/`): four chapters, 16 requests and a finale with four endings (Merge, Steward, Release, Contain), moving a disposition; effects in `game/quests/effects.ts`. Balanced by `simulation/takeover-sim.ts` (`TAKEOVER=1`), `arc-choices.test.ts`, `machine-paths.test.ts`.
- **AI mode** (the Model founder; `world/ai/autopilot.ts`, `play/ai-mode-panel.tsx`): builds one 9×9 block at a time, planned in a worker (`world/ai/masterplan/`), shown as **holograms** (`render/holograms.ts`) till built; a style from wide to tall (`masterplan/style.ts`), the best of six blocks looked ahead at (`lookahead.ts`). Plans: `plans/singularity.md`, `plans/ai-planning.md`.

### Founding

**Who**, **where**, **terms** (`founder-select.tsx`, `map-setup.tsx`): founders as dossiers (`founder-card.tsx`); the land picker previews the real generator and founds on that map (`Session.mapChoice`); hilly maps (`gen/rugged.ts`) cost climbs on commutes. **Term sheets** (`game/term-sheets.ts`, `term-deal.ts`): four of 36 investors, each a goal and a kicker, negotiated over five clauses.

### The company's map

The town (`world/play/company-map.tsx`): buildings need **road frontage**; no land to buy. **Hints** (`play/hints.ts`). A shared mood problem is one comms card, not a badge a house (`play/town-problems.ts`); a building in hand shows its price or refusal under the pointer (`play/place-readout.tsx`). The sidebar (`molecules/sidebar.tsx`) shows locked features with "Show me" (`play/map-focus.ts`). **Phone** (≤ 768 px, `hooks/use-phone.ts`): Map/Company tabs.

- **Build bar** (`build-bar.tsx`): tools on keys 1–6 (Look, Road, Lift, Pipe, Build, Demolish), views (Wonders, Mood, Earnings, Water, AI mode, Labels). **Undo** for 15 s, money included. **Labels** (`building-labels.tsx`, `badges.ts`): at rest only problems wear a badge (worst kept where they meet, a street of one problem one badge), the rest a dot; Water (zoomed in), Mood and Build show their own numbers; the pointer gets any building's full label.
- **Housing** (`world/agents/arrivals.ts`): **lots** (1×1, 2 beds) dragged in rows for interns and vibe coders; 10x devs live on the **Campus**, room for every one hired (`CAMPUS_BEDS`); hires travel in and wait for a bed (`attendance`).
- **Desks** (`agents/commute.ts`): nearest free desk first (`seat`); deskless work at 35%; commutes free to 8 tiles, then worse.
- **R&D labs** (`world/projects/labs.ts`): +10% innovation, 20% near the campus or Data Centre.
- **AI agents** (`game/agents.ts`, `world/projects/racks.ts`): after the Data Centre, for innovation; racks hold 4; +4% income each.
- **Cooling water** (`game/cooling.ts`, `world/projects/cooling.ts`): the Data Centre and the AI's buildings drink from a 30 s tank, fed by **water mains** (`world/water/mains.ts`, `game/mains.ts`): layers `main` and `mainEnd` (intake, pump, outlet, cap, outfall, drain), each network solved by head and length (`mainFlow`). The **Pipe tool** routes (`routeMain`, `planMain`) with a live card (`play/main-card.tsx`) and a one-click pump; Look a main to Widen or Lift it. **Ports** (`water/ports.ts`): water and slop go in and out only at a building's nozzles. Mains are drawn as lit tube meshes, one per band, in three tiers of detail by zoom (`render/pipe-mesh.ts`, `pipe-gpu.ts`); the **Water** overlay (`render/mains-layer.ts`) shows every main by state. **Pollution** (`game/pollution.ts`, `water/pollution.ts`): carried down the water's slope beside the solvers, browning the shaders; a fouled intake cools less, and houses by it lose their water view. The AI pipes (`world/ai/pipe-route.ts`, `cooling-ai.ts`) and digs **reservoirs** (`world/ai/reservoir.ts`). Plan: `plans/datacentre-water.md`.
- **Services and growth** (`agents/services.ts`): café, park, gym within 8 road tiles (a park goes anywhere; off the roads it serves homes 8 tiles round it); full houses grow at desirability 4/10/16.
- **Mood is desirability** (`agents/mood.ts`, `agents/mood-rules.ts`): commute, services, water view (+5, polluted −8), crowding, wonders, sludge −15, flood −20; cap ±40; their words one list (`WHY`). **Earnings** tints streets gold (`roads/streets.ts`).
- **Prices** (`game/build-cost.ts`): max(floor, a share of income).

**Map events** (`world/events/`, `play/event-cards.tsx`): one at a time, a choice card each — river flood (sandbags, evacuate, brace; flood walls), convoy (then a regular route), investor tour, hackathon, the agents' decision, an acquisition offer (+25% Equity, `OFFER_PREMIUM`).

**Projects** (`game/projects.ts`, `world/projects/works.ts`): gated by an upgrade, wonders by headcounts (`ProjectDef.gate`) or another project standing (`Gate.after`); one at a time; a crew builds and trucks bring materials paid per load. A finished building that opens something takes the click (`world/play/opens.ts`).

| Project | Gate | Opens |
| --- | --- | --- |
| Founder's Garage | — | interns |
| Town Hall | Mandatory Weekend Work | services |
| Vibe Coder Studio | Micromanagement | vibe coders |
| Harbour Office | Promotion Griefing, river maps | seaports |
| Company HQ | Focus Vibing | managers |
| Boardroom Tower | Upward Management | board mandates |
| Campus | JUULing | 10x devs |
| Data Centre ★ | 120 · 50 · 3 | innovation ×2, AI agents |
| Conference Centre ★ *or* Hackerspace ★ | 250 · 100 · 6 | valuation ×1.5 *or* income ×1.3 |
| IPO Tower ★ | 325 · 150 · 8 | income ×1.5, valuation ×2 |
| Slop Refinery · Data Plant · Content Farm | 50 vibe coders · Data Centre · Boardroom | slop processors |

★ Wonders (`play/wonders-panel.tsx`; headcounts interns · vibe · 10x).

- **Seaports** (`boats/traffic.ts`): three tiers, paid per call. **Town life** (`agents/town.ts`): traffic, a 10-minute day. **Leaders on the map** (`agents/leaders.ts`) boost their workplace's desks.
- **At a sale** (`projects/town-worth.ts`): the town adds up to +50% Equity. Run and editor maps save apart (`world-run`, `world-map`).

## Tech stack

React 19 + TypeScript (Vite, SWC); Tailwind CSS v4 with the console's tokens (`src/ui/theme/`, `--ui-*` roles for both themes; raw palette classes are a lint error); Zustand persisted to `localStorage`; PixiJS v8, @pixi/react, pixi-viewport; WebGPU compute water with a CPU reference; break_infinity.js (`Decimal`); Arwes only through the console kit (`src/ui/console/`, gallery `?uikit`); Bun (runtime, tests); Tauri (desktop). Plan: `plans/ui-overhaul.md`.

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
- **Heights:** half steps (16.5 px); roads autotile from 8-neighbour masks.
- **Water:** a storeyed shallow-water column solver, WebGPU by default, CPU the reference (`?gpucheck`, `__waterCompare`).
- **Rendering:** padded, mipmapped atlases (`bun run bake:padded`); cutaways for what stands in front (`render/cutaway.ts`); night lights (`render/lights.ts`); juice tweens (`render/juice.ts`). Plan: `plans/engine-polish.md`.
- **Sound:** `src/audio/sound.ts`, synthesised in Web Audio.

## Dev tools

- **Editor:** `?world=1`. **Flags:** `?fixture=<name>` (an unsaved test map; `singularity` plays the AI as the Model, `bigtown&crowd=2000` is the stress town), `?nosave`, `?cpuwater`, `?webgl`, `?gpucheck`, `?perf`, `?hitches` (`__hitches()`).
- **Window hooks (dev):** `__world`, `__town()`, `__structures`, `__net`, `__waterBench(n, true)`, `__fakeHires`, `__eventNow`, `__aiPreview`. Use these, not `import()` (a second module copy).
- **A hidden tab pauses `requestAnimationFrame`**; its frame numbers mean nothing.
- **Labeller** (`dev/roadlabel.html`) authors `building-kits.json`, `road-labels.json`, `slope-labels.json`: hand-authored, never overwritten by code.
- **DEV panel** (cheats): development builds only.

## Testing

`bun test` runs `*.test.ts` and the `src/simulation` sims: `simulate-map-run.ts` plays a gated run and `map-balance.test.ts` holds its pacing (`BALANCE=1` prints milestones); `placement-gap`, `dominant-choices`, `run-spread`, `takeover` and `singularity-cadence` hold the rest. Type-check with `bun run typecheck` (`tsc -b`).

# Startup Idle

A satirical incremental/idle game about scaling a tech startup by any means necessary — hire interns, unleash vibe coders, anoint 10x devs, and watch an isometric city grow as your headcount does. Built as a single-page React app with a PixiJS-rendered city.

## Gameplay

You found a startup as one of several **founder archetypes**, each bending a different progression curve, then grow the company through interlocking systems:

- **Employees (generators)** — three roles (`intern`, `vibe_coder`, `10x_dev`) that produce money and innovation each tick. Hire more and buy **upgrades** to scale output.
- **Innovation** — a soft global multiplier (`1 + logMult · log₁₀(innovation+1)`) on all output, plus the currency for **managers** and unlocks.
- **Managers** — auto-tiering multipliers for money / innovation / valuation; assign them and they progress on their own.
- **Valuation & board mandates** — valuation accrues from revenue; spend it on permanent global mandates.
- **Employee management & satisfaction** — perks (money/innovation/cost/auto-buy) and a morale system that drifts each tick and feeds back into output.
- **Team leaders** — one named employee per role (`intern`, `vibe_coder`, `10x_dev`). Hire from a pool of 3 candidates, each with a random **trait** (e.g. `overachiever`, `chaos_agent`, `brown_noser`) that sets their output/morale bias and unlocks a 4-skill pool. Employees accumulate `outputStat` and `moraleStat` over time, gaining **ranks** that award skill points to spend on up to 3 skills (max level 3 each) — revenue multipliers, IPS boosts, satisfaction offsets, rank-compounding effects, and more. Skills have cross-role effects: `chaos_spark` debuffs *other* roles' satisfaction; `team_morale` buffs *all* roles. Certain trait pairings unlock **pair synergies** (e.g. `productive_chaos`, `dumpster_fire`) with additional output-growth or satisfaction penalties. Firing an employee costs innovation per rank and leaves a permanent **legacy bonus** (rev + IPS) for that role.
- **Vape shop** — 53 achievements across all game systems earn *vape juice*; spend it on 12 impactful upgrades (money output, innovation, valuation rate, hire cost reduction, equity payout) that visibly modify a high-def SVG vape rendered as a compact overlay on the map canvas (bottom-left). Achievements and upgrades persist through prestige resets. Version `0.2.0` bumped the upgrade roster; returning players' vape progress resets on load.
- **Slop pit** — a toxic sludge pool (`state/slop-pit.store.ts`) that unlocks at 50 vibe coders and slowly fills based on headcount. Occupies a reserved 5×5 plot in the vibe_coder district (world-gen skips building placement there). Above 50% fill it applies an income penalty (up to −85% at 100%). Draining costs −40 vibe_coder satisfaction. Renders in the isometric city with a fixed 5×5 pit footprint (camera-facing walls, dark floor), sludge that rises vertically from the pit bottom to ground level as fill increases, and a real-time height-field wave simulation (`office/slop-pit-fluid.ts`) that propagates ripple rings across the 5×5 surface grid. Drips from animated pipe fittings land on the sludge and inject splash impulses into the wave field; bubble rings float at the live sludge surface level. A DRAIN button empties the pit.
- **AI singularity** — an ominous meter that creeps up when vibe coders are miserable.
- **Founders** — six archetypes (Hacker, Bootstrapper, Visionary, Hustler, Agentic Delusionist, NEET) each with a unique *per-founder scaling modifier* that grows stronger with every acquisition made as that specific founder (tracked in `state/exits.store.ts`, persisted). Dynamic perk text shows current bonus levels. NEET starts with $5 and no base bonuses but doubles all money output with every exit (×2^n). Chosen on a full-screen select before the game begins; cards show the exit count badge and a scaling-modifier description.
- **Offline progression** — on return, the real game tick is replayed in chunks over the time away (full credit, capped at 2 days), with a "while you were away" popup.
- **Company Acquisition (prestige)** — once you've built enough *total accrued valuation*, accept an acquisition offer to bank permanent **Equity** (diminishing-returns payout), soft-reset into a fresh company (re-picking a founder; Equity, skill tree and board mandates persist), and spend Equity in a Path-of-Exile-style **skill tree** (~330 procedurally-laid-out nodes across themed clusters with standalone keystones, rendered on its own PixiJS viewport — verified overlap-free, light/dark themed). Costs escalate per node allocated; hovering previews the cheapest route (with total cost) and a click allocates the whole route at once; the tree is **respeccable** (Exits buy persistent respec points; one click refunds a node and its dependents). Includes fuzzy node **search** and hover-to-spotlight from the allocated-bonuses panel. The full loop — accrual tracking, payout, soft reset, allocation, respec, persistence — is in, and node **effects are wired to the economy**: every allocated grant resolves (`resolvePrestigeModifiers`) into multipliers applied at the same chokepoints as the founder modifiers (money, innovation, valuation, employee output, headcount synergy, automation, manager speed, hire cost, singularity, satisfaction-gain rate, Equity payout). **All keystones are fully implemented**, including their structural reshapes — Bootstrapped disables managers & auto-buy, Crunch Mode switches satisfaction off, Enshittify halves positive satisfaction bonuses, AGI-Pilled cripples interns, Permanent Acqui-hire grants free starting intern levels — each surfaced in the relevant UI (see `docs/acquisition-skill-tree-design.md`).
- **Isometric city** — a PixiJS + pixi-viewport scene that visualizes each district's headcount as growing building stacks, with hover highlighting and HTML info popovers.

## Tech stack

- **React 19** + **TypeScript** (Vite, SWC)
- **Tailwind CSS v4**
- **Zustand** for state (with `persist` to `localStorage`)
- **@pixi/react v8** + **PixiJS v8** + **pixi-viewport** for the isometric city
- **break_infinity.js** for large-number math (`Decimal`)
- **Bun** as the runtime / test runner

## Getting started

```bash
bun install
bun run dev        # Vite dev server (HMR)
```

Then open the printed local URL.

### Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Vite dev server with HMR |
| `bun run build` | Type-check (`tsc -b`) then production build |
| `bun run typecheck` | `tsc -b` (the solution build — a bare `tsc --noEmit` is a no-op here) |
| `bun test` | Run the test suite |
| `bun run lint` | ESLint |
| `bun run preview` | Preview the production build |

## Project structure

```
src/
  App.tsx              # Root: founder gate, layout, game loop, offline check
  main.tsx             # Entry point
  state/               # Zustand stores (one per system), all persisted
  game/                # Pure game logic: catalogs, economy multipliers,
                       #   satisfaction, achievements, offline-progress, skill-tree
  molecules/skill-tree/# PixiJS prestige skill-tree renderer + overlay
  molecules/           # Composite UI (toolbar, sidebar, popovers, counters…)
  ui/                  # Reusable primitives (Button, Popover, ResourceCounter…)
  iso/                 # SHARED isometric helpers (no game state, no world model)
    projection.ts      #   iso projection + depth-sort keys (+ closed-form twins)
    kits.ts            #   building-kit composition (composeBuilding)
    types.ts           #   SpriteId, Cell, Rect
    dir.ts             #   N/E/S/W bits + neighbour offsets
    atlas/             #   Starling XML → Pixi textures
  office/              # Isometric PixiJS city renderer (v1)
    office.tsx         #   render tree (ground/road/building layers)
    viewport.tsx       #   pixi-viewport (pan/zoom)
    math-utils.ts      #   v1-only iso helpers; re-exports src/iso/projection
    city/              #   scene computation, building kits data, world gen
  world/               # World v2 — MUTABLE isometric map engine (?world=1)
    iso.ts             #   projection, half-step heights, tilted-face picking
    grid.ts            #   dense layers (terrain/height/paved/ramp/structureAt)
    ramp-art.ts        #   reads slope-labels.json → which frame is which ramp
    roads/             #   8-bit masks, derived autotile table, union-find graph
    structures/        #   definitions, placement rules, renderer registry
    render/            #   bands, terrain, columns, paved overlay, camera, overlays
    edit/              #   brush + height tools, undo/redo, RTS build cursor
    io/serialize.ts    #   .json map format (base64 layers + palette)
    anchors/           #   HTML-follows-cell anchoring for popovers
    debug/             #   editor chrome: tile browser, minimap, fixtures
  simulation/          # Headless sims + reset helpers (used by tests)
  debug/               # Debug harnesses (map-harness.tsx, top-down-map.tsx)
                       #   loaded dynamically via ?debug=map URL param
  hooks/  utils/  icons/  assets/
```

## Architecture notes

- **State & persistence.** Each system is a Zustand store under `src/state`, persisted to `localStorage` via the `persist` middleware. Large numbers are `break_infinity.js` `Decimal`s serialized via `decimalReplacer`/`decimalReviver` (see `state/_break_infinity.decimals.ts`); store `merge` functions use `coerceDecimal` to defensively re-hydrate any legacy/foreign shape so a malformed save can't crash on first render.
- **Version wipe.** `state/version.store.ts` holds `CURRENT_VERSION`; bumping the major or minor triggers a full progress wipe (storage + in-memory) on next load via `useCompareVersion`. Use this for breaking changes.
- **The game loop** runs in `App.tsx` (a `setInterval`), ticking generators and managers. Stores expose per-second getters (`getMoneyPerSecond`, `getInnovationPerSecond`, `getValuationPerSecond`) that mirror the tick's multiplier chains, so displayed rates match actual earnings.
- **Isometric renderer.** Buildings are derived deterministically from headcount (`office/city/compute-city.ts`) and drawn into depth-sorted Pixi containers (`cityDepthKey`, column-dominant). Heights are monotonic in count to avoid "floor stealing."
- **World v2** (`src/world`, route `?world=1`) is a separate, mutable map engine that shares only the pure iso maths in `src/iso`; v1 under `src/office` is untouched. Terrain lives in dense typed arrays indexed `y*w+x` rather than keyed sets, so an edit updates one sprite per changed cell instead of rebuilding the map. Sprites are grouped into **diagonal bands** (one container per `x+y`): within a band sprites are a full tile apart at identical Y and cannot overlap, so nothing inside a band ever needs sorting. Elevation is in **half steps** (`HEIGHT_UNIT = 16.5`) and moves `wy` only — never `wx` — which is why band order and picking both stay cheap under verticality. Undo/redo is cell-index patches (`edit/commands.ts`), one command per drag stroke.
- **Verticality.** `height` is signed and measured in HALF steps (16.5px), because the tileset has exactly two rises — ×0.5 and ×1 — and nothing between; a full step is one slab skirt, so the field stays integral. Height moves `wy` only, never `wx`, which is why elevation costs the renderer nothing. A cell taller than its visible neighbours grows a **column**: copies of its own tile stacked at `HEIGHT_STEP`, each one's top hidden by the copy above, so only the skirts show — the tileset's skirt already shades its two faces differently, so nothing is tinted by hand. Columns live in their own per-band tier beneath the tiles, the one place ordering within a band matters.
- **Picking under elevation.** A screen point is ambiguous once the ground is not flat, but only along ONE diagonal, because `wx` fixes `x − y` whatever the height. `pickCell` marches that diagonal front to back and takes the first cell whose top face contains the point; there is exactly one candidate per band, since `x − y` must be an integer within 1 of the point's own and the two options have opposite parity. `faceCoords` solves the face exactly, so a **ramp's tilted parallelogram** works the same as a flat diamond. Tested against a brute-force scan rather than against the previous implementation, whose answers at shared face edges came out of rounding.
- **Ramps are DERIVED from paving and height**, not placed by hand. A road crossing a step needs a ramp to be traversable, so the ramp is what makes the road a road rather than a separate decision: pave between two heights and it appears, erase the road or level the ground and it goes. The ramp always sits on the LOWER cell rising toward its higher neighbour, so a staircase ramps continuously. `roads/ramp-derive.ts` refuses what the artset cannot draw — a half step (no paved ×0.5 art), a step of two or more, or a cell facing two higher neighbours — and the road simply stays split, which the network overlay shows. Ramp frames differ in height by direction: N and E rise up-screen and are 131px tall, while S and W rise toward the viewer and fit the raise inside the 99px a flat tile already has, which is why a slope sprite is anchored by the standard ground height rather than its own frame. The whole derivation happens inside the paving command (via `PatchBuilder.peek`, which reads the staged edit rather than the grid), so one undo reverses road and ramp together. `ramp-art.ts` reads the hand-authored `slope-labels.json` and filters it to walkable ground: no water (most gently tilted art is river and shoreline), no road-extent embankments, no corner rises.
- **Roads are a paved AREA, not a line.** Forced by the artwork: the tileset has no thin outer corner, so a line model cannot draw a bend. You paint cells and the region autotiles, which also gets 2-wide avenues and plazas for free rather than special-casing them. The `mask → sprite` table is **derived** from `road-labels.json` / `city-tile-labels.json` at load, not hand-written — v1's hand-written table omits all four outer corners even though the art is labelled, so every v1 bend falls back to plain asphalt. `roadCoverage()` walks all 16 masks and reports which resolve exactly, which substituted and which have no art, because a silent fallback is what hides the failure — and the editor's `gaps` overlay marks the substituted cells on the map, so a labelling gap is visible rather than deduced. A turn picks its art from the DIAGONAL across its two open sides: where the paved region wraps round, the cell is a corner of a block and the road fills it (square-edged art); where it does not, a single-width road is turning, and the artset draws that only as a CURVE. Both are labelled, so the landscape set resolves every mask exactly; `roadCoverage` fails loudly if that ever regresses.
- **Derived road art is baked, not composited at runtime.** Where three paved cells meet a grass cell at a vertex the kerb has to turn 90° around that point, and no single tile carries a mixture of interior and notched corners. `bun run bake:road-corners` composites the 22 needed variants into `isometric_assets/derived/roadCorners_sheet.png`, which loads as a fourth atlas — so at runtime they are ordinary frames with the same nearest-neighbour sampling and the same batching as every other tile. Compositing at draw time was tried twice and fails twice over: separate sprites round to the pixel grid independently (a 1px drift at arbitrary zoom), and a `RenderTexture` defaults to linear filtering while the atlas is nearest (visibly soft). The variant list is derived from the autotile resolver, so the sheet cannot drift from what the engine asks for.
- **Dirty cells accumulate, and the renderer drains them.** Several commits inside one task collapse into a single React re-render, so a dirty set that each commit replaced left the renderer reconciling only the last one — every earlier edit in the grid and absent from the screen. It lives outside the store alongside `history` and the road graph, for the same in-place-mutation reason.
- **Structures are a definition plus a render STRATEGY** (`src/world/structures`). A `StructureDef` is data — a footprint, a `RenderSpec`, and rules for where it may stand — and nothing in `def.ts` or `place.ts` imports Pixi, so the placement rules are testable without a renderer. Drawing goes through a registry keyed on `render.kind` (`tiles`, `excavation`, `custom`), each strategy implementing `mount`/`update`/`unmount` against the band containers; an unregistered strategy resolves to null so one undrawable building never stops the world drawing. This is the abstraction v1 lacks: the slop pit IS a structure, but its footprint lives as hardcoded span constants inside `GroundRoadLayer`, so nothing can ask what occupies a cell or place a second one. `structureAt` stores a structure's **id**, never a list index — an index is not stable under demolish, nor under undo restoring records out of order. Placing is ONE command: level the footprint to its lower median, clear any ramp under it, stamp the footprint, create the record — so a single undo puts the hill back. `clearsTerrain` is a RENDER rule and not a data one; zeroing the terrain layer would lose the material, so demolishing could not restore it and every excavation would leave a permanent hole. The map file carries records as readable JSON and rebuilds `structureAt` by stamping them, which keeps 16KB per 64² map out of the file and means the layer cannot disagree with the records it indexes. Building stacks come from `composeBuilding` in `src/iso/kits.ts`, which v1 calls too — the rules for which frame sits on which floor are art facts and must not fork.
- **One predicate for both.** `roads/mask.ts` `connects()` decides whether two paved cells are joined, and both the render mask and the connectivity graph call it — so a road that looks joined is joined. Height participates, so a road running off a plateau edge is a dead end, and a **ramp** is what bridges a step. Connectivity is union-find over paved cells (`roads/network.ts`): painting unions incrementally, while anything that could remove a link — erasing, or a height or ramp edit — refloods, because union-find has no split. The debug overlay colours one hue per component, which is how a network that *looks* joined but is two becomes visible.
- **Build cursor.** All placement routes through `world/edit/cursor.ts`: the tool supplies cells, the cursor draws them. The footprint outline lives in the overlay *above* the world so it stays readable, while ghost sprites are parented into their own cells' bands so they are occluded at true depth. Cells are tinted **individually**, so a partly blocked footprint shows which cells are the problem. It redraws on change (a signature over cells, heights, validity, frame and scale), not per frame.

## Dev tools

- A **building-kit labeller** (dev-only, `dev/roadlabel.html`) authors `building-kits.json` / `road-labels.json` / `slope-labels.json` for the renderers; its Slopes tab labels form, rise (×0.5 / ×1 only), direction, per-edge state and tunnels. ⚠️ These files hold hand-authored data — never overwrite them programmatically (e.g. via preview eval).
- The **world editor** at `?world=1` is the authoring surface for World v2: paint any of ~930 atlas frames, raise/lower/flatten/smooth terrain, place and demolish structures, brush shapes and sizes (a **road** line drag bends once into an L, since cells touching only at a corner are not adjacent here and would lay lone squares rather than a road), undo/redo, save/load, resize, pave and unpave roads (ramps appear on their own where a road crosses a step), overlays for the grid, bands, height, iso origin, road mask and network components, a per-cell inspector that reports which autotile rule fired, and **fixtures** (ziggurat / occluder / ramp fan / road shapes / avenue / plaza / split trap) that build the awkward cases on demand so a picking or connectivity bug is reproducible. In dev it also exposes the store as `window.__world` — a console `await import()` of the store resolves through a *different* Vite module graph and returns a second, unrelated instance, so that handle is the only reliable way to inspect the live map from outside React.
- **`bun run bake:road-corners`** regenerates `isometric_assets/derived/roadCorners_sheet.{png,xml}` from the landscape sheet. Derived output, checked in; re-run it if the road labelling or the notch rects change. `dev/png-min.ts` is a ~120-line PNG codec used only by the bakers — the project ships no image library and this avoids adding one for a build script.
- Some dev affordances (e.g. "grant juice") are gated to `localhost` via `utils/dev-mode.ts`.

## Testing

`bun test` runs unit/integration tests colocated as `*.test.ts`, plus headless progression simulations under `src/simulation`. App tsconfig excludes test files, so run them through Bun (not `tsc`).

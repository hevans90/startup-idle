# Vegetation: trees, seasons, growth, weather

Status (2026-11-19): phases 1–3 built — the seasons' look, woods as forests (`render/forest.ts`); the vegetation fields, biomes, six new kinds, growth, spread and catch-up (`vegetation/`); felling (stumps, timber), the Plant tool (woods, row, hedge, flowers) and farms with fields through the year paid at harvest (`vegetation/tend.ts`, `game/vegetation-cost.ts`). Sizes are the mature bake scaled by age, not three bakes. Street and park trees still the old props. On `?ground=smooth` only; the stepped ground keeps today's woods.

## Decided (asked 2026-11-19)

| Question | Answer |
|---|---|
| Seasons run on | The game's own clock: **a year an hour** of play, a season every 15 min |
| Offline | **Catches up**, as the economy does (same cap) |
| Clock setting | Its own **Seasons** setting, **on** by default; off freezes the calendar where it is |
| Season looks | Leaf colour and fall, blossom, bare winter trees; snow; grass shifts through the year; flowers and crops |
| Tree art | **Baked variants** per species and state |
| Growth | Trees grow from saplings; woods spread (grass → scrub → wood); plants react to the world; trampled paths |
| State | **Per-tile fields**, saved; each tree still hashed from its tile |
| Species | **Biomes by height and water**: pine and heather high, willow and reeds by water, broadleaf in valleys |
| Gameplay | Real: clearing costs, planting, timber and produce, environment links |
| Harmed by | Pollution, drought and heatwave, flooding, fire that spreads |
| Crops | **Player-built farms** |
| Weather | A real seasonal system: rain and snow feed the water, growth and the ground |
| Motion | Wind sway, falling leaves and petals, snowfall and rain |
| Smart decals | Ground under canopy, wear and paths, weather marks, scatter props |
| UI | A **season and date indicator** only (and the new tools) |
| Budget | **+2 ms GPU** at the closest zoom on the bench; sim ≤ 0.5 ms CPU a frame |
| First | **The seasons' look** |

## What is there now

- A wood is a ground material, `wood1`–`wood3` (1–3 trees a tile; `terrain-names.ts` `treesIn`), laid by the generator on grass (`gen/generate-map.ts` `plantTrees`). Nothing per tree is saved.
- Six baked species (`props/models.ts` `TREES`) on the shared prop pages; leaves are a white layer tinted at runtime. Woods draw five of them (`render/woods.ts`), one Container and two Sprites a tree, into the bands; a revision rebuilds every changed cell's Containers.
- A building on a wood hides it; demolished, the trees come back. No player can plant or clear.
- The only clock is a cosmetic 10-minute day (`daylight.ts`), off by default and not saved. No calendar, no snow; rain only in a flood event.
- Nothing in play reads greenery: not beauty, desirability, water, pollution or fire.

## The model

### The calendar (`world/calendar.ts`)
- `yearT` in [0, 1), saved, advanced by play time (`YEAR_SECONDS = 3600`) and by offline catch-up. The Seasons setting off holds it.
- `season(yearT)`, `dayOfYear`, and a smooth `seasonWeights` (spring, summer, autumn, winter) for blending: no hard flip at a boundary.
- HUD: a season icon and the date.

### Vegetation fields (`grid.veg*`, saved)
One byte each per tile:
- **cover**: none, grass, meadow, scrub, wood, reeds, field, burnt.
- **density**: 0–3 trees (replaces `wood1`–`wood3`).
- **age**: sapling → mature, in steps.
- **health**: drops under stress, recovers without it.
- **wear**: trampling.

Species are not saved. Each tree's species is hashed from its tile and chosen by the biome rule (height, slope, distance to water). Old saves migrate: a `woodN` tile becomes cover wood, density N, mature, healthy.

### The vegetation step (`world/vegetation/step.ts`)
- Pure and deterministic.
- Each second it ticks a slice of the map in turn, so a whole map is covered in a few seconds.
- Growth has a closed form in elapsed time. Spread and succession move in bounded steps. Offline catch-up therefore runs as a few big steps, not a replay.
- **Spread**: a wood's edge seeds grass next to it; grass left alone goes to scrub, then to wood, slowed by wear and stopped by paving or a building.
- **Stress** lowers health, and low health thins density:
  - pollution (the water and air fields);
  - drought and heatwave;
  - standing water over a set time (reeds and willow excepted);
  - fire: dense, dry wood catches and spreads by wind and dryness and leaves burnt cover, which regrows.
- **Wear** comes from walkers and vehicles passing a tile (counted in `town.ts`). It fades when they stop.

### Weather (`world/weather.ts`)
- A seeded state machine for each season: dry, showers, rain, storm, frost, snow.
- Rain is a source over the map into the water solver. Its cost has to be measured, because the solver is the most expensive part of the frame.
- Snow builds up as a per-tile depth field, not saved but rebuilt from the weather. It melts into the solver in spring.
- The drought and heatwave events stay as they are, but weather makes them likelier in summer.

### Mechanics
- **Clearing**: placing on wood or scrub costs by density and age. It leaves stumps for a while and pays out timber.
- **Planting tool**: woods, a row of trees, hedges, flower beds. It costs per sapling. Saplings grow; on bare ground the biome picks the species.
- **Farms**: a structure the player places, with fields round it that go through the year (ploughed, green, gold, stubble) and pay out at harvest.
- **Environment**:
  - cover soaks up rain in the solver (infiltration by cover and density);
  - woods damp noise and air pollution near homes;
  - shade cools in a heatwave;
  - greenery is a term in desirability.

## The look

### Trees as a mesh
- Each band chunk draws its trees as one mesh of quads instead of a Container per tree. That makes sway and crossfading cheap in the shader, and it holds sorting by band.
- A quad's attributes are its foot, its atlas rects (one per seasonal state), its size from age, its sway weight, and the day of the year it turns.
- The vertex shader shears the crown by a shared wind field, with gusts rolling across.
- The fragment shader crossfades between two states with a per-tree dither, so a wood turns over weeks and not all at once.
- Rebuilds happen only when a band chunk's fields change. Nothing structural changes per frame.

### Bakes
- Every species gets five states: blossom or new leaf, summer, autumn, bare, snow. New species: willow, poplar, fruit and orchard trees, shrubs, heather, reeds.
- Each also gets three sizes for growth: sapling, young, mature.
- This is several new 2048² pages, so the page count is checked against memory before baking.
- Shadows stay baked, but they thin out when the trees are bare.

### Ground
- The grass shader takes the season weights and a small per-tile texture from the fields: cover, health, wear, snow and wetness. The texture is updated a slice at a time, never all of it at once.
- Grass through the year: lush in spring, dry in summer, browned in winter.
- Snow lies by slope and height and drifts in the lee of what stands.

### Smart decals and scatter
- **Under canopy**: shade, leaf litter and moss under woods; autumn leaves blown onto roads beside them.
- **Wear**: desire paths, worn verges by busy roads, ruts. All of them heal.
- **Weather marks**: puddles and mud after rain, frost, scorched grass in drought, burnt ground after fire.
- **Scatter**: props hashed per tile from the fields — rocks under cliffs, reeds at the shore, tufts, bushes, fallen logs, and stumps where trees were cleared.

### Particles
- Falling leaves in autumn and petals in spring, near the trees that drop them.
- Snowfall and rain across the screen, by the weather.
- All on the GPU, with batching (per-frame Graphics need `batchMode = "batch"`).

## Phases

Each phase ends with headless screenshots of the four seasons at three zooms, a bench measure on the closest zoom, and the full suite.

1. **The seasons' look**:
   - the calendar, the setting, the HUD indicator, saving `yearT`, offline catch-up;
   - bakes of the five current species in five states;
   - trees as a mesh with sway and the crossfade;
   - grass through the year;
   - winter snow by the calendar alone, because there is no weather yet.
2. **Vegetation fields**:
   - the fields and the migration from `woodN`;
   - biomes and the new species and sizes;
   - growth, spread and succession;
   - offline catch-up for them.
3. **Player mechanics**: clearing cost, timber and stumps; the planting tool; farms and their fields.
4. **Weather**: the seasonal state machine; rain into the solver; snow building up and melting; puddles and mud; snowfall and rain particles.
5. **Stress and the environment**: pollution, drought, flooding and fire hurting plants; soaking up rain, noise and pollution damping, heatwave shade, desirability.
6. **Smart decals and scatter**: canopy ground, wear and paths, weather marks, scatter props, falling leaves and petals.

## To settle when we get there

- Balance: clearing cost against timber, how fast woods spread, and what a farm earns. Tuned in phases 2–3 and shown before committing.
- Whether fire can reach buildings.
- Whether winter slows anything in the economy (no, unless asked).
- Rain's cost to the solver at full map. If it doesn't fit in the budget, rain falls only where the player is looking.

## Risks

- **Prop pages**: five states, three sizes and new species multiply the bake. Bake the species in use first, and measure memory.
- **Render groups**: the tree meshes change in place. No per-frame structural changes, and nothing destroyed in the frame it was drawn (see `batches-keep-destroyed-sources`).
- **Saves**: new fields, plus the migration from `woodN`. Old saves have to load as they looked.
- **Determinism**: offline catch-up and the AI pilot's runs need the step to be pure and seeded.

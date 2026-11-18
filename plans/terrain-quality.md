# Terrain that looks like land: slopes, light, a real shore

Status: **phases 0–1 built** (2026-11-18); 2 onward to do. Phase 1 measured +0.2 ms GPU close, +0.6 ms mid and far on the `terrain` fixture (budget was 0.5); roads and sprites do not take the shadow yet. The shore wedges of `abcb5e54` (`shorePieces`) are gone. Builds on `plans/procedural-ground.md` (the shaded ground mesh, phases 1–4 built).

## What is wrong now

Looked at on `?world=1` (generated, seed default) and `?world=1&fixture=harbour`, at three zooms.

| What you see | Why |
|---|---|
| Every hillside is a staircase of flat lime treads and brown risers | The generator rounds heights to whole slabs and sets no ramps (`gen/generate-map.ts` `terrace`, `g.ramp.fill(0)`); the mesh draws each cell as a flat top and vertical walls |
| Contours and shores zig-zag | A height change can only happen on a tile edge |
| The ground is flat and unlit | No sun. Tops are one colour; the only light is ±5% on ramps and two fixed wall shades. No shadow at a cliff's foot, none thrown by one |
| Sand and dirt come in tile-wide strips along terraces | `paintGround` picks material by height band, per tile |
| Water shows tile-shaped patches of depth, and its edge is a hard line | The water's bed is flat per tile; colour and opacity are worked out per corner of a quarter-tile column and interpolated. The fragment shader reads nothing |
| The shore wedges look like cut paper | Flat polygons with a straight vector edge, driven by the map's starting water (`grid.pool`), not the water that is there |
| The map is a slab in a void | Skirts on the two front edges only, down to height 0 |

The wedges failed because they patched the outline and left the cause: the drawn ground has no shape between tiles.

## The idea: a drawn surface, apart from the grid

The grid stays as it is — flat cells in half steps — for roads, buildings, water, placement and saves. **What is drawn is a continuous surface fitted to it.**

- **Corner heights.** Each grid corner gets one drawn height from the (up to four) cells that meet there. Natural ground between them is a sloped surface; a step of up to `CLIFF` half steps (start at 4, two slabs) becomes a bank, not a wall.
- **Pinned cells stay flat.** A cell that is paved, built on, a ramp, under a deck's end or a site keeps its own height at all four corners (a ramp keeps its plane). The natural cell next to it takes the whole slope, as a cutting or an embankment. Two pinned cells at different heights get a wall, as now.
- **Cliffs are a choice, not the default.** Where the step is over `CLIFF`, the corner splits and a rock face is drawn between.
- **One sampler.** `drawnHeight(grid, u, v)` (pure, tested) is the surface. The mesh, the shader's height texture, the water's bed and everything standing on natural ground read it.

Painter's order is unchanged: a cell's geometry stays inside its own footprint, as a ramp's tilted top does today.

Rejected:
- **Ramps from the generator.** A ramp is one of four whole-tile planes; it cannot turn a corner or run diagonally, so hills stay faceted.
- **More wedges.** Same failure as before.
- **A depth buffer and true 3D.** Everything else is sprites sorted by band.

## Phases

Each phase ends with before/after screenshots of the gallery fixture at far, mid and close zoom, shown before the next phase starts. Phase 1 is the look test: if it does not read as land, the rest changes.

### 0. Clear the ground
- Remove `shorePieces`, shader kinds 4 and 7, their tests and the README line.
- `?world=1&fixture=terrain`: one map with every case — a 1:1, 1:2 and 1:3 bank; a hill; a 2-, 4- and 8-step cliff; a beach; a lake; an island; a road in a cutting and on an embankment; a building on a hillside; a waterfall. Register as other fixtures are (`debug/fixtures.ts`, `edit-panel.tsx`).
- Save the "before" screenshots.

### 1. Sun and relief — shader only, no geometry change
- **One sun**, the bakes' own (`raster.ts` `LIGHT`, from the upper left), named once and shared.
- **Heights in the shader**: the cell texture already has them. A normal per pixel from the heights round it; tops lit by it.
- **Contact shade**: ground darkens at the foot of a wall and in hollows (from the height difference to neighbours, a fraction of a tile wide).
- **Cast shadow**: a short march toward the sun through the height texture (8 taps or fewer), soft-edged, so a cliff throws a shadow on the ground behind it.
- **Walls as rock and earth**: earth for a low bank, rock below two slabs — strata, vertical fractures, a turf lip that overhangs, lit by which way the face points.
- **Colour**: the lime regraded toward the roads' verges; broad variation across a field (meadow, worn, damp) so no hillside is one colour.

Budget: +0.5 ms GPU at the closest zoom on the bench (`__gpuTime().of.render`, sync on).

### 2. The drawn surface
- `drawnHeight` and corner rules (above), pure, with tests: pinned cells flat; no crack between any two cells; a cliff exactly where the step is over `CLIFF`; a ramp unchanged.
- `bandQuads` emits each natural cell as a fan through its corners and centre; walls only at cliffs and between pinned cells.
- A corner-height texture for the shader, so light and shadow follow the slopes.
- **Everything that stands on natural ground moves to the sampler**: trees (`woods.ts`), decals, overlays and the cursor (`overlays.ts`, `cursor.ts`), picking (`iso.ts` `pickCell`), props on bare ground, site and line plant and crews crossing country, the grass fringe. Roads, buildings and what stands on them are on pinned cells and do not change.
- The generator's sand-under-terrace and dirt-on-scarp rules (`paintGround`) go in phase 4; here the old materials just drape.

This is the largest phase and the one that can break things: anything missed floats or sinks by up to half a step on a slope. The fixture's road-in-a-cutting and building-on-a-hill cases are the check, plus the full suite.

### 3. Water on the drawn bed
- The water's fragment shader gets the surface level and its place on the ground, and reads the corner-height texture: **depth per pixel = level − drawn bed**.
- **The shore is where depth crosses zero** — a smooth contour, not a tile edge. The water surface is drawn one column past the wet edge (filed forward a band where it must be, as its far faces are) and cut by the contour; the `rimAt` pull-down goes.
- **Shallows**: clear over pale bed at the edge, deepening to the present blue; no tile patches, because the bed has none.
- **Foam on the contour**, moving (noise carried along the shore), fed by the live foam field where there is any.
- **Wet margin** on the ground side: sand and earth darker for a fraction of a tile above the waterline, from a per-tile water-level texture taken from the live field, not `grid.pool`.
- The CPU reference (`water.ts`) and the GLSL twin change with it; `__frameCompare` and the water compare scenes re-run; the still-flood total re-checked.

Second-largest phase. The solver is not touched: only where the surface is drawn and how it is coloured.

### 4. Materials by rule
- **Slope**: grass gives way to earth, then rock, as the drawn surface steepens. Scree at a cliff's foot.
- **Beach**: sand where the ground is within a step of the water's level beside it, wider on gentle shores; reeds' place marked for phase 6.
- **Generator**: `paintGround` stops laying sand by height band and dirt by scarp; painted materials (the editor's) still win where someone painted them.

### 5. Cliff lines
- Corners along a cliff's top and foot are moved in plan by up to a quarter tile toward the smoothed line (shared by every cell at that corner, so nothing cracks; pinned corners do not move). A 1:1 staircase becomes a straight edge; others soften.
- Picking near a cliff follows the moved corners.

### 6. To decide (not built unless asked)
- **Scatter**: reeds at the shore, rocks under cliffs, tufts and bushes — baked props placed by hash.
- **The map's edge**: an earth cross-section fading into the background, or sea, in place of the slab in the void.
- **Tree shadows on slopes**: baked shadows are flat blobs; on a slope they would need to lean.

## Risks

- **GPU time**: the ground covers the screen. Every added tap is measured on the bench per phase; the shadow march is skipped at far zoom where it cannot show.
- **Both renderers**: WGSL and GLSL from one body where possible, checked with `?renderer=`.
- **Water parity**: three implementations (GPU, CPU, GLSL) must agree; phase 3 is not done until the compare scenes pass.
- **Render groups**: buffers change in place; no per-frame structural changes; nothing destroyed in the frame it was drawn.
- **Saves**: nothing saved changes. `grid.height` is as it was.

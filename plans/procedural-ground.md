# Ground drawn in code: grass, dirt, sand, woods, slopes and cliffs

Status: **phases 1–4 built** (2026-11-09): `render/ground-mesh.ts`, shaders inline. Tops, borders (grass thins out onto dirt and sand), walls, ramps as tilted tops, and detail by zoom. Woods are still sprites; `cliffs.ts` steps aside for cells the mesh draws and goes at phase 7.

## Why

The ground is the last of the sheet art under the town, and next to the painted roads it shows:

- **Pixelated close up.** Each ground tile is 132 px wide. At the zooms where the roads now show stone in their asphalt, the grass beside them is blocky.
- **Hard edges between materials.** Grass, dirt and sand change at the tile's diamond edge. Every field is a grid of the same tile repeated.
- **Fixes that only exist for the art:**
  - `bake:padded` makes an inner twin of each tile (`covered`) so mip levels don't print a dark line along every row;
  - `TILE_BLEED` overdraws to hide sub-pixel seams;
  - cliff walls are copies of a tile stacked so only their skirts show (`render/cliffs.ts`);
  - woods are grass tiles with trees baked in (`bake:trees`).

## Why not the roads' painter

Roads paint one texture per distinct neighbourhood and cache it. That works because roads have few: 189 on bigtown. Ground has many, measured with the real generator:

| Map | Ground cells | Distinct neighbourhoods |
|---|---|---|
| 64², seed 1 | 4,096 | 1,878 |
| 96², seed 42 | 9,216 | 3,593 |
| 128², seed 99 | 16,384 | 3,030 |

The counts cover material, the 8 neighbours' materials, height steps and 4 wear variants. At the roads' base resolution a texture is about 240 KB, so that's up to 860 MB at 2×, before any close-up level. Snapping material changes to cell corners (dual-grid tiling) brings it down to about 324 keys, but every field then repeats a small set of tiles. That's the thing to get away from.

## The idea: ground is shaded, not painted

**A mesh per band, drawn by a shader, in the band's own tier.** The water already works this way (`render/quads.ts`: one interleaved buffer per band, `GlProgram` and `GpuProgram` both). Ground gets the same treatment:

- **One mesh per band in `staticOf`**, replacing the sprites there. Each cell is a top quad at its height, plus side quads for any face toward the camera that stands above its neighbour. A ramp's top is a tilted quad, as roads' ramps are planes. Band order is unchanged, so a hill in front still hides what's behind it.
- **A cell data texture:** one texel per cell, holding material, height and flags (woods level, hidden under a `clearsTerrain` building, wet). An edit writes a texel and rebuilds that band's mesh.
- **The fragment shader works out the look in world space** from the cell data around each pixel:
  - **Materials blend at their borders by noise.** Grass reaches onto dirt in tufts, sand drifts against grass, dirt shows through worn grass. The border is a noise threshold on the distance to the neighbouring material, not a tile edge.
  - **Seamless by construction:** every pixel's colour is a function of where it is in the world, so no tile has an edge to meet.
  - **Nothing repeats:** the noise is in world coordinates, so no field is a grid of one tile.

## Detail by zoom

The shader knows how big a pixel is on the ground (`fwidth` of the world position), so detail fades in with the zoom:

| Zoom | Grass | Dirt | Sand |
|---|---|---|---|
| Map (far) | Flat colour, broad mottling | Flat colour, soft patches | Flat colour, slight dunes |
| Mid (like roads at 4×) | Clumps, light and dark, mown stripes on a lawn | Pebbles, cart ruts near roads | Ripples |
| Close (like roads at 7×) | Separate blades, clover, daisies | Stones with shadows, cracks when dry | Grains, shells near water |

Each band of detail fades in across about a factor of two in zoom, so there's no switch to see. A far-off pixel averages the detail it can't show, with no mip shimmer, and the inner twin and `TILE_BLEED` are no longer needed. The look matches the roads: the same palette family as their verges, the same grain, and the same light from up-left.

## Sides, cliffs and slopes

- **Faces toward the camera** (+x down-right and +y down-left are the only ones that can show) are side quads on the same mesh with the same shader, which knows it's drawing a wall:
  - grass over a dark band of roots, then earth in strata with stones;
  - sand slumps;
  - rock below a few steps.
  - The two faces are lit differently, as the art does now: down-left lighter, down-right darker.
- This replaces `render/cliffs.ts`'s stacked tiles.
- **Ramps** are tilted tops with a little light from their slope, so a hillside reads as a hill.

## Woods

Woods (materials 4–6) are grass with one, two or three trees baked into the tile. Drawn this way, the ground under them is grass, and the trees become sprites in the band's structure tier: the tree art from the sheet, placed by the same hash `bake:trees` uses, so a wood looks as it does now. **To decide:** sheet trees as sprites (recommended to start), or trees drawn in code later.

## Water

- Under water the shader draws a riverbed: sand and silt, darker with depth. It reads the depth from the water field's data, which the water renderer already uploads.
- Ground dries out away from the edge: a wet margin a fraction of a tile wide.
- Flood water draws over all of this as it does now. Re-check the water compare scenes (`debug/water-compare.ts`) and the perf scenes, which time the ground pass.

## What stays sheet art

The editor's tile browser can paint any of about 940 sheet frames as terrain, and the palette is saved with the map. Grass, dirt, sand and woods (indices 1–6) are drawn by the shader. Any other frame keeps a sprite, drawn on top of the ground mesh in the same band. `?ground=sprite` draws the whole map from the sheet, as `?roads=sprite` does.

## Phases

Each phase is a commit on main, with a check in the fixtures on the isolated server, and README lines updated.

1. **Tops, flat, behind a flag.**
   - `render/ground-mesh.ts`: band meshes, the cell data texture, and edits.
   - `render/ground.wgsl` + `.glsl`: grass, dirt and sand as flat colours with far-zoom mottling.
   - `?fixture=ground`: every material pair, both diagonals, a lone cell of each, a checkerboard.
   - **Tests:** the mesh's quads and the data texels for small grids (pure); an edit touches one band.
2. **Borders:** noise-blended material edges, with a priority order so three materials meeting at a corner resolve the same way from every side.
3. **Sides and ramps:** walls with strata, lit faces, tilted tops. Retire `cliffs.ts`. Check against the plunge, waterfall and cascade fixtures.
4. **Detail by zoom:** the mid and close layers from the table, faded in by pixel footprint.
5. **Woods:** tree sprites over grass, as decided above.
6. **Water's edge:** riverbed, wet margin, and the water compare scenes re-run.
7. **Retire the sheet ground:** `bake:padded`'s inner twins, `covered`, `TILE_BLEED` for ground, and `bake:trees` (if trees went to sprites). Holograms for levelled ground move to the mesh's colours.

## Risks and checks

- **GPU time:**
  - The shader runs once per ground pixel, which is most of the screen. Budget about 1 ms on the bench at the closest zoom.
  - The detail layers are skipped by branch when they can't show, so far zooms stay cheap.
  - Measure with `__gpuTime()` after 45 bench frames, with sync on, never from a hidden tab or the HUD (see the perf notes).
- **Draw calls:** one ground draw per band instead of batched sprites, about 256 on a 128² map. Culled bands draw nothing. If that's measurably slow, merge bands into chunk meshes, keeping each band's order with its depth.
- **Render groups:** a mesh's buffer changes in place on an edit, which needs no structure rebuild. Never swap or destroy a buffer a render group bound in the same frame (the road crash this week was that bug, for textures).
- **Both renderers:** WebGL and WebGPU programs, as `quads.ts` has. Check both with `?renderer=`.
- **Readers of the ground sprites:** only the scene's edit sync (`world-scene.tsx`, `syncCell` and `syncCliff` per touched cell) and the water compare harness (`debug/water-compare.ts` builds its own terrain layer). Both move to the mesh.

## To decide

1. **Approach:** the shader mesh (recommended), or the roads' painter with corner tiling (fewer changes, visible repetition, about 80 MB at 2× before close-ups).
2. **Trees:** sheet trees as sprites over the new grass (recommended to start), or trees in code.
3. **Look:** the current tiles' palette, made richer close up (recommended, so nothing jumps), or a new palette to match the roads.
4. **Tile browser frames:** keep them as sprites over the ground (recommended), or limit painting to the shaded materials.

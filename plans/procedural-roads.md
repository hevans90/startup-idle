# Roads drawn in code: surface, kerbs, pavements and markings

Status: **phases 1–4 built** (2026-11-09), as one painter rather than a distance field: `roads/looks.ts` decides each cell's markings, `render/road-paint.ts` paints them. Phase 5 (retiring the sheet) is still to do; the editor's planned-street holograms still use sheet frames.

Decided: British markings, every decal; pavement 0.22 and kerb 0.04; give-way on minor roads and stop lines at yellow boxes; turn arrows in; the label files and the labeller kept. Traffic keeps right, as the agents drive; `KEEP` in `roads/looks.ts` flips every marking.

## Why

Every road on the map is a sprite cut from the landscape sheet: 132×99 PNG frames, picked by an 8-bit mask through the labels in `road-labels.json`. That has run out:

- **No markings at all.** There are no centre lines, lane lines, stop lines or give-way lines, and the art can't gain them: a line has to know where the road goes beyond its own tile.
- **The shapes are the sheet's, not the road's.** A T-junction's nubs are rounded squares while a bend's are round. Mixed corners fall back to the nearest frame (`exact: false`, plus the notch bake in `dev/bake-road-corners.ts`). The crossroads tile is wrong for any 2-wide junction.
- **Everything laid over the roads has to fit their art.** The relaid pavements (`render/street-props.ts`) had to be measured off the PNGs pixel by pixel (pavement 0.25 in, kerb at 0.29), bent to two different nub shapes, and re-laid by each tile over its sprite's 2% bleed (`lapsOf`).
- **Pixelated close up.** The frames are 132 px wide; at the zooms the street fixture is viewed at, they blur and step.
- **Cars drive on the kerb.** On a 1-wide road the art's carriageway is 0.29–0.71 of the tile, but a car keeps `CAR_KEEP_RIGHT = 0.22` off the middle, at 0.72: right on the kerb line.

## The idea

**Keep one sprite per paved cell, in the same tier.** Make each sprite's texture in code instead of loading it from the sheet. A cell's look depends only on its neighbourhood, so the code paints a texture once per distinct neighbourhood and caches it. Everything that depends on roads being one sprite per cell carries on unchanged: band order, `pavedOf`, culling, render groups, the editor's ghost and dirty-cell sync.

**Painted from a field, not stitched from pieces,** the way `render/decals.ts` already paints scorch marks: each pixel of the tile's diamond is mapped back to tile coordinates, and from there the field says what is there.

- **Paved region:** the union of paved cells in a 5×5 window. `g(p)` is the distance from point `p` to the nearest unpaved cell.
- **Pavement:** the band `g < P`, P ≈ 0.25.
- **Kerb:** the band `P ≤ g < P + K`.
- **Carriageway:** everything beyond the kerb.
- **Shapes for free:**
  - **Nubs** fall out of the distance itself. Within P of a grass corner is a quarter circle, so every inner corner is a round nub, the same at a bend, a T or a crossroads.
  - **Outer corners of a turn** are rounded by an opening of the carriageway (erode, then dilate by Rc), so a 1-wide bend is a true quarter ring.
  - **Wide roads and plazas** need no special case, nor do one-cell spurs, dead ends (a rounded turning head) or zigzags.
- **Seamless by construction:** two neighbours compute the same field over their shared edge, so the bleed overlap paints identical pixels. No laps.
- **Markings are drawn as vector strokes** on the same canvas with `setTransform(66, 33, -66, 33, 66, 0)`, the tile-to-screen affine. Lines and dashes are written in tile units and come out correctly foreshortened. Arcs through bends are ellipses with no extra work.
- **Ramps are affine too:** a plane tilted along u or v. The same painter draws a ramp's surface with a different transform, and the skirt is left to the terrain tier as it is now.
- **Decks** stay as they are: an ordinary road at the surface height.

**Resolution:** textures are painted at 2× (264×198), so roads stay crisp zoomed in. The sprite's scale halves to keep the same size on screen.

**Cache key:** the 5×5 paved bits, plus the ramp direction and rise, the street level 0–3 (for the relaid pavement) and the marking flags described below. A typical map uses tens of distinct keys and the street fixture under 200. At 2× a key is about 210 KB of GPU memory. Pages are 2048² atlases (about 70 tiles each), allocated lazily and evicted LRU over a cap, so batching stays as it is. Painting a key costs about 1–3 ms. New keys are painted on demand (the first paint shows a plain carriageway for at most a frame or two), and the keys the map already has are pre-painted at load.

## Markings, as a driver reads them

Traffic keeps right (`agents/roads.ts`). What a cell needs to know beyond its own mask:

| Marking | Where | Decided by |
|---|---|---|
| **Centre line**, dashed | Down the middle of a 1-wide road, curving with its bends | Mask only |
| **Centre line**, solid pair | On the shared edge of a 2-wide road's two cells | Which neighbour is the same carriageway: the 5×5 window |
| **Edge lines**, thin solid | Just inside the kerb on 2-wide roads | Mask |
| **Stop line** (solid bar) or **give-way** (double dash, triangle) | Across the inbound (right-hand) half of a road's last cell before a junction | Whether the next cell is a junction: needs the neighbour's own neighbours, so the 5×5 window |
| **Junction box** | Left clean; lines stop at the box | Mask |
| **Turn arrows** | Optional, on the cell before a stop line on 2-wide approaches | As the stop line |
| **Zebra crossings** | Where the street's level puts them (now a street prop) | A flag from `beauty`, added to the key |
| **Nothing** | On plazas (3+ wide, `thick-fill`) and dead-end heads | Mask |

Lines fade out over the last part of a dead end and don't run up ramps' kerbs. Night needs nothing new.

## Phases

1. **The painter, behind a flag.**
   - `roads/field.ts`: the distance field, the pavement, kerb and carriageway bands, and the opening, all pure and tested.
   - `render/road-paint.ts`: Canvas2D at 2× into an atlas, keyed and cached. Surface, kerb with its lit edge and face, plain pavement, and a soft shadow at the kerb.
   - `render/paved.ts` picks code or sheet by `?roads=sprite`, with code as the default once it is accepted. Same sprite and tier.
   - `?fixture=roads`: every shape side by side. Straights both ways, bends all four ways, T, cross, 2-wide avenue and its junctions, a 1-wide road meeting a 2-wide one, plaza, spur, dead end, zigzag, staircase, loop, ramps in all four directions at rise 1 and 2, a deck.
   - **Tests:**
     - field values at known points;
     - a key's pixels are deterministic;
     - **shared edges match**: paint both neighbours and compare the overlap strip pixel by pixel, for every pair of reachable masks;
     - dead-end and ramp keys.
2. **Markings:** centre lines, edge lines, stop and give-way lines, and the clear junction box. Then arrows if wanted. Tests on the key flags from small grids, and on the lines continuing across tile edges (the same overlap compare).
3. **Lanes and kerbs agree with the paint.** Set `CAR_KEEP_RIGHT` to the middle of the right-hand lane of the carriageway as painted, and `KERB` (people) to the middle of the pavement. Check corners: a car on the inside of a right turn has to stay off the nub. Run the town tests and the street fixture.
4. **Relaid pavements move into the road texture.**
   - Concrete flags, brick and York stone become the pavement band's fill at levels 1–3, painted from the same field, so bends and nubs come out of the same code with no geometry of their own.
   - Zebra crossings join the key.
   - Delete `paving`, `curved`, `run`, `lapsOf` and the `brick`/`bend`/`nub`/`crossing` props from `street-props.ts`. The kerb props (lamps, trees, benches) read their place from the field's constants.
5. **Retire the sheet.**
   - Remove `roads/table.ts`, `notch.ts` and `variants.ts`, the corner bake, `pavedRampFrame`, and the `inexact`/gaps count and its overlay line.
   - The cell readout shows the key instead of the frame.
   - `debug/water-compare.ts` and `fixtures.test.ts` move to the painter.
   - **Your call:** whether `road-labels.json`, `city-tile-labels.json` and `dev/roadlabel.html` are deleted or kept. Nothing here writes to them.

Each phase is a commit on main, with a check in the fixture on the isolated server, and README lines updated.

## Risks and checks

- **Performance.**
  - Sprite count and tiers are unchanged, so the frame cost should be too.
  - What's new is painting keys and texture memory. Measure first paint on the largest generated map, and the key count and atlas memory on the street fixture and a played save.
  - Keep `renderer.gc` off as now: atlas pages are freed by the cache, never by Pixi.
- **WebGPU uniforms:** none added; it's still one texture per sprite.
- **Water over roads:** flood water and the water-compare scenes draw over the paved tier and don't read the frame. Recheck `?fixture=` water scenes with roads on them.
- **Ramps:** S/W ramps are thin foreshortened bands (see the note in `ramp-art.ts`). Judge them in the assembled fixture, never alone.
- **Pixel edges at zoomed-out views:** the 2× textures are mipmapped; check the ground-tile seams fix still holds with roads drawn this way.

## To decide

1. **Marking style.** Recommended: white dashed centre lines, white stop and give-way lines, and no yellow, to go with the town's British street furniture. The other option is the US look: yellow centre lines with white edges.
2. **Carriageway width.** Recommended: pavement 0.22 and kerb 0.04, which leaves a 1-wide road's carriageway 0.48 across with lanes at ±0.12 off the middle. Keeping the art's 0.25/0.04 leaves lanes only 0.21 wide.
3. **Stop lines or give-way:** everywhere the same, or stop lines only where a 1-wide road meets a wider one.
4. **Turn arrows:** in or out of phase 2.
5. **The label files and the labeller** at phase 5: delete or keep.

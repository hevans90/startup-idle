# The engine: smooth big towns, crisper fidelity, and polish

## Context

The user asked for an overall analysis of the rendering and a plan to vastly improve its performance and fidelity, and to make it all feel more polished.

**Their choices:**
- **First priority:** keep big towns smooth.
- **Sampling:** crisp up close, smooth when zoomed out.
- **Polish in scope:** camera feel, build juice, lighting and atmosphere, sound.

**Housekeeping first:** the AI-planning phases 4–7 (look-ahead, rebuild, panel, three-way benchmark) are finished and the full suite passes (1805 tests). They are uncommitted only because plan mode came on. Commit and push them before step 0.

### How it draws today (Pixi v8, WebGPU, `world/world-canvas.tsx`)
- **Bands:** the scene is one render group of diagonal bands (`bandOf = x+y`), 16 bands to a chunk render group (`render/bands.ts`). Each band has six tiers: cliffs, static, under, paved, structures and dynamic. The dynamic tier is its own render group per band.
- **Culling** is vertical only: whole chunks are toggled by `visibleBandRange`. Every visible band draws its full width.
- **Ground:** terrain, roads and cliffs are one sprite per cell, nearest-sampled from 1024×2048 atlases with **no mipmaps**.
- **Water** is the most-tuned part: GPU solver, compute gather, a procedural vertex shader, one mesh per band. Its render pass is ~4 ms, ~3 ms of that a fixed cost of ~127+ draws.
- **Movers are the scaling problem.** Every car, person, bus and boat is its own `Graphics`, cleared and re-tessellated every frame (`agents/town-render.ts`, `boats/boats-render.ts`). Each also changes band and zIndex, re-sorting that band. The cost grows with population.
- **Other per-frame redraws:** night, rain, the AI layer (`ai/ai-layer.ts`), hologram scans, project cranes and crews, and wake foam are all immediate-mode Graphics rebuilt each frame.
- **Holograms:** for every AI hologram, the tick calls `getBounds()` on every part and writes blend, tint and alpha.
- **Simulation runs in the same tick, with avoidable allocations:**
  - repeated `[...structures.values()].find/filter` calls;
  - `liveMoods` about 4× a frame, each building a sorted key string;
  - pointer hit-testing calls `getBounds()` on every structure.
- **HTML overlays:** building labels rewrite every transform every frame without checking for a change, and the land-fog subscription fires on every store change.
- **Missing entirely:** filters and lighting, camera inertia, tweens, a general particle system, audio.

## Status (2026-10-20)

Measured on `?fixture=bigtown` (2,165 buildings) with `__townPerf()` and `?hitches`:

| Phase | Status | What it showed or did |
|---|---|---|
| **0, measure** | done | The `?perf` meter, `__townPerf()`, `?hitches`. The lag on a big town was never the renderer: it was HTML overlays and the economy re-scanning the town (labels 105 ms, payday 170 ms, the economy's map readers and rate selectors 41–190 ms). All fixed; a pan or zoom now runs with no frame over 16.7 ms. |
| **1, movers** | done | Sprites from one baked atlas. A 2,000-mover crowd: render 13 → 4 ms, frame ~45 → ~5 ms. Traffic checks only neighbours (`nearGrid`), and skips pairs too far apart or drawing apart. |
| **2, horizontal culling** | dropped | Draw calls were already 25–70 on the big town. |
| **3, per-frame Graphics** | partly done | The night sheet redraws only on change, and labels are written only when they move. The AI layer (~0.1 ms), hologram scans and hit-testing (2.9 ms a click, 0.3 ms a hover) were measured and are not worth changing. |
| **4, water draws** | dropped | Water was ~2 ms of GPU on the big town. |
| **5, fidelity** | in progress | Mipmapped padded atlases and the night grade with lights are done. Contact shadows and pixel snapping are left. |
| **6, feel** | in progress | Camera, juice and money floaters (payday's) are done. The drone landing flash is left. |
| **7, sound** | done | |

The mover cap raise is parked in a stash until `plans/traffic-congestion.md` (on branch `traffic-congestion`) decides what busier streets mean.

## Phase 0: Measure (before touching anything)

- **A populated perf scene:** a preset in `world/debug/perf-scene.ts` (`__perfScene`). It is sealed, pinned in view and needs `?nosave`. It builds:
  - a 128² town with ~2,000 movers, 400 structures and some water;
  - views at three zooms: 0.25, 1 and 3.
- **What it records:** frame, js and GPU passes (`__gpuTime`), draw calls, and Graphics rebuilt per frame (a counter).
- **The play-view meter:** show the existing `debug/perf-hud.tsx` in the play view behind `?perf`.
- **Rules (from memory):** measure with real rAF or `sync=true`, never in a hidden pane, on the isolated server only.

## Phase 1: Movers as batched sprites (the biggest scaling win)

- **Bake once at atlas load** (`iso/atlas/load-isometric-atlases.ts`): each mover's look — car and bus per facing, a person per facing and walk frame, boat per facing — rendered from the existing draw code into one generated texture atlas, via `renderer.generateTexture` on the current Graphics drawers in `town-render.ts` and `boats-render.ts`. Body colour is applied as a white base with `tint`.
- **Draw** each mover as a pooled `Sprite`. Each frame, only `position`, `texture` (frame) and `tint` are set.
- **Re-sorting:** a mover is reparented only when its band actually changes, and its zIndex is set only when its order key changes.
- **Wake foam:** one pooled sprite per wake segment, not a Graphics per band.
- **Expected:** mover cost becomes O(n) sprite updates in batched draws, instead of O(n) tessellations.

## Phase 2: Cull across, not just up and down

- **Segments:** split each band's tiers into **segments** of 32 cells along the band (`render/bands.ts`). From the camera rect, `setVisibleBands` grows a `setVisibleRect` that toggles segment `visible` too.
- **Placement:** placement code asks `segmentOf(x, y)` where it asks `bandOf` today. Keep the API in `bands.ts` so callers (`terrain.ts`, `paved.ts`, `cliffs.ts`, `structures/layer.ts`, holograms) change in one line each.
- **Watch** the render-group rebuild count (memory: structural changes rebuild a chunk's draw list). Toggle `visible` on segments only when the visible rect crosses a segment boundary.

## Phase 3: Per-frame Graphics and hot-path allocations

- **Night and rain:**
  - night becomes one full-screen white sprite, with its `tint` and `alpha` set (no `clear`);
  - rain becomes pooled sprites.
- **The AI layer** (`ai/ai-layer.ts`): split into static parts, redrawn on change (links, glow), and dynamic sprites (drones).
- **Holograms** (`render/holograms.ts`):
  - cache each hologram's screen bounds when it mounts (recomputed on zoom or rebuild);
  - write tint, blend and alpha once per state change;
  - put additive holograms in their own container so they don't break the chunks' sprite batches.
- **Project cranes and crews:** baked to sprites like the movers.
- **Hit-testing:** a grid lookup (`structureAt` over the tiles under the pointer's cell column) instead of `getBounds()` over every structure; `getBounds` only for the few candidates.
- **Simulation:**
  - a per-revision index of structures by def, on the world store, replacing the repeated spreads;
  - `liveMoods` memoised per frame;
  - the events `JSON.stringify` replaced by a revision counter.
- **HTML labels** (`play/building-labels.tsx`): write the transform only on change, as `use-cell-anchor.ts` already does. Narrow the land-fog subscription to the land and session fields it reads.

## Phase 4: Water draws (measure first; seams are fragile)

- Pixi can't batch custom-shader meshes, so per-band draws remain. Skip every band mesh whose instance count is 0 **on the CPU side**, so it is never submitted (currently it is submitted and draws nothing).
- Fold the "under" meshes into their band's surface mesh where the map has no decks.
- **Target:** cut the ~3 ms fixed cost on typical maps.
- **Guards:** `__waterBench(sync=true)` and the still-flood perf scene (memory: the frame compare misses leaks).

## Phase 5: Fidelity

**Sampling: crisp up close, smooth zoomed out.**
- Atlas textures get `autoGenerateMipmaps`, with `magFilter: "nearest"`, `minFilter: "linear"` and `mipmapFilter: "linear"` (Pixi v8 `TextureStyle`).
- Sprite edges sit flush in the atlases, so low mips would bleed. Extrude every frame by 2 px in the bake step (`bake:*` scripts) and cap `maxLevel` at 3.
- Water data textures stay `nearest`.

**Pixel snapping:**
- round the camera position to device pixels at zoom ≥ 1;
- set `roundPixels` on structure sprites and movers too.

**Lighting and atmosphere:**
- **Day/night grade:** a `ColorMatrixFilter` on the world render-group root (one full-screen pass), its matrix eased through dawn, day, dusk and night. This replaces the translucent night rect.
- **Lit windows at night:**
  - an emissive sprite per building, baked by masking each building frame's window-coloured pixels at load, added in `structureOf` with `blendMode: "add"`;
  - alpha follows night;
  - one additive container per chunk, to keep batches.
- **Streetlights:** a soft radial glow sprite on road junctions at night, pooled and culled with segments.
- **Grounding:** a soft blurred-ellipse contact shadow under every structure and mover, in the `paved` tier.

## Phase 6: Feel

**Camera** (`utils/viewport-controls.ts`, `world-viewport.tsx`):
- pixi-viewport `decelerate()` for inertia, and a smoothed wheel zoom to the cursor;
- `animate()` for fly-to when a building is selected, or a toast or memo is clicked;
- eased arrow-key panning.

**A tiny tween runner** on the ticker (`world/render/tween.ts`; no library). It holds `{target, prop, from, to, ms, ease}` with `easeOutBack` and `easeOutCubic`.

**Build juice:**
- a new structure drops in, offset 12 px and eased (only when placed, not on load);
- a dust puff of 6–8 pooled particle sprites;
- a tier growth gives a scale pop;
- a sale or an income tick floats money up from the building;
- a demolish crumbles with a puff;
- drone landings flash.
- Hooks: `structures/layer.ts` mount, `stepEvolution` tier changes, and the build actions.

## Phase 7: Sound

- **A Web Audio bus** (`src/audio/`) with master, sfx and ambience gains.
- **Sounds synthesised in code**, so there are no assets to license: click, build thud, pop, coin, demolish crumble.
- **Ambience:** an ambient town hum and birds by day, crickets at night, mixed by population and the time of day.
- **When it starts:** only after the first user gesture.
- **Settings:** volume and mute in the settings UI. They go in the existing settings store, as a new field with its default, so no persisted store is migrated by hand.

## Phase order and commits

| Step | Phase | Notes |
|---|---|---|
| 1 | 0 | measure |
| 2 | 1 | movers |
| 3 | 2 | culling |
| 4 | 3 | per-frame |
| 5 | 4 | water |
| 6 | 5 | fidelity |
| 7 | 6 | feel |
| 8 | 7 | sound |

- Each step is a commit on a new branch, `engine-polish`, from `singularity-overhaul` once that is committed, with its own draft PR.
- Each step is measured before and after with the phase 0 scene, and the numbers go in the commit message.
- README updated per phase, a line each.

## Critical files

- **Render core:** `world/render/bands.ts`, `world/render/camera.ts`, `world/world-scene.tsx` (ticks), `world/world-canvas.tsx`.
- **Movers:** `world/agents/town-render.ts`, `world/boats/boats-render.ts`.
- **Per-frame drawing:** `world/ai/ai-layer.ts`, `world/render/holograms.ts`, `world/structures/project-renderer.ts`, `world/render/daylight.ts`.
- **Atlases:** `world/iso/atlas/load-isometric-atlases.ts`, the `bake:*` scripts.
- **Water:** `world/render/water-gpu.ts`.
- **Camera:** `utils/viewport-controls.ts`, `world/world-viewport.tsx`.
- **HTML labels:** `world/play/building-labels.tsx`.
- **Perf scene:** `world/debug/perf-scene.ts`, `debug/perf-hud.tsx`.
- **New:** `world/render/tween.ts`, `world/render/particles.ts`, `src/audio/*`.

## Verification

- **Perf:** the phase 0 scene before and after each phase, on the isolated server (127.0.0.1:5174, `?nosave`), with the pane visible.
  - **Targets:**
    - 2,000 movers at under 4 ms of js per frame;
    - draw calls at zoom 3 cut by half or more, from horizontal culling;
    - no regression in the water total (still-flood scene) or in `__gpuTime().of.render` after 45 bench frames.
- **Render-group rebuilds:** count rebuilds per frame and keep them at 0 while the camera is still.
- **Visual:**
  - screenshots at the three zooms before and after, checking for no atlas bleed at low mips and no water seams;
  - day/night cycle screenshots;
  - dark mode for any new UI.
- **Tests:** `npx tsc -b`, eslint, full `bun test`. New unit tests for:
  - segment indexing (`segmentOf`, `setVisibleRect`);
  - tween easing and completion;
  - the mover texture key per facing and frame;
  - the audio bus muting without an AudioContext.

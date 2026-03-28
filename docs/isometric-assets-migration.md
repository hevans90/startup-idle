# Isometric assets migration (full plan)

**Goal:** Replace the hand-built 18×18 `blocks.png` atlas with three Starling atlases under [`public/isometric_assets/`](../public/isometric_assets/), refactor projection, loading, and map typing for variable-size tiles.

**Status:** Implemented in the codebase (see [isometric-assets-migration-summary.md](./isometric-assets-migration-summary.md)). The sections below remain the design reference and tuning notes.

## Asset layout

[`public/isometric_assets/`](../public/isometric_assets/) has **three** category folders; each contains a paired atlas. **`TextureAtlas imagePath` matches the on-disk PNG name** (e.g. `building_sheet.png`), so the loader can resolve textures relative to the XML directory without rewriting paths.

| Folder | Files | SubTexture name pattern (examples) |
| ------ | ----- | ------------------------------------ |
| [`buildings/`](../public/isometric_assets/buildings/) | `building_sheet.xml`, `building_sheet.png` | e.g. `buildingTiles_061.png` (pack default names) |
| [`landscape/`](../public/isometric_assets/landscape/) | `landscape_sheet.xml`, `landscape_sheet.png` | e.g. `landscapeTiles_019.png` (pack default names) |
| [`vehicles/`](../public/isometric_assets/vehicles/) | `vehicle_sheet.xml`, `vehicle_sheet.png` | e.g. `ambulance_NE.png`, `carBlack1_000.png` |

Static tile maps will primarily use **buildings** and **landscape**; **vehicles** use the same pipeline when adding traffic or props (can lazy-load that atlas if desired).

## How this differs from current code

| Before (removed) | After (current) |
| ----- | ----- |
| Hand `sprites.ts` + **18×18** `blocks.png` | Starling **SubTexture** rects from three XMLs under `public/isometric_assets`; **variable** sizes |
| `ISO_TILE_STRIDE` in `mapToWorld`, lift, and inverse pick | **`ISO_CELL_STRIDE`** tuned to iso **footprint** of building/landscape tiles; validate visually |
| `TerrainKey` = keyof manual atlas | **`spriteId`** = SubTexture `name` (unique across these packs) + optional short aliases in legend |
| Center anchor + uniform lift | **Per-frame anchor** (e.g. bottom-center) + **z lift** scaled to art |

## XML parsing

Use **[fast-xml-parser](https://www.npmjs.com/package/fast-xml-parser)** (project dependency) instead of `DOMParser`: works the same in browser and Node, and avoids relying on DOM types in shared modules. Use `XMLParser` with options so **`imagePath`** and each **`SubTexture`**’s **`name` / `x` / `y` / `width` / `height`** parse cleanly; normalize a single `SubTexture` vs an array when only one child exists.

## Pixi pipeline

Parse each **Starling XML** (via `fast-xml-parser`) → Pixi [Spritesheet](https://pixijs.com/8.x/guides/components/spritesheets) JSON (`frames` + `meta.size` from the loaded base texture) → `spritesheet.parse()`. Merge frame → `Texture` from all three sheets into one lookup **if** `spriteId` strings stay globally unique (they do today: different prefixes / vehicle names).

## Implementation plan

### 1. Atlas pipeline

- Dependency: `fast-xml-parser` (`bun add fast-xml-parser`).
- Add e.g. [`src/office/atlas/parse-starling-atlas.ts`](../src/office/atlas/parse-starling-atlas.ts): `XMLParser` → read `TextureAtlas` + `SubTexture[]` → Pixi `Spritesheet` data per file (normalize one vs many `SubTexture` nodes).
- For each category: load XML (`fetch` or `?raw`), `Assets.load('/isometric_assets/<cat>/<name>_sheet.png')`, build `Spritesheet`, `parse()`, then merge into a **`Record<string, Texture>`** keyed by SubTexture `name`.
- **Base URL:** resolve PNG as sibling of XML (same folder); `imagePath` matches the filename.

### 2. Types and map data

- [`TileInstance`](../src/office/map/types.ts): **`spriteId`** (SubTexture name) + [`legend.txt`](../src/office/map/tilemaps/default/legend.txt) ASCII → `spriteId`.
- Update [`parse-tilemap-text.ts`](../src/office/map/parse-tilemap-text.ts) and layer files for SubTexture names; point [`legend.txt`](../src/office/map/tilemaps/default/legend.txt) at the `name` values you want from each `*_sheet.xml`.

### 3. Math / rendering

- [`math-utils.ts`](../src/office/math-utils.ts): **`ISO_TILE_WIDTH` / `ISO_TILE_HEIGHT`** (132×99 for current sheets) drive **`ISO_CELL_STRIDE`** and **`ISO_Z_LIFT_PER_LAYER`**; re-validate pick/plane if the pack changes.
- [`office.tsx`](../src/office/office.tsx): textures from merged atlas lookup; anchors and **scale** tuned; `nearest` filtering.

### 4. Remove legacy art

- **Done:** removed `public/images/blocks.png` and `src/office/sprites.ts`.
- **Done:** updated [rendering.md](./rendering.md), [isometric-map-format.md](./isometric-map-format.md), and [`tilemaps/default/README.md`](../src/office/map/tilemaps/default/README.md) for `public/isometric_assets` and `spriteId`.

### 5. Verification

- `bun run build`; smoke-test viewport + hover.

## Risks / follow-up

- Stride and anchors stay **tunable**; document constants in `docs/rendering.md`.
- Tall sprites may need **depth** refinements (foot-based sort).
- If a future pack reuses the same SubTexture `name` in two XMLs, introduce a **namespaced** `spriteId` or per-atlas disambiguation in the legend.

## Related

- Short checklist: [isometric-assets-migration-summary.md](./isometric-assets-migration-summary.md)

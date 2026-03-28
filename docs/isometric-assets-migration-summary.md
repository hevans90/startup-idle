# Isometric assets migration — summary

One-page overview. Full detail: [isometric-assets-migration.md](./isometric-assets-migration.md).

## Status

**Implemented:** Starling atlases under [`public/isometric_assets/`](../public/isometric_assets/), `fast-xml-parser`, `TileInstance.spriteId`, `ISO_CELL_STRIDE`, merged Pixi textures in [`office.tsx`](../src/office/office.tsx). Legacy `public/images/blocks.png` and `src/office/sprites.ts` removed.

- **Buildings** — [`building_sheet.xml`](../public/isometric_assets/buildings/building_sheet.xml) / [`building_sheet.png`](../public/isometric_assets/buildings/building_sheet.png) — original pack SubTexture names (`buildingTiles_*.png`, …)
- **Landscape** — [`landscape_sheet.xml`](../public/isometric_assets/landscape/landscape_sheet.xml) / [`landscape_sheet.png`](../public/isometric_assets/landscape/landscape_sheet.png) — original pack names (`landscapeTiles_*.png`, …)
- **Vehicles** — [`vehicle_sheet.xml`](../public/isometric_assets/vehicles/vehicle_sheet.xml) / [`vehicle_sheet.png`](../public/isometric_assets/vehicles/vehicle_sheet.png) — directional vehicle sprites

## Workstream (done)

1. **Parser + load** — [fast-xml-parser](https://www.npmjs.com/package/fast-xml-parser); Starling XML → Pixi `Spritesheet` per atlas; load from `/isometric_assets/{buildings,landscape,vehicles}/`; merge textures by SubTexture name; [`load-isometric-atlases.ts`](../src/office/atlas/load-isometric-atlases.ts).
2. **Map types** — `TileInstance.spriteId` + [`legend.txt`](../src/office/map/tilemaps/default/legend.txt) / layers / [`parse-tilemap-text.ts`](../src/office/map/parse-tilemap-text.ts).
3. **Math** — [`ISO_CELL_STRIDE`](../src/office/math-utils.ts) replaces `ISO_TILE_STRIDE`; pick/plane and z lift; bottom-center sprite anchor in `office.tsx`.
4. **Cleanup** — `blocks.png` and hand atlas table removed; `docs/rendering.md`, `docs/isometric-map-format.md`, tilemap README updated.
5. **Verify** — Run `bun run build` and smoke-test viewport + hover after changes.

## Checklist

- [x] **starling-parser** — `fast-xml-parser` + parse Starling XML → Pixi Spritesheet; load buildings + landscape + vehicle atlases from `public/isometric_assets`
- [x] **grid-math** — Calibrated `ISO_CELL_STRIDE`; pick/plane offsets and z lift
- [x] **tile-types-legend** — `spriteId` on tiles; [`legend.txt`](../src/office/map/tilemaps/default/legend.txt) maps symbols to SubTexture names you choose
- [x] **remove-blocks** — Remove `blocks.png` / old `sprites.ts`; update docs

## Follow-ups (optional)

- Lazy-load the **vehicles** atlas if startup cost matters.
- Tune `ISO_CELL_STRIDE` and world `scale` per art pack; see [isometric-assets-migration.md](./isometric-assets-migration.md) risks.

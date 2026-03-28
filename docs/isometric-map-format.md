# Isometric map data: formats and tools

## What this repo uses: layered ASCII (`*.txt`)

Maps live under [`src/office/map/tilemaps/default/`](../src/office/map/tilemaps/default/):

- **`legend.txt`** — maps **one character** → **`spriteId`**: the exact SubTexture `name` from [`landscape_sheet.xml`](../public/isometric_assets/landscape/landscape_sheet.xml) / [`building_sheet.xml`](../public/isometric_assets/buildings/building_sheet.xml) (pack filenames such as `landscapeTiles_019.png`, `buildingTiles_061.png`). Pick tiles by opening the sheet PNG or XML and editing this file by hand.
- **`layer-0-ground.txt`** — **z = 0**, one character per cell, **no spaces** (fully dense).
- **`layer-1.txt`**, **`layer-2.txt`**, … — higher **z**; **space** means “no tile at this elevation”.

Rows are **mapY** from top to bottom; columns within a row are **mapX** left to right. In a monospace editor the grid **looks like the map**, which is the main reason to prefer this over JSON arrays.

**Overlay layers (z > 0)** are **fitted** to layer 0’s width and height: short lines are padded on the right with spaces, long lines are truncated, extra lines are dropped, and missing rows count as blank. Layer 0 stays strict (uniform dense grid).

The loader is [`parse-tilemap-text.ts`](../src/office/map/parse-tilemap-text.ts); [`build-office-map.ts`](../src/office/map/build-office-map.ts) bundles the default folder via Vite `?raw` imports.

## What other engines and Pixi examples often use

| Approach | Visual editing | Notes |
|----------|----------------|--------|
| **[Tiled Map Editor](https://www.mapeditor.org/)** | Yes (dedicated UI) | **Most common** for tile games. Exports **JSON** (`.tmj`) or XML (`.tmx`). Orientation can be **isometric**. Pixi projects often load Tiled JSON and place sprites or use [`@pixi/tilemap`](https://www.npmjs.com/package/@pixi/tilemap) for batched quads. The file on disk is not “readable as a picture,” but the editor is. |
| **CSV / numeric grids** | Weak in plain text | Simple `0,1,2` per cell; hard to scan visually without a separate tool. |
| **Plain JSON 2D arrays** | Weak | Same as CSV for author experience unless generated from an editor. |
| **LDtk, Ogmo, etc.** | Yes | Similar role to Tiled; export JSON for runtime. |
| **ASCII / roguelike maps** | Strong in `vim`/VS Code | Same idea as our `layer-*.txt`; popular in 7DRL-style codebases. |

**Pixi-specific:** there is no single official “Pixi map format.” Typical pattern is **Tiled JSON → your loader → `Container` / `Sprite` / `@pixi/tilemap`**. Community examples (e.g. isometric demos) usually either hard-code positions or load Tiled.

## When to add Tiled

Consider a Tiled → `TileInstance[]` (or direct Pixi) pipeline if you need:

- Large maps, tile animations, object layers, or collision polylines.
- Non-programmer authoring.
- Per-tile custom properties.

Until then, **ASCII layers + `legend.txt`** keep the map diff-friendly and visible in Git and the editor.

## Related

- [rendering.md](./rendering.md) — Pixi draw order and hover.
- [`tilemaps/default/README.md`](../src/office/map/tilemaps/default/README.md) — short editing checklist.

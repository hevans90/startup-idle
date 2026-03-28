# Startup Idle — documentation for builders and agents

This folder describes how the app is structured, how game state moves through the system, and how to extend it safely. Read order:

| Document | Purpose |
|----------|---------|
| [architecture.md](./architecture.md) | Layers, runtime flow, store dependency graph, UI composition |
| [domain-model.md](./domain-model.md) | Generators, money, innovation, upgrades — formulas and extension points |
| [persistence.md](./persistence.md) | `localStorage` keys, Zustand persist, version resets |
| [rendering.md](./rendering.md) | React layout (desktop vs mobile), Pixi office, isometric tilemap + stacking |
| [isometric-map-format.md](./isometric-map-format.md) | ASCII layer tilemaps vs Tiled / JSON; editing `tilemaps/default/*.txt` |
| [isometric-assets-migration.md](./isometric-assets-migration.md) | Plan: Starling atlases in `public/isometric_assets`, Pixi, `spriteId`, retire `blocks.png` |
| [isometric-assets-migration-summary.md](./isometric-assets-migration-summary.md) | Short checklist + workstream for that migration |
| [stores-reference.md](./stores-reference.md) | One-page summary of each Zustand store’s responsibilities |
| [agent-guide.md](./agent-guide.md) | Conventions, checklists, and recipes for common feature work |

**Quick facts:** Vite 6 + React 19 + TypeScript, Tailwind v4, Zustand, Pixi 8 + `@pixi/react`, `pixi-viewport`. Large numbers use `break_infinity.js` (`Decimal`).

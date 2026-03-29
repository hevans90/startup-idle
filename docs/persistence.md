# Persistence and versioning

## localStorage keys

All gameplay saves go through **Zustand `persist`** (`createJSONStorage` + `partialize`). Keys below are the persist `name` for each store (zustand wraps values as `{ state, version }` unless noted).

| Key | Store | Contents (persisted slice) |
|-----|--------|----------------------------|
| `money` | `money.store.ts` | `{ money }` as serialized `Decimal` |
| `generators` | `generators.store.ts` | `{ generators, employeeManagement }` |
| `innovation` | `innovation.store.ts` | Innovation + managers + unlocks (see store `partialize`) |
| `valuation` | `valuation.store.ts` | Valuation balance + mandate levels |
| `unlockedUpgrades` | `upgrades.store.ts` | `{ unlockedUpgradeIds }` |
| `global-settings` | `global-settings.store.ts` | `{ sidebarTab }` |
| `theme` | `theme.store.ts` | `{ theme }` |
| `game_version` | `version.store.ts` | Last seen app version string |

`availableUpgrades` is **derived** and not stored; it is recomputed via `syncAvailableUpgrades`.

### Legacy migration (no separate keys in new saves)

- **Money:** Older saves used a plain decimal string under `money`. A custom `StateStorage` adapter rewrites that into the zustand persist shape on first read.
- **Generators:** Older saves used a raw JSON **array** under `generators` and optionally `employeeManagement` as a second key. `generatorStateStorage` merges both into one persist blob on read. The orphan `employeeManagement` key is removed on full **Reset**.
- **Upgrades:** Older saves used a raw JSON **array of ids** under `unlockedUpgrades`. `upgradesLegacyStorage` wraps that into the persist shape on read.

## Decimal serialization

`innovation.store.ts`, `valuation.store.ts`, and `money.store.ts` use `createJSONStorage` with `decimalReplacer` / `decimalReviver` from `_break_infinity.decimals.ts` where `Decimal` fields are persisted.

## Version migration

`CURRENT_VERSION` lives in `version.store.ts`. `useCompareVersion` (`hooks/use-compare-version.ts`) runs once on mount:

1. If stored major/minor differs from `CURRENT_VERSION`, `clearAllStorageExceptVersion` clears **all** `localStorage` then restores `game_version`.
2. Sets stored version to `CURRENT_VERSION`.

So **patch-only** version bumps may preserve saves (same major.minor); **minor or major** bumps wipe progress except the version key.

`clearAllStorageExceptVersion` in `version.store.ts` intentionally uses `localStorage.clear()`; that is not a per-store write path.

**Implication for agents:** bumping `CURRENT_VERSION` minor/major is a breaking save reset for players. Document in changelog or bump only patch if you need compatibility.

## Reset game

`ResetButton` calls `reset` on: `useGeneratorStore`, `useMoneyStore`, `useUpgradeStore`, `useInnovationStore`, `useValuationStore`. It does **not** reset theme, global settings, or version.

## Automated progression checks

`bun test` runs [`src/simulation/progression-sim.test.ts`](../src/simulation/progression-sim.test.ts): store-backed time simulation (Jest-compatible fake timers from `bun:test`) plus pure catalog pacing checks. Preload [`src/test/preload.ts`](../src/test/preload.ts) installs an in-memory `localStorage` before stores load.

## Related docs

- [domain-model.md](./domain-model.md) — what each store represents
- [agent-guide.md](./agent-guide.md) — checklist when adding persisted fields

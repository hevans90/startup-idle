# Persistence and versioning

## localStorage keys

| Key | Written by | Contents |
|-----|------------|----------|
| `money` | `money.store.ts` | Stringified `Decimal` |
| `generators` | `generators.store.ts` | JSON array of owned generators |
| `innovation` | Zustand persist (`innovation.store.ts`) | Innovation + managers + unlocks + partial state (see store `partialize`) |
| `unlockedUpgrades` | `upgrades.store.ts` | JSON array of upgrade **ids** |
| `global-settings` | Zustand persist (`global-settings.store.ts`) | `{ sidebarTab }` |
| `theme` | Zustand persist (`theme.store.ts`) | `"light"` \| `"dark"` |
| `game_version` | Zustand persist (`version.store.ts`) | Last seen app version string |

`availableUpgrades` is **derived** and not stored; it is recomputed via `syncAvailableUpgrades`.

## Decimal serialization

`innovation.store.ts` uses `createJSONStorage` with `decimalReplacer` / `decimalReviver` from `_break_infinity.decimals.ts` so nested `Decimal` values round-trip correctly.

Money does **not** use that middleware; it stores `money.toString()` and reloads with `new Decimal(saved)`.

## Version migration

`CURRENT_VERSION` lives in `version.store.ts`. `useCompareVersion` (`hooks/use-compare-version.ts`) runs once on mount:

1. If stored major/minor differs from `CURRENT_VERSION`, `clearAllStorageExceptVersion` clears **all** `localStorage` then restores `game_version`.
2. Sets stored version to `CURRENT_VERSION`.

So **patch-only** version bumps may preserve saves (same major.minor); **minor or major** bumps wipe progress except the version key.

**Implication for agents:** bumping `CURRENT_VERSION` minor/major is a breaking save reset for players. Document in changelog or bump only patch if you need compatibility.

## Reset game

`ResetButton` calls `reset` on: `useGeneratorStore`, `useMoneyStore`, `useUpgradeStore`, `useInnovationStore`. It does **not** reset theme, global settings, or version.

## Related docs

- [domain-model.md](./domain-model.md) — what each store represents
- [agent-guide.md](./agent-guide.md) — checklist when adding persisted fields

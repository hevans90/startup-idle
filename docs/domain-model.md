# Domain model and game mechanics

This document is the **source of truth for game logic** as implemented in code. When balancing or adding content, start here and then open the cited files.

## Currencies

| Currency | Store | Role |
|----------|--------|------|
| Money | `money.store.ts` | Primary spend for generators and upgrades; passive income from generators |
| Innovation | `innovation.store.ts` | Secondary resource; unlocks innovation UI features; spent on managers |
| Valuation | `valuation.store.ts` | Passive accrual from revenue (scaled by Sales manager); spent on board mandates |

Money uses `break_infinity.js` `Decimal` with manual `localStorage` sync on change. Innovation and valuation use Zustand `persist` with custom JSON replacer/reviver for `Decimal` (`_break_infinity.decimals.ts`).

## Generators

**Definition table:** `GENERATOR_TYPES` in `generators.store.ts`.

Each generator has:

- `baseProduction`, `interval` (ms), `cost`, `costExponent`
- `innovationProduction` (small per-tick contribution to innovation)
- Optional `unlockConditions` (requires N of another generator type)

**Owned state** (`OwnedGenerator`): `amount`, `lastTick`, `multiplier`, `costMultiplier`, `costExponent` (can diverge from base via upgrades), `innovationMultiplier`.

### Unlocking generator types

`getUnlockedGeneratorIds` in `generator-utils.ts` walks `GENERATOR_TYPES` and includes a type if it has no conditions or all conditions are satisfied by **current owned amounts**. `syncUnlockedGenerators` in `generators.store.ts` appends newly eligible types to state after ticks and purchases.

### Purchase cost

`getGeneratorCost(id, amount)` in `generator-utils.ts` implements a geometric-series style total for buying `amount` additional units, using current `cost`, `costExponent`, `costMultiplier`, and `amount`. The result is multiplied by **employee management** cost discount (`getEmployeeCostMult` from `generators.store.ts`). `getMaxAffordableAmountAndCost` divides effective money by the same factor so affordability matches.

`useGeneratorPurchase` (`use-purchase-generator.ts`) resolves single vs max purchase using `purchaseMode` and `getMaxAffordableAmountAndCost`.

### Production tick — `tickGenerators`

- **Global gate:** runs meaningful work when `now - globalLastTick >= 1000` (1 second), then updates `globalLastTick`. Elapsed time is capped at **7 days** per tick for catch-up (`MAX_CATCH_UP_MS`).
- **Per generator with `amount > 0`:**  
  `ticks = floor(globalTickInterval / gen.interval)` (typically 1 when intervals are 1000 ms).
- **Composed multipliers** (see `economy-multipliers.ts`):
  - `getMultiplier()` from innovation (log10 stockpile) — **money only**
  - `getManagerEconomyMultipliers()` — active after **managers** unlock: **Agile** scales innovation from generators, **Corpo** scales money from generators, **Sales** scales passive **valuation** gain (below)
  - `getValuationEconomyMultipliers()` — permanent **board mandate** bonuses on money and innovation from generators
  - Per-generator **employee management** output multipliers and cost discount (see below)
- **Money income (per gen):**  
  `baseProduction * getMultiplier() * managerEmployeeMoney * boardMoney * amount * gen.multiplier * employeeMoneyPerkMult * ticks`
- **Innovation income (per gen):**  
  `innovationProduction * amount * gen.innovationMultiplier * managerInnovationIncome * boardInnovation * employeeInnovationPerkMult * ticks`
- **Valuation income (once per tick, not per generator):**  
  `max(1, mps) ^ 0.38 * 4e-5 * (elapsedSeconds) * salesValuationManagerMult` added via `useValuationStore.increaseValuation`, where `mps` is `getMoneyPerSecond()` after the generator income pass.
- **Auto-buy:** After income, fractional purchases per generator from **auto** employee perks (rate × seconds); calls `purchaseGenerator` logic with `getGeneratorCost`, then `syncUnlockedGenerators` / `syncAvailableUpgrades`.
- After applying income, persists generators and employee-management autosave state, calls `syncUnlockedGenerators()` and `syncAvailableUpgrades()`.

```mermaid
sequenceDiagram
  participant App
  participant Gen as generators.store
  participant Money as money.store
  participant Inn as innovation.store
  participant Val as valuation.store
  participant Up as upgrades.store

  App->>Gen: tickGenerators (each ~16ms)
  Gen->>Gen: if < 1000ms since globalLastTick then return
  Gen->>Inn: getMultiplier + manager + board mults
  loop each owned generator
    Gen->>Money: increaseMoney(income)
    Gen->>Inn: increaseInnovation(innovIncome)
  end
  Gen->>Gen: autoBuy + syncUnlockedGenerators
  Gen->>Up: syncAvailableUpgrades
  Gen->>Val: increaseValuation from mps * sales mult
```

### Display rate — `getMoneyPerSecond` / `getInnovationPerSecond`

These aggregate per-generator contributions using the **same factors as the tick** (innovation log mult, manager mults, board mults, employee output perks), normalized by `(interval / 1000)` to express “per second”.

### Employee management (`employeeManagement` in `generators.store.ts`)

Unlocked with **employee management** innovation unlock. **Budget** = sum of **floored manager tiers** across Agile, Corpo, and Sales (`getManagementTierTotal`). **Spent** points are stored; **available** = `max(0, totalTiers - spent)`.

Per generator id, perks track levels for:

- **Money / innovation output:** additive `+4%` per level to that generator’s money or innovation contribution (capped at 25 / 25).
- **Cost:** each level multiplies purchase cost by `0.985` (stacked).
- **Auto-buy:** each level adds `0.035` “generators per second” of fractional auto-purchase when cash allows (capped at 5 levels).

Purchase costs scale with branch and current level (`employeePerkPurchaseCost` in `generators.store.ts`). State persists under localStorage key `employeeManagement`.

## Upgrades

**Catalog:** `UPGRADES` in `upgrades.store.ts` (grouped as `INTERN_UPGRADES`, `VIBE_CODER_UPGRADES`, `TEN_X_ENGINEER_UPGRADES`).

Each upgrade has:

- `unlockConditions` (generator counts)
- `cost` (plain number; compared with `money.toNumber()` on unlock)
- `effects`: list of `{ genId, changes[] }` where `changes` are `multiplier`, `costMultiplier`, or `costExponent` deltas

`syncAvailableUpgrades` builds `availableUpgrades`: conditions met, not already in `unlockedUpgrades`, sorted by `cost`.

`unlockUpgrade(id)` spends money, runs `applyUpgradeEffect` (mutates matching generators’ multipliers / cost fields), persists upgrade IDs in `localStorage`, refreshes available list.

```mermaid
flowchart LR
  A["Generator counts"] --> S["syncAvailableUpgrades"]
  S --> AV["availableUpgrades"]
  U["User buys"] --> UN["unlockUpgrade"]
  UN --> E["applyUpgradeEffect"]
  E --> G["generators in store"]
```

## Innovation layer

### Global multiplier

`getMultiplier(): log10(innovation + 1) + 1` — scales **money** production from generators (see tick formula).

### Unlocks

`unlocks` record (e.g. `managers`, `employeeManagement`) with `cost` in innovation; `unlock` spends innovation and sets `unlocked: true`.

### Managers (`agile`, `corpo`, `sales`)

Each manager track has assignment count, progress toward tier, tier, growth parameters, and a **bonus multiplier** that scales with tier.

- **Tick:** `tickManagers` runs when `now - globalLastTick >= 200` ms (`MANGER_TICK_INTERVAL`), then updates `globalLastTick` on the innovation store.
- **Progress gain:** assignment × growthRate × ticks / tierModifier; at threshold (100), tier increments and progress wraps.
- **Bonus:** `bonusMultiplier = bonusMultiplierGrowthPerTier ^ tier` (per-track growth constants in `initialManagerState`).

**Effect wiring** (after **managers** unlock; see `getManagerEconomyMultipliers` in `economy-multipliers.ts`):

| Track | Multiplier applies to |
|-------|------------------------|
| Agile | Innovation IPS from generators |
| Corpo | Money from generators |
| Sales | Passive valuation gain (not direct money) |

Assign / unassign uses geometric cost sums with base cost 1 and growth 1.5 (`getManagerCost`, `getManagerRefund`, `assignManager`, `unassignManager`).

### Valuation and board mandates (`valuation.store.ts`)

- **Accrual:** Driven from `tickGenerators` using current **money per second** and the **Sales** manager multiplier (see production tick).
- **Spend:** `MANDATES` catalog — each mandate has levels, scaling **valuation** cost, and adds additive global bonuses to **money** and/or **innovation** from employees (`getEconomyMultipliers`).

## Manual money click

Both layouts: clicking the money display calls `increaseMoney(max(mps/10, 1))` where `mps` is `getMoneyPerSecond()`.

## Extension points (content and systems)

| Goal | Primary touch points |
|------|----------------------|
| New generator type | `GENERATOR_TYPES`, `GeneratorId` type, sprites/UI labels if needed |
| New upgrade | `UPGRADES` entry; ensure `syncAvailableUpgrades` still runs after relevant state changes |
| New currency | New store + wire into tick/purchase; consider persist pattern like innovation |
| Change tick rate | `App.tsx` interval; **and** gates inside `tickGenerators` / `tickManagers` |
| New sidebar tab | `SidebarTab` in `global-settings.store.ts`, `sidebar.tsx` tabs config |

## Related docs

- [persistence.md](./persistence.md) — which fields persist
- [architecture.md](./architecture.md) — who calls ticks and when

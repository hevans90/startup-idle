# Employee satisfaction (revised — per-type effects)

## Unlock and core state

- **Unlock:** Same as before: active when `unlocks.employeeManagement` is purchased ([`innovation.store`](src/state/innovation.store.ts)).
- **State:** Three satisfaction scores **−100…100**, one per [`GeneratorId`](src/state/generators.store.ts), persisted with the generator blob (or adjacent structure in [`generators.store.ts`](src/state/generators.store.ts)).
- **Dynamics:** Keep a single shared model (targets from headcount + that role’s employee perks, smooth step toward target each tick) unless you later want different decay per role. Constants live in e.g. [`src/game/satisfaction.ts`](src/game/satisfaction.ts).

---

## Per-type effects (replaces uniform $/IPS row multipliers)

### Intern

| Satisfaction | Effects |
|----------------|----------|
| **High** | **Small global IPS multiplier** on all generator innovation income (same stack position as manager/valuation IPS — apply in [`tickGenerators`](src/state/generators.store.ts) on `innovationIncome` and in [`getInnovationPerSecond`](src/state/generators.store.ts)). **Small positive multiplier** on **manager tier progress accrual** (multiply `gain` in [`tickManagers`](src/state/innovation.store.ts) for all three tracks, or apply once to `gain` before `newProgress`). |
| **Low** | **Large negative multiplier** on **valuation gain** (the `increaseValuation` path in [`tickGenerators`](src/state/generators.store.ts) — scale the computed gain, can go below 1× strongly; floor at 0 if you want no negative valuation). **Large negative multiplier** on **manager tier accrual rate** (same `gain` path as above, opposite sign from high). |

**Implementation note:** Manager tick lives in `innovation.store`; satisfaction lives in `generators.store`. Use `getInternSatisfactionManagerAccrualMult()` / valuation mult readers in `generators` or `satisfaction.ts` that read generator state without circular imports (extract pure functions + pass scores). **Floor manager `gain` at 0** after mult so low intern morale slows tiers but does not run progress backward.

### Vibe coder

| Satisfaction | Effects |
|----------------|----------|
| **High** | **None** (explicitly no bonus). |
| **Low (negative)** | **New mechanic — AI singularity:** accrue a **stored value** over time at a rate scaled by how negative vibe satisfaction is (e.g. rate ∝ `max(0, -score)`). **No effect on economy yet** (no mults). **UI:** readout in **bottom-left** of the office wrapper ([`App.tsx`](src/App.tsx) same pattern as version `bottom-2 left-2`, avoid overlap — e.g. `bottom-2 left-2` stack vertical or singularity above version). Label e.g. **“AI SINGULARITY”** + numeric or bar. |

**New store:** Small persisted slice recommended, e.g. [`src/state/ai-singularity.store.ts`](src/state/ai-singularity.store.ts) with `value` (number or Decimal) and tick/accrue from game loop (same ~16ms interval that calls `tickManagers` / `tickGenerators`, or inside `tickGenerators` after other logic). Reset on full game reset ([`reset-game-stores`](src/simulation/reset-game-stores.ts)).

### 10x dev

| Satisfaction | Effects |
|----------------|----------|
| **High** | **Decrease effective hire cost exponent** for **only** `10x_dev` (negative delta applied on top of upgraded `costExponent` — implement in [`getGeneratorCost`](src/utils/generator-utils.ts) / shared helper so all purchases and displays stay consistent). Respect existing [`MIN_GENERATOR_COST_EXPONENT`](src/state/generators.store.ts) floor after applying mood delta. |
| **Low** | **Increase effective cost exponent** (large penalty), same hook. |

Do **not** persist the mood delta as a mutation to `OwnedGenerator.costExponent`; treat as **runtime effective exponent** = `storedExponent + f(score)` so upgrades and saves stay canonical.

---

## UI summary

| Location | Content |
|----------|---------|
| **Bottom-right** (prior plan) | Satisfaction **bars per employee type** (−100…100), only when employee management unlocked. |
| **Bottom-left** | **AI SINGULARITY** meter/value when vibe satisfaction is negative (accrual active); can show 0 or hide bar when non-accrual if you prefer cleaner UI. |

---

## Manual treasury tap

- Prior plan used MPS-weighted satisfaction for clicks. **With intern-only global IPS / valuation / manager effects,** intern satisfaction no longer scales row $ directly. **Options:** (a) leave click unscaled, or (b) apply a small **intern-only** $ multiplier if you still want “feel” on taps — **default in plan: no change to tap** unless you add an explicit intern revenue nudge later.

---

## Testing and reset

- Pure tests: `score →` intern valuation mult, manager mult, IPS mult, 10x exponent delta, vibe accrual rate (piecewise).
- `resetAllGameStores`: clear satisfaction scores + singularity value + persist keys for new store.

---

## Implementation order (suggested)

1. [`satisfaction.ts`](src/game/satisfaction.ts) — curves per type (intern IPS / manager / valuation, vibe accrual rate, 10x exponent offset).
2. [`generators.store`](src/state/generators.store.ts) — scores + tick step + apply intern IPS + valuation in `tickGenerators` / getters.
3. [`innovation.store`](src/state/innovation.store.ts) — multiply manager `gain` by intern satisfaction mult (inject via imported getter to avoid store cycles).
4. [`generator-utils.ts`](src/utils/generator-utils.ts) — effective `10x_dev` exponent from satisfaction.
5. [`ai-singularity.store.ts`](src/state/ai-singularity.store.ts) + tick + bottom-left overlay.
6. [`employee-satisfaction-overlay.tsx`](src/molecules/employee-satisfaction-overlay.tsx) bottom-right + [`App.tsx`](src/App.tsx) wiring.

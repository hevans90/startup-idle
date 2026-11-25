# The Still

Juice is a liquid in a glass still on the Vape shop tab. Spending it is pouring it. No timing, no reflexes.

- **The flask** holds your juice, its number on it. An achievement's juice runs in by the tap at its top.
- **Pour:** hold a vessel's valve. A part-filled vessel keeps what it has; full, its bonus is on and the one below opens.
- **Drain:** pick a vessel and hold Drain: all its juice goes back, its bonus off. What is below it first.
- **Competing:** five branches of five, 17,480 juice in all; every achievement together pays 8,756.
- Every vessel says what it holds of what it takes; the one being poured, how much a second. Each branch says what it
  comes to.

## How it is made

- `game/achievements.juice-shop.ts` — the tree, and when one may be poured or drained. Bonuses come from full vessels.
- `state/vape-achievements.store.ts` — `juiceFills`; whole juice moved by `pourJuice` / `drainJuice`. Old saves: what
  was bought is full.
- `molecules/still/glassware.ts` — the glass as one distance field, and which place each cell is.
- `molecules/still/still-gpu.ts` — the liquid: up to 28,000 particles. It follows the store: a gate opens while its
  vessel is short. A vessel at rest is not stepped; all at rest, nothing runs.
- `molecules/still/still-panel.tsx` — valves and amounts.

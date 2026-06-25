# Startup Idle

A satirical incremental/idle game about scaling a tech startup by any means necessary — hire interns, unleash vibe coders, anoint 10x devs, and watch an isometric city grow as your headcount does. Built as a single-page React app with a PixiJS-rendered city.

## Gameplay

You found a startup as one of several **founder archetypes**, each bending a different progression curve, then grow the company through interlocking systems:

- **Employees (generators)** — three roles (`intern`, `vibe_coder`, `10x_dev`) that produce money and innovation each tick. Hire more and buy **upgrades** to scale output.
- **Innovation** — a soft global multiplier (`1 + logMult · log₁₀(innovation+1)`) on all output, plus the currency for **managers** and unlocks.
- **Managers** — auto-tiering multipliers for money / innovation / valuation; assign them and they progress on their own.
- **Valuation & board mandates** — valuation accrues from revenue; spend it on permanent global mandates.
- **Employee management & satisfaction** — perks (money/innovation/cost/auto-buy) and a morale system that drifts each tick and feeds back into output.
- **Vape shop** — 53 achievements across all game systems earn *vape juice*; spend it on 12 impactful upgrades (money output, innovation, valuation rate, hire cost reduction, equity payout) that visibly modify a high-def SVG vape rendered as a compact overlay on the map canvas (bottom-left). Achievements and upgrades persist through prestige resets. Version `0.2.0` bumped the upgrade roster; returning players' vape progress resets on load.
- **AI singularity** — an ominous meter that creeps up when vibe coders are miserable.
- **Founders** — six archetypes (Hacker, Bootstrapper, Operator, Visionary, Hustler, Agentic Delusionist) with gradual, compounding passive modifiers and a small starting-cash float. Chosen on a full-screen select before the game begins.
- **Offline progression** — on return, the real game tick is replayed in chunks over the time away (full credit, capped at 2 days), with a "while you were away" popup.
- **Company Acquisition (prestige)** — once you've built enough *total accrued valuation*, accept an acquisition offer to bank permanent **Equity** (diminishing-returns payout), soft-reset into a fresh company (re-picking a founder; Equity, skill tree and board mandates persist), and spend Equity in a Path-of-Exile-style **skill tree** (~330 procedurally-laid-out nodes across themed clusters with standalone keystones, rendered on its own PixiJS viewport — verified overlap-free, light/dark themed). Costs escalate per node allocated; hovering previews the cheapest route (with total cost) and a click allocates the whole route at once; the tree is **respeccable** (Exits buy persistent respec points; one click refunds a node and its dependents). Includes fuzzy node **search** and hover-to-spotlight from the allocated-bonuses panel. The full loop — accrual tracking, payout, soft reset, allocation, respec, persistence — is in, and node **effects are wired to the economy**: every allocated grant resolves (`resolvePrestigeModifiers`) into multipliers applied at the same chokepoints as the founder modifiers (money, innovation, valuation, employee output, headcount synergy, automation, manager speed, hire cost, singularity, satisfaction-gain rate, Equity payout). **All keystones are fully implemented**, including their structural reshapes — Bootstrapped disables managers & auto-buy, Crunch Mode switches satisfaction off, Enshittify halves positive satisfaction bonuses, AGI-Pilled cripples interns, Permanent Acqui-hire grants free starting intern levels — each surfaced in the relevant UI (see `docs/acquisition-skill-tree-design.md`).
- **Isometric city** — a PixiJS + pixi-viewport scene that visualizes each district's headcount as growing building stacks, with hover highlighting and HTML info popovers.

## Tech stack

- **React 19** + **TypeScript** (Vite, SWC)
- **Tailwind CSS v4**
- **Zustand** for state (with `persist` to `localStorage`)
- **@pixi/react v8** + **PixiJS v8** + **pixi-viewport** for the isometric city
- **break_infinity.js** for large-number math (`Decimal`)
- **Bun** as the runtime / test runner

## Getting started

```bash
bun install
bun run dev        # Vite dev server (HMR)
```

Then open the printed local URL.

### Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Vite dev server with HMR |
| `bun run build` | Type-check (`tsc -b`) then production build |
| `bun run typecheck` | `tsc -b` (the solution build — a bare `tsc --noEmit` is a no-op here) |
| `bun test` | Run the test suite |
| `bun run lint` | ESLint |
| `bun run preview` | Preview the production build |

## Project structure

```
src/
  App.tsx              # Root: founder gate, layout, game loop, offline check
  main.tsx             # Entry point
  state/               # Zustand stores (one per system), all persisted
  game/                # Pure game logic: catalogs, economy multipliers,
                       #   satisfaction, achievements, offline-progress, skill-tree
  molecules/skill-tree/# PixiJS prestige skill-tree renderer + overlay
  molecules/           # Composite UI (toolbar, sidebar, popovers, counters…)
  ui/                  # Reusable primitives (Button, Popover, ResourceCounter…)
  office/              # Isometric PixiJS city renderer
    office.tsx         #   render tree (ground/road/building layers)
    viewport.tsx       #   pixi-viewport (pan/zoom)
    math-utils.ts      #   iso projection + depth-sort keys
    city/              #   scene computation, building kits, world gen
    atlas/             #   sprite-atlas loading
  simulation/          # Headless sims + reset helpers (used by tests)
  hooks/  utils/  icons/  assets/
```

## Architecture notes

- **State & persistence.** Each system is a Zustand store under `src/state`, persisted to `localStorage` via the `persist` middleware. Large numbers are `break_infinity.js` `Decimal`s serialized via `decimalReplacer`/`decimalReviver` (see `state/_break_infinity.decimals.ts`); store `merge` functions use `coerceDecimal` to defensively re-hydrate any legacy/foreign shape so a malformed save can't crash on first render.
- **Version wipe.** `state/version.store.ts` holds `CURRENT_VERSION`; bumping the major or minor triggers a full progress wipe (storage + in-memory) on next load via `useCompareVersion`. Use this for breaking changes.
- **The game loop** runs in `App.tsx` (a `setInterval`), ticking generators and managers. Stores expose per-second getters (`getMoneyPerSecond`, `getInnovationPerSecond`, `getValuationPerSecond`) that mirror the tick's multiplier chains, so displayed rates match actual earnings.
- **Isometric renderer.** Buildings are derived deterministically from headcount (`office/city/compute-city.ts`) and drawn into depth-sorted Pixi containers (`cityDepthKey`, column-dominant). Heights are monotonic in count to avoid "floor stealing."

## Dev tools

- A **building-kit labeller** (dev-only) authors `building-kits.json` / `road-labels.json` for the city renderer. ⚠️ These files hold hand-authored data — never overwrite them programmatically (e.g. via preview eval).
- Some dev affordances (e.g. "grant juice") are gated to `localhost` via `utils/dev-mode.ts`.

## Testing

`bun test` runs unit/integration tests colocated as `*.test.ts`, plus headless progression simulations under `src/simulation`. App tsconfig excludes test files, so run them through Bun (not `tsc`).

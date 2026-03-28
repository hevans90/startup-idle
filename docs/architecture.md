# Architecture overview

## System context

```mermaid
flowchart TB
  subgraph browser["Browser"]
    UI["React UI\n(Tailwind)"]
    Pixi["Pixi canvas\n(isometric office)"]
    LS["localStorage"]
  end

  UI <-->|read/write| Stores["Zustand stores"]
  Pixi <-->|theme, viewport ref| Stores
  Stores <-->|persist / manual| LS
```

The game is a client-only SPA. There is no backend API. All progression is simulated in the browser and persisted in `localStorage`.

## Layered structure

```mermaid
flowchart TB
  subgraph entry["Entry"]
    main["main.tsx"]
    App["App.tsx"]
  end

  subgraph composition["Composition (molecules)"]
    Sidebar["sidebar.tsx"]
    Toolbar["toolbar.tsx"]
    Generators["generators.tsx"]
    Upgrades["upgrades.tsx"]
    InnovationUI["innovation/*"]
  end

  subgraph state["State (Zustand)"]
    Money["money.store"]
    Gen["generators.store"]
    Inn["innovation.store"]
    Upg["upgrades.store"]
    Office["office.store"]
    Theme["theme.store"]
    Ver["version.store"]
    Global["global-settings.store"]
  end

  subgraph presentation["Primitives"]
    UIpkg["ui/*"]
  end

  subgraph canvas["Canvas"]
    OfficeComp["office/office.tsx"]
    Viewport["office/viewport.tsx"]
  end

  subgraph utils["Utils"]
    GenUtils["utils/generator-utils.ts"]
    MoneyUtils["utils/money-utils.ts"]
  end

  main --> App
  App --> composition
  App --> OfficeComp
  composition --> state
  composition --> UIpkg
  OfficeComp --> state
  Gen --> GenUtils
  Gen --> Money
  Gen --> Inn
  Gen --> Upg
  Upg --> Gen
  Upg --> Money
```

**Guidance for agents**

- Put **domain rules** (costs, unlock logic, tick math) in `src/state/*.store.ts` or `src/utils/*` — not inside presentational components.
- Put **wiring and layout** in `App.tsx` and `src/molecules/*`.
- Put **reusable controls** in `src/ui/*` (buttons, dialogs, tabs).

## Application shell (`App.tsx`)

```mermaid
flowchart LR
  subgraph loop["~60 Hz loop"]
    TG["tickGenerators"]
    TM["tickManagers"]
  end

  App --> loop
  loop --> GenStore["generators.store"]
  loop --> InnStore["innovation.store"]
  GenStore --> Money["money.store"]
  GenStore --> InnStore
```

Important behaviors owned by `App.tsx`:

- **Game loop:** `setInterval(..., 16)` calls `tickGenerators` and `tickManagers` (see [domain-model.md](./domain-model.md) for tick cadence details).
- **Theme:** syncs `useThemeStore` to `document.documentElement.classList` (`dark`).
- **Document title:** periodic update from `useMoneyStore`.
- **Layout fork:** `window.innerWidth <= 768` renders a simplified mobile column; otherwise desktop split (office + sidebar).
- **Office sizing:** `useResizeToWrapper` + `wrapperRef` gates rendering of `<Office />` until dimensions exist.

## Store dependency graph (cross-store calls)

Stores are **not** a strict DAG: generators, money, innovation, and upgrades reference each other at runtime via `getState()`.

```mermaid
flowchart LR
  G["generators.store"]
  M["money.store"]
  I["innovation.store"]
  U["upgrades.store"]

  G -->|"increaseMoney / spend"| M
  G -->|"increaseInnovation,\ngetMultiplier"| I
  G -->|"syncAvailableUpgrades"| U
  U -->|"applyUpgradeEffect,\nunlockUpgrade"| G
  U -->|"spendMoney"| M
```

When adding a new store or action, trace **who calls whom** to avoid circular import issues. Prefer importing **types** from a small shared module if two stores need mutual awareness.

## UI composition (desktop)

```mermaid
flowchart TB
  App["App"]

  subgraph left["~2/3 width"]
    TB["Toolbar"]
    Wrap["office wrapper div"]
    subgraph wrap["wrapper"]
      HUD["title + money + MPS"]
      Off["Office (Pixi)"]
      Ver["version label"]
    end
  end

  subgraph right["Sidebar max-w-1/3"]
    Tabs["Tabs: employees | innovation"]
    Emp["Employees tab:\nPurchaseMode, Generators, Upgrades"]
    Inn["Innovation tab:\nSummary, Managers"]
  end

  App --> left
  App --> right
  Wrap --> TB
  Wrap --> wrap
```

## UI composition (mobile)

Mobile omits `Toolbar`, `Sidebar`, and `Office`. It still runs the same tick loop and stores; only the view is reduced (tap money, generators, upgrades, settings).

## Related docs

- [domain-model.md](./domain-model.md) — tick intervals and economic formulas
- [persistence.md](./persistence.md) — what survives reloads and version bumps
- [agent-guide.md](./agent-guide.md) — where to edit for typical tasks

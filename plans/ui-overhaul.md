# The UI, rebuilt: one console, in arwes

**Status:** U1–U12 done on the `ui-overhaul` branch (PR #11). **U1 done:** `src/ui/theme/` — `tokens.ts` builds every role's scale with `@arwes/theme` (indexed by lightness: arwes rounds a scale's index), in both themes; `installTheme` writes them as `--ui-*` variables before the first draw and keeps `--console-ai` to the stage; `index.css` maps them to Tailwind colours (`bg-surface-1`, `text-fg-muted`, `border-line`, `text-money`, `bg-ai-soft`, `border-console`), one class right in both themes; Share Tech Mono is `font-display`; `tokens.test.ts` holds every text pair to AA and every role and strong line to 3:1 in both themes. `--ui-console` (the teal mixed toward violet) is declared on `:root`, `.dark` and `.console-scope`: a variable built of variables resolves where it is declared. The open questions are taken as proposed (Share Tech Mono; start plain; replace each surface outright). No surface is migrated yet. **U2 done:** `src/ui/motion/` — the level (calm: chosen in settings, or the system's reduced motion), the takeover's decoration tiers (`consoleMotion`: frames draw from the Colleague's mix, headers decipher from the Manager's, backgrounds move from the Overseer's; calm holds the mix at 0), the budgets (0.8 s an entrance, 30 ms a staggered row, ten at most) and timer-only `useSequence`/`staggerDelay`. The quest UI reads it (its transmissions draw at any stage: the AI speaking; calm stills them and drops their backgrounds). Sound: an interface bus under the master beside the effects and the ambience, each with its volume in settings; `tick` (off by default, never when calm), `open`, `close`, `confirm`, `deny` (heard on every refusal notice on the map), `alert`, with `click`, `transmission` and `decision` moved onto it, pitched up to 12% by the mix. **U3 done:** the kit in `src/ui/console/` (beside the old `src/ui` primitives, which go as their surfaces migrate): `Frame` (the seven shapes; a tone, the console's own or any role; lit and hover-lit; drawing on by the decoration tier, `assemble="always"` for the AI's own words), `Text`, `Backdrop` (dots, grid, and from the Overseer arwes's moving lines on an animator node of their own), `Button` (primary in a corners frame, secondary, quiet, danger; `confirm` asks a second press; loading), `IconButton`, `Toggle`, `Segmented`, `Slider`, `Panel` (kranox), `Card` (nefrex), `Section`, `Dialog` (octagon, portalled, focus kept and given back, Esc, entrance in four steps), `Label`, `Num`, `Meter`, `Badge`, `Chip`, `Kbd`, `Tooltip` (floating-ui) and `Locked` (dimmed content, what opens it, "Show me"). Frames read `.ui-frame` in index.css, from the tokens. The quest UI is on it (its pieces deleted, its colours tokens). `?uikit` shows it all in both themes at any stage and motion level (`ConsoleMotionOverride`, so nothing saved is touched). Lint: arwes only in `src/ui/`; no raw palette class in `src/ui/console/` and `src/quest-ui/` (the list grows). Tests render the kit in happy-dom under StrictMode (`src/test/dom.ts`). **U4 done:** `state/comms.store.ts` (live reports and notices with their lifetimes, a session log of reports, alerts and transmissions, `report()`/`notice()`), `src/ui/comms/`: `CommsDock` at the map's top right (the objective, what the AI asks, events, reports, then a hint if a slot is free; three at most, the rest behind "+n · Log"), `ReportCard`, `CommsLog` (a dialog, filtered), `NoticeToast` (refusals by the pointer, with `deny`) and `startCommsBridge` (the world's notices, each event begun — logged, with `alert` — and each transmission logged). The AI's memos and away report go through `pushAiMemo`/`setAiReport` into reports (their cards deleted); the five `toast.success` calls are reports; react-hot-toast and `ui/Toast` are gone; event and hint cards are kit `Card`s. The dock's order is `dockItems`, tested. The dev panel still sits over the dock's top in development (moves to a drawer in U6). **U5 done:** the HUD (`toolbar.tsx`): settings, the founder and the company's clock on the left, the resources in the middle in the display face and their colours (money, innovation, valuation; `ResourceCounter` takes a `role`), the AI meter on the right as a kit `Meter` in violet (click: the AI tab), an underline frame along its foot; popovers share the kit's `POPOVER` style; the ticker is muted and stops fading in calm. The meter no longer floats over the map. Juice is not in the HUD: it lives in the vape shop. Counters keep their width; their rates and the founder's name give way first. **U6 done:** the map's edges: projects and top streets docked top left, comms top right, the build bar along the foot (tools, then views; the tools on keys 1–6 with their `Kbd`, the active tool lit in the console's colour; AI mode a view toggle, its panel shown only when on); the looked-at main's card (`MainInfo`, a kit `Card` toned by its state, "Lift it" a confirm) placed beside its cell by `Anchored` and kept on screen; the dev panel a drawer on the backquote key (development only); the map's overlays and labels on tokens, and the renderer's background following the theme. **U7 done:** the sidebar: the kit's `Tabs` as its rail (scrolling sideways, the current tab kept in sight, each tab's `data-hint` kept for the hints, a tab that opens later drawn on, not in calm; a tab no longer shown falls back to the first), the old `ui/Tabs` and `SystemPanel` gone; every tab in `Panel`s (which take a `help` on a "?"); the purchase mode a `Segmented` (×1, Max); employees a row each (name, count, what they all earn, the buy button with its price in money's colour); upgrades a grid of corners cards, what can be afforded lit, what is bought below by its initials; the Data Centre's parts violet panels; managers before the HQ, and the valuation tab before managers, `Locked` with "Show me" (`showProject` flies to the HQ's site or opens the projects log; the valuation tab's opens Innovation); the sidebar's files and the shared `src/ui` pieces they use (InfoRow, ModifierTag, BonusRow, ProgressBar, InfoPop, CyclingButton, Popover) on tokens, skill categories by role. Employees have no avatars yet: there are none to draw per kind. **U8 done:** founding is one boot sequence (`founding-shell.tsx`): the step rail (Founder → Land → Term sheet), one octagon over the grid backdrop, Back and Next in the same place at its foot on every step; founders and term sheets corners cards, lit when chosen (a term sheet is chosen, then signed, rather than signed on the first click); the land's preview framed; the permanent bonuses beside it on tokens; the Model's shop a dialog. The sale's confirmation, the offline summary and the Ascension are kit `Dialog`s, their numbers counting up (`CountUp`: on a timer, at once when calm); the Ascension's choices carry their consequences in their tooltips and ask a second press (a tap shows no tooltip), and it must be answered; calm skips the sale's dissolve. Settings is a `Panel`: theme and motion `Segmented`, day and night, map events and sound `Toggle`s, the volumes kit `Slider`s, and the reset a danger button with a second press in place of the browser's confirm. `Frame` takes an `inner` class, to make its children fill it. **U9 done:** the skill tree's chrome in the kit: its header a `Text` title over an underline frame, Equity, exits, allocated, respecs and Weights as `Label`s and `Num`s in their colours, the search on tokens, respec a danger toggle, the ✕ an `IconButton`; the bonuses list and the node tooltip on tokens. The canvas's state colours come from the tokens (`tokenNumber`, a token as 0xrrggbb for Pixi): allocated `fg`, available `good`, hover `accent`, can't afford `warn`, respec `bad`, the route `info`, a search's spotlight `innovation`, the Machine's fog `ai`, the backdrop `surface-0`; the clusters keep their own disc tints, their identity. **U10 done:** the phone (`hooks/use-phone.ts`, `isPhone`, 768 px and under): the HUD one row on tokens (settings, money — a tap earns — innovation, the AI's percentage, then Map or Company as a `Segmented`) over an underline frame; the map's docks one column, comms' one card (`CommsDock most={1}`, its "+n" the rest) and the work under it; the build bar's tools a rail that scrolls, the views behind a Views button that opens them in a row above; the Company tab the sidebar itself, its panels full width (the old phone-only lists of employees and upgrades gone); dialogs the whole screen (`max-md:` in `Dialog`). **U11 done:** the takeover through the console: `--ui-console` (teal toward violet by the mix) already drew every frame, focus ring, lit tool and chosen segment; panel headers now take it too (or their panel's tone), and the interface's sounds rise with it. The Overseer's console: from the Overseer's mix the AI's moving lines run behind the HUD and the sidebar (`OverseerBackdrop`), as behind dialogs. Calm everywhere: `installTheme` sets `ui-calm` on the root with the mix at nothing, and index.css stills what loops or slides in under it (pulses, the hint's glow, a tab drawing on, a transmission's arrival, the ticker's fade), beside the frames, text and backdrops that already read the level; `install.test.ts` holds it. Several headers may decipher at once on a tab's first draw at the Manager and after: kept, as each is short. **U12 done:** the measures. *Contrast:* `tokens.test.ts` holds every pair (AA text, 3:1 lines and focus) in both themes. *Keyboard:* every action is a button; hover popovers open on focus too (`useFocus` in `ui/Popover`), the employee rows and bought upgrades take focus; dialogs trap and return focus, Esc closes what can be closed; the build bar's 1–6. *Screen readers:* frames `aria-hidden`, dialogs labelled, meters `progressbar`s with values, comms a polite region and events `role="alert"`. *At rest:* no long task in 10 s at rest on the singularity fixture; the Overseer's grid behind the HUD and sidebar is still (`Backdrop still`), the moving lines only behind dialogs; the anchored card writes its position only when it moved. *INP* (dev build, the map running): buying an employee 48–88 ms, opening the comms log 32 ms. *Bundle:* the kit with its arwes is 21.7 KB gzipped on its own (budget 30); the backdrop's packages (`@arwes/bgs`, `@arwes/animator`) are fetched when one is first drawn. The main chunk is 49.7 KB gzipped larger than main's (502.9 against 453.2): the kit, the arwes the quest UI loaded lazily on main (its lazy chunk fell from 16.3 to 5.7 KB) and the migrated surfaces; react-hot-toast (9 KB) is gone. *Not measured here:* the perf scene's frame total against main's (it needs main's server beside this one); nothing in the render loop changed but the renderer's background colour.

## Why

The game has grown a surface at a time, and it shows. Every panel, card and bar was styled where it was written:
- **No shared look:** about 13,000 lines of UI across ~60 components. `src/ui` has primitives (`Button`, `SystemPanel`, `Tabs`, `Popover`, `ProgressBar`…), but most surfaces don't use them: 68 hand-rolled `<button>`s and 222 hard-coded `border-primary-*` classes, each card its own `CARD` constant (`main-card.tsx`, `event-cards.tsx`, `ai-memos.tsx`, `datacentre-panel.tsx`…).
- **Two visual languages:** the quest UI is now a sci-fi console — octagon frames drawn on, deciphering titles, dots behind — and everything around it is flat grey boxes in Space Mono. The arc's transmissions look like they come from a different game, which is the opposite of what the arc is about: the AI becoming part of the company.
- **The map's edges are crowded:** the AI meter, the projects panel, the column of hints, memos, reports and event cards, the dev panel, the transmission and the tracker all claim the top of the map. They are stacked by hand (`company-map.tsx`) and collide on narrower screens.
- **Hierarchy is flat:** the money, a locked feature, a hint, a takeover warning and a notice that the road is too short all look alike — the same border, the same weight. What matters now doesn't stand out.
- **Tools and views are mixed:** the build bar holds tools (Look, Road, Lift, Pipe, Build, Demolish) and overlays (Wonders, Mood, Earnings, Water, Labels) in one row, with AI mode as a loose checkbox above it.
- **Locked things are empty boxes:** a locked sidebar section is a grey panel saying what's needed ("Managers need an HQ — build one on the map"), the same weight as a working one.
- **Light mode is half-done:** the map well is always dark; the AI readout is always dark; some cards have `dark:` pairs, some don't.
- **Feedback is scattered:** toasts, the world store's `notice`, memos, the AI report, hints, event cards and transmissions each have their own place, look and lifetime, and none keeps a history.

This plan rebuilds the UI from a single design system — a console, the company's own, that the AI gradually takes over — built in arwes, in both themes, without slowing the game.

## The idea

**The interface is the company's operating console.** Early on it is the founder's: plain, warm, a little scrappy. As the singularity rises the AI's violet creeps into it — frames assemble with more flourish, text deciphers, the background grid hums — until at the Overseer stage it is plainly the AI's console you are using. The UI is how the takeover *feels*, not just the map.

That one idea decides a lot:
- **One frame vocabulary, one palette, one motion system,** so the AI's arrival reads as a change of mood, not of skin.
- **The stage is a theme input:** `stageOf(meter)` sets how much violet, motion and decoration the console shows. Low-motion and calm settings cap it.
- **Restraint by default:** arwes is at its best in a few strong frames, not on every div. Most of the screen stays quiet; frames mark the things you act on.

## Constraints already known

- **`@arwes/react-*` don't work here** (memory: arwes-react-breaks-strictmode). They mark themselves unmounted in an effect cleanup and never recover under StrictMode, and they peer on React 18. Everything uses arwes's DOM packages through our own wrappers, as `src/quest-ui/` does: made in an effect, removed in its cleanup.
- **Packages, pinned at `1.0.0-next.25020502`:** `@arwes/frames`, `@arwes/text`, `@arwes/bgs`, `@arwes/animated` (in), plus `@arwes/theme` (colour, spacing and type scales; no React) — to add. `motion@10` is already in for the frames. `@arwes/bleeps` is not used: it needs audio files, and the game's synthesised bus (`src/audio/sound.ts`) stays the one sound source.
- **Both themes, always** (memory: dark mode always): every token has a light and a dark value.
- **The map is Pixi, and expensive** (memories: hidden-tab-fakes-perf, render-group-rebuilds). The console must cost the frame nothing while idle: no animation loops in resting panels, no layout thrash over the canvas, frames redrawn only on resize.
- **Bundle:** the quest kit is 15 KB gzipped with arwes in. The core kit moves into the main bundle (it is the whole UI now); the quest UI's lazy chunk rule is retired for the kit and kept for heavy, rare pieces (the skill tree, the dossier, the gallery).

---

## 1. The design system

### 1.1 Tokens (`src/ui/theme/`)

One file of tokens, built with `@arwes/theme` and emitted as CSS variables on `:root` and `.dark`, read by Tailwind (`@theme`) and by arwes's frame variables. No component picks a raw colour.

- **Colour roles, not hues:**
  - `surface` (0–3: the page, a panel, a raised card, an overlay), `line` (quiet, normal, strong), `text` (body, muted, faint);
  - `accent` — the company's teal (the founder's colour, `STAGE_COLOUR.tool`), and `ai` — the violet, the two the takeover moves between;
  - the resources each keep one colour everywhere: `money` (emerald), `innovation` (cyan), `valuation` (amber), `juice` (pink), `weights` (violet);
  - `good`, `warn`, `bad`, `info`.
- **Scales from `createThemeColor`:** each role a scale in both themes, so a hover, a pressed state and a disabled state are steps, not new colours.
- **The takeover mix:** `--console-ai` (0–1) from the stage: Tool 0, Assistant 0.1, Colleague 0.25, Manager 0.45, Overseer 0.8, Ascension 1. Frame lines, focus rings and headers mix `accent` toward `ai` by it (`color-mix`). Calm mode holds it at 0.
- **Spacing and type:** `createThemeUnit` for a 4 px grid; `createThemeMultiplier` for type steps. Numbers always `tabular-nums`.

### 1.2 Type

- **Body:** Space Mono stays — it is the game's voice.
- **Display:** one condensed technical face for headers, the HUD's big numbers and frame titles, in `@fontsource` like Space Mono: **Share Tech Mono** (already the 10x dev's) is proposed; Titillium Web is arwes's own (open question 1).
- **Three sizes for numbers:** the HUD's (large, display face), a panel's (medium), a row's (body). Every currency through `formatCurrency`, every rate with its unit, every countdown `m:ss`.

### 1.3 The frame vocabulary

Each arwes frame has one meaning, so the shape tells you what something is before you read it:

| Frame (`@arwes/frames`) | Means | Where |
|---|---|---|
| `octagon` | a dialog: something the game asks of you | transmissions, the Ascension, the sale, offline summary, founder setup |
| `corners` | a choice you can make | decision cards, founder cards, term sheets, map setup presets, buy buttons for big purchases |
| `kranox` | a panel: a standing part of the console | sidebar panels, the Data Centre, projects, top streets |
| `nefrex` | a card on the map: something there right now | event cards, a building's card, a main's card, a pump offer |
| `underline` | a status line | the tracker, the HUD's readouts, a progress row |
| `lines` | a section divider | inside panels |
| `header` | a title bar | panel and dialog titles |

Frames are drawn **on** when they appear (`animateFrameAssembler`), lit on hover where they can be acted on, and never animate at rest.

### 1.4 Motion

Our own small orchestrator over `@arwes/animated` (not arwes's React animator), in `src/ui/motion/`:
- **Enter, exit, stagger:** a dialog's frame draws on, then its title deciphers, then its body sequences in, then its buttons light — one timeline, ~0.6 s total. A list staggers its rows 30 ms apart, at most ten.
- **Budgets:** nothing animates for longer than 0.8 s; nothing loops except a pulse that needs attention (an incoming transmission, an announced takeover); and only one decipher at a time on screen.
- **Three levels, a setting:** *full*; *calm* (frames appear without drawing, text whole, no background motion, `--console-ai` held at 0); and the system's `prefers-reduced-motion`, which forces calm.
- **The takeover in motion:** decoration grows with `--console-ai`: at 0, frames simply appear; from the Colleague they draw on; from the Manager headers decipher; at the Overseer the backgrounds' moving lines run behind dialogs.

### 1.5 Sound

The synthesised bus, extended with a UI family under its own volume (Settings: *Effects*, *Interface*, *Ambience*):
- `tick` (hover over something actable, throttled), `click` (exists), `open`/`close` (a panel or dialog), `confirm` (a purchase), `deny` (a refusal: a notice, a disabled click), `alert` (a takeover announced, a flood warning), `transmission` and `decision` (exist).
- Pitched by `--console-ai`: the AI's console sounds a little higher and glassier as it takes over. Calm mode keeps the effects but drops `tick`.

---

## 2. The kit (`src/ui/`, rebuilt)

Every piece built on the tokens and frames above, StrictMode-safe, both themes, keyboard-complete. `src/quest-ui/`'s pieces move in and the quest UI becomes a user of the kit. A gallery (`?uikit`, from `?questkit`) shows every piece in both themes and all three motion levels.

- **Structure:** `Frame` (the vocabulary above), `Panel` (kranox, a header and optional controls — replaces `SystemPanel`), `Card` (nefrex, for the map), `Dialog` (octagon, focus-trapped, Esc to close where it can be closed — replaces `Dialog`/`ModalDrawer`), `Section` (a `lines` divider with a label).
- **Text:** `Text` (decipher / sequence / plain, from `QuestText`), `Num` (a number in its resource's colour, with an optional ticking count-up on change in full motion), `Label`, `Kbd`.
- **Controls:** `Button` (primary, secondary, quiet, danger; a corners frame for a primary; a loading state; a `confirm` mode that needs a second press — from the decision cards), `IconButton`, `Toggle`, `Segmented` (for purchase mode ×1/×10/max, focus, theme), `Slider` (from `DiscreetSlider`), `Tabs` (a rail with an underline frame under the current tab).
- **Feedback:** `Meter` (an underline frame that fills: the AI meter, a project's progress, a tank), `Badge` (a count or a state), `Chip` (a modifier or gate, replacing `ModifierTag`, `gate-chips`), `Tooltip` (from `Popover`/`InfoPop`, one behaviour everywhere: hover or focus, 300 ms in, never covering what it explains), `Toast` (see §4).
- **Backgrounds:** `Backdrop` (`@arwes/bgs` dots, grid lines, moving lines, puffs), only behind dialogs and the founder screen; never under scrolling content.
- **Locked:** a `Locked` wrapper that shows a feature greyed behind a corners frame with what unlocks it and a "Show me" that focuses the map on where — not an empty box.

A lint rule follows the kit (it replaces the quest UI's): no `@arwes/*` or `motion` outside `src/ui/`; no raw `border-primary-*`/`bg-primary-*` classes in migrated directories (a list that grows a phase at a time).

---

## 3. The screens

### 3.1 The HUD (`toolbar.tsx`, `ai-singularity-readout.tsx`, `game-stage-ticker.tsx`, `company-timer.tsx`, `founder-badge.tsx`)

One strip across the top, an underline frame under it:
- **Left:** settings, then the company: founder badge, name, how long ago incorporated.
- **Middle:** the resources, each `Num` in its colour with its rate under it — money, innovation, valuation, juice when it exists. Clicking one opens its breakdown (`resource-breakdown.tsx`) as a tooltip, not a page.
- **Right:** the AI — the meter as a `Meter` with its stage name and arrow, which today floats over the map; and the AI tab's shortcut.
- **The ticker** stays one line under it, in the muted text colour, and stops scrolling in calm mode.

### 3.2 The map's edges (`company-map.tsx` and everything on it)

Four docks replace hand-placed overlays, each a stack that knows its order and its room:
- **Top-left dock — the work:** projects, then top streets (both kranox panels, collapsible to a title).
- **Top-right dock — comms:** the tracker, then the transmission, then event cards, then the AI's memos and report, then hints — in that priority. At most three cards show; the rest fold into a "+n" badge that opens the comms log (§4). Cards slide in from the right edge.
- **Bottom — the tools:** the build bar (§3.3), centred.
- **Bottom-right — readouts:** satisfaction, desire, port income — compact underline frames, hidden while a dialog is up.
- The **dev panel** moves into a dev drawer behind a keyboard shortcut, out of the comms dock's way.
- **On the map itself:** building labels, event rings and the arc's ring stay where they are; a building's card (`main-card.tsx`, the Look cards) becomes a nefrex `Card` anchored beside the building, not at the dock.

### 3.3 The build bar (`build-bar.tsx`)

Split in two, so what you hold and what you see are separate:
- **Tools** (one is in hand): Look, Road, Lift (Road | Pipe), Pipe, Build ▸, Demolish — a `Segmented` rail with keyboard shortcuts (`1`–`6`) shown as `Kbd`.
- **Views** (any can be on): Labels, Mood, Earnings, Wonders, Water — toggles to the right, after a divider.
- **AI mode** joins the views as a toggle on The Model's runs, not a loose checkbox.
- The **beds and capacity readout** (`40/180`, `120`) sits above the bar as an underline status line.
- The Build picker opens upward as a corners-framed grid of buildings with their price and what they need.

### 3.4 The sidebar (`sidebar.tsx` and its tabs)

- **The tab rail:** `Tabs`, icons and names, the current tab underlined; tabs that unlock appear with a short draw-on rather than popping in.
- **Employees** (`generators.tsx`, `upgrades.tsx`, `purchase-mode-toggle.tsx`): each kind a row — avatar, name, count, output per second, the buy button with its price; purchase mode a `Segmented` at the top. Upgrades a grid of corners cards, affordable ones lit.
- **Innovation, Valuation, Acquisition, Vape shop, AI:** each a stack of `Panel`s; locked parts as `Locked` with "Show me".
- **The AI tab:** the Data Centre panel's sections (throttle, focus, allowance, cooling, training, the ledger) as panels; the dossier at the top in the first generation. Its frames carry the most violet.

### 3.5 Dialogs and flows

- **Founding** (`founder-select.tsx`, `map-setup.tsx`, `term-sheet-select.tsx`): one "boot sequence" in an octagon over a `Backdrop`: three steps with a step rail (Founder → Land → Term sheet), founder and term sheet choices as corners cards, the land preview framed. Back and Next always in the same place.
- **The sale** (`sell-transition.tsx`, `acquisition-tab.tsx`), **the Ascension** (`ascension-card.tsx`, rebuilt as Q6 left it), **offline summary** (`offline-summary.tsx`): octagon dialogs, their numbers counting up, their choices as buttons with consequences in the button's tooltip.
- **The skill tree** (`skill-tree-overlay.tsx`, Pixi): its chrome (header, Equity and Weights, search, respec, bonuses list) rebuilt in the kit; the canvas restyled from the tokens (node rings, edges, the Machine's violet) so it matches — its drawing stays Pixi.
- **Settings** (`settings-popover.tsx`, `sound-controls.tsx`, `theme-toggle.tsx`): a panel, with the new motion level and the three volumes.

### 3.6 The phone

The same docks, collapsed: the HUD's resources in one row; comms as a single card with the "+n" badge; the build bar's tools as a scrolling rail and views behind a button; the sidebar as the existing Company tab, its panels full width. Dialogs take the whole screen.

---

## 4. Feedback, unified: comms

One system for everything the game tells you, replacing six:
- **Kinds,** each with its look, sound and lifetime:
  - *alert* — needs you now (a takeover announced, a flood warning, an event's choice): a nefrex card in the comms dock with a pulse, until resolved;
  - *transmission* — the AI asks (the arc): as Q3 built it;
  - *report* — something happened (a project opened, a sale, the AI's job memo): a short card, gone after 8 s;
  - *notice* — your action was refused, and why: a toast by the pointer, `deny` sound, 3 s;
  - *hint* — how to play: a quiet card, dismissible, "no more tips" as now.
- **The comms log:** every alert, report and transmission kept for the session, filterable, behind the "+n" badge and in the AI tab — the history players currently lose when a card times out.
- **One API:** `comms.push({ kind, text, at?, action? })` beside the world store's `notice`, `pushAiMemo` and `toast`, which forward to it while surfaces migrate.

---

## 5. Accessibility

- **Contrast:** every token pair checked in both themes (WCAG AA for text, 3:1 for frame lines and focus rings) by a test that reads the token file.
- **Keyboard:** every control reachable and visible on focus; the build bar's shortcuts; Esc closes what can be closed; dialogs trap focus and return it.
- **Not by colour alone:** resource colours always carry a label or icon; good/bad rows carry a sign (+/−) as the effect rows do.
- **Motion:** the three levels above; `prefers-reduced-motion` forces calm.
- **Screen readers:** frames are `aria-hidden` decoration; dialogs labelled; meters as `role="progressbar"` with their values; comms as a polite live region (alerts assertive).

## 6. Performance

- **At rest the console costs nothing:** no `requestAnimationFrame` in resting UI; frames redraw on resize only (`createFrame`'s observer); backgrounds only behind dialogs; at most one decipher running.
- **Over the map:** dock layout changes only when a card arrives or leaves, never per frame; the anchored building card repositions on the viewport's move events, throttled to the display's frame (as `EventMarkers` does).
- **Measured:** the perf scene (memory: stamps-miss-untimed-passes) with the console up must keep its frame total; a resting console must add no long tasks; INP for opening a dialog and buying an employee under 100 ms.
- **Bundle:** the kit's arwes and motion within 30 KB gzipped in the main bundle; skill tree, dossier and gallery stay lazy.

## 7. Migration

- **The kit first,** then a surface at a time, each phase shippable: old and new live side by side, and the lint rule's list of migrated directories grows with each phase.
- **Feature-flagged per surface while it settles?** Not proposed: each phase replaces its surface outright, behind the usual tests and screenshots, so there is never a half-old screen in main for long (open question 4).
- **Screenshots** of each migrated surface in both themes and the three motion levels on the isolated server, in the phase's commit message.
- **The editor** (`?world=1`) keeps its own UI: it is a tool for building maps, not the game (open question 5).

---

## 8. Phases (each committed to `main`, with tests, `npx tsc -b` and eslint)

| # | Phase | What lands | Depends on |
|---|---|---|---|
| U1 | Tokens and type | `src/ui/theme/` with `@arwes/theme`; colour roles in both themes; `--console-ai` from the stage; the display face; contrast test | — |
| U2 | Motion and sound | The orchestrator over `@arwes/animated`; the three motion levels and the setting; the UI sound family and the three volumes | U1 |
| U3 | The kit | Frame, Panel, Card, Dialog, Section, Text, Num, Button, Toggle, Segmented, Slider, Tabs, Meter, Badge, Chip, Tooltip, Toast, Backdrop, Locked; `quest-ui` moved onto it; the `?uikit` gallery; the lint rule | U1, U2 |
| U4 | Comms | The comms system and log; notices, memos, reports, hints, event cards and transmissions through it | U3 |
| U5 | The HUD | The top strip with the AI meter in it; resource breakdowns as tooltips | U3 |
| U6 | The map's edges | The four docks; the build bar split into tools and views with shortcuts; anchored building cards; the dev drawer | U3, U4 |
| U7 | The sidebar | The tab rail; Employees, Innovation, Valuation, Acquisition, Vape shop and AI tabs in panels; `Locked` with "Show me" | U3 |
| U8 | Dialogs and flows | Founding as a boot sequence; the sale, the Ascension, offline summary; settings | U3 |
| U9 | The skill tree | Its chrome in the kit; its canvas restyled from the tokens | U3 |
| U10 | The phone | The collapsed docks, rail and full-screen dialogs | U5–U8 |
| U11 | The takeover in the console | `--console-ai` wired through every surface: violet, motion and sound growing by stage; the Overseer's console; calm mode verified everywhere | U5–U9 |
| U12 | Polish and measure | Contrast, keyboard and screen-reader pass; perf scene and INP; bundle; screenshots of every surface, both themes, three motion levels | all |

## 9. Measures and guards

- **Contrast test:** every text and line token pair, both themes, at AA (text) and 3:1 (lines, focus).
- **Kit tests:** each piece mounts twice under StrictMode and shows (the arwes trap); reduced motion shows text whole and frames drawn; dialogs trap and return focus; `Button` in `confirm` mode needs two presses.
- **Comms tests:** priority order and the three-card limit; alerts persist until resolved; reports expire; the log keeps everything for the session.
- **Lint:** no arwes outside `src/ui/`; no raw palette classes in migrated directories.
- **Perf:** the perf scene's frame total with the console up within 2% of today's; no long task from a resting console; INP under 100 ms for a dialog and a purchase.
- **Bundle:** main bundle growth under 30 KB gzipped for the kit.
- **Browser checks** on the isolated server for each phase: screenshots in both themes and three motion levels; a narrow (1024 px) and a phone (375 px) width.

## Open questions

1. **The display face:** Share Tech Mono (already used for the 10x dev, close to Space Mono's spirit) or Titillium Web (arwes's own, more "sci-fi")? Proposed: Share Tech Mono.
2. **How much console, how early?** The plan starts plain and lets the AI bring the sci-fi in. The alternative is the full console from the first minute. Proposed: start plain — the takeover is the point.
3. **UI sound on by default?** The interface family is new; some players find hover ticks tiring. Proposed: on, without `tick`, at half the effects volume.
4. **Flags per surface,** or replace outright? Proposed: replace outright, a phase at a time.
5. **The editor:** leave it alone (proposed), or bring it onto the kit after U12?
6. **Light mode's map well:** today the area around the map is always dark. Proposed: follow the theme (a light well in light mode), with the map's own drawing unchanged.

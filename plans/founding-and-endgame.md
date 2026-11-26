# The founding screen, cleaned; and new places for Equity to go

Status: **plan, not started** (2026-11-26). No sink waits on the tree being full; Weights get dearer the more are bought. Three parts, each shippable alone: **A** the founder screen, **B** Weights for Equity, **C** a tree per mechanic.

## Why

- **The founder screen reads machine-made.** Every card is a "dossier": file numbers (F-01), CLASSIFIED kickers, redaction bars, rubber stamps, ▸ bullets, an italic tagline, an octagon frame inside an octagon frame, a scrambling locked file. Six of seven cards are grey bars on a first visit. Beside it, a sidebar of up to 14 bonus rows and a Weights banner of prose.
- **Equity has one place to go.** The tree is 223 nodes and about **49,000 Equity** in all (the last node is 930). New sinks sit beside it from the start, not behind it: none waits for the tree to be full.

## A. The founder screen

### What goes

- The dossier dress-up: file numbers, Available / Classified / Selected kickers, redaction bars, Clearance stamps, the Model's static and scrambling name, ▸ bullets.
- The frame inside a frame: one surface, no octagon.
- The Permanent bonuses sidebar as a standing column.
- The Weights banner's sentence.

### What it becomes

One screen, two columns, a lot of empty space. (The figures below are only placeholders.)

```
 Founder · Land · Terms                          Equity 48,210   Weights 312   Gen 3
 ─────────────────────────────────────────────────────────────────────────────────
  NEET                      ·            │  The Hacker
  The Bootstrapper          2 exits      │  Ships before breakfast.
  The Hacker                ●            │
  The Visionary             3 exits      │  +50% innovation
  The Hustler               locked       │  Hires 20% cheaper
  The Agentic Delusionist   locked       │
  The Model                 locked       │  Map  Roads cost half
                                         │  Exit Innovation ×1.5 an exit
                                         │  Seed $50
 ─────────────────────────────────────────────────────────────────────────────────
  Skill tree   Machine   Lineage                                    Continue →
```

- **Left, the list:** a row per founder, name and one fact (exits as them, or what unlocks them). A locked one is dimmed and still names its requirement. The selected row gets a 2 px accent bar, nothing more.
- **Right, the one selected:** name large; tagline in plain weight; perks as plain lines; the map rule, per-exit and seed as label/value rows. Fused traits under these, if any.
- **Top, the numbers:** Equity, Weights and generation as plain numbers. A click on Equity opens the bonuses (today's sidebar rows) in a popover.
- **Foot:** the tree, the Machine and the lineage as quiet text buttons; one primary **Continue**.
- **Type and colour:** one display face for the founder's name only; everything else in the body face. One accent (the console colour); the AI's violet only for the Model. Light and dark both, from the same tokens.
- **Motion:** the detail fades between founders (150 ms). No glitch, no assembling borders.
- **Narrow screens:** the list becomes a row of names above the detail.

### The other two steps

The Land and Term sheet steps share the shell (`founding-shell.tsx`). The new shell (plain surface, step rail as text, Back / Continue at the foot) applies to them with no other change. Their insides are not part of this plan.

### Files

`founder-select.tsx` (rewritten), `founder-card.tsx` (becomes a row and a detail; the redaction, stamp and scramble code goes), `founding-shell.tsx`, a small `bonuses-popover.tsx` from today's `PanelRow` list. `founders.catalog.ts` is unchanged except where a tagline needs shortening.

### Done when

- All seven founders show on a 1366×768 screen without scrolling. They are readable on a phone.
- Locked, the Model reads as plainly as the rest.
- Every colour has its dark pair; screenshots are taken in both themes.

## B. Weights for Equity

- **Where:** the Machine (the AI's constellation in the skill tree) gets a **Buy Weights** control, and so does the Weights number on the founder screen.
- **Price:** **100,000 Equity for the first Weight, each one after dearer.** Start at `100,000 × 1.1^bought`: the 10th costs about 236k, the 25th about 985k, the 50th about 10.7M. Buy one at a time, or as many as you can afford with one press (the total shown first).
- **When:** from the first sale, beside the tree. No gate.
- **Kept:** how many have been bought, for the price. It never resets, so the price only climbs.
- **Store:** `prestige.store` spends the Equity; `generation.store` gets the Weights. One action for both, so neither can happen without the other.

### The numbers to check first

- A sale pays `15 · √(accrued ÷ 1000)` Equity times the multipliers; Ascension pays about `3 · √Equity` Weights. The whole Machine is **794 Weights**.
- At 100k for the first, buying Weights only matters once a sale pays several hundred thousand Equity. I'll measure what late sales pay (a profiled late save, or the cadence simulation pushed on) and set the 1.1 to match: a few Weights a sale late on, not hundreds.
- Once the Machine is bought out, Weights have nothing left to buy either. Part C gives Equity a sink that never fills; Weights would still stop. Flagged, not planned.

## C. A tree per mechanic

**Mastery trees**, one for each system of the map, bought with Equity **from the first sale**, beside the main tree. Like the Machine's notables, each node changes **how something works**, not a percentage. Each tree counts its own nodes for its price: its first node about 25 Equity, each one after dearer (×1.08), so a tree's last nodes run to tens of thousands. Early Equity is then a real choice between the main tree and a mechanic you lean on.

| Tree | What it works on | Notables (examples) |
|---|---|---|
| **Roads** | road jobs, crews, grading | dig and pave in one pass · bridges open a length at a time · a crew per length, not per job |
| **Water** | mains, pumps, sewers, floods | pumps lift two steps · mains self-mend after a flood · sewers take slop at double bore |
| **Fleet** | lorries, yards, site trucks | a second yard gate · lorries carry two loads · night deliveries |
| **Town** | houses, services, mood | houses start a tier up · services reach 2 tiles further · lots merge |
| **People** | hiring, leaders, morale, culture deck | a leader per workplace · LinkedOut red flags shown · a sixth culture slot |
| **Projects** | landmarks and sites | work starts before the first load · two sites at once per crew · wonders keep their crane |
| **Harbour** | ports, ships, exports | a berth more a port · exports in convoys · ships wait out floods |
| **Nature** | woods, felling, farms | felled timber sold at the site · fields twice a year · woods regrow under pylons |

- **Shape:** each tree is about **25 nodes**: 15 minors (small, real levers, e.g. build speed for that mechanic only), 6 notables (the features above), and 1 keystone out of 3 (a trade-off, as in the main tree). A node is bought next to one bought.
- **Where:** tabs along the top of the skill-tree overlay: **Company** (today's tree) · the eight mastery trees · **Machine**. Each tab draws its own constellation on the same canvas (`skill-tree-canvas.tsx`) with the same tooltip, so there is no new renderer.
- **Data:** `game/mastery.ts`, a list of trees built by the cluster generator `skill-tree.ts` already uses. Effects go through the existing chokepoints (`cultureNow` for town levers, `resolvePrestigeModifiers` for economy ones); each notable gets a named flag, as the Machine's do (`notable(id)`).
- **Saved:** `prestige.store.mastery: Record<TreeId, string[]>`, with its own version so a reshaped tree refunds.
- **Order of work:** the framework and **one** tree (Roads, since its systems were just worked over), then the rest a tree at a time, each with its notables tested on a fixture.

## Questions

1. **Founder subtitle:** "Which type of shitlord tech bro are you?" stays or goes? I'd drop it for the clean look; the game's voice stays in the founders' own lines.
2. **Mastery trees:** all eight, or start with fewer?

## Order

1. **A**, the founder screen, alone. It touches nothing else.
2. **The measurement** for B.
3. **B**, a small change once the price is fixed.
4. **C**, the framework and Roads; then a tree at a time.

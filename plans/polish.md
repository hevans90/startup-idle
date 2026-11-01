# Polish: one voice for every modifier, and the rough edges of the UI

**Status:** phase 1 done.
- **Answers taken:** "Money +8%"; no flavour lines written for modifiers that have none; the short scale's names; "Output" for a kind's whole production.
- **`game/wording.ts`:**
  - `STATS`, the glossary: each stat's name, which way is good, share or points.
  - `NEVER`: the words a player never reads.
  - `describe` (numbers → effect line), `change` and `helps`.
  - `effectProblems` (grammar and glossary, a reason each).
  - `formatScale` and `formatMoneyScale` (K…Dc, then e-notation; not wired in yet, phase 4).
- **`game/wording-audit.ts`:** every catalogue's effect lines and what is wrong with each. `bun run wording` prints the report.
- **`wording.test.ts`:** holds the rules. Each catalogue is a todo until phase 2 adds it to `CLEARED`.
- **First report:** 130 of 216 effect lines to put right:

  | Catalogue | To put right |
  |---|---|
  | Skill tree | 67 of 92 |
  | Juice | 24 of 24 |
  | Founders | 11 of 25 |
  | Machine | 9 of 9 |
  | Mandates | 6 of 6 |
  | Terms | 4 of 17 |
  | Processors | 3 of 3 |
  | Policies | 2 of 9 |
  | Leaders | 2 of 16 |
  | Training | 2 of 15 |

## Why

The UI overhaul (`plans/ui-overhaul.md`) gave every surface the same look. The words on those surfaces never got the same treatment. Each catalogue was written when its system was, and it shows:

- **Five grammars for one idea.** A 25% money boost is written five ways today:
  - "Output +25% · morale −8" (policies, leaders)
  - "+8% employee money output." (vape juice)
  - "+6% money and +6% innovation." (skill tree)
  - "Hiring 10% cheaper · sale 5% less" (term sheet)
  - "Money ×2" (founder perks)

  Of the 371 effect and description strings, 216 end with a full stop and 155 don't.
- **Many words for one stat:**
  - money: "money", "money output", "employee money output", "output", "$" ("Founder — global $")
  - innovation: "innovation" or "innovation rate"
  - valuation: "valuation", "valuation rate" or "valuation accrual rate"
  - hiring cost: "hire cost on all generators", "hire cost for all employees", "Hires 30% cheaper", "Hiring 10% cheaper", "hire discount"
  - 10x devs: "10x devs" 42 times, "10x developer(s)" 4, "10x engineer(s)" 2
- **Code words reach the player:**
  - "generators" (skill tree: "−10% hire cost on all generators")
  - "accrual"
  - "Cost growth −0.020" and "Mandate cost growth −0.025" (founder perks: a raw curve exponent)
  - "Innovation curve ×1.4"
- **Rules buried in paragraphs:**
  - The Machine's notables and endings run to four sentences each, with the effect in the middle.
  - Project pitches mix "Opens cafés, parks and gyms." with "When it opens you can hire managers, and clicking it takes you to innovation."
- **Words and numbers can drift apart:**
  - Policies, leaders, juice and the skill tree each store their numbers *and* a hand-written sentence repeating them.
  - Nothing checks that the two agree.
- **Duplicated lists:** mood reasons are written twice (`world/agents/mood.ts` and `world/agents/desirability.ts`).

Seen while working on the map this session, the UI has its own rough edges:
- **Covered map on load:** a welcome-back dialog, three achievement toasts and a tip card cover the map on every load.
- **Covered hover label:** the tip card covers the hover label.
- **Projects panel:** it opens expanded over the town.
- **Big numbers:** these go to e-notation from $10M ("$1.00e+12" money, "$3.57e+828" a hire).
- **Repeated badges:** a big town repeats one problem on every house ("−40 · 4 more" × dozens).

## The rules

### 1. Every modifier has two lines, and only the first is required

- **The effect line** says what it does, in the grammar below. It is what the player compares. It is generated from the modifier's numbers wherever the numbers exist (§4), so it can't drift.
- **The flavour line** (optional) is one sentence in the game's voice, ending with a full stop: "The interns are unionising. This is a blessing in disguise." It never states a number.

A rule that can't be put in the grammar (the Machine's notables, founder rules, endings) gets a short effect line plus a **detail** sentence shown in its popover, not a paragraph on its card.

### 2. The effect grammar

```
effect  := part ( " · " part )*
part    := [scope " "] stat " " change   |   plain clause
change  := "+25%" | "−25%" | "×2.5" | "+6" (points: morale, desirability)
```

- **Order:**
  - The stat comes first, sentence case: "Money +25%". Not "+25% money".
  - Gains come before costs: "Output +25% · morale −8".
- **No full stop, ever.** Clauses are joined with " · ", never "and", "&", "," or "but". The " · " is the trade-off.
- **Symbols:**
  - Use the Unicode minus (−) and times (×) signs, never "-" or "x".
  - Use percentages for shares and × for multiples of 2 and up: "Money ×3", not "Money +200%".
- **Scope** goes as a short prefix, only when it isn't everyone: "Vibe coders' innovation +25%", "Team output +15%" (a leader's team), "Ports +50% calls".
- **Conditions** go at the end, after a comma: "Innovation +15%, at full use".
- **Cheaper is a percentage off the price:** "Hires −10%", "Mandates −25%", "Builds −20%". Not "cheaper", "discount" or "cost multiplier".

| Today | After |
|---|---|
| +8% employee money output. | Money +8% |
| −10% hire cost on all generators. | Hires −10% |
| Money ×3, but valuation accrues 80% slower. | Money ×3 · valuation −80% |
| Innovation ×2.5 & automation ×2, but money ×0.5. | Innovation ×2.5 · auto-buy ×2 · money ×0.5 |
| Hiring 10% cheaper · sale 5% less | Hires −10% · sale −5% |
| Cost growth −0.020 | Hires get dearer 2% slower |
| +10% equity payout on company acquisition. | Equity +10% |
| Free Lunch: Morale +6 · output −5% (the lunch) | Morale +6 · output −5% (flavour moves to its own line) |

### 3. The glossary: one word for each thing

| Say | Never |
|---|---|
| **Money** (what employees earn) | money output, employee money output, revenue, $ in a label |
| **Output** (only for "everything a kind produces") | money output |
| **Innovation** | innovation rate |
| **Valuation** | valuation rate, valuation accrual rate, accrual |
| **Equity** | equity payout |
| **Hires** (their price) | hire cost, hiring cost, hire discount |
| **Morale** (a kind's) and **mood** (a house's) | satisfaction (in text), happiness |
| **Interns, vibe coders, 10x devs, AI agents** | 10x developers, 10x engineers, generators, employees of a kind |
| **Builds** (structures and projects) | construction, building costs |
| **The AI** | the Machine (except its shop), the singularity (except the meter) |
| **Auto-buy** | automation speed, automation |

Capitals: proper names (Campus, Data Centre, Town Hall) and the first word of a line, nothing else. "Data Centre" and "café" keep their spelling.

### 4. Numbers

- **Generated, not typed:** one formatter, `game/wording.ts`, turns a modifier's numbers into its effect line (`describe({ money: 1.08 }) → "Money +8%"`). Every catalogue that holds numbers calls it.
- **Big numbers:**
  - Use short scale names up to 1e33: $12.4K, $3.10M, $1.00T, then Qa, Qi, Sx, Sp, Oc, No, Dc.
  - Use e-notation only past that.
  - Three significant figures everywhere, in the HUD's steady width.
  - Now: `formatCurrency` switches to e-notation at 1e7.
- **Rounding:** percentages to whole numbers unless under 10% ("+2.5%"). Multipliers to one decimal place, two under 2 ("×1.35", "×2.5").

## The work, by surface

Counts are today's strings in each place.

| Surface | Where | Strings | What changes |
|---|---|---|---|
| Policies | `game/policies.ts` | 9 | `says` generated from `morale/output/innovation/hireCost/slop/autoBuy`; "(the lunch)" moves to flavour |
| Leaders' traits and skills | `game/leaders.ts` | 16 | Generated; "The rest of their kind feel three quarters, not half" → "Kind's other morale ×0.75" or its own clear clause |
| Vape juice shop | `game/achievements.juice-shop.ts` | 12 | Generated: "Money +8%", "Hires −10%", "Equity +10%" |
| Board mandates | `state/valuation.store.ts` | 6 | Generated, "per level" as a scope: "Money +2% a level" |
| Managers | `game/modifier-explanations/managers.ts` | — | Same grammar in their rows |
| Skill tree nodes | `game/skill-tree.ts` | 26 | Generated where numeric; trade-offs with " · "; no "generators" |
| Founders | `game/founders.catalog.ts` | 7 founders × perks, rule | Perks generated; curve exponents said as "Hires get dearer N% slower"; the rule short ("Builds −20%, projects too") |
| Term sheet clauses | `game/term-deal.ts` | 17 | "Hires −10% · sale −5%"; "$600 now · 20% stake" stays (it is money, not a modifier) |
| Slop processors | `game/processors.ts` | 3 | "Innovation +15%, at full use" |
| Projects and wonders | `game/projects.ts` | 15 | Pitch = one flavour sentence + "Opens: …" and "Bonus: …" lines the card already lays out |
| The Machine's notables, endings | `game/machine.ts` | 13 | Effect line ≤ 60 characters + a detail sentence in the popover |
| Data Centre training | `game/training.ts` | skill lines | Effect lines ("Houses built a tier up") |
| Modifier breakdowns | `game/modifier-explanations/*` | ~20 labels | Source names: "Founder", "Skill tree", "Vape juice", "Leader"; the stat is the popover's title, so labels drop "— global $", "& output" |
| Mood reasons | `world/agents/mood.ts`, `desirability.ts` | 10 + 7 | One list, one place; sentence case ("No services", "Water view") |
| Map refusals and hints | `world/play/build-bar.tsx`, place rules | ~15 | Per-tool hints true to the rules (parks now go anywhere); refusals as "Needs a road", "On water" |
| Achievements | `game/achievements.catalog.ts` | 71 | Names unchanged; descriptions only for the glossary ("10x devs") |
| Upgrades | `state/upgrades.store.ts` | flavour only | Unchanged as flavour; their effect line generated beside it |
| Events, quests | `world/events`, `game/quests` | — | Voice is fine; a pass only for the glossary |

## UI/UX polish

Each of these was seen in the game this session, except where marked as not yet seen.

1. **A quiet load:**
   - Achievements earned while away go into one "While you were away" report, not three toasts.
   - The welcome-back dialog only after real time away (a minute or more), never on a fixture.
   - Tips wait until the map has been seen for a few seconds.
2. **Hover labels above everything on the map.** Today the comms dock's cards cover them. The label goes in a layer over the docks, or the card moves aside.
3. **The projects panel starts collapsed** after the first project, opening itself only when something needs a choice ("2 ready").
4. **The HUD on a narrow bar:** the AI readout gives way to a compact form (its percentage and arrow) rather than vanishing.
5. **Town-wide problems are one notice, not a badge on every house.** When most houses of a kind share a mood problem, the comms dock says it once: "Interns unhappy at home: 214 houses, no services". Badges then mark only the houses worse than their street.
6. **Big numbers by name** (§4), in the HUD, the sidebar, labels and the build bar alike.
7. **Popovers say the effect first:** title = the stat, then the effect line, then the flavour, then where it comes from. Today the order varies by surface.
8. **One empty state per tab:** "Nothing to buy yet" and its siblings in one component, with what opens it. (A "Show me" link already does this on locked tabs.)
9. **Placement readout:** the refusal and the price in one line under the pointer, in the glossary's words.
10. **Keyboard:** Esc closes the hover label and the projects panel. Not yet seen; to check.

## How it is held

- **`game/wording.test.ts` checks every catalogue:**
  - It walks each catalogue and checks every effect line against the grammar (a regex per part).
  - It checks no line uses a word from the glossary's "never" column.
  - It checks the generated line matches the numbers.
  - It runs with the suite, so a new modifier written the old way fails.
- **A lint rule** for player-text files: no "generator" in a string literal, no ASCII "x" after a digit.
- Each surface is its own commit, checked in the game: its card, its popover and its breakdown.

## Phases

1. **The rules in code:** `game/wording.ts` (`describe`, the glossary, the number formats) and `wording.test.ts`, reporting today's violations as a list (expected to fail; skipped until phase 2 clears them).
2. **The modifiers:**
   - Generated text first: policies, leaders, juice, mandates, skill tree, founders, term clauses, processors.
   - Then the hand-written: projects, the Machine, training.
   - The test turns on.
3. **The explanations:** modifier breakdowns, mood reasons (one list), map hints and refusals.
4. **Numbers:** `formatCurrency`'s named scale, rounding rules, everywhere it is called.
5. **The UI/UX list,** one item a commit, each checked in the browser on the isolated server.
6. **A read-through** of every tab, card and popover in both themes, at desktop and phone widths, for anything the test can't see.

## Open questions

1. **Money's "$" in effect lines:** "Money +8%" (proposed) or "$ +8%"?
2. **Flavour lines on modifiers that have none today** (policies, juice, mandates): write some, or leave them bare?
3. **The number scale:** short names (K, M, B, T, Qa…; proposed) or e-notation from a smaller threshold?
4. **"Output" vs "money":** keep "Output" for a kind's whole production (money and innovation), or say "Money" only and list innovation separately?

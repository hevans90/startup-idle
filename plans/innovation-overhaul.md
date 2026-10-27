# The innovation overhaul: Morale, policies, leaders, LinkedOut

Status: **plan**, agreed in conversation on 2026-10-27; not started.

## Why

- Features are gated twice: a project on the map, then an innovation purchase on top (Managers cost 1, Employee Management 5 with no project at all, and the Boardroom and the Valuation tab wait on that purchase).
- Three words for one idea: house **mood** (±40, the map), role **satisfaction** (±100, the economy) and a team leader's **morale** stat, with the causes split across the map, the Employees tab and the Innovation tab, and satisfaction swinging revenue ×0.25 to ×10.
- Team leaders are a spreadsheet of drifting stats, hidden under Employee Management.

## Decisions

| Question | Decision |
|---|---|
| Unlocks | No innovation purchases. Each tab and feature opens with its project. |
| Mood vs satisfaction | One number per kind, **Morale**, made of visible parts. |
| Naming | **Morale everywhere**: houses have morale (the map overlay is renamed "Morale"), each kind has morale. "Satisfaction" leaves the game. |
| Scale | ±40 (the houses' scale), output ×0.5 at −40, ×1 at 0, ×2 at +40. |
| Side effects | Kept, one per kind: interns → innovation, **vibe coders → slop rate (new)**, 10x devs → their cost curve. |
| Home part | The morale of the houses a kind lives in, weighted by residents; those awaiting a bed count as 0. |
| Perks | Become **work policies**: per kind, held in slots that manager tiers grant. |
| Tabs | Innovation tab appears with the HQ (Managers + Morale + Policies). Before it, a compact Morale strip on the Employees tab. |
| Leaders | Live on the **map**: **one per kind**, placed in a workplace that employs their kind. |
| Leader's team | Full effect on their kind working in that building, half on the rest of their kind. |
| Leader effect | Boosts their team's output and moves their team's morale (by personality). |
| Leader growth | Ranks from their team's work; each rank, pick 1 of 3 perks from their personality's pool. Moving them keeps their rank. |
| Unlock | A new late project, the **Talent Agency**, after the Campus. |
| Hiring | **LinkedOut**, a parody recruitment site in its own window: job posts, applicants trickling in, company reputation, red flags. |
| Innovation (currency) | Spent on managers' tiers and on leaders (posts, background checks, hires). |
| After a sale | Leaders and posts reset, reputation drifts back to neutral, ex-leaders become **connections**, cheap to re-hire later (with the existing legacy bonus). |
| Term sheets | Rewritten to match: morale goals on ±40, the talent investor asks for leaders placed. |
| AI mode (the Model) | Does everything: posts, hires, places leaders, sets policies. |
| Old saves | Team leaders convert to new leaders, unplaced; innovation spent on unlocks refunded. |

## Design

### 1. Unlocks by project

| Project | Opens |
|---|---|
| Company HQ (exists) | The Innovation tab: Managers, Morale (full), Policies. No purchase. |
| Boardroom Tower (exists) | The Valuation tab and mandates. Its `feature: "employeeManagement"` gate is removed; the upgrade gate stays. |
| **Talent Agency (new)** | Leaders and LinkedOut: a Leaders section on the Employees tab; clicking the building opens LinkedOut. After the Campus, built by all three kinds. |

- `innovation.store` `unlocks` and `canUnlock`/`unlock` go; `featureGateOpen` (`game/projects.ts`) is the only gate. `FeatureId` gains `"leaders"`.
- `alreadyEarned` gives an old save the HQ or the Agency finished where it already had the feature.
- The sidebar shows Innovation when `featureGateOpen("managers")`, Valuation when `featureGateOpen("mandates")`.

### 2. Morale

```
Interns   Morale +14  →  output ×1.35 · innovation ×1.2
  Home     +9   their houses' morale (map)        [Morale overlay]
  Work     −3   Crunch Week (policy)
  Leader   +8   Dana Whitlock, rank 3, in the HQ
  Events   +0
```

- **One model** (`game/morale.ts` grows into it; `game/satisfaction.ts` retires): per kind, a target that is the sum of its parts, the score drifting toward it (as satisfaction does now), clamped ±40.
- **Parts:**
  - Home: today's `townMoodOffsets`, now the whole of the town's say rather than a lean.
  - Work: the kind's policies. No headcount pressure: crowding is Home's to say (dropped in phase 2, when it made the sims ~30% slower; the sims had never felt satisfaction before).
  - Leader: their personality and perks, full or half by team.
  - Events: today's `addMorale` leans, rescaled ×0.4.
- **Output:** ×0.5 at −40, ×1 at 0, ×2 at +40, linear on each side.
- **Side effects, one per kind:**
  - Interns: innovation (today's intern IPS effect, rescaled).
  - Vibe coders: slop. At +40 the pit fills at half speed, at −40 at double (`slop-pit.store`).
  - 10x devs: the cost-curve exponent (today's `dev10xSatisfactionExponentDelta`, rescaled).
  - Interns' valuation and manager-speed effects go.
- **Houses:** today's mood keeps its rules, its ±40 and its move-outs at −25. It is called morale in the UI: the overlay, the readouts, the desirability heat-map's words.
  - The UI always says whose: "house morale" vs "interns' morale".
- **The skill tree:** 996, Crunch Mode and Enshittify keep their mechanics on Morale, their text rewritten. `satisfactionGain`, `neutralizeSatisfaction` and `dampSatisfaction` are renamed `morale*`, with a save-compatible alias for allocated nodes. Fusion's satisfaction tempers likewise.
- **UI:**
  - The Innovation tab's Morale panel: a row per kind as above. Each part is a button: Home opens the overlay filtered to that kind's houses, Work scrolls to its policies, Leader focuses their building.
  - Before the HQ, the Employees tab keeps a compact strip: three bars and the output multiplier.

### 3. Work policies

- Per kind, a catalogue of about six. Each is a clear trade, and its effects are written on the card. Examples:
  - **Crunch Week:** +25% output, −8 morale.
  - **Free Lunch:** +6 morale, costs 2 s of income a minute.
  - **Remote Fridays:** +4 morale, −10% output.
  - **Hire Freeze:** −30% hire cost, −5 morale.
  - **Stack Ranking:** +15% output, −6 morale; with a leader, +2 to them.
  - **Hackathon Culture** (vibe coders): +20% innovation, +15% slop.
  - **Research Sabbaticals** (10x devs): +30% innovation, −15% money.
- **Slots:** manager tiers grant them in total across the three managers (one at 1, 2 at 5, 3 at 12, 4 at 25, tunable). A slot is per kind: N slots means N policies for each kind.
- **Switching** is free; morale drifts to the new target, so flipping is never instant profit.
- Replaces `EmployeePerks`, management points and the Micromanagement section. Old perk levels are refunded, as nothing is bought with points any more.

### 4. Leaders

- **One per kind**, placed in a building that employs their kind (`workplaceKind`), i.e. an office or the kind's own project building.
  - Placing a leader: from the Leaders section or LinkedOut, "Place" arms a pick on the map; the eligible buildings glow.
  - Moving one is free, with a cooldown, and keeps their rank.
- **Team:** that kind's workers whose commute ends at that building (`liveCommutes`) get the full effect; the rest of the kind get half. The building card says "Dana's team: 34 interns".
- **Effects:** output +4% per rank to the team, plus their personality's morale (−8…+8) to the team; both at half outside the building.
- **Growth:** XP from their team's output (bigger and happier teams level faster). Ranks 1–5; at each rank, pick 1 of 3 perks from the personality's pool. Today's `EMPLOYEE_SKILLS` are the starting pool, trimmed and rewritten as one-line trades.
- **Personalities:** today's traits, rewritten as one legible lean each:
  - Visionary: +output, −morale.
  - Mentor: +morale, slow XP.
  - Tyrant: +++output, −−morale.
  - Hype Man: +morale, +slop.
  - …
- **On the map:** a portrait badge over their building, and their name on its card. The Morale overlay shows their team's houses, outlined.

### 5. LinkedOut

A parody recruitment site in its own large window, opened from the Leaders section and by clicking the Talent Agency. It has its own branding inside the console: a profile column, a feed of applicants, your company page.

- **Job posts:** post a listing for a kind, paid in innovation (rising with each post this run), open for 10 minutes.
  - Applicants trickle in: one every 1–3 minutes, 3–6 per post.
  - An unanswered applicant leaves after a while ("accepted another offer").
- **Profiles:**
  - A portrait (today's avatar pools) and a cringe headline, generated from parts: "Visionary | Ex-Unicorn | 10x Prompt Whisperer | Ex-Googler (intern, 2 weeks)".
  - Endorsements, a personality, a starting rank of 0–2, and a short "About" in their voice.
- **Red flags:** each applicant has a hidden quirk, about one in three of them bad. Examples:
  - "Quiet-quits at rank 3".
  - "Posts your roadmap".
  - "Sues if fired" (firing costs innovation).
  - "Secretly brilliant" (a hidden extra perk).
  
  A **background check** (innovation) reveals it; otherwise it shows itself after hiring.
- **Company reputation:** 1–5 stars from the company's average morale over the last ten minutes, minus firings this run.
  - Better reputation brings more applicants per post, higher starting ranks, rarer personalities and fewer red flags.
  - Shown on your company page, with the reviews your people leave (generated from Morale's parts: "Free lunch is nice. The commute is not.").
- **Hiring:** costs innovation and replaces the kind's current leader, who leaves (a reputation hit) or, after a sale, becomes a connection.
- **Connections:** at a sale, every leader of the run becomes a connection, who can be re-hired in a later run from a Connections tab at a discount.
  - They start at rank 1 and keep their personality; their red flag is known.
  - Today's `legacies` bonus moves here.

### 6. The Model's runs

AI mode handles it all:
- posts when a kind has no leader;
- hires the best applicant by a score (rank, personality fit, flag risk);
- places them in the building with the biggest team;
- sets policies to its style (tall leans to output, wide to morale).

All of it happens in `world/ai/autopilot.ts`, logged in its memos.

### 7. Term sheets

- Morale goals rescale to ±40:
  - **Happy:** base 20 becomes 8.
  - **Hustle:** −20 becomes −8.
- The **talent** investor asks for "all three leaders placed" (a new `leadersPlaced` metric) instead of three team leaders.
- `managerTiers` is unchanged.
- A save signed with the old numbers reads the new ones: a small, deliberate change, noted in the changelog.

### 8. Old saves

- Hired team leaders become leaders, unplaced, at a rank from their old stat (`rankFromStat`), with a matching personality. Their red flag is known (none).
- Innovation spent on the Managers and Employee Management unlocks is refunded.
- Perk levels are refunded as policy slots; there is no currency to return.
- Satisfaction scores are converted: ÷2.5 and clamped to ±40.
- The skill tree's satisfaction specials keep working through the renamed keys.

## Phases

1. **Unlocks by project.** (Done.) Remove the purchases and gate tabs by `featureGateOpen`; Boardroom gate fixed; refund. Small, ships alone.
2. **Morale model.** (Done. Headcount pressure dropped; the IPO Tower's intern gate eased from 350 to 325, where the sims' hiring stops.)
   - The ±40 model with its parts and per-kind side effects (the vibe coders' slop new), replacing satisfaction in the economy.
   - Events, skill tree and fusion rewired.
   - Old scores converted.
   - Sims rebalanced: `map-balance`, `run-spread` and `progression-sim` must hold their pacing.
3. **Morale UI and naming.** (Done; code identifiers keep "satisfaction" for now.)
   - The Morale panel and strip, the map overlay renamed, every "satisfaction" string gone.
   - Modifier explanations (`modifier-explanations/satisfaction.ts` becomes `morale.ts`).
4. **Work policies.** (Done. Free Lunch costs output (×0.95) rather than a running bill; Always Be Hiring is the auto-buy, a hire every 2 s.) Catalogue, slots from manager tiers, the panel; perks and management points removed.
5. **Talent Agency and leaders on the map.** (Done. The old pairings, global skills and per-workplace +25% went; the legacy bonus for a leader let go stays until connections.)
   - The project, placement, teams from commutes, the rank/perk loop, the badge and card.
   - Old leaders converted.
6. **LinkedOut.** (Done. Legacy bonuses for leaders let go stay as they were; connections are separate.) The window, posts and trickle, profiles and headlines, red flags and checks, reputation and reviews, connections.
7. **The Model's runs and term sheets.** (Done.) AI mode's leader and policy steps; investors rewritten.
8. **Tests, README, a pass in the browser at every stage of a run.** (Done: LinkedOut's window, hiring, a leader placed by a click, AI mode's people steps live, the Innovation tab whole, both themes. Left: the Employees row overflows at three-digit exponents in a narrow window, from before the overhaul.)

Phases 1, 4 and 6 are independent enough to run alongside their neighbours once 2 has landed.

## To decide while building

- Exact numbers: policy slots by tier, leader XP curve, post cost, reputation formula. Tune against the sims.
- Whether a kind with no workplace yet (interns before any office, using the garage) can have a leader placed in the garage. Proposed: yes, any building that employs them.
- How LinkedOut looks: parody of a social network without copying its trade dress; its own wordmark and colours inside the console's tokens, both themes.

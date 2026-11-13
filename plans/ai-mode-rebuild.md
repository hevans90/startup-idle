# AI mode, rebuilt: a pilot that plays the whole run, and shows its work

**Status:** phase 0 built, 2026-11-13 (see "Built so far" at the end). Phases 1 to 9 not started. Replaces `plans/singularity.md` §4b and what `plans/ai-planning.md` built on it. Decisions below are from the user's answers the same day.

## Why

AI mode is meant to be the reward for the first Ascension: switch it on and the company runs itself. As built it does not. It never hires 10x devs, it buys only the one upgrade the next landmark waits on, it ignores ports, mandates and managers, and it stops for minutes at a time without saying why. The panel is one wrapped line of text that reads "Building a block" whatever is happening.

One live look (`/?fixture=singularity`, 2026-11-13) was enough to see the shape of it. In four minutes it spent $750,000 of $1,000,000 on 85 interns in one step, then sat for the rest of the run waiting for a $361,000 office while allowed to spend $10,000, doing nothing else. The panel said "Building a block · 13 steps".

The cause is the design, not a bug to patch:

- **It is a fixed list of `if`s** (`act` in `world/ai/autopilot.ts`): people, one upgrade, hiring, a pipe, a sewer, the next project, its own buildings, then the block. The first item that applies wins, and when that item cannot be paid for the whole thing returns. Nothing below it is tried.
- **It has no idea of waiting.** "Cannot afford yet", "refused", "nothing to do" and "planning" are all the same `false`.
- **It only knows the map.** Most of a run is not on the map: three kinds of hire, eight upgrade sets, managers, mandates, the deck, agents, training, ports' fittings.
- **Nothing runs it start to finish.** Its tests place a few lots on flat ground with a billion dollars. No test plays a company to the sale, so nothing notices when it cannot.

So this is a rebuild of the brain, the executor and the interface. The pure pieces with tests behind them are kept as tools (listed under "Kept").

## Decisions

| Question | Decision |
|---|---|
| What it plays | **The whole run, to the sale.** Everything a player does: hiring all three kinds, every upgrade, landmarks, town, water, sewers, ports, deck, leaders, managers, mandates, agents, training, event choices. It **stops and asks** at the sale and the Ascension. |
| The player's part | **Steer and veto.** A goal, a reserve, areas switched on or off, and any queued job cancelled or pinned. |
| Manual controls | **Disabled while it is on.** Every tab becomes a simplified, live view of what the AI is doing there. Switching it off gives the controls back at once. |
| Who has it | **Any founder, after the first Ascension.** The Model keeps something of its own (open question 1). |
| Old code | The brain (`autopilot.ts`, `masterplan/schedule.ts`) and the panel go. No flag, no second path. |

## The pilot

New code in `src/world/ai/pilot/`. Four parts, each small and each testable without the renderer.

### 1. Jobs

Everything the pilot might do is a **job**. One shape for a hire, a lot, a sewer and a mandate:

```ts
type Job = {
  id: string;              // stable: "hire:10x_dev", "lot:intern@41,22", "upgrade:micromanagement"
  desk: DeskId;
  says: string;            // "An office for the interns"
  why: string;             // "24 houses have no desk"
  at?: Cell;               // where, for the map
  cost: number;            // money now; 0 for free
  costs?: "money" | "innovation";
  gain: number;            // income a second it adds, by the value model
  needs?: string[];        // job ids that must be done first
  run: () => Outcome;      // through the player's own actions
  done: () => boolean;     // read back off the world, not assumed
};
type Outcome = { ok: true } | { ok: false; because: string; retry: "never" | "on-change" | number };
```

A job is always in exactly one state, and each state has words for the player:

| State | Shown as |
|---|---|
| ready | "Next" |
| saving | "Saving · $361k · 2:10" (cost, and time to afford at the present income) |
| waiting | "After: a sewer into the block" (names the job it needs) |
| flying | "On its way" (a drone is out) |
| blocked | "Can't: no ground beside a road" (the refusal, in the game's own words) |
| done / cancelled | in the log |

### 2. Desks

A **desk** looks at one part of the company and proposes jobs. It does not choose between them and it does not act. Adding a system to the game later means adding a desk, not threading another `if` through `act`.

| Desk | Proposes | Built from |
|---|---|---|
| **People** | The next hire of **each** kind (interns, vibe coders, 10x devs), sized to beds; **every** upgrade on offer, not only gate upgrades | `getGeneratorCost`, `nextPerSet`, `roomFor` |
| **Town** | Lots, offices, streets, levelling, a house cleared from a street's way | `planTown`, `town-model.ts`, `lookahead.ts` (kept) |
| **Landmarks** | Each landmark tier as it opens, its site, its build priority; the Campus, which is where 10x devs live | `PROJECTS`, `nearestSpot`, `upgradeFrom` |
| **Water and slop** | Cooling mains, pumps, a main widened, sewers, laterals, refineries | `cooling-ai.ts`, `sewer-ai.ts` (kept) |
| **Harbour** | Ports where the river takes them, upgrades, each berth's fitting, dredging for bigger ships | `planQuay`, `FITTINGS`, `port-balance.test.ts`'s numbers |
| **Culture** | The deck, leaders hired and placed, managers assigned, mandates bought | `autopilot-people.ts` (kept), the stores' own actions |
| **Machine** | Agents spun up, racks, training runs, its own buildings | `aiBuildingSite`, `training.store`, `agents.store` |
| **Events** | An answer to each event card | `EventDef.ai`, extended |

**Dependencies are jobs too.** A vibe office that needs a manhole does not fail: the Town desk proposes it with `needs: ["sewer:block-3"]`, and the Water desk proposes that sewer. A hire with no bed needs a lot; a lot with no frontage needs a street; a landmark gated on an upgrade needs that upgrade. This is what replaces "it got stuck": a job that cannot go yet names the job that unblocks it, and that job is in the queue.

### 3. The chooser

One rule picks the next job, for every desk alike: **the best payback it can afford without starving a better one.**

- **Value.** `gain ÷ cost`, income a second per dollar. A job that unblocks others carries a share of their gain, so an upgrade worth nothing itself but gating the Studio is worth the Studio.
- **Saving.** If the best job costs more than there is, the pilot works out how long until it can pay. Any cheaper job that pays for itself before then is taken meanwhile. Otherwise it saves, and says so with a countdown. It never spends the money a better job is seconds from.
- **The reserve.** Money it will not go below (the player's to set). Replaces "budget a step", which is what let one hire take three quarters of the bank.
- **The goal** tilts value: *Grow* (plain payback), *Next landmark* (jobs on the path to it weigh more), *Fine town* (morale and tiers weigh more).
- **Free and urgent first:** an event's answer, a flooded main, people with no desk. These do not wait behind a purchase.

The value model is `masterplan/town-model.ts` for the town and the game's own rate functions for everything else (`getGeneratorMoneyPerSecond`, the upgrade's multiplier, `portCallFee` × the measured calls a minute). It need not be exact. It needs to rank a 10x dev against a lot against a mandate on one scale.

### 4. The executor, and never getting stuck

Jobs go through `play/build-actions.ts` and the stores' own actions, as now, so the pilot can do nothing a player cannot. Drones stay, as the look of it.

Four rules make "stuck" impossible to hide:

1. **Every tick ends in a job taken or a named wait.** There is no bare `return false`. The status line is that name.
2. **Done is read off the world.** A job is done when `done()` says so, not when its action returned true. One that returned true and changed nothing is a failure with a reason.
3. **A refusal is remembered with its reason,** and the job is not offered again until the map changes there (`retry: "on-change"`) or a time passes. Never the same failing job twice running.
4. **A watchdog.** Money above the reserve, a ready job, and nothing done for two minutes is a fault: logged with the queue as it stood, shown to the player as "Stuck: …" with the reason, and the pilot drops that job and takes the next. In development it also throws, so the sim fails loudly.

## The interface

Switching AI mode on puts the whole game into a **watching** mode. The player's hands come off; every surface says what the AI is doing there.

### Controls off

- One hook, `useAiDriving()`, and one wrapper, `<Manual>`, round every control that changes the company: buy buttons, upgrade buttons, the build bar's tools, the deck's actions, a port card's fitting picker, LinkedOut's hire.
- Under AI mode a `<Manual>` control is not greyed out and left in place. It is **replaced** by what the AI means to do with it: a hire button becomes "12 more when beds open", an upgrade tile gets "next" or "after the Studio".
- The camera, the overlays, labels and looking at a building all still work.

### The pilot bar

Replaces the build bar while AI mode is on. Always visible, one line:

```
● AI   Laying a street east of the garage        Next: an office · saving 2:10        [Grow ▾]  [Pause]
```

- **Now** and **Next**, in words, from the job's `says` and its state.
- Clicking either flies the camera to it.
- The goal and a pause. Nothing else.

### Each tab, simplified

| Tab | Under AI mode |
|---|---|
| **Employees** | Three rows, one a kind: how many, what the next hire is waiting for. Upgrades as a list in the order it will buy them, the next marked. No buy controls. |
| **Innovation** | Managers and the deck: what is slotted, and a line of why. The next card it is saving points for. |
| **Valuation** | Mandates bought and the next one. |
| **Acquisition** | The one place it asks: the offer, and a button. |
| **AI** | Agents, racks, training: what is running and what is queued. |
| **A new tab, Pilot** | The queue by desk, each job with its state and reason; the steering controls; the log. |

### The map

- **Holograms** for queued builds, as now, but for every job with a place, and tinted by state: cyan ready, amber saving, red blocked.
- **A pin** on each. Clicking one opens a small card: what, why, cost, state, and **Cancel** or **Do next**.
- The Landmarks panel, hints and tips written to the player ("An Office, in their row of Build, adds desks") are hidden. Event cards show the AI's answer and why, and close themselves.

### Steering

In the Pilot tab:

- **Goal:** Grow, Next landmark, Fine town.
- **Reserve:** money it keeps back.
- **Areas:** a switch a desk. A desk switched off proposes nothing, and that area's manual controls come back (open question 2).
- **Cancel** a job: not proposed again for ten minutes, or until the player lifts it.
- **Do next:** goes to the head of the queue, saving for it if it must.

### When it needs you

It stops and asks for three things only: the **acquisition offer**, the **Ascension**, and a **story choice** (a quest chapter or a term sheet, which are the player's to answer). One card, "The AI needs you", on the map and in the tab; the pilot carries on with everything else meanwhile.

### The log

A readable history, newest first, a line a job: "12:04 Micromanagement bought. It opens the Vibe Coder Studio." Faults and refusals are in it too. This is what makes a bad decision something the player can see and report.

## The whole-run sim

The guard the old one never had. `simulation/pilot-run.ts` runs the **real pilot** on **real generated maps** with the economy ticking, from an empty map to the acquisition offer, without the renderer.

- **It needs a headless world tick.** Today the scene steps the town's rules inline (`stepEvolution`, `stepWorks`, the housing reader, in `world-scene.tsx`). Those calls move into one pure `stepWorld(g, dt)` that the scene and the sim both call. This is the first phase and the largest risk in the plan: it touches the scene's tick.
- **What it holds to** (`pilot-run.test.ts`, on six seeds at three map sizes):
  - reaches the acquisition offer on every seed;
  - within 25% of the time the balance sim's greedy player takes (`simulate-map-run.ts`);
  - hires all three kinds, buys every upgrade set, builds every landmark, has a port where a river allows one;
  - **no tick without a named state, and no watchdog fault**;
  - the longest wait with money above the reserve and a ready job is under two minutes.
- `BALANCE=1` prints the run's timeline: when each thing was bought, and every wait with its reason.

## Kept, replaced, removed

- **Kept, as tools behind the desks:** `masterplan/plan.ts` (streets), `town-model.ts`, `lookahead.ts`, `style.ts`, `cooling-ai.ts`, `sewer-ai.ts`, `pipe-route.ts`, `autopilot-people.ts`, `ai-runner.ts`'s drones, the masterplan worker.
- **Replaced:** `autopilot.ts` (the brain), `masterplan/schedule.ts` (`nextStep`'s fixed order becomes the Town desk's proposals), `play/ai-mode-panel.tsx`.
- **Removed:** `aiBudget` (the reserve replaces it; an old save's value is dropped), the "Tall: towers round parks" line (parks have been the town's own since the services overhaul).
- **Untouched:** the takeover in ordinary runs (`world/ai/planner.ts`). AI mode and the takeover are different things: one is the player's tool, the other is the story. See open question 3.

## Phases

Each ends with tests, `bunx tsc -b`, `bun run test:par` and a commit to main.

| # | Phase | What | Done when |
|---|---|---|---|
| 0 | **Headless world** | `stepWorld` out of the scene; `pilot-run.ts` harness; the present autopilot run through it once, as the number to beat | The scene plays as before (frame compare); the harness runs a company for an hour of game time |
| 1 | **The core** | Jobs, states, the chooser, saving, the reserve, the executor, the watchdog. The People desk | In the sim it hires all three kinds and buys every upgrade on a town given to it; every tick has a named state |
| 2 | **Town** | The Town desk on the kept street planner; dependencies as jobs | From an empty generated map it houses and desks 200 people on every seed with no fault |
| 3 | **Landmarks** | Every landmark tier, sites, build priority, the Campus | The sim reaches the IPO Tower |
| 4 | **Water and slop** | Cooling, pumps, widening, sewers, laterals, refineries | No building dry or spilling for over two minutes in the sim |
| 5 | **The rest of the company** | Harbour, Culture, Machine and Events desks | The sim reaches the acquisition offer on every seed, inside the time bound |
| 6 | **Watching mode** | `useAiDriving`, `<Manual>` round every control, the pilot bar, "The AI needs you" | With AI mode on no control changes the company; off, all are back. Checked in the browser, both themes |
| 7 | **Showing its work** | Each tab's simplified view, the Pilot tab, map pins and job cards, hologram tints, the log | Every job in the queue can be found on a tab or the map with its reason |
| 8 | **Steering** | Goals, areas, cancel, do next; open to any founder after the first Ascension; the Model's own | Each control changes the sim's run in the direction it says |
| 9 | **Out with the old** | Delete the old brain and panel; saves; README; a play-through start to sale on three maps in the browser | One path in the code; the play-through recorded in this file |

Phases 1 to 5 are the brain and can be judged entirely in the sim. Phases 6 to 8 are the interface and need the browser. 6 could start once 1 is in, since the pilot bar only needs job states.

## Open questions

1. **What the Model keeps.** With AI mode open to every founder, the Model needs its own thing. Proposed: only the Model's pilot **leans by its fused traits** (tall or wide, Paranoid keeping off the river, Hydrophile seeking it), and it flies one drone more. Other founders get the plain pilot.
2. **A desk switched off.** Proposed: that area's manual controls come back, so someone is doing it. The alternative is that nothing does it, which only makes sense as a way to stop spending.
3. **AI mode in a run with the takeover.** In an ordinary founder's run the company's AI also starts building from Colleague. Proposed: both run, and the pilot treats the takeover's buildings as not its own. The alternative is that AI mode on folds the takeover's jobs into the Machine desk, which is tidier and changes the story.
4. **Speed.** Today a step is every two seconds, faster with hangars. With a real queue the pilot could act as fast as money allows. Proposed: keep a pace (drones are the show), but free and urgent jobs do not wait for it.
5. **Offline.** Proposed: no change. Away from the game the company earns as it does now and the pilot does nothing; it picks up on return.

## Built so far

**Phase 0, the headless world, 2026-11-13.**

- **`world/step-world.ts`:** the town's rules, out of the scene's tick and with nothing drawn. `stepPeople` (movers, the emergency services, new hires arriving), `stepGrowth` (people leaving, the unlock ladder, houses growing, the town opening and closing shops), `stepSites` (the ports' yard lorries, the projects going up). The scene calls the three where it ran the same code inline, and draws what they return.
- **`world/play-wiring.ts`:** what the game reads off a played map, out of the React canvas: `bedsReading`, `townMoodReading`, `termReading`, `projectReader`, `foundPlayedProjects`, and `held`. The canvas registers them as before.
- **`simulation/pilot-run.ts`:** `playCompany` founds a company on a generated map, wires those readers, and plays it a second at a time with the economy ticking and the town stepped twenty times a second (the movers' own limit). The driver gets each frame to act in. It reports first hires, staff, projects and when, upgrades, lots, residents, income, every wait of a minute or more, and a timeline of what the driver said it did.
- **Speed:** an hour of game time on a 64-tile map in about ten seconds.
- **`pilot-run.test.ts`:** a player by hand (the garage, four lots, an intern when there is a bed) on a real map: the garage opens at 1.1 minutes, 22 interns are hired, 20 arrive and move in. That holds the harness itself. `BALANCE=1` runs today's AI mode.

**The number to beat: today's AI mode, an hour a map** (`BALANCE=1 bun test src/simulation/pilot-run.test.ts`):

| Map | Start | Staff after an hour | Upgrades | Income | Spent waiting |
|---|---|---|---|---|---|
| seed 1, 64² | the Model's $5 | nobody | 0 | $0/s | 60 of 60 min |
| seed 7, 96² | $5 | nobody | 0 | $0/s | 60 of 60 min |
| seed 23, 128² | $5 | nobody | 0 | $0/s | 60 of 60 min |
| seed 1, 64² | $5 + $10,000 | 51 interns (16 housed), no vibe coders | 0 of 4 | $7.3/s | 55 of 60 min |

From a fresh company it builds the garage and then never hires anyone: an intern costs $5, it has $5, and it may spend 80% of what it has. Given $10,000 it hires interns faster than it houses them, reaches the HQ at 35 minutes, and waits for most of the hour.

**Seen in the browser** after the move (`/?fixture=harbour`, `/?fixture=singularity`, played): hires arrive (4 movers to 175), the Studio's site goes from 1 of 8 loads to 4, yard lorries leave the ports, events come, no console errors. Full suite passes.

**Not in the sim yet**, each still the scene's and each wanted by a later phase:

- the water and its pipes: nothing drinks or spills, so the Water and slop desk (phase 4) cannot be judged until `stepPipes`, cooling and the tanks are stepped too;
- the boats and what a port is paid (the fee is paid in the scene's tick): the Harbour desk (phase 5) needs it;
- the events and what they do to the map, about 300 lines in the scene's tick with a dozen refs: the Events desk (phase 5) needs it;
- repairs, cleanup, the leaders' walks.

These come out of the scene the same way, a slice at a time, at the start of the phase that needs them.

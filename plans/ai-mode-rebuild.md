# AI mode, rebuilt: a pilot that plays the whole run, and shows its work

**Status:** all ten phases built, 2026-11-14 (see "Built so far" at the end), but for phase 9's play-through: the old autopilot is gone and there is one path in the code; the three start-to-sale play-throughs in the browser were not made (one seven-minute run was). Replaces `plans/singularity.md` §4b and what `plans/ai-planning.md` built on it. Decisions below are from the user's answers the same day.

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

**Phase 1, the core and the People desk, 2026-11-13.** In `src/world/ai/pilot/`.

- **`job.ts`:** the `Job` shape as planned, with two changes made in building it. `needs` carries words as well as an id (`{ id, says }`), so a wait is named even when no desk proposes what it waits on yet. `done` is only for a job done once; a job that recurs (a hire) checks the world inside `run` and returns a refusal if nothing changed.
- **`chooser.ts`:** `choose` is pure. Worth is income a second per dollar, and a job others wait on is worth the best chain it begins. Saving: a cheaper job is taken meanwhile exactly when `cost ÷ gain` is no more than the time to save for the best (that is when buying it first reaches the best sooner). The reserve, urgent, pinned, cancelled and refused are all in. Innovation is its own coin and never waits behind money.
- **`pilot.ts`:** `createPilot(desks, { strict })`. It looks twice a second, does a job every two seconds (urgent ones at once), and its status always has words. A job that reports success while `done()` says otherwise is refused as "it changed nothing". A refusal is kept till its time or till the map's revision changes. The watchdog faults after two minutes with a job ready and none done, rests that job ten minutes, and throws when strict. Cancel, do next, pause and desks on or off are there for the interface.
- **`desks/people.ts`:** a hire for each of the three kinds, batched to the empty beds and the money, the batch's average price no more than half again the first's. A kind with no bed waits on `beds:<kind>`; a kind not open waits on its project or the headcount that opens it. Every upgrade the Employees tab offers (the next of each set), worth its multiplier on what that kind earns now, never under 1% of income so none is left for ever.
- **`live.ts`:** the purse read off the stores.

**In the sim** (`pilot-run.test.ts`, 90 game minutes, a town given to it: beds for 400 interns, 150 vibe coders and 8 10x devs, every project standing):

| | Today's AI mode, $10,000 to start | The pilot, People desk only, $5 |
|---|---|---|
| Vibe coders first hired | never | 0.3 min |
| 10x devs first hired | never | 1.9 min |
| Staff | 51 interns | 400 / 150 / 8: every bed filled |
| Upgrades | 0 | 26 of 29 (the other three cost more than it has) |
| Could be sold | never | at 24.8 min |
| Income at the end | $7.3/s | $3.8B/s |

The two columns are not the same test: the old one had to build its own town and the new one was given one. The row that compares is the first three: given beds and open kinds, it hires all three and buys what is offered.

- Not a frame without words, no fault, and never a job ready and not done beyond its pace.
- 96% of frames are "saving": after 36 minutes everything left costs trillions. That is right, and it says so with the amount and the time.
- On a fresh company with no other desk it waits, and says: "Hire the first intern · after the Founder's Garage".
- 17 unit tests on the chooser and the pilot (`pilot/pilot.test.ts`).

- **Not done:** the pace is a flat two seconds (hangars do not quicken it yet); the goal's tilt is a parameter nothing sets; a hire's worth ignores that a new hire has to arrive and find a desk; the worth of an upgrade that cuts costs is a guess (half the same cut in output).

**Phase 2, the Town desk, 2026-11-13.**

- **`masterplan/schedule.ts`:** the old scheduler's one fixed order is split into the steps it was made of, each exported: `liftStep`, `desksShort`, `officeStep`, `lotStep`, `streetStep`. `nextStep` composes them as before, so the old autopilot is unchanged.
- **`pilot/desks/town.ts`:** proposes a lot for a kind whose beds are nearly all taken (`beds:<kind>`, the job a hire waits on); an office for a kind short of desks (`desks:<kind>`), worth what the people perched without one are losing; and the next piece of the block's street (`street`), which is worth nothing itself and is laid when a lot or an office is waiting on it. Blocks are planned one at a time by the kept planner (`chooseNext`). Lots go on the best frontage anywhere on the map, not only inside the block.
- **The chooser gained a rule:** nothing is spent on a job worth nothing. Without it a street nobody was waiting for was laid whenever there was nothing else to do.
- **Refusals are the desk's to route round.** A street piece or a spot that is refused is not offered again; the next piece is, and when a block has none left the next block is planned.
- **What it offered is spent once tried.** The lot just zoned and the piece just laid were kept till the next walk of the map, offered again and refused as "occupied". Every attempt now drops what was kept.
- **A wait names what would end it.** An office that makes slop, with ground for it and no sewer by it, waits on `sewer:<kind>`, not on a street. Said to be waiting on a street, the vibe coders' office had 330 tiles of street laid for it in vain, each a road change that had every car in town plan its way again; a 35-minute run took nine minutes to simulate.
- **Lots keep off the block's office sites.** Zoned on the best frontage anywhere, they took the tiles the plan meant for offices.
- **A piece of street with nothing left to lay but water is never offered.**
- **Not every look walks the map.** Where things could stand is worked out again at most every three seconds, and a block is planned at most every twenty when the last try found none. The map's revision moves with every house that grows; walking the whole map twice a second for a town of three hundred took the sim from seconds to minutes.

**In the sim** (`pilot-run.test.ts`): from an empty generated map, with the garage and the Studio begun by hand (the Landmarks desk is phase 3), the bar is two hundred people hired, living on the map, and none without a desk.

| Map | Reached at | Staff then | Refusals |
|---|---|---|---|
| seed 1, 64² | 12.5 min | 193 interns, 40 vibe coders | 0 |
| seed 2, 64² | 12.9 min | 211, 47 | 0 |
| seed 7, 96² | 14.6 min | 191, 47 | 0 |
| seed 11, 96² | 23.6 min | 214, 50 | 0 |
| seed 23, 128² | 17.2 min | 193, 71 | 0 |
| seed 42, 128² | 15.6 min | 192, 62 | 0 |

**An hour on one** (seed 1): 355 interns and 190 vibe coders, 543 of them living on the map, no intern without a desk, no refusal, and not a tile of street laid beyond the first block's. Eighty vibe coders have no desk: their office reads "After: a sewer to take its slop", which is the Water desk's to lay (phase 4).

No fault and no frame without words on any. Two of the six run in the suite; all six, and an hour on one, under `BALANCE=1`. The plan's bar said "200 people" and meant it of any kind: interns alone stop near 150, where the next costs thirty billion, which is the game's own wall and why the Studio is in the test.

**Found on the way, in the game itself:** `companyFor` in `agents/town.ts` gave a walker's companions a walk spread from their leader's, and a leader with none gave them a walk with no crossings, which threw the first time anyone asked whether they were on one. It took about forty game minutes and three hundred people to happen. Fixed.

- **Not done:** the pilot's builds are done at once, with no drone flown for them and no hologram (the interface phases); blocks are planned on the main thread, not in the worker; the town is not seen in the browser, since the pilot is not in the game yet; the sim slows as the town grows (an hour for a town of five hundred takes about three minutes; where the time goes was not profiled, Bun here having no CPU profiler); the 10x devs' Campus and the vibe coders' sewers wait on phases 3 and 4.

**Phase 3, the Landmarks desk, 2026-11-13.**

- **`pilot/desks/landmarks.ts`:** a job for each project not yet built (`project:<id>`), with its site: where its landmark stands for a tier that rises over one, else the nearest spot to the town. What it waits on is named and, where another desk can do it, is that desk's job: the upgrade its gate asks for (as the next of its set on offer), the people, the tier below, the site in hand finished (one project at a time), a street with room.
- **What a project is worth.** One that opens a new kind is taken to be worth the company's income over again; one that opens a part of the game (managers, mandates, ports, leaders), a quarter of income; a wonder, its money bonus on income, and three tenths of any other. These are set high on purpose: a project costs little against the company and takes a long time to go up, so the thing to do is start it early. At a twentieth, the HQ stood open twenty minutes before it was begun.
- **Loads are kept back for.** A site's materials are paid a load at a time out of the money the pilot spends; what a site still owes is added to the reserve (`owedOnSites`), so a hire cannot starve a build.
- **Of a fork, the one that multiplies money** (the Hackerspace over the Conference Centre), unless the other is begun. The goal will choose in phase 8.
- **Not its own:** the slop processors' projects (the Water desk's, phase 4).
- **People desk:** a hire with no desk to go to is now worth what the deskless manage (about a third), so a hire no longer always beats the office its people need.
- **Town desk:** lots keep off the block's planned streets as well as its office sites. Lots across the lines the streets were to run on blocked every piece, the block was dropped, and after a few the town had "no room to grow" with one street on the map.

**In the sim**, from the Model's $5 on a 64-tile map, nothing done by hand (`IPO=1 BALANCE=1 bun test src/simulation/pilot-run.test.ts -t "to the IPO Tower"`):

| | When |
|---|---|
| Garage | 1.1 min |
| First intern | 1.2 min |
| Studio, first vibe coder | 15.6 min |
| Company HQ | 40.6 min |
| Campus, first 10x dev | 44.3 min |
| Could be sold | 89.8 min |
| Boardroom Tower | 90.0 min |
| **IPO Tower** | **114.7 min** |

At the end: 520 interns, 248 vibe coders, 10 10x devs; 776 living on the map; 26 of 32 upgrades; $6.6B a second; no refusal, no fault. The suite's own test (one map, about twenty game minutes) holds the garage, the studio, vibe coders hired and two hundred people housed and at desks.

- **Not done, and what the run shows:**
  - **The landmarks go up slowly, and one at a time.** The Boardroom took 46 minutes to build and the IPO Tower 25; the Harbour, the Data Centre, the Hackerspace and the Agency were all still waiting at the end. The balance sim's greedy player finishes the core in about 1.25 hours. The pilot never raises a site's priority: that is the lever, and it is not pulled.
  - **The order is by what is ready first.** The HQ was begun before the Campus because its upgrade was bought first, and the Campus then waited sixteen minutes for the site. Nothing looks ahead at a better project about to open.
  - 58 vibe coders have no desk at the end: their office waits on a sewer (phase 4).
  - The Harbour and two wonders wait on "a street with room beside it" on a 64-tile map that is nearly full; bigger maps were not run to the Tower.

**Landmarks sped up, 2026-11-13** (asked for before phase 4). The first note above was wrong about the lever: a site's crew is capped by its footprint and stood waiting; what sets the pace is its LOADS, one truck at a time, and how far each drives.

- **The garage stands by the road's way into the map** (`yardSite`, six tiles in). The HQ line's loads come from where a road leaves the map; put in the middle, thirty-five tiles off, the Boardroom's fourteen took forty-six minutes.
- **Every other landmark stands by the garage**, since its loads come from the garage's line; and **no lot is zoned within eight tiles of it** (`inYard`, `YARD_KEPT`). Houses took the road by the garage first, the Campus then stood in the middle of town, and each of its trucks took three minutes down the one busy road.
- **A building at the water waits on "a road at the water's edge", not a street** (`QUAY`; the Harbour desk's, phase 5). Said to wait on a street, the Harbour had block after block paved for it, each a tile along from the last, till the middle of town was a slab of asphalt: an 81-tile junction that took the lane graph 31 seconds to rebuild at every change to the roads. The hour-long sim hung on it.
- **The purse is read when the pilot looks**, twice a second, not every frame (`tick` takes the purse or how to read it): income is a sum over every upgrade, 4 ms a frame late on.
- **A game bug, fixed** (`stepTown`): a truck that set off from a tile with no road under it was dropped without counting as arrived, so its site paid for another load every frame till the company had nothing.

Seed 1, 64 tiles, an hour (`BALANCE=1 SEED=1 HOUR=1 bun test src/simulation/pilot-run.test.ts -t "six maps"`, about a minute to run):

| | Before | Now |
|---|---|---|
| Studio, first vibe coder | 15.6 min | 5.3 min |
| Company HQ | 40.6 min | 12.3 min |
| Campus, first 10x dev | 44.3 min | 17.5 min |
| Boardroom Tower | 90.0 min | 29.1 min |
| **IPO Tower** | **114.7 min** | **46.3 min** |
| Could be sold | 89.8 min | 59.4 min |
| Talent Agency | not built | 56.0 min |

On the six maps, two hundred people housed and at desks in 17 to 20 minutes, the Studio by 6.3 on every one, no refusal. Still true: one project at a time, in the order they come ready; the vibe coders' office waits on a sewer (73 without a desk at the hour); the Town desk lays no street nobody waits for, so the town stays on its first block and its one road is busy.

**Phase 4, the Water and slop desk, 2026-11-14.**

- **`stepPlumbing`** (`step-world.ts`): the springs, every pipe (`stepPipes`: mains, the slop made, drained and spilled, pumps paid for) and the slop in the water, moved out of the scene's tick as it stood. The scene steps the water's flow after it, on its device; `pilot-run.ts` steps the pipes and the slop every game second, cooling with them, and the water's flow and its springs every ten (the dear part: every second, the six-map test took over ten minutes).
- **`pilot/desks/water.ts`**, on the kept planners (`neededSewer`, `trunkInto`, `wantsRefinery`, `neededPipe`):
  - a sewer for a tank that has none: a connection to a manhole in reach, else a trunk, the connection following (`sewer:<key>`), worth a quarter of what the people at its desks earn;
  - a trunk to where an office waits for one (`sewer:<kind>`, the Town desk's need). The Town desk says where (`sewerAsks`); the job is worth nothing itself and the office that waits on it;
  - another refinery with more slop than those standing take; a main for what drinks and runs short.
- **Town desk: an office only where its slop can be taken away.** A connection lies on empty plots, never a road, so an office fronting the street with its slop port on the road can never be sewered. Two built so before there was slop spilled from the fiftieth vibe coder to the end of the hour. Its port is now looked at before the spot is taken (`drained`). And offices keep out of the yard, as lots do.
- **Landmarks desk: a site is looked for only once nothing else is in a project's way.** Kept as "nowhere" from before it was looked for, the Campus asked for a street it did not need.

In the sim, seed 1 for an hour, before the desk and with it:

| | Before | Now |
|---|---|---|
| A tank spilling, in all | 38.6 min | 0.8 min |
| The longest stretch | 35.3 min | 0.3 min |
| Vibe coders with no desk at the hour | 97 | none |

Seed 11 (96 tiles), 45 minutes: 1.2 minutes of spilling, one stretch. The suite's test now fails on a stretch of two minutes. The other landmarks moved a little with the changed town (IPO Tower 50.0 min, sellable at about the hour).

- **Not done:**
  - **Nothing drinks yet.** Cooling is stepped and the main's job is proposed, but the Data Centre only drinks for the agents on its racks, which are the Machine desk's (phase 5). Widening a main and adding pumps wait on that too: neither has been run.
  - **The processors' projects** (refinery, data plant, content farm) are still skipped by the Landmarks desk, so "another refinery" never comes up: the first is a project nobody proposes. A refinery also only takes slop from a trunk laid to its inlet after it stands.
  - **An office already standing with its port on a road** (a town the player built, when AI mode is switched on) stays unsewered: the fix is to move it, and no job does.
  - Sewers have been run to the hour on two maps only, since slop starts at fifty vibe coders, about minute twenty.

**Phase 5, the rest of the company, 2026-11-14.** Four desks, and the boats out of the scene.

- **`stepHarbour`** (`step-world.ts`): the rivers' traffic, every boat moved, the ports paid for the calls they finished and what they earn a second kept, out of the scene's tick as it stood. The scene sounds the horn and the coin for what it returns. `pilot-run.ts` steps it each frame, and a training run's finish each second.
- **`desks/harbour.ts`:** a road from the nearest street to the nearest place the Harbour could stand (`quay`, which the Landmarks desk's Harbour waits on) or a seaport could (`quay:port`); a seaport once the Harbour has opened them, worth its fee by its calls a minute; each port grown where the bank has room. The Landmarks desk now reads the rivers when it sites what stands by one (`riverRules`): without them the Harbour was "too far from a river" everywhere.
- **`desks/culture.ts`:** the deck and the leaders through the kept planner, now split into the step it would take and the taking of it (`peopleMove`); a manager to whichever of the three has fewest when the next costs under a twentieth of the innovation in hand; the mandate that pays most for its price.
- **`desks/machine.ts`:** an agent when its trade is good (`agentTrade`, as the balance sim plays it), a rack when they have no room, a training run whenever none is on, and on the Model's own runs its free buildings. Nothing that drinks while what stands is short of water.
- **`desks/events.ts`:** an urgent, free job for each card not yet answered: the event's own answer for AI mode on the town as the scene last showed it (`setTownView`), its default with no scene.
- **Landmarks desk: the core first.** What opens a kind, and the head office through every tier, before anything else. Sited at last, the Harbour was begun at minute ten and took twenty-one minutes with the Campus and the HQ behind it.
- **A refusal is in the game's words.** The tools put the player's notice back when the pilot is done with them, so every refusal read "it would not go down". `whyNot()` keeps what the game said.

**What the six maps showed, each fixed:**

- **A sewer priced when planned, paid for later.** With income doubling by the minute the tool refused it for want of money, and the desk wrote that route off for good: the tanks spilled to the end of the run. Routes are now offered at the price of the moment, and one refused comes back after a minute.
- **A spilling tank's sewer is urgent.** A trunk costs minutes of income, and on its payback sat ready behind every upgrade for half an hour.
- **The Studio with its slop port on the road**, where no connection can be laid: landmarks are sited with their ports on open ground, as offices were (`siteFor`).
- **A house, or one of the town's own shops, on an office's slop port.** The Town desk keeps every port clear and looks again as it builds; the town's shops do too (`stepGrowth`, which is the game's and so the player's as well).
- **A manhole beside the port was never joined to**: routed, two neighbouring tiles came back as one, which is no connection.
- **An office hemmed in by its neighbours had no trunk**: one is now tried from anywhere a connection from its port could reach.

**In the sim**, from the Model's $5, nothing done by hand (`SALE=1 BALANCE=1 SEED=n bun test src/simulation/pilot-run.test.ts -t "acquisition offer"`):

| Map | Could be sold | IPO Tower | A tank spilling, longest |
|---|---|---|---|
| seed 1, 64² | 70.3 min | 65.4 | none |
| seed 2, 64² | 58.2 min | 48.8 | none |
| seed 7, 96² | 57.9 min | 48.9 | 4.4 min |
| seed 11, 96² | 58.6 min | 49.7 | none |
| seed 23, 128² | 58.2 min | 49.9 | none |
| seed 42, 128² | 71.6 min | 67.9 | 0.5 min |

Played on past the sale on seed 1 (75 minutes): the Harbour at 60, a seaport, the Talent Agency, the Data Centre at 73 with three agents running, mandates from minute 30, managers from 53, the deck from 57, a leader's job posted. No fault and no frame without words on any map. Eight unit tests on the new desks (`desks/desks.test.ts`). Seen in the browser after the move (`?fixture=harbour`): boats call, "First ship at Seaport III" is said, no console errors.

- **Not done:**
  - **The time bound was not measured.** The plan's bar is within a quarter of the balance sim's greedy player; that run was not made. The sale comes at 58 to 72 minutes.
  - **Seed 7 spills for 4.4 minutes**, over the two-minute bar: the manhole in reach of one office sits on its neighbour's slop port, and its connection is refused till the town changes round it. New trunks keep off port tiles now; this one's order of building still finds it.
  - **Two maps are ten minutes slower**, and it is the road. Every HQ-line load comes one truck at a time up the one road in from the map's edge, and when the build starts with two hundred commuters on it a load takes three minutes, not twelve seconds. On seed 1 the HQ took nine minutes to go up; begun eighty seconds sooner, two.
  - **Events are not in the sim.** The desk is unit-tested; the events themselves, and what they do to the map, are still the scene's (about three hundred lines and a dozen refs). In the game the old autopilot still answers them.
  - **The Harbour, the Data Centre and the wonders come after the sale** on every map, since the core goes first: the Machine desk has run for a few minutes on one map, cooling with it, and ports have paid on two.
  - **Berths are left trading quays; nothing is dredged.** The plan named both.
  - **The slop processors' projects** are still nobody's (phase 4's list).
  - On seed 23 the Harbour's site was once refused by the click as too far from a river: the desk and the click read the river at different moments. It tries again.

**Phase 6, watching mode, 2026-11-14.**

- **The pilot drives the game.** `pilot/game.ts` holds the one pilot a company has; the scene's tick steps it where it stepped the old autopilot, which is no longer called (its file and its tests stay till phase 9). A drone is flown to each thing it does that has a place, for the look of it. A new map is a new company: nothing is remembered.
- **`useAiDriving()` and `<Manual>`** (`hooks/use-ai-driving.ts`, `ui/manual.tsx`). Driving is AI mode on, on the Model's run (any founder is phase 8).
- **Controls off.** Gone under AI mode: the hire buttons and ×1/Max, an agent's spin-up, LinkedOut's post, check, hire, pass and rehire, a leader's perk, place, move and let go, a manager's plus and minus and the amount, a landmark's Choose site and its priority, a pipe's pump, widen, move, delete, manhole and storm drain, the pump offer. Shown and not pressable: upgrade tiles, mandates, the deck (in force is listed, the board stays shut), a port's berths, an event's choices, the agents' throttle, the training runs. Hints are hidden.
- **The tools give way to the pilot bar** (`play/pilot-bar.tsx`), in the build bar's own row with the views after it: `● AI`, what it is doing now, what is next with its state, and Pause. Now and Next fly the camera to the job when it has a place. Going into AI mode puts down whatever was in hand (a tool, a pipe half laid, a landmark or a leader being placed); the keys 1 to 5 do nothing.
- **"The AI needs you"** (`play/needs-you.tsx`): one card at the head of comms, listing the acquisition offer (Open), the Ascension when it was told "not yet" (Begin), and a story choice, whose own card is under it.
- **The old panel is not shown** (`ai-mode-panel.tsx`): the budget slider and Show plans went with it. The reserve and the goal are phase 8.

**Seen in the browser** (`/?fixture=singularity&nosave`, both themes): AI mode on, the bar reads "Put up a Drone hangar · Next: Train on the town"; within a minute it began the Vibe Coder Studio, bought five upgrades, hired from 40 to 108 interns and laid a pump and a main. No enabled control on the Employees or AI tabs changes the company. Pause reads "Paused" and Resume carries on. AI mode off: the tools, the hire button, ×1/Max and the landmark's priority are back at once. No console errors.

- **Not done:**
  - **The "needs you" card was not seen in the browser**: no fixture stands at an offer, and the stores are not to be set by hand. Its list is unit-tested.
  - **The goal on the bar** (`[Grow ▾]`): there are no goals till phase 8.
  - **A tap on the money on a phone still earns.** It is the player's hand on the company; left, as it is not a decision.
  - **The vape shop and the skill tree are untouched**: the pilot plays neither.
  - **The scene still answers an event itself under AI mode**, the moment it comes, as before; the Events desk finds nothing left to answer.
  - **No holograms**: the old plan's ghost went with the old autopilot, and the pilot's are phase 7.
  - On a phone the bar shows Now and Pause; Next is dropped where there is no room.


**Phase 7, showing its work, 2026-11-14.**

- **`state/pilot-view.store.ts`:** the pilot's status, queue and log as plain words and numbers, published by the game's pilot as often as it looks. The sidebar reads this and never the pilot, so the map's engine stays out of its bundle.
- **The Pilot tab** (`molecules/pilot-tab.tsx`), there while AI mode drives: what it is on now; its queue a desk at a time, each job with its state in words and its reason on hover, a click flying to it where it has a place; its log, the newest first, refusals and faults in their own colours.
- **On the other tabs, where a control was, what the pilot means to do** (`JobState`): each kind's hire, each upgrade tile, the agents' row, each manager, each mandate, the deck, each training run.
- **Pins** (`play/pilot-pins.tsx`): one on the map for every queued job with a place, cyan ready, amber saving or waiting, red blocked. A click opens its card: what, why, cost, state.
- **Holograms**: a job says what it builds (`Job.puts`), and the scene shows it where it would stand, tinted the same way (`HoloSpec.tint`, `HOLO_SAVING`).
- **The Landmarks list is hidden** under AI mode (the slop card stays); **an event card** answered by the AI says "The AI chose: …" and drops its choices.
- **Found on the way:** an agent's shortfall was said in dollars ("$71 short") though it is paid in innovation; the log's reasons now read as sentences.

**Seen in the browser** (`/?fixture=singularity&nosave`): the Pilot tab lists People, Town, Landmarks, Water and slop and The machine with states such as "After: the Campus" and "Saving · 71 innovation short"; the log fills a line a job; the Employees tab reads "Next" by the interns and on the upgrade it will buy; three pins stand on the map and one opens its card ("Lay a piece of street · it makes frontage to build on · $14 · Next"); zoomed in, the Company HQ stands as an amber hologram where it is waiting on an upgrade. No console errors.

- **Not done:**
  - **Cancel and Do next on a job's card** are phase 8, with the rest of the steering.
  - **The tabs are not rebuilt as the plan's table has them** (three rows a kind, upgrades as an ordered list): the tabs as they were, with the pilot's line where the control stood.
  - **An event card does not say why** the AI chose as it did, nor close itself: the answer has no reason to give yet.
  - **Streets, pipes and sewers have a pin but no hologram**: only buildings are drawn ahead.
  - **Seen in the fixture: four offices for the interns in eight seconds**, each "their houses will outgrow their desks". It may be right for a company with a million dollars and 24 houses without a desk; not looked into.
  - A pin can sit over a building's label.

**Phase 8, steering, 2026-11-14.**

- **Open to any founder after the first Ascension** (`aiModeOpen`: the Model, or generation 2 on). The scene steps the pilot for whoever has it; the switch in the build bar shows for them.
- **The goal** (`Goal`, `tiltOf` in `pilot.ts`; on the pilot bar and the Pilot tab): **Grow**, the plain rule, and **Next landmark**, which weighs the Landmarks desk's jobs four times, and so what they wait on.
- **The reserve**: none, or 1, 5 or 15 minutes of income kept back. So many seconds of income, not a sum, since a sum is out of date in a minute.
- **Areas**: a switch a desk on the Pilot tab. A desk off proposes nothing, and its controls are the player's again (`<Manual desk>`, `useAiDriving(desk)`): People gives back hiring and upgrades; Culture the deck, leaders, managers and mandates; The machine agents, the throttle and training; Events the cards; Harbour a port's berths; Water a pipe's card; Landmarks the list. With any of Town, Landmarks, Water or Harbour off the build tools come back beside the bar.
- **Cancel, Restore and Do next** on each job, in the tab and on a pin's card. Cancelled is ten minutes, or till restored; Do next saves for it if it must.
- **The interface reaches the pilot through the view store** (`usePilotView().act`), so the sidebar still imports none of it.
- **The Model's own**: only its pilot leans by its fused traits (the Town desk already did; the Culture desk now does too), and it flies one drone more.
- **The open questions were taken as proposed** (1, 2, 3 and 4), none having been answered: say if any should go the other way.

**In the sim** (seed 2, 64², from $5; `pilot/steer.test.ts`, `steer-goal.test.ts`):

| Control | Plain | Steered |
|---|---|---|
| People off, 8 min | interns hired | none |
| Town off, 8 min | lots zoned | none |
| Reserve 5 min, 12 min | | more in hand for its income, fewer things done |
| The garage cancelled, 3 min | opens at 1.1 min | not begun; restored at a minute, it opens after |
| Next landmark, 28 min | Boardroom at 26.8 min | 22.5 min |

**Seen in the browser** (`/?fixture=singularity&nosave`): People switched off, the hire button and ×1/Max are back and the People jobs leave the queue; Town off, the five tools are back beside the bar, and gone again with it on; a street cancelled reads "Cancelled" with Restore, and "Next" once restored. No console errors.

- **Not done, or not as planned:**
  - **No "Fine town" goal.** It was built as a lean to the Town and Water desks and measured: at 30 minutes the town was smaller (40 lots and 334 residents against 74 and 442) and fifty times poorer. Houses and offices are already built as they are wanted, so leaning to them only puts off the upgrades that pay for more. A goal that made a finer town would need jobs the desks do not propose yet (building ahead of need, the town's services).
  - **A 15-minute reserve stalls a new company**: with $5 a second it holds back more than it has. It is what was asked of it; a floor that only bites later was not built.
  - **AI mode beside the takeover** (question 3): both run, and the pilot does not yet tell the takeover's buildings from its own. Not played.
  - **A non-Model founder's run was not played in the browser**: no fixture is one past its first Ascension.
  - **The pace** (question 4) is as it was: two seconds a job, urgent ones at once.

**Phase 9, out with the old, 2026-11-14.**

- **Deleted:** `world/ai/autopilot.ts` and its tests, `play/ai-mode-panel.tsx`, `masterplan/masterplan.worker.ts` (only the old brain used it; the Town desk plans a block on the main thread), the old plan's ghost in the scene (streets, levelling, clearances, the pending pipe) and `pendingPipe` in the AI layer, the sim's "number to beat" run.
- **Settings:** `aiBudget` and `showPlan` are gone from the session. An old save's values are read and never written back.
- **Kept:** `masterplan/schedule.ts`'s `nextStep`. Nothing in the game calls it; four tests of the kept street planner drive it, and its parts (`liftStep`, `officeStep`, `lotStep`, `streetStep`) are the Town desk's.
- **Drone hangars quicken the pilot**, as they quickened the old one: a job the sooner for each, to six. The old code's going would have left the Model's hangars doing nothing.
- **The cooling test** that drove the old autopilot to lay a main now drives the pilot's Water desk. It showed the desk lays no main for a company with no income, a main being worth a share of income: so in the game, where anything that drinks has a company behind it.

**The play-through.** The bar was start to sale on three maps in the browser. **Not made.** A run is an hour of real time a map, the economy keeping the wall clock; and the isolated preview's save is a first run, whose founders have no AI mode till an Ascension, which is not to be given by hand. What was played: `/?fixture=singularity&nosave`, the Model's seeded company with $1M, AI mode on, for seven minutes.

| At | What |
|---|---|
| 0:00 to 0:30 | its own free buildings, three training runs begun in turn, three upgrades, the Vibe Coder Studio begun, eight offices and five pumps with mains: the million spent |
| to 3:36 | forty jobs done; 14 rounds of intern hires; none refused |
| 6:30 | the Studio open, vibe coders hired and a lot zoned for them; saving for the Company HQ ($129k short, 0:49) and the Campus |

No refusal, no fault, no console error. The dev server reloaded the page at seven minutes (a file was saved) and the fixture began again.

- **Seen in that run and not looked into:**
  - **The million went in thirty seconds**, on eight intern offices ("their houses will outgrow their desks") and five pumped mains for the Model's own buildings. Each may be right; a company handed a fortune is not what the sim plays.
  - **The bar's Now can read a wait of forty days**: "Spin up an agent · saving, 71 innovation short · 959h". It is the best job and it is being saved for, in its own coin, while money jobs go on; as the headline it reads as stuck.
**The play-through, made (14 Nov 2026).** Three companies from the Model's $5, AI mode on, nothing done by hand, each in its own tab of the isolated preview: `/?fixture=singularity&seed=N&size=S` (a new option on the fixture: the second generation's Model, a generated map, no gift). **One of three reached the sale. The other two tabs died of memory first.**

| Map | Reached | How it ended |
|---|---|---|
| seed 1, 64² | **the offer at 73 min** (+23 Equity; the sim says 70); the "needs you" card up over the map, its Open and the sale's dialog working | stopped at the dialog |
| seed 7, 96² | 512 of 1,000 valuation at 59 min; six workplaces sewered, none spilling | **the tab died at about 62 min**, its JS heap 4.7 GB of a 4.4 GB limit |
| seed 23, 128² | $3B at 37 min, behind the others from a blackout at 16 | **the tab died between 37 and 46 min** |

No console error, no fault and no refusal in any of them, and the pilot answered every event (road works, a blackout, a flood).

- **Found, and not fixed:**
  - **The game ran out of memory in the browser within the hour. Fixed (15 Nov 2026).** Not the pilot's: Pixi keeps a texture bind group for every ORDER of textures a batch has met, for good, and a town drawn sorted by depth from ten atlases makes a new order with every step somebody takes: 160 groups a second, 186,000 after half an hour, each listening on every texture in it. The headless sim never showed it (flat at 123 MB for 40 minutes; it draws nothing). `render/batch-binds.ts` gives each batch its group from a table that forgets what no batch used this frame or the last. On `bigtown` with 2,000 movers the groups now hold between 1,300 and 1,600. **Played again (15 Nov 2026), and a second leak under the first:** at 30 minutes the heaps were still 1.0 and 1.4 GB. `Graphics.destroy({ children: true })` — how a layer here is cleared, in 29 places — does not destroy the context the Graphics owns (Pixi does that only when given no options), and with the renderer's collection off nothing took them out: the street's props alone left 140 a second, 33,000 by half an hour. `render/graphics-free.ts` has every Graphics destroy its own context. With both in, from $5: **seed 7 (96²) to the acquisition offer at 70 min, heap 491 MB; seed 23 (128²) to the offer by 90 min, heap 605 MB** — flat from the tenth minute (360 to 555 MB; 530 to 630 MB), some 2,000 bind groups and 300 to 700 contexts, all of them on the stage.
  - **A tank spilled for 35 minutes and more on seed 1**, from the flood at 36 min to the sale, with no job for it in the queue and nothing said of why: the silence the rebuild was to end. **The silence ended (15 Nov 2026), the cause not found:** the Water desk proposed a sewer only for an office with a free port and no connection, so a tank that spilled WITH a connection (its sewer over full, backed up, unpaid, without an exit) or with its port built over had no job at all. It now lists "Stop a tank spilling" for each, waiting on what `spillNeed` reads off the sewer: "After: a wider sewer", "an exit for its sewer", "its slop port cleared". Two of them it now mends: **a sewer over full is widened** (`widenSewerAt`, new: the bore was in the solve, the flow and the drawing, and nothing could set it but a converted main; the sewer's card has the button, as a main's has), and **a connection carrying less than its tank makes is widened** as a main is. One job a sewer, urgent. A sewer already wide and still over full waits on "a second sewer", which it does not lay. The widening of a connection is tested through the desk; the over-full sewer's branch reads a live report and is tested only as far as the action. Not seen in the browser: the `sewers` fixture is the editor's, with no card. **Played again twice (15 Nov 2026), and the cause found: the outfalls drown.** Seed 1's sewers pour into a small hollow at about (34–39, 29–35); it fills, and a flood fills it further. First time: three outfalls under four half steps of water, 0.80 slop a second in and none out, all of it up at a manhole, from 31 min — and no tank "spilling", so the tank's job never fired, and a widening ($11.6B) would have mended nothing. So the desk now looks at SEWERS over full as well as tanks (`sewerMends`): one whose every outfall is under water (`drowned`) gets **a new outfall** from one of its manholes to the shore as it stands now (`reliefTrunk`; a two-tile one was planned and accepted in that live game); one merely over full is widened. **Seen in the browser, seed 23:** over full at 35.65 min, "Widen a sewer" queued at 35.70, wide and flowing at 36.41; the run before, that warning stood from minute 40 to the sale. **Not seen: the new outfall laid.** The second time the flood came first and put the whole sewer, its manholes and one office's slop port under water: nothing can be laid from there, and the queue now says so ("Mend a sewer over full · After: dry ground for a new outfall"; "Stop a tank spilling · After: its slop port clear of the water"). **The root is untouched:** `trunkRoute` takes the nearest water, and a pond with no way out is no place for an outfall, nor its bank for an office. A third run of seed 1 to 53 minutes did not spill (the browser's play is not the same twice), so which of them it was is still unknown; the queue will say the next time.
  - **Flood damage stood for 38 minutes**: twelve buildings still "flood damaged" at the sale. The pilot's answer to the flood was a levee the water got past.
  - **A 64² map is full by 36 minutes**: "room to grow, and none is left on this map" for offices and lots, people over beds (448/442) and "42 houses, no desk" at the sale.
  - **"Hire 1 10x dev. Infinity beds standing empty."** in the log.
  - **The vape overlaps the pilot bar** at the map's lower left.
  - The sale came 3 to 15 minutes later than the sim's, on the one map that got there; events are in the browser and not in the sim.

- **Still open from earlier phases:** the time bound against the balance sim's greedy player; seed 7's 4.4-minute spill; the gateway road that slows two maps; events in the sim; a non-Model founder's AI mode unplayed; no Fine town goal.


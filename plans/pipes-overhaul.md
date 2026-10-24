# Pipes, rebuilt: a water main the player can read

**Status:** built on `main`, phases 1–8. Re-measured in `mains-capacity.test.ts`: a gravity main feeds 20 agents as the old pipes did; a pump's fed 18 at `PUMP_RATE`, so `PUMP_MOST` is 0.5 a second, 12 agents; a widened bore 39. The singularity fixture's mains: the pond's 41-tile run 15 agents, the GPU farm's pump 10. Left as proposed: no buried mains, auto-route only (open questions 1–2).

## Why

Pipes carry the late game. The Data Centre, the AI's buildings and the Lattice all drink, so a pipe that doesn't carry water means agents running hot and lost income. Today the player lays one and can't tell:
- whether it works;
- why it doesn't;
- what to change.

The tool, the drawing and the simulation were each built for a different job:
- **The simulation:** `pipe-flow.ts` is the editor's physics toy. It is 1D shallow water with momentum, a Preissmann slot, and drips out of open mouths.
- **The cooling:** bolted on top of that, with game rules (`gamePipeRun`) that try to stop the toy from misbehaving.
- **The drawing:** done by the drips renderer, as a by-product.

This plan rebuilds the game's pipes from the ground up around one idea: **a pipe is a built thing with a source, a destination and a number on it.** The editor keeps its physics toy.

## How it works today

### The model (`world/water/pipes.ts`, `pipe-net.ts`, `pipe-flow.ts`)
- **Two layers:** a pipe is a grid layer of FACINGS (`grid.pipe`, N/E/S/W bits; one facing a cell) plus an invert level (`grid.pipeZ`).
- **Joining is by adjacency:** "pipes that touch are one pipe". Any pipe cell beside another is the same network (`findPipeNets` flood fill), and the renderer draws a limb to every pipe neighbour.
- **Ports:** a cell whose facing has no pipe across it is a PORT, an opening. Each port moves water by Torricelli through an orifice:
  - it **draws** from a pool above it;
  - it **pours out** into air, as drips;
  - it **reverses** when the pool rises above it;
  - it **fills a tank** when it faces a drinker (`intakeOf`);
  - it is **filled by a pump** when it faces a pump house (`pumpAt`, `runPumps`).
- **Water along a run:** simulated per cell by `stepPipeFlow`. It sloshes, surcharges and backs up.
- **Grade:** a run never climbs. `pipeGrade` and `gamePipeRun` lay it at the water end's floor and carry that level along, burying the pipe under any rise. A port under ground is SEALED (`isSealed`) and reads as capped.

### The tool (`world.store.ts` `endStroke`, `gamePipeRun`)
- **Laying:** dragged as a straight line (road brush) and paid per new tile at 2× road. Refused through a building or on water.
- **Ends:** each end faces, in order, a drinker, a pump, water, or existing pipe. Otherwise it is capped silently.
- **Facings:** the middle cells all face along the run.
- **The editor's tool is a different tool:** a click lays one cell, facing the lowest neighbour, and a second click rotates it. The two share the layer and the simulation.
- **Lift:** removes road AND pipe on the same stroke.

### The drawing (`render/drips-gpu.ts` §3)
- **Bars:** each cell draws flat 2D bars, its "limbs", to the middle of each joined face, plus a stub out of its port, inside the drips pass.
- **Water:** a thinner bar shows how much water is in the cell.
- **Buried:** buried cells fade to a ghost, and are drawn fully only in x-ray mode.

### The AI (`world/ai/pipe-route.ts`, `cooling-ai.ts`)
- **Routing:** a breadth-first search from the drinker to the nearest shore. If the water stands below the building's floor, the shore end becomes a pump house. It is laid through the same tool path (`layPipePath`).

## What's wrong

Some of this is seen, some read from the code. Each item is tagged.

**Mechanics**
1. **Parallel runs merge.** [code] Adjacency is connection. Two runs laid side by side, or a run passing beside another's end, become one network that shares water. A player cannot lay two independent mains next to each other, which is exactly what "more flow means more runs in parallel" asks them to do.
2. **Laying over a run rewrites it.** [code] A new stroke sets the facing of every cell it covers, including cells of an existing run. Crossing or extending an old main can open a port in the middle of it, or cap its end.
3. **Lift takes pipes with roads.** [code] In play, Lift removes pipe under every road tile it lifts (`eraseRoad` branch). Tidying a street silently cuts a main, and there is no way to lift pipe alone.
4. **Ends that lose their water start pouring.** [code] An end faces water because water stood there when it was laid. When a flood recedes, a reservoir is drunk, or a river shifts, that port faces air and discharges onto the ground. The game claims "a game pipe never spills".
5. **Runs to nowhere are accepted silently.** [code] Both ends capped is legal, so the player pays for a pipe that does nothing and is told nothing.
6. **Gravity is invisible.** [seen and code]
   - Whether a run flows depends on the water's surface standing above the building's floor, measured in half steps the player never sees.
   - A run that can't flow looks the same as one that does.
   - In the singularity fixture the 58-tile gravity run from the terrace pond is drawn and empty (0.00 in every cell checked), and nothing in the game says why.
7. **Buried runs disappear.** [seen and code] A run that dives under a rise fades to a ghost unless x-ray mode is on. Its middle is sealed and its ends are wherever it daylights.
8. **"Beside water, not in it" fights the river.** [code] A run must not touch a wet tile, and its end must touch one. Water levels move (floods, sloshing, the AI's reservoirs), so the same drag is accepted one second and refused the next.
9. **Intakes are fussy.** [code] An end feeds a building only if its facing points straight into one of the building's tiles. Ending a run diagonally, or running it along the building's side, feeds nothing.
10. **Pumps are a puzzle.** [code] A pump house is a separate building that must stand beside water, and the run's end must face it. The player has to place the pump, then lay the pipe to face it exactly, and nothing tells them a pump is needed or how high it lifts (`PUMP_HEAD` 8 half steps).

**Visuals**
11. **It looks like a dashed line.** [seen] Each cell's two limbs pinch at the cell face, so a straight run is a string of beads with notches, flat and dark. There's no casing, shading, joints or fittings.
12. **No flow, no direction, no state.** [seen] You can't tell an empty pipe from a working one, which way water moves, or whether an end is an intake, an outlet or a cap.
13. **Drawn by the wrong system.** [code] Pipes live in the drips GPU pass, so they sort as drips. They can't be clicked, hovered or labelled, and every visual change means editing a shader-fed bar list.

**Tool and feedback**
14. **No preview of the result.** [code] The drag shows the cells. It doesn't show where the ends land, what they connect to, the cost, or whether it will carry water.
15. **No readout.** [code] Clicking a pipe shows nothing. Only the Data Centre panel's tank shares hint at it.
16. **Two tools, two meanings.** [code] The editor's click-to-rotate facing tool and the game's drag tool share one layer with different rules.

## Design principles

1. **A main is built, not simulated into existence.** A run has a known source, destination, capacity and flow, worked out when it is laid and whenever the water changes. Not 1D shallow water per cell.
2. **What you see is what flows.** Every run shows its state: flowing (animated, direction shown), dry, blocked, needs a pump. Every end shows what it is. Clicking a run says why.
3. **Connections are explicit.** Pipes join only where the player joins them, as roads do. Laying a run never changes another run.
4. **The tool predicts.** Before you let go, it shows the cost, where each end connects, and the expected flow, or why there won't be any, with the fix one click away (add a pump).
5. **No silent failure.** A run that can't carry water says so the moment it's laid, and afterwards in the run's tooltip and the Data Centre panel.
6. **Keep the editor's toy.** The physics pipes stay for the editor and fixtures, as "spouts". The game never uses them.

## 1. The model: mains, not facings

**Layers**
- **New `grid.main`:** a CONNECTION MASK per cell (N/E/S/W bits, as roads use for ramps), set only by a stroke, never by adjacency. A cell links to a neighbour only if both carry the shared bit.
- **New `grid.mainEnd`:** a FITTING per cell, for the end pieces:
  - `intake` at water;
  - `outlet` into a building;
  - `pump` (an intake with a pump);
  - `cap`.
  Middle cells have none.
- **Old layers:** `grid.pipe`/`pipeZ` stay for the editor's spouts only.

**Height**
- Every main lies **on the ground**, following it up and down, carried on short stilts over dips and over road tiles. Never buried, so there are no ghosts and nothing sealed.
- Height only matters as **head**: the source's water surface against the destination's sill, plus any pump.

**A main network** is the set of cells linked by masks (flood fill over masks, not adjacency). Each has:
- **sources:** intake fittings, each on a body of water, and the water surface there now;
- **sinks:** outlet fittings, each into a drinker;
- **pumps:** on intakes; each adds `PUMP_HEAD` and costs upkeep while it runs.

**Flow: a steady-state solve, not a time step.** For each network, on any edit and about once a second for water changes:
- **Head:** `head = max over sources (surface + pump lift) − sink sill`, for each sink.
- **Flow per sink:** `capacity(length) × sqrt(head / REF_HEAD)`, capped at the run's bore. Plain hydraulics a player can be told: more head, more flow; longer runs carry less.
- **Shared mains:** the flow is split across sinks by their demand.
- **Drawing water:** the flow is taken from the source's water, really, as now (`addWater`), at the intake's column.
- **Water gone:** if a source's water drops below the intake, the intake is DRY. The run's state is "dry", the flow is 0, and **nothing is ever poured out.** That fixes 4.

**Tanks:** they stay (`world/projects/cooling.ts`). A sink adds its flow to its building's tank each frame, and the tank logic is unchanged.

**What this removes from the game path:**
- `stepPipeFlow` (the editor keeps it);
- ports and Torricelli;
- `isSealed`;
- `pipeGrade`;
- `facingFor`;
- the drips at open ends;
- the "beside water, not in it" refusal: an intake fitting is placed AT the shore and may stand in shallow water.

**Capacity numbers:** kept from today's measurements (`pipe-capacity.test.ts`), so balance holds:
- a short gravity run with 2½ slabs of head feeds about 20 agents;
- a pumped run feeds about 12.
These become constants in a new `game/mains.ts`, pure and testable.

## 2. The tool: lay a main like a road, see what it will do

**Laying**
- **Drag from source to destination.** The path auto-routes like the AI's route: right-angled, round buildings and water, preferring to follow road edges. A straight-line drag still works as before.
- **Where it may go:** across roads (it rides over them on a little bridge) and along the shore.

**Snapping the ends**
- An end dragged onto water becomes an **intake**: any wet tile, or the shore tile beside water.
- An end dragged onto, or beside, a drinker becomes an **outlet**: any side, any tile of the building. That fixes 9.
- An end dragged onto an existing main becomes a **junction**: the only way to join two runs. That fixes 1 and 2.
- Anything else becomes a **cap**, shown in red with "This end goes nowhere".

**The live preview, while dragging**
- **The route:** drawn as a hologram pipe, using the new pipe art (§3) tinted, as buildings' holograms are.
- **Each end:** labelled with its fitting and what it connects to, such as "River intake" or "Feeds the Data Centre".
- **A card by the cursor:** the cost, the predicted flow ("≈ 0.9 a second, cools ~18 agents"), or the reason there's none:
  - "The river is 3 slabs below the Data Centre: needs a pump (+$X, $Y a second)".
  - "This end goes nowhere".
  - "Joins the main from the lake".
- **A one-click "Add a pump"** in the card when one is needed, which turns the intake into a pump intake. That fixes 10: no separate pump placement.

**Refusals:** red with the reason, before release:
- through a building;
- over another main without joining it;
- over a building's site.

**Other operations**
- **Lift Pipe** is its own mode of the Lift tool (a toggle on the bar: Road | Pipe). Lifting road never touches pipe. That fixes 3.
- **Click a main** (Look tool) for a panel. It shows the source and its water level, each destination and what it gets, the head, the pump and its upkeep, the state (and why), and a "Lift" button.

**The editor:** keeps its tools. Spouts (the physics pipes) are a separate editor tool. That fixes 16.

## 3. The look: pipes as built things

**How they're drawn**
- Mains are drawn as **sprites from a baked atlas**, like the movers (`agents/town-render.ts`). A piece per connection shape is baked once per scale and put in the band layer at its cell, so it sorts with buildings and roads and can be hit-tested.
- **Shapes:** straight, elbow, tee, cross and end, in 4 rotations, plus a stilted variant for dips and road crossings.
- **The tube:** a round tube with a lit side, a shaded side and a highlight. Flange rings sit at joints every few tiles, and supports stand where the ground dips. The colour is a galvanised blue-grey for the player's mains and violet-banded for the AI's.

**Fittings**
- **Intake:** a grated mouth half in the water, with a little ripple ring (foam) when drawing.
- **Pump intake:** a small pump housing with a turning wheel while running and a puff of exhaust.
- **Outlet:** a valve wheel and a flange into the building's wall.
- **Cap:** a red end cap.

**Flow state**
- **Shown along the run:** a scrolling dash of water colour inside a translucent band on the tube's top, moving from source to sink at a speed set by flow.
- **States:**
  - dry: no dash, the tube dull;
  - needs a pump / no head: an amber dash pulsing backwards and a "!" at the intake;
  - full or blocked: the dash stops at the outlet, which shows a small "tank full" tick.

**Overlay:** a "Water" overlay (Mood/Labels style, on the build bar while the Pipe tool is in hand, and as a toggle) dims the town. It shows every main coloured by state, each drinker's tank as a ring, the intake water levels, and head numbers along runs.

The drips pass no longer draws game pipes. It keeps the editor's spouts. That fixes 11, 12 and 13.

## 4. Mechanics around the main

- **Floods:** a flood that covers a main does nothing to it, since it's sealed. A flood that covers an outlet's building does what it does now. An intake on a river that floods rises with it, which means more head for a while: a nice beat.
- **Pumps:** upkeep while running, as now (`pumpUpkeep`). A pump only runs while its network's sinks want water: tanks below full, no upkeep when idle. That's new, and fixes the "pumps cost money for a full tank" waste.
- **Several intakes:** they add their flow, each limited by its own head. Several outlets are split by demand. One big main can feed a district, so the "more runs in parallel" rule is replaced by a **bore upgrade**: click a main and pay to double its capacity. One pipe size stops being a rule nobody can see.
- **The AI:**
  - `pipe-route.ts` returns a mains route (cells and fittings), validated by the same `layMain` the tool calls.
  - The Machine's **Coolant Loop** becomes literally visible: the AI's mains are joined in one network.
  - The AI's reservoirs get an intake.
  - `neededPipe` uses the solver's predicted flow, not a guess.
- **Training "The river" level 1** ("gravity before pumps") becomes "its mains prefer gravity", the same rule in the router.

## 5. Saves and migration

- **Today's game pipes** (`grid.pipe` cells laid in play) are converted on load:
  - masks come from the cells' adjacency along each existing network, which is how they behave today;
  - fittings come from today's ends: drinker → outlet, pump → pump intake, water → intake, capped → cap;
  - the old layers are cleared for those cells.
- **Spouts:** editor maps keep `grid.pipe` as spouts.
- **Save format:** a version bump of the map format with a migration in `world/io/serialize.ts`, tested on a fixture with merged parallel runs, so we can check the conversion keeps them merged rather than "fixing" a player's save behind their back.

## 6. Phases (each committed to `main`, with tests, `npx tsc -b` and eslint)

| # | Phase | What lands |
|---|---|---|
| 1 | **The model** | `grid.main` + `grid.mainEnd` layers, save support, `game/mains.ts` (pure capacity/head/flow), the network flood fill over masks, the steady-state solve. Unit tests: parallel runs stay apart, a junction joins, a dry intake stops flow and spills nothing. |
| 2 | **Game cooling on mains** | Tanks fed by sinks. `runPipes` no longer runs game pipes. Capacity constants calibrated against today's measured numbers (`pipe-capacity.test.ts` rewritten to the new model). |
| 3 | **The tool** | Auto-routed drag, end snapping, the live preview card with cost and predicted flow, Add-a-pump, refusals with reasons, Lift Pipe mode (road lifting stops touching pipe). |
| 4 | **The look** | The atlas pieces and fittings, sorted in the band layer; flow dashes and state colours; the drips pass stops drawing game pipes. |
| 5 | **Readouts** | Click-a-main panel, the Water overlay, hover tooltips, Data Centre panel lines per main, the hints rewritten. |
| 6 | **The AI** | Router returns mains; `layMain` for the tool and the AI alike; the AI's mains violet; Coolant Loop shown as the AI's joined network; reservoirs with intakes. |
| 7 | **Migration** | Old game pipes converted on load; the editor's spouts split off as their own tool. |
| 8 | **Upgrades and balance** | Bore upgrade; pump runs only on demand; re-measure cooling cadence (the singularity fixture's runs, `pipe-capacity`), and the AI cooling tests. |

## 7. Measures and guards

- **Invariants, as tests:**
  - laying a run never changes a cell outside its stroke;
  - lifting road never changes a main;
  - a dry intake never adds water to the map;
  - the predicted flow in the preview equals the flow the solver then delivers, within 5%.
- **Fixture:** the singularity fixture gets a "pipe yard":
  - a gravity main;
  - a main needing a pump, with and without one;
  - two parallel mains;
  - a junction;
  - a run to nowhere;
  - a reservoir intake drunk dry.
  Each is checked by state in a test and by eye in the browser.
- **Performance:** the solve runs on edit and about 1 Hz, with network counts in the tens, and the pieces are sprites. Measure the frame with `__waterBench` before and after phase 4. Pipes leaving the drips pass should make it cheaper.

## Open questions

1. **Buried mains.** Dropping burial makes everything visible and simple. Do we want an "underground" option later, say for running under a plaza, shown by the Water overlay only? The proposal: no, not now.
2. **Auto-route vs straight drag.** Auto-routing is the friendlier default, but sometimes a player wants a run exactly where they drew it. The proposal: auto-route only, and add a way to force a straight run only if playtesting shows it's missed.
3. **One network per main or shared?** Allowing junctions means one big shared main can feed everything. Is that too strong against "more mains" as a cost? The bore upgrade and the length penalty are the brakes. Measure in phase 8.

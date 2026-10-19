# The Data Centre drinks: cooling water by pipe

**Status:** built on `singularity-overhaul`, phases 1–8. Balance as measured: `WATER_PER_AGENT` 0.05 — a 20-tile gravity run with the water 2½ slabs up carries 0.95 a second (20 agents); `PUMP_RATE` 0.85 gives a pump's run 0.54 a second (12 agents). Not done: Paranoid and Hydrophile routing (a route must reach water, so keeping clear of it is not yet meaningful).

## Context

Today a rack is powered just by being within `RACK_RANGE` of a finished Data Centre (`world/projects/racks.ts`), and the AI's own buildings run free. The map already has real water:
- a GPU column solver for rivers, lakes and springs;
- **pipes** with real hydraulics (`world/water/pipes.ts`, `pipe-flow.ts`). Touching pipes form one network. Every open end ("port") moves water down the level difference: an end under a pool draws, an end in the air pours out, a full run goes under pressure. Pipes draw in both the editor and the game (`render/drips-gpu.ts`).

Pipes are editor-only so far, though. This feature makes the Data Centre, and the AI's own buildings, need cooling water, carried by pipes the player (or the AI) lays from a river, lake or spring.

**Decisions taken (Q&A):**
- **Short of water:** the share of demand that arrives is the share of agents that run at full power. The rest run at half, like an out-of-reach rack. Smooth, no cliff.
- **Uphill:** a **pump house** pushes water up a run; downhill, gravity does it for free.
- **Laying pipes:** a player **Pipe tool** in the build bar, dragged like a road, paid per tile, on your own land.
- **Without water:** the Data Centre runs 2 agents at full power.
- **One pipe size:** more flow means more runs in parallel.
- **Pumps cost money while they run** (`PUMP_UPKEEP` a second), unpaid they stop.
- **Also:** the AI lays pipes; the AI's own buildings drink too; what is drunk really comes out of the river or lake; training on "The river" cuts demand while it runs.

## 1. Demand, the tank, and power

`game/cooling.ts` (pure) and `world/projects/cooling.ts` (map reading). Each drinking building has a small **tank**.

| Drinker | Demand, units a second | Note |
|---|---|---|
| Data Centre | `WATER_PER_AGENT` × agents running | the main one |
| GPU farm | 2 × `WATER_PER_AGENT` × its agents | |
| AI node | `WATER_PER_AGENT` × its agents | |
| Compute spire | `SPIRE_WATER` flat | its light column dims dry |
| Monolith, drone hangar | none | |

- **Training on The river:** demand ×`RIVER_COOLING` (0.5) while it runs.
- **Tank:** holds `TANK_SECONDS` (30 s) of demand, so a pipe that surges, or a short gap in supply, doesn't flicker the power.
- **Consumption:** each second the drinker takes its demand from its tank. What it gets, against what it wanted, is its **supply share** (smoothed over a few seconds).
- **Power:** the Data Centre's supply share is the share of the powered racks' agents that run at full; the rest count as unpowered (`UNPOWERED_SHARE`, half). A dry AI building runs its own agents at half.
  - This enters through `rackReading` → `agentsAtWork` → `agentBonus`. The meter (`singularityRate`) counts agents at work the same way, so a dry Data Centre also slows the AI.
- **Two agents without water:** every Data Centre runs `DRY_AGENTS` (2) agents at full power with no water at all; it's the demand of everything beyond those two that must be piped in. An unpiped Data Centre therefore runs 2 agents at full and the rest at half. Old saves and early Data Centres work, but barely, so piping is the Data Centre's first real job. The AI's own buildings get no allowance.
- **Offline:** time away uses the supply share as it stood when you left (steady state). There is no fluid simulation offline.

## 2. Water in: the Data Centre as a pipe end

In `runPipes`, a **port whose mouth opens onto a drinker's footprint** is an **intake** into that drinker's tank, instead of pouring onto the ground:
- It moves water from the pipe into the tank, up to the room left in the tank, at the same orifice rate any port has, with the tank treated as an open surface at the mouth's sill. So the pipe has to bring water there with head. Nothing is pulled through for free.
- It's all CPU-side (`field.pipe` and the tank), so it needs no GPU readback. Only the far end, drawing from a pool, touches the column field, and it already does.
- **Water drains the source:** the drawing end takes the water out of the pool through `addWater(…, -move)`. A small pond really empties, a spring tops one up, and a river is fed from its inflow.
- **Saves:** tanks are runtime state, not saved. They start full on load, so a reload never blinks the power.

## 3. The Pipe tool (game)

A **Pipe** tool in the build bar, beside Road. It appears once the Data Centre's gate opens.
- **Laying:** drag a straight run like road, at `PIPE_COST` a tile, new tiles only, all or nothing, on your own land. It follows the ground grade, burying under rises, as the editor lays pipe (`layPipe`, `pipeGrade`). It can run under roads but not through buildings or water.
- **Ends face themselves:** the editor's facing rule (`facingFor` points at the lowest neighbour) is for drips. The game's rule for each end of a stroke is:
  - beside water: face the water, so it draws;
  - beside a drinker's footprint: face it, so it's an intake;
  - beside a pump: join it;
  - otherwise: **capped**. A game pipe never spills onto the ground by accident.

  Joining a run re-faces the old ends so they don't stay open into the join.
- **Lifting:** the Lift tool lifts pipe as well as road, free, and the water in the run spills (`spillOrphaned`, as now). Demolish doesn't touch pipe.
- **Readout:** hovering a pipe shows its network's flow into each intake ("12.4 a second into the Data Centre"), using `pipeLevelAt` and a per-network meter from the intakes.
- **Undo window:** a run can be undone like a build.

## 4. The pump house

A 1×1 building, `pump`, placed **on the water's edge** (beside a pool) with a pipe cell next to it. It counts as a pipe cell of its network.
- **Lift:** it draws from the pool beside it as a port does, but as if the outside surface stood `PUMP_HEAD` half steps higher (8, one full slab of height per 2). So it pushes water up a run until the far end is that much above the pool.
- **Pumps in series:** each one lifts further. That's the answer for a Data Centre on a hill.
- **Running cost:** `PUMP_UPKEEP` a second while it pumps; unpaid, it stops.
- **Looks:** a small brick house with a turning wheel (looks in `looks.ts`), with a splash at its intake when running.
- **Feature gate:** with the Data Centre, like the Pipe tool.

## 5. Showing it

- **Data Centre panel:** a **Cooling** section. "Cooling 78% · 9.4 of 12 a second", a tank bar, each intake's network and its flow, and the pumps with their state. A warning line when under 100%: "Running hot: 4 of 16 agents at half power."
- **Map:**
  - Dry, the Data Centre's glow turns orange-red and pulses slow (`ai-layer.ts`, the existing glow and ring).
  - A full tank gives a thin vapour plume off the roof.
  - The data links to racks dim with the supply share.
  - A dry AI building flickers, using the existing unpowered-rack flicker.
- **Hint:** the first time the Data Centre runs under 100%, a hint card says "The Data Centre needs cooling water: pipe it in from the river (Pipe tool)."
- **Building info:** a tooltip line on each drinker: "Drinks 3.2 a second · cooled 100%".

## 6. The AI lays pipes

- **Router:** `world/ai/pipe-route.ts`, a pure function. It runs A\* over the company's land, from any drinker short of water to water. Its costs:
  - a pipe tile, plus extra per climb;
  - free under roads;
  - blocked by buildings;
  - a pump needed for each `PUMP_HEAD` of rise, placed on the shore.

  It returns a list of steps (pipe runs and pumps), each valid under §3 and §4.
- **AI mode:** a new step kind, `pipe`. When a drinker is under 90% supplied and AI mode can pay, the route comes first, ahead of lots. It's shown on the masterplan ghost in cyan, with pumps as cyan squares.
- **The takeover AI:** a new action, `pipe`, from the Colleague stage on, flown out by drone like the rest. At the Overseer it digs **cooling ponds** (an existing action) beside its farms and pipes them in, so the ponds finally do something.
- **Style:** Paranoid routes keep `DRY_MARGIN` off the river and prefer a spring; Hydrophile prefers the river.

## 7. The fixture

`?fixture=singularity` (both the editor and the game) gains water:
- **A spring-fed pond on a terrace** north-west of the town, two slabs above it (fixture helpers `pond`, `tap`, `SPRING`).
- **A gravity run** from the pond down to the Data Centre's intake: one end under the pond, the other facing the Data Centre's footprint. It feeds the Data Centre at about 100%, with the water moving along it visibly.
- **A short river along the south edge**, below the town, with a **pump house** and a run up to the GPU farm. This shows a pump lifting water uphill.
- **A second, empty run** from the river to the compute spire, ending a tile short, so the spire shows dry and the cooling warning shows. The game version lets you finish it with the Pipe tool.
- **The editor's stage cycle** keeps running; the cooling state is real either way.

## 8. Phases (each a few commits; tests, tsc, eslint at each)

1. **Cooling model:** demand, tanks, supply share, the two dry agents, power through `rackReading`, `agentBonus` and the meter. Pure-model tests.
2. **Intakes:** intake ports in `runPipes`, the drawing end draining the source. Hydraulics tests: a fed run fills a tank; an empty pond stops it; a reversed grade delivers nothing.
3. **The Pipe tool:** a play-mode stroke, cost, own-land rule, end facing, lifting, readout, undo.
4. **The pump house:** the def, the head rule, upkeep, looks. Tests: lifts water up `PUMP_HEAD`, two in series, unpaid stops.
5. **Showing it:** the panel's Cooling section, the map's dry glow and plume, the hint, tooltips.
6. **The AI:** the router; AI mode's `pipe` step and its ghost; the takeover's `pipe` action; ponds piped in; style.
7. **The fixture:** terrace pond, gravity run, river, pump and the unfinished run, in the editor and the game.
8. **Balance:**
   - measure a pipe's steady flow over typical heads;
   - tune `WATER_PER_AGENT` so one gravity run feeds about 16 agents and one pump about 12;
   - tune `PIPE_COST` and `PUMP_UPKEEP` against rack and agent prices;
   - a sim guard that a typical late run keeps its Data Centre above 90% at a sensible spend.

## 9. Verification

- **Unit:**
  - tank, demand and share maths;
  - river training;
  - the starter supply;
  - `agentBonus` and the meter at a share;
  - intake ports;
  - pump head;
  - end-facing rules for the Pipe tool;
  - pipe cost and the own-land rule;
  - the router returns valid, connected, affordable steps;
  - AI mode lays pipe before lots when dry.
- **Browser** (the isolated server only):
  - the fixture's terrace run feeds the Data Centre at 100%;
  - the spire shows dry, and finishing its run with the Pipe tool fixes it;
  - draining the pond (editor drain tool) drops the Data Centre's cooling and dims its glow;
  - screenshots of each.
- **Saves:** an old save with a Data Centre and no pipes keeps working, with 2 agents at full and the rest at half; tanks start full on load.

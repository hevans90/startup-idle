# Seaports and boats, rebuilt

**Status:** phases 0–8 built, 2026-11-11, with the gaps listed under "Built so far". **The pipe plan is done; of what waited for it, the slop loader, the ferry's far bank and the investor's yacht are built** (2026-11-12), the yard gantry loads the lorries and a port straightens a slanted bank (2026-11-13), the wake's foam is the water's own, a tug turns the ships, and the balance pass is done: nothing is left of the list under "Left to do, after the pipes". Written from a read of `src/world/boats/*`, `structures/place.ts`, `structures/def.ts`, `structures/seaport-renderer.ts`, `game/build-cost.ts` and the events that touch ports. **Seen in the browser** since: play-tested in the game by day and at night (2026-11-11), every bank facing, a ferry call, a shoal dredged until ships came, and draw-list rebuilds counted (about 0.4 ms a frame with 19 boats, the per-band mover groups only). Claims below tagged [read] date from the first write.

## Why

A seaport today is a tap. Build one, boats appear, each pays a fee, they leave. There is nothing to decide after placing it, the three tiers are the same thing made longer, and placing one is unreliable in ways the game does not show. The boats and ports are also the last things on the map still drawn as flat shapes, beside baked cars, people and props.

The aim: ports the player places with confidence, runs with a few real choices, and enjoys watching.

## How it works today

- **Ports** (`def.ts`): three tiers, 2×2, 3×2, 4×2, with 1, 2, 3 berths and calls of 20, 15, 10 seconds. Always long along x; a structure has no facing.
- **Rivers** (`boats/river.ts`): `mapRiver` marks tiles deeper than `RIVER_DEPTH` and fed from the map's edge, about once a second, from the live water. Lakes are never rivers.
- **Traffic** (`boats/traffic.ts`): a river with a port sends boats in over its inflow as fast as its ports can turn them round. Each boat calls at one port, waits its turn, ties up for the port's time, and leaves by the exit.
- **Pay** (`build-cost.ts` `portCallFee`): per call, 0.5, 0.75 or 1 second of the company's income by tier, with a floor.
- **What else touches them:** a convoy doubles the fee (treble near the Conference Centre) and cuts the price of building loads; Market Maker turns ships round half as fast again; one investor asks for port income; a flood shuts ports. Away from the game, ports pay at the last rate seen.
- **Drawn:** a boat is one sailing boat, 0.84 of a tile long, redrawn as shapes every frame (`boats-render.ts`); the AI's freighter is the same boat in violet. A port is a row of shed and yard columns on a stone quay, drawn as boxes (`seaport-renderer.ts`). The wake is foam marks on the water's surface.

## What's wrong

### Placing one [read]

1. **A port cannot turn.** It is always long along x. On a bank that runs along y, only its short end meets the water.
2. **Berths are silently lost.** `berthsBeside` takes the river tiles along the one side with the most of them. A tier 3 with two river tiles beside it gets two berths; one touching the river at a single tile gets one. The player pays for three and is told nothing.
3. **One tile is enough to pass.** `riverside` holds if any one footprint cell has a river tile beside it. A port can be accepted almost wholly inland.
4. **The art does not know where the water is.** The renderer draws its quay across the footprint's fixed front. Nothing reads which side the berths are on, so a quay can face inland while boats tie up at its end.
5. **The bank moves.** What counts as river is the live water over a depth, re-read each second. A flood, a drought or a slosh changes where a port may go, and shallow margins are not river, so the bank the rule sees is not the bank on screen.
6. **Height is ignored.** The footprint levels to its median height. Nothing compares that with the water, so a port can stand on a cliff several half steps over the river with boats tied up below it.
7. **Road and river fight on a fixed shape.** A port also needs road frontage. With no facing, back row to the road and front row to the river only works on a bank that runs the right way.
8. **Nothing is shown before you click.** The ghost says yes or no and one reason ("not on a river bank"). Not where it may go, how many berths it will get, where boats will lie, or whether a boat can reach it at all.
9. **Upgrades grow blind.** `planUpgrade` tries growing left or back along x, whichever fits. It can grow away from the water, and it levels new ground to the port's height whatever is there.
10. **No check that a boat can get there.** A berth in water too shallow, or cut off from the inflow, is still a berth.

### Playing with them

11. **No decisions.** After placing, the only choice is to upgrade.
12. **The fee is unconnected to the town.** Nothing is loaded or landed. A port pays the same whatever stands behind it.
13. **Tiers are a bigger number.** More berths, shorter calls, a larger fee. No tier adds something new to do.
14. **Nothing can go wrong that the player can fix.** The river sends boats exactly as fast as ports clear them, so there is never a queue worth looking at.
15. **One kind of boat, one kind of water.** Rivers only; one hull.

### Looking at them [read]

16. **Drawn, not built.** One boat of flat shapes; ports of plain boxes; no cranes that move, no cargo, no people, no lights of their own.
17. **Boats do not touch the water.** They ride it and leave foam marks. The solver never feels them.
18. **A call looks like nothing.** A boat stops, a number floats up, it goes.

## Design

### 1. Placing: a port is a length of quay

**Lay it along the bank.** With a port in hand, press on a bank tile and drag along the water's edge. The run of edge is the quay; the port lies behind it, two tiles deep, facing the water. Two tiles of quay is tier 1, three is tier 2, four is tier 3.

- **A facing, stored.** `Structure` gains the side its quay is on. The footprint turns with it; the renderer, the berths and the gate all read it.
- **Every quay tile must have water beside it** that a boat can float in. Berths are those tiles, so a port always has the berths its tier says.
- **A steady bank.** Placement reads the river as it normally stands (the standing pool, as `floodBaseline` already does for floods), not this second's water. A flood or a drought no longer moves where a port may go.
- **Built at the water.** The quay is cut or filled to one half step over the normal water level, with a wall drawn down to the water. A bank more than a few half steps over the water is refused, "Too high above the water".
- **The gate is on the landward side**, and the preview shows where. Road frontage is asked of that side only.

**Shown before you click.**
- every bank a port could go on is lit while the port is in hand, coloured by the largest ship that can reach it;
- the ghost shows each berth, where a boat will lie, the gate, and the channel a boat will take from the river's mouth, green where it floats and red where it grounds;
- the card gives every reason at once, not the first, and the price.

**Upgrades run along the quay.** Drag from a port's end to extend it; the same preview, the same rules. A blocked end says what blocks it.

**Old saves.** A port already standing is kept. It is given the facing of its best water side and whatever berths that side has; where that is fewer than its tier, its card says so and offers to move it once, free.

### 2. Ships that need water

Three sizes, each needing more of the river:

| Class | Length | Needs | Calls at |
|---|---|---|---|
| Boat | under a tile | any water that floats it | any port |
| Coaster | about 1½ tiles | a deeper channel; room to turn at the port | tier 2 and up |
| Ship | 2–3 tiles | a deep channel all the way; a turning basin; no low bridge on the way | tier 3 |

- **The channel is real.** Depth is read from the river as it stands. A drought that drops the river turns big ships away before small ones; a flood closes the quay, as now.
- **Dredging.** A Dredge tool, opened with tier 2, lowers the river bed along a drag, priced a tile. The water solver does the rest. It is the player's way to bring bigger ships to a port the river does not yet reach.
- **Waiting.** A ship that finds no berth anchors off the port in a line you can see, and leaves after a while unpaid. Now a queue means something.

### 3. Berths you fit out, and lines you choose

**Tier is how much quay. A fitting is what a berth does.** Each berth takes one fitting, chosen on the port's card and changed at will:

| Fitting | Opens at | What its calls do |
|---|---|---|
| **Trading quay** | tier 1 | The fee as today. The plain choice |
| **Ferry ramp** | tier 1 | New hires arrive sooner (the wait in `awaitingArrival`), and homes across the water count as near |
| **Cargo crane** | tier 2 | Lands building materials: site loads cost less while it works (the convoy's `loadPriceMult`, earned and kept by trade, not only by the event) |
| **Hardware berth** | tier 2, with the Data Centre | Racks and the AI's buildings cost less, by what is landed |
| **Slop loader** | tier 2, with sewers | Barges take slop away for a fee: an exit for a sewer that is neither a processor nor the river |
| **Container gantry** | tier 3 | Ships only. The largest fee; convoys call here |
| **Pontoon** | tier 3 | Yachts. Valuation grows a little faster, and an investor arrives by water when a term sheet is due |

What each is worth depends on the town: a cargo crane while building, a slop loader once the sewers are full, a trading quay when nothing else is short. Set and left, it is still an idle game; looked at again when the town changes, it rewards the look.

**The yard, and the road out.** A fitted berth that lands things fills the port's yard; lorries carry it out by the gate. A full yard slows the cranes. So a port wants a good road behind it, and a second port can be worth more than a bigger one. Nothing is lost when it jams; it only slows.

**Away from the game.** Each fitting's rate is kept as port income is today, and credited the same way.

### 4. The look

**A baked fleet.** Built as low-poly models and baked to sheets like the cars (`agents/cars/raster.ts`), 32 headings, a tinted paint layer and trim:
- dinghy, fishing boat, ferry, tug, slop barge, coaster, container ship, yacht, and the AI's crewless freighter;
- cargo as its own layer, so a ship rides loaded or empty and a container ship shows how much it carries;
- liveries by line, as bus routes have colours;
- bobbing and heel kept, by offset and shear as cars take ramps.

**Lights.** Red and green at the bow, a white masthead, cabin windows, through `agents/lamps.ts`; pools of light on the water at night.

**Boats move the water.** A hull under way pushes a little of the river aside through the arrivals list the solver already takes. The V of a wake is then the water's own, with the foam field marking it; the drawn foam marks go.

**A port built of parts,** along its quay, facing the water:
- a quay wall down to the waterline with fenders, bollards and ladders;
- sheds, a harbour master's tower with a beacon, a gate with a barrier;
- **tier 2:** a crane that slews and lifts;
- **tier 3:** gantry cranes that run on rails and carry boxes between ship and stack;
- container stacks whose height is the yard's fill, so the port's state can be read from across the map;
- dock workers from the people sheet, lorries at the gate from the fleet;
- floodlights at night.

**A call you can watch.** A ship slows as it nears, a tug turns the big ones in the basin, it lies alongside along the quay with lines to the bollards, the crane works for as long as the call lasts, it sounds its horn and goes.

**State without words.** A lamp at each berth: green free, amber working, red blocked. What a ship carries shows on hover.

### 5. Moments

- **A convoy** is a line of ships in one livery, not a multiplier nobody sees.
- **The first ship** up a newly dredged channel gets a horn and a notice.
- **A yacht** at the pontoon when investors come.
- **Drought and flood** show at the port first: big ships held off, then the quay awash.

## Keeping the performance

- Boats stay few: today's cap is 2 and 2 a berth. Baked sprites cost less than shapes redrawn every frame.
- Cranes move by transform only. Stacks and cargo change by texture frame, on a cargo event, never every frame, so no draw list is rebuilt while a port works.
- A wake is a handful of cells a boat through the arrivals list. Capped, and measured on a still-flood total so it neither makes nor loses water.
- The channel's depth map is worked out with the river map, once a second, as now.
- Lorries count against the town's 80 vehicles. Port lorries are few and capped a port.

## Phases

| # | Phase | What lands | Guard |
|---|---|---|---|
| 0 | **Pin today's faults** | Tests: a tier 3 on a bank along y; one touching at a corner; one on a cliff | The tests, failing as described or the item struck |
| 1 | **Placing** | Facing; quay rule; steady bank; height rule; lit banks; the ghost with berths, gate and channel; every reason; upgrades along the quay; old saves | A port always has its tier's berths; no placement changes validity in a flood; old saves load with ports working |
| 2 | **Ships and water** | Three classes; depth and turning; anchoring and leaving; Dredge | A coaster is refused a shallow channel and accepted once dredged; water conserved |
| 3 | **Fittings** | Trading quay, ferry ramp, cargo crane, hardware berth, slop loader, gantry, pontoon; the port's card; rates kept for time away | Each fitting's effect measured in the balance sim; income with only trading quays equals today's |
| 4 | **Yard and road** | Yard fill, lorries by the gate, slowing when full | A port with no road out slows and never stops paying its fee |
| 5 | **Look: the fleet** | Baked boats, cargo layers, liveries, lights | By eye in a harbour fixture at three zooms, day and night; frame time before and after |
| 6 | **Look: wakes** | Hulls push the water; drawn foam marks deleted | Still-flood total unchanged; `?gpucheck` |
| 7 | **Look: the port** | Quay, sheds, tower, cranes that work, stacks, workers, floodlights, berth lamps | `_buildInstructions` flat while a port works |
| 8 | **Moments** | Convoy as a fleet, first ship, yacht, drought and flood at the port | The events' tests on the new traffic |

Phase 1 stands alone and fixes what is broken. Phases 5 and 7 need nothing from 2–4.

## Built so far

**Phase 0.** The three faults were shown on today's code before it changed: a tier 3 on a bank along y passed with 2 of 3 berths; one touching the river at a single tile passed with 1; one on ground 6 half steps over the water passed.

**Phase 1.** `boats/quay.ts`, `validatePort` and `planQuay` in `structures/place.ts`, `render/port-guide.ts`; tests in `boats/quay.test.ts`.
- A stored facing; the footprint, berths, drawing and gate read it.
- Every quay tile on the one river; the tiles that are not say so.
- The bank read from the map's standing water (`grid.pool`), not the live water.
- Built a half step over the water; refused more than 3 half steps above it.
- Road asked of the landward side only.
- Banks lit with a port in hand; the ghost shows berths, gate tiles and the way in.
- Every reason at once in the readout.
- Upgrades grow along the quay, either end, same facing.
- Old saves: a port with no facing is given its best water side on load; its card says when it has fewer berths on the water than its tier.

**Differs from §1, to decide:**
- **Placing is by hover, not by dragging along the bank.** The port turns to face the water under the pointer and one click places it. The build bar sells a tier, so a drag that sets the tier needs the bar and the pricing changed with it.
- **Upgrading is still a click on the port**, not a drag from its end.
- **No free move** for an old port short of berths. The card says so; moving is demolish and rebuild.
- **Banks are lit in one colour.** Colour by largest ship waits for the ship classes (phase 2), as does red where the way in grounds.
- **The standing water is as last saved or generated.** A map saved in a flood loads with the flood as its bank until saved again.
- **Measured:** on 15 generated maps (64², 96², 128²), a tier 3 fits on 38–79% of bank tiles. A bank on the slant takes no port; the harbour fixture's bank was straightened at its three ports for this.

**Phase 2 — ships and water.** `boats/classes.ts`; `RiverMap.depth/reach/toExitOf`; anchorage and `PATIENCE` in `traffic.ts`; the Dredge tool (`dredgeCells`, `dredgeCost`). Tests in `classes.test.ts`.
- Coaster: channel deeper than 3 half steps, tier 2. Ship: deeper than 5, tier 3, two berths, no bridge.
- Pay follows berth-time and a little over (coaster 2.2× for 2×; ship 7.5× for 6×).
- Not built: a tug, and a ship turning in a basin. Room to turn is a check, not a manoeuvre.
- Dredging is not undoable in play, and reads the map's standing water, not the live river.

**Phase 3 — fittings.** `boats/fittings.ts`, `boats/trade.ts`, `play/port-card.tsx`. Tests in `fittings.test.ts`.
- **Left out: the slop loader** (open question 4). It needs a slop inlet on a port and a link into the sewer solver, which the pipe plan is about to replace.
- **Left out: homes across the water counting as near** for the ferry. It brings hires sooner only.
- The effects are unit-tested; none has been run through the balance sim.

**Phase 4 — yard and road.** `boats/yard.ts`. Lorries are real town trucks from the port's door to where its road leaves the map, one on the road a port (open question 1: real lorries, capped).

**Phase 5 — the fleet.** `boats/models.ts`, `dev/bake-boats.ts`, `boat-sheet.ts`. Dinghy, fishing boat, ferry, yacht, lighter, drone, coaster, container ship; five 2048² pages, 2.7 MB.
- Not built: the tug and the slop barge. Pitch is not sheared; a hull bobs and leans a little.
- Lights at night are baked and wired but were only seen by day.

**Phase 6 — wakes.** `pushWater` in `boats/wake.ts`: water taken from under the stern and put either side of the bow, conserved (test).
- **The drawn foam was kept** then: at a strength that does not slop over the quays, the water's own wave did not read by eye. Replaced 2026-11-13 by foam marked on the water (below).
- Not run under `?gpucheck`.

**Phase 7 — the port.** `structures/seaport-renderer.ts`, `port-life.ts`; `liftAt`/`cargoAt` in `traffic.ts`.
- Tower cranes slew, gantries travel, each lift in step with the ship's cargo, from another hold to another stack.
- `_buildInstructions` was not counted; the design is transform, tint and alpha only.

**Phase 8 — moments.** Convoy as a fleet in one livery; a horn and a notice for the first coaster or ship at a port (`Structure.biggest`); a notice when the river falls too low.
- Not built: the investor arriving by yacht when a term sheet is due.

**Cranes, rebuilt (after phase 7).** The stroke-drawn cranes are gone. `structures/cranes/models.ts` models a ship-to-shore gantry, a luffing crane, a harbour crane and a yard gantry, baked in parts (`bun run bake:cranes`, one 2048² page). Cargo is individual boxes (`boats/cargo.ts`): on deck, on the hook, in the yard. Motion is spring-damped with a pendulum on the load. Ships hold midstream. `?fixture=cranes` shows a port on each of the four bank facings.
- Port lorries are box lorries in the port's blue; a box is not seen being set on one.
- The yard gantry travels its bay but lifts nothing.
- Seen on three of the four facings by day; not at night, and not in play mode.

## Left to do, after the pipes

Decided 2026-11-11: the pipe plan (`plans/pipe-network.md`) is done first, then these. The slop loader stands on the pipe graph and its solver, so it cannot sensibly be built before them; the rest wait with it so the port work lands as one piece.

| Item | What it is | Waits on |
|---|---|---|
| ~~Slop loader and slop barge~~ | **Built 2026-11-12**, see below | — |
| ~~Tug, and ships turning~~ | **Built 2026-11-13**, see below | — |
| ~~Ferry: homes across the water~~ | **Built 2026-11-12**, see below | — |
| ~~Investor yacht~~ | **Built 2026-11-12**, see below | — |
| ~~Yard gantry lifts~~ | **Built 2026-11-13**, see below | — |
| ~~Boxes onto lorries~~ | **Built 2026-11-13**, see below | — |
| ~~Wake foam~~ | **Built 2026-11-13**: the water's own, see below | — |
| ~~Balance~~ | **Measured and set 2026-11-13**, see below | — |
| ~~Generated banks~~ | **Measured and built 2026-11-13**, see below | — |

**Built from this list, 2026-11-12** (after the pipe plan). Tests in `boats/slop-loader.test.ts`, `ferry-links.test.ts`, `fittings.test.ts`.
- **Slop loader** (`boats/slop-loader.ts`, `loaderPorts` in `water/ports.ts`): a berth fitting for a port of two berths or more, once sewers are open. Fitted, the port has a slop inlet on each END, at the corner away from the water, so a sewer connection or a trunk ends there as at a processor. Its tank takes half a unit a second and holds 30 a slop berth; full, it backs the sewer up. A barge (the lighter's hull: none of its own is baked) calls at the berth, takes up to 20 and bills for it — half a plain call's fee for a full hold, less for less; what the company cannot pay for is left. The berth earns nothing. Refitted or demolished, what it held goes on the ground by the port. The card shows the tank's fill where a trade's meter is.
  - **Not on the landward wall**, as first built: that is where the port's road runs, and a connection may not cross a road. Seen in the browser and moved.
  - **Not done:** the tank is not saved; no barge model; the bill is not shown anywhere but in the money; not run through the balance sim.
- **Ferry, the far bank near** (`boats/ferry-links.ts`, `walkFrom` in `agents/commute.ts`): a port with a ferry ramp joins the road against its walls to every road tile within 2 tiles of its river and 12 of the port, as 4 tiles of road. So a street with no bridge to it is not cut off: its people reach their desks, and the houses there are worth what a street 4 tiles further would be. Every walk along the roads uses it — commutes and what a house is near.
  - **Not done:** nobody is seen crossing; cars and lorries do not use it; it does not need the ferries to be running, only the ramp to be fitted.
- **The investor's yacht** (`callInvestor` in `boats/traffic.ts`): when the term sheet's goal is first met in play, the next boat a river with a pontoon sends is the investor's yacht, bound for the pontoon; on its call a horn and a notice, "<investor> arrives by yacht". A goal already met when the map opens is not news, and with no pontoon nobody is sent.
  - **Not seen in the browser:** no fixture has a term sheet near its goal. Tests only.

**The yard gantry loads the lorries** (2026-11-13). `carryAt` and `LORRY_LOADS` in `boats/yard.ts`; the gantry's load in `structures/seaport-renderer.ts`; `PortLife.lorry`. Test in `boats/yard.test.ts`.
- **A port with a bay of stacks** (a Port III) has its lorry stand at the gate for 7 seconds before it goes. In that time the yard gantry fetches a box from its stack, rolls out past the back of its bay over the lorry lane, and sets the box down on the lorry's back; the lorry then drives off with it. The gantry has a spreader on two ropes now, and a box in the colour of the place it came from.
- **The sequence is one pure function**, `carryAt(e)`: to the stack, down, up with the box, across, down onto the lorry, up empty. The renderer moves the gantry to follow it, and lowers only once it stands over the place.
- **The gantry goes to the lorry, not the lorry to the gantry.** A lorry sets off from the kerb where its lane begins, which is the road's to say: on the harbour fixture that is a little past the end of the gantry's beam, whichever tile it is sent from. So the spreader reaches up to 0.3 of a tile past its rail to either side (`RTG_REACH`), and the gantry rolls 0.6 of a tile off its bay. A lorry that sets off further away than that is not loaded and does not wait.
- **Seen** (`/?fixture=harbour`, by day, one bank facing): the gantry over its stack; out over the road with a green box above the waiting lorry; the box down on the lorry's back.
- **Not done:** the box does not ride away on the lorry — it is hidden as the lorry leaves, and the lorry is the box lorry it was. Ports I and II have no gantry, and their lorries leave as before. Not seen at night, on the other three facings, or with the road somewhere other than behind the port.
- **For looking at it:** `__traffic()` and `__app` are on the window with the other hooks. A hidden tab gets no frames; `__app.ticker.update(t)` steps the clock by hand.

**Generated banks, and a port that straightens one** (2026-11-13). `straightenFor` and `STRAIGHTEN_MOST` in `structures/place.ts`; `pool` a patched layer in `edit/commands.ts`. Tests in `boats/quay.test.ts`.
- **Measured first**, on 15 generated maps (64², 96², 128², seeds 1–5; 3,778 bank tiles): a Port III fitted on 65% of bank tiles (38–79% a map) and a Port I on 81%. Of the misses for a Port III, 1,058 were a footprint tile in the river and 149 a tile of quay with land in front of it; roads, the map's edge and height made up the rest (145).
- **Decided: yes, placing straightens a bank, a little.** A port may FILL a tile of its quay the river has got into — one against the bank, with the river still in front of it — and CUT the land in front of a tile of its quay — bare ground, the river the next tile on, no higher over the water than a quay may be — to the river's bed and depth there. One tile for a Port I or II, two for a Port III, and never all of its quay. The check says what it would do (`PlacementCheck.straighten`); the placing command does it, and undo puts the bank back.
- **A straight bank is taken first.** Where the port can stand a step along with nothing to change, it stands there.
- **Measured after:** a Port III fits on 82% of bank tiles (65–91% a map), a Port I on 95%. What still misses is mostly the BACK row of the port in the river — a spit, or a bank that turns a corner — which is not a slant to straighten.
- **Seen** (`?world=1&fixture=harbour`): a Port I placed beside the big port where one tile of bank stuck out; the tile cut, and the river standing in it as deep as beside it (6.9 half steps against 6.84).
- **Not done:** the ghost does not show which tiles will be filled or cut; it costs nothing more than the port; upgrading a port does not straighten; the fill was tested, not seen in the browser.

**The wake's foam is the water's own** (2026-11-13). `foamWake` in `boats/wake.ts`; the strokes in `boats-render.ts` are gone. Tests in `boats/wake.test.ts`.
- **Marked, not drawn.** The wake is still a trail of points with two spreading arms and the churn behind the hull; each frame the columns those lie over are marked as a splash is (`markSplash`, the one way in), and the foam field is born from the marks — carried by the current, fading on its own clock, shaded with every other white on the water, and hidden by whatever stands in front of it. The per-band foam shapes, cleared and redrawn every frame, are deleted.
- **Not gated on the host's depth.** Where the device has the water, the host's copy of a column a little off the hull can be stale, and marks skipped for "dry" left almost no wake. The foam pass itself bears none on a dry column.
- **As white as its mark.** Foam born from a mark is as white as the mark and no whiter, a column wide. Marked in proportion to an arm's strength it measured as 3% of the pixels behind a coaster at full speed gone pale; eased (a power of 0.6, arms to 1 and churn to 0.9) it is about a quarter.
- **Seen** (`/?fixture=harbour`, by day): a pale V trailing a coaster under way. It is softer and broader than the drawn lines were: a column is a quarter of a tile.
- **Not done:** not baked, and no crisp arms close up; not looked at at night, under a bridge, or with a convoy in; not run under `?gpucheck`.

**The tug, and a ship turned** (2026-11-13). `tug` in `boats/models.ts` (baked: `bun run bake:boats`, 13 looks, still two pages); `stepTugs`, `swingOf`, `SWING_SECONDS` in `boats/traffic.ts`; `Boat.tug`, `Boat.swing`. Tests in `boats/classes.test.ts`.
- **A port that takes ships keeps a tug**, lying off the end of its quay. It is a boat of the fleet held where it should be by a line that moves, as a moored boat is held: so it rides the water, bobs and leaves a wake, and steers nowhere of its own. It calls nowhere, is not saved, and goes with the port or with the water for ships.
- **It meets a ship** given a berth there as she comes within four tiles, and lays itself against her bow.
- **She is turned twice.** As her call begins she is swung end for end, about her middle, to lie head to the stream; as it ends, back the way she came, and she goes. Nine seconds a swing, the tug on the side her bow is pushed from; she is held half her length off her berth at the middle of each, so her ends clear the quay. Her call is the longer by the two swings; the cranes work her in between (`swingOf` gives the work and the turn apart).
- **Ships only** (the third class). Coasters and boats come alongside as they did. A port with water for coasters and no more has no tug.
- **Seen** (`/?fixture=harbour`, by day): the tug at its home off the quay's end; a container ship caught mid-swing, square to the quay, the tug against her; the same ship after, alongside and head to the stream, the tug home again.
- **Not done:** no tow line is drawn; the tug does not go out to the river's mouth, only to the basin; the room-to-turn check is still the nine tiles round the berth and was not re-derived from the swing; not seen at night or with two ships at one port; fees are unchanged, so a ship's call earns the same over 18 seconds longer — for the balance pass.

**The balance pass, 2026-11-13** (`simulation/port-balance.test.ts`; `BALANCE=1 bun test src/simulation/port-balance.test.ts` prints the table). The balance sim (`simulate-map-run.ts`) has no rivers in it, so the ports were measured where their trade is made: the real traffic run past one port on a straight river for minutes on end, every tier, on water for each size of ship, with each fitting.

What it found, and what was done:

- **A port's trade fell with its distance from the inflow.** Boats on their way counted against its berths, so the next was sent only when the last had arrived: a tier 3 turned 8 boats a minute by the inflow and under 3 sixty tiles up. Now a port is sent, ahead, what its berths will be clear for by the time it arrives (`onTheWay`), spaced apart. Calls a minute are the same anywhere on the river: **2.5, 6.0 and 12.8** by tier.
- **The price was set on trade a port never had** (3, 8 and 18 calls a minute). It is now priced on the call and the four seconds alongside and away (`callsAMinute`): **200, 505 and 1029** at the floor, were 240, 640 and 1440. Payback, boats alone: **20, 14 and 10 minutes**.
- **A ship lost her port money.** Turned by the tug she holds two berths for about 52 seconds, and at 7.5 boats' fees a port with ships earned a quarter less than the same port with coasters. She now pays **16**. Fees a minute against water for boats alone: tier 2 with coasters a fifth more; tier 3 with coasters a fifth more, with ships a third more.
- **Ships stuck bow to the quay.** On her berth's own tile a ship was steered into the wall, a little too far from where she lies to tie up, and stayed there. She is steered at her lie. Two boats given berths together that crossed on the way in now change berths.
- **A waiting ship gave up before the call ahead of her ended** (45 seconds' patience against a 48-second call). Patience is now the longest call at the port, and 45 seconds over.
- **Mixed ports stood half idle.** A boat came for a fitting chosen in turn, whether or not its berth was free; one waiting for the quay held up ships for the gantries; and when a ship was wanted and could not be sent, nothing was. Now a boat is sent for a fitting that has room, a ship passes a boat waiting for other berths, another size is sent when the wanted one has no berth, and a ship comes for a fitting only where her whole length is of it (a lone gantry excepted).
- **Gantry: fee and a quarter**, was a half. Two gantries and a quay earn **1.6 times** a tier 3 of quays (27 against 17 boats' fees a minute); three gantries 1.3 times.
- **The fittings' meters never filled.** At 0.12 a call against three minutes' run-down, a tier 1 ferry ramp held under an eighth. Now 0.2 a call against five minutes: a ferry ramp, a crane beside a quay and a pontoon beside two quays each hold over 0.9.
- **What a fitting costs in fees:** a ferry ramp half the port's; a crane beside a quay a third of a tier 2's; a pontoon beside two quays a quarter of a tier 3's; a slop loader beside a quay half, and about three barges a minute, more than the loader fills.

Seen live (`/?fixture=harbour`, the three ports fitted): 4 calls a minute before, 11 after; the tier 3 furthest up from 0.25 to 3; no ship stuck or turned away. About three times the boats on the river at once (27 against 9).

- **Not done:** `simulate-map-run.ts` still knows nothing of ports, so what a port adds to a whole run's pacing is not measured; the slop loader's bill and the yacht's and ferry's effects on a run are unmeasured for the same reason; a river with several ports was measured only on the fixture; the busier river was not checked for frame time.

Fixed while play-testing, not in the phases above: a port is placed by pointing at its quay or the water off it; the pointer picks the water with a port in hand or dredging; boats are sent by the berths their class can use, ports alike take turns; a low river is said once it has stayed low (`LOW_HOLD`). `?fixture=shoal` is the harbour with a bar to dredge.

**Open questions, as decided:** lorries are real and capped; dredging is in; lakes stay out; the slop loader is left out for now; hulls push the water, gently.

## Open questions

1. **Lorries.** Phase 4 makes the road behind a port matter, and takes vehicles from a town capped at 80. Worth it, or should a yard empty at a flat rate?
2. **Dredging.** It lets the player reshape the river, which the flood and the mains also read. Welcome, or too much power over the water?
3. **Lakes.** Ferries and yachts could run on a lake with no way out. In, or rivers only as now?
4. **The slop loader.** A third exit for slop makes sewers easier. Priced high enough to be a choice, or left out?
5. **Wakes in the solver.** Real, and they will rock boats tied up nearby. A feature, or a nuisance?

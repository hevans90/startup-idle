# One pipe network, solved beside the water

**Status:** in progress, begun 2026-11-11; what is built is listed under "Built so far" at the end. It goes ahead of what is left of the seaport plan (`plans/seaports.md`, "Left to do, after the pipes"): the slop loader there stands on this plan's graph and solver. Written from a read of `src/fluid`, `src/world/water`, `src/world/sewers`, `src/world/slop` and the water docs. Nothing was measured for this plan: every timing below is quoted from `WATER-PLAN.md`. Claims read from code and not yet run as a test are tagged [read]. Extended the same day with the look (§6, from the fixtures in the browser) and where a sewer may go (§7).

## Why

The surface water is a real engine: storeyed shallow water on the device, conserving, about 0.1–0.3 ms of compute a frame. The pipes are three unrelated simplified models joined to it through the host. They cannot interact with the water beyond a few one-column `addWater` calls, and each has its own network finder, report type and renderer.

The aim is one pipe network solved as real flow, on the device beside the water, at a cost that does not register against the frame.

## How it works today

| System | Model | Where it runs | Main weakness |
|---|---|---|---|
| Surface water (`fluid/`, `fluid/gpu/`) | Storeyed shallow water, 4 columns a tile, about 15 compute passes | Device owns it | One material per column, winner takes the cell (`bestMat`), so slop cannot mix with water |
| Mains (`water/mains.ts`, `game/mains.ts`) | One formula per network: best head, cell count, bore | Host, every frame | No water in the pipe, no pressure, no transit time |
| Sewers (`sewers/solve.ts`, `sewers/flow.ts`) | Static grade solve, then capacity routing down a tree | Host, every frame, allocating Maps and a sort | No storage or backwater; surcharge is an instant spill |
| Laterals | A `grid.main` bit (`MAIN_SEWER`), reported by `mains.ts` | Host | Sewer state split across two layers and two report types |
| Spouts (`water/pipes.ts`, `pipe-flow.ts`, `pipe-net.ts`) | 1D Saint-Venant with a Preissmann slot | Host, editor only, still stepped in the tick (`runPipes`) | The best pipe physics in the repo, and the game never uses it |
| Pollution (`water/pollution.ts`) | Tile-resolution mass on its own slope rule | Host, reading the stale depth copy | Ignores the solver's fluxes; a second "slop in water" model beside sludge |

## What's wrong

1. **Shared trunks carry too much.** [read] In `solveMain` each outlet gets the full `mainFlow(head, length, bore)` and the outlets are summed. A second gravity outlet appears to double what one pipe carries. Only the pumped case is shared (`PUMP_MOST`).
2. **Length is the whole network.** [read] `length = net.cells.length`, so a dead-end stub slows every outlet, and a near outlet is as slow as a far one.
3. **Bore is all or nothing.** A network is bore 2 only when every tile is widened.
4. **Nothing is in the pipe.** Water goes from river to tank in the same frame. The tube renderer has no real fill to draw.
5. **Pipes and water barely touch.** Every exchange is a host `addWater` on one column, decided from depths 3–5 frames old. A flood cannot enter a drain; a drowned outfall cannot back up.
6. **Sewers have no storage.** What a tile cannot pass comes up at once at the manhole above. A blockage downstream is not felt upstream.
7. **Slop has two representations.** `tanks.ts` chooses sludge on dry ground and pollution in water, because a column holds one material.
8. **Pollution does not follow the water.** It moves down the surface's slope by its own rule, so a current the solver computes does not carry it, and in a level lake it goes nowhere but by diffusion.
9. **Three of everything.** Three layers pairs (`pipe`/`pipeZ`, `main`/`mainEnd`, `sewer`/`sewerFit`), three flood fills, three report types, three renderers.

### The look [seen, `?fixture=sewers` and `?fixture=ports`, 2026-11-11]

`plans/pipe-rendering.md` made the tubes solid and lit. What is still rough:

10. **One flat colour a tube.** Three tones and a shine, and nothing else: no seams, no wear, no staining. It reads as modelling clay, not cast iron or steel.
11. **Nothing touches the ground.** Supports are plain grey boxes with no cradle or strap, and the grass under tube and box is untouched, so a run looks as if it hovers.
12. **Flanges are faint.** A thin ring in the tube's own colour, no bolts, no face.
13. **The glass sections do not look like glass, or like liquid.** As `windowGlass` builds them today:
    - the glass is one flat tint at 30% over everything (`GLASS_CLEAR`), which is what washes the section out: no rim, no reflection, no thickness;
    - the liquid is a solid tube at 0.8 of the bore, always full, one colour. There is no level, no surface and no depth to it;
    - water's movement is three thin bright tubes sliding along the top; slop's is two balls. Both move at a speed made from the report's flow, in a straight line, and repeat every second or so;
    - nothing is behind the liquid: no inside of the pipe, no far wall;
    - an empty section is empty at once, and a filling one is full at once;
    - the whole window mesh is rebuilt on the host every frame (`pipeLiveDrawable`).
14. **Ends are unfinished.** A lateral stops in a dark blob at its manhole with no collar or surround. A span's tube ends in a cut wedge where it meets the bank. A cap is a flat red disc.
15. **Water mains are hard to see.** Pale thin steel on bright grass, with supports a few pixels tall.
16. **Two techniques.** The sewers' surface pieces (covers, piers, lift stations, headwalls) and some tubes are still `Graphics` boxes and strokes (17 draw calls' worth of shapes in `sewer-layer.ts`), lit by hand-picked colours beside meshes lit by the shader.
17. **State is drawn, not shaded.** Chevrons and state colours are rebuilt as shapes when they change.

### Placement

18. **A lateral can be laid across a road.** A lateral is the above-ground tube from a workplace's slop port to a manhole. Its route comes from `routeMain(…, sewer = true)`, whose `free` refuses buildings, water and other mains but not road, and `planLateral` does not check either. So the player's Lateral tool and the AI (`sewer-ai.ts`, which calls the same two) both connect a workplace to a manhole straight over a street. Trunks under roads are right and stay.

### Using them [read from `build-bar.tsx`, `main-card.tsx`, `sewer-card.tsx`, `main-says.ts`, `world.store.ts`; the Water overlay seen in `?fixture=singularity`]

19. **Four tools for one job.** Pipe lays water. Sewer lays trunks or laterals by a switch the player has to set first. Look inspects, widens and adds a pump. Demolish lifts. A pipe clicked with the Pipe tool in hand does nothing: `MainInfo` shows only for `tool === "inspect"`.
20. **One drag, no steering.** A route is whatever the router finds between where the drag began and where it is now. There are no corners to pin, and a long run means one long drag held down.
21. **Nothing says where a pipe can start or end.** With a tool in hand, inlets, slop ports, manholes and usable water are not marked. The reach tint exists only while placing a slop maker. The refusals tell you after: "Start it at a workplace's slop port".
22. **The preview is a text card.** "River intake → Data Centre", a price, and "≈ 0.95 a second · cools about 20 agents". It does not say what the building needs, so the player cannot tell if 0.95 is plenty or half.
23. **Problems are found after paying.** "Needs a pump — you can add one when it's laid", then a second card offers it. The pump's price and upkeep are not in the first price.
24. **A reason, but not a place.** "The water is too low to reach the building" names the fault and not where along the run it happens, or by how much.
25. **Widen and Lift are all or nothing.** Both act on the whole network (`net.cells`). One stretch cannot be widened, or one branch lifted, from the card.
26. **No overview.** There is no list of mains and sewers. A dry intake is found by seeing its sign on the map; `town-problems.ts` has no pipe entries.
27. **The overlay is hard to read.** Small labels such as "head +3.7" and "0.5 deep", colours by state with no key, and water and sewers on two separate switches.
28. **Mixed words.** "Node" in refusals and "manhole" in cards; "lateral", "trunk", "bore", "head" and "slabs" with nothing to explain them; rates in "a second" and in "slop/s".
29. **Nothing over time.** No sign that a tank will run dry in a minute, or that a sewer is nearly at what it carries, until it happens.

## Design

### 1. One graph

Compiled on map revision from the mains, laterals and trunks:

- **Nodes:** fittings, junctions, bends, manholes, and a point every few tiles. Each has an invert level, a storage area, and a kind (plain, intake, outlet, outfall, manhole, tank).
- **Links:** a run between two nodes, with length, bore, roughness, and a kind (pressure main, gravity sewer, pump, lift).

The grid layers stay as the authored truth and the save format does not change. The graph is derived, like the lane graph.

### 2. The solver: virtual pipes, with real pipes

The same scheme as the surface, in one dimension, as `pipe-flow.ts` already runs per cell:

- a node holds a head; a link holds a discharge;
- a link's discharge is accelerated by the head across it, measured from the sill, and slowed by quadratic friction applied implicitly;
- a node's head follows from what its links brought, gathered, never scattered;
- outflows are limited to what a node holds;
- a slot above the crown makes a full pipe a narrow free surface, so part-full and pressurised are one code path.

That one model covers a gravity sewer, a surcharged one, a pressure main, a pump (a head added along a link) and a lift.

**Filling takes time, within limits** (decided 2026-11-11). With the slot's speed capped, a pipe pressurises over seconds, and that is kept as something to watch:
- tuned so a typical 20-tile main fills in two or three seconds and the longest in under ten. Tanks hold 30 seconds, so nothing runs dry waiting;
- previews and cards quote the steady flow, never the filling one;
- on loading a save, every network starts full at its steady state. No dry spell after a load.

**Balance: fix it and re-measure** (decided 2026-11-11). `MAIN_MAX` is not raised; that would also boost single-outlet mains, which are right today.
- the single-outlet numbers are the calibration and stay pinned: 20 agents by gravity, 12 pumped, 39 widened;
- a main with several outlets then delivers less than now, which is what makes Widen and a second main worth buying;
- an old save with one main feeding several buildings will fall short. The early warning in §8 is how the player learns of it;
- phase 0 confirms the fault first. If its test strikes item 1, none of this applies.

### 3. Coupling to the water, on the device

An **exchange pass**, one thread per port, each substep, reading fresh depth:

- **intake:** water to node, as an orifice, limited by the depth there;
- **outfall:** node to water, by the head over the surface, so a drowned outfall slows and reverses;
- **manhole:** one way: surcharge comes up. Standing water does not go down a manhole, or a flood would swamp every sewer unasked;
- **storm drain:** a grated fitting the player places on a trunk, like a manhole: standing water goes down it, as much as the trunk can take. The player's counter to a flood besides the levee;
- **burst:** a leak at a node, at the pressure there.

Tanks stay on the host, where the game reads them. An outlet is a boundary with a demand. The device keeps a **cumulative** delivered volume per outlet; the host diffs it against the last value it saw, so a stale readback loses nothing.

**New gameplay, and no more than this** (decided 2026-11-11):
- outfalls that back up in a flood: yes. It is what the exchange does once an outfall is under water, and it gives the flood a second consequence;
- storm drains: yes, as the fitting above;
- water towers and valves: not now. Both want new buildings, UI and balance, and nothing in the game asks for them yet. The valve at an outlet in §6 is drawn, not worked.

### 4. Slop as a concentration

One scalar per column, carried by the solver's own fluxes with a donor-cell rule, as the wash and the foam already are. Then:

- sludge and pollution are one thing, at different strengths;
- `pollution.ts`'s model and the fork in `tanks.ts` go;
- pipes carry the concentration, so a fouled intake fouls the coolant without a lookup (`coolingKept` reads the node);
- drag blends by concentration.

### 5. One of everything

One network compile, one report type, one tick entry. **The editor's spouts are kept** (decided 2026-11-11), and not stepped in play: old pipes become mains when play starts, so `runPipes` leaves at once on a map with none. Folding them into the graph, which would delete `pipes.ts`, `pipe-flow.ts`, `pipe-net.ts` and the drips pass's pipe bars (about 1,170 lines), is looked at again after phase 3, once the new solver has a tested host twin. The tube and sewer renderers read per-link fill and flow.

### 6. The look: pipes as made things

Still procedural, still one lit mesh a band (`pipe-mesh.ts`, `pipe-gpu.ts`), still three tones. No cast shadows: they were taken out of `pipe-rendering.md` at your word.

**Material, in the shader.** Two more floats a vertex: distance along the run, and angle round the tube. From those and a hash, per material:
- cast iron (sewers): a casting seam along the top, a joint line each pipe length, rust blooming down from joints and bolts, darker toward the underside;
- steel (mains): a weld bead each length, a faint spiral seam, pale scuffs on top, a drip stain under each flange;
- concrete and brick, for the pieces in §"One technique" below;
- all of it quantised to the three tones, so it stays Kenney-flat and does not shimmer when zoomed out.

**Joints and fittings, as geometry.**
- **Flanges:** a pair of rings with a visible face and a gasket line between, darker than the tube, six bolt heads round the half that shows.
- **Reducers** where the bore changes. The graph (§1) knows the bore per link, so a widened stretch can be drawn as one.
- **Tees and crosses:** a reinforcing collar where the branch meets the run.
- **Caps:** a domed blind flange with bolts, in place of the flat disc.
- **Valves** at outlets: a body and a handwheel.

**Standing on the ground.**
- **Saddles:** a concrete block with a cradle cut for the tube and a steel strap over it, on a footing slab a little wider.
- **Contact** (decided 2026-11-11): a thin dark rim on the ground where each concrete footing meets it, part of the mesh. Nothing under the length of the tube: that is what would read as the shadow that was taken out. Its strength is one uniform, to judge in the browser and set to nought if it is not liked.
- **Frames:** where a main crosses a road, an H-frame with a crossbeam, thick enough to read at normal zoom.

**Ends.**
- **A lateral at its manhole:** a drop bend with a collar, into a concrete surround with the cover set in it.
- **A span at the bank:** a concrete portal the tube comes out of, in place of the cut wedge.
- **An outfall:** a headwall with an apron, and a stain down it in the colour of what it pours.

**The glass sections: real glass, real liquid.** The one place the look leaves the flat three tones, on purpose: this is where the player watches the fluid, so it is shaded to look real. Taken to mean the see-through lengths of a run; a building's ports get the same liquid where they show any.

*Where they go* (decided 2026-11-11). Fewer and longer than today's 0.62 of a tile every fourth tile: one window about a tile and a half long in the middle of each straight run of four tiles or more, and one more every eight tiles on a long run. The flow has room to read, there is less to shade, and the flanges carry the rhythm along the run.

*How it is drawn.* The window stays a half cylinder of mesh, built once. Everything inside is worked out per pixel in the shader, from where the pixel sits across the tube and along it. A circle's cross-section is closed-form arithmetic, so there is no marching and no loop:
- where the line of sight enters the glass and where it meets the far wall;
- whether it meets the liquid's surface from above, or passes through the liquid's side;
- how far it travels through liquid.

*The glass.*
- clear in the middle and brighter toward its edges, where glass seen at a slant reflects more;
- a sharp line of the sun along the top and a softer, wider one lower down;
- a thin dark line at each end where its thickness shows, inside a steel collar with tie rods along the section;
- the far inside wall of the pipe seen through it, dark and wet, so an empty section reads as an empty pipe and not a hole;
- on sewers, a tide line and a film where slop has stood.

*The liquid, at its real level.* The fill comes from the link (§2), not a fixed 0.8:
- **part full:** a surface you look down onto, with the body under it seen through the side of the glass, and a bright line where the surface meets the glass;
- **full and under pressure:** no surface at all; movement shows as bubbles and streaks carried through the body;
- **depth:** colour by how much liquid the sight passes through, so the middle is deep and the edges pale. Water stays see-through to the far wall; slop is opaque within a finger's width;
- **mixtures:** the colour and the murk from the concentration (§4), so fouled water in a main looks fouled, by degrees.

*Flow.* At the link's real speed and direction, from the per-link buffer:
- **water:** two layers of surface pattern carried along at slightly different speeds, so it never visibly repeats; ripples lengthen into streaks as it quickens; flecks of foam and bubbles past a certain speed; still and glassy when it stands;
- **slop:** slow, thick and lumpy, the surface heaving in broad swells; lumps half sunk, turning as they go; a bubble now and then that rises and bursts; a smear left on the glass above the level, draining slowly;
- **a front:** a pipe filling shows the liquid's leading edge travel through the window, low and running ahead along the bottom; a pipe emptying leaves a wet film and beads that fade.

*Cost.* It replaces a mesh rebuilt on the host every frame with a static one and a shader, so the host does less than today. The arithmetic is on the few hundred pixels a window covers. Far away, a window falls back to a flat colour at the right level.

*Sorting.* Windows keep a render group of their own, last in their band, as now.

**One technique.** Covers, piers, lift stations and headwalls move from `Graphics` to the lit mesh (`solid`), with the brick and concrete materials. The `Graphics` tube in `sewer-layer.ts` goes.

**Underground view.**
- trunks deeper down drawn darker and a little greyer, so depth reads without counting;
- a manhole's shaft as a ring of brick down to the trunk;
- the flow's chevrons as a pattern in the shader along the tube, not shapes laid over it.

**Reading at a distance.** Mains get a darker steel and a firmer outline, so they hold against grass. Zoomed out, bolts, straps and stains drop away and the tube thickens a little; one mesh a level of detail, swapped by visibility as the roads do it (`1f306d0`), never destroyed.

**Live state without rebuilds.** Each vertex carries its link's id. Fill, speed, concentration and state come from one small buffer indexed by it, written each frame from the network's readback. The mesh is rebuilt only when a pipe is laid or lifted; nothing structural changes while water moves.

### 7. Where a sewer may go

**Trunks run under roads, as now. A lateral, the connection above ground, is laid only on empty plots: no building, no road, on any of its tiles.**

- **The router:** `routeMain` with `sewer` set treats a road tile as not free, ends included, so a drag goes round a street or finds no way.
- **The plan:** `planLateral` refuses any route with a road tile in it, "A sewer connection can't cross a road". This is the guard that counts: it catches a route from anywhere, the tool's or the AI's.
- **The AI:** `sewer-ai.ts` calls the same two functions, so it stops connecting through roads with no change of its own. Where no manhole can be reached off the road, it lays a trunk into the block instead, which it already knows how to do. Its tests gain a workplace with a street between it and the nearest manhole.
- **Manholes in a road:** a trunk under a street may still have one, but no lateral can end there. The reach tint and `needsSewer` ("No sewer node in reach") must count only manholes a lateral can get to without touching road, by route and not by distance.
- **The other way round:** a road is refused over a lateral, as a building is over a trunk.
- **Water mains** keep their rule: they still cross a road on a frame.
- **Old saves:** laterals already across roads stay and keep working. The rule binds new strokes only.

### 8. Using them: tools that show, connect and explain

All of it in the console kit, both themes, a short line an item with the detail in a tooltip.

**Two tools, one behaviour.** Pipe and Sewer stay two slots on the bar, on the keys they have (decided 2026-11-11). They open at different times, so one slot would carry a dead switch for a stretch of the game; a press on water has to mean an intake or an outfall before the drag starts; and only Sewer brings up the underground view. They share one way of working and one card design. Each does everything its pipes need:
- **press on nothing and drag:** lay;
- **click a pipe:** select it, and its card opens there. No change of tool;
- **drag from a pipe's end:** carry it on; **from its middle:** branch off it;
- **the Sewer tool works out what you are laying.** From a slop port, or onto a manhole in reach, it is a connection; otherwise a trunk. The Trunk | Lateral switch goes.
- Look still opens a pipe's card. Demolish still lifts one.

**Places to connect, lit.** With the tool in hand:
- every valid start glows: usable water, thirsty inlets, slop ports, manholes, pipe ends;
- each inlet and slop port wears its tank as a ring, so the ones that need a pipe stand out;
- once a drag begins, only ends that would work for it stay lit, and the end snaps to the nearest with a marker that names it.

**Routes you can steer.**
- **click to pin a corner** while laying; the router fills in between pins;
- click, pins, then click the end: a long run without holding a button. A plain drag still works;
- right-click takes back the last pin; Escape drops the lot.

**A preview that answers "is this enough?"**
- **on the map:** the ghost in the real pipe's look, a bad stretch in red where it is bad, a ghost pump or lift where one is needed, with its price on it;
- **on the card:** the whole price, pump and running cost included before you let go; then one bar, what it brings against what the building needs ("12 of 20 agents cooled"), or what it takes against what the workplace makes;
- **a pump is part of the stroke.** Where the water stands too low, the card offers "With a pump" as a choice before release. The second card after laying goes.

**The profile: why, and where.** A strip under the card, for a preview or a selected pipe: the run seen from the side.
- the ground, the pipe, the water at the source, the building's floor;
- the line the water can rise to along it, falling with distance. Where that line drops below the pipe, the stretch is red: that is where a pump goes, or where the run is too long;
- for a sewer: its depth under the ground, each span and lift, and the fall toward the exit.
It reads today's head and length now, and the solver's pressure once phase 2 lands.

**Connect it for me.** Click a thirsty inlet or a slop port with nothing on it:
- up to three ghost routes are offered, from the routers the AI already uses (`pipe-route.ts`, `sewer-ai.ts`): the cheapest, the one that carries most, the one without a pump;
- each with its price and its bar; click one to lay it, or ignore them and draw your own.

Decided 2026-11-11:
- **opened by doing it once by hand, a kind at a time:** water suggestions after the player's first main is flowing, sewer suggestions after their first connection is draining. Kept with the save;
- **always the trade-off, never one answer.** Which source, gravity or a pump, how much to spend: that choice is the puzzle, and it stays the player's. Where only one route exists, that one is shown, labelled as the only way;
- **no premium and no special powers:** the price of drawing it, and only routes a hand could draw.

**Edit a stretch, not the lot.** A click selects the stretch between two joints; a second click, the whole network.
- widen that stretch (the graph has a bore per link, and a reducer is drawn where it changes);
- lift that stretch, leaving caps;
- drag an end to move it.

**A list of every pipe.** Under the Pipes view, one row a network: a dot for its state, what it joins ("River → Data Centre"), its bar. Trouble sorts to the top; a click flies there (`map-focus.ts`). Pipe faults join the town's problem list.

**One view, with a key.** Water and Sewers become one Pipes view with a switch between them. It comes on by itself with either tool, on that tool's side: water with Pipe, underground with Sewer.
- colour by state, with a pattern too, so it does not rest on colour alone;
- thickness by how much flows; arrows the way it goes;
- a key along the bottom; labels at a readable size, in plain words ("3 slabs above the floor").

**Warning before it fails.**
- a tank that will run dry inside a minute at its present rate shows amber, with the time in its tooltip;
- a sewer above nine tenths of what it carries shows amber before it comes up in the street;
- when a main goes dry or a sewer backs up, a notice with Show.

**One set of words.** Manhole, never node. Connection for a lateral. Wide, not bore. Height in slabs everywhere. What a pipe does is said in agents cooled and workplaces drained; the rate a second is in the tooltip.

## Keeping the performance

- **Size.** Hundreds of links against 65,536 columns. The falls pass, dispatched over every edge, was measured at 0.019 ms a frame; these passes are far smaller.
- **Bindings.** The network's arrays go in the existing single state buffer. No new bindings.
- **Stiffness is the real risk.** A full pipe's wave speed is enormous and could force more substeps on the whole frame. Cap the slot's speed (no one needs water hammer) and sub-cycle only the network passes. The cost: a long main takes a few seconds to pressurise.
- **Concentration is the only per-column cost.** One more gather in the apply pass. Measure it before and after.
- **Readback.** Node heads, link flows and the delivery counters are a few hundred floats, at the UI's rate, not the frame's.
- **The active box.** A device-side pour onto dry ground must widen the box in the apply pass's reduction, or the water is lost as it was in the `LATENCY` bug.
- **Storeys.** A port names a slot index, like everything else the host asks about.
- **Host savings.** The pollution step, the sewer routing's per-frame Maps and sort, and `runPipes`'s scan all go.
- **The look.** Material detail is fragment arithmetic on pixels a tube already covers. Bolts, straps and collars add vertices, but only to meshes rebuilt on an edit, and they drop out at the far level of detail. Count `_buildInstructions` while water runs: it must not move.

## Phases

| # | Phase | What lands | Guard |
|---|---|---|---|
| 0 | **Pin today's faults** | Tests for items 1 and 2 above, to confirm or strike them; `runPipes` leaves at once with no spouts | The tests themselves; spout tests unchanged |
| 1 | **One graph** | The compile; `findMains`, the sewer nets and `lateralsOf` read from it; one report type. No behaviour change | Existing mains and sewer tests unchanged |
| 2 | **Host reference solver** | Link-node solver generalised from `pipe-flow.ts`, behind a flag; calibrated to `mains-capacity.test` (20, 12, 39 agents, single outlet) and the sewer flow tests; fill times tuned; networks start full on load; multi-outlet delivery re-measured. The tool's preview iterates the same graph to steady state. `takeover-sim` runs it | Preview within 5% of delivery; conservation to 1e-6 with `totalVolume`; a 20-tile main full in under 3 s; the singularity fixture's cooling and the AI cooling tests re-run |
| 3 | **Device port** | Link, node and exchange passes; state in the one buffer; cumulative delivery counters; the compare harness extended to node heads | `?gpucheck`; `__frameCompare`; a still-flood total for leaks |
| 4 | **Concentration** | The scalar in both solvers; pollution model and the tank fork deleted; overlay and mood read the scalar | Slop mass conserved; `pollution.test` rewritten to behaviour |
| 5 | **Retire the duplicates** | One compile, one report type, one tick entry; renderers draw real fill. Spouts kept; folding them in looked at again here | Fixtures `ports`, `sewers`, the pipe yard |
| 5b | **Storm drains** | The fitting, laid with the Sewer tool on a trunk; standing water down it by the exchange pass; outfalls backing up under flood water checked | A flooded street with a drain clears faster than one without; water conserved; a drowned outfall slows its sewer |

| 6 | **Laterals off the roads** | §7: the router and `planLateral`, the reason on the card, reach by route, roads refused over laterals, the AI's case | A lateral goes round a street or is refused whole; the AI lays a trunk in instead; trunks under roads unchanged; an old save's lateral across a road still drains |
| 7 | **Look: one technique** | Sewer surface pieces and the last `Graphics` tubes onto the lit mesh; brick and concrete materials | Fixtures by eye at three zooms, day and night |
| 8 | **Look: material and joints** | The two vertex floats; iron and steel detail; flanges with bolts, reducers, collars, caps, valves | `pipe-mesh.test` for each piece; gpu render time before and after |
| 9 | **Look: ground and ends** | Saddles with straps, contact stain, frames, manhole surrounds, portals, headwalls | A pipe yard fixture with one of every piece |
| 10 | **Look: state and distance** | Per-link state buffer, shader chevrons, depth shading underground, levels of detail | `_buildInstructions` flat while water runs |
| 11 | **Look: glass and liquid** | Windows fewer and longer; the glass shader (rim, reflections, far wall, collars); liquid by level and depth; water and slop flow; fronts and films; `pipeLiveDrawable` and `windowGlass` deleted. Same lines in WGSL and GLSL | A glass gallery fixture: empty, quarter, half, full; still, slow, fast; water, slop, a mix; runs along `u`, along `v` and climbing; filling and emptying. By eye at three zooms, day and night; gpu render time before and after |

| 12 | **Use: the tools** | Select and edit inside Pipe and Sewer, two slots as now; extend and branch by dragging from a pipe; Sewer infers connection or trunk; one set of words | Each old path still reachable; `main-says` and card tests on the new words |
| 13 | **Use: where and whether** | Connect points lit and snapping; pins; the ghost with its pump or lift; the whole price; the need bar; pump chosen before release | The preview's price and bar equal what is then charged and delivered |
| 14 | **Use: the profile** | The side strip for previews and selections, mains and sewers | The red stretch matches the state's reason on the pipe-yard fixture |
| 15 | **Use: connect it for me** | Suggested routes from an inlet or slop port, opened a kind at a time by the first one laid by hand | Each suggestion passes the same `planMain` / `planLateral` / `planSewer` a hand-drawn one does, at the same price; none offered before its kind is opened |
| 16 | **Use: the overview** | The pipe list, pipe faults in town problems, the one Pipes view with its key, early warnings | By eye in both themes; the list's rows equal the networks' reports |
| 17 | **Use: stretches** | Select, widen, lift and move by stretch | Wants phase 1's per-link bore |

Phases 1–2 stand on their own. Phase 3 is what lets floods and pipes interact. Phase 4 is independent and could go first.

Phases 6–9 need nothing from 1–5 and can go at any time; 6 is a day's work and stands alone. Phases 10 and 11 draw real fill and speed, so they want phase 2 at least; before that they can read today's reports (flow or none) through the same buffer, with the level fixed. Mixtures in the glass want phase 4.

Phases 12–16 need nothing from the solver and can go first; 13 is the one a player would feel most. Phase 17 wants phase 1.

## How to check

- `bun run test:par`; `tsc -b`.
- Timing on the isolated server, pane visible: `__waterBench(n, true)`, then `__gpuTime().of` after 45 frames. Compare `wait` to render plus compute for an untimed pass.
- A still-flood scene's water total before and after each of phases 3 and 4.

## Open questions

None. All were decided on 2026-11-11; each decision is written where it applies:

| Question | Decision | Where |
|---|---|---|
| New gameplay | Backed-up outfalls and placed storm drains; no towers or valves | §3, phase 5b |
| Pressurising time | Kept, within limits; steady flow quoted; full on load | §2, phase 2 |
| Balance | Fix shared trunks and re-measure; `MAIN_MAX` unchanged | §2, phases 0 and 2 |
| Editor spouts | Kept, not stepped in play; folding in looked at after phase 3 | §5, phases 0 and 5 |
| Glass windows | Fewer and longer | §6, phase 11 |
| Contact stain | Footings only, on one uniform | §6, phase 9 |
| Connect it for me | Built; opened a kind at a time by the first laid by hand | §8, phase 15 |
| One slot or two | Two | §8, phase 12 |

## Built so far

**Phase 0 — today's faults pinned** (2026-11-11). `world/water/mains-shared.test.ts`.
- **Item 1 confirmed.** A second outlet on one gravity trunk brings `2 × mainFlow(head, length)`: each outlet is handed the whole flow and they are summed. The balance decision in §2 applies.
- **Item 2 confirmed.** Eight tiles of capped stub off the middle of a 20-tile run cut its one outlet's flow by more than a tenth; an outlet 20 tiles from the lake and one 30 tiles from it are given the same.
- The tests state each fault as it stands. Phase 2 turns them round and they are rewritten then.
- `runPipes` returns as soon as a map has no spouts (after sweeping what a lifted run left standing). It no longer walks every building for pump houses each frame.

**Phase 1 — one graph** (2026-11-11). `world/pipes/graph.ts`, `world/pipes/report.ts`; tests in `pipes/graph.test.ts`.
- `pipeGraph(g)`: nodes, links, drops and systems off the two layers, kept by `grid.rev`. A node at every fitting, dead end, bend and junction, where a connection stands on a manhole, and every 4 tiles of a straight (`NODE_SPACING`). A link has its own bore, so a widened stretch is its own link (phase 17 stands on this).
- The networks the game reads are the graph's: `findMains` and `solveSewers` take their `MainNet`s and `SewerNet`s from it, flooded in the order they always were, and `lateralsOf` takes which connections there are and where each comes down. What feeds a connection is still asked of the buildings each frame.
- One report type, `PipeReport`: a main, a connection and a trunk say the same things, and a trunk adds its own (`trunk`: inflow, delivered, spilled, lifts). A trunk's `capacity` is its narrowest tile's on the way down and its `flow` what it delivered. `MainReport` and `SewerReport` are that type narrowed by state.
- No behaviour change: every mains, sewer and slop test passed untouched but two lines of `flow.test` that read a trunk's own fields.
- **Not yet:** nodes carry no invert level or storage. A trunk's level is `solveSewers`' and a main's is the ground's; phase 2 reads them when it needs them. Nothing draws from the graph, and the two renderers and report maps are still separate (phase 5).

**Phase 2, first half — water mains solved as flow, behind a switch** (2026-11-11). `world/pipes/hydraulics.ts`; run on the map by `runSolved` in `water/mains.ts`. On with `?pipes=solver` or `setPipeSolver(true)`; off, everything is as it was. Tests: `pipes/hydraulics.test.ts`, and with the switch on in `mains-shared.test.ts` and `mains-capacity.test.ts`.
- **The model.** A node holds water, a link a discharge; a link is pushed by the head across it and held back by the square of its flow, taken implicitly; nothing leaves a node it does not hold; a slot above the crown carries pressure. Steps of 1/120 s inside the frame.
- **Calibration.** `head = flow² × (ENDS + RUN × tiles) / bore²`, fitted to `mainFlow` at nought and twenty tiles. On one 20-tile run the steady flow equals `mainFlow` to six places at any head; a widened run carries twice; a pump moves `PUMP_MOST` and no more. On the game's own rig (`mains-capacity.test`, a lake that rocks a little) it is within a hundredth of the formula: 0.952 against 0.948 a second by gravity, 0.500 pumped, 1.899 widened.
- **Other lengths differ, as expected:** within a tenth of `mainFlow` from 5 to 40 tiles, more on longer runs (the formula's loss went as the length squared, a pipe's goes as the length).
- **The faults turned round.** Two outlets on one trunk bring more than one's flow and under one and a half times it; a dead-end stub costs nothing; the nearer outlet is fed faster; shut one and the other has the run to itself; a building whose floor is above what head is left at the branch gets none.
- **Filling.** 20 tiles are full in 2.1 s and 60 in 9.1 s (`PIPE_HOLDS`). A map first seen has its mains full and settled; a main laid afterwards starts empty; water carried over an edit by the tile it stood in; what stood in a lifted run goes on the ground.
- **Conserved:** the lake's water, the tanks' and the pipes' add up through running, laying and lifting, to the water's single-float precision.
- **What the cards read** (`MainReport`): `capacity` is the steady flow with every building taking all it is given, per outlet and summed; `flow` is what arrived this frame. Measured delivery is within a twentieth of it.
- **Seen in the game** with the switch on (`/?fixture=singularity&pipes=solver`): the Data Centre's 45-tile main flowing, the GPU farm's pumped main full, no errors.
- **Found on the way:** the solver's datum must not move with the lake. Recomputed each frame it shook every node's pressure with every ripple at the intake and a pumped main delivered 1.5% short.
- **A main is a primed pressure pipe:** the ground it crosses does not stop it, as it never did. The profile strip of §8 has no "pipe above the head line" to show for a water main until that changes; left as it is.

**Phase 2, water mains turned on for good** (2026-11-12). The switch and the one-formula path are gone: `runMains` solves every water network as flow, `solveMain` is the steady solve, `previewMain` quotes it.
- **Re-measured with it on, the whole suite:** 2,531 of 2,531 passed before a line of the old path was deleted, the takeover sim, the AI's cooling and the singularity fixture among them. Two tests in `mains.test` pinned the formula at 16 tiles and now pin the solver, within 2% of it.
- **The singularity fixture:** the Data Centre's 45-tile main 0.72 a second, as before; the GPU farm's pumped main 0.50.
- **The preview is the same solve:** the plan laid on a copy of the map's mains, its network solved steady (`plannedFlow`). What it promises is what the laid main reports.
- **The steady solve is Newton's**, on every head at once, with a round node by node where a step stalls at a pump's limit. A 13-node main took 10–20 ms going round node by node; it takes about 1 ms cold and 0.04 ms from where it last settled. Worked out again a network four times a second and when its pumps or outlets change, not every frame.
- **Cost a frame:** about 0.007 ms for a 13-node main's own step.
- `mainFlow` stays as the measure the solver is fitted to. `PIPES=solver` and `?pipes=solver` no longer exist.

**Still to do in phase 2:**
- sewers on the same solver (storage, backwater, surcharge), calibrated to the sewer flow tests.

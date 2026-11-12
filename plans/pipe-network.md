# One pipe network, solved beside the water

**Status:** in progress, begun 2026-11-11; what is built is listed under "Built so far" at the end. It goes ahead of what is left of the seaport plan (`plans/seaports.md`, "Left to do, after the pipes"): the slop loader there stands on this plan's graph and solver. Written from a read of `src/fluid`, `src/world/water`, `src/world/sewers`, `src/world/slop` and the water docs. Nothing was measured for this plan: every timing below is quoted from `WATER-PLAN.md`. Claims read from code and not yet run as a test are tagged [read]. Extended the same day with the look (§6, from the fixtures in the browser) and where a sewer may go (§7). Extended 2026-11-12 with ports on the building (item 17b, §6, phase 9b).

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
17b. **A workplace's slop port is an out-building.** [read, `structures/projects/entries.ts`; added 2026-11-12] The Vibe studio and the Vibe Coder Studio each get a concrete service housing from the wall out to the edge of the plot (`drawEntries`: a box, a cap, a coloured band, a vent), with the outlet bolted to its face. It is a grey shed stuck on the front of a building it does not match, and it looks terrible. The AI's buildings and the processors do not have one: their outlets are flanged straight onto a wall drawn for them (`direct`, `portSetback`), and the main runs on past the plot's edge to meet it.

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

**Ports on the building, not beside it** (asked for 2026-11-12). Every port is flanged straight onto its building's own geometry, as the AI's buildings' already are. No out-buildings.

- `direct(port)` becomes true for every port, and `drawEntries` with its housing (box, cap, band, vent, `ENTRY_W`, `ENTRY_H`) is deleted. A workplace's slop outlet is then placed the way a water inlet is: `portSetback` puts the outlet's plate on the wall behind the port (`wallBehind`), and the connection runs in from the plot's edge to it.
- **Each building is drawn with a wall there for it**, which is what made the AI's work. For the Vibe studio and the Vibe Coder Studio, in their looks (`structures/projects/looks.ts`): a ground-level face of the building's own mass behind the port, at least the outlet's plate wide and high, in the building's own material. Where the port now faces a forecourt or a recess (`wallBehind` falling back on `NO_WALL`), either the port moves along the face to where the wall is (`Port.at`), or the look gains a plinth or service bay that is part of the building — same material, same base line, under the same roof — not a box in front of it.
- **The outlet says what it is by itself**: the plate, spigot and flange (`outlet` in `pipe-mesh.ts`), cast iron for slop and steel for water, with the fluid's colour on the plate as now. The band the housing wore goes with the housing.
- **The run from the plot's edge to the wall** crosses the building's own plot: drawn as the connection's tube on a saddle or two (§ "Standing on the ground"), sorted with the building so the wall hides what is behind it. A deep setback gets a short straight run, never a second structure.
- **Nothing in the rules moves.** A port is still the tile in front of its face (`portTiles`), so routing, the lit connect points, the spill at a full tank's port, saves and the AI are untouched. This is drawing only.
- **Any building given ports later** takes the same rule: no port without a wall drawn for it. `entries.test.ts` is rewritten to hold that for every def with ports.

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
| 9b | **Look: ports on the building** | Every port flanged straight onto its building: `direct` for all, `drawEntries` and the housing deleted, a wall drawn behind each workplace's slop port, the run in from the plot's edge on saddles | `?fixture=ports` by eye at three zooms, day and night, every building with ports from both camera-facing sides; `entries.test` rewritten: every def with ports has a wall behind each, and none draws a housing; a connection still joins, drains and spills at the same tile |
| 10 | **Look: state and distance** | Per-link state buffer, shader chevrons, depth shading underground, levels of detail | `_buildInstructions` flat while water runs |
| 11 | **Look: glass and liquid** | Windows fewer and longer; the glass shader (rim, reflections, far wall, collars); liquid by level and depth; water and slop flow; fronts and films; `pipeLiveDrawable` and `windowGlass` deleted. Same lines in WGSL and GLSL | A glass gallery fixture: empty, quarter, half, full; still, slow, fast; water, slop, a mix; runs along `u`, along `v` and climbing; filling and emptying. By eye at three zooms, day and night; gpu render time before and after |

| 12 | **Use: the tools** | Select and edit inside Pipe and Sewer, two slots as now; extend and branch by dragging from a pipe; Sewer infers connection or trunk; one set of words | Each old path still reachable; `main-says` and card tests on the new words |
| 13 | **Use: where and whether** | Connect points lit and snapping; pins; the ghost with its pump or lift; the whole price; the need bar; pump chosen before release | The preview's price and bar equal what is then charged and delivered |
| 14 | **Use: the profile** | The side strip for previews and selections, mains and sewers | The red stretch matches the state's reason on the pipe-yard fixture |
| 15 | **Use: connect it for me** | Suggested routes from an inlet or slop port, opened a kind at a time by the first one laid by hand | Each suggestion passes the same `planMain` / `planLateral` / `planSewer` a hand-drawn one does, at the same price; none offered before its kind is opened |
| 16 | **Use: the overview** | The pipe list, pipe faults in town problems, the one Pipes view with its key, early warnings | By eye in both themes; the list's rows equal the networks' reports |
| 17 | **Use: stretches** | Select, widen, lift and move by stretch | Wants phase 1's per-link bore |

Phases 1–2 stand on their own. Phase 3 is what lets floods and pipes interact. Phase 4 is independent and could go first.

Phases 6–9b need nothing from 1–5 and can go at any time; 9b stands alone and wants nothing from 7–9 but the saddles, which it can do without at first; 6 is a day's work and stands alone. Phases 10 and 11 draw real fill and speed, so they want phase 2 at least; before that they can read today's reports (flow or none) through the same buffer, with the level fixed. Mixtures in the glass want phase 4.

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

**Phase 2, sewers with storage** (2026-11-12). `sewers/flow.ts`, over the graph's trunk nodes; tests in `sewers/flow.test.ts`.
- **Every trunk node holds slop** (`SEWER_HOLDS` a tile, a bore; `SHAFT_HOLDS` more at a manhole). The way down and what each run carries are still `solveSewers`': its grades, spans and lifts are unchanged.
- **A run passes on** what it carries, in proportion to how full its node stands, and no more than the node below has room for and will itself pass on. So a sewer stands as full as it is loaded, slop takes a moment to come down it, and a choke is felt up the pipe.
- **A manhole spills once its pipe and its shaft are full**, not the instant more arrives than a tile carries. Two a second into a trunk that carries one: nothing in the street at first, then one a second up at the manhole and one out of the outfall. A backed-up manhole (the event) fills and then brings everything up there.
- **Exits as before:** a processor first, as much as it has room for; the rest out of the network's outfalls; with neither, it backs up.
- **Conserved:** what left the tanks is in the pipes, out of an exit, or up in the street (`slopInSewers`). Slop a lifted trunk held is put out where it stood.
- A frame longer than 1/30 s is cut into steps of that (`SEWER_STEP`): a second's slop landing on a manhole at once would be over its shaft before any moved on.
- Two tests that expected the instant spill were rewritten round the delay; every other sewer, slop and processor test passed untouched.
- **Not the pressure solver.** The plan had one model for mains and sewers. A sewer here is routed down the solved tree with storage, which gives the storage and backwater the plan asked for; slop does not run uphill under pressure or reverse at a drowned outfall. That needs the exchange with the water (phase 3) and is left for it.
- **Not seen in the browser:** no fixture played has a working sewer (the `sewers` fixture has no company to make slop). Tests only.

**Phase 2 is done.** Left over from it, for later phases: sewers start empty on a loaded map (a few seconds' lag, where mains start full); `fillOf`, `mainFillAt` and `sewerFillAt` are there for the tubes and nothing draws them yet (phases 10–11).

**Phase 6 — laterals off the roads** (2026-11-12). `sewers/reach.ts`; `routeMain`, `planLateral`, `sewer-ai.ts`, `sewers/tool.ts`, the store's road stroke. Tests in `sewers/flow.test.ts`, `ai/sewer-ai.test.ts`, `state/world.store.test.ts`.
- **The router** (`routeMain` with `sewer`) treats a road tile as not free, ends included: a drag goes round a street's end or finds no way. A water main still crosses.
- **The plan** (`planLateral`) refuses any route with a road tile on it, "A sewer connection can't cross a road": the guard that counts, whoever found the route.
- **The tool says why** when there is no way: a street across it, or "A sewer connection can't end in a road: lay a trunk into the block".
- **Reach is by route** (`lateralReach`): tiles from each live manhole outward over ground a connection may lie on, to `LATERAL_REACH`. A manhole in a road counts for nothing; one two tiles off across a street is out of reach. `sewerInReach` ("No sewer node in reach"), the reach tint and the AI's `trunkInto` all read it.
- **A road is refused over a connection**, "A road can't go over a sewer connection", and nothing is charged.
- **The AI** tries only manholes off the road, and where a street lies between a workplace and the nearest one it lays a trunk in from open ground beside the port, then the connection down into it. The balance sim still sewers its town within its two minutes.
- **Old saves:** a lateral already across a road stays and drains (tested). Only new strokes are bound.
- **Fixtures:** none had a lateral on a road or a manhole in one; nothing needed moving.
- **For the player this is stricter than before:** a trunk laid under a street puts its manholes in the street, where nothing can connect. A trunk has to end, or be given a manhole, on open ground beside the buildings it serves. The reach tint shows where that works; the Sewer tool does not yet steer a trunk's end off the road by itself (phase 13's lit connect points are where that belongs).
- **Not seen in the browser:** the reach tint and the refusals. No fixture can be played with sewers open and a slop maker in hand. Tests only.

**Phase 13 — where and whether** (2026-11-12). `pipes/stroke-route.ts`, `water/main-stroke.ts`, `pipes/connect-points.ts`, `render/connect-guide.ts`; the scene's pointer handling, `play/main-card.tsx`, the store. Tests in `water/main-stroke.test.ts` and `sewers/flow.test.ts`.
- **One working-out** (`mainStroke`) for the ghost, the card and the stroke that lays: route, plan, pump, price, need. What the card says is what is charged and what arrives (tested: price to the cent, delivery within a twentieth).
- **A pump is part of the stroke.** Where the water stands too low and a pump would lift it, the main is laid with one and priced with it: the card shows the pump's price and what it costs a second to run. P, or the card's button, lays it without; the card then says it will not flow. The offer after laying is gone (a main already down can still be given one from its own card).
- **The need bar:** "Cools 21 of 30 agents" and a bar, what this main and any other already feeding the building bring against its thirst; the rate a second is in the tooltip. A building with no agents of its own (the Lattice) shows the share as a percentage.
- **Laid by clicks** (`Stroke.pins`): click to start, click to pin a corner, click an end that completes it to lay; a click on the corner just pinned, or Enter, lays it as it stands; right-click takes the last corner back and Escape drops it. The router fills in between pins and keeps each stretch off the ones before. A plain drag works as it did. Pipe, connection and trunk alike.
- **Connect points lit** with a pipe tool in hand: the bank beside water tinted, a ring on each free inlet and slop port with its tank's thirst or fill on it, a dot on a manhole off the road and on a pipe's open end. Once a stroke has begun only the ends that would finish it stay lit: from water, the inlets and mains; from an inlet, the water; from a slop port, the manholes.
- **Snapping:** an end within a tile of a connect point goes to it, and it is lit brighter. What it is, the card's line of ends already says ("Pump at the water → Feeds the Lattice"); no label was added on the map.
- **The ghost pump:** the sign for one, a ring with a wedge, at the intake of a main that would be laid with it. A sewer's ghost already drew its lifts.
- **Seen in the game** (`/?fixture=singularity`): a main started with a click at the canal, a corner pinned and taken back, the card's price and pump, P and Escape, laid into the Lattice's inlet with its pump at $25,196; and the same by a drag.
- **Not done:** the bad stretch drawn red where it is bad (wants the profile, phase 14); a price on the ghost pump itself (it is on the card); the Sewer tool's connect points and pins were not seen in the browser, no fixture being playable with sewers open — tests only.
- **Found by hand:** the card sits over the bottom of the map and takes clicks meant for the ground under it. Not changed here.

**Phase 12 — the tools** (2026-11-12). `pipes/connect-points.ts` (`pipeClick`), `sewers/tool.ts` (`laysConnection`), `play/main-card.tsx` (`TrunkInfo`), the store and the scene. Tests in `water/main-stroke.test.ts` and `sewers/flow.test.ts`.
- **Click a pipe with its own tool: its card opens there**, the tool still in hand. A water main with Pipe; a connection or a trunk with Sewer. Look opens them as before; Demolish still lifts.
- **Where a click starts a run instead:** open ground, a pipe's open end, a manhole. So a main is carried on by clicks from its capped end, and a connection begun at a manhole.
- **Drag from a pipe:** from its end it is carried on and the cap comes off there; from its middle it branches, a tee in the one network. (The joining was there; the cap staying on a carried-on end was not right, and is fixed.)
- **A trunk has a card** (`TrunkInfo`), which it never had: its state in plain words, the workplaces that drain into it, its lift stations, and "Add a manhole here" — what a click on a trunk with the Sewer tool used to do unasked.
- **The Sewer tool works out what it is laying** as the stroke moves: a connection if either end is a workplace's slop port or a connection already laid, else a trunk. The Trunk | Lateral switch is gone. The plan said "from a slop port, or onto a manhole in reach": a trunk joined at a manhole from open ground nearby would have read as a connection and been refused, so it is the slop port that decides.
- **One set of words:** manhole, never node ("End it at a manhole", "No manhole in reach", "A manhole needs ground under it"); connection for a lateral on cards and refusals; height in slabs ("water 2.3 slabs above the floor", "1.0 slabs deep" on the overlay); what a pipe does in agents cooled and workplaces drained, the rate a second in the tooltip. "No manhole in reach" now shows in the placing readout, which had been saying only "Can't build here".
- **Seen in the game** (`/?fixture=singularity`): the Data Centre's main clicked with the Pipe tool in hand, its card open beside it in the new words. The Sewer tool's side, tests only.
- **Each old path still reachable:** drag to lay; Look to open a card; Demolish to lift; a manhole on a trunk, now from its card; a connection, by starting at a slop port.
- **Not done:** identifiers and comments in the code still say lateral and node; only what the player reads changed.

**Phase 14 — the profile** (2026-11-12). `pipes/profile.ts`, `mainProfile` and `laidCopy` in `water/mains.ts`, `play/pipe-profile.tsx`. Tests in `water/main-stroke.test.ts` and `sewers/lay.test.ts`.
- **A strip under the card**, for a main in hand, a main looked at, a trunk in hand and a trunk looked at: the run from the side, a point a tile. No words on it; its tooltip repeats what is wrong.
- **A water main's:** the ground, the pipe on it, the water's level at its source, the building's floor as a dashed line, and the line the water can rise to — the heads of the same steady solve the card quotes, between nodes along each run. A pump shows as a wedge at the intake and a step up in the line. From the intake whose water stands highest to the building, by way of the tile asked about where the network has more than one outlet.
- **Red, for a main, is where that line lies under the building's floor**, when nothing flows: the reason the card gives ("the water is 2 slabs below the building's floor"). With its pump the line clears the floor and the red goes; a main looked at shows red exactly when its report reads `no-head` (tested).
- **Not "where the line drops below the pipe".** The plan drew the fault there. A main here is a primed pressure pipe that the ground does not stop (phase 2), so a pipe over a rise above its water's line is not a fault and is not drawn as one. The floor is what the water has to clear.
- **A sewer's:** the ground, the pipe under it at the solve's level, a pier where it spans, a wedge at a lift station, a tick at a manhole, a dot at its exit, from the tile asked about (a plan's furthest-up tile) down to the exit. Red where the solve names a fault, with its words; "No exit yet" where it drains nowhere.
- **A sewer's faults hardly arise:** the solve digs under a dip or lifts out of it rather than leave a span too long, and puts a manhole in the ground rather than on a span. The mapping from fault to red stretch is tested with a fault handed to it.
- **The guard as written** named a pipe-yard fixture, which is phase 9's. Tested on the yards the other pipe tests use.
- **Seen in the game** (`/?fixture=singularity`): the Data Centre's main looked at, its line falling from the pond to the building; a main in hand to the Lattice with its pump, stepped up at the intake, and without, red under the floor. Sewers, tests only.
- Fixed on the way: "1 slabs".

**Phase 3 — water mains on the device** (2026-11-12). `fluid/gpu/pipes.ts` (the pass), `packMains` and `runOnDevice` in `water/mains.ts` (the host's side), `ColumnField.pipes` (the port between them). Tests in `water/mains-device.test.ts`, on `fluid/gpu/pipes.test-kit.ts`.
- **One pass a frame, one thread**, straight after the arrivals: `stepWater` line for line, over every water network on the map packed end to end in a buffer of its own (bind group 1; the uniform block had no room for another offset). An intake reads the depth the device holds now — the deepest of its tile's column and the four beside it — and takes its water out of that column. 0.085 ms a frame on the singularity fixture's three networks.
- **Tanks stay on the host.** It grants each outlet what its tank has room for that is not already on its way; the device delivers no more than is granted and counts what it delivered, whole and part in two floats; the host fills the tank by the difference since it last looked. Answers three frames late lose nothing and overfill nothing (tested).
- **Each upload has a number**, echoed in the answer: one in the air when the map changes is not taken for the new network's.
- **The host keeps** the steady flow the cards quote, the pumps' pay, the report, and a copy of each node's water as last read back (for `mainFillAt`, `waterInMains` and carrying water over an edit). Its own solver still runs where there is no device (tests, `takeover-sim`) or the networks pack to more than `PIPE_WORDS` (about two thousand tiles of main).
- **The compare harness is the shader's own text**, turned word for word into JavaScript by the test kit and run on the buffer the host packed: on the capacity rig the device carries 0.951 a second against the host's 0.952; lake, pipe and tank sum to the same before and after.
- **Seen:** the singularity fixture's Data Centre main delivering 0.70 a second against a quoted 0.65–0.80 (its tank full, so it carries what is used), no device errors.
- **Found on the way:** `from` is a reserved word in WGSL and `headAt` was the shared header's; a pass that fails to compile takes the whole water frame with it, and every main reads dry.
- **Not done, of the plan's phase 3:** the sewers' side of the exchange (an outfall backing up under flood water, a manhole surcharging by pressure, the storm drain's intake — phase 5b needs these); a burst is still drawn and poured by the host as arrivals; node heads are not in the `?gpucheck` readout. `__frameCompare` and the still-flood total were not run: the pass touches only the columns intakes stand in.
- **A few frames' slack on an edit:** the water carried over to a re-packed network is the last read back, so what was drawn in the two or three frames since is not in it.

**Phase 4 — slop as a concentration** (2026-11-12). `ColumnField.foul` in `fluid/columns.ts` and the device's passes; `water/pollution.ts` cut down to a reader; the fork in `slop/tanks.ts` gone. Tests in `water/pollution.test.ts`, rewritten to behaviour.
- **One scalar a slot**, nought to one: the share of the column that is slop. The divergence sums what flowed into each cell and how much of that was fouling, each move at the strength of the cell it left; the apply pass mixes it. Water leaving a column leaves its strength as it was. The same lines on the host and in WGSL (`divergence`, `apply`, `arrive`, `accelerate`, `falls`, `landings`); three fields at the end of the packed buffer, their offsets in the last uniform vector's three spare words, a fifth region of the landings bank.
- **Sludge and pollution are one thing.** A pour of slop arrives at full strength and of water at none; a column of either is called slop or water by which side of a half its strength lies, in the apply pass. So a spill on a dry street is sludge as before, and a flood over it thins it into fouled water. `release` pours slop wherever it goes: into the water beside it if there is any, else on the ground.
- **Drag blends**: an edge's flux is kept by the mix of the two materials' drags at its upstream strength.
- **A fall takes it down**: what goes over a lip lands at the lip's strength (banked beside the landing, on both solvers).
- **It settles out** where the water is mostly clean, to a third in `FOUL_SETTLE` (900 s, the old model's rate); sludge does not. The old model's sharing between level tiles and its soaking into dry ground are gone: a level lake holds it where it is, and sludge on the ground dries as sludge always did (`events/cleanup`).
- **`pollution.ts` moves nothing.** It reads each tile's level off the columns four times a second — depth-weighted strength over `FULL` (a half: a unit of slop in a half step of water reads about as it did) — for the mood, the mains' cards, cooling and the overlay's texture, which are unchanged. On the device the scalar comes back with the depth band, the whole map every thirty readbacks.
- **Saves** keep the old key and meaning, a tile's level by its depth; an old map loads onto the columns.
- **Measured:** on the device, 12 units poured into the inlet fixture's river read 11.999 a second later and 11.835 after ten (settling alone is 0.13), the plume moving downstream. Divergence 0.013 ms and apply 0.007 ms a frame on the singularity fixture (0.007 and 0.026 before; within the noise). Host: none made or lost under a wave in a pond to two places; over a fall, more than 93% arrives with the rest still above.
- **Not done:** pipes do not carry it. A main still looks up the level at its intake's tile (`coolingKept`), and a sewer still lets slop out at full strength; the node concentration the plan describes wants a word a node in both pipe solvers. Spray drops off a fouled fall carry a material, not a strength. The `?gpucheck` harness does not compare the new field, and the still-flood total was not run.

**Phase 5 — the duplicates retired** (2026-11-12). `pipes/tick.ts`, `pipes/reports.ts`, `mainLiveAt` in `water/mains.ts`, the windows in `render/mains-layer.ts`. Tests in `water/mains-live.test.ts`.
- **One tick entry**, `stepPipes(g, field, dt, { pumps, slop })`: the editor's spouts, the water mains, then the slop. The scene called three things in two places and the takeover sim one of them; both call this. The slop moved from the town's part of the frame to the water's, so it reads the seating a frame behind; nothing turns on that.
- **One report list**, `pipeReports(g)`: every main, connection and trunk as a row with its kind, its layer and a tile. `mainReports()`, the copy of the mains' map that took no map, is gone; `mainReportOf(g, net)` asks for one network's.
- **A wrong key found by it:** the AI's water budget (`cooling-ai`) looked each main's report up by the network's id in a map kept by its first tile, so it never found one and counted every main at the draw of a new one. It reads the report now. The AI and takeover tests pass unchanged.
- **The tubes draw what is in the pipe.** `mainLiveAt(g, cell)`: how full the main stands at a tile (between two nodes, by how far along), what the run carries and which way. A window shows water only where there is some, as full as it stands, its streaks going the way and at the speed that link is going — so a main just laid fills along its length and a dry stub's glass is empty. Before, every window of a network showed full the moment its state said flowing, and the direction was a flood fill from the intakes.
- **Evened out:** a shut main's water rocks in it for ever, about a tenth of a unit each way (the solver has no damping at small flows). Each link's flow is averaged over a second and a half for what is shown, and a window's streaks move only over a tenth.
- **Spouts, looked at again: kept.** Folding them into the graph needs a pipe end that pours into the open — onto ground or into water — and the device pass has intakes and tank outlets only; that end is the outfall exchange phase 3 left and phase 5b builds. With it, a spout is a main with a free outfall and `pipes.ts`, `pipe-flow.ts`, `pipe-net.ts` and the drips pass's pipe bars can go. Looked at again after 5b.
- **Not done:**
  - Trunks under the ground are still drawn once and coloured by trouble; their fill (`sewerFillAt`) wants the per-link state buffer of phase 10, since redrawing them a frame at a time is what the band renderer must not do. Connections above ground show slop while they carry any, as before: they hold none of their own.
  - The grade solve (`solveSewers`) is still its own pass over the trunk layer beside the graph, and the two report maps are still kept where they are made; the list reads both.
  - The Water overlay's chevrons still take their direction from the intakes.
- **Seen:** the singularity fixture's Data Centre main full along its length and carrying 0.71–0.75 a tile; the `ports` fixture's fourteen stubs each in the list, their glass empty. A main part full was not looked at in the browser: tests only.

**Phase 9b — ports on the building** (2026-11-12). `structures/projects/entries.ts`, `studio` in `looks.ts`, `site.ts`. Tests in `entries.test.ts`, rewritten.
- **The housing is gone**: `drawEntries`, its box, cap, band and vent, `direct`, and the `ports` argument `drawFinished` took for it. `portSetback` puts every port's outlet on the wall behind it, as it did for the AI's; the mains layer already ran a pipe on past the plot's edge to a wall, so nothing there changed.
- **The vibe workplaces have a wall for it.** Both are the `studio` look. The outlet's place is past the block's front corner on the 2×2 Vibe studio and behind its back corner on the 4×4 Vibe Coder Studio, so the look gains a **service wing**: one storey of the same white block, louvred, under its own parapet, flush with the side wall, standing only where the main block leaves the outlet's place bare. The plate is on the wall the two make. The front planter that stood where the small plot's wing now is, is left out.
- **Nothing in the rules moved**: the port is the same tile, so routing, connect points, spills, saves and the AI are as they were.
- **Held by the test**: every def with ports has a wall the width of the outlet's plate behind each port the camera sees (`wallAcross`), and each vibe workplace has exactly one wing, touching its block, flush with it, in its material and lower than it. The list of defs with ports is pinned, so a building given ports later fails until it is looked at.
- **Seen** (`?world=1&fixture=ports`, by day): both workplaces with a connection run straight into the side wall, near and far zoom. **Not seen:** night, the far row from the other side, and the run across the plot on saddles — it is the plain tube for now (the saddles are phase 9's).

**Phase 5b — storm drains, and outfalls under water** (2026-11-12). `SEWER_GRATE` in `grid.ts`, `planStormDrain` in `sewers/lay.ts`, the drains and the outfall in `sewers/flow.ts`, the water's side in `slop/tanks.ts`, the grate in `render/sewer-layer.ts`, the button on the trunk's card. Tests in `sewers/storm.test.ts`.
- **A storm drain is a manhole with a grate**: a flag on the trunk's tile, not a fitting of its own, so a connection still comes down into it and everything that knows a manhole knows it. Laid from the trunk's card ("Add a storm drain here"), on a manhole or on a plain tile, where the manhole goes in with it. Free, as a manhole is. Refused where the trunk has no ground over it, at an exit, and on a sewer that ends only at a processor: rain has nowhere to go there.
- **It takes what stands on its own tile**, down to a puddle (`STORM_LEAST`), two units a second at most (`STORM_RATE`), and no more than its pipe and shaft have room for — so it never brings up at the manhole what it took down. The street's water runs to it as its tile empties.
- **The trunk carries water beside its slop.** Each node holds so much, and so much of that is storm water; a run passes both on in the share they stand in. A processor takes the slop and none of the water; an outfall lets out both, the water as water and the slop as slop, into the river. What comes up at a manhole comes up as the mix it is.
- **Slop in the street goes down a grate too**, and comes out as slop.
- **An outfall under water** lets out less the deeper it is drowned: nothing troubles it until the water's surface stands a half step over its bank (`OUTFALL_CLEAR`), and a slab more than that (`DROWNED`) stops it. What it cannot let out stays in the pipe, the nodes above fill, and the slop comes up at a manhole (`surcharged`). Judged by the surface over the bank's level, not by depth on the tile: a bank slopes into the river it pours into, and by depth every outfall on a brim-full lake read as drowned.
- **The guards:** a street flooded a slab and a half deep with a drain in it has 30% less water after half a minute than the same street without, and a quarter of it left after two; street, trunk and lake hold the same water throughout, to two places; the sewer's delivery falls with the depth over its outfall and is nought under a slab.
- **Found on the way:** an outfall looked for water beside it by the column's name, and slop just let into a lake renames the column until the water next steps — so it then poured on its own bank. It looks by strength now (`mostlyWater`). Two sewer tests that let slop out without ever stepping the water now step it, as the game does.
- **Not as the plan had it:**
  - **On the host, not in the device's exchange pass.** The sewers are host-side (phase 2), so a drain reads the depth the host has (asked for by name each frame, a readback behind) and takes it as an arrival. The plan's one-way manhole is kept: standing water does not go down a plain manhole.
  - **A drowned outfall slows and stops; it does not reverse.** Flood water does not come back up the sewer.
  - **Only in play.** The slop tick runs the sewers, and the editor does not run it.
- **Seen** (`?world=1&fixture=sewers`): the grate, square and barred beside the round covers, laid through the store's own action. The flow, tests only: no playable fixture has a sewer.
- **Spouts, looked at again as phase 5 said: still kept.** A spout pouring into the open wants a water main with a free end on the device; what was built here is a sewer's outfall on the host. That is phase 3's unbuilt half.

**Phase 7 — one technique** (2026-11-12). `render/sewer-layer.ts`.
- **Every solid piece of a sewer is on the lit pipe mesh** now, under the light the tubes are under: the manhole cover (rim, plate, a ring and a cross cast in it), the storm drain's grate (frame, the dark under it, bars), a span's pier (shaft and cap), the lift station, and the headwall with its pipe. Each is a few solids in the map's axes, a mesh a band, in the tier it was in: covers and grates flush with the ground, the rest with the town.
- **The `Graphics` box and tube are gone**, with the hand-picked side, front and top colours they needed: one colour a piece, and the mesh's light gives its faces.
- **Brick and concrete, as geometry for now.** The lift station is a brick house on a concrete footing: a darker course every third of a height unit standing a hair proud, a steel door under a lintel, a slab roof overhanging. The headwall is a concrete block with a coping, its pipe lipped and dark inside. The pier has a cap its tube sits on, and is built before the tube so the tube lies over it. Courses in the shader are phase 8's.
- **Still shapes:** the chevrons under the ground (phase 10 puts them in the shader) and the reach tint, which are marks laid over things and not things.
- **Seen** (`?world=1&fixture=sewers`, by day, near and far): the lift station, covers, a grate, the outfall's headwall at the pond, and the span's piers under its tube. **Not seen:** night, and a headwall facing the camera (the fixture's faces away, into its pond).

**Phase 8 — material and joints** (2026-11-12). `render/pipe-mesh.ts`, `render/pipe-gpu.ts`; the layers say what each piece is made of. Tests in `pipe-mesh.test.ts`.
- **Three floats a vertex, not two.** How far along its run a vertex is, how far across it, and the material. The plan had two and a hash; the material wanted a number of its own that no interpolation can blur. A tube's `along` is its place on the map along the way it runs, counted the same from either end, so a joint line carries on from one tile's length to the next; a wall's is its height, and its `across` its place along the wall. Plain pieces write three noughts.
- **`made(material, build)`** sets what tubes, sweeps and boxes built inside it are made of. A cell's own tube is of its main's material (`PipeLook.material`); what is fitted to it — flanges, collars, frames, bands — is plain.
- **In the shader, by material**, each mark a step softened a pixel and one fixed change of colour or tone:
  - cast iron (sewer connections, trunks): a joint line each tile, a casting seam along it, rust blooming down from the joints;
  - steel (water mains): a weld bead each two tiles, a faint seam winding round, scuffs along the top, a stain under each weld;
  - concrete (saddles, legs, piers, headwalls): the lines its boards left, each pour a shade of its own;
  - brick (the lift station): courses half a brick over from the one below, mortar between, each brick a shade of its own. The courses built as geometry in phase 7 are gone.
- **It goes away zoomed out**: every mark is scaled by `fine`, which falls to nought as a pipe length shrinks toward a few pixels (`fwidth` of `along`), so nothing crawls.
- **The same lines in WGSL and GLSL**, the GLSL typed from the same text; the test holds every mark's name in both.
- **Joints and fittings, as geometry:**
  - a **flange** is two rings with the gasket's dark line between them, bolts on the face as before;
  - a **cap** is domed: a crown standing out of the blind flange (`dome`);
  - a **reducer** where the bore changes (`Limb.meets`, `taper`): the wider length wears a collar and tapers over the last eighth of its tile down to the slimmer one's bore;
  - a **valve** has a body round the tube and a bonnet under its stem and wheel;
  - tees and crosses already had their collar.
- **Render time**, the sewers fixture whole in view: 0.89 ms after against 0.90 before (the HUD's `gpu render`, one reading each). Nine floats a vertex for six.
- **Seen** (`?fixture=ports` and `?fixture=sewers` in the editor, by day): a steel main with its domed cap, a gasketed flange and a concrete saddle; a cast-iron connection with its joint lines and rust; the brick lift station. **Not seen:** a reducer (no fixture has a part-widened main: tests only), a valve's body up close, and night.
- **Not done:** the drip stain is under each weld, not under each flange (a flange's place along the run is not the shader's to know); bolt heads are on a flange's face, not round its rim.

**Phase 9 — ground and ends** (2026-11-12). `render/pipe-mesh.ts`, `render/sewer-layer.ts`, `debug/fixtures.ts` (`buildPipeYard`). Tests in `pipe-mesh.test.ts`, `render/sewer-pieces.test.ts`, `debug/pipe-yard.test.ts`.
- **Footings and contact.** Every support — a saddle, a frame's legs, a span's pier — stands on a slab a little wider than itself, with a thin dark rim on the ground round it (`footing`). The rim's strength is the one number `CONTACT` (0.3): a constant in the mesh, not a uniform as the plan had it, since the pipe shader has no uniforms of its own. Nought turns it off. Nothing is under the length of a tube.
- **Saddles** are a block the tube lies in, wider than the tube so its cheeks show either side, with a steel **strap** over the tube. None on a bend, nor over a window's glass.
- **Frames** are thicker (`LEG`, `BEAM` 0.04 from 0.025), each leg on a footing; a road frame's legs stand in from the road's edge by their footing, so all of it is on its own tile.
- **A manhole's surround**: the cover, and a storm drain's grate, set in a square of concrete flush with the ground, a darker joint round it.
- **A span's portal**: a concrete collar with a coping on the bank's face where the tube comes out, dark inside. Only on a bank whose face the camera sees — the far one; the near bank's face is turned away and its own ground hides the join.
- **A headwall's apron and stain**: a slab under the pipe out to the bank's edge, and the stain of what it pours along the apron and, where the wall's face shows, down it.
- **The pipe yard** (`?world=1&fixture=pipeyard`): the `sewers` fixture's trunk — headwall, span and portal, lift station, manholes, a connection's drop — with a storm grate, and a water main from a pump at the pond to a Data Centre: saddles, a widened stretch with a reducer at either end, a bend, a road to cross on a frame, a capped stub teed off, the hill, the outlet and its valve. A test holds that each of those is on it.
- **Seen** in the yard by day: the main's whole run with its saddles, footings and their rims; a grate and a cover in their surrounds; the portal at the valley's far bank; the headwall (from behind: it pours away from the camera, so its apron and stain are on its far side); the pump house. **Not seen:** a strap up close, the road frame, a reducer, the stain on a headwall that faces the camera, and night. The yard's main follows the ground down into the valley, so it has no high frame either.

**Phase 10 — state and distance** (2026-11-12). `render/sewer-layer.ts`, `render/mains-layer.ts`, `render/pipe-gpu.ts`, `render/pipe-mesh.ts`. Tests in `sewer-layer.test.ts`, `mains-layer.test.ts`, `pipe-mesh.test.ts`.
- **A network's state changes its colour in place.** A trunk that backs up, surcharges or stops used to be drawn again from nothing: every mesh of every sewer destroyed and rebuilt. Now the layer keeps which vertices of which mesh are each network's, and writes their colour again (`recolour`): the same meshes, the same triangles, the same draw list.
- **Chevrons are the tube's own pattern.** The way a trunk falls is two more materials (`trunkOn`, `trunkBack`): cast iron with a V each tile, its point the way it falls, drawn by the shader from where along and across the tube a pixel is. The `Graphics` chevrons laid over the tubes are gone; under the ground there is nothing but meshes.
- **Depth shading.** A buried trunk is darker and greyer the deeper it lies (`deepened`): at the deepest a sewer goes, a third darker and half way to grey.
- **A manhole's shaft is a ring of brick** from its cover down to the trunk, the shader's courses round it.
- **Levels of detail are kept.** The mains' three levels were built again from nothing at every zoom threshold. Each is now built the first time a zoom wants it and kept; crossing a threshold shows one set of meshes and hides another, and all go only when a pipe is laid or lifted.
- **Reading at a distance:** steel a shade darker (`0xa6a9aa`), every tube's outline firmer, and far off a main a fifth thicker with its straps left off (bolts, valves and window frames already were).
- **The guard**, on the singularity fixture with its mains running: the windows' own render groups — the water in the glass, written every frame — rebuilt their draw lists 0 times in 960 frames. The bands the mains share with traffic rebuild about nine times a frame between them, as they did: that is the cars.
- **Not as the plan had it:** there is no buffer of per-link state that the shader indexes by a link id. State reaches the picture two ways instead, neither of which rebuilds anything: a network's colour by writing its vertices again when it changes, and fill, speed and direction through the windows' live mesh as before. The shader's chevrons do not move. The buffer is what phase 11's glass wants, and is left to it.
- **Seen:** the `sewers` fixture underground — chevrons along the trunks pointing down the fall, brick shafts under the covers; no device errors. **Not seen:** a network backing up in a running game (no playable fixture has a sewer; a test holds the colour changes in place), a deep trunk beside a shallow one, the far level's thicker tubes, and night.

**Phase 11 — glass and liquid** (2026-11-12). `render/pipe-glass.ts` (new: the window's mesh and its shader), `render/glass-state.ts` (new: the gallery's hook), `render/mains-layer.ts` (`glassSpans`, `showGlass`), `debug/fixtures.ts` (`buildGlassGallery`). Tests in `render/pipe-glass.test.ts`.
- **Fewer and longer.** One window a tile and a half long in the middle of each straight run of four tiles or more, and one more every eight tiles on a long run (`glassSpans`): the whole of its middle tile and a quarter of the tile either side, each tile's piece in that tile's own band. No flange inside a section; a steel collar at each end of it.
- **A window is a half cylinder built once, and a shader.** Per pixel, from where it sits across the tube: where the sight goes into the glass and out at the far wall, by height across the bore — closed form, from the two heights a window carries — and so how far it runs through liquid lying below the level. No marching, no loop.
- **The glass:** the pipe's far wall behind it, dark and wet, so an empty section is an empty pipe; brighter toward its edges; a sharp line of the sun along the top and a softer one lower; a thin dark line at each end where its thickness shows.
- **The liquid, at its real level:** part full, a surface looked down onto with the body seen through the glass under it, and a bright line where the surface meets the glass; full, no surface, and bubbles carried through it. Coloured by how much of it the sight passes through: water stays see-through to the far wall, slop is opaque in a finger's width; a mix by degrees.
- **Flow:** two patterns carried at different speeds; ripples that lengthen into streaks as it quickens; round flecks of foam past a speed; glassy when it stands. Slop heaves in broad swells, with lumps half sunk.
- **What it left:** a film above the level where it stood, draining down, slop's slowly, and a tide line on a sewer.
- **A front:** each end of a window has its own level, so a pipe filling shows the level run through it on a slope.
- **What moves is five numbers a vertex**, written into the window's own vertices each frame and sent up once a band: level, how far the pattern has been carried, how much is slop, how high it last stood, and its speed. `pipeLiveDrawable`, `windowGlass` and `WindowFill` are deleted: the mesh the host built again every frame is gone.
- **From the solver:** a water main's level at each end of each piece from `mainLiveAt`, its speed and direction from its link's evened-out flow, its mix from how fouled its intake is. A connection shows slop while it carries any.
- **The gallery** (`?world=1&fixture=glass`): forty-two short capped mains, each window told what to show — empty, a quarter, half and full across; still, slow and fast down; for water, slop and a mix; three runs along v; one climbing; and two that fill and empty, one of water and one of slop.
- **The same lines in WGSL and GLSL**, the GLSL typed from the same text; a test holds every mark's name and every number in both.
- **Render time:** with the whole gallery in view, 0.77–1.08 ms (the HUD's `gpu render`); the sewers fixture whole in view was 0.89 before any glass. On the singularity fixture close on a main, 2.6 ms, nearly all of it the ground.
- **Seen**, by day: the gallery at three zooms — every level reads apart, water and slop apart; a half-full fast window close, with its streaks and flecks; one filling, the level low and then full three seconds on; the singularity fixture's Data Centre main, full, in the game.
- **Not as the plan had it:**
  - **No buffer indexed by a link's id.** The state is written into each window's vertices instead: the same effect — nothing built, nothing structural — without a second binding in a Pixi shader. A window's patterns are carried by a distance the host adds up, so the shader needs no clock either.
  - **No tie rods** along a section; **no bubble that rises and bursts** in slop; a film **beads** but its beads do not fade one by one.
  - **Ports on a building show no liquid.**
  - `pipeCell`'s own `window` option is still there, unused by the game.
- **Not seen:** night; the climbing run and the runs along v close up; a mix close up; the far level's fallback; and WebGL — only the WGSL path ran in the browser.

**Phase 15 — connect it for me** (2026-11-12). `pipes/suggest.ts`, `play/suggest-card.tsx`, the ghosts in `render/connect-guide.ts`, `laySuggestion` in the store. Tests in `pipes/suggest.test.ts`.
- **Where:** a run started by a click, with the Pipe tool on a free inlet of a building that drinks, or with the Sewer tool on a free slop port. While only its start is pinned, the routes on offer are drawn as ghosts on the map and listed in a card: what each is best at, what it brings, and its price as the button that lays it. Pin a corner and they go: the player is drawing their own.
- **Up to three, each best at something:** the cheapest, the one that carries most, the one with no pump (a connection's: no lift station on its sewer's way down). Where one way is best at all three, the shortest of the others is offered beside it. Where there is one way, it is "Only way". Routes from the same water, with a pump or without, are one way: its cheapest.
- **Water:** from the five banks nearest the inlet, the five whose ground stands highest within reach, and the two nearest open ends of mains. **Sewers:** into the five nearest live manholes off the road, on a sewer with an exit.
- **No premium and no special powers.** A suggestion is a route and a stroke with that route given. It is worked out by `mainStroke` or `planLateral`, the planners a drawn stroke goes through, and laid by `endStroke`: the tests hold that its price is the planner's, that it is charged exactly that, and that it goes tile to tile over free ground.
- **Opened by doing it once by hand, a kind at a time** (`noteLaidByHand`, run with the pipes in play): the first water main not the AI's that is carrying opens the mains; the first connection that is draining — into an outfall, or into a manhole that took slop in — opens the sewers. Kept with the map (`pipeHelp` in the file).
- **Not from the AI's routers**, as the plan had it: `routePipe` routes over the AI's own ground from a building outward, and `sewer-ai` lays trunks. The suggestions use `routeMain`, the Pipe tool's own router, so a suggested route is one the tool would have found between those two ends.
- **Not done:** a slop port with no manhole in reach is offered nothing — the trunk it would need is a second job, and the AI's `trunkRoute` could supply it. Thirst is not asked of the inlet: a full building's free inlet is offered routes too.
- **Seen** in the game (`/?fixture=singularity`, its mains already carrying, so the mains are open): the Data Centre's free inlet offered "Cheapest — cools 16 of 16 — $662" from the river by gravity and "Shortest — pump — $25,338" from the pond, both ghosted; the first laid from its button, 41 tiles to the inlet. The sewer's side, tests only.

**Phase 16 — the overview** (2026-11-12). `pipes/overview.ts`, `play/pipe-list.tsx`, the fault card in `ui/comms/comms-dock.tsx`, the one button in `play/build-bar.tsx`, `overlayLine` in `render/mains-layer.ts`. Tests in `pipes/overview.test.ts`.
- **A list of every pipe**, top left under the landmarks while the Pipes view is on: one row a network — a dot for its state, what it joins ("Water → Data Centre", "1 workplace → water"), its state in a word, and a bar of what it carries against what it could. Trouble at the top; a click flies there. A row is its network's report and nothing else: the test holds one row a report, with that report's state, flow and capacity.
- **One Pipes view.** Water and Sewers were two buttons; they are one, **Pipes**, and the list has the switch between the two sides. It is on by itself with either tool in hand, on that tool's side.
- **Not by colour alone:** on the map a network's line is whole while it works, broken where it needs help (too low, pump unpaid), and dots where it has stopped; and thicker the more of what it could carry it is carrying. The list's key along its bottom says the same three.
- **Warned of before it fails:** a main feeding a tank that will be dry inside a minute at its present rate shows amber, the time in its tooltip; a trunk carrying more than nine tenths of what it can shows amber before it comes up in the street. The row's word is then "Soon".
- **Pipe faults in the town's problems:** a main gone dry, burst, too low or with its pump unpaid, a sewer backed up, over full or with its lift stopped, is a card in comms beside the town's other troubles — what, which, and **Show**, which turns the Pipes view to that side and flies there. This is the plan's "notice with Show" too: one card while the fault lasts, not a second one-off beside it. A pipe not finished — no source, nothing fed, no exit — is in the list and not in comms.
- **Seen** in the game (`/?fixture=singularity`), in both themes: the list with its three mains, the Data Centre's flowing at a full bar, the switch and the key. **Not seen:** a fault's card in comms (the fixture has no fault that counts), the sewers' side with anything on it, and the broken and dotted lines on the map.
- **A false "Soon" for a few seconds after a map loads:** what a main is seen to carry is evened out from nought, so a tank it feeds reads as running down until that settles.
- **Not done:** labels on the map are as they were; the tank's ring on the map does not itself turn amber for the minute's warning — the row does.


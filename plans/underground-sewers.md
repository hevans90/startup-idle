# Underground sewers

Status: **phases 1–2 done**, agreed in conversation on 2026-11-08. Replaces the sewer half of `plans/pipes-and-slop.md` (above-ground sewers, auto stubs). Water mains are unchanged.

## Why

**Sewers are the water main's twin, and it shows.** A sewer today is the same above-ground tube as a main, flagged brown. It asks nothing a main doesn't: drag from a slop port to water or a refinery, done. A vibe workplace beside one joins it by itself, so where you put the workplace hardly matters.

**The overhaul makes slop a planning problem.** You lay a sewer network **underground first**, falling downhill to an exit. Only then can you put a slop maker down, **near a node** of it, and pipe it in. The ground decides where the sewer can go:
- it has to fall all the way;
- where the ground drops away, it **pops up** onto a span;
- where a hill buries it too deep, a lift station **brings it back up**.

## Decisions

| Question | Decision |
|---|---|
| What goes underground | **Sewers only.** Water mains stay above ground as they are. The two systems live on separate layers, so a main can cross over a sewer. |
| Who needs a sewer | **Slop makers only:** the Vibe Coder Studio and the vibe offices. Houses and other workplaces don't. |
| Order of play | **Network first.** You lay a trunk underground with an **exit** (an outfall into water, or a processor). A slop maker can only be placed within reach of a **node** on a network that has an exit. |
| Hook-up | **Laid by hand.** Once it is placed, you pipe the building's slop port to a node with a short above-ground **lateral**. No more automatic stubs. |
| Pop up / dive down | **Gravity and terrain.** A sewer falls toward its exit at a minimum grade. The game works out the depth of every tile, and where it must surface: **spans** over dips, rivers and cliffs, **lift stations** where it would be buried too deep, **headwalls** at outfalls. You see them while dragging, before you pay. |
| Nodes | **Placed by the game** as you lay a trunk: at each end, junction and bend, and at least every 8 tiles along it. They sit on open ground or road, as manhole covers. You can add one with a click on the trunk. |

## Design

### 1. The layer

- **A grid layer of its own**, not `grid.main`, so a sewer can run under a water main, a road or open ground:
  - `sewer: Uint8Array`: the joins (`DIR` bits) and flags (bore, AI);
  - `sewerFit: Uint8Array`: what it has at the surface on each tile — a node, an outfall, a processor inlet.

  How deep it lies, and where it spans or lifts, isn't stored: the solve works them out from the ground (§2), so reshaping the ground re-routes them.
- **Where it may go:** under ground and roads. **Not under buildings or reservoirs**, so a building's foundations never have to know about it, and demolishing never breaks a sewer. Buildings can't be placed over a trunk, so the network you lay first keeps its land.
- **Saved** with the map, as `main` is. The serializer gains the two arrays. Old saves are converted (§8).

### 2. Gravity: the solve

A network is solved **from its exit upstream**, once per edit, and kept until the map changes, like `findMains`.

- **Invert:** each tile upstream lies at least `GRADE` (1 height unit in 10 tiles, to start) above the next one down, as near the ground as it can be with `COVER` (1 unit) over it, and low enough that everything above it can still fall into it. Worked out in two passes: from the top ends down (how high each may lie), then from the exits up (where each does lie).
- **Spans:** a **dip** — ground more than 1.5 units under where the pipe above wants to be, a valley or a river bed — is crossed on piers at the pipe's own level, if the span stays within `SPAN_MOST` (8 tiles). Exits and nodes always keep the pipe in the ground. A dip on the way down to the exit (the foot of a cliff) is just dug into.
- **Lifts:** where keeping the fall would bury a tile deeper than `DEEPEST` (4 units), the tile above it that pulls it down becomes a **lift station**, pumping its slop up to the next. A hill too high to dig through, and a valley too wide to span (spanned as far as it may be, dug under the rest), both end in one.
- **Outfall:** where the exit meets water, the pipe surfaces at a headwall on the bank. This is the existing outfall fitting, kept.
- **Capacity:** a gravity sewer carries `SEWER_RATE × bore × √(grade ÷ GRADE)`, capped at 3×. A steeper trunk carries more. A lift station passes `LIFT_RATE` a second, and costs money a second to run, as a pump intake does (`MainPumps.pay`). Unpaid, it stops and everything upstream of it backs up.
- **Pure and tested:** `solveSewerNet(grid, net) → { inverts, fittings, capacity, problems }`, in `world/sewers/solve.ts`. The fixtures should cover a hill, a valley, a river crossing, a cliff and a flat run.

### 3. Laying a trunk: the Sewer tool

- **A tool of its own** on the build bar, **Sewer**, with two modes:
  - **Trunk** (the default): drag from an exit, or from a sewer already laid, to where you want to serve. The route follows your drag; the router only bends it around buildings.
  - **Lateral:** connects a building to a node (§5).

  The Pipe tool loses its Water | Sewer toggle.
- **The preview, as you drag:**
  - the route drawn at its depth in the underground view (§6);
  - its spans and lift stations, ghosted;
  - its nodes;
  - a red tile, with the reason, where it can't go: under a building, a span too long, no fall to its exit.
- **The card:**
  - cost: tiles, plus depth, plus spans and lifts;
  - capacity a second;
  - lift stations and what they cost a second to run;
  - where it exits, or "No exit yet".

  Short lines, detail in tooltips.
- **Costs:** a tile costs `pipeCost` × (1 + depth ÷ 2), so a deep dig costs more than a shallow one. Spans cost 3× a tile, and a lift station is priced like a pump intake. Following the ground downhill is the cheap route. That is the "smart" placement the player learns.
- **No exit, no service:** a trunk can be laid without an exit, but its nodes show grey, "No exit", and nothing can be placed against them.

### 4. Nodes

- **Placed by the solve** at each end, junction and bend of a trunk, and at least every `NODE_EVERY` (8) tiles. A node goes on open ground or road, never on a span or a lift.
- **Added by hand:** clicking a trunk tile with the Sewer tool adds a node there, free.
- **Drawn on the surface:** a cast-iron manhole cover, flush with the ground or the road. When its network backs up, it lifts and bubbles brown (the burst-main recipe, moved).
- **Reach:** a node serves slop ports within `LATERAL_REACH` (6 tiles) along a lateral's route.

### 5. Slop makers: placement and hook-up

- **The placement rule** (`PlaceRules.needsSewer`, a rule of play like `needsRoad`; the editor ignores it): a slop maker needs a live node (on a network with an exit) within `LATERAL_REACH` of where its slop port would be.
- **The ghost shows it:** with a slop maker in hand, every live node draws its reach as a faint ring. A site out of reach is red, with the reason "No sewer node in reach".
- **Built, it isn't connected yet.** Its tank fills and spills as today, until you lay a lateral.
- **Laterals:** the Sewer tool's Lateral mode drags from a slop port to a node. It's the existing above-ground tube (`grid.main` with `MAIN_SEWER`), short and brown, refused past `LATERAL_REACH`. One node takes up to four laterals, one a side.
- **Grown or rebuilt** (a new tier, a repair), a building keeps its lateral if its port stays where it was. Otherwise the lateral is taken up and the card says so.

### 6. Seeing it

- **On the surface, always:** manhole covers, laterals, spans on piers, lift stations (a small brick pump house), and outfall headwalls.
- **The underground view:** the ground goes see-through, using the existing `setGroundAlpha` and `XRAY_GROUND`. Trunks are drawn beneath it at their depth, in a new tier at the start of each band (`sewerOf`), so the ground sorts over them.
  - **When it shows:** it turns on by itself with the Sewer tool, and has a toggle in Views.
  - **Colour by state:** flowing umber, backed-up red-brown, no exit grey.
  - **Flow:** chevrons downhill along each trunk, showing which way it falls.
  - **Depth:** a faint drop line from each node to its pipe.
- **Performance:** the tier is hidden outside the view. Trunks are redrawn only on edit, as mains are. Measure with `__waterBench` with the view on and off.

### 7. Flow, backups and spills

- **Each frame** (`stepSlop`, re-pointed): tanks drain through their laterals into their node's network, as much as the network can still carry. The network delivers to processors first, then its outfalls, as today.
- **Over capacity:** when inflow exceeds what the trunk downstream of a node can carry, that node **surcharges**. It spills sludge at its cover, onto the street, as a full tank does at its port. Then the tanks behind it back up and spill too. So a busy street needs a wider bore, a steeper route or a second trunk.
- **Events:** the sewer backup chokes the busiest node instead of the longest sewer (`breakableCell` gains the sewer layer). The burst main is unchanged: it's water.

### 8. Old saves

- **Converted on load,** as the pit was:
  - each above-ground sewer network becomes a trunk on the same tiles, solved;
  - its stubs and drains become laterals to a node put on the trunk tile beside each port;
  - its outfalls stay.
- **Where the old route can't fall** (it ran uphill, which nothing stopped before), lift stations are placed for free on conversion and say so on their card.
- **Grandfathered:** slop makers already standing keep their place. The placement rule only applies to new ones.

### 9. The AI and the sims

- **AI mode** (`sewer-ai.ts`, rewritten) lays the trunk first: from the nearest processor or a downstream outfall, along the ground's fall, to the streets it means to build vibe offices on. It builds offices only where a node reaches, and lays each lateral. Its site picking (`autopilot`, `planTown`) gains the node-reach rule.
- **The takeover AI** lays no sewers, as now.
- **`simulate-map-run`:** the sewer price becomes a trunk's price (tiles and depth at a typical grade), paid before the first slop maker. The pacing guards in `map-balance` must hold.

## Phases

1. **Done: the layer and the solve.** `grid.sewer` and `grid.sewerFit`, undoable and saved; `world/sewers/solve.ts`. Was: `solveSewerNet` with inverts, spans, lifts, outfalls and capacity; pure, tested on fixtures for a hill, valley, river, cliff and flat run. Nothing drawn or used yet.
2. **Done: seeing it.** `render/sewer-layer.ts`, the `sewers` fixture, `sewerView` and a Sewers toggle in Views. The view costs nothing measurable (`__waterBench` on the fixture: GPU render 0.17 ms off, 0.20 on). Was: the `sewerOf` tier; the underground view (ground see-through, trunks at depth, state colours, chevrons); surface fittings (covers, spans, lift houses, headwalls). Laid from the console on a fixture for before-and-after screenshots; `__waterBench` with the view on and off.
3. **The Sewer tool: trunks.** Drag, route, live preview of pop-ups and their costs, refusals with reasons, auto nodes and nodes added by hand. The Pipe tool's toggle goes.
4. **Laterals and flow.** Lateral mode; slop through laterals into nodes; capacity by grade and bore; lift stations paid; surcharging nodes spill; the auto stubs removed. The sewer-backup event moved onto nodes.
5. **Placement.** `needsSewer` for slop makers; the ghost's reach rings and refusal; a placed building waits unconnected until laterated.
6. **Old saves.** Conversion on load, with free lifts where needed; grandfathering; a round-trip test on a save with the old sewers.
7. **The AI, the sims and balance.** AI mode lays trunks first and sites offices by node reach; the sim's price; `map-balance` re-measured; README.

## Questions

1. **Under buildings.** The plan says no: a trunk runs under roads and ground only, and a building can't go on top of one. Allowing it would make routing easier, but then demolition and placement have to care about what is underneath. Confirm "no"?
2. **Do lift stations need power**, or only money a second? Power would tie them to the blackout event, which already darkens a district.
3. **Numbers:** `GRADE`, `COVER`, `DEEPEST`, `SPAN_MOST`, `NODE_EVERY`, `LATERAL_REACH`, the rate by grade, the lift's rate and running cost. These are first guesses; tune them against the sims.
4. **Houses later?** If houses ever make waste, the same nodes and laterals serve them. Not now.

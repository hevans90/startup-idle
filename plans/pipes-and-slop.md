# Pipes that look built, and slop that has to go somewhere

Status: **plan**, agreed in conversation on 2026-10-27; not started. Follows `plans/pipes-overhaul.md`, whose model (mains, fittings, the steady-state solve) stays.

## Why

**Pipes look broken.** Seen on the singularity fixture's map:
- **Flat, not 3D:** mains are 2D "sausages" laid over the iso map. They don't sort with the town, so a main draws over the house in front of it.
- **Too big:** a tube is about a third of a tile wide.
- **Heavy joints:** each bend wears a thick, black-outlined ring.
- **Wrong fittings:** the pump intake is a flat blue square facing the camera; the outlet valve is a giant red disc.
- **No visible flow:** at any normal zoom, nothing shows water moving.
- **No connection points:** a Data Centre or an AI building has nothing marking where a pipe goes in, so mains end anywhere along a wall.

**The slop pit is a building that fills by itself.** The pressure it makes (vibe coders cost you something) is real, but it asks nothing of the player's town: no routing, no choices of where it goes. Slop that has to be piped out, can foul the river, and can be turned into something useful makes the vibe coders a city-builder problem.

## Decisions

| Question | Decision |
|---|---|
| Pipe form | Above ground, slim (about 1/10 tile): real isometric tubes on small saddles, a raised span over roads, sorted with buildings. |
| Connections | **Fixed ports** modelled on each building that takes or gives fluid: a flanged nozzle on a set face, blue for water in, brown for slop out or in. Pipes must end on a port; the tool snaps to them. |
| Flow look | **Glass sections** every few tiles showing the fluid moving inside (water blue, slop brown and lumpy), at the speed of the flow; **chevrons** along the pipe on hover and in the Water overlay. |
| Networks | **Separate types:** water mains (blue-grey) and slop sewers (brown, a little wider). They never connect; a port says which it takes. |
| Slop source | Every vibe-coder workplace (the Studio and vibe offices) fills a small tank on itself as its people work. Full, it **spills onto the street** as sludge (the existing fluid): homes near it lose morale, and it needs mopping up. |
| Many outlets | **Sewer networks:** a workplace within one tile of a sewer joins it by a short stub to its port, automatically. One trunk serves a street of offices. |
| Pollution | Slop piped into a river or lake **turns the water brown** (really, in the water simulation), **homes by polluted water lose morale**, and **mains drawing polluted water cool worse**. |
| Cleanup | It **flows away**: it dilutes as it spreads and leaves with the river; a lake holds it much longer. |
| Processors | **Slop Refinery** (innovation), **Training Data Plant** (feeds the AI), **Content Farm** (valuation and LinkedOut reputation). Each opened by a one-off **project**, then **buildable** as many times as wanted, each taking so much slop a second. |
| Removal | **Replace, keep the jokes:** the pit, its store, its overflow event and its trucks go; its sludge fluid and the mopping-up crews stay for spills; what mentioned the pit is moved onto slop. |
| Order | Pipes first, with the pit untouched; then the slop system replaces the pit in one switch. |

## Design

### 1. The tube, drawn

- **Pieces, baked per shape:** straight, elbow, tee, cross and end in each orientation, plus a road span. Each is drawn with the same primitives as buildings (`structures/projects/looks.ts`: boxes with lit, shaded and top faces), so it is a real iso solid, and **put in its band like a structure** so the depth sort hides it behind what stands in front.
- **Slim:** about 0.1 tile across (0.13 for sewers), on low saddles every other tile, with a slight sag between them; a raised span with two posts over a road. Joints are a thin collar, no black ring.
- **Colours:** water mains galvanised blue-grey, the AI's banded violet as now, sewers dark umber with a brown band.
- **Glass sections:** every 4 tiles a short transparent length. Inside, the fluid moves at the speed of the main's flow: water as light blue streaks and highlights, slop as slow brown lumps. A dry or idle main shows an empty section.
- **Chevrons:** small arrows along the tube, pointing with the flow, shown only on hover and in the Water overlay.
- **Fittings, rebuilt as solids sized to the tube:**
  - **intake:** a grated bell mouth just under the surface, with a slow swirl in the water while drawing;
  - **pump intake:** a small pump house on the bank, its wheel turning while it runs;
  - **outlet port:** the building's own nozzle (below), with a flange;
  - **outfall** (a sewer into water): a pipe mouth over the bank, a brown plume where it runs;
  - **cap:** a small red cap, no bigger than the tube.
- **Performance:** pieces are cached per shape and scale; the glass sections are the only per-frame drawing. Measure with `__waterBench` before and after.

### 2. Ports

- A `StructureDef` gains `ports`: each a face (N/E/S/W of the footprint), a position along it, a fluid (`water` | `slop`), and a direction (`in` | `out`). Examples:
  - Data Centre: two water inlets on its back face;
  - AI buildings and reservoirs: one water inlet each;
  - Vibe Coder Studio and vibe offices: one slop outlet each;
  - each processor: one slop inlet.
- **Drawn on the building:** a short flanged nozzle sticking out of the wall, coloured by fluid. They're part of the building's look, so they show whether anything is connected or not.
- **The tool snaps** an end dragged near a building to the nearest free port of the right fluid. Ending on a wall without a port is refused, with the reason.
- **Existing mains** (old saves, the AI's) are re-ended on load: a main whose outlet meets a building away from a port is re-routed for its last few tiles to the nearest water port, by the router. If that fails, it's left as it was, and the Water overlay marks it.

### 3. Sewers

- **A second pipe type** on the same machinery: a network's cells carry a fluid, and laying one type through or onto the other is refused. The Pipe tool gets a toggle: **Water | Sewer**.
- **Sources:** the slop tanks of the workplaces it connects to, by a port on the line or a stub (below).
- **Sinks**, in order of preference:
  1. processors, up to each one's capacity;
  2. an **outfall** into water.
  
  A sewer with neither backs up, and the tanks it serves fill.
- **Stubs:** a vibe-coder workplace whose slop port is within one tile of a sewer is joined to it automatically, with a short stub drawn from the port to the trunk. Built or removed, the stub follows.
- **Capacity:** a sewer carries so much a second, widened like a main (the bore upgrade). Gravity matters less for slop: it's pumped from the tanks, so a sewer's limit is its bore, not its head.

### 4. Slop

- **Made:** each vibe coder at their desk makes slop at a steady rate, scaled by their Morale's slop multiplier (happy coders ship cleaner; phase 2 of the innovation overhaul) and by policies (Hackathon Culture, +20%). It goes into their workplace's tank, which holds about two minutes of its output.
- **Shown:** a fill gauge on the workplace's card and label, and a brown sheen on its port when full.
- **Spilled:** a full tank pours onto the street at its port, as sludge in the water simulation (the pit's overflow code, moved). The spill:
  - lowers the morale of homes it reaches (the existing sludge rule);
  - is mopped up by vibe coders sent off their desks (the existing cleanup crews);
  - dries in time.
- **Piped out:** the sewer drains the tanks it serves, each at its share of the sewer's capacity.

### 5. Pollution

- **In the water:** an outfall pours slop into the water simulation. The open technical question is how. Today a column carries one fluid material, so mixing sludge into a river isn't modelled. The plan is to add a **pollution concentration** per water column, carried with the flow (advected) and diluted as it spreads, and leaving the map with the river at its outflow edges. The water renderer tints toward brown by concentration. A spike first decides between this and switching columns to sludge (phase 6).
- **Homes:** the water-view bonus (+5) becomes a penalty where the water in view is polluted beyond a threshold (`mood-rules`: "polluted water").
- **Cooling:** a main's flow counts for less as cooling when its intake draws polluted water (×(1 − concentration), floored). The Water overlay says so at the intake.
- **Clearing:** stop the source and a river clears in minutes; a lake much longer.

### 6. Processors

| Project (opens it) | Building, buildable after | Takes | Gives |
|---|---|---|---|
| Slop Refinery | Refinery | Slop | Innovation, so much per unit ("Refactored into Best Practices") |
| Training Data Plant | Data Plant | Slop | Training runs faster and the meter pushed a little (its memo jokes about model collapse) |
| Content Farm | Content Farm | Slop | Valuation, and LinkedOut reputation while it runs |

- **Each building** has a slop inlet port and a capacity (units a second). A sewer feeds it first; whatever exceeds the capacity goes on to the next sink or backs up.
- **The projects** sit in the project list after the Studio:
  - Refinery: early, about when vibe coders reach 50;
  - Data Plant: after the Data Centre;
  - Content Farm: after the Boardroom.

  Each grants its building to the build bar (a new `FeatureId` each).

### 7. What the pit leaves behind

- **Goes:** the `slop-pit` structure, `slop-pit.store`, the overflow event and its card, sludge trucks, the pit's mood rule, and its projects-panel line.
- **Stays, re-pointed:**
  - the sludge fluid and its spill code;
  - the cleanup crews;
  - the vibe coders' Morale effect (now on slop *made*);
  - Hackathon Culture (now on slop made);
  - the skill tree and fusion effects that mention slop or the pit, re-worded onto slop made or processed;
  - the AI planner's avoidance of the pit (becomes avoidance of outfalls and polluted shores);
  - desirability near sludge.
- **Old saves:** the pit is demolished on load and its fill poured as a one-off spill that dries without mopping; a vibe workplace starts with an empty tank.
- **Simulations:** `simulate-map-run`'s slop trucks become the cost of a Refinery and a sewer, built when the pit would have been; the pacing guards must hold.

### 8. The AI

- **Cooling routes:** `pipe-route.ts` routes to ports.
- **AI mode** (the Model's runs) lays a sewer along each street of vibe offices to the nearest processor, or else an outfall downstream of its town. It builds a Refinery when its slop needs one.
- **The takeover AI's buildings** get water ports. The violet mains are unchanged.

## Phases

1. **The tube.** (Done: drawn with boxes and rings rather than baked pieces, which keeps the per-cell redraw as it was.) Iso pieces, slim, sorted in bands, saddles and road spans, thin collars; fittings rebuilt to size. No flow changes. Before/after screenshots on the singularity fixture's map.
2. **Flow.** Glass sections with moving water at the flow's speed, chevrons on hover and in the overlay, intake swirl; `__waterBench` before and after.
3. **Ports.** `StructureDef.ports` for every drinker, drawn on the buildings; the tool snaps and refuses; old mains re-ended to ports on load; the AI router to ports.
4. **Audit.** A pass over the pipe tool and the overlay for anything else broken (previews, stilts, ends, the Water overlay's numbers), each fixed or listed.
5. **Sewers.** The second pipe type: the tool's Water | Sewer toggle, sewer drawing, auto stubs, outfalls, and sinks in order.
6. **Pollution spike, then pollution.** Concentration in the water field, advection, dilution, outflow; the brown tint; homes' morale; dirty cooling.
7. **Slop replaces the pit.** Tanks on vibe workplaces, spills, gauges; the pit removed with its store, event and trucks; effects re-pointed; old saves converted; the sim's trucks replaced.
8. **Processors.** The three projects and buildings, their effects, capacities and ports.
9. **The AI, the sims and balance.** AI mode lays sewers and builds refineries; the pacing guards (`map-balance`) re-measured; README.

Phases 1–4 touch nothing of slop: the pit keeps working until phase 7 switches it.

## To decide while building

- The pollution model (phase 6's spike): a concentration per column, or columns of sludge.
- Numbers: slop per vibe coder a second, tank size, sewer capacity, each processor's rate and yield, the pollution thresholds. Tune against the sims.
- Whether the Water overlay grows a slop mode, or a separate **Slop** overlay shows sewers, tanks and pollution.
- Whether 10x devs make anything (tech debt?) later. Not now.

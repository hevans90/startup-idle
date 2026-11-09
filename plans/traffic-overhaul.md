# Traffic & walker overhaul

Cosmetic: nothing here touches the economy. It must look real at a glance, with
no car ever driving through another car or a person. It replaces the old
system outright, with no `?traffic=old` flag. Foundations ship first, and each
phase is committed and playable on its own.

## Decisions
| | |
|---|---|
| Depth | Looks real, stays cosmetic |
| Junctions | Give-way / priority everywhere; **traffic lights** auto by size/busyness; **roundabouts** auto where two wide roads cross |
| Pavements | Both sides of every road |
| Scale | ~80 cars / ~120 people (caps from 40 / 50) |
| Parking | Kerbside bays |
| Crossing | At junction corners and zebras; cars yield to people on a zebra or a green walk signal |
| Walkers | Pass & overtake, pairs & groups, **children with parents**, stop & chat / window shop, joggers, dog walkers |
| Car looks | Brake lights, indicators, headlights at night, hazards on stopped vans |
| Lanes | Change lane to get in lane for a turn (roads ≥2 wide) |
| Buses | Auto routes and drawn stops; walkers queue and board |
| New users | Cyclists, emergency vehicles (traffic pulls over) |

## Today (what gets replaced)
- `agents/roads.ts`: `carLine` and `walkLine` put movers at offsets from cell centres.
  Walkers use one kerb edge of the road cell and cross wherever their route turns.
- `agents/town.ts`: look-ahead braking (`conflict`/`meeting`), the lower id wins a
  standoff, and after 4 s stuck a car "pushes on" through others. Cars vanish at doors.
- Zebras and benches are props in `render/street-props.ts`. Only the benches are used,
  for sitting.

## Phase 1 — The lane graph (`agents/lanes/`) ✅
Done: `graph.ts`, `geometry.ts`, `lanes` overlay, tests over every fixture. Notes:
- Generated roads are 2-wide staircases; a street's slices may step sideways and its
  lanes follow a smoothed middle. Streets that turn (short L arms) are cut at their
  corners (`cutAtCorners`) before any is folded into a junction.
- Crossings sit at the junction's edge; the painted zebras are a little further back —
  line them up in phase 4.
- `bigtown` (128²) builds in ~27 ms; the overlay caches by revision.

One graph built from the road network and cached per road revision, replacing the cell
offsets.
- **Lanes**: per road segment and per direction, polylines in tile space with a height
  sampled from `roadHeightAt`. On a 1-wide road, one lane each way either side of the
  middle; on wider roads, one lane per cell column, per direction (right-hand
  traffic, as today).
- **Junction connectors**: from each entry lane to each allowed exit lane, as a cubic
  curve with its radius (turn speed comes from the radius). Each connector is tagged
  left, straight, right or U.
- **Conflict zones**: each pair of connectors that cross or merge gets a zone (point
  and length along each). This replaces all the pairwise look-ahead at junctions.
- **Pavements**: a strip each side at the kerb (`KERB`), joined round corners. At
  junction mouths and zebras, **crossing links** join the two sides and are tagged
  with their junction or zebra.
- **Junction kinds** come from the graph: `priority` (the main road is the through
  road with the most lanes, otherwise the straightest pair), `signals`, or
  `roundabout`. Lights go on 4-way junctions with a wide road, or on junctions
  whose queues stay long (measured live, with hysteresis, and saved nowhere).
- Pure data and fully unit-tested: lane counts, connector sets, conflict pairs, and
  pavement continuity round every block. Overlay buttons for `lanes` and `junctions`.

## Phase 2 — Junctions
- **Priority**: a stop line on each side road. A car crossing or joining the main road
  needs every conflict zone on its connector to be clear of priority traffic
  arriving within its time gap. A main-road car turning left yields to oncoming traffic.
- **Signals**: phases (each through-road pair, then a short all-red), green 8–14 s
  scaled by queue, and a walk phase with the all-red. Lights are drawn as poles at the
  corners (baked prop) with lamp colours as tinted sprites.
- **Roundabouts**: the autotiler gets a roundabout piece (a central island
  with planting, a one-way ring and splitter islands) wherever two roads ≥2 wide
  cross. Entering cars give way to traffic already on the ring. The road autotiler is
  in `roads/` (`variants.ts` / `looks.ts`) and gets a 3×3 roundabout footprint.
- **Junction box reservation**: a car enters a junction only if its exit has room
  for it, so a junction never gets blocked. The "push on" hack is deleted. A soak
  test runs 30 min of sim on generated towns and asserts no overlap and no stall
  longer than 60 s.

## Phase 3 — Driving
- **IDM following** on lanes: desired speed, time headway 1.2 s, minimum gap, and
  comfortable braking. It replaces `trafficLimit`/`lineLimit`.
- **Lane changes** on roads ≥2 wide, ahead of a turn: a MOBIL-style safety check
  on the target lane gap, then a smooth sideways blend over ~1 tile.
- Turn speed comes from the connector radius; ramps keep their pitch as today.
- **Emergency vehicles** (ambulance, fire engine, police; baked like the fleet):
  sent to disaster or event sites (see `events/`), with sirens (flashing light
  layer, plus a sound if the audio system has a fitting hook). Cars ahead pull to the
  kerb and stop, and junctions give them priority.
- **Cyclists**: baked bike and rider (people sheet tints, bike model in `cars/`
  style). They ride at the kerb edge of the lane at ~0.8 of car speed, and cars
  queue behind them (no overtaking, to keep it simple).
- Caps go to 80 cars. A spatial hash over lanes means each mover only checks its own
  lane, the next connector and its zones.

## Phase 4 — Crossings
- Walkers route over the **pavement graph** (Dijkstra, cost by length, with a small
  penalty per crossing) and only cross on crossing links.
- **Zebras**: generated at junction mouths on streets of beauty level 2 and up
  (as now), and mid-block on long streets. A car yields when a person is on the
  zebra or about to step on. Walkers wait at the kerb for a gap in cars that
  can't stop in time.
- **Signal crossings** use the walk phase, with a walk/don't-walk lamp on the pole.
- Plain junction corners with no zebra or signal: the walker waits for a gap.

## Phase 5 — Parking & arrivals
- **Kerbside bays** along roads where buildings front them: painted bays on
  the road's edge lane of 1-wide roads (one side) or the outer lane of wide roads.
  These are part of the lane graph, and a parked car blocks nothing.
- **Arriving**: the car takes the nearest free bay to its door (or circles once,
  then double-parks with hazards if it's a van). It slows, indicates, pulls in,
  then the driver (and any passengers, 0–2) appear at the door side and walk to
  the door.
- **Leaving**: walkers come out and walk to a parked car, get in, and it indicates
  and pulls out when the gap is safe.
- Parked cars persist for their trip duration, and some are always parked (a share of
  residents), so streets look lived-in. Bays cap at ~1.5× cars. This isn't saved.

## Phase 6 — Walker life
- **Pavement lanes**: two lanes per pavement (keep right). Walkers overtake by
  moving to the other lane when it's clear, and step aside for oncoming groups.
  This is a social force on a 1-D lane with side offset, not full 2-D crowds.
- **Groups**: 1–3 walking abreast or in file when the pavement is busy, sharing a
  pace. Some are **parents with children**: new child figures (2 builds, ~0.6 of
  adult height, baked walk/sit) at a quicker phase, holding hands with an arm pose
  (new `hold` arm option in `figures.ts`).
- **Stop & chat / window shop**: on a hashed chance, pause 4–12 s at a shopfront
  (facing it) or meet another walker and face each other. Idle sway pose (bake
  a `stand` pose).
- **Joggers**: a run pose (new bake: 16 headings × 8 frames), faster, overtaking.
- **Dog walkers**: baked dog (3 breeds × tints, walk cycle) on a lead (a line
  drawn hand to collar), wandering ± a little with sniff stops.
- People cap goes to 120. Benches and cafés as now (cafés: sit at the café set).

## Phase 7 — Buses
- **Auto routes**: a loop over the busiest door-dense streets (the longest cycle
  through the top-k streets by doors). There's one route a ~40 buildings, rebuilt when roads change.
- **Stops**: a baked shelter prop with a pole every ~6–8 tiles on the route, at
  the kerb, on the side traffic drives.
- Buses pull in at stops (indicate, stop, doors 3–5 s). Walkers whose trip is far
  walk to a stop, queue, board (vanish into the bus), ride, and alight at the stop
  nearest their destination. The shuttle bus card keeps its share as a route bus.

## Phase 8 — Lights & signals on the cars
- New sprite layer in the car bake: **lamps** (front, rear, indicators), as a
  separate white layer per frame, tinted at runtime: rear red low/high (brake), amber
  blink L/R, front warm white. This means a rebake of `cars` with one more layer, and
  the size cost is checked (crop tight).
- **Headlights at night**: additive glow sprite on the road ahead, with strength from
  `daylight`. Hazards are both indicators blinking.
- People need nothing; cyclists get a small front/rear lamp at night.

## Cross-cutting
- **Perf**: budget ≤1.0 ms js for 80 + 120 movers. Off-screen movers step at
  ¼ rate with no pose work. Bench with `?crowd=` in the `bigtown` fixture.
- **Fixtures**: `?fixture=traffic` (one of each junction kind, a zebra, bays, a
  bus route), `?fixture=walkers` (busy pavements, groups, kids, dogs).
- **Tests**: lane graph, junction rules, IDM, no-overlap soak, parking cycle,
  pavement routing never on road except crossings, bus route build.
- **README**: one line per new system as each phase lands.
- **Bakes**: people (+child, run, stand, hold), dogs (new sheet or the props sheet),
  bike, emergency vehicles, light layer on cars, lights and bus-shelter props.

## Smaller defaults taken (say if wrong)
- Right-hand traffic stays.
- No accidents or crashes.
- Emergency calls come from existing events/disasters only (no random ones).
- Bays are painted on the road. No separate parking-lane tile.
- Roundabouts only where two ≥2-wide roads cross, never on 1-wide roads.

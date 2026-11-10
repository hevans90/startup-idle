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

## Phase 2 — Junctions ✅
Done: `lanes/drive.ts` (routing, lights, who yields), driving in `town.ts`, `render/signals.ts`,
roundabout island and stop/give-way paint in `roads/looks.ts`, `?fixture=traffic`, soak tests
(`lanes/traffic.test.ts`: three minutes busy on four fixtures, no overlaps, nobody stuck for good). Notes:
- Cars hold their junction's zones (shared by cars on the same curve), enter only with room on
  the exit, and stop with the nose back from the box (`hold`, per lane). After 8 s waiting a car
  stops yielding; after 45 s stuck it is lifted off (a safety net the soaks never hit).
- Lights cycle 9 s green / 2 s amber / 1.5 s all-red per axis, offset per junction. Not yet scaled
  by queue, nor put on busy junctions that the shape alone doesn't call for, and no walk phase yet (phase 4).
- The poles are drawn, not baked; lamps are lit by alpha when the light changes.
- Following is still the old speed-limit model; IDM is phase 3.
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

## Phase 3 — Driving ✅
Done: IDM following (`follow`/`drive` in `town.ts`), lane changes (`lanes/drive.ts`), the
emergency services (`agents/emergency.ts`), cyclists (a "ride" pose in the people sheet), cap 80.
Tests: `emergency.test.ts`, plus cyclists and a four-lane road in `lanes/traffic.test.ts`. Notes:
- IDM with a 0.7 s headway (tiles are short), bends slowing cars from 1.5 tiles out.
- Lane changes are routed (a change edge costs 1.5, at most one per street, only with 2.6 tiles
  of room left); a waiting car signals and the car behind on the target lane lets it in.
- Services answer the town's own damage only: fire → fire engine + police, quake → ambulance +
  police, flood/heat → ambulance. In from the map edge, 30 s at the scene, home without lights.
  Cars pull in only on roads two cells wide or more; on narrow ones they wait at the junctions.
  No siren sound (no fitting audio hook).
- Bikes ride at 0.65 of car speed (0.8 looked too quick on tiles), 10% of trips.
- A car that has waited 8 s at a junction stops new cars on other curves from taking its zones,
  so a steady stream can't shut out a side road. Zones are held until a car is past where the
  two curves last come near, not just where they first do.
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

## Phase 4 — Crossings ✅
Done: `lanes/walk.ts` (routing), crossings in `lanes/graph.ts`, `mayCross` and the car's stop in
`town.ts`, the walk phase (`walkLeft`), paint in `roads/looks.ts` / `render/road-paint.ts`, the walk lamp
in `render/signals.ts`. Tests: `lanes/walkers.test.ts`. Notes:
- A crossing goes over the middle of a street's last cell at a junction of three ways or more (where the
  zebra paint already was), and along any street 4+ long — one per 8 cells. Along a street 8+ long on
  a fine street it is a zebra, with beacons; elsewhere plain.
- Cars wait behind a junction's crossings (`hold`), so the give-way and stop lines moved back with
  them (paint codes `a`–`h`), and a lane's arrow moved a cell back. A crossing at lights is marked with
  two broken lines.
- Lights get a 6 s all-red walk phase per cycle; walkers set off only with time to get over.
- Zebras: cars stop for anyone on one or waiting at its kerb; walkers wait only for a car too near to
  stop. Plain: a 2.5 s gap, or after 10 s, as on a zebra. Cars stop for anyone on any crossing.
- Walkers keep a small side offset so they aren't single file. Where the pavements don't join two
  places, a walker falls back to the old kerb line.
- Walkers route over the **pavement graph** (Dijkstra, cost by length, with a small
  penalty per crossing) and only cross on crossing links.
- **Zebras**: generated at junction mouths on streets of beauty level 2 and up
  (as now), and mid-block on long streets. A car yields when a person is on the
  zebra or about to step on. Walkers wait at the kerb for a gap in cars that
  can't stop in time.
- **Signal crossings** use the walk phase, with a walk/don't-walk lamp on the pole.
- Plain junction corners with no zebra or signal: the walker waits for a gap.

## Phase 5 — Parking & arrivals ✅
Done: bays in `lanes/graph.ts` (`baysOf`), `agents/parking.ts`, and in `town.ts` the parked cars'
step (`stepParked`), arrivals (`parkIn`, `toBay`, `fromBay`) and getting by them (`passParked`,
`mayPass`). Tests: `lanes/parking.test.ts`. Notes:
- Bays, two to a cell, wherever a building fronts the road, clear of ramps, crossings and 2 cells of a
  junction (3 on a one-cell street, so a queue at the junction never backs into them). On a one-cell
  street they go on the side with more frontage and stand in its lane, in fixed runs of at most 3
  cells with at least 2 cells between runs; on wider roads they are at the kerb, out of the lane.
- On a one-cell street a run is a **single-lane stretch**: the others get by out in the oncoming lane,
  past the whole run in one go, first in the queue only, when nothing coming is in the stretch or
  can't stop short of it and there is room to pull back in after it. Oncoming cars stop at the
  stretch's end while someone is out in it, or when a car behind the run has waited 8 s and nobody
  coming has waited that long (turns, so neither side starves).
- Arriving at a door: the nearest free bay within 5 tiles, held for it on the way; it pulls in along the
  kerb (or from alongside, the bay behind taken) and 1–3 people walk to the door. No bay free, or at
  the cap (1.5× the car cap): it drives to the door and is gone, as before. No circling or double
  parking. A car whose door spot has a parked car on it stops short and is gone there.
- Leaving from a door: if a car is parked near it, its people walk out to it first, then it pulls out
  when nothing is coming on its lane behind. Visitors stay 40–150 s, then go somewhere else.
- Residents' cars: 35% of the bays outside homes, by a hash of the bay (not the town's sequence). They
  drive off when someone leaves that door, and the bays fill with visitors.
- Wide roads: an emergency vehicle's traffic pulls in only where the kerb is clear; elsewhere it stops
  out in the lane and the emergency vehicle goes by it.
- Not done: painted bay markings, indicators (phase 8).
- Not saved; the parked cars are filed onto new lanes when the roads change.

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

## Phase 6 — Walker life ✅
Done: `agents/walker-life.ts` (`stepWalkers`, `stepDogs`), company set off in `town.ts` (`companyFor`),
poses and dogs in `people/figures.ts` and `dev/bake-people.ts`, dogs and leads in `town-render.ts`.
Tests: `agents/walker-life.test.ts`. Notes:
- Each walker keeps 0.03 right of its line; meeting someone, 0.05. A slower walker ahead in the way: out
  to the left past them if nobody is coming on that side, else behind at their pace. Not leaders with
  company beside them, nor dog walkers, nor on a crossing.
- Company (5% threes, 16% pairs, 7% a child): followers share the leader's line, abreast or in file when
  someone is coming; they mind the crossings themselves and the leader waits for them on the far kerb.
  A child is always abreast, hand in hand (`hold` pose; `HOLD_GAP_M` sets the gap so the hands meet).
- Joggers 6%, at 2.2× the pace (`run`, 8 frames). Dogs 8%: terrier, lab or dachshund, three coats each,
  trotting a little ahead on the left, sniffing every 5–14 s for 1.5–4 s with the walker stopped at the
  end of the lead; never on a crossing before their walker. The lead is a curve drawn hand to collar.
- Chats: two lone walkers meeting, 12% a pair, 4–12 s facing each other; a lone walker passing a shop
  door, 20%, stops at the window. Anyone stood still is drawn in the `stand` pose, swaying.
- Groups, joggers and dog walkers don't sit on benches. The sheet grew from 2 to about 3.2 pages.
- A car pulling out of a bay is held to 0.25 tiles/s until clear of the kerb (it had clipped the car in front).

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

## Phase 7 — Buses ✅
Done: stop sites in `lanes/graph.ts` (`stopsOf`), routes in `agents/bus-routes.ts`, buses and riders in
`agents/buses.ts` (hooked into `stepTown`), shelters in `render/bus-stops.ts` (a `shelter` prop).
Tests: `agents/buses.test.ts`. Notes:
- A stop every 7 cells on each kerb (the kerbs staggered), off crossings, ramps and side roads; the kerb a
  cell either side is kept clear of bays. Streets one cell wide have them too: the bus stands only a
  little in (0.08), so it is not "pulled in" and traffic waits behind it. Most towns' streets are 1 wide.
- Routes: one a 40 doors (from 15; at most 4), seeded on the stops with the most doors near them, ordered
  by lane-graph distance from whichever start calls at the most. A route loops if its last stop has a way
  back to the first; otherwise it is a line, in from the nearest gateway and out at one. With no gateway
  that reaches it, a bus starts stood at the first stop.
- Each route runs 1 bus (2 with 6+ stops), plus one in the shuttle livery under the Shuttle Bus card,
  which then takes no car trips. Route buses are full-size (`BUS_PICKS`); a bus keeps its id leg to leg.
- Trips of 12+ tiles with both ends within 6 tiles of one route's stops (the first before the last, on a
  line) go by bus 60% of the time: walk to the stop, queue facing the road, board one per 0.45 s while
  the bus waits (up to 9 s), and get off at their stop (or the stop before one the bus can't reach).
  Patience at a stop: 120 s.
- Traffic fixes found by the bus soaks: a car only goes out past parked cars if there's room to get back
  in counting those already out ahead; a run's zone grows to a long passer's nose while it's out, and an
  oncoming car within that reach blocks going out; a pass ends when the parked cars it was passing leave;
  junction conflict zones also come from car bodies touching (`findZones`), not just lane lines.

- **Auto routes**: a loop over the busiest door-dense streets (the longest cycle
  through the top-k streets by doors). There's one route a ~40 buildings, rebuilt when roads change.
- **Stops**: a baked shelter prop with a pole every ~6–8 tiles on the route, at
  the kerb, on the side traffic drives.
- Buses pull in at stops (indicate, stop, doors 3–5 s). Walkers whose trip is far
  walk to a stop, queue, board (vanish into the bus), ride, and alight at the stop
  nearest their destination. The shuttle bus card keeps its share as a route bus.

## Phase 8 — Lights & signals on the cars ✅
Done: lamp masks in the car bake (`raster.ts` `LAMPS`, `marks`), lit in `town-render.ts` by
`agents/lamps.ts` (`signalOf`, `lampsOf`, `braking`); night pools and glows in `render/car-glow.ts`.
Tests: `agents/lamps.test.ts`. Notes:
- Four white masks a frame — head, tail, right, left — of only what is seen at that heading, with a
  2-texel halo; the rear indicators are the tail lamps on that side. Packed apart from the paint and
  trim (an indicator's box runs the car's length): the sheet went from 4 pages to 4 and a bit.
- Drawn in normal blend over the trim, lit by alpha only (no draw-list rebuilds, no batch breaks).
- Indicators 1.5 Hz: 2.5 tiles before a turning junction lane or a lane change, pulling in to a bay or a
  stop (right), out of a bay or a stop (left), out past parked cars and back. Hazards: a bus stood at a
  stop in its lane. Brake: slowing faster than 0.35 tiles/s², or stood; held till 0.3 tiles/s.
- At night (`darkness`): head lamps on, tails dim; over the night sheet, a pool on the road ahead
  (1.7 tiles, additive) and glows at the head and tail lamps; cyclists' smaller.

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

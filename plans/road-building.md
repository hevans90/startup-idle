# Roads are built, not bought

A road in the game is no longer paid for in one sum and there the instant the
drag ends. Dragging a road ORDERS it: a works site along the line, a gang with
its plant, materials brought a lorry-load at a time and paid for as each is
sent, the road coming into being from one end to the other — and open to
traffic a length at a time. Like a project, but quick: seconds a tile, not
minutes a building.

Status: step 1 of 6 BUILT (the job and its clock, plain painting, cancel). Still paid in one sum at the order; the AI, the editor and headless runs lay road at once (`roadWorks` off).

## What exists to build on

- **Projects** (`world/projects/works.ts`, `structures/projects/`): a site is a
  structure with a `Build` record (`done/need`, `delivered/deliveries`, `cost`,
  `priority`). Loads are paid when sent (`spend`), work is capped by materials
  on site (`materialCap`), a site that cannot pay stalls, time away is caught
  up on load (`catchUpWorks`). Trucks are town movers with `job.role ===
  "truck"`, sent from the Garage or the map's rim (`depotFor`).
- **Roads today** (`state/world.store.ts` endStroke): `gradeRoad` works out
  heights and bridge decks; `roadCost(fresh)` is spent whole; `paved`, `height`,
  `deck`, `ramp` are written in one undoable command; the network, lane graph,
  looks and bridge art follow from the grid.
- **Art pipeline**: vehicles baked from models at 32 headings with pitch
  variants (`agents/cars/`, a `tipper` and a `flatbed` already there); people
  baked with a builder in hi-vis; props baked; roads painted in code per cell
  from a `Look`; bridge pieces already come in half-step segments.
- **Callers that lay road**: the player's stroke, `paveRoad` in
  `play/build-actions.ts` (used by `ai/planner.ts` and the pilot's town and
  harbour desks), fixtures, headless sims.

## The model

**A road job** — `Grid.roadJobs: RoadJob[]`, saved with the map:

    RoadJob = {
      id, by: "player" | "ai", orderedAt, updatedAt,
      path: cell[],                 // the stroke's cells, in order
      grade: { heights, decks, moved },   // gradeRoad's answer, kept
      stage fronts: dug, based, surfaced, lined   // tiles along the path, each ≤ the one before
      opened,                       // tiles already real road
      delivered, deliveries, cost, // as a project's Build
      paused,
    }

- **Ordering** runs `gradeRoad` exactly as now — every refusal there stays a
  refusal at order time — but against the PLANNED grid: the grid with every
  job still under way applied. So a second road can be ordered to join one not
  yet built, and two jobs can never contradict each other.
- **A cell under construction is not `paved`.** The network, the lane graph,
  traffic, parking, markings and every other reader of the grid see nothing
  until a length OPENS. No reader has to learn about half-built road.
- **The work moves along the path as four fronts**, each following the one
  ahead by a couple of tiles, so every trade is on screen at once:
  1. EARTHWORKS — the ground cut and filled to the grade (the ground really
     moves, cell by cell, as the front passes; water resyncs);
  2. SUB-BASE — stone tipped and levelled;
  3. SURFACING — the paver lays, the roller follows;
  4. LINES AND OPENING — lining, cones in, and the length becomes `paved`.
- **Opening is in lengths**, from the end that joins a road, a few tiles at a
  time and always at a whole junction or bend — never per tile: each opening
  is a road change (lane graph rebuild, network join), and must be rare.
- **Materials**: `deliveries = ceil(tiles / TILES_PER_LOAD)` per trade that
  needs them (stone, asphalt; steel and concrete for a bridge). Each load is
  paid when sent, `cost / deliveries`, through the same `spend`. A front
  cannot pass the materials on site. Cannot pay: the gang stands, the job is
  stalled, nothing is lost.
- **Speed** (first numbers, to be tuned in a balance test): about 1.5–2 s a
  tile on level ground with materials on hand, plus a few seconds for the gang
  to arrive; earthworks longer by how much ground moves. A 20-tile road in
  about 40 s; a project is minutes.
- **Time away** is caught up on load as a project's is: the job as far as the
  money allowed.
- **The editor** (`?world=1`, not playing), fixtures and unit tests that want a
  road now keep the instant path: one function, `layRoadNow`, which is today's
  code. Playing goes through jobs.

## Who does it

A CONTRACTOR'S GANG, not the company's employees: a road does not pull
developers off their desks. One gang a job; a small number of jobs worked at
once (3 to start), the rest queued in the order they were ordered and shown as
staked-out line. The gang is its plant plus four in hi-vis from the people
sheet.

- **Plant that works the site** — excavator, paver, roller, lining truck — is
  NOT traffic: the cells it stands on are not road yet. It is drawn by the
  works renderer along the job's path, moved by transform only (never
  reparented or re-sorted per frame: see the render-group memory).
- **Lorries that bring loads** ARE traffic: town movers on the open network,
  a new `job.role` (`"road-load"`), from the depot to the job's HEAD — the
  open road cell nearest the working front. They tip and go home.
- **A job not joined to any road** (the first road on an empty map): its loads
  come overland to its nearer end, slower. No lorry is drawn driving on grass.

## What it looks like

- **The line staked** the moment it is ordered: pegs and tape along the path,
  the cursor's ghost left standing. Cones and barriers where it meets an open
  road.
- **The ground in stages**, painted by the road painter itself so each stage
  meets the next and the finished road without a seam: stripped earth →
  stone → black, unlined, kerbs in → the finished cell. A `site` field on
  `Look`; few variants, so the texture atlas does not churn.
- **Plant, baked** through the vehicle pipeline (`bun run bake:cars`): an
  excavator (three or four arm poses), a paver, a tandem roller, a lining
  truck; the tipper and flatbed exist. Pitch variants, so they lean on a ramp
  as traffic does.
- **Props, baked**: cones, barriers, a peg line, heaps of stone and of
  asphalt that shrink as the front uses them.
- **Animation**: the excavator digs and slews, the tipper raises its body into
  the paver's hopper, the paver creeps with steam off the mat behind it, the
  roller runs back and forth, the crew rake and walk. Steam and dust reuse the
  existing particle path if there is one; otherwise two small sprites.
- **A bridge goes up as a bridge**: piers from the bed a segment at a time
  (the pieces already stack), deck launched tile by tile from each bank, the
  arches, trusses or towers after, surfacing last. `bridgePiecesOf` takes how
  far each part has got and leaves out what is not built yet.

## Money

- No sum at the drag. The readout while dragging shows what it WILL cost and
  roughly how long.
- Paid a load at a time. The total for a plain road should land where
  `roadCost` does today, so the economy does not move; `port-balance`-style
  test to hold it.
- Cancelling (Delete over a site, or undo of the order): the part not built is
  taken up, free; loads already paid are not refunded.

## What has to change with it

- **The AI and the pilot** (`ai/planner.ts`, `ai/pilot/desks/town.ts`,
  `harbour.ts`, `ai/wallet.ts`): `paveRoad` now orders. Their plans place
  buildings on roads they have just "laid", so: a building MAY be placed
  fronting a road still under construction (`touchesRoad` counts planned
  cells), and simply cannot be reached — its own site stalls — until the road
  opens. The wallet reserves a job's remaining cost rather than paying it.
- **Headless runs** (`simulation/*`, balance tests): step road works in
  `step-world` beside `stepWorks`.
- **Undo**: the order is one command (the job added). Ground moved by
  earthworks is the job's, restored on cancel only where no road was opened.
- **Saves**: `roadJobs` optional on read; a map without it has none.
- **Lifting a road** stays as it is — instant and free. Not part of this.

## Order of work

1. **The job and its clock** — `RoadJob`, the planned grid, ordering through
   the stroke when playing, fronts advancing on time alone, lengths opening,
   `layRoadNow` for the editor and tests. Stages painted plainly. Rules tested
   the way `laying-fuzz.test.ts` tests strokes: random orders over generated
   maps, every opened road sound, every job finishes or stalls.
2. **Materials and money** — loads, lorries as movers, stalls, catch-up,
   cancel and undo, the dragging readout, the balance test.
3. **Plant and animation** — models baked, gang, props, the fronts animated.
4. **Bridges in stages.**
5. **AI, pilot, sims** — reservations, placement beside planned roads, the
   long-run sims green.
6. **The job's card and stall notice**, last, with whatever words are agreed.

Each step leaves the game playable and the suite green.

## Risks

- **Tests that assume a road is there when the stroke returns** while
  playing: many. Step 1 gives them `layRoadNow` or a clock to run.
- **Road changes are dear** (lane graph, network, markings, bridge art all
  rebuild): hence opening in lengths, not tiles.
- **The ground moving over time** under water rules and other jobs: hence the
  planned grid, and earthworks applied in path order only.
- **Sprite churn**: plant moved by transform; site stages a handful of looks.
- **The AI stalling itself** on roads it is waiting for: step 5 exists for it.

## To be decided by you

1. **Gang or employees?** Planned: a contractor's gang (no one leaves a desk).
   The other way is a project's way — builders walk from home, a road far
   from housing is slow.
2. **How many jobs at once?** Planned: 3, the rest queued.
3. **Is a bridge dearer than road?** Today a bridge tile costs a road tile.
   Planned: leave the price alone in this work.
4. **Should lifting a road become a job too** (a planer, lorries taking it
   away)? Planned: no.
5. **Words on screen**: the dragging readout, a job's card, a stall notice.
   None is added without your say; step 6 brings a list.

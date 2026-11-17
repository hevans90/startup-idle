# Somebody is driving

Every vehicle on the map has somebody in it: a driver at the wheel, seen
through the glass — and the right sort of somebody. A builder in hi-vis in a
tipper, a paramedic in an ambulance, the commuter who will get out of the car
in the car. Nobody in the Machine's cabless lorries.

Status: BUILT, all six steps — more simply than planned below. The vehicle is
NOT baked in two parts: it is baked as it always was, glass opaque, and beside
it only what of it is NEARER THE CAMERA than a seat (`raster` `BakeOpts.over`),
glass among that at part strength. The sitter is drawn over the old picture and
that over them: no interiors to model, no second pass, and the dark glass
behind them is the inside of the car. Passengers are in; emergency crews do not
get out; a bus draws ten people at most. Files: `cars/models.ts` (`seats`),
`cars/crew.ts` (who), `cars/occupants.ts` (drawn), `people/cast.ts` (`whoOf`,
`riderId`: a car's people are who walk from it), `figures.ts` (officer, medic,
firefighter).

## What exists to build on

- **Vehicles** (`agents/cars/models.ts`, `raster.ts`, `car-sheet.ts`): 66
  models baked at 32 headings + 16 tilted frames into 15 pages, two layers a
  frame — PAINT (white, tinted in the game) and TRIM (the rest, and the
  shadow) — plus lamp masks. Drawn in `agents/town-render.ts` as a container
  of two sprites, sheared on slopes; plant by `render/plant-kit.ts`.
- **GLASS IS OPAQUE.** A window is a dark decal on a solid hull. There is no
  transparency in the rasteriser, no interior behind the glass, and no notion
  of an occupant or a seat. This is the whole difficulty.
- A few models are open already: the convertible (seats, an interior), the
  roller and the paver (a seat under a canopy).
- **People** (`agents/people/`): 14 figures baked at 16 headings in five
  tinted layers (skin, bottom, top, hair, trim), and EVERY FIGURE HAS A `sit`
  POSE. One uniformed figure, the builder (hi-vis, hard hat). No police,
  paramedic or firefighter.
- **Who is who**: a mover has a stable `id`; `fleet.ts modelFor` picks its
  vehicle from its kind, colour, `siren` and a hash; `cast.ts figureFor` picks
  a person's figure, `outfitOf` their colours. Points given in a model's own
  metres are already placed on a drawn car (the beacons, in `town-render`).

## The approach: people from the people sheet, put in at draw time

Two ways to do it. The plan is the second.

1. *Bake the driver into each vehicle.* Every frame of every model carries
   its occupant. A variety of drivers means variants of every model, or three
   more tinted layers a frame: the car sheet at least doubles (15 pages → 30+),
   and a driver cannot be the person who then gets out.
2. **Draw a seated person from the people sheet inside the vehicle.** The
   vehicle is baked in two parts — what is BEHIND its occupants and what is IN
   FRONT of them — and the person's `sit` sprites go between. Variety is free
   (any figure, any outfit); the driver IS the mover's own person; a new
   uniform is one new figure, not a re-bake of the fleet.

So a drawn vehicle becomes, back to front:

    paint-under, trim-under      the vehicle with its glass OPEN: far side, floor, seats, dash
    the driver (and passengers)  `sit` pose at the vehicle's heading, at their seats
    paint-over, trim-over        whatever of the vehicle is nearer the camera than they are:
                                 near door and pillars, the roof's edge — and the GLASS, as a tint

## What has to be made

**Seats on every model.** `Model.seats: { l, y, z, role }[]`, metres, the
driver's first. Set once in the builders (`car()`, `lorry()`, the buses, the
plant), not per model. Right-hand drive: the markings are British. A test:
every model has a driver's seat, inside its cabin, under its roof.

**Interiors.** What shows through open glass: a dark tub, a dash, a seat back
at each seat — a few slabs added by the same builders. Cheap; unseen detail
is not modelled.

**The rasteriser: glass you can see through.** Two passes a frame.
- UNDER: the model with every glass sample discarded (a decal is tested per
  sample already), so the interior and the far side show.
- OVER: the occupants' own volumes — a head and a torso at each seat — drawn
  to depth only; then the model, keeping just the pixels nearer than that
  depth. Glass among them at part alpha (a tint and a sky glint), the rest
  solid. Where nobody could be seen the over layers are empty and crop to
  nothing.
- Sheet format: two more layers a frame, most of them small. Expect the car
  sheet to grow by a third to a half (15 pages → about 20–22). To be measured
  on the first bake, and LOD pages considered if it is worse.

**The runtime.** `car-sheet` loads the over layers; `town-render` and
`plant-kit` draw occupants between. One function, `crewFor(m)`, says who is in
a vehicle and where — pure, tested:

| Vehicle | Driver |
|---|---|
| A car, taxi's fare aside | THE MOVER'S OWN PERSON: the figure and outfit that walks to it and gets out of it |
| Taxi | a driver of its own (hash of id); its fare in the back when it carries one |
| Vans, pickups, flatbeds, tippers, box lorries; road loads; site lorries | a builder: hi-vis, hard hat |
| All road and site plant — digger, roller, paver, rig, mixer | a builder |
| Police | an officer (new figure) — two up when on a call |
| Ambulance | a paramedic (new figure), one beside |
| Fire engine | firefighters (new figure), a crew |
| Postal van | a postie (casual, the livery's red) |
| Bus, coach, minibus | a driver; passengers by how full it is, at the windows |
| Limo | a chauffeur (suit), the investor unseen behind dark glass |
| The Machine's lorries | NOBODY. That is the point of them. |

**New figures**: officer, paramedic, firefighter — in `figures.ts`, baked with
the rest (the people sheet is 4 pages; three figures add little). Whether they
also walk about at an incident is step 5's question.

## Order of work

1. **One car, end to end.** Seats and an interior on `car()`; the two-pass
   bake; the saloon drawn with its mover's own person at the wheel, at every
   heading and on a slope. Sheet growth measured. This step proves or kills
   the approach — everything after is breadth.
2. **Every road vehicle.** Lorries, vans, buses, the limo; `crewFor` and its
   table; passengers in cars by hash.
3. **Uniforms.** The three new figures; emergency vehicles crewed.
4. **Plant.** Road gang's and sites' machines, through `plant-kit`; the
   excavator's house slews with its driver in it.
5. **Continuity.** Nobody is in a parked car. The driver gets out as the
   person the town already draws walking away, and is not drawn twice.
6. **Cost.** Occupants only above a zoom at which a head is more than a pixel
   or two; a budget test on `?fixture=bigtown`.

## Risks

- **Sheet size and bake time.** The bake is already five minutes for 66
  models. Two more layers and a second pass could take it to ten. Mitigation:
  over layers only where a seat is; bake changed models only.
- **Sprite count.** A car is two sprites today; with a driver it is nine
  (four of the car, five of the person). Hundreds of cars in a big town.
  Hence step 6, and a person's five layers could be pre-composed for
  occupants if it comes to it.
- **16 headings of people in 32 of cars.** The driver snaps to the nearer
  heading; behind glass and a door it should not show. To be looked at in
  step 1, and `sit` baked at 32 if it does.
- **Render-group rebuilds.** Occupants are added to a car's own container
  once, never reparented or toggled per frame (the standing rule).
- **Pitch.** The car's shear is on its container; the person inside it is
  sheared with it, which is right.

## To be decided by you

1. **This approach or baked-in drivers?** Planned: people from the people
   sheet, as above.
2. **Passengers?** Planned: yes in cars (some, by hash) and buses (by how
   full); step 2. Drivers only is a smaller job.
3. **How dark is glass?** Planned: clear enough to know a builder from a
   suit at normal zoom; the limo's stays dark.
4. **Right-hand drive.** Planned: yes.
5. **The Machine's lorries empty.** Planned: yes.
6. **Do emergency crews get out and walk** at an incident? Planned: not in
   this work — they are crewed, and that is all.

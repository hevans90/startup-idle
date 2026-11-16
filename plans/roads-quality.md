# Roads: highways, hills and a quality pass

Status: **built** (2026-11-16), but for worn line edges (section 3), left out. Follows `plans/procedural-roads.md`; the sheet it kept as a fallback is gone, so every road is painted (`roads/looks.ts` decides, `render/road-paint.ts` paints).

## Rebuilt, 2026-11-16: markings from the lanes

The per-cell decisions for wide roads (the `ln`/`hw`/`hs`/`bd` codes, jog and bend cases, each written again in the painter) are gone. `roads/marks.ts` works every lane marking of a road two cells wide or more out from the lane graph — a line between two lanes, the middle between the two directions, an edge beyond the outside lane, a line where a lane waits, an arrow for the turns its connectors make, a roundel set to its heading — and hands each cell its shapes. Paint cannot disagree with traffic, and nothing in it knows of jogs, bends or the hand of the road. One-cell streets keep their own per-cell markings. The street/junction split was tightened with it (`roads/streets.ts`): a broad uniform strip is a road, a street is one width, a partly-joined end and a step of two cells are junctions; a roundabout only on a square crossing. Tested by rules that hold on any map (`marks.test.ts`), over scripted layouts and 400 random ones.

## What is wrong now

- **A road dragged up a hill often ends up in two pieces, and nothing says so.**
  - A half-step difference cannot carry a road. The rule dates from the sheet, which had no half-ramp tile; the painter has no such limit.
  - A cliff taller than one step is paved top and bottom and joined by nothing. The tool accepts the stroke and takes the money.
  - The cursor shows the same green over all of it.
- **A wide road is a narrow one with more dashes.** Three or four cells wide, it has a dashed centre line and nothing between the two directions; no edge lines, no shoulder, no sense of where to leave it.
- **The markings are thin on variety.** No bus-stop cages, no speed roundels, no hatching, no studs; wear is one of four stamps.

## 1. The road tool on hills — `roads/grade.ts`

The stroke grades its own ground. Along the path the tool works out the heights the road needs so that each cell is at most one step (two half steps) from the next, cutting into the hill and filling below it by equal measure, and writes those heights in the same command as the paving. Undo takes the road and the earthworks back together.

- **Half-step ramps are allowed** (`PAVED_RAMP_RISES = [1, 2]`).
- **Held where they are:** both ends of the stroke, cells already paved, cells under water, a bridge, a building, a main or a sewer. A cell beside a road already laid alongside takes that road's height, so the lanes of a wide road climb together.
- **No single-cell dips**, which a ramp cannot serve (a cell tilts one way): the dip is filled level with its lower neighbour.
- **When it cannot be done** — the held cells are too far apart in height for the run between them — the cells in between are refused: the cursor shows them red, the click lays nothing and the notice says how many more tiles the climb needs.
- **The cursor shows the road as it will lie:** drawn at the graded heights, so a cutting or an embankment is seen before the click.
- The pilot lays roads through the same action and gets the same grading.

Tests: profiles over a cliff, a valley, a ridge, mixed pins; the refusal and its count; a second lane beside a graded one matches it; ramps derived from a graded stroke join the network end to end.

## 2. Highways

Lanes stay where the lane graph has them (`laneOffset`), so traffic needs no change.

- **A highway is two cells wide or more** (two lanes or more each way).
- **Central reservation** between the directions: a double solid line on a two-cell road; from three cells a raised median with a steel barrier, reflectors along it, ended before each junction by a rounded nose and a hatched taper.
- **Edge lines**, solid, along the shoulder; **studs** along the lane lines close up.
- **No parking bays on a four-cell road or wider**: its strip is a hard shoulder.
- **Lane arrows** in every lane at intervals along a long run, and before a junction.
- **Exits:** where a side road meets a highway, the edge line carries across its mouth as the short broad dashes of an exit, and the lane beside it is marked with a turn arrow a cell before.

## 3. Markings and wear, across the board

- **Bus-stop cages**: the broken yellow box and BUS STOP at every stop the lanes have.
- **Speed roundels** where a street leaves a junction: 20 on one-cell streets, 30 on two-cell roads, 40 on wider.
- **Wear**: more stamps that follow the road's run (a trench across it made good, tar along its seams, a strip relaid down a lane), chosen from more variants.
- Not built: worn edges on the lines close up.

## Order

1. Grading and the cursor (the UX fault). 2. Highways. 3. Markings and wear. Each a commit on main with tests, checked on the isolated server in a new `?fixture=hills` (roads over terraces) and `?fixture=traffic`.

## Not in this pass

Grade-separated junctions and slip roads as geometry (a highway still meets side roads at grade); roads over water (bridges are still the map's); a price for earthworks.

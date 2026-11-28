# Farms and flood walls

Both are late-game buildings, unlocked by a new landmark each. Each gets a proper popover, a placement preview, and a mechanic that gives a reason to build it.

## Where they stand

**Farms**
- Free from the start on smooth ground.
- Fields within 3 tiles, claimed once when the farm is placed and never again. Fire or clearing loses them for good.
- One harvest a year: 2 s of income per field, a 1.6 s float split evenly across every farm.
- No label, no popover, no reach preview, no effect on homes.
- Seasons off in Settings means no pay at all, and nothing says so.

**Flood walls**
- Free on any river map.
- The drag line is 8-connected but the water solver flows 4 ways, so diagonal steps leak.
- Walls can go in the river and dam it.
- No flood-risk data, no flood line, no label, no total price for a dragged row. Nothing shows which homes a wall protects.
- Homes near water gain desirability (waterView +5), so the risk is never felt until a flood hits.
- The event's "levee" choice leaves homes unshielded, and its hint is marked done after a single wall anywhere.

## 1. Unlocks: two new landmarks

Use the processor pattern: each landmark's project grants the feature, builds the first one for free, and opens the rest to buy. The flood event keeps its rush-levee choice as an emergency answer.

**Farms are late game only.**
- There is no farm anywhere before the Agritech Lab: the build bar's Land section, the debug dock's entry and placement itself all check the grant.
- Farms already standing in old saves keep working, but no more can be built until the lab is.
- The gate sits after the Conference Centre at 300 staff, so it comes about where the IPO does.

| Landmark | Gate | Grants | Builds |
|---|---|---|---|
| **Agritech Lab** (glasshouse campus, 3×3) | staff 300, after Conference Centre | `farms` | its first farm beside it, fields claimed |
| **Climate Lab** (flood-gauge tower on the bank, 2×2, river maps only) | staff 275, after Conference Centre | `floodwalls` | a starter wall across the worst stretch of bank, the lowest run the flood line crosses |

- Both get a `ProjectDef` with `grants`, a `LANDMARKS` entry, a look in `looks.ts`, a landmark-panel card and an `opensText` line.
- A small bonus each, in the house style:
  - Agritech Lab: farm pay ×1.25.
  - Climate Lab: repairs ×1.5 faster.
- On non-river maps the Climate Lab is not offered, like the Harbour without a coast.

## 2. Farm mechanics

1. **Four harvests a year, one each season.** Each parcel's crop already comes from a hash, and the shader cuts it at its own time. Make that hash gameplay: one shared function, used by both the CPU and the shader, that gives each crop its season.
   - Spring: hay, mown about Spring 20.
   - Summer: rape, then wheat and barley, cut about Summer 21.
   - Autumn: maize and roots, a new parcel type, ploughed out.
   - Winter: brassicas, the autumn-sown parcels that already stay green, cut about Winter 15.

   Each harvest pays only the fields whose crop it is: 1 s of income per field per harvest. A farm's year then earns about 4 s per field instead of 2, so a typical farm (about 30 fields) pays back in about 45 minutes. The shader's cut times move to match.
2. **Pay goes to the farm that earned it.** Each farm's float shows its own fields' pay and lasts longer, about 3 s. Offline catch-up still pays in one lump, but a lump is one float per farm, not a stack.
3. **Seasons off.** The farm keeps its own clock: one harvest each quarter of the year-length, so turning seasons off never silently stops pay.
4. **Fields come back.** `claimFields` runs again at each harvest, so burnt, cleared or newly freed ground nearby becomes field again. A farm claims only cells no other farm holds, so farms placed side by side don't double up.
5. **Price step.** Each farm costs ×1.2 the one before, like processors. This stops the field-spam meta now that farms pay four times a year.
6. **Fresh food: a morale lift for nearby homes.** A home with 6 or more fields within 4 tiles gets a new mood part, `farmFresh` +4, in both `moodsOf` and `desireAt`. It shows in the morale panel and on the desirability heat map, so placing a farm raises the land around it.
7. **The road rule stays.** Fix the comment, not the rule: carts need a lane.
8. **Drone Farming: a Machine-tree upgrade.** A new notable in `machine.ts`, ring 3, in gap 0 (the free ring-3 slot beside Freight). It costs like the other notables, and Air Gap turns it off like every on-map notable.
   - Effect line: `Farms tended by drone · harvests +50% · fields feed training`.
   - Mechanics:
     - each harvest pays ×1.5;
     - farm reach grows from 3 to 4 tiles;
     - burnt or flooded fields replant as soon as the ground is clear, instead of waiting for the next harvest.
   - **Visuals.** Every farm grows a drone pad on its yard, drawn in the farm look. Drones in the AI's violet, drawn by the same ai-layer code as the build drones (`buildDronesOn` gets a farm list):
     - In spring, 2 drones per farm fly low passes up and down the parcels, spraying, with a faint mist trail.
     - At each harvest they sweep the parcels in rows. The shader's cut moment for each parcel is offset along the same sweep line, so the crop goes to stubble right under the drone, not everywhere at once.
     - Each pass ends with a drone carrying a crate back to the barn. The harvest float rises from the barn when the last crate lands.
     - The farm's popover gains a drone line.

## 3. What farms make

The harvest money stays. Each farm also makes one of three products, each tied to a system that already exists.

**Oat milk (every farm): coffee that works harder.**
- **Every field makes one unit** of oat milk at each of its harvests. It goes into the farm's silo, which holds up to 60 units. Past that, the harvest is sold for its usual pay and nothing more.
- **Each unit is one delivery.** The farm sends a unit to the café or kombucha bar with the least stock in road reach, and stops sending when every café is full.
  - One van carries one unit and stocks that café by one.
  - At most 3 vans per farm are on the road at once; the rest wait in the silo.
- **A café's stock.** A café holds up to 3 units, a season's worth, and uses one every game month (30 days, 15 min of play).
  - While it has any stock it serves oat flat whites. `CAFE_BOOST` for the workplaces it reaches goes from +10% to +15%, and `CAFE_REACH` from 3 to 4.
  - The workplace label reads `Oat flat whites · +15%`.
  - At 0 it falls back to plain coffee.
  - `deskPerks` checks the café's stock.
- **Scale.** Each field harvests once a year, in its crop's season, so a typical farm (30 fields) makes about 30 units a year, 7 or 8 each season. A café uses 4 a year, so one farm keeps about 7 cafés stocked. About 4 fields keep a bar going, and each field is a month of flat whites.
- **Visual:** a small oat-milk van, cream with a green leaf livery, for each delivery. It drives the existing traffic from the farm to the café and parks a moment at the door.
- **Hovering the farm opens its popover**, without a click. It shows:
  - `Oat milk · 42 in the silo`;
  - cafés stocked (`5 stocked · 1 low`);
  - vans out.

  Hovering a café shows `Oat milk · 2 months left`.

**Ground-truth data (with Drone Farming): fields as a dataset.**
- Each drone harvest pass banks ground truth at the farm: one unit per field scanned.
- While banked ground truth lasts, training runs at the Data Centre go faster and land harder, like a busy Training Data Plant:
  - speed +25% at full stock;
  - jump +10%;
  - each run spends 40 units.
- The bank is capped at 3 runs' worth, so farms reward steady drone work, not hoarding.
- **Visual:** a scanning pass on top of the harvest sweep. Each drone casts a thin violet scan line on the crop below it. Labelled parcels flash a faint grid for a beat, then fade.
- A small uplink dish on the drone pad pulses when data is sent.
- The Data Centre panel's training line gets a `Ground truth` chip with the stock. The farm popover gets `Ground truth · 120`.
- `machine.ts` effect line: `Farms tended by drone · harvests +50% · fields feed training`.

**Slop compost (any farm with a sewer): slop grows something at last.**
- A farm with a sewer joined to its yard takes slop like a processor, up to `PROCESS_RATE`. It is a fourth kind beside the refinery, data plant and content farm, opened by the Agritech Lab's grant rather than a project of its own.
- Its use (slop in over the most it takes) raises harvest pay by up to +50%, and oat milk too: at full use each field makes 1.5 units a harvest, with fractions carried over.
- A full tank upstream drains to farms as well as processors.
- **Visual:**
  - a steaming compost heap in the farm yard that grows and shrinks with use;
  - in spring, a muck-spreader tractor works the fields, leaving a darker brown wash that greens up richer than unfed fields;
  - fed fields are drawn a deeper green all season.
- Farm popover: `Compost · 80%`. The sewer readout lists it among the processors.

## 4. Farm UX

- **Placement preview.** While the farm hovers, tint the reach box and the cells it would claim.
  - Readout: `Farm · $X · 34 fields`.
  - Hovering also shows a pale lift tint on homes that would gain Fresh food.
- **Hover label and dot.** `infoFor` gets a farm branch: `Farm · 34 fields`.
- **Hover popover.** Hovering the farm opens an anchored `InfoPop`, the same one landmarks use, and a click pins it. One short line each:
  - fields, with lost ones in a tooltip (flooded, built over);
  - next harvest (`Summer 21`) and which crop;
  - last harvest `+$X`;
  - homes lifted;
  - a Delete button.
- **Build bar.** The tile note reads `fields around it`. The section is hidden until the Agritech Lab is built.
- **Season chip.** Its tooltip names the next harvest date. No new on-screen text.

## 5. Flood wall mechanics

1. **A flood line.** Compute a static extent map, `floodReach`: flood-fill 4 ways from the river across every cell whose ground is below the river surface + `floodPeak`, blocked by walls and other solid columns. It is cached and remade when a wall is placed or deleted, or when terrain changes. The same map feeds the overlay, desirability, the rush levee and the Climate Lab's starter wall.
2. **Flood risk in desirability.** A home inside `floodReach` gets `floodRisk` −8 in `moodsOf` and `desireAt`. This is a new `WHY` entry: "Floods here". A home outside it, including one behind a wall, has no penalty. `waterView` stays, so a walled riverfront is the best land on the map, which is the point of building walls. Existing towns will see the penalty appear; that is intended, and the Climate Lab answers it.
3. **No leaks.** The drag line becomes 4-connected: diagonals step as a staircase. A row is priced and placed as a whole when money allows; otherwise it is placed up to what money allows, as it is now.
4. **No dams.** Walls refuse river tiles ("In the river"). The rush levee already skips water.
5. **Joined walls.** Each wall tile draws a connected run, a continuous concrete wall with corners, instead of separate blocks.
6. **Event fixes.**
   - The "levee" choice raises walls along the flood line's whole wet edge, not just within 14 tiles of the head; the cap rises with map size.
   - It shields every home the line then excludes.
   - `unavailable` reads "Nothing floods" when no cell overtops, and "Walled already" only when walls are why.
   - The flood-walls hint is marked done when no home sits in `floodReach`, not after one wall.

## 6. Flood wall UX

- **Flood line while placing.** With the wall tool open:
  - every cell in `floodReach` gets a blue wash, its edge drawn as a line;
  - as the row is dragged, the wash recomputes live against the ghost walls, so cells the row would save clear in real time;
  - at-risk homes get a small mark.
- **Placement readout.** `Flood wall · 12 · $X · 23 homes safe`. The count is the homes the ghost row would take out of the line.
- **Hover label.** `Flood wall · run of 18`.
- **Click popover.**
  - Highlights the whole connected run and the homes it keeps dry.
  - Lines: run length, homes protected, wall height against the flood peak.
  - Delete removes this tile or the whole run.
- **Flood overlay toggle.** The flood line also shows during a flood warning, so the warning's "Show me" points at the line, not only the head.

## 7. Order of work

1. Landmarks, feature gates, and the build-bar sections hidden until built (tests: gates, a placement refused before the grant).
2. `floodReach` with 4-way lines, the river-tile refusal and joined walls (tests: a wall keeps a house out of `floodedNow` on a river fixture, a diagonal row holds, a reach map that agrees with the sim's flooded set).
3. Flood risk in mood and desirability, the event fixes and the hint (tests: mood parts, the levee choice shields).
4. The flood-line overlay, readout and wall popover.
5. Crop seasons shared by CPU and shader, four harvests, per-farm pay, re-claiming, the price step and the seasons-off clock (tests: four pays a year, per-farm shares, fields regrow after fire, `harvestPay`, `buildCost` step).
6. Fresh food mood, the farm preview, label and popover.
7. Oat milk: units per field, the silo, deliveries to the lowest-stocked café, café stock and use, the +15% perk, vans, and the hover popovers (tests: units per harvest, the silo cap, delivery order, stock running out, the boost and reach).
8. Slop compost: the farm as a processor kind, the pay and supply boosts, the heap, the spreader and the fed-field tint (tests: slop taken, use scaling pay).
9. Drone Farming: the notable, its mechanics (tests: ×1.5 pay, reach 4, replanting, off under Air Gap), the drone pad, the drone flights and the shader's sweep-line cut.
10. Ground-truth data: the bank, training speed and jump, the scan visuals and the Data Centre chip (tests: banking per pass, the cap, a run spending it).
11. Balance-sim pass (farm payback, flood stakes) and the README line.

Fixtures: `?fixture=farms` gets the Agritech Lab built. A new `?fixture=flood` has a river town, a half-built wall and a debug trigger for the flood event.

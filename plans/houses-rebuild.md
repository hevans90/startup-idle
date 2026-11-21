# Employee plots and their houses: a rebuild

Status (2026-11-21): phases 1–4 built. Lots are put down whole, the scaffold is gone, shopfronts and murals stand on each kit's own wall (taken from the models, `House.hx`/`hy`/`ground`, not the bake). The twelve kits are remodelled (asked: "all of it"): to a street's scale (2–6 floors, the 10x tower 8; walls 4.2–5.0 m from the plot's middle), walls painted in their stuff a sample at a time (brick bond, render and rustication, ashlar, boards; tiles and slates), windows with reveals, bars and what is behind them, no hedges or paving of their own, the vibe t0's baked awning gone. Render cost level (+0.03–0.07 ms on `?fixture=shops`, none on `bigtown`). A shop ground floor is baked into each kit (`shopGround`, four per kit: either face, the door at either end): the house's own windows and door come off that face and the front goes on — pilasters, riser, glazing, door, cornice — its paint a third layer tinted the trade's (`shopPaint`); `shopfronts.ts` draws only the trade's over it (fascia and name, display, awning, blade, pavement). The sheet is 4 pages, not 2. Render cost unchanged.

## What is there now

- **A lot** (`kit:<kind>.t0`, 1×1) is placed in the game as a contractor's site (`projects/contracts.ts` `LOT`: 12 s, a gang of 2, `carried`). `tiles-renderer` `drawLot(s, ctx, done)` draws it part-built: earth scraped, stakes one at a time, tape, a trench with its pipe, the trench filled, capped pipe ends, then the sign. It has no beds until `s.build` is gone (`game/housing.ts` `housingCapacity`, `residentsIn`). Added in 4ecfc669.
- **A house** is a stack of baked parts: a ground floor, a mid floor for each storey it has filled (`floorsFor`: floors ∝ residents / slots), and a roof. There are 12 kits (`houses/models.ts`: interns', vibe coders', 10x devs'; t0–t2 and a landmark), modelled in metres, baked by the cars' rasteriser (`dev/bake-houses.ts` → `derived/houses_*.png`, `houses.json`). The walls are white and tinted per building in the game. They replaced the vendor tile stacks in 57877d4c / 85a2707f.
- **A scaffold** (`tiles-renderer` `drawScaffold`): yellow poles (`POLE 0xc7a24a`), boards, and blue netting (`NET 0x3f86c8`) drawn as lines and quads round a house for 16 s (`SCAFFOLD_FOR`) whenever it "grew".
- **A shopfront** (`render/shopfronts.ts`): drawn by the project pen into a Graphics per band, over the house's sprites, on the house's front tile. The wall is assumed at `WALL = 0.87` of the tile on both faces ("a block 97 px across a 132 px tile": the old vendor sprite). Heights are fixed: the fascia at 1.62–1.98 half steps and the awning at 1.36–1.6.

## Why each complaint happens

### 1. The plot's build animation
It is the `LOT` contract. Every lot is a site: two builders walk on, and `drawLot` redraws 24 times as `done` climbs. Nothing else depends on it, beyond `contractFor`'s `isLot` and the `done` parameter.

### 2. The blue/yellow wireframes: the scaffold, set off by the cutaway
`tilesRenderer.update` treats a house as **grown** when `floorsFor(def, s) > handle.floors`. The cutaway (`world-scene` `cutOne`, 98033bff) collapses every house standing in front of the pointer to one storey (`setCollapsed` → `floorsFor` returns 1), then raises it 350 ms after it is out of the way, through the same `update`. Raised from 1 floor to its full height, the house counts as grown, so it gets 16 s of scaffold. During play, every move of the pointer across a street scaffolds the houses behind the pointer, which is why it is "all the time". Real growth (a resident in, or a tier up) also scaffolds, but far less often.

(The cutaway's own outline is near-white, `CUT_OUTLINE 0xe8eef4`, so it is not this. The build tool's and AI mode's holograms are cyan `HOLO_OK` and amber `HOLO_SAVING`, which is close, but they only show for a placement or the AI's plan.)

### 3. The shopfronts don't fit
The kits' walls are not where `WALL` says, and their ground floors are not as tall as the front.

| Kit | Street (+y) wall, tile | Side (+x) wall, tile | Ground floor, half steps | Front's top (fascia+cornice) |
|---|---|---|---|---|
| intern.t0 | 0.74 | 0.80 | 1.28 | 2.05 |
| intern.t1 | 0.76 | 0.84 | 1.28 | 2.05 |
| intern.t2 | 0.82 | 0.88 | 1.41 | 2.05 |
| vibe t0–t2 | 0.77–0.82 | 0.81–0.87 | 1.50–1.68 | 2.05 |
| 10x t0–landmark | 0.81–0.86 | 0.82–0.86 | 1.85–2.29 | 2.05 |

(A metre is 0.09 tiles and 0.441 half steps, `cars/models` `TILES_PER_M`, `HALF_STEPS_PER_M`. A wall in tile terms is 0.5 + h·0.09.)

So on the lit face, the usual shop face, the front stands 0.4–1.4 m out from the wall as a kiosk on the pavement (seen on the 10x tower in `?fixture=shops`). Its fascia rides above a cottage's eaves and under a tower's first-floor line. The fronts also run across hedges and plot paving baked into some ground floors (intern.t0/t1 hedges, t2's paved plot). Nothing tells the shopfront what kit it is on: it has only the tile.

### 4. The houses themselves
From the shots (`?fixture=shops`, a summer day):
- **Scale.** The 10x t1/t2 kits are 6–8-floor glass shafts on a 1×1 plot, towering over two-lane streets. The vibe t2 and intern t2 are boxes of the same footprint.
- **Flat.** One tint per wall, no material of its own (no brick coursing, no render texture), and repeated identical windows. Ground floors read the same as upper floors. Roof detail is thin.
- **The plot.** The plot paving and hedges in the ground-floor frame fight the street's pavement and props, and a shopfront.
- **Growth by stacking.** Mid floors are the same frame lifted a storey, so a half-filled tower is a stump with a roof on it.

## The rebuild

### Phase 1: lots are lots (small)
- Drop the `LOT` contract: `contractFor` no longer matches `*.t0`, so a lot is placed finished and can take residents at once. A save with a lot mid-servicing loads with its `build` cleared.
- `drawLot` loses `done`, and the `site|…` key in `tiles-renderer`. The finished lot (scraped ground, stakes, tape, sign) stays as it is.
- Tests: a placed lot has beds at once; an old save's half-serviced lot loads as a lot.

### Phase 2: no scaffold (small)
- Delete `drawScaffold`, `SCAFFOLD_FOR`, `strike`, and the `grew` logic in `update`/`redraw`.
- Even so, make the cutaway's raise not count as a change of the house: keep the rebuild, but nothing keyed on "grew" may run off it. This is cheap insurance for anything added later.
- Tests: collapse and raise a house through `setCollapsed` + `update`, and nothing but its sprites is drawn.

### Phase 3: the bake says where its walls are (prerequisite for 4 and 5)
- `HouseFrames` gains a box per kit: `hx`, `hy`, `ground`, `storey`, and the shop's wall span on each face. `bake-houses` writes it from the model, and the game reads it with the sheet.
- `shopfronts.ts` `faceOf` takes the wall plane and span from that box, not `WALL`, and scales its heights to the kit's ground floor: fascia under the first-floor line, awning under the fascia.
- With that alone the current fronts fit the current kits. It can ship before the houses are redone.

### Phase 4: new houses (the bulk; art direction needed first)
Remodel the 12 kits in `houses/models.ts` with the same parts system and bake:
- **Proportions per district**, kept to a street scale: interns' terraces and walk-ups (2–4 floors), vibe coders' rendered mid-rise with set-backs (2–5), 10x devs' stone-and-glass mid-rise (4–8), with a podium so a tall one sits on a street-scale base. The landmarks are the only true towers.
- **Materials baked into the walls**, not one flat tint: brick bond and mortar, render with banding, stone courses and glazing mullions; tinting stays per building.
- **A ground floor that reads as one**: taller, a plinth, the door and windows different from the floors above.
- **Mids that vary** (two or three per kit, as now, but with real differences: balconies, bays, set-backs), and a top floor as well as a roof, so a half-filled house still finishes properly.
- **No plot dressing in the frame**: hedges, paths and paving come off the model. The street props and the planted-tree system dress the plot, so nothing fights the pavement or a shop.
- **A shop ground floor per kit** (`shop` part): the shopfront's frame baked into the model (pilasters, fascia board, glazed front, recessed door) on the street face. The game draws only the trade's part over it: the awning's colour, the lettering, the blade sign, the display, the moving parts. It fits by construction. The trade's colours become a tinted layer the way the walls are.
- Snow layers and the demolition massing (`collapse-sim`, "a house a box a tile fitted to its picture") read the new box from phase 3, not their own guess.

### Phase 5: check it
- `?fixture=shops` and `?fixture=streets`: every trade on every kit, both faces, day and night, summer and snow, from headless Chrome. Plus a street of each district growing from lot to landmark.
- Tests: the box in the sheet matches the model; every shop front's wall plane equals its kit's; no shop part outside its ground floor's height.
- Perf: the same sprite count a house as now (one more part for a shop). Bench the busy-town fixture before and after.

## Open questions

| Question | Options |
|---|---|
| What is worst about the houses now? | Scale (towers on 1×1), flat look, style mismatch with the landmarks or roads, or all of it |
| Shops: baked into the kit, or drawn to fit? | Baked shop ground floor + a drawn trade overlay (recommended); or keep them drawn, fitted by the phase 3 box |
| House growth cue, now the scaffold is going | None (recommended; nothing unrequested); or something else if wanted |
| Order | Phases 1–3 first (the bugs, small), then 4 once the look is agreed |

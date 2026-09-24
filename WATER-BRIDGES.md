# Bridges: a fresh read of the multi-storey water, and why it is hard to fix

Written against `5eb816e` plus the uncommitted `depth > 0` diff. Everything below was read in source and the load-bearing claims re-checked by hand at the lines given. Nothing was run in a browser.

## The short version

The model is right. A column as a stack of gaps, two slots connected exactly when their intervals overlap, a fall exactly when `dropAt` says so: that is the correct abstraction and the four hand-written rules it replaced were correctly diagnosed as classifications. The CPU solver implements it consistently and its tests pin the cases that matter.

What is broken is not the model. It is that **the picture is assembled from four sources that are not the same water**:

1. the device's depth, which is what the shader draws;
2. the host's copy of the depth, which is a band or a sparse list three to five frames behind and, on sparse frames, thirty readbacks behind;
3. the sheet ids, computed on the host from source 2 every frame and uploaded as a texture that the shader reads against source 1;
4. the sheets, drawn by the host on any bridged map from source 2, because the device's sheet pass is still one storey and is gated off.

And foam, the thing the eye reads as "is this seam right", is a single plane read from slot 0 on both paths, and on the device reads the wrong accumulator region altogether.

Every one of your three symptoms lands on those seams, and every probe written so far compares source 2 against source 3, which agree with each other by construction and cannot see the disagreement with source 1. That is why it has felt like chasing something that moves.

## The causes, ranked by how much of the symptom they explain

### 1. Sheet membership is decided on stale data and read against fresh data

`findBodies` runs on the host every frame from `columns` (`water-gpu.ts:1775-1783`), the host mirror. On the device path that mirror is refreshed by the depth band only on non-sparse frames, and the sparse path is taken whenever there are wanted cells (`solver.ts:973`), so during any activity the mirror is up to `CARRY_EVERY = 30` readbacks old (`state.ts:660`). The ids go up as the `uBody` texture; the vertex shader's `cornerOf` groups contributors by `sheetAt` (`corner-rule.ts:509-516`) while reading the device's depth texture.

At a front moving onto or off a deck, exactly the case you are chasing, columns are wet on the device and `NO_BODY` on the host, or the reverse. The GPU has no skip for `NO_BODY` (the CPU does, `water.ts:882`): it draws them as pseudo-sheet `-1`, and `cornerOf(-1)` gathers every other unlabelled column at that corner (`water-gpu.ts:643-650`). What that looks like on screen is a column at the wrong height, colour, and alpha, flickering as the label catches up. It also means the "bare" reference frames in `__watchDeckPixels` and `__liveWaterPixels` still contain the deck water, drawn as sheet `-1`, because zeroing the host depths does not touch the device texture when `carried` is on (`water-gpu.ts:1801`). The instrument's baseline is wrong on the path it measures.

`d4abb01` measured this and read it the other way: "the picture follows the host copy" is true because the labels come from the host copy, not because the depth does.

### 2. Foam is one plane, slot 0, and the device reads the wrong region

- Foam and wash textures are `nx × ny`, one plane (`water-gpu.ts:1297-1299`). Both the host step (`foam.ts:147,162`) and the device pass (`foam-gpu.ts:117,124`) test `depth`, `broke`, and the flow of **slot 0** only. Deck water inherits the river's foam and is zeroed where the channel under it is dry. Breaking on the deck never makes foam. The sheet's foam comes from the column too (`falls-render.ts:371-374`).
- On the device, `foam-gpu.ts:43` has `accAt2(region, i) = region * (nx*ny) + i` where every other pass uses `region * (nx*ny*slots())` (`gpu/falls.ts:82`, `landings.ts:56`). With two storeys, foam reads `3*cells + i`, which is slot 1's impulse, not the splash at `6*cells + i`. A sheet off a deck plunging into the river marks no foam at all on the device path.

This is "seamlessly showing proper foam" in full: it cannot be right with the data shaped like this.

### 3. On a bridged map the sheets are the host's, and the surface is the device's

`gpu/sheet.ts:214-216` still decodes a fall edge as `i = kk / 2` against `nx*ny`, so it is gated off on storeyed maps (`world-scene.tsx:1544, 1613-1617`) and `drawFalls` runs on the host. Its nappe thickness comes from host `c.depth` (`falls-render.ts:186-187`), which is carry-stale, while the surface it must meet is device-fresh. The join at the lip that took a week to get right on flat maps is broken again on every bridge by construction, and `falls-render.test.ts:837` pins it only on the CPU path.

Also: falls form only on +x and +y outflow (`columns.ts:1999`, `gpu/divergence.ts:60-62`). Water leaving a deck westward or northward goes straight into the neighbour's slot 0 with no air, no sheet, no plunge, no splash. Those sides are behind the deck from the camera, so the missing sheet is mostly hidden, but the water arrives instantly and the foam and splash it should make never happen.

### 4. There are now four "is this column water" rules and the diff only aligned three

The uncommitted diff moves `showsWater`, sheet membership, and `cornerOf`/`cornerValues` to `depth > 0`. It leaves at `dryDepth`: GPU `cornerExtras` (`water-gpu.ts:432`, GLSL `:846`), which is where a corner's alpha depth comes from; GPU `nearby` (`:467`); the GLSL surface entry (`:1004`); and the side-face gates. A column with `0 < d ≤ dryDepth` now contributes to a corner's height but not its alpha; if no other contributor of that sheet at the corner is over `dryDepth`, alpha is zero. That is the "hole with extra steps" the diff's own comments describe, produced by the diff, on the GPU only. The CPU sums `vd` for any `d > 0`, so the reference and the shipping path diverge further. No test compares the surface shader's skeleton, so nothing catches it.

### 5. Device slot-indexing bugs that `?gpucheck` cannot see

Each of these treats a slot index as a column, or forgets the storey factor, and none is in a pass `?gpucheck` runs (it covers diffuse through landings, not cliffs, arrive, foam, fallout, or sheet):

- `gpu/falls.ts:102-105` `bankLanding` widens the box with `to % nx`, `to / nx` on a slot index: a landing into slot 1 pushes `y1` past `ny`. The CPU uses the column.
- `gpu/falls.ts:180-182` posts the crown spawn's cell as `to`, a slot index; `drainSpawns` decodes it as a column (`:407-410`), so drops from a plunge onto a deck spawn off the map.
- `gpu/arrive.ts:44,52` maps arrivals with `i / (nx*ny)` to a pair plane and drops indices at or past `2*cells`: a drop's crater flux landing on a deck never reaches the device.
- `solver.ts:1227` builds the drip want-list from slot 0 only, so `slotUnder` on the host decides landings against deck depth that is thirty readbacks old.
- The compare scenes: `spanned` has no parapets, and `crossingPoured` at 96 columns fails `canCopyOut`, so the device path it exercises is the slow one.

### 6. The two mesh builders disagree at every deck edge

- GPU `sidePart` and the gather read the neighbour's **same storey** (`water-gpu.ts:516-535`, `quad-rule.ts:58-60`); the CPU `sideFace` reads the neighbour's **slot 0** (`water.ts:1029-1051`). At a deck-to-road seam the GPU hangs a full-alpha pane and the CPU draws nothing.
- GPU `aside` always reads storey 0's ground (`corner-rule.ts:502-506`); CPU reads the contributor's storey (`water.ts:495`). On the GPU every deck corner sees the riverbed and gets no waterline feather; on the CPU it feathers like a shore.
- `atBrink` reads the neighbour's surface uncapped (`corner-rule.ts:265-328`); the solver's `besideAt` caps at the roof (`falls.ts:431-432`).

So "compare with the CPU renderer" is not a control on bridged maps. It is a different picture.

### 7. Model edges worth knowing, none fatal

- `parapetAt` raises a column if **any** of its four neighbours is a non-deck tile off-level, so the corner column at each deck end presents a two-step sill to the road on one column per side (`field.ts:393-412`). Water crosses on the other three.
- On generated maps `HEADROOM = 4` and the parapet adds 2, so a river at bank height gives a drop of about 6: over `FALL_MIN`, under `BREAK`, and one substep of river rise from the drown branch. The CPU/GPU knife edge recorded in `058f7ea` (3.98 against 4.01) lives here; a fall that drowns and respawns every few frames is a flicker.
- `growStoreys` copies ground, depth, and material but not `air`, `fx`, `fy`, or drips (`field.ts:426-441`): laying the first deck deletes water in flight.
- `drainAt` never passes a slot (`field.ts:620-634`): draining a bridge tile drains the channel under it.
- The kerb is a raised solid column with no art, so deck water sits one column inside the bridge's edge with a side face against the kerb.

## Why it has been so hard to diagnose

Two solvers, two mesh builders, a host mirror in the middle that is authoritative for edits and stale for drawing, and a per-frame classification computed from the stale side and consumed by the fresh side. Every probe so far reads the mirror. `__deckBodies` and `__watchDeckHoles` compare host depth to host ids. `__pavingCheck` uploads host depths, never gathers (`water-compare.ts:387-391`), and so tests a path the game does not run. `__watchDeckPixels` baselines against a frame that still contains the thing it is measuring. Each of these gave a true number about the wrong thing, and each led to a fix in the wrong layer: the brink gate, then its removal, then the `dryDepth` cutoffs.

## What to do, in order

**First, the instrument that has been missing.** Read back the device's depth texture plane 1 and the `uBody` texture for the span's box, and count, per frame: columns with device depth over zero and body `-1`; columns with body set and device depth zero; and the same against the host mirror. That one number tells you whether cause 1 is what you are looking at, and it is the only instrument that can. Make `bare` zero the device plane, not the host array.

**Then the structural fix for cause 1: group corners locally, and delete `bodies.ts`.** The grouping rule is an edge predicate, `connected` and no fall, between neighbouring slots. A corner has at most `4 × layers` contributors and four edges between its columns. The shader and the CPU builder can each partition those contributors by that predicate on the spot, from depth, ground, and roof, all of which the device has fresh. The result is a pure function of the corner's inputs, so every column asking the corner gets the same partition and the tear-free property survives. No union-find, no texture, no staleness, no fourth source of truth. Same-column slots are never joined, exactly as now.

**Then foam per slot.** Give foam and wash a plane per storey like depth, birth from each slot's own `broke` and splash, and fix `accAt2`. The sheet reads the foam of the slot it left.

**Then make the device draw the sheets on bridged maps.** Storey-aware decode in `gpu/sheet.ts` is the same change `falls-render.ts:334-338` already made on the host. Until then, put depth in the lip row so the host sheets at least meet the device surface.

**Then one predicate.** A single `wet(d)` used by `showsWater`, membership, `cornerOf`, `cornerExtras`, `nearby`, both surface entries, and the side gates, and the surface shader under the skeleton test alongside the corner rule.

**Then the device slot bugs** in cause 5, with `?gpucheck` extended to cliffs, arrive, foam, and fallout, a compare scene with parapets, and one that passes `canCopyOut`.

**Then make the CPU builder match the GPU per storey** (side-face neighbour, `aside`, `atBrink` roof cap), so it is a control again.

Falls in all four directions and `drainAt` per slot are worth doing after that; neither is why the deck looks wrong today.

## What not to do

Do not keep moving thresholds. The holes are not at a threshold; they are where two sources of truth disagree, and a threshold change moves the disagreement rather than closing it. The `depth > 0` diff should either be completed on the GPU alpha path and the GLSL entry, or reverted, before anything else is measured, because as it stands it produces a GPU-only hole the CPU cannot reproduce.

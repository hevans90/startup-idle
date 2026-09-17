# Water: the plan after the port

Written against `5971b55`. Supersedes the "then" items in `WATER-NEXT.md`, which stays as the measurement log. Every claim below was checked in source at the line given; nothing is remembered from an earlier survey.

**Struck-through items are done**, each with its commit. Where working the item showed the description was wrong, the correction is in the struck line rather than deleted — two of the first four were wrong about the symptom while being right that something was broken, which is worth knowing about the rest of the page. `447 tests` above is the water subset this page's check command names; the whole suite is 1060.

## Where it stands

The port is done and it worked. On the `waterfall` fixture the frame is vsync-locked at 8.3 ms where it was 22 to 24; the solver's compute is ~0.3 ms of GPU; the render is ~4 ms and is now mostly the fixed cost of 127 draws; the host spends ~0.6 ms. The two solvers conserve to 1e-7, agree to rounding with the wind off, and the remaining divergence has been traced to two named mechanisms rather than waved at as chaos. 447 tests pass.

What is left is not performance. It is a small set of correctness faults at the seams the port created, most of them about order and staleness; nine of the ten integration bugs from the first assessment, untouched; a single-source rule that broke in the sheet pass; no device-loss handling; no automated coverage of anything on the device; and comments that have drifted from the code in a codebase that leans on its comments.

## P0: seams of the port, each verified, each small

| # | Fault | Where | Fix | Check |
|---|---|---|---|---|
| 1 | ~~`sync` scatters into `field.columns` before the check that the solver was built for that field~~ **DONE `80b9c28`.** Both halves of the symptom were wrong: it does not land old rows, it throws (`TypedArray.set` bounds-checks), and a resize cannot reach it — the scene teardown nulls `blRef` first and the tick's water block is gated on it, so six resize trials found nothing. The stated check would have passed unfixed. Reordered anyway, and the invariant now lives in the solver as `bringDown`: threw on call 1 before, 475 calls clean after |
| 2 | ~~Handover to the host draws a dry map~~ **DONE `5093e1e`.** Exactly as described. `most` moved to the layer. Identity 327,680 quads against compacted 125,472; unfixed the handover stuck at 125,472, fixed one draw restores it. `__waterBench` never calls `gatherQuads`, which is why it hid. Won't-fix paragraph deleted |
| 3 | ~~The sheet pass is never destroyed~~ **DONE `57fd6ec`.** Released in `destroy`, before the fall layer it copies into. Live `createBuffer` handles over ten rebuilds: flat at 16 with the fix, 16→56 without — four a rebuild, 4.68 MB, nearly all `sheet quads` |
| 4 | ~~The throw-smoothing guard assumes a column's two cliff edges are adjacent in the index~~ **DONE `e5730ab`.** As described — `claim(k)` and `claim(k+1)` are separate atomics. Moved to the cliffs pass; once a frame on `frameDt` instead of once a substep on `dt`, which composes to the same filter. `?gpucheck` identical row for row, falls green at 732; spray scene unchanged within noise (0.0708 against a baseline 0.0749) |
| 5 | ~~Crater flux is re-added to the host's `fx` on every scatter~~ **DONE `fd426e2`.** Exactly as described, and quantified: 359 flux arrivals re-applied over 400 steps, EVERY ONE onto a stale base and not one onto a fresh one, 272.9 of flux the host already held. Applied only where the base was refreshed. The stated check does not work — a jump at a carried frame is expected, since between carries the host's `fx` is frozen; the adds have to be separated by whether their base was fresh |
| 6 | ~~`lipCap` is recomputed only when lip rows come back~~ **DONE `91be5cc`.** Moved out of the branch. NOT demonstrated as a visible fault and unlikely to be one: the ceiling carries a 2x margin and a 1024 floor, so reaching it needs an edit that more than doubles a map's lip count in one go — 732 to over 1464 on the waterfall. One line, removes the class rather than a sighting |
| 7 | ~~No `device.lost` handling, no `uncapturederror` listener~~ **DONE `a9306c6`.** Both subscribed; on a loss the toggle goes off and the host solver takes the field. THE CHECK CANNOT PASS AS WRITTEN: Pixi holds the same device, so a real loss takes the canvas with it and the map is black whatever the water does. Forced with `device.destroy()` — error logged, toggle flipped, solver destroyed, water still stepping on the host (154560 to 149173, 60480 wet), meshes back to 327,680 quads, screen empty. What it buys is a consistent state and a message, not a picture. The swallowed `mapAsync` rejections are deliberate and stay |
| 8 | ~~The falls pass dispatches `nx*ny*2` threads per substep under a header that says one per cliff edge~~ **COMMENT FIXED, DISPATCH KEPT, `14c9703`.** Measured over 1500 frames: the pass costs 0.019 ms a frame against 0.102 for `diffuse`, 4.28 for the render, on a frame vsync-locked at 8.3. `lipCap` would save ~0.012 ms. And the two passes are not alike — under-dispatching `fallout` loses readback rows, under-dispatching THIS loses physics, and `lipCap` is the last count the host heard, which lags this frame's by three to five. Exact sizing wants an indirect dispatch off the device's own count, for a gain that does not register |

## P1: the integration bugs still open from the first assessment

None of these are on the device; all are reachable in normal play.

- ~~**Structure place and demolish never sync the solver's ground**, and redo never does.~~ **DONE `c0ed91d`.** All three omissions were real. WIDER than stated, though: `build` drops a cell whose before equals its after, so on flat ground a placement's levelling patch disappears and the command carries `structureAt` alone — building beside water never moved the bed either, not only demolishing. Four tests; each fix reverted in turn fails at least one.
- ~~**The substep loop drops leftover time on both solvers**~~ **DONE `7c43600`.** Clamped where time ENTERS the tick rather than scaled at each use, so `dt` means one thing downstream. A backgrounded tab is the case: rAF throttles to ~1 fps against a 0.2 s ceiling, and five seconds of wall clock left 80 of water where the same second of flow holds 16. Device arrears bounded to the same ceiling. The `hMax` paragraph was wrong and is fixed. Three tests.
- ~~**`spillOrphaned` hardcodes the stride**~~ **DONE `81ad073`.** `columnOf` now, and `gpu/meta.ts` imports the constant. **THE SPREAD HALF OF THIS IS WRONG**: pipe volume and a single column's DEPTH are the same unit — `totalVolume` adds `waterInPipes` straight onto `totalWater` — so spreading `pourAt`-style makes sixteen times the water. Implemented as written, the conservation test fails.
- ~~**The drop oscillator has no timestep guard**~~ **DONE `9e4ad9a`.** ω·dt clamped at 1.5 — and not only for stability: past pi there is no oscillation left to sample. Measured, a fleck at DROP/500 ran at ω·dt 12.9 and grew 167x a step to NaN by frame forty. The renderer's clamp is NaN-safe now too (`min`/`max` both pass NaN). Flooring the VOLUME would have been wrong — `crown` distributes the spray exactly, so it would create water.
- ~~**Foam marks a fall's landing at the column across the edge**~~ **DONE (deleted, not moved) `1e5fb35`.** Every one of 240 live edges landed 4–8 columns from its cliff foot, six most often — a tile or two. But `plungeInto` already marks a splash at the landing column and foam already reads it: all 240 landing columns marked at 0.895 against a LANDING of 0.9, not one cliff foot marked. Two terms, same white, one misplaced. Both twins.
- ~~**Undo of a drain does not restore water**~~ **DOCS FIXED `3bfbbd5`.** Confirmed both ways: pour 26.9→122.9, undo leaves 122.9; drain 218.9→122.9, undo leaves 122.9. Docs now say no water edit is undoable. Left as behaviour deliberately — undoing a pour a second later means taking water from a pool it has spread into, so every version is an approximation. **A product call, if you want it.**
- ~~**`poolSnapshot` caps at 255 silently**~~ **DOCUMENTED `3bfbbd5`.** And it is REACHABLE: terrain clamps to [-126, 126], so a basin at the floor beside a wall at the ceiling is 252 deep and anything over that brim goes past. Widening means a file-format version bump.
- ~~**`FALL_THROW` equals `MAX_FLOW_SPEED`**~~ **DERIVED `1b4812b`.** Never bound, since `throwOf` only ever sees pre-clamped flow. Kept rather than deleted so the rule — a lip throws no faster than the water flows — holds by construction.
- ~~**`frontSpeed` freezes**~~ **CONFIRMED, COMMENT FIXED, NOT RESEEDED `1b4812b`.** Over 200 steps `frontSpeed` and `head` took ONE value each; `shed` and `air` took 200. Milder than stated — the hash mixes `k`, so 240 edges give 240 points, just fixed ones. And `since` is no good either: it resets to 0 every step a fall is fed. Seeding on `shed` WORKS and was put back — the hash turns one bit into a different number, so a water-tracking seed makes spray a chaos amplifier, and `compare.test`'s one-ULP case then reads as `different` instead of `drifting`. Wants a shed counter or frame index; neither path has one.

## P2: the solvers' divergence, one level from the bottom

~~One hypothesis worth thirty minutes before the per-edge dump~~ **TESTED AND DISCONFIRMED, `58803ae`.** fround on `hi`/`hj`/`head`/`carry` took 125 cells to 89, not near zero; f32 emulated through the whole accelerate gave 96, moving away. Calibrating the statistic with zero-mean noise on `head` (no f32 at all) gave 231 / 161 / 47 cells at 6e-9 / 6e-8 / 6e-7 — **below ~1e-6 the count has no relationship to the amplitude, and the unperturbed 125 sits inside that band.** `beyondMilli` measures how hard the host has been jostled, not how close it is to the device, so both fround rows are inside the noise. That closes the question without convicting f32. The `minHead` threshold stands as the mechanism. Do not run another experiment of the form "make the host more like the device and count the cells".

The original reasoning, kept because it is still the best account of WHY the heads differ: **it is not the wind term, it is that wind is the only thing that makes deep water move.**

With the wind off, every flux in deep water is exactly zero on both sides, so no arithmetic in the accelerate pass is exercised. With the wind on, the head across an edge is a difference of two surfaces of about ten half steps that differ by about a hundredth. In f32 that subtraction keeps roughly three significant digits; the host does it in f64 and keeps sixteen. Flooding the map makes it worse, which is what this predicts and the dry-front theory did not. Test: in the host accelerate, wrap `hi`, `hj`, `head`, and `carry` in `Math.fround` and rerun `scene()` with default wind; if the 125 cells fall to near zero the cause is f32 cancellation and there is nothing to fix on the device. If it wants fixing anyway, form the head as `(d_i − d_j) + (g_i − g_j)` so the exact integer ground difference is not added before the subtraction.

The spray half is order: the device hands out the frame's drops by atomic claim, the host in lip order. `drainSpawns` already sorts spawns by edge for the drip list; the budget draw itself is not sorted. Either sort the budget draw the same way or accept it and say so in the harness, which today reports the drip count and cannot fail on it.

~~The harness itself: `ok` in `compareFrames` is volume and mean depth only.~~ **DONE `58803ae`.** `worstDepth` and `air` are both in the verdict. The thresholds came out of the sweep rather than the log: across seven clean runs from 30 to 300 frames the air agreed EXACTLY at every length, the only number on the page that does not drift, so it is tight (1e-3); the worst cell drifts with run length (1.6e-4 at 30 frames to 1.3e-2 at 300) so it is loose (0.02) and the table is written into the source. Sabotaged with a 6e-3 nudge the verdict fails on the air arm ALONE — worst reads 0.019 against 0.02, the mean is 16x inside its own, and the old verdict passed that run.

## ~~P3: the single-source rule, and the comments~~ DONE

**`sheetRuleSource()` `bba8662`.** The sheet's WGSL is printed from `nappe.ts` now. The rounding divergence was real and is fixed with `floor(x + 0.5)` — measured on the device, WGSL `round` ties to EVEN and `Math.round` ties up, and they disagree on 0.5, 2.5, 4.5 and -1.5. It is REACHABLE: `throwOf` clamps a negative flow to zero, so a lip with no throw on an axis gives a band coordinate of exactly x.5 and the piece is filed in a different band on the two paths. The waterfall fixture does not reach it — 5760 pieces, no exact half, because every live lip there has throw on both axes.

**Bigger than stated:** the opacity ramp's two ends were literals in FIVE shader sites, not one. Named `SOLID_FLOOR`/`SOLID_RANGE` and interpolated everywhere.

**The comments `4257417`.** All checked against the code rather than taken from the list. "Six passes" is SEVEN, in five files. Three of those also claimed the device could not drive the water and that what was missing was "the FRAME, not the physics" — it drives it and the toggle is the default. `water-gpu` called itself a prototype with `water.ts` as the one that ships; the reverse. `solver.ts` said THE HOST STAYS AUTHORITATIVE; the device owns the water. `state.ts` said the reduce buffer was six numbers and then seven; it is thirteen. `perf.ts`, `compute-spike` and the README all said the GPU's own time cannot be read "because the device is Pixi's" — `render/device` makes it and `__gpuTime` reads it. README: ten passes is fifteen, 22-24 ms is the frame before the port.

## ~~P4: tests for what needs no device~~ DONE

**`938b5b3`.** Three files, 35 tests. `gather.test` covers `roomFor` (exported for it), `canCopyOut`, `quadCap`, `reduceSeed`/`readReduce` — all of which fail silently when wrong. `shader-sources.test` builds all 21 WGSL sources and both dialects of the rules, and gives `quad-rule` the skeleton test its sibling already had. `substepsFor` and `syncGround` were covered under P1 and P0.

**The reserved-word list is now MEASURED, and the note this project carried was wrong.** Asked of the device one word at a time under a validation scope: `from`, `move`, `enum`, `typedef`, `do` are rejected; **`to`, `mat` and `f16` are not.** `to` has been recorded as reserved here since the sheet pass was written, and `arrive` has always declared a `mat`.

**And it found a landmine I had just planted.** Deriving `FALL_THROW` from `MAX_FLOW_SPEED` (P1.8) reads a `const` at module scope across the `columns`/`falls` import cycle, which throws for any entry point loading `columns` first. The suite passed on load-order luck; one new test file broke it. Written out again, relationship pinned by a test.

## P5: cost and shape — three done, one disproved, two open

- ~~The staging holds two full-size field buffers plus a host mirror, ~58 MB, to carry back 0.3 MB.~~ **DONE.** The runs were copied to their OWN offsets so the host could index the copy like the field; packed contiguously instead, with the copy recording where each landed. **13,730,816 bytes each to 3,801,088**, against a measured worst readback of 404,480 floats. The residual is the `!fallList` tail, which only a dev toggle reaches. The second slot is not dead — `readback` alternates — but only one is ever busy, so it is cheap slack now.
- ~~Depth still comes back as a band, 254 KB of a 263 KB readback.~~ **DONE `514e61a`.** The readers name the cells they want and the device answers those; the whole band still arrives on the carry frames, so the save and the handover see a field that is stale rather than frozen. **271 KB a frame to 18.5 KB median.**

  The trap, which took three tries: **the cell a drop is IN is not the cell it READS.** `stepDrips` reads the surface at `Math.round(cx), Math.round(cy)`, so a drop at 10.49 reads cell 10 this frame and 11 the next on a drift of a hundredth. Against a band baseline of 0.07078 for the spray scene's worst cell — the drop's own cell gave 0.103, adding one and four frames of predicted travel gave 0.100, and the five-cell cross gave 0.07078. Covering where ROUNDING can send it, not where velocity will.
- ~~Map-shape cliffs fail silently into the slow path; log once.~~ **DONE.** Both say which number would have to change. On 30×30 tiles: the six textures refused at 120 columns, and no quad gathering because a band holds 2400 quads. Silent on 64×64.
- `clearBuffer` on `acc` per substep and the full quads buffers per frame are unbounded by the box. **OPEN, and probably not worth it** — see the item below: the whole compute is 0.1 ms of host time a frame.
- ~~The render's fixed term is the 127 draws with per-band shaders and uniform groups.~~ **NOT SUPPORTED BY MEASUREMENT. Do not do this on the strength of the sentence above.** The test is dose-response: pin the visible band count and see whether the render follows. Across 0, 32, 64, 96 and 127 bands — with 122,317 instances and 60,434 wet columns actually there — **neither instrument moves.** GPU render stamp: 14.58, 14.50, 14.22 ms for 0/64/127. CPU time inside `renderer.render`: 0.43, 0.50, 0.39, 0.48, 0.38 ms for 0/32/64/96/127. Two independent instruments, no trend, noise either side.

  A caveat that has to travel with it: **whole-frame numbers are unusable while the Browser pane is hidden.** The bench reports a 4.38 ms frame of which 0.62 is accounted for (solve 0.10, build 0.00, submit 0.52) and 3.76 ms is untimed gap — the tab being descheduled between iterations, not work. The DIFFERENTIAL is still sound, because both arms suffer it equally.

  What would settle it: the same dose-response with the pane visible. If it is still flat, the 127 draws cost less than the noise floor and the item should be struck.
- ~~`PER_TILE = 4` as a literal in `meta.ts`, `matpack.ts`, `pipe-flow.ts`.~~ **DONE, and `matpack` was never an instance of it** — its `n * 4` is four bytes to a u32 texel, a different four. What it did have is a silently dropped tail, now asserted.

## P6: decisions, answered

All three are measured rather than argued. Both live ones come out NO, and the numbers are here so they do not get re-opened on the strength of the original sentence.

- **`COLUMNS_PER_TILE` — NO at the size that ships, and it is not a performance lever at all.** Tried it. Matched runs on the `waterfall` fixture, 64 tiles square:

  | | stride 4 | stride 2 |
  |---|---|---|
  | columns | 256² = 65,536 | 128² = 16,384 |
  | device buffers | 33.8 MB | 16.1 MB |
  | **readback median** | **18.0 KB** | **72.9 KB** |
  | cliff edges | 732 | 366 |
  | material copy-out | yes | **refused** |

  The readback goes UP fourfold, and the reason is structural: a byte texture's copy row must be a multiple of 256 bytes, so the material texture needs 256 columns. At stride 2 a 64-tile map has 128, the copy is refused, and the host has to upload the material every frame AND take it back in every readback — 65 KB of it. The diagnostic added in P5 says so out loud the moment it happens.

  Stride 2 only clears that bar at 128 tiles and up, where it gives 256 columns — which is what a 64-tile map already has at stride 4. **So the stride is a resolution-against-extent trade, not a cost lever:** at equal column count it costs the same, and at equal map size it halves the surface resolution and the lip count. The finer grid is what stops a lake reading as a row of flat plates, so halving it is a real loss for nothing.

  Ten tests fail at stride 2 and nine of them encode the stride as a constant — the culvert's expected volume is `taps * 8 * 16 * 20`, where the 16 is `COLUMNS_PER_TILE²`, and it returned 640.0002 against a correct 640. Water is conserved exactly. The tenth is P4's own `canCopyOut` case, which is the real finding above.

- **The bed at column resolution — the stated benefit is worth nothing; decide it on simplicity alone.** `COURANT` is 0.4 because the bed is a staircase, and a column-resolution bed is stable near 1/√2. But the Courant condition is not what binds: with gravity 2.25 and a cell of 0.25, `stableStep` is `min(maxDt, 0.0667/√h)`, so **`maxDt` dominates until the water is deeper than 16 half steps.** Substeps for a sixtieth of a second:

  | deepest | 1–16 | 24 | 40 |
  |---|---|---|---|
  | COURANT 0.4 | 1 | 2 | 2 |
  | COURANT 0.65 | 1 | 1 | 1 |

  The fixture's deepest is 11. So raising the Courant number changes nothing at playable depths, and the whole solver compute is 0.08 ms of host time a frame in any case. What the change would actually buy is removing the split-level corner machinery — a SIMPLIFICATION — and the plan already notes that is larger now the corner rule is generated into two shaders. Worth doing if the machinery is in the way; not worth doing for the margin.

- ~~**The host path.**~~ Settled and closed. `5093e1e` made the switch honest; nothing else on it is worth time.

## Order

1. ~~P0 items 1 to 8~~ — all done.
2. ~~P1, top to bottom~~ — **all done.** Three of the nine were partly wrong about the fix, and one was right about the fault and wrong that it was worth fixing. See each line.
3. ~~P3 and P4~~ — done.
4. ~~P5~~ — three done, the render item disproved, one left (bounding the `acc` clears) that the measurements say is not worth it.
5. ~~P6~~ — answered. Both live decisions come out no, with the numbers above.

## How to check

`bun test src/fluid src/world/water src/world/render` stays green throughout. `?gpucheck` after anything under `src/fluid/gpu`. `window.__frameCompare(120, true)` on both scenes after P0.4, P0.5, and P2, with the widened `ok`. `window.__gpuTime()` and `__showWater(false)` after P0.8 and P5. For P0.1 to P0.3 and P0.7, the manual steps in the table; each is a minute. The pane must be visible for every timing.

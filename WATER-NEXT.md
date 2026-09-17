# Water: what to optimise next

Measured on the `waterfall` fixture, 64 tiles of map and 256² of column, fully
flooded, GPU path, settled, pane visible. The frame is **8.3 ms and 120 fps**;
the previous survey's was 22 to 24 ms. What that frame is made of:

```
js 0.63   solve 0.43   build 0.20   present 0.93   frame 7.97   125 fps
gpu 4.31  of which render 3.98
```

The frame is VSYNC-LOCKED at 8.33ms, so nothing below will raise the frame
rate on this machine; what it buys is headroom, which is what slower hardware
and bigger maps spend.

Every compute pass the solver runs, added together, is **0.30 ms**:

```
render 4.666 | wash .066 | foam .066 | diffuse .046 | falls .036 | cliffs .020
limit .016 | landings .016 | accelerate .010 | apply .010 | arrive .007
matpack .007 | divergence .003 | spill 0 | fallout 0 | meta 0        (total 4.968)
```

So the arithmetic is free and has been for a while, and ninety-four per cent of
the GPU is the render pass. The host side is now small enough that nothing on
it is worth chasing: `build` is 0.27ms for every mesh on the map.

(The pass table above was taken before the sheets moved to the device; there is
a `sheet` pass in it now, and the compute total is still well under half a
millisecond. The render split below predates it too — the sheets were in the
1.28ms "without water" half then and still are now, drawn by the device rather
than built by the host, so the split itself is unchanged.)

## Done: the surface drew twice what it gathered

Split the render by hiding the water: **4.90 ms with it, 1.28 ms without**, so
the surface is 3.62 ms and everything else on screen — terrain, falls, drips,
structures — is 1.28 ms. It is vertex-bound: quartering the backing store
(1472×1536 to 736×768) moved the render from **4.896 to 4.833 ms**, 1.3%.

THE SIDE FACES ARE A RED HERRING, and this page used to say otherwise. Read the
gather's own list back and every quad in it is part 0 — the surface top. Zero
sides, zero forward faces:

```
gathered   60,600 quads      all part 0      wet columns 60,610
toggling the `faces` overlay changes the instance count by nothing at all
```

So the compaction is not NEAR the one-quad-per-wet-column floor, it is AT it,
and there is no look-versus-speed decision to make: on a flooded map the sides
are already collapsed and already dropped.

WHAT WAS LEFT WAS THE PADDING, and it is done. 60,600 quads were gathered and
**108,576 drawn** — 44% of the surface's vertex load was headroom, because the
count is a frame stale and `roomFor` was `n + (n >> 2) + 256`. The flat term
alone was 127 × 256 = 32,512 quads a frame.

Measured, over 25,400 band-frames, what a band actually grows by between one
gathering and the next:

```
steady    worst growth in a band in a frame   18 quads,  3.2%   (none over 32)
a pour    six big pours onto dry ground       72 quads, 33.9%
```

So the constant was sized for the click and paid on every frame. The pad is now
what each band has LATELY grown by — a running maximum that leaks down a quad a
frame — plus a floor of 24, which is above what the still map ever wants.

```
drawn     108,576 -> 73,963 for the same 60,600 gathered
render    4.63ms -> 3.98ms          gpu 4.92 -> 4.31
short     steady: never.  six pours: 58 band-frames of 38,100, by at most 36
```

THE FIXED COST NOW DOMINATES. The first survey split the render into about 3ms
of having 127 draws at all and the rest proportional to the quad count; cutting
a third of the vertices bought 0.65ms, which says the proportional half is now
the smaller one. Fewer, bigger draws is the next thing that would move it —
which is a real change to how the bands are built, not a constant to tune.

## Done: the sheets are built on the device

`drawFalls` was 0.765ms of a 1.13ms `build`; the sheets are a compute pass now
(`fluid/gpu/sheet.ts`, drawn by `render/falls-gpu.ts`) and `build` is 0.27ms,
`js` 0.64ms. The host renderer stays as the reference and as the WebGL path.

Two things fell out of it; one is still open and one is settled:

- **`NAPPE_STEPS` is still 24 and still unmeasured at 12.** The cost moved to
  the device rather than going away — the pass is 5,760 quads either way — but
  the argument in `nappe.ts:38` is about a 3-degree crease against a 29-degree
  one, and nobody has looked at what 12 gives. The angle test at
  `falls-render.test.ts:200` already measures it.
- **The sheet quantises the shade ramp and the host interpolates it**, which is
  measured and deliberate: over 260 corners every device colour lands on a ramp
  entry and only 42 of the host's do, so the two differ by under one step (3, 2
  and 1 of 255). The surface quantises the same way, so the sheet now agrees
  with the surface it joins rather than with `drawFalls`. SETTLED as no action
  — see the last section — because `drawFalls` is the reference for what a
  sheet should be and the difference runs the right way round.

## Open: the two solvers differ SYSTEMATICALLY, and it is not chaos

`__frameCompare(120)` on this fixture, and it passes (`ok: true`). It builds
its own shorter scene rather than using the live one, so its counts are not the
live map's — 76 lips here against the 732 above:

```
volume   cpu 14592      gpu 14591.998   drift 1.1e-7
air      cpu 575.535    gpu 575.535
wet      3669 both      lips 76 both
```

Conservation is exact to the eighth digit and the air matches to three
decimals. The field does not:

```
worst depth cell 0.749 on a scale of 9.43   419 cells beyond a milli-half-step
foam worst 0.118 on a scale of 1            wash worst 0.048 on a scale of 0.999
drips cpu 727 / gpu 768
```

Two implementations of a chaotic system drift apart, and the totals agreeing to
1e-7 is the evidence that the drift is chaos rather than a leak.

**The foam and wash figures above were the harness's fault and are now fixed**
— see the commit that added `GpuFrame.carried`. They read 1.0 and 0.732
because the carried fields come down once every `CARRY_EVERY` (30) readbacks
by design, and the comparison diffed a freshly stepped CPU foam against a host
copy up to half a second old. Measured frame by frame the difference was a
clean square wave: 1.0 on every frame, and 0.037 and 0.010 on exactly the two
frames in sixty-two where `readMb` jumped from 0.09 to 0.21. Waiting for a
carry before reading, the same two solvers now report **foam 0.118 and wash
0.048**, and `carriedFresh` on the result says whether they are worth reading
at all.

What is left is the depth divergence — 0.75 in the worst cell of 9.43, 419
cells beyond a milli — and **it is not chaos.** This page assumed it was. It
was measured instead, by perturbing one cell of `scene()` on the SAME solver
and watching what the difference does:

```
nudge     worst depth at frame 120     cells beyond a milli
0.01                 0.0085                     86
0.1                  0.0236                    249
0.5                  0.0939                    361
1.0                  0.2021                    439
the two solvers      0.749                     419
```

So after 120 frames the two solvers differ by MORE than dropping a whole half
step of water into the fastest-moving cell on the map does. A float32 against a
float64 is a difference of about 1e-7; for that to look like this it would have
to amplify seven orders of magnitude in 120 frames, and over that window the
amplification is NEGATIVE — a 1e-5 nudge decays monotonically from 9.5e-6 at
frame 1 to 3.9e-6 at frame 120, with no cell anywhere beyond a milli.

**There is a systematic difference, and it is mostly the SPRAY.** Hunted down
to here, not yet to a line:

```
spray scene, frame 32     worst 3.3e-6, 0 cells beyond a milli, 0 drips both
                          — lockstep, at the level of f32 rounding
spray scene, frame 44     worst 0.231,  46 cells.  FIRST DROPS LAND
no-spray scene, frame 120 worst 0.0139, 264 cells, 0 drips on either side
spray scene, frame 120    worst 0.749,  419 cells
```

So there are two contributions and the drop path is fifty times the larger.
The two solvers run in lockstep until the first drop LANDS, and diverge from
that frame on.

WATER IS EXACTLY CONSERVED THROUGH IT — 14592 on both sides to the digit — so
nothing is lost, it is moved. At the first divergent frame the host landed two
drops (33 to 31, volume down 0.96) while the device had not yet (33 to 35).

The mechanism is almost certainly that the two hand drops out in different
ORDERS. The device claims a slot with an atomic, so which lips get the frame's
drops is whatever order the dispatch gave out; the host walks the lip list and
takes from the same budget in order. Same water, different drops, different
landing sites — and a drop landing one cell over is a large local difference in
exactly the way this measures.

WHAT IT IS NOT: the frame-stale surface the host's drops are tested against.
That was the first hypothesis, and `stepAwaited` does step the drops before the
readback lands while the CPU steps them after its own water. Moving it changed
the drop COUNTS (626 to 619) and left the depth divergence alone — 0.749 either
way. It was also the wrong change: the live `step` cannot do better, because
its readback is asynchronous, so a harness that reorders it stops measuring the
path it is meant to measure.

AND THE NO-DROP HALF IS THE WETTING FRONT. Traced frame by frame on the
no-spray scene, it starts in one place and spreads from there:

```
frames 1-16   worst ~1e-5 everywhere             rounding, no cell over a milli
frame 15-16   (71,7): cpu 1.2e-6, gpu 3.4e-36    the front, in the sub-dry film
frame 17      (71,7): cpu 1.2e-6, gpu 3.4e-4     the device's front crosses first
frame 20      first cell over a milli
frame 120     (72,8): cpu 1.655,  gpu 1.638      the pool behind it, 1% apart
```

(71,7) sits where the ground steps from −3 to −2, so this is a film climbing a
sill. Both sides of that first disagreement are FAR below `dryDepth`, which is
0.02 — 1.2e-6 against 3.4e-36 is thirty orders of magnitude of nothing. But it
decides WHICH FRAME the front tops the sill, and the pool that fills behind it
is then a per cent out on water that is unambiguously there: by frame 120 all
206 disagreeing cells are wet ones.

So the root is a regime where the two implementations cannot be expected to
agree — a trickle so thin that f32 underflows it and f64 carries it — feeding a
threshold that turns a difference of nothing into a difference of a frame.

THE COMMON FLOOR IS IN, and it closes this mechanism exactly. `FLUX_FLOOR`
(`columns.ts`) is applied at the end of the acceleration on both sides — THE
FLUX, not the depth, which is the part that has to be right: clamping a depth
destroys the water in it every frame for ever, and clamping a flux moves
nothing. The head goes on building until it can push past the floor.

At (71,7) the two now agree to every printed digit through the whole arrival:
1.214e-6 at frames 14 to 17 where it was 1.2e-6 against 3.4e-36, then 6.464e-4,
then 8.998e-3, both sides, all the way up. The first cell over a milli moved
from frame 20 to 23, and over 120 frames:

```
no spray   worst 0.0139 -> 0.0126     cells beyond a milli 264 -> 145
spray      worst 0.749  -> 0.697      cells 419 -> 452
volume drift stays at 1e-7, because a floored flux moves nothing
```

SIZED BY MEASUREMENT AND BY A TEST. A millionth was tried first and is too big:
it changed the outflow under a plunge by seven per cent and `falls.test` caught
it. A hundred-millionth leaves every test green and still kills the 4e-9
trickle this is about.

WHAT IS LEFT AFTER IT IS THE WIND, and that is not a guess:

```
scene(), default wind, 120 frames    worst 0.0126   125 cells beyond a milli
scene(0), no wind,     120 frames    worst 2.1e-5     0 cells
```

Zero cells. With the wind off the two solvers agree to rounding over 120
frames, and every remaining disagreement on the no-drop scene is wind-driven.

AND IT IS NOT THE FRONTS THE WIND MAKES. The obvious theory is that wind pushes
water onto dry ground and the thin films there are what disagree. Flooding the
whole map so there is not one dry cell left makes it WORSE — 0.0487 and 140
cells against 0.0100 and 117 — so the wind term differs in deep water on its
own account.

RULED OUT, each measured rather than reasoned: the substep plans (identical on
60 of 60 frames), the field clock `t` (1.5 against 1.5 after 90 frames), the
coarse wind grid's indexing, the `* dt` on the sample, the `windDepth`
constant, and the shape of the `lift` ramp.

FOUND AND FIXED, but not the cause: the host adds the wind only where there is
water to push — its whole expression is guarded on a positive carry and returns
the undragged flux below that — and the device added it unconditionally, so a
dry edge got a push the host never gave it. Aligning them took the no-drop
count from 145 cells to 125 and left the worst where it was, which is how we
know it was a real difference and not this one.

SO THE THREAD ENDS HERE, one level from the bottom: it is in the wind path, it
is not any of the six things above, and it shows in deep water. The next person
wants a per-edge dump of the flux either side of one accelerate step on a
flooded windy map — which needs `fx` to come back for every cell, and that is
the harness wart below.

ONE HARNESS WART FOUND ON THE WAY. `compareFrames`'s `patch` prints the two
solvers' `fx` side by side, and the device's is meaningless there: only LIP
cells get their flux back, so every other cell shows whatever the last whole
copy left. It reads as a wild disagreement — 17.787 against 2.511 — and is an
artefact of the readback, not a difference. It predates the lip rows becoming a
slow refresh; that only made the stale values older.

AND CHAOS IS REAL BUT SLOW, which matters for the harness. The same nudges grow
eventually — 1e-5 reaches 0.0239 and 27 cells by frame 480, having been nothing
at all at 120. So `__frameCompare(120)` sits inside the window where a
difference means something, and a longer run would not: past about 240 frames
the two solvers would diverge whatever was or was not wrong with them. Do not
raise that number to get a better test; it gets a meaningless one.

## Answered: it is NOT f32 cancellation, and the cell count cannot tell you

The standing hypothesis was that the head is a difference of two surfaces near
ten half steps differing by about a hundredth, which in f32 keeps three
significant digits — so the device's answer is the host's with the digits
sheared off, and emulating f32 on the host would collapse the disagreement.

It does not. `__frameCompare(120)`, cells beyond a thousandth:

```
baseline (f64 host)                          125
Math.fround on hi, hj, head, carry            89
f32 emulated through the WHOLE accelerate     96
```

Fuller emulation moves AWAY. So the next thing to ask is what an arbitrary
perturbation of the same size does — deterministic zero-mean noise added to
`head`, no f32 anywhere:

```
amplitude   0     6e-9   6e-8   6e-7   6e-6   6e-5
cells       125   231    161    47     379    1672
```

**Below about 1e-6 the count has no relationship to the amplitude at all**, and
the unperturbed 125 sits inside that band — lower than a 6e-9 nudge and higher
than a 6e-7 one. `beyondMilli` is not measuring how close the host's arithmetic
is to the device's; it is measuring how hard the host has been jostled, and at
f32 scale it is pure noise. Every experiment of the form "make the host more
like the device and count the cells" is reading that noise, including both
rows of the table above.

This does not prove f32 is innocent. It proves the instrument cannot convict
it, which closes the question for practical purposes: the residual is
indistinguishable from an f32-sized nudge anywhere in the pass, and there is
nothing on the device to point at. The `minHead` threshold finding above
stands as the mechanism by which a nudge that small becomes a cell that
differs.

WHAT THE SWEEP GAVE INSTEAD was a better statistic. Over seven clean runs from
thirty to three hundred frames, the water each side holds in the AIR agreed
exactly, to every digit, at every length — the only number on this page that
does not drift. It is now part of `ok`, along with the worst cell. Sabotaged
with a 6e-3 nudge, the verdict fails on the air arm alone: 0.055 against 0.052,
while the worst cell reads 0.019 against a threshold of 0.02 and the mean is
sixteen times inside its own. The old verdict — volume and mean only — passed
that run and printed the numbers.

## Then: depth is what is left of the readback

0.263MB comes down a frame, and **254KB of it is the depth band** — 97%. The
rest is the spawn head. The lip rows went to a slow refresh when the sheets
moved to the device, since nothing on that path reads them any more except the
handover back to the CPU solver: 58.6KB a frame to 2KB, and the row still comes
back whole with the wash and the foam every `CARRY_EVERY`.

Depth is almost all waste, and the falls moving has made it more so. The host
reads depth at the drip positions, the pipe mouths and the cursor — call it
**290 cells**, where `drawFalls` used to want 1,180 of them. It receives 65,536.
The band optimisation buys nothing on a flooded map because the active box is
then the whole map.

The shape of the fix is the quad gather again: a compute pass fed a list of the
cells the host wants, writing just those back. One frame stale, which every
remaining consumer can take — a drop deciding whether it has landed does not
care that the surface is 16ms old. That is 254KB to under 2KB, and it is the
last piece of the water living entirely on the device.

What it buys is NOT frame time: the readback is pipelined and the scatter is
0.1 to 0.3ms. It buys maps bigger than 64², where the band scales and the
wanted cells do not.

## Fixed: the white rim at an open edge

Reported as foam flickering on and off at the boundary, about half a cell wide,
worse when the camera moves. It was neither the mesh popping nor a shading
problem: `spill` empties the outermost ring every substep, the flow refills it
from inside, and the breaking test — which reads how fast a surface is moving —
saw a whole column arrive and leave sixty times a second. That is the largest
rate there is, so `broke` pinned at 1 along the rim and the foam field was fed
maximum white, pulsing at the refill's own rate.

```
open edge, before   92 ring columns breaking, foam saturated at 1.0
closed edge         0 breaking, foam 0.02        — the control
open edge, after    0 breaking, foam 0.0
```

TWO HALVES, because it had two. The rim is not breaking, it is LEAVING, so the
breaking test skips it when the edge is open; and foam ADVECTED into the rim
had nothing to ride out on once the water under it was deleted, so it piled up
there — 0.52 even after the breaking was fixed. What reaches an open rim now
leaves with everything it was carrying.

THE WASH WAS CHECKED AND DOES NOT HAVE IT, which is worth writing down because
it is carried the same way and the symmetry argument says it should. It does
not, for a structural reason: foam accumulates from births and decays, while
the wash RELAXES toward a fixed seed — `carried + (seed - carried) * settle` —
so it cannot pile up. Measured on the rim over twelve frames:

```
open edge     range -0.62 to 0.36    at one column: -0.0571 to -0.0568, smooth
closed edge   range -0.60 to 0.50    at one column:  0.3688 to  0.3633, smooth
```

Smooth both ways and inside the same range as the control. The rim's VALUE
differs between open and closed, which is a different flow carrying the same
pattern and not a fault.

## Instrument caveats, which cost more time than the code did

- **`__waterBench`'s `path` used to name one thing and measure another, and
  now names both.** The solver and the mesh builder are independent choices —
  `?cpuwater=1` with the GPU toggle on is a device solver drawing the host's
  mesh — and `path` was read off the solver while `build` ran whichever layer
  existed. So `drawWater`'s twenty-five milliseconds were reported under the
  name `device`, beside a `solve` of nought, and it read as an impossible
  number rather than as a mislabelled one. It now reports `solver` and `mesh`
  separately and `path` as the pair (`device+gpumesh`, `host+cpumesh`, …). The
  builds were always honest; only the name was not.
- **`wait` in the water HUD is awaited latency, not blocking CPU.** It reads
  2.4 to 2.9 ms and costs the main thread nothing; it is the one-frame pipeline
  working. Do not go chasing it.
- **A hidden Browser pane throttles rAF**, and the HUD then reads nonsense — 14
  fps, 12 substeps, `dt 100ms`, and a render time several times the real one.
  Every measurement above was taken with the pane visible. `__waterBench` drives
  frames by hand and is the way to measure with it hidden.
- **FIXED: the GPU→CPU handover drew a third of the map.** Flood the
  `waterfall` fixture on the device path, switch the water toggle to the host
  solver, and most of the map rendered dry while the readout still said 3,780
  wet and the field still held 60,000-odd wet columns with a correct active
  box. A direct `?cpuwater=1` load drew correctly, so it was the SWITCH and not
  the CPU renderer — and bisecting put it on `c2ebaaa`, before the sheets moved
  to the device, so it was its own bug and not this week's.

  It was one expression. `most` — every quad a band can draw, which is what the
  identity list means — lived on the GATHER, and the handover destroys the
  gather. With it gone the draw fell back to whatever count the meshes were
  left holding, which is the last COMPACTED one, and the compacted list is in a
  different order from the identity list: not a partial map, a wrong one.

  Measured on the fixture, gather driven by hand and the counts read off the
  meshes: identity 327,680 quads, compacted 125,472. After the handover, 125,472
  before and 327,680 after. `most` now lives on the LAYER, which outlives the
  gather. @see GpuWaterLayer.most

## Settled: the CPU path is a REFERENCE

Asked and answered. It is what `__frameCompare` diffs against, kept correct and
allowed to be slow — not something anybody is expected to run a map on.

At a fixed 1/60 on this fixture, `__waterBench(300)`:

```
              solve     submit
host          4.43 ms   0.40 ms
device        0.05 ms   0.29 ms
```

and `drawWater` (`water.ts:631`) builds vertex buffers on the host by walking
the active box per column, so the quad compaction cannot apply to it — 25ms of
`build` on a flooded map. None of that is worth fixing, because nothing reaches
it on a machine that has WebGPU.

WITH ONE NUANCE THAT IS EASY TO MISS. There are two ways to reach the host
path and only one of them is the reference:

- **The water toggle**, which is a dev switch. This is the reference, and it is
  the only way to reach a HANDOVER — a solver that was the device's becoming
  the host's with a map full of water already in it.
- **No WebGPU at all** (`world-editor.tsx:58`). That is a real fallback and the
  code is written for it, but it STARTS on the host path and never hands over.

The handover bug above could only fire on the dev toggle, which is why it was
filed as a won't-fix. It is fixed anyway: the fix was three lines, and a
reference nobody can switch to and trust is not a reference.

What the decision closes, all of it measured earlier on this page:

- **The sheet's shade quantisation** differing from `drawFalls` by under one
  ramp step — no action. `drawFalls` is the reference for what a sheet should
  BE, and the difference runs the right way: the sheet agrees with the surface
  it joins. On the WebGL fallback the surface's own GLSL quantises identically,
  so that seam is what it always was.
- **`drawWater`'s 25ms and the host solver's 4.43ms** — no action. They are the
  cost of being a reference and of being the no-WebGPU fallback, and there is
  no faster thing to fall back TO.

## How to check

`window.__gpuTime()` for the pass table and `__showWater(false)` to split the
render — the surface's share is the difference. The pane must be visible.
`window.__waterBench(300)` for `solve` and `build` at a fixed dt on
`waterfall`, `lake` and `cascade` — check its `solver` and `mesh` fields say
the configuration you meant to measure. `window.__frameCompare(120, true)` for
solver agreement, and check `carriedFresh` before believing its `wash` and
`foam`. `?gpucheck` after anything that touches what the device writes.
For host attribution, import the module and time the function directly rather
than reading a bucket.

# Making the water solver fast: measurements, options, and a WebGPU compute design

## Context

The column solver in `src/fluid/columns.ts` is the largest single cost in a frame on a wet map and it is CPU-bound and single-threaded, in series with the render build on the main thread. You asked how to make it much faster and whether to move it to WebGPU compute. This document gives measured numbers, the structural reasons for the cost, a ladder of options with honest expected gains, and a concrete design for the compute port with its risks named. Nothing has been changed in the repo. Benchmarks were run on an instrumented copy of `src/fluid` in the scratchpad, headless, at 64×64 tiles (256×256 = 65,536 columns), fixed dt of 1/60.

## 1. Where the time actually goes

Per **substep**, flooded 64² map, V8 (node 22, the engine Chrome runs). Bun/JSC is about 1.4× faster on the same code; your own notes put the browser at ~2.2× headless.

| Scene | ms / substep | accel | limit | div | apply | falls | diffuse |
|---|---|---|---|---|---|---|---|
| flat, still (wind 0, breaking 0) | 2.4 | 0.48 | 0.14 | 0.25 | 0.25 | **1.26** | 0 |
| flat, wind on | 3.8 | 0.95 | 0.28 | 1.01 | 0.29 | 1.25 | 0 |
| deep (48 half steps), wind on | 5.2 | 2.7 | 1.6 | 2.9 | 0.57 | 2.5 | 0 |
| plateau with a 24-step cliff, all on | 4.6 | 1.0 | 0.28 | 0.9 | 0.3 | 1.35 | 0.6 |

Frame cost is that times the substep count. `stableStep` is `0.4 × 0.25 / sqrt(2.25 h)`, so:

| deepest column (half steps) | substeps at 60 Hz |
|---|---|
| ≤ 16 | 1 |
| 17 to 64 | 2 |
| 65 to 144 | 3 |
| 145 to 256 | 4 |

Your recorded 8.94 ms for a flooded 64² is two substeps of ~4.5 ms, which matches. Worst case is 12 substeps and then the loop silently drops time.

Three things stand out in the breakdown:

- **`stepFalls` costs 1.25 ms per substep on a map with no falls at all.** It recomputes `flowX`/`flowY` and the smoothed throw for every column in the active box, every substep (`falls.ts:289-291`). On the flat map that is a third of the whole solver.
- **The divergence pass quadruples in cost when water moves** (0.25 → 1.0 ms). That is the `credit` closure allocated per substep and called per moving edge (`columns.ts:1180-1182`). V8 does not inline it.
- **The physics itself is cheap.** Accelerate + limit + apply on still water is ~0.9 ms for 65k columns, about 14 ns per column. That is near what typed-array JavaScript can do. There is no 10× left in the JS.

Two cheap fixes were measured on the scratch copy: gate the throw refresh to columns whose ground stands `FALL_MIN` over a neighbour, and inline `credit`. Result under V8: 3.79 → 2.95 ms (flat), 10.4 → 9.2 ms (deep), 4.5 → 3.8 ms (plateau). **20 to 25 percent.** Worth doing, not the answer.

## 2. Why it is structurally slow

1. **Seven full passes over the active box per substep**, each touching 5 to 14 `Float32Array`s. On a flooded map the active box is the whole map, so this is ~45 MB of memory traffic per substep in a language with no SIMD and no control over layout.
2. **Column resolution is 16× tile resolution.** `COLUMNS_PER_TILE = 4` means 65k cells for a 64² map. Halving it to 2 would cut the solver by 4× on its own; the tests prove the physics does not change, only the shoreline detail does.
3. **The staircase bed halves the stable Courant number** (0.4 instead of ~0.7, your measurement at `columns.ts:767-782`). Every deep pond pays roughly 1.7× the substeps it would with a bed interpolated to column resolution.
4. **Nothing sleeps.** Wind keeps every column awake by design, so a settled lake costs the same as a flood. There is no activity mask.
5. **Single thread, main thread, in series with the draw.** The solver's ~9 ms and the render build's ~5 ms (which is now almost entirely the CPU-side foam and flow-wash advection) add.

## 3. The options, honestly

| Option | Expected gain on flooded 64² | Cost | What it does not fix |
|---|---|---|---|
| **L0. JS fixes** (throw gate, inline credit, hoist invariants, skip `stepFalls` when no lip is in the box) | 25 to 35 % | 1 day | still main thread, still O(map) |
| **L1. Less work**: bed at column resolution (Courant 0.4 → 0.65); `COLUMNS_PER_TILE` 4 → 3 or 2 | 1.7× fewer substeps on deep water; 1.8× to 4× fewer cells | 3 to 5 days for the bed; the column count is a constant plus a visual judgement | worst case is still tens of ms on bigger maps |
| **L2. Worker + SharedArrayBuffer** (optionally WASM SIMD inside it) | removes the solver from the main thread entirely; WASM gives another 2 to 4× on the arithmetic | 1 week for the worker; 2+ weeks and a second copy of the physics for WASM | needs COOP/COEP headers in Vite and in Tauri's custom protocol; one frame of latency; total CPU work is unchanged or higher |
| **L3. WebGPU compute** | solver GPU time ~1 ms at 2 substeps, ~0.3 ms CPU to encode; also deletes the 1.6 MB/frame texture upload and the CPU foam/wash step; scales to 128² maps almost for free | 3 to 4 weeks; see design and risks below | WebGPU only; two solvers unless WebGL support is dropped |

The physics is embarrassingly parallel except for a handful of scatters and three reductions, and 65k cells is a tiny dispatch. **L3 is the only option that turns "the solver is the frame" into "the solver is noise."** L0 should be done regardless because the CPU solver stays as the fallback and the reference. L1's bed change is worth doing regardless because it simplifies the renderer too.

## 4. The CPU/GPU boundary today

What already lives on the GPU: the water surface vertex shader reads `depth`, `ground`, `fx`, `fy`, `material`, `foam`, `wash` as `r32float`/`r8unorm` textures made from `BufferImageSource` views and re-uploaded in full every frame (`water-gpu.ts:876-887, 975`). The corner rule is already single-sourced into WGSL (`corner-rule.ts:322`). The raw device is reachable as `renderer.gpu.device` and the repo already uses it (`world-scene.tsx:179`).

What reads solver state on the CPU every frame, and therefore needs a plan:

| Consumer | Reads | Pattern | Plan |
|---|---|---|---|
| foam + flow-wash step (`foam.ts`, `flow-wash.ts`) | depth, fx, fy, broke, falls.air/front, drips.splash | active-box scan | move to compute; they are gather-shaped semi-Lagrangian passes |
| falls-render (`falls-render.ts`) | falls.air/front/head/throwX/throwY, ground, depth, material | per falling edge | phase 1: read back falls arrays; phase 3: procedural vertex shader like `water-gpu.ts` |
| pipes ports (`pipes.ts:297-346`) | depth, ground at a few columns; writes via `addWater` | point | read from the 1-frame-stale depth readback; write through the impulse list |
| sources (`field.ts:242-253`) | writes 16 `addWater` per source tile | point | a tile-rate buffer applied in the divergence pass |
| drips (`drips.ts`, `drips-gpu.ts`) | surfaceAt at landing points; writes `splashInto` kicks; spawned by falls' spray | list ≤ 1024 | phase 1: stay on CPU; spray spawns read back from a GPU append buffer; kicks go up in the impulse list |
| `refreshWaterMeta` (`world.store.ts:394-398`) | whole depth array | full scan | compute the two numbers in the reduction pass, or gate behind the HUD |
| save (`poolSnapshot`) | whole depth array | per save | from the readback |
| `activeBox` (band visibility, region loops) | box | 4 ints | from the reduction readback, 1 frame stale |
| `stableStep` | deepest | 1 float | from the reduction readback, 1 frame stale, `hMax` backstop still applies |

Nothing outside `src/fluid` reads `rate`, `breakAge`, `velo`, `delta`, `bestIn/bestMat`, or the wind grids. Those never need to leave the GPU.

## 5. Compute design

### Storage

All storage buffers, not textures: Pixi creates its textures without `STORAGE_BINDING` and cannot be told otherwise, but a Pixi `Buffer` with `BufferUsage.STORAGE` becomes a real `GPUBuffer` with that usage and is retrievable via `renderer.buffer.getGPUBuffer` (the repo already constructs raw Pixi buffers with explicit usage at `water-gpu.ts:874`). The render shader switches from `textureLoad` to read-only storage buffer indexing, which also ends the per-frame upload.

Per cell (f32 unless noted): `ground`, `depthA`/`depthB` (ping-pong), `scale`, `rate`, `breakAge`, `broke`, `material` (u32), `landing` (i32 fixed point, 2^20), `srcRate` (per tile, f32). Per edge (×2): `fx`, `fy`, `veloA`/`veloB` for the breaking sweeps, `kick` (i32 fixed point, 2^16), and the falls set: `air`, `front`, `head`, `frontSpeed`, `headSpeed`, `since`, `shed`; per column `throwX`, `throwY`. One small `reduce` buffer: `deepest` (u32 bits, `atomicMax` is exact for non-negative floats), `box` ×4 (`atomicMin/Max`), `breaking`, `wetCount`, `volume` (i32 fixed point). One `spawn` append buffer with an atomic counter for spray drops.

### Passes per substep

1. **Breaking diffusion** (only when last frame's `breaking` flag was set): velocity prep, 2 Jacobi sweeps × 2 axes, write back. Gather with ping-pong; 5 tiny dispatches.
2. **Accelerate** (per edge, gather): sill heads, carry, drag, implicit bed drag, wind evaluated analytically in-shader, plus this edge's `kick` (clamped against the plunge cap here, where the flux is known) and zero it. Writes only the edge's own flux.
3. **Limit** (per cell, gather): `scale[i] = min(1, depth / (out × spread))` from the 4 incident fluxes.
4. **Apply limit + into air** (per edge, gather): `flux *= scale[upstream cell]`; if `dropAt` on this edge, `air[k] += move` and mark the edge as diverted. This is exactly the CPU limiter's guarantee and, unlike the CPU loop, order-independent.
5. **Divergence + apply** (per cell, gather): sum the 4 incident moves, skipping diverted ones (`dropAt` is a pure function of ground and the neighbour's depth, so the downstream cell can re-evaluate it); add `landing[i]` and the tile's `srcRate × dt`, zero them; new depth into the other buffer; `rate`, `stepBreaking`, material argmax over the 4 incoming edges (fan-in of 4, no atomics needed); atomics into `reduce`.
6. **Falls** (per edge): the state machine from `falls.ts:292-347` verbatim; landing via `atomicAdd` into `landing[landsAt]`; plunge push via `atomicAdd` into the 4 `kick`s; plunge whiteness via `atomicMax` into a splash buffer; spray via the `spawn` append buffer.

Six to eleven dispatches per substep, 12 to 130 per frame at 65k threads each. Memory-bound estimate: ~2.5 MB read per pass, ~25 µs on an integrated GPU, so **~0.3 ms GPU per substep, ~1 ms per frame at 2 substeps**, and 12 substeps still fit in a frame off the CPU. CPU encode cost is ~3 µs per dispatch.

Then once per frame: **foam and flow-wash** as two more gather passes over storage buffers (this removes the ~5 ms that is left in the GPU render path today), and a **copy of `depth`, `reduce`, `spawn`, and (phase 1 only) the falls arrays into mapped-readback staging buffers**.

### Host side per frame

- Up: `impulses` (pipes, editor pours and drains, drip splashes: a short list of `{cell or edge, amount}` applied by a small scatter pass with atomics), `srcRate` when sources change, `ground` when terrain changes (rare, full 256 KB).
- Down (async `mapAsync`, one to two frames of latency): `depth` (256 KB), `reduce` (48 bytes), `spawn` (a few KB). Phase 1 also the falls arrays (~2.5 MB, ~0.5 ms of DMA; this is what phase 3 removes).
- Substep count for this frame from last frame's `deepest`, raised by any CPU `addWater` this frame, with `hMax` as the backstop exactly as now.
- Submit the compute command buffer on Pixi's queue before `renderer.render`; same-queue ordering makes the buffers visible to the vertex shader with no fences.

### Determinism and conservation

Every gather sums in a fixed order, so results are bit-reproducible. All scatters are integer fixed-point atomics, which are associative, so landings and kicks are exact and order-independent. `deepest` via `atomicMax` on float bits is exact. Fixed-point resolution is 1e-6 half steps for depth and 1.5e-5 for flux; the CPU solver's own float32 rounding is coarser than that.

### Testing

`bun test` cannot run WGSL. The plan is the pattern you already have in `water-compare.ts`: build the same scene on the CPU solver and the GPU solver, step both at a fixed 1/60 for N frames, read back, and diff `depth`, `fx`, `fy`, `air` with a tolerance. The CPU solver stays as the pinned reference and the WebGL fallback. Keep the corner-rule discipline: one generator for any rule that exists on both sides.

## 6. Risks, in order of how much they matter

1. **WebGPU only.** There is no compute in WebGL2. Platform picture for the Tauri build (tauri 2.11, wry 0.55, no custom browser args):
   - **Windows / WebView2: works, on by default.** WebView2 ships the Edge/Chromium binaries, and Chromium has had WebGPU on by default on Windows via D3D12 since version 113 (May 2023). The old advice to pass `--enable-unsafe-webgpu` through `additionalBrowserArgs` predates 113 and is no longer needed. Caveats: Chromium picks the low-power integrated GPU and the `high-performance` hint is ignored on Windows; sessions without hardware acceleration (RDP, some VMs, `--disable-gpu`) get `navigator.gpu` with no adapter, so the fallback path must still exist and must be selected by `requestAdapter()` returning null, not by feature detection alone.
   - **macOS / WKWebView: needs macOS 26.** WebKit ships WebGPU by default in Safari 26 and, per Apple's own forum reply, in WKWebView on the 26 releases. On macOS 15 (this machine) WKWebView has no WebGPU regardless of Safari flags, because Safari feature flags do not apply to WKWebView.
   - **Browser deploy: Chrome and Edge on Windows/macOS since 113, Firefox since 141 on Windows, Safari 26.** Linux Chromium is still not default.
   Decide up front whether the desktop build requires macOS 26+, or whether the CPU solver stays as a maintained fallback. Two solvers is the price of keeping macOS 15 and WebGL, and the compare harness is what makes it bearable.
2. **SETTLED: synchronisation between dispatches is automatic.** Within one compute pass each dispatch is its own synchronization scope and they behave as if run serially — the API inserts the barriers ([gpuweb discussion 4434](https://github.com/gpuweb/gpuweb/discussions/4434), from a spec editor). So §5's "six to eleven dispatches per substep" needs no barriers written between them, and a pass that must see all of another's output splits into two *dispatches*, not two passes. What is **not** synchronised is anything inside a single dispatch, which is where the atomics in passes 4 to 6 earn their keep. Worth knowing that the obvious experiment cannot establish this: two dependent dispatches in one pass came back clean five times out of five, and a guarantee is indistinguishable from a coincidence by observing it hold.
3. **A compute stage is guaranteed only EIGHT storage buffers.** Found at pass 2, with nine bound. This adapter allows ten. The solver has around twenty arrays, so they live in one packed `array<f32>` at known offsets — see `fluid/gpu/state.ts`. §5's per-array storage list should be read as a layout within one buffer, not as bindings.
4. **Pixi integration is undocumented territory.** Storage buffers in a vertex stage need a hand-written `gpuLayout` with `type: "read-only-storage"`; you already write custom layouts for the same reason (`drips-gpu.ts:512-533`). Verify in a one-day spike before committing: a storage buffer written by your compute pass, read by a Pixi mesh's vertex shader, on Pixi's device.
5. **Latency at the seams.** Pipes and drips see depth one to two frames old. The port model's `SETTLE` cap already guards overshoot; the editor's pour readout will lag one frame. Acceptable, but it must be stated in the code.
6. **Scope creep into drips.** Drips are a stream-compaction particle system with a mouth budget. Leave them on the CPU in phase 1; the spray spawn readback is the only new coupling.
7. **The falls readback in phase 1 is the largest transfer** and exists only until falls-render becomes procedural.

## 7. Recommended sequence

- **Phase 0 — DONE (commit `a4a98cd`), and it went further than planned.** `stepFalls` does not skip columns with no lip, it never visits them: a fall can only happen where the ground makes a cliff, and that set is indexed once a frame in `markCliffs`. Measured back to back, headless, min of five runs, 64² flooded:

  | scene | before | after | |
  |---|---|---|---|
  | flat, still | 2.03 | **1.03** ms/frame | −49% |
  | flat, wind on | 3.91 | **2.84** | −27% |
  | deep (48) | 9.58 | **7.36** | −23% |
  | plateau + 24-step cliff | 4.49 | **3.46** | −23% |

  In the browser on `lake`, `__waterBench(200)`: solve 2.50 → 1.90 ms.

  Three of this document's claims did not survive measurement:

  - **`stirWind` is not a cost.** Disabling it appeared to save 4.7 ms on the deep scene; timed directly it is 0.02 to 0.05 ms. The probe was measuring "still water is cheap", because without wind nothing moves and the whole solver goes quiet. Any probe that removes a force is measuring the physics it drives, not the force.
  - **Inlining `credit` is worth 3 to 5%, not the 4× the divergence breakdown implied.** That table was V8; JSC handles the closure better. Still worth it, still done.
  - **Hoisting the `exp` out of the column loop is worth nothing.** Both engines already lift a pure `Math.exp` of loop invariants. Kept anyway because it reads as what it is.

  Still to do from L0: `refreshWaterMeta` behind the HUD.

  The remaining per-frame shape, with `stepFalls` now at 0.00 to 0.05 ms:

  | scene | accel | limit | div | index |
  |---|---|---|---|---|
  | flat, still | 1.37 | 0.24 | 0.81 | 0.20 |
  | deep (48) | 2.39 | 1.55 | 2.81 | 0.19 |

  What is left is the physics, which section 1 already says is near the floor for typed-array JavaScript at about 14 ns a column. There is no second `stepFalls` hiding in it. **The next real gain is L1 (fewer cells, fewer substeps) or L3 (compute), not more L0.**
- **Spike (1 to 2 days):** compute pass writes a storage buffer; Pixi water mesh reads it in the vertex stage; submitted on Pixi's queue. If this does not work cleanly, the design falls back to compute-into-buffer then `copyBufferToTexture` into Pixi's existing textures, which costs one copy per array and still works.
- **Phase 1 (1.5 weeks):** passes 1 to 6, reductions, impulses, depth and reduce readback, falls readback; the CPU/GPU state compare harness; `?cpusolver` flag mirroring `?cpuwater`.
- **Phase 2 (3 to 4 days):** foam and flow-wash as compute; render shader reads storage buffers; delete the per-frame texture uploads.
- **Phase 3 (1 week):** falls-render as a procedural vertex shader over the falls buffers; drop the falls readback.
- **Phase 4 (optional):** drips on the GPU.
- **In parallel with any of it:** bed at column resolution, and a decision on `COLUMNS_PER_TILE`.

## 8. Verification

- Phase 0: rerun the scratch benchmark (`bench.ts` in the session scratchpad; the instrumented copy prints per-phase ms) and `bun test src/fluid src/world/render`.
- Spike: `window.__waterBench` shows solve near zero and the mesh still draws; `window.__waterCompare` still passes on the CPU path.
- Phase 1 onward: the new state-compare harness, tolerance stated per array; `__waterBench` on the `lake`, `plunge`, and `cascade` fixtures before and after; the perf HUD's solve slot.

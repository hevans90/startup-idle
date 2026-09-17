# Indirect draws and dispatches for the water system

A companion to `SOLVER-PERFORMANCE-PLAN.md`. That plan moves the solver to WebGPU compute and still has the CPU deciding several things per frame from data it reads back: the substep count from `deepest`, the active box, whether anything is breaking, which columns are wet, which edges are falling. Indirect draws and indirect dispatches let the GPU decide all of those itself and hand the answer straight to the next dispatch or draw, with no readback at all. This document says what the feature is, where it is available, where it pays off in this codebase, and what Pixi does and does not give you.

## What the feature is

Three calls, all in the core WebGPU 1.0 specification:

| Call | Reads from the indirect buffer | Purpose |
|---|---|---|
| `GPURenderPassEncoder.drawIndirect(buffer, offset)` | 4 × u32: `vertexCount, instanceCount, firstVertex, firstInstance` | a non-indexed draw whose counts come from GPU memory |
| `GPURenderPassEncoder.drawIndexedIndirect(buffer, offset)` | 5 × u32: `indexCount, instanceCount, firstIndex, baseVertex, firstInstance` | the indexed form |
| `GPUComputePassEncoder.dispatchWorkgroupsIndirect(buffer, offset)` | 3 × u32: workgroup counts in x, y, z | a dispatch whose size comes from GPU memory |

The buffer is created with `GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE` (Pixi's enum spells it `BufferUsage.INDIRECT | BufferUsage.STORAGE`). A compute shader writes the numbers as ordinary storage-buffer stores, usually the result of an `atomicAdd` counter. The offset must be a multiple of 4. The draw or dispatch that follows in the same queue reads them; no fence or map is needed because same-queue submission order is execution order.

What is **not** available: multi-draw indirect, one call that consumes an array of draw commands with a GPU-written count. It exists as `chromium-experimental-multi-draw-indirect` behind a flag in Chromium and not at all in Safari. So a frame still issues one indirect call per draw. For this renderer that means one per band, and 127 bands is not a problem.

## Availability

Everywhere WebGPU itself is, since the calls are core:

- Chrome and Edge from 113 on Windows (D3D12) and macOS, which includes WebView2 and therefore the Tauri build on Windows.
- Safari 26 on macOS 26, iOS 26, iPadOS 26, and per Apple's forum reply WKWebView on the 26 releases, which is the Tauri build on macOS 26 and later. Not on macOS 15.
- Firefox 141 on Windows.

The platform decision in `SOLVER-PERFORMANCE-PLAN.md` §6 covers this and nothing here changes it.

## Where it pays off here

### 1. The substep loop, decided on the GPU

Today `stepFlow` runs a CPU `while` loop sizing each substep from `f.deepest`, which the plan proposed to feed from last frame's readback. Indirect dispatch removes the readback and the staleness:

- Allocate an args buffer with twelve slots of 3 × u32, one per possible substep.
- Every frame, encode all twelve substeps unconditionally, each pass reading its workgroup counts from its own slot via `dispatchWorkgroupsIndirect`.
- A single-thread "clock" pass at the end of substep *n* reads `deepest` (already an `atomicMax` in the reduce buffer), computes `stableStep`, subtracts it from the frame's remaining time, and writes either the region's workgroup counts or zeros into slot *n+1*. It also writes the dt each substep should use into a small uniform-like storage buffer the physics passes read.
- A dispatch of zero workgroups costs a few microseconds of encode and nothing on the GPU.

The result is a substep count and dt chosen from the current frame's deepest column, exactly as the CPU does now, with no host round trip. The `MAX_SUBSTEPS` guard stays as it is: the twelfth slot's clock pass cannot write a thirteenth. Whether it should drop the remaining time or clamp with `hMax` is the same open question the CPU has today, and it should be answered in the same place.

### 2. The active box and the breaking gate

The same clock pass writes the active region into every pass's args. A region of 256 × 256 columns at a workgroup of 16 × 16 is 16 × 16 workgroups; a puddle is a handful. The diffusion pass gets zero workgroups whenever the `breaking` flag in the reduce buffer is clear, which replaces the CPU's `if (f.breaking && …)` gate and keeps the gate a step behind, as it is now.

The box's origin needs to reach the shader too, since workgroup counts are only a size. Write `x0, y0` alongside the counts into a small storage buffer the passes read for their offset.

### 3. Drawing only the wet columns

`water-gpu.ts` draws `PARTS = 5` quads for every column of every visible band and collapses the dry ones to points. That is why a small pond costs the GPU path about 0.4 ms more than the CPU path: the CPU walks wet columns, the shader walks all of them.

With an indirect draw per band:

- A compact pass runs over the active box once per frame. Each wet column does an `atomicAdd` on its band's counter and writes its column index into that band's slice of an instance list.
- The counter is the band's `instanceCount`; the pass writes it into the band's five-u32 slot in the indirect buffer, with `indexCount` fixed at 6 × `PARTS` and `firstInstance` at the band's slice offset.
- The vertex shader reads the column index from the instance list by `instance_index` instead of deriving it from `vertex_index`, and the rest of the shader is unchanged.

Dry maps then cost nothing on the GPU as well as the CPU, and the per-band index buffers sized to the widest diagonal go away.

### 4. Falls without the readback

Phase 3 of the plan makes falls-render a procedural vertex shader and still needed the falls arrays read back in phase 1. Indirect draws remove that step entirely:

- A pass over the falls buffers appends every edge with `air > 0` and `front > 0` to an edge list, banded by where each nappe piece lands, and writes each band's count into indirect args.
- The vertex shader builds the 24 nappe pieces per edge from `front`, `head`, `throwX/Y`, `ground`, `depth`, and `material`, which are all already in storage buffers. `nappe.ts` is pure arithmetic and ports to WGSL as-is.
- Nothing about falls ever reaches the CPU except the spray spawn list, which stays a small append buffer.

### 5. Drips, later

`drips-gpu.ts` projects up to 1024 drops on the CPU into a site texture every frame. Once drips live on the GPU (phase 4), the same compaction-plus-indirect-draw pattern replaces the site texture. Not needed for the solver's performance; noted for completeness.

## What Pixi gives you, and what it does not

Pixi 8.17.1 knows the usage flag and nothing else:

- `BufferUsage.INDIRECT = 256` is in the enum, so `new Buffer({ data, usage: BufferUsage.INDIRECT | BufferUsage.STORAGE | BufferUsage.COPY_DST })` produces a real `GPUBuffer` with the right usage, retrievable with `renderer.buffer.getGPUBuffer(buffer)`.
- Pixi's encoder only ever calls `renderPassEncoder.draw` and `renderPassEncoder.drawIndexed` with counts taken from the geometry (`GpuEncoderSystem.mjs`, the `draw` method). There is no indirect path and no compute path anywhere in `lib/rendering/renderers/gpu/`.
- The live encoders are exposed: `renderer.encoder.commandEncoder` and `renderer.encoder.renderPassEncoder` are public fields on `GpuEncoderSystem`.

So the pattern is:

- **Compute passes are entirely yours.** Create pipelines and bind groups on `renderer.gpu.device`, record a command buffer, submit it on `device.queue` before `renderer.render`. The indirect dispatches go in there. Pixi never sees them.
- **Indirect draws go through a custom render pipe.** Register a `RenderPipe` for a renderable of your own. In its `execute`, use Pixi's normal systems to bind the pipeline and bind groups (`renderer.encoder.setPipeline`, `setBindGroup`, `setGeometry`, the same calls Pixi's own mesh pipe makes), then call `renderer.encoder.renderPassEncoder.drawIndexedIndirect(gpuBuffer, offset)` yourself instead of letting the encoder draw. This keeps you inside Pixi's render pass, its band containers, and its state tracking, and only replaces the one call.
- **Storage buffers in the vertex stage** need a hand-written `gpuLayout` with `type: "read-only-storage"`, exactly as `drips-gpu.ts` already writes custom layouts for `r32float` in the vertex stage.
- **The WebGL path** has none of this. WebGL2 has no compute, no indirect draws, and no storage buffers. The `?webgl` renderer stays on the current texture-and-uniform shaders fed by the CPU solver, which is the fallback the plan already requires.

## Where this changes the plan

- **§5, host side:** `deepest`, `box`, and `breaking` no longer come back to the CPU for the solver's own use. They still come back once per frame for `activeBox` consumers on the CPU (pipes, the editor) and for the HUD, but nothing on the GPU waits for them.
- **§7, spike:** add a third check to the one-day spike: an indirect draw issued from a custom render pipe inside Pixi's render pass, with the args written by a compute pass in the same frame. If Pixi's `renderPassEncoder` access turns out to be fragile across versions, the fallback is a Pixi `Mesh` with a fixed worst-case `instanceCount` where the compact pass writes degenerate instances past the count, which loses the small-map saving but keeps everything else.
- **§7, phase 3:** falls-render goes procedural through an edge list and indirect draw; the phase 1 falls readback can be skipped if phase 3 is done immediately after phase 1, which is worth considering since it is the largest transfer in the design.
- **§5, passes:** one small clock pass per substep and one compact pass per frame are added. Both are single-workgroup or one-thread-per-column passes and cost microseconds.

## Things to be careful about

- **Zero-workgroup dispatches are legal and free**, but a draw with `instanceCount = 0` still binds state. Twelve encoded substeps that mostly do nothing are fine; hundreds of empty draws per frame would not be, which is another reason to keep one draw per band and not one per tile.
- **Indirect args are read at execution time**, so the compute pass that writes them must be submitted before the pass that reads them, in the same queue. Writing them from the CPU with `writeBuffer` in the same frame also works and is ordered before any submitted command buffer.
- **Validation is loose by design.** The GPU does not check that an indirect `instanceCount` fits the instance list you wrote. Size the lists for the worst case (every column wet, every edge falling) and clamp the counter in the compact pass.
- **Timestamp queries** are the way to see what any of this costs on the GPU, and they must be requested when the device is created, which is Pixi's `Application` init. Pass `{ powerPreference, requiredFeatures: ["timestamp-query"] }` through the WebGPU options if the adapter supports it, and the perf HUD can finally show GPU time instead of `frame - js`.

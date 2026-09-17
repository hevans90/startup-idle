/**
 * World v2 — THE SPIKE for putting the water solver in a compute shader.
 *
 * KEPT, AND ANSWERED. The port it was asking about is done — `fluid/gpu` is
 * the solver — so this is no longer a question but a minimal, isolated case
 * of the mechanism the whole path rests on, which is exactly what you want
 * when that path stops working. Behind `?spike`.
 *
 * The question was:
 *
 *   CAN A COMPUTE PASS WRITE A STORAGE BUFFER THAT A PIXI MESH'S VERTEX SHADER
 *   READS, ON PIXI'S OWN DEVICE AND QUEUE, WITH NOTHING BETWEEN THEM?
 *
 * If yes, the solver's state can live in storage buffers that the surface
 * shader indexes directly, and the 1.6 MB of texture Pixi re-uploads every
 * frame stops existing. If no, the fallback is compute-into-buffer then
 * `copyBufferToTexture` into the textures Pixi already has — which works, and
 * costs one copy per array per frame, and is worth knowing BEFORE three weeks
 * of porting rather than after.
 *
 * Pixi has no compute API at all, so everything here is raw WebGPU on the
 * device — which `render/device` makes and hands to Pixi, rather than Pixi
 * making its own as it did when this was written. What makes it safe is the
 * QUEUE: work submitted to one
 * queue completes in submission order, so a compute pass encoded and submitted
 * before `renderer.render` is visible to that render with no fence, no barrier
 * and no readback. That is the property being tested.
 *
 * It proves the round trip TWICE, because either half alone can lie:
 *
 *  - a READBACK of the buffer says the compute pass ran and wrote what it
 *    meant to. A vertex shader reading zeroes and a vertex shader not reading
 *    at all look identical on screen.
 *  - a MESH whose geometry comes from that same buffer says the vertex stage
 *    can bind it as `read-only-storage`. A readback alone proves nothing about
 *    the binding, which is the part Pixi has opinions about.
 *
 * DEV ONLY, behind `?spike`. It draws nothing unless asked for.
 */
import {
  Buffer, BufferUsage, GpuProgram, Geometry, Mesh, Shader, type Renderer,
} from "pixi.js";

/** How many values the spike's compute pass writes. One per mesh vertex. */
const N = 64;

const VERTEX_STAGE = 1;
const FRAGMENT_STAGE = 2;

/**
 * The compute shader. It writes a RAMP — `i * 2 + 1` at index `i` — chosen so
 * that every kind of failure is distinguishable in the readback:
 *
 *  - all zeroes  : the pass did not run, or ran on the wrong buffer
 *  - all ones    : it ran but the index is not reaching the thread id
 *  - a ramp      : it ran, indexed correctly, and the whole dispatch landed
 *
 * A buffer of ones would pass a "did anything happen" test and tell you
 * nothing, which is the mistake this file exists to avoid making three weeks
 * deep into a port.
 */
const COMPUTE_WGSL = `
@group(0) @binding(0) var<storage, read_write> out: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= ${N}u) { return; }
  out[i] = f32(i) * 2.0 + 1.0;
}
`;

/**
 * The mesh that reads it. A row of points whose HEIGHT comes from the storage
 * buffer, so the picture is the buffer's contents drawn as a staircase — and
 * a wrong binding is a flat line rather than a subtle shift.
 *
 * `read-only-storage` in the VERTEX stage is the binding Pixi never generates
 * a layout for, which is why `gpuLayout` below is written out by hand — see
 * `drips-gpu`'s note, which was paid for with a completely black map.
 */
const VERTEX_WGSL = `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};
@group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
};
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;

@group(2) @binding(0) var<storage, read> heights: array<f32>;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vColor: vec4<f32>,
};

@vertex
fn mainVertex(@location(0) aVertexId: f32) -> VSOutput {
  let vi = i32(aVertexId);
  let quad = vi >> 2;
  let corner = vi & 3;
  // A bar per value, four half-steps wide, as tall as the value says.
  let h = heights[quad];
  let x = f32(quad) * 8.0 + select(0.0, 6.0, corner == 1 || corner == 2);
  let y = 400.0 - select(0.0, h * 2.0, corner == 0 || corner == 1);

  let world = globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let pos = (globalUniforms.uProjectionMatrix * world * vec3<f32>(x, y, 1.0)).xy;
  var out: VSOutput;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  // Green where the value is what the compute pass should have written, red
  // where it is not: the picture itself is the assertion.
  let want = f32(quad) * 2.0 + 1.0;
  let ok = abs(h - want) < 0.001;
  out.vColor = select(vec4<f32>(0.9, 0.1, 0.1, 1.0), vec4<f32>(0.2, 0.9, 0.3, 1.0), ok);
  return out;
}
`;

const FRAGMENT_WGSL = `
@fragment
fn mainFragment(@location(0) vColor: vec4<f32>) -> @location(0) vec4<f32> {
  return vColor;
}
`;

/**
 * Groups 0 and 1 are PIXI'S and must match what it binds for every other
 * pipeline in the frame, visibility included — a layout that disagrees does
 * not fail to bind, it invalidates the whole command buffer. See `drips-gpu`.
 */
function gpuLayout(): GPUBindGroupLayoutEntry[][] {
  const uniform = (binding: number): GPUBindGroupLayoutEntry => ({
    binding, visibility: VERTEX_STAGE | FRAGMENT_STAGE, buffer: { type: "uniform" },
  });
  return [
    [uniform(0)],
    [uniform(0)],
    [{ binding: 0, visibility: VERTEX_STAGE, buffer: { type: "read-only-storage" } }],
  ];
}

export type Spike = {
  mesh: Mesh<Geometry, Shader>;
  /** Encode the compute pass. Call before `renderer.render`. */
  run: () => void;
  /** What the buffer actually holds, straight off the device. */
  read: () => Promise<Float32Array>;
  destroy: () => void;
};

/**
 * Build the spike, or say why it cannot be built.
 *
 * Returns null on a renderer with no WebGPU device — the WebGL fallback has no
 * compute at all and that is the whole of risk 1 in the plan.
 */
export function createSpike(renderer: Renderer): Spike | null {
  const gpu = (renderer as unknown as { gpu?: { device: GPUDevice } }).gpu;
  const device = gpu?.device;
  if (!device) return null;

  // A PIXI buffer, so Pixi owns its lifetime and its GPUBuffer is the one the
  // shader binds. `STORAGE` is what makes it usable by the compute pass;
  // `COPY_SRC` is only for the readback and would not be needed in anger.
  const data = new Float32Array(N);
  const store = new Buffer({
    data,
    usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
  });
  // Force Pixi to create the real GPUBuffer now, and take a handle on it.
  const bufferSystem = (renderer as unknown as {
    buffer: { getGPUBuffer: (b: Buffer) => GPUBuffer };
  }).buffer;
  const raw = bufferSystem.getGPUBuffer(store);

  const module = device.createShaderModule({ code: COMPUTE_WGSL, label: "spike-compute" });
  const layout = device.createBindGroupLayout({
    entries: [{
      binding: 0, visibility: 4 /* COMPUTE */, buffer: { type: "storage" },
    }],
  });
  const pipeline = device.createComputePipeline({
    label: "spike-compute",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: "main" },
  });
  const bind = device.createBindGroup({
    layout, entries: [{ binding: 0, resource: { buffer: raw } }],
  });

  const program = new GpuProgram({
    vertex: { source: VERTEX_WGSL, entryPoint: "mainVertex" },
    fragment: { source: FRAGMENT_WGSL, entryPoint: "mainFragment" },
    name: "spike",
    layout: [{ globalUniforms: 0 }, { localUniforms: 0 }, { heights: 0 }],
    gpuLayout: gpuLayout(),
  });

  const ids = new Float32Array(N * 4);
  for (let k = 0; k < ids.length; k++) ids[k] = k;
  const index = new Uint32Array(N * 6);
  for (let q = 0; q < N; q++) {
    const v = q * 4, o = q * 6;
    index[o] = v; index[o + 1] = v + 1; index[o + 2] = v + 2;
    index[o + 3] = v; index[o + 4] = v + 2; index[o + 5] = v + 3;
  }
  const geometry = new Geometry({
    attributes: { aVertexId: { buffer: ids, format: "float32", stride: 4, offset: 0 } },
    indexBuffer: index,
  });
  const shader = new Shader({ gpuProgram: program, resources: { heights: store } });
  const mesh = new Mesh<Geometry, Shader>({ geometry, shader });

  const run = () => {
    // ON PIXI'S OWN QUEUE, before the render that reads it. Same queue means
    // submission order is completion order, so no fence is needed and none is
    // taken — which is the property the whole design depends on.
    const enc = device.createCommandEncoder({ label: "spike" });
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(N / 64));
    pass.end();
    device.queue.submit([enc.finish()]);
  };

  const read = async () => {
    const staging = device.createBuffer({
      size: N * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(raw, 0, staging, 0, N * 4);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return out;
  };

  return {
    mesh,
    run,
    read,
    destroy: () => { mesh.destroy(); store.destroy(); },
  };
}

/** What the compute pass is supposed to have written. @see COMPUTE_WGSL */
export const spikeExpected = () => {
  const want = new Float32Array(N);
  for (let i = 0; i < N; i++) want[i] = i * 2 + 1;
  return want;
};

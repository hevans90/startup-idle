import { shaderModule } from "../../fluid/gpu/state";
/**
 * HOW HARD EACH SLOT'S WATER IS LEAVING, worked out once a frame.
 *
 * `atBrink` is the most expensive thing in the water's vertex shader by a long
 * way. It reads the ground four ways, three columns out, through every slot
 * over there, and `cornerOf` and `cornerExtras` each ask it once PER
 * CONTRIBUTOR — up to twelve at a corner, four corners round every column,
 * four vertices asking each corner. One column's brink was being worked out
 * dozens of times a frame from data that had not changed since the solver put
 * it there.
 *
 * WHAT IT COST, with the GPU timestamps on and the same water in the map both
 * times: a render of 35.3ms, of which 23.4ms was this one function — two
 * thirds of the whole frame. And it is worse on a bridge exactly as reported,
 * because the innermost loop is over SLOTS: a second storey doubles it.
 *
 * So it is computed here instead, one thread per slot, and the shader reads a
 * texel. The same numbers, a few million texture reads instead of twenty-odd
 * million.
 *
 * THE ROW RULE decides whether this can be used at all. The answer lands in a
 * storage buffer and is copied into the texture the shader samples, and a
 * buffer-to-texture row must be a multiple of 256 bytes — 64 columns of float.
 * On a map that cannot take the copy there is no texture to read and the
 * shader falls back to running the scan inline, which is what it did before
 * this existed: slower, and right. @see canCopyOut
 */
import { brinkRuleSource } from "./corner-rule";

const WORKGROUP = 64;

const BRINK_WGSL = `
struct Say {
  dims: vec4<i32>,
  a: vec4<f32>,
};
@group(0) @binding(0) var<uniform> say : Say;
@group(0) @binding(1) var uDepth : texture_2d<f32>;
@group(0) @binding(2) var uGround : texture_2d<f32>;
@group(0) @binding(3) var uRoof : texture_2d<f32>;
@group(0) @binding(4) var<storage, read_write> out : array<f32>;

// NO BACKTICKS IN HERE — a backtick in a comment ends the template literal.

fn nx() -> i32 { return say.dims.x; }
fn ny() -> i32 { return say.dims.y; }
fn slots() -> i32 { return say.dims.z; }
// THE ROW THE ANSWER IS WRITTEN AT: the map's width, rounded up to whole 256
// bytes so the copy into the texture can take it on any map. @see brinkRow
fn row() -> i32 { return say.dims.w; }
fn dryDepth() -> f32 { return say.a.x; }
fn fallMin() -> f32 { return say.a.y; }
fn slotRow(y: i32, a: i32) -> i32 { return a * ny() + y; }
// IS THERE WATER HERE. One spelling of the one threshold, because there used
// to be several and they drifted: a run at moving the cutoff changed some of
// them and not the others, and what that made was a column feeding a corner's
// HEIGHT but not its alpha — a hole with extra steps, on the device only, that
// the mesh builder could not reproduce. @see wetRule
fn wet(d: f32) -> bool { return d > dryDepth(); }
fn inside(x: i32, y: i32) -> bool {
  return x >= 0 && y >= 0 && x < nx() && y < ny();
}
fn depthAt(x: i32, y: i32, a: i32) -> f32 {
  return textureLoad(uDepth, vec2<i32>(x, slotRow(y, a)), 0).r;
}
fn groundAt(x: i32, y: i32, a: i32) -> f32 {
  return textureLoad(uGround, vec2<i32>(x, slotRow(y, a)), 0).r;
}
fn roofAt(x: i32, y: i32, a: i32) -> f32 {
  return textureLoad(uRoof, vec2<i32>(x, slotRow(y, a)), 0).r;
}

${brinkRuleSource("wgsl")}

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = i32(gid.x);
  let cells = nx() * ny();
  if (i >= cells * slots()) { return; }
  let a = i / cells;
  let cell = i % cells;
  let cx = cell % nx();
  let cy = cell / nx();
  // A DRY SLOT LEANS NOWHERE, and skipping it is most of the map: the scan
  // only means anything where there is water to lean.
  let o = slotRow(cy, a) * row() + cx;
  if (depthAt(cx, cy, a) <= dryDepth()) { out[o] = 0.0; return; }
  out[o] = brinkCalc(cx, cy, a);
}
`;

/**
 * Floats a row of the answer: the width, padded to a multiple of 64 so a row
 * is whole 256 bytes and the copy into the texture is allowed whatever the
 * map's width. Before this a map not a multiple of 16 tiles across ran the
 * scan inline in every vertex instead. The tail of each row is never read.
 */
export const brinkRow = (nx: number) => Math.ceil(nx / 64) * 64;

export type BrinkPass = {
  encode: (enc: GPUCommandEncoder, slots: number) => void;
  bind: (depth: GPUTextureView, ground: GPUTextureView, roof: GPUTextureView) => void;
  say: (nx: number, ny: number, slots: number, dryDepth: number, fallMin: number) => void;
  /** Where the answer lands, for the copy into the shader's texture. */
  out: GPUBuffer;
  destroy: () => void;
};

/** @param floats the answer's size, rows padded. @see brinkRow */
export function createBrinkPass(device: GPUDevice, floats: number): BrinkPass {
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      {
        binding: 1, visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
      },
      {
        binding: 2, visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
      },
      {
        binding: 3, visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
      },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const pipeline = device.createComputePipeline({
    label: "brink",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: shaderModule(device, BRINK_WGSL, "brink"),
      entryPoint: "main",
    },
  });
  const uniform = device.createBuffer({
    size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: "brink say",
  });
  const out = device.createBuffer({
    size: Math.max(16, floats * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    label: "brink",
  });
  let group: GPUBindGroup | null = null;
  return {
    out,
    bind: (depth, ground, roof) => {
      group = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: depth },
          { binding: 2, resource: ground },
          { binding: 3, resource: roof },
          { binding: 4, resource: { buffer: out } },
        ],
      });
    },
    say: (nx, ny, s, dryDepth, fallMin) => {
      const buf = new ArrayBuffer(32);
      new Int32Array(buf, 0, 4).set([nx, ny, s, brinkRow(nx)]);
      new Float32Array(buf, 16, 4).set([dryDepth, fallMin, 0, 0]);
      device.queue.writeBuffer(uniform, 0, buf);
    },
    encode: (enc, n) => {
      if (!group) return;
      const pass = enc.beginComputePass({ label: "brink" });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(n / WORKGROUP));
      pass.end();
    },
    destroy: () => { out.destroy(); uniform.destroy(); },
  };
}

export const brinkSource = () => BRINK_WGSL;

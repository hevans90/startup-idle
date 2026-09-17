/**
 * WHICH QUADS ARE WORTH DRAWING, gathered once a frame.
 *
 * The water mesh emits five quads for every column of every band — three
 * hundred and twenty seven thousand a frame on a sixty four square map — and
 * about sixty five thousand of them draw anything. The rest collapse their
 * four corners onto a point, which makes no fragments and costs four vertex
 * invocations all the same. Timed on the device's own clocks, that is the
 * whole of the frame: the render pass is three milliseconds of having the
 * hundred and twenty seven draws at all plus eleven and a half PROPORTIONAL
 * to the quad count, against a third of a millisecond with the water hidden,
 * and quartering the pixels does not move it.
 *
 * So this walks the columns, asks {@link quadDraws} the same question the
 * vertex shader asks, and writes the ones that survive into a per-band list.
 * The band then draws that many instances instead of all of them.
 *
 * FROM THE TEXTURES, not from the solver's buffer, and that is what keeps the
 * rule single. `cornerRuleSource` and `quadRuleSource` are written against
 * five functions — `inside`, `depthAt`, `groundAt`, `dryDepth`, `fallMin` —
 * and the vertex shader answers them from these same two textures. Answering
 * them from the packed field instead would mean a second spelling of the rule
 * and a second answer to disagree with the first.
 *
 * THE ORDER IS WHATEVER THE ATOMIC GAVE OUT. Nothing downstream cares: a quad
 * carries its own column and part, so the list is a set and not a sequence.
 */
import { cornerRuleSource } from "./corner-rule";
import { quadRuleSource } from "./quad-rule";

const WORKGROUP = 64;

/** Quads a column gets. The twin of `PARTS` in `water-gpu`. */
const PARTS = 5;

const QUADS_WGSL = (drawdown: number) => `
struct Say {
  dims: vec4<i32>,        // nx, ny, columns per tile, tiles high
  a: vec4<f32>,           // dryDepth, fallMin, faces on, cap
};
@group(0) @binding(0) var<uniform> say : Say;
@group(0) @binding(1) var uDepth : texture_2d<f32>;
@group(0) @binding(2) var uGround : texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> list : array<u32>;
@group(0) @binding(4) var<storage, read_write> counts : array<atomic<u32>>;

// NO BACKTICKS IN HERE — a backtick in a comment ends the template literal.

fn nx() -> i32 { return say.dims.x; }
fn ny() -> i32 { return say.dims.y; }
fn dryDepth() -> f32 { return say.a.x; }
fn fallMin() -> f32 { return say.a.y; }
fn inside(x: i32, y: i32) -> bool {
  return x >= 0 && y >= 0 && x < nx() && y < ny();
}
fn depthAt(x: i32, y: i32) -> f32 {
  return textureLoad(uDepth, vec2<i32>(x, y), 0).r;
}
fn groundAt(x: i32, y: i32) -> f32 {
  return textureLoad(uGround, vec2<i32>(x, y), 0).r;
}

${cornerRuleSource("wgsl", drawdown)}
${quadRuleSource("wgsl")}

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = i32(gid.x);
  let cells = nx() * ny();
  if (n >= cells * ${PARTS}) { return; }
  let part = n % ${PARTS};
  let i = n / ${PARTS};
  let cx = i % nx();
  let cy = i / nx();
  if (!quadDraws(cx, cy, part, say.dims.z, say.a.z > 0.5)) { return; }

  // WHICH BAND, AND WHICH QUAD OF IT. Both are the vertex shader's own
  // arithmetic run backwards: a band is the diagonal the tile sits on, and a
  // quad is its tile's place along that diagonal, then the column within the
  // tile, then the part.
  let cpt = say.dims.z;
  let tx = cx / cpt;
  let ty = cy / cpt;
  let band = tx + ty;
  let tx0 = max(0, band - (say.dims.w - 1));
  let tileIdx = tx - tx0;
  let sub = (cy % cpt) * cpt + (cx % cpt);
  let quad = (tileIdx * cpt * cpt + sub) * ${PARTS} + part;

  let cap = i32(say.a.w);
  let at = i32(atomicAdd(&counts[band], 1u));
  if (at >= cap) { return; }
  // STORED ONE HIGHER, so that a slot the gathering did not reach reads as
  // empty rather than as quad nought. @see quadCap
  list[band * cap + at] = u32(quad + 1);
}
`;

export type QuadsPass = {
  /** Clear last frame's list, then gather this one's. */
  encode: (enc: GPUCommandEncoder, cells: number) => void;
  layout: GPUBindGroupLayout;
  bind: (
    depth: GPUTextureView, ground: GPUTextureView,
  ) => void;
  /** Where the ids go, for the copy into the shader's texture. */
  list: GPUBuffer;
  counts: GPUBuffer;
  say: (
    nx: number, ny: number, cpt: number, tilesHigh: number,
    dryDepth: number, fallMin: number, faces: boolean, cap: number,
  ) => void;
  destroy: () => void;
};

export function createQuadsPass(
  device: GPUDevice, bands: number, cap: number, drawdown: number,
): QuadsPass {
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
        buffer: { type: "storage" },
      },
      {
        binding: 4, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ],
  });
  const pipeline = device.createComputePipeline({
    label: "quads",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({
        code: QUADS_WGSL(drawdown), label: "quads",
      }),
      entryPoint: "main",
    },
  });
  const uniform = device.createBuffer({
    size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: "quads say",
  });
  const list = device.createBuffer({
    size: bands * cap * 4,
    // COPY_DST is for the CLEAR, which is a copy as far as the API is
    // concerned — without it the clear is invalid, and an invalid command
    // takes the whole command buffer with it: no gathering, no copy, and a
    // map with no water on it and nothing in the console.
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      | GPUBufferUsage.COPY_DST,
    label: "quad list",
  });
  const counts = device.createBuffer({
    size: Math.max(16, bands * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      | GPUBufferUsage.COPY_DST,
    label: "quad counts",
  });
  let group: GPUBindGroup | null = null;
  /**
   * Frames still to be checked for validation errors.
   *
   * The same guard the solver's frame carries and for the same reason: a
   * command this pass gets wrong does not throw and does not draw wrong, it
   * poisons the encoder and the whole buffer is dropped. What that looks like
   * is a map with no water on it and an empty console. It cost a clear that
   * wanted a usage flag it had not been given.
   */
  let watch = 4;

  return {
    layout, list, counts,
    bind: (depth, ground) => {
      // ONCE PER TEXTURE PAIR, not once per dispatch. The pair only changes
      // when the scene is rebuilt.
      group = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: depth },
          { binding: 2, resource: ground },
          { binding: 3, resource: { buffer: list } },
          { binding: 4, resource: { buffer: counts } },
        ],
      });
    },
    say: (nx, ny, cpt, tilesHigh, dryDepth, fallMin, faces, capacity) => {
      const buf = new ArrayBuffer(32);
      new Int32Array(buf, 0, 4).set([nx, ny, cpt, tilesHigh]);
      new Float32Array(buf, 16, 4)
        .set([dryDepth, fallMin, faces ? 1 : 0, capacity]);
      device.queue.writeBuffer(uniform, 0, buf);
    },
    encode: (enc, cells) => {
      if (!group) return;
      watch = Math.max(0, watch - 1);
      // CLEARED FIRST, and both of them. A slot the gathering does not reach
      // this frame still holds what it held last frame, and last frame's quad
      // is a real quad: drawn again it is water that is not there.
      enc.clearBuffer(list);
      enc.clearBuffer(counts);
      const pass = enc.beginComputePass({ label: "quads" });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil((cells * PARTS) / WORKGROUP));
      pass.end();
    },
    destroy: () => { uniform.destroy(); list.destroy(); counts.destroy(); },
  };
}

export const quadsSource = (drawdown = 0) => QUADS_WGSL(drawdown);

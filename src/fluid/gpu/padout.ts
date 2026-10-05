/**
 * THE SURFACE'S TEXTURES ON A MAP OF ANY WIDTH.
 *
 * A buffer-to-texture copy takes rows that start 256 bytes apart, and the
 * solver's fields are laid out a map row at a time, `nx` floats — so only a
 * map a multiple of 64 columns across (16 tiles) could have its textures
 * filled by the device. Every other one uploaded them from the host's copy,
 * which therefore had to be current: on a 204 tile map that was the material
 * whole every frame, five megabytes back down to say what the device knew, and
 * the depth band the same.
 *
 * So, where a field's rows are the wrong width, one dispatch copies it into a
 * scratch buffer whose rows ARE 256 bytes apart, and the texture is filled from
 * that. A word is a word: the floats move as floats and the material's packed
 * bytes four to a word, the copy never looks inside them. The tail of each
 * padded row is never written and never copied — the copy is `nx` texels wide.
 *
 * A REGION PER SINK, not one scratch reused, because every pad is a dispatch
 * in one pass and every copy comes after it: reused, the last field padded
 * would be the one every texture got. @see copyOut
 */
import type { GpuState, Sink } from "./state";
import { beginPass } from "./state";
import { shaderModule } from "./state";

const WORKGROUP = 64;
/** A uniform's dynamic offset must be a multiple of this. */
const PARAM_STRIDE = 256;

const PADOUT_WGSL = `
struct Pad {
  srcAt: u32,
  srcRow: u32,
  dstAt: u32,
  dstRow: u32,
  rows: u32,
}
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@group(0) @binding(2) var<uniform> pad: Pad;

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= pad.srcRow || y >= pad.rows) { return; }
  dst[pad.dstAt + y * pad.dstRow + x] = src[pad.srcAt + y * pad.srcRow + x];
}
`;

/** Whether a row of this sink can be copied as the field lays it out. */
export const rowFits = (s: GpuState, sink: Sink) =>
  ((sink.width ?? s.nx) * (sink.texel ?? 4)) % 256 === 0;

/** Where one sink's rows are put, in words. */
type Region = { sink: Sink; at: number; row: number; rows: number; param: number };

export type PadOut = {
  /**
   * Pad every sink that needs it, in one pass, and say where each one went.
   * A sink whose rows already fit is not in the answer and is copied as is.
   */
  encode: (enc: GPUCommandEncoder, s: GpuState, sinks: readonly Sink[]) =>
    Map<Sink, { buffer: GPUBuffer; offset: number; bytesPerRow: number; rows: number }>;
  destroy: () => void;
};

export function createPadOut(device: GPUDevice): PadOut {
  const layout = device.createBindGroupLayout({
    label: "padout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      {
        binding: 2, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 20 },
      },
    ],
  });
  const pipeline = device.createComputePipeline({
    label: "padout",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module: shaderModule(device, PADOUT_WGSL, "padout"), entryPoint: "main" },
  });

  /**
   * Built once per state and set of sinks — the offsets never move while
   * either lives, so neither does a word of the parameters.
   */
  type Built = {
    s: GpuState; sinks: readonly Sink[]; regions: Region[];
    scratch: GPUBuffer; params: GPUBuffer; bound: GPUBindGroup;
  };
  let built: Built | null = null;

  const build = (s: GpuState, sinks: readonly Sink[]): Built | null => {
    const regions: Region[] = [];
    let at = 0;
    for (const sink of sinks) {
      if (rowFits(s, sink)) continue;
      const texel = sink.texel ?? 4;
      const across = sink.width ?? s.nx;
      const rows = Math.min(
        Math.floor((s.length[sink.name] * 4) / (across * texel)),
        sink.texture.height,
      );
      if (rows <= 0) continue;
      const rowBytes = Math.ceil((across * texel) / 256) * 256;
      regions.push({ sink, at, row: rowBytes / 4, rows, param: regions.length * PARAM_STRIDE });
      at += (rowBytes / 4) * rows;
    }
    if (regions.length === 0) return null;
    const scratch = device.createBuffer({
      size: at * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      label: "padout scratch",
    });
    const params = device.createBuffer({
      size: regions.length * PARAM_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: "padout params",
    });
    const words = new Uint32Array(regions.length * PARAM_STRIDE / 4);
    for (const r of regions) {
      const texel = r.sink.texel ?? 4;
      const o = r.param / 4;
      words[o] = s.offset[r.sink.name];
      words[o + 1] = ((r.sink.width ?? s.nx) * texel) / 4;
      words[o + 2] = r.at;
      words[o + 3] = r.row;
      words[o + 4] = r.rows;
    }
    device.queue.writeBuffer(params, 0, words);
    const bound = device.createBindGroup({
      label: "padout",
      layout,
      entries: [
        { binding: 0, resource: { buffer: s.field } },
        { binding: 1, resource: { buffer: scratch } },
        { binding: 2, resource: { buffer: params, size: 20 } },
      ],
    });
    return { s, sinks, regions, scratch, params, bound };
  };

  const free = () => {
    built?.scratch.destroy();
    built?.params.destroy();
    built = null;
  };

  return {
    encode: (enc, s, sinks) => {
      const out = new Map<Sink, { buffer: GPUBuffer; offset: number; bytesPerRow: number; rows: number }>();
      if (!built || built.s !== s || built.sinks !== sinks) {
        free();
        const b = build(s, sinks);
        if (!b) return out;
        built = b;
      }
      const pass = beginPass(enc, s, "padout");
      pass.setPipeline(pipeline);
      for (const r of built.regions) {
        // Every source word is a whole number of 32-bit words: a float, or
        // four of the material's bytes on a row a multiple of four wide.
        const srcRow = ((r.sink.width ?? s.nx) * (r.sink.texel ?? 4)) / 4;
        pass.setBindGroup(0, built.bound, [r.param]);
        pass.dispatchWorkgroups(Math.ceil(srcRow / WORKGROUP), r.rows);
        out.set(r.sink, {
          buffer: built.scratch, offset: r.at * 4, bytesPerRow: r.row * 4, rows: r.rows,
        });
      }
      pass.end();
      return out;
    },
    destroy: free,
  };
}

export const padoutSource = () => PADOUT_WGSL;

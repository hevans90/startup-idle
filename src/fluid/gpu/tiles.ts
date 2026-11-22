/**
 * WHICH TILES HOLD WATER, listed on the device once a frame.
 *
 * `mark` flags each tile with any water in it, after the host's pours and the
 * mains have had theirs. The cliffs pass then flags the tiles with water in
 * the air over them, so a landing is never outside the list. `spread` turns
 * the flags into the list: a tile is on if any tile within reach of it is
 * flagged — reach being as far as this frame's substeps can carry water, and
 * a column more for the neighbours a wet column reads. `size` writes the
 * dispatch the water passes then run. @see TILE, cellOf
 */
import {
  REDUCE_SLOTS, STATE_WGSL, TILE, TILEN_SLOT, TILE_ROW, beginPass, bindState,
  flatIndexWgsl, groups1d, shaderModule, stateLayout, tileCount, type GpuState,
} from "./state";

const WORKGROUP = 64;

const TILES_WGSL = `
${STATE_WGSL}

@compute @workgroup_size(${WORKGROUP})
fn mark(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) nwg: vec3<u32>,
) {
  let t = ${flatIndexWgsl(WORKGROUP)};
  if (t >= tilesAcross() * tilesDown()) { return; }
  let x0 = (t % tilesAcross()) * ${TILE};
  let y0 = (t / tilesAcross()) * ${TILE};
  var wet = 0;
  for (var ly = 0; ly < ${TILE} && wet == 0; ly = ly + 1) {
    let y = y0 + ly;
    if (y >= ny()) { break; }
    for (var lx = 0; lx < ${TILE}; lx = lx + 1) {
      let x = x0 + lx;
      if (x >= nx()) { break; }
      let i = y * nx() + x;
      for (var a = 0; a < slots(); a = a + 1) {
        if (depthAt(slotBase(a) + i) > 0.0) { wet = 1; }
      }
    }
  }
  atomicStore(&reduce[${REDUCE_SLOTS} + t], wet);
}

@compute @workgroup_size(${WORKGROUP})
fn listed(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) nwg: vec3<u32>,
) {
  let t = ${flatIndexWgsl(WORKGROUP)};
  if (t >= tilesAcross() * tilesDown()) { return; }
  let tx = t % tilesAcross();
  let ty = t / tilesAcross();
  let r = tileReach();
  var on = false;
  for (var dy = -r; dy <= r; dy = dy + 1) {
    let y = ty + dy;
    if (y < 0 || y >= tilesDown()) { continue; }
    for (var dx = -r; dx <= r; dx = dx + 1) {
      let x = tx + dx;
      if (x < 0 || x >= tilesAcross()) { continue; }
      if (atomicLoad(&reduce[${REDUCE_SLOTS} + y * tilesAcross() + x]) != 0) { on = true; }
    }
  }
  setTileOn(t, select(0.0, 1.0, on));
  if (on) { setTileList(atomicAdd(&reduce[${TILEN_SLOT}], 1), t); }
}
`;

const SIZE_WGSL = `
@group(0) @binding(0) var<storage, read> reduce: array<i32>;
@group(0) @binding(1) var<storage, read_write> args: array<u32>;

@compute @workgroup_size(1)
fn main() {
  let n = u32(max(0, reduce[${TILEN_SLOT}]));
  args[0] = min(n, ${TILE_ROW}u);
  args[1] = (n + ${TILE_ROW - 1}u) / ${TILE_ROW}u;
  args[2] = 1u;
}
`;

export type TilesPass = {
  /** Flag the tiles holding water. Before the cliffs pass. */
  mark: (enc: GPUCommandEncoder, s: GpuState) => void;
  /** List the tiles in reach of a flagged one, and size the dispatch. */
  list: (enc: GPUCommandEncoder, s: GpuState) => void;
  /** The dispatch over the listed tiles, for `dispatchWorkgroupsIndirect`. */
  args: (s: GpuState) => GPUBuffer;
  layout: GPUBindGroupLayout;
};

export function createTiles(device: GPUDevice): TilesPass {
  const layout = stateLayout(device);
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const module = shaderModule(device, TILES_WGSL, "tiles");
  const [mark, spread] = ["mark", "listed"].map((entryPoint) =>
    device.createComputePipeline({
      label: `tiles:${entryPoint}`,
      layout: pipelineLayout,
      compute: { module, entryPoint },
    }));
  const sizeLayout = device.createBindGroupLayout({
    label: "tiles:size",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const sizer = device.createComputePipeline({
    label: "tiles:size",
    layout: device.createPipelineLayout({ bindGroupLayouts: [sizeLayout] }),
    compute: { module: shaderModule(device, SIZE_WGSL, "tiles:size"), entryPoint: "main" },
  });
  const made = new WeakMap<GpuState, { args: GPUBuffer; bound: GPUBindGroup }>();
  const of = (s: GpuState) => {
    let had = made.get(s);
    if (had) return had;
    const args = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
      label: "tiles:args",
    });
    had = {
      args,
      bound: device.createBindGroup({
        layout: sizeLayout,
        entries: [
          { binding: 0, resource: { buffer: s.reduce } },
          { binding: 1, resource: { buffer: args } },
        ],
      }),
    };
    made.set(s, had);
    return had;
  };
  const over = (pipeline: GPUComputePipeline, enc: GPUCommandEncoder, s: GpuState) => {
    const pass = beginPass(enc, s, "tiles");
    pass.setPipeline(pipeline);
    bindState(pass, s, layout);
    pass.dispatchWorkgroups(...groups1d(tileCount(s.nx, s.ny), WORKGROUP));
    pass.end();
  };
  return {
    layout,
    mark: (enc, s) => over(mark, enc, s),
    list: (enc, s) => {
      over(spread, enc, s);
      const size = enc.beginComputePass({ label: "tiles:size" });
      size.setPipeline(sizer);
      size.setBindGroup(0, of(s).bound);
      size.dispatchWorkgroups(1);
      size.end();
    },
    args: (s) => of(s).args,
  };
}

export const tilesSource = () => TILES_WGSL;

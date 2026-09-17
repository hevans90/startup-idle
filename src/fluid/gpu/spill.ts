/**
 * The open edge — the twin of `columns.ts`'s `spill`.
 *
 * Water that reaches the border of the map leaves it. There is nothing beyond
 * the last column to carry it, so the alternative is a wall, and a wall round
 * a map is a bathtub: every wave comes back.
 *
 * A whole pass for two lines of clearing is more than it looks worth, and it
 * is worth it for one reason — it runs at the top of EVERY substep, and only
 * the first substep of a frame happens at a moment when the host's copy of the
 * water is current. Done on the host it would be right once a frame and wrong
 * for every substep after it, which is the sort of difference that shows up as
 * a rim of water that should not be there and is then blamed on the solver.
 */
import {
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState,
} from "./state";

const WORKGROUP = 64;

const SPILL_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

/**
 * One thread per border column, the four sides laid end to end.
 *
 * The corners are covered twice and clearing a cleared cell is still a
 * cleared cell, so nothing has to know where the sides meet.
 */
@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = i32(gid.x);
  let w = nx();
  let h = ny();
  var i = -1;
  if (n < w) { i = n; }                                   // the top row
  else if (n < w * 2) { i = (h - 1) * w + (n - w); }      // the bottom row
  else if (n < w * 2 + h) { i = (n - w * 2) * w; }        // the left column
  else if (n < w * 2 + h * 2) { i = (n - w * 2 - h) * w + w - 1; }
  if (i < 0) { return; }
  setDepth(i, 0.0);
  setMaterial(i, 0.0);
}
`;

export type SpillPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState) => void;
  layout: GPUBindGroupLayout;
};

export function createSpill(device: GPUDevice): SpillPass {
  const layout = stateLayout(device);
  const pipeline = device.createComputePipeline({
    label: "spill",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ code: SPILL_WGSL, label: "spill" }),
      entryPoint: "main",
    },
  });
  return {
    layout,
    encode: (enc, s) => {
      const pass = beginPass(enc, s, "spill");
      pass.setPipeline(pipeline);
      bindState(pass, s, layout);
      pass.dispatchWorkgroups(Math.ceil((s.nx * 2 + s.ny * 2) / WORKGROUP));
      pass.end();
    },
  };
}

export const spillSource = () => SPILL_WGSL;

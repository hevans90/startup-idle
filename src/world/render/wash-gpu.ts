/**
 * The flow wash, on the device — the twin of `flow-wash.ts`'s `stepFlowWash`,
 * and here beside it rather than in `fluid/gpu` so that the one statement of
 * {@link SETTLE} serves both.
 *
 * WHY IT MOVED. The pattern is a rendering field, not a physical one, so it
 * sat on the host with the rest of the drawing — and then the solver went to
 * the device and the balance inverted. Measured on a 256 square map: the whole
 * device solver 4.6ms a frame, and the two carried fields advected on the CPU
 * 13.26ms. The cheapest thing in the frame had become the most expensive.
 *
 * SEMI-LAGRANGIAN, which is what makes it a gather: rather than pushing each
 * column's pattern downstream, each column asks where the water standing on it
 * was a moment ago and takes what was there. Nothing writes anywhere but its
 * own cell, so a thread per column needs no atomic and no ordering.
 *
 * ONCE A FRAME, not once a substep. The pattern is drawn, not simulated: it
 * has no opinion about stability and no reason to be cut into the slices the
 * water is. It steps on the whole frame's dt — see `frameDt`.
 *
 * TWO DISPATCHES, because a Lagrangian trace reads its four neighbours: one
 * array cannot be both what is read and what is written without becoming a
 * different algorithm. The second dispatch copies back, over the SAME region
 * the first wrote and no more — which is what the CPU's row-wise `set` does,
 * and getting it wrong by copying the whole array would drag stale pattern in
 * from wherever the water used to be.
 */
import {
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState,
} from "../../fluid/gpu/state";
import { SETTLE } from "./flow-wash";

const WORKGROUP = 8;

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

const WASH_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

/** Bilinear sample of the pattern as it stands, clamped at the rim. */
fn sampleWash(sx: f32, sy: f32) -> f32 {
  let cx = clamp(sx, 0.0, f32(nx() - 1));
  let cy = clamp(sy, 0.0, f32(ny() - 1));
  let x0 = i32(cx);
  let y0 = i32(cy);
  let x1 = select(x0, x0 + 1, x0 < nx() - 1);
  let y1 = select(y0, y0 + 1, y0 < ny() - 1);
  let fx = cx - f32(x0);
  let fy = cy - f32(y0);
  let a = washNowAt(y0 * nx() + x0);
  let b = washNowAt(y0 * nx() + x1);
  let c = washNowAt(y1 * nx() + x0);
  let d = washNowAt(y1 * nx() + x1);
  let top = a + (b - a) * fx;
  let bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn carry(@builtin(global_invocation_id) gid: vec3<u32>) {
  let b = carriedBox();
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x < b.x || y < b.y || x > b.z || y > b.w) { return; }
  let i = y * nx() + x;
  // Tiles a second into columns a step: where the water here now was then.
  let back = frameDt() / cellSize();
  let carried = sampleWash(f32(x) - flowXAt(i) * back, f32(y) - flowYAt(i) * back);
  let settle = 1.0 - exp(-frameDt() / ${f(SETTLE)});
  setWashNext(i, carried + (washSeedAt(i) - carried) * settle);
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn swap(@builtin(global_invocation_id) gid: vec3<u32>) {
  let b = carriedBox();
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x < b.x || y < b.y || x > b.z || y > b.w) { return; }
  let i = y * nx() + x;
  setWashNow(i, washNextAt(i));
}
`;

export type WashPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState) => void;
  layout: GPUBindGroupLayout;
};

export function createWashPass(device: GPUDevice): WashPass {
  const layout = stateLayout(device);
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const module = device.createShaderModule({ code: WASH_WGSL, label: "wash" });
  const stages = ["carry", "swap"].map((entryPoint) =>
    device.createComputePipeline({
      label: `wash:${entryPoint}`,
      layout: pipelineLayout,
      compute: { module, entryPoint },
    }));
  return {
    layout,
    encode: (enc, s) => {
      // OVER THE WHOLE MAP, and each thread decides for itself whether it is
      // in the box — because the box it has to match is the one the device
      // just reduced, which this side does not know. @see carriedBox
      const gx = Math.ceil(s.nx / WORKGROUP);
      const gy = Math.ceil(s.ny / WORKGROUP);
      const pass = beginPass(enc, s, "wash");
      for (const pipeline of stages) {
        pass.setPipeline(pipeline);
        bindState(pass, s, layout);
        pass.dispatchWorkgroups(gx, gy);
      }
      pass.end();
    },
  };
}

export const washSource = () => WASH_WGSL;

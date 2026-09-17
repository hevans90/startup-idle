/**
 * The depths the host still asks for, by name.
 *
 * WHAT THIS REPLACED. The readback brought back a BAND of depth — every row
 * the solver could have touched — which on a flooded map is the whole map,
 * because the active box is then the whole map. 254KB of a 263KB readback,
 * 97% of it, to answer about two hundred and ninety questions: the drops
 * deciding whether they have landed, the pipe mouths deciding whether they
 * are drowned, and the cursor under the pointer.
 *
 * So the host writes down which cells it wants and the device answers exactly
 * those. One thread per question, a load and a store, over a list of a few
 * hundred. It is the quad gather's shape applied to the last thing on this
 * path that was still coming back whole.
 *
 * WHAT IT DOES NOT BUY IS FRAME TIME. The readback is pipelined and nothing
 * waits on it; the scatter it feeds is a tenth of a millisecond. What it buys
 * is a readback that does not grow with the map, which is what stands between
 * this and maps bigger than 64 tiles square.
 *
 * AND THE BAND STILL COMES BACK, on the slow refresh the wash and the foam
 * already use. Everything else that reads the host's depth — the save, the
 * handover to the CPU solver — then sees a field that is STALE rather than
 * one that is frozen, which is the difference between a map that reloads a
 * moment behind and one that reloads as it was a minute ago.
 * @see CARRY_EVERY, WANT_MAX
 */
import {
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState,
} from "./state";

const WORKGROUP = 64;

const WANT_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let k = i32(gid.x);
  if (k >= wantN()) { return; }
  let i = wantAt(k);
  // A CELL OFF THE MAP ANSWERS DRY rather than reading past the end. The host
  // clamps what it asks for, and a thread that trusted it would be one bad
  // index away from reading another field's memory as a depth.
  if (i < 0 || i >= nx() * ny()) { setWantOut(k, 0.0); return; }
  setWantOut(k, depthAt(i));
}
`;

export type WantPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState, n: number) => void;
  layout: GPUBindGroupLayout;
};

export function createWant(device: GPUDevice): WantPass {
  const layout = stateLayout(device);
  const pipeline = device.createComputePipeline({
    label: "want",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ code: WANT_WGSL, label: "want" }),
      entryPoint: "main",
    },
  });
  return {
    layout,
    encode: (enc, s, n) => {
      if (n <= 0) return;
      const pass = beginPass(enc, s, "want");
      pass.setPipeline(pipeline);
      bindState(pass, s, layout);
      pass.dispatchWorkgroups(Math.ceil(n / WORKGROUP));
      pass.end();
    },
  };
}

export const wantSource = () => WANT_WGSL;

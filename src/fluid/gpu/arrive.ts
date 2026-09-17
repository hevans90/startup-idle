/**
 * What the host put in, added to what the device has.
 *
 * The first thing a frame does, and the reason the device can run ahead of the
 * host at all. Everything on this side that makes water — a spring, a pipe,
 * the brush, a drop landing out of the drip list — writes into the host's copy
 * of the field, and that copy is up to three frames behind the device because
 * that is what a readback costs. Sending it back as a STATE would rewind the
 * device to whatever it was three frames ago, every frame, for ever. Sent as
 * the DIFFERENCE since the host last looked, it lands correctly on whatever
 * the device holds now, and nobody has to wait for anybody.
 *
 * `addWater` is the rule being mirrored here, and it is mirrored rather than
 * shared because the host's copy of it has already run — this is the same
 * arithmetic applied a second time, to a different number.
 *
 * ONE THREAD PER ARRIVAL, not per column, and the list is COALESCED before it
 * gets here: two writes to one cell in a frame arrive as one entry. That is
 * what makes this safe without an atomic — every thread owns its cell alone —
 * and it is why the accumulator on the host side is per cell with a list of
 * which cells were touched, rather than an append-only log.
 */
import {
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState,
} from "./state";

const WORKGROUP = 64;

const ARRIVE_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = i32(gid.x);
  if (n >= arriveCount()) { return; }
  let i = i32(arriveAt(n, 0));
  if (i < 0 || i >= nx() * ny()) { return; }
  let x = i % nx();
  let y = i / nx();

  // The fluxes first, because a crater is a flux and it arrives with its
  // water rather than after it.
  let ax = arriveAt(n, 2);
  let ay = arriveAt(n, 3);
  if (ax != 0.0) { setFx(i, fxAt(i) + ax); }
  if (ay != 0.0) { setFy(i, fyAt(i) + ay); }

  let d = arriveAt(n, 1);
  if (d == 0.0) { return; }
  // Never below nothing, which is what addWater guarantees on the host: a
  // drain that asks for more than is there takes what is there.
  let next = max(0.0, depthAt(i) + d);
  // A column takes the arriving material only where water arrived, which is
  // the same test addWater makes, and loses it when it runs dry.
  let mat = arriveAt(n, 4);
  if (d > 0.0 && mat != 0.0) { setMaterial(i, mat); }
  setDepth(i, next);
  if (next <= 0.0) { setMaterial(i, 0.0); }

  // AND IT JOINS THE ACTIVE BOX. A spring on dry ground is the one thing that
  // can put water where the reduction has never looked, and a box that does
  // not know about it is a spring that does not run until something else
  // wakes the region up.
  if (next > 0.0) {
    atomicMin(&reduce[0], x);
    atomicMin(&reduce[1], y);
    atomicMax(&reduce[2], x);
    atomicMax(&reduce[3], y);
  }
}
`;

export type ArrivePass = {
  encode: (enc: GPUCommandEncoder, s: GpuState, count: number) => void;
  layout: GPUBindGroupLayout;
};

export function createArrive(device: GPUDevice): ArrivePass {
  const layout = stateLayout(device);
  const pipeline = device.createComputePipeline({
    label: "arrive",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ code: ARRIVE_WGSL, label: "arrive" }),
      entryPoint: "main",
    },
  });
  return {
    layout,
    encode: (enc, s, count) => {
      if (count <= 0) return;
      const pass = beginPass(enc, s, "arrive");
      pass.setPipeline(pipeline);
      bindState(pass, s, layout);
      pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP));
      pass.end();
    },
  };
}

export const arriveSource = () => ARRIVE_WGSL;

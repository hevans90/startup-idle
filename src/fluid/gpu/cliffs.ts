/**
 * The cliff index, on the device — the twin of `falls.ts`'s `markCliffs`.
 *
 * A fall can only happen where the ground makes a cliff, or where one is
 * already in the air, and that set is a small fraction of a map. Indexing it
 * once a frame is what turned `stepFalls` from a pass over the whole box into
 * a pass over a few dozen edges, and it is why the falls pass dispatches over
 * the index rather than over the map.
 *
 * ON THE DEVICE because the index is the only thing the falls pass needs that
 * the host was still computing. Left where it was, a device-resident frame
 * would have to read `air` and `front` back — two arrays of two per cell, the
 * single largest transfer in the plan — purely to decide which edges to walk.
 * Here it is one pass of two comparisons per column that never leaves.
 *
 * THE ORDER IS NOT THE CPU'S, and that is allowed. Threads claim their slots
 * with an `atomicAdd`, so the set comes out in whatever order the device
 * schedules, where `markCliffs` emits it ascending. It does not matter and
 * there is a proof that it does not: the falls COMMUTE (`falls-order.test.ts`),
 * which is what banking the landings bought. The one thing that did care was
 * the spray, because the drip list is packed and position decides who
 * coalesces — and `drainSpawns` sorts by edge before it makes a drop.
 *
 * ONE THREAD PER COLUMN, over the whole map rather than the active box: a
 * cliff is a fact about the ground, and the ground outside the box is exactly
 * where the water is about to go.
 */
import { FALL_MIN, THROW_EASE } from "../falls";
import {
  CLIFFN_SLOT, STATE_WGSL, beginPass, bindState, stateLayout, type GpuState,
} from "./state";

const WORKGROUP = 8;

/**
 * Seconds the launch angle takes to follow the flow, as the host's own.
 *
 * NOT A SECOND COPY: `falls.ts` holds the number and this reads it, because
 * the whole reason the smoothing exists is that both paths draw the same arc.
 * @see THROW_EASE
 */

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

const CLIFFS_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

/** Claim a slot in the index. Past the end, the edge is dropped. */
fn claim(k: i32) {
  let n = atomicAdd(&reduce[${CLIFFN_SLOT}], 1);
  if (n < nx() * ny() * 2) { setCliff(n, f32(k)); }
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= nx() || y >= ny()) { return; }
  let i = y * nx() + x;
  let k = i * 2;

  // An edge is a cliff if the ground steps down far enough across it, OR if
  // there is already something in the air off it. The second half is what
  // keeps a fall alive after the pool below has risen and swallowed its own
  // lip: the drop is gone, but the sheet still has to finish arriving.
  var own = 0.0;
  if (x + 1 < nx()
    && (groundAt(i) - groundAt(i + 1) >= ${f(FALL_MIN)}
      || airAt(k) > 0.0 || frontAt(k) > 0.0)) {
    claim(k);
    own = 1.0;
  }
  if (y + 1 < ny()
    && (groundAt(i) - groundAt(i + nx()) >= ${f(FALL_MIN)}
      || airAt(k + 1) > 0.0 || frontAt(k + 1) > 0.0)) {
    claim(k + 1);
    own = 1.0;
  }

  // THE LAUNCH IS SEEDED ONLY WHERE A COLUMN HAS JUST BECOME A LIP, not every
  // frame. Re-seeding it every frame would overwrite the smoothing below with
  // the raw value — which is the flicker the easing exists to remove.
  //
  // AND THE SMOOTHING ITSELF LIVES HERE, which is the only place it can. It
  // was in the falls pass, once per column, and a thread decided whether it
  // was its column's first edge by looking at the PREVIOUS entry in the cliff
  // index. That works on the host, where markCliffs emits ascending. It does
  // not work here: the two edges of a column are two separate claim calls,
  // so another thread's claim can land between them and the column's edges are
  // not adjacent. Both threads then read the guard as true and both ease — the
  // step applied twice, on top of the read-modify-write race between them.
  //
  // Here it is one thread per column by construction and there is no guard to
  // get wrong. It runs once a FRAME on frameDt where the falls pass ran it
  // once a substep on dt, and that is the same filter: the ease is
  // 1 - exp(-h/TAU), so n substeps compose to exp(-sum(h)/TAU) exactly. What
  // differs is that the target is now the flow at the frame's start rather
  // than tracked between substeps, which at TAU = half a second against a
  // sixtieth is a thousandth of the step it replaces.
  //
  // THE BOX STILL DECIDES, because it did before: the falls pass returns early
  // on an edge outside it, so a lip the solver is not looking at keeps the
  // throw it had rather than easing towards a flow nobody is computing.
  let was = cliffColAt(i);
  if (own > 0.0 && was == 0.0) {
    setThrowX(i, throwOf(flowXAt(i)));
    setThrowY(i, throwOf(flowYAt(i)));
  } else if (own > 0.0
      && x >= consts.box.x && x <= consts.box.z
      && y >= consts.box.y && y <= consts.box.w) {
    let ease = 1.0 - exp(-frameDt() / ${f(THROW_EASE)});
    setThrowX(i, throwXAt(i) + (throwOf(flowXAt(i)) - throwXAt(i)) * ease);
    setThrowY(i, throwYAt(i) + (throwOf(flowYAt(i)) - throwYAt(i)) * ease);
  }
  setCliffCol(i, own);
}
`;

export type CliffsPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState) => void;
  layout: GPUBindGroupLayout;
};

export function createCliffs(device: GPUDevice): CliffsPass {
  const layout = stateLayout(device);
  const pipeline = device.createComputePipeline({
    label: "cliffs",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ code: CLIFFS_WGSL, label: "cliffs" }),
      entryPoint: "main",
    },
  });
  return {
    layout,
    encode: (enc, s) => {
      const pass = beginPass(enc, s, "cliffs");
      pass.setPipeline(pipeline);
      bindState(pass, s, layout);
      pass.dispatchWorkgroups(
        Math.ceil(s.nx / WORKGROUP), Math.ceil(s.ny / WORKGROUP),
      );
      pass.end();
    },
  };
}

export const cliffsSource = () => CLIFFS_WGSL;

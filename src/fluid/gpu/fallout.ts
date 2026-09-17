/**
 * The lips, written out as a LIST for the renderer to pick up.
 *
 * WHY THIS EXISTS AT ALL. `air`, `front`, `head`, `throwX`, `throwY`, and the
 * flow wash and the foam the surface is wearing, are arrays over the whole map
 * — two and a half megabytes of the three and a half that used to come back
 * every frame — and the only thing on the host that reads any of them is
 * `drawFalls`, which puts about five hundred quads on the screen. A busy map
 * has a few hundred lips on it. So the transfer was three orders of magnitude
 * larger than the thing it fed.
 *
 * The renderer is NOT the thing to change. Its own header argues the case and
 * the case is right: five hundred quads is not a budget worth a shader for,
 * and the one parabola in `nappe.ts` staying the only copy is exactly what
 * stopped the falls behaving differently on WebGL than on WebGPU. So the
 * arrays stay, the renderer stays, and what changes is how the arrays are
 * FILLED — from a list of the lips that have anything on them rather than from
 * a copy of the whole map.
 *
 * A PASS OF ITS OWN rather than a few more lines on the end of the falls pass,
 * and that is not tidiness. The falls pass returns early all over the place —
 * a lip with nothing in the air, a sheet that has already arrived — so a row
 * written from inside it would be missing for exactly the lips that had
 * nothing to do this step, and a missing row is a stale row. This runs once at
 * the end of the frame over every lip in the index, unconditionally.
 *
 * THE LIP NEXT DOOR is what makes the list complete rather than nearly
 * complete. `drawFalls` reads a throw and a reach from the column beside each
 * lip, to share the value at the boundary between two quads — but it only ever
 * asks about a neighbour `alongLip` has already put `falling` to, and anything
 * falling is in this index. So there is no neighbour it reads that is not
 * itself a row here.
 */
import {
  AIR_SLOT, FALL_OUT_MAX, STATE_WGSL, WATER_SCALE,
  beginPass, bindState, stateLayout, type GpuState,
} from "./state";

const WORKGROUP = 64;

const FALLOUT_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = i32(gid.x);
  if (n >= cliffCount() || n >= ${FALL_OUT_MAX}) { return; }
  let k = cliffAt(n);
  // The COLUMN the edge belongs to: an edge is i * 2 + axis, so this is the
  // same integer division the host does to get back from one to the other.
  let i = k / 2;
  setFallOut(n, 0, f32(k));
  setFallOut(n, 1, airAt(k));
  setFallOut(n, 2, frontAt(k));
  setFallOut(n, 3, headAt(k));
  setFallOut(n, 4, throwXAt(i));
  setFallOut(n, 5, throwYAt(i));
  // And what the surface above the lip is WEARING, so the sheet leaves in the
  // colour the water it is made of already had. The renderer samples these two
  // at the lips and nowhere else, which is why they can ride here instead of
  // coming back as two more maps.
  setFallOut(n, 6, washNowAt(i));
  setFallOut(n, 7, foamNowAt(i));
  // HOW HARD IT IS POURING over THIS edge, which is the only flux the host
  // reads: pourOf asks for fx on an east lip and fy on a south one, never
  // both. One float here for two whole maps of flux there.
  setFallOut(n, 8, select(fyAt(i), fxAt(i), (k & 1) == 0));
  // And what the water is made of, for the sheet's colour.
  setFallOut(n, 9, f32(materialAt(i)));
  // AND WHAT IS IN THE AIR OFF THIS LIP, into the readout's running total.
  //
  // Air lives on lips and nowhere else, so this walk is the whole of it — and
  // it saves the host the other one: waterInAir sums a hundred and thirty
  // thousand edges to find the few hundred that hold anything, every tick.
  // @see AIR_SLOT
  let air = airAt(k);
  if (air > 0.0) { atomicAdd(&reduce[${AIR_SLOT}], i32(air * ${WATER_SCALE}.0 + 0.5)); }
}
`;

export type FalloutPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState, count: number) => void;
  layout: GPUBindGroupLayout;
};

export function createFallout(device: GPUDevice): FalloutPass {
  const layout = stateLayout(device);
  const pipeline = device.createComputePipeline({
    label: "fallout",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ code: FALLOUT_WGSL, label: "fallout" }),
      entryPoint: "main",
    },
  });
  return {
    layout,
    encode: (enc, s, count) => {
      if (count <= 0) return;
      const pass = beginPass(enc, s, "fallout");
      pass.setPipeline(pipeline);
      bindState(pass, s, layout);
      pass.dispatchWorkgroups(Math.ceil(Math.min(count, FALL_OUT_MAX) / WORKGROUP));
      pass.end();
    },
  };
}

export const falloutSource = () => FALLOUT_WGSL;

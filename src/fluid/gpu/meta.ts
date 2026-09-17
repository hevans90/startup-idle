/**
 * The readout's two numbers, counted where the water already is.
 *
 * How many TILES are wet and how much water the columns hold. The editor puts
 * both in the corner of the screen, and the store worked them out by walking
 * every column of the map every tick — sixty five thousand reads a frame for
 * two integers. That walk was also the last thing on the host that wanted the
 * whole depth map rather than a part of it, so counting here pays twice: the
 * walk goes, and so does the reason to send the map.
 *
 * ONE THREAD PER TILE, and a tile is `COLUMNS_PER_TILE` square. That is the
 * grain the readout asks in — a tile is wet when the MEAN of its sixteen
 * columns is over the dry depth, not when any one of them is — so counting per
 * column and dividing afterwards would answer a different question. `depthAt`
 * in `world/water/field` is the rule being mirrored; it is mirrored rather
 * than shared for the same reason every rule that has to exist in two
 * languages is.
 *
 * THE SUM IS PER TILE TOO, which is not only convenience. It is fixed point —
 * WGSL has no float `atomicAdd`, the same constraint the landings work under —
 * so every add rounds, and adding sixteen columns in a float register before
 * the one rounded add makes the rounding four thousand times rather than sixty
 * five thousand. @see WATER_SCALE
 */
import { COLUMNS_PER_TILE } from "../../world/water/field";
import {
  DEPTH_SLOT, STATE_WGSL, WATER_SCALE, WET_SLOT,
  beginPass, bindState, stateLayout, type GpuState,
} from "./state";

const WORKGROUP = 8;

/**
 * Columns to a tile, which the readout's grain is in.
 *
 * IMPORTED, not repeated. It was a literal four with a `@see` pointing at the
 * real one, which is a comment where a dependency belongs — and this file
 * bakes it into WGSL, so a change on the host side would have left the shader
 * quietly reading the map at the wrong grain.
 */
const PER_TILE = COLUMNS_PER_TILE;

const META_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let tx = i32(gid.x) * ${PER_TILE};
  let ty = i32(gid.y) * ${PER_TILE};
  if (tx >= nx() || ty >= ny()) { return; }

  var sum = 0.0;
  var n = 0;
  for (var dy = 0; dy < ${PER_TILE}; dy = dy + 1) {
    for (var dx = 0; dx < ${PER_TILE}; dx = dx + 1) {
      let x = tx + dx;
      let y = ty + dy;
      // The same bounds guard depthAt makes: a map whose columns do not divide
      // evenly into tiles has a short tile at the edge, and its mean is over
      // what is actually there.
      if (x >= nx() || y >= ny()) { continue; }
      sum = sum + depthAt(y * nx() + x);
      n = n + 1;
    }
  }
  if (n == 0) { return; }
  if (sum / f32(n) > dryDepth()) { atomicAdd(&reduce[${WET_SLOT}], 1); }
  // ONE ROUNDED ADD for the whole tile, not sixteen — and ROUNDED and not
  // truncated. i32() cuts toward zero, so four thousand truncations are four
  // thousand losses in the same direction and the total comes out light by a
  // hundredth of a per cent every time. The half turns a bias into a wobble.
  // @see WATER_SCALE
  atomicAdd(&reduce[${DEPTH_SLOT}], i32(sum * ${WATER_SCALE}.0 + 0.5));
}
`;

export type MetaPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState) => void;
  layout: GPUBindGroupLayout;
};

export function createMeta(device: GPUDevice): MetaPass {
  const layout = stateLayout(device);
  const pipeline = device.createComputePipeline({
    label: "meta",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ code: META_WGSL, label: "meta" }),
      entryPoint: "main",
    },
  });
  return {
    layout,
    encode: (enc, s) => {
      const tiles = (n: number) => Math.ceil(Math.ceil(n / PER_TILE) / WORKGROUP);
      const pass = beginPass(enc, s, "meta");
      pass.setPipeline(pipeline);
      bindState(pass, s, layout);
      pass.dispatchWorkgroups(tiles(s.nx), tiles(s.ny));
      pass.end();
    },
  };
}

export const metaSource = () => META_WGSL;

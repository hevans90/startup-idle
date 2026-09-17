/**
 * The materials, packed four to a word, so the texture can be COPIED into.
 *
 * The surface's shader samples material as an `r8unorm` texture — one byte a
 * column — and the solver holds it as a float like everything else in the
 * packed buffer. A buffer-to-texture copy does not convert, so material was
 * the one texture of the seven the device could not fill itself: it went on
 * being uploaded from the host every frame, which meant the host's copy had to
 * be kept current, which meant a quarter of a megabyte coming back down every
 * frame to keep it so. A quarter up and a quarter down to say what the device
 * already knew.
 *
 * So one thread packs four columns into a word, little-endian, which is the
 * order a row of `r8unorm` texels is in. Bitcast rather than converted: the
 * buffer is typed `array<f32>` and what wants writing is a bit pattern, not a
 * number, and `bitcast` is the way to say that without the float conversion
 * mangling it.
 *
 * FOUR IS FREE HERE. A map is a whole number of tiles and a tile is four
 * columns across, so a row is always a multiple of four and a word never
 * straddles two rows. If that ever stops being true this needs a remainder,
 * and the assert for it is that `cells` divides by four.
 */
import {
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState,
} from "./state";

const WORKGROUP = 64;

const MATPACK_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = i32(gid.x);
  // FOUR BYTES TO A WORD, which is the texel's width and not the tile's — this
  // four has nothing to do with COLUMNS_PER_TILE and must not follow it.
  let i = n * 4;
  // THE LAST PARTIAL WORD IS DROPPED, and on every shape this runs on there is
  // no partial word to drop: a column count is a tile count times
  // COLUMNS_PER_TILE, so it is a multiple of four before it is anything else.
  // The host asserts it rather than leaving this comparison to decide it
  // quietly. @see createMatpack
  if (i + 3 >= nx() * ny()) { return; }
  // materialAt returns the index as a u32 already; masked because a texel is a
  // byte and a material out of range would spill into its neighbour rather
  // than merely being wrong about itself.
  let a = materialAt(i) & 255u;
  let b = materialAt(i + 1) & 255u;
  let c = materialAt(i + 2) & 255u;
  let d = materialAt(i + 3) & 255u;
  setMatByte(n, a | (b << 8u) | (c << 16u) | (d << 24u));
}
`;

export type MatpackPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState) => void;
  layout: GPUBindGroupLayout;
};

export function createMatpack(device: GPUDevice): MatpackPass {
  const layout = stateLayout(device);
  const pipeline = device.createComputePipeline({
    label: "matpack",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ code: MATPACK_WGSL, label: "matpack" }),
      entryPoint: "main",
    },
  });
  return {
    layout,
    encode: (enc, s) => {
      // THE TAIL IS NOT PACKED. The shader drops the last partial word rather
      // than masking it, so a cell count that is not a multiple of four leaves
      // up to three columns' material at whatever the texture last held — and
      // the map would draw those three in the wrong fluid, once, somewhere in
      // the last row, which is not a thing anybody would find by looking.
      //
      // It cannot happen: a column count is a tile count times
      // COLUMNS_PER_TILE, so the product is a multiple of four before it is
      // anything else. Asserted rather than assumed, because the assumption
      // was doing the work and nothing said so.
      if (import.meta.env.DEV && (s.nx * s.ny) % 4 !== 0) {
        throw new Error(
          `matpack: ${s.nx}x${s.ny} is ${(s.nx * s.ny) % 4} columns past a whole`
          + " word, and the tail would keep the material it last held",
        );
      }
      const words = Math.ceil((s.nx * s.ny) / 4);
      const pass = beginPass(enc, s, "matpack");
      pass.setPipeline(pipeline);
      bindState(pass, s, layout);
      pass.dispatchWorkgroups(Math.ceil(words / WORKGROUP));
      pass.end();
    },
  };
}

export const matpackSource = () => MATPACK_WGSL;

/**
 * The foam, on the device — the twin of `foam.ts`'s `stepFoam`, and beside it
 * for the same reason `wash-gpu` is beside `flow-wash`: one statement of the
 * constants, shared by both.
 *
 * It is the larger half of what was left on the CPU. Measured on a 256 square
 * map with the solver already on the device, the two carried fields took
 * 13.26ms of a 23ms frame — the wash 2.7 of that and the foam the other 10.6,
 * against a whole solver costing 4. The cheapest-looking thing in the frame
 * had become the most expensive thing in it.
 *
 * SAME BACKWARD TRACE as the wash: each column asks where the water standing
 * on it was a moment ago and takes the white that was there. What differs is
 * what happens at the end — this decays towards nothing rather than settling
 * back to a pattern, and new foam is taken as a MAXIMUM against what arrived
 * rather than added, because adding lets a standing breaker pile up white
 * without limit and what you get is a blob parked on the wave.
 *
 * THREE THINGS MAKE FOAM, and only one of them is the solver's. `broke` is
 * where a wave is coming apart, which the solver works out anyway. The other
 * two are water ARRIVING out of the air — the foot of a fall, and a drop
 * landing — and neither is a wave breaking, so the solver has no opinion about
 * either. See the splash pass below for the second, which is the awkward one:
 * a plunge marks it from the device and a drop marks it from the host, so the
 * mark has to live somewhere both can reach and fade on its own clock.
 */
import {
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState,
} from "../../fluid/gpu/state";
import { ACC, LAND_SCALE } from "../../fluid/gpu/falls";
import { SPLASH_LIFE } from "../../fluid/drips";
import { LIFE } from "./foam";

const WORKGROUP = 8;

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

const FOAM_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

fn accAt2(region: i32, i: i32) -> i32 { return region * (nx() * ny()) + i; }

/**
 * WHERE A SPLASH IS, kept by the device because both sides mark it.
 *
 * A sheet hitting water marks it from the falls pass, in fixed point through
 * the landing bank; a drop out of the drip list marks it on the host, and is
 * uploaded. Neither is a wave breaking and the solver's own test cannot see
 * either — water put into a column directly never touches the divergence the
 * breaking test reads. It fades on its own short clock, as it does on the
 * host: see fadeSplashes, whose arithmetic this is.
 */
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn splash(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= nx() || y >= ny()) { return; }
  let i = y * nx() + x;
  let keep = exp(-frameDt() / ${f(SPLASH_LIFE)});
  var v = splashNowAt(i) * keep;
  // What the plunges banked this frame, and what the host's drops marked.
  let banked = f32(atomicLoad(&acc[accAt2(${ACC.splash}, i)])) / ${f(LAND_SCALE)};
  v = max(max(v, banked), splashInAt(i));
  // Below a hundredth it is nothing, which is what stops a mark lingering for
  // ever at a value nobody can see.
  setSplashNow(i, select(v, 0.0, v < 0.01));
}

/*
 * THERE IS NO landingAt HERE ANY MORE, and its twin in foam.ts is gone too.
 *
 * It marked the column immediately over the edge, and water thrown off a lip
 * travels while it falls. Measured on the waterfall fixture: every one of the
 * 240 edges with water in flight landed four to eight columns from the foot of
 * its cliff -- a tile or two -- so the white sat behind the sheet that made it.
 *
 * And it duplicated a mark already in the right place. The plunge banks a
 * splash at the column the water reaches, the moment the front arrives, and
 * the splash pass above already reads it: all 240 landing columns marked at
 * 0.895 against a LANDING of 0.9, and not one cliff foot marked.
 */

/** Bilinear sample of the white as it stands, clamped at the rim. */
fn sampleFoam(sx: f32, sy: f32) -> f32 {
  let cx = clamp(sx, 0.0, f32(nx() - 1));
  let cy = clamp(sy, 0.0, f32(ny() - 1));
  let x0 = i32(cx);
  let y0 = i32(cy);
  let x1 = select(x0, x0 + 1, x0 < nx() - 1);
  let y1 = select(y0, y0 + 1, y0 < ny() - 1);
  let fx = cx - f32(x0);
  let fy = cy - f32(y0);
  let a = foamNowAt(y0 * nx() + x0);
  let b = foamNowAt(y0 * nx() + x1);
  let c = foamNowAt(y1 * nx() + x0);
  let d = foamNowAt(y1 * nx() + x1);
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
  // Dry columns hold no foam at all, and holding none is not the same as
  // holding what they held: a puddle that dries leaves no white behind it.
  // AND THE RIM LOSES ITS WHITE WITH ITS WATER, the same as the host's own
  // pass does: foam advected into a ring that is emptied every substep has
  // nothing left to ride out on. @see openEdgeRim
  if (openEdgeRim(i)) { setFoamNext(i, 0.0); return; }
  if (depthAt(i) <= dryDepth()) { setFoamNext(i, 0.0); return; }

  let back = frameDt() / cellSize();
  let carried = sampleFoam(
    f32(x) - flowXAt(i) * back, f32(y) - flowYAt(i) * back,
  ) * exp(-frameDt() / ${f(LIFE)});

  let born = max(brokeAt(i), splashNowAt(i));
  setFoamNext(i, max(carried, born));
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn swap(@builtin(global_invocation_id) gid: vec3<u32>) {
  let b = carriedBox();
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x < b.x || y < b.y || x > b.z || y > b.w) { return; }
  let i = y * nx() + x;
  setFoamNow(i, foamNextAt(i));
}
`;

export type FoamPass = {
  encode: (enc: GPUCommandEncoder, s: GpuState) => void;
  layout: GPUBindGroupLayout;
};

export function createFoamPass(device: GPUDevice): FoamPass {
  const layout = stateLayout(device);
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const module = device.createShaderModule({ code: FOAM_WGSL, label: "foam" });
  const [splash, carry, swap] = ["splash", "carry", "swap"].map((entryPoint) =>
    device.createComputePipeline({
      label: `foam:${entryPoint}`,
      layout: pipelineLayout,
      compute: { module, entryPoint },
    }));
  return {
    layout,
    encode: (enc, s) => {
      const pass = beginPass(enc, s, "foam");
      // The splash over the whole map, because a drop can land anywhere and
      // a mark has to fade wherever it was left.
      pass.setPipeline(splash);
      bindState(pass, s, layout);
      pass.dispatchWorkgroups(
        Math.ceil(s.nx / WORKGROUP), Math.ceil(s.ny / WORKGROUP),
      );
      // OVER THE WHOLE MAP, and each thread decides for itself whether it is
      // in the box — because the box it has to match is the one the device
      // just reduced, which this side does not know. @see carriedBox
      const gx = Math.ceil(s.nx / WORKGROUP);
      const gy = Math.ceil(s.ny / WORKGROUP);
      for (const pipeline of [carry, swap]) {
        pass.setPipeline(pipeline);
        bindState(pass, s, layout);
        pass.dispatchWorkgroups(gx, gy);
      }
      pass.end();
    },
  };
}

export const foamSource = () => FOAM_WGSL;

/**
 * PASS 1 on the device — the twin of `columns.ts`'s `accelerate`.
 *
 * Transcribed line for line rather than rewritten, because the only thing that
 * makes a port checkable is that the two can be read side by side. Every
 * deviation below is deliberate and noted; anything else is a bug.
 *
 * WHY THIS PASS FIRST. It is a pure GATHER — an edge reads only the two cells
 * it lies between and writes only itself — so there is no scatter, no atomic,
 * no ordering, and nothing that can go wrong except the arithmetic. If the
 * arithmetic cannot be made to agree here it will not agree anywhere, and that
 * is worth finding out on the pass with the fewest other explanations.
 *
 * WHAT WILL NOT AGREE EXACTLY, and why that is fine. The CPU computes in
 * JavaScript numbers — f64 — and rounds to f32 only when it stores. The device
 * computes in f32 throughout. So the two differ by rounding from the first
 * step, and `fluid/compare` is built around exactly that: the measured horizon
 * is about a second, and one pass run once is far inside it.
 */
import { FLUX_FLOOR, type ColumnField } from "../columns";
import {
  STATE_WGSL, beginPass, bindState, stateLayout, type GpuState,
} from "./state";

/**
 * One thread per CELL, not per edge.
 *
 * A cell owns two edges — its east one and its south one — exactly as the CPU
 * loop does, so the two write the same arrays at the same indices. Splitting
 * it into a thread per edge would be a tidier dispatch and a different
 * program, and a different program is one nobody can diff against the
 * original.
 */
const WORKGROUP = 8;

const ACCELERATE_WGSL = `
${STATE_WGSL}

/**
 * The head across one edge, and the water able to carry it.
 *
 * BOTH SIDES MEASURED FROM THE SILL between them, not from the sea floor —
 * hydrostatic reconstruction, Audusse et al. 2004. See the twin in columns.ts
 * for what it looks like without this: water on a plateau driven by a head as
 * tall as the cliff, evacuating its cell in a tenth of a second.
 */
struct Edge { head: f32, carry: f32, drag: f32 };

fn edgeAt(i: i32, j: i32, si: f32) -> Edge {
  let gi = groundAt(i);
  let gj = groundAt(j);
  let sill = max(gi, gj);
  let hi = si - sill;
  let hj = gj + depthAt(j) - sill;
  let head = max(hi, 0.0) - max(hj, 0.0);
  // carry is the depth on whichever side is UPHILL: the water with a path
  // across the edge. It doubles as the dry gate, and on level ground it is the
  // upstream depth. NO BACKTICKS ANYWHERE BELOW: this is a template literal,
  // and one in a shader comment ends the shader.
  let carry = min(hMax(), select(hj, hi, head > 0.0));
  // upstream, not "from": that is a RESERVED KEYWORD in WGSL, and a shader
  // that fails to parse does not throw — the pass silently does nothing and
  // the readback shows the input unchanged, which reads exactly like a physics
  // bug. See the error scopes in compare-pass, which is what caught it.
  let upstream = select(j, i, head > 0.0);
  var e: Edge;
  e.head = head;
  e.carry = carry;
  e.drag = keepOfAt(materialAt(upstream));
  return e;
}

/** One edge's new flux, from its old one. */
fn fluxAt(old: f32, e: Edge, wind: f32) -> f32 {
  let push = e.carry > 0.0 && abs(e.head) > minHead();
  let q = select(old * e.drag, (old + gain() * e.carry * e.head) * e.drag, push);
  if (e.carry <= 0.0) { return q; }
  // THE SQUARE OF A DENORMAL DEPTH IS NOUGHT IN f32, AND THIS IS A DIVISION.
  //
  // The bed drag is a ratio over the carry squared, and a carry of 1e-37 —
  // which is an ordinary sight in water the wind is pushing into a dry cell,
  // and was measured at exactly that in this scene — squares to zero in a
  // float. With the flux at zero too that is 0/0, which is NaN, and NaN is the
  // worst possible answer here: the next pass takes max(0, depth + NaN),
  // which is zero on every device I can find, so the cell goes DRY and its
  // water is gone. No error, no discontinuity, just a total that sags. It cost
  // eight per cent of a pour over twenty four frames, it only ever happened
  // with the wind ON because nothing else makes depths that small, and it did
  // not show up in a pass-by-pass comparison because the CPU does the same
  // arithmetic in DOUBLE, where 1e-37 squared is an ordinary number.
  //
  // The limit is not NaN and is not the old flux either: as the carry falls
  // away the denominator goes to infinity, so the dragged flux goes to
  // nothing. That is what an underflowed carry means, and it is what is
  // written here.
  let c2 = e.carry * e.carry;
  let dragged = select(0.0, q / (1.0 + bedGain() * abs(q) / c2), c2 > 0.0);
  // The wind is added AFTER the drag, so it is this step's push rather than
  // something the drag has already taken a bite out of, and only where there
  // is water to push.
  let lift = select(1.0, e.carry * invWindDepth(), e.carry < windDepth());
  // AND THE FLOOR, the same one the host applies in the same place. A
  // precursor film is not water, and the two cannot agree about one: f64
  // carries it and f32 underflows it. @see FLUX_FLOOR
  // THE WIND ONLY WHERE THERE IS WATER TO PUSH, which is what the host does:
  // its whole expression is guarded on a positive carry and returns the
  // undragged flux with no wind at all below that. Added unconditionally here,
  // a dry edge got a push the host never gave it.
  let out = select(q, dragged + wind * lift, c2 > 0.0);
  return select(0.0, out, out > ${FLUX_FLOOR} || out < ${-FLUX_FLOOR});
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = consts.box.x + i32(gid.x);
  let y = consts.box.y + i32(gid.y);
  // The ACTIVE BOX and nothing outside it, because that is what the CPU walks:
  // an edge the CPU never touched keeps last step's flux, and a device that
  // helpfully updated it would disagree everywhere the water is not.
  if (x > consts.box.z || y > consts.box.w) { return; }

  let i = y * nx() + x;
  let si = groundAt(i) + depthAt(i);

  // The wind grid is coarser than the columns — one cell every wstride — and
  // both indices truncate, which for non-negative x and y is what the CPU's
  // bitwise-or-zero does.
  let wrow = (y / wstride()) * wnx();
  let wc = x / wstride();
  let wxv = windXAt(wrow + wc) * dt();
  let wyv = windYAt(wrow + wc) * dt();

  if (x + 1 < nx()) {
    setFx(i, fluxAt(fxAt(i), edgeAt(i, i + 1, si), wxv));
  } else {
    setFx(i, 0.0);                            // the map edge is a wall
  }
  if (y + 1 < ny()) {
    setFy(i, fluxAt(fyAt(i), edgeAt(i, i + nx(), si), wyv));
  } else {
    setFy(i, 0.0);
  }
}
`;

export type AcceleratePass = {
  /** Encode the dispatch into an existing encoder, for the real solver. */
  encode: (enc: GPUCommandEncoder, s: GpuState, box: Box) => void;
  layout: GPUBindGroupLayout;
};

export type Box = { x0: number; y0: number; x1: number; y1: number };

export function createAccelerate(device: GPUDevice): AcceleratePass {
  const layout = stateLayout(device);
  const pipeline = device.createComputePipeline({
    label: "accelerate",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ code: ACCELERATE_WGSL, label: "accelerate" }),
      entryPoint: "main",
    },
  });

  return {
    layout,
    encode: (enc, s, box) => {
      const pass = beginPass(enc, s, "accelerate");
      pass.setPipeline(pipeline);
      bindState(pass, s, layout);
      pass.dispatchWorkgroups(
        Math.ceil((box.x1 - box.x0 + 1) / WORKGROUP),
        Math.ceil((box.y1 - box.y0 + 1) / WORKGROUP),
      );
      pass.end();
    },
  };
}

/** The source, so a test can count what it declares. @see corner-rule */
export const accelerateSource = () => ACCELERATE_WGSL;

/** What a CPU field's flux arrays look like, for diffing against a readback. */
export const fluxOf = (f: ColumnField) => ({ fx: f.fx.slice(), fy: f.fy.slice() });

/**
 * THE WATERFALL SHEETS, built where the water already is.
 *
 * `drawFalls` was two thirds of the host's mesh building — 0.765ms of a 1.13ms
 * budget, against the six MICROseconds `drawGpuWater` costs now that the
 * surface is the device's. The difference is not that one is harder than the
 * other; it is that the surface stopped being built on the host at all and the
 * sheets had not. A fall is 24 quads per falling lip and 240 lips on a flooded
 * map, and every one of them was four `sheetLook`s, eight `driftAt`s and a
 * `pushQuad` in interpreted JavaScript, off arrays that had to be read back
 * from the device to be read at all.
 *
 * So the pass runs where the lips are. Everything a sheet is made of — the
 * lip list, how far the front and head have fallen, the throw, the depth, the
 * ground, the wash, the foam, the material — is in the packed field already,
 * which is why the readback carries a lip row per frame in the first place.
 * This reads them in place and writes the finished VERTICES.
 *
 * WHAT IT WRITES IS VERTICES, not a list for something else to expand. The
 * falls' mesh draws flat position-and-colour quads, so there is almost nothing
 * for a vertex shader to work out: the quad this computes IS the quad that is
 * drawn, and all the shader does is pick which of its four corners this vertex
 * is.
 *
 * INTO A BUFFER OF ITS OWN, and then copied per band. Writing Pixi's vertex
 * buffers directly is what this was built to do — they take a `STORAGE` usage
 * alongside their `VERTEX` one and hand back the same `GPUBuffer` — and it
 * cannot work for a reason that has nothing to do with Pixi: a vertex
 * attribute's offset must be less than its ARRAY STRIDE, so one buffer with a
 * band at each offset is an invalid pipeline. @see spill
 *
 * ONE INVOCATION PER PIECE, which is per lip per step, and a piece that is not
 * falling returns before it claims a slot. The band it lands in is worked out
 * the same way the host worked it out — the middle of the drifted quad — and
 * an atomic per band hands out the slots, so the order within a band is
 * whatever the device gave out. Nothing downstream cares: a quad carries its
 * own corners and colour, so a band's slice is a set and not a sequence.
 *
 * THE COLOUR IS A TINT LOOKUP and not a mix done here, because the tint
 * texture already holds `aerate(base, paleAt(k))` for every shade of every
 * fluid — that is what it is for, and the surface shader reads it the same
 * way. What this computes is the INDEX into it, which is the whole of
 * `sheetLook` minus the two table lookups on the end.
 *
 * WHICH QUANTISES THE SHADE, and that is a real difference from the host,
 * measured rather than assumed: over 260 corners every colour this produces
 * lands exactly on a ramp entry, while only 42 of the host's do — because
 * `paleAt` is evaluated there at a FRACTIONAL shade and lands between them.
 * Where both sit on the ramp they pick the same entry every time, so the
 * difference is strictly less than one step, which on this fluid is 3, 2 and 1
 * of 255 in r, g and b; the most seen was 2. The COVER, which goes through no
 * table on either side, agrees to within 1 of 255 with a mean error of 0.02 —
 * so `sheetLook`'s arithmetic is the same arithmetic and the ramp is the only
 * thing between them.
 *
 * And it is the difference in the right direction. The surface quantises the
 * same way, so a sheet leaving a lip now reads its colour off the same entry
 * as the surface quad above it rather than off an interpolation between two —
 * which is the one seam this whole family of functions exists to close.
 *
 * WEBGPU ONLY, like the surface's own gathering. Without a device the host
 * renderer keeps building the sheets exactly as it did, which is also what
 * runs on WebGL — see `drawFalls`, which is still the reference for what this
 * is supposed to produce.
 */
import { BRINK_REACH } from "../../world/render/corner-rule";
import { DRAWDOWN, SHADES, SHOW_DEPTH } from "../../world/render/water";
import { LIP_BIAS, NAPPE_STEPS, sheetRuleSource } from "../../world/render/nappe";
import { FALL_GRAVITY } from "../falls";
import { STATE_WGSL, bindState, stateLayout, type GpuState, shaderModule,} from "./state";

const WORKGROUP = 64;

/**
 * Floats a quad carries: four corners, then their four packed colours.
 *
 * ONE INSTANCE'S WORTH, read as three `vec4`s by the mesh — positions,
 * positions, colours — which is why they are grouped this way rather than
 * interleaved a vertex at a time. @see createGpuFallLayer
 */
export const QUAD_WORDS = 12;

/** A number WGSL will read as a float, whole ones included. */
const num = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

const SHEET_WGSL = `
${STATE_WGSL}

// NO BACKTICKS IN HERE — see the note at the top of the shared header.

struct Say {
  // half width, half height, height unit, scale
  proj: vec4<f32>,
  // bands, cap per band, columns per tile, tiles high
  dims: vec4<i32>,
};
@group(1) @binding(0) var<uniform> say : Say;
@group(1) @binding(1) var<storage, read_write> verts : array<f32>;
@group(1) @binding(2) var<storage, read_write> counts : array<atomic<u32>>;
@group(1) @binding(3) var uTint : texture_2d<f32>;

fn hw() -> f32 { return say.proj.x * say.proj.w; }
fn hh() -> f32 { return say.proj.y * say.proj.w; }
fn hu() -> f32 { return say.proj.z * say.proj.w; }
fn cap() -> i32 { return say.dims.y; }
fn cpt() -> i32 { return say.dims.z; }

fn onMap(x: i32, y: i32) -> bool {
  return x >= 0 && y >= 0 && x < nx() && y < ny();
}

/** Whether the edge is falling at all. The twin of falls.ts's own test. */
fn fallingOn(pl: i32, i: i32, axis: i32) -> bool {
  // A FALL'S EDGE IS A SLOT PAIR, an axis and a column, packed in that order —
  // the twin of fallEdge in fluid/falls. At one storey the plane is nought and
  // this is the i * 2 + axis it always was.
  let k = pl * nx() * ny() * 2 + i * 2 + axis;
  return frontAt(k) > headAt(k);
}

/**
 * How much of a lip this column is, nought to one.
 *
 * The same walk corner-rule makes, against the same four directions and the
 * same reach, written off the packed field rather than off a texture.
 */
fn spillOf(bed: f32, beside: f32) -> f32 {
  let how = (bed - beside - fallMin() * 0.5) / (fallMin() * 0.5);
  return clamp(how, 0.0, 1.0);
}

fn brinkAt(ia: i32) -> f32 {
  let cells = nx() * ny();
  let i = ia % cells;
  let cx = i % nx();
  let cy = i / nx();
  let bed = groundAt(ia);
  var most = 0.0;
  for (var k = 0; k < 4; k = k + 1) {
    var dx = 0;
    var dy = 0;
    if (k == 0) { dx = 1; } else if (k == 1) { dx = -1; }
    else if (k == 2) { dy = 1; } else { dy = -1; }
    for (var r = 1; r <= ${BRINK_REACH}; r = r + 1) {
      let jx = cx + dx * r;
      let jy = cy + dy * r;
      if (!onMap(jx, jy)) { break; }
      let jc = jy * nx() + jx;
      // WHICH SLOT OVER THERE THE WATER WOULD ACTUALLY REACH, and the LOWEST
      // of them, because that is the drop it is leaning into. The twin of
      // brinkCalc in corner-rule, and the reason it is not the ground alone: a
      // road at the mouth of a span is level with the deck and fourteen above
      // the channel, and the abutment is closed, so nothing crosses.
      var beside = 0.0;
      var floorJ = 0.0;
      var found = 0.0;
      for (var b = 0; b < slots(); b = b + 1) {
        let jb = slotBase(b) + jc;
        let gj = groundAt(jb);
        if (min(roofAt(ia), roofAt(jb)) <= max(bed, gj)) { continue; }
        let dj = depthAt(jb);
        let sfc = select(gj, gj + dj, dj > dryDepth());
        if (found == 0.0 || sfc < beside) { beside = sfc; floorJ = gj; found = 1.0; }
      }
      if (found == 0.0) { break; }
      if (floorJ > bed) { break; }
      let how = spillOf(bed, beside);
      let near = how * (1.0 - f32(r - 1) / ${num(BRINK_REACH)});
      most = max(most, near);
      if (how > 0.0) { break; }
    }
  }
  return most;
}

/** The surface's own measure of how deep a column reads. @see shownDepth */
fn shownOf(i: i32) -> f32 {
  let d = depthAt(i);
  if (d >= ${num(SHOW_DEPTH)}) { return d; }
  return max(d, ${num(SHOW_DEPTH)} * brinkAt(i));
}

/** The thickness the sheet hangs from, drawn down as the surface is. */
fn drawnOf(i: i32) -> f32 {
  return depthAt(i) * (1.0 - ${num(DRAWDOWN)} * brinkAt(i));
}

/**
 * The column beside this one ALONG the lip, if it is falling too, else -1.
 */
fn alongLip(pl: i32, src: i32, axis: i32, d: i32, stepBack: i32) -> i32 {
  let cells = nx() * ny();
  let base = src - (src % cells);
  let c = src % cells;
  let cx = c % nx();
  let cy = c / nx();
  var jx = cx;
  var jy = cy;
  if (axis == 0) { jy = cy + d; } else { jx = cx + d; }
  if (!onMap(jx, jy)) { return -1; }
  let j = jy * nx() + jx;
  // AND THE EDGE THAT NEIGHBOUR POURS OVER IS NOT ALWAYS ITS OWN. An edge
  // belongs to the column on its low-index side whichever way the water goes
  // over it, so on a fall running west or north the source column's lip is
  // the edge BEHIND it — stepBack is the distance between the two.
  let e = j - stepBack;
  if (e < 0) { return -1; }
  // ON THE SAME SLOT PAIR: a lip along a deck's edge is a lip in storey one
  // falling into storey nought, and the column beside it is only part of the
  // same lip if its water is leaving and arriving in the same two places.
  // HANDED BACK AS A SLOT, because every value the caller then shares off it
  // — the throw, the foam, the shown depth, the brink — is per slot.
  if (fallingOn(pl, e, axis)) { return base + j; }
  return -1;
}

/** Both ends of a lip agree about a value by averaging. @see sharedPour */
fn share(a: f32, b: f32, j: i32) -> f32 {
  if (j < 0) { return a; }
  return (a + b) * 0.5;
}

/** A throw never points back into the rock it left. The twin of outward(). */
fn outward(v: f32, rev: bool) -> f32 { return select(max(0.0, v), min(0.0, v), rev); }
fn alongX(v: f32, axis: i32, rev: bool) -> f32 { return select(v, outward(v, rev), axis == 0); }
fn alongY(v: f32, axis: i32, rev: bool) -> f32 { return select(v, outward(v, rev), axis == 1); }

${sheetRuleSource()}

fn driftAt(speed: f32, below: f32) -> f32 {
  return speed * sqrt(2.0 * max(0.0, below) / ${num(FALL_GRAVITY)});
}

/** A vertex's packed colour word, ABGR as the flat shader reads it. */
fn packed(shade: f32, mat: i32, cover: f32) -> u32 {
  let k = clamp(i32(shade + 0.5), 0, ${SHADES - 1});
  let rgb = textureLoad(uTint, vec2<i32>(k, mat), 0);
  let r = u32(clamp(rgb.r, 0.0, 1.0) * 255.0 + 0.5);
  let g = u32(clamp(rgb.g, 0.0, 1.0) * 255.0 + 0.5);
  let b = u32(clamp(rgb.b, 0.0, 1.0) * 255.0 + 0.5);
  let a = u32(clamp(cover, 0.0, 1.0) * 255.0 + 0.5);
  return (a << 24u) | (b << 16u) | (g << 8u) | r;
}

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = i32(gid.x);
  let lip = n / ${NAPPE_STEPS};
  let piece = n % ${NAPPE_STEPS};
  if (lip >= cliffN()) { return; }

  let kk = cliffAt(lip);
  // A FALL'S EDGE IS A SLOT PAIR, AN AXIS AND A COLUMN, and this read it as a
  // column and an axis alone — so every edge in a plane past the first decoded
  // to a column off the end of the map and was thrown away by the bound below.
  // On a map with a bridge that is most of them, which is why this pass was
  // gated off there and the host drew the falls instead. The twin of fallEdge
  // in fluid/falls, and of the decode in gpu/falls.
  let cells = nx() * ny();
  let pl = kk / (cells * 2);
  let rest = kk - pl * cells * 2;
  let i = rest / 2;
  let axis = rest % 2;
  // The storey the water is LEAVING, and the one it is falling INTO.
  let sa = pl / slots();
  let sb = pl - sa * slots();
  if (i < 0 || i >= cells) { return; }
  let head = headAt(kk);
  let front = frontAt(kk);
  if (!(front > head)) { return; }

  let cx = i % nx();
  let cy = i / nx();
  var jx = cx;
  var jy = cy;
  if (axis == 0) { jx = cx + 1; } else { jy = cy + 1; }
  if (!onMap(jx, jy)) { return; }

  // WHICH OF THE EDGE'S TWO COLUMNS THE WATER LEAVES, which is the sign of
  // the drop. Everything a sheet is made of — its thickness, its colour, its
  // throw, the lip it hangs from — belongs to that one, and hung from the
  // low-index side regardless a westward fall drew a sheet climbing out of
  // the floor it lands on. The twin of falls-render. @see dropAt
  let rev = dropAt(i, axis, sa, sb) < 0.0;
  let stepBack = select(0, select(nx(), 1, axis == 0), rev);
  let src = select(slotBase(sa) + i, slotBase(sb) + i + stepBack, rev);

  // THE EDGE IT GOES OVER, in tiles, exactly as the host lays it out.
  let stepT = 1.0 / f32(cpt());
  let tx = f32(cx / cpt());
  let ty = f32(cy / cpt());
  let fx0 = tx - 0.5 + f32(cx % cpt()) * stepT;
  let fy0 = ty - 0.5 + f32(cy % cpt()) * stepT;
  var ax = fx0;
  var ay = fy0;
  if (axis == 0) { ax = fx0 + stepT; } else { ay = fy0 + stepT; }
  let bx = fx0 + stepT;
  let by = fy0 + stepT;

  let back = alongLip(pl, src, axis, -1, stepBack);
  let fwd = alongLip(pl, src, axis, 1, stepBack);
  let bi = max(back, 0);
  let fi = max(fwd, 0);

  // ALONG THE AXIS IT POURS OVER, never back into the rock; the across
  // component keeps its sign. The twin of outward() in falls-render. Hidden
  // while the device's throw could not go negative, which made it a no-op on
  // every east and south lip.
  let axThrow = alongX(share(throwXAt(src), throwXAt(bi), back), axis, rev);
  let ayThrow = alongY(share(throwYAt(src), throwYAt(bi), back), axis, rev);
  let bxThrow = alongX(share(throwXAt(src), throwXAt(fi), fwd), axis, rev);
  let byThrow = alongY(share(throwYAt(src), throwYAt(fi), fwd), axis, rev);

  // THE FOAM OF THE SLOT IT IS LEAVING; the wash is the world's and per
  // column, so it keeps the column index. @see stepFoam
  let foamA = share(foamNowAt(src), foamNowAt(bi), back);
  let foamB = share(foamNowAt(src), foamNowAt(fi), fwd);
  let shownA = share(shownOf(src), shownOf(bi), back);
  let shownB = share(shownOf(src), shownOf(fi), fwd);
  let washA = share(washNowAt(i), washNowAt(bi % cells), back);
  let washB = share(washNowAt(i), washNowAt(fi % cells), fwd);
  let leanA = share(brinkAt(src), brinkAt(bi), back);
  let leanB = share(brinkAt(src), brinkAt(fi), fwd);
  // A LIP LEANS BY CONSTRUCTION and its pattern is fullest, so the brink goes
  // in as the lean, and how much pattern shows is one. @see sharedLit
  let litA = 0.5 + leanA * 0.34 + washA * (0.2 + 0.8) * 0.3;
  let litB = 0.5 + leanB * 0.34 + washB * (0.2 + 0.8) * 0.3;
  let brinkA = share(drawnOf(src), drawnOf(bi), back);
  let brinkB = share(drawnOf(src), drawnOf(fi), fwd);
  let lipA = share(groundAt(src), groundAt(bi), back);
  let lipB = share(groundAt(src), groundAt(fi), fwd);

  // THE PIECE, cut in TIME and biased toward the lip. @see nappeSteps
  let tHead = sqrt(2.0 * max(0.0, head) / ${num(FALL_GRAVITY)});
  let tFront = sqrt(2.0 * max(0.0, front) / ${num(FALL_GRAVITY)});
  let k0 = f32(piece);
  let k1 = f32(piece + 1);
  // THE TWO OBVIOUS NAMES FOR THESE ARE RESERVED WORDS in WGSL. The compiler
  // says so plainly; the pipeline built from it reports only that it was
  // invalid all along, which is what reaches the console.
  var fromZ = head;
  if (piece > 0) {
    let t0 = tHead + (tFront - tHead) * pow(k0 / ${num(NAPPE_STEPS)}, ${num(LIP_BIAS)});
    fromZ = ${num(FALL_GRAVITY)} * t0 * t0 * 0.5;
  }
  var toZ = front;
  if (piece + 1 < ${NAPPE_STEPS}) {
    let t1 = tHead + (tFront - tHead) * pow(k1 / ${num(NAPPE_STEPS)}, ${num(LIP_BIAS)});
    toZ = ${num(FALL_GRAVITY)} * t1 * t1 * 0.5;
  }

  // WHICH BAND, from the middle of the drifted quad — the host's own rule.
  let deep = (fromZ + toZ) * 0.5;
  let midX = driftAt((axThrow + bxThrow) * 0.5, deep);
  let midY = driftAt((ayThrow + byThrow) * 0.5, deep);
  // floor(x + 0.5) AND NOT round, because they are not the same function.
  // WGSL's round breaks a tie to the nearest EVEN integer and JavaScript's
  // Math.round breaks it upwards, so drawFalls and this disagreed on every
  // exact half: measured on the device, 0.5, 2.5, 4.5 and -1.5 all came back
  // one apart, and floor(x + 0.5) matched Math.round on all eight values
  // tried. A tie is reachable here whenever a lip's throw is zero on an axis,
  // which throwOf produces for any flow running the other way -- and then the
  // piece is filed in a different BAND on the two paths, which is a sheet
  // drawn in front of the terrain on one and behind it on the other.
  let band = i32(floor((ax + bx) * 0.5 + midX + 0.5))
    + i32(floor((ay + by) * 0.5 + midY + 0.5));
  if (band < 0 || band >= say.dims.x) { return; }

  let topZA = lipA - fromZ + brinkA;
  let topZB = lipB - fromZ + brinkB;
  let footZA = lipA - toZ + brinkA;
  let footZB = lipB - toZ + brinkB;

  // THE SLOT THE WATER LEFT, not the column. materialAt indexes the flat
  // field, so a bare column index reads storey nought — which on a fall off
  // a deck is the river underneath it, and on a fall running west is the
  // wrong column as well. The host has always read this off the source slot.
  let mat = i32(materialAt(src));
  let hiA = sheetLook(shownA, foamA, litA, brinkA, fromZ);
  let hiB = sheetLook(shownB, foamB, litB, brinkB, fromZ);
  let loA = sheetLook(shownA, foamA, litA, brinkA, toZ);
  let loB = sheetLook(shownB, foamB, litB, brinkB, toZ);
  let crestA = packed(hiA.shade, mat, hiA.cover);
  let crestB = packed(hiB.shade, mat, hiB.cover);
  let footA = packed(loA.shade, mat, loA.cover);
  let footB = packed(loB.shade, mat, loB.cover);

  let tax = ax + driftAt(axThrow, fromZ);
  let tay = ay + driftAt(ayThrow, fromZ);
  let tbx = bx + driftAt(bxThrow, fromZ);
  let tby = by + driftAt(byThrow, fromZ);
  let fax = ax + driftAt(axThrow, toZ);
  let fay = ay + driftAt(ayThrow, toZ);
  let fbx = bx + driftAt(bxThrow, toZ);
  let fby = by + driftAt(byThrow, toZ);

  let at = i32(atomicAdd(&counts[band], 1u));
  if (at >= cap()) { return; }
  var o = (band * cap() + at) * ${QUAD_WORDS};

  // PER INSTANCE, and laid out as three vec4s: the four corners' positions
  // and then their four colours. A quad is one instance of a four-vertex
  // geometry, so how many a band draws is its instance count — the one number
  // Pixi lets a mesh change per frame. @see createGpuFallLayer
  verts[o] = (tax - tay) * hw();
  verts[o + 1] = (tax + tay) * hh() - topZA * hu();
  verts[o + 2] = (tbx - tby) * hw();
  verts[o + 3] = (tbx + tby) * hh() - topZB * hu();
  verts[o + 4] = (fbx - fby) * hw();
  verts[o + 5] = (fbx + fby) * hh() - footZB * hu();
  verts[o + 6] = (fax - fay) * hw();
  verts[o + 7] = (fax + fay) * hh() - footZA * hu();
  verts[o + 8] = bitcast<f32>(crestA);
  verts[o + 9] = bitcast<f32>(crestB);
  verts[o + 10] = bitcast<f32>(footB);
  verts[o + 11] = bitcast<f32>(footA);
}
`;

export type SheetPass = {
  /**
   * Clear last frame's quads, then build this frame's.
   *
   * `lips` is how many the list could hold, which the host knows from the last
   * reduction. One invocation per lip per step and not one per EDGE per step:
   * the map has a hundred and thirty thousand edges and seven hundred lips, so
   * dispatching over the edges would be three million invocations to do five
   * thousand quads' worth of work. The shader still bounds itself by the
   * device's own count, so a host figure that is stale high costs empty
   * invocations and a stale low one simply draws fewer sheets for a frame.
   */
  encode: (enc: GPUCommandEncoder, s: GpuState, lips: number) => void;
  layout: GPUBindGroupLayout;
  /** Point it at the ramp it colours from. */
  bind: (tint: GPUTextureView) => void;
  /**
   * Hand each band's quads to the buffer that band's mesh draws.
   *
   * A COPY PER BAND, and it is not avoidable: WebGPU requires a vertex
   * attribute's offset to be less than its array stride, so a band cannot be a
   * slice of one buffer through an offset — 110592 into a stride of 48 is not
   * a pipeline, it is an invalid one, and an invalid pipeline takes the whole
   * render pass with it. What that looks like is an empty map with the frame
   * readout insisting it drew everything.
   *
   * Only as far as each band had quads LAST frame, padded, so this moves about
   * a quarter of a megabyte rather than the buffer's whole four and a half.
   */
  spill: (enc: GPUCommandEncoder, dests: readonly GPUBuffer[]) => void;
  /** How many quads each band holds, for the draw. */
  counts: GPUBuffer;
  /** What the pass wrote, before it was spilled per band. For a harness. */
  quads: GPUBuffer;
  /**
   * Copy the counts out, and hand back the last set that landed.
   *
   * A FRAME STALE, and safe in both directions because the vertex buffer is
   * cleared before it is filled. A count that is short of this frame's draws a
   * sheet a frame late, which nobody can see; one that is over draws slots
   * that were cleared, and four corners at the origin make no fragments.
   *
   * TWO CALLS, because the order matters: `copy` only ENCODES, and the map may
   * not be asked for until the buffer has been submitted — a buffer that is
   * mapped when a command buffer naming it is submitted takes the whole
   * submission with it, which is a frame of solver silently doing nothing.
   */
  copy: (enc: GPUCommandEncoder) => void;
  fetch: () => void;
  says: () => Uint32Array | null;
  say: (
    hw: number, hh: number, hu: number, scale: number,
    bands: number, cap: number, cpt: number, tilesHigh: number,
  ) => void;
  destroy: () => void;
};

export function createSheet(
  device: GPUDevice, bands: number, cap: number,
): SheetPass {
  const state = stateLayout(device);
  const layout = device.createBindGroupLayout({
    label: "sheet",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      {
        binding: 1, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 2, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 3, visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "float" },
      },
    ],
  });
  const pipeline = device.createComputePipeline({
    label: "sheet",
    layout: device.createPipelineLayout({ bindGroupLayouts: [state, layout] }),
    compute: {
      module: shaderModule(device, SHEET_WGSL, "sheet"),
      entryPoint: "main",
    },
  });
  const uniform = device.createBuffer({
    size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: "sheet say",
  });
  // THE PASS'S OWN TARGET, because the buffers the meshes draw cannot be one
  // buffer. @see spill
  const quads = device.createBuffer({
    size: bands * cap * QUAD_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      | GPUBufferUsage.COPY_DST,
    label: "sheet quads",
  });
  const counts = device.createBuffer({
    size: Math.max(16, bands * 4),
    // COPY_DST for the clear, which is a copy as far as the API is concerned.
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      | GPUBufferUsage.COPY_DST,
    label: "sheet counts",
  });
  const staging = device.createBuffer({
    size: Math.max(16, bands * 4),
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    label: "sheet counts back",
  });
  let group: GPUBindGroup | null = null;
  let busy = false;
  let dead = false;
  /** Whether a copy has been encoded and is waiting to be asked for. */
  let asked = false;
  let seen: Uint32Array | null = null;

  return {
    layout, counts, quads,
    copy: (enc) => {
      if (busy || dead) return;
      enc.copyBufferToBuffer(counts, 0, staging, 0, staging.size);
      asked = true;
    },
    fetch: () => {
      if (!asked || busy || dead) return;
      asked = false;
      busy = true;
      void staging.mapAsync(GPUMapMode.READ).then(() => {
        if (dead) return;
        const got = new Uint32Array(staging.getMappedRange());
        if (!seen || seen.length !== got.length) seen = new Uint32Array(got.length);
        seen.set(got);
        staging.unmap();
      }).catch(() => { /* destroyed mid-flight */ })
        .finally(() => { busy = false; });
    },
    says: () => seen,
    bind: (tint) => {
      group = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: quads } },
          { binding: 2, resource: { buffer: counts } },
          { binding: 3, resource: tint },
        ],
      });
    },
    say: (hw, hh, hu, scale, bandN, cap, cpt, tilesHigh) => {
      const buf = new ArrayBuffer(32);
      new Float32Array(buf, 0, 4).set([hw, hh, hu, scale]);
      new Int32Array(buf, 16, 4).set([bandN, cap, cpt, tilesHigh]);
      device.queue.writeBuffer(uniform, 0, buf);
    },
    spill: (enc, dests) => {
      const per = cap * QUAD_WORDS * 4;
      for (let b = 0; b < dests.length && b < bands; b++) {
        // PADDED, because the count is a frame old and this frame's band may
        // have grown. What is copied past its quads is what the clear left,
        // which draws nothing.
        const had = seen ? (seen[b] ?? 0) : cap;
        const want = Math.min(cap, had + 32);
        if (want <= 0) continue;
        enc.copyBufferToBuffer(quads, b * per, dests[b], 0, want * QUAD_WORDS * 4);
      }
    },
    encode: (enc, s, lips) => {
      if (!group) return;
      // CLEARED FIRST, BOTH OF THEM. A slot this frame does not reach still
      // holds last frame's quad, and last frame's quad is a real one — drawn
      // again it is a sheet hanging off a cliff that has stopped falling. A
      // cleared slot is four corners at the origin, which makes no fragments.
      enc.clearBuffer(quads);
      enc.clearBuffer(counts);
      const pass = enc.beginComputePass({ label: "sheet" });
      pass.setPipeline(pipeline);
      bindState(pass, s, state);
      pass.setBindGroup(1, group);
      pass.dispatchWorkgroups(
        Math.max(1, Math.ceil((lips * NAPPE_STEPS) / WORKGROUP)),
      );
      pass.end();
    },
    destroy: () => {
      dead = true;
      uniform.destroy();
      quads.destroy();
      counts.destroy();
      staging.destroy();
    },
  };
}

export const sheetSource = () => SHEET_WGSL;

import { FALL_STOP, LATCH_ROW } from "../../fluid/falls";
import { OPEN_SKY } from "../../fluid/slots";
import { flatIndexWgsl, groups1d, shaderModule } from "../../fluid/gpu/state";
import { stampsNow } from "../debug/gpu-stamps";
/**
 * WHICH QUADS ARE WORTH DRAWING, gathered once a frame.
 *
 * The water mesh emits five quads for every column of every band — three
 * hundred and twenty seven thousand a frame on a sixty four square map — and
 * about sixty five thousand of them draw anything. The rest collapse their
 * four corners onto a point, which makes no fragments and costs four vertex
 * invocations all the same. Timed on the device's own clocks, that is the
 * whole of the frame: the render pass is three milliseconds of having the
 * hundred and twenty seven draws at all plus eleven and a half PROPORTIONAL
 * to the quad count, against a third of a millisecond with the water hidden,
 * and quartering the pixels does not move it.
 *
 * So this walks the columns, asks {@link quadDraws} the same question the
 * vertex shader asks, and writes the ones that survive into a per-band list.
 * The band then draws that many instances instead of all of them.
 *
 * FROM THE TEXTURES, not from the solver's buffer, and that is what keeps the
 * rule single. `cornerRuleSource` and `quadRuleSource` are written against a
 * handful of functions — `inside`, `depthAt`, `groundAt`, `dryDepth`,
 * `fallMin` and the rest — and the vertex shader answers them from these same
 * textures: the depth and the ground, and since storeys and the fall latch,
 * the roof, the brink and `uFalling` beside them. Answering them from the
 * packed field instead would mean a second spelling of the rule and a second
 * answer to disagree with the first.
 *
 * THE ORDER IS WHATEVER THE ATOMIC GAVE OUT. Nothing downstream cares: a quad
 * carries its own column and part, so the list is a set and not a sequence.
 */
import { brinkRuleSource, cornerRuleSource } from "./corner-rule";
import { quadRuleSource } from "./quad-rule";
import { sheetGroupSource } from "./sheet-group";

const WORKGROUP = 64;

/**
 * Bands gathered beyond those on screen, above and below. A band's count
 * reaches its mesh a frame late, so one that scrolls in having not been
 * gathered would draw only its spare for a frame; this many bands is more
 * than a frame of any pan. @see roomFor
 */
export const BAND_MARGIN = 8;

/** Quads a column gets. The twin of `PARTS` in `water-gpu`. */
const PARTS = 5;

const QUADS_WGSL = (drawdown: number) => `
struct Say {
  dims: vec4<i32>,        // nx, ny, columns per tile, tiles high
  a: vec4<f32>,           // dryDepth, fallMin, faces on, slots
  b: vec4<f32>,           // brink texture filled, fall latch fresh, the screen's tx - ty from, to
  c: vec4<i32>,           // where the roofed tier's list begins (0: one tier), bands, zoomed out, culled to the screen
  d: vec4<i32>,           // the bands to gather, first and last, when culled; unused
};
@group(0) @binding(0) var<uniform> say : Say;
@group(0) @binding(1) var uDepth : texture_2d<f32>;
@group(0) @binding(2) var uGround : texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> list : array<u32>;
@group(0) @binding(4) var<storage, read_write> counts : array<atomic<u32>>;
// WHERE EACH BAND'S SLICE STARTS, and how long it is. The list used to be a
// rectangle with the widest band's stride, which is two copies of the map in a
// texture that can only address one. @see quadList
@group(0) @binding(5) var<storage, read> slice : array<vec2<u32>>;
// The underside of whatever is over a slot, or the open sky. See fluid/slots.
@group(0) @binding(6) var uRoof : texture_2d<f32>;
// How hard each slot is leaving, worked out once a frame. See brink-gpu.
@group(0) @binding(7) var uBrink : texture_2d<f32>;
// Which edges the solver says are falling. See water-gpu's latchAt.
@group(0) @binding(8) var uFalling : texture_2d<f32>;
// WHETHER EACH TILE IS ONE FLAT PIECE OF ONE SHEET, per storey, worked out
// by the tiles stage below and read by main. @see tiles
@group(0) @binding(9) var<storage, read_write> tileFlat : array<u32>;
// WHERE MAIN MARKS, at each quad's own index, for compact to squeeze into the
// list. Two buffers and not one, so the squeeze can run in parallel: in place,
// a thread writing its entries down the band would land on slots a thread
// before it had not read yet. @see compact
@group(0) @binding(10) var<storage, read_write> marks : array<u32>;

// NO BACKTICKS IN HERE — a backtick in a comment ends the template literal.

fn nx() -> i32 { return say.dims.x; }
fn ny() -> i32 { return say.dims.y; }
fn dryDepth() -> f32 { return say.a.x; }
fn fallMin() -> f32 { return say.a.y; }
fn fallStop() -> f32 { return ${FALL_STOP}.0; }
// How many STOREYS a column has, and where a storey's plane of rows begins.
// See water-gpu, where the layout is argued.
fn slots() -> i32 { return i32(say.a.w); }
fn slotRow(y: i32, a: i32) -> i32 { return a * ny() + y; }
fn inside(x: i32, y: i32) -> bool {
  return x >= 0 && y >= 0 && x < nx() && y < ny();
}
fn depthAt(x: i32, y: i32, a: i32) -> f32 {
  return textureLoad(uDepth, vec2<i32>(x, slotRow(y, a)), 0).r;
}
fn groundAt(x: i32, y: i32, a: i32) -> f32 {
  return textureLoad(uGround, vec2<i32>(x, slotRow(y, a)), 0).r;
}
fn roofAt(x: i32, y: i32, a: i32) -> f32 {
  return textureLoad(uRoof, vec2<i32>(x, slotRow(y, a)), 0).r;
}
// A corner's contributors as a bitmask — see water-gpu's twin, where the two
// spellings are argued. This pass shares the corner rule with the vertex
// shader and so has to group water exactly as it does. @see render/sheet-group
// IS THERE WATER HERE. One spelling of the one threshold, because there used
// to be several and they drifted: a run at moving the cutoff changed some of
// them and not the others, and what that made was a column feeding a corner's
// HEIGHT but not its alpha — a hole with extra steps, on the device only, that
// the mesh builder could not reproduce. @see wetRule
fn wet(d: f32) -> bool { return d > dryDepth(); }
fn bitOf(k: i32) -> i32 { return 1i << u32(k); }
fn bitAt(m: i32, k: i32) -> i32 { return (m >> u32(k)) & 1; }
fn brinkOn() -> bool { return say.b.x > 0.5; }
// Whether the solver's latch says this edge is already falling — water-gpu's
// twin, where the packing and the fallback are argued. This pass groups water
// exactly as the vertex shader does, so it has to ask the same bar.
fn latchAt(x: i32, y: i32, axis: i32, a: i32, b: i32) -> bool {
  if (say.b.y < 0.5) { return false; }
  let k = ((a * slots() + b) * nx() * ny() + y * nx() + x) * 2 + axis;
  return textureLoad(uFalling, vec2<i32>(k % ${LATCH_ROW}, k / ${LATCH_ROW}), 0).r > 0.0;
}

${brinkRuleSource("wgsl")}
// Read where the brink pass has been, run where it has not — this pass shares
// the corner rule with the vertex shader and has to answer it the same way.
// @see brink-gpu
fn atBrink(cx: i32, cy: i32, a: i32) -> f32 {
  if (brinkOn()) { return textureLoad(uBrink, vec2<i32>(cx, slotRow(cy, a)), 0).r; }
  return brinkCalc(cx, cy, a);
}
${sheetGroupSource("wgsl")}
${cornerRuleSource("wgsl", drawdown)}
${quadRuleSource("wgsl")}

@compute @workgroup_size(${WORKGROUP})
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) nwg: vec3<u32>,
) {
  // FLAT OVER TWO DIMENSIONS where one cannot hold the quads. @see groups1d
  let n = ${flatIndexWgsl(WORKGROUP)};
  let L = slots();
  let cells = nx() * ny();
  if (n >= cells * ${PARTS} * L) { return; }
  // A PART, A STOREY AND A COLUMN, unpacked exactly as the vertex shader
  // packs it — see water-gpu's mainVertex. The two have to agree to the
  // number or this pass hands the mesh the id of a different quad.
  let part = n % ${PARTS};
  let cell = n / ${PARTS};
  let a = cell % L;
  let i = cell / L;
  let cx = i % nx();
  let cy = i / nx();

  // EVERY CHEAP NO BEFORE THE DEAR ONE. quadDraws runs the corner rule four
  // times for a side face, and this asked it of every quad on the map before
  // asking whether the quad was on screen, or was a zoomed-out tile's fifteen
  // surfaces that are thrown away regardless. On a flooded 204 tile map that
  // was 53 ms a frame. Each test below is the same test it was, moved ahead.
  //
  // WHICH BAND, AND WHICH QUAD OF IT. Both are the vertex shader's own
  // arithmetic run backwards: a band is the diagonal the tile sits on, and a
  // quad is its tile's place along that diagonal, then the column within the
  // tile, then the part.
  let cpt = say.dims.z;
  let tx = cx / cpt;
  let ty = cy / cpt;
  let band = tx + ty;
  // ABOVE AND BELOW THE SCREEN. The bands there are not drawn, so their quads
  // are not wanted — with a margin, because a band's count reaches its mesh a
  // frame late, and one that scrolls in ungathered would draw short. @see
  // BAND_MARGIN
  if (say.c.w > 0 && (band < say.d.x || band > say.d.y)) { return; }
  let tx0 = max(0, band - (say.dims.w - 1));
  let tileIdx = tx - tx0;
  let sub = (cy % cpt) * cpt + (cx % cpt);
  // PART OUTSIDE STOREY, which is the vertex shader's packing and, because a
  // band draws its list in order, the painter's order too. @see water-gpu
  let quad = ((tileIdx * cpt * cpt + sub) * ${PARTS} + part) * L + a;

  let here = slice[band];
  if (quad >= i32(here.y)) { return; }
  // OFF THE SIDES OF THE SCREEN. A band is a diagonal of the map and the
  // camera culls whole bands above and below it — but a visible band on a big
  // map runs the map's whole width, and a tile's x on screen is tx - ty and
  // nothing else, whatever its height. @see cullFor
  if (say.c.w > 0) {
    let across = f32(tx - ty);
    if (across < say.b.z || across > say.b.w) { return; }
  }
  // ZOOMED OUT, A FLAT TILE IS ONE QUAD. Its first column's surface stands
  // for all sixteen, marked so the vertex shader spans the tile; the other
  // fifteen surfaces are not drawn. @see tiles, water-gpu's tileQuad
  var whole = 0u;
  if (say.c.z > 0 && part == 2) {
    let tw = nx() / cpt;
    if (tileFlat[(ty * tw + tx) * L + a] == 1u) {
      if (sub != 0) { return; }
      whole = 1u;
    }
  }
  if (!quadDraws(cx, cy, part, cpt, say.a.z > 0.5, a)) { return; }
  // WHICH TIER DRAWS IT, asked exactly as the vertex shader's gate asks it:
  // of the column the quad HANGS OFF, which for a far-edge face is the column
  // behind. Marked in the top bit, and sorted into the roofed tier's own list
  // by compact, so neither tier's mesh runs a vertex shader on a quad only to
  // throw it away. @see QuadList.second, water-gpu's roofedTier
  var roofed = 0u;
  if (say.c.x > 0) {
    let back = part <= 1;
    let ocx = cx - select(0, select(0, 1, part == 0), back);
    let ocy = cy - select(0, select(1, 0, part == 0), back);
    if (inside(ocx, ocy) && roofAt(ocx, ocy, a) < ${OPEN_SKY}.0) { roofed = 1u; }
  }
  // AT ITS OWN INDEX, not at the next free slot.
  //
  // This used to claim a slot with an atomicAdd, which is the obvious way to
  // compact a list and is WRONG HERE, because the order threads arrive in is
  // not the order anything else in this system uses. The water is translucent,
  // so two quads that overlap blend differently depending on which is drawn
  // first — and with an atomic the permutation is fresh every frame. Read the
  // list back twice on a scene with the clock STOPPED and 13,826 of its 14,258
  // filled slots hold a different quad the second time, in pairwise swaps. On
  // screen that is a faint shimmer along the overlaps that never settles, and
  // it is why the pixel comparison could not be made to pass with the
  // gathering on: 47 pixels one run, 78 the next, against nought for the
  // ungathered identity order.
  //
  // So the mark goes at the quad's own place and compact() squeezes the gaps
  // out IN ORDER, which is the order the mesh builder pushes its quads in and
  // the order the ungathered path draws them in. @see compact
  //
  // STORED ONE HIGHER, so that a slot nothing marked reads as empty rather
  // than as quad nought. @see quadCap
  marks[here.x + u32(quad)] = u32(quad + 1) | (roofed << 31u) | (whole << 30u);
}

// ONE THREAD PER TILE PER STOREY: whether all sixteen of its columns are one
// flat piece of one sheet, so that zoomed out, where a column is a pixel or
// less, the tile can be drawn as a single quad. Every column shows; all are
// in the same tier; and every pair of neighbours inside the tile is joined
// with no fall between them — the corner rule's own tests. A tile with a
// shore, a lip or a roof edge in it is drawn column by column as ever.
// @see water-gpu's LOD_TILE_PX
@compute @workgroup_size(${WORKGROUP})
fn tiles(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) nwg: vec3<u32>,
) {
  let n = ${flatIndexWgsl(WORKGROUP)};
  let L = slots();
  let cpt = say.dims.z;
  let tw = nx() / cpt;
  let th = ny() / cpt;
  if (n >= tw * th * L) { return; }
  let a = n % L;
  let t = n / L;
  let x0 = (t % tw) * cpt;
  let y0 = (t / tw) * cpt;
  var flat = 1u;
  let roofed = roofAt(x0, y0, a) < ${OPEN_SKY}.0;
  for (var k = 0; k < cpt * cpt; k = k + 1) {
    let x = x0 + k % cpt;
    let y = y0 + k / cpt;
    let d = depthAt(x, y, a);
    let g = groundAt(x, y, a);
    let r = roofAt(x, y, a);
    if (!(wet(d) && g + d < r) || (r < ${OPEN_SKY}.0) != roofed) { flat = 0u; break; }
    // East and south, inside the tile.
    for (var e = 0; e < 2; e = e + 1) {
      let jx = x + select(0, 1, e == 0);
      let jy = y + select(1, 0, e == 0);
      if (jx >= x0 + cpt || jy >= y0 + cpt) { continue; }
      let dj = depthAt(jx, jy, a);
      let gj = groundAt(jx, jy, a);
      let rj = roofAt(jx, jy, a);
      if (min(r, rj) <= max(g, gj)) { flat = 0u; break; }
      let drop = max(g - min(gj + dj, rj), gj - min(g + d, r));
      if (drop >= fallStop()) { flat = 0u; break; }
    }
    if (flat == 0u) { break; }
  }
  tileFlat[n] = flat;
}

// A WORKGROUP PER BAND, squeezing that band's marks down to the front of its
// stretch of the list, in order.
//
// It was ONE THREAD per band walking the band's whole range, which its own
// note said would want revisiting on a bigger map: 127 threads each looping
// through ten thousand slots, and then again zeroing the tail, cost 1.6 ms a
// frame on a 64 tile map — more than the rest of the solver put together, and
// unseen, because this pass was the one nobody had put a timestamp on.
//
// Now each of the 64 threads takes a contiguous chunk of the band, counts the
// marks in it, the counts are summed into offsets in workgroup memory, and
// each thread writes its chunk's entries from its offset. Contiguous chunks
// and an ordered sum, so the list comes out in exactly the order the serial
// walk made — which matters, because the water is translucent and two quads
// that overlap blend by which is drawn first. @see main
//
// Out of marks and into list, both cleared before the gathering, so the
// tail past the count is nought already and nothing has to be zeroed.
var<workgroup> openFrom : array<u32, ${WORKGROUP}>;
var<workgroup> roofFrom : array<u32, ${WORKGROUP}>;
var<workgroup> openN : u32;
var<workgroup> roofN : u32;

@compute @workgroup_size(${WORKGROUP})
fn compact(
  @builtin(workgroup_id) wid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
) {
  let band = i32(wid.x);
  if (band >= i32(arrayLength(&slice))) { return; }
  let here = slice[band];
  let cap = i32(here.y);
  let t = i32(lid.x);
  let per = (cap + ${WORKGROUP - 1}) / ${WORKGROUP};
  let s0 = min(cap, t * per);
  let s1 = min(cap, s0 + per);
  // THE ROOFED ONES TO THEIR OWN LIST, in the same order, and the rest to the
  // front of this one. @see QuadList.second
  let second = u32(max(say.c.x, 0));
  var o = 0u;
  var r = 0u;
  for (var k = s0; k < s1; k = k + 1) {
    let v = marks[here.x + u32(k)];
    if (v == 0u) { continue; }
    if ((v >> 31u) == 1u) { r = r + 1u; } else { o = o + 1u; }
  }
  openFrom[t] = o;
  roofFrom[t] = r;
  workgroupBarrier();
  // Sixty four numbers: summed by one thread, which is nothing beside a band.
  if (t == 0) {
    var so = 0u;
    var sr = 0u;
    for (var j = 0; j < ${WORKGROUP}; j = j + 1) {
      let a = openFrom[j];
      let b = roofFrom[j];
      openFrom[j] = so;
      roofFrom[j] = sr;
      so = so + a;
      sr = sr + b;
    }
    openN = so;
    roofN = sr;
  }
  workgroupBarrier();
  var w = openFrom[t];
  var rr = roofFrom[t];
  for (var k = s0; k < s1; k = k + 1) {
    let v = marks[here.x + u32(k)];
    if (v == 0u) { continue; }
    let id = v & 0x7fffffffu;
    if ((v >> 31u) == 1u) {
      list[second + here.x + rr] = id;
      rr = rr + 1u;
    } else {
      list[here.x + w] = id;
      w = w + 1u;
    }
  }
  if (t == 0) {
    atomicStore(&counts[band], openN);
    if (second > 0u) { atomicStore(&counts[say.c.y + band], roofN); }
  }
}
`;

export type QuadsPass = {
  /** Clear last frame's list, then gather this one's. */
  encode: (enc: GPUCommandEncoder, cells: number) => void;
  layout: GPUBindGroupLayout;
  bind: (
    depth: GPUTextureView, ground: GPUTextureView, roof: GPUTextureView,
    brink: GPUTextureView, falling: GPUTextureView,
  ) => void;
  /** Where the ids go, for the copy into the shader's texture. */
  list: GPUBuffer;
  counts: GPUBuffer;
  say: (
    nx: number, ny: number, cpt: number, tilesHigh: number,
    dryDepth: number, fallMin: number, faces: boolean, slots: number,
    brinkOn: boolean, latchOn: boolean, zoomedOut: boolean,
    cull: { from: number; to: number; lo?: number; hi?: number } | null,
  ) => void;
  destroy: () => void;
};

/** Offset and length per band, as the shader wants them. @see quadList */
export type Slices = { offsets: Uint32Array; caps: Uint32Array; total: number; second: number };

export function createQuadsPass(
  device: GPUDevice, slices: Slices, slots: number, drawdown: number, tiles: number,
): QuadsPass {
  const bands = slices.caps.length;
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      {
        binding: 1, visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
      },
      {
        binding: 2, visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
      },
      {
        binding: 3, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 4, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 5, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 6, visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
      },
      {
        binding: 7, visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
      },
      {
        binding: 8, visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
      },
      {
        binding: 9, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 10, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ],
  });
  const module = shaderModule(device, QUADS_WGSL(drawdown), "quads");
  // WHAT THE COMPILER ACTUALLY SAID, because the alternative is what it says
  // at the other end: "invalid due to a previous error", on the pipeline, once
  // a frame, with no line and no reason. A module that will not compile takes
  // the gathering with it, and a gathering that produces nothing is a map with
  // no water on it — which is how this was found rather than reported.
  void module.getCompilationInfo?.().then((info) => {
    for (const m of info.messages) {
      if (m.type === "info") continue;
      console.error(`WATER: the gathering shader, line ${m.lineNum}: ${m.message}`);
    }
  }).catch(() => { /* older implementations have no compilation info */ });
  const pipes = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipeline = device.createComputePipeline({
    label: "quads", layout: pipes, compute: { module, entryPoint: "main" },
  });
  // And the squeeze, which shares the bind group and touches only the buffers.
  // And the tile test, which main reads and so must run first. @see tiles
  const tileTest = device.createComputePipeline({
    label: "quads tiles", layout: pipes,
    compute: { module, entryPoint: "tiles" },
  });
  const squeeze = device.createComputePipeline({
    label: "quads compact", layout: pipes,
    compute: { module, entryPoint: "compact" },
  });
  const uniform = device.createBuffer({
    size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: "quads say",
  });
  const list = device.createBuffer({
    // As long as the TEXTURE is, not as long as the quads are: the copy out
    // moves whole rows, so the last row has to exist even where nothing in the
    // map reaches it.
    size: slots * 4,
    // COPY_DST is for the CLEAR, which is a copy as far as the API is
    // concerned — without it the clear is invalid, and an invalid command
    // takes the whole command buffer with it: no gathering, no copy, and a
    // map with no water on it and nothing in the console.
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      | GPUBufferUsage.COPY_DST,
    label: "quad list",
  });
  // WHERE MAIN MARKS, for compact to squeeze into `list`. @see compact
  const marks = device.createBuffer({
    size: slots * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label: "quad marks",
  });
  // A COUNT PER BAND PER TIER. @see QuadList.second
  const tiers = slices.second ? 2 : 1;
  const counts = device.createBuffer({
    size: Math.max(16, bands * tiers * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      | GPUBufferUsage.COPY_DST,
    label: "quad counts",
  });
  // A word per tile per storey. @see tiles
  const tileFlat = device.createBuffer({
    size: Math.max(16, tiles * 4),
    usage: GPUBufferUsage.STORAGE,
    label: "quad tiles",
  });
  // The layout, uploaded once: it is a function of the map's shape and the map
  // is rebuilt rather than resized.
  const slice = device.createBuffer({
    size: Math.max(16, bands * 8),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label: "quad list slices",
  });
  {
    const pairs = new Uint32Array(bands * 2);
    for (let b = 0; b < bands; b++) {
      pairs[b * 2] = slices.offsets[b];
      pairs[b * 2 + 1] = slices.caps[b];
    }
    device.queue.writeBuffer(slice, 0, pairs);
  }

  let group: GPUBindGroup | null = null;
  /**
   * Frames still to be checked for validation errors.
   *
   * The same guard the solver's frame carries and for the same reason: a
   * command this pass gets wrong does not throw and does not draw wrong, it
   * poisons the encoder and the whole buffer is dropped. What that looks like
   * is a map with no water on it and an empty console. It cost a clear that
   * wanted a usage flag it had not been given.
   */
  let watch = 4;

  return {
    layout, list, counts,

    bind: (depth, ground, roof, brink, falling) => {
      // ONCE PER TEXTURE PAIR, not once per dispatch. The pair only changes
      // when the scene is rebuilt.
      group = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: depth },
          { binding: 2, resource: ground },
          { binding: 3, resource: { buffer: list } },
          { binding: 4, resource: { buffer: counts } },
          { binding: 5, resource: { buffer: slice } },
          { binding: 6, resource: roof },
          { binding: 7, resource: brink },
          { binding: 8, resource: falling },
          { binding: 9, resource: { buffer: tileFlat } },
          { binding: 10, resource: { buffer: marks } },
        ],
      });
    },
    say: (nx, ny, cpt, tilesHigh, dryDepth, fallMin, faces, slots, brinkOn, latchOn, zoomedOut, cull) => {
      const buf = new ArrayBuffer(80);
      new Int32Array(buf, 0, 4).set([nx, ny, cpt, tilesHigh]);
      // The fourth was the cap, which is per band now and comes from `slice`.
      new Float32Array(buf, 16, 4).set([dryDepth, fallMin, faces ? 1 : 0, slots]);
      new Float32Array(buf, 32, 4).set([
        brinkOn ? 1 : 0, latchOn ? 1 : 0, cull?.from ?? 0, cull?.to ?? 0,
      ]);
      new Int32Array(buf, 48, 4).set([slices.second, bands, zoomedOut ? 1 : 0, cull ? 1 : 0]);
      // Gathered a margin beyond the bands on screen. @see BAND_MARGIN
      new Int32Array(buf, 64, 4).set([
        (cull?.lo ?? 0) - BAND_MARGIN, (cull?.hi ?? bands) + BAND_MARGIN, 0, 0,
      ]);
      device.queue.writeBuffer(uniform, 0, buf);
    },
    encode: (enc, cells) => {
      if (!group) return;
      watch = Math.max(0, watch - 1);
      // CLEARED FIRST, and both of them. A slot the gathering does not reach
      // this frame still holds what it held last frame, and last frame's quad
      // is a real quad: drawn again it is water that is not there.
      enc.clearBuffer(marks);
      enc.clearBuffer(list);
      enc.clearBuffer(counts);
      // THREE PASSES, EACH TIMED, where there was one untimed: the gathering
      // was the one GPU pass nobody had put a timestamp on, and it was the
      // most expensive thing in the frame — 54 ms of it on a flooded 204 tile
      // map. Separate passes so each stage says what it costs; a pass
      // boundary orders the three as the dispatches in one pass did.
      const begin = (label: string) => {
        const writes = stampsNow()?.take(label);
        const p = enc.beginComputePass(writes ? { label, timestampWrites: writes } : { label });
        p.setBindGroup(0, group);
        return p;
      };
      // THE TILES FIRST, which main reads. @see tiles
      let pass = begin("quads:tiles");
      pass.setPipeline(tileTest);
      pass.dispatchWorkgroups(...groups1d(tiles, WORKGROUP));
      pass.end();
      pass = begin("quads:main");
      pass.setPipeline(pipeline);
      pass.dispatchWorkgroups(...groups1d(cells * PARTS, WORKGROUP));
      pass.end();
      // THEN THE SQUEEZE, which must see all of main. @see compact
      pass = begin("quads:compact");
      pass.setPipeline(squeeze);
      pass.dispatchWorkgroups(bands);
      pass.end();
    },
    destroy: () => {
      uniform.destroy(); list.destroy(); counts.destroy(); slice.destroy(); tileFlat.destroy();
      marks.destroy();
    },
  };
}

export const quadsSource = (drawdown = 0) => QUADS_WGSL(drawdown);

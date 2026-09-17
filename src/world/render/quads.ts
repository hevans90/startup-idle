/**
 * World v2 — a growable batch of flat-shaded quads, drawn as one mesh.
 *
 * `Graphics` was the obvious way to draw the water surface and the wrong one.
 * Its cost is not the triangles, it is REBUILDING: every frame each strip's
 * instruction list is walked, every polygon tessellated, its bounds recomputed
 * and a fresh geometry uploaded. Measured, a flooded map spent 100ms a frame in
 * there while the solver behind it took 1.5ms — and the cost barely moved
 * between 648 quads and 2564, which is the signature of per-rebuild overhead
 * rather than per-triangle work.
 *
 * A quad batch writes vertices straight into one interleaved buffer and hands
 * the GPU the bytes it filled. There is no tessellation, because a quad is two
 * triangles and we already know which two; there is no instruction list; and
 * the buffer is allocated once and grown by doubling, so a surface that has
 * settled allocates nothing at all.
 *
 * Vertices carry a position and a colour and nothing else. There is no texture:
 * the water's whole look is in the colours its mesh builder works out per quad.
 */
import { Buffer, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh, Shader } from "pixi.js";
import type { Container } from "pixi.js";

/** Floats per vertex: x, y, and the colour bit-cast into the third. */
const WORDS = 3;
/** Vertices per quad. */
const VERTS = 4;
/** Indices per quad — two triangles round the same four corners. */
const IDX = 6;
/** Bytes per vertex. */
const STRIDE = WORDS * 4;

/**
 * Pack a `0xRRGGBB` colour and a straight alpha into one vertex word.
 *
 * Byte order is ABGR because that is what `unorm8x4` reads off a little-endian
 * word, and it is the order Pixi's own batcher packs its tints in.
 */
export const rgba = (colour: number, alpha: number): number =>
  ((packAlpha(alpha) << 24 | packRGB(colour)) >>> 0);

/**
 * The colour half of a vertex word, with the alpha byte left at zero.
 *
 * Split out because a quad's colour is one calculation but its four corners
 * each carry their own alpha: this way the colour is worked out once and the
 * corners cost an OR apiece.
 */
export const packRGB = (colour: number): number =>
  (((colour & 0xff) << 16) | (colour & 0xff00) | ((colour >> 16) & 0xff)) >>> 0;

/** The alpha byte, clamped rather than wrapped. */
export const packAlpha = (alpha: number): number =>
  Math.max(0, Math.min(255, Math.round(alpha * 255)));

export type QuadBatch = {
  // The generic arguments matter: the default `Mesh` is a textured one, and
  // this one carries a bare geometry and the flat shader below.
  mesh: Mesh<Geometry, Shader>;
  geometry: Geometry;
  vertices: Buffer;
  indices: Buffer;
  /** The vertex data. `u32` is the same memory, for writing packed colours. */
  f32: Float32Array;
  u32: Uint32Array;
  /** Capacity, in quads. */
  cap: number;
  /** Quads written so far this frame. */
  n: number;
  /** Quads the GPU is currently holding, so a shrink knows what to blank. */
  drawn: number;
};

/**
 * The one shader every batch draws with.
 *
 * Shared deliberately: Pixi's mesh adaptor rebinds the per-mesh uniforms
 * immediately before each draw, so a single shader across every band costs one
 * compile instead of a hundred and twenty-seven.
 *
 * The uniform blocks are not ours to name. `globalUniforms` at group 0 and
 * `localUniforms` at group 1 are what the renderer looks for when it decides
 * whether it can bind them for us, and the field order has to match the layout
 * the renderer writes. Alpha arrives straight and leaves premultiplied, because
 * that is how everything else in the scene is blended.
 */
const VERTEX_WGSL = /* wgsl */ `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};
@group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
};
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vColor: vec4<f32>,
};

@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
  @location(1) aColor: vec4<f32>,
) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix
          * globalUniforms.uWorldTransformMatrix
          * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  var out: VSOutput;
  out.position = vec4<f32>(clip.xy, 0.0, 1.0);
  out.vColor = vec4<f32>(aColor.rgb * aColor.a, aColor.a)
             * localUniforms.uColor
             * globalUniforms.uWorldColorAlpha;
  return out;
}
`;

const FRAGMENT_WGSL = /* wgsl */ `
@fragment
fn mainFragment(@location(0) vColor: vec4<f32>) -> @location(0) vec4<f32> {
  return vColor;
}
`;

/** The same again for WebGL, which the renderer falls back to. */
const VERTEX_GLSL = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec4 aColor;
out vec4 vColor;

// PLAIN uniforms, not a block. Pixi hands the globals to a WebGL program one
// at a time — its own shaders are built that way, in globalUniformsBitGl — and
// the block form is only ever used where it binds a buffer to match. Declared
// as a block here, nothing binds it: the driver says "used but unbound uniform
// buffer" and drops the draw, which is water that does not appear at all on
// WebGL while looking perfect on WebGPU.
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;

uniform mat3 uTransformMatrix;
uniform vec4 uColor;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor * uWorldColorAlpha;
}
`;

const FRAGMENT_GLSL = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 finalColor;

void main() {
  finalColor = vColor;
}
`;

let shared: Shader | null = null;

function quadShader(): Shader {
  if (shared) return shared;
  shared = new Shader({
    gpuProgram: GpuProgram.from({
      vertex: { source: VERTEX_WGSL, entryPoint: "mainVertex" },
      fragment: { source: FRAGMENT_WGSL, entryPoint: "mainFragment" },
      name: "flat-quads",
    }),
    glProgram: GlProgram.from({
      vertex: VERTEX_GLSL,
      fragment: FRAGMENT_GLSL,
      name: "flat-quads",
    }),
  });
  return shared;
}

/** Two triangles per quad, round its four corners. Never changes. */
function fillIndices(idx: Uint32Array, from: number, cap: number) {
  for (let q = from; q < cap; q++) {
    const v = q * VERTS, o = q * IDX;
    idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
    idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
  }
}

export function createQuadBatch(parent: Container, cap = 16): QuadBatch {
  const f32 = new Float32Array(cap * VERTS * WORDS);
  const idx = new Uint32Array(cap * IDX);
  fillIndices(idx, 0, cap);

  const vertices = new Buffer({ data: f32, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
  const indices = new Buffer({ data: idx, usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 0 },
      aColor: { buffer: vertices, format: "unorm8x4", stride: STRIDE, offset: 8 },
    },
    indexBuffer: indices,
  });
  const mesh = new Mesh({ geometry, shader: quadShader() });
  // Nothing here is ever hit-tested, and nothing here is visible until the
  // first quad lands in it.
  mesh.eventMode = "none";
  mesh.visible = false;
  parent.addChild(mesh);

  return { mesh, geometry, vertices, indices, f32, u32: new Uint32Array(f32.buffer), cap, n: 0, drawn: 0 };
}

export function destroyQuadBatch(b: QuadBatch) {
  b.mesh.parent?.removeChild(b.mesh);
  // Not the shader: it is shared, and outlives any one batch.
  b.mesh.destroy({ children: true });
  b.geometry.destroy(true);
}

/** Double until it fits, keeping what is already written. */
function grow(b: QuadBatch, need: number) {
  let cap = b.cap;
  while (cap < need) cap *= 2;
  const f32 = new Float32Array(cap * VERTS * WORDS);
  f32.set(b.f32);
  const idx = new Uint32Array(cap * IDX);
  fillIndices(idx, 0, cap);
  b.f32 = f32;
  b.u32 = new Uint32Array(f32.buffer);
  b.cap = cap;
  // Assigning `data` is the resize: the GPU buffer is reallocated and the
  // whole thing re-uploaded, which is why capacity only ever goes up.
  b.vertices.data = f32;
  b.indices.data = idx;
}

/** Start the frame. The quads already there stay until they are overwritten. */
export const resetQuads = (b: QuadBatch) => { b.n = 0; };

/**
 * Add one quad, corners in order round its edge, each with its own colour.
 *
 * A colour PER CORNER because the rasteriser interpolates between them for
 * free, and one colour for the whole quad is what makes a surface look like
 * tiles: every quad boundary becomes a hard edge wherever the shading varies
 * across the surface at all. Pass the same colour four times for a flat one.
 *
 * Coordinates and colours go in as plain numbers rather than points or arrays
 * because this is called once per wet column per frame, and the last version of
 * this code spent more time on the garbage than on the geometry.
 */
export function pushQuad(
  b: QuadBatch,
  x0: number, y0: number, c0: number,
  x1: number, y1: number, c1: number,
  x2: number, y2: number, c2: number,
  x3: number, y3: number, c3: number,
) {
  if (b.n >= b.cap) grow(b, b.n + 1);
  const { f32, u32 } = b;
  let o = b.n * VERTS * WORDS;
  f32[o] = x0; f32[o + 1] = y0; u32[o + 2] = c0;
  o += WORDS;
  f32[o] = x1; f32[o + 1] = y1; u32[o + 2] = c1;
  o += WORDS;
  f32[o] = x2; f32[o + 1] = y2; u32[o + 2] = c2;
  o += WORDS;
  f32[o] = x3; f32[o + 1] = y3; u32[o + 2] = c3;
  b.n++;
}

/**
 * Hand the frame's vertices to the GPU.
 *
 * Only the bytes actually written are uploaded, so a puddle costs a puddle's
 * worth of traffic on a buffer sized for a lake. Quads that were drawn last
 * frame and are not drawn this one are collapsed to a point first — the index
 * buffer covers the whole capacity, so anything left behind would keep drawing.
 */
export function uploadQuads(b: QuadBatch) {
  for (let q = b.n; q < b.drawn; q++) {
    const o = q * VERTS * WORDS;
    b.f32.fill(0, o, o + VERTS * WORDS);
  }
  const used = Math.max(b.n, b.drawn);
  b.drawn = b.n;
  if (used) b.vertices.update(used * VERTS * STRIDE);
  const show = b.n > 0;
  // Only on a change: visibility is structural, and flipping it every frame
  // makes the renderer rebuild the scene's instruction list every frame.
  if (b.mesh.visible !== show) b.mesh.visible = show;
}

/** The quads a batch holds, as flat `[x, y, x, y, x, y, x, y]` — for tests. */
export function quadAt(b: QuadBatch, q: number): number[] {
  const out: number[] = [];
  for (let v = 0; v < VERTS; v++) {
    const o = (q * VERTS + v) * WORDS;
    out.push(b.f32[o], b.f32[o + 1]);
  }
  return out;
}

/** The packed colour of a quad's corner — for tests. */
export const colourAt = (b: QuadBatch, q: number, corner = 0): number =>
  b.u32[(q * VERTS + corner) * WORDS + 2];

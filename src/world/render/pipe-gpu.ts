/**
 * World v2 — THE MAINS' SHADER: a pipe mesh lit by the town's sun. @see pipe-mesh
 *
 * The light is the Kenney pack's: from above and a little to the left of
 * the camera, so a box's top is brightest, its left face (+v) next, its right
 * (+u) darkest — and a tube lying either way is lit the same way round.
 *
 * Shaded in THREE TONES, as the buildings are — lit, half, shade — with
 * the steps softened over a pixel or so, not blended smoothly as a render
 * would be; a narrow line of shine where the sun glints; and the tube's edge,
 * where it turns away from the camera, darkened to an outline.
 *
 * The uniform blocks follow quads.ts, which explains why they look the way
 * they do on each path.
 */
import { Buffer, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh, Shader } from "pixi.js";

import { HH, HW } from "../iso";
import { liveSource, LIVE_WIDE } from "./pipe-live";
import { LIVE_BASE, SUN, WORDS, type PipeMesh } from "./pipe-mesh";

/**
 * Up the screen, square to the line of sight: the shine runs where a tube's
 * surface faces it — along the top of a tube lying either way alike, which a
 * true glint from the sun would not do.
 */
const UP = [-0.5 * (HH / HW) * Math.SQRT2, -0.5 * (HH / HW) * Math.SQRT2, Math.sqrt(1 - (HH / HW) ** 2)];
const VIEW = [Math.sqrt(1 - (HH / HW) ** 2) * Math.SQRT1_2, Math.sqrt(1 - (HH / HW) ** 2) * Math.SQRT1_2, HH / HW];

const v3 = (a: readonly number[]) => a.map((c) => c.toFixed(5)).join(", ");

/** A colour as a shader's vector. */
const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((k) => (k / 255).toFixed(4)).join(", ");
/** Rust, on cast iron; mortar, between bricks; the flow's chevrons, on a trunk. */
const RUST = 0x8a4a2a, MORTAR = 0xb9ab98, CHEVRON = 0xf0d2a8;
/** What stands in a trunk, drawn on its tube up to how full it is. */
const STANDING = 0x3d2a14;
/** A cast iron pipe's length and a steel one's, tiles; a brick's course and its length, tiles; a concrete pour's height. */
export const IRON_LENGTH = 1, STEEL_LENGTH = 2, COURSE = 0.045, BRICK_LONG = 0.11, POUR = 0.12;

/**
 * WHAT IT IS MADE OF, drawn from where on the piece the pixel is. @see MATERIAL
 *
 * FLAT, like everything else here: every mark is a step, softened a pixel,
 * and changes the colour or the tone by one fixed amount — never a gradient.
 * AND IT GOES AWAY ZOOMED OUT: `fine` falls to nought as a pipe length shrinks
 * toward a few pixels, where a joint line a third of a pixel wide would
 * otherwise crawl as the camera moves.
 *
 * The same lines in both dialects but for their types: every `let` here is a
 * number, but for the names the GLSL is told are vectors.
 */
const detail = (vec3: string) => `
  let al = vMat.x;
  let ac = vMat.y;
  let fine = 1.0 - smoothstep(0.03, 0.09, fwidth(al));
  let trunk = step(4.5, mz);
  let iron = (step(0.5, mz) * step(mz, 1.5) + trunk) * fine;
  let steel = step(1.5, mz) * step(mz, 2.5) * fine;
  let concrete = step(2.5, mz) * step(mz, 3.5) * fine;
  let brick = step(3.5, mz) * step(mz, 4.5) * fine;
  let top = dot(n, ${vec3}(${v3(UP)}));
  let under = 1.0 - smoothstep(-0.15, 0.25, n.z);

  // CAST IRON: a joint line each length; a casting seam along it; rust blooming down from the joints.
  let ij = abs(fract(al / ${IRON_LENGTH.toFixed(1)} + 0.5) - 0.5) * ${IRON_LENGTH.toFixed(1)};
  let ironJoint = 1.0 - smoothstep(0.010, 0.018, ij);
  let ironSeam = 1.0 - smoothstep(0.012, 0.03, abs(top - 0.72));
  let bloom = fract(sin((floor(al / ${IRON_LENGTH.toFixed(1)} + 0.5) * 7.0 + floor(ac * 7.0)) * 12.9898) * 43758.5453);
  let rust = step(0.5, (1.0 - smoothstep(0.02, 0.16, ij)) * (0.35 + under) * (0.5 + bloom));

  // STEEL: a weld bead each length; a faint seam winding round it; scuffs along the top; a stain under each weld.
  let sj = abs(fract(al / ${STEEL_LENGTH.toFixed(1)} + 0.5) - 0.5) * ${STEEL_LENGTH.toFixed(1)};
  let bead = 1.0 - smoothstep(0.008, 0.016, sj);
  let spiral = 1.0 - smoothstep(0.02, 0.05, abs(fract(al * 1.5 + ac) - 0.5));
  let scuffAt = fract(sin((floor(al * 9.0) * 3.0 + floor(ac * 6.0)) * 78.233) * 43758.5453);
  let scuff = step(0.86, scuffAt) * smoothstep(0.55, 0.7, top);
  let stain = (1.0 - smoothstep(0.02, 0.09, sj)) * under;

  // CONCRETE: the lines its boards left, and each pour a shade of its own.
  let pour = floor(al / ${POUR});
  let board = step(0.9, fract(al / ${POUR}));
  let pourTone = fract(sin(pour * 12.9898) * 43758.5453) - 0.5;

  // BRICK: courses, each half a brick over from the one below; mortar between; each brick a shade of its own.
  let course = floor(al / ${COURSE});
  let along2 = ac / ${BRICK_LONG} + 0.5 * (course - 2.0 * floor(course * 0.5));
  let mortar = max(step(0.82, fract(al / ${COURSE})), step(0.92, fract(along2)));
  let brickTone = fract(sin((course * 5.0 + floor(along2)) * 12.9898) * 43758.5453) - 0.5;

  // A TRUNK'S CHEVRONS: a V each length, its point the way the sewer falls — and RUNNING that way
  // while it carries, by how far its piece's marks have got. @see pipe-live
  let way = 1.0 - 2.0 * step(5.5, mz);
  let arm = abs(ac - 0.5);
  let chevron = step(fract(al * way + arm * 0.6 - vLive.y), 0.09) * step(arm, 0.3) * trunk * fine;
  // HOW FULL IT STANDS: the tube darker up to the line, as if seen through.
  let wet = step(n.z * 0.5 + 0.5, vLive.x) * step(0.02, vLive.x) * trunk;

  let basew = mix(vColor.rgb, ${vec3}(${rgb(STANDING)}), 0.55 * wet);
  let base0 = mix(basew, ${vec3}(${rgb(CHEVRON)}), 0.85 * chevron);
  let base1 = mix(base0, ${vec3}(${rgb(RUST)}), 0.6 * rust * iron);
  let base2 = mix(base1, ${vec3}(${rgb(MORTAR)}), 0.7 * mortar * brick);
  let wear = 1.0
    - 0.3 * ironJoint * iron - 0.1 * ironSeam * iron
    + 0.12 * bead * steel - 0.05 * spiral * steel + 0.1 * scuff * steel - 0.14 * stain * steel
    - 0.08 * board * concrete + 0.06 * pourTone * concrete
    + 0.12 * brickTone * (1.0 - mortar) * brick;
  let base = base2 * wear;
`;
/** The names in `detail` and `light` that are vectors: GLSL has to be told. */
const VECTORS = "n|lit|basew|base0|base1|base2|base";

/** The lighting, the same lines in both dialects but for their types. */
const light = (vec3: string) => `
  let n = normalize(vNormal);
${detail(vec3)}
  let d = max(dot(n, ${vec3}(${v3(SUN)})), 0.0);
  // THREE TONES, the steps a little soft so they do not shimmer.
  let tone = 0.62 + 0.2 * smoothstep(0.18, 0.26, d) + 0.2 * smoothstep(0.62, 0.7, d);
  // THE SHINE: a narrow line, flat, along the top.
  let shine = 0.22 * smoothstep(0.9, 0.925, dot(n, ${vec3}(${v3(UP)})));
  // THE EDGE, turning away from the camera: darkened to an outline.
  let edge = smoothstep(0.08, 0.3, dot(n, ${vec3}(${v3(VIEW)})));
  let lit = (base * tone + shine) * (0.28 + 0.72 * edge);
`;

export const pipeShaderSource = () => /* wgsl */ `
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
// What each piece is doing now, a texel a slot. Read in the fragment stage: a texture is not the vertex stage's to see here. @see pipe-live
@group(2) @binding(0) var uLive : texture_2d<f32>;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vNormal: vec3<f32>,
  @location(1) vColor: vec4<f32>,
  @location(2) vTint: vec4<f32>,
  @location(3) vMat: vec3<f32>,
};

@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
  @location(1) aNormal: vec3<f32>,
  @location(2) aColor: vec4<f32>,
  @location(3) aMat: vec3<f32>,
) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix
          * globalUniforms.uWorldTransformMatrix
          * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  var out: VSOutput;
  out.position = vec4<f32>(clip.xy, 0.0, 1.0);
  out.vNormal = aNormal;
  out.vColor = aColor;
  out.vTint = localUniforms.uColor * globalUniforms.uWorldColorAlpha;
  out.vMat = aMat;
  return out;
}

@fragment
fn mainFragment(
  @location(0) vNormal: vec3<f32>,
  @location(1) vColor: vec4<f32>,
  @location(2) vTint: vec4<f32>,
  @location(3) vMat: vec3<f32>,
) -> @location(0) vec4<f32> {
  // ITS SLOT rides with its material, the same at every corner of a piece: read here, where a texture may be. @see LIVE_BASE
  let slot = floor((vMat.z + 0.5) / ${LIVE_BASE}.0);
  let mz = vMat.z - ${LIVE_BASE}.0 * slot;
  let vLive = textureLoad(uLive, vec2<i32>(i32(slot) % ${LIVE_WIDE}, i32(slot) / ${LIVE_WIDE}), 0).xy;
${light("vec3<f32>")}
  return vec4<f32>(lit * vColor.a, vColor.a) * vTint;
}
`;

const VERTEX_GLSL = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec3 aNormal;
in vec4 aColor;
in vec3 aMat;
out vec3 vNormal;
out vec4 vColor;
out vec4 vTint;
out vec3 vMat;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;

uniform mat3 uTransformMatrix;
uniform vec4 uColor;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vNormal = aNormal;
  vColor = aColor;
  vTint = uColor * uWorldColorAlpha;
  vMat = aMat;
}
`;

/** GLSL has no `let`: the same lines, typed. */
export const pipeFragmentGlsl = () => /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec4 vColor;
in vec4 vTint;
in vec3 vMat;
out vec4 finalColor;
uniform sampler2D uLive;

void main() {
  float slot = floor((vMat.z + 0.5) / ${LIVE_BASE}.0);
  float mz = vMat.z - ${LIVE_BASE}.0 * slot;
  vec2 vLive = texelFetch(uLive, ivec2(int(slot) % ${LIVE_WIDE}, int(slot) / ${LIVE_WIDE}), 0).xy;
${light("vec3").replace(new RegExp(`\\blet (${VECTORS}) =`, "g"), "vec3 $1 =").replace(/\blet /g, "float ")}
  finalColor = vec4(lit * vColor.a, vColor.a) * vTint;
}
`;

let shared: Shader | null = null;

/** One shader for every band's pipes. @see quadShader */
function pipeShader(): Shader {
  if (shared) return shared;
  const wgsl = pipeShaderSource();
  shared = new Shader({
    gpuProgram: GpuProgram.from({
      vertex: { source: wgsl, entryPoint: "mainVertex" },
      fragment: { source: wgsl, entryPoint: "mainFragment" },
      name: "pipes",
    }),
    glProgram: GlProgram.from({ vertex: VERTEX_GLSL, fragment: pipeFragmentGlsl(), name: "pipes" }),
    resources: { uLive: liveSource() },
  });
  return shared;
}

/**
 * A built pipe mesh, made drawable: exactly the vertices and triangles
 * written. `live`, its vertices can be written again in place — a network's
 * colour changed with its state — without the mesh being made again.
 * @see recolour
 */
export function pipeDrawable(m: PipeMesh, live = false): Mesh<Geometry, Shader> {
  const STRIDE = WORDS * 4;
  const vertices = new Buffer({ data: m.f32.slice(0, m.nv * WORDS), usage: live ? BufferUsage.VERTEX | BufferUsage.COPY_DST : BufferUsage.VERTEX });
  const indices = new Buffer({ data: m.idx.slice(0, m.ni), usage: BufferUsage.INDEX });
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 0 },
      aNormal: { buffer: vertices, format: "float32x3", stride: STRIDE, offset: 8 },
      aColor: { buffer: vertices, format: "unorm8x4", stride: STRIDE, offset: 20 },
      aMat: { buffer: vertices, format: "float32x3", stride: STRIDE, offset: 24 },
    },
    indexBuffer: indices,
  });
  const mesh = new Mesh<Geometry, Shader>({ geometry, shader: pipeShader() });
  mesh.eventMode = "none";
  return mesh;
}

/**
 * COLOUR SOME OF A LIVE MESH AGAIN, in place: each vertex from `from` up to
 * `to` whose colour is `was` becomes `now`. The geometry, the triangles and
 * the draw list round it are untouched: only the bytes go up again.
 * Returns how many it changed.
 */
export function recolour(mesh: Mesh<Geometry, Shader>, from: number, to: number, was: number, now: number): number {
  const buffer = mesh.geometry.attributes.aPosition.buffer, data = buffer.data as Float32Array;
  const words = new Uint32Array(data.buffer, data.byteOffset, data.length);
  let n = 0;
  for (let v = from; v < to; v++) if (words[v * WORDS + 5] === was) { words[v * WORDS + 5] = now; n++; }
  if (n) buffer.update();
  return n;
}

/** Put one away: its geometry, not the shared shader. */
export function destroyPipeDrawable(mesh: Mesh<Geometry, Shader>) {
  mesh.parent?.removeChild(mesh);
  const geometry = mesh.geometry;
  mesh.destroy();
  geometry.destroy(true);
}

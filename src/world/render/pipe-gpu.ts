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
import { SUN, WORDS, type PipeMesh } from "./pipe-mesh";

/**
 * Up the screen, square to the line of sight: the shine runs where a tube's
 * surface faces it — along the top of a tube lying either way alike, which a
 * true glint from the sun would not do.
 */
const UP = [-0.5 * (HH / HW) * Math.SQRT2, -0.5 * (HH / HW) * Math.SQRT2, Math.sqrt(1 - (HH / HW) ** 2)];
const VIEW = [Math.sqrt(1 - (HH / HW) ** 2) * Math.SQRT1_2, Math.sqrt(1 - (HH / HW) ** 2) * Math.SQRT1_2, HH / HW];

const v3 = (a: readonly number[]) => a.map((c) => c.toFixed(5)).join(", ");

/** The lighting, the same lines in both dialects but for their types. */
const light = (vec3: string) => `
  let n = normalize(vNormal);
  let d = max(dot(n, ${vec3}(${v3(SUN)})), 0.0);
  // THREE TONES, the steps a little soft so they do not shimmer.
  let tone = 0.62 + 0.2 * smoothstep(0.18, 0.26, d) + 0.2 * smoothstep(0.62, 0.7, d);
  // THE SHINE: a narrow line, flat, along the top.
  let shine = 0.22 * smoothstep(0.9, 0.925, dot(n, ${vec3}(${v3(UP)})));
  // THE EDGE, turning away from the camera: darkened to an outline.
  let edge = smoothstep(0.08, 0.3, dot(n, ${vec3}(${v3(VIEW)})));
  let lit = (vColor.rgb * tone + shine) * (0.35 + 0.65 * edge);
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

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vNormal: vec3<f32>,
  @location(1) vColor: vec4<f32>,
  @location(2) vTint: vec4<f32>,
};

@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
  @location(1) aNormal: vec3<f32>,
  @location(2) aColor: vec4<f32>,
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
  return out;
}

@fragment
fn mainFragment(
  @location(0) vNormal: vec3<f32>,
  @location(1) vColor: vec4<f32>,
  @location(2) vTint: vec4<f32>,
) -> @location(0) vec4<f32> {
${light("vec3<f32>")}
  return vec4<f32>(lit * vColor.a, vColor.a) * vTint;
}
`;

const VERTEX_GLSL = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec3 aNormal;
in vec4 aColor;
out vec3 vNormal;
out vec4 vColor;
out vec4 vTint;

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
}
`;

/** GLSL has no `let`: the same lines, typed. */
export const pipeFragmentGlsl = () => /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec4 vColor;
in vec4 vTint;
out vec4 finalColor;

void main() {
${light("vec3").replace(/\blet (n|lit) =/g, "vec3 $1 =").replace(/\blet /g, "float ")}
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
  });
  return shared;
}

/** A built pipe mesh, made drawable: exactly the vertices and triangles written. */
export function pipeDrawable(m: PipeMesh): Mesh<Geometry, Shader> {
  const STRIDE = WORDS * 4;
  const vertices = new Buffer({ data: m.f32.slice(0, m.nv * WORDS), usage: BufferUsage.VERTEX });
  const indices = new Buffer({ data: m.idx.slice(0, m.ni), usage: BufferUsage.INDEX });
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 0 },
      aNormal: { buffer: vertices, format: "float32x3", stride: STRIDE, offset: 8 },
      aColor: { buffer: vertices, format: "unorm8x4", stride: STRIDE, offset: 20 },
    },
    indexBuffer: indices,
  });
  const mesh = new Mesh<Geometry, Shader>({ geometry, shader: pipeShader() });
  mesh.eventMode = "none";
  return mesh;
}

/** Put one away: its geometry, not the shared shader. */
export function destroyPipeDrawable(mesh: Mesh<Geometry, Shader>) {
  mesh.parent?.removeChild(mesh);
  const geometry = mesh.geometry;
  mesh.destroy();
  geometry.destroy(true);
}

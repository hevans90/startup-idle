/**
 * World v2 — SOMETHING POURING: spoil off a bucket, stone off a lorry's
 * tail, blacktop into a hopper. A quad from where it leaves to where it
 * lands, and everything in it worked out a pixel at a time:
 *
 *  - it FALLS as things fall — across at a steady rate, down faster and
 *    faster — so the stream bends, and what it is made of is carried down it
 *    stretching as it goes;
 *  - EARTH and STONE come as a ragged sheet that breaks into clods and then
 *    crumbs the further they fall, each lit on one side; BLACKTOP comes as
 *    one thick rope, thinning, with a wet highlight down it, folding over
 *    itself where it lands;
 *  - it STARTS at the top and runs down, and STOPS at the top and the last of
 *    it falls away (`head`, `tail`);
 *  - and where it lands it HEAPS: a mound of the same stuff, as high as it
 *    has been told (`pile`).
 *
 * All of it per vertex, written in place each frame: no uniforms, nothing
 * built or destroyed while it runs. Both dialects from one body.
 * @see render/pipe-glass (the pattern), render/road-plant (who pours)
 */
import { Buffer, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh, Shader } from "pixi.js";

/** What pours: earth, stone, blacktop. */
export const POUR = { earth: 0, stone: 1, tar: 2 } as const;
export type PourState = {
  /** Its own time, seconds: what carries it down. */
  time: number;
  kind: number;
  /** How far down the stream has come, and how far down its last has fallen: nought to one, the top to the landing. */
  head: number;
  tail: number;
  /** How high it stands heaped where it lands, nought to one. */
  pile: number;
  /** Its colours, lit and in shade. */
  lit: number;
  shade: number;
};

/** Floats a vertex: x, y; across (−1…1) and down (0 the top, 1 the landing, on past it for the heap); time, kind, head, tail; the bend, the heap, its width at the top and at the landing; its two colours. */
const WORDS = 18;
/** How far past the landing the quad runs, for the heap, as a share of the fall. */
const PAST = 0.35;

const BODY = (LET: string, VAR: string, LET3: string, VAR3: string, V2: string, V3: string) => `
  ${LET} v = vUV.y;
  ${LET} vc = clamp(v, 0.0, 1.0);
  ${LET} t = vP.x;
  ${LET} gran = 1.0 - step(1.5, vP.y);
  ${LET} fine = step(0.5, vP.y) * gran;
  ${LET} asp = vQ.z;
  // Across at a steady rate, down as the square of the time: the stream's middle bends away from the straight line.
  ${LET} fall = sqrt(vc);
  ${LET} fold = (1.0 - gran) * sin(t * 5.0 + vc * 7.0) * 0.14 * vc * vc * vc;
  ${LET} x = vUV.x - vQ.x * (fall - vc) - fold;
  // What it is made of, carried down, faster the further it has fallen: in a space as wide as it is long, so a clod is round.
  ${LET} s = fall * asp - t * (1.6 + 0.9 * gran);
  ${LET} grain = 2.2 + 2.6 * fine;
  ${LET} n1 = noise(${V2}(x * grain + 7.0, s * grain));
  ${LET} n2 = noise(${V2}(x * grain * 2.7 + 1.3, s * grain * 2.7 + 3.0));
  ${LET} lump = n1 * 0.65 + n2 * 0.35;
  ${LET} wid = mix(0.385, vQ.w, vc);
  ${LET} ragged = abs(x) + (n1 - 0.5) * (0.3 * gran + 0.05);
  ${VAR} a = 1.0 - smoothstep(wid - 0.1, wid, ragged);
  // BROKEN UP as it falls: a sheet at the lip, clods half way, crumbs at the bottom. Blacktop holds together.
  ${LET} thr = mix(0.18, 0.56, vc) * gran;
  ${LET} solid = smoothstep(thr, thr + 0.07, lump);
  a = a * mix(1.0, solid, gran);
  // Only between its last and its first, and never below where it lands.
  a = a * step(vP.w, vc) * (1.0 - step(vP.z, vc)) * (1.0 - step(1.0, v));
  // LIT from one side: each clod round, bright on its lit shoulder and dark at its edge; blacktop wet, a highlight running down it.
  ${LET} side = clamp(-x / max(wid, 0.02), -1.0, 1.0);
  ${LET} body = smoothstep(thr, thr + 0.35, lump);
  ${LET} tone = clamp(mix(0.5 + 0.35 * side, 0.15 + 0.85 * body + 0.2 * side, gran), 0.0, 1.0);
  ${VAR3} col = mix(vC2, vC1, tone);
  ${LET} wet = (1.0 - gran) * pow(clamp(1.0 - abs(side - 0.4) * 2.2, 0.0, 1.0), 3.0) * (0.55 + 0.45 * sin(s * 2.0));
  col = col + ${V3}(wet * 0.5, wet * 0.5, wet * 0.55);
  // THE HEAP where it lands: a mound of the same, grained, lit from the same side, its foot ragged.
  ${LET} up = 1.0 + ${(PAST * 0.9).toFixed(3)} - v;
  ${LET} hx = vUV.x - vQ.x * (1.0 - 1.0);
  ${LET} g1 = noise(${V2}(hx * grain * 2.0 + 4.0, v * asp * grain * 2.0));
  ${LET} mound = vQ.y * ${(PAST * 0.85).toFixed(3)} * (1.0 - hx * hx * 1.3) + (g1 - 0.5) * 0.05 * gran;
  ${LET} pa = step(0.0, up) * (1.0 - smoothstep(mound - 0.02, mound, up)) * step(0.004, vQ.y);
  ${LET} ptone = clamp(0.45 - 0.3 * hx + 0.7 * (g1 - 0.5) * (0.35 + 0.65 * gran) + (up / max(mound, 0.01)) * 0.35, 0.0, 1.0);
  ${LET3} pcol = mix(vC2, vC1, ptone) + ${V3}(1.0, 1.0, 1.0) * (1.0 - gran) * 0.16 * pow(ptone, 3.0);
  ${LET} alpha = max(a, pa);
  col = mix(pcol, col, a);
`;

const NOISE_WGSL = `
fn hash21(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2<f32>(1.0, 0.0)), u.x), mix(hash21(i + vec2<f32>(0.0, 1.0)), hash21(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}`;
const NOISE_GLSL = `
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

const WGSL = /* wgsl */ `
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
  @location(0) vUV: vec2<f32>,
  @location(1) vP: vec4<f32>,
  @location(2) vQ: vec4<f32>,
  @location(3) vC1: vec3<f32>,
  @location(4) vC2: vec3<f32>,
  @location(5) vTint: vec4<f32>,
};
${NOISE_WGSL}
@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
  @location(1) aUV: vec2<f32>,
  @location(2) aP: vec4<f32>,
  @location(3) aQ: vec4<f32>,
  @location(4) aC1: vec3<f32>,
  @location(5) aC2: vec3<f32>,
) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  var out: VSOutput;
  out.position = vec4<f32>(clip.xy, 0.0, 1.0);
  out.vUV = aUV; out.vP = aP; out.vQ = aQ; out.vC1 = aC1; out.vC2 = aC2;
  out.vTint = localUniforms.uColor * globalUniforms.uWorldColorAlpha;
  return out;
}
@fragment
fn mainFragment(
  @location(0) vUV: vec2<f32>,
  @location(1) vP: vec4<f32>,
  @location(2) vQ: vec4<f32>,
  @location(3) vC1: vec3<f32>,
  @location(4) vC2: vec3<f32>,
  @location(5) vTint: vec4<f32>,
) -> @location(0) vec4<f32> {
${BODY("let", "var", "let", "var", "vec2<f32>", "vec3<f32>")}
  return vec4<f32>(col * alpha, alpha) * vTint;
}
`;
const VERTEX_GLSL = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
in vec4 aP;
in vec4 aQ;
in vec3 aC1;
in vec3 aC2;
out vec2 vUV;
out vec4 vP;
out vec4 vQ;
out vec3 vC1;
out vec3 vC2;
out vec4 vTint;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV; vP = aP; vQ = aQ; vC1 = aC1; vC2 = aC2;
  vTint = uColor * uWorldColorAlpha;
}
`;
const FRAGMENT_GLSL = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in vec4 vP;
in vec4 vQ;
in vec3 vC1;
in vec3 vC2;
in vec4 vTint;
out vec4 finalColor;
${NOISE_GLSL}
void main() {
${BODY("float", "float", "vec3", "vec3", "vec2", "vec3")}
  finalColor = vec4(col * alpha, alpha) * vTint;
}
`;
/** The shaders' sources, for whoever checks them. */
export const pourSources = () => ({ wgsl: WGSL, vertex: VERTEX_GLSL, fragment: FRAGMENT_GLSL });

let shared: Shader | null = null;
const pourShader = (): Shader => (shared ??= new Shader({
  gpuProgram: GpuProgram.from({ vertex: { source: WGSL, entryPoint: "mainVertex" }, fragment: { source: WGSL, entryPoint: "mainFragment" }, name: "pour" }),
  glProgram: GlProgram.from({ vertex: VERTEX_GLSL, fragment: FRAGMENT_GLSL, name: "pour" }),
}));

const rgb = (c: number) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

export type Pour = {
  mesh: Mesh<Geometry, Shader>;
  /** From `from` to `to`, in its parent's own pixels; `width`, half across at the lip, pixels; `taper`, its half width at the landing as a share of that. */
  set(from: readonly [number, number], to: readonly [number, number], width: number, taper: number, st: PourState): void;
  hide(): void;
  destroy(): void;
};

/** The vertices of a pour from `from` to `to`: for the mesh, and for whoever tests where they go. */
export function pourVerts(out: Float32Array, from: readonly [number, number], to: readonly [number, number], width: number, taper: number, st: PourState): void {
  const [sx, sy] = from, [ex, ey] = to, c1 = rgb(st.lit), c2 = rgb(st.shade);
  // The quad: as wide as the heap at its foot, from the lip to a way past the landing, along the straight line between them.
  const half = width * 2.6, bx = sx + (ex - sx) * (1 + PAST), by = sy + (ey - sy) * (1 + PAST);
  const corners = [[sx - half, sy, -1, 0], [sx + half, sy, 1, 0], [bx + half, by, 1, 1 + PAST], [bx - half, by, -1, 1 + PAST]];
  corners.forEach(([x, y, u, v], k) => {
    const o = k * WORDS;
    out[o] = x; out[o + 1] = y; out[o + 2] = u; out[o + 3] = v;
    out[o + 4] = st.time; out[o + 5] = st.kind; out[o + 6] = st.head; out[o + 7] = st.tail;
    // The bend, across in the quad's own halves; the heap; how many of its halves long the fall is; the stream's half width at the landing, of the quad's half.
    out[o + 8] = (ex - sx) / half; out[o + 9] = st.pile; out[o + 10] = Math.max(0.5, Math.hypot(ex - sx, ey - sy) / half); out[o + 11] = taper / 2.6;
    out[o + 12] = c1[0]; out[o + 13] = c1[1]; out[o + 14] = c1[2]; out[o + 15] = c2[0]; out[o + 16] = c2[1]; out[o + 17] = c2[2];
  });
}

export function createPour(): Pour {
  const data = new Float32Array(4 * WORDS), STRIDE = WORDS * 4;
  const vertices = new Buffer({ data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 0 },
      aUV: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 8 },
      aP: { buffer: vertices, format: "float32x4", stride: STRIDE, offset: 16 },
      aQ: { buffer: vertices, format: "float32x4", stride: STRIDE, offset: 32 },
      aC1: { buffer: vertices, format: "float32x3", stride: STRIDE, offset: 48 },
      aC2: { buffer: vertices, format: "float32x3", stride: STRIDE, offset: 60 },
    },
    indexBuffer: new Buffer({ data: new Uint32Array([0, 1, 2, 0, 2, 3]), usage: BufferUsage.INDEX }),
  });
  const mesh = new Mesh<Geometry, Shader>({ geometry, shader: pourShader() });
  mesh.eventMode = "none";
  mesh.visible = false;
  return {
    mesh,
    set(from, to, width, taper, st) { pourVerts(data, from, to, width, taper, st); vertices.update(); mesh.visible = true; },
    hide() { mesh.visible = false; },
    destroy() { mesh.destroy(); geometry.destroy(true); },
  };
}

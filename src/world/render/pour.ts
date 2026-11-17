/**
 * World v2 — SOMETHING POURING: spoil off a bucket, stone off a lorry's
 * tail, blacktop into a hopper. A quad from where it leaves to where it
 * lands, and everything in it worked out a pixel at a time:
 *
 *  - it FALLS as things fall — across at a steady rate, down faster and
 *    faster — so the stream bends, narrowing as it speeds up;
 *  - it is A BODY, lit as a round thing is: EARTH and STONE solid at the lip,
 *    streaked the way they run, their edge shedding and the whole loosening
 *    as it falls, flaring into a skirt where it hits; BLACKTOP one thick wet
 *    rope with the light down its shoulder, coming in glugs, coiling as it
 *    lands;
 *  - it STARTS at the top and runs down, and STOPS at the top and the last of
 *    it falls away (`head`, `tail`);
 *  - where it lands earth and stone HEAP at their angle of rest, grains
 *    running down the heap's sides and others bouncing off it on arcs of
 *    their own; blacktop POOLS and spreads, the light on it (`pile`).
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

/** Floats a vertex: x, y; where it is from the lip, pixels across and down; time, kind, head, tail; how far across it lands, its heap, how far it falls, its half width at the lip — pixels; its taper and how many pixels a metre is; its two colours. */
const WORDS = 20;

const BODY = (LET: string, VAR: string, LET3: string, VAR3: string, V2: string, V3: string) => `
  ${LET} t = vP.x;
  ${LET} gran = 1.0 - step(1.5, vP.y);
  ${LET} fine = step(0.5, vP.y) * gran;
  ${LET} dx = vQ.x;
  ${LET} L = max(vQ.z, 1.0);
  ${LET} W = max(vQ.w, 0.5);
  ${LET} ppm = vR.y;
  // A grain: a clod of earth a hand across, a stone a third of that.
  ${LET} grain = max(1.2, ppm * mix(0.16, 0.07, fine));
  ${LET} y = vUV.y;
  ${LET} yn = clamp(y / L, 0.0, 1.0);
  // IT FALLS: across at a steady rate, down as the square of the time. Blacktop, thick, coils as it lands.
  ${LET} coil = (1.0 - gran) * sin(t * 7.0 + y / W * 1.2) * W * 0.35 * smoothstep(0.6, 1.0, yn);
  ${LET} cx = dx * sqrt(yn) + coil;
  // ITS WIDTH: narrowing as it speeds up; earth and stone flaring into a skirt where they hit; blacktop coming in glugs.
  ${LET} s = y * (1.6 - 0.6 * yn) - t * L * (1.5 + 0.8 * gran);
  ${LET} glug = (1.0 - gran) * 0.22 * sin(s / (W * 2.2));
  ${LET} skirt = gran * smoothstep(0.8, 1.0, yn);
  ${LET} w = W * (mix(1.0, vR.x, yn) + glug + 1.6 * skirt);
  ${LET} xn = (vUV.x - cx) / w;
  // WHAT IT IS MADE OF, carried down it: streaks along the fall, lumps across them.
  ${LET} streak = noise(${V2}((vUV.x - cx) / grain, s / (grain * 3.5)));
  ${LET} lump = noise(${V2}((vUV.x - cx) / (grain * 1.8) + 3.0, s / (grain * 1.8)));
  // A SOLID BODY with a ragged edge that sheds: whole at the lip, thinning to loose stuff as it falls.
  ${LET} edge = abs(xn) + (streak - 0.5) * (0.5 * gran + 0.06) * (0.4 + 0.6 * yn);
  ${VAR} a = 1.0 - smoothstep(0.78, 1.0, edge);
  ${LET} loose = gran * yn * 0.75;
  a = a * mix(1.0, smoothstep(0.3, 0.5, lump), loose) * (1.0 - 0.45 * skirt);
  a = a * step(vP.w, yn) * (1.0 - step(vP.z, yn)) * step(0.0, y) * (1.0 - step(L, y));
  // LIT AS A ROUND THING IS: bright down its lit shoulder, dark at the far edge; its streaks its own tones.
  ${LET} round = sqrt(max(0.0, 1.0 - xn * xn));
  ${LET} tone = clamp(0.12 + 0.5 * round - 0.3 * xn + (streak - 0.5) * 0.5 * gran + (lump - 0.5) * 0.3 * gran, 0.0, 1.0);
  ${VAR3} col = mix(vC2, vC1, tone);
  // Blacktop is wet: a hard light down its shoulder and a softer one beside it.
  ${LET} shine = (1.0 - gran) * (pow(clamp(1.0 - abs(xn + 0.42) * 3.2, 0.0, 1.0), 2.0) * 0.75 + pow(clamp(1.0 - abs(xn - 0.25) * 2.0, 0.0, 1.0), 2.0) * 0.12);
  col = col + ${V3}(shine, shine, shine * 1.05);

  // WHERE IT LANDS. Earth and stone HEAP at their angle of rest, grains running down the heap's sides, others
  // bouncing off it; blacktop POOLS, spreading, with the light on it.
  ${LET} hx = vUV.x - dx;
  ${LET} up = L + W * 0.5 - y;
  ${LET} tall = vQ.y * W * 2.6;
  ${LET} slide = noise(${V2}(abs(hx) / grain - t * 1.6, y / grain + 5.0));
  ${LET} cone = tall - abs(hx) / 1.45 + (slide - 0.5) * grain * 0.9;
  ${LET} heap = gran * step(0.0, up) * (1.0 - smoothstep(cone - 1.0, cone + 0.5, up)) * step(0.01, vQ.y);
  ${LET} htone = clamp(0.5 - 0.3 * sign(hx) * smoothstep(0.0, W * 0.6, abs(hx)) + (slide - 0.5) * 0.55 + (up / max(tall, 1.0)) * 0.25, 0.0, 1.0);
  ${LET} pw = W * (1.3 + 2.4 * vQ.y);
  ${LET} pv = W * 0.55;
  ${LET} pe = (hx * hx) / (pw * pw) + ((up - pv) * (up - pv)) / (pv * pv);
  ${LET} pool = (1.0 - gran) * (1.0 - smoothstep(0.8, 1.0, pe)) * step(0.01, vQ.y);
  ${LET} pshine = pow(clamp(1.0 - abs(hx / pw + 0.35) * 2.4, 0.0, 1.0), 2.0) * clamp((up - pv) / pv + 0.6, 0.0, 1.0) * 0.6;
  ${LET3} landed = mix(mix(vC2, vC1, htone), mix(vC2, vC1, 0.35) + ${V3}(pshine, pshine, pshine), 1.0 - gran);
  ${LET} la = max(heap, pool);
  // GRAINS thrown off where it hits, each on its own arc.
  ${LET} flying = gran * bounce(${V2}(hx, -up), t, W, grain) * step(vP.w + 0.05, 1.0) * (1.0 - step(vP.z, 0.98));
  ${LET} alpha = max(max(a, la), flying);
  col = mix(landed, col, a);
  col = mix(col, mix(vC2, vC1, 0.75), flying * (1.0 - max(a, la)));
`;

const HELPERS_WGSL = `
fn hash21(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2<f32>(1.0, 0.0)), u.x), mix(hash21(i + vec2<f32>(0.0, 1.0)), hash21(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
fn bounce(p: vec2<f32>, t: f32, W: f32, grain: f32) -> f32 {
  var a = 0.0;
  for (var i = 0; i < 9; i = i + 1) {
    let k = f32(i);
    let ph = fract(t * (1.3 + 0.5 * hash21(vec2<f32>(k, 3.0))) + hash21(vec2<f32>(k, 7.0)));
    let side = (hash21(vec2<f32>(k, 1.0)) - 0.5) * 2.0;
    let far = W * (1.2 + 2.6 * hash21(vec2<f32>(k, 5.0)));
    let high = W * (0.9 + 1.8 * hash21(vec2<f32>(k, 9.0)));
    let at = vec2<f32>(side * far * ph, -high * 4.0 * ph * (1.0 - ph));
    let r = grain * (0.45 + 0.4 * hash21(vec2<f32>(k, 11.0)));
    a = max(a, (1.0 - smoothstep(r * 0.6, r, length(p - at))) * (1.0 - ph * 0.5));
  }
  return a;
}`;
const HELPERS_GLSL = `
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float bounce(vec2 p, float t, float W, float grain) {
  float a = 0.0;
  for (int i = 0; i < 9; i++) {
    float k = float(i);
    float ph = fract(t * (1.3 + 0.5 * hash21(vec2(k, 3.0))) + hash21(vec2(k, 7.0)));
    float side = (hash21(vec2(k, 1.0)) - 0.5) * 2.0;
    float far = W * (1.2 + 2.6 * hash21(vec2(k, 5.0)));
    float high = W * (0.9 + 1.8 * hash21(vec2(k, 9.0)));
    vec2 at = vec2(side * far * ph, -high * 4.0 * ph * (1.0 - ph));
    float r = grain * (0.45 + 0.4 * hash21(vec2(k, 11.0)));
    a = max(a, (1.0 - smoothstep(r * 0.6, r, length(p - at))) * (1.0 - ph * 0.5));
  }
  return a;
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
  @location(3) vR: vec2<f32>,
  @location(4) vC1: vec3<f32>,
  @location(5) vC2: vec3<f32>,
  @location(6) vTint: vec4<f32>,
};
${HELPERS_WGSL}
@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
  @location(1) aUV: vec2<f32>,
  @location(2) aP: vec4<f32>,
  @location(3) aQ: vec4<f32>,
  @location(4) aR: vec2<f32>,
  @location(5) aC1: vec3<f32>,
  @location(6) aC2: vec3<f32>,
) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  var out: VSOutput;
  out.position = vec4<f32>(clip.xy, 0.0, 1.0);
  out.vUV = aUV; out.vP = aP; out.vQ = aQ; out.vR = aR; out.vC1 = aC1; out.vC2 = aC2;
  out.vTint = localUniforms.uColor * globalUniforms.uWorldColorAlpha;
  return out;
}
@fragment
fn mainFragment(
  @location(0) vUV: vec2<f32>,
  @location(1) vP: vec4<f32>,
  @location(2) vQ: vec4<f32>,
  @location(3) vR: vec2<f32>,
  @location(4) vC1: vec3<f32>,
  @location(5) vC2: vec3<f32>,
  @location(6) vTint: vec4<f32>,
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
in vec2 aR;
in vec3 aC1;
in vec3 aC2;
out vec2 vUV;
out vec4 vP;
out vec4 vQ;
out vec2 vR;
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
  vUV = aUV; vP = aP; vQ = aQ; vR = aR; vC1 = aC1; vC2 = aC2;
  vTint = uColor * uWorldColorAlpha;
}
`;
const FRAGMENT_GLSL = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in vec4 vP;
in vec4 vQ;
in vec2 vR;
in vec3 vC1;
in vec3 vC2;
in vec4 vTint;
out vec4 finalColor;
${HELPERS_GLSL}
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
  /** From `from` to `to`, in its parent's own pixels; `width`, half across at the lip, pixels; `taper`, its half width at the landing as a share of that; `ppm`, pixels a metre, for the size of a grain. */
  set(from: readonly [number, number], to: readonly [number, number], width: number, taper: number, ppm: number, st: PourState): void;
  hide(): void;
  destroy(): void;
};

/** The vertices of a pour from `from` to `to`: for the mesh, and for whoever tests where they go. A box on the screen round the fall, its skirt, its heap and what flies off it. */
export function pourVerts(out: Float32Array, from: readonly [number, number], to: readonly [number, number], width: number, taper: number, ppm: number, st: PourState): void {
  const [sx, sy] = from, [ex, ey] = to, c1 = rgb(st.lit), c2 = rgb(st.shade);
  const dx = ex - sx, L = Math.max(1, ey - sy), pad = width * 5.5;
  const x0 = Math.min(0, dx) - pad, x1 = Math.max(0, dx) + pad, y0 = -width * 0.5, y1 = L + width * 1.2;
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], k) => {
    const o = k * WORDS;
    out[o] = sx + x; out[o + 1] = sy + y; out[o + 2] = x; out[o + 3] = y;
    out[o + 4] = st.time; out[o + 5] = st.kind; out[o + 6] = st.head; out[o + 7] = st.tail;
    out[o + 8] = dx; out[o + 9] = st.pile; out[o + 10] = L; out[o + 11] = width;
    out[o + 12] = taper; out[o + 13] = ppm;
    out[o + 14] = c1[0]; out[o + 15] = c1[1]; out[o + 16] = c1[2]; out[o + 17] = c2[0]; out[o + 18] = c2[1]; out[o + 19] = c2[2];
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
      aR: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 48 },
      aC1: { buffer: vertices, format: "float32x3", stride: STRIDE, offset: 56 },
      aC2: { buffer: vertices, format: "float32x3", stride: STRIDE, offset: 68 },
    },
    indexBuffer: new Buffer({ data: new Uint32Array([0, 1, 2, 0, 2, 3]), usage: BufferUsage.INDEX }),
  });
  const mesh = new Mesh<Geometry, Shader>({ geometry, shader: pourShader() });
  mesh.eventMode = "none";
  mesh.visible = false;
  return {
    mesh,
    set(from, to, width, taper, ppm, st) { pourVerts(data, from, to, width, taper, ppm, st); vertices.update(); mesh.visible = true; },
    hide() { mesh.visible = false; },
    destroy() { mesh.destroy(); geometry.destroy(true); },
  };
}

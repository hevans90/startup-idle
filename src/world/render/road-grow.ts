/**
 * World v2 — A ROAD GROWING. A cell of a road being built is not a strip
 * slid across a tile: it is the ground worked on, and each trade's work
 * spreads over it as that work does.
 *
 *  - THE CUT eats into the grass in bites, its edge clods and crumbs; just
 *    turned it is dark and damp, and it dries and takes the plant's ruts.
 *  - STONE is tipped and thrown: loose grains ahead, thickening to a bed.
 *  - BLACKTOP is the cell's OWN TILE — the texture the finished road will
 *    wear, from the same painter — and it comes as blacktop comes: a thick
 *    lip pushed out furthest where it is fed, in tongues, black and wet and
 *    shining where it has just been laid, dulling to the road's own grey
 *    behind as it cools and is rolled.
 *  - ITS LINES come on wet and bright along the same tile's markings.
 *
 * Every edge is where a trade has got to along the job PLUS a field of
 * noise fixed to the ground, so a front is ragged, keeps its shape as it
 * advances, and never jumps a tile. One quad a cell, both tiles sampled a
 * pixel at a time; four numbers a vertex move it — the four trades' fronts.
 * Both dialects from one body. @see render/road-works, roads/jobs frontAt
 */
import { Buffer, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh, Shader, type Texture, type TextureSource } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../iso";

/** Floats a vertex: x, y; its place in the unlined tile's page and the lined one's, pixels; where it is on the map, tiles; the four fronts, cells past this cell's near edge; the way the job runs through it and its middle; the time, and whether it is a bridge's deck. */
const WORDS = 18;

const BODY = (LET: string, VAR: string, LET2: string, LET3: string, VAR3: string, LET4: string, V2: string, V3: string) => `
  ${LET2} q = vTile - vDir.zw;
  ${LET} along = dot(q, vDir.xy) + 0.5;
  ${LET} across = dot(q, ${V2}(-vDir.y, vDir.x));
  ${LET} inside = step(abs(q.x), 0.5) * step(abs(q.y), 0.5);
  ${LET} deck = vMisc.y;
  // The ground's own grain, fixed to the map: what makes every edge ragged and keeps it the same shape as it moves on.
  ${LET} nA = noise(vTile * 4.0 + 11.0);
  ${LET} nB = noise(vTile * 11.0 + 5.0);
  ${LET} nC = noise(vTile * 29.0 + 2.0);
  ${LET} nD = noise(vTile * 61.0);
  ${LET4} bare = tapBare(vUvA);
  ${LET4} lined = tapLined(vUvB);

  // ── THE CUT: bites out of the grass, clods at its edge, dark where just turned ──────────
  ${LET} d0 = vFront.x - along + (nA - 0.5) * 0.55 + (nB - 0.5) * 0.22;
  ${LET} bite = smoothstep(-0.02, 0.03, d0 + (nC - 0.5) * 0.1);
  ${LET} clods = step(0.62, nC) * smoothstep(-0.22, -0.02, d0);
  ${LET} r0 = max(bite, clods) * inside * (1.0 - deck);
  ${LET} damp = 1.0 - smoothstep(0.0, 1.1, d0);
  ${LET} rut = (1.0 - smoothstep(0.02, 0.05, abs(abs(across) - 0.19))) * smoothstep(0.5, 1.3, d0);
  ${VAR3} col = mix(${V3}(0.36, 0.26, 0.17), ${V3}(0.55, 0.42, 0.28), nB * 0.55 + nD * 0.45);
  col = col * (1.0 - 0.32 * damp) * (1.0 - 0.3 * rut);
  // A lighter crumbly lip where the turf has been broken.
  col = mix(col, ${V3}(0.62, 0.5, 0.33), (1.0 - smoothstep(0.0, 0.07, d0)) * bite * 0.6);
  ${VAR} alpha = r0;
  col = col * r0;

  // ── STONE: thrown grains ahead, thickening to a bed — on the road's own footprint ────
  ${LET} d1 = vFront.y - along + (nA - 0.5) * 0.5;
  ${LET} bed = smoothstep(0.0, 0.45, d1);
  ${LET} grains = step(1.0 - smoothstep(-0.3, 0.25, d1), nD * 0.75 + nC * 0.25);
  ${LET} r1 = max(bed, grains * smoothstep(-0.32, -0.05, d1)) * bare.a * (1.0 - deck);
  ${LET3} stone = mix(${V3}(0.42, 0.41, 0.39), ${V3}(0.68, 0.66, 0.62), nD) * (0.88 + 0.24 * nB);
  col = col * (1.0 - r1) + stone * r1;
  alpha = alpha * (1.0 - r1) + r1;

  // ── BLACKTOP: the tile itself, pushed out in tongues from where it is fed; wet and black new, the road's grey behind ──
  ${LET} fed = 1.0 - across * across * 3.2;
  ${LET} d2 = vFront.z - along - 0.34 + fed * 0.34 + (nA - 0.5) * 0.42 + (nB - 0.5) * 0.14;
  ${LET} r2 = smoothstep(0.0, 0.03, d2);
  ${LET} lip = (1.0 - smoothstep(0.0, 0.09, d2)) * r2;
  ${LET} hot = (1.0 - smoothstep(0.05, 1.4, d2)) * r2;
  ${LET} sheen = hot * pow(clamp(0.5 + 0.5 * sin(across * 16.0 + nB * 5.0 + d2 * 3.0), 0.0, 1.0), 6.0);
  // What the tile is, darkened while hot; a thick black lip at its edge; light caught on the wet of it.
  ${VAR3} top = bare.rgb * (1.0 - 0.55 * hot);
  top = mix(top, ${V3}(0.03, 0.03, 0.035) * bare.a, lip * 0.9);
  top = top + ${V3}(0.2, 0.2, 0.22) * sheen * bare.a;
  ${LET} w2 = r2 * bare.a;
  col = col * (1.0 - w2) + top * r2;
  alpha = alpha * (1.0 - w2) + w2;

  // ── LINES: the same tile with its markings, come on wet and bright ───────────────────────
  ${LET} d3 = vFront.w - along + (nB - 0.5) * 0.07;
  ${LET} r3 = smoothstep(0.0, 0.03, d3);
  ${LET} fresh = (1.0 - smoothstep(0.0, 0.8, d3)) * r3;
  ${LET3} paint = lined.rgb + (lined.rgb - bare.rgb) * 0.35 * fresh;
  ${LET} w3 = r3 * lined.a;
  col = col * (1.0 - w3) + paint * r3;
  alpha = alpha * (1.0 - w3) + w3;
`;

const NOISE_WGSL = `
fn hash21(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2<f32>(1.0, 0.0)), u.x), mix(hash21(i + vec2<f32>(0.0, 1.0)), hash21(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
fn tapOf(t: texture_2d<f32>, px: vec2<f32>) -> vec4<f32> {
  let size = vec2<i32>(textureDimensions(t));
  let p = px - vec2<f32>(0.5, 0.5);
  let i = vec2<i32>(floor(p));
  let f = fract(p);
  let hi = size - vec2<i32>(1, 1);
  let a = textureLoad(t, clamp(i, vec2<i32>(0, 0), hi), 0);
  let b = textureLoad(t, clamp(i + vec2<i32>(1, 0), vec2<i32>(0, 0), hi), 0);
  let c = textureLoad(t, clamp(i + vec2<i32>(0, 1), vec2<i32>(0, 0), hi), 0);
  let d = textureLoad(t, clamp(i + vec2<i32>(1, 1), vec2<i32>(0, 0), hi), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
fn tapBare(px: vec2<f32>) -> vec4<f32> { return tapOf(uBare, px); }
fn tapLined(px: vec2<f32>) -> vec4<f32> { return tapOf(uLined, px); }`;
const NOISE_GLSL = `
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec4 tapOf(sampler2D t, vec2 px) {
  ivec2 size = textureSize(t, 0);
  vec2 p = px - vec2(0.5);
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  ivec2 hi = size - ivec2(1);
  vec4 a = texelFetch(t, clamp(i, ivec2(0), hi), 0);
  vec4 b = texelFetch(t, clamp(i + ivec2(1, 0), ivec2(0), hi), 0);
  vec4 c = texelFetch(t, clamp(i + ivec2(0, 1), ivec2(0), hi), 0);
  vec4 d = texelFetch(t, clamp(i + ivec2(1, 1), ivec2(0), hi), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec4 tapBare(vec2 px) { return tapOf(uBare, px); }
vec4 tapLined(vec2 px) { return tapOf(uLined, px); }`;

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
@group(2) @binding(0) var uBare : texture_2d<f32>;
@group(2) @binding(1) var uLined : texture_2d<f32>;
struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vUvA: vec2<f32>,
  @location(1) vUvB: vec2<f32>,
  @location(2) vTile: vec2<f32>,
  @location(3) vFront: vec4<f32>,
  @location(4) vDir: vec4<f32>,
  @location(5) vMisc: vec2<f32>,
  @location(6) vTint: vec4<f32>,
};
${NOISE_WGSL}
@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
  @location(1) aUvA: vec2<f32>,
  @location(2) aUvB: vec2<f32>,
  @location(3) aTile: vec2<f32>,
  @location(4) aFront: vec4<f32>,
  @location(5) aDir: vec4<f32>,
  @location(6) aMisc: vec2<f32>,
) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  var out: VSOutput;
  out.position = vec4<f32>(clip.xy, 0.0, 1.0);
  out.vUvA = aUvA; out.vUvB = aUvB; out.vTile = aTile; out.vFront = aFront; out.vDir = aDir; out.vMisc = aMisc;
  out.vTint = localUniforms.uColor * globalUniforms.uWorldColorAlpha;
  return out;
}
@fragment
fn mainFragment(
  @location(0) vUvA: vec2<f32>,
  @location(1) vUvB: vec2<f32>,
  @location(2) vTile: vec2<f32>,
  @location(3) vFront: vec4<f32>,
  @location(4) vDir: vec4<f32>,
  @location(5) vMisc: vec2<f32>,
  @location(6) vTint: vec4<f32>,
) -> @location(0) vec4<f32> {
${BODY("let", "var", "let", "let", "var", "let", "vec2<f32>", "vec3<f32>")}
  return vec4<f32>(col, alpha) * vTint;
}
`;
const VERTEX_GLSL = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUvA;
in vec2 aUvB;
in vec2 aTile;
in vec4 aFront;
in vec4 aDir;
in vec2 aMisc;
out vec2 vUvA;
out vec2 vUvB;
out vec2 vTile;
out vec4 vFront;
out vec4 vDir;
out vec2 vMisc;
out vec4 vTint;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUvA = aUvA; vUvB = aUvB; vTile = aTile; vFront = aFront; vDir = aDir; vMisc = aMisc;
  vTint = uColor * uWorldColorAlpha;
}
`;
const FRAGMENT_GLSL = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUvA;
in vec2 vUvB;
in vec2 vTile;
in vec4 vFront;
in vec4 vDir;
in vec2 vMisc;
in vec4 vTint;
out vec4 finalColor;
uniform sampler2D uBare;
uniform sampler2D uLined;
${NOISE_GLSL}
void main() {
${BODY("float", "float", "vec2", "vec3", "vec3", "vec4", "vec2", "vec3")}
  finalColor = vec4(col, alpha) * vTint;
}
`;
/** The shaders' sources, for whoever checks them. */
export const growSources = () => ({ wgsl: WGSL, vertex: VERTEX_GLSL, fragment: FRAGMENT_GLSL });

let program: { gpu: GpuProgram; gl: GlProgram } | null = null;
/** A shader a pair of pages: the unlined tile's and the lined one's. Few: a level of detail has a page or two. */
const shaders = new Map<TextureSource, Map<TextureSource, Shader>>();
function growShader(bare: TextureSource, lined: TextureSource): Shader {
  program ??= {
    gpu: GpuProgram.from({ vertex: { source: WGSL, entryPoint: "mainVertex" }, fragment: { source: WGSL, entryPoint: "mainFragment" }, name: "road grow" }),
    gl: GlProgram.from({ vertex: VERTEX_GLSL, fragment: FRAGMENT_GLSL, name: "road grow" }),
  };
  let of = shaders.get(bare);
  if (!of) shaders.set(bare, (of = new Map()));
  let sh = of.get(lined);
  if (!sh) of.set(lined, (sh = new Shader({ gpuProgram: program.gpu, glProgram: program.gl, resources: { uBare: bare, uLined: lined } })));
  return sh;
}

/** A cell growing: where its tile's sprite would go, both its tiles, where it is on the map and how the job runs through it. */
export type GrowCell = {
  bare: Texture; lined: Texture;
  /** Where the tile's sprite would be put, and the map's scale. */
  x: number; y: number; scale: number;
  /** The cell, the height its road stands at, and the way the job comes into it. */
  cx: number; cy: number; h: number; ix: number; iy: number;
  deck: boolean;
};
export type Grow = {
  mesh: Mesh<Geometry, Shader>;
  /** The four trades' fronts, cells past this cell's near edge: nought there, one at its far edge. */
  fronts(f0: number, f1: number, f2: number, f3: number, time: number): void;
  destroy(): void;
};

/** A tile's four corners in its page, pixels: top left, top right, bottom right, bottom left. */
const pagePx = (t: Texture) => {
  const u = t.uvs, w = t.source.pixelWidth, h = t.source.pixelHeight;
  return [[u.x0 * w, u.y0 * h], [u.x1 * w, u.y1 * h], [u.x2 * w, u.y2 * h], [u.x3 * w, u.y3 * h]];
};

/** The vertices of a growing cell, all but its fronts: for the mesh, and for whoever tests where they go. */
export function growVerts(out: Float32Array, c: GrowCell): void {
  const w = c.bare.orig.width * c.scale, h = c.bare.orig.height * c.scale;
  const ax = c.bare.defaultAnchor?.x ?? 0.5, ay = c.bare.defaultAnchor?.y ?? 1;
  const x0 = c.x - ax * w, y0 = c.y - ay * h, a = pagePx(c.bare), b = pagePx(c.lined);
  [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]].forEach(([x, y], k) => {
    const o = k * WORDS;
    // Where this corner is on the map, were it on the cell's own level: the screen undone.
    const sx = x / (HW * c.scale), sy = (y + c.h * HEIGHT_UNIT * c.scale) / (HH * c.scale);
    out[o] = x; out[o + 1] = y;
    out[o + 2] = a[k][0]; out[o + 3] = a[k][1]; out[o + 4] = b[k][0]; out[o + 5] = b[k][1];
    out[o + 6] = (sx + sy) / 2; out[o + 7] = (sy - sx) / 2;
    out[o + 12] = c.ix; out[o + 13] = c.iy; out[o + 14] = c.cx; out[o + 15] = c.cy;
    out[o + 17] = c.deck ? 1 : 0;
  });
}

export function createGrow(c: GrowCell): Grow {
  const data = new Float32Array(4 * WORDS), STRIDE = WORDS * 4;
  growVerts(data, c);
  const vertices = new Buffer({ data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 0 },
      aUvA: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 8 },
      aUvB: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 16 },
      aTile: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 24 },
      aFront: { buffer: vertices, format: "float32x4", stride: STRIDE, offset: 32 },
      aDir: { buffer: vertices, format: "float32x4", stride: STRIDE, offset: 48 },
      aMisc: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 64 },
    },
    indexBuffer: new Buffer({ data: new Uint32Array([0, 1, 2, 0, 2, 3]), usage: BufferUsage.INDEX }),
  });
  const mesh = new Mesh<Geometry, Shader>({ geometry, shader: growShader(c.bare.source, c.lined.source) });
  mesh.eventMode = "none";
  let was = "";
  return {
    mesh,
    fronts(f0, f1, f2, f3, time) {
      // Written only when a front has moved: a cell long finished, or not yet begun, costs nothing.
      const key = `${f0.toFixed(3)},${f1.toFixed(3)},${f2.toFixed(3)},${f3.toFixed(3)}`;
      if (key === was) return;
      was = key;
      for (let k = 0; k < 4; k++) { const o = k * WORDS; data[o + 8] = f0; data[o + 9] = f1; data[o + 10] = f2; data[o + 11] = f3; data[o + 16] = time; }
      vertices.update();
    },
    destroy() { mesh.parent?.removeChild(mesh); mesh.destroy(); geometry.destroy(true); },
  };
}

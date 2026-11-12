/**
 * World v2 — THE GLASS SECTIONS of a main, and what is in them. @see pipe-mesh
 *
 * The one place the pipes leave their flat three tones, on purpose: this is
 * where the player watches the fluid. A window is a half cylinder of mesh,
 * BUILT ONCE; everything inside it is worked out a pixel at a time, from
 * where the pixel sits across the tube and along it. A circle's cross-section
 * is closed-form, so there is no marching and no loop:
 *
 *   the sight through a pixel goes in at the near glass and out at the far
 *   wall, straight across the circle. Across the half ring the camera sees
 *   — `across`, nought at one edge to one at the other — the near point is
 *   `cos t · e1 + sin t · e2` and the far one `cos t · e1 − sin t · e2`,
 *   with `t = π · across`, e1 the edge's direction and e2 the way to the
 *   camera. Their HEIGHTS are all the liquid needs, and e1's and e2's
 *   heights are two numbers a window: so how far the sight runs through
 *   liquid lying below a level is one division.
 *
 * WHAT MOVES IS FOUR NUMBERS A VERTEX, written into the mesh in place each
 * frame: the liquid's level there, how far its pattern has been carried,
 * how much of it is slop, and how high it last stood (the film it left).
 * And its speed. Nothing is built, nothing destroyed, no draw list touched:
 * the mesh the host used to build again every frame is gone.
 * @see plans/pipe-network.md §6 "The glass sections"
 */
import { Buffer, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh, Shader } from "pixi.js";

import { HH, HW } from "../iso";
import { KZ, halfRing } from "./pipe-mesh";

/** Floats a vertex: x, y; the normal; across, along, e1's height, e2's; level, carried, slop, film; the window's two ends, and the speed. */
export const GLASS_WORDS = 16;
/** Where in a vertex what is written each frame starts: level, carried, slop, film — and, three on, the speed. */
const LIVE = 9, SPEED = 15;
/** Faces round a window's half ring. */
const SIDES = 16;

/** What a window shows, at one of its ends. */
export type GlassEnd = {
  /** The liquid's level across the bore, −1 at its floor to 1 at its crown; past 1, full and under pressure. */
  level: number;
  /** How high it last stood: what it left on the glass above it. */
  film: number;
};
/** What a window shows this frame. */
export type GlassState = {
  ends: readonly [GlassEnd, GlassEnd];
  /** How far its pattern has been carried along the run, tiles: the flow, added up. */
  carried: number;
  /** Tiles a second it is going, never negative. */
  speed: number;
  /** How much of it is slop, nought to one. */
  slop: number;
};

/** A band's windows being built: vertices, triangles, and where each window's are. */
export type GlassMesh = { f32: Float32Array; idx: Uint32Array; nv: number; ni: number; panes: number[] };
export const glassMesh = (): GlassMesh => ({ f32: new Float32Array(0), idx: new Uint32Array(0), nv: 0, ni: 0, panes: [] });

/** Vertices a window has: a ring at either end. */
export const PANE_VERTS = (SIDES / 2 + 1) * 2;

/**
 * A WINDOW from (au, av, ah) to (bu, bv, bh), radius `r`, at scale `s`: the
 * half of the tube the camera sees. `lo` and `hi` are where the whole glass
 * section it is a piece of begins and ends along the run, for the dark line
 * of its thickness there. Returns which window of the mesh it is.
 */
export function glassPane(
  m: GlassMesh, s: number, au: number, av: number, ah: number, bu: number, bv: number, bh: number, r: number, lo: number, hi: number,
): number {
  const du = bu - au, dv = bv - av, dh = bh - ah, half = SIDES / 2;
  const need = (m.nv + PANE_VERTS) * GLASS_WORDS;
  if (need > m.f32.length) { const f = new Float32Array(Math.max(need, m.f32.length * 2)); f.set(m.f32); m.f32 = f; }
  if (m.ni + half * 6 > m.idx.length) { const i = new Uint32Array(Math.max(m.ni + half * 6, m.idx.length * 2)); i.set(m.idx); m.idx = i; }
  const n = halfRing(du, dv, dh, half), first = m.nv;
  // e1 is the ring's first normal, at the tube's edge; e2 the one a quarter turn on, toward the camera.
  const e1h = n[2], e2h = n[(half / 2) * 3 + 2];
  // Along the run, as a tube counts it: its place on the map the way it goes, the larger part positive.
  const len = Math.hypot(du, dv, dh), big = Math.abs(du) >= Math.abs(dv) ? du : dv, f = (big < 0 ? -1 : 1) / len;
  const along = [(au * du + av * dv + ah * dh) * f, (bu * du + bv * dv + bh * dh) * f];
  for (let k = 0; k <= half; k++) {
    const nu = n[k * 3], nv = n[k * 3 + 1], nh = n[k * 3 + 2];
    for (const [e, [u, v, h]] of [[au, av, ah], [bu, bv, bh]].entries()) {
      const o = m.nv++ * GLASS_WORDS, pu = u + nu * r, pv = v + nv * r, ph = h + nh * r;
      m.f32[o] = (pu - pv) * HW * s;
      m.f32[o + 1] = (pu + pv) * HH * s - ph * KZ * s;
      m.f32[o + 2] = nu; m.f32[o + 3] = nv; m.f32[o + 4] = nh;
      m.f32[o + 5] = k / half; m.f32[o + 6] = along[e]; m.f32[o + 7] = e1h; m.f32[o + 8] = e2h;
      // Empty and dry till it is told otherwise.
      m.f32[o + LIVE] = -1; m.f32[o + LIVE + 1] = 0; m.f32[o + LIVE + 2] = 0; m.f32[o + LIVE + 3] = -1;
      m.f32[o + 13] = Math.min(lo, hi); m.f32[o + 14] = Math.max(lo, hi); m.f32[o + SPEED] = 0;
    }
  }
  for (let k = 0; k < half; k++) {
    const a0 = first + k * 2;
    m.idx[m.ni++] = a0; m.idx[m.ni++] = a0 + 1; m.idx[m.ni++] = a0 + 3;
    m.idx[m.ni++] = a0; m.idx[m.ni++] = a0 + 3; m.idx[m.ni++] = a0 + 2;
  }
  m.panes.push(first);
  return m.panes.length - 1;
}

/**
 * WRITE WHAT A WINDOW SHOWS into vertices: its first end's level and film on
 * the ring there, its second's on the other, the rest on both. `along` says
 * which end is which: true where the mesh's first ring is the state's first.
 */
export function writeGlass(f32: Float32Array, first: number, st: GlassState, along = true) {
  for (let v = 0; v < PANE_VERTS; v++) {
    const o = (first + v) * GLASS_WORDS, end = st.ends[(v % 2 === 0) === along ? 0 : 1];
    f32[o + LIVE] = end.level; f32[o + LIVE + 1] = st.carried; f32[o + LIVE + 2] = st.slop; f32[o + LIVE + 3] = end.film;
    f32[o + SPEED] = st.speed;
  }
}

const UP = [-0.5 * (HH / HW) * Math.SQRT2, -0.5 * (HH / HW) * Math.SQRT2, Math.sqrt(1 - (HH / HW) ** 2)];
const v3 = (a: readonly number[]) => a.map((c) => c.toFixed(5)).join(", ");
const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((k) => (k / 255).toFixed(4)).join(", ");
/** Water and slop as they look deep; the pipe's far wall, dark and wet; a lump in slop. */
export const GLASS_COLOURS = { water: 0x2f8fd0, slop: 0x6b4a26, wall: 0x3c474f, lump: 0x3d2a14 } as const;

/**
 * THE PICTURE, a pixel at a time. The same lines in both dialects but for
 * their types: every `let` is a number, but for the names the GLSL is told
 * are vectors. @see VECTORS
 */
const shade = (vec3: string) => `
  let n = normalize(vNormal);
  let ac = vA.x;
  let al = vA.y;
  let tt = ac * 3.14159265;
  let sT = sin(tt);
  let cT = cos(tt);
  // WHERE THE SIGHT GOES IN AND COMES OUT, by height across the bore: −1 its floor, 1 its crown.
  let zf = cT * vA.z + sT * vA.w;
  let zb = cT * vA.z - sT * vA.w;
  // Far off, the marks go and the level stays: a flat colour at the right height.
  let fine = 1.0 - smoothstep(0.03, 0.09, fwidth(al));
  let slop = clamp(vB.z, 0.0, 1.0);
  let water = 1.0 - slop;
  let speed = vC.z;
  let run = smoothstep(0.02, 0.3, speed);
  let carried = al - vB.y;

  // THE LEVEL: slop heaves in broad swells as it goes.
  let level = vB.x + 0.07 * slop * sin(carried * 4.0) * fine;
  // HOW FAR THROUGH LIQUID the sight runs: the share of its chord that lies below the level.
  let low = min(zf, zb);
  let below = clamp((level - low) / max(abs(zf - zb), 0.0001), 0.0, 1.0);
  let depth = 2.0 * sT * below;
  // Water stays see-through to the far wall; slop is opaque within a finger's width.
  let body = 1.0 - exp(-depth * mix(0.6, 7.0, slop));
  let liquid = mix(${vec3}(${rgb(GLASS_COLOURS.water)}), ${vec3}(${rgb(GLASS_COLOURS.slop)}), slop);
  // THE FAR WALL, dark and wet: an empty section is an empty pipe, not a hole.
  let wall = ${vec3}(${rgb(GLASS_COLOURS.wall)}) * (0.72 + 0.28 * smoothstep(1.0, -1.0, zb));

  // LUMPS in slop, half sunk, carried along; BUBBLES through water that is full and going.
  let lq = carried * 2.2;
  let lumpAt = 0.3 + 0.4 * fract(sin(floor(lq) * 12.9898 + 7.0) * 43758.5453);
  let lx = fract(lq) - 0.5;
  let ly = ac - lumpAt;
  let lump = (1.0 - smoothstep(0.07, 0.1, sqrt(lx * lx * 0.2 + ly * ly))) * slop * step(0.05, depth) * fine;
  let full = step(1.0, level) * step(0.999, below);
  let bq = carried * 4.0;
  let bubbleAt = 0.25 + 0.5 * fract(sin(floor(bq) * 78.233) * 43758.5453);
  let bx = fract(bq) - 0.5;
  let by = ac - bubbleAt;
  let bubble = (1.0 - smoothstep(0.03, 0.045, sqrt(bx * bx * 0.09 + by * by))) * full * run * water * fine;

  // LOOKING DOWN ONTO THE SURFACE: two patterns carried at different speeds, so it never repeats;
  // ripples that lengthen into streaks as it quickens; flecks of foam past a speed; glassy when it stands.
  let onto = step(level, zf) * step(zb, level);
  let stretch = mix(1.0, 0.35, smoothstep(0.3, 1.5, speed));
  let p1 = carried * 7.0 * stretch;
  let p2 = (al - vB.y * 0.62) * 4.3 * stretch;
  let ripple = sin(p1 + 2.5 * sin(p2 + ac * 6.0)) * sin(p2 * 1.7 + ac * 9.0);
  let glitter = smoothstep(0.5, 0.9, ripple) * onto * run * water * fine;
  // Flecks: small and round, one to a stretch of the run and not on every stretch.
  let fq = carried * 11.0;
  let fleck = fract(sin(floor(fq) * 12.9898) * 43758.5453);
  let fx = fract(fq) - 0.5;
  let fy = ac - (0.2 + 0.6 * fract(fleck * 7.31));
  let foam = (1.0 - smoothstep(0.012, 0.022, sqrt(fx * fx * 0.012 + fy * fy))) * step(0.45, fleck) * smoothstep(0.9, 1.6, speed) * onto * water * fine;
  // And the bright line where the surface meets the glass.
  let meniscus = (1.0 - smoothstep(0.03, 0.09, abs(zf - level))) * step(-0.97, level) * step(level, 0.97);

  let inner0 = mix(wall, liquid, body);
  let inner1 = mix(inner0, ${vec3}(${rgb(GLASS_COLOURS.lump)}), 0.6 * lump);
  let inner = inner1 + ${vec3}(1.0, 1.0, 1.0) * (0.3 * glitter + 0.5 * foam + 0.22 * bubble + onto * (0.05 + 0.07 * water) + 0.28 * meniscus);

  // WHAT IT LEFT ON THE GLASS above the level, where it stood: a smear, beaded; and on a sewer its tide line.
  let stood = step(level, zf) * step(zf, vB.w);
  let bead = 0.55 + 0.45 * fract(sin(floor(al * 14.0) * 12.9898 + floor(ac * 10.0) * 78.233) * 43758.5453);
  let wet = mix(inner, liquid, stood * mix(0.12, 0.4, slop) * bead);
  let tide = (1.0 - smoothstep(0.02, 0.06, abs(zf - vB.w))) * slop * step(level + 0.06, vB.w) * fine;

  // THE GLASS: clear in the middle, brighter toward its edges where it is seen at a slant;
  // a sharp line of the sun along the top and a softer, wider one lower down.
  let top = dot(n, ${vec3}(${v3(UP)}));
  let rim = pow(1.0 - sT, 2.5);
  let sun = smoothstep(0.93, 0.95, top);
  let glow = smoothstep(0.3, 0.45, top) * (1.0 - smoothstep(0.5, 0.65, top));
  // Its thickness, a thin dark line at each end of the section.
  let ends = min(al - vC.x, vC.y - al);
  let cut = 1.0 - smoothstep(0.01, 0.022, ends);
  let col = ((wet * (1.0 - 0.3 * tide)) + ${vec3}(1.0, 1.0, 1.0) * (0.05 + 0.38 * rim + 0.45 * sun + 0.14 * glow)) * (1.0 - 0.7 * cut);
`;
/** The names in `shade` that are vectors. */
const VECTORS = "n|liquid|wall|inner0|inner1|inner|wet|col";

export const glassShaderSource = () => /* wgsl */ `
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
  @location(1) vA: vec4<f32>,
  @location(2) vB: vec4<f32>,
  @location(3) vC: vec3<f32>,
  @location(4) vTint: vec4<f32>,
};

@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
  @location(1) aNormal: vec3<f32>,
  @location(2) aA: vec4<f32>,
  @location(3) aB: vec4<f32>,
  @location(4) aC: vec3<f32>,
) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix
          * globalUniforms.uWorldTransformMatrix
          * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  var out: VSOutput;
  out.position = vec4<f32>(clip.xy, 0.0, 1.0);
  out.vNormal = aNormal;
  out.vA = aA;
  out.vB = aB;
  out.vC = aC;
  out.vTint = localUniforms.uColor * globalUniforms.uWorldColorAlpha;
  return out;
}

@fragment
fn mainFragment(
  @location(0) vNormal: vec3<f32>,
  @location(1) vA: vec4<f32>,
  @location(2) vB: vec4<f32>,
  @location(3) vC: vec3<f32>,
  @location(4) vTint: vec4<f32>,
) -> @location(0) vec4<f32> {
${shade("vec3<f32>")}
  return vec4<f32>(col, 1.0) * vTint;
}
`;

const VERTEX_GLSL = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec3 aNormal;
in vec4 aA;
in vec4 aB;
in vec3 aC;
out vec3 vNormal;
out vec4 vA;
out vec4 vB;
out vec3 vC;
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
  vA = aA;
  vB = aB;
  vC = aC;
  vTint = uColor * uWorldColorAlpha;
}
`;

export const glassFragmentGlsl = () => /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec4 vA;
in vec4 vB;
in vec3 vC;
in vec4 vTint;
out vec4 finalColor;

void main() {
${shade("vec3").replace(new RegExp(`\\blet (${VECTORS}) =`, "g"), "vec3 $1 =").replace(/\blet /g, "float ")}
  finalColor = vec4(col, 1.0) * vTint;
}
`;

let shared: Shader | null = null;
function glassShader(): Shader {
  if (shared) return shared;
  const wgsl = glassShaderSource();
  shared = new Shader({
    gpuProgram: GpuProgram.from({
      vertex: { source: wgsl, entryPoint: "mainVertex" },
      fragment: { source: wgsl, entryPoint: "mainFragment" },
      name: "pipe glass",
    }),
    glProgram: GlProgram.from({ vertex: VERTEX_GLSL, fragment: glassFragmentGlsl(), name: "pipe glass" }),
  });
  return shared;
}

/**
 * A band's windows, made drawable, and the way to say what each shows:
 * `show(pane, state)` writes that window's vertices, `flush()` sends up what
 * changed — once a frame, and only if something did.
 */
export function glassDrawable(m: GlassMesh): {
  mesh: Mesh<Geometry, Shader>; show: (pane: number, st: GlassState, along?: boolean) => void; flush: () => void;
} {
  const STRIDE = GLASS_WORDS * 4, data = m.f32.slice(0, m.nv * GLASS_WORDS);
  const vertices = new Buffer({ data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
  const indices = new Buffer({ data: m.idx.slice(0, m.ni), usage: BufferUsage.INDEX });
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 0 },
      aNormal: { buffer: vertices, format: "float32x3", stride: STRIDE, offset: 8 },
      aA: { buffer: vertices, format: "float32x4", stride: STRIDE, offset: 20 },
      aB: { buffer: vertices, format: "float32x4", stride: STRIDE, offset: 36 },
      aC: { buffer: vertices, format: "float32x3", stride: STRIDE, offset: 52 },
    },
    indexBuffer: indices,
  });
  const mesh = new Mesh<Geometry, Shader>({ geometry, shader: glassShader() });
  mesh.eventMode = "none";
  const panes = m.panes.slice();
  let dirty = false;
  return {
    mesh,
    show: (pane, st, along = true) => { writeGlass(data, panes[pane], st, along); dirty = true; },
    flush: () => { if (dirty) { vertices.update(); dirty = false; } },
  };
}

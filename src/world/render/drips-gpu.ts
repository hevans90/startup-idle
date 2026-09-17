/**
 * World v2 — drawing the water that is in the AIR, on the GPU.
 *
 * Its own layer rather than part of the water mesh, and deliberately. That
 * mesh is a function of the COLUMNS — one quad per column, whether it is built
 * on the CPU or in a vertex shader — and a drop is not on a column, it is at a
 * point in the air between one place and another. Bolting it on would mean
 * giving every column a drop it almost never has.
 *
 * WHAT A DROP IS DRAWN AS. Not a rectangle, which is what this used to be, and
 * you could see it. A bead of water has a silhouette and the silhouette is
 * where all of the information is, so every site here is a closed outline,
 * built in the vertex shader as a fan of {@link RING} points around a
 * parametric curve. Which curve depends on what the site is:
 *
 *   A FREE DROP is the teardrop curve, `x = cos t`, `y = sin t sin^m(t/2)`,
 *   with the cusp TRAILING the direction of travel. At `m = 0` that is exactly
 *   a circle, which is what a drop at rest wants to be, and the exponent is
 *   what draws the tail out as it picks up speed.
 *
 *   A HANGING DROP is the same curve with the cusp pointing up into the mouth
 *   and the exponent driven by how full it is, which is the NECK. A drop grows
 *   nearly round and then, in the last of it, the neck thins and goes. That is
 *   most of the reason this file exists: the growing and the necking were
 *   happening in the solver the whole time and nothing ever showed them.
 *
 *   A FITTING is the same machinery with the outline pushed out to a
 *   rectangle, because a pipe is a pipe and does not need a pass of its own.
 *
 * The shape a drop is the rest of the time — the ringing it does after it
 * pinches off, how fast it is going, how much is in it — is worked out in
 * `fluid/drips` and arrives here as two radii and an axis. This end does not
 * know what an oscillation is. It draws an outline around a point.
 *
 * HOW IT GETS THERE. One small float texture, one row per band, a fixed number
 * of sites across. Each band's mesh reads its own row, so nothing has to be
 * told where its sites start and no uniform changes after the layer is built —
 * which matters, because there are as many meshes as the map has diagonals and
 * a uniform rewritten per band per frame is exactly the cost that only shows
 * up on the big map. Bands with nothing on them are switched off outright, so
 * a map with one pipe on it pays for one band.
 */
import {
  Buffer, BufferImageSource, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh,
  Shader, TextureSource, UniformGroup,
} from "pixi.js";

import { MATERIAL_SLOTS } from "../../fluid/columns";
import { DROP, STREAK } from "../../fluid/drips";
import { DIR, NEIGHBOUR } from "../../iso/dir";
import { heightAt, type Grid } from "../grid";
import { fluidMaterial } from "../water/materials";
import { COLUMNS_PER_TILE, tileOf, type WaterField } from "../water/field";
import { PIPE_D, PIPE_FACINGS, pipeAcross, pipeDepth, pipeMouth } from "../water/pipes";
import { findPipeNets, pipeCellCount } from "../water/pipe-net";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import type { BandLayer } from "./bands";

/**
 * Points around a silhouette.
 *
 * Fourteen, because a drop is a handful of pixels across and the fan is
 * unrolled per site whether or not anything can see the difference. At eight
 * the rim of a big drop is visibly a polygon; at fourteen it is not, and at
 * twenty-eight nothing changes but the vertex count.
 */
const RING = 14;

/**
 * Sites one band may draw at once.
 *
 * A band is one diagonal of the map and what lands on it is whatever drops are
 * falling through it plus every length of pipe standing on it — up to five
 * sites a cell, since a junction draws a spur to each of its four neighbours
 * and a stub out of its opening. Past this the extra ones are not DRAWN; the
 * drops still exist, still fall and still land, because this file has no say
 * in any of that. A band with this many drops in flight is already a curtain
 * of water and the next one is not what is carrying it.
 */
const SITES = 96;

/**
 * What a site is, which decides its outline and how it is lit.
 *
 * The first two are round things in the air and the rest are bars: anything
 * from {@link KIND_NUB} up takes the rectangular outline, because a pipe and
 * the water lying in it are both lengths of something.
 */
const KIND_DROP = 0;
const KIND_HELD = 1;
const KIND_NUB = 2;
const KIND_FLOW = 3;
const KIND_PRESSED = 4;
const KINDS = 5;

/** Floats per site: two RGBA texels. */
const STRIDE = 8;

/** Half the width of a drop of {@link DROP}'s size, in tiles. */
const WIDE = 0.042;

/**
 * Screen speed, in pixels a second, at which a drop's tail is fully drawn out,
 * and how pointed it is when it is.
 *
 * The tail makes the same claim the streak does — see `STREAK` in
 * `fluid/drips` — and comes on with speed for the same reason: a thing moving
 * fast enough to blur does not read as a bead with a crisp edge all the way
 * round.
 */
const TAIL_SPEED = 700;
const TAIL_MOST = 1.6;

/**
 * The neck: how pointed a hanging drop gets, and when it starts.
 *
 * Nothing happens for the first half — a growing pendant drop is close enough
 * to round that a neck drawn early reads as a mistake — and then it arrives
 * over the last of it, which is the Rayleigh-Plateau instability doing what it
 * does. A thread of liquid is unstable to any wavelength longer than its own
 * circumference, so once a neck is thin it does not thin gently.
 */
const NECK_FROM = 0.45;
const NECK_MOST = 3.2;
/** How far a full drop hangs below its mouth, in its own radii. */
const HANG = 1.2;
/** Below this fraction of a drop there is nothing worth drawing. */
const HELD_SHOWS = 0.06;

/** How far towards white a drop is: falling water catches the light. */
const LIT = 0.32;
/** And how far a surcharged pipe's water is, which is how you spot one. */
const PRESSED_LIT = 0.62;
/** A drop is small and bright rather than something you see through. */
const ALPHA = 0.92;

/**
 * Where the light is, in screen space, and how much of the shading it does.
 *
 * Up and to the left, which is where the terrain is lit from, and tilted out
 * of the screen so a bead has a bright side rather than a bright edge. The
 * specular term is what makes it read as water and not as a coloured pebble:
 * a drop is a lens, and the one thing everybody has seen a drop do is catch a
 * highlight.
 */
const LIGHT = { x: -0.44, y: -0.66, z: 0.61 };
/** How much the water in a pipe brightens towards its own middle. */
const FLOW_SHEEN = 0.3;
const AMBIENT = 0.24;
const DIFFUSE = 0.42;
const SPECULAR = 0.85;
const SHINE = 26;

/** The fitting itself: a short dark stub sticking out of the face. */
const NUB_COLOUR = 0x4a4f55;
/**
 * Half a pipe's thickness, and how far back into the wall it starts, in tiles.
 *
 * Slimmer than the bore the solver uses, and deliberately. `PIPE_D` is two half
 * steps, which against the projection's own foreshortening is half a tile
 * across — drawn at its true size a pipe is a tunnel lying on the ground, and
 * a run of them reads as a wall. This is the width at which a run still reads
 * as PIPEWORK.
 */
const NUB_WIDE = 0.07;
const NUB_BACK = 0.05;

/**
 * How far inside the casing the water lies, in tiles.
 *
 * A rim of pipe left showing all the way round, so a full bore still reads as
 * water INSIDE something rather than as a bar of water with a dark line either
 * side of it. One pixel at a middling zoom, which is all it takes.
 */
const LINING = 0.012;

/**
 * How far a buried pipe fades, at its most.
 *
 * It cannot vanish: a run you cannot see is a run you cannot edit, and the
 * whole point of burying one is that you go on working around it. It cannot
 * stay solid either, or it reads as lying on the grass it is in fact under.
 * So it is a ghost of itself, fading with how deep it has got — which doubles
 * as a readout of the burial you never had to set.
 */
const GHOST_MOST = 0.72;
/** Buried by this many half steps and it is as faint as it gets. */
const GHOST_DEEP = 8;

/** Limbs one cell can have: one to each neighbour, and one out of its face. */
const MAX_LIMBS = 5;
const LIMB = new Float32Array(MAX_LIMBS * 4);

const FACE_OF: Record<number, keyof typeof DIR> = {
  [DIR.N]: "N", [DIR.E]: "E", [DIR.S]: "S", [DIR.W]: "W",
};

/**
 * THE SHADERS, written once and spoken in two languages.
 *
 * Every line of arithmetic here exists exactly once. WebGPU gets WGSL and
 * WebGL2 gets GLSL, and the difference between them is a table of tokens
 * applied to the same text — declarations, constructors, the two names for a
 * texture fetch, and where a vertex shader puts its outputs.
 *
 * The water path does this for the corner rule and did NOT do it for the rest,
 * and the rest is where a hairline of grass appeared along every dip in the
 * bed on one backend and not the other: the rule had been changed in one place
 * and not in its twin. A transliteration is a copy, a copy drifts, and the
 * drift is invisible until somebody with the other backend looks at the map.
 * So nothing here is transliterated.
 *
 * The tokens, in full:
 *   `F` `I` `V2` `V3` `V4` `M3`   a declaration of that type
 *   `MUTF` `MUT2`                 a MUTABLE float or vec2 declaration
 *   `VEC2` `VEC3` `VEC4` `IVEC2`  constructors
 *   `FLOAT(` `INT(`               the two casts
 *   `FETCH(`                      textureLoad / texelFetch
 *   `POS` `CLR` `UNIT` `LGT`      where a vertex shader writes its outputs
 *   `DONE`                        a bare early return from the vertex shader
 */
const TOKENS: Record<"wgsl" | "glsl", [RegExp, string][]> = {
  wgsl: [
    [/\bMUTF /g, "var "],
    [/\bMUT2 /g, "var "],
    [/\b(?:F|I|V2|V3|V4|M3) /g, "let "],
    [/\bIVEC2\(/g, "vec2<i32>("],
    [/\bVEC2\(/g, "vec2<f32>("],
    [/\bVEC3\(/g, "vec3<f32>("],
    [/\bVEC4\(/g, "vec4<f32>("],
    [/\bFLOAT\(/g, "f32("],
    [/\bINT\(/g, "i32("],
    [/\bFETCH\(/g, "textureLoad("],
    [/\bPOS\b/g, "out.position"],
    [/\bCLR\b/g, "out.vColor"],
    [/\bUNIT\b/g, "out.vUnit"],
    [/\bLGT\b/g, "out.vLight"],
    [/\bDONE\b/g, "return out"],
  ],
  glsl: [
    [/\bMUTF /g, "float "],
    [/\bMUT2 /g, "vec2 "],
    [/\bF /g, "float "],
    [/\bI /g, "int "],
    [/\bV2 /g, "vec2 "],
    [/\bV3 /g, "vec3 "],
    [/\bV4 /g, "vec4 "],
    [/\bM3 /g, "mat3 "],
    [/\bIVEC2\(/g, "ivec2("],
    [/\bVEC2\(/g, "vec2("],
    [/\bVEC3\(/g, "vec3("],
    [/\bVEC4\(/g, "vec4("],
    [/\bFLOAT\(/g, "float("],
    [/\bINT\(/g, "int("],
    [/\bFETCH\(/g, "texelFetch("],
    [/\bPOS\b/g, "gl_Position"],
    [/\bCLR\b/g, "vColor"],
    [/\bUNIT\b/g, "vUnit"],
    [/\bLGT\b/g, "vLight"],
    [/\bDONE\b/g, "return"],
  ],
};

/** Speak one piece of shader in one of the two languages. */
function say(body: string, lang: "wgsl" | "glsl"): string {
  let out = body;
  for (const [from, to] of TOKENS[lang]) out = out.replace(from, to);
  return out;
}

/** A point on a site's outline, at `t` of the way round it. */
const OUTLINE_BODY = `{
  F a = cos(t * 6.28318531);
  F s = sin(t * 6.28318531);
  if (kind >= ${KIND_NUB}) {
    // A length of something — pipe, or the water lying in it. The same ring
    // pushed out onto a rectangle.
    F m = max(max(abs(a), abs(s)), 1.0e-4);
    return VEC2(a / m, s / m);
  }
  // The teardrop curve. The exponent is the cusp: at zero this is a circle,
  // and every bit above zero draws the point out further.
  F neck = max(sin(t * 3.14159265), 1.0e-4);
  return VEC2(a, s * pow(neck, taper));
}`;

/** What a lit bead of water looks like at one point on its face. */
const BEAD_BODY = `{
  // The alpha channel carries the kind and, above the point, how buried it is.
  F kind = floor(packed + 0.001);
  F ghost = 1.0 - (packed - kind);
  if (kind > ${KIND_NUB}.5) {
    // WATER SEEN INSIDE A PIPE. Brighter along its middle and falling away to
    // its edges, so a bar of it reads as a rounded body of liquid rather than
    // a painted line. It is the cheapest possible stand-in for the fact that
    // the surface of the water is curved and the walls are in shadow, and at
    // the dozen pixels a pipe is thick it is all there is room to say.
    F across = abs(u.y);
    return VEC4(mix(base, VEC3(1.0, 1.0, 1.0), ${FLOW_SHEEN} * (1.0 - across * across)), ghost);
  }
  if (kind > 1.5) { return VEC4(base, ghost); }  // a fitting is not a bead
  F rr = min(1.0, dot(u, u));
  // The sphere the silhouette is a silhouette OF: the outline gives x and y
  // in the drop's own frame, and the front of the drop is whatever is left of
  // the unit radius. That is enough for a normal, and a normal is enough for
  // the one highlight the eye is actually looking for.
  F nz = sqrt(max(0.0, 1.0 - rr));
  V3 n = VEC3(u.x, u.y, nz);
  F diff = max(0.0, dot(n, light));
  F spec = pow(diff, ${SHINE}.0);
  F white = ${AMBIENT} + diff * ${DIFFUSE} + spec * ${SPECULAR};
  V3 rgb = mix(base, VEC3(1.0, 1.0, 1.0), min(1.0, white));
  // A pixel of softness at the rim, which is the only antialiasing a drop a
  // few pixels across is ever going to get.
  F edge = 1.0 - smoothstep(0.55, 1.0, rr);
  return VEC4(rgb, ${ALPHA} * edge);
}`;

/**
 * One site: read it, build the point of its outline this vertex is, and put it
 * on the screen.
 */
const VERTEX_BODY = `{
  POS = VEC4(0.0, 0.0, 0.0, 1.0);
  CLR = VEC4(0.0, 0.0, 0.0, 0.0);
  UNIT = VEC2(0.0, 0.0);
  LGT = VEC3(0.0, 0.0, 1.0);

  I id = INT(aVertexId + 0.5);
  I per = ${RING + 1};
  I site = id / per;
  I local = id - site * per;

  I row = INT(uRow.x);
  V4 a = FETCH(uSites, IVEC2(site * 2, row), 0);
  V4 b = FETCH(uSites, IVEC2(site * 2 + 1, row), 0);
  // px, py, across, along | axisX, axisY, taper, material + kind * 256
  //
  // An empty slot has no width, and a site with no width has nowhere to put
  // its vertices: they all land on the same point and the triangles between
  // them have no area. That is how a procedural draw skips something.
  if (a.z <= 0.0) { DONE; }

  I packed = INT(b.w + 0.5);
  I kind = packed / 256;
  I mat = packed - kind * 256;

  MUT2 u = VEC2(0.0, 0.0);
  if (local > 0) { u = outlineAt(FLOAT(local - 1) / ${RING}.0, b.z, kind); }
  V2 axis = VEC2(b.x, b.y);
  V2 perp = VEC2(-b.y, b.x);
  V2 p = a.xy + axis * (u.x * a.w) + perp * (u.y * a.z);

  M3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  V3 clip = mvp * VEC3(p.x, p.y, 1.0);
  POS = VEC4(clip.x, clip.y, 0.0, 1.0);
  UNIT = u;
  // The light lives in SCREEN space and the drop does not, so the light is
  // turned into the drop's frame here rather than the drop out of it. One
  // rotation per vertex against one per fragment, and the drop's frame is
  // where the outline has already put everything.
  LGT = VEC3(
    dot(VEC2(${LIGHT.x}, ${LIGHT.y}), axis),
    dot(VEC2(${LIGHT.x}, ${LIGHT.y}), perp),
    ${LIGHT.z}
  );
  // The kind, and — for the bars — how far UNDER the ground this one is,
  // packed into the one spare channel. A buried pipe still has to be drawn or
  // it cannot be edited, but it must not read as lying on the grass, so it is
  // drawn as a ghost of itself. The taper slot carries it: a bar's outline is
  // a rectangle and has no use for a taper.
  MUTF ghost = 0.0;
  if (kind >= ${KIND_NUB}) { ghost = b.z; }
  CLR = VEC4(FETCH(uTint, IVEC2(mat, kind), 0).rgb, FLOAT(kind) + ghost);
  DONE;
}`;

/** The three shared bodies, in one language. For the test, and for the shaders. */
export function dripShaderSource(lang: "wgsl" | "glsl") {
  return {
    outline: say(OUTLINE_BODY, lang),
    bead: say(BEAD_BODY, lang),
    vertex: say(VERTEX_BODY, lang),
  };
}

const WGSL = dripShaderSource("wgsl");
const GLSL = dripShaderSource("glsl");

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

struct Drips {
  uRow: vec4<f32>,        // this band's row, sites per band, spare, spare
};
@group(2) @binding(0) var<uniform> drips : Drips;
@group(2) @binding(1) var uSites : texture_2d<f32>;
@group(2) @binding(2) var uTint : texture_2d<f32>;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vColor: vec4<f32>,
  @location(1) vUnit: vec2<f32>,
  @location(2) vLight: vec3<f32>,
};

fn outlineAt(t: f32, taper: f32, kind: i32) -> vec2<f32> ${WGSL.outline}

@vertex
fn mainVertex(@location(0) aVertexId: f32) -> VSOutput {
  var out: VSOutput;
  // The uniforms arrive in structs on this backend and as plain names on the
  // other, so the shared body is written in the plain names and they are
  // bound to the struct fields here. Four aliases, and no arithmetic in sight.
  let uRow = drips.uRow;
  let uProjectionMatrix = globalUniforms.uProjectionMatrix;
  let uWorldTransformMatrix = globalUniforms.uWorldTransformMatrix;
  let uTransformMatrix = localUniforms.uTransformMatrix;
  ${WGSL.vertex.slice(1, -1)}
}
`;

const FRAGMENT_WGSL = /* wgsl */ `
fn bead(base: vec3<f32>, u: vec2<f32>, light: vec3<f32>, packed: f32) -> vec4<f32> ${WGSL.bead}

@fragment
fn mainFragment(
  @location(0) vColor: vec4<f32>,
  @location(1) vUnit: vec2<f32>,
  @location(2) vLight: vec3<f32>,
) -> @location(0) vec4<f32> {
  let shaded = bead(vColor.rgb, vUnit, vLight, vColor.a);
  return vec4<f32>(shaded.rgb * shaded.a, shaded.a);
}
`;

const VERTEX_GLSL = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in float aVertexId;
out vec4 vColor;
out vec2 vUnit;
out vec3 vLight;

// PLAIN uniforms, not a block. Pixi hands the globals to a WebGL program one
// at a time, and a block declared here binds no buffer, which drops the draw
// silently. The water path learned that the hard way; see water-gpu.
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;

uniform vec4 uRow;
uniform sampler2D uSites;
uniform sampler2D uTint;

vec2 outlineAt(float t, float taper, int kind) ${GLSL.outline}

void main() ${GLSL.vertex}
`;

const FRAGMENT_GLSL = /* glsl */ `#version 300 es
precision highp float;

in vec4 vColor;
in vec2 vUnit;
in vec3 vLight;
out vec4 fragColor;

vec4 bead(vec3 base, vec2 u, vec3 light, float packed) ${GLSL.bead}

void main() {
  vec4 shaded = bead(vColor.rgb, vUnit, vLight, vColor.a);
  fragColor = vec4(shaded.rgb * shaded.a, shaded.a);
}
`;

export type GpuDripLayer = {
  meshes: Mesh<Geometry, Shader>[];
  /** One row per band, {@link SITES} sites across, two texels each. */
  data: Float32Array;
  source: TextureSource;
  tint: TextureSource;
  scale: number;
  /** Which bands hold sites, or held some last frame — both need clearing. */
  live: Set<number>;
  /** Slots used per band this frame. Kept here so a frame allocates nothing. */
  used: Int32Array;
  /** Milliseconds of CPU the last frame's build took, for measuring. */
  cpuMs: number;
};

const VERTEX_STAGE = 1;
const FRAGMENT_STAGE = 2;

/**
 * The bind group layout, written out rather than left to Pixi — the same
 * reason as the water path. Both textures are read in the VERTEX stage, which
 * Pixi's generated layout never expects, and an `rgba32float` texture is
 * UNFILTERABLE, which a filterable binding will not accept.
 *
 * Every uniform is VERTEX AND FRAGMENT even though this shader reads them in
 * the vertex stage alone, and that is not sloppiness. Groups 0 and 1 are
 * Pixi's — the globals and the local transform — and Pixi builds ONE bind
 * group for them and hands it to every pipeline in the frame. A layout that
 * disagrees with it about anything, visibility included, does not merely fail
 * to bind: the device rejects the draw, which invalidates the command buffer,
 * which throws away every other draw encoded alongside it.
 *
 *   Bind group layout of pipeline layout does not match layout of bind group
 *   set at group index 0. While encoding RenderPassEncoder.DrawIndexed(1008)
 *
 * What that looks like is a completely black map with the overlay insisting
 * it has drawn every band, because it has — into a command buffer nobody
 * submitted. Declared vertex-only here, this layer took the whole world down
 * with it.
 */
function gpuLayout(): GPUBindGroupLayoutEntry[][] {
  const uniform = (binding: number): GPUBindGroupLayoutEntry => ({
    binding, visibility: VERTEX_STAGE | FRAGMENT_STAGE, buffer: { type: "uniform" },
  });
  const texture = (binding: number, sampleType: GPUTextureSampleType): GPUBindGroupLayoutEntry => ({
    binding, visibility: VERTEX_STAGE,
    texture: { sampleType, viewDimension: "2d", multisampled: false },
  });
  return [
    [uniform(0)],
    [uniform(0)],
    [uniform(0), texture(1, "unfilterable-float"), texture(2, "float")],
  ];
}

let shared: { gpu: GpuProgram; gl: GlProgram } | null = null;
function programs() {
  if (!shared) {
    shared = {
      gpu: new GpuProgram({
        vertex: { source: VERTEX_WGSL, entryPoint: "mainVertex" },
        fragment: { source: FRAGMENT_WGSL, entryPoint: "mainFragment" },
        name: "water-drips",
        layout: [
          { globalUniforms: 0 },
          { localUniforms: 0 },
          { drips: 0, uSites: 1, uTint: 2 },
        ],
        gpuLayout: gpuLayout(),
      }),
      gl: GlProgram.from({ vertex: VERTEX_GLSL, fragment: FRAGMENT_GLSL, name: "water-drips" }),
    };
  }
  return shared;
}

/** Lighten a colour towards white, the way moving water is lightened. */
function aerate(colour: number, t: number): number {
  const ch = (sh: number) => {
    const c = (colour >> sh) & 0xff;
    return Math.min(255, Math.round(c + (255 - c) * t));
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * A colour per material per kind: free drops and hanging drops in the fluid's
 * own colour lightened for the air, and fittings in the fitting's colour.
 */
function tintSource(): TextureSource {
  const px = new Uint8Array(MATERIAL_SLOTS * KINDS * 4);
  for (let kind = 0; kind < KINDS; kind++) {
    for (let m = 0; m < MATERIAL_SLOTS; m++) {
      const own = fluidMaterial(m)?.colour ?? 0x2a6f97;
      // A drop in the air has air in it and is lightened for it; water lying
      // in a pipe has not, so it keeps more of its own colour. Water under
      // PRESSURE is lightened hard, because that is the only thing on the map
      // that can say which parts of a network are surcharged and which are
      // merely full — and it is worth being able to see at a glance.
      const base = kind === KIND_NUB ? NUB_COLOUR
        : kind === KIND_FLOW ? aerate(own, LIT * 0.3)
        : kind === KIND_PRESSED ? aerate(own, PRESSED_LIT)
        : aerate(own, LIT);
      const o = (kind * MATERIAL_SLOTS + m) * 4;
      px[o] = (base >> 16) & 0xff;
      px[o + 1] = (base >> 8) & 0xff;
      px[o + 2] = base & 0xff;
      px[o + 3] = 255;
    }
  }
  return new BufferImageSource({
    resource: px, width: MATERIAL_SLOTS, height: KINDS, format: "rgba8unorm",
    scaleMode: "nearest",
  });
}

export function createGpuDripLayer(bands: BandLayer, scale = 1): GpuDripLayer {
  const { gpu, gl } = programs();
  const rows = bands.bands.length;

  // Every vertex knows only its own index: which site of its band it belongs
  // to, and which point of that site's ring it is. One buffer, built once,
  // shared by every band.
  const per = RING + 1;
  const ids = new Float32Array(SITES * per);
  for (let v = 0; v < ids.length; v++) ids[v] = v;
  const idx = new Uint32Array(SITES * RING * 3);
  for (let s = 0; s < SITES; s++) {
    const base = s * per;
    for (let r = 0; r < RING; r++) {
      const o = (s * RING + r) * 3;
      idx[o] = base;                              // the middle of the fan
      idx[o + 1] = base + 1 + r;
      idx[o + 2] = base + 1 + ((r + 1) % RING);
    }
  }
  const idBuffer = new Buffer({ data: ids, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
  // One index buffer for every band, not one each: every band draws the same
  // fixed complement of sites, so the indices are the same indices.
  const indexBuffer = new Buffer({ data: idx, usage: BufferUsage.INDEX | BufferUsage.COPY_DST });

  const data = new Float32Array(rows * SITES * STRIDE);
  const source = new BufferImageSource({
    resource: data, width: SITES * 2, height: Math.max(1, rows), format: "rgba32float",
    scaleMode: "nearest",
  });
  const tint = tintSource();

  const meshes: Mesh<Geometry, Shader>[] = [];
  for (let b = 0; b < rows; b++) {
    const uniforms = new UniformGroup({
      uRow: { value: new Float32Array([b, SITES, 0, 0]), type: "vec4<f32>" },
    });
    const geometry = new Geometry({
      attributes: { aVertexId: { buffer: idBuffer, format: "float32", stride: 4, offset: 0 } },
      indexBuffer,
    });
    const shader = new Shader({
      gpuProgram: gpu, glProgram: gl,
      resources: { drips: uniforms, uSites: source, uTint: tint },
    });
    const mesh = new Mesh<Geometry, Shader>({ geometry, shader });
    mesh.eventMode = "none";
    mesh.visible = false;
    bands.structureOf[b].addChild(mesh);
    meshes.push(mesh);
  }

  return { meshes, data, source, tint, scale, live: new Set(), used: new Int32Array(rows), cpuMs: 0 };
}

export function destroyGpuDripLayer(dl: GpuDripLayer) {
  for (const m of dl.meshes) {
    m.parent?.removeChild(m);
    m.destroy({ children: true });
  }
  dl.meshes.length = 0;
  dl.live.clear();
}

/**
 * A frame: work out where every drop, hanging drop and fitting is on screen,
 * and write them into the one texture the shaders read.
 *
 * All of the iso projection happens HERE and none of it in the shader, which
 * is the opposite of the water path and right for the opposite reason. The
 * water mesh has a vertex per column and would have to send a position for
 * every one of them, so it sends a grid and lets the shader find the vertex;
 * there are tens of drops, so their positions are the cheapest thing in the
 * frame and working them out once on the CPU beats writing the projection
 * twice more in two dialects.
 */
export function drawGpuDrips(
  dl: GpuDripLayer, field: WaterField, bands: BandLayer, grid: Grid, xray = false,
) {
  const t0 = performance.now();
  const columns = field.columns;
  const { data, meshes, scale } = dl;
  const HWs = HW * scale, HHs = HH * scale, HUs = HEIGHT_UNIT * scale;
  const rows = meshes.length;

  // Clear only what was used: a map with one pipe on it should not walk the
  // whole texture to find the one row that changed.
  for (const b of dl.live) data.fill(0, b * SITES * STRIDE, (b + 1) * SITES * STRIDE);
  const had = dl.live.size > 0;
  dl.live.clear();

  const used = dl.used;
  used.fill(0);

  /** Claim a slot in a band's row, or say there is no room. */
  const put = (band: number): number => {
    if (band < 0 || band >= rows) return -1;
    const n = used[band];
    if (n >= SITES) return -1;
    used[band] = n + 1;
    dl.live.add(band);
    return (band * SITES + n) * STRIDE;
  };

  /** A column coordinate, fractional, as a position in tiles. */
  const toTile = (c: number) => (c + 0.5) / COLUMNS_PER_TILE - 0.5;

  const d = columns.drips;

  // 1. THE DROPS IN THE AIR.
  for (let k = 0; k < d.live; k++) {
    const cx = d.cx[k], cy = d.cy[k];
    const band = tileOf(cx) + tileOf(cy);
    const o = put(band);
    if (o < 0) continue;

    const fx = toTile(cx), fy = toTile(cy);
    // Where it is going, on screen. The two map axes both run down the screen
    // and the fall runs up it, so a drop thrown sideways leans and a drop let
    // go straight down does not.
    const vxT = d.vx[k] / COLUMNS_PER_TILE, vyT = d.vy[k] / COLUMNS_PER_TILE;
    const spx = (vxT - vyT) * HWs;
    const spy = (vxT + vyT) * HHs + d.vz[k] * HUs;
    const speed = Math.hypot(spx, spy);
    // The axis points BACK along the travel, because that is where the tail
    // is. A drop that is not moving keeps the last sensible answer: up.
    const axisX = speed > 1e-3 ? -spx / speed : 0;
    const axisY = speed > 1e-3 ? -spy / speed : -1;

    const r = WIDE * HWs * Math.cbrt(d.volume[k] / DROP);
    // The ringing, as two radii. Long one way is short the other — the drop
    // has a fixed volume and is only changing shape.
    // A CLAMP THAT LETS NaN THROUGH IS NOT A CLAMP. `Math.min(1.2, NaN)` is
    // NaN and so is the `max` around it, so a drop whose ringing came apart
    // put NaN straight into a vertex buffer — four corners at no position at
    // all. The cause is fixed where it belongs, in the integrator, but this
    // is the last gate before the device and it should hold on its own.
    const shape = d.shape[k];
    const s = shape > -0.6 ? (shape < 1.2 ? shape : 1.2) : -0.6;
    const trail = speed * STREAK * 0.5;
    const along = r * (1 + s) + trail;
    const across = r / Math.sqrt(1 + s);

    data[o] = (fx - fy) * HWs + axisX * trail;
    data[o + 1] = (fx + fy) * HHs - d.z[k] * HUs + axisY * trail;
    data[o + 2] = across;
    data[o + 3] = along;
    data[o + 4] = axisX;
    data[o + 5] = axisY;
    data[o + 6] = Math.min(TAIL_MOST, TAIL_MOST * speed / TAIL_SPEED);
    data[o + 7] = d.material[k] + KIND_DROP * 256;
  }

  // 2. THE DROPS STILL HANGING, one per mouth that has anything on it.
  for (let m = 0; m < d.mouths; m++) {
    const held = d.mheld[m];
    if (held < DROP * HELD_SHOWS) continue;
    const cx = d.mcx[m], cy = d.mcy[m];
    const band = tileOf(cx) + tileOf(cy);
    const o = put(band);
    if (o < 0) continue;

    const fx = toTile(cx), fy = toTile(cy);
    const full = Math.min(1, held / DROP);
    const r = WIDE * HWs * Math.cbrt(Math.max(held, 1e-6) / DROP);
    // The neck, which is nothing at all until the drop is most of the way to
    // letting go and then arrives quickly. See NECK_FROM.
    const neck = Math.max(0, (full - NECK_FROM) / (1 - NECK_FROM));
    const along = r * (1 + HANG * neck * neck);
    // Hung so that the CUSP is at the mouth and the drop is below it, which is
    // how a drop hangs: the point is where it is still attached.
    data[o] = (fx - fy) * HWs;
    data[o + 1] = (fx + fy) * HHs - d.mz[m] * HUs + along;
    data[o + 2] = r;
    data[o + 3] = along;
    data[o + 4] = 0;
    data[o + 5] = -1;                             // up the screen, into the mouth
    data[o + 6] = NECK_MOST * neck * neck;
    data[o + 7] = d.mmaterial[m] + KIND_HELD * 256;
  }

  // 3. THE PIPEWORK, AND WHAT IS LYING IN IT. Off the grid rather than built
  //    once, because it is a handful of sites per pipe and an edit changes it
  //    — a pipe that only appeared when it happened to be dripping would be a
  //    pipe nobody could place. A cell draws a LIMB towards every neighbour it
  //    is joined to and one out of whichever face it opens on, so a run you
  //    painted reads as a run: the limbs of two neighbours meet at the face
  //    between them, and every pipe is drawn from its own cell's band, which
  //    is where it sorts.
  //
  //    Each limb is drawn TWICE — the casing, and then the water standing in
  //    it — and every casing of a cell goes down before any of its water, so
  //    that at a junction one limb's wall cannot be painted over the next
  //    limb's water.
  //
  //    OFF THE LIST OF PIPE CELLS rather than off every cell of the map. The
  //    networks are a flood fill over exactly these, kept between edits, so
  //    the cells are already gathered and in hand — see `findPipeNets`. This
  //    walked four thousand tiles to find nineteen.
  const pipes = findPipeNets(grid, field.nets);
  const pipeCells = pipeCellCount(pipes);
  for (let k = 0; k < pipeCells; k++) {
    const i = pipes.cells[k];
    const tx = i % grid.w, ty = (i / grid.w) | 0;
    const facing = grid.pipe[i];
    if (!facing) continue;
    const band = tx + ty;
    // The PIPE's level, not the ground's — a run keeps its grade while the
    // ground rises over it, and drawing it at the ground would put a buried
    // main back on the surface.
    const z = grid.pipeZ[i];
    // How far under the ground this length is, and so how faint. With the
    // ground itself made translucent there is nothing left to fade FOR, and
    // a run drawn faint through a hill you can already see into is just hard
    // to read — so in that mode a buried pipe is drawn like any other.
    const under = (heightAt(grid, tx, ty) ?? 0) - z;
    const ghost = xray || under <= 0
      ? 0
      : GHOST_MOST * Math.min(1, under / GHOST_DEEP);
    const cpx = (tx - ty) * HWs, cpy = (tx + ty) * HHs - z * HUs;

    let limbs = 0;
    const add = (ax: number, ay: number, bx: number, by: number) => {
      if (limbs >= MAX_LIMBS) return;
      const o = limbs++ * 4;
      LIMB[o] = ax; LIMB[o + 1] = ay; LIMB[o + 2] = bx; LIMB[o + 3] = by;
    };

    let joined = false;
    for (const face of PIPE_FACINGS) {
      if (!pipeAcross(grid, tx, ty, face)) continue;
      joined = true;
      const [dx, dy] = NEIGHBOUR[FACE_OF[face]];
      // Out to the middle of the shared face, where the neighbour's own limb
      // is coming the other way. Each cell draws its own half.
      const ffx = tx + dx * 0.5, ffy = ty + dy * 0.5;
      add(cpx, cpy, (ffx - ffy) * HWs, (ffx + ffy) * HHs - z * HUs);
    }

    // And the opening, if this facing is one — a facing turned into the run
    // beside it is a capped end with nothing sticking out of it.
    if (!pipeAcross(grid, tx, ty, facing)) {
      const mouth = pipeMouth(grid, tx, ty, facing);
      if (mouth) {
        const [dx, dy] = NEIGHBOUR[FACE_OF[facing]];
        // The two ends that have to line up are the wall and the MOUTH: the
        // drop hangs at the mouth, and a fitting that stopped at the face
        // left it hanging half a column clear of the pipe it came out of.
        // Asking `pipeMouth` where that is, rather than working it out again
        // here, is what keeps them together.
        const mfx = toTile(mouth.cx), mfy = toTile(mouth.cy);
        const mpx = (mfx - mfy) * HWs, mpy = (mfx + mfy) * HHs - mouth.z * HUs;
        // A joined cell runs its stub from the middle, so it meets its other
        // limbs; a lone pipe runs it from just inside the wall, so it reads
        // as coming out of the wall rather than lying across the tile.
        let ax = cpx, ay = cpy;
        if (!joined) {
          const ffx = tx + dx * 0.5, ffy = ty + dy * 0.5;
          const fpx = (ffx - ffy) * HWs, fpy = (ffx + ffy) * HHs - z * HUs;
          const ux = mpx - fpx, uy = mpy - fpy;
          const len = Math.hypot(ux, uy) || 1;
          ax = fpx - (ux / len) * NUB_BACK * HWs;
          ay = fpy - (uy / len) * NUB_BACK * HWs;
        }
        add(ax, ay, mpx, mpy);
      }
    }
    if (limbs === 0) continue;

    const wide = NUB_WIDE * HWs;
    /** A bar from `a` to `b`, of half-thickness `half`, nudged sideways. */
    const bar = (n: number, half: number, shift: number, kind: number, mat: number) => {
      const o = put(band);
      if (o < 0) return;
      const q = n * 4;
      const ax = LIMB[q], ay = LIMB[q + 1], bx = LIMB[q + 2], by = LIMB[q + 3];
      let ux = bx - ax, uy = by - ay;
      const len = Math.hypot(ux, uy) || 1;
      ux /= len; uy /= len;
      // Across the bar, and DOWN the screen, because that is the way water
      // settles. A bar has two perpendiculars and they are the same line;
      // the one to shift along is whichever of them points downwards, which
      // is the one with a positive screen y.
      let nx = -uy, ny = ux;
      if (ny < 0) { nx = -nx; ny = -ny; }
      data[o] = (ax + bx) * 0.5 + nx * shift;
      data[o + 1] = (ay + by) * 0.5 + ny * shift;
      data[o + 2] = half;
      data[o + 3] = len * 0.5;
      data[o + 4] = -ux;
      data[o + 5] = -uy;
      data[o + 6] = ghost;
      data[o + 7] = mat + kind * 256;
    };

    for (let n = 0; n < limbs; n++) bar(n, wide, 0, KIND_NUB, 0);

    // And the water. How full the bore is, out of the level the solver
    // holds — the same number a port measures its head from, so what you
    // see is what is driving it. A bar that thin cannot show the curve of a
    // free surface, so what it shows is HOW MUCH: an empty pipe is a line
    // of casing, a half full one has a seam of water lying along its floor,
    // and a full one is water wall to wall.
    const depth = pipeDepth(field.pipe[i]);
    if (depth <= 0) continue;
    const fill = depth < PIPE_D ? depth / PIPE_D : 1;
    const bore = wide - LINING * HWs;           // inside the casing's wall
    const half = bore * fill;
    if (half < 0.4) continue;                   // thinner than a pixel
    const kind = depth > PIPE_D ? KIND_PRESSED : KIND_FLOW;
    const mat = grid.fluid[i] || 1;
    for (let n = 0; n < limbs; n++) bar(n, half, bore - half, kind, mat);
  }

  // Nothing to say if nothing changed and nothing was there — an empty map
  // should not be uploading a texture full of zeroes sixty times a second.
  if (dl.live.size > 0 || had) dl.source.update();
  for (let b = 0; b < rows; b++) {
    const show = used[b] > 0;
    // Only on a change: visibility is structural, and flipping it every frame
    // makes the renderer rebuild the scene's instruction list every frame.
    if (meshes[b].visible !== show) meshes[b].visible = show;
  }
  void bands;
  dl.cpuMs = performance.now() - t0;
}

/**
 * World v2 — THE CLOUDS: a volume of cloud standing over the map, lit by the sun, shading itself and the ground.
 *
 * THE EYE LOOKS ONE WAY at every pixel — the map is drawn without perspective — so what a line of sight passes
 * through depends only on where it meets the map's plane. The cloud is therefore marched ON THE MAP, a texel a
 * line of sight, into a texture, and the screen only looks that texture up through one sheet lying on the map's
 * plane. Nothing is marched a pixel, nothing is made again as the camera moves or zooms, and its cost is the
 * map's, not the screen's.
 *
 * - **What cloud there is** comes from the weather (@see ../../weather `skyAt`): a strip of skies along the way
 *   the fronts cross, so the cloud over a cell is its own weather's, and comes in over the upwind edge.
 * - **Its shape** is a block of noise (@see ./cloud-noise) cut by how much sky is covered and by a profile through
 *   its height: heaps flat under and round over, sheets, and a storm's tower. The wind carries it.
 * - **A line of sight** is marched from above the highest cloud down to the lowest, the light at each step found by
 *   a few steps toward the sun; and how much of the cloud lies above each of three heights is kept beside the whole.
 * - **The cloud's shadow** is marched the sun's way instead, onto the plane of the lowest ground.
 * - **Where each line of sight lands** — on the ground, a roof, a hillside — is a texture of its own, made when the
 *   town changes. The sheet reads it, takes the cloud above that height only (so a tower in cloud is veiled by the
 *   cloud in front of it, not by what is behind), and the shadow that falls there.
 * - **A part a frame**: the cloud is marched a strip a frame into a spare copy, and the screen fades from the last
 *   whole one to the newest, each looked up where the wind has carried it since. NOTHING OF THE LAND IS IN THOSE
 *   COPIES: carried with the wind, a roof's edge slid and snapped back at every new copy, and the cloud flickered.
 *
 * WebGPU only, as the map's light is (@see ../gi): null elsewhere.
 */
import { Buffer, BufferImageSource, BufferUsage, Geometry, GpuProgram, Mesh, Shader, UniformGroup, type Container, type Renderer } from "pixi.js";

import type { Light } from "../../daylight";
import { HH, HW } from "../../iso";
import { SHADOW_RUN, SUN_X, SUN_Y } from "../../light";
import { FRONT_SPEED, PREVAILING, skyAt, type Sky } from "../../weather";
import { oncePerRender } from "../frame-uniforms";
import type { GroundMesh } from "../ground-mesh";
import { NOISE_N, noiseRow } from "./cloud-noise";

/** How far the texture reaches past the map's near edges, cells: a cloud this many quarter half-steps up is still in it. */
const MARGIN = 40;
/** Texels a tile, at most; the texture's side, at most. */
const PER_TILE = 3, LAND_PER_TILE = 4, SIDE_MAX = 1024;
/** Strips a whole march is made in; the skies along the fronts' way; the heights' span in a byte, half steps. */
const STRIPS = 6, RAMP = 128, SPAN = 128;
/** A sky's base and thickness as bytes: the base from `BASE_LOW` over `BASE_SPAN`, the thickness over `THICK_SPAN`. */
const BASE_LOW = -8, BASE_SPAN = 48, THICK_SPAN = 80;
/** The skyline and the skies read again, ms. */
const LAND_EVERY = 2000, RAMP_EVERY = 400;
/** Making the noise: ms a frame. */
const NOISE_MS = 1.2;

const MARCH_WGSL = /* wgsl */ `
struct U {
  dom: vec4<f32>,    // the texture's corner on the map (cells), its reach (cells), a copy's side (texels)
  slot: vec4<f32>,   // the copy's left (texels); the map (cells)
  z: vec4<f32>,      // the lowest ground, the roofs' height, the march's foot and its head (half steps)
  sun: vec4<f32>,    // toward the sun a half step up (cells); how much sun; how dark a shadow
  sunCol: vec4<f32>,
  top: vec4<f32>,
  low: vec4<f32>,
  drift: vec4<f32>,  // how far the wind has carried the cloud (cells); the skies along their way (cells); the clock
  axis: vec4<f32>,   // the fronts' way; where the strip of skies starts along it, and one over its length
  cuts: vec4<f32>,   // three heights the cloud above each is kept for (half steps)
  wind: vec4<f32>,   // the wind's way (cells) and its strength
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var noise: texture_3d<f32>;
@group(0) @binding(2) var around: sampler;
@group(0) @binding(3) var skies: texture_2d<f32>;
@group(0) @binding(4) var edge: sampler;
@group(0) @binding(5) var land: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  return vec4<f32>(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0.0, 1.0);
}
fn hash(p: vec2<f32>) -> f32 {
  var q = fract(vec3<f32>(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// OVER THE MAP OR NOWHERE: the cloud thins to nothing over the last cells, so it comes in over an edge.
fn inMap(p: vec2<f32>) -> f32 {
  let e = min(min(p.x, u.slot.z - p.x), min(p.y, u.slot.w - p.y));
  return smoothstep(0.0, 7.0, e);
}
// HOW MUCH CLOUD at a point (cells) and a height (half steps): the sky over it, cut by a profile through its
// height and by the noise. (fine: its edges worn away too.)
// (Returned with it: how grey the sky there is.)
fn cloud(p: vec2<f32>, z: f32, fine: bool) -> vec2<f32> {
  let m = inMap(p);
  if (m <= 0.0) { return vec2<f32>(0.0); }
  let x = (dot(p, u.axis.xy) - u.axis.z - u.drift.z) * u.axis.w;
  let a = textureSampleLevel(skies, edge, vec2<f32>(x, 0.25), 0.0);
  if (a.r < 0.01) { return vec2<f32>(0.0); }
  let zb = u.z.y + a.g * ${BASE_SPAN}.0 + ${BASE_LOW}.0;
  let hh = (z - zb) / max(a.b * ${THICK_SPAN}.0, 1.0);
  if (hh >= 1.0) { return vec2<f32>(0.0); }
  let b = textureSampleLevel(skies, edge, vec2<f32>(x, 0.75), 0.0);
  let q = p - u.drift.xy;
  // Where the sky is clear and where crowded, slowly changing.
  let slow = textureSampleLevel(noise, around, vec3<f32>(q / 110.0, 0.3 + u.drift.w), 0.0).b;
  // (A storm is cells, each a tower, however much of the sky it has; and by the map's edge the cloud breaks up
  // into its lumps before it ends.)
  // (However much of the sky it has, it is broken: banks with clear between, never one lid over the map.)
  let mid = textureSampleLevel(noise, around, vec3<f32>(q / 46.0 + 0.37, 0.7 + u.drift.w), 0.0).b;
  let cover = a.r * clamp(2.9 * (slow * 0.35 + mid * 0.65) - 0.85, 0.0, 1.15);
  if (hh <= 0.0) {
    // WHAT FALLS FROM IT, hanging under the cloud that is there: rain in grey shafts, snow in pale veils, leaning
    // with the wind, thinning toward the ground. (Not in the way of the sun: only seen.)
    let fall = b.b + b.a;
    if (!fine || fall < 0.03) { return vec2<f32>(0.0); }
    let over = textureSampleLevel(noise, around, vec3<f32>(q / 24.0, (zb + 0.3 * a.b * ${THICK_SPAN}.0) / 34.0 + u.drift.w * 3.0), 0.0).r;
    let col = clamp((over - (0.84 - 0.92 * clamp(cover, 0.0, 1.0) * (0.35 + 0.65 * m))) / 0.1, 0.0, 1.0);
    if (col <= 0.0) { return vec2<f32>(0.0); }
    let down = zb - z;
    let qs = q + u.wind.xy * down * (0.08 + 0.2 * u.wind.z);
    let streak = smoothstep(0.42, 0.8, textureSampleLevel(noise, around, vec3<f32>(qs / 22.0, z / 260.0 + 0.5), 0.0).g);
    let reach = 1.0 - 0.6 * clamp(down / max(zb - u.z.x, 1.0), 0.0, 1.0) * (1.0 - fall);
    return vec2<f32>(col * (0.04 + 0.96 * streak) * (b.b + 0.18 * b.a) * reach * 0.1 * smoothstep(0.0, 0.4, m), 0.75 * b.b / fall);
  }
  // A HEAP: flat under, round over, narrowing as it rises; a storm's spreads again at its top. A SHEET: a slab.
  let heap = smoothstep(0.0, 0.1, hh) * (1.0 - 0.8 * smoothstep(0.2, 1.0, hh)) + b.g * 0.6 * smoothstep(0.68, 0.86, hh) * smoothstep(1.0, 0.94, hh);
  let sheet = smoothstep(0.0, 0.2, hh) * smoothstep(1.0, 0.7, hh);
  let cov = clamp(cover, 0.0, 1.0) * mix(heap, sheet, a.a) * (0.35 + 0.65 * m);
  let n = textureSampleLevel(noise, around, vec3<f32>(q / 24.0, z / 34.0 + u.drift.w * 3.0), 0.0).r;
  var d = clamp((n - (0.84 - 0.92 * cov)) / 0.1, 0.0, 1.0);
  if (d <= 0.0) { return vec2<f32>(0.0); }
  if (fine) {
    let e = textureSampleLevel(noise, around, vec3<f32>(q / 13.0, z / 17.0), 0.0).g;
    d = clamp(d - (1.0 - e) * 0.34 * (1.0 - d * 0.7), 0.0, 1.0);
  }
  return vec2<f32>(d * smoothstep(0.0, 0.4, m) * (0.7 + 0.9 * b.r), b.r);
}
const N = 36;
struct Out { @location(0) seen: vec4<f32>, @location(1) more: vec4<f32> };
@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> Out {
  // Where this line of sight meets the map's plane, cells — and, for the shadow, a point of the lowest ground's plane.
  let f = u.dom.xy + (pos.xy - vec2<f32>(u.slot.x, 0.0)) / u.dom.w * u.dom.z;
  let zLow = u.z.x; let zMin = u.z.z; let zMax = u.z.w;
  let dz = (zMax - zMin) / f32(N);
  var T = 1.0; var C = vec3<f32>(0.0);
  // How much shows through the cloud above each of the three heights.
  var above = vec3<f32>(-1.0);
  for (var i = 0; i < N; i++) {
    let z = zMax - (f32(i) + 0.5) * dz;
    if (above.z < 0.0 && z < u.cuts.z) { above.z = T; }
    if (above.y < 0.0 && z < u.cuts.y) { above.y = T; }
    if (above.x < 0.0 && z < u.cuts.x) { above.x = T; }
    if (T <= 0.02) { continue; }
    let p = f + z * 0.25;
    let c = cloud(p, z, true); let rho = c.x;
    if (rho > 0.002) {
      // The cloud between here and the sun, by three steps toward it.
      let tau = cloud(p + u.sun.xy * 2.5, z + 2.5, false).x * 4.0 + cloud(p + u.sun.xy * 7.0, z + 7.0, false).x * 6.0 + cloud(p + u.sun.xy * 15.0, z + 15.0, false).x * 10.0;
      let g = clamp((z - zMin) / max(zMax - zMin, 1.0), 0.0, 1.0);
      let lit = u.sunCol.rgb * u.sun.z * (0.66 * exp(-tau * 0.5) + 0.2 * exp(-tau * 0.1));
      let sky = mix(u.low.rgb, u.top.rgb, g) * (0.3 + 0.16 * g);
      let a = 1.0 - exp(-rho * dz * 0.7);
      // (A rain cloud is grey, and greyer under.)
      C += T * a * min(lit + sky, vec3<f32>(0.97)) * mix(vec3<f32>(1.0), vec3<f32>(0.16, 0.18, 0.25) + 0.24 * g, c.y);
      T *= 1.0 - a;
    }
  }
  above = vec3<f32>(select(above.x, T, above.x < 0.0), select(above.y, T, above.y < 0.0), select(above.z, T, above.z < 0.0));
  // THE CLOUD'S SHADOW on the lowest ground's plane at this point: the cloud between it and the sun.
  var shade = 0.0;
  if (u.sun.z > 0.01) {
    let ds = (zMax - zMin) / 8.0;
    var tau = 0.0;
    for (var k = 0; k < 8; k++) {
      let z = zMin + (f32(k) + 0.5) * ds;
      tau += cloud(f + u.sun.xy * (z - zLow), z, false).x * ds;
    }
    shade = (1.0 - exp(-tau * 0.22)) * u.sun.w;
  }
  var out: Out;
  out.seen = vec4<f32>(C, 1.0 - T);
  out.more = vec4<f32>(above, shade);
  return out;
}
`;

/** WHERE A LINE OF SIGHT LANDS: its height there (half steps over the lowest ground), and whether it lands at all. */
const LAND_WGSL = /* wgsl */ `
struct U { dom: vec4<f32>, map: vec4<f32> };   // the texture's corner (cells), its reach, its side (texels); the map (cells), the land's top over its lowest, and its lowest (half steps)
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var land: texture_2d<f32>;
@group(0) @binding(2) var edge: sampler;
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  return vec4<f32>(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0.0, 1.0);
}
// What stands at a point, half steps over the lowest ground: far below, off the map.
fn landAt(p: vec2<f32>) -> f32 {
  let uv = p / u.map.xy;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { return -10000.0; }
  return textureSampleLevel(land, edge, uv, 0.0).r * ${SPAN}.0;
}
@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  // (A line of sight that meets the map's plane at f0 is over f0 + z/4 at a height z: here z is over the lowest ground.)
  let f = u.dom.xy + pos.xy / u.dom.w * u.dom.z + u.map.w * 0.25;
  let top = u.map.z + 1.0; let st = max(0.5, top / 158.0);
  var z = top; var was = top;
  for (var i = 0; i < 160; i++) {
    let l = landAt(f + z * 0.25);
    if (z <= l) {
      // Between the last step and this: where the two cross.
      let l0 = landAt(f + was * 0.25);
      let k = clamp((was - l0) / max((was - l0) + (l - z), 0.001), 0.0, 1.0);
      return vec4<f32>(mix(was, z, k), 1.0, 0.0, 1.0);
    }
    was = z; z -= st;
    if (z < -0.5) { break; }
  }
  return vec4<f32>(0.0, 0.0, 0.0, 1.0);
}
`;

const SHEET_WGSL = /* wgsl */ `
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
// The cloud's texture: its corner on its plane (cells), its reach, a copy's side (texels). The last whole copy and
// the newest: which, and how far the wind has carried each since (cells). How far from the one to the other; how
// much of the cloud is shown; the map (cells). The lowest ground and the three heights (half steps). Toward the
// sun a half step up (cells).
// Where lightning is (cells), how bright it is now, and how far it lights (cells).
// (uWind: the wind's way (cells, a unit), how much snow it sweeps, and its clock.)
// The fog: how much, how high it lies over the lowest ground (half steps), whether there is any cloud, a slow clock; and its colour.
struct Sheet { uDom: vec4<f32>, uOld: vec4<f32>, uNew: vec4<f32>, uMix: vec4<f32>, uCuts: vec4<f32>, uSun: vec4<f32>, uFlash: vec4<f32>, uFog: vec4<f32>, uFogCol: vec4<f32>, uWind: vec4<f32> };
@group(2) @binding(0) var<uniform> sheet : Sheet;
@group(2) @binding(1) var uCloud : texture_2d<f32>;
@group(2) @binding(2) var uCloudSampler : sampler;
@group(2) @binding(3) var uMore : texture_2d<f32>;
@group(2) @binding(4) var uLand : texture_2d<f32>;
struct VSOutput { @builtin(position) position: vec4<f32>, @location(0) vGround: vec2<f32> };
@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aGround: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  var out: VSOutput;
  out.position = vec4<f32>((mvp * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0);
  out.vGround = aGround;
  return out;
}
// A copy's place for a point of the cloud's plane, where the wind has carried it: (its place, whether it is in it).
fn placeOf(g: vec2<f32>, c: vec4<f32>) -> vec3<f32> {
  let l = (g - sheet.uDom.xy - c.yz) / sheet.uDom.z;
  let half = 0.5 / sheet.uDom.w;
  let inside = step(0.0, l.x) * step(0.0, l.y) * step(l.x, 1.0) * step(l.y, 1.0);
  let k = clamp(l, vec2<f32>(half), vec2<f32>(1.0 - half));
  return vec3<f32>((k.x + c.x) / 3.0, k.y, inside);
}
fn hash2(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p); let f = fract(p); let k = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2<f32>(1.0, 0.0)), k.x), mix(hash2(i + vec2<f32>(0.0, 1.0)), hash2(i + vec2<f32>(1.0, 1.0)), k.x), k.y);
}
fn inMap(p: vec2<f32>) -> f32 {
  let e = min(min(p.x, sheet.uMix.z - p.x), min(p.y, sheet.uMix.w - p.y));
  return smoothstep(0.0, 3.0, e);
}
@fragment
fn mainFragment(in: VSOutput) -> @location(0) vec4<f32> {
  // WHERE THIS LINE OF SIGHT LANDS: nowhere on the map, no cloud — the cloud is the map's, and is not seen past it.
  let g = in.vGround;
  let l = textureSampleLevel(uLand, uCloudSampler, (g - sheet.uDom.xy) / sheet.uDom.z, 0.0);
  if (l.g <= 0.004) { discard; }
  let zAt = l.r / max(l.g, 0.001);
  let at = g + (sheet.uCuts.x + zAt) * 0.25;
  let on = smoothstep(0.3, 0.9, l.g) * inMap(at);
  // THE CLOUD in front of what stands there: all of it under the first height, less above each.
  let pa = placeOf(g, sheet.uOld); let pb = placeOf(g, sheet.uNew);
  let seen = mix(textureSampleLevel(uCloud, uCloudSampler, pa.xy, 0.0) * pa.z, textureSampleLevel(uCloud, uCloudSampler, pb.xy, 0.0) * pb.z, sheet.uMix.x);
  let more = mix(mix(vec4<f32>(1.0, 1.0, 1.0, 0.0), textureSampleLevel(uMore, uCloudSampler, pa.xy, 0.0), pa.z), mix(vec4<f32>(1.0, 1.0, 1.0, 0.0), textureSampleLevel(uMore, uCloudSampler, pb.xy, 0.0), pb.z), sheet.uMix.x);
  let all = 1.0 - seen.a;
  let c = sheet.uCuts;
  var through = mix(all, more.x, clamp(zAt / max(c.y, 0.001), 0.0, 1.0));
  through = mix(through, more.y, clamp((zAt - c.y) / max(c.z - c.y, 0.001), 0.0, 1.0));
  through = mix(through, more.z, clamp((zAt - c.z) / max(c.w - c.z, 0.001), 0.0, 1.0));
  let share = clamp((1.0 - through) / max(seen.a, 0.001), 0.0, 1.0) * sheet.uMix.y * on * sheet.uFog.z;
  let cloud = seen * share;
  // ITS SHADOW there: from the plane of the lowest ground, back along the sun's way by the height it stands at.
  let s = at - sheet.uSun.xy * zAt;
  let sa = placeOf(s, sheet.uOld); let sb = placeOf(s, sheet.uNew);
  let shade = mix(textureSampleLevel(uMore, uCloudSampler, sa.xy, 0.0).a * sa.z, textureSampleLevel(uMore, uCloudSampler, sb.xy, 0.0).a * sb.z, sheet.uMix.x) * on * sheet.uFog.z;
  // LIGHTNING: the cloud lit from inside about the strike, and for that moment the ground under it.
  let fd = (at - sheet.uFlash.xy) / sheet.uFlash.w;
  let glow = sheet.uFlash.z * exp(-dot(fd, fd));
  let bolt = vec3<f32>(0.82, 0.86, 1.0) * glow;
  let dim = shade * (1.0 - 0.7 * min(glow, 1.0));
  // FOG, lying on the low ground and thinning upward — the hills and the tall roofs stand out of it — in slow
  // banks: under the cloud, over the ground and its shadow.
  let bank = 0.62 + 0.38 * sin(at.x * 0.21 + sheet.uFog.w) * sin(at.y * 0.17 - sheet.uFog.w * 0.7) + 0.2 * sin((at.x + at.y) * 0.45 + sheet.uFog.w * 1.6);
  let fog = clamp(sheet.uFog.x * clamp(bank, 0.0, 1.2) * (1.0 - smoothstep(0.0, sheet.uFog.y, zAt)) * 0.85, 0.0, 0.9) * on;
  // THE COLD WIND OVER THE SNOW: thin streaks of swept snow running downwind along the ground, in gusts that
  // cross the map — in the map's own space, so they are the same streaks at any zoom.
  var swept = 0.0;
  if (sheet.uWind.z > 0.004) {
    let wd = sheet.uWind.xy; let al = dot(at, wd); let ac = dot(at, vec2<f32>(-wd.y, wd.x)); let t = sheet.uWind.w;
    let gust = smoothstep(0.42, 0.78, vnoise(vec2<f32>(al * 0.055 - t * 0.45, ac * 0.08)));
    let fine = vnoise(vec2<f32>(al * 0.3 - t * 2.0, ac * 3.4)) * 0.62 + vnoise(vec2<f32>(al * 0.75 - t * 3.4, ac * 6.5 + 5.0)) * 0.38;
    swept = sheet.uWind.z * gust * smoothstep(0.42, 0.74, fine) * (1.0 - smoothstep(0.0, 5.0, zAt)) * on;
  }
  // What is under the cloud: the ground, shaded, the swept snow, then the fog; and the cloud over it.
  let veil = 1.0 - (1.0 - fog) * (1.0 - swept);
  let underA = 1.0 - (1.0 - dim) * (1.0 - veil);
  let underC = dim * vec3<f32>(0.08, 0.12, 0.22) * (1.0 - veil) + sheet.uFogCol.rgb * fog * (1.0 - swept) + sheet.uFogCol.rgb * vec3<f32>(0.72, 0.84, 1.06) * swept + bolt * 0.12;
  let rest = 1.0 - cloud.a;
  return vec4<f32>(cloud.rgb + bolt * cloud.a * 1.1 + rest * underC, 1.0 - rest * (1.0 - underA));
}
`;

type Gpu = { gpu?: { device: GPUDevice }; texture?: { getGpuSource: (s: unknown) => GPUTexture } };

export type CloudFrame = {
  /** The calendar's time, years; the clock, seconds. */
  t: number;
  seconds: number;
  /** The hour's light. */
  light: Light;
  ground: GroundMesh;
  /** The wind's way (cells, a unit) and its strength, 0–1. */
  wind: readonly [number, number];
  strength: number;
  /** How much of the cloud is shown, 0–1: the rest is seen through, so the town under it can be. */
  show: number;
  /** The snow lying, 0–1. */
  snow: number;
  /** A sky held to look at, over the weather's. */
  held?: Partial<Sky> | null;
};
export type Clouds = { tick: (f: CloudFrame | null) => void; destroy: () => void };

/** The clouds over a map `w` by `h` tiles, their sheet `world`'s child at `zIndex`; null where there is no WebGPU. */
export function createClouds(renderer: Renderer, world: Container, zIndex: number, w: number, h: number, scale: number): Clouds | null {
  const sys = renderer as unknown as Gpu, device = sys.gpu?.device;
  if (!device || typeof sys.texture?.getGpuSource !== "function") return null;
  const reach = Math.max(w, h) + MARGIN + 1;
  const side = Math.min(SIDE_MAX, Math.round(reach * PER_TILE));

  // THE NOISE, made a few rows a frame.
  const noise = device.createTexture({ size: [NOISE_N, NOISE_N, NOISE_N], dimension: "3d", format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const slice = new Uint8Array(NOISE_N * NOISE_N * 4);
  let noiseRows = 0;
  const makeNoise = () => {
    const until = performance.now() + NOISE_MS, all = NOISE_N * NOISE_N;
    while (noiseRows < all && performance.now() < until) {
      const y = noiseRows % NOISE_N, z = Math.floor(noiseRows / NOISE_N);
      noiseRow(y, z, slice, y * NOISE_N * 4);
      noiseRows++;
      if (y === NOISE_N - 1) device.queue.writeTexture({ texture: noise, origin: [0, 0, z] }, slice, { bytesPerRow: NOISE_N * 4, rowsPerImage: NOISE_N }, [NOISE_N, NOISE_N, 1]);
    }
  };

  // THE SKIES along the fronts' way, and THE SKYLINE.
  const skies = device.createTexture({ size: [RAMP, 2], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const skyBytes = new Uint8Array(RAMP * 2 * 4);
  const LW = w * 4, LH = h * 4;
  const land = device.createTexture({ size: [LW, LH], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const landBytes = new Uint8Array(LW * LH * 4);
  let landOf: GroundMesh | null = null, landRev = -1, landRead = -1e9, low = 0, roofs = 0, landTop = 1;
  const readLand = (gm: GroundMesh) => {
    const hs = gm.heights, cs = gm.casts, n = Math.min(LW * LH, hs.length);
    let lo = Infinity, hi = -Infinity;
    for (let o = 0; o < n; o++) { const g = hs[o], v = g + cs[o]; if (g < lo) lo = g; if (v > hi) hi = v; }
    lo -= 1;
    // (The roofs' height: what all but the tallest few stand under.)
    const bins = new Uint32Array(SPAN + 1);
    let built = 0, ground = -Infinity;
    for (let o = 0; o < n; o++) {
      const v = Math.max(0, Math.min(SPAN, hs[o] + cs[o] - lo));
      if (cs[o] > 2) { bins[Math.round(v)]++; built++; }
      if (hs[o] > ground) ground = hs[o];
      landBytes[o * 4] = Math.round((v / SPAN) * 255);
    }
    let seen = 0, top = 0;
    for (let b = 0; b <= SPAN; b++) { seen += bins[b]; if (seen >= built * 0.97) { top = b; break; } }
    // (And no lower than the land's own top, a little over it.)
    low = lo; roofs = Math.max(built > 40 ? lo + top : -Infinity, ground + 6); landTop = Math.min(SPAN, hi - lo);
    device.queue.writeTexture({ texture: land }, landBytes, { bytesPerRow: LW * 4 }, [LW, LH]);
    landOf = gm; landRev = gm.shadeRev;
    landings();
  };
  // (The fronts' way over the map: from the least to the most along it of the map's corners, and a little past.)
  const along = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => x * PREVAILING[0] + y * PREVAILING[1]);
  const a0 = Math.min(...along) - 8, aLen = Math.max(...along) + 8 - a0;
  let rampT = 0, rampRead = -1e9, rampHeld = "", topMost = 20, baseLeast = 0, any = false, falls = false, cover = 0, stormMost = 0, stormAt = 0;
  const readSkies = (t: number, held: Partial<Sky> | null | undefined) => {
    const byte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
    let top = -Infinity, base = Infinity;
    any = false; falls = false; cover = 0; stormMost = 0;
    for (let i = 0; i < RAMP; i++) {
      const a = a0 + ((i + 0.5) / RAMP) * aLen, own = skyAt(t - a / FRONT_SPEED), s = held ? { ...own, ...held } : own;
      const b = Math.max(BASE_LOW, Math.min(BASE_LOW + BASE_SPAN, s.base)), th = Math.max(2, Math.min(THICK_SPAN, s.top - s.base));
      skyBytes.set([byte(s.cover), byte((b - BASE_LOW) / BASE_SPAN), byte(th / THICK_SPAN), byte(s.flat)], i * 4);
      skyBytes.set([byte(s.dark), byte(s.storm), byte(s.rain), byte(s.snow)], (RAMP + i) * 4);
      if (s.cover >= 0.01) { any = true; top = Math.max(top, b + th); base = Math.min(base, b); if (s.rain + s.snow > 0.03) falls = true; }
      cover += s.cover / RAMP;
      if (s.storm > stormMost) { stormMost = s.storm; stormAt = a; }
    }
    topMost = any ? top : 20; baseLeast = any ? base : 0;
    device.queue.writeTexture({ texture: skies }, skyBytes, { bytesPerRow: RAMP * 4 }, [RAMP, 2]);
    rampT = t;
  };

  const edgeSampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
  // THE CLOUD AS SEEN: three copies side by side — the last whole one, the newest, and the one being made.
  const seenSrc = new BufferImageSource({ resource: new Uint16Array(side * 3 * side * 4), width: side * 3, height: side, format: "rgba16float", scaleMode: "linear" });
  const seenView = sys.texture.getGpuSource(seenSrc).createView();
  const moreSrc = new BufferImageSource({ resource: new Uint8Array(side * 3 * side * 4), width: side * 3, height: side, format: "rgba8unorm", scaleMode: "linear" });
  const moreView = sys.texture.getGpuSource(moreSrc).createView();
  const mod = device.createShaderModule({ code: MARCH_WGSL });
  const pipe = device.createRenderPipeline({ layout: "auto", vertex: { module: mod, entryPoint: "vs" }, fragment: { module: mod, entryPoint: "fs", targets: [{ format: "rgba16float" }, { format: "rgba8unorm" }] } });
  const ubo = device.createBuffer({ size: 11 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uData = new Float32Array(11 * 4);
  const bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: ubo } },
    { binding: 1, resource: noise.createView() },
    { binding: 2, resource: device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat", addressModeW: "repeat" }) },
    { binding: 3, resource: skies.createView() },
    { binding: 4, resource: edgeSampler },
  ] });

  // WHERE EACH LINE OF SIGHT LANDS, made again as the town changes.
  const landSide = Math.min(SIDE_MAX, Math.round(reach * LAND_PER_TILE));
  const landSrc = new BufferImageSource({ resource: new Uint16Array(landSide * landSide * 4), width: landSide, height: landSide, format: "rgba16float", scaleMode: "linear" });
  const landView = sys.texture.getGpuSource(landSrc).createView();
  const landMod = device.createShaderModule({ code: LAND_WGSL });
  const landPipe = device.createRenderPipeline({ layout: "auto", vertex: { module: landMod, entryPoint: "vs" }, fragment: { module: landMod, entryPoint: "fs", targets: [{ format: "rgba16float" }] } });
  const landU = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const landBind = device.createBindGroup({ layout: landPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: landU } }, { binding: 1, resource: land.createView() }, { binding: 2, resource: edgeSampler }] });
  function landings() {
    device!.queue.writeBuffer(landU, 0, new Float32Array([-MARGIN, -MARGIN, reach, landSide, w, h, landTop, low]));
    const enc = device!.createCommandEncoder();
    const pass = enc.beginRenderPass({ label: "clouds-land", colorAttachments: [{ view: landView, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(landPipe); pass.setBindGroup(0, landBind); pass.draw(3); pass.end();
    device!.queue.submit([enc.finish()]);
  }

  // THE SHEET, on the map's plane: the texture's whole reach.
  const v4 = (...v: number[]) => ({ value: new Float32Array(v), type: "vec4<f32>" as const });
  const sheetU = oncePerRender(new UniformGroup({ uDom: v4(-MARGIN, -MARGIN, reach, side), uOld: v4(0, 0, 0, 0), uNew: v4(1, 0, 0, 0), uMix: v4(0, 0, w, h), uCuts: v4(0, 1, 2, 3), uSun: v4(0, 0, 0, 0), uFlash: v4(0, 0, 0, 8), uFog: v4(0, 8, 1, 0), uFogCol: v4(0.8, 0.84, 0.88, 0), uWind: v4(1, 0, 0, 0) }));
  const corners = [[-MARGIN, -MARGIN], [w + 1, -MARGIN], [w + 1, h + 1], [-MARGIN, h + 1]];
  const verts = new Float32Array(corners.flatMap(([gu, gv]) => [(gu - 0.5 - (gv - 0.5)) * HW * scale, (gu - 0.5 + gv - 0.5) * HH * scale, gu, gv]));
  const vb = new Buffer({ data: verts, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
  const ib = new Buffer({ data: new Uint32Array([0, 1, 2, 0, 2, 3]), usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
  const geometry = new Geometry({
    attributes: { aPosition: { buffer: vb, format: "float32x2", stride: 16, offset: 0 }, aGround: { buffer: vb, format: "float32x2", stride: 16, offset: 8 } },
    indexBuffer: ib,
  });
  const shader = new Shader({
    gpuProgram: GpuProgram.from({
      vertex: { source: SHEET_WGSL, entryPoint: "mainVertex" }, fragment: { source: SHEET_WGSL, entryPoint: "mainFragment" }, name: "cloud-sheet",
      layout: [{ globalUniforms: 0 }, { localUniforms: 0 }, { sheet: 0, uCloud: 1, uCloudSampler: 2, uMore: 3, uLand: 4 }],
      gpuLayout: [
        [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
        [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
        [
          { binding: 0, visibility: 2, buffer: { type: "uniform" } },
          { binding: 1, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
          { binding: 2, visibility: 2, sampler: { type: "filtering" } },
          { binding: 3, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
          { binding: 4, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
        ],
      ],
    }),
    resources: { sheet: sheetU, uCloud: seenSrc, uCloudSampler: seenSrc.style, uMore: moreSrc, uLand: landSrc },
  });
  const mesh = new Mesh<Geometry, Shader>({ geometry, shader });
  mesh.eventMode = "none";
  mesh.zIndex = zIndex;
  mesh.visible = false;
  world.addChild(mesh);

  // How far the wind has carried the cloud, cells; the clock last frame; the noise's own slow clock.
  const drift = [0, 0];
  let last = -1, churn = 0, gusts = 0;
  // LIGHTNING: when the next strike is (s), when the last was, and where (cells).
  let strikeNext = 0, strikeWas = -1e9;
  const strike = [0, 0];
  // The copies: which is the last whole one, the newest, and the one being made; the drift each was made at; the
  // strip to make next; whole copies made so far.
  let old = 0, cur = 1, making = 2, strip = 0, whole = 0;
  const madeAt = [[0, 0], [0, 0], [0, 0]];
  const u = sheetU.uniforms as Record<string, Float32Array>;
  let dead = false;

  return {
    tick(f) {
      if (dead) return;
      if (noiseRows < NOISE_N * NOISE_N) makeNoise();
      const dt = f && last >= 0 ? Math.max(0, Math.min(0.1, f.seconds - last)) : 0;
      if (f) last = f.seconds;
      if (!f || noiseRows < NOISE_N * NOISE_N) { if (mesh.visible) mesh.visible = false; return; }
      const now = performance.now();
      if (landOf !== f.ground || (landRev !== f.ground.shadeRev && now - landRead > LAND_EVERY)) { readLand(f.ground); landRead = now; }
      const heldKey = f.held ? JSON.stringify(f.held) : "";
      if (now - rampRead > RAMP_EVERY || heldKey !== rampHeld) { readSkies(f.t, f.held); rampRead = now; rampHeld = heldKey; }
      // CARRIED BY THE WIND, faster the stronger; and slowly turning over as it goes.
      const speed = 0.3 + 0.9 * f.strength;
      drift[0] += f.wind[0] * speed * dt; drift[1] += f.wind[1] * speed * dt;
      churn = (churn + dt * 0.004) % 1;
      // THE FOG: the weather's where the map is, more of it while the sun is low.
      const own = skyAt(f.t - (w * PREVAILING[0] + h * PREVAILING[1]) / 2 / FRONT_SPEED), fogNow = Math.max(0, Math.min(1, (f.held?.fog ?? own.fog) * (0.7 + 0.6 * f.light.low)));
      u.uFog.set([fogNow, 5 + 9 * fogNow, any ? 1 : 0, (f.seconds * 0.05) % 6283]);
      // (Pale, and dim by night: the hour's grade over the map colours it with the rest.)
      { const k = 1 - 0.78 * f.light.night; u.uFogCol.set([0.87 * k, 0.89 * k, 0.92 * k, 0]); }
      // THE WIND OVER THE SNOW: where snow lies, in the cold, the more the stronger the wind. (Subtle.)
      gusts = (gusts + dt * (0.6 + 0.8 * f.strength)) % 4000;
      const sweeps = Math.max(0, Math.min(1, f.snow * 2)) * own.cold * Math.max(0, Math.min(1, (f.strength - 0.15) / 0.4)) * 0.4;
      u.uWind.set([f.wind[0], f.wind[1], sweeps, gusts]);
      if (!any) {
        // (No cloud: the copies are not made, and only the fog is drawn, if there is any.)
        whole = 0; strip = 0;
        const show = fogNow > 0.02 || sweeps > 0.004;
        if (mesh.visible !== show) mesh.visible = show;
        u.uCuts.set([low, landTop / 3, (landTop * 2) / 3, landTop]);
        return;
      }

      // A STRIP of the copy being made. (What it is made by is fixed at its first strip.)
      if (strip === 0) {
        const sl = Math.hypot(SUN_X, SUN_Y) || 1, day = f.light.sun[3];
        // (Down to the ground where anything falls: its curtains hang that far.)
        const zMax = roofs + topMost + 1, zMin = falls ? low : Math.max(low, roofs + baseLeast - 1);
        uData.set([-MARGIN, -MARGIN, reach, side], 0);
        uData.set([making * side, 0, w, h], 4);
        uData.set([low, roofs, zMin, zMax], 8);
        uData.set([(SUN_X / sl) * SHADOW_RUN, (SUN_Y / sl) * SHADOW_RUN, day, 0.4 * day], 12);
        uData.set([f.light.sun[0], f.light.sun[1], f.light.sun[2], 0], 16);
        uData.set([f.light.skyTop[0], f.light.skyTop[1], f.light.skyTop[2], 0], 20);
        uData.set([f.light.skyLow[0], f.light.skyLow[1], f.light.skyLow[2], 0], 24);
        uData.set([drift[0], drift[1], (f.t - rampT) * FRONT_SPEED, churn], 28);
        uData.set([PREVAILING[0], PREVAILING[1], a0, 1 / aLen], 32);
        uData.set([low + landTop / 3, low + (landTop * 2) / 3, low + landTop, 0], 36);
        uData.set([f.wind[0], f.wind[1], f.strength, 0], 40);
        device.queue.writeBuffer(ubo, 0, uData);
        madeAt[making][0] = drift[0]; madeAt[making][1] = drift[1];
      }
      const y0 = Math.floor((strip * side) / STRIPS), y1 = Math.floor(((strip + 1) * side) / STRIPS);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ label: "clouds", colorAttachments: [{ view: seenView, loadOp: "load", storeOp: "store" }, { view: moreView, loadOp: "load", storeOp: "store" }] });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bind);
      pass.setViewport(making * side, 0, side, side, 0, 1);
      pass.setScissorRect(making * side, y0, side, y1 - y0);
      pass.draw(3);
      pass.end();
      device.queue.submit([enc.finish()]);
      if (++strip === STRIPS) {
        strip = 0; whole++;
        const spare = old;
        old = cur; cur = making; making = spare;
      }
      // THE SHEET: from the last whole copy to the newest as the next is made, each where the wind has carried it.
      const show = whole >= 2 || fogNow > 0.02 || sweeps > 0.004;
      if (mesh.visible !== show) mesh.visible = show;
      if (whole < 2) u.uFog[2] = 0;
      u.uOld.set([old, drift[0] - madeAt[old][0], drift[1] - madeAt[old][1], 0]);
      u.uNew.set([cur, drift[0] - madeAt[cur][0], drift[1] - madeAt[cur][1], 0]);
      u.uMix[0] = whole >= 2 ? strip / STRIPS : 1;
      // (A sky all cloud is shown thinner, so the town under it can still be read: its shadow is what says overcast.)
      u.uMix[1] = f.show * (1 - 0.4 * Math.max(0, Math.min(1, (cover - 0.55) / 0.35)));
      u.uCuts.set([low, landTop / 3, (landTop * 2) / 3, landTop]);
      // A STRIKE now and then where the storm is: a flash and a flicker after it.
      if (stormMost > 0.3 && f.seconds >= strikeNext) {
        strikeNext = f.seconds + (1.5 + 5 * Math.random()) / stormMost;
        // (Where the storm is along the fronts' way now, and anywhere across it that is on the map.)
        const along = stormAt + (f.t - rampT) * FRONT_SPEED + (Math.random() * 2 - 1) * 8;
        for (let tries = 0; tries < 8; tries++) {
          const across = (Math.random() * 2 - 1) * Math.max(w, h);
          const x = PREVAILING[0] * along - PREVAILING[1] * across, y = PREVAILING[1] * along + PREVAILING[0] * across;
          if (x > 2 && y > 2 && x < w - 2 && y < h - 2) { strike[0] = x; strike[1] = y; strikeWas = f.seconds; break; }
        }
      }
      const since = f.seconds - strikeWas;
      u.uFlash.set([strike[0], strike[1], since < 0.5 ? Math.max(Math.exp(-since * 22), 0.7 * Math.exp(-Math.abs(since - 0.18) * 30)) * 1.3 : 0, 9]);
      { const sl = Math.hypot(SUN_X, SUN_Y) || 1; u.uSun.set([(SUN_X / sl) * SHADOW_RUN, (SUN_Y / sl) * SHADOW_RUN, 0, 0]); }
    },
    destroy() {
      dead = true;
      mesh.parent?.removeChild(mesh);
      mesh.destroy();
      // (Not at once: a frame in flight may still read them.)
      setTimeout(() => { geometry.destroy(true); seenSrc.destroy(); moreSrc.destroy(); landSrc.destroy(); landU.destroy(); noise.destroy(); skies.destroy(); land.destroy(); ubo.destroy(); }, 500);
    },
  };
}

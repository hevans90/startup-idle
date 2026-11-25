/**
 * THE STILL'S LIQUID, on the graphics card: particles carrying the juice, and a grid they push each other through
 * (MLS-MPM: each particle gives its mass and motion to the cells round it, the cells are pressed apart where they are
 * crowded and held in by the glass, and the particles are moved on by them). Drawn as one surface: the particles laid
 * down soft into a picture, and the picture read as a depth of liquid.
 *
 * IT FOLLOWS THE AMOUNTS IT IS GIVEN, it does not make them: each place has the particles it should hold, and its gate
 * opens while it is short of them. So juice runs down through every vessel on the way, each kept full by the one above.
 * What is drained is taken out at a vessel's foot and comes in again at the flask's tap. A place at rest is not
 * stepped, and with every place at rest nothing runs. @see glassware
 */
import { FAR, FLASK, GATE_HALF, GATE_SLIDE, H, NOWHERE, VESSELS, W, flaskCells, glassField, placeMap, restingIn } from "./glassware";

/** The most particles. */
const MOST = 28000;
/** Particles to a cell of still liquid. */
const A_CELL = 4;
/** Steps to a sixtieth of a second, and how far each goes. */
const STEPS = 10, DT = 0.18;
/** Frames a place is stepped on for after it is still; and it all, after they all are. */
const REST = 120;
const FX = 1000000;
const PLACES = VESSELS.length + 1;
/** Samples of the glass to a cell, as drawn and felt. */
const FINE = 2;
const F = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

const COMMON = /* wgsl */ `
struct Particle { pos: vec2<f32>, vel: vec2<f32>, c: vec4<f32> };
// Each place: its gate, its foot, how far open, the particles it should hold, how long it is stepped yet, those it holds.
struct Place { gate: vec2<f32>, foot: vec2<f32>, open: f32, want: f32, awake: f32, has: f32 };
struct U { size: vec2<f32>, count: f32, time: f32, pointer: vec4<f32>, births: vec4<f32>, light: vec4<f32>, look: array<vec4<f32>, ${PLACES}> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> map: array<u32>;
@group(0) @binding(2) var glassTex: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
const SIZE = vec2<f32>(${F(W)}, ${F(H)});
// How far out of the glass, and which way out is (and how sure that is).
fn glassAt(p: vec2<f32>) -> vec3<f32> { return textureSampleLevel(glassTex, smp, p / SIZE, 0.0).xyz; }
fn mapAt(p: vec2<f32>) -> u32 { let c = clamp(vec2<i32>(floor(p)), vec2<i32>(0), vec2<i32>(${W - 1}, ${H - 1})); return map[c.y * ${W} + c.x]; }
// A gate's plate, drawn aside as it opens.
fn plate(p: vec2<f32>, at: vec2<f32>, open: f32) -> vec2<f32> { return abs(p - at - vec2<f32>(open * ${F(GATE_SLIDE)}, 0.0)) - vec2<f32>(${F(GATE_HALF[0])}, ${F(GATE_HALF[1])}); }
`;

const SIM = /* wgsl */ `${COMMON}
struct Cell { m: atomic<i32>, x: atomic<i32>, y: atomic<i32>, pad: i32 };
@group(0) @binding(4) var<storage, read_write> ps: array<Particle>;
@group(0) @binding(5) var<storage, read_write> cells: array<Cell>;
@group(0) @binding(6) var<storage, read_write> vel: array<vec2<f32>>;
// Each place's particles and how fast they go between them; and after them all, those born of each kind.
@group(0) @binding(7) var<storage, read_write> tally: array<atomic<i32>>;
@group(0) @binding(8) var<storage, read_write> places: array<Place>;
fn wallAt(p: vec2<f32>) -> vec3<f32> {
  let s = glassAt(p); let k = (mapAt(p) >> 8u) & 255u;
  if (k == 0u) { return s; }
  let at = places[k].gate; let q = plate(p, at, places[k].open); let d = max(q.x, q.y);
  if (-d <= s.x) { return s; }
  return vec3<f32>(-d, select(vec2<f32>(0.0, -sign(p.y - at.y)), vec2<f32>(-sign(p.x - at.x - places[k].open * ${F(GATE_SLIDE)}), 0.0), q.x > q.y));
}
// Whether a particle is one to step: there, and in a place that is not at rest.
fn still(p: vec2<f32>) -> bool { if (p.x < 0.0) { return true; } let k = mapAt(p) & 255u; return k != ${NOWHERE}u && places[k].awake <= 0.0; }
fn rand(n: u32) -> f32 { var x = n * 747796405u + 2891336453u; x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u; return f32((x >> 22u) ^ x) / 4294967295.0; }
fn weights(f: vec2<f32>) -> array<vec2<f32>, 3> {
  return array<vec2<f32>, 3>(0.5 * (0.5 - f) * (0.5 - f), 0.75 - f * f, 0.5 * (0.5 + f) * (0.5 + f));
}
fn at(c: vec2<i32>) -> i32 { return c.y * ${W} + c.x; }
@compute @workgroup_size(64) fn clear(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= ${W * H}u) { return; }
  atomicStore(&cells[id.x].m, 0); atomicStore(&cells[id.x].x, 0); atomicStore(&cells[id.x].y, 0);
}
@compute @workgroup_size(64) fn give(@builtin(global_invocation_id) id: vec3<u32>) {
  if (f32(id.x) >= u.count || still(ps[id.x].pos)) { return; }
  let p = ps[id.x]; let b = floor(p.pos); let f = p.pos - b - 0.5; var w = weights(f);
  let C = mat2x2<f32>(p.c.xy, p.c.zw);
  for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) {
    let c = vec2<i32>(b) + vec2<i32>(i - 1, j - 1); let wt = w[i].x * w[j].y;
    let d = vec2<f32>(c) + 0.5 - p.pos; let m = wt * (p.vel + C * d); let k = at(c);
    atomicAdd(&cells[k].m, i32(wt * ${F(FX)})); atomicAdd(&cells[k].x, i32(m.x * ${F(FX)})); atomicAdd(&cells[k].y, i32(m.y * ${F(FX)}));
  } }
}
@compute @workgroup_size(64) fn press(@builtin(global_invocation_id) id: vec3<u32>) {
  if (f32(id.x) >= u.count || still(ps[id.x].pos)) { return; }
  let p = ps[id.x]; let b = floor(p.pos); let f = p.pos - b - 0.5; var w = weights(f);
  var rho = 0.0;
  for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) {
    rho += w[i].x * w[j].y * f32(atomicLoad(&cells[at(vec2<i32>(b) + vec2<i32>(i - 1, j - 1))].m)) / ${F(FX)};
  } }
  let r = rho / ${F(A_CELL)};
  let pr = clamp(9.0 * (r * r * r * r - 1.0), 0.0, 60.0);
  let C = mat2x2<f32>(p.c.xy, p.c.zw);
  let s = mat2x2<f32>(vec2<f32>(-pr, 0.0), vec2<f32>(0.0, -pr)) + 0.06 * (C + transpose(C));
  let e = -(1.0 / max(rho, 0.3)) * 4.0 * ${F(DT)} * s;
  for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) {
    let c = vec2<i32>(b) + vec2<i32>(i - 1, j - 1); let m = w[i].x * w[j].y * (e * (vec2<f32>(c) + 0.5 - p.pos)); let k = at(c);
    atomicAdd(&cells[k].x, i32(m.x * ${F(FX)})); atomicAdd(&cells[k].y, i32(m.y * ${F(FX)}));
  } }
}
@compute @workgroup_size(64) fn hold(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= ${W * H}u) { return; }
  let m = f32(atomicLoad(&cells[id.x].m)) / ${F(FX)};
  if (m <= 0.0) { vel[id.x] = vec2<f32>(0.0); return; }
  var v = vec2<f32>(f32(atomicLoad(&cells[id.x].x)), f32(atomicLoad(&cells[id.x].y))) / ${F(FX)} / m;
  v.y += 0.035 * ${F(DT)};
  let p = vec2<f32>(f32(id.x % ${W}u), f32(id.x / ${W}u)) + 0.5;
  // (The pointer stirs: it drags what is near along with it.)
  let d = p - u.pointer.xy; let near = exp(-dot(d, d) / 30.0);
  v = mix(v, u.pointer.zw, near * 0.12 * step(0.01, dot(u.pointer.zw, u.pointer.zw)));
  let out = wallAt(p);
  if (out.x > -0.6) { v -= out.yz * max(dot(v, out.yz), 0.0); if (out.x > 1.5) { v = vec2<f32>(0.0); } }
  let l = length(v); vel[id.x] = v * min(1.0, 3.5 / max(l, 1e-4));
}
@compute @workgroup_size(64) fn take(@builtin(global_invocation_id) id: vec3<u32>) {
  if (f32(id.x) >= u.count || still(ps[id.x].pos)) { return; }
  var p = ps[id.x]; let b = floor(p.pos); let f = p.pos - b - 0.5; var w = weights(f);
  var v = vec2<f32>(0.0); var B = mat2x2<f32>(vec2<f32>(0.0), vec2<f32>(0.0));
  for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) {
    let c = vec2<i32>(b) + vec2<i32>(i - 1, j - 1); let wt = w[i].x * w[j].y; let g = vel[at(c)] * wt;
    let d = vec2<f32>(c) + 0.5 - p.pos; v += g; B += mat2x2<f32>(g * d.x, g * d.y);
  } }
  // (What hardly moves is let come to rest.)
  let calm = 1.0 - 0.012 * exp(-dot(v, v) * 40.0); v *= calm; B = B * (calm * 0.997);
  p.pos += v * ${F(DT)};
  let o = wallAt(p.pos);
  if (o.x > -0.35) { p.pos -= o.yz * min(o.x + 0.35, 1.0); v -= o.yz * max(dot(v, o.yz), 0.0); }
  p.pos = clamp(p.pos, vec2<f32>(2.5), vec2<f32>(${W - 3}.5, ${H - 3}.5));
  p.vel = v; p.c = vec4<f32>(4.0 * B[0], 4.0 * B[1]);
  ps[id.x] = p;
}
// WHAT IS WHERE. And juice comes and goes: a place with too many lets them out at its foot; those wanted come in by the
// flask's tap, or unseen in the liquid at its foot.
@compute @workgroup_size(64) fn count(@builtin(global_invocation_id) id: vec3<u32>) {
  if (f32(id.x) >= u.count) { return; }
  var p = ps[id.x]; let seed = id.x * 3u + u32(u.time * 1000.0) * 7919u;
  if (p.pos.x < 0.0) {
    if (u.births.x + u.births.y < 0.5) { return; }
    var kind = -1;
    if (u.births.x > 0.5 && f32(atomicAdd(&tally[${PLACES * 2}], 1)) < u.births.x) { kind = 0; }
    else if (u.births.y > 0.5 && f32(atomicAdd(&tally[${PLACES * 2 + 1}], 1)) < u.births.y) { kind = 1; }
    if (kind < 0) { return; }
    let r = vec2<f32>(rand(seed), rand(seed + 1u));
    p.pos = select(vec2<f32>(72.0 + r.x * 16.0, 58.0 + r.y * 4.0), vec2<f32>(78.4 + r.x * 3.2, 3.0 + r.y * 3.0), kind == 0);
    p.vel = vec2<f32>(0.0, select(0.0, 1.6, kind == 0)); p.c = vec4<f32>(0.0);
    ps[id.x] = p;
  }
  let k = mapAt(p.pos) & 255u;
  if (k == ${NOWHERE}u) { return; }
  let over = places[k].has - places[k].want;
  let d = p.pos - places[k].foot;
  if (over > 10.0 && dot(d, d) < 40.0 && rand(seed + 2u) < clamp(over / 350.0, 0.015, 0.3)) { ps[id.x].pos = vec2<f32>(-100.0); return; }
  atomicAdd(&tally[k * 2u], 1); atomicAdd(&tally[k * 2u + 1u], i32(length(p.vel) * 1000.0));
}
// EACH PLACE'S GATE, open while it is short; and whether it is at rest.
@compute @workgroup_size(${PLACES}) fn serve(@builtin(global_invocation_id) id: vec3<u32>) {
  let k = id.x; var z = places[k];
  z.has = f32(atomicLoad(&tally[k * 2u]));
  let speed = f32(atomicLoad(&tally[k * 2u + 1u])) / 1000.0 / max(z.has, 1.0);
  let short = z.want - z.has;
  if (k > 0u) { z.open = mix(z.open, select(0.0, clamp(0.5 + short / 80.0, 0.0, 1.0), short > 4.0), 0.25); if (z.open < 0.02) { z.open = 0.0; } }
  var busy = z.open > 0.0 || short < -10.0;
  if (k == 0u) { busy = busy || u.births.x + u.births.y > 0.5; for (var c = 1u; c < ${PLACES}u; c += 5u) { busy = busy || places[c].open > 0.0; } }
  else if (k % 5u != 0u) { busy = busy || places[k + 1u].open > 0.0; }
  if (dot(u.pointer.zw, u.pointer.zw) > 0.001 && (mapAt(u.pointer.xy) & 255u) == k) { busy = true; }
  // (Still going of itself, it is let go on a while, and no longer.)
  z.awake = select(z.awake - select(1.0, 0.1, speed > 0.12), ${F(REST)}, busy);
  places[k].open = z.open; places[k].awake = max(z.awake, 0.0); places[k].has = z.has;
}
`;

const SPLAT = /* wgsl */ `${COMMON}
@group(0) @binding(4) var<storage, read> ps: array<Particle>;
struct V { @builtin(position) at: vec4<f32>, @location(0) q: vec2<f32>, @location(1) s: f32 };
@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> V {
  let q = vec2<f32>(f32(v & 1u), f32(v >> 1u)) * 2.0 - 1.0; let p = ps[i];
  // (Stretched the way it goes: a thrown drop is a streak.)
  let l = length(p.vel); let d = select(vec2<f32>(1.0, 0.0), p.vel / max(l, 1e-4), l > 0.05); let k = 1.0 + min(l * 0.5, 0.8);
  let o = (d * q.x * k + vec2<f32>(-d.y, d.x) * q.y / sqrt(k)) * 1.9;
  let c = (p.pos + o) / vec2<f32>(${F(W)}, ${F(H)});
  var r: V; r.at = vec4<f32>(c.x * 2.0 - 1.0, 1.0 - c.y * 2.0, 0.0, 1.0); r.q = q; r.s = l; return r;
}
@fragment fn fs(i: V) -> @location(0) vec4<f32> { let d = max(0.0, 1.0 - dot(i.q, i.q)); let w = d * d; return vec4<f32>(w, w * i.s, 0.0, 0.0); }
`;

const DRAW = /* wgsl */ `${COMMON}
@group(0) @binding(4) var field: texture_2d<f32>;
@group(0) @binding(5) var<storage, read> places: array<Place>;
@vertex fn vs(@builtin(vertex_index) v: u32) -> @builtin(position) vec4<f32> { return vec4<f32>(f32(v & 1u) * 4.0 - 1.0, f32(v >> 1u) * 4.0 - 1.0, 0.0, 1.0); }
fn thick(p: vec2<f32>) -> vec2<f32> { let t = textureSampleLevel(field, smp, p / vec2<f32>(${F(W)}, ${F(H)}), 0.0).rg; return t / 15.0; }
fn over(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> { return b + a * (1.0 - b.a); }
@fragment fn fs(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
  let p = at.xy / u.size * vec2<f32>(${F(W)}, ${F(H)}); let px = ${F(W)} / u.size.x; let dark = u.light.x;
  let s = glassAt(p); let d = s.x;
  if (d > ${F(FAR)} - 0.5) { return vec4<f32>(0.0); }
  let g = s.yz; let n = g / max(length(g), 1e-3);
  let here = mapAt(p); let look = u.look[min((here >> 16u) & 255u, ${PLACES - 1}u)]; 
  // (Its vessel's own, and a little round it.)
  let off = length(p - vec2<f32>(look.zw)) - places[min((here >> 16u) & 255u, ${PLACES - 1}u)].foot.y + look.w - 2.0;
  let full = look.x;
  // (One not yet to be poured into, its glass faint.)
  let own = here & 255u; let clear = mix(1.0, 0.45, select(u.look[min(own, ${PLACES - 1}u)].y, look.y, own == ${NOWHERE}u));
  let sun = normalize(vec2<f32>(-0.6, -0.8));
  var col = vec4<f32>(0.0);
  // The glass's back: a faint body, and the light coming through it.
  let in0 = 1.0 - smoothstep(-px, px, d);
  col = over(col, vec4<f32>(vec3<f32>(0.75, 0.8, 1.0), 1.0) * in0 * mix(0.05, 0.045, dark));
  // THE LIQUID: where the particles lie thick, up to the glass.
  let e = 0.55;
  let t = thick(p);
  let gx = thick(p + vec2<f32>(e, 0.0)).x - thick(p - vec2<f32>(e, 0.0)).x; let gy = thick(p + vec2<f32>(0.0, e)).x - thick(p - vec2<f32>(0.0, e)).x;
  let cover = smoothstep(0.30, 0.42, t.x) * (1.0 - smoothstep(-0.25 - px, -0.25 + px, d));
  if (cover > 0.001) {
    let sp = t.y / max(t.x, 1e-3);
    let surf = normalize(vec3<f32>(-gx * 2.2, -gy * 2.2, 0.55));
    // It is round in its vessel: thickest in the middle, so darkest there, and lit through at its edges.
    let deep = clamp(-d / 8.0, 0.0, 1.0);
    let round = normalize(vec3<f32>(n * (1.0 - deep) * 0.9, 0.5 + deep));
    let nn = normalize(surf + round * 0.8);
    var c = mix(vec3<f32>(1.0, 0.34, 0.72), vec3<f32>(0.62, 0.10, 0.86), smoothstep(0.0, 0.6, deep));
    c = mix(c, vec3<f32>(0.24, 0.05, 0.55), smoothstep(0.35, 1.0, deep) * 0.75);
    // Currents, as they move: light bent through it.
    let w = p * 0.16 + vec2<f32>(sin(p.y * 0.21 + gx * 6.0), cos(p.x * 0.19 + gy * 6.0)) * 0.9;
    let vein = pow(0.5 + 0.5 * sin(w.x * 2.1 + sin(w.y * 1.7 + t.x * 2.0) * 1.6), 5.0);
    c += vec3<f32>(0.75, 0.35, 1.0) * vein * 0.16 * (0.4 + deep);
    // FULL, it is lit from within.
    c += vec3<f32>(0.85, 0.30, 0.75) * full * (0.12 + 0.34 * deep) * (1.0 - smoothstep(0.0, 3.0, off));
    // Its free surface, caught by the light.
    let edge = smoothstep(0.85, 0.40, t.x) * smoothstep(-0.6, -2.0, d);
    c += vec3<f32>(1.0, 0.62, 0.92) * edge * 0.75;
    let h = normalize(vec3<f32>(sun, 0.9) + vec3<f32>(0.0, 0.0, 1.0));
    c += vec3<f32>(1.0, 0.9, 1.0) * pow(max(dot(nn, h), 0.0), 40.0) * 0.7;
    // Fast, it froths.
    c = mix(c, vec3<f32>(1.0, 0.80, 0.97), clamp((sp - 0.9) * 0.28, 0.0, 0.55));
    col = over(col, vec4<f32>(c, 1.0) * cover * 0.95);
  }
  col += vec4<f32>(vec3<f32>(1.0, 0.3, 0.8) * 0.30, 0.05) * full * exp(-max(d, 0.0) / 4.0) * (1.0 - smoothstep(1.0, 7.0, off)) * smoothstep(-1.0, 1.0, d);
  // And its glow, out round it: added to what is behind.
  let halo = clamp(t.x, 0.0, 1.0) * (1.0 - cover);
  col += vec4<f32>(vec3<f32>(0.75, 0.18, 0.75) * halo * 0.5, halo * 0.12);
  // THE GLASS'S FRONT: its two edges, and the light along them.
  let wall = smoothstep(-px, px, d + 0.15) * (1.0 - smoothstep(1.5 - px, 1.5 + px, d));
  let lit = 0.5 + 0.5 * dot(n, sun);
  let line = (1.0 - smoothstep(0.0, 0.55, abs(d - 1.35))) + 0.5 * (1.0 - smoothstep(0.0, 0.4, abs(d)));
  let glassCol = mix(vec3<f32>(0.30, 0.30, 0.42), vec3<f32>(0.82, 0.86, 1.0), dark);
  col = over(col, vec4<f32>(glassCol, 1.0) * wall * 0.20 * clear);
  col = over(col, vec4<f32>(glassCol, 1.0) * clamp(line, 0.0, 1.0) * (0.30 + 0.55 * lit * lit) * clear);
  // (None down the middle of a pipe, where the two sides meet.)
  let plain = smoothstep(0.75, 0.98, length(g));
  let streak = exp(-pow((d + 3.0) / 0.75, 2.0)) * smoothstep(0.55, 0.95, dot(n, normalize(vec2<f32>(-1.0, -0.25)))) * step(d, -0.4) * plain;
  col = over(col, vec4<f32>(1.0) * streak * 0.42 * clear);
  let streak2 = exp(-pow((d + 2.2) / 0.5, 2.0)) * smoothstep(0.8, 1.0, dot(n, normalize(vec2<f32>(1.0, 0.5)))) * step(d, -0.4) * plain;
  col = over(col, vec4<f32>(1.0) * streak2 * 0.16);
  // The valves' gates.
  let gk = (here >> 8u) & 255u;
  if (gk > 0u) {
    let gq = plate(p, places[gk].gate, places[gk].open); let gd = max(gq.x, gq.y);
    let shut = (1.0 - smoothstep(-px, px, gd)) * (1.0 - smoothstep(-px, px, d - 0.2));
    col = over(col, vec4<f32>(mix(vec3<f32>(0.42, 0.40, 0.48), vec3<f32>(0.76, 0.74, 0.84), clamp(0.5 - (p.y - places[gk].gate.y) * 0.4, 0.0, 1.0)), 1.0) * shut * clear);
  }
  return col;
}
`;
export const stillSources = () => ({ sim: SIM, splat: SPLAT, draw: DRAW });

/** A number as a half float's bits. */
function half(v: number): number {
  const s = v < 0 ? 0x8000 : 0, a = Math.abs(v);
  if (a < 6.2e-5) return s;
  const e = Math.floor(Math.log2(a));
  return s | ((e + 15) << 10) | Math.min(1023, Math.round((a / 2 ** e - 1) * 1024));
}

/** The juice there is: in the flask, and in each vessel as a share; and which are not yet to be poured into. */
export type Amounts = { flask: number; shares: readonly number[]; locked: readonly boolean[] };
export type Still = {
  set: (a: Amounts) => void;
  stir: (x: number, y: number, vx: number, vy: number) => void;
  theme: (dark: boolean) => void;
  size: (w: number, h: number) => void;
  running: () => boolean;
  /** What each place holds, should hold, and its gate. */
  holds: () => { has: number; want: number; open: number; awake: number }[];
  destroy: () => void;
};

export function createStill(device: GPUDevice, canvas: HTMLCanvasElement, first: Amounts): Still | null {
  const ctx = canvas.getContext("webgpu");
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "premultiplied" });
  const S = GPUBufferUsage.STORAGE, C = GPUBufferUsage.COPY_DST, R = GPUBufferUsage.COPY_SRC, owned: (GPUBuffer | GPUTexture)[] = [];
  const buffer = (label: string, size: number, usage: number) => { const b = device.createBuffer({ label: `still ${label}`, size, usage }); owned.push(b); return b; };
  const ps = buffer("particles", MOST * 32, S | C), cells = buffer("cells", W * H * 16, S), vel = buffer("velocity", W * H * 8, S);
  const mapB = buffer("map", W * H * 4, S | C), placeB = buffer("places", PLACES * 32, S | C | R);
  const uni = buffer("numbers", 64 + PLACES * 16, GPUBufferUsage.UNIFORM | C), tally = buffer("tally", PLACES * 8 + 8, S | C);
  const back = buffer("places read", PLACES * 32, GPUBufferUsage.MAP_READ | C);

  // THE GLASS: how far out, and which way out, as a picture.
  const coarse = glassField(), fine = glassField(FINE), map = placeMap(coarse), fw = W * FINE, fh = H * FINE;
  device.queue.writeBuffer(mapB, 0, map as Uint32Array<ArrayBuffer>);
  const pic = new Uint16Array(fw * fh * 4), far = (x: number, y: number) => fine[Math.max(0, Math.min(fh - 1, y)) * fw + Math.max(0, Math.min(fw - 1, x))];
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const i = (y * fw + x) * 4;
    pic[i] = half(far(x, y)); pic[i + 1] = half((far(x + 1, y) - far(x - 1, y)) / 2 * FINE); pic[i + 2] = half((far(x, y + 1) - far(x, y - 1)) / 2 * FINE);
  }
  const texture = (label: string, w: number, h: number, usage: number) => { const t = device.createTexture({ label: `still ${label}`, size: [w, h], format: "rgba16float", usage }); owned.push(t); return t; };
  const glass = texture("glass", fw, fh, GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
  device.queue.writeTexture({ texture: glass }, pic, { bytesPerRow: fw * 8 }, [fw, fh]);
  const field = texture("field", W * 3, H * 3, GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING), fieldView = field.createView();
  const smp = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  // WHAT EACH PLACE SHOULD HOLD.
  const want = new Float32Array(PLACES), has = new Float32Array(PLACES), lit = new Float32Array(PLACES), open = new Float32Array(PLACES), awake = new Float32Array(PLACES);
  let now = first, tap = 0;
  const aim = () => {
    want[0] = flaskCells(now.flask) * A_CELL;
    VESSELS.forEach((v, k) => { want[k + 1] = now.shares[k] * v.cells * A_CELL; });
  };
  aim();
  let n = 0;
  {
    const spots = Array.from(want, (w, k) => restingIn(map, coarse, k, Math.round(w))).flat().slice(0, MOST), d = new Float32Array(MOST * 8);
    for (let i = 0; i < MOST; i++) d.set(spots[i] ?? [-100, -100], i * 8);
    device.queue.writeBuffer(ps, 0, d);
    n = Math.min(MOST, spots.length + 1000);
    const z = new Float32Array(PLACES * 8);
    for (let k = 0; k < PLACES; k++) {
      const v = VESSELS[k - 1];
      z.set(v ? [...v.gate, v.at[0], v.at[1] + v.r - 2, 0, want[k], REST, want[k]] : [-50, -50, FLASK.at[0], FLASK.at[1] + FLASK.r + 8, 0, want[k], REST, want[k]], k * 8);
      has[k] = want[k]; awake[k] = REST;
    }
    device.queue.writeBuffer(placeB, 0, z);
  }

  const V = GPUShaderStage, ro = { type: "read-only-storage" as const };
  const layout = (label: string, vis: number, rest: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ label: `still ${label}`, entries: [
    { binding: 0, visibility: vis, buffer: { type: "uniform" } }, { binding: 1, visibility: vis, buffer: ro },
    { binding: 2, visibility: vis, texture: {} }, { binding: 3, visibility: vis, sampler: {} }, ...rest,
  ] });
  const group = (l: GPUBindGroupLayout, rest: GPUBindingResource[]) => device.createBindGroup({ layout: l, entries: [{ buffer: uni }, { buffer: mapB }, glass.createView(), smp, ...rest].map((resource, binding) => ({ binding, resource })) });
  const simL = layout("sim", V.COMPUTE, [4, 5, 6, 7, 8].map((binding) => ({ binding, visibility: V.COMPUTE, buffer: { type: "storage" } })));
  const splatL = layout("splat", V.VERTEX, [{ binding: 4, visibility: V.VERTEX, buffer: ro }]);
  const drawL = layout("draw", V.FRAGMENT, [{ binding: 4, visibility: V.FRAGMENT, texture: {} }, { binding: 5, visibility: V.FRAGMENT, buffer: ro }]);
  const simGroup = group(simL, [ps, cells, vel, tally, placeB].map((b) => ({ buffer: b })));
  const splatGroup = group(splatL, [{ buffer: ps }]), drawGroup = group(drawL, [fieldView, { buffer: placeB }]);

  const module = device.createShaderModule({ label: "still sim", code: SIM }), pl = device.createPipelineLayout({ bindGroupLayouts: [simL] });
  const step = (entryPoint: string) => device.createComputePipeline({ label: `still ${entryPoint}`, layout: pl, compute: { module, entryPoint } });
  const passes = { clear: step("clear"), give: step("give"), press: step("press"), hold: step("hold"), take: step("take"), count: step("count"), serve: step("serve") };
  const splatM = device.createShaderModule({ label: "still splat", code: SPLAT }), drawM = device.createShaderModule({ label: "still draw", code: DRAW });
  const add: GPUBlendComponent = { srcFactor: "one", dstFactor: "one", operation: "add" };
  const splat = device.createRenderPipeline({ label: "still splat", layout: device.createPipelineLayout({ bindGroupLayouts: [splatL] }), vertex: { module: splatM, entryPoint: "vs" },
    fragment: { module: splatM, entryPoint: "fs", targets: [{ format: "rgba16float", blend: { color: add, alpha: add } }] }, primitive: { topology: "triangle-strip" } });
  const draw = device.createRenderPipeline({ label: "still draw", layout: device.createPipelineLayout({ bindGroupLayouts: [drawL] }), vertex: { module: drawM, entryPoint: "vs" },
    fragment: { module: drawM, entryPoint: "fs", targets: [{ format }] }, primitive: { topology: "triangle-list" } });

  const num = new Float32Array(16 + PLACES * 4);
  let dark = true, raf = 0, last = 0, owed = 0, dead = false, reading = false, rest = 0, pending = 0;
  const stirred = { x: 0, y: 0, vx: 0, vy: 0 };

  const tick = (t: number) => {
    raf = 0;
    if (dead) return;
    const dt = last ? Math.min(0.034, (t - last) / 1000) : 1 / 60;
    last = t;
    owed += dt * 60 * STEPS;
    const steps = Math.min(STEPS * 2, Math.floor(owed)); owed -= steps;
    // The flask holds its own, and what the vessels are yet to be given.
    let due = 0;
    for (let k = 1; k < PLACES; k++) due += Math.max(0, want[k] - has[k]);
    const flask = want[0] + due, born = [0, 0];
    if (tap >= 1) { born[0] = Math.min(Math.floor(tap), Math.ceil(dt * 1500)); tap -= born[0]; }
    else if (pending === 0 && flask - has[0] > 20) { born[1] = Math.min(60, Math.round(flask - has[0])); pending = born[1]; }
    device.queue.writeBuffer(placeB, 5 * 4, new Float32Array([tap >= 1 || born[0] ? Math.max(flask, has[0]) : flask]));
    for (let k = 1; k < PLACES; k++) device.queue.writeBuffer(placeB, (k * 8 + 5) * 4, want, k, 1);
    if (born[0] + born[1]) n = Math.min(MOST, Math.max(n, Math.round(has.reduce((x, y) => x + y, 0) * 1.1) + 1000));
    let fading = false;
    for (let k = 1; k < PLACES; k++) {
      const to = now.shares[k - 1] >= 1 && has[k] > want[k] * 0.9 ? 1 : 0, was = lit[k];
      lit[k] = Math.abs(to - was) < 0.01 ? to : was + (to - was) * Math.min(1, dt * 3);
      fading ||= lit[k] !== to;
      num.set([lit[k], now.locked[k - 1] ? 1 : 0, ...VESSELS[k - 1].at], 16 + k * 4);
    }
    stirred.vx *= 0.8; stirred.vy *= 0.8;
    num.set([canvas.width, canvas.height, n, t / 1000, stirred.x, stirred.y, stirred.vx, stirred.vy, born[0], born[1], 0, 0, dark ? 1 : 0, 0, 0, 0]);
    device.queue.writeBuffer(uni, 0, num);
    const enc = device.createCommandEncoder({ label: "still" });
    enc.clearBuffer(tally);
    const c = enc.beginComputePass({ label: "still" });
    c.setBindGroup(0, simGroup);
    const g = Math.ceil((W * H) / 64), p = Math.ceil(n / 64);
    const run = (q: GPUComputePipeline, k: number) => { c.setPipeline(q); c.dispatchWorkgroups(k); };
    for (let i = 0; i < steps; i++) { run(passes.clear, g); run(passes.give, p); run(passes.press, p); run(passes.hold, g); run(passes.take, p); }
    run(passes.count, p); run(passes.serve, 1);
    c.end();
    const a = enc.beginRenderPass({ colorAttachments: [{ view: fieldView, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    a.setPipeline(splat); a.setBindGroup(0, splatGroup); a.draw(4, n); a.end();
    const b = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    b.setPipeline(draw); b.setBindGroup(0, drawGroup); b.draw(3); b.end();
    const read = !reading;
    if (read) enc.copyBufferToBuffer(placeB, 0, back, 0, PLACES * 32);
    device.queue.submit([enc.finish()]);
    if (read) {
      reading = true;
      void back.mapAsync(GPUMapMode.READ).then(() => {
        if (dead) return;
        const q = new Float32Array(back.getMappedRange());
        for (let k = 0; k < PLACES; k++) { open[k] = q[k * 8 + 4]; awake[k] = q[k * 8 + 6]; has[k] = q[k * 8 + 7]; }
        back.unmap(); reading = false; pending = 0;
      }, () => { reading = false; });
    }
    rest = fading || tap >= 1 || Math.abs(stirred.vx) + Math.abs(stirred.vy) > 0.01 || awake.some((v) => v > 0) ? 0 : rest + 1;
    if (rest < 20) raf = requestAnimationFrame(tick); else last = 0;
  };
  const wake = () => { rest = 0; if (!raf && !dead) raf = requestAnimationFrame(tick); };
  wake();
  return {
    set: (a) => {
      // More in the flask comes in by its tap.
      const more = flaskCells(a.flask) - flaskCells(now.flask);
      if (more > 0) tap = Math.min(6000, tap + more * A_CELL);
      now = a; aim(); wake();
    },
    stir: (x, y, vx, vy) => { Object.assign(stirred, { x, y, vx, vy }); wake(); },
    theme: (d) => { dark = d; wake(); },
    size: (w, h) => { canvas.width = w; canvas.height = h; wake(); },
    running: () => raf !== 0,
    holds: () => Array.from(has, (h, k) => ({ has: h, want: want[k], open: open[k], awake: awake[k] })),
    destroy: () => { dead = true; cancelAnimationFrame(raf); raf = 0; ctx.unconfigure(); for (const b of owned) b.destroy(); },
  };
}

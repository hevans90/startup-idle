/**
 * World v2 — THE NIGHT'S OWN LIGHT, worked out on the map. A SPIKE.
 *
 * The night was one colour multiplied over the whole screen, and the town's lamps and windows soft sprites added
 * on top of it: light that no wall stops, that lights nothing, and that is the same whichever way a street runs.
 * Here the light is worked out in the map's own plane — a texture a few texels a tile, as the ground's shade is —
 * by RADIANCE CASCADES (Sannikov): every lamp, lit building and headlight an emitter, every building a wall, and
 * the cost the same for one light as for a thousand. The night's colour is then laid over the screen through
 * that texture: dark where no light comes, lifted toward day where it does.
 *
 * THE CASCADES. Cascade `i` has a probe every `s0·2^i` texels, each looking `4^(i+1)` ways along the stretch from
 * `l0·(4^i − 1)/3` to four times as far on: near a light, many places and few directions; far from it, few
 * places and many — which is all a shadow's edge asks for. From the furthest cascade inward each takes what its
 * rays found and, where they found no wall, what the cascade beyond it saw on along them.
 *
 * WHAT IT IS NOT, YET. It is flat: a wall is whatever stands taller than a lamp, and stops all light or none.
 * It lights the ground's plane, so what stands on the ground takes the light of the ground behind it. Buildings
 * and cars are not lit by it as themselves. WebGPU only; without it, or switched off, the night is as it was.
 * @see light.ts, ground-mesh castGround, lights.ts lightsOf
 */
import { BufferImageSource, Buffer, BufferUsage, Geometry, GpuProgram, Matrix, Mesh, Shader, UniformGroup, type Container, type Renderer } from "pixi.js";
import { HH, HW } from "../iso";

/** What the spike can be asked for, live. @see setGi */
export type GiOptions = {
  /** Whether the light is worked out at all: off, the night is the flat grade and the glows it always was. */
  on: boolean;
  /** How many cascades: how far a light reaches — 3, some five tiles; 4, some twenty; 5, the map. */
  cascades: 3 | 4 | 5;
  /** Quarter-tiles between the nearest cascade's probes: 1 is finer and four times the work of 2. */
  spacing: 1 | 2;
  /** Whether the old glows — the soft sprites over the lamps, windows and headlights — are drawn too. */
  glows: boolean;
  /** Whether buildings stop light. Off, light passes through everything. */
  walls: boolean;
  /** Whether the lamps, the lit buildings and the headlights each give light. */
  lamps: boolean; windows: boolean; headlights: boolean;
  /** How strongly the light lifts the night. */
  gain: number;
  /** Show the light alone, over a black map: what was worked out, and nothing else. */
  only: boolean;
};
const options: GiOptions = { on: false, cascades: 4, spacing: 2, glows: false, walls: true, lamps: true, windows: true, headlights: true, gain: 0.5, only: false };
let version = 0;
export const giOptions = (): Readonly<GiOptions> => options;
export const giVersion = () => version;
export function setGi(o: Partial<GiOptions>): GiOptions { Object.assign(options, o); version++; return { ...options }; }
/** How long the passes took on the GPU last time it was asked, ms; NaN if it cannot be told. */
let lastMs = NaN;
export const giMs = () => lastMs;

// ASKED FOR IN THE ADDRESS, or from the console: `?gi` turns it on (`?gi=glows,only,5,1` with options), and
// `__gi({ ... })` changes anything live; `__giMs()` says what it cost.
if (typeof window !== "undefined") {
  const w = window as unknown as { __gi?: (o?: Partial<GiOptions>) => GiOptions; __giMs?: () => number };
  w.__gi = (o = {}) => setGi(o);
  w.__giMs = giMs;
  const q = typeof location !== "undefined" ? /[?&]gi(?:=([^&]*))?(?:&|$)/.exec(location.search) : null;
  if (q) {
    const words = (q[1] ?? "").split(",");
    setGi({
      on: !words.includes("off"), glows: words.includes("glows"), only: words.includes("only"), walls: !words.includes("nowalls"),
      ...(words.includes("3") ? { cascades: 3 } : words.includes("5") ? { cascades: 5 } : {}), ...(words.includes("1") ? { spacing: 1 } : {}),
    });
  }
}

/** A light: its middle and half its size, quarter-tiles; its colour, as strong as it is; and whether it is a soft round pool (0) or a lit block (1). */
export type GiLight = { x: number; y: number; hx: number; hy: number; r: number; g: number; b: number; solid: 0 | 1 };

/** Quarter-tiles a tile: the grid the ground's shade and what is built are kept on. @see ground-mesh SHADE_PER_TILE */
const Q = 4;
/** Lights at most, a frame. */
const MAX_LIGHTS = 4096;
const FLOATS = 8;

const EMIT_WGSL = /* wgsl */ `
struct U { scene: vec2<f32>, pad: vec2<f32> };
@group(0) @binding(0) var<uniform> u: U;
struct V { @builtin(position) pos: vec4<f32>, @location(0) at: vec2<f32>, @location(1) col: vec3<f32>, @location(2) solid: f32 };
@vertex
fn vs(@builtin(vertex_index) i: u32, @location(0) box: vec4<f32>, @location(1) col: vec4<f32>) -> V {
  var c = array<vec2<f32>, 6>(vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));
  let q = c[i];
  let p = box.xy + q * box.zw;
  var o: V;
  o.pos = vec4<f32>(p.x / u.scene.x * 2.0 - 1.0, 1.0 - p.y / u.scene.y * 2.0, 0.0, 1.0);
  o.at = q; o.col = col.rgb; o.solid = col.a;
  return o;
}
@fragment
fn fs(v: V) -> @location(0) vec4<f32> {
  let d = length(v.at);
  let round = max(0.0, 1.0 - d * d);
  return vec4<f32>(v.col * mix(round * round, 1.0, v.solid), 1.0);
}
`;

const CASCADE_WGSL = /* wgsl */ `
struct U { level: f32, count: f32, s0: f32, l0: f32, scene: vec2<f32>, size: vec2<f32>, walls: f32, p0: f32, p1: f32, p2: f32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var occ: texture_2d<f32>;
@group(0) @binding(2) var emit: texture_2d<f32>;
@group(0) @binding(3) var upper: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let lvl = u32(u.level);
  // A probe's block: as many texels a side as it has directions a quarter turn... 2, 4, 8.
  let d = 2u << lvl;
  let p = vec2<u32>(pos.xy);
  let probe = p / d; let dp = p % d; let idx = dp.x + dp.y * d; let nd = d * d;
  let ang = (f32(idx) + 0.5) / f32(nd) * 6.2831853;
  let dir = vec2<f32>(cos(ang), sin(ang));
  let spacing = u.s0 * f32(1u << lvl);
  let origin = (vec2<f32>(probe) + 0.5) * spacing;
  let p4 = pow(4.0, u.level);
  let t0 = u.l0 * (p4 - 1.0) / 3.0; let t1 = t0 + u.l0 * p4;
  let step = max(1.0, f32(1u << lvl) * 0.5);
  var rad = vec3<f32>(0.0); var tr = 1.0;
  var t = t0 + step * 0.5;
  // A PROBE UNDER A BUILDING looks out through its own walls: what stands there is lit as the street round it is,
  // and its footprint is not a hole in the light for the building's own picture to fall into.
  var within = textureSampleLevel(occ, samp, origin / u.scene, 0.0).r > 0.5;
  for (var k = 0; k < 256; k++) {
    if (t >= t1) { break; }
    let q = origin + dir * t;
    if (q.x < 0.0 || q.y < 0.0 || q.x >= u.scene.x || q.y >= u.scene.y) { break; }
    let uv = q / u.scene;
    let e = textureSampleLevel(emit, samp, uv, 0.0).rgb;
    let wall = textureSampleLevel(occ, samp, uv, 0.0).r > 0.5;
    if (wall && !within && u.walls > 0.5) { rad += tr * e; tr = 0.0; break; }
    if (!wall) { within = false; rad += tr * e * step * 0.25; }
    t += step;
  }
  // WHAT LIES BEYOND, where nothing stopped the ray: the next cascade's four directions round this one, from the
  // four of its probes round this point, weighed by how near each is.
  if (u.level + 1.5 < u.count && tr > 0.0) {
    let ud = d * 2u;
    let uprobes = vec2<i32>(vec2<u32>(u.size) / ud);
    let up = origin / (spacing * 2.0) - 0.5;
    let b = floor(up); let f = up - b;
    var acc = vec4<f32>(0.0);
    for (var j = 0; j < 2; j++) { for (var i = 0; i < 2; i++) {
      let pc = clamp(vec2<i32>(b) + vec2<i32>(i, j), vec2<i32>(0), uprobes - vec2<i32>(1));
      let w = mix(1.0 - f.x, f.x, f32(i)) * mix(1.0 - f.y, f.y, f32(j));
      var s = vec4<f32>(0.0);
      for (var k = 0u; k < 4u; k++) {
        let ui = idx * 4u + k;
        s += textureLoad(upper, vec2<u32>(pc) * ud + vec2<u32>(ui % ud, ui / ud), 0);
      }
      acc += w * s * 0.25;
    } }
    rad += tr * acc.rgb; tr *= acc.a;
  }
  return vec4<f32>(rad, tr);
}
`;

const FINAL_WGSL = /* wgsl */ `
struct U { gain: f32, p0: f32, p1: f32, p2: f32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var near: texture_2d<f32>;
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  // The light come to a probe from every way it looks: its four directions together.
  let p = vec2<u32>(pos.xy) * 2u;
  let l = (textureLoad(near, p, 0).rgb + textureLoad(near, p + vec2<u32>(1u, 0u), 0).rgb + textureLoad(near, p + vec2<u32>(0u, 1u), 0).rgb + textureLoad(near, p + vec2<u32>(1u, 1u), 0).rgb) * 0.25;
  // (Rolled off, not cut off: under a lamp it is bright, and no brighter than day.)
  return vec4<f32>(vec3<f32>(1.0) - exp(-l * u.gain), 1.0);
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
struct Sheet { uGrade: vec4<f32>, uMap: vec4<f32> };
@group(2) @binding(0) var<uniform> sheet : Sheet;
@group(2) @binding(1) var uLight : texture_2d<f32>;
@group(2) @binding(2) var uLightSampler : sampler;
struct VSOutput { @builtin(position) position: vec4<f32>, @location(0) vGround: vec2<f32> };
@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aGround: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  var out: VSOutput;
  out.position = vec4<f32>((mvp * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0);
  out.vGround = aGround;
  return out;
}
@fragment
fn mainFragment(in: VSOutput) -> @location(0) vec4<f32> {
  let uv = in.vGround / sheet.uMap.xy;
  let inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
  let l = textureSampleLevel(uLight, uLightSampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb * inside;
  // The night's colour, lifted toward day by the light that comes there; or, asked for, the light alone.
  // (Toward the light's own colour as it is strong: under a lamp the street is lamp-lit, warm, and not the night's blue made pale.)
  let a = max(l.r, max(l.g, l.b));
  let lit = mix(sheet.uGrade.rgb, l / max(a, 0.0001), a);
  return vec4<f32>(mix(lit, l, sheet.uGrade.a), 1.0);
}
`;

type Gpu = { gpu?: { device: GPUDevice }; texture?: { getGpuSource: (s: unknown) => GPUTexture } };

export type Gi = {
  /**
   * This frame: the lights, what stands in their way (`casts`, half steps over the ground a quarter-tile, and a
   * count that moves when they do), the night's grade as a colour, how dark it is (0–1), and the map's transform
   * to the screen. True if the light was worked out and laid: the flat night is then not to be drawn.
   */
  tick: (lights: readonly GiLight[], casts: Float32Array, castsRev: number, grade: number, night: number, map: Matrix) => boolean;
  destroy: () => void;
};

/** The map's own light, for a map `w` by `h` tiles; null where there is no WebGPU. */
export function createGi(renderer: Renderer, stage: Container, zIndex: number, w: number, h: number, scale: number): Gi | null {
  const sys = renderer as unknown as Gpu, device = sys.gpu?.device;
  if (!device || typeof sys.texture?.getGpuSource !== "function") return null;
  const SW = w * Q, SH = h * Q;
  const fmt: GPUTextureFormat = "rgba16float";
  const tex = (width: number, height: number, format: GPUTextureFormat, usage: number) => device.createTexture({ size: [width, height], format, usage });
  const RT = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  const occ = tex(SW, SH, "r8unorm", GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
  const emit = tex(SW, SH, fmt, RT);
  const occBytes = new Uint8Array(SW * SH);
  const linear = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
  const lightData = new Float32Array(MAX_LIGHTS * FLOATS);
  const lightBuf = device.createBuffer({ size: lightData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const sceneU = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(sceneU, 0, new Float32Array([SW, SH, 0, 0]));

  const emitMod = device.createShaderModule({ code: EMIT_WGSL });
  const emitPipe = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: emitMod, entryPoint: "vs",
      buffers: [{ arrayStride: FLOATS * 4, stepMode: "instance", attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }, { shaderLocation: 1, offset: 16, format: "float32x4" }] }],
    },
    fragment: { module: emitMod, entryPoint: "fs", targets: [{ format: fmt, blend: { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "one", dstFactor: "one" } } }] },
  });
  const emitBind = device.createBindGroup({ layout: emitPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: sceneU } }] });

  const cascMod = device.createShaderModule({ code: CASCADE_WGSL });
  const cascPipe = device.createRenderPipeline({ layout: "auto", vertex: { module: cascMod, entryPoint: "vs" }, fragment: { module: cascMod, entryPoint: "fs", targets: [{ format: fmt }] } });
  const finalMod = device.createShaderModule({ code: FINAL_WGSL });
  const finalPipe = device.createRenderPipeline({ layout: "auto", vertex: { module: finalMod, entryPoint: "vs" }, fragment: { module: finalMod, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] } });
  const finalU = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  /** What is sized by the options: the cascades' textures and the light's own, made again when they change. */
  type Sized = {
    key: string; count: number; T: [number, number];
    levels: { view: GPUTextureView; texture: GPUTexture; bind: GPUBindGroup; u: GPUBuffer }[];
    light: BufferImageSource; lightView: GPUTextureView; finalBind: GPUBindGroup; mesh: Mesh<Geometry, Shader>; sheetU: UniformGroup;
  };
  let sized: Sized | null = null;
  const unsize = () => {
    if (!sized) return;
    const s = sized; sized = null;
    s.mesh.parent?.removeChild(s.mesh);
    // (A moment later: the frame that drew with them may still be reading them. @see batches-keep-destroyed-sources)
    setTimeout(() => { for (const l of s.levels) { l.texture.destroy(); l.u.destroy(); } const geo = s.mesh.geometry; s.mesh.destroy(); geo.destroy(true); s.light.destroy(); }, 500);
  };
  const size = (): Sized => {
    const count = options.cascades, s0 = options.spacing, key = `${count}|${s0}`;
    if (sized?.key === key) return sized;
    unsize();
    // Probes of the nearest cascade a side, rounded up to what the furthest cascade's blocks divide.
    const m = 1 << (count - 1), px = Math.ceil(SW / s0 / m) * m, py = Math.ceil(SH / s0 / m) * m, T: [number, number] = [px * 2, py * 2];
    const textures = Array.from({ length: count }, () => tex(T[0], T[1], fmt, RT));
    const blank = tex(1, 1, fmt, RT);
    const levels = textures.map((texture, i) => {
      const u = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const bind = device.createBindGroup({
        layout: cascPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: u } }, { binding: 1, resource: occ.createView() }, { binding: 2, resource: emit.createView() },
          { binding: 3, resource: (textures[i + 1] ?? blank).createView() }, { binding: 4, resource: linear },
        ],
      });
      return { view: texture.createView(), texture, bind, u };
    });
    const light = new BufferImageSource({ resource: new Uint8Array(px * py * 4), width: px, height: py, format: "rgba8unorm", scaleMode: "linear" });
    const lightView = sys.texture!.getGpuSource(light).createView();
    const finalBind = device.createBindGroup({ layout: finalPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: finalU } }, { binding: 1, resource: levels[0].view }] });
    // THE SHEET: the map's plane and as much again all round it, so the night reaches the screen's corners.
    const sheetU = new UniformGroup({
      uGrade: { value: new Float32Array([1, 1, 1, 0]), type: "vec4<f32>" },
      // (The light's texture covers the probes' grid, which may run a little past the map: in tiles.)
      uMap: { value: new Float32Array([(px * s0) / Q, (py * s0) / Q, 0, 0]), type: "vec4<f32>" },
    });
    const R = Math.max(w, h) * 3, corners = [[-R, -R], [w + R, -R], [w + R, h + R], [-R, h + R]];
    const verts = new Float32Array(corners.flatMap(([gu, gv]) => [(gu - 0.5 - (gv - 0.5)) * HW * scale, (gu - 0.5 + gv - 0.5) * HH * scale, gu, gv]));
    const vb = new Buffer({ data: verts, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const ib = new Buffer({ data: new Uint32Array([0, 1, 2, 0, 2, 3]), usage: BufferUsage.INDEX | BufferUsage.COPY_DST });
    const geometry = new Geometry({
      attributes: { aPosition: { buffer: vb, format: "float32x2", stride: 16, offset: 0 }, aGround: { buffer: vb, format: "float32x2", stride: 16, offset: 8 } },
      indexBuffer: ib,
    });
    const shader = new Shader({
      gpuProgram: GpuProgram.from({
        vertex: { source: SHEET_WGSL, entryPoint: "mainVertex" }, fragment: { source: SHEET_WGSL, entryPoint: "mainFragment" }, name: "gi-sheet",
        layout: [{ globalUniforms: 0 }, { localUniforms: 0 }, { sheet: 0, uLight: 1, uLightSampler: 2 }],
        gpuLayout: [
          [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
          [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
          [
            { binding: 0, visibility: 2, buffer: { type: "uniform" } },
            { binding: 1, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
            { binding: 2, visibility: 2, sampler: { type: "filtering" } },
          ],
        ],
      }),
      resources: { sheet: sheetU, uLight: light, uLightSampler: light.style },
    });
    const mesh = new Mesh<Geometry, Shader>({ geometry, shader });
    mesh.eventMode = "none";
    mesh.blendMode = "multiply";
    mesh.zIndex = zIndex;
    stage.addChild(mesh);
    levels.forEach((l, i) => device.queue.writeBuffer(l.u, 0, new Float32Array([i, count, s0, s0, SW, SH, T[0], T[1], 1, 0, 0, 0])));
    return (sized = { key, count, T, levels, light, lightView, finalBind, mesh, sheetU });
  };

  // HOW LONG IT TOOK, where the device can say: the first pass's start to the last's end.
  const stamps = device.features.has("timestamp-query") ? {
    set: device.createQuerySet({ type: "timestamp", count: 2 }),
    resolve: device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
    read: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
    busy: false,
  } : null;

  let seenCasts = -1, seenWalls: boolean | null = null, frame = 0;
  return {
    tick(lights, casts, castsRev, grade, night, map) {
      if (!options.on || night <= 0.02) { if (sized) sized.mesh.visible = false; return false; }
      const s = size();
      frame++;
      // WHAT STANDS IN THE LIGHT'S WAY: whatever is built taller than a lamp. (Sent again when what is built changes.)
      if (castsRev !== seenCasts || options.walls !== seenWalls) {
        seenCasts = castsRev; seenWalls = options.walls;
        for (let i = 0; i < occBytes.length; i++) occBytes[i] = casts[i] > 1.2 ? 255 : 0;
        device.queue.writeTexture({ texture: occ }, occBytes, { bytesPerRow: SW }, [SW, SH]);
        for (const l of s.levels) device.queue.writeBuffer(l.u, 32, new Float32Array([options.walls ? 1 : 0]));
      }
      const n = Math.min(lights.length, MAX_LIGHTS);
      for (let i = 0; i < n; i++) { const l = lights[i], o = i * FLOATS; lightData[o] = l.x; lightData[o + 1] = l.y; lightData[o + 2] = l.hx; lightData[o + 3] = l.hy; lightData[o + 4] = l.r; lightData[o + 5] = l.g; lightData[o + 6] = l.b; lightData[o + 7] = l.solid; }
      if (n) device.queue.writeBuffer(lightBuf, 0, lightData, 0, n * FLOATS);
      device.queue.writeBuffer(finalU, 0, new Float32Array([options.gain * night, 0, 0, 0]));

      const enc = device.createCommandEncoder();
      const timed = stamps && !stamps.busy && frame % 30 === 0 ? stamps : null;
      const pass = (view: GPUTextureView, first = false, last = false) => enc.beginRenderPass({
        colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
        ...(timed && (first || last) ? { timestampWrites: { querySet: timed.set, ...(first ? { beginningOfPassWriteIndex: 0 } : {}), ...(last ? { endOfPassWriteIndex: 1 } : {}) } } : {}),
      });
      const e = pass(emit.createView(), true);
      if (n) { e.setPipeline(emitPipe); e.setBindGroup(0, emitBind); e.setVertexBuffer(0, lightBuf); e.draw(6, n); }
      e.end();
      for (let i = s.count - 1; i >= 0; i--) {
        const p = pass(s.levels[i].view);
        p.setPipeline(cascPipe); p.setBindGroup(0, s.levels[i].bind); p.draw(3);
        p.end();
      }
      const f = pass(s.lightView, false, true);
      f.setPipeline(finalPipe); f.setBindGroup(0, s.finalBind); f.draw(3);
      f.end();
      if (timed) { enc.resolveQuerySet(timed.set, 0, 2, timed.resolve, 0); enc.copyBufferToBuffer(timed.resolve, 0, timed.read, 0, 16); }
      device.queue.submit([enc.finish()]);
      if (timed) {
        timed.busy = true;
        timed.read.mapAsync(GPUMapMode.READ).then(() => {
          const t = new BigInt64Array(timed.read.getMappedRange().slice(0));
          timed.read.unmap(); timed.busy = false;
          lastMs = Number(t[1] - t[0]) / 1e6;
        }).catch(() => { timed.busy = false; });
      }

      const g = s.sheetU.uniforms.uGrade as Float32Array;
      if (options.only) { g[0] = 0; g[1] = 0; g[2] = 0; g[3] = 1; }
      else { g[0] = ((grade >> 16) & 255) / 255; g[1] = ((grade >> 8) & 255) / 255; g[2] = (grade & 255) / 255; g[3] = 0; }
      s.mesh.visible = true;
      s.mesh.setFromMatrix(map);
      return true;
    },
    destroy() {
      unsize();
      setTimeout(() => { occ.destroy(); emit.destroy(); lightBuf.destroy(); sceneU.destroy(); finalU.destroy(); stamps?.set.destroy(); stamps?.resolve.destroy(); stamps?.read.destroy(); }, 600);
    },
  };
}

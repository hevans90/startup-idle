/**
 * World v2 — WHAT THE WATER MIRRORS, day and night alike: the town standing over it, as it was drawn.
 *
 * The camera looks down the map's (1, 1) and four half steps down for every tile, so a line of sight that meets flat
 * water goes on, mirrored, back up the map's (−1, −1) and four half steps UP for every tile — and what it meets there
 * is drawn on the screen straight above the water, four of the map's half-tile heights up for every tile it went. So:
 *
 *  - ON THE MAP (a texel a column, the solver's own): from the water's face, how far the mirrored line goes before
 *    something stands as high as it — the ground and what is built on it, or a bridge's deck at its height. Worked
 *    out once a frame on the map, not by every pixel of water: a march a pixel was the cost of a whole frame.
 *  - ON THE SCREEN: the water's own pixel looks that far up the screen, in LAST FRAME's picture, for the colour —
 *    the wall, the lit window, the lamp, the bridge — and gives it as what its Fresnel sees in place of the sky.
 *
 * One picture for both: by day the walls in the sun, at night the walls dark and their windows lit, because that is
 * what was drawn. Nothing about the water's own look changes: only what the sky term shows where something stands
 * to be shown. @see waterLook, day-fresnel-loved
 *
 *  - AND OVER THE NIGHT, what of that image is a light, added over the night's grade: the picture stops at white and
 *    the grade is laid over the water after it, so a lamp mirrored under it is never brighter than the grade's blue.
 *    The same lookup, on the map's plane past the grade. @see MIRROR_GLOW_WGSL
 */
import { Buffer, BufferImageSource, BufferUsage, Geometry, GpuProgram, Matrix, Mesh, RenderTexture, Shader, TextureStyle, type Container, type Renderer, type TextureSource, type UniformGroup } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../iso";

/** Half steps up the mirrored line climbs for every tile along it: the camera's own slope. */
export const MIRROR_RISE = (2 * HH) / HEIGHT_UNIT;
/** The furthest a mirrored line is followed, tiles: past a tall tower's top from any water near it. */
const REACH = 48;

/** What the water's shader reads: the map's answer, the heights it was asked of, and last frame. */
export type MirrorSources = {
  /** A texel a column: how far the mirrored line went before it met something, tiles (red, weighted by green), and whether it did (green); the face there, half steps — the water's, or dry, what stands (blue); and whether it is water (alpha). */
  hit: BufferImageSource;
  /** A texel a column, half steps: the ground (red: read filtered, it is the smooth face the ground is drawn as), a
   * deck's height or far below (green), and the top of what is built there or far below (blue: a box, read as is). */
  heights: BufferImageSource;
  /** Last frame as it was shown. */
  frame: TextureSource;
  /** The town over the top of the screen, drawn on its own, a few frames old at most. @see renderStrip */
  wide: TextureSource;
  style: TextureStyle;
  nx: number; ny: number;
};

export function createMirrorSources(nx: number, ny: number): MirrorSources {
  return {
    hit: new BufferImageSource({ resource: new Uint16Array(nx * ny * 4), width: nx, height: ny, format: "rgba16float", scaleMode: "linear" }),
    heights: new BufferImageSource({ resource: new Uint16Array(nx * ny * 4), width: nx, height: ny, format: "rgba16float", scaleMode: "linear" }),
    frame: RenderTexture.create({ width: 4, height: 4, resolution: 1, format: navigatorFormat(), antialias: false }).source,
    wide: RenderTexture.create({ width: 4, height: 4, resolution: 1, antialias: false }).source,
    style: new TextureStyle({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
    nx, ny,
  };
}

const navigatorFormat = (): "bgra8unorm" | "rgba8unorm" =>
  typeof navigator !== "undefined" && navigator.gpu?.getPreferredCanvasFormat() === "rgba8unorm" ? "rgba8unorm" : "bgra8unorm";

const HIT_WGSL = /* wgsl */ `
// The map in columns; columns a tile; the highest anything stands, half steps; how far to follow a line, tiles.
struct U { size: vec2<f32>, cpt: f32, top: f32, reach: f32, p0: f32, p1: f32, p2: f32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var uH : texture_2d<f32>;
@group(0) @binding(2) var uTop : texture_2d<f32>;
@group(0) @binding(3) var uDepth : texture_2d<f32>;
@group(0) @binding(4) var uBed : texture_2d<f32>;
// The ground at a point (columns) between the four round it — the face it is drawn as, not a stair of columns.
fn groundAt(q: vec2<f32>) -> f32 {
  let n = vec2<i32>(u.size) - vec2<i32>(1);
  let g = q - vec2<f32>(0.5);
  let c = vec2<i32>(floor(g)); let f = g - floor(g);
  let a = textureLoad(uH, clamp(c, vec2<i32>(0), n), 0).r;
  let b = textureLoad(uH, clamp(c + vec2<i32>(1, 0), vec2<i32>(0), n), 0).r;
  let d = textureLoad(uH, clamp(c + vec2<i32>(0, 1), vec2<i32>(0), n), 0).r;
  let e = textureLoad(uH, clamp(c + vec2<i32>(1, 1), vec2<i32>(0), n), 0).r;
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let c = vec2<i32>(pos.xy);
  let depth = textureLoad(uDepth, c, 0).r;
  // (Dry: no mirror, and the face a line of sight meets there — the ground or what stands on it — for the light
  // over the night to find the water by. @see MIRROR_GLOW_WGSL)
  if (depth < 0.02) { let d = textureLoad(uH, c, 0); return vec4<f32>(0.0, 0.0, max(d.r, d.b), 0.0); }
  let level = textureLoad(uBed, c, 0).r + depth;
  // (Where it starts, in columns; a quarter of a column a look, so a wall's face is found within a hand.)
  let p = vec2<f32>(c) + vec2<f32>(0.5);
  let step = 0.25;
  let rise = ${MIRROR_RISE} / u.cpt;
  let tiles = vec2<i32>(u.size / u.cpt);
  var s = 0.0;
  for (var k = 0; k < 4096; k++) {
    s += step;
    let z = level + rise * s;
    if (z > u.top || s > u.reach * u.cpt) { break; }
    let q = p - vec2<f32>(s);
    if (q.x < 0.0 || q.y < 0.0) { break; }
    // (A tile at a time where nothing in it stands as high as the line: its own highest, one look.)
    let t = vec2<i32>(q / u.cpt);
    if (textureLoad(uTop, min(t, tiles - vec2<i32>(1)), 0).r < z) { continue; }
    let h = textureLoad(uH, vec2<i32>(q), 0);
    if (h.b >= z || groundAt(q) >= z || (h.g > -1000.0 && abs(h.g - z) < 1.0)) { return vec4<f32>(s / u.cpt, 1.0, level, 1.0); }
  }
  return vec4<f32>(0.0, 0.0, level, 1.0);
}
`;

type Gpu = { gpu?: { device: GPUDevice }; texture?: { getGpuSource: (s: unknown) => GPUTexture } };

/** What a frame gives it: the ground and what is built (a texel a column), the decks, and the water. */
export type MirrorFrame = {
  /** Half steps, `cpt` texels a tile each way: the ground, and how high what stands on it is over it. A count that moves when either does. */
  heights: Float32Array; casts: Float32Array; rev: number;
  /** A tile: whether a deck is there, and its height, half steps. */
  deck: Uint8Array; deckZ: Int8Array | Float32Array | Int16Array;
  /** The solver's depth and bed, as Pixi's textures. */
  depth: TextureSource; bed: TextureSource;
  /** Tiles across and down, and columns a tile. */
  w: number; h: number; cpt: number;
};

export type Mirror = {
  /** The map's answer for this frame. */
  tick: (f: MirrorFrame) => void;
  /** Before the frame is drawn: where last frame's picture lies against this one's. Given the render's options: only the window's counts. */
  before: (o?: { target?: unknown }) => void;
  /** After it is drawn: kept for the next. */
  after: (o?: { target?: unknown }) => void;
  destroy: () => void;
};

/**
 * The work on the device for `src`, drawn by `renderer`; `world` is the map's container (where the camera is). Null
 * without WebGPU. @see MirrorSources
 */
export function createMirror(
  renderer: Renderer, world: Container, src: MirrorSources, scale: number, look: UniformGroup, glowWgsl: string, zIndex: number,
  /** Draw only the bands that show in the strip this far (world units) over the top of the screen; 0, as the screen wants. */
  cull?: (above: number) => void,
): Mirror | null {
  const sys = renderer as unknown as Gpu, device = sys.gpu?.device;
  if (!device || typeof sys.texture?.getGpuSource !== "function") return null;
  const { nx, ny } = src;
  const cpt = 4, tw = Math.ceil(nx / cpt), th = Math.ceil(ny / cpt);
  const top = new BufferImageSource({ resource: new Float32Array(tw * th), width: tw, height: th, format: "r32float", scaleMode: "nearest" });
  const mod = device.createShaderModule({ code: HIT_WGSL });
  const pipe = device.createRenderPipeline({ layout: "auto", vertex: { module: mod, entryPoint: "vs" }, fragment: { module: mod, entryPoint: "fs", targets: [{ format: "rgba16float" }] } });
  const U = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let bind: GPUBindGroup | null = null, bindOf: unknown = null;
  let rev = -1, highest = 0, lowest = 0;
  // THE STRIP OF TOWN OVER THE TOP OF THE SCREEN: drawn into one texture, kept in another the water reads (it is
  // drawn while the water in it reads the last one); the camera it was drawn from, its share of the screen's pixels,
  // how far above the screen it starts (framebuffer pixels), its size; when it was last drawn.
  const stripRt = RenderTexture.create({ width: 4, height: 4, resolution: 1, antialias: false });
  let stripCam: [number, number, number] | null = null, stripK = 1, stripMx = 0, stripE = 0, stripW = 4, stripH = 4, stripOk = false;
  let frameNo = 0, stripAt = -1e9, drawingStrip = false;
  const hData = src.heights.resource as Uint16Array, tData = top.resource as Float32Array;
  // (Where the camera stood when last frame was drawn, and now: scale, then offset, CSS pixels.)
  let prev: [number, number, number] | null = null, now: [number, number, number] = [1, 0, 0];
  let canvasFormatOk = true;
  // THE LIGHT OVER THE NIGHT: the map's plane and a margin all round, for water seen above or below it.
  const mw = nx / cpt, mh = ny / cpt, M = 24;
  const corners = [[-M, -M], [mw + M, -M], [mw + M, mh + M], [-M, mh + M]];
  const verts = new Float32Array(corners.flatMap(([gu, gv]) => [(gu - 0.5 - (gv - 0.5)) * HW * scale, (gu - 0.5 + gv - 0.5) * HH * scale, gu, gv]));
  const vb = new Buffer({ data: verts, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
  const geometry = new Geometry({
    attributes: { aPosition: { buffer: vb, format: "float32x2", stride: 16, offset: 0 }, aGround: { buffer: vb, format: "float32x2", stride: 16, offset: 8 } },
    indexBuffer: new Buffer({ data: new Uint32Array([0, 1, 2, 0, 2, 3]), usage: BufferUsage.INDEX | BufferUsage.COPY_DST }),
  });
  const tex = (sampleType: "float" | "unfilterable-float") => ({ texture: { sampleType, viewDimension: "2d" as const, multisampled: false } });
  const glowProgram = GpuProgram.from({
    vertex: { source: glowWgsl, entryPoint: "mainVertex" }, fragment: { source: glowWgsl, entryPoint: "mainFragment" }, name: "mirror-glow",
    layout: [{ globalUniforms: 0 }, { localUniforms: 0 }, { look: 0, uMirrorHit: 1, uMirrorH: 2, uMirrorFrame: 3, uMirrorSampler: 4, uTop: 5, uMirrorWide: 6 }],
    gpuLayout: [
      [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
      [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
      [
        { binding: 0, visibility: 3, buffer: { type: "uniform" } },
        { binding: 1, visibility: 2, ...tex("float") },
        { binding: 2, visibility: 2, ...tex("float") },
        { binding: 3, visibility: 2, ...tex("float") },
        { binding: 4, visibility: 2, sampler: { type: "filtering" } },
        { binding: 5, visibility: 2, ...tex("unfilterable-float") },
        { binding: 6, visibility: 2, ...tex("float") },
      ],
    ],
  });
  let glow: Mesh<Geometry, Shader> | null = null;

  /**
   * THE TOWN OVER THE TOP OF THE SCREEN, for the water to mirror. The mirrored line goes up the screen as far as
   * whatever it meets stands high; close up, that is far past the screen's top, and last frame's picture stops there
   * — zoomed in on a lake, the towers' reflections faded to nothing. So the bands over the screen's top are drawn on
   * their own, as high up as anything on the map can be mirrored from, at a share of the screen's pixels (it is seen
   * blurred, through ripples), into a texture the water reads; again every other frame while the camera moves, and
   * every quarter second while it does not (a window lit, a car gone by).
   */
  // ONLY THE WINDOW'S OWN FRAME. Anything drawn into a texture — the roads' paint, a house's light, the ground's copy —
  // runs these too, and the canvas taken then, before the frame was drawn, was one of the window's old ones from some
  // frames back: under a moving camera the water mirrored the wrong picture for a frame, a band of it going dark.
  const onWindow = (o?: { target?: unknown }) => !o?.target || o.target === renderer.view.renderTarget;

  function renderStrip() {
    frameNo++;
    const m = world.getGlobalTransform(undefined, false);
    const res = renderer.resolution, W = renderer.screen.width, H = renderer.screen.height;
    // (How far up the screen the furthest reflection can come from, CSS pixels: the highest thing, from the lowest
    // water, a tile along for every four half steps — never more than twice the screen.)
    const reach = Math.min(REACH, Math.max(0, (highest + 1 - lowest) / MIRROR_RISE));
    const need = Math.min(reach * 4 * HH * scale * m.a, 2 * H);
    if (need < 16 || !(m.a > 0)) { stripOk = false; return; }
    // (Drawn taller than that, and wider than the screen: it is a frame or two old as the camera moves, and zooming in
    // reaches further up than it went, panning past its side — and there, where it ran out, the towers went out for a
    // frame and came back, flickering. In eighths of the screen, so it is not made again at every step of a zoom.)
    const step = H / 8;
    const E = Math.min(Math.ceil((need * 1.3) / step) * step, 2.6 * H);
    const mx = Math.round(0.08 * W);
    // (Nothing over the screen's top when the map's own top, as high as anything on it stands, is on the screen — and
    // well on it: what is built is drawn taller than the shade it casts says, roofs and all, and a tower's top went
    // off the screen with no strip yet to show it, its reflection dark for those frames.)
    if (m.ty + m.d * (-3 * HH - Math.max(0, highest) * 1.5 * HEIGHT_UNIT) * scale >= 0) { stripOk = false; return; }
    const moved = !stripCam || stripCam[0] !== m.a || Math.abs(stripCam[1] - m.tx) > 0.5 || Math.abs(stripCam[2] - m.ty) > 0.5;
    if (frameNo - stripAt < (moved ? 2 : 15)) return;
    stripAt = frameNo;
    // (And a little into the screen, to cross from one picture to the other over.)
    const over = 0.1 * H;
    const k = Math.min(0.5, Math.sqrt(1.5e6 / Math.max(1, (W + 2 * mx) * res * (E + over) * res)));
    const w = Math.max(4, Math.ceil((W + 2 * mx) * res * k)), h = Math.max(4, Math.ceil((E + over) * res * k));
    if (stripRt.source.pixelWidth !== w || stripRt.source.pixelHeight !== h) stripRt.resize(w, h, 1);
    if (src.wide.pixelWidth !== w || src.wide.pixelHeight !== h) src.wide.resize(w, h, 1);
    const f = res * k;
    const t = new Matrix(m.a * f, m.b * f, m.c * f, m.d * f, (m.tx + mx) * f, (m.ty + E) * f);
    drawingStrip = true;
    // (No mirror in it: the water in the strip, mirroring by the screen's numbers, mirrored nonsense, a new one at every
    // redraw — and the water on the screen mirrored that, flashing as the strip was drawn again.)
    const m1 = look.uniforms.uMirror2 as Float32Array, was = m1[2];
    m1[2] = 0; look.update();
    try {
      cull?.(E / m.a);
      renderer.render({ container: world, target: stripRt, clear: true, clearColor: renderer.background.colorRgba, transform: t });
    } finally {
      cull?.(0);
      m1[2] = was; look.update();
      drawingStrip = false;
    }
    const enc = device!.createCommandEncoder({ label: "mirror strip" });
    enc.copyTextureToTexture({ texture: sys.texture!.getGpuSource(stripRt.source) }, { texture: sys.texture!.getGpuSource(src.wide) }, [w, h]);
    device!.queue.submit([enc.finish()]);
    stripCam = [m.a, m.tx, m.ty]; stripMx = mx; stripK = k; stripE = E; stripW = w; stripH = h; stripOk = true;
  }

  return {
    tick(f) {
      if (f.rev !== rev || hData.length !== nx * ny * 4) {
        rev = f.rev;
        highest = -Infinity; lowest = Infinity;
        tData.fill(-Infinity);
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            const i = y * nx + x, tx = Math.floor(x / cpt), ty = Math.floor(y / cpt), t = ty * f.w + tx;
            const g = f.heights[i] ?? 0, cast = f.casts[i] ?? 0;
            const b = cast > 0.05 ? g + cast : -1e4;
            const d = f.deck[t] ? f.deckZ[t] : -1e4;
            hData[i * 4] = half(g); hData[i * 4 + 1] = half(d); hData[i * 4 + 2] = half(b); hData[i * 4 + 3] = 0;
            const most = Math.max(g + cast, d);
            const ti = ty * tw + tx;
            if (most > tData[ti]) tData[ti] = most;
            if (most > highest) highest = most;
            if (g < lowest) lowest = g;
          }
        }
        device.queue.writeTexture({ texture: sys.texture!.getGpuSource(src.heights) }, hData, { bytesPerRow: nx * 8 }, [nx, ny]);
        device.queue.writeTexture({ texture: sys.texture!.getGpuSource(top) }, tData, { bytesPerRow: tw * 4 }, [tw, th]);
      }
      if (bindOf !== f.depth || !bind) {
        bindOf = f.depth;
        bind = device.createBindGroup({
          layout: pipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: U } },
            { binding: 1, resource: sys.texture!.getGpuSource(src.heights).createView() },
            { binding: 2, resource: sys.texture!.getGpuSource(top).createView() },
            { binding: 3, resource: sys.texture!.getGpuSource(f.depth).createView() },
            { binding: 4, resource: sys.texture!.getGpuSource(f.bed).createView() },
          ],
        });
      }
      if (!glow) {
        const shader = new Shader({ gpuProgram: glowProgram, resources: { look, uMirrorHit: src.hit, uMirrorH: src.heights, uMirrorFrame: src.frame, uMirrorSampler: src.style, uTop: top, uMirrorWide: src.wide } });
        glow = new Mesh<Geometry, Shader>({ geometry, shader });
        glow.eventMode = "none"; glow.blendMode = "add"; glow.zIndex = zIndex; glow.visible = false;
        world.addChild(glow);
      }
      device.queue.writeBuffer(U, 0, new Float32Array([nx, ny, cpt, highest + 1, REACH, 0, 0, 0]));
      const enc = device.createCommandEncoder({ label: "mirror" });
      const pass = enc.beginRenderPass({ label: "mirror hit", colorAttachments: [{ view: sys.texture!.getGpuSource(src.hit).createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
      device.queue.submit([enc.finish()]);
      renderStrip();
    },
    before(o) {
      if (drawingStrip || !onWindow(o)) return;
      const m = world.getGlobalTransform(undefined, false);
      now = [m.a, m.tx, m.ty];
      const res = renderer.resolution;
      const frame = src.frame;
      const fw = frame.pixelWidth, fh = frame.pixelHeight;
      const ok = !!prev && canvasFormatOk && fw === renderer.canvas.width && fh === renderer.canvas.height;
      // (Framebuffer pixels up the screen for every tile along the mirrored line; last frame's place for this one's.)
      const a = prev ? prev[0] / now[0] : 1;
      const m0 = look.uniforms.uMirror as Float32Array, m1 = look.uniforms.uMirror2 as Float32Array, m2 = look.uniforms.uMirror3 as Float32Array;
      m0[0] = 4 * HH * scale * now[0] * res; m0[1] = a;
      m0[2] = prev ? res * (prev[1] - a * now[1]) : 0; m0[3] = prev ? res * (prev[2] - a * now[2]) : 0;
      m1[0] = 1 / Math.max(1, fw); m1[1] = 1 / Math.max(1, fh); m1[2] = ok ? 1 : 0;
      m2[0] = nx / cpt; m2[1] = ny / cpt; m2[2] = highest + 1;
      // (The strip's camera against this one's, as last frame's is; and where in it the screen's pixels fall.)
      const w0 = look.uniforms.uWide as Float32Array, w2 = look.uniforms.uWide2 as Float32Array;
      if (stripCam && stripOk) {
        const sa = stripCam[0] / now[0];
        w0[0] = sa; w0[1] = res * (stripCam[1] - sa * now[1] + stripMx); w0[2] = res * (stripCam[2] - sa * now[2]); w0[3] = 1;
        w2[0] = stripK; w2[1] = stripE * res; w2[2] = 1 / stripW; w2[3] = 1 / stripH;
      } else w0[3] = 0;
      look.update();
      // (Only under a grade that takes a light down — by night — and only with last frame to read.)
      const gr = look.uniforms.uGrade as Float32Array;
      if (glow) glow.visible = ok && Math.min(gr[0], gr[1], gr[2]) < 0.7;
    },
    after(o) {
      if (drawingStrip || !onWindow(o)) return;
      prev = now;
      const canvas = renderer.canvas as HTMLCanvasElement;
      const frame = src.frame;
      if (frame.pixelWidth !== canvas.width || frame.pixelHeight !== canvas.height) {
        frame.resize(canvas.width, canvas.height, 1);
        return;
      }
      const ctx = canvas.getContext("webgpu") as GPUCanvasContext | null;
      if (!ctx) return;
      let cur: GPUTexture;
      try { cur = ctx.getCurrentTexture(); } catch { return; }
      if (cur.format !== frame.format) { canvasFormatOk = false; return; }
      canvasFormatOk = true;
      const enc = device.createCommandEncoder({ label: "mirror frame" });
      enc.copyTextureToTexture({ texture: cur }, { texture: sys.texture!.getGpuSource(frame) }, [canvas.width, canvas.height]);
      device.queue.submit([enc.finish()]);
    },
    destroy() {
      glow?.destroy(); geometry.destroy();
      setTimeout(() => stripRt.destroy(true), 500);
      // (A frame later, as anything a batch may still hold. @see batches-keep-destroyed-sources)
      setTimeout(() => { U.destroy(); top.destroy(); }, 500);
    },
  };
}

/** A float as a half's bits: the heights go up as rgba16float so the ground can be read filtered. */
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function half(v: number): number {
  f32[0] = v;
  const x = u32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  // (Rounded to nearest, a carry into the exponent and all.)
  return (sign | (e << 10) | (m >>> 13)) + ((m >>> 12) & 1);
}

/**
 * The falls' meshes, filled by the device instead of by `drawFalls`.
 *
 * A BUFFER PER BAND, which WebGPU leaves no choice about. The obvious shape is
 * one allocation with each band at its own offset, and it does not work: a
 * vertex attribute's offset must be less than its ARRAY STRIDE, so an offset
 * of a hundred and ten thousand into a stride of forty-eight is not a
 * pipeline, it is an invalid one — and an invalid pipeline takes the whole
 * render pass with it. What that looks like is a blank map with the frame
 * readout insisting it drew all hundred and twenty seven bands.
 *
 * So the compute pass writes one buffer of its own and copies each band's
 * quads into that band's, as far as the band reached last frame. A quarter of
 * a megabyte a frame of device-to-device copy, against building the same quads
 * on the host for three quarters of a millisecond. @see spill
 *
 * WHAT IT DRAWS IS A FRAME STALE, and that is safe in both directions because
 * the pass clears before it fills. A count short of this frame's draws a sheet
 * a frame late, which is a sixtieth of a second on something that falls for
 * about a second; a count over it draws slots that were cleared, and four
 * corners at the origin make no fragments.
 */
import {
  Buffer, BufferUsage, Geometry, GlProgram, GpuProgram, Mesh, Shader,
} from "pixi.js";
import type { Container } from "pixi.js";

import { QUAD_WORDS } from "../../fluid/gpu/sheet";
import type { BandLayer } from "./bands";

/** Bytes one quad's instance data takes. @see QUAD_WORDS */
const STRIDE = QUAD_WORDS * 4;

/**
 * The sheet's own shader: a quad per INSTANCE, four corners per quad.
 *
 * Not `quads`' flat one, and the difference is only how the corner is found.
 * That shader takes a vertex per corner and is drawn by index count, which
 * Pixi gives a mesh no way to change per frame; this one takes the whole quad
 * as instance data and picks the corner off the vertex index, so how many a
 * band draws is its `instanceCount` — the one number a mesh can be told each
 * frame, and the same mechanism the water surface uses.
 *
 * WebGPU only. The host builds the sheets everywhere else, so there is no
 * GLSL twin to keep in step. @see drawFalls
 */
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

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vColor: vec4<f32>,
};

@vertex
fn mainVertex(
  @builtin(vertex_index) vid: u32,
  @location(0) aTop: vec4<f32>,
  @location(1) aFoot: vec4<f32>,
  @location(2) aColor: vec4<f32>,
) -> VSOutput {
  // THE FOUR CORNERS, in the order the host pushed them: crest A, crest B,
  // foot B, foot A, which is round the quad rather than across it.
  var pos = aTop.xy;
  var packed = aColor.x;
  if (vid == 1u) { pos = aTop.zw; packed = aColor.y; }
  else if (vid == 2u) { pos = aFoot.xy; packed = aColor.z; }
  else if (vid == 3u) { pos = aFoot.zw; packed = aColor.w; }

  let bits = bitcast<u32>(packed);
  let c = vec4<f32>(
    f32(bits & 255u), f32((bits >> 8u) & 255u),
    f32((bits >> 16u) & 255u), f32((bits >> 24u) & 255u),
  ) / 255.0;

  let mvp = globalUniforms.uProjectionMatrix
          * globalUniforms.uWorldTransformMatrix
          * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(pos, 1.0);
  var out: VSOutput;
  out.position = vec4<f32>(clip.xy, 0.0, 1.0);
  out.vColor = vec4<f32>(c.rgb * c.a, c.a)
             * localUniforms.uColor
             * globalUniforms.uWorldColorAlpha;
  return out;
}
`;

const FRAGMENT_WGSL = /* wgsl */ `
@fragment
fn mainFragment(@location(0) vColor: vec4<f32>) -> @location(0) vec4<f32> {
  return vColor;
}
`;

let shared: Shader | null = null;

/** One shader for every band, made once. @see quadShader, which says why. */
function sheetShader(): Shader {
  if (shared) return shared;
  shared = new Shader({
    gpuProgram: GpuProgram.from({
      vertex: { source: VERTEX_WGSL, entryPoint: "mainVertex" },
      fragment: { source: FRAGMENT_WGSL, entryPoint: "mainFragment" },
    }),
    // NEVER USED — this layer is only built where there is a device — but Pixi
    // wants one to exist before it will make a shader at all.
    glProgram: GlProgram.from({
      vertex: "#version 300 es\nvoid main(){gl_Position=vec4(0.0);}",
      fragment: "#version 300 es\nprecision mediump float;out vec4 o;void main(){o=vec4(0.0);}",
    }),
  });
  return shared;
}

/**
 * Quads one band's sheets may hold.
 *
 * A fall is `NAPPE_STEPS` quads per falling lip, and the lips that share a
 * band are the ones whose drifted middles land on the same diagonal — so the
 * bound is how many lips a diagonal can carry, which is the map's own width.
 * Measured on the waterfall fixture the busiest band holds a few hundred.
 * Over-running is not a fault: the pass drops what does not fit, so a band
 * asked for more than this loses its last few quads rather than its buffer.
 */
export const SHEET_CAP = 768;

export type GpuFallLayer = {
  meshes: Mesh<Geometry, Shader>[];
  /**
   * ONE BUFFER PER BAND, which WebGPU leaves no choice about: a vertex
   * attribute's offset must be less than its array stride, so a band cannot be
   * a slice of a shared buffer. The pass writes its own and copies in.
   */
  verts: Buffer[];
  indices: Buffer;
  cap: number;
  /** Bands drawing anything, so a band that empties is hidden once. */
  live: Set<number>;
};

export function createGpuFallLayer(bands: BandLayer, cap = SHEET_CAP): GpuFallLayer {
  const n = bands.bands.length;
  const verts: Buffer[] = [];
  for (let b = 0; b < n; b++) {
    // NOT `data`: there is nothing to seed it with, and a typed array per band
    // on the host is the allocation this exists to avoid.
    verts.push(new Buffer({
      size: cap * QUAD_WORDS * 4,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    }));
  }
  // SIX INDICES ROUND FOUR CORNERS, shared by every band and every quad —
  // an instance is one quad, so the index buffer never grows.
  const indices = new Buffer({
    data: new Uint32Array([0, 1, 2, 0, 2, 3]),
    usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
  });

  const meshes: Mesh<Geometry, Shader>[] = [];
  for (let b = 0; b < n; b++) {
    // OFFSETS WITHIN ONE QUAD, which is all a vertex attribute's offset may
    // ever be: it has to be less than the array stride, and the stride here is
    // one quad. The band is which BUFFER, not which offset.
    const per = { buffer: verts[b], stride: STRIDE, instance: true } as const;
    const geometry = new Geometry({
      attributes: {
        aTop: { ...per, format: "float32x4", offset: 0 },
        aFoot: { ...per, format: "float32x4", offset: 16 },
        aColor: { ...per, format: "float32x4", offset: 32 },
      },
      indexBuffer: indices,
      instanceCount: 0,
    });
    const mesh = new Mesh({ geometry, shader: sheetShader() });
    mesh.eventMode = "none";
    mesh.visible = false;
    (bands.structureOf[b] as Container).addChild(mesh);
    meshes.push(mesh);
  }
  return { meshes, verts, indices, cap, live: new Set() };
}

export function destroyGpuFallLayer(fl: GpuFallLayer) {
  for (const m of fl.meshes) {
    // THE GEOMETRY FIRST, by a reference of our own: destroying the mesh nulls
    // its `geometry`, so reaching through it afterwards throws inside a React
    // cleanup and takes the whole scene's teardown with it.
    const g = m.geometry;
    m.parent?.removeChild(m);
    m.destroy({ children: true });
    // NOT THE BUFFERS, which every band shares: `destroy(true)` takes them
    // with it, so the first geometry would leave the rest of them reaching
    // through a null. They go once, below.
    g?.destroy(false);
  }
  for (const v of fl.verts) v.destroy();
  fl.verts.length = 0;
  fl.indices.destroy();
  fl.meshes.length = 0;
  fl.live.clear();
}

/**
 * Say how much of each band's slice to draw, from what the device counted.
 *
 * The only thing left for the host to do about a waterfall: no geometry, no
 * colours, no neighbour reads — a number per band, off a readback of half a
 * kilobyte.
 */
export function drawGpuFalls(fl: GpuFallLayer, counts: Uint32Array | null) {
  for (let b = 0; b < fl.meshes.length; b++) {
    const quads = counts ? Math.min(counts[b] ?? 0, fl.cap) : 0;
    const mesh = fl.meshes[b];
    mesh.geometry.instanceCount = quads;
    const on = quads > 0;
    mesh.visible = on;
    if (on) fl.live.add(b); else fl.live.delete(b);
  }
}
